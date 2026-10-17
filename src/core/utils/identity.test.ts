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
