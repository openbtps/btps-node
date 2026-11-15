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

/** Why a binding cannot be drawn from `document`, or undefined when it can. */
export const bindingProblem = (document: Doc, bind: Bind): string | undefined => {
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
  if (bind.range !== undefined && bind.range[1] > [...value.text].length) {
    return "a range lies inside the value's characters";
  }
  return undefined;
};
