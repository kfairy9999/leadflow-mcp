# Changelog

## 0.1.0

First public release.

- MCP server for a single-shop lead pipeline: create, update, get, search, score, log an interaction, schedule and close follow-ups, summarize the pipeline, export CSV.
- Resources for the pipeline snapshot, the scoring rubric, and one lead by URI.
- Prompts for a daily follow-up briefing and a single-lead draft.
- SQLite through a repository interface, with the same SQL on `node:sqlite` and a D1 adapter.
- stdio and loopback Streamable HTTP. Cloudflare Workers entry refuses to serve until `LEADFLOW_AUTH_TOKEN` is set. No live deployment is claimed.
- Rule-based scoring with the factors returned to the caller. No language-model call.
- Fictional Northglass Plumbing seed.
