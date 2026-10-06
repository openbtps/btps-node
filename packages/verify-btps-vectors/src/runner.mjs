/**
 * Builds the check list, runs it, and decides the outcome.
 *
 * Outcome rules:
 *   - strict (default): every check must pass.
 *   - with a known-failing list: the checks that fail must be *exactly* the
 *     listed ones. A listed check that passes is an error too — it means a
 *     fix landed and the list must shrink, so the list can never quietly
 *     hide a check that has started passing (or one that never ran).
 */

import fs from 'node:fs';
import { loadVectorSet } from './vectors.mjs';
import { createNodeRuntime } from './runtimes/node.mjs';
import { createWebRuntime } from './runtimes/web.mjs';
import { vectorChecks } from './checks/vectors.mjs';
import { interopChecks } from './checks/interop.mjs';
import { oracleChecks } from './checks/oracle.mjs';
import { sdkChecks } from './checks/sdk.mjs';
import { loadSdk } from './sdk-loader.mjs';

/**
 * @typedef {object} CheckResult
 * @property {string} id
 * @property {number} [item]
 * @property {string[]} [tickets]
 * @property {boolean} passed
 * @property {string} [message]
 */

/**
 * @param {object} options
 * @param {string} options.vectorsDir
 * @param {string | null} options.sdkRoot null to skip the SDK checks
 * @returns {Promise<import('./check.mjs').Check[]>}
 */
export async function buildChecks({ vectorsDir, sdkRoot }) {
  const set = loadVectorSet(vectorsDir);
  const runtimes = [createNodeRuntime(), createWebRuntime()];
  const checks = [
    ...runtimes.flatMap((runtime) => vectorChecks(runtime, set)),
    ...interopChecks(runtimes, set),
    ...oracleChecks(set),
  ];
  if (sdkRoot) checks.push(...sdkChecks(await loadSdk(sdkRoot), set));

  const seen = new Set();
  for (const { id } of checks) {
    if (seen.has(id)) throw new Error(`duplicate check id ${id}`);
    seen.add(id);
  }
  return checks;
}

/**
 * Runs checks one at a time, in order, so output is stable run to run.
 * @param {import('./check.mjs').Check[]} checks
 * @returns {Promise<CheckResult[]>}
 */
export async function runChecks(checks) {
  const results = [];
  for (const check of checks) {
    const base = { id: check.id, item: check.item, tickets: check.tickets };
    try {
      await check.run();
      results.push({ ...base, passed: true });
    } catch (error) {
      results.push({ ...base, passed: false, message: error?.message ?? String(error) });
    }
  }
  return results;
}

/**
 * @param {string} file
 * @returns {{ baseline?: string, checks: Record<string, string> }}
 */
export function readKnownFailing(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed.checks !== 'object' || Array.isArray(parsed.checks)) {
    throw new Error(`${file}: expected { "checks": { "<check id>": "<owning ticket>" } }`);
  }
  return parsed;
}

/**
 * @param {CheckResult[]} results
 * @param {{ checks: Record<string, string> } | null} knownFailing
 */
export function evaluate(results, knownFailing) {
  const failed = results.filter((r) => !r.passed);
  if (!knownFailing) {
    return {
      ok: failed.length === 0,
      unexpectedFailures: failed,
      fixedButListed: [],
      listedButMissing: [],
    };
  }
  const listed = new Set(Object.keys(knownFailing.checks));
  const ran = new Set(results.map((r) => r.id));
  const unexpectedFailures = failed.filter((r) => !listed.has(r.id));
  const fixedButListed = results.filter((r) => r.passed && listed.has(r.id));
  const listedButMissing = [...listed].filter((id) => !ran.has(id));
  return {
    ok:
      unexpectedFailures.length === 0 &&
      fixedButListed.length === 0 &&
      listedButMissing.length === 0,
    unexpectedFailures,
    fixedButListed,
    listedButMissing,
  };
}

/**
 * Plain-text report.
 * @param {CheckResult[]} results
 * @param {ReturnType<typeof evaluate>} verdict
 * @param {{ checks: Record<string, string> } | null} knownFailing
 */
export function formatReport(results, verdict, knownFailing) {
  const listed = new Set(Object.keys(knownFailing?.checks ?? {}));
  const lines = [];
  for (const r of results) {
    const tag = r.passed ? 'PASS' : listed.has(r.id) ? 'XFAIL' : 'FAIL';
    const owner = r.tickets?.length ? ` [item ${r.item}: ${r.tickets.join(', ')}]` : '';
    lines.push(`${tag.padEnd(5)} ${r.id}${owner}`);
    if (!r.passed) lines.push(`      ${r.message}`);
  }
  const passed = results.filter((r) => r.passed).length;
  lines.push('');
  lines.push(`${results.length} checks: ${passed} passed, ${results.length - passed} failed.`);
  if (knownFailing) {
    lines.push(`Known-failing list: ${listed.size} entries.`);
    for (const r of verdict.fixedButListed) {
      lines.push(`NOW PASSING, remove from the known-failing list: ${r.id}`);
    }
    for (const id of verdict.listedButMissing) {
      lines.push(`LISTED BUT NOT RUN, remove or fix the id: ${id}`);
    }
  }
  lines.push(verdict.ok ? 'verify:btps-vectors: OK' : 'verify:btps-vectors: FAILED');
  return lines.join('\n');
}
