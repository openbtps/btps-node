/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: finding someone's key. DNS first; for an address whose key only its
// host keeps, the host answers, signed by the domain's operator. The records
// are read in their published text form.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { BtpsClient } from '../../src/client/btpsClient.js';
import { getBTPKeyPair } from '../../src/core/crypto/index.js';
import { getHostAndSelector, pemToBase64, resolvePublicKey } from '../../src/core/utils/index.js';
import { BTP_ERROR_IDENTITY_NOT_FOUND } from '../../src/core/error/index.js';
import {
  addUser,
  publishHost,
  publishKey,
  senderTls,
  startProvider,
  type Provider,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const lookup = (identity: string) =>
  new BtpsClient({ to: identity, btpMtsOptions: senderTls, maxRetries: 0 }).resolveIdentity(
    identity,
    'someone$asking.test',
  );

describe('journey: finding an address and its key', () => {
  let saas: Provider;

  beforeAll(async () => {
    saas = await startProvider('saas.test');
  });

  afterAll(() => saas.stop());

  it("reads a domain's host record: version, host, selector and operator", async () => {
    expect(await getHostAndSelector('anyone$saas.test')).toEqual({
      version: '1.1.0',
      host: `localhost:${saas.port}`,
      selector: 'btps1',
      operator: 'admin$saas.test',
    });
  });

  it("finds a key in DNS, including an address with a dot and a 4096-bit key's padding", async () => {
    const large = getBTPKeyPair({ keySize: 4096 });
    publishKey('pat.doe$saas.test', 'btps1', large.publicKey);

    const found = await resolvePublicKey('pat.doe$saas.test', 'btps1');

    expect(found && pemToBase64(found)).toBe(pemToBase64(large.publicKey));
  });

  it('finds a key only the host keeps, from an answer signed by the domain operator', async () => {
    const managed = await addUser(saas, 'managed', 'host');

    const { response, error } = await lookup(managed.identity);

    expect(error).toBeUndefined();
    expect(pemToBase64(response!.publicKey)).toBe(pemToBase64(managed.keys.publicKey));
  });

  it('refuses a host answer when the domain names a different operator', async () => {
    const managed = await addUser(saas, 'other-op', 'host');
    publishHost('saas.test', { port: saas.port, selector: 'btps1', operator: 'someone$saas.test' });

    const { response, error } = await lookup(managed.identity);
    publishHost('saas.test', { port: saas.port, selector: 'btps1', operator: saas.operator });

    expect(response).toBeUndefined();
    expect(String(error?.cause)).toContain('not by someone$saas.test');
  });

  it('answers "not found" for an address the host does not have', async () => {
    const { response, error } = await lookup('nobody$saas.test');

    expect(response).toBeUndefined();
    expect(error?.code).toBe(BTP_ERROR_IDENTITY_NOT_FOUND.code);
  });

  it('cannot reach a domain that publishes no host record', async () => {
    expect(await getHostAndSelector('anyone$unknown.test')).toBeUndefined();
  });
});
