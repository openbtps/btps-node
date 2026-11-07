/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: an event's chain is its platform's to check, never the server's.
 * This middleware checks it in the server after its trust check, so a wrong
 * `withdrawn` or `follows` is refused while it is in flight. It is off until a
 * platform adds it, with its own lookup of the events it holds.
 */

import { BTP_ERROR_EVENT_CHAIN } from '@core/error/constant.js';
import { BtpLifecycleEventSchema } from '@core/server/schemas/btpsDocsSchema.js';
import {
  lifecycleEventChainProblem,
  lifecycleEventChainReference,
  lifecycleEventSenderProblem,
} from '@core/server/schemas/helpers.js';
import type { BTPEventFacts } from '@core/trust/types.js';
import type { MiddlewareDefinition } from '../types.js';

/**
 * What the platform holds of the lifecycle event with this id between these
 * two identities, in either direction, with the invoice it is about, or
 * undefined when it holds none.
 */
export type BTPEventLookup = (query: {
  id: string;
  from: string;
  to: string;
}) => Promise<BTPEventFacts | undefined>;

/**
 * Since 1.2: middleware that refuses, in flight, an event whose chain is wrong
 * (`lifecycleEventChainProblem`): `BTP_ERROR_EVENT_CHAIN`, the broken rule in
 * its message. With `getEvent`, a `withdrawn` must take back the payer's own
 * open proposal about the same invoice, and a `follows` must name a
 * `withdrawn` about it; without it, only that the payer, never the invoice's
 * issuer, withdraws or proposes again. It reads the event, so an encrypted
 * one passes: its platform checks it with `lifecycleEventChainProblem` once
 * opened.
 */
export const eventChainCheck = (
  lookups: { getEvent?: BTPEventLookup } = {},
): MiddlewareDefinition<'after', 'trustVerification'> => ({
  phase: 'after',
  step: 'trustVerification',
  config: { name: 'event-chain-check' },
  handler: async (req, res, next) => {
    const { data } = req;
    if (!req.isTrusted || data.type !== 'transporter' || data.artifact.type !== 'BTPS_EVENT') {
      return next();
    }
    if (data.artifact.encryption) return next();
    const parsed = BtpLifecycleEventSchema.safeParse(data.artifact.document);
    if (!parsed.success) return next();
    const named = lifecycleEventChainReference(parsed.data);
    if (named === undefined) return next();
    const { from, to } = data.artifact;
    const problem = lookups.getEvent
      ? lifecycleEventChainProblem(
          parsed.data,
          { from },
          await lookups.getEvent({ id: named, from, to }),
        )
      : lifecycleEventSenderProblem(parsed.data, { from });
    if (problem) {
      return res.sendError({
        ...BTP_ERROR_EVENT_CHAIN,
        message: `${BTP_ERROR_EVENT_CHAIN.message}: ${problem}`,
      });
    }
    return next();
  },
});
