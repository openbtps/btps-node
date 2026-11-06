/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: the values of trust permissions, checked once a request or answer
 * is opened. The names travel on the envelope and are checked on arrival; these
 * rules confirm the encrypted values match them: a value for every name, valid
 * for its name, and no value without a name.
 */

import { z } from 'zod';
import { BTPS_FIELD_LIMITS } from '../constants/limits.js';
import { httpsUrl, sha256Hex } from './btpsDocsSchema.js';

const { trustRequest, detailNumber } = BTPS_FIELD_LIMITS;
const text = (max: number) => z.string().min(1).max(max);
const numberInCountry = z
  .object({
    number: text(detailNumber),
    country: z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code'),
  })
  .strict();
const dateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine(
    (date) => {
      // Run even when the form is wrong, so an invalid date must not throw.
      const time = Date.parse(`${date}T00:00:00.000Z`);
      return !Number.isNaN(time) && new Date(time).toISOString().startsWith(date);
    },
    { message: 'must be a real date' },
  );

/** Since 1.2: the value each detail permission carries. */
export const BtpDetailValueSchemas: Record<string, z.ZodTypeAny> = {
  'detail:legalName': text(trustRequest.name),
  'detail:profile': z
    .object({
      displayName: text(trustRequest.displayName),
      logo: z.object({ sha256: sha256Hex, source: httpsUrl }).strict().optional(),
      website: httpsUrl.optional(),
    })
    .strict(),
  'detail:email': z.string().max(trustRequest.email).email(),
  'detail:phone': text(trustRequest.phone),
  'detail:address': text(trustRequest.address),
  'detail:taxNo': numberInCountry,
  'detail:dob': dateOfBirth,
  'detail:registrationNumber': numberInCountry,
};

/**
 * The details a 1.1 trust request already has a field for: there the value
 * stays, and it is never repeated in `own`. `detail:profile` is its
 * `displayName`, with `logoUrl` and `websiteUrl`.
 */
const REQUEST_FIELDS: Record<string, string> = {
  'detail:legalName': 'name',
  'detail:email': 'email',
  'detail:phone': 'phone',
  'detail:address': 'address',
  'detail:profile': 'displayName',
};

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Why one value is not a valid value for its name, or undefined. */
const valueProblem = (where: string, name: string, value: unknown): string | undefined =>
  BtpDetailValueSchemas[name]?.safeParse(value).success
    ? undefined
    : `${where}'s ${name} is not a valid ${name}`;

/**
 * Since 1.2: why an opened trust request's values do not match the names it
 * gives (`given`), or undefined. Each name given has its value, in the 1.1
 * field it has or else in `own`; `own` holds only names given that 1.1 has no
 * field for.
 */
export const trustRequestProblem = (artifact: {
  given?: readonly string[];
  document?: unknown;
}): string | undefined => {
  const document = recordOf(artifact.document);
  if (!document) return 'a trust request is checked once it is opened';
  const own = document.own === undefined ? {} : recordOf(document.own);
  if (!own) return 'own holds values by name';
  const given = artifact.given ?? [];
  for (const name of given) {
    const field = REQUEST_FIELDS[name];
    if (field !== undefined) {
      if (document[field] === undefined) return `${name} is given, so the request has its ${field}`;
      continue;
    }
    if (own[name] === undefined) return `${name} is given, so own holds its value`;
    const problem = valueProblem('own', name, own[name]);
    if (problem) return problem;
  }
  for (const name of Object.keys(own)) {
    if (!given.includes(name)) return `own holds ${name}, which is not given`;
    const field = REQUEST_FIELDS[name];
    if (field !== undefined) return `${name} is the request's ${field}, never repeated in own`;
  }
  return undefined;
};

/**
 * Since 1.2: why an opened trust answer's values do not match the names it
 * grants, or undefined. `details` holds a value for every `detail:` name
 * granted, by name, and nothing else.
 */
export const trustResponseProblem = (artifact: {
  granted?: readonly string[];
  document?: unknown;
}): string | undefined => {
  const document = recordOf(artifact.document);
  if (!document) return 'a trust answer is checked once it is opened';
  const details = document.details === undefined ? {} : recordOf(document.details);
  if (!details) return 'details holds values by name';
  const granted = (artifact.granted ?? []).filter((name) => name.startsWith('detail:'));
  for (const name of granted) {
    if (details[name] === undefined) return `${name} is granted, so details holds its value`;
    const problem = valueProblem('details', name, details[name]);
    if (problem) return problem;
  }
  for (const name of Object.keys(details)) {
    if (!granted.includes(name)) return `details holds ${name}, which is not granted`;
  }
  return undefined;
};
