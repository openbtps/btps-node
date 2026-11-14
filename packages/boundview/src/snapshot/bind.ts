/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Binding by value: which text in a preview shows which signed field, and in
 * which format. The preview is the platform's own; nothing in it is marked.
 * A run's text is matched against every way each field may be written, and a
 * binding is kept only when the receiver would write the field exactly as the
 * preview showed it (`writtenValue`), so a binding can never change a fact.
 */

import { boundValue, writtenValue, type BoundValue } from '@btps/sdk/client';

/** A line of one text node as laid out: its text, and each character's box. */
export type Run = {
  text: string;
  /** One box a code point of `text`: left and right edges. */
  chars: { left: number; right: number }[];
  /** The line's baseline, used to tell rows of a table apart. */
  baseline: number;
};

type Bind = {
  field: string;
  format?:
    | { money: { group: string; decimal: string; prefix?: string; suffix?: string } }
    | { date: string }
    | { percent: { decimals: 0 | 1 | 2; decimal: string } }
    | { groups: { sizes: number[]; separator: string } };
  range?: [number, number];
};

/** Part of a run, by code point: shown as a fact (`bind`) or as the sender's own words. */
export type Segment = { run: number; from: number; to: number; bind?: Bind };

type Doc = Record<string, unknown>;

const DATE_PATTERNS = [
  'd MMMM yyyy',
  'MMMM d, yyyy',
  'd MMM yyyy',
  'MMM d, yyyy',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'dd.MM.yyyy',
  'dd-MM-yyyy',
  'yyyy-MM-dd',
];

const GROUPS = [',', '.', ' ', "'", ''];

/** Every field a BoundView may bind in `document`, with its value. */
export const bindableFields = (document: Doc): { field: string; value: BoundValue }[] => {
  const found: { field: string; value: BoundValue }[] = [];
  const walk = (value: unknown, path: string[]) => {
    if (path.length > 0) {
      const field = path.join('.');
      const bound = boundValue(document, field);
      if (bound !== undefined) {
        found.push({ field, value: bound });
        return;
      }
    }
    if (Array.isArray(value)) value.forEach((item, index) => walk(item, [...path, String(index)]));
    else if (typeof value === 'object' && value !== null) {
      for (const [key, inner] of Object.entries(value)) {
        if (path.length === 0 && (key === 'boundView' || key === 'metadata')) continue;
        walk(inner, [...path, key]);
      }
    }
  };
  walk(document, []);
  return found;
};

/** Each way a value may be written without a range: the text, and the binding that writes it. */
const writings = (field: string, value: BoundValue): { text: string; bind: Bind }[] => {
  const out: { text: string; bind: Bind }[] = [];
  const add = (bind: Bind) => out.push({ text: writtenValue(value, bind as never), bind });
  if (value.kind === 'money') {
    for (const group of GROUPS) {
      for (const decimal of ['.', ',']) {
        if (group !== decimal) add({ field, format: { money: { group, decimal } } });
      }
    }
  } else if (value.kind === 'date') {
    for (const date of DATE_PATTERNS) add({ field, format: { date } });
  } else if (value.kind === 'percent') {
    for (const decimals of [0, 1, 2] as const) {
      for (const decimal of ['.', ',']) add({ field, format: { percent: { decimals, decimal } } });
    }
  } else if (value.text.trim() !== '') {
    add({ field });
  }
  return out;
};

const isSpace = (char: string | undefined) => char === undefined || /\s/u.test(char);
/** A match starts and ends a word: nothing but space or punctuation beside it. */
const isEdge = (char: string | undefined) => char === undefined || /[\s,.;:()[\]{}"'“”‘’!?/|–—-]/u.test(char);

/**
 * Binds the preview's runs to `document`'s fields. Line items first, a row at
 * a time on its own band, so a line's amount is never taken for a total;
 * then every other field, the longest writing first, every place it appears.
 * Whatever is left is the sender's own words.
 */
export const bindRuns = (document: Doc, runs: Run[]): Segment[] => {
  const characters = runs.map((run) => [...run.text]);
  const taken = characters.map((chars) => chars.map(() => false));
  const segments: Segment[] = [];
  const free = (run: number, from: number, to: number) =>
    taken[run]?.slice(from, to).every((used) => !used) ?? false;
  const take = (run: number, from: number, to: number, bind: Bind) => {
    for (let at = from; at < to; at++) (taken[run] as boolean[])[at] = true;
    segments.push({ run, from, to, bind });
  };

  /**
   * Where `text` stands in a run, from `after` on: as a whole word, or for an
   * amount anywhere, its prefix and suffix being checked by `moneyAt`.
   */
  const find = (run: number, text: string, after = 0, whole = true): number => {
    const chars = characters[run] as string[];
    const want = [...text];
    for (let at = after; at + want.length <= chars.length; at++) {
      if (want.every((char, i) => chars[at + i] === char) && free(run, at, at + want.length)) {
        if (!whole || (isEdge(chars[at - 1]) && isEdge(chars[at + want.length]))) return at;
      }
    }
    return -1;
  };

  /** A money writing with its prefix and suffix: a currency sign or code beside the number. */
  const moneyAt = (run: number, at: number, length: number, bind: Bind, value: BoundValue) => {
    const chars = characters[run] as string[];
    let from = at;
    while (from > 0 && !isSpace(chars[from - 1]) && at - from < 8 && !/\d/.test(chars[from - 1] ?? '')) from--;
    // A code before the number with a space between: "AUD 1,452.00".
    if (from === at && chars[at - 1] === ' ' && /^[A-Z]{3}$/.test(chars.slice(at - 4, at - 1).join('')) && isSpace(chars[at - 5])) {
      from = at - 4;
    }
    let to = at + length;
    while (to < chars.length && !isSpace(chars[to]) && to - (at + length) < 8 && !/\d/.test(chars[to] ?? '')) to++;
    if (to === at + length && chars[to] === ' ' && /^[A-Z]{3}$/.test(chars.slice(to + 1, to + 4).join('')) && isSpace(chars[to + 4])) {
      to += 4;
    }
    // A negative amount is written with '-' before its prefix.
    const sign = value.kind === 'money' && value.amount < 0 && chars[from] === '-' ? 1 : 0;
    const prefix = chars.slice(from + sign, at).join('');
    const suffix = chars.slice(at + length, to).join('');
    if (!isEdge(chars[from - 1]) || !isEdge(chars[to])) return undefined;
    const format = (bind.format as { money: { group: string; decimal: string } }).money;
    const full: Bind = {
      field: bind.field,
      format: { money: { ...format, ...(prefix && { prefix }), ...(suffix && { suffix }) } },
    };
    const shown = chars.slice(from, to).join('');
    return writtenValue(value, full as never) === shown && free(run, from, to) ? { from, to, bind: full } : undefined;
  };

  /** Binds every place a writing of `field` appears, in `only` runs if given. */
  const bindEverywhere = (field: string, value: BoundValue, only?: (run: number) => boolean) => {
    let found = false;
    for (const { text, bind } of writings(field, value).sort((a, b) => b.text.length - a.text.length)) {
      const money = value.kind === 'money';
      // An amount is found by its digits: its sign and prefix come before them.
      const number = money && value.amount < 0 ? text.slice(1) : text;
      for (let run = 0; run < runs.length; run++) {
        if (only && !only(run)) continue;
        for (let at = find(run, number, 0, !money); at !== -1; at = find(run, number, at + 1, !money)) {
          if (money) {
            const placed = moneyAt(run, at, [...number].length, bind, value);
            if (placed) {
              take(run, placed.from, placed.to, placed.bind);
              found = true;
            }
          } else {
            take(run, at, at + [...number].length, bind);
            found = true;
          }
        }
      }
      if (found) return true;
    }
    return found;
  };

  /** Text shown in groups: "51 824 753 556" for "51824753556". */
  const bindGroups = (field: string, text: string) => {
    const want = [...text.replace(/ /g, '')];
    if (want.length < 4) return false;
    for (let run = 0; run < runs.length; run++) {
      const chars = characters[run] as string[];
      for (let at = 0; at < chars.length; at++) {
        if (chars[at] !== want[0] || !isEdge(chars[at - 1])) continue;
        let i = at;
        let separator: string | undefined;
        const sizes: number[] = [];
        let size = 0;
        let matched = 0;
        while (i < chars.length && matched < want.length) {
          if (chars[i] === want[matched]) {
            size++;
            matched++;
            i++;
          } else if (size > 0 && (separator === undefined || chars[i] === separator) && /[ .\-/]/.test(chars[i] ?? '')) {
            separator = chars[i];
            sizes.push(size);
            size = 0;
            i++;
          } else break;
        }
        if (matched === want.length && separator !== undefined && isEdge(chars[i]) && free(run, at, i)) {
          take(run, at, i, { field, format: { groups: { sizes: [...sizes, size], separator } } });
          return true;
        }
      }
    }
    return false;
  };

  /** A long text over several runs: each run that is part of it, bound by its range, in order. */
  const bindRanges = (field: string, text: string) => {
    const value = [...text];
    let cursor = 0;
    let found = false;
    for (let run = 0; run < runs.length; run++) {
      const trimmed = (characters[run] as string[]).join('').trim();
      if (trimmed.length < 2 || !free(run, 0, (characters[run] as string[]).length)) continue;
      const lead = (characters[run] as string[]).findIndex((char) => !isSpace(char));
      const want = [...trimmed];
      for (let at = cursor; at + want.length <= value.length; at++) {
        if (want.every((char, i) => value[at + i] === char)) {
          take(run, lead, lead + want.length, { field, range: [at, at + want.length] });
          cursor = at + want.length;
          found = true;
          break;
        }
      }
    }
    return found;
  };

  const fields = bindableFields(document);

  // Line items, a row at a time: each cell only on its description's band.
  const lines = fields.filter(({ field }) => field.startsWith('lineItems.rows.'));
  const rows = new Map<string, typeof lines>();
  for (const line of lines) {
    const row = line.field.split('.').slice(0, 3).join('.');
    rows.set(row, [...(rows.get(row) ?? []), line]);
  }
  for (const cells of rows.values()) {
    const ordered = [...cells].sort((a, b) => Number(a.value.kind === 'money') - Number(b.value.kind === 'money'));
    let band: number | undefined;
    for (const { field, value } of ordered) {
      // A row's amounts are only taken on the band its text anchors: never loose, where a total could be.
      if (band === undefined && value.kind !== 'text') break;
      const before = segments.length;
      bindEverywhere(field, value, (run) => band === undefined || Math.abs((runs[run] as Run).baseline - band) < 2);
      const placed = segments[before];
      if (band === undefined && placed !== undefined) band = (runs[placed.run] as Run).baseline;
    }
  }

  // Everything else, longest writing first so "A$1,452.00" is not taken as "1,452".
  const rest = fields
    .filter(({ field }) => !field.startsWith('lineItems.rows.'))
    .sort((a, b) => {
      const length = (entry: (typeof fields)[number]) => Math.max(0, ...writings(entry.field, entry.value).map(({ text }) => text.length));
      return length(b) - length(a);
    });
  for (const { field, value } of rest) {
    if (bindEverywhere(field, value)) continue;
    if (value.kind === 'text' && !bindGroups(field, value.text)) bindRanges(field, value.text);
  }

  // The sender's own words: every stretch of a run no field took.
  characters.forEach((chars, run) => {
    let from = -1;
    for (let at = 0; at <= chars.length; at++) {
      const open = at < chars.length && !(taken[run] as boolean[])[at];
      if (open && from === -1) from = at;
      if (!open && from !== -1) {
        const words = chars.slice(from, at).join('');
        if (words.trim() !== '') {
          const lead = chars.slice(from, at).findIndex((char) => !isSpace(char));
          const trail = chars.slice(from, at).length - [...chars.slice(from, at)].reverse().findIndex((char) => !isSpace(char));
          segments.push({ run, from: from + lead, to: from + trail });
        }
        from = -1;
      }
    }
  });
  return segments.sort((a, b) => a.run - b.run || a.from - b.from);
};
