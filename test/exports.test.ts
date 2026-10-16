/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Each name a user needs imports from its
 * package subpath. The subpath is resolved through package.json's own
 * `exports` map, from the built file it names back to the source file it is
 * built from, so this runs without a build.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  Signer,
  SignerAlgorithm,
  SignerPublicKey,
  Decrypter,
  DecrypterAlgorithm,
  DecryptRequest,
  PemSignerOptions,
  PemDecrypterOptions,
  KmsSignClient,
  KmsSignerOptions,
  KmsDecryptClient,
  KmsDecrypterOptions,
  BTPSigningKey,
  BTPDecryptionKey,
  BTPDecryptionKeys,
  BTPSenderKey,
} from '../src/core/crypto/index.js';

const ROOT = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, { import: string }>;
};

/** Imports a package subpath, as `@btps/sdk<subpath>` would, from source. */
const importSubpath = async (subpath: string): Promise<Record<string, unknown>> => {
  const target = pkg.exports[subpath]?.import;
  if (!target) throw new Error(`package.json exports no ${subpath}`);
  const source = target.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts');
  return import(join(ROOT, source));
};

const expected: Record<string, string[]> = {
  './crypto': [
    'PemSigner',
    'KmsSigner',
    'KmsSignerError',
    'PemDecrypter',
    'KmsDecrypter',
    'KmsDecrypterError',
    'toSigner',
    'toDecrypter',
    'isSigner',
    'isDecrypter',
    'signBtpPayload',
    'decryptBtpPayload',
    'signEncrypt',
    'decryptVerify',
  ],
  './client': ['BtpsClient', 'BtpsAgent', 'BtpsTransporter'],
};

describe('package exports (crypto and client)', () => {
  for (const [subpath, names] of Object.entries(expected)) {
    it.each(names)(`@btps/sdk${subpath.slice(1)} exports %s`, async (name) => {
      const mod = await importSubpath(subpath);
      expect(mod[name], `${name} from ${subpath}`).toBeTypeOf('function');
    });
  }

  it('the crypto subpath exports the Signer and Decrypter types', () => {
    // Checked by `tsc`: the import above fails to compile if a type is missing.
    expectTypeOf<Signer['algorithm']>().toEqualTypeOf<SignerAlgorithm>();
    expectTypeOf<Awaited<ReturnType<Signer['getPublicKey']>>>().toEqualTypeOf<SignerPublicKey>();
    expectTypeOf<Decrypter['algorithm']>().toEqualTypeOf<DecrypterAlgorithm>();
    expectTypeOf<Parameters<Decrypter['decrypt']>[0]>().toEqualTypeOf<DecryptRequest>();
    expectTypeOf<BTPDecryptionKey>().toEqualTypeOf<Decrypter | string>();
    expectTypeOf<Signer>().toMatchTypeOf<BTPSigningKey>();
    expectTypeOf<BTPDecryptionKey>().toMatchTypeOf<BTPDecryptionKeys>();
    expectTypeOf<{ signer: Signer }>().toMatchTypeOf<BTPSenderKey>();
    expectTypeOf<PemSignerOptions>().toHaveProperty('privateKey');
    expectTypeOf<PemDecrypterOptions>().toHaveProperty('privateKey');
    expectTypeOf<KmsSignerOptions['client']>().toEqualTypeOf<KmsSignClient>();
    expectTypeOf<KmsDecrypterOptions['client']>().toEqualTypeOf<KmsDecryptClient>();
  });
});

describe('package exports (replay protection)', () => {
  it.each([
    ['./storage', 'AbstractReplayStore'],
    ['./storage', 'InMemoryReplayStore'],
    ['./storage', 'computeReplayKey'],
    ['.', 'checkIssuedAtWindow'],
    ['.', 'resolveIssuedAtWindow'],
  ])('@btps/sdk%s exports %s', async (subpath, name) => {
    const mod = await importSubpath(subpath);
    expect(mod[name], `${name} from ${subpath}`).toBeTypeOf('function');
  });

  it.each([
    ['./server', 'ISSUED_AT_WINDOW_MS'],
    ['./server', 'MAX_ISSUED_AT_WINDOW_MS'],
    ['./error', 'BTP_ERROR_ISSUED_AT_WINDOW'],
    ['./error', 'BTP_ERROR_ALREADY_RECEIVED'],
  ])('@btps/sdk%s exports %s', async (subpath, name) => {
    const mod = await importSubpath(subpath);
    expect(mod[name], `${name} from ${subpath}`).toBeDefined();
  });
});

describe('package exports (key-rotating refresh)', () => {
  it.each([
    ['./authentication', 'verifyAgentRefresh'],
    ['./authentication', 'signKeyProof'],
    ['./authentication', 'keyProofPayload'],
  ])('@btps/sdk%s exports %s', async (subpath, name) => {
    const mod = await importSubpath(subpath);
    expect(mod[name], `${name} from ${subpath}`).toBeTypeOf('function');
  });

  it.each([
    ['./error', 'BTP_ERROR_REFRESH_NOT_CURRENT_KEY'],
    ['./error', 'BTP_ERROR_KEY_ROTATION_PROOF'],
  ])('@btps/sdk%s exports %s', async (subpath, name) => {
    const mod = await importSubpath(subpath);
    expect(mod[name], `${name} from ${subpath}`).toBeDefined();
  });

  it('BtpsAuthentication has rotateKey', async () => {
    const mod = (await importSubpath('./authentication')) as {
      BtpsAuthentication: { rotateKey: unknown };
    };
    expect(mod.BtpsAuthentication.rotateKey).toBeTypeOf('function');
  });
});

describe('package exports (device registration)', () => {
  it.each([
    ['./authentication', 'consumeRegistrationToken'],
    ['./authentication', 'resolveAgentKey'],
    ['./authentication', 'isAgentId'],
  ])('@btps/sdk%s exports %s', async (subpath, name) => {
    const mod = await importSubpath(subpath);
    expect(mod[name], `${name} from ${subpath}`).toBeTypeOf('function');
  });

  it.each([
    ['./authentication', 'REGISTRATION_ERRORS'],
    ['./error', 'BTP_ERROR_REGISTRATION_UNAVAILABLE'],
    ['./error', 'BTP_ERROR_REGISTRATION_TOKEN_MISSING'],
    ['./error', 'BTP_ERROR_REGISTRATION_TOKEN_INVALID'],
    ['./error', 'BTP_ERROR_REGISTRATION_TOKEN_USED'],
    ['./error', 'BTP_ERROR_REGISTRATION_IDENTITY_MISMATCH'],
  ])('@btps/sdk%s exports %s', async (subpath, name) => {
    const mod = await importSubpath(subpath);
    expect(mod[name], `${name} from ${subpath}`).toBeDefined();
  });
});

describe('package exports (EBA-442 and EBA-186, identity lookup)', () => {
  it.each([
    ['./crypto', 'verifyIdentityLookupResponse'],
    ['.', 'parseBtpsTxtRecord'],
    ['.', 'getDnsIdentityParts'],
  ])('@btps/sdk%s exports %s', async (subpath, name) => {
    const mod = await importSubpath(subpath);
    expect(mod[name], `${name} from ${subpath}`).toBeTypeOf('function');
  });

  it('@btps/sdk/error exports BTP_ERROR_SERVER_SELECTOR', async () => {
    const mod = await importSubpath('./error');
    expect(mod.BTP_ERROR_SERVER_SELECTOR).toBeDefined();
  });
});
