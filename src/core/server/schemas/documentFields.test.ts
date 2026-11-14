/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2 document fields, by the version of the artifact they travel in: a
 * note that says how it is written, discounts, totals, line roles, a
 * recipient, a signatory and a BoundView. A template keeps its 1.1 form.
 * Under 1.1.0 a document reads exactly as 1.1 reads it, so what was valid
 * stays valid; 1.2's rules apply under 1.2.0, on arrival and on decryption.
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { zlibSync } from 'fflate';
import { BtpTransporterArtifactSchema } from './artifacts/transporterSchema.js';
import { decryptedDocumentProblem } from './helpers.js';
import { BtpsAgent } from '../../../client/btpsAgent.js';
import { BtpsAgentCommandCallSchema } from '../../../client/libs/schema.js';
import { artifactVersion } from '../constants/index.js';
import { BTPS_FIELD_LIMITS } from '../constants/limits.js';
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

const letter = {
  type: 'letter',
  title: 'Your new plan',
  id: 'LET-1',
  issuedAt,
  body: { format: 'text', content: 'Hello Alice' },
};

describe('a template', () => {
  const template = { name: 'acme/classic', data: { source: 'http://templates.example/a' } };

  it('keeps its 1.1 form in any version, on an invoice or receipt only', () => {
    expect(takes('1.1.0', { ...invoice, template })).toBe(true);
    expect(takes('1.2.0', { ...invoice, template })).toBe(true);
    expect(takes('1.2.0', { ...letter, template })).toBe(false);
  });
});

describe('totals, line roles and the recipient', () => {
  const totals = {
    ...invoice,
    subtotalAmount: { amount: 136364, currency: 'AUD' },
    taxAmount: { amount: 13636, currency: 'AUD' },
  };
  const roles = (value: object) => ({
    ...invoice,
    lineItems: { ...invoice.lineItems, roles: value },
  });

  it('carries totals in the currency of totalAmount, under 1.2.0 only', () => {
    expect(takes('1.2.0', totals)).toBe(true);
    expect(takes('1.1.0', totals)).toBe(false);
    expect(takes('1.2.0', { ...totals, taxAmount: { amount: 1, currency: 'USD' } })).toBe(false);
  });

  it('names each role once, each on one of its columns', () => {
    expect(takes('1.2.0', roles({ Item: 'description', Amount: 'lineTotal' }))).toBe(true);
    expect(takes('1.2.0', roles({ Item: 'lineTotal', Amount: 'lineTotal' }))).toBe(false);
    expect(takes('1.2.0', roles({ Price: 'unitPrice' }))).toBe(false);
    expect(takes('1.2.0', roles({ Item: 'total' }))).toBe(false);
  });

  it('names the recipient on an invoice and a letter, not a payslip', () => {
    expect(takes('1.2.0', { ...invoice, recipient: { name: 'Northwind Studio' } })).toBe(true);
    expect(takes('1.2.0', { ...letter, recipient: { name: 'Northwind Studio' } })).toBe(true);
    expect(takes('1.2.0', { ...invoice, recipient: { name: 'a'.repeat(201) } })).toBe(false);
  });
});

describe('a signatory', () => {
  const signatory = (visualSignature: object) => ({
    ...letter,
    signatory: { name: 'Jo Bloggs', title: 'Director', visualSignature },
  });
  const onCanvas = { type: 'drawn', strokes: [[0, 0, 1000, 300]] };

  it('signs off a letter under 1.2.0 only, its drawn signature on a 1000 by 300 canvas', () => {
    expect(takes('1.2.0', signatory(onCanvas))).toBe(true);
    expect(takes('1.1.0', signatory(onCanvas))).toBe(false);
    expect(takes('1.2.0', signatory({ type: 'drawn', strokes: [[0, 0, 1001, 0]] }))).toBe(false);
    expect(takes('1.2.0', signatory({ type: 'typed', text: '<b>Jo</b>' }))).toBe(false);
  });

  it('is on a letter or an agreement, never an invoice', () => {
    expect(takes('1.2.0', { ...invoice, signatory: { name: 'Jo Bloggs' } })).toBe(false);
  });
});

describe('a BoundView', () => {
  const font = {
    unitsPerEm: 1000,
    ascent: 900,
    descent: 200,
    glyphs: { A: { advance: 600, path: 'M0 0L300 -700L600 0Z' }, ' ': { advance: 250 } },
  };
  const text = (bind: object) => ({
    type: 'text',
    bind,
    x: 10,
    y: 40,
    width: 200,
    align: 'start',
    font: 'body',
    size: 12,
    colour: '#0f1b2d',
  });
  const view = (elements: object[], more: object = {}) => ({
    format: 1,
    page: { width: 600, height: 400 },
    fonts: { body: font },
    elements,
    ...more,
  });
  const money = { money: { group: ',', decimal: '.', prefix: 'A$' } };
  const pixels = (bytes: number) =>
    Buffer.from(zlibSync(new Uint8Array(bytes))).toString('base64');
  const image = (data: string) => ({ width: 2, height: 2, encoding: 'rgba8-deflate', data });

  it('travels on any document under 1.2.0 only', () => {
    const shown = view([text({ field: 'totalAmount', format: money })]);
    expect(takes('1.2.0', { ...invoice, boundView: shown })).toBe(true);
    expect(takes('1.1.0', { ...invoice, boundView: shown })).toBe(false);
    expect(takes('1.2.0', { ...letter, boundView: view([text({ field: 'body.content', range: [0, 5] })]) })).toBe(true);
  });

  it('binds only a field its document carries, written in a format that fits it', () => {
    const takesBinding = (bind: object) => takes('1.2.0', { ...invoice, boundView: view([text(bind)]) });
    expect(takesBinding({ field: 'issuedAt', format: { date: 'd MMM yyyy' } })).toBe(true);
    expect(takesBinding({ field: 'lineItems.rows.0.Amount', format: money })).toBe(true);
    expect(takesBinding({ field: 'lineItems.rows.0.Item' })).toBe(true);
    expect(takesBinding({ field: 'dueAt', format: { date: 'd MMM yyyy' } })).toBe(false);
    expect(takesBinding({ field: 'metadata.note' })).toBe(false);
    expect(takesBinding({ field: 'totalAmount' })).toBe(false);
    expect(takesBinding({ field: 'id', format: money })).toBe(false);
    expect(takesBinding({ field: 'id', range: [0, 9] })).toBe(false);
    expect(takesBinding({ field: 'id', format: { groups: { sizes: [2, 3], separator: ' ' } } })).toBe(true);
    expect(takesBinding({ field: 'id', format: { groups: { sizes: [2, 2], separator: ' ' } } })).toBe(false);
  });

  it('is closed: an unknown key, an unknown font or image, or a relative path command is refused', () => {
    const shown = text({ field: 'id' });
    expect(takes('1.2.0', { ...invoice, boundView: view([shown], { script: 'x' }) })).toBe(false);
    expect(takes('1.2.0', { ...invoice, boundView: view([{ ...shown, font: 'other' }]) })).toBe(false);
    const path = (d: string) => view([{ type: 'path', d, fill: '#f2f6ff' }]);
    expect(takes('1.2.0', { ...invoice, boundView: path('M0 0L10 10.25Z') })).toBe(true);
    expect(takes('1.2.0', { ...invoice, boundView: path('M0 0l10 10Z') })).toBe(false);
    expect(takes('1.2.0', { ...invoice, boundView: path('M0 0A5 5 0 0 1 10 10') })).toBe(false);
    expect(takes('1.2.0', { ...invoice, boundView: path('M0 0L10.125 10Z') })).toBe(false);
  });

  it("draws a bound value with its font's own glyphs, never a fallback-only font", () => {
    const fallbackOnly = { unitsPerEm: 1000, ascent: 900, descent: 200, fallback: ['arimo'] };
    const { bind: _bind, ...box } = text({});
    const label = { ...box, type: 'label', text: 'Total', font: 'arimo' };
    const fonts = { body: font, arimo: fallbackOnly };
    expect(takes('1.2.0', { ...invoice, boundView: view([label], { fonts }) })).toBe(true);
    expect(
      takes('1.2.0', { ...invoice, boundView: view([{ ...text({ field: 'id' }), font: 'arimo' }], { fonts }) }),
    ).toBe(false);
  });

  it('carries an image as pixels that inflate to exactly width × height × 4 bytes', () => {
    const drawn = { type: 'image', image: 'logo', x: 0, y: 0, width: 20, height: 20 };
    const withImage = (data: string) => view([drawn], { images: { logo: image(data) } });
    expect(takes('1.2.0', { ...invoice, boundView: withImage(pixels(16)) })).toBe(true);
    expect(takes('1.2.0', { ...invoice, boundView: withImage(pixels(17)) })).toBe(false);
    expect(takes('1.2.0', { ...invoice, boundView: withImage(pixels(15)) })).toBe(false);
    expect(takes('1.2.0', { ...invoice, boundView: withImage('bm90IHpsaWI=') })).toBe(false);
  });

  it('stops inflating at the stated length, so a small image cannot expand into a large one', () => {
    const bomb = pixels(64 * 1024 * 1024);
    expect(bomb.length).toBeLessThan(BTPS_FIELD_LIMITS.boundView.imageData);
    const started = performance.now();
    expect(
      takes('1.2.0', {
        ...invoice,
        boundView: view([], { images: { logo: image(bomb) } }),
      }),
    ).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("draws a signature only from the signatory's own", () => {
    const signature = { type: 'signature', x: 10, y: 10, width: 200, height: 60, colour: '#0f1b2d' };
    const signed = {
      ...letter,
      signatory: { name: 'Jo Bloggs', visualSignature: { type: 'typed', text: 'Jo Bloggs' } },
    };
    expect(takes('1.2.0', { ...signed, boundView: view([signature]) })).toBe(true);
    expect(takes('1.2.0', { ...letter, boundView: view([signature]) })).toBe(false);
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

describe('what a 1.1 device could send, sent from a 1.2 device', () => {
  const sendable = (document: object) =>
    BtpsAgentCommandCallSchema.safeParse({
      actionType: 'artifact.send',
      to: 'pay$client.example',
      document,
    }).success;
  const longNote = { ...invoice, description: 'a'.repeat(5001) };
  const ownTemplate = {
    ...invoice,
    template: {
      name: 'acme/classic',
      data: { logo: 'acme.png', version: 'latest', sha256: 'ABC' },
    },
  };

  it('is sent as 1.1 says it: a plain note over 5000 characters, and a template of its own shape', () => {
    expect(sendable(longNote)).toBe(true);
    expect(sendable(ownTemplate)).toBe(true);
    expect(artifactVersion({ type: 'BTPS_DOC', document: longNote })).toBe('1.1.0');
    expect(artifactVersion({ type: 'BTPS_DOC', document: ownTemplate })).toBe('1.1.0');
  });

  it('is refused once it uses what 1.2 adds, which brings 1.2 rules with it', () => {
    expect(sendable({ ...longNote, discount: { amount: 500 } })).toBe(false);
    expect(sendable({ ...longNote, recipient: { name: 'Northwind Studio' } })).toBe(false);
  });

  it('is kept in a draft as 1.1 says it', () => {
    const draft = BtpsAgentCommandCallSchema.safeParse({
      actionType: 'draft.create',
      to: 'billing$vendor.example',
      document: { type: 'BTPS_DOC', document: ownTemplate },
    });

    expect(draft.success).toBe(true);
  });
});
