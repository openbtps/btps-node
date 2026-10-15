/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Document model v2, reachable as `@btps/sdk/documents`: the schemas, the
 * helpers that work on a document, and the constants they rest on. Nothing
 * here imports a Node built-in, so it also runs on web and React Native.
 */

export { BtpMoneySchema, BtpDecimalStringSchema } from './moneySchema.js';
export {
  BtpDocV2BaseSchema,
  BtpIssuedDocV2BaseSchema,
  BtpCategoryCodeSchema,
  BtpDocExtensionsSchema,
  BtpDocReferenceSchema,
  STATUS_NOT_IN_DOCUMENT,
} from './baseSchema.js';
export {
  BtpInvoicePartySchema,
  BtpInvoiceAttachmentV2Schema,
  BtpDocAttachmentsSchema,
  BtpInvoiceLineItemSchema,
  BtpInvoiceLineItemsSchema,
  BtpInvoiceTaxTotalSchema,
  BtpInvoiceTaxTotalsSchema,
  BtpInvoiceV2DocSchema,
} from './invoiceSchema.js';
export { BtpCreditNoteDocSchema } from './creditNoteSchema.js';
export {
  BtpPayslipPayeeSchema,
  BtpPayslipPayRateSchema,
  BtpPayslipEarningSchema,
  BtpPayslipDeductionSchema,
  BtpPayslipSuperFundSchema,
  BtpPayslipContributionSchema,
  BtpPayslipEmployeeSchema,
  BtpPayslipEmployerSchema,
  BtpPayslipDocSchema,
} from './payslipSchema.js';
export { BtpDocV2Schema } from './documentSchema.js';
export { parseBtpDocV2, validateBtpDocOwnership } from '../helpers.js';

export { CURRENCY_CODES } from '../../constants/currency.js';
export { SCHEMA_VERSION_V2, BTP_DOC_LIMITS } from '../../constants/documents.js';

export * from '@core/utils/money.js';
export * from '@core/utils/documentChecks.js';
export { freezeDocument } from '@core/utils/freeze.js';

export type {
  BTPMoney,
  BTPDocReference,
  BTPInvoiceLineItem,
  BTPInvoiceTaxTotal,
  BTPInvoiceV2Doc,
  BTPCreditNoteDoc,
  BTPPayslipDoc,
  BTPDocV2,
  CurrencyCode,
} from '../../types.js';
