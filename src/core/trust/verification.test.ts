/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: verification. A provider signs what it checked of a sender; the
 * receiver gets facts, never a verdict.
 */

import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { resolveTxt } from 'dns/promises';
import { signVerification, verificationFacts, verifierRefusal } from './verification.js';
import { trustRequestProblem } from '../server/schemas/trustValues.js';
import { BtpTransporterArtifactSchema } from '../server/schemas/artifacts/transporterSchema.js';
import { pemToBase64 } from '../utils/index.js';
import { PemSigner } from '../crypto/index.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const operatorKeys = keyPair();
const ownKeys = keyPair();

// acme.example is hosted by the SaaS, which it names as its operator.
vi.mocked(resolveTxt).mockImplementation(async (name: string) => {
  const records: Record<string, string> = {
    '_btps.host.acme.example': 'v=1.2.0; u=btps.saas.example:3443; s=btps1; op=admin$saas.example',
    '_btps.host.saas.example': 'v=1.2.0; u=btps.saas.example:3443; s=btps1; op=admin$saas.example',
    '_btps.host.idcheck.example':
      'v=1.2.0; u=btps.idcheck.example:3443; s=btps1; op=admin$idcheck.example',
    '_btps.host.self.example': 'v=1.2.0; u=btps.self.example:3443; s=btps1; op=me$self.example',
    'btps1._btps.identity.admin.saas.example': `v=1.2.0; k=rsa; p=${pemToBase64(operatorKeys.publicKey)}`,
    'btps1._btps.identity.verify.saas.example': `v=1.2.0; k=rsa; p=${pemToBase64(operatorKeys.publicKey)}`,
    'btps1._btps.identity.billing.acme.example': `v=1.2.0; k=rsa; p=${pemToBase64(ownKeys.publicKey)}`,
  };
  if (records[name]) return [[records[name]]];
  // A lookup that fails, rather than a domain without the record.
  const failure = {
    '_btps.host.flaky.example': 'ESERVFAIL',
    '_btps.host.slow.example': 'ETIMEOUT',
  }[name];
  if (failure) throw Object.assign(new Error(`queryTxt ${failure} ${name}`), { code: failure });
  throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
});

const sender = 'billing$acme.example';
const claims = {
  entityType: 'organisation' as const,
  'detail:legalName': 'Acme Pty Ltd',
  'detail:registrationNumber': { number: '51824753556', country: 'AU' },
};
const statement = {
  subject: sender,
  claims,
  verifiedAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2027-11-01T00:00:00.000Z',
};
const now = Date.parse('2026-11-07T00:00:00.000Z');
const byOperator = () =>
  signVerification(statement, {
    verifiedBy: 'admin$saas.example',
    selector: 'btps1',
    pemFiles: operatorKeys,
  });
const request = (verification: object, from = sender) => ({
  from,
  document: {
    id: 'req-1',
    name: 'Acme Pty Ltd',
    email: 'a@acme.example',
    reason: 'r',
    phone: '1',
    verification,
  },
});

describe('a verification', () => {
  it("signed by the sender's operator: every fact holds, and nothing is refused", async () => {
    const facts = await verificationFacts(request(await byOperator()), { now });
    expect(facts).toEqual({
      signatureValid: true,
      expired: false,
      verifierServesSender: true,
      verifierIsOperator: true,
    });
  });

  it('signed with a key held elsewhere, a signer: the same facts as with its own key', async () => {
    const verification = await signVerification(statement, {
      verifiedBy: 'admin$saas.example',
      selector: 'btps1',
      signer: new PemSigner(operatorKeys),
    });
    expect(await verificationFacts(request(verification), { now })).toMatchObject({
      signatureValid: true,
      verifierIsOperator: true,
    });
  });

  it("by another identity on the operator's domain: it serves the sender, but is not the operator", async () => {
    const verification = await signVerification(statement, {
      verifiedBy: 'verify$saas.example',
      selector: 'btps1',
      pemFiles: operatorKeys,
    });
    const facts = await verificationFacts(request(verification), { now });
    expect(facts).toMatchObject({ verifierServesSender: true, verifierIsOperator: false });
  });

  it('signed by the sender for itself: a valid signature, from neither', async () => {
    const verification = await signVerification(statement, {
      verifiedBy: sender,
      selector: 'btps1',
      pemFiles: ownKeys,
    });
    const facts = await verificationFacts(request(verification), { now });
    expect(facts).toEqual({
      signatureValid: true,
      expired: false,
      verifierServesSender: false,
      verifierIsOperator: false,
    });
  });

  it("copied into someone else's request: its signature does not hold", async () => {
    const facts = await verificationFacts(request(await byOperator(), 'other$acme.example'), {
      now,
    });
    expect(facts?.signatureValid).toBe(false);
  });

  it('with its claims changed: its signature does not hold', async () => {
    const verification = await byOperator();
    const changed = { ...verification, claims: { ...claims, 'detail:legalName': 'Other Pty Ltd' } };
    expect((await verificationFacts(request(changed), { now }))?.signatureValid).toBe(false);
  });

  it('past its expiresAt: expired, and still only a fact', async () => {
    const later = Date.parse('2028-01-01T00:00:00.000Z');
    expect((await verificationFacts(request(await byOperator()), { now: later }))?.expired).toBe(
      true,
    );
  });

  it('absent: no facts', async () => {
    expect(await verificationFacts({ from: sender, document: { id: 'req-1' } })).toBeUndefined();
  });
});

describe('a verifier', () => {
  it('may not be a customer address on a SaaS: it runs no BTPS server', async () => {
    expect(await verifierRefusal('jane$saas.example')).toEqual({
      error: expect.objectContaining({ code: 'BTP_ERROR_VALIDATION' }),
      problem:
        'the verifier does not run a BTPS server: jane$saas.example is not the operator of saas.example',
    });
  });

  it("may be the SaaS's own operator", async () => {
    expect(await verifierRefusal('admin$saas.example')).toBeUndefined();
  });

  it('may be another operator, an identity-check service running its own server', async () => {
    expect(await verifierRefusal('admin$idcheck.example')).toBeUndefined();
  });

  it('may be a self-hoster who is its own operator', async () => {
    expect(await verifierRefusal('me$self.example')).toBeUndefined();
  });

  it('may not be an address whose domain runs no BTPS server', async () => {
    expect((await verifierRefusal('jane$nowhere.example'))?.problem).toMatch(
      /jane\$nowhere\.example is not the operator of nowhere\.example/,
    );
  });

  it('is not judged when the lookup itself fails: a DNS error to try again', async () => {
    for (const domain of ['flaky.example', 'slow.example']) {
      expect(await verifierRefusal(`admin$${domain}`)).toEqual({
        error: expect.objectContaining({ code: 'BTP_ERROR_RESOLVE_DNS' }),
        problem: `could not look up ${domain}'s BTPS host record; try again`,
      });
    }
  });
});

describe("a verification's shape, in the opened request", () => {
  it('is taken with protocol names only', async () => {
    expect(trustRequestProblem(request(await byOperator()))).toBeUndefined();
  });

  it('is refused naming anything else, or with a value of the wrong shape', async () => {
    const verification = await byOperator();
    const other = { ...verification, claims: { ...claims, 'au:abn': '51824753556' } };
    const shape = {
      ...verification,
      claims: { ...claims, 'detail:registrationNumber': '51824753556' },
    };
    expect(trustRequestProblem(request(other))).toMatch(/verification is not well formed/);
    expect(trustRequestProblem(request(shape))).toMatch(/verification is not well formed/);
  });

  it('is refused unencrypted, as values always are', async () => {
    const artifact = {
      version: '1.2.0',
      issuedAt: '2026-11-07T00:00:00.000Z',
      id: 'artifact-1',
      type: 'TRUST_REQ',
      from: sender,
      to: 'pay$client.example',
      selector: 'btps1',
      signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
      encryption: null,
      document: request(await byOperator()).document,
    };
    expect(BtpTransporterArtifactSchema.safeParse(artifact).success).toBe(false);
  });
});
