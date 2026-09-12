'use strict';

/**
 * The single source of truth for what the technical brief demands.
 *
 * Every entry maps one requirement to the module that must satisfy it and the
 * export that must be reachable. `scripts/verify-requirements.js` walks this
 * manifest and proves each entry mechanically, so requirement coverage is an
 * executable claim rather than a paragraph in a README.
 *
 * `kind` drives how an entry is checked:
 *   - `function` : the named export must exist and be callable
 *   - `module`   : the module must load and export a non-empty object
 *   - `file`     : the file must exist on disk (used for the fundamentals
 *                  exercises, which are demonstration scripts rather than
 *                  library surface)
 */

/** @type {ReadonlyArray<{id: string, requirement: string, kind: string, modulePath: string, exportName?: string, section: string}>} */
const REQUIRED_ARTEFACTS = [
  // --- Section: Core HubSpot functions -------------------------------------
  {
    id: 'R01',
    requirement: 'getHubSpotContactNames — full names for all contacts, paginated',
    kind: 'function',
    modulePath: 'src/services/hubSpotService.js',
    exportName: 'getHubSpotContactNames',
    section: 'Core HubSpot functions',
  },
  {
    id: 'R02',
    requirement: 'getHubSpotContacts — paginated contact details with options',
    kind: 'function',
    modulePath: 'src/services/hubSpotService.js',
    exportName: 'getHubSpotContacts',
    section: 'Core HubSpot functions',
  },
  {
    id: 'R03',
    requirement: 'createHubSpotContact — creates a contact (POST)',
    kind: 'function',
    modulePath: 'src/services/hubSpotService.js',
    exportName: 'createHubSpotContact',
    section: 'Core HubSpot functions',
  },
  {
    id: 'R04',
    requirement: 'updateHubSpotContact — updates contact properties (PATCH)',
    kind: 'function',
    modulePath: 'src/services/hubSpotService.js',
    exportName: 'updateHubSpotContact',
    section: 'Core HubSpot functions',
  },
  {
    id: 'R05',
    requirement: 'deleteHubSpotContact — deletes a contact (DELETE)',
    kind: 'function',
    modulePath: 'src/services/hubSpotService.js',
    exportName: 'deleteHubSpotContact',
    section: 'Core HubSpot functions',
  },
  {
    id: 'R06',
    requirement: 'getHubSpotDeals — lists deals with pagination',
    kind: 'function',
    modulePath: 'src/services/hubSpotService.js',
    exportName: 'getHubSpotDeals',
    section: 'Core HubSpot functions',
  },
  {
    id: 'R07',
    requirement: 'createHubSpotDeal — creates a deal with name, amount, pipeline and stage',
    kind: 'function',
    modulePath: 'src/services/hubSpotService.js',
    exportName: 'createHubSpotDeal',
    section: 'Core HubSpot functions',
  },
  {
    id: 'R08',
    requirement: 'updateHubSpotDeal — updates a deal',
    kind: 'function',
    modulePath: 'src/services/hubSpotService.js',
    exportName: 'updateHubSpotDeal',
    section: 'Core HubSpot functions',
  },
  {
    id: 'R09',
    requirement: 'deleteHubSpotDeal — deletes a deal',
    kind: 'function',
    modulePath: 'src/services/hubSpotService.js',
    exportName: 'deleteHubSpotDeal',
    section: 'Core HubSpot functions',
  },

  // --- Section: Associations and synchronisation ---------------------------
  {
    id: 'R10',
    requirement: 'associateContactToDeal — associates a contact with a deal',
    kind: 'function',
    modulePath: 'src/services/hubSpotService.js',
    exportName: 'associateContactToDeal',
    section: 'Associations and sync',
  },
  {
    id: 'R11',
    requirement: 'syncContactsWithHubSpot — idempotent contact sync from a local source',
    kind: 'function',
    modulePath: 'src/services/contactSyncService.js',
    exportName: 'syncContactsWithHubSpot',
    section: 'Associations and sync',
  },
  {
    id: 'R12',
    requirement: 'syncDealsWithHubSpot — idempotent deal sync from a local source',
    kind: 'function',
    modulePath: 'src/services/dealSyncService.js',
    exportName: 'syncDealsWithHubSpot',
    section: 'Associations and sync',
  },

  // --- Section: Infrastructure, services, utilities ------------------------
  {
    id: 'R13',
    requirement: 'hubSpotClient — central HTTP client configurable via config and env vars',
    kind: 'module',
    modulePath: 'src/clients/hubSpotClient.js',
    section: 'Infra / service / utils',
  },
  {
    id: 'R14',
    requirement: 'hubSpotService — orchestrator built on hubSpotClient',
    kind: 'module',
    modulePath: 'src/services/hubSpotService.js',
    section: 'Infra / service / utils',
  },
  {
    id: 'R15a',
    requirement: 'contactRepository — encapsulates contact CRUD calls',
    kind: 'module',
    modulePath: 'src/repositories/contactRepository.js',
    section: 'Infra / service / utils',
  },
  {
    id: 'R15b',
    requirement: 'dealRepository — encapsulates deal CRUD calls',
    kind: 'module',
    modulePath: 'src/repositories/dealRepository.js',
    section: 'Infra / service / utils',
  },
  {
    id: 'R16',
    requirement: 'validateHubSpotPayload — validates payloads before sending',
    kind: 'function',
    modulePath: 'src/utils/validateHubSpotPayload.js',
    exportName: 'validateHubSpotPayload',
    section: 'Infra / service / utils',
  },
  {
    id: 'R17',
    requirement: 'handleHubSpotErrors — normalises and logs errors, retries with backoff',
    kind: 'function',
    modulePath: 'src/utils/handleHubSpotErrors.js',
    exportName: 'handleHubSpotErrors',
    section: 'Infra / service / utils',
  },
  {
    id: 'R18',
    requirement: 'hubSpotApiHandler — executable handler for testing operations',
    kind: 'module',
    modulePath: 'src/api/hubSpotApiHandler.js',
    section: 'API / examples',
  },

  // --- Section 1: Node.js fundamentals -------------------------------------
  {
    id: 'R19',
    requirement: 'Asynchronous operation demonstrated with a callback',
    kind: 'file',
    modulePath: 'src/fundamentals/callbacks.js',
    section: 'Section 1 — fundamentals',
  },
  {
    id: 'R20',
    requirement: 'Promise refactor consumed with async/await',
    kind: 'file',
    modulePath: 'src/fundamentals/asyncAwait.js',
    section: 'Section 1 — fundamentals',
  },
  {
    id: 'R21a',
    requirement: 'utils_module.js — CommonJS export summing an array of numbers',
    kind: 'function',
    modulePath: 'src/fundamentals/utils_module.js',
    exportName: 'sumArrayOfNumbers',
    section: 'Section 1 — fundamentals',
  },
  {
    id: 'R21b',
    requirement: 'main.js — imports and uses utils_module.js',
    kind: 'file',
    modulePath: 'src/fundamentals/main.js',
    section: 'Section 1 — fundamentals',
  },
  {
    id: 'R22',
    requirement: 'Stream from Readable.from, uppercase transform, piped to stdout',
    kind: 'file',
    modulePath: 'src/utils/streams.js',
    section: 'Section 1 — fundamentals',
  },

  // --- Repositories required by the mandatory endpoint list ----------------
  {
    id: 'R23a',
    requirement: 'associationRepository — official Associations endpoints',
    kind: 'module',
    modulePath: 'src/repositories/associationRepository.js',
    section: 'Mandatory endpoint coverage',
  },
  {
    id: 'R23b',
    requirement: 'pipelineRepository — official Pipelines endpoints',
    kind: 'module',
    modulePath: 'src/repositories/pipelineRepository.js',
    section: 'Mandatory endpoint coverage',
  },
  {
    id: 'R23c',
    requirement: 'propertyRepository — official Properties endpoints',
    kind: 'module',
    modulePath: 'src/repositories/propertyRepository.js',
    section: 'Mandatory endpoint coverage',
  },
];

module.exports = { REQUIRED_ARTEFACTS };
