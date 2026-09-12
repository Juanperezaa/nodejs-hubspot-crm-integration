#!/usr/bin/env node
'use strict';

/**
 * Synchronises contacts from a local JSON source (R11).
 *
 * Run it twice. The first run reports contacts created; the second reports the
 * same number updated, and the portal holds one record per address rather than
 * two. That is what "idempotent create/update" means.
 *
 * Pass `--dry-run` to see what would change without writing anything.
 *
 * Run: node src/examples/05-sync-contacts.js [sourcePath] [--dry-run]
 */

const { runOperation } = require('../api/hubSpotApiHandler');

runOperation('sync-contacts', process.argv.slice(2)).then((exitCode) => process.exit(exitCode));
