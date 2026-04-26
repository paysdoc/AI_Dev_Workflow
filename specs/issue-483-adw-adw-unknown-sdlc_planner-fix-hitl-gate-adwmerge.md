# Bug: hitl label gate bypassed on awaiting-merge handoff path

## Metadata
issueNumber: `483`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description
The `hitl` label no longer blocks auto-merge. Issues labeled `hitl` are being merged automatically by `adwMerge.tsx`. Issue #467 was labeled `hitl` but was merged anyway.

Feature `bpn4sv` restructured the four review orchestrators so they write `workflowStage: 'awaiting_merge'` and exit, delegating merge to `adwMerge.tsx` via the cron trigger. The `hitl` label check previously lived only in `executeAutoMergePhase` (`adws/phases/autoMergePhase.ts:69`), which is no longer called by any orchestrator on the handoff path. `adwMerge.tsx` merges without consulting the `hitl` label.

**Expected behavior:** If an issue has the `hitl` label, `adwMerge.tsx` must skip the merge, leave `workflowStage` as `awaiting_merge`, and return so the cron can re-evaluate the issue on the next cycle.

**Actual behavior:** `adwMerge.tsx` merges the PR regardless of the `hitl` label.

## Problem Statement
`adwMerge.tsx:executeMerge()` does not call `issueHasLabel()` before invoking `mergeWithConflictResolution()`. The `MergeDeps` interface has no `issueHasLabel` slot, so the guard cannot be injected or tested.

## Solution Statement
Add an `issueHasLabel` injectable to `MergeDeps` and insert a hitl guard in `executeMerge()` immediately after the PR lookup (step 3, before worktree setup). When `hitl` is detected: log the skip, leave `workflowStage` unchanged (`awaiting_merge`), and return `{ outcome: 'abandoned', reason: 'hitl_blocked' }` so the process exits 0 without writing any state. Extend the unit tests and add new BDD scenarios to `features/hitl_label_gate_automerge.feature`.

## Steps to Reproduce
1. Label a GitHub issue with `hitl`.
2. Trigger an SDLC workflow for that issue — the orchestrator writes `awaiting_merge` and exits.
3. Wait for the cron to spawn `adwMerge.tsx`.
4. Observe: `adwMerge.tsx` merges the PR despite the `hitl` label.

## Root Cause Analysis
`executeAutoMergePhase` contained the `hitl` guard at line 69. Feature `bpn4sv` removed `executeAutoMergePhase` from all four review orchestrators and introduced `adwMerge.tsx` as the new merge executor. `adwMerge.tsx:executeMerge()` (lines 122–175) was built without porting the `hitl` guard from `autoMergePhase.ts`. The `MergeDeps` interface never included `issueHasLabel`, so no test coverage was possible for this path.

## Relevant Files

- `adws/adwMerge.tsx` — Primary fix target: `MergeDeps` interface needs `issueHasLabel`; `executeMerge()` needs the hitl guard after step 3 (PR found, state is OPEN).
- `adws/__tests__/adwMerge.test.ts` — Needs new test cases: hitl guard skips merge, leaves state unchanged, returns `hitl_blocked`.
- `adws/phases/autoMergePhase.ts` — Reference for the existing hitl guard pattern (lines 67–72). No changes required here.
- `adws/github/issueApi.ts` — Contains `issueHasLabel` (line 272). No changes required.
- `adws/github/index.ts` — Already exports `issueHasLabel`. No changes required.
- `features/hitl_label_gate_automerge.feature` — Needs new scenarios covering `adwMerge.tsx` hitl guard.

## Step by Step Tasks

### 1. Add `issueHasLabel` to `MergeDeps` and wire production default

In `adws/adwMerge.tsx`:

- Add `issueHasLabel` to the `MergeDeps` interface:
  ```ts
  readonly issueHasLabel: typeof issueHasLabel;
  ```
- Import `issueHasLabel` from `'./github'` at the top of the file.
- Add `issueHasLabel` to `buildDefaultDeps()`:
  ```ts
  issueHasLabel,
  ```

### 2. Insert hitl guard in `executeMerge()` after PR lookup

In `adws/adwMerge.tsx`, inside `executeMerge()`, immediately after step 3 (the `if (prState === 'CLOSED')` block, before step 6 worktree setup):

```ts
// Gate: if the issue has the `hitl` label, silently skip — leave awaiting_merge intact.
if (deps.issueHasLabel(issueNumber, 'hitl', repoInfo)) {
  log(`adwMerge: hitl label detected on issue #${issueNumber}, skipping merge`, 'info');
  return { outcome: 'abandoned', reason: 'hitl_blocked' };
}
```

This must appear after `prState === 'CLOSED'` check (we still abandon on closed PRs) but before the worktree setup and merge call.

### 3. Add unit tests in `adwMerge.test.ts`

In `adws/__tests__/adwMerge.test.ts`, add a new describe block:

```ts
describe('executeMerge — hitl label gate', () => {
  it('skips merge and returns hitl_blocked when hitl label is present', async () => {
    const deps = makeDeps({
      issueHasLabel: vi.fn().mockReturnValue(true),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('hitl_blocked');
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    expect(deps.mergeWithConflictResolution).not.toHaveBeenCalled();
    expect(deps.ensureWorktree).not.toHaveBeenCalled();
  });

  it('proceeds with merge when hitl label is absent', async () => {
    const deps = makeDeps({
      issueHasLabel: vi.fn().mockReturnValue(false),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('completed');
    expect(deps.mergeWithConflictResolution).toHaveBeenCalled();
  });

  it('does not call issueHasLabel when PR is already MERGED', async () => {
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'MERGED' })),
      issueHasLabel: vi.fn(),
    });

    await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(deps.issueHasLabel).not.toHaveBeenCalled();
  });

  it('does not call issueHasLabel when PR is CLOSED', async () => {
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'CLOSED' })),
      issueHasLabel: vi.fn(),
    });

    await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(deps.issueHasLabel).not.toHaveBeenCalled();
  });
});
```

Also update `makeDeps()` to include the new field with a default of `vi.fn().mockReturnValue(false)`.

### 4. Add BDD scenarios to `features/hitl_label_gate_automerge.feature`

Append a new section `# ── adwMerge hitl gate ──` with `@regression` scenarios:

```gherkin
  # ── adwMerge hitl gate ───────────────────────────────────────────────────

  @adw-329-hitl-label-gate @adw-483 @regression
  Scenario: adwMerge imports issueHasLabel
    Given "adws/adwMerge.tsx" is read
    Then the file imports "issueHasLabel"

  @adw-329-hitl-label-gate @adw-483 @regression
  Scenario: MergeDeps interface declares issueHasLabel
    Given "adws/adwMerge.tsx" is read
    Then the interface "MergeDeps" contains a field named "issueHasLabel"

  @adw-329-hitl-label-gate @adw-483 @regression
  Scenario: executeMerge checks for hitl label before calling mergeWithConflictResolution
    Given "adws/adwMerge.tsx" is read
    Then "issueHasLabel" is called before "mergeWithConflictResolution"

  @adw-329-hitl-label-gate @adw-483 @regression
  Scenario: executeMerge skips merge when hitl label is detected
    Given "adws/adwMerge.tsx" is read
    Then the hitl label early-return path does not call "mergeWithConflictResolution"

  @adw-329-hitl-label-gate @adw-483 @regression
  Scenario: executeMerge does not write state when hitl label is detected
    Given "adws/adwMerge.tsx" is read
    Then the hitl skip path does not call "writeTopLevelState"
```

### 5. Run validation commands to confirm the fix

Run all validation commands listed below.

## Validation Commands

```bash
# Type-check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Unit tests (covers new hitl guard unit tests)
bun run test:unit

# Lint
bun run lint

# BDD scenarios — hitl-specific tag
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-329-hitl-label-gate"

# BDD scenarios — new issue tag
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-483"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes
- The `hitl` guard in `autoMergePhase.ts` is intentionally silent (no comment on re-entry) to prevent comment floods on every cron cycle. The same behavior should apply in `adwMerge.tsx`: do not call `commentOnIssue` when the label is present.
- `workflowStage` must remain `awaiting_merge` (not changed to `abandoned`) so the cron can re-evaluate the issue after a human removes the `hitl` label and approves.
- The `issueHasLabel` check should only fire for OPEN PRs. Already-MERGED and CLOSED PRs exit before reaching the guard, which is the correct and expected behavior.
- The `adwMerge.tsx` injectable deps pattern (`MergeDeps`) is already established; the fix follows the same injection pattern used for all other dependencies in the file.
