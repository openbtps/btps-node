// Shared paths and a fake SDK for this package's own tests.

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize, canonicalizeValue } from '../src/jcs.mjs';

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(PACKAGE_DIR, '../..');
export const VECTORS_DIR = path.join(REPO_ROOT, 'test/vectors');
/** EBA-119's own document-model fixtures (src/schema/, src/document-model/). */
export const DOCUMENT_FIXTURES_DIR = path.join(REPO_ROOT, 'test/fixtures/documents');
export const BIN = path.join(PACKAGE_DIR, 'bin/verify-btps-vectors.mjs');
export const KNOWN_FAILING = path.join(VECTORS_DIR, 'known-failing.json');

const fingerprint = (pem) =>
  crypto
    .createHash('sha256')
    .update(crypto.createPublicKey(pem).export({ format: 'der', type: 'spki' }))
    .digest('base64');

const oaep = (key) => ({
  key,
  padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
  oaepHash: 'sha256',
});

/**
 * A stand-in for an SDK with items 5, 6 and 10 fixed, written only to show
 * that every item check can pass — i.e. none of them is unsatisfiable. It is
 * not a proposal for how EBA-115/116/122 should implement the fixes.
 */
export function createFixedSdkFake() {
  let records = new Map();
  const signedText = (payload) =>
    typeof payload === 'string' ? canonicalize(payload) : canonicalizeValue(payload);

  const parseIdentity = (identity) => {
    const parts = identity.split('$');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { accountName: parts[0], domainName: parts[1] };
  };

  const resolvePublicKey = async (identity, selector) => {
    const { accountName, domainName } = parseIdentity(identity);
    const txt = records.get(`${selector}._btps.identity.${accountName}.${domainName}`)?.[0];
    const b64 = txt?.match(/p=([^;]+)/)?.[1];
    if (!b64) return undefined;
    return `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
  };

  const sdkCrypto = {
    getFingerprintFromPem: (pem) => fingerprint(pem),
    encryptRSA: (pem, data) => crypto.publicEncrypt(oaep(pem), data),
    decryptRSA: (pem, data) => crypto.privateDecrypt(oaep(pem), data),
    signBtpPayload(payload, { publicKey, privateKey }) {
      const value = crypto
        .sign('sha256', Buffer.from(signedText(payload), 'utf8'), privateKey)
        .toString('base64');
      return { algorithmHash: 'sha256', value, fingerprint: fingerprint(publicKey) };
    },
    verifySignature(payload, signature, pem) {
      if (fingerprint(pem) !== signature.fingerprint)
        return { isValid: false, error: new Error('fingerprint') };
      let text;
      try {
        text = signedText(payload);
      } catch (error) {
        return { isValid: false, error };
      }
      const isValid = crypto.verify(
        'sha256',
        Buffer.from(text, 'utf8'),
        pem,
        Buffer.from(signature.value, 'base64'),
      );
      return { isValid, error: isValid ? undefined : new Error('signature') };
    },
    decryptBtpPayload(data, encryption, pem) {
      try {
        const tag = Buffer.from(encryption.authTag, 'base64');
        if (tag.length !== 16) throw new Error('GCM tag must be 16 bytes');
        const key = sdkCrypto.decryptRSA(pem, Buffer.from(encryption.encryptedKey, 'base64'));
        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(encryption.iv, 'base64'),
          {
            authTagLength: 16,
          },
        );
        decipher.setAuthTag(tag);
        const text = decipher.update(data, 'base64', 'utf8') + decipher.final('utf8');
        return { data: JSON.parse(text), error: undefined };
      } catch (error) {
        return { data: undefined, error };
      }
    },
    async signEncrypt(to, sender, payload) {
      const { selector: encryptionSelector, document, ...rest } = payload;
      const receiverPem = await resolvePublicKey(to, encryptionSelector);
      const aesKey = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
      const data = Buffer.concat([
        cipher.update(JSON.stringify(document), 'utf8'),
        cipher.final(),
      ]).toString('base64');
      const unsigned = {
        ...rest,
        id: 'fake-1',
        issuedAt: '2026-01-01T00:00:00.000Z',
        signatureSelector: sender.selector,
        encryptionSelector,
        document: data,
        encryption: {
          algorithm: 'aes-256-gcm',
          encryptedKey: sdkCrypto.encryptRSA(receiverPem, aesKey).toString('base64'),
          iv: iv.toString('base64'),
          authTag: cipher.getAuthTag().toString('base64'),
          type: 'standardEncrypt',
        },
      };
      return {
        payload: { ...unsigned, signature: sdkCrypto.signBtpPayload(unsigned, sender.pemFiles) },
      };
    },
  };

  return {
    crypto: sdkCrypto,
    utils: { parseIdentity, resolvePublicKey },
    setTxtRecords: (entries) => {
      records = new Map(Object.entries(entries));
    },
    root: '(fake)',
  };
}
