/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: every combination of the 13 permission names, against the real
 * permission code. For each of the 2^13 grants, every send and every details
 * refresh is taken exactly when its name was granted; a required name withheld
 * refuses the grant, an optional one is a partial grant; and a request is
 * shaped for 1.1 by leaving out exactly what 1.1 cannot carry. The cases are
 * generated, never listed by hand.
 */

import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_TYPES,
  DETAIL_PERMISSIONS,
  ENTITY_TYPES,
  IDENTITY_DETAIL,
  SEND_PERMISSIONS,
} from '@core/server/constants/permissions.js';
import { BtpTransporterArtifactSchema } from '@core/server/schemas/artifacts/transporterSchema.js';
import {
  detailsNamesRefusal,
  documentTypeRefusal,
  trustGrantRefusal,
  trustPermissionsFromRequest,
  trustPermissionsFromResponse,
} from './permissions.js';
import { shapeTrustRequestFor11 } from './shaping.js';
import type { BTPDetailPermission, BTPPermissionName } from '@core/server/types.js';

const NAMES: readonly BTPPermissionName[] = [...SEND_PERMISSIONS, ...DETAIL_PERMISSIONS];
const REQUESTER = 'billing$vendor.example';
const RESPONDER = 'pay$client.example';
const ISSUED_AT = '2026-11-07T00:00:00.000Z';

/** Every subset of `items`, as the bits of 0 .. 2^n - 1 choose them. */
const subsets = <T>(items: readonly T[]): T[][] =>
  Array.from({ length: 2 ** items.length }, (_, mask) =>
    items.filter((_item, i) => (mask >> i) & 1),
  );

const GRANTS = subsets(NAMES);
const asked = (required: readonly BTPPermissionName[] = []) =>
  NAMES.map((name) => ({ name, required: required.includes(name) }));

/** Both records once a request for all 13 names, optional, is answered with `granted`. */
const recordsFor = (granted: readonly BTPPermissionName[], given: BTPDetailPermission[] = []) => {
  const records = trustPermissionsFromResponse({ granted }, { permissions: asked(), given });
  if (!records) throw new Error('an answer with granted names gives both records');
  return records;
};

const send = (documentType: string) => ({
  type: 'BTPS_DOC',
  documentType,
  document: { type: documentType },
});
const refresh = (type: string, from: string, to: string, name: string) => ({
  type,
  from,
  to,
  details: [name],
});

describe('every grant of the 13 permission names', () => {
  it('takes each send exactly when its send: name is granted, a letter never covering an agreement', () => {
    expect(GRANTS).toHaveLength(8192);
    for (const granted of GRANTS) {
      const { responder } = recordsFor(granted);
      for (const type of DOCUMENT_TYPES) {
        const refused = documentTypeRefusal(send(type), { permissions: responder });
        expect(refused === undefined, `${type} under [${granted.join(', ')}]`).toBe(
          granted.includes(`send:${type}`),
        );
      }
    }
  });

  it('takes each detail asked for, or told of, exactly when its name is granted', () => {
    for (const granted of GRANTS) {
      const { requester, responder } = recordsFor(granted);
      for (const name of DETAIL_PERMISSIONS) {
        const holds = granted.includes(name);
        // The requester asks the responder for a detail the grant shares.
        const asking = detailsNamesRefusal(refresh('DETAILS_REQ', REQUESTER, RESPONDER, name), {
          permissions: responder,
        });
        // The responder tells, and answers with, a detail the requester holds.
        const told = detailsNamesRefusal(refresh('DETAILS_CHANGED', RESPONDER, REQUESTER, name), {
          permissions: requester,
        });
        const answered = detailsNamesRefusal(refresh('DETAILS_RES', RESPONDER, REQUESTER, name), {
          permissions: requester,
        });
        const label = `${name} under [${granted.join(', ')}]`;
        expect(asking === undefined, label).toBe(holds);
        expect(told === undefined, label).toBe(holds);
        expect(answered === undefined, label).toBe(holds);
      }
    }
  });

  it('takes each detail the requester gave, in the other direction, exactly when it was given', () => {
    for (const given of subsets(DETAIL_PERMISSIONS)) {
      const { requester, responder } = recordsFor([], given);
      for (const name of DETAIL_PERMISSIONS) {
        const gave = given.includes(name);
        const asking = detailsNamesRefusal(refresh('DETAILS_REQ', RESPONDER, REQUESTER, name), {
          permissions: requester,
        });
        const told = detailsNamesRefusal(refresh('DETAILS_CHANGED', REQUESTER, RESPONDER, name), {
          permissions: responder,
        });
        expect(asking === undefined, `${name} given [${given.join(', ')}]`).toBe(gave);
        expect(told === undefined, `${name} given [${given.join(', ')}]`).toBe(gave);
      }
    }
  });

  it('is a partial grant when every name is optional', () => {
    const record = {
      status: 'pending' as const,
      permissions: trustPermissionsFromRequest({ permissions: asked(), issuedAt: ISSUED_AT }),
    };
    for (const granted of GRANTS) {
      expect(trustGrantRefusal({ granted }, record), `[${granted.join(', ')}]`).toBeUndefined();
    }
  });

  it('is refused exactly when it withholds a required name', () => {
    for (const required of NAMES) {
      const record = {
        status: 'pending' as const,
        permissions: trustPermissionsFromRequest({
          permissions: asked([required]),
          issuedAt: ISSUED_AT,
        }),
      };
      for (const granted of GRANTS) {
        const refusal = trustGrantRefusal({ granted }, record);
        expect(refusal?.error.code, `${required} required, [${granted.join(', ')}]`).toBe(
          granted.includes(required) ? undefined : 'BTP_ERROR_PERMISSION_REQUIRED',
        );
      }
    }
  });

  it('is refused when it grants a name that was not asked for', () => {
    for (const name of NAMES) {
      const record = {
        status: 'pending' as const,
        permissions: trustPermissionsFromRequest({
          permissions: asked().filter((permission) => permission.name !== name),
          issuedAt: ISSUED_AT,
        }),
      };
      expect(trustGrantRefusal({ granted: [name] }, record)?.error.code).toBe(
        'BTP_ERROR_PERMISSION',
      );
    }
  });
});

describe('every grant and request on the envelope, for each kind of address', () => {
  // Encrypted, so only the envelope is read.
  const envelope = (type: 'TRUST_REQ' | 'TRUST_RES', more: object) => ({
    version: '1.2.0',
    issuedAt: ISSUED_AT,
    id: '1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8',
    type,
    from: type === 'TRUST_REQ' ? REQUESTER : RESPONDER,
    to: type === 'TRUST_REQ' ? RESPONDER : REQUESTER,
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
  const takes = (artifact: object) => BtpTransporterArtifactSchema.safeParse(artifact).success;

  it("grants any names but the other kind's own identity detail", () => {
    for (const entityType of ENTITY_TYPES) {
      const other = IDENTITY_DETAIL[entityType === 'person' ? 'organisation' : 'person'];
      for (const granted of GRANTS.filter((names) => names.length > 0)) {
        expect(
          takes(envelope('TRUST_RES', { granted, entityType })),
          `${entityType} granting [${granted.join(', ')}]`,
        ).toBe(!granted.includes(other));
      }
    }
  });

  it('asks for details only by giving each in return, a date of birth and a registration number swapping', () => {
    for (const entityType of ENTITY_TYPES) {
      const gives = (name: BTPDetailPermission) =>
        (Object.values(IDENTITY_DETAIL) as string[]).includes(name)
          ? IDENTITY_DETAIL[entityType]
          : name;
      for (const details of subsets(DETAIL_PERMISSIONS).filter((names) => names.length > 0)) {
        const permissions = [
          { name: 'send:invoice', required: true },
          ...details.map((name) => ({ name, required: false })),
        ];
        const owed = [...new Set(details.map(gives))];
        const request = (given: string[]) =>
          envelope('TRUST_REQ', { permissions, entityType, given });
        const label = `${entityType} asking [${details.join(', ')}]`;

        expect(takes(request(owed)), label).toBe(true);
        for (const left of owed) {
          expect(
            takes(request(owed.filter((name) => name !== left))),
            `${label} without ${left}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe('every trust request, shaped for a 1.1 receiver', () => {
  // What 1.1 itself carries, kept; what 1.2 adds, each present or not.
  const own11 = { id: 'req-1', name: 'Vendor', email: 'billing@vendor.example', reason: 'Bills' };
  const ADDED = ['given', 'entityType', 'change', 'own', 'verification'] as const;

  it('leaves out exactly the 1.2 fields it carries, and goes as 1.1.0', () => {
    const extras = subsets(ADDED);
    GRANTS.forEach((requested, i) => {
      // Each requested set meets a different mix of the other 1.2 fields, so all of them occur.
      const present = extras[i % extras.length]!;
      const document: Record<string, unknown> = { ...own11 };
      if (present.includes('own')) document.own = { 'detail:email': 'billing@vendor.example' };
      if (present.includes('verification')) document.verification = { claims: [] };
      const payload = {
        version: '1.2.0',
        type: 'TRUST_REQ',
        ...(requested.length > 0 && {
          permissions: requested.map((name) => ({ name, required: false })),
        }),
        ...(present.includes('given') && { given: ['detail:email'] }),
        ...(present.includes('entityType') && { entityType: 'organisation' }),
        ...(present.includes('change') && { change: true }),
        document,
      };

      const { payload: shaped, shaped: report } = shapeTrustRequestFor11(payload);

      const expected = [
        ...(requested.length > 0 ? ['permissions'] : []),
        ...ADDED.filter((field) => present.includes(field)),
      ];
      expect(new Set(report.leftOut), `[${requested.join(', ')}] with ${present}`).toEqual(
        new Set(expected),
      );
      expect(report.sentAs).toBe('1.1.0');
      expect(shaped).not.toHaveProperty('permissions');
      expect(shaped.document).toEqual(own11);
    });
  });
});
