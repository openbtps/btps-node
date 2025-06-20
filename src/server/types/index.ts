import { RateLimiter } from 'server/libs/abstractRateLimiter.js';
import { IMetricsTracker } from 'server/libs/type.js';
import { TlsOptions } from 'tls';
import { CurrencyCode } from './currency.js';
import { BTPTrustRecord } from '@core/trust/index.js';
import { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import { BTPMessageQueue } from '@core/server/helpers/index.js';
export * from './currency.js';

export interface BtpsServerOptions {
  queue: BTPMessageQueue;
  trustStore: AbstractTrustStore<BTPTrustRecord>;
  port?: number;
  onError?: (err: Error) => void;
  rateLimiter?: RateLimiter;
  metrics?: IMetricsTracker;
  options?: TlsOptions;
}
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
