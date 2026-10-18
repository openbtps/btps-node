/**
 * The protocol vectors: what any BTPS implementation must accept and refuse,
 * and artifacts exactly as they travel. Written from the specification
 * (docs/docusaurus/docs/protocol/specifications), never computed by the SDK,
 * so they test the SDK rather than repeat it.
 *
 * Keys are the existing test keys: the sender signs with the key in
 * kms-signature.vector.json, and the receiver's key is the one in
 * oaep-wrap.vector.json. No new key is made.
 */

import crypto from 'node:crypto';
import { canonicalize, canonicalizeValue } from '../src/jcs.mjs';
import { oaepEncrypt } from '../src/oaep-reference.mjs';

const ISSUED_AT = '2026-10-19T00:00:00.000Z';
const SHA = 'a'.repeat(64);
const aud = (amount) => ({ amount, currency: 'AUD' });

// The field limits (Limits page), restated here so a changed SDK limit fails.
const LIMITS = {
  trustRequest: {
    id: 100,
    name: 200,
    displayName: 200,
    email: 254,
    phone: 32,
    address: 1000,
    reason: 2000,
    message: 5000,
    logoUrl: 2048,
    websiteUrl: 2048,
  },
  trustResponse: { id: 100, decidedBy: 254, message: 5000 },
  event: { message: 5000, reason: 64 },
  documentId: 100,
  referenceType: 64,
  receipt: { paymentMethod: 64, paymentReference: 100 },
  payslipCode: 64,
  letter: { title: 200, content: 100000, attachments: 10, references: 20 },
};

/** Addresses: `account$domain`, letters compared without case. */
export function addresses() {
  const label63 = 'a'.repeat(63);
  return {
    description:
      'BTPS 1.1 addresses (Protocol Specification Overview, "Identity format"). An address is account$domain with exactly one $. The account is a-z, 0-9, ".", "_" and "-", 1 to 64 characters. The domain follows DNS: at least two labels of a-z, 0-9 and "-", each 1 to 63 characters, not starting or ending with "-", at most 253 characters in all; an international name in its xn-- form. Letters compare without case. An implementation accepts every "accept" input, refuses every "refuse" input, and treats each "same" pair as one identity.',
    accept: [
      'alice$example.com',
      'billing.team_2-a$saas.example',
      'Billing$Vendor.Com',
      'pay$sub.domain.example.co.uk',
      'billing$xn--bcher-kva.example',
      `${'a'.repeat(64)}$example.com`,
      `alice$${label63}.example`,
      // A domain of 253 characters: three labels of 63, one of 61, three dots.
      `alice$${[label63, label63, label63, 'a'.repeat(61)].join('.')}`,
    ],
    refuse: [
      { input: 'alice$saas.example$evil.example', reason: 'two separators' },
      { input: 'alice$$saas.example', reason: 'two separators' },
      { input: '$saas.example', reason: 'empty account' },
      { input: 'alice$', reason: 'empty domain' },
      { input: 'alice@example.com', reason: 'no separator' },
      { input: 'alice$localhost', reason: 'a single label' },
      { input: 'alice$-bad.example', reason: 'a label starting with "-"' },
      { input: 'alice$bad-.example', reason: 'a label ending with "-"' },
      { input: 'alice$ex_ample.com', reason: '"_" in the domain' },
      { input: 'alice:x$saas.example', reason: '":" in the account' },
      { input: 'al ice$saas.example', reason: 'a space' },
      { input: 'alice+tag$saas.example', reason: '"+" in the account' },
      { input: 'bіlling$vendor.com', reason: 'a Cyrillic letter that looks Latin' },
      { input: 'billing$bücher.example', reason: 'a non-ASCII domain not in xn-- form' },
      { input: `${'a'.repeat(65)}$example.com`, reason: 'an account of 65 characters' },
      { input: `alice$${'a'.repeat(64)}.example`, reason: 'a label of 64 characters' },
      {
        input: `alice$${[label63, label63, label63, 'a'.repeat(62)].join('.')}`,
        reason: 'a domain of 254 characters',
      },
    ],
    same: [
      ['Billing$Vendor.com', 'billing$vendor.com'],
      ['ALICE$EXAMPLE.COM', 'alice$example.com'],
    ],
  };
}

// The documents each case starts from, before its changes.
const base = {
  trustRequest: {
    id: 'req-1',
    name: 'Acme Pty Ltd',
    email: 'billing@acme.example',
    reason: 'To send you invoices',
    phone: '+61 400 000 000',
  },
  trustResponse: {
    id: 'res-1',
    decision: 'accepted',
    decidedAt: ISSUED_AT,
    decidedBy: 'bob$client.example',
  },
  invoice: {
    type: 'invoice',
    title: 'October',
    id: 'INV-1',
    issuedAt: ISSUED_AT,
    totalAmount: aud(150000),
    lineItems: { columns: ['Item', 'Amount'], rows: [{ Item: 'Website build', Amount: 150000 }] },
  },
  receipt: {
    type: 'receipt',
    title: 'Receipt',
    id: 'REC-1',
    issuedAt: ISSUED_AT,
    totalAmount: aud(150000),
    payment: { amount: aud(50000), paidAt: ISSUED_AT, method: 'bank_transfer' },
  },
  payslip: {
    type: 'payslip',
    title: 'Payslip',
    id: 'PAY-1',
    issuedAt: ISSUED_AT,
    employee: { name: 'Sam Lee' },
    earnings: [{ category: 'ordinary', rate: '48.75', quantity: '76', amount: aud(370500) }],
    deductions: [],
    contributions: [{ category: 'au:super_guarantee', amount: aud(44460) }],
    leave: [{ category: 'annual', description: 'Annual Leave', unit: 'hours', balance: '76.5' }],
    gross: aud(370500),
    net: aud(289000),
  },
  letter: {
    type: 'letter',
    title: 'Your new plan',
    id: 'LET-1',
    issuedAt: ISSUED_AT,
    body: { format: 'markdown', content: '# Welcome\n\nYour plan starts on **1 November**.' },
  },
  event: {
    type: 'lifecycle_event',
    id: '0b7f1f1e-6c1a-4a8e-9a57-6f0c1b9e2d3a',
    occurredAt: ISSUED_AT,
    document: { from: 'billing$vendor.example', id: 'INV-1', sha256: SHA },
    eventType: 'paid',
  },
};
const ref = { type: 'follows', from: 'billing$vendor.example', id: 'INV-0', sha256: SHA };
const attachment = { content: 'AA==', type: 'application/pdf', size: 1, sha256: SHA };

/**
 * One case. `fill` writes a long string without spelling it out: `length`
 * characters at `path`, `prefix` and `suffix` included, the rest "a". `repeat` writes an array of `times` copies at `path`.
 */
const accept = (name, type, document, more = {}) => ({
  name,
  type,
  document,
  ...more,
  expect: 'accept',
});
const refuse = (name, type, document, why, more = {}) => ({
  name,
  type,
  document,
  ...more,
  expect: 'refuse',
  why,
});

/** At the limit is accepted; one over is refused. */
const boundary = (name, type, document, path, limit, affix = {}) => [
  accept(`${name}-at-limit`, type, document, { fill: [{ path, length: limit, ...affix }] }),
  refuse(`${name}-one-over`, type, document, `longer than ${limit} characters`, {
    fill: [{ path, length: limit + 1, ...affix }],
  }),
];

const countBoundary = (name, type, document, path, limit, item) => [
  accept(`${name}-at-limit`, type, document, { repeat: [{ path, times: limit, item }] }),
  refuse(`${name}-one-over`, type, document, `more than ${limit}`, {
    repeat: [{ path, times: limit + 1, item }],
  }),
];

/** The four artifact documents: what each type accepts and refuses. */
export function documents() {
  const req = base.trustRequest;
  const res = base.trustResponse;
  const tr = LIMITS.trustRequest;
  const url = { prefix: 'https://example.com/' };
  const cases = [
    // TRUST_REQ
    accept('trust-request', 'TRUST_REQ', req),
    accept('trust-request-full', 'TRUST_REQ', {
      ...req,
      displayName: 'Acme',
      address: '1 Main Street',
      message: 'Hello',
      logoUrl: 'https://acme.example/logo.png',
      websiteUrl: 'https://acme.example',
      expiresAt: ISSUED_AT,
      privacyType: 'encrypted',
    }),
    refuse(
      'trust-request-no-email',
      'TRUST_REQ',
      { ...req, email: undefined },
      'email is required',
    ),
    refuse(
      'trust-request-bad-email',
      'TRUST_REQ',
      { ...req, email: 'not-an-email' },
      'not an email',
    ),
    refuse(
      'trust-request-bad-privacy',
      'TRUST_REQ',
      { ...req, privacyType: 'secret' },
      'unknown privacyType',
    ),
    ...['id', 'name', 'phone', 'reason'].flatMap((field) =>
      boundary(`trust-request-${field}`, 'TRUST_REQ', req, [field], tr[field]),
    ),
    ...['displayName', 'address', 'message'].flatMap((field) =>
      boundary(`trust-request-${field}`, 'TRUST_REQ', req, [field], tr[field]),
    ),
    ...boundary('trust-request-email', 'TRUST_REQ', req, ['email'], tr.email, {
      suffix: '@example.com',
    }),
    ...boundary('trust-request-logoUrl', 'TRUST_REQ', req, ['logoUrl'], tr.logoUrl, url),
    ...boundary('trust-request-websiteUrl', 'TRUST_REQ', req, ['websiteUrl'], tr.websiteUrl, url),

    // TRUST_RES
    accept('trust-response', 'TRUST_RES', res),
    ...['accepted', 'rejected', 'revoked', 'blocked'].map((decision) =>
      accept(`trust-response-${decision}`, 'TRUST_RES', { ...res, decision }),
    ),
    refuse(
      'trust-response-bad-decision',
      'TRUST_RES',
      { ...res, decision: 'maybe' },
      'unknown decision',
    ),
    ...['id', 'decidedBy', 'message'].flatMap((field) =>
      boundary(`trust-response-${field}`, 'TRUST_RES', res, [field], LIMITS.trustResponse[field]),
    ),

    // BTPS_DOC: invoice
    accept('invoice', 'BTPS_DOC', base.invoice),
    accept('invoice-full', 'BTPS_DOC', {
      ...base.invoice,
      dueAt: ISSUED_AT,
      issuer: { name: 'Acme', identifiers: { 'au:abn': '51824753556' } },
      paymentLink: { linkText: 'Pay', url: 'https://pay.acme.example/INV-1' },
      description: 'Website build',
      attachments: [attachment],
      references: [{ ...ref, type: 'correction_of' }],
      metadata: { 'acme:orderId': 'PO-7' },
    }),
    accept('invoice-zero-decimal-currency', 'BTPS_DOC', {
      ...base.invoice,
      totalAmount: { amount: 4997, currency: 'JPY' },
    }),
    refuse(
      'invoice-with-status',
      'BTPS_DOC',
      { ...base.invoice, status: 'unpaid' },
      'a field it does not name (1.0 status)',
    ),
    refuse(
      'invoice-decimal-money',
      'BTPS_DOC',
      { ...base.invoice, totalAmount: aud(1500.5) },
      'money not in whole minor units',
    ),
    refuse(
      'invoice-unknown-currency',
      'BTPS_DOC',
      { ...base.invoice, totalAmount: { amount: 1, currency: 'XYZ' } },
      'not an ISO 4217 currency',
    ),
    refuse(
      'invoice-bad-attachment-hash',
      'BTPS_DOC',
      { ...base.invoice, attachments: [{ ...attachment, sha256: 'A'.repeat(64) }] },
      'sha256 not lowercase hex',
    ),
    refuse(
      'invoice-bad-attachment-type',
      'BTPS_DOC',
      { ...base.invoice, attachments: [{ ...attachment, type: 'text/html' }] },
      'attachment type not allowed',
    ),
    refuse(
      'invoice-bad-reference-type',
      'BTPS_DOC',
      { ...base.invoice, references: [{ ...ref, type: 'Corrects!' }] },
      'reference type not a bare or prefixed code',
    ),
    refuse(
      'invoice-bad-identifier-key',
      'BTPS_DOC',
      { ...base.invoice, issuer: { name: 'Acme', identifiers: { abn: '1' } } },
      'identifier key not namespaced',
    ),
    ...boundary('invoice-id', 'BTPS_DOC', base.invoice, ['id'], LIMITS.documentId),
    ...boundary(
      'reference-id',
      'BTPS_DOC',
      { ...base.invoice, references: [ref] },
      ['references', 0, 'id'],
      LIMITS.documentId,
    ),
    ...boundary(
      'reference-type',
      'BTPS_DOC',
      { ...base.invoice, references: [ref] },
      ['references', 0, 'type'],
      LIMITS.referenceType,
    ),

    // BTPS_DOC: receipt
    accept('receipt', 'BTPS_DOC', base.receipt),
    accept('receipt-for-invoice', 'BTPS_DOC', {
      ...base.receipt,
      lineItems: base.invoice.lineItems,
      references: [{ ...ref, type: 'receipt_for', id: 'INV-1' }],
    }),
    refuse(
      'receipt-no-payment',
      'BTPS_DOC',
      { ...base.receipt, payment: undefined },
      'payment is required',
    ),
    refuse(
      'receipt-zero-payment',
      'BTPS_DOC',
      { ...base.receipt, payment: { ...base.receipt.payment, amount: aud(0) } },
      'a payment must be more than zero',
    ),
    refuse(
      'receipt-with-dueAt',
      'BTPS_DOC',
      { ...base.receipt, dueAt: ISSUED_AT },
      'a receipt asks for no payment',
    ),
    refuse(
      'receipt-with-paymentLink',
      'BTPS_DOC',
      { ...base.receipt, paymentLink: { linkText: 'Pay', url: 'https://pay.example' } },
      'a receipt asks for no payment',
    ),
    ...boundary(
      'receipt-payment-method',
      'BTPS_DOC',
      base.receipt,
      ['payment', 'method'],
      LIMITS.receipt.paymentMethod,
    ),
    ...boundary(
      'receipt-payment-reference',
      'BTPS_DOC',
      base.receipt,
      ['payment', 'reference'],
      LIMITS.receipt.paymentReference,
    ),

    // BTPS_DOC: payslip
    accept('payslip', 'BTPS_DOC', base.payslip),
    accept('payslip-open-codes', 'BTPS_DOC', {
      ...base.payslip,
      jurisdiction: 'AU',
      leave: [
        {
          category: 'au:long_service',
          description: 'Long Service Leave',
          unit: 'weeks',
          balance: '2',
        },
        { category: 'acme:wellbeing_day', unit: 'days', balance: '-1', accrued: '0.5', taken: '1' },
      ],
    }),
    refuse(
      'payslip-decimal-as-number',
      'BTPS_DOC',
      { ...base.payslip, leave: [{ category: 'annual', unit: 'hours', balance: 76.5 }] },
      'a decimal written as a number, not text',
    ),
    refuse(
      'payslip-decimal-comma',
      'BTPS_DOC',
      { ...base.payslip, earnings: [{ category: 'ordinary', rate: '48,75', amount: aud(1) }] },
      'not a decimal',
    ),
    refuse(
      'payslip-lowercase-country',
      'BTPS_DOC',
      { ...base.payslip, jurisdiction: 'au' },
      'not ISO 3166-1 alpha-2',
    ),
    refuse(
      'payslip-no-employee',
      'BTPS_DOC',
      { ...base.payslip, employee: undefined },
      'employee is required',
    ),
    ...boundary(
      'payslip-code',
      'BTPS_DOC',
      base.payslip,
      ['earnings', 0, 'category'],
      LIMITS.payslipCode,
    ),

    // BTPS_DOC: letter
    accept('letter', 'BTPS_DOC', base.letter),
    accept('letter-text', 'BTPS_DOC', {
      ...base.letter,
      body: { format: 'text', content: 'Plain\ntext' },
    }),
    refuse(
      'letter-html',
      'BTPS_DOC',
      { ...base.letter, body: { format: 'html', content: '<b>x</b>' } },
      'html is not a letter format',
    ),
    refuse(
      'letter-with-money',
      'BTPS_DOC',
      { ...base.letter, totalAmount: aud(1) },
      'a letter carries no money',
    ),
    ...boundary('letter-title', 'BTPS_DOC', base.letter, ['title'], LIMITS.letter.title),
    ...boundary(
      'letter-content',
      'BTPS_DOC',
      base.letter,
      ['body', 'content'],
      LIMITS.letter.content,
    ),
    ...countBoundary(
      'letter-attachments',
      'BTPS_DOC',
      base.letter,
      ['attachments'],
      LIMITS.letter.attachments,
      attachment,
    ),
    ...countBoundary(
      'letter-references',
      'BTPS_DOC',
      base.letter,
      ['references'],
      LIMITS.letter.references,
      ref,
    ),
    refuse(
      'document-unknown-type',
      'BTPS_DOC',
      { ...base.letter, type: 'memo' },
      'unknown document type',
    ),

    // BTPS_EVENT
    accept('event-paid', 'BTPS_EVENT', base.event),
    accept('event-partially-paid', 'BTPS_EVENT', {
      ...base.event,
      eventType: 'partially_paid',
      amount: aud(50000),
    }),
    accept('event-disputed', 'BTPS_EVENT', {
      ...base.event,
      eventType: 'disputed',
      reason: 'amount_wrong',
    }),
    accept('event-refund-requested', 'BTPS_EVENT', {
      ...base.event,
      eventType: 'refund_requested',
    }),
    accept('event-refund', 'BTPS_EVENT', {
      ...base.event,
      eventType: 'refund',
      amount: aud(50000),
      inReplyTo: '1c7e5c6f-6e1b-4d5f-9a54-3b8e4b2a0f12',
    }),
    accept('event-response-accepted', 'BTPS_EVENT', {
      ...base.event,
      eventType: 'response',
      decision: 'accepted',
      inReplyTo: '1c7e5c6f-6e1b-4d5f-9a54-3b8e4b2a0f12',
      remainingDueDate: ISSUED_AT,
    }),
    refuse(
      'event-partially-paid-no-amount',
      'BTPS_EVENT',
      { ...base.event, eventType: 'partially_paid' },
      'amount is required',
    ),
    refuse(
      'event-refund-no-inReplyTo',
      'BTPS_EVENT',
      { ...base.event, eventType: 'refund', amount: aud(1) },
      'a reply names what it answers',
    ),
    refuse(
      'event-paid-with-inReplyTo',
      'BTPS_EVENT',
      { ...base.event, inReplyTo: '1c7e5c6f-6e1b-4d5f-9a54-3b8e4b2a0f12' },
      'only replies carry inReplyTo',
    ),
    refuse(
      'event-response-rejected-with-due-date',
      'BTPS_EVENT',
      {
        ...base.event,
        eventType: 'response',
        decision: 'rejected',
        inReplyTo: '1c7e5c6f-6e1b-4d5f-9a54-3b8e4b2a0f12',
        remainingDueDate: ISSUED_AT,
      },
      'remainingDueDate only on an accepted response',
    ),
    refuse(
      'event-unknown-type',
      'BTPS_EVENT',
      { ...base.event, eventType: 'cancelled' },
      'unknown event type',
    ),
    refuse(
      'event-id-not-uuid',
      'BTPS_EVENT',
      { ...base.event, id: 'evt-1' },
      'id is the carrying artifact id, a UUID',
    ),
    ...boundary('event-message', 'BTPS_EVENT', base.event, ['message'], LIMITS.event.message),
    ...boundary(
      'event-reason',
      'BTPS_EVENT',
      { ...base.event, eventType: 'disputed', reason: 'amount_wrong' },
      ['reason'],
      LIMITS.event.reason,
    ),
    ...boundary(
      'event-document-id',
      'BTPS_EVENT',
      base.event,
      ['document', 'id'],
      LIMITS.documentId,
    ),
  ];
  for (const c of cases) {
    // `undefined` means the field is left out; JSON cannot carry it.
    c.document = JSON.parse(JSON.stringify(c.document));
  }
  return {
    description:
      'What each artifact type\'s document accepts and refuses (Transporter Artifact specification; field limits on the Limits page). `type` is the artifact type the document travels in. Apply `fill` (a string of `length` characters at `path`, `prefix` and `suffix` included, the rest the letter "a") and `repeat` (`times` copies of `item` at `path`) to `document` first. An implementation accepts every "accept" case and refuses every "refuse" case; `why` says what is wrong.',
    cases,
    eventEnvelope: {
      description:
        "An event travels in a BTPS_EVENT artifact whose `id` is the event's own id, and is about a document sent between the artifact's two parties: `document.from` is the artifact's `from` or `to`.",
      event: base.event,
      cases: [
        {
          name: 'sent-by-the-payer',
          envelope: { id: base.event.id, from: 'pay$client.example', to: 'billing$vendor.example' },
          expect: 'accept',
        },
        {
          name: 'sent-by-the-biller',
          envelope: { id: base.event.id, from: 'billing$vendor.example', to: 'pay$client.example' },
          expect: 'accept',
        },
        {
          name: 'another-artifact-id',
          envelope: {
            id: '1c7e5c6f-6e1b-4d5f-9a54-3b8e4b2a0f12',
            from: 'pay$client.example',
            to: 'billing$vendor.example',
          },
          expect: 'refuse',
        },
        {
          name: 'a-third-party',
          envelope: {
            id: base.event.id,
            from: 'mallory$elsewhere.example',
            to: 'pay$client.example',
          },
          expect: 'refuse',
        },
      ],
    },
  };
}

const fingerprintOf = (publicKeyPem) =>
  crypto
    .createHash('sha256')
    .update(crypto.createPublicKey(publicKeyPem).export({ format: 'der', type: 'spki' }))
    .digest('base64');

const signWith = (privateKeyPem, value) =>
  crypto
    .sign('sha256', Buffer.from(canonicalizeValue(value), 'utf8'), privateKeyPem)
    .toString('base64');

/**
 * Two transporter artifacts exactly as they travel, signed by the sender:
 * a plain invoice, and the same invoice encrypted to the receiver.
 */
export function signedArtifacts(senderKey, receiverKey) {
  const sender = {
    identity: 'billing$vendor.example',
    selector: 'btps1',
    publicKeyPem: senderKey.publicKeyPem,
  };
  const receiver = { identity: 'pay$client.example', selector: 'btps1' };
  const unsigned = (id, document, encryption) => ({
    version: '1.1.0',
    id,
    issuedAt: ISSUED_AT,
    type: 'BTPS_DOC',
    from: sender.identity,
    to: receiver.identity,
    selector: sender.selector,
    encryption,
    document,
  });
  const signed = (artifact) => ({
    ...artifact,
    signature: {
      algorithmHash: 'sha256',
      value: signWith(senderKey.privateKeyPem, artifact),
      fingerprint: fingerprintOf(senderKey.publicKeyPem),
    },
  });

  const plain = unsigned('5a1e8f3c-2b4d-4e6f-8a9b-0c1d2e3f4a5b', base.invoice, null);

  // AES-256-GCM over JSON.stringify(document), its key wrapped by RSA-OAEP (SHA-256).
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(base.invoice), 'utf8'), cipher.final()]);
  const encrypted = unsigned('6b2f9a4d-3c5e-4f70-9bac-1d2e3f4a5b6c', data.toString('base64'), {
    algorithm: 'aes-256-gcm',
    encryptedKey: oaepEncrypt(receiverKey.publicKeyPem, aesKey, {
      oaepHash: 'sha256',
      mgf1Hash: 'sha256',
    }).toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    type: 'standardEncrypt',
  });

  return {
    description:
      "Transporter artifacts exactly as they travel. The signature is RSASSA-PKCS1-v1_5 with SHA-256 over the RFC 8785 canonical form of the artifact without its `signature`; `fingerprint` is the base64 SHA-256 of the sender's SPKI public key. The encrypted document is AES-256-GCM over JSON.stringify(document), with a 12-byte IV and a 16-byte tag, its key wrapped to the receiver with RSA-OAEP (SHA-256, MGF1 SHA-256). An implementation verifies both signatures, reproduces each `canonical` exactly, and decrypts the encrypted document to `document`.",
    provenance:
      "The sender key is kms-signature.vector.json's; the receiver key is oaep-wrap.vector.json's. Both are TEST-ONLY.",
    sender,
    receiver: { ...receiver, keyVector: 'oaep-wrap.vector.json' },
    document: base.invoice,
    artifacts: [
      { name: 'plain', canonical: canonicalizeValue(plain), artifact: signed(plain) },
      { name: 'encrypted', canonical: canonicalizeValue(encrypted), artifact: signed(encrypted) },
    ],
  };
}

/** A device moving to a new key proves it with the new key's signature. */
export function deviceKeyProof(newKey) {
  const payload = {
    type: 'btps_key_proof',
    agentId: 'btps_ag_7d1c2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
    identity: 'alice$saas.example',
    publicKey: newKey.publicKeyPem,
  };
  return {
    description:
      'auth.refresh with a new key carries keyProof: a signature by the NEW key over the canonical form of { type: "btps_key_proof", agentId, identity, publicKey }, where publicKey is the new key. The artifact itself is still signed by the current key. An implementation reproduces `canonical` and verifies `keyProof` with `payload.publicKey`.',
    provenance: "The new key is self-held-signature.vector.json's. TEST-ONLY.",
    payload,
    canonical: canonicalize(JSON.stringify(payload)),
    keyProof: {
      algorithmHash: 'sha256',
      value: signWith(newKey.privateKeyPem, payload),
      fingerprint: fingerprintOf(newKey.publicKeyPem),
    },
  };
}

/** The time window: issuedAt may be at most maxArtifactAgeSeconds from the server's clock, either way. */
export function timeWindow() {
  const now = '2026-10-19T12:00:00.000Z';
  const at = (seconds) => new Date(Date.parse(now) + seconds * 1000).toISOString();
  return {
    description:
      'A server refuses a signed artifact whose issuedAt is further than maxArtifactAgeSeconds from its own clock, in either direction (BTP_ERROR_ARTIFACT_TIME_WINDOW). The edge itself is inside. An issuedAt that is not a date is refused.',
    now,
    cases: [
      { name: 'now', issuedAt: now, maxAgeSeconds: 300, expect: 'accept' },
      { name: 'at-the-edge-in-the-past', issuedAt: at(-300), maxAgeSeconds: 300, expect: 'accept' },
      {
        name: 'at-the-edge-in-the-future',
        issuedAt: at(300),
        maxAgeSeconds: 300,
        expect: 'accept',
      },
      { name: 'one-second-too-old', issuedAt: at(-301), maxAgeSeconds: 300, expect: 'refuse' },
      { name: 'one-second-too-far-ahead', issuedAt: at(301), maxAgeSeconds: 300, expect: 'refuse' },
      { name: 'inside-a-minimum-window', issuedAt: at(-60), maxAgeSeconds: 60, expect: 'accept' },
      { name: 'outside-a-minimum-window', issuedAt: at(-61), maxAgeSeconds: 60, expect: 'refuse' },
      { name: 'not-a-date', issuedAt: 'yesterday', maxAgeSeconds: 300, expect: 'refuse' },
    ],
  };
}
