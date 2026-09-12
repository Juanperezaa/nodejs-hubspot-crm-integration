'use strict';

/**
 * Commit message rules, enforced in CI (see .github/workflows/ci.yml).
 *
 * The project follows Conventional Commits 1.0.0. Local git hooks are
 * deliberately NOT installed: a reviewer cloning this repository should be able
 * to run `npm install` without side effects on their git configuration.
 * Validation happens in CI instead, where it cannot be bypassed silently.
 *
 * @see https://www.conventionalcommits.org/en/v1.0.0/
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // new capability
        'fix', // defect repair
        'docs', // documentation only
        'refactor', // behaviour-preserving restructure
        'test', // tests only
        'perf', // performance
        'build', // build system or dependencies
        'ci', // pipeline configuration
        'chore', // housekeeping
        'revert', // reverts a previous commit
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'config',
        'client',
        'contacts',
        'deals',
        'associations',
        'sync',
        'errors',
        'fundamentals',
        'examples',
        'api',
        'docs',
        'tests',
        'ci',
        'repo',
      ],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
  },
};
