'use strict';

/**
 * `syncDealsWithHubSpot` — idempotent deal synchronisation.
 *
 * Brief: "syncDealsWithHubSpot — equivalent logic for deals".
 *
 * Equivalent in outcome, not in mechanism, because deals differ from contacts
 * in a way that dictates the approach: **a deal has no naturally unique
 * property.** There is no `email` to upsert on, so reconciliation has to
 * correlate on something chosen rather than something guaranteed.
 *
 * **Correlation is on `dealname`, read from the list endpoint.** Two
 * alternatives were rejected, both for measured reasons:
 *
 *   - *A custom correlation property.* The better design for a long-lived
 *     integration, since an external id survives renames. It requires
 *     `crm.schemas.deals.write` — a scope nothing else here needs — and leaves
 *     that property on the portal's Deal schema permanently, unlike the records
 *     this project creates and then deletes. Decision D11.
 *   - *The Search API.* Measured against a live portal, a newly created deal
 *     was absent from search results at 5406 ms and first appeared at 6766 ms.
 *     A sync correlating through search would fail to find a deal it had just
 *     created and would duplicate it inside that window — which defeats the
 *     only property the operation exists to provide. Decision D14.
 *
 * The list endpoint reflects a write immediately, so the index is built from
 * there. The cost is proportionate for a seed file and would not be for a
 * portal with a hundred thousand deals; that limit is stated rather than
 * hidden, and `maxScan` bounds it.
 */

const fs = require('fs');
const path = require('path');

const dealRepository = require('../repositories/dealRepository');
const contactRepository = require('../repositories/contactRepository');
const pipelineRepository = require('../repositories/pipelineRepository');
const hubSpotService = require('./hubSpotService');
const { getHubSpotConfig } = require('../config/hubspot.config');
const { HubSpotApiError, FAILURE_KINDS } = require('../errors/HubSpotApiError');
const { logger } = require('../utils/logger');
const {
  createSyncReport,
  recordSuccess,
  recordFailure,
  finaliseSyncReport,
} = require('./syncReport');

/** Bound on the correlation scan, so a large portal fails loudly rather than silently. */
const DEFAULT_MAX_SCAN = 10000;

/**
 * Loads deals from a JSON file or accepts them directly.
 *
 * @param {string|Array<object>} source
 * @returns {{records: Array<object>, description: string}}
 */
function loadDealSource(source) {
  if (Array.isArray(source)) {
    return { records: source, description: `${source.length} in-memory records` };
  }

  const absolutePath = path.isAbsolute(source)
    ? source
    : path.resolve(__dirname, '..', '..', source);

  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new TypeError(`${absolutePath} must contain a JSON array of deals.`);
  }

  return { records: parsed, description: path.relative(process.cwd(), absolutePath) };
}

/**
 * Builds a `dealname` to record index from the list endpoint.
 *
 * Streamed rather than materialised, so memory stays flat regardless of how
 * many deals the portal holds — only the index grows, and only with the names.
 *
 * A duplicate name keeps the first record seen and is reported, because
 * `dealname` is not unique in HubSpot and silently picking one of two would
 * make the sync's behaviour depend on page ordering.
 *
 * @param {{maxScan?: number}} [options]
 * @returns {Promise<{index: Map<string, object>, scanned: number, duplicates: string[]}>}
 */
async function buildDealNameIndex(options = {}) {
  const { maxScan = DEFAULT_MAX_SCAN } = options;

  const index = new Map();
  const duplicates = [];
  let scanned = 0;

  for await (const deal of dealRepository.streamDeals({
    properties: ['dealname', 'amount', 'pipeline', 'dealstage'],
  })) {
    scanned += 1;

    if (scanned > maxScan) {
      throw new HubSpotApiError(
        `Deal correlation scanned more than ${maxScan} records without finishing.`,
        {
          kind: FAILURE_KINDS.VALIDATION,
          validationErrors: [
            {
              field: 'maxScan',
              message:
                'This portal is too large to correlate by scanning. Use a dedicated ' +
                'correlation property with crm.schemas.deals.write, or raise maxScan ' +
                'deliberately. See decision D14.',
            },
          ],
        }
      );
    }

    const dealName = deal.properties?.dealname;
    if (!dealName) {
      continue;
    }

    if (index.has(dealName)) {
      duplicates.push(dealName);
      continue;
    }
    index.set(dealName, deal);
  }

  return { index, scanned, duplicates };
}

/**
 * Synchronises deals into HubSpot, creating or updating as required.
 *
 * When a source record carries `contactEmail`, the deal is associated with that
 * contact after the write. The association is idempotent, so re-running the
 * sync neither duplicates the deal nor duplicates the link.
 *
 * @param {string|Array<object>} [source] JSON file path or an array of records.
 * @param {object} [options]
 * @param {boolean} [options.dryRun] Report without writing.
 * @param {boolean} [options.associateContacts] Link deals to contacts by email. Default true.
 * @param {number} [options.maxScan] Bound on the correlation scan.
 * @returns {Promise<object>} A frozen sync report.
 */
async function syncDealsWithHubSpot(source = 'data/deals.seed.json', options = {}) {
  const { dryRun = false, associateContacts = true, maxScan = DEFAULT_MAX_SCAN } = options;
  const startedAtMs = Date.now();
  const config = getHubSpotConfig();

  const { records, description } = loadDealSource(source);
  const report = createSyncReport(`deals from ${description}${dryRun ? ' (dry run)' : ''}`);

  // --- 1. Fail fast on a misconfigured pipeline ----------------------------
  // One check for the whole run rather than one per deal: the configuration is
  // the same for every record, so a wrong stage should cost one request, not N.
  if (!dryRun) {
    await pipelineRepository.assertPipelineAndStageExist(
      config.defaultPipelineId,
      config.defaultStageId
    );
  }

  // --- 2. Build the correlation index --------------------------------------
  const { index, scanned, duplicates } = await buildDealNameIndex({ maxScan });

  if (duplicates.length > 0) {
    logger.warn('Deal names are not unique in this portal', {
      duplicateCount: duplicates.length,
      sample: duplicates.slice(0, 5),
    });
  }
  logger.info('Built deal correlation index', { scanned, indexed: index.size });

  // --- 3. Create or update each record -------------------------------------
  for (const record of records) {
    const dealName = record?.dealname ?? '(no dealname)';

    try {
      if (typeof record?.dealname !== 'string' || record.dealname.trim() === '') {
        throw new TypeError('Each source deal must carry a non-empty "dealname".');
      }

      const existing = index.get(record.dealname);

      if (dryRun) {
        recordSuccess(
          report,
          dealName,
          existing?.id ?? '(would be created)',
          existing ? 'updated' : 'created'
        );
        continue;
      }

      let dealId;
      if (existing) {
        const updated = await hubSpotService.updateHubSpotDeal(existing.id, {
          amount: record.amount,
          ...(record.description ? { description: record.description } : {}),
        });
        dealId = updated.id;
        recordSuccess(report, dealName, dealId, 'updated');
      } else {
        const created = await hubSpotService.createHubSpotDeal(record.dealname, record.amount, {
          // The pipeline was verified once above, so verifying per deal would
          // spend a request repeating an answer already known.
          verifyPipeline: false,
          additionalProperties: record.description ? { description: record.description } : {},
        });
        dealId = created.id;
        // Added to the index so a duplicated name inside the source file is
        // reconciled against the record this run just created, rather than
        // creating it twice.
        index.set(record.dealname, created);
        recordSuccess(report, dealName, dealId, 'created');
      }

      if (associateContacts && record.contactEmail) {
        await associateDealWithContact(dealId, record.contactEmail, report, dealName);
      }
    } catch (error) {
      recordFailure(report, dealName, error);
    }
  }

  const finalReport = finaliseSyncReport(report, startedAtMs);

  logger.info('Deal sync complete', {
    source: description,
    created: finalReport.created,
    updated: finalReport.updated,
    failed: finalReport.failed,
    durationMs: finalReport.durationMs,
  });

  return finalReport;
}

/**
 * Links a deal to a contact identified by email.
 *
 * A missing contact is logged rather than failing the deal: the deal itself was
 * written correctly, and reporting it as a failure would misrepresent what
 * happened. The association is reported through the log so the gap is still
 * visible.
 *
 * @param {string} dealId
 * @param {string} contactEmail
 * @param {object} report
 * @param {string} dealName
 * @returns {Promise<void>}
 */
async function associateDealWithContact(dealId, contactEmail, report, dealName) {
  try {
    const contact = await contactRepository.findContactByEmail(contactEmail, {
      properties: ['email'],
    });
    await hubSpotService.associateContactToDeal(contact.id, dealId);
  } catch (error) {
    if (error instanceof HubSpotApiError && error.kind === FAILURE_KINDS.NOT_FOUND) {
      logger.warn('No contact exists for the deal source email; skipping the association', {
        dealName,
        contactEmail,
      });
      return;
    }
    // Any other failure is worth surfacing in the report: the deal is written
    // but the relationship the source described is missing.
    recordFailure(report, `${dealName} -> ${contactEmail}`, error);
  }
}

module.exports = { syncDealsWithHubSpot, loadDealSource, buildDealNameIndex };
