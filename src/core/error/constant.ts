import { BTPError } from './types.js';

export const BTP_ERROR_IDENTITY: BTPError = {
  code: 'BTP_ERROR_IDENTITY',
  message: 'BTP identity is expected in the format username$domain.',
};

export const BTP_ERROR_TRUST_NON_EXISTENT: BTPError = {
  code: 'BTP_ERROR_TRUST_NON_EXISTENT',
  message: 'BTP trust record does not exist or has been expired',
};

export const BTP_ERROR_TRUST_BLOCKED: BTPError = {
  code: 'BTP_ERROR_TRUST_BLOCKED',
  message: 'BTP trust request is not allowed. Contact receiver',
};

export const BTP_ERROR_TRUST_NOT_ALLOWED: BTPError = {
  code: 'BTP_ERROR_TRUST_NOT_ALLOWED',
  message: 'BTP trust request is not allowed at this time. Contact receiver',
};

export const BTP_ERROR_TRUST_ALREADY_ACTIVE: BTPError = {
  code: 'BTP_ERROR_TRUST_ALREADY_ACTIVE',
  message: 'BTP trust record already exist. Request invalid',
};

export const BTP_ERROR_RESOLVE_PUBKEY: BTPError = {
  code: 'BTP_ERROR_RESOLVE_PUBKEY',
  message: 'No valid public-key found',
};

export const BTP_ERROR_RATE_LIMITER: BTPError = {
  code: 'BTP_ERROR_RATE_LIMITER',
  message: 'Too many request than its allowed',
};

export const BTP_ERROR_INVALID_JSON = {
  code: 'BTP_ERROR_INVALID_JSON',
  message: 'Invalid JSON format',
};

export const BTP_ERROR_VALIDATION = {
  code: 'BTP_ERROR_VALIDATION',
  message: 'BTP artifact validation failed',
};

export const BTP_ERROR_SIG_MISMATCH: BTPError = {
  code: 'BTP_ERROR_SIG_MISMATCH',
  message: 'fingerprint mis-match',
};

export const BTP_ERROR_SIG_VERIFICATION: BTPError = {
  code: 'BTP_ERROR_SIG_VERIFICATION',
  message: ' Signature verification failed',
};

export const BTP_ERROR_UNSUPPORTED_ENCRYPT: BTPError = {
  code: 'BTP_ERROR_UNSUPPORTED_ENCRYPT',
  message: 'Unsupported encryption algorithm',
};

export const BTP_ERROR_DECRYPTION_UNINTENDED: BTPError = {
  code: 'BTP_ERROR_DECRYPTION_UNINTENDED',
  message: 'Decryption failed: Message was not intended for this receiver.',
};

export const BTP_ERROR_UNKNOWN: BTPError = {
  code: 'BTP_UNKNOWN_ERROR',
  message: 'Unknown error',
};
