/**
 * The contract every runtime driver implements. Each vector is run once per
 * driver, so adding iOS or Android means adding a driver, not new vectors.
 *
 * @typedef {object} RuntimeDriver
 * @property {string} name
 * @property {(privateKeyPem: string, bytes: Uint8Array) => Promise<Uint8Array>} signPkcs1Sha256
 * @property {(publicKeyPem: string, bytes: Uint8Array, signature: Uint8Array) => Promise<boolean>} verifyPkcs1Sha256
 * @property {(publicKeyPem: string, keyBytes: Uint8Array) => Promise<Uint8Array>} oaepWrap
 * @property {(privateKeyPem: string, wrapped: Uint8Array) => Promise<Uint8Array>} oaepUnwrap
 * @property {(publicKeyPem: string) => Promise<string>} spkiFingerprint base64 SHA-256 of the SPKI DER
 */

export {};
