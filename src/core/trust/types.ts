/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export interface TrustStoreOptions {
  connection: unknown; // could be file path, MongoClient, Sequelize, etc.
  entityName?: string; // e.g. 'trustedSenders', 'trust_rejections'
}

export type BTPTrustStatus = 'accepted' | 'rejected' | 'revoked' | 'pending' | 'blocked';
export type BTPTrustDecisionType = Exclude<BTPTrustStatus, 'pending'>;
export type BTPEncryptionType = 'unencrypted' | 'encrypted' | 'mixed';

export type KeyHistory = {
  // happens due to pub and priv key rolling update
  fingerprint: string; // previous public fingerPrint
  firstSeen: string; // date and time it was first used by the identity
  lastSeen: string; // date and time it was last used by the identity
};

export type BTPTrustRecord = {
  id: string; // unique trust id in format 'from:to'using computeTrustId
  senderId: string; // unique btp from identity in format 'user$domain.com
  receiverId: string; // unique btp to identity in format 'user$domain.com
  status: BTPTrustStatus; // current trust status
  createdAt: string; // trust record creation date and time in ISO Format
  decidedBy: string; // Name | Initial | email of the deciding authoritarian person
  decidedAt: string; // date and time of the decision made in ISO Format
  expiresAt?: string; // @optional expiry date of the trust record in ISO Format
  publicKeyBase64: string; // current base64 public key of the identity
  publicKeyFingerprint: string; // current public key fingerprint of the identity
  keyHistory: KeyHistory[]; // History record of the pub and fingerprint
  privacyType: BTPEncryptionType; // Privacy type to be sent based on this agreed trust
  retryAfterDate?: string; // @optional Retry date of the future in ISO Format. Useful to block revoked and rejected trust sending new trust request
  metadata?: Record<string, unknown>; // @optional Metadata of the trust record
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
  message?: string; // @optional message from the requesting party
  expiresAt?: string; // @optional expiry date and time for the trust to last in ISO Format
  privacyType?: BTPEncryptionType; // @optional Privacy type to be upheld for communicating for this trust
}

export interface BTPTrustResDoc {
  id: string; // Random unique Id
  decision: BTPTrustDecisionType;
  decidedAt: string;
  decidedBy: string;
  expiresAt?: string;
  retryAfterDate?: string;
  message?: string;
  privacyType?: BTPEncryptionType;
}
