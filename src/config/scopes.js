'use strict';

/**
 * The scope requirements of every endpoint this project calls.
 *
 * Kept as data rather than prose so that `npm run probe` can check a live
 * token against it endpoint by endpoint, and report not merely "a scope is
 * missing" but *which operations that breaks*.
 *
 * HubSpot's reference pages state scope requirements as **"requires one of the
 * following scopes"**. So `anyOf` is the accurate shape: an endpoint is
 * permitted when the token holds *at least one* listed scope, not all of them.
 * Modelling this as a flat required-list would report false failures.
 *
 * Verified against the official documentation on 2026-09-11. Sources are listed
 * per entry in docs/API_REFERENCE.md.
 */

/**
 * Scopes this project asks the operator to grant.
 *
 * Four are load-bearing. The two `crm.schemas.*.read` entries are redundant
 * given the object read scopes — because the requirement is "one of" — and are
 * requested anyway: they cost nothing, HubSpot lists them first for the
 * Properties and Pipelines endpoints, and dropping them for minimal-privilege
 * purism would trade a real failure risk for no real gain.
 */
const REQUESTED_SCOPES = Object.freeze([
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.schemas.deals.read',
  'crm.schemas.contacts.read',
]);

/**
 * Scopes this project deliberately does **not** request, and why.
 *
 * Recorded because "we did not need it" is a stronger claim than silence, and
 * because the reasoning constrains future design: adding a feature that needs
 * one of these is a decision with a cost, not a free change.
 */
const DELIBERATELY_OMITTED_SCOPES = Object.freeze({
  'crm.schemas.deals.write':
    'Would be required to create a custom correlation property for idempotent ' +
    'deal synchronisation. Avoided by correlating on dealname through the Search ' +
    'API instead, which needs no schema changes and leaves no residual custom ' +
    'properties in the portal.',
  'crm.objects.companies.read':
    'The brief covers Contacts and Deals only. Companies are never read.',
  'crm.objects.owners.read': 'hubspot_owner_id is never set, so owner lookup is unnecessary.',
  'crm.lists.read': 'List membership is outside the scope of the brief.',
});

/**
 * Every endpoint the project calls, with the scopes that authorise it.
 *
 * `anyOf: []` means the endpoint requires no scope at all — true only of the
 * token introspection endpoint, which is authenticated by the token it is
 * being asked about.
 */
const ENDPOINT_SCOPE_REQUIREMENTS = Object.freeze([
  // --- Contacts ------------------------------------------------------------
  {
    operation: 'List contacts',
    method: 'GET',
    path: '/crm/v3/objects/contacts',
    anyOf: ['crm.objects.contacts.read'],
    usedBy: ['getHubSpotContactNames', 'getHubSpotContacts'],
  },
  {
    operation: 'Create contact',
    method: 'POST',
    path: '/crm/v3/objects/contacts',
    anyOf: ['crm.objects.contacts.write'],
    usedBy: ['createHubSpotContact'],
  },
  {
    operation: 'Update contact',
    method: 'PATCH',
    path: '/crm/v3/objects/contacts/{contactId}',
    anyOf: ['crm.objects.contacts.write'],
    usedBy: ['updateHubSpotContact'],
  },
  {
    operation: 'Delete contact',
    method: 'DELETE',
    path: '/crm/v3/objects/contacts/{contactId}',
    anyOf: ['crm.objects.contacts.write'],
    usedBy: ['deleteHubSpotContact'],
  },
  {
    operation: 'Upsert contacts by email',
    method: 'POST',
    path: '/crm/v3/objects/contacts/batch/upsert',
    anyOf: ['crm.objects.contacts.write'],
    usedBy: ['syncContactsWithHubSpot'],
  },
  {
    operation: 'Search contacts',
    method: 'POST',
    path: '/crm/v3/objects/contacts/search',
    anyOf: ['crm.objects.contacts.read'],
    usedBy: ['syncDealsWithHubSpot'],
  },

  // --- Deals ---------------------------------------------------------------
  {
    operation: 'List deals',
    method: 'GET',
    path: '/crm/v3/objects/deals',
    anyOf: ['crm.objects.deals.read'],
    usedBy: ['getHubSpotDeals'],
  },
  {
    operation: 'Create deal',
    method: 'POST',
    path: '/crm/v3/objects/deals',
    anyOf: ['crm.objects.deals.write'],
    usedBy: ['createHubSpotDeal'],
  },
  {
    operation: 'Update deal',
    method: 'PATCH',
    path: '/crm/v3/objects/deals/{dealId}',
    anyOf: ['crm.objects.deals.write'],
    usedBy: ['updateHubSpotDeal'],
  },
  {
    operation: 'Delete deal',
    method: 'DELETE',
    path: '/crm/v3/objects/deals/{dealId}',
    anyOf: ['crm.objects.deals.write'],
    usedBy: ['deleteHubSpotDeal'],
  },
  {
    operation: 'Search deals',
    method: 'POST',
    path: '/crm/v3/objects/deals/search',
    anyOf: ['crm.objects.deals.read'],
    usedBy: ['syncDealsWithHubSpot'],
  },

  // --- Associations --------------------------------------------------------
  // No dedicated association scope exists. The v4 endpoints are authorised by
  // the object scopes of both objects involved.
  {
    operation: 'Associate a contact with a deal',
    method: 'PUT',
    path: '/crm/v4/objects/contacts/{contactId}/associations/default/deals/{dealId}',
    anyOf: ['crm.objects.contacts.write', 'crm.objects.deals.write'],
    usedBy: ['associateContactToDeal'],
  },
  {
    operation: 'Read a record’s associations',
    method: 'GET',
    path: '/crm/v4/objects/contacts/{contactId}/associations/deals',
    anyOf: ['crm.objects.contacts.read', 'crm.objects.deals.read'],
    usedBy: ['associateContactToDeal'],
  },

  // --- Pipelines and properties --------------------------------------------
  {
    operation: 'Read deal pipelines and stages',
    method: 'GET',
    path: '/crm/v3/pipelines/deals',
    anyOf: ['crm.objects.deals.read', 'crm.schemas.deals.read'],
    usedBy: ['pipelineRepository', 'probe'],
  },
  {
    operation: 'Read deal properties',
    method: 'GET',
    path: '/crm/v3/properties/deals',
    anyOf: ['crm.schemas.deals.read', 'crm.objects.deals.read'],
    usedBy: ['propertyRepository', 'probe'],
  },
  {
    operation: 'Read contact properties',
    method: 'GET',
    path: '/crm/v3/properties/contacts',
    anyOf: ['crm.schemas.contacts.read', 'crm.objects.contacts.read'],
    usedBy: ['propertyRepository'],
  },

  // --- Authentication -------------------------------------------------------
  {
    operation: 'Introspect the private app token',
    method: 'POST',
    path: '/oauth/v2/private-apps/get/access-token-info',
    // Authenticated by the very token it reports on, so it needs no scope.
    anyOf: [],
    usedBy: ['probe'],
  },
]);

/**
 * Checks a set of granted scopes against every endpoint requirement.
 *
 * @param {Iterable<string>} grantedScopes Scopes the token actually carries.
 * @returns {{
 *   satisfied: Array<object>,
 *   blocked: Array<object>,
 *   missingScopes: string[],
 *   isFullyCovered: boolean
 * }}
 */
function auditScopeCoverage(grantedScopes) {
  const granted = new Set(grantedScopes);

  const satisfied = [];
  const blocked = [];

  for (const requirement of ENDPOINT_SCOPE_REQUIREMENTS) {
    // An empty anyOf means no scope is needed, so the endpoint is always usable.
    const isPermitted =
      requirement.anyOf.length === 0 ||
      requirement.anyOf.some((scopeName) => granted.has(scopeName));

    (isPermitted ? satisfied : blocked).push(requirement);
  }

  // Report the scopes that would unblock something, not every scope absent
  // from the token: suggesting scopes nothing needs is noise.
  const missingScopes = [...new Set(blocked.flatMap((requirement) => requirement.anyOf))].sort();

  return {
    satisfied,
    blocked,
    missingScopes,
    isFullyCovered: blocked.length === 0,
  };
}

module.exports = {
  REQUESTED_SCOPES,
  DELIBERATELY_OMITTED_SCOPES,
  ENDPOINT_SCOPE_REQUIREMENTS,
  auditScopeCoverage,
};
