# Error Handling

The brief asks for `handleHubSpotErrors` and for documentation of how each
failure class is handled: network errors and timeouts, authentication failures,
validation and other 4xx, rate limits with exponential backoff, and 5xx.

Run `npm run example:errors` to see every class provoked and classified.

---

## The shape of every failure

Whatever goes wrong — HubSpot rejecting a payload, a socket dying, a request
that never left — becomes a **`HubSpotApiError`** with a decided `kind`.

```js
{
  name: 'HubSpotApiError',
  message: "Property \"hs_stage\" does not exist",
  kind: 'VALIDATION',          // the classification a caller acts on
  statusCode: 400,
  method: 'POST',
  path: '/crm/v3/objects/deals',
  category: 'VALIDATION_ERROR', // HubSpot's own field
  correlationId: '…',           // quote this to HubSpot support
  policyName: undefined,        // 429 only: DAILY | TEN_SECONDLY_ROLLING
  retryAfterMs: undefined,      // parsed from the Retry-After header
  validationErrors: [ … ],      // HubSpot's per-field detail
  attempts: 1,
  isRetryable: false,
  guidance: 'Check property internal names against …'
}
```

**Why normalise at all.** A caller needs to make exactly one decision — retry,
fix the configuration, or fix the payload — and should not have to write
`error.response?.status ?? error.code` to make it. Every layer above the client
sees the same shape regardless of where the failure came from.

---

## The classification table

| Condition                             | `kind`           | Retried | Why                                            |
| ------------------------------------- | ---------------- | ------- | ---------------------------------------------- |
| `ECONNRESET`, `EPIPE`, `ENOTFOUND`, … | `NETWORK`        | **yes** | Transient transport fault                      |
| `ECONNABORTED`, `ETIMEDOUT`           | `TIMEOUT`        | **yes** | The request may simply have been slow          |
| **401, 403**                          | `AUTHENTICATION` | **no**  | A bad token or missing scope cannot fix itself |
| **400, 409, 422**                     | `VALIDATION`     | **no**  | An invalid payload is invalid on every attempt |
| **404**                               | `NOT_FOUND`      | **no**  | The record will not appear by asking again     |
| **429**                               | `RATE_LIMIT`     | **yes** | Correct after a wait                           |
| **5xx**                               | `SERVER`         | **yes** | HubSpot failed; it may not next time           |
| anything unrecognised                 | `UNKNOWN`        | **no**  | Fails safe                                     |

**The negative entries are the ones that matter.** Retrying something
unretryable is worse than not retrying at all: it burns rate-limit budget,
delays the real error reaching the caller, and — for a 401 — can look like an
attack. Both are asserted by _invocation count_ in the unit tests, not merely by
the thrown type.

---

## Retry policy

```
attempts      5          HUBSPOT_MAX_RETRY_ATTEMPTS
base delay    500 ms     HUBSPOT_RETRY_BASE_DELAY_MS
growth        × 2 per attempt
ceiling       30 s       HUBSPOT_RETRY_MAX_DELAY_MS
jitter        full
```

**Full jitter**, not a fixed delay, and not exponential-with-small-jitter. The
delay is a uniform random draw between zero and the exponential ceiling:

```
attempt 1   ceiling   500 ms   →  a draw somewhere in [0,   500]
attempt 2   ceiling  1000 ms   →  a draw somewhere in [0,  1000]
attempt 3   ceiling  2000 ms   →  a draw somewhere in [0,  2000]
attempt 4   ceiling  4000 ms   →  a draw somewhere in [0,  4000]
```

This matters for a specific reason. HubSpot's burst limit is a **rolling
ten-second window shared by every caller using the same app**. If ten concurrent
requests are throttled together and all back off by the same amount, they retry
in lockstep and re-trigger the identical limit. Spreading them across the
interval is what actually lets the window drain.

### `Retry-After` always wins

HubSpot knows when the window clears; the local calculation is guessing. When
the header is present it is used verbatim — **but still capped**, because a
misconfigured proxy returning `Retry-After: 86400` must not park the process for
a day.

The header is defined as either a count of seconds or an HTTP date. Both are
parsed; an unparseable value yields `undefined` rather than `NaN`, since `NaN`
would silently disable the very wait the header exists to request.

---

## Rate limits

| Tier           | Per 10 seconds | Per day             |
| -------------- | -------------- | ------------------- |
| Free / Starter | 100 per app    | 250,000 per account |
| Professional   | 190 per app    | 625,000             |
| Enterprise     | 190 per app    | 1,000,000           |

**There is also a per-second limit HubSpot does not publish.** Measured against
a live portal, responses carry:

```
x-hubspot-ratelimit-secondly: 10
x-hubspot-ratelimit-secondly-remaining: 9
```

That ceiling **binds first under concurrency** — ten parallel requests exhaust
it while the ten-second window still shows ninety remaining. It is why batch
operations in this project run sequentially rather than through `Promise.all`.

`hubSpotClient` records every rate-limit header and warns when the remaining
budget falls to five or fewer, so a 429 is diagnosable in hindsight rather than
surprising.

**The Search API is limited separately:** 5 requests per second, 200 records per
page, 10,000 results per query. This is why neither synchronisation uses it.

Throttling is deliberately **not** applied pre-emptively. The limit is shared
across every process using the same app, so a local counter would be wrong.

---

## Validation happens twice, on purpose

`validateHubSpotPayload` rejects locally what HubSpot would reject remotely.
That is not redundant — it is cheaper and clearer:

- **A round trip saved** costs no rate-limit budget.
- **A better message.** HubSpot's rejection for an unknown deal stage names the
  _property_, so `dealstage` looks wrong when the real mistake was supplying
  `"Closed Won"` instead of `closedwon`. The local check names the value and
  lists the ones that would work.

Local validation failures reuse `HubSpotApiError` with kind `VALIDATION` rather
than a separate type, so a caller's `catch` handles a locally-detected bad
payload and a remotely-rejected one identically. Neither is retryable and both
are fixed in the same place.

---

## Retrying a write that may already have been applied

A network failure is retried **even though the request may have succeeded**
before the connection died. That is a deliberate trade, and it is only safe
because every write here is either idempotent by construction or reconciled by
a preceding read:

| Operation                       | Why a retry is safe                                    |
| ------------------------------- | ------------------------------------------------------ |
| `associateContactToDeal`        | `PUT` — idempotent by HTTP semantics                   |
| `syncContactsWithHubSpot`       | `batch/upsert` keyed on `email`                        |
| `syncDealsWithHubSpot`          | correlates against a freshly read index                |
| `deleteHubSpotContact` / `Deal` | HubSpot accepts a repeated delete                      |
| `createHubSpotContact`          | a duplicate email is rejected with 409, not duplicated |

The one operation with no such protection is `createHubSpotDeal` called
directly: deals have no unique constraint, so a retry after an unknown outcome
could produce two. `syncDealsWithHubSpot` exists partly to give callers a path
that does not have this property.

---

## Secrets never reach a log

The highest-consequence defect in this project is not a broken function — it is
a credential in a log. An axios error carries the full request configuration,
**headers included**, so `console.error(error)` prints the bearer token.

Redaction is therefore **structural**, applied at the logger boundary to every
value on its way out. There is no path around it.

It masks:

- **By key name** — `authorization`, `token`, `tokenKey`, `clientSecret`,
  `hapikey`, `apiKey`, `password`, `secret`, matched case-insensitively.
- **By text pattern** — `pat-…` tokens, `Bearer …`, `hapikey=…` in a query
  string, and bare UUIDs.

Cycles are tracked, because an axios error's `config` points at the request
whose `response` points back at the error.

Non-secret diagnostic content survives: paths, status codes, correlation ids and
record ids are all preserved, because an unreadable log is its own failure mode.

---

## Configuration faults are a separate type

`InvalidConfigurationError` is distinct from `HubSpotApiError` because the two
demand different responses. A configuration fault is the operator's to fix and
retrying can never help; conflating them produces retry loops around problems
that cannot resolve themselves.

Each carries the offending variable and concrete guidance, so the message alone
is enough to act on:

```
InvalidConfigurationError: HUBSPOT_ACCESS_TOKEN looks like the private app
Client Secret, not its access token.

  How to fix: The Client Secret is a bare UUID used only to validate inbound
  webhook signatures and cannot authenticate REST calls. The access token
  begins with "pat-" and is found in the same Auth tab under "Access token" —
  click "Show token", then "Copy".
```

That specific check exists because the mistake cost this project a cycle. The
symptom is a `401`, which is indistinguishable from a missing scope and sends
the reader to look at the wrong thing entirely.

---

## Where the code is

| Concern                            | File                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Error type and classification      | `src/errors/HubSpotApiError.js`                                              |
| Normalisation, retry loop, backoff | `src/utils/handleHubSpotErrors.js`                                           |
| Payload validation                 | `src/utils/validateHubSpotPayload.js`                                        |
| Redaction                          | `src/utils/redactSecrets.js`                                                 |
| Logger boundary                    | `src/utils/logger.js`                                                        |
| Configuration faults               | `src/errors/InvalidConfigurationError.js`                                    |
| Rate-limit observation             | `src/clients/hubSpotClient.js`                                               |
| Tests                              | `tests/unit/handleHubSpotErrors.test.js`, `tests/unit/redactSecrets.test.js` |
| Live demonstration                 | `src/examples/error-handling.js`                                             |
