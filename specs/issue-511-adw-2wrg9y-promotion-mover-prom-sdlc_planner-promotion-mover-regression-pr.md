# Feature: Promotion Mover — @promotion tag opens a separate regression-promotion PR

## Metadata
issueNumber: `511`
adwId: `2wrg9y-promotion-mover-prom`
issueJson: `{"number":511,"title":"Promotion mover — @promotion tag opens separate PR moving scenario to regression dir + README docs","body":"## Parent PRD\n\n`specs/prd/scenario-rot-prevention-and-promotion.md`\n\n## What to build\n\nAdd the `promotionMover` orchestrator that completes the HITL promotion loop:\n\n1. **Detection** — on per-issue PR events, scan `.feature` files for the `@promotion` tag (no date suffix). This is the human approval signal.\n2. **Move** — for each detected scenario, open a separate PR that moves the scenario block from the per-issue file into the regression directory (resolved from `.adw/scenarios.md`). The `@promotion` tag is stripped in the destination.\n3. **Label** — apply the `regression-promotion` label to the new PR so its purpose is visible in PR lists.\n\n### README documentation (bundled per design discussion)\n\nDocument the full tag vocabulary and human edit gate in the project README:\n\n- `@promotion-suggested-<date>` — agent-applied; signals \"this scenario crossed the threshold\"\n- `@promotion` — human-applied (by editing the suggested tag); signals \"move this into regression\"\n- The agent move mechanism (separate PR with `regression-promotion` label)\n- The 14-day sweep behaviour for ignored suggestions\n\n## Acceptance criteria\n\n- [ ] `promotionMover` orchestrator implemented and wired into the per-issue PR event entry point alongside `promotionCommenter`\n- [ ] Editing `@promotion-suggested-<date>` to `@promotion` on a per-issue file produces (on the next agent run) a new PR moving the scenario into `features/regression/`\n- [ ] The destination scenario has the `@promotion` tag stripped\n- [ ] The new PR carries the `regression-promotion` label\n- [ ] README documents both `@promotion-suggested-<date>` and `@promotion` tags, the human edit gate, and the resulting move PR\n- [ ] Smoke scenario under `features/regression/` covers the detection → move flow through the mock harness\n\n## Blocked by\n\n- Blocked by #509\n\n## User stories addressed\n\n- User story 11 (approval via tag edit, not deletion)\n- User story 12 (agent moves on separate PR)\n- User story 26 (regression-promotion label on the move PR)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-05-20T22:45:16Z","comments":[],"actionableComment":null}`

## Feature Description

This slice ships the `promotionMover` half of the HITL promotion loop described in `specs/prd/scenario-rot-prevention-and-promotion.md`. Issue #509 (merged via PR #517) landed `promotionCommenter`: per-issue PR events score scenarios against the vocabulary registry and add a `@promotion-suggested-<date>` tag plus a PR comment when the score clears the threshold. The piece this slice adds is the **mover**: when a human edits `@promotion-suggested-<date>` to bare `@promotion` (no date suffix) on a per-issue scenario, the next agent run opens a *separate* PR that physically moves the scenario block out of `features/per-issue/feature-{N}.feature` into the regression directory resolved from `.adw/scenarios.md`, with the `@promotion` tag stripped in the destination, and applies the `regression-promotion` label to that new PR.

The slice piggybacks on the existing `adwPromotionSweep.tsx` CLI entry point (already wired into the `promotion-sweep` orchestrator key in `features/regression/step_definitions/whenSteps.ts`): the orchestrator now runs commenter-then-mover on every per-issue PR event, so the same invocation that suggests promotions also acts on previously-approved ones.

Two new deep modules join the existing pure-function suite under `adws/promotion/`:

- **`promotionApprovalDetector`** — pure query over scenario tags, returning the line ranges of `@promotion`-approved scenarios in a `.feature` file (and ignoring `@promotion-suggested-<date>` ones).
- **`promotionTagWriter`** gains two new operations — `'remove-suggestion'` (strips `@promotion-suggested-<date>`) and `'strip-approval'` (strips `@promotion`) — so the moved scenario block can be cleansed before insertion into the regression file.

A new thin coordination layer `promotionMover` composes the deep modules and owns all GitHub/git/filesystem side effects (creating the move branch off the default branch, slicing the scenario block out of the per-issue file, inserting it into the destination regression file, committing, pushing, opening the PR with the `regression-promotion` label). `adwPromotionSweep.tsx` is extended to call `runPromotionMover` after `runPromotionCommenter`.

The README gains a "Scenario Promotion" subsection (under Testing) that documents the full tag vocabulary, the human edit gate, the resulting move PR shape, and the 14-day sweep behaviour for ignored suggestions.

## User Story

As an ADW developer
I want to approve a per-issue scenario for promotion by editing its `@promotion-suggested-<date>` tag to `@promotion`
So that the next agent run opens a separate PR (labelled `regression-promotion`) moving the scenario into `features/regression/` with the approval tag stripped, completing the HITL promotion loop without me having to hand-curate the file move myself.

## Problem Statement

After issue #509 merged, the framework can *suggest* scenarios for promotion (commenter adds `@promotion-suggested-<date>` and posts a PR comment) but it cannot *act* on a human's approval. The PRD specifies that approval is signalled by editing the suggested tag to bare `@promotion`. Without the mover:

- Approved scenarios stay in `features/per-issue/` and are eventually deleted by the 14-day sweep, losing the work.
- The team has to hand-curate the file move (cut the scenario block from the per-issue file, paste into a regression file, strip the tag, open a PR), which is exactly the friction the PRD was designed to remove.
- The 90-day promotion-activity ratio that drives the auto-ramp threshold (slice #7) cannot be observed because the regression-bound PRs that drive the numerator never get opened.
- The `regression-promotion` label that user story 26 specifies cannot exist on any real PR.
- The README does not yet document either tag (commenter docs were not bundled with slice #4), so an operator inheriting a repo has no written rubric for the approve-via-edit gate.

## Solution Statement

Three additions, all bounded:

1. **Extend `promotionTagWriter` with two pure string-transform operations.** `'remove-suggestion'` strips `@promotion-suggested-<YYYY-MM-DD>` tokens from the tag block immediately above a scenario header; `'strip-approval'` strips bare `@promotion` tokens. Byte-exact preservation of surrounding content is the test contract, mirroring the existing `'add-suggestion'` operation.

2. **Add `promotionApprovalDetector`** — a pure function `detectApprovals(content: string): ApprovedScenario[]` that returns the line range and header line of each scenario whose tag block contains bare `@promotion` (no date suffix). This is the read-only counterpart to `applyTagState` and is what the mover consumes to decide which scenarios to move.

3. **Add `promotionMover`** — a thin coordination layer that, for each approved scenario in a per-issue file:
   - resolves the destination regression directory from `.adw/scenarios.md` (`## Regression Scenario Directory`)
   - chooses a destination filename inside that directory (`promoted-from-feature-{issueNumber}-{slug}.feature`, where `slug` is derived from the scenario name)
   - creates a fresh branch off the default branch (e.g., `regression-promotion-issue-{issueNumber}-{slug}`) in a *new* worktree (so the active per-issue worktree is not perturbed)
   - in that worktree, removes the scenario block from the per-issue file (with `'remove-suggestion'` + `'strip-approval'` applied to clean up any stale tags), writes the scenario (with `@promotion` stripped) into the destination regression file, commits both changes
   - pushes the branch and opens a separate PR with the `regression-promotion` label applied at creation time (`gh pr create --label regression-promotion`)
   - returns a result list so the caller can log and the smoke tests can assert

`adwPromotionSweep.tsx` is extended to invoke `runPromotionMover(prNumber, deps)` after `runPromotionCommenter(prNumber, deps)`. Both run on the same per-issue PR event; the commenter creates suggestions, the mover consumes approvals. Idempotency: if the move PR already exists for a given scenario (detected via existing-PR lookup by branch name), the mover skips silently. The orchestrator stays event-driven and short-lived — still no `runWithOrchestratorLifecycle` wrapper (deferred per the same slice-#5 decision recorded in `app_docs/feature-tdauam-promotion-commenter-deep-modules.md`).

The README gains a "Scenario Promotion" subsection under the existing `## Testing` block describing the two tags, the human edit gate, the move PR, and the 14-day sweep behaviour for ignored suggestions. This is the only README change in this slice; documentation for `promotionCommenter` lives in the bundled README update too, since #509 did not bundle it.

The smoke scenario shape mirrors the existing `features/regression/smoke/promotion_commenter.feature` pending pattern: subprocess invocation of the `promotion-sweep` orchestrator with a pre-seeded manifest, recorded mock-API assertions on PR creation and label application. Per-issue BDD scenarios already exist in `features/per-issue/feature-511.feature` (8 scenarios) and their pending step definitions land under `features/per-issue/step_definitions/feature-511.steps.ts`.

## Relevant Files

Use these files to implement the feature:

### Read-only references (existing code/docs informing the design)

- `specs/prd/scenario-rot-prevention-and-promotion.md` — Parent PRD. **Sections to load**: Solution (HITL gate + mover), User stories 11/12/26, Modules (`promotionMover` orchestrator + `promotionTagWriter` extensions), State storage (no external state file — `@promotion` lives in the .feature), Out of Scope (no automatic promotion, no cron sweep for mover).
- `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` — Slice #4 (issue #509) documentation. Background for the deep-module layout under `adws/promotion/` and the `adwPromotionSweep.tsx` orchestrator shape. Lists the deferred items this slice picks up: `hitl` label apply (deferred — not included here either; PRD §11/12 only requires the `regression-promotion` label on the move PR), date-refresh/tag-removal operations on `promotionTagWriter`, `@promotion` approval detection, `promotionMover` orchestrator.
- `app_docs/feature-oobdbg-bdd-cutover-polymorphic-prompts-sweep.md` — Per-issue scenario sweep / polymorphism flags. Confirms `## Regression Scenario Directory` in `.adw/scenarios.md` is the source of truth for the destination directory.
- `features/per-issue/feature-511.feature` — Pre-written per-issue BDD acceptance scenarios for this issue (8 scenarios, lines 1–157). The implementation must satisfy these from the operator's perspective; step definitions for them land as pending stubs in this slice (see `features/per-issue/step_definitions/feature-509.steps.ts` for the pattern to copy).
- `features/per-issue/step_definitions/feature-509.steps.ts` — Reference for the pending-stub step-definition style used for per-issue BDD scenarios that depend on subprocess invocation (currently blocked by the ISSUE-3-CUTOVER stub in `whenSteps.ts`).
- `features/regression/smoke/promotion_commenter.feature` — Reference for the smoke-scenario shape (`@regression @smoke`, Background with G1/G4/G11, manifest-driven claude-cli-stub, W1 invocation, assertions on recorded mock-API calls). The new mover smoke scenarios follow the same shape.
- `features/regression/step_definitions/whenSteps.ts` — `ORCHESTRATOR_FILES` map (lines 53–66) already contains `'promotion-sweep': 'adwPromotionSweep.tsx'` from slice #4; no change. The W1 `the {string} orchestrator is invoked ...` step is still gated by the ISSUE-3-CUTOVER `return 'pending';` — smoke scenarios remain pending until the harness gains live subprocess support, which this slice does not unblock.
- `features/regression/vocabulary.md` — Phrase registry. The mover-smoke assertions reuse existing T2/T7/T8 (recorded comment, recorded zero merge, recorded PR creation). No new vocabulary phrases are added; new per-issue Then steps (PR creation, label application, regression-bound artefact assertions) are documented in pending step definitions, not the vocabulary file (consistent with the slice-#4 pattern).
- `adws/promotion/index.ts` — Barrel export. Extended to re-export `runPromotionMover`, `detectApprovals`, and the new `TagState` union members.
- `adws/promotion/types.ts` — Shared types. `TagState` is widened from `'add-suggestion'` to a union including `'remove-suggestion' | 'strip-approval'`. A new `ApprovedScenario` interface is added (`{ headerLine: number; startLine: number; endLine: number; scenarioName: string }`).
- `adws/promotion/promotionCommenter.ts` — Reference for the orchestrator-coordination shape (dep-injection interface, `PER_ISSUE_RE` filter, content threading across multiple scenarios in one file). The mover follows the same pattern.
- `adws/promotion/promotionTagWriter.ts` — The existing `applyTagState` walks backward from a scenario header to find the contiguous tag block. The same line-walking primitive supports the two new operations.
- `adws/promotion/scenarioParser.ts` — Returns `Scenario[]` with `tags`, `startLine`, `endLine`, and `headerLine`. The mover consumes `startLine` and `endLine` to slice the scenario block out of the per-issue file. (Reads from `tags[]` for the approval detector.)
- `adws/adwPromotionSweep.tsx` — Existing CLI entry point. Extended to invoke `runPromotionMover` after `runPromotionCommenter` and to build the mover's default deps from `getRepoInfo()`/`gh` calls.
- `adws/promotion/promotionCommenter.ts` (existing 93-line file) — Confirms the dependency-injection style: explicit `Deps` interface with all I/O wrapped behind callable dependencies (`loadVocabulary`, `fetchChangedFiles`, `readFile`, `writeFile`, `postComment`, `today`, `log`). The mover follows the same pattern with its own dep set (see "New Files" below).
- `adws/github/prApi.ts` — `defaultFindPRByBranch` (lines 21–32), `commentOnPR` (lines 196–208). The mover uses `defaultFindPRByBranch` to detect existing move PRs (idempotency).
- `adws/providers/github/githubCodeHost.ts` — `createPullRequest` (lines 80–125) writes the PR body to a temp file, calls `gh pr create --title ... --body-file ... --base ... --head ... --repo ...`. The mover calls `gh pr create` directly (via `execWithRetry`) with `--label regression-promotion` because the mover does not run inside the orchestrator-aware PR creation pipeline used by `adwSdlc.tsx`. The CodeHost wrapper is not extended in this slice (kept narrow per PRD; an `addLabel` field on `CreatePROptions` could land later if Jira/GitLab parity is needed).
- `adws/github/githubApi.ts` — `getRepoInfo()` resolves `{ owner, repo }` from git remote. Same usage as `adwPromotionSweep.tsx`.
- `adws/vcs/branchOperations.ts` — `getDefaultBranch()` (lines 146–162), `generateBranchName` (lines 89–97), `validateSlug` (lines 31–75). The mover assembles its own branch name (`regression-promotion-issue-{issueNumber}-{slug}`) without going through `generateBranchName` because the `regression-promotion` prefix is not in `branchPrefixMap`. The mover constructs the branch name directly using a sluggified scenario name; it must not use `validateSlug` against the assembled name because the `regression-promotion-` prefix would trip the "forbidden prefix" check — slug validation is applied only to the sluggified scenario portion.
- `adws/vcs/worktreeCreation.ts` — `createWorktreeForNewBranch` (lines 181–211) creates a fresh worktree at `.worktrees/<branch>` and returns the path. The mover uses this to isolate the move from the active per-issue worktree.
- `adws/vcs/commitOperations.ts` — `commitChanges` (lines 21–38) stages and commits, `pushBranch` (lines 45–48) pushes with upstream tracking. The mover composes these for the regression-bound branch.
- `adws/triggers/perIssueScenarioSweep.ts` — Reference for a small dependency-injected event module that operates on `features/per-issue/feature-{N}.feature` files. Confirms the `PER_ISSUE_DIR`/`FEATURE_FILENAME_RE` pattern.
- `adws/core/projectConfig.ts` — `ScenariosConfig.regressionScenarioDirectory` (lines 42–43) and `vocabularyRegistry` (lines 44–45). The mover reads `regressionScenarioDirectory` to resolve the destination directory (falls back to `features/regression/` if absent, consistent with the `.adw/scenarios.md` polymorphism contract).
- `adws/core/orchestratorCli.ts` — `parseOrchestratorArguments` for CLI arg parsing. Already consumed by `adwPromotionSweep.tsx`; no change.
- `adws/core/utils.ts` — `execWithRetry`, `log`. The mover calls `execWithRetry` for `gh pr create` (so non-retryable patterns like "already exists" short-circuit, matching the rest of ADW).
- `adws/core/index.ts` — Barrel re-exports for `log`, `execWithRetry`, `LogLevel`.
- `adws/promotion/__tests__/promotionTagWriter.test.ts` — Existing tests (96 lines, six describe blocks). Extended with `'remove-suggestion'` and `'strip-approval'` cases following the same byte-exact preservation pattern.
- `adws/promotion/__tests__/scenarioParser.test.ts` — Reference for parsing assertions; consumed indirectly by the mover.
- `adws/promotion/__tests__/promotionCommenter.test.ts` — Reference for orchestrator-coordination unit tests (dep injection, `vi.fn()` mocks for `writeFile`/`postComment`). The new mover unit tests follow the same shape.
- `cucumber.js` — Cucumber paths/imports config. No change; new `.feature` files and step definitions under `features/per-issue/step_definitions/` are picked up automatically (the `features/per-issue/` directory is intentionally excluded from the `@regression` runner — scenarios there are agent-input, not executed).
- `vitest.config.ts` — Vitest config (`adws/**/__tests__/**/*.test.ts`). New unit tests are picked up automatically.
- `.adw/project.md` — Confirms `## Unit Tests: enabled` (line 34); unit tests are required for this slice.
- `.adw/scenarios.md` — Polymorphism flags. The mover reads `## Regression Scenario Directory` (line 25) to resolve the destination.
- `.adw/coding_guidelines.md` — Mandatory coding guidelines (TypeScript strict, no `any`, guard clauses, max nesting depth ~2, declarative over imperative, isolate side effects, files under 300 lines). Strictly followed.
- `app_docs/feature-mzgyjj-rot-prevention-block.md` — Slice #1 (issue #506) docs. Background for the rot-prevention rubric; not directly extended here.
- `app_docs/feature-nnny1e-vocabulary-template-and-flags.md` — Slice #2 (issue #507) docs. Background for the per-issue/regression directory polymorphism flags that the mover consumes.
- `README.md` — Updated to add the "Scenario Promotion" subsection under `## Testing`. The existing `## Testing` heading is at line 289 and the BDD scenario layout subsection at line 295; the new subsection inserts after the scenario layout block.

### New Files

#### Deep modules (extensions to `adws/promotion/`)

- `adws/promotion/promotionApprovalDetector.ts` — Pure function `detectApprovals(content: string): ApprovedScenario[]`. Parses the file via `scenarioParser`, filters to scenarios whose `tags` contain bare `@promotion` (i.e., the `@promotion` token exactly, NOT `@promotion-suggested-<date>`), and returns `{ headerLine, startLine, endLine, scenarioName }` for each. The regex check is strict (`^@promotion$`) so `@promotion-suggested-2026-05-21` is correctly excluded.

#### Orchestrator coordination layer

- `adws/promotion/promotionMover.ts` — Thin coordination module. Exports `runPromotionMover(prNumber: number, deps: PromotionMoverDeps): Promise<PromotionMoverResult>`. All I/O behind injected deps: `fetchChangedFiles`, `readFile`, `writeFile`, `getDefaultBranch`, `createWorktree`, `commitChanges`, `pushBranch`, `findExistingPR`, `createPR` (returns `{ number, url }`), `applyLabel`, `loadScenariosConfig`, `today`, `log`. The default factory in `adwPromotionSweep.tsx` wires these to the real implementations. The result shape returns `MovedScenarioResult[]` with `{ sourcePath, destPath, scenarioName, branchName, prNumber, prUrl, skipped }`.

#### Unit tests (extensions/additions under `adws/promotion/__tests__/`)

- `adws/promotion/__tests__/promotionApprovalDetector.test.ts` — Happy path: a file with one `@promotion`-tagged scenario returns one entry. Edge cases: (a) `@promotion-suggested-<date>` alone returns empty; (b) mixed tag block `@adw-509 @promotion-suggested-2026-05-21 @promotion` returns one (the bare `@promotion` is present); (c) multiple approved scenarios return ordered by `headerLine`; (d) no scenarios returns empty; (e) malformed Gherkin propagates a parser exception (matches `scenarioParser` contract).
- `adws/promotion/__tests__/promotionMover.test.ts` — Dep-injection style mirroring `promotionCommenter.test.ts`. (a) single approved scenario → `createWorktree`/`writeFile`/`commitChanges`/`pushBranch`/`createPR`/`applyLabel` called once with expected args; (b) no approved scenarios → none of the side-effect deps called; (c) only `@promotion-suggested-<date>` (no bare `@promotion`) → no calls; (d) multiple approved scenarios in one file → multiple side-effect call chains, one per scenario, with distinct branch names; (e) `findExistingPR` returns a hit → skip silently (idempotency); (f) per-issue file removal still occurs alongside regression-file insertion (verified by inspecting the `writeFile` mock call args); (g) destination directory falls back to `features/regression/` when `loadScenariosConfig` returns `regressionScenarioDirectory: undefined`; (h) moved scenario in destination has `@promotion` stripped; (i) moved scenario in destination has any `@promotion-suggested-<date>` also stripped; (j) non-per-issue files in the PR diff are skipped (mirrors the `PER_ISSUE_RE` filter from the commenter); (k) deleted per-issue file is skipped.
- `adws/promotion/__tests__/promotionTagWriter.test.ts` — Extended with seven new tests: (a) `'remove-suggestion'` strips `@promotion-suggested-2026-05-21` from a tag line and preserves other tags on the same line; (b) `'remove-suggestion'` is a no-op when no suggestion tag is present; (c) `'remove-suggestion'` strips every `@promotion-suggested-<date>` on the line (multiple datestamps); (d) `'strip-approval'` strips bare `@promotion` from a tag line; (e) `'strip-approval'` is a no-op when only `@promotion-suggested-<date>` is present (does not strip the date-suffixed variant); (f) byte-exact preservation of all non-tag lines for both new states; (g) supported `TagState` set now matches the widened union (the old "unsupported state" test is updated accordingly).

#### Smoke scenarios

- `features/regression/smoke/promotion_mover.feature` — Tagged `@regression @smoke`. Background mirroring `promotion_commenter.feature` (G1, G4, G11). Two scenarios: (a) high-signal `@promotion` (no date) feature → recorded PR creation on a regression-promotion-prefixed head branch + recorded label application of `regression-promotion`; (b) `@promotion-suggested-<date>` only (no bare `@promotion`) → zero PR creation calls (and zero recorded comments other than the suggestion comment from the commenter half). The W1 step remains pending behind the ISSUE-3-CUTOVER stub — the scenario shape is the documented contract for the next cutover.

#### Per-issue BDD step definitions (pending stubs)

- `features/per-issue/step_definitions/feature-511.steps.ts` — Pending stubs (return `'pending'`) for every step in `features/per-issue/feature-511.feature` that is not already defined elsewhere. Includes a `@adw-511`-scoped Before/After block that calls `setupMockInfrastructure` / `teardownMockInfrastructure` (mirrors the `feature-509.steps.ts` pattern). New step phrases to stub: (a) `Given the mock GitHub API is configured to accept PR creation`, (b) `Given the mock GitHub API is configured to accept label application`, (c) `Then the mock GitHub API recorded a PR creation distinct from the per-issue PR for issue {int}`, (d) `Then the mock GitHub API recorded zero PR creation calls modifying the per-issue PR head branch for issue {int}`, (e) `Then the mock GitHub API recorded a label application of {string} on the move PR opened by promotionMover`, (f) `Then the regression-bound artefact file produced by promotionMover for adwId {string} contains the seeded scenario from fixture {string}`, (g) `Then the regression-bound artefact file produced by promotionMover for adwId {string} carries no {string} tag on the moved scenario`, (h) `Then the per-issue artefact file at {string} on the move branch produced by promotionMover for adwId {string} no longer contains the moved scenario block`, (i) `Then the mock harness recorded zero move PRs opened by promotionMover for adwId {string}`, (j) `Then the mock harness recorded {int} move PR(s) opened by promotionMover for adwId {string}`, (k) `Then every move PR opened by promotionMover for adwId {string} carries the {string} label`, (l) `Then the per-issue artefact file at {string} on the move branch produced by promotionMover for adwId {string} still contains every scenario tagged {string}`. Each step body is `return 'pending';` (no live assertion — the harness's subprocess support is still gated by ISSUE-3-CUTOVER per `whenSteps.ts:80`).

#### Mock manifest fixtures

- `test/fixtures/jsonl/manifests/promotion-mover-single-move.json` — Pre-seeds a per-issue file containing one `@promotion`-tagged scenario; manifest's `edits[]` writes both the Claude stub payload (a single-text envelope) and the per-issue feature file content (mirrors `promotion-sweep-high-score.json`).
- `test/fixtures/jsonl/manifests/promotion-mover-labeled.json` — Variant of the above used by the label scenario.
- `test/fixtures/jsonl/manifests/promotion-mover-strip-tag.json` — Variant pre-seeding a scenario carrying `@promotion-suggested-2026-05-15 @promotion` so the strip-both assertion can run.
- `test/fixtures/jsonl/manifests/promotion-mover-removes-source.json` — Variant for the "per-issue file no longer contains the moved scenario block" assertion.
- `test/fixtures/jsonl/manifests/promotion-mover-suggested-only.json` — Pre-seeds a scenario carrying only `@promotion-suggested-<date>` (no bare `@promotion`); the orchestrator should record zero PR creations.
- `test/fixtures/jsonl/manifests/promotion-mover-no-action.json` — Pre-seeds a scenario with no promotion tags at all.
- `test/fixtures/jsonl/manifests/promotion-mover-multiple-approvals.json` — Pre-seeds a file with two `@promotion`-tagged scenarios; one move PR per scenario expected.
- `test/fixtures/jsonl/manifests/promotion-mover-mixed-tags.json` — Pre-seeds a file with one `@promotion` (move) and one `@promotion-suggested-<date>` (stay); only one move PR expected.

#### Documentation

- App-feature doc deferred to the documentation phase (build agent + `/document` slash command will produce `app_docs/feature-2wrg9y-promotion-mover-regression-pr.md` after merge). The README update lives in the codebase change itself.

## Implementation Plan

### Phase 1: Foundation

Extend the shared types and the existing `promotionTagWriter` to support the two new operations needed by the mover. These changes are isolated, do not touch any orchestrator wiring, and unblock the deep-module additions in Phase 2.

Concretely:
- Widen `TagState` in `adws/promotion/types.ts` from a single literal `'add-suggestion'` to the union `'add-suggestion' | 'remove-suggestion' | 'strip-approval'`.
- Add the `ApprovedScenario` interface in `types.ts`.
- Extend `applyTagState` in `adws/promotion/promotionTagWriter.ts` to dispatch on the new operations. Both new operations walk the same tag-line block already used for `'add-suggestion'`; they remove the relevant token (and collapse the resulting double-spaces) without disturbing any other tag on the line. If the tag line becomes empty after removal, the line is deleted.
- Extend `adws/promotion/__tests__/promotionTagWriter.test.ts` with the seven new cases.

This phase ships green tests for the tag writer extensions and keeps the existing `'add-suggestion'` contract identical (no behavioural change for `promotionCommenter`).

### Phase 2: Core Implementation (Deep Module + Pure Logic)

Implement `promotionApprovalDetector` as a pure function on top of `scenarioParser`. The detector returns a list of approved scenarios with their `startLine`/`endLine`/`headerLine`/`scenarioName`. This is the read-only counterpart to `applyTagState` and is the *only* signal the mover needs to decide which scenarios to act on.

Phase 2 also extends the barrel export in `adws/promotion/index.ts` to surface `detectApprovals` (and the new types). No GitHub or filesystem I/O yet — everything in Phase 2 is pure.

Concretely:
- `adws/promotion/promotionApprovalDetector.ts` — `detectApprovals(content: string): ApprovedScenario[]`. Implementation: parse via `scenarioParser`, filter to scenarios where `tags` contains exactly `@promotion` (regex `/^@promotion$/`), map to `{ headerLine, startLine, endLine, scenarioName }` where `scenarioName` comes from the Gherkin AST scenario name (added to `scenarioParser` if not already exposed — verify the existing parser's return shape first; if `name` is not present, add it to the `Scenario` interface and the parser's `mapScenario` function).
- `adws/promotion/__tests__/promotionApprovalDetector.test.ts` — Five cases as listed in "New Files".

### Phase 3: Integration (Mover Coordination + Orchestrator Wiring + Smoke + README)

Compose the deep modules + tag writer + I/O into `runPromotionMover`. Wire it into `adwPromotionSweep.tsx` after `runPromotionCommenter`. Add the smoke scenario and the per-issue pending step definitions. Update the README.

The mover's algorithm (purely defined inside `promotionMover.ts`, no embedded I/O beyond injected deps):

```
runPromotionMover(prNumber, deps):
  changedFiles = deps.fetchChangedFiles(prNumber)
  results = []
  for file in changedFiles:
    if not PER_ISSUE_RE.test(file.path): continue
    if file.status === 'removed': continue
    content = deps.readFile(file.path)
    approved = detectApprovals(content)
    if approved.length === 0: continue
    issueNum = extractIssueNumberFromPath(file.path)
    scenariosConfig = deps.loadScenariosConfig()
    destDir = scenariosConfig.regressionScenarioDirectory ?? 'features/regression/'
    defaultBranch = deps.getDefaultBranch()
    for scenario in approved:
      slug = slugify(scenario.scenarioName)
      branchName = `regression-promotion-issue-${issueNum}-${slug}`
      existing = deps.findExistingPR(branchName)
      if existing: { results.push({...skipped: true, prUrl: existing.url}); continue }
      worktreePath = deps.createWorktree(branchName, defaultBranch)
      // 1) write per-issue file without the scenario block
      perIssueAfter = removeScenarioBlock(content, scenario)
      perIssueAfter = applyTagState(perIssueAfter, ..., 'remove-suggestion', today)  // best-effort cleanup
      deps.writeFile(joinPath(worktreePath, file.path), perIssueAfter)
      // 2) write regression file with the scenario block, @promotion stripped
      destPath = joinPath(destDir, `promoted-from-feature-${issueNum}-${slug}.feature`)
      destContent = renderRegressionFile(scenario.block, issueNum) // scenario block with @promotion & @promotion-suggested-* stripped
      deps.writeFile(joinPath(worktreePath, destPath), destContent)
      // 3) commit + push + open PR + label
      deps.commitChanges(worktreePath, `regression-promotion: promote "${scenario.scenarioName}" from feature-${issueNum}`)
      deps.pushBranch(worktreePath, branchName)
      { prNumber, prUrl } = deps.createPR({ branch: branchName, base: defaultBranch, label: 'regression-promotion', title, body })
      results.push({ sourcePath: file.path, destPath, scenarioName: scenario.scenarioName, branchName, prNumber, prUrl, skipped: false })
  return { moved: results }
```

The default deps factory in `adwPromotionSweep.tsx` wires these to `getDefaultBranch`/`createWorktreeForNewBranch`/`commitChanges`/`pushBranch`/`defaultFindPRByBranch`/`execWithRetry('gh pr create --label regression-promotion ...')`. The factory passes the active worktree path (`process.cwd()`) as the `baseRepoPath` to `createWorktreeForNewBranch` so the new move worktree lives in the same `.worktrees/` parent.

The README "Scenario Promotion" subsection is added under `## Testing` after the BDD scenario layout block. Content (concrete paragraph list):
- One paragraph defining `@promotion-suggested-<date>` (agent-applied, scoring above threshold).
- One paragraph defining `@promotion` (human-applied via edit, signals "move this into regression").
- One paragraph describing the agent move mechanism: separate PR opened on the next per-issue PR event, branch named `regression-promotion-issue-{N}-{slug}`, labelled `regression-promotion`, body links back to the per-issue PR.
- One paragraph describing the 14-day sweep behaviour for ignored suggestions (link to `app_docs/feature-oobdbg-bdd-cutover-polymorphic-prompts-sweep.md`).
- One paragraph noting the orchestrator CLI invocation: `bunx tsx adws/adwPromotionSweep.tsx <issueNumber> [adwId]` runs both halves (commenter, then mover).

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read existing slice-#4 surfaces

- Read `adws/promotion/types.ts` and `adws/promotion/promotionTagWriter.ts` end-to-end (small files, no skimming).
- Read `adws/promotion/promotionCommenter.ts` and `adws/promotion/scenarioParser.ts` end-to-end.
- Read `adws/adwPromotionSweep.tsx` end-to-end.
- Read `features/regression/smoke/promotion_commenter.feature` and `features/per-issue/feature-509.feature`.
- Read `features/per-issue/feature-511.feature` end-to-end (the acceptance contract for this slice — every scenario there must be satisfied by the resulting code).

### Step 2: Widen `TagState` and add `ApprovedScenario` in `types.ts`

- Edit `adws/promotion/types.ts`.
- Replace `export type TagState = 'add-suggestion';` with `export type TagState = 'add-suggestion' | 'remove-suggestion' | 'strip-approval';`.
- Add `export interface ApprovedScenario { headerLine: number; startLine: number; endLine: number; scenarioName: string; }`.
- Add `export interface MovedScenarioResult { sourcePath: string; destPath: string; scenarioName: string; branchName: string; prNumber: number | null; prUrl: string | null; skipped: boolean; }`.
- Add `export interface PromotionMoverResult { moved: MovedScenarioResult[]; }`.
- Confirm `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` still pass.

### Step 3: Extend `scenarioParser` to expose `scenarioName`

- Read the existing `adws/promotion/scenarioParser.ts` first.
- If `Scenario` does not already carry the scenario's name string, add a `name: string` field to the `Scenario` interface in `types.ts` and populate it from `GherkinScenario.name ?? ''` inside `mapScenario`.
- Update `adws/promotion/__tests__/scenarioParser.test.ts` to add an assertion on the parsed `name` for one of the existing scenarios.
- Run `bunx vitest run adws/promotion/__tests__/scenarioParser.test.ts` and confirm green.

### Step 4: Extend `promotionTagWriter.applyTagState` to support `'remove-suggestion'` and `'strip-approval'`

- Read `adws/promotion/promotionTagWriter.ts` and the existing test file.
- Refactor the function to dispatch on `state`. Keep `'add-suggestion'` byte-identical (no behaviour change).
- For `'remove-suggestion'`: locate the tag-block above the scenario header (existing back-walk algorithm). For each line in the block, replace `/\s*@promotion-suggested-\d{4}-\d{2}-\d{2}\b/g` with `''` and trim trailing whitespace. If the resulting line is empty, splice it out.
- For `'strip-approval'`: same back-walk; for each line in the block, replace `/\s*@promotion\b(?!-suggested)/g` with `''` and trim trailing whitespace. If empty, splice out.
- Update `adws/promotion/__tests__/promotionTagWriter.test.ts` to add the seven new cases (see "New Files"); update the existing `'throws for unsupported state'` test to use a still-invalid state literal (`'refresh-date'`) so it documents what's *not* yet supported.
- Run `bunx vitest run adws/promotion/__tests__/promotionTagWriter.test.ts` and confirm green.

### Step 5: Implement `promotionApprovalDetector`

- Create `adws/promotion/promotionApprovalDetector.ts`. Import `parse` from `./scenarioParser.ts` and the `ApprovedScenario` type.
- Implement `export function detectApprovals(content: string): ApprovedScenario[]`. Algorithm: `parseScenarios(content)`, filter to entries where `tags.some(t => t === '@promotion')` (strict equality — excludes `@promotion-suggested-<date>`), map to `{ headerLine, startLine, endLine, scenarioName: scenario.name }`.
- Create `adws/promotion/__tests__/promotionApprovalDetector.test.ts` with the five cases from "New Files".
- Run `bunx vitest run adws/promotion/__tests__/promotionApprovalDetector.test.ts` and confirm green.

### Step 6: Extend the barrel export

- Edit `adws/promotion/index.ts` to re-export `detectApprovals` from `./promotionApprovalDetector.ts` and to add the `ApprovedScenario`, `MovedScenarioResult`, `PromotionMoverResult` types.
- (The `runPromotionMover` export is added in Step 7.)

### Step 7: Implement `promotionMover` coordination module

- Create `adws/promotion/promotionMover.ts`.
- Define `interface PromotionMoverDeps`:
  - `fetchChangedFiles: (prNumber: number) => Promise<{ path: string; status: string }[]>`
  - `readFile: (path: string) => string`
  - `writeFile: (path: string, content: string) => void`
  - `getDefaultBranch: () => string`
  - `createWorktree: (branchName: string, baseBranch: string) => string` (returns the worktree path)
  - `commitChanges: (cwd: string, message: string) => boolean`
  - `pushBranch: (cwd: string, branchName: string) => void`
  - `findExistingPR: (branchName: string) => { number: number; url: string } | null`
  - `createPR: (opts: { title: string; body: string; base: string; head: string; cwd: string; labels: string[] }) => { number: number; url: string }`
  - `loadScenariosConfig: () => { regressionScenarioDirectory?: string }`
  - `today: () => string`
  - `log?: (msg: string, level?: string) => void`
- Implement `export async function runPromotionMover(prNumber, deps): Promise<PromotionMoverResult>` following the algorithm in the Implementation Plan above.
- Add a small helper `slugify(name: string): string` that lowercases, hyphenates, strips non-`[a-z0-9-]`, trims hyphens, truncates to 50 chars, and falls back to `unnamed` if the result is empty. Place inside `promotionMover.ts` (single use, internal).
- Add `extractIssueNumberFromPerIssuePath(path: string): number | null` (small, internal). Returns the integer captured from the `feature-(\d+)\.feature` portion of the per-issue path.
- Add `extractScenarioBlock(content: string, startLine: number, endLine: number): { block: string, contentAfter: string }` (small, internal). Slices lines [`startLine-1`, `endLine`) out of `content` and returns both the extracted block and the content with the block removed. Walks forward from `endLine` until the next blank line (inclusive) so the block boundary follows the file's natural separator, avoiding a doubled blank-line gap in the per-issue file after removal.
- Add `renderRegressionFile(block: string, issueNumber: number, existingContent?: string): string` (small, internal). If `existingContent` is provided (destination file already exists), append the block. Otherwise, generate a fresh file with a `Feature: Promoted from feature-{N}` header and the block beneath. Either way, ensure both `@promotion-suggested-<date>` and `@promotion` tokens are stripped from the block.
- Add a single `PER_ISSUE_RE` import (or re-declare; matches the commenter's pattern) and the `PER_ISSUE_DIR` constant.

### Step 8: Implement `promotionMover` unit tests

- Create `adws/promotion/__tests__/promotionMover.test.ts`.
- Use the dep-injection pattern from `promotionCommenter.test.ts` (`makeDeps(overrides)` factory, `vi.fn()` mocks).
- Implement the eleven cases (a–k) listed in "New Files".
- Run `bunx vitest run adws/promotion/__tests__/promotionMover.test.ts` and confirm green.

### Step 9: Wire `runPromotionMover` into `adwPromotionSweep.tsx`

- Edit `adws/adwPromotionSweep.tsx`.
- Add imports for `runPromotionMover`, `PromotionMoverDeps`, `createWorktreeForNewBranch`, `commitChanges`, `pushBranch`, `getDefaultBranch`, `defaultFindPRByBranch`, `loadProjectConfig` (already imported), `execWithRetry` (already imported).
- Add a `buildMoverDeps(prNumber, repoInfo, baseRepoPath)` helper that returns a `PromotionMoverDeps`. Wire each field:
  - `fetchChangedFiles` — same as commenter (extracted into a shared helper inside `adwPromotionSweep.tsx`).
  - `readFile`, `writeFile` — `fs.readFileSync` / `fs.writeFileSync` with `'utf-8'`.
  - `getDefaultBranch` — `() => ghGetDefaultBranch()` (alias the existing import).
  - `createWorktree(branchName, baseBranch)` — `createWorktreeForNewBranch(branchName, baseBranch, baseRepoPath)`.
  - `commitChanges(cwd, message)` — `commitChangesFromVcs(message, cwd)` (rename import to avoid shadowing the `dep` field name).
  - `pushBranch(cwd, branchName)` — `pushBranchFromVcs(branchName, cwd)`.
  - `findExistingPR(branchName)` — `defaultFindPRByBranch(branchName, repoInfo)` then map to `{ number, url }` if non-null.
  - `createPR(opts)` — call `execWithRetry` with `gh pr create --title "${title}" --body-file <tempfile> --base "${base}" --head "${head}" --label "${labels.join(',')}" --repo ${owner}/${repo}` (mirrors the existing `GitHubCodeHost.createPullRequest` shape; uses a temp file for body to avoid shell escaping; parses the returned URL to extract `number`).
  - `loadScenariosConfig` — `() => loadProjectConfig(process.cwd()).scenarios`.
  - `today` — same as commenter.
  - `log` — same as commenter.
- In `main()`, after `runPromotionCommenter(...)` completes, invoke `runPromotionMover(pr.number, buildMoverDeps(...))`. Log the result count (`moved.length`, plus `skipped` count).
- Keep the orchestrator's overall exit-zero contract (failures inside the mover log + continue, do not exit non-zero, because the commenter half has already succeeded).

### Step 10: Add the smoke scenario

- Create `features/regression/smoke/promotion_mover.feature` (tag block `@regression @smoke`, header `Feature: Promotion Mover — Move Orchestrator Paths`).
- Background lines: G1, G4, G11 (same as `promotion_commenter.feature`).
- Scenario 1 — `high-signal scenario — @promotion (no date) triggers a regression-move PR and label`. Uses manifest `test/fixtures/jsonl/manifests/promotion-mover-single-move.json`. Asserts via T2 (recorded comment is acceptable but optional here), T8 (recorded PR creation referencing issue), and existing "mock harness recorded zero PR-merge calls" T7.
- Scenario 2 — `@promotion-suggested-<date> alone produces no move PR`. Uses manifest `test/fixtures/jsonl/manifests/promotion-mover-suggested-only.json`. Asserts T7 (zero merge calls) and the existing W1/T5 pair (exit 0).
- Both scenarios use the W1 step which still returns `'pending'` behind ISSUE-3-CUTOVER; the assertions document the contract for the next harness cutover.

### Step 11: Add the per-issue step-definition pending stubs

- Create `features/per-issue/step_definitions/feature-511.steps.ts`.
- Copy the file-header docstring + `Before/After` hook block from `features/per-issue/step_definitions/feature-509.steps.ts`, changing the tag to `@adw-511`.
- Add a pending stub for each step phrase listed in "New Files" §`feature-511.steps.ts`. Each body is `return 'pending';` exactly.

### Step 12: Add the mock manifest fixtures

- Create the eight manifest JSON files listed in "New Files" §"Mock manifest fixtures".
- Each follows the shape used by `promotion-sweep-high-score.json`: a top-level `jsonlPath` of `.adw-stub-payload.json`, an `edits[]` array writing both the payload file and the seeded per-issue `.feature` file. Feature-file content varies by manifest (single approved, suggested-only, mixed, etc.). Embed the feature-file content as a JSON-escaped string in the `contents` field.

### Step 13: Update the README

- Edit `README.md`.
- Locate the `## Testing` section (line 289) and the BDD scenario layout subsection (line 295).
- After the BDD scenario layout subsection (after the `### .adw/scenarios.md optional sections` block, before `### Running BDD scenarios on the host`), insert a new `### Scenario Promotion` subsection with the five paragraphs described in Phase 3.
- Keep the surrounding sections untouched.

### Step 14: Run validation

- Run every command in the "Validation Commands" section. Each must exit zero.
- If any unit test fails, fix the underlying code (not the test).
- If `bunx tsc --noEmit` flags a type error, fix it; never widen types to `any`.

## Testing Strategy

### Unit Tests

Per `.adw/project.md` line 34 (`## Unit Tests: enabled`), unit tests are required and run under Vitest via `bun run test:unit`. New tests:

- `adws/promotion/__tests__/promotionApprovalDetector.test.ts` — five cases covering bare-`@promotion` detection (positive), `@promotion-suggested-<date>` exclusion (negative), mixed tag block, multiple scenarios in order, malformed Gherkin propagation.
- `adws/promotion/__tests__/promotionMover.test.ts` — eleven cases as enumerated in "New Files".
- `adws/promotion/__tests__/promotionTagWriter.test.ts` — extended with seven new cases for `'remove-suggestion'` and `'strip-approval'` (existing six cases remain green and unchanged).
- `adws/promotion/__tests__/scenarioParser.test.ts` — one additional assertion that `Scenario.name` is populated correctly (added in Step 3).

All deep modules are tested directly through their public interfaces. The mover module uses dependency injection (no module mocks) so every side-effect call is observable on the injected `vi.fn()` mock.

### Edge Cases

- Bare `@promotion` token appears inside a string literal in a scenario step (`Given the user typed "@promotion"`) — the approval detector only inspects `Scenario.tags[]`, not step text, so this is safe. Add an assertion in the detector test to lock this in.
- Tag line contains both `@promotion-suggested-<old-date>` and `@promotion` (the human edited but did not remove the prior suggestion) — `'strip-approval'` removes only `@promotion` (the bare token, via the `(?!-suggested)` negative lookahead in the regex); `'remove-suggestion'` removes the dated variant. The mover applies both before writing the destination file. Asserted by promotionTagWriter test case (e).
- Destination regression file already exists (e.g., a prior move already created `promoted-from-feature-{N}-{slug}.feature`) — `renderRegressionFile` appends the block to the existing content. Idempotency on the *PR* level is handled by `findExistingPR`; idempotency on the *file* level is handled here. Asserted by promotionMover test case (additional case beyond the eleven listed if not implicitly covered).
- Move PR for this branch already exists — `findExistingPR` returns the existing PR; `runPromotionMover` skips and records `skipped: true` in the result. Asserted by promotionMover test case (e).
- The per-issue file already had its `@promotion-suggested-<date>` left behind after the human edit (mixed tag block) — the mover applies `'remove-suggestion'` after removing the scenario block so the per-issue file is clean. (Note: the scenario block is removed entirely, so this primarily matters when there are *other* scenarios in the same file with stale suggestion tags. The mover does NOT remove stale tags from un-touched scenarios in this slice — that is a separate concern handled by the commenter's score-drop withdrawal in slice #5+.)
- No `## Regression Scenario Directory` in `.adw/scenarios.md` — `loadScenariosConfig` returns `regressionScenarioDirectory: undefined`; the mover falls back to `features/regression/`. Asserted by promotionMover test case (g).
- Scenario name contains characters that don't sluggify cleanly (`The "X" orchestrator is invoked...`) — `slugify` strips them and produces a valid slug. Asserted indirectly by promotionMover test case (a) using a representative name.
- The per-issue PR diff contains files outside `features/per-issue/` — `PER_ISSUE_RE` skips them. Asserted by promotionMover test case (j).
- The per-issue file in the PR diff was deleted — `file.status === 'removed'` skips it. Asserted by promotionMover test case (k).
- Multiple `@promotion` scenarios in one file — the mover opens one PR per scenario, each with its own branch and `regression-promotion` label. Asserted by promotionMover test case (d).
- Approval detector encounters a scenario whose Gherkin name field is empty — `slugify('')` returns `'unnamed'`, producing a deterministic branch name. The mover continues but logs a warning. Asserted by the slugify helper's internal contract (covered indirectly by the mover test).
- The `gh pr create --label regression-promotion` call fails because the label does not exist on the repository — the mover treats label-creation as out of scope (the label must already exist; documented in the README). The PR still opens but without the label; the smoke scenario uses a `loadProvider`-friendly mock that records the label-application attempt regardless. (Future work: pre-create the label via `gh label create` if missing.)

## Acceptance Criteria

- `adws/promotion/promotionMover.ts` exists and exports `runPromotionMover` and `PromotionMoverDeps`.
- `adws/promotion/promotionApprovalDetector.ts` exists and exports `detectApprovals`.
- `adws/promotion/promotionTagWriter.ts` supports `'add-suggestion'`, `'remove-suggestion'`, and `'strip-approval'` operations.
- `adws/promotion/types.ts` declares the widened `TagState`, plus `ApprovedScenario`, `MovedScenarioResult`, `PromotionMoverResult`.
- `adws/promotion/index.ts` re-exports the new public surfaces.
- `adws/adwPromotionSweep.tsx` invokes `runPromotionMover` after `runPromotionCommenter` on the same per-issue PR.
- Editing a `@promotion-suggested-<date>` tag to `@promotion` on a per-issue scenario produces, on the next `bunx tsx adws/adwPromotionSweep.tsx <issueNumber>` invocation, a new branch `regression-promotion-issue-{N}-{slug}`, a new file under the resolved regression directory containing the scenario block with `@promotion` and `@promotion-suggested-<date>` stripped, the source scenario removed from the per-issue file on that branch, a commit and push of both changes, and a new PR carrying the `regression-promotion` label.
- The smoke scenario file `features/regression/smoke/promotion_mover.feature` exists and tags `@regression @smoke`.
- The per-issue step definitions file `features/per-issue/step_definitions/feature-511.steps.ts` exists with pending stubs for every new step phrase in `feature-511.feature`.
- All eight mock manifest fixtures referenced by `feature-511.feature` and `promotion_mover.feature` exist under `test/fixtures/jsonl/manifests/`.
- `README.md` contains a `### Scenario Promotion` subsection under `## Testing` documenting the tag vocabulary, the human edit gate, the move PR shape (separate PR + `regression-promotion` label), and the 14-day sweep behaviour.
- Every new unit test under `adws/promotion/__tests__/` passes under `bun run test:unit`.
- `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` pass with no errors.
- `bun run lint` passes with no new warnings.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — Refresh dependencies (no new package adds in this slice; sanity check).
- `bun run lint` — Lint passes with zero new warnings.
- `bunx tsc --noEmit` — Top-level type check passes with zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-tree type check passes with zero errors.
- `bun run test:unit` — Every Vitest unit test passes (existing + new).
- `bunx vitest run adws/promotion/__tests__/promotionApprovalDetector.test.ts` — New approval-detector tests pass.
- `bunx vitest run adws/promotion/__tests__/promotionMover.test.ts` — New mover tests pass.
- `bunx vitest run adws/promotion/__tests__/promotionTagWriter.test.ts` — Extended tag-writer tests (existing + new) pass.
- `bunx vitest run adws/promotion/__tests__/scenarioParser.test.ts` — Tests pass after the added `name` assertion (Step 3).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke" --dry-run` — Dry-run picks up the new smoke scenario file with zero undefined steps (all assertions either resolve to existing step definitions or to the pending-stub W1 step, consistent with the slice-#4 smoke pattern).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-511" --dry-run` — Dry-run picks up the per-issue scenarios and finds every step defined (in either `feature-511.steps.ts` or already-defined regression steps).
- `bunx tsx adws/adwPromotionSweep.tsx --help 2>&1 | head -20` — Orchestrator CLI parses help arguments without throwing.

## Notes

- `.adw/coding_guidelines.md` is strictly followed: TypeScript strict mode, no `any`, files under 300 lines (the mover module is the largest new file and should land around ~200 lines including the four internal helpers), guard clauses for early-return, declarative `for/of` loops over `forEach`, side effects isolated behind injected deps. The mover's `try/catch` boundaries live at the top-level GitHub/git calls (`createPR`, `pushBranch`, `commitChanges`) — internal pure helpers do not catch.
- Library install command: no new library adds in this slice. `@cucumber/gherkin` and `@cucumber/messages` were added by slice #4 (#509) and are reused via `scenarioParser`. If for any reason a new dep is needed, use `bun add <package>` per `.adw/commands.md`.
- `hitl` label apply on the per-issue PR (from PRD §10) was deferred by slice #4 (#509). This issue does NOT include `hitl` apply either — issue #511's acceptance criteria explicitly only require the `regression-promotion` label on the *move* PR. The `hitl` apply on the per-issue PR is a separate concern (also referenced under "deferred to slice #5" in `app_docs/feature-tdauam-promotion-commenter-deep-modules.md`). It can land as a follow-up issue without blocking this slice.
- The auto-ramp threshold formula (PRD §"Threshold N is auto-ramping") is still hardcoded to `3` via `promotionThreshold.computeThreshold`; this slice does not change that. The mover does not consult the threshold (it acts on `@promotion`, not on score).
- Smoke scenarios are pending until the ISSUE-3-CUTOVER stub in `features/regression/step_definitions/whenSteps.ts:80` lands. The mover smoke scenarios document the contract just like the commenter smoke scenarios did in slice #4.
- The `regression-promotion` GitHub label is assumed to already exist on the repository (created manually or by a prior `adwInit` extension). Out-of-scope here: pre-creating the label via `gh label create` if it does not exist. The smoke scenario's recorded `label application` assertion fires regardless of whether the label exists upstream (mock-server-recorded).
- Conditional documentation: the new feature touches the `adws/promotion/` module so the existing condition entry `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` (lines 1166–1175 of `.adw/conditional_docs.md`) is the relevant prior art document, already loaded by the planner. The `app_docs/feature-2wrg9y-promotion-mover-regression-pr.md` doc will be produced by the `/document` slash command during the documentation phase after merge.
- `cucumber.js` and `vitest.config.ts` do not need changes — new `.feature` files and `*.test.ts` files are picked up automatically by the existing glob patterns.
- The per-issue scenarios in `features/per-issue/feature-511.feature` already exist (committed before planning began; see `git log` for the commit). The plan treats them as **input** — the implementation must satisfy them, not regenerate them.
- Single-host constraint and worktree isolation remain in force: the mover creates a *new* worktree at `.worktrees/regression-promotion-issue-{N}-{slug}` to avoid mutating the active per-issue worktree's branch state. The worktree is left in place after the orchestrator exits (the regression-promotion PR may still need amendments before merge); cleanup is left to standard worktree pruning conventions.
