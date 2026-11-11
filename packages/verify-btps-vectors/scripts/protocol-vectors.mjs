/**
 * The protocol vectors: what any BTPS implementation must accept and refuse,
 * and artifacts exactly as they travel. Written from the specification
 * (docs/docusaurus/docs/protocol/specifications), never computed by the SDK,
 * so they test the SDK rather than repeat it.
 *
 * Keys are the existing test keys: the sender signs with the key in
 * kms-signature.vector.json, and the receiver's key is the one in
 * oaep-wrap.vector.json. No new key is made, except the agreement vectors'
 * other signer, device and operator, which the generator makes and passes in.
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
  const trustRequest = (envelope, document = {}) => ({
    ...doc({ ...base.trustRequest, ...document }, envelope),
    type: 'TRUST_REQ',
  });
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
        trustRequest({
          permissions: [{ name: 'send:invoice', required: true }],
        }),
        V12,
      ),
      stamped('trust-request-entity-type', trustRequest({ entityType: 'organisation' }), V12),
      stamped('trust-request-given', trustRequest({ given: ['detail:email'] }), V12),
      stamped('trust-request-change', trustRequest({ change: true }), V12),
      stamped('trust-request-own', trustRequest({}, { own: { 'detail:dob': '1990-04-21' } }), V12),
      stamped(
        'trust-request-verification',
        trustRequest(
          {},
          {
            verification: {
              subject: 'billing$vendor.example',
              claims: { 'detail:legalName': base.trustRequest.name },
              verifiedAt: ISSUED_AT,
              expiresAt: '2027-10-19T00:00:00.000Z',
              verifiedBy: 'admin$verifier.example',
              selector: 'btps1',
            },
          },
        ),
        V12,
      ),
      stamped(
        'trust-response-granted',
        { ...doc(base.trustResponse, { granted: ['send:invoice'] }), type: 'TRUST_RES' },
        V12,
      ),
      stamped(
        'trust-response-entity-type',
        { ...doc(base.trustResponse, { entityType: 'person' }), type: 'TRUST_RES' },
        V12,
      ),
      stamped(
        'trust-response-details',
        {
          ...doc({ ...base.trustResponse, details: { 'detail:email': 'bob@client.example' } }),
          type: 'TRUST_RES',
        },
        V12,
      ),
      ...['DETAILS_CHANGED', 'DETAILS_REQ', 'DETAILS_RES'].map((type) =>
        stamped(
          type.toLowerCase().replace('_', '-'),
          {
            ...doc('ciphertext', { details: ['detail:address'] }),
            type,
            ...(type === 'DETAILS_RES' && { relatesTo: 'artifact-1' }),
          },
          V12,
        ),
      ),
    ],
  };
}

/** The 1.2 document rules, and the 1.1 documents they must leave as they are. */
/** A letter template's signature values, `template.data.values`: 1.2.0, a letter's template only. */
function signatureValueCases(template, v12) {
  const drawn = { strokes: [[0, 0, 500, 150, 1000, 300]] };
  const values = {
    'signature.typed': 'Jo Bloggs',
    'signature.name': 'Jo Bloggs',
    'signature.title': 'Director, 2nd floor',
    'signature.drawn': drawn,
  };
  const letter = (more) => ({
    ...base.letter,
    template: template({ values: { ...values, ...more } }),
  });
  const stroke = (points) => Array.from({ length: points * 2 }, (_, at) => (at % 2 ? 150 : 500));
  const refuseLetter = (name, more, why) => refuse(name, 'BTPS_DOC', letter(more), why, v12);
  return [
    accept('letter-signature-values', 'BTPS_DOC', letter({}), v12),
    accept(
      'letter-signature-at-every-limit',
      'BTPS_DOC',
      letter({
        'signature.name': 'x'.repeat(100),
        'signature.drawn': {
          strokes: [...Array.from({ length: 3 }, () => stroke(512)), stroke(512)],
        },
      }),
      v12,
    ),
    refuseLetter(
      'letter-signature-naming-a-document-field',
      { totalAmount: { amount: 100, currency: 'AUD' } },
      'a value fills a fixed slot, never a document field',
    ),
    refuseLetter(
      'letter-signature-unknown-slot',
      { 'signature.stamp': 'Approved' },
      'slot names are a fixed list',
    ),
    refuseLetter(
      'letter-signature-drawn-as-svg',
      { 'signature.drawn': '<svg><path d="M0 0L10 10"/></svg>' },
      'a drawn signature is integer strokes, never markup',
    ),
    refuseLetter(
      'letter-signature-drawn-with-markup',
      { 'signature.drawn': { svg: '<path d="M0 0"/>' } },
      'a drawn signature holds strokes only',
    ),
    refuseLetter(
      'letter-signature-stroke-outside-the-canvas',
      { 'signature.drawn': { strokes: [[0, 0, 1001, 150]] } },
      'the canvas is 1000 by 300',
    ),
    refuseLetter(
      'letter-signature-stroke-below-the-canvas',
      { 'signature.drawn': { strokes: [[0, 0, 500, 301]] } },
      'the canvas is 1000 by 300',
    ),
    refuseLetter(
      'letter-signature-stroke-odd',
      { 'signature.drawn': { strokes: [[0, 0, 500]] } },
      'a stroke is x, y pairs',
    ),
    refuseLetter(
      'letter-signature-stroke-not-integers',
      { 'signature.drawn': { strokes: [[0, 0, 500.5, 150]] } },
      'points are integers',
    ),
    refuseLetter(
      'letter-signature-too-many-strokes',
      { 'signature.drawn': { strokes: Array.from({ length: 33 }, () => [0, 0, 1, 1]) } },
      'at most 32 strokes',
    ),
    refuseLetter(
      'letter-signature-stroke-too-long',
      { 'signature.drawn': { strokes: [stroke(513)] } },
      'at most 512 points a stroke',
    ),
    refuseLetter(
      'letter-signature-too-many-points',
      { 'signature.drawn': { strokes: Array.from({ length: 5 }, () => stroke(410)) } },
      'at most 2048 points in all',
    ),
    refuseLetter(
      'letter-signature-name-one-over',
      { 'signature.name': 'x'.repeat(101) },
      'a signature text is at most 100 characters',
    ),
    refuseLetter(
      'letter-signature-name-with-markup',
      { 'signature.name': '<b>Jo</b>' },
      'a signature text is plain text',
    ),
    refuseLetter(
      'letter-signature-name-reads-backwards',
      { 'signature.name': 'Jo \u202eSggolb' },
      'no direction-changing character',
    ),
    refuse(
      'invoice-template-with-values',
      'BTPS_DOC',
      { ...base.invoice, template: template({ values }) },
      "values are only on a letter's or an agreement's template",
      v12,
    ),
    refuse(
      'payslip-template-with-values',
      'BTPS_DOC',
      { ...base.payslip, template: template({ values }) },
      "values are only on a letter's or an agreement's template",
      v12,
    ),
  ];
}

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
      'invoice-template-source-without-sha256',
      'BTPS_DOC',
      { ...inv, template: template({ source: templateData.source }) },
      'a source comes with the sha256 of what it serves',
      v12,
    ),
    accept(
      'invoice-template-sha256-without-source',
      'BTPS_DOC',
      { ...inv, template: template({ sha256: SHA }) },
      v12,
    ),
    accept(
      'invoice-template-source-without-sha256-under-1-1',
      'BTPS_DOC',
      { ...inv, template: template({ source: templateData.source }) },
      v11,
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
    // A letter template's signature values: the sender's own, signed with the document.
    ...signatureValueCases(template, v12),
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

/** BTPS 1.2 server responses: how long a 429 asks its sender to wait. */
export function responses() {
  const response = (name, status, expect, why, version = V12) => ({
    name,
    response: {
      version,
      status: { ok: false, ...status },
      id: '7b2e4f60-1c3d-4e5f-8a9b-0c1d2e3f4a5b',
      issuedAt: ISSUED_AT,
      type: 'btps_error',
      reqId: 'req-1',
    },
    expect,
    ...(why && { why }),
  });
  const limited = {
    code: 429,
    message: 'Too many details requests on this trust. Ask again later',
    error: 'BTP_ERROR_DETAILS_RATE_LIMITED',
  };
  return {
    description:
      "BTPS 1.2 server responses. A response's `status` is `{ ok, code, message?, error? }`, and since 1.2 a 429 may also carry `retryAfter`: the whole seconds, zero or more, its sender should wait before sending again. `retryAfter` is only on a 429, and only in a `1.2.0` response. A 429 without it says nothing about when, and its sender waits as it chooses. Since 1.2, any answer may carry `closing: true`: the server ends the connection after it, and its sender sends nothing more on that connection. `closing` is `true` or absent, and only in a `1.2.0` response.",
    cases: [
      response('retry-after', { ...limited, retryAfter: 90 }, 'accept'),
      response('retry-after-zero', { ...limited, retryAfter: 0 }, 'accept'),
      response('a-429-without-retry-after', limited, 'accept'),
      response('a-429-without-retry-after-under-1-1', limited, 'accept', undefined, V11),
      response(
        'retry-after-in-part-seconds',
        { ...limited, retryAfter: 1.5 },
        'refuse',
        'retryAfter is whole seconds',
      ),
      response(
        'retry-after-below-zero',
        { ...limited, retryAfter: -1 },
        'refuse',
        'retryAfter is zero or more',
      ),
      response(
        'retry-after-as-a-date',
        { ...limited, retryAfter: '2026-10-19T00:01:30.000Z' },
        'refuse',
        'retryAfter is a number of seconds, never a date',
      ),
      response(
        'retry-after-on-a-400',
        {
          code: 400,
          message: 'Artifact does not use the encryption its trust requires',
          error: 'BTP_ERROR_PRIVACY_TYPE',
          retryAfter: 90,
        },
        'refuse',
        'retryAfter is only on a 429',
      ),
      response(
        'retry-after-under-1-1',
        { ...limited, retryAfter: 90 },
        'refuse',
        'retryAfter is only in a 1.2.0 response',
        V11,
      ),
      response('closing', { ...limited, closing: true }, 'accept'),
      response('closing-with-retry-after', { ...limited, retryAfter: 90, closing: true }, 'accept'),
      response(
        'closing-on-a-413',
        {
          code: 413,
          message: 'Artifact is larger than this server takes: 5120 KB',
          error: 'BTP_ERROR_ARTIFACT_TOO_LARGE',
          closing: true,
        },
        'accept',
      ),
      response(
        'closing-false',
        { ...limited, closing: false },
        'refuse',
        'closing is true or absent',
      ),
      response(
        'closing-as-a-string',
        { ...limited, closing: 'true' },
        'refuse',
        'closing is true or absent',
      ),
      response(
        'closing-under-1-1',
        { ...limited, closing: true },
        'refuse',
        'closing is only in a 1.2.0 response',
        V11,
      ),
    ],
  };
}

// The two parties of the trust in the trust permission and details vectors.
const VENDOR = 'billing$vendor.example';
const CLIENT = 'pay$client.example';
const transporter = (type, id, more = {}) => ({
  version: V12,
  issuedAt: ISSUED_AT,
  id,
  type,
  from: VENDOR,
  to: CLIENT,
  selector: 'btps1',
  signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
  encryption: {
    algorithm: 'aes-256-gcm',
    encryptedKey: 'AA==',
    iv: 'AA==',
    authTag: 'AA==',
    type: 'standardEncrypt',
  },
  document: 'ciphertext',
  ...more,
});
const back = (artifact) => ({ ...artifact, from: artifact.to, to: artifact.from });
const ask = (name, required = true) => ({ name, required });
const trustRecord = (status, permissions) => ({ status, ...(permissions && { permissions }) });

/** BTPS 1.2 trust permissions: the names on the envelope, the values in the document, the checks on each. */
export function trustPermissions() {
  // One flat list: the prefix says which kind each permission is.
  const sends = [ask('send:invoice'), ask('send:receipt', false)];
  const asked = [ask('detail:legalName'), ask('detail:email'), ask('detail:address', false)];
  const permissions = [...sends, ...asked];
  const given = [
    'detail:legalName',
    'detail:email',
    'detail:phone',
    'detail:address',
    'detail:registrationNumber',
  ];
  const request = transporter('TRUST_REQ', '1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8', {
    permissions,
    entityType: 'organisation',
    given,
  });
  const granted = ['send:invoice', 'detail:legalName', 'detail:email'];
  const response = back(
    transporter('TRUST_RES', '2c3d4e5f-6071-4b82-9ca3-b4c5d6e7f809', {
      granted,
      entityType: 'person',
    }),
  );
  const invoice = transporter('BTPS_DOC', '3d4e5f60-7182-4c93-8db4-c5d6e7f8091a', {
    documentType: 'invoice',
  });
  const registrationNumber = { number: '51824753556', country: 'AU' };
  const requestDoc = {
    ...base.trustRequest,
    address: '1 Kauri Street, Wellington',
    own: { 'detail:registrationNumber': registrationNumber },
  };
  const withRegistrationNumber = (value) => ({
    ...requestDoc,
    own: { 'detail:registrationNumber': value },
  });
  const responseDoc = {
    ...base.trustResponse,
    details: { 'detail:legalName': 'Robert Smith', 'detail:email': 'bob@client.example' },
  };
  const requested = permissions;
  const pending = trustRecord('pending', {
    requested,
    granted: [],
    detailsHeld: [],
    detailsShared: [],
  });
  const accepted = trustRecord('accepted', {
    requested,
    granted,
    detailsHeld: ['detail:legalName', 'detail:email'],
    detailsShared: given,
  });
  const changing = trustRecord('accepted', {
    ...accepted.permissions,
    pendingChange: {
      requested: [...requested, ask('send:letter')],
      requestedAt: ISSUED_AT,
    },
  });
  const named = (name, artifact, expect, why) => ({
    name,
    artifact,
    expect,
    ...(why && { why }),
  });
  const against = (name, artifact, record, expect, why) => ({
    name,
    artifact,
    record,
    expect,
    ...(why && { why }),
  });
  const opened = (artifact, document) => ({ ...artifact, document });
  const asking = (details, more = {}) => ({
    ...request,
    permissions: [...sends, ...details],
    ...more,
  });
  const sending = (send) => ({ ...request, permissions: [...send, ...asked] });
  const personGiven = ['detail:legalName', 'detail:email', 'detail:phone', 'detail:dob'];
  const fromAPerson = (details, more = {}) =>
    asking(details, { entityType: 'person', given: personGiven, ...more });
  const withDob = (dob) => ({ ...base.trustRequest, own: { 'detail:dob': dob } });
  const fromAnOrganisation = { ...response, entityType: 'organisation' };
  const granting = (artifact, name) => ({ ...artifact, granted: [...granted, name] });
  const detailsWith = (name, value) => ({
    ...responseDoc,
    details: { ...responseDoc.details, [name]: value },
  });
  return {
    description:
      "BTPS 1.2 trust permissions. Every permission name travels on the transporter envelope, signed and readable, so the BTPS server checks it on arrival without decrypting; only the values are encrypted. A name is `send:<invoice|receipt|payslip|letter>` or `detail:<legalName|profile|email|phone|address|taxNo|dob|registrationNumber>`, and nothing else. A `TRUST_REQ` carries `permissions: [{ name, required }]`, one flat list in which the prefix says each name's kind, each name once and at least one `send:` name, `entityType` (person or organisation) and `given`, the `detail:` names the sender offers about itself as permissions, and every detail it asks for it gives (1.1's always-present `name`, `email` and `phone` are listed only when asked for), with one swap: a person gives `detail:dob` and an organisation `detail:registrationNumber`, never the other, so asking for either is met by giving the sender's own, by the sender's envelope `entityType`. An organisation's request is held to this by its envelope; a person's by the receiving server, which takes it without anything given when the receiver is an organisation (a person asking an organisation gives nothing in return), and so its envelope cases here are accepted. A `1.2.0` `TRUST_REQ` always carries `permissions`; one that asks for everything is a `1.1.0` request. `change: true` marks a change to an active trust. A `TRUST_RES` carries `granted`, the names given, and the responder's `entityType`, which decides which of `detail:dob` and `detail:registrationNumber` it may grant; a rejected one carries no `granted`, and may omit `entityType`. A `BTPS_DOC` under a trust with permissions carries `documentType`. All are 1.2.0 only. The values: a request's 1.1 fields hold what 1.1 has a field for (`name` is `detail:legalName`; `email`, `phone`, `address`; `displayName`, `logoUrl` and `websiteUrl` are `detail:profile`) and `own` holds the rest by name; a response's `details` holds each granted detail by name; `taxNo` and `registrationNumber` are `{ number, country }`, `dob` is `YYYY-MM-DD`, and `detail:profile` in a response is `{ displayName, logo?: { sha256, source }, website? }`. A document holding a value is encrypted. `envelopes` are checked by the transporter schema; `opened` by `trustRequestProblem` or `trustResponseProblem`, on the decrypted document; `grant` by `trustGrantProblem(response, requesterRecord)`; `documentType` by `documentTypeProblem(artifact, receiverRecord)`. A record is the part of the trust record the check reads: `status` and `permissions: { requested, granted, detailsHeld, detailsShared, pendingChange? }`; a record without `permissions` is a 1.1 trust.",
    envelopes: [
      named('request', request, 'accept'),
      named(
        'request-sending-only',
        {
          ...transporter('TRUST_REQ', request.id, {
            permissions: [ask('send:invoice')],
            entityType: 'organisation',
            given: [],
          }),
          encryption: null,
          document: base.trustRequest,
        },
        'accept',
      ),
      named(
        'request-from-a-person-asking-a-date-of-birth',
        fromAPerson([ask('detail:dob')]),
        'accept',
      ),
      named(
        'request-from-an-organisation-asking-a-registration-number',
        asking([ask('detail:registrationNumber'), ask('detail:taxNo', false)], {
          given: [...given, 'detail:taxNo'],
        }),
        'accept',
      ),
      named(
        'request-from-a-person-asking-a-registration-number',
        fromAPerson([ask('detail:registrationNumber')]),
        'accept',
      ),
      named(
        'request-from-an-organisation-asking-a-date-of-birth',
        asking([ask('detail:dob')]),
        'accept',
      ),
      named(
        'request-giving-only-what-it-asks',
        { ...request, given: ['detail:legalName', 'detail:email', 'detail:address'] },
        'accept',
      ),
      named('request-for-a-change', { ...request, change: true }, 'accept'),
      named(
        'request-under-1-1',
        { ...request, version: V11 },
        'refuse',
        'permissions are only in a 1.2.0 artifact',
      ),
      named(
        'request-without-entity-type',
        { ...request, entityType: undefined },
        'refuse',
        'entityType comes with permissions',
      ),
      named(
        'request-from-another-entity-type',
        { ...request, entityType: 'company' },
        'refuse',
        'entityType is person or organisation',
      ),
      named(
        'request-with-no-send-name',
        sending([]),
        'refuse',
        'permissions holds at least one send: name',
      ),
      named(
        'request-with-no-permissions',
        { ...request, permissions: [] },
        'refuse',
        'permissions holds at least one send: name',
      ),
      named(
        'request-naming-a-type-twice',
        sending([ask('send:invoice'), ask('send:invoice', false)]),
        'refuse',
        'each name appears once',
      ),
      named(
        'request-naming-a-detail-twice',
        asking([...asked, ask('detail:email', false)]),
        'refuse',
        'each name appears once, required or not',
      ),
      named(
        'request-sending-another-type',
        sending([ask('send:quote')]),
        'refuse',
        'send names one of the five document types',
      ),
      named(
        'request-with-a-provider-name',
        sending([...sends, ask('acme:loyalty')]),
        'refuse',
        'only the protocol names exist: no provider prefixes',
      ),
      named(
        'request-with-permissions-in-groups',
        { ...request, permissions: { send: sends, details: asked } },
        'refuse',
        'permissions is one flat list',
      ),
      named(
        'request-asking-a-1-1-field-name',
        asking([ask('detail:name')], { given: [...given, 'detail:name'] }),
        'refuse',
        'the legal name is detail:legalName',
      ),
      named(
        'request-without-required',
        asking([{ name: 'detail:email' }]),
        'refuse',
        'each permission says whether it is required',
      ),
      named(
        'request-with-more-in-a-permission',
        asking([{ ...ask('detail:email'), why: 'billing' }]),
        'refuse',
        'a permission holds name and required only',
      ),
      named(
        'request-asking-what-it-does-not-give',
        { ...request, given: given.filter((name) => name !== 'detail:address') },
        'refuse',
        'every detail asked for is given',
      ),
      named(
        'request-giving-a-send-name',
        { ...request, given: [...given, 'send:invoice'] },
        'refuse',
        'given holds detail: names only',
      ),
      named(
        'request-giving-a-detail-twice',
        { ...request, given: [...given, 'detail:email'] },
        'refuse',
        'each name appears once',
      ),
      named(
        'request-from-a-person-asking-a-date-of-birth-without-giving-one',
        fromAPerson([ask('detail:dob')], { given: personGiven.slice(0, 3) }),
        'accept',
        "a person's request is held to what it gives by the receiving server, which alone knows whether the receiver is an organisation",
      ),
      named(
        'request-from-a-person-asking-a-registration-number-giving-nothing-for-it',
        fromAPerson([ask('detail:registrationNumber')], { given: personGiven.slice(0, 3) }),
        'accept',
        "a person's request is held to what it gives by the receiving server, which alone knows whether the receiver is an organisation",
      ),
      named(
        'request-1.2.0-asking-for-nothing',
        (({ permissions: _permissions, entityType: _entityType, given: _given, ...rest }) => rest)(
          request,
        ),
        'refuse',
        'a 1.2.0 trust request asks for permissions; one that asks for everything is a 1.1.0 request',
      ),
      named(
        'request-from-an-organisation-asking-a-date-of-birth-giving-nothing-for-it',
        asking([ask('detail:dob')], {
          given: given.filter((name) => name !== 'detail:registrationNumber'),
        }),
        'refuse',
        'an organisation asking for a date of birth gives its registration number',
      ),
      named(
        'request-from-a-person-giving-a-registration-number',
        fromAPerson([ask('detail:dob')], { given: [...personGiven, 'detail:registrationNumber'] }),
        'refuse',
        'a person gives detail:dob, never detail:registrationNumber',
      ),
      named(
        'request-from-an-organisation-giving-a-date-of-birth',
        { ...request, given: [...given, 'detail:dob'] },
        'refuse',
        'an organisation gives detail:registrationNumber, never detail:dob',
      ),
      named(
        'request-asking-an-identity',
        asking([ask('detail:identity')], { given: [...given, 'detail:identity'] }),
        'refuse',
        'a date of birth and a registration number are separate permissions',
      ),
      named(
        'request-for-a-change-marked-false',
        { ...request, change: false },
        'refuse',
        'change is true or absent',
      ),
      named(
        'request-with-own-values-unencrypted',
        { ...request, encryption: null, document: requestDoc },
        'refuse',
        'a request with own values is encrypted',
      ),
      named(
        'request-carrying-granted',
        { ...request, granted },
        'refuse',
        'granted is only on a TRUST_RES',
      ),
      named('response', response, 'accept'),
      named(
        'response-rejecting',
        {
          ...response,
          granted: undefined,
          entityType: undefined,
          encryption: null,
          document: { ...base.trustResponse, decision: 'rejected' },
        },
        'accept',
      ),
      named(
        'response-rejecting-with-entity-type',
        {
          ...response,
          granted: undefined,
          encryption: null,
          document: { ...base.trustResponse, decision: 'rejected' },
        },
        'accept',
      ),
      named(
        'response-without-entity-type',
        { ...response, entityType: undefined },
        'refuse',
        'entityType comes with granted',
      ),
      named(
        'response-from-another-entity-type',
        { ...response, entityType: 'company' },
        'refuse',
        'entityType is person or organisation',
      ),
      named(
        'response-from-a-person-granting-a-date-of-birth',
        granting(response, 'detail:dob'),
        'accept',
      ),
      named(
        'response-from-an-organisation-granting-a-registration-number',
        granting(fromAnOrganisation, 'detail:registrationNumber'),
        'accept',
      ),
      named(
        'response-from-a-person-granting-a-registration-number',
        granting(response, 'detail:registrationNumber'),
        'refuse',
        'a person grants detail:dob, never detail:registrationNumber',
      ),
      named(
        'response-from-an-organisation-granting-a-date-of-birth',
        granting(fromAnOrganisation, 'detail:dob'),
        'refuse',
        'an organisation grants detail:registrationNumber, never detail:dob',
      ),
      named(
        'response-rejecting-with-granted',
        {
          ...response,
          encryption: null,
          document: { ...base.trustResponse, decision: 'rejected' },
        },
        'refuse',
        'a rejected answer carries no granted',
      ),
      named(
        'response-under-1-1',
        { ...response, version: V11 },
        'refuse',
        'granted is only in a 1.2.0 artifact',
      ),
      named(
        'response-granting-another-name',
        { ...response, granted: [...granted, 'detail:nickname'] },
        'refuse',
        'granted holds protocol names only',
      ),
      named(
        'response-granting-a-name-twice',
        { ...response, granted: [...granted, 'send:invoice'] },
        'refuse',
        'each name appears once',
      ),
      named(
        'response-with-details-unencrypted',
        { ...response, encryption: null, document: responseDoc },
        'refuse',
        'a response with details is encrypted',
      ),
      named(
        'response-carrying-given',
        { ...response, given },
        'refuse',
        'given is only on a TRUST_REQ',
      ),
      named('document-type', invoice, 'accept'),
      named(
        'document-type-readable',
        { ...invoice, encryption: null, document: base.invoice },
        'accept',
      ),
      named(
        'document-type-of-another-type',
        { ...invoice, documentType: 'quote' },
        'refuse',
        'documentType is one of the five document types',
      ),
      named(
        'document-type-under-1-1',
        { ...invoice, version: V11 },
        'refuse',
        'documentType is only in a 1.2.0 artifact',
      ),
      named(
        'document-carrying-permissions',
        { ...invoice, permissions },
        'refuse',
        'permissions are only on a TRUST_REQ',
      ),
    ],
    opened: [
      named('request-from-an-organisation', opened(request, requestDoc), 'accept'),
      named(
        'request-from-a-person',
        opened(fromAPerson([ask('detail:dob')]), withDob('1990-04-21')),
        'accept',
      ),
      named(
        'request-giving-only-what-it-asks',
        opened(
          { ...request, given: ['detail:legalName', 'detail:email', 'detail:address'] },
          { ...requestDoc, own: undefined },
        ),
        'accept',
      ),
      named(
        'request-giving-a-profile',
        opened(
          { ...request, given: [...given, 'detail:profile'] },
          {
            ...requestDoc,
            displayName: 'Acme',
            logoUrl: 'https://vendor.example/logo.png',
            websiteUrl: 'https://vendor.example',
          },
        ),
        'accept',
      ),
      named(
        'request-giving-a-tax-number',
        opened(
          { ...request, given: [...given, 'detail:taxNo'] },
          {
            ...requestDoc,
            own: { ...requestDoc.own, 'detail:taxNo': { number: '123456789', country: 'NZ' } },
          },
        ),
        'accept',
      ),
      named(
        'request-without-a-given-value',
        opened(request, { ...requestDoc, own: {} }),
        'refuse',
        'own holds a value for every name given that 1.1 has no field for',
      ),
      named(
        'request-without-a-given-1-1-field',
        opened(request, { ...requestDoc, address: undefined }),
        'refuse',
        'a name given has its value: detail:address is the address field',
      ),
      named(
        'request-giving-a-profile-without-a-display-name',
        opened({ ...request, given: [...given, 'detail:profile'] }, requestDoc),
        'refuse',
        "detail:profile is the request's displayName, which it needs",
      ),
      named(
        'request-with-a-value-not-given',
        opened(request, {
          ...requestDoc,
          own: { ...requestDoc.own, 'detail:taxNo': { number: '123456789', country: 'NZ' } },
        }),
        'refuse',
        'own holds only names given',
      ),
      named(
        'request-repeating-a-1-1-field-in-own',
        opened(request, {
          ...requestDoc,
          own: { ...requestDoc.own, 'detail:email': base.trustRequest.email },
        }),
        'refuse',
        'a value 1.1 has a field for stays there and is not repeated in own',
      ),
      named(
        'request-with-a-date-of-birth-in-another-form',
        opened(fromAPerson([ask('detail:dob')]), withDob('21/04/1990')),
        'refuse',
        'a date of birth is YYYY-MM-DD',
      ),
      named(
        'request-with-a-date-of-birth-as-an-object',
        opened(fromAPerson([ask('detail:dob')]), withDob({ value: '1990-04-21' })),
        'refuse',
        'a date of birth is a YYYY-MM-DD string',
      ),
      named(
        'request-with-a-registration-number-as-text',
        opened(request, withRegistrationNumber(registrationNumber.number)),
        'refuse',
        'a registration number is { number, country }',
      ),
      named(
        'request-with-a-country-in-lower-case',
        opened(request, withRegistrationNumber({ ...registrationNumber, country: 'au' })),
        'refuse',
        'country is ISO 3166-1 alpha-2, in upper case',
      ),
      named(
        'request-with-a-three-letter-country',
        opened(request, withRegistrationNumber({ ...registrationNumber, country: 'AUS' })),
        'refuse',
        'country is ISO 3166-1 alpha-2',
      ),
      named(
        'request-with-more-in-a-registration-number',
        opened(request, withRegistrationNumber({ ...registrationNumber, scheme: 'abn' })),
        'refuse',
        'a registration number holds number and country only',
      ),
      named(
        'request-with-a-tax-number-as-text',
        opened(
          { ...request, given: [...given, 'detail:taxNo'] },
          { ...requestDoc, own: { ...requestDoc.own, 'detail:taxNo': '123456789' } },
        ),
        'refuse',
        'a tax number is { number, country }',
      ),
      named('response', opened(response, responseDoc), 'accept'),
      named(
        'response-granting-a-profile',
        opened(
          { ...response, granted: [...granted, 'detail:profile'] },
          {
            ...responseDoc,
            details: {
              ...responseDoc.details,
              'detail:profile': {
                displayName: 'Bob',
                logo: { sha256: SHA, source: 'https://client.example/bob.png' },
                website: 'https://client.example',
              },
            },
          },
        ),
        'accept',
      ),
      named(
        'response-from-a-person-granting-a-date-of-birth',
        opened(granting(response, 'detail:dob'), detailsWith('detail:dob', '1990-04-21')),
        'accept',
      ),
      named(
        'response-from-an-organisation-granting-a-registration-number',
        opened(
          granting(fromAnOrganisation, 'detail:registrationNumber'),
          detailsWith('detail:registrationNumber', registrationNumber),
        ),
        'accept',
      ),
      named(
        'response-rejecting',
        opened(
          { ...response, granted: undefined, entityType: undefined },
          { ...base.trustResponse, decision: 'rejected' },
        ),
        'accept',
      ),
      named(
        'response-with-a-date-of-birth-in-another-form',
        opened(granting(response, 'detail:dob'), detailsWith('detail:dob', '21/04/1990')),
        'refuse',
        'a date of birth is YYYY-MM-DD',
      ),
      named(
        'response-with-a-registration-number-as-text',
        opened(
          granting(fromAnOrganisation, 'detail:registrationNumber'),
          detailsWith('detail:registrationNumber', registrationNumber.number),
        ),
        'refuse',
        'a registration number is { number, country }',
      ),
      named(
        'response-without-a-granted-value',
        opened(response, {
          ...responseDoc,
          details: { 'detail:legalName': responseDoc.details['detail:legalName'] },
        }),
        'refuse',
        'details holds a value for every detail granted',
      ),
      named(
        'response-with-a-value-not-granted',
        opened(response, {
          ...responseDoc,
          details: { ...responseDoc.details, 'detail:phone': '+64 21 000 000' },
        }),
        'refuse',
        'details holds only details granted',
      ),
      named(
        'response-with-a-send-name-in-its-details',
        opened(response, {
          ...responseDoc,
          details: { ...responseDoc.details, 'send:invoice': true },
        }),
        'refuse',
        'details holds detail values only',
      ),
      named(
        'response-with-a-logo-without-its-fingerprint',
        opened(
          { ...response, granted: [...granted, 'detail:profile'] },
          {
            ...responseDoc,
            details: {
              ...responseDoc.details,
              'detail:profile': {
                displayName: 'Bob',
                logo: { source: 'https://client.example/bob.png' },
              },
            },
          },
        ),
        'refuse',
        'a logo is { sha256, source }',
      ),
      named(
        'response-with-a-profile-without-a-display-name',
        opened(
          { ...response, granted: [...granted, 'detail:profile'] },
          {
            ...responseDoc,
            details: {
              ...responseDoc.details,
              'detail:profile': { website: 'https://client.example' },
            },
          },
        ),
        'refuse',
        'detail:profile has a displayName',
      ),
    ],
    grant: [
      against('only-the-required-names', response, pending, 'accept'),
      against(
        'every-name',
        { ...response, granted: [...granted, 'send:receipt', 'detail:address'] },
        pending,
        'accept',
      ),
      against(
        'a-registration-number-asked-of-an-organisation',
        granting(fromAnOrganisation, 'detail:registrationNumber'),
        trustRecord('pending', {
          ...pending.permissions,
          requested: [...requested, ask('detail:registrationNumber')],
        }),
        'accept',
      ),
      against(
        'a-date-of-birth-asked-of-an-organisation',
        fromAnOrganisation,
        trustRecord('pending', {
          ...pending.permissions,
          requested: [...requested, ask('detail:dob')],
        }),
        'refuse',
        'a required name the answerer cannot grant is not met: the request is rejected and sent again',
      ),
      against(
        'rejecting',
        { ...response, granted: undefined, entityType: undefined },
        pending,
        'accept',
      ),
      against(
        'a-1-1-answer-to-a-1-1-trust',
        { ...response, version: V11, granted: undefined },
        trustRecord('pending'),
        'accept',
      ),
      against(
        'a-change',
        { ...response, granted: [...granted, 'send:letter'] },
        changing,
        'accept',
      ),
      against(
        'without-a-required-name',
        { ...response, granted: ['send:invoice', 'detail:legalName'] },
        pending,
        'refuse',
        'granted holds every required name asked for (BTP_ERROR_PERMISSION_REQUIRED)',
      ),
      against(
        'a-name-not-asked-for',
        { ...response, granted: [...granted, 'send:payslip'] },
        pending,
        'refuse',
        'granted holds only names the request asked for',
      ),
      against(
        'to-a-record-without-permissions',
        response,
        trustRecord('pending'),
        'refuse',
        'required permissions cannot be checked without the requested names',
      ),
      against(
        'to-an-accepted-trust-with-no-change-pending',
        response,
        accepted,
        'refuse',
        'an accepted trust takes an answer only while a change is pending',
      ),
      against(
        'a-change-without-its-new-required-name',
        response,
        changing,
        'refuse',
        'an answer to a change is checked against the change',
      ),
    ],
    documentType: [
      against('granted', invoice, accepted, 'accept'),
      against(
        'granted-and-readable',
        { ...invoice, encryption: null, document: base.invoice },
        accepted,
        'accept',
      ),
      against(
        'an-event-under-permissions',
        transporter('BTPS_EVENT', '4e5f6071-8293-4da4-9ec5-d6e7f8091a2b', {
          relatesTo: invoice.id,
        }),
        accepted,
        'accept',
      ),
      against(
        'a-1-1-trust',
        { ...invoice, version: V11, documentType: undefined },
        trustRecord('accepted'),
        'accept',
      ),
      against(
        'without-a-document-type',
        { ...invoice, documentType: undefined },
        accepted,
        'refuse',
        'a send under a trust with permissions names its documentType (BTP_ERROR_PERMISSION)',
      ),
      against(
        'not-granted',
        { ...invoice, documentType: 'receipt' },
        accepted,
        'refuse',
        'send:<documentType> is granted (BTP_ERROR_PERMISSION)',
      ),
      against(
        'readable-of-another-type',
        { ...invoice, encryption: null, document: base.receipt },
        accepted,
        'refuse',
        'a readable document is its documentType (BTP_ERROR_DOCUMENT_TYPE_MISMATCH)',
      ),
    ],
  };
}

/** BTPS 1.2 details refresh: DETAILS_CHANGED, DETAILS_REQ and DETAILS_RES, and the names each may carry. */
export function details() {
  // The vendor asked; the client granted its legal name and email. Each record is its owner's.
  const shared = ['detail:legalName', 'detail:email', 'detail:phone', 'detail:address'];
  const granted = ['send:invoice', 'detail:legalName', 'detail:email'];
  const permissions = (detailsHeld, detailsShared) => ({
    requested: [ask('send:invoice'), ask('detail:legalName'), ask('detail:email')],
    granted,
    detailsHeld,
    detailsShared,
  });
  const vendorRecord = trustRecord(
    'accepted',
    permissions(['detail:legalName', 'detail:email'], shared),
  );
  const clientRecord = trustRecord(
    'accepted',
    permissions(shared, ['detail:legalName', 'detail:email']),
  );
  const changed = transporter('DETAILS_CHANGED', '5f607182-93a4-4eb5-8fd6-e7f8091a2b3c', {
    details: ['detail:address'],
  });
  const request = back(
    transporter('DETAILS_REQ', '60718293-a4b5-4fc6-90e7-f8091a2b3c4d', {
      details: ['detail:address', 'detail:phone'],
      relatesTo: changed.id,
    }),
  );
  const response = transporter('DETAILS_RES', '718293a4-b5c6-4d07-a1f8-091a2b3c4d5e', {
    details: ['detail:address', 'detail:phone'],
    relatesTo: request.id,
  });
  const values = { 'detail:address': '2 Rata Road, Auckland', 'detail:phone': '+64 9 000 0000' };
  const named = (name, artifact, expect, why) => ({
    name,
    artifact,
    expect,
    ...(why && { why }),
  });
  const held = (name, artifact, record, sentRequest, expect, why) => ({
    name,
    artifact,
    record,
    sentRequest,
    expect,
    ...(why && { why }),
  });
  return {
    description:
      "BTPS 1.2 details refresh, on an active trust in either direction. Each side fetches only the details it already holds by that trust. `DETAILS_CHANGED` tells the other side which of its details changed, `DETAILS_REQ` asks for some, optionally naming the notice in `relatesTo`, and `DETAILS_RES` answers a request named in `relatesTo`, its values keyed by name and always encrypted to the requester. A notice's or request's document holds no values, only an optional `message`, a 1.2 note. Each carries `details`, the `detail:` names, on its envelope, signed and readable; all three are 1.2.0 only. A response may answer part of a request. `envelopes` are checked by the transporter schema. `held` cases are checked by `detailsProblem(artifact, record, sentRequest)`: `record` is the receiver's trust record (`status` and `permissions: { requested, granted, detailsHeld, detailsShared }`) and `sentRequest` the `DETAILS_REQ` a response names, as the receiver sent it, or null when it sent none. A notice names only details the receiver holds (`detailsHeld`), a request only details the answerer shares (`detailsShared`, else BTP_ERROR_DETAILS_NOT_HELD), and a response only names its request asked for and the receiver holds; where a response's document is readable (as when opened), it holds a value for every name, and no others. Here the vendor asked for the trust and the client granted its legal name and email.",
    envelopes: [
      named('changed', changed, 'accept'),
      named('request', request, 'accept'),
      named('request-on-its-own', { ...request, relatesTo: undefined }, 'accept'),
      named(
        'changed-with-a-message',
        { ...changed, encryption: null, document: { message: note('We have moved.', 'text') } },
        'accept',
      ),
      named(
        'request-with-a-message',
        { ...request, encryption: null, document: { message: 'Your new address, please.' } },
        'accept',
      ),
      named('response', response, 'accept'),
      named(
        'changed-carrying-a-value',
        {
          ...changed,
          encryption: null,
          document: { 'detail:address': '2 Rata Road, Auckland' },
        },
        'refuse',
        'a notice carries no values',
      ),
      named(
        'request-with-a-message-of-another-format',
        {
          ...request,
          encryption: null,
          document: { message: note('<p>Your new address</p>', 'html') },
        },
        'refuse',
        'message is a 1.2 note: plain text, or text or markdown',
      ),
      named(
        'changed-under-1-1',
        { ...changed, version: V11 },
        'refuse',
        'details refresh is only in a 1.2.0 artifact',
      ),
      named(
        'changed-naming-nothing',
        { ...changed, details: [] },
        'refuse',
        'details names at least one detail',
      ),
      named(
        'changed-naming-a-send-name',
        { ...changed, details: ['send:invoice'] },
        'refuse',
        'details holds detail: names only',
      ),
      named(
        'changed-naming-another-detail',
        { ...changed, details: ['detail:name'] },
        'refuse',
        'only the protocol names exist',
      ),
      named(
        'changed-naming-a-detail-twice',
        { ...changed, details: ['detail:address', 'detail:address'] },
        'refuse',
        'each name appears once',
      ),
      named(
        'changed-naming-an-artifact',
        { ...changed, relatesTo: request.id },
        'refuse',
        'a notice relates to nothing before it',
      ),
      named(
        'request-without-details',
        { ...request, details: undefined },
        'refuse',
        'a request names the details it wants',
      ),
      named(
        'response-naming-no-request',
        { ...response, relatesTo: undefined },
        'refuse',
        'a response names the request it answers',
      ),
      named(
        'response-unencrypted',
        { ...response, encryption: null, document: values },
        'refuse',
        'a response is always encrypted to the requester',
      ),
      named(
        'document-carrying-details',
        transporter('BTPS_DOC', '8293a4b5-c6d7-4e18-b209-1a2b3c4d5e6f', {
          details: ['detail:address'],
        }),
        'refuse',
        'details is only on the three details types',
      ),
    ],
    held: [
      held('changed-held', changed, clientRecord, null, 'accept'),
      held(
        'changed-not-held',
        { ...changed, details: ['detail:taxNo'] },
        clientRecord,
        null,
        'refuse',
        'a notice names only details the receiver holds',
      ),
      held(
        'changed-on-a-1-1-trust',
        changed,
        trustRecord('accepted'),
        null,
        'refuse',
        'a 1.1 trust holds no details by name',
      ),
      held('request-shared', request, vendorRecord, null, 'accept'),
      held(
        'request-not-shared',
        { ...request, details: ['detail:registrationNumber'] },
        vendorRecord,
        null,
        'refuse',
        'a request names only details the answerer shares (BTP_ERROR_DETAILS_NOT_HELD)',
      ),
      held(
        'request-for-its-own-details',
        { ...request, details: ['detail:email'] },
        trustRecord(
          'accepted',
          permissions(['detail:legalName', 'detail:email'], ['detail:address']),
        ),
        null,
        'refuse',
        'the answerer shares only its own details, never what it holds of the asker',
      ),
      held('response', response, clientRecord, request, 'accept'),
      held(
        'response-in-part',
        { ...response, details: ['detail:address'] },
        clientRecord,
        request,
        'accept',
      ),
      held('response-opened', { ...response, document: values }, clientRecord, request, 'accept'),
      held(
        'response-naming-a-detail-not-asked-for',
        { ...response, details: ['detail:address', 'detail:email'] },
        clientRecord,
        request,
        'refuse',
        'a response names only what its request asked for',
      ),
      held(
        'response-naming-a-detail-not-held',
        response,
        trustRecord('accepted', permissions(['detail:address'], [])),
        request,
        'refuse',
        'a response names only details the receiver holds',
      ),
      held(
        'response-to-no-request',
        response,
        clientRecord,
        null,
        'refuse',
        'a response answers a request the receiver sent',
      ),
      held(
        'response-to-a-request-it-did-not-make',
        response,
        clientRecord,
        { ...request, from: 'someone$client.example' },
        'refuse',
        'a response answers a request the receiver sent to its sender',
      ),
      held(
        'response-to-another-request',
        response,
        clientRecord,
        { ...request, id: '93a4b5c6-d7e8-4f29-830a-2b3c4d5e6f70' },
        'refuse',
        'a response answers the request it names',
      ),
      held(
        'response-opened-without-a-value',
        { ...response, document: { 'detail:address': values['detail:address'] } },
        clientRecord,
        request,
        'refuse',
        'a response holds a value for every name',
      ),
      held(
        'response-opened-with-a-value-not-named',
        { ...response, details: ['detail:address'], document: values },
        clientRecord,
        request,
        'refuse',
        'a response holds a value only for each name',
      ),
    ],
  };
}

/** The 1.2 template file, format 1: what a template may say, and each thing it must never do. */
export function templates() {
  const signed = ['header', 'parties', 'details', 'lines', 'totals', 'payment', 'notes'];
  const full = {
    format: 1,
    kinds: ['invoice', 'receipt'],
    page: {
      font: 'source-serif-4',
      size: 'normal',
      density: 'comfortable',
      background: '#ffffff',
      text: '#1f2933',
      muted: '#52606d',
      accent: '#0b6e4f',
    },
    logo: { position: 'top-left', size: 'medium' },
    sections: [
      'header',
      'totals',
      'details',
      'parties',
      'lines',
      'payment',
      'notes',
      'terms',
      'footer',
    ],
    labels: { title: 'Tax invoice', to: 'Bill to', amountDue: 'Amount due' },
    lines: { style: 'striped', header: 'accent' },
    totals: { style: 'accent' },
    text: {
      terms: 'Payment within 14 days.\nThank you for your business.',
      footer: 'Kauri Studio',
    },
  };
  const minimal = { ...full, kinds: ['invoice'], sections: signed, labels: {}, text: undefined };
  const accept = (name, template) => ({ name, template, expect: 'accept' });
  const refuse = (name, template, why, check = 'schema') => ({
    name,
    template,
    expect: 'refuse',
    check,
    why,
  });
  const page = (more) => ({ ...full, page: { ...full.page, ...more } });
  const labels = (more) => ({ ...full, labels: { ...full.labels, ...more } });
  const text = (more) => ({ ...full, text: { ...full.text, ...more } });
  // Format 2: a payslip like an invoice, and a letter that sets only its page, letterhead and footer.
  const payslipSigned = [
    'header',
    'parties',
    'period',
    'earnings',
    'deductions',
    'contributions',
    'leave',
    'totals',
  ];
  const payslip = {
    format: 2,
    kinds: ['payslip'],
    page: full.page,
    logo: full.logo,
    sections: [...payslipSigned, 'footer'],
    labels: { title: 'Payslip', net: 'Net pay', employer: 'Employer' },
    lines: full.lines,
    totals: full.totals,
    text: { footer: 'Kauri Studio' },
  };
  const letter = {
    format: 2,
    kinds: ['letter'],
    page: full.page,
    logo: full.logo,
    letterhead: { fields: ['name', 'address', 'email', 'phone', 'identifiers'], align: 'start' },
    footer: {
      signOff: 'Yours sincerely,',
      signature: {
        slots: ['signature.drawn', 'signature.typed', 'signature.name', 'signature.title'],
        align: 'start',
      },
    },
  };
  const { footer: _footer, ...letterWithoutFooter } = letter;
  const signatureSlots = (slots) => ({
    ...letter,
    footer: { ...letter.footer, signature: { ...letter.footer.signature, slots } },
  });
  const format2 = [
    accept('format-2-invoice', { ...full, format: 2 }),
    accept('format-2-payslip', payslip),
    accept('format-2-letter', letter),
    accept('format-2-letter-without-a-footer', letterWithoutFooter),
    // Since 1.2 an agreement is a letter that asks for acceptance: a letter template draws it too.
    accept('format-2-letter-for-agreements', { ...letter, kinds: ['letter', 'agreement'] }),
    accept('format-2-agreement', { ...letter, kinds: ['agreement'] }),
    refuse(
      'a-letter-template-naming-agreement-twice',
      { ...letter, kinds: ['agreement', 'agreement'] },
      'each kind appears once',
    ),
    refuse(
      'a-letter-template-for-invoices-too',
      { ...letter, kinds: ['letter', 'invoice'] },
      'a letter template is for letters and agreements only',
    ),
    refuse(
      'a-payslip-with-a-signed-section-left-out',
      { ...payslip, sections: payslipSigned.filter((s) => s !== 'deductions') },
      'every section with signed fields is shown',
    ),
    refuse(
      'a-payslip-with-an-invoice-section',
      { ...payslip, sections: [...payslipSigned, 'lines'] },
      "a payslip's sections are its own groups",
    ),
    refuse(
      'a-payslip-with-an-invoice-label',
      { ...payslip, labels: { amountDue: 'Amount due' } },
      "a payslip's labels are its own keys",
    ),
    refuse('a-payslip-in-format-1', { ...payslip, format: 1 }, 'format 1 has no payslip'),
    refuse(
      'a-payslip-and-an-invoice-in-one',
      { ...payslip, kinds: ['payslip', 'invoice'] },
      'a payslip template is for payslips only',
    ),
    refuse(
      'a-letter-that-styles-the-body',
      { ...letter, body: { font: 'geist-mono', size: 'large' } },
      "a letter template never touches the body: it is the sender's own",
    ),
    refuse(
      'a-letter-that-reorders-the-body',
      { ...letter, sections: ['header', 'body', 'footer'] },
      'a letter template has no sections',
    ),
    refuse(
      'a-letter-hiding-an-issuer-field',
      {
        ...letter,
        letterhead: { ...letter.letterhead, fields: ['name', 'address', 'email', 'phone'] },
      },
      "the letterhead places every one of the sender's own fields",
    ),
    refuse(
      'a-letter-with-an-issuer-field-twice',
      {
        ...letter,
        letterhead: {
          ...letter.letterhead,
          fields: ['name', 'name', 'address', 'email', 'phone'],
        },
      },
      'each field once',
    ),
    refuse(
      'a-letter-with-a-value-in-its-letterhead',
      { ...letter, letterhead: { ...letter.letterhead, name: 'Kauri Studio' } },
      "the letterhead places the document's fields, never values of its own",
    ),
    accept('a-letter-sign-off-with-a-phone-number', {
      ...letter,
      footer: { ...letter.footer, signOff: 'Call 02 9999 0000' },
    }),
    refuse('a-letter-unknown-slot', signatureSlots(['signature.stamp']), 'slots are a fixed list'),
    refuse(
      'a-letter-with-a-signature-value-of-its-own',
      {
        ...letter,
        footer: {
          ...letter.footer,
          signature: { ...letter.footer.signature, name: 'Jo Bloggs' },
        },
      },
      'signature values come from the document, never the template',
    ),
    refuse(
      'a-letter-with-a-drawn-signature-as-svg',
      {
        ...letter,
        footer: { ...letter.footer, signature: { ...letter.footer.signature, svg: '<svg/>' } },
      },
      'a template holds no markup, and no signature',
    ),
    refuse(
      'a-letter-in-the-signature-font',
      { ...letter, page: { ...letter.page, font: 'caveat' } },
      'the script font is for the typed signature only',
    ),
    refuse('a-letter-in-format-1', { ...letter, format: 1 }, 'format 1 has no letter'),
  ];
  return {
    description:
      'The BTPS 1.2 template file, formats 1 and 2 (Templates page; JSON Schema at docs/docusaurus/static/schemas/btps-template.schema.json, published with the docs site as schemas/btps-template.schema.json). A template says how a document looks, never what it says: it never carries or changes a value of the document, hides no section with signed fields, names nothing to fetch and runs nothing; its own words are labels from a fixed set and static terms and footer text, each plain text with no markup and no control, hidden or direction-changing character; what they say is the platform\'s policy. Format 1 is for invoices and receipts. Format 2 is format 1 for them, plus payslips (sections and labels of their own) and letters (the page, a letterhead placing every one of the sender\'s own fields, and a footer with a sign-off and signature slots, whose values come from the document; never the body). An implementation accepts every "accept" template and refuses every "refuse" one; `check` is the rule that refuses it: "schema" for the JSON Schema, "contrast" for the WCAG AA contrast of `page.text` and `page.muted` (4.5:1) and `page.accent` (3:1) against `page.background`. `fingerprint` is a template\'s RFC 8785 canonical form and the lowercase hex SHA-256 of it, which `template.data.sha256` names.',
    fingerprint: {
      template: full,
      canonical: canonicalizeValue(full),
      sha256: crypto.createHash('sha256').update(canonicalizeValue(full), 'utf8').digest('hex'),
    },
    cases: [
      accept('full', full),
      accept('minimal', minimal),
      accept(
        'short-numbers-in-words',
        text({ terms: 'Payment within 14 days.\nLate fees: 2% a month.' }),
      ),
      accept('label-at-40-characters', labels({ title: 'x'.repeat(40) })),
      refuse('a-later-format', { ...full, format: 3 }, 'formats 1 and 2 are the ones there are'),
      refuse('an-unknown-key', { ...full, script: 'alert(1)' }, 'unknown keys are refused'),
      refuse(
        'an-amount',
        { ...full, total: { amount: 100, currency: 'AUD' } },
        'a template never carries or changes an amount',
      ),
      refuse(
        'a-party',
        { ...full, to: 'pay$client.example' },
        'a template never carries or changes who a document is from or to',
      ),
      refuse(
        'a-payment-value',
        { ...full, payment: { bsb: '062-000', account: '12345678' } },
        'a template never carries or changes how to pay',
      ),
      refuse(
        'a-label-that-is-a-value',
        labels({ amount: '999' }),
        'labels are from a fixed set of keys, none of them a value',
      ),
      refuse(
        'a-section-with-signed-fields-left-out',
        { ...full, sections: ['header', 'parties', 'details', 'lines', 'totals', 'notes'] },
        'every section with signed fields is shown',
      ),
      refuse('a-hidden-list', { ...full, hidden: ['totals'] }, 'a template never hides a section'),
      refuse(
        'a-section-twice',
        { ...full, sections: [...signed, 'notes'] },
        'each section at most once',
      ),
      refuse(
        'an-unknown-section',
        { ...full, sections: [...signed, 'popup'] },
        'sections are from a fixed list',
      ),
      refuse(
        'terms-shown-with-none-given',
        { ...full, text: { footer: 'Kauri Studio' } },
        'a template that shows terms gives them',
      ),
      refuse(
        'a-footer-shown-with-none-given',
        { ...full, text: { terms: 'Thank you.' } },
        'a template that shows a footer gives it',
      ),
      refuse(
        'a-font-outside-the-list',
        page({ font: 'Comic Sans' }),
        'fonts are from a fixed list',
      ),
      refuse(
        'a-font-to-fetch',
        page({ font: 'https://fonts.example/a.woff2' }),
        'a template never fetches anything',
      ),
      refuse(
        'a-colour-that-is-a-url',
        page({ background: 'url(https://x.example/a.png)' }),
        'colours are #rrggbb',
      ),
      refuse('a-colour-in-upper-case', page({ text: '#1F2933' }), 'colours are lower-case #rrggbb'),
      refuse(
        'a-logo-to-fetch',
        { ...full, logo: { ...full.logo, url: 'https://dev.example/logo.png' } },
        "the logo is the sender's own, from the document: the template says only where and how big",
      ),
      refuse(
        'a-logo-size-in-pixels',
        { ...full, logo: { position: 'top-left', size: 64 } },
        'sizes are tokens',
      ),
      refuse(
        'a-kind-without-a-format-yet',
        { ...full, kinds: ['letter'] },
        'format 1 is for invoices and receipts',
      ),
      refuse(
        'a-label-too-long',
        labels({ title: 'x'.repeat(41) }),
        'a label is 1 to 40 characters',
      ),
      refuse('an-empty-label', labels({ title: '' }), 'a label is 1 to 40 characters'),
      refuse(
        'a-label-that-is-markup',
        labels({ title: '<b>Invoice</b>' }),
        'plain words, no markup',
      ),
      // What a template's words say is the platform's policy: digits and addresses are plain text.
      accept('a-label-with-a-digit-run', labels({ title: 'Invoice 10042' })),
      accept('a-label-with-an-email-address', labels({ payment: 'Pay pay@x.example' })),
      refuse(
        'a-label-with-a-hidden-character',
        labels({ to: 'Bill\u200bto' }),
        'no hidden character',
      ),
      accept('terms-with-bank-details', text({ terms: 'Pay to BSB 062-000 account 1234 5678' })),
      accept('terms-with-a-btps-address', text({ terms: 'Send to pay$kauri.example' })),
      accept('terms-with-a-url', text({ terms: 'Pay at https://pay.example/x' })),
      accept('a-footer-with-a-phone-number', text({ footer: 'Call 02 9999 0000' })),
      accept('a-footer-with-a-web-address', text({ footer: 'Pay at www.pay.example' })),
      refuse(
        'a-footer-that-reads-backwards',
        text({ footer: 'Kauri \u202eoiduts' }),
        'no direction-changing character',
      ),
      refuse(
        'a-footer-with-a-control-character',
        text({ footer: 'Kauri\u0007Studio' }),
        'no control character',
      ),
      refuse(
        'a-footer-too-long',
        text({ footer: 'x'.repeat(301) }),
        'a footer is at most 300 characters',
      ),
      refuse(
        'text-that-cannot-be-read',
        page({ text: '#eeeeee' }),
        'text contrasts 4.5:1 with the background',
        'contrast',
      ),
      refuse(
        'muted-text-that-cannot-be-read',
        page({ muted: '#dddddd' }),
        'muted text contrasts 4.5:1 with the background',
        'contrast',
      ),
      refuse(
        'an-accent-that-cannot-be-seen',
        page({ accent: '#f5f5f5' }),
        'the accent contrasts 3:1 with the background',
        'contrast',
      ),
      ...format2,
    ],
  };
}

const sha256Hex = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
/** The SHA-256 of a value's RFC 8785 form, in lowercase hex. */
const hashOf = (value) => sha256Hex(Buffer.from(canonicalizeValue(value), 'utf8'));
const signatureBy = (key, value) => ({
  algorithmHash: 'sha256',
  value: signWith(key.privateKeyPem, value),
  fingerprint: fingerprintOf(key.publicKeyPem),
});

/**
 * BTPS 1.2 agreements: the agreement document, the signers' answers and their
 * order, and the evidence bundle. `keys` are the originator's, two signers',
 * a device's and the device's operator's, each `{ publicKeyPem, privateKeyPem }`.
 */
export function agreements(keys) {
  const BANK = 'loans$bank.example';
  const ALICE = 'alice$client.example';
  const SAM = 'sam$guarantor.example';
  const OPERATOR = 'admin$client.example';
  const termsPdf = Buffer.from('%PDF-1.7 Home loan terms: 6.1% p.a. over 30 years', 'utf8');
  const terms = {
    content: termsPdf.toString('base64'),
    type: 'application/pdf',
    filename: 'terms.pdf',
    size: termsPdf.length,
    sha256: sha256Hex(termsPdf),
  };
  const BY = '2026-11-30T00:00:00.000Z';
  const at = (day) => `2026-11-${String(day).padStart(2, '0')}T00:00:00.000Z`;

  // An agreement as its originator signs it: the content, then its statement over it.
  const contentOf = (acceptance, more = {}) => ({
    type: 'agreement',
    title: 'Home loan agreement',
    id: 'AGR-1',
    issuedAt: ISSUED_AT,
    body: note('# Home loan\n\nThe terms are attached. Each of you accepts them in turn.'),
    attachments: [terms],
    acceptance: {
      by: BY,
      terms: [terms.sha256],
      signers: [{ address: ALICE }, { address: SAM }, { address: BANK }],
      signingOrder: 'sequential',
      ...acceptance,
    },
    ...more,
  });
  const refOf = (content) => ({ originator: BANK, id: content.id, contentSha256: hashOf(content) });
  const signed = (content) => ({
    ...content,
    originatorSignature: {
      selector: 'btps1',
      signature: signatureBy(keys.originator, refOf(content)),
    },
  });
  const content = contentOf({});
  const agreement = signed(content);
  const ref = refOf(content);
  const anyContent = contentOf({
    signers: [{ address: ALICE }, { address: SAM }],
    signingOrder: 'any',
  });
  const anyOrder = signed(anyContent);
  const anyRef = refOf(anyContent);

  // A signer's statement, and its record signed by an identity key or a device key.
  const stated = (signer, decision, signedAt, previous, about = ref) => ({
    agreement: about,
    terms: [terms.sha256],
    signer,
    decision,
    signedAt,
    ...(previous && { previous }),
  });
  const byIdentity = (key, statement) => ({
    statement,
    selector: 'btps1',
    signature: signatureBy(key, statement),
  });
  // A device's record carries the whole event artifact that delivered it, as it
  // arrived: signed by the device, delegated by the signer's operator.
  const byDevice = (
    statement,
    deviceKey = keys.device,
    delegator = { identity: OPERATOR, key: keys.operator },
  ) => {
    const artifact = {
      version: V12,
      issuedAt: statement.signedAt,
      id: '7a1c2e3f-4b5d-4c6e-8f70-81a2b3c4d5e6',
      type: 'BTPS_EVENT',
      from: statement.signer,
      to: BANK,
      relatesTo: 'agreement-copy-to-alice',
      selector: 'btps1',
      encryption: {
        algorithm: 'aes-256-gcm',
        encryptedKey: 'AA==',
        iv: 'AA==',
        authTag: 'AA==',
        type: 'standardEncrypt',
      },
      document: 'ciphertext',
    };
    const withSignature = { ...artifact, signature: signatureBy(keys.device, artifact) };
    const delegation = {
      agentId: 'device-alice-1',
      agentPubKey: deviceKey.publicKeyPem,
      signedBy: delegator.identity,
      issuedAt: statement.signedAt,
      selector: 'btps1',
    };
    return {
      statement,
      signature: signatureBy(keys.device, statement),
      delegatedArtifact: {
        ...withSignature,
        delegation: {
          ...delegation,
          signature: signatureBy(delegator.key, { ...withSignature, delegation }),
        },
      },
    };
  };

  const alice = byIdentity(keys.signer, stated(ALICE, 'accepted', at(2)));
  const sam = byIdentity(keys.guarantor, stated(SAM, 'accepted', at(3), hashOf(alice)));
  const bank = byIdentity(keys.originator, stated(BANK, 'accepted', at(4), hashOf(sam)));
  const aliceByDevice = byDevice(stated(ALICE, 'accepted', at(2)));
  const samAfterDevice = byIdentity(
    keys.guarantor,
    stated(SAM, 'accepted', at(3), hashOf(aliceByDevice)),
  );
  const bankAfterDevice = byIdentity(
    keys.originator,
    stated(BANK, 'accepted', at(4), hashOf(samAfterDevice)),
  );
  const aliceDeclines = byIdentity(keys.signer, stated(ALICE, 'declined', at(2)));
  // Since 1.2: a signer's own signature on its acceptance, inside what it signs.
  const signedWith = (decision, visualSignature) =>
    byIdentity(keys.signer, { ...stated(ALICE, decision, at(2)), visualSignature });
  const typed = { type: 'typed', text: 'Alice Ng' };
  const drawn = { type: 'drawn', strokes: [[40, 200, 120, 80, 260, 210, 400, 90]] };

  // Answer events, as an opened BTPS_EVENT carries them.
  const answer = (eventType, record, more = {}) => ({
    type: 'agreement_event',
    id: '5d6e7f80-9102-4a3b-8c4d-5e6f708192a3',
    occurredAt: record.statement.signedAt,
    eventType,
    agreement: record.statement.agreement,
    statement: record,
    ...more,
  });
  const forwarded = (eventType, statements) => ({
    type: 'agreement_event',
    id: '6e7f8091-0213-4b4c-9d5e-6f708192a3b4',
    occurredAt: at(4),
    eventType,
    agreement: ref,
    statements,
  });

  // Documents, read under the version they travel in.
  const docCase = (fn, name, document, why) =>
    fn === accept
      ? accept(name, 'BTPS_DOC', document, under(V12))
      : refuse(name, 'BTPS_DOC', document, why, under(V12));
  const signers = (count) =>
    Array.from({ length: count }, (_, i) => ({ address: `signer${i + 1}$party.example` }));
  const withAcceptance = (acceptance) => ({ ...agreement, acceptance });
  const documents = [
    docCase(accept, 'agreement', agreement),
    docCase(accept, 'agreement-in-any-order', anyOrder),
    docCase(
      accept,
      'agreement-without-a-deadline',
      withAcceptance({ ...content.acceptance, by: undefined }),
    ),
    docCase(
      accept,
      'agreement-with-no-terms-attached',
      withAcceptance({ ...content.acceptance, terms: [] }),
    ),
    docCase(
      accept,
      'agreement-with-twenty-signers',
      withAcceptance({ ...content.acceptance, signers: signers(20) }),
    ),
    docCase(accept, 'agreement-with-a-letter-template', {
      ...agreement,
      template: { name: 'bank/letterhead', data: { values: { 'signature.name': 'Loans team' } } },
    }),
    docCase(
      refuse,
      'agreement-with-twenty-one-signers',
      withAcceptance({ ...content.acceptance, signers: signers(21) }),
      'at most 20 signers',
    ),
    docCase(
      refuse,
      'agreement-with-no-signers',
      withAcceptance({ ...content.acceptance, signers: [] }),
      'an agreement has at least one signer',
    ),
    docCase(
      refuse,
      'agreement-naming-a-signer-twice',
      withAcceptance({
        ...content.acceptance,
        signers: [{ address: ALICE }, { address: 'Alice$Client.example' }],
      }),
      'each signer appears once, letters compared without case',
    ),
    docCase(
      refuse,
      'agreement-signer-not-an-address',
      withAcceptance({ ...content.acceptance, signers: [{ address: 'alice@client.example' }] }),
      'a signer is a BTPS address',
    ),
    docCase(
      refuse,
      'agreement-in-another-order',
      withAcceptance({ ...content.acceptance, signingOrder: 'parallel' }),
      'signingOrder is any or sequential',
    ),
    docCase(
      refuse,
      'agreement-without-a-signing-order',
      withAcceptance({ ...content.acceptance, signingOrder: undefined }),
      'signingOrder is required',
    ),
    docCase(
      refuse,
      'agreement-term-not-attached',
      withAcceptance({ ...content.acceptance, terms: [SHA] }),
      'each term is the sha256 of an attachment',
    ),
    docCase(
      refuse,
      'agreement-term-named-twice',
      withAcceptance({ ...content.acceptance, terms: [terms.sha256, terms.sha256] }),
      'each term appears once',
    ),
    docCase(
      refuse,
      'agreement-deadline-not-a-date',
      withAcceptance({ ...content.acceptance, by: 'end of November' }),
      'by is a date and time',
    ),
    docCase(
      refuse,
      'agreement-without-acceptance',
      { ...agreement, acceptance: undefined },
      'an agreement always carries acceptance',
    ),
    docCase(
      refuse,
      'agreement-without-the-originator-signature',
      { ...agreement, originatorSignature: undefined },
      'an agreement always carries its originator signature',
    ),
    docCase(
      refuse,
      'agreement-with-a-kind',
      { ...agreement, kind: 'agreement' },
      'there is no kind: the type says what it is',
    ),
    docCase(
      refuse,
      'letter-with-acceptance',
      { ...base.letter, acceptance: content.acceptance },
      'a letter never carries acceptance',
    ),
    refuse('agreement-under-1-1', 'BTPS_DOC', agreement, '1.1 has no agreement', under(V11)),
  ];

  // Answer and forwarding events.
  const eventCase = (fn, name, document, why) =>
    fn === accept
      ? accept(name, 'BTPS_EVENT', document, under(V12))
      : refuse(name, 'BTPS_EVENT', document, why, under(V12));
  const events = [
    eventCase(accept, 'accepted', answer('accepted', alice)),
    eventCase(accept, 'accepted-by-a-device', answer('accepted', aliceByDevice)),
    eventCase(
      accept,
      'declined-with-a-note',
      answer('declined', aliceDeclines, { message: note('The rate is not what we discussed.') }),
    ),
    eventCase(accept, 'agreement-progress', forwarded('agreement_progress', [alice])),
    eventCase(accept, 'agreement-complete', forwarded('agreement_complete', [alice, sam, bank])),
    eventCase(
      accept,
      'accepted-with-a-typed-signature',
      answer('accepted', signedWith('accepted', typed)),
    ),
    eventCase(
      accept,
      'accepted-with-a-drawn-signature',
      answer('accepted', signedWith('accepted', drawn)),
    ),
    eventCase(
      refuse,
      'declined-with-a-signature',
      answer('declined', signedWith('declined', typed)),
      'only an acceptance carries a visualSignature',
    ),
    eventCase(
      refuse,
      'typed-signature-with-markup',
      answer('accepted', signedWith('accepted', { type: 'typed', text: '<b>Alice</b>' })),
      'a typed signature is plain text',
    ),
    eventCase(
      refuse,
      'drawn-signature-off-the-canvas',
      answer('accepted', signedWith('accepted', { type: 'drawn', strokes: [[0, 0, 1001, 10]] })),
      'a drawn signature is x, y pairs on a 1000 by 300 canvas',
    ),
    eventCase(
      refuse,
      'accepted-with-a-note',
      answer('accepted', alice, { message: note('Happy to sign.') }),
      'only a declined carries a note',
    ),
    eventCase(
      refuse,
      'accepted-carrying-a-declined-statement',
      answer('accepted', aliceDeclines),
      "the event's eventType is its statement's decision",
    ),
    eventCase(
      refuse,
      'record-signed-both-ways',
      answer('accepted', { ...alice, delegatedArtifact: aliceByDevice.delegatedArtifact }),
      'a record has exactly one of selector and delegatedArtifact',
    ),
    eventCase(
      refuse,
      'record-signed-neither-way',
      answer('accepted', { statement: alice.statement, signature: alice.signature }),
      'a record has exactly one of selector and delegatedArtifact',
    ),
    eventCase(
      refuse,
      'statement-with-another-decision',
      answer('accepted', byIdentity(keys.signer, stated(ALICE, 'maybe', at(2)))),
      'decision is accepted or declined',
    ),
    eventCase(
      refuse,
      'statement-without-a-time',
      answer('accepted', { ...alice, statement: { ...alice.statement, signedAt: undefined } }),
      'a statement has its signedAt',
    ),
    eventCase(
      refuse,
      'agreement-progress-with-no-statements',
      forwarded('agreement_progress', []),
      'forwarding carries at least one statement',
    ),
    eventCase(
      refuse,
      'agreement-complete-with-twenty-one-statements',
      forwarded(
        'agreement_complete',
        Array.from({ length: 21 }, () => alice),
      ),
      'at most one statement for each of at most 20 signers',
    ),
    refuse(
      'accepted-under-1-1',
      'BTPS_EVENT',
      answer('accepted', alice),
      '1.1 has no agreement events',
      under(V11),
    ),
  ];

  // Envelopes: what a server reads without opening anything.
  const send = transporter('BTPS_DOC', '8091a2b3-c4d5-4e6f-9071-82a3b4c5d6e7', {
    from: BANK,
    to: ALICE,
    documentType: 'agreement',
  });
  const envelope = (name, artifact, expect, why) => ({
    name,
    artifact,
    expect,
    ...(why && { why }),
  });
  const envelopes = [
    envelope('agreement-sent', send, 'accept'),
    envelope(
      'trust-request-asking-send-agreement',
      transporter('TRUST_REQ', 'a2b3c4d5-e6f7-4081-9293-a4b5c6d7e8f9', {
        from: BANK,
        to: ALICE,
        permissions: [ask('send:letter'), ask('send:agreement')],
        entityType: 'organisation',
      }),
      'accept',
    ),
    envelope(
      'agreement-sent-under-1-1',
      { ...send, version: V11 },
      'refuse',
      '1.1 has no documentType',
    ),
  ];

  // A send's documentType against the receiver's grants.
  const granted = (names) =>
    trustRecord('accepted', { requested: [], granted: names, detailsHeld: [], detailsShared: [] });
  const documentType = [
    {
      name: 'agreement-granted',
      artifact: send,
      record: granted(['send:agreement']),
      expect: 'accept',
    },
    {
      name: 'letter-granted-not-agreement',
      artifact: send,
      record: granted(['send:letter']),
      expect: 'refuse',
      why: 'send:letter does not cover an agreement',
    },
  ];

  const stamped = [
    {
      name: 'agreement',
      artifact: { ...send, encryption: null, document: agreement },
      expect: V12,
    },
    {
      name: 'answer',
      artifact: transporter('BTPS_EVENT', '5d6e7f80-9102-4a3b-8c4d-5e6f708192a3', {
        from: SAM,
        to: BANK,
        relatesTo: 'agreement-copy-to-sam',
        encryption: null,
        document: answer('accepted', sam),
      }),
      expect: V12,
    },
  ];

  // The rules between an opened answer, its agreement and the answers before it.
  const answerFrom = (record, eventType = record.statement.decision) => ({
    envelope: { from: record.statement.signer, to: BANK },
    event: answer(eventType, record),
  });
  const rule = (name, given, about, earlier, expect, why) => ({
    name,
    ...given,
    agreement: about,
    earlier,
    expect,
    ...(why && { why }),
  });
  const withEnvelope = (given, change) => ({
    ...given,
    envelope: { ...given.envelope, ...change },
  });
  const samFirst = byIdentity(keys.guarantor, stated(SAM, 'accepted', at(3)));
  const statements = [
    rule('first-signer-accepts', answerFrom(alice), agreement, [], 'accept'),
    rule('second-signer-names-the-first', answerFrom(sam), agreement, [alice], 'accept'),
    rule('first-signer-declines', answerFrom(aliceDeclines), agreement, [], 'accept'),
    rule(
      'second-signer-names-a-device-signed-first',
      answerFrom(samAfterDevice),
      agreement,
      [aliceByDevice],
      'accept',
    ),
    rule(
      'any-order-second-signer-first',
      answerFrom(byIdentity(keys.guarantor, stated(SAM, 'accepted', at(3), undefined, anyRef))),
      anyOrder,
      [],
      'accept',
    ),
    rule(
      'not-a-signer',
      answerFrom(
        byIdentity(
          keys.guarantor,
          stated('eve$other.example', 'accepted', at(2), undefined, anyRef),
        ),
      ),
      anyOrder,
      [],
      'refuse',
      'only a listed signer answers',
    ),
    rule(
      'sent-by-someone-else',
      withEnvelope(answerFrom(alice), { from: SAM }),
      agreement,
      [],
      'refuse',
      'a statement is sent by its own signer',
    ),
    rule(
      'out-of-turn',
      answerFrom(samFirst),
      agreement,
      [],
      'refuse',
      'in a sequential agreement the signers answer in list order',
    ),
    rule(
      'later-signer-names-no-previous',
      answerFrom(samFirst),
      agreement,
      [alice],
      'refuse',
      'every statement after the first names the one before it',
    ),
    rule(
      'later-signer-names-another-previous',
      answerFrom(byIdentity(keys.guarantor, stated(SAM, 'accepted', at(3), SHA))),
      agreement,
      [alice],
      'refuse',
      'previous is the SHA-256 of the statement record before it',
    ),
    rule(
      'any-order-names-a-previous',
      answerFrom(byIdentity(keys.guarantor, stated(SAM, 'accepted', at(3), hashOf(alice), anyRef))),
      anyOrder,
      [],
      'refuse',
      'previous is only in a sequential agreement',
    ),
    rule(
      'terms-left-out',
      answerFrom(byIdentity(keys.signer, { ...stated(ALICE, 'accepted', at(2)), terms: [] })),
      agreement,
      [],
      'refuse',
      "a statement repeats the agreement's terms exactly",
    ),
    rule(
      'another-content',
      answerFrom(
        byIdentity(
          keys.signer,
          stated(ALICE, 'accepted', at(2), undefined, { ...ref, contentSha256: SHA }),
        ),
      ),
      agreement,
      [],
      'refuse',
      "a statement names its agreement's own contentSha256",
    ),
    rule(
      'after-the-deadline',
      answerFrom(byIdentity(keys.signer, stated(ALICE, 'accepted', '2026-12-01T00:00:00.000Z'))),
      agreement,
      [],
      'refuse',
      'signedAt is no later than acceptance.by',
    ),
    rule(
      'answers-twice',
      answerFrom(byIdentity(keys.signer, stated(ALICE, 'declined', at(3), undefined, anyRef))),
      anyOrder,
      [byIdentity(keys.signer, stated(ALICE, 'accepted', at(2), undefined, anyRef))],
      'refuse',
      'an answer is final: a signer answers once',
    ),
    rule(
      'after-a-decline',
      answerFrom(byIdentity(keys.guarantor, stated(SAM, 'accepted', at(3), hashOf(aliceDeclines)))),
      agreement,
      [aliceDeclines],
      'refuse',
      'a declined ends a sequential agreement',
    ),
    rule(
      'event-names-another-agreement',
      {
        ...answerFrom(alice),
        event: { ...answer('accepted', alice), agreement: { ...ref, id: 'AGR-2' } },
      },
      agreement,
      [],
      'refuse',
      "the event's agreement is its statement's",
    ),
  ];

  // The evidence bundle: everything, checked offline.
  const keyOf = (identity, key) => ({
    identity,
    selector: 'btps1',
    publicKey: key.publicKeyPem,
    fingerprint: fingerprintOf(key.publicKeyPem),
  });
  const allKeys = [
    keyOf(BANK, keys.originator),
    keyOf(ALICE, keys.signer),
    keyOf(SAM, keys.guarantor),
    keyOf(OPERATOR, keys.operator),
  ];
  const bundle = (statementRecords, about = agreement, bundleKeys = allKeys) => ({
    format: 'btps-evidence/1',
    originator: BANK,
    agreement: about,
    statements: statementRecords,
    keys: bundleKeys,
  });
  const fact = (record, more = {}) => ({
    signer: record.statement.signer,
    decision: record.statement.decision,
    signatureValid: true,
    keyKind: record.delegatedArtifact ? 'device' : 'identity',
    ...(record.delegatedArtifact && { delegatedBy: OPERATOR }),
    agreementMatches: true,
    termsMatch: true,
    withinDeadline: true,
    inOrder: true,
    ...more,
  });
  // The content is the agreement without its originator's signature.
  const contentHashOf = (about) =>
    hashOf(Object.fromEntries(Object.entries(about).filter(([k]) => k !== 'originatorSignature')));
  const verdictless = (about, statementFacts, more = {}) => ({
    contentSha256: contentHashOf(about),
    originatorSignatureValid: true,
    termsAttached: true,
    statements: statementFacts,
    complete: false,
    ...more,
  });
  const evidence = (name, given, expect) => ({ name, bundle: given, expect });
  const changedBody = { ...agreement, body: note('# Home loan\n\nThe rate is 2.1% p.a.') };
  const tamperedSam = { ...sam, statement: { ...sam.statement, signedAt: at(5) } };
  const wrongDevice = byDevice(stated(ALICE, 'accepted', at(2)), keys.guarantor);
  const misattached = signed(
    contentOf(
      {},
      { attachments: [{ ...terms, content: Buffer.from('other').toString('base64') }] },
    ),
  );
  const late = byIdentity(keys.signer, stated(ALICE, 'accepted', '2026-12-01T00:00:00.000Z'));
  const samSelfDelegated = byDevice(
    stated(SAM, 'accepted', at(3), undefined, anyRef),
    keys.device,
    { identity: SAM, key: keys.guarantor },
  );
  const bundles = [
    evidence(
      'complete-sequential-with-identity-keys',
      bundle([alice, sam, bank]),
      verdictless(agreement, [fact(alice), fact(sam), fact(bank)], { complete: true }),
    ),
    evidence(
      'complete-with-a-device-signed-acceptance',
      bundle([aliceByDevice, samAfterDevice, bankAfterDevice]),
      verdictless(agreement, [fact(aliceByDevice), fact(samAfterDevice), fact(bankAfterDevice)], {
        complete: true,
      }),
    ),
    evidence(
      'complete-in-any-order',
      bundle(
        [
          byIdentity(keys.guarantor, stated(SAM, 'accepted', at(3), undefined, anyRef)),
          byIdentity(keys.signer, stated(ALICE, 'accepted', at(4), undefined, anyRef)),
        ],
        anyOrder,
      ),
      verdictless(
        anyOrder,
        [
          fact(byIdentity(keys.guarantor, stated(SAM, 'accepted', at(3), undefined, anyRef))),
          fact(byIdentity(keys.signer, stated(ALICE, 'accepted', at(4), undefined, anyRef))),
        ],
        { complete: true },
      ),
    ),
    evidence('declined', bundle([aliceDeclines]), verdictless(agreement, [fact(aliceDeclines)])),
    evidence(
      'waiting-for-the-last-signer',
      bundle([alice, sam]),
      verdictless(agreement, [fact(alice), fact(sam)]),
    ),
    evidence(
      'content-changed-after-signing',
      bundle([alice, sam, bank], changedBody),
      verdictless(
        changedBody,
        [alice, sam, bank].map((r) => fact(r, { agreementMatches: false })),
        { originatorSignatureValid: false },
      ),
    ),
    evidence(
      'statement-changed-after-signing',
      bundle([alice, tamperedSam, bank]),
      verdictless(agreement, [
        fact(alice),
        fact(tamperedSam, { signatureValid: false }),
        fact(bank, { inOrder: false }),
      ]),
    ),
    evidence(
      'statement-signed-by-another-device',
      bundle([wrongDevice]),
      verdictless(agreement, [fact(wrongDevice, { signatureValid: false })]),
    ),
    evidence(
      'out-of-turn',
      bundle([samFirst]),
      verdictless(agreement, [fact(samFirst, { inOrder: false })]),
    ),
    evidence(
      'after-the-deadline',
      bundle([late]),
      verdictless(agreement, [fact(late, { withinDeadline: false })]),
    ),
    evidence(
      'a-term-that-is-not-its-attachment',
      bundle([], misattached),
      verdictless(misattached, [], { termsAttached: false }),
    ),
    evidence(
      'a-signer-key-left-out',
      bundle(
        [alice],
        agreement,
        allKeys.filter((k) => k.identity !== ALICE),
      ),
      verdictless(agreement, [fact(alice, { signatureValid: false })]),
    ),
    // A delegation the signer signed for itself must be attested by its operator, as a server requires.
    evidence(
      'a-self-delegated-device-without-attestation',
      bundle([samSelfDelegated], anyOrder, [
        keyOf(BANK, keys.originator),
        keyOf(SAM, keys.guarantor),
      ]),
      verdictless(anyOrder, [fact(samSelfDelegated, { signatureValid: false, delegatedBy: SAM })]),
    ),
  ];

  return {
    description:
      "BTPS 1.2 agreements. `documents` and `events` are read as documents-1.2.vectors.json is, under `version`. `envelopes` are transporter artifacts as a server reads them, unopened. `documentType` is a send against the receiver's grants, as in trust-permissions.vectors.json. `stamped` is the version each artifact is stamped with. `contentSha256` is the SHA-256 of an agreement's RFC 8785 form without `originatorSignature`; `statementSha256` is the SHA-256 of a statement record's RFC 8785 form, signature included, which the next statement names as `previous`. `statements` are the originator's platform's rules, never the server's, between an opened answer (`event`, sent from `envelope.from` to `envelope.to`), its `agreement`, and the statement records already answered (`earlier`, in order); signatures are not part of these rules. `bundles` are evidence bundles and the facts an offline verifier reports for each: a verifier reports facts, never a verdict, and every listed fact must be as given. An implementation accepts every \"accept\" case and refuses every \"refuse\" case; `why` says what is wrong.",
    documents,
    events,
    envelopes,
    documentType,
    stamped,
    contentSha256: { document: agreement, sha256: ref.contentSha256 },
    statementSha256: { record: alice, sha256: hashOf(alice) },
    statements,
    bundles,
  };
}

/**
 * BTPS 1.2: an evidence bundle case with the keys its verifier names added to
 * what it expects: the key each signature is checked with, as the bundle holds
 * it, and that none was confirmed online. A bundle's key counts only when its
 * fingerprint is its own; a device signs with its delegation's `agentPubKey`.
 */
export function withKeyFacts(c) {
  const { keys, originator, agreement, statements } = c.bundle;
  const keyFact = (identity, selector) => {
    const key = keys.find(
      (k) =>
        k.identity === identity &&
        k.selector === selector &&
        fingerprintOf(k.publicKey) === k.fingerprint,
    );
    return { identity, selector, ...(key && { fingerprint: key.fingerprint }) };
  };
  return {
    ...c,
    expect: {
      ...c.expect,
      originatorKey: keyFact(originator, agreement.originatorSignature.selector),
      keysConfirmedOnline: false,
      statements: c.expect.statements.map((fact, i) => {
        const record = statements[i];
        if (!record.delegatedArtifact) {
          return { ...fact, key: keyFact(record.statement.signer, record.selector) };
        }
        const { delegation } = record.delegatedArtifact;
        return {
          ...fact,
          key: {
            identity: record.statement.signer,
            fingerprint: fingerprintOf(delegation.agentPubKey),
          },
          delegationKey: keyFact(delegation.signedBy, delegation.selector),
        };
      }),
    },
  };
}

/**
 * BTPS 1.2: RFC 3161 timestamp cases for the agreement vectors, made from the
 * complete sequential bundle in `set`. A test authority, made here with
 * pkijs, issues real tokens: a root CA, and the authority's certificate it
 * issues, for time stamping only. Each case gives `options`, the roots the
 * reader trusts.
 */
export async function agreementTimestamps(set) {
  const asn1js = await import('asn1js');
  const pkijs = await import('pkijs');
  const { subtle } = globalThis.crypto;
  const GEN_TIME = new Date('2026-11-02T00:05:00.000Z');
  const SHA256 = '2.16.840.1.101.3.4.2.1';
  const TST_INFO = '1.2.840.113549.1.9.16.1.4';
  const keyPair = () =>
    subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
  const nameOf = (cn) => [
    new pkijs.AttributeTypeAndValue({
      type: '2.5.4.3',
      value: new asn1js.Utf8String({ value: cn }),
    }),
  ];
  const extension = (extnID, parsedValue) =>
    new pkijs.Extension({
      extnID,
      critical: true,
      extnValue: parsedValue.toSchema().toBER(false),
      parsedValue,
    });
  const certify = async (subject, issuer, serial, extensions) => {
    const certificate = new pkijs.Certificate();
    certificate.version = 2;
    certificate.serialNumber = new asn1js.Integer({ value: serial });
    certificate.issuer.typesAndValues = nameOf(issuer.cn);
    certificate.subject.typesAndValues = nameOf(subject.cn);
    certificate.notBefore.value = new Date('2026-01-01T00:00:00.000Z');
    certificate.notAfter.value = new Date('2036-01-01T00:00:00.000Z');
    certificate.extensions = extensions;
    await certificate.subjectPublicKeyInfo.importKey(subject.keys.publicKey);
    await certificate.sign(issuer.keys.privateKey, 'SHA-256');
    return certificate;
  };
  const pemOf = (certificate) =>
    `-----BEGIN CERTIFICATE-----\n${Buffer.from(certificate.toSchema().toBER()).toString('base64')}\n-----END CERTIFICATE-----`;

  const ca = { cn: 'BTPS Test TSA Root', keys: await keyPair() };
  const tsa = { cn: 'BTPS Test TSA', keys: await keyPair() };
  const root = await certify(ca, ca, 1, [
    extension('2.5.29.19', new pkijs.BasicConstraints({ cA: true })),
  ]);
  const certificate = await certify(tsa, ca, 7, [
    extension('2.5.29.37', new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.8'] })),
  ]);
  // A TLS server's certificate under the same root: not for time stamping.
  const server = { cn: 'BTPS Test TLS Server', keys: await keyPair() };
  const serverCertificate = await certify(server, ca, 8, [
    extension('2.5.29.37', new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.1'] })),
  ]);

  // A TimeStampToken over `sha256Hex`, base64, as an authority's reply carries it.
  const tokenOver = async (sha256Hex, signer = { certificate, keys: tsa.keys }) => {
    const eContent = new pkijs.TSTInfo({
      version: 1,
      policy: '1.3.6.1.4.1.99999.1',
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA256 }),
        hashedMessage: new asn1js.OctetString({ valueHex: Buffer.from(sha256Hex, 'hex') }),
      }),
      serialNumber: new asn1js.Integer({ value: 1 }),
      genTime: GEN_TIME,
    })
      .toSchema()
      .toBER();
    const signedData = new pkijs.SignedData({
      version: 3,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({
        eContentType: TST_INFO,
        eContent: new asn1js.OctetString({ valueHex: eContent }),
      }),
      signerInfos: [
        new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({
            issuer: signer.certificate.issuer,
            serialNumber: signer.certificate.serialNumber,
          }),
          signedAttrs: new pkijs.SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new pkijs.Attribute({
                type: '1.2.840.113549.1.9.3',
                values: [new asn1js.ObjectIdentifier({ value: TST_INFO })],
              }),
              new pkijs.Attribute({
                type: '1.2.840.113549.1.9.4',
                values: [
                  new asn1js.OctetString({ valueHex: await subtle.digest('SHA-256', eContent) }),
                ],
              }),
            ],
          }),
        }),
      ],
      certificates: [signer.certificate],
    });
    await signedData.sign(signer.keys.privateKey, 0, 'SHA-256');
    const token = new pkijs.ContentInfo({
      contentType: '1.2.840.113549.1.7.2',
      content: signedData.toSchema(true),
    });
    return Buffer.from(token.toSchema().toBER()).toString('base64');
  };

  const base = set.bundles.find((c) => c.name === 'complete-sequential-with-identity-keys');
  const [first, second] = base.bundle.statements.map((record) => hashOf(record));
  const timestamp = (imprintMatches, byAuthority) => ({
    imprintMatches,
    signatureValid: true,
    time: GEN_TIME.toISOString(),
    authority: byAuthority ? 'CN=BTPS Test TSA' : 'CN=BTPS Test TLS Server',
    timestampingKeyUsage: byAuthority,
    trusted: byAuthority,
  });
  // The first statement timestamped; its facts gain `timestamp`, and nothing else changes.
  const timestamped = (name, token, imprintMatches, byAuthority = true) => ({
    name,
    bundle: { ...base.bundle, timestamps: [{ statementSha256: first, token }] },
    options: { trustedTimestampRoots: [pemOf(root)] },
    expect: {
      ...base.expect,
      statements: base.expect.statements.map((fact, i) =>
        i === 0 ? { ...fact, timestamp: timestamp(imprintMatches, byAuthority) } : fact,
      ),
    },
  });
  return [
    timestamped('timestamped-by-a-trusted-authority', await tokenOver(first), true),
    // A real token, but over the second statement: it is reported, and decides nothing.
    timestamped('timestamp-of-another-statement', await tokenOver(second), false),
    // Signed under the trusted root, but by a TLS server's certificate: RFC 3161 §2.3
    // takes only a certificate whose one usage is timeStamping, so it is not trusted.
    timestamped(
      'timestamp-by-a-certificate-not-for-time-stamping',
      await tokenOver(first, { certificate: serverCertificate, keys: server.keys }),
      true,
      false,
    ),
  ];
}

/**
 * BTPS 1.2: key chain cases for the agreement vectors, made from the complete
 * sequential bundle in `set`: the bundle keeps signing identities' chains
 * (`keyChains`, with an operator's signed answer) and statements' signed
 * arrivals (`arrivals`), and each signing key is reported against its chain.
 * `keys`: the originator's and the guarantor's signing keys, each one's next
 * key, the guarantor's operator's key, and a forger's, `{ publicKeyPem, privateKeyPem }`.
 */
export function agreementKeyChains(set, keys) {
  const { originator, originatorNext, guarantor, guarantorNext, guarantorOperator, forger } = keys;
  const BANK = 'loans$bank.example';
  const SAM = 'sam$guarantor.example';
  const OPERATOR = 'admin$guarantor.example';
  const day = (d, time = '00:00:00') => `2026-11-${String(d).padStart(2, '0')}T${time}.000Z`;
  const fp = (k) => fingerprintOf(k.publicKeyPem);
  const keyOf = (k, selector) => ({
    selector,
    fingerprint: fp(k),
    publicKey: crypto
      .createPublicKey(k.publicKeyPem)
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
  });
  // A first rotation, btps1 to btps2: planned and signed by both keys unless `immediate`;
  // a lost key's rotation names its public key, and only `to` signs it (`signers`).
  const rotation = (identity, from, to, d, more = {}) => {
    const { immediate, signers } = more;
    const object = {
      type: 'btps.keyRotation.v1',
      identity,
      from: keyOf(from, 'btps1'),
      to: keyOf(to, 'btps2'),
      at: day(d),
      expiry: immediate ? 'immediate' : 'planned',
      ...(immediate && { compromisedSince: day(immediate.since), reason: immediate.reason }),
      prev: null,
    };
    return {
      rotation: object,
      signatures: (
        signers ?? [
          ['from', from],
          ['to', to],
        ]
      ).map(([by, k]) => ({ by, ...signatureBy(k, object) })),
    };
  };

  const base = set.bundles.find((c) => c.name === 'complete-sequential-with-identity-keys');
  const [, samRecord] = base.bundle.statements;
  // A signing key against its chain, each fact as the spec's "In an evidence bundle" defines it.
  const chainFacts = (next, more) => ({
    chainValid: true,
    keyInChain: true,
    authorityUnverified: false,
    forked: false,
    reachesKey: fp(next),
    anchored: false,
    rotatedAt: day(20),
    signedInWindow: true,
    ...more,
  });
  const withFacts = (name, bundle, facts, options) => ({
    name,
    bundle: { ...base.bundle, ...bundle },
    ...(options && { options }),
    expect: {
      ...base.expect,
      ...(facts.originator && { originatorKeyChain: facts.originator }),
      statements: base.expect.statements.map((fact, i) => ({ ...fact, ...facts.statements?.[i] })),
    },
  });

  // The bank rotates away from the key it signed with, as planned, after it signed.
  const bankChain = [{ identity: BANK, records: [rotation(BANK, originator, originatorNext, 20)] }];
  const bankFacts = chainFacts(originatorNext);
  const anchored = {
    ...bankFacts,
    anchored: { by: 'kept-fingerprint', upTo: fp(originatorNext) },
  };
  // The guarantor's key, expired on the 20th from the 1st: before the guarantor signed, on the 3rd.
  const samExpired = [
    {
      identity: SAM,
      records: [
        rotation(SAM, guarantor, guarantorNext, 20, {
          immediate: { since: 1, reason: 'compromised' },
        }),
      ],
    },
  ];
  const expired = {
    expiredImmediately: { at: day(20), compromisedSince: day(1), reason: 'compromised' },
    signedInWindow: false,
  };
  // The bank's platform received the guarantor's statement on the 3rd, and signed that then.
  const arrival = (arrivedAt) => {
    const unsigned = {
      statementSha256: hashOf(samRecord),
      arrivedAt,
      receivedBy: BANK,
      selector: 'btps1',
    };
    const signed = { type: 'btps.arrival.v1', ...unsigned };
    return { ...unsigned, signature: signatureBy(originator, signed) };
  };
  const received = arrival(day(3, '00:00:05'));
  // The guarantor's key, lost on the 20th: only the new key signs its rotation.
  const lost = rotation(SAM, guarantor, guarantorNext, 20, {
    immediate: { since: 20, reason: 'lost' },
    signers: [['to', guarantorNext]],
  });
  const lostFacts = {
    expiredImmediately: { at: day(20), compromisedSince: day(20), reason: 'lost' },
  };
  // The operator's signed answer to the lookup that served the chain, kept whole.
  const answered = {
    version: '1.2.0',
    status: { ok: true, code: 200 },
    id: 'e9d1c0b2-7a64-4f3e-9b28-5c1d0e7f6a43',
    issuedAt: day(21),
    type: 'btps_response',
    reqId: '0b7c2e4d-8f15-4a96-b3d7-6e2f1a9c8d50',
    document: { identity: SAM, keyChain: [lost] },
    signedBy: OPERATOR,
    selector: 'btps1',
  };
  // The answer, and the operator's key the bundle holds, signed and put there by `by`.
  const answeredBy = (by) => ({
    keys: [
      ...base.bundle.keys,
      { identity: OPERATOR, selector: 'btps1', publicKey: by.publicKeyPem, fingerprint: fp(by) },
    ],
    keyChains: [
      {
        identity: SAM,
        records: [lost],
        operatorAnswer: { ...answered, signature: signatureBy(by, answered) },
      },
    ],
  });
  // An operator key is the bundle's own: its answer confirms the rotation only when the
  // reader named that key's fingerprint as the operator of the guarantor's domain
  // (`operators`; or confirmed it online as the operator DNS names). A plain anchor
  // vouches for a key's own records, never for what it says of another identity.
  const namedOperator = { operators: { 'guarantor.example': fp(guarantorOperator) } };
  const answerFacts = (operatorKeyAnchored) => ({
    signedBy: OPERATOR,
    signatureValid: true,
    answersThisChain: true,
    operatorKeyAnchored,
  });

  return [
    withFacts(
      'a-signing-key-rotated-away-after-it-signed',
      { keyChains: bankChain },
      { originator: bankFacts, statements: { 2: { keyChain: bankFacts } } },
    ),
    withFacts(
      'a-kept-fingerprint-anchors-the-chain-up-to-itself',
      { keyChains: bankChain },
      { originator: anchored, statements: { 2: { keyChain: anchored } } },
      { anchors: [fp(originatorNext)] },
    ),
    withFacts(
      'a-key-expired-from-before-it-signed-received-before-the-expiry',
      { keyChains: samExpired, arrivals: [received] },
      {
        statements: {
          1: {
            arrival: { at: received.arrivedAt, receivedBy: BANK, signatureValid: true },
            keyChain: chainFacts(guarantorNext, { ...expired, disownedAfterTheFact: true }),
          },
        },
      },
    ),
    // Its time changed after it was signed: the arrival is reported, and gives no time.
    withFacts(
      'an-arrival-whose-signature-does-not-hold',
      { keyChains: samExpired, arrivals: [{ ...received, arrivedAt: day(2) }] },
      {
        statements: {
          1: {
            arrival: { at: day(2), receivedBy: BANK, signatureValid: false },
            keyChain: chainFacts(guarantorNext, expired),
          },
        },
      },
    ),
    withFacts(
      'a-lost-keys-rotation-unconfirmed-offline',
      { keyChains: [{ identity: SAM, records: [lost] }] },
      {
        statements: {
          1: { keyChain: chainFacts(guarantorNext, { ...lostFacts, authorityUnverified: true }) },
        },
      },
    ),
    withFacts(
      'a-lost-keys-rotation-with-its-operators-answer-by-a-key-not-kept',
      answeredBy(guarantorOperator),
      {
        statements: {
          1: {
            keyChain: chainFacts(guarantorNext, {
              ...lostFacts,
              authorityUnverified: true,
              operatorAnswer: answerFacts(false),
            }),
          },
        },
      },
    ),
    withFacts(
      'a-lost-keys-rotation-confirmed-by-the-operator-named-for-its-domain',
      answeredBy(guarantorOperator),
      {
        statements: {
          1: {
            keyChain: chainFacts(guarantorNext, {
              ...lostFacts,
              operatorAnswer: answerFacts(true),
            }),
          },
        },
      },
      namedOperator,
    ),
    // The operator's real key, kept only as a plain anchor: it confirms nothing it says.
    withFacts(
      'an-operators-answer-by-a-key-kept-only-as-an-anchor',
      answeredBy(guarantorOperator),
      {
        statements: {
          1: {
            keyChain: chainFacts(guarantorNext, {
              ...lostFacts,
              authorityUnverified: true,
              operatorAnswer: answerFacts(false),
            }),
          },
        },
      },
      { anchors: [fp(guarantorOperator)] },
    ),
    // A forger's answer, signed by a key it put in the bundle as the operator's: the
    // reader named the real operator, and the forged one confirms nothing.
    withFacts(
      'a-lost-keys-rotation-with-a-forged-operators-answer',
      answeredBy(forger),
      {
        statements: {
          1: {
            keyChain: chainFacts(guarantorNext, {
              ...lostFacts,
              authorityUnverified: true,
              operatorAnswer: answerFacts(false),
            }),
          },
        },
      },
      namedOperator,
    ),
  ];
}

/**
 * BTPS 1.2 key rotation: an identity's chain of signed key rotation and expiry
 * records, the facts a verifier reports about a chain (`chains`), and whether
 * a verifier online refuses one (`online`). `keys` are five test keys made at
 * generation, `{ publicKeyPem, privateKeyPem }`, the last of them 1024 bits.
 */
export function keyRotation(keys) {
  const [k1, k2, k3, k4, small] = keys;
  const ME = 'billing$vendor.example';
  const day = (d) => `2026-11-${String(d).padStart(2, '0')}T00:00:00.000Z`;
  const NOW = Date.parse('2026-12-01T00:00:00.000Z');
  const fp = (k) => fingerprintOf(k.publicKeyPem);
  const keyOf = (k, selector) => ({
    selector,
    fingerprint: fp(k),
    publicKey: crypto
      .createPublicKey(k.publicKeyPem)
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
  });
  const signedOf = (record) => record.rotation ?? record.expiry;
  // What the next record names as `prev`: the SHA-256 of the signed object only, lowercase hex.
  const prevOf = (record) => (record ? hashOf(signedOf(record)) : null);
  const signed = (kind, object, signers) => ({
    [kind]: object,
    signatures: signers.map(([by, k]) => ({
      by,
      algorithmHash: 'sha256',
      value: signWith(k.privateKeyPem, object),
      fingerprint: fp(k),
    })),
  });
  const rotation = (from, fromSelector, to, toSelector, d, prev, more = {}) => {
    const { immediate, signers, change = (o) => o } = more;
    const object = change({
      type: 'btps.keyRotation.v1',
      identity: ME,
      from: keyOf(from, fromSelector),
      to: keyOf(to, toSelector),
      at: day(d),
      expiry: immediate ? 'immediate' : 'planned',
      ...(immediate && { compromisedSince: day(immediate.since), reason: immediate.reason }),
      prev: prevOf(prev),
    });
    return signed(
      'rotation',
      object,
      signers ?? [
        ['from', from],
        ['to', to],
      ],
    );
  };
  const expiry = (key, selector, since, d, prev, current) =>
    signed(
      'expiry',
      {
        type: 'btps.keyExpiry.v1',
        identity: ME,
        key: { selector, fingerprint: fp(key) },
        compromisedSince: day(since),
        reason: 'compromised',
        at: day(d),
        prev: prevOf(prev),
      },
      [['current', current]],
    );

  const r1 = rotation(k1, 'btps1', k2, 'btps2', 10, null);
  const r2 = rotation(k2, 'btps2', k3, 'btps3', 20, r1);
  const urgent = rotation(k2, 'btps2', k3, 'btps3', 20, r1, {
    immediate: { since: 18, reason: 'compromised' },
  });
  const lost = rotation(k2, 'btps2', k3, 'btps3', 20, r1, {
    immediate: { since: 19, reason: 'lost' },
    signers: [['to', k3]],
  });
  const pastExpiry = expiry(k1, 'btps1', 5, 25, r2, k3);
  // The owner rotates away from btps2, compromised from day 15; a thief holding it forks on day 16.
  const owner = rotation(k2, 'btps2', k3, 'btps3', 20, r1, {
    immediate: { since: 15, reason: 'compromised' },
  });
  const thief = rotation(k2, 'btps2', k4, 'btps4', 16, r1);
  const anchors = (...ks) => ({ identity: ME, anchors: ks.map(fp) });
  // What DNS says of the identity: no key record at the domain's s= (host-only),
  // or the keys it publishes at the chain's last selector and at s=, maybe none.
  const hostOnly = { kind: 'hostOnly' };
  const published = (...ks) => ({ kind: 'published', fingerprints: ks.map(fp) });
  const online = (dns, fromOperator = true) => ({
    identity: ME,
    online: { fromOperator, dns },
  });
  // `now` (ms): the verifier's clock, after every record, so no case depends on the day it runs.
  const checked = (dns, fromOperator = true) => ({ identity: ME, fromOperator, dns, now: NOW });
  // A host's own chain for an identity that publishes its key in DNS: to a key
  // of the host's, under a selector DNS has no record at.
  const hostsLost = rotation(k2, 'btps2', k4, 'btps9', 20, r1, {
    immediate: { since: 19, reason: 'lost' },
    signers: [['to', k4]],
  });
  const hostsPlanned = rotation(k2, 'btps2', k4, 'btps9', 20, r1);
  // btps2's key, re-published under btps5 when the domain moved, rotates away from there.
  const moved = rotation(k2, 'btps5', k3, 'btps6', 20, r1);
  const refused = (name, chain, why) => ({
    name,
    chain,
    options: { identity: ME },
    why,
    expect: { chainValid: false },
  });
  const three = [
    { selector: 'btps1', fingerprint: fp(k1), validUntil: day(10), rotatedAway: 'planned' },
    { selector: 'btps2', fingerprint: fp(k2), validFrom: day(10), validUntil: day(20) },
    { selector: 'btps3', fingerprint: fp(k3), validFrom: day(20) },
  ];

  return {
    description:
      "Key rotation (since 1.2). `chains`: give `chain` and `options` to the verifier; every fact `expect` lists must be as given (a verifier may report more; a key's `publicKey` is its SPKI PEM). `online`: the refusal a verifier applies online, `accept` or `refuse`. `recordHash`: a record's `prev` value, the SHA-256 of its signed object's RFC 8785 form in lowercase hex.",
    recordHash: { record: r1, sha256: hashOf(r1.rotation) },
    chains: [
      {
        name: 'planned-chain-of-three-keys',
        chain: [r1, r2],
        options: { identity: ME },
        expect: { chainValid: true, forked: false, authorityUnverified: false, keys: three },
      },
      {
        name: 'records-in-any-order-are-read-by-their-links',
        chain: [r2, r1],
        options: { identity: ME },
        expect: { chainValid: true, keys: three },
      },
      {
        name: 'never-rotated-is-an-empty-chain',
        chain: [],
        options: { identity: ME },
        expect: { chainValid: true, keys: [], anchored: false },
      },
      {
        name: 'immediate-expiry-signed-by-both-keys',
        chain: [r1, urgent],
        options: { identity: ME },
        expect: {
          chainValid: true,
          authorityUnverified: false,
          keys: [
            { fingerprint: fp(k1) },
            {
              fingerprint: fp(k2),
              rotatedAway: 'immediate',
              compromisedSince: day(18),
              reason: 'compromised',
              expiredAt: day(20),
            },
            { fingerprint: fp(k3), validFrom: day(20) },
          ],
        },
      },
      {
        name: 'lost-key-offline-authority-unverified',
        chain: [r1, lost],
        options: anchors(k3),
        expect: { chainValid: true, authorityUnverified: true },
      },
      {
        name: 'lost-key-confirmed-by-the-operator-for-a-host-only-identity',
        chain: [r1, lost],
        options: online(hostOnly),
        expect: { authorityUnverified: false, anchored: { by: 'online', upTo: fp(k3) } },
      },
      {
        name: 'lost-key-confirmed-by-dns-at-its-new-selector',
        chain: [r1, lost],
        options: online(published(k3)),
        expect: { authorityUnverified: false, anchored: { by: 'online', upTo: fp(k3) } },
      },
      {
        name: 'a-hosts-lost-key-chain-for-a-dns-identity-with-no-record-where-it-ends',
        note: "DNS has no record at btps9, the chain's last selector, and the identity's real key at s=: published, never host-only.",
        chain: [r1, hostsLost],
        options: online(published(k2)),
        expect: { chainValid: true, anchored: false, authorityUnverified: true },
      },
      {
        name: 'an-expiry-under-the-later-selector-a-key-was-published-under',
        chain: [r1, moved, expiry(k2, 'btps5', 15, 25, moved, k3)],
        options: { identity: ME },
        expect: { chainValid: true, keys: [{}, { compromisedSince: day(15) }, {}] },
      },
      {
        name: 'expiry-of-a-past-key-voids-nothing-on-the-anchored-path',
        chain: [r1, r2, pastExpiry],
        options: anchors(k3),
        expect: {
          chainValid: true,
          anchored: { by: 'kept-fingerprint', upTo: fp(k3) },
          keys: [
            { fingerprint: fp(k1), compromisedSince: day(5), expiredAt: day(25) },
            { fingerprint: fp(k2) },
            { fingerprint: fp(k3) },
          ],
        },
      },
      {
        name: 'a-kept-fingerprint-anchors-up-to-itself-only',
        chain: [r1, r2],
        options: anchors(k1),
        expect: { anchored: { by: 'kept-fingerprint', upTo: fp(k1) } },
      },
      {
        name: 'the-same-key-under-a-new-selector-needs-no-record',
        note: "The domain moved s= to btps9 and re-published btps2's key under it: DNS at btps9 gives the chain's current fingerprint.",
        chain: [r1],
        options: online(published(k2)),
        expect: { chainValid: true, anchored: { by: 'online', upTo: fp(k2) } },
      },
      {
        name: 'a-fork-picks-no-branch-without-an-anchor-past-it',
        chain: [r1, owner, thief],
        options: anchors(k1),
        expect: {
          chainValid: true,
          forked: true,
          keys: [],
          anchored: false,
          branches: [
            { tip: fp(k3), void: false },
            { tip: fp(k4), void: false },
          ],
        },
      },
      {
        name: 'a-thiefs-branch-off-the-anchored-path-is-void',
        chain: [r1, owner, thief],
        options: online(published(k3)),
        expect: {
          forked: true,
          anchored: { by: 'online', upTo: fp(k3) },
          branches: [
            { tip: fp(k3), void: false },
            { tip: fp(k4), void: true },
          ],
        },
      },
      refused(
        'a-rotation-without-the-new-keys-signature',
        [rotation(k1, 'btps1', k2, 'btps2', 10, null, { signers: [['from', k1]] })],
        'the new key proves its holder has it',
      ),
      refused(
        'a-planned-rotation-signed-by-a-key-it-does-not-name',
        [
          rotation(k1, 'btps1', k2, 'btps2', 10, null, {
            signers: [
              ['from', k4],
              ['to', k2],
            ],
          }),
        ],
        'the old key is the authority',
      ),
      refused(
        'a-stated-fingerprint-that-is-not-the-keys',
        [
          rotation(k1, 'btps1', k2, 'btps2', 10, null, {
            change: (o) => ({ ...o, to: { ...o.to, fingerprint: fp(k4) } }),
          }),
        ],
        'a fingerprint is computed from the DER SPKI, never taken from the record',
      ),
      refused(
        'a-key-under-2048-bits',
        [rotation(k1, 'btps1', small, 'btps2', 10, null)],
        'every key is RSA of at least 2048 bits',
      ),
      refused(
        'a-wrong-type',
        [
          rotation(k1, 'btps1', k2, 'btps2', 10, null, {
            change: (o) => ({ ...o, type: 'btps.keyRotation.v2' }),
          }),
        ],
        'the signed type tag is btps.keyRotation.v1',
      ),
      refused(
        'another-identitys-record',
        [
          rotation(k1, 'btps1', k2, 'btps2', 10, null, {
            change: (o) => ({ ...o, identity: 'other$vendor.example' }),
          }),
        ],
        "a record's identity is the identity being resolved",
      ),
      refused(
        'a-rotation-signed-by-current',
        [
          rotation(k1, 'btps1', k2, 'btps2', 10, null, {
            signers: [
              ['to', k2],
              ['current', k1],
            ],
          }),
        ],
        'a rotation is signed by from and to',
      ),
      refused(
        'a-broken-prev',
        [
          r1,
          rotation(k2, 'btps2', k3, 'btps3', 20, r1, {
            change: (o) => ({ ...o, prev: 'f'.repeat(64) }),
          }),
        ],
        "prev names the previous record's hash",
      ),
      refused(
        'two-first-records',
        [r1, rotation(k3, 'btps3', k4, 'btps4', 30, null)],
        'only the first record has a null prev',
      ),
      refused(
        'time-going-backwards',
        [r1, rotation(k2, 'btps2', k3, 'btps3', 5, r1)],
        "each record's at is later than the previous one's",
      ),
      refused(
        'a-key-introduced-twice-a-b-a',
        [r1, r2, rotation(k3, 'btps3', k1, 'btps4', 30, r2)],
        'a key is introduced once',
      ),
      refused(
        'a-b-a-under-a-second-stated-fingerprint',
        [
          r1,
          r2,
          rotation(k3, 'btps3', k1, 'btps4', 30, r2, {
            change: (o) => ({ ...o, to: { ...o.to, fingerprint: fp(k4) } }),
          }),
        ],
        'a fingerprint is computed, so a key cannot pass as another',
      ),
      refused(
        'a-reused-selector',
        [r1, r2, rotation(k3, 'btps3', k4, 'btps1', 30, r2)],
        'a selector names one key for the life of the identity',
      ),
      refused(
        'an-expiry-not-signed-by-the-current-key',
        [r1, r2, expiry(k1, 'btps1', 5, 25, r2, k2)],
        'the current key signs an expiry',
      ),
      refused(
        'an-expiry-of-the-current-key',
        [r1, r2, expiry(k3, 'btps3', 5, 25, r2, k3)],
        'the current key is expired by rotating it with immediate expiry',
      ),
      refused(
        'an-expiry-under-a-selector-the-chain-never-names-that-key-under',
        [r1, r2, expiry(k1, 'btps2', 5, 25, r2, k3)],
        'an expiry names its key under a selector the chain names it under',
      ),
    ],
    online: [
      {
        name: 'a-chain-ending-at-the-identitys-dns-key',
        chain: [r1, r2],
        options: checked(published(k3)),
        expect: 'accept',
      },
      {
        name: 'a-chain-ending-at-the-key-dns-has-at-either-selector',
        chain: [r1, r2],
        options: checked(published(k4, k3)),
        expect: 'accept',
      },
      {
        name: 'a-host-only-identitys-chain-from-the-operator',
        chain: [r1, r2],
        options: checked(hostOnly),
        expect: 'accept',
      },
      {
        name: 'a-truncated-chain',
        chain: [r1],
        options: checked(published(k3)),
        why: 'it does not end at the key DNS publishes',
        expect: 'refuse',
      },
      {
        name: 'a-hosts-lost-key-chain-where-dns-has-no-record-of-its-last-key',
        chain: [r1, hostsLost],
        options: checked(published()),
        why: 'for an identity that publishes its key, no record where the chain ends is never host-only',
        expect: 'refuse',
      },
      {
        name: 'a-hosts-planned-chain-where-dns-has-only-the-identitys-real-key',
        chain: [r1, hostsPlanned],
        options: checked(published(k2)),
        why: "the chain's last key is not a key DNS publishes for the identity",
        expect: 'refuse',
      },
      {
        name: 'a-chain-not-from-the-operator',
        chain: [r1, r2],
        options: checked(published(k3), false),
        why: "online, a chain comes in the operator's signed answer",
        expect: 'refuse',
      },
      {
        name: 'a-forked-chain',
        chain: [r1, owner, thief],
        options: checked(published(k3)),
        why: 'online, a key has one successor',
        expect: 'refuse',
      },
    ],
  };
}

/**
 * BTPS 1.2 key rotation, live: whether a verifier takes an artifact signed by
 * a key of a verified chain, now. The current key, and a key rotated away as
 * planned within its grace, are taken; past the grace, `BTP_ERROR_KEY_RETIRED`;
 * an expired key, whatever the time, `BTP_ERROR_KEY_REVOKED`.
 */
export function keyRotationSigners() {
  const NOW = '2026-12-01T00:00:00.000Z';
  const before = (seconds) => new Date(Date.parse(NOW) - seconds * 1000).toISOString();
  const key = { selector: 'btps1', fingerprint: 'not-checked-here', publicKey: 'not-checked-here' };
  const signer = (name, more, grace, expect) => ({
    name,
    key: { ...key, ...more },
    now: Date.parse(NOW),
    retiredKeyGraceSeconds: grace,
    expect,
  });
  return {
    description:
      "Key rotation, live (since 1.2): give `key` (a key of a verified chain, with its window), `now` (ms) and `retiredKeyGraceSeconds` to the verifier's rule for an arriving artifact. `expect` is `accept`, or the BTPS error code it refuses with.",
    cases: [
      signer('the-current-key', {}, 86400, 'accept'),
      signer(
        'retired-as-planned-within-its-grace',
        { validUntil: before(86400), rotatedAway: 'planned' },
        86400,
        'accept',
      ),
      signer(
        'retired-as-planned-past-its-grace',
        { validUntil: before(86401), rotatedAway: 'planned' },
        86400,
        'BTP_ERROR_KEY_RETIRED',
      ),
      signer(
        'retired-with-no-grace',
        { validUntil: before(1), rotatedAway: 'planned' },
        0,
        'BTP_ERROR_KEY_RETIRED',
      ),
      signer(
        'rotated-with-immediate-expiry-at-once',
        {
          validUntil: before(1),
          rotatedAway: 'immediate',
          compromisedSince: before(60),
          reason: 'compromised',
          expiredAt: before(1),
        },
        86400,
        'BTP_ERROR_KEY_REVOKED',
      ),
      signer(
        'expired-after-the-fact-within-what-was-its-grace',
        {
          validUntil: before(30),
          rotatedAway: 'planned',
          compromisedSince: before(300),
          reason: 'compromised',
          expiredAt: before(1),
        },
        86400,
        'BTP_ERROR_KEY_REVOKED',
      ),
    ],
  };
}
