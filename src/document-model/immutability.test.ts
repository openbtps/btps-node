/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { freezeDocument } from './immutability.js';

describe('EBA-119: freezeDocument', () => {
  it('freezes the top level and nested objects/arrays', () => {
    const doc = freezeDocument({
      id: 'doc_1',
      total: { amount: 100, currency: 'AUD' },
      lineItems: [{ description: 'a', amount: { amount: 100, currency: 'AUD' } }],
    });

    expect(() => {
      (doc as { id: string }).id = 'doc_2';
    }).toThrow(TypeError);
    expect(() => {
      (doc.total as { amount: number }).amount = 0;
    }).toThrow(TypeError);
    expect(() => {
      doc.lineItems.push({} as never);
    }).toThrow(TypeError);
    expect(() => {
      (doc.lineItems[0] as { description: string }).description = 'b';
    }).toThrow(TypeError);
  });

  it('returns the same reference it was given', () => {
    const doc = { id: 'doc_1' };
    expect(freezeDocument(doc)).toBe(doc);
  });

  it('tolerates a value already frozen (no infinite loop, no throw)', () => {
    const nested = Object.freeze({ a: 1 });
    expect(() => freezeDocument({ nested })).not.toThrow();
  });
});
