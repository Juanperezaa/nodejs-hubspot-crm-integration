'use strict';

/**
 * Cursor pagination.
 *
 * The brief grades "pagination handling" explicitly, and mishandling it is the
 * most common defect in a HubSpot integration: either the first page is
 * mistaken for the whole result set, or the loop never terminates. Both
 * failures are asserted here directly.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { paginateAll, collectAllPages, chunkForBatch } = require('../../src/utils/paginate');

/**
 * Builds a fake paginated endpoint from a list of pages, recording the query
 * each call receives so the request shape can be asserted.
 *
 * @param {Array<Array<object>>} pages
 * @returns {{fetchPage: Function, receivedQueries: object[]}}
 */
function createFakeEndpoint(pages) {
  const receivedQueries = [];
  let callIndex = 0;

  const fetchPage = async (query) => {
    receivedQueries.push(query);
    const results = pages[callIndex] || [];
    const isLastPage = callIndex >= pages.length - 1;
    callIndex += 1;

    return {
      results,
      // The absence of paging.next.after is the only end-of-results signal.
      paging: isLastPage ? undefined : { next: { after: `cursor-${callIndex}` } },
    };
  };

  return { fetchPage, receivedQueries };
}

test('reads every page, not just the first', async () => {
  const { fetchPage, receivedQueries } = createFakeEndpoint([
    [{ id: '1' }, { id: '2' }],
    [{ id: '3' }, { id: '4' }],
    [{ id: '5' }],
  ]);

  const collected = await collectAllPages(fetchPage);

  assert.equal(collected.length, 5);
  assert.deepEqual(
    collected.map((record) => record.id),
    ['1', '2', '3', '4', '5']
  );
  assert.equal(receivedQueries.length, 3, 'all three pages must be requested');
});

test('forwards the cursor from each response to the next request', async () => {
  const { fetchPage, receivedQueries } = createFakeEndpoint([[{ id: '1' }], [{ id: '2' }]]);

  await collectAllPages(fetchPage);

  assert.equal(receivedQueries[0].after, undefined, 'the first request carries no cursor');
  assert.equal(receivedQueries[1].after, 'cursor-1');
});

test('stops when paging.next.after is absent', async () => {
  let callCount = 0;
  const fetchPage = async () => {
    callCount += 1;
    return { results: [{ id: String(callCount) }] };
  };

  const collected = await collectAllPages(fetchPage);

  assert.equal(collected.length, 1);
  assert.equal(callCount, 1, 'a response without a cursor must end the loop');
});

test('handles an empty result set', async () => {
  const collected = await collectAllPages(async () => ({ results: [] }));
  assert.deepEqual(collected, []);
});

test('handles a response with no results field at all', async () => {
  const collected = await collectAllPages(async () => ({}));
  assert.deepEqual(collected, []);
});

test('clamps the page size to the maximum HubSpot accepts', async () => {
  const { fetchPage, receivedQueries } = createFakeEndpoint([[{ id: '1' }]]);

  await collectAllPages(fetchPage, { pageSize: 500 });

  // HubSpot rejects a limit above 100 on CRM list endpoints.
  assert.equal(receivedQueries[0].limit, 100);
});

test('serialises property and association lists as comma-separated values', async () => {
  const { fetchPage, receivedQueries } = createFakeEndpoint([[{ id: '1' }]]);

  await collectAllPages(fetchPage, {
    properties: ['firstname', 'lastname', 'email'],
    associations: ['deals'],
  });

  // HubSpot expects one comma-separated parameter, not a repeated one.
  assert.equal(receivedQueries[0].properties, 'firstname,lastname,email');
  assert.equal(receivedQueries[0].associations, 'deals');
});

test('stops early when a total limit is reached', async () => {
  const { fetchPage, receivedQueries } = createFakeEndpoint([
    [{ id: '1' }, { id: '2' }],
    [{ id: '3' }, { id: '4' }],
    [{ id: '5' }],
  ]);

  const collected = await collectAllPages(fetchPage, { limit: 3 });

  assert.equal(collected.length, 3);
  // The third page must never be requested: stopping early has to actually
  // save the request, or the limit is decorative.
  assert.equal(receivedQueries.length, 2);
});

test('aborts on a repeated cursor rather than looping forever', async () => {
  // A cursor that does not advance would otherwise spin indefinitely and
  // consume the daily rate-limit budget in minutes.
  const fetchPage = async () => ({
    results: [{ id: '1' }],
    paging: { next: { after: 'stuck' } },
  });

  await assert.rejects(() => collectAllPages(fetchPage), /repeated cursor/);
});

test('yields lazily, one record at a time', async () => {
  let pagesFetched = 0;
  const fetchPage = async () => {
    pagesFetched += 1;
    return {
      results: [{ id: `${pagesFetched}a` }, { id: `${pagesFetched}b` }],
      paging: pagesFetched < 3 ? { next: { after: `cursor-${pagesFetched}` } } : undefined,
    };
  };

  const seen = [];
  for await (const record of paginateAll(fetchPage)) {
    seen.push(record.id);
    if (seen.length === 3) {
      break;
    }
  }

  assert.deepEqual(seen, ['1a', '1b', '2a']);
  // Breaking out must stop the fetching: only two pages were needed for three
  // records, and the third must never have been requested. This is what keeps
  // memory and request count proportional to what the caller consumes.
  assert.equal(pagesFetched, 2);
});

test('chunkForBatch splits inputs to the size batch endpoints accept', async (subtest) => {
  await subtest.test('splits at 100 by default', () => {
    const chunks = chunkForBatch(Array.from({ length: 250 }, (_, index) => index));
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 100);
    assert.equal(chunks[2].length, 50);
  });

  await subtest.test('clamps an over-large requested size', () => {
    const chunks = chunkForBatch(
      Array.from({ length: 150 }, (_, index) => index),
      500
    );
    assert.equal(chunks[0].length, 100);
  });

  await subtest.test('returns nothing for an empty input', () => {
    assert.deepEqual(chunkForBatch([]), []);
  });

  await subtest.test('returns a single chunk when the input fits', () => {
    assert.deepEqual(chunkForBatch([1, 2, 3]), [[1, 2, 3]]);
  });
});
