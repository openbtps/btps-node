/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export * from './btps-protocol.js';
export * from './control.js';

const TRUST_ACTIONS = ['trust.request', 'trust.respond'] as const;

const TRUST_IMMEDIATE_ACTIONS = ['trust.update', 'trust.delete', 'trust.fetch'] as const;

const INBOX_ACTIONS = ['inbox.fetch', 'inbox.delete', 'inbox.seen'] as const;
const OUTBOX_ACTIONS = ['outbox.fetch', 'outbox.cancel'] as const;
const SENTBOX_ACTIONS = ['sentbox.fetch', 'sentbox.delete'] as const;
const DRAFT_ACTIONS = ['draft.fetch', 'draft.create', 'draft.update', 'draft.delete'] as const;
const TRASH_ACTIONS = ['trash.fetch', 'trash.delete'] as const;
const SYSTEM_ACTIONS = ['system.ping'] as const;
export const AUTH_ACTIONS = ['auth.request', 'auth.refresh'] as const;
const ARTIFACT_ACTIONS = ['artifact.send'] as const;
const EVENT_ACTIONS = ['event.send'] as const;

export const AGENT_ACTIONS = [
  ...TRUST_ACTIONS,
  ...TRUST_IMMEDIATE_ACTIONS,
  ...INBOX_ACTIONS,
  ...OUTBOX_ACTIONS,
  ...DRAFT_ACTIONS,
  ...SYSTEM_ACTIONS,
  ...AUTH_ACTIONS,
  ...ARTIFACT_ACTIONS,
  ...EVENT_ACTIONS,
  ...TRASH_ACTIONS,
] as const;

export const TRANSPORTER_ACTIONS = ['TRUST_REQ', 'TRUST_RES', 'BTPS_DOC', 'BTPS_EVENT'] as const;

/**
 * Agent actions that carry a transporter artifact, built by the device, and its
 * type. trust.update and trust.delete are not among them: they edit the user's
 * own trust records at their provider and send nothing.
 */
export const AGENT_TRANSPORTER_ACTIONS = {
  'trust.request': 'TRUST_REQ',
  'trust.respond': 'TRUST_RES',
  'artifact.send': 'BTPS_DOC',
  'event.send': 'BTPS_EVENT',
} as const satisfies Record<string, (typeof TRANSPORTER_ACTIONS)[number]>;

export const IMMEDIATE_ACTIONS = [
  ...SYSTEM_ACTIONS,
  ...AUTH_ACTIONS,
  ...INBOX_ACTIONS,
  ...OUTBOX_ACTIONS,
  ...DRAFT_ACTIONS,
  ...TRUST_IMMEDIATE_ACTIONS,
  ...SENTBOX_ACTIONS,
  ...TRASH_ACTIONS,
] as const;

export const AGENT_ACTIONS_REQUIRING_DOCUMENT = [
  ...TRUST_ACTIONS,
  'trust.update',
  'trust.delete',
  ...ARTIFACT_ACTIONS,
  ...EVENT_ACTIONS,
  ...AUTH_ACTIONS,
  'inbox.seen',
  'inbox.delete',
  'sentbox.delete',
  'outbox.cancel',
  'draft.create',
  'draft.update',
  'draft.delete',
  'trash.delete',
] as const;
