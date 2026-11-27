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
import type { BTPCosignature, BTPTrustRecord } from '@core/trust/types.js';
import { sameIdentity } from '@core/server/schemas/helpers.js';
import { base64ToPem } from '@core/utils/index.js';

/**
 * Since 1.2: an encrypted artifact's content key, unwrapped with the identity's
 * key and wrapped again to one of its devices, for a query result's `agentKey`.
 * Since 1.2, each cosignature's content key too (`cosignatureKeys`), so
 * the device opens the statements addressed to its identity; an unencrypted
 * artifact with cosignatures gets those alone. The artifact is untouched. It
 * always wraps to the key the device's record holds now, and names that key's
 * fingerprint, so a device that has not finished moving to a new key can tell
 * the wrap is not for the key it holds.
 * @param artifact - The transporter artifact, as received
 * @param identityKey - The identity's own key: a PEM private key, or a Decrypter with `unwrapKey`
 * @param device - The device's record (its trust record)
 * @param identity - Whose cosignature keys are wrapped: the artifact's `to` unless given (its `from`, for a sent one)
 */
export const wrapForAgent = async (
  artifact: Pick<BTPTransporterArtifact, 'encryption' | 'to'> & { cosignatures?: BTPCosignature[] },
  identityKey: BTPDecryptionKey,
  device: Pick<BTPTrustRecord, 'publicKeyBase64' | 'publicKeyFingerprint'>,
  identity: string = artifact.to,
): Promise<BTPAgentKey> => {
  const encryptedKey = artifact.encryption?.encryptedKey;
  const { cosignatures } = artifact;
  if (!encryptedKey && cosignatures === undefined) {
    throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
      cause:
        'Only an encrypted artifact, or one with cosignatures, has a content key to wrap for a device',
    });
  }
  if (typeof identityKey !== 'string' && !identityKey.unwrapKey) {
    throw new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
      cause: 'The Decrypter has no unwrapKey, so it cannot wrap a content key for a device',
    });
  }
  const devicePem = base64ToPem(device.publicKeyBase64);
  const rewrap = async (wrappedKey: string) => {
    const wrapped = Buffer.from(wrappedKey, 'base64');
    const contentKey =
      typeof identityKey === 'string'
        ? decryptRSA(identityKey, wrapped)
        : Buffer.from(await identityKey.unwrapKey!(wrapped));
    return encryptRSA(devicePem, contentKey).toString('base64');
  };
  const cosignatureKeys =
    cosignatures &&
    (await Promise.all(
      cosignatures.map(({ recipients }) => {
        const own = recipients.find((recipient) => sameIdentity(recipient.identity, identity));
        return own === undefined ? null : rewrap(own.wrappedKey);
      }),
    ));
  return {
    ...(encryptedKey && { key: await rewrap(encryptedKey) }),
    ...(cosignatureKeys && { cosignatureKeys }),
    fingerprint: device.publicKeyFingerprint,
    wrappedAt: new Date().toISOString(),
  };
};
