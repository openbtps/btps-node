/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { ParsedIdentity } from './types.js';

/** The account part: letters, digits, `.`, `_` and `-`, up to 64 characters. */
const ACCOUNT = /^[a-z0-9._-]{1,64}$/;

/**
 * One label of the domain, as DNS names it: letters, digits and `-`, 1 to 63
 * characters, not starting or ending with `-`. An international name is
 * written in its `xn--` form, which this already allows.
 */
const DOMAIN_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Splits an identity into its account and domain: `account$domain`. The one
 * place the address rule lives, so every check that needs it uses this.
 *
 * An identity has exactly one separator. The account is letters, digits, `.`,
 * `_` and `-`; the domain follows DNS's rules, with at least two labels. So
 * no character can look like another (a Cyrillic `і` for an `i`), and no `:`
 * can appear: a trust id is a hash of `from:to`, and a device's record id
 * carries an `agent:` prefix that no identity can then imitate. Letters
 * compare without case, as in DNS and in trust ids.
 */
export const parseIdentity = (identity: string): ParsedIdentity | null => {
  const parts = identity.split('$');
  if (parts.length !== 2) return null;
  const [accountName, domainName] = parts;
  if (!ACCOUNT.test(accountName.toLowerCase())) return null;

  const labels = domainName.toLowerCase().split('.');
  if (domainName.length > 253 || labels.length < 2) return null;
  if (!labels.every((label) => DOMAIN_LABEL.test(label))) return null;

  return {
    accountName,
    domainName,
  };
};

export const isValidIdentity = (identity: string = '') => {
  const parsedIdentity = parseIdentity(identity);
  return !!parsedIdentity;
};
