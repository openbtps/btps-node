/**
 * The "hermes" runtime driver (EBA-150): every operation runs inside a real
 * `hermes` process, the JavaScript engine React Native ships, with nothing
 * above it. It is registered only when locateHermes() has found that binary
 * at the pinned version; finding none is a reported outcome, never a
 * fallback to running something else under Hermes's name.
 *
 * - Crypto runs through ../hermes-crypto-core.mjs, because bare Hermes has
 *   neither node:crypto nor WebCrypto. It takes bytes.
 * - Canonical JSON runs through the SDK's own src/core/crypto/jcs.ts,
 *   bundled by esbuild into a plain script, so what is proven on Hermes is
 *   the code a React Native app would ship, not a copy of it.
 *
 * Node does only framing: PEM to DER, bytes to a hex literal, base64 of a
 * digest Hermes computed.
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
const REPO_ROOT = path.resolve(PACKAGE_DIR, '..', '..');
const CRYPTO_CORE_PATH = path.join(PACKAGE_DIR, 'src/hermes-crypto-core.mjs');
const SDK_JCS_ENTRY = 'src/core/crypto/jcs.ts';

/**
 * The engine react-native@0.86.3 (Expo SDK 57) ships: its hermes-compiler
 * dependency is 250829098.0.17, built from facebook/hermes tag
 * hermes-v250829098.0.17. hermes/Dockerfile builds exactly that commit.
 */
export const EXPECTED_HERMES_VERSION = '250829098.0.17';
export const HERMES_SOURCE =
  'facebook/hermes tag hermes-v250829098.0.17 (commit 3477757eb2475555cf8d8df24bfb1deb0613880d)';

/** @returns {Promise<{ binaryPath: string, version: string } | null>} */
async function defaultFindBinary() {
  const candidates = [];
  if (process.env.HERMES_CLI_PATH) candidates.push(process.env.HERMES_CLI_PATH);
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'hermes'));
  }
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const { stdout } = await execFileAsync(candidate, ['-version'], { timeout: 5000 });
      const match = stdout.match(/Hermes release version:\s*(\S+)/);
      if (match) return { binaryPath: candidate, version: match[1] };
    } catch {
      // not there, not executable, or not Hermes
    }
  }
  return null;
}

/**
 * @typedef {{ available: true, binaryPath: string, version: string, arch: string }
 *   | { available: false, reason: string }} HermesLocation
 */

/**
 * Finds a runnable `hermes` (HERMES_CLI_PATH, then PATH) at the pinned
 * version, or says why there is none. Never throws.
 *
 * @param {object} [options]
 * @param {string} [options.expectedVersion]
 * @param {() => Promise<{ binaryPath: string, version: string } | null>} [options.findBinary]
 * @returns {Promise<HermesLocation>}
 */
export async function locateHermes({
  expectedVersion = EXPECTED_HERMES_VERSION,
  findBinary = defaultFindBinary,
} = {}) {
  let found;
  try {
    found = await findBinary();
  } catch (error) {
    return { available: false, reason: `looking for hermes failed: ${error?.message ?? error}` };
  }
  if (!found) {
    return {
      available: false,
      reason:
        'no hermes binary on HERMES_CLI_PATH or PATH; ' +
        'run packages/verify-btps-vectors/hermes/run.sh to build one and run the vectors in a container',
    };
  }
  if (found.version !== expectedVersion) {
    return {
      available: false,
      reason:
        `${found.binaryPath} is Hermes ${found.version}, not ${expectedVersion} ` +
        '(the engine react-native@0.86.3 ships); not running the vectors on a different engine',
    };
  }
  return { available: true, binaryPath: found.binaryPath, version: found.version, arch: os.arch() };
}

/**
 * Runs `source` as a plain (non-module) script in Hermes. Resolves whatever
 * the exit code; the caller decides what a failure means.
 *
 * @param {HermesLocation} location
 * @param {string} source
 * @returns {Promise<{ stdout: string, stderr: string, code: number | null }>}
 */
export function runInHermes(location, source, { timeoutMs = 60_000 } = {}) {
  if (!location?.available) {
    return Promise.reject(new Error('runInHermes needs an available Hermes location'));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-hermes-'));
  const file = path.join(dir, 'script.js');
  fs.writeFileSync(file, source, 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn(location.binaryPath, [file], { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

/** hermes-crypto-core.mjs as a plain script: its one trailing export dropped. */
function cryptoCoreScript() {
  const source = fs.readFileSync(CRYPTO_CORE_PATH, 'utf8');
  const script = source.replace(/\nexport\s*\{[^}]*\}\s*;?\s*$/, '\n');
  if (script === source) throw new Error('hermes-crypto-core.mjs: trailing export not found');
  return script;
}

/**
 * The SDK's jcs.ts as a plain script defining `__btpsJcs.canonicalize`.
 * @param {string} sdkRoot
 */
async function sdkJcsScript(sdkRoot) {
  const { build } = await import('esbuild');
  const result = await build({
    stdin: {
      contents: `export { canonicalize } from './${SDK_JCS_ENTRY}';`,
      resolveDir: sdkRoot,
      sourcefile: 'verify-btps-vectors-hermes-jcs.mjs',
      loader: 'js',
    },
    absWorkingDir: sdkRoot,
    tsconfig: path.join(sdkRoot, 'tsconfig.json'),
    bundle: true,
    platform: 'neutral',
    format: 'iife',
    globalName: '__btpsJcs',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const bytesExpr = (bytes) => `fromHex(${JSON.stringify(hex(bytes))})`;
const FROM_HEX = `
function fromHex(h) {
  var out = new Uint8Array(h.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
`;

/**
 * Evaluates `expr` in Hermes after `prelude`, and returns its JSON value.
 * An exception inside Hermes rejects with its message.
 */
async function evaluate(location, prelude, expr) {
  const script =
    `${prelude}\n${FROM_HEX}\n` +
    `var __out;\n` +
    `try { __out = { ok: true, value: (${expr}) }; }\n` +
    `catch (e) { __out = { ok: false, error: String((e && e.message) || e) }; }\n` +
    `print(JSON.stringify(__out));\n`;
  const { stdout, stderr, code } = await runInHermes(location, script);
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error(
      `hermes gave no result (exit ${code}): stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
    );
  }
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/**
 * @param {HermesLocation} location a locateHermes() result with `available: true`
 * @param {{ sdkRoot?: string | null }} [options] the tree whose jcs.ts runs in
 *   Hermes; defaults to this repository
 * @returns {Promise<import('./types.mjs').RuntimeDriver>}
 */
export async function createHermesRuntime(location, { sdkRoot } = {}) {
  if (!location?.available) throw new Error('createHermesRuntime needs an available Hermes');
  const crypto = cryptoCoreScript();
  const jcs = await sdkJcsScript(path.resolve(sdkRoot ?? REPO_ROOT));
  const privateKey = (pem) => `parsePkcs8RsaPrivateKey(${bytesExpr(pemToDer(pem, 'PRIVATE KEY'))})`;
  const publicKey = (pem) => `parseSpkiRsaPublicKey(${bytesExpr(pemToDer(pem, 'PUBLIC KEY'))})`;
  const bytesOf = async (expr) =>
    new Uint8Array(await evaluate(location, crypto, `Array.from(${expr})`));

  return {
    name: 'hermes',
    version: location.version,

    signPkcs1Sha256: (pem, bytes) =>
      bytesOf(`pkcs1v15Sign(${privateKey(pem)}, ${bytesExpr(bytes)})`),

    verifyPkcs1Sha256: (pem, bytes, signature) =>
      evaluate(
        location,
        crypto,
        `pkcs1v15Verify(${publicKey(pem)}, ${bytesExpr(bytes)}, ${bytesExpr(signature)})`,
      ),

    oaepWrap: (pem, keyBytes) => bytesOf(`oaepEncrypt(${publicKey(pem)}, ${bytesExpr(keyBytes)})`),

    oaepUnwrap: (pem, wrapped) => bytesOf(`oaepDecrypt(${privateKey(pem)}, ${bytesExpr(wrapped)})`),

    async spkiFingerprint(pem) {
      return toBase64(await bytesOf(`sha256(${bytesExpr(pemToDer(pem, 'PUBLIC KEY'))})`));
    },

    sha256Hex: (bytes) => evaluate(location, crypto, `toHex(sha256(${bytesExpr(bytes)}))`),

    canonicalize: (jsonText) =>
      evaluate(location, jcs, `__btpsJcs.canonicalize(${JSON.stringify(jsonText)})`),
  };
}
