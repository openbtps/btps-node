/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * No docs page has a dot in its URL. A static server, and S3 website hosting, take a last
 * segment such as `1.2` for a file with an extension, never the folder holding index.html,
 * so the page answers 404 though it was built. A page's URL is its front matter's `slug`,
 * else its path under docs/, without the extension.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const DOCS = path.resolve(__dirname, '../docs/docusaurus/docs');

const pages = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pages(full);
    return /\.mdx?$/.test(entry.name) ? [full] : [];
  });

const urlOf = (file: string): string => {
  const text = fs.readFileSync(file, 'utf8');
  const frontMatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  const slug = /^slug:\s*(.+)$/m
    .exec(frontMatter)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  const dir = path.dirname(path.relative(DOCS, file));
  if (slug === undefined) return path.relative(DOCS, file).replace(/\.mdx?$/, '');
  return slug.startsWith('/') ? slug : path.join(dir, slug);
};

describe('the docs URLs', () => {
  const all = pages(DOCS);

  it('are there to check', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it('have no dot in any segment', () => {
    const dotted = all
      .map((file) => ({ page: path.relative(DOCS, file), url: urlOf(file) }))
      .filter(({ url }) => url.split('/').some((segment) => segment.includes('.')));
    expect(dotted).toEqual([]);
  });
});
