/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: an agreement's evidence bundle. A party creates it to show what
 * was agreed, to a solicitor or a court; whoever it is given to sees
 * everything in it, by design. It holds the content, every signature and the
 * keys, so it checks offline, and it reports facts, never a verdict.
 */

import crypto from 'crypto';
import type { z } from 'zod';
import { getFingerprintFromPem } from '@core/crypto/index.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_RESOLVE_PUBKEY, BTP_ERROR_VALIDATION } from '@core/error/constant.js';
import { BtpEvidenceBundleSchema } from '@core/server/schemas/btpsDocsSchema.js';
import { sameIdentity } from '@core/server/schemas/helpers.js';
import {
  agreementContentSha256,
  agreementOrderProblem,
  agreementRef,
  originatorSignatureValid,
  statementRecordSha256,
  statementSignatureFacts,
  type BTPKeyOf,
} from './agreements.js';
import type {
  BTPAgreementAnswers,
  BTPStatementRecord,
  BTPStatementSignatureFacts,
} from './types.js';

/**
 * Since 1.2: an agreement's evidence bundle (format `btps-evidence/1`). A
 * record's delegated artifact is a whole transporter artifact, though the
 * schema checks only what its signatures need.
 */
export type BTPEvidenceBundle = Omit<z.infer<typeof BtpEvidenceBundleSchema>, 'statements'> & {
  statements: BTPStatementRecord[];
};

/** Since 1.2: what an evidence bundle shows. BTPS reports these and decides nothing. */
export type BTPEvidenceFacts = {
  /** The SHA-256 of the agreement's content, as the bundle holds it */
  contentSha256: string;
  /** The originator's signature is over this content */
  originatorSignatureValid: boolean;
  /** Each term is the SHA-256 of one of its attachments, as attached */
  termsAttached: boolean;
  /** Each statement, in the bundle's order */
  statements: (BTPStatementSignatureFacts & {
    signer: string;
    decision: 'accepted' | 'declined';
    /** It names this agreement: its originator, id and content */
    agreementMatches: boolean;
    /** It repeats the agreement's terms exactly */
    termsMatch: boolean;
    /** It was signed no later than `acceptance.by` */
    withinDeadline: boolean;
    /** It follows the signers and order, after the statements before it */
    inOrder: boolean;
  })[];
  /** Every fact above holds, and every signer accepted, once */
  complete: boolean;
};

const sha256Hex = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

/** A bundle's keys, as `keyOf`: a key counts only when its fingerprint is its own. */
const keysOf = (bundle: Pick<BTPEvidenceBundle, 'keys'>): BTPKeyOf => {
  const keys = bundle.keys.filter((key) => {
    try {
      return getFingerprintFromPem(key.publicKey) === key.fingerprint;
    } catch {
      return false;
    }
  });
  return (identity, selector) =>
    keys.find((key) => sameIdentity(key.identity, identity) && key.selector === selector)
      ?.publicKey;
};

/**
 * Since 1.2: the facts of an agreement's evidence bundle, checked offline from
 * the bundle alone. A bundle that is not well formed is refused
 * (`BTP_ERROR_VALIDATION`). Whether a key really was its identity's at the
 * time, and whether a device's delegator is its domain's operator, are facts
 * a reader may confirm online; the bundle embeds the keys so it checks without.
 */
export const verifyEvidenceBundle = async (bundle: unknown): Promise<BTPEvidenceFacts> => {
  const parsed = BtpEvidenceBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    throw new BTPErrorException(BTP_ERROR_VALIDATION, {
      cause: `not an evidence bundle: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    });
  }
  const { originator, agreement } = parsed.data;
  const statements = parsed.data.statements as BTPStatementRecord[];
  const keyOf = keysOf(parsed.data);
  const { by, terms, signers, signingOrder } = agreement.acceptance;
  const ref = agreementRef(agreement, originator);

  const termsAttached = terms.every((term) =>
    agreement.attachments?.some(
      ({ sha256, content }) =>
        sha256 === term && sha256Hex(Buffer.from(content, 'base64')) === term,
    ),
  );
  const answered: BTPAgreementAnswers['answered'] = [];
  const statementFacts = statements.map((record) => {
    const { statement } = record;
    const { agreement: named } = statement;
    const facts = {
      signer: statement.signer,
      decision: statement.decision,
      ...statementSignatureFacts(record, keyOf),
      agreementMatches:
        sameIdentity(named.originator, ref.originator) &&
        named.id === ref.id &&
        named.contentSha256 === ref.contentSha256,
      termsMatch:
        statement.terms.length === terms.length && statement.terms.every((t, i) => t === terms[i]),
      withinDeadline: by === undefined || Date.parse(statement.signedAt) <= Date.parse(by),
      inOrder:
        agreementOrderProblem(
          { from: statement.signer, previous: statement.previous },
          { signers: signers.map(({ address }) => address), signingOrder, answered },
        ) === undefined,
    };
    answered.push({
      signer: statement.signer,
      decision: statement.decision,
      sha256: statementRecordSha256(record),
    });
    return facts;
  });

  const originatorValid = originatorSignatureValid(agreement, originator, keyOf);
  const complete =
    originatorValid &&
    termsAttached &&
    statementFacts.length === signers.length &&
    statementFacts.every(
      (fact) =>
        fact.decision === 'accepted' &&
        fact.signatureValid &&
        fact.agreementMatches &&
        fact.termsMatch &&
        fact.withinDeadline &&
        fact.inOrder,
    );
  return {
    contentSha256: agreementContentSha256(agreement),
    originatorSignatureValid: originatorValid,
    termsAttached,
    statements: statementFacts,
    complete,
  };
};

/**
 * Since 1.2: an agreement's evidence bundle, from the opened agreement, its
 * statement records in the order they were taken, and the keys `keyOf` gives:
 * the originator's, each signer's, and each device's delegator and attestor.
 * A key it cannot find is refused (`BTP_ERROR_RESOLVE_PUBKEY`): a bundle
 * without it would not check offline.
 */
export const buildEvidenceBundle = (
  parts: Pick<BTPEvidenceBundle, 'originator' | 'agreement'> & {
    statements: BTPStatementRecord[];
  },
  keyOf: BTPKeyOf,
): BTPEvidenceBundle => {
  const { originator, agreement, statements } = parts;
  const needed: [string, string][] = [[originator, agreement.originatorSignature.selector]];
  for (const record of statements) {
    if (record.selector !== undefined) {
      needed.push([record.statement.signer, record.selector]);
      continue;
    }
    const { delegation } = record.delegatedArtifact;
    needed.push([delegation.signedBy, delegation.selector]);
    if (delegation.attestation) {
      needed.push([delegation.attestation.signedBy, delegation.attestation.selector]);
    }
  }
  const keys: BTPEvidenceBundle['keys'] = [];
  for (const [identity, selector] of needed) {
    if (keys.some((key) => sameIdentity(key.identity, identity) && key.selector === selector)) {
      continue;
    }
    const publicKey = keyOf(identity, selector);
    if (publicKey === undefined) {
      throw new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY, {
        cause: `no key for ${identity} at ${selector}`,
      });
    }
    keys.push({ identity, selector, publicKey, fingerprint: getFingerprintFromPem(publicKey) });
  }
  return { format: 'btps-evidence/1', originator, agreement, statements, keys };
};

/**
 * Since 1.2: an evidence bundle's facts as plain text, one line a fact, as the
 * `btps-verify-evidence` command prints them. Facts only: it says what holds
 * and what does not, never whether to rely on it.
 */
export const describeEvidenceFacts = (facts: BTPEvidenceFacts): string => {
  const mark = (fact: boolean) => (fact ? 'yes' : 'NO');
  const line = (label: string, value: string) => `${label.padEnd(27)}${value}`;
  const lines = [
    line('content sha256', facts.contentSha256),
    line("originator's signature", mark(facts.originatorSignatureValid)),
    line('terms are its attachments', mark(facts.termsAttached)),
  ];
  facts.statements.forEach((s, i) => {
    const key = s.keyKind === 'device' ? `device, delegated by ${s.delegatedBy}` : 'identity';
    const attested = s.attestedBy ? `, attested by ${s.attestedBy}` : '';
    lines.push(
      '',
      `${i + 1}. ${s.signer}: ${s.decision} (${key}${attested})`,
      `   signature ${mark(s.signatureValid)}, this agreement ${mark(s.agreementMatches)}`,
      `   these terms ${mark(s.termsMatch)}, by the deadline ${mark(s.withinDeadline)}, in order ${mark(s.inOrder)}`,
    );
  });
  lines.push('', line('complete', mark(facts.complete)));
  return lines.join('\n');
};
