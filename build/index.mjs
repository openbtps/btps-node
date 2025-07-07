/* eslint-disable @typescript-eslint/no-var-requires */
import esbuild from 'esbuild';
import ora from 'ora';
import aliasPlugin from 'esbuild-plugin-alias';
import fg from 'fast-glob';
import { fileURLToPath } from 'url';
import { getFolderSizes, getFolderSizeTable } from './helpers.mjs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ESM-only module
(async () => {
  // 📦 Entry point resolution
  const entryPoints = await fg(['src/**/*.ts'], {
    ignore: ['**/*.test.ts', '**/*.spec.ts', '**/test/**'],
  });

  const spinner = ora(`📦 Building ${entryPoints.length} files with esbuild...`).start();
  await new Promise((resolve) => setTimeout(resolve, 2000)); // Let spinner show
  console.time('🕒 esbuild completed in');

  try {
    await esbuild.build({
      entryPoints,
      outdir: 'dist',
      bundle: false,
      platform: 'node',
      sourcemap: false,
      tsconfig: './tsconfig.json',
      logLevel: 'silent',
      minifySyntax: true,
      plugins: [
        aliasPlugin({
          '@core': path.resolve(__dirname, 'src/core'),
        }),
      ],
      format: 'esm',
      outExtension: { '.js': '.js' },
      target: ['node20'], // You can adjust
    });

    spinner.succeed('✅ esbuild finished successfully');
    console.timeEnd('🕒 esbuild completed in');

    console.log('\n📊 Output Folder Sizes:\n');
    const { sorted, totalKB } = getFolderSizes('dist');
    const table = getFolderSizeTable(sorted, totalKB);
    console.log(table.toString());
  } catch (err) {
    spinner.fail('❌ esbuild failed');
    console.error(err);
    process.exit(1);
  }
})();
