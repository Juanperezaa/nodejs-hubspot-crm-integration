'use strict';

/**
 * Secret redaction.
 *
 * The brief requires that errors be logged "without exposing tokens or
 * sensitive data". Satisfying that with discipline alone does not survive
 * contact with reality: an axios error object carries the full request
 * configuration, headers included, and any `console.error(error)` would print
 * the bearer token in clear text.
 *
 * So redaction is applied structurally, at the logger boundary, to everything
 * on its way out. Nothing reaches a transport without passing through here.
 */

/** Replacement written in place of any secret. */
const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Object keys whose value is always a secret, regardless of its shape.
 * Compared case-insensitively.
 */
const SECRET_KEY_NAMES = new Set([
  'authorization',
  'auth',
  'token',
  'tokenkey',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'client_secret',
  'hapikey',
  'apikey',
  'api_key',
  'password',
  'secret',
  'hubspot_access_token',
]);

/**
 * Patterns that identify a secret inside free text, such as a message body or
 * a serialised URL. Each pattern keeps a recognisable prefix so a reader can
 * still tell *what kind* of credential was redacted while learning nothing
 * about its value.
 */
const SECRET_TEXT_PATTERNS = [
  // HubSpot private app tokens: pat-na1-…, pat-eu1-…
  { pattern: /pat-[a-z]{2}\d?-[A-Za-z0-9-]+/gi, replacement: `pat-${REDACTION_PLACEHOLDER}` },
  // Any bearer credential in an Authorization header value.
  { pattern: /Bearer\s+[A-Za-z0-9._\-~+/]+=*/gi, replacement: `Bearer ${REDACTION_PLACEHOLDER}` },
  // The retired API key, still worth catching if legacy code appears.
  { pattern: /([?&]hapikey=)[^&\s]+/gi, replacement: `$1${REDACTION_PLACEHOLDER}` },
  // OAuth refresh and access tokens in HubSpot's format.
  {
    pattern: /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi,
    replacement: REDACTION_PLACEHOLDER,
  },
];

/**
 * Redacts secrets from a string.
 *
 * @param {string} text
 * @returns {string}
 */
function redactText(text) {
  return SECRET_TEXT_PATTERNS.reduce(
    (accumulated, { pattern, replacement }) => accumulated.replace(pattern, replacement),
    text
  );
}

/**
 * Recursively redacts secrets from any value.
 *
 * Cycles are tracked because axios error objects are self-referential: an
 * error's `config` points at the request, whose `response` points back at the
 * error. Without a seen-set this would not terminate.
 *
 * @param {unknown} value Anything headed for a log transport.
 * @param {WeakSet<object>} [seen] Internal cycle guard.
 * @returns {unknown} A redacted copy. The input is never mutated.
 */
function redactSecrets(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return redactText(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, seen));
  }

  if (value instanceof Error) {
    // Errors do not spread usefully; their interesting fields are
    // non-enumerable, so they are copied across explicitly.
    const redactedError = {
      name: value.name,
      message: redactText(value.message),
    };
    for (const key of Object.keys(value)) {
      redactedError[key] = redactSecrets(value[key], seen);
    }
    return redactedError;
  }

  const redactedObject = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redactedObject[key] = SECRET_KEY_NAMES.has(key.toLowerCase())
      ? REDACTION_PLACEHOLDER
      : redactSecrets(nestedValue, seen);
  }
  return redactedObject;
}

module.exports = {
  redactSecrets,
  REDACTION_PLACEHOLDER,
  SECRET_KEY_NAMES,
};
