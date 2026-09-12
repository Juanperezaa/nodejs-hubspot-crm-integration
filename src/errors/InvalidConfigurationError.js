'use strict';

/**
 * Raised when the process is misconfigured, before any network call is made.
 *
 * Kept distinct from `HubSpotApiError` because the two demand different
 * responses: a configuration fault is the operator's to fix and retrying will
 * never help, whereas an API fault may be transient. Conflating them leads to
 * retry loops around problems that cannot resolve themselves.
 *
 * Every instance carries the variable at fault and concrete guidance, so the
 * message alone is enough to act on without opening the source.
 */
class InvalidConfigurationError extends Error {
  /**
   * @param {string} message What is wrong.
   * @param {{variableName?: string, guidance?: string}} [details] How to fix it.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'InvalidConfigurationError';
    this.variableName = details.variableName;
    this.guidance = details.guidance;

    // Omits this constructor from the stack so the trace points at the caller.
    Error.captureStackTrace(this, InvalidConfigurationError);
  }

  /**
   * Renders the error for a terminal reader: the fault, then what to do.
   *
   * @returns {string}
   */
  toDisplayString() {
    const lines = [`${this.name}: ${this.message}`];
    if (this.guidance) {
      lines.push('', `  How to fix: ${this.guidance}`);
    }
    return lines.join('\n');
  }
}

module.exports = { InvalidConfigurationError };
