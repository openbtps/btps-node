/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * A minimal, recursive-key-sort canonical form, used only by this ticket's
 * own tests to assert "JCS(input) === JCS(parsed)" (EBA-103 §2 "Tests": "a
 * status change leaving the original sha256 unchanged"; EBA-119 review,
 * round 1 — `JSON.stringify`/`toEqual` on two outputs of the same parse
 * cannot catch a field silently dropped by the schema, because it is
 * missing from both sides equally; comparing against the original raw
 * input does).
 *
 * This is **not** the BTPS 1.1 JCS oracle (RFC 8785): it does not handle
 * lone surrogates, -0, or non-finite numbers, and it is not the SDK's
 * canonical signing (EBA-115). That oracle is
 * packages/verify-btps-vectors/src/jcs.mjs, a separate package this
 * ticket's declared scope does not touch. Object key order and recursive
 * structure are all this helper's callers need.
 */
export function jcs(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => jcs(item)).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const members = keys.map(
    (key) => `${JSON.stringify(key)}:${jcs((value as Record<string, unknown>)[key])}`,
  );
  return `{${members.join(',')}}`;
}
