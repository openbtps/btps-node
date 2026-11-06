/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPStorageRecord } from '@core/storage/types.js';
import type {
  BTPDetailPermission,
  BTPPermissionName,
  BTPTrustPermissions,
} from '@core/server/types.js';

export type BTPTrustStatus = 'accepted' | 'rejected' | 'revoked' | 'pending' | 'blocked';
export type BTPTrustDecisionType = Exclude<BTPTrustStatus, 'pending'>;
export type BTPEncryptionType = 'unencrypted' | 'encrypted' | 'mixed';

/** What a platform holds of a lifecycle event between two parties, as its store's `getEvent` answers. */
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
}

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
