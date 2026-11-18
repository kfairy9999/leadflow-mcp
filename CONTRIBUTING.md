# Contributing

LeadFlow is a small codebase on purpose. Changes should keep that shape.

## Setup

Node.js 22.13 or newer. The server uses the built-in `node:sqlite` module, which is not available on Node 20.

```bash
npm install
npm test
npm run typecheck
npm run lint
```

## What to run before a pull request

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run test:e2e
npm run test:mutate
```

CI runs the same steps on Node 22, then `npm run test:e2e` after the build. Mutation testing is a separate job, `npm run test:mutate`, and it fails the workflow below the break score in `stryker.config.json`.

## Habits

- Keep tool inputs as Zod schemas in `src/domain/schemas.ts`. The model sees those descriptions.
- Do not log contact names, phones, emails, notes, or summaries. `createLogger` redacts the known keys and email-shaped or phone-shaped strings, and tests check that a create does not echo an address into the log sink.
- Money is integer cents.
- The scoring rubric lives in `SCORE_RULES`. `renderScoringModel()` reads the same object. If you change a point value, update the unit test that pins Marina, Samira, Helen, and Chris.
- `migrations/0001_init.sql` and `MIGRATION_001_SQL` must stay identical. A test fails when they diverge. New changes get a new migration with `IF NOT EXISTS` so D1 and a re-run are safe.
- Seed people are fictional. Phones stay in the `555-0100` range. Emails stay on `example.com`.
- `npm run demo` writes a real MCP session. `test/demo.test.ts` compares it with `docs/demo-transcript.txt` after replacing the random lead id. If the wording changes, regenerate the transcript and update the README block that quotes it.

## Scope

This repository does not take pull requests that add a paid API, a hosted database, or a native addon. The point of the project is that `npm install` on a clean Node 22 machine is enough.
