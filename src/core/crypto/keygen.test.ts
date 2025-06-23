import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeys } from './keygen';
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

const mockFs = vi.mocked(fs);
const mockCrypto = vi.mocked(crypto);

describe('generateKeys', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should generate and save keys for a given account name', async () => {
    const accountName = 'test-account';
    await generateKeys(accountName);

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(`keys/${accountName}`, { recursive: true });

    expect(mockCrypto.generateKeyPairSync).toHaveBeenCalledWith('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      `keys/${accountName}/${accountName}-private.pem`,
      'mock-private-key',
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      `keys/${accountName}/${accountName}-public.pem`,
      'mock-public-key',
    );
  });
});
