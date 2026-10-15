/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTP_ERROR_DECRYPTION_UNINTENDED, BTP_ERROR_VALIDATION } from '@core/error/constant.js';
import { BTPErrorException } from '@core/error/index.js';
import { resolvePublicKey } from '@core/utils/index.js';
import type { BTPDecryptionKey, BTPDecryptionKeys } from './types.js';
import type { Decrypter } from '../../decrypter-interface.js';
import { toDecrypter } from './custody.js';

/**
 * Which key an artifact operation uses (BTPS 1.1, item 6). A transporter
 * artifact names two keys apart, so each side rotates its own key on its own:
 *
 * - `signatureSelector`: the `from` identity's key that signed it;
 * - `encryptionSelector`: the `to` identity's key its document was encrypted to.
 */

/**
 * Resolves the sender's public key at the artifact's `signatureSelector`.
 * @returns the PEM, or undefined when the artifact names no selector or none is published there
 */
export const resolveSignatureKey = async (artifact: {
  from: string;
  signatureSelector?: string;
}): Promise<string | undefined> => {
  if (!artifact.signatureSelector) return undefined;
  return resolvePublicKey(artifact.from, artifact.signatureSelector);
};

/**
 * Picks the receiver's key for the artifact's `encryptionSelector`.
 *
 * Given one key (a `Decrypter` or a PEM), the caller has chosen it and it is
 * returned as a `Decrypter`. Given a lookup, the key is the one held at
 * `encryptionSelector`, so a receiver that rotated keeps decrypting what was
 * encrypted to its old key.
 */
export const selectDecryptionKey = async (
  encryptionSelector: unknown,
  keys: BTPDecryptionKeys,
): Promise<
  { decrypter: Decrypter; error?: undefined } | { error: BTPErrorException; decrypter?: undefined }
> => {
  if (typeof keys !== 'function') return asDecrypter(keys);

  if (typeof encryptionSelector !== 'string' || !encryptionSelector) {
    return {
      error: new BTPErrorException(BTP_ERROR_VALIDATION, {
        cause:
          'An encrypted artifact must name the receiver key it was encrypted to (encryptionSelector)',
      }),
    };
  }
  const key = await keys(encryptionSelector);
  if (!key) {
    return {
      error: new BTPErrorException(BTP_ERROR_DECRYPTION_UNINTENDED, {
        cause: `No private key is held for encryptionSelector ${encryptionSelector}`,
        meta: { encryptionSelector },
      }),
    };
  }
  return asDecrypter(key);
};

const asDecrypter = (
  key: BTPDecryptionKey,
):
  | { decrypter: Decrypter; error?: undefined }
  | { error: BTPErrorException; decrypter?: undefined } => {
  try {
    return { decrypter: toDecrypter(key) };
  } catch (error) {
    return { error: error as BTPErrorException };
  }
};
