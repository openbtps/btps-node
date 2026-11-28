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
import { isStrictJson, strictJsonCheck } from './strictJson.js';
import { assertFullLengthAuthTag } from './pem-decrypter.js';
import type { Signer } from './signer-interface.js';
import type { Decrypter } from './decrypter-interface.js';

export * from './decryptVerify.js';
export * from './jcs.js';
export * from './signEncrypt.js';
export * from './keyResolver.js';
export * from './contentKey.js';
export type {
  BTPAttachmentLimits,
  BTPAttachingDocumentType,
} from '@core/server/schemas/attachmentLimits.js';
export {
  checkDecryptedDocument,
  checkDocumentToSend,
  type BTPDocumentCheckOptions,
  type BTPDocumentEnvelope,
} from './documentChecks.js';
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
    // Checked a piece at a time first, which builds nothing; what that refuses, asked of assertStrictJson
    // itself, so that it is refused as it always was (strictJson.ts).
    if (!isStrictJson(decryptedPayload)) assertStrictJson(decryptedPayload);

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
    // Checked a piece at a time first, which builds nothing; what that refuses, asked of assertStrictJson
    // itself, so that it is refused as it always was (strictJson.ts).
    if (!isStrictJson(decryptedPayload)) assertStrictJson(decryptedPayload);

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

/** How a payload is decrypted a piece at a time. */
export type BTPDecryptStreamOptions = {
  /**
   * Since 1.2: also hold the plaintext to the strict JSON decryptBtpPayload
   * holds it to, as it is read: JSON, and no member named twice in any object.
   * Text that is not throws BTP_ERROR_CANONICAL_JSON once it is read to its
   * end and proven. Stricter in two ways: a raw control character in a string,
   * and nesting deeper than 1024, are refused too.
   */
  strictJson?: boolean;
};

/** The payload's plaintext, decrypted with `contentKey` a piece at a time, the tag checked once the last piece is read. */
async function* decryptedPieces(
  payload: BTPPayloadPieces<string>,
  encryption: BTPEncryption,
  contentKey: () => Promise<Buffer>,
  options?: BTPDecryptStreamOptions,
): AsyncGenerator<Uint8Array> {
  // The strict JSON check's verdict is had as it goes, and said only once the payload is proven whole.
  const check = options?.strictJson ? strictJsonCheck() : undefined;
  const text = check ? new TextDecoder('utf-8') : undefined;
  let notStrict: unknown;
  const checked = (bytes: Uint8Array, last = false) => {
    if (!check || !text || notStrict !== undefined) return;
    try {
      check.add(text.decode(bytes, { stream: !last }));
      if (last) check.end();
    } catch (error) {
      notStrict = error;
    }
  };
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
      checked(plaintext);
      if (plaintext.length > 0) yield plaintext;
    }
    const last = decipher.final();
    checked(last, true);
    if (last.length > 0) yield last;
  } catch (err: unknown) {
    throw decryptionError(err);
  }
  if (notStrict !== undefined) throw decryptionError(notStrict);
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
  options?: BTPDecryptStreamOptions,
): AsyncGenerator<Uint8Array> =>
  decryptedPieces(
    payload,
    encryption,
    async () => decryptRSA(receiverPrivPem, Buffer.from(encryption.encryptedKey, 'base64')),
    options,
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
  options?: BTPDecryptStreamOptions,
): AsyncGenerator<Uint8Array> =>
  decryptedPieces(
    payload,
    encryption,
    async () => {
      if (!decrypter.unwrapKey) {
        throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
          cause: 'decrypting a payload a piece at a time needs a Decrypter with unwrapKey',
        });
      }
      return Buffer.from(await decrypter.unwrapKey(Buffer.from(encryption.encryptedKey, 'base64')));
    },
    options,
  );

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

/** How much of a large field's text one piece of what is signed holds. */
const SIGNED_PIECE = 1 << 20;
const BASE64_TEXT = /^[A-Za-z0-9+/=]*$/;

/** Text as RFC 8785 writes it inside a string, a piece at a time: as JSON.stringify does, a surrogate pair cut in two kept whole. */
const stringBody = () => {
  let carried = '';
  return {
    add(piece: string): string {
      const text = carried + piece;
      carried = /[\uD800-\uDBFF]$/.test(text) ? text.slice(-1) : '';
      const whole = carried === '' ? text : text.slice(0, -1);
      return BASE64_TEXT.test(whole) ? whole : JSON.stringify(whole).slice(1, -1);
    },
    end: (): string => (carried === '' ? '' : JSON.stringify(carried).slice(1, -1)),
  };
};

/**
 * The RFC 8785 form of `artifact` with its `field` the text its pieces join
 * to, cut where that text goes: what is before it, and what is after it.
 */
const signedAround = (
  artifact: Record<string, unknown>,
  field: string,
): { before: string; after: string } => {
  const word = `btps-signed-${crypto.randomUUID()}`;
  const form = canonicalizeValue({ ...artifact, [field]: word });
  const at = form.indexOf(`"${word}"`);
  if (at < 0 || form.indexOf(`"${word}"`, at + 1) >= 0) {
    throw new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
      cause: `no single ${field} to sign`,
    });
  }
  return { before: form.slice(0, at + 1), after: form.slice(at + 1 + word.length) };
};

/**
 * Since 1.2: what a signature covers of `artifact` with its `field` the text
 * `pieces` join to, a piece at a time: the RFC 8785 form signedBytes gives of
 * the whole, never built whole. Fed to a hash as it comes.
 */
async function* signedPieces(
  artifact: Record<string, unknown>,
  pieces: BTPPayloadPieces<string>,
  field: string,
): AsyncGenerator<string> {
  const { before, after } = signedAround(artifact, field);
  yield before;
  const body = stringBody();
  for await (const piece of pieces) yield body.add(piece);
  yield body.end() + after;
}

/** A payload whose `document` is text, as an encrypted artifact's is: signed a piece at a time, never copied whole. */
const largeDocument = (payload: unknown): string | undefined =>
  typeof payload === 'object' &&
  payload !== null &&
  typeof (payload as { document?: unknown }).document === 'string'
    ? (payload as { document: string }).document
    : undefined;

/** `text` in pieces of SIGNED_PIECE. */
function* piecesOfText(text: string): Generator<string> {
  for (let from = 0; from < text.length; from += SIGNED_PIECE)
    yield text.slice(from, from + SIGNED_PIECE);
}

/** `pieces` fed to `into`, as they come: to a hash, or a signature or check being made. */
const fed = async (
  pieces: AsyncIterable<string>,
  into: { update(text: string, encoding: 'utf8'): unknown },
) => {
  for await (const piece of pieces) into.update(piece, 'utf8');
};

/** As `fed`, of a payload in memory: the same pieces, had at once. */
const fedNow = (
  payload: Record<string, unknown>,
  document: string,
  into: { update(text: string, encoding: 'utf8'): unknown },
) => {
  const { before, after } = signedAround(payload, 'document');
  into.update(before, 'utf8');
  const body = stringBody();
  for (const piece of piecesOfText(document)) into.update(body.add(piece), 'utf8');
  into.update(body.end() + after, 'utf8');
};

export const signBtpPayload = (payload: unknown = '', senderPemFiles: PemKeys): BTPSignature => {
  const { publicKey, privateKey } = senderPemFiles;
  const algorithmHash: SignatureAlgorithmHash = 'sha256';

  // An artifact whose document is text, as an encrypted one's is, is signed a piece at a time: the same
  // signature, without a whole copy of its RFC 8785 form (since 1.2).
  const document = largeDocument(payload);
  let signature: Buffer;
  if (document === undefined) signature = crypto.sign('sha256', signedBytes(payload), privateKey);
  else {
    const signer = crypto.createSign('sha256');
    fedNow(payload as Record<string, unknown>, document, signer);
    signature = signer.sign(privateKey);
  }
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

/** A payload with no canonical form (e.g. a duplicate member), which never verifies. */
const unsignable = (error: unknown) => ({
  isValid: false,
  error:
    error instanceof BTPErrorException
      ? error
      : new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, { cause: error }),
});

export const verifySignature = (
  payload: unknown = '',
  signature: BTPSignature,
  senderPubKey: string,
): { isValid: boolean; error?: BTPErrorException } => {
  // An artifact whose document is text, as an encrypted one's is, is checked a piece at a time: the same
  // check, without a whole copy of its RFC 8785 form (since 1.2).
  const document = largeDocument(payload);
  let canonicalPayload: Buffer | undefined;
  let check: crypto.Verify | undefined;
  try {
    if (document === undefined) canonicalPayload = signedBytes(payload);
    else {
      check = crypto.createVerify(signature.algorithmHash);
      fedNow(payload as Record<string, unknown>, document, check);
    }
  } catch (error) {
    return unsignable(error);
  }
  const mismatch = fingerprintMismatch(signature, senderPubKey);
  if (mismatch) return mismatch;
  const value = Buffer.from(signature.value, 'base64');
  return verified(
    check
      ? check.verify(senderPubKey, value)
      : crypto.verify(
          signature.algorithmHash,
          canonicalPayload ?? Buffer.alloc(0),
          senderPubKey,
          value,
        ),
  );
};

/** A signature whose fingerprint is not that of the sender's key, as BTP_ERROR_SIG_MISMATCH; undefined when it is. */
const fingerprintMismatch = (
  signature: BTPSignature,
  senderPubKey: string,
): { isValid: false; error: BTPErrorException } | undefined => {
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

  if (senderFingerprint === signature.fingerprint) return undefined;
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
};

const verified = (isValid: boolean): { isValid: boolean; error?: BTPErrorException } => ({
  isValid,
  error: isValid
    ? undefined
    : new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
        meta: { reason: 'Signature verification failed despite matching fingerprints' },
      }),
});

/**
 * Since 1.2: signs like `signBtpPayload`, a piece at a time: `artifact` is
 * the artifact to sign without its `document`, and `payload` that document's
 * text in pieces of any length (an encrypted artifact's base64 payload, as
 * encryptBtpPayloadStream gives it). The same signature as
 * `signBtpPayload({ ...artifact, document })`, never holding it whole.
 */
export const signBtpPayloadStream = async (
  artifact: Record<string, unknown>,
  payload: BTPPayloadPieces<string>,
  senderPemFiles: PemKeys,
): Promise<BTPSignature> => {
  const signer = crypto.createSign('sha256');
  await fed(signedPieces(artifact, payload, 'document'), signer);
  return {
    algorithmHash: 'sha256',
    value: signer.sign(senderPemFiles.privateKey).toString('base64'),
    fingerprint: getFingerprintFromPem(senderPemFiles.publicKey, 'sha256'),
  };
};

/**
 * Since 1.2: signs like `signBtpPayloadStream`, through a Signer that holds
 * the sender's private key elsewhere: it is asked to sign the digest of what
 * is signed (`signDigest`). A Signer without `signDigest` throws
 * BTP_ERROR_UNSUPPORTED_ENCRYPT.
 */
export const signBtpPayloadStreamWithSigner = async (
  artifact: Record<string, unknown>,
  payload: BTPPayloadPieces<string>,
  signer: Signer,
): Promise<BTPSignature> => {
  if (!signer.signDigest) {
    throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
      cause: 'signing a payload a piece at a time needs a Signer with signDigest',
    });
  }
  const hash = crypto.createHash('sha256');
  await fed(signedPieces(artifact, payload, 'document'), hash);
  const signature = await signer.signDigest(hash.digest());
  const { publicKey } = await signer.getPublicKey();
  return {
    algorithmHash: 'sha256',
    value: Buffer.from(signature).toString('base64'),
    fingerprint: getFingerprintFromPem(publicKey, 'sha256'),
  };
};

/**
 * Since 1.2: checks a signature like `verifySignature`, a piece at a time:
 * `artifact` without its `document`, and `payload` that document's text in
 * pieces of any length. The same answer as `verifySignature({ ...artifact,
 * document }, signature, senderPubKey)`, never holding it whole.
 */
export const verifySignatureStream = async (
  artifact: Record<string, unknown>,
  payload: BTPPayloadPieces<string>,
  signature: BTPSignature,
  senderPubKey: string,
): Promise<{ isValid: boolean; error?: BTPErrorException }> => {
  const check = crypto.createVerify(signature.algorithmHash);
  try {
    await fed(signedPieces(artifact, payload, 'document'), check);
  } catch (error) {
    return unsignable(error);
  }
  const mismatch = fingerprintMismatch(signature, senderPubKey);
  if (mismatch) return mismatch;
  return verified(check.verify(senderPubKey, Buffer.from(signature.value, 'base64')));
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
