/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: what a details response names is its platform's to check against
 * the request it answers. The server checks only that the request is known
 * (`isKnownArtifact`). This middleware checks the rest in the server after its
 * trust check, for a response arriving and for one this provider's own device
 * sends. It is off until a platform adds it, with its own lookup.
 */

import { detailsRequestRefusal, type BTPDetailsEnvelope } from '@core/trust/permissions.js';
import type { BTPTransporterArtifact } from '@core/server/types.js';
import type { MiddlewareDefinition } from '../types.js';

/**
 * The envelope of the artifact with this id that passed between these two
 * identities, as the platform recorded it, or undefined when it holds none.
 */
export type BTPArtifactLookup = (query: {
  artifactId: string;
  from: string;
  to: string;
}) => Promise<BTPDetailsEnvelope | undefined>;

/**
 * Since 1.2: middleware that refuses, in flight, a `DETAILS_RES` that does not
 * answer a `DETAILS_REQ` its receiver sent to its sender, or names what was
 * not asked for (`detailsRequestRefusal`): `BTP_ERROR_PERMISSION`, the reason
 * in its message. It reads only envelopes, so it works the same for an
 * encrypted response, arriving or carried by a device's `artifact.send`.
 */
export const detailsResponseCheck = (lookups: {
  getArtifact: BTPArtifactLookup;
}): MiddlewareDefinition<'after', 'trustVerification'> => ({
  phase: 'after',
  step: 'trustVerification',
  config: { name: 'details-response-check' },
  handler: async (req, res, next) => {
    const { data } = req;
    if (!req.isTrusted) return next();
    const response =
      data.type === 'transporter'
        ? data.artifact
        : (data.artifact.document as BTPTransporterArtifact | undefined);
    if (response?.type !== 'DETAILS_RES') return next();
    const { relatesTo = '', from, to } = response;
    const sentRequest = await lookups.getArtifact({ artifactId: relatesTo, from: to, to: from });
    const refusal = detailsRequestRefusal(response, sentRequest);
    if (refusal) {
      return res.sendError({
        ...refusal.error,
        message: `${refusal.error.message}: ${refusal.problem}`,
      });
    }
    return next();
  },
});
