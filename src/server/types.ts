/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { TlsOptions, TLSSocket } from 'tls';

import { BTPTrustRecord } from '@core/trust/index.js';
import { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import {
  BTPAgentArtifact,
  BTPControlArtifact,
  BTPIdentityLookupRequest,
  BTPServerResponse,
  BTPTransporterArtifact,
  CurrencyCode,
} from '@core/server/types.js';
import { BTPError } from '@core/error/types.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTPIdentityRecord } from '@core/storage/types.js';
import { AbstractIdentityStore } from '@core/storage/AbstractIdentityStore.js';
import type { Signer } from '@core/crypto/signer-interface.js';
import type { BtpsKeyResolver } from '@core/crypto/keyResolver.js';
import type { z } from 'zod';
import type {
  BtpAgreementDocSchema,
  BtpLetterDocSchema,
  BtpPayslipDocSchema,
} from '@core/server/schemas/btpsDocsSchema.js';

export interface BtpsTlsOptions extends TlsOptions {
  cert: string;
  key: string;
}

export interface BtpsServerOptions {
  /**
   * The server's own key, as a PEM key pair or a Signer holding it elsewhere (a KMS).
   * `selector` (since 1.2) is the selector its key is published under; `signAnswers` needs it.
   */
  serverIdentity:
    | {
        identity: string;
        publicKey: string;
        privateKey: string;
        selector?: string;
      }
    | {
        identity: string;
        signer: Signer;
        selector?: string;
      };
  /**
   * Since 1.2: sign every answer, errors included, as `serverIdentity` under its `selector`, so a
   * device that requires its server's signature (`requireSignedBy`) can read it. Off by default.
   * `serverIdentity` is the domain's operator, which signs identity-lookup answers too: one key pair.
   */
  signAnswers?: boolean;
  /**
   * Since 1.2: finds every key this server checks a signature with (a sender's, a delegator's,
   * an attestor's), so a provider can cache them. Without it, each is looked up in DNS, as before.
   */
  keyResolver?: BtpsKeyResolver;
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  tlsOptions: BtpsTlsOptions;
  identityStore?: AbstractIdentityStore<BTPIdentityRecord>;
  port?: number;
  onError?: (err: BTPErrorException) => void;

  /** Closes a connection after this long with no request being handled, in ms. Default 30000; no minimum. A connection is never closed while one of its requests is handled. */
  connectionTimeoutMs?: number;
  middlewarePath?: string; // Path to btps.middleware.mjs file
  /** The largest artifact this server can accept, in KB (1 KB = 1024 bytes). Default 5120 (5 MB), minimum 1024 (1 MB). */
  maxArtifactSizeKb?: number;
  /** How far an artifact's issuedAt may be from this server's clock, in seconds, either way. Default 300 (5 minutes), minimum 60. */
  maxArtifactAgeSeconds?: number;
  /** How many requests one connection may have handled at once; at the limit the server stops reading it until one finishes. A request is handled until its answer is written. Default 32, minimum 1. */
  maxInFlightPerConnection?: number;
  /** Since 1.2: how many lines in a row one connection may send that this server cannot read; it answers the last and ends the connection. Default 10, minimum 1. */
  maxConsecutiveInvalidLines?: number;
}

/** Since 1.2: a details request arrived: who asked whom for which details, and when. */
export interface BTPDetailsRequestedInfo {
  from: string;
  to: string;
  names: string[];
  /** ISO 8601 */
  at: string;
}

/** Since 1.2: a device's details response was taken to be sent: who gave whom which details, and when. */
export type BTPDetailsSharedInfo = BTPDetailsRequestedInfo;

/** Since 1.2: what `BtpsServer.on(…)` tells its listeners. */
export type BtpsServerEvents = {
  detailsRequested: (info: BTPDetailsRequestedInfo) => void;
  detailsShared: (info: BTPDetailsSharedInfo) => void;
};

// Middleware Types
export type Phase = 'before' | 'after';
export type Step =
  | 'parsing'
  | 'signatureVerification'
  | 'trustVerification'
  | 'onArtifact'
  | 'onError';

export interface MiddlewareConfig {
  name?: string;
  enabled?: boolean;
  options?: Record<string, unknown>;
}

export interface MiddlewareContext {
  dependencies: {
    trustStore: AbstractTrustStore<BTPTrustRecord>;
    identityStore?: AbstractIdentityStore<BTPIdentityRecord>;
    // Add other dependencies as needed
  };
  config: Record<string, unknown>;
  serverInstance: unknown; // Will be BtpsServer type
  currentTime: string;
}

export type BtpsErrorAction = 'destroy' | 'end';
export interface BTPContext {
  socket: TLSSocket;
  startTime: string;
  remoteAddress: string;
  rawPacket?: string;
  sendRes?: (res: BTPServerResponse) => void;
  sendError?: (err: BTPError, action?: BtpsErrorAction) => void;
}

export type SetRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

export type ArtifactResCtx = {
  sendRes: Required<BTPContext>['sendRes'];
  sendError: Required<BTPContext>['sendError'];
};

// Type helper to determine if artifact should be present
// Only in parsing phase (before/after) is artifact optional
// In all other phases/steps, artifact is required
//
type HasArtifact<_P extends Phase, S extends Step> = S extends 'parsing' ? false : true;
type HasReqId<_P extends Phase, S extends Step> = S extends 'parsing' ? false : true;

// Type helper to determine if isValid should be present
type HasIsValid<P extends Phase, S extends Step> = P extends 'after'
  ? S extends 'signatureVerification' | 'trustVerification' | 'onArtifact'
    ? true
    : false
  : S extends 'trustVerification' | 'onArtifact'
    ? true
    : false;

// Type helper to determine if isTrusted should be present
type HasIsTrusted<P extends Phase, S extends Step> = P extends 'after'
  ? S extends 'trustVerification' | 'onArtifact'
    ? true
    : false
  : S extends 'onArtifact'
    ? true
    : false;

// Type helper to determine if error should be present
type HasError<_P extends Phase, _S extends Step> = false; // Error is always optional

// Type helper to determine if rawPacket should be present
type HasRawPacket<P extends Phase, S extends Step> = S extends 'parsing'
  ? P extends 'before'
    ? false
    : true
  : false;

type HasIdentity<P extends Phase, S extends Step> = S extends 'parsing'
  ? P extends 'before'
    ? false
    : true
  : true;

// Utility type to add respondNow only for 'agent'
type WithRespondNow<K extends string, T> = K extends 'agent'
  ? { artifact: T; type: K; respondNow: boolean }
  : { artifact: T; type: K };

// Mapped type for strict correlation between 'type' and 'artifact'
type ArtifactMap = {
  transporter: BTPTransporterArtifact;
  agent: BTPAgentArtifact;
  identityLookup: BTPIdentityLookupRequest;
  control: BTPControlArtifact;
};

// Mapped type for processed artifacts (subset)
type ProcessedArtifactMap = {
  transporter: BTPTransporterArtifact;
  agent: BTPAgentArtifact;
};

export type PreProcessedArtifact = {
  [K in keyof ArtifactMap]: WithRespondNow<K, ArtifactMap[K]>;
}[keyof ArtifactMap];

export type ProcessedArtifact = {
  [K in keyof ProcessedArtifactMap]: WithRespondNow<K, ProcessedArtifactMap[K]>;
}[keyof ProcessedArtifactMap];

// Helper type for conditional artifact data
// Only before parsing gets PreProcessedArtifact, all others get ProcessedArtifact
// Used in BTPRequestCtx and BTPResponseCtx
type ArtifactDataType<_P extends Phase, S extends Step> = S extends 'parsing'
  ? PreProcessedArtifact
  : ProcessedArtifact;

// Conditional request context based on phase and step
export type BTPRequestCtx<P extends Phase = Phase, S extends Step = Step> = Omit<
  BTPContext,
  'sendRes' | 'sendError'
> &
  (HasRawPacket<P, S> extends true ? { rawPacket: string } : { rawPacket?: string }) &
  (HasArtifact<P, S> extends true
    ? { data: ArtifactDataType<P, S> }
    : { data?: ArtifactDataType<P, S> }) &
  (HasIsValid<P, S> extends true ? { isValid: boolean } : { isValid?: boolean }) &
  (HasIsTrusted<P, S> extends true ? { isTrusted: boolean } : { isTrusted?: boolean }) &
  (HasError<P, S> extends true ? { error: BTPErrorException } : { error?: BTPErrorException }) &
  (HasIdentity<P, S> extends true
    ? { getIdentity: () => { to: string; from: string } }
    : { getIdentity: () => { to?: string; from?: string } }) & {
    // Allow middleware to add custom properties
    [key: string]: unknown;
  };

// Conditional response context based on phase and step
export type BTPResponseCtx<P extends Phase = Phase, S extends Step = Step> = SetRequired<
  BTPContext,
  'sendRes' | 'sendError'
> &
  (HasReqId<P, S> extends true ? { reqId: string } : { reqId?: string }) &
  (HasArtifact<P, S> extends true
    ? { data: ArtifactDataType<P, S> }
    : { data?: ArtifactDataType<P, S> }) & {
    responseSent: boolean;
    // Allow middleware to add custom properties
    [key: string]: unknown;
  };

export type Next = () => Promise<void> | void;

// Generic middleware handler with precise typing
export type MiddlewareHandler<P extends Phase = Phase, S extends Step = Step> = (
  req: BTPRequestCtx<P, S>,
  res: BTPResponseCtx<P, S>,
  next: Next,
  context?: MiddlewareContext,
) => Promise<void> | void;

export interface MiddlewareDefinition<P extends Phase = Phase, S extends Step = Step> {
  phase: P;
  step: S;
  priority?: number; // Lower numbers execute first
  config?: MiddlewareConfig;
  handler: MiddlewareHandler<P, S>;
}

// Type for arrays of middleware definitions with proper typing
export type MiddlewareDefinitionArray = Array<
  | MiddlewareDefinition<'before', 'parsing'>
  | MiddlewareDefinition<'after', 'parsing'>
  | MiddlewareDefinition<'before', 'signatureVerification'>
  | MiddlewareDefinition<'after', 'signatureVerification'>
  | MiddlewareDefinition<'before', 'trustVerification'>
  | MiddlewareDefinition<'after', 'trustVerification'>
  | MiddlewareDefinition<'before', 'onArtifact'>
  | MiddlewareDefinition<'after', 'onArtifact'>
  | MiddlewareDefinition<'before', 'onError'>
  | MiddlewareDefinition<'after', 'onError'>
>;

export interface MiddlewareModule {
  middleware: MiddlewareDefinitionArray;
  onServerStart?: () => Promise<void> | void;
  onServerStop?: () => Promise<void> | void;
  onResponseSent?: (response: BTPServerResponse) => Promise<void> | void;
}

// Legacy types for backward compatibility
export type Middleware<T, U> = (req: T, res: U, next: Next) => Promise<void>;

export interface BTPAttachment {
  content: string; // base64
  type: 'application/pdf' | 'image/jpeg' | 'image/png';
  filename?: string;
  size: number; // bytes, as the sender states
  sha256: string; // lowercase hex, as the sender states
}

/** A link to another signed document: `correction_of`, `credits`, `instalment_of`, `follows`, or a prefixed code. */
export interface BTPDocReference {
  type: string;
  from: string;
  id: string;
  sha256: string; // lowercase hex
}

export interface BTPInvoiceDoc {
  type: 'invoice';
  title: string;
  id: string; // the invoice number, unique per sender
  issuedAt: string; // ISO format
  dueAt?: string; // ISO format
  totalAmount: {
    amount: number; // integer minor units: 12345 is 123.45
    currency: CurrencyCode; // e.g. 'AUD', 'USD', etc.
  };
  lineItems: {
    columns: string[]; // must include at minimum: ['Description', 'Amount']
    rows: Array<Record<string, string | number>>; // money cells in integer minor units
  };
  issuer?: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    identifiers?: Record<string, string>; // namespaced, e.g. { 'au:abn': '51824753556' }
  };
  paymentLink?: {
    linkText: string;
    url: string; // should be HTTPS
  };
  description?: BTPNote; // a note with a format since 1.2; a plain string as in 1.1
  /** Since 1.2: a discount on the whole invoice, before tax */
  discount?: BTPDiscount;
  attachments?: BTPAttachment[];
  references?: BTPDocReference[];
  template?: BTPTemplate;
  metadata?: Record<string, unknown>; // the sending platform's own data
}

/**
 * A person's note. Since 1.2 it says how it is written, `text` or `markdown`
 * (CommonMark, raw HTML off), as a letter's body does; a 1.1 note is a plain
 * string, read as `text`.
 */
export type BTPNote = string | { format: 'text' | 'markdown'; content: string };

/** Since 1.2: a discount before tax, an amount in minor units of the currency or whole basis points (1 to 10000). */
export type BTPDiscount = { amount: number } | { percent: number };

/** A template by reference. Since 1.2 its named data fields, each optional, are well formed when present. */
export interface BTPTemplate {
  name: string;
  data: {
    version?: string; // a semantic version
    sha256?: string; // lowercase hex
    source?: string; // an https address, always with its sha256
    logo?: { sha256: string; source: string };
    values?: BTPTemplateValues; // since 1.2, a letter's template only
    [key: string]: unknown;
  };
}

/**
 * Since 1.2: what a letter template's signature slots show, from the sender and
 * signed with the document. A drawn signature is integer strokes, `[x, y, x, y, …]`,
 * on a canvas 1000 by 300: data a receiver draws itself, never markup.
 */
export interface BTPTemplateValues {
  'signature.typed'?: string;
  'signature.name'?: string;
  'signature.title'?: string;
  'signature.drawn'?: { strokes: number[][] };
}

/** Proof of a payment: the invoice without what asks for payment, plus `payment`. */
export interface BTPReceiptDoc
  extends Omit<BTPInvoiceDoc, 'type' | 'dueAt' | 'paymentLink' | 'lineItems'> {
  type: 'receipt';
  lineItems?: BTPInvoiceDoc['lineItems'];
  payment: {
    amount: BTPInvoiceDoc['totalAmount']; // less than totalAmount on a partial receipt
    paidAt: string; // ISO format
    method?: string; // `card`, `bank_transfer`, `cash`, or a prefixed code
    reference?: string;
  };
}

/** A payslip: earnings, deductions, contributions and leave, each named by an open code. */
export type BTPPayslipDoc = z.infer<typeof BtpPayslipDocSchema>;

/** A letter: a title and one body, `text` or `markdown`. */
export type BTPLetterDoc = z.infer<typeof BtpLetterDocSchema>;

/** Since 1.2: an agreement, a letter that asks its signers to accept it. */
export type BTPAgreementDoc = z.infer<typeof BtpAgreementDocSchema>;

/** What a `BTPS_DOC` carries. */
export type BTPDocument =
  | BTPInvoiceDoc
  | BTPReceiptDoc
  | BTPPayslipDoc
  | BTPLetterDoc
  | BTPAgreementDoc;
