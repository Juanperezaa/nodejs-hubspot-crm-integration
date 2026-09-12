'use strict';

/**
 * `pipelineRepository` — the Pipelines endpoints.
 *
 * Required by the brief, which lists Pipelines among the official endpoints
 * that must be used: "Use official endpoints for Contacts, Deals,
 * Associations, Pipelines, and Properties."
 *
 * It earns its place beyond compliance. `HUBSPOT_PIPELINE_ID` and
 * `HUBSPOT_STAGE_ID` take **internal ids**, not display labels, and a wrong one
 * produces a `400` that names the property rather than the value — so the
 * message points at `dealstage` when the real problem is that
 * `"Closed Won"` was supplied where `closedwon` was meant. Reading the
 * pipelines makes that diagnosable before the request is sent.
 *
 * Results are cached for the process lifetime: pipeline definitions are
 * configuration that changes when an administrator edits them, not data, and
 * re-reading them on every deal creation would spend rate-limit budget on an
 * answer that does not move.
 *
 * @see https://developers.hubspot.com/docs/api-reference/crm-pipelines-v3/guide
 */

const hubSpotClient = require('../clients/hubSpotClient');
const { getHubSpotConfig, OBJECT_TYPES } = require('../config/hubspot.config');
const { HubSpotApiError, FAILURE_KINDS } = require('../errors/HubSpotApiError');

/** Cached pipeline definitions, keyed by object type. */
const pipelineCache = new Map();

/**
 * Reads every pipeline defined for an object type.
 *
 * @param {string} [objectType] Defaults to deals.
 * @param {{useCache?: boolean}} [options]
 * @returns {Promise<object[]>} Pipelines, each with its ordered stages.
 */
async function findPipelines(objectType = OBJECT_TYPES.DEALS, options = {}) {
  const { useCache = true } = options;

  if (useCache && pipelineCache.has(objectType)) {
    return pipelineCache.get(objectType);
  }

  const config = getHubSpotConfig();
  const response = await hubSpotClient.get(config.paths.pipelines(objectType), undefined, {
    operationName: `read ${objectType} pipelines`,
  });

  const pipelines = (response.results || []).map((pipeline) => ({
    ...pipeline,
    // HubSpot returns stages unordered; displayOrder is what the interface
    // shows, so sorting here means every consumer sees the same sequence.
    stages: [...(pipeline.stages || [])].sort(
      (first, second) => first.displayOrder - second.displayOrder
    ),
  }));

  pipelineCache.set(objectType, pipelines);
  return pipelines;
}

/**
 * Reads a single pipeline by id.
 *
 * @param {string} pipelineId
 * @param {string} [objectType]
 * @returns {Promise<object>}
 */
async function findPipelineById(pipelineId, objectType = OBJECT_TYPES.DEALS) {
  const config = getHubSpotConfig();

  const pipeline = await hubSpotClient.get(
    config.paths.pipeline(objectType, pipelineId),
    undefined,
    { operationName: `read ${objectType} pipeline` }
  );
  return pipeline;
}

/**
 * Confirms that a pipeline and stage pair exists, before a deal is created.
 *
 * The reason this is worth a request: HubSpot's rejection for an unknown stage
 * names the property, not the value, so the error reads as though `dealstage`
 * itself were wrong. Checking first turns that into a message naming the value
 * supplied and listing the ones that would work.
 *
 * @param {string} pipelineId
 * @param {string} stageId
 * @param {string} [objectType]
 * @returns {Promise<{pipeline: object, stage: object}>}
 * @throws {HubSpotApiError} With kind `VALIDATION` when either is unknown.
 */
async function assertPipelineAndStageExist(pipelineId, stageId, objectType = OBJECT_TYPES.DEALS) {
  const pipelines = await findPipelines(objectType);

  const pipeline = pipelines.find((candidate) => candidate.id === pipelineId);
  if (!pipeline) {
    const availableIds = pipelines.map((candidate) => `${candidate.id} ("${candidate.label}")`);
    throw new HubSpotApiError(`Pipeline "${pipelineId}" does not exist in this portal.`, {
      kind: FAILURE_KINDS.VALIDATION,
      validationErrors: [
        {
          field: 'pipeline',
          message: `Available pipelines: ${availableIds.join(', ') || 'none'}`,
        },
      ],
    });
  }

  const stage = pipeline.stages.find((candidate) => candidate.id === stageId);
  if (!stage) {
    const availableIds = pipeline.stages.map(
      (candidate) => `${candidate.id} ("${candidate.label}")`
    );
    throw new HubSpotApiError(
      `Stage "${stageId}" does not exist in pipeline "${pipeline.label}".`,
      {
        kind: FAILURE_KINDS.VALIDATION,
        validationErrors: [
          {
            field: 'dealstage',
            message: `Available stages: ${availableIds.join(', ')}`,
          },
        ],
      }
    );
  }

  return { pipeline, stage };
}

/**
 * Clears the cache. Test seam, and useful after an administrator edits a
 * pipeline in a long-running process.
 *
 * @returns {void}
 */
function resetPipelineCache() {
  pipelineCache.clear();
}

module.exports = {
  findPipelines,
  findPipelineById,
  assertPipelineAndStageExist,
  resetPipelineCache,
};
