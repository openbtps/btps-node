/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: the originator's platform checks an agreement's answers, in its
 * own middleware, with its own records. The turn reads only the envelope, so
 * it is checked in flight, encrypted or not. The server never checks it.
 */

import { describe, expect, it, vi } from 'vitest';
import { agreementOrderCheck } from './agreementOrderCheck.js';
import type { BTPAgreementAnswers } from '@core/trust/types.js';
import type { BTPRequestCtx, BTPResponseCtx } from '../types.js';

const BANK = 'loans$bank.example';
const ALICE = 'alice$client.example';
const SAM = 'sam$guarantor.example';
const sequential = (answered: BTPAgreementAnswers['answered']): BTPAgreementAnswers => ({
  signers: [ALICE, SAM],
  signingOrder: 'sequential',
  answered,
});

// An encrypted event: the check never opens it.
const arriving = (from: string, more: object = {}) =>
  ({
    isTrusted: true,
    data: {
      type: 'transporter',
      artifact: {
        version: '1.2.0',
        id: '5d6e7f80-9102-4a3b-8c4d-5e6f708192a3',
        type: 'BTPS_EVENT',
        from,
        to: BANK,
        relatesTo: 'agreement-copy',
        encryption: { algorithm: 'aes-256-gcm' },
        document: 'ciphertext',
      },
    },
    ...more,
  }) as unknown as BTPRequestCtx<'after', 'trustVerification'>;

const run = async (
  answers: () => Promise<BTPAgreementAnswers | undefined>,
  req: BTPRequestCtx<'after', 'trustVerification'>,
) => {
  const lookup = vi.fn(answers);
  const res = { sendError: vi.fn() } as unknown as BTPResponseCtx<'after', 'trustVerification'>;
  const next = vi.fn();
  await agreementOrderCheck({ answers: lookup }).handler(req, res, next);
  return { lookup, sendError: res.sendError as ReturnType<typeof vi.fn>, next };
};

describe("an agreement's answers, checked by its originator's platform in flight", () => {
  it('passes an answer in turn on, without opening it', async () => {
    const { lookup, sendError, next } = await run(async () => sequential([]), arriving(ALICE));
    expect(lookup).toHaveBeenCalledWith({
      relatesTo: 'agreement-copy',
      signer: ALICE,
      originator: BANK,
    });
    expect(sendError).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('refuses one out of turn, naming the rule: BTP_ERROR_AGREEMENT_ORDER', async () => {
    const { sendError, next } = await run(async () => sequential([]), arriving(SAM));
    expect(next).not.toHaveBeenCalled();
    expect(sendError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'BTP_ERROR_AGREEMENT_ORDER',
        message: expect.stringContaining('in list order'),
      }),
    );
  });

  it('refuses a second answer, and one after a decline', async () => {
    const aliceAccepted = { signer: ALICE, decision: 'accepted' as const, sha256: 'a'.repeat(64) };
    const twice = await run(async () => sequential([aliceAccepted]), arriving(ALICE));
    expect(twice.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('answers once') }),
    );
    const declined = { ...aliceAccepted, decision: 'declined' as const };
    const after = await run(async () => sequential([declined]), arriving(SAM));
    expect(after.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('declined ends') }),
    );
  });

  it('passes an event that answers no agreement copy, and leaves an untrusted one alone', async () => {
    expect((await run(async () => undefined, arriving(SAM))).next).toHaveBeenCalled();
    const untrusted = await run(async () => sequential([]), arriving(SAM, { isTrusted: false }));
    expect(untrusted.lookup).not.toHaveBeenCalled();
    expect(untrusted.next).toHaveBeenCalled();
  });
});
