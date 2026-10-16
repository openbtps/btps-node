import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventRuntimeChecks, eventSdkChecks } from '../src/checks/events.mjs';
import { runChecks } from '../src/runner.mjs';
import { loadSdk } from '../src/sdk-loader.mjs';
import { VectorLoadError, loadVectorSet } from '../src/vectors.mjs';
import { createNodeRuntime } from '../src/runtimes/node.mjs';
import { createWebRuntime } from '../src/runtimes/web.mjs';
import { REPO_ROOT, VECTORS_DIR } from './helpers.mjs';

const set = loadVectorSet(VECTORS_DIR);
const failing = (results) => results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.message}`);

describe('lifecycle event vectors', () => {
  it('loads at least one event of every type', () => {
    const types = new Set(Object.values(set.events).map((e) => e.eventType));
    expect([...types].sort()).toEqual(
      ['disputed', 'paid', 'partially_paid', 'refund', 'refund_requested', 'response'].sort(),
    );
  });

  it('every event signs and verifies over its JCS form on node and web', async () => {
    const checks = [createNodeRuntime(), createWebRuntime()].flatMap((runtime) =>
      eventRuntimeChecks(runtime, set),
    );
    expect(checks.length).toBe(2 * Object.keys(set.events).length);
    expect(failing(await runChecks(checks))).toEqual([]);
  });

  it('the SDK on this tree passes every sdk/events check', async () => {
    const checks = eventSdkChecks(await loadSdk(REPO_ROOT), set);
    expect(checks.length).toBeGreaterThan(50);
    expect(checks.every((c) => c.id.startsWith('sdk/events/'))).toBe(true);
    expect(failing(await runChecks(checks))).toEqual([]);
  });

  it('every sdk/events check fails on an SDK without lifecycle events', async () => {
    const results = await runChecks(eventSdkChecks({ documents: {} }, set));
    expect(results.every((r) => !r.passed)).toBe(true);
  });

  it('a case that names a missing event is a load error, not a skipped check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-vectors-'));
    fs.cpSync(VECTORS_DIR, dir, { recursive: true });
    fs.rmSync(path.join(dir, 'events', 'refund.json'));
    expect(() => loadVectorSet(dir)).toThrow(VectorLoadError);
  });
});
