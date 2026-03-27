# Feature: Add HITL label gate to prevent auto-merge

## Metadata
issueNumber: `329`
adwId: `fygx90-add-hitl-label-gate`
issueJson: `{"number":329,"title":"Add hitl label gate to prevent auto-merge","body":"## Problem\n\nAuto-merge is aggressive — it fires at the end of review orchestrators (`adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwSdlc`) and automatically approves + merges the PR with no human checkpoint. For issues that require human review before merging, there is no way to signal this.\n\n## Solution\n\nAdd a `hitl` (human-in-the-loop) GitHub label gate to `executeAutoMergePhase`. When the label is present on the issue, the orchestrator skips both PR approval and merge, leaving the PR open for a human to approve and merge manually.\n\n## Design\n\n### Check point\n- Single check at the top of `executeAutoMergePhase` via a fresh `gh issue view --json labels` call\n- New helper: `issueHasLabel(issueNumber, labelName, repoInfo): boolean` in `issueApi.ts`\n- Real-time check — label can be added/removed at any point during the workflow and is respected at auto-merge time\n\n### Behavior when `hitl` detected\n1. Skip `approvePR()` entirely\n2. Skip `mergeWithConflictResolution()` entirely\n3. Post comment on the **issue**: `## ✋ Awaiting human approval — PR #N ready for review`\n4. Return empty cost record (same as other skip paths)\n5. Log: `hitl label detected, skipping auto-approval and auto-merge`\n\n### Webhook path\nUntouched. Since the bot never approves HITL issues, any `pull_request_review` approved event is by definition human — webhook auto-merge proceeds normally.\n\n### Completion comment\nUnchanged. `## ✅ Workflow completed` still posts — it means \"ADW's work is done\", not \"PR is merged.\"\n\n### Edge case: label removed after skip\nNo retry mechanism. The orchestrator has already exited. Human merges manually.\n\n## Files to change\n\n- `adws/github/issueApi.ts` — add `issueHasLabel()` helper\n- `adws/phases/autoMergePhase.ts` — add `hitl` label check, skip approval + merge, post issue comment\n- `UBIQUITOUS_LANGUAGE.md` — add `hitl` term definition\n\n## Acceptance criteria\n\n- [ ] `executeAutoMergePhase` skips approval and merge when the issue has the `hitl` label\n- [ ] A `## ✋ Awaiting human approval` comment is posted on the issue when auto-merge is skipped\n- [ ] Webhook auto-merge path is unaffected\n- [ ] `hitl` is defined in `UBIQUITOUS_LANGUAGE.md`\n- [ ] Label is checked in real time (not cached from workflow start)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T09:02:58Z","comments":[],"actionableComment":null}`

## Feature Description
Add a `hitl` (human-in-the-loop) GitHub label gate to `executeAutoMergePhase`. When the `hitl` label is present on the issue being processed, the auto-merge phase skips both PR approval and merge, leaving the PR open for a human to review and merge manually. This provides a simple opt-in mechanism for issues that require human oversight before code lands on the default branch.

## User Story
As a repository maintainer
I want to add a `hitl` label to issues that require human review
So that the ADW workflow leaves the PR open for manual approval and merge instead of auto-merging

## Problem Statement
Auto-merge fires unconditionally at the end of review orchestrators (`adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwSdlc`), automatically approving and merging the PR with no human checkpoint. There is no way to signal that a particular issue requires human review before merging.

## Solution Statement
Add a label-based gate at the top of `executeAutoMergePhase`. A new `issueHasLabel()` helper in `issueApi.ts` performs a fresh `gh issue view --json labels` call at auto-merge time (real-time, not cached). When the `hitl` label is detected, the phase skips approval and merge, posts a comment on the issue notifying the human, and returns an empty cost record. The webhook auto-merge path remains untouched — since the bot never approves HITL issues, any human approval event triggers the existing webhook merge flow normally.

## Relevant Files
Use these files to implement the feature:

- `adws/github/issueApi.ts` — Contains all GitHub issue API helpers (fetch, comment, close, state). The new `issueHasLabel()` helper will be added here, following existing patterns (`getIssueState`, `getIssueTitleSync`) for `gh issue view --json` calls.
- `adws/github/githubApi.ts` — Re-exports from `issueApi.ts`. Must add the new `issueHasLabel` export.
- `adws/github/index.ts` — Module barrel file. Must add the new `issueHasLabel` export.
- `adws/phases/autoMergePhase.ts` — The auto-merge phase implementation. The `hitl` label check, skip logic, and issue comment will be added here.
- `UBIQUITOUS_LANGUAGE.md` — DDD glossary. The `hitl` term definition will be added here.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

### New Files
No new files are required. All changes are modifications to existing files.

## Implementation Plan
### Phase 1: Foundation
Add the `issueHasLabel()` helper function in `issueApi.ts`. This is a generic, reusable utility that checks whether a given label exists on a GitHub issue by performing a fresh `gh issue view --json labels` call. Re-export it through `githubApi.ts` and `index.ts`.

### Phase 2: Core Implementation
Modify `executeAutoMergePhase` in `autoMergePhase.ts` to call `issueHasLabel(issueNumber, 'hitl', repoInfo)` immediately after the `repoInfo` guard (before the approval step). When detected:
1. Log: `hitl label detected on issue #N, skipping auto-approval and auto-merge`
2. Post a comment on the issue: `## ✋ Awaiting human approval — PR #N ready for review`
3. Return early with empty cost record (same pattern as other skip paths)

### Phase 3: Integration
Add the `hitl` term to `UBIQUITOUS_LANGUAGE.md` in the appropriate section. No other integration work is needed — the webhook path (`autoMergeHandler.ts`) is untouched, and the completion comment remains unchanged.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Add `issueHasLabel()` helper to `issueApi.ts`
- Add a new exported function `issueHasLabel(issueNumber: number, labelName: string, repoInfo: RepoInfo): boolean`
- Use `execWithRetry` to run `gh issue view {issueNumber} --repo {owner}/{repo} --json labels`
- Parse the JSON response and check if any label's `name` matches `labelName` (case-sensitive)
- Return `true` if found, `false` otherwise
- On error, log a warning and return `false` (non-fatal — if label check fails, proceed with normal auto-merge)
- Follow existing patterns in `issueApi.ts` (e.g., `getIssueState` for structure, `getIssueTitleSync` for error handling)

### Step 2: Re-export `issueHasLabel` through barrel files
- Add `issueHasLabel` to the re-export list in `adws/github/githubApi.ts` (alongside `getIssueState`, `getIssueTitleSync`, etc.)
- Add `issueHasLabel` to the export list in `adws/github/index.ts`

### Step 3: Add HITL label gate to `executeAutoMergePhase`
- Import `issueHasLabel` and `commentOnIssue` from `../github`
- After the `repoInfo` construction and before the spec path resolution, add the `hitl` label check:
  - Call `issueHasLabel(issueNumber, 'hitl', repoInfo)`
  - If `true`:
    - Log: `hitl label detected on issue #${issueNumber}, skipping auto-approval and auto-merge`
    - Post comment on the issue using `commentOnIssue(issueNumber, '## ✋ Awaiting human approval — PR #${prNumber} ready for review', repoInfo)`
    - Return `{ costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] }`
- The existing approval and merge logic remains untouched for the non-HITL path

### Step 4: Add `hitl` term to `UBIQUITOUS_LANGUAGE.md`
- Add a new entry in the "Issue lifecycle" table:
  - **Term:** `HITL`
  - **Definition:** A GitHub label (`hitl`) applied to an Issue to gate auto-merge. When present at auto-merge time, the Orchestrator skips PR approval and merge, leaving the PR open for human review. The label is checked in real time via a fresh API call, not cached from Workflow start.
  - **Aliases to avoid:** human-review, manual-merge, hold

### Step 5: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bun run build` to verify no build errors
- Run `bunx tsc --noEmit` to verify TypeScript types
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW-specific types

## Testing Strategy
### Edge Cases
- Issue has no labels at all — `issueHasLabel` returns `false`, auto-merge proceeds normally
- Issue has other labels but not `hitl` — auto-merge proceeds normally
- `gh issue view` call fails (network error, rate limit) — `issueHasLabel` returns `false`, auto-merge proceeds normally (fail-open design, matching issue's design intent)
- `hitl` label added after workflow starts but before auto-merge phase — detected because the check is real-time
- `hitl` label removed after skip — no retry mechanism; human merges manually (documented edge case)
- No PR URL found — existing skip logic handles this before the label check
- No repo context — existing skip logic handles this before the label check

## Acceptance Criteria
- `executeAutoMergePhase` skips approval and merge when the issue has the `hitl` label
- A `## ✋ Awaiting human approval` comment is posted on the issue when auto-merge is skipped
- Webhook auto-merge path (`autoMergeHandler.ts`) is unaffected — no changes to that file
- `hitl` is defined in `UBIQUITOUS_LANGUAGE.md`
- Label is checked in real time via a fresh `gh issue view --json labels` call (not cached from workflow start)
- When the label check fails (API error), auto-merge proceeds normally (fail-open)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check

## Notes
- The `issueHasLabel()` function is intentionally generic (accepts any `labelName`) rather than hardcoded to `hitl`, making it reusable for future label-based gates.
- Fail-open design: if the label check API call fails, auto-merge proceeds normally. This matches the principle that the label is a deliberate opt-in to block merging — absence of confirmation should not block.
- No changes to `autoMergeHandler.ts` (webhook path) — the webhook fires on `pull_request_review` approved events, and since the bot never approves HITL issues, any approval event is by definition human-initiated.
- Follow coding guidelines: use `execWithRetry` for the `gh` CLI call, meaningful variable names, JSDoc on the new function, and re-export through barrel files.
