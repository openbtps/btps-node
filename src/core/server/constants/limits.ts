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
 * protocol version.
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
  // An invoice's, a receipt's and a payslip's; a letter has its own.
  attachments: 10,
  references: 20,
  // A row has no more cells than there may be columns.
  lineItems: {
    rows: 10000,
    columns: 50,
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
  // Every record: metadata, identifiers, yearToDate, agentInfo, template data.
  recordKeys: 100,
  // A document's own id, and the id of a document it references.
  documentId: 100,
  referenceType: 64,
} as const;
