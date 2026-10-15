/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BtpMoneySchema, BtpDecimalStringSchema } from './moneySchema.js';
import {
  BtpIssuedDocV2BaseSchema,
  BtpCategoryCodeSchema,
  BtpDocExtensionsSchema,
} from './baseSchema.js';
import { BtpInvoiceAttachmentV2Schema } from './invoiceSchema.js';

/*
 * A payslip carries every field an employer may need; it does not decide
 * which are legally required. Categories and extensions are open and
 * namespaced, so an unknown one is carried and signed, never refused
 * (EBA-103 section 2, amended 2026-10-08, option A).
 */

export const BtpPayslipPayeeSchema = z.object({
  name: z.string(),
  accountRef: z.string().optional(),
});

/** A salaried rate: the amount, its basis (e.g. "annual") and the date it applies from. */
export const BtpPayslipPayRateSchema = z.object({
  amount: BtpMoneySchema,
  unit: z.string().min(1),
  asAt: z.string().datetime(),
});

/** `rate` and `quantity` are for display; `amount` is never recomputed from them. */
export const BtpPayslipEarningSchema = z.object({
  category: BtpCategoryCodeSchema,
  description: z.string().optional(),
  rate: BtpDecimalStringSchema.optional(),
  rateUnit: z.string().optional(),
  quantity: BtpDecimalStringSchema.optional(),
  amount: BtpMoneySchema,
});

export const BtpPayslipDeductionSchema = z.object({
  category: BtpCategoryCodeSchema,
  description: z.string().optional(),
  amount: BtpMoneySchema,
  payee: BtpPayslipPayeeSchema.optional(),
});

export const BtpPayslipSuperFundSchema = z.object({
  name: z.string().optional(),
  memberNumber: z.string().optional(),
  accountRef: z.string().optional(),
});

/** `fund` is optional: a new employee's first contribution can precede a fund. */
export const BtpPayslipContributionSchema = z.object({
  category: BtpCategoryCodeSchema.optional(),
  amount: BtpMoneySchema,
  fund: BtpPayslipSuperFundSchema.optional(),
});

export const BtpPayslipEmployeeSchema = z.object({
  name: z.string(),
  employeeId: z.string().optional(),
  payBasis: z.enum(['hourly', 'salaried']).optional(),
});

export const BtpPayslipEmployerSchema = z.object({
  name: z.string(),
  address: z.string().optional(),
  taxIds: z.array(z.string()).optional(),
});

export const BtpPayslipDocSchema = BtpIssuedDocV2BaseSchema.extend({
  type: z.literal('payslip'),
  /** ISO 3166-1 alpha-2, e.g. "AU". */
  jurisdiction: z.string().length(2).optional(),
  employer: BtpPayslipEmployerSchema.optional(),
  employee: BtpPayslipEmployeeSchema,
  payPeriod: z
    .object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    })
    .optional(),
  payDate: z.string().datetime().optional(),
  payRate: BtpPayslipPayRateSchema.optional(),
  earnings: z.array(BtpPayslipEarningSchema),
  deductions: z.array(BtpPayslipDeductionSchema),
  taxWithheld: BtpMoneySchema.optional(),
  contributions: z.array(BtpPayslipContributionSchema),
  gross: BtpMoneySchema,
  net: BtpMoneySchema,
  yearToDate: z.record(z.string(), BtpMoneySchema).optional(),
  attachments: z.array(BtpInvoiceAttachmentV2Schema).optional(),
  extensions: BtpDocExtensionsSchema.optional(),
});
