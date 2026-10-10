/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { ZodIssue } from 'zod';
import { DocumentV2Schema, type DocumentV2 } from '../schema/index.js';
import { freezeDocument } from './immutability.js';

export type ParseDocumentV2Result =
  | { success: true; data: DocumentV2 }
  | { success: false; errors: ZodIssue[] };

/**
 * Validates an unknown value against document model v2 and discriminates it
 * by `type`. Never mutates `raw`, and freezes the returned document
 * (src/document-model/immutability.ts) so nothing downstream can alter it
 * in place — the structural half of "a status change never alters the
 * original artifact's bytes" (EBA-119 acceptance criteria).
 */
export function parseDocumentV2(raw: unknown): ParseDocumentV2Result {
  const result = DocumentV2Schema.safeParse(raw);
  if (!result.success) {
    return { success: false, errors: result.error.issues };
  }
  return { success: true, data: freezeDocument(result.data) };
}
