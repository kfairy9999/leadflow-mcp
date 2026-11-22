# LeadFlow MCP

An MCP server that lets an AI assistant run the front desk for a one-shop service business: capture a lead, score it with a published rubric, chase the follow-up, and read the pipeline.

Built for Claude Desktop, Cursor, and any other Model Context Protocol client. SQLite on disk. No paid API, no account, no network call on the tool path.

[![CI](https://github.com/kfairy9999/leadflow-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/kfairy9999/leadflow-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13-339933)](https://nodejs.org/)
[![MCP SDK 2.4](https://img.shields.io/badge/MCP%20SDK-2.4.0-111111)](https://github.com/modelcontextprotocol/typescript-sdk)
[![Tests](https://img.shields.io/badge/tests-117%20passing-2ea44f)](#testing)
[![Line coverage](https://img.shields.io/badge/lines-99.62%25-2ea44f)](#testing)
[![Branch coverage](https://img.shields.io/badge/branches-96.53%25-2ea44f)](#testing)
[![Mutation score](https://img.shields.io/badge/mutation-82.07%25-2ea44f)](#testing)
[![M8ven Score](https://m8ven.ai/badge/mcp/kfairy9999/leadflow-mcp)](https://m8ven.ai/mcp/kfairy9999/leadflow-mcp?s=readme)

This is a portfolio project. The seed data is fictional, and the README does not claim users or production traffic. The numbers below are from a local run on Node v22.23.4.

**Live demo:** [`https://leadflow-mcp.kfairley9999.workers.dev`](https://leadflow-mcp.kfairley9999.workers.dev) is a recorded walk through the fictional Northglass Plumbing pipeline: the morning brief, due follow-ups, and two published scores. [`/api`](https://leadflow-mcp.kfairley9999.workers.dev/api) and [`/health`](https://leadflow-mcp.kfairley9999.workers.dev/health) are public JSON and return no lead data. `/mcp` requires a bearer token. See [Live deployment](#live-deployment).

![LeadFlow recorded playground](docs/media/playground.png)

## Demo

`npm run demo` opens an in-process MCP client against a seeded database with the clock pinned to `2026-11-18T15:00:00.000Z`. The transcript below is that session. The only edit is the generated lead id, which is a random 16 hex characters and is written as `lead_<generated>` so the file stays stable. `test/demo.test.ts` fails if a later run disagrees.

```text
LeadFlow MCP  ·  Northglass Plumbing, Harborton (fictional)
clock 2026-11-18T15:00:00.000Z  ·  in-process MCP client, seeded SQLite

$ tools/list
create_lead  update_lead  get_lead  search_leads  score_lead  log_interaction  schedule_follow_up  set_follow_up_status  list_due_follow_ups  pipeline_summary  export_leads_csv

$ pipeline_summary {}
Pipeline as of 2026-11-18T15:00:00.000Z
Open: 8 · Won: 1 · Lost: 1 · Win rate: 1/2 (50.0%)
Open value: $21,050.00
Stages: new 2, contacted 2, qualified 1, proposal 3, won 1, lost 1
Stale (>7d): 2
- lead_samira_adeyemi · Samira Adeyemi · contacted · Water heater flush · 18d quiet
- lead_rowan_blake · Rowan Blake · qualified · Outdoor faucet winterize · 8d quiet

$ list_due_follow_ups {}
3 follow-ups due as of 2026-11-18T15:00:00.000Z
- fu_priya_nandakumar · Priya Nandakumar · lead_priya_nandakumar · due 2026-11-17T13:00:00.000Z · Main line is still unanswered.
- fu_marina_cho · Marina Cho · lead_marina_cho · due 2026-11-18T13:00:00.000Z · Confirm the tankless install window.
- fu_luis_ortega · Luis Ortega · lead_luis_ortega · due 2026-11-18T14:30:00.000Z · Call back about the no-hot-water emergency.

$ score_lead {"leadId":"lead_marina_cho"}
lead_marina_cho · Marina Cho · proposal · 100/100 hot · $4,800.00 · Tankless water heater install
Hot follow-up priority, 100/100. Strongest signal: Referral is the strongest source in this rubric.
+22 source — Referral is the strongest source in this rubric.
+10 phone — A phone number is on file.
+8 email — An email address is on file.
+20 urgency — Urgency is high.
+12 value — Estimated value is $1,500 to $4,999.99.
+16 stage — Stage is proposal. Closest open stage to a decision.
+16 recency — Last activity was under 2 days ago.
-4 cap — The raw total exceeded 100, so the published ceiling was applied.
= 100

$ score_lead {"leadId":"lead_samira_adeyemi"}
lead_samira_adeyemi · Samira Adeyemi · contacted · 27/100 cool · $220.00 · Water heater flush
Cool follow-up priority, 27/100. Strongest signal: Website lead. Ahead of a cold inquiry, behind a referral.
+14 source — Website lead. Ahead of a cold inquiry, behind a referral.
+8 email — An email address is on file.
+6 urgency — Urgency is normal.
+4 value — Estimated value is under $400.
+7 stage — Stage is contacted. A conversation has started.
-12 recency — No activity for 18 days. Open leads go quiet after 14 days.
= 27
```

The rest of the session creates a lead twice with the same idempotency key. The second call returns `Replay: yes, existing lead returned` and the same id. Full text: [`docs/demo-transcript.txt`](docs/demo-transcript.txt).

## Quickstart

Node.js **22.13 or newer**. `node:sqlite` ships in that runtime. Node 20 cannot run this project.

```bash
git clone https://github.com/kfairy9999/leadflow-mcp.git
cd leadflow-mcp
npm install
npm test
npm run build
npm run demo
```

Talk to it from MCP Inspector (stdio, the path the integration test also drives):

```bash
npx @modelcontextprotocol/inspector -- node dist/bin/stdio.js
```

Inspector opens a browser. Choose **Connect**, then **Tools**, then `pipeline_summary`, and run it with empty arguments. The seed loads itself the first time the database file is empty.

A loopback HTTP server is the same process with a different entry:

```bash
npm run dev:http
# listens on http://127.0.0.1:8787/mcp
# health:  curl -s http://127.0.0.1:8787/health
```

## Architecture

```mermaid
flowchart LR
  subgraph hosts [MCP hosts]
    Claude[Claude Desktop]
    Cursor[Cursor]
    Inspector[MCP Inspector]
  end

  subgraph transports [Transports]
    Stdio[stdio]
    HTTP["Streamable HTTP\n127.0.0.1:8787"]
    Worker["Workers fetch\nbearer required"]
  end

  Server["McpServer\n11 tools · 3 resources · 2 prompts"]
  Domain["Domain\nscore · pipeline · CSV"]
  Repo[LeadRepository]
  Sqlite["node:sqlite\nfile or :memory:"]
  D1[Cloudflare D1]

  Claude --> Stdio
  Cursor --> Stdio
  Inspector --> Stdio
  Cursor --> HTTP
  hosts --> Worker
  Stdio --> Server
  HTTP --> Server
  Worker --> Server
  Server --> Domain --> Repo
  Repo --> Sqlite
  Repo --> D1
```

The host owns the model. LeadFlow owns the books. A tool call is validated by Zod before the handler runs, the handler talks only to `LeadRepository`, and the repository talks to a small SQL interface. `node:sqlite` implements that interface for the laptop. The D1 adapter implements it for the Worker. The scoring function is pure: same lead, same clock, same score, and the factors sum to the number you see.

## Tools

Money is integer cents. `480000` is $4,800.00. Scores are computed on read, so a rubric change applies to old leads without a migration.

| Tool                   | What it does                                                                                                                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_lead`          | Insert a lead. Optional `idempotencyKey`. A retry with the same key and payload returns the original lead. A different payload with that key is a conflict.                                                                                                                                                     |
| `update_lead`          | Patch one lead. `null` clears phone, email, city, or notes. `expectedUpdatedAt` rejects a write if someone else saved first.                                                                                                                                                                                    |
| `get_lead`             | One lead, its score, interactions, and follow-ups.                                                                                                                                                                                                                                                              |
| `search_leads`         | ASCII case-insensitive match on name, service, city, email, phone, and notes. Ranked inside the 500 most recently updated matches. `truncated: true` when the scan hits that cap.                                                                                                                               |
| `score_lead`           | The published rubric, factor by factor. Does not persist and does not call a model.                                                                                                                                                                                                                             |
| `log_interaction`      | Call, email, SMS, visit, or note. Optional idempotency key. An omitted `occurredAt` uses the server clock and is left out of the hash, so a retry does not conflict with itself. A supplied time is stored as UTC. `updatedAt` stays on the server clock, so a backdated note does not sink the lead in search. |
| `schedule_follow_up`   | A due time, including a time in the past. Past items show up as due immediately. Offset and `Z` spellings of the same instant are the same due time, including for the idempotency key.                                                                                                                         |
| `set_follow_up_status` | `scheduled`, `done`, or `cancelled`. Done and cancelled leave the due list. Setting the same status again is safe and does not rewrite the lead.                                                                                                                                                                |
| `list_due_follow_ups`  | Scheduled items with `dueAt` at or before the clock. The call list.                                                                                                                                                                                                                                             |
| `pipeline_summary`     | Stage counts, open value, win rate `won / (won + lost)`, and open leads quiet for `staleAfterDays` (default 7). Win rate is null when nothing has closed.                                                                                                                                                       |
| `export_leads_csv`     | CSV, RFC 4180 quoting, and a leading apostrophe when a cell starts with `=`, `+`, `-`, or `@`, including after leading whitespace. Caps at 5,000 rows.                                                                                                                                                          |

Read tools set `readOnlyHint` and `idempotentHint`. Writes set `openWorldHint: false` because the server does not call the network.

Validation failures come back as tool results with `isError: true` and the Zod message, so the model can correct the argument. Missing rows come back as `NOT_FOUND`. Idempotency mismatches come back as `CONFLICT`. An unexpected throw is logged by error name only and returned as `INTERNAL`.

## Resources and prompts

| URI or name                 | Kind              | Body                                                                                 |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------ |
| `leadflow://pipeline`       | resource          | JSON snapshot: stages, win rate, open value, stale leads.                            |
| `leadflow://scoring-model`  | resource          | Markdown rubric. Generated from `SCORE_RULES`, the same object `score_lead` uses.    |
| `leadflow://leads/{leadId}` | resource template | JSON for one lead. The list callback publishes the 100 most recently updated leads.  |
| `daily_follow_up_briefing`  | prompt            | Embeds the live pipeline and the due list. Tells the model to use only those facts.  |
| `draft_follow_up`           | prompt            | One lead, one channel. Tells the model not to invent a price, a discount, or a time. |

## Configuration

| Variable              | Default                  | Meaning                                                                                                                 |
| --------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `LEADFLOW_DB`         | `./data/leadflow.sqlite` | SQLite path, or `:memory:`.                                                                                             |
| `LEADFLOW_SEED`       | `auto`                   | `auto` seeds an empty database. `always` wipes and reseeds (Node only; the Worker ignores it). `never` leaves it empty. |
| `LEADFLOW_LOG_LEVEL`  | `info`                   | `debug`, `info`, `warn`, `error`. JSON lines on stderr.                                                                 |
| `LEADFLOW_HTTP_HOST`  | `127.0.0.1`              | Bind address. Any non-loopback host requires `LEADFLOW_AUTH_TOKEN`.                                                     |
| `LEADFLOW_HTTP_PORT`  | `8787`                   | HTTP port. `0` picks a free port.                                                                                       |
| `LEADFLOW_STALE_DAYS` | `7`                      | Quiet-open-lead window, 1–90.                                                                                           |
| `LEADFLOW_NOW`        | unset                    | Pins the clock. For demos and tests. Leave it unset on a real desk.                                                     |
| `LEADFLOW_AUTH_TOKEN` | unset                    | Bearer token, at least 16 characters. Required off loopback and on the Worker.                                          |

Logs go to stderr. stdout is the stdio protocol and is left alone. The logger redacts emails, phone-shaped strings, bearer tokens, and fields named `email`, `phone`, `notes`, `summary`, `contactName`, and similar. The database file itself holds whatever you typed into a lead. Treat `data/` as private. It is gitignored.

The seed is Northglass Plumbing in the invented town of Harborton. Ten people, `555-0100` phone numbers, `example.com` mailboxes. See `src/db/seed.ts`.

## Claude Desktop and Cursor

Stdio, after `npm run build`. Replace the path.

```json
{
  "mcpServers": {
    "leadflow": {
      "command": "node",
      "args": ["/absolute/path/to/leadflow-mcp/dist/bin/stdio.js"],
      "env": {
        "LEADFLOW_DB": "/absolute/path/to/leadflow-mcp/data/leadflow.sqlite"
      }
    }
  }
}
```

Claude Desktop reads that object from `claude_desktop_config.json`. Cursor reads the same `mcpServers` object from its MCP settings. Restart the host after saving. The first session creates the SQLite file and, because `LEADFLOW_SEED` defaults to `auto`, loads the fictional shop when the file is empty.

For the loopback HTTP server, point the host at `http://127.0.0.1:8787/mcp`. The process refuses to bind a non-loopback address unless `LEADFLOW_AUTH_TOKEN` is set, and `/mcp` then requires `Authorization: Bearer <token>`.

## MCP Inspector

1. `npm run build`
2. `npx @modelcontextprotocol/inspector -- node dist/bin/stdio.js`
3. Connect.
4. **Tools → `list_due_follow_ups` → Run.** Three fictional follow-ups come back when the clock is "now" after the seed's due times. With a fresh database and no `LEADFLOW_NOW`, the seed is stamped at process start, so Marina, Priya, and Luis are already due.
5. **Tools → `score_lead`**, argument `{"leadId":"lead_marina_cho"}`. The factors sum to the score, including the ceiling adjustment.
6. **Resources → `leadflow://scoring-model`.** The point values match the tool.
7. **Prompts → `daily_follow_up_briefing`.** The message contains the pipeline JSON and an instruction not to invent prices.

Inspector launches the command you give it. If Connect fails, the usual cause is a Node older than 22.13, or a `console.log` on stdout. This server logs with the structured logger on stderr.

## Design decisions

**SDK v2.** `@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/client` 2.4.0, and `@modelcontextprotocol/node` 2.1.2. That is the current stable TypeScript SDK line (protocol revision 2026-07-28). The v1 package `@modelcontextprotocol/sdk` still publishes, and it is the one a lot of older posts show. v2 is what `npm install @modelcontextprotocol/server` resolves to, and its `createMcpHandler` / `serveStdio` split is the supported way to share one factory across stdio and HTTP.

**Node 22.13 and `node:sqlite`.** The brief allowed Node 20 or newer. This repo requires 22.13 because that is the release where `node:sqlite` no longer needs a flag. The module is still marked experimental on Node 22 (release candidate on newer lines). The driver silences that one warning. The SQL is tables, indexes, foreign keys, and `?` parameters. A native driver such as `better-sqlite3` would have pulled a C toolchain into `npm install`, which fights the "clone and test" requirement. The repository interface is the exit if the built-in API moves: `DatabaseSync` is called out in `src/db/node-sqlite.ts` because newer Node versions renamed the class and kept the old name as an alias.

**One SQL dialect, two drivers.** Migrations are `IF NOT EXISTS` strings. Wrangler applies `migrations/0001_init.sql`. Node and the Worker apply the same text embedded in `src/db/migrations.ts`. A unit test fails if the file and the string diverge. The runtime migrator splits that script on semicolons and flattens whitespace before `exec`, because D1's `exec` (as Miniflare implements it) ends a statement at a newline and would otherwise reject a formatted `CREATE TABLE`. D1 has no interactive transaction, so the adapter buffers the writes inside `transaction()` and sends one `batch()`. Reads in that callback see committed rows only. Idempotency does not need read-your-writes: the insert of the row and the insert of the key share a batch, the key is a primary key, and a loser of a race catches the unique violation and returns the winner. That race is tested with `Promise.all` on both drivers. The same scenario is also run against a Miniflare D1, with no Cloudflare account.

**Scores are not stored.** A lead's priority is a function of the row, the latest interaction, and the clock. Persisting it would freeze a rubric the day the lead was saved. `minScore` and `sort: score` run in memory over the 500 most recently updated matches, and the tool says `truncated` when that window is full. A shop of this size does not have a warehouse of leads. The cap is there so a runaway import cannot sort the whole table on every keystroke.

**The rubric is the documentation.** `SCORE_RULES` is the only copy of the points. `renderScoringModel()` prints it. Lost leads cap at 15 and won leads cap at 40 so a closed job cannot sit at the top of a chase list. The factor list includes the cap line, and the sum of the factors is the score. Marina Cho at the pinned clock is 104 before the ceiling and **100** after. Samira Adeyemi is **27**. Those two are pinned in tests.

**Cents, not floats.** Currency math stays integer. The CSV column is `estimated_value_cents`.

**Auth matches the bind.** Loopback HTTP checks the `Host` and `Origin` headers with the SDK's localhost guards, which is the DNS-rebinding control the SDK docs ask for. A non-loopback bind without a token is refused at startup. The Worker returns 503 for `/mcp` until `LEADFLOW_AUTH_TOKEN` is at least 16 characters, then requires a bearer token compared in constant time. `GET /` is the recorded HTML playground. Service metadata lives at `GET /api`, and `GET /` still returns that JSON when the client prefers `application/json`. `GET /health` is public JSON. None of those routes return lead data. `LEADFLOW_SEED=always` is ignored on the Worker so a request cannot wipe the database.

**Logging.** Tool success logs the tool name and duration. It does not log the argument object. An integration test creates `demo.replay@example.com` and asserts the log sink does not contain that address.

## Testing

`npm test` is Vitest. On this tree it is **113 tests**. `npm run test:e2e`, after `npm run build`, adds **4** tests that spawn `dist/bin/stdio.js` and `dist/bin/http.js`. The badges count both: **117 passing**. The coverage figures are from `npm run test:coverage` on Node v22.23.4. They do not include the spawned build, which is not instrumented.

| Layer            | What it drives                                                                                                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit             | Scoring boundaries and hand-computed totals, fast-check invariants (0–100, factors sum to the score, monotonic source, urgency, value, open stage, recency, and reachability), pipeline math, CSV quoting and formula neutralization, hashing, redaction, config.                                                           |
| Repository       | The same cases on `node:sqlite` and on a fake D1. Idempotency races, optimistic concurrency, LIKE escaping, timezone instants, the 500 and 5,000 caps, and fault mapping for unique, foreign-key, and I/O errors.                                                                                                           |
| Migration parity | Empty database, a second run that applies nothing, and the same round trip on `node:sqlite` and on Miniflare D1. No Cloudflare credentials.                                                                                                                                                                                 |
| MCP client       | Every tool, including invalid and boundary input, unicode, long strings, missing ids, idempotent retries, follow-up instants, an empty pipeline, and CSV escaping. Snapshots lock `tools/list`, `resources/list`, and `prompts/list`.                                                                                       |
| HTTP             | A real `node:http` listen on port 0. Health, 404, a foreign `Host`, a foreign `Origin`, a bad host header, IPv6 loopback, and bearer rejection (missing, empty, wrong) plus a client that presents the token.                                                                                                               |
| stdio            | A spawned `tsx src/bin/stdio.ts`, and, after the build, a spawned `dist/bin/stdio.js` driven by a real MCP client.                                                                                                                                                                                                          |
| Worker           | The `fetch` entry on the fake D1 and on Miniflare D1. The HTML playground, `/api`, and `/health` are public and return no lead data. `HEAD` works on those routes. `/mcp` is 503 without a long enough token, 401 with the wrong token, and serves the pipeline with the right token. `LEADFLOW_SEED=always` does not wipe. |
| Demo             | `runDemo()` against `docs/demo-transcript.txt`.                                                                                                                                                                                                                                                                             |
| Mutation         | `npm run test:mutate` runs Stryker on `src/domain/**`. It is a separate CI job.                                                                                                                                                                                                                                             |

Coverage from `npm run test:coverage` on this tree, V8, including `src/**` and excluding `src/bin/**`:

|            | Percent | Count     |
| ---------- | ------- | --------- |
| Statements | 99.29%  | 851 / 857 |
| Branches   | 96.88%  | 528 / 545 |
| Functions  | 99.19%  | 245 / 247 |
| Lines      | 99.61%  | 771 / 774 |

Core files, same run:

| File                    | Lines            | Branches           |
| ----------------------- | ---------------- | ------------------ |
| `src/domain/**`         | 100% (185 / 185) | 99.11% (111 / 112) |
| `src/domain/scoring.ts` | 100% (75 / 75)   | 98.52% (67 / 68)   |
| `src/db/repository.ts`  | 100% (149 / 149) | 100% (116 / 116)   |
| `src/mcp/server.ts`     | 100% (133 / 133) | 95.65% (88 / 92)   |
| `src/mcp/format.ts`     | 100% (17 / 17)   | 100% (8 / 8)       |

`vitest.config.ts` fails CI under 98% statements, 95% branches, 98% functions, and 98% lines for the whole tree. Domain files fail under 100% lines and 95% branches each. `repository.ts` fails under 98% lines and 95% branches. `server.ts` fails under 100% lines and 95% branches. The one open scoring branch is the empty "strongest signal" clause: every published source adds a positive factor, so that clause does not run. The open `server.ts` branches are the resource-template helper for an array variable the client does not send.

`npm run test:mutate` is Stryker 10.1.1 with the Vitest runner on `src/domain/**/*.ts`. This run scored **82.07%**: 619 mutants, 508 killed, 110 survived, 1 with no coverage, none timed out, none errored, in 4 minutes 6 seconds. `scoring.ts` was 73.36% (223 killed, 80 survived); most of those survivors are edits to the detail strings. The CI job fails below 80.

`npm audit --omit=dev` on this lockfile reports no production vulnerabilities. A full `npm audit` reports 12 high and 5 moderate advisories, all in devDependencies (Vitest, typescript-eslint, Stryker, and transitive packages such as `picomatch`). They are not in the runtime dependency tree.

## Live deployment

| Endpoint                                                   | Auth                            | What it returns                                                                                             |
| ---------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET https://leadflow-mcp.kfairley9999.workers.dev/`       | none                            | Recorded HTML playground of the fictional Northglass pipeline. JSON if `Accept` prefers `application/json`. |
| `GET https://leadflow-mcp.kfairley9999.workers.dev/api`    | none                            | Service name, version, endpoint list, and a link to this repository                                         |
| `GET https://leadflow-mcp.kfairley9999.workers.dev/health` | none                            | `{"ok":true,"service":"leadflow-mcp","version":"0.1.1"}`                                                    |
| `POST https://leadflow-mcp.kfairley9999.workers.dev/mcp`   | `Authorization: Bearer <token>` | Streamable HTTP MCP: 11 tools, 3 resources, 2 prompts                                                       |

The Worker is `leadflow-mcp`, bound to the D1 database `leadflow` as `DB`, with `compatibility_date` `2026-11-18` and `nodejs_compat`. The schema comes from `migrations/0001_init.sql`. The fictional seed loads on the first authenticated request because `LEADFLOW_SEED` is `auto`. A request without a token, or with the wrong one, gets `401` and `WWW-Authenticate: Bearer`. The token is a Worker secret. It is not in this repository, and the owner hands it out.

Smoke test it:

```bash
curl https://leadflow-mcp.kfairley9999.workers.dev/health

export LEADFLOW_AUTH_TOKEN=...   # ask the owner
curl -X POST https://leadflow-mcp.kfairley9999.workers.dev/mcp \
  -H "Authorization: Bearer $LEADFLOW_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Connect from Cursor. Its MCP settings accept a remote URL with headers, and `${env:...}` keeps the token out of the file:

```json
{
  "mcpServers": {
    "leadflow-live": {
      "url": "https://leadflow-mcp.kfairley9999.workers.dev/mcp",
      "headers": { "Authorization": "Bearer ${env:LEADFLOW_AUTH_TOKEN}" }
    }
  }
}
```

Connect from Claude Desktop through the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge, which turns the remote server into a local stdio process:

```json
{
  "mcpServers": {
    "leadflow-live": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://leadflow-mcp.kfairley9999.workers.dev/mcp",
        "--header",
        "Authorization:${LEADFLOW_AUTH}"
      ],
      "env": { "LEADFLOW_AUTH": "Bearer <token>" }
    }
  }
}
```

From code, pass the header to the SDK transport:

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const transport = new StreamableHTTPClientTransport(
  new URL('https://leadflow-mcp.kfairley9999.workers.dev/mcp'),
  { requestInit: { headers: { Authorization: `Bearer ${process.env.LEADFLOW_AUTH_TOKEN}` } } },
);
const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(transport);
console.log((await client.listTools()).tools.length); // 11
```

## Deploy your own

`npx wrangler deploy --dry-run` with Wrangler 4.164.0 bundles the Worker: upload 753.66 KiB, gzip 154.78 KiB (387.25 KiB / 107.30 KiB with `--minify`), with the `DB` D1 binding and the `LEADFLOW_SEED` / `LEADFLOW_STALE_DAYS` variables. The dry run stops before any account call.

The Worker entry is `src/worker.ts`. Wrangler 4 is a devDependency (`wrangler` 4.164.0 in the lockfile). `compatibility_date` is `2026-11-18`. D1 is bound as `DB`. `database_id` is omitted so the first authenticated deploy can provision the database, or you can create it yourself and paste the id.

```bash
npx wrangler login
npx wrangler d1 create leadflow
# put the printed database_id on the d1_databases entry in wrangler.jsonc
npx wrangler d1 migrations apply leadflow --remote
openssl rand -base64 48 | npx wrangler secret put LEADFLOW_AUTH_TOKEN
npx wrangler deploy
```

The MCP URL is `https://<your-worker>.<your-subdomain>.workers.dev/mcp`. Clients send `Authorization: Bearer <token>`. Until the secret is set, `/mcp` answers 503 and the database stays closed. The Worker also runs the embedded migration on request, and the SQL is idempotent, so the Wrangler migration and the runtime migration can both apply.

The live deployment above was made the same way through the Cloudflare REST API: create the D1 database, run `0001_init.sql` against it, upload the `--dry-run` bundle with its bindings and the secret, and turn on the `workers.dev` route.

Free tier, as published by Cloudflare: Workers and D1 both have a free allotment. This repo does not measure that allotment and does not depend on a paid Workers feature. If you do not want a Cloudflare account, the supported host is the stdio process on your own machine. That path is the one CI smokes.

## Roadmap

- Optional stage machine, for shops that want a fixed path from `new` through `won` or `lost`.
- Per-user tokens in place of one shared bearer secret.
- CSV import that reuses the create-lead validation.
- A reminder when a follow-up comes due, which needs a host that can receive a notification while the laptop is closed.
- Move the Node floor to a release where `node:sqlite` is stable, and delete the experimental-warning filter, without giving up the zero-compile install.

## Project layout

```text
src/bin/            stdio, HTTP, and seed entrypoints
src/mcp/            tool, resource, and prompt registration
src/domain/         scoring, pipeline, CSV, Zod schemas
src/db/             SQL, migrations, repository, seed, both drivers
src/http/serve.ts   loopback Streamable HTTP
src/worker.ts       Cloudflare Workers fetch handler
migrations/         Wrangler D1 migration, kept equal to the embedded SQL
test/               unit, property, repository, contract, MCP, HTTP, stdio, worker, e2e, demo
scripts/demo.ts     the transcript
scripts/smoke-stdio.mjs
stryker.config.json mutation testing for src/domain
```

Scripts: `dev`, `dev:http`, `build`, `start`, `start:http`, `seed`, `demo`, `test`, `test:coverage`, `test:e2e`, `test:mutate`, `lint`, `format`, `typecheck`, `deploy:cf`.

## License

[MIT](LICENSE). Copyright 2026 Kevin Fairley.

## About the author

Kevin Fairley is an AI engineer. Portfolio: [kfairy9999.github.io](https://kfairy9999.github.io). LinkedIn: [kevin-fairley-94330b42a](https://www.linkedin.com/in/kevin-fairley-94330b42a). GitHub: [kfairy9999](https://github.com/kfairy9999).
