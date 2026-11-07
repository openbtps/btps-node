/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: an agreement's answers are the originator's platform's to check,
 * never the server's. This middleware checks the turn, in the server after
 * its trust check, so an answer out of turn is refused while it is in flight.
 * It reads only the envelope: who sent it, and the copy it answers. It is off
 * until a platform adds it with its own lookup.
 */

import { BTP_ERROR_AGREEMENT_ORDER } from '@core/error/constant.js';
import { agreementTurnProblem } from '@core/trust/agreements.js';
import type { BTPAgreementAnswers } from '@core/trust/types.js';
import type { MiddlewareDefinition } from '../types.js';

/**
 * The originator's platform's own record of an agreement, by the copy an
 * answer names: its signers, how they answer, and the answers taken so far.
 * Undefined when `relatesTo` is no agreement copy it sent to `signer`.
 */
export type BTPAgreementAnswersLookup = (query: {
  relatesTo: string;
  signer: string;
  originator: string;
}) => Promise<BTPAgreementAnswers | undefined>;

/**
 * Since 1.2: middleware that refuses, in flight, an agreement's answer that is
 * not its sender's turn (`agreementTurnProblem`): `BTP_ERROR_AGREEMENT_ORDER`,
 * the broken rule in its message. It needs no decryption, so it works the same
 * for an encrypted answer. An event about anything but an agreement copy passes.
 * What needs the opened statement is the platform's after opening:
 * `agreementStatementProblem`.
 */
export const agreementOrderCheck = (lookups: {
  answers: BTPAgreementAnswersLookup;
}): MiddlewareDefinition<'after', 'trustVerification'> => ({
  phase: 'after',
  step: 'trustVerification',
  config: { name: 'agreement-order-check' },
  handler: async (req, res, next) => {
    const { data } = req;
    if (!req.isTrusted || data.type !== 'transporter' || data.artifact.type !== 'BTPS_EVENT') {
      return next();
    }
    const { from, to, relatesTo } = data.artifact;
    if (relatesTo === undefined) return next();
    const held = await lookups.answers({ relatesTo, signer: from, originator: to });
    const problem = held && agreementTurnProblem(from, held);
    if (problem) {
      return res.sendError({
        ...BTP_ERROR_AGREEMENT_ORDER,
        message: `${BTP_ERROR_AGREEMENT_ORDER.message}: ${problem}`,
      });
    }
    return next();
  },
});
