/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { isValidIdentity, parseIdentity } from './identity.js';
import { computeAgentTrustId, computeTrustId } from '../trust/index.js';

describe('the identity rule', () => {
  it('accepts an account and a domain around one separator', () => {
    expect(parseIdentity('alice$saas.example')).toEqual({
      accountName: 'alice',
      domainName: 'saas.example',
    });
  });

  it('refuses a second separator, which earlier parts of an address could hide', () => {
    expect(isValidIdentity('alice$saas.example$evil.example')).toBe(false);
    expect(isValidIdentity('alice$$saas.example')).toBe(false);
  });

  it('refuses a ":" anywhere', () => {
    expect(isValidIdentity('agent:alice$saas.example')).toBe(false);
    expect(isValidIdentity('alice$saas.example:443')).toBe(false);
  });

  it('refuses a missing account or domain', () => {
    for (const identity of ['$saas.example', 'alice$', 'alice', '']) {
      expect(isValidIdentity(identity)).toBe(false);
    }
  });

  it('accepts letters, digits, ".", "_" and "-" in the account', () => {
    for (const identity of ['pat.doe$saas.example', 'pay_2$saas.example', 'a-b$saas.example']) {
      expect(isValidIdentity(identity)).toBe(true);
    }
  });

  it('refuses any other character in the account, so none can pass for another', () => {
    const lookalikes = [
      'bіlling$vendor.example', // Cyrillic і
      'billing​$vendor.example', // zero-width space
      'bill ing$vendor.example',
      'bill+ing$vendor.example',
      'bill@ing$vendor.example',
      'bïlling$vendor.example',
    ];
    for (const identity of lookalikes) expect(isValidIdentity(identity)).toBe(false);
  });

  it('refuses a domain that breaks DNS rules', () => {
    const domains = [
      'localhost', // one label
      'vendor..example',
      '-vendor.example',
      'vendor-.example',
      'vend_or.example',
      'vеndor.example', // Cyrillic е
      `${'a'.repeat(64)}.example`,
      `${'a.'.repeat(127)}example`, // over 253 characters
    ];
    for (const domain of domains) expect(isValidIdentity(`billing$${domain}`)).toBe(false);
  });

  it('accepts an international domain in its xn-- form', () => {
    expect(isValidIdentity('billing$xn--bcher-kva.example')).toBe(true);
    expect(isValidIdentity('billing$bücher.example')).toBe(false);
  });

  it('accepts capitals, which compare as the same address', () => {
    expect(isValidIdentity('Billing$Vendor.Example')).toBe(true);
    expect(computeTrustId('Billing$Vendor.Example', 'pay$client.example')).toBe(
      computeTrustId('billing$vendor.example', 'pay$client.example'),
    );
  });

  it('accounts and labels at their longest are accepted', () => {
    expect(isValidIdentity(`${'a'.repeat(64)}$${'b'.repeat(63)}.example`)).toBe(true);
    expect(isValidIdentity(`${'a'.repeat(65)}$vendor.example`)).toBe(false);
  });
});

describe('device record ids', () => {
  it('never equal the trust id between two identities, for the same names', () => {
    const bob = 'bob$example.com';
    expect(computeAgentTrustId('carol$other.com', bob)).not.toBe(
      computeTrustId('carol$other.com', bob),
    );
  });

  it('are the trust id of the agent id with an "agent:" prefix, which no identity can have', () => {
    const bob = 'bob$example.com';
    expect(computeAgentTrustId('btps_ag_1', bob)).toBe(computeTrustId('agent:btps_ag_1', bob));
    expect(isValidIdentity('agent:btps_ag_1')).toBe(false);
  });
});
