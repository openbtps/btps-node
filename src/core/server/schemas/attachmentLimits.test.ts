/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  STANDARD_ATTACHMENT_LIMITS,
  attachmentLimitProblem,
  resolveAttachmentLimits,
} from './attachmentLimits.js';
import { processBtpDocSchema } from './helpers.js';
import { BTPS_FIELD_LIMITS } from '../constants/limits.js';

const attachment = {
  content: 'JVBERi0=',
  type: 'application/pdf',
  filename: 'a.pdf',
  size: 5,
  sha256: 'a'.repeat(64),
};
const letter = (count: number) => ({
  type: 'letter',
  title: 'Terms',
  id: 'LET-1',
  issuedAt: '2026-11-29T00:00:00.000Z',
  body: { format: 'text', content: 'Hello' },
  attachments: Array.from({ length: count }, () => attachment),
});

describe('resolveAttachmentLimits', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is 20 of each when not given, one number for every type, or one per type', () => {
    expect(STANDARD_ATTACHMENT_LIMITS).toEqual({
      invoice: 20,
      receipt: 20,
      payslip: 20,
      letter: 20,
      agreement: 20,
    });
    expect(resolveAttachmentLimits(50, 'receive').letter).toBe(50);
    expect(resolveAttachmentLimits({ letter: 100, agreement: 100 }, 'receive')).toEqual({
      invoice: 20,
      receipt: 20,
      payslip: 20,
      letter: 100,
      agreement: 100,
    });
  });

  it('lets a sender hold its own documents to fewer, down to none', () => {
    expect(
      resolveAttachmentLimits({ invoice: 1, receipt: 1, payslip: 0, letter: 100 }, 'send'),
    ).toEqual({ invoice: 1, receipt: 1, payslip: 0, letter: 100, agreement: 20 });
  });

  it('never lets a receiver take fewer than the 20 every receiver takes: warned, and 20 used', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveAttachmentLimits({ invoice: 1, letter: 0 }, 'receive')).toMatchObject({
      invoice: 20,
      letter: 20,
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('warns and uses what it can for values it cannot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      resolveAttachmentLimits({ letter: -1, invoice: 1.5, agreement: 5000 }, 'send'),
    ).toMatchObject({
      letter: 0,
      invoice: 20,
      agreement: BTPS_FIELD_LIMITS.documentAttachments.ceiling,
    });
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe('attachmentLimitProblem', () => {
  it('says how many a type may carry here, and how many it carries', () => {
    const limits = resolveAttachmentLimits({ letter: 2 }, 'send');
    expect(attachmentLimitProblem(letter(2), limits)).toBeUndefined();
    expect(attachmentLimitProblem(letter(3), limits)).toBe(
      'a letter may carry at most 2 attachments here; it carries 3',
    );
  });

  it('judges nothing that is not a document carrying attachments', () => {
    expect(attachmentLimitProblem('encrypted', STANDARD_ATTACHMENT_LIMITS)).toBeUndefined();
    expect(
      attachmentLimitProblem({ type: 'trust_request' }, STANDARD_ATTACHMENT_LIMITS),
    ).toBeUndefined();
  });
});

describe('a document’s schema and its attachments', () => {
  it('holds a 1.2.0 document to 20 by default, to a provider’s own, or to the ceiling only', () => {
    expect(processBtpDocSchema('BTPS_DOC', '1.2.0')!.safeParse(letter(20)).success).toBe(true);
    expect(processBtpDocSchema('BTPS_DOC', '1.2.0')!.safeParse(letter(21)).success).toBe(false);
    const own = resolveAttachmentLimits({ letter: 100 }, 'receive');
    expect(processBtpDocSchema('BTPS_DOC', '1.2.0', own)!.safeParse(letter(100)).success).toBe(
      true,
    );
    expect(
      processBtpDocSchema('BTPS_DOC', '1.2.0', 'ceiling')!.safeParse(letter(1000)).success,
    ).toBe(true);
    expect(
      processBtpDocSchema('BTPS_DOC', '1.2.0', 'ceiling')!.safeParse(letter(1001)).success,
    ).toBe(false);
  });

  it('keeps a 1.1.0 document at 10, as 1.1 reads it, and a sender may hold its own to fewer', () => {
    expect(processBtpDocSchema('BTPS_DOC', '1.1.0')!.safeParse(letter(10)).success).toBe(true);
    expect(processBtpDocSchema('BTPS_DOC', '1.1.0')!.safeParse(letter(11)).success).toBe(false);
    const one = resolveAttachmentLimits({ letter: 1 }, 'send');
    expect(processBtpDocSchema('BTPS_DOC', '1.1.0', one)!.safeParse(letter(2)).success).toBe(false);
  });
});
