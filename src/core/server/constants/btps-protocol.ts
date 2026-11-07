/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { DETAILS_ARTIFACT_TYPES, PERMISSION_ENVELOPE_FIELDS } from './permissions.js';

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

/** A document read as a record, or undefined when it is not one (an encrypted document is a string). */
const documentOf = (artifact: BTPVersionedArtifact): Record<string, unknown> | undefined =>
  typeof artifact.document === 'object' && artifact.document !== null
    ? (artifact.document as Record<string, unknown>)
    : undefined;

/** Whether an artifact uses something only 1.2 has. Each 1.2 addition adds its own test. */
const USES_1_2: ((artifact: BTPVersionedArtifact) => boolean)[] = [
  // The withdrawn event, and a proposal that follows one.
  (artifact) => {
    const event = documentOf(artifact);
    return (
      artifact.type === 'BTPS_EVENT' &&
      event !== undefined &&
      (event.eventType === 'withdrawn' || event.follows !== undefined)
    );
  },
  // A sync, naming the send it copies.
  (artifact) => artifact.syncOf !== undefined,
  // A note that says how it is written: 1.1 notes are plain strings.
  (artifact) => {
    const document = documentOf(artifact);
    const isNote = (value: unknown) => typeof value === 'object' && value !== null;
    return document !== undefined && (isNote(document.description) || isNote(document.message));
  },
  // A discount on a whole invoice or receipt. A line's `discount` column 1.1 already carries.
  (artifact) => documentOf(artifact)?.discount !== undefined,
  // A template on a letter or payslip. An invoice's or receipt's 1.1 already carries.
  (artifact) => {
    const document = documentOf(artifact);
    return (
      (document?.type === 'letter' || document?.type === 'payslip') &&
      document.template !== undefined
    );
  },
  // Trust permissions on the envelope: names, kind, grants and a send's documentType.
  (artifact) =>
    Object.keys(PERMISSION_ENVELOPE_FIELDS).some((field) => artifact[field] !== undefined),
  // Trust permission values in the document: a request's own values and verification, an answer's details.
  (artifact) => {
    const document = documentOf(artifact);
    return (
      (artifact.type === 'TRUST_REQ' &&
        (document?.own !== undefined || document?.verification !== undefined)) ||
      (artifact.type === 'TRUST_RES' && document?.details !== undefined)
    );
  },
  // A details refresh artifact: a notice, a request or its answer.
  (artifact) => (DETAILS_ARTIFACT_TYPES as readonly unknown[]).includes(artifact.type),
];

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
