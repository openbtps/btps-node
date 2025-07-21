/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BtpsDelegator } from './BtpsDelegator';
import type { PemKeys } from '../crypto/types.js';
import type { BTPTransporterArtifact } from '../server/types.js';
import * as utils from '../utils/index.js';
import * as crypto from '../crypto/index.js';
import { BTPErrorException } from '../error/index.js';

vi.mock('../utils/index.js');
vi.mock('../crypto/index.js');

const mockResolvePublicKey = vi.mocked(utils.resolvePublicKey);
const mockGetHostAndSelector = vi.mocked(utils.getHostAndSelector);
const mockSignBtpPayload = vi.mocked(crypto.signBtpPayload);

const saasKeys: PemKeys = {
  publicKey: 'saas-public-key',
  privateKey: 'saas-private-key',
};
const userKeys: PemKeys = {
  publicKey: 'user-public-key',
  privateKey: 'user-private-key',
};

const agentId = 'agent-123';
const agentPubKey = 'agent-device-public-key';
const artifact: BTPTransporterArtifact = {
  id: 'artifact-1',
  from: 'user$platform.com',
  to: 'receiver$platform.com',
  type: 'BTPS_DOC',
  version: '1.0.0',
  issuedAt: '2024-01-01T00:00:00.000Z',
  document: {},
  signature: {
    algorithmHash: 'sha256',
    value: 'sig',
    fingerprint: 'agent-device-fingerprint',
  },
  encryption: null,
  selector: 'btps1',
};

// Helper function to create a properly mocked delegator
async function createMockedDelegator(
  options: { identity: string; privateKey: string },
  keyPairMatches = true,
) {
  const delegator = new BtpsDelegator({
    ...options,
    autoInit: false, // Disable auto-initialization for testing
  });
  // Mock isKeyPairMatching before calling init
  delegator['isKeyPairMatching'] = vi.fn().mockReturnValue(keyPairMatches);
  // Now manually call init
  await delegator.init();
  return delegator;
}

describe('BtpsDelegator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHostAndSelector.mockResolvedValue({
      host: 'btps://btps.platform.com:3443',
      selector: 'btps1',
    });
    mockResolvePublicKey.mockResolvedValue(saasKeys.publicKey);
    mockSignBtpPayload.mockImplementation((payload, keys) => ({
      algorithmHash: 'sha256',
      value: 'signed-' + JSON.stringify(payload),
      fingerprint: keys.publicKey,
    }));
  });

  describe('Initialization', () => {
    it('should initialize and verify key pair', async () => {
      const delegator = await createMockedDelegator(
        {
          identity: 'saas$platform.com',
          privateKey: saasKeys.privateKey,
        },
        true,
      );
      expect(delegator['publicKey']).toBe(saasKeys.publicKey);
      expect(delegator['isInitialized']).toBe(true);
    });

    it('should throw if public key cannot be resolved', async () => {
      mockResolvePublicKey.mockResolvedValue(undefined);
      const delegator = new BtpsDelegator({
        identity: 'saas$platform.com',
        privateKey: saasKeys.privateKey,
        autoInit: false,
      });
      delegator['isKeyPairMatching'] = vi.fn().mockReturnValue(true);
      await expect(delegator.init()).rejects.toThrow(BTPErrorException);
    });

    it('should throw if key pair does not match', async () => {
      mockResolvePublicKey.mockResolvedValue(saasKeys.publicKey);
      const delegator = new BtpsDelegator({
        identity: 'saas$platform.com',
        privateKey: saasKeys.privateKey,
        autoInit: false,
      });
      delegator['isKeyPairMatching'] = vi.fn().mockReturnValue(false);
      await expect(delegator.init()).rejects.toThrow(BTPErrorException);
    });
  });

  describe('Key pair validation', () => {
    it('should return true for matching key pair', async () => {
      const delegator = new BtpsDelegator({
        identity: 'saas$platform.com',
        privateKey: saasKeys.privateKey,
        autoInit: false,
      });
      delegator['isKeyPairMatching'] = vi.fn().mockReturnValue(true);
      mockResolvePublicKey.mockResolvedValue(saasKeys.publicKey);
      const result = await delegator['verifyDelegatorIdentity']();
      expect(result.isValid).toBe(true);
      expect(result.publicKey).toBe(saasKeys.publicKey);
    });
    it('should return false for non-matching key pair', async () => {
      const delegator = new BtpsDelegator({
        identity: 'saas$platform.com',
        privateKey: saasKeys.privateKey,
        autoInit: false,
      });
      delegator['isKeyPairMatching'] = vi.fn().mockReturnValue(false);
      mockResolvePublicKey.mockResolvedValue(saasKeys.publicKey);
      const result = await delegator['verifyDelegatorIdentity']();
      expect(result.isValid).toBe(false);
      expect(result.publicKey).toBe(saasKeys.publicKey);
    });
  });

  describe('Delegation', () => {
    let delegator: BtpsDelegator;
    beforeEach(async () => {
      delegator = await createMockedDelegator(
        {
          identity: 'saas$platform.com',
          privateKey: saasKeys.privateKey,
        },
        true,
      );
    });

    it('should delegate for free user (SaaS signs)', async () => {
      const result = await delegator.delegateArtifact(agentId, agentPubKey, artifact);
      expect(result.delegation).toBeDefined();
      expect(result.delegation.signature.fingerprint).toBe(saasKeys.publicKey);
      expect(mockSignBtpPayload).toHaveBeenCalled();
      expect(result.delegation.agentId).toBe(agentId);
      expect(result.delegation.agentPubKey).toBe(agentPubKey);
      expect(result.delegation.signedBy).toBe('saas$platform.com');
    });

    it('should delegate for premium user (user signs, SaaS attests)', async () => {
      const onBehalfOf = {
        identity: 'user456$customdomain.com',
        keyPair: userKeys,
      };
      const result = await delegator.delegateArtifact(agentId, agentPubKey, artifact, onBehalfOf);
      expect(result.delegation).toBeDefined();
      expect(result.delegation.signature.fingerprint).toBe(userKeys.publicKey);
      expect(result.delegation.attestation).toBeDefined();
      if (result.delegation.attestation) {
        expect(result.delegation.attestation.signature.fingerprint).toBe(saasKeys.publicKey);
        expect(result.delegation.attestation.signedBy).toBe('saas$platform.com');
      }
    });

    it('should throw if not initialized', async () => {
      delegator['isInitialized'] = false;
      await expect(delegator.delegateArtifact(agentId, agentPubKey, artifact)).rejects.toThrow(
        BTPErrorException,
      );
    });

    it('should throw if publicKey is missing', async () => {
      delegator['publicKey'] = undefined;
      await expect(delegator.delegateArtifact(agentId, agentPubKey, artifact)).rejects.toThrow(
        BTPErrorException,
      );
    });
  });

  describe('Attestation', () => {
    let delegator: BtpsDelegator;
    beforeEach(async () => {
      delegator = await createMockedDelegator(
        {
          identity: 'saas$platform.com',
          privateKey: saasKeys.privateKey,
        },
        true,
      );
    });
    it('should create and sign attestation', async () => {
      const delegation = {
        agentId: agentId,
        agentPubKey: agentPubKey,
        signedBy: 'user456$customdomain.com',
        issuedAt: '2024-01-01T00:00:00.000Z',
        signature: { algorithmHash: 'sha256', value: 'sig', fingerprint: 'user-public-key' },
        selector: 'btps1',
      };
      const attestation = await delegator['createAttestation']({
        delegation,
        attestorIdentity: 'saas$platform.com',
        attestorKey: saasKeys,
        selector: 'btps1',
      });
      expect(attestation.signature.fingerprint).toBe(saasKeys.publicKey);
      expect(attestation.signedBy).toBe('saas$platform.com');
    });
  });

  describe('Edge cases', () => {
    it('should throw if delegateArtifact is called before init', async () => {
      const delegator = new BtpsDelegator({
        identity: 'saas$platform.com',
        privateKey: saasKeys.privateKey,
        autoInit: false,
      });
      delegator['isKeyPairMatching'] = vi.fn().mockReturnValue(true);
      delegator['isInitialized'] = false;
      await expect(delegator.delegateArtifact(agentId, agentPubKey, artifact)).rejects.toThrow(
        BTPErrorException,
      );
    });
  });
});
