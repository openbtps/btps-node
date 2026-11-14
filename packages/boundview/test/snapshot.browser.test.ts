/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * The whole way, in a real browser: a platform's own preview, with nothing
 * marked, captured by snapshotBoundView; accepted and shown by a receiver;
 * drawn by the engine; and the drawing compared with the browser's own
 * picture of the preview. Runs where Chrome is installed (as on GitHub's
 * runners), and is skipped where it is not.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { Resvg } from '@resvg/resvg-wasm';
import { BtpBoundViewSchema, checkBoundView, type BTPBoundView } from '@btps/sdk/boundview';
import { initBoundViewEngine, renderBoundView, boundViewToSvg } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);

const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  (() => {
    try {
      return execSync('command -v google-chrome || command -v chromium', { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  })(),
].find((candidate) => candidate && existsSync(candidate));

const invoice = {
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

describe.skipIf(!chrome)('a preview captured in a real browser', () => {
  let server: Server;
  let browser: Browser;
  let page: Page;
  let port = 0;

  beforeAll(async () => {
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
      '/': ['text/html', readFileSync(path.join(here, 'browser/invoice.html'))],
      '/boundview.js': ['text/javascript', bundle.outputFiles[0]?.text ?? ''],
      '/resvg.wasm': ['application/wasm', readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))],
    };
    for (const name of ['arimo-latin-400-normal', 'arimo-latin-700-normal', 'tinos-latin-400-normal']) {
      const font = name.split('-')[0] as string;
      files[`/fonts/${name}.woff`] = ['font/woff', readFileSync(require.resolve(`@fontsource/${font}/files/${name}.woff`))];
    }
    server = createServer((request, response) => {
      const file = files[request.url ?? ''];
      response.writeHead(file ? 200 : 404, file ? { 'content-type': file[0] } : {});
      response.end(file?.[1]);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.addScriptTag({ type: 'module', content: `import * as boundview from '/boundview.js'; window.boundview = boundview;` });
    await page.waitForFunction(() => 'boundview' in window && document.fonts.status === 'loaded');
    await initBoundViewEngine();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  const snapshot = (document: object) =>
    page.evaluate(
      async ([doc]) => {
        const warnings: string[] = [];
        const { snapshotBoundView } = (window as unknown as { boundview: typeof import('../src/index.js') }).boundview;
        try {
          const view = await snapshotBoundView(window.document.getElementById('preview') as HTMLElement, doc as never, {
            engine: '/resvg.wasm',
            onWarning: (warning) => warnings.push(warning),
          });
          return { view, warnings };
        } catch (error) {
          return { error: String(error), warnings };
        }
      },
      [document] as const,
    );

  it('binds every fact by its value, and a receiver accepts and shows it', async () => {
    const { view, error, warnings } = await snapshot(invoice);
    expect(error).toBeUndefined();
    expect(warnings).toEqual([]);
    const parsed = BtpBoundViewSchema.parse(view);
    expect(checkBoundView(invoice, parsed)).toEqual({ show: true });
    const bound = parsed.elements.flatMap((element) => (element.type === 'text' ? [element.bind.field] : []));
    expect(new Set(bound)).toEqual(
      new Set([
        'issuer.name',
        'issuer.identifiers.au:abn',
        'id',
        'issuedAt',
        'dueAt',
        'recipient.name',
        'lineItems.rows.0.Item',
        'lineItems.rows.0.Amount',
        'taxAmount',
        'totalAmount',
        'description',
      ]),
    );
    // Every character drawn, in the case it is drawn, has a glyph in its own font: none falls back.
    for (const element of parsed.elements) {
      if (element.type !== 'label') continue;
      const shown = element.transform === 'uppercase' ? element.text.toUpperCase() : element.text;
      for (const char of shown) expect(parsed.fonts?.[element.font]?.glyphs?.[char], `${char} in ${shown}`).toBeDefined();
    }
    // The logo is plain shapes, so it travels as its outlines, not its pixels.
    expect(parsed.images).toBeUndefined();
    expect(parsed.elements.filter(({ type }) => type === 'path')).toHaveLength(2);
  });

  it('draws as the browser showed the preview', async () => {
    const { view } = await snapshot(invoice);
    const document = { ...invoice, boundView: view as BTPBoundView };
    const png = await renderBoundView(document, { scale: 1 });
    expect(png).not.toBeNull();
    const screenshot = await (await page.$('#preview'))?.screenshot();
    const { width, height } = (view as BTPBoundView).page;
    // Both pictures read back as pixels by the engine, at the same size.
    const pixelsOf = (bytes: Uint8Array) =>
      new Resvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}"><image width="${Math.round(width)}" height="${Math.round(height)}" href="data:image/png;base64,${Buffer.from(bytes).toString('base64')}"/></svg>`,
      ).render().pixels;
    const ours = pixelsOf(png as Uint8Array);
    const theirs = pixelsOf(screenshot as Uint8Array);
    let total = 0;
    let far = 0;
    for (let i = 0; i < ours.length; i += 4) {
      let worst = 0;
      for (let k = 0; k < 3; k++) {
        const diff = Math.abs((ours[i + k] ?? 0) - (theirs[i + k] ?? 0));
        total += diff;
        worst = Math.max(worst, diff);
      }
      if (worst > 96) far++;
    }
    if (process.env.BOUNDVIEW_OUT) {
      writeFileSync(`${process.env.BOUNDVIEW_OUT}/engine.png`, png as Uint8Array);
      writeFileSync(`${process.env.BOUNDVIEW_OUT}/browser.png`, screenshot as Uint8Array);
      writeFileSync(`${process.env.BOUNDVIEW_OUT}/view.svg`, boundViewToSvg(document, view as BTPBoundView));
    }
    const pixels = ours.length / 4;
    expect(total / (pixels * 3)).toBeLessThan(3);
    expect(far / pixels).toBeLessThan(0.02);
  });

  it('refuses a preview that does not show a key fact, and says which', async () => {
    const { error } = await snapshot({ ...invoice, subtotalAmount: { amount: 99, currency: 'AUD' } });
    expect(error).toContain('subtotalAmount');
  });
});
