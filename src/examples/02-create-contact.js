#!/usr/bin/env node
'use strict';

/**
 * Creates a contact (R03).
 *
 * The address defaults to a run-scoped one under `example-crm-test.com`, so
 * running this repeatedly does not collide on HubSpot's unique email
 * constraint and cannot reach a real mailbox.
 *
 * Run: node src/examples/02-create-contact.js [email] [firstname] [lastname]
 */

const { runOperation } = require('../api/hubSpotApiHandler');

const [email, firstname, lastname] = process.argv.slice(2);

const argumentsForHandler = [
  email || `example-${Date.now()}@example-crm-test.com`,
  firstname || 'Example',
  lastname || 'Contact',
];

runOperation('create-contact', argumentsForHandler).then((exitCode) => process.exit(exitCode));
