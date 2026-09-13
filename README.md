# NodeJS — HubSpot CRM Integration

A modular Node.js integration with the HubSpot CRM covering Contacts, Deals,
Associations, Pipelines and Properties.

**Every HubSpot call is a real HTTP request against a live portal.** Nothing is
mocked or simulated, and the integration suite proves it — it creates records in
a real CRM, asserts against them, and deletes them.

|                         |                                       |
| ----------------------- | ------------------------------------- |
| Unit tests              | **163 passing**                       |
| Integration tests       | **48 passing, against a live portal** |
| Required artefacts      | **27 / 27 verified mechanically**     |
| Node.js                 | 18, 20 and 22, all green in CI        |
| Production dependencies | 2 (`axios`, `dotenv`)                 |

---

## Quick start

```bash
npm install
cp .env.example .env
#   paste your HubSpot private app access token into HUBSPOT_ACCESS_TOKEN

npm run probe             # confirm the portal, scopes, properties and pipelines
npm run validate          # lint + unit tests + requirement matrix
npm run example:workflow  # the whole integration in one run, self-cleaning
```

`npm run example:workflow` is the fastest way to see everything work: it creates
a contact, creates a deal, associates them, proves the association is
idempotent, reads both back, updates one, lists contact names, and deletes what
it made — in about ten seconds.

---

## Submission details

The brief asks the submission to state the portal, the endpoints used and how
the private app was configured. Here they are.

### Portal

|                      |                                                                   |
| -------------------- | ----------------------------------------------------------------- |
| **Portal / hub id**  | `52018022`                                                        |
| **Private app id**   | `52891293`                                                        |
| **API base URL**     | `https://api.hubapi.com`                                          |
| **Authentication**   | Private app access token, sent as `Authorization: Bearer <token>` |
| **CRM objects API**  | `v3` — the version the brief names                                |
| **Associations API** | `v4`                                                              |

`npm run probe` prints all of this from the live portal, so the values above can
be confirmed rather than taken on trust.

### Private app scopes

```
crm.objects.contacts.read     crm.objects.deals.read     crm.schemas.deals.read
crm.objects.contacts.write    crm.objects.deals.write    crm.schemas.contacts.read
```

Configured in **Settings → Integrations → Private Apps → _your app_ → Scopes**.
Step-by-step instructions, including what to do when a scope appears greyed out,
are in [`docs/HUBSPOT_SETUP.md`](docs/HUBSPOT_SETUP.md).

### Endpoints used

Every endpoint, with the scope that authorises it and a link to its official
HubSpot documentation, is catalogued in
[`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) — seventeen in total, across
Contacts, Deals, Associations, Pipelines, Properties and token introspection.

That catalogue is not prose: the same data lives in
[`src/config/scopes.js`](src/config/scopes.js), and a unit test fails the build
if the documentation and the code ever disagree.

### Libraries used

The brief asks for the modules used to be listed.

**Production — two.**

| Library                                          | Version | Why                                                                                                                                                                                                                          |
| ------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`axios`](https://www.npmjs.com/package/axios)   | ^1.7.7  | HTTP client. Chosen over `@hubspot/api-client` so every endpoint, payload and query parameter stays visible in source, and so the retry policy the brief requires is ours to implement. Reasoning in `docs/DECISIONS.md` D1. |
| [`dotenv`](https://www.npmjs.com/package/dotenv) | ^16.4.5 | Loads `.env` into `process.env`. Values already set in the environment win, so CI and shell overrides take precedence.                                                                                                       |

**Development — four.**

| Library                                                                                            | Version | Why                                                                                                |
| -------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| [`eslint`](https://www.npmjs.com/package/eslint)                                                   | ^9.12.0 | Static analysis. Also enforces the descriptive English naming the brief asks for, via `id-length`. |
| [`prettier`](https://www.npmjs.com/package/prettier)                                               | ^3.3.3  | Formatting, checked in CI.                                                                         |
| [`@commitlint/cli`](https://www.npmjs.com/package/@commitlint/cli)                                 | ^19.5.0 | Validates commit messages against Conventional Commits.                                            |
| [`@commitlint/config-conventional`](https://www.npmjs.com/package/@commitlint/config-conventional) | ^19.5.0 | The rule set commitlint extends.                                                                   |

**No test framework.** The 163 unit tests and 48 integration tests run on Node's
built-in [`node:test`](https://nodejs.org/api/test.html) runner, so the test
suite adds no dependency at all.

---

## What the brief asked for, and where it is

All 27 named artefacts are verified by `npm run verify:requirements`, which
loads each module and inspects its export. The full matrix is
[`docs/REQUIREMENTS_MATRIX.md`](docs/REQUIREMENTS_MATRIX.md).

### Section 1 — Node.js fundamentals (40%)

| Requirement               | File                                                                                         | Run it                           |
| ------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------- |
| Asynchrony with callbacks | [`src/fundamentals/callbacks.js`](src/fundamentals/callbacks.js)                             | `npm run fundamentals:callbacks` |
| Promises and async/await  | [`src/fundamentals/asyncAwait.js`](src/fundamentals/asyncAwait.js)                           | `npm run fundamentals:async`     |
| CommonJS modules          | [`utils_module.js`](src/fundamentals/utils_module.js), [`main.js`](src/fundamentals/main.js) | `npm run fundamentals:modules`   |
| Streams                   | [`src/utils/streams.js`](src/utils/streams.js)                                               | `npm run fundamentals:streams`   |

### Section 2 — HubSpot integration (60%)

| Function                               | Where                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `getHubSpotContactNames`               | [`src/services/hubSpotService.js`](src/services/hubSpotService.js)           |
| `getHubSpotContacts`                   | same                                                                         |
| `createHubSpotContact`                 | same                                                                         |
| `updateHubSpotContact`                 | same                                                                         |
| `deleteHubSpotContact`                 | same                                                                         |
| `getHubSpotDeals`                      | same                                                                         |
| `createHubSpotDeal`                    | same                                                                         |
| `updateHubSpotDeal`                    | same                                                                         |
| `deleteHubSpotDeal`                    | same                                                                         |
| `associateContactToDeal`               | same                                                                         |
| `syncContactsWithHubSpot`              | [`src/services/contactSyncService.js`](src/services/contactSyncService.js)   |
| `syncDealsWithHubSpot`                 | [`src/services/dealSyncService.js`](src/services/dealSyncService.js)         |
| `hubSpotClient`                        | [`src/clients/hubSpotClient.js`](src/clients/hubSpotClient.js)               |
| `hubSpotService`                       | [`src/services/hubSpotService.js`](src/services/hubSpotService.js)           |
| `contactRepository` / `dealRepository` | [`src/repositories/`](src/repositories/)                                     |
| `validateHubSpotPayload`               | [`src/utils/validateHubSpotPayload.js`](src/utils/validateHubSpotPayload.js) |
| `handleHubSpotErrors`                  | [`src/utils/handleHubSpotErrors.js`](src/utils/handleHubSpotErrors.js)       |
| `hubSpotApiHandler`                    | [`src/api/hubSpotApiHandler.js`](src/api/hubSpotApiHandler.js)               |

---

## Setup

### 1. A HubSpot portal

The brief asks for _"your own HubSpot portal (developer account / private
app)"_. A free developer test account works and makes you Super Admin, which
matters — **a private app can only be granted scopes its creator already holds**,
so on a shared portal the CRM scopes may be greyed out and unselectable.

Full walkthrough, including that failure mode:
[`docs/HUBSPOT_SETUP.md`](docs/HUBSPOT_SETUP.md).

### 2. Scopes

```
crm.objects.contacts.read     crm.objects.deals.read     crm.schemas.deals.read
crm.objects.contacts.write    crm.objects.deals.write    crm.schemas.contacts.read
```

Four of these six are strictly necessary; the two `crm.schemas.*.read` entries
are redundant because HubSpot requires _one of_ the listed scopes per endpoint.
That is measured, not assumed — `tests/unit/scopes.test.js` proves the four
object scopes alone cover all seventeen endpoints.

**Associations need no scope of their own.** The v4 endpoints are authorised by
the object scopes of both objects involved.

### 3. The access token — not the client secret

These sit beside each other in HubSpot's Auth tab and are **not**
interchangeable:

```
Access token    pat-na1-xxxxxxxx-…    ← this one. Click "Show token", then "Copy"
Client secret   8faf6678-4fbc-…       ← webhook signature validation only
```

Supplying the secret produces a `401`, which reads identically to a missing
scope. `src/config/env.js` detects this specific mistake by shape and says so.

### 4. Environment

Copy `.env.example` to `.env`. Every variable is documented there with the
reason it exists and how to find its value. `npm run probe` prints your
portal's real pipeline and stage ids ready to paste.

---

## Scripts

### Verification

| Command                       | What it does                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate`            | lint + unit tests + requirement matrix                                                                                                                                     |
| `npm run lint`                | ESLint                                                                                                                                                                     |
| `npm test`                    | 163 unit tests, no network                                                                                                                                                 |
| `npm run verify:requirements` | loads every named artefact and prints a PASS/FAIL matrix                                                                                                                   |
| `npm run lint:commits`        | validates commit messages against Conventional Commits                                                                                                                     |
| `npm run probe`               | live portal: identity, scopes, deal properties, pipelines, rate limits                                                                                                     |
| `npm run test:integration`    | 48 real calls (needs `HUBSPOT_ALLOW_WRITE=true`) — runs near HubSpot's burst limit, so retry warnings are expected; see [`docs/ERROR_HANDLING.md`](docs/ERROR_HANDLING.md) |

### Examples

Every example is a standalone script, runnable directly:

```bash
node src/examples/full-workflow.js            # everything, end to end, self-cleaning
node src/examples/list-contact-names.js       # Section 2.1
node src/examples/create-contact.js
node src/examples/create-deal.js              # Section 2.2
node src/examples/associate-contact-to-deal.js <contactId> <dealId>   # Section 2.3
node src/examples/sync-contacts.js  [--dry-run]
node src/examples/sync-deals.js     [--dry-run]
node src/examples/error-handling.js           # Section 2.4
```

Most accept optional arguments and fall back to sensible run-scoped defaults, so
each one works with no arguments at all.

The same scripts have npm aliases, which matter only because passing arguments
through npm needs an extra `--`:

| Alias                            | Equivalent                                       |
| -------------------------------- | ------------------------------------------------ |
| `npm run example:workflow`       | `node src/examples/full-workflow.js`             |
| `npm run example:contact-names`  | `node src/examples/list-contact-names.js`        |
| `npm run example:create-contact` | `node src/examples/create-contact.js`            |
| `npm run example:create-deal`    | `node src/examples/create-deal.js`               |
| `npm run example:associate`      | `node src/examples/associate-contact-to-deal.js` |
| `npm run example:sync-contacts`  | `node src/examples/sync-contacts.js`             |
| `npm run example:sync-deals`     | `node src/examples/sync-deals.js`                |
| `npm run example:errors`         | `node src/examples/error-handling.js`            |

`npm run handler` prints the dispatcher's help, listing every operation with the
requirement it satisfies.

### Section 1 — Node.js fundamentals

These need **no HubSpot credentials at all**, so they run immediately after
`npm install`:

```bash
node src/fundamentals/callbacks.js     # or: npm run fundamentals:callbacks
node src/fundamentals/asyncAwait.js    #     npm run fundamentals:async
node src/fundamentals/main.js          #     npm run fundamentals:modules
node src/utils/streams.js              #     npm run fundamentals:streams
```

---

## Technical decisions

Every choice is recorded with the alternatives genuinely considered in
[`docs/DECISIONS.md`](docs/DECISIONS.md). The ones that shaped the most code:

### `axios`, not `@hubspot/api-client`

The brief allows either. Two grading criteria decide it. _"Appropriate real
HubSpot API calls (endpoints, payloads, pagination)"_ — with axios every path
and payload is visible and auditable in source; the SDK hides all three behind
method names. _"Robust error handling and retries"_ — the brief requires a
`handleHubSpotErrors` utility, and the SDK ships its own, which would either
conflict with ours or make it redundant.

The SDK is the better choice for a production integration where endpoint churn
is a maintenance cost. It is the worse choice for an exercise whose purpose is
demonstrating command of those endpoints.

### The brief's deal property names do not exist

The brief asks for deals carrying `hs_pipeline` and `hs_stage`. **Those are
Ticket properties.** The Deal object uses `pipeline` and `dealstage`, and
sending the brief's spelling returns `400 PROPERTY_DOESNT_EXIST`.

This was verified against the portal rather than argued from documentation —
`npm run example:workflow` prints it, among the portal's 206 deal properties:

```
  hs_pipeline          exists: false  -> pipeline     exists: true
  hs_stage             exists: false  -> dealstage    exists: true
  hs_pipeline_stage    exists: false  -> dealstage    exists: true
```

**The resolution:** `validateHubSpotPayload` accepts either spelling and
translates before the request. The literal requirement is met at the public
boundary and HubSpot receives the name it defines. `createHubSpotDeal` writes
its payload in the brief's spelling deliberately, so the translation is
exercised on the primary path rather than only in tests.

Worth knowing why the mistake is easy: `hs_pipeline` **is** a real HubSpot
property — on Tickets, and on Contacts as `contacts-lifecycle-pipeline`. It
simply does not exist on Deals.

### Idempotency, achieved three different ways

|                  | Mechanism                                                    | Why not something else                   |
| ---------------- | ------------------------------------------------------------ | ---------------------------------------- |
| **Contacts**     | `batch/upsert` on `email`                                    | `email` is natively unique on every tier |
| **Deals**        | correlate `dealname` against an index from the list endpoint | no unique property exists; see below     |
| **Associations** | the endpoint is a `PUT`                                      | nothing was needed                       |

**Deals are the interesting case.** Two approaches were rejected for measured
reasons. A custom correlation property would need `crm.schemas.deals.write` — a
scope nothing else requires — and would leave that property on the portal's
schema permanently. And the **Search API lags a write**: measured against a live
portal, a new deal was absent from search at 5406 ms and appeared at 6766 ms.
A sync correlating through search would duplicate a deal it had just created.
The list endpoint reflects a write immediately, so the index is built from
there.

### Full jitter on backoff

HubSpot's burst limit is a **rolling ten-second window shared by every caller
using the same app**. Ten requests throttled together and backing off by the
same amount retry in lockstep and re-trigger the identical limit. The delay is
therefore a uniform draw between zero and the exponential ceiling. `Retry-After`
always wins when present, but is still capped — a misconfigured proxy returning
`Retry-After: 86400` must not park the process for a day.

### CommonJS throughout, `node:test` as the runner

Section 1.3 requires demonstrating CommonJS, so using it everywhere is coherent
rather than leaving the exercise looking detached. Node's built-in test runner
covers everything needed with zero dependencies — Jest would add roughly three
hundred transitive packages to a project whose entire production dependency list
is two entries.

---

## Things the portal taught us

Findings that came from calling the real API, not from reading about it. Each
changed the code.

| Finding                                                                                                  | Consequence                                                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `hs_pipeline` and `hs_stage` are absent from the Deal object                                             | the alias layer exists                                                                |
| **`DELETE` never returns 404** — a live record, an archived one and an id that never existed all succeed | `deleteHubSpot*` reports acceptance rather than claiming a deletion it cannot confirm |
| **Search lags a write by ~7 s**; the list endpoint does not                                              | deal correlation uses the list endpoint                                               |
| **An undocumented per-second limit** — `x-hubspot-ratelimit-secondly: 10`                                | batch operations run sequentially, not through `Promise.all`                          |
| `batch/upsert` cannot say whether it created or updated                                                  | a batch read runs first, so the sync report is truthful                               |
| `batch/read` returns HTTP 200 with `errors[].context.ids` for missing records                            | a missing record is not treated as a failure                                          |

---

## Documentation

| Document                                                     | Covers                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`docs/CONTEXT.md`](docs/CONTEXT.md)                         | **How the system works** — the domain, the layers, one request end to end |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)               | Why the structure is shaped this way, and what it buys                    |
| [`docs/HUBSPOT_SETUP.md`](docs/HUBSPOT_SETUP.md)             | Portal, credential, scopes, and the traps in each                         |
| [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md)             | Every endpoint with its scope and official documentation URL              |
| [`docs/ERROR_HANDLING.md`](docs/ERROR_HANDLING.md)           | Error taxonomy, retry policy, rate limits, redaction                      |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)                     | Fourteen decisions with their alternatives and reasoning                  |
| [`docs/REQUIREMENTS_MATRIX.md`](docs/REQUIREMENTS_MATRIX.md) | Requirement → implementation, generated                                   |
| [`docs/PLAN.md`](docs/PLAN.md)                               | The delivery plan                                                         |
| [`docs/PROGRESS.md`](docs/PROGRESS.md)                       | What actually happened, including blockers and defects                    |

---

## Project structure

```
src/
├── config/          env loading, endpoint paths, scope catalogue
├── clients/         hubSpotClient — the only module that speaks HTTP
├── repositories/    contact, deal, association, pipeline, property
├── services/        hubSpotService, contactSyncService, dealSyncService
├── api/             hubSpotApiHandler
├── errors/          HubSpotApiError, InvalidConfigurationError
├── utils/           redaction, logging, validation, pagination, backoff, streams
├── fundamentals/    Section 1
└── examples/        one runnable script per operation
```

Dependencies run strictly downward: `examples → api → services → repositories →
clients → HubSpot`. Each layer has exactly one reason to change.

The concrete payoff: HubSpot retires the `v4` association endpoints in **March
2027**. Because every request path is built by a function in
`config/hubspot.config.js`, that migration touches `config/` and
`repositories/` — services, handlers and examples are untouched.

That is enforced, not merely stated. `tests/unit/architecture.test.js` fails the
build if any module outside `config/` constructs an endpoint path, if
dependencies ever run upward, or if anything but the client builds an
`Authorization` header.

Full reasoning in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Requirements

- **Node.js 18.17 or newer** (CI runs 18, 20 and 22)
- A HubSpot account with a private app and an access token

---

## License

[MIT](LICENSE)
