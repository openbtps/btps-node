/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * The fonts the renderer bundles, as glyph tables: the five a label may fall
 * back to, and Caveat for a typed signature. Each is its own module, imported
 * only when a drawing uses it, so an app's bundler puts each in a chunk of its
 * own and a reader downloads only those it needs.
 */

import type { BTPBoundView, BTPBoundViewFont } from '@btps/sdk/boundview';

export type BundledFontName = 'arimo' | 'tinos' | 'cousine' | 'carlito' | 'caladea' | 'caveat';
export type BundledFonts = Partial<Record<BundledFontName, BTPBoundViewFont>>;

type Table = { default: BTPBoundViewFont };

const LOADERS: Record<BundledFontName, () => Promise<Table>> = {
  arimo: () => import('./glyphs/arimo.json', { with: { type: 'json' } }) as Promise<Table>,
  tinos: () => import('./glyphs/tinos.json', { with: { type: 'json' } }) as Promise<Table>,
  cousine: () => import('./glyphs/cousine.json', { with: { type: 'json' } }) as Promise<Table>,
  carlito: () => import('./glyphs/carlito.json', { with: { type: 'json' } }) as Promise<Table>,
  caladea: () => import('./glyphs/caladea.json', { with: { type: 'json' } }) as Promise<Table>,
  caveat: () => import('./glyphs/caveat.json', { with: { type: 'json' } }) as Promise<Table>,
};

/** What each fallback name is drawn with: the bundled font of that name, or the bundled one of that kind. */
export const FALLBACK_FONT: Record<string, BundledFontName> = {
  arimo: 'arimo',
  tinos: 'tinos',
  cousine: 'cousine',
  carlito: 'carlito',
  caladea: 'caladea',
  'sans-serif': 'arimo',
  serif: 'tinos',
  monospace: 'cousine',
};

/** The bundled fonts named, each loaded once. */
export const loadBundledFonts = async (names: Iterable<BundledFontName>): Promise<BundledFonts> =>
  Object.fromEntries(
    await Promise.all([...new Set(names)].map(async (name) => [name, (await LOADERS[name]()).default] as const)),
  );

const transformed = (text: string, transform?: 'uppercase' | 'lowercase') =>
  transform === 'uppercase' ? text.toUpperCase() : transform === 'lowercase' ? text.toLowerCase() : text;

/**
 * The bundled fonts a BoundView needs to be drawn: a label's fallbacks, when
 * a character of it has no glyph in its own font, and Caveat for a typed
 * signature. Most BoundViews need none.
 */
export const bundledFontsFor = (document: Record<string, unknown>, view: BTPBoundView): BundledFontName[] => {
  const names = new Set<BundledFontName>();
  for (const element of view.elements) {
    if (element.type === 'label') {
      const font = view.fonts?.[element.font];
      const missing = [...transformed(element.text, element.transform)].some((char) => font?.glyphs?.[char] === undefined);
      if (missing) {
        for (const name of font?.fallback ?? []) {
          const bundled = FALLBACK_FONT[name];
          if (bundled) names.add(bundled);
        }
      }
    }
    if (element.type === 'signature') {
      const signatory = document.signatory as { visualSignature?: { type?: string } } | undefined;
      if (signatory?.visualSignature?.type === 'typed') names.add('caveat');
    }
  }
  return [...names];
};
