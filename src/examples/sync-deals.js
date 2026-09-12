#!/usr/bin/env node
'use strict';

/**
 * Synchronises deals from a local JSON source (R12).
 *
 * Deals have no naturally unique property, so reconciliation correlates on
 * `dealname` against an index built from the list endpoint. The Search API is
 * deliberately not used: it lags a write by roughly seven seconds, so a sync
 * correlating through it would duplicate a deal it had just created. See
 * decision D14.
 *
 * Source records carrying `contactEmail` are also associated with that contact.
 * Running twice duplicates neither the deal nor the association.
 *
 * Run: node src/examples/sync-deals.js [sourcePath] [--dry-run]
 */

const { runOperation } = require('../api/hubSpotApiHandler');

runOperation('sync-deals', process.argv.slice(2)).then((exitCode) => process.exit(exitCode));
