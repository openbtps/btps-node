// EBA-150 (Hermes stage): "Hermes ... runs on aarch64 in the container, or
// the attempt stops and reports why." That is a decision with four outcomes
// — found and matching, not found, wrong architecture, wrong version — each
// of which must be reported rather than thrown past or silently swallowed.
//
// locateHermes() does not exist yet (this file fails to import it, which is
// correct: nothing here has been implemented). Once it does, this file
// tests its decision logic in isolation from the real filesystem/process by
// injecting a fake binary lookup and a fake architecture, so the outcome is
// deterministic and does not depend on whether this sandbox actually has a
// Hermes binary on disk. hermes-runtime.test.mjs is the companion file that
// exercises the real environment and the real engine.
//
// Assumed contract (no implementation exists to read this from):
//   locateHermes({ expectedVersion, arch, findBinary }) -> Promise<
//     | { available: true, binaryPath: string, version: string, arch: string }
//     | { available: false, reason: string }
//   >
// `findBinary` is an injected `() => Promise<{ binaryPath, version } | null>`;
// `arch` defaults to the real `os.arch()` but is overridable for the fakes
// below. locateHermes must never throw for an environment it cannot satisfy
// — "stops and reports why" means a reported, structured outcome, not an
// uncaught exception terminating the run.
import { describe, expect, it } from 'vitest';
import { locateHermes } from '../src/runtimes/hermes.mjs';

const EXPECTED_VERSION = '0.12.0';

describe('locateHermes: decision logic (fakes injected, no real binary needed)', () => {
  it('reports available when a binary is found at the expected version and architecture', async () => {
    const result = await locateHermes({
      expectedVersion: EXPECTED_VERSION,
      arch: 'arm64',
      findBinary: async () => ({ binaryPath: '/fake/hermes', version: EXPECTED_VERSION }),
    });
    expect(result).toEqual({
      available: true,
      binaryPath: '/fake/hermes',
      version: EXPECTED_VERSION,
      arch: 'arm64',
    });
  });

  it('reports unavailable, with a reason, when no binary is found', async () => {
    const result = await locateHermes({
      expectedVersion: EXPECTED_VERSION,
      arch: 'arm64',
      findBinary: async () => null,
    });
    expect(result.available).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('reports unavailable, naming the architecture, when the container is not aarch64', async () => {
    const result = await locateHermes({
      expectedVersion: EXPECTED_VERSION,
      arch: 'x64',
      findBinary: async () => ({ binaryPath: '/fake/hermes', version: EXPECTED_VERSION }),
    });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/arm64|aarch64|architecture/i);
  });

  it('reports unavailable, naming both versions, when the binary is not the pinned shipping version', async () => {
    const result = await locateHermes({
      expectedVersion: EXPECTED_VERSION,
      arch: 'arm64',
      findBinary: async () => ({ binaryPath: '/fake/hermes', version: '0.11.0' }),
    });
    expect(result.available).toBe(false);
    expect(result.reason).toContain('0.11.0');
    expect(result.reason).toContain(EXPECTED_VERSION);
  });

  it('turns a lookup failure (e.g. spawn error) into a reported reason, not a thrown error', async () => {
    await expect(
      locateHermes({
        expectedVersion: EXPECTED_VERSION,
        arch: 'arm64',
        findBinary: async () => {
          throw new Error('ENOENT: spawn hermes');
        },
      }),
    ).resolves.toMatchObject({ available: false, reason: expect.stringContaining('ENOENT') });
  });

  it('never throws when called with no overrides, whatever this environment turns out to be', async () => {
    // Safety net for the real (non-fake) probe: an environment this harness
    // cannot satisfy is a reportable outcome, never an uncaught exception.
    const result = await locateHermes();
    expect(typeof result.available).toBe('boolean');
    if (!result.available) expect(typeof result.reason).toBe('string');
  });
});
