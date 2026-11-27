/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2 (rc.4): a cosignature is encrypted once to every party, then signed over its ciphertext. Every server
 * checks it without decrypting; whoever opens it checks that what it opened is exactly what was signed.
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'crypto';
import { signBtpPayload } from '../crypto/index.js';
import { decryptVerify } from '../crypto/decryptVerify.js';
import { BTP_ERROR_SIG_VERIFICATION } from '../error/constant.js';
import { BtpCosignatureSchema } from '../server/schemas/btpsDocsSchema.js';
import type { BTPTransporterArtifact } from '../server/types.js';
import { cosign, cosignatureSha256, cosignaturesProblem, openCosignature } from './cosignatures.js';
import type { BTPAgreementStatement, BTPCosignature } from './types.js';

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const ACME = 'billing$acme.example';
const BOB = 'bob$x.example';
const CAROL = 'carol$y.example';
const MALLORY = 'mallory$z.example';
const keys: Record<string, ReturnType<typeof keyPair>> = {
  [ACME]: keyPair(),
  [BOB]: keyPair(),
  [CAROL]: keyPair(),
  [MALLORY]: keyPair(),
};
const keyOf = async (identity: string) => keys[identity]?.publicKey;
const parties = [ACME, BOB, CAROL].map((identity) => ({ identity, publicKey: keys[identity]!.publicKey }));
const ref = { originator: ACME, id: 'agr-9', contentSha256: 'a'.repeat(64) };

const statementOf = (signer: string, artifactId: string, more: Partial<BTPAgreementStatement> = {}): BTPAgreementStatement => ({
  agreement: ref,
  terms: [],
  signer,
  artifactId,
  decision: 'accepted',
  signedAt: '2026-12-02T09:59:40.000Z',
  ...more,
});

const cosignBy = (signer: string, artifactId = randomUUID(), more: Partial<BTPAgreementStatement> = {}) =>
  cosign({
    statement: statementOf(signer, artifactId, more),
    recipients: parties,
    by: { selector: 'btps1', pemFiles: keys[signer]! },
  });

/** An event carrying `cosignatures`, from `from`, under the artifact id `id`. */
const event = (from: string, id: string, cosignatures: BTPCosignature[]): BTPTransporterArtifact =>
  ({
    version: '1.2.0',
    type: 'BTPS_EVENT',
    id,
    issuedAt: new Date().toISOString(),
    from,
    to: ACME,
    selector: 'btps1',
    relatesTo: randomUUID(),
    encryption: null,
    document: {},
    signature: { algorithmHash: 'sha256', value: 'c2ln', fingerprint: 'f' },
    cosignatures,
  }) as BTPTransporterArtifact;

describe('a cosignature', () => {
  it('is in its schema, its readable part naming only who, what, and hashes', async () => {
    const bob = await cosignBy(BOB);
    expect(BtpCosignatureSchema.safeParse(bob).success).toBe(true);
    expect(JSON.stringify(bob)).not.toContain('accepted');
    expect(bob.recipients.map(({ identity }) => identity)).toEqual([ACME, BOB, CAROL].sort());
  });

  it("is checked by any server without decrypting: its signer's own answer, then forwarded unchanged", async () => {
    const id = randomUUID();
    const bob = await cosignBy(BOB, id);
    expect(await cosignaturesProblem(event(BOB, id, [bob]), keyOf)).toBeUndefined();
    expect(await cosignaturesProblem(event(ACME, randomUUID(), [bob]), keyOf)).toBeUndefined();
  });

  it('chains: one that names previous follows the one before it in a forward', async () => {
    const bob = await cosignBy(BOB);
    const carol = await cosignBy(CAROL, randomUUID(), { previous: cosignatureSha256(bob) });
    expect(await cosignaturesProblem(event(ACME, randomUUID(), [bob, carol]), keyOf)).toBeUndefined();
    const out = await cosignBy(CAROL, randomUUID(), { previous: 'b'.repeat(64) });
    expect(await cosignaturesProblem(event(ACME, randomUUID(), [bob, out]), keyOf)).toMatch(/follows/);
  });

  it('is refused when altered, or signed by someone else', async () => {
    const id = randomUUID();
    const bob = await cosignBy(BOB, id);
    const altered = { ...bob, statementSha256: 'c'.repeat(64) };
    expect(await cosignaturesProblem(event(BOB, id, [altered]), keyOf)).toMatch(/signed by its signer/);
    const asMallory = { ...bob, signer: MALLORY };
    expect(await cosignaturesProblem(event(ACME, randomUUID(), [asMallory]), keyOf)).toMatch(/signed by its signer/);
  });

  it("is refused when it is not its sender's own, nor its originator's forward, or names another artifact", async () => {
    const bob = await cosignBy(BOB);
    expect(await cosignaturesProblem(event(CAROL, randomUUID(), [bob]), keyOf)).toMatch(/originator/);
    expect(await cosignaturesProblem(event(BOB, randomUUID(), [bob]), keyOf)).toMatch(/artifact that delivers it/);
  });

  it('is one per signer, about one document', async () => {
    const bob = await cosignBy(BOB);
    expect(await cosignaturesProblem(event(ACME, randomUUID(), [bob, bob]), keyOf)).toMatch(/once/);
    const other = await cosign({
      statement: { ...statementOf(CAROL, randomUUID()), agreement: { ...ref, id: 'agr-10' } },
      recipients: parties,
      by: { selector: 'btps1', pemFiles: keys[CAROL]! },
    });
    expect(await cosignaturesProblem(event(ACME, randomUUID(), [bob, other]), keyOf)).toMatch(/one document/);
  });

  it('opens for each recipient to exactly what was signed, and for no one else', async () => {
    const bob = await cosignBy(BOB);
    for (const identity of [ACME, BOB, CAROL]) {
      const opened = await openCosignature(bob, { identity, key: keys[identity]!.privateKey });
      expect(opened && 'statement' in opened && opened.statement.decision).toBe('accepted');
    }
    expect(await openCosignature(bob, { identity: MALLORY, key: keys[MALLORY]!.privateKey })).toBeUndefined();
  });

  it("is refused on opening when copied under another signer's name, or when its key is wrong for you", async () => {
    // Mallory takes Bob's ciphertext into a cosignature of her own: every server takes her signature, but what it
    // opens to is Bob's statement.
    const bob = await cosignBy(BOB);
    const { signature: _signature, ...unsigned } = bob;
    const copied = { ...unsigned, signer: MALLORY };
    const forged = { ...copied, signature: signBtpPayload(copied, keys[MALLORY]!) } as BTPCosignature;
    const opened = await openCosignature(forged, { identity: ACME, key: keys[ACME]!.privateKey });
    expect(opened && 'problem' in opened && opened.problem).toMatch(/another signer/);
    // Wrapped for Carol to a key she cannot open with.
    const wrongForCarol = {
      ...bob,
      recipients: bob.recipients.map((one) => (one.identity === CAROL ? { ...one, wrappedKey: bob.recipients[0]!.wrappedKey } : one)),
    };
    const forCarol = await openCosignature(wrongForCarol, { identity: CAROL, key: keys[CAROL]!.privateKey });
    expect(forCarol && 'problem' in forCarol && forCarol.problem).toMatch(/does not open/);
  });

  it('pads its statement, so an acceptance and a decline are the same length', async () => {
    const accepted = await cosignBy(BOB, randomUUID(), {
      visualSignature: { type: 'typed', text: 'Bob' },
    });
    const declined = await cosignBy(BOB, randomUUID(), { decision: 'declined' });
    expect(accepted.ciphertext.length).toBe(declined.ciphertext.length);
  });
});

describe('decryptVerify and cosignatures', () => {
  /** Bob's answer to Acme, signed as sent: the event names the agreement its cosignature does. */
  const answerFromBob = async (to = ACME) => {
    const id = randomUUID();
    const { signature: _unsigned, ...unsigned } = event(BOB, id, [await cosignBy(BOB, id)]);
    const artifact = { ...unsigned, to, document: { agreement: ref, eventType: 'accepted' } };
    return { ...artifact, signature: signBtpPayload(artifact, keys[BOB]!) };
  };

  it('opens the statement addressed to the receiver with its key', async () => {
    const { error, cosigned } = await decryptVerify(keys[BOB]!.publicKey, await answerFromBob(), keys[ACME]!.privateKey);
    expect(error).toBeUndefined();
    expect(cosigned?.[0]?.signer).toBe(BOB);
  });

  it('refuses rather than skips a statement addressed to the receiver when no key is given', async () => {
    for (const key of [undefined, '']) {
      const { error, cosigned } = await decryptVerify(keys[BOB]!.publicKey, await answerFromBob(), key);
      expect(error?.code).toBe(BTP_ERROR_SIG_VERIFICATION.code);
      expect(cosigned).toBeUndefined();
    }
  });

  it('needs no key when no cosignature is addressed to the receiver', async () => {
    const { error, cosigned } = await decryptVerify(keys[BOB]!.publicKey, await answerFromBob(MALLORY));
    expect(error).toBeUndefined();
    expect(cosigned).toBeUndefined();
  });
});
