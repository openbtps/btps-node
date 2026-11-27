/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: an agreement's evidence bundle. A party creates it to show what
 * was agreed, to a solicitor or a court; whoever it is given to sees
 * everything in it, by design. It holds the content, every signature and the
 * keys, so it checks offline, and it reports facts, never a verdict.
 */

import crypto from 'crypto';
import type { z } from 'zod';
import {
  getFingerprintFromPem,
  signBtpPayload,
  signBtpPayloadWithSigner,
  verifySignature,
} from '@core/crypto/index.js';
import { canonicalizeValue } from '@core/crypto/jcs.js';
import type { BTPSignature } from '@core/crypto/types.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_RESOLVE_PUBKEY, BTP_ERROR_VALIDATION } from '@core/error/constant.js';
import { BtpEvidenceBundleSchema } from '@core/server/schemas/btpsDocsSchema.js';
import { sameIdentity } from '@core/server/schemas/helpers.js';
import type { BTPServerResponse } from '@core/server/types.js';
import { getHostAndSelector, parseIdentity } from '@core/utils/index.js';
import {
  onlineKeyChain,
  signatureKey,
  type BTPKeyChainCheck,
} from '@core/delegation/verifyTransporterSignature.js';
import { checkKeyChain, keyAt, keyChainFactsOf, type BTPKeyHolder } from './keyRotation.js';
import {
  agreementContentSha256,
  agreementOrderProblem,
  agreementRef,
  originatorSignatureValid,
  type BTPKeyOf,
} from './agreements.js';
import { timestampFacts, type BTPTimestampFacts } from './timestamps.js';
import type {
  BTPAgreementAnswers,
  BTPKeyChainFacts,
  BTPKeyChainKey,
  BTPKeyChainRecord,
  BTPKeyExpiryReason,
  BTPAgreementStatement,
  BTPCosignature,
} from './types.js';
import {
  cosignatureSha256,
  cosignatureSignedPart,
  cosignedStatementText,
  statementOfText,
} from './cosignatures.js';

/**
 * Since 1.2: an agreement's evidence bundle (format `btps-evidence/1`). A
 * device cosignature's delegated artifact is a whole transporter artifact,
 * though the schema checks only what its signatures need. `statements[i]` is
 * `cosignatures[i]`'s opened statement, as the exact text it signed (rc.4).
 */
export type BTPEvidenceBundle = Omit<z.infer<typeof BtpEvidenceBundleSchema>, 'cosignatures'> & {
  cosignatures: BTPCosignature[];
};

/**
 * Since 1.2: a key a signature was checked with: whose, under which selector,
 * and its fingerprint. Taken from the bundle, so it says what the bundle
 * holds, not that the key was its identity's: no fingerprint when the bundle
 * has no usable key for it. A device key has no selector.
 */
export type BTPEvidenceKey = { identity: string; selector?: string; fingerprint?: string };

/**
 * Since 1.2: a signing identity's key chain, as a bundle carries it, with the
 * operator's signed lookup answer that served it, when the builder kept it.
 */
export type BTPEvidenceKeyChain = {
  identity: string;
  records: BTPKeyChainRecord[];
  operatorAnswer?: BTPServerResponse;
};

/** Since 1.2: when the bundle's builder received a cosignature (rc.4), signed by it at the time. */
export type BTPEvidenceArrival = {
  cosignatureSha256: string;
  arrivedAt: string;
  receivedBy: string;
  selector: string;
  signature: BTPSignature;
};

/**
 * Since 1.2: the operator's answer a bundle keeps with a chain. Its key, like
 * every key in a bundle, is the bundle's own: the answer confirms a lost key's
 * rotation only when that key is one the reader trusts.
 */
export type BTPEvidenceOperatorAnswerFacts = {
  /** Who signed it */
  signedBy: string;
  /** Its signature holds, by the key the bundle holds for `signedBy` */
  signatureValid: boolean;
  /** It names this chain's identity and carries this chain, record for record */
  answersThisChain: boolean;
  /**
   * Its key is the one the reader named as the operator of the chain
   * identity's domain (`operators`), or, online, `signedBy` is the operator
   * DNS names there (`op=`) and its key is confirmed as `signedBy`'s
   */
  operatorKeyAnchored: boolean;
};

/** Since 1.2: a signature's key, against its identity's key chain. Facts, never a verdict. */
export type BTPEvidenceKeyChainFacts = {
  /** Every record is well-formed and signed as its kind requires, and the chain rules hold */
  chainValid: boolean;
  /** The first rule broken, when not valid */
  problem?: string;
  /** The key that signed is a key of the chain */
  keyInChain: boolean;
  /**
   * A lost key's rotation that neither an online anchor nor an operator's
   * answer, by an operator key the reader trusts, confirms
   */
  authorityUnverified: boolean;
  /** The operator's answer the bundle keeps with the chain, when it keeps one */
  operatorAnswer?: BTPEvidenceOperatorAnswerFacts;
  /** The bundle's chain gives a key two successors */
  forked: boolean;
  /** The fingerprint of the chain's last key */
  reachesKey?: string;
  /** What confirms the chain, and up to which key: a kept fingerprint, or online */
  anchored: BTPKeyChainFacts['anchored'];
  /** When the key that signed was rotated away from, if it was */
  rotatedAt?: string;
  /** When the key that signed was expired, from when, and why */
  expiredImmediately?: { at: string; compromisedSince: string; reason: BTPKeyExpiryReason };
  /** The time the signer claims is in the key's window, before any compromisedSince */
  signedInWindow: boolean;
  /** The same, by a trusted timestamp's time; absent without one */
  signedInWindowIndependently?: boolean;
  /**
   * The key's owner declared it expired from before a statement it had
   * already received (by a signed arrival or a trusted timestamp): the
   * owner moved the line back past it. Absent without such a time.
   */
  disownedAfterTheFact?: boolean;
};

/** Since 1.2: what an evidence bundle shows. BTPS reports these and decides nothing. */
export type BTPEvidenceFacts = {
  /** The SHA-256 of the agreement's content, as the bundle holds it */
  contentSha256: string;
  /** The originator's signature is over this content */
  originatorSignatureValid: boolean;
  /** The key the originator's signature was checked with */
  originatorKey: BTPEvidenceKey;
  /** Since 1.2: the originator's key against its key chain, when the bundle carries one */
  originatorKeyChain?: BTPEvidenceKeyChainFacts;
  /**
   * False unless checked `online`: then true when every key a signature was
   * checked with is its identity's, by its chain anchored online or by DNS.
   */
  keysConfirmedOnline: boolean;
  /** Each term is the SHA-256 of one of its attachments, as attached */
  termsAttached: boolean;
  /** Each signer's cosignature and its opened statement, in the bundle's order */
  statements: {
    /** Its cosignature is signed by its signer's key, or by a device its delegation vouches for */
    signatureValid: boolean;
    /** Which kind of key signed it, from the cosignature itself */
    keyKind: 'identity' | 'device';
    /** For a device: who signed its delegation, and who attested it, if anyone */
    delegatedBy?: string;
    attestedBy?: string;
    /** Since rc.4: its opened statement is the exact text its cosignature signed, and says what it says */
    statementMatches: boolean;
    signer: string;
    /** What it decided, from its opened statement; absent when that is not the statement it signed */
    decision?: 'accepted' | 'declined';
    /** The key its signature was checked with: the signer's identity key, or its device's key */
    key: BTPEvidenceKey;
    /** For a device: the key its delegation was checked with, the delegator's */
    delegationKey?: BTPEvidenceKey;
    /** It names this agreement: its originator, id and content */
    agreementMatches: boolean;
    /** It repeats the agreement's terms exactly */
    termsMatch: boolean;
    /** It was signed no later than `acceptance.by` */
    withinDeadline: boolean;
    /** It follows the signers and order, after the statements before it */
    inOrder: boolean;
    /** Its RFC 3161 timestamp, when the bundle has one for it */
    timestamp?: BTPTimestampFacts;
    /** Since 1.2: when the bundle's builder received it, and whether that is signed by it */
    arrival?: { at: string; receivedBy: string; signatureValid: boolean };
    /** Since 1.2: its signing key (a device's: its delegator's) against its key chain */
    keyChain?: BTPEvidenceKeyChainFacts;
  }[];
  /**
   * Every fact above holds, and every signer accepted, once. A timestamp is
   * optional and never part of it. Checked against the bundle's own keys: it
   * says the bundle is consistent, not that each key was its identity's.
   */
  complete: boolean;
};

/** A key, by whose and under which selector, with the fingerprint of what the bundle holds for it. */
const bundleKey = (keyOf: BTPKeyOf, identity: string, selector: string): BTPEvidenceKey => {
  const fingerprint = fingerprintOf(keyOf(identity, selector));
  return { identity, selector, ...(fingerprint && { fingerprint }) };
};

const fingerprintOf = (publicKey: string | undefined): string | undefined => {
  if (!publicKey) return undefined;
  try {
    return getFingerprintFromPem(publicKey);
  } catch {
    return undefined;
  }
};

/** The keys a cosignature's signatures were checked with. */
const cosignatureKeys = (
  cosignature: BTPCosignature,
  keyOf: BTPKeyOf,
): { key: BTPEvidenceKey; delegationKey?: BTPEvidenceKey } => {
  const { signer } = cosignature;
  if (cosignature.selector !== undefined)
    return { key: bundleKey(keyOf, signer, cosignature.selector) };
  if (!cosignature.delegatedArtifact) return { key: { identity: signer } };
  const { delegation } = cosignature.delegatedArtifact;
  const fingerprint = fingerprintOf(delegation.agentPubKey);
  return {
    key: { identity: signer, ...(fingerprint && { fingerprint }) },
    delegationKey: bundleKey(keyOf, delegation.signedBy, delegation.selector),
  };
};

const sha256Hex = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

const isValid = (payload: unknown, signature: BTPSignature, key: string | undefined) =>
  key !== undefined && verifySignature(payload, signature, key).isValid;

/**
 * What a cosignature's signature shows, from the bundle alone: by its signer's key at its selector, or, a device's,
 * when its delegation is its delegator's over the artifact that delivered it (which it names), any attestation is
 * its attestor's, the artifact came from the signer and is signed by the delegated key, and so is the cosignature.
 * Whether the delegator or attestor is the signer's domain's operator needs DNS: `delegatedBy` and `attestedBy` say who.
 */
const cosignatureSignatureFacts = (cosignature: BTPCosignature, keyOf: BTPKeyOf) => {
  const signed = cosignatureSignedPart(cosignature);
  if (cosignature.selector !== undefined) {
    return {
      signatureValid: isValid(
        signed,
        cosignature.signature,
        keyOf(cosignature.signer, cosignature.selector),
      ),
      keyKind: 'identity' as const,
    };
  }
  if (!cosignature.delegatedArtifact) return { signatureValid: false, keyKind: 'device' as const };
  const { delegation, ...artifact } = cosignature.delegatedArtifact;
  const { signature: delegationSignature, attestation, ...unsignedDelegation } = delegation;
  const { signature: artifactSignature, ...unsignedArtifact } = artifact;
  const attested =
    !attestation ||
    (() => {
      const { signature, ...unsigned } = attestation;
      return isValid(
        { ...delegation, attestation: unsigned },
        signature,
        keyOf(attestation.signedBy, attestation.selector),
      );
    })();
  const signatureValid =
    sameIdentity(artifact.from, cosignature.signer) &&
    artifact.id === cosignature.artifactId &&
    (!sameIdentity(delegation.signedBy, artifact.from) || attestation !== undefined) &&
    isValid(
      { ...artifact, delegation: unsignedDelegation },
      delegationSignature,
      keyOf(delegation.signedBy, delegation.selector),
    ) &&
    attested &&
    isValid(unsignedArtifact, artifactSignature, delegation.agentPubKey) &&
    isValid(signed, cosignature.signature, delegation.agentPubKey);
  return {
    signatureValid,
    keyKind: 'device' as const,
    delegatedBy: delegation.signedBy,
    ...(attestation && { attestedBy: attestation.signedBy }),
  };
};

/** A bundle's keys, as `keyOf`: a key counts only when its fingerprint is its own. */
const keysOf = (bundle: Pick<BTPEvidenceBundle, 'keys'>): BTPKeyOf => {
  const keys = bundle.keys.filter((key) => {
    try {
      return getFingerprintFromPem(key.publicKey) === key.fingerprint;
    } catch {
      return false;
    }
  });
  return (identity, selector) =>
    keys.find((key) => sameIdentity(key.identity, identity) && key.selector === selector)
      ?.publicKey;
};

/** What an arrival signs: typed, so it is never taken for another BTPS signature. */
const arrivalSigned = (arrival: Omit<BTPEvidenceArrival, 'signature'>) => ({
  type: 'btps.arrival.v1',
  ...arrival,
});

/**
 * Since 1.2: that the bundle's builder received a statement, at `arrivedAt`,
 * signed then by `receivedBy` (the party that received it) at `selector`. A
 * platform signs each when the statement arrives and keeps it for the
 * bundle: it is the receiver's record, independent of the signer.
 */
export const signArrival = async (
  arrival: Omit<BTPEvidenceArrival, 'signature'>,
  holder: BTPKeyHolder,
): Promise<BTPEvidenceArrival> => {
  const signed = arrivalSigned(arrival);
  const signature =
    'signer' in holder
      ? await signBtpPayloadWithSigner(signed, holder.signer)
      : signBtpPayload(signed, holder.pemFiles);
  return { ...arrival, signature };
};

/** Whether `time` is in a key's window: from it, before it was left, and before any compromise. */
const inWindow = (key: BTPKeyChainKey, time: string) => {
  const at = Date.parse(time);
  return (
    (key.validFrom === undefined || at >= Date.parse(key.validFrom)) &&
    (key.validUntil === undefined || at < Date.parse(key.validUntil)) &&
    (key.compromisedSince === undefined || at < Date.parse(key.compromisedSince))
  );
};

/**
 * A chain's operator answer: whether it is signed by the key the bundle holds
 * for its signer, for this chain, and whether that key is anchored as the
 * operator of the chain identity's domain: the fingerprint the reader named
 * for that domain (`operators`), or confirmed online as the operator DNS names
 * (`keyConfirmedOnline`). A plain anchor never counts here: it vouches for the
 * key's own records, not for what that key says of another identity.
 */
const operatorAnswerFacts = (
  chain: BTPEvidenceKeyChain,
  context: { operators?: Record<string, string>; keyOf: BTPKeyOf; keyConfirmedOnline: boolean },
): BTPEvidenceOperatorAnswerFacts | undefined => {
  const answer = chain.operatorAnswer;
  if (!answer?.signedBy) return undefined;
  const { signature, ...signed } = answer;
  const key = answer.selector ? context.keyOf(answer.signedBy, answer.selector) : undefined;
  const fingerprint = fingerprintOf(key);
  const document = answer.document as { identity?: string; keyChain?: unknown } | undefined;
  const domain = parseIdentity(chain.identity)?.domainName.toLowerCase();
  const named = Object.entries(context.operators ?? {}).find(
    ([operatorOf]) => operatorOf.toLowerCase() === domain,
  )?.[1];
  return {
    signedBy: answer.signedBy,
    signatureValid: !!key && !!signature && verifySignature(signed, signature, key).isValid,
    answersThisChain:
      document?.identity !== undefined &&
      sameIdentity(document.identity, chain.identity) &&
      canonicalizeValue(document.keyChain) === canonicalizeValue(chain.records),
    operatorKeyAnchored:
      fingerprint !== undefined && (fingerprint === named || context.keyConfirmedOnline),
  };
};

/**
 * A signature's key against its identity's chain in the bundle, at the time it
 * claims and at a time the signer could not set (`independent`: a trusted
 * timestamp's, or a signed arrival's). Online facts, when given, anchor it.
 */
const keyChainFactsFor = (
  chain: BTPEvidenceKeyChain,
  fingerprint: string | undefined,
  times: { claimed: string; timestamped?: string; independent?: string },
  context: {
    anchors?: string[];
    operators?: Record<string, string>;
    online?: BTPKeyChainFacts;
    keyOf: BTPKeyOf;
    operatorKeyConfirmedOnline: boolean;
  },
): BTPEvidenceKeyChainFacts => {
  const facts = keyChainFactsOf(checkKeyChain(chain.records, chain.identity), {
    anchors: context.anchors,
  });
  const key = fingerprint === undefined ? undefined : keyAt(facts, { fingerprint });
  const { online } = context;
  const anchored =
    online?.anchored && fingerprint !== undefined && keyAt(online, { fingerprint })
      ? online.anchored
      : facts.anchored;
  const { timestamped, independent } = times;
  const expiredAt = key?.expiredAt;
  const operatorAnswer = operatorAnswerFacts(chain, {
    operators: context.operators,
    keyOf: context.keyOf,
    keyConfirmedOnline: context.operatorKeyConfirmedOnline,
  });
  // Only an answer by an operator key the reader trusts confirms a lost key's rotation.
  const answerConfirms =
    !!operatorAnswer &&
    operatorAnswer.signatureValid &&
    operatorAnswer.answersThisChain &&
    operatorAnswer.operatorKeyAnchored;
  return {
    chainValid: facts.chainValid,
    ...(facts.problem !== undefined && { problem: facts.problem }),
    keyInChain: key !== undefined,
    authorityUnverified:
      facts.authorityUnverified &&
      (anchored === false || anchored.by !== 'online') &&
      !answerConfirms,
    ...(operatorAnswer && { operatorAnswer }),
    forked: facts.forked,
    ...(facts.keys.length > 0 && { reachesKey: facts.keys.at(-1)?.fingerprint }),
    anchored,
    ...(key?.validUntil !== undefined && { rotatedAt: key.validUntil }),
    ...(key?.compromisedSince !== undefined &&
      expiredAt !== undefined &&
      key.reason !== undefined && {
        expiredImmediately: {
          at: expiredAt,
          compromisedSince: key.compromisedSince,
          reason: key.reason,
        },
      }),
    signedInWindow: key !== undefined && inWindow(key, times.claimed),
    ...(timestamped !== undefined && {
      signedInWindowIndependently: key !== undefined && inWindow(key, timestamped),
    }),
    ...(key?.compromisedSince !== undefined &&
      expiredAt !== undefined &&
      independent !== undefined && {
        disownedAfterTheFact:
          Date.parse(independent) < Date.parse(expiredAt) &&
          Date.parse(independent) >= Date.parse(key.compromisedSince),
      }),
  };
};

/**
 * Since 1.2: the facts of an agreement's evidence bundle, checked offline from
 * the bundle alone. A bundle that is not well formed is refused
 * (`BTP_ERROR_VALIDATION`). Whether a key really was its identity's at the
 * time, and whether a device's delegator is its domain's operator, are facts
 * a reader may confirm online; the bundle embeds the keys so it checks without.
 * A statement's RFC 3161 timestamp, when there is one, is reported with it;
 * with `trustedTimestampRoots` (PEM), whether its authority is trusted too.
 *
 * Since 1.2, each signing key is reported against its identity's key chain
 * when the bundle carries one (`keyChains`), and each statement's signed
 * arrival (`arrivals`) with it. `anchors` are signing-key fingerprints the
 * reader kept. `operators` are the fingerprints the reader kept of domains'
 * operators, by domain: an operator's answer in the bundle confirms a lost
 * key's rotation only by the one named for the chain identity's domain, or
 * online, by the operator DNS names there. `online` confirms each key now as its identity's (`onlineKeyChain`): a key
 * of its identity's chain, which must hold online as a server requires, or its
 * DNS key when there is no chain; only then is `keysConfirmedOnline` true. A
 * key since rotated away or expired is still its identity's: when it was
 * valid is in the key chain facts.
 */
export const verifyEvidenceBundle = async (
  bundle: unknown,
  options: {
    trustedTimestampRoots?: string[];
    anchors?: string[];
    operators?: Record<string, string>;
    online?: BTPKeyChainCheck;
  } = {},
): Promise<BTPEvidenceFacts> => {
  const parsed = BtpEvidenceBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    throw new BTPErrorException(BTP_ERROR_VALIDATION, {
      cause: `not an evidence bundle: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    });
  }
  const { originator, agreement } = parsed.data;
  const cosignatures = parsed.data.cosignatures as BTPCosignature[];
  const keyOf = keysOf(parsed.data);
  const { by, terms, signers, signingOrder } = agreement.acceptance;
  const ref = agreementRef(agreement, originator);

  const termsAttached = terms.every((term) =>
    agreement.attachments?.some(
      ({ sha256, content }) =>
        sha256 === term && sha256Hex(Buffer.from(content, 'base64')) === term,
    ),
  );
  const answered: BTPAgreementAnswers['answered'] = [];
  // Each cosignature's opened statement, held to the exact text it signed; an unusable one is reported, never trusted.
  const opened = cosignatures.map((cosignature, i) => {
    const text = parsed.data.statements[i];
    const result = text === undefined ? undefined : statementOfText(cosignature, text);
    return result !== undefined && 'statement' in result ? result.statement : undefined;
  });
  const statementFacts = cosignatures.map((cosignature, i) => {
    // An unusable statement says nothing: what holds of it is only what its signed cosignature says.
    const statement = opened[i];
    const named = cosignature.ref;
    const facts = {
      signer: cosignature.signer,
      ...(statement && { decision: statement.decision }),
      ...cosignatureSignatureFacts(cosignature, keyOf),
      ...cosignatureKeys(cosignature, keyOf),
      statementMatches:
        statement !== undefined && cosignatures.length === parsed.data.statements.length,
      agreementMatches:
        sameIdentity(named.originator, ref.originator) &&
        named.id === ref.id &&
        named.contentSha256 === ref.contentSha256,
      termsMatch:
        statement !== undefined &&
        statement.terms.length === terms.length &&
        statement.terms.every((t, n) => t === terms[n]),
      withinDeadline:
        statement !== undefined &&
        (by === undefined || Date.parse(statement.signedAt) <= Date.parse(by)),
      inOrder:
        agreementOrderProblem(
          { from: cosignature.signer, previous: cosignature.previous },
          { signers: signers.map(({ address }) => address), signingOrder, answered },
        ) === undefined,
    };
    // One whose decision is not shown is taken as not ending the order: its own facts already say it does not hold.
    answered.push({
      signer: cosignature.signer,
      decision: statement?.decision ?? 'accepted',
      sha256: cosignatureSha256(cosignature),
    });
    return facts;
  });
  // Timestamps are optional: each is reported with its statement and decides nothing.
  const timestamped: BTPEvidenceFacts['statements'] = await Promise.all(
    statementFacts.map(async (facts, i) => {
      const sha256 = answered[i]?.sha256 ?? '';
      const token = parsed.data.timestamps?.find((t) => t.cosignatureSha256 === sha256)?.token;
      if (token === undefined) return facts;
      const trustedRoots = options.trustedTimestampRoots;
      return { ...facts, timestamp: await timestampFacts(token, sha256, { trustedRoots }) };
    }),
  );

  // Since 1.2: online, each key a signature was checked with, but a device's own, is
  // confirmed now as its identity's: the originator's, each statement's or its
  // delegator's, and an attestor's.
  type Signing = [identity: string, selector: string | undefined, fingerprint?: string];
  const signing: Signing[] = [
    [originator, agreement.originatorSignature.selector],
    ...timestamped.flatMap((s, i): Signing[] => {
      const used = s.delegationKey ?? s.key;
      const attestation = cosignatures[i]?.delegatedArtifact?.delegation.attestation;
      return [
        [used.identity, used.selector, used.fingerprint],
        ...(attestation ? [[attestation.signedBy, attestation.selector] as Signing] : []),
      ];
    }),
  ];
  const onlineChains = new Map<string, Awaited<ReturnType<typeof onlineKeyChain>>>();
  // A key is its identity's now: a key of its chain anchored online, or its DNS key.
  const confirmedOnline = async (
    check: BTPKeyChainCheck,
    [identity, selector, fingerprint]: Signing,
  ): Promise<boolean> => {
    const id = identity.toLowerCase();
    if (!onlineChains.has(id)) onlineChains.set(id, await onlineKeyChain(identity, check));
    const online = onlineChains.get(id)!;
    const used = fingerprint ?? fingerprintOf(selector && keyOf(identity, selector));
    if (used === undefined) return false;
    if (online.status === 'checked')
      return keyAt(online.facts, { fingerprint: used }) !== undefined;
    if (online.status === 'none' && selector !== undefined) {
      // DNS that cannot be read confirms nothing; the bundle's facts still stand.
      const inDns = await signatureKey(identity, selector).catch(() => undefined);
      return fingerprintOf(inDns) === used;
    }
    return false;
  };
  let confirmed = options.online !== undefined;
  if (options.online) {
    for (const key of signing) {
      // Every key is looked up, so each chain's online facts are there for its key chain facts.
      const holds = await confirmedOnline(options.online, key);
      confirmed &&= holds;
    }
  }
  const keyChains = (parsed.data.keyChains ?? []) as BTPEvidenceKeyChain[];
  const chainOf = (identity: string) => keyChains.find((c) => sameIdentity(c.identity, identity));
  // Online, an operator answer counts only when its signer is the operator DNS names for the
  // chain identity's domain (`op=`), and its key is confirmed as that signer's.
  const operatorKeysOnline = new Map<BTPEvidenceKeyChain, boolean>();
  if (options.online) {
    for (const chain of keyChains) {
      const { signedBy, selector } = chain.operatorAnswer ?? {};
      if (!signedBy || !selector) continue;
      const operator = (await getHostAndSelector(chain.identity).catch(() => undefined))?.operator;
      operatorKeysOnline.set(
        chain,
        operator !== undefined &&
          sameIdentity(operator, signedBy) &&
          (await confirmedOnline(options.online, [signedBy, selector])),
      );
    }
  }
  const onlineFactsOf = (identity: string) => {
    const online = onlineChains.get(identity.toLowerCase());
    return online?.status === 'checked' ? online.facts : undefined;
  };
  const chainFacts = (
    identity: string,
    fingerprint: string | undefined,
    times: { claimed: string; timestamped?: string; independent?: string },
  ) => {
    const chain = chainOf(identity);
    if (!chain) return undefined;
    return keyChainFactsFor(chain, fingerprint, times, {
      anchors: options.anchors,
      operators: options.operators,
      online: onlineFactsOf(identity),
      keyOf,
      operatorKeyConfirmedOnline: operatorKeysOnline.get(chain) ?? false,
    });
  };
  const arrivals = new Map(
    (parsed.data.arrivals ?? []).map((arrival) => {
      const { signature, ...unsigned } = arrival;
      const key = keyOf(arrival.receivedBy, arrival.selector);
      const signatureValid =
        !!key && verifySignature(arrivalSigned(unsigned), signature, key).isValid;
      return [
        arrival.cosignatureSha256,
        { at: arrival.arrivedAt, receivedBy: arrival.receivedBy, signatureValid },
      ];
    }),
  );
  const withChains = timestamped.map((facts, i) => {
    const arrival = arrivals.get(answered[i]?.sha256 ?? '');
    const stamp = facts.timestamp;
    const timestampedAt =
      stamp?.trusted && stamp.imprintMatches && stamp.signatureValid ? stamp.time : undefined;
    const used = facts.delegationKey ?? facts.key;
    const keyChain = chainFacts(used.identity, used.fingerprint, {
      claimed: opened[i]?.signedAt ?? '',
      timestamped: timestampedAt,
      independent: timestampedAt ?? (arrival?.signatureValid ? arrival.at : undefined),
    });
    return { ...facts, ...(arrival && { arrival }), ...(keyChain && { keyChain }) };
  });

  const originatorValid = originatorSignatureValid(agreement, originator, keyOf);
  const originatorKey = bundleKey(keyOf, originator, agreement.originatorSignature.selector);
  const originatorKeyChain = chainFacts(originator, originatorKey.fingerprint, {
    claimed: agreement.issuedAt,
  });
  const complete =
    originatorValid &&
    termsAttached &&
    statementFacts.length === signers.length &&
    statementFacts.every(
      (fact) =>
        fact.decision === 'accepted' &&
        fact.signatureValid &&
        fact.statementMatches &&
        fact.agreementMatches &&
        fact.termsMatch &&
        fact.withinDeadline &&
        fact.inOrder,
    );
  return {
    contentSha256: agreementContentSha256(agreement),
    originatorSignatureValid: originatorValid,
    originatorKey,
    ...(originatorKeyChain && { originatorKeyChain }),
    keysConfirmedOnline: confirmed,
    termsAttached,
    statements: withChains,
    complete,
  };
};

/**
 * Since 1.2: an agreement's evidence bundle, from the opened agreement, its
 * cosignatures in the order they were taken and their statements, and the keys `keyOf` gives:
 * the originator's, each signer's, and each device's delegator and attestor.
 * A key it cannot find is refused (`BTP_ERROR_RESOLVE_PUBKEY`): a bundle
 * without it would not check offline.
 *
 * Since 1.2, optional: `keyChains`, each signing identity's key chain (from
 * `BtpsClient.lookupKeyChain`), with the operator's answer that served it (its
 * `answer`, as `operatorAnswer`); a
 * key `keyOf` no longer finds (its DNS record retired) is taken from its
 * identity's chain. And `arrivals`, signed with `signArrival` as each
 * statement arrived. Their signers' keys join `keys`.
 */
export const buildEvidenceBundle = (
  parts: Pick<BTPEvidenceBundle, 'originator' | 'agreement'> & {
    cosignatures: BTPCosignature[];
    /** Each cosignature's statement, as decryptVerify opened it (`cosigned`); kept as the exact text it signed */
    statements: BTPAgreementStatement[];
    keyChains?: BTPEvidenceKeyChain[];
    arrivals?: BTPEvidenceArrival[];
  },
  keyOf: BTPKeyOf,
): BTPEvidenceBundle => {
  const { originator, agreement, cosignatures, statements, keyChains, arrivals } = parts;
  const needed: [string, string][] = [[originator, agreement.originatorSignature.selector]];
  for (const cosignature of cosignatures) {
    if (cosignature.selector !== undefined) {
      needed.push([cosignature.signer, cosignature.selector]);
      continue;
    }
    if (!cosignature.delegatedArtifact) {
      throw new BTPErrorException(BTP_ERROR_VALIDATION, {
        cause: `${cosignature.signer}'s device cosignature needs the delegated artifact that delivered it`,
      });
    }
    const { delegation } = cosignature.delegatedArtifact;
    needed.push([delegation.signedBy, delegation.selector]);
    if (delegation.attestation) {
      needed.push([delegation.attestation.signedBy, delegation.attestation.selector]);
    }
  }
  for (const chain of keyChains ?? []) {
    const answer = chain.operatorAnswer;
    if (answer?.signedBy && answer.selector) needed.push([answer.signedBy, answer.selector]);
  }
  for (const arrival of arrivals ?? []) needed.push([arrival.receivedBy, arrival.selector]);
  // A key its identity rotated away from is in its chain, though DNS no longer has it.
  const chainKeyOf = (identity: string, selector: string) => {
    const chain = keyChains?.find((c) => sameIdentity(c.identity, identity));
    if (!chain) return undefined;
    const facts = keyChainFactsOf(checkKeyChain(chain.records, chain.identity), {});
    return keyAt(facts, { selector })?.publicKey;
  };
  const keys: BTPEvidenceBundle['keys'] = [];
  for (const [identity, selector] of needed) {
    if (keys.some((key) => sameIdentity(key.identity, identity) && key.selector === selector)) {
      continue;
    }
    const publicKey = keyOf(identity, selector) ?? chainKeyOf(identity, selector);
    if (publicKey === undefined) {
      throw new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY, {
        cause: `no key for ${identity} at ${selector}`,
      });
    }
    keys.push({ identity, selector, publicKey, fingerprint: getFingerprintFromPem(publicKey) });
  }
  return {
    format: 'btps-evidence/1',
    originator,
    agreement,
    cosignatures,
    statements: statements.map(cosignedStatementText),
    keys,
    ...(keyChains?.length && { keyChains }),
    ...(arrivals?.length && { arrivals }),
  } as BTPEvidenceBundle;
};

/**
 * Since 1.2: an evidence bundle's facts as plain text, one line a fact, as the
 * `btps-verify-evidence` command prints them. Facts only: it says what holds
 * and what does not, never whether to rely on it.
 */
export const describeEvidenceFacts = (facts: BTPEvidenceFacts): string => {
  const mark = (fact: boolean) => (fact ? 'yes' : 'NO');
  const line = (label: string, value: string) => `${label.padEnd(27)}${value}`;
  const keyText = ({ identity, selector, fingerprint }: BTPEvidenceKey) =>
    `${identity}${selector ? ` at ${selector}` : ''}, fingerprint ${fingerprint ?? 'none in the bundle'}`;
  // Since 1.2: a signing key against its identity's key chain.
  const chainText = (c: BTPEvidenceKeyChainFacts, indent: string) => {
    const anchored = c.anchored ? `${c.anchored.by}, up to ${c.anchored.upTo}` : 'NO';
    const independently =
      c.signedInWindowIndependently === undefined
        ? ''
        : `, by its timestamp ${mark(c.signedInWindowIndependently)}`;
    return [
      `${indent}key chain valid ${mark(c.chainValid)}${c.problem ? ` (${c.problem})` : ''}, key in it ${mark(c.keyInChain)}, forked ${c.forked ? 'YES' : 'no'}`,
      `${indent}   anchored ${anchored}${c.authorityUnverified ? ", a lost key's rotation unconfirmed" : ''}`,
      ...(c.operatorAnswer
        ? [
            `${indent}   operator's answer by ${c.operatorAnswer.signedBy}: signed ${mark(c.operatorAnswer.signatureValid)}, this chain ${mark(c.operatorAnswer.answersThisChain)}, its key anchored ${mark(c.operatorAnswer.operatorKeyAnchored)}`,
          ]
        : []),
      `${indent}   signed while the key was its ${mark(c.signedInWindow)}${independently}`,
      ...(c.rotatedAt ? [`${indent}   rotated away ${c.rotatedAt}`] : []),
      ...(c.expiredImmediately
        ? [
            `${indent}   EXPIRED ${c.expiredImmediately.at} (${c.expiredImmediately.reason}), compromised since ${c.expiredImmediately.compromisedSince}`,
          ]
        : []),
      ...(c.disownedAfterTheFact
        ? [`${indent}   DISOWNED after the fact: it arrived before the expiry was declared`]
        : []),
    ];
  };
  const lines = [
    line('content sha256', facts.contentSha256),
    line("originator's signature", mark(facts.originatorSignatureValid)),
    line("originator's key", keyText(facts.originatorKey)),
    ...(facts.originatorKeyChain ? chainText(facts.originatorKeyChain, '') : []),
    line('terms are its attachments', mark(facts.termsAttached)),
  ];
  facts.statements.forEach((s, i) => {
    const key = s.keyKind === 'device' ? `device, delegated by ${s.delegatedBy}` : 'identity';
    const attested = s.attestedBy ? `, attested by ${s.attestedBy}` : '';
    lines.push(
      '',
      `${i + 1}. ${s.signer}: ${s.decision ?? 'its statement is not the one it signed'} (${key}${attested})`,
      `   key ${keyText(s.key)}`,
      ...(s.delegationKey ? [`   delegation key ${keyText(s.delegationKey)}`] : []),
      `   signature ${mark(s.signatureValid)}, the statement it signed ${mark(s.statementMatches)}, this agreement ${mark(s.agreementMatches)}`,
      `   these terms ${mark(s.termsMatch)}, by the deadline ${mark(s.withinDeadline)}, in order ${mark(s.inOrder)}`,
    );
    const stamp = s.timestamp;
    if (stamp) {
      const trusted = stamp.trusted === undefined ? 'no roots given' : mark(stamp.trusted);
      const authority =
        stamp.timestampingKeyUsage === undefined
          ? ''
          : `, an authority's certificate ${mark(stamp.timestampingKeyUsage)}`;
      lines.push(
        `   timestamped ${stamp.time ?? 'unreadable'} by ${stamp.authority ?? 'unknown'}: over this statement ${mark(stamp.imprintMatches)}, signed ${mark(stamp.signatureValid)}${authority}, trusted ${trusted}`,
      );
    }
    if (s.arrival) {
      lines.push(
        `   arrived ${s.arrival.at}, received by ${s.arrival.receivedBy}, signed ${mark(s.arrival.signatureValid)}`,
      );
    }
    if (s.keyChain) lines.push(...chainText(s.keyChain, '   '));
  });
  lines.push(
    '',
    ...(facts.keysConfirmedOnline
      ? ["keys confirmed online: each key was its identity's, by its chain or DNS, now"]
      : [
          'keys from the bundle, not confirmed online: complete says the bundle is',
          "consistent, not that each key was its identity's when it signed",
        ]),
    line('complete', mark(facts.complete)),
  );
  return lines.join('\n');
};
