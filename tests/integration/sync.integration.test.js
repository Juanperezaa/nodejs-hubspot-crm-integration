'use strict';

/**
 * Synchronisation, end to end against a live HubSpot portal.
 *
 * The brief asks for "idempotent create/update", and idempotency is not a
 * property that can be asserted from a single run. Every test here runs the
 * sync **twice** and checks that the second run updates what the first created
 * rather than duplicating it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { getEnvironment } = require('../../src/config/env');
const { OBJECT_TYPES } = require('../../src/config/hubspot.config');
const { syncContactsWithHubSpot } = require('../../src/services/contactSyncService');
const { syncDealsWithHubSpot, buildDealNameIndex } = require('../../src/services/dealSyncService');
const hubSpotService = require('../../src/services/hubSpotService');
const contactRepository = require('../../src/repositories/contactRepository');
const associationRepository = require('../../src/repositories/associationRepository');

const environment = getEnvironment({ requireAccessToken: false });
const writesAreAllowed = environment.allowWriteOperations && environment.accessToken !== '';

const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

const createdContactIds = new Set();
const createdDealIds = new Set();

/** Source records scoped to this run, so repeated runs cannot collide. */
const contactSource = [
  {
    email: `sync-one-${RUN_ID}@example-crm-test.com`,
    firstname: 'Sync',
    lastname: 'One',
    company: 'Original Company',
  },
  {
    email: `sync-two-${RUN_ID}@example-crm-test.com`,
    firstname: 'Sync',
    lastname: 'Two',
  },
];

const dealSource = [
  {
    dealname: `Sync Deal Alpha ${RUN_ID}`,
    amount: '1000.00',
    contactEmail: contactSource[0].email,
  },
  {
    dealname: `Sync Deal Beta ${RUN_ID}`,
    amount: '2000.00',
  },
];

test(
  'synchronisation integration',
  { skip: writesAreAllowed ? false : 'HUBSPOT_ALLOW_WRITE is not true' },
  async (suite) => {
    suite.after(async () => {
      for (const dealId of createdDealIds) {
        try {
          await hubSpotService.deleteHubSpotDeal(dealId);
        } catch (error) {
          process.stderr.write(`cleanup failed for deal ${dealId}: ${error.message}\n`);
        }
      }
      for (const contactId of createdContactIds) {
        try {
          await hubSpotService.deleteHubSpotContact(contactId);
        } catch (error) {
          process.stderr.write(`cleanup failed for contact ${contactId}: ${error.message}\n`);
        }
      }
    });

    // -----------------------------------------------------------------------
    // Contacts
    // -----------------------------------------------------------------------

    await suite.test('a dry run reports without writing anything', async () => {
      const report = await syncContactsWithHubSpot(contactSource, { dryRun: true });

      assert.equal(report.created, 2);
      assert.equal(report.updated, 0);
      assert.equal(report.failed, 0);

      // Nothing may exist yet: a dry run that writes is worse than no dry run.
      await assert.rejects(() => contactRepository.findContactByEmail(contactSource[0].email));
    });

    await suite.test('the first run creates every contact', async () => {
      const report = await syncContactsWithHubSpot(contactSource);

      assert.equal(report.created, 2, 'both contacts are new');
      assert.equal(report.updated, 0);
      assert.equal(report.failed, 0);

      for (const entry of report.records) {
        createdContactIds.add(entry.id);
      }
    });

    await suite.test('the second run updates rather than duplicating', async () => {
      // This is the requirement. The counts flipping from created to updated is
      // what "idempotent create/update" means in practice.
      const report = await syncContactsWithHubSpot(contactSource);

      assert.equal(report.created, 0, 'nothing should be created on a repeat run');
      assert.equal(report.updated, 2);
      assert.equal(report.failed, 0);

      // And the portal agrees: one record per address, not two.
      const matches = await contactRepository.searchContactsByProperty(
        'email',
        contactSource[0].email
      );
      assert.equal(matches.length, 1, 'exactly one contact must exist for the address');
    });

    await suite.test('a changed source value reaches the existing record', async () => {
      const changed = [{ ...contactSource[0], company: 'Revised Company' }];

      const report = await syncContactsWithHubSpot(changed);
      assert.equal(report.updated, 1);

      const contact = await contactRepository.findContactByEmail(contactSource[0].email);
      assert.equal(contact.properties.company, 'Revised Company');
    });

    await suite.test('an invalid record is reported without stopping the run', async () => {
      const mixed = [
        { email: `sync-valid-${RUN_ID}@example-crm-test.com`, firstname: 'Valid' },
        { firstname: 'No Email At All' },
        { email: 'not-an-address', firstname: 'Malformed' },
      ];

      const report = await syncContactsWithHubSpot(mixed);

      // One good record in three must still be written. Aborting the batch
      // would make a single typo in a source file discard everything.
      assert.equal(report.created, 1);
      assert.equal(report.failed, 2);
      assert.equal(report.errors.length, 2);

      for (const entry of report.records) {
        createdContactIds.add(entry.id);
      }
    });

    // -----------------------------------------------------------------------
    // Deals
    // -----------------------------------------------------------------------

    await suite.test('the correlation index is built from the list endpoint', async () => {
      const { index, scanned } = await buildDealNameIndex();

      assert.ok(scanned >= 0);
      assert.ok(index instanceof Map);
    });

    await suite.test('the first deal run creates, the second updates', async () => {
      const firstRun = await syncDealsWithHubSpot(dealSource);

      assert.equal(firstRun.created, 2);
      assert.equal(firstRun.updated, 0);
      assert.equal(firstRun.failed, 0);
      for (const entry of firstRun.records) {
        createdDealIds.add(entry.id);
      }

      // The list endpoint is immediately consistent, so the second run sees
      // what the first wrote with no waiting. Correlating through the Search
      // API would have duplicated both deals here — that is decision D14,
      // exercised rather than described.
      const secondRun = await syncDealsWithHubSpot(dealSource);

      assert.equal(secondRun.created, 0, 'a repeat run must not create duplicates');
      assert.equal(secondRun.updated, 2);
      assert.equal(secondRun.failed, 0);

      // The same records, not new ones.
      const firstIds = new Set(firstRun.records.map((entry) => entry.id));
      for (const entry of secondRun.records) {
        assert.ok(firstIds.has(entry.id), `${entry.record} should have reused its existing record`);
      }
    });

    await suite.test('a changed amount reaches the existing deal', async () => {
      const changed = [{ ...dealSource[1], amount: '3500.75' }];

      const report = await syncDealsWithHubSpot(changed);
      assert.equal(report.updated, 1);
      assert.equal(report.created, 0);

      const { index } = await buildDealNameIndex();
      assert.equal(index.get(dealSource[1].dealname).properties.amount, '3500.75');
    });

    await suite.test('deals are associated with the contact named in the source', async () => {
      const contact = await contactRepository.findContactByEmail(contactSource[0].email);
      const { index } = await buildDealNameIndex();
      const deal = index.get(dealSource[0].dealname);

      assert.ok(deal, 'the deal must exist by now');

      const isLinked = await associationRepository.isAssociated(
        OBJECT_TYPES.CONTACTS,
        contact.id,
        OBJECT_TYPES.DEALS,
        deal.id
      );
      assert.equal(isLinked, true, 'contactEmail in the source must produce an association');
    });

    await suite.test('re-running does not duplicate the association either', async () => {
      await syncDealsWithHubSpot(dealSource);

      const contact = await contactRepository.findContactByEmail(contactSource[0].email);
      const { index } = await buildDealNameIndex();
      const deal = index.get(dealSource[0].dealname);

      const associations = await associationRepository.findAssociations(
        OBJECT_TYPES.CONTACTS,
        contact.id,
        OBJECT_TYPES.DEALS
      );
      const links = associations.filter((entry) => String(entry.toObjectId) === deal.id);

      assert.equal(links.length, 1);
    });

    await suite.test('a deal naming an unknown contact still syncs', async () => {
      const orphan = [
        {
          dealname: `Sync Deal Orphan ${RUN_ID}`,
          amount: '50.00',
          contactEmail: `nobody-${RUN_ID}@example-crm-test.com`,
        },
      ];

      const report = await syncDealsWithHubSpot(orphan);

      // The deal was written correctly; only the relationship could not be
      // made. Reporting that as a failure would misrepresent what happened.
      assert.equal(report.created, 1);
      assert.equal(report.failed, 0);

      for (const entry of report.records) {
        createdDealIds.add(entry.id);
      }
    });

    await suite.test('a source deal without a name is reported, not thrown', async () => {
      const report = await syncDealsWithHubSpot([{ amount: '10.00' }]);

      assert.equal(report.failed, 1);
      assert.equal(report.created, 0);
      assert.match(report.errors[0].reason, /dealname/);
    });
  }
);
