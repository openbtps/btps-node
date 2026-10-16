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
} from '@core/error/constant.js';

import { BTPErrorException } from '@core/error/index.js';
import { assertStrictJson, canonicalize, canonicalizeValue } from './jcs.js';
import type { Signer } from './signer-interface.js';
import type { Decrypter } from './decrypter-interface.js';

export * from './decryptVerify.js';
export * from './jcs.js';
export * from './signEncrypt.js';
export * from './keygen.js';
export * from './types.js';
export * from './signer-interface.js';
export * from './decrypter-interface.js';
export * from './pem-signer.js';
export * from './pem-decrypter.js';

export const encryptBtpPayload = (
  payload: unknown = '',
  receiverPubPem: string,
  options: BTPCryptoOptions['encryption'] = {
    algorithm: 'aes-256-gcm',
    mode: 'standardEncrypt',
  },
) => {
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

export const decryptBtpPayload = <T = unknown>(
  payload: unknown = '',
  encryption: BTPEncryption,
  receiverPrivPem: string,
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

    const decipher = crypto.createDecipheriv(
      encryption.algorithm,
      decryptedKey,
      Buffer.from(encryption.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(encryption.authTag, 'base64'));

    const stringifiedPayload = typeof payload !== 'string' ? JSON.stringify(payload) : payload;

    let decryptedPayload = decipher.update(stringifiedPayload, 'base64', 'utf8');
    decryptedPayload += decipher.final('utf8');
    assertStrictJson(decryptedPayload);

    return {
      data: JSON.parse(decryptedPayload),
      error: undefined,
    };
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

    return {
      data: JSON.parse(decryptedPayload),
      error: undefined,
    };
  } catch (err: unknown) {
    return { data: undefined, error: decryptionError(err) };
  }
};

/** Why a decryption failed, as a BTPErrorException. */
const decryptionError = (err: unknown): BTPErrorException => {
  if (err instanceof BTPErrorException) return err;
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'ERR_OSSL_RSA_OAEP_DECODING_ERROR'
  ) {
    return new BTPErrorException(BTP_ERROR_DECRYPTION_UNINTENDED);
  }
  return err instanceof Error
    ? new BTPErrorException({ message: err.message, code: err.name })
    : new BTPErrorException(BTP_ERROR_UNKNOWN);
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
