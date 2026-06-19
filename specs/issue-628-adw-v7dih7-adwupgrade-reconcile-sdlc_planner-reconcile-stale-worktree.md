# Feature: adwUpgrade reconciles a stale reused worktree to the remote claim tip before regen

## Metadata
issueNumber: `628`
adwId: `v7dih7-adwupgrade-reconcile`
issueJson: `{"number":628,"title":"adwUpgrade: reconcile stale worktree to remote claim tip before regen (root cause behind #627)","body":"## Summary\n\n`#627` parks the upgrade orchestrator cleanly when its regen push is rejected (non-fast-forward) instead of crashing. That is a **safety net**, not a cure — it stops the crash but the orchestrator still makes no progress and (absent the `.adw-version` disarm) can re-park every cron tick. This issue tracks the underlying cause.\n\n## Root cause\n\n`ensureWorktree` (`adws/vcs/worktreeCreation.ts:221-234`) returns an **existing** local worktree as-is when one is found for the claim branch:\n\n```ts\nconst existingPath = getWorktreeForBranch(branchName, baseRepoPath);\nif (existingPath) {\n  // reused without fetching / resetting to origin/<branch>\n  copyEnvToWorktree(existingPath, baseRepoPath);\n  return existingPath;\n}\n```\n\nIt does **not** fetch or reset the reused worktree to `origin/<claim-branch>`. So when a prior orchestrator left a `.worktrees/adw-upgrade-<hash>/` worktree built on a *superseded* claim commit (e.g. a different claim cycle re-created the remote branch with a new nonce), the next `adwUpgrade` run regenerates on the stale base and its push can never fast-forward → non-ff rejection.\n\nThis is exactly the divergence that produced the original incident: local worktree at the `zgmo37zc`-nonce claim commit, remote claim branch at the `llwvynsy`-nonce commit.\n\n## Proposed fix\n\nBefore regen on the upgrade path, reconcile the worktree to the current remote claim tip:\n\n- `git fetch origin <claim-branch>` then `git reset --hard origin/<claim-branch>` (hard reset is safe here — the worktree is a throwaway regen target, never carrying un-pushed user work), **or**\n- when reusing an existing worktree whose branch has diverged from `origin/<claim-branch>`, tear it down and recreate from the remote tip.\n\nScope the change to the upgrade path (or make reconciliation opt-in) so the shared `ensureWorktree` primitive used by every other orchestrator is not perturbed. Guard against the genuine concurrent-claim race (a new claim landing mid-run) — that case correctly remains the `claim_lost` park from `#627`.\n\n## Acceptance\n\n- An `adwUpgrade` run reusing a stale `.worktrees/adw-upgrade-<hash>/` worktree resets to `origin/<claim-branch>` and produces a fast-forwardable push.\n- No behavioural change for other orchestrators that call `ensureWorktree`.\n- Unit coverage for the diverged-reuse path.\n\n## Context\n\n- Builds on #627 (the park-on-rejection safety net).\n- Related prior incidents: duplicate-orchestrator spawn race; self-upgrade no-op loop.","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-06-18T15:16:54Z","comments":[],"actionableComment":null}`

## Feature Description

The framework self-upgrade orchestrator (`adws/adwUpgrade.tsx`) regenerates a target repo's `.adw/` directory on a dedicated **claim branch** named `adw-upgrade-<frameworkHash>`. It runs in a per-branch git worktree at `.worktrees/adw-upgrade-<hash>/`.

When a prior upgrade run leaves that worktree behind and a later run reuses it, `ensureWorktree` returns the existing worktree **as-is** — it does not fetch or reset it to the current remote claim tip. If the remote claim branch has since been re-created with a new nonce (a different empty claim commit), the reused worktree sits on a **superseded** base. The regen commit is therefore built on a stale parent, and the push to `origin/adw-upgrade-<hash>` can never fast-forward → non-fast-forward rejection.

PR #627 already makes that rejection survivable: instead of crashing, `executeUpgrade` parks the loser as `claim_lost` and exits cleanly. But that is a *safety net*, not a *cure* — the orchestrator still makes no forward progress and can re-park on every cron re-dispatch.

This feature closes the root cause: **before regen, reconcile the worktree to the current remote claim tip** (`git fetch origin <claim-branch>` + `git reset --hard origin/<claim-branch>`). After reconciliation the regen builds on the live claim commit and the push fast-forwards. The change is scoped entirely to the upgrade path; the shared `ensureWorktree` primitive is untouched, so no other orchestrator's behaviour changes. The #627 park remains in place as the correct response to a *genuine* concurrent-claim race (a brand-new claim landing after we reconcile but before we push).

## User Story

As an **ADW operator running the framework self-upgrade pipeline against target repos**,
I want **a reused `adw-upgrade-<hash>` worktree to be reset to the live remote claim commit before `.adw/` is regenerated**,
So that **the upgrade PR's push fast-forwards and the upgrade actually lands, instead of silently parking as `claim_lost` on every cron tick until someone manually disarms it**.

## Problem Statement

`ensureWorktree` (`adws/vcs/worktreeCreation.ts:221-234`) returns an existing worktree without synchronising it to `origin/<branch>`:

```ts
const existingPath = getWorktreeForBranch(branchName, baseRepoPath);
if (existingPath) {
  copyEnvToWorktree(existingPath, baseRepoPath); // reused as-is — no fetch, no reset
  return existingPath;
}
```

On the upgrade path the claim branch `adw-upgrade-<hash>` can be re-created with a fresh nonce between runs (each claim cycle pushes a new empty commit with a random nonce — see `defaultPushClaimBranch` in `adws/core/upgradeClaim.ts`). When that happens:

1. The reused worktree's HEAD points at the *old* nonce commit (e.g. `zgmo37zc`).
2. `origin/adw-upgrade-<hash>` points at the *new* nonce commit (e.g. `llwvynsy`).
3. These are sibling commits off the same default-branch base — neither is an ancestor of the other (they have **diverged**).
4. `/adw_init` regenerates `.adw/`, the regen is committed on the stale base, and `pushBranch` is rejected as non-fast-forward.
5. PR #627 catches the rejection and parks `claim_lost` — no crash, but also no progress.

The result is a self-upgrade that can never complete from a stale worktree without manual intervention (resetting `.adw-version`, or `## Cancel` to scrub the worktree).

## Solution Statement

Insert a **reconcile-to-remote-claim-tip** step into `executeUpgrade` immediately after the worktree is ensured and **before** regen (`/adw_init`). Reconciliation does `git fetch origin <claim-branch>` followed by `git reset --hard origin/<claim-branch>`, moving the reused worktree's HEAD onto the live claim commit so the subsequent regen commit fast-forwards on push.

Reuse the existing, already-proven primitive **`fetchAndResetToRemote(branch, cwd)`** (`adws/vcs/branchOperations.ts:233-249`). It performs exactly `git fetch origin "<branch>"` + `git reset --hard "origin/<branch>"`, is generic over branch name, and is already the canonical "reconcile a reused/created worktree to a remote tip" call used by the standard workflow in `adws/phases/workflowInit.ts:226`. It deliberately does **not** run `git clean -fdx`, so the worktree's copied `.env` (gitignored, written by `copyEnvToWorktree` inside `ensureWorktree`) and any copied `adw_init.md` survive.

Scoping and safety:

- **Scoped to the upgrade path.** The reconcile call lives in `adwUpgrade.tsx`, injected through the existing `UpgradeDeps` dependency-injection seam. `ensureWorktree` and every other orchestrator that calls it are left byte-identical (satisfies acceptance: "No behavioural change for other orchestrators that call `ensureWorktree`").
- **Idempotent on first run.** When `ensureWorktree` *creates* a new worktree it is already checked out at the claim tip (via `createWorktree`'s fetch), so reconcile is a harmless no-op. On a *reused* worktree it performs the corrective reset. Reconciling unconditionally keeps the code simple and matches the unconditional `fetchAndResetToRemote` call in `workflowInit.ts`.
- **Concurrent-claim race still handled by #627.** If a brand-new claim lands *after* we reconcile but *before* we push, the push is still non-fast-forward and the existing #627 path parks `claim_lost`. Reconciliation shrinks the stale-base window to that genuine race; #627 remains the correct safety net for it.
- **Reconcile failure is a handled failure.** Folding the reconcile call into the existing worktree-setup `try/catch` means a transient fetch/reset failure returns `outcome: 'failed', reason: 'worktree_error'` (post non-workflow comment, exit clean). The next cron tick re-dispatches; because the idempotency guard still finds no PR on the claim branch, regeneration retries cleanly.

Rejected alternative — `resetWorktreeToRemote` (`adws/vcs/worktreeReset.ts`): it is the takeover primitive and additionally runs `git clean -fdx`, which would delete the worktree's copied `.env`. The upgrade flow has no in-progress merge/rebase to abort, so its extra machinery is unneeded and its `clean -fdx` is an active hazard here. `fetchAndResetToRemote` is the minimal, correct fit.

Rejected alternative — adding an opt-in flag to `ensureWorktree`: it widens the shared primitive's signature and risks the very orchestrators the acceptance criteria protect. Caller-side reconciliation via DI is cleaner and lower-risk.

## Relevant Files

Use these files to implement the feature:

- `adws/adwUpgrade.tsx` — **primary change.** Add a `reconcileWorktreeToRemote` field to `UpgradeDeps`; call it in `executeUpgrade` right after `deps.ensureWorktree(...)` (step 3) and before `deps.copyInitCommandToWorktree(...)` / `runInitCommand` (step 4); wire the default to `fetchAndResetToRemote` in `buildDefaultUpgradeDeps`; add `fetchAndResetToRemote` to the `./vcs` import.
- `adws/vcs/branchOperations.ts` — defines `fetchAndResetToRemote(defaultBranch, cwd)` (lines 233-249), the reconcile primitive to reuse. Generic over branch name; `git fetch origin <branch>` + `git reset --hard origin/<branch>`; throws on failure. No change required (read-only reference).
- `adws/vcs/index.ts` — already re-exports `fetchAndResetToRemote` (line 17). Confirms the import path for `adwUpgrade.tsx`. No change required.
- `adws/vcs/worktreeCreation.ts` — `ensureWorktree` (lines 221-234), the root-cause reuse-as-is function. **Left unchanged** — the fix is deliberately caller-side. Read-only reference.
- `adws/vcs/worktreeOperations.ts` — `copyEnvToWorktree` (writes the gitignored `.env` into the worktree). Read-only reference establishing why the reconcile must not `git clean -fdx`.
- `adws/vcs/worktreeReset.ts` — `resetWorktreeToRemote`, the rejected alternative (adds `git clean -fdx`). Read-only reference.
- `adws/phases/workflowInit.ts` — line 226 shows the precedent `fetchAndResetToRemote(defaultBranch, worktreePath)` usage after `ensureWorktree`. Read-only reference; mirror this pattern.
- `adws/core/upgradeClaim.ts` — `buildClaimBranchName(hash)`, `defaultPushClaimBranch` (nonce mechanism), and `isPushRejectionError` (the #627 classifier). Read-only reference for branch naming and the divergence/nonce model.
- `adws/__tests__/adwUpgrade.test.ts` — **test change.** Existing DI test suite using `makeDeps`. Add the new dep to `makeDeps` and new test cases for wiring/ordering/failure of the reconcile step.
- `.adw/commands.md` — source of the validation commands (lint, type-check, unit tests, build).
- `.adw/project.md` — confirms `## Unit Tests: enabled` (this plan therefore includes unit-test tasks) and `bun add <package>` as the library install command.
- `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — conditional doc: `executeUpgrade()` / `UpgradeDeps` structure, the `.adw/` regen path, and the existing copy/verify steps the reconcile call slots between.
- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — conditional doc: VCS repo-context threading for `ensureWorktree` / `copyEnvToWorktree` (`baseRepoPath` semantics).

### New Files
- `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` — focused unit test for the reconcile primitive (currently untested). Mirrors the mocked-`execSync` style of `adws/vcs/__tests__/worktreeReset.test.ts`. Verifies fetch-then-reset ordering for an arbitrary (claim) branch and the throw-on-failure contract. (Added separately so the existing pure-function `branchOperations.test.ts` does not need to introduce module mocks.)

## Implementation Plan

### Phase 1: Foundation
Confirm the reconcile primitive and the injection seam. `fetchAndResetToRemote(branch, cwd)` already exists and is exported; `executeUpgrade` already takes all side effects via `UpgradeDeps`. No new modules or libraries are required — the foundation is reusing an existing primitive through the existing DI pattern.

### Phase 2: Core Implementation
Extend `UpgradeDeps` with `reconcileWorktreeToRemote(worktreePath, branch)`, wire its production default to `fetchAndResetToRemote` (argument order flipped), and invoke it in `executeUpgrade` after `ensureWorktree` and before regen, inside the worktree-setup `try/catch`.

### Phase 3: Integration
Update the test double (`makeDeps`) so the full existing suite keeps passing, add unit coverage for the new wiring/ordering/failure paths and the diverged-reuse happy path, add a focused test for the reconcile primitive, then run the full validation suite to confirm zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Extend the `UpgradeDeps` interface
- In `adws/adwUpgrade.tsx`, add a new field to the `UpgradeDeps` interface:
  ```ts
  /**
   * Reconciles the (possibly reused) upgrade worktree to the live remote claim tip
   * before regen: git fetch origin <branch> + git reset --hard origin/<branch>.
   * Fixes the stale-worktree non-fast-forward that #627 only parks. Hard reset is
   * safe — the upgrade worktree is a throwaway regen target with no un-pushed work.
   */
  readonly reconcileWorktreeToRemote: (worktreePath: string, branch: string) => void;
  ```
- Place it adjacent to `ensureWorktree` in the interface for readability.

### 2. Import the reconcile primitive
- In `adws/adwUpgrade.tsx`, add `fetchAndResetToRemote` to the existing `import { ensureWorktree, commitChanges, pushBranch } from './vcs';` line so it reads `import { ensureWorktree, commitChanges, pushBranch, fetchAndResetToRemote } from './vcs';`.

### 3. Wire the default dependency
- In `buildDefaultUpgradeDeps`, add the production wiring (note the argument flip — `fetchAndResetToRemote` takes `(branch, cwd)`):
  ```ts
  reconcileWorktreeToRemote: (worktreePath, branch) => fetchAndResetToRemote(branch, worktreePath),
  ```
- Keep it next to the `ensureWorktree` entry.

### 4. Invoke reconcile before regen in `executeUpgrade`
- In `executeUpgrade`, extend the existing step-3 worktree `try/catch` so the worktree is reconciled immediately after it is ensured and before the step-4 copy/regen:
  ```ts
  // 3. Check out the existing remote claim branch, then reconcile it to the live
  //    remote claim tip. A reused worktree may sit on a superseded claim commit
  //    (a prior claim cycle re-created the branch with a new nonce); regenerating
  //    on that stale base produces a push that can never fast-forward (#627 then
  //    parks it). Resetting to origin/<claim-branch> makes the regen fast-forwardable.
  //    Hard reset is safe: the upgrade worktree is a throwaway regen target.
  let worktreePath: string;
  try {
    worktreePath = deps.ensureWorktree(branch, defaultBranch, baseRepoPath);
    deps.reconcileWorktreeToRemote(worktreePath, branch);
  } catch (error) {
    deps.commentOnIssue(
      issueNumber,
      buildUpgradeFailureComment(String(error), adwId, issueNumber),
      repoInfo,
    );
    return { outcome: 'failed', reason: 'worktree_error' };
  }
  ```
- Do not introduce a new result `reason`; reconcile is part of worktree preparation, so reusing `worktree_error` keeps the result surface stable and self-heals on re-dispatch.

### 5. Update the test double in `adwUpgrade.test.ts`
- In `adws/__tests__/adwUpgrade.test.ts`, add `reconcileWorktreeToRemote: vi.fn(),` to the `makeDeps` defaults object so all existing tests continue to construct a complete `UpgradeDeps`.

### 6. Add unit tests for the reconcile wiring (diverged-reuse path)
- In `adws/__tests__/adwUpgrade.test.ts`, add a new `describe('executeUpgrade — reconcile-before-regen (stale worktree)')` block covering:
  - **Called with the claim branch:** `reconcileWorktreeToRemote` is called once with `(<worktreePath returned by ensureWorktree>, buildClaimBranchName(MOCK_HASH))`.
  - **Ordering — after ensureWorktree:** using a shared `callOrder: string[]`, assert `ensureWorktree` runs before `reconcileWorktreeToRemote`.
  - **Ordering — before regen:** assert `reconcileWorktreeToRemote` runs before `copyInitCommandToWorktree` and before `runInitCommand` (it must reconcile *before* regen).
  - **Happy path / regression:** with all defaults plus the new dep, the run still reaches `reason: 'pr_merged'` and `createPullRequest` is called exactly once (proves reconcile does not disturb the success path — the diverged-reuse case now yields a fast-forwardable push).
  - **Reconcile failure is handled:** when `reconcileWorktreeToRemote` throws, the result is `outcome: 'failed', reason: 'worktree_error'`, exactly one non-ADW `commentOnIssue` is posted, and `runInitCommand`, `writeAdwVersion`, `commitChanges`, `pushBranch`, and `createPullRequest` are **not** called.

### 7. Add a focused unit test for `fetchAndResetToRemote`
- Create `adws/vcs/__tests__/fetchAndResetToRemote.test.ts`, mirroring the mocked-`execSync` pattern in `adws/vcs/__tests__/worktreeReset.test.ts` (`vi.mock('child_process', ...)`, `vi.mock('../../core', () => ({ log: vi.fn() }))`). Cover:
  - **Order & exact commands for an arbitrary claim branch:** calling `fetchAndResetToRemote('adw-upgrade-deadbeef', '/wt')` issues `git fetch origin "adw-upgrade-deadbeef"` then `git reset --hard "origin/adw-upgrade-deadbeef"` in that order (proves generality over branch name, not just the default branch).
  - **Throws on fetch failure and skips reset:** when the fetch `execSync` throws, the function throws `/Failed to fetch origin\//` and `git reset --hard` is never called.
  - **Throws on reset failure:** when fetch succeeds but reset throws, the function throws `/Failed to reset to origin\//`.

### 8. Run validation
- Run every command in the `Validation Commands` section below and confirm all pass with zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope. Tests use **vitest** (run via `bun run test:unit`).

- **`adws/__tests__/adwUpgrade.test.ts` (extended):**
  - Reconcile is invoked exactly once with `(worktreePath, buildClaimBranchName(hash))`.
  - Reconcile runs **after** `ensureWorktree` and **before** `copyInitCommandToWorktree` / `runInitCommand` (the "before regen" contract).
  - Success path remains `pr_merged` with reconcile wired in (diverged-reuse → fast-forwardable push; no regression to the existing success, hitl, merge-failed, claim-lost, idempotency, or LLM-failure tests, all of which now construct the new dep via `makeDeps`).
  - Reconcile throw → `worktree_error`, one non-ADW comment, no regen/stamp/commit/push/PR.
- **`adws/vcs/__tests__/fetchAndResetToRemote.test.ts` (new):**
  - Emits `git fetch origin "<branch>"` then `git reset --hard "origin/<branch>"` in order for a non-default (claim) branch.
  - Throws and stops at fetch failure; throws at reset failure.

### Edge Cases
- **First run (worktree created fresh):** `ensureWorktree` creates the worktree already at the claim tip; reconcile is a no-op fetch+reset to the same commit. Push proceeds normally.
- **Reused worktree on a superseded nonce commit (the incident):** reconcile resets HEAD from the old nonce commit to `origin/<claim-branch>`; regen rebuilds on the live commit; push fast-forwards.
- **Reused worktree carrying a prior local regen commit (parked previous run):** `git reset --hard` discards the stale local regen commit; regen reruns on the fresh base.
- **Concurrent-claim race (new claim lands after reconcile, before push):** push is still non-fast-forward → existing #627 `claim_lost` park handles it (no crash, no force-push).
- **Reconcile fetch/reset failure (transient/offline, or claim branch absent):** handled as `worktree_error`; idempotency guard (no PR on claim branch) lets the next cron tick retry cleanly.
- **`.env` preservation:** reconcile uses `fetchAndResetToRemote` (no `git clean -fdx`), so the worktree's gitignored `.env` copied by `ensureWorktree` and the later-copied `adw_init.md` are untouched.
- **Idempotency guard precedence:** if a PR already exists for the claim branch, `executeUpgrade` returns `pr_already_exists` before worktree setup, so reconcile never runs in that case (unchanged behaviour).

## Acceptance Criteria
- An `adwUpgrade` run that reuses a stale `.worktrees/adw-upgrade-<hash>/` worktree resets it to `origin/<claim-branch>` before regen, so the resulting push is fast-forwardable (verified by the reconcile-ordering and success-path unit tests).
- `adws/vcs/worktreeCreation.ts` `ensureWorktree` is unchanged; no other orchestrator that calls `ensureWorktree` changes behaviour (the reconcile is caller-side in `adwUpgrade.tsx` only).
- The reconcile primitive performs `git fetch origin <claim-branch>` + `git reset --hard origin/<claim-branch>` and does not run `git clean -fdx` (so `.env` survives).
- A genuine concurrent-claim race still parks as `claim_lost` via the existing #627 path (unchanged).
- Unit coverage exists for the diverged-reuse path (wiring, ordering, failure handling) and for the reconcile primitive.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Lint the codebase for quality/style issues.
- `bunx tsc --noEmit` — Type-check the root project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the `adws/` orchestrator project (additional type checks).
- `bunx vitest run adws/__tests__/adwUpgrade.test.ts adws/vcs/__tests__/fetchAndResetToRemote.test.ts` — Run the directly-affected suites (fast feedback on the new wiring and primitive tests).
- `bun run test:unit` — Run the full vitest unit suite to confirm zero regressions across the codebase.
- `bun run build` — Build to verify there are no build errors.

## Notes
- `.adw/coding_guidelines.md` applies. The change honours: **clarity over cleverness** (a single well-commented reconcile call), **modularity / reuse** (reuses `fetchAndResetToRemote` rather than adding a parallel helper), **purity at the edges** (the git side effect stays injected through `UpgradeDeps`), and **flat control flow** (no added nesting — the reconcile call joins the existing `try/catch`).
- No new libraries are required. (Library install command for this repo is `bun add <package>` per `.adw/commands.md` / `.adw/project.md`, should any future need arise.)
- The fix is intentionally caller-scoped. `fetchAndResetToRemote` is already battle-tested in `adws/phases/workflowInit.ts:226` for the standard workflow; this feature applies the same primitive to the upgrade path's claim branch.
- BDD/per-issue scenarios for issue #628 are authored by the separate `scenario_writer` phase (routed to `features/per-issue/feature-628.feature` per `.adw/scenarios.md`) and are out of scope for this planning document; the explicit issue acceptance ("Unit coverage for the diverged-reuse path") is satisfied by the vitest unit tests above.
- `fetchAndResetToRemote`'s parameter is named `defaultBranch` for historical reasons but is fully generic over branch name (its body assumes nothing about the default branch). It is reused as-is to avoid churn; the new `fetchAndResetToRemote.test.ts` documents this generality by exercising it with a claim branch.
- Related background: `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` (regen/verify gate the reconcile slots before) and the memory note on the ADW self-upgrade no-op loop (the `.adw-version` disarm recipe is the manual workaround this feature removes the need for).
```