'use strict';

/**
 * One error type for every way a HubSpot call can fail.
 *
 * Callers need to make exactly one decision about a failure — retry, fix the
 * configuration, or fix the payload — and they should not have to inspect
 * `error.response?.status ?? error.code` to make it. Normalising at the client
 * boundary means every layer above sees the same shape whether the failure
 * came from HubSpot, from the socket, or from a request that never left.
 *
 * @see https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines
 */

/** How a failure should be acted on. Drives both retry logic and messaging. */
const FAILURE_KINDS = Object.freeze({
  /** The socket failed. Nothing is known about whether the request was applied. */
  NETWORK: 'NETWORK',
  /** The request exceeded the configured timeout. */
  TIMEOUT: 'TIMEOUT',
  /** 401 or 403. The token or its scopes are wrong; retrying cannot help. */
  AUTHENTICATION: 'AUTHENTICATION',
  /** 400, 409, 422. The payload is wrong; retrying cannot help. */
  VALIDATION: 'VALIDATION',
  /** 404. The record does not exist. */
  NOT_FOUND: 'NOT_FOUND',
  /** 429. Rate limited; retrying is correct after a wait. */
  RATE_LIMIT: 'RATE_LIMIT',
  /** 5xx. HubSpot failed; retrying is usually correct. */
  SERVER: 'SERVER',
  /** Anything unrecognised. Treated as non-retryable to fail safe. */
  UNKNOWN: 'UNKNOWN',
});

/**
 * Guidance attached to the failures where the next step is not obvious.
 *
 * Keyed by kind rather than status so that a caller reading the message is told
 * what to do, not merely what went wrong. The authentication case names the
 * scope problem explicitly because a 403 from HubSpot is almost always a
 * missing scope rather than a bad token, and those are fixed in different
 * places.
 */
const GUIDANCE_BY_KIND = Object.freeze({
  [FAILURE_KINDS.AUTHENTICATION]:
    'Check that HUBSPOT_ACCESS_TOKEN is a current private app token and that the app ' +
    'grants the scope this endpoint requires. Run `npm run probe` to list the granted scopes.',
  [FAILURE_KINDS.RATE_LIMIT]:
    'The request was throttled. This is retried automatically with backoff; seeing it ' +
    'escape means the retry budget was exhausted. Consider batch endpoints or a lower concurrency.',
  [FAILURE_KINDS.VALIDATION]:
    'HubSpot rejected the payload. Check property internal names against ' +
    'GET /crm/v3/properties/{objectType} — display labels are not accepted.',
  [FAILURE_KINDS.TIMEOUT]:
    'The request exceeded HUBSPOT_REQUEST_TIMEOUT_MS. Raise it, or reduce the page size.',
});

/**
 * Classifies an HTTP status into a failure kind.
 *
 * @param {number|undefined} statusCode
 * @returns {string} A member of `FAILURE_KINDS`.
 */
function classifyStatusCode(statusCode) {
  if (statusCode === 401 || statusCode === 403) {
    return FAILURE_KINDS.AUTHENTICATION;
  }
  if (statusCode === 404) {
    return FAILURE_KINDS.NOT_FOUND;
  }
  if (statusCode === 429) {
    return FAILURE_KINDS.RATE_LIMIT;
  }
  if (statusCode >= 500) {
    return FAILURE_KINDS.SERVER;
  }
  if (statusCode >= 400) {
    return FAILURE_KINDS.VALIDATION;
  }
  return FAILURE_KINDS.UNKNOWN;
}

class HubSpotApiError extends Error {
  /**
   * @param {string} message Human-readable summary.
   * @param {object} details
   * @param {string} details.kind One of `FAILURE_KINDS`.
   * @param {number} [details.statusCode] HTTP status, when a response arrived.
   * @param {string} [details.method] HTTP method of the failed request.
   * @param {string} [details.path] Request path, never including a query string
   *   that might carry a credential.
   * @param {string} [details.category] HubSpot's own `category` field.
   * @param {string} [details.subCategory] HubSpot's `subCategory`, when present.
   * @param {string} [details.correlationId] HubSpot's `correlationId`. Worth
   *   quoting verbatim when contacting their support.
   * @param {string} [details.policyName] For 429: `DAILY` or `TEN_SECONDLY_ROLLING`.
   * @param {number} [details.retryAfterMs] Parsed `Retry-After`, in milliseconds.
   * @param {Array<object>} [details.validationErrors] HubSpot's per-field detail.
   * @param {number} [details.attempts] How many attempts were made in total.
   * @param {Error} [details.cause] The originating error.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'HubSpotApiError';

    this.kind = details.kind || FAILURE_KINDS.UNKNOWN;
    this.statusCode = details.statusCode;
    this.method = details.method;
    this.path = details.path;
    this.category = details.category;
    this.subCategory = details.subCategory;
    this.correlationId = details.correlationId;
    this.policyName = details.policyName;
    this.retryAfterMs = details.retryAfterMs;
    this.validationErrors = details.validationErrors;
    this.attempts = details.attempts;
    this.guidance = GUIDANCE_BY_KIND[this.kind];

    if (details.cause) {
      this.cause = details.cause;
    }

    Error.captureStackTrace(this, HubSpotApiError);
  }

  /**
   * Whether another attempt could plausibly succeed.
   *
   * Deliberately conservative. A 400 is never retried, because sending an
   * invalid payload four more times only burns rate-limit budget and delays the
   * real error. A network failure *is* retried even though the request may have
   * been applied — which is why every write in this project is either
   * idempotent by construction or reconciled by a preceding read.
   *
   * @returns {boolean}
   */
  get isRetryable() {
    return [
      FAILURE_KINDS.NETWORK,
      FAILURE_KINDS.TIMEOUT,
      FAILURE_KINDS.RATE_LIMIT,
      FAILURE_KINDS.SERVER,
    ].includes(this.kind);
  }

  /**
   * Renders the error for a terminal reader: what failed, then what to do.
   *
   * No credential can reach this output — the token is never among the fields
   * copied onto the error — but callers are still expected to log through the
   * redacting logger rather than writing this directly.
   *
   * @returns {string}
   */
  toDisplayString() {
    const requestLine = this.method && this.path ? `${this.method} ${this.path}` : 'request';
    const statusPart = this.statusCode ? ` [HTTP ${this.statusCode}]` : '';

    const lines = [`${this.name}: ${this.message}`, `  ${requestLine}${statusPart}`];

    if (this.kind) {
      lines.push(`  kind: ${this.kind}${this.isRetryable ? ' (retryable)' : ' (not retryable)'}`);
    }
    if (this.policyName) {
      lines.push(`  rate limit policy: ${this.policyName}`);
    }
    if (this.correlationId) {
      lines.push(`  correlation id: ${this.correlationId}`);
    }
    if (this.attempts) {
      lines.push(`  attempts: ${this.attempts}`);
    }
    if (Array.isArray(this.validationErrors) && this.validationErrors.length > 0) {
      lines.push('  validation errors:');
      for (const validationError of this.validationErrors) {
        lines.push(`    - ${validationError.message || JSON.stringify(validationError)}`);
      }
    }
    if (this.guidance) {
      lines.push('', `  How to fix: ${this.guidance}`);
    }

    return lines.join('\n');
  }

  /**
   * A redaction-safe plain object, for structured logging.
   *
   * @returns {object}
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      kind: this.kind,
      statusCode: this.statusCode,
      method: this.method,
      path: this.path,
      category: this.category,
      subCategory: this.subCategory,
      correlationId: this.correlationId,
      policyName: this.policyName,
      retryAfterMs: this.retryAfterMs,
      attempts: this.attempts,
      isRetryable: this.isRetryable,
    };
  }
}

module.exports = { HubSpotApiError, FAILURE_KINDS, classifyStatusCode };
