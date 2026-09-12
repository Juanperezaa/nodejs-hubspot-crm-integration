'use strict';

/**
 * Guards the repository's own invariants.
 *
 * This project is published publicly and authenticates against a live CRM, so
 * the highest-consequence defect is not a broken function — it is a credential
 * reaching the remote. These tests make that failure mode loud and local,
 * before CI or a reviewer ever sees the branch.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const readProjectFile = (relativePath) =>
  fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');

test('the environment template exists and carries no real credential', async (subtest) => {
  const template = readProjectFile('.env.example');

  await subtest.test('declares every variable the configuration layer reads', () => {
    const requiredVariables = [
      'HUBSPOT_ACCESS_TOKEN',
      'HUBSPOT_PIPELINE_ID',
      'HUBSPOT_STAGE_ID',
      'HUBSPOT_BASE_URL',
      'HUBSPOT_REQUEST_TIMEOUT_MS',
      'HUBSPOT_MAX_RETRY_ATTEMPTS',
      'HUBSPOT_ALLOW_WRITE',
    ];
    for (const variableName of requiredVariables) {
      assert.match(
        template,
        new RegExp(`^${variableName}=`, 'm'),
        `.env.example is missing ${variableName}`
      );
    }
  });

  await subtest.test('contains no token that could authenticate against a portal', () => {
    // A real token is `pat-` + region + `-` + a UUID whose first group is eight
    // hex characters. The placeholder deliberately uses zeroes and `naX`, so a
    // genuine value is distinguishable from the example.
    const realTokenPattern = /pat-(na|eu)\d-(?![0]{8})[0-9a-f]{8}-[0-9a-f]{4}/i;
    assert.equal(
      realTokenPattern.test(template),
      false,
      '.env.example appears to contain a real access token'
    );
  });
});

test('git ignores every environment file except the template', () => {
  const ignoreRules = readProjectFile('.gitignore');

  assert.match(ignoreRules, /^\.env$/m, '.gitignore must ignore .env');
  assert.match(ignoreRules, /^\.env\.\*$/m, '.gitignore must ignore .env.* variants');
  assert.match(
    ignoreRules,
    /^!\.env\.example$/m,
    '.gitignore must re-include .env.example so the template stays tracked'
  );
});

test('the requirements manifest covers every artefact named by the brief', async (subtest) => {
  const { REQUIRED_ARTEFACTS } = require('../../scripts/requirements.manifest');

  await subtest.test('the brief names eighteen artefacts plus the fundamentals exercises', () => {
    // 18 named artefacts (R01–R18, with R15 split into two repositories),
    // 5 fundamentals files (R19–R22, with R21 split), and 3 repositories
    // required by the mandatory endpoint list (R23a–c).
    assert.equal(REQUIRED_ARTEFACTS.length, 27);
  });

  await subtest.test('every entry has a unique identifier', () => {
    const identifiers = REQUIRED_ARTEFACTS.map((artefact) => artefact.id);
    assert.equal(new Set(identifiers).size, identifiers.length, 'duplicate requirement id');
  });

  await subtest.test('every entry declares a supported kind', () => {
    const supportedKinds = new Set(['function', 'module', 'file']);
    for (const artefact of REQUIRED_ARTEFACTS) {
      assert.ok(
        supportedKinds.has(artefact.kind),
        `${artefact.id} declares unsupported kind "${artefact.kind}"`
      );
    }
  });

  await subtest.test('function entries name the export they expect', () => {
    for (const artefact of REQUIRED_ARTEFACTS.filter((entry) => entry.kind === 'function')) {
      assert.ok(artefact.exportName, `${artefact.id} is a function entry without an exportName`);
    }
  });

  await subtest.test('every entry points inside src/', () => {
    for (const artefact of REQUIRED_ARTEFACTS) {
      assert.match(
        artefact.modulePath,
        /^src\//,
        `${artefact.id} points outside src/: ${artefact.modulePath}`
      );
    }
  });
});
