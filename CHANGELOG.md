# Changelog

## Unreleased

- Added `PRIVACY.md` and `SECURITY.md`, and linked both from the README.
- Streamable HTTP and the Worker rate-limit `/mcp` (default 60 requests per minute per client). Exceeding the cap returns `429` with `Retry-After`. `/health` and the public Worker routes are not limited. Override with `LEADFLOW_RATE_LIMIT_MAX` and `LEADFLOW_RATE_LIMIT_WINDOW_MS`; `0` disables the cap.

- `GET /` is now a recorded HTML playground of the fictional Northglass Plumbing demo (pipeline, due follow-ups, and two published scores). It returns no live lead data. Service metadata moved to `GET /api`, and `GET /` still returns that JSON when the client prefers `application/json`. `/health` is unchanged. `/mcp` still requires a bearer token.
- The Worker answers `HEAD` on the public routes, serves `robots.txt` and a favicon, and sets CSP, `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy` on those responses.
- Docs: the Worker is live at `https://leadflow-mcp.kfairley9999.workers.dev` on Cloudflare Workers and D1 (free tier). The README documents the endpoints, bearer-token auth, and client setup for Cursor, Claude Desktop, and the SDK. No code changed.

## 0.1.1

- Follow-up due times and interaction timestamps were compared as raw text. An offset such as `16:00+01:00`, or a `Z` form with no milliseconds, did not mean the instant it spelled, so a due item could be missing from the call list and `MAX(occurred_at)` could pick the earlier conversation. Writes now store `Date#toISOString`, and the idempotency hash uses that same instant.
- Logging an interaction set the lead's `updatedAt` to the conversation time. A backdated note moved the lead backward in the recently-updated scan. `updatedAt` is the server clock.
- Recency treated an age of exactly 2 days as "under 2 days" and exactly 7 days as "under 7 days". The published rubric says under 2, under 7, then 7 through 14 days at 0. Those two instants now follow the rubric.
- A closed-lost summary said the score was capped when the raw total was already under 15.
- CSV formula neutralization missed a cell whose first non-whitespace character is `=`, `+`, `-`, or `@`. Spreadsheets still execute those. Leading whitespace is neutralized too.
- Setting a follow-up to the status it already had rewrote the lead's `updatedAt` and could fail a concurrent update. The same status is now a no-op.
- `daily_follow_up_briefing`'s `staleAfterDays` was a number schema. Prompt arguments arrive as strings, so a client could not set it. The value is coerced.
- The Worker's runtime migration sent the formatted SQL script through D1 `exec`. Miniflare's D1 ends a statement at a newline, so `CREATE TABLE` never completed and `/mcp` could not bootstrap. `migrate` now runs one flattened statement at a time. Wrangler still applies `migrations/0001_init.sql` as a file.
- Log fields named `reason` were redacted, which hid why a seed was skipped. Those diagnostics are logged as `cause`.
- Tests now cover tool edges, fast-check scoring invariants, contract snapshots, migration parity on Miniflare D1, and the built stdio and HTTP servers. Stryker on `src/domain` scored 82.07% (508 of 619 mutants killed).

## 0.1.0

First public release.

- MCP server for a single-shop lead pipeline: create, update, get, search, score, log an interaction, schedule and close follow-ups, summarize the pipeline, export CSV.
- Resources for the pipeline snapshot, the scoring rubric, and one lead by URI.
- Prompts for a daily follow-up briefing and a single-lead draft.
- SQLite through a repository interface, with the same SQL on `node:sqlite` and a D1 adapter.
- stdio and loopback Streamable HTTP. Cloudflare Workers entry refuses to serve until `LEADFLOW_AUTH_TOKEN` is set. No live deployment is claimed.
- Rule-based scoring with the factors returned to the caller. No language-model call.
- Fictional Northglass Plumbing seed.
