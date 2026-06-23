# Feature: Migrate branch + commit/push operations onto GitContext

## Metadata
issueNumber: `662`
adwId: `h7t8lq-migrate-branch-commi`
issueJson: `{"number":662,"title":"Migrate branch + commit/push operations onto GitContext","body":"## Parent PRD\n\n`specs/prd/git-context-repo-authority.md` (see **Operation surface**)\n\n## What to build\n\nRoute all branch and commit/push operations through `GitContext` so git identity and `cwd` are always correct: branch create/checkout/delete/default-branch (`vcs/branchOperations.ts`), commit and push (`vcs/commitOperations.ts`), and fetch/reset-to-remote (`vcs/worktreeReset.ts`). Each runs with the context's explicit `cwd` and the git author/committer identity injected per command.\n\n## Acceptance criteria\n\n- [ ] branch create/checkout/delete/default-branch are `GitContext` methods running with the context cwd (story 17)\n- [ ] commit and push run through the context with correct git author/committer and cwd\n- [ ] fetch / reset-to-remote run through the context\n- [ ] All branch/commit/push call sites route through the context (no direct `execSync` of these git verbs outside the package)\n- [ ] Existing `vcs/__tests__/branchOperations.test.ts` / `commitOperations.test.ts` behaviour preserved against context methods\n\n## Blocked by\n\n- Blocked by #658\n- Blocked by #659\n\n## User stories addressed\n\n- User story 17","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-21T10:20:54Z","comments":[],"actionableComment":null}`

## Feature Description

This feature moves ADW's branch, commit/push, and fetch/reset-to-remote git operations onto the `GitContext` deep module so that **which repo's filesystem (`cwd`)** and **which git identity (author/committer + auth token)** are always resolved authoritatively and per-command, never derived ad hoc at the call site.

`GitContext` (`adws/gitContext/`) was shipped by the two blocking slices:
- **#658** established the package: mandatory identity (`owner`, `repo`, `selfHost`, `token`, `gitIdentity`, injected `frameworkRepoRoot`/`targetReposDir`), single `resolveBasePath` authority in the constructor (self-host → framework root; target → `join(targetReposDir, owner, repo)`), `worktreePathFor`, and an injectable `ExecFn` exec seam.
- **#659** added per-command env injection: `commandEnv()` overlays `GH_TOKEN` + `GIT_AUTHOR_*`/`GIT_COMMITTER_*` onto each spawned command's environment via the single `#run` chokepoint, **never mutating `process.env`**. The representative `defaultBranch()` op was shipped as the proof.

Today, on `dev`, `GitContext` is wired into **no production call sites** — `defaultBranch()` is an unwired "representative op" and the class is only instantiated in tests. The branch/commit/push git verbs still run through the standalone `adws/vcs/` wrappers (`branchOperations.ts`, `commitOperations.ts`, `worktreeReset.ts`), each taking an optional `cwd` parameter that callers must remember to supply correctly. This is exactly the ambiguity the PRD ("GitContext — a single repo-context authority for all git and `gh` I/O") was created to eliminate.

This slice implements PRD **User Story 17** ("all branch and commit/push operations go through the context, so that git identity and `cwd` are always correct") and the PRD **Operation surface** line: *"branch create/checkout/delete/default-branch; commit and push; fetch/reset-to-remote."* It adds these as methods on `GitContext`, provides the boundary factory that constructs a context from ambient ADW identity, migrates every call site to route through the context, and preserves the existing VCS unit-test behaviour against the new methods.

The value: workflows can no longer commit/push/branch under the wrong repo's working directory, commits always carry the correct bot author/committer identity, and concurrent multi-repo work cannot bleed auth between repos — closing another member of the ~13-episode wrong-repo / `GH_TOKEN`-bleed bug class structurally rather than by point-fix.

## User Story

As an **ADW maintainer**
I want **all branch and commit/push operations to go through the `GitContext`**
So that **git identity and `cwd` are always correct, and no new call site can re-introduce the wrong-repo / token-bleed class of bug by shelling out to `git`/`gh` directly.**

## Problem Statement

Branch, commit/push, and fetch/reset git verbs are executed by free functions in `adws/vcs/` that each accept an **optional `cwd`** and rely on the **ambient git config / process-global auth** for identity. Concretely:

1. **`cwd` is a caller responsibility, defaulting to the process working directory.** `getDefaultBranch(cwd?)`, `commitChanges(message, cwd?)`, `pushBranch(branch, cwd?)`, `fetchAndResetToRemote(branch, cwd)`, `resetWorktreeToRemote(worktreePath, branch)` etc. all run wherever `cwd` points (or the framework repo if omitted). A caller that forgets the target workspace operates on the wrong repo — the dogfooding default masks the bug until it ships against a target repo.
2. **Git author/committer identity is ambient.** `commitChanges` runs `git commit -m …` with whatever `git config user.*` happens to be set, rather than the authoritative bot identity for the repo being operated on.
3. **Auth is process-global.** Pushes/fetches inherit whatever `GH_TOKEN` the process last set, which interleaved multi-repo work (the webhook server) can overwrite mid-flight.
4. **There is no enforcement.** Nothing prevents a new call site from `execSync('git push …')` directly; the acceptance criterion "no direct `execSync` of these git verbs outside the package" is currently violated by several inline shell-outs.

`GitContext` already solves (1)–(3) for worktree-path/env resolution but **no branch/commit/push operation is a method on it yet**, and **no call site uses it**.

## Solution Statement

Extend `GitContext` with the branch / commit-push / fetch-reset operation surface as **methods**, each running through the existing single `#run` spawn chokepoint with an **explicit `cwd`** (the relevant worktree path or the context base path) and the **per-command env** (`GH_TOKEN` + git author/committer) already provided by `commandEnv()`. Then route every call site through a `GitContext` obtained from a boundary factory, and remove the now-redundant direct-`execSync` VCS wrappers.

Design, mirroring the patterns already established in the package (#658/#659) and the sibling worktree slice (#661):

1. **Generalize the spawn chokepoint** so `#run` accepts an explicit `cwd` (defaulting to `basePath`). All new ops pass the worktree path. Env injection and `process.env` non-mutation are unchanged.
2. **Add package-private ops modules** (`branchOps.ts`, `commitOps.ts`, `worktreeResetOps.ts`) holding the command strings and per-operation orchestration (status-check-then-commit, fetch-then-force-with-lease-push + lease-rejection detection, abort-merge/rebase-then-fetch-reset-clean). They take an injected runner so the **`GitContext` class methods stay thin** and the file stays under the 300-line guideline. This matches #661's `worktreeOps.ts` structure.
3. **Add the `GitContext` methods**: `getCurrentBranch`, `checkoutBranch`, `checkoutDefaultBranch`, `getDefaultBranch` (the already-shipped `defaultBranch()` covers this), `mergeLatestFromDefaultBranch`, `fetchAndResetToRemote`, `deleteLocalBranch`, `deleteRemoteBranch`, `commitChanges`, `pushBranch`, `getHeadTreeHash`, `hasUncommittedChanges`, `resetWorktree` (the takeover reset from `worktreeReset.ts`).
4. **Add the boundary factory** `gitContextFor({ owner, repo, selfHost })` in `adws/github/gitContextFactory.ts` (it needs GitHub-App auth, which must not pollute the ADW-global-free package). It resolves the token (App installation token → `GH_TOKEN` → `gh auth token`) and git identity (env → app-slug bot → `git config` → defaults) and injects `REPO_ROOT`/`TARGET_REPOS_DIR`.
5. **Migrate call sites**: construct one context per phase/orchestrator scope (from the workflow's `RepoContext`/`TargetRepoInfo`; `selfHost = no target repo`) and call the methods. The factory is async (token resolution); methods are sync, so a single awaited construction serves hot loops (e.g. the build progress gate).
6. **Remove the migrated I/O wrappers** from `adws/vcs/` and update `vcs/index.ts`. Keep the **pure** branch-identity functions (`generateBranchName`, `validateSlug`, `inferIssueTypeFromBranch`, `PROTECTED_BRANCHES`) where they are — they are vocabulary, not git I/O.
7. **Preserve test behaviour against context methods**: re-home the command/`cwd` assertions from the VCS test files onto the `GitContext` ops via the injected `ExecFn` spy (now additionally asserting per-command env injection — the PRD's key observable property), and keep the pure-function tests unchanged.

## Relevant Files

Use these files to implement the feature:

### Package — the operation surface (primary edits)
- `adws/gitContext/gitContext.ts` — add the branch/commit/push/fetch-reset/reset **methods**; generalize `#run` to take an explicit `cwd`. **Owned by** `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`.
- `adws/gitContext/types.ts` — extend `ExecFn`/option types only if a `cwd`/`stdio` discriminator is needed by the generalized chokepoint; otherwise unchanged.
- `adws/gitContext/index.ts` — public surface stays "class + types only" (no new free-function exports; ops modules are package-private).

### Source functions being migrated (to be reduced to pure fns / removed)
- `adws/vcs/branchOperations.ts` — `getCurrentBranch`, `checkoutBranch`, `getDefaultBranch`, `checkoutDefaultBranch`, `mergeLatestFromDefaultBranch`, `fetchAndResetToRemote`, `deleteLocalBranch`, `deleteRemoteBranch` migrate to methods; **keep** the pure `generateBranchName`, `validateSlug`, `inferIssueTypeFromBranch`, `PROTECTED_BRANCHES`.
- `adws/vcs/commitOperations.ts` — `commitChanges`, `pushBranch` (force-with-lease + lease-rejection), `getHeadTreeHash`, `hasUncommittedChanges` migrate to methods.
- `adws/vcs/worktreeReset.ts` — `resetWorktreeToRemote` (abort merge/rebase via `fs` + fetch/reset --hard/clean -fdx) migrates to a method.
- `adws/vcs/index.ts` — update exports as wrappers are removed. **Owned by** `app_docs/feature-sh8m9r-persist-branch-name-per-adwid.md` (coordinate touch).

### Boundary factory + identity sources
- `adws/github/gitContextFactory.ts` — **new** async `gitContextFor(...)` factory (token + git-identity resolution). *(May already exist if sibling #661 merges first — reuse it then.)*
- `adws/github/index.ts` — export `gitContextFor`.
- `adws/core/environment.ts` — `REPO_ROOT`, `TARGET_REPOS_DIR` injected into the context.
- `adws/github/githubAppAuth.ts` — `isGitHubAppConfigured`, `getInstallationToken` for token resolution.
- `adws/providers/repoContext.ts` — `RepoIdentifier`/`RepoContext` (`repoId.owner`/`repoId.repo`) is the identity source at call sites.

### Call sites to migrate (route through the context)
- `adws/phases/workflowInit.ts` — `mergeLatestFromDefaultBranch` (×3), `fetchAndResetToRemote`, `hasUncommittedChanges`, `getDefaultBranch`; richest identity scope (`targetRepo`, `repoId`).
- `adws/phases/prPhase.ts` — `pushBranch`, `getDefaultBranch`, `hasUncommittedChanges` (`repoContext?.repoId.owner`).
- `adws/phases/documentPhase.ts`, `adws/phases/reviewPhase.ts`, `adws/phases/scenarioFixPhase.ts`, `adws/phases/prReviewPhase.ts` — `pushBranch`.
- `adws/phases/buildPhase.ts` — `getHeadTreeHash` (×2), `hasUncommittedChanges` (progress-gate hot loop — construct context once, reuse).
- `adws/triggers/takeoverHandler.ts` — `resetWorktreeToRemote` (via `TakeoverDeps`). *(Sibling-slice overlap: see Notes.)*
- `adws/triggers/webhookHandlers.ts` — `deleteRemoteBranch` (via `IssueClosedDeps`).
- `adws/adwUpgrade.tsx` — `commitChanges`, `fetchAndResetToRemote`, `getDefaultBranch` (via `UpgradeDeps`).
- `adws/agents/prAgent.ts` — `getDefaultBranch`.
- `adws/adwPromotionSweep.tsx`, `adws/promotion/promotionMover.ts` — `getDefaultBranch`, `commitChanges` (verify identity scope; see Notes).

### Inline git/gh shell-outs of these verbs (secondary — route through context where identity is available)
- `adws/triggers/autoMergeHandler.ts` — inline `git fetch` / `git push` / `git reset --hard` (the merge-conflict-resolution `git merge`/`--abort` and `gh pr merge` are PR-merge domain, **out of scope**, see Notes).
- `adws/core/upgradeClaim.ts` — inline `git fetch` / `git commit --allow-empty` / `git push HEAD:refs/heads/...` (the `git worktree add` is worktree domain — leave to #661).
- `adws/core/targetRepoManager.ts` — inline `git fetch origin` + `gh repo view … defaultBranchRef`.

### Tests
- `adws/vcs/__tests__/branchOperations.test.ts` — keep pure-fn tests (`generateBranchName`, `validateSlug`) unchanged.
- `adws/vcs/__tests__/commitOperations.test.ts`, `adws/vcs/__tests__/fetchAndResetToRemote.test.ts`, `adws/vcs/__tests__/worktreeReset.test.ts`, `adws/vcs/__tests__/pushBranch.integration.test.ts` — re-home the behaviour onto the new methods (see Testing Strategy).
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — existing env-injection/isolation suite; add the new op tests here (or in sibling `gitContextBranchOps.test.ts` / `gitContextCommitOps.test.ts` if it would exceed the 300-line guideline).

### Conditional docs (matched conditions — read before implementing)
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — owns `adws/gitContext/**`; `GitContext`/`ExecFn`/`commandEnv`/`#run`/env-injection-non-mutation/two-context-isolation tests.
- `app_docs/feature-9gjajh-worktree-and-vcs.md` — owns `adws/vcs/**`; `pushBranch` force-with-lease, `getHeadTreeHash`/`hasUncommittedChanges`/`commitChanges`, command-sequence tests in `vcs/__tests__/`.
- `app_docs/feature-eantbn-orchestrator-resilie-worktree-reset-module.md` — `worktreeReset.ts`/`resetWorktreeToRemote`, takeover, mixed `execSync`+`fs` test mocking pattern.
- `app_docs/feature-7dp24s-deterministic-branch-name-assembly.md` — `generateBranchName`/`validateSlug` assembly contract (the pure fns that stay put).
- `app_docs/feature-qej3f4-novelty-progress-gate.md` — `getHeadTreeHash`/`hasUncommittedChanges` call sites in `buildPhase`/`progressGate`.
- `app_docs/feature-v7dih7-adwupgrade-worktree-reconcile.md` — `fetchAndResetToRemote` from the upgrade path.
- `app_docs/feature-zt8gjc-fix-divergent-branch-pull.md` — `branchOperations.ts` divergent `git pull` crash (why `checkoutBranch`/`checkoutDefaultBranch` are deprecated).
- `app_docs/feature-hk12ct-kpi-commits-land-on-default-branch.md` — `commitOperations.ts` command-sequence correctness for commit-to-default-branch.
- `app_docs/feature-sh8m9r-persist-branch-name-per-adwid.md` — owns `vcs/index.ts`; branch-identity/`branchIdentity.ts` adjacency.

### New Files
- `adws/gitContext/branchOps.ts` — package-private branch command builders + orchestration (injected-runner based).
- `adws/gitContext/commitOps.ts` — package-private commit/push helpers (`isLeaseRejection`, lease-error message, command builders).
- `adws/gitContext/worktreeResetOps.ts` — package-private takeover-reset orchestration (`fs` merge/rebase abort + fetch/reset/clean).
- `adws/github/gitContextFactory.ts` — boundary factory `gitContextFor(...)` (unless created first by #661).
- `adws/gitContext/__tests__/gitContextBranchOps.test.ts`, `adws/gitContext/__tests__/gitContextCommitOps.test.ts` — new op tests (split out if the existing operations test file would exceed 300 lines).
- `adws/github/__tests__/gitContextFactory.test.ts` — token/identity resolution priority + self-host vs target base-path tests.

## Implementation Plan

### Phase 1: Foundation
Generalize the single spawn chokepoint and stand up the package-private ops modules so every new operation runs with an explicit `cwd` and per-command env, with the heavy orchestration extracted out of the class to respect the 300-line guideline. Verify (a cross-check the PRD explicitly wants surfaced) that the context's `basePath` for a target identity equals the existing `ensureTargetRepoWorkspace(targetRepo)` layout — if it diverges, that is a defect to flag, not paper over.

### Phase 2: Core Implementation
Add the branch / commit-push / fetch-reset / takeover-reset methods to `GitContext`, delegating to the ops modules. Stand up the `gitContextFor` boundary factory. Write unit tests for the methods/ops (command + `cwd` + env-injection + non-mutation, force-with-lease lease handling, abort-merge/rebase reset sequence) and the factory (resolution priority, self-host vs target base path), preserving the assertions from the existing VCS test suites against the new methods.

### Phase 3: Integration
Migrate call sites group-by-group (phases → triggers → orchestrators/agents → inline duplicates), constructing one context per scope from ambient identity and reusing it across operations in that scope. Remove the migrated I/O wrappers from `adws/vcs/`, update `vcs/index.ts`, then run the full validation suite for zero regressions and confirm no direct `execSync` of the migrated git verbs remains outside the package.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Read context and confirm the seam
- Read `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`, `app_docs/feature-9gjajh-worktree-and-vcs.md`, and `app_docs/feature-eantbn-orchestrator-resilie-worktree-reset-module.md`.
- Re-read `adws/gitContext/gitContext.ts` (the `#run` chokepoint, `commandEnv`, `ExecFn` seam, `defaultBranch`) and `adws/gitContext/types.ts`.
- Confirm `defaultBranch()` already satisfies the "default-branch" acceptance item (`gh repo view <owner>/<repo> --json defaultBranchRef`) — no new default-branch method is needed; call sites map `getDefaultBranch(cwd)` → `ctx.defaultBranch()`.

### 2. Generalize the spawn chokepoint (foundation)
- Change `#run` to accept an explicit `cwd` argument defaulting to `this.#basePath`, keeping `env: this.commandEnv(process.env)` and `process.env` non-mutation intact.
- Add a thin private helper for "void" git verbs (commands whose stdout is irrelevant) that still routes through the same chokepoint (so env injection is uniform). Do not introduce a second spawn site.
- If a `stdio`/capture discriminator is genuinely required, extend the `ExecFn` options type in `types.ts` minimally; otherwise leave `ExecFn` unchanged.

### 3. Add package-private ops modules
- Create `adws/gitContext/branchOps.ts`: command builders/orchestration for `getCurrentBranch` (`git branch --show-current`), `checkoutBranch`/`checkoutDefaultBranch` (preserve the deprecation warning + the no-`git pull --rebase`-on-divergent caveat), `mergeLatestFromDefaultBranch` (fetch + `git merge origin/<b> --no-edit`, warn-don't-throw), `fetchAndResetToRemote` (fetch + `git reset --hard origin/<b>`, throw on failure), `deleteLocalBranch`/`deleteRemoteBranch` (reuse `PROTECTED_BRANCHES` guard, return boolean, never delete protected). Each takes an injected runner; pure helpers stay pure.
- Create `adws/gitContext/commitOps.ts`: `commitChanges` (porcelain check → `git add -A` → `git commit -m`, escaping quotes, return boolean), `pushBranch` (fetch-then `git push --force-with-lease --force-if-includes -u origin <b>`, tolerate first-push fetch failure, detect lease rejection via `stale info` / `remote ref updated since checkout` and throw the distinct actionable error), `getHeadTreeHash` (`git rev-parse "HEAD^{tree}"`), `hasUncommittedChanges` (`git status --porcelain`). Keep `isLeaseRejection` and the lease-error message builder pure.
- Create `adws/gitContext/worktreeResetOps.ts`: `resetWorktree` (resolve git-dir via `git rev-parse --git-dir`, abort in-progress merge/rebase with `fs` fallback removal, fetch + `git reset --hard origin/<b>` + `git clean -fdx`, throw on mandatory-step failure). Inject both the runner and the `fs` functions (`existsSync`/`rmSync`) so it stays unit-testable, following the `worktreeReset.test.ts` mocking pattern.
- Keep these modules out of `adws/gitContext/index.ts` (package-private). Inject the ADW logger through the existing seam rather than importing `adws/core` (preserve package purity).

### 4. Add the GitContext methods (delegating to ops)
- Add thin methods to `GitContext`: `getCurrentBranch(worktreePath?)`, `checkoutBranch(branch, worktreePath?)`, `checkoutDefaultBranch(worktreePath?)`, `mergeLatestFromDefaultBranch(defaultBranch, worktreePath)`, `fetchAndResetToRemote(defaultBranch, worktreePath)`, `deleteLocalBranch(branch, worktreePath?)`, `deleteRemoteBranch(branch, worktreePath?)`, `commitChanges(message, worktreePath)`, `pushBranch(branch, worktreePath)`, `getHeadTreeHash(worktreePath)`, `hasUncommittedChanges(worktreePath)`, `resetWorktree(worktreePath, branch)`.
- Each builds nothing itself; it computes the effective `cwd` (explicit worktree path, or `worktreePathFor(branch)` where appropriate) and delegates to its ops function with a bound runner. Confirm `commitChanges`/`pushBranch` carry the git author/committer identity via `commandEnv()` (the acceptance "correct git author/committer").
- Keep `gitContext.ts` under 300 lines (delegation makes the methods one-liners).

### 5. Unit tests for the methods/ops
- Add operation tests asserting, via the injected `ExecFn` spy: exact command strings, correct `cwd` (worktree path, not ambient), and **per-command env injection** (`GH_TOKEN` + `GIT_AUTHOR_*`/`GIT_COMMITTER_*`) with `process.env` left unmutated.
- Re-home the assertions from `commitOperations.test.ts` (getHeadTreeHash/hasUncommittedChanges/pushBranch incl. the 7 push scenarios), `fetchAndResetToRemote.test.ts` (order, throw-on-fetch, throw-on-reset), and `worktreeReset.test.ts` (clean/idempotent, dirty, merge/rebase abort + fs fallback, both markers, git-dir relative/absolute, mandatory-step throws) onto the new methods/ops.
- Place tests in `gitContextOperations.test.ts`, or split into `gitContextBranchOps.test.ts` / `gitContextCommitOps.test.ts` if needed to respect the 300-line guideline.

### 6. Boundary factory `gitContextFor`
- Create `adws/github/gitContextFactory.ts` exporting async `gitContextFor({ owner, repo, selfHost })` that resolves the token (App installation token → `GH_TOKEN` → `gh auth token`), resolves git identity (`GIT_*` env → `GITHUB_APP_SLUG` bot identity → `git config user.*` → `ADW Bot` defaults), injects `REPO_ROOT`/`TARGET_REPOS_DIR`, and returns `new GitContext(...)`. *(If #661 has already merged this file, reuse it and skip creation.)*
- Export `gitContextFor` from `adws/github/index.ts`.
- Add `adws/github/__tests__/gitContextFactory.test.ts`: token-resolution priority, identity-resolution priority, self-host → framework root, target → `join(TARGET_REPOS_DIR, owner, repo)`, and a hard error when no token is obtainable.

### 7. Migrate phase call sites
- In each phase, derive identity from the workflow's `RepoContext`/`TargetRepoInfo` (`selfHost = no target repo`), construct one `await gitContextFor(...)` per scope, and replace the VCS calls with method calls passing the worktree path:
  - `workflowInit.ts`: `mergeLatestFromDefaultBranch` (×3), `fetchAndResetToRemote`, `hasUncommittedChanges`, `getDefaultBranch` → `ctx.defaultBranch()`.
  - `prPhase.ts`: `pushBranch`, `getDefaultBranch`, `hasUncommittedChanges`.
  - `documentPhase.ts`, `reviewPhase.ts`, `scenarioFixPhase.ts`, `prReviewPhase.ts`: `pushBranch`.
  - `buildPhase.ts`: construct the context once **before** the progress-gate loop; reuse for `getHeadTreeHash` (×2) and `hasUncommittedChanges` (methods are sync, so no per-iteration async cost).

### 8. Migrate trigger + orchestrator + agent call sites
- `takeoverHandler.ts`: `resetWorktreeToRemote` → `ctx.resetWorktree(worktreePath, branch)` via `TakeoverDeps` (keep the injection contract). **Coordinate with #661 — see Notes.**
- `webhookHandlers.ts`: `deleteRemoteBranch` → `ctx.deleteRemoteBranch(...)` via `IssueClosedDeps`.
- `adwUpgrade.tsx`: `commitChanges`, `fetchAndResetToRemote`, `getDefaultBranch` → context methods via `UpgradeDeps`.
- `prAgent.ts`: `getDefaultBranch` → `ctx.defaultBranch()`.
- `adwPromotionSweep.tsx` / `promotionMover.ts`: `getDefaultBranch`, `commitChanges`. Confirm owner/repo is in scope; if a call site lacks `cwd`/identity today (e.g. `adwPromotionSweep` calls `getDefaultBranch()` with no `cwd`), thread the identity in rather than relying on ambient `cwd`.

### 9. Migrate in-scope inline shell-outs
- `autoMergeHandler.ts`: route the inline `git fetch` / `git push` / `git reset --hard` of the feature/base branch through context methods. Leave the merge-conflict `git merge`/`--abort` and `gh pr merge` (PR-merge domain) for the PR/merge slice — note the deferral in code/PR description.
- `upgradeClaim.ts`: route the inline `git fetch` / `git commit --allow-empty` / `git push HEAD:refs/heads/...` through context methods (the claim still owns its `git worktree add` until #661). Preserve the atomic-claim semantics exactly.
- `targetRepoManager.ts`: route `git fetch origin` + `gh repo view … defaultBranchRef` through the context where the bootstrap identity is known.

### 10. Remove migrated wrappers and update exports
- Delete the migrated I/O functions from `branchOperations.ts`, `commitOperations.ts`, and `worktreeReset.ts`; **keep** the pure `generateBranchName`/`validateSlug`/`inferIssueTypeFromBranch`/`PROTECTED_BRANCHES`.
- Update `adws/vcs/index.ts` to stop exporting the removed functions (coordinate with the `feature-sh8m9r` ownership of this file).
- Update any barrel re-exports (`adws/core`, `adws/github`) that surfaced the removed functions.
- Grep to prove no direct `execSync`/`spawnSync` of `git checkout|branch|commit|push|fetch|reset|merge|pull` or `gh repo view … defaultBranchRef` remains outside `adws/gitContext/` and `adws/vcs/` (pure-fn file), except the explicitly deferred PR-merge / worktree-add / clone-bootstrap sites noted above.

### 11. Validate
- Run the full Validation Commands below; fix any regressions until all pass with zero failures.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

- **GitContext branch ops** (`gitContextBranchOps.test.ts` or `gitContextOperations.test.ts`): for `getCurrentBranch`, `checkoutBranch`, `checkoutDefaultBranch`, `mergeLatestFromDefaultBranch`, `fetchAndResetToRemote`, `deleteLocalBranch`, `deleteRemoteBranch` — assert exact command strings, the worktree `cwd`, env injection, the `PROTECTED_BRANCHES` refusal (returns `false`, issues no delete), the warn-don't-throw behaviour of `mergeLatestFromDefaultBranch`, and the throw-on-failure of `fetchAndResetToRemote`. Re-home `fetchAndResetToRemote.test.ts`'s order/throw assertions.
- **GitContext commit ops** (`gitContextCommitOps.test.ts` or shared): re-home `commitOperations.test.ts` — `getHeadTreeHash`, `hasUncommittedChanges` (true/false/whitespace), and all `pushBranch` scenarios (fetch-then-force-with-lease order, first-push fetch-failure tolerance, distinct lease-rejection error on both stderr markers, rethrow of non-lease errors). Add an assertion that the push/commit env carries the git identity.
- **GitContext takeover reset** (`gitContextOperations.test.ts`): re-home `worktreeReset.test.ts` — clean/idempotent sequence, dirty tracked files, in-progress merge (plumbing success + fs fallback), in-progress rebase (plumbing success + fs fallback), both markers (merge before rebase), git-dir relative-vs-absolute resolution, and mandatory-step throws (fetch/reset/clean). Inject both the runner and `fs`.
- **Push integration** (`pushBranch.integration.test.ts`, kept as real-git/bare-remote): retarget Scenarios A/B/C onto `ctx.pushBranch(...)` so append-only, amend-rewrite recovery, and genuine-divergence rejection are proven end-to-end against the method.
- **Boundary factory** (`gitContextFactory.test.ts`): token-resolution priority (App → `GH_TOKEN` → `gh auth token` → throw), identity-resolution priority, self-host → framework root, target → target-repos workspace.
- **Preserved unchanged**: `branchOperations.test.ts` pure-function tests (`generateBranchName` assembly, `validateSlug` acceptance/rejection) — the migration must not change these.

### Edge Cases
- `cwd` omitted at a migrated call site → must now be a hard miss (context always supplies an explicit worktree/base path); no silent fallback to the process working directory.
- Protected branch (`main`/`master`/`develop`) passed to delete → refused, returns `false`, no `git` issued.
- First push with no remote ref → fetch failure tolerated, push proceeds.
- Genuine remote divergence → distinct lease error thrown (never auto-resumed into the same push), remote not clobbered.
- Takeover reset on a **linked** worktree → git-dir indirection resolved via `git rev-parse --git-dir` (relative and absolute).
- Two contexts for two repos exercised in one process → no `cwd`/token bleed; `process.env` unmutated after any operation.
- Target-repo context whose `basePath` disagrees with `ensureTargetRepoWorkspace(targetRepo)` → surfaced as an error/cross-check, not silently resolved.
- `commitChanges` with no changes → returns `false`, issues no commit.

## Acceptance Criteria
- Branch create/checkout/delete/default-branch are `GitContext` methods running with the context `cwd` (default-branch via the existing `defaultBranch()`); story 17 satisfied.
- `commitChanges` and `pushBranch` run through the context with the correct git author/committer identity (injected via `commandEnv()`) and explicit worktree `cwd`.
- `fetchAndResetToRemote` and the takeover `resetWorktree` run through the context.
- All call sites of the migrated branch/commit/push/fetch-reset functions route through a `GitContext`; no direct `execSync`/`spawnSync` of these git verbs remains outside `adws/gitContext/` (and the pure-fn `adws/vcs/branchOperations.ts`), except the explicitly documented deferrals (PR-merge `git merge`/`gh pr merge`; `git worktree add`; clone bootstrap).
- The behaviour previously covered by `vcs/__tests__/branchOperations.test.ts` (I/O parts), `commitOperations.test.ts`, `fetchAndResetToRemote.test.ts`, and `worktreeReset.test.ts` is preserved against the context methods; the pure-function tests are unchanged and still pass.
- `gitContextFor(...)` constructs a correctly-scoped context (self-host → framework root, target → target workspace) with a resolved token and git identity.
- All Validation Commands pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — lint the codebase for quality/style issues.
- `bunx tsc --noEmit` — type-check the root project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — type-check the `adws/` project (strict mode).
- `bun run test:unit` — run the full unit suite (new GitContext op/factory tests + preserved VCS pure-fn tests + integration push test).
- `bun run build` — verify the build has no errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-662"` — run this issue's BDD acceptance scenarios (authored in the scenario phase).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — run the regression suite for zero behavioural regressions.
- `! grep -rnE "execSync\(\s*[\`'\"]\s*(git (checkout|branch|commit|push|fetch|reset|merge|pull)|gh repo view[^\`'\"]*defaultBranchRef)" adws --include="*.ts" | grep -vE "__tests__|adws/gitContext/|adws/vcs/branchOperations.ts" | grep -vE "autoMergeHandler|upgradeClaim|targetRepoManager"` — proves no un-migrated direct shell-out of the in-scope verbs remains (the trailing exclusions are the documented deferrals; this command must produce no output).

## Notes

- **Coding guidelines.** Adhere strictly to `.adw/coding_guidelines.md`: files under 300 lines (the ops-module delegation keeps `gitContext.ts` thin), guard clauses over nested conditionals, immutability, prefer `async`/`await`, isolate side effects at the package boundary, no decorators. The `gitContext/` package must stay ADW-global-free (no imports from `adws/core`/`environment` — inject `REPO_ROOT`/`TARGET_REPOS_DIR`/logger).
- **Library install command:** `bun add <package>` (per `.adw/commands.md`). No new dependency is anticipated — this is internal refactoring of existing git/`gh` calls.
- **Sibling-slice overlap with #661 (`feature-issue-661-gitcontext-worktree-operations-migration`, unmerged).** #661 migrates worktree create/remove/**reset**/list (story 16) and introduces `adws/github/gitContextFactory.ts` + `adws/gitContext/worktreeOps.ts`, and touches `takeoverHandler.ts` and `vcs/index.ts`. This slice and #661 will both add methods to the `GitContext` class and both touch `vcs/index.ts` / `gitContextFactory.ts` / `takeoverHandler.ts` — a region overlap that resolves at merge (whichever lands second reconciles; the framework may serialize them via `## Blocked by`). To minimize conflict: put new logic in **new** package-private ops files (`branchOps.ts`/`commitOps.ts`/`worktreeResetOps.ts`), **reuse** `gitContextFactory.ts` if #661 created it first, and keep class-method additions additive. Note that #661 also implements a worktree `resetWorktree(branch)`; this slice migrates the distinct `worktreeReset.ts`/`resetWorktreeToRemote` takeover primitive as the issue body directs — if both land, dedupe to one method at merge.
- **#661 base divergence.** #661 was cut before #659 and replaces the `ExecFn`/`#run`/`defaultBranch` seam with a `GitContextLogger`+ops-delegation shape; #662 is planned against the **current `dev`** (the `ExecFn`/`#run`/`commandEnv`/`defaultBranch` form) and extends *that*. Do not adopt #661's seam variant — extend dev's.
- **The default-branch op already exists.** `getDefaultBranch(cwd)` call sites map to the shipped `ctx.defaultBranch()` (explicit `owner/repo`, which is strictly better than the cwd-relative `gh repo view`); no new method is required for the "default-branch" acceptance item.
- **Async factory, sync methods.** `gitContextFor` is async (token resolution); the operation methods are sync (`execSync` under the hood). Construct once per scope and reuse — this keeps hot loops (the build progress gate) allocation- and await-free and matches the PRD's "construct once at the boundary, thread down" model.
- **Deferred (out of scope, by design).** PR-merge verbs (`git merge`/`git merge --abort` conflict resolution, `gh pr merge`) belong to the issue/PR slice (PRD story 18); `git worktree add` belongs to the worktree slice (#661); target-repo clone bootstrapping is repo provisioning. These are noted, not migrated here, so the slice stays tractable and the delicate atomic-claim / conflict-resolution primitives are not destabilized. The PRD's CI/lint guard that *mechanically* bans raw `git`/`gh` ships separately (PRD: "shipped as a CI rule; no unit tests requested for the guard itself").
- **Identity persistence (story 13/14) is not part of this slice** — it is a separate PRD item; this slice relies on the launch-boundary identity supplied to `gitContextFor`.
