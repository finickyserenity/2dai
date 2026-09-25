import type { WorkspaceRole } from './protocol'

export type ConnectionKind = 'primary' | 'member' | 'public'

// One row per server this device is connected to. The private key is a
// non-extractable CryptoKey: IndexedDB stores it by structured clone, so page code
// can sign with it but never read it. Public connections have no credential.
export interface ServerConnection {
  id: string
  kind: ConnectionKind
  baseUrl: string
  instanceId: string
  serverName: string
  workspaceId: string
  workspaceName: string
  userId: string | null
  displayName: string | null
  memberTag: string | null
  role: WorkspaceRole | null
  deviceId: string | null
  deviceName: string | null
  publicKey: string | null
  privateKey: CryptoKey | null
  sessionToken: string | null
  sessionExpiresAt: string | null
  connectedAt: string
  lastSeenAt: string | null
  lastError: string | null
}
