/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { randomUUID } from 'crypto';
import type { ConnectionOptions } from 'tls';
import {
  BTP_ERROR_IDENTITY,
  BTP_ERROR_RESOLVE_PUBKEY,
  BTP_ERROR_VALIDATION,
} from '@core/error/constant.js';
import { processBtpDocSchema } from '@core/server/schemas/helpers.js';
import type { BTPArtifactType } from '@core/server/types.js';
import { signBtpPayload, signBtpPayloadWithSigner, encryptBtpPayload } from './index.js';
import type { Signer } from './signer-interface.js';
import {
  BTPCryptoResponse,
  PemKeys,
  BTPCryptoOptions,
  BTPSignature,
  BTPEncryption,
  BTPCryptoArtifact,
} from './types.js';
import { getHostAndSelector, parseIdentity, resolvePublicKey } from '@core/utils/index.js';
import { ParsedIdentity } from '@core/utils/types.js';
import { BTPErrorException } from '@core/error/index.js';
import isEmpty from 'lodash/isEmpty.js';

const genEncryptError = (error: BTPErrorException) => ({
  payload: undefined,
  error,
});

/** How signEncrypt reaches a receiver's host when DNS has no key for it. */
export type ReceiverKeyLookup = {
  /** TLS options for the connection to the receiver's host */
  btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>;
};

/**
 * A receiver's key as BTPS finds it: in DNS first, then from the receiver's
 * host, in an answer its domain's operator signed. The client is loaded only
 * when DNS has no key, so the core does not depend on it.
 */
const findReceiverKey = async (
  to: string,
  from: string,
  selector: string,
  lookup?: ReceiverKeyLookup,
): Promise<string | undefined> => {
  const inDns = await resolvePublicKey(to, selector);
  if (inDns) return inDns;
  const { BtpsClient } = await import('../../client/btpsClient.js');
  const client = new BtpsClient({ to, btpMtsOptions: lookup?.btpMtsOptions, maxRetries: 0 });
  try {
    return (await client.resolveIdentity(to, from)).response?.publicKey;
  } finally {
    client.destroy();
  }
};

/**
 * Signs an artifact with the sender's key and, when `to` and encryption
 * options are given, encrypts its document to the receiver's current key.
 *
 * `payload.selector` is the sender's own selector: the one its signing key
 * is published at, which the receiver uses to verify the signature. The
 * receiver's key is found at the selector the receiver's own host record
 * names: in DNS, or else from the receiver's host (`lookup` gives the TLS
 * options for that connection).
 */
export const signEncrypt = async <T = unknown>(
  to: string | undefined,
  sender: ParsedIdentity & ({ pemFiles: PemKeys } | { signer: Signer }),
  payload: {
    document: T;
    selector?: string;
    [key: string]: unknown;
  },
  options?: BTPCryptoOptions,
  lookup?: ReceiverKeyLookup,
): Promise<BTPCryptoResponse<T>> => {
  const { document, ...restPayload } = payload;
  let encryption: BTPEncryption | null = null;
  let encryptedDoc: string | T = document;

  if (to && !isEmpty(options?.encryption)) {
    // Once encrypted, no server can read the document, so it is checked here.
    const docSchema = processBtpDocSchema(restPayload.type as BTPArtifactType);
    if (docSchema && !docSchema.safeParse(document).success) {
      return genEncryptError(
        new BTPErrorException(BTP_ERROR_VALIDATION, {
          cause: 'Document type does not match the artifact type',
        }),
      );
    }
    const parsedReceiver = parseIdentity(to);
    if (!parsedReceiver) return genEncryptError(new BTPErrorException(BTP_ERROR_IDENTITY));
    const receiverHost = await getHostAndSelector(to);
    const from = `${sender.accountName}$${sender.domainName}`;
    const receiverPubPem = receiverHost
      ? await findReceiverKey(to, from, receiverHost.selector, lookup)
      : undefined;
    if (!receiverPubPem) return genEncryptError(new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY));

    try {
      const encryptedData = isEmpty(options?.encryption)
        ? { encryption: null, data: encryptedDoc }
        : encryptBtpPayload(encryptedDoc, receiverPubPem, options?.encryption);

      encryption = encryptedData.encryption;
      encryptedDoc = encryptedData.data;
    } catch (error) {
      return genEncryptError(error as BTPErrorException);
    }
  }

  const docToSign: Record<string, unknown> = {
    ...restPayload,
    id: restPayload?.id ?? randomUUID(),
    issuedAt: restPayload?.issuedAt ?? new Date().toISOString(),
    document: encryption ? (encryptedDoc as string) : (document as T),
    encryption: encryption,
  };

  let signature: BTPSignature;
  try {
    signature =
      'signer' in sender
        ? await signBtpPayloadWithSigner(docToSign, sender.signer)
        : signBtpPayload(docToSign, sender.pemFiles);
  } catch (error) {
    return genEncryptError(error as BTPErrorException);
  }

  return {
    payload: {
      ...docToSign,
      signature,
    } as BTPCryptoArtifact<T>,
    error: undefined,
  };
};
