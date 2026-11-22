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
import { unzlibSync } from 'fflate';
import { BtpBoundViewSchema, checkBoundView, type BTPBoundView } from '@btps/sdk/boundview';
import {
  initBoundViewEngine,
  renderBoundView,
  boundViewToSvg,
  signatureSvg,
} from '../src/index.js';
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
    const bound = parsed.elements.flatMap((element) =>
      element.type === 'text' ? [element.bind.field] : [],
    );
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
      for (const char of shown)
        expect(parsed.fonts?.[element.font]?.glyphs?.[char], `${char} in ${shown}`).toBeDefined();
    }
    // The logo is plain shapes, so it travels as its outlines, not its pixels.
    expect(parsed.images).toBeUndefined();
    // Its two shapes, in the band at the top (the page's borders and rounded boxes are paths too).
    const inLogo = (element: (typeof parsed.elements)[number]) => {
      if (element.type !== 'path') return false;
      const [x = 0, y = 0] = element.d
        .slice(1)
        .split(/[ A-Z]/)
        .map(Number);
      return x < 80 && y < 72;
    };
    expect(parsed.elements.filter(inLogo)).toHaveLength(2);
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
      writeFileSync(
        `${process.env.BOUNDVIEW_OUT}/view.svg`,
        boundViewToSvg(document, view as BTPBoundView),
      );
    }
    const pixels = ours.length / 4;
    expect(total / (pixels * 3)).toBeLessThan(3);
    expect(far / pixels).toBeLessThan(0.02);
  });

  // Found adding a Marketplace template to eBill: its serif in three weights, with and without tabular figures, came from
  // woff2 files the snapshot cannot read, and each style carried its own copy of the same bundled font, past the limit.
  it('draws every style whose font file it cannot read with one bundled font, not a copy each', async () => {
    const styles = [
      '400',
      '600',
      '700',
      '400;font-style:italic',
      '600;font-variant-numeric:tabular-nums',
      '700;font-variant-numeric:tabular-nums',
    ];
    const extraHtml = styles
      .map(
        (style) =>
          `<div style="font-family:Georgia;font-size:12px;padding:0 24px;font-weight:${style}">Kind regards</div>`,
      )
      .join('');
    const plain = await browser.capture(invoice);
    const { view, error, warnings } = await browser.capture(invoice, { extraHtml });
    expect(error).toBeUndefined();
    expect(warnings.filter((warning) => warning.startsWith('Georgia')).length).toBeGreaterThan(1);
    expect(Object.keys(view?.fonts ?? {})).toHaveLength(
      Object.keys(plain.view?.fonts ?? {}).length + 1,
    );
  });

  // Found in eBill's Kauri template: a wide logo in a square box with object-fit: contain was stretched to the box, and a
  // rounded, bordered logo box lost its round corners.
  it('keeps an image in proportion as object-fit places it, and a rounded border round', async () => {
    const wide = Buffer.from(
      new Resvg(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#ff0000"/></svg>',
      )
        .render()
        .asPng(),
    );
    const extraHtml =
      `<div style="margin:0 24px 12px;width:120px;height:120px;border:2px solid #cccccc;border-radius:12px">` +
      `<img alt="" src="data:image/png;base64,${wide.toString('base64')}" style="display:block;width:116px;height:116px;object-fit:contain"></div>`;
    const { view, error } = await browser.capture(invoice, { extraHtml });
    expect(error).toBeUndefined();
    // The border: the ring between its outer and inner edges, both with curved corners (12px out, 10px in).
    const border = view?.elements.find(
      (element) => element.type === 'path' && element.fill === '#cccccc',
    );
    expect(border).toMatchObject({ fillRule: 'evenodd' });
    expect((border as { d: string }).d.match(/C/g)).toHaveLength(8);
    const [image] = Object.values(view?.images ?? {});
    expect(image).toBeDefined();
    const { width, height, data } = image as { width: number; height: number; data: string };
    const rgba = unzlibSync(Buffer.from(data, 'base64'));
    const red = (x: number, y: number) =>
      rgba[(y * width + x) * 4] === 255 &&
      rgba[(y * width + x) * 4 + 1] === 0 &&
      (rgba[(y * width + x) * 4 + 3] ?? 0) > 0;
    // 2:1 in a square: red across the middle, nothing in the top and bottom quarters.
    expect(red(Math.floor(width / 2), Math.floor(height / 2))).toBe(true);
    expect(red(Math.floor(width / 2), Math.floor(height / 8))).toBe(false);
    expect(red(Math.floor(width / 2), Math.floor((height * 7) / 8))).toBe(false);
  });

  // Found in eBill: a drawn signature with dots, drawn by the page one way and by the engine another, was not found, and
  // was drawn bolder and without its dots. Now one rule draws it (signature.ts): a page shows signatureSvg, the engine
  // draws by the same function, and the snapshot finds it by equality, whatever the strokes.
  describe('a drawn signature, by the one rule both the page and the engine draw it with', () => {
    let seed = 7;
    const random = (below: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % below;
    };
    // Dots, two-point lines, strokes of up to 40 points, and a point repeated at once (a pen held still).
    const signatureOf = () =>
      Array.from({ length: 1 + random(8) }, () => {
        const points = [1, 2, 2 + random(39)][random(3)] as number;
        const stroke = Array.from({ length: points }, () => [random(1001), random(301)]).flat();
        return random(4) === 0 ? [...stroke.slice(0, 2), ...stroke] : stroke;
      });
    const shown = (svg: string) =>
      `<div style="width:200px;height:60px;margin:0 24px 12px;color:#1e3a8a">${svg.replace('<svg ', '<svg width="200" height="60" ')}</div>`;
    const signed = (strokes: number[][]) => ({
      ...invoice,
      signatory: { visualSignature: { type: 'drawn', strokes } },
    });

    it('finds each of 40 signatures a page shows as signatureSvg draws them', async () => {
      for (let turn = 0; turn < 40; turn++) {
        const strokes = signatureOf();
        const { view, error } = await browser.capture(signed(strokes), {
          extraHtml: shown(signatureSvg(strokes)),
        });
        expect(error, JSON.stringify(strokes)).toBeUndefined();
        expect(view?.elements.filter((element) => element.type === 'signature')).toHaveLength(1);
      }
    });

    it('does not take another drawing as the signature: one point elsewhere, or the same points drawn by another rule', async () => {
      const strokes = [
        [100, 200, 300, 80, 500, 220],
        [700, 60],
      ];
      const moved = await browser.capture(signed(strokes), {
        extraHtml: shown(
          signatureSvg([
            [100, 200, 300, 83, 500, 220],
            [700, 60],
          ]),
        ),
      });
      expect(moved.error).toContain('signature');
      const other = await browser.capture(signed(strokes), {
        extraHtml: shown(
          '<svg viewBox="0 0 1000 300"><polyline points="100,200 300,80 500,220" fill="none" stroke="currentColor" stroke-width="6"/>' +
            '<circle cx="700" cy="60" r="3" fill="currentColor"/></svg>',
        ),
      });
      expect(other.error).toContain('signature');
    });
  });

  it('refuses a preview that does not show a key fact, and says which', async () => {
    const { error } = await browser.capture({
      ...invoice,
      taxAmount: { amount: 99, currency: 'AUD' },
    });
    expect(error).toContain('taxAmount');
  });

  it("warns the sender of a label that looks like a payment detail but is not the document's", async () => {
    const { view, warnings } = await browser.capture(invoice, {
      extraHtml:
        '<div style="font-size:12px;padding:0 24px 12px">Pay to BSB 062-000 Account 1234 5678</div>',
    });
    expect(view).toBeDefined();
    expect(warnings.some((warning) => /looks like an account number/.test(warning))).toBe(true);
  });
});
