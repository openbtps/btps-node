import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildChecks, evaluate, runChecks } from '../src/runner.mjs';
import { VECTOR_FILES, VectorLoadError, loadVectorSet } from '../src/vectors.mjs';
import { VECTORS_DIR } from './helpers.mjs';

function copyVectors(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-vectors-'));
  fs.cpSync(VECTORS_DIR, dir, { recursive: true });
  mutate?.(dir);
  return dir;
}

function editJson(dir, file, edit) {
  const full = path.join(dir, file);
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));
  edit(json);
  fs.writeFileSync(full, JSON.stringify(json));
}

describe('vector set loading', () => {
  it('loads the committed set', () => {
    const set = loadVectorSet(VECTORS_DIR);
    expect(set.jcs.length).toBeGreaterThanOrEqual(5);
    expect(set.managedSignature.custody).toBe('managed');
    expect(set.selfHeldSignature.custody).toBe('self-held');
  });

  it('refuses a set with a vector file missing, rather than skipping its checks', () => {
    const dir = copyVectors((d) => fs.rmSync(path.join(d, VECTOR_FILES.selfHeldSignature)));
    expect(() => loadVectorSet(dir)).toThrow(VectorLoadError);
  });

  it('refuses a vector with a required field missing', () => {
    const dir = copyVectors((d) =>
      editJson(d, VECTOR_FILES.managedSignature, (v) => delete v.signatureBase64),
    );
    expect(() => loadVectorSet(dir)).toThrow(/signatureBase64/);
  });
});

describe('vector checks catch broken vectors on every runtime', () => {
  const failingIds = async (dir) =>
    (await runChecks(await buildChecks({ vectorsDir: dir, sdkRoot: null })))
      .filter((r) => !r.passed)
      .map((r) => r.id);

  it('the committed set passes without the SDK', async () => {
    expect(await failingIds(VECTORS_DIR)).toEqual([]);
  });

  it('a corrupted managed signature fails on node and web', async () => {
    const dir = copyVectors((d) =>
      editJson(d, VECTOR_FILES.managedSignature, (v) => {
        const bytes = Buffer.from(v.signatureBase64, 'base64');
        bytes[10] ^= 0xff;
        v.signatureBase64 = bytes.toString('base64');
      }),
    );
    const failed = await failingIds(dir);
    expect(failed).toContain(
      'vectors/node/signature/managed/signature-verifies-over-canonical-bytes',
    );
    expect(failed).toContain(
      'vectors/web/signature/managed/signature-verifies-over-canonical-bytes',
    );
    expect(failed).toContain('interop/node->web/signature/managed');
  });

  it('a wrong JCS expectation fails on node and web', async () => {
    const dir = copyVectors((d) =>
      editJson(d, VECTOR_FILES.jcs, (v) => (v[0].expectedCanonical = '{"a":2}')),
    );
    const failed = await failingIds(dir);
    expect(failed).toEqual(
      expect.arrayContaining([
        `vectors/node/jcs/${'key-order-is-insignificant'}`,
        'vectors/web/jcs/key-order-is-insignificant',
      ]),
    );
  });

  it('a negative OAEP vector that is really MGF1-SHA-256 is caught', async () => {
    const dir = copyVectors((d) => {
      const positive = JSON.parse(fs.readFileSync(path.join(d, VECTOR_FILES.oaepWrap), 'utf8'));
      editJson(d, VECTOR_FILES.oaepMgf1Sha1, (v) => {
        v.wrappedKeyBase64 = positive.wrappedKeyBase64;
        v.plaintextKeyBase64 = positive.plaintextKeyBase64;
      });
    });
    const failed = await failingIds(dir);
    expect(failed).toContain('vectors/node/wrap/mgf1-sha1-wrap-is-refused');
    expect(failed).toContain('vectors/web/wrap/mgf1-sha1-wrap-is-refused');
    expect(failed).toContain('oracle/oaep/negative-vector-is-an-mgf1-sha1-wrap');
  });

  it('a signing key reused as the encryption key is caught', async () => {
    const dir = copyVectors((d) => {
      const signing = JSON.parse(
        fs.readFileSync(path.join(d, VECTOR_FILES.managedSignature), 'utf8'),
      );
      editJson(d, VECTOR_FILES.oaepWrap, (v) => {
        v.publicKeyPem = signing.publicKeyPem;
        v.privateKeyPem = signing.privateKeyPem;
      });
    });
    expect(await failingIds(dir)).toContain(
      'vectors/node/keys/signing-and-encryption-keys-are-distinct',
    );
  });
});

describe('evaluate', () => {
  const results = [
    { id: 'a', passed: true },
    { id: 'b', passed: false, message: 'x' },
  ];

  it('strict mode fails on any failure', () => {
    expect(evaluate(results, null).ok).toBe(false);
    expect(evaluate([results[0]], null).ok).toBe(true);
  });

  it('known-failing mode passes when the failing set matches the list exactly', () => {
    expect(evaluate(results, { checks: { b: 'EBA-1' } }).ok).toBe(true);
  });

  it('known-failing mode fails on an unlisted failure', () => {
    const verdict = evaluate(results, { checks: {} });
    expect(verdict.ok).toBe(false);
    expect(verdict.unexpectedFailures.map((r) => r.id)).toEqual(['b']);
  });

  it('known-failing mode fails when a listed check now passes, so the list has to shrink', () => {
    const verdict = evaluate(results, { checks: { a: 'EBA-1', b: 'EBA-1' } });
    expect(verdict.ok).toBe(false);
    expect(verdict.fixedButListed.map((r) => r.id)).toEqual(['a']);
  });

  it('known-failing mode fails when a listed check did not run at all', () => {
    const verdict = evaluate(results, { checks: { b: 'EBA-1', gone: 'EBA-1' } });
    expect(verdict.ok).toBe(false);
    expect(verdict.listedButMissing).toEqual(['gone']);
  });
});
