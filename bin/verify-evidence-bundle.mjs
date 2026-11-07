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
 * never a verdict. The keys are the bundle's own, not confirmed online: it
 * prints each one's fingerprint for a reader to check.
 *
 *   npx -p @btps/sdk btps-verify-evidence <bundle.json> [--json] [--timestamp-root <ca.pem>]...
 *
 *   --json                    print the facts as JSON instead of text
 *   --timestamp-root <file>   a PEM certificate whose timestamps you trust; repeat for more
 *
 * Exit codes: 0 the agreement is complete, 1 it is not (see the facts),
 * 2 the file could not be read or is not an evidence bundle. A timestamp is
 * reported and never changes the exit code.
 */

import fs from 'node:fs';
import { describeEvidenceFacts, verifyEvidenceBundle } from '@btps/sdk/trust';

const args = process.argv.slice(2);
const roots = [];
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--timestamp-root') roots.push(args[++i]);
  else rest.push(args[i]);
}
const file = rest.find((arg) => !arg.startsWith('--'));
if (!file || roots.includes(undefined)) {
  console.error(
    'usage: btps-verify-evidence <bundle.json> [--json] [--timestamp-root <ca.pem>]...',
  );
  process.exit(2);
}

let facts;
try {
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const trustedTimestampRoots = roots.map((root) => fs.readFileSync(root, 'utf8'));
  facts = await verifyEvidenceBundle(bundle, roots.length ? { trustedTimestampRoots } : {});
} catch (error) {
  const cause = error?.cause ? `: ${error.cause}` : '';
  console.error(`${file}: ${error?.message ?? error}${cause}`);
  process.exit(2);
}
console.log(
  args.includes('--json') ? JSON.stringify(facts, null, 2) : describeEvidenceFacts(facts),
);
process.exit(facts.complete ? 0 : 1);
