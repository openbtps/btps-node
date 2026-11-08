/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: trust permissions in every combination that matters, over real
// servers. A vendor asks a client for all 13 permissions and the client
// grants some; each provider records the trust as a platform does, from the
// request and its answer. On every trust the vendor then tries all 13
// actions: a send of each document type, and a request for each detail.
// Each is taken exactly when its name was granted.
//
// The grants: an all-pairs covering array per kind of client (a person never
// grants a registration number, an organisation never a date of birth), so
// every two names are seen granted together, apart, and withheld; then the
// edge trusts: nothing, everything, sends only, details only, a required
// name withheld, and a change that adds or removes names later.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  addUser,
  artifactFrom,
  deliver,
  invoiceDocument,
  letterDocument,
  payslipDocument,
  receiptDocument,
  recordTrust,
  startProvider,
  type Provider,
  type User,
} from './harness.js';
import { coveringArray, namesOf, uncoveredPairs } from './permissionPairs.js';
import pairs from './permission-pairs.json' with { type: 'json' };
import {
  DETAIL_PERMISSIONS,
  DOCUMENT_TYPES,
  SEND_PERMISSIONS,
} from '../../src/core/server/constants/permissions.js';
import {
  trustPermissionsFromRequest,
  trustPermissionsFromResponse,
} from '../../src/core/trust/permissions.js';
import type {
  BTPDetailPermission,
  BTPPermissionName,
  BTPTrustPermissions,
} from '../../src/core/server/types.js';
import type { BTPTrustRecordPermissions } from '../../src/core/trust/types.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

type Kind = 'person' | 'organisation';

const NAMES: readonly BTPPermissionName[] = [...SEND_PERMISSIONS, ...DETAIL_PERMISSIONS];

// The vendor is an organisation: it gives what it asks for, its registration
// number in place of a date of birth.
const GIVEN: BTPDetailPermission[] = [
  'detail:legalName',
  'detail:profile',
  'detail:email',
  'detail:phone',
  'detail:address',
  'detail:taxNo',
  'detail:registrationNumber',
];
const REQUEST = {
  id: 'req-1',
  name: 'Acme Pty Ltd',
  email: 'billing@acme.example',
  reason: 'To send you invoices',
  phone: '+61 400 000 000',
  address: '1 Kauri Street, Wellington',
  displayName: 'Acme',
  websiteUrl: 'https://vendor.example',
  own: {
    'detail:registrationNumber': { number: '51824753556', country: 'AU' },
    'detail:taxNo': { number: '123456789', country: 'NZ' },
  },
};

// The value the client gives for each detail it grants.
const VALUES: Record<BTPDetailPermission, unknown> = {
  'detail:legalName': 'Robert Smith',
  'detail:profile': { displayName: 'Bob' },
  'detail:email': 'bob@client.example',
  'detail:phone': '+61 400 000 001',
  'detail:address': '2 Rimu Road, Auckland',
  'detail:taxNo': { number: '987654321', country: 'NZ' },
  'detail:dob': '1990-04-21',
  'detail:registrationNumber': { number: '51824753556', country: 'AU' },
};

const agreement = (
  JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../test/vectors/agreements.vectors.json'), 'utf8'),
  ) as { documents: { name: string; expect: string; document: unknown }[] }
).documents.find((c) => c.name === 'agreement' && c.expect === 'accept')!.document;

const DOCUMENTS: Record<(typeof DOCUMENT_TYPES)[number], unknown> = {
  invoice: invoiceDocument(),
  receipt: receiptDocument(),
  payslip: payslipDocument(),
  letter: letterDocument(),
  agreement,
};

const asked = (required: readonly BTPPermissionName[] = []): BTPTrustPermissions =>
  NAMES.map((name) => ({ name, required: required.includes(name) }));

describe('journey: trust permissions in every combination that matters', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let users = 0;

  beforeAll(async () => {
    vendorHost = await startProvider('vendor.test');
    clientHost = await startProvider('client.test');
  });

  afterAll(() => {
    vendorHost.stop();
    clientHost.stop();
  });

  /** Asks for `permissions`, the vendor recording its request as a platform does. Returns what it sent. */
  const ask = async (
    vendor: User,
    client: User,
    permissions: BTPTrustPermissions,
    current?: BTPTrustRecordPermissions,
  ) => {
    const issuedAt = new Date().toISOString();
    const change = current ? { change: true as const } : {};
    await recordTrust(
      vendorHost.trustStore,
      vendor.identity,
      client.identity,
      current ? 'accepted' : 'pending',
      {
        permissions: trustPermissionsFromRequest({ permissions, issuedAt, ...change }, current),
      },
    );
    const request = await artifactFrom(vendor, client.identity, 'TRUST_REQ', REQUEST, {
      extra: { permissions, entityType: 'organisation', given: GIVEN, issuedAt, ...change },
    });
    expect((await deliver(request)).response?.status).toMatchObject({ ok: true });
    return { permissions, given: GIVEN };
  };

  /** Answers `request` granting `granted`; each side records the trust when the answer is taken. */
  const answer = async (
    vendor: User,
    client: User,
    kind: Kind,
    request: { permissions: BTPTrustPermissions; given: BTPDetailPermission[] },
    granted: BTPPermissionName[],
  ) => {
    const details = granted.filter((name): name is BTPDetailPermission =>
      name.startsWith('detail:'),
    );
    const response = await artifactFrom(
      client,
      vendor.identity,
      'TRUST_RES',
      {
        id: 'res-1',
        decision: 'accepted',
        decidedAt: new Date().toISOString(),
        decidedBy: client.identity,
        ...(details.length > 0 && {
          details: Object.fromEntries(details.map((name) => [name, VALUES[name]])),
        }),
      },
      { extra: { granted, entityType: kind } },
    );
    const { response: taken } = await deliver(response);
    if (!taken?.status.ok) return taken;
    const records = trustPermissionsFromResponse({ granted }, request)!;
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted', {
      permissions: records.responder,
    });
    await recordTrust(vendorHost.trustStore, vendor.identity, client.identity, 'accepted', {
      permissions: records.requester,
    });
    return taken;
  };

  const parties = async () => {
    users++;
    return {
      vendor: await addUser(vendorHost, `billing${users}`),
      client: await addUser(clientHost, `pay${users}`),
    };
  };

  /** Tries all 13 actions: true where the client's server took it. */
  const tryAll = async (vendor: User, client: User) => {
    const taken = new Map<BTPPermissionName, boolean>();
    for (const type of DOCUMENT_TYPES) {
      const send = await artifactFrom(vendor, client.identity, 'BTPS_DOC', DOCUMENTS[type], {
        extra: { documentType: type },
      });
      taken.set(`send:${type}`, (await deliver(send)).response?.status.ok === true);
    }
    for (const name of DETAIL_PERMISSIONS) {
      const ask = await artifactFrom(
        vendor,
        client.identity,
        'DETAILS_REQ',
        {},
        {
          extra: { details: [name] },
        },
      );
      taken.set(name, (await deliver(ask)).response?.status.ok === true);
    }
    return taken;
  };

  const expectExactly = (taken: Map<BTPPermissionName, boolean>, granted: BTPPermissionName[]) => {
    for (const name of NAMES) {
      expect(taken.get(name), `${name} under [${granted.join(', ')}]`).toBe(granted.includes(name));
    }
  };

  it('proves its grants cover every pair of names, all four ways, for each kind', () => {
    for (const kind of ['person', 'organisation'] as const) {
      const { names, grants } = pairs[kind];
      expect(grants).toEqual(coveringArray(names.length));
      expect(uncoveredPairs(grants, names.length)).toEqual([]);
    }
  });

  for (const kind of ['person', 'organisation'] as const) {
    const { names, grants } = pairs[kind] as { names: BTPPermissionName[]; grants: number[] };
    const edges: [string, BTPPermissionName[]][] = [
      ['nothing', []],
      ['everything it can', names],
      ['sends only', names.filter((name) => name.startsWith('send:'))],
      ['details only', names.filter((name) => name.startsWith('detail:'))],
    ];

    describe(`a ${kind} client`, () => {
      for (const grant of grants) {
        const granted = namesOf(grant, names);
        it(`takes exactly what it granted: [${granted.join(', ')}]`, async () => {
          const { vendor, client } = await parties();
          const request = await ask(vendor, client, asked());
          expect((await answer(vendor, client, kind, request, granted))?.status.ok).toBe(true);
          expectExactly(await tryAll(vendor, client), granted);
        });
      }

      for (const [label, granted] of edges) {
        it(`takes exactly what it granted: ${label}`, async () => {
          const { vendor, client } = await parties();
          const request = await ask(vendor, client, asked());
          expect((await answer(vendor, client, kind, request, granted))?.status.ok).toBe(true);
          expectExactly(await tryAll(vendor, client), granted);
        });
      }

      it('is refused a grant that withholds a required name, and nothing is taken', async () => {
        const { vendor, client } = await parties();
        const request = await ask(vendor, client, asked(['send:invoice']));
        const refused = await answer(vendor, client, kind, request, ['send:receipt']);
        expect(refused?.status.ok).toBe(false);
        expectExactly(await tryAll(vendor, client), []);
      });

      it('takes what a later change adds, and stops taking what it removes', async () => {
        const { vendor, client } = await parties();
        const first = await ask(vendor, client, asked());
        await answer(vendor, client, kind, first, ['send:invoice']);
        expectExactly(await tryAll(vendor, client), ['send:invoice']);

        const current = (await vendorHost.trustStore.getAll()).find(
          (record) => record.senderId === vendor.identity,
        )?.permissions;
        const added = await ask(vendor, client, asked(), current);
        const more: BTPPermissionName[] = ['send:invoice', 'send:letter', 'detail:email'];
        expect((await answer(vendor, client, kind, added, more))?.status.ok).toBe(true);
        expectExactly(await tryAll(vendor, client), more);

        const now = (await vendorHost.trustStore.getAll()).find(
          (record) => record.senderId === vendor.identity,
        )?.permissions;
        const removed = await ask(vendor, client, asked(), now);
        expect((await answer(vendor, client, kind, removed, ['send:letter']))?.status.ok).toBe(
          true,
        );
        expectExactly(await tryAll(vendor, client), ['send:letter']);
      });
    });
  }
});
