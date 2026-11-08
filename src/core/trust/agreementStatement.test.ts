/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// agreementStatementProblem: the originator's platform's check of an opened
// answer against its agreement and the answers already taken. Signatures are
// statementSignatureFacts' (evidence.test.ts), so these records are signed for
// real but only their content is in question.

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import {
  agreementRef,
  agreementStatementProblem,
  signAgreement,
  signStatement,
  statementRecordSha256,
} from './agreements.js';
import type { BTPAgreementStatement } from './types.js';
import type { BTPAgreementDoc } from '../../server/types.js';

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const BANK = 'loans$bank.example';
const ALICE = 'alice$client.example';
const SAM = 'sam$guarantor.example';
const keys = { [BANK]: keyPair(), [ALICE]: keyPair(), [SAM]: keyPair() };
const TERM = 'a'.repeat(64);

const agreementFor = (acceptance: Partial<BTPAgreementDoc['acceptance']> = {}) =>
  signAgreement(
    {
      type: 'agreement',
      title: 'Home loan',
      id: 'AGR-1',
      issuedAt: '2026-11-01T00:00:00.000Z',
      body: { format: 'text', content: 'A loan.' },
      acceptance: {
        terms: [TERM],
        signers: [{ address: ALICE }, { address: SAM }],
        signingOrder: 'sequential',
        by: '2026-11-30T00:00:00.000Z',
        ...acceptance,
      },
    },
    { originator: BANK, selector: 'btps1', pemFiles: keys[BANK] },
  );

const recordBy = (
  agreement: BTPAgreementDoc,
  signer: typeof ALICE | typeof SAM,
  more: Partial<BTPAgreementStatement> = {},
) =>
  signStatement(
    {
      agreement: agreementRef(agreement, BANK),
      terms: [TERM],
      signer,
      decision: 'accepted',
      signedAt: '2026-11-02T00:00:00.000Z',
      ...more,
    },
    { selector: 'btps1', pemFiles: keys[signer] },
  );

/** An answer from `signer` to the bank, as its event carries it. */
const answer = async (
  agreement: BTPAgreementDoc,
  signer: typeof ALICE | typeof SAM,
  more: Partial<BTPAgreementStatement> = {},
) => {
  const statement = await recordBy(agreement, signer, more);
  return {
    envelope: { from: signer, to: BANK },
    event: {
      eventType: statement.statement.decision,
      agreement: statement.statement.agreement,
      statement,
    },
  };
};

describe('agreementStatementProblem', () => {
  it('takes the first signer’s answer, and the next one’s naming it', async () => {
    const agreement = await agreementFor();
    const first = await answer(agreement, ALICE);
    expect(agreementStatementProblem(first.envelope, first.event, agreement, [])).toBeUndefined();

    const second = await answer(agreement, SAM, {
      previous: statementRecordSha256(first.event.statement),
    });
    expect(
      agreementStatementProblem(second.envelope, second.event, agreement, [first.event.statement]),
    ).toBeUndefined();
  });

  it('refuses an event that carries no statement', async () => {
    const agreement = await agreementFor();
    const { envelope, event } = await answer(agreement, ALICE);
    expect(
      agreementStatementProblem(envelope, { ...event, statement: undefined }, agreement, []),
    ).toBe('only an answer carries a statement');
  });

  it("refuses an eventType that is not its statement's decision", async () => {
    const agreement = await agreementFor();
    const { envelope, event } = await answer(agreement, ALICE);
    expect(
      agreementStatementProblem(envelope, { ...event, eventType: 'declined' }, agreement, []),
    ).toBe("an answer's eventType is its statement's decision");
  });

  it("refuses an event naming another agreement than its statement's", async () => {
    const agreement = await agreementFor();
    const { envelope, event } = await answer(agreement, ALICE);
    expect(
      agreementStatementProblem(
        envelope,
        { ...event, agreement: { ...event.agreement, id: 'AGR-2' } },
        agreement,
        [],
      ),
    ).toBe("the event's agreement is its statement's");
  });

  it('refuses a statement about another agreement, or another version of this one', async () => {
    const agreement = await agreementFor();
    const other = await agreementFor({ by: '2026-12-31T00:00:00.000Z' });
    const { envelope, event } = await answer(other, ALICE);
    expect(agreementStatementProblem(envelope, event, agreement, [])).toBe(
      'a statement names its own agreement: its originator, id and contentSha256',
    );
  });

  it('refuses a statement sent by anyone but its signer', async () => {
    const agreement = await agreementFor();
    const { envelope, event } = await answer(agreement, ALICE);
    expect(agreementStatementProblem({ ...envelope, from: SAM }, event, agreement, [])).toBe(
      'a statement is sent by its own signer',
    );
  });

  it("refuses a statement that does not repeat the agreement's terms exactly", async () => {
    const agreement = await agreementFor();
    const fewer = await answer(agreement, ALICE, { terms: [] });
    const changed = await answer(agreement, ALICE, { terms: ['b'.repeat(64)] });
    const why = "a statement repeats the agreement's terms exactly";
    expect(agreementStatementProblem(fewer.envelope, fewer.event, agreement, [])).toBe(why);
    expect(agreementStatementProblem(changed.envelope, changed.event, agreement, [])).toBe(why);
  });

  it('refuses a statement signed after the deadline, and takes one with no deadline', async () => {
    const late = { signedAt: '2026-12-01T00:00:00.000Z' };
    const withDeadline = await agreementFor();
    const answered = await answer(withDeadline, ALICE, late);
    expect(agreementStatementProblem(answered.envelope, answered.event, withDeadline, [])).toBe(
      'signedAt is no later than acceptance.by',
    );

    const noDeadline = await agreementFor({ by: undefined });
    const open = await answer(noDeadline, ALICE, late);
    expect(agreementStatementProblem(open.envelope, open.event, noDeadline, [])).toBeUndefined();
  });

  it('refuses an answer out of turn, by the order of the answers taken', async () => {
    const agreement = await agreementFor();
    const { envelope, event } = await answer(agreement, SAM);
    expect(agreementStatementProblem(envelope, event, agreement, [])).toBeDefined();
  });
});
