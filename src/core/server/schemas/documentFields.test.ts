/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2 document fields, by the version of the artifact they travel in: a
 * note that says how it is written, discounts, and templates by reference.
 * Under 1.1.0 a document reads exactly as 1.1 reads it, so what was valid
 * stays valid; 1.2's rules apply under 1.2.0, on arrival and on decryption.
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { BtpTransporterArtifactSchema } from './artifacts/transporterSchema.js';
import { decryptedDocumentProblem } from './helpers.js';
import { BtpsAgent } from '../../../client/btpsAgent.js';
import type { BTPInvoiceDoc } from '../../../server/types.js';

const issuedAt = new Date().toISOString();
const invoice: BTPInvoiceDoc = {
  type: 'invoice',
  title: 'October',
  id: 'INV-1',
  issuedAt,
  totalAmount: { amount: 150000, currency: 'AUD' },
  lineItems: { columns: ['Item', 'Amount'], rows: [{ Item: 'Website build', Amount: 150000 }] },
};
const artifact = (version: string, document: object) => ({
  version,
  issuedAt,
  id: 'artifact-1',
  type: 'BTPS_DOC',
  from: 'billing$vendor.example',
  to: 'pay$client.example',
  selector: 'btps1',
  signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
  encryption: null,
  document,
});
const takes = (version: string, document: object) =>
  BtpTransporterArtifactSchema.safeParse(artifact(version, document)).success;

describe('an invoice note', () => {
  const withFormat = { ...invoice, description: { format: 'markdown', content: '**Thanks**' } };
  const long = { ...invoice, description: 'a'.repeat(5001) };

  it('says how it is written under 1.2.0, and is a plain string under 1.1.0', () => {
    expect(takes('1.2.0', withFormat)).toBe(true);
    expect(takes('1.1.0', withFormat)).toBe(false);
  });

  it('is limited to 5000 characters under 1.2.0 only, so a long 1.1 note stays valid', () => {
    expect(takes('1.1.0', long)).toBe(true);
    expect(takes('1.2.0', long)).toBe(false);
  });

  it('is read by the version of the artifact once decrypted, too', () => {
    expect(decryptedDocumentProblem(withFormat, artifact('1.2.0', {}))).toBeUndefined();
    expect(decryptedDocumentProblem(withFormat, artifact('1.1.0', {}))).toBeDefined();
  });
});

describe('a discount', () => {
  const lines = (discount: number) => ({
    ...invoice,
    lineItems: {
      columns: ['Item', 'Amount', 'discount'],
      rows: [{ Item: 'Website build', Amount: 150000, discount }],
    },
  });

  it('on the whole invoice is an amount or a percentage, under 1.2.0 only', () => {
    expect(takes('1.2.0', { ...invoice, discount: { percent: 1000 } })).toBe(true);
    expect(takes('1.2.0', { ...invoice, discount: { amount: 500, percent: 1000 } })).toBe(false);
    expect(takes('1.1.0', { ...invoice, discount: { amount: 500 } })).toBe(false);
  });

  it('on a line is at least 0 under 1.2.0, and as 1.1 had it under 1.1.0', () => {
    expect(takes('1.2.0', lines(5000))).toBe(true);
    expect(takes('1.2.0', lines(-5000))).toBe(false);
    expect(takes('1.1.0', lines(-5000))).toBe(true);
  });
});

describe('a template', () => {
  const letter = {
    type: 'letter',
    title: 'Your new plan',
    id: 'LET-1',
    issuedAt,
    body: { format: 'text', content: 'Hello' },
  };
  const template = (data: object) => ({ name: 'acme/classic', data });

  it('may be named by a letter under 1.2.0 only', () => {
    expect(takes('1.2.0', { ...letter, template: template({}) })).toBe(true);
    expect(takes('1.1.0', { ...letter, template: template({}) })).toBe(false);
  });

  it("has well-formed named fields under 1.2.0, and a provider's own shapes under 1.1.0", () => {
    const own = template({ source: 'http://templates.example/a', accent: 'blue' });
    expect(takes('1.2.0', { ...invoice, template: own })).toBe(false);
    expect(takes('1.1.0', { ...invoice, template: own })).toBe(true);
    const named = template({ source: 'https://templates.example/a', accent: 'blue' });
    expect(takes('1.2.0', { ...invoice, template: named })).toBe(true);
  });
});

describe('what a device stamps', () => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const agent = new BtpsAgent({
    agent: { id: 'btps_ag_1', identityKey: keys.privateKey, identityCert: keys.publicKey },
    btpIdentity: 'billing$vendor.example',
    host: 'btps.vendor.example',
  });

  it('stamps an invoice with a discount 1.2.0, inside and out: only a 1.2 receiver takes it', async () => {
    const { payload, error } = await agent['getAgentArtifact']({
      actionType: 'artifact.send',
      to: 'pay$client.example',
      document: { ...invoice, discount: { amount: 500 } },
    });

    expect(error).toBeUndefined();
    expect(payload?.version).toBe('1.2.0');
    expect(payload?.document).toMatchObject({ version: '1.2.0' });
  });
});
