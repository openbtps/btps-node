/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// A server that signs its answers signs one for every line, a line it cannot
// read included, and a signature can take a while (a key held by a remote
// service). A sender that writes lines it knows are invalid, then goes, must
// not make the server sign far more than it has lines in flight.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import tls from 'tls';
import { PemSigner } from '../../src/core/crypto/index.js';
import { newKeys, senderTls, startProvider, type Provider } from '../e2e/harness.js';

vi.mock('dns/promises', async () => (await import('../e2e/zone.js')).dnsModule);

const IN_FLIGHT = 4;
const INVALID_IN_A_ROW = 5;
const JUNK = 500;
const SIGNING_MS = 5;

describe('a sender that writes only lines a server cannot read', () => {
  let provider: Provider;
  let signed = 0;

  beforeAll(async () => {
    const keys = newKeys();
    const signer = new PemSigner(keys);
    provider = await startProvider('signs.test', {
      server: {
        signAnswers: true,
        serverIdentity: {
          identity: 'admin$signs.test',
          selector: 'btps1',
          signer: {
            algorithm: signer.algorithm,
            getPublicKey: () => signer.getPublicKey(),
            sign: async (data: Uint8Array) => {
              signed++;
              await new Promise((resolve) => setTimeout(resolve, SIGNING_MS));
              return signer.sign(data);
            },
          },
        },
        maxInFlightPerConnection: IN_FLIGHT,
        maxConsecutiveInvalidLines: INVALID_IN_A_ROW,
      },
    });
  });

  afterAll(() => provider.stop());

  it('has the server sign about as many answers as it reads lines before ending the connection', async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = tls.connect({ ...senderTls, host: 'localhost', port: provider.port });
      socket.on('error', reject);
      socket.on('close', () => resolve());
      socket.on('secureConnect', () => {
        socket.write(Array.from({ length: JUNK }, () => 'not json\n').join(''));
        // Gone before most answers could be signed.
        setTimeout(() => socket.destroy(), 50);
      });
    });
    // Whatever the server still had queued has had time to be signed.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(signed).toBeLessThanOrEqual(INVALID_IN_A_ROW + IN_FLIGHT);
  }, 20_000);
});
