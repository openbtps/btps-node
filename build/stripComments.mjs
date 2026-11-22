import strip from 'strip-comments';
import fs from 'fs/promises';
import fg from 'fast-glob';
import * as esbuild from 'esbuild';

export const stripCommentsFromDist = async (distDir = 'dist') => {
  const files = await fg([`${distDir}/**/*.js`]);

  for (const file of files) {
    const code = await fs.readFile(file, 'utf8');
    const stripped = strip(code);
    // strip-comments reads text, not JavaScript: it once took a "//" in a string for a comment and cut the line. A file
    // it leaves unparsable stops the build here, named, rather than failing wherever it is imported.
    try {
      await esbuild.transform(stripped, { loader: 'js', format: 'esm' });
    } catch (error) {
      throw new Error(
        `stripping comments broke ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await fs.writeFile(file, stripped, 'utf8');
  }

  console.log(`🧹 Stripped comments from ${files.length} files`);
};
