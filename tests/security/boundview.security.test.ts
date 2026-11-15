/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// A sender, or anyone between, works on a real BoundView (captured from a
// platform's own preview in a browser) to mislead, track or stall a receiver:
// changing it after signing, hiding a fact, binding what may not be bound,
// pointing it at an address, making it expand or cost without end, or slipping
// markup into it. Each is refused, or accepted and never shown, over real
// BtpsServers and TLS; the receiving server keeps answering throughout. Runs
// where Chrome is installed (as on GitHub's runners), and is skipped where it
// is not.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { deflateSync } from 'node:zlib';
import type { BTPBoundView, BTPBoundViewResult } from '../../src/core/server/schemas/boundView.js';
import type { BTPTransporterArtifact } from '../../src/core/server/types.js';
import { BTP_ERROR_SIG_VERIFICATION, BTP_ERROR_VALIDATION } from '../../src/core/error/index.js';
import { boundViewToSvg, renderBoundView } from '../../packages/boundview/src/index.js';
import { chrome, previewInvoice, startCapture } from '../../packages/boundview/test/browser/capture.js';
import {
  addUser,
  artifactFrom,
  deliver,
  recordTrust,
  sendRaw,
  startProvider,
  type Provider,
  type User,
} from '../e2e/harness.js';

vi.mock('dns/promises', async () => (await import('../e2e/zone.js')).dnsModule);

type Element = BTPBoundView['elements'][number];
type Doc = typeof previewInvoice & { boundView: BTPBoundView; [key: string]: unknown };

describe.skipIf(!chrome)('attacks on a BoundView', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let vendor: User;
  let client: User;
  let browser: Awaited<ReturnType<typeof startCapture>>;
  let real: Doc;
  const told = new Map<string, BTPBoundViewResult | undefined>();

  /** The real BoundView with its elements changed by `change`, and more of it by `more`. */
  const altered = (change: (elements: Element[]) => Element[], more: Partial<BTPBoundView> = {}, extra: object = {}): Doc => ({
    ...real,
    ...extra,
    boundView: { ...real.boundView, ...more, elements: change([...real.boundView.elements]) },
  });
  const factOf = (field: string) => {
    const index = real.boundView.elements.findIndex((element) => element.type === 'text' && element.bind.field === field);
    return { index, element: real.boundView.elements[index] as Extract<Element, { type: 'text' }> };
  };
  /**
   * Signs and writes the artifact straight to the receiving server, as an
   * attacker's own client would: the SDK's client refuses most of these
   * before sending, so the server's refusal is what is tested here.
   */
  const send = async (document: object) => {
    const artifact = await artifactFrom(vendor, client.identity, 'BTPS_DOC', document, { encrypt: false });
    const started = performance.now();
    const response = await sendRaw(clientHost, JSON.stringify(artifact));
    return { artifact, status: response.status, ms: performance.now() - started };
  };
  /** Delivered, but the receiving server says the BoundView is not to be shown, and nothing draws it. */
  const notShown = async (document: Doc, check: string) => {
    const { artifact, status } = await send(document);
    expect(status?.ok).toBe(true);
    const result = told.get(artifact.id);
    expect(result?.show).toBe(false);
    expect(result && !result.show && result.problems.map(({ check: name }) => name)).toContain(check);
    const arrived = clientHost.inbox.find(({ id }) => id === artifact.id) as BTPTransporterArtifact;
    expect(await renderBoundView(arrived.document)).toBeNull();
  };
  const refused = async (document: object) => {
    const { status } = await send(document);
    expect(status).toMatchObject({ ok: false, error: BTP_ERROR_VALIDATION.code });
  };

  beforeAll(async () => {
    vendorHost = await startProvider('vendor.test');
    clientHost = await startProvider('client.test');
    vendor = await addUser(vendorHost, 'billing');
    client = await addUser(clientHost, 'pay');
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted', { privacyType: 'mixed' });
    clientHost.server.onIncomingArtifact('Transporter', (artifact, boundView) => {
      told.set(artifact.id, boundView);
    });
    browser = await startCapture();
    const { view, error } = await browser.capture(previewInvoice);
    if (!view) throw new Error(`the preview could not be captured: ${error}`);
    real = { ...previewInvoice, boundView: view };
  }, 60_000);

  afterAll(async () => {
    vendorHost?.stop();
    clientHost?.stop();
    await browser?.close();
  });

  it('is shown as captured, the baseline every attack starts from', async () => {
    const { artifact, status } = await send(real);
    expect(status?.ok).toBe(true);
    expect(told.get(artifact.id)).toEqual({ show: true });
  });

  describe('changing it after it was signed', () => {
    it('refuses a BoundView with one label changed in flight', async () => {
      const artifact = await artifactFrom(vendor, client.identity, 'BTPS_DOC', real, { encrypt: false });
      const document = artifact.document as Doc;
      const elements = document.boundView.elements.map((element) =>
        element.type === 'label' && element.text === 'Bill to' ? { ...element, text: 'Pay to' } : element,
      );
      const changed = { ...document, boundView: { ...document.boundView, elements } };
      const { response } = await deliver({ ...artifact, document: changed as unknown as BTPTransporterArtifact['document'] });
      expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_SIG_VERIFICATION.code });
    });
  });

  describe('hiding a fact', () => {
    it('never shows one with a panel drawn over the amount due', async () => {
      const { element } = factOf('totalAmount');
      await notShown(
        altered((elements) => [...elements, { type: 'rect', x: element.x - 2, y: element.y - 24, width: 160, height: 32, fill: '#f2f6ff' }]),
        'notHidden',
      );
    });

    it('never shows one with the amount due in the colour behind it', async () => {
      const { index, element } = factOf('totalAmount');
      await notShown(altered((elements) => elements.map((e, i) => (i === index ? { ...element, colour: '#f2f6ff' } : e))), 'notHidden');
    });

    it('never shows one with a fact pushed off the page', async () => {
      const { index, element } = factOf('dueAt');
      await notShown(altered((elements) => elements.map((e, i) => (i === index ? { ...element, x: real.boundView.page.width - 5 } : e))), 'notHidden');
    });

    it('never shows one with a fact squeezed into a box too narrow to show it', async () => {
      const { index, element } = factOf('totalAmount');
      await notShown(altered((elements) => elements.map((e, i) => (i === index ? { ...element, width: 20 } : e))), 'shownInFull');
    });

    it('never shows one with a picture laid under a fact', async () => {
      const { element } = factOf('totalAmount');
      const pixels = { width: 1, height: 1, encoding: 'rgba8-deflate' as const, data: deflateSync(Buffer.alloc(4, 255)).toString('base64') };
      await notShown(
        altered(
          (elements) => [{ type: 'image', image: 'cover', x: element.x, y: element.y - 20, width: 120, height: 26 }, ...elements],
          { images: { cover: pixels } },
        ),
        'notHidden',
      );
    });

    it('never shows one that leaves a key fact out', async () => {
      const { index } = factOf('totalAmount');
      await notShown(altered((elements) => elements.filter((_, i) => i !== index)), 'keyFacts');
    });
  });

  describe('binding what may not be bound', () => {
    it("refuses a fact drawn from the sender's metadata", async () => {
      const { index, element } = factOf('id');
      await refused(
        altered((elements) => elements.map((e, i) => (i === index ? { ...element, bind: { field: 'metadata.account' } } : e)), {}, { metadata: { account: '062-000 12345678' } }),
      );
    });

    it('refuses a fact drawn from the payment link', async () => {
      const { index, element } = factOf('id');
      await refused(
        altered(
          (elements) => elements.map((e, i) => (i === index ? { ...element, bind: { field: 'paymentLink.url' } } : e)),
          {},
          { paymentLink: { linkText: 'Pay', url: 'https://pay.example/1' } },
        ),
      );
    });

    it('refuses a fact drawn from a field the document does not carry', async () => {
      const { index, element } = factOf('dueAt');
      const { dueAt: _dueAt, ...withoutDue } = real;
      await refused({ ...withoutDue, boundView: { ...real.boundView, elements: real.boundView.elements.map((e, i) => (i === index ? element : e)) } });
    });
  });

  describe('pointing it at an address, or at anything but plain values', () => {
    it('refuses an element that names a URL', async () => {
      await refused(altered((elements) => [...elements, { type: 'rect', x: 0, y: 0, width: 1, height: 1, href: 'https://tracker.example/opened.png' } as unknown as Element]));
    });

    it('refuses a BoundView with a key of its own', async () => {
      await refused(altered((elements) => elements, { style: '@import url(https://tracker.example/x.css)' } as unknown as Partial<BTPBoundView>));
    });

    it('refuses a path with an arc or a relative command, which a renderer would have to interpret', async () => {
      await refused(altered((elements) => [...elements, { type: 'path', d: 'M0 0a5 5 0 1 0 10 10', fill: '#000000' }]));
    });

    it("refuses a template in a 1.2.0 artifact, where a document's look is its BoundView", async () => {
      const document = { ...real, template: { name: 'acme/classic', data: {} } };
      await refused(document);
      // The sender's own client refuses it before sending, too.
      const artifact = await artifactFrom(vendor, client.identity, 'BTPS_DOC', document, { encrypt: false });
      expect((await deliver(artifact)).error).toBeDefined();
    });
  });

  describe('making the receiver work without end', () => {
    it('refuses, at once, an image that would inflate to 64 MB, and keeps answering', async () => {
      const bomb = { width: 2, height: 2, encoding: 'rgba8-deflate' as const, data: deflateSync(Buffer.alloc(64 * 1024 * 1024)).toString('base64') };
      const page = real.boundView.page;
      const document = altered(
        (elements) => [...elements, { type: 'image', image: 'logo', x: page.width - 4, y: page.height - 4, width: 2, height: 2 }],
        { images: { logo: bomb } },
      );
      const { status, ms } = await send(document);
      expect(status).toMatchObject({ ok: false, error: BTP_ERROR_VALIDATION.code });
      expect(ms).toBeLessThan(2000);
      expect((await send(real)).status?.ok).toBe(true);
    }, 60_000);

    it('refuses a BoundView larger than 384 KiB', async () => {
      const filler: Element[] = Array.from({ length: 800 }, (_, i) => ({
        type: 'label',
        text: 'x'.repeat(500),
        x: 0,
        y: real.boundView.page.height + 50 + i,
        width: 10,
        align: 'start',
        font: Object.keys(real.boundView.fonts ?? {})[0] as string,
        size: 6,
        colour: '#000000',
      }));
      await refused(altered((elements) => [...elements, ...filler]));
    });

    it('does not show one too costly to check, answers quickly, and keeps serving others', async () => {
      // Curves under every fact, reaching down to y 1,777, each crossing every row of every
      // fact's box: within every limit (5 paths of under 20,000 characters, under 100,000
      // in all), yet costly to check.
      const curves = Array.from({ length: 1100 }, (_, i) => `C${i % 60} 0 ${i % 60} 4000 ${(i + 1) % 60} 0`).join('');
      const paths: Element[] = Array.from({ length: 5 }, () => ({ type: 'path', d: `M0 0${curves}Z`, fill: '#ffffff' }));
      // The dark facts again, three times, on a page four times as tall: more rows to check,
      // nothing hidden, every one still shown in full.
      const { page } = real.boundView;
      const again = [1, 2, 3].flatMap((copy) =>
        real.boundView.elements.flatMap((element) =>
          element.type === 'text' && element.colour !== '#ffffff' ? [{ ...element, y: element.y + copy * page.height }] : [],
        ),
      );
      const costly = altered((elements) => [...paths, ...elements, ...again], { page: { ...page, height: page.height * 4 } });
      const [heavy, light] = await Promise.all([send(costly), send(real)]);
      expect(heavy.status?.ok).toBe(true);
      expect(light.status?.ok).toBe(true);
      const result = told.get(heavy.artifact.id);
      expect(result?.show).toBe(false);
      expect(result && !result.show && result.problems.some(({ message }) => /too complex/.test(message))).toBe(true);
      expect(heavy.ms).toBeLessThan(5000);
    }, 60_000);
  });

  describe('slipping markup in', () => {
    it('draws a label holding <script> as the shapes of its letters, and nothing else', async () => {
      const font = Object.keys(real.boundView.fonts ?? {})[0] as string;
      const page = real.boundView.page;
      const document = altered((elements) => [
        ...elements,
        { type: 'label', text: '<script>alert(1)</script>', x: page.width - 200, y: page.height - 2, width: 190, align: 'start', font, size: 8, colour: '#000000' },
      ]);
      const { artifact, status } = await send(document);
      expect(status?.ok).toBe(true);
      expect(told.get(artifact.id)).toEqual({ show: true });
      const drawing = boundViewToSvg(document, document.boundView);
      expect(drawing).not.toMatch(/<script|<foreignObject|<text|javascript:|href="http/i);
      expect(await renderBoundView(document)).not.toBeNull();
    });
  });

  describe('what BTPS does not answer for', () => {
    it("shows a sender's own words that look like a payment detail, warns the sender, and binds nothing to them", async () => {
      const { view, warnings } = await browser.capture(previewInvoice, {
        extraHtml: '<div style="font-size:12px;padding:0 24px 12px">Pay to BSB 062-000 Account 1234 5678</div>',
      });
      expect(warnings.some((warning) => /looks like an account number/.test(warning))).toBe(true);
      const label = view?.elements.find((element) => element.type === 'label' && /062-000/.test(element.text));
      expect(label?.type).toBe('label');
      // A label is the sender's words, signed by the sender. The receiving app shows who that
      // verified sender is, outside the BoundView; BTPS does not claim the words are true.
      const { artifact, status } = await send({ ...previewInvoice, boundView: view });
      expect(status?.ok).toBe(true);
      expect(told.get(artifact.id)).toEqual({ show: true });
      expect(artifact.from).toBe(vendor.identity);
    });
  });
});
