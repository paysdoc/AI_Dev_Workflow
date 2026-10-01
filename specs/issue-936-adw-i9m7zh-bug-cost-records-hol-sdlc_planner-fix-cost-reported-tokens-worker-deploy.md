# Bug: Cost records copy the computed cost into the reported cost and carry no token estimates; the Worker deploy workflow never deploys

## Metadata
issueNumber: `936`
adwId: `i9m7zh-bug-cost-records-hol`
issueJson: `{"number":936,"title":"bug: cost records hold the CLI figure and token estimates; the Worker deploy workflow deploys","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision records\n\nADR-0026 (items 1, 2 and 3), ADR-0022 (item 1).\n\n## What to build\n\n- **Reported cost (ADR-0026, item 1).** Cost records set the computed cost and the reported cost to the same locally computed value, so the 5% divergence check compares a number with itself. The locally computed cost is the source of truth. The reported cost must hold the figure the CLI reports, so that the check can fire.\n- **Estimate against actual (ADR-0026, item 2).** `estimatedTokens` and `actualTokens` are always undefined. Fill them, so that the estimate-against-actual report of the cost PRD can be produced.\n- **Worker deploy (ADR-0022, item 1).** The deploy workflow has skipped both deploy jobs since 2026-04-02. Its path filter compares `main` with the default branch and finds no changed files after a merge. Fix the change detection so a merge that touches a Worker deploys it. The observability configuration of 2026-07-30 for the cost API was never deployed; the fixed workflow must deploy it.\n\n## Acceptance criteria\n\n- [ ] A cost record's reported cost comes from the CLI's result message and can differ from the computed cost; a unit test shows the divergence check firing.\n- [ ] Records carry estimated and actual token counts.\n- [ ] A change under a Worker's directory, merged the way releases are merged, runs that Worker's deploy job.\n- [ ] The Divergence section of ADR-0026 and item 1 of ADR-0022 are removed in the same pull request.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-01T19:20:08Z","comments":[],"actionableComment":null}`

## Bug Description
Three defects. The `## Divergence` sections of ADR-0026 (items 1, 2 and 3) and ADR-0022 (item 1) are the specification.

**1. The reported cost is the computed cost (ADR-0026, item 1).** `createPhaseCostRecords` (`adws/cost/types.ts:140-141`) fills `computedCostUsd` and `reportedCostUsd` from the same field, `usage.costUSD`. `adws/agents/agentProcessHandler.ts:29` computes that field locally with `computeCost(tokens, getAnthropicPricing(model))`. The CLI reports its own figure for each model as `modelUsage[<model>].costUSD` in the `result` message, for example `"claude-fable-5-1": {..., "costUSD": 4.1394945}` in `adws/jsonl/fixtures/session-rate-limited.jsonl`. `toTokenUsageMap` in `adws/cost/providers/anthropic/extractor.ts:45-52` discards it. As a result:
- `checkDivergence` compares a number with itself and cannot fire.
- `formatDivergenceWarning` never prints "Cost Divergence Detected".
- D1's `reported_cost_usd` holds the locally computed cost.
- *Expected:* `computedCostUsd` is the local computation, which is the source of truth. `reportedCostUsd` is the CLI's figure from its result message. The two can differ, and a gap above 5% is flagged. The cost API keeps totalling the computed cost, never the CLI's figure.

**2. Estimated and actual tokens are always undefined (ADR-0026, item 2).** `createPhaseCostRecords` hard-codes `estimatedTokens: undefined` and `actualTokens: undefined` (`types.ts:147-148`). Yet `handleAgentProcess` already has both values: `extractor.getEstimatedUsage()`, and `extractor.getCurrentUsage()` once the result message has arrived. It returns them as `AgentResult.estimatedUsage`/`actualUsage`, and only the build phase reads them, for a console log. So `formatEstimateVsActual(records)` always returns `''`, and the cost PRD's estimate-against-actual report is never produced.
- *Expected:* a Phase Cost Record carries per-model estimated and actual token counts whenever its runs produced them.

**3. The deploy workflow skips every deploy job (ADR-0022, item 1; ADR-0026, item 3).** `.github/workflows/deploy-workers.yml` runs on push to `main`. Its `dorny/paths-filter@v3` step sets no `base`, so the action compares `main` with the repository's default branch, `dev`. A release reaches `main` as the merge commit of a pull request from `dev` (ADR-0019, `gh pr merge --merge`). After that merge, the tip of `dev` is the merge base of the two branches, so the diff from the merge base to `main` is empty. The runs of 2026-07-30 (`30548828711`) and 2026-09-25 (`36109665658`) both log "Changes will be detected between dev and main", then "Detected 0 changed files", and skip both deploy jobs.
- No Worker has been deployed since 2026-04-02.
- The cost-api observability configuration of 2026-07-30 (`[observability.logs]` in `workers/cost-api/wrangler.toml`, commit `f9d49dfa`) is in git but not on Cloudflare.
- *Expected:* a release merge that touches `workers/<name>/` runs `deploy-<name>`, and the fixed workflow deploys the cost-api configuration of 2026-07-30.

## Problem Statement
- `createPhaseCostRecords` builds records from the per-model usage entry, `LegacyModelUsage`, that every phase passes to it. That entry has nowhere to hold the CLI's cost figure or the estimated and actual token counts, and the extractor does not keep the CLI's per-model figure at all. So no record can hold the CLI's figure or the token counts.
- The cost API's read endpoints total `SUM(COALESCE(reported_cost_usd, computed_cost_usd))` (`workers/cost-api/src/queries.ts:73` and `:102`). That changes nothing while both columns hold the same value. Once `reported_cost_usd` holds the CLI's figure, the cost breakdown and the per-issue costs would report the CLI's figure, and the computed cost would stop being the source of truth.
- The deploy workflow's change detection compares the push with the wrong base. A release merge therefore never shows a changed Worker, and a release that changes no Worker file cannot deploy the configuration that never reached Cloudflare.

## Solution Statement
**Cost records (ADR-0026, items 1 and 2).** Carry the CLI's figures beside the local ones in the per-model usage entry that every phase already passes to `createPhaseCostRecords`. There are 25 call sites in 18 files under `adws/phases/`. Each one either uses one run's `AgentResult.modelUsage` as it is, or combines runs with `mergeModelUsageMaps`. So none of them changes, and the record cannot be filled from anywhere else without editing all 25.
1. The extractor keeps the per-model `costUSD` from the result message and exposes it through a new method, `TokenUsageExtractor.getReportedCostUsdByModel()`.
2. `LegacyModelUsage` gets three optional fields:
   - `reportedCostUSD`: the CLI's figure.
   - `estimatedTokens`: the streaming estimate, taken just before the result message.
   - `actualTokens`: the counts from the result message.

   `costUSD` stays the local computation.
3. The private `toOldModelUsageMap` in `agentProcessHandler.ts` moves into the cost module as `toLegacyModelUsageMap(extractor)` and fills the three fields. The move has two further effects:
   - `agentProcessHandler.ts` stays under the 300-line limit of the guidelines. It has 294 lines today, so adding to it in place would exceed the limit.
   - The conversion can be unit-tested with a real extractor and no child process.
4. `mergeModelUsageMaps` sums each optional field only when both entries have it, and drops it otherwise. A figure that covers only some of a record's runs would be compared with one that covers all of them. That would raise a false Cost Divergence or skew the estimate delta.
5. `createPhaseCostRecords` copies the three fields into `reportedCostUsd`, `estimatedTokens` and `actualTokens`.

Left unchanged:
- `AgentResult.totalCostUsd`.
- The D1 payload. `transformToIngestPayload` already maps `reported_cost_usd: r.reportedCostUsd`, and `JSON.stringify` drops an `undefined` value.
- The cost-api Worker's ingest and schema. Its column `reported_cost_usd` is nullable and bound with `?? null`.

**Cost API totals (ADR-0026, item 1).** The Worker's read endpoints must keep the computed cost as the source of truth once `reported_cost_usd` holds the CLI's figure.
- Both queries in `workers/cost-api/src/queries.ts` sum `computed_cost_usd` instead of `COALESCE(reported_cost_usd, computed_cost_usd)`: the cost breakdown (line 73) and the per-phase costs behind the per-issue costs (line 102).
- The COALESCE dates from #375, when both columns always held the same value. Every record ADW has posted set both from the same `costUSD` (`createPhaseCostRecords` has copied it into both since it was written), so the change leaves the totals of the stored records as they are.
- `reported_cost_usd` is still stored, so the CLI's figure stays available beside the computed cost.

**Worker deploy (ADR-0022, item 1).**
1. Set `base: ${{ github.ref }}` on the paths-filter step. When `base` names the pushed branch, `dorny/paths-filter` diffs `github.event.before..<pushed commit>`, which is exactly what the release changed. Its own `git fetch` makes the shallow checkout enough. Checked on the history of `main`:
   - Release `740e5822` (2026-09-25): the merge-base diff the action made lists 0 files, while `before..after` lists 10 files under `workers/`.
   - Release `1e6bb19e` (2026-07-30): `before..after` lists both `wrangler.toml` files.
2. Add `.github/workflows/deploy-workers.yml` to each Worker's filter, so that a change to how the Workers are deployed redeploys them.
   - This is what makes the release that carries this fix deploy both Workers, and with them the never-deployed configuration of 2026-07-30. `main` and `dev` have no difference under `workers/` today. That release changes `workers/cost-api/src/queries.ts` ("Cost API totals" above) but no file of screenshot-router. Without this entry screenshot-router would not be deployed, and deploying the cost-api configuration would hinge on an unrelated query change.
   - `git diff 1e6bb19e origin/main -- workers/cost-api/wrangler.toml` is empty: the configuration is unchanged since 2026-07-30.
3. Remove the trigger-level `on.push.paths`.
   - GitHub matches that filter against at most the first 300 changed files of a push. Releases here are often larger: 600 files on 2026-09-10, 487 on 2026-09-25, 314 on 2026-09-24. A Worker change beyond the first 300 files would skip the whole workflow without any message.
   - The `changes` job, a git diff with no such cap, becomes the only change detection. The cost is one short job per push to `main`.

**ADRs.**
- ADR-0026: remove the whole `## Divergence` section; all three of its items are fixed here.
- ADR-0022: remove item 1 only, and leave item `2.` with its number, because open issue #937 refers to it as "ADR-0022 (item 2)".

## Steps to Reproduce
Cost record:
1. Run the command below. It runs before and after the fix; before the fix the type has no such fields, hence the `as never`.
   ```
   bunx tsx -e "import { createPhaseCostRecords } from './adws/cost/types.ts'; import { checkDivergence } from './adws/cost/computation.ts'; const [r] = createPhaseCostRecords({ workflowId: 'w', issueNumber: 1, phase: 'plan', status: 'success', retryCount: 0, contextResetCount: 0, durationMs: 0, modelUsage: { 'claude-sonnet-4-5-20250929': { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.0105, reportedCostUSD: 0.021, estimatedTokens: { input: 1000, output: 400 }, actualTokens: { input: 1000, output: 500 } } as never } }); console.log(JSON.stringify({ computed: r.computedCostUsd, reported: r.reportedCostUsd, estimatedTokens: r.estimatedTokens ?? null, actualTokens: r.actualTokens ?? null, divergent: checkDivergence(r.computedCostUsd, r.reportedCostUsd).isDivergent }));"
   ```
2. Before the fix it prints `{"computed":0.0105,"reported":0.0105,"estimatedTokens":null,"actualTokens":null,"divergent":false}`. The CLI's 0.021 and the token counts are ignored.
3. After the fix it prints `{"computed":0.0105,"reported":0.021,"estimatedTokens":{"input":1000,"output":400},"actualTokens":{"input":1000,"output":500},"divergent":true}`.
4. Upstream, feed a `result` line with `modelUsage` to `new AnthropicTokenUsageExtractor().onChunk(...)`. No method returns the per-model `costUSD`; only `total_cost_usd` is kept, through `getReportedCostUsd()`.

Cost API totals:
1. `grep -n 'COALESCE(reported_cost_usd, computed_cost_usd)' workers/cost-api/src/queries.ts` prints lines 73 and 102.
2. `workers/cost-api/test/queries.test.ts` asserts that a record with `computed_cost_usd` 0.5 and `reported_cost_usd` 2.0 totals 2.0, in the breakdown (line 155) and in the per-issue costs (line 283). Once records carry the CLI's figure, the cost API reports that figure instead of the computed cost.

Deploy workflow:
1. `gh run view 30548828711 --log | grep -E 'detected between|Detected [0-9]+ changed'` prints "Changes will be detected between dev and main" and "Detected 0 changed files".
2. `gh run view 30548828711 --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'` shows "Deploy cost-api: skipped" and "Deploy screenshot-router: skipped". Run `36109665658` (2026-09-25) shows the same.
3. Reproduce the comparison on the release of 2026-09-25, which changed 10 Worker files:
   ```
   git fetch origin main
   R=740e5822c2d0e16929c472fb18c051fcff1a9eb8
   git diff --name-only "$(git merge-base "$R^2" "$R")" "$R" -- workers/ | wc -l   # what the action compared (dev...main): 0
   git diff --name-only "$R^1" "$R" -- workers/ | wc -l                             # github.event.before..github.sha: 10
   ```

## Root Cause Analysis
**Cost.**
- The cost-module revamp (#241–#245) added `PhaseCostRecord.reportedCostUsd`, `estimatedTokens` and `actualTokens`, and the extractor methods `getReportedCostUsd()` and `getEstimatedUsage()`.
- Records, however, are built from `LegacyModelUsageMap`, the per-model map with camelCase fields that the phases already accumulated. Its only cost field is `costUSD`.
- When local computation was wired into `toOldModelUsageMap`, `costUSD` became the local figure. `createPhaseCostRecords` still copied that one field into both cost fields; the comment at `types.ts:91` still says "equals reportedCostUsd until local computation is implemented".
- Nothing carries a CLI figure towards the record. The extractor keeps only `total_cost_usd`, which is a session total rather than a per-model figure, and its `toTokenUsageMap` drops each model's `costUSD`.
- `estimatedTokens` and `actualTokens` were left as `undefined` placeholders ("until streaming estimation is implemented"). Streaming estimation was implemented later. Its results reach `AgentResult.estimatedUsage` and `actualUsage`, but never the per-model map the record is built from.
- The cost API's read endpoints (#375) chose `COALESCE(reported_cost_usd, computed_cost_usd)`. With both columns equal, preferring the reported column had no visible effect; once records hold the CLI's figure, it would replace the computed cost in every total.

**Deploy.**
- `dorny/paths-filter` replaces an unset `base` with the repository's default branch. When that differs from the pushed branch, it diffs `merge-base(base, head)...head`. Only when `base` names the pushed branch does it compare with `github.event.before`.
- The runs that did detect changes, on 2026-04-02 (`2814e59f`, `9a0c9f4c`, `d646ca5d`), were for single-parent commits made directly on `main`. Those commits are not in `dev`, so they appear in the merge-base diff.
- Since then `main` has received only merges from `dev`, starting with `39c90eb7` on 2026-04-08. After such a merge, the tip of `dev` is the merge base, and the merged tree equals `dev`'s. Both filters are therefore false on every release.

## Relevant Files
Use these files to fix the bug:

- `README.md` — project overview. Line 30 already describes divergence detection as working; after this fix that is true, so no change is needed.
- `.adw/coding_guidelines.md` — rules to follow: files under 300 lines, immutability, no `any` or unchecked `as`, nesting depth of 2 or less, comments only for invariants and reasons.
- `specs/adr/0026-cost-computed-locally-persisted-in-d1.md` — the specification for items 1–3. Its `## Divergence` section is removed in this pull request.
- `specs/adr/0022-review-proof-in-r2-behind-router-worker.md` — the specification for the deploy fix. Item 1 of its `## Divergence` is removed in this pull request.
- `specs/adr/0019-dev-and-main-branches-with-runner-clone.md` — how releases reach `main`: a pull request from `dev`, merged with `gh pr merge --merge`. Force pushes are forbidden, so `github.event.before` is always the previous tip of `main`.
- `.claude/skills/write-an-adr/SKILL.md` — after acceptance, only `status`, `superseded-by`, `## Divergence` and the supersession note may change in an ADR.
- `specs/prd-cost-module-revamp.md` — defines `reportedCostUsd` ("CLI-reported (for divergence check)"), `estimatedTokens`/`actualTokens`, the 5% warning and the estimate-against-actual report.
- `adws/cost/types.ts`:
  - `TokenUsageExtractor` gets the new method.
  - `LegacyModelUsage` gets the three optional fields.
  - `createPhaseCostRecords` (lines 140–148) maps them.
  - The stale field comments at lines 91–106 are corrected.
- `adws/cost/providers/anthropic/extractor.ts` — `handleResultMessage` (lines 145–160) keeps the per-model `costUSD`.
- `adws/cost/costHelpers.ts`:
  - `mergeModelUsageMaps` (lines 6–23) gets the rule for the optional fields.
  - The JSDoc on `computeTotalCostUsd` (line 25) falsely says the CLI-reported cost is the source of truth.
- `adws/cost/providers/anthropic/index.ts` and `adws/cost/index.ts` — export the new converter.
- `adws/agents/agentProcessHandler.ts` — `toOldModelUsageMap` (lines 16–33) is replaced by the converter at line 152. `totalCostUsd`, `costSource`, `estimatedUsage` and `actualUsage` stay as they are.
- `adws/cost/computation.ts`, `adws/cost/reporting/commentFormatter.ts` — `checkDivergence`, `formatDivergenceWarning` and `formatEstimateVsActual` are unchanged. The tests use them to show the check firing and the report being produced.
- `adws/cost/d1Client.ts` — unchanged. `transformToIngestPayload` already sends `reported_cost_usd`; its first test is added here.
- `adws/core/phaseRunner.ts` — unchanged. `CostTracker.commit` posts the records to D1.
- `adws/types/agentTypes.ts` — unchanged. `AgentResult.estimatedUsage`, `actualUsage` and `costSource` keep their meaning.
- `adws/phases/*.ts` (25 `createPhaseCostRecords` call sites) and `adws/phases/buildPhase.ts:148-179` — unchanged. They show that every path either passes `modelUsage` through or merges it with `mergeModelUsageMaps`.
- `adws/phases/prReviewCompletion.ts`, `adws/phases/workflowCompletion.ts` — unchanged. They call `formatCostCommentSection`, where the divergence warning and the estimate-against-actual table are shown.
- `workers/cost-api/src/ingest.ts`, `workers/cost-api/src/schema.sql` — unchanged. A missing `reported_cost_usd` is stored as NULL, and there are no columns for estimated or actual tokens.
- `workers/cost-api/src/queries.ts` — `handleGetCostBreakdown` (line 73) and `handleGetCostIssues` (line 102) total `COALESCE(reported_cost_usd, computed_cost_usd)`; both change to `computed_cost_usd`.
- `workers/cost-api/test/queries.test.ts` — the Worker's query tests, run with `@cloudflare/vitest-pool-workers` from `workers/cost-api`. The two tests that assert the COALESCE (lines 155 and 283) are inverted.
- `specs/issue-375-adw-48ki7w-add-get-endpoints-fo-sdlc_planner-cost-api-get-endpoints.md` — design decision 4 of #375, "`COALESCE(reported_cost_usd, computed_cost_usd)` everywhere", taken while both columns held the same value.
- `workers/cost-api/wrangler.toml`, `workers/screenshot-router/wrangler.toml` — unchanged. They hold the never-deployed `[observability.logs]` configuration of 2026-07-30.
- `.github/workflows/deploy-workers.yml` — the change detection to fix.
- `adws/cost/__tests__/extractor.test.ts`, `adws/cost/__tests__/computation.test.ts` — existing cost tests to extend or keep green.
- `adws/agents/__tests__/agentProcessHandler.test.ts` — the fake-child-process harness (`createFakeChild`, `tmpOutputFile`) the new handler test reuses.
- `adws/__tests__/prTemplateMarker.test.ts` — an example of a contract-guard test that reads a repository file and makes text assertions. The workflow test follows its style.
- `adws/jsonl/fixtures/session-rate-limited.jsonl`, `adws/jsonl/fixtures/result-success.jsonl` — evidence of the real result shape: per-model `costUSD` in `modelUsage`, and assistant `message.model` keys that match the `modelUsage` keys.
- Conditional docs, read for context. The document phase updates them, not this plan:
  - `app_docs/feature-9gjajh-cost-tracking.md` (owns `adws/cost/**`).
  - `app_docs/feature-9gjajh-claude-agents-core.md` (owns `adws/agents/agentProcessHandler.ts`).
  - `app_docs/feature-9gjajh-root-config.md` (owns `.github/**`).
  - `app_docs/feature-9gjajh-cost-api-worker.md` (owns `workers/cost-api/**`; line 22 describes the COALESCE fallback).
  - `app_docs/feature-9gjajh-specs-and-prd.md` (owns `specs/**`).
  - `adws/README.md` (when working in `adws/`).

### New Files
- `adws/cost/providers/anthropic/legacyModelUsage.ts` — `toLegacyModelUsageMap(extractor)`. It turns the extractor's final state into the per-model usage map, with `costUSD` computed locally plus the CLI's figure, the estimate and the actual counts.
- `adws/cost/__tests__/phaseCostRecords.test.ts` — from stream to record: the divergence check fires, the estimate-against-actual report is produced, and the merge rule holds.
- `adws/cost/__tests__/d1Client.test.ts` — `reported_cost_usd` in the D1 payload holds the CLI's figure.
- `adws/__tests__/deployWorkersWorkflow.test.ts` — a contract guard on the deploy workflow's change detection.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the specification and confirm the baseline
- Read `## Divergence` in `specs/adr/0026-cost-computed-locally-persisted-in-d1.md` and `specs/adr/0022-review-proof-in-r2-behind-router-worker.md`.
- In `specs/prd-cost-module-revamp.md`, read the sections "`PhaseCostRecord` data model", "Divergence checking" and "Estimate-vs-actual reporting".
- Run `bun run test:unit` and note the baseline: 155 files and 2635 tests passed on 2026-10-01.
- Run the cost reproduction command from "Steps to Reproduce". It should print `"reported":0.0105` and `"divergent":false`.

### 2. Make the extractor keep the CLI's per-model cost
- In `adws/cost/types.ts`, add a method to `TokenUsageExtractor`: `getReportedCostUsdByModel(): Readonly<Record<string, number>>;`. Give it a one-line JSDoc: the per-model `costUSD` from the result message's `modelUsage`, empty until finalization.
- In `adws/cost/providers/anthropic/extractor.ts`:
  - Add a private field `reportedCostUsdByModel: Record<string, number> = {}`.
  - In `handleResultMessage`, inside the existing `msg.modelUsage` guard, fill it from the entries whose `costUSD` is a number. Use `flatMap` or a type guard, not `as`.
  - Implement `getReportedCostUsdByModel()` so that it returns a copy.
  - Do not change `getReportedCostUsd()` or `toTokenUsageMap`.
- Write these tests first in `adws/cost/__tests__/extractor.test.ts`; they fail until the method exists:
  - It returns `{}` before any result message.
  - After `RESULT_MESSAGE` it returns `{ 'claude-sonnet-4-5-20250929': 0.0123 }`.
  - A multi-model result gives both models their own figure (0.04 and 0.01).
  - A `modelUsage` entry without `costUSD` is left out.
  - Changing the returned object does not affect a later call.

### 3. Give per-model usage entries room for the CLI's figure, the estimate and the actual counts
- In `adws/cost/types.ts`, add these optional, readonly fields to `LegacyModelUsage`:
  - `reportedCostUSD?: number`
  - `estimatedTokens?: TokenUsageMap`
  - `actualTokens?: TokenUsageMap`
- Give them one short comment that says what the names cannot:
  - `reportedCostUSD` is the CLI's figure, while `costUSD` is computed locally.
  - Each optional field is absent when any run merged into the entry lacked it.
- Leave `emptyLegacyModelUsage()` as it is; it has no optional keys.

### 4. Add the converter `toLegacyModelUsageMap`
- Create `adws/cost/providers/anthropic/legacyModelUsage.ts`. It exports `toLegacyModelUsageMap(extractor: TokenUsageExtractor): LegacyModelUsageMap`.
- For each `[model, tokens]` of `extractor.getCurrentUsage()` (the actual counts once finalized, the estimates otherwise), it produces:
  - the four token fields and `costUSD: computeCost(tokens, getAnthropicPricing(model))`, exactly as `toOldModelUsageMap` does today;
  - `reportedCostUSD` from `extractor.getReportedCostUsdByModel()[model]`, when defined;
  - `estimatedTokens` from `extractor.getEstimatedUsage()[model]`, when defined;
  - `actualTokens: tokens`, when `extractor.isFinalized()`.
- An absent figure must be an absent key, not an `undefined` value. Use the spread idiom already used in `transformToIngestPayload` and `buildPausedWorkflowEntry`: `...(value !== undefined && { key: value })`.
- If the per-model mapping has its own branching, extract it into a named function (nesting depth 2 or less).
- Export the converter from `adws/cost/providers/anthropic/index.ts`, and add it to the provider export line in `adws/cost/index.ts`.

### 5. Use the converter in `handleAgentProcess`
- In `adws/agents/agentProcessHandler.ts`:
  - Delete `toOldModelUsageMap`, including its JSDoc.
  - Replace lines 152–154 with `const legacyUsage = toLegacyModelUsageMap(extractor);` and `const resolvedModelUsage: ModelUsageMap | undefined = Object.keys(legacyUsage).length > 0 ? legacyUsage : undefined;`.
- Keep `computeEstimatedCostUsd`, `totalCostUsd`, `costSource`, `estimatedUsage` and every `actualUsage:` property exactly as they are. The build phase's console log of estimate against actual still reads them.
- Afterwards the file should be about 280 lines, under 300. Remove any import that is no longer used.
- Write these tests first in `adws/agents/__tests__/agentProcessHandler.test.ts`, as a new `describe('handleAgentProcess — cost figures')` that reuses `createFakeChild` and `tmpOutputFile`. Use model `claude-sonnet-4-5-20250929`, which has Sonnet pricing.
  - The run emits one `assistant` line: `message: { id: 'msg_1', model, usage: { input_tokens: 1000, cache_creation_input_tokens: 400, cache_read_input_tokens: 2000 }, content: [{ type: 'text', text: 'x'.repeat(1600) }] }`.
  - It then emits one `result` line: `{ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 's-1', total_cost_usd: 0.0252, modelUsage: { [model]: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 2000, cacheCreationInputTokens: 400, costUSD: 0.0252 } } }`.
  - The process closes with code 0. Assert on `result.modelUsage[model]`:
    - `costUSD` ≈ 0.0126, the local computation.
    - `reportedCostUSD` is 0.0252, the CLI's figure.
    - `estimatedTokens` equals `{ input: 1000, cache_write: 400, cache_read: 2000, output: 400 }`.
    - `actualTokens` equals `{ input: 1000, output: 500, cache_read: 2000, cache_write: 400 }`.
  - A second test emits the same `assistant` line only and closes with code 1. `reportedCostUSD` and `actualTokens` are absent, and `estimatedTokens` is present.

### 6. Apply the merge rule in `mergeModelUsageMaps`
- In `adws/cost/costHelpers.ts`, keep the two loops of `mergeModelUsageMaps` and change the body to `result[model] = mergeModelUsage(result[model], usage);`.
- `mergeModelUsage(existing: LegacyModelUsage | undefined, usage: LegacyModelUsage): LegacyModelUsage`:
  - With no `existing`, it returns `{ ...usage }`. The first entry for a model keeps its figures; summing it onto `emptyLegacyModelUsage()` would lose them.
  - Otherwise it sums the four token fields and `costUSD` as today, and spreads in the optional fields:
    - `reportedCostUSD` is the sum, if both are defined.
    - `estimatedTokens` and `actualTokens` are the per-key sums over the union of keys, if both are defined.
    - Each is absent otherwise.
  - Add a small `sumTokenUsageMaps(a, b)` helper for the per-key sums.
- Add one short comment on the rule giving its reason: a figure covering only some of a record's runs must not be compared with a figure covering all of them.
- Remove the `emptyLegacyModelUsage` import if it is no longer used; the lint rule `no-unused-vars` is an error.
- Delete the JSDoc above `computeTotalCostUsd` (line 25). It claims the CLI-reported cost is the source of truth, but `costUSD` is computed locally, and the name already says what the function does.

### 7. Map the fields in `createPhaseCostRecords`
- In `adws/cost/types.ts`, inside `createPhaseCostRecords`:
  - `reportedCostUsd: usage.reportedCostUSD` (was `usage.costUSD`).
  - `estimatedTokens: usage.estimatedTokens` (was `undefined`).
  - `actualTokens: usage.actualTokens` (was `undefined`).
  - Keep `computedCostUsd: usage.costUSD`.
- Correct the stale field comments on `PhaseCostRecord`:
  - `computedCostUsd` (line 91): drop "equals reportedCostUsd until local computation is implemented"; it is the source of truth.
  - `reportedCostUsd` (line 93): the CLI's figure from its result message; undefined when any run behind the record ended without one.
  - `estimatedTokens` and `actualTokens` (lines 103–106): drop "undefined until streaming estimation is implemented". Each is undefined when any run behind the record lacked it.

### 8. Unit-test the records from stream to report
- Create `adws/cost/__tests__/phaseCostRecords.test.ts`. Drive it through public functions only:
  - a real `AnthropicTokenUsageExtractor` fed the JSONL lines from step 5;
  - then `toLegacyModelUsageMap`, `mergeModelUsageMaps` and `createPhaseCostRecords`;
  - then the pure `checkDivergence`, `formatDivergenceWarning` and `formatEstimateVsActual`.

  Do not call `formatCostCommentSection`, which reads `SHOW_COST_IN_COMMENTS` and fetches exchange rates.
- Cases:
  1. **The divergence check fires.** The CLI's figure is 0.0252 and the local cost is ≈ 0.0126.
     - The record has `reportedCostUsd` 0.0252 and `computedCostUsd` ≈ 0.0126.
     - `checkDivergence(record.computedCostUsd, record.reportedCostUsd)` gives `isDivergent: true` and `percentDiff` ≈ 50.
     - `formatDivergenceWarning([record])` contains `Cost Divergence Detected` and `computed $0.0126 vs reported $0.0252`.
  2. **No divergence when the CLI's figure is within 5%.** With a CLI figure of 0.0128, `isDivergent` is false and `formatDivergenceWarning([record])` is `''`.
  3. **Estimate against actual.**
     - `record.estimatedTokens` and `record.actualTokens` hold the step 5 values.
     - `formatEstimateVsActual([record])` contains `Estimate vs Actual Tokens` and the row `| plan | claude-sonnet-4-5-20250929 | output | 400 | 500 | +100 | 25.0% |`.
  4. **A run that ends before the result message.** The record has `reportedCostUsd` undefined, `actualTokens` undefined and `estimatedTokens` defined. `checkDivergence` does not fire.
  5. **Two finalized runs of one model, merged** (CLI figures 0.0252 and 0.0128).
     - `reportedCostUsd` ≈ 0.038.
     - `estimatedTokens` and `actualTokens` are summed per key: actual `{ input: 2000, output: 1000, cache_read: 4000, cache_write: 800 }`.
     - `tokenUsage` and `computedCostUsd` are summed as before: `input` 2000, cost ≈ 0.0252.
  6. **A finalized run merged with an unfinalized one.** `reportedCostUsd` and `actualTokens` are undefined; `estimatedTokens` is the per-key sum.
  7. **Merging into an empty map.** `mergeModelUsageMaps({}, usage)` keeps `reportedCostUSD`, `estimatedTokens` and `actualTokens`.
- Use `toBeCloseTo` for floating-point costs.

### 9. Unit-test the D1 payload
- Create `adws/cost/__tests__/d1Client.test.ts` for `transformToIngestPayload`, which is pure:
  - A record with `computedCostUsd: 0.0126` and `reportedCostUsd: 0.0252` gives `computed_cost_usd: 0.0126` and `reported_cost_usd: 0.0252`.
  - With `reportedCostUsd: undefined`, `JSON.parse(JSON.stringify(payload)).records[0]` has no `reported_cost_usd` key, which the Worker stores as NULL.
- If importing `../d1Client` pulls in side effects in the test run, mock `'../../core'` with `{ log: vi.fn() }`, as other cost tests do.
- Do not change `d1Client.ts`. The token maps are not sent to D1: the Worker has no columns for them, and the PRD keeps them on the record.

### 10. Make the cost API total the computed cost
- Write the tests first in `workers/cost-api/test/queries.test.ts`:
  - Replace `it('uses reported_cost_usd when present (COALESCE)')` (line 155) with `it('totals computed_cost_usd and ignores reported_cost_usd')`. The record seeded with computed 0.5 and reported 2.0 gives a breakdown `totalCost` of 0.5.
  - Replace `it('uses COALESCE: prefers reported_cost_usd over computed_cost_usd')` (line 283) the same way for `/costs/issues`: `totalCost` and `phases[0].cost` are 0.5.
  - Rename `it('falls back to computed_cost_usd when reported is null')` to `it('totals computed_cost_usd when reported_cost_usd is null')`; its body stays. Without the COALESCE there is no fallback.
  - Run `cd workers/cost-api && bun install && bun run test`. The two replaced tests fail.
- In `workers/cost-api/src/queries.ts`, replace `SUM(COALESCE(reported_cost_usd, computed_cost_usd))` with `SUM(computed_cost_usd)` in `handleGetCostBreakdown` (line 73) and in `handleGetCostIssues` (line 102).
- Change nothing else in the Worker: not the response shapes, `ingest.ts`, the schema or `wrangler.toml`.
- Run the Worker tests again; all pass.
- The `@adw-936` scenario "The cost API totals a project's costs from the computed cost, never from the CLI's figure" checks the same rule through both read endpoints.

### 11. Fix the deploy workflow's change detection
- Edit `.github/workflows/deploy-workers.yml` to this shape. Keep the job names, the `outputs` mapping and both deploy jobs unchanged.
  ```yaml
  name: Deploy Workers

  on:
    # No paths filter here: GitHub matches it against at most 300 changed files of a push,
    # and a release from dev often changes more. The changes job decides instead.
    push:
      branches:
        - main

  jobs:
    changes:
      # ... unchanged name, runs-on, outputs, checkout step ...
        - name: Detect changes
          id: filter
          uses: dorny/paths-filter@v3
          with:
            # The pushed branch itself, so the diff starts at the commit the push replaced.
            # The default, dev, is main's merge base after a release merge, so it finds nothing.
            base: ${{ github.ref }}
            filters: |
              screenshot-router:
                - 'workers/screenshot-router/**'
                - '.github/workflows/deploy-workers.yml'
              cost-api:
                - 'workers/cost-api/**'
                - '.github/workflows/deploy-workers.yml'
  ```
- Do not change `actions/checkout@v4` (depth 1 is enough, because paths-filter fetches the `before` commit itself), `oven-sh/setup-bun@v2` or `cloudflare/wrangler-action@v3`.
- Keep the two comments short. They state reasons the YAML cannot show (ADR-0054); do not add others.

### 12. Add a contract test for the workflow
- Create `adws/__tests__/deployWorkersWorkflow.test.ts` in the style of `adws/__tests__/prTemplateMarker.test.ts`:
  - Read `.github/workflows/deploy-workers.yml` with `fs`, resolved from `__dirname`, and make text assertions. No YAML dependency.
  - List the Worker directories with `fs.readdirSync(<repo>/workers, { withFileTypes: true }).filter(d => d.isDirectory())`.
- Assertions:
  - The file contains `uses: dorny/paths-filter@v3` and `base: ${{ github.ref }}`.
  - The trigger, which is the text before `jobs:`, contains `- main` and no `paths:`.
  - For each Worker directory `<name>`:
    - The `changes` job exposes `<name>: ${{ steps.filter.outputs.<name> }}`.
    - The filter block matches `<name>:` followed by `- 'workers/<name>/**'` and `- '.github/workflows/deploy-workers.yml'`. Use a regex with `\s+` between the lines.
    - There is a job containing `if: needs.changes.outputs.<name> == 'true'` and `workingDirectory: workers/<name>`.
- Run it against the current workflow before step 11, if steps are reordered for TDD: it fails on `base`, on `paths:` and on the filter entries. After step 11 it passes.

### 13. Remove the resolved Divergence entries from the ADRs
- `specs/adr/0026-cost-computed-locally-persisted-in-d1.md`:
  - Delete lines 66–71: the `## Divergence` heading, its blank line and items 1–3. The last bullet of `### Confirmation` is then followed by one blank line and `## More Information`.
  - Change nothing else: front matter, Confirmation and More Information stay as they are (write-an-adr rules).
- `specs/adr/0022-review-proof-in-r2-behind-router-worker.md`:
  - Delete line 68, item 1 ("The deploy workflow does not deploy").
  - Leave item `2.` numbered `2.`, because #937 refers to it as "ADR-0022 (item 2)".
  - If item 1 turns out to be the only item left (#937 merged first), delete the whole `## Divergence` section instead.
  - Change nothing else.
- Do not edit `specs/adr/README.md`. The statuses stay `accepted`, and the index does not list divergences.

### 14. Run the validation commands
- Run every command under "Validation Commands" and fix anything that fails before you finish.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun install` — prepares the app (`.adw/commands.md`).
- `bun run lint` — ESLint, including `no-unused-vars` for removed imports.
- `bunx tsc --noEmit` — type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — type check of `adws/`, including the new tests.
- `bun run build` — build.
- `bun run lint:git-guard` — the new files under `adws/` must not shell out to git or gh.
- `bunx vitest run adws/cost adws/agents/__tests__/agentProcessHandler.test.ts adws/__tests__/deployWorkersWorkflow.test.ts` — the focused tests. Before steps 2–9, 11 and 12 the new cases fail; after them, all pass.
- `bun run test:unit` — the full unit suite. All files pass: the baseline is 155 files and 2635 tests, plus the new ones.
- `cd workers/cost-api && bun install && bun run test` — the cost API's tests, including the two that now assert the computed cost (step 10). The root `test:unit` does not run them.
- Cost reproduction, before and after. After the fix it prints `{"computed":0.0105,"reported":0.021,"estimatedTokens":{"input":1000,"output":400},"actualTokens":{"input":1000,"output":500},"divergent":true}`:
  `bunx tsx -e "import { createPhaseCostRecords } from './adws/cost/types.ts'; import { checkDivergence } from './adws/cost/computation.ts'; const [r] = createPhaseCostRecords({ workflowId: 'w', issueNumber: 1, phase: 'plan', status: 'success', retryCount: 0, contextResetCount: 0, durationMs: 0, modelUsage: { 'claude-sonnet-4-5-20250929': { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.0105, reportedCostUSD: 0.021, estimatedTokens: { input: 1000, output: 400 }, actualTokens: { input: 1000, output: 500 } } as never } }); console.log(JSON.stringify({ computed: r.computedCostUsd, reported: r.reportedCostUsd, estimatedTokens: r.estimatedTokens ?? null, actualTokens: r.actualTokens ?? null, divergent: checkDivergence(r.computedCostUsd, r.reportedCostUsd).isDivergent }));"`
- Deploy reproduction: the comparison the action made, against the one `base: ${{ github.ref }}` makes. It should print 0, then 10.
  `git fetch origin main && R=740e5822c2d0e16929c472fb18c051fcff1a9eb8 && git diff --name-only "$(git merge-base "$R^2" "$R")" "$R" -- workers/ | wc -l && git diff --name-only "$R^1" "$R" -- workers/ | wc -l`
- `! grep -n 'reportedCostUsd: usage.costUSD' adws/cost/types.ts` — the record no longer copies the computed cost.
- `! grep -n -E 'estimatedTokens: undefined|actualTokens: undefined' adws/cost/types.ts` — the placeholders are gone.
- `! grep -n 'COALESCE(reported_cost_usd' workers/cost-api/src/queries.ts` — the cost API no longer prefers the CLI's figure.
- `grep -n 'base: \${{ github.ref }}' .github/workflows/deploy-workers.yml` — the base is pinned to the pushed branch.
- `! grep -n '^## Divergence' specs/adr/0026-cost-computed-locally-persisted-in-d1.md` — the section is removed.
- `! grep -n 'The deploy workflow does not deploy' specs/adr/0022-review-proof-in-r2-behind-router-worker.md` — item 1 is removed.
- `wc -l adws/agents/agentProcessHandler.ts adws/cost/costHelpers.ts adws/cost/types.ts adws/cost/providers/anthropic/extractor.ts` — each file is under 300 lines.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-936"` — the scenarios written for this issue by the scenario agent.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite.

## Notes
- **Guidelines.** Follow `.adw/coding_guidelines.md` strictly:
  - files under 300 lines (hence the converter's move out of `agentProcessHandler.ts`);
  - immutable values: spread copies, no mutation of merged entries;
  - no `any` or unchecked `as` in production code;
  - nesting depth of 2 or less;
  - comments only for invariants and reasons, with no issue numbers (ADR-0054).
- **No new library.** The workflow test uses text assertions, as `prTemplateMarker.test.ts` does. `yaml` is only a transitive dependency and is deliberately not imported.
- **Why the figures ride on `LegacyModelUsage`.** It is the one value every phase threads from `AgentResult.modelUsage` to `createPhaseCostRecords`. Passing `AgentResult.estimatedUsage` and `actualUsage` into the records instead would mean changing all 25 call sites in 18 phase files. Some of those phases also accumulate usage across several runs (build continuations, review and test retries), so each would need the same merge rule.
- **Post-release check.** This cannot run before merge. Once the release PR from `dev` that carries this fix is merged into `main`:
  - `gh run list --workflow deploy-workers.yml --limit 1` lists the new run.
  - `gh run view <id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'` shows both deploy jobs as `success`, not `skipped`, because the workflow file is in both filters.
  - `gh run view <id> --log | grep 'detected between'` shows "<sha> and main", not "dev and main".
  - `npx wrangler deployments list` in `workers/cost-api` shows a deployment after the release. The cost API's `[observability.logs]` configuration of 2026-07-30 is then live, and so are the computed-cost totals of step 10.
- **Deploy-job risk, separate from change detection.**
  - The deploy jobs have not run since 2026-04-02. Run `23900325519` was the last time the screenshot-router job ran, and it failed. Its logs have expired (HTTP 410), so the cause is unknown; `setup-bun` was added to the workflow later that day.
  - The `CLOUDFLARE_API_TOKEN` secret may also have changed since then.
  - The two deploy jobs are independent, so a screenshot-router failure does not block cost-api.
  - If either job fails on its first run, that is a new defect. It does not mean the change detection is wrong.
- **Out of scope, observed:**
  - `AgentResult.totalCostUsd`, and with it `PhaseResult.costUsd` and the persisted `totalCostUsd`, still takes the CLI's `total_cost_usd` for finalized runs, while the per-model `costUSD` is local. The records are unaffected.
  - No orchestrator passes `phaseCostRecords` to `completeWorkflow`. So the cost section with the divergence warning and the estimate-against-actual table appears only on the PR-review completion comment (`prReviewCompletion.ts`), and only when `SHOW_COST_IN_COMMENTS` is set. The records now carry what that report needs.
  - Expect divergence warnings for models missing from `ANTHROPIC_PRICING`. For example, `claude-fable-5-1` falls back to Sonnet pricing. That is the check working as ADR-0026 intends, "an early signal when pricing tables need updating"; updating the table is separate work.
  - The More Information section of ADR-0026 says `README.md` describes divergence detection as working, "Neither matches the code". After this fix that is half stale, but the write-an-adr rules allow only `## Divergence`, status, superseded-by and the supersession note to change, so leave it.
  - The `estimatedTokens` and `actualTokens` maps are not stored in D1. Storing them would need a Worker change and a migration.
- **BDD scenarios.** The scenarios for `@adw-936` are written by the separate scenario agent; this plan does not write them.
