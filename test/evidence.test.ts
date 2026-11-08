/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: the evidence bundle's published JSON Schema takes every bundle in
 * the golden vectors, as the SDK's own schema does, and refuses one that is
 * not a bundle. Its signatures, hashes and order are verifyEvidenceBundle's.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { BtpEvidenceBundleSchema } from '../src/core/server/schemas/btpsDocsSchema.js';

const read = (file: string): unknown =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'));

const schema = read('docs/docusaurus/static/schemas/btps-evidence.schema.json') as object;
const { bundles } = read('test/vectors/agreements.vectors.json') as {
  bundles: { name: string; bundle: Record<string, unknown> }[];
};

describe('the evidence bundle format', () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  const validate = ajv.compile(schema);

  it.each(bundles.map((c) => [c.name, c.bundle] as const))('takes %s', (_name, bundle) => {
    expect(validate(bundle), JSON.stringify(validate.errors)).toBe(true);
    expect(BtpEvidenceBundleSchema.safeParse(bundle).success).toBe(true);
  });

  it('refuses one of another format, one without its originator, and a record signed both ways', () => {
    const [first] = bundles;
    const bundle = first?.bundle ?? {};
    const statements = bundle.statements as { selector?: string }[];
    const bothWays = {
      ...bundle,
      statements: [{ ...statements[0], delegatedArtifact: { from: 'a$b.example' } }],
    };
    for (const wrong of [
      { ...bundle, format: 'btps-evidence/2' },
      { ...bundle, originator: undefined },
      bothWays,
    ]) {
      const json = JSON.parse(JSON.stringify(wrong));
      expect(validate(json)).toBe(false);
      expect(BtpEvidenceBundleSchema.safeParse(json).success).toBe(false);
    }
  });
});
