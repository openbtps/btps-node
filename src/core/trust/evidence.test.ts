/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: an agreement's evidence bundle, built from what its originator
 * holds and checked offline from the bundle alone. The facts for every kind of
 * bundle are in agreements.vectors.json; these cover building one.
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { agreementRef, signAgreement, signStatement, statementRecordSha256 } from './agreements.js';
import { buildEvidenceBundle, describeEvidenceFacts, verifyEvidenceBundle } from './evidence.js';

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const BANK = 'loans$bank.example';
const ALICE = 'alice$client.example';
const keys = { [BANK]: keyPair(), [ALICE]: keyPair() };
const keyOf = (identity: string) => keys[identity as keyof typeof keys]?.publicKey;

const signed = async () => {
  const agreement = await signAgreement(
    {
      type: 'agreement',
      title: 'Phone plan',
      id: 'AGR-7',
      issuedAt: '2026-11-01T00:00:00.000Z',
      body: { format: 'text', content: 'Your plan, for 24 months.' },
      acceptance: {
        terms: [],
        signers: [{ address: ALICE }, { address: BANK }],
        signingOrder: 'sequential',
      },
    },
    { originator: BANK, selector: 'btps1', pemFiles: keys[BANK] },
  );
  const about = agreementRef(agreement, BANK);
  const alice = await signStatement(
    {
      agreement: about,
      terms: [],
      signer: ALICE,
      decision: 'accepted',
      signedAt: '2026-11-02T00:00:00.000Z',
    },
    { selector: 'btps1', pemFiles: keys[ALICE] },
  );
  const bank = await signStatement(
    {
      agreement: about,
      terms: [],
      signer: BANK,
      decision: 'accepted',
      signedAt: '2026-11-03T00:00:00.000Z',
      previous: statementRecordSha256(alice),
    },
    { selector: 'btps1', pemFiles: keys[BANK] },
  );
  return { agreement, statements: [alice, bank] };
};

describe('an evidence bundle', () => {
  it('built from a signed agreement and its answers, checks complete offline', async () => {
    const { agreement, statements } = await signed();
    const bundle = buildEvidenceBundle({ originator: BANK, agreement, statements }, keyOf);

    expect(bundle.keys.map(({ identity }) => identity)).toEqual([BANK, ALICE]);
    const facts = await verifyEvidenceBundle(JSON.parse(JSON.stringify(bundle)));
    expect(facts).toMatchObject({
      originatorSignatureValid: true,
      termsAttached: true,
      complete: true,
    });
  });

  it('is not built without every key it needs', async () => {
    const { agreement, statements } = await signed();
    expect(() =>
      buildEvidenceBundle({ originator: BANK, agreement, statements }, (identity) =>
        identity === BANK ? keyOf(BANK) : undefined,
      ),
    ).toThrow(expect.objectContaining({ code: 'BTP_ERROR_RESOLVE_PUBKEY' }));
  });

  it('ignores a key whose fingerprint is not its own', async () => {
    const { agreement, statements } = await signed();
    const bundle = buildEvidenceBundle({ originator: BANK, agreement, statements }, keyOf);
    const swapped = {
      ...bundle,
      keys: bundle.keys.map((key) =>
        key.identity === ALICE ? { ...key, fingerprint: bundle.keys[0]?.fingerprint ?? '' } : key,
      ),
    };
    const facts = await verifyEvidenceBundle(swapped);
    expect(facts.statements[0]?.signatureValid).toBe(false);
    expect(facts.complete).toBe(false);
  });

  it('is refused when it is not an evidence bundle', async () => {
    await expect(verifyEvidenceBundle({ format: 'btps-evidence/2' })).rejects.toMatchObject({
      code: 'BTP_ERROR_VALIDATION',
    });
  });

  it('reads as plain text, a fact a line, saying what does not hold', async () => {
    const { agreement, statements } = await signed();
    const bundle = buildEvidenceBundle({ originator: BANK, agreement, statements }, keyOf);
    const facts = await verifyEvidenceBundle({ ...bundle, statements: statements.slice(0, 1) });
    const text = describeEvidenceFacts(facts);

    expect(text).toContain(`1. ${ALICE}: accepted (identity)`);
    expect(text).toContain('in order yes');
    expect(text.split('\n').at(-1)).toBe(`${'complete'.padEnd(27)}NO`);
  });

  it('names each key it checked a signature with, and says the keys are the bundle’s own', async () => {
    const { agreement, statements } = await signed();
    const bundle = buildEvidenceBundle({ originator: BANK, agreement, statements }, keyOf);
    const fingerprintOf = (identity: string) =>
      bundle.keys.find((key) => key.identity === identity)?.fingerprint;

    const facts = await verifyEvidenceBundle(bundle);
    const text = describeEvidenceFacts(facts);

    expect(facts.keysConfirmedOnline).toBe(false);
    expect(facts.originatorKey).toEqual({
      identity: BANK,
      selector: 'btps1',
      fingerprint: fingerprintOf(BANK),
    });
    expect(facts.statements[0]?.key).toEqual({
      identity: ALICE,
      selector: 'btps1',
      fingerprint: fingerprintOf(ALICE),
    });
    expect(text).toContain(`${fingerprintOf(ALICE)}`);
    expect(text).toContain('keys from the bundle, not confirmed online');
  });

  it("reads a statement's timestamp too, saying when no roots were given to trust it", async () => {
    const { agreement, statements } = await signed();
    const bundle = buildEvidenceBundle({ originator: BANK, agreement, statements }, keyOf);
    const facts = await verifyEvidenceBundle(bundle);
    const [first, ...rest] = facts.statements;
    const stamped = {
      ...facts,
      statements: [
        {
          ...first!,
          timestamp: {
            imprintMatches: true,
            signatureValid: true,
            time: '2026-11-02T00:05:00.000Z',
            authority: 'CN=Test TSA',
            timestampingKeyUsage: true,
          },
        },
        ...rest,
      ],
    };
    expect(describeEvidenceFacts(stamped)).toContain(
      "timestamped 2026-11-02T00:05:00.000Z by CN=Test TSA: over this statement yes, signed yes, an authority's certificate yes, trusted no roots given",
    );
  });
});
