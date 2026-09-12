#!/usr/bin/env node
'use strict';

/**
 * Portal diagnostic.
 *
 * Answers, against the live portal, the four questions that every later
 * failure traces back to:
 *
 *   1. Does the token authenticate, and which hub and app does it belong to?
 *   2. Which scopes were actually granted, and is anything this project needs
 *      missing?
 *   3. Which deal property names really exist — settling the `hs_pipeline`
 *      versus `pipeline` question empirically rather than by argument?
 *   4. Which pipeline and stage ids should go in `.env`?
 *
 * It deliberately uses axios directly instead of `hubSpotClient`. A diagnostic
 * must not share the code path it is diagnosing: if the client's auth or retry
 * logic were broken, a probe built on it would report the symptom rather than
 * the cause.
 *
 * Output contains record and portal identifiers, which are not secrets. The
 * token never appears: every write goes through the redacting logger.
 *
 * Usage: npm run probe
 */

const axios = require('axios');

const { getEnvironment } = require('../src/config/env');
const { getHubSpotConfig, OBJECT_TYPES } = require('../src/config/hubspot.config');
const { InvalidConfigurationError } = require('../src/errors/InvalidConfigurationError');
const { redactSecrets } = require('../src/utils/redactSecrets');

/** Scopes this project needs, mapped to the operations that require them. */
const REQUIRED_SCOPES = Object.freeze({
  'crm.objects.contacts.read': 'getHubSpotContactNames, getHubSpotContacts',
  'crm.objects.contacts.write': 'createHubSpotContact, updateHubSpotContact, deleteHubSpotContact',
  'crm.objects.deals.read': 'getHubSpotDeals',
  'crm.objects.deals.write': 'createHubSpotDeal, updateHubSpotDeal, deleteHubSpotDeal',
  'crm.schemas.deals.read': 'pipelineRepository, propertyRepository',
});

/** Deal property names the brief mentions, checked against what the portal has. */
const DEAL_PROPERTY_NAMES_UNDER_TEST = Object.freeze([
  'dealname',
  'amount',
  'pipeline',
  'dealstage',
  'hs_pipeline',
  'hs_stage',
  'hs_pipeline_stage',
]);

const heading = (title) => `\n${title}\n${'-'.repeat(74)}`;
const mark = (isPresent) => (isPresent ? '  OK  ' : ' MISS ');

/**
 * Runs one probe step, converting any failure into a reported outcome rather
 * than aborting the run. A missing scope should not hide the pipeline ids that
 * the very next step would have printed.
 *
 * @param {string} label
 * @param {() => Promise<void>} step
 * @returns {Promise<boolean>} Whether the step succeeded.
 */
async function runStep(label, step) {
  try {
    await step();
    return true;
  } catch (error) {
    const status = error.response?.status;
    const body = error.response?.data;
    process.stdout.write(`  FAILED${status ? ` (HTTP ${status})` : ''}: ${error.message}\n`);
    if (body) {
      process.stdout.write(`  ${JSON.stringify(redactSecrets(body)).slice(0, 300)}\n`);
    }
    if (status === 403) {
      process.stdout.write(`  This is usually a missing scope on the private app.\n`);
    }
    process.stdout.write(`  Step "${label}" could not complete; continuing.\n`);
    return false;
  }
}

async function main() {
  let environment;
  let config;

  try {
    environment = getEnvironment();
    config = getHubSpotConfig();
  } catch (error) {
    if (error instanceof InvalidConfigurationError) {
      process.stderr.write(`\n${error.toDisplayString()}\n\n`);
      process.exit(1);
    }
    throw error;
  }

  const httpClient = axios.create({
    baseURL: config.baseUrl,
    timeout: config.requestTimeoutMs,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    // Statuses are inspected rather than thrown on, so a 403 prints its body.
    validateStatus: () => true,
  });

  /**
   * Issues a request and throws on a non-2xx so `runStep` can report it.
   *
   * @param {'get'|'post'} method
   * @param {string} requestPath
   * @param {object} [body]
   * @returns {Promise<object>}
   */
  const request = async (method, requestPath, body) => {
    const response =
      method === 'get'
        ? await httpClient.get(requestPath)
        : await httpClient.post(requestPath, body);

    if (response.status >= 400) {
      const failure = new Error(
        `${method.toUpperCase()} ${requestPath} returned ${response.status}`
      );
      failure.response = response;
      throw failure;
    }
    return response;
  };

  process.stdout.write('\nHubSpot portal probe\n');
  process.stdout.write('='.repeat(74) + '\n');
  process.stdout.write(`base URL   : ${config.baseUrl}\n`);
  process.stdout.write(`objects API: ${environment.objectsApiVersion}\n`);
  process.stdout.write(`assoc. API : ${environment.associationsApiVersion}\n`);

  // --- 1. Identity and scopes ----------------------------------------------
  process.stdout.write(heading('1. Token identity and granted scopes'));
  const grantedScopes = new Set();

  await runStep('token introspection', async () => {
    const { data } = await request('post', config.paths.privateAppTokenInfo(), {
      tokenKey: config.accessToken,
    });

    process.stdout.write(`  hub id      : ${data.hubId}\n`);
    process.stdout.write(`  app id      : ${data.appId}\n`);
    process.stdout.write(`  hub domain  : ${data.hubDomain || 'n/a'}\n`);
    process.stdout.write(`  user id     : ${data.userId || 'n/a'}\n`);
    process.stdout.write(`  token type  : ${data.tokenType || 'private app'}\n`);

    for (const scope of data.scopes || []) {
      grantedScopes.add(scope);
    }
    process.stdout.write(`  scopes      : ${grantedScopes.size} granted\n`);
  });

  if (grantedScopes.size > 0) {
    process.stdout.write('\n  Required scopes for this project:\n');
    let anyScopeMissing = false;
    for (const [scopeName, usedBy] of Object.entries(REQUIRED_SCOPES)) {
      const isGranted = grantedScopes.has(scopeName);
      anyScopeMissing = anyScopeMissing || !isGranted;
      process.stdout.write(`  [${mark(isGranted)}] ${scopeName.padEnd(32)} ${usedBy}\n`);
    }
    if (anyScopeMissing) {
      process.stdout.write(
        '\n  Add the missing scopes in HubSpot > Settings > Integrations >\n' +
          '  Private Apps > your app > Scopes, then regenerate nothing: the\n' +
          '  existing token picks up scope changes immediately.\n'
      );
    }
  }

  // --- 2. Deal properties ---------------------------------------------------
  process.stdout.write(heading('2. Deal property names (settles hs_pipeline vs pipeline)'));

  await runStep('read deal properties', async () => {
    const { data } = await request('get', config.paths.properties(OBJECT_TYPES.DEALS));
    const existingNames = new Set(data.results.map((property) => property.name));

    for (const propertyName of DEAL_PROPERTY_NAMES_UNDER_TEST) {
      const exists = existingNames.has(propertyName);
      process.stdout.write(`  [${mark(exists)}] ${propertyName}\n`);
    }
    process.stdout.write(`\n  ${data.results.length} deal properties defined in this portal.\n`);
  });

  // --- 3. Pipelines ---------------------------------------------------------
  process.stdout.write(heading('3. Deal pipelines and stages (values for .env)'));

  await runStep('read deal pipelines', async () => {
    const { data } = await request('get', config.paths.pipelines(OBJECT_TYPES.DEALS));

    for (const pipeline of data.results) {
      process.stdout.write(`\n  pipeline "${pipeline.label}"\n`);
      process.stdout.write(`    HUBSPOT_PIPELINE_ID=${pipeline.id}\n`);
      const orderedStages = [...pipeline.stages].sort(
        (first, second) => first.displayOrder - second.displayOrder
      );
      for (const stage of orderedStages) {
        process.stdout.write(`      stage "${stage.label}" -> HUBSPOT_STAGE_ID=${stage.id}\n`);
      }
    }
  });

  // --- 4. Read smoke test and rate-limit headers ----------------------------
  process.stdout.write(heading('4. Read smoke test and rate-limit headers'));

  await runStep('list contacts', async () => {
    const response = await request(
      'get',
      `${config.paths.objectCollection(OBJECT_TYPES.CONTACTS)}?limit=2`
    );
    const hasNextPage = Boolean(response.data.paging?.next?.after);
    process.stdout.write(`  contacts returned : ${response.data.results.length}\n`);
    process.stdout.write(`  more pages available: ${hasNextPage}\n`);

    const rateLimitHeaders = Object.entries(response.headers).filter(([headerName]) =>
      headerName.toLowerCase().startsWith('x-hubspot-ratelimit')
    );
    if (rateLimitHeaders.length > 0) {
      process.stdout.write('\n  rate limit headers:\n');
      for (const [headerName, headerValue] of rateLimitHeaders) {
        process.stdout.write(`    ${headerName}: ${headerValue}\n`);
      }
    }
  });

  process.stdout.write('\n' + '='.repeat(74) + '\n');
  process.stdout.write('Probe complete.\n\n');
}

main().catch((error) => {
  process.stderr.write(`\nProbe failed unexpectedly: ${error.message}\n`);
  process.exit(1);
});
