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

export interface BtpsServerOptions {
  serverIdentity: {
    identity: string;
    publicKey: string;
    privateKey: string;
  };
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  identityStore?: AbstractIdentityStore<BTPIdentityRecord>;
  port?: number;
  onError?: (err: BTPErrorException) => void;
  options?: TlsOptions;
  connectionTimeoutMs?: number;
  middlewarePath?: string; // Path to btps.middleware.mjs file
}

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
}

export interface BTPInvoiceDoc {
  title: string;
  id: string; // unique per sender
  issuedAt: string; // ISO format
  status: 'paid' | 'unpaid' | 'partial' | 'refunded' | 'disputed';
  dueAt?: string; // ISO format
  paidAt?: string; // ISO format
  refundedAt?: string; // ISO format
  disputedAt?: string; // ISO format
  totalAmount: {
    value: number;
    currency: CurrencyCode; // e.g. 'AUD', 'USD', etc.
  };
  lineItems: {
    columns: string[]; // must include at minimum: ['Description', 'Amount']
    rows: Array<Record<string, string | number>>;
  };
  issuer?: {
    name: string;
    email?: string;
    phone?: string;
  };
  paymentLink?: {
    linkText: string;
    url: string; // should be HTTPS
  };
  description?: string;
  attachment?: BTPAttachment;
  template?: {
    name: string;
    data: Record<string, unknown>;
  };
}
