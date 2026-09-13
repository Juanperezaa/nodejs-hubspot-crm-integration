# Context — how this project works

What the system does, how a request travels through it, and why each layer
exists. Read this before the source.

For the reasoning behind individual choices, see
[`DECISIONS.md`](./DECISIONS.md). For the endpoints themselves, see
[`API_REFERENCE.md`](./API_REFERENCE.md).

---

## 1. What this is

A Node.js integration with the HubSpot CRM that can list, create, update,
delete and associate **contacts** and **deals**, and synchronise both from a
local JSON source without creating duplicates.

Every HubSpot call is a real HTTP request against a live portal. Nothing is
mocked or simulated — the brief forbids it, and the integration suite proves
it by creating records in a real CRM and deleting them afterwards.

---

## 2. The domain in four words

HubSpot's data model is small enough to hold in your head, and everything here
follows from it.

```
Object        a record: a Contact, a Deal
Property      a field on it, addressed by INTERNAL NAME (dealname, not "Deal name")
Association   a typed link between two objects (Contact→Deal is type 4)
Pipeline      the ordered stages a Deal moves through
```

Two consequences shape the whole codebase:

- **Internal names are not display labels.** `dealstage` takes `closedwon`, not
  `"Closed Won"`. Most integration bugs are this mistake.
- **Contacts have a unique property; deals do not.** `email` is natively unique,
  so contacts can be upserted. Deals have nothing equivalent, which is why the
  two synchronisations work differently.

---

## 3. The layers

Dependencies run in one direction only. Nothing below reaches upward.

```
            ┌──────────────────────────────────────────┐
  examples/ │  full-workflow.js, create-deal.js …      │  how it is invoked
            └────────────────────┬─────────────────────┘
                                 │
            ┌────────────────────▼─────────────────────┐
      api/  │  hubSpotApiHandler                       │  dispatch, rendering,
            └────────────────────┬─────────────────────┘  exit codes
                                 │
            ┌────────────────────▼─────────────────────┐
 services/  │  hubSpotService                          │  WHICH SEQUENCE of
            │  contactSyncService, dealSyncService     │  operations, and in
            └────────────────────┬─────────────────────┘  what order
                                 │
            ┌────────────────────▼─────────────────────┐
repositories│  contact, deal, association,             │  WHICH ENDPOINT, and
      /     │  pipeline, property                      │  what its payload is
            └────────────────────┬─────────────────────┘
                                 │
            ┌────────────────────▼─────────────────────┐
  clients/  │  hubSpotClient                           │  HOW to speak HTTP:
            └────────────────────┬─────────────────────┘  auth, retries, timeouts
                                 │
                          HubSpot REST API

  utils/   redaction, logging, validation, pagination, backoff
  errors/  HubSpotApiError, InvalidConfigurationError
  config/  env, endpoint paths, scopes         ── used by every layer
```

**Each layer has exactly one reason to change.**

| Layer               | Knows                                                     | Does not know     |
| ------------------- | --------------------------------------------------------- | ----------------- |
| `clients/`          | Authentication, timeouts, retries, rate-limit headers     | What a contact is |
| `repositories/`     | Which endpoint serves which object, and its payload shape | Business rules    |
| `services/`         | Which sequence satisfies a use case                       | HTTP              |
| `api/`, `examples/` | How work is invoked and presented                         | Everything below  |

The test of whether a boundary is real: **when HubSpot retires the `v4`
association endpoints in March 2027**, `config/hubspot.config.js` and
`repositories/` change. Services, handlers and examples do not.

---

## 4. One request, end to end

Following `createHubSpotDeal('Acme expansion', 4500)`:

```
 1  examples/create-deal.js
        calls the handler with the operation name and arguments
        │
 2  api/hubSpotApiHandler
        looks the operation up, times it, will render the result
        │
 3  services/hubSpotService.createHubSpotDeal(dealName, amount)
        reads HUBSPOT_PIPELINE_ID and HUBSPOT_STAGE_ID from config
        asks pipelineRepository to confirm both exist          ─── one read
        builds the payload using the BRIEF'S spelling:
            { dealname, amount, hs_pipeline, hs_stage }
        │
 4  repositories/dealRepository.createDeal(properties)
        calls validateHubSpotPayload, which:
          • translates  hs_pipeline → pipeline
          • translates  hs_stage    → dealstage
          • coerces     amount      → "4500"   (HubSpot stores numbers as strings)
          • rejects anything HubSpot would reject, locally
        resolves the path from config: /crm/v3/objects/deals
        │
 5  clients/hubSpotClient.post(path, body)
        attaches Authorization: Bearer …           ← the only place the token is read
        wraps the call in handleHubSpotErrors
        │
 6  utils/handleHubSpotErrors
        runs the request; on failure, normalises it to a HubSpotApiError
        with a decided kind, then either retries with backoff or gives up
        │
        ▼
    HubSpot  POST /crm/v3/objects/deals
        │
 7  the response travels back up
        the client records the rate-limit headers
        the service logs the created id — through the redacting logger
        the handler renders it and exits 0
```

**Step 3 is worth pausing on.** The payload is written in the brief's spelling
deliberately, so that the translation the brief's names require is exercised on
the project's primary path rather than only in its tests. See §6.

---

## 5. Where failures go

Every failure — from HubSpot, from the socket, or from a request that never
left — becomes a `HubSpotApiError` with a **decided `kind`**. A caller makes
one decision instead of inspecting `error.response?.status ?? error.code`.

```
                  ┌─────────────────┐
  a failure  ───► │ normalise it    │
                  └────────┬────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
      ┌───────▼────────┐       ┌────────▼────────┐
      │  retryable     │       │  not retryable  │
      │  429, 5xx,     │       │  401, 403, 400, │
      │  network,      │       │  404, 409       │
      │  timeout       │       └────────┬────────┘
      └───────┬────────┘                │
              │                    fail immediately,
    wait, then try again           with guidance naming
    • Retry-After if present       the likely cause
    • else exponential backoff
      with FULL JITTER
    • capped at 30 s, 5 attempts
```

**Why a 400 is never retried:** sending an invalid payload four more times
burns rate-limit budget and delays the real error. **Why full jitter:** HubSpot's
burst limit is a rolling ten-second window shared by every caller using the same
app, so fixed delays make throttled callers retry in lockstep and re-trigger the
identical limit.

Full policy in [`ERROR_HANDLING.md`](./ERROR_HANDLING.md).

---

## 6. The discrepancy at the centre of this project

The brief asks for deals created with `properties.dealname`,
`properties.amount`, **`hs_pipeline`** and **`hs_stage`**.

Those last two do not exist on the Deal object. They belong to **Tickets**. The
Deal object uses `pipeline` and `dealstage`.

This is not a reading of the documentation. `npm run example:workflow` asks the
portal, and among its **206 deal properties**:

```
  hs_pipeline          exists: false  -> pipeline     exists: true
  hs_stage             exists: false  -> dealstage    exists: true
  hs_pipeline_stage    exists: false  -> dealstage    exists: true
```

Sending the brief's spelling verbatim returns `400 PROPERTY_DOESNT_EXIST`.

**The resolution:** `validateHubSpotPayload` accepts either spelling and
translates before the request. The literal requirement is met at the public
boundary and HubSpot receives the name it defines. A canonical name already
present wins over its alias, so a caller writing both is not silently
overridden.

The confusion is easy to fall into for a reason worth knowing: `hs_pipeline` is
a **real HubSpot property** — it exists on Tickets, and on Contacts as
`contacts-lifecycle-pipeline`. It simply does not exist on Deals.

Recorded as decision **D5**.

---

## 7. How idempotency is achieved, three different ways

The brief asks for idempotent create/update and idempotent association. Each of
the three uses a different mechanism, because each faces a different constraint.

### Contacts — upsert on a unique property

`email` is natively unique on every HubSpot tier, so `batch/upsert` with
`idProperty: "email"` reconciles a hundred records in one call. Running the
sync twice leaves one record per address.

Reporting _created_ versus _updated_ needs one extra request: HubSpot's upsert
response is identical either way, so the existing emails are read first.

### Deals — correlate against a locally built index

Deals have no unique property, so correlation must match on something chosen.
Two approaches were rejected for measured reasons:

- **A custom correlation property** would need `crm.schemas.deals.write`, a
  scope nothing else here requires, and would leave that property on the
  portal's schema permanently. (**D11**)
- **The Search API** lags a write. Measured: a new deal was absent at 5406 ms
  and appeared at 6766 ms. A sync correlating through search would duplicate a
  deal it had just created. (**D14**)

So the index is built from the **list endpoint**, which reflects a write
immediately.

### Associations — the method already is idempotent

Creating a default association is a `PUT`, so repeating it cannot produce a
second link. Nothing was needed to achieve this.

The existence check that `associateContactToDeal` performs does something
different: it makes the _report_ truthful. "Safe to repeat" and "honest about
what it did" are separate properties, and a caller synchronising a hundred
pairs needs the second. That check is skippable; correctness never depended on
it.

---

## 8. How secrets are kept out of logs

The brief requires errors logged "without exposing tokens or sensitive data".
Discipline alone does not survive contact with axios: an error object carries
the full request configuration, **headers included**, so a single
`console.error(error)` prints the bearer token.

So redaction is **structural** and sits at the logger boundary, where there is
no path around it. It masks by key name (`authorization`, `tokenKey`,
`clientSecret`, `hapikey`, …) and by text pattern (`pat-…`, `Bearer …`,
`hapikey=…`, bare UUIDs), and it tracks cycles because axios errors are
self-referential.

The token is read in exactly one place — `hubSpotClient`, when it builds the
`Authorization` header.

---

## 9. Configuration

Read once, validated, frozen, cached. Validation is **lazy** rather than at
import time, for two reasons: `npm run verify:requirements` loads every module
in the project and must work in CI where no token exists, and the Section 1
fundamentals must run with no HubSpot configuration at all.

The most valuable check is the one that names a specific mistake: supplying the
private app's **Client Secret** instead of its **access token**. The two sit
beside each other in the HubSpot interface, and the secret produces a `401` —
which reads identically to a missing scope and sends the reader to the wrong
place entirely.

---

## 10. How to verify any of this

```bash
npm run validate              # lint + 163 unit tests + requirement matrix
npm run probe                 # portal identity, scopes, properties, pipelines
npm run test:integration      # 48 real calls against the portal
npm run example:workflow      # the whole integration in one run, self-cleaning
```

`npm run verify:requirements` is the one worth knowing about. It loads every
module the brief names, inspects the export, and prints a PASS/FAIL matrix.
Requirement coverage is an executable claim rather than a paragraph.

---

## 11. Where to look

| To understand                                | Read                                                   |
| -------------------------------------------- | ------------------------------------------------------ |
| Why the structure is shaped this way         | [`ARCHITECTURE.md`](./ARCHITECTURE.md)                 |
| Why a particular choice was made             | [`DECISIONS.md`](./DECISIONS.md)                       |
| Which endpoints are used, and their scopes   | [`API_REFERENCE.md`](./API_REFERENCE.md)               |
| How to configure a portal                    | [`HUBSPOT_SETUP.md`](./HUBSPOT_SETUP.md)               |
| How failures are classified and retried      | [`ERROR_HANDLING.md`](./ERROR_HANDLING.md)             |
| Which requirement maps to which file         | [`REQUIREMENTS_MATRIX.md`](./REQUIREMENTS_MATRIX.md)   |
| What was planned, and what actually happened | [`PLAN.md`](./PLAN.md), [`PROGRESS.md`](./PROGRESS.md) |
