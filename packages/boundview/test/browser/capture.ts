/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A real capture: the package bundled for the browser as an app would bundle
 * it, a platform's own invoice preview (invoice.html) served with its fonts,
 * and snapshotBoundView run on it in headless Chrome. The browser test, the
 * BoundView journey (tests/e2e) and the BoundView attacks (tests/security)
 * all start from what this captures, never from a canvas written by hand.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import type { BTPBoundView } from '@btps/sdk/boundview';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const require = createRequire(import.meta.url);

/** Chrome where it is installed (as on GitHub's runners), or undefined: a capture's tests are skipped without it. */
export const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  (() => {
    try {
      return execSync('command -v google-chrome || command -v chromium', { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  })(),
].find((candidate) => candidate && existsSync(candidate));

/** The document the preview (invoice.html) shows. */
export const previewInvoice = {
  type: 'invoice',
  title: 'November',
  id: 'INV-0042',
  issuedAt: '2026-11-25T00:00:00.000Z',
  dueAt: '2026-12-09T00:00:00.000Z',
  totalAmount: { amount: 145200, currency: 'AUD' },
  taxAmount: { amount: 13200, currency: 'AUD' },
  issuer: { name: 'Apexworld', identifiers: { 'au:abn': '51824753556' } },
  recipient: { name: 'Northwind Studio' },
  description: 'Thanks for your business.',
  lineItems: {
    columns: ['Item', 'Amount'],
    roles: { Item: 'description', Amount: 'lineTotal' },
    rows: [{ Item: 'Website care', Amount: 132000 }],
  },
};

export type Capture = { view?: BTPBoundView; error?: string; warnings: string[] };

/** Starts the preview page in headless Chrome; `capture` runs snapshotBoundView on it. */
export async function startCapture() {
  const bundle = await build({
    entryPoints: [path.join(root, 'packages/boundview/src/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    tsconfig: path.join(root, 'tsconfig.json'),
    external: ['node:*'],
    logLevel: 'silent',
  });
  const files: Record<string, [string, Buffer | string]> = {
    '/': ['text/html', readFileSync(path.join(here, 'invoice.html'))],
    '/boundview.js': ['text/javascript', bundle.outputFiles[0]?.text ?? ''],
    '/resvg.wasm': ['application/wasm', readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))],
  };
  for (const name of ['arimo-latin-400-normal', 'arimo-latin-700-normal', 'tinos-latin-400-normal']) {
    const font = name.split('-')[0] as string;
    files[`/fonts/${name}.woff`] = ['font/woff', readFileSync(require.resolve(`@fontsource/${font}/files/${name}.woff`))];
  }
  const server = createServer((request, response) => {
    const file = files[request.url ?? ''];
    response.writeHead(file ? 200 : 404, file ? { 'content-type': file[0] } : {});
    response.end(file?.[1]);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page: Page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.addScriptTag({ type: 'module', content: `import * as boundview from '/boundview.js'; window.boundview = boundview;` });
  await page.waitForFunction(() => 'boundview' in window && document.fonts.status === 'loaded');

  return {
    page,
    /**
     * Captures the preview for `document`. `extraHtml`, when given, is
     * added to the preview first, as a sender's design might add it, and
     * taken away after.
     */
    capture: (document: object, { extraHtml }: { extraHtml?: string } = {}): Promise<Capture> =>
      page.evaluate(
        async ([doc, extra]) => {
          const warnings: string[] = [];
          const preview = window.document.getElementById('preview') as HTMLElement;
          const added = extra ? preview.appendChild(window.document.createElement('div')) : undefined;
          if (added && extra) added.innerHTML = extra;
          const { snapshotBoundView } = (window as unknown as { boundview: typeof import('../../src/index.js') }).boundview;
          try {
            const view = await snapshotBoundView(preview, doc as never, {
              engine: '/resvg.wasm',
              onWarning: (warning) => warnings.push(warning),
            });
            return { view, warnings };
          } catch (error) {
            return { error: String(error), warnings };
          } finally {
            added?.remove();
          }
        },
        [document, extraHtml ?? ''] as const,
      ),
    close: async () => {
      await browser.close();
      server.close();
    },
  };
}
