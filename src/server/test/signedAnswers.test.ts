/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: a device can require that every answer is signed by the signer
 * its provider's app expects. A server with `signAnswers` signs every answer,
 * errors included, as its own identity under its own selector, after the
 * answer's reqId is set. The `it.fails` cases pass once 1.2 lands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTxt } from 'dns/promises';
import { EventEmitter } from 'events';
import { generateKeyPairSync } from 'crypto';
import tls, { type TLSSocket } from 'tls';
import { BtpsServer } from '../btpsServer.js';
import { BtpsClient } from '../../client/btpsClient.js';
import JsonTrustStore from '@core/trust/storage/JsonTrustStore.js';
import { verifySignature } from '@core/crypto/index.js';
import type { BtpsServerOptions } from '../types.js';
import type { BTPServerResponse } from '../index.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));
const dns = vi.mocked(resolveTxt);

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const issuedAt = new Date().toISOString();
const unsignedAnswer: BTPServerResponse = {
  version: '1.1.0',
  id: 'answer-1',
  issuedAt,
  type: 'btps_response',
  reqId: 'req-1',
  status: { ok: true, code: 200 },
};

describe("a server's signed answers", () => {
  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockReturnValue(new EventEmitter() as unknown as tls.Server);
  });

  afterEach(() => vi.restoreAllMocks());

  it.fails('are signed as the server, under its selector, over the answer with its reqId', () => {
    const options: BtpsServerOptions = {
      serverIdentity: {
        identity: 'server$saas.example',
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        ...{ selector: 'server1' },
      },
      trustStore: new JsonTrustStore({ connection: 'unused-trust-store.json' }),
      tlsOptions: { key: 'test-key', cert: 'test-cert' },
      ...{ signAnswers: true },
    };
    const written: string[] = [];
    const socket = {
      destroyed: false,
      writableEnded: false,
      writable: true,
      write: (line: string) => written.push(line) > 0,
      destroy: vi.fn(),
      end: vi.fn(),
    } as unknown as TLSSocket;
    new BtpsServer(options)['sendBtpsResponse'](socket, unsignedAnswer);

    const sent: BTPServerResponse = JSON.parse(written[0] ?? 'null');
    expect(sent).toMatchObject({
      reqId: 'req-1',
      signedBy: 'server$saas.example',
      selector: 'server1',
    });
    const { signature, ...signed } = sent;
    expect(signature && verifySignature(signed, signature, keys.publicKey).isValid).toBe(true);
  });
});

describe('a device that requires its server to sign', () => {
  const requireSignedBy = { identity: 'server$saas.example', selector: 'server1' };
  const device = () => new BtpsClient({ to: 'alice$saas.example', ...{ requireSignedBy } });

  beforeEach(() => dns.mockReset());

  it('takes an unsigned answer when it does not require a signature, as 1.1 does', async () => {
    const client = new BtpsClient({ to: 'alice$saas.example' });
    const { isValid } = await client['verifyServerMessage'](unsignedAnswer);
    client.destroy();

    expect(isValid).toBe(true);
  });

  it.fails('refuses an unsigned answer', async () => {
    const client = device();
    const { isValid } = await client['verifyServerMessage'](unsignedAnswer);
    client.destroy();

    expect(isValid).toBe(false);
  });

  it.fails('refuses an answer signed by anyone else, before it looks up a key', async () => {
    const client = device();
    const { isValid } = await client['verifyServerMessage']({
      ...unsignedAnswer,
      signedBy: 'mallory$saas.example',
      selector: 'server1',
      signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
    });
    client.destroy();

    expect(isValid).toBe(false);
    expect(dns).not.toHaveBeenCalled();
  });
});
