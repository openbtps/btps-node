/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Since 1.2: the document types a `BTPS_DOC` carries. Each names a `send:`
 * permission and a `documentType`, so a new type is added here, with its schema.
 */
export const DOCUMENT_TYPES = ['invoice', 'receipt', 'payslip', 'letter', 'agreement'] as const;

/** Since 1.2: the details a trust may ask for, each a `detail:` permission. */
export const DETAIL_TYPES = [
  'legalName',
  'profile',
  'email',
  'phone',
  'address',
  'taxNo',
  'dob',
  'registrationNumber',
] as const;

/** Since 1.2: what owns a BTPS address. */
export const ENTITY_TYPES = ['person', 'organisation'] as const;

export const SEND_PERMISSIONS = DOCUMENT_TYPES.map((type) => `send:${type}` as const);
export const DETAIL_PERMISSIONS = DETAIL_TYPES.map((type) => `detail:${type}` as const);

/** Since 1.2: details refresh: a notice that details changed, a request for some, and its answer. */
export const DETAILS_ARTIFACT_TYPES = ['DETAILS_CHANGED', 'DETAILS_REQ', 'DETAILS_RES'] as const;

/** Since 1.2: the envelope fields of trust permissions, and the artifact types each is on. */
export const PERMISSION_ENVELOPE_FIELDS = {
  permissions: ['TRUST_REQ'],
  entityType: ['TRUST_REQ', 'TRUST_RES'],
  given: ['TRUST_REQ'],
  change: ['TRUST_REQ'],
  granted: ['TRUST_RES'],
  documentType: ['BTPS_DOC'],
  details: DETAILS_ARTIFACT_TYPES,
} as const;

/**
 * The one detail each kind gives that the other never does: a person its date
 * of birth, an organisation its registration number. Asking for either is met
 * by giving your own.
 */
export const IDENTITY_DETAIL = {
  person: 'detail:dob',
  organisation: 'detail:registrationNumber',
} as const;
