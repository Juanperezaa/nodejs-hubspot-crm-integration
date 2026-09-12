#!/usr/bin/env node
'use strict';

/**
 * Portable test discovery.
 *
 * `node --test` accepts three shapes, none of which is portable on its own:
 *
 *   node --test                    recurses from the working directory, but
 *                                  cannot exclude the integration suite
 *   node --test <directory>        unreliable on Windows, where the path is
 *                                  resolved as a module rather than scanned
 *   node --test "glob/**\/*.js"    glob support only landed in Node 21, so it
 *                                  fails on the 18.x and 20.x CI matrix legs
 *
 * Passing explicit file paths works on every supported version and platform, so
 * this script walks the requested directory, collects the test files and hands
 * the list to the runner unchanged. Any extra arguments are forwarded, which
 * keeps `--test-reporter`, `--watch` and friends available.
 *
 * Usage:
 *   node scripts/run-tests.js tests/unit
 *   node scripts/run-tests.js tests/integration --test-reporter=spec
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEST_FILE_SUFFIX = '.test.js';

/**
 * Collects every test file beneath a directory, depth first.
 *
 * @param {string} directory Absolute path to search.
 * @returns {string[]} Absolute paths of the discovered test files, sorted so
 *   that runs are reproducible regardless of filesystem ordering.
 */
function discoverTestFiles(directory) {
  const discovered = [];

  const walk = (currentDirectory) => {
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(TEST_FILE_SUFFIX)) {
        discovered.push(entryPath);
      }
    }
  };

  walk(directory);
  return discovered.sort();
}

function main() {
  const [requestedDirectory, ...forwardedArguments] = process.argv.slice(2);

  if (!requestedDirectory) {
    process.stderr.write('Usage: node scripts/run-tests.js <directory> [node --test options]\n');
    process.exit(1);
  }

  const absoluteDirectory = path.resolve(process.cwd(), requestedDirectory);

  if (!fs.existsSync(absoluteDirectory)) {
    process.stderr.write(`Test directory not found: ${requestedDirectory}\n`);
    process.exit(1);
  }

  const testFiles = discoverTestFiles(absoluteDirectory);

  if (testFiles.length === 0) {
    // An empty suite is a configuration mistake, not a pass. Failing here
    // prevents a green build that actually ran nothing.
    process.stderr.write(`No ${TEST_FILE_SUFFIX} files found under ${requestedDirectory}\n`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, ['--test', ...forwardedArguments, ...testFiles], {
    stdio: 'inherit',
  });

  process.exit(result.status === null ? 1 : result.status);
}

main();
