/**
 * Byte, base64 and PEM helpers that run unchanged in Node, browsers and
 * React Native: only atob/btoa, TextEncoder and typed arrays.
 */

const encoder = new TextEncoder();

/** @param {string} text @returns {Uint8Array} UTF-8 bytes */
export function utf8(text) {
  return encoder.encode(text);
}

/** @param {string} b64 @returns {Uint8Array} */
export function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @param {ArrayBuffer | Uint8Array} data @returns {string} */
export function toBase64(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Strip a PEM envelope of the expected label and return the DER bytes.
 *
 * @param {string} pem
 * @param {'PUBLIC KEY' | 'PRIVATE KEY'} label SPKI or PKCS#8
 * @returns {Uint8Array}
 */
export function pemToDer(pem, label) {
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const trimmed = pem.trim();
  if (!trimmed.startsWith(begin) || !trimmed.endsWith(end)) {
    throw new Error(`expected a PEM "${label}" block`);
  }
  return fromBase64(trimmed.slice(begin.length, trimmed.length - end.length).replace(/\s+/g, ''));
}

/** Constant-time is not needed here: this compares test outputs, not secrets. */
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
