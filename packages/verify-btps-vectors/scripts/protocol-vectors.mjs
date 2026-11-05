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

/*
 * BTPS 1.2. A 1.2 rule applies to 1.2.0 artifacts only, so every 1.2 case
 * names the version of the artifact its document travels in, and a document
 * valid in 1.1 stays valid under 1.1.0 on a 1.2 server.
 */
const V11 = '1.1.0';
const V12 = '1.2.0';
const REPLY_TO = '3c8e7a2b-5d4f-4e1a-8b6c-9d0e1f2a3b4c';
// A note's content: as long as an event's or a trust request's message.
const NOTE_LIMIT = 5000;
const note = (content, format = 'markdown') => ({ format, content });
const under = (version, more = {}) => ({ version, ...more });
const templateData = {
  version: '1.2.0',
  sha256: SHA,
  source: 'https://templates.example/acme/classic-invoice@1.2.0',
  logo: { sha256: SHA, source: 'https://templates.example/logos/acme.png' },
};

/** The versions a 1.2 implementation speaks, and the version it stamps each artifact with. */
export function versions() {
  const doc = (document, envelope = {}) => ({
    type: 'BTPS_DOC',
    from: 'billing$vendor.example',
    to: 'pay$client.example',
    document,
    encryption: null,
    ...envelope,
  });
  const event = (document) => ({
    ...doc(document),
    type: 'BTPS_EVENT',
    relatesTo: 'artifact-1',
  });
  const stamped = (name, artifact, expect) => ({ name, artifact, expect });
  const withdrawn = { ...base.event, eventType: 'withdrawn', inReplyTo: REPLY_TO };
  return {
    description:
      'A 1.2 implementation speaks 1.1 and 1.2: it takes every artifact stamped 1.1.x or 1.2.x and refuses any other version (BTP_ERROR_VERSION_UNSUPPORTED), compared by major and minor. It stamps an artifact 1.1.0 when everything in it can be said in 1.1, and 1.2.0 only when it uses something 1.2 adds, so a 1.1 receiver takes every artifact a 1.1 sender could have sent. `stamped` gives each artifact before it is signed (an encrypted one by its envelope) and the version it is stamped with.',
    supported: [
      { version: '1.1.0', expect: 'accept' },
      { version: '1.1.9', expect: 'accept' },
      { version: '1.2.0', expect: 'accept' },
      { version: '1.2.4', expect: 'accept' },
      { version: '1.0.0', expect: 'refuse' },
      { version: '1.3.0', expect: 'refuse' },
      { version: '2.2.0', expect: 'refuse' },
      { version: 'v1.2.0', expect: 'refuse' },
      { version: '', expect: 'refuse' },
    ],
    stamped: [
      stamped('invoice', doc(base.invoice), V11),
      stamped('invoice-with-a-plain-note', doc({ ...base.invoice, description: 'Thanks' }), V11),
      // 1.1 already carries a discount as a column and template data as free keys.
      stamped(
        'invoice-with-a-discount-column',
        doc({
          ...base.invoice,
          lineItems: {
            columns: ['Item', 'Amount', 'discount'],
            rows: [{ Item: 'Website build', Amount: 150000, discount: 5000 }],
          },
        }),
        V11,
      ),
      stamped(
        'invoice-with-template-data',
        doc({ ...base.invoice, template: { name: 'acme/classic', data: templateData } }),
        V11,
      ),
      stamped('trust-request', { ...doc(base.trustRequest), type: 'TRUST_REQ' }, V11),
      stamped('paid-event', event(base.event), V11),
      // A lookup and a control artifact say nothing 1.2 adds, so every 1.1 and 1.2 server answers them.
      stamped(
        'identity-lookup',
        {
          id: 'lookup-1',
          issuedAt: ISSUED_AT,
          identity: 'pay$client.example',
          from: 'billing$vendor.example',
          hostSelector: 'btps1',
        },
        V11,
      ),
      stamped('ping', { id: 'ping-1', issuedAt: ISSUED_AT, action: 'PING' }, V11),
      stamped('quit', { id: 'quit-1', issuedAt: ISSUED_AT, action: 'QUIT' }, V11),
      stamped(
        'encrypted-document',
        doc('ciphertext', {
          encryption: {
            algorithm: 'aes-256-gcm',
            encryptedKey: 'AA==',
            iv: 'AA==',
            authTag: 'AA==',
            type: 'standardEncrypt',
          },
        }),
        V11,
      ),
      stamped('withdrawn-event', event(withdrawn), V12),
      stamped(
        'proposal-following-a-withdrawal',
        event({ ...base.event, eventType: 'disputed', reason: 'amount_wrong', follows: REPLY_TO }),
        V12,
      ),
      stamped(
        'invoice-note-with-a-format',
        doc({ ...base.invoice, description: note('**Thanks**') }),
        V12,
      ),
      stamped(
        'event-message-with-a-format',
        event({ ...base.event, message: note('Paid today') }),
        V12,
      ),
      stamped('invoice-discount', doc({ ...base.invoice, discount: { percent: 1000 } }), V12),
      stamped('receipt-discount', doc({ ...base.receipt, discount: { amount: 500 } }), V12),
      stamped(
        'letter-template',
        doc({ ...base.letter, template: { name: 'acme/letter', data: {} } }),
        V12,
      ),
      stamped(
        'sync',
        doc(base.invoice, {
          from: 'alice$saas.example',
          to: 'alice$saas.example',
          syncOf: { id: 'artifact-1', sha256: SHA },
        }),
        V12,
      ),
      stamped('document-type', doc(base.invoice, { documentType: 'invoice' }), V12),
      stamped(
        'trust-request-permissions',
        {
          ...doc({
            ...base.trustRequest,
            permissions: { send: [{ name: 'send:invoice', required: true }], details: [] },
          }),
          type: 'TRUST_REQ',
        },
        V12,
      ),
    ],
  };
}

/** The 1.2 document rules, and the 1.1 documents they must leave as they are. */
export function documents12() {
  const inv = base.invoice;
  const rows = (discount) => ({
    columns: ['Item', 'Amount', 'discount'],
    rows: [{ Item: 'Website build', Amount: 150000, discount }],
  });
  const withdrawn = { ...base.event, eventType: 'withdrawn', inReplyTo: REPLY_TO };
  const disputed = { ...base.event, eventType: 'disputed', reason: 'amount_wrong' };
  const template = (data) => ({ name: 'acme/classic', data });
  const v12 = under(V12);
  const v11 = under(V11);
  const cases = [
    // The withdrawn event: the payer takes back its own unanswered proposal.
    accept('withdrawn', 'BTPS_EVENT', withdrawn, v12),
    refuse(
      'withdrawn-without-in-reply-to',
      'BTPS_EVENT',
      { ...base.event, eventType: 'withdrawn' },
      'inReplyTo is required',
      v12,
    ),
    refuse(
      'withdrawn-with-a-reason',
      'BTPS_EVENT',
      { ...withdrawn, reason: 'amount_wrong' },
      'a withdrawn carries nothing beyond the shared fields and inReplyTo',
      v12,
    ),
    refuse('withdrawn-under-1-1', 'BTPS_EVENT', withdrawn, '1.1 has no withdrawn event', v11),
    accept(
      'disputed-following-a-withdrawal',
      'BTPS_EVENT',
      { ...disputed, follows: REPLY_TO },
      v12,
    ),
    accept(
      'refund-requested-following-a-withdrawal',
      'BTPS_EVENT',
      { ...base.event, eventType: 'refund_requested', follows: REPLY_TO },
      v12,
    ),
    accept('paid-following-a-withdrawal', 'BTPS_EVENT', { ...base.event, follows: REPLY_TO }, v12),
    accept(
      'partially-paid-following-a-withdrawal',
      'BTPS_EVENT',
      { ...base.event, eventType: 'partially_paid', amount: aud(500), follows: REPLY_TO },
      v12,
    ),
    refuse(
      'refund-with-follows',
      'BTPS_EVENT',
      {
        ...base.event,
        eventType: 'refund',
        amount: aud(1),
        inReplyTo: REPLY_TO,
        follows: REPLY_TO,
      },
      'only a proposal follows a withdrawal',
      v12,
    ),
    refuse(
      'follows-not-an-event-id',
      'BTPS_EVENT',
      { ...disputed, follows: 'not-a-uuid' },
      'follows is the id of the withdrawn event',
      v12,
    ),
    refuse(
      'response-with-follows',
      'BTPS_EVENT',
      {
        ...base.event,
        eventType: 'response',
        decision: 'accepted',
        inReplyTo: REPLY_TO,
        follows: REPLY_TO,
      },
      'only a proposal follows a withdrawal',
      v12,
    ),
    refuse(
      'follows-under-1-1',
      'BTPS_EVENT',
      { ...disputed, follows: REPLY_TO },
      '1.1 events have no follows',
      v11,
    ),

    // A note says how it is written.
    accept('invoice-note-markdown', 'BTPS_DOC', { ...inv, description: note('**Thanks**') }, v12),
    accept('invoice-note-text', 'BTPS_DOC', { ...inv, description: note('Thanks', 'text') }, v12),
    accept('invoice-note-plain-string', 'BTPS_DOC', { ...inv, description: 'Thanks' }, v12),
    refuse(
      'invoice-note-html',
      'BTPS_DOC',
      { ...inv, description: note('<b>Thanks</b>', 'html') },
      'a note is text or markdown',
      v12,
    ),
    accept(
      'invoice-note-at-limit',
      'BTPS_DOC',
      { ...inv, description: note('') },
      {
        ...v12,
        fill: [{ path: ['description', 'content'], length: NOTE_LIMIT }],
      },
    ),
    refuse(
      'invoice-note-one-over',
      'BTPS_DOC',
      { ...inv, description: note('') },
      `longer than ${NOTE_LIMIT} characters`,
      {
        ...v12,
        fill: [{ path: ['description', 'content'], length: NOTE_LIMIT + 1 }],
      },
    ),
    refuse(
      'invoice-plain-note-one-over',
      'BTPS_DOC',
      { ...inv, description: '' },
      `a plain note is read as text, and longer than ${NOTE_LIMIT} characters`,
      {
        ...v12,
        fill: [{ path: ['description'], length: NOTE_LIMIT + 1 }],
      },
    ),
    refuse(
      'invoice-note-with-a-format-under-1-1',
      'BTPS_DOC',
      { ...inv, description: note('Thanks') },
      'a 1.1 note is a string',
      v11,
    ),
    accept(
      'invoice-long-plain-note-under-1-1',
      'BTPS_DOC',
      { ...inv, description: '' },
      {
        ...v11,
        fill: [{ path: ['description'], length: NOTE_LIMIT + 1 }],
      },
    ),
    accept(
      'receipt-note-markdown',
      'BTPS_DOC',
      { ...base.receipt, description: note('Paid') },
      v12,
    ),
    accept(
      'event-message-markdown',
      'BTPS_EVENT',
      { ...base.event, message: note('Paid **today**') },
      v12,
    ),
    refuse(
      'event-message-with-a-format-under-1-1',
      'BTPS_EVENT',
      { ...base.event, message: note('Paid') },
      'a 1.1 message is a string',
      v11,
    ),
    accept(
      'trust-request-message-markdown',
      'TRUST_REQ',
      { ...base.trustRequest, message: note('Hello') },
      v12,
    ),
    accept(
      'trust-response-message-markdown',
      'TRUST_RES',
      { ...base.trustResponse, message: note('Welcome') },
      v12,
    ),

    // Discounts: on the whole invoice, an amount or a percentage; on a line, a column.
    accept('invoice-discount-amount', 'BTPS_DOC', { ...inv, discount: { amount: 500 } }, v12),
    accept('invoice-discount-percent', 'BTPS_DOC', { ...inv, discount: { percent: 1000 } }, v12),
    accept(
      'invoice-discount-whole-percent',
      'BTPS_DOC',
      { ...inv, discount: { percent: 10000 } },
      v12,
    ),
    refuse(
      'invoice-discount-no-percent',
      'BTPS_DOC',
      { ...inv, discount: { percent: 0 } },
      'percent is 1 to 10000 basis points',
      v12,
    ),
    refuse(
      'invoice-discount-over-whole',
      'BTPS_DOC',
      { ...inv, discount: { percent: 10001 } },
      'percent is 1 to 10000 basis points',
      v12,
    ),
    refuse(
      'invoice-discount-fractional-percent',
      'BTPS_DOC',
      { ...inv, discount: { percent: 12.5 } },
      'percent is whole basis points',
      v12,
    ),
    refuse(
      'invoice-discount-no-amount',
      'BTPS_DOC',
      { ...inv, discount: { amount: 0 } },
      'a discount amount is positive',
      v12,
    ),
    refuse(
      'invoice-discount-money',
      'BTPS_DOC',
      { ...inv, discount: { amount: aud(500) } },
      'a discount amount is a plain integer in the invoice currency',
      v12,
    ),
    refuse(
      'invoice-discount-both',
      'BTPS_DOC',
      { ...inv, discount: { amount: 500, percent: 1000 } },
      'an amount or a percentage, not both',
      v12,
    ),
    refuse(
      'invoice-discount-under-1-1',
      'BTPS_DOC',
      { ...inv, discount: { amount: 500 } },
      '1.1 invoices have no discount',
      v11,
    ),
    accept('receipt-discount', 'BTPS_DOC', { ...base.receipt, discount: { amount: 500 } }, v12),
    accept('invoice-line-discount', 'BTPS_DOC', { ...inv, lineItems: rows(5000) }, v12),
    refuse(
      'invoice-negative-line-discount',
      'BTPS_DOC',
      { ...inv, lineItems: rows(-5000) },
      'a line discount is an integer of at least 0',
      v12,
    ),
    accept(
      'invoice-negative-line-discount-under-1-1',
      'BTPS_DOC',
      { ...inv, lineItems: rows(-5000) },
      v11,
    ),

    // Templates and logos by reference.
    accept(
      'invoice-template-named-fields',
      'BTPS_DOC',
      { ...inv, template: template(templateData) },
      v12,
    ),
    accept(
      'invoice-template-other-keys',
      'BTPS_DOC',
      { ...inv, template: template({ accent: '#0747a6' }) },
      v12,
    ),
    refuse(
      'invoice-template-sha256-not-hex',
      'BTPS_DOC',
      { ...inv, template: template({ ...templateData, sha256: 'ABC' }) },
      'sha256 is 64 lowercase hex characters',
      v12,
    ),
    refuse(
      'invoice-template-source-not-https',
      'BTPS_DOC',
      { ...inv, template: template({ ...templateData, source: 'http://templates.example/a' }) },
      'source is an https URL',
      v12,
    ),
    refuse(
      'invoice-template-version-not-semver',
      'BTPS_DOC',
      { ...inv, template: template({ ...templateData, version: 'latest' }) },
      'version is a semantic version',
      v12,
    ),
    refuse(
      'invoice-template-logo-not-https',
      'BTPS_DOC',
      {
        ...inv,
        template: template({
          ...templateData,
          logo: { sha256: SHA, source: 'ftp://logos.example/a' },
        }),
      },
      'logo.source is an https URL',
      v12,
    ),
    accept(
      'invoice-template-own-shapes-under-1-1',
      'BTPS_DOC',
      { ...inv, template: template({ logo: 'acme.png', sha256: 'ABC', version: 'latest' }) },
      v11,
    ),
    accept('letter-template', 'BTPS_DOC', { ...base.letter, template: template({}) }, v12),
    accept('payslip-template', 'BTPS_DOC', { ...base.payslip, template: template({}) }, v12),
    refuse(
      'letter-template-under-1-1',
      'BTPS_DOC',
      { ...base.letter, template: template({}) },
      '1.1 letters have no template',
      v11,
    ),
  ];
  return {
    description:
      'The BTPS 1.2 document rules, read as documents.vectors.json is (apply `fill` and `repeat` first). Each case names `version`, the version of the artifact the document travels in: 1.2 rules apply only under 1.2.0, and under 1.1.0 a document is read exactly as 1.1 reads it. An implementation accepts every "accept" case and refuses every "refuse" case; `why` says what is wrong.',
    cases,
  };
}

/** The 1.2 event chain: what a withdrawn takes back, and what a proposal sent again follows. */
export function eventChain() {
  const payer = 'pay$client.example';
  const biller = 'billing$vendor.example';
  const withdrawn = { ...base.event, eventType: 'withdrawn', inReplyTo: REPLY_TO };
  const disputedAgain = {
    ...base.event,
    eventType: 'disputed',
    reason: 'amount_wrong',
    follows: REPLY_TO,
  };
  const invoice = { from: base.event.document.from, id: base.event.document.id };
  const otherInvoice = { ...invoice, id: 'INV-2' };
  const facts = (eventType, from, state, document = invoice) => ({
    eventType,
    from,
    state,
    document,
  });
  const chain = (name, event, named, expect, why, from = payer) => ({
    name,
    event,
    envelope: { from },
    named,
    expect,
    ...(why && { why }),
  });
  return {
    description:
      'The BTPS 1.2 event chain. `event` is sent by `envelope.from`; `named` is what the receiving platform holds of the event it names (`inReplyTo` on a withdrawn, `follows` on a proposal) between the same two parties, with the invoice it is about, or null when it holds none. Only the payer withdraws or proposes again, never the invoice\'s issuer (`event.document.from`), whose own recorded `paid` is final. A withdrawn takes back the payer\'s own proposal (paid, partially_paid, disputed or refund_requested) about the same invoice while it is open; a proposal sent again follows a withdrawn about the same invoice. An implementation accepts every "accept" case and refuses every "refuse" case; `why` says what is wrong.',
    cases: [
      chain(
        'biller-withdraws-its-own-paid',
        withdrawn,
        facts('paid', biller, 'open'),
        'refuse',
        "a biller's own recorded paid is final; only the payer withdraws",
        biller,
      ),
      chain(
        'biller-proposes-again',
        disputedAgain,
        facts('withdrawn', biller, 'answered'),
        'refuse',
        'only the payer proposes again',
        biller,
      ),
      chain(
        'withdrawn-names-a-proposal-about-another-invoice',
        withdrawn,
        facts('disputed', payer, 'open', otherInvoice),
        'refuse',
        'a withdrawn is about the same invoice as the proposal it takes back',
      ),
      chain(
        'proposal-follows-a-withdrawn-about-another-invoice',
        disputedAgain,
        facts('withdrawn', payer, 'answered', otherInvoice),
        'refuse',
        'a proposal follows a withdrawn about the same invoice',
      ),
      chain('withdrawn-own-open-proposal', withdrawn, facts('disputed', payer, 'open'), 'accept'),
      chain(
        'withdrawn-names-no-event',
        withdrawn,
        null,
        'refuse',
        'no event between the same two parties',
      ),
      chain(
        'withdrawn-names-a-response',
        withdrawn,
        facts('response', payer, 'answered'),
        'refuse',
        'only a proposal can be withdrawn',
      ),
      chain(
        'withdrawn-names-the-other-party-proposal',
        withdrawn,
        facts('disputed', biller, 'open'),
        'refuse',
        'only its sender can withdraw a proposal',
      ),
      chain(
        'withdrawn-names-an-answered-proposal',
        withdrawn,
        facts('disputed', payer, 'answered'),
        'refuse',
        'an answered proposal stays as answered',
      ),
      chain(
        'withdrawn-names-a-withdrawn-proposal',
        withdrawn,
        facts('paid', payer, 'withdrawn'),
        'refuse',
        'a proposal is withdrawn once',
      ),
      chain(
        'proposal-follows-a-withdrawn',
        disputedAgain,
        facts('withdrawn', payer, 'answered'),
        'accept',
      ),
      chain(
        'proposal-follows-no-event',
        disputedAgain,
        null,
        'refuse',
        'follows names no event between the same two parties',
      ),
      chain(
        'proposal-follows-a-proposal',
        disputedAgain,
        facts('disputed', payer, 'open'),
        'refuse',
        'follows names a withdrawn',
      ),
      chain('proposal-without-follows', base.event, null, 'accept'),
    ],
  };
}

/** BTPS 1.2 sync: a sync's envelope, how it names the send it copies, and a send's outcome. */
export function sync() {
  const user = 'alice$saas.example';
  const encrypted = {
    algorithm: 'aes-256-gcm',
    encryptedKey: 'AA==',
    iv: 'AA==',
    authTag: 'AA==',
    type: 'standardEncrypt',
  };
  const sent = {
    version: V11,
    issuedAt: ISSUED_AT,
    id: '6f1d2c3b-4a59-4e8f-9b7a-1c2d3e4f5a6b',
    type: 'BTPS_DOC',
    from: user,
    to: 'pay$client.example',
    selector: 'btps1',
    signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
    encryption: encrypted,
    document: 'ciphertext-to-the-receiver',
  };
  const syncOf = {
    id: sent.id,
    sha256: crypto.createHash('sha256').update(canonicalizeValue(sent), 'utf8').digest('hex'),
  };
  const sync = {
    ...sent,
    version: V12,
    id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    to: user,
    document: 'ciphertext-to-the-user',
    syncOf,
  };
  const envelope = (name, artifact, expect, why) => ({
    name,
    artifact,
    expect,
    ...(why && { why }),
  });
  const entry = (name, delivery, expect, why) => ({
    name,
    entry: { artifact: sent, meta: { delivery } },
    expect,
    ...(why && { why }),
  });
  return {
    description:
      "BTPS 1.2 sync. A device's sync is an artifact.send to the user's own address whose transporter envelope names the send it copies: `syncOf: { id, sha256 }`, the sent artifact's id and the lowercase hex SHA-256 of its RFC 8785 form, signature included. `syncOf` is only on an artifact from and to the same address (compared without case), and only in a `1.2.0` artifact. `hash` is a sent artifact and the `syncOf` that names it. A provider refuses a sync sent to it directly (`BTP_ERROR_SYNC_NOT_ALLOWED`): it comes only inside its own device's artifact.send. `delivery` cases are sentbox result entries whose `meta.delivery` is the provider's own record of a send: `status` pending, delivered or failed, an optional BTPS error `code`, and `at`, always.",
    hash: { sent, syncOf },
    envelopes: [
      envelope('sync', sync, 'accept'),
      envelope('sync-address-in-another-case', { ...sync, from: 'Alice$SaaS.example' }, 'accept'),
      envelope(
        'sync-to-another-address',
        { ...sync, to: 'pay$client.example' },
        'refuse',
        "a sync is to the sender's own address",
      ),
      envelope(
        'sync-under-1-1',
        { ...sync, version: V11 },
        'refuse',
        'syncOf is only in a 1.2.0 artifact',
      ),
      envelope(
        'sync-hash-not-lowercase-hex',
        { ...sync, syncOf: { ...syncOf, sha256: syncOf.sha256.toUpperCase() } },
        'refuse',
        'the SHA-256 is lowercase hex',
      ),
      envelope(
        'sync-without-an-id',
        { ...sync, syncOf: { sha256: syncOf.sha256 } },
        'refuse',
        'syncOf names the id of the send',
      ),
      envelope(
        'sync-with-more',
        { ...sync, syncOf: { ...syncOf, delivered: true } },
        'refuse',
        'syncOf holds its id and sha256 only',
      ),
    ],
    delivery: [
      entry('pending', { status: 'pending', at: ISSUED_AT }, 'accept'),
      entry('delivered', { status: 'delivered', at: ISSUED_AT }, 'accept'),
      entry(
        'failed-with-its-code',
        { status: 'failed', code: 'BTP_ERROR_TRUST_NOT_ALLOWED', at: ISSUED_AT },
        'accept',
      ),
      entry(
        'another-status',
        { status: 'lost', at: ISSUED_AT },
        'refuse',
        'status is one of three',
      ),
      entry(
        'without-when',
        { status: 'failed', code: 'BTP_ERROR_TRUST_NOT_ALLOWED' },
        'refuse',
        'a delivery always says when',
      ),
      entry(
        'with-more',
        { status: 'delivered', at: ISSUED_AT, seenBy: 'pay$client.example' },
        'refuse',
        'a delivery holds status, code and at only: no receipt from the receiver',
      ),
    ],
  };
}
