/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: agreements are signed over their content, not their envelope.
 * Each signer gets its own copy, encrypted to it only, so what every copy has
 * in common is the content: its originator signs that, and each signer signs
 * a statement naming it. Both stay checkable however a copy travels.
 */

import crypto from 'crypto';
import { signBtpPayload, signBtpPayloadWithSigner, verifySignature } from '@core/crypto/index.js';
import { canonicalizeValue } from '@core/crypto/jcs.js';
import type { BTPSignature, PemKeys } from '@core/crypto/types.js';
import type { Signer } from '@core/crypto/signer-interface.js';
import type { z } from 'zod';
import type { BtpAgreementDocSchema } from '@core/server/schemas/btpsDocsSchema.js';
import type { BTPDelegation } from '@core/server/types.js';
import { sameIdentity } from '@core/server/schemas/helpers.js';
import type {
  BTPAgreementFacts,
  BTPAgreementRef,
  BTPAgreementState,
  BTPAgreementStatement,
  BTPStatementRecord,
  BTPStatementSignatureFacts,
} from './types.js';

type BTPAgreementDoc = z.infer<typeof BtpAgreementDocSchema>;

/** A key to sign with: a PEM pair, or a Signer for a key held elsewhere. */
type SigningKey = { pemFiles: PemKeys } | { signer: Signer };

/** The public key of `identity` at `selector`, or undefined: from DNS, a store, or an evidence bundle. */
export type BTPKeyOf = (identity: string, selector: string) => string | undefined;

const sha256Of = (value: unknown) =>
  crypto.createHash('sha256').update(canonicalizeValue(value), 'utf8').digest('hex');

const sign = (payload: unknown, key: SigningKey): Promise<BTPSignature> =>
  'signer' in key
    ? signBtpPayloadWithSigner(payload, key.signer)
    : Promise.resolve(signBtpPayload(payload, key.pemFiles));

const isValid = (payload: unknown, signature: BTPSignature, key: string | undefined) =>
  key !== undefined && verifySignature(payload, signature, key).isValid;

/** Since 1.2: an agreement's content without its originator's signature, as its SHA-256 is taken over it. */
const contentOf = (agreement: object) =>
  Object.fromEntries(Object.entries(agreement).filter(([key]) => key !== 'originatorSignature'));

/** Since 1.2: the SHA-256, in lowercase hex, of an agreement's RFC 8785 form without `originatorSignature`. */
export const agreementContentSha256 = (agreement: object): string => sha256Of(contentOf(agreement));

/** Since 1.2: what names an agreement: its originator, its id and its content's SHA-256. */
export const agreementRef = (
  agreement: Pick<BTPAgreementDoc, 'id'>,
  originator: string,
): BTPAgreementRef => ({
  originator,
  id: agreement.id,
  contentSha256: agreementContentSha256(agreement),
});

/**
 * Since 1.2: the SHA-256, in lowercase hex, of a statement record's RFC 8785
 * form, signature included: what the next statement names as `previous`.
 */
export const statementRecordSha256 = (record: BTPStatementRecord): string => sha256Of(record);

/**
 * Since 1.2: an agreement signed by its originator, over the RFC 8785 form of
 * `{ originator, id, contentSha256 }`. Every signer's copy carries the same.
 */
export const signAgreement = async (
  content: Omit<BTPAgreementDoc, 'originatorSignature'>,
  by: { originator: string; selector: string } & SigningKey,
): Promise<BTPAgreementDoc> => ({
  ...content,
  originatorSignature: {
    selector: by.selector,
    signature: await sign(agreementRef(content, by.originator), by),
  },
});

/** Since 1.2: whether an agreement's `originatorSignature` is its originator's, over its own content. */
export const originatorSignatureValid = (
  agreement: BTPAgreementDoc,
  originator: string,
  keyOf: BTPKeyOf,
): boolean => {
  const { selector, signature } = agreement.originatorSignature;
  return isValid(agreementRef(agreement, originator), signature, keyOf(originator, selector));
};

/** Since 1.2: a statement signed with the signer's identity key, which may be one its provider holds. */
export const signStatement = async (
  statement: BTPAgreementStatement,
  by: { selector: string } & SigningKey,
): Promise<BTPStatementRecord> => ({
  statement,
  selector: by.selector,
  signature: await sign(statement, by),
});

/**
 * Since 1.2: a statement signed with a device's key. Its record is complete
 * once the originator adds the delegated artifact that delivered it
 * (`deviceStatementRecord`).
 */
export const signStatementOnDevice = async (
  statement: BTPAgreementStatement,
  device: SigningKey,
): Promise<{ statement: BTPAgreementStatement; signature: BTPSignature }> => ({
  statement,
  signature: await sign(statement, device),
});

/** Since 1.2: a device's statement with the delegated artifact that delivered it, as it arrived. */
export const deviceStatementRecord = (
  signed: { statement: BTPAgreementStatement; signature: BTPSignature },
  delegatedArtifact: Extract<
    BTPStatementRecord,
    { delegatedArtifact: object }
  >['delegatedArtifact'],
): BTPStatementRecord => ({ ...signed, delegatedArtifact });

/**
 * Since 1.2: what a statement record's signature shows, from the record alone
 * and the keys `keyOf` gives. A device-signed record holds when the delegation
 * is its delegator's over the artifact, a self-delegation (signed by the
 * signer itself) carries an attestation, any attestation is its attestor's,
 * the artifact came from the signer and is signed by the delegated key, and so
 * is the statement. Every one of these is checked offline. Whether the
 * delegator or the attestor is the signer's domain's operator needs DNS
 * (`_btps.host` `op`): it is not checked here, and `delegatedBy` and
 * `attestedBy` report who they are.
 */
export const statementSignatureFacts = (
  record: BTPStatementRecord,
  keyOf: BTPKeyOf,
): BTPStatementSignatureFacts => {
  const { statement, signature } = record;
  if (!record.delegatedArtifact) {
    return {
      signatureValid: isValid(statement, signature, keyOf(statement.signer, record.selector)),
      keyKind: 'identity',
    };
  }
  const { delegation, ...artifact } = record.delegatedArtifact;
  // The delegation is signed before it is attested: the attestation is not part of what it signed.
  const { signature: delegationSignature, attestation, ...unsignedDelegation } = delegation;
  const { signature: artifactSignature, ...unsignedArtifact } = artifact;
  // A server refuses a self-delegation without an attestation, so this does too.
  const selfDelegated = sameIdentity(delegation.signedBy, artifact.from);
  const signatureValid =
    sameIdentity(artifact.from, statement.signer) &&
    (!selfDelegated || attestation !== undefined) &&
    isValid(
      { ...artifact, delegation: unsignedDelegation },
      delegationSignature,
      keyOf(delegation.signedBy, delegation.selector),
    ) &&
    attestationHolds(delegation, keyOf) &&
    isValid(unsignedArtifact, artifactSignature, delegation.agentPubKey) &&
    isValid(statement, signature, delegation.agentPubKey);
  return {
    signatureValid,
    keyKind: 'device',
    delegatedBy: delegation.signedBy,
    ...(attestation && { attestedBy: attestation.signedBy }),
  };
};

/** A delegation's attestation, when it has one, signed by its attestor over the signed delegation. */
const attestationHolds = ({ attestation, ...delegation }: BTPDelegation, keyOf: BTPKeyOf) => {
  if (!attestation) return true;
  const { signature, ...unsigned } = attestation;
  return isValid(
    { ...delegation, attestation: unsigned },
    signature,
    keyOf(attestation.signedBy, attestation.selector),
  );
};

/**
 * Since 1.2: why an answer does not follow its agreement's signers and order,
 * from its sender, the `previous` it names, and what the originator holds; or
 * undefined. A server runs it on the readable facts of an answer's envelope,
 * with its store's `getAgreement`; `agreementStatementProblem` runs it on an
 * opened statement.
 */
export const agreementOrderProblem = (
  answer: { from: string; previous?: string },
  held: BTPAgreementState,
): string | undefined => {
  const { from, previous } = answer;
  if (!held.signers.some((signer) => sameIdentity(signer, from))) {
    return 'only a listed signer answers';
  }
  if (held.answered.some(({ signer }) => sameIdentity(signer, from))) {
    return 'an answer is final: a signer answers once';
  }
  if (held.signingOrder === 'any') {
    return previous === undefined ? undefined : 'previous is only in a sequential agreement';
  }
  if (held.answered.some(({ decision }) => decision === 'declined')) {
    return 'a declined ends a sequential agreement';
  }
  const next = held.signers[held.answered.length];
  if (next === undefined || !sameIdentity(next, from)) {
    return 'in a sequential agreement the signers answer in list order';
  }
  const last = held.answered[held.answered.length - 1];
  if (previous === last?.sha256) return undefined;
  return last
    ? 'previous is the SHA-256 of the statement record before it'
    : 'the first statement names no previous';
};

const sameRef = (a: BTPAgreementRef, b: BTPAgreementRef) =>
  sameIdentity(a.originator, b.originator) && a.id === b.id && a.contentSha256 === b.contentSha256;

/**
 * Since 1.2: why an opened answer does not answer its agreement, or undefined.
 * `envelope` is the answer's own (`from`, `to`, its readable `agreement`
 * facts), `agreement` the receiver's copy, and `earlier` the statement records
 * it has already taken, in order. The statement names this agreement and its
 * terms exactly, is its sender's own, is signed by the deadline, follows the
 * signers' order, and matches its envelope. Signatures are not part of this:
 * `statementSignatureFacts` checks them.
 */
export const agreementStatementProblem = (
  envelope: { from: string; to: string; agreement?: BTPAgreementFacts },
  event: { eventType: string; agreement: BTPAgreementRef; statement?: BTPStatementRecord },
  agreement: BTPAgreementDoc,
  earlier: readonly BTPStatementRecord[],
): string | undefined => {
  const record = event.statement;
  if (record === undefined) return 'only an answer carries a statement';
  const { statement } = record;
  if (statement.decision !== event.eventType) {
    return "an answer's eventType is its statement's decision";
  }
  if (!sameRef(event.agreement, statement.agreement)) {
    return "the event's agreement is its statement's";
  }
  if (!sameRef(statement.agreement, agreementRef(agreement, envelope.to))) {
    return 'a statement names its own agreement: its originator, id and contentSha256';
  }
  const facts = envelope.agreement;
  if (
    facts?.id !== statement.agreement.id ||
    facts.contentSha256 !== statement.agreement.contentSha256 ||
    facts.previous !== statement.previous
  ) {
    return "the envelope's agreement facts are the statement's";
  }
  if (!sameIdentity(envelope.from, statement.signer)) {
    return 'a statement is sent by its own signer';
  }
  const { by, terms, signers, signingOrder } = agreement.acceptance;
  if (statement.terms.length !== terms.length || statement.terms.some((t, i) => t !== terms[i])) {
    return "a statement repeats the agreement's terms exactly";
  }
  if (by !== undefined && Date.parse(statement.signedAt) > Date.parse(by)) {
    return 'signedAt is no later than acceptance.by';
  }
  return agreementOrderProblem(
    { from: statement.signer, previous: statement.previous },
    {
      signers: signers.map(({ address }) => address),
      signingOrder,
      answered: earlier.map((before) => ({
        signer: before.statement.signer,
        decision: before.statement.decision,
        sha256: statementRecordSha256(before),
      })),
    },
  );
};
