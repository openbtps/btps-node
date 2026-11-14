/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * An SVG logo's outlines in the only form a BoundView path takes: absolute
 * M, L, Q, C and Z on the page, at most two decimals. Relative commands,
 * H and V, smooth curves and arcs are rewritten, and every point is placed on
 * the page by the shape's transform.
 */

type Point = [number, number];
/** An affine transform, as SVG's matrix(a b c d e f). */
export type Matrix = [number, number, number, number, number, number];

export type Command =
  | { type: 'M' | 'L'; to: Point }
  | { type: 'Q'; c1: Point; to: Point }
  | { type: 'C'; c1: Point; c2: Point; to: Point }
  | { type: 'Z' };

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** An arc from `from` as cubic curves, each at most a quarter turn (SVG 1.1, F.6.5 and F.6.6). */
const arcToCubics = (
  from: Point,
  [rxIn, ryIn, angle, large, sweep, x, y]: number[],
): Command[] => {
  let rx = Math.abs(rxIn ?? 0);
  let ry = Math.abs(ryIn ?? 0);
  const to: Point = [x ?? 0, y ?? 0];
  if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) return [{ type: 'L', to }];
  const phi = ((angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const factor = sign * Math.sqrt(Math.max(0, numerator / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const angleOf = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta = angleOf(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angleOf((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const parts = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const step = delta / parts;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number): Point => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ];
  const derivative = (t: number): Point => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ];
  const out: Command[] = [];
  for (let i = 0; i < parts; i++) {
    const t1 = theta + i * step;
    const t2 = t1 + step;
    const p1 = point(t1);
    const p2 = point(t2);
    const d1 = derivative(t1);
    const d2 = derivative(t2);
    out.push({
      type: 'C',
      c1: [p1[0] + k * d1[0], p1[1] + k * d1[1]],
      c2: [p2[0] - k * d2[0], p2[1] - k * d2[1]],
      to: i === parts - 1 ? to : p2,
    });
  }
  return out;
};

/** SVG path data as absolute M, L, Q, C and Z, or undefined when it cannot be read. */
export const normalizePath = (d: string): Command[] | undefined => {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: Command[] = [];
  let at: Point = [0, 0];
  let start: Point = [0, 0];
  let lastControl: Point | undefined;
  let lastType = '';
  let i = 0;
  let command = '';
  while (i < tokens.length) {
    const token = tokens[i] as string;
    if (/[a-zA-Z]/.test(token)) {
      command = token;
      i++;
      if (command.toUpperCase() === 'Z') {
        out.push({ type: 'Z' });
        at = start;
        lastControl = undefined;
        lastType = 'Z';
        continue;
      }
    } else if (command === '') return undefined;
    const upper = command.toUpperCase();
    const arity = ARITY[upper];
    if (arity === undefined) return undefined;
    const numbers = tokens.slice(i, i + arity).map(Number);
    if (numbers.length < arity || numbers.some((n) => !Number.isFinite(n))) return undefined;
    i += arity;
    const relative = command !== upper;
    const abs = (x: number, y: number): Point => (relative ? [at[0] + x, at[1] + y] : [x, y]);
    const [a = 0, b = 0, c = 0, e = 0, f = 0, g = 0] = numbers;
    switch (upper) {
      case 'M':
        at = abs(a, b);
        start = at;
        out.push({ type: 'M', to: at });
        // Further pairs after a move are lines.
        command = relative ? 'l' : 'L';
        lastControl = undefined;
        break;
      case 'L':
        at = abs(a, b);
        out.push({ type: 'L', to: at });
        lastControl = undefined;
        break;
      case 'H':
        at = [relative ? at[0] + a : a, at[1]];
        out.push({ type: 'L', to: at });
        lastControl = undefined;
        break;
      case 'V':
        at = [at[0], relative ? at[1] + a : a];
        out.push({ type: 'L', to: at });
        lastControl = undefined;
        break;
      case 'C': {
        const c1 = abs(a, b);
        const c2 = abs(c, e);
        const to = abs(f, g);
        out.push({ type: 'C', c1, c2, to });
        lastControl = c2;
        at = to;
        break;
      }
      case 'S': {
        const c1: Point = lastControl && /[CS]/i.test(lastType) ? [2 * at[0] - lastControl[0], 2 * at[1] - lastControl[1]] : at;
        const c2 = abs(a, b);
        const to = abs(c, e);
        out.push({ type: 'C', c1, c2, to });
        lastControl = c2;
        at = to;
        break;
      }
      case 'Q': {
        const c1 = abs(a, b);
        const to = abs(c, e);
        out.push({ type: 'Q', c1, to });
        lastControl = c1;
        at = to;
        break;
      }
      case 'T': {
        const c1: Point = lastControl && /[QT]/i.test(lastType) ? [2 * at[0] - lastControl[0], 2 * at[1] - lastControl[1]] : at;
        const to = abs(a, b);
        out.push({ type: 'Q', c1, to });
        lastControl = c1;
        at = to;
        break;
      }
      case 'A': {
        const [rx, ry, angle, large, sweep, x, y] = numbers as [number, number, number, number, number, number, number];
        const to = abs(x, y);
        out.push(...arcToCubics(at, [rx, ry, angle, large, sweep, to[0], to[1]]));
        lastControl = undefined;
        at = to;
        break;
      }
    }
    lastType = upper;
  }
  return out;
};

/** A point placed by `matrix`. */
const place = ([x, y]: Point, [a, b, c, d, e, f]: Matrix): Point => [a * x + c * y + e, b * x + d * y + f];

const r = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Commands placed on the page by `matrix`, written as BoundView path data. */
export const pathData = (commands: Command[], matrix: Matrix): string =>
  commands
    .map((command) => {
      if (command.type === 'Z') return 'Z';
      const to = place(command.to, matrix);
      if (command.type === 'M' || command.type === 'L') return `${command.type}${r(to[0])} ${r(to[1])}`;
      const c1 = place(command.c1, matrix);
      if (command.type === 'Q') return `Q${r(c1[0])} ${r(c1[1])} ${r(to[0])} ${r(to[1])}`;
      const c2 = place(command.c2, matrix);
      return `C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(to[0])} ${r(to[1])}`;
    })
    .join('');

/** A basic shape's outline, as path data in its own coordinates. */
export const shapeOutline = (tag: string, attr: (name: string) => number): string | undefined => {
  switch (tag) {
    case 'rect': {
      const [x, y, w, h] = [attr('x'), attr('y'), attr('width'), attr('height')];
      let rx = attr('rx');
      let ry = attr('ry');
      if (!rx && ry) rx = ry;
      if (!ry && rx) ry = rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const [cx, cy] = [attr('cx'), attr('cy')];
      const rx = tag === 'circle' ? attr('r') : attr('rx');
      const ry = tag === 'circle' ? attr('r') : attr('ry');
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'line':
      return `M${attr('x1')} ${attr('y1')}L${attr('x2')} ${attr('y2')}`;
    default:
      return undefined;
  }
};
