/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: the checks a document is held to on each side of an encrypted
 * artifact, as signEncrypt runs them before it encrypts and decryptVerify runs
 * them once it has decrypted. Exported so that a platform that encrypts,
 * decrypts, signs or verifies a piece at a time runs the same rules, and
 * decryptVerify and signEncrypt run them from here, so the two never differ.
 *
 * A document whose files are held apart, each attachment's `content` left out
 * or empty with its `size` and `sha256` as sent, is checked as it is: the
 * schema reads an attachment's content as a string, and checks nothing of it.
 */
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_DOCUMENT_TYPE_MISMATCH, BTP_ERROR_VALIDATION } from '@core/error/constant.js';
import { decryptedDocumentProblem, processBtpDocSchema } from '@core/server/schemas/helpers.js';
import type { BTPArtifactType } from '@core/server/types.js';
import { verifierRefusal } from '@core/trust/verification.js';

/** How a document's BoundView is checked. */
export type BTPDocumentCheckOptions = {
  /**
   * `whereDrawn`: not here. Only where the document's BoundView is drawn with
   * `@btps/boundview`'s `renderBoundView`, which checks it before it draws and
   * draws none that fails. Otherwise, leave it out: it is checked here.
   */
  boundView?: 'whereDrawn';
};

/** What the envelope of an artifact says that its document is held to. */
export type BTPDocumentEnvelope = Record<string, unknown> & {
  type?: string;
  version?: string;
  documentType?: string;
};

/** `document` without its BoundView, when it is to be checked where it is drawn. */
const asChecked = (document: unknown, options?: BTPDocumentCheckOptions): unknown =>
  options?.boundView === 'whereDrawn' &&
  typeof document === 'object' &&
  document !== null &&
  'boundView' in document
    ? Object.fromEntries(Object.entries(document).filter(([name]) => name !== 'boundView'))
    : document;

/** A document that is not the type its envelope names, as BTP_ERROR_DOCUMENT_TYPE_MISMATCH. */
export const documentTypeMismatch = (
  document: unknown,
  envelope: BTPDocumentEnvelope,
): BTPErrorException | undefined => {
  const type = (document as { type?: unknown } | undefined)?.type;
  if (envelope.documentType === undefined || type === envelope.documentType) return undefined;
  return new BTPErrorException(BTP_ERROR_DOCUMENT_TYPE_MISMATCH, {
    cause: `the document is a ${String(type)}, not the ${String(envelope.documentType)} its envelope names`,
  });
};

/**
 * Since 1.2: what signEncrypt holds a document to before it encrypts it, once
 * no server can read it: the type its envelope names, and its type's schema.
 * Undefined when it passes; otherwise the error signEncrypt answers with.
 */
export const checkDocumentToSend = (
  document: unknown,
  envelope: BTPDocumentEnvelope,
  options?: BTPDocumentCheckOptions,
): BTPErrorException | undefined => {
  const mismatch = documentTypeMismatch(document, envelope);
  if (mismatch) return mismatch;
  const version = typeof envelope.version === 'string' ? envelope.version : undefined;
  const docSchema = processBtpDocSchema(envelope.type as BTPArtifactType, version);
  if (docSchema && !docSchema.safeParse(asChecked(document, options)).success) {
    return new BTPErrorException(BTP_ERROR_VALIDATION, {
      cause: 'Document type does not match the artifact type',
    });
  }
  return undefined;
};

/**
 * Since 1.2: what decryptVerify holds a document to once it has decrypted it:
 * its type's schema and the rules between it and its envelope, the type its
 * envelope names, and, for a trust request, that its verifier may verify.
 * Undefined when it passes; otherwise the error decryptVerify answers with.
 */
export const checkDecryptedDocument = async (
  document: unknown,
  envelope: BTPDocumentEnvelope,
  options?: BTPDocumentCheckOptions,
): Promise<BTPErrorException | undefined> => {
  const problem = decryptedDocumentProblem(asChecked(document, options), envelope);
  if (problem) return new BTPErrorException(BTP_ERROR_VALIDATION, { cause: problem });
  const mismatch = documentTypeMismatch(document, envelope);
  if (mismatch) return mismatch;
  // Since 1.2: only one who runs a BTPS server verifies.
  const { verification } = (document ?? {}) as { verification?: { verifiedBy: string } };
  const verifier =
    envelope.type === 'TRUST_REQ' && verification
      ? await verifierRefusal(verification.verifiedBy)
      : undefined;
  return verifier ? new BTPErrorException(verifier.error, { cause: verifier.problem }) : undefined;
};
