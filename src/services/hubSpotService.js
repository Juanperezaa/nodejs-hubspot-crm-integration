'use strict';

/**
 * `hubSpotService` — the orchestrator.
 *
 * Required by the brief: "orchestrator that uses hubSpotClient for business
 * operations", and the home of the function names the brief specifies exactly.
 *
 * This layer decides *what sequence of operations satisfies a use case*. It
 * does not know how to speak HTTP, and it does not know which endpoint serves a
 * contact — repositories hold that. What it adds is the shape the brief asks
 * for: `getHubSpotContactNames` returns names, not records; `deleteHubSpotContact`
 * reports whether anything was deleted rather than throwing when the record was
 * already gone.
 *
 * Function names here are fixed by the brief and deliberately not renamed to
 * match internal conventions. The repository beneath uses domain names
 * (`findContactById`); this layer uses the brief's names. The mapping is the
 * point of the layer, not an accident of it.
 */

const associationRepository = require('../repositories/associationRepository');
const contactRepository = require('../repositories/contactRepository');
const dealRepository = require('../repositories/dealRepository');
const pipelineRepository = require('../repositories/pipelineRepository');
const { getHubSpotConfig, OBJECT_TYPES } = require('../config/hubspot.config');
const { HubSpotApiError, FAILURE_KINDS } = require('../errors/HubSpotApiError');
const { logger } = require('../utils/logger');
const { validateRecordId } = require('../utils/validateHubSpotPayload');

/**
 * Builds a display name from a contact's properties.
 *
 * HubSpot permits a contact with neither first nor last name — only email is
 * required — so this can legitimately produce an empty string. Callers decide
 * what to do with that rather than having a placeholder invented for them.
 *
 * @param {object} contact A HubSpot contact record.
 * @returns {string} The trimmed full name, possibly empty.
 */
function buildFullName(contact) {
  const firstName = contact?.properties?.firstname ?? '';
  const lastName = contact?.properties?.lastname ?? '';
  return `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim();
}

/**
 * Returns the full name of every contact in the portal.
 *
 * Brief, Section 2.1: "Implement getHubSpotContactNames making real calls to
 * GET /crm/v3/objects/contacts, handle pagination, and return full names."
 *
 * Pagination is handled by consuming the repository's async generator, so the
 * whole portal is traversed while only one page is ever held in memory. Only
 * `firstname` and `lastname` are requested: asking for properties that will be
 * discarded makes every page larger for no benefit.
 *
 * Nameless contacts are excluded by default. A list of full names containing
 * empty strings is not a list of names, and silently returning them pushes the
 * problem to whoever renders the result.
 *
 * @param {object} [options]
 * @param {number} [options.limit] Stop after this many contacts.
 * @param {boolean} [options.includeNameless] Keep contacts with no name, as ''.
 * @returns {Promise<string[]>}
 */
async function getHubSpotContactNames(options = {}) {
  const { limit, includeNameless = false } = options;

  const fullNames = [];
  let inspectedCount = 0;
  let namelessCount = 0;

  for await (const contact of contactRepository.streamContacts({
    properties: ['firstname', 'lastname'],
    limit,
  })) {
    inspectedCount += 1;
    const fullName = buildFullName(contact);

    if (fullName === '') {
      namelessCount += 1;
      if (!includeNameless) {
        continue;
      }
    }
    fullNames.push(fullName);
  }

  logger.info('Retrieved contact names', {
    inspected: inspectedCount,
    returned: fullNames.length,
    withoutName: namelessCount,
  });

  return fullNames;
}

/**
 * Lists contact details, with filtering and pagination options.
 *
 * Brief: "lists paginated contact details (with filter/pagination options)".
 *
 * Two modes, because the brief asks for both pagination *and* filtering and
 * they are served by different HubSpot endpoints:
 *
 *   - Without `filter`, the list endpoint is used and `nextCursor` is returned
 *     so a caller can page through.
 *   - With `filter`, the Search API is used. It has its own, tighter limits, so
 *     it is never used when a plain list would do.
 *
 * @param {object} [options]
 * @param {string} [options.after] Cursor from a previous call.
 * @param {number} [options.limit] Page size, capped at 100.
 * @param {string[]} [options.properties] Properties to return.
 * @param {{propertyName: string, value: string}} [options.filter] Exact-match filter.
 * @param {boolean} [options.archived] Read archived contacts.
 * @returns {Promise<{results: object[], nextCursor: string|undefined, hasMore: boolean}>}
 */
async function getHubSpotContacts(options = {}) {
  if (options.filter) {
    const { propertyName, value } = options.filter;
    const results = await contactRepository.searchContactsByProperty(propertyName, value, {
      properties: options.properties,
      limit: options.limit,
    });

    logger.info('Searched contacts', { propertyName, matches: results.length });

    // Search paging is deliberately not surfaced. It uses a numeric offset
    // rather than the list endpoint's cursor, and returning one shape that
    // silently means two different things would be a trap for the caller.
    return { results, nextCursor: undefined, hasMore: false };
  }

  const page = await contactRepository.findContactsPage(options);
  logger.info('Listed contacts', { returned: page.results.length, hasMore: page.hasMore });
  return page;
}

/**
 * Creates a contact.
 *
 * Brief: "creates a contact in HubSpot (POST)".
 *
 * @param {Record<string, unknown>} properties Must include `email`.
 * @returns {Promise<object>} The created record.
 */
async function createHubSpotContact(properties) {
  const created = await contactRepository.createContact(properties);

  logger.info('Created contact', {
    contactId: created.id,
    email: created.properties?.email,
  });

  return created;
}

/**
 * Updates a contact's properties.
 *
 * Brief: "updates contact properties (PATCH/PUT)".
 *
 * `PATCH` is used rather than `PUT` because HubSpot merges: a caller updating
 * one field must not silently clear every other.
 *
 * @param {string|number} contactId
 * @param {Record<string, unknown>} properties
 * @returns {Promise<object>}
 */
async function updateHubSpotContact(contactId, properties) {
  const updated = await contactRepository.updateContact(contactId, properties);

  logger.info('Updated contact', {
    contactId: updated.id,
    changedProperties: Object.keys(properties),
  });

  return updated;
}

/**
 * Deletes (archives) a contact.
 *
 * Brief: "deletes a contact (DELETE)".
 *
 * **HubSpot's delete is unconditionally idempotent, and silent about it.**
 * Measured against a live portal: `DELETE /crm/v3/objects/contacts/{id}`
 * returns success for a record that exists, for one already archived, and for
 * an id that never existed at all. It never returns 404.
 *
 * That is convenient — cleanup can run repeatedly without special-casing — but
 * it means the API cannot tell a caller whether anything was actually removed.
 * So this function does not claim to. It reports that HubSpot **accepted** the
 * request, and leaves `existedBeforeDelete` undefined unless the caller asks
 * for the extra read that can establish it.
 *
 * An earlier version of this function returned `deleted: true`, inferring a
 * deletion from a successful response. That was a false claim, and the
 * integration suite caught it.
 *
 * Note that HubSpot archives rather than destroys: the record leaves the CRM
 * and the API but is recoverable for ninety days, during which its email still
 * collides with a new create.
 *
 * @param {string|number} contactId
 * @param {{confirmExistence?: boolean}} [options] When true, reads the record
 *   first so `existedBeforeDelete` is populated. Costs one extra request, so it
 *   is opt-in rather than the default.
 * @returns {Promise<{contactId: string, archived: boolean, existedBeforeDelete: boolean|undefined}>}
 */
async function deleteHubSpotContact(contactId, options = {}) {
  const { confirmExistence = false } = options;
  const validatedId = validateRecordId(contactId, 'contactId');

  let existedBeforeDelete;
  if (confirmExistence) {
    try {
      await contactRepository.findContactById(validatedId, { properties: ['email'] });
      existedBeforeDelete = true;
    } catch (error) {
      if (error instanceof HubSpotApiError && error.kind === FAILURE_KINDS.NOT_FOUND) {
        existedBeforeDelete = false;
      } else {
        throw error;
      }
    }
  }

  try {
    await contactRepository.deleteContact(validatedId);
  } catch (error) {
    // Retained as defence rather than as live behaviour. Contacts do not 404
    // here today, but other object types and future API versions may, and
    // treating that as success keeps the operation idempotent either way.
    if (error instanceof HubSpotApiError && error.kind === FAILURE_KINDS.NOT_FOUND) {
      logger.info('Contact was already absent', { contactId: validatedId });
      return { contactId: validatedId, archived: false, existedBeforeDelete: false };
    }
    throw error;
  }

  logger.info('Archived contact', { contactId: validatedId, existedBeforeDelete });
  return { contactId: validatedId, archived: true, existedBeforeDelete };
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

/**
 * Lists deals, with pagination.
 *
 * Brief: "getHubSpotDeals — lists deals (with pagination)".
 *
 * Returns one page plus its cursor by default. `all: true` traverses every page
 * and returns a flat array; that is opt-in because reading a whole portal into
 * memory should be a deliberate choice, visible at the call site.
 *
 * @param {object} [options]
 * @param {string} [options.after] Cursor from a previous call.
 * @param {number} [options.limit] Page size, capped at 100.
 * @param {string[]} [options.properties]
 * @param {string[]} [options.associations] Object types whose associations to include.
 * @param {boolean} [options.all] Traverse every page instead of returning one.
 * @returns {Promise<{results: object[], nextCursor: string|undefined, hasMore: boolean}>}
 */
async function getHubSpotDeals(options = {}) {
  if (options.all) {
    const results = [];
    for await (const deal of dealRepository.streamDeals(options)) {
      results.push(deal);
    }
    logger.info('Listed every deal', { returned: results.length });
    return { results, nextCursor: undefined, hasMore: false };
  }

  const page = await dealRepository.findDealsPage(options);
  logger.info('Listed deals', { returned: page.results.length, hasMore: page.hasMore });
  return page;
}

/**
 * Creates a deal.
 *
 * Brief, Section 2.2: "Implement createHubSpotDeal(dealName, amount) making a
 * real POST to /crm/v3/objects/deals with properties.dealname,
 * properties.amount, hs_pipeline, hs_stage. Allow passing pipeline/stage via
 * env vars."
 *
 * The positional signature is the brief's and is kept verbatim. Pipeline and
 * stage default to `HUBSPOT_PIPELINE_ID` and `HUBSPOT_STAGE_ID`, which is what
 * "allow passing pipeline/stage via env vars" asks for, and either may be
 * overridden per call.
 *
 * **On `hs_pipeline` and `hs_stage`.** The brief names those two properties.
 * They belong to the Ticket object; the Deal object uses `pipeline` and
 * `dealstage`, and sending the brief's spelling returns
 * `400 PROPERTY_DOESNT_EXIST`. Confirmed against a live portal, where none of
 * `hs_pipeline`, `hs_stage` or `hs_pipeline_stage` appears among its 206 deal
 * properties. `validateHubSpotPayload` accepts either spelling and translates,
 * so HubSpot receives the name it actually defines. Decision D5.
 *
 * The payload below is deliberately written in the brief's spelling, so the
 * translation layer is exercised on this project's primary path rather than
 * only in its tests.
 *
 * Pipeline and stage are verified before the request unless `verifyPipeline`
 * is disabled. HubSpot's rejection for an unknown stage names the *property*
 * rather than the *value*, so it reads as though `dealstage` itself were
 * wrong when the real mistake is usually a display label supplied where an
 * internal id was wanted.
 *
 * @param {string} dealName Value for `properties.dealname`.
 * @param {number|string} amount Value for `properties.amount`.
 * @param {object} [options]
 * @param {string} [options.pipeline] Internal pipeline id. Defaults to `HUBSPOT_PIPELINE_ID`.
 * @param {string} [options.stage] Internal stage id. Defaults to `HUBSPOT_STAGE_ID`.
 * @param {Record<string, unknown>} [options.additionalProperties] Any other deal properties.
 * @param {boolean} [options.verifyPipeline] Check the pipeline and stage first. Default true.
 * @returns {Promise<object>} The created record, including its id.
 */
async function createHubSpotDeal(dealName, amount, options = {}) {
  const config = getHubSpotConfig();

  const pipelineId = options.pipeline ?? config.defaultPipelineId;
  const stageId = options.stage ?? config.defaultStageId;
  const { verifyPipeline = true, additionalProperties = {} } = options;

  if (verifyPipeline) {
    await pipelineRepository.assertPipelineAndStageExist(pipelineId, stageId);
  }

  const created = await dealRepository.createDeal({
    ...additionalProperties,
    dealname: dealName,
    amount,
    hs_pipeline: pipelineId,
    hs_stage: stageId,
  });

  logger.info('Created deal', {
    dealId: created.id,
    dealname: created.properties?.dealname,
    pipeline: created.properties?.pipeline,
    dealstage: created.properties?.dealstage,
  });

  return created;
}

/**
 * Updates a deal.
 *
 * Brief: "updateHubSpotDeal — updates a deal".
 *
 * `PATCH` merges, so a partial payload leaves the rest of the record alone.
 * The brief's property spellings are accepted here too.
 *
 * @param {string|number} dealId
 * @param {Record<string, unknown>} properties
 * @returns {Promise<object>}
 */
async function updateHubSpotDeal(dealId, properties) {
  const updated = await dealRepository.updateDeal(dealId, properties);

  logger.info('Updated deal', {
    dealId: updated.id,
    changedProperties: Object.keys(properties),
  });

  return updated;
}

/**
 * Deletes (archives) a deal.
 *
 * Brief: "deleteHubSpotDeal — deletes a deal".
 *
 * Reports acceptance rather than claiming a removal, for the same reason as
 * `deleteHubSpotContact`: HubSpot's delete succeeds for a live record, an
 * already-archived one, and an id that never existed, so the API cannot say
 * whether anything was removed. `existedBeforeDelete` is populated only when a
 * caller opts into the extra read that can establish it.
 *
 * @param {string|number} dealId
 * @param {{confirmExistence?: boolean}} [options]
 * @returns {Promise<{dealId: string, archived: boolean, existedBeforeDelete: boolean|undefined}>}
 */
async function deleteHubSpotDeal(dealId, options = {}) {
  const { confirmExistence = false } = options;
  const validatedId = validateRecordId(dealId, 'dealId');

  let existedBeforeDelete;
  if (confirmExistence) {
    try {
      await dealRepository.findDealById(validatedId, { properties: ['dealname'] });
      existedBeforeDelete = true;
    } catch (error) {
      if (error instanceof HubSpotApiError && error.kind === FAILURE_KINDS.NOT_FOUND) {
        existedBeforeDelete = false;
      } else {
        throw error;
      }
    }
  }

  try {
    await dealRepository.deleteDeal(validatedId);
  } catch (error) {
    if (error instanceof HubSpotApiError && error.kind === FAILURE_KINDS.NOT_FOUND) {
      logger.info('Deal was already absent', { dealId: validatedId });
      return { dealId: validatedId, archived: false, existedBeforeDelete: false };
    }
    throw error;
  }

  logger.info('Archived deal', { dealId: validatedId, existedBeforeDelete });
  return { dealId: validatedId, archived: true, existedBeforeDelete };
}

// ---------------------------------------------------------------------------
// Associations
// ---------------------------------------------------------------------------

/**
 * Associates a contact with a deal.
 *
 * Brief, Section 2.3: "Implement associateContactToDeal(contactId, dealId)
 * using the HubSpot associations endpoint, ensuring idempotency where
 * possible."
 *
 * **Idempotency comes from two places, and the second is the one that matters
 * to a caller.**
 *
 * The endpoint is a `PUT`, so repeating the request is idempotent by HTTP
 * semantics: HubSpot will not create a second association. That satisfies the
 * requirement on its own, and it is what makes the operation safe to retry
 * after a network failure where the outcome is unknown.
 *
 * But "safe to repeat" is not the same as "tells the truth about what it did".
 * A caller synchronising a hundred contact-deal pairs wants to know how many
 * links it actually established, and a function that answers "a hundred" every
 * time is useless for that. So this reads the existing associations first and
 * reports `alreadyAssociated`, at the cost of one extra request.
 *
 * That read is skippable. `skipExistingCheck: true` halves the request count
 * for a bulk run that does not care about the distinction, and the `PUT` keeps
 * the operation correct either way.
 *
 * The association type is `HUBSPOT_DEFINED` id 4, Contact to Deal. The
 * `default` endpoint is used rather than the labelled one because the ordinary
 * relationship carries no custom label.
 *
 * @param {string|number} contactId
 * @param {string|number} dealId
 * @param {{skipExistingCheck?: boolean}} [options]
 * @returns {Promise<{contactId: string, dealId: string, associated: boolean, alreadyAssociated: boolean|undefined}>}
 */
async function associateContactToDeal(contactId, dealId, options = {}) {
  const { skipExistingCheck = false } = options;

  const validatedContactId = validateRecordId(contactId, 'contactId');
  const validatedDealId = validateRecordId(dealId, 'dealId');

  let alreadyAssociated;
  if (!skipExistingCheck) {
    alreadyAssociated = await associationRepository.isAssociated(
      OBJECT_TYPES.CONTACTS,
      validatedContactId,
      OBJECT_TYPES.DEALS,
      validatedDealId
    );

    if (alreadyAssociated) {
      logger.info('Contact and deal are already associated', {
        contactId: validatedContactId,
        dealId: validatedDealId,
      });
      return {
        contactId: validatedContactId,
        dealId: validatedDealId,
        associated: true,
        alreadyAssociated: true,
      };
    }
  }

  await associationRepository.createDefaultAssociation(
    OBJECT_TYPES.CONTACTS,
    validatedContactId,
    OBJECT_TYPES.DEALS,
    validatedDealId
  );

  logger.info('Associated contact with deal', {
    contactId: validatedContactId,
    dealId: validatedDealId,
  });

  return {
    contactId: validatedContactId,
    dealId: validatedDealId,
    associated: true,
    alreadyAssociated: skipExistingCheck ? undefined : false,
  };
}

/**
 * Lists the deals a contact is associated with.
 *
 * @param {string|number} contactId
 * @returns {Promise<string[]>} Deal record ids.
 */
async function getDealsForContact(contactId) {
  const associations = await associationRepository.findAssociations(
    OBJECT_TYPES.CONTACTS,
    contactId,
    OBJECT_TYPES.DEALS
  );

  return associations.map((association) => String(association.toObjectId));
}

/**
 * Removes the association between a contact and a deal.
 *
 * Included because the integration suite must be able to undo what it does,
 * and because an association created in error is otherwise only removable
 * through the HubSpot interface.
 *
 * @param {string|number} contactId
 * @param {string|number} dealId
 * @returns {Promise<{contactId: string, dealId: string, removed: boolean}>}
 */
async function dissociateContactFromDeal(contactId, dealId) {
  const validatedContactId = validateRecordId(contactId, 'contactId');
  const validatedDealId = validateRecordId(dealId, 'dealId');

  try {
    await associationRepository.removeAssociations(
      OBJECT_TYPES.CONTACTS,
      validatedContactId,
      OBJECT_TYPES.DEALS,
      validatedDealId
    );
  } catch (error) {
    if (error instanceof HubSpotApiError && error.kind === FAILURE_KINDS.NOT_FOUND) {
      return { contactId: validatedContactId, dealId: validatedDealId, removed: false };
    }
    throw error;
  }

  logger.info('Removed the association between contact and deal', {
    contactId: validatedContactId,
    dealId: validatedDealId,
  });

  return { contactId: validatedContactId, dealId: validatedDealId, removed: true };
}

module.exports = {
  getHubSpotContactNames,
  getHubSpotContacts,
  createHubSpotContact,
  updateHubSpotContact,
  deleteHubSpotContact,
  getHubSpotDeals,
  createHubSpotDeal,
  updateHubSpotDeal,
  deleteHubSpotDeal,
  associateContactToDeal,
  getDealsForContact,
  dissociateContactFromDeal,
  buildFullName,
};
