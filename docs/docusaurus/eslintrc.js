module.exports = {
  // ... existing config
  settings: {
    'import/resolver': {
      alias: {
        map: [
          ['@theme', './node_modules/@docusaurus/theme-classic/lib/theme'],
          ['@docusaurus', './node_modules/@docusaurus/core/lib/client/exports'],
        ],
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
      },
    },
  },
};
