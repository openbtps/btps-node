/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Every JSON example in the "What's new in 1.2" guides is what the SDK takes:
 * each names what it is in its code fence (```json btps=<kind>) and is checked
 * against that schema, so a guide cannot show an artifact a server refuses.
 * A JSON example that names nothing fails the test.
 *
 *   transporter, agent, response, bundle  the artifact or file itself
 *   permissions                           a trust record's `permissions`
 *   record                                a trust record
 *   document:<TYPE>                       an opened document of that artifact type, under 1.2.0
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { z } from 'zod';
import {
  BtpTransporterArtifactSchema,
  BtpTrustRecordPermissionsSchema,
} from '../src/core/server/schemas/artifacts/transporterSchema.js';
import { BtpAgentArtifactSchema } from '../src/core/server/schemas/artifacts/agentSchema.js';
import {
  BtpServerResponseSchema,
  BtpTrustRecordSchema,
} from '../src/core/server/schemas/responseSchema.js';
import { BtpEvidenceBundleSchema } from '../src/core/server/schemas/btpsDocsSchema.js';
import { processBtpDocSchema } from '../src/core/server/schemas/helpers.js';
import type { BTPArtifactType } from '../src/core/server/types.js';

const DIR = path.resolve(__dirname, '../docs/docusaurus/docs/whats-new');

const schemaFor = (kind: string): z.ZodTypeAny => {
  if (kind.startsWith('document:')) {
    const schema = processBtpDocSchema(kind.slice('document:'.length) as BTPArtifactType, '1.2.0');
    if (!schema) throw new Error(`no document schema for btps=${kind}`);
    return schema;
  }
  const schemas: Record<string, z.ZodTypeAny> = {
    transporter: BtpTransporterArtifactSchema,
    agent: BtpAgentArtifactSchema,
    response: BtpServerResponseSchema,
    bundle: BtpEvidenceBundleSchema,
    permissions: BtpTrustRecordPermissionsSchema,
    record: BtpTrustRecordSchema,
  };
  const schema = schemas[kind];
  if (!schema) throw new Error(`no schema for btps=${kind}`);
  return schema;
};

type Example = { page: string; line: number; kind?: string; json: string };

const examples: Example[] = fs
  .readdirSync(DIR)
  .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
  .flatMap((page) => {
    const text = fs.readFileSync(path.join(DIR, page), 'utf8');
    const found: Example[] = [];
    const fence = /^```json([^\n]*)\n([\s\S]*?)^```/gm;
    for (let match = fence.exec(text); match; match = fence.exec(text)) {
      const kind = /btps=(\S+)/.exec(match[1] ?? '')?.[1];
      const line = text.slice(0, match.index).split('\n').length;
      found.push({ page, line, kind, json: match[2] ?? '' });
    }
    return found;
  });

describe("the What's new in 1.2 guides", () => {
  it('have examples to check', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples.map((e) => [`${e.page}:${e.line} (${e.kind ?? 'no kind'})`, e] as const))(
    '%s is what the SDK takes',
    (_name, example) => {
      expect(example.kind, 'every JSON example names what it is: ```json btps=<kind>').toBeDefined();
      const value = JSON.parse(example.json);
      const result = schemaFor(example.kind!).safeParse(value);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
  );
});
