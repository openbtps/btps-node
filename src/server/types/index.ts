import { RateLimiter } from 'server/libs/abstractRateLimiter.js';
import { IMetricsTracker } from 'server/libs/type.js';
import { TlsOptions, TLSSocket } from 'tls';

import { BTPTrustRecord } from '@core/trust/index.js';
import { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import { BTPMessageQueue } from '@core/server/helpers/index.js';
import { BTPArtifact, BTPServerResponse, CurrencyCode } from '@core/server/types.js';
import { BTPError } from '@core/error/types.js';

export interface BtpsServerOptions {
  queue?: BTPMessageQueue;
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  port?: number;
  onError?: (err: Error) => void;
  rateLimiter?: RateLimiter;
  metrics?: IMetricsTracker;
  options?: TlsOptions;
  middlewarePath?: string; // Path to btps.middleware.mjs file
}

// Middleware Types
export type Phase = 'before' | 'after';
export type Step =
  | 'parsing'
  | 'signatureVerification'
  | 'trustVerification'
  | 'onMessage'
  | 'onError';

export interface MiddlewareConfig {
  name?: string;
  enabled?: boolean;
  options?: Record<string, unknown>;
}

export interface MiddlewareContext {
  dependencies: {
    trustStore: AbstractTrustStore<BTPTrustRecord>;
    // Add other dependencies as needed
  };
  config: Record<string, unknown>;
  serverInstance: unknown; // Will be BtpsServer type
  currentTime: string;
}

export interface MiddlewareRequest {
  socket: TLSSocket;
  remoteAddress: string;
  from?: string;
  artifact?: BTPArtifact;
  isValid?: boolean; // Only available after signatureVerification
  isTrusted?: boolean; // Only available after trustVerification
  error?: Error; // Only available in onError
  startTime: string;
  // Allow middleware to add custom properties
  [key: string]: unknown;
}

export interface MiddlewareResponse {
  socket: TLSSocket;
  startTime: string;
  reqId?: string;
  artifact?: BTPArtifact;
  sendError: (error: BTPError) => void;
  sendResponse: (response: BTPServerResponse) => void;
  // Allow middleware to add custom properties
  [key: string]: unknown;
}

export type Next = () => Promise<void> | void;

export type MiddlewareHandler = (
  req: MiddlewareRequest,
  res: MiddlewareResponse,
  next: Next,
  context?: MiddlewareContext,
) => Promise<void> | void;

export interface MiddlewareDefinition {
  phase: Phase;
  step: Step;
  priority?: number; // Lower numbers execute first
  config?: MiddlewareConfig;
  handler: MiddlewareHandler;
}

export interface MiddlewareModule {
  middleware: MiddlewareDefinition[];
  onServerStart?: () => Promise<void> | void;
  onServerStop?: () => Promise<void> | void;
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
