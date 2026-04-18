# Patch: Validate pauseQueueScanner unit test goes green after cwd revert

## Metadata
adwId: `ope038-pause-queue-resume-s`
reviewChangeRequest: `Issue #2: The spec-mandated unit test adws/triggers/__tests__/pauseQueueScanner.test.ts:132-145 ('spawn cwd is pinned to process.cwd(), NOT entry.worktreePath') fails under bunx vitest run — asserts opts.cwd === process.cwd() but receives /some/external/worktree. This is a direct consequence of issue #1 and matches the spec's test contract in Step 6 test case 2. The overall suite is 3 passed / 1 failed, which will break bun run test:unit in CI. Resolution: Once issue #1 is resolved (cwd reverted to process.cwd()), this test will pass as-is. If the deviation to entry.worktreePath is kept, both the test assertion and its descriptive name must be rewritten, and the spec's own Step 6 test case list must be updated to match.`

## Issue Summary
**Original Spec:** specs/issue-448-adw-ope038-pause-queue-resume-s-sdlc_planner-fix-silent-resume-spawn.md
**Issue:** The unit test case at `adws/triggers/__tests__/pauseQueueScanner.test.ts:132-145` (`'spawn cwd is pinned to process.cwd(), NOT entry.worktreePath'`) is RED under `bunx vitest run`. It asserts `opts.cwd === process.cwd()` but while commit `16e67b4` was in force the spawn call received `entry.worktreePath`. Suite went from 4-green to 3-pass / 1-fail, which breaks `bun run test:unit` in CI. The test assertion is spec-correct (Step 6 test case 2) and matches `## Notes` in the spec; the failing line is the *source*, not the test.
**Solution:** Take the first of the two paths offered in the review: **keep the test as-is and rely on the companion patch `patch-adw-ope038-pause-queue-resume-s-restore-cwd-processcwd.md` (issue #1) to revert the source line to `cwd: process.cwd()`.** No test edits, no spec edits. This patch is validation-only — it confirms the suite is 4-green once issue #1's patch lands. (The working tree already contains the issue-#1 revert uncommitted — `git diff adws/triggers/pauseQueueScanner.ts` shows line 141 is `cwd: process.cwd()` — so validation can be run immediately.)

## Files to Modify
Use these files to implement the patch:

- **None.** This patch has zero source/test/spec edits. It depends on `specs/patch/patch-adw-ope038-pause-queue-resume-s-restore-cwd-processcwd.md` being applied (it already is, uncommitted in the working tree). The test file `adws/triggers/__tests__/pauseQueueScanner.test.ts` is already spec-correct and stays untouched.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Confirm issue #1's fix is present in the working tree

- Run `git diff adws/triggers/pauseQueueScanner.ts` and verify the diff contains the line `cwd: process.cwd()` (not `cwd: entry.worktreePath`) inside the `spawn('bunx', ...)` call around line 141.
- If the diff instead shows `cwd: entry.worktreePath` on that line, stop and apply the companion patch `specs/patch/patch-adw-ope038-pause-queue-resume-s-restore-cwd-processcwd.md` first. Do **not** edit the test file in this patch.

### Step 2: Run the targeted unit test and confirm it goes from RED to GREEN

- Run `bunx vitest run adws/triggers/__tests__/pauseQueueScanner.test.ts`.
- Expect: **4/4 green**, including the previously-failing case `spawn cwd is pinned to process.cwd(), NOT entry.worktreePath` at lines 132-145.
- If any case still fails, the root cause is elsewhere (not issue #2). Do not modify the test to make it pass — escalate instead.

### Step 3: Run the full unit suite to confirm zero regressions elsewhere

- Run `bun run test:unit` and confirm the whole suite is green. This is the exact command that runs in CI and the one the review flagged as broken.

## Validation
Execute every command to validate the patch is complete with zero regressions.

From the repo root (`/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/bugfix-issue-448-fix-pause-queue-resume-spawn`):

1. **Confirm issue #1's source revert is present**
   `git diff adws/triggers/pauseQueueScanner.ts | grep -E 'cwd: (process.cwd\(\)|entry.worktreePath)'`
   Expect: a `+ cwd: process.cwd()` line appears; no `+ cwd: entry.worktreePath` line appears.

2. **Targeted scanner test (was the failing case)**
   `bunx vitest run adws/triggers/__tests__/pauseQueueScanner.test.ts`
   Expect: 4 passed, 0 failed — including the case `spawn cwd is pinned to process.cwd(), NOT entry.worktreePath`.

3. **Full unit suite (CI-equivalent — the command the review said would break)**
   `bun run test:unit`
   Expect: all suites green; no new failures introduced by this patch.

4. **Type-check the ADW workspace** (catches any drift issue #1's source edit might have introduced)
   `bunx tsc --noEmit -p adws/tsconfig.json`
   Expect: zero type errors.

5. **Lint** (safety net — this patch edits nothing, so it should be a no-op)
   `bun run lint`
   Expect: zero errors.

## Patch Scope
**Lines of code to change:** 0 (validation-only; depends on companion patch for issue #1)
**Risk level:** low
**Testing required:** rerun the single vitest suite that was RED, plus `bun run test:unit` to confirm CI would now go green. No new tests and no test edits — the spec-mandated assertion is already in place and becomes passing behavior once issue #1's source revert is committed.
