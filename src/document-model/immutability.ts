/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * A status change never alters the original artifact's bytes (EBA-119
 * acceptance criteria; EBA-103 §2 invariant). In this module that is a
 * structural property, not a runtime check against a stored hash: no
 * function here ever assigns into a document it is given, and every
 * document returned by parseDocumentV2 is deep-frozen so a caller that
 * tries to mutate it in place gets a thrown TypeError (in strict mode)
 * instead of silent corruption. A lifecycle event recording a status change
 * is always a new, separate document (src/schema/lifecycleEvent.ts) — it is
 * never written into the artifact it refers to.
 *
 * This does not reproduce the storage-layer guarantee (S3 versioning plus a
 * delete/overwrite-denying IAM policy, EBA-103 §8) — that is infrastructure
 * outside this ticket's declared scope (src/document-model/, src/schema/).
 */
export function freezeDocument<T extends object>(doc: T): Readonly<T> {
  deepFreeze(doc);
  return doc;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
