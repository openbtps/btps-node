/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: agreements are signed over their content. The originator signs
 * it once for every copy, and each signer signs a statement naming it, with
 * its identity key or a device key its delegation vouches for.
 */

import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'crypto';
import { signBtpPayload } from '../crypto/index.js';
import { canonicalizeValue } from '../crypto/jcs.js';
import { PemSigner } from '../crypto/pem-signer.js';
import {
  agreementContentSha256,
  agreementOrderProblem,
  agreementRef,
  deviceStatementRecord,
  originatorSignatureValid,
  signAgreement,
  signStatement,
  signStatementOnDevice,
  statementRecordSha256,
  statementSignatureFacts,
} from './agreements.js';
import type { BTPAgreementStatement, BTPStatementRecord } from './types.js';

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
  decision: 'accepted',
  signedAt: '2026-11-02T00:00:00.000Z',
};

describe('a statement', () => {
  it('signed with the identity key checks with it, as an identity key', async () => {
    const record = await signStatement(statement, { selector: 'btps1', pemFiles: keys[ALICE] });
    expect(statementSignatureFacts(record, keyOf)).toEqual({
      signatureValid: true,
      keyKind: 'identity',
    });
  });

  it('does not check once changed, or without its key', async () => {
    const record = await signStatement(statement, { selector: 'btps1', pemFiles: keys[ALICE] });
    const changed = { ...record, statement: { ...statement, decision: 'declined' as const } };
    expect(statementSignatureFacts(changed, keyOf).signatureValid).toBe(false);
    expect(statementSignatureFacts(record, () => undefined).signatureValid).toBe(false);
  });

  it("covers the signer's visual signature: another one, or none, no longer checks", async () => {
    const signed = {
      ...statement,
      visualSignature: { type: 'typed' as const, text: 'Alice Ng' },
    };
    const record = await signStatement(signed, { selector: 'btps1', pemFiles: keys[ALICE] });
    expect(statementSignatureFacts(record, keyOf).signatureValid).toBe(true);
    const swapped = {
      ...record,
      statement: { ...signed, visualSignature: { type: 'typed' as const, text: 'Someone Else' } },
    };
    expect(statementSignatureFacts(swapped, keyOf).signatureValid).toBe(false);
    const dropped = { ...record, statement };
    expect(statementSignatureFacts(dropped, keyOf).signatureValid).toBe(false);
  });

  it('is named by the next one by the SHA-256 of its record, signature included', async () => {
    const record = await signStatement(statement, { selector: 'btps1', pemFiles: keys[ALICE] });
    const sha256 = createHash('sha256').update(canonicalizeValue(record), 'utf8').digest('hex');
    expect(statementRecordSha256(record)).toBe(sha256);
  });
});

type Keys = { publicKey: string; privateKey: string };

// The event artifact that delivered a device's statement, signed by the device and delegated, as it arrived.
const delivered = (
  from: string,
  delegator: { signedBy: string; key: Keys },
  attestor?: { signedBy: string; key: Keys },
) => {
  const artifact = {
    version: '1.2.0',
    issuedAt: statement.signedAt,
    id: '7a1c2e3f-4b5d-4c6e-8f70-81a2b3c4d5e6',
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

describe('a statement signed on a device', () => {
  it('checks through the delegated artifact that delivered it, as a device key', async () => {
    const signed = await signStatementOnDevice(statement, { pemFiles: keys.device });
    const record = deviceStatementRecord(signed, delivered(ALICE, byOperator));
    expect(statementSignatureFacts(record, keyOf)).toEqual({
      signatureValid: true,
      keyKind: 'device',
      delegatedBy: OPERATOR,
    });
  });

  it('checks when the signer delegated for itself and its operator attested it', async () => {
    const signed = await signStatementOnDevice(statement, { pemFiles: keys.device });
    const record = deviceStatementRecord(signed, delivered(ALICE, byAlice, byOperator));
    expect(statementSignatureFacts(record, keyOf)).toEqual({
      signatureValid: true,
      keyKind: 'device',
      delegatedBy: ALICE,
      attestedBy: OPERATOR,
    });
  });

  it('does not check when the signer delegated for itself with no attestation', async () => {
    // A server refuses such a delegation on arrival, so an offline reader does too.
    const signed = await signStatementOnDevice(statement, { pemFiles: keys.device });
    const record = deviceStatementRecord(signed, delivered(ALICE, byAlice));
    expect(statementSignatureFacts(record, keyOf)).toEqual({
      signatureValid: false,
      keyKind: 'device',
      delegatedBy: ALICE,
    });
  });

  it('does not check when the artifact came from someone else', async () => {
    const signed = await signStatementOnDevice(statement, { pemFiles: keys.device });
    const record = deviceStatementRecord(signed, delivered(BANK, byOperator));
    expect(statementSignatureFacts(record, keyOf).signatureValid).toBe(false);
  });

  it('does not check when another key signed the statement', async () => {
    const signed = await signStatementOnDevice(statement, { pemFiles: keys.other });
    const record = deviceStatementRecord(signed, delivered(ALICE, byOperator));
    expect(statementSignatureFacts(record, keyOf).signatureValid).toBe(false);
  });

  it("does not check when its delegation or its attestation is not its signer's", async () => {
    const signed = await signStatementOnDevice(statement, { pemFiles: keys.device });
    const forged = deviceStatementRecord(
      signed,
      delivered(ALICE, { signedBy: OPERATOR, key: keys.other }),
    );
    const misattested = deviceStatementRecord(
      signed,
      delivered(ALICE, byAlice, { signedBy: OPERATOR, key: keys.other }),
    );
    expect(statementSignatureFacts(forged, keyOf).signatureValid).toBe(false);
    expect(statementSignatureFacts(misattested, keyOf)).toMatchObject({
      signatureValid: false,
      attestedBy: OPERATOR,
    });
  });

  it('still checks after it is forwarded as JSON', async () => {
    const signed = await signStatementOnDevice(statement, { pemFiles: keys.device });
    const record: BTPStatementRecord = JSON.parse(
      JSON.stringify(deviceStatementRecord(signed, delivered(ALICE, byOperator))),
    );
    expect(statementSignatureFacts(record, keyOf).signatureValid).toBe(true);
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
