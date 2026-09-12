'use strict';

/**
 * Minimal levelled logger with mandatory secret redaction.
 *
 * Deliberately not `pino` or `winston`. This project logs to a console for a
 * human reviewer, and the one behaviour that genuinely matters — that no
 * credential is ever written — is easier to guarantee and to test in fifty
 * lines than to configure correctly in a library.
 *
 * Every value passed as context goes through `redactSecrets` before it reaches
 * the transport. There is no path around it.
 */

const { redactSecrets } = require('./redactSecrets');

/** Severity ordering. A message is emitted when its level is at or above the configured threshold. */
const LOG_LEVELS = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
});

const DEFAULT_LOG_LEVEL = 'info';

/**
 * Resolves the active threshold, falling back to the default when the
 * environment holds an unrecognised value rather than failing: a typo in
 * `LOG_LEVEL` should not prevent the application from starting.
 *
 * @returns {string}
 */
function resolveConfiguredLevel() {
  const requested = String(process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL).toLowerCase();
  return Object.prototype.hasOwnProperty.call(LOG_LEVELS, requested)
    ? requested
    : DEFAULT_LOG_LEVEL;
}

/**
 * Formats one record for a terminal reader.
 *
 * @param {string} level
 * @param {string} message
 * @param {object|undefined} context
 * @returns {string}
 */
function formatRecord(level, message, context) {
  const timestamp = new Date().toISOString();
  const header = `${timestamp} ${level.toUpperCase().padEnd(5)} ${message}`;

  if (context === undefined) {
    return header;
  }

  const redactedContext = redactSecrets(context);
  return `${header}\n${JSON.stringify(redactedContext, null, 2)}`;
}

/**
 * Writes a record when its severity meets the configured threshold.
 *
 * @param {string} level
 * @param {string} message
 * @param {object} [context] Structured detail. Redacted before writing.
 * @returns {void}
 */
function writeRecord(level, message, context) {
  if (LOG_LEVELS[level] > LOG_LEVELS[resolveConfiguredLevel()]) {
    return;
  }

  // Errors and warnings go to stderr so that piping stdout — as the examples
  // and the streams exercise do — never mixes diagnostics into data.
  const stream = LOG_LEVELS[level] <= LOG_LEVELS.warn ? process.stderr : process.stdout;
  stream.write(`${formatRecord(level, redactSecrets(message), context)}\n`);
}

const logger = Object.freeze({
  error: (message, context) => writeRecord('error', message, context),
  warn: (message, context) => writeRecord('warn', message, context),
  info: (message, context) => writeRecord('info', message, context),
  debug: (message, context) => writeRecord('debug', message, context),

  /** Exposed for tests and for the probe script's banner. */
  getConfiguredLevel: resolveConfiguredLevel,
});

module.exports = { logger, LOG_LEVELS, DEFAULT_LOG_LEVEL };
