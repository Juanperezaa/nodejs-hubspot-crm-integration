'use strict';

/**
 * Payload validation and property normalisation.
 *
 * The alias tests carry the most weight. The brief specifies `hs_pipeline` and
 * `hs_stage` for deals; those are Ticket properties, and sending them verbatim
 * returns 400 PROPERTY_DOESNT_EXIST. Accepting both spellings and translating
 * is what lets the project satisfy the brief literally and still work.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateHubSpotPayload,
  validateContactPayload,
  validateDealPayload,
  validateRecordId,
  normaliseDealProperties,
} = require('../../src/utils/validateHubSpotPayload');
const { FAILURE_KINDS } = require('../../src/errors/HubSpotApiError');

// ---------------------------------------------------------------------------
// Deal property aliases — the heart of this module
// ---------------------------------------------------------------------------

test("translates the brief's deal property names to HubSpot's", async (subtest) => {
  await subtest.test('hs_pipeline becomes pipeline', () => {
    const { properties } = normaliseDealProperties({ hs_pipeline: 'default' });
    assert.equal(properties.pipeline, 'default');
    assert.equal(properties.hs_pipeline, undefined, 'the Ticket property must not be sent');
  });

  await subtest.test('hs_stage becomes dealstage', () => {
    const { properties } = normaliseDealProperties({ hs_stage: 'appointmentscheduled' });
    assert.equal(properties.dealstage, 'appointmentscheduled');
    assert.equal(properties.hs_stage, undefined);
  });

  await subtest.test('hs_pipeline_stage also becomes dealstage', () => {
    // The genuine Ticket spelling, in case a caller copies it from that object.
    const { properties } = normaliseDealProperties({ hs_pipeline_stage: 'qualified' });
    assert.equal(properties.dealstage, 'qualified');
  });

  await subtest.test('reports which aliases were applied', () => {
    // The translation must be visible to the caller, not silent magic.
    const { appliedAliases } = normaliseDealProperties({
      hs_pipeline: 'default',
      hs_stage: 'closedwon',
    });
    assert.equal(appliedAliases.length, 2);
    assert.ok(appliedAliases.some((entry) => /hs_pipeline -> pipeline/.test(entry)));
  });

  await subtest.test('a canonical name already present wins over its alias', () => {
    // A caller who writes both must not be silently overridden by the legacy
    // spelling; the real property name is the one they meant.
    const { properties, appliedAliases } = normaliseDealProperties({
      pipeline: 'explicit',
      hs_pipeline: 'legacy',
    });
    assert.equal(properties.pipeline, 'explicit');
    assert.ok(appliedAliases.some((entry) => /ignored in favour of/.test(entry)));
  });

  await subtest.test('leaves unrecognised properties untouched', () => {
    const { properties } = normaliseDealProperties({
      dealname: 'Acme',
      amount: '100',
      custom_field: 'x',
    });
    assert.equal(properties.dealname, 'Acme');
    assert.equal(properties.custom_field, 'x');
  });
});

test('a deal written exactly as the brief specifies produces a valid payload', () => {
  // This is the end-to-end proof of decision D5: the brief's spelling in,
  // HubSpot's spelling out.
  const { properties } = validateDealPayload({
    properties: {
      dealname: 'Technical test deal',
      amount: 1500,
      hs_pipeline: 'default',
      hs_stage: 'appointmentscheduled',
    },
  });

  assert.deepEqual(properties, {
    dealname: 'Technical test deal',
    amount: '1500',
    pipeline: 'default',
    dealstage: 'appointmentscheduled',
  });
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

test('contact validation', async (subtest) => {
  await subtest.test('accepts a well-formed contact', () => {
    const { properties } = validateContactPayload({
      properties: { email: 'ada@example.com', firstname: 'Ada', lastname: 'Lovelace' },
    });
    assert.equal(properties.email, 'ada@example.com');
  });

  await subtest.test('lower-cases the email', () => {
    // HubSpot treats addresses case-insensitively for uniqueness, so leaving
    // the case alone would make two spellings look like two contacts to the
    // idempotent sync comparison.
    const { properties } = validateContactPayload({
      properties: { email: 'Ada.Lovelace@Example.COM' },
    });
    assert.equal(properties.email, 'ada.lovelace@example.com');
  });

  await subtest.test('requires an email on create', () => {
    // Email is the only natively unique contact property, so a contact created
    // without one cannot be matched on a later sync and would be duplicated.
    assert.throws(() => validateContactPayload({ properties: { firstname: 'Ada' } }), /email/);
  });

  await subtest.test('allows an update without an email', () => {
    const { properties } = validateContactPayload(
      { properties: { firstname: 'Ada' } },
      { requireEmail: false }
    );
    assert.equal(properties.firstname, 'Ada');
  });

  await subtest.test('rejects a malformed address', () => {
    assert.throws(
      () => validateContactPayload({ properties: { email: 'not-an-address' } }),
      /not a valid address/
    );
  });

  await subtest.test('rejects empty properties', () => {
    assert.throws(() => validateContactPayload({ properties: {} }), /at least one property/);
    assert.throws(() => validateContactPayload({}), /at least one property/);
  });
});

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

test('deal validation', async (subtest) => {
  await subtest.test('normalises the amount to the string HubSpot stores', () => {
    // HubSpot returns numeric properties as strings; normalising on the way in
    // means a round trip does not change the type the caller sees, which is
    // what makes the idempotent sync comparison work.
    const { properties } = validateDealPayload({
      properties: { dealname: 'Acme', amount: 1500.5, pipeline: 'default', dealstage: 'x' },
    });
    assert.equal(properties.amount, '1500.5');
    assert.equal(typeof properties.amount, 'string');
  });

  await subtest.test('rejects a negative amount', () => {
    assert.throws(
      () =>
        validateDealPayload({
          properties: { dealname: 'Acme', amount: -5, pipeline: 'default', dealstage: 'x' },
        }),
      /must not be negative/
    );
  });

  await subtest.test('rejects an unparseable amount', () => {
    assert.throws(
      () =>
        validateDealPayload({
          properties: { dealname: 'Acme', amount: 'free', pipeline: 'default', dealstage: 'x' },
        }),
      /finite number/
    );
  });

  await subtest.test('requires a deal name, pipeline and stage on create', () => {
    assert.throws(() => validateDealPayload({ properties: { amount: 10 } }), /dealname/);
    assert.throws(
      () => validateDealPayload({ properties: { dealname: 'Acme', amount: 10 } }),
      /pipeline/
    );
    assert.throws(
      () =>
        validateDealPayload({ properties: { dealname: 'Acme', amount: 10, pipeline: 'default' } }),
      /dealstage/
    );
  });

  await subtest.test('allows a partial update', () => {
    const { properties } = validateDealPayload(
      { properties: { dealstage: 'closedwon' } },
      { requireStageAndPipeline: false }
    );
    assert.deepEqual(properties, { dealstage: 'closedwon' });
  });
});

// ---------------------------------------------------------------------------
// Record ids and dispatch
// ---------------------------------------------------------------------------

test('record id validation', async (subtest) => {
  await subtest.test('accepts numeric strings and positive integers', () => {
    assert.equal(validateRecordId('12345678901'), '12345678901');
    assert.equal(validateRecordId(42), '42');
  });

  await subtest.test('rejects a non-numeric id before a request is made', () => {
    // Catches the common mistake of passing a whole record where its id was
    // wanted, without spending a request that could only ever 404.
    assert.throws(() => validateRecordId('abc'), /numeric HubSpot record id/);
    assert.throws(() => validateRecordId({ id: '123' }), /required/);
    assert.throws(() => validateRecordId(''), /required/);
    assert.throws(() => validateRecordId(-1), /numeric HubSpot record id/);
  });

  await subtest.test('names the field so the fault is locatable', () => {
    assert.throws(() => validateRecordId('abc', 'contactId'), /"contactId"/);
  });
});

test('validateHubSpotPayload dispatches on object type', async (subtest) => {
  await subtest.test('routes contacts', () => {
    const { properties } = validateHubSpotPayload('contacts', {
      properties: { email: 'ada@example.com' },
    });
    assert.equal(properties.email, 'ada@example.com');
  });

  await subtest.test('routes deals, aliases included', () => {
    const { properties } = validateHubSpotPayload('deals', {
      properties: { dealname: 'A', amount: 1, hs_pipeline: 'default', hs_stage: 'new' },
    });
    assert.equal(properties.pipeline, 'default');
    assert.equal(properties.dealstage, 'new');
  });

  await subtest.test('rejects an unknown object type', () => {
    assert.throws(() => validateHubSpotPayload('widgets', { properties: { a: 1 } }), /widgets/);
  });
});

test('validation failures are non-retryable, like the 400 they prevent', () => {
  // Reusing HubSpotApiError with kind VALIDATION means a caller's catch handles
  // a locally-detected bad payload and a remotely-rejected one identically.
  try {
    validateContactPayload({ properties: { email: 'nope' } });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.kind, FAILURE_KINDS.VALIDATION);
    assert.equal(error.isRetryable, false);
    assert.ok(Array.isArray(error.validationErrors));
    assert.equal(error.validationErrors[0].field, 'email');
  }
});
