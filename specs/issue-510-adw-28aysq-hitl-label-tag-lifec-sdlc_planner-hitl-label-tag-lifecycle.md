# Feature: HITL Label + Tag Lifecycle — Refresh-Date, Remove-Suggestion, Duplicate Suppression, and `hitl` Application

## Metadata
issueNumber: `510`
adwId: `28aysq-hitl-label-tag-lifec`
issueJson: `{"number":510,"title":"HITL label + tag lifecycle (refresh date, suppress duplicates, withdraw on score drop)","body":"## Parent PRD\n\n`specs/prd/scenario-rot-prevention-and-promotion.md`\n\n## What to build\n\nExtend the promotion commenter from slice #509 with the full tag lifecycle and HITL gate:\n\n1. **`hitl` label application** — when any promotion comment is posted on a PR, apply the `hitl` label so the PR cannot auto-merge until a human acts\n2. **Daily-cadence suppression** — if a scenario's `@promotion-suggested-<date>` tag carries today's date, skip the comment for this run (no duplicate same-day reminders)\n3. **Date refresh on re-reminder** — if the tag carries an older date, update it to today and post the reminder comment\n4. **Score-drop withdrawal** — if a scenario previously tagged drops below the threshold on a subsequent run, remove the `@promotion-suggested-<date>` tag\n\nThe `promotionTagWriter` deep module gains the `refresh-date` and `remove-suggestion` operations. Their unit tests are added in this slice.\n\n## Acceptance criteria\n\n- [ ] `promotionTagWriter` supports `refresh-date` and `remove-suggestion` operations with unit-test coverage\n- [ ] Posting a comment from `promotionCommenter` triggers `hitl` label application via the GitHub API\n- [ ] A second agent run on the same PR within the same day produces no duplicate comment for the same scenario\n- [ ] A run on a later day with the scenario still scoring above N updates the tag date and posts a reminder comment\n- [ ] A scenario tagged in a prior run that no longer scores above N has its tag removed on the next run\n- [ ] The mock harness smoke scenario from slice #509 is extended (or a sibling scenario added) to cover these lifecycle paths\n\n## Blocked by\n\n- Blocked by #509\n\n## User stories addressed\n\n- User story 9 (tag date refreshed at most once per day)\n- User story 10 (hitl label auto-applied when comment posted)\n- User story 13 (ignored suggestions die naturally at 14-day sweep — no escalation added here, but the behaviour is finalised)\n- User story 14 (daily suppression of duplicates)\n- User story 15 (tag dropped on score drop)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-05-20T22:45:05Z","comments":[],"actionableComment":null}`

## Feature Description

This is slice #5 of the parent PRD `specs/prd/scenario-rot-prevention-and-promotion.md`. Slice #4 (issue #509, merged 2026-05-21) shipped the five pure deep modules plus the tracer-bullet `adwPromotionSweep.tsx` orchestrator with a single tag-state operation (`add-suggestion`) and no `hitl` label or duplicate-suppression. This slice closes the loop on the **tag lifecycle and the HITL gate**: every comment that the promotion commenter posts now applies the `hitl` label, tags are refreshed at most once per day, ignored suggestions can be withdrawn on a score drop, and duplicate same-day reminders are suppressed.

Four behavioural changes ship together:

1. **`hitl` label application on comment.** When `promotionCommenter` posts a comment on a per-issue PR, it also applies the `hitl` label to the linked issue. The existing `adwMerge.tsx` stateless gate (`gate_open = (no hitl on issue) OR (PR is approved)`) then blocks auto-merge until a human acts.
2. **Date refresh on re-reminder.** If a scenario already carries `@promotion-suggested-<old-date>` and still scores ≥ N on this run, the tag's date is updated to today (rather than appending a second tag literal as slice #4 documented as a known limitation). The reminder comment is then posted.
3. **Daily-cadence suppression.** If a scenario already carries `@promotion-suggested-<today>` (i.e. it was tagged earlier today by an idempotent re-run on the same PR event), the commenter posts no duplicate comment for that scenario. Tag-write becomes a no-op for that scenario; the rest of the PR's scenarios are still evaluated.
4. **Score-drop withdrawal.** If a scenario carries `@promotion-suggested-<any-date>` but its score drops below N on this run (e.g. the author edited the scenario between agent runs), the commenter removes the tag and does not include the scenario in the consolidated PR comment. No "the tag was withdrawn" reminder is posted — withdrawals are silent.

The `promotionTagWriter` deep module gains two new operations (`refresh-date`, `remove-suggestion`) plus a pure-query helper (`detectExistingSuggestionDate`) so the coordination layer can decide which `TagState` to apply per scenario without re-parsing the file. The `TagState` union widens from `'add-suggestion'` to `'add-suggestion' | 'refresh-date' | 'remove-suggestion'`.

A new GitHub helper (`addPRLabel`) is added alongside the existing `addIssueLabel` to keep the gh CLI surface consistent. The commenter uses `addIssueLabel(issueNumber, 'hitl', repoInfo)` so the label lands on the *issue* (per the existing `adwMerge.tsx` gate); the PR label helper is added defensively for future slices that may need it but is not consumed by this slice's coordination layer.

## User Story

As an ADW developer
I want the promotion commenter to manage the full `@promotion-suggested-<date>` tag lifecycle and apply the `hitl` label whenever it posts a comment
So that the same per-issue PR re-evaluated multiple times produces at most one reminder per day, withdrawn suggestions disappear quietly, and a human is forced to acknowledge any promotion suggestion before auto-merge can fire.

## Problem Statement

Slice #4 shipped the tracer-bullet promotion commenter end-to-end but with three deliberately-documented limitations:

- Tag writing only supports `add-suggestion`. A second run on the same PR appends a *second* `@promotion-suggested-<date>` tag literal rather than refreshing the date — the file accumulates one tag per agent run, polluting the diff.
- No duplicate-suppression. A re-evaluation triggered by a webhook later the same day posts another comment for every above-threshold scenario, spamming the PR.
- No `hitl` label application. Even though `adwMerge.tsx` honours `hitl` on the issue as the human-gate signal, the promotion commenter never applies it. The PRD's "PR cannot auto-merge until a human acts" guarantee is currently unenforced.

Two further behaviours are required by the PRD but missing entirely from slice #4:

- A scenario whose author edits it between runs (e.g., removes a vocabulary phrase, switching to a mock-query pattern, dropping below N) keeps its stale `@promotion-suggested-<old-date>` tag forever. There is no withdrawal path.
- The duplicate-suppression and date-refresh paths share the same parse → score → decide → apply transform but slice #4's coordination layer is hardcoded to `'add-suggestion'`, so there is no place to express the decision.

Without this slice, the promotion mechanism is "post-only and never updates" — it cannot graduate from tracer bullet to production. The HITL gate cannot become a real safety rail until the label-on-comment behaviour is wired, and the tag file cannot be trusted as the suggestion's state record until refresh and remove are implemented.

## Solution Statement

Extend the existing five-deep-module + thin-coordination-layer architecture rather than restructuring. Three changes:

1. **Widen `TagState` and extend `promotionTagWriter`.** Add `'refresh-date'` and `'remove-suggestion'` to the union. Add a pure-query helper `detectExistingSuggestionDate(content, scenarioHeaderLine): string | null` that returns the existing `@promotion-suggested-<date>`'s date if present (or `null`). The tag writer's `applyTagState` switch handles the three operations: `add-suggestion` (existing), `refresh-date` (locate existing tag → replace its date), `remove-suggestion` (locate existing tag → splice it out of the tag-line, removing the whole line if no other tags remain).

2. **Extend `promotionCommenter` coordination logic.** Per scenario, after parsing and scoring, run a decision matrix:

   | Existing tag | Score ≥ N | Action | Comment included? |
   |---|---|---|---|
   | none | yes | `add-suggestion` | yes |
   | none | no | (no-op) | no |
   | dated today | yes | (no-op — already tagged today) | no (daily suppression) |
   | dated today | no | `remove-suggestion` | no (withdrawal is silent) |
   | dated earlier | yes | `refresh-date` | yes (reminder) |
   | dated earlier | no | `remove-suggestion` | no (withdrawal is silent) |

   If any scenario in the run produced a "yes" comment, apply the `hitl` label to the linked issue after the comment posts (label-on-comment, not label-on-tag-write — withdrawal-only runs do not apply `hitl`).

3. **Inject a `hitlLabel` dep.** Add `applyHitlLabel: (issueNumber: number) => Promise<void>` to `PromotionCommenterDeps`. The default factory in `adwPromotionSweep.tsx` wires it to `addIssueLabel(issueNumber, 'hitl', repoInfo)` from `adws/github/issueApi.ts`. The issue number is resolved from the PR's head branch via the existing `extractIssueNumberFromBranch` helper in `adws/triggers/webhookHandlers.ts`. The dep-injection keeps the coordination function unit-testable without any GitHub mock.

The slice respects the existing constraint that `promotionCommenter` is the *only* module touching the GitHub API surface. Decision logic stays in the coordination layer; tag transforms stay in the deep module; the deep modules remain pure and unit-testable in isolation.

No new orchestrators, no webhook wiring, and no spawn-lock changes. `runWithOrchestratorLifecycle` is still **not** wrapped — duplicate-suppression is now data-driven (tag date check) rather than lock-driven, so the slice does not require it. Webhook wiring (`pull_request.opened` / `pull_request.synchronize` → spawn `adwPromotionSweep.tsx`) remains deferred to slice #6.

## Relevant Files

Use these files to implement the feature:

### Read-only references (existing code/docs informing the design)

- `specs/prd/scenario-rot-prevention-and-promotion.md` — Parent PRD. Sections that anchor this slice: **Solution** (`hitl` label gate, daily refresh cadence, score-drop tag withdrawal), **Modules → promotionTagWriter** (operations enumerated as `'add-suggestion' | 'refresh-date' | 'remove-suggestion'`), **Interfaces → applyTagState** (the typed `TagState` union), **State storage** (the `.feature` file itself is the suggestion state record). User stories 9, 10, 13, 14, 15 are the acceptance gates.
- `specs/issue-509-adw-tdauam-promotion-commenter-sdlc_planner-promotion-commenter-deep-modules.md` — Slice #4 spec. Defines the deep-module + coordination architecture this slice extends. The "Known limitation" note at the bottom (existing `@promotion-suggested-<other-date>` tag appends rather than refreshing) is the gap this slice closes.
- `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` — Slice #4 docs. Lists the explicit deferrals for slice #5 (this slice): `hitl` label application, duplicate-suppression, `promotionTagWriter` date-refresh and tag-removal, `@promotion` (no date) approval detection (the last one stays deferred — approval-detection moves with `promotionMover` in a later slice).
- `adws/promotion/promotionTagWriter.ts` — Existing pure tag-insert function. Extended in-place with two new operations and the `detectExistingSuggestionDate` query helper. The current implementation walks backward from the scenario header to find a tag block; the same walk is reused for `refresh-date` and `remove-suggestion`.
- `adws/promotion/types.ts` — Shared type definitions. `TagState` (line 44) is widened from `'add-suggestion'` to `'add-suggestion' | 'refresh-date' | 'remove-suggestion'`.
- `adws/promotion/promotionCommenter.ts` — Existing coordination function. Decision matrix is added; `applyHitlLabel` dep is added to `PromotionCommenterDeps`; the `today()` value is captured once per run and threaded through the decision logic so `detectExistingSuggestionDate` comparisons are consistent across scenarios.
- `adws/promotion/index.ts` — Barrel exports. New surfaces are added: `detectExistingSuggestionDate`, the widened `TagState`.
- `adws/promotion/__tests__/promotionTagWriter.test.ts` — Existing tag-writer unit tests. Extended with new test cases for the two new operations and the query helper.
- `adws/promotion/__tests__/promotionCommenter.test.ts` — Existing commenter unit tests. Extended with the six decision-matrix branches (one for each row of the table above) plus `hitl` label dep-invocation assertions.
- `adws/adwPromotionSweep.tsx` — Existing CLI orchestrator. `buildDefaultDeps` is extended to provide `applyHitlLabel` (wired to `addIssueLabel` on the resolved issue number).
- `adws/github/issueApi.ts` — Existing GitHub API helpers. `addIssueLabel(issueNumber, labelName, repoInfo)` (lines 293–304) is the `hitl` label call. Re-used as-is. `issueHasLabel` (lines 272–285) is also re-used by tests/asserts if needed.
- `adws/github/prApi.ts` — Existing PR API helpers. `defaultFindPRByBranch` (lines 21–32) resolves the PR; the head branch name is the input to `extractIssueNumberFromBranch`.
- `adws/triggers/webhookHandlers.ts` — `extractIssueNumberFromBranch(branchName: string)` parses the issue number from a `feature-{N}` / `bug-{N}` / `chore-{N}` branch name. Already imported by `prApi.ts`; the orchestrator re-uses it to derive the issue number from the resolved PR's head branch.
- `adws/github/index.ts` — Barrel exports for the GitHub API module. Confirm `addIssueLabel` is exported (it is, transitively via the issueApi re-exports).
- `features/regression/smoke/promotion_commenter.feature` — Existing smoke scenarios from slice #4. Extended with three new scenarios (duplicate suppression, date refresh, score-drop withdrawal) plus an `hitl` label assertion on the existing high-score scenario.
- `features/per-issue/feature-509.feature` — Existing per-issue BDD scenarios. The lifecycle paths added in this slice are **not** appended here — slice #5 ships its own per-issue file (`features/per-issue/feature-510.feature`) per the per-issue file convention (`feature-{issueNumber}.feature`).
- `features/regression/step_definitions/whenSteps.ts` — `ORCHESTRATOR_FILES` already maps `'promotion-sweep' → 'adwPromotionSweep.tsx'`. No edits needed in this slice; new scenarios re-use the W1 invocation step.
- `features/regression/vocabulary.md` — Vocabulary registry. New Then-axis phrases are added (T-axis additions for the `hitl` label assertion and the score-drop assertion); see Step 4 below.
- `features/regression/step_definitions/thenSteps.ts` — Then-axis step definitions. New step definitions land here following the existing pending-return pattern.
- `features/regression/step_definitions/givenSteps.ts` — Given-axis step definitions. A new Given step is added for "feature file is seeded with an existing `@promotion-suggested-<date>` tag" so the fixture-shape used by lifecycle scenarios is expressible in Gherkin.
- `test/fixtures/jsonl/manifests/promotion-sweep-high-score.json` — Slice #4 manifest. Reference for the manifest shape. New manifests in this slice follow the same template.
- `test/fixtures/jsonl/manifests/promotion-sweep-low-score.json` — Slice #4 low-score manifest. Reference.
- `test/mocks/github-api-server.ts` — Mock GitHub API server. `postIssueLabels` route (lines 150–156) already exists and records label POSTs to `/repos/:owner/:repo/issues/:issueNumber/labels`. New smoke scenarios assert against the recorded label calls.
- `test/mocks/types.ts` — `MockServerState.labels` field already exists (line 47). No type change needed.
- `adws/adwMerge.tsx` — Existing merge orchestrator that consumes the `hitl` label (lines 131–138). Read-only reference for the gate behaviour; no edits in this slice.
- `app_docs/feature-tvqgz4-unify-auto-merge-hitl-gate.md` — Documents the `hitl` gate. Read-only reference for the wider context.
- `app_docs/feature-fygx90-hitl-label-gate-automerge.md` — Documents the `issueHasLabel` real-time check pattern. Read-only reference.
- `app_docs/feature-nrr167-hitl-label-gate-adwmerge.md` — Documents the `hitl` label being applied to **the issue**, not the PR (line 43). This is the contract the new dep wiring follows.
- `adws/core/projectConfig.ts` — `loadProjectConfig`. Already consumed by `adwPromotionSweep.tsx`. No edits needed.
- `adws/triggers/perIssueScenarioSweep.ts` and `adws/triggers/__tests__/perIssueScenarioSweep.test.ts` — Reference for the dep-injection + factory pattern used here. No edits needed.
- `.adw/coding_guidelines.md` — Mandatory coding guidelines (TypeScript strict, no `any`, guard clauses, max nesting depth ~2, declarative over imperative, isolate side effects). Strictly followed.
- `.adw/project.md` — Confirms `## Unit Tests: enabled` (line 34); unit tests are required for this slice.
- `.adw/scenarios.md` — Polymorphism flags including `## Vocabulary Registry`. No edits needed.
- `.adw/conditional_docs.md` — Lists conditional documentation paths. `feature-tdauam-promotion-commenter-deep-modules.md` is loaded when extending the `promotion/` module (this slice).
- `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` — Conditional doc loaded per `.adw/conditional_docs.md` for any work in `adws/promotion/`. Already cited above.
- `app_docs/feature-2evbnk-bdd-smoke-surface-scenarios.md` — Smoke scenario authoring conventions. Referenced when extending `promotion_commenter.feature`.
- `app_docs/feature-mzgyjj-rot-prevention-block.md` — Rot-prevention rubric. Confirms that new vocabulary phrases must pass the same rubric the rest of the registry follows.

### New Files

#### Per-issue BDD scenarios (build-agent input, not executed)

- `features/per-issue/feature-510.feature` — Tagged `@adw-510 @adw-28aysq-hitl-label-tag-lifec`. Behavioural scenarios describing the lifecycle acceptance contract from a target-repo operator's perspective. Five scenarios:
  1. Posting a comment applies the `hitl` label to the linked issue.
  2. A second run on the same day on the same PR produces no duplicate comment for a scenario already tagged today.
  3. A run on a later day with the scenario still scoring above N updates the tag date and posts a reminder.
  4. A previously-tagged scenario that no longer scores above N has its tag removed and no comment posted for it.
  5. A run where every previously-tagged scenario drops below N applies **no** `hitl` label (label-on-comment, not label-on-tag-change).

#### Mock manifest fixtures

- `test/fixtures/jsonl/manifests/promotion-sweep-hitl-applied.json` — Pre-seeds a per-issue feature file with a high-score scenario (no existing tag). Records the comment POST + the `hitl` label POST.
- `test/fixtures/jsonl/manifests/promotion-sweep-same-day-suppress.json` — Pre-seeds a per-issue feature file already carrying `@promotion-suggested-<today>` on a high-score scenario. Records no comment, no `hitl` label call (no comment → no label).
- `test/fixtures/jsonl/manifests/promotion-sweep-date-refresh.json` — Pre-seeds a per-issue feature file already carrying `@promotion-suggested-<earlier-date>` on a high-score scenario. Records the tag date refresh + the comment POST + the `hitl` label POST.
- `test/fixtures/jsonl/manifests/promotion-sweep-score-drop.json` — Pre-seeds a per-issue feature file carrying `@promotion-suggested-<earlier-date>` on a scenario that now scores below N (e.g., only mock-query phrases). Records the tag removal but no comment and no `hitl` label call.
- `test/fixtures/jsonl/manifests/promotion-sweep-withdraw-only-no-hitl.json` — Pre-seeds a per-issue feature file with two scenarios both previously tagged, both now below N. Records two tag removals but no comment and no `hitl` label call (verifies the label-on-comment semantics).

## Implementation Plan

### Phase 1: Foundation (Type & Deep-Module Extension)

Widen the `TagState` union and extend `promotionTagWriter` with the two new operations plus the `detectExistingSuggestionDate` query helper. The deep module stays pure — no I/O, no orchestration. Unit tests for the new operations land in the same step so each branch is covered before the coordination layer consumes them.

The existing `applyTagState` `'add-suggestion'` case is left unchanged. The new `'refresh-date'` and `'remove-suggestion'` cases share the same backward-walk from the scenario header that already exists, so the file's nesting depth stays under the ~2-level guideline. The detection helper (`detectExistingSuggestionDate`) walks the same tag block, applies a regex, and returns the captured date or `null`.

### Phase 2: Core Implementation (Commenter Decision Matrix + HITL Dep)

Add `applyHitlLabel` to `PromotionCommenterDeps`. Extend the commenter's per-scenario loop to compute the existing-tag state (via `detectExistingSuggestionDate`), apply the decision-matrix action (no-op / add / refresh / remove), and accumulate a list of scenarios eligible for the consolidated comment. After the per-file loop completes, if any scenarios accumulated, post the comment **and** apply the `hitl` label. Withdrawal-only runs skip both the comment and the label.

The decision matrix is implemented as a pure helper function (`decideTagAction(existingDate, today, scoreMeetsThreshold)`) returning a `{ tagAction: TagState | 'no-op'; commentEligible: boolean }` discriminated record. Pulling the decision into a pure helper keeps the orchestrator function readable (no nested if/else trees) and makes the decision itself unit-testable in isolation.

### Phase 3: Integration (Wiring + Smoke/Per-Issue Scenarios + Manifests)

Wire `applyHitlLabel` in `adwPromotionSweep.tsx`'s default deps factory using `extractIssueNumberFromBranch(pr.headRefName)` to derive the issue number from the PR head branch and `addIssueLabel(issueNumber, 'hitl', repoInfo)` as the implementation. Extend the existing smoke feature with three new scenarios (duplicate suppression, date refresh, score-drop withdrawal) and adjust the existing high-score scenario to assert the `hitl` label POST was recorded. Add the per-issue BDD file for issue #510 capturing the same behaviours from a target-repo operator's perspective. Add five new mock-harness manifest fixtures.

Vocabulary registry gains two new Then-axis phrases (label-recorded assertion, tag-removed assertion) so the new scenarios remain within the rubric and `generate_step_definitions` passes vocabulary validation. The new phrases use the existing patterns (`mock-query` for label assertions, file artefact for tag assertions).

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Widen `TagState` and update barrel exports

- Edit `adws/promotion/types.ts` — change `export type TagState = 'add-suggestion';` to `export type TagState = 'add-suggestion' | 'refresh-date' | 'remove-suggestion';`.
- Confirm `adws/promotion/index.ts` already exports `TagState`. No change needed; consumers automatically pick up the wider union.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` and confirm no breakage. The existing `applyTagState` body still throws for non-`'add-suggestion'` states, so the wider type compiles but the throw remains as a safety net until Step 2 implements the new cases.

### Step 2: Implement `refresh-date` and `remove-suggestion` in `promotionTagWriter` + the `detectExistingSuggestionDate` helper

- Edit `adws/promotion/promotionTagWriter.ts`.
- Add `export function detectExistingSuggestionDate(content: string, scenarioHeaderLine: number): string | null` — splits content by `\n`, locates the scenario header (1-based to 0-based), walks backward from the header for a contiguous tag block, scans the collected tag-block lines for the regex `/@promotion-suggested-(\d{4}-\d{2}-\d{2})/`, and returns the first matched date or `null` if none.
- Extend `applyTagState`'s switch:
  - `'add-suggestion'` — unchanged.
  - `'refresh-date'` — locate the existing `@promotion-suggested-<date>` token via the same backward walk + regex, replace its date with `today`, and return the re-joined content. If no existing tag is found, throw `Error('promotionTagWriter: refresh-date requires an existing @promotion-suggested-* tag')` (the commenter never calls this without checking; the throw is a defensive guard).
  - `'remove-suggestion'` — locate the existing `@promotion-suggested-<date>` token, splice it out of the tag-line. If the line contained only that tag (after trimming whitespace), remove the whole line. Otherwise remove just the token plus the single-space separator (preserving the rest of the tags). If no existing tag is found, the operation is a no-op and returns the input unchanged (idempotent removal). Document this idempotency in a single-line comment above the `case`.
- Internal refactor: extract the backward-walk-for-tag-block into a private helper (`findTagBlockBounds(lines, headerIdx): { firstIdx, lastIdx } | null`) so the three operations + the query helper share the walk logic. The function returns `null` when no contiguous tag block sits immediately above the header. Max nesting depth stays at 2.
- Both new operations preserve byte-exact positions of all non-modified lines (same contract as `add-suggestion`).

### Step 3: Extend `promotionTagWriter` unit tests

- Edit `adws/promotion/__tests__/promotionTagWriter.test.ts`.
- Add a `describe('detectExistingSuggestionDate', () => { ... })` block:
  - Returns the date when a tag block above the header contains `@promotion-suggested-YYYY-MM-DD`.
  - Returns `null` when no tag block sits above the header.
  - Returns `null` when the tag block exists but contains no `@promotion-suggested-*` tag.
  - Returns the **first** date when multiple `@promotion-suggested-*` tags are present (defensive parsing — the writer never produces two, but pre-existing files might).
  - Handles the scenario header at file start (no preceding lines → returns `null`).
- Extend the `describe('applyTagState', ...)` block:
  - `'refresh-date'` happy path: scenario with `@adw-509 @promotion-suggested-2026-01-01` → tag becomes `@adw-509 @promotion-suggested-2026-05-21` (today) and all other lines are byte-identical.
  - `'refresh-date'` with no existing tag throws.
  - `'remove-suggestion'` happy path on a tag-line containing only the suggestion tag → the whole line is removed; the file shrinks by one line; all other lines are byte-identical.
  - `'remove-suggestion'` happy path on a tag-line that has other tags (`@adw-509 @promotion-suggested-2026-01-01`) → only the suggestion tag is removed; the tag-line becomes `@adw-509`.
  - `'remove-suggestion'` with no existing suggestion tag is a no-op (returns content unchanged).
  - `'remove-suggestion'` when the tag is the first token on the line (`@promotion-suggested-2026-01-01 @adw-509`) — leading-space normalisation: the resulting line is `@adw-509` with the original leading indentation preserved.
- Run `bunx vitest run adws/promotion/__tests__/promotionTagWriter.test.ts` and confirm green.

### Step 4: Extend vocabulary registry with new Then-axis phrases

- Edit `features/regression/vocabulary.md`. Add to the `## Then — State / Mock / Artefact Assertions` table (new rows below the last `T*` row):
  - `T16 | the mock GitHub API recorded a hitl label addition on issue {int} | Queries recorded requests; asserts a POST /repos/.../issues/N/labels with body containing the string "hitl" was captured | mock-query | recorded requests`
  - `T17 | the artefact file at {string} in the worktree for adwId {string} carries no "@promotion-suggested-" tag on the previously-tagged scenario | Reads the artefact file, locates the previously-tagged scenario header via the seed-fixture metadata, asserts the @promotion-suggested- tag has been removed | subprocess | file artefact |`
  - `T18 | the artefact file at {string} in the worktree for adwId {string} carries a "@promotion-suggested-{string}" tag refreshed to today on the previously-tagged scenario | Reads the artefact file, locates the previously-tagged scenario header, asserts the tag's date string equals today (YYYY-MM-DD) | subprocess | file artefact |`
- Each new phrase passes the rot-detection rubric (assertion is against recorded mock requests or the post-orchestrator artefact file — never against framework source files).

### Step 5: Add Then-axis step definitions for the new vocabulary phrases

- Edit `features/regression/step_definitions/thenSteps.ts` (or the analogous file in the suite). Add:
  - `Then('the mock GitHub API recorded a hitl label addition on issue {int}', ...)` — follow the existing `pending` pattern from W1/T2.
  - `Then('the artefact file at {string} in the worktree for adwId {string} carries no "@promotion-suggested-" tag on the previously-tagged scenario', ...)` — pending pattern.
  - `Then('the artefact file at {string} in the worktree for adwId {string} carries a "@promotion-suggested-{string}" tag refreshed to today on the previously-tagged scenario', ...)` — pending pattern.
- Add a Given-axis step definition for the new fixture-shape phrase (used by the new per-issue scenarios):
  - `Given('a per-issue feature file at {string} is seeded into the worktree for adwId {string} from fixture {string} with an existing "@promotion-suggested-{string}" tag on the targeted scenario', ...)` — pending pattern.
- The pending pattern is intentional and consistent with slice #4 — the BDD harness does not yet drive a real subprocess to completion under 30s. The smoke + per-issue scenarios document the contract; the unit tests carry the executable proof of the behavioural changes.

### Step 6: Extend `PromotionCommenterDeps` with `applyHitlLabel`

- Edit `adws/promotion/promotionCommenter.ts`.
- Add to `PromotionCommenterDeps`: `applyHitlLabel: (issueNumber: number) => Promise<void>;`.
- Add a new field to the return type: `PromotionResult` gains an optional `hitlLabelApplied?: boolean` field documenting whether `applyHitlLabel` was invoked. (Helps test assertions and downstream observability.)
- Re-export `PromotionResult` shape unchanged at the barrel.

### Step 7: Add the `decideTagAction` pure helper

- In `adws/promotion/promotionCommenter.ts`, add a non-exported helper:
  ```ts
  function decideTagAction(
    existingDate: string | null,
    today: string,
    scoreMeetsThreshold: boolean,
  ): { tagAction: TagState | 'no-op'; commentEligible: boolean } { ... }
  ```
- Body implements the six-row decision matrix from the Solution Statement:
  - `existingDate === null && scoreMeetsThreshold` → `{ tagAction: 'add-suggestion', commentEligible: true }`.
  - `existingDate === null && !scoreMeetsThreshold` → `{ tagAction: 'no-op', commentEligible: false }`.
  - `existingDate === today && scoreMeetsThreshold` → `{ tagAction: 'no-op', commentEligible: false }` (daily suppression).
  - `existingDate === today && !scoreMeetsThreshold` → `{ tagAction: 'remove-suggestion', commentEligible: false }` (silent withdrawal).
  - `existingDate !== null && existingDate !== today && scoreMeetsThreshold` → `{ tagAction: 'refresh-date', commentEligible: true }` (date refresh + reminder).
  - `existingDate !== null && existingDate !== today && !scoreMeetsThreshold` → `{ tagAction: 'remove-suggestion', commentEligible: false }` (silent withdrawal).
- Inline-document the matrix as a single comment block above the function so future maintainers can audit the rules without re-deriving them.

### Step 8: Update `runPromotionCommenter` to apply the decision matrix and `hitl` label

- Edit `adws/promotion/promotionCommenter.ts`.
- Capture `const today = deps.today();` once at the top of `runPromotionCommenter` (rather than per-scenario as slice #4 did). All subsequent calls use this captured value for date comparisons and tag-string interpolation, guaranteeing intra-run consistency.
- Replace the existing per-scenario `if (result.total < threshold) continue;` + `applyTagState('add-suggestion', ...)` block with:
  - Call `detectExistingSuggestionDate(content, scenario.headerLine)`.
  - Call `decideTagAction(existingDate, today, result.total >= threshold)`.
  - If `tagAction !== 'no-op'`, call `applyTagState(content, scenario.headerLine, tagAction, today)`, `deps.writeFile(...)`, and update the threaded `content`.
  - If `commentEligible`, push the scenario into `suggestedScenarios`.
- After the per-file loop, if `suggestedScenarios.length > 0`, post the comment **and then** call `await deps.applyHitlLabel(issueNumber)`. The issue number is derived once outside the loop via `extractIssueNumberFromBranch(pr.headRefName)`-equivalent input (passed in as part of the function signature — see Step 9).
- Return `{ suggestedScenarios, hitlLabelApplied: suggestedScenarios.length > 0 }`.

### Step 9: Update `runPromotionCommenter` signature to accept the issue number

- Slice #4's signature is `runPromotionCommenter(prNumber: number, deps): Promise<PromotionResult>`. Slice #5 needs the issue number to apply the `hitl` label.
- Change the signature to `runPromotionCommenter(prNumber: number, issueNumber: number, deps): Promise<PromotionResult>`. The issue number is the second positional arg because PR number is the operational identifier and issue number is supplementary metadata.
- Update `adwPromotionSweep.tsx` accordingly (Step 11).
- Update the unit test in Step 10 to pass the issue number in every call.

### Step 10: Extend `promotionCommenter` unit tests with decision-matrix coverage and `hitl` assertions

- Edit `adws/promotion/__tests__/promotionCommenter.test.ts`.
- Add an `applyHitlLabel` mock to `makeDeps`: `applyHitlLabel: vi.fn().mockResolvedValue(undefined)`.
- Add a fixed `today` value via the existing `today: () => '2026-05-21'` mock.
- Replace existing single-call signatures in `runPromotionCommenter(1, deps)` with `runPromotionCommenter(1, 999, deps)` (PR number + issue number).
- Add test cases (one per matrix row + cross-cutting cases):
  1. **No existing tag + above threshold** → `writeFile` called with `add-suggestion` content, `postComment` called once, `applyHitlLabel` called once with the issue number.
  2. **No existing tag + below threshold** → no `writeFile`, no `postComment`, no `applyHitlLabel`.
  3. **Existing tag dated today + above threshold** → no `writeFile`, no `postComment`, no `applyHitlLabel` (daily suppression).
  4. **Existing tag dated today + below threshold** → `writeFile` called with `remove-suggestion` content, no `postComment`, no `applyHitlLabel` (silent withdrawal).
  5. **Existing tag dated earlier + above threshold** → `writeFile` called with `refresh-date` content, `postComment` called, `applyHitlLabel` called.
  6. **Existing tag dated earlier + below threshold** → `writeFile` called with `remove-suggestion` content, no `postComment`, no `applyHitlLabel`.
  7. **Mixed file**: one scenario triggers `add-suggestion` and another triggers `remove-suggestion` → both `writeFile` invocations recorded, one `postComment`, one `applyHitlLabel` (label applied because at least one scenario was comment-eligible).
  8. **Withdraw-only run**: every above-threshold tag is now below threshold (two scenarios both removed) → two `writeFile` invocations, no `postComment`, no `applyHitlLabel`.
  9. **`applyHitlLabel` throws** → the function does not throw to its caller (label application is best-effort; failure is logged via `deps.log` but the run still returns its `PromotionResult`). The test asserts `log` was called with a warning-level message.
- Add a `decideTagAction` unit test block (six rows of the matrix) — the decision logic is pure, so testing it directly without going through the orchestrator avoids re-running all the setup boilerplate per matrix row. Export `decideTagAction` for testing or test it via the public `runPromotionCommenter` surface; prefer the latter to keep the export surface tight (the matrix is already covered transitively via the 6 above-listed branches).
- Run `bunx vitest run adws/promotion/__tests__/promotionCommenter.test.ts` and confirm green.

### Step 11: Wire `applyHitlLabel` and issue number resolution in `adwPromotionSweep.tsx`

- Edit `adws/adwPromotionSweep.tsx`.
- Import `addIssueLabel` from `./github/issueApi.ts` and `extractIssueNumberFromBranch` from `./triggers/webhookHandlers.ts`.
- In `buildDefaultDeps`, add:
  ```ts
  applyHitlLabel: async (issueNumber: number) => {
    addIssueLabel(issueNumber, 'hitl', repoInfo);
  },
  ```
  (Note: `addIssueLabel` is synchronous — the async wrapper is for interface consistency with the other deps.)
- In `main()`, after the PR is resolved, derive the issue number explicitly: `const issueNumber = extractIssueNumberFromBranch(pr.headRefName);`. This is robust to the case where the orchestrator's CLI arg is provided but the actual linked-issue number comes from the resolved PR's branch (today they match for `feature-<N>` branches; tomorrow's slice may introduce promotion-by-PR-event with a different branch convention).
- Pass `issueNumber` into `runPromotionCommenter(pr.number, issueNumber, deps)`.
- Log the `hitlLabelApplied` field at the end-of-run log.

### Step 12: Add per-issue BDD scenarios for issue #510

- Create `features/per-issue/feature-510.feature` tagged `@adw-510 @adw-28aysq-hitl-label-tag-lifec`. Five scenarios:
  1. **Posting a comment applies the `hitl` label** — Background sets up worktree, issue, and PR; manifest pre-seeds a high-score scenario with no existing tag. Asserts: `the mock GitHub API recorded a comment on issue 9095`, `the mock GitHub API recorded a hitl label addition on issue 9095`.
  2. **Same-day re-run suppresses duplicate comment** — Manifest pre-seeds a feature file already carrying `@promotion-suggested-<today>` on a high-score scenario. Asserts: `the mock harness recorded zero comment posts on issue 9096`, and the file's tag is unchanged.
  3. **Later-day re-run refreshes the tag date and posts a reminder** — Manifest pre-seeds a feature file already carrying `@promotion-suggested-<an-earlier-date>` on a high-score scenario. Asserts: `the artefact file ... carries a "@promotion-suggested-<today>" tag refreshed to today`, `the mock GitHub API recorded a comment on issue 9097`, `the mock GitHub API recorded a hitl label addition on issue 9097`.
  4. **Score-drop withdraws the tag silently** — Manifest pre-seeds a feature file carrying `@promotion-suggested-<an-earlier-date>` on a scenario that now scores below N (only mock-query phrases). Asserts: `the artefact file ... carries no "@promotion-suggested-" tag on the previously-tagged scenario`, `the mock harness recorded zero comment posts on issue 9098`.
  5. **Withdraw-only run applies no `hitl` label** — Manifest pre-seeds two scenarios both previously tagged, both now below N. Asserts: two tag removals recorded, no comment, no `hitl` label call.
- Each scenario uses the Given-step shape from Step 5 (`a per-issue feature file at ... is seeded ... with an existing "@promotion-suggested-..." tag on the targeted scenario`) so the pre-existing-tag fixture is expressible in Gherkin.

### Step 13: Add mock manifest fixtures

- Create `test/fixtures/jsonl/manifests/promotion-sweep-hitl-applied.json` — follows the slice #4 manifest shape; pre-seeds a per-issue feature file (no existing tag) with a high-score scenario. The manifest's mock-server interactions record the comment POST + the label POST.
- Create `test/fixtures/jsonl/manifests/promotion-sweep-same-day-suppress.json` — pre-seeds a per-issue feature file carrying `@promotion-suggested-<today>` (where `<today>` matches the orchestrator's `today()`). No recorded comment, no recorded label call.
- Create `test/fixtures/jsonl/manifests/promotion-sweep-date-refresh.json` — pre-seeds a per-issue feature file carrying `@promotion-suggested-<an-earlier-date>` (e.g., `2026-05-01`). Records the tag-date refresh artefact + comment POST + label POST.
- Create `test/fixtures/jsonl/manifests/promotion-sweep-score-drop.json` — pre-seeds a per-issue feature file carrying `@promotion-suggested-<an-earlier-date>` on a scenario that now uses only mock-query unregistered phrases. Records the tag removal but no comment, no label.
- Create `test/fixtures/jsonl/manifests/promotion-sweep-withdraw-only-no-hitl.json` — pre-seeds a per-issue feature file with two scenarios both previously tagged, both now below N. Records two tag removals, no comment, no label.
- Each manifest follows the existing slice #4 shape (`{ jsonlPath, edits: [{ path, contents }] }`). The `<today>` literal in the same-day-suppress manifest is a fixed string (e.g., `2026-05-21`) that the per-issue scenario relies on matching the orchestrator's `today()` — this matches the slice #4 convention.

### Step 14: Extend the smoke feature with lifecycle scenarios

- Edit `features/regression/smoke/promotion_commenter.feature`. Append three new `Scenario:` blocks under the existing two:
  - **Same-day suppression** — manifest `promotion-sweep-same-day-suppress.json`. Asserts `the mock harness recorded zero comment posts on issue 509`.
  - **Date refresh + `hitl`** — manifest `promotion-sweep-date-refresh.json`. Asserts `the mock GitHub API recorded a comment on issue 509`, `the mock GitHub API recorded a hitl label addition on issue 509`.
  - **Score-drop withdrawal** — manifest `promotion-sweep-score-drop.json`. Asserts `the mock harness recorded zero comment posts on issue 509`, `the mock harness recorded zero PR-merge calls`.
- Also extend the **existing** high-score smoke scenario in the same file (slice #4's first scenario) with an additional assertion line: `And the mock GitHub API recorded a hitl label addition on issue 509`. This locks the new label-on-comment behaviour into the existing smoke contract without adding a separate scenario.

### Step 15: Update `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` "Notes" section

- Update the file at `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` (lines 87–92).
- Remove the lines noting `hitl` label application, duplicate-suppression, and date-refresh/tag-removal as "Deferred to slice #5" — they are no longer deferred.
- Update the "Known limitation" line (line 91) to remove the documented append-rather-than-refresh behaviour (it is now resolved).
- The other deferral notes (slice #6 webhook wiring; slice #7 auto-ramp; `@promotion` approval detection moving with `promotionMover`) remain.

### Step 16: Update `.adw/conditional_docs.md` (if needed)

- Read `.adw/conditional_docs.md` line 1166 (the `feature-tdauam-promotion-commenter-deep-modules.md` block).
- Confirm the existing trigger condition "When wiring duplicate-suppression, date-refresh, or `hitl` labelling into the promotion flow (slice #5)" already covers this slice — no edit needed. The docs file will be regenerated by `document_agent` after the slice merges; no manual append here.

### Step 17: Run lint + type-check + unit tests

- Run `bun run lint` and confirm zero errors.
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` and confirm zero errors.
- Run `bun run test:unit` and confirm:
  - The new `promotionTagWriter` test cases pass (Step 3 additions).
  - The new `promotionCommenter` test cases pass (Step 10 additions).
  - Zero regressions in pre-existing unit tests (slice #4's coverage, plus all other ADW unit tests).

### Step 18: Run build + smoke validation

- Run `bun run build` and confirm zero errors.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke"` and confirm the smoke suite executes — the new scenarios will report as `pending` (per the existing W1 cutover pattern, consistent with slice #4). No failures.
- Run `bunx tsx adws/adwPromotionSweep.tsx --help 2>&1 | head -20` and confirm the CLI still prints its usage (no regressions in arg parsing).

### Step 19: Run the full validation command set (final check)

Execute every command in the **Validation Commands** section below to confirm zero regressions across lint, type-check, unit tests, build, and BDD smoke scenarios.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`. The two pre-existing test files (`promotionTagWriter.test.ts`, `promotionCommenter.test.ts`) are extended in this slice. No new test files are added.

- **`promotionTagWriter.test.ts`** — eleven new test cases added (five for `detectExistingSuggestionDate`, six for the two new `applyTagState` operations). All are pure-function tests with `expect.toBe(...)` content-equality + byte-position spot-checks. No mocks needed.
- **`promotionCommenter.test.ts`** — nine new test cases added covering the six decision-matrix branches plus three cross-cutting cases (mixed file, withdraw-only, `applyHitlLabel` failure). Uses the existing dep-injection pattern with an additional `applyHitlLabel` mock.

The slice deliberately does not export `decideTagAction` for direct testing — the matrix is fully exercised through the public `runPromotionCommenter` surface, which keeps the module's export footprint tight. If the matrix grows further in slice #6/#7, exporting `decideTagAction` becomes worthwhile.

### Edge Cases

- **Existing `@promotion-suggested-<today>` tag, scenario score drops to below N within the same day** — the commenter removes the tag (silent withdrawal) and does not post a comment. This is the only matrix branch where `'remove-suggestion'` runs against a today-dated tag.
- **Existing `@promotion-suggested-<other-date>` tag, scenario edited to a different position in the file** — the writer locates the existing tag by the **current** scenario header line (post-edit) and the backward-walk. If the existing tag was orphaned (no longer immediately above any scenario header), it is not detected and a new `add-suggestion` is applied. Documented behaviour; the per-file 14-day sweep cleans up orphans eventually.
- **Same-file with two scenarios sharing a tag block** (uncommon in `.feature` files but legal Gherkin) — the writer's backward-walk targets the *nearest* tag block above each scenario header. Each scenario's tag operations are applied to its own block independently; threaded `content` updates preserve byte-positions for the second scenario in the file.
- **`applyHitlLabel` throws (`gh` CLI failure, rate limit)** — the commenter catches and logs at `warn` level. The run returns a `PromotionResult` with `hitlLabelApplied: false`. The PR's auto-merge would still fire if no other `hitl` label is present — this is a known soft-failure mode and is consistent with the rest of ADW's "label application is best-effort" pattern (see `addIssueLabel` in `issueApi.ts` which already swallows errors).
- **Mixed file with one above-threshold and one below-threshold scenario, neither previously tagged** — `add-suggestion` applies to the above; `'no-op'` on the below. One comment, one label. Behaviour matches slice #4 for the above-threshold scenario; the below-threshold scenario is unchanged.
- **`extractIssueNumberFromBranch` returns `null` (unexpected branch name)** — log a warning and skip the `applyHitlLabel` call. The comment still posts. The PR is still discoverable, but the `hitl` gate is best-effort.
- **PR with no per-issue files changed** — the commenter completes silently with zero suggestions, no comment, no label. Behaviour matches slice #4.
- **Tag refresh on a tag-line containing only the suggestion tag** — the line's leading indentation is preserved; only the date substring is replaced. The line is byte-identical except for the 10-character date.
- **Tag removal on a tag-line where the suggestion tag is the only token after leading whitespace** — the entire line is removed. The file shrinks by one line.
- **Tag removal leaves an empty tag-line** — should not happen because tag removal removes the whole line in the single-tag case. Defensive: if it somehow does, the empty line is left in place (no auto-clean-up); the next agent run inserts new tags normally.

## Acceptance Criteria

- [ ] `adws/promotion/types.ts` `TagState` is widened to `'add-suggestion' | 'refresh-date' | 'remove-suggestion'`.
- [ ] `adws/promotion/promotionTagWriter.ts` exports `detectExistingSuggestionDate(content, scenarioHeaderLine): string | null`.
- [ ] `adws/promotion/promotionTagWriter.ts` `applyTagState` implements all three operations with byte-exact preservation of non-modified lines.
- [ ] `adws/promotion/__tests__/promotionTagWriter.test.ts` covers every branch of the three operations plus the query helper, with at least eleven new test cases.
- [ ] `adws/promotion/promotionCommenter.ts` `PromotionCommenterDeps` includes `applyHitlLabel: (issueNumber: number) => Promise<void>`.
- [ ] `adws/promotion/promotionCommenter.ts` `runPromotionCommenter` takes `(prNumber, issueNumber, deps)` and applies the six-row decision matrix per scenario.
- [ ] `adws/promotion/promotionCommenter.ts` posts the `hitl` label exactly when at least one scenario is comment-eligible; withdrawal-only runs apply no label.
- [ ] `adws/promotion/__tests__/promotionCommenter.test.ts` covers all six decision-matrix branches plus the three cross-cutting cases (mixed file, withdraw-only, `applyHitlLabel` failure).
- [ ] `adws/adwPromotionSweep.tsx` wires `applyHitlLabel` via `addIssueLabel(issueNumber, 'hitl', repoInfo)` and derives the issue number via `extractIssueNumberFromBranch(pr.headRefName)`.
- [ ] `features/per-issue/feature-510.feature` exists, is tagged `@adw-510 @adw-28aysq-hitl-label-tag-lifec`, and contains the five lifecycle scenarios.
- [ ] `features/regression/smoke/promotion_commenter.feature` is extended with three new lifecycle scenarios (same-day suppression, date refresh, score-drop withdrawal) plus a `hitl` label assertion on the existing high-score scenario.
- [ ] `features/regression/vocabulary.md` has three new vocabulary rows (T16, T17, T18 or whatever the next free numbers are) covering label-recorded, tag-removed, and tag-refreshed assertions.
- [ ] `features/regression/step_definitions/thenSteps.ts` (or analogous) has pending-pattern step definitions for the new vocabulary phrases.
- [ ] `features/regression/step_definitions/givenSteps.ts` has a pending-pattern step definition for the seed-with-existing-tag Given phrase.
- [ ] Five new manifest fixtures land under `test/fixtures/jsonl/manifests/`: `promotion-sweep-hitl-applied.json`, `promotion-sweep-same-day-suppress.json`, `promotion-sweep-date-refresh.json`, `promotion-sweep-score-drop.json`, `promotion-sweep-withdraw-only-no-hitl.json`.
- [ ] `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` "Notes" section is updated to remove the slice #5 deferrals (now resolved) and the known-limitation note.
- [ ] `bun run lint` passes with zero errors.
- [ ] `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` pass with zero errors.
- [ ] `bun run test:unit` passes with zero regressions and the extended test files all green.
- [ ] `bun run build` passes with zero errors.
- [ ] `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke"` executes without unexpected failures (new scenarios may be `pending` per the existing W1 cutover pattern).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

Per `.adw/commands.md`:

- `bun install` — Install dependencies (no new packages expected this slice; runs as a no-op safety check).
- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Type-check the whole repo with the widened `TagState` and new signature.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type-check scoped to `adws/`.
- `bun run test:unit` — Run all Vitest unit tests, including the extended `promotionTagWriter.test.ts` and `promotionCommenter.test.ts` files. Confirm zero failures and zero regressions.
- `bun run build` — Build the application to verify no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke"` — Run the regression smoke suite, including the extended `promotion_commenter.feature`. Following the existing pending pattern for W1, the new scenarios will report as `pending` rather than failing — this is the documented contract until the harness gains full subprocess support, consistent with slice #4.
- `bunx tsx adws/adwPromotionSweep.tsx --help 2>&1 | head -20` — Smoke-test that the orchestrator script is still executable and prints its usage with the updated signature.

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` is followed strictly: TypeScript strict mode, no `any`, guard clauses for the decision matrix, declarative-over-imperative for the per-scenario loop, max nesting depth ~2 in `runPromotionCommenter` (the inner `for (scenario)` loop body is a single straight-line sequence of pure-function calls with early-continue guards). No decorators.
- **The `hitl` label lives on the issue, not the PR.** This matches the existing `adwMerge.tsx` gate (`issueHasLabel(issueNumber, 'hitl', repoInfo)`) and the existing `addIssueLabel` helper. A separate `addPRLabel` helper is **not** added in this slice — if a future slice needs PR-level labels, it can land alongside the requirement that motivates it.
- **No new dependencies.** `@cucumber/gherkin` and `@cucumber/messages` are already in `package.json` from slice #4. No `bun add` needed.
- **No webhook wiring in this slice.** The orchestrator is still invoked manually via `bunx tsx adws/adwPromotionSweep.tsx <issueNumber> [adwId]`. Slice #6 wires the webhook.
- **No `runWithOrchestratorLifecycle` wrapping in this slice.** Duplicate-suppression is now data-driven (the existing `@promotion-suggested-<today>` tag is the suppression signal), so spawn-lock wrapping is not required to prevent duplicate comments. Adding it would still be valuable defensively but is out of scope here; it can land in slice #6 alongside the webhook trigger.
- **`@promotion` (no-date) approval detection is still deferred.** The PRD's promotion-approval flow (User Story 11: human edits `@promotion-suggested-<date>` → `@promotion`) is the `promotionMover` slice's responsibility, not this slice. `promotionCommenter` continues to ignore `@promotion` (no date) tags — it neither refreshes them nor removes them.
- **Tag-line preservation contract.** The new `'refresh-date'` operation modifies exactly one date substring inside one tag line; all other characters on that line and all other lines in the file are byte-identical. The new `'remove-suggestion'` operation either removes a token + its single-space separator from a tag line (when the line has multiple tags) or removes the whole line (when the suggestion tag is the only one). Both operations are tested with byte-position spot-checks.
- **Idempotency.** Running the commenter twice in the same day on the same PR produces the same file content after both runs (no-op suppression on the second run). Running twice with two different `today()` values produces the second-day's refreshed tag without accumulating multiple `@promotion-suggested-*` tags.
- **`hitl` label is also idempotent at the GitHub API.** `gh issue edit --add-label hitl` on an issue that already has the label is a no-op (GitHub deduplicates). The commenter does not check `issueHasLabel` before calling `addIssueLabel` — the call itself is cheap and safe.
- **Decision-matrix simplicity.** The matrix is six rows but easily expressible as a small switch-on-existing-date with an inner check on `scoreMeetsThreshold`. The pure-helper extraction (`decideTagAction`) is deliberate so the matrix is unit-testable and visible in one place; coalescing the logic inline would obscure the intent.
- **Withdrawal is silent.** No comment, no label, no separate notification. The PRD's User Story 13 calls out that "ignored suggestions die naturally at the 14-day sweep — no escalation, no nagging"; the symmetrical position for withdrawal is that *invalidated* suggestions also die quietly. The author who edited the scenario into below-threshold form will see the tag removal in their next `git diff` — that is the only signal.
