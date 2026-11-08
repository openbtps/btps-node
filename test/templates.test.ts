/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: the template file, format 1. The JSON Schema published with the
 * docs is the format, with one rule beside it (contrast); the golden vectors
 * are what any implementation must accept and refuse with them. The SDK
 * renders no template, so this checks the rules and the vectors against each
 * other.
 */

import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { canonicalizeValue } from '../src/core/crypto/jcs.js';

type Page = { background: string; text: string; muted: string; accent: string };
type Case = {
  name: string;
  template: { page: Page };
  expect: 'accept' | 'refuse';
  check?: 'schema' | 'contrast';
  why?: string;
};

const read = (file: string): unknown =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'));

const schema = read('docs/docusaurus/static/schemas/btps-template.schema.json') as object;
const vectors = read('test/vectors/templates.vectors.json') as {
  fingerprint: { template: unknown; canonical: string; sha256: string };
  cases: Case[];
};

/** The WCAG 2 relative luminance of a #rrggbb colour. */
const luminance = (hex: string): number => {
  const channel = (at: number): number => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};
const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};
const readable = ({ background, text, muted, accent }: Page): boolean =>
  contrast(text, background) >= 4.5 &&
  contrast(muted, background) >= 4.5 &&
  contrast(accent, background) >= 3;

describe('the template format', () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(schema);

  it('is a valid JSON Schema', () => {
    expect(ajv.validateSchema(schema)).toBe(true);
  });

  it('is fingerprinted by the SHA-256 of its canonical form', () => {
    const { template, canonical, sha256 } = vectors.fingerprint;
    expect(canonicalizeValue(template)).toBe(canonical);
    expect(crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')).toBe(sha256);
  });

  for (const c of vectors.cases) {
    it(`${c.expect}s ${c.name}${c.why ? `: ${c.why}` : ''}`, () => {
      const valid = validate(c.template);
      if (c.expect === 'accept') {
        expect(valid).toBe(true);
        expect(readable(c.template.page)).toBe(true);
      } else if (c.check === 'contrast') {
        expect(valid).toBe(true);
        expect(readable(c.template.page)).toBe(false);
      } else {
        expect(valid).toBe(false);
      }
    });
  }
});
