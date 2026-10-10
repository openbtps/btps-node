/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { PayslipV2 } from '../schema/payslip.js';
import type { Money } from '../schema/money.js';
import { moneyEquals, subtractMoney, sumMoney, zeroMoney } from './money.js';

export interface PayslipReconciliation {
  /** False when gross or net does not reconcile. Never a rejection signal. */
  ok: boolean;
  computedGross: Money;
  computedNet: Money;
  declaredGross: Money;
  declaredNet: Money;
  /** Human-readable warnings, present precisely when ok is false. */
  warnings: string[];
}

/**
 * Checks a payslip's declared gross and net against its earnings and
 * deductions. EBA-119 / EBA-103 §2 (amended 2026-10-08, comment 10696):
 * "a gross or net that does not reconcile is a warning, not a rejection" —
 * this function only ever returns a result, it never throws for a
 * reconciliation disagreement.
 *
 * It does not recompute any earnings[] line from rate * quantity — per the
 * acceptance criteria, line amounts are what the employer states and are
 * carried as given. rate/quantity are decimal strings never read here.
 */
export function reconcilePayslip(doc: PayslipV2): PayslipReconciliation {
  const currency = doc.gross.currency;
  const computedGross = sumMoney(doc.earnings.map((line) => line.amount), currency);

  const deductionsTotal = sumMoney(doc.deductions.map((line) => line.amount), currency);
  const taxWithheld = doc.taxWithheld ?? zeroMoney(currency);
  // Net is checked against the *computed* gross (from earnings), not the
  // declared one, so the gross and net checks stay independent: a payslip
  // whose declared gross is wrong does not also make an otherwise-correct
  // net computation report as reconciling by accident.
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
