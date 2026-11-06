/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: a platform's trust request with permissions, signed with
 * signEncrypt, goes as its receiver's version allows, automatically and never
 * silently.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { signEncrypt } from './signEncrypt.js';
import { BtpsClient } from '../../client/btpsClient.js';

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const sender = { accountName: 'billing', domainName: 'vendor.example', pemFiles: keys };
const request = {
  type: 'TRUST_REQ',
  version: '1.2.0',
  selector: 'btps1',
  from: 'billing$vendor.example',
  to: 'pay$client.example',
  permissions: [{ name: 'send:invoice', required: true }],
  entityType: 'organisation',
  given: [],
  document: {
    id: 'req-1',
    name: 'Acme Pty Ltd',
    email: 'billing@acme.example',
    reason: 'To send you invoices',
    phone: '+61 400 000 000',
  },
};
const options = { signature: { algorithmHash: 'sha256' as const } };
const receiverSpeaks = (version: string) =>
  vi
    .spyOn(BtpsClient.prototype, 'getServerVersion')
    .mockResolvedValue({ version, error: undefined });

beforeEach(() => vi.restoreAllMocks());

describe("a platform's trust request with permissions", () => {
  it('goes as 1.1 allows to a 1.1 receiver, saying what it left out', async () => {
    receiverSpeaks('1.1.3');
    const { payload, shaped, error } = await signEncrypt(
      'pay$client.example',
      sender,
      request,
      options,
    );
    expect(error).toBeUndefined();
    expect(shaped).toEqual({ sentAs: '1.1.0', leftOut: ['permissions', 'given', 'entityType'] });
    expect(payload).toMatchObject({ version: '1.1.0', document: request.document });
    expect(payload).not.toHaveProperty('permissions');
  });

  it('goes as it is to a 1.2 receiver', async () => {
    receiverSpeaks('1.2.0');
    const { payload, shaped } = await signEncrypt('pay$client.example', sender, request, options);
    expect(shaped).toBeUndefined();
    expect(payload).toMatchObject({ version: '1.2.0', permissions: request.permissions });
  });

  it('is refused with versionFallback false', async () => {
    receiverSpeaks('1.1.3');
    const { error } = await signEncrypt('pay$client.example', sender, request, {
      ...options,
      versionFallback: false,
    });
    expect(error?.code).toBe('BTP_ERROR_VERSION_UNSUPPORTED');
  });

  it('never asks the receiver about a request without permissions', async () => {
    const asked = receiverSpeaks('1.1.3');
    const { permissions: _permissions, entityType: _entityType, given: _given, ...plain } = request;
    await signEncrypt('pay$client.example', sender, { ...plain, version: '1.1.0' }, options);
    expect(asked).not.toHaveBeenCalled();
  });
});
