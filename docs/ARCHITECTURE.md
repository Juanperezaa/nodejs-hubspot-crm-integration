# Architecture

The brief asks for a modular structure and for a written justification of it:

> "The candidate must propose and follow a modular project structure (folders
> separated by responsibility: services, clients, utilities, examples/tests,
> etc.). **Briefly explain why you propose that structure.**"

This is that explanation. For the runtime flow, see
[`CONTEXT.md`](./CONTEXT.md).

---

## The structure

```
src/
├── config/          env loading, endpoint paths, scope catalogue
├── clients/         hubSpotClient — the only module that speaks HTTP
├── repositories/    one per HubSpot object family
├── services/        hubSpotService, contactSyncService, dealSyncService
├── api/             hubSpotApiHandler — dispatch and presentation
├── errors/          HubSpotApiError, InvalidConfigurationError
├── utils/           redaction, logging, validation, pagination, backoff, streams
├── fundamentals/    Section 1 of the brief
└── examples/        runnable scripts, one per operation

tests/unit/          pure logic, no network
tests/integration/   real calls against a live portal
scripts/             requirement verifier, portal probe, test runner
data/                JSON sources for the synchronisations
docs/                this file and its siblings
```

---

## The organising principle

**Each layer has exactly one reason to change.**

That is the whole design. Everything else follows from applying it honestly.

| Layer               | Changes when…                                       |
| ------------------- | --------------------------------------------------- |
| `clients/`          | authentication, timeouts or the retry policy change |
| `repositories/`     | HubSpot changes an endpoint path or payload shape   |
| `services/`         | the business requirement changes                    |
| `api/`, `examples/` | how the work is invoked or displayed changes        |

Dependencies run strictly downward. A repository may use the client; the client
knows nothing of repositories. Nothing below reaches upward.

---

## Why this and not something simpler

A brief this size could be satisfied by one `hubspot.js` with a dozen exported
functions. The brief forbids that outright — _"Submitting everything in a single
.js file is not allowed"_ — but the interesting question is what the layering
actually buys, since it is possible to add folders and gain nothing.

Three concrete returns:

### 1. A version migration touches two files instead of every file

HubSpot has moved to date-based versioning. The `v4` association endpoints
**become unsupported in March 2027**, and the `v3` object endpoints will follow.

Because every path in the project is built by a function in
`config/hubspot.config.js`, and only repositories call those functions, that
migration changes `config/` and `repositories/`. Services, handlers, examples
and every test above the repository layer are untouched.

**This is enforced, not aspirational.**
`tests/unit/architecture.test.js` fails the build if any module outside
`config/` interpolates an endpoint path.

The distinction the test draws is worth naming: `crm/v3` appears in several
files under `src/`, but only in documentation comments quoting the brief, in the
endpoint catalogue in `config/scopes.js`, and in one error-guidance string. The
test strips comments and looks for a path _interpolated into a template
literal_, which is what building a request path actually looks like. Quoting a
path is not constructing one.

### 2. Retry and redaction are properties of the system, not of the caller

Every HubSpot request goes through `hubSpotClient`, which wraps it in
`handleHubSpotErrors`. There is no second path. That means the retry policy
cannot be forgotten at a call site, because there is no call site that bypasses
it.

The same argument applies to secret redaction. It sits at the logger boundary,
so a credential cannot reach a transport regardless of who logs what.

Both would be _conventions_ in a flat structure — things you have to remember.
Here they are structural.

### 3. Business logic is testable without a network

`hubSpotService.getHubSpotContactNames` contains a real decision: nameless
contacts are excluded, because a list of full names containing empty strings is
not a list of names. That decision lives in a layer that does no HTTP, so it can
be reasoned about — and changed — without touching anything that talks to
HubSpot.

---

## Why a repository layer at all

The repositories are thin. It is a fair question whether they earn their place
rather than being ceremony between the service and the client.

They do, for one reason: **they are where HubSpot's quirks are absorbed.**

```js
// contactRepository — HubSpot returns only hs_object_id and timestamps
// unless properties are named explicitly. Missing this produces empty names
// from a response that still looks well formed.
const DEFAULT_CONTACT_PROPERTIES = ['firstname', 'lastname', 'email', …];
```

Other examples living in that layer: the `idProperty` trick that reads a contact
by email without spending a Search request; batch chunking at HubSpot's limit of
100 inputs; stages sorted by `displayOrder` because HubSpot returns them
unordered.

None of that is business logic, and none of it is HTTP mechanics. It is
knowledge about _this API_, and it needs somewhere to live where it can be found
and corrected in one place.

---

## Where each named requirement lives

The brief fixes several names. They are placed where the layer fits their job,
not where the name suggests.

| The brief's name                      | Lives in                             | Because                                |
| ------------------------------------- | ------------------------------------ | -------------------------------------- |
| `hubSpotClient`                       | `src/clients/`                       | It is the HTTP layer                   |
| `hubSpotService`                      | `src/services/`                      | It orchestrates; it holds R01–R10      |
| `contactRepository`, `dealRepository` | `src/repositories/`                  | They encapsulate CRUD                  |
| `validateHubSpotPayload`              | `src/utils/`                         | Used by repositories and services both |
| `handleHubSpotErrors`                 | `src/utils/`                         | Used by the client, useful everywhere  |
| `hubSpotApiHandler`                   | `src/api/`                           | Invocation and presentation            |
| `syncContactsWithHubSpot`             | `src/services/contactSyncService.js` | A use case, not a CRUD call            |
| `syncDealsWithHubSpot`                | `src/services/dealSyncService.js`    | Same, and it works differently         |

**The two syncs are separate modules on purpose.** Naming suggests symmetry, but
they are not symmetric: contacts upsert on a unique property, deals correlate
against a locally built index because no unique property exists. Putting both in
one file would invite a future reader to unify them, and the unification would
be wrong.

`hubSpotService` carries the brief's function names verbatim while the
repositories beneath use domain names (`findContactById`). **That mapping is the
point of the layer, not an accident of it** — it is where an externally imposed
vocabulary meets an internally coherent one.

---

## What is deliberately absent

| Not here                           | Why                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A dependency injection container   | Two production dependencies. It would add indirection and remove nothing.                                                            |
| An Express server                  | The brief allows it; scripts let a reviewer run a real operation in one command instead of three.                                    |
| A logging library                  | The only behaviour that matters — that no credential is written — is easier to guarantee in fifty lines than to configure correctly. |
| A schema validation library        | The brief names `validateHubSpotPayload` as a required artefact. Delegating it would keep the filename and remove the substance.     |
| A repository for every object type | Only Contacts, Deals, Associations, Pipelines and Properties are used. Speculative layers are cost without return.                   |
| Webhooks                           | Every requirement is outbound. A receiver needs a public HTTPS endpoint a reviewer cannot run from a clone.                          |

---

## Testing follows the same boundaries

| Suite                | Tests | Needs a network     |
| -------------------- | ----- | ------------------- |
| `tests/unit/`        | 163   | no                  |
| `tests/integration/` | 48    | yes — a real portal |

The split is not arbitrary. Unit tests cover what is decidable without HubSpot:
backoff arithmetic, error classification, payload validation, pagination,
redaction, and the Section 1 fundamentals. Integration tests cover what can only
be learned by asking — and asking is how this project discovered that HubSpot's
delete never returns 404, and that its Search API lags a write by seven seconds.

**On mocks.** The brief says _"Mocks or simulations for HubSpot calls are not
allowed"_. Every HubSpot call in the deliverable is real, and the integration
suite proves it against a live portal. Unit tests exercise pure functions
against fabricated _inputs_ — retry arithmetic against a synthetic 429, for
instance — which is a different thing: running that against a live portal would
prove nothing and cost rate-limit budget to learn it.

`npm run verify:requirements` sits alongside both. It loads every module the
brief names and inspects the export, so requirement coverage is an executable
claim rather than a paragraph.

So do the architectural invariants. Every claim this document makes about the
structure — paths built in one place, dependencies running downward, one module
touching the token — is asserted in `tests/unit/architecture.test.js`. Claims
like those decay quietly otherwise: nothing fails when someone inlines a path in
a repository, and the document becomes wrong without anyone noticing.
