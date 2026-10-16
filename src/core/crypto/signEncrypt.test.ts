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
import {
  BTP_ERROR_IDENTITY,
  BTP_ERROR_RESOLVE_PUBKEY,
  BTP_ERROR_VALIDATION,
} from '../error/constant.js';
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
  let sender: ParsedIdentity & { pemFiles: PemKeys; selector: string };
  let payload: { document: BTPTrustReqDoc; type: 'TRUST_REQ'; encryptionSelector: string };

  beforeEach(() => {
    vi.resetAllMocks();

    sender = {
      accountName: 'sender',
      domainName: 'example.com',
      selector: 'btps2',
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
      encryptionSelector: 'btps1',
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
    mockCrypto.signBtpPayload.mockResolvedValue({
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

  it('names the sender key as signatureSelector and the receiver key as encryptionSelector, and signs both', async () => {
    const result = await signEncrypt('receiver$example.com', sender, payload, {
      signature: { algorithmHash: 'sha256' },
      encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
    });

    expect(result.payload).toMatchObject({
      signatureSelector: 'btps2',
      encryptionSelector: 'btps1',
    });
    expect(result.payload).not.toHaveProperty('selector');
    expect(mockUtils.resolvePublicKey).toHaveBeenCalledWith('receiver$example.com', 'btps1');
    expect(mockUtils.resolvePublicKey).not.toHaveBeenCalledWith('receiver$example.com', 'btps2');
    const signed = mockCrypto.signBtpPayload.mock.calls[0]![0] as Record<string, unknown>;
    expect(signed).toMatchObject({ signatureSelector: 'btps2', encryptionSelector: 'btps1' });
  });

  it('carries no encryptionSelector when the document is not encrypted', async () => {
    const result = await signEncrypt('receiver$example.com', sender, payload);

    expect(result.payload?.encryption).toBeNull();
    expect(result.payload?.signatureSelector).toBe('btps2');
    expect(result.payload).not.toHaveProperty('encryptionSelector');
  });

  it('refuses the 1.0 selector field', async () => {
    const { encryptionSelector, ...rest } = payload;
    const result = await signEncrypt('receiver$example.com', sender, {
      ...rest,
      selector: encryptionSelector,
    });

    expect(result.payload).toBeUndefined();
    expect(result.error?.code).toBe(BTP_ERROR_VALIDATION.code);
    expect(String(result.error?.cause)).toMatch(/encryptionSelector/);
    expect(mockCrypto.signBtpPayload).not.toHaveBeenCalled();
  });

  it('refuses a sender without a selector for its signing key', async () => {
    const result = await signEncrypt('receiver$example.com', { ...sender, selector: '' }, payload);

    expect(result.payload).toBeUndefined();
    expect(result.error?.code).toBe(BTP_ERROR_VALIDATION.code);
  });

  it('should handle payloads that do not require encryption', async () => {
    const result = await signEncrypt('receiver$example.com', sender, payload);

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
