'use strict';

/**
 * Section 1.2 — Promises and async/await.
 *
 * Brief: "Refactor the previous function to return a Promise. Consume the
 * function with async/await."
 *
 * The refactor is the point, so the two functions from Section 1.1 are
 * genuinely rewritten here rather than re-implemented: `readRecordAfterDelay`
 * and `readSeedFileWithCallback` are wrapped, preserving their behaviour
 * exactly while changing how a caller composes them.
 *
 * What the refactor buys, concretely:
 *
 *   - Sequencing stops requiring indentation. The four-step demonstration in
 *     Section 1.1 nests four levels deep; the same four steps here are flat.
 *   - Error handling collapses into one `try/catch` instead of an `if (error)`
 *     branch repeated at every level.
 *   - Independent work can genuinely overlap, via `Promise.all`. With
 *     callbacks that requires a counter and a guard against calling back twice.
 *
 * Run directly: `npm run fundamentals:async`
 */

const path = require('path');
const { promisify } = require('util');

const { readRecordAfterDelay, readSeedFileWithCallback, SEED_FILE_PATH } = require('./callbacks');

/**
 * The Promise-returning form of `readRecordAfterDelay`.
 *
 * Written out by hand rather than with `promisify` to show the mechanics: the
 * executor runs immediately, and the callback's two branches become the two
 * ways a Promise can settle. `promisify` does exactly this, and is used for the
 * second function below to show the shorthand.
 *
 * @param {number} recordId
 * @param {number} [delayMilliseconds]
 * @returns {Promise<{id: number, name: string, retrievedAt: string}>}
 */
function readRecordAfterDelayAsync(recordId, delayMilliseconds = 100) {
  return new Promise((resolve, reject) => {
    readRecordAfterDelay(recordId, delayMilliseconds, (error, record) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(record);
    });
  });
}

/**
 * The Promise-returning form of `readSeedFileWithCallback`.
 *
 * `promisify` applies because the function already honours Node's error-first
 * contract — which is the practical reward for having followed it.
 *
 * @type {(filePath: string) => Promise<unknown>}
 */
const readSeedFileAsync = promisify(readSeedFileWithCallback);

/**
 * Retrieves several records concurrently.
 *
 * `Promise.all` rejects as soon as any one input rejects, which is the right
 * behaviour when the caller needs every result: there is no point awaiting the
 * rest once the answer is already unusable.
 *
 * @param {number[]} recordIds
 * @returns {Promise<Array<{id: number, name: string, retrievedAt: string}>>}
 */
function readRecordsConcurrently(recordIds) {
  return Promise.all(recordIds.map((recordId) => readRecordAfterDelayAsync(recordId, 80)));
}

/**
 * Retrieves several records, reporting per-record outcomes.
 *
 * `Promise.allSettled` is the counterpart to `Promise.all` and the right choice
 * when partial success is still useful — which is exactly the situation the
 * synchronisation services in Section 2 face: one malformed contact in a batch
 * of fifty should not discard the other forty-nine.
 *
 * @param {number[]} recordIds
 * @returns {Promise<{fulfilled: object[], rejected: string[]}>}
 */
async function readRecordsAllowingPartialFailure(recordIds) {
  const settledResults = await Promise.allSettled(
    recordIds.map((recordId) => readRecordAfterDelayAsync(recordId, 80))
  );

  return {
    fulfilled: settledResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value),
    rejected: settledResults
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason.message),
  };
}

/**
 * Demonstrates the refactored functions with async/await.
 *
 * @returns {Promise<void>}
 */
async function demonstrateAsyncAwaitUsage() {
  process.stdout.write('\nSection 1.2 — Promises and async/await\n');
  process.stdout.write('='.repeat(66) + '\n\n');

  // --- 1. Sequential, flat where Section 1.1 had to nest -------------------
  process.stdout.write('1. Sequential steps, no nesting\n');
  try {
    const firstRecord = await readRecordAfterDelayAsync(42);
    process.stdout.write(`   retrieved: ${firstRecord.name}\n`);

    const seedContacts = await readSeedFileAsync(SEED_FILE_PATH);
    process.stdout.write(`   parsed ${seedContacts.length} seed contacts\n\n`);
  } catch (error) {
    process.stdout.write(`   failed: ${error.message}\n\n`);
  }

  // --- 2. One catch for every step above -----------------------------------
  process.stdout.write('2. Failure path, handled by a single try/catch\n');
  try {
    await readRecordAfterDelayAsync(-1);
    process.stdout.write('   unreachable: the call above should have rejected\n\n');
  } catch (error) {
    process.stdout.write(`   caught: ${error.message}\n\n`);
  }

  // --- 3. Genuine concurrency ----------------------------------------------
  process.stdout.write('3. Concurrent retrieval with Promise.all\n');
  const startedAt = Date.now();
  const records = await readRecordsConcurrently([1, 2, 3, 4, 5]);
  const elapsedMilliseconds = Date.now() - startedAt;
  process.stdout.write(`   retrieved ${records.length} records in ${elapsedMilliseconds} ms\n`);
  process.stdout.write('   sequentially this would have taken roughly 400 ms\n\n');

  // --- 4. Partial success ---------------------------------------------------
  process.stdout.write('4. Partial failure with Promise.allSettled\n');
  const mixedOutcome = await readRecordsAllowingPartialFailure([7, -1, 9, 0]);
  process.stdout.write(`   succeeded: ${mixedOutcome.fulfilled.length}\n`);
  process.stdout.write(`   failed   : ${mixedOutcome.rejected.length}\n`);
  for (const failureMessage of mixedOutcome.rejected) {
    process.stdout.write(`     - ${failureMessage}\n`);
  }

  // --- 5. Failure that is not the caller's fault ----------------------------
  process.stdout.write('\n5. Rejected file read, awaited\n');
  try {
    await readSeedFileAsync(path.join(__dirname, 'does-not-exist.json'));
  } catch (error) {
    process.stdout.write(`   caught: ${error.code} — ${error.message}\n`);
  }

  process.stdout.write(
    '\nThe same four steps as Section 1.1, with no nesting and one catch\n' +
      'per concern. This is the shape every HubSpot call in Section 2 uses.\n\n'
  );
}

if (require.main === module) {
  demonstrateAsyncAwaitUsage().catch((error) => {
    process.stderr.write(`Demonstration failed: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  readRecordAfterDelayAsync,
  readSeedFileAsync,
  readRecordsConcurrently,
  readRecordsAllowingPartialFailure,
  demonstrateAsyncAwaitUsage,
};
