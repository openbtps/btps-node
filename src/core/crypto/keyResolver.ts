/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { ConnectionOptions } from 'tls';
import { resolvePublicKey } from '@core/utils/index.js';
import type { BTPKeyChainLookup } from '@core/trust/types.js';

/** What a key is looked up for: checking a signature, or encrypting to a receiver. */
export type BTPKeyUse = 'verify' | 'encrypt';

/** Since 1.2: the longest a key chain is trusted from a cache, in seconds, unless a server sets `keyChainMaxCacheSeconds`. */
export const DEFAULT_KEY_CHAIN_MAX_CACHE_SECONDS = 300;

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
  /**
   * Since 1.2, optional: `identity`'s key chain, from its host (see
   * `BtpsClient.lookupKeyChain`). A resolver that caches it keeps an answer no
   * longer than the server's `keyChainMaxCacheSeconds`: that is the longest a
   * revoked key can still be taken.
   */
  resolveKeyChain?(identity: string): Promise<BTPKeyChainLookup>;
}

/**
 * Since 1.2: the lookup BTPS does without a resolver, to wrap with a cache. A
 * signature key is looked up in DNS only. A receiver's key is looked up in DNS
 * first, then from the receiver's host, in an answer its domain's operator
 * signed; that needs `from`, the sender's own identity, and the TLS options
 * for the connection. Without `from`, an encryption key is looked up in DNS only.
 *
 * Since 1.2, it also gives an identity's key chain from its host, asking as
 * `from`, and keeps each answer (a chain, or none to be had) for
 * `keyChainMaxCacheSeconds`. An answer that fails its checks is not kept.
 * Without `from`, no chain is to be had.
 */
export const createDefaultKeyResolver = (options?: {
  from?: string;
  btpMtsOptions?: Omit<ConnectionOptions, 'port' | 'host'>;
  keyChainMaxCacheSeconds?: number;
}): BtpsKeyResolver => {
  // Loaded only when needed, so the core does not depend on the client.
  const clientFor = async (identity: string) => {
    const { BtpsClient } = await import('../../client/btpsClient.js');
    return new BtpsClient({ to: identity, btpMtsOptions: options?.btpMtsOptions, maxRetries: 0 });
  };
  const maxAgeMs = (options?.keyChainMaxCacheSeconds ?? DEFAULT_KEY_CHAIN_MAX_CACHE_SECONDS) * 1000;
  const chains = new Map<string, { lookup: BTPKeyChainLookup; until: number }>();
  return {
    async resolvePublicKey(identity, selector, use) {
      const inDns = await resolvePublicKey(identity, selector);
      if (inDns || use === 'verify' || !options?.from) return inDns;
      const client = await clientFor(identity);
      try {
        return (await client.resolveIdentity(identity, options.from)).response?.publicKey;
      } finally {
        client.destroy();
      }
    },
    async resolveKeyChain(identity) {
      if (!options?.from) return { status: 'unavailable', reason: 'no identity to ask as' };
      const key = identity.toLowerCase();
      const cached = chains.get(key);
      if (cached && cached.until > Date.now()) return cached.lookup;
      const client = await clientFor(identity);
      try {
        const lookup = await client.lookupKeyChain(identity, options.from);
        const now = Date.now();
        if (lookup.status === 'invalid') chains.delete(key);
        else chains.set(key, { lookup, until: now + maxAgeMs });
        // Past this many identities, answers whose time has passed are let go.
        if (chains.size > 10_000) {
          for (const [name, kept] of chains) if (kept.until <= now) chains.delete(name);
        }
        return lookup;
      } finally {
        client.destroy();
      }
    },
  };
};
