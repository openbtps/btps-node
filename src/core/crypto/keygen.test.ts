/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as keygenModule from './keygen';
import * as fs from 'fs';
import * as crypto from 'crypto';

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('crypto', () => ({
  generateKeyPairSync: vi.fn(() => ({
    publicKey: 'mock-public-key',
    privateKey: 'mock-private-key',
  })),
}));

vi.mock('./index.js', () => ({
  getFingerprintFromPem: vi.fn(() => 'mock-fingerprint'),
}));

const mockFs = vi.mocked(fs);
const mockCrypto = vi.mocked(crypto);

describe('generateKeys', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should generate and save keys for a given account name', async () => {
    const accountName = 'test-account';
    vi.spyOn(keygenModule, 'getBTPKeyPair').mockReturnValue({
      publicKey: 'mock-public-key',
      privateKey: 'mock-private-key',
      fingerprint: 'mock-fingerprint',
    });
    await keygenModule.generateKeys(accountName);

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(`keys/${accountName}`, { recursive: true });

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      `keys/${accountName}/${accountName}-private.pem`,
      'mock-private-key',
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      `keys/${accountName}/${accountName}-public.pem`,
      'mock-public-key',
    );
  });

  describe('getBTPKeyPair', () => {
    it('should return a key pair and fingerprint', () => {
      const result = keygenModule.getBTPKeyPair();
      expect(result).toEqual({
        publicKey: 'mock-public-key',
        privateKey: 'mock-private-key',
        fingerprint: 'mock-fingerprint',
      });

      expect(mockCrypto.generateKeyPairSync).toHaveBeenCalledWith('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
    });
  });
});
