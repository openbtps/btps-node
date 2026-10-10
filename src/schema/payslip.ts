/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { MoneySchema, DecimalStringSchema } from './money.js';
import { DocumentV2BaseSchema, CategoryCodeSchema, ExtensionsSchema } from './base.js';
import { InvoiceAttachmentV2Schema } from './invoice.js';

/**
 * Payslip, document model v2 (EBA-103 §2, amended 2026-10-08 approving the
 * proposal at page 8945684, option A — EBA-119 comments 10696/10703).
 *
 * eBillAddress carries payslips; it does not author them (founder decision,
 * comment 10665, no legal review). The job of this type is that it can
 * carry every field an employer needs, so no employer is blocked from being
 * compliant — categories and extensions are open and namespaced rather than
 * closed, and an unknown one is carried and signed, never rejected.
 *
 * jurisdiction, employer, payPeriod and payDate are in the design (EBA-103
 * §2) but none of this ticket's fixtures populate them, so they are
 * optional here rather than required against a case nothing yet exercises.
 */

export const PayeeV2Schema = z.object({
  name: z.string(),
  accountRef: z.string().optional(),
});

/**
 * Salaried pay rate "on the last day of the period and the annual rate"
 * (comment 10667). `unit` is open to the amount's basis; the fixture uses
 * "annual". Extend as further bases are needed.
 */
export const PayRateV2Schema = z.object({
  amount: MoneySchema,
  unit: z.string().min(1),
  asAt: z.string().datetime(),
});

/**
 * One earnings line: ordinary hours, a penalty/loading/allowance/bonus, or
 * anything a jurisdiction adds later under its own namespace. `rate` and
 * `quantity` are decimal strings carried for display only — document-model
 * never recomputes `amount` from them and never treats them as floats
 * (EBA-119 acceptance criteria).
 */
export const PayslipEarningV2Schema = z.object({
  category: CategoryCodeSchema,
  description: z.string().optional(),
  rate: DecimalStringSchema.optional(),
  rateUnit: z.string().optional(),
  quantity: DecimalStringSchema.optional(),
  amount: MoneySchema,
});

export const PayslipDeductionV2Schema = z.object({
  category: CategoryCodeSchema,
  description: z.string().optional(),
  amount: MoneySchema,
  /** "each deduction with the name or number of its fund or account" (comment 10667). */
  payee: PayeeV2Schema.optional(),
});

export const SuperFundV2Schema = z.object({
  name: z.string().optional(),
  memberNumber: z.string().optional(),
  accountRef: z.string().optional(),
});

/**
 * One super contribution. `fund` is optional — a new employee's first 14
 * days can have a contribution with no fund yet assigned (comment 10667).
 */
export const PayslipContributionV2Schema = z.object({
  category: CategoryCodeSchema.optional(),
  amount: MoneySchema,
  fund: SuperFundV2Schema.optional(),
});

export const PayslipEmployeeV2Schema = z.object({
  name: z.string(),
  employeeId: z.string().optional(),
  payBasis: z.enum(['hourly', 'salaried']).optional(),
});

export const PayslipEmployerV2Schema = z.object({
  name: z.string(),
  address: z.string().optional(),
  taxIds: z.array(z.string()).optional(),
});

export const PayslipV2Schema = DocumentV2BaseSchema.extend({
  type: z.literal('payslip'),
  /** ISO 3166-1 alpha-2, e.g. "AU". Optional: see file header. */
  jurisdiction: z.string().length(2).optional(),
  employer: PayslipEmployerV2Schema.optional(),
  employee: PayslipEmployeeV2Schema,
  payPeriod: z
    .object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    })
    .optional(),
  payDate: z.string().datetime().optional(),
  payRate: PayRateV2Schema.optional(),
  earnings: z.array(PayslipEarningV2Schema),
  deductions: z.array(PayslipDeductionV2Schema),
  taxWithheld: MoneySchema.optional(),
  super: z.array(PayslipContributionV2Schema),
  gross: MoneySchema,
  net: MoneySchema,
  yearToDate: z.record(z.string(), MoneySchema).optional(),
  attachments: z.array(InvoiceAttachmentV2Schema).optional(),
  extensions: ExtensionsSchema.optional(),
});

export type PayslipV2 = z.infer<typeof PayslipV2Schema>;
