/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { z } from 'zod';
import { BTP_DOC_LIMITS } from '../../constants/documents.js';
import { BtpMoneySchema, BtpDecimalStringSchema } from './moneySchema.js';
import {
  BtpIssuedDocV2BaseSchema,
  BtpCategoryCodeSchema,
  BtpDocExtensionsSchema,
  capped,
} from './baseSchema.js';
import { BtpDocAttachmentsSchema } from './invoiceSchema.js';

/*
 * A payslip carries every field an employer may need; it does not decide
 * which are legally required. Categories and extensions are open and
 * namespaced, so an unknown one is carried and signed, never refused.
 */

export const BtpPayslipPayeeSchema = z
  .object({
    name: capped.name(),
    accountRef: capped.code().optional(),
  })
  .strict();

/** A salaried rate: the amount, its basis (e.g. "annual") and the date it applies from. */
export const BtpPayslipPayRateSchema = z
  .object({
    amount: BtpMoneySchema,
    unit: capped.code().min(1),
    asAt: z.string().datetime(),
  })
  .strict();

/** `rate` and `quantity` are for display; `amount` is never recomputed from them. */
export const BtpPayslipEarningSchema = z
  .object({
    category: BtpCategoryCodeSchema,
    description: capped.text().optional(),
    rate: BtpDecimalStringSchema.optional(),
    rateUnit: capped.code().optional(),
    quantity: BtpDecimalStringSchema.optional(),
    amount: BtpMoneySchema,
  })
  .strict();

export const BtpPayslipDeductionSchema = z
  .object({
    category: BtpCategoryCodeSchema,
    description: capped.text().optional(),
    amount: BtpMoneySchema,
    payee: BtpPayslipPayeeSchema.optional(),
  })
  .strict();

export const BtpPayslipSuperFundSchema = z
  .object({
    name: capped.name().optional(),
    memberNumber: capped.code().optional(),
    accountRef: capped.code().optional(),
  })
  .strict();

/** `fund` is optional: a new employee's first contribution can precede a fund. */
export const BtpPayslipContributionSchema = z
  .object({
    category: BtpCategoryCodeSchema.optional(),
    amount: BtpMoneySchema,
    fund: BtpPayslipSuperFundSchema.optional(),
  })
  .strict();

export const BtpPayslipEmployeeSchema = z
  .object({
    name: capped.name(),
    employeeId: capped.code().optional(),
    payBasis: z.enum(['hourly', 'salaried']).optional(),
  })
  .strict();

export const BtpPayslipEmployerSchema = z
  .object({
    name: capped.name(),
    address: capped.address().optional(),
    taxIds: capped.taxIds().optional(),
  })
  .strict();

const payslipLines = <T extends z.ZodTypeAny>(line: T) =>
  z.array(line).max(BTP_DOC_LIMITS.PAYSLIP_LINES_MAX);

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
    .strict()
    .optional(),
  payDate: z.string().datetime().optional(),
  payRate: BtpPayslipPayRateSchema.optional(),
  earnings: payslipLines(BtpPayslipEarningSchema),
  deductions: payslipLines(BtpPayslipDeductionSchema),
  taxWithheld: BtpMoneySchema.optional(),
  contributions: payslipLines(BtpPayslipContributionSchema),
  gross: BtpMoneySchema,
  net: BtpMoneySchema,
  yearToDate: z
    .record(capped.code(), BtpMoneySchema)
    .refine((ytd) => Object.keys(ytd).length <= BTP_DOC_LIMITS.YEAR_TO_DATE_MAX, {
      message: `yearToDate may have at most ${BTP_DOC_LIMITS.YEAR_TO_DATE_MAX} entries`,
    })
    .optional(),
  attachments: BtpDocAttachmentsSchema.optional(),
  extensions: BtpDocExtensionsSchema.optional(),
}).strict();
