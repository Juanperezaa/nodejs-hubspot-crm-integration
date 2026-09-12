# NodeJS — HubSpot CRM Integration

A modular Node.js integration with the HubSpot CRM API, covering Contacts,
Deals, Associations, Pipelines and Properties.

Every HubSpot call in this project is a **real HTTP call against a live
portal**. Nothing is mocked or simulated.

> **Status:** under active development. See [`docs/PLAN.md`](docs/PLAN.md) for
> the delivery plan and [`docs/PROGRESS.md`](docs/PROGRESS.md) for what has
> landed so far.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env

# 3. Put your HubSpot Private App access token in .env
#    HUBSPOT_ACCESS_TOKEN=pat-na1-...

# 4. Confirm the portal is reachable and report granted scopes,
#    pipeline ids and stage ids
npm run probe

# 5. Run the full secret-free verification suite
npm run validate
```

---

## Documentation

| Document                                                     | What it covers                                           |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| [`docs/CONTEXT.md`](docs/CONTEXT.md)                         | How a request flows through the system, end to end       |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)               | The layered structure and why it is shaped this way      |
| [`docs/HUBSPOT_SETUP.md`](docs/HUBSPOT_SETUP.md)             | Creating the private app, required scopes, portal id     |
| [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md)             | Every endpoint used, with its official documentation URL |
| [`docs/ERROR_HANDLING.md`](docs/ERROR_HANDLING.md)           | Error taxonomy, retry policy, backoff maths              |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)                     | Technical decisions and the reasoning behind each        |
| [`docs/REQUIREMENTS_MATRIX.md`](docs/REQUIREMENTS_MATRIX.md) | Requirement → implementation → test traceability         |
| [`docs/PLAN.md`](docs/PLAN.md)                               | Delivery plan (living)                                   |
| [`docs/PROGRESS.md`](docs/PROGRESS.md)                       | Execution log (living)                                   |

---

## Available scripts

| Script                           | Purpose                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `npm run lint`                   | ESLint across the project                                                    |
| `npm run format:check`           | Verify Prettier formatting                                                   |
| `npm test`                       | Unit tests — pure logic, no network                                          |
| `npm run verify:requirements`    | Assert every artefact named by the brief exists and is exported              |
| `npm run validate`               | `lint` + `test` + `verify:requirements`                                      |
| `npm run probe`                  | Live portal check: identity, scopes, properties, pipelines                   |
| `npm run test:integration`       | Real end-to-end run against the portal (requires `HUBSPOT_ALLOW_WRITE=true`) |
| `npm run fundamentals:callbacks` | Section 1.1 — callback-based asynchrony                                      |
| `npm run fundamentals:async`     | Section 1.2 — Promises and async/await                                       |
| `npm run fundamentals:modules`   | Section 1.3 — CommonJS modules                                               |
| `npm run fundamentals:streams`   | Section 1.4 — streams                                                        |

---

## Requirements

- Node.js **18.17 or newer** (developed on 22.x)
- A HubSpot account with a Private App and an access token

---

## License

[MIT](LICENSE)
