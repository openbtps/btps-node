import crypto, { constants } from 'crypto';
import {
  AllowedEncryptPayloads,
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

export const decryptBtpPayload = (
  payload: unknown = '',
  encryption: BTPEncryption,
  receiverPrivPem: string,
): { data?: AllowedEncryptPayloads; error?: BTPErrorException } => {
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
    console.error('[BTP Error]::[Fingerprint] - getFingerprintFromPem', err.toJSON());
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
