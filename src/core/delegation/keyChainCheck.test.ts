/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: a signing key checked against its identity's key chain, as a
 * server checks a sender's, a delegator's and an attestor's on arrival.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { resolveTxt } from 'dns/promises';
import {
  checkedSignatureKey,
  verifyTransporterSignature,
  type BTPKeyChainCheck,
} from './verifyTransporterSignature.js';
import { keyChainRecordHash, signKeyExpiry, signKeyRotation } from '../trust/keyRotation.js';
import { getFingerprintFromPem, signBtpPayload } from '../crypto/index.js';
import { pemToBase64 } from '../utils/index.js';
import {
  BTP_ERROR_KEY_RETIRED,
  BTP_ERROR_KEY_REVOKED,
  BTP_ERROR_RESOLVE_PUBKEY,
} from '../error/constant.js';
import type { BTPKeyChainLookup, BTPKeyChainRecord } from '../trust/types.js';
import type { BTPTransporterArtifact } from '../server/types.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));
const dns = vi.mocked(resolveTxt);

const ME = 'billing$vendor.example';
const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const [k1, k2, k3] = [keyPair(), keyPair(), keyPair()];
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** DNS as a domain publishes it: its host record's `s=`, and its identities' keys by selector. */
const publish = (selector: string, keys: Record<string, string>) =>
  dns.mockImplementation(async (name: string) => {
    if (name === '_btps.host.vendor.example') {
      return [[`v=1.2.0; u=btps.vendor.example:3443; s=${selector}; op=admin$vendor.example`]];
    }
    const at = /^(.+)\._btps\.identity\.billing\.vendor\.example$/.exec(name)?.[1];
    if (at && keys[at]) return [[`v=1.2.0; k=rsa; p=${pemToBase64(keys[at])}`]];
    throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
  });

const chainOf = (lookup: BTPKeyChainLookup, grace = 3600): BTPKeyChainCheck => ({
  resolveKeyChain: async () => lookup,
  retiredKeyGraceSeconds: grace,
});
const found = (records: BTPKeyChainRecord[]): BTPKeyChainLookup => ({ status: 'chain', records });

const rotated = (at: string, immediate = false) => {
  const rotation = { identity: ME, from: { selector: 'btps1' }, to: { selector: 'btps2' }, at };
  return signKeyRotation(
    immediate
      ? {
          ...rotation,
          prev: null,
          expiry: 'immediate',
          compromisedSince: at,
          reason: 'compromised',
        }
      : { ...rotation, prev: null },
    { from: { pemFiles: k1 }, to: { pemFiles: k2 } },
  );
};
const fingerprintOf = (keys: { publicKey: string }) => getFingerprintFromPem(keys.publicKey);

const check = (selector: string, keyChains?: BTPKeyChainCheck) =>
  checkedSignatureKey(ME, selector, undefined, keyChains);

beforeEach(() => {
  dns.mockReset();
  publish('btps2', { btps1: k1.publicKey, btps2: k2.publicKey });
});

describe("a signing key, checked against its identity's key chain", () => {
  it('is the DNS key, as in 1.1, without a chain to be had or with an empty one', async () => {
    for (const keyChains of [
      undefined,
      chainOf({ status: 'unavailable', reason: 'a 1.1 host' }),
      chainOf(found([])),
    ]) {
      const { key, error } = await check('btps1', keyChains);
      expect(error).toBeUndefined();
      expect(key).toContain(pemToBase64(k1.publicKey).slice(0, 40));
    }
  });

  it('is refused when the host gave an answer that fails its checks', async () => {
    const { error } = await check(
      'btps1',
      chainOf({ status: 'invalid', reason: 'a stale answer' }),
    );
    expect(error?.code).toBe(BTP_ERROR_RESOLVE_PUBKEY.code);
    expect(String(error?.cause)).toContain('a stale answer');
  });

  it("is the chain's current key, and a retired key within its grace", async () => {
    const chain = chainOf(found([await rotated(minutesAgo(10))]), 3600);
    expect((await check('btps2', chain)).key).toBe(k2.publicKey.trim());
    expect((await check('btps1', chain)).key).toBe(k1.publicKey.trim());
  });

  it('refuses a key retired longer ago than the grace, though DNS still has it', async () => {
    const { error } = await check('btps1', chainOf(found([await rotated(minutesAgo(10))]), 60));
    expect(error?.code).toBe(BTP_ERROR_KEY_RETIRED.code);
  });

  it('refuses an expired key with no grace: rotated with immediate expiry, or by an expiry record', async () => {
    const immediate = await rotated(minutesAgo(1), true);
    expect((await check('btps1', chainOf(found([immediate]), 3600))).error?.code).toBe(
      BTP_ERROR_KEY_REVOKED.code,
    );

    const planned = await rotated(minutesAgo(10));
    const expiry = await signKeyExpiry(
      {
        identity: ME,
        key: { selector: 'btps1', fingerprint: fingerprintOf(k1) },
        compromisedSince: minutesAgo(30),
        reason: 'compromised',
        at: minutesAgo(1),
        prev: keyChainRecordHash(planned),
      },
      { pemFiles: k2 },
    );
    expect((await check('btps1', chainOf(found([planned, expiry]), 3600))).error?.code).toBe(
      BTP_ERROR_KEY_REVOKED.code,
    );
  });

  it('refuses a chain that does not end at a key DNS publishes for the identity', async () => {
    // The host's chain ends at btps2; DNS has only the identity's real key, k3, at s=.
    publish('btps3', { btps3: k3.publicKey });
    const { error } = await check('btps2', chainOf(found([await rotated(minutesAgo(10))])));
    expect(error?.code).toBe(BTP_ERROR_RESOLVE_PUBKEY.code);
    expect(String(error?.cause)).toContain('not the key DNS publishes');
  });

  it('anchors a host-only identity on the operator, when DNS has no key for it at all', async () => {
    publish('btps2', {});
    expect((await check('btps2', chainOf(found([await rotated(minutesAgo(10))])))).key).toBe(
      k2.publicKey.trim(),
    );
  });

  it('never takes a DNS failure for host-only: it refuses', async () => {
    dns.mockRejectedValue(Object.assign(new Error('queryTxt ETIMEOUT'), { code: 'ETIMEOUT' }));
    const { key, error } = await check('btps2', chainOf(found([await rotated(minutesAgo(10))])));
    expect(key).toBeUndefined();
    expect(error?.code).toBe(BTP_ERROR_RESOLVE_PUBKEY.code);
    expect(String(error?.cause)).toContain("could not read billing$vendor.example's keys in DNS");
  });

  it('finds the same key under a later selector, and refuses a selector that names no key of the chain', async () => {
    // The domain moved s= to btps5, and re-published the current key under it.
    publish('btps5', { btps5: k2.publicKey });
    const chain = chainOf(found([await rotated(minutesAgo(10))]));
    expect((await check('btps5', chain)).key).toBe(k2.publicKey.trim());

    publish('btps2', { btps2: k2.publicKey, btps7: k3.publicKey });
    expect(String((await check('btps7', chain)).error?.cause)).toContain('names no key');
    expect(String((await check('btps8', chain)).error?.cause)).toContain('names no key');
  });

  it('refuses a chain with a record dated in the future', async () => {
    const ahead = new Date(Date.now() + 3600_000).toISOString();
    const { error } = await check('btps2', chainOf(found([await rotated(ahead)])));
    expect(String(error?.cause)).toContain('dated in the future');
  });
});

describe('an arriving artifact, checked against its sender’s key chain', () => {
  it("is refused when it is signed by the sender's retired key", async () => {
    const unsigned = {
      version: '1.2.0',
      id: 'a-1',
      issuedAt: new Date().toISOString(),
      type: 'BTPS_DOC' as const,
      from: ME,
      to: 'pay$client.example',
      selector: 'btps1',
      document: 'opaque',
      encryption: null,
    };
    const artifact = {
      ...unsigned,
      signature: signBtpPayload(unsigned, k1),
    } as BTPTransporterArtifact;
    const chain = chainOf(found([await rotated(minutesAgo(10))]), 60);

    const { isValid, error } = await verifyTransporterSignature(artifact, undefined, chain);

    expect(isValid).toBe(false);
    expect(error?.code).toBe(BTP_ERROR_KEY_RETIRED.code);
  });
});
