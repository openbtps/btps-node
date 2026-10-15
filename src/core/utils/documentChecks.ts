/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  BTPCreditNoteDoc,
  BTPInvoiceLineItem,
  BTPInvoiceV2Doc,
  BTPMoney,
  BTPPayslipDoc,
} from '@core/server/types.js';
import { moneyEquals, subtractMoney, sumMoney, zeroMoney } from './money.js';

/*
 * Checks over a valid v2 document's own arithmetic. Both report a
 * disagreement in their result and never throw for one: whether it blocks
 * anything is the receiving platform's decision. Neither recomputes a line
 * from its rate or quantity; the stated line amounts are what is summed.
 */

export interface BTPTaxTotalByCategory {
  taxCategory: string;
  computedAmount: BTPMoney;
  declaredAmount: BTPMoney;
  ok: boolean;
}

export interface BTPTaxTotalCheck {
  /** True when the declared total and every declared tax total equal the line items. */
  ok: boolean;
  computedTotal: BTPMoney;
  declaredTotal: BTPMoney;
  /** One entry per tax category seen on the line items or in `taxTotals`. */
  byCategory: BTPTaxTotalByCategory[];
}

/**
 * Recomputes the total and the tax per rate (`taxCategory`) from the line
 * items, and compares them with the declared `total` and `taxTotals`.
 */
export function verifyTaxTotal(doc: BTPInvoiceV2Doc | BTPCreditNoteDoc): BTPTaxTotalCheck {
  const currency = doc.total.currency;
  const computedTotal = sumMoney(
    doc.lineItems.map((line) => line.lineTotal),
    currency,
  );

  const linesByCategory = new Map<string, BTPInvoiceLineItem[]>();
  for (const line of doc.lineItems) {
    const lines = linesByCategory.get(line.taxCategory) ?? [];
    lines.push(line);
    linesByCategory.set(line.taxCategory, lines);
  }

  const declaredByCategory = new Map(doc.taxTotals.map((t) => [t.taxCategory, t.amount]));

  const categories = new Set<string>([...linesByCategory.keys(), ...declaredByCategory.keys()]);
  const byCategory: BTPTaxTotalByCategory[] = [...categories].map((taxCategory) => {
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
 * warning, not a rejection (EBA-103 section 2, amended 2026-10-08).
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
