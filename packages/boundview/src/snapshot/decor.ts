/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A box's decoration as the browser paints it, in BoundView's own shapes:
 * borders of every style, side and corner, box shadows (blurred, spread,
 * inset), outlines, dashes and dots. Each is filled paths, so a receiver draws
 * exactly the shapes the sender's browser drew; nothing here needs a new kind
 * of element.
 */

import type { BTPBoundViewElement } from '@btps/sdk/boundview';

type Element = BTPBoundViewElement;
export type Rect = { x: number; y: number; width: number; height: number };
/** A corner's horizontal and vertical radius. Corners in CSS order: top left, top right, bottom right, bottom left. */
export type Corner = [number, number];
export type Corners = [Corner, Corner, Corner, Corner];
export type Side = { width: number; style: string; colour?: string };

const f = (n: number) => String(Math.round(n * 100) / 100);

/** A CSS list split at its commas outside any brackets: "linear-gradient(90deg, rgb(1, 2, 3) 0%), url(a.png)" is two. */
export const splitTop = (value: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      out.push(value.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(value.slice(from).trim());
  return out.filter(Boolean);
};
/** A quarter circle's control points, as a fraction of its radius. */
const K = 0.5523;
const PATH_LIMIT = 19000;

/** Each corner's radii from computed style ("12px", "12px 8px", "50%"), scaled down together where they overlap (CSS). */
export const cornersOf = (css: CSSStyleDeclaration, width: number, height: number): Corners => {
  const keys = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'] as const;
  const corners = keys.map((key) => {
    const [h = '0', v = h] = css[key].split(/\s+/);
    const read = (value: string, of: number) => (value.endsWith('%') ? (parseFloat(value) / 100) * of : parseFloat(value) || 0);
    return [read(h, width), read(v, height)] as Corner;
  }) as Corners;
  return fitted(corners, width, height);
};

const fitted = (corners: Corners, width: number, height: number): Corners => {
  const [tl, tr, br, bl] = corners;
  const ratios = [width / (tl[0] + tr[0]), width / (bl[0] + br[0]), height / (tl[1] + bl[1]), height / (tr[1] + br[1])].filter(Number.isFinite);
  const scale = Math.min(1, ...ratios);
  return corners.map(([h, v]) => [Math.max(0, h * scale), Math.max(0, v * scale)]) as Corners;
};

export const isRound = (corners: Corners) => corners.some(([h, v]) => h > 0 || v > 0);

/** Corners `by` further out (negative: in), as a border's inner edge or an outline's outer one; a square corner stays square. */
export const grown = (corners: Corners, top: number, right: number, bottom: number, left: number): Corners =>
  corners.map(([h, v], i) => {
    if (h <= 0 && v <= 0) return [0, 0];
    const dh = i === 0 || i === 3 ? left : right;
    const dv = i === 0 || i === 1 ? top : bottom;
    return [Math.max(0, h + dh), Math.max(0, v + dv)];
  }) as Corners;

/** A rectangle with its corners, as path data: drawn clockwise from the top left. */
export const roundedRect = (r: Rect, corners?: Corners): string => {
  const { x, y, width: w, height: h } = r;
  if (w <= 0 || h <= 0) return '';
  if (!corners || !isRound(corners)) return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
  const [[tlh, tlv], [trh, trv], [brh, brv], [blh, blv]] = fitted(corners, w, h);
  const arc = (x1: number, y1: number, c1x: number, c1y: number, c2x: number, c2y: number, x2: number, y2: number) =>
    x1 === x2 && y1 === y2 ? '' : `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(x2)} ${f(y2)}`;
  return (
    `M${f(x + tlh)} ${f(y)}H${f(x + w - trh)}` +
    arc(x + w - trh, y, x + w - trh + trh * K, y, x + w, y + trv - trv * K, x + w, y + trv) +
    `V${f(y + h - brv)}` +
    arc(x + w, y + h - brv, x + w, y + h - brv + brv * K, x + w - brh + brh * K, y + h, x + w - brh, y + h) +
    `H${f(x + blh)}` +
    arc(x + blh, y + h, x + blh - blh * K, y + h, x, y + h - blv + blv * K, x, y + h - blv) +
    `V${f(y + tlv)}` +
    arc(x, y + tlv, x, y + tlv - tlv * K, x + tlh - tlh * K, y, x + tlh, y) +
    'Z'
  );
};

/** What lies between two outlines, the inner one cut out. */
const ring = (outer: string, inner: string, fill: string, opacity?: number): Element =>
  ({ type: 'path', d: `${outer}${inner}`, fillRule: 'evenodd', fill, ...(opacity !== undefined && opacity < 1 && { opacity: Math.round(opacity * 1000) / 1000 }) }) as Element;

/** Many small shapes as few paths, each within the path limit. */
const batched = (pieces: string[], fill: string): Element[] => {
  const out: Element[] = [];
  let d = '';
  for (const piece of pieces) {
    if (d.length + piece.length > PATH_LIMIT) {
      out.push({ type: 'path', d, fill } as Element);
      d = '';
    }
    d += piece;
  }
  if (d) out.push({ type: 'path', d, fill } as Element);
  return out;
};

/**
 * A dashed or dotted stroke from (x1, y1) to (x2, y2), `width` thick, as one dashed line, spaced as the browser spaces
 * it: a dash three widths long, a dot as wide as the line, the gaps evened out so it starts and ends on a mark.
 */
const marks = (x1: number, y1: number, x2: number, y2: number, width: number, style: string, colour: string): Element[] => {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length <= 0 || width <= 0) return [];
  const mark = style === 'dotted' ? width : Math.max(width * 3, 3);
  const count = Math.max(1, Math.round((length + mark) / (mark * 2)));
  const gap = count > 1 ? (length - count * mark) / (count - 1) : 0;
  const r = (n: number) => Math.round(n * 100) / 100;
  return [
    {
      type: 'line',
      from: [r(x1), r(y1)],
      to: [r(x2), r(y2)],
      stroke: colour,
      strokeWidth: r(width),
      ...(count > 1 && { dash: [r(mark), Math.max(0.01, r(gap))] }),
    } as Element,
  ];
};

/** A box's border, as the browser paints it from its four sides and its corners. */
export const borders = (box: Rect, corners: Corners, sides: [Side, Side, Side, Side]): Element[] => {
  const shown = sides.map((side) => (side.width > 0 && side.colour && side.style !== 'none' && side.style !== 'hidden' ? side : undefined));
  if (shown.every((side) => !side)) return [];
  const [t, r, b, l] = shown.map((side) => side?.width ?? 0) as [number, number, number, number];
  const inner = { x: box.x + l, y: box.y + t, width: box.width - l - r, height: box.height - t - b };
  const innerCorners = grown(corners, -t, -r, -b, -l);
  const visible = shown.filter((side): side is Side => side !== undefined);
  const first = visible[0] as Side;
  const plain = (style: string) => !['dashed', 'dotted', 'double'].includes(style);
  const same = visible.every((side) => side.colour === first.colour && (plain(side.style) ? plain(first.style) : side.style === first.style));
  // One colour, solid: the ring between the border's outer and inner edges, exact for any widths and corners.
  if (same && plain(first.style)) return [ring(roundedRect(box, corners), roundedRect(inner, innerCorners), first.colour as string)];
  // Double: its outer and inner thirds.
  if (same && first.style === 'double') {
    const third = (w: number) => Math.round((w / 3) * 100) / 100;
    const [t1, r1, b1, l1] = [t, r, b, l].map(third) as [number, number, number, number];
    const outerInner = { x: box.x + l1, y: box.y + t1, width: box.width - l1 - r1, height: box.height - t1 - b1 };
    const innerOuter = { x: inner.x - l1, y: inner.y - t1, width: inner.width + l1 + r1, height: inner.height + t1 + b1 };
    return [
      ring(roundedRect(box, corners), roundedRect(outerInner, grown(corners, -t1, -r1, -b1, -l1)), first.colour as string),
      ring(roundedRect(innerOuter, grown(innerCorners, t1, r1, b1, l1)), roundedRect(inner, innerCorners), first.colour as string),
    ];
  }
  // Each side on its own: solid sides as their part of the frame, mitred at the corners; dashed and dotted along the
  // middle of the side, between its corners' curves.
  const out: Element[] = [];
  const [[tlh, tlv], [trh, trv], [brh, brv], [blh, blv]] = corners;
  const o = { l: box.x, t: box.y, r: box.x + box.width, b: box.y + box.height };
  const i = { l: inner.x, t: inner.y, r: inner.x + inner.width, b: inner.y + inner.height };
  const frames: [number, number][][] = [
    [[o.l, o.t], [o.r, o.t], [i.r, i.t], [i.l, i.t]],
    [[o.r, o.t], [o.r, o.b], [i.r, i.b], [i.r, i.t]],
    [[o.r, o.b], [o.l, o.b], [i.l, i.b], [i.r, i.b]],
    [[o.l, o.b], [o.l, o.t], [i.l, i.t], [i.l, i.b]],
  ];
  const middles: [number, number, number, number][] = [
    [o.l + Math.max(tlh, l), o.t + t / 2, o.r - Math.max(trh, r), o.t + t / 2],
    [o.r - r / 2, o.t + Math.max(trv, t), o.r - r / 2, o.b - Math.max(brv, b)],
    [o.r - Math.max(brh, r), o.b - b / 2, o.l + Math.max(blh, l), o.b - b / 2],
    [o.l + l / 2, o.b - Math.max(blv, b), o.l + l / 2, o.t + Math.max(tlv, t)],
  ];
  shown.forEach((side, index) => {
    if (!side) return;
    const colour = side.colour as string;
    if (side.style === 'dashed' || side.style === 'dotted') {
      const [x1, y1, x2, y2] = middles[index] as [number, number, number, number];
      out.push(...marks(x1, y1, x2, y2, side.width, side.style, colour));
      return;
    }
    const points = frames[index] as [number, number][];
    if (side.style === 'double') {
      // The side's outer and inner thirds of its frame.
      const lerp = (a: [number, number], c: [number, number], k: number): [number, number] => [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k];
      const [p0, p1, p2, p3] = points as [[number, number], [number, number], [number, number], [number, number]];
      for (const [from, to] of [[0, 1 / 3], [2 / 3, 1]] as const) {
        const quad = [lerp(p0, p3, from), lerp(p1, p2, from), lerp(p1, p2, to), lerp(p0, p3, to)];
        out.push({ type: 'path', d: `M${quad.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`, fill: colour } as Element);
      }
      return;
    }
    out.push({ type: 'path', d: `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`, fill: colour } as Element);
  });
  return out;
};

type Shadow = { x: number; y: number; blur: number; spread: number; colour: string; alpha: number; inset: boolean };

/** Computed box-shadow ("rgba(0, 0, 0, 0.2) 0px 1px 3px 0px, ... inset") as its shadows, first painted last. */
export const shadowsOf = (value: string, colourOf: (css: string) => string | undefined): Shadow[] => {
  if (!value || value === 'none') return [];
  return splitTop(value)
    .flatMap((part) => {
      const colourText = /(rgba?\([^)]*\)|#[0-9a-f]+|[a-z]+(?=\s|$))/i.exec(part.replace(/\binset\b/, ''))?.[1] ?? 'rgba(0,0,0,1)';
      const numbers = part.replace(colourText, '').replace(/\binset\b/, '').trim().split(/\s+/).map(parseFloat).filter(Number.isFinite);
      const hex = colourOf(colourText);
      if (!hex) return [];
      const alpha = hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;
      const [x = 0, y = 0, blur = 0, spread = 0] = numbers;
      return [{ x, y, blur, spread, colour: hex.slice(0, 7), alpha, inset: /\binset\b/.test(part) }];
    })
    .reverse();
};

/**
 * What of a convex shape lies outside a box: above it, below it, and beside it between the two. The browser paints an
 * outer shadow only there; inside the box is the box's own.
 */
const outsideOf = (shape: Point[], box: Rect): string => {
  const top = box.y;
  const bottom = box.y + box.height;
  const left = box.x;
  const right = box.x + box.width;
  const pieces = [
    cut(shape, [0, 1], top),
    cut(shape, [0, -1], -bottom),
    cut(cut(cut(shape, [0, -1], -top), [0, 1], bottom), [1, 0], left),
    cut(cut(cut(shape, [0, -1], -top), [0, 1], bottom), [-1, 0], -right),
  ];
  return pieces.map(polygonPath).join('');
};

/**
 * A box's outer shadows, drawn before its background, outside the box only, as the browser clips them to it. A blurred
 * edge as layers: each the shadow grown by a step of the blur, faint enough that where all lie it has its full strength,
 * so the edge fades over the blur's width as the browser's Gaussian does.
 */
export const outerShadows = (box: Rect, corners: Corners, shadows: Shadow[]): Element[] =>
  shadows
    .filter((shadow) => !shadow.inset)
    .flatMap((shadow) => {
      const sigma = shadow.blur / 2;
      const n = shadow.blur <= 0 ? 1 : Math.min(8, Math.max(3, Math.ceil(shadow.blur / 2)));
      const each = n === 1 ? shadow.alpha : 1 - Math.pow(1 - shadow.alpha, 1 / n);
      const out: Element[] = [];
      for (let k = 0; k < n; k++) {
        // From 2σ out to 2σ in, evenly: a layer each step.
        const by = shadow.spread + (n === 1 ? 0 : 2 * sigma * (1 - (2 * (k + 0.5)) / n));
        const rect = { x: box.x + shadow.x - by, y: box.y + shadow.y - by, width: box.width + 2 * by, height: box.height + 2 * by };
        if (rect.width <= 0 || rect.height <= 0) continue;
        const d = outsideOf(outlinePoints(rect, grown(corners, by, by, by, by)), box);
        if (d) out.push({ type: 'path', d, fill: shadow.colour, ...(each < 1 && { opacity: Math.round(each * 1000) / 1000 }) } as Element);
      }
      return out;
    });

/** A box's inset shadows, drawn over its background: inside its padding box, where the shifted, shrunk box is not. */
export const insetShadows = (padding: Rect, corners: Corners, shadows: Shadow[]): Element[] =>
  shadows
    .filter((shadow) => shadow.inset)
    .flatMap((shadow) => {
      const outer = roundedRect(padding, corners);
      // The hole, inside the padding box (what falls outside it would be painted outside the box).
      const hole = (grow: number) => {
        const by = shadow.spread - grow;
        const x1 = Math.max(padding.x, padding.x + shadow.x + by);
        const y1 = Math.max(padding.y, padding.y + shadow.y + by);
        const x2 = Math.min(padding.x + padding.width, padding.x + shadow.x + padding.width - by);
        const y2 = Math.min(padding.y + padding.height, padding.y + shadow.y + padding.height - by);
        return x2 > x1 && y2 > y1 ? roundedRect({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, grown(corners, -by, -by, -by, -by)) : '';
      };
      const sigma = shadow.blur / 2;
      const n = shadow.blur <= 0 ? 1 : Math.min(8, Math.max(3, Math.ceil(shadow.blur / 2)));
      const each = 1 - Math.pow(1 - shadow.alpha, 1 / n);
      const out: Element[] = [];
      for (let k = 0; k < n; k++) {
        const grow = n === 1 ? 0 : 2 * sigma * (1 - (2 * (k + 0.5)) / n);
        out.push(ring(outer, hole(grow), shadow.colour, n === 1 ? shadow.alpha : each));
      }
      return out;
    });

/** A box's outline: outside its border by its offset, following its corners (as Chrome draws it since 94). */
export const outline = (box: Rect, corners: Corners, css: CSSStyleDeclaration, colourOf: (css: string) => string | undefined): Element[] => {
  const style = css.outlineStyle;
  const width = parseFloat(css.outlineWidth) || 0;
  if (style === 'none' || width <= 0) return [];
  const colour = colourOf(css.outlineColor);
  if (!colour) return [];
  const offset = parseFloat(css.outlineOffset) || 0;
  const by = offset + width;
  const outer = { x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by };
  const outerCorners = grown(corners, by, by, by, by);
  return borders(outer, outerCorners, [0, 1, 2, 3].map(() => ({ width, style: style === 'auto' ? 'solid' : style, colour })) as [Side, Side, Side, Side]);
};

// ---- Backgrounds: gradients as the browser paints them ----

type Point = [number, number];

/** The convex outline of a box with its corners, as points (each curve in a few straight steps). */
const outlinePoints = (r: Rect, corners: Corners, steps = 6): Point[] => {
  const [[tlh, tlv], [trh, trv], [brh, brv], [blh, blv]] = fitted(corners, r.width, r.height);
  const arc = (cx: number, cy: number, h: number, v: number, from: number): Point[] =>
    h <= 0 && v <= 0
      ? [[cx, cy]]
      : Array.from({ length: steps + 1 }, (_, i) => {
          const a = from + (Math.PI / 2) * (i / steps);
          return [cx + Math.cos(a) * h, cy + Math.sin(a) * v] as Point;
        });
  const { x, y, width: w, height: h } = r;
  return [
    ...arc(x + tlh, y + tlv, tlh, tlv, Math.PI),
    ...arc(x + w - trh, y + trv, trh, trv, -Math.PI / 2),
    ...arc(x + w - brh, y + h - brv, brh, brv, 0),
    ...arc(x + blh, y + h - blv, blh, blv, Math.PI / 2),
  ];
};

/** A convex polygon cut to one side of a line: keeps the points where a·p ≤ c. */
const cut = (points: Point[], a: Point, c: number): Point[] => {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point;
    const q = points[(i + 1) % points.length] as Point;
    const dp = a[0] * p[0] + a[1] * p[1] - c;
    const dq = a[0] * q[0] + a[1] * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
};

/** Sutherland–Hodgman: a polygon cut to a convex one. */
const clipTo = (points: Point[], clip: Point[]): Point[] => {
  let out = points;
  // The clip's winding, so each edge keeps its inside.
  const area = clip.reduce((sum, p, i) => {
    const q = clip[(i + 1) % clip.length] as Point;
    return sum + (p[0] * q[1] - q[0] * p[1]);
  }, 0);
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const p = clip[i] as Point;
    const q = clip[(i + 1) % clip.length] as Point;
    // The edge's outward normal: inside is where it points away.
    const normal: Point = area > 0 ? [q[1] - p[1], -(q[0] - p[0])] : [-(q[1] - p[1]), q[0] - p[0]];
    out = cut(out, normal, normal[0] * p[0] + normal[1] * p[1]);
  }
  return out;
};

const polygonPath = (points: Point[]) => (points.length < 3 ? '' : `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`);

/** The arguments of a CSS function, split at its top-level commas. */
const argsOf = (value: string, name: string): string[] | undefined => {
  const match = new RegExp(`^${name}\\((.*)\\)$`).exec(value.trim());
  return match ? splitTop(match[1] as string) : undefined;
};

type Stop = { colour: string; at?: number };

/** Colour stops with their positions along a gradient of `length` px: positions in px, the unset ones spread between. */
const stopsOf = (parts: string[], length: number, colourOf: (css: string) => string | undefined): { colour: string; at: number }[] | undefined => {
  const stops: Stop[] = [];
  for (const part of parts) {
    const colourText = /^(rgba?\([^)]*\)|#[0-9a-f]+|[a-z]+)/i.exec(part)?.[1];
    if (!colourText) return undefined;
    const colour = colourOf(colourText) ?? (/transparent|rgba\([^)]*,\s*0\)/i.test(colourText) ? '#ffffff00' : undefined);
    if (!colour) return undefined;
    const positions = part
      .slice(colourText.length)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * length : parseFloat(p)));
    if (positions.length === 0) stops.push({ colour });
    for (const at of positions) stops.push({ colour, at });
  }
  if (stops.length < 2) return undefined;
  const first = stops[0] as Stop;
  const last = stops[stops.length - 1] as Stop;
  first.at ??= 0;
  last.at ??= length;
  // Unset positions evenly between their set neighbours; each no earlier than the one before.
  for (let i = 1; i < stops.length; i++) {
    const stop = stops[i] as Stop;
    if (stop.at !== undefined) {
      stop.at = Math.max(stop.at, (stops[i - 1] as Stop).at as number);
      continue;
    }
    let j = i;
    while ((stops[j] as Stop).at === undefined) j++;
    const from = (stops[i - 1] as Stop).at as number;
    const to = (stops[j] as Stop).at as number;
    for (let k = i; k < j; k++) (stops[k] as Stop).at = from + ((to - from) * (k - i + 1)) / (j - i + 1);
  }
  return stops as { colour: string; at: number }[];
};

const mix = (a: string, b: string, t: number) => {
  const read = (c: string) => [1, 3, 5, 7].map((i) => (i === 7 ? (c.length === 9 ? parseInt(c.slice(7, 9), 16) : 255) : parseInt(c.slice(i, i + 2), 16)));
  const ca = read(a);
  const cb = read(b);
  const m = ca.map((v, i) => Math.round(v + ((cb[i] as number) - v) * t));
  const two = (n: number) => n.toString(16).padStart(2, '0');
  return `#${two(m[0] as number)}${two(m[1] as number)}${two(m[2] as number)}${(m[3] as number) < 255 ? two(m[3] as number) : ''}`;
};

/** The colour at `at` px along stops, as the browser interpolates between them. */
const colourAt = (stops: { colour: string; at: number }[], at: number): string => {
  if (at <= (stops[0] as { at: number }).at) return (stops[0] as { colour: string }).colour;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1] as { colour: string; at: number };
    const b = stops[i] as { colour: string; at: number };
    if (at <= b.at) return b.at === a.at ? b.colour : mix(a.colour, b.colour, (at - a.at) / (b.at - a.at));
  }
  return (stops[stops.length - 1] as { colour: string }).colour;
};

/** A position ("50%", "10px", "left", "right 8px", "calc(100% - 8px)") along `room`, as background and gradient centres use. */
export const positionAlong = (value: string, room: number): number => {
  const v = value.trim();
  const keyword: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  const parts = v.split(/\s+/);
  if (parts.length === 2 && (parts[0] as string) in keyword) {
    const k = keyword[parts[0] as string] as number;
    const off = positionAlong(parts[1] as string, room);
    return k === 1 ? room - off : off;
  }
  if (v in keyword) return (keyword[v] as number) * room;
  const calc = /^calc\((-?[\d.]+)%\s*([+-])\s*([\d.]+)px\)$/.exec(v);
  if (calc) return (parseFloat(calc[1] as string) / 100) * room + (calc[2] === '-' ? -1 : 1) * parseFloat(calc[3] as string);
  if (v.endsWith('%')) return (parseFloat(v) / 100) * room;
  return parseFloat(v) || 0;
};

/**
 * A radial-gradient layer in a box: a circle as BoundView's radial paint, exactly; an ellipse as bands of its colours,
 * each cut to the box, at most a step of 1/32 of the gradient apart.
 */
export const radialBackground = (box: Rect, corners: Corners, value: string, colourOf: (css: string) => string | undefined): Element[] | undefined => {
  const args = argsOf(value, 'radial-gradient');
  if (!args) return undefined;
  let shape = 'ellipse';
  let size = 'farthest-corner';
  let centre: Point = [box.x + box.width / 2, box.y + box.height / 2];
  let explicit: [number, number] | undefined;
  const head = args[0] as string;
  if (!/^(rgba?\(|#|[a-z]+$)/i.test(head) || /\b(circle|ellipse|at|closest|farthest)\b/.test(head)) {
    args.shift();
    const [spec = '', at] = head.split(/\s+at\s+/);
    for (const word of spec.split(/\s+/).filter(Boolean)) {
      if (word === 'circle' || word === 'ellipse') shape = word;
      else if (/^(closest|farthest)-(side|corner)$/.test(word)) size = word;
    }
    const lengths = spec.split(/\s+/).filter((w) => /^[\d.]+(px|%)$/.test(w));
    if (lengths.length > 0) {
      const rx = lengths[0] as string;
      const ry = (lengths[1] ?? lengths[0]) as string;
      explicit = [rx.endsWith('%') ? (parseFloat(rx) / 100) * box.width : parseFloat(rx), ry.endsWith('%') ? (parseFloat(ry) / 100) * box.height : parseFloat(ry)];
      if (lengths.length === 1) shape = 'circle';
    }
    const where = at ?? (/^at\s+(.*)$/.exec(head)?.[1]);
    if (where) {
      const [px = 'center', py = 'center'] = where.trim().split(/\s+(?![^(]*\))/);
      const vertical = ['top', 'bottom'].includes(px);
      centre = vertical
        ? [box.x + positionAlong(py, box.width), box.y + positionAlong(px, box.height)]
        : [box.x + positionAlong(px, box.width), box.y + positionAlong(py, box.height)];
    }
  }
  const dx = [centre[0] - box.x, box.x + box.width - centre[0]];
  const dy = [centre[1] - box.y, box.y + box.height - centre[1]];
  const far = [Math.max(...dx), Math.max(...dy)] as const;
  const near = [Math.min(...dx), Math.min(...dy)] as const;
  let rx: number;
  let ry: number;
  if (explicit) [rx, ry] = explicit;
  else if (shape === 'circle') {
    const r = size === 'closest-side' ? Math.min(...near) : size === 'farthest-side' ? Math.max(...far) : size === 'closest-corner' ? Math.hypot(...near) : Math.hypot(...far);
    rx = ry = r;
  } else {
    const side = size.startsWith('closest') ? near : far;
    const k = size.endsWith('corner') ? Math.SQRT2 : 1;
    rx = side[0] * k;
    ry = side[1] * k;
  }
  if (rx <= 0 || ry <= 0) return undefined;
  const stops = stopsOf(args, Math.max(rx, ry), colourOf);
  if (!stops) return undefined;
  const outlineD = roundedRect(box, corners);
  if (Math.abs(rx - ry) < 0.5) {
    const r = Math.max(rx, ry);
    return [{ type: 'path', d: outlineD, fill: { radial: { centre: [Math.round(centre[0] * 100) / 100, Math.round(centre[1] * 100) / 100], radius: Math.round(r * 100) / 100, stops: stops.slice(0, 8).map(({ colour, at }) => [Math.min(1, Math.max(0, at / r)), colour]) } } } as Element];
  }
  // An ellipse: the last colour everywhere, then each band inward, cut to the box.
  const clip = outlinePoints(box, corners);
  const scale = Math.max(rx, ry);
  // As many bands as the colours have steps to show, up to 24: a faint gradient needs few to look the same.
  const channel = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const range = Math.max(...[0, 1, 2].map((i) => Math.max(...stops.map(({ colour }) => channel(colour, i))) - Math.min(...stops.map(({ colour }) => channel(colour, i)))));
  const steps = Math.max(2, Math.min(24, Math.ceil(range / 3)));
  const out: Element[] = [{ type: 'path', d: outlineD, fill: colourAt(stops, scale) } as Element];
  for (let i = steps - 1; i >= 0; i--) {
    const t = (i + 0.5) / steps;
    const ellipse: Point[] = Array.from({ length: 32 }, (_, k) => {
      const a = (k / 32) * Math.PI * 2;
      return [centre[0] + Math.cos(a) * rx * ((i + 1) / steps), centre[1] + Math.sin(a) * ry * ((i + 1) / steps)];
    });
    const d = polygonPath(clipTo(ellipse, clip));
    if (d) out.push({ type: 'path', d, fill: colourAt(stops, t * scale) } as Element);
  }
  return out;
};

/** A background image's drawn size from background-size, in its positioning area: cover, contain, lengths, auto. */
export const backgroundSize = (value: string, areaW: number, areaH: number, imageW: number, imageH: number): [number, number] => {
  if (value === 'cover' || value === 'contain') {
    const k = (value === 'cover' ? Math.max : Math.min)(areaW / imageW, areaH / imageH);
    return [imageW * k, imageH * k];
  }
  const [a = 'auto', b = 'auto'] = value.split(/\s+/);
  const length = (v: string, of: number) => (v === 'auto' ? undefined : v.endsWith('%') ? (parseFloat(v) / 100) * of : parseFloat(v));
  let w = length(a, areaW);
  let h = length(b, areaH);
  if (w === undefined && h === undefined) return [imageW, imageH];
  w ??= imageW * ((h as number) / imageH);
  h ??= imageH * (w / imageW);
  return [w, h];
};

/** A linear-gradient layer as BoundView's linear paint, along the gradient line CSS draws for its angle. */
export const linearPaint = (box: Rect, value: string, colourOf: (css: string) => string | undefined): unknown => {
  const args = argsOf(value, 'linear-gradient');
  if (!args) return undefined;
  let angle = 180;
  const head = args[0] as string;
  if (/(deg|turn|rad)$/.test(head)) {
    angle = head.endsWith('turn') ? parseFloat(head) * 360 : head.endsWith('rad') ? (parseFloat(head) * 180) / Math.PI : parseFloat(head);
    args.shift();
  } else if (head.startsWith('to ')) {
    // A corner: the angle that makes the gradient's middle line run corner to corner, as CSS defines it.
    const sides = head.slice(3).split(/\s+/);
    const h = sides.includes('right') ? 1 : sides.includes('left') ? -1 : 0;
    const v = sides.includes('bottom') ? 1 : sides.includes('top') ? -1 : 0;
    angle = h === 0 ? (v > 0 ? 180 : 0) : v === 0 ? (h > 0 ? 90 : 270) : (Math.atan2(h * box.height, -v * box.width) * 180) / Math.PI;
    args.shift();
  }
  const rad = (angle * Math.PI) / 180;
  const length = Math.abs(box.width * Math.sin(rad)) + Math.abs(box.height * Math.cos(rad));
  const stops = stopsOf(args, length, colourOf);
  if (!stops || length <= 0) return undefined;
  // More than eight stops: every eighth kept, ends included (BoundView carries eight).
  const kept = stops.length <= 8 ? stops : Array.from({ length: 8 }, (_, i) => stops[Math.round((i * (stops.length - 1)) / 7)] as { colour: string; at: number });
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = (Math.sin(rad) * length) / 2;
  const dy = (-Math.cos(rad) * length) / 2;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    linear: {
      from: [r(cx - dx), r(cy - dy)],
      to: [r(cx + dx), r(cy + dy)],
      stops: kept.map(({ colour, at }) => [r(Math.min(1, Math.max(0, at / length))), colour]),
    },
  };
};

/** A repeating-linear-gradient layer: its stripes, each cut to the box, soft edges in a few steps. */
export const repeatingLinear = (box: Rect, corners: Corners, value: string, colourOf: (css: string) => string | undefined): Element[] | undefined => {
  const args = argsOf(value, 'repeating-linear-gradient');
  if (!args) return undefined;
  let angle = 180;
  const head = args[0] as string;
  if (/deg$/.test(head)) {
    angle = parseFloat(head);
    args.shift();
  } else if (head.startsWith('to ')) {
    const sides: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };
    if (sides[head] === undefined) return undefined;
    angle = sides[head];
    args.shift();
  }
  const rad = (angle * Math.PI) / 180;
  const dir: Point = [Math.sin(rad), -Math.cos(rad)];
  const length = Math.abs(box.width * Math.sin(rad)) + Math.abs(box.height * Math.cos(rad));
  const stops = stopsOf(args, length, colourOf);
  if (!stops) return undefined;
  const period = (stops[stops.length - 1] as { at: number }).at - (stops[0] as { at: number }).at;
  if (period <= 0.5) return undefined;
  const centre: Point = [box.x + box.width / 2, box.y + box.height / 2];
  const startAlong = dir[0] * centre[0] + dir[1] * centre[1] - length / 2;
  const clip = outlinePoints(box, corners);
  // Bands within one period: each pair of stops, split in four where its colours differ.
  const bands: { from: number; to: number; colour: string }[] = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1] as { colour: string; at: number };
    const b = stops[i] as { colour: string; at: number };
    if (b.at <= a.at) continue;
    const parts = a.colour === b.colour ? 1 : 4;
    for (let k = 0; k < parts; k++) {
      bands.push({ from: a.at + ((b.at - a.at) * k) / parts, to: a.at + ((b.at - a.at) * (k + 1)) / parts, colour: mix(a.colour, b.colour, (k + 0.5) / parts) });
    }
  }
  const byColour = new Map<string, string[]>();
  const offset = (stops[0] as { at: number }).at;
  for (let p = Math.floor(-offset / period) - 1; p * period + offset < length + period; p++) {
    for (const band of bands) {
      const from = startAlong + p * period + band.from;
      const to = startAlong + p * period + band.to;
      // Between two lines across the gradient: along ≥ from and along ≤ to.
      let piece = cut(clip, [-dir[0], -dir[1]], -from);
      piece = cut(piece, dir, to);
      const d = polygonPath(piece);
      if (d) byColour.set(band.colour, [...(byColour.get(band.colour) ?? []), d]);
    }
  }
  return [...byColour].flatMap(([colour, pieces]) => batched(pieces, colour));
};

/** A line drawn as text decoration: solid, double, dotted, dashed or wavy, from x1 to x2 at y (its middle). */
export const decorationLine = (x1: number, x2: number, y: number, thickness: number, style: string, colour: string): Element[] => {
  if (x2 <= x1 || thickness <= 0) return [];
  const band = (top: number) => `M${f(x1)} ${f(top)}H${f(x2)}V${f(top + thickness)}H${f(x1)}Z`;
  if (style === 'double') return [{ type: 'path', d: band(y - thickness * 1.5) + band(y + thickness * 0.5), fill: colour } as Element];
  if (style === 'dotted' || style === 'dashed') return marks(x1, y, x2, y, thickness, style, colour);
  if (style === 'wavy') {
    // A wave as Chrome draws it: a period of about six thicknesses, as high as three, stroked.
    const period = Math.max(4, thickness * 6);
    const amp = Math.max(1.5, thickness * 1.5);
    let d = `M${f(x1)} ${f(y)}`;
    for (let x = x1; x < x2; x += period) {
      const half = Math.min(period / 2, x2 - x);
      d += `Q${f(x + half / 2)} ${f(y - amp * 2)} ${f(x + half)} ${f(y)}`;
      if (x + half < x2) {
        const rest = Math.min(period / 2, x2 - x - half);
        d += `Q${f(x + half + rest / 2)} ${f(y + amp * 2)} ${f(x + half + rest)} ${f(y)}`;
      }
    }
    return [{ type: 'path', d, stroke: colour, strokeWidth: Math.max(1, Math.round(thickness * 100) / 100) } as Element];
  }
  return [{ type: 'path', d: band(y - thickness / 2), fill: colour } as Element];
};
