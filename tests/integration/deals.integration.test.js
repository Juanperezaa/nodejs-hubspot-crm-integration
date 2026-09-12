'use strict';

/**
 * Deals, pipelines and properties, end to end against a live HubSpot portal.
 *
 * Real API calls, as the brief requires. Guarded by `HUBSPOT_ALLOW_WRITE` and
 * cleaning up in `after()` regardless of outcome, exactly as the contacts
 * suite does.
 *
 * The first test in this file is the important one: it asks the portal which
 * deal property names exist, and so turns the central finding of this project
 * from a reading of the documentation into a measurement.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { getEnvironment } = require('../../src/config/env');
const { getHubSpotConfig } = require('../../src/config/hubspot.config');
const hubSpotService = require('../../src/services/hubSpotService');
const dealRepository = require('../../src/repositories/dealRepository');
const pipelineRepository = require('../../src/repositories/pipelineRepository');
const propertyRepository = require('../../src/repositories/propertyRepository');
const { HubSpotApiError, FAILURE_KINDS } = require('../../src/errors/HubSpotApiError');

const environment = getEnvironment({ requireAccessToken: false });
const writesAreAllowed = environment.allowWriteOperations && environment.accessToken !== '';

const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const testDealName = (label) => `IT Deal ${label} ${RUN_ID}`;

/** Record ids to remove in `after`, newest first. */
const createdDealIds = [];

/**
 * Creates a deal and registers it for cleanup in the same step.
 *
 * @param {string} dealName
 * @param {number|string} amount
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function createTrackedDeal(dealName, amount, options = {}) {
  const created = await hubSpotService.createHubSpotDeal(dealName, amount, options);
  createdDealIds.unshift(created.id);
  return created;
}

test(
  'deals integration',
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
    });

    // -----------------------------------------------------------------------
    // Properties — the measurement behind decision D5
    // -----------------------------------------------------------------------

    await suite.test("the brief's deal property names do not exist in the portal", async () => {
      const { aliases, totalDealProperties } = await propertyRepository.verifyDealPropertyNames();

      assert.ok(totalDealProperties > 100, 'a real portal defines many deal properties');

      for (const alias of aliases) {
        // Every name the brief uses is absent, and every name it translates to
        // is present. That is the whole justification for the alias layer, and
        // it is asserted against the portal rather than argued from docs.
        assert.equal(
          alias.briefNameExists,
          false,
          `${alias.briefName} should not exist on the Deal object`
        );
        assert.equal(
          alias.actualNameExists,
          true,
          `${alias.actualName} should exist on the Deal object`
        );
        assert.equal(alias.translationRequired, true);
      }
    });

    await suite.test('reports which requested properties are undefined', async () => {
      const { existing, missing } = await propertyRepository.checkPropertiesExist('deals', [
        'dealname',
        'amount',
        'hs_stage',
        'definitely_not_a_property',
      ]);

      assert.deepEqual(existing.sort(), ['amount', 'dealname']);
      assert.deepEqual(missing.sort(), ['definitely_not_a_property', 'hs_stage']);
    });

    // -----------------------------------------------------------------------
    // Pipelines
    // -----------------------------------------------------------------------

    await suite.test('reads pipelines with their stages in display order', async () => {
      const pipelines = await pipelineRepository.findPipelines();

      assert.ok(pipelines.length > 0, 'every portal has at least one deal pipeline');

      const [firstPipeline] = pipelines;
      assert.ok(firstPipeline.id);
      assert.ok(firstPipeline.stages.length > 0);

      const displayOrders = firstPipeline.stages.map((stage) => stage.displayOrder);
      assert.deepEqual(
        displayOrders,
        [...displayOrders].sort((first, second) => first - second),
        'stages must be returned in the order the interface shows them'
      );
    });

    await suite.test('the configured pipeline and stage exist', async () => {
      const config = getHubSpotConfig();

      const { pipeline, stage } = await pipelineRepository.assertPipelineAndStageExist(
        config.defaultPipelineId,
        config.defaultStageId
      );

      assert.equal(pipeline.id, config.defaultPipelineId);
      assert.equal(stage.id, config.defaultStageId);
    });

    await suite.test('an unknown stage is rejected before the request is sent', async () => {
      // HubSpot's own rejection names the property rather than the value, so it
      // reads as though `dealstage` were wrong. This check names the value and
      // lists the ones that would work.
      await assert.rejects(
        () => pipelineRepository.assertPipelineAndStageExist('default', 'Closed Won'),
        (error) => {
          assert.ok(error instanceof HubSpotApiError);
          assert.equal(error.kind, FAILURE_KINDS.VALIDATION);
          assert.match(error.message, /Closed Won/);
          assert.match(error.validationErrors[0].message, /Available stages/);
          return true;
        }
      );
    });

    // -----------------------------------------------------------------------
    // Deal operations
    // -----------------------------------------------------------------------

    await suite.test("createHubSpotDeal accepts the brief's exact signature", async () => {
      // createHubSpotDeal(dealName, amount) with pipeline and stage taken from
      // environment variables, exactly as Section 2.2 specifies.
      const created = await createTrackedDeal(testDealName('signature'), 1500);

      assert.match(created.id, /^\d+$/);
      assert.equal(created.properties.dealname, testDealName('signature'));
      assert.equal(created.properties.amount, '1500');

      // The request went out carrying hs_pipeline and hs_stage; HubSpot stored
      // pipeline and dealstage. That is the alias layer working end to end.
      const config = getHubSpotConfig();
      assert.equal(created.properties.pipeline, config.defaultPipelineId);
      assert.equal(created.properties.dealstage, config.defaultStageId);
    });

    await suite.test('a deal can be created with an explicit pipeline and stage', async () => {
      const pipelines = await pipelineRepository.findPipelines();
      const pipeline = pipelines[0];
      const lastStage = pipeline.stages[pipeline.stages.length - 1];

      const created = await createTrackedDeal(testDealName('explicit'), '2750.50', {
        pipeline: pipeline.id,
        stage: lastStage.id,
        additionalProperties: { description: 'Created by the integration suite' },
      });

      assert.equal(created.properties.dealstage, lastStage.id);
      assert.equal(created.properties.amount, '2750.5');
    });

    await suite.test('getHubSpotDeals pages with a cursor', async () => {
      await createTrackedDeal(testDealName('listing'), 100);

      const firstPage = await hubSpotService.getHubSpotDeals({ limit: 1 });

      assert.equal(firstPage.results.length, 1);
      assert.equal(typeof firstPage.hasMore, 'boolean');

      if (firstPage.hasMore) {
        const secondPage = await hubSpotService.getHubSpotDeals({
          limit: 1,
          after: firstPage.nextCursor,
        });
        assert.notEqual(secondPage.results[0].id, firstPage.results[0].id);
      }
    });

    await suite.test('updateHubSpotDeal merges rather than replaces', async () => {
      const created = await createTrackedDeal(testDealName('update'), 500, {
        additionalProperties: { description: 'Original description' },
      });

      const updated = await hubSpotService.updateHubSpotDeal(created.id, { amount: 999 });
      assert.equal(updated.properties.amount, '999');

      const fetched = await dealRepository.findDealById(created.id);
      assert.equal(fetched.properties.description, 'Original description');
      assert.equal(fetched.properties.dealname, testDealName('update'));
    });

    await suite.test("updateHubSpotDeal accepts the brief's property spelling", async () => {
      const created = await createTrackedDeal(testDealName('stagechange'), 250);

      const pipelines = await pipelineRepository.findPipelines();
      const targetStage = pipelines[0].stages[1];

      // hs_stage in, dealstage stored.
      const updated = await hubSpotService.updateHubSpotDeal(created.id, {
        hs_stage: targetStage.id,
      });

      assert.equal(updated.properties.dealstage, targetStage.id);
    });

    await suite.test(
      'the Search API is eventually consistent; the list endpoint is not',
      async () => {
        // This test exists because it overturned a design decision.
        //
        // `syncDealsWithHubSpot` was to correlate existing deals by searching on
        // `dealname`. Measured against a live portal, a newly created deal takes
        // roughly seven seconds to appear in the Search index — 6766 ms in one
        // run, still absent at 5406 ms. A sync using search would therefore fail
        // to find a deal it had just created and would duplicate it on any run
        // inside that window.
        //
        // Reads that go to the primary store are immediately consistent, so
        // correlation now builds its index from the list endpoint instead.
        // Decision D14, superseding D11.
        const dealName = testDealName('consistency');
        const created = await createTrackedDeal(dealName, 777);

        // Immediately consistent: a direct read by id.
        const direct = await dealRepository.findDealById(created.id);
        assert.equal(direct.id, created.id, 'a read by id must reflect the write at once');

        // Immediately consistent: the list endpoint, which is what the sync uses.
        let foundInList = false;
        for await (const deal of dealRepository.streamDeals({ properties: ['dealname'] })) {
          if (deal.id === created.id) {
            foundInList = true;
            break;
          }
        }
        assert.equal(foundInList, true, 'the list endpoint must reflect the write at once');

        // Eventually consistent: search. Polled rather than asserted outright,
        // because the exact latency is HubSpot's to vary and pinning it would
        // make this test flaky in both directions.
        const startedAt = Date.now();
        let searchMatches = [];
        while (searchMatches.length === 0 && Date.now() - startedAt < 30000) {
          searchMatches = await dealRepository.searchDealsByProperty('dealname', dealName);
          if (searchMatches.length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }

        assert.equal(
          searchMatches.length,
          1,
          'search must find the deal once the index catches up'
        );
        assert.equal(searchMatches[0].id, created.id);
      }
    );

    await suite.test('rejects an invalid amount before sending it', async () => {
      await assert.rejects(
        () => hubSpotService.createHubSpotDeal(testDealName('bad'), 'free'),
        (error) => {
          assert.ok(error instanceof HubSpotApiError);
          assert.equal(error.kind, FAILURE_KINDS.VALIDATION);
          assert.equal(error.isRetryable, false);
          return true;
        }
      );
    });

    await suite.test('deleting a deal is idempotent', async () => {
      const created = await hubSpotService.createHubSpotDeal(testDealName('delete'), 42);

      const firstDelete = await hubSpotService.deleteHubSpotDeal(created.id, {
        confirmExistence: true,
      });
      assert.equal(firstDelete.archived, true);
      assert.equal(firstDelete.existedBeforeDelete, true);

      const secondDelete = await hubSpotService.deleteHubSpotDeal(created.id, {
        confirmExistence: true,
      });
      assert.equal(secondDelete.existedBeforeDelete, false, 'the record is gone from the CRM');
    });
  }
);
