/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// A line is checked against the schema of the kind of artifact it is taken
// for, and nothing else: a transporter artifact that also looks like a
// control artifact, or an agent artifact that also looks like an identity
// lookup, is held to every rule of what it is. Real agent artifacts are
// checked in src/client/agentArtifacts.test.ts.

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import net from 'net';
import tls from 'tls';
import { BtpsServer } from '../btpsServer.js';
import JsonTrustStore from '@core/trust/storage/JsonTrustStore.js';

const vectors = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../test/vectors/signed-artifacts.vector.json'),
    'utf8',
  ),
);
const plain = vectors.artifacts.find((c: { name: string }) => c.name === 'plain').artifact;

const serverFor = () => {
  vi.spyOn(tls, 'createServer').mockImplementation(() => net.createServer() as tls.Server);
  return new BtpsServer({
    serverIdentity: { identity: 'admin$saas.test', publicKey: 'pub', privateKey: 'priv' },
    trustStore: new JsonTrustStore({ connection: 'unused-trust-store.json' }),
    tlsOptions: { key: 'test-key', cert: 'test-cert' },
  });
};
const parse = (value: object) => serverFor()['_parseAndValidateArtifact'](JSON.stringify(value));

const meta = {
  version: '1.2.0',
  id: '0f6c1c9e-6f4b-4b8e-9a0e-1d2c3b4a5f60',
  issuedAt: new Date().toISOString(),
};

afterEach(() => vi.restoreAllMocks());

describe('a line is held to the schema of the kind it is', () => {
  it('takes a transporter, a control and an identity lookup artifact', () => {
    expect(parse(plain)).toMatchObject({ data: { type: 'transporter' } });
    expect(parse(plain).error).toBeUndefined();
    expect(parse({ ...meta, action: 'PING' })).toMatchObject({ data: { type: 'control' } });
    expect(parse({ ...meta, action: 'PING' }).error).toBeUndefined();
    const lookup = {
      ...meta,
      identity: 'bob$saas.test',
      from: 'alice$other.test',
      hostSelector: 'btps1',
    };
    expect(parse(lookup)).toMatchObject({ data: { type: 'identityLookup' } });
    expect(parse(lookup).error).toBeUndefined();
  });

  it('refuses a transporter artifact that breaks its rules but also names a control action', () => {
    const broken = { ...plain, document: { not: 'an invoice' } };
    expect(parse(broken).error).toBe('VALIDATION');
    expect(parse({ ...broken, action: 'PING' }).error).toBe('VALIDATION');
  });

  it('refuses an agent artifact that breaks its rules but also names an identity lookup', () => {
    const agent = {
      ...meta,
      action: 'artifact.send',
      agentId: 'btps_ag_device-1',
      to: 'bob$saas.test',
      document: 'not an artifact',
      signature: { algorithmHash: 'sha256', value: 'v', fingerprint: 'f' },
      encryption: null,
    };
    expect(parse(agent).error).toBe('VALIDATION');
    expect(
      parse({
        ...agent,
        identity: 'bob$saas.test',
        from: 'alice$other.test',
        hostSelector: 'btps1',
      }).error,
    ).toBe('VALIDATION');
  });

  it('refuses a control or identity lookup artifact with a member it does not have', () => {
    expect(parse({ ...meta, action: 'PING', extra: true }).error).toBe('VALIDATION');
    const lookup = {
      ...meta,
      identity: 'bob$saas.test',
      from: 'alice$other.test',
      hostSelector: 'btps1',
    };
    expect(parse({ ...lookup, extra: true }).error).toBe('VALIDATION');
  });
});
