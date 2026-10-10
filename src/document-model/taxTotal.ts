/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { InvoiceV2 } from '../schema/invoice.js';
import type { CreditNoteV2 } from '../schema/creditNote.js';
import type { Money } from '../schema/money.js';
import { moneyEquals, sumMoney, zeroMoney } from './money.js';

export interface TaxTotalByCategory {
  taxCategory: string;
  computedAmount: Money;
  declaredAmount: Money;
  ok: boolean;
}

export interface TaxTotalCheck {
  /** Whether the declared total and every declared taxTotals[] entry equal the line items. */
  ok: boolean;
  computedTotal: Money;
  declaredTotal: Money;
  /** One entry per taxCategory seen on either the line items or taxTotals[]. */
  byCategory: TaxTotalByCategory[];
}

/**
 * Recomputes the invoice total and the per-rate tax totals from lineItems
 * and compares them with the declared values (EBA-119 acceptance criteria:
 * "tax-total computed and verified correctly"; EBA-103 §2 invariant:
 * "taxTotals equal the sum of line taxes per rate"). Line `lineTotal`/
 * `taxAmount` are taken as given — this never recomputes a line from its
 * quantity and unitPrice, matching the document-model-wide rule that an
 * issuer's stated line amounts are not recomputed.
 *
 * Grouping is by `taxCategory`, the rate key every line item now carries
 * (EBA-119 review, round 1 — the prior version checked a single taxTotal
 * and could not tell a tax-only mismatch from a total-only one).
 *
 * This is a pure check: it returns `ok: false` rather than throwing when the
 * totals disagree. Whether a disagreement blocks sending an invoice is a
 * policy decision for the caller (e.g. the send flow), not this module —
 * no acceptance criterion here says invoices must warn rather than reject,
 * unlike the payslip case this ticket does specify.
 */
export function verifyTaxTotal(doc: InvoiceV2 | CreditNoteV2): TaxTotalCheck {
  const currency = doc.total.currency;
  const computedTotal = sumMoney(doc.lineItems.map((line) => line.lineTotal), currency);

  const linesByCategory = new Map<string, Array<(typeof doc.lineItems)[number]>>();
  for (const line of doc.lineItems) {
    const lines = linesByCategory.get(line.taxCategory) ?? [];
    lines.push(line);
    linesByCategory.set(line.taxCategory, lines);
  }

  const declaredByCategory = new Map(doc.taxTotals.map((t) => [t.taxCategory, t.amount]));

  const categories = new Set<string>([...linesByCategory.keys(), ...declaredByCategory.keys()]);
  const byCategory: TaxTotalByCategory[] = [...categories].map((taxCategory) => {
    const computedAmount = sumMoney(
      (linesByCategory.get(taxCategory) ?? []).map((line) => line.taxAmount),
      currency,
    );
    const declaredAmount = declaredByCategory.get(taxCategory) ?? zeroMoney(currency);
    return {
      taxCategory,
      computedAmount,
      declaredAmount,
      ok: moneyEquals(computedAmount, declaredAmount),
    };
  });

  return {
    ok: moneyEquals(computedTotal, doc.total) && byCategory.every((c) => c.ok),
    computedTotal,
    declaredTotal: doc.total,
    byCategory,
  };
}
