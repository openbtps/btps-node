// Deletes every .d.ts under dist that no package entry point can reach. The
// exports map allows importing only the entry points, so a declaration no
// entry reaches is never read by a consumer's compiler; zod's inferred types
// made those files most of the package. The .js files are all kept.
import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';

const distDir = 'dist';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const entryDeclarations = Object.values(pkg.exports).map((target) =>
  path.normalize(target.import.replace(/\.js$/, '.d.ts')),
);

const specifierPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

const resolveDeclaration = (fromFile, specifier) => {
  const base = path.normalize(path.join(path.dirname(fromFile), specifier));
  const candidates = [
    base.replace(/\.js$/, '.d.ts'),
    `${base}.d.ts`,
    path.join(base, 'index.d.ts'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
};

const reachable = new Set();
const queue = [...entryDeclarations];
while (queue.length) {
  const file = queue.pop();
  if (reachable.has(file)) continue;
  if (!fs.existsSync(file)) {
    throw new Error(`pruneTypes: ${file} is reachable but was not emitted`);
  }
  reachable.add(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const [, specifier] of text.matchAll(specifierPattern)) {
    const resolved = resolveDeclaration(file, specifier);
    if (!resolved) {
      throw new Error(`pruneTypes: cannot resolve ${specifier} from ${file}`);
    }
    queue.push(resolved);
  }
}

const declarations = fg.sync(`${distDir}/**/*.d.ts`).map((file) => path.normalize(file));
let keptBytes = 0;
let removedBytes = 0;
for (const file of declarations) {
  const size = fs.statSync(file).size;
  if (reachable.has(file)) {
    keptBytes += size;
  } else {
    removedBytes += size;
    fs.unlinkSync(file);
  }
}

const kb = (bytes) => Math.round(bytes / 1024);
console.log(
  `🧹 Type declarations: kept ${reachable.size} files (${kb(keptBytes)} KB), removed ${
    declarations.length - reachable.size
  } unreachable (${kb(removedBytes)} KB)`,
);
