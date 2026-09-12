# HubSpot Setup

Everything needed to point this project at a HubSpot portal: which account to
use, which credential, which scopes, and how to verify all three.

The brief requires the submission to state the portal id, the endpoints used
and how the private app was configured. Those are recorded here and in
[`API_REFERENCE.md`](./API_REFERENCE.md).

---

## 1. Which account

The brief is specific:

> "you must use **your own** HubSpot portal (developer account / private app)
> and real credentials"

**Use a developer test account.** They are free, you are Super Admin in them,
and they include a 90-day trial of Enterprise features — which matters, because
scope availability depends on both your permissions and the account's
subscription.

Two practical reasons beyond compliance with the brief:

1. **Scope availability.** A private app can only be granted scopes the user
   creating it already holds. In a shared company portal where your seat lacks
   CRM permissions, `crm.objects.contacts.read` and its siblings appear in the
   list but are greyed out and cannot be selected. In your own test account you
   are Super Admin and every scope is available.
2. **Blast radius.** This project creates, updates and **deletes** real
   contacts and deals. Doing that in a shared sandbox that colleagues use for
   their own testing pollutes their environment. In your own account the
   integration suite can run as often as needed.

### Creating one

1. Sign up at <https://developers.hubspot.com/> for a developer account (free).
2. In that account, go to **Development → Testing → Test Accounts**.
3. Click **Create developer test account**, name it, and create.

Up to ten test accounts are allowed per developer account. A test account is
entirely separate from any production portal — nothing in it can affect real
data.

> **If you must use an existing shared portal** and your user lacks CRM
> permissions, you have two options: ask a Super Admin to grant your user
> CRM access (Settings → Users & Teams → your user → CRM → Contacts and Deals
> → View/Edit all), or reuse the token of a private app someone with
> permissions already created. `npm run probe` reports exactly which scopes any
> given token carries, so either path can be confirmed in one command.

---

## 2. Which credential

HubSpot offers several. Only one fits this brief.

| Credential                             | What it is                                       | Use here                                             |
| -------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| **Private app access token** (`pat-…`) | Static bearer token scoped to one account        | **Yes** — this is what the brief names               |
| Client secret (a bare UUID)            | Validates inbound **webhook signatures**         | No — it cannot authenticate a REST call              |
| API key (`hapikey`)                    | The legacy credential                            | No — discontinued by HubSpot                         |
| OAuth 2.0                              | For public apps installable by many customers    | No — unnecessary for a single account                |
| Service key                            | HubSpot's newer credential for data integrations | Works technically, but the brief names a private app |

### The Client Secret is not the access token

These sit next to each other on the same screen and are easy to confuse. They
are not interchangeable:

```
Auth tab
├── Access token    pat-na1-xxxxxxxx-…    ← this one. Hidden until you click "Show token"
└── Client secret   8faf6678-4fbc-…       ← webhook signature validation only
```

Supplying the client secret produces a `401`, which reads identically to a
missing scope and sends you looking in the wrong place. `src/config/env.js`
detects this case by shape and says so explicitly rather than letting the
request fail remotely.

### Obtaining it

1. **Development → Legacy Apps** (or Settings → Integrations → Private Apps).
2. Open your app, or click **Create legacy app → Private**.
3. On the **Scopes** tab, select the scopes in §3.
4. On the **Auth** tab, click **Show token**, then **Copy**.
5. Paste it into `.env` as `HUBSPOT_ACCESS_TOKEN`. Never commit that file.

Scope changes take effect immediately; the token does not need regenerating.

---

## 3. Required scopes

```
crm.objects.contacts.read
crm.objects.contacts.write
crm.objects.deals.read
crm.objects.deals.write
crm.schemas.deals.read
crm.schemas.contacts.read
```

| Scope                        | Required by                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `crm.objects.contacts.read`  | `getHubSpotContactNames`, `getHubSpotContacts`                                                    |
| `crm.objects.contacts.write` | `createHubSpotContact`, `updateHubSpotContact`, `deleteHubSpotContact`, `syncContactsWithHubSpot` |
| `crm.objects.deals.read`     | `getHubSpotDeals`                                                                                 |
| `crm.objects.deals.write`    | `createHubSpotDeal`, `updateHubSpotDeal`, `deleteHubSpotDeal`, `syncDealsWithHubSpot`             |
| `crm.schemas.deals.read`     | `pipelineRepository`, `propertyRepository` — required by the brief's mandatory endpoint list      |
| `crm.schemas.contacts.read`  | Contact property inspection                                                                       |

### Associations need no scope of their own

The v4 association endpoints are authorised by the **object scopes of both
objects involved**. `crm.objects.contacts.write` together with
`crm.objects.deals.write` is what permits `associateContactToDeal`; there is no
separate association scope to add.

This is asserted against the live portal rather than taken on trust: if an
association call returns `403`, `handleHubSpotErrors` surfaces HubSpot's own
message naming the missing scope.

### If a scope is greyed out

It exists but you cannot grant it. Three possible causes, in order of
likelihood:

1. **Your user lacks that permission.** A private app cannot be granted more
   access than its creator has.
2. **You are not a Super Admin,** and the scope requires it.
3. **The account's subscription does not include the tool** the scope covers.

The fix for all three is §1: use a developer test account where you are Super
Admin.

---

## 4. Verifying the setup

```bash
npm run probe
```

One command, four answers:

1. **Identity** — hub id, app id, hub domain, confirming the token belongs to
   the portal you think it does.
2. **Scopes** — every scope actually granted, checked against the list in §3,
   with the missing ones named.
3. **Deal property names** — which of `pipeline`, `dealstage`, `hs_pipeline`
   and `hs_stage` exist in this portal. See §5.
4. **Pipelines and stages** — the real ids, printed in `.env` form ready to
   paste.

Each step reports its own failure and continues, so a missing scope does not
hide the pipeline ids the next step would have printed.

---

## 5. The deal property discrepancy

The brief asks for deals to be created with `properties.dealname`,
`properties.amount`, `hs_pipeline` and `hs_stage`.

**The last two are Ticket properties.** The Ticket object uses `hs_pipeline`
and `hs_pipeline_stage`. The Deal object uses `pipeline` and `dealstage`, as the
[official Deals guide](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/deals/guide)
shows in its create example:

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

Sending the brief's spelling verbatim returns `400 PROPERTY_DOESNT_EXIST`.

**How this project handles it.** `validateHubSpotPayload` accepts both
spellings and normalises the brief's names to the real ones before the request
is sent. The literal requirement is satisfied at the public boundary and
HubSpot receives a payload it accepts. Step 3 of `npm run probe` confirms the
mapping against your portal's own Properties endpoint rather than asserting it
from documentation alone.

Recorded as decision **D5** in [`DECISIONS.md`](./DECISIONS.md).

---

## 6. Pipeline and stage ids

`HUBSPOT_PIPELINE_ID` and `HUBSPOT_STAGE_ID` take **internal ids**, not display
labels. Most portals ship a pipeline whose id is literally `default`, with
stages such as `appointmentscheduled` and `closedwon`, but neither is
guaranteed — a portal with customised stages will have different ids.

`npm run probe` prints them in the form to paste:

```
pipeline "Sales Pipeline"
  HUBSPOT_PIPELINE_ID=default
    stage "Appointment Scheduled" -> HUBSPOT_STAGE_ID=appointmentscheduled
    stage "Qualified To Buy"      -> HUBSPOT_STAGE_ID=qualifiedtobuy
```

They can also be read directly:

```
GET /crm/v3/pipelines/deals
```

---

## 7. Rate limits

| Tier           | Per 10 seconds | Per day             |
| -------------- | -------------- | ------------------- |
| Free / Starter | 100 per app    | 250,000 per account |
| Professional   | 190 per app    | 625,000             |
| Enterprise     | 190 per app    | 1,000,000           |

The burst limit is per app; the daily limit is shared across every app in the
account. Every response carries `X-HubSpot-RateLimit-Remaining` and its
siblings, which `hubSpotClient` records and warns on when the remaining budget
falls to five or fewer.

**The Search API is limited separately:** 5 requests per second, 200 records per
page, and a hard cap of 10,000 total results per query. This is why
`syncContactsWithHubSpot` reconciles with `batch/upsert` on `email` rather than
searching for each record — the search-based approach is the one that breaks
first at any realistic volume.

See [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) for the retry policy.

---

## 8. Official references

| Topic                       | URL                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| Authentication overview     | <https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/overview> |
| Legacy private apps         | <https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview>                     |
| Scopes                      | <https://developers.hubspot.com/docs/apps/legacy-apps/authentication/scopes>                     |
| Account types               | <https://developers.hubspot.com/docs/getting-started/account-types>                              |
| Contacts API                | <https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide>            |
| Deals API                   | <https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/deals/guide>               |
| Associations API            | <https://developers.hubspot.com/docs/api-reference/crm-associations-v4/guide>                    |
| Pipelines API               | <https://developers.hubspot.com/docs/api-reference/crm-pipelines-v3/guide>                       |
| Usage guidelines and limits | <https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines>                |
