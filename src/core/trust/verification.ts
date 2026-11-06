/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: verification. BTPS verifies no one and decides nothing about who
 * is verified. A provider that has checked a sender signs a statement of what
 * it checked; these sign one, and report the facts a receiver decides on.
 */

import { signBtpPayload, signBtpPayloadWithSigner, verifySignature } from '@core/crypto/index.js';
import type { PemKeys } from '@core/crypto/types.js';
import type { Signer } from '@core/crypto/signer-interface.js';
import type { BtpsKeyResolver } from '@core/crypto/keyResolver.js';
import { signatureKey } from '@core/delegation/verifyTransporterSignature.js';
import { getHostAndSelector, parseIdentity } from '@core/utils/index.js';
import type { BTPVerification, BTPVerificationClaims, BTPVerificationFacts } from './types.js';

/** What a verification is signed over: the statement, bound to its subject, the request's `from`. */
const signedStatement = (subject: string, verification: Omit<BTPVerification, 'signature'>) => {
  const { claims, verifiedAt, expiresAt, verifiedBy, selector } = verification;
  return { subject, claims, verifiedAt, expiresAt, verifiedBy, selector };
};

const domainOf = (identity: string) => parseIdentity(identity)?.domainName.toLowerCase();

/**
 * Since 1.2: a provider signs a statement that it checked `subject`, the
 * address that will send the trust request carrying it. The result goes in the
 * request's document as `verification`.
 */
export const signVerification = async (
  statement: {
    subject: string;
    claims: BTPVerificationClaims;
    verifiedAt: string;
    expiresAt: string;
  },
  verifier: { verifiedBy: string; selector: string } & ({ pemFiles: PemKeys } | { signer: Signer }),
): Promise<BTPVerification> => {
  const { subject, claims, verifiedAt, expiresAt } = statement;
  const unsigned = {
    verifiedBy: verifier.verifiedBy,
    claims,
    verifiedAt,
    expiresAt,
    selector: verifier.selector,
  };
  const payload = signedStatement(subject, unsigned);
  const signature =
    'signer' in verifier
      ? await signBtpPayloadWithSigner(payload, verifier.signer)
      : signBtpPayload(payload, verifier.pemFiles);
  return { ...unsigned, signature };
};

/**
 * Since 1.2: the facts about an opened trust request's verification, or
 * undefined when it carries none. It refuses nothing: whose verifications to
 * trust, and which facts to require, are each provider's to decide.
 */
export const verificationFacts = async (
  request: { from: string; document?: unknown },
  options: { keyResolver?: BtpsKeyResolver; now?: number } = {},
): Promise<BTPVerificationFacts | undefined> => {
  const verification = (request.document as { verification?: BTPVerification } | undefined)
    ?.verification;
  if (!verification) return undefined;
  const { signature, ...unsigned } = verification;
  const key = await signatureKey(unsigned.verifiedBy, unsigned.selector, options.keyResolver);
  const signatureValid =
    !!key && verifySignature(signedStatement(request.from, unsigned), signature, key).isValid;
  const expired = Date.parse(unsigned.expiresAt) <= (options.now ?? Date.now());
  const operator = (await getHostAndSelector(request.from))?.operator;
  const verifier = unsigned.verifiedBy.toLowerCase();
  return {
    signatureValid,
    expired,
    verifierServesSender: !!operator && domainOf(verifier) === domainOf(operator),
    verifierIsOperator: !!operator && verifier === operator.toLowerCase(),
  };
};
