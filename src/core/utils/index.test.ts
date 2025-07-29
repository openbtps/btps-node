/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveTxt } from 'dns/promises';
import {
  parseIdentity,
  isValidIdentity,
  pemToBase64,
  base64ToPem,
  getHostAndSelector,
  getDnsIdentityParts,
  getBtpAddressParts,
  resolvePublicKey,
  isDelegationAllowed,
} from './index.js';
import type { BTPTransporterArtifact } from '../server/types.js';

vi.mock('dns/promises', () => ({
  resolveTxt: vi.fn(),
}));

const mockDns = vi.mocked(resolveTxt);

describe('utils/index', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('parseIdentity', () => {
    it('should parse a valid identity', () => {
      expect(parseIdentity('test$example.com')).toEqual({
        accountName: 'test',
        domainName: 'example.com',
      });
    });

    it('should return null for an invalid identity', () => {
      expect(parseIdentity('test.example.com')).toBeNull();
    });
  });

  describe('isValidIdentity', () => {
    it('should return true for a valid identity', () => {
      expect(isValidIdentity('test$example.com')).toBe(true);
    });

    it('should return false for an invalid identity', () => {
      expect(isValidIdentity('test.example.com')).toBe(false);
    });
  });

  describe('pem and base64 conversion', () => {
    const pem = `-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE.../-----END PUBLIC KEY-----`;
    const base64 = `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE.../`;

    it('should convert PEM to base64', () => {
      expect(pemToBase64(pem)).toBe(base64);
    });

    it('should convert base64 to PEM', () => {
      const expectedPem = `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----`;
      expect(base64ToPem(base64)).toBe(expectedPem);
    });
  });

  describe('getDnsIdentityParts', () => {
    it('should resolve all DNS parts correctly', async () => {
      const txtRecord = `k=key;v=1.0.0;p=cGVt;u=btps://btps.example.com`;
      mockDns.mockResolvedValue([[txtRecord]]);

      const parts = await getDnsIdentityParts('test$example.com', 'btps1');
      expect(parts).toEqual({
        key: 'key',
        version: '1.0.0',
        pem: base64ToPem('cGVt'),
      });
    });

    it('should resolve a specific DNS part', async () => {
      const txtRecord = `u=btps://btps.example.com;s=btps1; v=1.0.0`;
      mockDns.mockResolvedValue([[txtRecord]]);

      const version = await getDnsIdentityParts('test$example.com', 'btps1', 'version');
      expect(version).toBe('1.0.0');
    });

    it('should return undefined for an invalid identity', async () => {
      const parts = await getDnsIdentityParts('test.example.com', 'btps1');
      expect(parts).toBeUndefined();
    });

    it('should throw an error on DNS resolution failure', async () => {
      mockDns.mockRejectedValue(new Error('DNS error'));
      await expect(getDnsIdentityParts('test$example.com', 'btps1')).rejects.toThrow('DNS error');
    });
  });

  describe('getBtpAddressParts', () => {
    it('should parse a valid BTPS address', () => {
      const url = getBtpAddressParts('btps://user:pass@host.com:8080/path?query=1');
      expect(url).toBeInstanceOf(URL);
      expect(url?.hostname).toBe('host.com');
    });

    it('should normalize a BTPS address without a scheme', () => {
      const url = getBtpAddressParts('host.com');
      expect(url?.protocol).toBe('btps:');
    });

    it('should return null for an invalid BTPS address', () => {
      expect(getBtpAddressParts('not a url')).toBeNull();
    });
  });

  describe('resolvePublicKey', () => {
    it('should resolve the public key PEM', async () => {
      const txtRecord = `p=cGVt`;
      mockDns.mockResolvedValue([[txtRecord]]);
      const pem = await resolvePublicKey('test$example.com', 'btps1');
      expect(pem).toBe('-----BEGIN PUBLIC KEY-----\ncGVt\n-----END PUBLIC KEY-----'); // getDnsIdentityParts returns the raw value here
    });
  });

  describe('getHostAndSelector', () => {
    it('should resolve the host and selector', async () => {
      const txtRecord = `u=btps://btps.example.com;s=btps1; v=1.0.0`;
      mockDns.mockResolvedValue([[txtRecord]]);
      const hostAndSelector = await getHostAndSelector('test$example.com');
      expect(hostAndSelector).toEqual({
        host: 'btps://btps.example.com',
        selector: 'btps1',
        version: '1.0.0',
      });
    });

    it('should return undefined if the identity is invalid', async () => {
      const hostAndSelector = await getHostAndSelector('test.example.com');
      expect(hostAndSelector).toBeUndefined();
    });

    it('should return undefined if the selector is not found', async () => {
      const txtRecord = `u=btps://btps.example.com; v=1.0.0`;
      mockDns.mockResolvedValue([[txtRecord]]);
      const hostAndSelector = await getHostAndSelector('test$example.com');
      expect(hostAndSelector).toBeUndefined();
    });
  });

  describe('Key Rotation Scenarios', () => {
    it('should resolve old selector when new selector is published but artifact uses old selector', async () => {
      // Simulate DNS records for key rotation scenario
      const oldSelector = 'btps1';
      const newSelector = 'btps2';
      const identity = 'alice$example.com';

      // Mock DNS resolution for host and selector
      mockDns.mockImplementation((dnsName: string) => {
        if (dnsName === '_btps.host.example.com') {
          // Host discovery record - returns new selector
          return Promise.resolve([['v=1.0.0; u=btps://btps.example.com:3443; s=btps2']]);
        } else if (dnsName === 'btps1._btps.host.alice.example.com') {
          // Old selector DNS record
          return Promise.resolve([['v=1.0.0; k=rsa; p=OLD_PUBLIC_KEY_BASE64']]);
        } else if (dnsName === 'btps2._btps.host.alice.example.com') {
          // New selector DNS record
          return Promise.resolve([['v=1.0.0; k=rsa; p=NEW_PUBLIC_KEY_BASE64']]);
        }
        return Promise.resolve([]);
      });

      // Test 1: Get host and selector (should return new selector)
      const hostAndSelector = await getHostAndSelector(identity);
      expect(hostAndSelector).toEqual({
        host: 'btps://btps.example.com:3443',
        selector: newSelector,
        version: '1.0.0',
      });

      // Test 2: Resolve public key using old selector (should work)
      const oldPublicKey = await resolvePublicKey(identity, oldSelector);
      expect(oldPublicKey).toBe(
        '-----BEGIN PUBLIC KEY-----\nOLD_PUBLIC_KEY_BASE64\n-----END PUBLIC KEY-----',
      );

      // Test 3: Resolve public key using new selector (should work)
      const newPublicKey = await resolvePublicKey(identity, newSelector);
      expect(newPublicKey).toBe(
        '-----BEGIN PUBLIC KEY-----\nNEW_PUBLIC_KEY_BASE64\n-----END PUBLIC KEY-----',
      );

      // Test 4: Verify that old and new public keys are different
      expect(oldPublicKey).not.toBe(newPublicKey);
    });

    it('should handle selector not found when using non-existent selector', async () => {
      const identity = 'alice$example.com';
      const nonExistentSelector = 'btps999';

      mockDns.mockImplementation((dnsName: string) => {
        if (dnsName === '_btps.host.example.com') {
          return Promise.resolve([['v=1.0.0; u=btps://btps.example.com:3443; s=btps1']]);
        } else if (dnsName === 'btps999._btps.host.alice.example.com') {
          // Non-existent selector - return empty
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      const publicKey = await resolvePublicKey(identity, nonExistentSelector);
      expect(publicKey).toBeUndefined();
    });

    it('should handle key rotation with multiple selectors simultaneously', async () => {
      const identity = 'bob$company.com';
      const selector1 = 'btps1';
      const selector2 = 'btps2';
      const selector3 = 'btps3';

      mockDns.mockImplementation((dnsName: string) => {
        if (dnsName === '_btps.host.company.com') {
          // Host discovery - returns latest selector
          return Promise.resolve([['v=1.0.0; u=btps://btps.company.com:3443; s=btps3']]);
        } else if (dnsName === 'btps1._btps.host.bob.company.com') {
          // Oldest selector
          return Promise.resolve([['v=1.0.0; k=rsa; p=KEY_1_BASE64']]);
        } else if (dnsName === 'btps2._btps.host.bob.company.com') {
          // Middle selector
          return Promise.resolve([['v=1.0.0; k=rsa; p=KEY_2_BASE64']]);
        } else if (dnsName === 'btps3._btps.host.bob.company.com') {
          // Latest selector
          return Promise.resolve([['v=1.0.0; k=rsa; p=KEY_3_BASE64']]);
        }
        return Promise.resolve([]);
      });

      // Test all selectors are accessible
      const key1 = await resolvePublicKey(identity, selector1);
      const key2 = await resolvePublicKey(identity, selector2);
      const key3 = await resolvePublicKey(identity, selector3);

      expect(key1).toBe('-----BEGIN PUBLIC KEY-----\nKEY_1_BASE64\n-----END PUBLIC KEY-----');
      expect(key2).toBe('-----BEGIN PUBLIC KEY-----\nKEY_2_BASE64\n-----END PUBLIC KEY-----');
      expect(key3).toBe('-----BEGIN PUBLIC KEY-----\nKEY_3_BASE64\n-----END PUBLIC KEY-----');

      // Verify all keys are different
      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
      expect(key1).not.toBe(key3);

      // Test host discovery returns latest selector
      const hostAndSelector = await getHostAndSelector(identity);
      expect(hostAndSelector).toEqual({
        host: 'btps://btps.company.com:3443',
        selector: selector3,
        version: '1.0.0',
      });
    });

    it('should handle key rotation scenario where old selector is deprecated', async () => {
      const identity = 'charlie$enterprise.org';
      const oldSelector = 'btps1';
      const newSelector = 'btps2';

      mockDns.mockImplementation((dnsName: string) => {
        if (dnsName === '_btps.host.enterprise.org') {
          // Host discovery - returns new selector
          return Promise.resolve([['v=1.0.0; u=btps://btps.enterprise.org:3443; s=btps2']]);
        } else if (dnsName === 'btps1._btps.host.charlie.enterprise.org') {
          // Old selector - still exists but deprecated
          return Promise.resolve([['v=1.0.0; k=rsa; p=OLD_KEY_BASE64']]);
        } else if (dnsName === 'btps2._btps.host.charlie.enterprise.org') {
          // New selector - active
          return Promise.resolve([['v=1.0.0; k=rsa; p=NEW_KEY_BASE64']]);
        }
        return Promise.resolve([]);
      });

      // Scenario: Artifact was signed with old selector, but host discovery returns new selector
      const hostAndSelector = await getHostAndSelector(identity);
      expect(hostAndSelector?.selector).toBe(newSelector);

      // But we can still resolve the old key for verification
      const oldKey = await resolvePublicKey(identity, oldSelector);
      expect(oldKey).toBe('-----BEGIN PUBLIC KEY-----\nOLD_KEY_BASE64\n-----END PUBLIC KEY-----');

      // And the new key for new artifacts
      const newKey = await resolvePublicKey(identity, newSelector);
      expect(newKey).toBe('-----BEGIN PUBLIC KEY-----\nNEW_KEY_BASE64\n-----END PUBLIC KEY-----');
    });

    it('should handle DNS resolution failures gracefully during key rotation', async () => {
      const identity = 'dave$startup.io';
      const selector = 'btps1';

      mockDns.mockImplementation((dnsName: string) => {
        if (dnsName === '_btps.host.startup.io') {
          // Host discovery fails
          return Promise.reject(new Error('DNS resolution failed'));
        } else if (dnsName === 'btps1._btps.host.dave.startup.io') {
          // Key resolution works
          return Promise.resolve([['v=1.0.0; k=rsa; p=KEY_BASE64']]);
        }
        return Promise.resolve([]);
      });

      // Host discovery should fail
      await expect(getHostAndSelector(identity)).rejects.toThrow('DNS resolution failed');

      // But direct key resolution should still work
      const publicKey = await resolvePublicKey(identity, selector);
      expect(publicKey).toBe('-----BEGIN PUBLIC KEY-----\nKEY_BASE64\n-----END PUBLIC KEY-----');
    });
  });
});

describe('isDelegationAllowed', () => {
  it('should return false if artifact has no delegation', () => {
    expect(
      isDelegationAllowed({
        from: 'alice$company.com',
        document: '',
      } as Partial<BTPTransporterArtifact> as BTPTransporterArtifact),
    ).toBe(false);
    expect(
      isDelegationAllowed({
        delegation: { signedBy: 'admin$company.com' },
        document: '',
      } as Partial<BTPTransporterArtifact> as BTPTransporterArtifact),
    ).toBe(false);
    expect(
      isDelegationAllowed({
        document: '',
      } as Partial<BTPTransporterArtifact> as BTPTransporterArtifact),
    ).toBe(false);
    expect(isDelegationAllowed(undefined as unknown as BTPTransporterArtifact)).toBe(false);
  });

  it('should return false if delegation has no signedBy', () => {
    expect(
      isDelegationAllowed({
        from: 'alice$company.com',
        delegation: {},
        document: '',
      } as Partial<BTPTransporterArtifact> as BTPTransporterArtifact),
    ).toBe(false);
  });

  it('should return false if from or signedBy is invalid identity', () => {
    expect(
      isDelegationAllowed({
        from: 'invalididentity',
        delegation: { signedBy: 'admin$company.com' },
        document: '',
      } as Partial<BTPTransporterArtifact> as BTPTransporterArtifact),
    ).toBe(false);
    expect(
      isDelegationAllowed({
        from: 'alice$company.com',
        delegation: { signedBy: 'invalididentity' },
        document: '',
      } as Partial<BTPTransporterArtifact> as BTPTransporterArtifact),
    ).toBe(false);
  });

  it('should return true if from and signedBy are the same (custom domain)', () => {
    expect(
      isDelegationAllowed({
        from: 'alice$alice.com',
        delegation: { signedBy: 'alice$alice.com' },
        document: '',
      } as Partial<BTPTransporterArtifact> as BTPTransporterArtifact),
    ).toBe(true);
  });

  it('should return true if from and signedBy are different but same domain (SaaS domain)', () => {
    expect(
      isDelegationAllowed({
        from: 'alice$company.com',
        delegation: { signedBy: 'admin$company.com' },
        document: '',
      } as Partial<BTPTransporterArtifact> as BTPTransporterArtifact),
    ).toBe(true);
  });

  it('should return false if from and signedBy are different and different domains', () => {
    expect(
      isDelegationAllowed({
        from: 'alice$company.com',
        delegation: { signedBy: 'admin$other.com' },
        document: '',
      } as Partial<BTPTransporterArtifact> as BTPTransporterArtifact),
    ).toBe(false);
    expect(
      isDelegationAllowed({
        from: 'alice$alice.com',
        delegation: { signedBy: 'admin$other.com' },
        document: '',
      } as Partial<BTPTransporterArtifact> as BTPTransporterArtifact),
    ).toBe(false);
  });
});
