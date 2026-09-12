'use strict';

/**
 * `handleHubSpotErrors` — error normalisation, logging and retry policy.
 *
 * Required by the brief: "utility to normalize and log errors, including
 * retries and backoff for 429/5xx".
 *
 * Three responsibilities, kept separate so each can be tested alone:
 *
 *   - `normaliseHubSpotError` turns anything axios throws into a
 *     `HubSpotApiError` with a decided `kind`.
 *   - `calculateBackoffDelay` decides how long to wait before the next attempt.
 *   - `handleHubSpotErrors` wraps an operation, applying both and logging the
 *     outcome without ever writing a credential.
 *
 * @see https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines
 */

const { HubSpotApiError, FAILURE_KINDS, classifyStatusCode } = require('../errors/HubSpotApiError');
const { logger } = require('./logger');
const { RETRYABLE_NETWORK_CODES } = require('../config/hubspot.config');

/** Node socket codes that mean the request timed out rather than failed outright. */
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED']);

/**
 * Parses HubSpot's `Retry-After` header into milliseconds.
 *
 * The header is defined as either a number of seconds or an HTTP date, and
 * HubSpot uses the former. Both are handled because a proxy in front of the API
 * may rewrite it, and misreading a date as `NaN` seconds would silently disable
 * the wait the header exists to request.
 *
 * @param {string|number|undefined} headerValue
 * @returns {number|undefined} Milliseconds to wait, or undefined if unparseable.
 */
function parseRetryAfterHeader(headerValue) {
  if (headerValue === undefined || headerValue === null || headerValue === '') {
    return undefined;
  }

  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }

  const asDate = Date.parse(String(headerValue));
  if (!Number.isNaN(asDate)) {
    // A date in the past means "retry now", not "retry in the negative past".
    return Math.max(0, asDate - Date.now());
  }

  return undefined;
}

/**
 * Turns any thrown value into a `HubSpotApiError`.
 *
 * @param {unknown} thrownValue Whatever the request rejected with.
 * @param {{method?: string, path?: string, attempts?: number}} [context]
 * @returns {HubSpotApiError}
 */
function normaliseHubSpotError(thrownValue, context = {}) {
  // Already normalised: preserve it rather than wrapping twice, which would
  // bury the original kind behind an UNKNOWN.
  if (thrownValue instanceof HubSpotApiError) {
    if (context.attempts !== undefined) {
      thrownValue.attempts = context.attempts;
    }
    return thrownValue;
  }

  const requestMethod = (context.method || thrownValue?.config?.method || '').toUpperCase();
  // The path is taken from the request config rather than the full URL so that
  // no query string — which could carry a legacy hapikey — is copied onto the
  // error and then logged.
  const requestPath = context.path || thrownValue?.config?.url || undefined;

  const baseDetails = {
    method: requestMethod || undefined,
    path: requestPath,
    attempts: context.attempts,
    cause: thrownValue instanceof Error ? thrownValue : undefined,
  };

  const response = thrownValue?.response;

  // --- No response: the request never completed ----------------------------
  if (!response) {
    const socketCode = thrownValue?.code;

    if (TIMEOUT_CODES.has(socketCode)) {
      return new HubSpotApiError(`Request timed out: ${requestMethod} ${requestPath}`, {
        ...baseDetails,
        kind: FAILURE_KINDS.TIMEOUT,
      });
    }

    if (RETRYABLE_NETWORK_CODES.includes(socketCode)) {
      return new HubSpotApiError(
        `Network failure (${socketCode}): ${requestMethod} ${requestPath}`,
        { ...baseDetails, kind: FAILURE_KINDS.NETWORK }
      );
    }

    return new HubSpotApiError(
      thrownValue?.message || 'Request failed before a response was received.',
      { ...baseDetails, kind: FAILURE_KINDS.UNKNOWN }
    );
  }

  // --- A response arrived: classify by status ------------------------------
  const statusCode = response.status;
  const responseBody = response.data || {};
  const kind = classifyStatusCode(statusCode);

  // HubSpot's own message is more specific than anything constructed here, so
  // it is preferred when present.
  const message =
    responseBody.message ||
    thrownValue?.message ||
    `${requestMethod} ${requestPath} failed with status ${statusCode}`;

  return new HubSpotApiError(message, {
    ...baseDetails,
    kind,
    statusCode,
    category: responseBody.category,
    subCategory: responseBody.subCategory,
    correlationId: responseBody.correlationId,
    policyName: responseBody.policyName,
    validationErrors: responseBody.errors,
    retryAfterMs: parseRetryAfterHeader(response.headers?.['retry-after']),
  });
}

/**
 * Calculates how long to wait before the next attempt.
 *
 * Uses **full jitter**: the delay is a uniform random value between zero and
 * the exponential ceiling, rather than the ceiling itself.
 *
 * That matters here specifically. HubSpot's burst limit is a rolling
 * ten-second window shared by every caller using the same app. If ten
 * concurrent requests are throttled together and all back off by the same
 * fixed amount, they retry in lockstep and re-trigger the identical limit.
 * Spreading them across the interval is what actually lets the window drain.
 *
 * A `Retry-After` header always wins, because HubSpot knows when the window
 * clears and this function is only guessing.
 *
 * @param {number} attemptNumber 1 for the first retry, 2 for the second, and so on.
 * @param {{baseDelayMs: number, maxDelayMs: number}} retryPolicy
 * @param {number} [retryAfterMs] Server-supplied wait, when present.
 * @param {() => number} [random] Injectable for deterministic tests.
 * @returns {number} Milliseconds to wait.
 */
function calculateBackoffDelay(attemptNumber, retryPolicy, retryAfterMs, random = Math.random) {
  if (retryAfterMs !== undefined) {
    // Still capped: a misconfigured proxy returning `Retry-After: 86400` must
    // not park the process for a day.
    return Math.min(retryAfterMs, retryPolicy.maxDelayMs);
  }

  const exponentialCeiling = Math.min(
    retryPolicy.baseDelayMs * 2 ** (attemptNumber - 1),
    retryPolicy.maxDelayMs
  );

  return Math.round(random() * exponentialCeiling);
}

/**
 * Pauses execution.
 *
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Runs an operation, retrying retryable failures with backoff.
 *
 * Every HubSpot call in this project passes through here, which is what makes
 * the retry policy a property of the system rather than of whoever remembered
 * to write a loop.
 *
 * @param {() => Promise<T>} operation The call to make. Invoked once per attempt.
 * @param {object} options
 * @param {{maxAttempts: number, baseDelayMs: number, maxDelayMs: number}} options.retryPolicy
 * @param {string} [options.operationName] Used in log lines.
 * @param {string} [options.method]
 * @param {string} [options.path]
 * @param {(ms: number) => Promise<void>} [options.sleep] Injectable for tests.
 * @param {() => number} [options.random] Injectable for tests.
 * @returns {Promise<T>}
 * @throws {HubSpotApiError} When every attempt fails, or the failure is not retryable.
 * @template T
 */
async function handleHubSpotErrors(operation, options) {
  const {
    retryPolicy,
    operationName = 'HubSpot request',
    method,
    path,
    sleep = delay,
    random = Math.random,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
    try {
      const result = await operation();

      if (attempt > 1) {
        // Worth recording: a call that only succeeded on retry is a signal
        // about the portal's health that a silent success would hide.
        logger.info(`${operationName} succeeded after retry`, { attempt, method, path });
      }

      return result;
    } catch (thrownValue) {
      lastError = normaliseHubSpotError(thrownValue, { method, path, attempts: attempt });

      const isLastAttempt = attempt === retryPolicy.maxAttempts;

      if (!lastError.isRetryable) {
        // Fail immediately. Repeating an invalid payload or a bad token only
        // burns rate-limit budget and delays the real error reaching the caller.
        logger.error(`${operationName} failed and will not be retried`, lastError.toJSON());
        throw lastError;
      }

      if (isLastAttempt) {
        logger.error(`${operationName} failed after ${attempt} attempts`, lastError.toJSON());
        throw lastError;
      }

      const waitMilliseconds = calculateBackoffDelay(
        attempt,
        retryPolicy,
        lastError.retryAfterMs,
        random
      );

      logger.warn(`${operationName} failed; retrying`, {
        attempt,
        maxAttempts: retryPolicy.maxAttempts,
        waitMilliseconds,
        kind: lastError.kind,
        statusCode: lastError.statusCode,
        policyName: lastError.policyName,
        honouredRetryAfter: lastError.retryAfterMs !== undefined,
      });

      await sleep(waitMilliseconds);
    }
  }

  // Unreachable: the loop either returns or throws. Present so that a future
  // edit to the loop bounds cannot silently return undefined.
  throw lastError;
}

module.exports = {
  handleHubSpotErrors,
  normaliseHubSpotError,
  calculateBackoffDelay,
  parseRetryAfterHeader,
  delay,
};
