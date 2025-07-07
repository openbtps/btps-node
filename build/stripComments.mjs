import fs from 'fs/promises';
import fg from 'fast-glob';

function stripCommentsButPreserveLicense(source) {
  // Match all block comments (/** ... */), but preserve those with @license
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => {
      return /@license/.test(comment) ? comment : '';
    })
    .replace(/\/\/.*/g, ''); // Remove all line comments
}

export async function cleanOutputComments(dir) {
  const files = await fg(['**/*.js', '**/*.ts', '**/*.d.ts'], { cwd: dir, absolute: true });
  await Promise.all(
    files.map(async (file) => {
      const content = await fs.readFile(file, 'utf8');
      const stripped = stripCommentsButPreserveLicense(content);
      await fs.writeFile(file, stripped, 'utf8');
    }),
  );
}

await cleanOutputComments(`${process.cwd()}/dist`);
console.log('✅ Comments stripped from dist/');
