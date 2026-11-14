/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: the checks a receiver runs on a well-formed BoundView before it is
 * shown (Checks page). A BoundView that fails one is not shown, and the
 * receiver shows its own view of the signed data; the document is accepted.
 * Every step is fixed by the specification, so every receiver reaches the
 * same result.
 */

import { CURRENCY_DECIMALS } from '../constants/currency.js';
import {
  BtpBoundViewSchema,
  type BTPBoundView,
  type BTPBoundViewElement,
  type BTPBoundViewFont,
} from './boundViewSchema.js';
import { boundValue, type BoundValue } from './boundViewBindings.js';

type Doc = Record<string, unknown>;
type TextElement = Extract<BTPBoundViewElement, { type: 'text' }>;
type Paint = NonNullable<Extract<BTPBoundViewElement, { type: 'rect' }>['fill']>;

export type BTPBoundViewCheck = 'wellFormed' | 'keyFacts' | 'shownInFull' | 'notHidden';

export type BTPBoundViewProblem = {
  check: BTPBoundViewCheck;
  message: string;
  /** The element the problem is on, by its index in `elements`. */
  element?: number;
  /** The key fact the problem is about. */
  field?: string;
};

/** Whether a BoundView may be shown, and why not when it may not. */
export type BTPBoundViewResult = { show: true } | { show: false; problems: BTPBoundViewProblem[] };

// ---- Writing a bound value ----

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const grouped = (digits: string, separator: string) =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);

const writeDate = (iso: string, pattern: string): string => {
  const date = new Date(iso);
  const d = String(date.getUTCDate());
  const dd = d.padStart(2, '0');
  const MM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const month = MONTHS[date.getUTCMonth()] ?? '';
  const yyyy = String(date.getUTCFullYear());
  const written: Record<string, string> = {
    'd MMM yyyy': `${d} ${month.slice(0, 3)} ${yyyy}`,
    'd MMMM yyyy': `${d} ${month} ${yyyy}`,
    'MMM d, yyyy': `${month.slice(0, 3)} ${d}, ${yyyy}`,
    'MMMM d, yyyy': `${month} ${d}, ${yyyy}`,
    'dd/MM/yyyy': `${dd}/${MM}/${yyyy}`,
    'MM/dd/yyyy': `${MM}/${dd}/${yyyy}`,
    'dd.MM.yyyy': `${dd}.${MM}.${yyyy}`,
    'dd-MM-yyyy': `${dd}-${MM}-${yyyy}`,
    'yyyy-MM-dd': `${yyyy}-${MM}-${dd}`,
  };
  return written[pattern] ?? '';
};

/** A bound value as the receiver draws it, by its binding's format and range (Bindings and formats). */
export const writtenValue = (value: BoundValue, bind: TextElement['bind']): string => {
  const format = bind.format;
  if (value.kind === 'money' && format && 'money' in format) {
    const { group, decimal, prefix = '', suffix = '' } = format.money;
    const places = CURRENCY_DECIMALS[value.currency as keyof typeof CURRENCY_DECIMALS] ?? 2;
    const digits = String(Math.abs(value.amount)).padStart(places + 1, '0');
    const whole = grouped(digits.slice(0, digits.length - places), group);
    const number = places > 0 ? `${whole}${decimal}${digits.slice(-places)}` : whole;
    return `${value.amount < 0 ? '-' : ''}${prefix}${number}${suffix}`;
  }
  if (value.kind === 'date' && format && 'date' in format) return writeDate(value.date, format.date);
  if (value.kind === 'percent' && format && 'percent' in format) {
    const { decimals, decimal } = format.percent;
    return `${(value.basisPoints / 100).toFixed(decimals).replace('.', decimal)}%`;
  }
  if (value.kind !== 'text') return '';
  if (format && 'groups' in format) {
    const characters = [...value.text.replace(/ /g, '')];
    const parts: string[] = [];
    let at = 0;
    for (const size of format.groups.sizes) {
      parts.push(characters.slice(at, at + size).join(''));
      at += size;
    }
    return parts.join(format.groups.separator);
  }
  const characters = [...value.text];
  return bind.range ? characters.slice(bind.range[0], bind.range[1]).join('') : value.text;
};

const transformed = (text: string, transform?: 'uppercase' | 'lowercase') =>
  [...text]
    .map((char) => {
      if (transform === undefined) return char;
      const changed = transform === 'uppercase' ? char.toUpperCase() : char.toLowerCase();
      // Simple case mapping: a character that would become several stays as it is.
      return [...changed].length === 1 ? changed : char;
    })
    .join('');

// ---- Measuring ----

/** The width of `text` in pixels at `size`, or undefined when a character has no glyph in `font`. */
const measured = (
  text: string,
  font: BTPBoundViewFont,
  size: number,
  letterSpacing: number,
): number | undefined => {
  const characters = [...text];
  const scale = size / font.unitsPerEm;
  let width = 0;
  for (let i = 0; i < characters.length; i++) {
    const glyph = font.glyphs?.[characters[i] ?? ''];
    if (glyph === undefined) return undefined;
    const kerning = font.kerning?.[`${characters[i]}${characters[i + 1] ?? ''}`] ?? 0;
    width += (glyph.advance + kerning) * scale + letterSpacing;
  }
  return width;
};

// ---- Geometry ----

type Box = { left: number; top: number; right: number; bottom: number };

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const textBox = (element: { x: number; y: number; width: number; size: number; font: string }, view: BTPBoundView): Box => {
  const font = view.fonts?.[element.font];
  const scale = font ? element.size / font.unitsPerEm : 0;
  return {
    left: element.x,
    right: element.x + element.width,
    top: element.y - (font?.ascent ?? 0) * scale,
    bottom: element.y + (font?.descent ?? 0) * scale,
  };
};

type Point = [number, number];

/** A path's outlines as polygons, each `Q` and `C` flattened into 16 equal parameter steps. */
const polygons = (d: string): Point[][] => {
  const tokens = d.trim().split(/[\s,]+|(?=[A-Z])|(?<=[A-Z])/).filter(Boolean);
  const outlines: Point[][] = [];
  let current: Point[] = [];
  let at: Point = [0, 0];
  let start: Point = [0, 0];
  let i = 0;
  const next = () => Number(tokens[i++]);
  const close = () => {
    if (current.length > 1) outlines.push(current);
    current = [];
  };
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M') {
      close();
      at = [next(), next()];
      start = at;
      current.push(at);
    } else if (command === 'L') {
      at = [next(), next()];
      current.push(at);
    } else if (command === 'H') {
      at = [next(), at[1]];
      current.push(at);
    } else if (command === 'V') {
      at = [at[0], next()];
      current.push(at);
    } else if (command === 'Q' || command === 'C') {
      const controls: Point[] = [];
      for (let n = command === 'Q' ? 1 : 2; n > 0; n--) controls.push([next(), next()]);
      const end: Point = [next(), next()];
      const from = at;
      for (let step = 1; step <= 16; step++) {
        const t = step / 16;
        const u = 1 - t;
        const [c1, c2] = controls as [Point, Point | undefined];
        current.push(
          c2 === undefined
            ? [
                u * u * from[0] + 2 * u * t * c1[0] + t * t * end[0],
                u * u * from[1] + 2 * u * t * c1[1] + t * t * end[1],
              ]
            : [
                u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
                u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
              ],
        );
      }
      at = end;
    } else if (command === 'Z') {
      current.push(start);
      at = start;
      close();
      current.push(at);
    }
  }
  close();
  return outlines;
};

const boundsOf = (points: Point[]): Box =>
  points.reduce(
    (box, [x, y]) => ({
      left: Math.min(box.left, x),
      right: Math.max(box.right, x),
      top: Math.min(box.top, y),
      bottom: Math.max(box.bottom, y),
    }),
    { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
  );

type Edge = [ax: number, ay: number, bx: number, by: number];

/** A path's closed outlines as edges. */
const edgesOf = (outlines: Point[][]): Edge[] =>
  outlines.flatMap((outline) =>
    outline.map((a, i): Edge => {
      const b = outline[(i + 1) % outline.length] as Point;
      return [a[0], a[1], b[0], b[1]];
    }),
  );

/**
 * Where a path's edges meet the row at `y`: its crossings in increasing x,
 * with the winding of the crossings at or after each one, and the spans of
 * edges lying on the row.
 */
type Row = { xs: number[]; winding: number[]; spans: [number, number][] };

const rowOf = (edges: Edge[], y: number): Row => {
  const crossings: [number, number][] = [];
  const spans: [number, number][] = [];
  for (const [ax, ay, bx, by] of edges) {
    if (ay === y && by === y) spans.push([Math.min(ax, bx), Math.max(ax, bx)]);
    else if ((ay <= y) !== (by <= y)) {
      crossings.push([ax + ((y - ay) * (bx - ax)) / (by - ay), by > ay ? 1 : -1]);
    }
  }
  crossings.sort((a, b) => a[0] - b[0]);
  const winding = new Array<number>(crossings.length + 1).fill(0);
  for (let i = crossings.length - 1; i >= 0; i--) {
    winding[i] = (winding[i + 1] ?? 0) + (crossings[i]?.[1] ?? 0);
  }
  return { xs: crossings.map(([x]) => x), winding, spans };
};

/** Whether a path's fill covers `x` on a row, by its fill rule. A point on an edge is covered. */
const rowCovers = (row: Row, rule: 'nonzero' | 'evenodd', x: number): boolean => {
  if (row.spans.some(([from, to]) => x >= from && x <= to)) return true;
  // The first crossing after x.
  let low = 0;
  let high = row.xs.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((row.xs[middle] ?? 0) <= x) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && row.xs[low - 1] === x) return true;
  return rule === 'evenodd' ? (row.xs.length - low) % 2 === 1 : row.winding[low] !== 0;
};

/**
 * The most edge and point tests the contrast check makes on one BoundView. A
 * BoundView that would need more fails the check: a receiver is never made to
 * work without end on a crafted one.
 */
export const CONTRAST_WORK_LIMIT = 20_000_000;

/** Whether a rectangle's fill, with its corners rounded, covers `point`. A point on an edge is covered. */
const rectCovers = (
  rect: { x: number; y: number; width: number; height: number; radius?: number | number[] },
  [x, y]: Point,
): boolean => {
  const { x: left, y: top, width, height } = rect;
  if (x < left || x > left + width || y < top || y > top + height) return false;
  const limit = Math.min(width, height) / 2;
  const { radius = 0 } = rect;
  const radii = (Array.isArray(radius) ? radius : [radius, radius, radius, radius]).map((r) =>
    Math.min(r, limit),
  );
  const corners: [number, number, number][] = [
    [left + (radii[0] ?? 0), top + (radii[0] ?? 0), radii[0] ?? 0],
    [left + width - (radii[1] ?? 0), top + (radii[1] ?? 0), radii[1] ?? 0],
    [left + width - (radii[2] ?? 0), top + height - (radii[2] ?? 0), radii[2] ?? 0],
    [left + (radii[3] ?? 0), top + height - (radii[3] ?? 0), radii[3] ?? 0],
  ];
  return corners.every(([cx, cy, r], corner) => {
    const outsideX = corner === 0 || corner === 3 ? x < cx : x > cx;
    const outsideY = corner === 0 || corner === 1 ? y < cy : y > cy;
    return !(outsideX && outsideY) || (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  });
};

// ---- Colour ----

type Rgba = [number, number, number, number];

const parse = (colour: string): Rgba => [
  parseInt(colour.slice(1, 3), 16),
  parseInt(colour.slice(3, 5), 16),
  parseInt(colour.slice(5, 7), 16),
  colour.length === 9 ? parseInt(colour.slice(7, 9), 16) / 255 : 1,
];

/** A paint's colour at `point`: a colour, or a gradient interpolated in sRGB, keeping its end stops' colours beyond them. */
const paintAt = (paint: Paint, [x, y]: Point): Rgba => {
  if (typeof paint === 'string') return parse(paint);
  let t: number;
  let stops: [number, string][];
  if ('linear' in paint) {
    const { from, to } = paint.linear;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = dx * dx + dy * dy;
    t = length === 0 ? 0 : ((x - from[0]) * dx + (y - from[1]) * dy) / length;
    stops = paint.linear.stops;
  } else {
    const { centre, radius } = paint.radial;
    t = radius === 0 ? 1 : Math.hypot(x - centre[0], y - centre[1]) / radius;
    stops = paint.radial.stops;
  }
  const first = stops[0] as [number, string];
  const last = stops[stops.length - 1] as [number, string];
  if (t <= first[0]) return parse(first[1]);
  if (t >= last[0]) return parse(last[1]);
  for (let i = 1; i < stops.length; i++) {
    const [o1, c1] = stops[i - 1] as [number, string];
    const [o2, c2] = stops[i] as [number, string];
    if (t <= o2) {
      const f = o2 === o1 ? 1 : (t - o1) / (o2 - o1);
      const a = parse(c1);
      const b = parse(c2);
      return [0, 1, 2, 3].map((k) => (a[k] as number) + ((b[k] as number) - (a[k] as number)) * f) as Rgba;
    }
  }
  return parse(last[1]);
};

/** Source-over: `src × a + below × (1 − a)`, unrounded. */
const over = (below: [number, number, number], [r, g, b, a]: Rgba): [number, number, number] => [
  r * a + below[0] * (1 - a),
  g * a + below[1] * (1 - a),
  b * a + below[2] * (1 - a),
];

const luminance = (rgb: [number, number, number]) => {
  const [r, g, b] = rgb.map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

/** Points every pixel at pixel centres from `start` to `end`, or the middle when the side is under half a pixel. */
const samples = (start: number, end: number): number[] => {
  const points: number[] = [];
  for (let at = start + 0.5; at <= end; at++) points.push(at);
  return points.length > 0 ? points : [(start + end) / 2];
};

// ---- Key facts ----

/** The key facts a document's BoundView shows, by field, among those it carries (Checks: Key facts). */
const keyFacts = (document: Doc): string[] => {
  const type = document.type;
  const lines = (): string[] => {
    const items = document.lineItems as
      | { columns: string[]; roles?: Record<string, string>; rows: Record<string, unknown>[] }
      | undefined;
    if (items === undefined) return [];
    const roles = items.roles ?? {};
    const named = Object.keys(roles).filter((column) => roles[column] === 'description' || roles[column] === 'lineTotal');
    const columns = Object.keys(roles).length > 0 ? named : items.columns;
    return items.rows.flatMap((row, index) =>
      columns.filter((column) => row[column] !== undefined).map((column) => `lineItems.rows.${index}.${column}`),
    );
  };
  const listAmounts = (key: string) =>
    Array.isArray(document[key]) ? (document[key] as unknown[]).map((_, index) => `${key}.${index}.amount`) : [];
  const discount = document.discount as { amount?: number; percent?: number } | undefined;
  const bill = [
    'id',
    'issuedAt',
    'totalAmount',
    'subtotalAmount',
    'taxAmount',
    ...(discount === undefined ? [] : [discount.amount !== undefined ? 'discount.amount' : 'discount.percent']),
    'issuer.name',
    'recipient.name',
    'description',
    ...lines(),
  ];
  const letter = ['issuedAt', 'issuer.name', 'recipient.name', 'body.content', 'signatory.name', 'signatory.title'];
  const facts: Record<string, string[]> = {
    invoice: [...bill, 'dueAt'],
    receipt: [...bill, 'payment.amount', 'payment.paidAt'],
    payslip: [
      'id',
      'issuedAt',
      'issuer.name',
      'employee.name',
      'payPeriod.start',
      'payPeriod.end',
      'payDate',
      'gross',
      'taxWithheld',
      'net',
      ...listAmounts('earnings'),
      ...listAmounts('deductions'),
      ...listAmounts('contributions'),
    ],
    letter,
    agreement: [...letter, 'acceptance.by'],
  };
  return (facts[typeof type === 'string' ? type : ''] ?? []).filter(
    (field) => boundValue(document, field) !== undefined,
  );
};

/** The characters of a text a BoundView must show: all but spaces, and in markdown its formatting marks. */
const requiredCharacters = (text: string, markdown: boolean): boolean[] =>
  [...text].map((char) => !/\s/u.test(char) && !(markdown && /[#*_`>-]/.test(char)));

const isMarkdown = (document: Doc, field: string) => {
  const value = field === 'body.content' ? document.body : field === 'description' ? document.description : undefined;
  return typeof value === 'object' && value !== null && (value as { format?: unknown }).format === 'markdown';
};

// ---- The checks ----

/**
 * The checks on a well-formed BoundView, against the signed document it
 * belongs to: every key fact shown, every bound value shown in full, and
 * nothing bound hidden. Run wherever the document is opened, before it is shown.
 */
export const checkBoundView = (document: Doc, view: BTPBoundView): BTPBoundViewResult => {
  const problems: BTPBoundViewProblem[] = [];
  const texts = view.elements
    .map((element, index) => ({ element, index }))
    .filter((entry): entry is { element: TextElement; index: number } => entry.element.type === 'text');

  // Key facts: each one the document carries is bound, a text one in every character it must show.
  for (const field of keyFacts(document)) {
    const binds = texts.filter(({ element }) => element.bind.field === field).map(({ element }) => element.bind);
    const value = boundValue(document, field);
    if (binds.length === 0) {
      problems.push({ check: 'keyFacts', field, message: `${field} is a key fact and is not shown` });
    } else if (value?.kind === 'text' && !binds.some((bind) => bind.range === undefined)) {
      const shown = [...value.text].map(() => false);
      for (const { range } of binds) {
        for (let at = range?.[0] ?? 0; at < (range?.[1] ?? 0); at++) shown[at] = true;
      }
      const required = requiredCharacters(value.text, isMarkdown(document, field));
      if (required.some((needed, at) => needed && !shown[at])) {
        problems.push({ check: 'keyFacts', field, message: `every word of ${field} is shown` });
      }
    }
  }
  const signatory = (document.signatory ?? {}) as { visualSignature?: unknown };
  if (signatory.visualSignature !== undefined && !view.elements.some(({ type }) => type === 'signature')) {
    problems.push({ check: 'keyFacts', field: 'signatory.visualSignature', message: 'the signature is shown' });
  }

  // Shown in full: every character has a glyph in its own font, and the value fits, down to 3/4 of size and 6px.
  for (const { element, index } of texts) {
    const font = view.fonts?.[element.font];
    const value = boundValue(document, element.bind.field);
    if (font === undefined || value === undefined) continue;
    const text = transformed(writtenValue(value, element.bind), element.transform);
    const spacing = element.letterSpacing ?? 0;
    const smallest = Math.max(element.size * 0.75, 6);
    const width = measured(text, font, Math.min(smallest, element.size), spacing);
    if (width === undefined) {
      problems.push({ check: 'shownInFull', element: index, message: 'a character has no glyph in its font' });
    } else if (width > element.width) {
      problems.push({ check: 'shownInFull', element: index, message: 'the value does not fit its box' });
    }
  }

  // Not hidden: inside the page, nothing drawn over it, no image under it, 3:1 contrast at every point.
  const boxOf = (element: BTPBoundViewElement): Box => {
    switch (element.type) {
      case 'text':
      case 'label':
        return textBox(element, view);
      case 'line': {
        const half = element.strokeWidth / 2;
        return {
          left: Math.min(element.from[0], element.to[0]) - half,
          right: Math.max(element.from[0], element.to[0]) + half,
          top: Math.min(element.from[1], element.to[1]) - half,
          bottom: Math.max(element.from[1], element.to[1]) + half,
        };
      }
      case 'path': {
        const half = element.stroke === undefined ? 0 : (element.strokeWidth ?? 0) / 2;
        const bounds = boundsOf(polygons(element.d).flat());
        return { left: bounds.left - half, right: bounds.right + half, top: bounds.top - half, bottom: bounds.bottom + half };
      }
      default: {
        const half = element.type === 'rect' && element.stroke !== undefined ? (element.strokeWidth ?? 0) / 2 : 0;
        return {
          left: element.x - half,
          top: element.y - half,
          right: element.x + element.width + half,
          bottom: element.y + element.height + half,
        };
      }
    }
  };
  const boxes = view.elements.map(boxOf);
  const edges = view.elements.map((element) => (element.type === 'path' ? edgesOf(polygons(element.d)) : []));
  const page = parse(view.page.background ?? '#ffffff');
  const pageColour = over([255, 255, 255], page);
  let work = 0;

  view.elements.forEach((element, index) => {
    if (element.type !== 'text' && element.type !== 'signature') return;
    const box = boxes[index] as Box;
    const hidden = (message: string) => problems.push({ check: 'notHidden', element: index, message });
    if (box.left < 0 || box.top < 0 || box.right > view.page.width || box.bottom > view.page.height) {
      hidden('it lies outside the page');
    }
    if (boxes.slice(index + 1).some((later) => overlaps(box, later))) hidden('an element drawn after it covers it');
    if (view.elements.slice(0, index).some((earlier, at) => earlier.type === 'image' && overlaps(box, boxes[at] as Box))) {
      hidden('an image lies under it');
    }
    const ink = over(pageColour, parse(element.colour));
    const beneath = view.elements
      .slice(0, index)
      .map((earlier, at) => ({ earlier, at }))
      .filter(
        ({ earlier, at }) =>
          (earlier.type === 'rect' || earlier.type === 'path') &&
          earlier.fill !== undefined &&
          overlaps(box, boxes[at] as Box),
      );
    const xs = samples(box.left, box.right);
    let readable = true;
    for (const y of samples(box.top, box.bottom)) {
      work += xs.length * beneath.length;
      if (work > CONTRAST_WORK_LIMIT) break;
      const rows = beneath.map(({ earlier, at }) => {
        if (earlier.type !== 'path') return undefined;
        work += (edges[at] as Edge[]).length;
        return work > CONTRAST_WORK_LIMIT ? undefined : rowOf(edges[at] as Edge[], y);
      });
      if (work > CONTRAST_WORK_LIMIT) break;
      for (const x of xs) {
        let colour = pageColour;
        beneath.forEach(({ earlier }, n) => {
          if ((earlier.type !== 'rect' && earlier.type !== 'path') || earlier.fill === undefined) return;
          const row = rows[n];
          const covers =
            earlier.type === 'rect'
              ? rectCovers(earlier, [x, y])
              : row !== undefined && rowCovers(row, earlier.fillRule ?? 'nonzero', x);
          if (!covers) return;
          const [r, g, b, a] = paintAt(earlier.fill, [x, y]);
          colour = over(colour, [r, g, b, a * (earlier.opacity ?? 1)]);
        });
        if (contrast(ink, colour) < 3) {
          readable = false;
          break;
        }
      }
      if (!readable) break;
    }
    if (work > CONTRAST_WORK_LIMIT) hidden('it is too complex to check what lies beneath it');
    else if (!readable) hidden('its colour has less than 3:1 contrast with what lies beneath it');
  });

  return problems.length === 0 ? { show: true } : { show: false, problems };
};

/**
 * Whether an opened document's BoundView may be shown, or undefined when it
 * carries none. A document is checked against its schema before it is opened;
 * one that was not, and whose BoundView is not well formed, is never shown.
 */
export const boundViewResultOf = (document: unknown): BTPBoundViewResult | undefined => {
  if (typeof document !== 'object' || document === null || !('boundView' in document)) return undefined;
  const parsed = BtpBoundViewSchema.safeParse(document.boundView);
  return parsed.success
    ? checkBoundView(document as Doc, parsed.data)
    : { show: false, problems: [{ check: 'wellFormed', message: 'the BoundView is not well formed' }] };
};
