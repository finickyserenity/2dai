import { bytesToBase64Url } from './encoding'

export interface DeviceKey {
  privateKey: CryptoKey
  publicKey: string
}

// Ed25519 through WebCrypto. The private key is non-extractable: it can be stored
// in IndexedDB and used to sign, but never exported, even by this app's own code.
export async function generateDeviceKey(): Promise<DeviceKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey)
  return { privateKey: pair.privateKey, publicKey: bytesToBase64Url(raw) }
}

export async function signWithDeviceKey(privateKey: CryptoKey, message: string): Promise<string> {
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(message))
  return bytesToBase64Url(signature)
}

export function hasSecureCrypto(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined'
}
