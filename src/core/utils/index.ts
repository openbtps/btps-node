/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { resolveTxt } from 'dns/promises';
import {
  BTPControlArtifact,
  BTPAgentArtifact,
  BTPIdentityLookupRequest,
  BTPTransporterArtifact,
} from 'server/index.js';
import {
  BTPS_DNS_HOST_NAME_SPACE,
  BTPS_DNS_IDENTITY_NAME_SPACE,
} from '@core/server/constants/btps-protocol.js';
import { createHash } from 'crypto';
import { transformToBTPErrorException } from '@core/error/index.js';

export * from './types.js';

import { parseIdentity, isValidIdentity } from './identity.js';

export { parseIdentity, isValidIdentity };

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

/**
 * A BTPS TXT record's `key=value` fields. A field splits at its first `=`
 * only: a base64 value keeps its padding.
 */
const parseBtpsTxtRecord = (txtRecords: string[][]): Record<string, string> => {
  const flat = txtRecords.map((r) => r.join('')).join('');
  return Object.fromEntries(
    flat
      .split(';')
      .map((field) => {
        const at = field.indexOf('=');
        return at === -1 ? [] : [field.slice(0, at).trim(), field.slice(at + 1).trim()];
      })
      .filter((pair) => pair.length === 2 && pair[0] !== ''),
  );
};

/** A name with no record is no answer, not an error: the caller can look elsewhere. */
const resolveBtpsTxt = async (dnsName: string): Promise<string[][]> => {
  try {
    return await resolveTxt(dnsName);
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return [];
    throw transformToBTPErrorException(error);
  }
};

export const getHostAndSelector = async (
  identity: string,
): Promise<{ version: string; host: string; selector: string; operator?: string } | undefined> => {
  const parsedIdentity = parseIdentity(identity);
  if (!parsedIdentity) {
    return undefined;
  }

  const dnsName = `${BTPS_DNS_HOST_NAME_SPACE}.${parsedIdentity.domainName}`;
  const txtRecords = await resolveBtpsTxt(dnsName);
  if (!txtRecords.length) {
    return undefined;
  }

  const parts = parseBtpsTxtRecord(txtRecords);
  if (!parts['v'] || !parts['u'] || !parts['s']) return undefined;

  // `op`: the identity that operates the domain's BTPS server, the only one
  // that may delegate, attest or answer lookups for its addresses.
  const operator = parts['op'];
  return {
    version: parts['v'],
    host: parts['u'],
    selector: parts['s'],
    ...(operator && isValidIdentity(operator) ? { operator } : {}),
  };
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

  const dnsName = `${selector}.${BTPS_DNS_IDENTITY_NAME_SPACE}.${accountName}.${domainName}`;

  const txtRecords = await resolveBtpsTxt(dnsName);
  if (!txtRecords.length) {
    return undefined;
  }

  const parts = parseBtpsTxtRecord(txtRecords);

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

export const isBtpsAgentArtifact = (artifact: unknown): artifact is BTPAgentArtifact => {
  if (typeof artifact !== 'object' || artifact === null) {
    return false;
  }
  const maybe = artifact as Partial<BTPAgentArtifact>;
  return (
    typeof maybe.to === 'string' &&
    typeof maybe.action === 'string' &&
    'agentId' in maybe &&
    'signature' in maybe
  );
};

/**
 * Checks if the artifact is a BTP control artifact
 * @param artifact - The artifact to check
 * @returns True if the artifact is a BTP control artifact, false otherwise
 */
export const isBtpsControlArtifact = (artifact: unknown): artifact is BTPControlArtifact => {
  if (typeof artifact !== 'object' || artifact === null) {
    return false;
  }
  const maybe = artifact as Partial<BTPControlArtifact>;
  return (
    typeof maybe.action === 'string' &&
    !('agentId' in maybe) &&
    !('document' in maybe) &&
    !('signature' in maybe) &&
    !('to' in maybe)
  );
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
 * @param operator - The identity operating the sender's domain (`op` in its `_btps.host` record)
 * @returns True if the artifact can be delegated, false otherwise
 * @condition for delegation:
 * - The artifact must have a delegation, a from and a delegation signedBy
 * - signedBy is the sender itself, as for a custom domain like `alice$alice.com`
 *   (an attestation by the operator is then required), or
 * - signedBy is the operator of the sender's domain. Being on the same domain is
 *   not enough: on a shared domain every user can hold a key of their own.
 */
export const isDelegationAllowed = (
  artifact: BTPTransporterArtifact,
  operator?: string,
): boolean => {
  const { delegation, from } = artifact || {};
  const signedBy = delegation?.signedBy;
  if (!from || !signedBy || !parseIdentity(from) || !parseIdentity(signedBy)) {
    return false;
  }

  return from === signedBy || (!!operator && signedBy === operator);
};
