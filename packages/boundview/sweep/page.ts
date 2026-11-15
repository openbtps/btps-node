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

export type Result = { seed: number; stage: 'snapshot' | 'schema' | 'check' | 'render'; error: string; notes: string[] };

const host = document.getElementById('host') as HTMLElement;
const style = document.getElementById('case') as HTMLStyleElement;

const settle = async (root: HTMLElement) => {
  await document.fonts.ready;
  await Promise.all(Array.from(root.querySelectorAll('img'), (image) => image.decode().catch(() => undefined)));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await document.fonts.ready;
};

const run = async (seed: number): Promise<Result | undefined> => {
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
  const parsed = BtpBoundViewSchema.safeParse(travelled);
  if (!parsed.success) return { seed, stage: 'schema', error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), notes: made.notes };
  const result = checkBoundView(made.document, parsed.data);
  if (!result.show) return { seed, stage: 'check', error: result.problems.map((p) => `${p.field ?? p.element}: ${p.message}`).join('; '), notes: made.notes };
  try {
    const png = await renderBoundView({ ...made.document, boundView: travelled }, { scale: 1 });
    if (png === null) return { seed, stage: 'render', error: 'the renderer would not draw it', notes: made.notes };
  } catch (error) {
    return { seed, stage: 'render', error: error instanceof Error ? error.message : String(error), notes: made.notes };
  }
  return undefined;
};

declare global {
  interface Window {
    sweep: (from: number, count: number) => Promise<Result[]>;
  }
}

window.sweep = async (from, count) => {
  await initBoundViewEngine('/resvg.wasm');
  const failures: Result[] = [];
  for (let seed = from; seed < from + count; seed++) {
    const failure = await run(seed).catch((error: unknown) => ({ seed, stage: 'snapshot' as const, error: `crashed: ${String(error)}`, notes: [] }));
    if (failure) failures.push(failure);
  }
  return failures;
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
