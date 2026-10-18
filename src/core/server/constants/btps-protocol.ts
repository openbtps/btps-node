/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export const BTP_PROTOCOL_VERSION = '1.1.0';
export const MIN_SUPPORTED_VERSION = '1.1.0';
export const MAX_SUPPORTED_VERSION = '1.1.0';

const majorMinor = (version: string): [number, number] | undefined => {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(version);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
};

/**
 * Whether an artifact's `version` is one this SDK speaks. Compared by major and
 * minor only, so a later 1.1.x is still 1.1. 1.1 refuses 1.0: no independent
 * provider runs 1.0, so the break costs nothing now.
 */
export const isSupportedVersion = (version: unknown): boolean => {
  if (typeof version !== 'string') return false;
  const given = majorMinor(version);
  const min = majorMinor(MIN_SUPPORTED_VERSION);
  const max = majorMinor(MAX_SUPPORTED_VERSION);
  if (!given || !min || !max) return false;
  const rank = ([major, minor]: [number, number]) => major * 1000 + minor;
  return rank(given) >= rank(min) && rank(given) <= rank(max);
};
export const BTPS_DNS_HOST_NAME_SPACE = '_btps.host';
export const BTPS_DNS_IDENTITY_NAME_SPACE = '_btps.identity';
