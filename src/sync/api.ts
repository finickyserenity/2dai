import {
  authMessage,
  ChallengeResponse,
  InviteCreated,
  InviteLookup,
  Me,
  RedeemResponse,
  ServerInfo,
  Session,
  PROTOCOL_VERSION,
  type CreateInviteRequest,
  type RedeemRequest,
} from './protocol'
import type { z } from 'zod'
import { signWithDeviceKey } from './keys'
import type { ServerConnection } from './types'

export class SyncApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message?: string) {
    super(message ?? code)
    this.status = status
    this.code = code
  }
}

const NETWORK_ERROR = 'unreachable'

async function request<T>(baseUrl: string, path: string, schema: z.ZodType<T> | undefined, init: RequestInit = {}, token?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    })
  } catch {
    throw new SyncApiError(0, NETWORK_ERROR, "Couldn't reach the server")
  }
  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new SyncApiError(response.status, 'not_a_sync_server', 'That address did not answer like a 2Dai server')
    }
  }
  if (!response.ok) {
    const error = (body ?? {}) as { error?: string; message?: string }
    throw new SyncApiError(response.status, error.error ?? `http_${response.status}`, error.message)
  }
  return schema ? schema.parse(body) : (body as T)
}

// Unauthenticated calls used while connecting.
export async function fetchServerInfo(baseUrl: string): Promise<ServerInfo> {
  const info = await request(baseUrl, '/server', ServerInfo)
  if (info.protocolVersion !== PROTOCOL_VERSION) throw new SyncApiError(0, 'protocol_mismatch', `This server speaks protocol ${info.protocolVersion}; the app speaks ${PROTOCOL_VERSION}`)
  return info
}

export function lookupInvite(baseUrl: string, reference: { secret?: string; code?: string }): Promise<InviteLookup> {
  const params = new URLSearchParams(reference.secret ? { secret: reference.secret } : { code: reference.code ?? '' })
  return request(baseUrl, `/invites/lookup?${params.toString()}`, InviteLookup)
}

export function redeemInvite(baseUrl: string, body: RedeemRequest): Promise<RedeemResponse> {
  return request(baseUrl, '/invites/redeem', RedeemResponse, { method: 'POST', body: JSON.stringify(body) })
}

// Proves possession of the device key and returns a fresh session.
export async function openSession(connection: ServerConnection): Promise<Session> {
  if (!connection.deviceId || !connection.privateKey) throw new SyncApiError(0, 'no_credential', 'This connection has no device key')
  const challenge = await request(connection.baseUrl, '/auth/challenge', ChallengeResponse, { method: 'POST', body: JSON.stringify({ deviceId: connection.deviceId }) })
  const message = authMessage({ nonce: challenge.nonce, deviceId: connection.deviceId, workspaceId: connection.workspaceId, serverOrigin: connection.baseUrl })
  const signature = await signWithDeviceKey(connection.privateKey, message)
  return request(connection.baseUrl, '/auth/session', Session, { method: 'POST', body: JSON.stringify({ deviceId: connection.deviceId, nonce: challenge.nonce, signature }) })
}

// Authenticated calls. `withSession` retries once with a new session when the
// stored token has expired; a revoked device fails the retry and surfaces as such.
export interface AuthenticatedApi {
  me(): Promise<Me>
  updateDisplayName(displayName: string): Promise<void>
  renameDevice(deviceId: string, name: string): Promise<void>
  revokeDevice(deviceId: string): Promise<void>
  createInvite(body: CreateInviteRequest): Promise<InviteCreated>
  logout(): Promise<void>
}

export interface SessionStore {
  getToken(): Promise<string | null>
  setSession(session: Session): Promise<void>
}

export function authenticatedApi(connection: ServerConnection, store: SessionStore): AuthenticatedApi {
  async function call<T>(path: string, schema: z.ZodType<T> | undefined, init: RequestInit = {}, retry = true): Promise<T> {
    let token = await store.getToken()
    if (!token) {
      const session = await openSession(connection)
      await store.setSession(session)
      token = session.token
    }
    try {
      return await request(connection.baseUrl, path, schema, init, token)
    } catch (error) {
      if (error instanceof SyncApiError && error.status === 401 && retry) {
        const session = await openSession(connection)
        await store.setSession(session)
        return call(path, schema, init, false)
      }
      throw error
    }
  }

  return {
    me: () => call('/me', Me),
    updateDisplayName: async (displayName) => { await call('/me', undefined, { method: 'PATCH', body: JSON.stringify({ displayName }) }) },
    renameDevice: async (deviceId, name) => { await call(`/devices/${deviceId}`, undefined, { method: 'PATCH', body: JSON.stringify({ name }) }) },
    revokeDevice: async (deviceId) => { await call(`/devices/${deviceId}/revoke`, undefined, { method: 'POST' }) },
    createInvite: (body) => call('/invites', InviteCreated, { method: 'POST', body: JSON.stringify(body) }),
    logout: async () => { await call('/auth/logout', undefined, { method: 'POST' }, false) },
  }
}
