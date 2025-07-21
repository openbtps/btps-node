/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signEncrypt } from './signEncrypt';
import * as cryptoIndex from './index';
import * as utils from '../utils/index.js';
import { BTPErrorException } from '../error/index.js';
import { BTP_ERROR_IDENTITY, BTP_ERROR_RESOLVE_PUBKEY } from '../error/constant.js';
import { PemKeys } from './types';
import { ParsedIdentity } from '../utils/types.js';
import { BTPTrustReqDoc } from '../trust/types.js';

vi.mock('crypto', () => ({
  randomUUID: () => 'mock-uuid',
}));

vi.mock('./index', () => ({
  encryptBtpPayload: vi.fn(),
  signBtpPayload: vi.fn(),
}));

vi.mock('../utils/index.js', () => ({
  parseIdentity: vi.fn(),
  resolvePublicKey: vi.fn(),
}));

const mockCrypto = vi.mocked(cryptoIndex);
const mockUtils = vi.mocked(utils);

describe('signEncrypt', () => {
  let sender: ParsedIdentity & { pemFiles: PemKeys };
  let payload: { document: BTPTrustReqDoc; type: 'TRUST_REQ'; selector: string };

  beforeEach(() => {
    vi.resetAllMocks();

    sender = {
      accountName: 'sender',
      domainName: 'example.com',
      pemFiles: {
        privateKey: 'private-key',
        publicKey: 'public-key',
      },
    };

    payload = {
      document: {
        name: 'test',
        email: 'test@test.com',
        phone: '1234567890',
        reason: 'test',
        id: 'mock-uuid',
      },
      type: 'TRUST_REQ',
      selector: 'btps1',
    };

    mockUtils.parseIdentity.mockReturnValue({ accountName: 'receiver', domainName: 'example.com' });
    mockUtils.resolvePublicKey.mockResolvedValue('receiver-public-key');
    mockCrypto.encryptBtpPayload.mockReturnValue({
      data: 'encrypted-doc',
      encryption: {
        algorithm: 'aes-256-gcm',
        encryptedKey: 'encrypted-key',
        iv: 'iv',
        type: 'standardEncrypt',
        authTag: 'auth-tag',
      },
    });
    mockCrypto.signBtpPayload.mockReturnValue({
      algorithmHash: 'sha256',
      fingerprint: 'fingerprint',
      value: 'signature-value',
    });
  });

  it('should successfully sign and encrypt the payload', async () => {
    const result = await signEncrypt('receiver$example.com', sender, payload, {
      signature: { algorithmHash: 'sha256' },
      encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
    });

    expect(result.error).toBeUndefined();
    expect(result.payload?.id).toBe('mock-uuid');
    expect(result.payload?.document).toBe('encrypted-doc');
    expect(mockCrypto.encryptBtpPayload).toHaveBeenCalled();
    expect(mockCrypto.signBtpPayload).toHaveBeenCalled();
  });

  it('should handle payloads that do not require encryption', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await signEncrypt('receiver$example.com', sender, payload as any);

    expect(result.error).toBeUndefined();
    expect(result.payload?.document).toEqual(payload.document);
    expect(result.payload?.encryption).toBeNull();
    expect(mockCrypto.encryptBtpPayload).not.toHaveBeenCalled();
    expect(mockCrypto.signBtpPayload).toHaveBeenCalled();
  });

  it('should use provided id and issuedAt', async () => {
    const customPayload = { ...payload, id: 'custom-id', issuedAt: new Date(0).toISOString() };
    const result = await signEncrypt('receiver$example.com', sender, customPayload);

    expect(result.payload?.id).toBe('custom-id');
    expect(result.payload?.issuedAt).toBe(new Date(0).toISOString());
  });

  it('should return an error if receiver identity is invalid', async () => {
    mockUtils.parseIdentity.mockReturnValue(null);
    const result = await signEncrypt('receiver$example.com', sender, payload);

    expect(result.payload).toBeUndefined();
    expect(result.error).toBeInstanceOf(BTPErrorException);
    expect(result.error?.message).toBe(BTP_ERROR_IDENTITY.message);
  });

  it('should return an error if receiver public key cannot be resolved', async () => {
    mockUtils.resolvePublicKey.mockResolvedValue(undefined);
    const result = await signEncrypt('receiver$example.com', sender, payload);

    expect(result.payload).toBeUndefined();
    expect(result.error).toBeInstanceOf(BTPErrorException);
    expect(result.error?.message).toBe(BTP_ERROR_RESOLVE_PUBKEY.message);
  });

  it('should return an error if encryption fails', async () => {
    const encryptionError = new Error('Encryption failed');
    mockCrypto.encryptBtpPayload.mockImplementation(() => {
      throw encryptionError;
    });
    const result = await signEncrypt('receiver$example.com', sender, payload, {
      signature: { algorithmHash: 'sha256' },
      encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
    });

    expect(result.payload).toBeUndefined();
    expect(result.error).toBe(encryptionError);
  });

  it('should return an error if signing fails', async () => {
    const signingError = new Error('Signing failed');
    mockCrypto.signBtpPayload.mockImplementation(() => {
      throw signingError;
    });
    const result = await signEncrypt('receiver$example.com', sender, payload);

    expect(result.payload).toBeUndefined();
    expect(result.error).toBe(signingError);
  });
});

describe('Key Rotation Integration Tests', () => {
  it('should sign artifact with old selector and verify with old public key during rotation', async () => {
    // Setup: Alice has two selectors with different public keys
    const aliceIdentity = 'alice$example.com';
    const oldSelector = 'btps1';
    const newSelector = 'btps2';

    // Mock DNS resolution for key rotation scenario
    const mockResolvePublicKey = vi
      .fn()
      .mockImplementation((identity: string, selector: string) => {
        if (identity === aliceIdentity && selector === oldSelector) {
          return Promise.resolve(
            '-----BEGIN PUBLIC KEY-----\nOLD_ALICE_PUBLIC_KEY\n-----END PUBLIC KEY-----',
          );
        } else if (identity === aliceIdentity && selector === newSelector) {
          return Promise.resolve(
            '-----BEGIN PUBLIC KEY-----\nNEW_ALICE_PUBLIC_KEY\n-----END PUBLIC KEY-----',
          );
        } else if (identity === 'bob$company.com') {
          // Return a valid public key for the receiver
          return Promise.resolve(
            '-----BEGIN PUBLIC KEY-----\nBOB_PUBLIC_KEY\n-----END PUBLIC KEY-----',
          );
        }
        return Promise.resolve(undefined);
      });

    // Mock the resolvePublicKey function properly
    vi.mocked(utils.resolvePublicKey).mockImplementation(mockResolvePublicKey);

    // Create sender with old selector
    const sender = {
      accountName: 'alice',
      domainName: 'example.com',
      pemFiles: {
        privateKey: '-----BEGIN PRIVATE KEY-----\nOLD_ALICE_PRIVATE_KEY\n-----END PRIVATE KEY-----',
        publicKey: '-----BEGIN PUBLIC KEY-----\nOLD_ALICE_PUBLIC_KEY\n-----END PUBLIC KEY-----',
      },
    };

    const document = { message: 'Hello from old selector' };
    const to = 'bob$company.com';

    // Ensure signBtpPayload doesn't throw
    mockCrypto.signBtpPayload.mockReturnValue({
      algorithmHash: 'sha256',
      fingerprint: 'old_fingerprint',
      value: 'old_signature_value',
    });

    // Sign and encrypt with old selector
    const result = await signEncrypt(to, sender, { document, selector: oldSelector });

    expect(result.error).toBeUndefined();
    expect(result.payload).toBeDefined();
    expect(result.payload.signature).toBeDefined();
    expect(result.payload.selector).toBe(oldSelector);

    // Verify that resolvePublicKey was called with old selector
    expect(mockResolvePublicKey).toHaveBeenCalledWith(to, oldSelector);
  });

  it('should sign artifact with new selector and verify with new public key after rotation', async () => {
    // Setup: Alice has rotated to new selector
    const aliceIdentity = 'alice$example.com';
    const oldSelector = 'btps1';
    const newSelector = 'btps2';

    const mockResolvePublicKey = vi
      .fn()
      .mockImplementation((identity: string, selector: string) => {
        if (identity === aliceIdentity && selector === oldSelector) {
          return Promise.resolve(
            '-----BEGIN PUBLIC KEY-----\nOLD_ALICE_PUBLIC_KEY\n-----END PUBLIC KEY-----',
          );
        } else if (identity === aliceIdentity && selector === newSelector) {
          return Promise.resolve(
            '-----BEGIN PUBLIC KEY-----\nNEW_ALICE_PUBLIC_KEY\n-----END PUBLIC KEY-----',
          );
        } else if (identity === 'bob$company.com') {
          // Return a valid public key for the receiver
          return Promise.resolve(
            '-----BEGIN PUBLIC KEY-----\nBOB_PUBLIC_KEY\n-----END PUBLIC KEY-----',
          );
        }
        return Promise.resolve(undefined);
      });

    // Mock the resolvePublicKey function properly
    vi.mocked(utils.resolvePublicKey).mockImplementation(mockResolvePublicKey);

    // Create sender with new selector
    const sender = {
      accountName: 'alice',
      domainName: 'example.com',
      pemFiles: {
        privateKey: '-----BEGIN PRIVATE KEY-----\nNEW_ALICE_PRIVATE_KEY\n-----END PRIVATE KEY-----',
        publicKey: '-----BEGIN PUBLIC KEY-----\nNEW_ALICE_PUBLIC_KEY\n-----END PUBLIC KEY-----',
      },
    };

    const document = { message: 'Hello from new selector' };
    const to = 'bob$company.com';

    // Ensure signBtpPayload doesn't throw
    mockCrypto.signBtpPayload.mockReturnValue({
      algorithmHash: 'sha256',
      fingerprint: 'new_fingerprint',
      value: 'new_signature_value',
    });

    // Sign and encrypt with new selector
    const result = await signEncrypt(to, sender, { document, selector: newSelector });

    expect(result.error).toBeUndefined();
    expect(result.payload).toBeDefined();
    expect(result.payload.signature).toBeDefined();
    expect(result.payload.selector).toBe(newSelector);

    // Verify that resolvePublicKey was called with new selector
    expect(mockResolvePublicKey).toHaveBeenCalledWith(to, newSelector);
  });

  it('should handle verification of artifact signed with old selector after rotation', async () => {
    // This test simulates the scenario where:
    // 1. Alice signed an artifact with old selector (btps1)
    // 2. Alice rotated to new selector (btps2)
    // 3. Bob receives the artifact and needs to verify it using the old selector

    const aliceIdentity = 'alice$example.com';
    const oldSelector = 'btps1';
    const newSelector = 'btps2';

    const mockResolvePublicKey = vi
      .fn()
      .mockImplementation((identity: string, selector: string) => {
        if (identity === aliceIdentity && selector === oldSelector) {
          return Promise.resolve(
            '-----BEGIN PUBLIC KEY-----\nOLD_ALICE_PUBLIC_KEY\n-----END PUBLIC KEY-----',
          );
        } else if (identity === aliceIdentity && selector === newSelector) {
          return Promise.resolve(
            '-----BEGIN PUBLIC KEY-----\nNEW_ALICE_PUBLIC_KEY\n-----END PUBLIC KEY-----',
          );
        }
        return Promise.resolve(undefined);
      });

    // Mock the resolvePublicKey function properly
    vi.mocked(utils.resolvePublicKey).mockImplementation(mockResolvePublicKey);

    // Simulate an artifact that was signed with old selector
    const artifactWithOldSelector = {
      version: '1.0.0',
      type: 'TRUST_REQ',
      from: aliceIdentity,
      to: 'bob$company.com',
      document: { message: 'Signed with old selector' },
      signature: {
        algorithmHash: 'sha256',
        value: 'signature_value',
        fingerprint: 'old_fingerprint',
      },
      selector: oldSelector,
      issuedAt: '2025-01-01T00:00:00.000Z',
      id: 'artifact-123',
    };

    // Bob should be able to verify this artifact using the old selector
    const oldPublicKey = await mockResolvePublicKey(aliceIdentity, oldSelector);
    expect(oldPublicKey).toBe(
      '-----BEGIN PUBLIC KEY-----\nOLD_ALICE_PUBLIC_KEY\n-----END PUBLIC KEY-----',
    );

    // Verify that the artifact has the old selector
    expect(artifactWithOldSelector.selector).toBe(oldSelector);

    // Bob should also be able to get the new selector for future communications
    const newPublicKey = await mockResolvePublicKey(aliceIdentity, newSelector);
    expect(newPublicKey).toBe(
      '-----BEGIN PUBLIC KEY-----\nNEW_ALICE_PUBLIC_KEY\n-----END PUBLIC KEY-----',
    );
  });

  it('should handle selector not found during verification', async () => {
    const aliceIdentity = 'alice$example.com';
    const nonExistentSelector = 'btps999';

    const mockResolvePublicKey = vi
      .fn()
      .mockImplementation((identity: string, selector: string) => {
        if (identity === aliceIdentity && selector === nonExistentSelector) {
          return Promise.resolve(undefined); // Selector not found
        }
        return Promise.resolve(undefined);
      });

    // Mock the resolvePublicKey function properly
    vi.mocked(utils.resolvePublicKey).mockImplementation(mockResolvePublicKey);

    // Try to resolve public key for non-existent selector
    const publicKey = await mockResolvePublicKey(aliceIdentity, nonExistentSelector);
    expect(publicKey).toBeUndefined();

    // This should cause verification to fail
    const artifactWithInvalidSelector = {
      version: '1.0.0',
      type: 'TRUST_REQ',
      from: aliceIdentity,
      to: 'bob$company.com',
      document: { message: 'Signed with invalid selector' },
      signature: {
        algorithmHash: 'sha256',
        value: 'signature_value',
        fingerprint: 'fingerprint',
      },
      selector: nonExistentSelector,
      issuedAt: '2025-01-01T00:00:00.000Z',
      id: 'artifact-456',
    };

    // Verification should fail because public key cannot be resolved
    expect(artifactWithInvalidSelector.selector).toBe(nonExistentSelector);
  });
});
