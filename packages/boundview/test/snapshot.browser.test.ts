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
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-wasm';
import { BtpBoundViewSchema, checkBoundView, type BTPBoundView } from '@btps/sdk/boundview';
import { initBoundViewEngine, renderBoundView, boundViewToSvg } from '../src/index.js';
import { chrome, previewInvoice as invoice, startCapture } from './browser/capture.js';

describe.skipIf(!chrome)('a preview captured in a real browser', () => {
  let browser: Awaited<ReturnType<typeof startCapture>>;

  beforeAll(async () => {
    browser = await startCapture();
    await initBoundViewEngine();
  }, 60_000);

  afterAll(() => browser?.close());

  it('binds every fact by its value, and a receiver accepts and shows it', async () => {
    const { view, error, warnings } = await browser.capture(invoice);
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
    const { view } = await browser.capture(invoice);
    const document = { ...invoice, boundView: view as BTPBoundView };
    const png = await renderBoundView(document, { scale: 1 });
    expect(png).not.toBeNull();
    const screenshot = await (await browser.page.$('#preview'))?.screenshot();
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

  // Found adding a Marketplace template to eBill: its serif in three weights, with and without tabular figures, came from
  // woff2 files the snapshot cannot read, and each style carried its own copy of the same bundled font, past the limit.
  it('draws every style whose font file it cannot read with one bundled font, not a copy each', async () => {
    const styles = ['400', '600', '700', '400;font-style:italic', '600;font-variant-numeric:tabular-nums', '700;font-variant-numeric:tabular-nums'];
    const extraHtml = styles.map((style) => `<div style="font-family:Georgia;font-size:12px;padding:0 24px;font-weight:${style}">Kind regards</div>`).join('');
    const plain = await browser.capture(invoice);
    const { view, error, warnings } = await browser.capture(invoice, { extraHtml });
    expect(error).toBeUndefined();
    expect(warnings.filter((warning) => warning.startsWith('Georgia')).length).toBeGreaterThan(1);
    expect(Object.keys(view?.fonts ?? {})).toHaveLength(Object.keys(plain.view?.fonts ?? {}).length + 1);
  });

  it('refuses a preview that does not show a key fact, and says which', async () => {
    const { error } = await browser.capture({ ...invoice, subtotalAmount: { amount: 99, currency: 'AUD' } });
    expect(error).toContain('subtotalAmount');
  });

  it("warns the sender of a label that looks like a payment detail but is not the document's", async () => {
    const { view, warnings } = await browser.capture(invoice, {
      extraHtml: '<div style="font-size:12px;padding:0 24px 12px">Pay to BSB 062-000 Account 1234 5678</div>',
    });
    expect(view).toBeDefined();
    expect(warnings.some((warning) => /looks like an account number/.test(warning))).toBe(true);
  });
});
