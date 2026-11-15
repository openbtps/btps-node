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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const server = createServer((request, response) => {
  const file = files[(request.url ?? '').split('?')[0] as string];
  response.writeHead(file ? 200 : 404, file ? { 'content-type': file[0], 'access-control-allow-origin': '*' } : {});
  response.end(file?.[1]);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address() as { port: number };
const browser = await chromium.launch({ executablePath: chrome, headless: true });

type Result = { seed: number; stage: string; error: string; notes: string[] };
const failures: Result[] = [];
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
    const found = (await page.evaluate(([a, b]) => window.sweep(a as number, b as number), [start, size])) as Result[];
    failures.push(...found);
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
await Promise.all(Array.from({ length: pages }, worker));
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
