#!/usr/bin/env node
'use strict';

/**
 * The whole integration in one run.
 *
 * Creates a contact, creates a deal, associates them, reads everything back to
 * confirm, demonstrates idempotency by repeating the association, and then
 * deletes what it made.
 *
 * This is the script to run first when reviewing the project: it exercises
 * every layer — client, repositories, services, validation, error handling —
 * against a live portal in about ten seconds, and leaves nothing behind.
 *
 * Pass `--keep` to skip the cleanup and inspect the records in HubSpot.
 *
 * Run: node src/examples/full-workflow.js [--keep]
 */

const hubSpotService = require('../services/hubSpotService');
const contactRepository = require('../repositories/contactRepository');
const dealRepository = require('../repositories/dealRepository');
const propertyRepository = require('../repositories/propertyRepository');
const { getHubSpotConfig, OBJECT_TYPES } = require('../config/hubspot.config');
const { HubSpotApiError } = require('../errors/HubSpotApiError');
const { InvalidConfigurationError } = require('../errors/InvalidConfigurationError');

const write = (text) => process.stdout.write(text);
const step = (number, title) => write(`\n${number}. ${title}\n${'-'.repeat(74)}\n`);

const RUN_ID = Date.now();
const keepRecords = process.argv.includes('--keep');

async function main() {
  const config = getHubSpotConfig();

  write('\nHubSpot CRM integration — full workflow\n');
  write('='.repeat(74) + '\n');
  write(`portal   : ${config.portalId || '(HUBSPOT_PORTAL_ID not set)'}\n`);
  write(`pipeline : ${config.defaultPipelineId} / ${config.defaultStageId}\n`);
  write(`cleanup  : ${keepRecords ? 'disabled (--keep)' : 'enabled'}\n`);

  // --- 1 -------------------------------------------------------------------
  step(1, 'Confirm which deal property names this portal actually defines');

  const { aliases, totalDealProperties } = await propertyRepository.verifyDealPropertyNames();
  write(`  This portal defines ${totalDealProperties} deal properties.\n\n`);
  for (const alias of aliases) {
    write(
      `  ${alias.briefName.padEnd(20)} exists: ${String(alias.briefNameExists).padEnd(6)}` +
        ` -> ${alias.actualName.padEnd(12)} exists: ${alias.actualNameExists}\n`
    );
  }
  write(
    '\n  The brief asks for deals carrying hs_pipeline and hs_stage. Those are\n' +
      '  Ticket properties and are absent from the Deal object, so sending them\n' +
      '  verbatim returns 400 PROPERTY_DOESNT_EXIST. validateHubSpotPayload\n' +
      '  accepts either spelling and translates.\n'
  );

  // --- 2 -------------------------------------------------------------------
  step(2, 'Create a contact');

  const contactEmail = `workflow-${RUN_ID}@example-crm-test.com`;
  const contact = await hubSpotService.createHubSpotContact({
    email: contactEmail,
    firstname: 'Workflow',
    lastname: 'Example',
    company: 'Example CRM Test',
  });
  write(`  contact id : ${contact.id}\n`);
  write(`  email      : ${contact.properties.email}\n`);

  // --- 3 -------------------------------------------------------------------
  step(3, "Create a deal, using the brief's property spelling");

  const deal = await hubSpotService.createHubSpotDeal(`Workflow Deal ${RUN_ID}`, 4500.5);
  write(`  deal id    : ${deal.id}\n`);
  write(`  dealname   : ${deal.properties.dealname}\n`);
  write(`  amount     : ${deal.properties.amount}\n`);
  write(`  pipeline   : ${deal.properties.pipeline}   <- sent as hs_pipeline\n`);
  write(`  dealstage  : ${deal.properties.dealstage}   <- sent as hs_stage\n`);

  // --- 4 -------------------------------------------------------------------
  step(4, 'Associate the contact with the deal');

  const firstAssociation = await hubSpotService.associateContactToDeal(contact.id, deal.id);
  write(`  associated        : ${firstAssociation.associated}\n`);
  write(`  alreadyAssociated : ${firstAssociation.alreadyAssociated}\n`);

  // --- 5 -------------------------------------------------------------------
  step(5, 'Repeat the association to show it is idempotent');

  const secondAssociation = await hubSpotService.associateContactToDeal(contact.id, deal.id);
  write(`  alreadyAssociated : ${secondAssociation.alreadyAssociated}\n`);

  const dealIds = await hubSpotService.getDealsForContact(contact.id);
  const linkCount = dealIds.filter((id) => id === deal.id).length;
  write(`  associations to this deal: ${linkCount}\n`);
  write(
    '\n  The endpoint is a PUT, so repeating it cannot create a second link.\n' +
      '  The existence check only changes what is reported, not what happens.\n'
  );

  // --- 6 -------------------------------------------------------------------
  step(6, 'Read both records back, with associations inline');

  const fetchedDeal = await dealRepository.findDealById(deal.id, {
    associations: [OBJECT_TYPES.CONTACTS],
  });
  const associatedIds = (fetchedDeal.associations?.contacts?.results || []).map((entry) =>
    String(entry.id)
  );
  write(`  deal ${fetchedDeal.id} is associated with contacts: ${associatedIds.join(', ')}\n`);

  const fetchedContact = await contactRepository.findContactByEmail(contactEmail);
  write(`  contact read back by email -> id ${fetchedContact.id}\n`);

  // --- 7 -------------------------------------------------------------------
  step(7, 'Update the deal, showing PATCH merges rather than replaces');

  await hubSpotService.updateHubSpotDeal(deal.id, { amount: 5000 });
  const updatedDeal = await dealRepository.findDealById(deal.id);
  write(`  amount     : ${updatedDeal.properties.amount}\n`);
  write(`  dealname   : ${updatedDeal.properties.dealname}  <- untouched\n`);

  // --- 8 -------------------------------------------------------------------
  step(8, 'List contact names, traversing every page');

  const names = await hubSpotService.getHubSpotContactNames({ limit: 10 });
  write(`  first ${names.length} names:\n`);
  for (const name of names) {
    write(`    ${name}\n`);
  }

  // --- 9 -------------------------------------------------------------------
  if (keepRecords) {
    step(9, 'Cleanup skipped');
    write(`  contact ${contact.id} and deal ${deal.id} were left in the portal.\n`);
  } else {
    step(9, 'Clean up');
    const dealRemoval = await hubSpotService.deleteHubSpotDeal(deal.id, {
      confirmExistence: true,
    });
    const contactRemoval = await hubSpotService.deleteHubSpotContact(contact.id, {
      confirmExistence: true,
    });
    write(`  deal ${deal.id}    existed before delete: ${dealRemoval.existedBeforeDelete}\n`);
    write(`  contact ${contact.id} existed before delete: ${contactRemoval.existedBeforeDelete}\n`);
    write('\n  Nothing was left behind.\n');
  }

  write('\n' + '='.repeat(74) + '\n');
  write('Workflow complete.\n\n');
}

main().catch((error) => {
  if (error instanceof HubSpotApiError || error instanceof InvalidConfigurationError) {
    process.stderr.write(`\n${error.toDisplayString()}\n\n`);
  } else {
    process.stderr.write(`\nWorkflow failed: ${error.message}\n${error.stack}\n\n`);
  }
  process.exit(1);
});
