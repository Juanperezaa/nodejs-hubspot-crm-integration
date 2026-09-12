# Delivery Plan

> **Living document.** Updated whenever scope, sequencing or a technical
> decision changes. Companion document: [`PROGRESS.md`](./PROGRESS.md), which
> records what actually happened.
>
> Last updated: 2026-09-11

---

## 1. Objective

Deliver a complete, production-shaped Node.js integration with the HubSpot CRM
API that satisfies every requirement of the _"NodeJS — HubSpot CRM Integration"_
technical test, scored **40% Node.js fundamentals / 60% HubSpot integration**.

The deliverable is judged on six criteria, taken verbatim from the brief:

| #   | Criterion                                                                          |
| --- | ---------------------------------------------------------------------------------- |
| C1  | Appropriate real HubSpot API calls (endpoints, payloads, pagination handling)      |
| C2  | Quality of the Node.js implementation (asynchrony, Promises, async/await, streams) |
| C3  | Modularity and separation of concerns (not everything in one file)                 |
| C4  | Robust error handling and retries where applicable                                 |
| C5  | Clear documentation in README.md                                                   |
| C6  | Technical decisions explained in English in the README                             |

---

## 2. Required artefacts

The brief names specific functions and modules that **must exist with those
exact names**. This is the authoritative checklist; live status is tracked in
[`REQUIREMENTS_MATRIX.md`](./REQUIREMENTS_MATRIX.md) and verified mechanically by
`npm run verify:requirements`.

### 2.1 Core HubSpot functions

| ID  | Name                     | Contract                                                                   |
| --- | ------------------------ | -------------------------------------------------------------------------- |
| R01 | `getHubSpotContactNames` | Array of full names (`firstname` + `lastname`) for all contacts, paginated |
| R02 | `getHubSpotContacts`     | Paginated contact details with filter/pagination options                   |
| R03 | `createHubSpotContact`   | Creates a contact (POST)                                                   |
| R04 | `updateHubSpotContact`   | Updates contact properties (PATCH)                                         |
| R05 | `deleteHubSpotContact`   | Deletes a contact (DELETE)                                                 |
| R06 | `getHubSpotDeals`        | Lists deals with pagination                                                |
| R07 | `createHubSpotDeal`      | Creates a deal with name, amount, pipeline and stage                       |
| R08 | `updateHubSpotDeal`      | Updates a deal                                                             |
| R09 | `deleteHubSpotDeal`      | Deletes a deal                                                             |

### 2.2 Associations and synchronisation

| ID  | Name                      | Contract                                                          |
| --- | ------------------------- | ----------------------------------------------------------------- |
| R10 | `associateContactToDeal`  | Associates a contact with a deal, idempotently                    |
| R11 | `syncContactsWithHubSpot` | Syncs contacts from a local JSON source, idempotent create/update |
| R12 | `syncDealsWithHubSpot`    | Equivalent logic for deals                                        |

### 2.3 Infrastructure, services, utilities

| ID  | Name                                   | Contract                                                              |
| --- | -------------------------------------- | --------------------------------------------------------------------- |
| R13 | `hubSpotClient`                        | Central HTTP client, configurable via config and env vars             |
| R14 | `hubSpotService`                       | Orchestrator built on `hubSpotClient`                                 |
| R15 | `contactRepository` / `dealRepository` | Abstractions encapsulating CRUD calls                                 |
| R16 | `validateHubSpotPayload`               | Validates payloads before sending                                     |
| R17 | `handleHubSpotErrors`                  | Normalises and logs errors, including retries and backoff for 429/5xx |
| R18 | `hubSpotApiHandler`                    | Executable handler for testing operations with clear console output   |

### 2.4 Section 1 — Node.js fundamentals (40%)

| ID  | Requirement                                                         | Target file                                                    |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| R19 | Async operation with a callback                                     | `src/fundamentals/callbacks.js`                                |
| R20 | Same function refactored to a Promise, consumed with async/await    | `src/fundamentals/asyncAwait.js`                               |
| R21 | CommonJS module exporting an array-sum function, plus its consumer  | `src/fundamentals/utils_module.js`, `src/fundamentals/main.js` |
| R22 | Stream from `Readable.from()`, uppercase transform, piped to stdout | `src/utils/streams.js`                                         |

### 2.5 Cross-cutting mandatory requirements

| ID  | Requirement                                                                               |
| --- | ----------------------------------------------------------------------------------------- |
| R23 | Official endpoints for Contacts, **Deals, Associations, Pipelines and Properties**        |
| R24 | Auth via env var (`HUBSPOT_ACCESS_TOKEN`); no credentials in the repo                     |
| R25 | Handle pagination, scopes and rate limits per the documentation                           |
| R26 | Document portal id (hubId), endpoints used with official doc URLs, and private app scopes |
| R27 | Modular structure, with a written justification of why                                    |
| R28 | `README.md` with install / configure / run instructions                                   |
| R29 | `.env.example` without credentials                                                        |
| R30 | Errors logged without exposing tokens or sensitive data                                   |

---

## 3. Architecture

Layered, with strictly unidirectional dependencies:

```
examples/ ──► api/ ──► services/ ──► repositories/ ──► clients/ ──► HubSpot REST
                                          │                │
                                          └──► utils/ ◄────┘
                                               errors/
```

Each layer has exactly one reason to change:

- **`clients/`** — knows _how to speak HTTP_: authentication, timeouts, retries,
  headers. Knows nothing about what a contact is.
- **`repositories/`** — knows _which endpoint maps to which object_ and the
  shape of its payload. Holds no business rules.
- **`services/`** — knows _which sequence of operations_ satisfies a use case
  (idempotent sync, create-then-associate). Knows nothing about HTTP.
- **`api/` + `examples/`** — knows _how the work is invoked and presented_.

The concrete payoff: when HubSpot retires the `v4` association endpoints in
March 2027, only `config/hubspot.config.js` and `repositories/` change. Services,
handlers and examples are untouched.

Full reasoning in [`ARCHITECTURE.md`](./ARCHITECTURE.md); runtime flow in
[`CONTEXT.md`](./CONTEXT.md).

---

## 4. Technical decisions

Recorded with their rationale in [`DECISIONS.md`](./DECISIONS.md). Summary:

| Decision                | Choice                                 | Rationale                                                                                                                                                             |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP client             | `axios` over `@hubspot/api-client`     | Endpoints stay visible and auditable in source — precisely what criterion C1 grades — and retry/backoff/error normalisation stay under our control, which C4 requires |
| Module system           | CommonJS                               | Section 1.3 requires demonstrating CommonJS; using it throughout is coherent                                                                                          |
| Test runner             | Node's built-in `node:test`            | Zero extra dependencies                                                                                                                                               |
| Payload validation      | Hand-written, no Zod/Joi               | The brief requires implementing `validateHubSpotPayload`; delegating it would defeat the requirement                                                                  |
| Contact idempotency     | `batch/upsert` with `idProperty=email` | Email is a natively unique property on every tier; avoids the Search API's 5 req/s cap                                                                                |
| Deal idempotency        | Correlation property + read-then-write | Deals have no natural unique key                                                                                                                                      |
| Association idempotency | `PUT` default association              | `PUT` is idempotent by HTTP semantics                                                                                                                                 |

---

## 5. Findings that shape the implementation

Discovered while reading the official documentation. Each one changes what the
code must do.

### F1 — The brief's deal property names do not exist

The brief asks for `hs_pipeline` and `hs_stage`. Those are **Ticket**
properties. The Deal object uses `pipeline` and `dealstage`, per the official
Deals guide.

**Resolution.** `validateHubSpotPayload` accepts both spellings and normalises
the brief's names to the real ones. The literal requirement is satisfied _and_
the call succeeds. Verified empirically against the portal through
`GET /crm/v3/properties/deals`, which simultaneously satisfies the mandatory
"Properties" endpoint requirement (R23).

### F2 — HubSpot has moved to date-based API versioning

Current versions are dated (`/crm/objects/2026-09/…`). Status:

- `/crm/v3/objects/*` — still supported, no announced end of life.
- `/crm/v4/associations/*` — supported until **March 2027**.

**Resolution.** Versions live in `hubspot.config.js` as configurable constants,
defaulting to `v3` objects + `v4` associations, which is what the brief
specifies. The migration path is documented in the README.

### F3 — API Keys are discontinued

The brief offers _"private app token or API key"_. HubSpot has retired
`hapikey`. Private App token is the only viable path, documented as a
deliberate decision rather than an omission.

### F4 — Rate limits and their headers

| Tier           | Per 10 s    | Per day             |
| -------------- | ----------- | ------------------- |
| Free / Starter | 100 per app | 250,000 per account |
| Professional   | 190 per app | 625,000             |
| Enterprise     | 190 per app | 1,000,000           |

Responses carry `X-HubSpot-RateLimit-Max`, `-Remaining`,
`-Interval-Milliseconds`, `-Daily`, `-Daily-Remaining`. A 429 carries
`Retry-After` plus `errorType: "RATE_LIMIT"` and
`policyName: "DAILY" | "TEN_SECONDLY_ROLLING"`.

The **Search API is limited separately: 5 req/s, 200 records per page, hard cap
of 10,000 results.** This is why the sync path uses `batch/upsert` rather than
per-record search.

### F5 — Private app token introspection

`POST /oauth/v2/private-apps/get/access-token-info` with body
`{"tokenKey": "<token>"}` returns hub id, app id and the full granted scope
list. `npm run probe` uses it to generate the scope documentation from the live
portal instead of hand-writing it.

> The more prominent `GET /oauth/v1/access-tokens/{token}` accepts OAuth tokens
> only and returns 400 for a private app token.

---

## 6. Error handling policy

Every failure is normalised into a `HubSpotApiError` carrying
`{ status, category, subCategory, correlationId, policyName, method, path, isRetryable }`.

| Condition                                                  | Action                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Network / timeout (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`) | retry with backoff                                                                     |
| **401 / 403**                                              | **never retry** — fail fast with an actionable message naming the likely missing scope |
| 400 / 404 / 409 and other 4xx                              | never retry — surface validation detail                                                |
| **429**                                                    | retry, honouring `Retry-After`; exponential backoff when absent                        |
| 502 / 503 / 504                                            | retry with backoff                                                                     |

Backoff: maximum 5 attempts, 500 ms base, factor 2, **full jitter**, 30 s ceiling.

Full jitter is used rather than fixed delay because HubSpot's limit is a rolling
ten-second window per app; synchronised retries would re-trigger the same limit.

Secret redaction is applied by the logger before any write: the `Authorization`
header, any `pat-*` token pattern and the legacy `hapikey` query parameter are
masked. Required by R30.

Detail in [`ERROR_HANDLING.md`](./ERROR_HANDLING.md).

---

## 7. Delivery sequence

Nine pull requests, each a vertical slice that leaves `main` in a working state.

| PR  | Branch                          | Scope                                                                               | Requirements       |
| --- | ------------------------------- | ----------------------------------------------------------------------------------- | ------------------ |
| 1   | `chore/scaffolding`             | Tooling, CI, templates, living docs                                                 | R27–R29            |
| 2   | `feat/config-and-logging`       | `env.js`, `hubspot.config.js`, logger with redaction, portal probe                  | R24, R26, R30      |
| 3   | `feat/fundamentals`             | Section 1 in full, plus unit tests                                                  | R19–R22            |
| 4   | `feat/http-client-and-errors`   | `hubSpotClient`, `handleHubSpotErrors`, retry, `validateHubSpotPayload`, pagination | R13, R16, R17, R25 |
| 5   | `feat/contacts`                 | `contactRepository` and contact operations                                          | R01–R05            |
| 6   | `feat/deals`                    | `dealRepository`, `pipelineRepository`, `propertyRepository`, deal operations       | R06–R09, R23       |
| 7   | `feat/associations`             | `associationRepository`, idempotent association                                     | R10                |
| 8   | `feat/sync`                     | Both sync services, seed data                                                       | R11, R12           |
| 9   | `feat/api-handler-and-examples` | `hubSpotApiHandler`, runnable examples, final docs                                  | R14, R18, R28      |

Conventions: Conventional Commits 1.0.0, atomic commits, validated in CI.

**Merge strategy: a merge commit per pull request, never a squash.**

Squashing would collapse each pull request into one commit and discard the
per-change reasoning the commit bodies carry. In a repository where the history
is itself part of the deliverable, that throws away the evidence.

A merge commit preserves every atomic commit _and_ records the pull request
boundary, so `git log --graph` maps one-to-one onto the nine delivery slices. A
reviewer can read it at two levels: merge commits as a table of contents, the
commits beneath them as the reasoning.

```
*   Merge pull request #1 from Juanperezaa/chore/scaffolding
|\
| * fix(tests): discover test files explicitly for cross-version support
| * docs(docs): add delivery plan, progress log and decision record
| * ci(ci): add quality, commit message and secret scan pipelines
| * ...
|/
* chore(repo): initialize repository with license and ignore rules
```

---

## 8. Verification strategy

Five layers, cheapest first.

| #   | Command                       | Guarantees                                                                                                                                | In CI              |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | `npm run lint`                | Style and static defects                                                                                                                  | yes                |
| 2   | `npm test`                    | Pure logic: backoff maths, error classification, payload validation, pagination, redaction, fundamentals                                  | yes                |
| 3   | `npm run verify:requirements` | **All 18 named artefacts exist, are exported and expose the expected signature.** Prints a PASS/FAIL matrix and exits non-zero on any gap | yes                |
| 4   | `npm run probe`               | Live connectivity, hub id, granted scopes, real property names                                                                            | no — needs a token |
| 5   | `npm run test:integration`    | Real end-to-end against the portal: create contact → create deal → associate → verify → clean up                                          | no — needs a token |

Layers 1–3 run in CI without secrets, so the public repository exposes nothing.
Layers 4–5 are run locally and their output is pasted as evidence into the
relevant pull request.

`npm run validate` runs layers 1–3 in sequence.

---

## 9. Open items

| Item                     | Status                                                                                             | Blocks                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Real `pat-` access token | **Awaiting user** — the supplied file held the Client Secret, which cannot authenticate REST calls | Layers 4 and 5; PRs 5–9 cannot be evidenced against the live portal |
| Scope verification       | Pending the token; `npm run probe` will report granted vs required                                 | R26                                                                 |
| Pipeline and stage ids   | Pending the token; `npm run probe` prints them for `.env`                                          | R07                                                                 |
