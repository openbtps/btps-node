/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A checked BoundView as the drawing the engine reads (Rendering page): only
 * rectangles, paths and images, with numbers and colours that passed the
 * schema. Text arrives as glyph paths, each image as a PNG made here from its
 * checked pixels. No value from a canvas is copied in as markup.
 */

import { boundValue, writtenValue } from '@btps/sdk/boundview';
import type { BTPBoundView, BTPBoundViewElement, BTPBoundViewFont } from '@btps/sdk/boundview';
import bundled from './bundledGlyphs.json' with { type: 'json' };
import { pngOf } from './png.js';

type Paint = NonNullable<Extract<BTPBoundViewElement, { type: 'rect' }>['fill']>;
type TextLike = Extract<BTPBoundViewElement, { type: 'text' | 'label' }>;
type Doc = Record<string, unknown>;

const BUNDLED = bundled as Record<string, BTPBoundViewFont>;

/** What each fallback name is drawn with: the bundled font of that name, or the bundled one of that kind. */
const FALLBACK_FONT: Record<string, string> = {
  arimo: 'arimo',
  tinos: 'tinos',
  cousine: 'cousine',
  carlito: 'carlito',
  caladea: 'caladea',
  'sans-serif': 'arimo',
  serif: 'tinos',
  monospace: 'cousine',
};

/** A drawn signature's stroke, in units of its 1,000 by 300 canvas. */
export const SIGNATURE_STROKE = 8;

/** A number as the drawing writes it: finite, at most four decimals. */
const n = (value: number) => (Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '0');

/** A colour as `fill`/`stroke` and its opacity. Colours passed the schema: `#rrggbb` or `#rrggbbaa`. */
const colourOf = (colour: string): [string, number] => [
  colour.slice(0, 7),
  colour.length === 9 ? parseInt(colour.slice(7, 9), 16) / 255 : 1,
];

class Drawing {
  private defs: string[] = [];
  private parts: string[] = [];
  private gradients = 0;

  /** A paint as attributes: a colour with its opacity, or a gradient defined once. */
  paint(kind: 'fill' | 'stroke', paint: Paint | undefined): string {
    if (paint === undefined) return ` ${kind}="none"`;
    if (typeof paint === 'string') {
      const [hex, alpha] = colourOf(paint);
      return ` ${kind}="${hex}"${alpha < 1 ? ` ${kind}-opacity="${n(alpha)}"` : ''}`;
    }
    const id = `g${this.gradients++}`;
    const stops = ('linear' in paint ? paint.linear.stops : paint.radial.stops)
      .map(([offset, colour]) => {
        const [hex, alpha] = colourOf(colour);
        return `<stop offset="${n(offset)}" stop-color="${hex}" stop-opacity="${n(alpha)}"/>`;
      })
      .join('');
    if ('linear' in paint) {
      const { from, to } = paint.linear;
      this.defs.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(from[0])}" y1="${n(from[1])}" x2="${n(to[0])}" y2="${n(to[1])}">${stops}</linearGradient>`,
      );
    } else {
      const { centre, radius } = paint.radial;
      this.defs.push(
        `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(centre[0])}" cy="${n(centre[1])}" r="${n(radius)}">${stops}</radialGradient>`,
      );
    }
    return ` ${kind}="url(#${id})"`;
  }

  push(part: string) {
    this.parts.push(part);
  }

  toString(width: number, height: number, background: string) {
    const [hex, alpha] = colourOf(background);
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}">`,
      `<defs>${this.defs.join('')}</defs>`,
      `<rect width="${n(width)}" height="${n(height)}" fill="#ffffff"/>`,
      `<rect width="${n(width)}" height="${n(height)}" fill="${hex}" fill-opacity="${n(alpha)}"/>`,
      ...this.parts,
      '</svg>',
    ].join('');
  }
}

/** A rectangle with four radii, each clamped to half its shorter side, as an outline. */
const roundedRect = (x: number, y: number, w: number, h: number, radii: number[]) => {
  const limit = Math.min(w, h) / 2;
  const [a, b, c, d] = radii.map((r) => Math.min(r, limit)) as [number, number, number, number];
  return [
    `M${n(x + a)} ${n(y)}H${n(x + w - b)}`,
    b ? `A${n(b)} ${n(b)} 0 0 1 ${n(x + w)} ${n(y + b)}` : '',
    `V${n(y + h - c)}`,
    c ? `A${n(c)} ${n(c)} 0 0 1 ${n(x + w - c)} ${n(y + h)}` : '',
    `H${n(x + d)}`,
    d ? `A${n(d)} ${n(d)} 0 0 1 ${n(x)} ${n(y + h - d)}` : '',
    `V${n(y + a)}`,
    a ? `A${n(a)} ${n(a)} 0 0 1 ${n(x + a)} ${n(y)}` : '',
    'Z',
  ].join('');
};

/** The font a character is drawn with: its own font's glyph, or for a label, its first bundled fallback. */
const glyphFor = (font: BTPBoundViewFont, char: string, label: boolean) => {
  const own = font.glyphs?.[char];
  if (own !== undefined) return { glyph: own, font };
  if (!label) return undefined;
  for (const name of font.fallback ?? []) {
    const fallback = BUNDLED[FALLBACK_FONT[name] ?? ''];
    const glyph = fallback?.glyphs?.[char];
    if (fallback !== undefined && glyph !== undefined) return { glyph, font: fallback };
  }
  return undefined;
};

/** A line of text as glyph paths on its baseline, placed by its alignment, shrunk to fit a bound value's box. */
const drawText = (drawing: Drawing, element: TextLike, text: string, font: BTPBoundViewFont) => {
  const characters = [...text];
  const spacing = element.letterSpacing ?? 0;
  const widthAt = (size: number) =>
    characters.reduce((width, char, i) => {
      const found = glyphFor(font, char, element.type === 'label');
      if (found === undefined) return width + spacing;
      const scale = size / found.font.unitsPerEm;
      const kerning = found.font.kerning?.[`${char}${characters[i + 1] ?? ''}`] ?? 0;
      return width + (found.glyph.advance + kerning) * scale + spacing;
    }, 0);
  let size = element.size;
  if (element.type === 'text' && widthAt(size) > element.width) {
    // Width is linear in size apart from the letter spacing: the size that fits exactly, no smaller than the checks allow.
    const spaced = spacing * characters.length;
    const fit = ((element.width - spaced) / (widthAt(size) - spaced)) * size;
    size = Math.max(fit, Math.max(element.size * 0.75, 6));
  }
  const width = widthAt(size);
  let x = element.align === 'end' ? element.x + element.width - width : element.align === 'centre' ? element.x + (element.width - width) / 2 : element.x;
  const paths: string[] = [];
  characters.forEach((char, i) => {
    const found = glyphFor(font, char, element.type === 'label');
    if (found === undefined) {
      x += spacing;
      return;
    }
    const scale = size / found.font.unitsPerEm;
    if (found.glyph.path !== undefined) {
      paths.push(`<path transform="translate(${n(x)} ${n(element.y)}) scale(${n(scale)})" d="${found.glyph.path}"/>`);
    }
    const kerning = found.font.kerning?.[`${char}${characters[i + 1] ?? ''}`] ?? 0;
    x += (found.glyph.advance + kerning) * scale + spacing;
  });
  drawing.push(`<g fill="${element.colour}">${paths.join('')}</g>`);
};

const transformed = (text: string, transform?: 'uppercase' | 'lowercase') =>
  [...text]
    .map((char) => {
      if (transform === undefined) return char;
      const changed = transform === 'uppercase' ? char.toUpperCase() : char.toLowerCase();
      return [...changed].length === 1 ? changed : char;
    })
    .join('');

type Signature = { type: 'typed'; text: string } | { type: 'drawn'; strokes: number[][] };

/** A signature fitted to its box, keeping its proportions, centred: strokes, or text in Caveat. */
const drawSignature = (
  drawing: Drawing,
  box: { x: number; y: number; width: number; height: number; colour: string },
  signature: Signature,
) => {
  if (signature.type === 'drawn') {
    const scale = Math.min(box.width / 1000, box.height / 300);
    const left = box.x + (box.width - 1000 * scale) / 2;
    const top = box.y + (box.height - 300 * scale) / 2;
    const d = signature.strokes
      .map((stroke) =>
        stroke
          .reduce<string[]>((points, value, i) => {
            if (i % 2 === 0) points.push(`${points.length === 0 ? 'M' : 'L'}${n(left + value * scale)} `);
            else points[points.length - 1] += n(top + value * scale);
            return points;
          }, [])
          .join(''),
      )
      .join('');
    drawing.push(
      `<path d="${d}" fill="none" stroke="${box.colour}" stroke-width="${n(SIGNATURE_STROKE * scale)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    return;
  }
  const caveat = BUNDLED.caveat as BTPBoundViewFont;
  const characters = [...signature.text];
  const units = characters.reduce((width, char, i) => {
    const glyph = caveat.glyphs?.[char];
    return width + (glyph?.advance ?? 0) + (caveat.kerning?.[`${char}${characters[i + 1] ?? ''}`] ?? 0);
  }, 0);
  const tall = caveat.ascent + caveat.descent;
  const size = Math.min(units > 0 ? (box.width * caveat.unitsPerEm) / units : Infinity, (box.height * caveat.unitsPerEm) / tall);
  const scale = size / caveat.unitsPerEm;
  const baseline = box.y + (box.height - tall * scale) / 2 + caveat.ascent * scale;
  drawText(
    drawing,
    {
      type: 'label',
      text: signature.text,
      x: box.x,
      y: baseline,
      width: box.width,
      align: 'centre',
      font: 'caveat',
      size,
      colour: box.colour,
    },
    signature.text,
    caveat,
  );
};

/**
 * The drawing for a BoundView that passed every check, with each binding
 * filled from `document`. Never call it on one that did not: `renderBoundView`
 * checks first.
 */
export const boundViewToSvg = (document: Doc, view: BTPBoundView): string => {
  const drawing = new Drawing();
  for (const element of view.elements) {
    const opacity = 'opacity' in element && element.opacity !== undefined ? ` opacity="${n(element.opacity)}"` : '';
    switch (element.type) {
      case 'rect': {
        const radius = element.radius ?? 0;
        const radii = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
        const outline = roundedRect(element.x, element.y, element.width, element.height, radii);
        const stroke = element.stroke ? `${drawing.paint('stroke', element.stroke)} stroke-width="${n(element.strokeWidth ?? 0)}"` : '';
        drawing.push(`<path d="${outline}"${drawing.paint('fill', element.fill)}${stroke}${opacity}/>`);
        break;
      }
      case 'line': {
        const dash = element.dash ? ` stroke-dasharray="${n(element.dash[0])} ${n(element.dash[1])}"` : '';
        drawing.push(
          `<path d="M${n(element.from[0])} ${n(element.from[1])}L${n(element.to[0])} ${n(element.to[1])}" fill="none"${drawing.paint('stroke', element.stroke)} stroke-width="${n(element.strokeWidth)}" stroke-linecap="butt"${dash}${opacity}/>`,
        );
        break;
      }
      case 'path': {
        const stroke = element.stroke ? `${drawing.paint('stroke', element.stroke)} stroke-width="${n(element.strokeWidth ?? 0)}"` : '';
        drawing.push(
          `<path d="${element.d}" fill-rule="${element.fillRule ?? 'nonzero'}"${drawing.paint('fill', element.fill)}${stroke}${opacity}/>`,
        );
        break;
      }
      case 'image': {
        const image = view.images?.[element.image];
        if (image === undefined) break;
        drawing.push(
          `<image x="${n(element.x)}" y="${n(element.y)}" width="${n(element.width)}" height="${n(element.height)}" preserveAspectRatio="none" href="data:image/png;base64,${pngOf(image)}"${opacity}/>`,
        );
        break;
      }
      case 'text': {
        const font = view.fonts?.[element.font];
        const value = boundValue(document, element.bind.field);
        if (font === undefined || value === undefined) break;
        drawText(drawing, element, transformed(writtenValue(value, element.bind), element.transform), font);
        break;
      }
      case 'label': {
        const font = view.fonts?.[element.font];
        if (font !== undefined) drawText(drawing, element, transformed(element.text, element.transform), font);
        break;
      }
      case 'signature': {
        const signatory = document.signatory as { visualSignature?: Signature } | undefined;
        if (signatory?.visualSignature) drawSignature(drawing, element, signatory.visualSignature);
        break;
      }
    }
  }
  return drawing.toString(view.page.width, view.page.height, view.page.background ?? '#ffffff');
};
