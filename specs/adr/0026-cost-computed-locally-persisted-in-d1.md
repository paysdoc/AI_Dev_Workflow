---
status: accepted
date: 2026-03-27
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd-cost-module-revamp.md
  - kind: contemporaneous
    source: specs/prd/d1-cost-database.md
  - kind: contemporaneous
    source: specs for #241 to #245 and #330 to #335 (specs/issue-241-* ... specs/issue-335-*)
supersedes: ["0004"]
superseded-by: []
---

# Cost computed locally and persisted in a D1 database

## Context and Problem Statement

Two PRDs changed the cost module within eight days. The cost module revamp (2026-03-19) found the reported numbers unreliable: the CLI emits `total_cost_usd` while the type expected `totalCostUsd`, so every per-phase accumulation "silently adds zero"; cost from failed agent runs was dropped; progress comments showed frozen values. The D1 PRD (2026-03-27) found the storage unfit: CSV files in git ([ADR-0004](0004-cost-records-as-csv-in-git.md)) cluttered the log, caused merge conflicts, silently ignored old-format files and offered no API.

The decision covers `adws/cost/`, the cost hook in `adws/core/phaseRunner.ts`, and the Worker in `workers/cost-api/`.

## Decision Drivers

* "Bugs in cost computation directly impact invoicing accuracy" (revamp PRD).
* Cost data must feed future invoicing at paysdoc.nl.
* Data must stay in the EU.
* A cost failure must never abort a workflow.

## Considered Options

* Cost as reported by the CLI, against cost computed locally from token counts and pricing tables.
* PostgreSQL, named as phase 2 in the revamp PRD; the D1 PRD chose Cloudflare D1 without recording a comparison.
* Cloudflare Access for the Worker, against a bearer token.

## Decision Outcome

Chosen: compute cost locally, store it in D1 behind a Worker, authenticate with a bearer token.

* Cost is computed by `computeCost(usage, pricing)` from token counts and per-model pricing tables; this is the source of truth. The CLI-reported cost is kept as a divergence check with a 5% threshold. The PRD's reason is control and auditability instead of "an opaque CLI-reported number".
* One `PhaseCostRecord` per model per phase, with status, retry count, context reset count and duration. Token types are an open map, so a new provider needs no schema change. Markup is not part of cost data.
* Records are posted after each phase to `POST /api/cost` on `costs.paysdoc.nl`. The Worker writes three tables (`projects`, `cost_records`, `token_usage`) in the `adw-costs` database, EU jurisdiction, and creates unknown projects on first sight.
* Bearer token, because Access "is designed for browser-based flows" and a service token would give the same security "with more coupling to Cloudflare".
* Rollout in three steps: Worker and migration script, dual-write, removal of the CSV pipeline (#335). All three landed by 2026-03-27. Read endpoints for the marketing site followed in #375.

### Consequences

* Good, because cost no longer produces git commits, and a crashed workflow keeps the cost of its completed phases.
* Good, because cost is queryable over HTTP.
* Bad, because pricing tables must be maintained by hand when prices or models change.
* Bad, because writes are fire-and-forget: a failed POST is logged as a warning and the record is lost. There is no retry and no local fallback. An outage from 2026-04-02 lost six days of records; see [ADR-0030](0030-cloudflare-dns-managed-by-hand.md).
* Bad, because cost recording now depends on an external service and on `COST_API_URL` being set; when it is unset, writes are skipped silently.

### Confirmation

Checked on 2026-09-29:

* `CostTracker.commit` in `adws/core/phaseRunner.ts` calls `postCostRecordsToD1` and nothing else. No CSV writer remains under `adws/`.
* `adws/agents/agentProcessHandler.ts` derives per-model `costUSD` from `computeCost` and `getAnthropicPricing`.
* `workers/cost-api/wrangler.toml` binds `adw-costs` and routes `costs.paysdoc.nl/*`.
* Unit tests: `adws/cost/__tests__/computation.test.ts` and `extractor.test.ts`, run by `bun run test:unit`; Worker tests in `workers/cost-api/test/`. No CI workflow runs either. `adws/cost/d1Client.ts` has no test.

## More Information

* Unresolved: the divergence check cannot fire. `createPhaseCostRecords` (`adws/cost/types.ts:140-141`) sets `computedCostUsd` and `reportedCostUsd` to the same locally computed value, so `checkDivergence` compares a number with itself and D1's `reported_cost_usd` does not hold the CLI's figure. A comment at `types.ts:91` reads "until local computation is implemented".
* Unresolved: `estimatedTokens` and `actualTokens` are always `undefined` in records, so the estimate-against-actual report of the revamp PRD is never produced.
* Unresolved: the deploy workflow has not deployed a Worker since 2026-04-02; see [ADR-0022](0022-review-proof-in-r2-behind-router-worker.md).
* The revamp PRD introduced Vitest for this module; see [ADR-0018](0018-unit-tests-restored-alongside-bdd.md).
* `README.md` describes divergence detection as working and the CSV files as having lived in the target repository. Neither matches the code or the specs.
