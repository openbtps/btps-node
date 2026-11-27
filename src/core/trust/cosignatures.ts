/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2 (rc.4): cosignatures. A party's signed statement about a document travels outside the event's encrypted
 * document, the way BTPS signs everything else: encrypted first, then signed (signEncrypt, decryptVerify). Its
 * statement is encrypted once, to the originator and every signer, and its signer signs the cosignature over that
 * ciphertext and the statement's SHA-256. The originator forwards it unchanged, so every BTPS server on the way
 * checks its signature on receipt (cosignaturesProblem), without decrypting; whoever decrypts it checks that what it
 * opened is exactly what was signed (openCosignature).
 */

import crypto from 'crypto';
import {
  decryptRSA,
  encryptRSA,
  getFingerprintFromPem,
  signBtpPayload,
  signBtpPayloadWithSigner,
  verifySignature,
} from '@core/crypto/index.js';
import { canonicalizeValue } from '@core/crypto/jcs.js';
import type { BTPSignature, PemKeys } from '@core/crypto/types.js';
import type { BTPDecryptionKey } from '@core/crypto/types.js';
import type { Signer } from '@core/crypto/signer-interface.js';
import { BTPS_FIELD_LIMITS } from '@core/server/constants/limits.js';
import { BtpCosignedStatementSchema } from '@core/server/schemas/btpsDocsSchema.js';
import { sameIdentity } from '@core/server/schemas/helpers.js';
import type { BTPTransporterArtifact } from '@core/server/types.js';
import type { BTPAgreementRef, BTPAgreementStatement, BTPCosignature } from './types.js';

/** A key to sign with: a PEM pair, or a Signer for a key held elsewhere. */
type SigningKey = { pemFiles: PemKeys } | { signer: Signer };

/**
 * The public key (PEM) of `identity` at `selector` whose fingerprint is `fingerprint`, or undefined: DNS, key chains.
 * `forwarded` is true for a cosignature an earlier artifact first delivered (its `artifactId` is not the carrier's):
 * its key is taken by its history, so a key since rotated away as planned still holds and only a compromised one is
 * refused, as an evidence bundle takes it. A cosignature made now is held to the live rules.
 */
export type BTPCosignatureKeyOf = (
  identity: string,
  selector: string,
  fingerprint: string,
  forwarded: boolean,
) => Promise<string | undefined>;

const sha256Hex = (text: string) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** What a cosignature's signature is over: all of it but its signature and a forwarded device's delegated artifact. */
export const cosignatureSignedPart = (cosignature: BTPCosignature) =>
  Object.fromEntries(
    Object.entries(cosignature).filter(
      ([key]) => key !== 'signature' && key !== 'delegatedArtifact',
    ),
  );

/**
 * Since 1.2 (rc.4): the SHA-256, lowercase hex, of a cosignature's RFC 8785 form, signature included, without a
 * forwarded device's delegated artifact (added after it was signed): what the next one names as `previous`.
 */
export const cosignatureSha256 = (cosignature: BTPCosignature): string =>
  sha256Hex(
    canonicalizeValue(
      Object.fromEntries(
        Object.entries(cosignature).filter(([key]) => key !== 'delegatedArtifact'),
      ),
    ),
  );

/**
 * Since 1.2 (rc.4): a statement as a cosignature encrypts it, as exact text: RFC 8785 of `{ statement, padding }`,
 * `padding` being '0's up to the next multiple of the bucket (BTPS_FIELD_LIMITS.agreement.statementPaddingBucket), so
 * its length does not tell its decision. The same statement always gives the same text: an evidence bundle keeps it.
 */
export const cosignedStatementText = (statement: BTPAgreementStatement): string => {
  const bucket = BTPS_FIELD_LIMITS.agreement.statementPaddingBucket;
  const bare = canonicalizeValue({ statement, padding: '' });
  return canonicalizeValue({
    statement,
    padding: '0'.repeat((bucket - (bare.length % bucket)) % bucket),
  });
};

const sign = (payload: unknown, key: SigningKey): Promise<BTPSignature> =>
  'signer' in key
    ? signBtpPayloadWithSigner(payload, key.signer)
    : Promise.resolve(signBtpPayload(payload, key.pemFiles));

/**
 * Since 1.2 (rc.4): a signer's cosignature on `statement`, encrypted to every one of `recipients` (the originator,
 * each signer, and the signer itself, by their public keys, PEM) and signed. `selector` is the signer's identity key's;
 * a device leaves it out and signs with its own key, in the delegated artifact that delivers it. The statement's
 * `artifactId` is that artifact's id, and its `previous` the SHA-256 (cosignatureSha256) of the one before it.
 */
export const cosign = async (input: {
  statement: BTPAgreementStatement;
  recipients: { identity: string; publicKey: string }[];
  by: { selector?: string } & SigningKey;
}): Promise<BTPCosignature> => {
  const { statement, recipients, by } = input;
  const text = cosignedStatementText(statement);
  const contentKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const unsigned = {
    ref: { ...statement.agreement, originator: statement.agreement.originator.toLowerCase() },
    signer: statement.signer.toLowerCase(),
    ...(by.selector !== undefined && { selector: by.selector }),
    artifactId: statement.artifactId,
    ...(statement.previous !== undefined && { previous: statement.previous }),
    statementSha256: sha256Hex(text),
    recipients: recipients
      .map(({ identity, publicKey }) => ({
        identity: identity.toLowerCase(),
        fingerprint: getFingerprintFromPem(publicKey, 'sha256'),
        wrappedKey: encryptRSA(publicKey, contentKey).toString('base64'),
      }))
      .sort((a, b) => (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0)),
    encryption: {
      algorithm: 'aes-256-gcm' as const,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    },
    ciphertext: ciphertext.toString('base64'),
  };
  return { ...unsigned, signature: await sign(unsigned, by) } as BTPCosignature;
};

/** A key lookup for one cosignature, whether it is forwarded already decided. */
type KeyFor = (
  identity: string,
  selector: string,
  fingerprint: string,
) => Promise<string | undefined>;

const isValid = (payload: unknown, signature: BTPSignature, key: string | undefined) =>
  key !== undefined && verifySignature(payload, signature, key).isValid;

const sameRef = (a: BTPAgreementRef, b: BTPAgreementRef) =>
  sameIdentity(a.originator, b.originator) && a.id === b.id && a.contentSha256 === b.contentSha256;

/** Why a forwarded device's cosignature is not its device's, under the delegation of the artifact that delivered it. */
const deviceProblem = async (
  cosignature: BTPCosignature & {
    delegatedArtifact: NonNullable<BTPCosignature['delegatedArtifact']>;
  },
  keyOf: KeyFor,
): Promise<string | undefined> => {
  const { delegation, ...artifact } = cosignature.delegatedArtifact;
  const { signature: delegationSignature, attestation, ...unsignedDelegation } = delegation;
  const { signature: artifactSignature, ...unsignedArtifact } = artifact;
  if (!sameIdentity(artifact.from, cosignature.signer))
    return 'a device cosignature is sent by its signer';
  if (artifact.id !== cosignature.artifactId)
    return 'a device cosignature names the delegated artifact that delivered it';
  // A server refuses a self-delegation without an attestation, so this does too.
  if (sameIdentity(delegation.signedBy, artifact.from) && attestation === undefined) {
    return 'a self-delegation carries an attestation';
  }
  const delegator = await keyOf(
    delegation.signedBy,
    delegation.selector,
    delegationSignature.fingerprint,
  );
  if (!isValid({ ...artifact, delegation: unsignedDelegation }, delegationSignature, delegator)) {
    return "a device cosignature's delegation is its delegator's";
  }
  if (attestation) {
    const { signature, ...unsigned } = attestation;
    const attestor = await keyOf(attestation.signedBy, attestation.selector, signature.fingerprint);
    if (!isValid({ ...delegation, attestation: unsigned }, signature, attestor)) {
      return "a device cosignature's attestation is its attestor's";
    }
  }
  if (!isValid(unsignedArtifact, artifactSignature, delegation.agentPubKey)) {
    return 'a device cosignature came in an artifact its device signed';
  }
  return isValid(cosignatureSignedPart(cosignature), cosignature.signature, delegation.agentPubKey)
    ? undefined
    : 'a device cosignature is signed by its device';
};

/** Why one cosignature's signature is not its signer's, or undefined. */
const signatureProblem = async (
  cosignature: BTPCosignature,
  artifact: BTPTransporterArtifact,
  keyOf: KeyFor,
): Promise<string | undefined> => {
  if (cosignature.selector !== undefined) {
    const key = await keyOf(
      cosignature.signer,
      cosignature.selector,
      cosignature.signature.fingerprint,
    );
    return isValid(cosignatureSignedPart(cosignature), cosignature.signature, key)
      ? undefined
      : 'a cosignature is signed by its signer';
  }
  if (cosignature.delegatedArtifact !== undefined) {
    return deviceProblem(cosignature as Parameters<typeof deviceProblem>[0], keyOf);
  }
  // Neither: a device's, in the delegated artifact that first delivers it. The server checked that delegation.
  if (
    !artifact.delegation ||
    artifact.id !== cosignature.artifactId ||
    !sameIdentity(artifact.from, cosignature.signer)
  ) {
    return "a cosignature names its signer's key, or comes in its device's own delegated artifact";
  }
  return isValid(
    cosignatureSignedPart(cosignature),
    cosignature.signature,
    artifact.delegation.agentPubKey,
  )
    ? undefined
    : 'a device cosignature is signed by its device';
};

/**
 * Since 1.2 (rc.4): why the cosignatures `artifact` carries are not what they say, or undefined, checked as a BTPS
 * server checks them on receipt, without decrypting. Each is signed by its signer (or a device its delegation vouches
 * for); all name one document; no signer appears twice; each one that names `previous` follows the one before it.
 * Its document's originator forwards any of them (its own among them, when it signs too); anyone else carries only its
 * own answer, delivered by that artifact (`artifactId`).
 */
export const cosignaturesProblem = async (
  artifact: BTPTransporterArtifact,
  keyOf: BTPCosignatureKeyOf,
): Promise<string | undefined> => {
  const cosignatures = artifact.cosignatures;
  if (cosignatures === undefined) return undefined;
  if (artifact.type !== 'BTPS_EVENT') return 'only a BTPS_EVENT carries cosignatures';
  const [first] = cosignatures;
  if (first === undefined) return 'cosignatures are at least one';
  if (cosignatures.some(({ ref }) => !sameRef(ref, first.ref)))
    return 'cosignatures name one document';
  const signers = cosignatures.map(({ signer }) => signer.toLowerCase());
  if (new Set(signers).size !== signers.length) return 'a signer cosigns once';
  // Its originator forwards any of them, its own among them when it signs too; anyone else carries its own answer only.
  if (!sameIdentity(artifact.from, first.ref.originator)) {
    const own = cosignatures.find(({ signer }) => sameIdentity(signer, artifact.from));
    if (own === undefined) return "cosignatures are forwarded by their document's originator";
    if (cosignatures.length !== 1) return "a signer's answer carries its own cosignature only";
    if (own.artifactId !== artifact.id)
      return "a signer's cosignature names the artifact that delivers it";
  }
  for (const [index, cosignature] of cosignatures.entries()) {
    const before = cosignatures[index - 1];
    if (
      before !== undefined &&
      cosignature.previous !== undefined &&
      cosignature.previous !== cosignatureSha256(before)
    ) {
      return 'a cosignature that names previous follows the one before it';
    }
    const forwarded = cosignature.artifactId !== artifact.id;
    const problem = await signatureProblem(
      cosignature,
      artifact,
      (identity, selector, fingerprint) => keyOf(identity, selector, fingerprint, forwarded),
    );
    if (problem) return problem;
  }
  return undefined;
};

const unwrap = async (wrappedKey: string, key: BTPDecryptionKey): Promise<Buffer | undefined> => {
  const wrapped = Buffer.from(wrappedKey, 'base64');
  try {
    if (typeof key === 'string') return decryptRSA(key, wrapped);
    return key.unwrapKey ? Buffer.from(await key.unwrapKey(wrapped)) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Since 1.2 (rc.4): the statement in `cosignature`, opened by `receiver` with its key: undefined when it is not one of
 * its recipients; a problem when it is and the statement does not open, or is not exactly what was signed (its
 * SHA-256, its RFC 8785 form) and what its cosignature says (its document, signer, artifact and previous).
 */
export const openCosignature = async (
  cosignature: BTPCosignature,
  receiver: {
    identity: string;
    key: BTPDecryptionKey;
    /** On a device: the content key its provider wrapped again to the device key (`agentKey.cosignatureKeys`). */
    wrappedKey?: string;
  },
): Promise<{ statement: BTPAgreementStatement } | { problem: string } | undefined> => {
  const recipient = cosignature.recipients.find(({ identity }) =>
    sameIdentity(identity, receiver.identity),
  );
  if (recipient === undefined) return undefined;
  const contentKey = await unwrap(receiver.wrappedKey ?? recipient.wrappedKey, receiver.key);
  if (contentKey === undefined) return { problem: 'its content key does not open with your key' };
  let text: string;
  try {
    const { iv, authTag } = cosignature.encryption;
    const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    text = Buffer.concat([
      decipher.update(Buffer.from(cosignature.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return { problem: 'its statement does not open' };
  }
  return statementOfText(cosignature, text);
};

/**
 * Since 1.2 (rc.4): why `value` is not a cosignature's opened statement, `{ statement, padding }`, as the protocol
 * holds one: the statement's own rules (its decision, its visual signature and consent on an acceptance only, its
 * times and where it was signed from) and its padding. Undefined when it is.
 */
export const cosignedStatementProblem = (value: unknown): string | undefined => {
  const parsed = BtpCosignedStatementSchema.safeParse(value);
  return parsed.success ? undefined : parsed.error.issues.map((issue) => issue.message).join('; ');
};

/**
 * Since 1.2 (rc.4): the statement in `text`, a cosignature's opened statement as exact text (an evidence bundle keeps
 * it so), or the problem: not the text it signed (its SHA-256), not in its one form (RFC 8785), or not what its
 * cosignature says (its document, signer, artifact and previous).
 */
export const statementOfText = (
  cosignature: BTPCosignature,
  text: string,
): { statement: BTPAgreementStatement } | { problem: string } => {
  if (sha256Hex(text) !== cosignature.statementSha256)
    return { problem: 'its statement is not the one it signed' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { problem: 'its statement is not JSON' };
  }
  const opened = BtpCosignedStatementSchema.safeParse(parsed);
  if (!opened.success || canonicalizeValue(parsed) !== text)
    return { problem: 'its statement is not in its one form' };
  // Padded as it must be: '0's only, up to a whole bucket, as cosignedStatementText makes it of the statement as sent.
  if (text !== cosignedStatementText((parsed as { statement: BTPAgreementStatement }).statement))
    return { problem: 'its statement is not padded to its bucket' };
  const { statement } = opened.data;
  if (!sameRef(statement.agreement, cosignature.ref))
    return { problem: 'its statement names another document' };
  if (!sameIdentity(statement.signer, cosignature.signer))
    return { problem: "its statement is another signer's" };
  if (statement.artifactId !== cosignature.artifactId)
    return { problem: 'its statement names another artifact' };
  if (statement.previous !== cosignature.previous)
    return { problem: 'its statement follows another' };
  return { statement };
};
