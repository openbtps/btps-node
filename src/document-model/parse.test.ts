/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseDocumentV2 } from './parse.js';

const FIXTURES_DIR = join(__dirname, '../../test/fixtures/documents');

function readFixtureBytes(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

describe('EBA-119: parseDocumentV2', () => {
  it('parses each document type from the fixtures', () => {
    const invoice = parseDocumentV2(JSON.parse(readFixtureBytes('invoice.v2.json')));
    const creditNote = parseDocumentV2(JSON.parse(readFixtureBytes('credit-note.v2.json')));
    const lifecycleEvent = parseDocumentV2(JSON.parse(readFixtureBytes('lifecycle-event.v2.json')));
    const payslip = parseDocumentV2(JSON.parse(readFixtureBytes('payslip.hourly.v2.json')));

    expect(invoice.success && invoice.data.type).toBe('invoice');
    expect(creditNote.success && creditNote.data.type).toBe('credit_note');
    expect(lifecycleEvent.success && lifecycleEvent.data.type).toBe('lifecycle_event');
    expect(payslip.success && payslip.data.type).toBe('payslip');
  });

  it('returns errors, not a throw, for an invalid document', () => {
    const result = parseDocumentV2({ schemaVersion: 2, type: 'invoice' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('a status change never alters the original artifact\'s bytes', () => {
    const invoiceBytes = readFixtureBytes('invoice.v2.json');
    const invoiceResult = parseDocumentV2(JSON.parse(invoiceBytes));
    expect(invoiceResult.success).toBe(true);
    if (!invoiceResult.success) return;
    const before = JSON.stringify(invoiceResult.data);

    // Recording a status change is a separate, independent document — a
    // LifecycleEvent referencing the invoice by id, never a write into it.
    const lifecycleEventResult = parseDocumentV2(JSON.parse(readFixtureBytes('lifecycle-event.v2.json')));
    expect(lifecycleEventResult.success).toBe(true);
    if (lifecycleEventResult.success) {
      expect(lifecycleEventResult.data.documentId).toBe((invoiceResult.data as { id: string }).id);
    }

    // The invoice parsed earlier is byte-for-byte the same after that.
    expect(JSON.stringify(invoiceResult.data)).toBe(before);

    // And it is frozen: an in-place mutation attempt throws rather than
    // silently changing the original artifact.
    expect(() => {
      (invoiceResult.data as unknown as { total: unknown }).total = { amount: 0, currency: 'AUD' };
    }).toThrow(TypeError);
    expect(() => {
      (invoiceResult.data as unknown as { lineItems: unknown[] }).lineItems.push({} as never);
    }).toThrow(TypeError);
  });
});
