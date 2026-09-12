'use strict';

/**
 * `contactRepository` — the Contacts endpoints, and nothing else.
 *
 * Required by the brief: "abstractions that encapsulate CRUD calls".
 *
 * This layer knows which endpoint corresponds to a contact and what its payload
 * looks like. It does not know how to speak HTTP — `hubSpotClient` does that —
 * and it holds no business rules, which live in the services above it.
 *
 * The payoff is concrete: when HubSpot retires the `v3` object endpoints, the
 * paths change in `hubspot.config.js` and the request shapes change here.
 * Services, handlers and examples are untouched.
 *
 * @see https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide
 */

const hubSpotClient = require('../clients/hubSpotClient');
const { getHubSpotConfig, OBJECT_TYPES, PAGINATION_LIMITS } = require('../config/hubspot.config');
const { paginateAll, chunkForBatch } = require('../utils/paginate');
const { validateContactPayload, validateRecordId } = require('../utils/validateHubSpotPayload');

/**
 * Properties requested by default.
 *
 * HubSpot returns only `hs_object_id`, `createdate` and `lastmodifieddate`
 * unless properties are named explicitly — a detail that silently produces
 * empty names if missed, because the response still looks well-formed.
 */
const DEFAULT_CONTACT_PROPERTIES = Object.freeze([
  'firstname',
  'lastname',
  'email',
  'phone',
  'company',
  'jobtitle',
  'lifecyclestage',
  'createdate',
  'lastmodifieddate',
]);

/**
 * Yields every contact in the portal, one at a time.
 *
 * An async generator rather than an array: a portal with fifty thousand
 * contacts would otherwise need all fifty thousand in memory before the caller
 * saw the first one.
 *
 * @param {object} [options]
 * @param {string[]} [options.properties] Property internal names to return.
 * @param {number} [options.pageSize] Records per request, capped at 100.
 * @param {number} [options.limit] Stop after this many records in total.
 * @param {boolean} [options.archived] Read archived contacts instead.
 * @param {string[]} [options.associations] Object types whose associations to include.
 * @yields {object} A HubSpot contact record.
 */
async function* streamContacts(options = {}) {
  const config = getHubSpotConfig();
  const collectionPath = config.paths.objectCollection(OBJECT_TYPES.CONTACTS);

  yield* paginateAll(
    (query) => hubSpotClient.get(collectionPath, query, { operationName: 'list contacts' }),
    {
      pageSize: options.pageSize ?? config.pageSize,
      properties: options.properties ?? DEFAULT_CONTACT_PROPERTIES,
      associations: options.associations,
      archived: options.archived,
      limit: options.limit,
    }
  );
}

/**
 * Reads one page of contacts, exposing HubSpot's cursor to the caller.
 *
 * Kept alongside `streamContacts` because the two serve different needs: this
 * is what a paginated API endpoint or a user interface wants, where the cursor
 * is handed back to the client and the next page is a separate request.
 *
 * @param {object} [options]
 * @param {string} [options.after] Cursor from a previous response.
 * @param {number} [options.limit] Page size, capped at 100.
 * @param {string[]} [options.properties]
 * @param {boolean} [options.archived]
 * @returns {Promise<{results: object[], nextCursor: string|undefined, hasMore: boolean}>}
 */
async function findContactsPage(options = {}) {
  const config = getHubSpotConfig();

  const query = {
    limit: Math.min(options.limit ?? config.pageSize, PAGINATION_LIMITS.MAX_LIST_PAGE_SIZE),
    properties: (options.properties ?? DEFAULT_CONTACT_PROPERTIES).join(','),
  };
  if (options.after !== undefined) {
    query.after = options.after;
  }
  if (options.archived !== undefined) {
    query.archived = options.archived;
  }

  const response = await hubSpotClient.get(
    config.paths.objectCollection(OBJECT_TYPES.CONTACTS),
    query,
    { operationName: 'list contacts page' }
  );

  const nextCursor = response.paging?.next?.after;

  return {
    results: response.results || [],
    nextCursor,
    // Derived rather than left to the caller, because "is there more?" is
    // exactly the question that gets answered wrongly when a caller inspects
    // `results.length === limit` instead.
    hasMore: nextCursor !== undefined,
  };
}

/**
 * Reads a single contact by record id.
 *
 * @param {string|number} contactId
 * @param {{properties?: string[], associations?: string[]}} [options]
 * @returns {Promise<object>}
 */
async function findContactById(contactId, options = {}) {
  const config = getHubSpotConfig();
  const validatedId = validateRecordId(contactId, 'contactId');

  const query = { properties: (options.properties ?? DEFAULT_CONTACT_PROPERTIES).join(',') };
  if (options.associations !== undefined) {
    query.associations = options.associations.join(',');
  }

  const contact = await hubSpotClient.get(
    config.paths.objectRecord(OBJECT_TYPES.CONTACTS, validatedId),
    query,
    { operationName: 'read contact' }
  );
  return contact;
}

/**
 * Reads a single contact by email address.
 *
 * HubSpot allows any unique property to stand in for the record id via
 * `idProperty`, which avoids a search request when the email is already known.
 *
 * @param {string} email
 * @param {{properties?: string[]}} [options]
 * @returns {Promise<object>}
 */
async function findContactByEmail(email, options = {}) {
  const config = getHubSpotConfig();

  const contact = await hubSpotClient.get(
    config.paths.objectRecord(OBJECT_TYPES.CONTACTS, String(email).trim().toLowerCase()),
    {
      idProperty: 'email',
      properties: (options.properties ?? DEFAULT_CONTACT_PROPERTIES).join(','),
    },
    { operationName: 'read contact by email' }
  );
  return contact;
}

/**
 * Creates a contact.
 *
 * @param {Record<string, unknown>} properties Contact properties. `email` is required.
 * @returns {Promise<object>} The created record, including its id.
 */
async function createContact(properties) {
  const config = getHubSpotConfig();
  const validated = validateContactPayload({ properties });

  const created = await hubSpotClient.post(
    config.paths.objectCollection(OBJECT_TYPES.CONTACTS),
    { properties: validated.properties },
    { operationName: 'create contact' }
  );
  return created;
}

/**
 * Updates a contact's properties.
 *
 * `PATCH`, not `PUT`: HubSpot merges the supplied properties into the record
 * rather than replacing it, so a partial payload leaves untouched fields alone.
 * The email requirement is relaxed because the record is already identified by
 * its id.
 *
 * @param {string|number} contactId
 * @param {Record<string, unknown>} properties
 * @returns {Promise<object>}
 */
async function updateContact(contactId, properties) {
  const config = getHubSpotConfig();
  const validatedId = validateRecordId(contactId, 'contactId');
  const validated = validateContactPayload({ properties }, { requireEmail: false });

  const updated = await hubSpotClient.patch(
    config.paths.objectRecord(OBJECT_TYPES.CONTACTS, validatedId),
    { properties: validated.properties },
    { operationName: 'update contact' }
  );
  return updated;
}

/**
 * Deletes a contact.
 *
 * HubSpot archives rather than destroying: the record leaves the CRM and the
 * API but is recoverable for ninety days. Worth knowing, because a "deleted"
 * email address still collides with a later create for that period.
 *
 * @param {string|number} contactId
 * @returns {Promise<void>}
 */
async function deleteContact(contactId) {
  const config = getHubSpotConfig();
  const validatedId = validateRecordId(contactId, 'contactId');

  await hubSpotClient.delete(config.paths.objectRecord(OBJECT_TYPES.CONTACTS, validatedId), {
    operationName: 'delete contact',
  });
}

/**
 * Creates or updates contacts in batches, keyed on email.
 *
 * The idempotent path used by `syncContactsWithHubSpot`. `email` is a natively
 * unique contact property on every HubSpot tier, so `batch/upsert` reconciles
 * in a single call per hundred records — where a search-then-write approach
 * would spend one Search request per record against a limit an order of
 * magnitude tighter than the standard one.
 *
 * @param {Array<Record<string, unknown>>} contactProperties Each must carry an `email`.
 * @returns {Promise<{results: object[], batchCount: number}>}
 */
async function upsertContactsByEmail(contactProperties) {
  const config = getHubSpotConfig();

  const inputs = contactProperties.map((properties) => {
    const validated = validateContactPayload({ properties });
    return {
      // `id` carries the value of `idProperty`, not a record id.
      id: validated.properties.email,
      idProperty: 'email',
      properties: validated.properties,
    };
  });

  const batches = chunkForBatch(inputs, PAGINATION_LIMITS.MAX_BATCH_INPUTS);
  const results = [];

  // Batches run sequentially, not with Promise.all. HubSpot enforces a
  // per-second ceiling as well as the documented ten-second burst limit, and
  // firing every batch at once is the reliable way to meet it.
  for (const batch of batches) {
    const response = await hubSpotClient.post(
      config.paths.objectBatch(OBJECT_TYPES.CONTACTS, 'upsert'),
      { inputs: batch },
      { operationName: 'upsert contacts' }
    );
    results.push(...(response.results || []));
  }

  return { results, batchCount: batches.length };
}

/**
 * Reads contacts in batches, keyed on a unique property.
 *
 * Used by `syncContactsWithHubSpot` to learn which records already exist
 * before upserting, which is what lets the sync report created and updated
 * counts truthfully. The upsert response does not distinguish the two — HubSpot
 * returns the same record shape either way — and the alternatives are worse: a
 * `createdate` comparison depends on clock agreement between this machine and
 * HubSpot, and scanning the whole portal costs far more than one extra batch.
 *
 * Records that do not exist are simply absent from the results. HubSpot reports
 * them under `errors` with category `OBJECT_NOT_FOUND` and returns HTTP 200, so
 * a missing record is not a failure and must not be treated as one.
 *
 * @param {string[]} propertyValues Values of `idProperty` to look up.
 * @param {{idProperty?: string, properties?: string[]}} [options]
 * @returns {Promise<{found: Map<string, object>, missing: string[]}>}
 */
async function batchReadByProperty(propertyValues, options = {}) {
  const config = getHubSpotConfig();
  const { idProperty = 'email', properties = DEFAULT_CONTACT_PROPERTIES } = options;

  const found = new Map();
  const missing = [];

  for (const batch of chunkForBatch(propertyValues, PAGINATION_LIMITS.MAX_BATCH_INPUTS)) {
    const response = await hubSpotClient.post(
      config.paths.objectBatch(OBJECT_TYPES.CONTACTS, 'read'),
      {
        idProperty,
        properties,
        inputs: batch.map((value) => ({ id: value })),
      },
      { operationName: 'batch read contacts' }
    );

    for (const record of response.results || []) {
      found.set(record.properties?.[idProperty], record);
    }
    for (const batchError of response.errors || []) {
      missing.push(...(batchError.context?.ids || []));
    }
  }

  return { found, missing };
}

/**
 * Searches contacts by an exact property value.
 *
 * The Search API carries its own limits — five requests per second, 200 records
 * per page, 10,000 results per query — so this is reserved for lookups that
 * cannot be served by `idProperty`.
 *
 * @param {string} propertyName Internal property name.
 * @param {string} propertyValue Exact value to match.
 * @param {{properties?: string[], limit?: number}} [options]
 * @returns {Promise<object[]>}
 */
async function searchContactsByProperty(propertyName, propertyValue, options = {}) {
  const config = getHubSpotConfig();

  const response = await hubSpotClient.post(
    config.paths.objectSearch(OBJECT_TYPES.CONTACTS),
    {
      filterGroups: [{ filters: [{ propertyName, operator: 'EQ', value: String(propertyValue) }] }],
      properties: options.properties ?? DEFAULT_CONTACT_PROPERTIES,
      limit: Math.min(options.limit ?? 10, PAGINATION_LIMITS.MAX_SEARCH_PAGE_SIZE),
    },
    { operationName: 'search contacts' }
  );

  return response.results || [];
}

module.exports = {
  streamContacts,
  findContactsPage,
  findContactById,
  findContactByEmail,
  createContact,
  updateContact,
  deleteContact,
  upsertContactsByEmail,
  batchReadByProperty,
  searchContactsByProperty,
  DEFAULT_CONTACT_PROPERTIES,
};
