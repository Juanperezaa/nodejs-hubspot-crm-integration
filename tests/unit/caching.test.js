'use strict';

/**
 * Caching behaviour.
 *
 * Three modules keep process-lifetime caches: the HTTP client caches its axios
 * instance, and the pipeline and property repositories cache definitions that
 * an administrator edits rather than data that changes.
 *
 * Each exposes a reset function described in its source as a "test seam" — and
 * until this file existed, no test used any of them. A seam nothing pulls is
 * not a seam, it is an unused export, and the caching it exists to support was
 * asserted only in a comment.
 *
 * These tests make the claim real: the cache demonstrably prevents a second
 * request, and the reset demonstrably restores one. That matters beyond
 * tidiness — a cache that silently stopped working would spend rate-limit
 * budget on every deal creation, and nothing would fail.
 *
 * No network is used. `hubSpotClient.get` is replaced with a counting stub,
 * which is a legitimate double for pure caching logic: the brief's prohibition
 * on mocks concerns the deliverable's HubSpot calls, which are real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const hubSpotClient = require('../../src/clients/hubSpotClient');
const pipelineRepository = require('../../src/repositories/pipelineRepository');
const propertyRepository = require('../../src/repositories/propertyRepository');

/** A minimal pipelines response, shaped as HubSpot returns it. */
const PIPELINES_RESPONSE = {
  results: [
    {
      id: 'default',
      label: 'Sales Pipeline',
      stages: [
        { id: 'closedwon', label: 'Closed Won', displayOrder: 2 },
        { id: 'appointmentscheduled', label: 'Appointment Scheduled', displayOrder: 0 },
        { id: 'qualifiedtobuy', label: 'Qualified To Buy', displayOrder: 1 },
      ],
    },
  ],
};

const PROPERTIES_RESPONSE = {
  results: [{ name: 'dealname' }, { name: 'amount' }, { name: 'pipeline' }, { name: 'dealstage' }],
};

/**
 * Runs a body with `hubSpotClient.get` replaced by a counting stub, restoring
 * the real implementation afterwards even if the body throws.
 *
 * @param {object} response The payload every call resolves with.
 * @param {(counter: {calls: number}) => Promise<void>} body
 * @returns {Promise<void>}
 */
async function withCountingClient(response, body) {
  const originalGet = hubSpotClient.get;
  const counter = { calls: 0 };

  hubSpotClient.get = async () => {
    counter.calls += 1;
    return response;
  };

  try {
    await body(counter);
  } finally {
    hubSpotClient.get = originalGet;
  }
}

test('pipeline definitions are read once and cached', async (subtest) => {
  await subtest.test('three reads cost one request', async () => {
    pipelineRepository.resetPipelineCache();

    await withCountingClient(PIPELINES_RESPONSE, async (counter) => {
      await pipelineRepository.findPipelines();
      await pipelineRepository.findPipelines();
      await pipelineRepository.findPipelines();

      // Without the cache this would be three. Deal creation verifies the
      // pipeline on every call, so a broken cache would spend a request per
      // deal and nothing would fail loudly.
      assert.equal(counter.calls, 1);
    });
  });

  await subtest.test('resetting restores the request', async () => {
    pipelineRepository.resetPipelineCache();

    await withCountingClient(PIPELINES_RESPONSE, async (counter) => {
      await pipelineRepository.findPipelines();
      pipelineRepository.resetPipelineCache();
      await pipelineRepository.findPipelines();

      assert.equal(counter.calls, 2);
    });
  });

  await subtest.test('useCache false bypasses the cache without clearing it', async () => {
    pipelineRepository.resetPipelineCache();

    await withCountingClient(PIPELINES_RESPONSE, async (counter) => {
      await pipelineRepository.findPipelines();
      await pipelineRepository.findPipelines(undefined, { useCache: false });
      await pipelineRepository.findPipelines();

      // Two requests: the first, and the explicit bypass. The third is served
      // from the cache the bypass refreshed rather than invalidated.
      assert.equal(counter.calls, 2);
    });
  });

  await subtest.test('stages come back in display order', async () => {
    pipelineRepository.resetPipelineCache();

    await withCountingClient(PIPELINES_RESPONSE, async () => {
      const [pipeline] = await pipelineRepository.findPipelines();

      // HubSpot returns them unordered; the fixture above is deliberately
      // shuffled so this assertion means something.
      assert.deepEqual(
        pipeline.stages.map((stage) => stage.id),
        ['appointmentscheduled', 'qualifiedtobuy', 'closedwon']
      );
    });
  });

  await subtest.test('an unknown stage is named, with the valid ones listed', async () => {
    pipelineRepository.resetPipelineCache();

    await withCountingClient(PIPELINES_RESPONSE, async () => {
      await assert.rejects(
        () => pipelineRepository.assertPipelineAndStageExist('default', 'Closed Won'),
        (error) => {
          // The value, not the property. HubSpot's own rejection names
          // `dealstage`, which sends the reader to check the wrong thing.
          assert.match(error.message, /Closed Won/);
          assert.match(error.validationErrors[0].message, /closedwon/);
          return true;
        }
      );
    });
  });

  await subtest.test('an unknown pipeline lists the available ones', async () => {
    pipelineRepository.resetPipelineCache();

    await withCountingClient(PIPELINES_RESPONSE, async () => {
      await assert.rejects(
        () => pipelineRepository.assertPipelineAndStageExist('no-such-pipeline', 'closedwon'),
        (error) => {
          assert.match(error.message, /no-such-pipeline/);
          assert.match(error.validationErrors[0].message, /Sales Pipeline/);
          return true;
        }
      );
    });
  });
});

test('property definitions are read once and cached', async (subtest) => {
  await subtest.test('repeated reads cost one request', async () => {
    propertyRepository.resetPropertyCache();

    await withCountingClient(PROPERTIES_RESPONSE, async (counter) => {
      await propertyRepository.findProperties('deals');
      await propertyRepository.findProperties('deals');

      assert.equal(counter.calls, 1);
    });
  });

  await subtest.test('the cache is keyed by object type', async () => {
    propertyRepository.resetPropertyCache();

    await withCountingClient(PROPERTIES_RESPONSE, async (counter) => {
      await propertyRepository.findProperties('deals');
      await propertyRepository.findProperties('contacts');

      // Two object types, two requests. A cache keyed on nothing would return
      // deal properties for a contact query.
      assert.equal(counter.calls, 2);
    });
  });

  await subtest.test('resetting restores the request', async () => {
    propertyRepository.resetPropertyCache();

    await withCountingClient(PROPERTIES_RESPONSE, async (counter) => {
      await propertyRepository.findProperties('deals');
      propertyRepository.resetPropertyCache();
      await propertyRepository.findProperties('deals');

      assert.equal(counter.calls, 2);
    });
  });

  await subtest.test('checkPropertiesExist separates the defined from the absent', async () => {
    propertyRepository.resetPropertyCache();

    await withCountingClient(PROPERTIES_RESPONSE, async () => {
      const { existing, missing } = await propertyRepository.checkPropertiesExist('deals', [
        'dealname',
        'hs_stage',
      ]);

      assert.deepEqual(existing, ['dealname']);
      assert.deepEqual(missing, ['hs_stage']);
    });
  });

  await subtest.test('verifyDealPropertyNames reports the alias translation', async () => {
    propertyRepository.resetPropertyCache();

    await withCountingClient(PROPERTIES_RESPONSE, async () => {
      const { aliases } = await propertyRepository.verifyDealPropertyNames();

      for (const alias of aliases) {
        assert.equal(alias.briefNameExists, false);
        assert.equal(alias.actualNameExists, true);
        assert.equal(alias.translationRequired, true);
      }
    });
  });
});

test('the HTTP client caches its axios instance', async (subtest) => {
  await subtest.test('repeated calls return the same instance', () => {
    hubSpotClient.resetClientCache();

    const first = hubSpotClient.getHttpClient();
    const second = hubSpotClient.getHttpClient();

    // One instance means one connection pool and one set of interceptors.
    // Rebuilding it per request would discard both.
    assert.equal(first, second);
  });

  await subtest.test('resetting yields a fresh instance', () => {
    const before = hubSpotClient.getHttpClient();
    hubSpotClient.resetClientCache();
    const after = hubSpotClient.getHttpClient();

    assert.notEqual(before, after);
  });

  await subtest.test('forceRecreate bypasses the cache', () => {
    const first = hubSpotClient.getHttpClient();
    const forced = hubSpotClient.getHttpClient({ forceRecreate: true });

    assert.notEqual(first, forced);
  });

  await subtest.test('the instance carries the configured base URL and timeout', () => {
    hubSpotClient.resetClientCache();
    const instance = hubSpotClient.getHttpClient();

    assert.equal(instance.defaults.baseURL, 'https://api.hubapi.com');
    assert.ok(instance.defaults.timeout > 0);
  });

  await subtest.test('resetting clears the observed rate limit', () => {
    hubSpotClient.resetClientCache();
    assert.equal(hubSpotClient.getLastObservedRateLimit(), null);
  });
});
