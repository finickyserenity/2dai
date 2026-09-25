import { db } from '../db'
import { createId } from '../id'
import { authenticatedApi, fetchServerInfo, redeemInvite, SyncApiError, type AuthenticatedApi } from './api'
import { generateDeviceKey } from './keys'
import type { Me, Session } from './protocol'
import type { ServerConnection } from './types'

export interface ConnectOptions {
  baseUrl: string
  secret?: string
  code?: string
  displayName?: string
  deviceName: string
}

// Enrolls this device: fresh key, redeem the invite, store the connection. The first
// authenticated connection becomes primary (DESIGN.md 1.1).
export async function connectWithInvite(options: ConnectOptions): Promise<ServerConnection> {
  const info = await fetchServerInfo(options.baseUrl)
  const existing = await db.servers.where('instanceId').equals(info.instanceId).first()
  if (existing && existing.kind !== 'public') throw new SyncApiError(0, 'already_connected', `This device is already connected to ${info.name}`)

  const key = await generateDeviceKey()
  const redeemed = await redeemInvite(options.baseUrl, {
    ...(options.secret ? { secret: options.secret } : { code: options.code ?? '' }),
    ...(options.displayName ? { displayName: options.displayName } : {}),
    deviceName: options.deviceName,
    devicePublicKey: key.publicKey,
  })

  const hasPrimary = Boolean(await db.servers.where('kind').equals('primary').first())
  const now = new Date().toISOString()
  const connection: ServerConnection = {
    id: existing?.id ?? createId(),
    kind: hasPrimary ? 'member' : 'primary',
    baseUrl: options.baseUrl,
    instanceId: info.instanceId,
    serverName: info.name,
    workspaceId: redeemed.workspace.id,
    workspaceName: redeemed.workspace.name,
    userId: redeemed.user.id,
    displayName: redeemed.user.displayName,
    memberTag: redeemed.user.memberTag,
    role: redeemed.user.role,
    deviceId: redeemed.device.id,
    deviceName: redeemed.device.name,
    publicKey: key.publicKey,
    privateKey: key.privateKey,
    sessionToken: redeemed.session.token,
    sessionExpiresAt: redeemed.session.expiresAt,
    connectedAt: now,
    lastSeenAt: now,
    lastError: null,
  }
  await db.servers.put(connection)
  return connection
}

// The token always comes from the database, so every caller, including one holding
// an older copy of the connection, uses the newest session after a re-login.
export function apiFor(connection: ServerConnection): AuthenticatedApi {
  return authenticatedApi(connection, {
    getToken: async () => (await db.servers.get(connection.id))?.sessionToken ?? null,
    setSession: async (session: Session) => {
      await db.servers.update(connection.id, { sessionToken: session.token, sessionExpiresAt: session.expiresAt, lastError: null })
    },
  })
}

// Pulls the latest profile and device list from the server and mirrors the parts
// the app shows offline (name, tag, role, device name).
export async function refreshConnection(connection: ServerConnection): Promise<Me> {
  try {
    const me = await apiFor(connection).me()
    const patch: Partial<ServerConnection> = {
      workspaceName: me.workspace.name,
      displayName: me.user.displayName,
      memberTag: me.user.memberTag,
      role: me.user.role,
      deviceName: me.device.name,
      lastSeenAt: new Date().toISOString(),
      lastError: null,
    }
    await db.servers.update(connection.id, patch)
    return me
  } catch (error) {
    const message = error instanceof SyncApiError ? (error.status === 401 ? 'revoked' : error.code) : 'error'
    await db.servers.update(connection.id, { lastError: message })
    throw error
  }
}

// Signs this device out and forgets the connection. Best effort on the server side:
// a revoked or unreachable server must not stop the user from disconnecting.
export async function disconnect(connection: ServerConnection): Promise<void> {
  try {
    await apiFor(connection).logout()
  } catch {
    // ignore
  }
  await db.servers.delete(connection.id)
  const remaining = await db.servers.toArray()
  if (!remaining.some((server) => server.kind === 'primary')) {
    const next = remaining.find((server) => server.kind === 'member')
    if (next) await db.servers.update(next.id, { kind: 'primary' })
  }
}
