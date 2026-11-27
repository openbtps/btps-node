/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: agreements are signed over their content. The originator signs
 * it once for every copy, and each signer cosigns a statement naming it
 * (rc.4: encrypted once to every party, then signed over its ciphertext), with
 * its identity key or a device key its delegation vouches for.
 */

import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, randomUUID } from 'crypto';
import { signBtpPayload } from '../crypto/index.js';
import { canonicalizeValue } from '../crypto/jcs.js';
import { PemSigner } from '../crypto/pem-signer.js';
import type { BTPDelegation, BTPTransporterArtifact } from '../server/types.js';
import {
  agreementContentSha256,
  agreementOrderProblem,
  agreementRef,
  originatorSignatureValid,
  signAgreement,
} from './agreements.js';
import {
  cosign,
  cosignatureSha256,
  cosignaturesProblem,
  openCosignature,
  statementOfText,
} from './cosignatures.js';
import type { BTPAgreementStatement, BTPCosignature } from './types.js';

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const BANK = 'loans$bank.example';
const ALICE = 'alice$client.example';
const OPERATOR = 'admin$client.example';
const keys = {
  [BANK]: keyPair(),
  [ALICE]: keyPair(),
  [OPERATOR]: keyPair(),
  device: keyPair(),
  other: keyPair(),
};
const keyOf = (identity: string) => keys[identity as keyof typeof keys]?.publicKey;

const content = {
  type: 'agreement' as const,
  title: 'Home loan agreement',
  id: 'AGR-1',
  salt: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  issuedAt: '2026-11-01T00:00:00.000Z',
  body: { format: 'markdown' as const, content: '# Home loan' },
  acceptance: {
    terms: [],
    signers: [{ address: ALICE }, { address: BANK }],
    signingOrder: 'sequential' as const,
  },
};

describe('an agreement', () => {
  it('is signed by its originator over its content, and checks with its key', async () => {
    const agreement = await signAgreement(content, {
      originator: BANK,
      selector: 'btps1',
      pemFiles: keys[BANK],
    });
    expect(agreementContentSha256(agreement)).toBe(agreementContentSha256(content));
    expect(originatorSignatureValid(agreement, BANK, keyOf)).toBe(true);
  });

  it('is named by the SHA-256 of its RFC 8785 form, without its signature', () => {
    const sha256 = createHash('sha256').update(canonicalizeValue(content), 'utf8').digest('hex');
    expect(agreementRef(content, BANK)).toEqual({
      originator: BANK,
      id: 'AGR-1',
      contentSha256: sha256,
    });
  });

  it('no longer checks once its content changes, or under another originator', async () => {
    const agreement = await signAgreement(content, {
      originator: BANK,
      selector: 'btps1',
      signer: new PemSigner(keys[BANK]),
    });
    const changed = { ...agreement, body: { format: 'markdown' as const, content: '# Other' } };
    expect(originatorSignatureValid(changed, BANK, keyOf)).toBe(false);
    expect(originatorSignatureValid(agreement, ALICE, keyOf)).toBe(false);
  });
});

const statement: BTPAgreementStatement = {
  agreement: agreementRef(content, BANK),
  terms: [],
  signer: ALICE,
  artifactId: '7a1c2e3f-4b5d-4c6e-8f70-81a2b3c4d5e6',
  decision: 'accepted',
  signedAt: '2026-11-02T00:00:00.000Z',
};
const recipients = [BANK, ALICE].map((identity) => ({
  identity,
  publicKey: keys[identity as keyof typeof keys].publicKey,
}));
const keyOfAsync = async (identity: string) => keyOf(identity);

/** An event carrying `cosignatures`, as its server checks it: `from`, under `id`, perhaps delegated. */
const carrying = (
  from: string,
  id: string,
  cosignatures: BTPCosignature[],
  delegation?: BTPDelegation,
) =>
  ({
    version: '1.2.0',
    type: 'BTPS_EVENT',
    id,
    issuedAt: statement.signedAt,
    from,
    to: BANK,
    relatesTo: 'agreement-copy',
    selector: 'btps1',
    encryption: null,
    document: 'ciphertext',
    signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
    cosignatures,
    ...(delegation && { delegation }),
  }) as BTPTransporterArtifact;

/** What the statement in `cosignature` opens to as `text`, as its recipient or an evidence bundle reads it. */
const textOf = async (cosignature: BTPCosignature) => {
  const opened = await openCosignature(cosignature, { identity: BANK, key: keys[BANK].privateKey });
  return opened && 'statement' in opened ? opened.statement : undefined;
};

describe("a signer's cosignature", () => {
  it('signed with the identity key checks with it, and opens to its statement', async () => {
    const cosignature = await cosign({
      statement,
      recipients,
      by: { selector: 'btps1', pemFiles: keys[ALICE] },
    });
    expect(
      await cosignaturesProblem(carrying(ALICE, statement.artifactId, [cosignature]), keyOfAsync),
    ).toBeUndefined();
    expect(await textOf(cosignature)).toEqual(statement);
  });

  it('does not check without its key, or with another', async () => {
    const cosignature = await cosign({
      statement,
      recipients,
      by: { selector: 'btps1', pemFiles: keys[ALICE] },
    });
    expect(
      await cosignaturesProblem(
        carrying(ALICE, statement.artifactId, [cosignature]),
        async () => undefined,
      ),
    ).toMatch(/signed by its signer/);
    const byOther = await cosign({
      statement,
      recipients,
      by: { selector: 'btps1', pemFiles: keys.other },
    });
    expect(
      await cosignaturesProblem(carrying(ALICE, statement.artifactId, [byOther]), keyOfAsync),
    ).toMatch(/signed by its signer/);
  });

  it('covers every word of its statement, the visual signature, consent and where it was signed from included', async () => {
    const signed = {
      ...statement,
      visualSignature: { type: 'typed' as const, text: 'Alice Ng' },
      consent: {
        electronic: true as const,
        disclosureSha256: 'a'.repeat(64),
        at: '2026-11-01T23:59:00.000Z',
      },
      viewedAt: '2026-11-01T23:58:00.000Z',
      viewedFrom: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/132' },
      signedFrom: { ip: '2001:db8::7', userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1' },
    };
    const cosignature = await cosign({
      statement: signed,
      recipients,
      by: { selector: 'btps1', pemFiles: keys[ALICE] },
    });
    const opened = await textOf(cosignature);
    expect(opened).toEqual(signed);
    // Any other text, with any one word changed, is not the one it signed.
    for (const changed of [
      { ...signed, visualSignature: { type: 'typed' as const, text: 'Someone Else' } },
      { ...signed, consent: { ...signed.consent, disclosureSha256: 'b'.repeat(64) } },
      { ...signed, signedFrom: { ip: '198.51.100.9' } },
      { ...signed, decision: 'declined' as const },
    ]) {
      expect(
        statementOfText(cosignature, canonicalizeValue({ statement: changed, padding: '' })),
      ).toEqual({
        problem: 'its statement is not the one it signed',
      });
    }
  });

  it('is named by the next one by the SHA-256 of its RFC 8785 form, signature included', async () => {
    const cosignature = await cosign({
      statement,
      recipients,
      by: { selector: 'btps1', pemFiles: keys[ALICE] },
    });
    const sha256 = createHash('sha256')
      .update(canonicalizeValue(cosignature), 'utf8')
      .digest('hex');
    expect(cosignatureSha256(cosignature)).toBe(sha256);
  });
});

type Keys = { publicKey: string; privateKey: string };

// The event artifact that delivered a device's cosignature, signed by the device and delegated, as it arrived.
const delivered = (
  from: string,
  delegator: { signedBy: string; key: Keys },
  attestor?: { signedBy: string; key: Keys },
  id = statement.artifactId,
) => {
  const artifact = {
    version: '1.2.0',
    issuedAt: statement.signedAt,
    id,
    type: 'BTPS_EVENT' as const,
    from,
    to: BANK,
    relatesTo: 'agreement-copy',
    selector: 'btps1',
    encryption: null,
    document: 'ciphertext',
  };
  const signed = { ...artifact, signature: signBtpPayload(artifact, keys.device) };
  const unsigned = {
    agentId: 'device-1',
    agentPubKey: keys.device.publicKey,
    signedBy: delegator.signedBy,
    issuedAt: statement.signedAt,
    selector: 'btps1',
  };
  const delegation = {
    ...unsigned,
    signature: signBtpPayload({ ...signed, delegation: unsigned }, delegator.key),
  };
  if (!attestor) return { ...signed, delegation };
  const attestation = {
    signedBy: attestor.signedBy,
    issuedAt: statement.signedAt,
    selector: 'btps1',
  };
  const signature = signBtpPayload({ ...delegation, attestation }, attestor.key);
  return { ...signed, delegation: { ...delegation, attestation: { ...attestation, signature } } };
};
const byOperator = { signedBy: OPERATOR, key: keys[OPERATOR] };
const byAlice = { signedBy: ALICE, key: keys[ALICE] };

/** A device's cosignature, as its originator forwards it: with the delegated artifact that delivered it. */
const onDevice = async (artifact: ReturnType<typeof delivered>, key: Keys = keys.device) => {
  const cosignature = await cosign({ statement, recipients, by: { pemFiles: key } });
  return { ...cosignature, delegatedArtifact: artifact } as BTPCosignature;
};
const forwarded = (cosignature: BTPCosignature) => carrying(BANK, randomUUID(), [cosignature]);

describe('a cosignature signed on a device', () => {
  it('checks in the delegated artifact that first delivers it, under that delegation', async () => {
    const artifact = delivered(ALICE, byOperator);
    const cosignature = await cosign({ statement, recipients, by: { pemFiles: keys.device } });
    expect(
      await cosignaturesProblem(
        carrying(ALICE, statement.artifactId, [cosignature], artifact.delegation),
        keyOfAsync,
      ),
    ).toBeUndefined();
  });

  it('checks when forwarded with that artifact: delegated by its operator, or by itself and attested', async () => {
    expect(
      await cosignaturesProblem(
        forwarded(await onDevice(delivered(ALICE, byOperator))),
        keyOfAsync,
      ),
    ).toBeUndefined();
    expect(
      await cosignaturesProblem(
        forwarded(await onDevice(delivered(ALICE, byAlice, byOperator))),
        keyOfAsync,
      ),
    ).toBeUndefined();
  });

  it('does not check when the signer delegated for itself with no attestation', async () => {
    // A server refuses such a delegation on arrival, so a forward of it is refused too.
    expect(
      await cosignaturesProblem(forwarded(await onDevice(delivered(ALICE, byAlice))), keyOfAsync),
    ).toMatch(/attestation/);
  });

  it('does not check when the artifact came from someone else, or another key signed it', async () => {
    expect(
      await cosignaturesProblem(forwarded(await onDevice(delivered(BANK, byOperator))), keyOfAsync),
    ).toMatch(/sent by its signer/);
    expect(
      await cosignaturesProblem(
        forwarded(await onDevice(delivered(ALICE, byOperator), keys.other)),
        keyOfAsync,
      ),
    ).toMatch(/signed by its device/);
  });

  it("does not check when its delegation or its attestation is not its signer's", async () => {
    const forged = await onDevice(delivered(ALICE, { signedBy: OPERATOR, key: keys.other }));
    const misattested = await onDevice(
      delivered(ALICE, byAlice, { signedBy: OPERATOR, key: keys.other }),
    );
    expect(await cosignaturesProblem(forwarded(forged), keyOfAsync)).toMatch(/delegation/);
    expect(await cosignaturesProblem(forwarded(misattested), keyOfAsync)).toMatch(/attestation/);
  });

  it("is never paired with another of its device's delegated artifacts: its statement names the one it came in", async () => {
    // F4: a stolen device key signs a fresh statement and attaches an older artifact its device sent, delegation and
    // all. The cosignature and its statement name the artifact they first came in, which must be that one.
    const older = delivered(ALICE, byOperator, undefined, randomUUID());
    expect(await cosignaturesProblem(forwarded(await onDevice(older)), keyOfAsync)).toMatch(
      /delegated artifact/,
    );
  });

  it('still checks after it is forwarded as JSON', async () => {
    const cosignature: BTPCosignature = JSON.parse(
      JSON.stringify(await onDevice(delivered(ALICE, byOperator))),
    );
    expect(await cosignaturesProblem(forwarded(cosignature), keyOfAsync)).toBeUndefined();
  });
});

// The rules between opened answers are in agreements.vectors.json; these are the
// order alone, which the originator's platform checks against the answers it has taken.
describe("an answer's order, against the answers already taken", () => {
  const SAM = 'sam$guarantor.example';
  const first = 'a'.repeat(64);
  const sequential = (
    answered: { signer: string; decision: 'accepted' | 'declined'; sha256: string }[],
  ) => ({ signers: [ALICE, SAM, BANK], signingOrder: 'sequential' as const, answered });
  const aliceAccepted = { signer: ALICE, decision: 'accepted' as const, sha256: first };

  it('takes the first signer first, naming no previous', () => {
    expect(agreementOrderProblem({ from: ALICE }, sequential([]))).toBeUndefined();
  });

  it('takes the next signer naming the statement before it, letters compared without case', () => {
    expect(
      agreementOrderProblem(
        { from: 'Sam$Guarantor.example', previous: first },
        sequential([aliceAccepted]),
      ),
    ).toBeUndefined();
  });

  it('refuses someone not listed, a second answer, and one out of turn', () => {
    expect(agreementOrderProblem({ from: 'eve$other.example' }, sequential([]))).toBe(
      'only a listed signer answers',
    );
    expect(
      agreementOrderProblem({ from: ALICE, previous: first }, sequential([aliceAccepted])),
    ).toBe('an answer is final: a signer answers once');
    expect(agreementOrderProblem({ from: SAM }, sequential([]))).toBe(
      'in a sequential agreement the signers answer in list order',
    );
  });

  it('refuses a previous that is missing, wrong, or named first', () => {
    expect(agreementOrderProblem({ from: SAM }, sequential([aliceAccepted]))).toMatch(/previous/);
    expect(
      agreementOrderProblem({ from: SAM, previous: 'b'.repeat(64) }, sequential([aliceAccepted])),
    ).toMatch(/previous/);
    expect(agreementOrderProblem({ from: ALICE, previous: first }, sequential([]))).toBe(
      'the first statement names no previous',
    );
  });

  it('refuses anything after a decline in a sequential agreement', () => {
    const declined = { ...aliceAccepted, decision: 'declined' as const };
    expect(agreementOrderProblem({ from: SAM, previous: first }, sequential([declined]))).toBe(
      'a declined ends a sequential agreement',
    );
  });

  it('takes any order, but never a previous, when the order is any', () => {
    const anyOrder = { signers: [ALICE, SAM], signingOrder: 'any' as const, answered: [] };
    expect(agreementOrderProblem({ from: SAM }, anyOrder)).toBeUndefined();
    expect(agreementOrderProblem({ from: SAM, previous: first }, anyOrder)).toBe(
      'previous is only in a sequential agreement',
    );
  });
});
