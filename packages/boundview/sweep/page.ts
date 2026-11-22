/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * The sweep, in the browser: each seed's case laid out on this page, captured
 * by snapshotBoundView as a platform captures its preview, then opened as a
 * receiver opens it (the schema, every check) and drawn by the engine. A case
 * that any of these refuses is a fault, kept with its seed and why.
 */

import { BtpBoundViewSchema, checkBoundView } from '@btps/sdk/boundview';
import { initBoundViewEngine, renderBoundView, snapshotBoundView } from '../src/index.js';
import { generate } from './generate.js';

export type Result = { seed: number; stage: 'snapshot' | 'schema' | 'check' | 'render' | 'looks'; error: string; notes: string[] };

const host = document.getElementById('host') as HTMLElement;
const style = document.getElementById('case') as HTMLStyleElement;

const settle = async (root: HTMLElement) => {
  await document.fonts.ready;
  await Promise.all(Array.from(root.querySelectorAll('img'), (image) => image.decode().catch(() => undefined)));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await document.fonts.ready;
};

/** The case's drawing, kept for the looks check, which compares it with the browser's own picture of the page. */
let drawn: Uint8Array | null = null;
let lastView: { elements: Record<string, unknown>[] } | undefined;

const run = async (seed: number): Promise<Result | undefined> => {
  drawn = null;
  const made = generate(seed);
  style.textContent = made.css;
  host.innerHTML = made.html;
  const preview = document.getElementById('preview') as HTMLElement;
  await settle(preview);
  let view;
  try {
    view = await snapshotBoundView(preview, made.document, { engine: '/resvg.wasm', onWarning: () => undefined });
  } catch (error) {
    const notes = [...made.notes];
    // What covers what: the element said to be covered, and every later element over it.
    const refused = (error as { view?: { elements: Record<string, unknown>[] } }).view;
    for (const [, index] of (error instanceof Error ? error.message : '').matchAll(/element (\d+): an element drawn after it covers it/g)) {
      const at = Number(index);
      const covered = refused?.elements[at];
      notes.push(`covered ${JSON.stringify(covered)}`);
      const box = (e: Record<string, unknown>) => ({ l: Number(e.x ?? 0), r: Number(e.x ?? 0) + Number(e.width ?? 0), y: Number(e.y ?? 0) });
      const mine = covered ? box(covered) : undefined;
      refused?.elements.slice(at + 1).forEach((later, n) => {
        const theirs = box(later);
        if (mine && Math.abs(theirs.y - mine.y) < 30 && theirs.l < mine.r && theirs.r > mine.l) notes.push(`  by ${at + 1 + n} ${JSON.stringify(later).slice(0, 200)}`);
      });
    }
    // Over the path budget: where its characters go, the biggest first.
    if (/characters of paths/.test(error instanceof Error ? error.message : '')) {
      const kinds = new Map<string, number>();
      for (const e of refused?.elements ?? []) {
        if (e.type !== 'path') continue;
        const d = String(e.d);
        const kind = `${e.fillRule ?? ''} ${typeof e.fill === 'object' ? Object.keys(e.fill as object)[0] : e.fill ? 'fill' : 'stroke'} ${(d.match(/M/g) ?? []).length > 3 ? 'many' : 'one'}${e.opacity !== undefined ? ' faint' : ''}`;
        kinds.set(kind, (kinds.get(kind) ?? 0) + d.length);
      }
      notes.push(`paths ${[...kinds].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}: ${n}`).join(', ')}`);
      const biggest = (refused?.elements ?? []).filter((e) => e.type === 'path').sort((a, b) => String(b.d).length - String(a.d).length).slice(0, 3);
      for (const e of biggest) notes.push(`  big ${String(e.d).length} ${JSON.stringify(e.fill)} ${String(e.d).slice(0, 160)}`);
    }
    // Too faint: the text, and every earlier shape whose box reaches it.
    for (const [, index] of (error instanceof Error ? error.message : '').matchAll(/element (\d+): its colour has less than/g)) {
      const at = Number(index);
      const text = refused?.elements[at];
      notes.push(`faint ${JSON.stringify(text).slice(0, 200)}`);
      const tx = Number(text?.x ?? 0);
      const ty = Number(text?.y ?? 0);
      refused?.elements.slice(0, at).forEach((earlier, n) => {
        const d = String(earlier.d ?? '');
        const nums = d.match(/-?[\d.]+/g)?.map(Number) ?? [];
        const xs = nums.filter((_, i) => i % 2 === 0);
        const ys = nums.filter((_, i) => i % 2 === 1);
        const box = earlier.type === 'path' ? { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) } : { l: Number(earlier.x), r: Number(earlier.x) + Number(earlier.width), t: Number(earlier.y), b: Number(earlier.y) + Number(earlier.height) };
        if (tx >= box.l - 2 && tx <= box.r && ty >= box.t && ty - 12 <= box.b) notes.push(`  over ${n} ${JSON.stringify(earlier).slice(0, 220)}`);
      });
    }
    // A claim's own decoration, last in the page: where it was drawn.
    if (made.claim) for (const e of refused?.elements.slice(-3) ?? []) notes.push(`last ${JSON.stringify(e).slice(0, 300)}`);
    for (const [, index] of (error instanceof Error ? error.message : '').matchAll(/element (\d+): the value does not fit its box/g)) {
      notes.push(`too wide ${JSON.stringify(refused?.elements[Number(index)])}`);
    }
    for (const [, index] of (error instanceof Error ? error.message : '').matchAll(/element (\d+): it lies outside the page/g)) {
      notes.push(`outside ${JSON.stringify(refused?.elements[Number(index)])} page ${JSON.stringify((refused as { page?: unknown } | undefined)?.page)}`);
    }
    // A key fact not shown: the labels the page has where its words are, as the snapshot read them.
    for (const [, field] of (error instanceof Error ? error.message : '').matchAll(/([\w.]+): \1 is a key fact and is not shown/g)) {
      const value = JSON.stringify(field?.split('.').reduce<unknown>((at, key) => (at as Record<string, unknown>)?.[key], made.document));
      const words = (value ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter((w) => w.length > 2);
      const labels = (refused?.elements ?? []).filter((e) => e.type === 'label' && words.some((w) => String(e.text).includes(w)));
      notes.push(`${field} = ${value}; labels holding its words: ${labels.map((e) => JSON.stringify(e.text)).join(', ').slice(0, 300)}`);
    }
    return { seed, stage: 'snapshot', error: error instanceof Error ? error.message : String(error), notes };
  }
  // As a receiver opens it, from the JSON it travels as.
  const travelled = JSON.parse(JSON.stringify(view));
  lastView = travelled;
  const parsed = BtpBoundViewSchema.safeParse(travelled);
  if (!parsed.success) return { seed, stage: 'schema', error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), notes: made.notes };
  const result = checkBoundView(made.document, parsed.data);
  if (!result.show) return { seed, stage: 'check', error: result.problems.map((p) => `${p.field ?? p.element}: ${p.message}`).join('; '), notes: made.notes };
  try {
    const png = await renderBoundView({ ...made.document, boundView: travelled }, { scale: 1 });
    if (png === null) return { seed, stage: 'render', error: 'the renderer would not draw it', notes: made.notes };
    drawn = png;
  } catch (error) {
    return { seed, stage: 'render', error: error instanceof Error ? error.message : String(error), notes: made.notes };
  }
  return undefined;
};

declare global {
  interface Window {
    sweep: (from: number, count: number) => Promise<{ failures: Result[]; tally: Tally }>;
  }
}

/** Each case's outcome against what it should be: shown, or (for a claim that throws) refused with its documented message. */
export type Tally = Record<string, { cases: number; held: number }>;

window.sweep = async (from, count) => {
  await initBoundViewEngine('/resvg.wasm');
  const failures: Result[] = [];
  const tally: Tally = {};
  for (let seed = from; seed < from + count; seed++) {
    const made = generate(seed);
    const claim = made.claim;
    const key = `${made.document.type}\t${claim?.group ?? 'normal'}\t${claim?.item ?? '-'}`;
    let failure: Result | undefined;
    if (claim?.direct) {
      try {
        claim.direct();
        failure = { seed, stage: 'snapshot', error: '', notes: [] };
      } catch (error) {
        failure = { seed, stage: 'snapshot', error: error instanceof Error ? error.message : String(error), notes: [] };
      }
    } else {
      failure = await run(seed).catch((error: unknown) => ({ seed, stage: 'snapshot' as const, error: `crashed: ${String(error)}`, notes: [] }));
    }
    const held = claim?.expect ? failure !== undefined && failure.stage === 'snapshot' && claim.expect.test(failure.error) : failure === undefined;
    const entry = (tally[key] ??= { cases: 0, held: 0 });
    entry.cases++;
    if (held) entry.held++;
    else if (claim?.expect) failures.push({ seed, stage: failure?.stage ?? 'snapshot', error: failure ? `threw otherwise: ${failure.error}` : 'did not throw', notes: made.notes });
    else if (failure) failures.push(failure);
  }
  return { failures, tally };
};

// ---- Looks: the drawing against the browser's own picture of the page ----

type Looks = { failure?: Result; drawn?: string };
type Compared = { worst: number; cells: number; at?: string; x?: number; y?: number };

const pixelsOf = async (png: Uint8Array | Blob, width: number, height: number) => {
  const bitmap = await createImageBitmap(png instanceof Blob ? png : new Blob([png as BlobPart], { type: 'image/png' }));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, width, height).data;
};

/** Lays the case out, captures, checks and draws it: the drawing, base64, for the page's picture to be taken beside it. */
(window as unknown as { looks: (seed: number) => Promise<Looks> }).looks = async (seed) => {
  await initBoundViewEngine('/resvg.wasm');
  const failure = await run(seed).catch((error: unknown) => ({ seed, stage: 'snapshot' as const, error: `crashed: ${String(error)}`, notes: [] }));
  if (failure) return { failure };
  let text = '';
  const bytes = drawn as Uint8Array;
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { drawn: btoa(text) };
};

/**
 * The two pictures compared in cells of 16 px: each cell's mean difference, of 255. A glyph's edge drawn a little
 * differently moves a cell by a few; a border, shadow, image or colour drawn differently moves it by far more. The worst
 * cell, and what on the page is there.
 */
(window as unknown as { compare: (ours: string, theirs: string) => Promise<Compared> }).compare = async (ours, theirs) => {
  const preview = document.getElementById('preview') as HTMLElement;
  const rect = preview.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const [a, b] = await Promise.all([pixelsOf(decode(ours), width, height), pixelsOf(decode(theirs), width, height)]);
  // Each pixel against the nearest like it within 2 px in the other picture, both ways: a glyph placed a pixel over is the
  // same drawing; a border, shadow or image drawn differently is not.
  const reach = 2;
  const near = (from: Uint8ClampedArray, to: Uint8ClampedArray, x: number, y: number) => {
    const i = (y * width + x) * 4;
    let best = Infinity;
    for (let dy = -reach; dy <= reach && best > 0; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -reach; dx <= reach; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const j = (yy * width + xx) * 4;
        const d = Math.abs((from[i] ?? 0) - (to[j] ?? 0)) + Math.abs((from[i + 1] ?? 0) - (to[j + 1] ?? 0)) + Math.abs((from[i + 2] ?? 0) - (to[j + 2] ?? 0));
        if (d < best) best = d;
        if (best === 0) break;
      }
    }
    return best;
  };
  const size = 16;
  let worst = 0;
  let cells = 0;
  let at: [number, number] = [0, 0];
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      let sum = 0;
      let n = 0;
      for (let yy = y; yy < Math.min(height, y + size); yy++) {
        for (let xx = x; xx < Math.min(width, x + size); xx++) {
          sum += Math.max(near(a, b, xx, yy), near(b, a, xx, yy));
          n += 3;
        }
      }
      const mean = sum / n;
      if (mean > 24) cells++;
      if (mean > worst) {
        worst = mean;
        at = [x + size / 2, y + size / 2];
      }
    }
  }
  // What is at the worst cell: the element under it, and the styles that could draw differently.
  window.scrollTo(0, rect.top + window.scrollY + at[1] - 300);
  const now = preview.getBoundingClientRect();
  const hit = document.elementFromPoint(now.left + at[0], now.top + at[1]);
  const describe = (element: Element | null) => {
    if (!element) return 'nothing';
    const css = getComputedStyle(element);
    const notable = ['opacity', 'boxShadow', 'transform', 'filter', 'clipPath', 'mixBlendMode', 'textDecorationLine', 'textShadow', 'outlineStyle', 'borderTopStyle', 'backgroundImage', 'objectFit']
      .map((key) => [key, css[key as 'opacity']] as const)
      .filter(([key, value]) => value && !['1', 'none', 'normal', 'fill', 'solid'].includes(value) && !(key === 'borderTopStyle' && value === 'none'));
    const tag = element.tagName.toLowerCase();
    return `${tag}${element.id ? `#${element.id}` : ''} ${notable.map(([key, value]) => `${key}:${value.slice(0, 60)}`).join('; ')}`.trim();
  };
  // And what the drawing has there: each element whose box holds the worst cell.
  const [wx, wy] = at;
  const under = (lastView?.elements ?? []).flatMap((e, i) => {
    const nums = String(e.d ?? '').match(/-?[\d.]+/g)?.map(Number) ?? [];
    const points = e.type === 'path' ? nums : e.type === 'line' ? [...(e.from as number[]), ...(e.to as number[])] : [Number(e.x), Number(e.y) - (e.type === 'text' || e.type === 'label' ? Number(e.size) : 0), Number(e.x) + Number(e.width ?? 0), Number(e.y) + Number(e.height ?? 0)];
    const xs = points.filter((_, k) => k % 2 === 0);
    const ys = points.filter((_, k) => k % 2 === 1);
    const hitBox = Math.min(...xs) - 8 <= wx && Math.max(...xs) + 8 >= wx && Math.min(...ys) - 8 <= wy && Math.max(...ys) + 8 >= wy;
    return hitBox ? [`${i} ${JSON.stringify({ ...e, d: e.d === undefined ? undefined : String(e.d).slice(0, 80) }).slice(0, 220)}`] : [];
  });
  return { worst: Math.round(worst), cells, at: `${describe(hit)} || drawn: ${under.slice(-6).join(' | ')}`, x: at[0], y: at[1] };
};

// For looking into one case: the runs the snapshot reads, and how they bind.
(window as unknown as { inspect: (seed: number) => Promise<unknown> }).inspect = async (seed: number) => {
  const { textRuns } = await import('../src/snapshot/index.js');
  const { bindRuns } = await import('../src/snapshot/bind.js');
  const made = generate(seed);
  style.textContent = made.css;
  host.innerHTML = made.html;
  const preview = document.getElementById('preview') as HTMLElement;
  await settle(preview);
  const runs = textRuns(preview, preview.getBoundingClientRect());
  const segments = bindRuns(made.document, runs);
  return runs.map((run, i) => ({
    i,
    text: run.text,
    node: run.node,
    top: Math.round(run.top),
    baseline: run.baseline,
    binds: segments.filter((s) => s.run === i).map((s) => `${[...run.text].slice(s.from, s.to).join('')}→${s.bind?.field ?? '-'}`),
  }));
};
