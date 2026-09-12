#!/usr/bin/env node
'use strict';

/**
 * Section 2.1 — List contacts.
 *
 * "Implement getHubSpotContactNames making real calls to
 * GET /crm/v3/objects/contacts, handle pagination, and return full names."
 *
 * Run: node src/examples/01-list-contact-names.js [limit]
 */

const { runOperation } = require('../api/hubSpotApiHandler');

runOperation('list-contact-names', process.argv.slice(2)).then((exitCode) =>
  process.exit(exitCode)
);
