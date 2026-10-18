/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// A business on its own domain, hosted by a SaaS: its user's key signs the
// delegation and the SaaS, its domain's operator, attests it. What
// BtpsDelegator produces must verify on a BtpsServer, end to end.

import { describe, it, expect, vi } from 'vitest';
import net from 'net';
import tls from 'tls';
import { generateKeyPairSync } from 'crypto';
import { resolveTxt } from 'dns/promises';
import { BtpsDelegator } from './BtpsDelegator.js';
import { BtpsServer } from '../../server/btpsServer.js';
import JsonTrustStore from '../trust/storage/JsonTrustStore.js';
import { pemToBase64 } from '../utils/index.js';
import { signBtpPayload } from '../crypto/index.js';
import type { BTPTransporterArtifact } from '../server/types.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const saasKeys = keyPair();
const ownerKeys = keyPair();
const deviceKeys = keyPair();

vi.mocked(resolveTxt).mockImplementation(async (name: string) => {
  const records: Record<string, string> = {
    '_btps.host.saas.test': 'v=1.0.0; u=btps.saas.test:3443; s=btps1; op=admin$saas.test',
    // bobco.test is hosted by the SaaS, which it names as its operator
    '_btps.host.bobco.test': 'v=1.0.0; u=btps.saas.test:3443; s=btps1; op=admin$saas.test',
    'btps1._btps.identity.admin.saas.test': `v=1.0.0; k=rsa; p=${pemToBase64(saasKeys.publicKey)}`,
    'btps1._btps.identity.bob.bobco.test': `v=1.0.0; k=rsa; p=${pemToBase64(ownerKeys.publicKey)}`,
  };
  if (records[name]) return [[records[name]]];
  throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
});

vi.spyOn(tls, 'createServer').mockImplementation(() => net.createServer() as tls.Server);
const server = new BtpsServer({
  serverIdentity: { identity: 'admin$other.test', ...saasKeys },
  trustStore: new JsonTrustStore({ connection: `/tmp/btps-attested-${process.pid}.json` }),
  tlsOptions: { key: 'test-key', cert: 'test-cert' },
});

describe('an attested delegation', () => {
  it('verifies on the server it was made for', async () => {
    const delegator = new BtpsDelegator({
      identity: 'admin$saas.test',
      privateKey: saasKeys.privateKey,
    });
    const unsigned = {
      version: '1.0.0',
      id: 'att-1',
      type: 'BTPS_DOC' as const,
      from: 'bob$bobco.test',
      to: 'alice$other.test',
      issuedAt: new Date().toISOString(),
      encryption: null,
      document: 'document',
      selector: 'btps1',
    };
    const artifact = {
      ...unsigned,
      signature: signBtpPayload(unsigned, deviceKeys),
    } as BTPTransporterArtifact;

    const delegated = await delegator.delegateArtifact('device-1', deviceKeys.publicKey, artifact, {
      identity: 'bob$bobco.test',
      keyPair: ownerKeys,
    });
    expect(delegated.delegation.attestation?.signedBy).toBe('admin$saas.test');

    const result = await server['verifySignature']({ artifact: delegated, type: 'transporter' });

    expect(result.error).toBeUndefined();
    expect(result.isValid).toBe(true);
  });
});
