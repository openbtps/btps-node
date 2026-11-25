/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */
import { describe, expect, it } from 'vitest';
import { checkDecryptedDocument, checkDocumentToSend } from './index.js';
import { BTP_ERROR_DOCUMENT_TYPE_MISMATCH, BTP_ERROR_VALIDATION } from '../error/constant.js';

const sha256 = 'a'.repeat(64);
const invoice = {
  type: 'invoice',
  title: 'October',
  id: 'INV-1',
  issuedAt: '2026-10-19T00:00:00.000Z',
  totalAmount: { amount: 1000, currency: 'AUD' },
  lineItems: { columns: ['Item'], rows: [{ Item: 'Hosting' }] },
};
const letter = {
  type: 'letter',
  title: 'Notice',
  id: 'LET-1',
  issuedAt: '2026-10-19T00:00:00.000Z',
  body: { format: 'text', content: 'Hello' },
};
const envelope = { type: 'BTPS_DOC', version: '1.2.0', documentType: 'invoice' };
// A BoundView whose one image does not inflate to what it says: refused by the schema.
const broken = {
  format: 1,
  page: { width: 600, height: 400 },
  fonts: { body: { unitsPerEm: 1000, ascent: 800, descent: 200, glyphs: { A: { advance: 500 } } } },
  images: { logo: { width: 1, height: 1, encoding: 'rgba8-deflate', data: 'AAAA' } },
  elements: [],
};

const checks = [
  [
    'checkDocumentToSend',
    async (document: unknown, options?: { boundView?: 'whereDrawn' }) =>
      checkDocumentToSend(document, envelope, options),
  ],
  [
    'checkDecryptedDocument',
    (document: unknown, options?: { boundView?: 'whereDrawn' }) =>
      checkDecryptedDocument(document, envelope, options),
  ],
] as const;

describe.each(checks)('%s', (_name, check) => {
  it('passes a document of the type its envelope names that its schema takes', async () => {
    expect(await check(invoice)).toBeUndefined();
  });

  it('takes one whose files are held apart: their content left empty, their size and hash as sent', async () => {
    const attachments = [{ content: '', type: 'application/pdf', size: 10_485_760, sha256 }];
    expect(await check({ ...invoice, attachments })).toBeUndefined();
  });

  it('refuses one of another type than its envelope names, and one its schema does not take', async () => {
    expect((await check(letter))?.code).toBe(BTP_ERROR_DOCUMENT_TYPE_MISMATCH.code);
    const { title: _title, ...untitled } = invoice;
    expect((await check(untitled))?.code).toBe(BTP_ERROR_VALIDATION.code);
  });

  it('checks a BoundView here, unless it is checked where it is drawn', async () => {
    expect((await check({ ...invoice, boundView: broken }))?.code).toBe(BTP_ERROR_VALIDATION.code);
    expect(
      await check({ ...invoice, boundView: broken }, { boundView: 'whereDrawn' }),
    ).toBeUndefined();
  });
});
