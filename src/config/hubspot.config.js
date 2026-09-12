'use strict';

/**
 * The single place where HubSpot's API surface is described.
 *
 * Every endpoint path, every version segment and every retry parameter lives
 * here. Repositories compose requests from these builders rather than writing
 * path strings inline, which is what makes the versioning claim in
 * docs/ARCHITECTURE.md true: when HubSpot retires the v4 association endpoints
 * in March 2027, this file changes and the layers above it do not.
 *
 * Official references for every path are catalogued in docs/API_REFERENCE.md.
 */

const { getEnvironment } = require('./env');

/**
 * HubSpot object type names as they appear in CRM endpoint paths.
 * @see https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide
 */
const OBJECT_TYPES = Object.freeze({
  CONTACTS: 'contacts',
  DEALS: 'deals',
  COMPANIES: 'companies',
  TICKETS: 'tickets',
});

/**
 * Association type identifiers defined by HubSpot.
 *
 * These are HUBSPOT_DEFINED categories; custom labels carry USER_DEFINED ids
 * discoverable through the association labels endpoint.
 *
 * @see https://developers.hubspot.com/docs/api-reference/crm-associations-v4/guide
 */
const ASSOCIATION_TYPE_IDS = Object.freeze({
  CONTACT_TO_DEAL: 4,
  DEAL_TO_CONTACT: 3,
});

/**
 * Deal property aliases.
 *
 * The technical brief specifies `hs_pipeline` and `hs_stage` for deals. Those
 * are **Ticket** properties: the Ticket object uses `hs_pipeline` and
 * `hs_pipeline_stage`. The Deal object uses `pipeline` and `dealstage`, as the
 * official Deals guide shows in its create example.
 *
 * Sending the brief's names verbatim returns 400 PROPERTY_DOESNT_EXIST, so the
 * names are accepted at the public boundary and translated here. Callers may
 * use either spelling; HubSpot only ever receives the real one.
 *
 * The mapping is verified against the live portal by `npm run probe`, which
 * reads GET /crm/v3/properties/deals and reports which names actually exist.
 *
 * @see https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/deals/guide
 */
const DEAL_PROPERTY_ALIASES = Object.freeze({
  hs_pipeline: 'pipeline',
  hs_stage: 'dealstage',
  hs_pipeline_stage: 'dealstage',
});

/** HTTP status codes that are worth retrying, and those that never are. */
const RETRYABLE_STATUS_CODES = Object.freeze([429, 500, 502, 503, 504]);

/** Node socket-level failures that indicate a transient transport fault. */
const RETRYABLE_NETWORK_CODES = Object.freeze([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ECONNREFUSED',
]);

/** Pagination limits imposed by HubSpot, not by this project. */
const PAGINATION_LIMITS = Object.freeze({
  /** CRM list endpoints reject a `limit` above 100. */
  MAX_LIST_PAGE_SIZE: 100,
  /** The Search API allows larger pages but caps total results at 10,000. */
  MAX_SEARCH_PAGE_SIZE: 200,
  MAX_SEARCH_TOTAL_RESULTS: 10000,
  /** Batch endpoints accept at most 100 inputs per request. */
  MAX_BATCH_INPUTS: 100,
});

/**
 * Builds the effective configuration from the validated environment.
 *
 * Returned frozen so that no caller can mutate shared configuration as a side
 * effect of a single request.
 *
 * @param {{requireAccessToken?: boolean}} [options] Forwarded to the environment loader.
 * @returns {Readonly<object>}
 */
function getHubSpotConfig(options = {}) {
  const environment = getEnvironment(options);

  const objectsVersion = environment.objectsApiVersion;
  const associationsVersion = environment.associationsApiVersion;

  return Object.freeze({
    baseUrl: environment.baseUrl,
    accessToken: environment.accessToken,
    portalId: environment.portalId,
    requestTimeoutMs: environment.requestTimeoutMs,
    pageSize: Math.min(environment.pageSize, PAGINATION_LIMITS.MAX_LIST_PAGE_SIZE),

    defaultPipelineId: environment.defaultPipelineId,
    defaultStageId: environment.defaultStageId,

    retryPolicy: Object.freeze({
      maxAttempts: environment.maxRetryAttempts,
      baseDelayMs: environment.retryBaseDelayMs,
      maxDelayMs: environment.retryMaxDelayMs,
      retryableStatusCodes: RETRYABLE_STATUS_CODES,
      retryableNetworkCodes: RETRYABLE_NETWORK_CODES,
    }),

    /**
     * Endpoint path builders. Paths are relative to `baseUrl`.
     */
    paths: Object.freeze({
      // --- CRM objects ---------------------------------------------------
      /** GET (list) and POST (create) for an object type. */
      objectCollection: (objectType) => `/crm/${objectsVersion}/objects/${objectType}`,
      /** GET, PATCH and DELETE for a single record. */
      objectRecord: (objectType, recordId) =>
        `/crm/${objectsVersion}/objects/${objectType}/${encodeURIComponent(recordId)}`,
      /** POST batch operations: read, create, update, upsert, archive. */
      objectBatch: (objectType, operation) =>
        `/crm/${objectsVersion}/objects/${objectType}/batch/${operation}`,
      /** POST search. Subject to its own, tighter rate limit. */
      objectSearch: (objectType) => `/crm/${objectsVersion}/objects/${objectType}/search`,

      // --- Associations ----------------------------------------------------
      /** PUT an unlabelled association between two records. */
      associationDefault: (fromObjectType, fromRecordId, toObjectType, toRecordId) =>
        `/crm/${associationsVersion}/objects/${fromObjectType}/${encodeURIComponent(fromRecordId)}` +
        `/associations/default/${toObjectType}/${encodeURIComponent(toRecordId)}`,
      /** PUT a labelled association, or DELETE every association between two records. */
      associationLabelled: (fromObjectType, fromRecordId, toObjectType, toRecordId) =>
        `/crm/${associationsVersion}/objects/${fromObjectType}/${encodeURIComponent(fromRecordId)}` +
        `/associations/${toObjectType}/${encodeURIComponent(toRecordId)}`,
      /** GET every association a record has with a given object type. */
      associationList: (fromObjectType, fromRecordId, toObjectType) =>
        `/crm/${associationsVersion}/objects/${fromObjectType}/${encodeURIComponent(fromRecordId)}` +
        `/associations/${toObjectType}`,

      // --- Pipelines and properties ---------------------------------------
      /** GET every pipeline defined for an object type. */
      pipelines: (objectType) => `/crm/v3/pipelines/${objectType}`,
      /** GET a single pipeline. */
      pipeline: (objectType, pipelineId) =>
        `/crm/v3/pipelines/${objectType}/${encodeURIComponent(pipelineId)}`,
      /** GET every property defined for an object type. */
      properties: (objectType) => `/crm/v3/properties/${objectType}`,

      // --- Authentication ---------------------------------------------------
      /**
       * POST token introspection for a private app token.
       * The more prominent GET /oauth/v1/access-tokens/{token} accepts OAuth
       * tokens only and returns 400 for a private app token.
       */
      privateAppTokenInfo: () => '/oauth/v2/private-apps/get/access-token-info',
    }),
  });
}

module.exports = {
  getHubSpotConfig,
  OBJECT_TYPES,
  ASSOCIATION_TYPE_IDS,
  DEAL_PROPERTY_ALIASES,
  RETRYABLE_STATUS_CODES,
  RETRYABLE_NETWORK_CODES,
  PAGINATION_LIMITS,
};
