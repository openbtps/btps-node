/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPStorageRecord } from '@core/storage/types.js';
import type { BTPSignature } from '@core/crypto/types.js';
import type {
  BTPDelegation,
  BTPDetailPermission,
  BTPPermissionName,
  BTPTransporterArtifact,
  BTPTrustPermissions,
} from '@core/server/types.js';

export type BTPTrustStatus = 'accepted' | 'rejected' | 'revoked' | 'pending' | 'blocked';
export type BTPTrustDecisionType = Exclude<BTPTrustStatus, 'pending'>;
export type BTPEncryptionType = 'unencrypted' | 'encrypted' | 'mixed';

/** What a platform holds of a lifecycle event between two parties, as its `eventChainCheck` lookup answers. */
export type BTPEventFacts = {
  eventType: string;
  /** Who sent it */
  from: string;
  /** The invoice it is about: its issuer and id, as the event's own `document` names it */
  document: { from: string; id: string };
  /** A proposal is open until it is answered or withdrawn; any other event is answered. */
  state: 'open' | 'answered' | 'withdrawn';
};

export type KeyHistory = {
  // happens due to pub and priv key rolling update
  fingerprint: string; // previous public fingerPrint
  firstSeen: string; // date and time it was first used by the identity
  lastSeen: string; // date and time it was last used by the identity
};

export type BTPTrustRecord = Omit<BTPStorageRecord, 'updatedAt'> & {
  senderId: string; // unique btps from identity in format 'user$domain.com
  receiverId: string; // unique btps to identity in format 'user$domain.com
  status: BTPTrustStatus; // current trust status
  decidedBy: string; // Name | Initial | email of the deciding authoritarian person
  decidedAt: string; // date and time of the decision made in ISO Format
  expiresAt?: string; // @optional expiry date of the trust record in ISO Format
  publicKeyBase64: string; // current base64 public key of the identity
  publicKeyFingerprint: string; // current public key fingerprint of the identity
  keyHistory: KeyHistory[]; // History record of the pub and fingerprint
  privacyType: BTPEncryptionType; // Privacy type to be sent based on this agreed trust
  retryAfterDate?: string; // @optional Retry date of the future in ISO Format. Useful to block revoked and rejected trust sending new trust request
  metadata?: Record<string, unknown>; // @optional Metadata of the trust record
  permissions?: BTPTrustRecordPermissions; // since 1.2: written by the platform; without it, a 1.1 trust
};

export interface BTPTrustReqDoc {
  id: string; // Random unique Id
  name: string; // Name of the requesting party requesting for the trust
  email: string; // Email address of the requesting party requesting for the trust
  reason: string; // Reason for requesting for trust
  phone: string; // Phone number of the requesting party requesting for the trust
  address?: string; // @optional Address of the requesting party requesting for the trust
  logoUrl?: string; // @optional Business or requesting party's logo or public image
  displayName?: string; // @optional Display name or profile name of the requesting party
  websiteUrl?: string; // @optional website address url of the requesting party
  message?: string | { format: 'text' | 'markdown'; content: string }; // @optional message from the requesting party; a note with a format since 1.2
  expiresAt?: string; // @optional expiry date and time for the trust to last in ISO Format
  privacyType?: BTPEncryptionType; // @optional Privacy type to be upheld for communicating for this trust
  own?: BTPDetailValues; // since 1.2: the values of the details given that 1.1 has no field for, by name; encrypted
  verification?: BTPVerification; // since 1.2: a provider's signed statement of what it checked; encrypted
}

/** Since 1.2: what a verification says was checked: the sender's kind, and details by name in their shapes. */
export type BTPVerificationClaims = { entityType?: 'person' | 'organisation' } & BTPDetailValues;

/**
 * Since 1.2: a provider's signed statement that it checked a sender. Signed by
 * `verifiedBy` at `selector` over the RFC 8785 form of `{ subject, claims,
 * verifiedAt, expiresAt, verifiedBy, selector }`, where `subject` is the
 * request's `from`, so it cannot be copied into anyone else's request.
 */
export type BTPVerification = {
  verifiedBy: string;
  claims: BTPVerificationClaims;
  verifiedAt: string;
  expiresAt: string;
  selector: string;
  signature: BTPSignature;
};

/**
 * Since 1.2: the facts about a verification, for its receiver to decide on.
 * BTPS refuses nothing because of them and labels no one verified.
 */
export type BTPVerificationFacts = {
  /** The signature is `verifiedBy`'s, over this sender's address and these claims */
  signatureValid: boolean;
  /** `expiresAt` has passed */
  expired: boolean;
  /** `verifiedBy` is on the domain of the operator named in the sender's `_btps.host` */
  verifierServesSender: boolean;
  /** `verifiedBy` is that operator: the serving provider's own signing identity */
  verifierIsOperator: boolean;
};

/** Since 1.2: a key in a key rotation record. */
export type BTPRotatedKey = {
  selector: string;
  /** SHA-256 of the key's DER SPKI, base64; a verifier computes it from `publicKey` */
  fingerprint: string;
  /** The key's DER SPKI, base64, as a DNS key record's `p=` */
  publicKey: string;
};

export type BTPKeyExpiryReason = 'compromised' | 'lost';

/** Since 1.2: what a key rotation record signs: the identity's key `from` hands over to `to`. */
export type BTPKeyRotation = {
  type: 'btps.keyRotation.v1';
  identity: string;
  from: BTPRotatedKey;
  to: BTPRotatedKey;
  /** When `to` starts signing */
  at: string;
  /** SHA-256 of the previous record's signed object, lowercase hex; null on the first record only */
  prev: string | null;
} & (
  | { expiry: 'planned' }
  | { expiry: 'immediate'; compromisedSince: string; reason: BTPKeyExpiryReason }
);

/** Since 1.2: what a key expiry record signs: a key the identity already rotated away from, found compromised. */
export type BTPKeyExpiry = {
  type: 'btps.keyExpiry.v1';
  identity: string;
  key: { selector: string; fingerprint: string };
  compromisedSince: string;
  reason: BTPKeyExpiryReason;
  at: string;
  prev: string;
};

/** `from` and `to` sign a rotation; the identity's `current` key signs an expiry. */
export type BTPKeyChainSignature = BTPSignature & { by: 'from' | 'to' | 'current' };

/** Since 1.2: one record of an identity's key chain, with an optional RFC 3161 token over the same bytes. */
export type BTPKeyChainRecord =
  | { rotation: BTPKeyRotation; signatures: BTPKeyChainSignature[]; timestamp?: string }
  | { expiry: BTPKeyExpiry; signatures: BTPKeyChainSignature[]; timestamp?: string };

/** Since 1.2: one key of a verified chain, and its window. */
export type BTPKeyChainKey = {
  selector: string;
  fingerprint: string;
  /** SPKI PEM */
  publicKey: string;
  /** The `at` of the record that introduced it; none for the chain's start */
  validFrom?: string;
  /** The `at` of the rotation away from it; none for the current key */
  validUntil?: string;
  /** How it was rotated away, if it was */
  rotatedAway?: 'planned' | 'immediate';
  /** Set by a rotation with immediate expiry, or by an expiry record */
  compromisedSince?: string;
  reason?: BTPKeyExpiryReason;
  /** When the expiry was declared: the record's own `at` */
  expiredAt?: string;
};

/**
 * Since 1.2: what DNS says of an identity, for checking its key chain online.
 * - `hostOnly`: there is no DNS key record for the identity at the domain's
 *   current `s=`; its keys are its host's to answer, so the operator's signed
 *   answer anchors its chain.
 * - `published`: the fingerprints of the keys DNS publishes for the identity,
 *   at the chain's last `to.selector` and at the domain's `s=`, empty when
 *   neither has one. The chain anchors only when its last key is one of them.
 * "No record where the chain ends" is `published` with no fingerprints, never
 * `hostOnly`: otherwise a host could anchor a chain of its own making.
 */
export type BTPKeyChainDns = { kind: 'hostOnly' } | { kind: 'published'; fingerprints: string[] };

/** Since 1.2: the facts about a key chain. It decides nothing; `keyChainProblem` is the online refusal. */
export type BTPKeyChainFacts = {
  /** Every record is well-formed and signed as its kind requires, `prev` links hold, and the chain rules hold */
  chainValid: boolean;
  /** The first rule broken, when not valid */
  problem?: string;
  /** A rotation without its `from` signature (a lost key) whose authority the anchor cannot confirm */
  authorityUnverified: boolean;
  /** A key has two successors */
  forked: boolean;
  /** The chain's keys in order, start first: the only path, or the one branch an anchor picks; empty otherwise */
  keys: BTPKeyChainKey[];
  /** Each branch's last key, when forked; `void` when its first record is signed by a key expired at the time */
  branches?: { tip: string; void: boolean }[];
  /** What confirms the chain, and up to which key: a kept fingerprint anchors itself and the records leading to it */
  anchored: { by: 'kept-fingerprint' | 'online'; upTo: string } | false;
};

/** Since 1.2: an agreement, by its originator, its id and the SHA-256 of its content. */
export type BTPAgreementRef = { originator: string; id: string; contentSha256: string };

/**
 * Since 1.2: an agreement's signers in order, how they answer, and the answers
 * its originator's platform has taken, in order, each by the SHA-256 of its
 * record: what `agreementOrderProblem` checks an answer against.
 */
export type BTPAgreementAnswers = {
  signers: string[];
  signingOrder: 'any' | 'sequential';
  answered: { signer: string; decision: 'accepted' | 'declined'; sha256: string }[];
};

/**
 * Since 1.2: a signer's answer to an agreement, signed over its RFC 8785 form.
 * `previous`, in a sequential agreement, is the SHA-256 of the statement
 * record before it.
 */
export type BTPAgreementStatement = {
  agreement: BTPAgreementRef;
  terms: string[];
  signer: string;
  decision: 'accepted' | 'declined';
  signedAt: string;
  previous?: string;
};

/**
 * Since 1.2: a signed statement. Signed by the signer's identity key at
 * `selector`, or by its device key, when it carries the whole delegated
 * artifact that delivered it, as it arrived.
 */
export type BTPStatementRecord = { statement: BTPAgreementStatement; signature: BTPSignature } & (
  | { selector: string; delegatedArtifact?: never }
  | {
      delegatedArtifact: BTPTransporterArtifact & { delegation: BTPDelegation };
      selector?: never;
    }
);

/** Since 1.2: what a statement record's signature shows. BTPS reports these and decides nothing. */
export type BTPStatementSignatureFacts = {
  /** The statement is signed by its signer's key, or by a device its delegation vouches for */
  signatureValid: boolean;
  /** Which kind of key signed it, from the record itself */
  keyKind: 'identity' | 'device';
  /** For a device: who signed its delegation, and who attested it, if anyone */
  delegatedBy?: string;
  attestedBy?: string;
};

/** Since 1.2: a tax or registration number, for any country (ISO 3166-1 alpha-2, e.g. `AU`). */
export type BTPNumberInCountry = { number: string; country: string };

/** Since 1.2: a display or trading name, picture or logo, and website: `detail:profile`. */
export type BTPDetailProfile = {
  displayName: string;
  logo?: { sha256: string; source: string };
  website?: string;
};

/** Since 1.2: the value each detail permission carries. */
export type BTPDetailValueOf = {
  'detail:legalName': string;
  'detail:profile': BTPDetailProfile;
  'detail:email': string;
  'detail:phone': string;
  'detail:address': string;
  'detail:taxNo': BTPNumberInCountry;
  /** `YYYY-MM-DD` */
  'detail:dob': string;
  'detail:registrationNumber': BTPNumberInCountry;
};

/** Since 1.2: detail values by permission name, e.g. `{ "detail:dob": "1990-04-21" }`. */
export type BTPDetailValues = { [Name in keyof BTPDetailValueOf]?: BTPDetailValueOf[Name] };

/**
 * Since 1.2: a trust record's permissions, written by the platform, never the
 * BTPS server, which only reads them. `trustPermissionsFromRequest` and
 * `trustPermissionsFromResponse` compute them for the platform to save.
 */
export type BTPTrustRecordPermissions = {
  /** What the request asked for */
  requested: BTPTrustPermissions;
  /** What the answer granted: the `send:` names checked on each document, and the details given */
  granted: BTPPermissionName[];
  /** The other side's details this side holds */
  detailsHeld: BTPDetailPermission[];
  /** This side's details the other side holds */
  detailsShared: BTPDetailPermission[];
  /** A change sent on an active trust, until it is answered */
  pendingChange?: { requested: BTPTrustPermissions; requestedAt: string };
};

export interface BTPTrustResDoc {
  id: string; // Random unique Id
  decision: BTPTrustDecisionType;
  decidedAt: string;
  decidedBy: string;
  expiresAt?: string;
  retryAfterDate?: string;
  message?: string | { format: 'text' | 'markdown'; content: string }; // a note with a format since 1.2
  privacyType?: BTPEncryptionType;
  details?: BTPDetailValues; // since 1.2: the value of every detail granted, by name; encrypted
}
