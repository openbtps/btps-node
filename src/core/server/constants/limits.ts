/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * The longest each field may be, in characters. The protocol fixes these,
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
  },
  letter: {
    title: 200,
    content: 100000,
    attachments: 10,
    references: 20,
  },
  // A document's own id, and the id of a document it references.
  documentId: 100,
  referenceType: 64,
} as const;
