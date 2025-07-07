/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export * from './btp-protocol.js';

const TRUST_ACTIONS = ['trust.request', 'trust.respond'] as const;

const TRUST_IMMEDIATE_ACTIONS = ['trust.update', 'trust.delete', 'trust.fetch'] as const;

const INBOX_ACTIONS = ['inbox.fetch', 'inbox.delete'] as const;
const OUTBOX_ACTIONS = ['outbox.fetch', 'outbox.cancel'] as const;
const DRAFT_ACTIONS = ['draft.fetch', 'draft.update', 'draft.delete'] as const;
const SYSTEM_ACTIONS = ['system.ping'] as const;
const AUTH_ACTIONS = ['auth.request'] as const;
const ARTIFACT_ACTIONS = ['artifact.send'] as const;

export const AGENT_ACTIONS = [
  ...TRUST_ACTIONS,
  ...TRUST_IMMEDIATE_ACTIONS,
  ...INBOX_ACTIONS,
  ...OUTBOX_ACTIONS,
  ...DRAFT_ACTIONS,
  ...SYSTEM_ACTIONS,
  ...AUTH_ACTIONS,
  ...ARTIFACT_ACTIONS,
] as const;

export const TRANSPORTER_ACTIONS = ['TRUST_REQ', 'TRUST_RES', 'BTPS_DOC'] as const;

export const IMMEDIATE_ACTIONS = [
  ...SYSTEM_ACTIONS,
  ...AUTH_ACTIONS,
  ...INBOX_ACTIONS,
  ...OUTBOX_ACTIONS,
  ...DRAFT_ACTIONS,
  ...TRUST_IMMEDIATE_ACTIONS,
] as const;
