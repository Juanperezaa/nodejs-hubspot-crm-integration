'use strict';

/**
 * Cursor pagination for HubSpot CRM list endpoints.
 *
 * HubSpot paginates by opaque cursor, not offset: a response carries
 * `paging.next.after`, and its absence is the only signal that the last page
 * has been read. Getting this wrong is the single most common defect in a
 * HubSpot integration — either the first page is mistaken for the whole result
 * set, or a loop never terminates.
 *
 * Exposed as an **async generator** so callers consume records with
 * `for await`, one at a time, and memory stays constant no matter how many
 * records the portal holds. A function returning a fully-materialised array
 * would defeat that: a portal with fifty thousand contacts would need all fifty
 * thousand in memory before the caller saw the first one.
 *
 * `collectAllPages` is provided for the cases where an array genuinely is
 * wanted, so that the convenience is an explicit choice rather than the default.
 *
 * @see https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide
 */

const { PAGINATION_LIMITS } = require('../config/hubspot.config');

/**
 * A guard against a non-terminating loop.
 *
 * If HubSpot ever returned a cursor that did not advance, a `while` loop would
 * spin forever, consuming the daily rate-limit budget in minutes. The ceiling
 * is high enough never to be reached legitimately by a CRM list and low enough
 * to fail within seconds when something is wrong.
 */
const MAXIMUM_PAGES = 10000;

/**
 * Yields every record across every page.
 *
 * @param {(query: object) => Promise<{results: object[], paging?: {next?: {after?: string}}}>} fetchPage
 *   Issues one request. Receives the query parameters to send.
 * @param {object} [options]
 * @param {number} [options.pageSize] Records per request. Clamped to HubSpot's maximum of 100.
 * @param {string[]} [options.properties] Property internal names to return.
 * @param {string[]} [options.associations] Object types whose associations to include.
 * @param {boolean} [options.archived] Whether to read archived records.
 * @param {number} [options.limit] Stop after this many records in total.
 * @yields {object} One record at a time.
 */
async function* paginateAll(fetchPage, options = {}) {
  const {
    pageSize = PAGINATION_LIMITS.MAX_LIST_PAGE_SIZE,
    properties,
    associations,
    archived,
    limit,
  } = options;

  const effectivePageSize = Math.min(pageSize, PAGINATION_LIMITS.MAX_LIST_PAGE_SIZE);

  let cursor;
  let pagesRead = 0;
  let recordsYielded = 0;
  const seenCursors = new Set();

  do {
    if (pagesRead >= MAXIMUM_PAGES) {
      throw new Error(
        `Pagination exceeded ${MAXIMUM_PAGES} pages, which indicates a cursor that is not advancing.`
      );
    }

    const query = { limit: effectivePageSize };
    if (cursor !== undefined) {
      query.after = cursor;
    }
    if (properties !== undefined) {
      // HubSpot expects a comma-separated list, not a repeated parameter.
      query.properties = Array.isArray(properties) ? properties.join(',') : properties;
    }
    if (associations !== undefined) {
      query.associations = Array.isArray(associations) ? associations.join(',') : associations;
    }
    if (archived !== undefined) {
      query.archived = archived;
    }

    const page = await fetchPage(query);
    pagesRead += 1;

    for (const record of page.results || []) {
      yield record;
      recordsYielded += 1;

      if (limit !== undefined && recordsYielded >= limit) {
        return;
      }
    }

    const nextCursor = page.paging?.next?.after;

    // A cursor that repeats means the endpoint is looping. Detecting it here
    // gives a diagnosable error instead of an infinite request loop.
    if (nextCursor !== undefined && seenCursors.has(nextCursor)) {
      throw new Error(`Pagination returned a repeated cursor (${nextCursor}); aborting.`);
    }
    if (nextCursor !== undefined) {
      seenCursors.add(nextCursor);
    }

    // The absence of paging.next.after is the only end-of-results signal.
    cursor = nextCursor;
  } while (cursor !== undefined);
}

/**
 * Materialises every page into a single array.
 *
 * A deliberate convenience, not the default. Callers that reach for this on a
 * large portal are choosing to hold the whole result set in memory, and the
 * separate name makes that choice visible in the calling code.
 *
 * @param {(query: object) => Promise<object>} fetchPage
 * @param {object} [options] As `paginateAll`.
 * @returns {Promise<object[]>}
 */
async function collectAllPages(fetchPage, options = {}) {
  const collected = [];
  for await (const record of paginateAll(fetchPage, options)) {
    collected.push(record);
  }
  return collected;
}

/**
 * Splits an array into chunks a batch endpoint will accept.
 *
 * HubSpot's batch endpoints reject more than 100 inputs per request, so a sync
 * of five hundred contacts is five requests rather than one rejected one.
 *
 * @param {T[]} items
 * @param {number} [chunkSize]
 * @returns {T[][]}
 * @template T
 */
function chunkForBatch(items, chunkSize = PAGINATION_LIMITS.MAX_BATCH_INPUTS) {
  const effectiveSize = Math.min(chunkSize, PAGINATION_LIMITS.MAX_BATCH_INPUTS);
  const chunks = [];

  for (let index = 0; index < items.length; index += effectiveSize) {
    chunks.push(items.slice(index, index + effectiveSize));
  }

  return chunks;
}

module.exports = { paginateAll, collectAllPages, chunkForBatch, MAXIMUM_PAGES };
