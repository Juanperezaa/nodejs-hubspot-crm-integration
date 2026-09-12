'use strict';

/**
 * The shape both synchronisation services report.
 *
 * Shared so that a caller handling one can handle the other, and so that the
 * console output of `syncContactsWithHubSpot` and `syncDealsWithHubSpot` reads
 * identically. A sync that reports differently depending on which object it
 * moved is harder to operate than it needs to be.
 *
 * The design commitment worth naming: **a sync reports what happened rather
 * than only whether it finished.** One malformed record in a batch of fifty
 * must not discard the other forty-nine, and the caller must be able to tell
 * the difference between "created nothing because everything already matched"
 * and "created nothing because everything failed".
 */

/**
 * Builds an empty report.
 *
 * @param {string} sourceDescription Where the records came from.
 * @returns {object} A mutable report accumulator.
 */
function createSyncReport(sourceDescription) {
  return {
    source: sourceDescription,
    startedAt: new Date().toISOString(),
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    /** @type {Array<{record: string, reason: string, kind: string|undefined}>} */
    errors: [],
    /** @type {Array<{record: string, id: string, action: string}>} */
    records: [],
    durationMs: 0,
  };
}

/**
 * Records a successful outcome for one record.
 *
 * @param {object} report
 * @param {string} recordKey A human-recognisable identifier: an email, a deal name.
 * @param {string} recordId The HubSpot record id.
 * @param {'created'|'updated'|'skipped'} action
 * @returns {void}
 */
function recordSuccess(report, recordKey, recordId, action) {
  report[action] += 1;
  report.records.push({ record: recordKey, id: recordId, action });
}

/**
 * Records a failure for one record, without aborting the run.
 *
 * @param {object} report
 * @param {string} recordKey
 * @param {Error} error
 * @returns {void}
 */
function recordFailure(report, recordKey, error) {
  report.failed += 1;
  report.errors.push({
    record: recordKey,
    reason: error.message,
    // Present when the failure came through HubSpotApiError, which tells the
    // reader whether retrying the whole sync could plausibly help.
    kind: error.kind,
  });
}

/**
 * Finalises a report.
 *
 * @param {object} report
 * @param {number} startedAtMs
 * @returns {object} The completed, frozen report.
 */
function finaliseSyncReport(report, startedAtMs) {
  report.durationMs = Date.now() - startedAtMs;
  report.finishedAt = new Date().toISOString();
  report.total = report.created + report.updated + report.skipped + report.failed;
  return Object.freeze(report);
}

/**
 * Renders a report for a terminal reader.
 *
 * The brief asks for examples "with clear console output", and a table of
 * counts is what an operator actually needs from a sync: what changed, what
 * did not, and what went wrong.
 *
 * @param {object} report
 * @returns {string}
 */
function formatSyncReport(report) {
  const lines = [
    '',
    `Sync report — ${report.source}`,
    '='.repeat(66),
    `  total     : ${report.total}`,
    `  created   : ${report.created}`,
    `  updated   : ${report.updated}`,
    `  skipped   : ${report.skipped}`,
    `  failed    : ${report.failed}`,
    `  duration  : ${report.durationMs} ms`,
  ];

  if (report.records.length > 0) {
    lines.push('', '  records:');
    for (const entry of report.records) {
      lines.push(`    [${entry.action.padEnd(7)}] ${entry.record} -> ${entry.id}`);
    }
  }

  if (report.errors.length > 0) {
    lines.push('', '  failures:');
    for (const failure of report.errors) {
      lines.push(`    ${failure.record}`);
      lines.push(`      ${failure.reason}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

module.exports = {
  createSyncReport,
  recordSuccess,
  recordFailure,
  finaliseSyncReport,
  formatSyncReport,
};
