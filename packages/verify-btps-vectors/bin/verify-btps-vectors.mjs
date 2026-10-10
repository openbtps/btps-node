#!/usr/bin/env node
/**
 * verify:btps-vectors — run the BTPS golden vectors on every runtime driver
 * and against the SDK source tree.
 *
 *   node packages/verify-btps-vectors/bin/verify-btps-vectors.mjs [options]
 *
 *   --vectors <dir>         vector directory (default: <repo>/test/vectors)
 *   --sdk-root <dir>        btps-node checkout whose src/ is the SDK under test
 *                           (default: this repository)
 *   --no-sdk                run only the vector, interop and oracle checks
 *   --known-failing <file>  pass only if the failing checks are exactly the
 *                           ones listed in <file> (see test/vectors/known-failing.json)
 *   --json                  print results as JSON instead of text
 *
 * Exit codes: 0 OK, 1 checks failed (or did not match --known-failing),
 * 2 the run could not start (bad arguments, unreadable vectors, SDK did not load).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  buildChecks,
  evaluate,
  formatReport,
  readKnownFailing,
  runChecks,
} from '../src/runner.mjs';
import { locateHermes } from '../src/runtimes/hermes.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        vectors: { type: 'string', default: path.join(REPO_ROOT, 'test/vectors') },
        'sdk-root': { type: 'string', default: REPO_ROOT },
        'no-sdk': { type: 'boolean', default: false },
        'known-failing': { type: 'string' },
        json: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    console.error(`verify-btps-vectors: ${error.message}`);
    return 2;
  }

  // EBA-150 AC 1: this never substitutes another engine under Hermes's
  // name, and never stays silent about why Hermes did or did not run. In
  // --json mode the report goes into the JSON payload below instead of
  // stderr, so a machine reader gets it as structured data and this CLI's
  // own test (--json emits machine-readable results) can still treat
  // stdout as one parseable JSON document.
  const hermes = await locateHermes();
  if (!values.json) {
    console.error(
      hermes.available
        ? `verify-btps-vectors: hermes ${hermes.version} (${hermes.arch}) found at ${hermes.binaryPath}`
        : `verify-btps-vectors: hermes not available — ${hermes.reason}`,
    );
  }

  let checks;
  let knownFailing = null;
  try {
    knownFailing = values['known-failing']
      ? readKnownFailing(path.resolve(values['known-failing']))
      : null;
    checks = await buildChecks({
      vectorsDir: path.resolve(values.vectors),
      sdkRoot: values['no-sdk'] ? null : path.resolve(values['sdk-root']),
      hermes,
    });
  } catch (error) {
    console.error(`verify-btps-vectors: could not start: ${error.message}`);
    return 2;
  }

  const results = await runChecks(checks);
  const verdict = evaluate(results, knownFailing);
  if (values.json) {
    console.log(JSON.stringify({ ok: verdict.ok, hermes, results, ...verdict }, null, 2));
  } else {
    console.log(formatReport(results, verdict, knownFailing));
  }
  return verdict.ok ? 0 : 1;
}

process.exitCode = await main();
