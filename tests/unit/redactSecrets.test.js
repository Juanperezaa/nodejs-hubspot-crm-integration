'use strict';

/**
 * The brief requires errors to be logged "without exposing tokens or sensitive
 * data". These tests are the proof of that claim, so they cover the realistic
 * shapes a credential arrives in — not just the obvious one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { redactSecrets, REDACTION_PLACEHOLDER } = require('../../src/utils/redactSecrets');

// A syntactically valid but entirely fictitious token, used only in
// assertions. It is assembled at runtime rather than written as a literal:
// GitHub's push protection scans for the HubSpot token pattern and rejects a
// push containing one, regardless of whether the value is real. Building it
// from parts keeps the test honest about the shape it exercises while leaving
// no credential-shaped string in the source.
const SAMPLE_TOKEN = ['pat', 'na1', '11111111', '2222', '3333', '4444', '555555555555'].join('-');

test('redacts tokens embedded in free text', () => {
  const redacted = redactSecrets(`request failed with token ${SAMPLE_TOKEN} attached`);

  assert.equal(redacted.includes(SAMPLE_TOKEN), false);
  assert.match(redacted, /pat-\[REDACTED\]/);
});

test('redacts an Authorization header by key regardless of its value', () => {
  const redacted = redactSecrets({
    headers: { Authorization: `Bearer ${SAMPLE_TOKEN}`, 'Content-Type': 'application/json' },
  });

  assert.equal(redacted.headers.Authorization, REDACTION_PLACEHOLDER);
  // Non-secret headers must survive, or the logs lose their diagnostic value.
  assert.equal(redacted.headers['Content-Type'], 'application/json');
});

test('matches secret key names case-insensitively', () => {
  const redacted = redactSecrets({
    authorization: 'x',
    AUTHORIZATION: 'x',
    tokenKey: 'x',
    clientSecret: 'x',
    hapikey: 'x',
  });

  for (const value of Object.values(redacted)) {
    assert.equal(value, REDACTION_PLACEHOLDER);
  }
});

test('redacts a token nested deep inside a request configuration', () => {
  const axiosShapedError = {
    message: 'Request failed with status code 401',
    config: {
      url: '/crm/v3/objects/contacts',
      headers: { Authorization: `Bearer ${SAMPLE_TOKEN}` },
    },
    response: {
      status: 401,
      data: { message: 'Authentication credentials not found' },
    },
  };

  const serialised = JSON.stringify(redactSecrets(axiosShapedError));

  assert.equal(serialised.includes(SAMPLE_TOKEN), false);
  // The diagnostic content must remain readable.
  assert.match(serialised, /crm\/v3\/objects\/contacts/);
  assert.match(serialised, /401/);
});

test('terminates on the self-referential objects axios produces', () => {
  const request = { url: '/crm/v3/objects/deals' };
  const response = { status: 500, request };
  request.response = response;

  const redacted = redactSecrets({ request, response });

  assert.ok(redacted, 'redaction must terminate on a cyclic graph');
  assert.equal(JSON.stringify(redacted).includes('[Circular]'), true);
});

test('preserves Error name and message while redacting the message body', () => {
  const error = new Error(`auth failed for ${SAMPLE_TOKEN}`);
  error.statusCode = 401;

  const redacted = redactSecrets(error);

  assert.equal(redacted.name, 'Error');
  assert.equal(redacted.message.includes(SAMPLE_TOKEN), false);
  assert.equal(redacted.statusCode, 401);
});

test('redacts the legacy hapikey query parameter but keeps the path', () => {
  const redacted = redactSecrets('GET /crm/v3/objects/contacts?hapikey=abcd1234&limit=100');

  assert.equal(redacted.includes('abcd1234'), false);
  assert.match(redacted, /hapikey=\[REDACTED\]/);
  assert.match(redacted, /limit=100/);
});

test('redacts a bare UUID, which is the shape of a client secret', () => {
  const redacted = redactSecrets('client secret 8faf6678-4fbc-4be6-9394-98332ede3887 supplied');

  assert.equal(redacted.includes('8faf6678'), false);
});

test('leaves non-secret values untouched', () => {
  const input = {
    recordId: '12345678901',
    properties: { firstname: 'Ada', lastname: 'Lovelace', amount: '1500.00' },
    counts: [1, 2, 3],
    isActive: true,
    missing: null,
  };

  assert.deepEqual(redactSecrets(input), input);
});

test('does not mutate its input', () => {
  const original = { headers: { Authorization: `Bearer ${SAMPLE_TOKEN}` } };

  redactSecrets(original);

  assert.equal(original.headers.Authorization, `Bearer ${SAMPLE_TOKEN}`);
});
