/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2, under 1.2.0: a document's BoundView, a signed canvas. Closed: every
 * key is named, and any other is refused. What its bindings name is checked
 * against the document by `boundViewBindingProblem`.
 */

import { z } from 'zod';
import { unzlibSync } from 'fflate';
import { BTPS_FIELD_LIMITS } from '../constants/limits.js';
import { boundedArray, boundedRecord } from './bounded.js';

const limits = BTPS_FIELD_LIMITS.boundView;

const hasTwoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

/** A number with at most two decimal places, from `min` to `max`. */
const decimal = (min: number, max: number) =>
  z.number().min(min).max(max).refine(hasTwoDecimals, 'has at most two decimal places');

const position = decimal(-limits.position, limits.position);
const size = decimal(0, limits.position);
const point = z.tuple([position, position]);
const opacity = z.number().min(0).max(1);

/** `#rrggbb`, or `#rrggbbaa` with opacity, in lower case. */
const colour = z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/, 'must be #rrggbb or #rrggbbaa');
/** A colour at full opacity: what a fact and a signature are drawn in. */
const solidColour = z.string().regex(/^#[0-9a-f]{6}$/, 'must be #rrggbb');

const stops = boundedArray(z.tuple([z.number().min(0).max(1), colour]), limits.stops, 2).refine(
  (list) => list.every(([offset], at) => at === 0 || offset >= (list[at - 1]?.[0] ?? 0)),
  'stops are in increasing order',
);

/** A colour, or a linear or radial gradient. */
const paint = z.union([
  colour,
  z.object({ linear: z.object({ from: point, to: point, stops }).strict() }).strict(),
  z
    .object({ radial: z.object({ centre: point, radius: size, stops }).strict() })
    .strict(),
]);

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, Z: 0 };

/**
 * An outline: absolute `M L H V Q C Z` commands, each with its own count of
 * numbers, each number an optional `-`, digits and at most two decimal places.
 * It starts with `M`. Nothing else is read.
 */
export const isPathData = (d: string): boolean => {
  const tokens = d.trim().split(/[\s,]+|(?=[A-Z])|(?<=[A-Z])/).filter(Boolean);
  let command: string | undefined;
  let numbers = 0;
  for (const token of tokens) {
    if (token in ARITY) {
      if (command !== undefined && numbers !== ARITY[command]) return false;
      if (command === undefined && token !== 'M') return false;
      command = token;
      numbers = 0;
    } else if (/^-?\d+(\.\d{1,2})?$/.test(token) && command !== undefined) {
      numbers++;
      if (numbers > (ARITY[command] ?? 0)) return false;
    } else {
      return false;
    }
  }
  return command !== undefined && numbers === ARITY[command];
};

const pathData = (max: number) =>
  z.string().min(1).max(max).refine(isPathData, 'must be M, L, H, V, Q, C and Z commands');

const fill = { fill: paint.optional(), opacity: opacity.optional() };
const stroke = { stroke: paint.optional(), strokeWidth: decimal(0, 100).optional() };
const box = { x: position, y: position, width: size, height: size };

const plainText = (text: string): boolean =>
  [...text].every((char) => {
    const code = char.codePointAt(0) ?? 0;
    const hidden = (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e);
    const isolate = code >= 0x2066 && code <= 0x2069;
    return code >= 0x20 && code !== 0x7f && !hidden && !isolate && code !== 0xfeff;
  });

const MONEY_SEPARATORS = [',', '.', ' ', "'", ''] as const;
const DATE_PATTERNS = [
  'd MMM yyyy',
  'd MMMM yyyy',
  'MMM d, yyyy',
  'MMMM d, yyyy',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'dd.MM.yyyy',
  'dd-MM-yyyy',
  'yyyy-MM-dd',
] as const;

const affix = z.string().max(limits.affix).refine(plainText, 'must be plain text');

/** How a bound value is written. */
const format = z.union([
  z
    .object({
      money: z
        .object({
          group: z.enum(MONEY_SEPARATORS),
          decimal: z.enum(['.', ',']),
          prefix: affix.optional(),
          suffix: affix.optional(),
        })
        .strict()
        .refine((money) => money.group !== money.decimal, 'group and decimal differ'),
    })
    .strict(),
  z.object({ date: z.enum(DATE_PATTERNS) }).strict(),
  z
    .object({
      percent: z
        .object({ decimals: z.union([z.literal(0), z.literal(1), z.literal(2)]), decimal: z.enum(['.', ',']) })
        .strict(),
    })
    .strict(),
  z
    .object({
      groups: z
        .object({
          sizes: boundedArray(z.number().int().min(1), limits.groups, 1),
          separator: z
            .string()
            .refine((value) => [...value].length === 1 && plainText(value), 'is one character'),
        })
        .strict(),
    })
    .strict(),
]);

/** Which signed field a text shows, how it is written, and which part of it. */
const binding = z
  .object({
    field: z.string().min(1).max(BTPS_FIELD_LIMITS.documentId * 4),
    format: format.optional(),
    range: z
      .tuple([z.number().int().min(0), z.number().int().min(0)])
      .refine(([start, end]) => start < end, 'a range starts before it ends')
      .optional(),
  })
  .strict()
  .refine((bind) => bind.range === undefined || bind.format === undefined, {
    message: 'a range is for text written as it is',
    path: ['range'],
  });

const textBox = {
  x: position,
  y: position,
  width: size,
  align: z.enum(['start', 'centre', 'end']),
  font: z.string().min(1),
  size: decimal(6, 400),
  colour: solidColour,
  letterSpacing: decimal(-10, 50).optional(),
  transform: z.enum(['uppercase', 'lowercase']).optional(),
};

const element = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('rect'),
      ...box,
      radius: z.union([size, z.tuple([size, size, size, size])]).optional(),
      ...fill,
      ...stroke,
    })
    .strict(),
  z
    .object({
      type: z.literal('line'),
      from: point,
      to: point,
      stroke: paint,
      strokeWidth: decimal(0, 100),
      dash: z.tuple([decimal(0, 1000), decimal(0, 1000)]).optional(),
      opacity: opacity.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('path'),
      d: pathData(limits.path),
      fillRule: z.enum(['nonzero', 'evenodd']).optional(),
      ...fill,
      ...stroke,
    })
    .strict(),
  z
    .object({ type: z.literal('image'), image: z.string().min(1), ...box, opacity: opacity.optional() })
    .strict(),
  z.object({ type: z.literal('text'), bind: binding, ...textBox }).strict(),
  z
    .object({
      type: z.literal('label'),
      text: z.string().min(1).max(limits.label).refine(plainText, 'must be plain text'),
      ...textBox,
    })
    .strict(),
  z.object({ type: z.literal('signature'), ...box, colour: solidColour }).strict(),
]);

const fontUnits = decimal(-65535, 65535);

/** A key that is exactly one character, or two, counted in code points. */
const oneCharacter = z.string().regex(/^.$/su, 'is one character');
const twoCharacters = z.string().regex(/^.{2}$/su, 'is two characters');

const font = z
  .object({
    unitsPerEm: z.number().int().min(16).max(16384),
    ascent: decimal(0, 65535),
    descent: decimal(0, 65535),
    glyphs: boundedRecord(
      z.object({ advance: decimal(0, 65535), path: pathData(limits.glyphPath).optional() }).strict(),
      limits.glyphs,
      oneCharacter,
    ).optional(),
    kerning: boundedRecord(fontUnits, limits.kerning, twoCharacters).optional(),
    fallback: boundedArray(
      z.enum(['arimo', 'tinos', 'cousine', 'carlito', 'caladea', 'sans-serif', 'serif', 'monospace']),
      limits.fallback,
      1,
    ).optional(),
  })
  .strict()
  .refine((value) => value.glyphs !== undefined || value.fallback !== undefined, {
    message: 'a font has glyphs, a fallback, or both',
  });

const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Whether `data` inflates to exactly `length` bytes. It never holds more than one byte past that. */
const inflatesTo = (data: string, length: number): boolean => {
  try {
    const out = unzlibSync(Buffer.from(data, 'base64'), { out: new Uint8Array(length + 1) });
    return out.length === length;
  } catch {
    return false;
  }
};

const image = z
  .object({
    width: z.number().int().min(1).max(limits.imageSide),
    height: z.number().int().min(1).max(limits.imageSide),
    encoding: z.literal('rgba8-deflate'),
    data: z.string().min(1).max(limits.imageData).regex(base64, 'must be base64'),
  })
  .strict()
  .superRefine((value, ctx) => {
    const pixels = value.width * value.height;
    if (pixels > limits.imagePixels) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `an image has at most ${limits.imagePixels} pixels`,
      });
    } else if (!inflatesTo(value.data, pixels * 4)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'data inflates to exactly width × height × 4 bytes',
        path: ['data'],
      });
    }
  });

const tooLarge = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length > limits.json;

/** A BoundView: its page, its fonts as glyph outlines, its images as pixels, and what is drawn, in order. */
export const BtpBoundViewSchema = z.preprocess(
  (value, ctx) => {
    if (typeof value === 'object' && value !== null && tooLarge(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a BoundView is at most ${limits.json} bytes as JSON`,
        fatal: true,
      });
    }
    return value;
  },
  z
    .object({
      format: z.literal(1),
      page: z
        .object({
          width: decimal(1, limits.pageWidth),
          height: decimal(1, limits.pageHeight),
          background: colour.optional(),
          breaks: boundedArray(position, limits.breaks).optional(),
        })
        .strict(),
      fonts: boundedRecord(font, limits.fonts).optional(),
      images: boundedRecord(image, limits.images).optional(),
      elements: boundedArray(element, limits.elements),
    })
    .strict()
    .superRefine((view, ctx) => {
      const issue = (message: string, path: (string | number)[]) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
      const breaks = view.page.breaks ?? [];
      if (breaks.some((at, index) => at <= 0 || at >= view.page.height || at <= (breaks[index - 1] ?? 0))) {
        issue('breaks are inside the page, in increasing order', ['page', 'breaks']);
      }
      let texts = 0;
      let paths = 0;
      view.elements.forEach((item, index) => {
        if ('strokeWidth' in item && (item.stroke === undefined) !== (item.strokeWidth === undefined)) {
          issue('stroke and strokeWidth come together', ['elements', index, 'strokeWidth']);
        }
        if (item.type === 'text' || item.type === 'label' || item.type === 'signature') texts++;
        if (item.type === 'path') paths += item.d.length;
        if ((item.type === 'text' || item.type === 'label') && view.fonts?.[item.font] === undefined) {
          issue('names a font the BoundView has', ['elements', index, 'font']);
        }
        if (item.type === 'text' && view.fonts?.[item.font]?.glyphs === undefined) {
          issue("a bound value is drawn with its font's own glyphs", ['elements', index, 'font']);
        }
        if (item.type === 'image' && view.images?.[item.image] === undefined) {
          issue('names an image the BoundView has', ['elements', index, 'image']);
        }
      });
      if (texts > limits.textElements) {
        issue(`at most ${limits.textElements} text, label and signature elements`, ['elements']);
      }
      if (paths > limits.paths) issue(`at most ${limits.paths} characters of paths`, ['elements']);
    }),
);

export type BTPBoundView = z.infer<typeof BtpBoundViewSchema>;
export type BTPBoundViewElement = BTPBoundView['elements'][number];
export type BTPBoundViewFont = NonNullable<BTPBoundView['fonts']>[string];
