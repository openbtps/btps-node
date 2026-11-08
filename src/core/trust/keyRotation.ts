/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: key rotation. An identity's keys form a chain of signed records.
 * A rotation is signed by the old key (`from`, the authority) and the new one
 * (`to`, proof that its holder has it); an expiry record, signed by the
 * current key, marks a key the identity already left as compromised. A
 * provider that never rotates has no chain: its key is the implicit start.
 * These sign records and report a chain's facts; keyChainProblem is the
 * refusal a verifier applies online.
 */

import crypto from 'crypto';
import {
  MIN_RSA_KEY_BITS,
  getFingerprintFromPem,
  signBtpPayload,
  signBtpPayloadWithSigner,
  verifySignature,
} from '@core/crypto/index.js';
import { canonicalizeValue } from '@core/crypto/jcs.js';
import type { PemKeys } from '@core/crypto/types.js';
import type { Signer } from '@core/crypto/signer-interface.js';
import { BTPErrorException } from '@core/error/index.js';
import {
  BTP_ERROR_KEY_RETIRED,
  BTP_ERROR_KEY_REVOKED,
  BTP_ERROR_VALIDATION,
} from '@core/error/constant.js';
import type { BTPError } from '@core/error/types.js';
import { BtpKeyChainSchema } from '@core/server/schemas/keyChainSchema.js';
import { sameIdentity } from '@core/server/schemas/helpers.js';
import { base64ToPem, pemToBase64 } from '@core/utils/index.js';
import type {
  BTPKeyChainDns,
  BTPKeyChainFacts,
  BTPKeyChainKey,
  BTPKeyChainRecord,
  BTPKeyChainSignature,
  BTPKeyExpiry,
  BTPKeyExpiryReason,
  BTPKeyRotation,
} from './types.js';

/** Who signs a record: a key pair held here, or a Signer holding the key elsewhere (a KMS). */
export type BTPKeyHolder = { pemFiles: PemKeys } | { signer: Signer };

const publicKeyOf = async (holder: BTPKeyHolder): Promise<string> =>
  'signer' in holder ? (await holder.signer.getPublicKey()).publicKey : holder.pemFiles.publicKey;

const signedBy = async (
  by: BTPKeyChainSignature['by'],
  payload: BTPKeyRotation | BTPKeyExpiry,
  holder: BTPKeyHolder,
): Promise<BTPKeyChainSignature> => ({
  by,
  ...('signer' in holder
    ? await signBtpPayloadWithSigner(payload, holder.signer)
    : signBtpPayload(payload, holder.pemFiles)),
});

const signedObjectOf = (record: BTPKeyChainRecord): BTPKeyRotation | BTPKeyExpiry =>
  'rotation' in record ? record.rotation : record.expiry;

/** Since 1.2: what the next record names as `prev`: the SHA-256 of this record's signed object, lowercase hex. */
export const keyChainRecordHash = (record: BTPKeyChainRecord): string =>
  crypto
    .createHash('sha256')
    .update(canonicalizeValue(signedObjectOf(record)), 'utf8')
    .digest('hex');

/**
 * Since 1.2: the identity's key `from` hands over to `to`. Both sign, so a key
 * whose holder did not agree can never be named. A rotation with immediate
 * expiry (the old key is compromised or lost) may go without `from`'s
 * signature; then `from.publicKey` (SPKI PEM) names the lost key, and the
 * record counts only where an anchor confirms its authority.
 */
export const signKeyRotation = async (
  rotation: {
    identity: string;
    from: { selector: string; publicKey?: string };
    to: { selector: string };
    at: string;
    prev: string | null;
  } & (
    | { expiry?: 'planned' }
    | { expiry: 'immediate'; compromisedSince: string; reason: BTPKeyExpiryReason }
  ),
  keys: { from?: BTPKeyHolder; to: BTPKeyHolder },
): Promise<BTPKeyChainRecord> => {
  if (!keys.from && rotation.expiry !== 'immediate') {
    throw new BTPErrorException(BTP_ERROR_VALIDATION, {
      cause: "only a rotation with immediate expiry goes without the old key's signature",
    });
  }
  const fromPem = keys.from ? await publicKeyOf(keys.from) : rotation.from.publicKey;
  if (!fromPem) {
    throw new BTPErrorException(BTP_ERROR_VALIDATION, {
      cause: 'a rotation without the old key names its public key',
    });
  }
  const keyOf = (selector: string, pem: string) => ({
    selector,
    fingerprint: getFingerprintFromPem(pem),
    publicKey: pemToBase64(pem),
  });
  const signed: BTPKeyRotation = {
    type: 'btps.keyRotation.v1',
    identity: rotation.identity,
    from: keyOf(rotation.from.selector, fromPem),
    to: keyOf(rotation.to.selector, await publicKeyOf(keys.to)),
    at: rotation.at,
    prev: rotation.prev,
    ...(rotation.expiry === 'immediate'
      ? {
          expiry: 'immediate',
          compromisedSince: rotation.compromisedSince,
          reason: rotation.reason,
        }
      : { expiry: 'planned' }),
  };
  return {
    rotation: signed,
    signatures: [
      ...(keys.from ? [await signedBy('from', signed, keys.from)] : []),
      await signedBy('to', signed, keys.to),
    ],
  };
};

/**
 * Since 1.2: a key the identity already rotated away from turns out to have
 * been compromised. The identity's current key signs it; nothing rotates.
 */
export const signKeyExpiry = async (
  expiry: Omit<BTPKeyExpiry, 'type'>,
  current: BTPKeyHolder,
): Promise<BTPKeyChainRecord> => {
  const signed: BTPKeyExpiry = { type: 'btps.keyExpiry.v1', ...expiry };
  return { expiry: signed, signatures: [await signedBy('current', signed, current)] };
};

/**
 * The SHA-256 of a key's DER SPKI, base64, computed here and never taken from
 * a record; undefined unless it is exactly the DER of an RSA key of at least
 * MIN_RSA_KEY_BITS bits, so one key cannot pass under two fingerprints.
 */
const fingerprintOfKey = (publicKey: string): string | undefined => {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const der = key.export({ format: 'der', type: 'spki' });
    if (der.toString('base64') !== publicKey) return undefined;
    if (key.asymmetricKeyType !== 'rsa') return undefined;
    if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < MIN_RSA_KEY_BITS) return undefined;
    return crypto.createHash('sha256').update(der).digest('base64');
  } catch {
    return undefined;
  }
};

const verifies = (
  payload: BTPKeyRotation | BTPKeyExpiry,
  signature: BTPKeyChainSignature | undefined,
  publicKeyPem: string,
) => !!signature && verifySignature(payload, signature, publicKeyPem).isValid;

/** Why a record fails on its own, before its place in the chain is known. */
const recordProblem = (record: BTPKeyChainRecord, identity: string): string | undefined => {
  const signed = signedObjectOf(record);
  if (!sameIdentity(signed.identity, identity)) {
    return `it is ${signed.identity}'s, not ${identity}'s`;
  }
  const by = new Map(record.signatures.map((signature) => [signature.by, signature]));
  if (by.size !== record.signatures.length) return 'one key signs it twice';
  if ('expiry' in record) {
    if (!by.has('current')) return 'an expiry is signed by the current key only';
    if (Date.parse(record.expiry.compromisedSince) > Date.parse(record.expiry.at)) {
      return 'its compromisedSince is after its at';
    }
    return undefined;
  }
  const { rotation } = record;
  for (const [name, key] of [
    ['from', rotation.from],
    ['to', rotation.to],
  ] as const) {
    const computed = fingerprintOfKey(key.publicKey);
    if (!computed) {
      return `its ${name} key is not the DER SPKI of an RSA key of at least ${MIN_RSA_KEY_BITS} bits`;
    }
    if (computed !== key.fingerprint) return `its ${name} fingerprint is not its key's`;
  }
  if (rotation.from.fingerprint === rotation.to.fingerprint) return 'it rotates a key to itself';
  if (by.has('current')) return 'a rotation is signed by its from and to keys only';
  if (!verifies(rotation, by.get('to'), base64ToPem(rotation.to.publicKey))) {
    return 'the new key does not sign it';
  }
  if (by.has('from') || rotation.expiry === 'planned') {
    if (!verifies(rotation, by.get('from'), base64ToPem(rotation.from.publicKey))) {
      return 'the old key does not sign it';
    }
  }
  if (
    rotation.expiry === 'immediate' &&
    Date.parse(rotation.compromisedSince) > Date.parse(rotation.at)
  ) {
    return 'its compromisedSince is after its at';
  }
  return undefined;
};

type ChainNode = { record: BTPKeyChainRecord; index: number; hash: string };

/** One path from the chain's first record to a last one, with the keys it leaves. */
type ChainPath = { nodes: ChainNode[]; keys: BTPKeyChainKey[]; lost: boolean };

const keyFrom = (key: { selector: string; fingerprint: string; publicKey: string }) => ({
  selector: key.selector,
  fingerprint: key.fingerprint,
  publicKey: base64ToPem(key.publicKey),
});

/**
 * Walks one path, record by record, applying the chain rules: each rotation
 * leaves the current key; a key is introduced once; a selector names one key;
 * time moves forward; an expiry names a past key and is signed by the current
 * one. Returns the path's keys, or the first rule broken.
 */
const walk = (nodes: ChainNode[]): ChainPath | string => {
  const keys: BTPKeyChainKey[] = [];
  const selectors = new Map<string, string>();
  // Every selector the path names each key under: the one that introduced it,
  // and a later one it was published under when it rotated away.
  const namedUnder = new Map<string, Set<string>>();
  let lastAt = -Infinity;
  let lost = false;
  const names = (selector: string, fingerprint: string) => {
    const named = selectors.get(selector);
    selectors.set(selector, fingerprint);
    namedUnder.set(fingerprint, (namedUnder.get(fingerprint) ?? new Set()).add(selector));
    return named === undefined || named === fingerprint;
  };
  for (const { record, index } of nodes) {
    const at = Date.parse(signedObjectOf(record).at);
    if (!(at > lastAt)) return `record ${index}: its at is not later than the previous record's`;
    lastAt = at;
    const current = keys.at(-1);
    if ('rotation' in record) {
      const { rotation } = record;
      if (!current) keys.push(keyFrom(rotation.from));
      else if (rotation.from.fingerprint !== current.fingerprint) {
        return `record ${index}: it rotates from a key that is not the current one`;
      }
      if (keys.some((key) => key.fingerprint === rotation.to.fingerprint)) {
        return `record ${index}: its new key was already a key of the chain`;
      }
      if (!names(rotation.from.selector, rotation.from.fingerprint)) {
        return `record ${index}: selector ${rotation.from.selector} names two keys`;
      }
      if (!names(rotation.to.selector, rotation.to.fingerprint)) {
        return `record ${index}: selector ${rotation.to.selector} names two keys`;
      }
      const left = keys.at(-1)!;
      left.validUntil = rotation.at;
      left.rotatedAway = rotation.expiry;
      if (rotation.expiry === 'immediate') {
        Object.assign(left, {
          compromisedSince: rotation.compromisedSince,
          reason: rotation.reason,
          expiredAt: rotation.at,
        });
      }
      lost ||= !record.signatures.some((signature) => signature.by === 'from');
      keys.push({ ...keyFrom(rotation.to), validFrom: rotation.at });
    } else {
      const { expiry } = record;
      const signature = record.signatures.find((s) => s.by === 'current');
      if (!current || !verifies(expiry, signature, current.publicKey)) {
        return `record ${index}: the current key does not sign it`;
      }
      const target = keys.find((key) => key.fingerprint === expiry.key.fingerprint);
      if (!target || target === current) {
        return `record ${index}: it expires a key that is not a past key of the chain`;
      }
      if (!namedUnder.get(expiry.key.fingerprint)?.has(expiry.key.selector)) {
        return `record ${index}: the chain never names that key under selector ${expiry.key.selector}`;
      }
      if (target.compromisedSince !== undefined)
        return `record ${index}: the key is already expired`;
      Object.assign(target, {
        compromisedSince: expiry.compromisedSince,
        reason: expiry.reason,
        expiredAt: expiry.at,
      });
    }
  }
  return { nodes, keys, lost };
};

const invalid = (problem: string): BTPKeyChainFacts => ({
  chainValid: false,
  problem,
  authorityUnverified: false,
  forked: false,
  keys: [],
  anchored: false,
});

/**
 * Since 1.2: the facts about an identity's key chain, refusing nothing.
 *
 * - `anchors`: fingerprints the reader kept, each the identity's key when the
 *   reader saw it. One anchors itself and the records leading to it, never a
 *   record after it, which a thief holding that key could have signed.
 * - `online`: whether the chain came in the operator's signed answer, and
 *   what DNS says of the identity (BTPKeyChainDns). It anchors the whole chain
 *   when the chain's last key is a key DNS publishes for the identity, or,
 *   for a host-only identity, on the operator's answer alone. A rotation
 *   without the old key's signature (a lost key) is confirmed only so: every
 *   later record is signed by the key it named.
 */
export const verifyKeyChain = (
  records: unknown[],
  options: {
    identity: string;
    anchors?: string[];
    online?: { fromOperator: boolean; dns: BTPKeyChainDns };
  },
): BTPKeyChainFacts => {
  const parsed = BtpKeyChainSchema.safeParse(records);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    return invalid(`not a key chain: ${issue?.path.join('.')} ${issue?.message}`.trim());
  }
  if (parsed.data.length === 0) {
    return {
      chainValid: true,
      authorityUnverified: false,
      forked: false,
      keys: [],
      anchored: false,
    };
  }
  const nodes = (parsed.data as BTPKeyChainRecord[]).map((record, index) => ({
    record,
    index,
    hash: keyChainRecordHash(record),
  }));
  const byHash = new Map<string, ChainNode>();
  for (const node of nodes) {
    const problem = recordProblem(node.record, options.identity);
    if (problem) return invalid(`record ${node.index}: ${problem}`);
    if (byHash.has(node.hash)) return invalid(`record ${node.index}: it appears twice`);
    byHash.set(node.hash, node);
  }
  const roots = nodes.filter((node) => signedObjectOf(node.record).prev === null);
  if (roots.length !== 1) return invalid('the chain does not have exactly one first record');
  const [root] = roots as [ChainNode];
  if (!('rotation' in root.record)) return invalid('the first record is not a rotation');
  const children = new Map<string, ChainNode[]>();
  for (const node of nodes) {
    const { prev } = signedObjectOf(node.record);
    if (prev === null) continue;
    if (!byHash.has(prev))
      return invalid(`record ${node.index}: its prev names no record of the chain`);
    children.set(prev, [...(children.get(prev) ?? []), node]);
  }

  // Every path from the first record to a last one: one unless the chain forks.
  const lines: ChainNode[][] = [];
  const extend = (line: ChainNode[]) => {
    const next = children.get(line.at(-1)!.hash) ?? [];
    if (next.length === 0) lines.push(line);
    for (const node of next) extend([...line, node]);
  };
  extend([root]);
  // A cycle would need a SHA-256 preimage; still, no record is ever silently left out.
  if (new Set(lines.flat()).size !== nodes.length) {
    return invalid('a record is not reached from the first record');
  }
  const paths: ChainPath[] = [];
  for (const line of lines) {
    const path = walk(line);
    if (typeof path === 'string') return invalid(path);
    paths.push(path);
  }
  const forked = paths.length > 1;
  const tipOf = (path: ChainPath) => path.keys.at(-1)!.fingerprint;

  const online = options.online;
  const onlineAnchors = (path: ChainPath) =>
    !!online?.fromOperator &&
    (online.dns.kind === 'hostOnly' || online.dns.fingerprints.includes(tipOf(path)));
  const anchors = new Set(options.anchors ?? []);
  // A kept fingerprint picks a branch only when it is past the fork, on one branch alone.
  const keptOn = (path: ChainPath) =>
    path.keys.filter(
      (key) =>
        anchors.has(key.fingerprint) &&
        paths.filter((other) => other.keys.some((k) => k.fingerprint === key.fingerprint))
          .length === 1,
    );
  const candidates = forked
    ? paths.filter((path) => onlineAnchors(path) || keptOn(path).length > 0)
    : paths;
  const chosen = candidates.length === 1 ? candidates[0] : undefined;

  let anchored: BTPKeyChainFacts['anchored'] = false;
  if (chosen && onlineAnchors(chosen)) anchored = { by: 'online', upTo: tipOf(chosen) };
  else if (chosen) {
    const kept = chosen.keys.filter((key) => anchors.has(key.fingerprint)).at(-1);
    if (kept) anchored = { by: 'kept-fingerprint', upTo: kept.fingerprint };
  }

  // Off the chosen path, a branch whose first record its signer made at or
  // after that key's compromisedSince is void, and so is every key it named.
  // The signer is the key current where the branch leaves the chosen path.
  const branches = forked
    ? paths.map((path) => {
        const split = chosen ? path.nodes.findIndex((node, i) => chosen.nodes[i] !== node) : -1;
        if (!chosen || split < 1) return { tip: tipOf(path), void: false };
        const rotations = path.nodes.slice(0, split).filter((n) => 'rotation' in n.record).length;
        const since = chosen.keys[rotations]?.compromisedSince;
        const at = signedObjectOf(path.nodes[split]!.record).at;
        return {
          tip: tipOf(path),
          void: since !== undefined && Date.parse(at) >= Date.parse(since),
        };
      })
    : undefined;

  return {
    chainValid: true,
    authorityUnverified: !!chosen?.lost && (anchored === false || anchored.by !== 'online'),
    forked,
    keys: chosen?.keys ?? [],
    ...(branches && { branches }),
    anchored,
  };
};

/**
 * Since 1.2: why a verifier online refuses an identity's key chain, or
 * undefined. It came in the operator's signed answer (`fromOperator`), and
 * `dns` is what DNS says of the identity. A chain that forks, or does not end
 * at a key DNS publishes for an identity that publishes one, is refused, and
 * so is a record dated more than `maxSkewSeconds` (default 300, the server's
 * maxArtifactAgeSeconds) past `now`.
 */
export const keyChainProblem = (
  records: unknown[],
  options: {
    identity: string;
    fromOperator: boolean;
    dns: BTPKeyChainDns;
    now?: number;
    maxSkewSeconds?: number;
  },
): string | undefined => {
  const { identity, fromOperator, dns } = options;
  const facts = verifyKeyChain(records, { identity, online: { fromOperator, dns } });
  if (!facts.chainValid) return facts.problem;
  const latest = (options.now ?? Date.now()) + (options.maxSkewSeconds ?? 300) * 1000;
  const future = (records as BTPKeyChainRecord[]).findIndex(
    (record) => Date.parse(signedObjectOf(record).at) > latest,
  );
  if (future !== -1) return `record ${future}: it is dated in the future`;
  if (facts.forked) return 'the chain forks: a key has two successors';
  if (facts.keys.length > 0 && !facts.anchored) {
    return fromOperator
      ? "the chain's current key is not the key DNS publishes for the identity"
      : "the chain did not come in the operator's signed answer";
  }
  return undefined;
};

/**
 * Since 1.2: a key of a verified chain and its window: by fingerprint when
 * given (the same key may be published under a later selector), else by the
 * selector the chain names it under.
 */
export const keyAt = (
  facts: BTPKeyChainFacts,
  ref: { selector?: string; fingerprint?: string },
): BTPKeyChainKey | undefined =>
  facts.keys.find((key) =>
    ref.fingerprint !== undefined
      ? key.fingerprint === ref.fingerprint
      : key.selector === ref.selector,
  );

/**
 * Since 1.2: why a live artifact signed by this key of a verified chain is
 * refused now, or undefined. Expired (a rotation with immediate expiry, or an
 * expiry record): `BTP_ERROR_KEY_REVOKED`, whatever the artifact's own time
 * says. Rotated away as planned more than `retiredKeyGraceSeconds` ago:
 * `BTP_ERROR_KEY_RETIRED`. The current key, and a key within its grace, pass.
 */
export const keyChainSignerProblem = (
  key: BTPKeyChainKey,
  options: { now?: number; retiredKeyGraceSeconds: number },
): BTPError | undefined => {
  if (key.compromisedSince !== undefined) return BTP_ERROR_KEY_REVOKED;
  if (key.validUntil === undefined) return undefined;
  const retiredFor = (options.now ?? Date.now()) - Date.parse(key.validUntil);
  return retiredFor > options.retiredKeyGraceSeconds * 1000 ? BTP_ERROR_KEY_RETIRED : undefined;
};
