import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentRuntimeChecks, documentSdkChecks } from '../src/checks/documents.mjs';
import { runChecks } from '../src/runner.mjs';
import { loadSdk } from '../src/sdk-loader.mjs';
import { VectorLoadError, loadVectorSet } from '../src/vectors.mjs';
import { createNodeRuntime } from '../src/runtimes/node.mjs';
import { createWebRuntime } from '../src/runtimes/web.mjs';
import { REPO_ROOT, VECTORS_DIR } from './helpers.mjs';

const set = loadVectorSet(VECTORS_DIR);
const failing = (results) => results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.message}`);

describe('item 7: document model v2 vectors (EBA-119, EBA-402)', () => {
  it('loads every document, and no lifecycle event (that is BTPS_EVENT)', () => {
    const names = Object.keys(set.documents);
    expect(names).toContain('invoice.v2.json');
    expect(names).toContain('credit-note.v2.json');
    expect(names).toContain('payslip.unknown-extensions.v2.json');
    expect(names.some((n) => n.startsWith('lifecycle'))).toBe(false);
  });

  it('every document signs and verifies over its JCS form on node and web', async () => {
    const checks = [createNodeRuntime(), createWebRuntime()].flatMap((runtime) =>
      documentRuntimeChecks(runtime, set),
    );
    const withAttachments = Object.values(set.documents).filter((d) => d.attachments?.length);
    expect(withAttachments.length).toBeGreaterThan(0);
    expect(checks.length).toBe(2 * (Object.keys(set.documents).length + withAttachments.length));
    expect(failing(await runChecks(checks))).toEqual([]);
  });

  it("an attachment whose bytes do not match its sha256 fails on each runtime's digest", async () => {
    const [name, doc] = Object.entries(set.documents).find(([, d]) => d.attachments?.length);
    const broken = structuredClone(doc);
    broken.attachments[0].sha256 = 'f'.repeat(64);
    const checks = [createNodeRuntime(), createWebRuntime()].flatMap((runtime) =>
      documentRuntimeChecks(runtime, { ...set, documents: { [name]: broken } }),
    );
    expect(failing(await runChecks(checks))).toEqual([
      expect.stringMatching(new RegExp(`^vectors/node/documents/${name}/attachment-sha256: `)),
      expect.stringMatching(new RegExp(`^vectors/web/documents/${name}/attachment-sha256: `)),
    ]);
  });

  it('the SDK on this tree passes every item 7 check', async () => {
    const checks = documentSdkChecks(await loadSdk(REPO_ROOT), set);
    expect(checks.length).toBeGreaterThan(20);
    expect(checks.every((c) => c.item === 7 && c.id.startsWith('sdk/item-7/'))).toBe(true);
    expect(failing(await runChecks(checks))).toEqual([]);
  });

  it('every item 7 check fails on an SDK without document model v2', async () => {
    const results = await runChecks(documentSdkChecks({ documents: null }, set));
    expect(results.every((r) => !r.passed)).toBe(true);
  });

  it('a case that names a missing document is a load error, not a skipped check', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-vectors-'));
    fs.cpSync(VECTORS_DIR, dir, { recursive: true });
    fs.rmSync(path.join(dir, 'documents', 'credit-note.v2.json'));
    expect(() => loadVectorSet(dir)).toThrow(VectorLoadError);
  });
});
