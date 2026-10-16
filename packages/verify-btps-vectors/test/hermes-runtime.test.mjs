// The golden vectors inside a real Hermes. locateHermes() decides;
// the "with Hermes" block runs only where the pinned binary is installed
// (hermes/run.sh) and is skipped, by name, elsewhere.

import { describe, expect, it } from 'vitest';
import {
  EXPECTED_HERMES_VERSION,
  createHermesRuntime,
  locateHermes,
  runInHermes,
} from '../src/runtimes/hermes.mjs';
import { buildChecks, runChecks } from '../src/runner.mjs';
import { loadVectorSet } from '../src/vectors.mjs';
import { fromBase64, utf8 } from '../src/encoding.mjs';
import { REPO_ROOT, VECTORS_DIR } from './helpers.mjs';

describe('locateHermes', () => {
  it('reports no binary, with a reason, rather than throwing', async () => {
    const result = await locateHermes({ findBinary: async () => null });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/no hermes binary/);
  });

  it('refuses a Hermes at another version', async () => {
    const result = await locateHermes({
      findBinary: async () => ({ binaryPath: '/x/hermes', version: '0.12.0' }),
    });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/0\.12\.0, not 250829098\.0\.17/);
  });

  it('reports a probe that throws as unavailable', async () => {
    const result = await locateHermes({
      findBinary: async () => {
        throw new Error('boom');
      },
    });
    expect(result).toEqual({ available: false, reason: 'looking for hermes failed: boom' });
  });

  it('accepts the pinned version', async () => {
    const result = await locateHermes({
      findBinary: async () => ({ binaryPath: '/x/hermes', version: EXPECTED_HERMES_VERSION }),
    });
    expect(result).toMatchObject({ available: true, version: '250829098.0.17' });
  });

  it('buildChecks leaves Hermes out when it is not available', async () => {
    const checks = await buildChecks({
      vectorsDir: VECTORS_DIR,
      sdkRoot: null,
      hermes: { available: false, reason: 'test' },
    });
    expect(checks.some((c) => c.id.includes('hermes'))).toBe(false);
  });
});

const location = await locateHermes();

describe.skipIf(!location.available)('with Hermes', () => {
  it('runs a plain script in the engine, not in Node', async () => {
    const { stdout, code } = await runInHermes(
      location,
      'print(typeof process, typeof require, typeof globalThis.crypto, typeof HermesInternal);',
    );
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('undefined undefined undefined object');
  });

  it("runs the SDK's jcs.ts: canonicalises, and refuses duplicate names", async () => {
    const hermes = await createHermesRuntime(location, { sdkRoot: REPO_ROOT });
    expect(await hermes.canonicalize('{"b":[1E21,-0,0.5],"a":"\\u00e9"}')).toBe(
      '{"a":"é","b":[1e+21,0,0.5]}',
    );
    await expect(hermes.canonicalize('{"a":1,"a":2}')).rejects.toThrow();
  });

  it('every vector, document, event, selector, digest and interop check passes on Hermes', async () => {
    const checks = await buildChecks({ vectorsDir: VECTORS_DIR, sdkRoot: null, hermes: location });
    const results = await runChecks(checks.filter((c) => c.id.includes('hermes')));
    expect(results.length).toBeGreaterThan(70);
    expect(results.filter((r) => !r.passed)).toEqual([]);
  }, 300_000);

  it('a vector check fails when the vector is wrong', async () => {
    const hermes = await createHermesRuntime(location, { sdkRoot: REPO_ROOT });
    const { managedSignature } = loadVectorSet(VECTORS_DIR);
    const canonical = utf8(managedSignature.canonicalPayload);
    const signature = fromBase64(managedSignature.signatureBase64);
    expect(
      await hermes.verifyPkcs1Sha256(managedSignature.publicKeyPem, canonical, signature),
    ).toBe(true);
    signature[10] ^= 0xff;
    expect(
      await hermes.verifyPkcs1Sha256(managedSignature.publicKeyPem, canonical, signature),
    ).toBe(false);
  }, 60_000);
});
