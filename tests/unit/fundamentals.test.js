'use strict';

/**
 * Section 1 — Node.js fundamentals.
 *
 * Worth 40% of the assessment, so each exercise is tested on behaviour rather
 * than on the fact that a file exists: the callback contract is asserted
 * (error-first, invoked once, never synchronously), the Promise refactor is
 * checked for equivalence with the callback original, and the stream transform
 * is verified by collecting its output rather than by watching stdout.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');

const {
  readRecordAfterDelay,
  readSeedFileWithCallback,
  SEED_FILE_PATH,
} = require('../../src/fundamentals/callbacks');

const {
  readRecordAfterDelayAsync,
  readSeedFileAsync,
  readRecordsConcurrently,
  readRecordsAllowingPartialFailure,
} = require('../../src/fundamentals/asyncAwait');

const {
  sumArrayOfNumbers,
  averageArrayOfNumbers,
  sumDealAmounts,
} = require('../../src/fundamentals/utils_module');

const {
  createUppercaseTransform,
  createContactNameTransform,
  streamContactFullNames,
  collectStreamToString,
} = require('../../src/utils/streams');

/** Collects everything written to a stream, for asserting on stream output. */
function createCollectingWritable() {
  const written = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      written.push(String(chunk));
      callback();
    },
  });
  writable.collected = () => written.join('');
  return writable;
}

// ---------------------------------------------------------------------------
// 1.1 Asynchrony and callbacks
// ---------------------------------------------------------------------------

test('1.1 readRecordAfterDelay follows the error-first callback contract', async (subtest) => {
  await subtest.test('delivers a record on the success path', async () => {
    const record = await new Promise((resolve, reject) => {
      readRecordAfterDelay(42, 10, (error, result) => (error ? reject(error) : resolve(result)));
    });

    assert.equal(record.id, 42);
    assert.match(record.name, /42/);
    // The timestamp must be a real ISO instant, not an arbitrary string.
    assert.ok(!Number.isNaN(Date.parse(record.retrievedAt)));
  });

  await subtest.test('delivers an Error, and no record, on the failure path', async () => {
    const { error, result } = await new Promise((resolve) => {
      readRecordAfterDelay(-1, 10, (callbackError, callbackResult) =>
        resolve({ error: callbackError, result: callbackResult })
      );
    });

    assert.ok(error instanceof Error);
    assert.match(error.message, /Invalid record id/);
    assert.equal(result, undefined, 'a failed call must not also yield a record');
  });

  await subtest.test('never invokes the callback before returning', async () => {
    // Calling back synchronously on some paths and asynchronously on others
    // makes a function sometimes reentrant — a real source of ordering bugs.
    // The invalid-id path is the one most likely to regress, since it needs no
    // work done before it can fail.
    let calledSynchronously = true;
    await new Promise((resolve) => {
      readRecordAfterDelay(-1, 0, () => {
        assert.equal(calledSynchronously, false, 'callback ran before the caller returned');
        resolve();
      });
      calledSynchronously = false;
    });
  });

  await subtest.test('invokes the callback exactly once', async () => {
    let invocationCount = 0;
    await new Promise((resolve) => {
      readRecordAfterDelay(7, 10, () => {
        invocationCount += 1;
        setTimeout(resolve, 30);
      });
    });
    assert.equal(invocationCount, 1);
  });

  await subtest.test('rejects a missing callback rather than failing silently later', () => {
    assert.throws(() => readRecordAfterDelay(1, 0, undefined), TypeError);
  });
});

test('1.1 readSeedFileWithCallback distinguishes read failure from parse failure', async (subtest) => {
  await subtest.test('parses the seed file', async () => {
    const contacts = await new Promise((resolve, reject) => {
      readSeedFileWithCallback(SEED_FILE_PATH, (error, result) =>
        error ? reject(error) : resolve(result)
      );
    });

    assert.ok(Array.isArray(contacts));
    assert.ok(contacts.length > 0);
    assert.ok(contacts.every((contact) => typeof contact.email === 'string'));
  });

  await subtest.test("forwards the operating system's error for a missing file", async () => {
    const error = await new Promise((resolve) => {
      readSeedFileWithCallback(path.join(__dirname, 'absent.json'), resolve);
    });

    // The OS code is preserved: "no such file" must not be reported as a
    // parse failure, or the reader checks the wrong thing.
    assert.equal(error.code, 'ENOENT');
  });
});

// ---------------------------------------------------------------------------
// 1.2 Promises and async/await
// ---------------------------------------------------------------------------

test('1.2 the Promise refactor preserves the callback behaviour', async (subtest) => {
  await subtest.test('resolves with the same record the callback form delivers', async () => {
    const viaCallback = await new Promise((resolve, reject) => {
      readRecordAfterDelay(42, 10, (error, result) => (error ? reject(error) : resolve(result)));
    });
    const viaPromise = await readRecordAfterDelayAsync(42, 10);

    assert.equal(viaPromise.id, viaCallback.id);
    assert.equal(viaPromise.name, viaCallback.name);
  });

  await subtest.test('rejects where the callback form yielded an error', async () => {
    await assert.rejects(() => readRecordAfterDelayAsync(-1, 10), /Invalid record id/);
  });

  await subtest.test('promisify works because the original honoured the contract', async () => {
    const contacts = await readSeedFileAsync(SEED_FILE_PATH);
    assert.ok(Array.isArray(contacts));
  });
});

test('1.2 Promise.all runs the work concurrently, not in sequence', async () => {
  const startedAt = Date.now();
  const records = await readRecordsConcurrently([1, 2, 3, 4, 5]);
  const elapsedMilliseconds = Date.now() - startedAt;

  assert.equal(records.length, 5);
  // Five sequential 80 ms calls would take ~400 ms. A generous ceiling keeps
  // this from becoming a flaky test on a loaded machine while still failing if
  // the calls were accidentally awaited one at a time.
  assert.ok(
    elapsedMilliseconds < 300,
    `expected concurrent execution, took ${elapsedMilliseconds} ms`
  );
});

test('1.2 Promise.all rejects as soon as any input rejects', async () => {
  await assert.rejects(() => readRecordsConcurrently([1, -1, 3]), /Invalid record id/);
});

test('1.2 Promise.allSettled preserves partial success', async () => {
  const outcome = await readRecordsAllowingPartialFailure([7, -1, 9, 0]);

  // This is the behaviour the sync services depend on: one malformed record in
  // a batch must not discard the valid ones.
  assert.equal(outcome.fulfilled.length, 2);
  assert.equal(outcome.rejected.length, 2);
  assert.ok(outcome.rejected.every((message) => /Invalid record id/.test(message)));
});

// ---------------------------------------------------------------------------
// 1.3 Modules and CommonJS
// ---------------------------------------------------------------------------

test('1.3 sumArrayOfNumbers', async (subtest) => {
  await subtest.test('sums a list of numbers', () => {
    assert.equal(sumArrayOfNumbers([12, 7, 30, 1, 50]), 100);
  });

  await subtest.test('returns zero for an empty array', () => {
    assert.equal(sumArrayOfNumbers([]), 0);
  });

  await subtest.test('handles negatives and decimals', () => {
    assert.equal(sumArrayOfNumbers([-5, 10, -2.5]), 2.5);
  });

  await subtest.test('rejects a numeric string rather than concatenating', () => {
    // Without the type check this returns the string '33' — a wrong answer
    // that looks like a right one.
    assert.throws(() => sumArrayOfNumbers([1, 2, '3']), TypeError);
  });

  await subtest.test('rejects NaN and Infinity, which poison every total', () => {
    assert.throws(() => sumArrayOfNumbers([1, NaN]), TypeError);
    assert.throws(() => sumArrayOfNumbers([1, Infinity]), TypeError);
  });

  await subtest.test('names NaN and Infinity correctly in the error message', () => {
    // JSON.stringify renders both as `null`, which would tell the reader the
    // value was null and send them looking for the wrong defect.
    assert.throws(() => sumArrayOfNumbers([1, NaN]), /is NaN/);
    assert.throws(() => sumArrayOfNumbers([1, Infinity]), /is Infinity/);
    assert.throws(() => sumArrayOfNumbers([1, undefined]), /is undefined/);
  });

  await subtest.test('rejects a non-array argument', () => {
    assert.throws(() => sumArrayOfNumbers('123'), TypeError);
    assert.throws(() => sumArrayOfNumbers(null), TypeError);
  });

  await subtest.test('names the offending index so the fault is locatable', () => {
    assert.throws(() => sumArrayOfNumbers([1, 2, 'x']), /index 2/);
  });
});

test('1.3 averageArrayOfNumbers', () => {
  assert.equal(averageArrayOfNumbers([10, 20, 30]), 20);
  assert.equal(averageArrayOfNumbers([]), 0, 'an empty average must not be NaN');
});

test('1.3 sumDealAmounts handles the shapes HubSpot actually returns', async (subtest) => {
  await subtest.test('adds string amounts numerically', () => {
    const total = sumDealAmounts([
      { properties: { amount: '15000.00' } },
      { properties: { amount: '2500.50' } },
    ]);
    // Concatenation would yield '15000.002500.50'.
    assert.equal(total, 17500.5);
  });

  await subtest.test('treats an unset amount as zero, which is a valid state', () => {
    const total = sumDealAmounts([
      { properties: { amount: '100' } },
      { properties: { amount: null } },
      { properties: {} },
      { properties: { amount: '' } },
    ]);
    assert.equal(total, 100);
  });

  await subtest.test('rejects an unparseable amount', () => {
    assert.throws(() => sumDealAmounts([{ properties: { amount: 'free' } }]), /index 0/);
  });
});

test('1.3 the module exports a stable object across requires', () => {
  const firstImport = require('../../src/fundamentals/utils_module');
  const secondImport = require('../../src/fundamentals/utils_module');
  assert.equal(firstImport, secondImport);
});

// ---------------------------------------------------------------------------
// 1.4 Streams
// ---------------------------------------------------------------------------

test('1.4 the uppercase Transform uppercases every chunk', async () => {
  const source = Readable.from(['hubspot ', 'crm ', 'integration']);
  const output = await collectStreamToString(source.pipe(createUppercaseTransform()));

  assert.equal(output, 'HUBSPOT CRM INTEGRATION');
});

test('1.4 the uppercase Transform emits each chunk as it arrives', () => {
  // The property that matters is that the transform does not accumulate its
  // whole input before producing anything — that is what makes it a stream
  // rather than a function with extra steps.
  //
  // It is asserted by reading output back after each individual write, before
  // the source has ended. Collecting the stream with `for await` would NOT
  // demonstrate this: a non-object-mode readable side is free to coalesce
  // queued chunks into a single read, so the consumer sees 'ONE TWO THREE'
  // even though `_transform` ran three times. That is a property of the
  // reader, not of the transform.
  const transform = createUppercaseTransform();

  transform.write('one ');
  assert.equal(String(transform.read()), 'ONE ', 'output must be available after the first write');

  transform.write('two ');
  assert.equal(String(transform.read()), 'TWO ');

  transform.write('three');
  assert.equal(String(transform.read()), 'THREE');

  transform.end();
});

test('1.4 the contact name Transform formats and filters records', async () => {
  const destination = createCollectingWritable();

  await streamContactFullNames(
    [
      { properties: { firstname: 'Ada', lastname: 'Lovelace' } },
      { properties: { firstname: '', lastname: '' } },
      { properties: { firstname: 'Grace', lastname: 'Hopper' } },
      { properties: { firstname: 'Cher', lastname: '' } },
    ],
    destination
  );

  const lines = destination.collected().trim().split('\n');

  assert.deepEqual(lines, ['Ada Lovelace', 'Grace Hopper', 'Cher']);
});

test('1.4 streaming consumes an async iterable lazily', async () => {
  // The point of the exercise for this project: a paginated HubSpot fetch is an
  // async iterable, and pulling from it one record at a time is what keeps
  // memory constant on a large portal.
  let recordsProduced = 0;

  async function* simulatePaginatedFetch() {
    for (let index = 1; index <= 6; index += 1) {
      recordsProduced += 1;
      yield { properties: { firstname: `Contact${index}`, lastname: 'Example' } };
    }
  }

  const destination = createCollectingWritable();
  await streamContactFullNames(simulatePaginatedFetch(), destination);

  assert.equal(recordsProduced, 6);
  assert.equal(destination.collected().trim().split('\n').length, 6);
});

test('1.4 an object-mode Transform drops records rather than emitting blanks', async () => {
  const transform = createContactNameTransform();
  Readable.from([{ properties: { firstname: '', lastname: '' } }], { objectMode: true }).pipe(
    transform
  );

  const output = await collectStreamToString(transform);
  assert.equal(output, '', 'a nameless record must produce no output at all');
});
