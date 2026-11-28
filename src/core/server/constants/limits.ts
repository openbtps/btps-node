/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * The longest each field may be: a text in characters, a list in entries, a
 * record in keys. The protocol fixes these,
 * so every provider accepts the same documents: a provider may be stricter
 * in its own middleware, but cannot raise them. They are raised only by a
 * protocol version. Since 1.2, one exception: how many attachments a 1.2.0
 * document carries (`documentAttachments`), which a provider may raise.
 */
export const BTPS_FIELD_LIMITS = {
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
  trustResponse: {
    id: 100,
    decidedBy: 254,
    message: 5000,
  },
  event: {
    message: 5000,
    reason: 64,
  },
  receipt: {
    paymentMethod: 64,
    paymentReference: 100,
  },
  payslip: {
    // Every code in a payslip: categories, units and leave kinds.
    code: 64,
    earnings: 200,
    deductions: 200,
    contributions: 200,
    leave: 200,
  },
  letter: {
    title: 200,
    content: 100000,
    attachments: 10,
    references: 20,
  },
  // Since 1.2, an agreement: a letter's limits, and who signs it.
  agreement: {
    signers: 20,
    // Since 1.2: a cosignature's encrypted statement is padded up to a multiple of this many characters, so its
    // length does not tell an acceptance (with its visual signature and consent) from a decline.
    statementPaddingBucket: 4096,
    // Since 1.2: a cosignature's ciphertext, in base64 characters: a statement with a drawn signature, padded.
    cosignatureCiphertextChars: 262144,
  },
  // Since 1.2, an identity's key chain: its records, and each key's DER SPKI in base64.
  keyChain: {
    records: 100,
    publicKey: 2048,
  },
  // An invoice's, a receipt's and a payslip's under 1.1.0; a letter has its own. 1.2.0: `documentAttachments`.
  attachments: 10,
  // Since 1.2, under 1.2.0: the attachments of every type of document, and so an agreement's terms.
  // Every receiver takes `standard`, so a sender within it is never refused; a provider may take
  // more, up to `ceiling` (`maxAttachments`), and may send fewer. Unlike the other limits, a
  // provider raises this one itself.
  documentAttachments: { standard: 20, ceiling: 1000 },
  references: 20,
  // A row has no more cells than there may be columns. Since 1.2, under 1.2.0: a column's name and
  // a text cell in characters.
  lineItems: {
    rows: 10000,
    columns: 50,
    cell: 1000,
  },
  query: {
    in: 1000,
    notIn: 1000,
    results: 1000,
  },
  // The ids an agent deletes or cancels at once.
  ids: 1000,
  agentInfoValues: 50,
  trustRecord: {
    keyHistory: 1000,
  },
  // Every record: metadata, identifiers, yearToDate, agentInfo, a 1.1 template's data.
  recordKeys: 100,
  // A document's own id, and the id of a document it references.
  documentId: 100,
  referenceType: 64,
  // Since 1.2, under 1.2.0: an invoice's or receipt's description, as long as an event's message.
  note: 5000,
  // Since 1.2: a template's or logo's https source, as long as a logo or website address.
  url: 2048,
  // Since 1.2, under 1.2.0: a signatory's name, title and visual signature, and an agreement
  // signer's. A drawn signature is integer strokes on a fixed canvas, `width` by `height`.
  signature: { text: 100, strokes: 32, strokePoints: 512, points: 2048, width: 1000, height: 300 },
  // Since 1.2, under 1.2.0: the name of who a document is for.
  recipientName: 200,
  // Since 1.2, under 1.2.0: a document's BoundView, its signed canvas. Sizes in bytes.
  boundView: {
    json: 384 * 1024,
    pageWidth: 2000,
    pageHeight: 20000,
    breaks: 100,
    elements: 2000,
    textElements: 1000,
    position: 20000,
    label: 500,
    path: 20000,
    paths: 100000,
    stops: 8,
    fonts: 8,
    glyphs: 256,
    glyphPath: 4000,
    kerning: 4096,
    fallback: 4,
    images: 8,
    imageSide: 1024,
    imagePixels: 262144,
    imageData: 256 * 1024,
    affix: 8,
    groups: 32,
  },
  // Since 1.2: a trust detail's `{ number, country }` (detail:taxNo, detail:registrationNumber).
  detailNumber: 64,
} as const;
