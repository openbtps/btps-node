/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { ConnectionOptions } from 'tls';
import { resolvePublicKey } from '@core/utils/index.js';

/** What a key is looked up for: checking a signature, or encrypting to a receiver. */
export type BTPKeyUse = 'verify' | 'encrypt';

/**
 * Since 1.2: finds the public keys BTPS checks and encrypts with, so a
 * provider can put its own cache in front of every lookup. Given as the
 * `keyResolver` option of BtpsServer, BtpsClient (and so BtpsAgent and
 * BtpsTransporter), BtpsDelegator, and signEncrypt's `lookup`. It only finds
 * keys: every signature, time window and delegation rule stays inside BTPS.
 */
export interface BtpsKeyResolver {
  /** The PEM public key of `identity` at `selector`, or undefined when there is none. */
  resolvePublicKey(identity: string, selector: string, use: BTPKeyUse): Promise<string | undefined>;
}

/**
 * Since 1.2: the lookup BTPS does without a resolver, to wrap with a cache. A
 * signature key is looked up in DNS only. A receiver's key is looked up in DNS
 * first, then from the receiver's host, in an answer its domain's operator
 * signed; that needs `from`, the sender's own identity, and the TLS options
 * for the connection. Without `from`, an encryption key is looked up in DNS only.
 */
export const createDefaultKeyResolver = (options?: {
  from?: string;
  btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>;
}): BtpsKeyResolver => ({
  async resolvePublicKey(identity, selector, use) {
    const inDns = await resolvePublicKey(identity, selector);
    if (inDns || use === 'verify' || !options?.from) return inDns;
    // Loaded only when DNS has no key, so the core does not depend on the client.
    const { BtpsClient } = await import('../../client/btpsClient.js');
    const client = new BtpsClient({
      to: identity,
      btpMtsOptions: options.btpMtsOptions,
      maxRetries: 0,
    });
    try {
      return (await client.resolveIdentity(identity, options.from)).response?.publicKey;
    } finally {
      client.destroy();
    }
  },
});
