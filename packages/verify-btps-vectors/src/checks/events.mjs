/**
 * Item A, lifecycle events (EBA-440): event.vectors.json and the events in
 * test/vectors/events/.
 *
 * - eventRuntimeChecks: each event's JCS form signs and verifies on every
 *   runtime driver, as documents do.
 * - eventSdkChecks: the SDK's event model, loaded from the tree under test
 *   (`sdk.documents`, @btps/sdk/documents): schema vectors per event type,
 *   the envelope rule (one id end to end; only a document between the two
 *   parties), the reply chain, and that parsing never changes an event.
 */

import { canonicalizeValue } from '../jcs.mjs';
import { utf8 } from '../encoding.mjs';
import { ensure } from '../check.mjs';

const ITEM = 'A';
const DOCUMENT_PREFIX = 'documents/';

/** The event (or document) a case names, changed by its `set` and `unset`. A fresh copy every time. */
export function caseEvent(set, c) {
  const base =
    typeof c.event !== 'string'
      ? c.event
      : c.event.startsWith(DOCUMENT_PREFIX)
        ? set.documents[c.event.slice(DOCUMENT_PREFIX.length)]
        : set.events[c.event];
  const doc = structuredClone(base);
  for (const [key, value] of Object.entries(c.set ?? {})) doc[key] = structuredClone(value);
  for (const key of c.unset ?? []) delete doc[key];
  return doc;
}

/**
 * @param {import('../runtimes/types.mjs').RuntimeDriver} runtime
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function eventRuntimeChecks(runtime, set) {
  const key = set.managedSignature;
  return Object.entries(set.events).map(([name, raw]) => ({
    id: `vectors/${runtime.name}/events/${name}/sign-then-verify`,
    item: ITEM,
    async run() {
      const canonical = utf8(canonicalizeValue(raw));
      const signature = await runtime.signPkcs1Sha256(key.privateKeyPem, canonical);
      const verified = await runtime.verifyPkcs1Sha256(key.publicKeyPem, canonical, signature);
      ensure(verified, `${name} signed on ${runtime.name} but did not verify`);
    },
  }));
}

/**
 * @param {import('../sdk-loader.mjs').LoadedSdk} sdk
 * @param {ReturnType<import('../vectors.mjs').loadVectorSet>} set
 * @returns {import('../check.mjs').Check[]}
 */
export function eventSdkChecks(sdk, set) {
  const model = set.eventModel;
  const check = (name, run) => ({
    id: `sdk/item-A/${name}`,
    item: ITEM,
    tickets: model.tickets,
    run() {
      ensure(
        sdk.documents?.parseBtpEventDoc,
        'the SDK has no lifecycle event model (parseBtpEventDoc in @btps/sdk/documents)',
      );
      return run(sdk.documents);
    },
  });
  const parsed = (documents, event, label) => {
    const { data, error } = documents.parseBtpEventDoc(event);
    ensure(!error, `${label} was refused: ${JSON.stringify(error?.meta ?? error?.message)}`);
    return data;
  };
  const checks = [];

  for (const c of model.schema) {
    checks.push(
      check(`schema/${c.name}`, (documents) => {
        const { data, error } = documents.parseBtpEventDoc(caseEvent(set, c));
        if (c.expect === 'accept') {
          ensure(!error, `refused: ${JSON.stringify(error?.meta ?? error?.message)}`);
          ensure(data, 'accepted with no event');
        } else {
          ensure(error, 'accepted; expected refusal');
          ensure(error.code === 'BTP_ERROR_DOC_SCHEMA', `refused with ${error.code}`);
        }
      }),
    );
  }

  for (const c of model.envelope) {
    checks.push(
      check(`envelope/${c.name}`, (documents) => {
        const event = parsed(documents, caseEvent(set, c), c.event);
        const violation = documents.validateBtpEventEnvelope(event, {
          id: c.artifactId ?? event.id,
          from: c.from,
          to: c.to,
        });
        if (c.expect === 'accept') {
          ensure(!violation, `refused from ${c.from} to ${c.to}: ${violation?.message}`);
        } else {
          ensure(violation, `accepted from ${c.from} to ${c.to}; expected refusal`);
        }
      }),
    );
  }

  for (const chain of model.chains) {
    checks.push(
      check(`chain/${chain.name}`, (documents) => {
        const sent = [];
        let refusal;
        for (const [index, step] of chain.steps.entries()) {
          const label = `step ${index + 1} (${step.event})`;
          const event = parsed(documents, caseEvent(set, step), label);
          const envelope = { id: event.id, from: step.from, to: step.to };
          const violation = documents.validateBtpEventEnvelope(event, envelope);
          if (!violation && event.inReplyTo !== undefined) {
            const answered = sent.find((s) => s.event.id === event.inReplyTo);
            refusal = answered
              ? documents.validateBtpEventReply({ event, ...envelope }, answered)?.message
              : 'inReplyTo names no event exchanged in this chain';
          } else {
            refusal = violation?.message;
          }
          if (refusal && index < chain.steps.length - 1) {
            ensure(false, `${label} refused before the last step: ${refusal}`);
          }
          sent.push({ event, from: step.from, to: step.to });
        }
        if (chain.expect === 'accept') {
          ensure(!refusal, `the last step was refused: ${refusal}`);
        } else {
          ensure(refusal, 'every step was accepted; expected the last to be refused');
        }
      }),
    );
  }

  for (const [name, raw] of Object.entries(set.events)) {
    checks.push(
      check(`never-mutated-by-parsing/${name}`, (documents) => {
        const input = structuredClone(raw);
        const before = canonicalizeValue(input);
        const data = parsed(documents, input, name);
        ensure(canonicalizeValue(input) === before, 'parsing changed the input');
        ensure(!Object.isFrozen(input), 'parsing froze the input');
        ensure(canonicalizeValue(data) === before, 'the parsed event differs from the input');
        ensure(Object.isFrozen(data), 'the parsed event can be written to');
      }),
    );
  }

  return checks;
}
