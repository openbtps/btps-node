/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: content-key side-cars, so a provider can delete an old private
 * key. A signed artifact is never changed: its signature covers
 * `encryption.encryptedKey`. Instead, the content key is wrapped to the new
 * key and kept beside the artifact, outside its signature, and
 * decryptVerify opens the artifact with it (its `contentKey`).
 */

import crypto from 'crypto';
import { BTPErrorException } from '@core/error/index.js';
import {
  BTP_ERROR_DECRYPTION_UNINTENDED,
  BTP_ERROR_UNSUPPORTED_ENCRYPT,
} from '@core/error/constant.js';
import type { BTPTransporterArtifact } from '@core/server/types.js';
import { decryptRSA, encryptRSA, getFingerprintFromPem } from './index.js';
import type { BTPDecryptionKey } from './types.js';

/** Since 1.2: an artifact's content key, wrapped to another key, kept beside the artifact. */
export type BTPContentKeySidecar = {
  /** The content key, RSA-OAEP-wrapped to the key with this fingerprint, base64 */
  encryptedKey: string;
  /** The SHA-256 fingerprint of the key it is wrapped to, base64 */
  recipientFingerprint: string;
};

type Encrypted = Pick<BTPTransporterArtifact, 'encryption' | 'document'>;

const encryptionOf = (artifact: Encrypted) => {
  const { encryption, document } = artifact;
  if (!encryption?.encryptedKey || typeof document !== 'string') {
    throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
      cause: 'Only an encrypted artifact has a content key',
    });
  }
  if (encryption.algorithm !== 'aes-256-gcm') {
    throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT);
  }
  return { ...encryption, document };
};

const unwrap = async (encryptedKey: string, key: BTPDecryptionKey): Promise<Buffer> => {
  const wrapped = Buffer.from(encryptedKey, 'base64');
  if (typeof key === 'string') return decryptRSA(key, wrapped);
  if (key.unwrapKey) return Buffer.from(await key.unwrapKey(wrapped));
  throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
    cause: 'The Decrypter has no unwrapKey, so it cannot give the content key',
  });
};

/** Whether `contentKey` opens the artifact's document: its AES-GCM tag checks. */
const opens = (contentKey: Buffer, artifact: Encrypted) => {
  const { iv, authTag, document } = encryptionOf(artifact);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    decipher.update(Buffer.from(document, 'base64'));
    decipher.final();
    return true;
  } catch {
    return false;
  }
};

/**
 * Since 1.2: the artifact's content key, unwrapped with the key it was
 * wrapped to (`oldKey`, a PEM private key or a Decrypter with `unwrapKey`),
 * checked to open the document, and wrapped to `newPublicKey` (SPKI PEM). The
 * artifact itself is not changed. Keep the side-car beside it, and confirm it
 * with `contentKeyOpens` before deleting the old private key.
 */
export const wrapContentKeyFor = async (
  artifact: Encrypted,
  oldKey: BTPDecryptionKey,
  newPublicKey: string,
): Promise<BTPContentKeySidecar> => {
  const contentKey = await unwrap(encryptionOf(artifact).encryptedKey, oldKey);
  if (!opens(contentKey, artifact)) {
    throw new BTPErrorException(BTP_ERROR_DECRYPTION_UNINTENDED, {
      cause: "The old key's content key does not open the document",
    });
  }
  return {
    encryptedKey: encryptRSA(newPublicKey, contentKey).toString('base64'),
    recipientFingerprint: getFingerprintFromPem(newPublicKey),
  };
};

/**
 * Since 1.2: whether a side-car opens its artifact with `newKey`: the content
 * key unwraps, and the document's AES-GCM tag checks. Only when every stored
 * artifact wrapped to an old key has a side-car that opens may that old
 * private key be deleted.
 */
export const contentKeyOpens = async (
  artifact: Encrypted,
  sidecar: BTPContentKeySidecar,
  newKey: BTPDecryptionKey,
): Promise<boolean> => {
  try {
    return opens(await unwrap(sidecar.encryptedKey, newKey), artifact);
  } catch {
    return false;
  }
};
