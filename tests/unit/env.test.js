'use strict';

/**
 * Configuration validation.
 *
 * The credential-shape checks carry real weight: supplying the private app's
 * Client Secret instead of its access token is an easy mistake — the two sit
 * beside each other in the HubSpot interface — and without an explicit check it
 * surfaces as a 401, which reads identically to a missing scope and sends the
 * reader looking in the wrong place.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getEnvironment,
  resetEnvironmentCache,
  validateAccessToken,
} = require('../../src/config/env');
const { InvalidConfigurationError } = require('../../src/errors/InvalidConfigurationError');

/**
 * Fictitious credentials, assembled at runtime rather than written as literals.
 *
 * GitHub's push protection scans for the HubSpot token pattern and rejects any
 * push containing one, real or not. Building these from parts keeps the tests
 * exercising the exact shapes that matter while leaving no credential-shaped
 * string in the source for a scanner — or a reader — to mistake for real.
 */
const buildToken = (region) =>
  ['pat', region, '11111111', '2222', '3333', '4444', '555555555555'].join('-');

const VALID_TOKEN = buildToken('na1');
const EUROPEAN_TOKEN = buildToken('eu1');
const CLIENT_SECRET_SHAPED = ['8faf6678', '4fbc', '4be6', '9394', '98332ede3887'].join('-');

/**
 * Runs a function with a temporary environment, restoring the previous values
 * afterwards so tests cannot leak configuration into one another.
 *
 * @param {Record<string, string|undefined>} overrides
 * @param {() => void} body
 */
function withEnvironment(overrides, body) {
  const previousValues = {};
  for (const [key, value] of Object.entries(overrides)) {
    previousValues[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvironmentCache();

  try {
    body();
  } finally {
    for (const [key, value] of Object.entries(previousValues)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetEnvironmentCache();
  }
}

test('accepts a well-formed private app token', () => {
  assert.equal(validateAccessToken(VALID_TOKEN), VALID_TOKEN);
  assert.equal(validateAccessToken(EUROPEAN_TOKEN), EUROPEAN_TOKEN);
});

test('rejects a client secret with an explanation of the difference', () => {
  assert.throws(
    () => validateAccessToken(CLIENT_SECRET_SHAPED),
    (error) => {
      assert.ok(error instanceof InvalidConfigurationError);
      assert.match(error.message, /Client Secret/);
      // The guidance must say where the right value lives, not merely that the
      // supplied one is wrong.
      assert.match(error.guidance, /Show token/);
      return true;
    }
  );
});

test('rejects an unrecognisable token and states the expected form', () => {
  assert.throws(
    () => validateAccessToken('not-a-token'),
    (error) => {
      assert.ok(error instanceof InvalidConfigurationError);
      assert.match(error.guidance, /pat-<region>-<uuid>/);
      return true;
    }
  );
});

test('reports the variable name when the token is absent', () => {
  withEnvironment({ HUBSPOT_ACCESS_TOKEN: undefined }, () => {
    assert.throws(
      () => getEnvironment({ forceReload: true }),
      (error) => {
        assert.ok(error instanceof InvalidConfigurationError);
        assert.equal(error.variableName, 'HUBSPOT_ACCESS_TOKEN');
        return true;
      }
    );
  });
});

test('loads without a token when the caller does not require one', () => {
  withEnvironment({ HUBSPOT_ACCESS_TOKEN: undefined }, () => {
    const environment = getEnvironment({ requireAccessToken: false, forceReload: true });
    assert.equal(environment.accessToken, '');
    // Defaults must still be present so the fundamentals exercises can run.
    assert.equal(environment.baseUrl, 'https://api.hubapi.com');
  });
});

test('applies documented defaults when optional variables are absent', () => {
  withEnvironment(
    {
      HUBSPOT_ACCESS_TOKEN: VALID_TOKEN,
      HUBSPOT_BASE_URL: undefined,
      HUBSPOT_OBJECTS_API_VERSION: undefined,
      HUBSPOT_ASSOCIATIONS_API_VERSION: undefined,
      HUBSPOT_REQUEST_TIMEOUT_MS: undefined,
      HUBSPOT_MAX_RETRY_ATTEMPTS: undefined,
    },
    () => {
      const environment = getEnvironment({ forceReload: true });

      assert.equal(environment.baseUrl, 'https://api.hubapi.com');
      assert.equal(environment.objectsApiVersion, 'v3');
      assert.equal(environment.associationsApiVersion, 'v4');
      assert.equal(environment.requestTimeoutMs, 10000);
      assert.equal(environment.maxRetryAttempts, 5);
    }
  );
});

test('rejects a non-numeric timeout rather than silently disabling timeouts', () => {
  withEnvironment({ HUBSPOT_ACCESS_TOKEN: VALID_TOKEN, HUBSPOT_REQUEST_TIMEOUT_MS: 'soon' }, () => {
    assert.throws(
      () => getEnvironment({ forceReload: true }),
      (error) => {
        assert.ok(error instanceof InvalidConfigurationError);
        assert.match(error.message, /positive integer/);
        return true;
      }
    );
  });
});

test('clamps the page size to the maximum HubSpot accepts', () => {
  withEnvironment({ HUBSPOT_ACCESS_TOKEN: VALID_TOKEN, HUBSPOT_PAGE_SIZE: '500' }, () => {
    // HubSpot rejects a limit above 100 on CRM list endpoints, so an
    // over-large configured value is corrected rather than passed through.
    assert.equal(getEnvironment({ forceReload: true }).pageSize, 100);
  });
});

test('the write switch fails closed on anything ambiguous', () => {
  // Values that only suggest assent must not grant write access to a real
  // portal. An accidental HUBSPOT_ALLOW_WRITE=1 should be inert.
  const valuesThatMustNotEnableWrites = ['yes', '1', 'on', 'y', '', 'false', 'truthy'];

  for (const value of valuesThatMustNotEnableWrites) {
    withEnvironment({ HUBSPOT_ACCESS_TOKEN: VALID_TOKEN, HUBSPOT_ALLOW_WRITE: value }, () => {
      assert.equal(
        getEnvironment({ forceReload: true }).allowWriteOperations,
        false,
        `"${value}" must not enable writes against a real portal`
      );
    });
  }

  // The word itself is accepted in any casing, because rejecting `TRUE` would
  // be a usability trap rather than a safety property.
  for (const value of ['true', 'TRUE', 'True', ' true ']) {
    withEnvironment({ HUBSPOT_ACCESS_TOKEN: VALID_TOKEN, HUBSPOT_ALLOW_WRITE: value }, () => {
      assert.equal(
        getEnvironment({ forceReload: true }).allowWriteOperations,
        true,
        `"${value}" should enable writes`
      );
    });
  }
});

test('returns a frozen object so configuration cannot drift at runtime', () => {
  withEnvironment({ HUBSPOT_ACCESS_TOKEN: VALID_TOKEN }, () => {
    const environment = getEnvironment({ forceReload: true });
    assert.equal(Object.isFrozen(environment), true);
  });
});
