'use strict';

/**
 * Environment loading and validation.
 *
 * Validation happens **lazily**, on first call, not at require time. Two
 * reasons:
 *
 *   1. `npm run verify:requirements` loads every module in the project to
 *      inspect its exports. If importing the configuration threw whenever a
 *      token was absent, the requirement matrix could not run in CI, where no
 *      credential exists — and CI is exactly where that matrix matters most.
 *   2. The fundamentals exercises (Section 1) must run with no HubSpot
 *      configuration at all.
 *
 * Once validated, the result is frozen and cached: configuration is read once
 * per process and cannot drift underneath a running operation.
 */

const path = require('path');
const dotenv = require('dotenv');

const { InvalidConfigurationError } = require('../errors/InvalidConfigurationError');

/** Cached result of a successful load. */
let cachedEnvironment = null;

/** Guards against loading the .env file more than once per process. */
let dotenvHasBeenLoaded = false;

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** A HubSpot private app token: `pat-`, a region code, then a UUID. */
const ACCESS_TOKEN_PATTERN =
  /^pat-[a-z]{2}\d?-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID with no `pat-` prefix — almost certainly the client secret. */
const BARE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads `.env` into `process.env` exactly once. Values already present in the
 * environment win, which is what allows CI and shell overrides to take
 * precedence over a developer's local file.
 *
 * @returns {void}
 */
function loadDotenvOnce() {
  if (dotenvHasBeenLoaded) {
    return;
  }
  dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
  dotenvHasBeenLoaded = true;
}

/**
 * Reads a required string.
 *
 * @param {string} variableName
 * @param {string} guidance What the reader should do about it.
 * @returns {string}
 */
function readRequiredString(variableName, guidance) {
  const rawValue = process.env[variableName];
  if (rawValue === undefined || rawValue.trim() === '') {
    throw new InvalidConfigurationError(`Missing required environment variable ${variableName}.`, {
      variableName,
      guidance,
    });
  }
  return rawValue.trim();
}

/**
 * Reads an optional string, applying a fallback when absent or blank.
 *
 * @param {string} variableName
 * @param {string} fallbackValue
 * @returns {string}
 */
function readOptionalString(variableName, fallbackValue) {
  const rawValue = process.env[variableName];
  return rawValue === undefined || rawValue.trim() === '' ? fallbackValue : rawValue.trim();
}

/**
 * Reads a positive integer, rejecting values that would silently misconfigure
 * the retry policy — a timeout of `NaN` disables timeouts entirely, which is
 * the kind of defect that only shows up under load.
 *
 * @param {string} variableName
 * @param {number} fallbackValue
 * @returns {number}
 */
function readPositiveInteger(variableName, fallbackValue) {
  const rawValue = process.env[variableName];
  if (rawValue === undefined || rawValue.trim() === '') {
    return fallbackValue;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new InvalidConfigurationError(
      `Environment variable ${variableName} must be a positive integer, received "${rawValue}".`,
      { variableName, guidance: `Remove it to use the default of ${fallbackValue}.` }
    );
  }
  return parsedValue;
}

/**
 * Reads a boolean flag.
 *
 * Only the word `true`, in any casing, enables a flag. Values that merely
 * suggest assent — `1`, `yes`, `on` — are rejected, so the flag fails closed on
 * anything ambiguous. That matters most for `HUBSPOT_ALLOW_WRITE`, the switch
 * that permits the integration suite to create and delete records in a real
 * portal: an accidental `HUBSPOT_ALLOW_WRITE=1` must not grant write access.
 *
 * @param {string} variableName
 * @returns {boolean}
 */
function readStrictBoolean(variableName) {
  return (
    String(process.env[variableName] || '')
      .trim()
      .toLowerCase() === 'true'
  );
}

/**
 * Validates the access token's shape before it is ever sent.
 *
 * A malformed token otherwise surfaces as a 401 from HubSpot, which is
 * indistinguishable from a missing scope and sends the reader looking in the
 * wrong place. The most likely mistake — supplying the client secret instead
 * of the access token — is detected explicitly, because the two sit next to
 * each other in the HubSpot interface.
 *
 * @param {string} accessToken
 * @returns {string} The token, unchanged, when valid.
 */
function validateAccessToken(accessToken) {
  if (ACCESS_TOKEN_PATTERN.test(accessToken)) {
    return accessToken;
  }

  if (BARE_UUID_PATTERN.test(accessToken)) {
    throw new InvalidConfigurationError(
      'HUBSPOT_ACCESS_TOKEN looks like the private app Client Secret, not its access token.',
      {
        variableName: 'HUBSPOT_ACCESS_TOKEN',
        guidance:
          'The Client Secret is a bare UUID used only to validate inbound webhook signatures ' +
          'and cannot authenticate REST calls. The access token begins with "pat-" and is found ' +
          'in the same Auth tab under "Access token" — click "Show token", then "Copy".',
      }
    );
  }

  throw new InvalidConfigurationError(
    'HUBSPOT_ACCESS_TOKEN is not a recognisable HubSpot private app token.',
    {
      variableName: 'HUBSPOT_ACCESS_TOKEN',
      guidance:
        'Expected the form pat-<region>-<uuid>, for example pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. ' +
        'Copy it from HubSpot > Settings > Integrations > Private Apps > your app > Auth.',
    }
  );
}

/**
 * Loads, validates, freezes and caches the environment.
 *
 * @param {{requireAccessToken?: boolean, forceReload?: boolean}} [options]
 *   `requireAccessToken` is false for commands that legitimately run without
 *   credentials, such as the fundamentals exercises. `forceReload` exists for
 *   tests and is not used by application code.
 * @returns {Readonly<object>}
 */
function getEnvironment(options = {}) {
  const { requireAccessToken = true, forceReload = false } = options;

  if (cachedEnvironment && !forceReload) {
    return cachedEnvironment;
  }

  loadDotenvOnce();

  const accessToken = requireAccessToken
    ? validateAccessToken(
        readRequiredString(
          'HUBSPOT_ACCESS_TOKEN',
          'Copy .env.example to .env and paste your private app access token.'
        )
      )
    : readOptionalString('HUBSPOT_ACCESS_TOKEN', '');

  const environment = Object.freeze({
    accessToken,
    portalId: readOptionalString('HUBSPOT_PORTAL_ID', ''),

    baseUrl: readOptionalString('HUBSPOT_BASE_URL', 'https://api.hubapi.com'),
    objectsApiVersion: readOptionalString('HUBSPOT_OBJECTS_API_VERSION', 'v3'),
    associationsApiVersion: readOptionalString('HUBSPOT_ASSOCIATIONS_API_VERSION', 'v4'),

    defaultPipelineId: readOptionalString('HUBSPOT_PIPELINE_ID', 'default'),
    defaultStageId: readOptionalString('HUBSPOT_STAGE_ID', 'appointmentscheduled'),

    requestTimeoutMs: readPositiveInteger('HUBSPOT_REQUEST_TIMEOUT_MS', 10000),
    maxRetryAttempts: readPositiveInteger('HUBSPOT_MAX_RETRY_ATTEMPTS', 5),
    retryBaseDelayMs: readPositiveInteger('HUBSPOT_RETRY_BASE_DELAY_MS', 500),
    retryMaxDelayMs: readPositiveInteger('HUBSPOT_RETRY_MAX_DELAY_MS', 30000),

    // HubSpot caps CRM list endpoints at 100 records per page. Requesting more
    // is rejected, so the configured value is clamped rather than trusted.
    pageSize: Math.min(readPositiveInteger('HUBSPOT_PAGE_SIZE', 100), 100),

    allowWriteOperations: readStrictBoolean('HUBSPOT_ALLOW_WRITE'),
    logLevel: readOptionalString('LOG_LEVEL', 'info'),
  });

  cachedEnvironment = environment;
  return environment;
}

/**
 * Clears the cached environment. Test-only; application code reads
 * configuration once.
 *
 * The dotenv flag is deliberately **not** reset. `.env` is read once per
 * process, and re-reading it would repopulate variables a caller had just
 * removed from `process.env` — which silently defeats any attempt to test
 * behaviour in their absence. That defect was real: with a populated `.env` on
 * disk, a test deleting `HUBSPOT_ACCESS_TOKEN` got it back, and the resulting
 * assertion failure printed the live token into the test output.
 *
 * `reloadDotenvFile` exists for the rare test that genuinely needs the file
 * read again, and is explicit about it.
 *
 * @returns {void}
 */
function resetEnvironmentCache() {
  cachedEnvironment = null;
}

/**
 * Forces `.env` to be read again on the next load. Test-only.
 *
 * @returns {void}
 */
function reloadDotenvFile() {
  dotenvHasBeenLoaded = false;
}

module.exports = {
  getEnvironment,
  resetEnvironmentCache,
  reloadDotenvFile,
  validateAccessToken,
  ACCESS_TOKEN_PATTERN,
  BARE_UUID_PATTERN,
};
