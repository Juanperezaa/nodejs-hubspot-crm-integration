'use strict';

/**
 * Section 1.4 — Streams.
 *
 * Brief: "Implement in src/utils/streams.js a flow that reads from
 * Readable.from('...'), transforms the data to uppercase, and pipes it to
 * process.stdout."
 *
 * The required flow is `createUppercaseTransformFlow`. The rest of the module
 * exists because streams earn their place in this project for a concrete
 * reason: HubSpot paginates, and a portal with fifty thousand contacts should
 * not be loaded into an array before anything can be done with it.
 * `streamContactFullNames` shows that shape — constant memory regardless of how
 * many records exist — and it is the same shape `getHubSpotContactNames` uses.
 *
 * `pipeline` is used throughout rather than `.pipe()`. `.pipe()` does not
 * forward errors or destroy the source when the destination fails, which leaks
 * file handles and sockets; `pipeline` handles both and is the only correct
 * choice outside a throwaway script.
 *
 * Run directly: `npm run fundamentals:streams`
 */

const { Readable, Transform, pipeline } = require('stream');
const { promisify } = require('util');

const pipelineAsync = promisify(pipeline);

/** Sample text for the required demonstration. */
const SAMPLE_TEXT =
  'HubSpot CRM integration built with Node.js streams, ' + 'transforming data one chunk at a time.';

/**
 * A Transform that uppercases every chunk passing through it.
 *
 * `decodeStrings: false` keeps incoming strings as strings; without it Node
 * converts them to Buffers and `toUpperCase` would not exist on the chunk.
 *
 * The callback is invoked with the error as its first argument rather than
 * throwing, because a throw inside `_transform` escapes the stream's error
 * handling and becomes an uncaught exception.
 *
 * @returns {Transform}
 */
function createUppercaseTransform() {
  return new Transform({
    decodeStrings: false,
    transform(chunk, _encoding, callback) {
      try {
        callback(null, String(chunk).toUpperCase());
      } catch (transformError) {
        callback(transformError);
      }
    },
  });
}

/**
 * A Transform that converts contact records into printable full names.
 *
 * Operates in object mode, so each chunk is a HubSpot contact rather than a
 * string or Buffer. Records with neither first nor last name are skipped by
 * calling back with no value — the stream equivalent of `filter`.
 *
 * @returns {Transform}
 */
function createContactNameTransform() {
  return new Transform({
    objectMode: true,
    transform(contact, _encoding, callback) {
      const firstName = contact?.properties?.firstname ?? '';
      const lastName = contact?.properties?.lastname ?? '';
      const fullName = `${firstName} ${lastName}`.trim();

      // Callback with no second argument emits nothing, dropping the record.
      callback(null, fullName === '' ? undefined : `${fullName}\n`);
    },
  });
}

/**
 * The flow the brief asks for: `Readable.from` → uppercase → `process.stdout`.
 *
 * `{ end: false }` is set on the destination because `process.stdout` is shared
 * for the lifetime of the process. Letting a pipeline close it would leave
 * every later write silently discarded — including this module's own output.
 *
 * @param {string} [inputText] Text to push through the flow.
 * @returns {Promise<void>} Resolves when every chunk has been written.
 */
function createUppercaseTransformFlow(inputText = SAMPLE_TEXT) {
  return pipelineAsync(Readable.from(inputText), createUppercaseTransform(), process.stdout, {
    end: false,
  });
}

/**
 * Streams contact full names to a destination without buffering them.
 *
 * This is the pattern that matters for Section 2. The source is an async
 * iterable — which is exactly what a paginated HubSpot fetch produces — and
 * `Readable.from` consumes it lazily, so memory stays constant whether the
 * portal holds ten contacts or a hundred thousand.
 *
 * @param {AsyncIterable<object>|Iterable<object>} contactSource
 * @param {NodeJS.WritableStream} [destination]
 * @returns {Promise<void>}
 */
function streamContactFullNames(contactSource, destination = process.stdout) {
  return pipelineAsync(Readable.from(contactSource), createContactNameTransform(), destination, {
    end: destination !== process.stdout,
  });
}

/**
 * Collects a stream into a string. Test helper, not production surface.
 *
 * @param {NodeJS.ReadableStream} readableStream
 * @returns {Promise<string>}
 */
async function collectStreamToString(readableStream) {
  const collectedChunks = [];
  for await (const chunk of readableStream) {
    collectedChunks.push(String(chunk));
  }
  return collectedChunks.join('');
}

/**
 * Runs the demonstration.
 *
 * @returns {Promise<void>}
 */
async function demonstrateStreamUsage() {
  process.stdout.write('\nSection 1.4 — Streams\n');
  process.stdout.write('='.repeat(66) + '\n\n');

  process.stdout.write('1. Readable.from -> uppercase Transform -> process.stdout\n');
  process.stdout.write('   input : ' + SAMPLE_TEXT + '\n');
  process.stdout.write('   output: ');
  await createUppercaseTransformFlow();
  process.stdout.write('\n\n');

  process.stdout.write('2. Object-mode streaming, the shape Section 2 uses\n');

  // An async generator stands in for a paginated HubSpot fetch: it yields one
  // record at a time and never holds the full result set in memory.
  async function* simulatePaginatedContacts() {
    const pages = [
      [
        { properties: { firstname: 'Ada', lastname: 'Lovelace' } },
        { properties: { firstname: 'Alan', lastname: 'Turing' } },
      ],
      [
        { properties: { firstname: 'Grace', lastname: 'Hopper' } },
        { properties: { firstname: '', lastname: '' } },
        { properties: { firstname: 'Edsger', lastname: 'Dijkstra' } },
      ],
    ];
    for (const page of pages) {
      yield* page;
    }
  }

  process.stdout.write('   names streamed one record at a time:\n');
  await streamContactFullNames(simulatePaginatedContacts());

  process.stdout.write(
    '\n   The nameless record was dropped by the transform, and memory\n' +
      '   stayed constant: no page was ever accumulated into an array.\n' +
      '   This is how getHubSpotContactNames handles a large portal.\n\n'
  );
}

if (require.main === module) {
  demonstrateStreamUsage().catch((error) => {
    process.stderr.write(`Stream demonstration failed: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  createUppercaseTransform,
  createContactNameTransform,
  createUppercaseTransformFlow,
  streamContactFullNames,
  collectStreamToString,
  demonstrateStreamUsage,
  SAMPLE_TEXT,
};
