'use strict';

/**
 * Contacts, end to end against a live HubSpot portal.
 *
 * These are **real API calls**, which the brief requires: "Mocks or simulations
 * for HubSpot calls are not allowed."
 *
 * Two safeguards, because these tests mutate a real CRM:
 *
 *   - They refuse to run unless `HUBSPOT_ALLOW_WRITE=true` is set explicitly.
 *     A missing or ambiguous value fails closed.
 *   - Every record created is registered for deletion the moment it exists, and
 *     cleanup runs in `after()` regardless of whether the test passed. A failing
 *     assertion must not leave debris in the portal.
 *
 * Records use a run-scoped email so that concurrent or repeated runs cannot
 * collide, and so that anything left behind by a crash is identifiable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { getEnvironment } = require('../../src/config/env');
const hubSpotService = require('../../src/services/hubSpotService');
const contactRepository = require('../../src/repositories/contactRepository');
const { HubSpotApiError, FAILURE_KINDS } = require('../../src/errors/HubSpotApiError');

const environment = getEnvironment({ requireAccessToken: false });

/** Guard: these tests create and delete real records. */
const writesAreAllowed = environment.allowWriteOperations && environment.accessToken !== '';

/** Identifies every record this run creates, so cleanup and triage are unambiguous. */
const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const testEmail = (label) => `it-${label}-${RUN_ID}@example-crm-test.com`;

/** Record ids to remove in `after`, newest first. */
const createdContactIds = [];

/**
 * Creates a contact and registers it for cleanup in the same step.
 *
 * Registering separately invites the failure where a test creates a record and
 * then fails before registering it, leaving it in the portal forever.
 *
 * @param {Record<string, unknown>} properties
 * @returns {Promise<object>}
 */
async function createTrackedContact(properties) {
  const created = await hubSpotService.createHubSpotContact(properties);
  createdContactIds.unshift(created.id);
  return created;
}

test(
  'contacts integration',
  { skip: writesAreAllowed ? false : 'HUBSPOT_ALLOW_WRITE is not true' },
  async (suite) => {
    suite.after(async () => {
      // Cleanup must survive its own failures: one undeletable record should not
      // strand the rest.
      for (const contactId of createdContactIds) {
        try {
          await hubSpotService.deleteHubSpotContact(contactId);
        } catch (error) {
          process.stderr.write(`cleanup failed for contact ${contactId}: ${error.message}\n`);
        }
      }
    });

    await suite.test('creates a contact and returns its record id', async () => {
      const created = await createTrackedContact({
        email: testEmail('create'),
        firstname: 'Integration',
        lastname: 'Create',
        company: 'Example CRM Test',
      });

      assert.match(created.id, /^\d+$/, 'HubSpot record ids are numeric strings');
      assert.equal(created.properties.email, testEmail('create'));
      assert.equal(created.properties.firstname, 'Integration');
    });

    await suite.test('reads the contact back by id', async () => {
      const created = await createTrackedContact({
        email: testEmail('read'),
        firstname: 'Integration',
        lastname: 'Read',
      });

      const fetched = await contactRepository.findContactById(created.id);

      assert.equal(fetched.id, created.id);
      assert.equal(fetched.properties.email, testEmail('read'));
    });

    await suite.test('reads the contact back by email without a search request', async () => {
      const created = await createTrackedContact({
        email: testEmail('byemail'),
        firstname: 'Integration',
        lastname: 'ByEmail',
      });

      // idProperty lets a unique property stand in for the record id, which
      // avoids spending a Search request against its much tighter limit.
      const fetched = await contactRepository.findContactByEmail(testEmail('byemail'));

      assert.equal(fetched.id, created.id);
    });

    await suite.test('updates properties without clearing the others', async () => {
      const created = await createTrackedContact({
        email: testEmail('update'),
        firstname: 'Integration',
        lastname: 'Update',
        company: 'Original Company',
        jobtitle: 'Original Title',
      });

      const updated = await hubSpotService.updateHubSpotContact(created.id, {
        jobtitle: 'Revised Title',
      });

      assert.equal(updated.properties.jobtitle, 'Revised Title');

      // The point of PATCH over PUT: a partial payload must leave the rest alone.
      const fetched = await contactRepository.findContactById(created.id);
      assert.equal(fetched.properties.company, 'Original Company');
      assert.equal(fetched.properties.firstname, 'Integration');
    });

    await suite.test('getHubSpotContactNames returns names, paginated', async () => {
      await createTrackedContact({
        email: testEmail('names'),
        firstname: 'Namey',
        lastname: 'McNameface',
      });

      const names = await hubSpotService.getHubSpotContactNames();

      assert.ok(Array.isArray(names));
      assert.ok(names.includes('Namey McNameface'), 'the created contact must appear');
      // Nameless contacts are excluded by default, so no entry may be blank.
      assert.equal(
        names.some((name) => name.trim() === ''),
        false,
        'blank entries are not names'
      );
    });

    await suite.test('getHubSpotContacts pages with a cursor', async () => {
      const firstPage = await hubSpotService.getHubSpotContacts({ limit: 1 });

      assert.equal(firstPage.results.length, 1);
      assert.equal(typeof firstPage.hasMore, 'boolean');

      if (firstPage.hasMore) {
        const secondPage = await hubSpotService.getHubSpotContacts({
          limit: 1,
          after: firstPage.nextCursor,
        });
        assert.equal(secondPage.results.length, 1);
        assert.notEqual(
          secondPage.results[0].id,
          firstPage.results[0].id,
          'the cursor must advance rather than repeat the first record'
        );
      }
    });

    await suite.test('getHubSpotContacts filters by property', async () => {
      const created = await createTrackedContact({
        email: testEmail('filter'),
        firstname: 'Filterable',
        lastname: 'Contact',
      });

      const filtered = await hubSpotService.getHubSpotContacts({
        filter: { propertyName: 'email', value: testEmail('filter') },
      });

      assert.equal(filtered.results.length, 1);
      assert.equal(filtered.results[0].id, created.id);
    });

    await suite.test('rejects a duplicate email the way HubSpot does', async () => {
      const email = testEmail('duplicate');
      await createTrackedContact({ email, firstname: 'First', lastname: 'Instance' });

      // Email is uniquely constrained, so this must fail rather than silently
      // creating a second record. A 409 is a validation failure and must not be
      // retried.
      await assert.rejects(
        () => hubSpotService.createHubSpotContact({ email, firstname: 'Second' }),
        (error) => {
          assert.ok(error instanceof HubSpotApiError);
          assert.equal(error.kind, FAILURE_KINDS.VALIDATION);
          assert.equal(error.isRetryable, false);
          return true;
        }
      );
    });

    await suite.test('deleting is idempotent, and HubSpot never reports a 404', async () => {
      const created = await hubSpotService.createHubSpotContact({
        email: testEmail('delete'),
        firstname: 'Integration',
        lastname: 'Delete',
      });

      const firstDelete = await hubSpotService.deleteHubSpotContact(created.id, {
        confirmExistence: true,
      });
      assert.equal(firstDelete.archived, true);
      assert.equal(firstDelete.existedBeforeDelete, true);

      // Repeating it succeeds rather than 404ing. This is what lets cleanup run
      // twice without special-casing, and it is measured rather than assumed:
      // an earlier version of this test expected a 404 here and was wrong.
      const secondDelete = await hubSpotService.deleteHubSpotContact(created.id);
      assert.equal(secondDelete.archived, true);

      // And the record really is gone from the CRM, which is what "archived"
      // means -- so a caller who asks can still learn that.
      const thirdDelete = await hubSpotService.deleteHubSpotContact(created.id, {
        confirmExistence: true,
      });
      assert.equal(thirdDelete.existedBeforeDelete, false);
    });

    await suite.test('deleting an id that never existed also succeeds', async () => {
      // HubSpot's delete is unconditionally idempotent: it accepts an id with
      // no record behind it at all. The API therefore cannot tell a caller
      // whether anything was removed, which is why deleteHubSpotContact
      // reports acceptance rather than claiming a deletion occurred.
      const result = await hubSpotService.deleteHubSpotContact('99999999999999');

      assert.equal(result.archived, true);
      assert.equal(
        result.existedBeforeDelete,
        undefined,
        'existence must not be claimed when it was never checked'
      );
    });

    await suite.test('upserts by email idempotently', async () => {
      const email = testEmail('upsert');

      const firstRun = await contactRepository.upsertContactsByEmail([
        { email, firstname: 'Upsert', lastname: 'First' },
      ]);
      assert.equal(firstRun.results.length, 1);
      createdContactIds.unshift(firstRun.results[0].id);

      const secondRun = await contactRepository.upsertContactsByEmail([
        { email, firstname: 'Upsert', lastname: 'Second' },
      ]);

      // The same record, updated -- not a duplicate. This is the property the
      // whole synchronisation design rests on.
      assert.equal(secondRun.results[0].id, firstRun.results[0].id);
      assert.equal(secondRun.results[0].properties.lastname, 'Second');
    });
  }
);
