/**
 * The "hermes" runtime driver (EBA-150): the BTPS 1.1 crypto profile run for
 * real inside the `hermes` CLI — the engine the ebill-sass React Native app
 * ships with, run directly, with nothing above it.
 *
 * Unlike ios.mjs/android.mjs (web.mjs's WebCrypto driver re-exported under a
 * platform name, and deliberately NOT wired into buildChecks() because of
 * it — see that file and the README's Limitations section), this driver is
 * only ever registered when `locateHermes()` has confirmed a real binary at
 * the pinned version and architecture actually runs. Finding no such binary
 * is a normal, reported outcome, not a fallback to pretending on Node.
 *
 * Hermes has neither node:crypto nor WebCrypto, so the actual signing,
 * verifying and OAEP wrap/unwrap run through ../hermes-crypto-core.mjs — a
 * pure-ECMAScript implementation — executed inside the spawned Hermes
 * process itself (see runInHermes below), not emulated here under Node.
 * PEM parsing (base64 framing only, nothing cryptographic) happens on the
 * Node side with the same `pemToDer` the web driver uses, because Hermes has
 * no PEM/base64 facility of its own and decoding a PEM envelope is not part
 * of the claim this driver makes.
 */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pemToDer, toBase64 } from '../encoding.mjs';

const execFileAsync = promisify(execFile);

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CRYPTO_CORE_PATH = path.join(PACKAGE_DIR, 'src/hermes-crypto-core.mjs');

// The Hermes build ebill-sass's React Native app ships, per EBA-150's
// comments (Bhupendra Tamang, 2026-10-08): react-native@0.86.3 / Expo SDK
// 57, "Hermes is bundled with that package — read exact version from
// react-native@0.86.3" rather than assumed.
//
// Read directly from the published npm package: the react-native@0.86.3
// tarball (https://registry.npmjs.org/react-native/-/react-native-0.86.3.tgz)
// contains packages/react-native/sdks/.hermesv1version, whose content is
// "hermes-v250829098.0.17" — resolving, per that same tarball's
// scripts/hermes/hermes-utils.js and sdks/hermes-engine/hermes-utils.rb, to
// facebook/hermes.git tag hermes-v250829098.0.17 (commit
// 3477757eb2475555cf8d8df24bfb1deb0613880d, confirmed against the GitHub
// API on 2026-10-09).
//
// Two assumptions this harness cannot independently confirm, because the
// ebill-sass mobile repository is not checked out here: (1) that the app
// has not set RCT_HERMES_V1_ENABLED=0, which would pin the classic engine
// in sdks/.hermesversion ("hermes-v0.17.0") instead — Hermes V1 is the
// react-native-wide default from 0.84 onward, and 0.86.3 postdates that;
// (2) that mobile/package.json's react-native pin has not moved since
// af6e6bb. Both are stated here as assumptions, not verified facts.
export const EXPECTED_HERMES_VERSION = '250829098.0.17';
export const EXPECTED_HERMES_SOURCE =
  'facebook/hermes.git tag hermes-v250829098.0.17 (commit 3477757eb2475555cf8d8df24bfb1deb0613880d), ' +
  'the Hermes V1 build react-native@0.86.3 pins in sdks/.hermesv1version';

// Node's os.arch() name for the architecture this ticket requires (aarch64).
const REQUIRED_ARCH = 'arm64';

const TOOLCHAIN_TOOLS = ['cmake', 'make', 'ninja', 'gcc', 'g++', 'clang', 'clang++'];

function isOnPath(command) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * The default, real probe: look for an actual `hermes` binary, via an
 * explicit override or PATH, and ask it its own version. Returns `null`
 * (never throws) when nothing runnable is found.
 *
 * @returns {Promise<{ binaryPath: string, version: string } | null>}
 */
async function defaultFindBinary() {
  const candidates = [];
  if (process.env.HERMES_CLI_PATH) candidates.push(process.env.HERMES_CLI_PATH);
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'hermes'));
  }

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      continue; // not a file, or not executable: not a candidate
    }
    try {
      // Hermes's own CLI flag for its version banner. Not verified against a
      // real binary in this sandbox (none is available — see
      // noBinaryFoundReason below); the output is parsed leniently for
      // exactly this reason.
      const { stdout } = await execFileAsync(candidate, ['-version'], { timeout: 5000 });
      const match = stdout.match(/\d+(?:\.\d+)+/);
      return { binaryPath: candidate, version: match ? match[0] : stdout.trim() };
    } catch {
      continue; // a file by this name exists but would not run as Hermes
    }
  }
  return null;
}

function noBinaryFoundReason() {
  const missingTools = TOOLCHAIN_TOOLS.filter((tool) => !isOnPath(tool));
  const toolchainNote =
    missingTools.length === TOOLCHAIN_TOOLS.length
      ? `building one from source needs a C/C++ toolchain (cmake, a compiler); this container has none of ${TOOLCHAIN_TOOLS.join(', ')} on PATH`
      : `a partial C/C++ toolchain is present (missing: ${missingTools.join(', ') || 'none'}), but no prebuilt hermes CLI binary exists on PATH`;
  return (
    `no "hermes" binary found (checked the HERMES_CLI_PATH environment variable ` +
    `${process.env.HERMES_CLI_PATH ? `= ${process.env.HERMES_CLI_PATH}` : '(unset)'}, and every ` +
    `directory on PATH). The pinned engine is ${EXPECTED_HERMES_SOURCE}; ${toolchainNote}.`
  );
}

/**
 * @typedef {{ available: true, binaryPath: string, version: string, arch: string }
 *   | { available: false, reason: string }} LocateResult
 */

/**
 * Decides whether this harness can run the BTPS vectors inside a real
 * Hermes, or must stop and say why it cannot — never silently, never by
 * substituting a different engine under Hermes's name (EBA-150 AC 1).
 *
 * @param {object} [options]
 * @param {string} [options.expectedVersion] defaults to EXPECTED_HERMES_VERSION
 * @param {string} [options.arch] defaults to os.arch()
 * @param {() => Promise<{ binaryPath: string, version: string } | null>} [options.findBinary]
 *   defaults to a real probe (PATH / HERMES_CLI_PATH)
 * @returns {Promise<LocateResult>}
 */
export async function locateHermes({
  expectedVersion = EXPECTED_HERMES_VERSION,
  arch = os.arch(),
  findBinary = defaultFindBinary,
} = {}) {
  if (arch !== REQUIRED_ARCH) {
    return {
      available: false,
      reason: `this harness only runs Hermes on ${REQUIRED_ARCH} (aarch64); this container reports architecture "${arch}"`,
    };
  }

  let found;
  try {
    found = await findBinary();
  } catch (error) {
    return {
      available: false,
      reason: `looking for a hermes binary failed: ${error?.message ?? String(error)}`,
    };
  }

  if (!found) {
    return { available: false, reason: noBinaryFoundReason() };
  }

  if (found.version !== expectedVersion) {
    return {
      available: false,
      reason:
        `found a hermes binary at ${found.binaryPath} reporting version "${found.version}", ` +
        `but ebill-sass ships ${expectedVersion}; refusing to run a different engine under Hermes's name`,
    };
  }

  return { available: true, binaryPath: found.binaryPath, version: found.version, arch };
}

/**
 * Spawns the located Hermes binary on a plain script (no import/export, no
 * bundler — the same constraint jcs.mjs's portability rule already keeps
 * this package's oracle under) and returns what it printed. Resolves
 * regardless of exit code: a script that fails to parse or throws is still
 * useful information to the caller, not a reason to reject the promise.
 *
 * @param {LocateResult} location must be `{ available: true, ... }`
 * @param {string} source
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ stdout: string, stderr: string, code: number | null }>}
 */
export function runInHermes(location, source, { timeoutMs = 10_000 } = {}) {
  if (!location?.available) {
    return Promise.reject(new Error('runInHermes called without an available Hermes location'));
  }
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-hermes-'));
    const file = path.join(dir, 'script.js');
    const cleanup = () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort; a leaked temp dir is not worth failing the run over
      }
    };
    try {
      fs.writeFileSync(file, source, 'utf8');
    } catch (error) {
      cleanup();
      reject(error);
      return;
    }
    const child = spawn(location.binaryPath, [file], { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      cleanup();
      reject(error);
    });
    child.on('close', (code) => {
      cleanup();
      resolve({ stdout, stderr, code });
    });
  });
}

function portableCryptoCoreSource() {
  const source = fs.readFileSync(CRYPTO_CORE_PATH, 'utf8');
  // Hermes runs this as a plain script, not an ES module: a bare `export`
  // keyword is a SyntaxError there. hermes-crypto-core.mjs keeps every
  // export in one trailing statement for exactly this reason (see its own
  // header) — drop that one statement and the rest is already valid script
  // source, by construction.
  const stripped = source.replace(/\nexport\s*\{[^}]*\}\s*;?\s*$/, '\n');
  if (stripped === source) {
    throw new Error('hermes-crypto-core.mjs: expected trailing export statement not found');
  }
  return stripped;
}

function bytesLiteral(bytes) {
  return JSON.stringify(Array.from(bytes));
}

/**
 * Runs `resultExpr` (a JS expression, evaluating to something JSON-safe)
 * inside Hermes, with hermes-crypto-core.mjs's functions in scope, and
 * returns its value — or throws, carrying through either an error the
 * expression itself threw or one Hermes reported (non-zero exit, no
 * parseable result).
 *
 * @param {LocateResult} location
 * @param {string} resultExpr
 */
async function runCryptoOp(location, resultExpr) {
  const script =
    `${portableCryptoCoreSource()}\n` +
    `try {\n` +
    `  print(JSON.stringify({ ok: true, value: (${resultExpr}) }));\n` +
    `} catch (e) {\n` +
    `  print(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));\n` +
    `}\n`;
  const { stdout, stderr, code } = await runInHermes(location, script);
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error(
      `hermes produced no parseable result (exit code ${code}): stdout=${JSON.stringify(
        stdout,
      )} stderr=${JSON.stringify(stderr)}`,
    );
  }
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/**
 * @param {LocateResult} location a result from locateHermes with `available: true`
 * @returns {import('./types.mjs').RuntimeDriver}
 */
export function createHermesRuntime(location) {
  return {
    name: 'hermes',

    async signPkcs1Sha256(privateKeyPem, bytes) {
      const der = pemToDer(privateKeyPem, 'PRIVATE KEY');
      const value = await runCryptoOp(
        location,
        `Array.from(pkcs1v15Sign(parsePkcs8RsaPrivateKey(new Uint8Array(${bytesLiteral(der)})), ` +
          `new Uint8Array(${bytesLiteral(bytes)})))`,
      );
      return new Uint8Array(value);
    },

    async verifyPkcs1Sha256(publicKeyPem, bytes, signature) {
      const der = pemToDer(publicKeyPem, 'PUBLIC KEY');
      return runCryptoOp(
        location,
        `pkcs1v15Verify(parseSpkiRsaPublicKey(new Uint8Array(${bytesLiteral(der)})), ` +
          `new Uint8Array(${bytesLiteral(bytes)}), new Uint8Array(${bytesLiteral(signature)}))`,
      );
    },

    async oaepWrap(publicKeyPem, keyBytes) {
      const der = pemToDer(publicKeyPem, 'PUBLIC KEY');
      const value = await runCryptoOp(
        location,
        `Array.from(oaepEncrypt(parseSpkiRsaPublicKey(new Uint8Array(${bytesLiteral(der)})), ` +
          `new Uint8Array(${bytesLiteral(keyBytes)})))`,
      );
      return new Uint8Array(value);
    },

    async oaepUnwrap(privateKeyPem, wrapped) {
      const der = pemToDer(privateKeyPem, 'PRIVATE KEY');
      const value = await runCryptoOp(
        location,
        `Array.from(oaepDecrypt(parsePkcs8RsaPrivateKey(new Uint8Array(${bytesLiteral(der)})), ` +
          `new Uint8Array(${bytesLiteral(wrapped)})))`,
      );
      return new Uint8Array(value);
    },

    async spkiFingerprint(publicKeyPem) {
      const der = pemToDer(publicKeyPem, 'PUBLIC KEY');
      const value = await runCryptoOp(
        location,
        `Array.from(sha256(new Uint8Array(${bytesLiteral(der)})))`,
      );
      return toBase64(new Uint8Array(value));
    },
  };
}
