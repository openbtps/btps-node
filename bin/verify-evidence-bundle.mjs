#!/usr/bin/env node
/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * btps-verify-evidence: check a BTPS agreement's evidence bundle offline, with
 * no provider and no network, and print what it shows. It reports facts,
 * never a verdict.
 *
 *   npx -p @btps/sdk btps-verify-evidence <bundle.json> [--json]
 *
 *   --json   print the facts as JSON instead of text
 *
 * Exit codes: 0 the agreement is complete, 1 it is not (see the facts),
 * 2 the file could not be read or is not an evidence bundle.
 */

import fs from 'node:fs';
import { describeEvidenceFacts, verifyEvidenceBundle } from '@btps/sdk/trust';

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--'));
if (!file) {
  console.error('usage: btps-verify-evidence <bundle.json> [--json]');
  process.exit(2);
}

let facts;
try {
  facts = await verifyEvidenceBundle(JSON.parse(fs.readFileSync(file, 'utf8')));
} catch (error) {
  const cause = error?.cause ? `: ${error.cause}` : '';
  console.error(`${file}: ${error?.message ?? error}${cause}`);
  process.exit(2);
}
console.log(
  args.includes('--json') ? JSON.stringify(facts, null, 2) : describeEvidenceFacts(facts),
);
process.exit(facts.complete ? 0 : 1);
