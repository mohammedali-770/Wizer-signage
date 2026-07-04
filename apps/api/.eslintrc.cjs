// ESLint config for @wizer/api.
// Extends the root config and points the TypeScript parser at this package's tsconfig.
/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: false,
  extends: ['../../.eslintrc.cjs'],
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs'],
};
