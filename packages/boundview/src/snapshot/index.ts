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

import opentype from 'opentype.js';
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
import bundled from '../bundledGlyphs.json' with { type: 'json' };
import { initBoundViewEngine, type BoundViewEngineSource } from '../render.js';
import { boundViewToSvg } from '../svg.js';
import { bindRuns, type Run, type Segment } from './bind.js';
import { fallbackFor, glyphTable, type OpenTypeFont } from './fonts.js';
import { normalizePath, pathData, shapeOutline, type Matrix } from './svgPath.js';

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
  ) {
    super(`${message}: ${problems.join('; ')}`);
    this.name = 'BoundViewSnapshotError';
  }
}

const BUNDLED = bundled as Record<string, BTPBoundViewFont>;
const r2 = (value: number) => Math.round(value * 100) / 100;
const ceil2 = (value: number) => Math.ceil(value * 100 - 1e-6) / 100;

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

/** An image as the browser shows it, at twice its box where the limits allow: every pixel, compressed losslessly. */
const capturePixels = (draw: (context: CanvasRenderingContext2D, width: number, height: number) => void, box: Box): Image => {
  const scale = Math.min(2, 1024 / box.width, 1024 / box.height, Math.sqrt(262144 / (box.width * box.height)));
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
const browserPixels = async (svg: SVGSVGElement, box: Box, scale: number) => {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('width', String(box.width));
  copy.setAttribute('height', String(box.height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    const image = await loaded(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(box.width * scale);
    canvas.height = Math.round(box.height * scale);
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
  const ours = engine.render().pixels;
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

const fontFiles = new Map<string, Promise<OpenTypeFont | undefined>>();

/** The font file the page uses for a family, weight and style, from its own @font-face rules. */
const fontFile = (family: string, weight: number, style: string): Promise<OpenTypeFont | undefined> => {
  const key = `${family}|${weight}|${style}`;
  if (!fontFiles.has(key)) {
    fontFiles.set(
      key,
      (async () => {
        let best: { url: string; distance: number } | undefined;
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
            const weights = (rule.style.getPropertyValue('font-weight').trim() || '400').split(/\s+/).map(Number);
            const distance = weights.length === 2 && weight >= (weights[0] ?? 0) && weight <= (weights[1] ?? 0) ? 0 : Math.abs((weights[0] ?? 400) - weight);
            // A woff or ttf source: opentype.js reads those, not woff2.
            const sources = [...rule.style.getPropertyValue('src').matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1] as string);
            const readable = sources.find((src) => !/\.woff2(\?|#|$)/i.test(src));
            if (readable && (!best || distance < best.distance)) {
              best = { url: new URL(readable, sheet.href ?? location.href).href, distance };
            }
          }
        }
        if (!best) return undefined;
        try {
          return opentype.parse(await (await fetch(best.url)).arrayBuffer()) as unknown as OpenTypeFont;
        } catch {
          return undefined;
        }
      })(),
    );
  }
  return fontFiles.get(key) as Promise<OpenTypeFont | undefined>;
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
const textRuns = (root: HTMLElement, origin: DOMRect): LaidRun[] => {
  const runs: LaidRun[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const measure = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('svg') || !node.textContent?.trim()) continue;
    if (getComputedStyle(parent).visibility === 'hidden') continue;
    const css = getComputedStyle(parent);
    measure.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    const ascent = measure.measureText('Hg').fontBoundingBoxAscent;
    const style = styleOf(parent);
    let line: LaidRun | undefined;
    let offset = 0;
    for (const char of node.textContent) {
      range.setStart(node, offset);
      range.setEnd(node, offset + char.length);
      offset += char.length;
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && /\s/.test(char)) {
        if (line) {
          line.text += ' ';
          line.chars.push({ left: rect.left - origin.left, right: rect.left - origin.left });
        }
        continue;
      }
      if (!line || Math.abs(rect.top - origin.top - line.top) > 2) {
        line = { text: '', chars: [], baseline: r2(rect.top - origin.top + ascent), top: rect.top - origin.top, style };
        runs.push(line);
      }
      line.text += /\s/.test(char) ? ' ' : char;
      line.chars.push({ left: rect.left - origin.left, right: rect.right - origin.left });
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
const paint = async (root: HTMLElement, origin: DOMRect, images: Record<string, Image>, problems: string[], engine: boolean) => {
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
        out.push({
          type: 'rect',
          x: r2(box.left + half),
          y: r2(box.top + half),
          width: r2(box.width - 2 * half),
          height: r2(box.height - 2 * half),
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
        const pixels = await browserPixels(svg, box, Math.min(2, 1024 / box.width, 1024 / box.height));
        const width = Math.round(box.width * Math.min(2, 1024 / box.width, 1024 / box.height));
        const height = pixels.length / 4 / width;
        images[key] = { width, height, encoding: 'rgba8-deflate', data: toBase64(zlibSync(new Uint8Array(pixels.buffer))) };
      } else {
        const image = element as HTMLImageElement;
        images[key] = capturePixels((context, width, height) => context.drawImage(image, 0, 0, width, height), box);
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
  const shapes = await paint(preview, origin, images, problems, canVerify);
  const runs = textRuns(preview, origin);
  const segments = bindRuns(document, runs);

  // A font a style: its own glyphs, read from the page's font file, or the bundled font with its widths.
  const styles = new Map<string, { style: Style; segments: Segment[] }>();
  for (const segment of segments) {
    const { style } = runs[segment.run] as LaidRun;
    const key = `${style.family}|${style.weight}|${style.style}|${style.tabular}`;
    styles.set(key, { style, segments: [...(styles.get(key)?.segments ?? []), segment] });
  }
  if (styles.size > 4) problems.push(`the preview uses ${styles.size} fonts; a BoundView carries at most 4`);
  const fonts: Record<string, BTPBoundViewFont> = {};
  const fontKey = new Map<string, string>();
  let index = 0;
  for (const [key, { style, segments: used }] of styles) {
    const characters = new Set<string>();
    for (const segment of used) {
      const run = runs[segment.run] as LaidRun;
      const text = segment.bind
        ? (() => {
            const value = boundValue(document, segment.bind.field);
            return value ? writtenValue(value, segment.bind as never) : '';
          })()
        : [...run.text].slice(segment.from, segment.to).join('');
      // Each text's own case: one font may draw a heading in capitals and a name as written.
      const { transform } = run.style;
      const shown = transform === 'uppercase' ? text.toUpperCase() : transform === 'lowercase' ? text.toLowerCase() : text;
      for (const char of shown) characters.add(char);
    }
    const file = await fontFile(style.family, style.weight, style.style);
    const fallback = fallbackFor(style.family);
    let font: BTPBoundViewFont;
    if (file) {
      const { font: table, missing } = glyphTable(file, characters, { tabular: style.tabular });
      font = { ...table, fallback: [fallback] };
      if (missing.length > 0 && used.some((segment) => segment.bind)) {
        problems.push(`${style.family} has no glyph for ${missing.map((c) => JSON.stringify(c)).join(', ')}`);
      }
    } else {
      // No font file the page lets us read: its text is drawn with the bundled font of the same widths.
      const bundledFont = BUNDLED[fallback] as BTPBoundViewFont;
      const glyphs = Object.fromEntries([...characters, ...'0123456789.,-+%$€£¥/: '].flatMap((char) => (bundledFont.glyphs?.[char] ? [[char, bundledFont.glyphs[char]]] : [])));
      font = { unitsPerEm: bundledFont.unitsPerEm, ascent: bundledFont.ascent, descent: bundledFont.descent, glyphs, fallback: [fallback] };
      onWarning(`${style.family} ${style.weight} has no font file this page can read; its text is drawn with ${fallback}`);
    }
    const name = `font${index++}`;
    fonts[name] = font;
    fontKey.set(key, name);
  }

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
      const shown = style.transform === 'uppercase' ? text.toUpperCase() : style.transform === 'lowercase' ? text.toLowerCase() : text;
      const chars = [...shown];
      const width = chars.reduce((sum, char, i) => {
        const glyph = table.glyphs?.[char];
        const kerning = table.kerning?.[`${char}${chars[i + 1] ?? ''}`] ?? 0;
        return sum + ((glyph?.advance ?? 0) + kerning) * (style.size / table.unitsPerEm) + (style.spacing ?? 0);
      }, 0);
      texts.push({ type: 'text', bind: segment.bind, ...base, width: ceil2(width) } as Element);
    } else {
      const text = [...run.text].slice(segment.from, segment.to).join('');
      texts.push({ type: 'label', text, ...base, width: ceil2(Math.max(0, last.right - first.left)) } as Element);
      for (const [what, pattern] of FACT_LIKE) {
        if (pattern.test(text)) onWarning(`"${text}" looks like ${what} but is not bound to the signed data`);
      }
    }
  }

  const background = hex(getComputedStyle(preview).backgroundColor);
  const view = {
    format: 1,
    page: { width: ceil2(origin.width), height: ceil2(origin.height), ...(background && { background: solid(background) }) },
    ...(Object.keys(fonts).length > 0 && { fonts }),
    ...(Object.keys(images).length > 0 && { images }),
    elements: [...shapes, ...texts],
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
    );
  }
  return parsed.data;
};
