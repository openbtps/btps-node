/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import crypto, { constants } from 'crypto';
import {
  BTPCryptoOptions,
  BTPEncryption,
  BTPSignature,
  EncryptionAlgorithmType,
  PemKeys,
  SignatureAlgorithmHash,
} from './types.js';

import {
  BTP_ERROR_UNSUPPORTED_ENCRYPT,
  BTP_ERROR_DECRYPTION_UNINTENDED,
  BTP_ERROR_SIG_MISMATCH,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_UNKNOWN,
  BTP_ERROR_VALIDATION,
} from '@core/error/constant.js';

import { BTPErrorException } from '@core/error/index.js';
import { processBtpDocSchema } from '@core/server/schemas/helpers.js';
import type { BTPArtifactType } from '@core/server/types.js';
import { assertStrictJson, canonicalize, canonicalizeValue } from './jcs.js';
import { assertFullLengthAuthTag } from './pem-decrypter.js';
import type { Signer } from './signer-interface.js';
import type { Decrypter } from './decrypter-interface.js';

export * from './decryptVerify.js';
export * from './jcs.js';
export * from './signEncrypt.js';
export * from './keyResolver.js';
export * from './contentKey.js';
export * from './keygen.js';
export * from './types.js';
export * from './signer-interface.js';
export * from './decrypter-interface.js';
export * from './pem-signer.js';
export * from './pem-decrypter.js';

/**
 * With a document type, a document that is not one of that type (its schema,
 * field limits included), as an error. Without one, nothing is checked.
 */
const documentTypeError = (document: unknown, documentType?: BTPArtifactType) => {
  if (!documentType) return undefined;
  const parsed = processBtpDocSchema(documentType)?.safeParse(document);
  if (!parsed || parsed.success) return undefined;
  return new BTPErrorException(BTP_ERROR_VALIDATION, {
    cause: `Document is not a valid ${documentType} document`,
    meta: { issues: parsed.error.issues },
  });
};

/**
 * Encrypts a document to the receiver's key. Given `documentType`, the
 * document is checked against that type first, and an invalid one throws
 * `BTP_ERROR_VALIDATION`. Without it, nothing is checked: a direct caller
 * validates the document itself. `signEncrypt` and the clients always do.
 */
export const encryptBtpPayload = (
  payload: unknown = '',
  receiverPubPem: string,
  options: BTPCryptoOptions['encryption'] = {
    algorithm: 'aes-256-gcm',
    mode: 'standardEncrypt',
  },
  documentType?: BTPArtifactType,
) => {
  const invalid = documentTypeError(payload, documentType);
  if (invalid) throw invalid;
  const aesKey = crypto.randomBytes(32); // 256-bit AES key
  const iv = crypto.randomBytes(12); // 96-bit IV (recommended for GCM)
  const algorithm: EncryptionAlgorithmType = options.algorithm;
  const stringifiedPayload = typeof payload !== 'string' ? JSON.stringify(payload) : payload;

  const cipher = crypto.createCipheriv(algorithm, aesKey, iv) as crypto.CipherGCM;
  let encryptedPayload = cipher.update(stringifiedPayload, 'utf8', 'base64');
  encryptedPayload += cipher.final('base64');
  const authTag = cipher.getAuthTag(); // 16 bytes by default

  const encryptedKey = encryptRSA(receiverPubPem, aesKey); // RSA-OAEP-wrapped AES key

  return {
    data: encryptedPayload,
    encryption: {
      algorithm,
      encryptedKey: encryptedKey.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      type: options.mode,
    },
  };
};

/**
 * Decrypts a document with the receiver's key. Given `documentType`, the
 * decrypted document is checked against that type, and an invalid one is
 * returned as a `BTP_ERROR_VALIDATION` error. Without it, nothing is checked:
 * a direct caller validates the document itself. `decryptVerify` always does.
 */
export const decryptBtpPayload = <T = unknown>(
  payload: unknown = '',
  encryption: BTPEncryption,
  receiverPrivPem: string,
  documentType?: BTPArtifactType,
): { data?: T; error?: BTPErrorException } => {
  if (encryption.algorithm !== 'aes-256-gcm') {
    return {
      data: undefined,
      error: new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT),
    };
  }

  try {
    const decryptedKey = decryptRSA(
      receiverPrivPem,
      Buffer.from(encryption.encryptedKey, 'base64'),
    );

    // A full 16-byte tag only: a shorter one is a weaker integrity check
    const authTag = Buffer.from(encryption.authTag, 'base64');
    assertFullLengthAuthTag(authTag);
    const decipher = crypto.createDecipheriv(
      encryption.algorithm,
      decryptedKey,
      Buffer.from(encryption.iv, 'base64'),
      { authTagLength: 16 },
    );
    decipher.setAuthTag(authTag);

    const stringifiedPayload = typeof payload !== 'string' ? JSON.stringify(payload) : payload;

    let decryptedPayload = decipher.update(stringifiedPayload, 'base64', 'utf8');
    decryptedPayload += decipher.final('utf8');
    assertStrictJson(decryptedPayload);

    const data = JSON.parse(decryptedPayload);
    const invalid = documentTypeError(data, documentType);
    if (invalid) return { data: undefined, error: invalid };
    return { data, error: undefined };
  } catch (err: unknown) {
    return { data: undefined, error: decryptionError(err) };
  }
};

/**
 * Decrypts like `decryptBtpPayload`, through a Decrypter that holds the
 * receiver's private key elsewhere (a KMS, a device) instead of a PEM key.
 */
export const decryptBtpPayloadWithDecrypter = async <T = unknown>(
  payload: unknown = '',
  encryption: BTPEncryption,
  decrypter: Decrypter,
  documentType?: BTPArtifactType,
): Promise<{ data?: T; error?: BTPErrorException }> => {
  if (encryption.algorithm !== 'aes-256-gcm') {
    return {
      data: undefined,
      error: new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT),
    };
  }

  try {
    const stringifiedPayload = typeof payload !== 'string' ? JSON.stringify(payload) : payload;
    const plaintext = await decrypter.decrypt({
      encryptedKey: Buffer.from(encryption.encryptedKey, 'base64'),
      iv: Buffer.from(encryption.iv, 'base64'),
      ciphertext: Buffer.from(stringifiedPayload, 'base64'),
      authTag: Buffer.from(encryption.authTag, 'base64'),
    });
    const decryptedPayload = Buffer.from(plaintext).toString('utf8');
    assertStrictJson(decryptedPayload);

    const data = JSON.parse(decryptedPayload);
    const invalid = documentTypeError(data, documentType);
    if (invalid) return { data: undefined, error: invalid };
    return { data, error: undefined };
  } catch (err: unknown) {
    return { data: undefined, error: decryptionError(err) };
  }
};

/**
 * What OpenSSL reports when the AES key was wrapped for another RSA key:
 * usually an OAEP decoding error, but when the wrapped key is larger than
 * this key's modulus (a few percent of key pairs), a data-too-large error.
 */
const WRONG_KEY_CODES = [
  'ERR_OSSL_RSA_OAEP_DECODING_ERROR',
  'ERR_OSSL_RSA_DATA_TOO_LARGE_FOR_MODULUS',
];

/** Why a decryption failed, as a BTPErrorException. */
const decryptionError = (err: unknown): BTPErrorException => {
  if (err instanceof BTPErrorException) return err;
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof err.code === 'string' &&
    WRONG_KEY_CODES.includes(err.code)
  ) {
    return new BTPErrorException(BTP_ERROR_DECRYPTION_UNINTENDED);
  }
  return err instanceof Error
    ? new BTPErrorException({ message: err.message, code: err.name })
    : new BTPErrorException(BTP_ERROR_UNKNOWN);
};

/**
 * Since 1.2: an encrypted payload, or a document to encrypt, a piece at a
 * time, so that neither is ever held whole. The artifact is the one
 * `encryptBtpPayload` writes and `decryptBtpPayload` reads, byte for byte:
 * only how it is read and written changes.
 */
export type BTPPayloadPieces<T> = AsyncIterable<T> | Iterable<T>;

/** What Node's base64 decoder reads; anything else it passes over, and so does the stream. */
const NOT_BASE64 = /[^A-Za-z0-9+/\-_=]/g;
const BASE64_QUANTUM = 4;

/** Base64 text, in pieces of any length, as the bytes it encodes: whole groups of four characters at a time. */
async function* base64Bytes(pieces: BTPPayloadPieces<string>): AsyncGenerator<Buffer> {
  let carried = '';
  for await (const piece of pieces) {
    const text = carried + piece.replace(NOT_BASE64, '');
    const whole = text.length - (text.length % BASE64_QUANTUM);
    carried = text.slice(whole);
    if (whole > 0) yield Buffer.from(text.slice(0, whole), 'base64');
  }
  if (carried !== '') yield Buffer.from(carried, 'base64');
}

/** The payload's plaintext, decrypted with `contentKey` a piece at a time, the tag checked once the last piece is read. */
async function* decryptedPieces(
  payload: BTPPayloadPieces<string>,
  encryption: BTPEncryption,
  contentKey: () => Promise<Buffer>,
): AsyncGenerator<Uint8Array> {
  try {
    if (encryption.algorithm !== 'aes-256-gcm')
      throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT);
    const authTag = Buffer.from(encryption.authTag, 'base64');
    assertFullLengthAuthTag(authTag);
    const decipher = crypto.createDecipheriv(
      encryption.algorithm,
      await contentKey(),
      Buffer.from(encryption.iv, 'base64'),
      { authTagLength: 16 },
    );
    decipher.setAuthTag(authTag);
    for await (const bytes of base64Bytes(payload)) {
      const plaintext = decipher.update(bytes);
      if (plaintext.length > 0) yield plaintext;
    }
    const last = decipher.final();
    if (last.length > 0) yield last;
  } catch (err: unknown) {
    throw decryptionError(err);
  }
}

/**
 * Since 1.2: decrypts like `decryptBtpPayload`, a piece at a time. `payload`
 * is the artifact's base64 payload in pieces of any length; what comes out
 * is its plaintext bytes in pieces, never the whole of it at once.
 *
 * AES-GCM proves a payload whole only at its end: the pieces are not yet
 * proven as they come, and must not be trusted, shown or kept until the
 * iteration has finished without throwing. A payload that was changed, cut
 * short or not encrypted to this key throws the `BTPErrorException`
 * `decryptBtpPayload` would answer with, when the last piece is read. The
 * plaintext is not parsed or checked: that is the caller's, as it reads it.
 */
export const decryptBtpPayloadStream = (
  payload: BTPPayloadPieces<string>,
  encryption: BTPEncryption,
  receiverPrivPem: string,
): AsyncGenerator<Uint8Array> =>
  decryptedPieces(payload, encryption, async () =>
    decryptRSA(receiverPrivPem, Buffer.from(encryption.encryptedKey, 'base64')),
  );

/**
 * Since 1.2: decrypts like `decryptBtpPayloadStream`, through a Decrypter
 * that holds the receiver's private key elsewhere. A Decrypter decrypts a
 * payload whole, so a stream asks it only to unwrap the content key
 * (`unwrapKey`) and decrypts the rest here: one without `unwrapKey` throws
 * `BTP_ERROR_UNSUPPORTED_ENCRYPT`.
 */
export const decryptBtpPayloadStreamWithDecrypter = (
  payload: BTPPayloadPieces<string>,
  encryption: BTPEncryption,
  decrypter: Decrypter,
): AsyncGenerator<Uint8Array> =>
  decryptedPieces(payload, encryption, async () => {
    if (!decrypter.unwrapKey) {
      throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
        cause: 'decrypting a payload a piece at a time needs a Decrypter with unwrapKey',
      });
    }
    return Buffer.from(await decrypter.unwrapKey(Buffer.from(encryption.encryptedKey, 'base64')));
  });

const BASE64_BYTES = 3;
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

/** Text and bytes, in pieces, as UTF-8 bytes: a character split between two text pieces is kept whole. */
async function* utf8Bytes(pieces: BTPPayloadPieces<string | Uint8Array>): AsyncGenerator<Buffer> {
  let carried = '';
  for await (const piece of pieces) {
    if (typeof piece !== 'string') {
      yield Buffer.from(piece);
      continue;
    }
    const text = carried + piece;
    carried = HIGH_SURROGATE.test(text) ? text.slice(-1) : '';
    yield Buffer.from(carried === '' ? text : text.slice(0, -1), 'utf8');
  }
  if (carried !== '') yield Buffer.from(carried, 'utf8');
}

/**
 * Since 1.2: encrypts like `encryptBtpPayload`, a piece at a time.
 * `document` is the document's JSON text (`JSON.stringify` of it, as
 * `encryptBtpPayload` writes it) in pieces of text or bytes. `payload` gives
 * the base64 payload in pieces, to be written as they come; `encryption`,
 * the artifact's `encryption`, is settled once `payload` has been read to
 * its end, since its tag is known only then. Joined, the pieces are the
 * payload `encryptBtpPayload` writes. Nothing is checked against a document
 * type: a whole document is never held here to check, so the caller checks
 * it before.
 */
export const encryptBtpPayloadStream = (
  document: BTPPayloadPieces<string | Uint8Array>,
  receiverPubPem: string,
  options: BTPCryptoOptions['encryption'] = {
    algorithm: 'aes-256-gcm',
    mode: 'standardEncrypt',
  },
): { payload: AsyncGenerator<string>; encryption: Promise<BTPEncryption> } => {
  let settle: (encryption: BTPEncryption) => void = () => undefined;
  let fail: (error: BTPErrorException) => void = () => undefined;
  const encryption = new Promise<BTPEncryption>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  // Settled only by reading `payload`: one never read is never asked for.
  encryption.catch(() => undefined);
  async function* payload(): AsyncGenerator<string> {
    try {
      const algorithm: EncryptionAlgorithmType = options.algorithm;
      const aesKey = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      const encryptedKey = encryptRSA(receiverPubPem, aesKey);
      const cipher = crypto.createCipheriv(algorithm, aesKey, iv) as crypto.CipherGCM;
      let carried = Buffer.alloc(0);
      for await (const bytes of utf8Bytes(document)) {
        const encrypted = Buffer.concat([carried, cipher.update(bytes)]);
        const whole = encrypted.length - (encrypted.length % BASE64_BYTES);
        carried = encrypted.subarray(whole);
        if (whole > 0) yield encrypted.subarray(0, whole).toString('base64');
      }
      const last = Buffer.concat([carried, cipher.final()]);
      if (last.length > 0) yield last.toString('base64');
      settle({
        algorithm,
        encryptedKey: encryptedKey.toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        type: options.mode,
      });
    } catch (err: unknown) {
      const error =
        err instanceof BTPErrorException
          ? err
          : err instanceof Error
            ? new BTPErrorException({ message: err.message, code: err.name })
            : new BTPErrorException(BTP_ERROR_UNKNOWN);
      fail(error);
      throw error;
    }
  }
  return { payload: payload(), encryption };
};

/** The smallest RSA key the SDK encrypts to. */
export const MIN_RSA_KEY_BITS = 2048;

/**
 * Encrypts a buffer using RSA public key with OAEP and SHA-256
 */
export const encryptRSA = (publicKeyPem: string, data: Buffer): Buffer => {
  // Below 2048 bits an RSA key no longer protects what is wrapped for it
  const bits = crypto.createPublicKey(publicKeyPem).asymmetricKeyDetails?.modulusLength ?? 0;
  if (bits < MIN_RSA_KEY_BITS) {
    throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
      cause: `the receiver's RSA key is ${bits} bits; at least ${MIN_RSA_KEY_BITS} are required`,
    });
  }
  return crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    data,
  );
};

/**
 * Decrypts an RSA-encrypted buffer using a private key with OAEP and SHA-256
 */
export const decryptRSA = (privateKeyPem: string, encrypted: Buffer): Buffer => {
  return crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    encrypted,
  );
};

export const getFingerprintFromPem = (pem: string, hashAlgorithm = 'sha256'): string => {
  const normalizedPem = pem.trim();
  if (
    !normalizedPem.startsWith('-----BEGIN PUBLIC KEY-----') ||
    !normalizedPem.endsWith('-----END PUBLIC KEY-----')
  ) {
    throw new BTPErrorException(BTP_ERROR_SIG_MISMATCH, {
      meta: { reason: 'Invalid PEM: Must be a public key in SPKI format' },
    });
  }

  const keyObj = crypto.createPublicKey({
    key: normalizedPem,
    format: 'pem',
    type: 'spki',
  });

  const der = keyObj.export({ format: 'der', type: 'spki' }); // binary key
  return crypto.createHash(hashAlgorithm).update(der).digest('base64');
};

/**
 * Since 1.2: what a sync names of the send it copies (`syncOf`): the sent
 * artifact's id, and the lowercase hex SHA-256 of its RFC 8785 form, signature included.
 */
export const syncOfArtifact = (artifact: { id: string }): { id: string; sha256: string } => ({
  id: artifact.id,
  sha256: crypto.createHash('sha256').update(canonicalizeValue(artifact), 'utf8').digest('hex'),
});

/** The bytes a signature covers: the RFC 8785 canonical form of the payload. */
const signedBytes = (payload: unknown): Buffer =>
  Buffer.from(
    typeof payload === 'string' ? canonicalize(payload) : canonicalizeValue(payload),
    'utf8',
  );

export const signBtpPayload = (payload: unknown = '', senderPemFiles: PemKeys): BTPSignature => {
  const canonicalPayload = signedBytes(payload);
  const { publicKey, privateKey } = senderPemFiles;
  const algorithmHash: SignatureAlgorithmHash = 'sha256';

  const signature = crypto.sign('sha256', canonicalPayload, privateKey);
  const senderFingerprint = getFingerprintFromPem(publicKey, 'sha256');

  return {
    algorithmHash,
    value: signature.toString('base64'),
    fingerprint: senderFingerprint,
  };
};

/**
 * Signs like `signBtpPayload`, through a Signer that holds the sender's
 * private key elsewhere (a KMS, a device) instead of a PEM key pair.
 */
export const signBtpPayloadWithSigner = async (
  payload: unknown = '',
  signer: Signer,
): Promise<BTPSignature> => {
  const signature = await signer.sign(signedBytes(payload));
  const { publicKey } = await signer.getPublicKey();

  return {
    algorithmHash: 'sha256',
    value: Buffer.from(signature).toString('base64'),
    fingerprint: getFingerprintFromPem(publicKey, 'sha256'),
  };
};

export const verifySignature = (
  payload: unknown = '',
  signature: BTPSignature,
  senderPubKey: string,
): { isValid: boolean; error?: BTPErrorException } => {
  let canonicalPayload: Buffer;
  try {
    canonicalPayload = signedBytes(payload);
  } catch (error) {
    // A payload with no canonical form (e.g. a duplicate member) never verifies.
    return {
      isValid: false,
      error:
        error instanceof BTPErrorException
          ? error
          : new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, { cause: error }),
    };
  }

  let senderFingerprint: string | undefined;
  // A sender's published key that is not a public key is refused below as a
  // mismatch, saying why, rather than logged once per artifact it signs.
  let keyProblem: string | undefined;
  try {
    senderFingerprint = getFingerprintFromPem(senderPubKey, signature.algorithmHash);
  } catch (error) {
    const reason = error instanceof BTPErrorException ? error.meta?.reason : undefined;
    keyProblem =
      typeof reason === 'string' ? reason : error instanceof Error ? error.message : String(error);
  }

  if (senderFingerprint !== signature.fingerprint) {
    return {
      isValid: false,
      error: new BTPErrorException(BTP_ERROR_SIG_MISMATCH, {
        meta: {
          expected: senderFingerprint,
          actual: signature.fingerprint,
          ...(keyProblem !== undefined && { reason: keyProblem }),
        },
      }),
    };
  }

  const isValid = crypto.verify(
    signature.algorithmHash,
    canonicalPayload,
    senderPubKey,
    Buffer.from(signature.value, 'base64'),
  );
  return {
    isValid,
    error: isValid
      ? undefined
      : new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
          meta: { reason: 'Signature verification failed despite matching fingerprints' },
        }),
  };
};

export const DEFAULT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // CrockFord Base32, human-friendly

/**
 * Generate a short, high-entropy, user-specific onboarding token.
 * do not use this for long lived token as there are still chances of collision if compares with trillions of global record
 * This token is suitable for copy-paste flows where the SaaS platform
 * validates the token against a short-lived, user-scoped record (e.g. in Redis).
 *
 * @param userIdentity - Unique user identity string (e.g., "alice$btps.com")
 * @param length - Number of characters in the token (8–24, default 12)
 * @param charactersFrom - Optional character set to generate the token from (default: CrockFord Base32)
 * @returns A short, human-friendly, high-entropy token string
 *
 * @throws Error if length is out of bounds
 */
export function generateUserToken(
  userIdentity: string,
  length: number = 12,
  charactersFrom: string = DEFAULT_ALPHABET,
): string {
  if (length < 8 || length > 24) {
    throw new BTPErrorException({ message: 'Token length must be between 8 and 24 characters.' });
  }

  // Every character drawn on its own from the operating system's random source, without bias: 12 characters from
  // the default 32 are 60 bits. The identity and a timestamp add nothing an attacker does not know, so neither is
  // used; `userIdentity` stays in the signature for the callers that pass it.
  let token = '';
  for (let i = 0; i < length; i++) token += charactersFrom[crypto.randomInt(charactersFrom.length)];

  return token.toUpperCase(); // normalize casing
}
