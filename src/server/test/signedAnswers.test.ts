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
import { PemSigner, signBtpPayload, verifySignature } from '@core/crypto/index.js';
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
      identity: 'admin$saas.example',
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      selector: 'btps1',
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
      signedBy: 'admin$saas.example',
      selector: 'btps1',
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
    expect(sent.signedBy).toBe('admin$saas.example');
  });

  it('sign that an answer ends the connection, with the rest of it', async () => {
    const lines: string[] = [];
    const socket = {
      destroyed: false,
      writableEnded: false,
      writable: true,
      write: (line: string) => lines.push(line) > 0,
      destroy: vi.fn(),
      end: vi.fn(),
    } as unknown as TLSSocket;
    new BtpsServer(options())['sendBtpsResponse'](socket, unsignedAnswer, 'end');
    await new Promise((resolve) => setImmediate(resolve));

    const { signature, ...signed } = JSON.parse(lines[0] ?? 'null') as BTPServerResponse;
    expect(signed.status.closing).toBe(true);
    expect(signature && verifySignature(signed, signature, keys.publicKey).isValid).toBe(true);
  });

  it('are left unsigned, as in 1.1, when the server does not sign answers', async () => {
    const sent = await written(new BtpsServer(options({ signAnswers: false })), unsignedAnswer);

    expect(sent.signature).toBeUndefined();
  });

  it('need the selector the key is published under', () => {
    const { selector: _selector, ...identity } = {
      identity: 'admin$saas.example',
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      selector: 'btps1',
    };

    expect(() => new BtpsServer(options({ serverIdentity: identity }))).toThrow(/selector/);
  });

  it('go out in order, and a close waits for them, however long a signature takes', async () => {
    // A signer whose first signature comes back after its second.
    const signer = new PemSigner({ publicKey: keys.publicKey, privateKey: keys.privateKey });
    let calls = 0;
    const slowFirst = {
      algorithm: signer.algorithm,
      getPublicKey: () => signer.getPublicKey(),
      sign: async (data: Uint8Array) => {
        calls++;
        if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 50));
        return signer.sign(data);
      },
    };
    const server = new BtpsServer(
      options({
        serverIdentity: { identity: 'admin$saas.example', signer: slowFirst, selector: 'btps1' },
      }),
    );
    const lines: string[] = [];
    const socket = {
      destroyed: false,
      writableEnded: false,
      writable: true,
      write: (line: string) => lines.push(line) > 0,
      destroy: vi.fn(),
      end: vi.fn(() => {
        socket.writableEnded = true;
        socket.writable = false;
      }),
    };
    const tlsSocket = socket as unknown as TLSSocket;

    server['sendBtpsResponse'](tlsSocket, { ...unsignedAnswer, reqId: 'first' });
    server['sendBtpsResponse'](tlsSocket, { ...unsignedAnswer, reqId: 'second' }, 'end');
    await vi.waitFor(() => expect(socket.end).toHaveBeenCalled());

    expect(lines.map((line) => JSON.parse(line).reqId)).toEqual(['first', 'second']);
  });

  it('still go out after one fails, which is reported', async () => {
    const onError = vi.fn();
    const server = new BtpsServer(options({ onError }));
    const signAnswer = server['signAnswer'].bind(server);
    vi.spyOn(server as unknown as { signAnswer: typeof signAnswer }, 'signAnswer')
      .mockRejectedValueOnce(new Error('signing threw'))
      .mockImplementation(signAnswer);
    const lines: string[] = [];
    const socket = {
      destroyed: false,
      writableEnded: false,
      writable: true,
      write: (line: string) => lines.push(line) > 0,
      destroy: vi.fn(),
      end: vi.fn(),
    } as unknown as TLSSocket;

    server['sendBtpsResponse'](socket, { ...unsignedAnswer, reqId: 'first' });
    server['sendBtpsResponse'](socket, { ...unsignedAnswer, reqId: 'second' });
    await vi.waitFor(() => expect(lines).toHaveLength(1));

    expect(JSON.parse(lines[0] ?? 'null').reqId).toBe('second');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('signing threw') }),
    );
  });
});

describe('a device that requires its server to sign', () => {
  const requireSignedBy = { identity: 'admin$saas.example', selector: 'btps1' };
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
      selector: 'btps1',
      signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
    });
    client.destroy();

    expect(isValid).toBe(false);
    expect(dns).not.toHaveBeenCalled();
  });

  it('takes an answer its server signed', async () => {
    dns.mockResolvedValue([[`k=rsa; v=1.2.0; p=${pemToBase64(keys.publicKey)}`]]);
    const unsigned = { ...unsignedAnswer, signedBy: 'admin$saas.example', selector: 'btps1' };
    const client = device();
    const { isValid } = await client['verifyServerMessage']({
      ...unsigned,
      signature: signBtpPayload(unsigned, keys),
    });
    client.destroy();

    expect(isValid).toBe(true);
    expect(dns).toHaveBeenCalledWith('btps1._btps.identity.admin.saas.example');
  });

  it('compares the signer without case, as every identity, and its selector exactly', async () => {
    dns.mockResolvedValue([[`k=rsa; v=1.2.0; p=${pemToBase64(keys.publicKey)}`]]);
    const unsigned = { ...unsignedAnswer, signedBy: 'Admin$SaaS.example', selector: 'btps1' };
    const client = device();
    const signed = { ...unsigned, signature: signBtpPayload(unsigned, keys) };
    const { isValid } = await client['verifyServerMessage'](signed);
    const otherSelector = { ...unsigned, selector: 'BTPS1' };
    const { isValid: underAnother } = await client['verifyServerMessage']({
      ...otherSelector,
      signature: signBtpPayload(otherSelector, keys),
    });
    client.destroy();

    expect(isValid).toBe(true);
    expect(underAnother).toBe(false);
  });

  it('takes an identity-lookup answer on its own connection: the operator is the one signer', async () => {
    // One key pair: the operator signs lookup answers and every other answer alike.
    dns.mockResolvedValue([[`k=rsa; v=1.2.0; p=${pemToBase64(keys.publicKey)}`]]);
    const unsigned = {
      ...unsignedAnswer,
      signedBy: 'admin$saas.example',
      selector: 'btps1',
      document: { selector: 'btps1', publicKey: 'key', keyType: 'rsa' as const, version: '1.2.0' },
    };
    const client = device();
    const { isValid } = await client['verifyServerMessage']({
      ...unsigned,
      signature: signBtpPayload(unsigned, keys),
    });
    client.destroy();

    expect(isValid).toBe(true);
  });
});
