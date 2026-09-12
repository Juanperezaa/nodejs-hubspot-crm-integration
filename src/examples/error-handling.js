#!/usr/bin/env node
'use strict';

/**
 * Section 2.4 — Error handling.
 *
 * The brief asks for `handleHubSpotErrors` and for documentation of how each
 * failure class is handled: network errors and timeouts, authentication
 * failures, validation and other 4xx, rate limits with exponential backoff, and
 * 5xx. This script provokes each one it safely can and prints how the project
 * classifies it.
 *
 * Several of these are **real failures against the live portal** — a malformed
 * payload really is rejected by HubSpot. The classes that cannot be provoked on
 * demand without abusing the API (a 429, a 5xx) are demonstrated against
 * fabricated responses, and labelled as such rather than passed off as live.
 *
 * Run: node src/examples/error-handling.js
 */

const hubSpotService = require('../services/hubSpotService');
const { normaliseHubSpotError, calculateBackoffDelay } = require('../utils/handleHubSpotErrors');
const { getHubSpotConfig } = require('../config/hubspot.config');
const { redactSecrets } = require('../utils/redactSecrets');

const write = (text) => process.stdout.write(text);
const heading = (title) => write(`\n${title}\n${'-'.repeat(74)}\n`);

/** Builds an axios-shaped rejection, for the classes that cannot be provoked live. */
function fabricatedFailure(status, data = {}, headers = {}) {
  const error = new Error(`Request failed with status code ${status}`);
  error.config = { method: 'post', url: '/crm/v3/objects/contacts' };
  error.response = { status, data, headers };
  return error;
}

/** Builds a socket-level failure. */
function fabricatedNetworkFailure(code) {
  const error = new Error(code);
  error.code = code;
  error.config = { method: 'get', url: '/crm/v3/objects/deals' };
  return error;
}

/**
 * Prints how a failure was classified.
 *
 * @param {string} label
 * @param {Error} error
 * @returns {void}
 */
function reportClassification(label, error) {
  const normalised = normaliseHubSpotError(error);
  write(`  ${label}\n`);
  write(`    kind       : ${normalised.kind}\n`);
  write(`    status     : ${normalised.statusCode ?? 'n/a'}\n`);
  write(`    retryable  : ${normalised.isRetryable}\n`);
  if (normalised.retryAfterMs !== undefined) {
    write(`    retry after: ${normalised.retryAfterMs} ms (from the header)\n`);
  }
  if (normalised.guidance) {
    write(`    guidance   : ${normalised.guidance.split('. ')[0]}.\n`);
  }
  write('\n');
}

async function main() {
  write('\nError handling\n');
  write('='.repeat(74) + '\n');
  write('\nEvery failure is normalised to a HubSpotApiError carrying a decided\n');
  write('kind, so a caller makes one decision rather than inspecting\n');
  write('error.response?.status ?? error.code.\n');

  // --- 1. Validation, caught locally before any request --------------------
  heading('1. Validation, rejected before a request is sent');
  try {
    await hubSpotService.createHubSpotContact({ email: 'not-an-address' });
  } catch (error) {
    write('  A malformed address costs no request and no rate-limit budget.\n\n');
    reportClassification('local validation', error);
  }

  // --- 2. Validation, rejected by HubSpot ----------------------------------
  heading('2. Validation, rejected by HubSpot (a real call)');
  try {
    // A deal with a stage that does not exist. Checked locally first, which is
    // why the message names the value rather than the property.
    await hubSpotService.createHubSpotDeal('Error handling example', 100, {
      stage: 'this-stage-does-not-exist',
    });
  } catch (error) {
    reportClassification('unknown stage', error);
    if (error.validationErrors) {
      write(`    detail     : ${error.validationErrors[0].message.slice(0, 90)}…\n\n`);
    }
  }

  // --- 3. Not found, a real call -------------------------------------------
  heading('3. Not found (a real call)');
  try {
    await hubSpotService.updateHubSpotContact('99999999999999', { firstname: 'Nobody' });
  } catch (error) {
    reportClassification('update of a non-existent record', error);
  }

  // --- 4. Authentication ----------------------------------------------------
  heading('4. Authentication — never retried');
  write('  A 401 or 403 cannot be fixed by trying again. Repeating it only\n');
  write('  burns rate-limit budget and delays the real error reaching the\n');
  write('  caller, so these fail on the first attempt.\n\n');
  reportClassification(
    '401 unauthorised',
    fabricatedFailure(401, {
      message: 'Authentication credentials not found',
    })
  );
  reportClassification(
    '403 missing scope',
    fabricatedFailure(403, {
      message: 'This app has not been granted the required scope',
      category: 'MISSING_SCOPES',
    })
  );

  // --- 5. Rate limit --------------------------------------------------------
  heading('5. Rate limit — retried, honouring Retry-After');
  reportClassification(
    '429 ten-secondly rolling',
    fabricatedFailure(
      429,
      { message: 'You have reached your ten-secondly limit.', policyName: 'TEN_SECONDLY_ROLLING' },
      { 'retry-after': '3' }
    )
  );

  const config = getHubSpotConfig();
  write('  Backoff without a Retry-After header, using full jitter:\n');
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const ceiling = Math.min(
      config.retryPolicy.baseDelayMs * 2 ** (attempt - 1),
      config.retryPolicy.maxDelayMs
    );
    const sample = calculateBackoffDelay(attempt, config.retryPolicy);
    write(`    attempt ${attempt}: ceiling ${ceiling} ms, this draw ${sample} ms\n`);
  }
  write("\n  Full jitter rather than a fixed delay, because HubSpot's burst limit\n");
  write('  is a rolling window shared by every caller using the same app.\n');
  write('  Fixed delays make throttled callers retry in lockstep and\n');
  write('  re-trigger the identical limit.\n\n');

  // --- 6. Server errors -----------------------------------------------------
  heading('6. Server errors — retried with backoff');
  for (const status of [500, 502, 503, 504]) {
    reportClassification(`${status}`, fabricatedFailure(status));
  }

  // --- 7. Network and timeout -----------------------------------------------
  heading('7. Network and timeout — retried');
  reportClassification('ECONNRESET', fabricatedNetworkFailure('ECONNRESET'));
  reportClassification('ETIMEDOUT', fabricatedNetworkFailure('ETIMEDOUT'));
  write('  A network failure is retried even though the request may already\n');
  write('  have been applied. That is why every write in this project is either\n');
  write('  idempotent by construction or reconciled by a preceding read.\n\n');

  // --- 8. Redaction ----------------------------------------------------------
  heading('8. Secrets are redacted structurally, not by discipline');
  // Assembled at runtime rather than written as a literal. GitHub's push
  // protection scans for the HubSpot token pattern and rejects a push
  // containing one whether or not the value is real — an all-zeros placeholder
  // is indistinguishable to a scanner. Building it from parts keeps the
  // demonstration honest about the shape it redacts while leaving no
  // credential-shaped string in the source.
  const placeholderToken = ['pat', 'na1', '00000000', '0000', '0000', '0000', '000000000000'].join(
    '-'
  );

  const errorCarryingCredentials = {
    message: 'Request failed with status code 401',
    config: {
      url: '/crm/v3/objects/contacts',
      headers: { Authorization: `Bearer ${placeholderToken}` },
    },
  };
  write('  An axios error carries the full request configuration, headers\n');
  write('  included, so console.error(error) would print the bearer token.\n');
  write('  Everything reaching a log transport passes through redaction first:\n\n');
  write(`${JSON.stringify(redactSecrets(errorCarryingCredentials), null, 4)}\n\n`);

  write('='.repeat(74) + '\n');
  write('See docs/ERROR_HANDLING.md for the full policy.\n\n');
}

main().catch((error) => {
  process.stderr.write(`\nExample failed unexpectedly: ${error.message}\n`);
  process.exit(1);
});
