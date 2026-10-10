/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { InvoiceV2 } from '../schema/invoice.js';
import type { CreditNoteV2 } from '../schema/creditNote.js';
import type { Money } from '../schema/money.js';
import { moneyEquals, sumMoney } from './money.js';

export interface TaxTotalCheck {
  /** Whether the declared total and taxTotal equal the sum of the line items. */
  ok: boolean;
  computedTotal: Money;
  computedTaxTotal: Money;
  declaredTotal: Money;
  declaredTaxTotal: Money;
}

/**
 * Recomputes total and taxTotal from lineItems and compares them with the
 * declared values (EBA-119 acceptance criteria: "tax-total computed and
 * verified correctly"; EBA-103 §2 invariant: "taxTotals equal the sum of
 * line taxes"). Line `amount`/`taxAmount` are taken as given — this never
 * recomputes a line from its quantity and unitAmount, matching the
 * document-model-wide rule that an issuer's stated line amounts are not
 * recomputed.
 *
 * This is a pure check: it returns `ok: false` rather than throwing when the
 * totals disagree. Whether a disagreement blocks sending an invoice is a
 * policy decision for the caller (e.g. the send flow), not this module —
 * no acceptance criterion here says invoices must warn rather than reject,
 * unlike the payslip case this ticket does specify.
 */
export function verifyTaxTotal(doc: InvoiceV2 | CreditNoteV2): TaxTotalCheck {
  const currency = doc.total.currency;
  const computedTotal = sumMoney(doc.lineItems.map((line) => line.amount), currency);
  const computedTaxTotal = sumMoney(doc.lineItems.map((line) => line.taxAmount), currency);

  return {
    ok: moneyEquals(computedTotal, doc.total) && moneyEquals(computedTaxTotal, doc.taxTotal),
    computedTotal,
    computedTaxTotal,
    declaredTotal: doc.total,
    declaredTaxTotal: doc.taxTotal,
  };
}
