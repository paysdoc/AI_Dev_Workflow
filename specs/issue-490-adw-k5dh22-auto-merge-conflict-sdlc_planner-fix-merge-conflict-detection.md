# Bug: auto-merge — conflict detection is blind to remote-only conflicts and unmatched gh error strings

## Metadata
issueNumber: `490`
adwId: `k5dh22-auto-merge-conflict`
issueJson: `{"number":490,"title":"auto-merge: conflict detection is blind to remote-only conflicts and unmatched gh error strings","state":"OPEN","author":"paysdoc","labels":["bug"],"createdAt":"2026-04-25T11:40:43Z"}`

## Bug Description

When `mergeWithConflictResolution` (`adws/triggers/autoMergeHandler.ts`) handles a PR whose head branch on origin conflicts with origin/`<baseBranch>`, the function should detect the conflict locally and route the merge through the `/resolve_conflict` agent. In the failure mode observed on `vestmatic#52` / PR #63, it does the opposite: every retry of the loop sees `checkMergeConflicts` return `false`, the agent is never invoked, `gh pr merge` keeps failing with the same "is not mergeable" stderr, the loop exhausts `MAX_AUTO_MERGE_ATTEMPTS`, and `adwMerge.tsx` writes terminal `discarded` to the workflow state.

Two compounding defects make this happen:

### Bug A — `isMergeConflictError` is brittle against gh's "not mergeable" phrasing

The current keyword set in `adws/triggers/autoMergeHandler.ts` does include `'not mergeable'` and bare `'conflict'`, so the *literal* GitHub stderr — `Pull request <repo>#<n> is not mergeable: the merge commit cannot be cleanly created.` — already returns `true`. **However**, the fact that the loop `break`s on `!isMergeConflictError(...)` is critical to the recovery path: any future tweak that drops `'not mergeable'` (or any other phrasing GitHub may emit, e.g., `'cannot be cleanly created'` if `gh` ever shortens the prefix) silently re-introduces the bug. The keyword set has no test coverage today, so a regression in this function would not be caught.

### Bug B — `checkMergeConflicts` cannot see a remote-only conflict when the worktree's HEAD is not synced to `origin/<headBranch>`

`checkMergeConflicts(baseBranch, worktreePath)` does fetch `origin/<baseBranch>` before the dry-run (good), and it does target `origin/<baseBranch>` in the `git merge --no-commit --no-ff` invocation (good). But the dry-run is rooted at the **worktree's local HEAD**, which the merge orchestrator does not synchronise with `origin/<headBranch>` before the loop. If `origin/<headBranch>` has commits that the local worktree does not — a real possibility for a long-lived worktree, a takeover scenario, or a head-branch update done outside the local orchestrator — the local merge of `origin/<baseBranch>` into stale local HEAD can succeed cleanly while GitHub's merge of `origin/<headBranch>` into `origin/<baseBranch>` legitimately conflicts. `checkMergeConflicts` returns `false`, `/resolve_conflict` is skipped, `pushBranchChanges` is a no-op (or fast-forward), and `gh pr merge` fails. Subsequent loop iterations repeat the same check against the same stale HEAD and reach the same wrong answer, so `/resolve_conflict` is never given a chance.

**Actual on PR #63:** human approved → `adwMerge` dispatched → `checkMergeConflicts` returned `false` for every attempt → `/resolve_conflict` never invoked → all `MAX_AUTO_MERGE_ATTEMPTS` failed with the same "is not mergeable" stderr → `workflowStage` written as `discarded`, failure comment posted on PR.

**Expected:** `checkMergeConflicts` reports the conflict that GitHub sees, `/resolve_conflict` is invoked, the agent commits a merge resolution, push succeeds, `gh pr merge` succeeds, `workflowStage` becomes `completed`. If the agent fails, `discarded` is only written *after* `/resolve_conflict` has actually been attempted.

## Problem Statement

`mergeWithConflictResolution` cannot recover a PR whose conflict is only visible to GitHub — i.e., where the merge of `origin/<headBranch>` into `origin/<baseBranch>` produces conflicts that the merge of `origin/<baseBranch>` into stale local HEAD does not. The retry loop runs to completion without invoking `/resolve_conflict`, and the orchestrator writes terminal `discarded`. There is also no unit-test coverage on `isMergeConflictError`, so the keyword set is one careless edit away from re-introducing the original "loop breaks after one attempt" failure mode.

## Solution Statement

1. **Sync the worktree to `origin/<headBranch>` once at the top of `mergeWithConflictResolution`** so subsequent operations (`checkMergeConflicts`, `resolveConflictsViaAgent`, `pushBranchChanges`) all reason about the same head commit GitHub sees. A `git fetch origin <headBranch>` + `git reset --hard origin/<headBranch>` pair is the right primitive: the merge orchestrator's job is to merge what is on origin, not what happens to be on a stale local worktree, and the `awaiting_merge` invariant is "build phase has finished and pushed", so a hard reset to origin is non-destructive in normal operation. Fetch/reset failures are logged but non-fatal — the loop falls back to the existing behaviour.
2. **Tighten `isMergeConflictError`** by adding `'cannot be cleanly created'` as an explicit keyword. `'not mergeable'` already matches the literal gh stderr today, but adding the more specific phrase makes the intent self-documenting and gives the unit tests a second anchor that does not rely on the leading `is not mergeable` prefix gh happens to emit today.
3. **Export `isMergeConflictError`** from `autoMergeHandler.ts` so it can be unit-tested directly.
4. **Add a unit-test file** at `adws/triggers/__tests__/autoMergeHandler.test.ts`:
   - Lock the keyword contract for `isMergeConflictError`: GitHub's full "not mergeable: the merge commit cannot be cleanly created" string, the legacy `merge conflict` / `dirty` / `behind` strings, the bare `conflict` substring, and a negative case for an unrelated error.
   - Cover `mergeWithConflictResolution` orchestration via a child_process mock: when the dry-run reports conflicts, `resolveConflictsViaAgent` is invoked; when `gh pr merge` fails with `not mergeable`, the loop continues rather than `break`ing; and a stale-local-worktree-but-remote-conflicting scenario reaches `/resolve_conflict` rather than terminating after one iteration.
5. **Add step definitions** for the existing `features/fix_remote_only_merge_conflict_detection.feature` BDD scenarios. The file-content scenarios reuse `commonSteps.ts`'s existing matchers; the source-shape scenarios (call ordering, dry-run target, abort coverage, failed-fetch return value, retry-loop continuation) and the behavioural scenarios (stale-local-worktree recovery, agent-attempted-before-discarded) get new matchers in a dedicated step-definitions file.

## Steps to Reproduce

1. Set up an ADW workflow that reaches `awaiting_merge` on a target repo, with `origin/<headBranch>` containing commits that produce a real conflict against `origin/<baseBranch>`.
2. Force the local worktree's HEAD to lag `origin/<headBranch>` (e.g., by simulating a takeover or running the build phase, then advancing `origin/<headBranch>` from another host) so `git merge --no-commit --no-ff origin/<baseBranch>` from the local worktree succeeds cleanly even though `origin/<headBranch>` + `origin/<baseBranch>` would conflict.
3. Approve the PR. The next cron cycle dispatches `adwMerge`.
4. Observe: every retry inside `mergeWithConflictResolution` runs `checkMergeConflicts` → `false` → skips `resolveConflictsViaAgent` → push → `gh pr merge` fails with "is not mergeable". After `MAX_AUTO_MERGE_ATTEMPTS` the loop returns failure and `adwMerge.tsx` writes `workflowStage: 'discarded'`.

## Root Cause Analysis

`mergeWithConflictResolution` treats the local worktree's HEAD as the truth for what GitHub will merge, but the worktree is not synchronised with `origin/<headBranch>` before the conflict check. When `origin/<headBranch>` has commits the local worktree does not, the local dry-run merges `origin/<baseBranch>` (freshly fetched, correct) into the *stale* HEAD, producing a clean tree. GitHub merges `origin/<headBranch>` (with the missing commits) into `origin/<baseBranch>` and reports a conflict. The two views disagree, and the loop's gating logic (`if (hasConflicts) { /resolve_conflict }`) routes around the agent every time.

`isMergeConflictError` is a secondary concern: it correctly recognises the current `gh pr merge` stderr today, but the keyword set has no test coverage, so a future edit could trivially break the retry-loop continuation path that the fix above relies on.

## Relevant Files

Use these files to fix the bug:

- `adws/triggers/autoMergeHandler.ts` — the file containing both defects. `mergeWithConflictResolution` gets the pre-loop sync; `isMergeConflictError` gets the new keyword and is exported for tests.
- `adws/adwMerge.tsx` — caller. The `discarded` write on merge failure (`adws/adwMerge.tsx:178`) is the symptom users see; once the underlying detection is fixed, the existing call site is correct without modification.
- `adws/__tests__/adwMerge.test.ts` — existing test file. Confirms the `MergeDeps`-based mocking pattern used for the orchestrator; the new test file mirrors its structure.
- `adws/triggers/__tests__/mergeDispatchGate.test.ts` — closest-pattern peer for a new `adws/triggers/__tests__/*.test.ts` (DI + `vi.mock('../../core', ...)` for the `log` import).
- `adws/core/utils.ts` — defines `NON_RETRYABLE_PATTERNS`, which already includes `'is not mergeable'`. `execWithRetry` throws immediately on this pattern, so `mergePR`'s catch block sees the underlying execSync error and surfaces `error.stderr` to the loop. Used as reference; no edits required.
- `adws/github/prApi.ts:216` — `mergePR` shape (`{ success: boolean; error?: string }`); the `.error` field is what the loop's `isMergeConflictError(lastMergeError)` consumes. Used as reference; no edits required.
- `features/fix_remote_only_merge_conflict_detection.feature` — already authored for `@adw-490`. Provides the BDD acceptance contract; the plan adds step definitions to make every scenario executable.
- `features/step_definitions/commonSteps.ts` — supplies `Given "<file>" is read`, `Then the file contains "<x>"`, `Then the file does not contain "<x>"`. The new step file reuses this `sharedCtx`-based pattern.
- `features/step_definitions/autoMergeApprovedPrSteps.ts` — closest existing matcher style (file-content checks + small structural assertions) for the shape steps in the new feature.
- `app_docs/feature-cwiuik-1773818764164-auto-merge-approved-pr.md` — original auto-merge feature doc. Conditional doc: read for context on the merge conflict / `/resolve_conflict` agent design.
- `app_docs/feature-fvzdz7-auto-approve-merge-after-review.md` — original `mergeWithConflictResolution` design notes. Conditional doc: read for the retry-loop and approval-flow rationale.
- `app_docs/feature-hx6dg4-robustness-hardening-retry-logic-resilience.md` — context on early-exit paths and `execWithRetry` retry semantics. Conditional doc: read for the `NON_RETRYABLE_PATTERNS` design.
- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — conditional doc relevant when modifying `autoMergeHandler.ts`; explains how `cwd: worktreePath` threads through git operations.
- `guidelines/coding_guidelines.md` — read and follow.

### New Files

- `adws/triggers/__tests__/autoMergeHandler.test.ts` — unit tests for `isMergeConflictError` and `mergeWithConflictResolution`.
- `features/step_definitions/fixRemoteOnlyMergeConflictDetectionSteps.ts` — Cucumber step definitions for `features/fix_remote_only_merge_conflict_detection.feature`.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the relevant docs and guidelines

- Read `guidelines/coding_guidelines.md` and follow it for all subsequent edits.
- Read the four conditional docs listed above for context.
- Re-read `adws/triggers/autoMergeHandler.ts`, `adws/adwMerge.tsx`, `adws/__tests__/adwMerge.test.ts`, and `features/fix_remote_only_merge_conflict_detection.feature` end-to-end before editing anything.

### 2. Add the worktree sync to `mergeWithConflictResolution`

In `adws/triggers/autoMergeHandler.ts`:

- Add a small private helper `syncWorktreeToOriginHead(headBranch: string, cwd: string): void` immediately above `mergeWithConflictResolution`. The helper runs:
  - `git fetch origin "${headBranch}"`
  - `git reset --hard "origin/${headBranch}"`
- Both `execSync` calls use `{ stdio: 'pipe', cwd }`. Wrap each in its own `try/catch`, log a `warn` on failure ("Failed to fetch origin/${headBranch}" / "Failed to reset worktree to origin/${headBranch}"), and return without throwing. Best-effort sync — if it fails, the loop still runs against the existing worktree.
- Inside `mergeWithConflictResolution`, call `syncWorktreeToOriginHead(headBranch, worktreePath)` exactly once, immediately before the `for (let attempt = 1; ...)` loop. Document the rationale with a one-line comment: "// Pull origin's view of the head branch into the worktree so checkMergeConflicts and resolveConflictsViaAgent reason about the same commit GitHub will merge."

### 3. Strengthen `isMergeConflictError` and export it

In `adws/triggers/autoMergeHandler.ts`:

- Add `lower.includes('cannot be cleanly created')` to the existing `||` chain in `isMergeConflictError`. Keep all existing checks (`'conflict'`, `'not mergeable'`, `'merge conflict'`, `'dirty'`, `'behind'`).
- Change `function isMergeConflictError` to `export function isMergeConflictError` so the unit tests can import it directly.

### 4. Add the unit-test file `adws/triggers/__tests__/autoMergeHandler.test.ts`

The file must use Vitest and follow the patterns in `adws/triggers/__tests__/mergeDispatchGate.test.ts` and `adws/__tests__/adwMerge.test.ts`.

`describe('isMergeConflictError', ...)`:
- Test that the GitHub error string `'Pull request acme/widgets#7 is not mergeable: the merge commit cannot be cleanly created.'` returns `true`.
- Test that the substrings `'merge conflict'`, `'dirty'`, and `'behind'` each return `true` (one `it` per substring is fine).
- Test that a bare `'conflict'` substring returns `true`.
- Test that an unrelated error (`'HTTP 500: server error'`) returns `false`.
- Test the lowercase invariance: `'IS NOT MERGEABLE'` returns `true`.

`describe('mergeWithConflictResolution', ...)`:
- Mock `child_process.execSync` via `vi.mock('child_process', ...)` so the helper functions inside the file (`syncWorktreeToOriginHead`, `checkMergeConflicts`, `resolveConflictsViaAgent`, `pushBranchChanges`) execute their existing logic without touching the real filesystem.
- Mock `vi.mock('../../core', () => ({ log: vi.fn(), MAX_AUTO_MERGE_ATTEMPTS: 3 }))` and `vi.mock('../../github', () => ({ mergePR: vi.fn() }))`.
- Mock `vi.mock('../../agents', () => ({ runClaudeAgentWithCommand: vi.fn().mockResolvedValue({ success: true, output: '' }) }))`.
- Test 1: when the simulated dry-run reports conflicts (the second `git merge --no-commit --no-ff` exec throws), `runClaudeAgentWithCommand` is invoked at least once with `'/resolve_conflict'`.
- Test 2: when `mergePR` returns `{ success: false, error: 'Pull request acme/widgets#7 is not mergeable: the merge commit cannot be cleanly created.' }` on attempt 1 and `{ success: true }` on attempt 2, the function returns `{ success: true }` and `mergePR` was called twice (the loop did not `break`).
- Test 3: simulated stale-local-worktree-but-remote-conflicting scenario — the `git merge --no-commit --no-ff` call against `origin/${baseBranch}` throws (conflicts after the pre-loop sync brings the worktree forward), `runClaudeAgentWithCommand` is invoked, the agent succeeds, `mergePR` returns success, function returns `{ success: true }`. Assert `runClaudeAgentWithCommand` was called with `'/resolve_conflict'`.
- Test 4: when the agent fails on every attempt and `mergePR` keeps returning `{ success: false, error: '...not mergeable...' }`, the function returns `{ success: false, error: <last error> }` and `runClaudeAgentWithCommand` was invoked at least once.
- Test 5 (sync command sequence): when `mergeWithConflictResolution` runs once successfully, the captured `execSync` invocations begin with `git fetch origin "<headBranch>"` then `git reset --hard "origin/<headBranch>"` before any `git merge` call. (Locks in the pre-loop sync ordering.)

Use `vi.mocked(execSync)` with sequenced `.mockImplementationOnce(...)` to drive each test scenario. Capture all calls so order can be asserted.

The test file MUST contain identifying string anchors so the BDD step matchers in step 5 can confirm the scenarios are exercised:
- Test 2 (loop continuation on `not mergeable`) MUST contain a self-documenting phrase such as the literal `'does not break'` (e.g., as a `describe` / `it` title or a `// does not break` comment) AND a `toHaveBeenCalledTimes(2)` assertion against the `mergePR` mock so the matcher in step 5 can verify both signals.
- Test 3 (stale-local-worktree-but-remote-conflicting recovery) MUST contain the literal phrase `'remote-base-diverged-from-local-worktree'` (e.g., as a `describe` / `it` title or a `// remote-base-diverged-from-local-worktree scenario` comment) so the matcher in step 5 can verify Test 3 has been authored.

### 5. Add the step-definitions file `features/step_definitions/fixRemoteOnlyMergeConflictDetectionSteps.ts`

Reuse `sharedCtx` from `commonSteps.ts` for file content. Implement only the steps that the existing common file does not already cover.

File-shape steps:

- `Then('checkMergeConflicts calls {string} before {string}', function (first, second) { ... })` — locate the `checkMergeConflicts` function body in `sharedCtx.fileContent`, assert that the first occurrence of `first` precedes the first occurrence of `second` within that body. Function-body slicing follows the simple convention: take the substring from `function checkMergeConflicts` to the matching closing brace via brace counting.
- `Then('the dry-run merge ref is {string} prefixed rather than the bare baseBranch', function (prefix) { ... })` — assert the `git merge --no-commit --no-ff` call inside `checkMergeConflicts` references `${prefix}${baseBranch}` (i.e., `"origin/${baseBranch}"`), not bare `"${baseBranch}"`.
- `Then('both the success and failure branches of the dry-run abort the merge before returning', function () { ... })` — assert that the `checkMergeConflicts` body contains at least two occurrences of `git merge --abort` (one in the try-block return-false path, one in the catch-block return-true path).
- `Then('the failed-fetch path returns false from checkMergeConflicts', function () { ... })` — assert that the catch block on the fetch invocation contains a `return false` (search for the `Failed to fetch origin/` log line and verify the next `return` literal in the slice is `return false`).
- `Then('the non-conflict break is only reached when isMergeConflictError returns false', function () { ... })` — assert that the source contains a literal `if (!isMergeConflictError(lastMergeError))` followed by a `break` within the next ~3 lines.
- `Then('the test exercises a remote-base-diverged-from-local-worktree scenario', function () { ... })` — operate on `sharedCtx.fileContent` (loaded via `Given "adws/triggers/__tests__/autoMergeHandler.test.ts" is read`); assert the file contains the literal phrase `'remote-base-diverged-from-local-worktree'` (matches the `describe` / `it` title or comment anchor required by step 4 Test 3).
- `Then('the test asserts the loop does not break after the first attempt for that error', function () { ... })` — operate on `sharedCtx.fileContent`; assert the file contains both the phrase `'does not break'` and the substring `'toHaveBeenCalledTimes(2)'` (the two anchors required by step 4 Test 2 — the descriptive title/comment plus the concrete assertion).

Behavioural steps (no real process execution — these scenarios drive `mergeWithConflictResolution` through stubbed deps in-process):

- `Given('an awaiting_merge PR whose local worktree is behind origin/<baseBranch>', function () { this.scenario = { kind: 'remote_base_diverged' }; })` — store the scenario shape on the cucumber `this` world.
- `Given('the remote base contains commits that conflict with the head branch', function () { this.scenario.conflicts = true; })`.
- `Given('resolveConflictsViaAgent succeeds and produces a clean merge commit', function () { this.scenario.agentSucceeds = true; })`.
- `Given('resolveConflictsViaAgent fails on every attempt', function () { this.scenario.agentSucceeds = false; })`.
- `Given('mergePR returns {string}', function (msg) { this.scenario = { kind: 'mergepr_error', error: msg }; })`.
- `When('mergeWithConflictResolution is invoked for the PR', async function () { ... })` — set up `vi.mock`-equivalent stubs by importing the module under test, monkey-patching `execSync` via the same `child_process` mock approach used in the unit tests, then call `mergeWithConflictResolution(...)` with concrete values and store `{ result, agentCalls, execCalls, mergePrCalls, pushCalls }` on `this`.
- `When('mergeWithConflictResolution evaluates the failure', function () { this.evalResult = isMergeConflictError(this.scenario.error); })`.
- `Then('isMergeConflictError returns true for that error', function () { assert.strictEqual(this.evalResult, true); })`.
- `Then('the retry loop continues to the next attempt up to MAX_AUTO_MERGE_ATTEMPTS', function () { ... })` — re-runs `mergeWithConflictResolution` with `mergePR` always returning the conflict error, asserts `mergePR` was invoked `MAX_AUTO_MERGE_ATTEMPTS` times.
- `Then('checkMergeConflicts fetches origin/<baseBranch> before the dry-run', function () { ... })` — asserts the captured `execCalls` show `git fetch origin "<baseBranch>"` before `git merge --no-commit --no-ff "origin/<baseBranch>"`.
- `Then('checkMergeConflicts reports conflicts because the dry-run runs against the freshly fetched origin', function () { ... })` — verifies the dry-run was invoked with the `origin/`-prefixed ref and that, in the conflict scenario, it threw (the helper returned `true`).
- `Then('resolveConflictsViaAgent is invoked at least once for the PR', function () { assert.ok(this.agentCalls >= 1); })`.
- `Then('pushBranchChanges is called with the head branch after resolution', function () { assert.ok(this.pushCalls.some(c => c === HEAD_BRANCH)); })`.
- `Then('mergePR is called for the PR', function () { assert.ok(this.mergePrCalls.length >= 1); })`.
- `Then('mergeWithConflictResolution returns success=true', function () { assert.strictEqual(this.result.success, true); })`.
- `Then('the workflow does not write workflowStage {string}', function (stage) { ... })` — this scenario is at the `mergeWithConflictResolution` level (returns success), so assert that the function did not throw and that no stub for `writeTopLevelState(..., { workflowStage: stage })` was invoked.
- `Then('resolveConflictsViaAgent is invoked at least once before the loop exits', function () { assert.ok(this.agentCalls >= 1); })`.
- `Then('mergeWithConflictResolution returns success=false with the last error', function () { assert.strictEqual(this.result.success, false); assert.ok(this.result.error); })`.
- `Then('adwMerge writes workflowStage {string} only after the agent has been attempted', function (stage) { ... })` — the file-content-level assertion: verify `adws/adwMerge.tsx` writes `workflowStage: 'discarded'` only on the `merge_failed` branch (`!mergeOutcome.success`), never on a path that bypasses `mergeWithConflictResolution`.

Keep step files focused — do not duplicate `the file contains` matchers; those already exist in `commonSteps.ts`.

### 6. Run validation commands

Execute every command in the **Validation Commands** section below in order. All must pass. Specifically:
- `bun run lint`, `bun run build`, `bun run test`
- The new BDD scenarios under `@adw-490`
- The unit tests under `adws/triggers/__tests__/autoMergeHandler.test.ts`
- The existing `adws/__tests__/adwMerge.test.ts` regression suite (no behaviour change there, but confirm)

If any command fails, fix the underlying issue rather than silencing it.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

Project-specific commands per `.adw/commands.md` are not present in this repository (the repository uses ADW's own `package.json` scripts directly):

```sh
# 1. Lint — ESLint must report zero errors and zero warnings.
bun run lint

# 2. TypeScript build — must succeed (this also satisfies the @adw-490 type-check scenario).
bun run build

# 3. Unit tests — must pass, including the new autoMergeHandler.test.ts.
bun run test

# 4. New unit tests in isolation (rapid feedback during implementation).
bunx vitest run adws/triggers/__tests__/autoMergeHandler.test.ts

# 5. Existing adwMerge tests — must remain green.
bunx vitest run adws/__tests__/adwMerge.test.ts

# 6. BDD scenarios for issue #490 — must pass on the host.
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-490"

# 7. @regression suite — confirms no scenario in the broader regression set was broken.
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

**Reproduction (before-fix sanity check, optional but encouraged):**

Before applying the fix in step 2, run the new unit test 3 (the stale-local-worktree-but-remote-conflicting scenario). It must FAIL because `mergeWithConflictResolution` does not invoke `/resolve_conflict` and returns `{ success: false }`. After applying the fix, it must PASS. This is the executable proof that the patch closes the bug.

## Notes

- `guidelines/coding_guidelines.md` exists in this repository and applies. Read it before editing.
- `git reset --hard origin/<headBranch>` is destructive, but the merge orchestrator runs only after `awaiting_merge` — by which point the build phase has finished and pushed. Local commits not yet on origin would already be a red flag; the merge orchestrator's contract is to merge what is on origin.
- No new libraries are required. The `## Library Install Command` from `.adw/project.md` is `bun add <package>` if that ever changes.
- The `'cannot be cleanly created'` keyword is intentionally additive — it does not replace `'not mergeable'`. Keeping both gives the unit tests two independent anchors and protects against either phrase changing in a future `gh` release.
- `MAX_AUTO_MERGE_ATTEMPTS` lives in `adws/core` (re-exported via the index). Tests import the constant rather than hard-coding `3` so they track future changes.
- Out of scope (per the issue): recovering issues already poisoned to `discarded` by the historical occurrence of this bug. Those are recovered by manual state-file edit or manual merge.
