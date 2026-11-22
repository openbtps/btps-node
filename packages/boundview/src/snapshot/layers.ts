/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Transforms and paint order. The page is measured with its CSS transforms
 * set aside (a transform never moves anything else), and each element's
 * transform kept as a matrix on the page: its shapes, images and words are
 * then carried through that matrix, as the browser carries them. And the
 * order the browser paints in: what is positioned (absolute, relative, fixed,
 * sticky) paints after the page's own boxes and text, in its own order.
 */

import { normalizePath, pathData, type Matrix } from './svgPath.js';

export type Flat = {
  /** The element's transform on the page, its ancestors' included; undefined where none. */
  matrixOf: (element: Element) => DOMMatrix | undefined;
  /** The outermost positioned element it is in (the page's own root aside): it paints after the page's text. */
  groupOf: (element: Element) => Element | undefined;
  /** Puts every transform back. */
  restore: () => void;
};

const PROPERTIES = ['transform', 'translate', 'rotate', 'scale'] as const;

const length = (value: string, of: number) => (value.endsWith('%') ? (parseFloat(value) / 100) * of : parseFloat(value) || 0);

/** Sets the page's transforms aside, keeping each as a matrix about its origin, in the page's coordinates. */
export const flatten = (root: HTMLElement): Flat => {
  const found = new Map<Element, Record<(typeof PROPERTIES)[number] | 'origin', string>>();
  for (const element of root.querySelectorAll('*')) {
    // An SVG's own transforms are its drawing's (its outlines carry them); its box's transform is the page's.
    if (element.closest('svg') && element.tagName.toLowerCase() !== 'svg') continue;
    const css = getComputedStyle(element);
    if (PROPERTIES.every((property) => css[property] === 'none' || css[property] === '')) continue;
    found.set(element, { transform: css.transform, translate: css.translate, rotate: css.rotate, scale: css.scale, origin: css.transformOrigin });
  }
  const saved: [HTMLElement, string, string, string][] = [];
  for (const element of found.keys()) {
    const style = (element as HTMLElement).style;
    for (const property of PROPERTIES) {
      saved.push([element as HTMLElement, property, style.getPropertyValue(property), style.getPropertyPriority(property)]);
      style.setProperty(property, 'none', 'important');
    }
  }
  const page = root.getBoundingClientRect();
  const local = new Map<Element, DOMMatrix>();
  for (const [element, values] of found) {
    const rect = element.getBoundingClientRect();
    const [ox = '0', oy = '0'] = values.origin.split(/\s+/);
    const cx = rect.left - page.left + length(ox, rect.width);
    const cy = rect.top - page.top + length(oy, rect.height);
    // CSS's order: translate, rotate, scale, then transform.
    let m = new DOMMatrix();
    if (values.translate && values.translate !== 'none') {
      const [tx = '0', ty = '0'] = values.translate.split(/\s+/);
      m = m.translate(length(tx, rect.width), length(ty, rect.height));
    }
    if (values.rotate && values.rotate !== 'none') {
      const parts = values.rotate.split(/\s+/);
      const angle = parts.at(-1) ?? '0deg';
      const degrees = angle.endsWith('turn') ? parseFloat(angle) * 360 : angle.endsWith('rad') ? (parseFloat(angle) * 180) / Math.PI : parseFloat(angle);
      // About an axis, as `rotate: y 25deg` or `rotate: 1 1 0 30deg` give one; about z, the page's own, otherwise.
      const named: Record<string, [number, number, number]> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
      const [ax, ay, az] = parts.length === 2 ? (named[parts[0] as string] ?? [0, 0, 1]) : parts.length === 4 ? parts.slice(0, 3).map(Number) : [0, 0, 1];
      m = m.rotateAxisAngle(ax, ay, az, degrees);
    }
    if (values.scale && values.scale !== 'none') {
      const [sx = 1, sy = sx] = values.scale.split(/\s+/).map(Number);
      m = m.scale(sx, sy);
    }
    if (values.transform && values.transform !== 'none') m = m.multiply(new DOMMatrix(values.transform));
    // A 3D transform drawn flat: its 2D part, taken before the origin is placed, so its perspective is dropped rather
    // than mixed into where and how big the element is drawn.
    const flat = new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
    local.set(element, new DOMMatrix().translate(cx, cy).multiply(flat).translate(-cx, -cy));
  }
  const matrices = new Map<Element, DOMMatrix | undefined>();
  const matrixOf = (element: Element): DOMMatrix | undefined => {
    if (element === root || !root.contains(element)) return undefined;
    if (matrices.has(element)) return matrices.get(element);
    const parent = element.parentElement ? matrixOf(element.parentElement) : undefined;
    const own = local.get(element);
    const m = own ? (parent ? parent.multiply(own) : own) : parent;
    matrices.set(element, m);
    return m;
  };
  const groups = new Map<Element, Element | undefined>();
  const groupOf = (element: Element): Element | undefined => {
    if (element === root || !root.contains(element)) return undefined;
    if (groups.has(element)) return groups.get(element);
    const outer = element.parentElement ? groupOf(element.parentElement) : undefined;
    const group = outer ?? (getComputedStyle(element).position !== 'static' ? element : undefined);
    groups.set(element, group);
    return group;
  };
  return {
    matrixOf,
    groupOf,
    restore: () => {
      for (const [element, property, value, priority] of saved) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    },
  };
};

/**
 * ::before and ::after made real while the page is measured: each a span with the pseudo-element's own computed style
 * and content, where the browser put it, the pseudo-element itself hidden. The layout is the same; its box and its
 * text are then read like any other. Content that is strings and attr() is made; a counter or an image is left as it is.
 */
export const materialize = (root: HTMLElement): (() => void) => {
  const made: { span: HTMLElement; host: Element }[] = [];
  const marker = 'data-bv-pseudo';
  for (const host of [root, ...root.querySelectorAll('*')]) {
    if (host.closest('svg') || ['img', 'input', 'textarea', 'select', 'br', 'hr'].includes(host.tagName.toLowerCase())) continue;
    for (const which of ['::before', '::after'] as const) {
      const css = getComputedStyle(host, which);
      const content = css.content;
      if (!content || content === 'none' || content === 'normal') continue;
      // "a" "b" attr(x): joined; anything else (counter(), url(), quotes) is left to the browser alone.
      let text = '';
      let readable = true;
      for (const [, quoted, attr] of content.matchAll(/"((?:[^"\\]|\\.)*)"|attr\(([\w-]+)\)|\S+/g)) {
        if (quoted !== undefined) text += quoted.replace(/\\(.)/g, '$1');
        else if (attr !== undefined) text += host.getAttribute(attr) ?? '';
        else readable = false;
      }
      if (!readable) continue;
      const span = document.createElement('span');
      span.setAttribute(marker, which);
      // Every computed property, so the span is laid out and painted as the pseudo-element was.
      let style = '';
      for (let i = 0; i < css.length; i++) {
        const property = css[i] as string;
        style += `${property}:${css.getPropertyValue(property)}!important;`;
      }
      span.style.cssText = style;
      span.textContent = text;
      host.setAttribute(`${marker}-${which.slice(2)}`, '');
      if (which === '::before') host.insertBefore(span, host.firstChild);
      else host.appendChild(span);
      made.push({ span, host });
    }
  }
  // ::first-letter: where it is styled apart from its block, the letter wrapped in a span with its style, and the
  // pseudo-element made to take that span's style (so nothing is applied twice).
  const letters: { span: HTMLElement; text: Text; host: Element }[] = [];
  // Only what the letter inherits can differ from its block without a rule of its own; a float is its own.
  const LETTER = ['fontSize', 'fontWeight', 'fontStyle', 'fontFamily', 'color', 'textTransform', 'letterSpacing'] as const;
  for (const host of [root, ...root.querySelectorAll('*')]) {
    if (host.closest('svg') || getComputedStyle(host).display.startsWith('inline')) continue;
    const own = getComputedStyle(host);
    const letter = getComputedStyle(host, '::first-letter');
    if (LETTER.every((key) => letter[key] === own[key]) && letter.float === 'none') continue;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let text: Text | undefined;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.trim()) {
        text = node as Text;
        break;
      }
    }
    if (!text?.parentElement || text.parentElement.closest(`[${marker}]`)) continue;
    const at = text.textContent?.search(/\S/) ?? 0;
    // The letter and the punctuation before it, as ::first-letter takes them.
    const first = /^[\p{P}]*\S/u.exec((text.textContent ?? '').slice(at))?.[0] ?? '';
    if (!first) continue;
    const rest = text.splitText(at);
    rest.splitText(first.length);
    const span = document.createElement('span');
    span.setAttribute(`${marker}-letter`, '');
    let style = '';
    for (let i = 0; i < letter.length; i++) {
      const property = letter[i] as string;
      style += `${property}:${letter.getPropertyValue(property)}!important;`;
    }
    span.style.cssText = style;
    rest.replaceWith(span);
    span.appendChild(rest);
    host.setAttribute(`${marker}-first`, '');
    letters.push({ span, text, host });
  }
  if (made.length === 0 && letters.length === 0) return () => undefined;
  const sheet = document.createElement('style');
  sheet.textContent =
    `[${marker}-before]::before,[${marker}-after]::after{content:none!important;display:none!important}` +
    `[${marker}-first]::first-letter{font:inherit!important;color:inherit!important;float:none!important;line-height:inherit!important;` +
    `vertical-align:inherit!important;background:transparent!important;text-transform:inherit!important;letter-spacing:inherit!important;` +
    `margin:0!important;padding:0!important;border:0!important}`;
  document.head.appendChild(sheet);
  return () => {
    for (const { span, host } of made) {
      span.remove();
      host.removeAttribute(`${marker}-before`);
      host.removeAttribute(`${marker}-after`);
    }
    for (const { span, text, host } of letters) {
      // The letter back in its text, as it was.
      const letterText = span.firstChild as Text | null;
      span.replaceWith(...(letterText ? [letterText] : []));
      host.removeAttribute(`${marker}-first`);
      text.parentElement?.normalize();
    }
    sheet.remove();
  };
};

export const isIdentity =(m: DOMMatrix | undefined) =>
  !m || (Math.abs(m.a - 1) < 1e-6 && Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6 && Math.abs(m.d - 1) < 1e-6 && Math.abs(m.e) < 1e-3 && Math.abs(m.f) < 1e-3);

/** Upright: moved and scaled the same both ways, never turned or slanted (what a fact may be). */
export const isUpright = (m: DOMMatrix) => Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6 && m.a > 0 && Math.abs(m.a - m.d) < 1e-6;

export const asMatrix = (m: DOMMatrix): Matrix => [m.a, m.b, m.c, m.d, m.e, m.f];

/** Path data through a matrix. */
export const transformPath = (d: string, m: DOMMatrix): string | undefined => {
  const commands = normalizePath(d);
  return commands ? pathData(commands, asMatrix(m)) : undefined;
};

/** How much a matrix scales lengths, on average: a stroke's width through it. */
export const scaleOf = (m: DOMMatrix) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));

export const apply = (m: DOMMatrix, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
