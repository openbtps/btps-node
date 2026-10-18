/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { BTPS_FIELD_LIMITS } from '../constants/limits.js';
import {
  BtpInvoiceDocSchema,
  BtpLifecycleEventSchema,
  BtpTrustReqDocSchema,
  BtpTrustResDocSchema,
} from './btpsDocsSchema.js';

const sha256 = 'a'.repeat(64);

const trustRequest = {
  id: 'req-1',
  name: 'Acme Pty Ltd',
  email: 'billing@acme.com',
  reason: 'To send you invoices',
  phone: '+61 400 000 000',
};

const trustResponse = {
  id: 'res-1',
  decision: 'accepted',
  decidedAt: '2026-10-19T00:00:00.000Z',
  decidedBy: 'bob$example.com',
};

const invoice = {
  type: 'invoice',
  title: 'October',
  id: 'INV-1',
  issuedAt: '2026-10-19T00:00:00.000Z',
  totalAmount: { amount: 1000, currency: 'AUD' },
  lineItems: { columns: ['Item'], rows: [{ Item: 'Hosting' }] },
};

const disputed = {
  type: 'lifecycle_event',
  id: '0b7f1f1e-6c1a-4a8e-9a57-6f0c1b9e2d3a',
  occurredAt: '2026-10-19T00:00:00.000Z',
  document: { from: 'alice$example.com', id: 'INV-1', sha256 },
  eventType: 'disputed',
  reason: 'amount_wrong',
};

const text = (length: number) => 'a'.repeat(length);
const email = (length: number) => `${text(length - '@example.com'.length)}@example.com`;
const url = (length: number) =>
  `https://example.com/${text(length - 'https://example.com/'.length)}`;

type Case = {
  name: string;
  schema: ZodTypeAny;
  limit: number;
  build: (length: number) => unknown;
};

const {
  trustRequest: req,
  trustResponse: res,
  event,
  documentId,
  referenceType,
} = BTPS_FIELD_LIMITS;

const cases: Case[] = [
  ...(['id', 'name', 'displayName', 'phone', 'address', 'reason', 'message'] as const).map(
    (field): Case => ({
      name: `trust request ${field}`,
      schema: BtpTrustReqDocSchema,
      limit: req[field],
      build: (n) => ({ ...trustRequest, [field]: text(n) }),
    }),
  ),
  {
    name: 'trust request email',
    schema: BtpTrustReqDocSchema,
    limit: req.email,
    build: (n) => ({ ...trustRequest, email: email(n) }),
  },
  ...(['logoUrl', 'websiteUrl'] as const).map(
    (field): Case => ({
      name: `trust request ${field}`,
      schema: BtpTrustReqDocSchema,
      limit: req[field],
      build: (n) => ({ ...trustRequest, [field]: url(n) }),
    }),
  ),
  ...(['id', 'decidedBy', 'message'] as const).map(
    (field): Case => ({
      name: `trust response ${field}`,
      schema: BtpTrustResDocSchema,
      limit: res[field],
      build: (n) => ({ ...trustResponse, [field]: text(n) }),
    }),
  ),
  {
    name: 'event message',
    schema: BtpLifecycleEventSchema,
    limit: event.message,
    build: (n) => ({ ...disputed, message: text(n) }),
  },
  {
    name: 'event reason',
    schema: BtpLifecycleEventSchema,
    limit: event.reason,
    build: (n) => ({ ...disputed, reason: text(n) }),
  },
  {
    name: 'event document id',
    schema: BtpLifecycleEventSchema,
    limit: documentId,
    build: (n) => ({ ...disputed, document: { ...disputed.document, id: text(n) } }),
  },
  {
    name: 'invoice id',
    schema: BtpInvoiceDocSchema,
    limit: documentId,
    build: (n) => ({ ...invoice, id: text(n) }),
  },
  {
    name: 'reference id',
    schema: BtpInvoiceDocSchema,
    limit: documentId,
    build: (n) => ({
      ...invoice,
      references: [{ type: 'credits', from: 'alice$example.com', id: text(n), sha256 }],
    }),
  },
  {
    name: 'reference type',
    schema: BtpInvoiceDocSchema,
    limit: referenceType,
    build: (n) => ({
      ...invoice,
      references: [{ type: text(n), from: 'alice$example.com', id: 'INV-0', sha256 }],
    }),
  },
];

describe('BTPS_FIELD_LIMITS', () => {
  it.each(cases)('$name accepts $limit characters and refuses one more', (c) => {
    expect(c.schema.safeParse(c.build(c.limit)).success).toBe(true);
    expect(c.schema.safeParse(c.build(c.limit + 1)).success).toBe(false);
  });
});
