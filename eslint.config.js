import js from '@eslint/js';

export default [
  {
    languageOptions: {
      globals: {
        node: true,
        es6: true
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    rules: {
      'require-atomic-updates': 0,
      'no-extra-semi': 0,
      'no-mixed-spaces-and-tabs': 0,
      'unicorn/filename-case': 0,
      'unicorn/prevent-abbreviations': 0,
      'unicorn/no-array-reduce': 0,
      'unicorn/prefer-spread': 0
    }
  },
  js.configs.recommended
];
