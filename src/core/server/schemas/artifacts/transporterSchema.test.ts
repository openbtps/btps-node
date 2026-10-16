/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BtpTransporterArtifactSchema } from './transporterSchema.js';
import { BtpArtifactServerSchema } from './artifacts.js';
import { validateAgentDocument, validateBtpDocOwnership } from '../helpers.js';
import type { BTPDocV2 } from '../../types.js';

const DOCUMENTS = new URL('../../../../../test/vectors/documents/', import.meta.url);
const load = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(name, DOCUMENTS), 'utf8'));

// The vectors' references name biller$example.com as the original sender.
const SENDER = 'biller$example.com';

const artifact = (document: unknown, overrides: Record<string, unknown> = {}) => ({
  version: '1.1.0',
  id: 'art-1',
  issuedAt: '2026-10-16T00:00:00.000Z',
  type: 'BTPS_DOC',
  from: SENDER,
  to: 'payer$example.org',
  signature: { algorithmHash: 'sha256', value: 'sig', fingerprint: 'fp' },
  signatureSelector: 'btps1',
  encryption: null,
  document,
  ...overrides,
});

const messages = (result: ReturnType<typeof BtpTransporterArtifactSchema.safeParse>) =>
  result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

describe('BTPS_DOC carries a v2 document', () => {
  for (const name of [
    'invoice.v2.json',
    'invoice.correction.v2.json',
    'credit-note.v2.json',
    'payslip.hourly.v2.json',
  ]) {
    it(`accepts ${name} in the clear`, () => {
      const result = BtpTransporterArtifactSchema.safeParse(artifact(load(name)));
      expect(messages(result)).toEqual([]);
      expect(BtpArtifactServerSchema.safeParse(artifact(load(name))).success).toBe(true);
    });
  }

  it('refuses the BTPS 1.0 invoice: 1.1 refuses 1.0', () => {
    const v1 = {
      title: 'Invoice',
      id: 'INV-1',
      issuedAt: '2026-01-01T00:00:00.000Z',
      status: 'unpaid',
      totalAmount: { value: 99, currency: 'AUD' },
      lineItems: { columns: ['Description', 'Amount'], rows: [{ Description: 'x', Amount: 99 }] },
    };
    expect(BtpTransporterArtifactSchema.safeParse(artifact(v1)).success).toBe(false);
    expect(BtpArtifactServerSchema.safeParse(artifact(v1)).success).toBe(false);
  });

  it('refuses a v2 invoice that carries a status', () => {
    const withStatus = { ...load('invoice.v2.json'), status: 'paid' };
    expect(BtpTransporterArtifactSchema.safeParse(artifact(withStatus)).success).toBe(false);
  });

  it('keeps an encrypted document an opaque string to the server', () => {
    const encrypted = artifact('b3BhcXVl', {
      encryption: {
        algorithm: 'aes-256-gcm',
        encryptedKey: 'k',
        iv: 'i',
        type: 'standardEncrypt',
        authTag: 't',
      },
      encryptionSelector: 'btps1',
    });
    expect(messages(BtpTransporterArtifactSchema.safeParse(encrypted))).toEqual([]);
    // An encrypted document is never parsed as a document, whatever it decrypts to.
    expect(
      BtpTransporterArtifactSchema.safeParse({ ...encrypted, document: load('invoice.v2.json') })
        .success,
    ).toBe(false);
  });
});

describe('ownership: every reference names the sender’s own document (2026-10-16)', () => {
  const OWN_DOCUMENT = 'a document may only reference a document from its own sender';

  it('accepts a credit note crediting an invoice from its own sender', () => {
    expect(messages(BtpTransporterArtifactSchema.safeParse(artifact(load('credit-note.v2.json'))))).toEqual(
      [],
    );
  });

  it('refuses a credit note crediting an invoice from another sender', () => {
    const result = BtpTransporterArtifactSchema.safeParse(
      artifact(load('credit-note.v2.json'), { from: 'mallory$example.com' }),
    );
    expect(messages(result)).toEqual([`document.references.0.from: ${OWN_DOCUMENT}`]);
  });

  it('accepts an invoice correcting one from its own sender', () => {
    expect(
      messages(BtpTransporterArtifactSchema.safeParse(artifact(load('invoice.correction.v2.json')))),
    ).toEqual([]);
  });

  it('refuses an invoice correcting one from another sender', () => {
    const result = BtpTransporterArtifactSchema.safeParse(
      artifact(load('invoice.correction.v2.json'), { from: 'mallory$example.com' }),
    );
    expect(messages(result)).toEqual([`document.references.0.from: ${OWN_DOCUMENT}`]);
  });

  it('names the reference at fault when only a later one is from another sender', () => {
    const doc = load('invoice.correction.v2.json') as { references: Array<Record<string, unknown>> };
    doc.references.push({ ...doc.references[0], type: 'follows', from: 'mallory$example.com' });
    expect(messages(BtpTransporterArtifactSchema.safeParse(artifact(doc)))).toEqual([
      `document.references.1.from: ${OWN_DOCUMENT}`,
    ]);
  });

  it('has nothing to check on an invoice with no references, or a payslip', () => {
    for (const name of ['invoice.v2.json', 'payslip.hourly.v2.json']) {
      expect(validateBtpDocOwnership(load(name) as BTPDocV2, 'anyone$example.com')).toBeUndefined();
    }
  });
});

describe('the server refuses a BTPS_DOC whose attachment is not the file it states (2026-10-16)', () => {
  const withAttachment = (change: (attachment: Record<string, unknown>) => void) => {
    const doc = load('invoice.correction.v2.json') as { attachments: Array<Record<string, unknown>> };
    change(doc.attachments[0]!);
    return doc;
  };

  it('accepts real files whose size and sha256 match', () => {
    for (const name of ['invoice.v2.json', 'invoice.correction.v2.json', 'payslip.hourly.v2.json']) {
      expect(messages(BtpTransporterArtifactSchema.safeParse(artifact(load(name)))), name).toEqual([]);
    }
  });

  it('refuses a size that is not the decoded length', () => {
    const doc = withAttachment((a) => (a.size = 589));
    expect(messages(BtpTransporterArtifactSchema.safeParse(artifact(doc)))).toEqual([
      'document.attachments.0.size: content decodes to 590 bytes, but size is 589',
    ]);
  });

  it('refuses a sha256 that is not the hash of the file', () => {
    const doc = withAttachment((a) => (a.sha256 = '0'.repeat(64)));
    expect(messages(BtpTransporterArtifactSchema.safeParse(artifact(doc)))).toEqual([
      'document.attachments.0.sha256: sha256 is not the hash of the decoded content',
    ]);
  });

  it('refuses the same through the server schema', () => {
    expect(BtpArtifactServerSchema.safeParse(artifact(load('invoice.correction.v2.json'))).success).toBe(
      true,
    );
    const doc = withAttachment((a) => (a.sha256 = '0'.repeat(64)));
    expect(BtpArtifactServerSchema.safeParse(artifact(doc)).success).toBe(false);
  });

  it('holds a document an agent sends (artifact.send) to the same check', () => {
    expect(validateAgentDocument('artifact.send', null, load('invoice.correction.v2.json'))).toBe(true);
    const doc = withAttachment((a) => (a.sha256 = '0'.repeat(64)));
    expect(validateAgentDocument('artifact.send', null, doc)).toBe(false);
  });
});
