/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: the shape of a key chain's records. That a record is signed by
 * the keys it names, and that the records form one chain, is checked by
 * verifyKeyChain (@core/trust/keyRotation.ts), not here.
 */

import { z } from 'zod';
import { BTPS_FIELD_LIMITS } from '../constants/limits.js';
import { BtpSignatureSchema, identitySchema } from './shared.js';
import { boundedArray } from './bounded.js';

const { keyChain: LIMITS } = BTPS_FIELD_LIMITS;

// Not btpsDocsSchema's sha256Hex: that module imports this one, for the identity lookup's answer.
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 in lowercase hex');
// A selector is a DNS label: <selector>._btps.identity.<account>.<domain>.
const selector = z.string().regex(/^[A-Za-z0-9_-]{1,63}$/, 'must be a DNS label');
const fingerprint = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'must be a SHA-256 in base64');
const time = z.string().datetime();
const reason = z.enum(['compromised', 'lost']);

const BtpRotatedKeySchema = z
  .object({
    selector,
    fingerprint,
    publicKey: z
      .string()
      .max(LIMITS.publicKey)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be a DER SPKI in base64'),
  })
  .strict();

export const BtpKeyRotationSchema = z
  .object({
    type: z.literal('btps.keyRotation.v1'),
    identity: identitySchema,
    from: BtpRotatedKeySchema,
    to: BtpRotatedKeySchema,
    at: time,
    expiry: z.enum(['planned', 'immediate']),
    compromisedSince: time.optional(),
    reason: reason.optional(),
    prev: sha256Hex.nullable(),
  })
  .strict()
  .superRefine((rotation, ctx) => {
    const immediate = rotation.expiry === 'immediate';
    for (const field of ['compromisedSince', 'reason'] as const) {
      if ((rotation[field] !== undefined) !== immediate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is on a rotation with immediate expiry, and only there`,
        });
      }
    }
  });

export const BtpKeyExpirySchema = z
  .object({
    type: z.literal('btps.keyExpiry.v1'),
    identity: identitySchema,
    key: z.object({ selector, fingerprint }).strict(),
    compromisedSince: time,
    reason,
    at: time,
    prev: sha256Hex,
  })
  .strict();

const BtpKeyChainSignatureSchema = BtpSignatureSchema.extend({
  by: z.enum(['from', 'to', 'current']),
}).strict();

const signatures = boundedArray(BtpKeyChainSignatureSchema, 2, 1);
// An RFC 3161 token, DER in base64, over the record's signed bytes.
const timestamp = z.string().min(1).optional();

export const BtpKeyChainRecordSchema = z.union([
  z.object({ rotation: BtpKeyRotationSchema, signatures, timestamp }).strict(),
  z.object({ expiry: BtpKeyExpirySchema, signatures, timestamp }).strict(),
]);

export const BtpKeyChainSchema = boundedArray(BtpKeyChainRecordSchema, LIMITS.records);
