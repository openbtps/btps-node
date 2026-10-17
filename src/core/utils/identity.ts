/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { ParsedIdentity } from './types.js';

/**
 * Splits an identity into its account and domain: `account$domain`. The one
 * place the address rule lives, so every check that needs it uses this.
 *
 * An identity has exactly one separator and no `:` anywhere. A trust id is a
 * hash of `from:to`, so a `:` in an address could make two pairs share an id,
 * and a device's record id carries an `agent:` prefix that no identity can
 * then imitate.
 */
export const parseIdentity = (identity: string): ParsedIdentity | null => {
  if (identity.includes(':')) return null;
  const parts = identity.split('$');
  if (parts.length !== 2) return null;
  const [accountName, domainName] = parts;
  if (!accountName || !domainName) return null;

  return {
    accountName,
    domainName,
  };
};

export const isValidIdentity = (identity: string = '') => {
  const parsedIdentity = parseIdentity(identity);
  return !!parsedIdentity;
};
