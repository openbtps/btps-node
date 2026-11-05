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
 * answer's reqId is set.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTxt } from 'dns/promises';
import { EventEmitter } from 'events';
import { generateKeyPairSync } from 'crypto';
import tls, { type TLSSocket } from 'tls';
import { BtpsServer } from '../btpsServer.js';
import { BtpsClient } from '../../client/btpsClient.js';
import JsonTrustStore from '@core/trust/storage/JsonTrustStore.js';
import { signBtpPayload, verifySignature } from '@core/crypto/index.js';
import { pemToBase64 } from '@core/utils/index.js';
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
  version: '1.2.0',
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

  const options = (more: Partial<BtpsServerOptions> = {}): BtpsServerOptions => ({
    serverIdentity: {
      identity: 'server$saas.example',
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      selector: 'server1',
    },
    trustStore: new JsonTrustStore({ connection: 'unused-trust-store.json' }),
    tlsOptions: { key: 'test-key', cert: 'test-cert' },
    signAnswers: true,
    ...more,
  });

  /** What the server writes for `answer`, once it has been signed. */
  const written = async (server: BtpsServer, answer: BTPServerResponse) => {
    const lines: string[] = [];
    const socket = {
      destroyed: false,
      writableEnded: false,
      writable: true,
      write: (line: string) => lines.push(line) > 0,
      destroy: vi.fn(),
      end: vi.fn(),
    } as unknown as TLSSocket;
    server['sendBtpsResponse'](socket, answer);
    await new Promise((resolve) => setImmediate(resolve));
    return JSON.parse(lines[0] ?? 'null') as BTPServerResponse;
  };

  it('are signed as the server, under its selector, over the answer with its reqId', async () => {
    const sent = await written(new BtpsServer(options()), unsignedAnswer);

    expect(sent).toMatchObject({
      reqId: 'req-1',
      signedBy: 'server$saas.example',
      selector: 'server1',
    });
    const { signature, ...signed } = sent;
    expect(signature && verifySignature(signed, signature, keys.publicKey).isValid).toBe(true);
  });

  it('sign a refusal too, so a device that requires a signature can read it', async () => {
    const refusal: BTPServerResponse = {
      ...unsignedAnswer,
      type: 'btps_error',
      status: { ok: false, code: 403, error: 'BTP_ERROR_TRUST_NOT_ALLOWED' },
    };
    const sent = await written(new BtpsServer(options()), refusal);

    expect(sent.signature).toBeDefined();
    expect(sent.signedBy).toBe('server$saas.example');
  });

  it('are left unsigned, as in 1.1, when the server does not sign answers', async () => {
    const sent = await written(new BtpsServer(options({ signAnswers: false })), unsignedAnswer);

    expect(sent.signature).toBeUndefined();
  });

  it('need the selector the key is published under', () => {
    const { selector: _selector, ...identity } = {
      identity: 'server$saas.example',
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      selector: 'server1',
    };

    expect(() => new BtpsServer(options({ serverIdentity: identity }))).toThrow(/selector/);
  });
});

describe('a device that requires its server to sign', () => {
  const requireSignedBy = { identity: 'server$saas.example', selector: 'server1' };
  const device = () => new BtpsClient({ to: 'alice$saas.example', requireSignedBy });

  beforeEach(() => dns.mockReset());

  it('takes an unsigned answer when it does not require a signature, as 1.1 does', async () => {
    const client = new BtpsClient({ to: 'alice$saas.example' });
    const { isValid } = await client['verifyServerMessage'](unsignedAnswer);
    client.destroy();

    expect(isValid).toBe(true);
  });

  it('refuses an unsigned answer', async () => {
    const client = device();
    const { isValid } = await client['verifyServerMessage'](unsignedAnswer);
    client.destroy();

    expect(isValid).toBe(false);
  });

  it('refuses an answer signed by anyone else, before it looks up a key', async () => {
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

  it('takes an answer its server signed', async () => {
    dns.mockResolvedValue([[`k=rsa; v=1.2.0; p=${pemToBase64(keys.publicKey)}`]]);
    const unsigned = { ...unsignedAnswer, signedBy: 'server$saas.example', selector: 'server1' };
    const client = device();
    const { isValid } = await client['verifyServerMessage']({
      ...unsigned,
      signature: signBtpPayload(unsigned, keys),
    });
    client.destroy();

    expect(isValid).toBe(true);
    expect(dns).toHaveBeenCalledWith('server1._btps.identity.server.saas.example');
  });
});
