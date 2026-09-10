# Chore: Retire the #796 transitional construction sites — the launch boundary becomes the only GitContext constructor

## Metadata
issueNumber: `822`
adwId: `jzs5t0-retire-the-796-trans`
issueJson: `{"number":822,"title":"Retire the #796 transitional construction sites: launch boundary becomes the only GitContext constructor","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-08T11:19:26Z"}`

## Chore Description

`adws/guard/constructionRule.ts` carries a two-half allowlist. The PERMANENT half (2 entries — `adws/core/launchGitContext.ts`, `adws/providers/repoContext.ts`) is by design. The TRANSITIONAL half is migration debt owned by `#796`, which closed without clearing it. The stale-entry ratchet in `adws/checkGitGhGuard.ts`'s `main()` only fires when a listed file *stops* constructing, so a listed file that still constructs stays green forever. Result: 16 non-package files still mint their own `GitContext` with the guard's blessing, and the library's "the launch boundary is the only construction site" promise is false.

This chore retires those 16. Each call site is rewired to a **threaded** context — the launch boundary's `GitContext` for repo-scoped git work, `bindWorkspaceContext(boundary, cwd)` for worktree-scoped work — instead of constructing one. `adws/healthCheck.tsx` becomes a real launch boundary (`buildLaunchBoundary`). The `owner: '#796'` half of `SANCTIONED_CONSTRUCTION_SITES` ends up empty.

The 17 current transitional entries break down as:

| Entry | Disposition |
|---|---|
| `adws/github/gitContextFactory.ts` | **Stays sanctioned** — it *defines* the factories via `new GitContext(...)`. #823 deletes it. Its entry is re-owned `#823`. |
| `adws/core/orchestratorLib.ts` | Migrate — delete the `hasUncommittedChanges` free function; callers use their threaded context's method. |
| `adws/healthCheck.tsx` | Migrate — becomes a launch boundary. |
| `adws/phases/branchIdentityFallback.ts` | Migrate — `listCandidateBranches` takes an injected context. |
| `adws/phases/buildPhase.ts` | Migrate — `config.gitContext`. |
| `adws/phases/documentPhase.ts` | Migrate — `config.gitContext`. |
| `adws/phases/prPhase.ts` | Migrate — `config.gitContext`. |
| `adws/phases/prReviewPhase.ts` | Migrate — `boundary.gitContext` / `config.base.gitContext`. |
| `adws/phases/reviewPhase.ts` | Migrate — `config.gitContext`. |
| `adws/phases/scenarioFixPhase.ts` | Migrate — `config.gitContext`. |
| `adws/phases/workflowInit.ts` | Migrate — `boundary.gitContext`. |
| `adws/triggers/cancelHandler.ts` | Migrate — `boundary.gitContext`. |
| `adws/triggers/devServerJanitor.ts` | Migrate — per-repo `buildLaunchBoundary({owner, repo, cloneUrl: ''})` (multi-repo sweep). |
| `adws/triggers/takeoverHandler.ts` | Migrate — `boundary.gitContext`. |
| `adws/triggers/trigger_webhook.ts` | Migrate — `selfHostBoundary()` for the `/health` probe. |
| `adws/triggers/webhookHandlers.ts` | Migrate — `boundary.gitContext`. |
| `adws/vcs/worktreeOperations.ts` | Migrate — `getMainRepoPath` takes an injected context, threaded through the agent `launchContext`. |

Two files named in the issue's Touched Files need **no change** — verified against the current branch: `adws/core/remoteReconcile.ts` already takes `boundary.gitContext` (#820) and `adws/triggers/autoMergeHandler.ts` already takes a required `gitContext` parameter (#821); neither has an allowlist entry. `adws/checkLivingDocsIndex.ts` constructs nothing (#810 already cleaned it) and has no entry. They are listed as verification-only.

### Two behaviour-parity constraints that drive the design

1. **`selfHost` must be pinned, not re-derived.** In `workflowInit`, `repoContext` is set on *self-host* runs too (`bindWorkspaceContext` succeeds either way), so today's phase-level `gitContextFor({..., selfHost: !repoContext})` yields `selfHost === false` on a self-host run, while `boundary.gitContext.selfHost` is `true`. That value is read only for the agent `launchContext` (guardrails `--settings` injection). Swapping in the boundary context would flip guardrails behaviour on self-host runs. **Every `{ selfHost: gitCtx.selfHost, adwId }` literal must therefore be rewritten to the literal `{ selfHost: !repoContext, adwId }`**, preserving today's value byte-for-byte. Acceptance criterion 4 ("operator-visible behavior unchanged") requires this; the divergence is real but is a separate bug, out of scope here (see Notes).
2. **`ADW_MAIN_REPO_PATH` must keep being injected.** `adws/agents/claudeAgent.ts` sets it from `getMainRepoPath(cwd)` and `.claude/hooks/pre-tool-use.ts` reads it as a guardrail. Removing `worktreeOperations.ts`'s construction means the context has to reach `claudeAgent` — hence the `launchContext` widening in step 6.

## Relevant Files
Use these files to resolve the chore:

### Guard (the ratchet being retired)
- `adws/guard/constructionRule.ts` — `SANCTIONED_CONSTRUCTION_SITES`, its two-half doc comment, `findStaleSanctionedEntries`. The end-state edit.
- `adws/guard/guardReport.ts` — `printSanctionedConstructionSites()` prints `N transitional (#796)` and `…N transitional entries pending migration`; the label and the "pending migration" line must reflect the new reality.
- `adws/checkGitGhGuard.ts` — `main()`'s stale-entry ratchet, `isExemptPackage`. Read-only reference; must stay green.
- `adws/__tests__/checkGitGhGuard.test.ts` — samples `adws/phases/prReviewPhase.ts` as "a transitional entry" in two places (lines ~325, ~382); that entry disappears, so both must be re-pointed at `adws/github/gitContextFactory.ts`. Lines ~394-403 assert `permanent.length === 2` and `transitional.length > 0`; both stay true.

### The sanctioned constructors (read-only reference — do not add construction here)
- `adws/core/launchGitContext.ts` — `buildLaunchBoundary`, `buildLaunchGitContext`, `bindWorkspaceContext`, `LaunchBoundary`. The one permitted construction site.
- `adws/providers/repoContext.ts` — permanent site; still calls `gitContextForRepo` at lines 72 and 252. Unchanged.
- `adws/github/gitContextFactory.ts` — defines `gitContextFor` / `gitContextForSync` / `gitContextForRepo`. Unchanged in code; its allowlist entry is re-owned to `#823`.

### Call sites to migrate
- `adws/phases/workflowInit.ts` — line 156 `gitContextForSync(...)`; `WorkflowConfig.gitContext` (optional, line 89); the config literal at ~line 466.
- `adws/phases/workflowRepoIdentity.ts` — home of `resolveWorkflowRepoId`; the natural home for the new `requireWorkflowGitContext` accessor (same guard-then-throw idiom).
- `adws/phases/buildPhase.ts` (46), `adws/phases/documentPhase.ts` (38), `adws/phases/reviewPhase.ts` (196), `adws/phases/scenarioFixPhase.ts` (46) — one `await gitContextFor(...)` each, all uses pass an explicit cwd.
- `adws/phases/prPhase.ts` (56) — conditional `gitContextFor(...)`; already half-threaded via `config.gitContext?.commandEnv()`.
- `adws/phases/prReviewPhase.ts` (97, 329) — 97 has `boundary` in scope and calls `ensureWorktree` **with no cwd** (basePath-sensitive); 329 is inside `executePRReviewCommitPushPhase(config)`. The `base: WorkflowConfig` literal at ~143 does not set `gitContext` — it must.
- `adws/core/orchestratorLib.ts` (35) — `hasUncommittedChanges`; re-exported from `adws/core/index.ts:78` and `adws/index.ts:32`; called from `adws/phases/prPhase.ts:37` and `adws/phases/workflowInit.ts:416`.
- `adws/phases/branchIdentityFallback.ts` (32) — `defaultListCandidateBranches`; reached from `workflowInit.ts:198` and `adws/phases/branchNameResolution.ts:49` (`FinderFn` default).
- `adws/vcs/worktreeOperations.ts` (19) — `getMainRepoPath`; re-exported from `adws/vcs/index.ts:21`; sole caller `adws/agents/claudeAgent.ts:135`.
- `adws/triggers/cancelHandler.ts` (65), `adws/triggers/webhookHandlers.ts` (65, 70), `adws/triggers/takeoverHandler.ts` (101, 107, 111) — all already have `boundary: LaunchBoundary` in scope.
- `adws/triggers/devServerJanitor.ts` (266) — `defaultDeps.listWorktrees(owner, repo)`; a **multi-repo** sweep, so no single boundary applies.
- `adws/triggers/trigger_webhook.ts` (95) — the `/health` endpoint's `healthCtx`.
- `adws/triggers/webhookRepoResolver.ts` — `selfHostBoundary()` (memoised self-host `LaunchBoundary`) and `buildEventBoundary`; used by the `/health` fix.
- `adws/healthCheck.tsx` (112) — becomes `buildLaunchBoundary(null, { getRepoInfo: () => readLocalRepoInfo(REPO_ROOT) })`.
- `adws/healthCheckChecks.ts` — already takes a threaded `ctx`; read-only reference.

### Agent launchContext threading (needed for `getMainRepoPath`)
- `adws/agents/claudeAgent.ts` — declares `launchContext?: { selfHost: boolean; adwId: string }`; sets `ADW_WORKTREE_PATH` / `ADW_MAIN_REPO_PATH` at lines 133-141.
- `adws/agents/{alignment,build,command,dependencyExtraction,document,git,install,patch,plan,pr,refactor,resolution,review,scenario,scenarioFidelity,stepDef,test,testRetry,validation}Agent.ts` — 25 further copies of the same inline annotation; a mechanical replacement with the new exported interface.
- `adws/phases/reviewPatchHelpers.ts` — two more copies of the inline annotation (lines 22, 32).
- `adws/adwUpgrade.tsx` — `runInitCommandDefault` (~447-467) builds a `launchContext` with no context in scope; `buildDefaultUpgradeDeps` (~470) has `gitCtx`, so `RunInitCommandParams` gains a `gitContext` field.

### Verification-only (named in the issue, already clean)
- `adws/core/remoteReconcile.ts`, `adws/triggers/autoMergeHandler.ts`, `adws/checkLivingDocsIndex.ts`.

### Tests that mock the retired factories
- `adws/phases/__tests__/workflowInit.test.ts:49-50` — `vi.mock('../../github/gitContextFactory', { gitContextForSync })`.
- `adws/triggers/__tests__/cancelHandler.test.ts:22`, `adws/triggers/__tests__/takeoverHandler.test.ts:7`, `adws/triggers/__tests__/takeoverHandler.integration.test.ts:14` — same mock.
- `adws/phases/__tests__/reviewPhase.test.ts:28-29` — `vi.mock(..., { gitContextFor })`.
- `adws/core/__tests__/launchGitContext.test.ts:284`, `adws/triggers/__tests__/perIssueScenarioSweep.test.ts:211` — prose/name references only; no change expected, verify.

### Documentation (living docs — `/document` convergence, `bun run lint:docs-index`)
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — owns the guard rules; §"#821 shrank the TRANSITIONAL half…" must be extended for #822.
- `app_docs/feature-9gjajh-github-api.md` — states the transitional count (17) and that `gitContextFactory.ts` keeps its entry.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md`, `-build-and-plan-phases.md`, `-document-phase.md`, `-review-and-diff-phases.md`, `-test-and-scenario-phases.md`, `-pr-and-merge-phases.md`, `-webhook-triggers.md`, `-takeover-and-coordination.md`, `-issue-routing-and-eligibility.md`, `-health-check.md`, `-providers.md`, `-claude-stream-parser.md` — conditional docs owning the touched files (per `.adw/conditional_docs.md`); update the ones whose described wiring actually changes.
- `.adw/coding_guidelines.md` — files under 300 lines, guard clauses, no `any`, remove unused imports.
- `specs/prd/gitcontext-library-extraction.md`, `specs/runbooks/gitcontext-extraction.md` — parent PRD / runbook (story 24); read-only context.

### New Files
None. (`requireWorkflowGitContext` goes into the existing `adws/phases/workflowRepoIdentity.ts`.)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Establish the baseline
- Run `bun install`.
- Run `bun run lint:git-guard`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run test:unit`. Record the results. All must be green before any edit; if one is already red, fix that first, in its own commit, and say so in the PR.
- Record the current transitional-entry count printed by `lint:git-guard` (expected: 17).

### 2. Make the workflow's GitContext reachable from every phase
- In `adws/phases/workflowRepoIdentity.ts`, add `requireWorkflowGitContext(config: Pick<WorkflowConfig, 'gitContext'>): GitContext` — returns `config.gitContext`, throws a message in the same voice as `resolveWorkflowRepoId`'s ("this WorkflowConfig carries no launch GitContext — `initializeWorkflow` and `initializePRReviewWorkflow` always set one"). Keep `WorkflowConfig.gitContext` **optional** in the interface so the `as unknown as WorkflowConfig` fixtures across `adws/**/__tests__` keep compiling.
- In `adws/phases/prReviewPhase.ts`, add `gitContext: boundary.gitContext` to the `base: WorkflowConfig` literal (~line 143), so both of the codebase's two `WorkflowConfig` construction sites always set it.
- Update the `gitContext?` field's doc comment on `WorkflowConfig` (`workflowInit.ts:87-89`) to say it is always set in production and optional only for fixtures.

### 3. Retire `workflowInit.ts` and `prReviewPhase.ts`'s own constructions
- `adws/phases/workflowInit.ts`: delete line 156's `gitContextForSync(...)` and the `gitContextForSync` import (line 43); replace `const gitCtx = ...` with `const gitCtx = boundary.gitContext` (or collapse `gitCtx` and the existing `gitContext` local at line 157 into one name and update all ~12 uses). This is a true drop-in: the boundary's `selfHost` is `targetRepo === null`, identical to `!targetRepo`, so `ensureWorktree`'s basePath-derived paths are unchanged.
- `adws/phases/prReviewPhase.ts` line 97: replace `await gitContextFor({ owner: boundary.repoId.owner, ... selfHost: !targetRepo })` with `boundary.gitContext`. Same drop-in argument — and this one *is* basePath-sensitive (`gitCtx.ensureWorktree(pr.sourceBranch)` passes no cwd), so confirm `selfHost` matches before deleting.
- `adws/phases/prReviewPhase.ts` line 329 (`executePRReviewCommitPushPhase`): replace with `requireWorkflowGitContext(config.base)`. Rewrite line 336's `{ selfHost: gitCtx.selfHost, adwId }` to `{ selfHost: !repoContext, adwId }` (parity constraint 1).
- Remove the now-unused `gitContextFor` import from `prReviewPhase.ts` if no other use remains.

### 4. Retire the four worktree-scoped phases
For each of `adws/phases/buildPhase.ts` (46), `documentPhase.ts` (38), `reviewPhase.ts` (196), `scenarioFixPhase.ts` (46):
- Replace `const gitCtx = await gitContextFor({ owner, repo, selfHost: !repoContext })` with `const gitCtx = requireWorkflowGitContext(config)`. Every use in these files (`commandEnv()`, `pushBranch(branch, worktreePath)`, `hasUncommittedChanges(worktreePath)`, `getHeadTreeHash(worktreePath)`) passes an explicit cwd, so basePath is never consulted.
- Rewrite every `{ selfHost: gitCtx.selfHost, adwId }` literal to `{ selfHost: !repoContext, adwId }` (buildPhase 157/235/289, documentPhase 69/118, reviewPhase 214, scenarioFixPhase 96/132). Parity constraint 1.
- Drop the now-dead `gitContextFor` import and, where `resolveWorkflowRepoId`'s `{ owner, repo }` destructuring becomes unused, that too. Some of these files still need `resolveWorkflowRepoId` for other reasons — check before deleting.
- `adws/phases/prPhase.ts` (56): replace the `repoContext ? await gitContextFor(...) : null` ternary with `repoContext ? requireWorkflowGitContext(config) : null`, then simplify the now-redundant `gitCtx?.commandEnv() ?? config.gitContext?.commandEnv()` at line 72 to a single `requireWorkflowGitContext(config).commandEnv()`. Leave `{ selfHost: !repoContext, adwId }` at line 73 exactly as it is.

### 5. Retire `orchestratorLib.hasUncommittedChanges` and `branchIdentityFallback`
- `adws/core/orchestratorLib.ts`: delete the `hasUncommittedChanges` function and the `gitContextForRepo, readLocalRepoInfo` import. The file then constructs nothing.
- Remove `hasUncommittedChanges` from the `adws/core/index.ts:78` re-export and the `adws/index.ts:32` re-export.
- `adws/phases/prPhase.ts:37`: `if (requireWorkflowGitContext(config).hasUncommittedChanges(worktreePath))`. Note the swallow-and-return-false `try/catch` the free function provided is gone — keep parity by wrapping the call in the same `try/catch` if the surrounding code cannot tolerate a throw; state which choice you made in the commit message.
- `adws/phases/workflowInit.ts:416`: same substitution using the local boundary context.
- `adws/phases/branchIdentityFallback.ts`: change `defaultListCandidateBranches` to take a `Pick<GitContext, 'worktreeBranches' | 'localBranches'>` as its first parameter and drop the `gitContextForRepo, readLocalRepoInfo` import. `defaultDeps` becomes a `buildDefaultBranchIdentityFallbackDeps(gitContext)` factory (mirroring `buildDefaultUpgradeGateDeps` / `buildDefaultDocsSelfCheckDeps`, the established idiom in this codebase). Make `deps` a **required** parameter of `findExistingBranchForIssue` and `recoverAdwIdForBranch`.
- Thread it: `adws/phases/branchNameResolution.ts`'s `FinderFn`/`resolveInternal` passes the caller's deps through; `adws/phases/workflowInit.ts:198-199` passes `buildDefaultBranchIdentityFallbackDeps(boundary.gitContext)`. Follow the existing `resolveWorkflowBranchName` call chain from `workflowInit` and widen it minimally.

### 6. Retire `worktreeOperations.getMainRepoPath` (agent `launchContext` thread)
- In `adws/agents/claudeAgent.ts`, export `export interface AgentLaunchContext { selfHost: boolean; adwId: string; gitContext?: Pick<GitContext, 'mainRepoPath'> }` with a doc comment explaining that `gitContext` exists so the spawned agent can be told its main repo path without constructing a context (#822).
- Replace all 26 occurrences of the inline `launchContext?: { selfHost: boolean; adwId: string }` annotation with `launchContext?: AgentLaunchContext` across `adws/agents/*.ts` (19 files) and `adws/phases/reviewPatchHelpers.ts` (2 occurrences). This is mechanical; `tsc` proves completeness.
- `adws/vcs/worktreeOperations.ts`: change `getMainRepoPath(cwd: string)` to `getMainRepoPath(gitContext: Pick<GitContext, 'mainRepoPath'>, cwd: string)`, delete the `gitContextForRepo, readLocalRepoInfo` import, and update the module doc comment. Update the `adws/vcs/index.ts:21` re-export comment if it describes the old signature.
- `adws/agents/claudeAgent.ts:133-141`: call `getMainRepoPath(launchContext.gitContext, cwd)` only when `launchContext?.gitContext` is present. Keep the existing `try/catch` and the `cwd.includes('.worktrees/')` guard.
- Thread `gitContext` into every `launchContext` object literal that can reach a worktree cwd: all phase call sites listed under "Agent launchContext threading" above pass `requireWorkflowGitContext(config)` (or the local boundary context). For `adws/adwUpgrade.tsx`, add `gitContext: GitContext` to `RunInitCommandParams` and supply it from `buildDefaultUpgradeDeps`'s `gitCtx`.
- **Verify parity explicitly**: grep for every `runClaudeAgentWithCommand`/`runClaudeAgent` call whose `cwd` is a worktree path and confirm each now carries `gitContext`. A missed site silently stops exporting `ADW_MAIN_REPO_PATH`, weakening `.claude/hooks/pre-tool-use.ts` — that would violate acceptance criterion 4.

### 7. Retire the five trigger construction sites
- `adws/triggers/cancelHandler.ts:65` → `boundary.gitContext.removeWorktreesForIssue(issueNumber)`; drop the import. `removeWorktreesForIssue` takes **no cwd** and derives its worktree root from `basePath` (`gitContext.ts:401-410`), so `selfHost` is load-bearing here. It is nonetheless a safe drop-in: `cancelCwd` is the target-repo workspace path when `targetRepo` is set and `undefined` otherwise (`trigger_cron.ts:358`, `trigger_webhook.ts:213`), so today's `selfHost: !cwd` and the boundary's `targetRepo === null` are the same value. Add a one-line comment recording that equivalence.
- `adws/triggers/webhookHandlers.ts:63-71` → `defaultIssueClosedDeps` already receives `boundary`; use `boundary.gitContext` for both `removeWorktreesForIssue` and `deleteRemoteBranch`. `removeWorktreesForIssue` matches by the same `cwd`-tracks-`targetRepo` argument as above. `deleteRemoteBranch` does **not** match: it is hardcoded `selfHost: false` today, so on a self-host run with `cwd === undefined` it operates from `TARGET_REPOS_DIR/<owner>/<repo>` — a directory that does not exist for the framework repo. The boundary context makes that call operate from `REPO_ROOT`. See the Notes: this is a genuine fix, not a regression, but it must be called out in the PR. Drop the import.
- `adws/triggers/takeoverHandler.ts:101,107,111` → hoist one `const gitCtx = boundary.gitContext` and use it for `resetWorktree`, `buildDefaultProbeDeps(ctx)` (twice). All three pass explicit worktree paths, so this is a straight drop-in. Drop the import.
- `adws/triggers/devServerJanitor.ts:266` → this sweep spans *many* repos, so it needs one boundary per repo: `listWorktrees: (owner, repo) => buildLaunchBoundary({ owner, repo, cloneUrl: '' }).gitContext.listWorktrees()`. `discoverRepoWorktrees` already wraps `deps.listWorktrees` in a per-repo `try/catch` that logs and continues, so a boundary that fails to mint is already isolated (#812). Import `buildLaunchBoundary` from `../core`.
- `adws/triggers/trigger_webhook.ts:95` → `healthCtx = selfHostBoundary()?.gitContext` (already imported from `./webhookRepoResolver`); delete the `gitContextForRepo, readLocalRepoInfo` import if nothing else uses it. The existing `try/catch` and the `ctxFailure` degrade path stay.

### 8. Make `adws/healthCheck.tsx` a launch boundary
- Replace `gitContextForRepo(readLocalRepoInfo(REPO_ROOT), { selfHost: true })` with `buildLaunchBoundary(null, { getRepoInfo: () => readLocalRepoInfo(REPO_ROOT) }).gitContext`. Passing the `getRepoInfo` seam pins the identity read to `REPO_ROOT` exactly as today, rather than to `process.cwd()` — required for parity when the script is run from a worktree.
- Keep the existing `try/catch` that records `result.checks.gitContext` on failure; `buildLaunchBoundary` mints providers lazily, so building the boundary adds no new failure mode.
- Keep the `readLocalRepoInfo` import (it is not a flagged constructor); drop `gitContextForRepo`.

### 9. Empty the transitional half of the allowlist
- In `adws/guard/constructionRule.ts`, delete all 16 migrated `owner: '#796'` entries. Re-own the surviving `adws/github/gitContextFactory.ts` entry to `owner: '#823'` with the reason "defines gitContextFor/gitContextForSync/gitContextForRepo via new GitContext(...); #823 deletes this file with the boundary rewire". The PERMANENT half stays exactly 2 entries, untouched.
- Rewrite the `SANCTIONED_CONSTRUCTION_SITES` doc comment: the `#796` migration wave is complete and its half is empty ("nothing is here"); what remains is the single `#823` sunset entry. Keep the "NOTHING MAY EVER BE ADDED — a new construction site must call `buildLaunchBoundary`, not join this list" prohibition, now stated of the whole non-permanent half. Keep the `findStaleSanctionedEntries` ratchet exactly as it is (`'owner' in site` still selects the sunset entry, so it still self-cleans when #823 lands).
- In `adws/guard/guardReport.ts`, update `printSanctionedConstructionSites()`: the `(#796)` label becomes `(#823 sunset)`, and print the sunset entries by `file — reason` rather than the now-meaningless `…N transitional entries pending migration` line. Preserve the constraint in that file's doc comment: **the output must never contain the substring "allowlisted"**.

### 10. Update the tests the migration invalidates
- `adws/__tests__/checkGitGhGuard.test.ts`: re-point the two `adws/phases/prReviewPhase.ts` samples (the "permits `createGitHubIssueTracker(...)` at a transitional entry" case and the "is true for a sampled transitional path" case) at `adws/github/gitContextFactory.ts`. Rename them from "transitional" to "sunset" to match the new vocabulary. Leave the `permanent.length === 2` / `transitional.length > 0` invariants and the `findStaleSanctionedEntries` tests as they are — both still hold.
- `adws/phases/__tests__/workflowInit.test.ts`: drop the `vi.mock('../../github/gitContextFactory')` block and make the fake `boundary.gitContext` (line ~157) carry the worktree methods `mockGitCtx` used to provide.
- `adws/triggers/__tests__/cancelHandler.test.ts`, `takeoverHandler.test.ts`, `takeoverHandler.integration.test.ts`: same — delete the factory mock, move the fakes onto the injected `boundary.gitContext`. Keep the two takeover assertions that check the worktree path resolves "under context base, not `gitContextForSync` fallback" (rename their titles; the behaviour they pin is now structurally guaranteed).
- `adws/phases/__tests__/reviewPhase.test.ts`: drop the `gitContextFor` mock; supply `gitContext` on the `WorkflowConfig` fixture instead.
- Add coverage for the new seams where a real behaviour is now pinned: `requireWorkflowGitContext` throws on a config with no context; `getMainRepoPath` delegates to the injected context; `claudeAgent` omits `ADW_MAIN_REPO_PATH` when no `gitContext` is threaded. Follow the existing file layout (`__tests__/` next to the module).

### 11. Update the living documentation
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`: add a #822 bullet next to the existing #821 one — the transitional half went 17 → 1, the sole survivor is `adws/github/gitContextFactory.ts` awaiting #823, and `buildLaunchBoundary` is now the only construction path for every non-package file.
- `app_docs/feature-9gjajh-github-api.md`: correct the "17 entries" count.
- Update the conditional-docs files owning the touched modules where the wiring they describe actually changed (workflow lifecycle, build/plan, document, review/diff, test/scenario, PR/merge, webhook triggers, takeover, issue routing, health check). Do not touch the ones whose described behaviour is unchanged.
- Run `bun run lint:docs-index` and fix any index drift it reports (see the #810 docs-index gate).

### 12. Run the Validation Commands
- Execute every command in the `Validation Commands` section below, in order, and confirm each exits clean.
- Additionally confirm the acceptance criteria directly:
  - `grep -rn "gitContextForRepo\|gitContextForSync\|gitContextFor(" adws --include="*.ts" --include="*.tsx" | grep -v "^adws/core/launchGitContext.ts\|^adws/providers/repoContext.ts\|^adws/github/gitContextFactory.ts\|__tests__\|adws/guard/"` returns **no call sites** (doc-comment mentions are fine).
  - `bun run lint:git-guard` prints **1** non-permanent entry (`adws/github/gitContextFactory.ts`) and **2** permanent, with no stale-entry failure and no `unsanctioned-construction` violation.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun install` — restore dependencies.
- `bun run lint` — ESLint across the repo (catches unused imports left behind by the deletions).
- `bunx tsc --noEmit` — root type-check; the single source of truth that every `launchContext` annotation and every threaded parameter lines up.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional ADW type-check from `.adw/commands.md`.
- `bun run build` — `tsc` build must emit without errors.
- `bun run test:unit` — full Vitest suite (guard rule, workflowInit, phases, triggers).
- `bun run lint:git-guard` — all four guard rules green: no `unsanctioned-construction` violation, no `cwd-derived-identity` violation, and no stale sanctioned entry.
- `bun run lint:docs-index` — living-docs index health gate.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression BDD scenarios (Docker equivalent: `bun run test:docker`).

## Notes
- `.adw/coding_guidelines.md` applies: files under 300 lines, guard clauses over nesting, no `any`, `Pick<...>` over full-interface parameters for narrow seams, and remove every unused import the deletions leave behind. Several touched files are already near the 300-line limit (`prReviewPhase.ts`, `workflowInit.ts`) — if a step pushes one over, extract rather than inline, following the sibling-module pattern already used there (`promotionRotAdvisory.ts`, `worktreeSetup.ts`, `guardReport.ts`).
- **Judgment call to flag in the PR:** acceptance criterion 2 says "transitional half of the allowlist is empty", but `adws/github/gitContextFactory.ts` still calls `new GitContext(...)` and criterion 1 explicitly keeps it as a permitted caller, so deleting its entry outright would turn `unsanctioned-construction` red and break criterion 3. The plan therefore empties the `#796` half (all 16 migration entries gone) and re-labels the one survivor as a `#823` sunset entry, which keeps the ratchet armed and the permanent half at exactly 2. The issue's own arithmetic supports this reading: it counts "16 non-package files", i.e. 17 current entries minus `gitContextFactory.ts`.
- **Known divergence deliberately preserved, not fixed here:** the `selfHost` value handed to agent `launchContext` is `!repoContext`, which is `false` on self-host runs (because `bindWorkspaceContext` succeeds there too). That means guardrails `--settings` injection currently fires on ADW's own self-host runs, contrary to `resolveGuardrailsDecisionForSpawn`'s "target-repo runs only" contract. Switching those literals to `boundary.gitContext.selfHost` would fix it *and* change operator-visible behaviour, which criterion 4 forbids. Pin the current value and file a follow-up issue.
- **One behaviour change that cannot be avoided, and is a fix:** `webhookHandlers.defaultIssueClosedDeps`'s `deleteRemoteBranch` currently constructs with `selfHost: false` unconditionally. On a self-host `issues.closed` event (`cwd === undefined`) that resolves `basePath` to `TARGET_REPOS_DIR/<owner>/<repo>`, which does not exist for the framework repo, so the delete fails. Threading `boundary.gitContext` resolves it to `REPO_ROOT` and the delete succeeds. ADW self-hosts, so this path is live. Call it out explicitly in the PR body rather than folding it into "no behaviour change", and check whether a BDD scenario pins the current (broken) outcome before changing it.
- `adws/core/remoteReconcile.ts`, `adws/triggers/autoMergeHandler.ts` and `adws/checkLivingDocsIndex.ts` appear in the issue's Touched Files but were already cleaned by #820/#821/#810 and carry no allowlist entry. Verify and note; do not manufacture changes for them.
- Guard-runner files that merely *name* the factories inside string literals (`adws/checkGitGhGuard.ts`, `adws/guard/constructionRule.ts`, `adws/guard/identityRule.ts`) are not construction sites and need no entry — the rule only matches call/new expressions with a bare-identifier callee.
- `adws/providers/github/**` and `adws/gitContext/**` are pruned by `isExemptPackage` before the guard walk, so nothing in them needs an allowlist entry either.
- Run the workflow scripts with `bunx tsx <script_name>` per `.adw/commands.md`.
