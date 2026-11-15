/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Binding by value: which text in a preview shows which signed field, and in
 * which format. The preview is the platform's own; nothing in it is marked.
 *
 * The page's text is read as one stream, in the order the page has it, with
 * each break between its lines and elements: a value may be split across
 * elements (<h1>300</h1><h2>Empire</h2>, <span>INV-</span><b>0042</b>) or
 * wrapped over lines, and is found whole all the same, then bound in the
 * pieces it is drawn in, each by its range of the value as written. A binding
 * is kept only when the receiver would write the field exactly as the preview
 * showed it (`writtenValue`), so a binding can never change a fact.
 */

import { boundValue, keyFacts, markdownHidden, writtenValue, type BoundValue } from '@btps/sdk/boundview';

/** A line of one text node as laid out: its text, and each character's box. */
export type Run = {
  text: string;
  /** One box a code point of `text`: left and right edges. */
  chars: { left: number; right: number }[];
  /** The line's baseline. */
  baseline: number;
  /** The line's top and bottom; a pixel either side of its baseline when not given. */
  top?: number;
  bottom?: number;
  /** Which text node it is a line of: the lines of one node are one text, wrapped. */
  node?: number;
  /** Which block it flows in: text in inline elements of one block wraps from one element into the next. */
  block?: number;
  /** Its font size in pixels. */
  size?: number;
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
/** Whether `field` is written in markdown (a letter's content, or a note), whose marks are not drawn. */
const markdownOf = (document: Doc, field: string) => {
  const value = field === 'body.content' ? document.body : field === 'description' ? document.description : undefined;
  return typeof value === 'object' && value !== null && (value as { format?: unknown }).format === 'markdown';
};
/** A match starts and ends a word: nothing but space or punctuation beside it. */
const isEdge = (char: string | undefined) => char === undefined || /[\s,.;:()[\]{}"'“”‘’!?/|–—·•-]/u.test(char);

/*
 * The stream: every run's characters in order, with a break between runs.
 * - `wrap`: the next line of the same text node;
 * - `flow`: the next line of the same block's inline text, in another element
 *   (a line breaks only where a word may end, so it ends one; a value may still
 *   run on across it, as "INV-" and "0042" do);
 * - `join`: another element touching it on the same line (its own span or bold);
 * - `space`: another element on the same line, a space or so apart;
 * - `break`: anything else (another block, far apart).
 * A space in a value matches any break or whitespace; a value runs on without
 * a space only across a `wrap`, a `flow` or a `join`.
 */
type Gap = 'wrap' | 'flow' | 'join' | 'space' | 'break';
type Item = { run: number; at: number; char: string } | { gap: Gap };

/** A value found in the stream: each of its characters' place, by run and code point, and its own index. */
type Placed = { run: number; at: number; of: number }[];

/**
 * Binds the preview's runs to `document`'s fields. Line items first, a row at
 * a time where its cells stand together, so a line's amount is never taken for
 * a total; then every other field, the longest writing first. Fields written
 * alike share their places. Whatever is left is the sender's own words.
 */
export const bindRuns = (document: Doc, runs: Run[]): Segment[] => {
  const characters = runs.map((run) => [...run.text]);
  const taken = characters.map((chars) => chars.map(() => false));
  const segments: Segment[] = [];
  const top = (run: number) => runs[run]?.top ?? (runs[run]?.baseline ?? 0) - 1;
  const bottom = (run: number) => runs[run]?.bottom ?? (runs[run]?.baseline ?? 0) + 1;

  // ---- The stream ----
  const stream: Item[] = [];
  const startOf: number[] = [];
  runs.forEach((run, index) => {
    if (index > 0) {
      const before = runs[index - 1] as Run;
      const sameLine = Math.abs(before.baseline - run.baseline) < 2;
      const gap = (run.chars[0]?.left ?? 0) - (before.chars.at(-1)?.right ?? 0);
      const size = run.size ?? before.size ?? 12;
      // The next line of the same text, or of the same block's inline text: a wrap. Beside it on one line: touching,
      // a join; a space or so apart, a space. Anything else (another block, far apart): a break.
      const wraps = run.node !== undefined && run.node === before.node;
      const flows = !sameLine && run.block !== undefined && run.block === before.block;
      stream.push({
        gap: wraps
          ? 'wrap'
          : flows
            ? 'flow'
            : sameLine && gap >= -1 && gap <= 0.15 * size
            ? 'join'
            : sameLine && gap > 0 && gap <= 1.2 * size
              ? 'space'
              : 'break',
      });
    }
    startOf.push(stream.length);
    (characters[index] as string[]).forEach((char, at) => stream.push({ run: index, at, char }));
  });
  /** Where each character first appears in the stream, so a search starts only where a value can. */
  const byChar = new Map<string, number[]>();
  stream.forEach((item, at) => {
    if ('char' in item) byChar.set(item.char, [...(byChar.get(item.char) ?? []), at]);
  });

  const isFree = (placed: Placed) => placed.every(({ run, at }) => !(taken[run] as boolean[])[at]);
  const charAt = (at: number) => {
    const item = stream[at];
    return item && 'char' in item ? item.char : undefined;
  };
  /**
   * Whether what stands beside a match ends a word: nothing, a break, or an edge character, looking through a `join`
   * or `wrap` to the character beyond it ("No. " and "A1" in touching elements); a `flow` ends a word.
   */
  const edgeAt = (at: number, step: -1 | 1): boolean => {
    for (let i = at; ; i += step) {
      const item = stream[i];
      if (item === undefined) return true;
      if ('char' in item) return isEdge(item.char);
      if (item.gap === 'space' || item.gap === 'break' || item.gap === 'flow') return true;
    }
  };
  const edgeBefore = (at: number) => edgeAt(at - 1, -1);
  const edgeAfter = (at: number) => edgeAt(at, 1);

  /**
   * `want` matched from stream position `start`: its characters' places, and where the stream goes on after it;
   * undefined where it does not stand there. A space in `want` matches any run of whitespace and breaks; a character
   * `hidden` says is not drawn (a markdown mark) may be missing.
   */
  const matchAt = (want: string[], hidden: (0 | 1 | 2)[], start: number): { placed: Placed; end: number } | undefined => {
    const placed: Placed = [];
    let w = 0;
    let s = start;
    while (w < want.length) {
      const char = want[w] as string;
      if (isSpace(char)) {
        const from = w;
        while (w < want.length && isSpace(want[w])) w++;
        const spaces: Placed = [];
        let broke = false;
        let crossed = 0;
        while (s < stream.length) {
          const item = stream[s] as Item;
          if ('gap' in item) broke = true;
          else if (isSpace(item.char)) spaces.push({ run: item.run, at: item.at, of: from + spaces.length });
          else break;
          s++;
          crossed++;
        }
        // Spaces drawn as the value has them, the same characters on one line, are part of the piece; anything else
        // (a line break in the value laid out as a space) divides it, so each piece writes exactly what it shows.
        const same = spaces.every((space) => (characters[space.run] as string[])[space.at] === want[space.of]);
        if (!broke && spaces.length === w - from && same) placed.push(...spaces);
        if (crossed === 0) {
          // A space the page does not draw: allowed only where a markdown mark beside it is not drawn either.
          if (!(hidden[from - 1] || hidden[w] || from === 0)) return undefined;
        }
        continue;
      }
      // What is never drawn (a link's destination) is never looked for on the page.
      if (hidden[w] === 2) {
        w++;
        continue;
      }
      const item = stream[s];
      if (item !== undefined && 'gap' in item && item.gap !== 'space' && item.gap !== 'break' && placed.length > 0) {
        s++;
        continue;
      }
      if (item !== undefined && 'char' in item && item.char === char) {
        placed.push({ run: item.run, at: item.at, of: w });
        w++;
        s++;
        continue;
      }
      if (hidden[w]) {
        w++;
        continue;
      }
      return undefined;
    }
    return placed.length > 0 ? { placed, end: s } : undefined;
  };

  /** Every place `text` is written in the stream, whole, as a word (`word`), each free of any fact already bound. */
  const findAll = (text: string, { word, markdown }: { word: boolean; markdown: boolean }): Placed[] => {
    const want = [...text];
    const hidden: (0 | 1 | 2)[] = markdown ? markdownHidden(text) : want.map(() => 0);
    let first = 0;
    while (first < want.length && (hidden[first] || isSpace(want[first]))) first++;
    if (first === want.length) return [];
    const found: Placed[] = [];
    let after = -1;
    for (const start of byChar.get(want[first] as string) ?? []) {
      if (start < after) continue;
      if (word && !edgeBefore(start)) continue;
      const match = matchAt(want.slice(first), hidden.slice(first), start);
      if (!match || !isFree(match.placed)) continue;
      if (word && !edgeAfter(match.end)) continue;
      found.push(match.placed.map((place) => ({ ...place, of: place.of + first })));
      after = match.end;
    }
    return found;
  };

  /** An amount found by its digits, with its sign, prefix and suffix from the runs it starts and ends in. */
  const moneyPlace = (placed: Placed, bind: Bind, value: BoundValue): { placed: Placed; bind: Bind; core: Placed } | undefined => {
    const firstPlace = placed[0] as Placed[number];
    const lastPlace = placed.at(-1) as Placed[number];
    const head = characters[firstPlace.run] as string[];
    const tail = characters[lastPlace.run] as string[];
    const at = firstPlace.at;
    let from = at;
    while (from > 0 && !isSpace(head[from - 1]) && at - from < 8 && !/\d/.test(head[from - 1] ?? '')) from--;
    // A code before the number with a space between: "AUD 1,452.00".
    if (from === at && head[at - 1] === ' ' && /^[A-Z]{3}$/.test(head.slice(at - 4, at - 1).join('')) && isSpace(head[at - 5])) {
      from = at - 4;
    }
    const end = lastPlace.at + 1;
    let to = end;
    while (to < tail.length && !isSpace(tail[to]) && to - end < 8 && !/\d/.test(tail[to] ?? '')) to++;
    if (to === end && tail[to] === ' ' && /^[A-Z]{3}$/.test(tail.slice(to + 1, to + 4).join('')) && isSpace(tail[to + 4])) to += 4;
    // A negative amount is written with '-' before its prefix.
    const sign = value.kind === 'money' && value.amount < 0 && head[from] === '-' ? 1 : 0;
    const prefix = head.slice(from + sign, at).join('');
    const suffix = tail.slice(end, to).join('');
    if (!isEdge(head[from - 1]) || !isEdge(tail[to])) return undefined;
    const format = (bind.format as { money: { group: string; decimal: string } }).money;
    const full: Bind = { field: bind.field, format: { money: { ...format, ...(prefix && { prefix }), ...(suffix && { suffix }) } } };
    const lead = at - from;
    const whole: Placed = [
      ...Array.from({ length: lead }, (_, i) => ({ run: firstPlace.run, at: from + i, of: i })),
      ...placed.map((place) => ({ ...place, of: place.of + lead })),
      ...Array.from({ length: to - end }, (_, i) => ({ run: lastPlace.run, at: end + i, of: lead + placed.length + i })),
    ];
    // Every character shown is the value's own, as written, and every one but a space (where it wraps) is shown.
    const written = [...writtenValue(value, full as never)];
    const shows = whole.every(({ run, at: index, of }) => (characters[run] as string[])[index] === written[of]);
    const covered = new Set(whole.map(({ of }) => of));
    const complete = written.every((char, index) => covered.has(index) || isSpace(char));
    return shows && complete && isFree(whole) ? { placed: whole, bind: full, core: placed } : undefined;
  };

  /** Every place a field is written, with the binding that writes it there: the longest writing first. */
  /** `core`: an amount's digits, without the sign, prefix or suffix found beside them. */
  const placesOf = (field: string, value: BoundValue, only?: (run: number) => boolean): { placed: Placed; bind: Bind; core?: Placed }[] => {
    const out: { placed: Placed; bind: Bind; core?: Placed }[] = [];
    const markdown = markdownOf(document, field);
    for (const { text, bind } of writings(field, value).sort((a, b) => [...b.text].length - [...a.text].length)) {
      const money = value.kind === 'money';
      // An amount is found by its digits: its sign and prefix come before them.
      const number = money && value.amount < 0 ? text.slice(1) : text;
      for (const placed of findAll(number, { word: !money, markdown })) {
        if (only && !placed.every(({ run }) => only(run))) continue;
        const full = money ? moneyPlace(placed, bind, value) : { placed, bind };
        if (full && !out.some((other) => other.placed.some((a) => full.placed.some((b) => a.run === b.run && a.at === b.at)))) out.push(full);
      }
      if (out.length > 0) break;
    }
    return out;
  };

  /** Binds a field where it was found: each piece it is drawn in, by its range of the value as written. */
  const take = ({ placed, bind }: { placed: Placed; bind: Bind }, value: BoundValue) => {
    const length = [...writtenValue(value, { ...bind, range: undefined } as never)].length;
    const pieces: { run: number; from: number; to: number; of: number; end: number }[] = [];
    for (const { run, at, of } of placed) {
      (taken[run] as boolean[])[at] = true;
      const last = pieces.at(-1);
      if (last && last.run === run && last.to === at && last.end === of) {
        last.to++;
        last.end++;
      } else pieces.push({ run, from: at, to: at + 1, of, end: of + 1 });
    }
    for (const { run, from, to, of, end } of pieces) {
      const whole = pieces.length === 1 && of === 0 && end === length;
      segments.push({ run, from, to, bind: { ...bind, ...(!whole && { range: [of, end] as [number, number] }) } });
    }
  };

  /** Text shown in groups: "51 824 753 556" for "51824753556". */
  const bindGroups = (field: string, value: BoundValue & { kind: 'text' }) => {
    const want = [...value.text.replace(/ /g, '')];
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
        const placed = Array.from({ length: i - at }, (_, n) => ({ run, at: at + n, of: n }));
        if (matched === want.length && separator !== undefined && isEdge(chars[i]) && isFree(placed)) {
          take({ placed, bind: { field, format: { groups: { sizes: [...sizes, size], separator } } } }, value);
          return true;
        }
      }
    }
    return false;
  };

  const fields = bindableFields(document);

  // ---- Line items: a row at a time, where its cells stand together ----
  const lines = fields.filter(({ field }) => field.startsWith('lineItems.rows.'));
  const rows = new Map<string, typeof lines>();
  for (const line of lines) {
    const row = line.field.split('.').slice(0, 3).join('.');
    rows.set(row, [...(rows.get(row) ?? []), line]);
  }
  const roles = ((document.lineItems as { roles?: Record<string, string> } | undefined)?.roles ?? {}) as Record<string, string>;
  type Span = { top: number; bottom: number };
  const spanOf = (placed: Placed): Span => ({
    top: Math.min(...placed.map(({ run }) => top(run))),
    bottom: Math.max(...placed.map(({ run }) => bottom(run))),
  });
  const within = (span: Span) => (run: number) => top(run) < span.bottom && bottom(run) > span.top;

  // A place inside a longer match of another field is that field's (a description "Studio" in the name "Ζήτα Studio").
  const longer = fields
    .filter(({ field }) => !field.startsWith('lineItems.rows.'))
    .flatMap(({ field, value }) => placesOf(field, value).map(({ placed }) => ({ kind: value.kind, at: new Set(placed.map(({ run, at }) => `${run}:${at}`)) })));
  /** `whole`: the match `placed` is part of; another field's match of exactly that text, and of its kind, is the same value, not longer. */
  const insideLonger = (placed: Placed, whole: Placed = placed, kind?: BoundValue['kind']) =>
    longer.some(
      (other) =>
        other.at.size > placed.length &&
        placed.every(({ run, at }) => other.at.has(`${run}:${at}`)) &&
        !(other.kind === kind && other.at.size === whole.length && whole.every(({ run, at }) => other.at.has(`${run}:${at}`))),
    );
  const lineHeight = (span: Span) => Math.max(1, span.bottom - span.top);

  // First where each row is: its text cell (the description) where most of its other cells stand beside it, on its
  // lines or (a row laid out as a card) just below them.
  const chosen: { cells: typeof lines; anchor?: { placed: Placed; bind: Bind; value: BoundValue }; span?: Span }[] = [];
  const used = new Set<string>();
  for (const cells of rows.values()) {
    const ordered = [...cells].sort((a, b) => Number(a.value.kind === 'money') - Number(b.value.kind === 'money'));
    const anchorCell =
      ordered.find(({ field, value }) => value.kind === 'text' && roles[field.split('.').slice(3).join('.')] === 'description') ??
      ordered.find(({ value }) => value.kind === 'text');
    if (!anchorCell) {
      chosen.push({ cells: ordered });
      continue;
    }
    const others = ordered.filter((cell) => cell !== anchorCell);
    const previous = [...chosen].reverse().find((row) => row.span)?.span;
    const candidates = placesOf(anchorCell.field, anchorCell.value)
      .filter(({ placed }) => !placed.some(({ run, at }) => used.has(`${run}:${at}`)) && !insideLonger(placed))
      .map((place) => {
        const span = spanOf(place.placed);
        // Above it too: a cell of several lines aligned to the middle of its row starts above its description.
        const reach = 1.5 * (cells.length + 1) * lineHeight(span);
        const near = { top: span.top - reach, bottom: span.bottom + reach };
        // Which of its other cells stand near it, and how near: a description is where its own cells are.
        // In whole lines: a cell aligned to the middle of its row is no further than one on its first line.
        const distances = others.flatMap(({ field, value }) => {
          const tops = placesOf(field, value, within(near))
            .filter(({ placed }) => !insideLonger(placed))
            .map(({ placed }) => Math.floor(Math.abs(top((placed[0] as Placed[number]).run) - span.top) / lineHeight(span)));
          return tops.length > 0 ? [Math.min(...tops)] : [];
        });
        const distance = distances.reduce((sum, d) => sum + d, 0);
        return { place, span, close: distances.length, distance, below: previous === undefined || span.top >= previous.top - 1 };
      })
      // Most of its cells near it; then after the row before it; then nearest them; then first on the page.
      .sort((a, b) => b.close - a.close || Number(b.below) - Number(a.below) || a.distance - b.distance || a.span.top - b.span.top);
    // Rows written alike are in their order: of places as good but for a line a cell, the first on the page.
    const first = candidates[0];
    const best = first && candidates
      .filter((c) => c.close === first.close && c.below === first.below && c.distance <= first.distance + others.length)
      .reduce((a, b) => (b.span.top < a.span.top ? b : a));
    if (best) for (const { run, at } of best.place.placed) used.add(`${run}:${at}`);
    chosen.push({ cells: ordered, ...(best && { anchor: { ...best.place, value: anchorCell.value }, span: best.span }) });
  }
  // Then each row's cells, once each, in the order the document lists its columns: on the row's lines, or below them
  // before the next row (a row laid out as a card). A unit price and an amount that are the same stand side by side.
  chosen.forEach(({ cells, anchor, span }, index) => {
    if (!anchor || !span) return;
    take(anchor, anchor.value);
    // The row's own stretch of the page: from just after the row before it to just before the row after it, so a cell
    // set above its description (a table's cells aligned to the middle) or below it (a card, a line a cell) is found.
    // The first and last rows have no neighbour that side: as far as a line a cell, and some, would reach.
    const previous = [...chosen.slice(0, index)].reverse().find((row) => row.span)?.span;
    const next = chosen.slice(index + 1).find((row) => row.span)?.span;
    const reach = 1.5 * (cells.length + 1) * lineHeight(span);
    const from = previous?.bottom ?? span.top - reach;
    const to = next?.top ?? span.bottom + reach;
    const stretch = (run: number) => bottom(run) > from && top(run) < to;
    // The longest written first, so an amount "CHF 3 150,00" is its own before a tax "CHF 150,00" looks inside it.
    const written = (cell: (typeof cells)[number]) => Math.max(0, ...writings(cell.field, cell.value).map(({ text }) => [...text].length));
    for (const { field, value } of [...cells].sort((a, b) => written(b) - written(a))) {
      if (field === anchor.bind.field) continue;
      // Never a place inside a longer match of another field: a quantity "10" in a date "10/02/2026".
      // An amount by its digits: "A1" is an invoice number, not the amount 1 with a prefix "A".
      const own = (only: (run: number) => boolean) => placesOf(field, value, only).find(({ placed, core }) => !insideLonger(core ?? placed, placed, value.kind));
      const place = own(within(span)) ?? own(stretch);
      if (place) take(place, value);
    }
  });

  // ---- Everything else: every place each field is written, the longest match first ----
  // A match inside a longer one is the longer one's: "2026-12-17" in "INV-2026-12-17" is the invoice number's, and
  // "1,452" in "A$1,452.00" is the amount's. Fields written alike (a receipt's total and the amount paid) share their
  // places, each taking the first free, so every one of them is bound where it can be.
  const rest = fields.filter(({ field }) => !field.startsWith('lineItems.rows.'));
  const candidates = rest.flatMap(({ field, value }, order) =>
    placesOf(field, value).map((place, nth) => ({ ...place, value, order, nth })),
  );
  candidates.sort((a, b) => b.placed.length - a.placed.length || a.nth - b.nth || a.order - b.order);
  const takes = new Map<string, number>();
  const where = (placed: Placed) => placed.map(({ run, at }) => `${run}:${at}`).join(',');
  const key = new Set(keyFacts(document));
  for (const candidate of candidates) {
    if (!isFree(candidate.placed)) continue;
    // Of the fields that could be bound here, the one bound the fewest times yet; where text could be either of two
    // (02/01/2026: one date day first, another month first), a fact the document must show before one it need not.
    const here = where(candidate.placed);
    const chosen = candidates
      .filter((other) => where(other.placed) === here)
      .sort(
        (a, b) =>
          (takes.get(a.bind.field) ?? 0) - (takes.get(b.bind.field) ?? 0) ||
          Number(key.has(b.bind.field)) - Number(key.has(a.bind.field)) ||
          a.order - b.order,
      )[0] as typeof candidate;
    take(chosen, chosen.value);
    takes.set(chosen.bind.field, (takes.get(chosen.bind.field) ?? 0) + 1);
  }
  for (const { field, value } of rest) {
    if (!takes.has(field) && value.kind === 'text') bindGroups(field, value);
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
