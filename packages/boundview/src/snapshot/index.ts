/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * snapshotBoundView: a platform's own HTML preview, as the browser laid it out,
 * captured as a BoundView. Runs in the browser where the preview is shown. No
 * marks in the preview: every fact is found by its value (bind.ts), fonts are
 * read from the page's own font files (fonts.ts), images as their pixels, and
 * an SVG logo as its outlines when they draw exactly as the browser did.
 */

import * as opentypeModule from 'opentype.js';
import { zlibSync } from 'fflate';
import { Resvg } from '@resvg/resvg-wasm';
import {
  BtpBoundViewSchema,
  checkBoundView,
  boundValue,
  writtenValue,
  type BTPBoundView,
  type BTPBoundViewElement,
  type BTPBoundViewFont,
  type BTPBoundViewResult,
} from '@btps/sdk/boundview';
import { initBoundViewEngine, type BoundViewEngineSource } from '../render.js';
import { boundViewToSvg } from '../svg.js';
import { loadBundledFonts } from '../glyphs.js';
import { bindRuns, type Run, type Segment } from './bind.js';
import { fallbackFor, glyphTable, variationFor, type OpenTypeFont } from './fonts.js';
import { normalizePath, pathData, shapeOutline, type Matrix } from './svgPath.js';
import { isWoff2, woff2ToSfnt } from './woff2.js';

type Doc = Record<string, unknown>;
type Element = BTPBoundViewElement;
type Image = NonNullable<BTPBoundView['images']>[string];
type Box = { left: number; top: number; width: number; height: number };

export type SnapshotOptions = {
  /**
   * Where the drawing engine's WebAssembly is served from. With it, an SVG
   * logo travels as its outlines when they draw exactly as the browser drew
   * them; without it, as its pixels.
   */
  engine?: BoundViewEngineSource;
  /** Told of each label that looks like a fact but shows none: most often an example left in a design. */
  onWarning?: (warning: string) => void;
};

/** A BoundView that cannot be sent as it is, and why. */
export class BoundViewSnapshotError extends Error {
  constructor(
    message: string,
    readonly problems: string[],
    /** The BoundView a receiver would refuse, when one was made: to see which element and why. */
    readonly view?: BTPBoundView,
  ) {
    super(`${message}: ${problems.join('; ')}`);
    this.name = 'BoundViewSnapshotError';
  }
}

/**
 * opentype.js's `parse`, from whichever build the app's bundler or Node chose: its ES module build names it and has no
 * default export (a strict bundler refuses a default import of it); its UMD build is a default export holding it.
 */
const parseFont = (buffer: ArrayBuffer): unknown => {
  const named = opentypeModule.parse;
  // Read by reflection: a bundler that sees `.default` on a module without one warns about it.
  const umd = Reflect.get(opentypeModule, 'default') as { parse(buffer: ArrayBuffer): unknown };
  return (named ?? umd.parse)(buffer);
};

/** The most fonts a BoundView carries (the specification's Limits page; the SDK's BTPS_FIELD_LIMITS.boundView.fonts). */
const MAX_FONTS = 8;

const r2 = (value: number) => Math.round(value * 100) / 100;
const ceil2 = (value: number) => Math.ceil(value * 100 - 1e-6) / 100;
const floor2 = (value: number) => Math.floor(value * 100 + 1e-6) / 100;

/**
 * A text's box width from its (rounded) left edge to where the browser drew its right edge, rounded down: text that
 * touches what follows it (a value split across elements, a comma) must not reach into it.
 */
const boxWidth = (x: number, right: number) => Math.max(0, floor2(floor2(right) - x));

// ---- Colour ----

let probe: CanvasRenderingContext2D | undefined;

/** A CSS colour as `#rrggbb` or `#rrggbbaa`, by the browser's own reading of it; undefined when transparent. */
const hex = (css: string): string | undefined => {
  probe ??= document.createElement('canvas').getContext('2d') ?? undefined;
  if (!probe) return undefined;
  probe.fillStyle = '#000000';
  probe.fillStyle = css;
  const read = String(probe.fillStyle);
  if (read.startsWith('#')) return read.toLowerCase();
  const match = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/.exec(read);
  if (!match) return undefined;
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (alpha === 0) return undefined;
  const two = (n: number) => n.toString(16).padStart(2, '0');
  return `#${two(Number(match[1]))}${two(Number(match[2]))}${two(Number(match[3]))}${alpha < 1 ? two(Math.round(alpha * 255)) : ''}`;
};

const solid = (colour: string) => colour.slice(0, 7);

// ---- Pixels ----

const toBase64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

/**
 * An image as the browser shows it, at twice its box or at its own resolution if that is more (a logo drawn small from a
 * larger file stays sharp when the view is enlarged), where the limits allow: every pixel, compressed losslessly.
 */
const capturePixels = (draw: (context: CanvasRenderingContext2D, width: number, height: number) => void, box: Box, own?: { width: number; height: number }): Image => {
  const wanted = Math.max(2, own ? Math.min(own.width / box.width, own.height / box.height) : 0);
  const scale = Math.min(wanted, 1024 / box.width, 1024 / box.height, Math.sqrt(262144 / (box.width * box.height)));
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  draw(context, width, height);
  // Throws for an image from another site that does not allow it: the caller says so.
  const rgba = context.getImageData(0, 0, width, height).data;
  return { width, height, encoding: 'rgba8-deflate', data: toBase64(zlibSync(new Uint8Array(rgba.buffer))) };
};

/**
 * Where an <img> draws in its box of `width` by `height` (at `scale` to the page), as its object-fit and object-position
 * place it: a logo kept in proportion in a box of another shape is never stretched to the box.
 */
const fitted = (image: HTMLImageElement, css: CSSStyleDeclaration, width: number, height: number, scale: number): [number, number, number, number] => {
  const own = { width: image.naturalWidth * scale, height: image.naturalHeight * scale };
  if (!own.width || !own.height || css.objectFit === 'fill' || !css.objectFit) return [0, 0, width, height];
  const fit = Math.min(width / own.width, height / own.height);
  const ratio =
    css.objectFit === 'contain' ? fit
    : css.objectFit === 'cover' ? Math.max(width / own.width, height / own.height)
    : css.objectFit === 'scale-down' ? Math.min(1, fit)
    : 1;
  const w = own.width * ratio;
  const h = own.height * ratio;
  // Each of object-position's two values: a percentage of the room left, a length from the edge, or a keyword.
  const at = (value: string | undefined, room: number) => {
    const keyword = { left: 0, top: 0, center: 50, right: 100, bottom: 100 }[value ?? 'center'];
    if (keyword !== undefined) return (room * keyword) / 100;
    if (value?.endsWith('%')) return (room * parseFloat(value)) / 100;
    return (parseFloat(value ?? '') || 0) * scale;
  };
  const [x, y] = (css.objectPosition || '50% 50%').split(/\s+/);
  return [at(x, width - w), at(y ?? x, height - h), w, h];
};

const loaded = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${src}`));
    image.src = src;
  });

// ---- SVG logos as outlines ----

const IGNORED = new Set(['defs', 'title', 'desc', 'metadata', 'style', 'g', 'svg']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

/** An SVG's shapes as BoundView paths on the page, or undefined when it holds anything a path cannot carry. */
const svgPaths = (svg: SVGSVGElement, origin: DOMRect, offset: [number, number] = [0, 0]): Element[] | undefined => {
  const out: Element[] = [];
  for (const node of svg.querySelectorAll('*')) {
    const tag = node.tagName.toLowerCase();
    if (node.closest('defs, clipPath, mask, symbol, pattern') && tag !== 'defs') continue;
    if (IGNORED.has(tag)) {
      if (node.getAttribute('filter') || node.getAttribute('mask') || node.getAttribute('clip-path')) return undefined;
      continue;
    }
    if (!SHAPES.has(tag)) return undefined;
    const shape = node as SVGGraphicsElement;
    const style = getComputedStyle(shape);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (style.filter !== 'none' || style.mask !== 'none' || style.clipPath !== 'none' || style.strokeDasharray !== 'none') {
      return undefined;
    }
    const number = (name: string) => {
      const value = shape.getAttribute(name);
      return value === null ? 0 : parseFloat(value);
    };
    let d: string | undefined;
    if (tag === 'path') d = shape.getAttribute('d') ?? undefined;
    else if (tag === 'polyline' || tag === 'polygon') {
      const points = (shape.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
      d = points.reduce((path, value, i) => path + (i % 2 === 0 ? `${i === 0 ? 'M' : 'L'}${value}` : ` ${value}`), '');
      if (tag === 'polygon') d += 'Z';
    } else d = shapeOutline(tag, number);
    const commands = d ? normalizePath(d) : undefined;
    const ctm = shape.getScreenCTM();
    if (!commands || !ctm) return undefined;
    const matrix: Matrix = [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e - origin.left - offset[0], ctm.f - origin.top - offset[1]];
    let opacity = 1;
    for (let at: Element | globalThis.Element | null = shape; at && at !== svg.parentElement; at = (at as globalThis.Element).parentElement) {
      opacity *= Number(getComputedStyle(at as globalThis.Element).opacity);
    }
    const paint = (css: string, alpha: string) => {
      if (css === 'none') return undefined;
      if (css.startsWith('url(')) return null;
      const colour = hex(css);
      if (colour === undefined) return undefined;
      const a = Math.round((colour.length === 9 ? parseInt(colour.slice(7), 16) / 255 : 1) * Number(alpha) * 255);
      return a >= 255 ? solid(colour) : `${solid(colour)}${a.toString(16).padStart(2, '0')}`;
    };
    const fill = paint(style.fill, style.fillOpacity);
    const stroke = paint(style.stroke, style.strokeOpacity);
    if (fill === null || stroke === null) return undefined;
    const scale = Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c));
    const strokeWidth = r2(parseFloat(style.strokeWidth) * scale);
    if (strokeWidth > 100) return undefined;
    out.push({
      type: 'path',
      d: pathData(commands, matrix),
      ...(fill && { fill }),
      ...(stroke && strokeWidth > 0 && { stroke, strokeWidth }),
      ...(style.fillRule === 'evenodd' && { fillRule: 'evenodd' as const }),
      ...(opacity < 1 && { opacity: r2(opacity) }),
    } as Element);
  }
  return out;
};

/** The browser's own picture of an SVG in its box, at `scale`, over white. */
const browserPixels = async (svg: SVGSVGElement, box: Box, scale: number, floor = false) => {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('width', String(box.width));
  copy.setAttribute('height', String(box.height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    const image = await loaded(url);
    const canvas = document.createElement('canvas');
    const round = floor ? Math.floor : Math.round;
    canvas.width = Math.max(1, round(box.width * scale));
    canvas.height = Math.max(1, round(box.height * scale));
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * Whether outlines draw as the browser drew the SVG: the engine's picture and
 * the browser's, over white at twice the box, differ by at most 3 a channel
 * on average, and by more than 64 at no more than 1% of pixels. Anything else
 * (an effect the outlines could not carry) and the logo travels as pixels.
 */
const drawsAlike = async (svg: SVGSVGElement, box: Box, paths: Element[]) => {
  const view = { format: 1, page: { width: box.width, height: box.height }, elements: paths } as unknown as BTPBoundView;
  const engine = new Resvg(boundViewToSvg({}, view), { fitTo: { mode: 'zoom', value: 2 }, font: { loadSystemFonts: false } });
  // The engine's memory freed by hand, as the renderer frees it.
  const rendered = engine.render();
  const ours = rendered.pixels.slice();
  rendered.free();
  engine.free();
  const theirs = await browserPixels(svg, box, 2);
  if (ours.length !== theirs.length) return false;
  let total = 0;
  let far = 0;
  for (let i = 0; i < ours.length; i += 4) {
    let worst = 0;
    for (let k = 0; k < 3; k++) {
      const diff = Math.abs((ours[i + k] ?? 0) - (theirs[i + k] ?? 0));
      total += diff;
      worst = Math.max(worst, diff);
    }
    if (worst > 64) far++;
  }
  const pixels = ours.length / 4;
  return total / (pixels * 3) <= 3 && far / pixels <= 0.01;
};

// ---- Fonts ----

/** A font file the page draws a family with, and the characters it is for (`unicode-range`); none means all. */
type FontFile = { font: OpenTypeFont; ranges?: [number, number][] };

const fontFiles = new Map<string, Promise<FontFile[] | undefined>>();

/** A `unicode-range` as code point ranges. */
const unicodeRanges = (css: string): [number, number][] | undefined => {
  const ranges = css
    .split(',')
    .map((part) => part.trim().replace(/^U\+/i, ''))
    .filter(Boolean)
    .map((part): [number, number] => {
      if (part.includes('?')) return [parseInt(part.replace(/\?/g, '0'), 16), parseInt(part.replace(/\?/g, 'F'), 16)];
      const [from, to = from] = part.split('-');
      return [parseInt(from as string, 16), parseInt(to as string, 16)];
    });
  return ranges.length > 0 && ranges.every(([from, to]) => Number.isFinite(from) && Number.isFinite(to)) ? ranges : undefined;
};

/** Reads a font file: a woff or ttf as it is, a woff2 decompressed first (woff2.ts, with Brotli loaded only then). */
const readFont = async (url: string): Promise<OpenTypeFont | undefined> => {
  try {
    let bytes = await (await fetch(url)).arrayBuffer();
    if (isWoff2(bytes)) {
      const { decompress } = await import('brotli/decompress');
      bytes = woff2ToSfnt(bytes, decompress);
    }
    return parseFont(bytes) as unknown as OpenTypeFont;
  } catch {
    return undefined;
  }
};

/**
 * The font files the page uses for a family, weight and style, from its own @font-face rules: the nearest weight, and
 * every file of it a `unicode-range` splits it into (latin, latin-ext, cyrillic…). The browser drew each character
 * with the file whose range holds it, and so do we.
 */
const fontFile = (family: string, weight: number, style: string): Promise<FontFile[] | undefined> => {
  const key = `${family}|${weight}|${style}`;
  if (!fontFiles.has(key)) {
    fontFiles.set(
      key,
      (async () => {
        const candidates: { url: string; distance: number; ranges?: [number, number][] }[] = [];
        for (const sheet of document.styleSheets) {
          let rules: CSSRuleList;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of rules) {
            if (!(rule instanceof CSSFontFaceRule)) continue;
            const name = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
            if (name.toLowerCase() !== family.toLowerCase()) continue;
            if ((rule.style.getPropertyValue('font-style').trim() || 'normal') !== style) continue;
            const weights = (rule.style.getPropertyValue('font-weight').trim() || '400')
              .split(/\s+/)
              .map((value) => (value === 'bold' ? 700 : value === 'normal' ? 400 : Number(value)));
            const distance = weights.length === 2 && weight >= (weights[0] ?? 0) && weight <= (weights[1] ?? 0) ? 0 : Math.abs((weights[0] ?? 400) - weight);
            // A woff or ttf where the rule offers one (read as it is), else its woff2.
            const sources = [...rule.style.getPropertyValue('src').matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1] as string);
            const source = sources.find((src) => !/\.woff2(\?|#|$)/i.test(src)) ?? sources[0];
            if (!source) continue;
            const ranges = unicodeRanges(rule.style.getPropertyValue('unicode-range'));
            candidates.push({ url: new URL(source, sheet.href ?? location.href).href, distance, ...(ranges && { ranges }) });
          }
        }
        if (candidates.length === 0) return undefined;
        const nearest = Math.min(...candidates.map(({ distance }) => distance));
        const read = await Promise.all(
          candidates
            .filter(({ distance }) => distance === nearest)
            .map(async ({ url, ranges }) => {
              const font = await readFont(url);
              return font ? { font, ...(ranges && { ranges }) } : undefined;
            }),
        );
        const files = read.filter((file): file is FontFile => file !== undefined);
        return files.length > 0 ? files : undefined;
      })(),
    );
  }
  return fontFiles.get(key) as Promise<FontFile[] | undefined>;
};

/**
 * Which of a family's files draws `char`, as the browser chooses (CSS Fonts, unicode-range): of the files whose range
 * holds it, the last defined first, and the next where one has no glyph for it.
 */
const fileFor = (files: FontFile[], char: string): FontFile | undefined => {
  const code = char.codePointAt(0) ?? 0;
  const holding = files.filter(({ ranges }) => ranges === undefined || ranges.some(([from, to]) => code >= from && code <= to)).reverse();
  return holding.find(({ font }) => font.charToGlyph(char).index !== 0) ?? holding[0];
};

// ---- Reading the preview ----

type Style = { family: string; weight: number; style: string; size: number; colour: string; spacing: number; transform?: 'uppercase' | 'lowercase'; tabular: boolean };
type LaidRun = Run & { style: Style; top: number };

const styleOf = (element: globalThis.Element): Style => {
  const css = getComputedStyle(element);
  return {
    family: (css.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim(),
    weight: Number(css.fontWeight) || 400,
    style: css.fontStyle === 'italic' || css.fontStyle === 'oblique' ? 'italic' : 'normal',
    size: parseFloat(css.fontSize),
    colour: solid(hex(css.color) ?? '#000000'),
    spacing: css.letterSpacing === 'normal' ? 0 : parseFloat(css.letterSpacing) || 0,
    ...(css.textTransform === 'uppercase' || css.textTransform === 'lowercase' ? { transform: css.textTransform } : {}),
    tabular: css.fontVariantNumeric.includes('tabular'),
  };
};

/** Each text node as runs, one a line it was laid out on, with each character's box and the line's baseline. */
export const textRuns = (root: HTMLElement, origin: DOMRect): LaidRun[] => {
  const runs: LaidRun[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const measure = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  // The block each text flows in: its nearest ancestor that is not inline.
  const blocks = new Map<globalThis.Element, number>();
  const blockOf = (element: globalThis.Element) => {
    let at: globalThis.Element = element;
    while (at !== root && at.parentElement && ['inline', 'contents'].includes(getComputedStyle(at).display)) at = at.parentElement;
    if (!blocks.has(at)) blocks.set(at, blocks.size);
    return blocks.get(at) as number;
  };
  let index = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('svg') || !node.textContent?.trim()) continue;
    // Text the page does not draw: hidden, or in an element not laid out (display: none, a closed details).
    if (getComputedStyle(parent).visibility === 'hidden') continue;
    if (typeof parent.checkVisibility === 'function' && !parent.checkVisibility()) continue;
    const css = getComputedStyle(parent);
    measure.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    const ascent = measure.measureText('Hg').fontBoundingBoxAscent;
    const style = styleOf(parent);
    const nodeIndex = index++;
    const block = blockOf(parent);
    let line: LaidRun | undefined;
    let lastRight = -Infinity;
    let offset = 0;
    for (const char of node.textContent) {
      range.setStart(node, offset);
      range.setEnd(node, offset + char.length);
      offset += char.length;
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0 && !/\s/.test(char)) continue;
      if (rect.width === 0 && /\s/.test(char)) {
        if (line) {
          line.text += ' ';
          line.chars.push({ left: rect.left - origin.left, right: rect.left - origin.left });
        }
        continue;
      }
      // A new line where the text goes back to the left lower down; a character from another font file (another
      // script) may sit a little higher or lower on the same line.
      const top = rect.top - origin.top;
      const newLine = !line || (Math.abs(top - line.top) > 2 && (rect.left - origin.left < lastRight - 1 || top >= (line.bottom ?? line.top) - 2));
      if (newLine) {
        line = {
          text: '',
          chars: [],
          baseline: r2(top + ascent),
          top,
          bottom: rect.bottom - origin.top,
          node: nodeIndex,
          block,
          size: style.size,
          style,
        };
        runs.push(line);
      }
      const current = line as LaidRun;
      current.bottom = Math.max(current.bottom ?? 0, rect.bottom - origin.top);
      current.text += /\s/.test(char) ? ' ' : char;
      current.chars.push({ left: rect.left - origin.left, right: rect.right - origin.left });
      lastRight = rect.right - origin.left;
    }
  }
  return runs;
};

/** A CSS linear gradient as a BoundView paint across a box, or undefined when it is not one this reads. */
const linearGradient = (css: string, box: Box): unknown => {
  const match = /^linear-gradient\((.*)\)$/.exec(css.trim());
  if (!match) return undefined;
  const parts = (match[1] as string).split(/,(?![^(]*\))/).map((part) => part.trim());
  let angle = 180;
  const first = parts[0] ?? '';
  if (/deg$/.test(first)) {
    angle = parseFloat(first);
    parts.shift();
  } else if (first.startsWith('to ')) {
    const sides: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };
    if (sides[first] === undefined) return undefined;
    angle = sides[first];
    parts.shift();
  }
  const stops: [number, string][] = [];
  parts.forEach((part, i) => {
    const position = /\s([\d.]+)%$/.exec(part);
    const colour = hex(position ? part.slice(0, position.index) : part);
    if (colour) stops.push([position ? Number(position[1]) / 100 : i / Math.max(1, parts.length - 1), colour]);
  });
  if (stops.length < 2 || stops.length > 8) return undefined;
  const radians = (angle * Math.PI) / 180;
  const half = (Math.abs(box.width * Math.sin(radians)) + Math.abs(box.height * Math.cos(radians))) / 2;
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const dx = Math.sin(radians) * half;
  const dy = -Math.cos(radians) * half;
  return {
    linear: {
      from: [r2(cx - dx), r2(cy - dy)],
      to: [r2(cx + dx), r2(cy + dy)],
      stops: stops.map(([offset, colour]) => [r2(Math.min(1, Math.max(0, offset))), colour]),
    },
  };
};

/** Boxes with a fill, a gradient or a border, images and SVG logos, in the order the page paints them. */
/**
 * Whether an SVG draws a signature's strokes: one line a stroke, each from the stroke's own points, in the canvas the
 * strokes are in (1,000 by 300), as a page draws the signature it was given.
 */
const drawsStrokes = (svg: SVGSVGElement, strokes: number[][]) => {
  const lines = [...svg.querySelectorAll('polyline, path')];
  if (lines.length !== strokes.length) return false;
  return lines.every((line, i) => {
    const source = line.tagName.toLowerCase() === 'path' ? line.getAttribute('d') : line.getAttribute('points');
    const numbers = (source?.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const stroke = strokes[i] as number[];
    return numbers.length === stroke.length && numbers.every((value, at) => Math.abs(value - (stroke[at] ?? NaN)) <= 0.5);
  });
};

type Signed = { strokes?: number[][]; text?: string; found: Element[] };

const paint = async (
  root: HTMLElement,
  origin: DOMRect,
  images: Record<string, Image>,
  problems: string[],
  engine: boolean,
  signature: Signed = { found: [] },
) => {
  const out: Element[] = [];
  const all = [root, ...root.querySelectorAll('*')];
  for (const element of all) {
    if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') continue;
    const css = getComputedStyle(element);
    if (css.display === 'none' || css.visibility === 'hidden') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const box: Box = { left: r2(rect.left - origin.left), top: r2(rect.top - origin.top), width: r2(rect.width), height: r2(rect.height) };
    const radius = parseFloat(css.borderTopLeftRadius) || 0;
    const radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'].map(
      (key) => r2(parseFloat(css[key as 'borderTopLeftRadius']) || 0),
    );
    const corners = radii.every((value) => value === radii[0]) ? r2(radius) : radii;
    const shape = { x: box.left, y: box.top, width: box.width, height: box.height, ...(radius || radii.some(Boolean) ? { radius: corners } : {}) };
    const tag = element.tagName.toLowerCase();

    if (tag !== 'svg' && tag !== 'img') {
      const fill = element === root ? undefined : hex(css.backgroundColor);
      if (fill) out.push({ type: 'rect', ...shape, fill } as Element);
      const gradient = css.backgroundImage.startsWith('linear-gradient') ? linearGradient(css.backgroundImage, box) : undefined;
      if (gradient) out.push({ type: 'rect', ...shape, fill: gradient } as Element);
      else if (css.backgroundImage.startsWith('url(')) {
        const src = /url\(["']?([^"')]+)["']?\)/.exec(css.backgroundImage)?.[1];
        if (src) {
          try {
            const image = await loaded(src);
            const key = `image${Object.keys(images).length}`;
            images[key] = capturePixels((context, width, height) => {
              const cover = css.backgroundSize === 'cover';
              const contain = css.backgroundSize === 'contain';
              const ratio = cover || contain ? (cover ? Math.max : Math.min)(width / image.width, height / image.height) : width / box.width;
              const w = image.width * ratio;
              const h = image.height * ratio;
              context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
            }, box);
            out.push({ type: 'image', image: key, ...shape } as Element);
          } catch {
            problems.push(`a background image (${src}) could not be read: it must be served from this site, or allow it (CORS)`);
          }
        }
      }
      const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
      const widths = sides.map((side) => parseFloat(css[`border${side}Width`]) || 0);
      const colours = sides.map((side) => (css[`border${side}Style`] === 'none' ? undefined : hex(css[`border${side}Color`])));
      if (widths.every((w) => w > 0 && w === widths[0]) && colours.every((c) => c && c === colours[0])) {
        const half = (widths[0] as number) / 2;
        // Its corners as the box's: the stroke's middle runs half the border in, so each radius is half the border less.
        const inset = (value: number) => r2(Math.max(0, value - half));
        const rounded = radii.some(Boolean) ? { radius: typeof corners === 'number' ? inset(corners) : radii.map(inset) } : {};
        out.push({
          type: 'rect',
          x: r2(box.left + half),
          y: r2(box.top + half),
          width: r2(box.width - 2 * half),
          height: r2(box.height - 2 * half),
          ...rounded,
          stroke: colours[0],
          strokeWidth: r2(widths[0] as number),
        } as Element);
      } else {
        sides.forEach((side, i) => {
          const width = widths[i] as number;
          const colour = colours[i];
          if (!width || !colour) return;
          const at = (value: number) => r2(value);
          const half = width / 2;
          const [from, to] =
            side === 'Top'
              ? [[box.left, box.top + half], [box.left + box.width, box.top + half]]
              : side === 'Bottom'
                ? [[box.left, box.top + box.height - half], [box.left + box.width, box.top + box.height - half]]
                : side === 'Left'
                  ? [[box.left + half, box.top], [box.left + half, box.top + box.height]]
                  : [[box.left + box.width - half, box.top], [box.left + box.width - half, box.top + box.height]];
          out.push({ type: 'line', from: from.map(at), to: to.map(at), stroke: colour, strokeWidth: r2(width) } as Element);
        });
      }
      continue;
    }

    // An SVG logo, inline or by <img>: its outlines when they draw as the browser drew it, else its pixels.
    let svg: SVGSVGElement | undefined = tag === 'svg' ? (element as SVGSVGElement) : undefined;
    let holder: HTMLElement | undefined;
    const src = tag === 'img' ? (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src : '';
    if (tag === 'img' && /\.svg(\?|#|$)|^data:image\/svg\+xml/i.test(src)) {
      try {
        const text = await (await fetch(src)).text();
        const parsed = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
        if (parsed.tagName.toLowerCase() === 'svg') {
          holder = document.createElement('div');
          holder.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;visibility:hidden;pointer-events:none`;
          const inline = document.importNode(parsed, true) as unknown as SVGSVGElement;
          inline.setAttribute('width', String(rect.width));
          inline.setAttribute('height', String(rect.height));
          holder.appendChild(inline);
          document.body.appendChild(holder);
          svg = inline;
        }
      } catch {
        // Read as pixels below.
      }
    }
    try {
      // The sender's drawn signature: the receiver draws it from the signed strokes, in this box.
      if (svg && signature.strokes && drawsStrokes(svg, signature.strokes)) {
        const ink = svg.querySelector('polyline, path');
        const colour = ink ? hex(getComputedStyle(ink).stroke) : undefined;
        signature.found.push({ type: 'signature', x: box.left, y: box.top, width: box.width, height: box.height, colour: solid(colour ?? '#000000') } as Element);
        continue;
      }
      if (svg && engine) {
        const paths = svgPaths(svg, origin);
        const local = svgPaths(svg, origin, [box.left, box.top]);
        if (paths && local && paths.length > 0 && (await drawsAlike(svg, box, local))) {
          out.push(...paths);
          continue;
        }
      }
      const key = `image${Object.keys(images).length}`;
      if (svg) {
        // Within the image limits: 1,024 a side and 262,144 pixels (as capturePixels), rounded down so never over.
        const scale = Math.min(2, 1024 / box.width, 1024 / box.height, Math.sqrt(262144 / (box.width * box.height)));
        const pixels = await browserPixels(svg, box, scale, true);
        const width = Math.max(1, Math.floor(box.width * scale));
        const height = pixels.length / 4 / width;
        images[key] = { width, height, encoding: 'rgba8-deflate', data: toBase64(zlibSync(new Uint8Array(pixels.buffer))) };
      } else {
        const image = element as HTMLImageElement;
        images[key] = capturePixels((context, width, height) => context.drawImage(image, ...fitted(image, css, width, height, width / box.width)), box, {
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      }
      out.push({ type: 'image', image: key, ...shape } as Element);
    } catch {
      problems.push(`an image (${src || 'inline'}) could not be read: it must be served from this site, or allow it (CORS)`);
    } finally {
      holder?.remove();
    }
  }
  return out;
};

/** A glyph scaled to another font's units: its advance and every coordinate of its outline. */
const scaledGlyph = (glyph: { advance: number; path?: string }, scale: number) => ({
  advance: r2(glyph.advance * scale),
  ...(glyph.path !== undefined && { path: glyph.path.replace(/-?\d+(?:\.\d+)?/g, (n) => String(r2(Number(n) * scale))) }),
});

/**
 * A text in the case CSS draws it, by simple case mapping as a receiver draws it: a character that would become
 * several (ß in capitals) stays as it is, so every receiver measures and draws the same characters.
 */
const transformed = (text: string, transform?: 'uppercase' | 'lowercase') =>
  transform === undefined
    ? text
    : [...text]
        .map((char) => {
          const changed = transform === 'uppercase' ? char.toUpperCase() : char.toLowerCase();
          return [...changed].length === 1 ? changed : char;
        })
        .join('');

const FACT_LIKE: [string, RegExp][] = [
  ['an amount', /(A\$|NZ\$|US\$|\$|£|€|¥)\s?\d|\d[\d,]*\.\d{2}\b|\b[A-Z]{3}\s?\d/],
  ['a date', /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s\d{4}\b/i],
  ['an account number', /\b\d{3}-\d{3}\b|\b\d{4}\s?\d{4}\b|\b\d{2}\s\d{3}\s\d{3}\s\d{3}\b/],
  ['an address', /\S+[$@]\S+\.\S+/],
];

/**
 * Captures a preview as a BoundView: the preview's own element, laid out as
 * the sender sees it, and the unsigned document it shows. Every fact found in
 * the preview is bound to its field; the result passes every check a
 * receiver runs, or this throws with what is wrong.
 */
export const snapshotBoundView = async (
  preview: HTMLElement,
  document: Doc,
  { engine, onWarning = (warning) => console.warn(`[BoundView] ${warning}`) }: SnapshotOptions = {},
): Promise<BTPBoundView> => {
  const origin = preview.getBoundingClientRect();
  const problems: string[] = [];
  let canVerify = false;
  if (engine !== undefined) {
    try {
      await initBoundViewEngine(engine);
      canVerify = true;
    } catch {
      onWarning('the drawing engine could not be loaded: SVG logos travel as pixels');
    }
  }
  const images: Record<string, Image> = {};
  // The sender's visual signature, drawn by the receiver from the signed data where the page shows it.
  const visual = ((document.signatory ?? {}) as { visualSignature?: { type: string; strokes?: number[][]; text?: string } }).visualSignature;
  const signature: Signed = {
    found: [],
    ...(visual?.type === 'drawn' && visual.strokes && { strokes: visual.strokes }),
    ...(visual?.type === 'typed' && visual.text && { text: visual.text }),
  };
  const shapes = await paint(preview, origin, images, problems, canVerify, signature);
  const runs = textRuns(preview, origin);
  // A typed signature: of the lines that are exactly its text, the one in the page's rarest typeface (a hand of its
  // own), the last where they tie, is drawn by the receiver as the signature. It is set aside before anything is
  // bound: the same words may also be a fact (the sender's or the signatory's name).
  if (signature.text !== undefined) {
    const families = new Map<string, number>();
    for (const run of runs) families.set(run.style.family, (families.get(run.style.family) ?? 0) + [...run.text].length);
    const lines = runs.filter((run) => run.text.trim() === signature.text);
    const rarity = (line: LaidRun) => families.get(line.style.family) ?? 0;
    const run = lines.reduce<LaidRun | undefined>((best, line) => (best === undefined || rarity(line) <= rarity(best) ? line : best), undefined);
    if (run) {
      const lead = [...run.text].findIndex((char) => !/\s/.test(char));
      const left = (run.chars[lead] as { left: number }).left;
      const right = (run.chars[lead + [...signature.text].length - 1] as { right: number }).right;
      signature.found.push({
        type: 'signature',
        x: r2(left),
        y: r2(run.top),
        width: r2(right - left),
        height: r2((run.bottom ?? run.top + run.style.size) - run.top),
        colour: run.style.colour,
      } as Element);
      runs.splice(runs.indexOf(run), 1);
    }
  }
  const segments = bindRuns(document, runs);

  // A font a style: its own glyphs, read from the page's font file, or the bundled font with its widths.
  const styles = new Map<string, { style: Style; segments: Segment[] }>();
  for (const segment of segments) {
    const { style } = runs[segment.run] as LaidRun;
    const key = `${style.family}|${style.weight}|${style.style}|${style.tabular}`;
    styles.set(key, { style, segments: [...(styles.get(key)?.segments ?? []), segment] });
  }
  const fonts: Record<string, BTPBoundViewFont> = {};
  const fontKey = new Map<string, string>();
  // Styles whose page font cannot be read are drawn with the bundled font they fall back to: they share it, one font
  // with every glyph they draw, rather than each carrying a copy of it.
  const shared = new Map<string, string>();
  let index = 0;
  for (const [key, { style, segments: used }] of styles) {
    const characters = new Set<string>();
    const boundCharacters = new Set<string>();
    for (const segment of used) {
      const run = runs[segment.run] as LaidRun;
      const text = segment.bind
        ? (() => {
            const value = boundValue(document, segment.bind.field);
            return value ? writtenValue(value, segment.bind as never) : '';
          })()
        : [...run.text].slice(segment.from, segment.to).join('');
      // Each text's own case: one font may draw a heading in capitals and a name as written.
      const shown = transformed(text, run.style.transform);
      for (const char of shown) {
        characters.add(char);
        if (segment.bind) boundCharacters.add(char);
      }
    }
    const files = await fontFile(style.family, style.weight, style.style);
    const fallback = fallbackFor(style.family);
    if (files) {
      // Each character from the file the browser drew it with, at the page's weight (and size, for optical sizes).
      const first = (files[0] as FontFile).font;
      const table: BTPBoundViewFont = { unitsPerEm: first.unitsPerEm, ascent: 0, descent: 0, glyphs: {} };
      const kerning: Record<string, number> = {};
      const byFile = new Map<FontFile, string[]>();
      const unread: string[] = [];
      for (const char of characters) {
        const file = fileFor(files, char);
        if (file && file.font.unitsPerEm === first.unitsPerEm) byFile.set(file, [...(byFile.get(file) ?? []), char]);
        else unread.push(char);
      }
      if (byFile.size === 0) byFile.set(files[0] as FontFile, []);
      for (const [file, chars] of byFile) {
        const variation = variationFor(file.font, { weight: style.weight, italic: style.style === 'italic', size: style.size });
        const { font: part, missing } = glyphTable(file.font, chars, { tabular: style.tabular, ...(variation && { variation }) });
        Object.assign(table.glyphs as object, part.glyphs);
        Object.assign(kerning, part.kerning);
        table.ascent = Math.max(table.ascent, part.ascent);
        table.descent = Math.max(table.descent, part.descent);
        unread.push(...missing);
      }
      // A character the page's font has no glyph for: the browser drew it with a fallback, and so do we.
      if (unread.length > 0) {
        const bundledFont = (await loadBundledFonts([fallback], unread))[fallback] as BTPBoundViewFont;
        const scale = table.unitsPerEm / bundledFont.unitsPerEm;
        for (const char of unread) {
          const glyph = bundledFont.glyphs?.[char];
          if (glyph) (table.glyphs as Record<string, unknown>)[char] = scaledGlyph(glyph, scale);
          else if (boundCharacters.has(char)) problems.push(`no font has a glyph for ${JSON.stringify(char)}, which ${style.family} shows`);
        }
      }
      const name = `font${index++}`;
      fonts[name] = { ...table, ...(Object.keys(kerning).length > 0 && { kerning }), fallback: [fallback] };
      fontKey.set(key, name);
      continue;
    }
    // No font file the page lets us read: its text is drawn with the bundled font of the same widths.
    const bundledFont = (await loadBundledFonts([fallback], characters))[fallback] as BTPBoundViewFont;
    const name = shared.get(fallback) ?? `font${index++}`;
    const glyphs = {
      ...fonts[name]?.glyphs,
      ...Object.fromEntries([...characters, ...'0123456789.,-+%$€£¥/: '].flatMap((char) => (bundledFont.glyphs?.[char] ? [[char, bundledFont.glyphs[char]]] : []))),
    };
    for (const char of boundCharacters) {
      if (!bundledFont.glyphs?.[char]) problems.push(`no font has a glyph for ${JSON.stringify(char)}, which ${style.family} shows`);
    }
    fonts[name] = { unitsPerEm: bundledFont.unitsPerEm, ascent: bundledFont.ascent, descent: bundledFont.descent, glyphs, fallback: [fallback] };
    shared.set(fallback, name);
    fontKey.set(key, name);
    onWarning(`${style.family} ${style.weight} has no font file this page can read; its text is drawn with ${fallback}`);
  }
  const fontCount = Object.keys(fonts).length;
  if (fontCount > MAX_FONTS) problems.push(`the preview uses ${fontCount} fonts; a BoundView carries at most ${MAX_FONTS}`);

  // The text: each fact bound to its field, each of the sender's words a label, on its own baseline.
  const texts: Element[] = [];
  for (const segment of segments) {
    const run = runs[segment.run] as LaidRun;
    const { style } = run;
    const font = fontKey.get(`${style.family}|${style.weight}|${style.style}|${style.tabular}`) as string;
    const table = fonts[font] as BTPBoundViewFont;
    const first = run.chars[segment.from] as { left: number };
    const last = run.chars[segment.to - 1] as { right: number };
    const base = {
      x: r2(first.left),
      y: run.baseline,
      align: 'start' as const,
      font,
      size: r2(style.size),
      colour: style.colour,
      ...(style.spacing && { letterSpacing: r2(Math.max(-10, Math.min(50, style.spacing))) }),
      ...(style.transform && { transform: style.transform }),
    };
    if (segment.bind) {
      // A fact's box is as wide as its value drawn with these glyphs, so every receiver measures the same.
      const value = boundValue(document, segment.bind.field);
      const text = value ? writtenValue(value, segment.bind as never) : '';
      const shown = transformed(text, style.transform);
      const chars = [...shown];
      const width = chars.reduce((sum, char, i) => {
        const glyph = table.glyphs?.[char];
        const kerning = table.kerning?.[`${char}${chars[i + 1] ?? ''}`] ?? 0;
        return sum + ((glyph?.advance ?? 0) + kerning) * (style.size / table.unitsPerEm) + (style.spacing ?? 0);
      }, 0);
      // No wider than the browser drew it: what follows on the line (a comma, the next word) starts where the page put
      // it, and a box reaching past that would be covered by it. A receiver fits the value to its box.
      const drawn = last.right - first.left;
      texts.push({ type: 'text', bind: segment.bind, ...base, width: drawn > 0 ? boxWidth(base.x, Math.min(first.left + width, last.right)) : ceil2(width) } as Element);
    } else {
      const text = [...run.text].slice(segment.from, segment.to).join('');
      texts.push({ type: 'label', text, ...base, width: boxWidth(base.x, last.right) } as Element);
      for (const [what, pattern] of FACT_LIKE) {
        if (pattern.test(text)) onWarning(`"${text}" looks like ${what} but is not bound to the signed data`);
      }
    }
  }

  const css = getComputedStyle(preview);
  const background = hex(css.backgroundColor);
  // The page as the browser draws it: the preview's box, and what overflows it where its overflow is not clipped, to
  // the furthest edge of anything drawn (scrollWidth is rounded down to whole pixels).
  const edges = [...shapes, ...texts].map((element) => {
    const e = element as { x?: number; y?: number; width?: number; height?: number; size?: number };
    return { right: (e.x ?? 0) + (e.width ?? 0), bottom: (e.y ?? 0) + (e.height ?? e.size ?? 0) };
  });
  const width = css.overflowX === 'visible' ? Math.max(origin.width, preview.scrollWidth, ...edges.map(({ right }) => right)) : origin.width;
  const height = css.overflowY === 'visible' ? Math.max(origin.height, preview.scrollHeight, ...edges.map(({ bottom }) => bottom)) : origin.height;
  const view = {
    format: 1,
    page: { width: ceil2(width), height: ceil2(height), ...(background && { background: solid(background) }) },
    ...(Object.keys(fonts).length > 0 && { fonts }),
    ...(Object.keys(images).length > 0 && { images }),
    elements: [...shapes, ...texts, ...signature.found],
  };
  if (problems.length > 0) throw new BoundViewSnapshotError('The preview cannot be sent as a BoundView', problems);

  const parsed = BtpBoundViewSchema.safeParse(view);
  if (!parsed.success) {
    throw new BoundViewSnapshotError(
      'The preview made a BoundView a receiver would refuse',
      parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const result: BTPBoundViewResult = checkBoundView(document, parsed.data);
  if (!result.show) {
    throw new BoundViewSnapshotError(
      'A receiver would not show this BoundView',
      result.problems.map(({ message, field, element }) => (field ? `${field}: ${message}` : `element ${element}: ${message}`)),
      parsed.data,
    );
  }
  return parsed.data;
};
