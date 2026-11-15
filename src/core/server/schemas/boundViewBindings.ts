/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: the fields a BoundView may bind, by document type, and the value
 * each one names in a document. A binding to anything else, or to a field the
 * document does not carry, is refused with the document.
 */

import { CURRENCY_DECIMALS } from '../constants/currency.js';
import type { BTPBoundViewElement } from './boundViewSchema.js';

export type BoundKind = 'text' | 'money' | 'date' | 'percent';

/** A bound field's value: text, a date, whole basis points, or an amount in minor units of its currency. */
export type BoundValue =
  | { kind: 'text'; text: string }
  | { kind: 'date'; date: string }
  | { kind: 'percent'; basisPoints: number }
  | { kind: 'money'; amount: number; currency: string };

type Doc = Record<string, unknown>;

/*
 * A pattern's segments: a key, `#` for a list's index, or `*` for the rest of
 * the path as one key (a line item's column, an identifier's or yearToDate's key).
 */
type Pattern = [path: string, kind: BoundKind | 'cell'];

const ISSUER: Pattern[] = [
  ['id', 'text'],
  ['title', 'text'],
  ['issuedAt', 'date'],
  ['issuer.name', 'text'],
  ['issuer.email', 'text'],
  ['issuer.phone', 'text'],
  ['issuer.address', 'text'],
  ['issuer.identifiers.*', 'text'],
];

const BILL: Pattern[] = [
  ...ISSUER,
  ['totalAmount', 'money'],
  ['subtotalAmount', 'money'],
  ['taxAmount', 'money'],
  ['discount.amount', 'money'],
  ['discount.percent', 'percent'],
  ['recipient.name', 'text'],
  ['description', 'text'],
  ['lineItems.rows.#.*', 'cell'],
];

const LETTER: Pattern[] = [
  ...ISSUER,
  ['body.content', 'text'],
  ['recipient.name', 'text'],
  ['signatory.name', 'text'],
  ['signatory.title', 'text'],
];

const PATTERNS: Record<string, Pattern[]> = {
  invoice: [...BILL, ['dueAt', 'date']],
  receipt: [
    ...BILL,
    ['payment.amount', 'money'],
    ['payment.paidAt', 'date'],
    ['payment.method', 'text'],
    ['payment.reference', 'text'],
  ],
  payslip: [
    ...ISSUER,
    ['payDate', 'date'],
    ['payPeriod.start', 'date'],
    ['payPeriod.end', 'date'],
    ['payRate.asAt', 'date'],
    ['employee.name', 'text'],
    ['employee.employeeId', 'text'],
    ['payRate.amount', 'money'],
    ['gross', 'money'],
    ['net', 'money'],
    ['taxWithheld', 'money'],
    ['yearToDate.*', 'money'],
    ...['description', 'category', 'rate', 'rateUnit', 'quantity'].map(
      (key): Pattern => [`earnings.#.${key}`, 'text'],
    ),
    ['earnings.#.amount', 'money'],
    ['deductions.#.description', 'text'],
    ['deductions.#.category', 'text'],
    ['deductions.#.payee.name', 'text'],
    ['deductions.#.amount', 'money'],
    ['contributions.#.category', 'text'],
    ['contributions.#.fund.name', 'text'],
    ['contributions.#.amount', 'money'],
    ...['description', 'category', 'unit', 'balance', 'accrued', 'taken'].map(
      (key): Pattern => [`leave.#.${key}`, 'text'],
    ),
  ],
  letter: LETTER,
  agreement: [...LETTER, ['acceptance.by', 'date']],
};

const isRecord = (value: unknown): value is Doc =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at `field` by `pattern`, or undefined when the pattern does not name it or the document lacks it. */
const walk = (document: Doc, pattern: string, field: string): unknown => {
  const want = pattern.split('.');
  const have = field.split('.');
  let at: unknown = document;
  for (let i = 0; i < want.length; i++) {
    const segment = want[i];
    if (segment === '*') {
      const key = have.slice(i).join('.');
      return isRecord(at) && key !== '' && Object.hasOwn(at, key) ? at[key] : undefined;
    }
    const part = have[i];
    if (part === undefined) return undefined;
    if (segment === '#') {
      if (!Array.isArray(at) || !/^(0|[1-9]\d*)$/.test(part)) return undefined;
      at = at[Number(part)];
    } else {
      if (segment !== part || !isRecord(at) || !Object.hasOwn(at, part)) return undefined;
      at = at[part];
    }
  }
  return have.length === want.length ? at : undefined;
};

const currencyOf = (document: Doc): string | undefined => {
  const total = document.totalAmount;
  return isRecord(total) && typeof total.currency === 'string' ? total.currency : undefined;
};

/** What `field` names in `document`, or undefined when a BoundView may not bind it or the document lacks it. */
export const boundValue = (document: Doc, field: string): BoundValue | undefined => {
  const type = typeof document.type === 'string' ? document.type : '';
  for (const [pattern, kind] of PATTERNS[type] ?? []) {
    const value = walk(document, pattern, field);
    if (value === undefined) continue;
    if (kind === 'cell' || (kind === 'money' && typeof value === 'number')) {
      const currency = currencyOf(document);
      if (typeof value === 'number' && currency !== undefined) {
        return { kind: 'money', amount: value, currency };
      }
      return typeof value === 'string' ? { kind: 'text', text: value } : undefined;
    }
    if (kind === 'money') {
      return isRecord(value) && typeof value.amount === 'number' && typeof value.currency === 'string'
        ? { kind: 'money', amount: value.amount, currency: value.currency }
        : undefined;
    }
    if (kind === 'percent') {
      return typeof value === 'number' ? { kind: 'percent', basisPoints: value } : undefined;
    }
    if (kind === 'date') return typeof value === 'string' ? { kind: 'date', date: value } : undefined;
    // A note's or a body's text is its content.
    if (isRecord(value) && typeof value.content === 'string') return { kind: 'text', text: value.content };
    return typeof value === 'string' ? { kind: 'text', text: value } : undefined;
  }
  return undefined;
};

type Bind = {
  field: string;
  format?: { money?: unknown; date?: unknown; percent?: unknown; groups?: { sizes: number[] } };
  range?: [number, number];
};

/** Why a binding's format cannot write `document`'s value, or undefined when it can. */
const formatProblem = (document: Doc, bind: Bind): string | undefined => {
  const value = boundValue(document, bind.field);
  if (value === undefined) return `binds ${bind.field}, which a BoundView may not bind or the document does not carry`;
  const format = bind.format ?? {};
  if (value.kind === 'money' && format.money === undefined) return 'a money field is written with a money format';
  if (value.kind === 'date' && format.date === undefined) return 'a date field is written with a date format';
  if (value.kind === 'percent' && format.percent === undefined) return 'a percent is written with a percent format';
  if (value.kind !== 'text') return undefined;
  if (format.money !== undefined || format.date !== undefined || format.percent !== undefined) {
    return 'text is written as it is, or in groups';
  }
  if (format.groups !== undefined) {
    const length = [...value.text.replace(/ /g, '')].length;
    const sum = format.groups.sizes.reduce((total, part) => total + part, 0);
    if (sum !== length) return "a groups format's sizes add up to the value's length";
  }
  return undefined;
};

/** Why a binding's range cannot be drawn, or undefined when it can: it lies inside the value as written. */
const rangeProblem = (document: Doc, bind: Bind): string | undefined => {
  if (bind.range === undefined) return undefined;
  const value = boundValue(document, bind.field);
  if (value === undefined) return undefined;
  const written = [...writtenValue(value, { ...bind, range: undefined } as WrittenBind)];
  return bind.range[1] > written.length ? "a range lies inside the value's characters as written" : undefined;
};

/** Why a binding cannot be drawn from `document`, or undefined when it can. */
export const bindingProblem = (document: Doc, bind: Bind): string | undefined =>
  formatProblem(document, bind) ?? rangeProblem(document, bind);

// ---- Writing a bound value ----

type WrittenBind = Extract<BTPBoundViewElement, { type: 'text' }>['bind'];

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

/** A bound value written whole, by its binding's format. */
const writtenWhole = (value: BoundValue, format: WrittenBind['format']): string => {
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
  return value.text;
};

/**
 * A bound value as the receiver draws it, by its binding's format and range (Bindings and formats): the value written
 * by its format, and of that, the code points its range names, when it has one.
 */
export const writtenValue = (value: BoundValue, bind: WrittenBind): string => {
  const whole = writtenWhole(value, bind.format);
  return bind.range ? [...whole].slice(bind.range[0], bind.range[1]).join('') : whole;
};

/**
 * Which characters of markdown text a renderer does not draw as themselves (Checks: Key facts): its marks
 * (`# * _ \` > - +`), a backslash that escapes the next character, a link's brackets and destination, and an ordered
 * list's number, which is drawn as the list's marker rather than as text.
 */
export const markdownHidden = (text: string): boolean[] => {
  const characters = [...text];
  const hidden = characters.map((char) => /[#*_`>+-]/.test(char));
  const mark = (from: number, to: number) => {
    for (let at = from; at < to; at++) hidden[at] = true;
  };
  characters.forEach((char, at) => {
    if (char === '\\' && /[\p{P}\p{S}]/u.test(characters[at + 1] ?? '')) hidden[at] = true;
  });
  const joined = characters.join('');
  // Offsets below are in UTF-16 units; map them to code points.
  const index: number[] = [];
  characters.forEach((char, at) => {
    for (let unit = 0; unit < char.length; unit++) index.push(at);
  });
  index.push(characters.length);
  const cp = (unit: number) => index[unit] ?? characters.length;
  for (const match of joined.matchAll(/\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    const start = match.index ?? 0;
    const labelEnd = start + 1 + (match[1] ?? '').length;
    mark(cp(start), cp(start + 1));
    mark(cp(labelEnd), cp(start + match[0].length));
  }
  for (const match of joined.matchAll(/<(https?:\/\/[^>\s]+)>/g)) {
    const start = match.index ?? 0;
    mark(cp(start), cp(start + 1));
    mark(cp(start + match[0].length - 1), cp(start + match[0].length));
  }
  for (const match of joined.matchAll(/^([ \t]*)(\d{1,9}[.)])(?=[ \t])/gm)) {
    const start = (match.index ?? 0) + (match[1] ?? '').length;
    mark(cp(start), cp(start + (match[2] ?? '').length));
  }
  return hidden;
};
