'use strict';

/**
 * `propertyRepository` — the Properties endpoints.
 *
 * Required by the brief, which lists Properties among the official endpoints
 * that must be used.
 *
 * It is also how this project settles the discrepancy at the heart of the
 * exercise. The brief asks for deals carrying `hs_pipeline` and `hs_stage`;
 * those are Ticket properties, and the Deal object uses `pipeline` and
 * `dealstage`. Rather than argue that from documentation,
 * `verifyDealPropertyNames` asks the portal.
 *
 * Measured against hub 52018022: of its 206 deal properties, `pipeline` and
 * `dealstage` are present and `hs_pipeline`, `hs_stage` and
 * `hs_pipeline_stage` are absent.
 *
 * Like pipelines, property definitions are configuration rather than data, so
 * they are cached for the process lifetime.
 *
 * @see https://developers.hubspot.com/docs/api-reference/crm-properties-v3/guide
 */

const hubSpotClient = require('../clients/hubSpotClient');
const {
  getHubSpotConfig,
  OBJECT_TYPES,
  DEAL_PROPERTY_ALIASES,
} = require('../config/hubspot.config');

/** Cached property definitions, keyed by object type. */
const propertyCache = new Map();

/**
 * Reads every property defined for an object type.
 *
 * @param {string} objectType
 * @param {{useCache?: boolean}} [options]
 * @returns {Promise<object[]>}
 */
async function findProperties(objectType, options = {}) {
  const { useCache = true } = options;

  if (useCache && propertyCache.has(objectType)) {
    return propertyCache.get(objectType);
  }

  const config = getHubSpotConfig();
  const response = await hubSpotClient.get(config.paths.properties(objectType), undefined, {
    operationName: `read ${objectType} properties`,
  });

  const properties = response.results || [];
  propertyCache.set(objectType, properties);
  return properties;
}

/**
 * Returns the set of property internal names defined for an object type.
 *
 * @param {string} objectType
 * @param {{useCache?: boolean}} [options]
 * @returns {Promise<Set<string>>}
 */
async function findPropertyNames(objectType, options = {}) {
  const properties = await findProperties(objectType, options);
  return new Set(properties.map((property) => property.name));
}

/**
 * Checks which of a set of property names actually exist.
 *
 * Useful before a write: HubSpot rejects an unknown property with
 * `400 PROPERTY_DOESNT_EXIST`, and knowing in advance turns a failed request
 * into a message naming exactly which properties are wrong.
 *
 * @param {string} objectType
 * @param {string[]} propertyNames
 * @returns {Promise<{existing: string[], missing: string[]}>}
 */
async function checkPropertiesExist(objectType, propertyNames) {
  const definedNames = await findPropertyNames(objectType);

  const existing = [];
  const missing = [];
  for (const propertyName of propertyNames) {
    (definedNames.has(propertyName) ? existing : missing).push(propertyName);
  }

  return { existing, missing };
}

/**
 * Verifies the deal property alias mapping against the live portal.
 *
 * Returns, for each alias the brief uses, whether the alias itself exists,
 * whether the property it translates to exists, and therefore whether the
 * translation is necessary. This is the evidence behind decision D5, produced
 * from the portal rather than from documentation.
 *
 * @returns {Promise<{
 *   aliases: Array<{briefName: string, actualName: string, briefNameExists: boolean, actualNameExists: boolean, translationRequired: boolean}>,
 *   totalDealProperties: number
 * }>}
 */
async function verifyDealPropertyNames() {
  const properties = await findProperties(OBJECT_TYPES.DEALS);
  const definedNames = new Set(properties.map((property) => property.name));

  const aliases = Object.entries(DEAL_PROPERTY_ALIASES).map(([briefName, actualName]) => {
    const briefNameExists = definedNames.has(briefName);
    const actualNameExists = definedNames.has(actualName);

    return {
      briefName,
      actualName,
      briefNameExists,
      actualNameExists,
      // Translation is required precisely when the brief's spelling is absent
      // and the one it maps to is present.
      translationRequired: !briefNameExists && actualNameExists,
    };
  });

  return { aliases, totalDealProperties: properties.length };
}

/**
 * Clears the cache. Test seam.
 *
 * @returns {void}
 */
function resetPropertyCache() {
  propertyCache.clear();
}

module.exports = {
  findProperties,
  findPropertyNames,
  checkPropertiesExist,
  verifyDealPropertyNames,
  resetPropertyCache,
};
