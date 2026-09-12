'use strict';

/**
 * ESLint flat configuration.
 *
 * The rule set is deliberately small and focused on the two things that matter
 * for this codebase: catching real defects (unused bindings, shadowed names,
 * forgotten awaits) and enforcing the naming conventions the project documents
 * in docs/ARCHITECTURE.md.
 */
module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**', 'dist/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      // --- Correctness ---------------------------------------------------
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-shadow': 'error',
      'no-return-await': 'error',
      'require-await': 'error',
      'no-throw-literal': 'error',
      eqeqeq: ['error', 'always'],

      // --- Clarity -------------------------------------------------------
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'always'],
      'consistent-return': 'error',

      // --- Naming --------------------------------------------------------
      // Identifiers are English, descriptive and unabbreviated. Two-character
      // names are almost always an abbreviation, so they are rejected outside
      // of conventional loop counters.
      // `fs` and `os` are the canonical names for those core modules; renaming
      // them would hurt readability rather than help it.
      'id-length': ['error', { min: 3, exceptions: ['i', 'j', '_', 'id', 'fn', 'to', 'fs', 'os'] }],
      camelcase: ['error', { properties: 'never' }],
    },
  },
  {
    // Tests may shadow and redefine freely for readability.
    files: ['tests/**/*.js'],
    rules: {
      'no-shadow': 'off',
      'id-length': 'off',
    },
  },
];
