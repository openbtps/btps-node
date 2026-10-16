/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTP_ERROR_VALIDATION } from '@core/error/constant.js';
import { BTPErrorException } from '@core/error/index.js';
import type { Signer } from '../../signer-interface.js';
import type { Decrypter } from '../../decrypter-interface.js';
import { PemSigner } from '../../pem-signer.js';
import { PemDecrypter } from '../../pem-decrypter.js';
import type { BTPDecryptionKey, BTPSigningKey } from './types.js';

/**
 * The SDK signs through a `Signer` and decrypts through a `Decrypter`
 * (BTPS 1.1). A PEM key given where one is expected is wrapped here,
 * so callers that pass PEM keep working; PEM is for tests and the interim.
 */

export const isSigner = (key: unknown): key is Signer =>
  typeof key === 'object' &&
  key !== null &&
  typeof (key as Signer).sign === 'function' &&
  typeof (key as Signer).getPublicKey === 'function';

export const isDecrypter = (key: unknown): key is Decrypter =>
  typeof key === 'object' && key !== null && typeof (key as Decrypter).decrypt === 'function';

/** @throws {BTPErrorException} BTP_ERROR_VALIDATION when neither a Signer nor a PEM key pair is given */
export const toSigner = (key: BTPSigningKey): Signer => {
  if (isSigner(key)) return key;
  if (
    typeof key === 'object' &&
    key !== null &&
    typeof key.privateKey === 'string' &&
    typeof key.publicKey === 'string'
  ) {
    return new PemSigner({ publicKey: key.publicKey, privateKey: key.privateKey });
  }
  throw new BTPErrorException(BTP_ERROR_VALIDATION, {
    cause: 'A Signer, or a PEM key pair { publicKey, privateKey }, is required to sign',
  });
};

/** @throws {BTPErrorException} BTP_ERROR_VALIDATION when neither a Decrypter nor a private key PEM is given */
export const toDecrypter = (key: BTPDecryptionKey): Decrypter => {
  if (isDecrypter(key)) return key;
  if (typeof key === 'string' && key.length > 0) return new PemDecrypter({ privateKey: key });
  throw new BTPErrorException(BTP_ERROR_VALIDATION, {
    cause: 'A Decrypter, or a private key PEM, is required to decrypt',
  });
};
