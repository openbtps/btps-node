/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: one `keyResolver` option finds every key, so a provider can put
 * its own cache in front of it. It is asked for a key and what the key is for:
 * `verify` (a signature key) or `encrypt` (a receiver's key). Without it, each
 * lookup is today's: a signature key from DNS only, a receiver's key from DNS
 * and then the receiver's host. The `it.fails` cases pass once 1.2 lands.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTxt } from 'dns/promises';
import { EventEmitter } from 'events';
import { generateKeyPairSync } from 'crypto';
import tls from 'tls';
import { BtpsServer } from '../btpsServer.js';
import { BtpsClient } from '../../client/btpsClient.js';
import JsonTrustStore from '@core/trust/storage/JsonTrustStore.js';
import { signBtpPayload } from '@core/crypto/index.js';
import { signEncrypt, type ReceiverKeyLookup } from '@core/crypto/signEncrypt.js';
import type { BtpsServerOptions } from '../types.js';
import type { BTPInvoiceDoc, BTPServerResponse, BTPTransporterArtifact } from '../index.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));
const dns = vi.mocked(resolveTxt);

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const sender = keyPair();
const receiver = keyPair();
const issuedAt = new Date().toISOString();
const invoice: BTPInvoiceDoc = {
  type: 'invoice',
  title: 'October',
  id: 'INV-1',
  issuedAt,
  totalAmount: { amount: 150000, currency: 'AUD' },
  lineItems: { columns: ['Item', 'Amount'], rows: [{ Item: 'Website build', Amount: 150000 }] },
};

const signedArtifact = (): BTPTransporterArtifact => {
  const unsigned: Omit<BTPTransporterArtifact, 'signature'> = {
    version: '1.1.0',
    id: 'artifact-1',
    issuedAt,
    type: 'BTPS_DOC',
    from: 'alice$vendor.example',
    to: 'pay$client.example',
    selector: 'btps1',
    document: invoice,
    encryption: null,
  };
  return { ...unsigned, signature: signBtpPayload(unsigned, sender) };
};

const resolverReturning = (publicKey: string) => ({
  resolvePublicKey: vi.fn(async (_identity: string, _selector: string, _use: string) => publicKey),
});

const notFound = () => Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });

describe('finding keys', () => {
  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockReturnValue(new EventEmitter() as unknown as tls.Server);
    dns.mockReset();
    dns.mockRejectedValue(notFound());
  });

  afterEach(() => vi.restoreAllMocks());

  const serverWith = (more: object = {}) => {
    const options: BtpsServerOptions = {
      serverIdentity: { identity: 'host$client.example', publicKey: 'pub', privateKey: 'priv' },
      trustStore: new JsonTrustStore({ connection: 'unused-trust-store.json' }),
      tlsOptions: { key: 'test-key', cert: 'test-cert' },
      ...more,
    };
    return new BtpsServer(options);
  };

  it('a server finds a sender key in DNS only, never asking a host', async () => {
    const connect = vi.spyOn(tls, 'connect');
    const { isValid } = await serverWith()['verifySignature']({
      type: 'transporter',
      artifact: signedArtifact(),
    });

    expect(isValid).toBe(false);
    expect(dns).toHaveBeenCalledWith('btps1._btps.identity.alice.vendor.example');
    expect(connect).not.toHaveBeenCalled();
  });

  it.fails("a server asks its keyResolver for the sender's signature key", async () => {
    const keyResolver = resolverReturning(sender.publicKey);
    const { isValid } = await serverWith({ keyResolver })['verifySignature']({
      type: 'transporter',
      artifact: signedArtifact(),
    });

    expect(keyResolver.resolvePublicKey).toHaveBeenCalledWith(
      'alice$vendor.example',
      'btps1',
      'verify',
    );
    expect(isValid).toBe(true);
    expect(dns).not.toHaveBeenCalled();
  });

  it.fails("a client asks its keyResolver for the key of a server's signed answer", async () => {
    const keyResolver = resolverReturning(sender.publicKey);
    const options = { to: 'alice$vendor.example', keyResolver };
    const client = new BtpsClient(options);
    const unsigned: Omit<BTPServerResponse, 'signature'> = {
      version: '1.1.0',
      id: 'answer-1',
      issuedAt,
      type: 'btps_response',
      status: { ok: true, code: 200 },
      signedBy: 'server$vendor.example',
      selector: 'server1',
    };
    const { isValid } = await client['verifyServerMessage']({
      ...unsigned,
      signature: signBtpPayload(unsigned, sender),
    });
    client.destroy();

    expect(keyResolver.resolvePublicKey).toHaveBeenCalledWith(
      'server$vendor.example',
      'server1',
      'verify',
    );
    expect(isValid).toBe(true);
  });

  it.fails("signEncrypt asks the keyResolver for the receiver's encryption key", async () => {
    // The receiver's host record is DNS's alone: it names the selector to ask for.
    dns.mockImplementation(async (name: string) => {
      if (name === '_btps.host.client.example')
        return [['v=1.1.0; u=btps.client.example; s=btps1']];
      throw notFound();
    });
    const keyResolver = resolverReturning(receiver.publicKey);
    const withResolver = { btpMtsOptions: {}, keyResolver };
    const lookup: ReceiverKeyLookup = withResolver;
    const { payload, error } = await signEncrypt(
      'pay$client.example',
      { accountName: 'alice', domainName: 'vendor.example', pemFiles: sender },
      {
        version: '1.1.0',
        type: 'BTPS_DOC',
        from: 'alice$vendor.example',
        to: 'pay$client.example',
        selector: 'btps1',
        document: invoice,
      },
      {
        signature: { algorithmHash: 'sha256' },
        encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
      },
      lookup,
    );

    expect(error).toBeUndefined();
    expect(keyResolver.resolvePublicKey).toHaveBeenCalledWith(
      'pay$client.example',
      'btps1',
      'encrypt',
    );
    expect(payload?.encryption).not.toBeNull();
  });
});
