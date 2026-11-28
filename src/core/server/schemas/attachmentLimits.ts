/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPS_FIELD_LIMITS } from '../constants/limits.js';

const { standard, ceiling } = BTPS_FIELD_LIMITS.documentAttachments;

/** Since 1.2: the types of document that carry attachments. */
export type BTPAttachingDocumentType = 'invoice' | 'receipt' | 'payslip' | 'letter' | 'agreement';

/**
 * Since 1.2: how many attachments a provider takes or sends in a document: one number for every
 * type, or one for each type, the rest at the standard 20, never above 1000. Every receiver takes
 * at least 20 of each, so a sender that sends no more is never refused for it; a receiver may take
 * more. A sender may hold its own documents to fewer, down to 0. An agreement's terms are its
 * attachments, so they are held to the same number.
 */
export type BTPAttachmentLimits = number | Partial<Record<BTPAttachingDocumentType, number>>;

/** Since 1.2: which side a provider's limits are for: what it takes, or what it sends. */
export type BTPAttachmentSide = 'receive' | 'send';

const TYPES: readonly BTPAttachingDocumentType[] = [
  'invoice',
  'receipt',
  'payslip',
  'letter',
  'agreement',
];

/**
 * The number a provider's setting gives for `type`. A value it cannot use never stops it: it is
 * warned about and replaced by the standard (when not a whole number, or, to receive, below it: a
 * receiver takes at least the standard), 0 (to send, below 0) or the ceiling.
 */
const usable = (value: number | undefined, type: string, side: BTPAttachmentSide): number => {
  if (value === undefined) return standard;
  if (!Number.isInteger(value)) {
    console.warn(
      `[BTPS] maxAttachments for ${type} ${value} is not a whole number; using ${standard}`,
    );
    return standard;
  }
  if (side === 'receive' && value < standard) {
    console.warn(
      `[BTPS] maxAttachments for ${type} ${value} is below the ${standard} every receiver takes; using ${standard}`,
    );
    return standard;
  }
  if (value < 0) {
    console.warn(`[BTPS] maxAttachments for ${type} ${value} is below 0; using 0`);
    return 0;
  }
  if (value > ceiling) {
    console.warn(
      `[BTPS] maxAttachments for ${type} ${value} is above ${ceiling}; using ${ceiling}`,
    );
    return ceiling;
  }
  return value;
};

/** Since 1.2: a provider's setting, one number for each type, checked once. */
export type BTPResolvedAttachmentLimits = Readonly<Record<BTPAttachingDocumentType, number>>;

export const resolveAttachmentLimits = (
  limits: BTPAttachmentLimits | undefined,
  side: BTPAttachmentSide,
): BTPResolvedAttachmentLimits =>
  Object.fromEntries(
    TYPES.map((type) => [
      type,
      usable(typeof limits === 'number' ? limits : limits?.[type], type, side),
    ]),
  ) as BTPResolvedAttachmentLimits;

/** The standard: 20 of each, what every receiver takes. */
export const STANDARD_ATTACHMENT_LIMITS = resolveAttachmentLimits(undefined, 'receive');

/**
 * What is wrong with a 1.2.0 document's attachments under `limits`, or undefined. Anything that
 * is not a document of a type that carries attachments is not this check's to judge.
 */
export const attachmentLimitProblem = (
  document: unknown,
  limits: BTPResolvedAttachmentLimits = STANDARD_ATTACHMENT_LIMITS,
): string | undefined => {
  if (typeof document !== 'object' || document === null) return undefined;
  const { type, attachments } = document as { type?: unknown; attachments?: unknown };
  if (!Array.isArray(attachments) || !TYPES.includes(type as BTPAttachingDocumentType)) {
    return undefined;
  }
  const max = limits[type as BTPAttachingDocumentType];
  return attachments.length > max
    ? `a ${String(type)} may carry at most ${max} attachments here; it carries ${attachments.length}`
    : undefined;
};
