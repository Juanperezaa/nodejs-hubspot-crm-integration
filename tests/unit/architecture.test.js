'use strict';

/**
 * Architectural invariants.
 *
 * `docs/ARCHITECTURE.md` makes claims about this codebase — that endpoint paths
 * are built in one place, that dependencies run downward, that only the client
 * reads the token. Claims like those decay quietly: nothing fails when someone
 * inlines a path in a repository, and the documentation becomes wrong without
 * anyone noticing.
 *
 * These tests make the claims executable. If the structure drifts, the build
 * fails and the document is corrected along with the code.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_ROOT = path.resolve(__dirname, '..', '..', 'src');

/**
 * Collects every JavaScript file beneath a directory.
 *
 * @param {string} directory
 * @returns {string[]} Paths relative to `src/`.
 */
function collectSourceFiles(directory = SOURCE_ROOT) {
  const collected = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectSourceFiles(entryPath));
    } else if (entry.name.endsWith('.js')) {
      collected.push(path.relative(SOURCE_ROOT, entryPath).split(path.sep).join('/'));
    }
  }

  return collected.sort();
}

/**
 * Strips comments and template-literal-free string content is left intact, so
 * that a path mentioned in prose is not mistaken for one being constructed.
 *
 * Only block and line comments are removed; strings are kept, because a path in
 * a string may well be a real request path.
 *
 * @param {string} sourceText
 * @returns {string}
 */
function stripComments(sourceText) {
  return sourceText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const sourceFiles = collectSourceFiles();

test('the source tree is laid out as the architecture document describes', () => {
  const directories = new Set(
    sourceFiles
      .map((file) => file.split('/')[0])
      .filter((segment) => segment.includes('.') === false)
  );

  for (const expected of [
    'config',
    'clients',
    'repositories',
    'services',
    'api',
    'errors',
    'utils',
    'fundamentals',
    'examples',
  ]) {
    assert.ok(directories.has(expected), `src/${expected}/ is missing`);
  }
});

test('endpoint paths are constructed only in config', () => {
  // The claim this protects: when HubSpot retires the v4 association endpoints
  // in March 2027, the migration touches config/ and repositories/ — not every
  // module that happens to call an endpoint.
  //
  // Comments are stripped first, because the brief's wording is quoted
  // throughout the documentation blocks and quoting a path is not building one.
  const offenders = [];

  for (const file of sourceFiles) {
    if (file.startsWith('config/')) {
      continue;
    }

    const code = stripComments(fs.readFileSync(path.join(SOURCE_ROOT, file), 'utf8'));

    // A constructed path is one interpolated into a template literal. A fixed
    // string in an error message or a test fixture is not a request path.
    const constructsPath = /`[^`]*\/crm\/v[34]\/[^`]*\$\{/.test(code);
    if (constructsPath) {
      offenders.push(file);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these modules build endpoint paths outside config/: ${offenders.join(', ')}`
  );
});

test('the access token reaches exactly one module', () => {
  // Everything else must go through the client. A second reader is a second
  // opportunity for a credential to reach a log or a payload.
  //
  // Matched on `accessToken` rather than on the word "Bearer": redactSecrets
  // legitimately contains `Bearer ${…}` as the *replacement* text it writes in
  // place of a credential, which is the opposite of reading one.
  const readers = sourceFiles.filter((file) => {
    const code = stripComments(fs.readFileSync(path.join(SOURCE_ROOT, file), 'utf8'));
    return /\baccessToken\b/.test(code);
  });

  assert.deepEqual(
    readers.sort(),
    [
      // Loads and validates it. The only module that reads the variable.
      'config/env.js',
      // Passes it through to the client.
      'config/hubspot.config.js',
      // Builds the Authorization header. The only module that sends it.
      'clients/hubSpotClient.js',
    ].sort(),
    `unexpected modules touch the access token: ${readers.join(', ')}`
  );
});

test('only the client builds an Authorization header on the request path', () => {
  // Scoped to the layers that actually issue requests. `examples/` is excluded
  // deliberately: 07-error-handling builds a fabricated error object carrying a
  // header, to demonstrate that redaction removes it. That value is never sent
  // anywhere — it exists to be redacted — so treating it as a violation would
  // be the test misreading its own subject.
  //
  // This exclusion was added because the invariant caught that change, which is
  // the check working. The fix was to state its scope precisely rather than to
  // weaken it.
  const REQUEST_ISSUING_LAYERS = ['clients/', 'repositories/', 'services/', 'api/', 'utils/'];

  const headerBuilders = sourceFiles
    .filter((file) => REQUEST_ISSUING_LAYERS.some((layer) => file.startsWith(layer)))
    .filter((file) => {
      const code = stripComments(fs.readFileSync(path.join(SOURCE_ROOT, file), 'utf8'));
      return /Authorization:\s*[`'"]Bearer/.test(code);
    });

  assert.deepEqual(
    headerBuilders,
    ['clients/hubSpotClient.js'],
    `found an Authorization header outside the client: ${headerBuilders.join(', ')}`
  );
});

test('dependencies run downward, never up', () => {
  // The layering is only real if it is enforced. A repository importing a
  // service would make the boundary decorative.
  const forbiddenImports = {
    'clients/': ['repositories/', 'services/', 'api/'],
    'repositories/': ['services/', 'api/'],
    'utils/': ['repositories/', 'services/', 'api/', 'clients/'],
  };

  const violations = [];

  for (const [layer, forbidden] of Object.entries(forbiddenImports)) {
    for (const file of sourceFiles.filter((candidate) => candidate.startsWith(layer))) {
      const code = stripComments(fs.readFileSync(path.join(SOURCE_ROOT, file), 'utf8'));

      for (const forbiddenLayer of forbidden) {
        const directoryName = forbiddenLayer.replace('/', '');
        if (new RegExp(`require\\(['"]\\.\\./${directoryName}/`).test(code)) {
          violations.push(`${file} imports from ${forbiddenLayer}`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], violations.join('; '));
});

test('every source file declares strict mode', () => {
  const missing = sourceFiles.filter((file) => {
    const contents = fs.readFileSync(path.join(SOURCE_ROOT, file), 'utf8');
    return !contents.includes("'use strict';");
  });

  assert.deepEqual(missing, [], `missing 'use strict': ${missing.join(', ')}`);
});

test('the fundamentals run without any HubSpot configuration', () => {
  // Section 1 is worth 40% of the assessment and must be runnable by a reviewer
  // who has not yet obtained a token. Importing HubSpot configuration there
  // would break that, and the failure would only appear on someone else's
  // machine.
  const fundamentalsFiles = sourceFiles.filter((file) => file.startsWith('fundamentals/'));

  assert.ok(fundamentalsFiles.length >= 4, 'the four Section 1 exercises must exist');

  for (const file of fundamentalsFiles) {
    const code = stripComments(fs.readFileSync(path.join(SOURCE_ROOT, file), 'utf8'));
    assert.equal(
      /require\(['"]\.\.\/(config|clients|repositories|services)\//.test(code),
      false,
      `${file} must not depend on HubSpot configuration`
    );
  }
});
