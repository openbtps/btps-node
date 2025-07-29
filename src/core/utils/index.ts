/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { resolveTxt } from 'dns/promises';
import { ParsedIdentity } from './types.js';
import {
  BTPIdentityLookupRequest,
  BTPS_DNS_NAME_SPACE,
  BTPTransporterArtifact,
} from 'server/index.js';
import { createHash } from 'crypto';
import { transformToBTPErrorException } from '@core/error/index.js';

export * from './types.js';

export const parseIdentity = (identity: string): ParsedIdentity | null => {
  const [accountName, domainName] = identity.split('$');
  if (!accountName || !domainName) {
    return null;
  }

  return {
    accountName,
    domainName,
  };
};

export const isValidIdentity = (identity: string = '') => {
  const parsedIdentity = parseIdentity(identity);
  return !!parsedIdentity;
};

export function pemToBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\r?\n/g, '')
    .trim();
}

export function base64ToPem(base64: string): string {
  const lines = base64.match(/.{1,64}/g) || [];
  return ['-----BEGIN PUBLIC KEY-----', ...lines, '-----END PUBLIC KEY-----'].join('\n');
}

export const getHostAndSelector = async (
  identity: string,
): Promise<{ version: string; host: string; selector: string } | undefined> => {
  const parsedIdentity = parseIdentity(identity);
  if (!parsedIdentity) {
    return undefined;
  }

  const dnsName = `${BTPS_DNS_NAME_SPACE}.${parsedIdentity.domainName}`;

  try {
    const txtRecords = await resolveTxt(dnsName);
    if (!txtRecords.length) {
      return undefined;
    }

    const flat = txtRecords.map((r) => r.join('')).join('');
    const parts = Object.fromEntries(
      flat
        .split(';')
        .map((s) =>
          s
            .trim()
            .split('=')
            .map((p) => p.trim()),
        )
        .filter((pair) => pair.length === 2),
    );

    if (!parts['v'] || !parts['u'] || !parts['s']) return undefined;

    return {
      version: parts['v'],
      host: parts['u'],
      selector: parts['s'],
    };
  } catch (error: unknown) {
    throw transformToBTPErrorException(error);
  }
};

export const getDnsIdentityParts = async (
  identity: string,
  selector: string,
  type?: 'key' | 'pem' | 'version',
): Promise<{ key: string; version: string; pem: string } | string | undefined> => {
  const typeMap = {
    key: 'k',
    version: 'v',
    pem: 'p',
  };

  const parsedIdentity = parseIdentity(identity);
  if (!parsedIdentity) {
    return undefined;
  }

  const { accountName, domainName } = parsedIdentity;

  const dnsName = `${selector}.${BTPS_DNS_NAME_SPACE}.${accountName}.${domainName}`;

  try {
    const txtRecords = await resolveTxt(dnsName);
    if (!txtRecords.length) {
      return undefined;
    }

    const flat = txtRecords.map((r) => r.join('')).join('');

    const parts = Object.fromEntries(
      flat
        .split(';')
        .map((s) =>
          s
            .trim()
            .split('=')
            .map((p) => p.trim()),
        )
        .filter((pair) => pair.length === 2),
    );

    if (!type) {
      return {
        key: parts['k'],
        version: parts['v'],
        pem: base64ToPem(parts['p']),
      };
    }

    if (type === 'pem') {
      return base64ToPem(parts['p']);
    }

    return parts[typeMap[type]];
  } catch (error: unknown) {
    throw transformToBTPErrorException(error);
  }
};

export const getBtpAddressParts = (input: string): URL | null => {
  try {
    const normalized = input.startsWith('btps://') ? input : `btps://${input}`;
    const parsed = new URL(normalized);
    return parsed;
  } catch {
    return null;
  }
};

export const resolvePublicKey = async (
  identity: string,
  selector: string,
): Promise<string | undefined> => {
  return (await getDnsIdentityParts(identity, selector, 'pem')) as string | undefined;
};

/**
 * Checks if the artifact is a BTP transport artifact
 * @param artifact - The artifact to check
 * @returns True if the artifact is a BTP transport artifact, false otherwise
 */
export const isBtpsTransportArtifact = (artifact: unknown): artifact is BTPTransporterArtifact => {
  if (typeof artifact !== 'object' || artifact === null) {
    return false;
  }

  const maybe = artifact as Partial<BTPTransporterArtifact>;
  return typeof maybe.from === 'string' && typeof maybe.type === 'string' && !('agentId' in maybe);
};

/**
 * Checks if the artifact is a BTP identity request
 * @param artifact - The artifact to check
 * @returns True if the artifact is a BTP identity request, false otherwise
 */
export const isBtpsIdentityRequest = (artifact: unknown): artifact is BTPIdentityLookupRequest => {
  if (typeof artifact !== 'object' || artifact === null) {
    return false;
  }
  const maybe = artifact as Partial<BTPIdentityLookupRequest>;
  return (
    typeof maybe.identity === 'string' &&
    typeof maybe.hostSelector === 'string' &&
    !('signature' in maybe) &&
    !('document' in maybe) &&
    !('to' in maybe)
  );
};

/**
 * Computes a globally unique, deterministic ID
 * for a given `from` and `to` identity pair using SHA-256.
 *
 * This ID is:
 * - Collision-resistant: suitable for billions of records
 * - Index-safe: 64-character hex string for database keys
 * - Human-debuggable: logs clearly as a hash
 *
 * @param identity - Identity (e.g. "finance$company.com")
 * @returns 64-character hexadecimal SHA-256 hash of "identity"
 */
export function computeId(identity: string): string {
  const input = identity.toLowerCase(); // Ensure consistent sensitive format
  const hash = createHash('sha256').update(input).digest('hex');
  return hash;
}

/**
 * Checks if the artifact can be delegated
 * @param artifact - The artifact to check
 * @returns True if the artifact can be delegated, false otherwise
 * @condition for delegation:
 * - The artifact must have a delegation
 * - The artifact must have a from
 * - The delegation must have a signedBy
 * - The from and signedBy must be same for custom domain like `alice@alice.com`
 * - The from and signedBy must be from the same domain for SaaS domain like `alice$company.com` if the sender is not using custom domain
 * - The delegation must have an agentId
 */
export const isDelegationAllowed = (artifact: BTPTransporterArtifact): boolean => {
  const { delegation, from } = artifact || {};
  if (!delegation || !from) {
    return false;
  }

  const { signedBy } = delegation || {};
  if (!signedBy) {
    return false;
  }

  const parsedSender = parseIdentity(from);
  const parsedDelegator = parseIdentity(signedBy);
  if (!parsedSender || !parsedDelegator) {
    return false;
  }

  /*
   * If the from and signedBy are the same, the artifact can be delegated
   * This is the common case for when the sender is using a custom domain like `alice@alice.com`
   * and hence the delegator must be from the same domain like `admin@alice.com`
   */
  if (from === signedBy) {
    return true;
  }

  /*
   * If the from and signedBy are different, the artifact can be delegated if the delegator is from the same domain
   * This is the most common case and happens when the sender is using SaaS domain like `alice$company.com`
   * and hence the delegator must be from the same domain like `admin$company.com`
   */
  if (parsedSender.domainName === parsedDelegator.domainName) {
    return true;
  }

  return false;
};
