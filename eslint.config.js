import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typescriptFiles = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/vendor/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended.map(config => ({ ...config, files: typescriptFiles })),
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: globals.node },
    rules: { 'no-unused-vars': 'warn', 'no-empty': 'warn', 'preserve-caught-error': 'warn' }
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker }
  },
  {
    files: typescriptFiles,
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-control-regex': 'warn',
      'no-empty': 'warn',
      'no-useless-assignment': 'warn'
    }
  }
);
