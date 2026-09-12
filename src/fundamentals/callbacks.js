'use strict';

/**
 * Section 1.1 — Asynchrony and callbacks.
 *
 * Brief: "Implement a function that simulates an asynchronous operation using
 * setTimeout or fs.readFile with a callback. Show its usage and result handling
 * in a separate file."
 *
 * Both forms are implemented, because they fail in different ways and the
 * difference is the point of the exercise:
 *
 *   - `readRecordAfterDelay` uses `setTimeout`, so its failure is a business
 *     rule the function decides on.
 *   - `readSeedFileWithCallback` uses `fs.readFile`, so its failure arrives
 *     from the operating system and must be forwarded rather than invented.
 *
 * Both follow Node's error-first callback contract: `callback(error, result)`,
 * where exactly one of the two arguments is meaningful, and the callback is
 * invoked exactly once.
 *
 * Run directly: `npm run fundamentals:callbacks`
 */

const fs = require('fs');
const path = require('path');

/** Where the synchronisation seed data lives; also used by Section 1.2. */
const SEED_FILE_PATH = path.resolve(__dirname, '..', '..', 'data', 'contacts.seed.json');

/**
 * Simulates an asynchronous lookup with `setTimeout`.
 *
 * The delay stands in for network latency. A record id of zero or less is
 * treated as invalid, which gives the function a genuine error path rather
 * than one that can never be reached.
 *
 * The callback is deferred even for the validation failure. Calling back
 * synchronously on some paths and asynchronously on others produces a function
 * that is sometimes reentrant and sometimes not — a defect known as "releasing
 * Zalgo", and a real source of ordering bugs. The contract here is: the
 * callback never runs before the caller returns.
 *
 * @param {number} recordId Identifier to look up.
 * @param {number} delayMilliseconds How long the simulated call should take.
 * @param {(error: Error|null, record?: {id: number, name: string, retrievedAt: string}) => void} callback
 *   Error-first callback, invoked exactly once.
 * @returns {void}
 */
function readRecordAfterDelay(recordId, delayMilliseconds, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('readRecordAfterDelay requires a callback function.');
  }

  setTimeout(() => {
    if (!Number.isInteger(recordId) || recordId <= 0) {
      callback(new Error(`Invalid record id: ${recordId}. Expected a positive integer.`));
      return;
    }

    callback(null, {
      id: recordId,
      name: `Simulated record #${recordId}`,
      retrievedAt: new Date().toISOString(),
    });
  }, delayMilliseconds);
}

/**
 * Reads and parses the seed file with `fs.readFile`.
 *
 * Two distinct failures are possible and are reported differently: the file may
 * be unreadable, which the operating system reports, or it may be unparseable,
 * which only becomes apparent after a successful read. Collapsing the two into
 * one message would send a reader looking at permissions when the real problem
 * is a stray comma.
 *
 * @param {string} filePath Absolute path to a JSON file.
 * @param {(error: Error|null, parsedContent?: unknown) => void} callback
 * @returns {void}
 */
function readSeedFileWithCallback(filePath, callback) {
  fs.readFile(filePath, 'utf8', (readError, fileContents) => {
    if (readError) {
      // Forwarded unchanged: the operating system's message ("no such file or
      // directory") is more useful than anything invented here.
      callback(readError);
      return;
    }

    try {
      callback(null, JSON.parse(fileContents));
    } catch (parseError) {
      callback(new Error(`${filePath} is not valid JSON: ${parseError.message}`));
    }
  });
}

/**
 * Demonstrates both functions, including their failure paths.
 *
 * The nesting is deliberate and is what Section 1.2 then removes: each step
 * depends on the previous one, so with callbacks the only way to sequence them
 * is to indent. Four steps is enough to see the shape of the problem.
 *
 * @returns {void}
 */
function demonstrateCallbackUsage() {
  process.stdout.write('\nSection 1.1 — Asynchrony and callbacks\n');
  process.stdout.write('='.repeat(66) + '\n\n');

  process.stdout.write('1. setTimeout, success path\n');
  readRecordAfterDelay(42, 120, (error, record) => {
    if (error) {
      process.stdout.write(`   unexpected failure: ${error.message}\n`);
      return;
    }
    process.stdout.write(`   retrieved: ${record.name} at ${record.retrievedAt}\n\n`);

    process.stdout.write('2. setTimeout, failure path (invalid id)\n');
    readRecordAfterDelay(-1, 60, (expectedError) => {
      process.stdout.write(`   handled: ${expectedError.message}\n\n`);

      process.stdout.write('3. fs.readFile, success path\n');
      readSeedFileWithCallback(SEED_FILE_PATH, (fileError, seedContacts) => {
        if (fileError) {
          process.stdout.write(`   failed: ${fileError.message}\n\n`);
        } else {
          process.stdout.write(`   parsed ${seedContacts.length} seed contacts\n\n`);
        }

        process.stdout.write('4. fs.readFile, failure path (missing file)\n');
        readSeedFileWithCallback(path.join(__dirname, 'does-not-exist.json'), (missingError) => {
          process.stdout.write(`   handled: ${missingError.code} — ${missingError.message}\n\n`);
          process.stdout.write(
            'Note the indentation: each step depends on the previous one, and\n' +
              'callbacks offer no way to sequence them except nesting. Section 1.2\n' +
              'removes exactly this by returning Promises.\n\n'
          );
        });
      });
    });
  });
}

// Runs the demonstration only when executed directly, so that importing this
// module from a test does not print to stdout.
if (require.main === module) {
  demonstrateCallbackUsage();
}

module.exports = {
  readRecordAfterDelay,
  readSeedFileWithCallback,
  demonstrateCallbackUsage,
  SEED_FILE_PATH,
};
