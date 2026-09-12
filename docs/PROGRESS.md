# Progress Log

> **Living document.** Appended as work happens. Companion to
> [`PLAN.md`](./PLAN.md), which states intent; this file records outcome.
>
> Newest entries at the top. Each entry states what changed, what was verified,
> and what it unblocked or blocked.

---

## Status at a glance

| Pull request | Scope                           | State       |
| ------------ | ------------------------------- | ----------- |
| 1            | `chore/scaffolding`             | merged      |
| 2            | `feat/config-and-logging`       | in progress |
| 3            | `feat/fundamentals`             | not started |
| 4            | `feat/http-client-and-errors`   | not started |
| 5            | `feat/contacts`                 | not started |
| 6            | `feat/deals`                    | not started |
| 7            | `feat/associations`             | not started |
| 8            | `feat/sync`                     | not started |
| 9            | `feat/api-handler-and-examples` | not started |

**Requirement coverage:** 0 / 30 verified — run `npm run verify:requirements`.

**Current blocker:** no valid `pat-` access token available. See entry
_2026-09-11 · Credential mismatch_ below.

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
