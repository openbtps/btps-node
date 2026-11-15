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

export type Case = { seed: number; document: Record<string, unknown>; html: string; css: string; notes: string[] };

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

const logoHtml = (r: Random) => {
  const kind = r.pick(['none', 'none', 'png', 'png-round', 'svg-inline', 'svg-img']);
  const size = r.pick([32, 48, 64, 96]);
  switch (kind) {
    case 'png':
      return `<img src="/logo.png" alt="" width="${size}" height="${size}" style="display:block">`;
    case 'png-round':
      return `<img src="/logo.png" alt="" width="${size}" height="${size}" style="display:block;border-radius:${r.pick([6, 12, size / 2])}px">`;
    case 'svg-inline':
      return `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="12" fill="#1d4ed8"/><circle cx="32" cy="32" r="14" fill="#ffffff"/></svg>`;
    case 'svg-img':
      return `<img src="/logo.svg" alt="" width="${size * 2}" height="${size}" style="display:block">`;
    default:
      return '';
  }
};

const signatureHtml = (signatory: { name: string; title?: string; visualSignature?: { type: string; text?: string; strokes?: number[][] } }, look: Look) => {
  const visual = signatory.visualSignature;
  const drawn =
    visual?.type === 'drawn'
      ? `<svg viewBox="0 0 1000 300" width="200" height="60" style="display:block;color:${look.ink}">${(visual.strokes ?? [])
          .map((stroke) => `<polyline points="${stroke.join(' ')}" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>`)
          .join('')}</svg>`
      : visual?.type === 'typed'
        ? `<p style="font-family:'Caveat';font-size:28px;margin:0">${esc(visual.text ?? '')}</p>`
        : '';
  return `<div class="signoff" style="margin-top:16px">${drawn}<p style="margin:4px 0 0"><b>${esc(signatory.name)}</b></p>${
    signatory.title ? `<p style="margin:0;color:${look.muted}">${esc(signatory.title)}</p>` : ''
  }</div>`;
};

// ---- Documents and their pages ----

const bill = (r: Random, seed: number, type: 'invoice' | 'receipt'): Case => {
  const notes: string[] = [];
  const wide = r.chance(0.12);
  const look = lookFor(r, wide);
  const lines = linesFor(r, look.money.places);
  const issuedAt = dayIso(r);
  const dueAt = addDays(issuedAt, r.pick([0, 7, 14, 30]));
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  const tax = lines.reduce((sum, line) => sum + line.tax, 0);
  const subtotal = total - tax;
  const issuer = wide ? r.pick(NAMES_WIDE) : r.pick(NAMES_LATIN);
  const recipient = r.chance(0.5) ? r.pick([...NAMES_LATIN, ...(wide ? NAMES_WIDE : [])]) : undefined;
  const ids = ['INV-0042', 'INV-0042-A', `INV-${issuedAt.slice(0, 10)}`, '2026/0042', '1042', 'A1'];
  const id = r.pick(ids);
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
    linesHtml = `<table style="width:100%;border-collapse:collapse;margin:12px 0">
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
          `<div style="padding:8px;margin:8px 0;border:1px solid ${look.band};border-radius:8px"><div style="font-weight:600">${cell(columns[0] as string, row)}</div>${columns
            .slice(1)
            .map((c) => `<div style="display:flex;justify-content:space-between">${label(look, c)}<span style="${numberStyle}">${cell(c, row)}</span></div>`)
            .join('')}</div>`,
      )
      .join('');
  }
  notes.push(`layout ${layout}, ${lines.length} lines, ${look.money.code} ${JSON.stringify(look.money)}, ${look.datePattern}, ${look.family}/${look.headingFamily}/${look.numberFamily}`);

  const amountBox = `<div style="background:${look.band};padding:${r.pick([4, 12])}px;border-radius:${r.pick([0, 8])}px">${label(look, type === 'invoice' ? 'Amount due' : 'Amount paid', 'div')}<div style="font-size:${look.size + 8}px;font-weight:700;${numberStyle}">${m(type === 'invoice' ? total : paid)}</div></div>`;
  const nameSplit = issuer.includes(' ') && r.chance(0.3);
  const issuerHtml = nameSplit
    ? `<h1 style="font-family:'${look.headingFamily}';margin:0;font-size:22px">${esc(issuer.split(' ')[0] as string)}</h1><h2 style="font-family:'${look.headingFamily}';margin:0;font-size:16px">${esc(issuer.split(' ').slice(1).join(' '))}</h2>`
    : `<h1 style="font-family:'${look.headingFamily}';margin:0;font-size:${r.pick([18, 22, 28])}px;text-transform:${r.chance(0.15) ? 'uppercase' : 'none'}">${esc(issuer)}</h1>`;
  const sections = {
    header: `<header style="display:flex;gap:12px;align-items:${r.pick(['center', 'flex-start'])};justify-content:${r.pick(['flex-start', 'space-between'])}">${logoHtml(r)}<div>${issuerHtml}</div><div style="text-align:right">${label(look, type === 'invoice' ? (tax ? 'Tax invoice' : 'Invoice') : 'Receipt', 'div')}<div>${valueHtml(r, id, r.chance(0.5) ? 'No.' : undefined)}</div></div></header>`,
    details: `<div style="display:${r.pick(['flex', 'grid', 'block'])};gap:16px;margin:12px 0;grid-template-columns:1fr 1fr">
      <div>${label(look, 'Issued')} ${valueHtml(r, d(issuedAt))}</div>
      ${type === 'invoice' ? `<div>${label(look, 'Due')} ${valueHtml(r, d(dueAt))}</div>` : `<div>${label(look, 'Paid on')} ${valueHtml(r, d(paidAt))}</div>`}
      ${recipient ? `<div>${label(look, 'Bill to')} <b>${esc(recipient)}</b></div>` : ''}
    </div>`,
    lines: linesHtml,
    totals: `<div style="margin-left:auto;max-width:${r.pick(['260px', '50%', '100%'])}">
      ${tax !== 0 ? `<div style="display:flex;justify-content:space-between">${label(look, 'Subtotal')}<span style="${numberStyle}">${m(subtotal)}</span></div><div style="display:flex;justify-content:space-between">${label(look, 'Tax')}<span style="${numberStyle}">${m(tax)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;font-weight:700">${label(look, 'Total')}<span style="${numberStyle}">${m(total)}</span></div>
      ${amountBox}
    </div>`,
    notes: description
      ? `<div style="margin-top:12px">${label(look, 'Notes', 'div')}${isMarkdown(description) ? markdownHtml(description) : `<p style="white-space:pre-wrap;margin:4px 0">${esc(description)}</p>`}</div>`
      : '',
    footer: r.chance(0.4) ? `<footer style="margin-top:16px;color:${look.muted};font-size:11px">${esc(r.pick(['Kauri Studio', 'Thank you', 'Registered in Australia']))}</footer>` : '',
  };
  const order = r.chance(0.5)
    ? (['header', 'details', 'lines', 'totals', 'notes', 'footer'] as const)
    : (['header', 'totals', 'details', 'lines', 'notes', 'footer'] as const);
  const html = `<div id="preview" class="page">${order.map((key) => sections[key]).join('')}</div>`;
  const css = pageCss(look);
  return { seed, document, html, css, notes };
};

const letter = (r: Random, seed: number): Case => {
  const wide = r.chance(0.12);
  const look = lookFor(r, wide);
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
  const content = [`Dear ${recipient},`, ...body, `Kind regards,\n${issuer}`].join('\n\n');
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
  const html = `<div id="preview" class="page"><header style="display:flex;justify-content:space-between">${logoHtml(r)}<div style="text-align:right"><b style="font-family:'${look.headingFamily}'">${esc(issuer)}</b><div>${esc(writeDate(issuedAt, look.datePattern))}</div></div></header>
    <p><b>${esc(recipient)}</b></p>${bodyHtml}${'signatory' in document ? signatureHtml(document.signatory as never, look) : ''}</div>`;
  return { seed, document, html, css: pageCss(look), notes: [`letter, ${markdown ? 'markdown' : 'text'}, ${paragraphs} paragraphs, signature ${visual?.type ?? 'none'}, ${look.family}`] };
};

const pageCss = (look: Look) => `
  #preview { width:${look.width}px; box-sizing:border-box; padding:${look.padding + 8}px; background:${look.background}; font-family:'${look.family}'; font-size:${look.size}px; line-height:${look.lineHeight}; ${ink(look)}; }
  #preview h1, #preview h2, #preview h3 { line-height:1.2; }
  #preview a { color:${look.accent}; }
  #preview p { margin:6px 0; }
`;

/** The case a seed makes. */
export const generate = (seed: number): Case => {
  const r = random(seed);
  const type = r.pick(['invoice', 'invoice', 'invoice', 'receipt', 'receipt', 'letter'] as const);
  return type === 'letter' ? letter(r, seed) : bill(r, seed, type);
};

export { LATIN_ONLY };
