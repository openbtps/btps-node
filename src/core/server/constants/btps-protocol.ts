/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export const BTP_PROTOCOL_VERSION = '1.2.0';
export const MIN_SUPPORTED_VERSION = '1.1.0';
export const MAX_SUPPORTED_VERSION = '1.2.0';

/** A version by major and minor, so a later 1.1.x is still 1.1; undefined when it is not a version. */
const rank = (version: string): number | undefined => {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(version);
  return match ? Number(match[1]) * 1000 + Number(match[2]) : undefined;
};

/**
 * Whether an artifact's `version` is one this SDK speaks: 1.1 and 1.2. It
 * refuses 1.0: no independent provider runs 1.0, so the break costs nothing.
 */
export const isSupportedVersion = (version: unknown): boolean => {
  if (typeof version !== 'string') return false;
  const given = rank(version);
  const min = rank(MIN_SUPPORTED_VERSION);
  const max = rank(MAX_SUPPORTED_VERSION);
  if (given === undefined || min === undefined || max === undefined) return false;
  return given >= min && given <= max;
};

/** Whether `version` is older than `than`, by major and minor. One that is not a version is older. */
export const isVersionBelow = (version: string, than: string): boolean => {
  const given = rank(version);
  const needed = rank(than);
  return given === undefined || (needed !== undefined && given < needed);
};

/** An artifact before it is signed: its type, its document, and the rest of its envelope. */
export type BTPVersionedArtifact = { type?: string; document?: unknown; [key: string]: unknown };

/** Whether an artifact uses something only 1.2 has. Each 1.2 addition adds its own test. */
const USES_1_2: ((artifact: BTPVersionedArtifact) => boolean)[] = [];

/**
 * The version an artifact is stamped with: 1.1.0 whenever everything in it can
 * be said in 1.1, so a 1.1 receiver takes it, and 1.2.0 only when it uses
 * something 1.2 adds. An encrypted artifact is stamped from its document before
 * it is encrypted.
 */
export const artifactVersion = (artifact: BTPVersionedArtifact): string =>
  USES_1_2.some((uses) => uses(artifact)) ? '1.2.0' : MIN_SUPPORTED_VERSION;
export const BTPS_DNS_HOST_NAME_SPACE = '_btps.host';
export const BTPS_DNS_IDENTITY_NAME_SPACE = '_btps.identity';
