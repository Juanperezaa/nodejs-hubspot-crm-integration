'use strict';

/**
 * `dealRepository` — the Deals endpoints, and nothing else.
 *
 * Required by the brief: "abstractions that encapsulate CRUD calls".
 *
 * Mirrors `contactRepository` in shape, which is deliberate: two object types
 * behaving differently for no reason is a cost every future reader pays. Where
 * they genuinely diverge — deals have no unique property, so there is no
 * `findDealByEmail` equivalent and no upsert — the difference is a fact about
 * HubSpot rather than a choice made here.
 *
 * @see https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/deals/guide
 */

const hubSpotClient = require('../clients/hubSpotClient');
const { getHubSpotConfig, OBJECT_TYPES, PAGINATION_LIMITS } = require('../config/hubspot.config');
const { paginateAll } = require('../utils/paginate');
const { validateDealPayload, validateRecordId } = require('../utils/validateHubSpotPayload');

/**
 * Properties requested by default.
 *
 * `pipeline` and `dealstage` are the real internal names. The brief's
 * `hs_pipeline` and `hs_stage` are Ticket properties and do not exist on the
 * Deal object — confirmed against a live portal, where none of the three
 * appears among its 206 deal properties. `validateHubSpotPayload` translates
 * the brief's spelling on the way in; nothing translates on the way out,
 * because HubSpot only ever returns the real names.
 */
const DEFAULT_DEAL_PROPERTIES = Object.freeze([
  'dealname',
  'amount',
  'pipeline',
  'dealstage',
  'closedate',
  'dealtype',
  'description',
  'createdate',
  'hs_lastmodifieddate',
]);

/**
 * Yields every deal in the portal, one at a time.
 *
 * @param {object} [options]
 * @param {string[]} [options.properties]
 * @param {number} [options.pageSize]
 * @param {number} [options.limit]
 * @param {boolean} [options.archived]
 * @param {string[]} [options.associations]
 * @yields {object} A HubSpot deal record.
 */
async function* streamDeals(options = {}) {
  const config = getHubSpotConfig();
  const collectionPath = config.paths.objectCollection(OBJECT_TYPES.DEALS);

  yield* paginateAll(
    (query) => hubSpotClient.get(collectionPath, query, { operationName: 'list deals' }),
    {
      pageSize: options.pageSize ?? config.pageSize,
      properties: options.properties ?? DEFAULT_DEAL_PROPERTIES,
      associations: options.associations,
      archived: options.archived,
      limit: options.limit,
    }
  );
}

/**
 * Reads one page of deals, exposing HubSpot's cursor to the caller.
 *
 * @param {object} [options]
 * @param {string} [options.after]
 * @param {number} [options.limit]
 * @param {string[]} [options.properties]
 * @param {string[]} [options.associations]
 * @param {boolean} [options.archived]
 * @returns {Promise<{results: object[], nextCursor: string|undefined, hasMore: boolean}>}
 */
async function findDealsPage(options = {}) {
  const config = getHubSpotConfig();

  const query = {
    limit: Math.min(options.limit ?? config.pageSize, PAGINATION_LIMITS.MAX_LIST_PAGE_SIZE),
    properties: (options.properties ?? DEFAULT_DEAL_PROPERTIES).join(','),
  };
  if (options.after !== undefined) {
    query.after = options.after;
  }
  if (options.associations !== undefined) {
    query.associations = options.associations.join(',');
  }
  if (options.archived !== undefined) {
    query.archived = options.archived;
  }

  const response = await hubSpotClient.get(
    config.paths.objectCollection(OBJECT_TYPES.DEALS),
    query,
    { operationName: 'list deals page' }
  );

  const nextCursor = response.paging?.next?.after;

  return {
    results: response.results || [],
    nextCursor,
    hasMore: nextCursor !== undefined,
  };
}

/**
 * Reads a single deal by record id.
 *
 * @param {string|number} dealId
 * @param {{properties?: string[], associations?: string[]}} [options]
 * @returns {Promise<object>}
 */
async function findDealById(dealId, options = {}) {
  const config = getHubSpotConfig();
  const validatedId = validateRecordId(dealId, 'dealId');

  const query = { properties: (options.properties ?? DEFAULT_DEAL_PROPERTIES).join(',') };
  if (options.associations !== undefined) {
    query.associations = options.associations.join(',');
  }

  const deal = await hubSpotClient.get(
    config.paths.objectRecord(OBJECT_TYPES.DEALS, validatedId),
    query,
    { operationName: 'read deal' }
  );
  return deal;
}

/**
 * Creates a deal.
 *
 * @param {Record<string, unknown>} properties Must include a name, amount,
 *   pipeline and stage. The brief's `hs_pipeline` and `hs_stage` spellings are
 *   accepted and translated.
 * @returns {Promise<object>} The created record, including its id.
 */
async function createDeal(properties) {
  const config = getHubSpotConfig();
  const validated = validateDealPayload({ properties });

  const created = await hubSpotClient.post(
    config.paths.objectCollection(OBJECT_TYPES.DEALS),
    { properties: validated.properties },
    { operationName: 'create deal' }
  );
  return created;
}

/**
 * Updates a deal's properties.
 *
 * `PATCH` merges, so a partial payload leaves untouched properties alone. The
 * pipeline and stage requirement is relaxed because an update need not restate
 * where the deal already sits.
 *
 * @param {string|number} dealId
 * @param {Record<string, unknown>} properties
 * @returns {Promise<object>}
 */
async function updateDeal(dealId, properties) {
  const config = getHubSpotConfig();
  const validatedId = validateRecordId(dealId, 'dealId');
  const validated = validateDealPayload({ properties }, { requireStageAndPipeline: false });

  const updated = await hubSpotClient.patch(
    config.paths.objectRecord(OBJECT_TYPES.DEALS, validatedId),
    { properties: validated.properties },
    { operationName: 'update deal' }
  );
  return updated;
}

/**
 * Deletes (archives) a deal.
 *
 * As with contacts, HubSpot archives rather than destroys and accepts the
 * request unconditionally — including for an id that never existed.
 *
 * @param {string|number} dealId
 * @returns {Promise<void>}
 */
async function deleteDeal(dealId) {
  const config = getHubSpotConfig();
  const validatedId = validateRecordId(dealId, 'dealId');

  await hubSpotClient.delete(config.paths.objectRecord(OBJECT_TYPES.DEALS, validatedId), {
    operationName: 'delete deal',
  });
}

/**
 * Searches deals by an exact property value.
 *
 * This is the correlation mechanism for `syncDealsWithHubSpot`. Deals have no
 * naturally unique property, so reconciliation matches on `dealname` rather
 * than upserting on a key. The alternative — defining a custom correlation
 * property — would require `crm.schemas.deals.write` and would leave that
 * property on the portal's Deal schema permanently. Decision D11.
 *
 * The Search API allows 200 records per page and caps a query at 10,000
 * results, both far above what correlation needs.
 *
 * @param {string} propertyName Internal property name.
 * @param {string} propertyValue Exact value to match.
 * @param {{properties?: string[], limit?: number}} [options]
 * @returns {Promise<object[]>}
 */
async function searchDealsByProperty(propertyName, propertyValue, options = {}) {
  const config = getHubSpotConfig();

  const response = await hubSpotClient.post(
    config.paths.objectSearch(OBJECT_TYPES.DEALS),
    {
      filterGroups: [{ filters: [{ propertyName, operator: 'EQ', value: String(propertyValue) }] }],
      properties: options.properties ?? DEFAULT_DEAL_PROPERTIES,
      limit: Math.min(options.limit ?? 10, PAGINATION_LIMITS.MAX_SEARCH_PAGE_SIZE),
    },
    { operationName: 'search deals' }
  );

  return response.results || [];
}

module.exports = {
  streamDeals,
  findDealsPage,
  findDealById,
  createDeal,
  updateDeal,
  deleteDeal,
  searchDealsByProperty,
  DEFAULT_DEAL_PROPERTIES,
};
