/**
 * Item 7, document model v2 (EBA-119, EBA-402): document-model.vectors.json
 * and the documents in test/vectors/documents/.
 *
 * - documentRuntimeChecks: each document's JCS form signs and verifies on
 *   every runtime driver, so no document the model accepts is unsignable on
 *   any of them. These are not pinned signatures: there is no one
 *   signature for an arbitrary invoice, so there is nothing to pin. A driver
 *   with `sha256Hex` also recomputes each attachment's lowercase hex sha256.
 * - documentSdkChecks: the SDK's own document model, loaded from the tree
 *   under test (`sdk.documents`, @btps/sdk/documents): schema vectors per
 *   type, the ownership rule, the attachment check (each file is the
 *   size and sha256 the document states), the payslip check, and that
 *   parsing never changes a document.
 */

import { canonicalizeValue } from '../jcs.mjs';
import { fromBase64, utf8 } from '../encoding.mjs';
import { ensure } from '../check.mjs';

const ITEM = 7;

/**
 * The document a case names, changed by its `set`, `unset` and `setPath`. A
 * fresh copy every time. A `setPath` entry sets `value` at `path`, deletes
 * it (`delete`), or writes `repeat` `times` times followed by `then`, so a
 * file over the size cap need not be written out in the vector.
 */
function caseDocument(set, c) {
  const base = typeof c.document === 'string' ? set.documents[c.document] : c.document;
  const doc = structuredClone(base);
  for (const [key, value] of Object.entries(c.set ?? {})) doc[key] = structuredClone(value);
  for (const key of c.unset ?? []) delete doc[key];
  for (const entry of c.setPath ?? []) {
    const parent = entry.path.slice(0, -1).reduce((node, key) => node[key], doc);
    const key = entry.path[entry.path.length - 1];
    if (entry.delete) delete parent[key];
    else if (entry.repeat !== undefined) parent[key] = entry.repeat.repeat(entry.times) + (entry.then ?? '');
    else parent[key] = structuredClone(entry.value);
  }
  return doc;
}

/**
 * @param {import('../runtimes/types.mjs').RuntimeDriver} runtime
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function documentRuntimeChecks(runtime, set) {
  const key = set.managedSignature;
  const checks = Object.entries(set.documents).map(([name, raw]) => ({
    id: `vectors/${runtime.name}/documents/${name}/sign-then-verify`,
    item: ITEM,
    async run() {
      const canonical = utf8(await runtimeCanonical(runtime, raw));
      const signature = await runtime.signPkcs1Sha256(key.privateKeyPem, canonical);
      const verified = await runtime.verifyPkcs1Sha256(key.publicKeyPem, canonical, signature);
      ensure(verified, `${name} signed on ${runtime.name} but did not verify`);
    },
  }));
  if (!runtime.sha256Hex) return checks;
  for (const [name, raw] of Object.entries(set.documents)) {
    if (!raw.attachments?.length) continue;
    checks.push({
      id: `vectors/${runtime.name}/documents/${name}/attachment-sha256`,
      item: ITEM,
      async run() {
        for (const [index, attachment] of raw.attachments.entries()) {
          const digest = await runtime.sha256Hex(fromBase64(attachment.content));
          ensure(
            /^[0-9a-f]{64}$/.test(digest),
            `attachments.${index}: ${digest} is not lowercase hex`,
          );
          ensure(
            digest === attachment.sha256,
            `attachments.${index}: sha256 ${digest}, the document says ${attachment.sha256}`,
          );
        }
      },
    });
  }
  return checks;
}

/**
 * The JCS form a runtime signs: its own canonicaliser's when it has one, and
 * then it must agree with the oracle's; the oracle's otherwise.
 */
export async function runtimeCanonical(runtime, value) {
  const expected = canonicalizeValue(value);
  if (!runtime.canonicalize) return expected;
  const canonical = await runtime.canonicalize(JSON.stringify(value));
  ensure(canonical === expected, `${runtime.name} canonicalised differently from the oracle`);
  return canonical;
}

/**
 * @param {import('../sdk-loader.mjs').LoadedSdk} sdk
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function documentSdkChecks(sdk, set) {
  const model = set.documentModel;
  const check = (name, run) => ({
    id: `sdk/item-7/${name}`,
    item: ITEM,
    tickets: model.tickets,
    run() {
      ensure(
        sdk.documents,
        'the SDK has no document model v2 (src/core/server/schemas/documents/index.ts)',
      );
      return run(sdk.documents);
    },
  });
  const parsed = (documents, doc, label) => {
    const { data, error } = documents.parseBtpDocV2(doc);
    ensure(!error, `${label} was refused: ${JSON.stringify(error?.meta ?? error?.message)}`);
    return data;
  };
  const sameMoney = (actual, expected, label) =>
    ensure(
      actual?.amount === expected.amount && actual?.currency === expected.currency,
      `${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
  const checks = [];

  for (const c of model.schema) {
    checks.push(
      check(`schema/${c.name}`, (documents) => {
        const { data, error } = documents.parseBtpDocV2(caseDocument(set, c));
        if (c.expect === 'accept') {
          ensure(!error, `refused: ${JSON.stringify(error?.meta ?? error?.message)}`);
          ensure(data, 'accepted with no document');
        } else {
          ensure(error, 'accepted; expected refusal');
          ensure(error.code === 'BTP_ERROR_DOC_SCHEMA', `refused with ${error.code}`);
        }
      }),
    );
  }

  for (const c of model.ownership) {
    checks.push(
      check(`ownership/${c.name}`, (documents) => {
        const doc = parsed(documents, caseDocument(set, c), c.document);
        const violation = documents.validateBtpDocOwnership(doc, c.from);
        if (c.expect === 'accept') {
          ensure(!violation, `refused from ${c.from}: ${violation?.message}`);
        } else {
          ensure(violation, `accepted from ${c.from}; expected refusal`);
        }
      }),
    );
  }

  for (const c of model.attachments) {
    checks.push(
      check(`attachments/${c.name}`, (documents) => {
        ensure(documents.verifyAttachments, 'the SDK has no verifyAttachments');
        const result = documents.verifyAttachments(parsed(documents, caseDocument(set, c), c.name));
        const found = result.problems.map((p) => `attachments.${p.index}.${p.field}: ${p.message}`);
        if (c.expect === 'accept') {
          ensure(result.ok && found.length === 0, `refused: ${found.join('; ')}`);
        } else {
          ensure(!result.ok, 'accepted; expected refusal');
          const index = c.expect.index ?? 0;
          ensure(
            result.problems.some((p) => p.index === index && p.field === c.expect.reject),
            `expected a problem in attachments.${index}.${c.expect.reject}, got: ${found.join('; ')}`,
          );
        }
      }),
    );
  }

  for (const c of model.payslip) {
    checks.push(
      check(`payslip/${c.name}`, (documents) => {
        const result = documents.reconcilePayslip(parsed(documents, caseDocument(set, c), c.name));
        ensure(result.ok === c.expect.ok, `ok is ${result.ok}, expected ${c.expect.ok}`);
        ensure(
          result.warnings.length === c.expect.warnings,
          `${result.warnings.length} warnings, expected ${c.expect.warnings}: ${result.warnings.join('; ')}`,
        );
        if (c.expect.computedGross) sameMoney(result.computedGross, c.expect.computedGross, 'computedGross');
        if (c.expect.computedNet) sameMoney(result.computedNet, c.expect.computedNet, 'computedNet');
      }),
    );
  }

  for (const [name, raw] of Object.entries(set.documents)) {
    checks.push(
      check(`never-mutated-by-parsing/${name}`, (documents) => {
        const input = structuredClone(raw);
        const before = canonicalizeValue(input);
        const data = parsed(documents, input, name);
        ensure(canonicalizeValue(input) === before, 'parsing changed the input');
        ensure(!Object.isFrozen(input), 'parsing froze the input');
        ensure(canonicalizeValue(data) === before, 'the parsed document differs from the input');
        ensure(Object.isFrozen(data), 'the parsed document can be written to');
      }),
    );
  }

  return checks;
}
