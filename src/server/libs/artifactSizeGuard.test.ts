/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  artifactSizeGuard,
  DEFAULT_MAX_ARTIFACT_SIZE_KB,
  MIN_MAX_ARTIFACT_SIZE_KB,
  resolveMaxArtifactSizeKb,
} from './artifactSizeGuard.js';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_ARTIFACT_TOO_LARGE } from '@core/error/constant.js';

describe('resolveMaxArtifactSizeKb', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses 5120 KB when nothing is set, without a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactSizeKb(undefined)).toBe(DEFAULT_MAX_ARTIFACT_SIZE_KB);
    expect(DEFAULT_MAX_ARTIFACT_SIZE_KB).toBe(5120);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses any limit from 1024 KB up as given, with no maximum', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactSizeKb(1024)).toBe(1024);
    expect(resolveMaxArtifactSizeKb(2048)).toBe(2048);
    expect(resolveMaxArtifactSizeKb(100 * 1024)).toBe(100 * 1024);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and uses the 1024 KB minimum for a smaller limit', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMaxArtifactSizeKb(512)).toBe(MIN_MAX_ARTIFACT_SIZE_KB);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('below the 1024 KB minimum'));
  });

  it('warns and uses the default for a value that is not a size', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveMaxArtifactSizeKb(value)).toBe(DEFAULT_MAX_ARTIFACT_SIZE_KB);
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });
});

describe('artifactSizeGuard', () => {
  // Writes the chunks through a guard with a 1 KB limit; resolves with what
  // passed through and every refusal it reported.
  const run = (chunks: Buffer[]) =>
    new Promise<{ passed: Buffer; refused: BTPErrorException[] }>((resolve, reject) => {
      const refused: BTPErrorException[] = [];
      const guard = artifactSizeGuard(1, (error) => refused.push(error));
      const passed: Buffer[] = [];
      guard.on('data', (chunk: Buffer) => passed.push(chunk));
      guard.on('error', reject);
      guard.on('end', () => resolve({ passed: Buffer.concat(passed), refused }));
      for (const chunk of chunks) guard.write(chunk);
      guard.end();
    });
  const bytes = (count: number, char = 'a') => Buffer.alloc(count, char);
  const newline = Buffer.from('\n');

  it('passes lines up to the limit through unchanged, across chunks', async () => {
    const chunks = [bytes(600), bytes(424), newline, bytes(1024), newline];
    const { passed, refused } = await run(chunks);
    expect(refused).toEqual([]);
    expect(passed).toEqual(Buffer.concat(chunks));
  });

  it('counts each line on its own, so many lines may together pass the limit', async () => {
    const { refused } = await run([Buffer.concat([bytes(900), newline, bytes(900), newline])]);
    expect(refused).toEqual([]);
  });

  it('refuses a line over the limit that arrives across chunks, before it ends', async () => {
    const { refused } = await run([bytes(600), bytes(600)]);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toBeInstanceOf(BTPErrorException);
    expect(refused[0]).toMatchObject({
      code: BTP_ERROR_ARTIFACT_TOO_LARGE.code,
      message: `${BTP_ERROR_ARTIFACT_TOO_LARGE.message}: 1 KB`,
    });
  });

  it('refuses a line over the limit that arrives whole inside one chunk', async () => {
    const { refused } = await run([
      Buffer.concat([bytes(10), newline, bytes(1025), newline, bytes(10)]),
    ]);
    expect(refused[0]).toMatchObject({ code: BTP_ERROR_ARTIFACT_TOO_LARGE.code });
  });

  it('counts bytes, not characters', async () => {
    // 342 three-byte characters: 342 characters, 1026 bytes.
    const { refused } = await run([Buffer.from('€'.repeat(342)), newline]);
    expect(refused[0]).toMatchObject({ code: BTP_ERROR_ARTIFACT_TOO_LARGE.code });
  });

  it('reports once, then drops everything after, without failing the stream', async () => {
    const before = Buffer.concat([bytes(100), newline]);
    const { passed, refused } = await run([
      before,
      bytes(600),
      bytes(600),
      bytes(5000),
      Buffer.concat([newline, bytes(10), newline]),
    ]);
    expect(refused).toHaveLength(1);
    expect(passed).toEqual(Buffer.concat([before, bytes(600)]));
  });
});
