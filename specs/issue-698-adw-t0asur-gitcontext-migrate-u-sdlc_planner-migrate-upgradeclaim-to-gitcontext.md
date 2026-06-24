# Feature: Migrate upgradeClaim distributed-lock git ops onto GitContext (HITL)

## Metadata
issueNumber: `698`
adwId: `t0asur-gitcontext-migrate-u`
issueJson: `{"number":698,"title":"GitContext: migrate upgradeClaim distributed-lock git ops (HITL)","body":"## Parent PRD\n`specs/prd/git-context-repo-authority.md`\n\n## What to build\nMigrate upgradeClaim's distributed-lock git ops (fetch/worktree/commit/push) onto GitContext. HITL: this is a coordination primitive (winner/loser election) — review the lock semantics carefully before merge.\n\n## Acceptance criteria\n- [ ] upgradeClaim routes through GitContext (no raw git)\n- [ ] Lock winner/loser semantics unchanged (integration test green)\n- [ ] Removed from `ALLOWLIST`\n- [ ] `lint:git-guard` passes\n\n## Blocked by\n- Blocked by #696\n\n## Touched Files\n- adws/gitContext/gitContext.ts\n- adws/core/upgradeClaim.ts\n- adws/checkGitGhGuard.ts\n\n## User stories addressed\n- User story 5\n- User story 17","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-06-23T11:45:32Z","comments":[],"actionableComment":null}`

## Feature Description
`adws/core/upgradeClaim.ts` implements ADW's distributed upgrade-claim primitive — the atomic winner/loser election that guarantees **exactly one** orchestrator runs an `adwUpgrade` for a given framework hash, using the target repo's GitHub branch namespace as a create-if-not-exists lock. It is the last `bootstrap`-category consumer of raw `git` shell-outs (`execSync('git …')`) in its hot path.

This feature migrates those raw git operations onto `GitContext` — the single per-command-auth chokepoint mandated by the GitContext PRD (`specs/prd/git-context-repo-authority.md`, user stories 5 and 17). After this change, every git verb the claim performs (fetch, detached-worktree add, empty commit, namespace push, worktree remove) routes through `GitContext.#run()`, inheriting per-command token injection, git-identity injection, and explicit `cwd` — and `adws/core/upgradeClaim.ts` is removed from the `checkGitGhGuard` `ALLOWLIST`.

This is a **HITL (Human-In-The-Loop)** feature because the claim is a coordination primitive: the winner/loser election rests on subtle git semantics (a non-fast-forward push **rejection** is the lock; a unique nonce makes that rejection deterministic). The migration must preserve those semantics **byte-for-byte at the command level**, which is why it cannot blindly reuse the existing standard GitContext worktree/commit/push methods (see Problem Statement).

## User Story
As an ADW operator running upgrades across many target repos
I want the upgrade-claim's git operations to route through GitContext's per-command-auth chokepoint
So that the winner/loser lock is auth-correct per target repo (no `GH_TOKEN`/cwd bleed), survives the CI git/gh guard, and continues to elect exactly one winner with identical semantics.

## Problem Statement
`upgradeClaim.ts` shells out to `git` directly in two functions:

- **`defaultPushClaimBranch`** runs four raw git commands:
  1. `git fetch origin "<defaultBranch>"` (cwd = base repo)
  2. `git worktree add --detach "<tmpdir>" "origin/<defaultBranch>"` (cwd = base repo)
  3. `git commit --allow-empty -m "ADW upgrade in progress: <hash> [<nonce>]"` (cwd = tmpdir)
  4. `git push origin "HEAD:refs/heads/<branch>"` — **without `--force`** (cwd = tmpdir)
- **`cleanupClaimTempWorktree`** runs `git worktree remove --force "<tmpdir>"` (cwd = base repo).

Because of these, the file sits on the guard `ALLOWLIST` (`bootstrap` category), failing the PRD's "no raw git/gh outside GitContext" invariant.

**Why the existing GitContext methods cannot be reused as-is (the crux of the HITL review).** Three of these verbs have semantics that the standard GitContext methods deliberately do *not* provide — and silently substituting the standard methods would *break the lock*:

| Claim verb | Standard GitContext method | Why it must NOT be reused |
|---|---|---|
| `git worktree add --detach … origin/<def>` | `createWorktree` / `createWorktreeForNewBranch` / `ensureWorktree` | Standard methods create a **named local branch** under `basePath/.worktrees/`. The claim requires a **detached HEAD** at an arbitrary **system-temp** path with **no local branch** — the docstring explains a leftover named branch makes the next attempt crash with "branch already exists", a hard throw that **bypasses the loser path** entirely (regression §5 / "Bug B"). |
| `git commit --allow-empty` | `commitChanges` | `commitChanges` runs `git status --porcelain` and **returns `false` on a clean tree (no commit)**. The claim requires an **empty** commit that carries the unique nonce. |
| `git push origin HEAD:refs/heads/<b>` (no force) | `pushBranch` | `pushBranch` uses `--force-with-lease --force-if-includes`. A force push would let the **second** claimant **overwrite** the winner's branch — destroying the exactly-one-winner guarantee. The lock's entire correctness rests on the second push being **rejected** (non-fast-forward). This push must **never** force. |

Only the **fetch** verb maps cleanly onto an existing method: `GitContext.fetchRemote(branch, cwd)` (added in #696, the blocking dependency). The default-branch lookup also already exists as `GitContext.defaultBranch()`.

## Solution Statement
Follow the exact pattern established by #696 (`remoteOps.ts` → thin `GitContext` methods): introduce a small **package-private op module** `adws/gitContext/claimOps.ts` that captures the claim's four lock-specific git verbs as pure `Runner`-injected functions, wire each as a thin `GitContext` method that routes through the private `#run()` chokepoint, then rewire `upgradeClaim.ts` to call those methods (plus the already-migrated `fetchRemote`/`defaultBranch`) instead of `execSync`. Finally, delete the `upgradeClaim.ts` entry from the `ALLOWLIST`.

The op functions are named by their **git semantics** (not "claim*") so the command strings read honestly and are independently unit-testable — critical for a HITL primitive where the exact command string (especially "the push carries no `--force`") *is* the correctness contract.

`cwd` semantics are preserved exactly: fetch + detached-worktree-add + worktree-remove run with `cwd = baseRepoPath` (the target worktree, whose `origin` is the target remote); empty-commit + namespace-push run with `cwd = tmpdir`. The GitContext is constructed from the target worktree's own origin (`gitContextForRepo(readLocalRepoInfo(baseRepoPath))`), guaranteeing the claim is scoped to the **target** repo's branch namespace — the same invariant the existing `buildDefaultUpgradeGateDeps` comment calls out, now enforced through the auth chokepoint.

The integration test (`upgradeClaim.integration.test.ts`) — the AC's "integration test green" — is updated to inject a real-`exec` `GitContext` against the sandbox bare repo (no `gh`, no network, no real token), proving every winner/loser/cleanup/regression property is preserved through GitContext.

## Relevant Files
Use these files to implement the feature:

- `adws/core/upgradeClaim.ts` — **(modify)** The distributed-lock primitive. Replace the five raw `execSync` git calls in `defaultPushClaimBranch` and `cleanupClaimTempWorktree` with `GitContext` method calls; thread a `GitContext` through `defaultPushClaimBranch` and `buildDefaultUpgradeClaimDeps`; drop the `child_process`/`vcs/branchOperations` imports. Preserve every pure helper (`buildClaimBranchName`, `buildClaimResult`, `isPushRejectionError`, `extractGitErrorText`) and the `claimUpgradeOrFindExisting` orchestration logic unchanged.
- `adws/gitContext/gitContext.ts` — **(modify)** Add four thin methods (`addDetachedWorktree`, `commitAllowEmpty`, `pushHeadToBranch`, `removeDetachedWorktree`) that delegate to the new `claimOps` module via `#run`, mirroring the existing `// ── Remote fetch / merge / ls-remote ops ──` block added in #696.
- `adws/checkGitGhGuard.ts` — **(modify)** Remove the `'adws/core/upgradeClaim.ts'` line from `ALLOWLIST` (it is in the `bootstrap` group with comment `// distributed lock: git fetch/worktree/commit/push`).
- `adws/phases/upgradeGate.ts` — **(reference / no change expected)** The sole production call site: `buildDefaultUpgradeClaimDeps(worktreePath)` inside `buildDefaultUpgradeGateDeps`. The signature stays `buildDefaultUpgradeClaimDeps(baseRepoPath)` so this call site is untouched; read to confirm the target-worktree scoping comment still holds.
- `adws/github/gitContextFactory.ts` — **(reference)** Provides `gitContextForRepo(repoInfo)` and `readLocalRepoInfo(cwd)`; `upgradeClaim.ts` will import both to build the default context from the worktree's origin (exactly how `vcs/branchOperations.getDefaultBranch` already does it).
- `adws/gitContext/remoteOps.ts` — **(reference / pattern template)** The #696 op module to mirror for shape, JSDoc style, and the `export const remoteOps = { … }` aggregation idiom.
- `adws/gitContext/commitOps.ts` — **(reference)** Shows the commit-message quote-escaping (`message.replace(/"/g, '\\"')`) and `pushBranch`'s force-with-lease semantics to deliberately diverge from.
- `adws/gitContext/worktreeRemoveOps.ts` / `worktreeCreateOps.ts` — **(reference)** Show the existing branch-named worktree add/remove semantics to deliberately diverge from (the claim needs path-based, detached, no-branch variants).
- `adws/gitContext/__tests__/remoteOps.test.ts` — **(reference / test template)** Runner-spy unit-test style to mirror for the new `claimOps` tests (assert exact command string + cwd + error propagation).
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — **(modify)** Add env-injection tests (token / git identity / cwd via spy `exec`) for the four new GitContext methods, mirroring the #696 `fetchRemote`/`lsRemote` additions.
- `adws/core/__tests__/upgradeClaim.test.ts` — **(modify)** Dep-injected unit tests of `claimUpgradeOrFindExisting` stay green unchanged; update the `buildDefaultUpgradeClaimDeps` smoke test for the new construction; the `defaultPushClaimBranch` signature change is internal.
- `adws/core/__tests__/upgradeClaim.integration.test.ts` — **(modify — AC-critical)** Inject a real-`exec` `GitContext` (local sandbox, no `gh`/network) and pin the default branch via the seam; assert the full winner/loser/cleanup/Bug-B matrix still holds through GitContext.
- `adws/core/index.ts` — **(reference)** Re-exports `defaultPushClaimBranch`, `claimUpgradeOrFindExisting`, `buildDefaultUpgradeClaimDeps`; the changed `defaultPushClaimBranch` signature flows through here (the integration test imports it).
- `specs/prd/git-context-repo-authority.md` — **(reference)** Parent PRD; user stories 5 (per-command auth) and 17 (no raw git/gh outside GitContext).

### New Files
- `adws/gitContext/claimOps.ts` — Package-private op module for the four lock-specific git verbs (`addDetachedWorktree`, `commitAllowEmpty`, `pushHeadToBranch`, `removeDetachedWorktree`), aggregated as `export const claimOps = { … }`. Structurally exempt from the guard (lives under `adws/gitContext/`). Mirrors `remoteOps.ts`.
- `adws/gitContext/__tests__/claimOps.test.ts` — Runner-spy unit tests for `claimOps` (exact command strings, cwd routing, error propagation; explicit assertion that `pushHeadToBranch` contains **no** `--force`).
- `features/per-issue/feature-698.feature` — BDD scenarios tagged `@adw-698 @adw-t0asur-gitcontext-migrate-u`, mirroring `feature-696.feature` (claim-op methods route through `#run`; `upgradeClaim.ts` is guard-clean and de-allowlisted; whole-repo guard passes; type-check passes).
- `features/per-issue/step_definitions/feature-698.steps.ts` — Step definitions adding only the claim-op dispatchers; reuse the shared world (`gitContextSharedWorld.ts`) and the guard/type-check steps from `feature-691.steps.ts`/`feature-504.steps.ts` (do not redefine shared steps).

## Implementation Plan
### Phase 1: Foundation — the package-private op module
Add `adws/gitContext/claimOps.ts` capturing the four lock-specific git verbs as pure `Runner`-injected functions. Each takes `(run, …args, cwd)` and emits exactly one git command string. This is the foundation because both the GitContext methods and the rewired `upgradeClaim` depend on it, and its unit tests pin the correctness-critical command strings before any wiring.

### Phase 2: Core Implementation — GitContext methods + upgradeClaim rewire
Wire four thin methods on `GitContext` that route the op functions through `#run` with explicit `cwd`. Then rewire `upgradeClaim.ts`'s `defaultPushClaimBranch` and `cleanupClaimTempWorktree` to call `GitContext` methods (new ones plus the existing `fetchRemote`/`defaultBranch`), threading a `GitContext` in via `buildDefaultUpgradeClaimDeps`. Remove the dead `child_process`/`vcs` imports.

### Phase 3: Integration — de-allowlist, tests, and proof
Delete the `ALLOWLIST` entry so the guard now scans `upgradeClaim.ts` and finds it clean. Update unit tests, rewrite the integration test to drive the real claim through an injected local `GitContext`, and add the BDD per-issue feature. Run the full validation suite to prove zero regressions and that `lint:git-guard` passes.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1: Read context and confirm the #696 template
- Read `adws/gitContext/remoteOps.ts`, `adws/gitContext/gitContext.ts` (the `// ── Remote fetch / merge / ls-remote ops ──` block, lines ~411–427), and `adws/gitContext/__tests__/remoteOps.test.ts` to lock in the op-module + thin-method + runner-spy pattern.
- Read `adws/core/upgradeClaim.ts` end-to-end; note `defaultPushClaimBranch`, `cleanupClaimTempWorktree`, `buildDefaultUpgradeClaimDeps`, and the four exported pure helpers that MUST remain unchanged.
- Confirm `gitContextForRepo` / `readLocalRepoInfo` signatures in `adws/github/gitContextFactory.ts`.

### Task 2: Create the `claimOps.ts` op module
- Create `adws/gitContext/claimOps.ts` with `type Runner = (command: string, cwd: string) => string;` and four functions:
  - `addDetachedWorktree(run, worktreePath, ref, cwd): void` → `run(\`git worktree add --detach "${worktreePath}" "${ref}"\`, cwd)`.
  - `commitAllowEmpty(run, message, cwd): void` → `run(\`git commit --allow-empty -m "${message.replace(/"/g, '\\\\"')}"\`, cwd)` (mirror `commitOps` escaping).
  - `pushHeadToBranch(run, branch, cwd): void` → `run(\`git push origin "HEAD:refs/heads/${branch}"\`, cwd)`. **Add a JSDoc line explicitly stating this push carries NO force flag — a force push would let a second claimant overwrite the winner and break the lock; the non-fast-forward rejection IS the lock.**
  - `removeDetachedWorktree(run, worktreePath, cwd): void` → wrap `run(\`git worktree remove --force "${worktreePath}"\`, cwd)` in `try { … } catch { /* best-effort cleanup */ }` (mirrors `remoteOps.abortMerge` — a missing worktree is benign).
- Export `export const claimOps = { addDetachedWorktree, commitAllowEmpty, pushHeadToBranch, removeDetachedWorktree };`.
- Add a module-header JSDoc describing it as the package-private op module for the upgrade-claim distributed-lock verbs, noting which standard ops they deliberately diverge from (detached vs named-branch worktree; allow-empty commit; non-force namespace push).

### Task 3: Write `claimOps.test.ts` (RED → GREEN)
- Create `adws/gitContext/__tests__/claimOps.test.ts` mirroring `remoteOps.test.ts` (`makeRunner` capturing `{command, cwd}`).
- Assert for each op: exact command string, correct `cwd` passthrough, and error propagation (`addDetachedWorktree`/`commitAllowEmpty`/`pushHeadToBranch` propagate runner throws; `removeDetachedWorktree` swallows them).
- Add a dedicated assertion: `pushHeadToBranch`'s command string does **not** contain `--force` and does **not** contain `--force-with-lease` (lock-correctness guard).
- Add: `commitAllowEmpty` includes `--allow-empty` and escapes embedded double-quotes in the message.

### Task 4: Add the four thin methods to `GitContext`
- In `adws/gitContext/gitContext.ts`, import `{ claimOps } from './claimOps';` alongside the existing `remoteOps` import.
- Add a new `// ── Upgrade-claim distributed-lock ops ──` block (next to the remote-ops block) with:
  - `addDetachedWorktree(worktreePath: string, ref: string, cwd: string): void`
  - `commitAllowEmpty(message: string, cwd: string): void`
  - `pushHeadToBranch(branch: string, cwd: string): void`
  - `removeDetachedWorktree(worktreePath: string, cwd: string): void`
- Each delegates exactly like the remote-ops methods: `claimOps.<fn>((cmd, c) => this.#run(cmd, { cwd: c }), …args, cwd);`. All `cwd` args are required (no base-path default) because the claim always supplies an explicit cwd (base repo or tmpdir).

### Task 5: Extend `gitContextOperations.test.ts` with env-injection tests
- For each of the four new methods, add tests mirroring the #696 `fetchRemote`/`lsRemote` cases: child env carries the context `GH_TOKEN`, carries all four `GIT_*` identity vars, runs with the supplied `cwd`, and emits the expected command string. Use the existing `makeSpyExec`/`validOptions` helpers.

### Task 6: Rewire `upgradeClaim.ts` onto GitContext
- Remove `import { execSync } from 'child_process';` and `import { getDefaultBranch } from '../vcs/branchOperations';`.
- Add `import { gitContextForRepo, readLocalRepoInfo } from '../github/gitContextFactory';` and `import type { GitContext } from '../gitContext';`.
- Change `defaultPushClaimBranch` signature to `(branchName, hash, baseRepoPath, ctx: GitContext, getDefaultBranchFn: () => string = () => ctx.defaultBranch())`:
  - `const defaultBranch = getDefaultBranchFn();` (the seam keeps the integration test off `gh`).
  - `ctx.fetchRemote(defaultBranch, baseRepoPath);` (reuse #696 method).
  - Keep `const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-claim-'));`.
  - `ctx.addDetachedWorktree(tmpdir, \`origin/${defaultBranch}\`, baseRepoPath);`
  - Keep the nonce; `ctx.commitAllowEmpty(\`ADW upgrade in progress: ${hash} [${nonce}]\`, tmpdir);`
  - `try { ctx.pushHeadToBranch(branchName, tmpdir); return true; } catch (pushErr) { if (isPushRejectionError(pushErr)) return false; throw pushErr; }` — **preserve the loser-detection try/catch exactly**.
  - Keep the `finally { cleanupClaimTempWorktree(ctx, baseRepoPath, tmpdir); }`.
- Change `cleanupClaimTempWorktree(ctx: GitContext, baseRepoPath, tmpdir)` to call `ctx.removeDetachedWorktree(tmpdir, baseRepoPath);` then the existing best-effort `fs.rmSync(tmpdir, { recursive: true, force: true })`.
- Update `buildDefaultUpgradeClaimDeps(baseRepoPath = process.cwd(), ctx?: GitContext)`:
  - `const effectiveCtx = ctx ?? gitContextForRepo(readLocalRepoInfo(baseRepoPath));`
  - `pushClaimBranch: (branchName, hash) => defaultPushClaimBranch(branchName, hash, baseRepoPath, effectiveCtx),`
  - Leave `findPRByBranch` / `resolveIssueNumberFromPR` / `log` unchanged (out of scope: gh-read migration is a separate slice).
- Update the module-header JSDoc's step list to note ops now route through GitContext; keep the nonce-correctness paragraph verbatim (still true).
- Confirm `claimUpgradeOrFindExisting`, `buildClaimBranchName`, `buildClaimResult`, `isPushRejectionError`, `extractGitErrorText` are **unchanged**.

### Task 7: Update `upgradeClaim.test.ts`
- The `claimUpgradeOrFindExisting` winner/loser/race/error tests inject `pushClaimBranch` as a `vi.fn()` and never touch git — confirm they pass unchanged.
- Update the `buildDefaultUpgradeClaimDeps` smoke test: it must still return an object with the four dep keys. If constructing the real default now requires a resolvable repo (via `readLocalRepoInfo`), pass an injected spy `ctx` (`buildDefaultUpgradeClaimDeps('/tmp', spyCtx)`) so the smoke test stays hermetic.

### Task 8: Rewrite `upgradeClaim.integration.test.ts` to drive a real local GitContext (AC-critical)
- Replace the `makeRealPushClaimBranch(clonePath, defaultBranch)` helper so it constructs a real `GitContext` and passes it as the new `ctx` arg:
  - `const ctx = new GitContext({ owner: 'sandbox', repo: 'target', selfHost: false, token: 'x', gitIdentity: { authorName:'test', authorEmail:'test@test.com', committerName:'test', committerEmail:'test@test.com' }, frameworkRepoRoot: sandboxDir, targetReposDir: sandboxDir });` (default real `exec`; no `deps` override needed).
  - `return (branchName, hash) => defaultPushClaimBranch(branchName, hash, clonePath, ctx, () => defaultBranch);`
- The injected `() => defaultBranch` seam keeps `gh repo view` out of the test (no network/credentials); the git identity now flows from `GitContext.commandEnv` env injection, so the test's manual `GIT_AUTHOR_*` env block for the claim path is superseded (keep it only for the `git()` sandbox-setup helper).
- Keep ALL existing assertions and `describe` blocks unchanged: §1 first-claim wins + exactly-one-empty-commit-ahead; §2 second-claim loses; §3 race → exactly one winner / one loser / one accepted push; §4 temp-worktree cleanup leaves no dangling worktrees; §5 stale-local-branch regression (Bug B) still wins. These are the lock-semantics proof — they must remain green verbatim, now exercising the GitContext path.

### Task 9: Remove `upgradeClaim.ts` from the guard ALLOWLIST
- In `adws/checkGitGhGuard.ts`, delete the line `'adws/core/upgradeClaim.ts',            // distributed lock: git fetch/worktree/commit/push` from the `bootstrap` group of `ALLOWLIST`.
- Run `bun run lint:git-guard` — it must PASS (the file is now git-free; `claimOps.ts` is structurally exempt under `adws/gitContext/`).

### Task 10: Add the BDD per-issue feature and step definitions
- Create `features/per-issue/feature-698.feature` tagged `@adw-698 @adw-t0asur-gitcontext-migrate-u`, mirroring `feature-696.feature`:
  - §1 each new claim-op method (`add-detached-worktree`, `commit-allow-empty`, `push-head-to-branch`, `remove-detached-worktree`) routes through `#run`, carrying token + git identity + supplied `cwd` (reuse the shared-world recording-runner assertion steps from `feature-659.steps.ts`/`feature-693.steps.ts`).
  - A scenario asserting the namespace push carries no force flag (lock semantics).
  - §2 `adws/core/upgradeClaim.ts` is scanned by the guard and violation-free; §3 the whole-repo guard passes; §4 the type-check passes (reuse `feature-691.steps.ts`/`feature-504.steps.ts` steps).
- Create `features/per-issue/step_definitions/feature-698.steps.ts` adding ONLY the claim-op dispatchers (`When('the {string} claim-op operation runs through the context …')`), importing the shared world `./gitContextSharedWorld.ts`. Do not redefine shared/guard/type-check steps.
- Validate phrasing against `features/regression/vocabulary.md` (Vocabulary Registry is set in `.adw/scenarios.md`); prefer existing registered phrases.

### Task 11: Run the full validation suite
- Run every command in `## Validation Commands` and ensure all pass with zero regressions. Pay special attention to `bun run lint:git-guard` (AC) and the `upgradeClaim.integration.test.ts` suite (AC: lock semantics unchanged).

## Testing Strategy
### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are required (framework: `vitest`, run via `bun run test:unit`).

- **`adws/gitContext/__tests__/claimOps.test.ts` (new):** Runner-spy tests for all four ops — exact command string, `cwd` passthrough, error propagation (throw vs swallow). Explicit lock-correctness assertions: `pushHeadToBranch` emits no `--force`/`--force-with-lease`; `commitAllowEmpty` emits `--allow-empty` and escapes quotes.
- **`adws/gitContext/__tests__/gitContextOperations.test.ts` (extend):** Env-injection tests for the four new GitContext methods — child env carries the context token + all four `GIT_*` identity vars; command runs with the supplied `cwd`; emits the expected command string. Mirrors the #696 `fetchRemote`/`lsRemote` cases.
- **`adws/core/__tests__/upgradeClaim.test.ts` (verify/update):** The dep-injected `claimUpgradeOrFindExisting` winner/loser/race/error tests stay green unchanged (they never touch git). Update the `buildDefaultUpgradeClaimDeps` smoke test to inject a spy `ctx` so it remains hermetic.
- **`adws/core/__tests__/upgradeClaim.integration.test.ts` (rewrite, AC-critical):** Drives the REAL `defaultPushClaimBranch` through an injected real-`exec` `GitContext` against a sandbox bare repo — proving the full winner/loser/cleanup/Bug-B matrix is preserved through GitContext, with no `gh`/network/real-token dependency.

### Edge Cases
- **Stale local branch of the same name exists in the clone (Bug B):** detached-HEAD + `push HEAD:refs/heads/<b>` never touches the local-branch namespace → claim still wins. (Integration §5.)
- **Concurrent claims (race):** exactly one push accepted (non-fast-forward rejects the other) → exactly one winner / one loser. (Integration §3.)
- **Push rejection vs genuine git failure:** `isPushRejectionError` distinguishes non-fast-forward/"already exists" (→ loser, `return false`) from a real error (→ re-throw). Must remain intact after rewire.
- **Empty commit on a clean tree:** `commitAllowEmpty` must still produce exactly one commit ahead of the default branch (not be short-circuited like `commitChanges`). (Integration §1.)
- **Temp worktree cleanup after both win and lose:** `removeDetachedWorktree` (best-effort) + `fs.rmSync` leave zero dangling worktrees in the clone. (Integration §4.)
- **Missing/absent temp worktree on cleanup:** `removeDetachedWorktree` swallows the error (benign no-op), cleanup proceeds.
- **Default-branch lookup without `gh`/credentials (tests):** the `getDefaultBranchFn` seam pins `'main'`; production defaults to `ctx.defaultBranch()`.
- **Target-repo scoping:** the default `ctx` is built from the worktree's own origin (`readLocalRepoInfo(baseRepoPath)`) so the claim pushes to the TARGET remote, not the framework's.

## Acceptance Criteria
- [ ] `adws/core/upgradeClaim.ts` contains **zero** raw `git`/`gh` shell-outs (no `execSync`/`child_process` import in its git path); every git verb routes through `GitContext`.
- [ ] All four new git verbs are GitContext methods backed by `adws/gitContext/claimOps.ts`, each routing through the `#run` per-command-auth chokepoint with explicit `cwd`.
- [ ] The namespace push uses **no** force flag (verified by a dedicated unit assertion) — winner/loser semantics unchanged.
- [ ] Lock winner/loser semantics unchanged: `upgradeClaim.integration.test.ts` is green, with all §1–§5 assertions preserved (exactly one winner, loser detection, one empty commit ahead, clean worktrees, Bug-B regression).
- [ ] `adws/core/upgradeClaim.ts` is removed from the `ALLOWLIST` in `adws/checkGitGhGuard.ts`.
- [ ] `bun run lint:git-guard` passes (exit 0, no violations).
- [ ] `bun run lint`, `bun run test` (tsc `--noEmit`), `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all pass with zero regressions.
- [ ] BDD `@adw-698` scenarios pass.
- [ ] The production call site `buildDefaultUpgradeClaimDeps(worktreePath)` in `adws/phases/upgradeGate.ts` remains unchanged (no signature churn leaks to callers).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint:git-guard` — **AC** — the git/gh guard must PASS now that `upgradeClaim.ts` is de-allowlisted and git-free (`claimOps.ts` is structurally exempt under `adws/gitContext/`).
- `bun run test:unit` — run the full vitest suite (`vitest run`); zero regressions. Must include the new `claimOps.test.ts`, the extended `gitContextOperations.test.ts`, and the rewritten `upgradeClaim.integration.test.ts`.
- `bunx vitest run adws/core/__tests__/upgradeClaim.integration.test.ts adws/core/__tests__/upgradeClaim.test.ts adws/gitContext/__tests__/claimOps.test.ts adws/gitContext/__tests__/gitContextOperations.test.ts` — focused run proving the lock-semantics + op-method contract directly.
- `bun run lint` — ESLint (`eslint .`) clean.
- `bun run test` — `bunx tsc --noEmit` (root type-check) passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional ADW type-check (the `defaultPushClaimBranch`/`buildDefaultUpgradeClaimDeps` signature changes and new GitContext methods must type-check).
- `bun run build` — `tsc` build succeeds with no errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-698"` — the new per-issue BDD scenarios pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression scenario safety net stays green.

## Notes
- `.adw/coding_guidelines.md` does not exist in this repo; `guidelines/coding_guidelines.md` was not found either. Follow the established in-repo conventions instead: the deep-module + injected-`Runner`/`FsDeps` seam pattern, package-private op modules aggregated as `export const xOps = { … }`, thin GitContext methods routing through `#run`, and pure-helper/I/O separation. No decorators. No new libraries required (install command would be `bun add <package>` per `.adw/commands.md`, but none is needed).
- **HITL emphasis for the reviewer:** the single most important invariant is that the claim's push is **never** forced. `pushHeadToBranch` must emit exactly `git push origin "HEAD:refs/heads/<branch>"` — no `--force`, no `--force-with-lease`, no `--force-if-includes`. A force push silently converts the lock into a last-writer-wins race and lets two orchestrators both believe they won. A unit assertion pins this; reviewers should still eyeball the command string.
- **Why a new op module rather than inlining four `#run` calls:** simple single-command reads (`defaultBranch`, `remoteUrl`, `authenticatedUser`) are inlined in `gitContext.ts`, but every git **verb group** that mutates state (branchOps, commitOps, remoteOps) uses a package-private op module with focused unit tests. The claim verbs are correctness-critical and benefit from `claimOps.test.ts` pinning their exact strings — consistent with `remoteOps` (#696), the direct precedent and blocking dependency.
- **Blocked-by #696 is satisfied:** `GitContext.fetchRemote` (and the `remoteOps.ts` template) landed in #696 (merged to `dev` at `8a7c2b9` / PR #710). This slice builds directly on that.
- **Scope boundary:** only the **git** ops of upgradeClaim migrate here. The `gh`-read deps (`defaultFindPRByBranch`, `fetchPRDetails`) inside `buildDefaultUpgradeClaimDeps` are out of scope (a separate gh-read migration slice); leave them untouched to keep this HITL change minimal and reviewable.
- **Worktree-born dependency-reversion watch:** this repo has a recurring pattern where a fresh worktree is born with `document.md`/`adw_init.md` (and occasionally `README.md`) reverted. Before implementing, verify no out-of-scope command-file or README reversion is present in the working tree (`git diff origin/dev -- .claude/ README.md`); a `-` README line is only a real revert if the worktree no longer documents that file at all. Do not `git add -A` blindly.
