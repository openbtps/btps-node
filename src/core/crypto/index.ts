/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import crypto, { constants, createHash, randomBytes } from 'crypto';
import { performance } from 'perf_hooks';
import {
  BTPCryptoOptions,
  BTPDecryptionKey,
  BTPEncryption,
  BTPSignature,
  BTPSigningKey,
  EncryptionAlgorithmType,
  SignatureAlgorithmHash,
} from './types.js';

import {
  BTP_ERROR_UNSUPPORTED_ENCRYPT,
  BTP_ERROR_DECRYPTION_UNINTENDED,
  BTP_ERROR_SIG_MISMATCH,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_UNKNOWN,
  BTP_ERROR_CANONICAL_JSON,
  BTP_ERROR_VALIDATION,
  BTP_ERROR_KEY_TOO_SMALL,
} from '@core/error/constant.js';

import { BTPErrorException } from '@core/error/index.js';
import { BTP_MIN_RSA_KEY_BITS } from '@core/server/constants/btps-protocol.js';
import { canonicalize, canonicalizeValue } from './jcs.js';
import { isSigner, toDecrypter, toSigner } from './custody.js';

export * from './custody.js';
export * from './decryptVerify.js';
export * from './identityLookup.js';
export * from './jcs.js';
export * from './signEncrypt.js';
export * from './keygen.js';
export * from './keySelection.js';
export * from './types.js';

// Signer and Decrypter (BTPS 1.1, item I): the interfaces the SDK signs and
// decrypts through, and their PEM and KMS implementations.
export type { Signer, SignerAlgorithm, SignerPublicKey } from '../../signer-interface.js';
export type { Decrypter, DecrypterAlgorithm, DecryptRequest } from '../../decrypter-interface.js';
export { PemSigner, type PemSignerOptions } from '../../pem-signer.js';
export {
  KmsSigner,
  KmsSignerError,
  type KmsSignClient,
  type KmsSignerOptions,
} from '../../kms-signer.js';
export { PemDecrypter, type PemDecrypterOptions } from '../../pem-decrypter.js';
export {
  KmsDecrypter,
  KmsDecrypterError,
  type KmsDecryptClient,
  type KmsDecrypterOptions,
} from '../../kms-decrypter.js';

/** An AES-256-GCM tag is 16 bytes; anything shorter is refused (fix list 2, T-26). */
const GCM_TAG_BYTES = 16;

/**
 * Refuses an RSA key shorter than BTP_MIN_RSA_KEY_BITS (fix list 12): for
 * `encryption`, the receiver's public key; for a `signature`, the signer's.
 * `pem` is a public or private key PEM. A key that does not parse is left to
 * the call that uses it, which refuses it in its own way.
 *
 * @throws {BTPErrorException} BTP_ERROR_KEY_TOO_SMALL
 */
export const assertRsaKeySize = (pem: string, use: 'encryption' | 'signature'): void => {
  let key: crypto.KeyObject;
  try {
    key = crypto.createPublicKey(pem);
  } catch {
    return;
  }
  const bits = key.asymmetricKeyDetails?.modulusLength;
  const isRsa = key.asymmetricKeyType === 'rsa' || key.asymmetricKeyType === 'rsa-pss';
  if (isRsa && bits !== undefined && bits < BTP_MIN_RSA_KEY_BITS) {
    throw new BTPErrorException(BTP_ERROR_KEY_TOO_SMALL, {
      cause: `A ${bits}-bit RSA key for ${use}; the minimum is ${BTP_MIN_RSA_KEY_BITS}`,
      meta: { bits, use, minimumBits: BTP_MIN_RSA_KEY_BITS },
    });
  }
};

/** Why a call through a Signer or Decrypter failed, as a BTPErrorException.
 * A KMS failure keeps its `retryable` flag in `meta`. */
const custodyError = (err: unknown): BTPErrorException => {
  if (err instanceof BTPErrorException) return err;
  if (err instanceof Error) {
    const retryable = (err as { retryable?: unknown }).retryable;
    return new BTPErrorException(
      { message: err.message, code: err.name },
      {
        cause: err,
        ...(typeof retryable === 'boolean' ? { meta: { retryable } } : {}),
      },
    );
  }
  return new BTPErrorException(BTP_ERROR_UNKNOWN, { cause: err });
};

export const encryptBtpPayload = (
  payload: unknown = '',
  receiverPubPem: string,
  options: BTPCryptoOptions['encryption'] = {
    algorithm: 'aes-256-gcm',
    mode: 'standardEncrypt',
  },
) => {
  assertRsaKeySize(receiverPubPem, 'encryption');
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
 * Decrypts a document through a `Decrypter`. A private key PEM is wrapped in
 * a `PemDecrypter`; PEM is for tests and the interim only.
 *
 * An auth tag that is not exactly 16 bytes is refused before any key is
 * used (fix list 2, T-26).
 */
export const decryptBtpPayload = async <T = unknown>(
  payload: unknown = '',
  encryption: BTPEncryption,
  receiverKey: BTPDecryptionKey,
): Promise<{ data?: T; error?: BTPErrorException }> => {
  if (encryption.algorithm !== 'aes-256-gcm') {
    return {
      data: undefined,
      error: new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT),
    };
  }

  const authTag = Buffer.from(encryption.authTag ?? '', 'base64');
  if (authTag.length !== GCM_TAG_BYTES) {
    return {
      data: undefined,
      error: new BTPErrorException(BTP_ERROR_VALIDATION, {
        cause: `An AES-256-GCM auth tag must be ${GCM_TAG_BYTES} bytes; this one is ${authTag.length}`,
        meta: { authTagBytes: authTag.length },
      }),
    };
  }

  try {
    const decrypter = toDecrypter(receiverKey);
    const stringifiedPayload = typeof payload !== 'string' ? JSON.stringify(payload) : payload;

    const plaintext = await decrypter.decrypt({
      encryptedKey: Buffer.from(encryption.encryptedKey, 'base64'),
      iv: Buffer.from(encryption.iv, 'base64'),
      ciphertext: Buffer.from(stringifiedPayload, 'base64'),
      authTag,
    });

    return {
      data: JSON.parse(Buffer.from(plaintext).toString('utf8')),
      error: undefined,
    };
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ERR_OSSL_RSA_OAEP_DECODING_ERROR'
    ) {
      return { data: undefined, error: new BTPErrorException(BTP_ERROR_DECRYPTION_UNINTENDED) };
    }
    return { data: undefined, error: custodyError(err) };
  }
};

/**
 * Encrypts a buffer using RSA public key with OAEP and SHA-256
 */
export const encryptRSA = (publicKeyPem: string, data: Buffer): Buffer => {
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
 * The bytes a BTPS signature covers: the RFC 8785 (JCS) form of the payload.
 * A string payload is taken as JSON text and parsed strictly, so duplicate
 * member names are refused; any other value is canonicalised as it would be
 * serialised on the wire.
 *
 * @throws {BTPErrorException} BTP_ERROR_CANONICAL_JSON
 */
const signedBytes = (payload: unknown): Buffer =>
  Buffer.from(
    typeof payload === 'string' ? canonicalize(payload) : canonicalizeValue(payload),
    'utf8',
  );

/**
 * Signs the JCS bytes of a payload through a `Signer`. A PEM key pair is
 * wrapped in a `PemSigner`; PEM is for tests and the interim only.
 *
 * The fingerprint is computed here from the public key the signer reports,
 * as it is for verification.
 *
 * @throws {BTPErrorException} BTP_ERROR_CANONICAL_JSON, BTP_ERROR_VALIDATION,
 * BTP_ERROR_SIG_MISMATCH, or the signer's own failure (a KMS failure keeps
 * `retryable` in `meta`)
 */
export const signBtpPayload = async (
  payload: unknown = '',
  signingKey: BTPSigningKey,
): Promise<BTPSignature> => {
  const canonicalPayload = signedBytes(payload);
  const signer = toSigner(signingKey);
  const algorithmHash: SignatureAlgorithmHash = 'sha256';

  if (signer.algorithm !== 'RSASSA_PKCS1_V1_5_SHA_256') {
    throw new BTPErrorException(BTP_ERROR_VALIDATION, {
      cause: `Unsupported signer algorithm: ${String(signer.algorithm)}`,
    });
  }

  let signature: Uint8Array;
  let publicKey: string;
  try {
    [signature, publicKey] = await Promise.all([
      signer.sign(new Uint8Array(canonicalPayload)),
      isSigner(signingKey)
        ? signer.getPublicKey().then((key) => key.publicKey)
        : Promise.resolve(signingKey.publicKey),
    ]);
  } catch (err) {
    throw custodyError(err);
  }
  // Checked on the key the signer reports, so a KMS key is held to it too.
  assertRsaKeySize(publicKey, 'signature');

  return {
    algorithmHash,
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
    return {
      isValid: false,
      error:
        error instanceof BTPErrorException
          ? error
          : new BTPErrorException(BTP_ERROR_CANONICAL_JSON, { cause: error }),
    };
  }

  try {
    assertRsaKeySize(senderPubKey, 'signature');
  } catch (error) {
    return { isValid: false, error: error as BTPErrorException };
  }

  let senderFingerprint;
  try {
    senderFingerprint = getFingerprintFromPem(senderPubKey, signature.algorithmHash);
  } catch (error) {
    const err =
      error instanceof Error
        ? new BTPErrorException({ code: 500, message: error.message })
        : new BTPErrorException(BTP_ERROR_SIG_MISMATCH);
    console.error('[BTPS Error]::[Fingerprint] - getFingerprintFromPem', err.toJSON());
  }

  if (senderFingerprint !== signature.fingerprint) {
    return {
      isValid: false,
      error: new BTPErrorException(BTP_ERROR_SIG_MISMATCH, {
        meta: {
          expected: senderFingerprint,
          actual: signature.fingerprint,
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

  // Combine identity + high-resolution timestamp + entropy
  const entropyInput = userIdentity + performance.now().toString() + randomBytes(4).toString('hex');

  const hash = createHash('sha256');
  hash.update(entropyInput);
  const digest = hash.digest();

  // Use a safe slice of the digest
  const sliced = new Uint8Array(digest).slice(0, length);

  // Map bytes to characters from the alphabet
  const token = Array.from(sliced)
    .map((byte) => charactersFrom[byte % charactersFrom.length])
    .join('')
    .toUpperCase(); // normalize casing

  return token;
}
