# Chore: Distribute PR review board move out of completion handler

## Metadata
issueNumber: `421`
adwId: `f1f94g-pr-review-distribute`
issueJson: `{"number":421,"title":"PR review: distribute board move out of completion handler","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nThe PRD's distributed board move pattern (Q36 from the original grill, see project memory `project_test_review_refactor.md`) was applied to the main workflow but missed for PR review. The main workflow distributes board moves across phases (`buildPhase.ts:42`, `unitTestPhase.ts:53`, `prPhase.ts:92`, etc.). PR review still has its `BoardStatus.Review` move centralized in `completePRReviewWorkflow` (`prReviewCompletion.ts:59`).\n\nThis is the only piece of real work `completePRReviewWorkflow` still does — its docstring even acknowledges it: *\"Completes the PR review workflow: builds cost section, writes final state, posts completion comment, **moves board status**, and logs banner.\"* The presence of the board move contradicts the \"completion handlers contain only terminal-state work\" principle that the prior session's cleanup was meant to enforce.\n\nMove the `repoContext.issueTracker.moveToStatus(config.base.issueNumber, BoardStatus.Review)` call from `prReviewCompletion.ts:59` into `executePRReviewCommitPushPhase` in `prReviewPhase.ts`. That phase represents the natural \"PR is now ready for review\" boundary — the same role that `prPhase.ts:92` plays in the main workflow. Update the `completePRReviewWorkflow` docstring to remove the \"moves board status\" claim.\n\n## Acceptance criteria\n\n- [ ] `repoContext.issueTracker.moveToStatus(..., BoardStatus.Review)` removed from `completePRReviewWorkflow` in `prReviewCompletion.ts`\n- [ ] Same move added to `executePRReviewCommitPushPhase` in `prReviewPhase.ts`\n- [ ] `completePRReviewWorkflow` docstring updated to no longer claim it moves the board\n- [ ] `BoardStatus` import removed from `prReviewCompletion.ts` if no longer used\n- [ ] Existing PR review tests still pass\n- [ ] Type check (`bunx tsc --noEmit`) and lint (`bun run lint`) pass\n- [ ] Manual smoke test: run a PR review workflow against a real PR with a connected issue tracker, confirm the board moves to `Review` at the commit+push phase boundary (not at the completion phase)\n\n## Blocked by\n\nNone - can start immediately. Follow-up to the closed test/review refactor.\n\n## User stories addressed\n\n- User story 28 (from parent PRD) — distributed board status update pattern","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T21:39:49Z","comments":[{"author":"paysdoc","createdAt":"2026-04-09T08:27:03Z","body":"## Take action"}],"actionableComment":null}`

## Chore Description
The distributed board move pattern (from the test/review refactor PRD, Q36) was applied to the main workflow but missed for PR review. The main workflow distributes `BoardStatus` moves across individual phases (`prPhase.ts:91`), but PR review still centralizes its `BoardStatus.Review` move in `completePRReviewWorkflow` (`prReviewCompletion.ts:59`). This contradicts the "completion handlers contain only terminal-state work" principle.

The fix: move the `repoContext.issueTracker.moveToStatus(config.base.issueNumber, BoardStatus.Review)` call from `completePRReviewWorkflow` into `executePRReviewCommitPushPhase` in `prReviewPhase.ts`, which is the natural "PR is now ready for review" boundary. Clean up the import and docstring in `prReviewCompletion.ts`.

## Relevant Files
Use these files to resolve the chore:

- `adws/phases/prReviewCompletion.ts` — Contains the `completePRReviewWorkflow` function with the board move to remove (line 59), the `BoardStatus` import to remove (line 11), and the docstring to update (lines 43-45).
- `adws/phases/prReviewPhase.ts` — Contains `executePRReviewCommitPushPhase` where the board move should be added. Needs a `BoardStatus` import added.
- `adws/phases/prPhase.ts` — Reference for the distributed board move pattern (lines 91-96). Shows the try/catch + log pattern to follow.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `app_docs/feature-s59wpc-adwprreview-phaserunner-migration.md` — Context on the PR review PhaseRunner migration (conditional doc, matched by working with `prReviewPhase.ts` and `prReviewCompletion.ts`).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add board move to `executePRReviewCommitPushPhase` in `prReviewPhase.ts`

- Add `BoardStatus` to the existing import from `../providers/types` on line 16. Change `import type { RepoContext, RepoIdentifier } from '../providers/types';` to include `BoardStatus` as a value import (not type-only, since it's an enum used at runtime): `import { BoardStatus, type RepoContext, type RepoIdentifier } from '../providers/types';`
- In `executePRReviewCommitPushPhase`, after the `pushBranch` call (line 334) and the `postPRStageComment` block (lines 335-337), add the board move using the same try/catch + log pattern from `prPhase.ts:91-96`:
  ```typescript
  // Transition issue to Review status now that the PR changes are pushed
  if (repoContext && config.base.issueNumber) {
    try {
      await repoContext.issueTracker.moveToStatus(config.base.issueNumber, BoardStatus.Review);
      log(`Issue #${config.base.issueNumber} moved to Review`, 'success');
    } catch (error) {
      log(`Failed to move issue #${config.base.issueNumber} to Review: ${error}`, 'error');
    }
  }
  ```
- Note: The existing code in `completePRReviewWorkflow` does not wrap the call in try/catch, but the main workflow's `prPhase.ts` does. Follow the `prPhase.ts` pattern for consistency and resilience.

### Step 2: Remove board move from `completePRReviewWorkflow` in `prReviewCompletion.ts`

- Remove the board move block from `completePRReviewWorkflow` (lines 58-60):
  ```typescript
    if (config.base.issueNumber) {
      await repoContext.issueTracker.moveToStatus(config.base.issueNumber, BoardStatus.Review);
    }
  ```
- This leaves the `if (repoContext)` block containing only the `postPRStageComment` call, which is correct terminal-state work.

### Step 3: Remove `BoardStatus` import from `prReviewCompletion.ts`

- Remove `BoardStatus` from the import on line 11: `import { BoardStatus } from '../providers/types';`
- Verify no other usage of `BoardStatus` exists in the file (there is none — it was only used on line 59).

### Step 4: Update `completePRReviewWorkflow` docstring in `prReviewCompletion.ts`

- Update the JSDoc comment (lines 43-45) from:
  ```
  Completes the PR review workflow: builds cost section, writes final state,
  posts completion comment, moves board status, and logs banner.
  ```
  to:
  ```
  Completes the PR review workflow: builds cost section, writes final state,
  posts completion comment, and logs banner.
  ```
- Remove "moves board status, " from the description.

### Step 5: Run validation commands

- Run all validation commands below to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws subproject
- `bun run build` — Build the application to verify no build errors

## Notes
- Follow the `guidelines/coding_guidelines.md` coding guidelines strictly.
- The `prPhase.ts:91-96` pattern wraps the board move in try/catch so a tracker API failure doesn't crash the workflow. The existing `prReviewCompletion.ts` code does not have this guard. The new code in `prReviewPhase.ts` should use the try/catch pattern for consistency.
- The `executePRReviewCommitPushPhase` function is already `async`, so no signature change is needed for the `await` call.
- No test files exist for `prReviewCompletion.ts` or `prReviewPhase.ts` (verified by searching `**/*.test.*` for references). The acceptance criterion "Existing PR review tests still pass" is satisfied by the type check and lint passing.
- The manual smoke test (acceptance criterion 7) is outside the scope of automated validation and should be performed by the developer.
