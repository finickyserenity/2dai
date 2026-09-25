import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Link2, LogOut, Plus, RefreshCw, Smartphone, UserPlus } from 'lucide-react'
import { db } from '../db'
import { fetchServerInfo, lookupInvite, SyncApiError } from './api'
import { apiFor, connectWithInvite, disconnect, refreshConnection } from './connections'
import { connectLinkFor, defaultDeviceName, normalizeServerUrl, parseConnectInput, type ConnectTarget } from './encoding'
import { hasSecureCrypto } from './keys'
import type { InviteCreated, InviteLookup, Me } from './protocol'
import { QrCodeView } from './QrCodeView'
import { QrScanner } from './QrScanner'
import type { ServerConnection } from './types'

type Screen =
  | { name: 'overview' }
  | { name: 'connect'; target?: ConnectTarget }
  | { name: 'scan' }
  | { name: 'connection'; id: string }
  | { name: 'invite'; connectionId: string; invite: InviteCreated; heading: string; hint: string }

interface SyncSettingsProps {
  defaultDisplayName: string
  pendingConnect?: ConnectTarget
}

function describeError(error: unknown): string {
  if (error instanceof SyncApiError) {
    const messages: Record<string, string> = {
      unreachable: "Couldn't reach that server. Check the address and your connection.",
      not_a_sync_server: 'That address did not answer like a 2Dai server.',
      protocol_mismatch: error.message,
      invite_invalid: 'That code or link is not recognized.',
      invite_expired: 'That invite has expired. Ask for a new one.',
      invite_used: 'That invite was already used. Ask for a new one.',
      server_claimed: 'This server already has an owner. Ask them for an invite instead.',
      user_unavailable: 'The account this invite belongs to is no longer available.',
      already_connected: error.message,
      rate_limited: 'Too many attempts. Wait a minute and try again.',
      unauthenticated: 'This device is no longer authorized on that server.',
      forbidden: "You don't have permission to do that.",
    }
    return messages[error.code] ?? error.message
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function appUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

export function SyncSettings({ defaultDisplayName, pendingConnect }: SyncSettingsProps) {
  const connections = useLiveQuery(() => db.servers.toArray(), [], undefined)
  const [screen, setScreen] = useState<Screen>(() => (pendingConnect ? { name: 'connect', target: pendingConnect } : { name: 'overview' }))
  // A new invite link arriving while this tab is open jumps to the connect screen.
  const [seenConnect, setSeenConnect] = useState(pendingConnect)
  if (pendingConnect && pendingConnect !== seenConnect) {
    setSeenConnect(pendingConnect)
    setScreen({ name: 'connect', target: pendingConnect })
  }

  if (!hasSecureCrypto()) {
    return (
      <>
        <p className="eyebrow">Sync</p>
        <h2 id="settings-title">Sync unavailable here</h2>
        <p className="settings-intro">Connecting to a server needs a secure (https) page. Open the app over https and try again.</p>
      </>
    )
  }

  if (screen.name === 'scan') {
    return (
      <ScanScreen
        onCancel={() => setScreen({ name: 'connect' })}
        onResult={(text) => {
          const target = parseConnectInput(text)
          setScreen({ name: 'connect', ...(target ? { target } : {}) })
        }}
      />
    )
  }

  if (screen.name === 'connect') {
    return (
      <ConnectScreen
        target={screen.target}
        defaultDisplayName={defaultDisplayName}
        onScan={() => setScreen({ name: 'scan' })}
        onCancel={() => setScreen({ name: 'overview' })}
        onConnected={(connection) => setScreen({ name: 'connection', id: connection.id })}
      />
    )
  }

  if (screen.name === 'invite') {
    const connection = connections?.find((item) => item.id === screen.connectionId)
    return (
      <InviteScreen
        invite={screen.invite}
        heading={screen.heading}
        hint={screen.hint}
        serverUrl={connection?.baseUrl ?? ''}
        onDone={() => setScreen({ name: 'connection', id: screen.connectionId })}
      />
    )
  }

  if (screen.name === 'connection') {
    const connection = connections?.find((item) => item.id === screen.id)
    if (!connection) {
      return <OverviewScreen connections={connections ?? []} onConnect={() => setScreen({ name: 'connect' })} onOpen={(id) => setScreen({ name: 'connection', id })} />
    }
    return (
      <ConnectionScreen
        connection={connection}
        onBack={() => setScreen({ name: 'overview' })}
        onInvite={(invite, heading, hint) => setScreen({ name: 'invite', connectionId: connection.id, invite, heading, hint })}
        onDisconnected={() => setScreen({ name: 'overview' })}
      />
    )
  }

  return <OverviewScreen connections={connections ?? []} onConnect={() => setScreen({ name: 'connect' })} onOpen={(id) => setScreen({ name: 'connection', id })} />
}

// ---------------------------------------------------------------------------

function OverviewScreen({ connections, onConnect, onOpen }: { connections: ServerConnection[]; onConnect: () => void; onOpen: (id: string) => void }) {
  const primary = connections.find((item) => item.kind === 'primary')
  const others = connections.filter((item) => item.kind !== 'primary')
  return (
    <>
      <p className="eyebrow">Sync</p>
      <h2 id="settings-title">{connections.length === 0 ? 'This device only' : 'Connected'}</h2>
      <p className="settings-intro">
        {connections.length === 0
          ? 'Your lists live only on this device. Connect to a 2Dai server to keep them backed up and share them with people on that server.'
          : 'Lists will start syncing with your primary server in an upcoming update. For now, connections manage who you are and which devices are yours.'}
      </p>
      {primary && <ConnectionCard connection={primary} label="Primary" onOpen={onOpen} />}
      {others.length > 0 && <p className="eyebrow settings-group-label">Also connected</p>}
      {others.map((connection) => <ConnectionCard key={connection.id} connection={connection} label={connection.kind === 'public' ? 'Public' : 'Member'} onOpen={onOpen} />)}
      <div className="backup-actions sync-actions">
        <button type="button" onClick={onConnect}>
          <Plus size={19} />
          <span><strong>Connect to a server</strong><small>Scan a QR code or enter a code</small></span>
        </button>
      </div>
    </>
  )
}

function ConnectionCard({ connection, label, onOpen }: { connection: ServerConnection; label: string; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="sync-card" onClick={() => onOpen(connection.id)}>
      <span className="sync-card-title"><strong>{connection.serverName}</strong><span className="sync-badge">{label}</span></span>
      <span className="sync-card-meta">
        {connection.displayName ? `${connection.displayName} · ${connection.memberTag}` : 'Read-only'}
        {connection.deviceName ? ` · ${connection.deviceName}` : ''}
      </span>
      {connection.lastError === 'revoked' && <span className="sync-card-warning">This device was signed out by the server</span>}
      {connection.lastError && connection.lastError !== 'revoked' && <span className="sync-card-warning">Couldn't reach the server</span>}
    </button>
  )
}

// ---------------------------------------------------------------------------

function ScanScreen({ onResult, onCancel }: { onResult: (text: string) => void; onCancel: () => void }) {
  const [error, setError] = useState('')
  const handleError = useCallback((message: string) => setError(message), [])
  return (
    <>
      <p className="eyebrow">Connect</p>
      <h2 id="settings-title">Scan the QR code</h2>
      <p className="settings-intro">Point the camera at the code shown on the other device or in the server's admin console.</p>
      {error ? <p className="backup-message" role="alert">{error}</p> : <QrScanner onResult={onResult} onError={handleError} />}
      <p className="sync-buttons"><button type="button" className="text-button" onClick={onCancel}>Enter a code instead</button></p>
    </>
  )
}

// ---------------------------------------------------------------------------

interface ConnectScreenProps {
  target?: ConnectTarget
  defaultDisplayName: string
  onScan: () => void
  onCancel: () => void
  onConnected: (connection: ServerConnection) => void
}

function ConnectScreen({ target, defaultDisplayName, onScan, onCancel, onConnected }: ConnectScreenProps) {
  const [server, setServer] = useState(target?.server ?? '')
  const [entry, setEntry] = useState(target?.invite ?? target?.code ?? '')
  const [preview, setPreview] = useState<{ server: string; lookup: InviteLookup; reference: { secret?: string; code?: string } }>()
  const [displayName, setDisplayName] = useState(defaultDisplayName)
  const [deviceName, setDeviceName] = useState(() => defaultDeviceName(navigator.userAgent, navigator.platform))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Deep links arrive with everything filled in, so look the invite up right away.
  // Deferred a tick so the effect itself sets no state.
  useEffect(() => {
    if (!target?.server || !(target.invite || target.code)) return
    const { server: serverUrl, invite, code } = target
    void Promise.resolve().then(() => lookUp(serverUrl, invite ?? code ?? ''))
  }, [target])

  async function lookUp(serverInput: string, entryInput: string) {
    setError('')
    const parsedEntry = parseConnectInput(entryInput)
    const serverUrl = parsedEntry?.server || (serverInput ? normalizeServerUrl(serverInput) : '')
    const reference = parsedEntry?.invite ? { secret: parsedEntry.invite } : parsedEntry?.code ? { code: parsedEntry.code } : undefined
    if (!serverUrl) { setError('Enter the server address.'); return }
    if (!reference) { setError('Enter the six-digit code or paste the invite link.'); return }
    setBusy(true)
    try {
      await fetchServerInfo(serverUrl)
      const lookup = await lookupInvite(serverUrl, reference)
      setServer(serverUrl)
      setPreview({ server: serverUrl, lookup, reference })
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  async function connect(event: FormEvent) {
    event.preventDefault()
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      const connection = await connectWithInvite({
        baseUrl: preview.server,
        ...preview.reference,
        ...(preview.lookup.displayNameRequired ? { displayName: displayName.trim() } : {}),
        deviceName: deviceName.trim() || 'My device',
      })
      onConnected(connection)
    } catch (caught) {
      setError(describeError(caught))
      setBusy(false)
    }
  }

  if (preview) {
    const { lookup } = preview
    const heading = lookup.kind === 'link-device'
      ? `Connect as ${lookup.linkTo?.displayName ?? 'yourself'}`
      : lookup.kind === 'claim-server' ? `Claim ${lookup.workspaceName}` : `Join ${lookup.workspaceName}`
    return (
      <form onSubmit={connect}>
        <p className="eyebrow">Connect</p>
        <h2 id="settings-title">{heading}</h2>
        <p className="settings-intro">
          {lookup.kind === 'link-device' && `This device will be added to ${lookup.linkTo?.displayName ?? 'the account'} · ${lookup.linkTo?.memberTag ?? ''} on ${lookup.serverName}.`}
          {lookup.kind === 'claim-server' && `You will become the admin of ${lookup.serverName}.`}
          {lookup.kind === 'join-workspace' && `You will get an identity on ${lookup.serverName}. People there will see the name you choose.`}
        </p>
        <div className="theme-settings sync-fields">
          {lookup.displayNameRequired && (
            <label>Your name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} required autoComplete="nickname" /></label>
          )}
          <label>This device<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={60} required /></label>
        </div>
        {error && <p className="backup-message" role="alert">{error}</p>}
        <p className="sync-buttons">
          <button type="submit" className="sync-primary" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
          <button type="button" className="text-button" onClick={() => setPreview(undefined)} disabled={busy}>Back</button>
        </p>
      </form>
    )
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void lookUp(server, entry) }}>
      <p className="eyebrow">Connect</p>
      <h2 id="settings-title">Connect to a server</h2>
      <p className="settings-intro">Use the invite from the person who runs the server, or from one of your own devices.</p>
      <div className="backup-actions sync-actions">
        <button type="button" onClick={onScan}>
          <Camera size={19} />
          <span><strong>Scan QR code</strong><small>Use the camera</small></span>
        </button>
      </div>
      <p className="eyebrow settings-group-label">Or enter it</p>
      <div className="theme-settings sync-fields">
        <label>Code or link<input value={entry} onChange={(event) => setEntry(event.target.value)} placeholder="482 917 or https://…" inputMode="text" autoComplete="off" autoCapitalize="off" /></label>
        <label>Server address<input value={server} onChange={(event) => setServer(event.target.value)} placeholder="sync.example.com" inputMode="url" autoComplete="off" autoCapitalize="off" /></label>
      </div>
      {error && <p className="backup-message" role="alert">{error}</p>}
      <p className="sync-buttons">
        <button type="submit" className="sync-primary" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
        <button type="button" className="text-button" onClick={onCancel} disabled={busy}>Cancel</button>
      </p>
    </form>
  )
}

// ---------------------------------------------------------------------------

interface ConnectionScreenProps {
  connection: ServerConnection
  onBack: () => void
  onInvite: (invite: InviteCreated, heading: string, hint: string) => void
  onDisconnected: () => void
}

function ConnectionScreen({ connection, onBack, onInvite, onDisconnected }: ConnectionScreenProps) {
  const [me, setMe] = useState<Me>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  // Keyed on the id, not the live row: refreshing writes lastSeenAt, which would
  // otherwise re-trigger this and loop.
  const connectionId = connection.id
  const load = useCallback(async () => {
    try {
      const current = await db.servers.get(connectionId)
      if (!current) return
      setMe(await refreshConnection(current))
      setError('')
    } catch (caught) {
      setError(describeError(caught))
    }
  }, [connectionId])

  // Fetch on open; deferred a tick so the effect body sets no state itself.
  useEffect(() => { void Promise.resolve().then(load) }, [load])

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label)
    setError('')
    try {
      await action()
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setBusy('')
    }
  }

  const api = apiFor(connection)
  const revoked = connection.lastError === 'revoked'

  return (
    <>
      <p className="eyebrow">{connection.kind === 'primary' ? 'Primary server' : 'Connected server'}</p>
      <h2 id="settings-title">{connection.serverName}</h2>
      <p className="settings-intro"><span className="mono-address">{connection.baseUrl}</span></p>
      <dl className="sync-facts">
        <div><dt>You</dt><dd>{connection.displayName} · {connection.memberTag}{connection.role === 'admin' ? ' · admin' : ''}</dd></div>
        <div><dt>This device</dt><dd>{connection.deviceName}</dd></div>
      </dl>
      {revoked && <p className="backup-message" role="alert">This device was signed out by the server. Disconnect it here, then ask for a new invite.</p>}
      {error && !revoked && <p className="backup-message" role="alert">{error}</p>}

      {!revoked && (
        <>
          <p className="eyebrow settings-group-label">Your devices</p>
          {me ? (
            <ul className="sync-devices">
              {me.devices.map((device) => (
                <li key={device.id}>
                  <Smartphone size={16} />
                  <span><strong>{device.name}</strong>{device.id === connection.deviceId ? <small>This device</small> : <small>Last seen {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleDateString() : 'never'}</small>}</span>
                  {device.id !== connection.deviceId && (
                    <button type="button" className="text-button" disabled={busy !== ''} onClick={() => run(device.id, async () => { await api.revokeDevice(device.id); await load() })}>
                      {busy === device.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="settings-intro">{error ? 'Device list unavailable while offline.' : 'Loading…'}</p>}

          <div className="backup-actions sync-actions">
            <button type="button" disabled={busy !== ''} onClick={() => run('link', async () => {
              const invite = await api.createInvite({ grants: [{ type: 'link-device', userId: connection.userId ?? '', revokeOtherDevices: false }], expiresInSeconds: 900, withCode: true })
              onInvite(invite, 'Add another device', 'On the new device, open 2Dai → Settings → Sync → Connect, then scan this code or type the digits. It expires in 15 minutes.')
            })}>
              <Link2 size={19} />
              <span><strong>{busy === 'link' ? 'Preparing…' : 'Add another device'}</strong><small>Show a code for your phone, tablet, or computer</small></span>
            </button>
            {connection.role === 'admin' && (
              <button type="button" disabled={busy !== ''} onClick={() => run('invite', async () => {
                const invite = await api.createInvite({ grants: [{ type: 'join-workspace' }], expiresInSeconds: 900, withCode: true })
                onInvite(invite, `Invite someone to ${connection.workspaceName}`, 'They open 2Dai → Settings → Sync → Connect and scan this code or type the digits. It works once and expires in 15 minutes.')
              })}>
                <UserPlus size={19} />
                <span><strong>{busy === 'invite' ? 'Preparing…' : 'Invite someone'}</strong><small>Give a person their own account on this server</small></span>
              </button>
            )}
            <button type="button" disabled={busy !== ''} onClick={() => run('refresh', load)}>
              <RefreshCw size={19} />
              <span><strong>{busy === 'refresh' ? 'Refreshing…' : 'Refresh'}</strong><small>Check the connection</small></span>
            </button>
          </div>
        </>
      )}

      <p className="eyebrow settings-group-label">Disconnect</p>
      {confirmDisconnect ? (
        <div className="sync-confirm">
          <p>Sign this device out of {connection.serverName}? Your lists stay on this device.</p>
          <p className="sync-buttons">
            <button type="button" className="sync-danger" disabled={busy !== ''} onClick={() => run('disconnect', async () => { await disconnect(connection); onDisconnected() })}>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button>
            <button type="button" className="text-button" onClick={() => setConfirmDisconnect(false)}>Keep</button>
          </p>
        </div>
      ) : (
        <div className="backup-actions sync-actions">
          <button type="button" onClick={() => setConfirmDisconnect(true)}>
            <LogOut size={19} />
            <span><strong>Disconnect this device</strong><small>Sign out and forget this server</small></span>
          </button>
        </div>
      )}
      <p className="sync-buttons"><button type="button" className="text-button" onClick={onBack}>Back</button></p>
    </>
  )
}

// ---------------------------------------------------------------------------

function InviteScreen({ invite, heading, hint, serverUrl, onDone }: { invite: InviteCreated; heading: string; hint: string; serverUrl: string; onDone: () => void }) {
  const link = connectLinkFor(appUrl(), serverUrl, invite.secret)
  const code = invite.code ? `${invite.code.slice(0, 3)} ${invite.code.slice(3)}` : ''
  return (
    <>
      <p className="eyebrow">Invite</p>
      <h2 id="settings-title">{heading}</h2>
      <p className="settings-intro">{hint}</p>
      <div className="sync-invite">
        <QrCodeView text={link} label="Invite QR code" />
        {code && <p className="sync-code" aria-label={`Code ${invite.code}`}>{code}</p>}
        <p className="settings-intro">Server: <span className="mono-address">{serverUrl}</span></p>
      </div>
      <p className="sync-buttons"><button type="button" className="sync-primary" onClick={onDone}>Done</button></p>
    </>
  )
}
