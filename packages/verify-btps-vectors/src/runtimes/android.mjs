/**
 * The "Android" runtime driver: EBA-150's addition to buildChecks() so the
 * golden vectors run under an Android-named participant alongside node and
 * web.
 *
 * It re-exports web.mjs's WebCrypto driver under this platform's name
 * rather than duplicating it, because the BTPS 1.1 crypto profile (item 8:
 * Signer/Decrypter behind RSASSA-PKCS1-v1_5/SHA-256 and RSA-OAEP/SHA-256)
 * is expressed here purely in terms of the WebCrypto operations
 * `subtle.sign`/`verify`/`encrypt`/`decrypt`/`digest` — the same surface an
 * Expo Android app calls through (WebCrypto on Hermes/the New
 * Architecture, or a polyfill providing it). Binding those calls to the
 * real Keystore for self-held keys, or to a KMS proxy for managed ones, is
 * the cross-platform core's job (ARCH-05, DEC-012; item 8's
 * Signer/Decrypter interfaces) — a separate, much larger piece of work
 * this test-only ticket does not touch. See mobile-runtimes.test.mjs and
 * the package README for what this driver does and does not prove.
 *
 * PORTABILITY RULE: same as web.mjs — nothing here may import a Node
 * built-in or a third-party package; a test in this package enforces it.
 */

import { createWebRuntime } from './web.mjs';

/**
 * @param {Crypto} [webCrypto] defaults to globalThis.crypto
 * @returns {import('./types.mjs').RuntimeDriver}
 */
export function createAndroidRuntime(webCrypto = globalThis.crypto) {
  return { ...createWebRuntime(webCrypto), name: 'android' };
}
