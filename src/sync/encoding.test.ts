import { describe, expect, it } from 'vitest'
import { base64UrlToBytes, bytesToBase64Url, connectLinkFor, defaultDeviceName, normalizeServerUrl, parseConnectInput } from './encoding'

describe('base64url', () => {
  it('round-trips bytes without padding', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    const encoded = bytesToBase64Url(bytes)
    expect(encoded).not.toMatch(/[+/=]/)
    expect([...base64UrlToBytes(encoded)]).toEqual([...bytes])
  })
})

describe('parseConnectInput', () => {
  it('reads the app deep link', () => {
    const link = connectLinkFor('https://finickyserenity.github.io/2dai/', 'https://sync.example', 'abc_DEF-123456789012')
    expect(parseConnectInput(link)).toEqual({ server: 'https://sync.example', invite: 'abc_DEF-123456789012' })
  })

  it('reads the server invite page and a bare server address', () => {
    expect(parseConnectInput('https://sync.example/invite/AVg-vaLeBOmZMYKHNQgGsz')).toEqual({ server: 'https://sync.example', invite: 'AVg-vaLeBOmZMYKHNQgGsz' })
    expect(parseConnectInput('sync.example')).toEqual({ server: 'https://sync.example' })
    expect(parseConnectInput('http://192.168.1.20:8787/')).toEqual({ server: 'http://192.168.1.20:8787' })
  })

  it('reads a bare invite secret', () => {
    expect(parseConnectInput('X9YdLfk6fPh2ZnOmvcGxPlhUeAV4XCX_VA2xW28Llok')).toEqual({ server: '', invite: 'X9YdLfk6fPh2ZnOmvcGxPlhUeAV4XCX_VA2xW28Llok' })
  })

  it('reads a six-digit code with or without spacing', () => {
    expect(parseConnectInput('482 917')).toEqual({ server: '', code: '482917' })
    expect(parseConnectInput('482917')).toEqual({ server: '', code: '482917' })
  })

  it('rejects junk', () => {
    expect(parseConnectInput('')).toBeUndefined()
    expect(parseConnectInput('https://')).toBeUndefined()
    expect(parseConnectInput('https://app.example/#/connect?invite=x')).toBeUndefined()
  })

  it('normalizes server urls', () => {
    expect(normalizeServerUrl('sync.example/')).toBe('https://sync.example')
    expect(normalizeServerUrl('http://localhost:8787///')).toBe('http://localhost:8787')
  })
})

describe('defaultDeviceName', () => {
  it('labels common devices', () => {
    expect(defaultDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('iPhone')
    expect(defaultDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')).toBe('Mac · Chrome')
    expect(defaultDeviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36')).toBe('Android · Chrome')
    expect(defaultDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'MacIntel')).toBe('iPad')
  })
})
