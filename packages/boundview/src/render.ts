/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Drawing a received BoundView (Rendering page). One engine, resvg and its
 * rasterizer tiny-skia, compiled to WebAssembly: the same code in a browser,
 * on a server and in an app. It is handed no network, no files and no fonts;
 * it reads the drawing made from checked values and gives back a PNG.
 */

import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { boundViewResultOf } from '@btps/sdk/client';
import type { BTPBoundView } from '@btps/sdk/server';
import { boundViewToSvg } from './svg.js';

/** What the engine's WebAssembly is loaded from: its bytes, a compiled module, a URL or a fetch response. */
export type BoundViewEngineSource = Parameters<typeof initWasm>[0];

let engine: Promise<void> | undefined;

/**
 * Loads the drawing engine once. In Node it is read from the package by
 * default; in a browser or app, pass where the app serves
 * `@resvg/resvg-wasm/index_bg.wasm` from.
 */
export const initBoundViewEngine = (source?: BoundViewEngineSource): Promise<void> => {
  engine ??= (async () => {
    if (source !== undefined) return initWasm(source);
    const [{ readFile }, { createRequire }] = await Promise.all([import('node:fs/promises'), import('node:module')]);
    const wasm = createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm');
    return initWasm(await readFile(wasm));
  })();
  return engine;
};

/**
 * An opened document's BoundView as a PNG at `scale` (2 for high-resolution
 * screens), or null when it carries none or fails a check: then the app
 * shows its own view of the signed data.
 */
export const renderBoundView = async (
  document: unknown,
  { scale = 2 }: { scale?: number } = {},
): Promise<Uint8Array | null> => {
  const result = boundViewResultOf(document);
  if (result === undefined || !result.show) return null;
  await initBoundViewEngine();
  const doc = document as Record<string, unknown> & { boundView: BTPBoundView };
  const resvg = new Resvg(boundViewToSvg(doc, doc.boundView), {
    fitTo: { mode: 'zoom', value: scale },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
};
