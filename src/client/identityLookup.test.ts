/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// An address with no key in DNS is looked up from its domain's host, end to
// end: a real BtpsServer answers from its identity store, and the client
// verifies the answer against the domain's operator.

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import net, { type AddressInfo } from 'net';
import tls, { type TLSSocket } from 'tls';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { generateKeyPairSync } from 'crypto';
import { resolveTxt } from 'dns/promises';
import { BtpsClient } from './btpsClient.js';
import { BtpsServer } from '../server/btpsServer.js';
import { JsonIdentityStore } from '../core/storage/JsonIdentityStore.js';
import JsonTrustStore from '../core/trust/storage/JsonTrustStore.js';
import { computeId, pemToBase64 } from '../core/utils/index.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

describe('identity lookup through the host', () => {
  const operatorKeys = keyPair();
  const bobKeys = keyPair();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-lookup-'));
  let tcp: net.Server;
  let port = 0;

  // DNS for saas.test: a host record naming its operator, the operator's key,
  // and no record for bob's own key.
  const dnsFor = (operator: string, operatorKeyDelayMs = 0) =>
    vi.mocked(resolveTxt).mockImplementation(async (name: string) => {
      if (name === '_btps.host.saas.test') {
        return [[`v=1.0.0; u=127.0.0.1:${port}; s=btps1; op=${operator}`]];
      }
      if (name === 'btps1._btps.identity.admin.saas.test') {
        await new Promise((resolve) => setTimeout(resolve, operatorKeyDelayMs));
        return [[`k=rsa; v=1.0.0; p=${pemToBase64(operatorKeys.publicKey)}`]];
      }
      throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
    });

  beforeAll(async () => {
    vi.spyOn(tls, 'createServer').mockImplementation(() => net.createServer() as tls.Server);
    const identityStore = new JsonIdentityStore({ connection: path.join(dir, 'identities.json') });
    await identityStore.create(
      {
        identity: 'bob$saas.test',
        currentSelector: 'btps1',
        publicKeys: [
          {
            selector: 'btps1',
            publicKey: bobKeys.publicKey,
            keyType: 'rsa',
            version: '1.0.0',
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
      },
      computeId('bob$saas.test'),
    );
    const server = new BtpsServer({
      serverIdentity: { identity: 'admin$saas.test', ...operatorKeys },
      trustStore: new JsonTrustStore({ connection: path.join(dir, 'trust.json') }),
      identityStore,
      tlsOptions: { key: 'test-key', cert: 'test-cert' },
      connectionTimeoutMs: 2000,
    });
    // TCP stands in for TLS: what is under test is the lookup, not the handshake.
    tcp = net.createServer((socket) => server['handleConnection'](socket as unknown as TLSSocket));
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
    port = (tcp.address() as AddressInfo).port;
    vi.spyOn(tls, 'connect').mockImplementation(
      () => net.connect(port, '127.0.0.1') as unknown as TLSSocket,
    );
  });

  afterEach(() => vi.mocked(resolveTxt).mockReset());

  afterAll(() => {
    tcp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns the key the domain's operator answers with", async () => {
    dnsFor('admin$saas.test');
    const client = new BtpsClient({ to: 'bob$saas.test', connectionTimeoutMs: 2000 });

    const { response, error } = await client.resolveIdentity('bob$saas.test', 'alice$other.test');

    expect(error).toBeUndefined();
    expect(response?.publicKey).toBe(bobKeys.publicKey);
  });

  it('keeps the answer when the host closes the connection while it is being verified', async () => {
    // The host ends the connection as it answers; the operator's key arrives after that.
    dnsFor('admin$saas.test', 200);
    const client = new BtpsClient({ to: 'bob$saas.test', connectionTimeoutMs: 2000 });

    const { response, error } = await client.resolveIdentity('bob$saas.test', 'alice$other.test');

    expect(error).toBeUndefined();
    expect(response?.publicKey).toBe(bobKeys.publicKey);
  });

  it("refuses an answer signed by anyone but the domain's operator", async () => {
    dnsFor('someone$saas.test');
    const client = new BtpsClient({ to: 'bob$saas.test', connectionTimeoutMs: 2000 });

    const { response, error } = await client.resolveIdentity('bob$saas.test', 'alice$other.test');

    expect(response).toBeUndefined();
    expect(String(error?.cause)).toContain('not by someone$saas.test');
  });
});
