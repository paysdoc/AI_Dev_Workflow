# Feature: Screenshot harvest to R2 + inline proof PR comment

## Metadata
issueNumber: `580`
adwId: `izgf7n-screenshot-harvest-t`
issueJson: `{"number":580,"title":"Screenshot harvest to R2 + inline proof PR comment","body":"## Parent PRD\n\n`specs/prd/multi-language-test-and-bdd-support.md`\n\n## What to build\n\nHarvest BDD screenshots and surface them on the PR. `proofArtifactHarvester` collects images written to the `ADW_PROOF_DIR` convention; upload via the existing R2 service; `prProofPublisher` posts a self-explanatory **PR comment** with the JUnit summary and **inline screenshots** (markdown embeds of public R2 URLs, grouped under collapsible `<details>` per scenario, raw R2 link as fallback). See PRD Implementation Decisions → Proof layer & PR proof surfacing.\n\n## Acceptance criteria\n\n- [ ] Harvester globs `ADW_PROOF_DIR` and returns image paths (unit-tested: empty/nested/mixed-ext)\n- [ ] Images uploaded to R2 with public URLs\n- [ ] Proof comment posted with pass/fail summary + inline screenshots, collapsible per scenario, R2-link fallback\n- [ ] `prProofPublisher` formatting unit-tested\n\n## Blocked by\n\n- Blocked by #578\n\n## User stories addressed\n\n- User story 12\n- User story 13\n- User story 14\n- User story 15\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-15T11:51:23Z","comments":[{"author":"paysdoc","createdAt":"2026-06-16T19:30:35Z","body":"## continue"}],"actionableComment":null}`

## Feature Description

This is the second slice of the **Proof layer** described in `specs/prd/multi-language-test-and-bdd-support.md` ("Proof layer" and "PR proof surfacing" under Implementation Decisions). The blocking slice #578 (JUnit report rail) is already merged: it gives us `testReportParser` (`TestReport`/`TestCaseResult`), `readJUnitReport`, and an extended `TagProofResult` that now carries structured `counts` (`{ total, passed, failed }`) and per-case `cases` from the JUnit report. What remains is to **harvest the screenshots a BDD run produces and surface them, with the JUnit summary, on the pull request**.

Today the Cloudflare R2 module (`adws/r2/`) is fully built (`uploadToR2`, `ensureBucket`, public URLs under `https://screenshots.paysdoc.nl`) but **has zero production call sites** — confirming the PRD's "vestmatic screenshots are dead" symptom: BDD runs capture stdout only and harvest zero image artifacts. This feature wires the dead pipeline live.

Three new capabilities are added:

1. **`proofArtifactHarvester`** — a pure module that recursively globs a known proof directory (the `ADW_PROOF_DIR` convention) for image files and returns their paths, preserving the relative path so screenshots can be grouped by scenario downstream.
2. **R2 upload wiring** — each harvested image is uploaded to the per-repo R2 bucket via the existing `uploadToR2`, yielding a public URL.
3. **`prProofPublisher`** — composes the JUnit summary (pass/fail per tag from `TagProofResult.counts`) plus **inline screenshots** (markdown image embeds of the public R2 URLs, grouped under collapsible `<details>` per scenario, each with its raw R2 link as a fallback) into a self-explanatory **PR comment**, and posts it to the PR.

The value: a reviewer opening the PR sees, in one comment, what BDD scenarios ran, whether they passed, and the visual evidence — without leaving the PR or digging through logs.

## User Story

As a reviewer (and ADW operator running UI BDD)
I want BDD screenshots harvested, uploaded to R2, and inlined in a self-explanatory PR comment alongside the JUnit pass/fail summary — grouped by scenario in collapsible sections with a raw R2 link fallback
So that I can see exactly what ran and what passed, with visual proof, directly on the pull request.

This covers PRD user stories 12 (screenshots harvested + uploaded to R2), 13 (self-explanatory proof comment), 14 (screenshots inlined with R2-link fallback), and 15 (grouped by scenario in collapsible sections).

## Problem Statement

ADW's scenario proof captures stdout only. The R2 upload module exists but is never called, so:

- BDD runs that produce screenshots (UI BDD on target repos like `vestmatic-research`) leave those images stranded on disk in the worktree; they never reach a reviewer.
- The PR receives no proof comment: the reviewer cannot tell from the PR what scenarios ran, whether they passed, or see any visual evidence — they must read CI logs.
- There is no convention telling a BDD runner / generated step definitions **where** to write screenshots so ADW can find them, and no harvester to collect them.

The PR **description** is written before proof exists (the PR is created before — and independently of — the scenario run in some flows), so proof must be surfaced as a **comment**, not folded into the description.

## Solution Statement

Introduce a cohesive **proof layer** module (`adws/proof/`) and a thin orchestrator phase that runs after the PR is created:

1. **Convention:** ADW exports an absolute `ADW_PROOF_DIR` into the scenario subprocess environment (alongside the existing `ADW_JUNIT_REPORT_PATH`), pointing at a stable per-workflow directory under the scenario proof dir. Step definitions / runner config write screenshots there. `runScenarioProof` clears + creates this directory before the run (so stale images from an earlier retry never leak) and returns its path on `ScenarioProofResult.artifactsDir`.

2. **`proofArtifactHarvester` (pure):** `harvestProofArtifacts(dir)` recursively walks the directory (iterative stack walk, mirroring `stepDefDetection.ts` — no recursion-in-loop), filters to image extensions (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`), and returns `ProofArtifact[]` (`{ absPath, relPath }`). Missing/empty dir → `[]`. Unit-tested over empty / nested / mixed-extension fixtures.

3. **R2 upload (impure, isolated):** for each artifact, upload via the existing `uploadToR2({ owner, repo, key, body, contentType })`. Key = `proof/{adwId}/{relPath}`; content type derived from extension. Each upload yields `{ scenario, url }`. Wrapped per-image in try/catch; if R2 is not configured (missing env) or upload fails, degrade gracefully (skip that image / fall back to summary-only).

4. **`prProofPublisher`:** a **pure** `formatPrProofComment(input)` (JUnit pass/fail summary table from `TagProofResult.counts` + screenshots grouped by scenario under collapsible `<details>`, each embedded as `[![name](url)](url)` with the raw R2 URL printed beneath as fallback) — unit-tested; plus an impure `publishPrProof(deps)` that harvests → uploads → formats → posts via `commentOnPR(prNumber, body, repoInfo)`.

5. **Phase wiring:** a new non-fatal `executeProofPublishPhase(config)` reads the final `ScenarioProofResult` from `config.ctx.scenarioProof`, derives the PR number from `config.ctx.prUrl` (`extractPrNumber`), and calls `publishPrProof`. It is wired into `adwSdlc.tsx` (and other scenario-running, PR-creating orchestrators) immediately **after** `executePRPhase`. The phase never throws — proof publishing failures are logged and swallowed (mirrors the KPI phase's non-fatal contract).

Scenario grouping is derived from the artifact's `relPath`: the leading path segment (the scenario sub-directory) is the group key; flat files fall into a single "Screenshots" group. This keeps the harvester pure and simple ("returns image paths") and puts all grouping/formatting logic in the unit-tested pure formatter.

## Relevant Files

Use these files to implement the feature:

- `adws/r2/index.ts` / `adws/r2/uploadService.ts` / `adws/r2/types.ts` — existing R2 upload service. `uploadToR2({ owner, repo, key, body, contentType? }) → { url, bucket, key }`. Public URL = `https://screenshots.paysdoc.nl/{repo}/{key}`; bucket `adw-{owner}-{repo}` created lazily with a 30-day lifecycle. **This feature is its first production caller.**
- `adws/phases/scenarioProof.ts` — produces `ScenarioProofResult { tagResults, hasBlockerFailures, resultsFilePath }`. Each `TagProofResult` already carries `counts?: { total, passed, failed }` and `cases?: TestCaseResult[]` (from #578). **Modify:** compute + clear + create `artifactsDir`, inject `ADW_PROOF_DIR` into the per-tag scenario subprocess env, and return `artifactsDir` on the result.
- `adws/agents/bddScenarioRunner.ts` — `runScenariosByTag(tagCommand, tag, cwd?, env?)` already merges an `env` record into the subprocess (used today for `ADW_JUNIT_REPORT_PATH`). `ADW_PROOF_DIR` is injected the same way; **no change expected** beyond passing the extra env key from `scenarioProof.ts`.
- `adws/phases/scenarioTestPhase.ts` — calls `runScenarioProof` (proofDir = `agents/{adwId}/scenario-test`). **Modify:** set `config.ctx.scenarioProof = scenarioProof` before returning so the publish phase can read the final proof (the field already exists on `WorkflowContext`).
- `adws/core/testReportParser.ts` — `TestReport`/`TestCaseResult` shapes and `readJUnitReport` (re-exported from `adws/core/index.ts`). Source of the JUnit summary the publisher renders.
- `adws/github/prApi.ts` — `commentOnPR(prNumber: number, body: string, repoInfo: RepoInfo): void` (re-exported via `adws/github/index.ts` and `githubApi.ts`). The PR comment primitive.
- `adws/adwBuildHelpers.ts` — `extractPrNumber(prUrl): number` (returns 0 when unparseable). Used to derive the PR number from `ctx.prUrl`.
- `adws/github/workflowCommentsIssue.ts` — `formatScreenshotSection` (lines ~208-214) is the **canonical inline-embed-with-link-fallback pattern**: `[![Screenshot N](url)](url)` inside a `<details>`. Mirror this in the new formatter.
- `adws/github/proofCommentFormatter.ts` — existing **review** proof formatter (pure, "caller appends ADW footer"). Reference for `<details>` section + markdown table conventions; the new `prProofPublisher` formatter follows the same purity contract (does not append the footer; the phase does).
- `adws/core/workflowCommentParsing.ts` — `ADW_SIGNATURE` footer constant, appended by the phase (not the pure formatter).
- `adws/phases/reviewPhase.ts` — reference for a phase reading `ctx`, `ctx.prUrl`, `repoContext.repoId.{owner,repo}`, and posting GitHub artifacts; also shows the `isGitHubAppConfigured()` / approval pattern (not needed here, but illustrative of phase structure).
- `adws/phases/workflowCompletion.ts` — documented "screenshot upload integration point" in `.adw/project.md`; confirms the proof/screenshot concern is a post-implementation, terminal-side concern. (No direct change; the new phase is the actual integration.)
- `adws/adwSdlc.tsx` — canonical orchestrator. `executePRPhase` (sets `ctx.prUrl`) runs at step ~131, **after** the scenario test/review loops. The publish phase is wired in right after it. **Modify.**
- `adws/phases/index.ts` and `adws/workflowPhases.ts` — phase barrels; **modify** to export `executeProofPublishPhase`.
- `adws/core/environment.ts` — env accessors (`CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` all default `''`). Reference for the "R2 configured?" guard. (Optionally add an `isR2Configured()` helper here.)
- `adws/phases/scenarioTestPhase.ts` & `adws/core/stepDefDetection.ts` — `stepDefDetection.ts` is the prior-art **iterative stack-walk directory scan** to mirror in the harvester (lint-friendly, no recursion-in-loop).
- `app_docs/feature-u3l5q0-junit-report-rail-migration.md` — the #578 implementation doc. Confirms `prProofPublisher` + screenshot/R2 harvest were explicitly deferred to **this** issue, and that `proofCommentFormatter.ts` "can later read `TagProofResult.counts`".
- `.adw/commands.md` — validation commands (lint, tsc, `test:unit`, build, regression).
- `.adw/coding_guidelines.md` — purity, immutability, max-depth-2 nesting, guard clauses, files < 300 lines, isolate side effects at boundaries.

### New Files

- `adws/proof/proofArtifactHarvester.ts` — pure harvester: `harvestProofArtifacts(dir: string): ProofArtifact[]`.
- `adws/proof/prProofPublisher.ts` — pure `formatPrProofComment(input: ProofCommentInput): string` + impure `publishPrProof(deps: PublishDeps): Promise<void>`.
- `adws/proof/types.ts` — `ProofArtifact`, `UploadedArtifact`, `ProofCommentInput`, `PublishDeps`.
- `adws/proof/index.ts` — barrel re-exporting the public surface.
- `adws/proof/__tests__/proofArtifactHarvester.test.ts` — temp-dir fixtures: empty, nested, mixed-extension.
- `adws/proof/__tests__/prProofPublisher.test.ts` — formatting: inline embeds, collapsible per-scenario grouping, raw-link fallback, summary table, zero-screenshots (summary-only).
- `adws/phases/proofPublishPhase.ts` — `executeProofPublishPhase(config: WorkflowConfig)` (non-fatal phase).

## Implementation Plan

### Phase 1: Foundation
Establish the `ADW_PROOF_DIR` convention and the harvest directory contract. Extend `scenarioProof.ts` to (a) compute a deterministic, absolute `artifactsDir` under the existing `proofDir`, (b) clear + create it before the tag loop, (c) inject `ADW_PROOF_DIR` into the per-tag scenario subprocess env (alongside `ADW_JUNIT_REPORT_PATH`), and (d) return `artifactsDir` on `ScenarioProofResult`. Define shared types in `adws/proof/types.ts`. This is the seam every later step depends on, and it is backward-compatible: repos whose step defs don't write images simply leave the dir empty.

### Phase 2: Core Implementation
Build the proof layer module:
- `proofArtifactHarvester.ts` — recursive image glob → `ProofArtifact[]`, with unit tests.
- `prProofPublisher.ts` — pure `formatPrProofComment` (summary table + grouped collapsible inline screenshots with link fallback), with unit tests; impure `publishPrProof` (harvest → upload to R2 → format → `commentOnPR`).
- `adws/proof/index.ts` barrel.

### Phase 3: Integration
Wire the proof layer into the workflow:
- `scenarioTestPhase.ts` sets `config.ctx.scenarioProof` so the final proof is reachable.
- `proofPublishPhase.ts` (`executeProofPublishPhase`) reads `ctx.scenarioProof` + `ctx.prUrl`, calls `publishPrProof`, and is non-fatal.
- Export the phase through `phases/index.ts` and `workflowPhases.ts`.
- Wire `executeProofPublishPhase` into `adwSdlc.tsx` (and the other scenario-running, PR-creating orchestrators) immediately after `executePRPhase`.
- Validate end-to-end against ADW-self (CLI repo → summary-only comment, no screenshots) and via unit tests for the screenshot-bearing path.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Define proof-layer types
- Create `adws/proof/types.ts` with:
  - `ProofArtifact { readonly absPath: string; readonly relPath: string }` — `relPath` is relative to the harvest root (used to derive the scenario group).
  - `UploadedArtifact { readonly scenario: string; readonly url: string; readonly fileName: string }`.
  - `ProofCommentInput { readonly tagResults: readonly TagProofResultLike[]; readonly uploaded: readonly UploadedArtifact[]; readonly r2Configured: boolean }` — `TagProofResultLike` is the subset of `TagProofResult` the formatter needs (`resolvedTag`, `severity`, `passed`, `skipped`, `counts?`); import `TagProofResult` from `../phases/scenarioProof` and alias rather than redefining if convenient.
  - `PublishDeps` — everything `publishPrProof` needs: `{ artifactsDir, scenarioProof, prNumber, repoInfo: { owner, repo }, adwId, uploader?, commenter? }` (inject `uploader`/`commenter` to keep it testable; default to the real `uploadToR2` / `commentOnPR`).
- Keep all types `readonly`; no behavior here.

### 2. Establish the `ADW_PROOF_DIR` convention in `scenarioProof.ts`
- In `runScenarioProof`, after resolving `proofDir`, compute `const artifactsDir = path.resolve(proofDir, 'artifacts');`.
- Before the tag loop: `fs.rmSync(artifactsDir, { recursive: true, force: true });` then `fs.mkdirSync(artifactsDir, { recursive: true });` (clears stale images from prior retries, mirroring the per-tag `fs.rmSync(reportPath, ...)`).
- Pass `ADW_PROOF_DIR: artifactsDir` in the env object handed to `runScenariosByTag` (alongside the existing `ADW_JUNIT_REPORT_PATH`).
- Add `artifactsDir: string` to the `ScenarioProofResult` interface and return it from both the early-return (no-step-defs) path and the normal path. For the no-step-defs early return, still create the (empty) `artifactsDir` so downstream readers get a valid path.
- Confirm no behavior change when step defs don't write images: the dir is simply empty.

### 3. Implement `proofArtifactHarvester`
- Create `adws/proof/proofArtifactHarvester.ts` exporting `harvestProofArtifacts(dir: string): ProofArtifact[]`.
- Guard: if `dir` does not exist (`fs.existsSync`), return `[]`.
- Walk the tree iteratively with an explicit stack (mirror `adws/core/stepDefDetection.ts`), collecting files whose lowercased extension is in `IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']`.
- For each match, push `{ absPath, relPath }` where `relPath = path.relative(dir, absPath)` (POSIX-normalised with forward slashes for stable grouping).
- Sort results by `relPath` for deterministic output.
- Keep the function pure (no logging, no upload).

### 4. Unit-test the harvester
- Create `adws/proof/__tests__/proofArtifactHarvester.test.ts` (Vitest), using `fs.mkdtempSync(os.tmpdir() ...)` fixtures, cleaned up in `afterEach`.
- Cases:
  - **empty** — empty dir → `[]`.
  - **missing** — non-existent path → `[]`.
  - **nested** — images under `scenarioA/`, `scenarioB/sub/` → all found with correct `relPath`s.
  - **mixed extensions** — `.png`/`.jpg`/`.jpeg`/`.gif`/`.webp` included; `.txt`/`.xml`/`.md`/no-extension excluded.
  - **case-insensitive extension** — `.PNG`/`.JPG` included.
  - **deterministic order** — results sorted by `relPath`.

### 5. Implement the pure formatter `formatPrProofComment`
- In `adws/proof/prProofPublisher.ts`, export `formatPrProofComment(input: ProofCommentInput): string` (pure, no I/O, no footer — caller appends `ADW_SIGNATURE`).
- Header: `## :camera: BDD Proof` with an overall status line derived from `tagResults` (pass when no non-skipped blocker tag failed; mirror `scenarioProof.hasBlockerFailures` semantics).
- **Summary table** from `tagResults`: columns `Suite | Scenarios | Status | Severity`. `Scenarios` from `counts` (`{passed}/{total}`) or `-` when absent/skipped; `Status` = ✅ passed / ❌ failed / ⏭️ skipped.
- **Screenshots**: group `uploaded` by `scenario`; render one collapsible `<details><summary>{scenario} ({n})</summary>` per group, body = inline embeds `[![{fileName}]({url})]({url})` each followed by the raw URL on its own line as the link fallback. Flat/ungrouped images → a single `Screenshots` group.
- **Fallbacks/edge cases:** no `uploaded` and `r2Configured` → omit the screenshots block (summary-only). No `uploaded` and `!r2Configured` → append a one-line note that R2 is not configured so screenshots were skipped. Empty `tagResults` → render a minimal "no scenario proof available" body.
- Keep nesting ≤ 2; extract per-group and per-image rendering into small named helpers (e.g. `formatScenarioGroup`, `formatImageEmbed`).

### 6. Implement the impure `publishPrProof`
- In the same file, export `async function publishPrProof(deps: PublishDeps): Promise<void>`.
- Guard clauses (each logs and returns early): `prNumber <= 0` → skip; missing `artifactsDir`/`scenarioProof` → skip.
- Harvest: `const artifacts = harvestProofArtifacts(deps.artifactsDir)`.
- Determine `r2Configured` (R2 env present). If configured and there are artifacts, upload each via the injected `uploader` (default `uploadToR2`): key `proof/{adwId}/{relPath}`, `contentType` from extension (`contentTypeForExt` helper), `body = fs.readFileSync(absPath)`; collect `UploadedArtifact { scenario: leadingSegment(relPath), url, fileName }`. Wrap each upload in try/catch — a single failed upload is logged and skipped, never fatal.
- Format via `formatPrProofComment({ tagResults: scenarioProof.tagResults, uploaded, r2Configured })`, append `ADW_SIGNATURE`.
- Post via the injected `commenter` (default `commentOnPR`) with `(prNumber, body, repoInfo)`.
- The whole function is defensive: any unexpected error is caught and logged; it must not throw.

### 7. Unit-test the formatter
- Create `adws/proof/__tests__/prProofPublisher.test.ts` (Vitest) covering the **pure** `formatPrProofComment`:
  - Summary table renders pass/fail/skipped rows with `{passed}/{total}` from `counts`.
  - Inline embed format is exactly `[![name](url)](url)` and the raw URL appears as a fallback line.
  - Screenshots grouped per scenario under separate `<details>` blocks with correct counts.
  - Ungrouped (flat) images fall under a single `Screenshots` group.
  - Zero uploaded + `r2Configured: true` → summary-only (no `<details>` screenshots block).
  - Zero uploaded + `r2Configured: false` → includes the "R2 not configured" note.
  - Mixed pass/fail tags drive the overall status header correctly.
- (Optional, if it does not require network/fs mocking gymnastics) a small test for `publishPrProof` using injected fake `uploader`/`commenter` to assert it skips on `prNumber <= 0` and posts the expected body otherwise.

### 8. Create the `adws/proof/index.ts` barrel
- Re-export `harvestProofArtifacts`, `formatPrProofComment`, `publishPrProof`, and the public types from `types.ts`.

### 9. Surface the final proof on the workflow context
- In `adws/phases/scenarioTestPhase.ts`, after `scenarioProof` is computed (both dev-server and non-dev-server branches), set `config.ctx.scenarioProof = scenarioProof;` before building cost records / returning. (`WorkflowContext.scenarioProof` already exists.)

### 10. Implement the `executeProofPublishPhase` phase
- Create `adws/phases/proofPublishPhase.ts` exporting `async function executeProofPublishPhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }>` (same return shape contract as `executeScenarioTestPhase`, `costUsd: 0`, so `runPhase` is happy).
- Read `const scenarioProof = config.ctx.scenarioProof;` and `const prNumber = extractPrNumber(config.ctx.prUrl);`.
- Resolve `repoInfo` from `config.repoContext?.repoId` (owner/repo) or `config.targetRepo`, falling back to `getRepoInfo()` for the self-hosted case.
- Call `await publishPrProof({ artifactsDir: scenarioProof?.artifactsDir, scenarioProof, prNumber, repoInfo, adwId: config.adwId })` inside a try/catch — log any failure as `warn`, never rethrow.
- Produce a `createPhaseCostRecords({ ... phase: 'proofPublish', status: Success ... })` record (zero cost) and return.
- Add `'proofPublish'` to the phase name set if phase names are enumerated/validated anywhere (search for how `'scenarioTest'` is registered and mirror it).

### 11. Export the phase through the barrels
- Add `export { executeProofPublishPhase } from './proofPublishPhase';` to `adws/phases/index.ts`.
- Add `executeProofPublishPhase` to the re-export list in `adws/workflowPhases.ts`.

### 12. Wire the phase into `adwSdlc.tsx`
- Import `executeProofPublishPhase` from `./workflowPhases`.
- After `await runPhase(config, tracker, executePRPhase);` (and before the `awaiting_merge` state write), add `await runPhase(config, tracker, executeProofPublishPhase);`.
- Because the phase is non-fatal and no-ops when `ctx.scenarioProof`/`ctx.prUrl` are absent, ordering after PR creation is safe.

### 13. Wire the phase into the other scenario-running, PR-creating orchestrators
- Add the same one-line `executeProofPublishPhase` call after PR creation in `adwPlanBuildTest.tsx` and `adwPlanBuildTestReview.tsx` (and any other orchestrator that runs `executeScenarioTestPhase` and then `executePRPhase`).
- Confirm each still type-checks and the phase no-ops gracefully where a PR or scenario proof is absent.

### 14. Optional: `isR2Configured()` helper
- If the "R2 configured?" check is used in more than one place, add a small `isR2Configured(): boolean` to `adws/core/environment.ts` (returns true when all three R2 env vars are non-empty) and use it in `publishPrProof`. Otherwise inline the check.

### 15. Run the full validation suite
- Run every command in **Validation Commands** and ensure each exits zero with no regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope (and are an explicit acceptance criterion). Use **Vitest** (`bun run test:unit` → `vitest run`); place tests in `adws/proof/__tests__/` (covered by the existing `adws/**/__tests__/**/*.test.ts` include glob).

- **`proofArtifactHarvester`** (`harvestProofArtifacts`) — temp-dir fixtures asserting the returned image-path set:
  - empty dir → `[]`; missing dir → `[]`.
  - nested directories → recursive discovery with correct `relPath`s.
  - mixed extensions → only image extensions returned (`.txt`/`.xml`/`.md`/extensionless excluded); case-insensitive (`.PNG`).
  - deterministic ordering.
- **`prProofPublisher`** (pure `formatPrProofComment`) — given summary (`tagResults` with `counts`) + uploaded R2 URLs, assert the expected markdown:
  - inline embed exactly `[![name](url)](url)` + raw-URL fallback line.
  - collapsible `<details>` grouped per scenario with correct counts; flat images → single `Screenshots` group.
  - JUnit summary table rows (passed/failed/skipped, `{passed}/{total}`).
  - summary-only when no screenshots; "R2 not configured" note when `r2Configured` is false and there are no uploads.
- Follow the project's test philosophy (`.adw/coding_guidelines.md` "Testing", and the PRD "Testing Decisions"): **assert external behavior through the public interface** (returned paths, returned markdown), never private helpers or call sequencing. Keep the harvester and the formatter pure so they are testable without mocks; isolate R2/GitHub side effects in `publishPrProof` (tested, if at all, via injected fakes — not over-mocked).

### Edge Cases
- Proof directory missing or empty (CLI repos like ADW-self that produce no screenshots) → summary-only comment, no error.
- Nested per-scenario sub-directories vs. flat image files → grouping handles both.
- Non-image files in the proof dir (JUnit `.xml`, `scenario_proof.md`, logs) → excluded by the harvester.
- R2 not configured (missing `CLOUDFLARE_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) → skip uploads, post summary-only with a note; never throw.
- A single image upload fails (network/credentials) → that image is skipped, the rest still publish.
- No PR (e.g. `ctx.prUrl` unset / `extractPrNumber` returns 0) → phase no-ops.
- Stale images from a previous scenario retry → cleared by `rmSync` before each run, so only the final attempt's images are published.
- Scenario run had blocker failures → still publish (failure screenshots are valuable); the summary shows ❌.
- Duplicate file names across scenarios → R2 keys are namespaced by `relPath` (which includes the scenario sub-dir), avoiding collisions.

## Acceptance Criteria
- `harvestProofArtifacts` globs the proof directory and returns image paths; unit-tested for empty, nested, and mixed-extension inputs (returns `[]` for empty/missing).
- Harvested images are uploaded to R2 via the existing `uploadToR2`, producing public `https://screenshots.paysdoc.nl/...` URLs (verified by the wiring and by unit tests with an injected uploader).
- A proof **comment** is posted to the PR containing a pass/fail JUnit summary plus inline screenshots, grouped under collapsible `<details>` per scenario, each with its raw R2 link as a fallback.
- `prProofPublisher`'s formatting (`formatPrProofComment`) is unit-tested (inline embeds, collapsible per-scenario grouping, link fallback, summary table, summary-only fallback).
- The publish phase is non-fatal: any harvest/upload/post failure is logged and the workflow continues.
- `ADW_PROOF_DIR` is exported into the scenario subprocess environment and the harvest directory is cleared before each scenario run.
- All validation commands pass with zero regressions (lint, type-checks, unit tests, build, `@regression` BDD suite).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — ESLint over the repo (catches nesting/`any`/unused-import violations).
- `bunx tsc --noEmit` — root type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type-check (new module + phase + barrels).
- `bun run test:unit` — Vitest unit suite, including the new `adws/proof/__tests__/proofArtifactHarvester.test.ts` and `adws/proof/__tests__/prProofPublisher.test.ts`, plus existing `scenarioProof`/`scenarioTestPhase` tests (verify no regression from the `artifactsDir`/`ADW_PROOF_DIR` change).
- `bun run build` — `tsc` build to confirm no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — ADW-self regression suite stays green (the `scenarioProof` change must not break the self-hosted rail; a clean JUnit tally is expected even if the subprocess exits non-zero on post-suite noise).

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep the harvester and formatter **pure** (same input → same output, no I/O); isolate all side effects (fs read, R2 upload, GitHub post) in `publishPrProof` and the phase. Use guard clauses and max-depth-2 nesting; extract per-image / per-scenario rendering into named helpers. Keep every new file under 300 lines. Prefer explicit `readonly` types; avoid `any`.
- **No new library required.** `@aws-sdk/client-s3` (R2) and `fast-xml-parser` (JUnit) are already dependencies; the recursive image glob uses Node's `fs` with an iterative stack walk (no new dep). If a dependency ever is needed, the install command is `bun add <package>` (`.adw/commands.md`).
- **Hash propagation does NOT apply here.** Per the PRD "Hash propagation / emit-parse coupling rule", only adding/renaming a parsed `.adw/` field requires an `adw_init.md` change to move `.adw-version`. This feature adds **framework code** (`adws/proof/`, a phase, orchestrator wiring) and an **exported env var convention** (`ADW_PROOF_DIR`) — not a parsed `.adw/` config field — so no `adw_init.md` edit and no regeneration ripple. Framework code takes effect immediately on merge.
- **Why a PR comment, not the description:** the PR description is written by `prAgent` before proof exists; proof is therefore surfaced as a comment posted by `executeProofPublishPhase` after `executePRPhase`. This matches PRD "PR proof surfacing".
- **Screenshot *production* is out of scope for this slice.** This feature harvests, uploads, and publishes whatever images land in `ADW_PROOF_DIR`. Teaching generated step definitions / runner config to *write* screenshots there is the polymorphic `generate_step_definitions.md` / `scenario_writer.md` work, explicitly deferred in the #578 doc and the PRD's "Prompts modified" section. ADW-self (CLI, no browser) will therefore produce summary-only proof comments — correct and sufficient for this slice; the screenshot-bearing path is covered by unit tests and validated on a real UI target (vestmatic) via fix-forward.
- **Builds directly on #578 (the blocker, merged):** reuse `TagProofResult.counts` / `cases` and `readJUnitReport` rather than re-parsing. The existing `adws/github/proofCommentFormatter.ts` is the *review* comment and is intentionally left unchanged; `prProofPublisher` is the distinct BDD-proof comment for the PR.
- **`ADW_PROOF_DIR` is an absolute path** resolved from the orchestrator cwd (like `ADW_JUNIT_REPORT_PATH`), even though the scenario subprocess runs with `cwd: worktreePath` — so the writer (subprocess step defs) and the reader (harvester) agree on one location regardless of cwd.
- **Future consideration:** once the generation prompts write screenshots, consider also surfacing the proof comment for the `adwChore` fast-path and `adwPrReview` flows if they begin running UI BDD; the phase is already defensive enough to drop in.
