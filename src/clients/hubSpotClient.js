'use strict';

/**
 * `hubSpotClient` — the central HTTP client.
 *
 * Required by the brief: "central HTTP client (axios/@hubspot/api-client),
 * configurable via config and env vars".
 *
 * This is the only module in the project that knows how to speak HTTP to
 * HubSpot. It owns authentication, timeouts, the retry policy and rate-limit
 * observation. It knows nothing about contacts, deals or associations — ask it
 * for a path and it will fetch it.
 *
 * Every request goes through `handleHubSpotErrors`, so retry and error
 * normalisation are properties of the system rather than of whoever remembered
 * to write a loop.
 *
 * The axios instance is created lazily, on first use, for the same reason the
 * configuration validates lazily: `npm run verify:requirements` loads every
 * module in the project, and constructing a client at import time would require
 * a token in CI, where none exists.
 */

const axios = require('axios');

const { getHubSpotConfig } = require('../config/hubspot.config');
const { handleHubSpotErrors } = require('../utils/handleHubSpotErrors');
const { logger } = require('../utils/logger');

/** Cached axios instance and the configuration it was built from. */
let cachedHttpClient = null;
let cachedConfig = null;

/** Most recently observed rate-limit headers, for diagnostics. */
let lastObservedRateLimit = null;

/**
 * Records the rate-limit headers HubSpot returns on every response.
 *
 * Kept because a 429 is much easier to understand in hindsight when the
 * remaining budget just before it is known. Purely observational — the client
 * does not throttle pre-emptively, since the limit is shared across every
 * process using the same app and a local counter would be wrong.
 *
 * @param {object} headers
 * @returns {void}
 */
function recordRateLimitHeaders(headers = {}) {
  const remaining = headers['x-hubspot-ratelimit-remaining'];
  if (remaining === undefined) {
    // Search endpoints omit these headers entirely.
    return;
  }

  lastObservedRateLimit = {
    remaining: Number(remaining),
    max: Number(headers['x-hubspot-ratelimit-max']),
    intervalMilliseconds: Number(headers['x-hubspot-ratelimit-interval-milliseconds']),
    dailyRemaining: headers['x-hubspot-ratelimit-daily-remaining']
      ? Number(headers['x-hubspot-ratelimit-daily-remaining'])
      : undefined,
    // HubSpot also enforces a per-second ceiling and reports it in headers its
    // published limits table does not mention. Observed against a live portal:
    // `x-hubspot-ratelimit-secondly: 10` alongside the documented
    // hundred-per-ten-seconds burst. Recorded because it binds first under
    // concurrency — ten parallel requests exhaust it while the ten-second
    // window still shows ninety remaining.
    secondlyMax: headers['x-hubspot-ratelimit-secondly']
      ? Number(headers['x-hubspot-ratelimit-secondly'])
      : undefined,
    secondlyRemaining: headers['x-hubspot-ratelimit-secondly-remaining']
      ? Number(headers['x-hubspot-ratelimit-secondly-remaining'])
      : undefined,
    observedAt: new Date().toISOString(),
  };

  // Warn while there is still time to act, rather than after the 429.
  if (Number.isFinite(lastObservedRateLimit.remaining) && lastObservedRateLimit.remaining <= 5) {
    logger.warn('Approaching the HubSpot burst rate limit', lastObservedRateLimit);
  }
}

/**
 * Builds the axios instance.
 *
 * @param {object} config
 * @returns {import('axios').AxiosInstance}
 */
function createHttpClient(config) {
  const instance = axios.create({
    baseURL: config.baseUrl,
    timeout: config.requestTimeoutMs,
    headers: {
      // The only place the token is ever attached. Nothing else reads it, and
      // the redacting logger masks this header if an error carrying it is logged.
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'nodejs-hubspot-crm-integration/1.0',
    },
    // Objects are serialised as JSON by axios; this only affects query strings.
    paramsSerializer: { indexes: null },
  });

  instance.interceptors.response.use(
    (response) => {
      recordRateLimitHeaders(response.headers);
      logger.debug('HubSpot response', {
        method: response.config.method?.toUpperCase(),
        path: response.config.url,
        status: response.status,
      });
      return response;
    },
    (error) => {
      // Headers are still worth recording on a failure — especially a 429,
      // where they say how long the window has left.
      if (error.response) {
        recordRateLimitHeaders(error.response.headers);
      }
      return Promise.reject(error);
    }
  );

  return instance;
}

/**
 * Returns the shared axios instance, creating it on first use.
 *
 * @param {{forceRecreate?: boolean}} [options] `forceRecreate` exists for tests.
 * @returns {import('axios').AxiosInstance}
 */
function getHttpClient(options = {}) {
  if (cachedHttpClient && !options.forceRecreate) {
    return cachedHttpClient;
  }

  cachedConfig = getHubSpotConfig();
  cachedHttpClient = createHttpClient(cachedConfig);
  return cachedHttpClient;
}

/**
 * Issues a request, with retry and normalised errors.
 *
 * @param {object} request
 * @param {string} request.method HTTP method.
 * @param {string} request.path Path relative to the base URL.
 * @param {object} [request.query] Query parameters.
 * @param {object} [request.body] Request body.
 * @param {string} [request.operationName] Used in log lines.
 * @param {object} [request.overrides] Per-call axios overrides, such as a longer timeout.
 * @returns {Promise<object>} The parsed response body.
 * @throws {HubSpotApiError}
 */
async function request({ method, path, query, body, operationName, overrides = {} }) {
  const config = cachedConfig || getHubSpotConfig();
  const httpClient = getHttpClient();

  const response = await handleHubSpotErrors(
    () =>
      httpClient.request({
        method,
        url: path,
        params: query,
        data: body,
        ...overrides,
      }),
    {
      retryPolicy: config.retryPolicy,
      operationName: operationName || `${method.toUpperCase()} ${path}`,
      method,
      path,
    }
  );

  return response.data;
}

/**
 * The client's public surface.
 *
 * Verb-named helpers rather than a single `request` export, so that a
 * repository reads as `hubSpotClient.post(path, body)` and the HTTP verb of
 * every HubSpot operation is visible at its call site.
 */
const hubSpotClient = {
  /**
   * @param {string} path
   * @param {object} [query]
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  get: (path, query, options = {}) => request({ method: 'get', path, query, ...options }),

  /**
   * @param {string} path
   * @param {object} [body]
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  post: (path, body, options = {}) => request({ method: 'post', path, body, ...options }),

  /**
   * @param {string} path
   * @param {object} [body]
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  patch: (path, body, options = {}) => request({ method: 'patch', path, body, ...options }),

  /**
   * HubSpot's association endpoints use PUT, which is what makes creating an
   * association naturally idempotent.
   *
   * @param {string} path
   * @param {object} [body]
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  put: (path, body, options = {}) => request({ method: 'put', path, body, ...options }),

  /**
   * @param {string} path
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  delete: (path, options = {}) => request({ method: 'delete', path, ...options }),

  /** The most recently observed rate-limit headers, or null. */
  getLastObservedRateLimit: () => lastObservedRateLimit,

  /** Test seam: discards the cached instance and configuration. */
  resetClientCache: () => {
    cachedHttpClient = null;
    cachedConfig = null;
    lastObservedRateLimit = null;
  },

  /** Exposed so tests can install an axios mock adapter. */
  getHttpClient,
};

module.exports = hubSpotClient;
module.exports.hubSpotClient = hubSpotClient;
