'use strict';

/**
 * `validateHubSpotPayload` — payload validation and property normalisation.
 *
 * Required by the brief: "utility to validate payloads before sending them".
 *
 * Written by hand rather than delegated to Zod or Joi. The brief names this
 * function as a required artefact, so handing its logic to a schema library
 * would satisfy the filename while removing the substance. It also does one
 * thing no generic validator would: translate the deal property aliases
 * described below.
 *
 * Two jobs, in order:
 *
 *   1. **Normalise.** Accept the property spellings the brief specifies and
 *      convert them to the ones HubSpot actually defines.
 *   2. **Validate.** Reject what HubSpot would reject, locally, with a message
 *      that names the field — because a 400 from HubSpot costs a round trip and
 *      a rate-limit slot to learn the same thing.
 */

const { DEAL_PROPERTY_ALIASES } = require('../config/hubspot.config');
const { HubSpotApiError, FAILURE_KINDS } = require('../errors/HubSpotApiError');

/** Deliberately permissive: HubSpot is the authority on address validity. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Raised for a payload that HubSpot would reject.
 *
 * Reuses `HubSpotApiError` with kind `VALIDATION` rather than introducing a
 * third error type, so a caller's `catch` handles a locally-detected invalid
 * payload and a remotely-rejected one identically. Neither is retryable and
 * both are fixed in the same place.
 *
 * @param {string} message
 * @param {string} fieldName
 * @returns {HubSpotApiError}
 */
function invalidPayload(message, fieldName) {
  return new HubSpotApiError(message, {
    kind: FAILURE_KINDS.VALIDATION,
    validationErrors: [{ message, field: fieldName }],
  });
}

/**
 * Rewrites the brief's deal property names to the ones HubSpot defines.
 *
 * The brief asks for deals to be created with `hs_pipeline` and `hs_stage`.
 * Those are **Ticket** properties — the Ticket object uses `hs_pipeline` and
 * `hs_pipeline_stage`. The Deal object uses `pipeline` and `dealstage`, as the
 * official Deals guide shows in its create example. Sending the brief's names
 * verbatim returns `400 PROPERTY_DOESNT_EXIST`.
 *
 * Accepting both and translating here satisfies the brief at the public
 * boundary while producing a request HubSpot accepts. `npm run probe` verifies
 * the mapping against the live portal's Properties endpoint.
 *
 * A canonical name already present wins over its alias, so a caller who writes
 * both is not silently overridden by the legacy spelling.
 *
 * @param {Record<string, unknown>} properties
 * @returns {{properties: Record<string, unknown>, appliedAliases: string[]}}
 */
function normaliseDealProperties(properties) {
  const normalised = {};
  const appliedAliases = [];

  for (const [propertyName, propertyValue] of Object.entries(properties)) {
    const canonicalName = DEAL_PROPERTY_ALIASES[propertyName];

    if (canonicalName === undefined) {
      normalised[propertyName] = propertyValue;
      continue;
    }

    // An explicit canonical value takes precedence over the alias.
    if (Object.prototype.hasOwnProperty.call(properties, canonicalName)) {
      appliedAliases.push(`${propertyName} ignored in favour of ${canonicalName}`);
      continue;
    }

    normalised[canonicalName] = propertyValue;
    appliedAliases.push(`${propertyName} -> ${canonicalName}`);
  }

  return { properties: normalised, appliedAliases };
}

/**
 * Asserts that a value is a non-empty string.
 *
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string} The trimmed value.
 */
function requireNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidPayload(`"${fieldName}" is required and must be a non-empty string.`, fieldName);
  }
  return value.trim();
}

/**
 * Coerces an amount to the string form HubSpot stores.
 *
 * HubSpot accepts numeric properties as strings and returns them as strings.
 * Normalising on the way in means a round trip through the API does not change
 * the type a caller sees, which is what makes an idempotent sync comparison
 * work at all.
 *
 * @param {unknown} amount
 * @returns {string}
 */
function normaliseAmount(amount) {
  if (amount === undefined || amount === null || amount === '') {
    throw invalidPayload('"amount" is required.', 'amount');
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount)) {
    throw invalidPayload(
      `"amount" must be a finite number, received ${JSON.stringify(amount)}.`,
      'amount'
    );
  }
  if (parsedAmount < 0) {
    throw invalidPayload('"amount" must not be negative.', 'amount');
  }

  return String(parsedAmount);
}

/**
 * Validates a contact payload.
 *
 * Email is required because it is the only natively unique contact property,
 * and therefore the only key an idempotent upsert can reconcile against. A
 * contact created without one cannot be matched on a later run and would be
 * duplicated on every sync.
 *
 * @param {{properties?: Record<string, unknown>}} payload
 * @param {{requireEmail?: boolean}} [options] Updates may omit the email, since
 *   the record is already identified by its id.
 * @returns {{properties: Record<string, unknown>}}
 */
function validateContactPayload(payload, options = {}) {
  const { requireEmail = true } = options;

  if (!payload || typeof payload !== 'object') {
    throw invalidPayload('A contact payload object is required.', 'payload');
  }

  const properties = payload.properties || {};
  if (typeof properties !== 'object' || Array.isArray(properties)) {
    throw invalidPayload('"properties" must be an object.', 'properties');
  }
  if (Object.keys(properties).length === 0) {
    throw invalidPayload('"properties" must contain at least one property.', 'properties');
  }

  const validated = { ...properties };

  if (requireEmail || validated.email !== undefined) {
    const email = requireNonEmptyString(validated.email, 'email').toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      throw invalidPayload(`"email" is not a valid address: ${email}`, 'email');
    }
    // Lower-cased because HubSpot treats addresses case-insensitively for
    // uniqueness. Leaving the case alone would make two spellings of the same
    // address look like two different contacts to the sync comparison.
    validated.email = email;
  }

  return { properties: validated };
}

/**
 * Validates a deal payload, applying the alias translation first.
 *
 * @param {{properties?: Record<string, unknown>}} payload
 * @param {{requireStageAndPipeline?: boolean}} [options] Updates may change a
 *   single property without restating the pipeline.
 * @returns {{properties: Record<string, unknown>, appliedAliases: string[]}}
 */
function validateDealPayload(payload, options = {}) {
  const { requireStageAndPipeline = true } = options;

  if (!payload || typeof payload !== 'object') {
    throw invalidPayload('A deal payload object is required.', 'payload');
  }

  const rawProperties = payload.properties || {};
  if (typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
    throw invalidPayload('"properties" must be an object.', 'properties');
  }
  if (Object.keys(rawProperties).length === 0) {
    throw invalidPayload('"properties" must contain at least one property.', 'properties');
  }

  const { properties, appliedAliases } = normaliseDealProperties(rawProperties);

  if (requireStageAndPipeline || properties.dealname !== undefined) {
    properties.dealname = requireNonEmptyString(properties.dealname, 'dealname');
  }

  if (properties.amount !== undefined || requireStageAndPipeline) {
    properties.amount = normaliseAmount(properties.amount);
  }

  if (requireStageAndPipeline) {
    properties.pipeline = requireNonEmptyString(properties.pipeline, 'pipeline');
    properties.dealstage = requireNonEmptyString(properties.dealstage, 'dealstage');
  }

  return { properties, appliedAliases };
}

/**
 * Validates a HubSpot record identifier.
 *
 * HubSpot ids are numeric strings. Rejecting an obviously wrong one locally
 * avoids a request that could only ever 404, and catches the common mistake of
 * passing a whole record object where its id was wanted.
 *
 * @param {unknown} recordId
 * @param {string} [fieldName]
 * @returns {string}
 */
function validateRecordId(recordId, fieldName = 'recordId') {
  // Numbers are handled before the string check so that a caller passing `-1`
  // is told it is not a valid record id, rather than being told a number must
  // be a string — which is true but sends them to fix the wrong thing.
  if (typeof recordId === 'number') {
    if (Number.isInteger(recordId) && recordId > 0) {
      return String(recordId);
    }
    throw invalidPayload(
      `"${fieldName}" must be a numeric HubSpot record id, received ${JSON.stringify(recordId)}.`,
      fieldName
    );
  }

  const asString = requireNonEmptyString(recordId, fieldName);
  if (!/^\d+$/.test(asString)) {
    throw invalidPayload(
      `"${fieldName}" must be a numeric HubSpot record id, received ${JSON.stringify(recordId)}.`,
      fieldName
    );
  }
  return asString;
}

/**
 * The entry point named by the brief. Dispatches on object type.
 *
 * @param {string} objectType `contacts` or `deals`.
 * @param {object} payload The payload about to be sent.
 * @param {object} [options] Forwarded to the type-specific validator.
 * @returns {{properties: Record<string, unknown>, appliedAliases?: string[]}}
 * @throws {HubSpotApiError} With kind `VALIDATION` when the payload is invalid.
 */
function validateHubSpotPayload(objectType, payload, options = {}) {
  switch (objectType) {
    case 'contacts':
      return validateContactPayload(payload, options);
    case 'deals':
      return validateDealPayload(payload, options);
    default:
      throw invalidPayload(
        `No validator is defined for object type "${objectType}".`,
        'objectType'
      );
  }
}

module.exports = {
  validateHubSpotPayload,
  validateContactPayload,
  validateDealPayload,
  validateRecordId,
  normaliseDealProperties,
  normaliseAmount,
  EMAIL_PATTERN,
};
