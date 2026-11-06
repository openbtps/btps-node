/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: a trust request with permissions, composed for its receiver's
 * version. A 1.1 server knows no permissions, so the request goes as 1.1
 * allows, automatically and never silently: what was left out is reported.
 */

import type { ConnectionOptions } from 'tls';
import { BTP_ERROR_VERSION_UNSUPPORTED } from '@core/error/constant.js';
import { BTPErrorException } from '@core/error/index.js';
import { artifactVersion, isVersionBelow } from '@core/server/constants/index.js';
import type { BTPShaped, BTPShapedField } from '@core/server/types.js';

const ENVELOPE_FIELDS = ['permissions', 'given', 'entityType', 'change'] as const;
const DOCUMENT_FIELDS = ['own', 'verification'] as const;

type Payload = { type?: string; document?: unknown; [key: string]: unknown };

/**
 * Since 1.2: a trust request as a 1.1 receiver allows, and what it left out:
 * the permissions on its envelope and the values in its document that stamp
 * it 1.2.0. 1.1's own fields (name, email, phone, ...) stay.
 */
export const shapeTrustRequestFor11 = <T extends Payload>(
  payload: T,
): { payload: T; shaped: BTPShaped } => {
  const leftOut: BTPShapedField[] = [];
  const shapedPayload: Payload = { ...payload };
  for (const field of ENVELOPE_FIELDS) {
    if (shapedPayload[field] === undefined) continue;
    delete shapedPayload[field];
    leftOut.push(field);
  }
  if (typeof payload.document === 'object' && payload.document !== null) {
    const document: Record<string, unknown> = { ...(payload.document as Record<string, unknown>) };
    for (const field of DOCUMENT_FIELDS) {
      if (document[field] === undefined) continue;
      delete document[field];
      leftOut.push(field);
    }
    shapedPayload.document = document;
  }
  const sentAs = artifactVersion(shapedPayload);
  if (shapedPayload.version !== undefined) shapedPayload.version = sentAs;
  return { payload: shapedPayload as T, shaped: { sentAs, leftOut } };
};

/** The version the receiver's server speaks, asked with one PING on a connection of its own. */
const receiverVersion = async (
  to: string,
  btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>,
) => {
  const { BtpsClient } = await import('../../client/btpsClient.js');
  const client = new BtpsClient({ to, btpMtsOptions, maxRetries: 0 });
  try {
    return await client.getServerVersion();
  } finally {
    client.destroy();
  }
};

/**
 * Since 1.2: a payload composed for its receiver. Only a `TRUST_REQ` carrying
 * permissions is asked about, so any other send costs no round trip. To a
 * receiver whose server speaks 1.1 it goes as 1.1 allows, reported in
 * `shaped`, or, with `versionFallback: false`, is refused with that version.
 * When the receiver's server cannot be asked, that error is returned and
 * nothing is sent: a version is never guessed.
 */
export const composeTrustRequestFor = async <T extends Payload>(
  to: string,
  payload: T,
  options: {
    versionFallback?: boolean;
    btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>;
  } = {},
): Promise<
  { payload: T; shaped?: BTPShaped; error?: undefined } | { error: BTPErrorException }
> => {
  if (payload.type !== 'TRUST_REQ' || payload.permissions === undefined) return { payload };
  const { version, error } = await receiverVersion(to, options.btpMtsOptions);
  if (error) return { error };
  if (!isVersionBelow(version, '1.2.0')) return { payload };
  if (options.versionFallback === false) {
    return {
      error: new BTPErrorException(BTP_ERROR_VERSION_UNSUPPORTED, {
        cause: `${to}'s server speaks ${version}, which takes no trust permissions, and versionFallback is false`,
        meta: { receiverVersion: version },
      }),
    };
  }
  return shapeTrustRequestFor11(payload);
};
