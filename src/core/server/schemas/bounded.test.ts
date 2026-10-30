/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { boundedArray, boundedRecord, PRECHECK_THRESHOLD } from './bounded.js';
import {
  BtpAuthReqDocSchema,
  BtpInvoiceDocSchema,
  BtpLetterDocSchema,
  BtpPayslipDocSchema,
} from './btpsDocsSchema.js';
import { BtpAgentQuerySchema, BtpIdsPayloadSchema } from './schema.js';
import { BtpQueryResultSchema, BtpTrustRecordSchema } from './responseSchema.js';
import { BTPS_FIELD_LIMITS } from '../constants/limits.js';

const L = BTPS_FIELD_LIMITS;
const sha256 = 'a'.repeat(64);
const money = { amount: 100, currency: 'AUD' };
const fill = <T>(n: number, entry: (i: number) => T) =>
  Array.from({ length: n }, (_, i) => entry(i));
const keys = (n: number) => Object.fromEntries(fill(n, (i) => [`k${i}`, 'v']));

const invoice = (over: Record<string, unknown> = {}) => ({
  type: 'invoice',
  title: 'Invoice',
  id: 'INV-1',
  issuedAt: '2025-01-01T00:00:00.000Z',
  totalAmount: money,
  lineItems: { columns: ['description', 'amount'], rows: [{ description: 'Item', amount: 100 }] },
  ...over,
});
const payslip = (over: Record<string, unknown> = {}) => ({
  type: 'payslip',
  title: 'Payslip',
  id: 'PAY-1',
  issuedAt: '2025-01-01T00:00:00.000Z',
  employee: { name: 'Alice' },
  earnings: [],
  deductions: [],
  contributions: [],
  gross: money,
  net: money,
  ...over,
});
const letter = (over: Record<string, unknown> = {}) => ({
  type: 'letter',
  title: 'Notice',
  id: 'LET-1',
  issuedAt: '2025-01-01T00:00:00.000Z',
  body: { format: 'text', content: 'Hello' },
  ...over,
});
const trustRecord = (over: Record<string, unknown> = {}) => ({
  id: 'trust-1',
  createdAt: '2025-01-01T00:00:00.000Z',
  senderId: 'billing$vendor.com',
  receiverId: 'billing$yourdomain.com',
  status: 'accepted',
  decidedBy: 'billing$yourdomain.com',
  decidedAt: '2025-01-02T00:00:00.000Z',
  publicKeyBase64: 'cHVi',
  publicKeyFingerprint: sha256,
  keyHistory: [],
  privacyType: 'encrypted',
  ...over,
});
const attachment = { content: '', type: 'application/pdf', size: 0, sha256 };
const reference = { type: 'follows', from: 'billing$vendor.com', id: 'INV-0', sha256 };
const keyHistoryEntry = {
  fingerprint: sha256,
  firstSeen: '2024-01-01T00:00:00.000Z',
  lastSeen: '2025-01-01T00:00:00.000Z',
};

describe('boundedArray', () => {
  const schema = boundedArray(z.number(), 1000);

  it('refuses a list over its limit with one fatal issue, without parsing inside', () => {
    const result = schema.safeParse(fill(1001, () => 'not a number'));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.message).toBe('must have at most 1000 entries');
  });

  it('stops a long list at its first invalid entry, naming where it is', () => {
    const list: unknown[] = fill(PRECHECK_THRESHOLD + 1, (i) => i);
    list[40] = 'x';
    list[90] = 'y';

    const result = z.object({ list: schema }).safeParse({ list });

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.path).toEqual(['list', 40]);
  });

  it('leaves a short list to zod, which reports every invalid entry as before', () => {
    const result = schema.safeParse(fill(PRECHECK_THRESHOLD, () => 'x'));

    expect(result.error?.issues).toHaveLength(PRECHECK_THRESHOLD);
  });

  it('parses a valid list exactly as z.array does', () => {
    const list = fill(500, (i) => i);
    expect(schema.parse(list)).toEqual(z.array(z.number()).parse(list));
  });
});

describe('boundedRecord', () => {
  it('refuses a record over its limit with one fatal issue', () => {
    const result = boundedRecord(z.number(), 100).safeParse(
      Object.fromEntries(fill(101, (i) => [`k${i}`, 'x'])),
    );

    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.message).toBe('must have at most 100 keys');
  });
});

describe('a crafted document costs one issue, not gigabytes', () => {
  const heapGrowthMb = (run: () => void) => {
    const before = process.memoryUsage().heapUsed;
    run();
    return (process.memoryUsage().heapUsed - before) / 1024 / 1024;
  };

  it('one long list of invalid rows, about 5 MB', () => {
    const rows = fill(555_556, () => 1);
    let issues = 0;

    const grew = heapGrowthMb(() => {
      const result = BtpInvoiceDocSchema.safeParse(
        invoice({ lineItems: { columns: ['a'], rows } }),
      );
      issues = result.error?.issues.length ?? 0;
    });

    expect(issues).toBe(1);
    expect(grew).toBeLessThan(100); // 2,124 MB in 1.1.2
  });

  it('10,000 rows of 50 invalid cells', () => {
    const columns = fill(50, (i) => `c${i}`);
    const rows = fill(10_000, () => Object.fromEntries(columns.map((c) => [c, 1.5])));
    let issues: z.ZodIssue[] = [];

    const grew = heapGrowthMb(() => {
      issues =
        BtpInvoiceDocSchema.safeParse(invoice({ lineItems: { columns, rows } })).error?.issues ??
        [];
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(['lineItems', 'rows', 0, 'c0']);
    expect(grew).toBeLessThan(100); // 1,675 MB in 1.1.2
  });
});

describe('every limit is accepted at its maximum and refused one over', () => {
  const columns = fill(L.lineItems.columns, (i) => `c${i}`);
  const cases: [string, number, z.ZodTypeAny, (n: number) => unknown][] = [
    [
      'lineItems.rows',
      L.lineItems.rows,
      BtpInvoiceDocSchema,
      (n) => invoice({ lineItems: { columns: ['a'], rows: fill(n, () => ({ a: 1 })) } }),
    ],
    [
      'lineItems.columns',
      L.lineItems.columns,
      BtpInvoiceDocSchema,
      (n) => invoice({ lineItems: { columns: fill(n, (i) => `c${i}`), rows: [] } }),
    ],
    [
      'cells in a row',
      L.lineItems.columns,
      BtpInvoiceDocSchema,
      (n) => invoice({ lineItems: { columns, rows: [keys(n)] } }),
    ],
    [
      'invoice attachments',
      L.attachments,
      BtpInvoiceDocSchema,
      (n) => invoice({ attachments: fill(n, () => attachment) }),
    ],
    [
      'invoice references',
      L.references,
      BtpInvoiceDocSchema,
      (n) => invoice({ references: fill(n, () => reference) }),
    ],
    [
      'invoice metadata keys',
      L.recordKeys,
      BtpInvoiceDocSchema,
      (n) => invoice({ metadata: keys(n) }),
    ],
    [
      'issuer identifiers',
      L.recordKeys,
      BtpInvoiceDocSchema,
      (n) =>
        invoice({
          issuer: {
            name: 'Acme',
            identifiers: Object.fromEntries(fill(n, (i) => [`au:k${i}`, 'v'])),
          },
        }),
    ],
    [
      'template data keys',
      L.recordKeys,
      BtpInvoiceDocSchema,
      (n) => invoice({ template: { name: 't', data: keys(n) } }),
    ],
    [
      'payslip earnings',
      L.payslip.earnings,
      BtpPayslipDocSchema,
      (n) => payslip({ earnings: fill(n, () => ({ category: 'ordinary', amount: money })) }),
    ],
    [
      'payslip deductions',
      L.payslip.deductions,
      BtpPayslipDocSchema,
      (n) => payslip({ deductions: fill(n, () => ({ category: 'tax', amount: money })) }),
    ],
    [
      'payslip contributions',
      L.payslip.contributions,
      BtpPayslipDocSchema,
      (n) => payslip({ contributions: fill(n, () => ({ amount: money })) }),
    ],
    [
      'payslip leave',
      L.payslip.leave,
      BtpPayslipDocSchema,
      (n) =>
        payslip({ leave: fill(n, () => ({ category: 'annual', unit: 'hours', balance: '1' })) }),
    ],
    [
      'payslip yearToDate',
      L.recordKeys,
      BtpPayslipDocSchema,
      (n) => payslip({ yearToDate: Object.fromEntries(fill(n, (i) => [`k${i}`, money])) }),
    ],
    [
      'payslip attachments',
      L.attachments,
      BtpPayslipDocSchema,
      (n) => payslip({ attachments: fill(n, () => attachment) }),
    ],
    [
      'payslip references',
      L.references,
      BtpPayslipDocSchema,
      (n) => payslip({ references: fill(n, () => reference) }),
    ],
    [
      'letter attachments',
      L.letter.attachments,
      BtpLetterDocSchema,
      (n) => letter({ attachments: fill(n, () => attachment) }),
    ],
    [
      'letter references',
      L.letter.references,
      BtpLetterDocSchema,
      (n) => letter({ references: fill(n, () => reference) }),
    ],
    [
      'query filter in',
      L.query.in,
      BtpAgentQuerySchema,
      (n) => ({ query: { from: { in: fill(n, (i) => `a${i}`) } } }),
    ],
    [
      'query filter notIn',
      L.query.notIn,
      BtpAgentQuerySchema,
      (n) => ({ query: { from: { notIn: fill(n, (i) => `a${i}`) } } }),
    ],
    ['agent ids', L.ids, BtpIdsPayloadSchema, (n) => ({ ids: fill(n, (i) => `id${i}`) })],
    [
      'agentInfo keys',
      L.recordKeys,
      BtpAuthReqDocSchema,
      (n) => ({
        identity: 'alice$example.com',
        authToken: 't',
        publicKey: 'p',
        agentInfo: keys(n),
      }),
    ],
    [
      'agentInfo list values',
      L.agentInfoValues,
      BtpAuthReqDocSchema,
      (n) => ({
        identity: 'alice$example.com',
        authToken: 't',
        publicKey: 'p',
        agentInfo: { devices: fill(n, (i) => `d${i}`) },
      }),
    ],
    [
      'query results',
      L.query.results,
      BtpQueryResultSchema,
      (n) => ({ results: fill(n, () => ({ artifact: trustRecord() })) }),
    ],
    [
      'trust record keyHistory',
      L.trustRecord.keyHistory,
      BtpTrustRecordSchema,
      (n) => trustRecord({ keyHistory: fill(n, () => keyHistoryEntry) }),
    ],
  ];

  it.each(cases)('%s: %i', (_, max, schema, build) => {
    expect(schema.safeParse(build(max)).success).toBe(true);
    const over = schema.safeParse(build(max + 1));
    expect(over.success).toBe(false);
    expect(over.error?.issues).toHaveLength(1);
  });
});
