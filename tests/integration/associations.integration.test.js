'use strict';

/**
 * Contact-to-deal associations, end to end against a live HubSpot portal.
 *
 * The brief asks for `associateContactToDeal` "ensuring idempotency where
 * possible", so idempotency is what this suite spends most of its assertions
 * on — including the case that matters operationally: repeating the raw `PUT`
 * with the existence check disabled must still leave exactly one association.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { getEnvironment } = require('../../src/config/env');
const { OBJECT_TYPES, ASSOCIATION_TYPE_IDS } = require('../../src/config/hubspot.config');
const hubSpotService = require('../../src/services/hubSpotService');
const associationRepository = require('../../src/repositories/associationRepository');
const dealRepository = require('../../src/repositories/dealRepository');

const environment = getEnvironment({ requireAccessToken: false });
const writesAreAllowed = environment.allowWriteOperations && environment.accessToken !== '';

const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

/** Records to remove in `after`. */
const createdContactIds = [];
const createdDealIds = [];

/**
 * Creates a contact and a deal, both registered for cleanup.
 *
 * @param {string} label
 * @returns {Promise<{contact: object, deal: object}>}
 */
async function createLinkablePair(label) {
  const contact = await hubSpotService.createHubSpotContact({
    email: `assoc-${label}-${RUN_ID}@example-crm-test.com`,
    firstname: 'Assoc',
    lastname: label,
  });
  createdContactIds.unshift(contact.id);

  const deal = await hubSpotService.createHubSpotDeal(`Assoc Deal ${label} ${RUN_ID}`, 1000);
  createdDealIds.unshift(deal.id);

  return { contact, deal };
}

test(
  'associations integration',
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

    await suite.test('associates a contact with a deal', async () => {
      const { contact, deal } = await createLinkablePair('create');

      const result = await hubSpotService.associateContactToDeal(contact.id, deal.id);

      assert.equal(result.associated, true);
      assert.equal(result.alreadyAssociated, false, 'the first call must report a new link');
      assert.equal(result.contactId, contact.id);
      assert.equal(result.dealId, deal.id);
    });

    await suite.test('the association is visible from both directions', async () => {
      const { contact, deal } = await createLinkablePair('bidirectional');
      await hubSpotService.associateContactToDeal(contact.id, deal.id);

      const dealIds = await hubSpotService.getDealsForContact(contact.id);
      assert.ok(dealIds.includes(deal.id), 'the deal must appear among the contact associations');

      // HubSpot maintains the inverse relationship itself. Asserting it guards
      // against associating in the wrong direction, which would otherwise look
      // successful from the side that created it.
      const inverse = await associationRepository.findAssociations(
        OBJECT_TYPES.DEALS,
        deal.id,
        OBJECT_TYPES.CONTACTS
      );
      assert.ok(inverse.some((entry) => String(entry.toObjectId) === contact.id));
    });

    await suite.test('carries the HubSpot-defined Contact to Deal type', async () => {
      const { contact, deal } = await createLinkablePair('typed');
      await hubSpotService.associateContactToDeal(contact.id, deal.id);

      const associations = await associationRepository.findAssociations(
        OBJECT_TYPES.CONTACTS,
        contact.id,
        OBJECT_TYPES.DEALS
      );
      const link = associations.find((entry) => String(entry.toObjectId) === deal.id);

      assert.ok(link, 'the association must exist');
      // Type 4 is HubSpot's Contact-to-Deal. Asserting it catches a default
      // association silently becoming a differently-typed one.
      const typeIds = (link.associationTypes || []).map((type) => type.typeId);
      assert.ok(
        typeIds.includes(ASSOCIATION_TYPE_IDS.CONTACT_TO_DEAL),
        `expected type ${ASSOCIATION_TYPE_IDS.CONTACT_TO_DEAL}, got ${typeIds.join(', ')}`
      );
    });

    await suite.test(
      'repeating the call reports the existing link rather than a new one',
      async () => {
        const { contact, deal } = await createLinkablePair('idempotent');

        const first = await hubSpotService.associateContactToDeal(contact.id, deal.id);
        const second = await hubSpotService.associateContactToDeal(contact.id, deal.id);

        assert.equal(first.alreadyAssociated, false);
        assert.equal(second.alreadyAssociated, true, 'a repeat must be reported as a repeat');

        // "Safe to repeat" and "honest about what it did" are different
        // properties. A caller synchronising many pairs needs the second.
        const associations = await associationRepository.findAssociations(
          OBJECT_TYPES.CONTACTS,
          contact.id,
          OBJECT_TYPES.DEALS
        );
        const links = associations.filter((entry) => String(entry.toObjectId) === deal.id);
        assert.equal(links.length, 1, 'exactly one association must exist');
      }
    );

    await suite.test('the raw PUT is idempotent even without the existence check', async () => {
      const { contact, deal } = await createLinkablePair('rawput');

      // This is where the requirement is genuinely satisfied. The existence
      // check is a convenience for reporting; correctness comes from the method
      // itself, which is what makes a retry after an unknown outcome safe.
      await hubSpotService.associateContactToDeal(contact.id, deal.id, {
        skipExistingCheck: true,
      });
      await hubSpotService.associateContactToDeal(contact.id, deal.id, {
        skipExistingCheck: true,
      });
      await hubSpotService.associateContactToDeal(contact.id, deal.id, {
        skipExistingCheck: true,
      });

      const associations = await associationRepository.findAssociations(
        OBJECT_TYPES.CONTACTS,
        contact.id,
        OBJECT_TYPES.DEALS
      );
      const links = associations.filter((entry) => String(entry.toObjectId) === deal.id);

      assert.equal(links.length, 1, 'three PUTs must leave exactly one association');
    });

    await suite.test('a deal can be read back with its associations inline', async () => {
      const { contact, deal } = await createLinkablePair('inline');
      await hubSpotService.associateContactToDeal(contact.id, deal.id);

      // Requesting associations with the record avoids a second round trip,
      // which matters when reading many deals.
      const fetched = await dealRepository.findDealById(deal.id, {
        associations: [OBJECT_TYPES.CONTACTS],
      });

      const associatedContactIds = (fetched.associations?.contacts?.results || []).map((entry) =>
        String(entry.id)
      );
      assert.ok(associatedContactIds.includes(contact.id));
    });

    await suite.test('the association can be removed', async () => {
      const { contact, deal } = await createLinkablePair('remove');
      await hubSpotService.associateContactToDeal(contact.id, deal.id);

      const removal = await hubSpotService.dissociateContactFromDeal(contact.id, deal.id);
      assert.equal(removal.removed, true);

      const stillAssociated = await associationRepository.isAssociated(
        OBJECT_TYPES.CONTACTS,
        contact.id,
        OBJECT_TYPES.DEALS,
        deal.id
      );
      assert.equal(stillAssociated, false);
    });

    await suite.test('associating rejects a malformed record id before calling out', async () => {
      await assert.rejects(
        () => hubSpotService.associateContactToDeal('not-an-id', '12345'),
        /numeric HubSpot record id/
      );
    });
  }
);
