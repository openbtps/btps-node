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
 *     [--anchor <fingerprint>]... [--online <your-identity>]
 *
 *   --json                    print the facts as JSON instead of text
 *   --timestamp-root <file>   a PEM certificate whose timestamps you trust; repeat for more
 *   --anchor <fingerprint>    since 1.2: a key fingerprint you kept, as an identity's
 *                             key when you saw it; repeat for more
 *   --online <identity>       since 1.2: also confirm each key now as its identity's: a key
 *                             of its identity's chain from its host (asked as this identity),
 *                             anchored on DNS, or its DNS key. Only this confirms keys online
 *
 * Exit codes: 0 the agreement is complete, 1 it is not (see the facts),
 * 2 the file could not be read or is not an evidence bundle. A timestamp, a
 * key chain fact and an online check are reported and never change the exit code.
 */

import fs from 'node:fs';
import { describeEvidenceFacts, verifyEvidenceBundle } from '@btps/sdk/trust';
import { createDefaultKeyResolver } from '@btps/sdk/crypto';

const USAGE =
  'usage: btps-verify-evidence <bundle.json> [--json] [--timestamp-root <ca.pem>]... [--anchor <fingerprint>]... [--online <your-identity>]';

const args = process.argv.slice(2);
const roots = [];
const anchors = [];
let asking;
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--timestamp-root') roots.push(args[++i]);
  else if (args[i] === '--anchor') anchors.push(args[++i]);
  else if (args[i] === '--online') asking = args[++i] ?? '';
  else rest.push(args[i]);
}
const file = rest.find((arg) => !arg.startsWith('--'));
if (!file || roots.includes(undefined) || anchors.includes(undefined) || asking === '') {
  console.error(USAGE);
  process.exit(2);
}

let facts;
try {
  const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const trustedTimestampRoots = roots.map((root) => fs.readFileSync(root, 'utf8'));
  const resolver = asking && createDefaultKeyResolver({ from: asking });
  facts = await verifyEvidenceBundle(bundle, {
    ...(roots.length && { trustedTimestampRoots }),
    ...(anchors.length && { anchors }),
    ...(resolver && {
      online: {
        resolveKeyChain: (identity) => resolver.resolveKeyChain(identity),
        // A bundle's signatures are past: no live grace applies, only the chain's facts.
        retiredKeyGraceSeconds: 0,
      },
    }),
  });
} catch (error) {
  const cause = error?.cause ? `: ${error.cause}` : '';
  console.error(`${file}: ${error?.message ?? error}${cause}`);
  process.exit(2);
}
console.log(
  args.includes('--json') ? JSON.stringify(facts, null, 2) : describeEvidenceFacts(facts),
);
process.exit(facts.complete ? 0 : 1);
