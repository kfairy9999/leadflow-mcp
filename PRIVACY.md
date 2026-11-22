# Privacy

LeadFlow MCP is a self-hosted lead pipeline. This policy describes what the software does with data you enter. It is not a description of a hosted product with our own customers.

## Who this applies to

If you run LeadFlow on your machine or on your own Cloudflare Worker, you are the operator. People whose names, phone numbers, or email addresses you store in the pipeline are the data subjects.

## What the server stores

Leads, interactions, and follow-ups that you, or an MCP client acting for you, submit. Estimated job values are stored as integer cents. On the Node server, data lives in the SQLite file set by `LEADFLOW_DB` (default `./data/leadflow.sqlite`). On the Worker, data lives in your D1 database.

## What it does not do

The MCP tool path does not call the public internet, does not send lead data to the author, and does not require an account with a third-party analytics service. Logs on stderr redact emails, phone-shaped strings, bearer tokens, and fields such as `email`, `phone`, `notes`, `summary`, and `contactName`. Redaction is best-effort. The database file still holds the original values. Treat `data/` as private.

## The public demo

[`https://leadflow-mcp.kfairley9999.workers.dev`](https://leadflow-mcp.kfairley9999.workers.dev) serves a recorded playground, public `/api` metadata, and `/health`. Those endpoints return no lead data. `/mcp` requires a bearer token and is not open to anonymous clients.

## Your responsibilities

If you store real customer data, you are responsible for access control (`LEADFLOW_AUTH_TOKEN` off loopback and on the Worker), for who can use the MCP client, and for how long you keep the database.

## Contact

Questions about this policy: [kfairley9999@gmail.com](mailto:kfairley9999@gmail.com).
