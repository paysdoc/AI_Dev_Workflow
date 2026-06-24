# Feature: Upgrade gate reads `.adw-version` from the remote default branch, before worktree setup

## Metadata
issueNumber: `712`
adwId: `vednf3-upgradegate-compare`
issueJson:
```json
{"number":712,"title":"upgradeGate: compare framework hash against remote default-branch .adw-version before worktree setup (stale-worktree false mismatch, root cause behind vestmatic #197/#203)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-24T14:11:47Z"}
```
> Body abbreviated for readability; the authoritative source is GitHub issue #712. Key claims preserved verbatim in the Problem Statement below.

## Feature Description
The framework self-upgrade gate (`runUpgradeGate` in `adws/phases/upgradeGate.ts`, wired into `initializeWorkflow` in `adws/phases/workflowInit.ts`) decides whether a target repo's `.adw/` configuration is stale relative to the running framework. It does this by comparing the framework's current content hash (`computeFrameworkHash`) against the target repo's stored `.adw-version`.

Today the stored version is read from a **local artifact** — `readAdwVersion(worktreePath)` against the just-created/reused feature worktree — and the comparison runs **after** worktree setup. When a workflow reuses a **stale** worktree (one created before a prior upgrade merged), the gate reads an old `.adw-version`, perceives a false hash mismatch, and spawns/parks a spurious framework upgrade even though the target's default branch is already up to date.

This feature changes the gate's source of truth to the **authoritative remote default branch** (`git show origin/<defaultBranch>:.adw-version`) and moves the comparison to run **before** worktree setup. A stale local worktree can no longer spoof an old version, and on a genuine mismatch the upgrade is claimed/parked/spawned before any throwaway feature worktree is created.

The value: it eliminates the false-mismatch class of spurious upgrades (the root cause behind the vestmatic #197/#203 deadlock), removes wasted worktree churn on the mismatch path, and makes "park before building a worktree" the natural control flow.

## User Story
As an **ADW operator running unattended workflows against target repos**
I want **the upgrade gate to compare the framework hash against the target's remote default-branch `.adw-version`, before a feature worktree is built**
So that **a workflow reusing a stale worktree never triggers a spurious framework upgrade, and genuine upgrades park losers without creating throwaway worktrees**.

## Problem Statement
`storedVersion` is sourced from a mutable, possibly-stale local artifact (the worktree's `.adw-version` at `upgradeGate.ts:121` — `readAdwVersion(params.worktreePath)`) instead of the authoritative remote default branch. `ensureWorktree` reuses an existing worktree as-is without resetting it to the default-branch tip, so the local file can lag arbitrarily.

Observed incident (vestmatic, 2026-06-24):
1. Upgrade to hash `1e36648f994a` completed: PR #202 merged, `dev`'s `.adw-version = 1e36648f`, #200 closed.
2. #197 (blocked-by #200) became eligible and **reused its stale worktree** (5 commits behind `dev`, `.adw-version = c1acb23`).
3. Gate read the stale worktree value → `current=1e36648f ≠ stored=c1acb23` → **false mismatch** → won a fresh claim (the merged claim branch had been deleted) → created orphan tracking issue **#203** + re-parked #197.
4. #203's regen ran off current `dev` → no diff → no PR possible → **#203 stuck open**, #197 deadlocked behind it.

The authoritative source (`origin/dev:.adw-version`) was `1e36648f` the whole time — reading it would have produced a correct match and none of this would have happened.

Additionally, because the gate ran **after** worktree setup, a parked loser had already paid for a throwaway feature worktree before being sent back to Todo.

## Solution Statement
Two coordinated changes, scoped to the cheap version **read** only (the upgrade winner path and claim push are deliberately left unchanged):

1. **Change the source of truth.** Add `readRemoteAdwVersion(defaultBranch, workspacePath)` to `adws/core/adwVersion.ts`, reading `origin/<defaultBranch>:.adw-version` via `git show`. It returns the trimmed hash, or `null` when the file is absent on the remote / empty (treating "never initialized" identically to "out of date", matching today's `null`-triggers-upgrade semantics). Thread a `defaultBranch` parameter through `UpgradeGateParams` and change `UpgradeGateDeps.readAdwVersion` to the `(defaultBranch, workspacePath)` signature; wire the new reader in `buildDefaultUpgradeGateDeps`.

2. **Reorder the gate before worktree setup.** In `initializeWorkflow`, resolve `defaultBranch = gitCtx.defaultBranch()` early and run the gate immediately after the target-repo workspace is resolved but **before** the feature worktree is built. Pass the **target repo clone root** (`targetRepoWorkspacePath`) as the gate's `worktreePath` (its `origin` resolves to the target remote, which both the remote read and the claim push require). On `proceed` → continue to normal worktree setup. On `parked` → `process.exit(0)` before any feature worktree or workflow comment is created; losers return to Todo with no throwaway worktree.

**Invariant preserved (do not break):** the atomic **claim push** stays pinned to a path inside the target clone (`buildDefaultUpgradeClaimDeps(targetRepoWorkspacePath)`), as confirmed sound in the 2026-06-09 design session and depended on by the Bug-A fix in `94059b5`. Only the cheap version *read* moves earlier and changes source; the upgrade winner and `adwUpgrade.tsx` still create/use a worktree for the claim commit + regen. The mismatch path is rare, so building a worktree there (in the winner path) is acceptable.

## Relevant Files
Use these files to implement the feature:

- `adws/core/adwVersion.ts` — Owns `readAdwVersion` / `writeAdwVersion` / `ADW_VERSION_FILENAME`. This is the low-level direct-I/O leaf module for the `.adw-version` file; the new `readRemoteAdwVersion` reader belongs here alongside the existing local readers. Already a raw-`fs` module, so a raw `git show` read is consistent with its role.
- `adws/phases/upgradeGate.ts` — Owns `runUpgradeGate`, `UpgradeGateParams`, `UpgradeGateDeps`, `buildDefaultUpgradeGateDeps`, `shouldTriggerUpgrade`. The version read happens at `runUpgradeGate` (`const storedVersion = deps.readAdwVersion(...)`); this is where the source and signature change.
- `adws/phases/workflowInit.ts` — Owns `initializeWorkflow`. Holds the gate call site and the worktree-setup block. The gate block moves from after worktree setup (and after `createRepoContext`) to before worktree setup, keyed on `targetRepo && targetRepoWorkspacePath`, using `targetRepoWorkspacePath` + `defaultBranch`.
- `adws/core/upgradeClaim.ts` — `claimUpgradeOrFindExisting` / `buildDefaultUpgradeClaimDeps`. Read-only context: confirm the claim push still receives the target clone root so the winner/loser election stays scoped per-target (the preserved invariant). No change expected here.
- `adws/core/hashComputer.ts` — `computeFrameworkHash`, the "current hash" side of the comparison. Read-only context; unchanged.
- `adws/adwUpgrade.tsx` — The upgrade orchestrator the winner spawns (`spawnUpgradeOrchestrator`). Read-only context: the winner path is unchanged.

### Test Files
- `adws/core/__tests__/adwVersion.test.ts` — Add `readRemoteAdwVersion` coverage (success → trimmed hash; absent/error → null; empty → null).
- `adws/phases/__tests__/upgradeGate.test.ts` — Add coverage that `runUpgradeGate` passes `(defaultBranch, workspacePath)` to `readAdwVersion`, and the stale-worktree-but-remote-current → `proceed` case; ensure existing winner/loser tests stay green with the new `defaultBranch` param in `makeParams`.
- `adws/phases/__tests__/workflowInit.test.ts` — If the existing harness allows, assert the gate runs before worktree setup and that a `parked` outcome exits before worktree creation; otherwise rely on the gate-level coverage above.

### Conditional Documentation
Per `.adw/conditional_docs.md`, this task matches these documents — read them before implementing:
- `app_docs/feature-n9880l-adwversion-read-write-module.md` — `readAdwVersion`/`writeAdwVersion` from `adws/core`, the `.adw-version` file contract, and the `initializeWorkflow()` hash comparison / "never initialized vs out of date" collapsing logic.
- `app_docs/feature-tlk8qf-hash-check-upgrade-gate.md` — `runUpgradeGate`, `buildDefaultUpgradeGateDeps`, `UpgradeGateDeps`, and the gate inserted into `initializeWorkflow()`; parking semantics when `.adw-version` is missing/stale.
- `app_docs/feature-m45h0x-upgradeclaim-deep-module.md` — `claimUpgradeOrFindExisting`, `buildDefaultUpgradeClaimDeps`, the per-target claim-namespace invariant (the claim-push-needs-target-worktree constraint to preserve).
- `app_docs/feature-v7dih7-adwupgrade-worktree-reconcile.md` — #628 prior art: the stale-reused-worktree counterpart for the `adwUpgrade` orchestrator's *own* worktree (`fetchAndResetToRemote`). Same bug class, different code path; consult when deciding whether a shared "read authoritative version from remote default branch" helper is warranted.

## Implementation Plan
### Phase 1: Foundation — authoritative remote read
Add the remote-read primitive in `adws/core/adwVersion.ts`. This is a pure, self-contained leaf that the gate can depend on without any reordering risk. It mirrors the existing `readAdwVersion`/`writeAdwVersion` shape and `null` semantics so the rest of the gate logic (`shouldTriggerUpgrade`) is untouched.

### Phase 2: Core Implementation — thread the remote read through the gate
Extend `UpgradeGateParams` with `defaultBranch`, change `UpgradeGateDeps.readAdwVersion` to `(defaultBranch, workspacePath) => string | null`, update `runUpgradeGate` to call it with `params.defaultBranch, params.worktreePath`, and wire `readRemoteAdwVersion` in `buildDefaultUpgradeGateDeps`. The `shouldTriggerUpgrade(currentHash, storedVersion)` semantics (`storedVersion !== currentHash`, `null` triggers upgrade) stay exactly as-is.

### Phase 3: Integration — reorder before worktree setup in `initializeWorkflow`
Resolve `defaultBranch = gitCtx.defaultBranch()` early; move the gate block to run after the target-repo workspace is resolved and before the feature worktree is built; key it on `targetRepo && targetRepoWorkspacePath`; pass `targetRepoWorkspacePath` as `worktreePath` and the resolved `defaultBranch`; resolve `gateRepoId` from `options?.repoId` (since `createRepoContext` now runs later); `process.exit(0)` on `parked`. Remove the old post-setup gate block and update the now-stale `createRepoContext` comment.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1: Read context docs and confirm the preserved invariant
- Read the four conditional docs listed above, plus `adws/core/upgradeClaim.ts` and the current `adws/phases/upgradeGate.ts` / `adws/phases/workflowInit.ts`.
- Confirm the claim push is pinned to a path inside the target clone (`buildDefaultUpgradeClaimDeps(targetRepoWorkspacePath)`); this must remain true after the change.

### Task 2: Add `readRemoteAdwVersion` to `adws/core/adwVersion.ts`
- Export `readRemoteAdwVersion(defaultBranch: string, workspacePath: string): string | null`.
- Implement via `git show "origin/<defaultBranch>:.adw-version"` (`ADW_VERSION_FILENAME`) with `cwd: workspacePath`, `stdio: 'pipe'`.
- Return the trimmed content; return `null` when the content is empty or when `git show` throws (file/branch absent on remote → "never initialized").
- JSDoc must state: this is the authoritative read, immune to stale local worktrees; `workspacePath` is the target clone root (not a feature worktree) so `origin` resolves to the target remote.

### Task 3: Thread `defaultBranch` and the remote read through `adws/phases/upgradeGate.ts`
- Add `defaultBranch: string` to `UpgradeGateParams`; document that `worktreePath` is the target clone root used for both the remote read and the claim push base path.
- Change `UpgradeGateDeps.readAdwVersion` to `(defaultBranch: string, workspacePath: string) => string | null`.
- In `runUpgradeGate`, call `deps.readAdwVersion(params.defaultBranch, params.worktreePath)`.
- In `buildDefaultUpgradeGateDeps`, wire `readAdwVersion: (defaultBranch, workspacePath) => readRemoteAdwVersion(defaultBranch, workspacePath)`; replace the `readAdwVersion` import with `readRemoteAdwVersion`.
- Leave `claimUpgrade`, the per-target claim invariant comment, and all winner/loser orchestration unchanged.

### Task 4: Reorder the gate before worktree setup in `adws/phases/workflowInit.ts`
- Resolve `const defaultBranch = gitCtx.defaultBranch();` before the worktree-setup block.
- Move the upgrade-gate block to run immediately after `targetRepoWorkspacePath` is resolved and **before** the worktree is created (originally lines ~219–252).
- Change the guard to `if (targetRepo && targetRepoWorkspacePath)`.
- Build `UpgradeGateParams` with `worktreePath: targetRepoWorkspacePath` and `defaultBranch`; call `buildDefaultUpgradeGateDeps(gateRepoId, targetRepoWorkspacePath)`.
- Resolve `gateRepoId` from `options?.repoId ?? { owner, repo, platform: Platform.GitHub }` (the `repoContext`/`repoIdForContext` value is no longer available this early).
- On `outcome.action === 'parked'` → log and `process.exit(0)` before any worktree or workflow comment is created.
- Delete the old post-`createRepoContext` gate block; update the `createRepoContext` comment to "available to board setup and subsequent phases".

### Task 5: Unit tests
- `adws/core/__tests__/adwVersion.test.ts`: add a `readRemoteAdwVersion` describe block covering success (trimmed hash), null-on-error (absent file/branch), and null-on-empty. Prefer a hermetic temp-git-repo fixture (a `mkdtempSync` repo with a committed `.adw-version` on a branch, reachable as `origin/<branch>` via a local clone/remote) **or** refactor `readRemoteAdwVersion` to accept an injectable exec function so the success path is asserted deterministically rather than via a trivial type-only check. (See Notes — the read must be genuinely mockable to satisfy the acceptance criteria.)
- `adws/phases/__tests__/upgradeGate.test.ts`: add `defaultBranch` to the `makeParams` factory; assert `runUpgradeGate` calls `readAdwVersion` with `(defaultBranch, workspacePath)`; add the stale-worktree-but-remote-current case (`readAdwVersion` returns `CURRENT_HASH` → `outcome.action === 'proceed'`, `claimUpgrade` not called). Confirm existing winner/loser tests still pass with the new param.
- `adws/phases/__tests__/workflowInit.test.ts`: if the harness supports it, assert the gate runs before worktree setup and a `parked` outcome short-circuits before worktree creation; otherwise document that gate-ordering is covered structurally and rely on the gate-level tests.

### Task 6: Documentation coherence
- Update the README "Framework self-upgrade" bullet (currently describes the *post*-worktree, local-read behavior) to describe the *pre*-worktree gate reading `origin/<default>:.adw-version`. Note: documentation is normally produced by the separate document phase — keep this minimal and factual, or defer to that phase if the orchestrator runs it.

### Task 7: Run the Validation Commands
- Execute every command in the Validation Commands section; all must pass with zero regressions before the feature is considered complete.

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

- **`readRemoteAdwVersion` (adwVersion.test.ts):** success returns the trimmed hash from `git show`; absence (non-zero `git show` exit — missing file or missing branch) returns `null`; empty content returns `null`. The read must be deterministically exercisable — use a temp-git-repo fixture or an injectable exec dependency rather than asserting only that the result is "a string or null".
- **Gate read source/signature (upgradeGate.test.ts):** `runUpgradeGate` forwards `(params.defaultBranch, params.worktreePath)` to `deps.readAdwVersion`; the stale-worktree-but-remote-current scenario (`readAdwVersion` → `CURRENT_HASH`) yields `proceed` and never calls `claimUpgrade`. Existing winner/loser/proceed tests remain green after adding `defaultBranch` to `makeParams`.
- **Gate ordering (workflowInit.test.ts):** where harness-feasible, assert the gate runs before worktree setup and that `parked` exits before worktree creation.

### Edge Cases
- **`.adw-version` absent on the remote default branch** → `readRemoteAdwVersion` returns `null` → `shouldTriggerUpgrade` returns `true` → upgrade triggered (preserves today's "never initialized = out of date" unification).
- **`git show` exits non-zero** (missing branch, detached/odd state) → caught → `null` (fail toward triggering an upgrade, never a crash).
- **Empty/whitespace `.adw-version` content** → `null`.
- **Self-hosting repo (no `targetRepo`)** → gate skipped entirely by the `targetRepo && targetRepoWorkspacePath` guard; framework's own runs are unaffected.
- **Stale reused worktree, remote default branch current** → remote read matches the framework hash → `proceed`; no spurious upgrade (the core fix; mirrors vestmatic #197).
- **Genuine mismatch** → claim/park/spawn occurs before the feature worktree is built; losers return to Todo via `process.exit(0)` with no throwaway worktree.
- **Loser races ahead of the `#UPG` issue creation** → existing "lost claim but no `#UPG` yet" branch still parks without a body edit (unchanged).

## Acceptance Criteria
- A workflow that reuses a stale worktree (`.adw-version` behind the default branch) does **not** trigger an upgrade when the remote default branch's `.adw-version` matches the framework hash (gate returns `proceed`).
- On a genuine mismatch (remote default-branch `.adw-version` ≠ framework hash), the upgrade is claimed/parked/spawned **before** the feature worktree is created; losers return to Todo with no throwaway worktree (`process.exit(0)` precedes worktree setup).
- The claim push still targets the target repo's branch namespace (claim-needs-target-worktree invariant intact); existing `upgradeClaim`/`upgradeGate` tests stay green.
- Unit coverage exists for: the gate reading the stored version from the remote default branch (mocked read), and the stale-worktree-but-current-default-branch case yielding `proceed`.
- `bun run lint`, both `tsc --noEmit` checks, `bun run test:unit`, and `bun run build` all pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Lint the codebase for quality issues.
- `bunx tsc --noEmit` — Root type-check (strict mode).
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional `adws/` project type-check.
- `bunx vitest run adws/core/__tests__/adwVersion.test.ts adws/phases/__tests__/upgradeGate.test.ts adws/phases/__tests__/workflowInit.test.ts` — Targeted: the directly-affected unit suites must pass.
- `bun run test:unit` — Full unit suite; zero regressions across all existing tests.
- `bun run build` — Build to verify no compile/build errors.

## Notes
- **Coding guidelines (`.adw/coding_guidelines.md`):** keep `readRemoteAdwVersion` a small pure-ish leaf with the side effect (`git show`) isolated at the boundary and a guard-clause/`try-catch`-returns-null shape (no deep nesting). Prefer explicit types; avoid `any`. Files stay well under the 300-line ceiling.
- **No new libraries** — uses Node's built-in `child_process.execSync`. (Per `.adw/commands.md`, the library install command is `bun add <package>` if one were ever needed.)
- **GitContext design tension (flag for review):** the framework is mid-migration to making `GitContext` (`adws/gitContext/`) the single authority for all `git`/`gh` I/O (PRD: GitContext repo-context authority; recent #658–#666, #694, #696, #699). `readRemoteAdwVersion` uses a raw `execSync('git show ...')`. This is defensible because `adwVersion.ts` is already a raw-I/O leaf (it does direct `fs` reads/writes, not via GitContext) and `readAdwVersion`/`writeAdwVersion` set that precedent. If reviewers prefer strict GitContext routing, the alternative is to add a `show(ref, file)` read-op to `gitReadOps`/`GitContext` and call it from `initializeWorkflow` (where `gitCtx` is already in scope) — at the cost of widening the GitContext surface. Decide deliberately; do not leave it implicit.
- **Shared helper with #628 (consider):** #628 solved the same stale-reused-worktree class for the `adwUpgrade` orchestrator's own worktree (`feature-v7dih7-adwupgrade-worktree-reconcile.md`) by resetting to the remote tip. This issue is the `upgradeGate`-side counterpart that reads (rather than resets). A shared "authoritative version from remote default branch" concept may be worth extracting later; not required for this fix.
- **PRD revision:** `specs/prd/adw-init-hash-and-label-classification.md:69` deliberately placed the gate "after worktree setup, before classification" and read from the worktree. This feature revises that decision (source = remote default branch; ordering = before worktree). Consider updating that PRD line for design-intent coherence; optional and out of the critical path.
- **Operational cleanup (separate from this fix):** vestmatic #203 is an orphan no-op upgrade issue (claim branch tree-identical to `dev`, no PR possible). Close it and remove the stale #197 worktree so #197 can rebuild fresh off `dev`. This is operator action, not code.
- **⚠️ Current working-tree state (important):** at planning time, the worktree already contained a complete, coherent, **uncommitted** implementation of this exact feature (the new `readRemoteAdwVersion`, the gate reorder, the signature/param threading, tests, and the README bullet — `git diff HEAD` spanning the six files above, with `HEAD == origin/dev`). The plan above describes that same solution. The implementer should reconcile against those working-tree changes rather than re-deriving from scratch, and should specifically **strengthen the `readRemoteAdwVersion` unit tests**, which as-staged do not genuinely mock the read (they assert only `typeof result === 'string' || result === null`, which is trivially true) and therefore do not satisfy the "mock the read" acceptance criterion.
```
