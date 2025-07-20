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
  SignatureAlgorithmType,
} from './types.js';

import {
  BTP_ERROR_UNSUPPORTED_ENCRYPT,
  BTP_ERROR_DECRYPTION_UNINTENDED,
  BTP_ERROR_SIG_MISMATCH,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_UNKNOWN,
} from '@core/error/constant.js';

import { BTPErrorException } from '@core/error/index.js';

export * from './decryptVerify.js';
export * from './signEncrypt.js';
export * from './keygen.js';
export * from './types.js';

export const encryptBtpPayload = (
  payload: unknown = '',
  receiverPubPem: string,
  options: BTPCryptoOptions['encryption'] = {
    algorithm: 'aes-256-cbc',
    mode: 'standardEncrypt',
  },
) => {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const algorithm: EncryptionAlgorithmType = options.algorithm;
  const stringifiedPayload = typeof payload !== 'string' ? JSON.stringify(payload) : payload;

  const cipher = crypto.createCipheriv(algorithm, aesKey, iv);
  let encryptedPayload = cipher.update(stringifiedPayload, 'utf8', 'base64');
  encryptedPayload += cipher.final('base64');

  const encryptedKey = encryptRSA(receiverPubPem, aesKey);

  return {
    data: encryptedPayload,
    encryption: {
      algorithm,
      encryptedKey: encryptedKey.toString('base64'),
      iv: iv.toString('base64'),
      type: options.mode,
    },
  };
};

export const decryptBtpPayload = <T = unknown>(
  payload: unknown = '',
  encryption: BTPEncryption,
  receiverPrivPem: string,
): { data?: T; error?: BTPErrorException } => {
  if (encryption.algorithm !== 'aes-256-cbc') {
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

    const stringifiedPayload = typeof payload !== 'string' ? JSON.stringify(payload) : payload;

    let decryptedPayload = decipher.update(stringifiedPayload, 'base64', 'utf8');
    decryptedPayload += decipher.final('utf8');

    return {
      data: JSON.parse(decryptedPayload),
      error: undefined,
    };
  } catch (err: unknown) {
    const errorRes = {
      data: undefined,
      error: new BTPErrorException(BTP_ERROR_UNKNOWN),
    };
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ERR_OSSL_RSA_OAEP_DECODING_ERROR'
    ) {
      errorRes.error = new BTPErrorException(BTP_ERROR_DECRYPTION_UNINTENDED);
      return errorRes;
    }

    const error =
      err instanceof Error
        ? new BTPErrorException({ message: err.message, code: err.name })
        : new BTPErrorException(BTP_ERROR_UNKNOWN);
    errorRes.error = error;
    return errorRes;
  }
};

/**
 * Encrypts a buffer using RSA public key with OAEP and SHA-1
 */
export const encryptRSA = (publicKeyPem: string, data: Buffer): Buffer => {
  return crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha1',
    },
    data,
  );
};

/**
 * Decrypts an RSA-encrypted buffer using a private key with OAEP and SHA-1
 */
export const decryptRSA = (privateKeyPem: string, encrypted: Buffer): Buffer => {
  return crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha1',
    },
    encrypted,
  );
};

export const getFingerprintFromPem = (
  pem: string,
  algorithm: SignatureAlgorithmType = 'sha256',
): string => {
  const keyObj = crypto.createPublicKey({
    key: pem,
    format: 'pem',
    type: 'spki',
  });

  const der = keyObj.export({ format: 'der', type: 'spki' }); // binary key
  return crypto.createHash(algorithm).update(der).digest('base64');
};

export const signBtpPayload = (payload: unknown = '', senderPemFiles: PemKeys): BTPSignature => {
  const stringifiedPayload = typeof payload !== 'string' ? JSON.stringify(payload) : payload;
  const { publicKey, privateKey } = senderPemFiles;
  const algorithm: SignatureAlgorithmType = 'sha256';

  const hash = crypto.createHash(algorithm).update(stringifiedPayload).digest();
  const signature = crypto.sign(null, hash, privateKey);
  const senderFingerprint = getFingerprintFromPem(publicKey, 'sha256');

  return {
    algorithm: algorithm,
    value: signature.toString('base64'),
    fingerprint: senderFingerprint,
  };
};

export const verifySignature = (
  payload: unknown = '',
  signature: BTPSignature,
  senderPubKey: string,
): { isValid: boolean; error?: BTPErrorException } => {
  const stringifiedPayload = typeof payload !== 'string' ? JSON.stringify(payload) : payload;

  let senderFingerprint;
  try {
    senderFingerprint = getFingerprintFromPem(senderPubKey, signature.algorithm);
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

  const hash = crypto.createHash('sha256').update(stringifiedPayload).digest();
  const isValid = crypto.verify(null, hash, senderPubKey, Buffer.from(signature.value, 'base64'));
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
