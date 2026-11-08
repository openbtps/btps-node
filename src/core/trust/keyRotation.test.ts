/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: key rotation. An identity's keys form a signed chain; these check
 * every rule a verifier applies to it, and the facts it reports.
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import {
  keyAt,
  keyChainProblem,
  keyChainRecordHash,
  signKeyExpiry,
  signKeyRotation,
  verifyKeyChain,
} from './keyRotation.js';
import { PemSigner, getFingerprintFromPem } from '../crypto/index.js';
import type { BTPKeyChainDns, BTPKeyChainRecord } from './types.js';

const ME = 'billing$vendor.example';
const keyPair = (modulusLength = 2048) => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};
const [k1, k2, k3, k4] = [keyPair(), keyPair(), keyPair(), keyPair()];
const fp = (keys: { publicKey: string }) => getFingerprintFromPem(keys.publicKey);
const held = (keys: { publicKey: string; privateKey: string }) => ({ pemFiles: keys });
const at = (day: number) => `2026-11-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const hostOnly = { kind: 'hostOnly' } as const;
const published = (...fingerprints: string[]) => ({ kind: 'published' as const, fingerprints });

const rotate = (
  from: { publicKey: string; privateKey: string },
  fromSelector: string,
  to: { publicKey: string; privateKey: string },
  toSelector: string,
  day: number,
  prev: BTPKeyChainRecord | null,
) =>
  signKeyRotation(
    {
      identity: ME,
      from: { selector: fromSelector },
      to: { selector: toSelector },
      at: at(day),
      prev: prev && keyChainRecordHash(prev),
    },
    { from: held(from), to: held(to) },
  );

/** btps1 → btps2 → btps3, planned. */
const plannedChain = async () => {
  const first = await rotate(k1, 'btps1', k2, 'btps2', 10, null);
  const second = await rotate(k2, 'btps2', k3, 'btps3', 20, first);
  return [first, second];
};

/** Re-signs a record's object with these keys, after a change to it. */
const resigned = async (
  record: BTPKeyChainRecord,
  change: (signed: Record<string, unknown>) => void,
  keys: Partial<Record<'from' | 'to' | 'current', { publicKey: string; privateKey: string }>>,
) => {
  const signed = structuredClone('rotation' in record ? record.rotation : record.expiry);
  change(signed as Record<string, unknown>);
  const { signBtpPayload } = await import('../crypto/index.js');
  const signatures = Object.entries(keys).map(([by, pemFiles]) => ({
    by: by as 'from' | 'to' | 'current',
    ...signBtpPayload(signed, pemFiles!),
  }));
  return ('rotation' in record
    ? { rotation: signed, signatures }
    : { expiry: signed, signatures }) as unknown as BTPKeyChainRecord;
};

const problemOf = (records: unknown[]) => verifyKeyChain(records, { identity: ME }).problem;

describe('a key rotation record', () => {
  it('is signed by the old key and the new one, over a typed object', async () => {
    const [record] = await plannedChain();
    expect(record).toMatchObject({
      rotation: {
        type: 'btps.keyRotation.v1',
        identity: ME,
        from: { selector: 'btps1', fingerprint: fp(k1) },
        to: { selector: 'btps2', fingerprint: fp(k2) },
        expiry: 'planned',
        prev: null,
      },
    });
    expect(record!.signatures.map((s) => s.by)).toEqual(['from', 'to']);
  });

  it('is signed through a Signer as through key files', async () => {
    const record = await signKeyRotation(
      {
        identity: ME,
        from: { selector: 'btps1' },
        to: { selector: 'btps2' },
        at: at(10),
        prev: null,
      },
      { from: { signer: new PemSigner(k1) }, to: { signer: new PemSigner(k2) } },
    );
    expect(verifyKeyChain([record], { identity: ME }).chainValid).toBe(true);
  });

  it('needs the old key for a planned rotation, and a lost key named by its public key', async () => {
    const base = {
      identity: ME,
      from: { selector: 'btps1' },
      to: { selector: 'btps2' },
      at: at(10),
      prev: null,
    };
    await expect(signKeyRotation(base, { to: held(k2) })).rejects.toThrow(/BTPS|valid/i);
    await expect(
      signKeyRotation(
        { ...base, expiry: 'immediate', compromisedSince: at(9), reason: 'lost' },
        { to: held(k2) },
      ),
    ).rejects.toThrow();
  });
});

describe('a verified chain', () => {
  it('gives each key its window, start first', async () => {
    const facts = verifyKeyChain(await plannedChain(), { identity: ME });
    expect(facts).toMatchObject({ chainValid: true, forked: false, authorityUnverified: false });
    expect(facts.keys).toEqual([
      expect.objectContaining({
        selector: 'btps1',
        fingerprint: fp(k1),
        validUntil: at(10),
        rotatedAway: 'planned',
      }),
      expect.objectContaining({ selector: 'btps2', validFrom: at(10), validUntil: at(20) }),
      expect.objectContaining({ selector: 'btps3', validFrom: at(20) }),
    ]);
    expect(facts.keys[0]!.validFrom).toBeUndefined();
    expect(facts.keys[2]!.validUntil).toBeUndefined();
    expect(facts.keys[0]!.publicKey).toBe(k1.publicKey.trim());
  });

  it('finds a key by fingerprint, or by the selector the chain names it under', async () => {
    const facts = verifyKeyChain(await plannedChain(), { identity: ME });
    expect(keyAt(facts, { selector: 'btps2' })?.fingerprint).toBe(fp(k2));
    expect(keyAt(facts, { fingerprint: fp(k3), selector: 'btps9' })?.selector).toBe('btps3');
    expect(keyAt(facts, { selector: 'btps9' })).toBeUndefined();
  });

  it('is empty for an identity that never rotated: its key is the implicit start', () => {
    expect(verifyKeyChain([], { identity: ME })).toEqual({
      chainValid: true,
      authorityUnverified: false,
      forked: false,
      keys: [],
      anchored: false,
    });
    expect(
      keyChainProblem([], { identity: ME, fromOperator: true, dns: published(fp(k1)) }),
    ).toBeUndefined();
  });
});

describe('immediate expiry', () => {
  it('expires the old key from compromisedSince, with or without its signature', async () => {
    const first = await rotate(k1, 'btps1', k2, 'btps2', 10, null);
    const record = await signKeyRotation(
      {
        identity: ME,
        from: { selector: 'btps2' },
        to: { selector: 'btps3' },
        at: at(20),
        prev: keyChainRecordHash(first),
        expiry: 'immediate',
        compromisedSince: at(18),
        reason: 'compromised',
      },
      { from: held(k2), to: held(k3) },
    );
    const facts = verifyKeyChain([first, record], { identity: ME });
    expect(facts.chainValid).toBe(true);
    expect(facts.keys[1]).toMatchObject({
      rotatedAway: 'immediate',
      compromisedSince: at(18),
      reason: 'compromised',
      expiredAt: at(20),
    });
    expect(facts.authorityUnverified).toBe(false);
  });

  it("takes a lost key's rotation on the anchor's authority only", async () => {
    const first = await rotate(k1, 'btps1', k2, 'btps2', 10, null);
    const lost = await signKeyRotation(
      {
        identity: ME,
        from: { selector: 'btps2', publicKey: k2.publicKey },
        to: { selector: 'btps3' },
        at: at(20),
        prev: keyChainRecordHash(first),
        expiry: 'immediate',
        compromisedSince: at(19),
        reason: 'lost',
      },
      { to: held(k3) },
    );
    expect(lost.signatures.map((s) => s.by)).toEqual(['to']);
    const offline = verifyKeyChain([first, lost], { identity: ME, anchors: [fp(k3)] });
    expect(offline).toMatchObject({ chainValid: true, authorityUnverified: true });
    // Online: the operator's answer, and DNS publishing the new key, confirm it.
    const online = verifyKeyChain([first, lost], {
      identity: ME,
      online: { fromOperator: true, dns: published(fp(k3)) },
    });
    expect(online).toMatchObject({
      authorityUnverified: false,
      anchored: { by: 'online', upTo: fp(k3) },
    });
    // A host-only identity: the operator's answer alone.
    const operatorOnly = verifyKeyChain([first, lost], {
      identity: ME,
      online: { fromOperator: true, dns: hostOnly },
    });
    expect(operatorOnly.authorityUnverified).toBe(false);
  });

  it('never confirms a chain for an identity DNS publishes a key for, where DNS has no record of its last key', async () => {
    // A host serving a chain of its own making: a lost-key rotation to its key, and a planned one.
    const first = await rotate(k1, 'btps1', k2, 'btps2', 10, null);
    const lost = await signKeyRotation(
      {
        identity: ME,
        from: { selector: 'btps2', publicKey: k2.publicKey },
        to: { selector: 'btps9' },
        at: at(20),
        prev: keyChainRecordHash(first),
        expiry: 'immediate',
        compromisedSince: at(19),
        reason: 'lost',
      },
      { to: held(k4) },
    );
    const planned = await rotate(k2, 'btps2', k4, 'btps9', 20, first);
    for (const chain of [
      [first, lost],
      [first, planned],
    ]) {
      const nothing = { identity: ME, online: { fromOperator: true, dns: published() } };
      expect(verifyKeyChain(chain, nothing)).toMatchObject({ anchored: false });
      expect(
        keyChainProblem(chain, { identity: ME, fromOperator: true, dns: published() }),
      ).toMatch(/not the key DNS publishes/);
      // The identity's real key, at the domain's s=, is not the chain's last key either.
      expect(
        keyChainProblem(chain, { identity: ME, fromOperator: true, dns: published(fp(k2)) }),
      ).toMatch(/not the key DNS publishes/);
    }
    expect(
      verifyKeyChain([first, lost], {
        identity: ME,
        online: { fromOperator: true, dns: published() },
      }).authorityUnverified,
    ).toBe(true);
  });

  it('marks a past key compromised with an expiry record, voiding nothing on the anchored path', async () => {
    const [first, second] = await plannedChain();
    const expiry = await signKeyExpiry(
      {
        identity: ME,
        key: { selector: 'btps1', fingerprint: fp(k1) },
        compromisedSince: at(5),
        reason: 'compromised',
        at: at(25),
        prev: keyChainRecordHash(second!),
      },
      held(k3),
    );
    const facts = verifyKeyChain([first, second, expiry], { identity: ME, anchors: [fp(k3)] });
    expect(facts.chainValid).toBe(true);
    // btps1 signed the rotation to btps2 after its compromisedSince; on the path, it stands.
    expect(facts.keys.map((k) => k.fingerprint)).toEqual([fp(k1), fp(k2), fp(k3)]);
    expect(facts.keys[0]).toMatchObject({
      compromisedSince: at(5),
      expiredAt: at(25),
      rotatedAway: 'planned',
    });
  });

  it("refuses an expiry that is not the current key's, or of a key that is not a past one", async () => {
    const [first, second] = await plannedChain();
    const expire = (
      key: { publicKey: string },
      selector: string,
      signer: { publicKey: string; privateKey: string },
    ) =>
      signKeyExpiry(
        {
          identity: ME,
          key: { selector, fingerprint: fp(key) },
          compromisedSince: at(5),
          reason: 'compromised',
          at: at(25),
          prev: keyChainRecordHash(second!),
        },
        held(signer),
      );
    expect(problemOf([first, second, await expire(k1, 'btps1', k2)])).toMatch(
      /current key does not sign/,
    );
    expect(problemOf([first, second, await expire(k3, 'btps3', k3)])).toMatch(/not a past key/);
    expect(problemOf([first, second, await expire(k4, 'btps4', k3)])).toMatch(/not a past key/);
    // An expiry names a key under a selector the chain names it under, never another.
    for (const selector of ['btps2', 'btps7']) {
      expect(problemOf([first, second, await expire(k1, selector, k3)])).toMatch(
        new RegExp(`never names that key under selector ${selector}`),
      );
    }
    const once = await expire(k1, 'btps1', k3);
    const twice = await signKeyExpiry(
      {
        identity: ME,
        key: { selector: 'btps1', fingerprint: fp(k1) },
        compromisedSince: at(6),
        reason: 'lost',
        at: at(26),
        prev: keyChainRecordHash(once),
      },
      held(k3),
    );
    expect(problemOf([first, second, once, twice])).toMatch(/already expired/);
  });

  it('names a key under the later selector it was published under, as the chain names it', async () => {
    // btps1's key, re-published under btps5 when the domain moved, rotates away from there.
    const first = await rotate(k1, 'btps1', k2, 'btps2', 10, null);
    const moved = await rotate(k2, 'btps5', k3, 'btps6', 20, first);
    const expiry = (selector: string) =>
      signKeyExpiry(
        {
          identity: ME,
          key: { selector, fingerprint: fp(k2) },
          compromisedSince: at(15),
          reason: 'compromised',
          at: at(25),
          prev: keyChainRecordHash(moved),
        },
        held(k3),
      );
    for (const selector of ['btps2', 'btps5']) {
      expect(
        verifyKeyChain([first, moved, await expiry(selector)], { identity: ME }).chainValid,
      ).toBe(true);
    }
    expect(problemOf([first, moved, await expiry('btps6')])).toMatch(/never names that key/);
  });
});

describe('the chain rules', () => {
  it('refuse a record without the new key, or signed by a key it does not name', async () => {
    const [first] = await plannedChain();
    expect(problemOf([await resigned(first!, () => {}, { from: k1 })])).toMatch(
      /new key does not sign/,
    );
    expect(problemOf([await resigned(first!, () => {}, { from: k4, to: k2 })])).toMatch(
      /old key does not sign/,
    );
    expect(problemOf([await resigned(first!, () => {}, { to: k2, current: k1 })])).toMatch(
      /from and to keys only/,
    );
    // A third signature is more than a record carries.
    expect(
      problemOf([await resigned(first!, () => {}, { from: k1, to: k2, current: k1 })]),
    ).toMatch(/not a key chain/);
  });

  it("refuse a stated fingerprint that is not the key's, so one key never has two", async () => {
    const [first] = await plannedChain();
    const wrong = await resigned(
      first!,
      (r) => ((r.to as { fingerprint: string }).fingerprint = fp(k4)),
      {
        from: k1,
        to: k2,
      },
    );
    expect(problemOf([wrong])).toMatch(/to fingerprint is not its key's/);
  });

  it('refuse a key that is not the exact DER of an RSA key of 2048 bits or more', async () => {
    const small = keyPair(1024);
    const record = await rotate(k1, 'btps1', small, 'btps2', 10, null);
    expect(problemOf([record])).toMatch(/to key is not the DER SPKI/);
    const ec = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const [first] = await plannedChain();
    const swap = (publicKey: string) =>
      resigned(first!, (r) => Object.assign(r.to as object, { publicKey }), { from: k1, to: k2 });
    const { pemToBase64 } = await import('../utils/index.js');
    expect(problemOf([await swap(pemToBase64(ec.publicKey))])).toMatch(
      /to key is not the DER SPKI/,
    );
    expect(problemOf([await swap('AAAA')])).toMatch(/to key is not the DER SPKI/);
  });

  it('refuse an expiry declared before the compromise it names', async () => {
    const [first, second] = await plannedChain();
    const expiry = await signKeyExpiry(
      {
        identity: ME,
        key: { selector: 'btps1', fingerprint: fp(k1) },
        compromisedSince: at(26),
        reason: 'compromised',
        at: at(25),
        prev: keyChainRecordHash(second!),
      },
      held(k3),
    );
    expect(problemOf([first, second, expiry])).toMatch(/compromisedSince is after its at/);
    const unsigned = await resigned(expiry, () => {}, { from: k3 });
    expect(problemOf([first, second, unsigned])).toMatch(/signed by the current key only/);
  });

  it("refuse another identity's record, a wrong type, and a self-rotation", async () => {
    const [first] = await plannedChain();
    expect(verifyKeyChain([first], { identity: 'other$vendor.example' }).problem).toMatch(
      /not other/,
    );
    const typed = await resigned(first!, (r) => (r.type = 'btps.keyRotation.v2'), {
      from: k1,
      to: k2,
    });
    expect(problemOf([typed])).toMatch(/not a key chain/);
    const self = await rotate(k1, 'btps1', k1, 'btps2', 10, null);
    expect(problemOf([self])).toMatch(/to itself/);
  });

  it('refuse a key signing twice, and compromisedSince after at', async () => {
    const [first] = await plannedChain();
    const twice = { ...first!, signatures: [first!.signatures[1]!, first!.signatures[1]!] };
    expect(problemOf([twice])).toMatch(/signs it twice/);
    const late = await resigned(
      first!,
      (r) => Object.assign(r, { expiry: 'immediate', compromisedSince: at(11), reason: 'lost' }),
      { from: k1, to: k2 },
    );
    expect(problemOf([late])).toMatch(/compromisedSince is after its at/);
  });

  it('refuse broken links, a second first record, and records out of order', async () => {
    const [first, second] = await plannedChain();
    const unlinked = await resigned(second!, (r) => (r.prev = 'f'.repeat(64)), {
      from: k2,
      to: k3,
    });
    expect(problemOf([first, unlinked])).toMatch(/prev names no record/);
    const another = await rotate(k3, 'btps3', k4, 'btps4', 30, null);
    expect(problemOf([first, another])).toMatch(/exactly one first record/);
    expect(problemOf([first, first])).toMatch(/appears twice/);
    const early = await rotate(k2, 'btps2', k3, 'btps3', 5, first!);
    expect(problemOf([first, early])).toMatch(/not later than/);
    // Listed in any order, a chain is read by its links.
    expect(verifyKeyChain([second, first], { identity: ME }).chainValid).toBe(true);
  });

  it('refuse A → B → A, a rotation from a key that is not current, and a reused selector', async () => {
    const [first, second] = await plannedChain();
    const back = await rotate(k3, 'btps3', k1, 'btps4', 30, second!);
    expect(problemOf([first, second, back])).toMatch(/already a key of the chain/);
    const stale = await rotate(k1, 'btps1', k4, 'btps4', 30, second!);
    expect(problemOf([first, second, stale])).toMatch(/not the current one/);
    const reused = await rotate(k3, 'btps3', k4, 'btps1', 30, second!);
    expect(problemOf([first, second, reused])).toMatch(/selector btps1 names two keys/);
    const renamed = await rotate(k3, 'btps2', k4, 'btps4', 30, second!);
    expect(problemOf([first, second, renamed])).toMatch(/selector btps2 names two keys/);
  });

  it('refuse what is not a key chain, or one longer than the limit', async () => {
    expect(problemOf([{ rotation: {} }])).toMatch(/not a key chain/);
    const [first] = await plannedChain();
    expect(problemOf(Array.from({ length: 101 }, () => first))).toMatch(/at most 100/);
  });
});

describe('forks and anchors', () => {
  // The owner: btps1 → btps2 → btps3 (immediate, btps2 compromised from day 15).
  // A thief holding btps2: btps2 → btps4 on day 16.
  const forkedChain = async (thiefDay = 16) => {
    const first = await rotate(k1, 'btps1', k2, 'btps2', 10, null);
    const owner = await signKeyRotation(
      {
        identity: ME,
        from: { selector: 'btps2' },
        to: { selector: 'btps3' },
        at: at(20),
        prev: keyChainRecordHash(first),
        expiry: 'immediate',
        compromisedSince: at(15),
        reason: 'compromised',
      },
      { from: held(k2), to: held(k3) },
    );
    const thief = await rotate(k2, 'btps2', k4, 'btps4', thiefDay, first);
    return [first, owner, thief];
  };

  it('report a fork, and pick no branch without an anchor past it', async () => {
    const facts = verifyKeyChain(await forkedChain(), { identity: ME, anchors: [fp(k1)] });
    expect(facts).toMatchObject({ chainValid: true, forked: true, keys: [], anchored: false });
    expect(facts.branches?.map((b) => b.void)).toEqual([false, false]);
  });

  it("void the thief's branch once the owner's is anchored", async () => {
    const facts = verifyKeyChain(await forkedChain(), {
      identity: ME,
      online: { fromOperator: true, dns: published(fp(k3)) },
    });
    expect(facts.keys.at(-1)?.fingerprint).toBe(fp(k3));
    expect(facts.anchored).toEqual({ by: 'online', upTo: fp(k3) });
    expect(facts.branches).toEqual(
      expect.arrayContaining([
        { tip: fp(k3), void: false },
        { tip: fp(k4), void: true },
      ]),
    );
    // Signed before the compromise, the other branch is not void: only unanchored.
    const early = verifyKeyChain(await forkedChain(12), { identity: ME, anchors: [fp(k3)] });
    expect(early.anchored).toEqual({ by: 'kept-fingerprint', upTo: fp(k3) });
    expect(early.branches?.find((b) => b.tip === fp(k4))?.void).toBe(false);
  });

  it('anchor by a kept fingerprint only up to it', async () => {
    const chain = await plannedChain();
    expect(verifyKeyChain(chain, { identity: ME, anchors: [fp(k1)] }).anchored).toEqual({
      by: 'kept-fingerprint',
      upTo: fp(k1),
    });
    expect(verifyKeyChain(chain, { identity: ME, anchors: [fp(k1), fp(k2)] }).anchored).toEqual({
      by: 'kept-fingerprint',
      upTo: fp(k2),
    });
    expect(verifyKeyChain(chain, { identity: ME, anchors: [fp(k4)] }).anchored).toBe(false);
  });
});

describe('keyChainProblem, online', () => {
  it("takes the operator's chain that ends at the identity's DNS key", async () => {
    const chain = await plannedChain();
    const check = (fromOperator: boolean, dns: BTPKeyChainDns) =>
      keyChainProblem(chain, { identity: ME, fromOperator, dns });
    expect(check(true, published(fp(k3)))).toBeUndefined();
    // At the chain's last selector or the domain's s=: either may be the one DNS has.
    expect(check(true, published(fp(k4), fp(k3)))).toBeUndefined();
    expect(check(true, hostOnly)).toBeUndefined();
    // A truncated chain (or a stale one) does not end at the DNS key.
    expect(check(true, published(fp(k4)))).toMatch(/not the key DNS publishes/);
    expect(check(false, published(fp(k3)))).toMatch(/operator's signed answer/);
  });

  it('refuses a fork, and any invalid chain', async () => {
    const first = await rotate(k1, 'btps1', k2, 'btps2', 10, null);
    const a = await rotate(k2, 'btps2', k3, 'btps3', 20, first);
    const b = await rotate(k2, 'btps2', k4, 'btps4', 21, first);
    const options = { identity: ME, fromOperator: true, dns: published(fp(k3)) };
    expect(keyChainProblem([first, a, b], options)).toMatch(/forks/);
    expect(keyChainProblem([{}], options)).toMatch(/not a key chain/);
  });
});
