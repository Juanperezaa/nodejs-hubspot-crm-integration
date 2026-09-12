# Progress Log

> **Living document.** Appended as work happens. Companion to
> [`PLAN.md`](./PLAN.md), which states intent; this file records outcome.
>
> Newest entries at the top. Each entry states what changed, what was verified,
> and what it unblocked or blocked.

---

## Status at a glance

| Pull request | Scope                            | State  |
| ------------ | -------------------------------- | ------ |
| 1            | `chore/scaffolding`              | merged |
| 2            | `feat/config-and-logging`        | merged |
| 3            | `feat/fundamentals`              | merged |
| 4            | `feat/http-client-and-errors`    | merged |
| 5            | `docs/hubspot-setup` (unplanned) | merged |
| 6            | `docs/scope-audit` (unplanned)   | merged |
| 7            | `feat/contacts`                  | merged |
| 8            | `feat/deals`                     | merged |
| 9            | `feat/associations`              | merged |
| 10           | `feat/sync`                      | merged |
| 11           | `feat/api-handler-and-docs`      | final  |

**Requirement coverage:** 27 / 27 artefacts — run `npm run verify:requirements`.

**Scope coverage:** 17 / 17 endpoints authorised by the six requested scopes —
run `npm run probe` against a live token, or `npm test` for the computed proof.

**No blockers.** The portal is connected and every requirement is implemented
and verified against it.

---

## 2026-09-12 - PR 11: handler, examples and documentation

The final slice. Requirement coverage reaches **27 / 27**.

**Done**

- `hubSpotApiHandler` (R18). Executable scripts rather than Express: a reviewer
  clones, runs `npm install`, and exercises a real operation in one command.
  The operation table is data, so `--help` is generated from the same source
  that dispatches and the two cannot drift.
- Eight runnable examples, one per section of the brief, including
  `error-handling.js` which provokes every failure class and prints how it
  is classified, and `full-workflow.js` which exercises every layer against
  the portal in about ten seconds and cleans up after itself.
- `docs/CONTEXT.md` - the system explained: domain, layers, one request end to
  end, and where failures go.
- `docs/ARCHITECTURE.md` - why the structure is shaped this way and what it
  buys, including what is deliberately absent.
- `docs/ERROR_HANDLING.md` - the full taxonomy and retry policy.
- `README.md` rewritten.
- `docs/REQUIREMENTS_MATRIX.md` generated from the verifier.
- CI switched to `verify:requirements:strict`. The matrix was a progress bar
  while the project was being built; now that coverage is complete it is a gate.

**Verified**

- `npm test` 163/163, `npm run test:integration` 48/48 against the live portal.
- `npm run verify:requirements:strict` 27/27, exit 0.
- `npm run example:workflow` executed end to end against hub 52018022.

**A documentation claim that was wrong**

`README.md` and `ARCHITECTURE.md` both asserted that `grep -r "crm/v3" src/`
returns hits only in `config/`. Running it returned seven files.

The _substance_ held - path construction really does happen only in
`config/hubspot.config.js` - but the evidence offered did not support it: the
other hits are documentation comments quoting the brief, the endpoint catalogue
in `config/scopes.js`, and one error-guidance string.

Rather than reword the claim, it was made executable.
`tests/unit/architecture.test.js` now fails the build if any module outside
`config/` interpolates an endpoint path, if dependencies run upward, if
anything but the client builds an `Authorization` header, if a fundamentals
file grows a dependency on HubSpot configuration, or if a source file loses
`'use strict'`. Seven invariants, because a claim in a document decays quietly
while a failing test does not.

---

## 2026-09-12 - Portal connected, and PR 7: Contacts

**The blocker is cleared.** A valid access token was supplied and
`npm run probe` ran green against a live portal.

```
hub id : 52018022          app id : 52891293
scopes : 7 granted         17 of 17 endpoints permitted
```

**F1 is now proven, not argued.** Among 206 deal properties defined in that
portal:

| Property                                       | Exists |
| ---------------------------------------------- | ------ |
| `dealname`, `amount`, `pipeline`, `dealstage`  | yes    |
| `hs_pipeline`, `hs_stage`, `hs_pipeline_stage` | **no** |

The property names the brief specifies do not exist on the Deal object. The
alias layer built in PR 4 is what makes the brief's payload work.

**Done**

- `contactRepository` covering the Contacts endpoints: streaming, cursor
  paging, read by id, read by email through `idProperty`, create, update,
  delete, batch upsert, search.
- `hubSpotService` with R01 through R05 under the names the brief fixes.
- `tests/integration/contacts.integration.test.js`: 12 real calls against the
  portal, guarded by `HUBSPOT_ALLOW_WRITE`, cleaning up in `after()` regardless
  of outcome.

**Verified**

- `npm test` 156/156. `npm run test:integration` **12/12 against the live
  portal**.
- Requirement matrix 15 / 27.

**Findings from the live portal**

- _HubSpot reports a per-second limit its published table omits._ Responses
  carry `x-hubspot-ratelimit-secondly: 10` and a remaining counter alongside
  the documented hundred-per-ten-seconds burst. It binds first under
  concurrency: ten parallel requests exhaust it while the ten-second window
  still shows ninety remaining. The client now records both, and batch upserts
  run sequentially rather than through `Promise.all` because of it.
- _`DELETE` is unconditionally idempotent and silent about it._ Measured:
  deleting a live record, an already-archived record, and **an id that never
  existed** all return success. The endpoint never returns 404.

**Defects found and fixed**

- _A dishonest contract._ `deleteHubSpotContact` returned `deleted: true`,
  inferring a removal from a successful response. Given the finding above that
  claim could not be supported, because the API does not know either. It now
  reports `archived`, meaning HubSpot accepted the request, and populates
  `existedBeforeDelete` only when a caller opts into the extra read that can
  establish it. The integration suite caught this.
- _A credential leak through a test assertion._ With a populated `.env` on
  disk, a test deleting `HUBSPOT_ACCESS_TOKEN` got it straight back, because
  `resetEnvironmentCache` also reset the dotenv flag and the lazy first read
  repopulated it. The resulting assertion failure printed the live token into
  the test output. Two fixes: the cache reset no longer reloads `.env`, and the
  assertion now compares a boolean so no failure diff can print a credential.
  Verified by grepping the suite output for token patterns: zero.

---

## 2026-09-11 · Scope audit — confirming nothing else is needed

Prompted by a direct question: are six scopes actually enough? Answered by
auditing every endpoint against the official documentation rather than by
reasoning from the function list.

**Done**

- `src/config/scopes.js` — all seventeen endpoints the project calls,
  catalogued with the scopes that authorise each, the functions that depend on
  them, and `auditScopeCoverage` to compute coverage for any token.
- `scripts/probe-portal.js` rewired to that table. It now reports _which
  operations_ an absent scope blocks, rather than merely that a scope is
  absent.
- `docs/API_REFERENCE.md` — the endpoint catalogue with official documentation
  URLs, which closes requirement R26.
- `tests/unit/scopes.test.js` — 11 assertions. Total 156 passing.

**Verified**

| Token holds                          | Endpoints permitted                |
| ------------------------------------ | ---------------------------------- |
| All six requested scopes             | 17 / 17                            |
| The four `crm.objects.*` scopes only | **17 / 17**                        |
| Read scopes only                     | 9 / 17                             |
| No scopes                            | 1 / 17 — token introspection alone |

**Findings**

- _Six scopes suffice, and four would._ HubSpot requires "**one of**" the
  listed scopes per endpoint, so `crm.objects.deals.read` alone already
  authorises both Properties and Pipelines. The two `crm.schemas.*.read`
  entries are defence in depth, kept because they cost nothing.
- _Associations need no scope of their own,_ confirmed against the official
  guide. A test now fails if any association entry ever lists a scope
  containing "association".
- _Token introspection needs no scope at all._ It authenticates with the very
  token it reports on.

**Design change the audit forced**

`syncDealsWithHubSpot` was to correlate existing deals through a custom
property. Creating one requires `crm.schemas.deals.write` — a seventh scope —
and leaves a property behind on the operator's Deal schema permanently, unlike
the records this project creates and then deletes.

Changed to correlate on `dealname` through the Search API, which is already
covered. The trade-off is stated rather than hidden: renaming a seeded deal in
HubSpot and re-running the sync creates a second deal instead of updating the
first. With a fixed seed file that cannot occur. Recorded as decision **D11**.

**Note on modelling**

The requirement is `anyOf`, not a flat list. A required-list model would have
reported `crm.schemas.deals.read` as missing even when `crm.objects.deals.read`
already authorised the same call — a false alarm that would have sent the
operator back to the scope picker for nothing. Recorded as **D12**.

---

## 2026-09-11 · Scope permissions blocked in the shared portal

**Finding**

The six scopes this project needs cannot be granted in the portal being used.
They appear in the scope picker but are greyed out and unselectable.

The cause is not a missing subscription or a wrong scope name. **A HubSpot
private app can only be granted scopes the user creating it already holds.**
The user's seat in the shared company sandbox carries no CRM permissions over
contacts and deals, so those scopes are unavailable to any app they create
there.

Confirmed by observation: `crm.schemas.deals.read` and `crm.schemas.deals.write`
are both present in the picker and both disabled, which rules out a missing or
misspelled scope.

**Why this matters beyond the immediate block**

The brief asks for "**your own** HubSpot portal (developer account / private
app)". A shared company sandbox is not that. Two consequences follow:

1. Scope availability is governed by someone else's decisions about the
   operator's seat.
2. This project creates, updates and **deletes** real records. Running the
   integration suite repeatedly in a sandbox colleagues use for their own
   testing pollutes their environment.

**Resolution offered, in order of cost**

1. Reuse the token of a private app already present in the portal, created by
   someone who did hold the permissions. Costs nothing to try, and
   `npm run probe` reports exactly which scopes any token carries.
2. **Create a developer test account.** Free, Super Admin by default, all
   scopes available, 90-day Enterprise trial, and it is what the brief actually
   asks for. Recommended.
3. Ask a Super Admin of the shared portal to grant CRM permissions. Works, but
   depends on another person's availability.

**Documented in** `docs/HUBSPOT_SETUP.md`, including the greyed-out-scope
diagnosis, so the next reader does not have to rediscover it.

---

## 2026-09-11 · PR 4 — HTTP client, error handling, validation, pagination

The technical core of Section 2. Everything here is exercised by unit tests
against fabricated responses; the live-portal evidence follows once a token is
available.

**Done**

- `src/errors/HubSpotApiError.js` — one error type for every failure mode, with
  a decided `kind` and an `isRetryable` that callers act on without inspecting
  `error.response?.status ?? error.code`.
- `src/utils/handleHubSpotErrors.js` — normalisation, retry loop and backoff.
  Full jitter, `Retry-After` honoured and capped.
- `src/utils/validateHubSpotPayload.js` — validation plus the deal property
  alias translation.
- `src/utils/paginate.js` — cursor pagination as an async generator, with a
  repeated-cursor guard and batch chunking.
- `src/clients/hubSpotClient.js` — the single module that speaks HTTP to
  HubSpot. Lazy axios instance, rate-limit header observation, every request
  wrapped in the retry policy.
- 79 new tests. Total 145 passing.

**Verified**

- `npm run lint` clean, `npm test` 145/145.
- Requirement matrix 8 / 27.

**Decisions taken during the work**

- _Validation failures reuse `HubSpotApiError` with kind `VALIDATION`_ rather
  than introducing a third error type. A locally-detected bad payload and a
  remotely-rejected one are both non-retryable and both fixed in the same
  place, so a caller's `catch` should not have to distinguish them.
- _Full jitter, not fixed backoff._ HubSpot's burst limit is a rolling
  ten-second window shared by every caller using the same app. Fixed delays
  make throttled callers retry in lockstep and re-trigger the identical limit.
- _`Retry-After` is capped even though HubSpot supplies it._ A misconfigured
  proxy returning `Retry-After: 86400` must not park the process for a day.
- _Pagination is an async generator, not a function returning an array._ A
  portal with fifty thousand contacts would otherwise need all fifty thousand
  in memory before the caller saw the first one. `collectAllPages` exists for
  when an array genuinely is wanted, so that choice is visible at the call site.
- _The client caches its axios instance lazily_, for the same reason the
  configuration validates lazily: the requirement matrix loads every module,
  and constructing a client at import would demand a token in CI.

**Defects found and fixed during the work**

- _A misleading validation message._ `validateRecordId(-1)` reported that the
  value "must be a non-empty string". True, but useless: the caller passed a
  number and was being sent to fix the wrong thing. Numbers are now handled
  before the string check.
- _An over-strict lint rule._ `require-await` rejected test doubles standing in
  for network calls. They are correctly `async` — they must return a Promise to
  match the real signature — even with nothing to await. Relaxed for tests only.

**Notes**

- Scope guidance corrected. The initial plan listed `crm.associations.read`
  and `crm.associations.write`. The v4 association endpoints are authorised by
  the object scopes of both objects involved, so `crm.objects.contacts.write`
  plus `crm.objects.deals.write` covers `associateContactToDeal`. `npm run
probe` verifies this against the live portal.

---

## 2026-09-11 · PR 3 — Section 1, Node.js fundamentals

Worth 40% of the assessment, so each exercise is implemented as working,
tested code rather than as a snippet that satisfies a filename.

**Done**

- `src/fundamentals/callbacks.js` (1.1) — both forms the brief allows:
  `setTimeout` for a failure the function decides on, and `fs.readFile` for one
  the operating system reports. Error-first contract throughout, with the
  callback always deferred so the function is never sometimes-reentrant.
- `src/fundamentals/asyncAwait.js` (1.2) — a genuine refactor: the Section 1.1
  functions are wrapped rather than reimplemented, one by hand to show the
  mechanics and one with `promisify` to show the shorthand. Adds `Promise.all`
  for concurrency and `Promise.allSettled` for partial success, the latter
  being exactly what the sync services need.
- `src/fundamentals/utils_module.js` + `main.js` (1.3) — CommonJS export and
  consumer. `sumDealAmounts` applies the exercise to the domain: HubSpot
  returns amounts as strings, so a naive sum concatenates.
- `src/utils/streams.js` (1.4) — the required `Readable.from` → uppercase →
  `process.stdout` flow, plus object-mode streaming of contact records.
- `data/contacts.seed.json`, `data/deals.seed.json` — sources for Section 2.
- 36 new tests. Total 66 passing.

**Verified**

- `npm run lint` clean, `npm test` 66/66.
- All four exercises executed end to end via their npm scripts; output
  inspected, not assumed.

**Defects found and fixed during the work**

- _A test asserting something Node does not guarantee._ The chunk-boundary test
  expected three separate reads from the uppercase Transform and got one
  coalesced read. The transform was correct — `_transform` did run three times —
  but a non-object-mode readable side is free to merge queued chunks, so the
  assertion was measuring the reader rather than the transform. Rewritten to
  read output back after each individual write, which is the property that
  actually matters and is guaranteed.
- _A misleading error message._ `sumArrayOfNumbers([1, NaN])` reported
  "index 1 is null", because `JSON.stringify(NaN)` returns `"null"`. A reader
  would have gone looking for a null. Now named explicitly, with a test.

**Decisions taken during the work**

- `utils_module.js` keeps the brief's `snake_case` filename although every
  other file here is `camelCase`. The brief names it explicitly and an
  evaluator should find it under the name they asked for. Recorded rather than
  silently resolved.
- `pipeline` is used throughout instead of `.pipe()`. `.pipe()` forwards
  neither errors nor destruction, which leaks handles when a destination fails.
- The streams module goes beyond the brief with `streamContactFullNames`,
  because that is the shape `getHubSpotContactNames` needs: constant memory
  over a paginated source, whether the portal holds ten contacts or a hundred
  thousand.

---

## 2026-09-11 · PR 2 — Configuration, logging and portal diagnostic

**Done**

- `src/utils/redactSecrets.js` — structural secret redaction. Walks any value,
  masking by key name (`authorization`, `tokenKey`, `clientSecret`, …) and by
  text pattern (`pat-…` tokens, `Bearer …`, `hapikey=…`, bare UUIDs). Cycle
  safe, because axios error objects are self-referential.
- `src/utils/logger.js` — levelled logger. Every value passes through redaction
  before it reaches a transport; there is no path around it. Errors and
  warnings go to stderr so piping stdout never mixes diagnostics into data.
- `src/errors/InvalidConfigurationError.js` — kept distinct from API errors
  because retrying a configuration fault can never help.
- `src/config/env.js` — lazy, cached, frozen environment loading with
  per-variable validation.
- `src/config/hubspot.config.js` — the single place where HubSpot's API surface
  is described: every endpoint path builder, the association type ids, the
  pagination limits, the retry policy and the deal property aliases.
- `scripts/probe-portal.js` — live diagnostic answering the four questions
  every later failure traces back to: does the token authenticate, which scopes
  were granted, which deal property names really exist, and which pipeline and
  stage ids belong in `.env`.

**Verified**

- `npm run lint` clean.
- `npm test` — 30 passing, up from 10. Twenty new assertions cover redaction
  and configuration validation.

**Decisions taken during the work**

- _Lazy configuration validation._ Reading configuration at require time would
  break `npm run verify:requirements` in CI, where no token exists — and CI is
  precisely where the requirement matrix matters most. It would also prevent
  the Section 1 fundamentals from running without HubSpot credentials.
- _The probe does not use `hubSpotClient`._ A diagnostic must not share the
  code path it is diagnosing; if the client's auth or retry logic were broken,
  a probe built on it would report the symptom rather than the cause.
- _`HUBSPOT_ALLOW_WRITE` accepts only the word `true`, in any casing._ Values
  that merely suggest assent (`1`, `yes`, `on`) are rejected so the switch fails
  closed. Rejecting `TRUE` as well would be a usability trap, not a safety
  property. The first version of this check disagreed with its own docstring;
  the test caught it.
- _Merge strategy corrected to merge commits._ Documented in `PLAN.md` §7. The
  original plan said squash, which would have discarded the per-commit
  reasoning that this repository is partly being judged on.

**Notes**

- `env.js` detects the specific case of a client secret being supplied in place
  of an access token and explains the difference, because that mistake already
  cost one cycle on this project and produces a 401 otherwise — which reads
  identically to a missing scope.

---

## 2026-09-11 · PR 1 — Project scaffolding

**Done**

- Created the repository skeleton: layered `src/` tree, `tests/`, `scripts/`,
  `docs/`, `data/`.
- `package.json` with the full script surface (`lint`, `test`,
  `verify:requirements`, `probe`, `validate`, plus one script per fundamentals
  exercise).
- ESLint flat config. Beyond correctness rules it enforces the naming
  convention the brief asks for: `id-length` with a minimum of three characters
  rejects abbreviated identifiers, so names stay descriptive and English.
- Prettier, EditorConfig.
- `commitlint.config.js` restricting types and scopes to the documented sets.
  Local git hooks are deliberately **not** installed — a reviewer running
  `npm install` should not have their git configuration modified. Validation
  runs in CI instead.
- `.gitignore` refusing every `.env*` except `.env.example`.
- `.env.example` documenting all fifteen variables, each with the reason it
  exists and how to discover its value.

**Verified**

- Directory tree matches the layout in `PLAN.md` §3.

**Notes**

- `.env.example` calls out explicitly that the required credential is the
  **access token**, not the Client Secret, because that distinction already cost
  one cycle today.

---

## 2026-09-11 · Credential mismatch — blocker raised

**Finding**

The credential file supplied for the integration contained a 36-character UUID,
which is the private app's **Client Secret**, not its access token.

| Credential             | Purpose                              | Authenticates REST calls |
| ---------------------- | ------------------------------------ | ------------------------ |
| Client Secret (UUID)   | Validates inbound webhook signatures | no                       |
| Access token (`pat-…`) | `Authorization: Bearer` header       | yes                      |

The probe failed at the transport layer — Node rejected the header value before
a request was even sent — which confirmed the value was not a bearer token.

**Impact**

Blocks verification layers 4 and 5 (live probe, integration tests). Does **not**
block PRs 1 through 4, nor the authoring of 5 through 9; only their evidence
against the live portal.

**Resolution required**

Access token from HubSpot → Settings → Integrations → Private Apps → _Carlos
API_ → **Auth** → _Show token_ → _Copy_.

---

## 2026-09-11 · Research and planning

**Done**

- Extracted and analysed the brief. Catalogued 30 discrete requirements
  (18 named artefacts, 4 fundamentals exercises, 8 cross-cutting rules).
- Researched the official HubSpot documentation for Contacts, Deals,
  Associations, Pipelines, Properties, authentication, rate limits and
  versioning.
- Produced `PLAN.md` with architecture, decisions, delivery sequence and
  verification strategy.

**Findings that changed the plan** — detailed in `PLAN.md` §5:

| ID  | Finding                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | The brief's `hs_pipeline` / `hs_stage` are Ticket properties; Deals use `pipeline` / `dealstage`. Resolved with an alias layer.                   |
| F2  | HubSpot moved to date-based versioning; `v4` associations end of life is March 2027. Versions made configurable.                                  |
| F3  | API Keys are discontinued; Private App token is the only path.                                                                                    |
| F4  | The Search API has its own 5 req/s limit and a 10,000-result cap, which rules out per-record search during sync.                                  |
| F5  | `POST /oauth/v2/private-apps/get/access-token-info` returns hub id, app id and granted scopes — used to generate scope docs from the live portal. |

**Decisions locked**

- `axios` over the official SDK — keeps graded endpoints visible in source.
- CommonJS throughout.
- `node:test` as the runner.
- Nine-pull-request delivery sequence.
- The HubSpot MCP servers were evaluated and **excluded**: they expose HubSpot
  to an LLM agent, whereas the brief requires the Node.js code itself to make
  the calls. Reasoning recorded in `DECISIONS.md`.

**Environment**

| Tool       | Version                 |
| ---------- | ----------------------- |
| Node.js    | v22.14.0                |
| npm        | 11.12.0                 |
| git        | 2.40.1                  |
| GitHub CLI | 2.100.0 — authenticated |
