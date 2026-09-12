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
| 1            | `chore/scaffolding`             | in progress |
| 2            | `feat/config-and-logging`       | not started |
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
