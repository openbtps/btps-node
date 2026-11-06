/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: a send's documentType, as a device asks for it. It is on
 * artifact.send only, it is the document's own type, and it stamps the
 * artifact 1.2.0, so a send without it still goes as 1.1.0.
 */

import { describe, expect, it } from 'vitest';
import { BtpsAgentCommandCallSchema } from '../../../client/libs/schema.js';
import { artifactVersion } from '../constants/index.js';

const invoice = {
  type: 'invoice',
  title: 'October',
  id: 'INV-1',
  issuedAt: '2026-10-19T00:00:00.000Z',
  totalAmount: { amount: 150000, currency: 'AUD' },
  lineItems: { columns: ['Item', 'Amount'], rows: [{ Item: 'Build', Amount: 150000 }] },
};
const call = (actionType: string, document: object, documentType?: string) =>
  BtpsAgentCommandCallSchema.safeParse({
    actionType,
    to: 'pay$client.example',
    document,
    options: documentType ? { documentType } : {},
  }).success;

describe("a send's documentType, asked for by a device", () => {
  it("is the document's own type, on artifact.send", () => {
    expect(call('artifact.send', invoice, 'invoice')).toBe(true);
  });

  it("is refused when it is not the document's own type", () => {
    expect(call('artifact.send', invoice, 'receipt')).toBe(false);
  });

  it('is refused on any other action', () => {
    expect(call('draft.create', { type: 'BTPS_DOC', document: invoice }, 'invoice')).toBe(false);
  });

  it('is refused for a type that is not a document type', () => {
    expect(call('artifact.send', { ...invoice, type: 'quote' }, 'quote')).toBe(false);
  });

  it('stamps its artifact 1.2.0; without it, the same send is 1.1.0', () => {
    expect(artifactVersion({ type: 'BTPS_DOC', document: invoice, documentType: 'invoice' })).toBe(
      '1.2.0',
    );
    expect(artifactVersion({ type: 'BTPS_DOC', document: invoice })).toBe('1.1.0');
  });
});
