/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { ParsedIdentity } from './types.js';
import { BTP_DOC_LIMITS } from '@core/server/constants/documents.js';

/**
 * The longest identity accepted, in characters (the documents' own cap). It
 * is checked before anything else, so no rule below ever reads more.
 */
const IDENTITY_MAX_LENGTH = BTP_DOC_LIMITS.IDENTITY_MAX_LENGTH;
/** The longest account name (`alice` in `alice$saas.example`). */
const ACCOUNT_MAX_LENGTH = 64;
/** The longest domain name (RFC 1035). */
const DOMAIN_MAX_LENGTH = 253;

// Each pattern below runs on one dot-separated part of at most 63 characters
// and has no nested or overlapping repetition: linear in its input.
const ACCOUNT_PART = /^[A-Za-z0-9_-]+$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

const validParts = (value: string, part: RegExp, minParts: number): boolean => {
  const parts = value.split('.');
  return parts.length >= minParts && parts.every((p) => p.length <= 63 && part.test(p));
};

/**
 * Reads `account$domain`, by strict character rules (BTPS 1.1), and
 * returns null for anything else:
 * - exactly one `$`;
 * - the account: one or more parts of `A-Z a-z 0-9 _ -`, separated by single
 *   dots, at most 64 characters. It becomes part of a DNS name
 *   (`<selector>._btps.identity.<account>.<domain>`);
 * - the domain: a host name of at least two labels, each `A-Z a-z 0-9 -`,
 *   not starting or ending with `-`, at most 253 characters;
 * - so never a `:`. A trust id hashes `from:to`, and an address with a colon
 *   could make two pairs share one.
 */
export const parseIdentity = (identity: string): ParsedIdentity | null => {
  if (typeof identity !== 'string' || identity.length > IDENTITY_MAX_LENGTH) return null;
  const separator = identity.indexOf('$');
  if (separator === -1 || identity.indexOf('$', separator + 1) !== -1) return null;

  const accountName = identity.slice(0, separator);
  const domainName = identity.slice(separator + 1);
  if (
    accountName.length > ACCOUNT_MAX_LENGTH ||
    domainName.length > DOMAIN_MAX_LENGTH ||
    !validParts(accountName, ACCOUNT_PART, 1) ||
    !validParts(domainName, DOMAIN_LABEL, 2)
  ) {
    return null;
  }
  return { accountName, domainName };
};

export const isValidIdentity = (identity: string = ''): boolean => parseIdentity(identity) !== null;
