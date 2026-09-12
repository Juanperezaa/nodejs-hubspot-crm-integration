#!/usr/bin/env node
'use strict';

/**
 * Section 2.3 — Associate a contact to a deal.
 *
 * "Implement associateContactToDeal(contactId, dealId) using the HubSpot
 * associations endpoint, ensuring idempotency where possible."
 *
 * Run it twice with the same ids: the first call reports
 * `alreadyAssociated: false`, the second reports `true`, and the portal holds
 * exactly one association either way.
 *
 * Run: node src/examples/associate-contact-to-deal.js <contactId> <dealId>
 */

const { runOperation } = require('../api/hubSpotApiHandler');

const [contactId, dealId] = process.argv.slice(2);

if (!contactId || !dealId) {
  process.stderr.write(
    '\nUsage: node src/examples/associate-contact-to-deal.js <contactId> <dealId>\n\n' +
      '  Create the two records first:\n' +
      '    node src/examples/create-contact.js\n' +
      '    node src/examples/create-deal.js\n\n' +
      '  Or run the whole sequence in one command:\n' +
      '    node src/examples/full-workflow.js\n\n'
  );
  process.exit(1);
}

runOperation('associate', [contactId, dealId]).then((exitCode) => process.exit(exitCode));
