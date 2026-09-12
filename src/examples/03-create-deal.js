#!/usr/bin/env node
'use strict';

/**
 * Section 2.2 — Create a new deal.
 *
 * "Implement createHubSpotDeal(dealName, amount) making a real POST to
 * /crm/v3/objects/deals with properties.dealname, properties.amount,
 * hs_pipeline, hs_stage. Allow passing pipeline/stage via env vars."
 *
 * Pipeline and stage come from `HUBSPOT_PIPELINE_ID` and `HUBSPOT_STAGE_ID`.
 * Run `npm run probe` to discover the valid ids for your portal.
 *
 * Note what the output shows: the request carries `hs_pipeline` and `hs_stage`,
 * the spelling the brief specifies, and the created record comes back with
 * `pipeline` and `dealstage`. Those two are Ticket properties and do not exist
 * on the Deal object, so `validateHubSpotPayload` translates them. Without that
 * the call returns `400 PROPERTY_DOESNT_EXIST`.
 *
 * Run: node src/examples/03-create-deal.js [dealName] [amount]
 */

const { runOperation } = require('../api/hubSpotApiHandler');

const [dealName, amount] = process.argv.slice(2);

runOperation('create-deal', [dealName || `Example Deal ${Date.now()}`, amount || '1500.00']).then(
  (exitCode) => process.exit(exitCode)
);
