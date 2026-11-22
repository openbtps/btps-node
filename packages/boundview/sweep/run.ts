/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Runs the sweep: `node packages/boundview/sweep/run.ts <from> <count> [pages] [fonts-dir]`.
 * Bundles page.ts for the browser as an app would, serves it with its fonts
 * and logos, and runs the seeds across several pages of headless Chrome. Each
 * failure is written to sweep-failures.json with its seed; a summary groups
 * them by what failed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);
const [from = 0, count = 200, pages = 6] = process.argv.slice(2, 5).map(Number);
const fontsDir = process.argv[5] ?? path.join(process.env.HOME ?? '', 'Desktop/Application/ebill-worktrees/btps12-rc3/packages/design-tokens/fonts');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const bundle = await build({
  entryPoints: [path.join(here, 'page.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['browser'],
  write: false,
  tsconfig: path.join(root, 'tsconfig.json'),
  external: ['node:*'],
  logLevel: 'error',
});

const files: Record<string, [string, Buffer | string]> = {
  '/': ['text/html', `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/fonts.css"><style id="case"></style><body style="margin:0"><div id="host"></div><script type="module" src="/sweep.js"></script>`],
  '/sweep.js': ['text/javascript', bundle.outputFiles[0]?.text ?? ''],
  '/resvg.wasm': ['application/wasm', readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))],
  '/logo.png': ['image/png', readFileSync(path.join(root, 'packages/boundview/sweep/logo.png'))],
  '/logo.svg': ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 64"><rect width="128" height="64" rx="10" fill="#0b6e4f"/><path d="M16 48 L40 16 L64 48 Z" fill="#ffffff"/><circle cx="96" cy="32" r="16" fill="#f5c542"/></svg>'],
};
const fontsource = (family: string) => path.dirname(require.resolve(`@fontsource/${family}/package.json`));
let css = '';
// Arimo: fontsource's own CSS, woff2 and woff, split by unicode-range (the snapshot reads the woff).
for (const weight of [400, 700]) {
  css += readFileSync(path.join(fontsource('arimo'), `${weight}.css`), 'utf8').replace(/url\(\.\/files\//g, 'url(/fonts/arimo/');
}
// Tinos: the same rules with only their woff2 (the snapshot decompresses it).
for (const weight of [400, 700]) {
  css += readFileSync(path.join(fontsource('tinos'), `${weight}.css`), 'utf8')
    .replace(/url\(\.\/files\//g, 'url(/fonts/tinos/')
    .replace(/,\s*url\([^)]*\.woff\) format\('woff'\)/g, '');
}
// Cousine: woff alone, no unicode-range.
for (const weight of [400, 700]) {
  css += `@font-face{font-family:'Cousine';font-weight:${weight};src:url(/fonts/cousine/cousine-latin-${weight}-normal.woff) format('woff')}`;
}
for (const family of ['arimo', 'tinos', 'cousine']) {
  const dir = path.join(fontsource(family), 'files');
  for (const name of require('node:fs').readdirSync(dir) as string[]) files[`/fonts/${family}/${name}`] = [name.endsWith('2') ? 'font/woff2' : 'font/woff', readFileSync(path.join(dir, name))];
}
// eBill's own fonts: variable woff2, one file a family, no unicode-range.
const variable: [string, string, string][] = [
  ['Geist', 'geist/Geist-Variable-latin.woff2', '100 900'],
  ['Source Serif 4', 'source-serif-4/SourceSerif4-Variable-latin.woff2', '200 900'],
  ['Atkinson Hyperlegible Next', 'atkinson-hyperlegible-next/AtkinsonHyperlegibleNext-Variable-latin.woff2', '200 800'],
  ['Caveat', 'caveat/Caveat-Variable-latin.woff2', '400 700'],
];
for (const [family, file, weights] of variable) {
  const source = path.join(fontsDir, file);
  if (!existsSync(source)) throw new Error(`${family}: ${source} not found (pass the fonts directory)`);
  files[`/fonts/v/${path.basename(file)}`] = ['font/woff2', readFileSync(source)];
  css += `@font-face{font-family:'${family}';font-weight:${weights};src:url(/fonts/v/${path.basename(file)}) format('woff2')}`;
}
files['/fonts.css'] = ['text/css', css];

// For the claims (claims.ts): a PNG of `width` by `height` whose pixels `at` gives, RGB.
const png = (width: number, height: number, at: (x: number, y: number) => [number, number, number]) => {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set(at(x, y), y * (width * 3 + 1) + 1 + x * 3);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
let noise = 12345;
const random = () => ((noise = (Math.imul(noise, 1103515245) + 12345) >>> 0) >>> 16) & 255;
files['/big.png'] = ['image/png', png(1600, 1200, (x, y) => (((x >> 6) + (y >> 6)) % 2 ? [11, 110, 79] : [233, 247, 239]))];
files['/photo.png'] = ['image/png', png(512, 512, () => [random(), random(), random()])];
files['/mid1.png'] = ['image/png', png(240, 240, () => [random(), random(), random()])];
files['/mid2.png'] = ['image/png', png(240, 240, () => [random(), random(), random()])];
// Served without CORS, and asked for from the same server by another name (localhost): a site that does not allow it.
const NO_CORS = new Set(['/nocors.png', '/nocors.css']);
files['/nocors.png'] = files['/logo.png'] as [string, Buffer];
files['/nocors.css'] = ['text/css', `@font-face{font-family:'Remote Caveat';src:url(/fonts/v/Caveat-Variable-latin.woff2) format('woff2')}`];

const server = createServer((request, response) => {
  const at = (request.url ?? '').split('?')[0] as string;
  const file = files[at];
  response.writeHead(file ? 200 : 404, file ? { 'content-type': file[0], ...(!NO_CORS.has(at) && { 'access-control-allow-origin': '*' }) } : {});
  response.end(file?.[1]);
});
await new Promise<void>((resolve) => server.listen(0, resolve));
const { port } = server.address() as { port: number };
const browser = await chromium.launch({ executablePath: chrome, headless: true });

type Result = { seed: number; stage: string; error: string; notes: string[] };
type Tally = Record<string, { cases: number; held: number }>;
const failures: Result[] = [];
const tally: Tally = {};
const started = Date.now();
let done = 0;
const chunk = 50;
let next = from;
const worker = async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('page error', error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => 'sweep' in window);
  while (next < from + count) {
    const start = next;
    const size = Math.min(chunk, from + count - start);
    next += size;
    const found = (await page.evaluate(([a, b]) => window.sweep(a as number, b as number), [start, size])) as { failures: Result[]; tally: Tally };
    failures.push(...found.failures);
    for (const [key, { cases, held }] of Object.entries(found.tally)) {
      const entry = (tally[key] ??= { cases: 0, held: 0 });
      entry.cases += cases;
      entry.held += held;
    }
    done += size;
    if (done % 500 < chunk) {
      const rate = done / ((Date.now() - started) / 1000);
      console.log(`${done}/${count} cases, ${failures.length} failed, ${rate.toFixed(1)}/s`);
    }
  }
  await page.close();
};
if (process.env.INSPECT) {
  // One case looked into: INSPECT=<seed> prints the runs the snapshot reads and how they bind.
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => 'inspect' in window);
  const seed = Number(process.env.INSPECT);
  const runs = (await page.evaluate((s) => (window as unknown as { inspect: (n: number) => Promise<unknown> }).inspect(s), seed)) as object[];
  for (const run of runs) console.log(JSON.stringify(run));
  await browser.close();
  server.close();
  process.exit(0);
}
// LOOKS=<limit>: each case also drawn and compared with Chrome's own picture of the page, cell by cell; a cell whose mean
// difference passes the limit (of 255) fails it. Both pictures of a failure are kept in sweep-looks/ by its seed.
const limit = Number(process.env.LOOKS ?? 0);
const worsts: number[] = [];
const looksDir = path.join(root, 'sweep-looks');
const looker = async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('page error', error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => 'looks' in window);
  type Looks = { failure?: Result; drawn?: string };
  type Compared = { worst: number; cells: number; at?: string; x?: number; y?: number };
  while (next < from + count) {
    const seed = next++;
    const looks = (await page.evaluate((s) => (window as unknown as { looks: (n: number) => Promise<Looks> }).looks(s), seed)) as Looks;
    if (looks.failure) failures.push(looks.failure);
    else {
      const shot = (await page.locator('#preview').screenshot({ animations: 'disabled' })).toString('base64');
      const compared = (await page.evaluate(
        ([a, b]) => (window as unknown as { compare: (x: string, y: string) => Promise<Compared> }).compare(a as string, b as string),
        [looks.drawn, shot],
      )) as Compared;
      worsts.push(compared.worst);
      if (compared.worst > limit) {
        failures.push({ seed, stage: 'looks', error: `differs from the page by ${compared.worst} at ${compared.at}`, notes: [`${compared.cells} cells over 24, worst at ${compared.x},${compared.y}`] });
        mkdirSync(looksDir, { recursive: true });
        writeFileSync(path.join(looksDir, `${seed}-drawn.png`), Buffer.from(looks.drawn as string, 'base64'));
        writeFileSync(path.join(looksDir, `${seed}-page.png`), Buffer.from(shot, 'base64'));
      }
    }
    done++;
    if (done % 250 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      console.log(`${done}/${count} cases, ${failures.length} failed, ${rate.toFixed(1)}/s`);
    }
  }
  await page.close();
};
await Promise.all(Array.from({ length: pages }, limit ? looker : worker));
if (limit) {
  // Which effects the failing cases have, most first: where the drawing parts from the page.
  const tally = new Map<string, number>();
  for (const failure of failures) {
    const effects = failure.notes.find((note) => note.startsWith('effects '))?.slice(8).split(', ') ?? [];
    for (const effect of effects) if (effect !== 'none') tally.set(effect, (tally.get(effect) ?? 0) + 1);
  }
  console.log(`effects in failing cases: ${[...tally].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e} ${n}`).join(', ')}`);
  const sorted = [...worsts].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  console.log(`worst cell, of ${sorted.length} drawn: median ${q(0.5)}, 90% ${q(0.9)}, 99% ${q(0.99)}, max ${sorted.at(-1)}`);
}
await browser.close();
server.close();

const out = path.join(root, `sweep-failures-${from}-${from + count}.json`);
writeFileSync(out, JSON.stringify(failures.sort((a, b) => a.seed - b.seed), null, 1));
const groups = new Map<string, Result[]>();
for (const failure of failures) {
  const key = `${failure.stage}: ${failure.error.replace(/"[^"]*"/g, '"…"').replace(/\d+(\.\d+)?/g, 'N').slice(0, 160)}`;
  groups.set(key, [...(groups.get(key) ?? []), failure]);
}
console.log(`\n${count} cases in ${((Date.now() - started) / 1000).toFixed(0)} s: ${failures.length} failed (${((failures.length / count) * 100).toFixed(2)}%)`);
for (const [key, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(list.length).padStart(6)}  ${key}   e.g. seeds ${list.slice(0, 4).map((f) => f.seed).join(', ')}`);
}
console.log(`\nfailures: ${out}`);

// By type, then by group and item: how many cases, and how many did as the docs say.
if (Object.keys(tally).length > 0) {
  const report = path.join(root, `sweep-claims-${from}-${from + count}.tsv`);
  const rows = Object.entries(tally).sort(([a], [b]) => a.localeCompare(b));
  writeFileSync(report, `type\tgroup\titem\tcases\tas documented\n${rows.map(([key, { cases, held }]) => `${key}\t${cases}\t${held}`).join('\n')}\n`);
  const byType = new Map<string, Map<string, [number, number]>>();
  for (const [key, { cases, held }] of rows) {
    const [type, group] = key.split('\t') as [string, string];
    const groups = byType.get(type) ?? new Map<string, [number, number]>();
    const [c, h] = groups.get(group) ?? [0, 0];
    groups.set(group, [c + cases, h + held]);
    byType.set(type, groups);
  }
  console.log('\ntype        normal            ignored           approximate       throws');
  for (const [type, groups] of byType) {
    const cell = (g: string) => { const [c, h] = groups.get(g) ?? [0, 0]; return `${h}/${c}`.padEnd(18); };
    console.log(`${type.padEnd(12)}${cell('normal')}${cell('ignored')}${cell('approximate')}${cell('throws')}`);
  }
  const broken = rows.filter(([, { cases, held }]) => held < cases);
  console.log(`\nitems not as documented: ${broken.length === 0 ? 'none' : ''}`);
  for (const [key, { cases, held }] of broken) console.log(`  ${key.replace(/\t/g, ' | ')}: ${cases - held} of ${cases}`);
  console.log(`report: ${report}`);
}
