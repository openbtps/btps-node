/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: an evidence bundle's key chains and arrivals. A key that signed
 * may later be rotated away, retired from DNS, or expired; the bundle keeps
 * the chain that says so, and the facts report it against when it signed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { resolveTxt } from 'dns/promises';
import fs from 'fs';
import path from 'path';
import { agreementRef, signAgreement, signStatement, statementRecordSha256 } from './agreements.js';
import {
  buildEvidenceBundle,
  describeEvidenceFacts,
  signArrival,
  verifyEvidenceBundle,
  type BTPEvidenceArrival,
  type BTPEvidenceBundle,
  type BTPEvidenceKeyChain,
} from './evidence.js';
import { keyChainRecordHash, signKeyExpiry, signKeyRotation } from './keyRotation.js';
import { getFingerprintFromPem, signBtpPayload } from '../crypto/index.js';
import { pemToBase64 } from '../utils/index.js';
import type { BTPServerResponse } from '../server/types.js';
import type { BTPKeyChainLookup, BTPKeyChainRecord } from './types.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));
const dns = vi.mocked(resolveTxt);
afterEach(() => dns.mockReset());

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const BANK = 'loans$bank.example';
const ALICE = 'alice$client.example';
const OPERATOR = 'admin$client.example';
const [b1, b2, a1, a2, op] = [keyPair(), keyPair(), keyPair(), keyPair(), keyPair()];
const fp = (keys: { publicKey: string }) => getFingerprintFromPem(keys.publicKey);
const at = (day: number, hour = 0) =>
  `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;

/** The keys DNS has now: each identity's current key, and the operator's. */
const dnsNow =
  (current: Record<string, Record<string, string>>) => (identity: string, selector: string) =>
    current[identity]?.[selector];

/** Signed in early October with each party's first key. */
const signed = async () => {
  const agreement = await signAgreement(
    {
      type: 'agreement',
      title: 'Phone plan',
      id: 'AGR-7',
      issuedAt: at(1),
      body: { format: 'text', content: 'Your plan, for 24 months.' },
      acceptance: {
        terms: [],
        signers: [{ address: ALICE }, { address: BANK }],
        signingOrder: 'sequential',
      },
    },
    { originator: BANK, selector: 'btps1', pemFiles: b1 },
  );
  const about = agreementRef(agreement, BANK);
  const alice = await signStatement(
    { agreement: about, terms: [], signer: ALICE, decision: 'accepted', signedAt: at(2) },
    { selector: 'btps1', pemFiles: a1 },
  );
  const bank = await signStatement(
    {
      agreement: about,
      terms: [],
      signer: BANK,
      decision: 'accepted',
      signedAt: at(3),
      previous: statementRecordSha256(alice),
    },
    { selector: 'btps1', pemFiles: b1 },
  );
  return { agreement, statements: [alice, bank] };
};

const planned = (identity: string, from: typeof b1, to: typeof b1, day: number) =>
  signKeyRotation(
    { identity, from: { selector: 'btps1' }, to: { selector: 'btps2' }, at: at(day), prev: null },
    { from: { pemFiles: from }, to: { pemFiles: to } },
  );

/** Alice's first key, compromised from the 1st at noon: declared on the 10th, two ways. */
const expiredChains = async (): Promise<[string, BTPKeyChainRecord[]][]> => {
  const immediate = await signKeyRotation(
    {
      identity: ALICE,
      from: { selector: 'btps1' },
      to: { selector: 'btps2' },
      at: at(10),
      prev: null,
      expiry: 'immediate',
      compromisedSince: at(1, 12),
      reason: 'compromised',
    },
    { from: { pemFiles: a1 }, to: { pemFiles: a2 } },
  );
  const rotation = await planned(ALICE, a1, a2, 5);
  const expiry = await signKeyExpiry(
    {
      identity: ALICE,
      key: { selector: 'btps1', fingerprint: fp(a1) },
      compromisedSince: at(1, 12),
      reason: 'compromised',
      at: at(10),
      prev: keyChainRecordHash(rotation),
    },
    { pemFiles: a2 },
  );
  return [
    ['a rotation with immediate expiry', [immediate]],
    ['an expiry record after a planned rotation', [rotation, expiry]],
  ];
};

const arrivalOf = (
  record: Awaited<ReturnType<typeof signed>>['statements'][number],
  time: string,
) =>
  signArrival(
    {
      statementSha256: statementRecordSha256(record),
      arrivedAt: time,
      receivedBy: BANK,
      selector: 'btps1',
    },
    { pemFiles: b1 },
  );

/** The answer an operator signs to a key chain lookup, kept whole. */
/** Alice loses her first key: only her new one signs its rotation. */
const lostRotation = () =>
  signKeyRotation(
    {
      identity: ALICE,
      from: { selector: 'btps1', publicKey: a1.publicKey },
      to: { selector: 'btps2' },
      at: at(10),
      prev: null,
      expiry: 'immediate',
      compromisedSince: at(10),
      reason: 'lost',
    },
    { to: { pemFiles: a2 } },
  );

const operatorAnswer = (
  identity: string,
  keyChain: BTPKeyChainRecord[],
  signer = op,
): BTPServerResponse => {
  const answer = {
    version: '1.2.0',
    status: { ok: true, code: 200 },
    id: 'answer-1',
    issuedAt: at(11),
    type: 'btps_response' as const,
    reqId: 'lookup-1',
    document: { identity, keyChain, selector: 'btps2', publicKey: a2.publicKey, keyType: 'rsa' },
    signedBy: OPERATOR,
    selector: 'btps1',
  };
  const signature = signBtpPayload(answer, signer);
  return { ...answer, signature } as unknown as BTPServerResponse;
};

const verified = (bundle: object, options?: Parameters<typeof verifyEvidenceBundle>[1]) =>
  verifyEvidenceBundle(JSON.parse(JSON.stringify(bundle)), options);

describe("an evidence bundle's key chains", () => {
  it('shows a key rotated away after it signed, taken from the chain once DNS retired it', async () => {
    const { agreement, statements } = await signed();
    const keyChains: BTPEvidenceKeyChain[] = [
      { identity: BANK, records: [await planned(BANK, b1, b2, 10)] },
    ];
    // DNS has only the bank's new key.
    const keyOf = dnsNow({ [BANK]: { btps2: b2.publicKey }, [ALICE]: { btps1: a1.publicKey } });
    const bundle = buildEvidenceBundle(
      { originator: BANK, agreement, statements, keyChains },
      keyOf,
    );

    expect(bundle.keys.find((k) => k.identity === BANK)?.fingerprint).toBe(fp(b1));
    const facts = await verified(bundle);
    const rotated = {
      chainValid: true,
      keyInChain: true,
      authorityUnverified: false,
      forked: false,
      reachesKey: fp(b2),
      anchored: false,
      rotatedAt: at(10),
      signedInWindow: true,
    };
    expect(facts.complete).toBe(true);
    expect(facts.keysConfirmedOnline).toBe(false);
    expect(facts.originatorKeyChain).toEqual(rotated);
    expect(facts.statements[1]?.keyChain).toEqual(rotated);
    expect(facts.statements[0]?.keyChain).toBeUndefined();

    const anchored = await verified(bundle, { anchors: [fp(b2)] });
    expect(anchored.originatorKeyChain?.anchored).toEqual({ by: 'kept-fingerprint', upTo: fp(b2) });
  });

  it('reports a key in no chain, and a chain whose records are not signed as they say', async () => {
    const { agreement, statements } = await signed();
    const records = [await planned(ALICE, a1, a2, 10)];
    const keyOf = dnsNow({ [BANK]: { btps1: b1.publicKey }, [ALICE]: { btps1: a1.publicKey } });
    const bundle = buildEvidenceBundle(
      { originator: BANK, agreement, statements, keyChains: [{ identity: BANK, records }] },
      keyOf,
    );

    // Alice's chain, filed under the bank: neither its signatures' identity nor the bank's key.
    const facts = await verified(bundle);
    expect(facts.originatorKeyChain).toMatchObject({
      chainValid: false,
      problem: expect.any(String),
      keyInChain: false,
      signedInWindow: false,
    });
  });

  describe.each([0, 1])('a key expired from before it signed, by %s', (which) => {
    it('says so, and that a signed arrival shows it was received before the expiry', async () => {
      const [name, records] = (await expiredChains())[which]!;
      const { agreement, statements } = await signed();
      const arrivals = [await arrivalOf(statements[0]!, at(2, 0))];
      const keyOf = dnsNow({ [BANK]: { btps1: b1.publicKey }, [ALICE]: { btps2: a2.publicKey } });
      const bundle = buildEvidenceBundle(
        {
          originator: BANK,
          agreement,
          statements,
          keyChains: [{ identity: ALICE, records }],
          arrivals,
        },
        keyOf,
      );

      const facts = await verified(bundle);
      expect(facts.statements[0]?.arrival, name).toEqual({
        at: at(2),
        receivedBy: BANK,
        signatureValid: true,
      });
      expect(facts.statements[0]?.keyChain, name).toMatchObject({
        chainValid: true,
        keyInChain: true,
        signedInWindow: false,
        expiredImmediately: { at: at(10), compromisedSince: at(1, 12), reason: 'compromised' },
        disownedAfterTheFact: true,
      });
      // The chain facts decide nothing: complete is about the bundle's consistency.
      expect(facts.complete).toBe(true);

      const text = describeEvidenceFacts(facts);
      expect(text).toContain(`   arrived ${at(2)}, received by ${BANK}, signed yes`);
      expect(text).toContain(
        `      EXPIRED ${at(10)} (compromised), compromised since ${at(1, 12)}`,
      );
      expect(text).toContain('      DISOWNED after the fact');
      expect(text).toContain('      signed while the key was its NO');
    });
  });

  it('takes no time from an arrival whose signature fails, and none before the compromise', async () => {
    const [[, records]] = await expiredChains();
    const { agreement, statements } = await signed();
    const keyOf = dnsNow({ [BANK]: { btps1: b1.publicKey }, [ALICE]: { btps2: a2.publicKey } });
    const build = (arrival: BTPEvidenceArrival) =>
      buildEvidenceBundle(
        {
          originator: BANK,
          agreement,
          statements,
          keyChains: [{ identity: ALICE, records: records! }],
          arrivals: [arrival],
        },
        keyOf,
      );
    const arrival = await arrivalOf(statements[0]!, at(2));

    const forged = await verified(build({ ...arrival, arrivedAt: at(1, 6) }));
    expect(forged.statements[0]?.arrival?.signatureValid).toBe(false);
    expect(forged.statements[0]?.keyChain?.disownedAfterTheFact).toBeUndefined();

    const early = await verified(build(await arrivalOf(statements[0]!, at(1, 6))));
    expect(early.statements[0]?.keyChain?.disownedAfterTheFact).toBe(false);
  });

  it("calls a lost key's rotation unconfirmed, unless an operator key the reader kept answered for it", async () => {
    const lost = await lostRotation();
    const { agreement, statements } = await signed();
    // The bundle holds `operatorKey` as the operator's: whatever its builder put there.
    const bundleFacts = (
      chain: BTPEvidenceKeyChain,
      operatorKey = op.publicKey,
      anchors?: string[],
    ) => {
      const keyOf = dnsNow({
        [BANK]: { btps1: b1.publicKey },
        [ALICE]: { btps2: a2.publicKey },
        [OPERATOR]: { btps1: operatorKey },
      });
      const bundle = buildEvidenceBundle(
        { originator: BANK, agreement, statements, keyChains: [chain] },
        keyOf,
      );
      return verified(bundle, { anchors });
    };
    const factsWith = async (...args: Parameters<typeof bundleFacts>) =>
      (await bundleFacts(...args)).statements[0]?.keyChain;
    const answered = {
      identity: ALICE,
      records: [lost],
      operatorAnswer: operatorAnswer(ALICE, [lost]),
    };

    expect(await factsWith({ identity: ALICE, records: [lost] })).toMatchObject({
      chainValid: true,
      authorityUnverified: true,
      signedInWindow: true,
    });
    // The operator's answer, by a key that is only the bundle's own: present, and confirming nothing.
    const unanchored = await factsWith(answered);
    expect(unanchored).toMatchObject({
      authorityUnverified: true,
      operatorAnswer: {
        signedBy: OPERATOR,
        signatureValid: true,
        answersThisChain: true,
        operatorKeyAnchored: false,
      },
    });
    // The reader kept the operator's real fingerprint: the answer confirms the rotation.
    expect(await factsWith(answered, op.publicKey, [fp(op)])).toMatchObject({
      authorityUnverified: false,
      operatorAnswer: { operatorKeyAnchored: true },
    });
    // A forger's "operator answer", signed with a key it put in the bundle, confirms nothing,
    // whatever the reader kept.
    const forger = keyPair();
    const forged = {
      ...answered,
      operatorAnswer: operatorAnswer(ALICE, [lost], forger),
    };
    expect(await factsWith(forged, forger.publicKey, [fp(op)])).toMatchObject({
      authorityUnverified: true,
      operatorAnswer: { signatureValid: true, operatorKeyAnchored: false },
    });
    // An answer for another chain confirms nothing, though its operator's key is kept.
    const other = { ...answered, operatorAnswer: operatorAnswer(ALICE, []) };
    expect(await factsWith(other, op.publicKey, [fp(op)])).toMatchObject({
      authorityUnverified: true,
      operatorAnswer: { answersThisChain: false, operatorKeyAnchored: true },
    });
    expect(describeEvidenceFacts(await bundleFacts(answered))).toContain(
      `      operator's answer by ${OPERATOR}: signed yes, this chain yes, its key anchored NO`,
    );
  });

  it('is refused when a key chain is not one', async () => {
    const { agreement, statements } = await signed();
    const keyOf = dnsNow({ [BANK]: { btps1: b1.publicKey }, [ALICE]: { btps1: a1.publicKey } });
    const bundle = buildEvidenceBundle({ originator: BANK, agreement, statements }, keyOf);
    await expect(
      verified({ ...bundle, keyChains: [{ identity: ALICE, records: [{ rotation: {} }] }] }),
    ).rejects.toMatchObject({ code: 'BTP_ERROR_VALIDATION' });
  });
});

describe('an evidence bundle checked online', () => {
  /** DNS as each domain publishes it now: its host's `s=`, and its identities' keys. */
  const publish = (keys: Record<string, Record<string, string>>) =>
    dns.mockImplementation(async (name: string) => {
      const host = /^_btps\.host\.(.+)$/.exec(name)?.[1];
      if (host) return [[`v=1.2.0; u=btps.${host}:3443; s=btps2; op=admin$${host}`]];
      const [, selector, account, domain] =
        /^(.+)\._btps\.identity\.([^.]+)\.(.+)$/.exec(name) ?? [];
      const pem = keys[`${account}$${domain}`]?.[selector ?? ''];
      if (pem) return [[`v=1.2.0; k=rsa; p=${pemToBase64(pem)}`]];
      throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
    });
  const online = (chains: Record<string, BTPKeyChainLookup>) => ({
    resolveKeyChain: async (identity: string): Promise<BTPKeyChainLookup> =>
      chains[identity] ?? { status: 'unavailable', reason: 'a 1.1 host' },
    retiredKeyGraceSeconds: 0,
  });
  const bundleOf = async () => {
    const { agreement, statements } = await signed();
    const keyChains = [{ identity: BANK, records: [await planned(BANK, b1, b2, 10)] }];
    const keyOf = dnsNow({ [BANK]: { btps2: b2.publicKey }, [ALICE]: { btps1: a1.publicKey } });
    return {
      bundle: buildEvidenceBundle({ originator: BANK, agreement, statements, keyChains }, keyOf),
      records: keyChains[0]!.records,
    };
  };

  it("confirms each key: by its identity's chain anchored online, or by its DNS key", async () => {
    const { bundle, records } = await bundleOf();
    publish({ [BANK]: { btps2: b2.publicKey }, [ALICE]: { btps1: a1.publicKey } });

    const facts = await verified(bundle, {
      online: online({ [BANK]: { status: 'chain', records } }),
    });
    expect(facts.keysConfirmedOnline).toBe(true);
    expect(facts.originatorKeyChain?.anchored).toEqual({ by: 'online', upTo: fp(b2) });
    expect(describeEvidenceFacts(facts)).toContain('keys confirmed online');
  });

  it('confirms nothing when a DNS key is not the one that signed, or a chain is refused', async () => {
    const { bundle, records } = await bundleOf();
    publish({ [BANK]: { btps2: b2.publicKey }, [ALICE]: { btps1: a2.publicKey } });
    const chained = online({ [BANK]: { status: 'chain', records } });
    expect((await verified(bundle, { online: chained })).keysConfirmedOnline).toBe(false);

    publish({ [BANK]: { btps2: b2.publicKey }, [ALICE]: { btps1: a1.publicKey } });
    const refused = online({ [BANK]: { status: 'invalid', reason: 'a forged answer' } });
    const facts = await verified(bundle, { online: refused });
    expect(facts.keysConfirmedOnline).toBe(false);
    expect(describeEvidenceFacts(facts)).toContain('not confirmed online');
  });

  it('confirms nothing, and still reports the facts, when DNS cannot be read', async () => {
    const { bundle, records } = await bundleOf();
    dns.mockRejectedValue(Object.assign(new Error('queryTxt ETIMEOUT'), { code: 'ETIMEOUT' }));

    const facts = await verified(bundle, {
      online: online({ [BANK]: { status: 'chain', records } }),
    });
    expect(facts.keysConfirmedOnline).toBe(false);
    expect(facts.complete).toBe(true);
  });

  it("confirms a device's attestor's key too, and nothing while DNS lacks it", async () => {
    const { bundles } = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../test/vectors/agreements.vectors.json'),
        'utf8',
      ),
    ) as { bundles: { name: string; bundle: BTPEvidenceBundle }[] };
    const { bundle } = bundles.find((c) => c.name === 'complete-with-a-device-signed-acceptance')!;
    // Its device, attested by an identity whose key no other signature was checked with.
    const ATTESTOR = 'admin$attest.example';
    const attestor = keyPair();
    const attested = structuredClone(bundle);
    attested.statements[0]!.delegatedArtifact!.delegation.attestation = {
      signedBy: ATTESTOR,
      issuedAt: at(2),
      selector: 'btps1',
      // Only which keys are looked up matters here, not whether this signature holds.
      signature: { algorithmHash: 'sha256', value: 'unchecked', fingerprint: fp(attestor) },
    };
    attested.keys.push({
      identity: ATTESTOR,
      selector: 'btps1',
      publicKey: attestor.publicKey,
      fingerprint: fp(attestor),
    });
    const inDns = Object.fromEntries(
      bundle.keys.map(({ identity, publicKey }) => [identity, { btps1: publicKey }]),
    );
    const confirmed = async () =>
      (await verified(attested, { online: online({}) })).keysConfirmedOnline;

    publish(inDns);
    expect(await confirmed()).toBe(false);
    publish({ ...inDns, [ATTESTOR]: { btps1: attestor.publicKey } });
    expect(await confirmed()).toBe(true);
  });

  it("takes an operator's answer for a lost key's rotation once DNS confirms the operator's key", async () => {
    const lost = await lostRotation();
    const { agreement, statements } = await signed();
    const keyOf = dnsNow({
      [BANK]: { btps1: b1.publicKey },
      [ALICE]: { btps2: a2.publicKey },
      [OPERATOR]: { btps1: op.publicKey },
    });
    const keyChains = [
      { identity: ALICE, records: [lost], operatorAnswer: operatorAnswer(ALICE, [lost]) },
    ];
    const bundle = buildEvidenceBundle(
      { originator: BANK, agreement, statements, keyChains },
      keyOf,
    );
    const chainFacts = async () =>
      (await verified(bundle, { online: online({}) })).statements[0]?.keyChain;

    publish({ [OPERATOR]: { btps1: op.publicKey } });
    expect(await chainFacts()).toMatchObject({
      authorityUnverified: false,
      operatorAnswer: { operatorKeyAnchored: true },
    });
    // DNS has another key for the operator: the bundle's is not confirmed.
    publish({ [OPERATOR]: { btps1: keyPair().publicKey } });
    expect(await chainFacts()).toMatchObject({
      authorityUnverified: true,
      operatorAnswer: { operatorKeyAnchored: false },
    });
  });
});
