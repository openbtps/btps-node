import strip from 'strip-comments';
import fs from 'fs/promises';
import fg from 'fast-glob';

export const stripCommentsFromDist = async (distDir = 'dist') => {
  const files = await fg([`${distDir}/**/*.js`]);

  for (const file of files) {
    const code = await fs.readFile(file, 'utf8');
    const stripped = strip(code);
    await fs.writeFile(file, stripped, 'utf8');
  }

  console.log(`🧹 Stripped comments from ${files.length} files`);
};
