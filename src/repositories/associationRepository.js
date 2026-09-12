'use strict';

/**
 * `associationRepository` — the Associations endpoints.
 *
 * Required by the brief's mandatory endpoint list, and the mechanism behind
 * `associateContactToDeal`.
 *
 * **Associations need no scope of their own.** The v4 endpoints are authorised
 * by the object scopes of the objects involved, so `crm.objects.contacts.write`
 * together with `crm.objects.deals.write` is what permits creating one. There
 * is no `crm.associations.*` scope to add; `src/config/scopes.js` asserts this.
 *
 * **Idempotency comes free from the method.** Creating a default association is
 * a `PUT`, so repeating it is idempotent by HTTP semantics rather than by any
 * logic written here.
 *
 * @see https://developers.hubspot.com/docs/api-reference/crm-associations-v4/guide
 */

const hubSpotClient = require('../clients/hubSpotClient');
const {
  getHubSpotConfig,
  OBJECT_TYPES,
  ASSOCIATION_TYPE_IDS,
  ASSOCIATION_CATEGORIES,
} = require('../config/hubspot.config');
const { validateRecordId } = require('../utils/validateHubSpotPayload');

/**
 * Creates an unlabelled association between two records.
 *
 * HubSpot calls this the "default" association: the plain relationship with no
 * custom label attached, which is what Contact-to-Deal means in the ordinary
 * case.
 *
 * @param {string} fromObjectType
 * @param {string|number} fromRecordId
 * @param {string} toObjectType
 * @param {string|number} toRecordId
 * @returns {Promise<object>} HubSpot's response, listing the association types created.
 */
async function createDefaultAssociation(fromObjectType, fromRecordId, toObjectType, toRecordId) {
  const config = getHubSpotConfig();

  const created = await hubSpotClient.put(
    config.paths.associationDefault(
      fromObjectType,
      validateRecordId(fromRecordId, 'fromRecordId'),
      toObjectType,
      validateRecordId(toRecordId, 'toRecordId')
    ),
    undefined,
    { operationName: `associate ${fromObjectType} to ${toObjectType}` }
  );
  return created;
}

/**
 * Creates an association with an explicit type.
 *
 * Needed when the relationship is not the default one — a custom label, or one
 * of HubSpot's own typed relationships. The body is an array because a single
 * request may establish several types at once.
 *
 * @param {string} fromObjectType
 * @param {string|number} fromRecordId
 * @param {string} toObjectType
 * @param {string|number} toRecordId
 * @param {number} associationTypeId
 * @param {string} [associationCategory]
 * @returns {Promise<object>}
 */
async function createLabelledAssociation(
  fromObjectType,
  fromRecordId,
  toObjectType,
  toRecordId,
  associationTypeId,
  associationCategory = ASSOCIATION_CATEGORIES.HUBSPOT_DEFINED
) {
  const config = getHubSpotConfig();

  const created = await hubSpotClient.put(
    config.paths.associationLabelled(
      fromObjectType,
      validateRecordId(fromRecordId, 'fromRecordId'),
      toObjectType,
      validateRecordId(toRecordId, 'toRecordId')
    ),
    [{ associationCategory, associationTypeId }],
    { operationName: `associate ${fromObjectType} to ${toObjectType} with a type` }
  );
  return created;
}

/**
 * Lists a record's associations with a given object type.
 *
 * @param {string} fromObjectType
 * @param {string|number} fromRecordId
 * @param {string} toObjectType
 * @returns {Promise<object[]>} Each entry carries `toObjectId` and its association types.
 */
async function findAssociations(fromObjectType, fromRecordId, toObjectType) {
  const config = getHubSpotConfig();

  const response = await hubSpotClient.get(
    config.paths.associationList(
      fromObjectType,
      validateRecordId(fromRecordId, 'fromRecordId'),
      toObjectType
    ),
    undefined,
    { operationName: `read ${fromObjectType} associations to ${toObjectType}` }
  );

  return response.results || [];
}

/**
 * Reports whether two records are already associated.
 *
 * @param {string} fromObjectType
 * @param {string|number} fromRecordId
 * @param {string} toObjectType
 * @param {string|number} toRecordId
 * @returns {Promise<boolean>}
 */
async function isAssociated(fromObjectType, fromRecordId, toObjectType, toRecordId) {
  const associations = await findAssociations(fromObjectType, fromRecordId, toObjectType);
  const targetId = validateRecordId(toRecordId, 'toRecordId');

  return associations.some((association) => String(association.toObjectId) === targetId);
}

/**
 * Removes every association between two records.
 *
 * HubSpot's `DELETE` on the labelled path removes all association types
 * between the pair, not merely the default one.
 *
 * @param {string} fromObjectType
 * @param {string|number} fromRecordId
 * @param {string} toObjectType
 * @param {string|number} toRecordId
 * @returns {Promise<void>}
 */
async function removeAssociations(fromObjectType, fromRecordId, toObjectType, toRecordId) {
  const config = getHubSpotConfig();

  await hubSpotClient.delete(
    config.paths.associationLabelled(
      fromObjectType,
      validateRecordId(fromRecordId, 'fromRecordId'),
      toObjectType,
      validateRecordId(toRecordId, 'toRecordId')
    ),
    { operationName: `remove ${fromObjectType} associations to ${toObjectType}` }
  );
}

module.exports = {
  createDefaultAssociation,
  createLabelledAssociation,
  findAssociations,
  isAssociated,
  removeAssociations,
  OBJECT_TYPES,
  ASSOCIATION_TYPE_IDS,
};
