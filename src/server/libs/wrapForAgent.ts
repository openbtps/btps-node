/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_UNSUPPORTED_ENCRYPT } from '@core/error/constant.js';
import { decryptRSA, encryptRSA } from '@core/crypto/index.js';
import type { BTPDecryptionKey } from '@core/crypto/types.js';
import type { BTPAgentKey, BTPTransporterArtifact } from '@core/server/types.js';
import type { BTPTrustRecord } from '@core/trust/types.js';
import { base64ToPem } from '@core/utils/index.js';

/**
 * Since 1.2: an encrypted artifact's content key, unwrapped with the identity's
 * key and wrapped again to one of its devices, for a query result's `agentKey`.
 * The artifact is untouched. It always wraps to the key the device's record
 * holds now, and names that key's fingerprint, so a device that has not
 * finished moving to a new key can tell the wrap is not for the key it holds.
 * @param artifact - The encrypted transporter artifact, as received
 * @param identityKey - The identity's own key: a PEM private key, or a Decrypter with `unwrapKey`
 * @param device - The device's record (its trust record)
 */
export const wrapForAgent = async (
  artifact: Pick<BTPTransporterArtifact, 'encryption'>,
  identityKey: BTPDecryptionKey,
  device: Pick<BTPTrustRecord, 'publicKeyBase64' | 'publicKeyFingerprint'>,
): Promise<BTPAgentKey> => {
  const encryptedKey = artifact.encryption?.encryptedKey;
  if (!encryptedKey) {
    throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
      cause: 'Only an encrypted artifact has a content key to wrap for a device',
    });
  }
  const wrapped = Buffer.from(encryptedKey, 'base64');
  let contentKey: Buffer;
  if (typeof identityKey === 'string') {
    contentKey = decryptRSA(identityKey, wrapped);
  } else if (identityKey.unwrapKey) {
    contentKey = Buffer.from(await identityKey.unwrapKey(wrapped));
  } else {
    throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
      cause: 'The Decrypter has no unwrapKey, so it cannot wrap a content key for a device',
    });
  }
  return {
    key: encryptRSA(base64ToPem(device.publicKeyBase64), contentKey).toString('base64'),
    fingerprint: device.publicKeyFingerprint,
    wrappedAt: new Date().toISOString(),
  };
};
