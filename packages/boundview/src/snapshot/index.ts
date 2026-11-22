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
import { unzlibSync, zlibSync } from 'fflate';
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
import { signatureSvg } from '../signature.js';
import { loadBundledFonts } from '../glyphs.js';
import { bindRuns, type Run, type Segment } from './bind.js';
import { fallbackFor, glyphTable, variationFor, type OpenTypeFont } from './fonts.js';
import { normalizePath, pathData, shapeOutline, type Matrix } from './svgPath.js';
import { isWoff2, woff2ToSfnt } from './woff2.js';
import {
  backgroundSize,
  borders,
  cornersOf,
  decorationLine,
  grown,
  insetShadows,
  isRound,
  linearPaint,
  outerShadows,
  outline,
  positionAlong,
  radialBackground,
  repeatingLinear,
  roundedRect,
  shadowsOf,
  splitTop,
  type Corners,
  type Side,
} from './decor.js';
import {
  apply,
  flatten,
  isIdentity,
  isUpright,
  materialize,
  scaleOf,
  transformPath,
} from './layers.js';

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
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

/**
 * An image as the browser shows it, at twice its box or at its own resolution if that is more (a logo drawn small from a
 * larger file stays sharp when the view is enlarged), where the limits allow: every pixel, compressed losslessly.
 */
const capturePixels = (
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
  box: Box,
  own?: { width: number; height: number },
): Image => {
  const wanted = Math.max(2, own ? Math.min(own.width / box.width, own.height / box.height) : 0);
  const scale = Math.min(
    wanted,
    1024 / box.width,
    1024 / box.height,
    Math.sqrt(262144 / (box.width * box.height)),
  );
  // Rounded down, so never past the limits.
  const width = Math.max(1, Math.floor(box.width * scale));
  const height = Math.max(1, Math.floor(box.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  draw(context, width, height);
  // Throws for an image from another site that does not allow it: the caller says so.
  const rgba = context.getImageData(0, 0, width, height).data;
  return {
    width,
    height,
    encoding: 'rgba8-deflate',
    data: toBase64(zlibSync(new Uint8Array(rgba.buffer))),
  };
};

/**
 * Where an <img> draws in its box of `width` by `height` (at `scale` to the page), as its object-fit and object-position
 * place it: a logo kept in proportion in a box of another shape is never stretched to the box.
 */
const fitted = (
  natural: { width: number; height: number },
  css: CSSStyleDeclaration,
  width: number,
  height: number,
  scale: number,
): [number, number, number, number] => {
  const own = { width: natural.width * scale, height: natural.height * scale };
  if (!own.width || !own.height || css.objectFit === 'fill' || !css.objectFit)
    return [0, 0, width, height];
  const fit = Math.min(width / own.width, height / own.height);
  const ratio =
    css.objectFit === 'contain'
      ? fit
      : css.objectFit === 'cover'
        ? Math.max(width / own.width, height / own.height)
        : css.objectFit === 'scale-down'
          ? Math.min(1, fit)
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

/**
 * A clip-path's basic shape (circle, ellipse, inset with its rounding, polygon) in a box of `width` by `height` pixels,
 * `scale` of them to a page pixel; undefined for none, or a shape this does not read.
 */
const clipPathOf = (
  value: string,
  width: number,
  height: number,
  scale: number,
): Path2D | undefined => {
  const match = /^(circle|ellipse|inset|polygon)\((.*)\)/.exec(value.trim());
  if (!match) return undefined;
  const [, shape, args = ''] = match;
  const len = (v: string, of: number) =>
    v.endsWith('%') ? (parseFloat(v) / 100) * of : parseFloat(v) * scale;
  const path = new Path2D();
  if (shape === 'polygon') {
    const points = args
      .replace(/^(nonzero|evenodd),/, '')
      .split(',')
      .map((pair) => pair.trim().split(/\s+/));
    points.forEach(([x = '0', y = '0'], i) =>
      i === 0
        ? path.moveTo(len(x, width), len(y, height))
        : path.lineTo(len(x, width), len(y, height)),
    );
    path.closePath();
    return path;
  }
  const [size = '', at = '50% 50%'] = args.split(/\s+at\s+/);
  const [cx = '50%', cy = '50%'] = at.trim().split(/\s+/);
  if (shape === 'circle') {
    const r = size.endsWith('%')
      ? ((parseFloat(size) / 100) * Math.hypot(width, height)) / Math.SQRT2
      : size && size !== 'closest-side'
        ? len(size, width)
        : Math.min(width, height) / 2;
    path.arc(len(cx, width), len(cy, height), r, 0, Math.PI * 2);
    return path;
  }
  if (shape === 'ellipse') {
    const [rx = '50%', ry = rx] = size.trim().split(/\s+/).filter(Boolean);
    path.ellipse(
      len(cx, width),
      len(cy, height),
      len(rx, width),
      len(ry, height),
      0,
      0,
      Math.PI * 2,
    );
    return path;
  }
  // inset(t r b l round radius)
  const [edges = '', round] = args.split(/\s+round\s+/);
  const [t = '0', r = t, b = t, l = r] = edges.trim().split(/\s+/);
  const x = len(l, width);
  const y = len(t, height);
  const w = width - x - len(r, width);
  const h = height - y - len(b, height);
  const radius = round ? len(round.trim().split(/\s+/)[0] as string, width) : 0;
  path.roundRect(x, y, w, h, radius);
  return path;
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
const svgPaths = (
  svg: SVGSVGElement,
  origin: DOMRect,
  offset: [number, number] = [0, 0],
): Element[] | undefined => {
  const out: Element[] = [];
  for (const node of svg.querySelectorAll('*')) {
    const tag = node.tagName.toLowerCase();
    if (node.closest('defs, clipPath, mask, symbol, pattern') && tag !== 'defs') continue;
    if (IGNORED.has(tag)) {
      if (
        node.getAttribute('filter') ||
        node.getAttribute('mask') ||
        node.getAttribute('clip-path')
      )
        return undefined;
      continue;
    }
    if (!SHAPES.has(tag)) return undefined;
    const shape = node as SVGGraphicsElement;
    const style = getComputedStyle(shape);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (
      style.filter !== 'none' ||
      style.mask !== 'none' ||
      style.clipPath !== 'none' ||
      style.strokeDasharray !== 'none'
    ) {
      return undefined;
    }
    const number = (name: string) => {
      const value = shape.getAttribute(name);
      return value === null ? 0 : parseFloat(value);
    };
    let d: string | undefined;
    if (tag === 'path') d = shape.getAttribute('d') ?? undefined;
    else if (tag === 'polyline' || tag === 'polygon') {
      const points = (shape.getAttribute('points') ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      d = points.reduce(
        (path, value, i) => path + (i % 2 === 0 ? `${i === 0 ? 'M' : 'L'}${value}` : ` ${value}`),
        '',
      );
      if (tag === 'polygon') d += 'Z';
    } else d = shapeOutline(tag, number);
    const commands = d ? normalizePath(d) : undefined;
    const ctm = shape.getScreenCTM();
    if (!commands || !ctm) return undefined;
    const matrix: Matrix = [
      ctm.a,
      ctm.b,
      ctm.c,
      ctm.d,
      ctm.e - origin.left - offset[0],
      ctm.f - origin.top - offset[1],
    ];
    // The opacity inside the SVG; its box's own (and its page ancestors') is applied to every drawn element alike.
    let opacity = 1;
    for (
      let at: Element | globalThis.Element | null = shape;
      at && at !== svg;
      at = (at as globalThis.Element).parentElement
    ) {
      opacity *= Number(getComputedStyle(at as globalThis.Element).opacity);
    }
    const paint = (css: string, alpha: string) => {
      if (css === 'none') return undefined;
      if (css.startsWith('url(')) return null;
      const colour = hex(css);
      if (colour === undefined) return undefined;
      const a = Math.round(
        (colour.length === 9 ? parseInt(colour.slice(7), 16) / 255 : 1) * Number(alpha) * 255,
      );
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
/** `white`: over white, to compare with the engine's picture; else as it is, its transparency kept, to travel as an image. */
const browserPixels = async (
  svg: SVGSVGElement,
  box: Box,
  scale: number,
  floor = false,
  white = true,
) => {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('width', String(box.width));
  copy.setAttribute('height', String(box.height));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }),
  );
  try {
    const image = await loaded(url);
    const canvas = document.createElement('canvas');
    const round = floor ? Math.floor : Math.round;
    canvas.width = Math.max(1, round(box.width * scale));
    canvas.height = Math.max(1, round(box.height * scale));
    const context = canvas.getContext('2d') as CanvasRenderingContext2D;
    if (white) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
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
  const view = {
    format: 1,
    page: { width: box.width, height: box.height },
    elements: paths,
  } as unknown as BTPBoundView;
  const engine = new Resvg(boundViewToSvg({}, view), {
    fitTo: { mode: 'zoom', value: 2 },
    font: { loadSystemFonts: false },
  });
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
      if (part.includes('?'))
        return [parseInt(part.replace(/\?/g, '0'), 16), parseInt(part.replace(/\?/g, 'F'), 16)];
      const [from, to = from] = part.split('-');
      return [parseInt(from as string, 16), parseInt(to as string, 16)];
    });
  return ranges.length > 0 &&
    ranges.every(([from, to]) => Number.isFinite(from) && Number.isFinite(to))
    ? ranges
    : undefined;
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
const fontFile = (
  family: string,
  weight: number,
  style: string,
): Promise<FontFile[] | undefined> => {
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
            const distance =
              weights.length === 2 && weight >= (weights[0] ?? 0) && weight <= (weights[1] ?? 0)
                ? 0
                : Math.abs((weights[0] ?? 400) - weight);
            // A woff or ttf where the rule offers one (read as it is), else its woff2.
            const sources = [
              ...rule.style.getPropertyValue('src').matchAll(/url\(["']?([^"')]+)["']?\)/g),
            ].map((m) => m[1] as string);
            const source = sources.find((src) => !/\.woff2(\?|#|$)/i.test(src)) ?? sources[0];
            if (!source) continue;
            const ranges = unicodeRanges(rule.style.getPropertyValue('unicode-range'));
            candidates.push({
              url: new URL(source, sheet.href ?? location.href).href,
              distance,
              ...(ranges && { ranges }),
            });
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
  const holding = files
    .filter(
      ({ ranges }) =>
        ranges === undefined || ranges.some(([from, to]) => code >= from && code <= to),
    )
    .reverse();
  return holding.find(({ font }) => font.charToGlyph(char).index !== 0) ?? holding[0];
};

// ---- Reading the preview ----

type Decoration = {
  line: 'underline' | 'overline' | 'line-through';
  style: string;
  colour: string;
  thickness?: number;
  offset: number;
};
type TextShadow = { x: number; y: number; blur: number; colour: string; alpha: number };
/**
 * A text's look. `alpha`: its ink's, below 1 for a translucent colour. `decorations`: the lines drawn with it, its own
 * and those its ancestors carry down to it. `shadows`: text-shadow. `smallCaps`: lower case drawn as small capitals.
 */
type Style = {
  family: string;
  weight: number;
  style: string;
  size: number;
  colour: string;
  spacing: number;
  transform?: 'uppercase' | 'lowercase';
  tabular: boolean;
  alpha?: number;
  smallCaps?: boolean;
  decorations?: Decoration[];
  shadows?: TextShadow[];
};

/** The text decorations a text is drawn with: its element's, and its ancestors' down to it (not into an inline block). */
const decorationsOf = (element: globalThis.Element, root: globalThis.Element): Decoration[] => {
  const out: Decoration[] = [];
  for (let at: globalThis.Element | null = element; at; at = at.parentElement) {
    const css = getComputedStyle(at);
    for (const line of css.textDecorationLine.split(/\s+/)) {
      if (line !== 'underline' && line !== 'overline' && line !== 'line-through') continue;
      const thickness = css.textDecorationThickness;
      out.push({
        line,
        style: css.textDecorationStyle,
        colour: solid(hex(css.textDecorationColor) ?? hex(css.color) ?? '#000000'),
        ...(thickness.endsWith('px') && { thickness: parseFloat(thickness) }),
        offset: css.textUnderlineOffset.endsWith('px') ? parseFloat(css.textUnderlineOffset) : 0,
      });
    }
    // A decoration is not carried into an inline block, or out of one positioned or floated.
    if (
      at === root ||
      /^inline-/.test(css.display) ||
      css.position === 'absolute' ||
      css.position === 'fixed' ||
      css.float !== 'none'
    )
      break;
  }
  return out;
};
/** A drawn element and the page element it is drawn for; `alpha`, a text's ink's when translucent. */
type Placed = { element: Element; source: globalThis.Element; alpha?: number };

/** `element`: what the text is in, for its transform and the order it paints in. */
type LaidRun = Run & { style: Style; top: number; element?: globalThis.Element };

const styleOf = (element: globalThis.Element, root?: globalThis.Element): Style => {
  const css = getComputedStyle(element);
  const ink = hex(css.color) ?? '#000000';
  const alpha = ink.length === 9 ? parseInt(ink.slice(7), 16) / 255 : 1;
  const decorations = root ? decorationsOf(element, root) : [];
  const shadows = shadowsOf(css.textShadow, hex).map(({ x, y, blur, colour, alpha: a }) => ({
    x,
    y,
    blur,
    colour,
    alpha: a,
  }));
  return {
    family: (css.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim(),
    weight: Number(css.fontWeight) || 400,
    style: css.fontStyle === 'italic' || css.fontStyle === 'oblique' ? 'italic' : 'normal',
    size: parseFloat(css.fontSize),
    colour: solid(ink),
    spacing: css.letterSpacing === 'normal' ? 0 : parseFloat(css.letterSpacing) || 0,
    ...(css.textTransform === 'uppercase' || css.textTransform === 'lowercase'
      ? { transform: css.textTransform }
      : {}),
    tabular: css.fontVariantNumeric.includes('tabular'),
    ...(alpha < 1 && { alpha }),
    ...(/small-caps/.test(css.fontVariantCaps) && { smallCaps: true }),
    ...(decorations.length > 0 && { decorations }),
    ...(shadows.length > 0 && { shadows }),
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
    while (
      at !== root &&
      at.parentElement &&
      ['inline', 'contents'].includes(getComputedStyle(at).display)
    )
      at = at.parentElement;
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
    const style = styleOf(parent, root);
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
      const newLine =
        !line ||
        (Math.abs(top - line.top) > 2 &&
          (rect.left - origin.left < lastRight - 1 || top >= (line.bottom ?? line.top) - 2));
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
          element: parent,
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

// ---- List markers: drawn by the browser, not in the page's text ----

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];
const roman = (n: number) =>
  ROMAN.reduce((out, [value, letters]) => {
    let text = out;
    while (n >= value) {
      text += letters;
      n -= value;
    }
    return text;
  }, '');
const alpha = (n: number): string =>
  n <= 0 ? '' : alpha(Math.floor((n - 1) / 26)) + String.fromCharCode(97 + ((n - 1) % 26));

/** A counter as a list-style-type writes it, or undefined for a type this does not write (then nothing is drawn). */
const counterText = (type: string, n: number): string | undefined => {
  if (type === 'decimal') return String(n);
  if (type === 'decimal-leading-zero') return String(n).padStart(2, '0');
  if (type === 'lower-alpha' || type === 'lower-latin') return alpha(n);
  if (type === 'upper-alpha' || type === 'upper-latin') return alpha(n).toUpperCase();
  if (type === 'lower-roman') return roman(n);
  if (type === 'upper-roman') return roman(n).toUpperCase();
  return undefined;
};

/** The item's number in its list: its value, or counted from the list's start (down, in a reversed list). */
const ordinal = (item: HTMLLIElement) => {
  if (item.hasAttribute('value')) return item.value;
  const list = item.parentElement;
  const items = list
    ? [...list.children].filter((child) => getComputedStyle(child).display === 'list-item')
    : [item];
  const position = items.indexOf(item);
  if (list instanceof HTMLOListElement) {
    const reversed = list.reversed;
    const start = list.hasAttribute('start') ? list.start : reversed ? items.length : 1;
    return reversed ? start - position : start + position;
  }
  return position + 1;
};

/**
 * Each list item's marker, where the browser draws it: a number or letter as text, ending at the item's content edge
 * (outside) or starting it (inside), in the marker's own font with tabular figures; a disc, circle or square as the shape
 * Chrome paints, sized and placed from the font's ascent (its list marker code, measured against it).
 */
const listMarkers = (root: HTMLElement, origin: DOMRect): { runs: LaidRun[]; shapes: Placed[] } => {
  const runs: LaidRun[] = [];
  const shapes: Placed[] = [];
  const measure = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  for (const item of root.querySelectorAll('li, [style*="list-item"]')) {
    const css = getComputedStyle(item);
    if (
      css.display !== 'list-item' ||
      css.listStyleType === 'none' ||
      css.visibility === 'hidden' ||
      css.listStyleImage !== 'none'
    )
      continue;
    // The first line's baseline, as the item's text is laid out.
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    let first: Text | undefined;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.trim()) {
        first = node as Text;
        break;
      }
    }
    if (!first?.parentElement) continue;
    const at = first.textContent?.search(/\S/) ?? 0;
    const range = document.createRange();
    range.setStart(first, at);
    range.setEnd(first, at + 1);
    const line = range.getBoundingClientRect();
    const textCss = getComputedStyle(first.parentElement);
    measure.font = `${textCss.fontStyle} ${textCss.fontWeight} ${textCss.fontSize} ${textCss.fontFamily}`;
    const baseline = r2(line.top - origin.top + measure.measureText('Hg').fontBoundingBoxAscent);
    const box = item.getBoundingClientRect();
    const contentLeft =
      box.left - origin.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft);
    const inside = css.listStylePosition === 'inside';
    const marker = getComputedStyle(item, '::marker');
    measure.font = `${marker.fontStyle} ${marker.fontWeight} ${marker.fontSize} ${marker.fontFamily}`;
    const colour = solid(hex(marker.color) ?? hex(css.color) ?? '#000000');
    const type = css.listStyleType;
    if (type === 'disc' || type === 'circle' || type === 'square') {
      const ascent = Math.round(measure.measureText('Hg').fontBoundingBoxAscent);
      const offset = Math.floor((ascent * 2) / 3);
      const size = Math.floor((offset + 1) / 2);
      const x = r2((inside ? contentLeft : contentLeft - offset - 8) + 1);
      const y = r2(baseline - ascent + Math.floor((3 * (ascent - offset)) / 2));
      shapes.push({
        element:
          type === 'circle'
            ? ({
                type: 'rect',
                x: r2(x + 0.5),
                y: r2(y + 0.5),
                width: size - 1,
                height: size - 1,
                radius: r2((size - 1) / 2),
                stroke: colour,
                strokeWidth: 1,
              } as Element)
            : ({
                type: 'rect',
                x,
                y,
                width: size,
                height: size,
                ...(type === 'disc' && { radius: r2(size / 2) }),
                fill: colour,
              } as Element),
        source: item,
      });
      continue;
    }
    // A string marker (list-style-type: "→ ") as written; a counter as its type writes it, then ". ".
    const quoted = /^"(.*)"$/.exec(type)?.[1];
    const counter =
      quoted === undefined ? counterText(type, ordinal(item as HTMLLIElement)) : undefined;
    const text = quoted ?? (counter === undefined ? undefined : `${counter}. `);
    if (!text) continue;
    const style: Style = {
      family: (marker.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim(),
      weight: Number(marker.fontWeight) || 400,
      style: marker.fontStyle === 'italic' || marker.fontStyle === 'oblique' ? 'italic' : 'normal',
      size: parseFloat(marker.fontSize),
      colour,
      spacing: 0,
      tabular: marker.fontVariantNumeric.includes('tabular'),
    };
    const width = measure.measureText(text).width;
    let left = inside ? contentLeft : contentLeft - width;
    const chars = [...text].map((char) => {
      const right = left + measure.measureText(char).width;
      const box = { left, right };
      left = right;
      return box;
    });
    runs.push({
      text,
      chars,
      baseline,
      top: line.top - origin.top,
      bottom: line.bottom - origin.top,
      node: -1,
      block: -1,
      size: style.size,
      style,
      element: item,
    });
  }
  return { runs, shapes };
};

/** `over` with `ink` laid on it at `alpha`: two #rrggbb colours mixed. */
const mixed = (over: string, ink: string, alpha: number) => {
  const channel = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(ink, i) * alpha + channel(over, i) * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

// ---- Through a transform ----

type Paint =
  | string
  | { linear: { from: [number, number]; to: [number, number]; stops: unknown } }
  | { radial: { centre: [number, number]; radius: number; stops: unknown } };

const paintThrough = (paint: unknown, m: DOMMatrix): unknown => {
  if (typeof paint !== 'object' || paint === null) return paint;
  const p = paint as Exclude<Paint, string>;
  const at = ([x, y]: [number, number]) => apply(m, x, y).map(r2) as [number, number];
  if ('linear' in p)
    return { linear: { ...p.linear, from: at(p.linear.from), to: at(p.linear.to) } };
  return {
    radial: { ...p.radial, centre: at(p.radial.centre), radius: r2(p.radial.radius * scaleOf(m)) },
  };
};

/**
 * A drawn element through its page element's transform, as the browser draws it: a box or path as its outline moved,
 * an image drawn turned into the box it now takes, a label as its glyphs' outlines, a fact moved and scaled (a fact is
 * drawn upright: one turned or slanted is a problem, said).
 */
const throughMatrix = (
  element: Element,
  m: DOMMatrix,
  {
    images,
    fonts,
    problems,
  }: { images: Record<string, Image>; fonts: Record<string, BTPBoundViewFont>; problems: string[] },
): Element[] => {
  const fills = (e: {
    fill?: unknown;
    stroke?: unknown;
    strokeWidth?: number;
    opacity?: number;
  }) => ({
    ...(e.fill !== undefined && { fill: paintThrough(e.fill, m) }),
    ...(e.stroke !== undefined && {
      stroke: paintThrough(e.stroke, m),
      strokeWidth: r2((e.strokeWidth ?? 0) * scaleOf(m)),
    }),
    ...(e.opacity !== undefined && { opacity: e.opacity }),
  });
  switch (element.type) {
    case 'rect': {
      const radius = element.radius ?? 0;
      const radii = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
      const d = transformPath(roundedRect(element, radii.map((r) => [r, r]) as Corners), m);
      return d ? [{ type: 'path', d, ...fills(element) } as Element] : [];
    }
    case 'path': {
      const d = transformPath(element.d, m);
      return d
        ? [
            {
              type: 'path',
              d,
              ...(element.fillRule && { fillRule: element.fillRule }),
              ...fills(element),
            } as Element,
          ]
        : [];
    }
    case 'line': {
      const from = apply(m, element.from[0], element.from[1]).map(r2);
      const to = apply(m, element.to[0], element.to[1]).map(r2);
      return [
        {
          ...element,
          from,
          to,
          strokeWidth: r2(element.strokeWidth * scaleOf(m)),
          ...(element.stroke && { stroke: paintThrough(element.stroke, m) }),
        } as Element,
      ];
    }
    case 'image': {
      const data = images[element.image];
      if (!data) return [element];
      const rgba = unzlibSync(Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0)));
      const source = document.createElement('canvas');
      source.width = data.width;
      source.height = data.height;
      (source.getContext('2d') as CanvasRenderingContext2D).putImageData(
        new ImageData(
          new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length),
          data.width,
          data.height,
        ),
        0,
        0,
      );
      const points = [
        [element.x, element.y],
        [element.x + element.width, element.y],
        [element.x + element.width, element.y + element.height],
        [element.x, element.y + element.height],
      ].map(([x, y]) => apply(m, x as number, y as number));
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      const box: Box = {
        left: r2(Math.min(...xs)),
        top: r2(Math.min(...ys)),
        width: r2(Math.max(...xs) - Math.min(...xs)),
        height: r2(Math.max(...ys) - Math.min(...ys)),
      };
      const radius = element.radius ?? 0;
      const radii = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
      images[element.image] = capturePixels(
        (context, width) => {
          const s = width / box.width;
          context.setTransform(s, 0, 0, s, -box.left * s, -box.top * s);
          context.transform(m.a, m.b, m.c, m.d, m.e, m.f);
          if (radii.some((r) => r > 0))
            context.clip(new Path2D(roundedRect(element, radii.map((r) => [r, r]) as Corners)));
          context.drawImage(source, element.x, element.y, element.width, element.height);
        },
        box,
        {
          width: (data.width * box.width) / element.width,
          height: (data.height * box.height) / element.height,
        },
      );
      return [
        {
          type: 'image',
          image: element.image,
          x: box.left,
          y: box.top,
          width: box.width,
          height: box.height,
          ...(element.opacity !== undefined && { opacity: element.opacity }),
        } as Element,
      ];
    }
    case 'label': {
      // Its glyphs' outlines, placed as the label places them, through the matrix.
      const font = fonts[element.font];
      if (!font) return [];
      const scale = element.size / font.unitsPerEm;
      const chars = [...transformed(element.text, element.transform)];
      let x = element.x;
      let d = '';
      const out: Element[] = [];
      chars.forEach((char, i) => {
        const glyph = font.glyphs?.[char];
        if (glyph?.path) {
          const piece = transformPath(
            glyph.path,
            m.multiply(new DOMMatrix([scale, 0, 0, scale, x, element.y])),
          );
          if (piece) {
            if (d.length + piece.length > 19000) {
              out.push({ type: 'path', d, fill: element.colour } as Element);
              d = '';
            }
            d += piece;
          }
        }
        x +=
          ((glyph?.advance ?? 0) + (font.kerning?.[`${char}${chars[i + 1] ?? ''}`] ?? 0)) * scale +
          (element.letterSpacing ?? 0);
      });
      if (d) out.push({ type: 'path', d, fill: element.colour } as Element);
      return out;
    }
    case 'text':
    case 'signature': {
      if (!isUpright(m)) {
        problems.push(
          `${element.type === 'text' ? element.bind.field : 'the signature'} is turned or slanted by a CSS transform; a BoundView draws it upright`,
        );
        return [element];
      }
      const [x, y] = apply(m, element.x, element.y);
      if (element.type === 'signature')
        return [
          {
            ...element,
            x: r2(x),
            y: r2(y),
            width: r2(element.width * m.a),
            height: r2(element.height * m.a),
          },
        ];
      return [
        {
          ...element,
          x: r2(x),
          y: r2(y),
          width: r2(element.width * m.a),
          size: r2(element.size * m.a),
          ...(element.letterSpacing !== undefined && {
            letterSpacing: r2(element.letterSpacing * m.a),
          }),
        },
      ];
    }
    default:
      return [element];
  }
};

/** A drawn signature's shapes as their geometry, in order: what a page shows of it, and what signatureSvg draws. */
const geometryOf = (root: globalThis.Element): string[] =>
  [...root.querySelectorAll('circle, path')].map((shape) =>
    [
      shape.tagName.toLowerCase(),
      ...['d', 'cx', 'cy', 'r', 'stroke-width'].map((name) => shape.getAttribute(name) ?? ''),
    ].join('|'),
  );

/**
 * Whether an SVG is the signed signature: the one signatureSvg draws for its strokes, on the 1,000 by 300 canvas, shape
 * for shape. A platform shows that; the engine draws it by the same rule, so the two cannot differ whatever the strokes.
 */
const drawsSignature = (svg: SVGSVGElement, strokes: number[][]) => {
  const box = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box.join(' ') !== '0 0 1000 300') return false;
  const signed = new DOMParser().parseFromString(
    signatureSvg(strokes),
    'image/svg+xml',
  ).documentElement;
  const shown = geometryOf(svg);
  const drawn = geometryOf(signed);
  return shown.length === drawn.length && shown.every((shape, i) => shape === drawn[i]);
};

type Signed = { strokes?: number[][]; text?: string; found: Element[] };

/** Boxes with a fill, a gradient or a border, images and SVG logos, in the order the page paints them. */
const paint = async (
  root: HTMLElement,
  origin: DOMRect,
  images: Record<string, Image>,
  problems: string[],
  engine: boolean,
  signature: Signed = { found: [] },
) => {
  const out: Element[] = [];
  const outlines: Element[] = [];
  const all = [root, ...root.querySelectorAll('*')];
  // Where each element's shapes start, in both lists: so each shape knows the element it is drawn for.
  const starts: [number, number, globalThis.Element][] = [];
  for (const element of all) {
    if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') continue;
    starts.push([out.length, outlines.length, element]);
    const css = getComputedStyle(element);
    if (css.display === 'none' || css.visibility === 'hidden') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const box: Box = {
      left: r2(rect.left - origin.left),
      top: r2(rect.top - origin.top),
      width: r2(rect.width),
      height: r2(rect.height),
    };
    // Its corners as CSS computes them (elliptical, percentages); an image's as circles, which is what it carries.
    const corners = cornersOf(css, box.width, box.height);
    const round = isRound(corners);
    const radii = corners.map(([h, v]) => r2(Math.min(h, v)));
    const shape = {
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
      ...(round ? { radius: radii.every((r) => r === radii[0]) ? radii[0] : radii } : {}),
    };
    const tag = element.tagName.toLowerCase();

    if (tag !== 'svg' && tag !== 'img') {
      // In the order the browser paints a box: outer shadows, background colour, background layers from the bottom,
      // inset shadows, border; its outline over everything, after the page.
      const area = { x: box.left, y: box.top, width: box.width, height: box.height };
      const filled = (fill: unknown): Element =>
        round
          ? ({ type: 'path', d: roundedRect(area, corners), fill } as Element)
          : ({ type: 'rect', ...area, fill } as Element);
      const shadows = shadowsOf(css.boxShadow, hex);
      out.push(...outerShadows(area, corners, shadows));
      // The page's own colour is the page's background, unless its corners are rounded: then the browser shows what is behind them.
      const fill = element === root && !round ? undefined : hex(css.backgroundColor);
      if (fill) out.push(filled(fill));
      const layers = css.backgroundImage === 'none' ? [] : splitTop(css.backgroundImage);
      const sizes = splitTop(css.backgroundSize);
      const xs = splitTop(css.backgroundPositionX);
      const ys = splitTop(css.backgroundPositionY);
      const repeats = splitTop(css.backgroundRepeat);
      const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
      const widths = sides.map((side) => parseFloat(css[`border${side}Width`]) || 0) as [
        number,
        number,
        number,
        number,
      ];
      const padding = {
        x: area.x + widths[3],
        y: area.y + widths[0],
        width: area.width - widths[1] - widths[3],
        height: area.height - widths[0] - widths[2],
      };
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i] as string;
        if (layer.startsWith('linear-gradient')) {
          const paint = linearPaint(area, layer, hex);
          if (paint) out.push(filled(paint));
        } else if (layer.startsWith('radial-gradient'))
          out.push(...(radialBackground(area, corners, layer, hex) ?? []));
        else if (layer.startsWith('repeating-linear-gradient'))
          out.push(...(repeatingLinear(area, corners, layer, hex) ?? []));
        else if (layer.startsWith('url(')) {
          const src = /url\(["']?([^"')]+)["']?\)/.exec(layer)?.[1];
          if (!src) continue;
          try {
            const image = await loaded(src);
            const key = `image${Object.keys(images).length}`;
            const at = (list: string[]) => list[i % list.length] ?? '';
            images[key] = capturePixels((context, width, height) => {
              // Placed in the padding box (background-origin), painted over the whole box, as size, position and repeat say.
              const s = width / box.width;
              const [w, h] = backgroundSize(
                at(sizes),
                padding.width,
                padding.height,
                image.width,
                image.height,
              );
              const x0 = padding.x - area.x + positionAlong(at(xs), padding.width - w);
              const y0 = padding.y - area.y + positionAlong(at(ys), padding.height - h);
              const repeat = at(repeats);
              const [across = 'repeat', down = across] =
                repeat === 'repeat-x'
                  ? ['repeat', 'no-repeat']
                  : repeat === 'repeat-y'
                    ? ['no-repeat', 'repeat']
                    : repeat.split(/\s+/);
              const rx = across !== 'no-repeat';
              const ry = down !== 'no-repeat';
              const startX = rx ? x0 - Math.ceil(x0 / w) * w : x0;
              const startY = ry ? y0 - Math.ceil(y0 / h) * h : y0;
              for (let y = startY; y < (ry ? box.height : startY + 1); y += h) {
                for (let x = startX; x < (rx ? box.width : startX + 1); x += w)
                  context.drawImage(image, x * s, y * s, w * s, h * s);
              }
            }, box);
            out.push({ type: 'image', image: key, ...shape } as Element);
          } catch {
            problems.push(
              `a background image (${src}) could not be read: it must be served from this site, or allow it (CORS)`,
            );
          }
        }
      }
      out.push(
        ...insetShadows(
          padding,
          grown(corners, -widths[0], -widths[1], -widths[2], -widths[3]),
          shadows,
        ),
      );
      out.push(
        ...borders(
          area,
          corners,
          sides.map((side) => ({
            width: parseFloat(css[`border${side}Width`]) || 0,
            style: css[`border${side}Style`],
            colour: hex(css[`border${side}Color`]),
          })) as [Side, Side, Side, Side],
        ),
      );
      outlines.push(...outline(area, corners, css, hex));
      continue;
    }

    // What outlines cannot carry: a clip, a filter, a blend, a fit that crops or moves it. A logo with any of these is
    // drawn by the canvas, which applies each as the browser does.
    const effects =
      (css.clipPath !== '' && css.clipPath !== 'none') ||
      (css.filter !== '' && css.filter !== 'none') ||
      (css.mixBlendMode !== '' && css.mixBlendMode !== 'normal') ||
      (tag === 'img' &&
        ((css.objectFit !== '' && css.objectFit !== 'fill') ||
          (css.objectPosition !== '' && css.objectPosition !== '50% 50%')));
    // Where a blend is, it is with the colour behind: the nearest box behind that has one.
    const backdrop = () => {
      for (let at = element.parentElement; at; at = at === root ? null : at.parentElement) {
        const fill = hex(getComputedStyle(at).backgroundColor);
        if (fill && fill.length === 7) return fill;
      }
      return '#ffffff';
    };
    const drawWithEffects = (
      source: CanvasImageSource,
      natural: { width: number; height: number },
    ) =>
      capturePixels(
        (context, width, height) => {
          const s = width / box.width;
          const layer = document.createElement('canvas');
          layer.width = width;
          layer.height = height;
          const drawn = layer.getContext('2d') as CanvasRenderingContext2D;
          const clip = clipPathOf(css.clipPath, width, height, s);
          if (clip) drawn.clip(clip);
          if (css.filter && css.filter !== 'none')
            drawn.filter = css.filter.replace(
              /(-?[\d.]+)px/g,
              (_, n: string) => `${Number(n) * s}px`,
            );
          drawn.drawImage(source, ...fitted(natural, css, width, height, s));
          if (css.mixBlendMode && css.mixBlendMode !== 'normal') {
            // The blend over the backdrop, kept only where the image is.
            context.fillStyle = backdrop();
            context.fillRect(0, 0, width, height);
            context.globalCompositeOperation = css.mixBlendMode as GlobalCompositeOperation;
            context.drawImage(layer, 0, 0);
            context.globalCompositeOperation = 'destination-in';
            context.drawImage(layer, 0, 0);
            context.globalCompositeOperation = 'source-over';
          } else context.drawImage(layer, 0, 0);
        },
        box,
        natural,
      );

    // An SVG logo, inline or by <img>: its outlines when they draw as the browser drew it, else its pixels.
    let svg: SVGSVGElement | undefined = tag === 'svg' ? (element as SVGSVGElement) : undefined;
    let holder: HTMLElement | undefined;
    const src =
      tag === 'img'
        ? (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src
        : '';
    if (tag === 'img' && !effects && /\.svg(\?|#|$)|^data:image\/svg\+xml/i.test(src)) {
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
      if (svg && signature.strokes && drawsSignature(svg, signature.strokes)) {
        // Its ink: the first shape's stroke, or its fill where it has none (a dot).
        const ink = svg.querySelector('path, circle');
        const style = ink ? getComputedStyle(ink) : undefined;
        const colour = style ? hex(style.stroke === 'none' ? style.fill : style.stroke) : undefined;
        signature.found.push({
          type: 'signature',
          x: box.left,
          y: box.top,
          width: box.width,
          height: box.height,
          colour: solid(colour ?? '#000000'),
        } as Element);
        continue;
      }
      if (svg && engine && !effects) {
        const paths = svgPaths(svg, origin);
        const local = svgPaths(svg, origin, [box.left, box.top]);
        if (paths && local && paths.length > 0 && (await drawsAlike(svg, box, local))) {
          out.push(...paths);
          continue;
        }
      }
      const key = `image${Object.keys(images).length}`;
      if (svg) {
        // An inline SVG's pixels: the browser draws it, at its box, with its effects.
        const copy = svg.cloneNode(true) as SVGSVGElement;
        copy.setAttribute('width', String(box.width));
        copy.setAttribute('height', String(box.height));
        // Its box's own effects are applied to its pixels apart (and its opacity to the image): not twice.
        for (const property of [
          'opacity',
          'filter',
          'transform',
          'clip-path',
          'mix-blend-mode',
          'translate',
          'rotate',
          'scale',
        ])
          copy.style.removeProperty(property);
        const url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }),
        );
        try {
          images[key] = drawWithEffects(await loaded(url), {
            width: box.width * 2,
            height: box.height * 2,
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      } else {
        const image = element as HTMLImageElement;
        let natural = { width: image.naturalWidth, height: image.naturalHeight };
        if (/\.svg(\?|#|$)|^data:image\/svg\+xml/i.test(src)) {
          // An SVG's own size, as CSS sizes it: its width and height where it gives them, else its viewBox's shape fitted
          // into the box (not the browser's 300 by 150 stand-in).
          const parsed = new DOMParser().parseFromString(
            await (await fetch(src)).text(),
            'image/svg+xml',
          ).documentElement;
          const w = parseFloat(parsed.getAttribute('width') ?? '');
          const h = parseFloat(parsed.getAttribute('height') ?? '');
          const viewBox = (parsed.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
          const ratio =
            w > 0 && h > 0
              ? w / h
              : (viewBox[2] ?? 0) > 0 && (viewBox[3] ?? 0) > 0
                ? (viewBox[2] as number) / (viewBox[3] as number)
                : box.width / box.height;
          natural =
            w > 0 && h > 0 && !/%/.test(parsed.getAttribute('width') ?? '')
              ? { width: w, height: h }
              : box.width / box.height > ratio
                ? { width: box.height * ratio, height: box.height }
                : { width: box.width, height: box.width / ratio };
        }
        images[key] = drawWithEffects(image, natural);
      }
      out.push({ type: 'image', image: key, ...shape } as Element);
    } catch {
      problems.push(
        `an image (${src || 'inline'}) could not be read: it must be served from this site, or allow it (CORS)`,
      );
    } finally {
      holder?.remove();
    }
  }
  // Outlines last: the browser paints them over the boxes and images of the page.
  const sourceOf = (index: number, which: 0 | 1) => {
    let found: globalThis.Element = root;
    for (const start of starts) {
      if (start[which] > index) break;
      found = start[2];
    }
    return found;
  };
  return [
    ...out.map((element, i) => ({ element, source: sourceOf(i, 0) })),
    ...outlines.map((element, i) => ({ element, source: sourceOf(i, 1) })),
  ];
};

/** A glyph scaled to another font's units: its advance and every coordinate of its outline. */
const scaledGlyph = (glyph: { advance: number; path?: string }, scale: number) => ({
  advance: r2(glyph.advance * scale),
  ...(glyph.path !== undefined && {
    path: glyph.path.replace(/-?\d+(?:\.\d+)?/g, (n) => String(r2(Number(n) * scale))),
  }),
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
  [
    'a date',
    /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s\d{4}\b/i,
  ],
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
  const visual = (
    (document.signatory ?? {}) as {
      visualSignature?: { type: string; strokes?: number[][]; text?: string };
    }
  ).visualSignature;
  const signature: Signed = {
    found: [],
    ...(visual?.type === 'drawn' && visual.strokes && { strokes: visual.strokes }),
    ...(visual?.type === 'typed' && visual.text && { text: visual.text }),
  };
  // Measured with the page's transforms set aside, each kept as a matrix; put back however the measuring ends.
  // ::before and ::after made real spans first, so their boxes and text are read like the rest.
  const unmake = materialize(preview);
  let flat: ReturnType<typeof flatten> | undefined;
  let shapes: Placed[];
  let runs: LaidRun[];
  let markers: ReturnType<typeof listMarkers>;
  try {
    flat = flatten(preview);
    shapes = await paint(preview, origin, images, problems, canVerify, signature);
    runs = textRuns(preview, origin);
    markers = listMarkers(preview, origin);
  } finally {
    flat?.restore();
    unmake();
  }
  // A typed signature: of the lines that are exactly its text, the one in the page's rarest typeface (a hand of its
  // own), the last where they tie, is drawn by the receiver as the signature. It is set aside before anything is
  // bound: the same words may also be a fact (the sender's or the signatory's name).
  if (signature.text !== undefined) {
    const families = new Map<string, number>();
    for (const run of runs)
      families.set(run.style.family, (families.get(run.style.family) ?? 0) + [...run.text].length);
    const lines = runs.filter((run) => run.text.trim() === signature.text);
    const rarity = (line: LaidRun) => families.get(line.style.family) ?? 0;
    const run = lines.reduce<LaidRun | undefined>(
      (best, line) => (best === undefined || rarity(line) <= rarity(best) ? line : best),
      undefined,
    );
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
  // List markers after the binding: the browser draws them, they are never the document's facts ("1." is no quantity).
  shapes.push(...markers.shapes);
  for (const run of markers.runs)
    segments.push({ run: runs.push(run) - 1, from: 0, to: [...run.text.trimEnd()].length });

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
      if (run.style.smallCaps) for (const char of shown.toUpperCase()) characters.add(char);
    }
    const files = await fontFile(style.family, style.weight, style.style);
    const fallback = fallbackFor(style.family);
    if (files) {
      // Each character from the file the browser drew it with, at the page's weight (and size, for optical sizes).
      const first = (files[0] as FontFile).font;
      const table: BTPBoundViewFont = {
        unitsPerEm: first.unitsPerEm,
        ascent: 0,
        descent: 0,
        glyphs: {},
      };
      const kerning: Record<string, number> = {};
      const byFile = new Map<FontFile, string[]>();
      const unread: string[] = [];
      for (const char of characters) {
        const file = fileFor(files, char);
        if (file && file.font.unitsPerEm === first.unitsPerEm)
          byFile.set(file, [...(byFile.get(file) ?? []), char]);
        else unread.push(char);
      }
      if (byFile.size === 0) byFile.set(files[0] as FontFile, []);
      for (const [file, chars] of byFile) {
        const variation = variationFor(file.font, {
          weight: style.weight,
          italic: style.style === 'italic',
          size: style.size,
        });
        const { font: part, missing } = glyphTable(file.font, chars, {
          tabular: style.tabular,
          ...(variation && { variation }),
        });
        Object.assign(table.glyphs as object, part.glyphs);
        Object.assign(kerning, part.kerning);
        table.ascent = Math.max(table.ascent, part.ascent);
        table.descent = Math.max(table.descent, part.descent);
        unread.push(...missing);
      }
      // A character the page's font has no glyph for: the browser drew it with a fallback, and so do we.
      if (unread.length > 0) {
        const bundledFont = (await loadBundledFonts([fallback], unread))[
          fallback
        ] as BTPBoundViewFont;
        const scale = table.unitsPerEm / bundledFont.unitsPerEm;
        for (const char of unread) {
          const glyph = bundledFont.glyphs?.[char];
          if (glyph) (table.glyphs as Record<string, unknown>)[char] = scaledGlyph(glyph, scale);
          else if (boundCharacters.has(char))
            problems.push(
              `no font has a glyph for ${JSON.stringify(char)}, which ${style.family} shows`,
            );
        }
      }
      const name = `font${index++}`;
      fonts[name] = {
        ...table,
        ...(Object.keys(kerning).length > 0 && { kerning }),
        fallback: [fallback],
      };
      fontKey.set(key, name);
      continue;
    }
    // No font file the page lets us read: its text is drawn with the bundled font of the same widths.
    const bundledFont = (await loadBundledFonts([fallback], characters))[
      fallback
    ] as BTPBoundViewFont;
    const name = shared.get(fallback) ?? `font${index++}`;
    const glyphs = {
      ...fonts[name]?.glyphs,
      ...Object.fromEntries(
        [...characters, ...'0123456789.,-+%$€£¥/: '].flatMap((char) =>
          bundledFont.glyphs?.[char] ? [[char, bundledFont.glyphs[char]]] : [],
        ),
      ),
    };
    for (const char of boundCharacters) {
      if (!bundledFont.glyphs?.[char])
        problems.push(
          `no font has a glyph for ${JSON.stringify(char)}, which ${style.family} shows`,
        );
    }
    fonts[name] = {
      unitsPerEm: bundledFont.unitsPerEm,
      ascent: bundledFont.ascent,
      descent: bundledFont.descent,
      glyphs,
      fallback: [fallback],
    };
    shared.set(fallback, name);
    fontKey.set(key, name);
    onWarning(
      `${style.family} ${style.weight} has no font file this page can read; its text is drawn with ${fallback}`,
    );
  }
  const fontCount = Object.keys(fonts).length;
  if (fontCount > MAX_FONTS)
    problems.push(`the preview uses ${fontCount} fonts; a BoundView carries at most ${MAX_FONTS}`);

  /**
   * A text with what the browser draws with it: its shadows first, its underline and overline under it, its
   * line-through over it. A fact's lines are not drawn: in its box, a receiver could not tell one from a shape that
   * hides it (the format has no decoration for a fact yet).
   */
  const decorated = (
    element: Element,
    shown: string,
    run: LaidRun,
    segment: Segment,
    source: globalThis.Element,
    fact: boolean,
  ): Placed[] => {
    const { style } = run;
    const text = element as Extract<Element, { type: 'text' | 'label' }>;
    const before: Element[] = [];
    const after: Element[] = [];
    for (const shadow of style.shadows ?? []) {
      const outline = {
        type: 'label',
        text: shown,
        x: text.x,
        y: text.y,
        width: text.width,
        align: 'start',
        font: text.font,
        size: text.size,
        colour: shadow.colour,
        ...(text.letterSpacing && { letterSpacing: text.letterSpacing }),
      } as Element;
      for (const path of throughMatrix(outline, new DOMMatrix().translate(shadow.x, shadow.y), {
        images,
        fonts,
        problems,
      })) {
        const alpha = shadow.blur > 0 ? shadow.alpha * 0.6 : shadow.alpha;
        before.push({ ...path, ...(alpha < 1 && { opacity: r2(alpha) }) } as Element);
      }
    }
    // The decoration's extent: the segment's characters, its trailing spaces aside.
    const chars = [...run.text];
    let end = segment.to - 1;
    while (end > segment.from && /\s/.test(chars[end] ?? '')) end--;
    const from = (run.chars[segment.from] as { left: number }).left;
    const to = (run.chars[end] as { right: number }).right;
    for (const decoration of fact ? [] : (style.decorations ?? [])) {
      const thickness = decoration.thickness ?? Math.max(1, Math.round(style.size / 14));
      if (decoration.line === 'underline')
        before.push(
          ...decorationLine(
            from,
            to,
            run.baseline + style.size * 0.1 + decoration.offset + thickness / 2,
            thickness,
            decoration.style,
            decoration.colour,
          ),
        );
      else if (decoration.line === 'overline')
        before.push(
          ...decorationLine(
            from,
            to,
            run.baseline - style.size * 0.93 + thickness / 2,
            thickness,
            decoration.style,
            decoration.colour,
          ),
        );
      else
        after.push(
          ...decorationLine(
            from,
            to,
            run.baseline - style.size * 0.29,
            thickness,
            decoration.style,
            decoration.colour,
          ),
        );
    }
    return [...before, element, ...after].map((e) => ({
      element: e,
      source,
      ...(style.alpha !== undefined && e === element && { alpha: style.alpha }),
    }));
  };

  // The text: each fact bound to its field, each of the sender's words a label, on its own baseline.
  const texts: Placed[] = [];
  for (const segment of segments) {
    const run = runs[segment.run] as LaidRun;
    const source = run.element ?? preview;
    const { style } = run;
    const font = fontKey.get(
      `${style.family}|${style.weight}|${style.style}|${style.tabular}`,
    ) as string;
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
        return (
          sum +
          ((glyph?.advance ?? 0) + kerning) * (style.size / table.unitsPerEm) +
          (style.spacing ?? 0)
        );
      }, 0);
      // No wider than the browser drew it: what follows on the line (a comma, the next word) starts where the page put
      // it, and a box reaching past that would be covered by it. A receiver fits the value to its box.
      const drawn = last.right - first.left;
      const element = {
        type: 'text',
        bind: segment.bind,
        ...base,
        width:
          drawn > 0 ? boxWidth(base.x, Math.min(first.left + width, last.right)) : ceil2(width),
      } as Element;
      if (style.smallCaps && shown !== shown.toUpperCase())
        onWarning(
          `${segment.bind.field} is in small capitals on the page; a BoundView draws a fact as written`,
        );
      texts.push(...decorated(element, shown, run, segment, source, true));
    } else {
      const text = [...run.text].slice(segment.from, segment.to).join('');
      // Small capitals: each run of lower case drawn in capitals at 70%, as the browser makes them.
      const pieces: Element[] = [];
      if (style.smallCaps) {
        const chars = [...run.text];
        let start = segment.from;
        for (let i = segment.from; i <= segment.to; i++) {
          const lower = (c: string | undefined) => c !== undefined && c !== c.toUpperCase();
          if (i < segment.to && lower(chars[i]) === lower(chars[start])) continue;
          const piece = chars.slice(start, i).join('');
          const small = lower(chars[start]);
          const left = (run.chars[start] as { left: number }).left;
          const right = (run.chars[i - 1] as { right: number }).right;
          if (piece.trim())
            pieces.push({
              type: 'label',
              ...base,
              text: small ? piece.toUpperCase() : piece,
              x: r2(left),
              size: r2(style.size * (small ? 0.7 : 1)),
              width: boxWidth(left, right),
            } as Element);
          start = i;
        }
      } else
        pieces.push({
          type: 'label',
          text,
          ...base,
          width: boxWidth(base.x, last.right),
        } as Element);
      for (const piece of pieces)
        texts.push(
          ...decorated(piece, (piece as { text: string }).text, run, segment, source, false),
        );
      for (const [what, pattern] of FACT_LIKE) {
        if (pattern.test(text))
          onWarning(`"${text}" looks like ${what} but is not bound to the signed data`);
      }
    }
  }

  // Each through its element's transform; then in the order the browser paints: the page's own shapes and text, then
  // each positioned part of it, its shapes then its text.
  const through = (placed: Placed): Placed[] => {
    const m = flat.matrixOf(placed.source);
    if (!m || isIdentity(m)) return [placed];
    return throughMatrix(placed.element, m, { images, fonts, problems }).map((element) => ({
      element,
      source: placed.source,
    }));
  };
  // Opacity: an element's, times its ancestors'. A shape or image carries it; a text's colour is solid, so its ink is
  // mixed with what is behind it, as the eye sees it.
  const opacities = new Map<globalThis.Element, number>();
  const opacityOf = (element: globalThis.Element): number => {
    if (opacities.has(element)) return opacities.get(element) as number;
    const own = parseFloat(getComputedStyle(element).opacity);
    const o =
      (Number.isFinite(own) ? own : 1) *
      (element === preview || !element.parentElement ? 1 : opacityOf(element.parentElement));
    opacities.set(element, o);
    return o;
  };
  const behind = (element: globalThis.Element): string => {
    for (
      let at: globalThis.Element | null = element;
      at;
      at = at === preview ? null : at.parentElement
    ) {
      const fill = hex(getComputedStyle(at).backgroundColor);
      if (fill && fill.length === 7) return fill;
    }
    return '#ffffff';
  };
  const faded = (placed: Placed): Placed[] => {
    const o = opacityOf(placed.source) * (placed.alpha ?? 1);
    if (o >= 0.999) return [placed];
    const e = placed.element;
    if (e.type === 'text' || e.type === 'label' || e.type === 'signature')
      return [{ ...placed, element: { ...e, colour: mixed(behind(placed.source), e.colour, o) } }];
    const prior = 'opacity' in e && typeof e.opacity === 'number' ? e.opacity : 1;
    return [{ ...placed, element: { ...e, opacity: r2(prior * o) } as Element }];
  };
  const drawnShapes = shapes.flatMap(through).flatMap(faded);
  const drawnTexts = texts.flatMap(through).flatMap(faded);
  const groupOf = (placed: Placed) => flat.groupOf(placed.source);
  const groups = [
    ...new Set(
      [...drawnShapes, ...drawnTexts]
        .map(groupOf)
        .filter((group): group is globalThis.Element => group !== undefined),
    ),
  ].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const ordered = [
    ...drawnShapes.filter((placed) => !groupOf(placed)),
    ...drawnTexts.filter((placed) => !groupOf(placed)),
    ...groups.flatMap((group) => [
      ...drawnShapes.filter((placed) => groupOf(placed) === group),
      ...drawnTexts.filter((placed) => groupOf(placed) === group),
    ]),
  ].map(({ element }) => element);

  const css = getComputedStyle(preview);
  const background = hex(css.backgroundColor);
  // The page as the browser draws it: the preview's box, and what overflows it where its overflow is not clipped, to
  // the furthest edge of anything drawn (scrollWidth is rounded down to whole pixels).
  const edges = ordered.map((element) => {
    const e = element as { x?: number; y?: number; width?: number; height?: number; size?: number };
    return { right: (e.x ?? 0) + (e.width ?? 0), bottom: (e.y ?? 0) + (e.height ?? e.size ?? 0) };
  });
  const width =
    css.overflowX === 'visible'
      ? Math.max(origin.width, preview.scrollWidth, ...edges.map(({ right }) => right))
      : origin.width;
  const height =
    css.overflowY === 'visible'
      ? Math.max(origin.height, preview.scrollHeight, ...edges.map(({ bottom }) => bottom))
      : origin.height;
  const view = {
    format: 1,
    // A page with rounded corners draws its colour as a shape (in paint): outside its corners is no colour of its own.
    page: {
      width: ceil2(width),
      height: ceil2(height),
      ...(background &&
        !isRound(cornersOf(css, origin.width, origin.height)) && { background: solid(background) }),
    },
    ...(Object.keys(fonts).length > 0 && { fonts }),
    ...(Object.keys(images).length > 0 && { images }),
    elements: [...ordered, ...signature.found],
  };
  if (problems.length > 0)
    throw new BoundViewSnapshotError('The preview cannot be sent as a BoundView', problems);

  const parsed = BtpBoundViewSchema.safeParse(view);
  if (!parsed.success) {
    throw new BoundViewSnapshotError(
      'The preview made a BoundView a receiver would refuse',
      parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      view as unknown as BTPBoundView,
    );
  }
  const result: BTPBoundViewResult = checkBoundView(document, parsed.data);
  if (!result.show) {
    throw new BoundViewSnapshotError(
      'A receiver would not show this BoundView',
      result.problems.map(({ message, field, element }) =>
        field ? `${field}: ${message}` : `element ${element}: ${message}`,
      ),
      parsed.data,
    );
  }
  return parsed.data;
};
