/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { BTPDocV2, BTPMoney, BTPPayslipDoc } from '@core/server/types.js';
import { BTP_DOC_SHA256 } from '@core/server/constants/documents.js';
import { moneyEquals, subtractMoney, sumMoney, zeroMoney } from './money.js';
import { decodeBase64Strict, encodeBase64, encodeHex, sha256 } from './bytes.js';

/*
 * Checks over a valid v2 document. The payslip check reports a
 * disagreement in its result and never throws for one: whether it blocks
 * anything is the receiving platform's decision. It never recomputes a line
 * from its rate or quantity; the stated line amounts are what is summed.
 * There is no tax-total check: an invoice's and a credit note's line items
 * are a table whose columns the issuer chooses, so there is nothing for the
 * protocol to add up.
 */

export interface BTPPayslipReconciliation {
  /** False when gross or net does not reconcile. A warning, never a rejection. */
  ok: boolean;
  computedGross: BTPMoney;
  computedNet: BTPMoney;
  declaredGross: BTPMoney;
  declaredNet: BTPMoney;
  /** Present exactly when `ok` is false. */
  warnings: string[];
}

/**
 * Checks a payslip's declared gross and net against its earnings,
 * deductions and tax withheld. A gross or net that does not reconcile is a
 * warning, not a rejection.
 */
export function reconcilePayslip(doc: BTPPayslipDoc): BTPPayslipReconciliation {
  const currency = doc.gross.currency;
  const computedGross = sumMoney(
    doc.earnings.map((line) => line.amount),
    currency,
  );

  const deductionsTotal = sumMoney(
    doc.deductions.map((line) => line.amount),
    currency,
  );
  const taxWithheld = doc.taxWithheld ?? zeroMoney(currency);
  // Net is checked against the computed gross, so a wrong declared gross
  // cannot make the net check pass or fail by accident.
  const computedNet = subtractMoney(subtractMoney(computedGross, deductionsTotal), taxWithheld);

  const warnings: string[] = [];
  if (!moneyEquals(computedGross, doc.gross)) {
    warnings.push(
      `gross does not reconcile: declared ${doc.gross.amount} ${doc.gross.currency}, ` +
        `sum of earnings is ${computedGross.amount} ${computedGross.currency}`,
    );
  }
  if (!moneyEquals(computedNet, doc.net)) {
    warnings.push(
      `net does not reconcile: declared ${doc.net.amount} ${doc.net.currency}, ` +
        `gross minus deductions minus tax withheld is ${computedNet.amount} ${computedNet.currency}`,
    );
  }

  return {
    ok: warnings.length === 0,
    computedGross,
    computedNet,
    declaredGross: doc.gross,
    declaredNet: doc.net,
    warnings,
  };
}

export interface BTPAttachmentProblem {
  /** The attachment's position in `attachments`. */
  index: number;
  /** The field the problem is in: `content`, `size` or `sha256`. */
  field: 'content' | 'size' | 'sha256';
  message: string;
}

export interface BTPAttachmentCheck {
  /** True when every attachment's `content` decodes to its `size` and `sha256`. */
  ok: boolean;
  /** Empty exactly when `ok` is true. */
  problems: BTPAttachmentProblem[];
}

/** A digest written as BTP_DOC_SHA256 says. */
export function formatSha256(digest: Uint8Array): string {
  return BTP_DOC_SHA256.encoding === 'hex' ? encodeHex(digest) : encodeBase64(digest);
}

/**
 * Checks each attachment's file against what the document states about it:
 * `content` is canonical base64, decodes to exactly `size` bytes, and those
 * bytes hash to `sha256`. Unlike the payslip check, a problem here
 * is a refusal: the server runs this on every unencrypted `BTPS_DOC`, after
 * the schema. A document with no attachments passes.
 */
export function verifyAttachments(doc: BTPDocV2): BTPAttachmentCheck {
  const attachments = 'attachments' in doc ? (doc.attachments ?? []) : [];
  const problems: BTPAttachmentProblem[] = [];
  attachments.forEach((attachment, index) => {
    const bytes = decodeBase64Strict(attachment.content);
    if (!bytes) {
      problems.push({ index, field: 'content', message: 'content is not valid base64' });
      return;
    }
    if (bytes.length !== attachment.size) {
      problems.push({
        index,
        field: 'size',
        message: `content decodes to ${bytes.length} bytes, but size is ${attachment.size}`,
      });
      return;
    }
    if (formatSha256(sha256(bytes)) !== attachment.sha256) {
      problems.push({
        index,
        field: 'sha256',
        message: 'sha256 is not the hash of the decoded content',
      });
    }
  });
  return { ok: problems.length === 0, problems };
}
