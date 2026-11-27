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
 * key, to check a signature or to encrypt to, is looked up in DNS first, then,
 * only when DNS has no record for it, from the identity's host, in an answer
 * its domain's operator signed: an identity whose key is not in DNS (as a
 * provider's many hosted addresses are) is found the same way for both. That
 * needs `from`, the asker's own identity, and the TLS options for the
 * connection; without `from`, a key is looked up in DNS only. A DNS failure
 * other than "no such record" is never a reason to ask the host. A signature
 * key from the host must be the one at the selector the signature names.
 *
 * Since 1.2, it also gives an identity's key chain from its host, asking as
 * `from`, and keeps each answer (a chain, or none to be had) for
 * `keyChainMaxCacheSeconds`. An answer that fails its checks is not kept.
 * Without `from`, it has no `resolveKeyChain`, so a server given it still
 * asks for chains itself, as its own identity.
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
  const from = options?.from;
  return {
    async resolvePublicKey(identity, selector, use) {
      const inDns = await resolvePublicKey(identity, selector);
      if (inDns || !from) return inDns;
      const client = await clientFor(identity);
      try {
        if (use === 'encrypt')
          return (await client.resolveIdentity(identity, from)).response?.publicKey;
        // A signature names its key by selector, one made before a rotation the key it was made with: that one is asked for.
        const answer = (await client.resolveIdentity(identity, from, undefined, selector)).response;
        if (!answer?.publicKey || answer.selector !== selector) return undefined;
        return answer.publicKey;
      } finally {
        client.destroy();
      }
    },
    // Without `from`, no chain lookup at all: a server given this resolver asks with its own.
    ...(from && {
      async resolveKeyChain(identity: string): Promise<BTPKeyChainLookup> {
        const key = identity.toLowerCase();
        const cached = chains.get(key);
        if (cached && cached.until > Date.now()) return cached.lookup;
        const client = await clientFor(identity);
        try {
          const lookup = await client.lookupKeyChain(identity, from);
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
    }),
  };
};
