/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTP_DOC_LIMITS } from './documents.js';

export const BTP_PROTOCOL_VERSION = '1.0.0';
export const MIN_SUPPORTED_VERSION = '1.0.0';
export const MAX_SUPPORTED_VERSION = '1.0.0';
export const BTPS_DNS_HOST_NAME_SPACE = '_btps.host';
export const BTPS_DNS_IDENTITY_NAME_SPACE = '_btps.identity';
/**
 * The shortest RSA key the protocol accepts, in bits, for encryption and for
 * signatures alike (fix list 12, EBA-445). A shorter key is refused with
 * BTP_ERROR_KEY_TOO_SMALL before it is used.
 */
export const BTP_MIN_RSA_KEY_BITS = 2048;

const ENCODED_ATTACHMENTS_MAX_LENGTH =
  BTP_DOC_LIMITS.ATTACHMENTS_MAX * BTP_DOC_LIMITS.ATTACHMENT_CONTENT_MAX_LENGTH;
/** The rest of a document beside its attachments' files, and the transporter envelope. */
const DOCUMENT_REST_ALLOWANCE = 1024 * 1024;
/** What wraps an encrypted document: signature, delegation, encryption block, an agent artifact. */
const ENVELOPE_ALLOWANCE = 64 * 1024;

/**
 * The longest line a server reads, in characters (fix list 10, EBA-122):
 * one artifact as large as the document caps allow, encrypted.
 * - attachments: 10 (ATTACHMENTS_MAX) × 13,981,016 (ATTACHMENT_CONTENT_MAX_LENGTH,
 *   10 MiB in base64) = 139,810,160;
 * - plus 1 MiB for the rest of the document: 140,858,736;
 * - encrypted, the document travels as the base64 of its AES-GCM ciphertext,
 *   which is as long as the plaintext: 4 × ⌈140,858,736 / 3⌉ = 187,811,648;
 * - plus 64 KiB for the envelope around it: 187,877,184 (about 179 MiB).
 * An unencrypted document of the same size is a quarter shorter.
 */
export const BTP_MAX_LINE_LENGTH =
  4 * Math.ceil((ENCODED_ATTACHMENTS_MAX_LENGTH + DOCUMENT_REST_ALLOWANCE) / 3) +
  ENVELOPE_ALLOWANCE;
