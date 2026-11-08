/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// The refusals a platform reads by name: each problem the permission checks
// give, against a trust record and, for a details response, the request it
// names. permissionCombinations.test.ts checks every grant; these are the
// cases a combination never reaches.

import { describe, expect, it } from 'vitest';
import {
  detailsNamesRefusal,
  detailsProblem,
  detailsRequestRefusal,
  documentTypeProblem,
  documentTypeRefusal,
  trustGrantProblem,
  trustGrantRefusal,
  trustPermissionsFromResponse,
  type BTPDetailsEnvelope,
} from './permissions.js';
import {
  BTP_ERROR_DETAILS_NOT_HELD,
  BTP_ERROR_DOCUMENT_TYPE_MISMATCH,
  BTP_ERROR_PERMISSION,
  BTP_ERROR_PERMISSION_REQUIRED,
} from '../error/index.js';
import type { BTPTrustRecordPermissions } from './types.js';

const VENDOR = 'billing$vendor.example';
const CLIENT = 'pay$client.example';

const permissions = (more: Partial<BTPTrustRecordPermissions> = {}): BTPTrustRecordPermissions => ({
  requested: [{ name: 'send:invoice', required: true }],
  granted: ['send:invoice', 'detail:email'],
  detailsHeld: ['detail:email'],
  detailsShared: ['detail:phone'],
  ...more,
});

describe('a grant against the requester’s record', () => {
  it('cannot be checked when the request left no permissions on record', () => {
    expect(trustGrantRefusal({ granted: ['send:invoice'] }, { status: 'pending' })).toEqual({
      error: BTP_ERROR_PERMISSION_REQUIRED,
      problem: 'the request has no permissions on record, so required ones cannot be checked',
    });
  });

  it('is taken by an accepted trust only while a change is pending', () => {
    const record = { status: 'accepted' as const, permissions: permissions() };
    expect(trustGrantProblem({ granted: ['send:invoice'] }, record)).toBe(
      'an accepted trust takes an answer only while a change is pending',
    );
  });

  it('is said by name too: what is required, and what was never asked', () => {
    const record = { status: 'pending' as const, permissions: permissions() };
    expect(trustGrantProblem({ granted: [] }, record)).toBe('send:invoice is required');
    expect(trustGrantProblem({ granted: ['send:invoice', 'send:letter'] }, record)).toBe(
      'send:letter was not asked for',
    );
    expect(trustGrantProblem({ granted: ['send:invoice'] }, record)).toBeUndefined();
    expect(trustGrantProblem({}, record)).toBeUndefined();
  });

  it('saves nothing by name for an answer that grants nothing, or a request without permissions', () => {
    expect(
      trustPermissionsFromResponse({}, { permissions: permissions().requested }),
    ).toBeUndefined();
    expect(trustPermissionsFromResponse({ granted: ['send:invoice'] }, {})).toBeUndefined();
  });
});

describe('a send under a trust with permissions', () => {
  const record = { permissions: permissions() };

  it('names its documentType', () => {
    expect(documentTypeRefusal({ type: 'BTPS_DOC', document: 'sealed' }, record)).toEqual({
      error: BTP_ERROR_PERMISSION,
      problem: 'a send under a trust with permissions names its documentType',
    });
  });

  it('is, when readable, the type its envelope names', () => {
    const artifact = {
      type: 'BTPS_DOC',
      documentType: 'invoice',
      encryption: null,
      document: { type: 'receipt' },
    };
    expect(documentTypeRefusal(artifact, record)).toEqual({
      error: BTP_ERROR_DOCUMENT_TYPE_MISMATCH,
      problem: 'the document is a receipt, not the invoice its envelope names',
    });
    expect(
      documentTypeProblem({ ...artifact, document: { type: 'invoice' } }, record),
    ).toBeUndefined();
    // Encrypted, its type is checked once it is opened.
    expect(
      documentTypeProblem({ ...artifact, encryption: { algorithm: 'aes-256-gcm' } }, record),
    ).toBeUndefined();
  });
});

describe('a details artifact', () => {
  const request: BTPDetailsEnvelope = {
    type: 'DETAILS_REQ',
    id: 'req-1',
    from: CLIENT,
    to: VENDOR,
    details: ['detail:email'],
  };
  const response = (more: Partial<BTPDetailsEnvelope> = {}): BTPDetailsEnvelope => ({
    type: 'DETAILS_RES',
    id: 'res-1',
    from: VENDOR,
    to: CLIENT,
    relatesTo: 'req-1',
    details: ['detail:email'],
    ...more,
  });

  it('names only details its trust holds, each way', () => {
    expect(detailsNamesRefusal(response(), {})).toEqual({
      error: BTP_ERROR_DETAILS_NOT_HELD,
      problem: 'a trust without permissions holds no details by name',
    });
    expect(
      detailsNamesRefusal({ ...request, details: ['detail:dob'] }, { permissions: permissions() })
        ?.problem,
    ).toBe('detail:dob is not a detail the answerer shares by this trust');
    expect(
      detailsNamesRefusal(response({ details: ['detail:dob'] }), { permissions: permissions() })
        ?.problem,
    ).toBe('detail:dob is not a detail the receiver holds by this trust');
    expect(detailsNamesRefusal({ ...request, type: 'BTPS_DOC' }, {})).toBeUndefined();
  });

  it('as a response, answers the request its receiver sent to its sender, asking nothing more', () => {
    const refused = (problem: string) => ({ error: BTP_ERROR_PERMISSION, problem });
    expect(detailsRequestRefusal(response())).toEqual(
      refused('a details response answers a request its receiver sent'),
    );
    expect(detailsRequestRefusal(response({ relatesTo: 'req-2' }), request)).toEqual(
      refused('a details response answers the request it names'),
    );
    expect(detailsRequestRefusal(response(), { ...request, type: 'DETAILS_CHANGED' })).toEqual(
      refused('a details response answers the request it names'),
    );
    expect(detailsRequestRefusal(response(), { ...request, from: 'eve$client.example' })).toEqual(
      refused('a details response answers a request its receiver sent to its sender'),
    );
    expect(detailsRequestRefusal(response({ details: ['detail:phone'] }), request)).toEqual(
      refused('detail:phone was not asked for'),
    );
    expect(detailsRequestRefusal(response(), request)).toBeUndefined();
    expect(detailsRequestRefusal(request, request)).toBeUndefined();
  });

  it('is said by name in one check: its names, its request, and an opened response’s values', () => {
    const record = { permissions: permissions() };
    expect(detailsProblem(response(), {}, request)).toBe(
      'a trust without permissions holds no details by name',
    );
    expect(detailsProblem(response(), record)).toBe(
      'a details response answers a request its receiver sent',
    );
    expect(detailsProblem(response(), record, request)).toBeUndefined();
    // Opened, its values are checked against its names.
    expect(detailsProblem(response({ document: { details: {} } }), record, request)).toBeDefined();
  });
});
