/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Every list an artifact carries is refused cheaply when it is too long, before
// its signature is checked: one issue, not one for each of its entries, so a
// long line costs no more than a short one. The lists 1.2 adds are checked here.

import { describe, expect, it } from 'vitest';
import { BtpTransporterArtifactSchema } from './artifacts/transporterSchema.js';
import { BtpLetterDocSchema } from './btpsDocsSchema.js';

const LONG = 200_000;
const issuedAt = new Date().toISOString();
const artifact = (type: string, document: object, more: object = {}) => ({
  version: '1.2.0',
  issuedAt,
  id: 'artifact-1',
  type,
  from: 'billing$vendor.example',
  to: 'pay$client.example',
  selector: 'btps1',
  signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
  encryption: null,
  document,
  ...more,
});
const issues = (value: object) => {
  const result = BtpTransporterArtifactSchema.safeParse(value);
  return result.success ? 0 : result.error.issues.length;
};
const many = <T>(entry: T) => Array.from({ length: LONG }, () => entry);

describe('a list too long to take', () => {
  it("is one issue in a trust request's permissions and given", () => {
    const request = { name: 'Vendor', email: 'billing@vendor.example' };
    expect(
      issues(artifact('TRUST_REQ', request, { permissions: many({ name: 'x' }) })),
    ).toBeLessThan(5);
    expect(issues(artifact('TRUST_REQ', request, { given: many('x') }))).toBeLessThan(5);
  });

  it("is one issue in a trust answer's granted and a details request's names", () => {
    expect(
      issues(artifact('TRUST_RES', { decision: 'accepted' }, { granted: many('x') })),
    ).toBeLessThan(5);
    expect(issues(artifact('DETAILS_REQ', {}, { details: many('x') }))).toBeLessThan(5);
  });

  it("is one issue in a letter's drawn signature, by its strokes or by one stroke's points", () => {
    const letter = (strokes: unknown) => ({
      type: 'letter',
      title: 'Your new plan',
      id: 'LET-1',
      issuedAt,
      body: { format: 'text', content: 'Hello' },
      template: { name: 'acme/classic', data: { values: { 'signature.drawn': { strokes } } } },
    });
    // The letter's own schema, as a document is checked once opened, too.
    const letterIssues = (strokes: unknown) => {
      const result = BtpLetterDocSchema.safeParse(letter(strokes));
      return result.success ? 0 : result.error.issues.length;
    };
    expect(letterIssues(many([-1]))).toBeLessThan(5);
    expect(letterIssues([many(-1)])).toBeLessThan(5);
    expect(letterIssues([[0, 0, 1000, 300]])).toBe(0);
  });
});
