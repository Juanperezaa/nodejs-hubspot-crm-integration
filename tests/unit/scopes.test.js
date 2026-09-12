'use strict';

/**
 * Scope coverage.
 *
 * The brief requires the submission to state how the private app was
 * configured. These tests make that statement checkable rather than asserted:
 * every endpoint the project calls is listed with the scopes that authorise it,
 * and the claim "the requested scopes are sufficient" is computed from that
 * table instead of being taken on trust.
 *
 * The modelling detail that matters is `anyOf`. HubSpot's reference pages say
 * an endpoint "requires **one of** the following scopes", so an absent scope is
 * only a problem when it blocks an operation. Treating the requirement as a
 * flat list would report false failures.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REQUESTED_SCOPES,
  DELIBERATELY_OMITTED_SCOPES,
  ENDPOINT_SCOPE_REQUIREMENTS,
  auditScopeCoverage,
} = require('../../src/config/scopes');

const OBJECT_SCOPES_ONLY = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
];

test('the requested scopes cover every endpoint the project calls', () => {
  const coverage = auditScopeCoverage(REQUESTED_SCOPES);

  assert.equal(
    coverage.isFullyCovered,
    true,
    `blocked: ${coverage.blocked.map((entry) => entry.path).join(', ')}`
  );
  assert.equal(coverage.blocked.length, 0);
  assert.equal(coverage.satisfied.length, ENDPOINT_SCOPE_REQUIREMENTS.length);
});

test('the four object scopes alone are already sufficient', () => {
  // This is the evidence for a claim made in docs/HUBSPOT_SETUP.md: the two
  // crm.schemas.*.read scopes are requested as defence in depth, not because
  // anything breaks without them. The Properties and Pipelines endpoints each
  // accept an object read scope as an alternative.
  const coverage = auditScopeCoverage(OBJECT_SCOPES_ONLY);

  assert.equal(coverage.isFullyCovered, true);
});

test('a read-only token blocks exactly the write operations', () => {
  const coverage = auditScopeCoverage(['crm.objects.contacts.read', 'crm.objects.deals.read']);

  assert.equal(coverage.isFullyCovered, false);

  // Every blocked endpoint must be a mutation; blocking a read would mean the
  // table has mislabelled something.
  for (const blocked of coverage.blocked) {
    assert.ok(
      ['POST', 'PATCH', 'DELETE', 'PUT'].includes(blocked.method),
      `${blocked.method} ${blocked.path} should not be blocked by a read-only token`
    );
  }

  assert.deepEqual(coverage.missingScopes, [
    'crm.objects.contacts.write',
    'crm.objects.deals.write',
  ]);
});

test('an empty token permits only the endpoints that need no scope', () => {
  const coverage = auditScopeCoverage([]);

  // Token introspection authenticates with the very token it reports on, so it
  // is the one endpoint reachable with no scopes at all.
  assert.equal(coverage.satisfied.length, 1);
  assert.equal(coverage.satisfied[0].path, '/oauth/v2/private-apps/get/access-token-info');
});

test('associations require no scope of their own', () => {
  const associationEndpoints = ENDPOINT_SCOPE_REQUIREMENTS.filter((entry) =>
    entry.path.includes('/associations/')
  );

  assert.ok(associationEndpoints.length >= 2, 'association endpoints must be catalogued');

  for (const endpoint of associationEndpoints) {
    // The v4 association endpoints are authorised by the object scopes of both
    // objects involved. A scope containing "association" appearing here would
    // mean the documentation was misread.
    for (const scopeName of endpoint.anyOf) {
      assert.ok(
        !scopeName.includes('association'),
        `${endpoint.path} lists ${scopeName}; no dedicated association scope exists`
      );
    }
    assert.ok(
      endpoint.anyOf.some((scopeName) => scopeName.startsWith('crm.objects.')),
      `${endpoint.path} must be authorised by an object scope`
    );
  }
});

test('the omitted-scope record explains the deal synchronisation design', () => {
  // Recorded because the alternative design -- creating a custom correlation
  // property -- would have required a seventh scope. Keeping the reasoning
  // visible makes reintroducing that approach a deliberate decision with a
  // stated cost rather than an accidental one.
  assert.ok(DELIBERATELY_OMITTED_SCOPES['crm.schemas.deals.write']);
  assert.match(DELIBERATELY_OMITTED_SCOPES['crm.schemas.deals.write'], /dealname/);

  // Nothing may be both requested and recorded as omitted.
  for (const scopeName of Object.keys(DELIBERATELY_OMITTED_SCOPES)) {
    assert.ok(
      !REQUESTED_SCOPES.includes(scopeName),
      `${scopeName} is both requested and recorded as omitted`
    );
  }
});

test('the endpoint table is internally consistent', async (subtest) => {
  await subtest.test('every entry names an operation, method, path and consumers', () => {
    for (const entry of ENDPOINT_SCOPE_REQUIREMENTS) {
      assert.ok(entry.operation, 'missing operation');
      assert.match(entry.method, /^(GET|POST|PATCH|PUT|DELETE)$/, `bad method on ${entry.path}`);
      assert.match(entry.path, /^\//, `path must be relative: ${entry.path}`);
      assert.ok(Array.isArray(entry.anyOf), `anyOf must be an array on ${entry.path}`);
      assert.ok(entry.usedBy.length > 0, `${entry.path} is catalogued but nothing uses it`);
    }
  });

  await subtest.test('no endpoint is listed twice', () => {
    const signatures = ENDPOINT_SCOPE_REQUIREMENTS.map((entry) => `${entry.method} ${entry.path}`);
    assert.equal(new Set(signatures).size, signatures.length, 'duplicate endpoint entry');
  });

  await subtest.test('every scope named is one this project requests', () => {
    // Catches the drift where an endpoint is added requiring a scope the setup
    // documentation never tells the operator to grant.
    for (const entry of ENDPOINT_SCOPE_REQUIREMENTS) {
      for (const scopeName of entry.anyOf) {
        assert.ok(
          REQUESTED_SCOPES.includes(scopeName),
          `${entry.path} accepts ${scopeName}, which is not in REQUESTED_SCOPES`
        );
      }
    }
  });

  await subtest.test('every requested scope is actually used by some endpoint', () => {
    // The converse drift: a scope requested but needed by nothing is an
    // unnecessary permission on a real portal.
    const scopesInUse = new Set(ENDPOINT_SCOPE_REQUIREMENTS.flatMap((entry) => entry.anyOf));
    for (const scopeName of REQUESTED_SCOPES) {
      assert.ok(scopesInUse.has(scopeName), `${scopeName} is requested but no endpoint accepts it`);
    }
  });
});
