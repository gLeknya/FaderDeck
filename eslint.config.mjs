import js from '@eslint/js';
import globals from 'globals';

const commonjsFiles = [
  'main.js',
  'preload.js',
  'overlay-preload.js',
  'backend/**/*.js',
  'shared/**/*.js'
];

export default [
  {
    ignores: ['node_modules/**', 'release/**', 'dist/**', 'coverage/**']
  },
  {
    ...js.configs.recommended,
    files: commonjsFiles,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off'
    }
  },
  {
    ...js.configs.recommended,
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    }
  }
];
