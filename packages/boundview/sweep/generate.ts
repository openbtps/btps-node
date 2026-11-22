/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * The sweep's cases: from a seed, a signed document and a platform's own HTML
 * preview of it, as varied as a designer may make one. Every case is one a
 * receiver must show: each key fact is written on the page, in full, in a
 * format BTPS reads, readable and uncovered. So any case the snapshot refuses,
 * or a receiver would not show, is a fault, and its seed reproduces it.
 *
 * What varies (the catalogue of 2026-11-15): document type; currency (2, 0
 * and 3 decimals; symbols, codes before and after, separators); amounts that
 * collide (unit price and amount, a line and the total, subtotal and total,
 * zero tax, a total equal to the payment); dates that collide (issued, due,
 * paid on one day) and every written pattern; numbers that hold dates; names
 * with digits, accents and other scripts, split across elements; text that
 * wraps, after a label, in touching elements; line items as a table, as rows
 * or as cards, in narrow columns; markdown notes and letters; fonts (woff,
 * woff2, variable, split by unicode-range), weights, sizes, tabular figures,
 * letter spacing, capitals; colours and bands behind text; rounded and SVG
 * logos; drawn and typed signatures; page widths and padding.
 */

import { signatureDrawing } from '../src/signature.js';
import { claimFor, type Claim, type Hooks } from './claims.js';

export type Case = { seed: number; document: Record<string, unknown>; html: string; css: string; notes: string[]; claim?: Claim };

/** The fonts the sweep's page serves, by family: what each is and how it is served. */
export const FONTS = {
  Arimo: 'woff, split by unicode-range (latin, latin-ext, greek, cyrillic)',
  Tinos: 'woff2, split by unicode-range',
  Cousine: 'woff',
  Geist: 'variable woff2 (wght)',
  'Source Serif 4': 'variable woff2 (wght, opsz)',
  'Atkinson Hyperlegible Next': 'variable woff2 (wght)',
  Caveat: 'variable woff2, for a typed signature',
} as const;
type Family = keyof typeof FONTS;
const BODY_FAMILIES: Family[] = ['Arimo', 'Tinos', 'Cousine', 'Geist', 'Source Serif 4', 'Atkinson Hyperlegible Next'];
const LATIN_ONLY: Family[] = ['Cousine', 'Geist', 'Source Serif 4', 'Atkinson Hyperlegible Next'];

const random = (seed: number) => {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
    chance: (p: number) => next() < p,
  };
};
type Random = ReturnType<typeof random>;

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- Values ----

const CURRENCIES: { code: string; places: number; prefix?: string; suffix?: string }[] = [
  { code: 'AUD', places: 2, prefix: 'A$' },
  { code: 'USD', places: 2, prefix: '$' },
  { code: 'USD', places: 2, prefix: 'US$' },
  { code: 'EUR', places: 2, suffix: ' €' },
  { code: 'EUR', places: 2, prefix: '€' },
  { code: 'GBP', places: 2, prefix: '£' },
  { code: 'NZD', places: 2, prefix: 'NZ$' },
  { code: 'JPY', places: 0, prefix: '¥' },
  { code: 'KWD', places: 3, prefix: 'KWD ' },
  { code: 'CHF', places: 2, prefix: 'CHF ' },
  { code: 'SEK', places: 2, suffix: ' SEK' },
  { code: 'AUD', places: 2, suffix: ' AUD' },
  { code: 'AUD', places: 2 },
];
const SEPARATORS: { group: string; decimal: string }[] = [
  { group: ',', decimal: '.' },
  { group: ',', decimal: '.' },
  { group: '.', decimal: ',' },
  { group: ' ', decimal: ',' },
  { group: "'", decimal: '.' },
  { group: '', decimal: '.' },
];

type Money = { code: string; places: number; prefix?: string; suffix?: string; group: string; decimal: string };
const writeMoney = (minor: number, money: Money) => {
  const digits = String(Math.abs(minor)).padStart(money.places + 1, '0');
  const whole = digits.slice(0, digits.length - money.places).replace(/\B(?=(\d{3})+(?!\d))/g, money.group);
  const number = money.places > 0 ? `${whole}${money.decimal}${digits.slice(-money.places)}` : whole;
  return `${minor < 0 ? '-' : ''}${money.prefix ?? ''}${number}${money.suffix ?? ''}`;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DATE_PATTERNS = ['d MMMM yyyy', 'MMMM d, yyyy', 'd MMM yyyy', 'MMM d, yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'dd.MM.yyyy', 'dd-MM-yyyy', 'yyyy-MM-dd'];
const writeDate = (iso: string, pattern: string) => {
  const date = new Date(iso);
  const d = String(date.getUTCDate());
  const dd = d.padStart(2, '0');
  const MM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const month = MONTHS[date.getUTCMonth()] as string;
  const yyyy = String(date.getUTCFullYear());
  return {
    'd MMMM yyyy': `${d} ${month} ${yyyy}`,
    'MMMM d, yyyy': `${month} ${d}, ${yyyy}`,
    'd MMM yyyy': `${d} ${month.slice(0, 3)} ${yyyy}`,
    'MMM d, yyyy': `${month.slice(0, 3)} ${d}, ${yyyy}`,
    'dd/MM/yyyy': `${dd}/${MM}/${yyyy}`,
    'MM/dd/yyyy': `${MM}/${dd}/${yyyy}`,
    'dd.MM.yyyy': `${dd}.${MM}.${yyyy}`,
    'dd-MM-yyyy': `${dd}-${MM}-${yyyy}`,
    'yyyy-MM-dd': `${yyyy}-${MM}-${dd}`,
  }[pattern] as string;
};
const dayIso = (r: Random) => new Date(Date.UTC(2026, r.int(0, 11), r.int(1, 28))).toISOString();
const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86400000).toISOString();

const NAMES_LATIN = ['Studio', 'Apexworld', 'Northwind Studio', '300 Empire', 'Acme Pty Ltd', 'Kauri & Co', 'Café Noël', 'Website care', 'Blue Harbour Design', "O'Neill Plumbing", 'A1 Electrical', 'The 7th Day'];
const NAMES_WIDE = ['Łódź Ceramika', 'Dvořák Hudba', 'Ζήτα Studio', 'Москва Дизайн', 'Şahin Yapı', 'Nguyễn Café'];
const DESCRIPTIONS = [
  'Website care',
  'Website care, December',
  'Design hours',
  'Hosting',
  'Care',
  'Website maintenance and security updates for the month of November',
  'Pack of 2',
  '300 Empire signage',
  'Consulting (on site)',
  'Logo — final files',
  'Domain renewal: example.com.au',
  'Studio',
];
const TITLES = ['November', 'Website care', 'Website care, December', 'Services rendered', 'Invoice for Studio', 'Your new care plan', 'Thank you'];
const NOTES = [
  'Thanks for your business.',
  'Please pay by the due date.',
  'Website care',
  'Payment within 14 days.\nThank you for your business.',
  '**Thanks** for choosing us. See _our terms_ at [our site](https://example.com).',
  '- Pay by bank transfer\n- Quote the invoice number',
  '1. Check the lines\n2. Pay the total',
  'Note: a long sentence that will wrap over more than one line in most layouts, so it is found across lines as one text.',
];

type Line = { description: string; quantity: string; unit: number; tax: number; total: number };

const linesFor = (r: Random, places: number): Line[] => {
  const count = r.pick([1, 1, 2, 3, 4, 6, 9, 14]);
  const pool = [1, 5, 10, 100, 1000, 30000, 45000, 12000, 99, 49500].map((v) => v * (places === 0 ? 1 : places === 3 ? 10 : 1));
  const taxed = r.chance(0.6);
  const rate = taxed ? r.pick([5, 9, 10, 15, 20]) : 0;
  const out: Line[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0 && r.chance(0.15)) {
      out.push({ ...(out[i - 1] as Line) });
      continue;
    }
    const quantity = r.pick(['1', '1', '1', '2', '3', '0.5', '1.25', '10']);
    const unit = r.chance(0.7) ? r.pick(pool) : r.int(1, 2000000);
    const net = Math.round(unit * Number(quantity));
    const tax = Math.round((net * rate) / 100);
    out.push({ description: r.pick(DESCRIPTIONS), quantity, unit, tax, total: net + tax });
  }
  return out;
};

// ---- Markdown, as a platform renders it: its marks not drawn ----

const inline = (text: string) =>
  esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/_([^_]+)_/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
const markdownHtml = (source: string) =>
  source
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((line) => /^- /.test(line))) return `<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`;
      if (lines.every((line) => /^\d+\. /.test(line))) return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`;
      if (/^#{1,3} /.test(block)) return `<h3>${inline(block.replace(/^#{1,3} /, ''))}</h3>`;
      return `<p>${inline(block)}</p>`;
    })
    .join('');
const isMarkdown = (text: string) => /\*\*|_[^_]+_|\[[^\]]+\]\(|^- |^\d+\. /m.test(text);

// ---- The page ----

type Look = {
  family: Family;
  headingFamily: Family;
  numberFamily: Family;
  tabular: boolean;
  size: number;
  width: number;
  padding: number;
  lineHeight: number;
  ink: string;
  muted: string;
  accent: string;
  background: string;
  band: string;
  money: Money;
  datePattern: string;
  labelCase: 'none' | 'uppercase';
  spacing: number;
};

const lookFor = (r: Random, wide: boolean): Look => {
  const families = wide ? (['Arimo', 'Tinos'] as Family[]) : BODY_FAMILIES;
  const dark = r.chance(0.15);
  return {
    family: r.pick(families),
    headingFamily: r.pick(families),
    numberFamily: r.chance(0.7) ? r.pick(families) : r.pick(families),
    tabular: r.chance(0.3),
    size: r.pick([11, 12, 13, 14, 16]),
    width: r.pick([420, 520, 600, 720, 794]),
    padding: r.pick([0, 8, 24, 40]),
    lineHeight: r.pick([1.25, 1.4, 1.6]),
    ink: dark ? '#f5f7fa' : r.pick(['#0f1b2d', '#1f2933', '#111111', '#2a1a4a']),
    muted: dark ? '#c9d1db' : r.pick(['#52606d', '#4a4a4a', '#3d4a5c']),
    accent: dark ? '#9be7c4' : r.pick(['#0b6e4f', '#1d4ed8', '#7c2d12', '#6d28d9']),
    background: dark ? '#14181f' : r.pick(['#ffffff', '#ffffff', '#fbfaf7', '#f4f7fb']),
    band: dark ? '#222a35' : r.pick(['#eef2f7', '#e9f7ef', '#fff7e6', '#f1edfb']),
    money: { ...r.pick(CURRENCIES), ...r.pick(SEPARATORS) },
    datePattern: r.pick(DATE_PATTERNS),
    labelCase: r.chance(0.3) ? 'uppercase' : 'none',
    spacing: r.pick([0, 0, 0, 0.3, 0.8]),
  };
};

const ink = (look: Look) => `color:${look.ink}`;
const label = (look: Look, text: string, tag = 'span') =>
  `<${tag} class="label" style="color:${look.muted};text-transform:${look.labelCase};letter-spacing:${look.spacing}px">${esc(text)}</${tag}>`;

/** A value written as the page writes it: in one element, after a label in the same element, or split across two. */
const valueHtml = (r: Random, text: string, prefix?: string) => {
  const parts = text.split(' ');
  if (prefix !== undefined && r.chance(0.35)) return `<span>${esc(prefix)} ${esc(text)}</span>`;
  if (parts.length > 1 && r.chance(0.2)) {
    const cut = r.int(1, parts.length - 1);
    return `<span>${esc(parts.slice(0, cut).join(' '))}</span> <b>${esc(parts.slice(cut).join(' '))}</b>`;
  }
  const dash = text.indexOf('-');
  if (dash > 0 && dash < text.length - 1 && r.chance(0.3)) {
    return `<span>${esc(text.slice(0, dash + 1))}</span><b>${esc(text.slice(dash + 1))}</b>`;
  }
  return `${prefix !== undefined ? `${esc(prefix)} ` : ''}<span>${esc(text)}</span>`;
};

const logoHtml = (r: Random, extra = '') => {
  const kind = r.pick(['none', 'none', 'png', 'png-round', 'svg-inline', 'svg-img']);
  const size = r.pick([32, 48, 64, 96]);
  switch (kind) {
    case 'png':
      return `<img src="/logo.png" alt="" width="${size}" height="${size}" style="display:block;${extra}">`;
    case 'png-round':
      return `<img src="/logo.png" alt="" width="${size}" height="${size}" style="display:block;border-radius:${r.pick([6, 12, size / 2])}px;${extra}">`;
    case 'svg-inline':
      return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" style="${extra}"><rect x="4" y="4" width="56" height="56" rx="12" fill="#1d4ed8"/><circle cx="32" cy="32" r="14" fill="#ffffff"/></svg>`;
    case 'svg-img':
      return `<img src="/logo.svg" alt="" width="${size * 2}" height="${size}" style="display:block;${extra}">`;
    default:
      return '';
  }
};

const signatureHtml = (signatory: { name: string; title?: string; visualSignature?: { type: string; text?: string; strokes?: number[][] } }, look: Look) => {
  const visual = signatory.visualSignature;
  // By the one rule the engine draws it with (signatureDrawing), as a platform shows it.
  const shapes = visual?.type === 'drawn' ? signatureDrawing(visual.strokes ?? []) : undefined;
  const drawn =
    shapes !== undefined
      ? `<svg viewBox="0 0 1000 300" width="200" height="60" style="display:block;color:${look.ink}">${shapes.dots
          .map(({ cx, cy, r }) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>`)
          .join('')}${shapes.line ? `<path d="${shapes.line.d}" fill="none" stroke="currentColor" stroke-width="${shapes.line.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>` : ''}</svg>`
      : visual?.type === 'typed'
        ? `<p style="font-family:'Caveat';font-size:28px;margin:0">${esc(visual.text ?? '')}</p>`
        : '';
  return `<div class="signoff" style="margin-top:16px">${drawn}<p style="margin:4px 0 0"><b>${esc(signatory.name)}</b></p>${
    signatory.title ? `<p style="margin:0;color:${look.muted}">${esc(signatory.title)}</p>` : ''
  }</div>`;
};

// ---- Effects: the rest of CSS a designer reaches for, on any element ----

/**
 * From its own stream (so a seed's layout stays as it was): styles for the page's boxes, its logo and its labels, and
 * the decorations and rules beside them. A fact's text keeps its contrast: an effect that fades or blurs is put only on
 * what holds no fact. `used` names each effect a case has, so a failure says which.
 */
const effectsFor = (seed: number, look: Look) => {
  const r = random((seed * 2654435761) ^ 0x5bd1e995);
  const used: string[] = [];
  const maybe = (p: number, name: string, value: () => string) => {
    if (!r.chance(p)) return '';
    used.push(name);
    return value();
  };
  const alphaOf = (colour: string, a: number) => {
    const n = parseInt(colour.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  /** A box: borders of every kind, corners, shadows, outlines, gradients, a background image. */
  const box = (where: string) =>
    [
      maybe(0.12, `${where}:border-dashed`, () => `border:${r.pick([1, 2])}px ${r.pick(['dashed', 'dotted'])} ${look.muted};`),
      maybe(0.08, `${where}:border-double`, () => `border:3px double ${look.muted};`),
      maybe(0.1, `${where}:border-sides`, () => `border-left:${r.pick([3, 4, 6])}px solid ${look.accent};border-bottom:1px solid ${look.muted};`),
      maybe(0.1, `${where}:radius-corners`, () => `border-radius:${r.pick([0, 4, 12])}px ${r.pick([8, 16])}px ${r.pick([0, 6])}px ${r.pick([10, 20])}px;`),
      maybe(0.12, `${where}:shadow`, () => `box-shadow:${r.pick(['0 1px 3px rgba(0,0,0,.2)', '0 4px 12px rgba(0,0,0,.15)', `2px 2px 0 ${look.accent}`, 'inset 0 0 0 2px rgba(0,0,0,.08)'])};`),
      maybe(0.06, `${where}:outline`, () => `outline:2px ${r.pick(['solid', 'dashed'])} ${look.accent};outline-offset:${r.pick([0, 2, 4])}px;`),
      maybe(0.1, `${where}:radial`, () => `background:radial-gradient(circle at ${r.pick(['top left', 'center', '80% 20%'])}, ${look.band}, ${look.background});`),
      maybe(0.08, `${where}:linear-angle`, () => `background:linear-gradient(${r.pick([30, 135, 200])}deg, ${look.band} 0%, ${look.background} 60%, ${look.band} 100%);`),
      maybe(0.06, `${where}:repeating`, () => `background:repeating-linear-gradient(45deg, ${look.background} 0 8px, ${look.band} 8px 16px);`),
      maybe(0.06, `${where}:bg-alpha`, () => `background-color:${alphaOf(look.accent, 0.08)};`),
      maybe(0.05, `${where}:bg-image`, () => `background-image:url(/logo.png);background-repeat:no-repeat;background-size:${r.pick(['24px', 'contain', 'auto 70%'])};background-position:${r.pick(['right top', 'right 8px center', '95% 90%'])};`),
    ].join('');
  /** The logo: placed, fitted, turned, clipped, filtered as a designer may. */
  const logo = () =>
    [
      maybe(0.15, 'logo:object-fit', () => `object-fit:${r.pick(['contain', 'cover', 'none', 'scale-down', 'fill'])};object-position:${r.pick(['center', 'left top', '30% 70%'])};width:${r.pick([60, 120])}px;height:${r.pick([40, 60])}px;`),
      maybe(0.1, 'logo:rotate', () => `transform:rotate(${r.pick([-8, -3, 5, 12])}deg);`),
      maybe(0.08, 'logo:skew', () => `transform:skew(${r.pick([-12, 8])}deg, ${r.pick([0, 4])}deg);`),
      maybe(0.08, 'logo:scale', () => `transform:scale(${r.pick([0.8, 1.25])});transform-origin:left top;`),
      maybe(0.08, 'logo:opacity', () => `opacity:${r.pick([0.5, 0.8])};`),
      maybe(0.08, 'logo:filter', () => `filter:${r.pick(['grayscale(1)', 'sepia(.6)', 'drop-shadow(2px 2px 2px rgba(0,0,0,.4))', 'blur(1px)', 'brightness(1.2) contrast(1.3)'])};`),
      maybe(0.08, 'logo:clip', () => `clip-path:${r.pick(['circle(45%)', 'inset(4px round 8px)', 'polygon(0 0, 100% 0, 85% 100%, 0 100%)'])};`),
      maybe(0.06, 'logo:shadow-radius', () => `border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.3);`),
      maybe(0.05, 'logo:blend', () => `mix-blend-mode:multiply;`),
    ].join('');
  /** A label's text: underlined, struck, shadowed, small capitals, translucent ink. */
  const label = () =>
    [
      maybe(0.08, 'label:underline', () => `text-decoration:underline ${r.pick(['solid', 'dotted', 'wavy'])} ${look.accent};text-underline-offset:3px;`),
      maybe(0.04, 'label:line-through', () => `text-decoration:line-through;`),
      maybe(0.06, 'label:text-shadow', () => `text-shadow:1px 1px 0 ${look.band};`),
      maybe(0.06, 'label:small-caps', () => `font-variant:small-caps;`),
      maybe(0.06, 'label:ink-alpha', () => `color:${alphaOf(look.ink, 0.7)};`),
      maybe(0.04, 'label:italic', () => `font-style:italic;`),
    ].join('');
  /** Decorations beside the facts: a rotated stamp, a rule, a faded badge, a heading bar made by ::before. */
  const extras = [
    maybe(0.1, 'extra:stamp', () => `<div style="position:absolute;right:${r.pick([16, 40])}px;top:${r.pick([60, 120])}px;transform:rotate(${r.pick([-15, 10])}deg);border:3px solid ${look.accent};color:${look.accent};padding:2px 10px;font-weight:700;opacity:${r.pick([0.6, 0.9])};pointer-events:none">${r.pick(['PAID', 'COPY', 'THANK YOU'])}</div>`),
    maybe(0.12, 'extra:hr', () => `<hr style="border:0;border-top:${r.pick([1, 2])}px ${r.pick(['solid', 'dashed'])} ${look.muted};margin:12px 0">`),
    maybe(0.06, 'extra:svg-gradient', () => `<svg width="120" height="8" style="display:block"><defs><linearGradient id="g${seed}"><stop offset="0" stop-color="${look.accent}"/><stop offset="1" stop-color="${look.band}"/></linearGradient></defs><rect width="120" height="8" rx="4" fill="url(#g${seed})"/></svg>`),
  ].join('');
  const css = [
    maybe(0.12, 'css:before-bar', () => `#preview .label::before{content:'';display:inline-block;width:4px;height:0.8em;margin-right:6px;background:${look.accent};vertical-align:-1px}`),
    maybe(0.1, 'css:after-colon', () => `#preview .label::after{content:':'}`),
    maybe(0.08, 'css:page-shadow', () => `#preview{box-shadow:0 2px 10px rgba(0,0,0,.12);border-radius:${r.pick([0, 8])}px}`),
    maybe(0.06, 'css:page-border-top', () => `#preview{border-top:6px solid ${look.accent}}`),
    maybe(0.08, 'css:table-cells', () => `#preview td,#preview th{border:1px solid ${look.band}}#preview th{background:${look.band}}`),
    maybe(0.06, 'css:first-letter', () => `#preview footer::first-letter{font-size:1.4em;color:${look.accent}}`),
  ].join('\n');
  return { box, logo, label, extras, css, used };
};

/** No effects: a claim's case varies only by what the claim puts in it. */
const noEffects: ReturnType<typeof effectsFor> = { box: () => '', logo: () => '', label: () => '', extras: '', css: '', used: [] };

// ---- Documents and their pages ----

const bill = (r: Random, seed: number, type: 'invoice' | 'receipt', hooks: Hooks): Case => {
  const notes: string[] = [];
  const wide = r.chance(0.12);
  const look = { ...lookFor(r, wide), ...(hooks.width !== undefined && { width: hooks.width }) };
  const fx = hooks.plain ? noEffects : effectsFor(seed, look);
  const lines = linesFor(r, look.money.places);
  const issuedAt = dayIso(r);
  const dueAt = addDays(issuedAt, r.pick([0, 7, 14, 30]));
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  const tax = lines.reduce((sum, line) => sum + line.tax, 0);
  const subtotal = total - tax;
  const issuer = wide ? r.pick(NAMES_WIDE) : r.pick(NAMES_LATIN);
  const recipient = r.chance(0.5) ? r.pick([...NAMES_LATIN, ...(wide ? NAMES_WIDE : [])]) : undefined;
  const ids = ['INV-0042', 'INV-0042-A', `INV-${issuedAt.slice(0, 10)}`, '2026/0042', '1042', 'A1'];
  const id = r.pick(ids) + hooks.glyph;
  const description = r.chance(0.5) ? r.pick(NOTES) : undefined;
  const title = r.chance(0.3) ? (lines[0] as Line).description : r.pick(TITLES);
  const columns = r.pick([
    ['Description', 'Amount'],
    ['Description', 'Qty', 'Unit price', 'Amount'],
    ['Description', 'Qty', 'Unit price', 'Tax', 'Amount'],
    ['Item', 'Price', 'Total'],
  ]);
  const roleOf = (column: string) => (column === 'Description' || column === 'Item' ? 'description' : column === 'Amount' || column === 'Total' ? 'lineTotal' : undefined);
  const rows = lines.map((line) =>
    Object.fromEntries(
      columns.map((column) => [
        column,
        column === 'Description' || column === 'Item'
          ? line.description
          : column === 'Qty'
            ? line.quantity
            : column === 'Unit price' || column === 'Price'
              ? line.unit
              : column === 'Tax'
                ? line.tax
                : line.total,
      ]),
    ),
  );
  const paid = type === 'receipt' ? (r.chance(0.7) ? total : Math.max(1, Math.round(total / r.pick([2, 3, 4])))) : 0;
  const paidAt = type === 'receipt' ? (r.chance(0.6) ? issuedAt : addDays(issuedAt, -r.int(1, 20))) : '';
  const money = (amount: number) => ({ amount, currency: look.money.code });
  const document: Record<string, unknown> = {
    type,
    title,
    id,
    issuedAt,
    ...(type === 'invoice' && { dueAt }),
    totalAmount: money(total),
    ...(tax !== 0 && { subtotalAmount: money(subtotal), taxAmount: money(tax) }),
    issuer: { name: issuer },
    ...(recipient && { recipient: { name: recipient } }),
    ...(description && { description: isMarkdown(description) ? { format: 'markdown', content: description } : description }),
    lineItems: {
      columns,
      roles: Object.fromEntries(columns.flatMap((column) => (roleOf(column) ? [[column, roleOf(column)]] : []))),
      rows,
    },
    ...(type === 'receipt' && { payment: { amount: money(paid), paidAt, method: 'bank_transfer' } }),
  };

  const m = (minor: number) => esc(writeMoney(minor, look.money));
  const d = (iso: string) => writeDate(iso, look.datePattern);
  const cell = (column: string, row: Record<string, unknown>) => {
    const value = row[column];
    return typeof value === 'number' ? m(value) : esc(String(value));
  };
  const layout = r.pick(['table', 'table', 'rows', 'cards']);
  const descWidth = r.pick(['auto', '120px', '160px', '50%']);
  const numberStyle = `font-family:'${look.numberFamily}';${look.tabular ? 'font-variant-numeric:tabular-nums;' : ''}`;
  let linesHtml: string;
  if (layout === 'table') {
    linesHtml = `<table style="width:100%;border-collapse:collapse;margin:12px 0;${fx.box('table')}">
      <thead><tr>${columns.map((c, i) => `<th style="text-align:${i === 0 ? 'left' : 'right'};padding:6px 4px;border-bottom:1px solid ${look.muted};color:${look.muted};font-weight:600">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows
        .map(
          (row, n) =>
            `<tr style="${n % 2 && r.chance(0.5) ? `background:${look.band};` : ''}">${columns
              .map((c, i) => `<td style="padding:6px 4px;vertical-align:${r.pick(['top', 'middle', 'baseline'])};text-align:${i === 0 ? 'left' : 'right'};${i === 0 ? `width:${descWidth};` : numberStyle}">${cell(c, row)}</td>`)
              .join('')}</tr>`,
        )
        .join('')}</tbody></table>`;
  } else if (layout === 'rows') {
    linesHtml = rows
      .map(
        (row) =>
          `<div style="display:flex;gap:12px;justify-content:space-between;padding:6px 0;border-bottom:1px solid ${look.band}">${columns
            .map((c, i) => `<div style="${i === 0 ? `flex:1;max-width:${descWidth === 'auto' ? '60%' : descWidth}` : `${numberStyle}text-align:right`}">${cell(c, row)}</div>`)
            .join('')}</div>`,
      )
      .join('');
  } else {
    linesHtml = rows
      .map(
        (row) =>
          `<div style="padding:8px;margin:8px 0;border:1px solid ${look.band};border-radius:8px;${fx.box('card')}"><div style="font-weight:600">${cell(columns[0] as string, row)}</div>${columns
            .slice(1)
            .map((c) => `<div style="display:flex;justify-content:space-between">${label(look, c)}<span style="${numberStyle}">${cell(c, row)}</span></div>`)
            .join('')}</div>`,
      )
      .join('');
  }
  notes.push(`layout ${layout}, ${lines.length} lines, ${look.money.code} ${JSON.stringify(look.money)}, ${look.datePattern}, ${look.family}/${look.headingFamily}/${look.numberFamily}`);

  const amountBox = `<div style="background:${look.band};padding:${r.pick([4, 12])}px;border-radius:${r.pick([0, 8])}px;${fx.box('amount')}">${label(look, type === 'invoice' ? 'Amount due' : 'Amount paid', 'div')}<div style="font-size:${look.size + 8}px;font-weight:700;${numberStyle}">${m(type === 'invoice' ? total : paid)}</div></div>`;
  const nameSplit = issuer.includes(' ') && r.chance(0.3);
  const issuerHtml = nameSplit
    ? `<h1 style="font-family:'${look.headingFamily}';margin:0;font-size:22px">${esc(issuer.split(' ')[0] as string)}</h1><h2 style="font-family:'${look.headingFamily}';margin:0;font-size:16px">${esc(issuer.split(' ').slice(1).join(' '))}</h2>`
    : `<h1 style="font-family:'${look.headingFamily}';margin:0;font-size:${r.pick([18, 22, 28])}px;text-transform:${r.chance(0.15) ? 'uppercase' : 'none'}">${esc(issuer)}</h1>`;
  // What a design may leave out though the document carries it (the exceptions, decided 2026-11-16).
  const shows = { issuer: r.chance(0.8), issued: r.chance(0.8), recipient: r.chance(0.8), subtotal: r.chance(0.7) };
  notes.push(`leaves out ${Object.entries(shows).filter(([, shown]) => !shown).map(([what]) => what).join(', ') || 'nothing'}`);
  const sections = {
    header: `<header style="display:flex;gap:12px;align-items:${r.pick(['center', 'flex-start'])};justify-content:${r.pick(['flex-start', 'space-between'])};${fx.box('header')}">${logoHtml(r, fx.logo())}<div>${shows.issuer ? issuerHtml : ''}</div><div style="text-align:right">${label(look, type === 'invoice' ? (tax ? 'Tax invoice' : 'Invoice') : 'Receipt', 'div')}<div><span class="anchor">${valueHtml(r, id, r.chance(0.5) ? 'No.' : undefined)}</span></div></div></header>`,
    details: `<div style="display:${r.pick(['flex', 'grid', 'block'])};gap:16px;margin:12px 0;grid-template-columns:1fr 1fr">
      ${shows.issued ? `<div>${label(look, 'Issued')} ${valueHtml(r, d(issuedAt))}</div>` : ''}
      ${type === 'invoice' ? `<div>${label(look, 'Due')} ${valueHtml(r, d(dueAt))}</div>` : `<div>${label(look, 'Paid on')} ${valueHtml(r, d(paidAt))}</div>`}
      ${recipient && shows.recipient ? `<div>${label(look, 'Bill to')} <b>${esc(recipient)}</b></div>` : ''}
    </div>`,
    lines: linesHtml,
    totals: `<div style="margin-left:auto;max-width:${r.pick(['260px', '50%', '100%'])};${fx.box('totals')}">
      ${tax !== 0 && shows.subtotal ? `<div style="display:flex;justify-content:space-between">${label(look, 'Subtotal')}<span style="${numberStyle}">${m(subtotal)}</span></div>` : ''}
      ${tax !== 0 ? `<div style="display:flex;justify-content:space-between">${label(look, 'Tax')}<span style="${numberStyle}">${m(tax)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-weight:700">${label(look, 'Total')}<span style="${numberStyle}">${m(total)}</span></div>
      ${amountBox}
    </div>`,
    notes: description
      ? `<div style="margin-top:12px;${fx.box('notes')}">${label(look, 'Notes', 'div')}${isMarkdown(description) ? markdownHtml(description) : `<p style="white-space:pre-wrap;margin:4px 0">${esc(description)}</p>`}</div>`
      : '',
    footer: r.chance(0.4) ? `<footer style="margin-top:16px;color:${look.muted};font-size:11px">${esc(r.pick(['Kauri Studio', 'Thank you', 'Registered in Australia']))}</footer>` : '',
  };
  const order = r.chance(0.5)
    ? (['header', 'details', 'lines', 'totals', 'notes', 'footer'] as const)
    : (['header', 'totals', 'details', 'lines', 'notes', 'footer'] as const);
  const labelFx = fx.label();
  const html = `<div id="preview" class="page">${order.map((key, i) => (i === 1 ? fx.extras : '') + sections[key]).join('')}${hooks.html}</div>`;
  const css = `${pageCss(look)}\n#preview{position:relative}\n${labelFx ? `#preview .label{${labelFx}}` : ''}\n${fx.css}\n${hooks.css}`;
  notes.push(`effects ${fx.used.join(', ') || 'none'}`);
  return { seed, document, html, css, notes };
};

const letter = (r: Random, seed: number, hooks: Hooks): Case => {
  const wide = r.chance(0.12);
  const look = { ...lookFor(r, wide), ...(hooks.width !== undefined && { width: hooks.width }) };
  const fx = hooks.plain ? noEffects : effectsFor(seed, look);
  const issuedAt = dayIso(r);
  const issuer = wide ? r.pick(NAMES_WIDE) : r.pick(NAMES_LATIN);
  const recipient = r.pick(['Demo', 'Northwind Studio', 'Jane Doe', ...(wide ? NAMES_WIDE : [])]);
  const paragraphs = r.int(1, 6);
  const sentences = [
    `Your new care plan starts on ${writeDate(addDays(issuedAt, 14), 'd MMMM yyyy')}.`,
    'It covers monthly updates, hosting and support.',
    `${issuer} looks forward to working with you.`,
    'Please reply if anything here is unclear; we are happy to help.',
    'This letter replaces the one we sent last month.',
  ];
  const markdown = r.chance(0.5);
  const body = Array.from({ length: paragraphs }, (_, i) => {
    if (markdown && i === 1) return r.pick(['- monthly updates\n- hosting', '1. first\n2. second', '**Important:** read this _carefully_.']);
    return Array.from({ length: r.int(1, 3) }, () => r.pick(sentences)).join(r.chance(0.3) ? '\n' : ' ');
  });
  const content = [`Dear ${recipient},`, ...body, `Kind regards,\n${issuer}${hooks.glyph}`].join('\n\n');
  const signed = r.chance(0.6);
  const visual = signed
    ? r.chance(0.5)
      ? { type: 'typed', text: r.pick(['Jane Doe', 'J. Doe', issuer]) }
      : { type: 'drawn', strokes: [[100, 200, 200, 100, 300, 220], [350, 150, 500, 160, 650, 120, 800, 200]] }
    : undefined;
  const signatory = { name: r.pick(['Jane Doe', issuer]), ...(r.chance(0.6) && { title: 'Director' }), ...(visual && { visualSignature: visual }) };
  const document: Record<string, unknown> = {
    type: 'letter',
    title: r.pick(TITLES),
    id: 'LTR-0007',
    issuedAt,
    issuer: { name: issuer },
    recipient: { name: recipient },
    body: { format: markdown ? 'markdown' : 'text', content },
    ...(signed || r.chance(0.5) ? { signatory } : {}),
  };
  const bodyHtml = markdown
    ? markdownHtml(content)
    : content
        .split(/\n{2,}/)
        .map((p) => `<p style="white-space:pre-wrap">${esc(p)}</p>`)
        .join('');
  const html = `<div id="preview" class="page"><header style="display:flex;justify-content:space-between;${fx.box('header')}">${logoHtml(r, fx.logo())}<div style="text-align:right"><b style="font-family:'${look.headingFamily}'">${esc(issuer)}</b><div><span class="anchor">${esc(writeDate(issuedAt, look.datePattern))}</span></div></div></header>
    ${fx.extras}<p><b>${esc(recipient)}</b></p>${bodyHtml}${'signatory' in document ? signatureHtml(document.signatory as never, look) : ''}${hooks.html}</div>`;
  return { seed, document, html, css: `${pageCss(look)}\n#preview{position:relative}\n${fx.css}\n${hooks.css}`, notes: [`letter, ${markdown ? 'markdown' : 'text'}, ${paragraphs} paragraphs, signature ${visual?.type ?? 'none'}, ${look.family}`, `effects ${fx.used.join(', ') || 'none'}`] };
};

const PAY_CATEGORIES = [
  ['ordinary', 'Ordinary hours'],
  ['overtime', 'Overtime'],
  ['allowance', 'Travel allowance'],
  ['bonus', 'Bonus'],
] as const;

/** A payslip: who employs whom, the period, earnings, deductions and contributions, gross, tax and net pay. */
const payslip = (r: Random, seed: number, hooks: Hooks): Case => {
  const wide = r.chance(0.12);
  const look = { ...lookFor(r, wide), ...(hooks.width !== undefined && { width: hooks.width }) };
  const fx = hooks.plain ? noEffects : effectsFor(seed, look);
  const scale = look.money.places === 0 ? 1 : look.money.places === 3 ? 10 : 1;
  const start = dayIso(r);
  const end = addDays(start, r.pick([6, 13, 30]));
  const payDate = addDays(end, r.pick([0, 1, 3]));
  const issuer = wide ? r.pick(NAMES_WIDE) : r.pick(NAMES_LATIN);
  const employee = r.pick(['Mira Patel', 'Jo Bloggs', 'Sam Lee', "Liam O'Connor", ...(wide ? ['Zoë Dvořák'] : [])]);
  const earnings = Array.from({ length: r.int(1, 4) }, (_, i) => {
    const [category, description] = PAY_CATEGORIES[i % PAY_CATEGORIES.length] as readonly [string, string];
    return { category, description, amount: r.pick(i === 0 ? [150000, 385000, 120050] : [42000, 9000, 120050]) * scale };
  });
  const gross = earnings.reduce((sum, e) => sum + e.amount, 0);
  const deductions = r.chance(0.6) ? [{ category: 'salary_sacrifice', description: 'Salary sacrifice', amount: r.pick([5000, 9745, 20000]) * scale }] : [];
  const contributions = r.chance(0.7) ? [{ category: 'super', amount: Math.round(gross * 0.115) }] : [];
  const taxWithheld = Math.round(gross * r.pick([0.18, 0.21, 0.3]));
  const net = gross - taxWithheld - deductions.reduce((sum, d) => sum + d.amount, 0);
  const money = (amount: number) => ({ amount, currency: look.money.code });
  const id = r.pick(['PAY-0042', 'PAY-2026-11', '1042']) + hooks.glyph;
  const document: Record<string, unknown> = {
    type: 'payslip',
    title: r.pick(['Payslip', 'November pay', 'Your pay']),
    id,
    issuedAt: payDate,
    issuer: { name: issuer },
    employee: { name: employee },
    payPeriod: { start, end },
    payDate,
    earnings: earnings.map((e) => ({ category: e.category, description: e.description, amount: money(e.amount) })),
    deductions: deductions.map((d) => ({ category: d.category, description: d.description, amount: money(d.amount) })),
    contributions: contributions.map((c) => ({ category: c.category, amount: money(c.amount) })),
    taxWithheld: money(taxWithheld),
    gross: money(gross),
    net: money(net),
  };
  const m = (minor: number) => esc(writeMoney(minor, look.money));
  const d = (iso: string) => esc(writeDate(iso, look.datePattern));
  const numberStyle = `font-family:'${look.numberFamily}';${look.tabular ? 'font-variant-numeric:tabular-nums;' : ''}`;
  const row = (name: string, amount: number) =>
    `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid ${look.band}"><span>${esc(name)}</span><span style="${numberStyle}">${m(amount)}</span></div>`;
  const html = `<div id="preview" class="page"><header style="display:flex;justify-content:space-between;gap:12px;${fx.box('header')}">${logoHtml(r, fx.logo())}<div><b style="font-family:'${look.headingFamily}'">${esc(issuer)}</b></div><div style="text-align:right">${label(look, 'Payslip', 'div')}<span class="anchor">${valueHtml(r, id)}</span></div></header>
    ${fx.extras}<div style="margin:12px 0">${label(look, 'Employee')} <b>${esc(employee)}</b></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap">${label(look, 'Period')} <span>${d(start)}</span> – <span>${d(end)}</span> ${label(look, 'Paid')} <span>${d(payDate)}</span></div>
    <div style="margin-top:12px;${fx.box('table')}">${label(look, 'Earnings', 'div')}${earnings.map((e) => row(e.description, e.amount)).join('')}</div>
    ${deductions.length ? `<div style="margin-top:12px">${label(look, 'Deductions', 'div')}${deductions.map((x) => row(x.description, x.amount)).join('')}</div>` : ''}
    ${contributions.length ? `<div style="margin-top:12px">${label(look, 'Super', 'div')}${contributions.map((c) => `<div style="${numberStyle}">${m(c.amount)}</div>`).join('')}</div>` : ''}
    <div style="margin-left:auto;max-width:280px;margin-top:12px;${fx.box('totals')}">${row('Gross', gross)}${row('Tax withheld', taxWithheld)}<div style="display:flex;justify-content:space-between;font-weight:700;background:${look.band};padding:6px">${label(look, 'Net pay')}<span style="${numberStyle}">${m(net)}</span></div></div>${hooks.html}</div>`;
  return { seed, document, html, css: `${pageCss(look)}\n#preview{position:relative}\n${fx.css}\n${hooks.css}`, notes: [`payslip, ${earnings.length} earnings, ${deductions.length} deductions, ${look.money.code}, ${look.family}`, `effects ${fx.used.join(', ') || 'none'}`] };
};

/** An agreement: a letter its signers are asked to accept, with a day to answer by. */
const agreement = (r: Random, seed: number, hooks: Hooks): Case => {
  const made = letter(r, seed, hooks);
  const issuedAt = made.document.issuedAt as string;
  const by = r.chance(0.6) ? addDays(issuedAt, r.pick([14, 30])) : undefined;
  const document: Record<string, unknown> = {
    ...made.document,
    type: 'agreement',
    id: 'AGR-0007',
    acceptance: {
      ...(by !== undefined && { by }),
      terms: [],
      signers: [{ address: 'pay$client.example' }, ...(r.chance(0.4) ? [{ address: 'sam$guarantor.example' }] : [])],
      signingOrder: r.pick(['sequential', 'any']),
    },
    originatorSignature: { selector: 'unsigned', signature: { algorithmHash: 'sha256', value: 'unsigned', fingerprint: 'unsigned' } },
  };
  const answer = by !== undefined ? `<p style="margin:8px 0"><span class="label">Answer by</span> <b>${esc(writeDate(by, 'd MMMM yyyy'))}</b></p>` : '';
  const html = made.html.replace('</header>', `</header><h2 style="margin:8px 0">Agreement</h2>${answer}`);
  return { ...made, document, html, notes: [`agreement${by ? ', answer by' : ''}`, ...made.notes] };
};

const pageCss = (look: Look) => `
  #preview { width:${look.width}px; box-sizing:border-box; padding:${look.padding + 8}px; background:${look.background}; font-family:'${look.family}'; font-size:${look.size}px; line-height:${look.lineHeight}; ${ink(look)}; }
  #preview h1, #preview h2, #preview h3 { line-height:1.2; }
  #preview a { color:${look.accent}; }
  #preview p { margin:6px 0; }
`;

/** The case a seed makes. */
/** The five types, one a seed in turn: as many of each. */
export const TYPES = ['invoice', 'receipt', 'letter', 'payslip', 'agreement'] as const;

/** The case a seed makes: its type by the seed in turn; with a claim of the docs to test, for the seeds that carry one. */
export const generate = (seed: number): Case => {
  const r = random(seed);
  const type = TYPES[seed % TYPES.length] as (typeof TYPES)[number];
  const claim = claimFor(seed);
  const hooks = claim?.hooks(type) ?? { plain: false, html: '', css: '', glyph: '' };
  const made =
    type === 'letter'
      ? letter(r, seed, hooks)
      : type === 'payslip'
        ? payslip(r, seed, hooks)
        : type === 'agreement'
          ? agreement(r, seed, hooks)
          : bill(r, seed, type, hooks);
  return claim ? { ...made, claim, notes: [`claim ${claim.group}: ${claim.item}`, ...made.notes] } : made;
};

export { LATIN_ONLY };
