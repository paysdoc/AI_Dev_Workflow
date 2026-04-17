# Bug: Move PR approval into reviewPhase; autoMergePhase reads approval state

## Metadata
issueNumber: `434`
adwId: `zyjh0z-move-pr-approval-int`
issueJson: `{"number":434,"title":"Move PR approval into reviewPhase; autoMergePhase reads approval state","body":"## Problem\n\nObserved on PR #433 merge logs:\n\n- `approvePR` retried 3× with an invalid auth (`gh auth login` / `GH_TOKEN` not found), logging three `execWithRetry failed` errors.\n- The PR merged anyway with **zero reviews on record** (`gh pr view 433 --json reviews → []`), because approval failure is non-fatal in `autoMergePhase.ts:91-93`.\n\nTwo defects compound: the approval mechanism is fragile (macOS-Keychain-dependent, breaks in webhook-spawned processes), and the merge gate is decorative (approval failure does not block merge).\n\n## Root causes\n\n1. **`approvePR` mechanism** — `adws/github/prApi.ts:222-223` does `delete process.env.GH_TOKEN` and relies on `gh`'s fallback to the `gh auth login` session. On macOS, that token lives in the login Keychain. Processes spawned outside the user's login security session (e.g. the webhook server) cannot read it. The token did not expire — it was inaccessible to that process.\n2. **Approval not gating merge** — `adws/phases/autoMergePhase.ts:91-93` logs approval failure as non-fatal and proceeds to `mergeWithConflictResolution`. The GitHub App token has write access, and `main`'s branch protection does not require an approving review, so the App merges its own PR without any review record.\n3. **Retry noise** — `adws/core/utils.ts:33-37` `NON_RETRYABLE_PATTERNS` does not cover auth errors, so every doomed auth call retries 3× with exponential backoff.\n\n## Design\n\nApproval is the review phase's responsibility. Auto-merge checks approval state and acts — it does not produce approval.\n\n### `approvePR` mechanism (`adws/github/prApi.ts`)\n\nReplace the `delete GH_TOKEN` hack with the PAT-swap pattern already used by `projectBoardApi.ts:238-243`:\n\n- Save `process.env.GH_TOKEN`\n- Set `process.env.GH_TOKEN = GITHUB_PAT`\n- Call `gh pr review --approve`\n- Restore `GH_TOKEN` in `finally`\n\n### Responsibility split\n\n- **`adws/phases/reviewPhase.ts`** — on review pass, call `approvePR` as the final step. Approval failure is logged but the phase still returns success. No `hitl` manipulation here.\n- **`adws/phases/autoMergePhase.ts`** — remove all `approvePR` / `isGitHubAppConfigured` references. New gate: fetch `gh pr view <n> --json reviews` and require at least one entry with `state: APPROVED`. GitHub is the source of truth, not internal state.\n  - Approval present → `mergeWithConflictResolution`.\n  - Approval absent → apply `hitl` label, post \"Awaiting human approval\" comment **once**, skip merge.\n- **Existing `hitl` gate** at `autoMergePhase.ts:67-75` — becomes a silent early-return. The comment moves to the no-approval branch only. Prevents comment floods on every cron re-entry while the issue sits in `awaiting_merge` with `hitl` set.\n\n### Orchestrator inline approves — remove\n\nDrop the four inline `approvePR` callsites, now redundant:\n\n- `adws/adwChore.tsx:164`\n- `adws/adwSdlc.tsx:142`\n- `adws/adwPlanBuildReview.tsx:114`\n- `adws/adwPlanBuildTestReview.tsx:134`\n\n### Startup validation\n\nIn `adws/phases/workflowInit.ts` (or an adjacent config guard): if `isGitHubAppConfigured()` and `!GITHUB_PAT`, throw with a clear message. Fail loudly before any phase runs — don't silently degrade to per-run manual fallback.\n\n### Retry non-retryable auth errors (`adws/core/utils.ts`)\n\nExtend `NON_RETRYABLE_PATTERNS` with auth markers:\n\n- `'gh auth login'`\n- `'GH_TOKEN'`\n- `'HTTP 401'`\n- `'Bad credentials'`\n- `'authentication'`\n\nAffects all `gh`-CLI callsites. Cuts log noise on any future auth misconfiguration, not just approve.\n\n### BDD scenarios\n\n- `features/auto_approve_merge_after_review.feature:47-49` and `features/step_definitions/autoApproveMergeAfterReviewSteps.ts:55-84` currently assert `delete process.env.GH_TOKEN`. Rewrite to assert the PAT-swap + restore contract.\n- New scenarios:\n  - `reviewPhase` calls `approvePR` on review pass\n  - `autoMergePhase` blocks merge when `gh pr view --json reviews` returns no `APPROVED` state\n  - `autoMergePhase` applies `hitl` and comments once when approval is absent\n  - `autoMergePhase` silently skips (no comment) on re-entry with `hitl` already present\n  - Workflow fails at startup when GitHub App is configured but `GITHUB_PAT` is missing\n\n## Acceptance criteria\n\n- `approvePR` sets `GH_TOKEN = GITHUB_PAT` (no `delete`) and restores the app token in `finally`.\n- `reviewPhase` calls `approvePR` after a pass verdict; failure is logged but non-fatal to the review phase itself.\n- `autoMergePhase` no longer calls `approvePR` or `isGitHubAppConfigured`. It reads `gh pr view --json reviews`, merges only when an `APPROVED` review is present, otherwise applies `hitl`, posts the notification comment once, and exits.\n- The existing `hitl` label gate no longer emits a comment.\n- Orchestrators `adwChore`, `adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview` no longer contain inline `approvePR` logic.\n- Workflow startup throws when GitHub App is configured without `GITHUB_PAT`.\n- `execWithRetry` does not retry auth errors.\n- BDD scenarios updated and the new ones pass.\n\n## Out of scope\n\nMinor platform bindings (BSD-ism in `lsof +D`, `stat.birthtimeMs`, `brew install` hint text). Tracked separately if needed.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-16T20:42:43Z","comments":[],"actionableComment":null}`

## Bug Description
On PR #433, `approvePR` retried 3 times with an invalid auth mechanism (`delete process.env.GH_TOKEN` falls back to macOS Keychain, which is inaccessible to webhook-spawned processes), logging three `execWithRetry failed` errors. The PR then merged with zero reviews on record because approval failure is non-fatal in `autoMergePhase.ts:91-93`. Two defects compound: the approval mechanism is fragile, and the merge gate is decorative.

**Expected behaviour:** PR approval uses a reliable auth mechanism (PAT swap); merge is gated on an actual `APPROVED` review recorded in GitHub.

**Actual behaviour:** `approvePR` deletes `GH_TOKEN`, `gh` cannot access the macOS Keychain in non-login sessions, approval silently fails, and the merge proceeds anyway with no review record.

## Problem Statement
Three root causes:
1. `approvePR` in `prApi.ts:222-223` uses `delete process.env.GH_TOKEN` instead of the proven PAT-swap pattern from `projectBoardApi.ts:238-243`, making it Keychain-dependent and broken in non-interactive contexts.
2. `autoMergePhase.ts:91-93` treats approval failure as non-fatal and proceeds to merge — the approval gate is cosmetic.
3. `NON_RETRYABLE_PATTERNS` in `utils.ts:33-37` does not include auth errors, causing 3× retries of doomed auth calls.

Additionally, approval responsibility is scattered: `autoMergePhase.ts` and all four review orchestrators (`adwChore`, `adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`) each contain inline `approvePR` logic with duplicated `hitl` checks.

## Solution Statement
1. Fix `approvePR` to use the PAT-swap pattern (`GITHUB_PAT`) instead of `delete GH_TOKEN`.
2. Move approval responsibility into `reviewPhase.ts` — on review pass, call `approvePR` as the final step.
3. Rewrite `autoMergePhase.ts` to read approval state from GitHub (`gh pr view --json reviews`) and only merge when an `APPROVED` review exists. When absent, apply `hitl` label and post a one-time comment.
4. Remove all inline `approvePR` logic from the four orchestrators.
5. Add startup validation: fail loudly when `isGitHubAppConfigured()` and `!GITHUB_PAT`.
6. Extend `NON_RETRYABLE_PATTERNS` with auth error markers.
7. Update BDD scenarios to match the new contract.

## Steps to Reproduce
1. Configure a GitHub App and run an orchestrator (e.g., `adwSdlc`) from a webhook-spawned process (non-login security session).
2. Observe `approvePR` fails 3× with `gh auth login` / `GH_TOKEN not found` errors.
3. Observe the PR merges anyway with `gh pr view <n> --json reviews → []`.

## Root Cause Analysis
**Root cause 1 — Fragile auth mechanism:** `approvePR()` at `adws/github/prApi.ts:222-223` does `delete process.env.GH_TOKEN` to force `gh` to fall back to the `gh auth login` session (macOS Keychain). In webhook-spawned processes running outside the user's login security session, the Keychain is inaccessible. The `projectBoardApi.ts:238-243` already solves this correctly: save the current `GH_TOKEN`, set `GH_TOKEN = GITHUB_PAT`, execute the command, restore in `finally`.

**Root cause 2 — Decorative merge gate:** `autoMergePhase.ts:91-93` logs approval failure as `warn` and proceeds to `mergeWithConflictResolution()`. Since the GitHub App token has write access and branch protection doesn't require an approving review, the App merges its own PR.

**Root cause 3 — Retry noise:** `NON_RETRYABLE_PATTERNS` at `utils.ts:33-37` only covers `No commits between`, `already exists`, and `is not mergeable`. Auth errors (`gh auth login`, `GH_TOKEN`, `HTTP 401`, `Bad credentials`, `authentication`) are not listed, so each doomed call retries 3× with exponential backoff.

**Root cause 4 — Scattered responsibility:** Approval is duplicated in `autoMergePhase.ts` and inline in all four orchestrators. The design should be: review phase produces approval, auto-merge phase reads approval state.

## Relevant Files
Use these files to fix the bug:

- `adws/github/prApi.ts` — Contains `approvePR()` which needs the PAT-swap fix. Also needs a new `fetchPRApprovalState()` function.
- `adws/phases/reviewPhase.ts` — Needs `approvePR` call after review pass verdict.
- `adws/phases/autoMergePhase.ts` — Needs complete rewrite: remove `approvePR`/`isGitHubAppConfigured` imports, add approval-state gate via `gh pr view --json reviews`, add `hitl` label application and one-time comment.
- `adws/core/utils.ts` — `NON_RETRYABLE_PATTERNS` needs auth error markers.
- `adws/phases/workflowInit.ts` — Needs startup validation for `isGitHubAppConfigured() && !GITHUB_PAT`.
- `adws/core/environment.ts` — Exports `GITHUB_PAT` used in the PAT-swap.
- `adws/github/githubAppAuth.ts` — Exports `isGitHubAppConfigured()` used in startup validation.
- `adws/github/issueApi.ts` — Contains `issueHasLabel()` and `commentOnIssue()` used in the new autoMergePhase. Needs a new `addIssueLabel()` function for applying `hitl`.
- `adws/github/index.ts` — Barrel re-exports: needs `fetchPRApprovalState` and `addIssueLabel` added.
- `adws/adwChore.tsx` — Remove inline `approvePR`/`isGitHubAppConfigured`/`issueHasLabel`/`commentOnIssue` approval block (~lines 155-169).
- `adws/adwSdlc.tsx` — Remove inline approval block (~lines 133-148).
- `adws/adwPlanBuildReview.tsx` — Remove inline approval block (~lines 104-119).
- `adws/adwPlanBuildTestReview.tsx` — Remove inline approval block (~lines 124-139).
- `adws/adwBuildHelpers.ts` — Exports `extractPrNumber()` used by orchestrators (unchanged, but referenced).
- `adws/phases/index.ts` — Phase barrel re-exports (unchanged).
- `adws/workflowPhases.ts` — Top-level barrel re-exports (unchanged).
- `features/auto_approve_merge_after_review.feature` — BDD scenarios for approvePR and autoMergePhase. Needs updates for PAT-swap and new autoMergePhase behaviour.
- `features/step_definitions/autoApproveMergeAfterReviewSteps.ts` — Step definitions need updates for PAT-swap assertions (replace `delete process.env.GH_TOKEN` check with `GITHUB_PAT` check).
- `features/hitl_label_gate_automerge.feature` — BDD scenarios for HITL gate. Needs updates: hitl gate becomes silent early-return, comment moves to no-approval branch.
- `features/orchestrator_awaiting_merge_handoff.feature` — BDD scenarios for orchestrator handoff. Needs updates: remove `approvePR` assertions from orchestrators.
- `adws/core/__tests__/execWithRetry.test.ts` — Vitest tests for `execWithRetry`. Needs new tests for auth error non-retryable patterns.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

### New Files
- `features/move_approval_to_review_phase.feature` — New BDD scenarios for: reviewPhase calls approvePR on pass, autoMergePhase blocks on missing approval, autoMergePhase applies hitl + comments once, silent skip on re-entry with hitl, startup validation.
- `features/step_definitions/moveApprovalToReviewPhaseSteps.ts` — Step definitions for the new feature file.

## Step by Step Tasks

### Step 1: Fix `approvePR` to use PAT-swap pattern (`adws/github/prApi.ts`)
- Replace `delete process.env.GH_TOKEN` at line 223 with the PAT-swap pattern from `projectBoardApi.ts:238-243`.
- Import `GITHUB_PAT` from `../core/environment`.
- Import `isGitHubAppConfigured` from `./githubAppAuth`.
- New logic:
  - Save `process.env.GH_TOKEN` to `savedToken`.
  - If `isGitHubAppConfigured() && GITHUB_PAT`, set `process.env.GH_TOKEN = GITHUB_PAT`.
  - Call `gh pr review --approve`.
  - In `finally`, restore `savedToken` (if defined set it back, else delete).
- Keep the same return signature `{ success: boolean; error?: string }`.

### Step 2: Add `fetchPRApprovalState` function (`adws/github/prApi.ts`)
- Add a new exported function `fetchPRApprovalState(prNumber: number, repoInfo: RepoInfo): boolean`.
- Calls `gh pr view <prNumber> --repo owner/repo --json reviews`.
- Parses the JSON array; returns `true` if at least one review has `state: 'APPROVED'`.
- Returns `false` on parse error or empty array.
- Export from `adws/github/index.ts` barrel.

### Step 3: Add `addIssueLabel` function (`adws/github/issueApi.ts`)
- Add a new exported function `addIssueLabel(issueNumber: number, labelName: string, repoInfo: RepoInfo): void`.
- Uses `execWithRetry('gh issue edit <issueNumber> --repo owner/repo --add-label <labelName>')`.
- Log success/failure.
- Export from `adws/github/index.ts` barrel.

### Step 4: Extend `NON_RETRYABLE_PATTERNS` (`adws/core/utils.ts`)
- Add the following strings to the `NON_RETRYABLE_PATTERNS` array at line 33-37:
  - `'gh auth login'`
  - `'GH_TOKEN'`
  - `'HTTP 401'`
  - `'Bad credentials'`
  - `'authentication'`

### Step 5: Add startup validation (`adws/phases/workflowInit.ts`)
- After the `activateGitHubAppAuth` call (~line 124), add a validation check:
  - Import `isGitHubAppConfigured` from `../github`.
  - Import `GITHUB_PAT` from `../core/environment`.
  - If `isGitHubAppConfigured() && !GITHUB_PAT`, throw a clear error: `'GitHub App is configured but GITHUB_PAT is not set. GITHUB_PAT is required for PR approval when using a GitHub App. Set GITHUB_PAT in your .env file.'`

### Step 6: Move approval call into `reviewPhase.ts` (`adws/phases/reviewPhase.ts`)
- Import `approvePR` from `../github`.
- Import `isGitHubAppConfigured` from `../github`.
- Import `{ GITHUB_PAT }` from `../core/environment`.
- After the `if (reviewPassed)` block (after the stage comment at ~line 98), add:
  ```
  // Approve the PR when a GitHub App is configured and PAT is available
  if (isGitHubAppConfigured() && GITHUB_PAT && config.ctx.prUrl) {
    const prNumber = extractPrNumber(config.ctx.prUrl);
    if (prNumber && config.repoContext) {
      const repoInfo = { owner: config.repoContext.repoId.owner, repo: config.repoContext.repoId.repo };
      log('Approving PR after review pass...', 'info');
      const approveResult = approvePR(prNumber, repoInfo);
      if (!approveResult.success) {
        log(`PR approval failed (non-fatal to review): ${approveResult.error}`, 'warn');
      } else {
        log(`PR #${prNumber} approved`, 'success');
      }
    }
  }
  ```
- Import `extractPrNumber` from `../adwBuildHelpers` (or define locally).
- Approval failure is non-fatal: log a warning but do not change `reviewPassed`.

### Step 7: Rewrite `autoMergePhase.ts` (`adws/phases/autoMergePhase.ts`)
- Remove imports: `approvePR`, `isGitHubAppConfigured`.
- Add imports: `fetchPRApprovalState`, `addIssueLabel`.
- Rewrite the existing `hitl` gate (lines 67-75) to become a **silent early-return** — no comment, just log and return empty cost.
- Remove the entire approval block (lines 88-96).
- Add new approval-state gate after the silent `hitl` check:
  ```
  // Gate: require at least one APPROVED review on the PR (GitHub is source of truth)
  const hasApproval = fetchPRApprovalState(prNumber, repoInfo);
  if (!hasApproval) {
    log(`No APPROVED review found on PR #${prNumber}, applying hitl label and posting comment`, 'info');
    addIssueLabel(issueNumber, 'hitl', repoInfo);
    commentOnIssue(
      issueNumber,
      `## ✋ Awaiting human approval — PR #${prNumber} ready for review\n\nNo approved review found on the PR. A human must approve before auto-merge can proceed.`,
      repoInfo,
    );
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }
  ```
- Keep `mergeWithConflictResolution` and the merge failure comment logic unchanged.

### Step 8: Remove inline approval logic from orchestrators
- **`adws/adwChore.tsx`** (~lines 154-169):
  - Remove the entire `if (prNumber && owner && repo) { ... }` block that contains `issueHasLabel`, `isGitHubAppConfigured`, `approvePR`, and `commentOnIssue` calls.
  - Remove unused imports: `approvePR`, `isGitHubAppConfigured`, `issueHasLabel`, `commentOnIssue`, `type RepoInfo` from `./github`.
  - Remove unused import: `extractPrNumber` from `./adwBuildHelpers`.
  - Keep the `AgentStateManager.writeTopLevelState` awaiting_merge write.
- **`adws/adwSdlc.tsx`** (~lines 132-148): Same removal pattern.
- **`adws/adwPlanBuildReview.tsx`** (~lines 104-119): Same removal pattern.
- **`adws/adwPlanBuildTestReview.tsx`** (~lines 124-139): Same removal pattern.

### Step 9: Update existing BDD feature — `features/auto_approve_merge_after_review.feature`
- **Scenario "approvePR temporarily unsets GH_TOKEN for personal identity"** (line 37-39): Replace with scenario asserting `approvePR` sets `GH_TOKEN` to `GITHUB_PAT` (not deletes it).
- **Scenario "approvePR restores GH_TOKEN in a finally block"** (line 41-44): Keep — the restore contract is the same.
- **Scenario "autoMergePhase approves PR when GitHub App is configured"** (line 75-78): Rewrite to assert autoMergePhase does NOT call `approvePR` or `isGitHubAppConfigured`.
- **Scenario "autoMergePhase skips approval when no GitHub App is configured"** (line 80-83): Remove — no longer relevant.
- Add new scenarios:
  - autoMergePhase calls `fetchPRApprovalState` to check for an approved review.
  - autoMergePhase does not import `approvePR` or `isGitHubAppConfigured`.

### Step 10: Update existing BDD step definitions — `features/step_definitions/autoApproveMergeAfterReviewSteps.ts`
- Replace the `deletes process.env.GH_TOKEN before calling gh pr review` step (~lines 54-70) with a step that asserts `GITHUB_PAT` is set as `GH_TOKEN` before `gh pr review`.
- Keep the `restores GH_TOKEN in a finally block` step.
- Add new steps for the updated autoMergePhase scenarios.

### Step 11: Update `features/hitl_label_gate_automerge.feature`
- **Scenario "autoMergePhase checks for hitl label before approval and merge"** (line 44-47): Update — `issueHasLabel` is called before `fetchPRApprovalState` (not before `approvePR`).
- **Scenario "autoMergePhase skips approvePR when hitl label is present"** (line 49-52): Replace — autoMergePhase no longer calls `approvePR` at all. Assert it skips `mergeWithConflictResolution`.
- **Scenario "autoMergePhase posts awaiting-human-approval comment on the issue when hitl detected"** (line 59-63): Update — the hitl gate is now silent (no comment). The comment is posted by the no-approval branch instead.
- **Scenario "autoMergePhase imports issueHasLabel"** (line 39-40): Keep.

### Step 12: Update `features/orchestrator_awaiting_merge_handoff.feature`
- **Scenarios asserting orchestrators call `approvePR` after `executePRPhase`** (lines 77-94): Remove or rewrite. The four orchestrators no longer call `approvePR`.
- **Scenario "Orchestrators check hitl label before approving PR"** (lines 171-174): Remove.
- **Scenario "executePRPhase is the final phase before the approve-and-exit sequence"** (line 153-154): Update — `executePRPhase` is now the final phase before the awaiting_merge state write (no approve).

### Step 13: Write new BDD feature — `features/move_approval_to_review_phase.feature`
- Tag: `@adw-434-move-approval-to-review`
- Scenarios:
  1. `reviewPhase.ts` imports `approvePR` from `../github`.
  2. `reviewPhase.ts` calls `approvePR` after review passes (ordering check).
  3. `autoMergePhase.ts` does not import `approvePR`.
  4. `autoMergePhase.ts` does not import `isGitHubAppConfigured`.
  5. `autoMergePhase.ts` calls `fetchPRApprovalState` before `mergeWithConflictResolution`.
  6. `autoMergePhase.ts` calls `addIssueLabel` when no approval is found.
  7. `autoMergePhase.ts` hitl gate does not call `commentOnIssue`.
  8. `workflowInit.ts` throws when GitHub App is configured without `GITHUB_PAT`.
  9. `NON_RETRYABLE_PATTERNS` includes auth error markers (`gh auth login`, `HTTP 401`, `Bad credentials`).
  10. Orchestrators (`adwSdlc`, `adwChore`, `adwPlanBuildReview`, `adwPlanBuildTestReview`) do not import `approvePR`.
  11. ADW TypeScript type-check passes.

### Step 14: Write step definitions — `features/step_definitions/moveApprovalToReviewPhaseSteps.ts`
- Implement step definitions for the scenarios in Step 13.
- Use the existing patterns from `autoApproveMergeAfterReviewSteps.ts` (file reads, string assertions, ordering checks).
- Reuse `sharedCtx` and `findFunctionUsageIndex` from `commonSteps.ts`.

### Step 15: Add Vitest tests for auth non-retryable patterns (`adws/core/__tests__/execWithRetry.test.ts`)
- Add test cases for each new auth pattern:
  - `'gh auth login'` → throws immediately without retrying.
  - `'HTTP 401'` → throws immediately without retrying.
  - `'Bad credentials'` → throws immediately without retrying.
  - `'authentication'` → throws immediately without retrying.
  - `'GH_TOKEN'` → throws immediately without retrying.

### Step 16: Run validation commands
- Run all validation commands to verify the bug is fixed with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

```bash
# Type-check the ADW codebase
bunx tsc --noEmit -p adws/tsconfig.json

# Type-check the root project
bunx tsc --noEmit

# Run linter
bun run lint

# Run unit tests (includes execWithRetry tests)
bun run test:unit

# Run the new BDD scenarios for this issue
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-434-move-approval-to-review"

# Run the updated existing BDD scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-fvzdz7-auto-approve-and-mer and @regression"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-329-hitl-label-gate and @regression"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-bpn4sv-orchestrators-exit-a and @regression"

# Run full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Build the application
bun run build
```

## Notes
- The `guidelines/coding_guidelines.md` must be strictly followed. In particular: no `any` types, prefer immutability, and keep files under 300 lines.
- The PAT-swap pattern is already proven in `projectBoardApi.ts:238-243` — follow it exactly.
- `GITHUB_PAT` is already exported from `adws/core/environment.ts:70` and included in `SAFE_ENV_VARS` at `environment.ts:133`.
- The `extractPrNumber` helper is already available from `adws/adwBuildHelpers.ts:19-25`. Import it in `reviewPhase.ts` rather than duplicating.
- The `addIssueLabel` function does not exist yet — it must be created in `issueApi.ts` and exported via `index.ts`.
- Several existing `@regression` BDD scenarios will break if not updated in sync with the code changes. The step definition changes must happen in the same commit as the source changes.
- Conditional docs `app_docs/feature-fvzdz7-auto-approve-merge-after-review.md`, `app_docs/feature-fygx90-hitl-label-gate-automerge.md`, `app_docs/feature-bpn4sv-orchestrators-awaiting-merge-handoff.md`, and `app_docs/feature-643xf3-fix-retry-and-commit-leak.md` are relevant context for understanding the existing design.
