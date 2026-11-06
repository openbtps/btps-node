/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: trust permissions against the trust record. The BTPS server only
 * reads a record; the platform writes it. These compute what the platform
 * saves, and check an answer against what the requester's record says it asked.
 */

import { BTP_ERROR_PERMISSION, BTP_ERROR_PERMISSION_REQUIRED } from '@core/error/constant.js';
import type { BTPError } from '@core/error/types.js';
import type {
  BTPDetailPermission,
  BTPPermissionName,
  BTPTrustPermissions,
} from '@core/server/types.js';
import type { BTPTrustRecordPermissions, BTPTrustStatus } from './types.js';

type GrantRecord = { status: BTPTrustStatus; permissions?: BTPTrustRecordPermissions };

const detailsOf = (names: readonly BTPPermissionName[]) =>
  names.filter((name): name is BTPDetailPermission => name.startsWith('detail:'));

/**
 * Why an answer's `granted` cannot be taken against the requester's trust
 * record, and the error it is refused with; undefined when it can, or when it
 * grants nothing by name (a rejection, or a 1.1 answer).
 */
export const trustGrantRefusal = (
  response: { granted?: readonly BTPPermissionName[] },
  record: GrantRecord,
): { error: BTPError; problem: string } | undefined => {
  const { granted } = response;
  if (!granted) return undefined;
  const { permissions } = record;
  if (!permissions) {
    return {
      error: BTP_ERROR_PERMISSION_REQUIRED,
      problem: 'the request has no permissions on record, so required ones cannot be checked',
    };
  }
  // An accepted trust takes an answer only to the change it has pending.
  const asked =
    record.status === 'accepted' ? permissions.pendingChange?.requested : permissions.requested;
  if (!asked) {
    return {
      error: BTP_ERROR_PERMISSION,
      problem: 'an accepted trust takes an answer only while a change is pending',
    };
  }
  const missing = asked.find(({ name, required }) => required && !granted.includes(name));
  if (missing) {
    return { error: BTP_ERROR_PERMISSION_REQUIRED, problem: `${missing.name} is required` };
  }
  const extra = granted.find((name) => !asked.some((permission) => permission.name === name));
  if (extra) return { error: BTP_ERROR_PERMISSION, problem: `${extra} was not asked for` };
  return undefined;
};

/** Since 1.2: why an answer's `granted` does not meet the requester's trust record, or undefined. */
export const trustGrantProblem = (
  response: { granted?: readonly BTPPermissionName[] },
  record: GrantRecord,
): string | undefined => trustGrantRefusal(response, record)?.problem;

/**
 * Since 1.2: the permissions the requester saves on its own record when it
 * sends a request with permissions, or undefined for a request without them (a
 * 1.1 trust). A change keeps the trust's current permissions and adds the
 * change as pending, so the trust runs on its old grant until it is answered.
 */
export const trustPermissionsFromRequest = (
  request: { permissions?: BTPTrustPermissions; change?: true; issuedAt: string },
  current?: BTPTrustRecordPermissions,
): BTPTrustRecordPermissions | undefined => {
  const { permissions } = request;
  if (!permissions) return undefined;
  if (request.change && current) {
    return { ...current, pendingChange: { requested: permissions, requestedAt: request.issuedAt } };
  }
  return { requested: permissions, granted: [], detailsHeld: [], detailsShared: [] };
};

/**
 * Since 1.2: the permissions each side saves when a request is accepted: the
 * requester's record and the responder's. Each holds the other's details by
 * name: the requester the details granted to it, the responder the details the
 * request gave. Undefined when the answer grants nothing by name.
 */
export const trustPermissionsFromResponse = (
  response: { granted?: readonly BTPPermissionName[] },
  request: { permissions?: BTPTrustPermissions; given?: readonly BTPDetailPermission[] },
): { requester: BTPTrustRecordPermissions; responder: BTPTrustRecordPermissions } | undefined => {
  const { granted } = response;
  if (!granted || !request.permissions) return undefined;
  const requested = request.permissions;
  const grantedDetails = detailsOf(granted);
  const given = [...(request.given ?? [])];
  return {
    requester: {
      requested,
      granted: [...granted],
      detailsHeld: grantedDetails,
      detailsShared: given,
    },
    responder: {
      requested,
      granted: [...granted],
      detailsHeld: given,
      detailsShared: grantedDetails,
    },
  };
};
