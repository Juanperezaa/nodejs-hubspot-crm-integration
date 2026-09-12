# API Reference

Every HubSpot endpoint this project calls, with the scope that authorises it
and a link to the official documentation.

The brief requires the submission to list "endpoints used (official docs URLs)".
This is that list. It is also machine-checkable: the same catalogue exists as
data in [`src/config/scopes.js`](../src/config/scopes.js), `npm run probe`
checks a live token against it, and `tests/unit/scopes.test.js` fails the build
if the two drift apart.

---

## How to read the scope column

HubSpot's reference pages state scope requirements as
**"requires one of the following scopes"**. So a listed scope is _sufficient_,
not jointly _necessary_: holding any one of the alternatives authorises the
call.

That is why `crm.objects.deals.read` appears as an alternative on the
Properties and Pipelines endpoints. It is also why this project requests six
scopes where four would do — see [§ Scope sufficiency](#scope-sufficiency).

---

## Contacts

Base guide:
<https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide>

| Operation       | Method and path                               | Authorised by                | Used by                                        |
| --------------- | --------------------------------------------- | ---------------------------- | ---------------------------------------------- |
| List contacts   | `GET /crm/v3/objects/contacts`                | `crm.objects.contacts.read`  | `getHubSpotContactNames`, `getHubSpotContacts` |
| Create contact  | `POST /crm/v3/objects/contacts`               | `crm.objects.contacts.write` | `createHubSpotContact`                         |
| Update contact  | `PATCH /crm/v3/objects/contacts/{contactId}`  | `crm.objects.contacts.write` | `updateHubSpotContact`                         |
| Delete contact  | `DELETE /crm/v3/objects/contacts/{contactId}` | `crm.objects.contacts.write` | `deleteHubSpotContact`                         |
| Upsert by email | `POST /crm/v3/objects/contacts/batch/upsert`  | `crm.objects.contacts.write` | `syncContactsWithHubSpot`                      |
| Search contacts | `POST /crm/v3/objects/contacts/search`        | `crm.objects.contacts.read`  | `syncDealsWithHubSpot`                         |

**Pagination.** Cursor-based. Send `?limit=100` (100 is the maximum HubSpot
accepts on CRM list endpoints) and pass `paging.next.after` from each response
as the next request's `after`. The **absence** of `paging.next.after` is the
only end-of-results signal. Implemented in
[`src/utils/paginate.js`](../src/utils/paginate.js).

**Why upsert rather than search-then-write.** `email` is a natively unique
contact property on every HubSpot tier, so `batch/upsert` with
`idProperty: "email"` is genuinely idempotent in one call per batch of 100. The
search-based alternative would hit the Search API's separate limit of 5
requests per second — an order of magnitude tighter than the standard
100–190 per 10 seconds — and would be the first thing to break at volume.

---

## Deals

Base guide:
<https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/deals/guide>

| Operation    | Method and path                         | Authorised by             | Used by                |
| ------------ | --------------------------------------- | ------------------------- | ---------------------- |
| List deals   | `GET /crm/v3/objects/deals`             | `crm.objects.deals.read`  | `getHubSpotDeals`      |
| Create deal  | `POST /crm/v3/objects/deals`            | `crm.objects.deals.write` | `createHubSpotDeal`    |
| Update deal  | `PATCH /crm/v3/objects/deals/{dealId}`  | `crm.objects.deals.write` | `updateHubSpotDeal`    |
| Delete deal  | `DELETE /crm/v3/objects/deals/{dealId}` | `crm.objects.deals.write` | `deleteHubSpotDeal`    |
| Search deals | `POST /crm/v3/objects/deals/search`     | `crm.objects.deals.read`  | `syncDealsWithHubSpot` |

### Property names

The brief specifies `properties.dealname`, `properties.amount`, `hs_pipeline`
and `hs_stage`. **The last two are Ticket properties.** The Deal object uses
`pipeline` and `dealstage`:

```json
{
  "properties": {
    "dealname": "New deal",
    "amount": "1500.00",
    "pipeline": "default",
    "dealstage": "contractsent"
  }
}
```

Sending the brief's spelling returns `400 PROPERTY_DOESNT_EXIST`.
`validateHubSpotPayload` accepts both and translates. Decision **D5**.

### Idempotent deal synchronisation

Deals have no naturally unique property, so `syncDealsWithHubSpot` correlates
on `dealname` through the Search API.

The alternative — creating a custom correlation property and upserting on it —
would require `crm.schemas.deals.write`, a seventh scope, and would leave a
custom property behind in the operator's portal. Correlating on an existing
property avoids both. Recorded in `DELIBERATELY_OMITTED_SCOPES`.

---

## Associations

Base guide:
<https://developers.hubspot.com/docs/api-reference/crm-associations-v4/guide>

| Operation                    | Method and path                                                                | Authorised by                                                 | Used by                  |
| ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------ |
| Associate contact with deal  | `PUT /crm/v4/objects/contacts/{contactId}/associations/default/deals/{dealId}` | `crm.objects.contacts.write` **or** `crm.objects.deals.write` | `associateContactToDeal` |
| Read a record's associations | `GET /crm/v4/objects/contacts/{contactId}/associations/deals`                  | `crm.objects.contacts.read` **or** `crm.objects.deals.read`   | `associateContactToDeal` |

**There is no dedicated association scope.** The v4 endpoints are authorised by
the object scopes of the objects involved. This is asserted by
`tests/unit/scopes.test.js`, which fails if any association entry ever lists a
scope containing `association`.

**Association type ids** (HubSpot-defined):

| From → to      | Type id |
| -------------- | ------- |
| Contact → Deal | `4`     |
| Deal → Contact | `3`     |

**Idempotency.** The default-association endpoint is a `PUT`, so repeating it is
idempotent by HTTP semantics. `associateContactToDeal` additionally reads
existing associations first, so a no-op is reported as such rather than
disguised as a write.

---

## Pipelines

Base guide: <https://developers.hubspot.com/docs/api-reference/crm-pipelines-v3/guide>

| Operation           | Method and path                            | Authorised by                                            | Used by                               |
| ------------------- | ------------------------------------------ | -------------------------------------------------------- | ------------------------------------- |
| List deal pipelines | `GET /crm/v3/pipelines/deals`              | `crm.objects.deals.read` **or** `crm.schemas.deals.read` | `pipelineRepository`, `npm run probe` |
| Read one pipeline   | `GET /crm/v3/pipelines/deals/{pipelineId}` | same                                                     | `pipelineRepository`                  |

`HUBSPOT_PIPELINE_ID` and `HUBSPOT_STAGE_ID` take **internal ids**, not display
labels. `npm run probe` prints every pipeline and stage in `.env` form.

Required by the brief's mandatory endpoint list.

---

## Properties

Base guide: <https://developers.hubspot.com/docs/api-reference/crm-properties-v3/guide>

| Operation               | Method and path                   | Authorised by                                                  | Used by                               |
| ----------------------- | --------------------------------- | -------------------------------------------------------------- | ------------------------------------- |
| Read deal properties    | `GET /crm/v3/properties/deals`    | `crm.schemas.deals.read` **or** `crm.objects.deals.read`       | `propertyRepository`, `npm run probe` |
| Read contact properties | `GET /crm/v3/properties/contacts` | `crm.schemas.contacts.read` **or** `crm.objects.contacts.read` | `propertyRepository`                  |

Required by the brief's mandatory endpoint list, and load-bearing here: step 2
of `npm run probe` reads the deal properties to settle the `hs_pipeline` versus
`pipeline` question against the portal itself rather than against
documentation alone.

---

## Authentication

| Operation                        | Method and path                                     | Authorised by | Used by         |
| -------------------------------- | --------------------------------------------------- | ------------- | --------------- |
| Introspect the private app token | `POST /oauth/v2/private-apps/get/access-token-info` | **no scope**  | `npm run probe` |

Body: `{"tokenKey": "<the token>"}`. Returns hub id, app id and the full granted
scope list, which is what lets the probe report scope coverage from the live
portal rather than from a hand-maintained list.

It needs no scope because it authenticates with the very token it reports on.

> The more prominently documented `GET /oauth/v1/access-tokens/{token}` accepts
> **OAuth** tokens only and returns `400` for a private app token.
>
> Tokens beginning `pat-eu` additionally require an `Authorization` header
> alongside the body.

---

## Scope sufficiency

The six scopes in [`HUBSPOT_SETUP.md`](./HUBSPOT_SETUP.md) cover all seventeen
catalogued endpoints. So do **four** of them:

| Token holds                          | Endpoints permitted          |
| ------------------------------------ | ---------------------------- |
| All six requested scopes             | 17 / 17                      |
| The four `crm.objects.*` scopes only | **17 / 17**                  |
| Read scopes only                     | 9 / 17                       |
| No scopes                            | 1 / 17 — introspection alone |

The two `crm.schemas.*.read` scopes are therefore redundant, because the
Properties and Pipelines endpoints each accept an object read scope as an
alternative. They are requested anyway: they cost nothing, HubSpot lists them
first for those endpoints, and trading a real failure risk for minimal-privilege
purism is a bad exchange under a deadline.

That table is not an assertion. It is produced by `auditScopeCoverage` and
verified by `tests/unit/scopes.test.js`.

---

## API versioning

HubSpot has moved to date-based versioning (`/crm/objects/2026-09/…`).

| Surface      | Version used here | Status                                                              |
| ------------ | ----------------- | ------------------------------------------------------------------- |
| CRM objects  | `v3`              | Supported, no announced end of life. Named explicitly by the brief. |
| Associations | `v4`              | Supported until **March 2027**, when `/2027-03/` ships.             |

Both versions are constants in
[`src/config/hubspot.config.js`](../src/config/hubspot.config.js) and
overridable by environment variable. Every path in this document is built by a
function in that file, so the March 2027 migration changes one module rather
than every repository. Decision **D6**.

---

## Rate limits

| Tier           | Per 10 seconds | Per day             |
| -------------- | -------------- | ------------------- |
| Free / Starter | 100 per app    | 250,000 per account |
| Professional   | 190 per app    | 625,000             |
| Enterprise     | 190 per app    | 1,000,000           |

The burst limit is per app; the daily limit is shared across every app in the
account.

**The Search API is limited separately:** 5 requests per second, 200 records per
page, 10,000 results per query maximum.

Every response carries `X-HubSpot-RateLimit-Max`, `-Remaining`,
`-Interval-Milliseconds`, `-Daily` and `-Daily-Remaining`. `hubSpotClient`
records them and warns when the remaining budget falls to five or fewer.
Search responses omit these headers.

A `429` carries `Retry-After` plus `errorType: "RATE_LIMIT"` and
`policyName: "DAILY" | "TEN_SECONDLY_ROLLING"`. Handling is described in
[`ERROR_HANDLING.md`](./ERROR_HANDLING.md).

Source: <https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines>
