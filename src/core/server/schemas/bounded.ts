/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * zod 3 keeps parsing every element after a `.max()` fails, and makes one issue
 * per invalid element with no cap (GHSA-mrhx-c7xc-m3w5): a 5 MB list costs
 * gigabytes. These wrappers look before zod does. Over the limit, or at the
 * first invalid entry of a long list, they raise one fatal issue, and zod
 * returns invalid without parsing inside.
 */

import { z } from 'zod';

/**
 * Above this many entries, a list is checked one entry at a time before zod
 * parses it, stopping at the first invalid one. At or below it, zod alone.
 */
export const PRECHECK_THRESHOLD = 100;

const tooMany = (ctx: z.RefinementCtx, max: number, unit: 'entries' | 'keys') =>
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `must have at most ${max} ${unit}`,
    params: { maximum: max },
    fatal: true,
  });

/** A list of at most `max` entries. */
export const boundedArray = <T extends z.ZodTypeAny>(element: T, max: number) =>
  z.preprocess((value, ctx) => {
    if (!Array.isArray(value)) return value;
    if (value.length > max) {
      tooMany(ctx, max, 'entries');
      return value;
    }
    if (value.length <= PRECHECK_THRESHOLD) return value;
    for (let i = 0; i < value.length; i++) {
      const result = element.safeParse(value[i]);
      if (!result.success) {
        const [issue] = result.error.issues;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, ...(issue?.path ?? [])],
          message: issue?.message ?? 'Invalid',
          fatal: true,
        });
        break;
      }
    }
    return value;
  }, z.array(element));

/** A record of at most `max` keys. No limit is above the threshold, so zod checks the values. */
export const boundedRecord = <V extends z.ZodTypeAny>(
  valueSchema: V,
  max: number,
  keySchema: z.ZodString = z.string(),
) =>
  z.preprocess(
    (value, ctx) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
      if (Object.keys(value).length > max) tooMany(ctx, max, 'keys');
      return value;
    },
    z.record(keySchema, valueSchema),
  );
