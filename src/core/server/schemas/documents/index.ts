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
  BtpIdentifierKeySchema,
  BtpDocIdentifiersSchema,
  BtpDocExtensionsSchema,
  BtpDocMetadataSchema,
  BtpDocTemplateDataSchema,
  BtpDocReferenceSchema,
  BtpDocReferenceTypeSchema,
  BtpDocTypedReferenceSchema,
  BtpDocReferencesSchema,
  STATUS_NOT_IN_DOCUMENT,
} from './baseSchema.js';
export {
  BtpInvoiceAttachmentV2Schema,
  BtpDocAttachmentsSchema,
  BtpInvoiceLineItemCellSchema,
  BtpInvoiceLineItemRowSchema,
  BtpInvoiceLineItemsV2Schema,
  BtpInvoiceIssuerV2Schema,
  BtpInvoicePaymentLinkSchema,
  BtpInvoiceTemplateSchema,
  BtpInvoiceV2DocSchema,
} from './invoiceSchema.js';
export {
  BtpCreditNoteLineItemSchema,
  BtpCreditNoteLineItemsSchema,
  BtpCreditNoteTaxTotalSchema,
  BtpCreditNoteTaxTotalsSchema,
  BtpCreditNoteReferencesSchema,
  BtpCreditNoteDocSchema,
} from './creditNoteSchema.js';
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
export { BtpEventDocSchema, BtpEventAmountSchema, BtpEventIdSchema } from './eventSchema.js';
export {
  parseBtpDocV2,
  validateBtpDocOwnership,
  parseBtpEventDoc,
  validateBtpEventEnvelope,
  validateBtpEventReply,
} from '../helpers.js';

export { CURRENCY_CODES } from '../../constants/currency.js';
export {
  SCHEMA_VERSION_V2,
  BTP_DOC_LIMITS,
  BTP_EVENT_TYPES,
  BTP_EVENT_TYPES_STARTING_A_CHAIN,
  BTP_EVENT_TYPES_REPLYING,
  BTP_EVENT_DISPUTE_REASONS,
  BTP_EVENT_DECISIONS,
  BTP_DOC_SHA256,
  BTP_DOC_ATTACHMENT_MEDIA_TYPES,
  BTP_DOC_REFERENCE_TYPES,
  type BTPDocSha256Encoding,
} from '../../constants/documents.js';

export * from '@core/utils/money.js';
export * from '@core/utils/documentChecks.js';
export { freezeDocument } from '@core/utils/freeze.js';

export type {
  BTPMoney,
  BTPDocReference,
  BTPDocTypedReference,
  BTPAttachment,
  BTPInvoiceLineItems,
  BTPInvoiceIssuer,
  BTPInvoiceV2Doc,
  BTPCreditNoteLineItem,
  BTPCreditNoteTaxTotal,
  BTPCreditNoteDoc,
  BTPPayslipDoc,
  BTPDocV2,
  BTPEventDoc,
  BTPEventType,
  CurrencyCode,
} from '../../types.js';
