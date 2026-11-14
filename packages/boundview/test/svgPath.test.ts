/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * An SVG logo's outlines rewritten as the absolute commands a BoundView path
 * takes, and placed on the page.
 */

import { describe, expect, it } from 'vitest';
import { isPathData } from '@btps/sdk/boundview';
import { normalizePath, pathData, shapeOutline, type Matrix } from '../src/snapshot/svgPath.js';

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const written = (d: string, matrix = IDENTITY) => pathData(normalizePath(d) ?? [], matrix);

describe("an SVG logo's outlines", () => {
  it('rewrites relative commands, H and V as absolute lines', () => {
    expect(written('m10 10 h20 v5 l-5 5 z')).toBe('M10 10L30 10L30 15L25 20Z');
    expect(written('M0,0 10,0 10,10')).toBe('M0 0L10 0L10 10');
  });

  it('reflects smooth curves, and turns an arc into cubic curves on the same circle', () => {
    expect(written('M0 0C0 10 10 10 10 0S20 -10 20 0')).toBe('M0 0C0 10 10 10 10 0C10 -10 20 -10 20 0');
    expect(written('M0 0Q5 10 10 0T20 0')).toBe('M0 0Q5 10 10 0Q15 -10 20 0');
    const arc = normalizePath('M0 10A10 10 0 0 1 20 10') ?? [];
    expect(arc.map(({ type }) => type)).toEqual(['M', 'C', 'C']);
    // The half circle's top is at (10, 0).
    expect(written('M0 10A10 10 0 0 1 20 10')).toMatch(/C\S+ \S+ \S+ \S+ 10 0C/);
  });

  it('places every point by its transform, two decimals at most', () => {
    expect(written('M0 0L1 1', [2, 0, 0, 2, 5, 5])).toBe('M5 5L7 7');
    expect(written('M0 0L1 0', [0.333333, 0, 0, 1, 0.123456, 0])).toBe('M0.12 0L0.46 0');
  });

  it("gives outlines a receiver accepts, for every basic shape", () => {
    const attrs: Record<string, number> = { x: 1, y: 2, width: 30, height: 20, rx: 4, cx: 15, cy: 15, r: 10, ry: 5, x1: 0, y1: 0, x2: 9, y2: 9 };
    for (const tag of ['rect', 'circle', 'ellipse', 'line']) {
      const d = shapeOutline(tag, (name) => attrs[name] ?? 0) as string;
      expect(isPathData(written(d))).toBe(true);
    }
    expect(shapeOutline('text', () => 0)).toBeUndefined();
  });

  it('refuses path data it cannot read', () => {
    expect(normalizePath('10 10')).toBeUndefined();
    expect(normalizePath('M0 0 L')).toBeUndefined();
    expect(normalizePath('M0 0 X5 5')).toBeUndefined();
  });
});
