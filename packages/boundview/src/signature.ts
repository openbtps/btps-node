/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A drawn signature, by one rule: the engine draws it in a BoundView by it,
 * and a platform shows `signatureSvg` on its page, so the two cannot differ
 * whatever the strokes are. On its 1,000 by 300 canvas, each stroke's points
 * in order, a point repeated at once counted once; a stroke of one point is a
 * disc as wide as the pen, any other a line through its points, the pen
 * SIGNATURE_STROKE wide with round ends and joins. Nothing else is read from
 * a stroke, and nothing of a page's markup is taken in.
 */

/** The pen's width, in units of the 1,000 by 300 canvas; a dot is this wide. */
export const SIGNATURE_STROKE = 8;

/** A number as a drawing writes it: finite, at most four decimals. */
export const n = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '0';

/** A stroke's points as pairs, in order, a point repeated at once counted once. */
const pointsOf = (stroke: readonly number[]): [number, number][] => {
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < stroke.length; i += 2) {
    const point: [number, number] = [stroke[i] as number, stroke[i + 1] as number];
    const last = points.at(-1);
    if (last === undefined || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
  }
  return points;
};

/** A drawn signature's shapes, each attribute as the drawing writes it: a disc for each dot, one path through the rest. */
export interface SignatureDrawing {
  dots: { cx: string; cy: string; r: string }[];
  line: { d: string; strokeWidth: string } | null;
}

/**
 * The shapes of `strokes`, each canvas point placed by `at`, the pen `scale` times its canvas width: a disc for each
 * stroke of one point, then one path through every other. Everything that draws a signature is made from it.
 */
const drawingOf = (
  strokes: readonly (readonly number[])[],
  at: (x: number, y: number) => [number, number],
  scale: number,
): SignatureDrawing => {
  const dots: SignatureDrawing['dots'] = [];
  const lines: string[] = [];
  for (const stroke of strokes) {
    const points = pointsOf(stroke).map(([x, y]) => at(x, y));
    const [first] = points;
    if (first === undefined) continue;
    if (points.length === 1)
      dots.push({ cx: n(first[0]), cy: n(first[1]), r: n((SIGNATURE_STROKE * scale) / 2) });
    else lines.push(points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${n(x)} ${n(y)}`).join(''));
  }
  return {
    dots,
    line: lines.length > 0 ? { d: lines.join(''), strokeWidth: n(SIGNATURE_STROKE * scale) } : null,
  };
};

/**
 * A drawn signature as a platform shows it on its page, on the 1,000 by 300 canvas (viewBox "0 0 1000 300"): a circle for
 * each of `dots`, then `line` as a path with no fill, round caps and joins, all in the ink of the page. Drawn so, a
 * snapshot finds it as the signature, and the engine draws it the same.
 */
export const signatureDrawing = (strokes: readonly (readonly number[])[]): SignatureDrawing =>
  drawingOf(strokes, (x, y) => [x, y], 1);

/** The same as SVG markup, fitted as `at` and `scale` place it, in `colour`: what the engine draws. */
export const signatureShapes = (
  strokes: readonly (readonly number[])[],
  at: (x: number, y: number) => [number, number],
  scale: number,
  colour: string,
): string[] => {
  const { dots, line } = drawingOf(strokes, at, scale);
  const shapes = dots.map(
    ({ cx, cy, r }) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colour}"/>`,
  );
  if (line) {
    shapes.push(
      `<path d="${line.d}" fill="none" stroke="${colour}" stroke-width="${line.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  return shapes;
};

/** The same as a whole SVG on its canvas, `colour` its ink (the page's text colour by default). */
export const signatureSvg = (
  strokes: readonly (readonly number[])[],
  colour = 'currentColor',
): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 300">${signatureShapes(strokes, (x, y) => [x, y], 1, colour).join('')}</svg>`;
