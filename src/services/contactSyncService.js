'use strict';

/**
 * `syncContactsWithHubSpot` — idempotent contact synchronisation.
 *
 * Brief: "logic to sync a set of contacts from a source (a local JSON for the
 * test) into HubSpot, handling idempotent create/update".
 *
 * **Idempotency rests on `email`.** It is the only natively unique contact
 * property on every HubSpot tier, so `batch/upsert` with `idProperty: "email"`
 * reconciles a hundred records in one call and running the sync twice leaves
 * one record per address rather than two.
 *
 * **Reporting rests on a preceding batch read.** The upsert response does not
 * say whether a record was created or updated — HubSpot returns the same shape
 * either way — so the emails already present are read first. That costs one
 * extra request per hundred records and buys a truthful report. The
 * alternatives were rejected: comparing `createdate` against the local clock
 * depends on two machines agreeing about the time, and scanning the whole
 * portal costs far more than a batch read.
 *
 * **A malformed record does not stop the run.** One bad address in a file of
 * fifty must not discard the other forty-nine, so validation failures are
 * collected and reported rather than thrown.
 */

const fs = require('fs');
const path = require('path');

const contactRepository = require('../repositories/contactRepository');
const { logger } = require('../utils/logger');
const { validateContactPayload } = require('../utils/validateHubSpotPayload');
const { chunkForBatch } = require('../utils/paginate');
const { PAGINATION_LIMITS } = require('../config/hubspot.config');
const {
  createSyncReport,
  recordSuccess,
  recordFailure,
  finaliseSyncReport,
} = require('./syncReport');

/**
 * Loads contacts from a JSON file or accepts them directly.
 *
 * @param {string|Array<object>} source A file path, or the records themselves.
 * @returns {{records: Array<object>, description: string}}
 */
function loadContactSource(source) {
  if (Array.isArray(source)) {
    return { records: source, description: `${source.length} in-memory records` };
  }

  const absolutePath = path.isAbsolute(source)
    ? source
    : path.resolve(__dirname, '..', '..', source);

  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new TypeError(`${absolutePath} must contain a JSON array of contacts.`);
  }

  return { records: parsed, description: path.relative(process.cwd(), absolutePath) };
}

/**
 * Synchronises contacts into HubSpot, creating or updating as required.
 *
 * @param {string|Array<object>} [source] JSON file path or an array of records.
 *   Defaults to the project's seed file.
 * @param {object} [options]
 * @param {boolean} [options.dryRun] Validate and report without writing.
 * @returns {Promise<object>} A frozen sync report.
 */
async function syncContactsWithHubSpot(source = 'data/contacts.seed.json', options = {}) {
  const { dryRun = false } = options;
  const startedAtMs = Date.now();

  const { records, description } = loadContactSource(source);
  const report = createSyncReport(`contacts from ${description}${dryRun ? ' (dry run)' : ''}`);

  // --- 1. Validate locally, so a bad record costs no request ---------------
  const validRecords = [];
  for (const record of records) {
    const recordKey = record?.email ?? '(no email)';
    try {
      const { properties } = validateContactPayload({ properties: record });
      validRecords.push(properties);
    } catch (error) {
      recordFailure(report, recordKey, error);
    }
  }

  if (validRecords.length === 0) {
    logger.warn('Contact sync found no valid records', { source: description });
    return finaliseSyncReport(report, startedAtMs);
  }

  // --- 2. Learn which already exist, so the report can tell the difference --
  const emails = validRecords.map((properties) => properties.email);
  const { found: existingByEmail } = await contactRepository.batchReadByProperty(emails, {
    idProperty: 'email',
    properties: ['email'],
  });

  if (dryRun) {
    for (const properties of validRecords) {
      const existing = existingByEmail.get(properties.email);
      recordSuccess(
        report,
        properties.email,
        existing?.id ?? '(would be created)',
        existing ? 'updated' : 'created'
      );
    }
    logger.info('Contact sync dry run complete', {
      wouldCreate: report.created,
      wouldUpdate: report.updated,
    });
    return finaliseSyncReport(report, startedAtMs);
  }

  // --- 3. Upsert, batch by batch -------------------------------------------
  for (const batch of chunkForBatch(validRecords, PAGINATION_LIMITS.MAX_BATCH_INPUTS)) {
    try {
      const { results } = await contactRepository.upsertContactsByEmail(batch);

      for (const result of results) {
        const email = result.properties?.email;
        recordSuccess(report, email, result.id, existingByEmail.has(email) ? 'updated' : 'created');
      }
    } catch (error) {
      // A whole batch failing is reported against every record in it, because
      // HubSpot rejected the request rather than any individual entry.
      for (const properties of batch) {
        recordFailure(report, properties.email, error);
      }
    }
  }

  const finalReport = finaliseSyncReport(report, startedAtMs);

  logger.info('Contact sync complete', {
    source: description,
    created: finalReport.created,
    updated: finalReport.updated,
    failed: finalReport.failed,
    durationMs: finalReport.durationMs,
  });

  return finalReport;
}

module.exports = { syncContactsWithHubSpot, loadContactSource };
