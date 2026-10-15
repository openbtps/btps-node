/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as documents from './index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

describe('@btps/sdk/documents (EBA-441, schemas only)', () => {
  it('is an export path of the package, built from this index', () => {
    const pkg = JSON.parse(readFileSync(`${REPO_ROOT}package.json`, 'utf8'));
    const target: string = pkg.exports['./documents'].import;
    expect(target).toBe('./dist/core/server/schemas/documents/index.js');
    const source = target.replace('./dist/', 'src/').replace(/\.js$/, '.ts');
    expect(existsSync(`${REPO_ROOT}${source}`)).toBe(true);
  });

  it('exports the schemas, the helpers and the constants they rest on', () => {
    for (const name of [
      'BtpDocV2Schema',
      'BtpInvoiceV2DocSchema',
      'BtpCreditNoteDocSchema',
      'BtpPayslipDocSchema',
      'BtpMoneySchema',
      'BtpDocReferenceSchema',
      'parseBtpDocV2',
      'validateBtpDocOwnership',
      'verifyTaxTotal',
      'reconcilePayslip',
      'verifyAttachments',
      'formatSha256',
      'addMoney',
      'sumMoney',
      'freezeDocument',
      'CURRENCY_CODES',
      'BTP_DOC_LIMITS',
      'SCHEMA_VERSION_V2',
      'BTP_DOC_SHA256',
      'BTP_DOC_ATTACHMENT_MEDIA_TYPES',
      'BTP_DOC_REFERENCE_TYPES',
      'BtpDocReferencesSchema',
      'BtpInvoiceLineItemsV2Schema',
      'BtpInvoiceIssuerV2Schema',
      'BtpDocMetadataSchema',
    ]) {
      expect(documents, name).toHaveProperty(name);
    }
    expect(documents.CURRENCY_CODES).toContain('AUD');
  });

  it('bundles for a neutral platform: no Node built-in is reachable from it', async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
      absWorkingDir: REPO_ROOT,
      tsconfig: `${REPO_ROOT}tsconfig.json`,
      bundle: true,
      write: false,
      platform: 'neutral',
      mainFields: ['module', 'main'],
      format: 'esm',
      logLevel: 'silent',
    });
    expect(result.errors).toEqual([]);
  });
});
