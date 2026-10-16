/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1: an identity is `account$domain` by strict character rules.
 * Reproduced 2026-10-04: parseIdentity read `alice$saas.com$evil.org` as
 * domain `saas.com`. And no `:` (decided 2026-10-16), which closes the one gap in computeTrustId's `from:to`.
 */

import { describe, expect, it } from 'vitest';
import { isValidIdentity, parseIdentity } from './identity.js';
import { identitySchema } from '../server/schemas/shared.js';
import { computeTrustId } from '../trust/index.js';

const accepted = [
  'alice$saas.example',
  'test.user$subdomain.example.co.uk',
  'billing_team-2$acme-corp.example',
  'Billing$ACME.example',
  `${'a'.repeat(63)}$${'b'.repeat(63)}.example`,
  `${'a'.repeat(31)}.${'a'.repeat(32)}$saas.example`,
];

const refused: [string, string][] = [
  ['alice$saas.com$evil.org', 'a second $'],
  ['alice$$saas.example', 'an empty part between two $'],
  ['$saas.example', 'no account'],
  ['alice$', 'no domain'],
  ['alice', 'no $'],
  ['alice$localhost', 'a one-label domain'],
  ['alice$saas.example:evil.example', 'a : in the domain'],
  ['alice:evil$saas.example', 'a : in the account'],
  ['alice$saas.example:443', 'a port'],
  ['al ice$saas.example', 'a space'],
  ['alice@x$saas.example', 'an @'],
  ['alice+tag$saas.example', 'a +, which a DNS name cannot carry'],
  ['.alice$saas.example', 'an empty account part'],
  ['al..ice$saas.example', 'two dots in the account'],
  ['alice$saas..example', 'an empty label'],
  ['alice$-saas.example', 'a label starting with -'],
  ['alice$saas-.example', 'a label ending with -'],
  [`alice$${'b'.repeat(64)}.example`, 'a label over 63 characters'],
  [`${'a'.repeat(65)}$saas.example`, 'an account over 64 characters'],
  [`alice$${'b.'.repeat(130)}example`, 'over 256 characters'],
  ['alice$sääs.example', 'a character outside the rules'],
];

describe('an identity is account$domain, by strict character rules', () => {
  it.each(accepted)('accepts %s', (identity) => {
    expect(parseIdentity(identity)).toEqual({
      accountName: identity.slice(0, identity.indexOf('$')),
      domainName: identity.slice(identity.indexOf('$') + 1),
    });
    expect(identitySchema.safeParse(identity).success).toBe(true);
  });

  it.each(refused)('refuses %s (%s)', (identity) => {
    expect(parseIdentity(identity)).toBeNull();
    expect(isValidIdentity(identity)).toBe(false);
    expect(identitySchema.safeParse(identity).success).toBe(false);
  });

  it('reads alice$saas.com$evil.org as nothing, never as domain saas.com', () => {
    expect(parseIdentity('alice$saas.com$evil.org')).toBeNull();
  });

  it('refuses anything that is not a string', () => {
    expect(parseIdentity(undefined as unknown as string)).toBeNull();
    expect(isValidIdentity()).toBe(false);
  });

  it('two different pairs can no longer share a trust id through a colon', () => {
    // computeTrustId hashes `from:to`: these two pairs hash the same input.
    const pairs: [string, string][] = [
      ['a$b.example:c', 'd$e.example'],
      ['a$b.example', 'c:d$e.example'],
    ];
    expect(computeTrustId(...pairs[0]!)).toBe(computeTrustId(...pairs[1]!));
    // Neither pair is made of identities any more.
    for (const [from, to] of pairs)
      expect(isValidIdentity(from) && isValidIdentity(to)).toBe(false);
  });

  it('is linear on long input: the length is capped before any pattern runs', () => {
    // The 1.0 pattern /^\S+\$\S+\.\S+$/ backtracks quadratically on input like this.
    const hostile = `${'a$'.repeat(50_000)}`;
    const started = performance.now();
    expect(identitySchema.safeParse(hostile).success).toBe(false);
    expect(parseIdentity(`a$${'b'.repeat(200_000)}`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
  });
});
