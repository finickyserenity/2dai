// Small pure helpers shared by the sync layer. Kept free of DOM/IndexedDB so they
// are trivially unit-tested.

export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export interface ConnectTarget {
  server: string
  invite?: string
  code?: string
}

// Accepts anything a person might paste or scan: the app deep link
// (…/#/connect?server=…&invite=…), the server's invite page (https://host/invite/<secret>),
// a bare server URL, or a six-digit code on its own.
export function parseConnectInput(raw: string): ConnectTarget | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const digits = text.replace(/[\s-]/g, '')
  if (/^\d{6}$/.test(digits)) return { server: '', code: digits }
  // A bare invite secret (base64url, 32 bytes → 43 chars) would otherwise parse as a hostname.
  if (/^[A-Za-z0-9_-]{32,}$/.test(text)) return { server: '', invite: text }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return undefined
  }

  const hashQuery = url.hash.match(/^#\/?connect\?(.*)$/)
  if (hashQuery) {
    const params = new URLSearchParams(hashQuery[1])
    const server = params.get('server')
    if (!server) return undefined
    const invite = params.get('invite') ?? undefined
    const code = params.get('code') ?? undefined
    return { server: normalizeServerUrl(server), ...(invite ? { invite } : {}), ...(code ? { code } : {}) }
  }

  const invitePage = url.pathname.match(/\/invite\/([A-Za-z0-9_-]{16,})\/?$/)
  if (invitePage) return { server: normalizeServerUrl(url.origin), invite: invitePage[1] }

  return { server: normalizeServerUrl(url.origin + (url.pathname === '/' ? '' : url.pathname)) }
}

export function normalizeServerUrl(value: string): string {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`
  return withScheme.replace(/\/+$/, '')
}

// The link that appears in the app's own QR codes: it opens this app and lands on
// the connect screen. Mirrors connectLink() in the server protocol.
export function connectLinkFor(appUrl: string, serverUrl: string, secret: string): string {
  const params = new URLSearchParams({ server: serverUrl, invite: secret })
  return `${appUrl.replace(/\/+$/, '')}/#/connect?${params.toString()}`
}

// A friendly default device name from the user agent. It is only a label.
export function defaultDeviceName(userAgent: string, platform = ''): string {
  const ua = userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (platform === 'MacIntel' && /Mobile/.test(ua))) return 'iPad'
  if (/Android/.test(ua)) return `Android · ${browser}`
  if (/Macintosh|Mac OS X/.test(ua)) return `Mac · ${browser}`
  if (/Windows/.test(ua)) return `Windows · ${browser}`
  if (/CrOS/.test(ua)) return `Chromebook · ${browser}`
  if (/Linux/.test(ua)) return `Linux · ${browser}`
  return browser
}
