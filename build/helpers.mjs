import Table from 'cli-table3';
import chalk from 'chalk';
import fg from 'fast-glob';
import fs from 'fs';
import path from 'path';

export const getFolderSizeTable = (rows, totalKB) => {
  const table = new Table({
    head: [chalk.bold('Folder'), chalk.bold('TotalSizeKB')],
    style: { head: ['green'], border: [] },
    colWidths: [30, 14],
  });

  let folderNames = '';
  let folderSizes = '';

  for (const row of rows) {
    folderNames += `${row.Folder}\n`;
    folderSizes += `${row.TotalSizeKB} KB \n`;
  }
  table.push([folderNames.trim(), folderSizes.trim()]);

  // Add footer row
  table.push([chalk.bold('TOTAL'), chalk.bold(`${totalKB} KB`)]);

  return table;
};

export const getFolderSizes = (distPath) => {
  const files = fg.sync(`${distPath}/**/*.js`, { dot: false });
  const folderSizes = {};

  for (const file of files) {
    const size = fs.statSync(file).size;
    const rel = path.relative(distPath, file);
    const parts = rel.split(path.sep);

    const folderKey = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : rel;
    folderSizes[folderKey] = (folderSizes[folderKey] || 0) + size;
  }

  const sorted = Object.entries(folderSizes)
    .sort((a, b) => b[1] - a[1])
    .map(([folder, size]) => ({
      Folder: folder,
      TotalSizeKB: (size / 1024).toFixed(2),
    }));

  const totalKB = sorted.reduce((sum, row) => sum + parseFloat(row.TotalSizeKB), 0);
  return { sorted, totalKB: totalKB.toFixed(2) };
};
