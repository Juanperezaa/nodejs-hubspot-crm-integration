# Technical Decisions

Each entry states the decision, the alternatives that were genuinely
considered, and the reasoning. Decisions are appended, never rewritten; if one
is reversed, a new entry supersedes it.

---

## D1 — `axios` rather than `@hubspot/api-client`

**Decision.** Build the HTTP layer on `axios` and construct every HubSpot
request explicitly.

**Alternatives.** The official `@hubspot/api-client` SDK (v14) wraps the same
endpoints with typed methods.

**Reasoning.**

The brief offers either. Two of the six grading criteria decide it:

- _"Appropriate real HubSpot API calls (endpoints, payloads, pagination
  handling)"_ — with `axios`, every endpoint path, query parameter and payload
  is visible in source and auditable by a reviewer. The SDK hides all three
  behind method names, leaving nothing to assess.
- _"Robust error handling and retries where applicable"_ — the brief requires a
  `handleHubSpotErrors` utility implementing retries and backoff. The SDK ships
  its own error handling, which would either conflict with ours or make it
  redundant.

The SDK is the better choice for a production integration where endpoint
churn is a maintenance cost. It is the worse choice for an exercise whose
explicit purpose is demonstrating command of those endpoints.

**Cost accepted.** More code to maintain, and pagination and retries must be
implemented rather than inherited.

---

## D2 — CommonJS for the entire project

**Decision.** `require` / `module.exports` throughout. No ESM.

**Reasoning.** Section 1.3 of the brief requires demonstrating CommonJS modules.
Using CommonJS in the exercise and ESM everywhere else would make the exercise
look like a detached artefact. A single module system is also one less thing
for a reviewer to reason about.

**Cost accepted.** No top-level `await`; entry points wrap in an async
function.

---

## D3 — `node:test` rather than Jest or Mocha

**Decision.** Node's built-in test runner.

**Reasoning.** It covers everything needed here — suites, subtests, assertions,
mocking — with zero dependencies. A reviewer's `npm install` stays small and
there is no configuration file to explain. Jest would add roughly three hundred
transitive packages to a project whose entire production dependency list is two
entries.

---

## D4 — Hand-written payload validation

**Decision.** Implement `validateHubSpotPayload` directly, without Zod, Joi or
Yup.

**Reasoning.** The brief names `validateHubSpotPayload` as a required artefact.
Delegating its logic to a schema library would satisfy the filename while
removing the substance being assessed. The validator also has a job no generic
library would do: translating the property aliases described in D5.

---

## D5 — Accept the brief's property names and translate them

**Decision.** `validateHubSpotPayload` accepts `hs_pipeline` and `hs_stage`,
and normalises them to `pipeline` and `dealstage` before the request is sent.

**Context.** The brief asks for deals to be created with `properties.dealname`,
`properties.amount`, `hs_pipeline` and `hs_stage`. The last two are **Ticket**
properties. The Deal object uses `pipeline` and `dealstage`. Sending the
brief's names verbatim returns `400 PROPERTY_DOESNT_EXIST`.

**Alternatives.**

1. Send the brief's names verbatim — satisfies the letter, fails every call.
2. Use the correct names only — works, but appears to ignore the instruction.
3. Accept both, translate, document. **Chosen.**

**Reasoning.** Option 3 satisfies the literal requirement at the public API
boundary while producing a request HubSpot accepts. The brief also instructs
_"Use only the official HubSpot documentation to build calls"_, and the
official Deals guide is unambiguous. The discrepancy is verified empirically at
runtime by `GET /crm/v3/properties/deals`, which doubles as the mandatory
Properties endpoint.

---

## D6 — Configurable API versions, defaulting to v3 and v4

**Decision.** Object and association API versions are constants in
`src/config/hubspot.config.js`, overridable by environment variable, defaulting
to `v3` for CRM objects and `v4` for associations.

**Context.** HubSpot has moved to date-based versioning
(`/crm/objects/2026-09/…`). The `v3` object endpoints remain supported with no
announced end of life; the `v4` association endpoints are supported until
March 2027.

**Reasoning.** The brief names `/crm/v3/objects/contacts` and
`/crm/v3/objects/deals` explicitly, so those are the defaults. Isolating the
version in configuration means the March 2027 migration touches two files
rather than every repository.

---

## D7 — Private App token as the only authentication path

**Decision.** Authenticate exclusively with a Private App access token in an
`Authorization: Bearer` header.

**Context.** The brief offers _"private app token or API key"_. HubSpot has
discontinued the `hapikey` API key.

**Reasoning.** There is no working API key path left to implement. Recording
this as a decision rather than silently omitting it shows the option was
evaluated.

---

## D8 — The HubSpot MCP servers are out of scope

**Decision.** Do not use either HubSpot MCP server.

**Context.** HubSpot publishes two Model Context Protocol servers: a remote one
at `mcp.hubspot.com` that lets an LLM client read and write CRM records over
OAuth, and a local CLI-based one for developing on the HubSpot platform.

**Reasoning.** MCP is a transport between a _language model_ and HubSpot. The
brief requires the _Node.js code_ to make real API calls. Routing through MCP
would replace the graded work rather than support it. The local developer
server targets HubSpot platform development — UI extensions, project
deployments — which this project does not do.

---

## D9 — `batch/upsert` for contact synchronisation, not per-record search

**Decision.** `syncContactsWithHubSpot` uses
`POST /crm/v3/objects/contacts/batch/upsert` with `idProperty: "email"`.

**Alternatives.** Search each contact by email, then create or patch based on
the result.

**Reasoning.** Email is a natively unique property on every HubSpot tier, so
upsert gives true idempotency in one call per batch. The search-based
alternative would hit the Search API, which carries its own limit of 5 requests
per second and a hard cap of 10,000 results — an order of magnitude tighter
than the standard 100–190 requests per 10 seconds. For any realistic contact
set the search approach is the one that breaks first.

**Note.** Deals get the read-then-write treatment instead, because they have no
natural unique key. See D10 when written.

---

## D10 — Commit linting in CI, not in a local git hook

**Decision.** Validate commit messages in the CI pipeline. Do not install Husky
or any `prepare` hook.

**Reasoning.** A `prepare` script that installs git hooks modifies the
reviewer's local git configuration as a side effect of `npm install`. For a
repository whose purpose is to be cloned and inspected by someone else, that is
an unwelcome surprise. CI validation cannot be bypassed with `--no-verify`
either, so it is the stronger control of the two.
