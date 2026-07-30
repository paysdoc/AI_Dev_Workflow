# Bug: Cron sweep probes re-derive repo identity from cwd — thread the cron launch GitContext into both sweeps

## Metadata
issueNumber: `769`
adwId: `5k8n5z-cron-sweep-probes-re`
issueJson: `{"number":769,"title":"Cron sweep probes retarget to the framework repo — target-repo cron sweeps AI_Dev_Workflow","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-07-30T09:13:24Z"}`

## Bug Description
The two cron sweep probes — `runPerIssueScenarioSweep` (`adws/triggers/perIssueScenarioSweep.ts`) and `runPromotionSweep` (`adws/triggers/promotionSweep.ts`) — are dispatched from `checkAndTrigger` (`adws/triggers/trigger_cron.ts:237` and `:243`) **with no arguments**. Their production dependency defaults therefore resolve repo identity from scratch, via `gitContextForRepo(getRepoInfo())`, and `getRepoInfo()` with no `cwd` reads `git remote get-url origin` against `process.cwd()` (`adws/gitContext/bootstrapIdentity.ts:38-51`). The cron asserts its cwd is the framework repo root (`trigger_cron.ts:434` `assertCwdIsRepoRoot()`), so **every cron — including every `--target-repo` cron — sweeps `paysdoc/AI_Dev_Workflow`**.

Meanwhile the cron already resolved the correct identity twice and threw it away for these two call paths:
- `trigger_cron.ts:67` — `cronRepoInfo` / `targetRepo` from `resolveCronRepo(process.argv.slice(2), getRepoInfo)`.
- `trigger_cron.ts:71-77` — `cronGitContext = buildLaunchGitContext(targetRepo)`, the launch-boundary context, whose only consumer today is `evaluateCandidate` (`trigger_cron.ts:338`).

**Expected:** a cron launched with `--target-repo owner/repo` TTL-sweeps and promotion-scores *that repo's* `features/per-issue/` tree, using the one context built at its launch boundary. A self-host cron (no `--target-repo`) sweeps the framework repo.

**Actual:** every cron sweeps the framework repo. Observed 2026-07-29 in the `vestmatic/vestmatic-research` cron log — AI_Dev_Workflow issue numbers and AI_Dev_Workflow feature paths:

```
perIssueScenarioSweep: sweeping stale scenario features/per-issue/feature-701.feature (issue #701 merged 2026-06-29T07:21:03.000Z)
perIssueScenarioSweep: sweeping stale scenario features/per-issue/feature-753.feature (issue #753 merged 2026-07-10T12:16:07.000Z)
⚠️ perIssueScenarioSweep: checkout is not on default branch "dev" — skipping persistence
promotionSweep: features/per-issue/feature-504.feature → leave
```

No target repo's per-issue scenarios have ever been TTL-swept or scored for promotion.

### Two verified corrections to the issue text
Both were checked against this worktree at `54cf0c85` (= `origin/dev` tip) and both change the work:

1. **The issue's line references for `perIssueScenarioSweep.ts` (`:58,67,85,95,114`) are pre-#758 and no longer exist.** #758 (`f095df65`, merged 2026-07-11) moved four of the five defaults behind a `SweepBase` produced by `prepareSweepBase()` in the **new file `adws/triggers/perIssueSweepPersist.ts`**. Today the cwd-derivation lives in exactly two places for this sweep: `perIssueScenarioSweep.ts:72-76` (`defaultGetMergedAt`) and `perIssueSweepPersist.ts:51-52` (`prepareSweepBase`). The bug is intact, but **the fix must also touch `perIssueSweepPersist.ts`, a file the issue does not name.** `promotionSweepDefaults.ts:40,49,58,67,81,90,103,123,142` are exactly as the issue describes.

2. **The per-issue cross-repo write hazard is ACTIVE on `dev` today, not latent (issue Impact §2/§3).** The `"checkout is not on default branch … skipping persistence"` short-circuit the issue relies on no longer exists in the per-issue sweep — `grep` confirms the only surviving instance of that message is `promotionSweepDefaults.ts:126`. Since #758 the per-issue sweep persists by creating a dedicated `chore/scenario-sweep` worktree **off fresh `origin/<default>`** (`perIssueSweepPersist.ts:49-80`), committing the removal there, pushing, and opening + immediately merging a PR (`:89-120`). The branch of the host checkout is irrelevant to that path. So on current `dev`, **a `vestmatic/*` cron reaching the sweep cadence will open and merge a PR that deletes AI_Dev_Workflow's per-issue scenarios**, and concurrent crons race on the same fixed branch name. The observed 2026-07-29 log came from a long-lived cron process started before #758 landed. The promotion sweep's hazard *is* still latent (its `defaultTagAndCommit` branch guard survives at `promotionSweepDefaults.ts:125-128`). This raises the urgency but does not change the fix.

## Problem Statement
The GitContext PRD (`specs/prd/git-context-repo-authority.md`) has two halves. The package contract half holds here: a `RepoInfo` *is* passed, the constructor gets mandatory identity, and `resolveBasePath` (`adws/gitContext/gitContext.ts:89-93`) has no cwd fallback. The half that breaks is **"identity is established once at the launch boundary and threaded, never re-derived"**.

Four concrete defects follow:

1. **Identity is re-derived inside the probes.** `gitContextForRepo` (`adws/github/gitContextFactory.ts:109-121`) is a public, synchronous, boundary-free factory that accepts *any* `RepoInfo`. Handed `paysdoc/AI_Dev_Workflow` it correctly auto-derives `selfHost: true` (`:113-114`), resolves `basePath` → `REPO_ROOT`, and mints a token bound to the framework repo (`:111`). It cooperated because it cannot distinguish a correct caller from an incorrect one.

2. **Nothing forces the launch context in.** `cronGitContext` has one consumer (`trigger_cron.ts:338`). `fetchOpenIssues` (`:82`) passes `cronRepoInfo` and is correct **by discipline, not by construction** — the sweeps show what happens when discipline lapses.

3. **`checkGitGhGuard` is structurally blind to it.** There is no raw `git`/`gh` string (the guard's only rule, `checkGitGhGuard.ts:118-125`), and `readLocalRepoInfo` is the permanently-exempt bootstrap read inside `adws/gitContext/` (`checkGitGhGuard.ts:31,59`). The bypass is a *composition* of two individually legal calls.

4. **One context per helper, not one per pass.** Five contexts are constructed per per-issue pass and nine per promotion pass, each re-minting an installation token for a repo the process has no business touching. Not a `GH_TOKEN` bleed (auth is per-command since #700), but wasteful and wrong.

## Solution Statement
**Make the context an input, not a lookup, and make the guard able to see the composite.**

1. **Thread the launch context.** `PerIssueSweepDeps` and `PromotionSweepDeps` each gain a **required** `gitContext: GitContext` field, and `deps` stops being optional. Every default becomes a closure over that one context (`makeDefaultDeps(ctx)` for the promotion sweep; `prepareSweepBase(ctx)` + a curried `defaultGetMergedAt(ctx, n)` for the per-issue sweep). `getRepoInfo` and `gitContextForRepo` are **deleted from all three sweep files**, so **zero additional** contexts are constructed per pass — the "exactly one `GitContext` per sweep pass" of AC5 is the launch context itself, reused. Where a `RepoInfo` is still needed by an un-migrated collaborator (`mergePR`, `defaultFindPRByBranch`, `applyLabel`), derive it from the context's own identity accessors (`gitContext.ts:124-125`), never from cwd.

2. **Skip, never fall back.** `cronGitContext` is `null` when `trigger_cron.ts` is imported as a module (the entry-script guard at `:75` does not fire). Both dispatches go through an exported tick seam that takes a **nullable bound thunk**; a `null` thunk logs a warning and returns without dispatching. There is no cwd fallback anywhere on the path.

3. **Teach the guard the composite shape.** `checkGitGhGuard.ts` gains a second rule: a `gitContextForRepo(…)` call whose argument is cwd-derived identity — either a zero-argument `getRepoInfo()` / `readLocalRepoInfo()` inline, **or an identifier bound to one earlier in the same file**. The local-variable form is essential: it is the shape in three of the four offending sites, so a purely syntactic composite match would have missed the very bug being fixed. The rule needs **no allowlist** (which #701 deliberately deleted): the four legitimate self-host sites are brought into compliance by passing `REPO_ROOT` explicitly, which is both more correct and behaviour-preserving.

The pure decision cores — `isScenarioStale`, `shouldSkipForPromotionState`, `decidePromotionAction`, `reconcileFactFor`, the scorer/threshold — are **not touched**. Only the repo the I/O acts on changes.

## Steps to Reproduce
Pre-fix, in this repo:

1. **Static (no run required).** `grep -rn "gitContextForRepo(getRepoInfo())" adws --include='*.ts'` → 8 hits in `promotionSweepDefaults.ts` + 1 in `githubApi.ts:60`; `grep -n "getRepoInfo()" adws/triggers/perIssueScenarioSweep.ts adws/triggers/perIssueSweepPersist.ts adws/triggers/promotionSweepDefaults.ts` → the cwd-derivation sites. None of them receives `cronGitContext`.
2. **In-process.** Start `bunx tsx adws/triggers/trigger_cron.ts --target-repo vestmatic/vestmatic-research --clone-url …` and wait for `cycleCount % 4320 === 0` (`config.ts:135`, ≈24 h), or invoke the probes directly with cwd = the framework root, as the cron does: `bunx tsx -e "import('./adws/triggers/perIssueScenarioSweep.ts').then(m => m.runPerIssueScenarioSweep())"`.
3. **Observe:** the log lines name `features/per-issue/feature-{N}.feature` files and issue numbers from **AI_Dev_Workflow**, never from the target repo. `perIssueScenarioSweep` creates its `chore/scenario-sweep` worktree under `REPO_ROOT` and `defaultGetMergedAt` runs `gh pr list --limit 200` against `paysdoc/AI_Dev_Workflow`.
4. **Direct A/B proof of the root cause:** run the same probe with cwd changed to a *different* checkout — the swept repo follows `process.cwd()`, not `--target-repo`. That single variable is the bug.

Post-fix, the same run sweeps the target repo (or no-ops cleanly if that repo has no local workspace), and `bun run lint:git-guard` fails the moment a `gitContextForRepo(getRepoInfo())` composite is reintroduced.

## Root Cause Analysis
The cron's launch boundary is correct; the wiring downstream of it is not.

```
trigger_cron.ts:67   resolveCronRepo(argv, getRepoInfo)  →  cronRepoInfo = vestmatic/vestmatic-research   ✔
trigger_cron.ts:76   buildLaunchGitContext(targetRepo)   →  cronGitContext (basePath = TARGET_REPOS_DIR/…) ✔
trigger_cron.ts:237  runPerIssueScenarioSweep()          →  no context passed                             ✘
trigger_cron.ts:243  runPromotionSweepTick(cycleCount)   →  no context passed                             ✘
        ↓ default deps resolve identity from scratch
perIssueScenarioSweep.ts:72-76   gitContextForRepo(getRepoInfo())
perIssueSweepPersist.ts:51-52    gitContextForRepo(getRepoInfo())
promotionSweepDefaults.ts:40…142 gitContextForRepo(getRepoInfo())   ×9
        ↓ getRepoInfo(undefined) → readLocalRepoInfo(undefined)
bootstrapIdentity.ts:38-51       execSync('git remote get-url origin', { cwd: undefined })
        ↓ cwd is pinned to the framework root by trigger_cron.ts:434 assertCwdIsRepoRoot()
                                 owner/repo = paysdoc/AI_Dev_Workflow
        ↓ gitContextFactory.ts:113-114 auto-derives selfHost = true (matches REPO_ROOT's remote)
        ↓ gitContext.ts:89-93 resolveBasePath → REPO_ROOT
                                 every sweep acts on the framework repo
```

Three independent design facts let this survive:

- **`gitContextForRepo` is boundary-free.** It is exported for legitimate mid-flight uses that already hold a resolved `RepoInfo` (`autoMergeHandler.ts:155`, `issueClosedUnblockRouter.ts:51`, `trigger_cron.ts:82`). It cannot tell whether the `RepoInfo` it was handed came from a launch boundary or from cwd, so `gitContextForRepo(getRepoInfo())` type-checks and runs.
- **The self-host auto-derivation makes the wrong answer *coherent*.** Because cwd's remote genuinely is the framework repo, `selfHost: true` is derived, `basePath` resolves to a real checkout, and a real token is minted. Nothing throws, nothing warns — the sweep does confident, well-formed work on the wrong repo.
- **The guard's only rule is a git/gh command string.** `extractGitGhCommand` (`checkGitGhGuard.ts:118-125`) inspects the first argument of a call for `/^(git|gh)(\s|$)/`. A composition of two typed TypeScript calls is invisible to it, and the file that *does* shell out (`bootstrapIdentity.ts`) is inside the structurally exempt package.

`prepareSweepBase`'s and the promotion defaults' internal `try/catch` fail-safes compound the silence: on a target repo with no local workspace they would return `null`/`[]` and no-op, so even the *correct* behaviour degrades quietly — which is why the fix needs explicit tests rather than a manual eyeball.

## Relevant Files
Use these files to fix the bug:

**Primary fix — the three sweep files that re-derive identity**
- `adws/triggers/perIssueScenarioSweep.ts` — `PerIssueSweepDeps` (`:44-52`), the shell `runPerIssueScenarioSweep` (`:146-213`) with its lazy `getBase()` memo (`:151-172`), and the cwd-derived `defaultGetMergedAt` (`:70-85`). Gains the required `gitContext`; loses the `getRepoInfo`/`gitContextForRepo` imports (`:15-16`).
- `adws/triggers/perIssueSweepPersist.ts` — **not named in the issue but essential.** `prepareSweepBase` (`:49-80`) is where four of the five per-issue defaults get their context (`getRepoInfo()` at `:51`, `gitContextForRepo` at `:52`), and where `repoInfo` is captured for `defaultFindPRByBranch`/`mergePR` (`:69,73`). Takes the context as a parameter.
- `adws/triggers/promotionSweepDefaults.ts` — all nine defaults (`:38-148`), each opening with `gitContextForRepo(getRepoInfo())`. Becomes a `makeDefaultDeps(ctx)` factory. `defaultFileIssue` (`:141-148`) also needs `repoInfo` for `applyLabel` → derive from `ctx.owner`/`ctx.repo`.
- `adws/triggers/promotionSweep.ts` — `PromotionSweepDeps` (`:55-67`), the shell's default wiring (`:239-262`), and the CLI entry guard (`:283-293`) which must become a real launch boundary. Also holds the stale "manual CLI, not yet wired into cron" docstring (`:2,27`).

**The call site that owns the launch context**
- `adws/triggers/trigger_cron.ts` — `cronGitContext` (`:69-77`), `runPromotionSweepTick` (`:126-146`), the per-issue dispatch (`:235-238`) and promotion dispatch (`:240-243`) inside `checkAndTrigger`, and the `evaluateCandidate` call (`:338`) whose `{ gitContext }` shape the new dispatches mirror.

**The guard and the sites that must comply with the new rule**
- `adws/checkGitGhGuard.ts` — the AST scanner. `scanFiles` (`:87-98`), `scanSource` (`:100-105`), `walkNode` (`:107-116`), `extractGitGhCommand` (`:118-125`), the `Violation` type (`:40`), and `main`'s stdout (`:131-153`). **The `scanned N files (0 allowlisted)` line at `:136-138` must keep its exact shape** — `@adw-695`/`@adw-696`/`@adw-697` scenarios and #700's stdout regex read it.
- `adws/github/githubApi.ts` — `getAuthenticatedUser` (`:56-69`); `:60` is `gitContextForRepo(getRepoInfo()).authenticatedUser()`, called out by the issue. `getRepoInfo` itself (`:18-20`) is the `readLocalRepoInfo` shim and stays.
- `adws/triggers/trigger_webhook.ts:93`, `adws/healthCheck.tsx:112`, `adws/checkLivingDocsIndex.ts:51` — three more `gitContextForRepo(readLocalRepoInfo(), { selfHost: true })` sites. Same class (cwd-derived identity feeding a construction), all three explicitly self-host, so `REPO_ROOT` is the correct source. They must be fixed or `bun run lint:git-guard` cannot pass with the new rule.

**Read-only reference (do not change)**
- `adws/core/launchGitContext.ts` — `buildLaunchGitContext` (`:78-101`): the sanctioned launch boundary; `targetRepo === null → selfHost`, else `basePath = join(targetReposDir, owner, repo)`. The one legal `getRepoInfo()` on this path.
- `adws/github/gitContextFactory.ts` — `gitContextForRepo` (`:109-121`) and the self-host auto-derivation (`:113-114`) that made the wrong answer coherent.
- `adws/gitContext/gitContext.ts` — `resolveBasePath` (`:89-93`), the `owner`/`repo`/`basePath` accessors (`:123-126`) used to derive `RepoInfo` from a context.
- `adws/gitContext/bootstrapIdentity.ts` — `readLocalRepoInfo` (`:38-51`), the cwd read at the bottom of the chain.
- `adws/core/config.ts:135,140` — `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` / `PROMOTION_SWEEP_INTERVAL_CYCLES`, both 4320 (≈24 h at the 20 s poll).
- `adws/core/orchestratorCli.ts:156` — `parseTargetRepoArgs`, needed by the `promotionSweep.ts` CLI launch boundary (re-exported from `adws/core/index.ts:67`, alongside `buildLaunchGitContext` at `:166`).
- `.adw/coding_guidelines.md` — files under 300 lines, guard clauses, isolate side effects at the edges, no `any`.
- `.adw/scenarios.md` — per-issue scenarios live in `features/per-issue/`, run by tag.

**Tests and scenarios that must be updated or re-proved**
- `adws/triggers/__tests__/perIssueScenarioSweep.test.ts` — 13 `runPerIssueScenarioSweep({…})` call sites (`:97-436`) each need `gitContext`; the `gitContextForRepo` module mock (`:13-15`) becomes a **never-called** assertion.
- `adws/triggers/__tests__/perIssueSweepPersist.test.ts` — every `prepareSweepBase()` call (`:156-199`) becomes `prepareSweepBase(ctx)`.
- `adws/__tests__/checkGitGhGuard.test.ts` — the fixture-string harness (71 lines) the new rule's tests extend.
- `features/per-issue/step_definitions/feature-740.steps.ts:237` and `feature-741.steps.ts:247` — both call `runPromotionSweep({…})` with every dep injected but no `gitContext`; both already hold a fixture `GitContext` (`makeFixtureCtx`, `feature-740.steps.ts:72-80`) to pass. **Required for `bunx tsc --noEmit` to pass** — the root `tsconfig.json` includes `**/*.ts`, so `features/` is type-checked.
- `features/per-issue/step_definitions/feature-745.steps.ts:22,78` — calls `runPromotionSweepTick(cycleCount, fakeSweep)`. The chosen seam shape keeps this **compiling and green unchanged**; verify, do not rewrite.
- `features/per-issue/feature-695.feature`, `feature-696.feature`, `feature-697.feature` — contain whole-repository guard runs ("The git/gh guard passes across the whole repository…"). These go RED the moment the new rule lands and must be GREEN again after the compliance fixes.

**Conditional documentation (from `.adw/conditional_docs.md`, matched conditions)**
- `app_docs/feature-vpb048-promotion-sweep-originate.md` — owns `promotionSweep.ts`, `promotionSweepDefaults.ts`, `runPromotionSweepTick`, `PROMOTION_SWEEP_INTERVAL_CYCLES`.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — owns `runPerIssueScenarioSweep`, `isScenarioStale`, `RETENTION_DAYS`.
- `app_docs/feature-oobdbg-bdd-cutover-polymorphic-prompts-sweep.md` — the 14-day per-issue retention sweep.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — `resolveBasePath`, construction-time identity validation, per-command env injection.
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — `buildLaunchGitContext`, `LaunchGitContextDeps`, `resolveLaunchToken`.
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — **owns `adws/checkGitGhGuard.ts`**, `scanFiles`/`scanSource`, and its unit tests.
- `app_docs/feature-f704s2-dev-server-janitor-cron.md` — adding/modifying cron probes in `trigger_cron.ts`.
- `app_docs/feature-tcewff-cron-gh-token-bleed-fix.md` — `checkAndTrigger()` auth identity.
- `specs/prd/git-context-repo-authority.md` — the PRD half this bug violates.

### New Files
- `features/per-issue/feature-769.feature` — **already authored** by the scenario-writer agent (13 scenarios, §1–§12 plus §T). Step 10 below implements against it; do not re-author it.
- `features/per-issue/step_definitions/feature-769.steps.ts` — its self-contained step definitions (the remaining deliverable).
- `adws/triggers/__tests__/promotionSweepDefaults.test.ts` — new unit suite for `makeDefaultDeps(ctx)` (there is no existing test file for this module).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Thread the context through the per-issue persist layer (`adws/triggers/perIssueSweepPersist.ts`)
- Change the signature to `export function prepareSweepBase(gitContext: GitContext): SweepBase | null`.
- Delete the `getRepoInfo` import and the `gitContextForRepo` import (`:13-14`); keep `mergePR`, `defaultFindPRByBranch`, and the `RepoInfo` type import.
- Inside, replace `:51-52` with `const ctx = gitContext;` and `const repoInfo: RepoInfo = { owner: ctx.owner, repo: ctx.repo };`. Everything downstream (`defaultBranch()`, `removeWorktree`, `createWorktreeForNewBranch`, `findOpenSweepPr`, `openPr`, `mergePr`) is unchanged — it already reads from `ctx`/`repoInfo`.
- Keep the whole body inside the existing `try` so a target repo with no local workspace still returns `null` with the existing warning, and keep `persistRemovalViaPr` and `cleanupSweepBase` unchanged (they already take `base`).
- Update the module docstring: the base is the *passed launch context's* repo, never cwd.

### 2. Thread the context into the per-issue sweep (`adws/triggers/perIssueScenarioSweep.ts`)
- Add `gitContext: GitContext;` as the **first, required** field of `PerIssueSweepDeps`, and make the parameter required: `runPerIssueScenarioSweep(deps: PerIssueSweepDeps)`. Import the type from `../gitContext`.
- Delete the `getRepoInfo` and `gitContextForRepo` imports (`:15-16`); keep `bodyLinksIssue` from `../github`.
- Curry the merge-date default: `function defaultGetMergedAt(ctx: GitContext, issueNum: number): Promise<Date | null>` — body identical except `ctx.fetchMergedPRs(200)` replaces `gitContextForRepo(repoInfo).fetchMergedPRs(200)` (`:72-76`). Wire it as `deps.getMergedAt ?? ((n: number) => defaultGetMergedAt(deps.gitContext, n))`.
- Change the memo to `if (cachedBase === undefined) cachedBase = prepareSweepBase(deps.gitContext);` — the laziness (created at most once, only when a base-dependent default actually runs, never for a fully-injected caller) and the `finally` teardown (`:210-212`) are preserved exactly.
- Leave `isScenarioStale`, `shouldSkipForPromotionState`, `RETENTION_DAYS`, and the decision loop untouched.
- Update the module docstring: identity comes from the injected launch context; this module performs no repo-identity resolution.

### 3. Convert the promotion defaults to a context-closing factory (`adws/triggers/promotionSweepDefaults.ts`)
- Delete the `getRepoInfo` and `gitContextForRepo` imports (`:17-18`); keep `applyLabel`.
- Export an interface for the produced deps (e.g. `PromotionSweepDefaultDeps`) and `export function makeDefaultDeps(ctx: GitContext): PromotionSweepDefaultDeps`, returning the nine helpers as closures over the single `ctx`:
  `listPerIssueFeatures`, `readFeatureContent`, `listStepDefSiblings`, `scenariosConfig`, `loadVocabulary(vocabPath)`, `loadStats`, `listPromotionIssues`, `tagAndCommit`, `fileIssue`.
- Each body is the existing body with its first line (`const ctx = gitContextForRepo(getRepoInfo());`) removed. Preserve every existing behaviour exactly:
  - the self-defending `try/catch → empty/null fallback` on the seven read helpers;
  - `tagAndCommit`'s deliberate no-throw **default-branch guard** (`:125-128`) with its `promotionSweep: checkout is not on default branch …` warning, and its scoped `addAndCommitPaths([filePath], …)` (never `git add -A`);
  - `tagAndCommit` and `fileIssue` still allowed to throw (the shell's per-candidate `try/catch` is what swallows).
- `fileIssue`: derive `const repoInfo = { owner: ctx.owner, repo: ctx.repo };` for `applyLabel`, keeping `extractIssueNumber(ctx.createIssue(...))` as-is.
- Keep `FEATURE_FILENAME_RE`, `ScenariosPaths`, and the path constants exported/defined as they are.
- Watch the 300-line guideline; the file shrinks, so no split is needed.

### 4. Require the context in the promotion sweep shell and make its CLI a launch boundary (`adws/triggers/promotionSweep.ts`)
- Add `gitContext: GitContext;` as the **first, required** field of `PromotionSweepDeps`; make the parameter required: `runPromotionSweep(deps: PromotionSweepDeps)`.
- Replace the nine `defaultX` imports with `makeDefaultDeps` (+ the `ScenariosPaths` type) and build them once at the top of the shell: `const defaults = makeDefaultDeps(deps.gitContext);`.
- Rewire each fallback to the factory result, preserving the existing `??` short-circuits so an injected dep still bypasses its default — notably `const scenariosConfig = deps.scenariosConfig ?? defaults.scenariosConfig();` and `const loadVocabulary = deps.loadVocabulary ?? (() => defaults.loadVocabulary(scenariosConfig.vocabPath));`.
- Leave `processCandidate`, `attemptOriginate`/`attemptRedrive`/`attemptTagWrite`, `SweepContext`, and the report accumulation untouched.
- Rewrite the CLI entry guard (`:283-293`) as a genuine launch boundary — it is the one place in this file allowed to resolve identity:
  ```ts
  const targetRepo = parseTargetRepoArgs(process.argv.slice(2));
  runPromotionSweep({ gitContext: buildLaunchGitContext(targetRepo) })
  ```
  importing both from `../core`. `bunx tsx adws/triggers/promotionSweep.ts` keeps working (self-host) and now also accepts `--target-repo owner/repo`.
- Correct the module docstring: it is no longer "manual CLI, not yet wired into cron" (it has been cron-dispatched since #745) and it now acts on the passed context's repo.

### 5. Dispatch both sweeps from the cron launch context (`adws/triggers/trigger_cron.ts`)
- Add two private thunk binders next to the tick functions:
  ```ts
  function boundPerIssueSweep(): (() => Promise<unknown>) | null {
    const ctx = cronGitContext;                    // local const so TS narrows inside the closure
    return ctx ? () => runPerIssueScenarioSweep({ gitContext: ctx }) : null;
  }
  function boundPromotionSweep(): (() => Promise<unknown>) | null { /* same shape, runPromotionSweep */ }
  ```
- Add `export async function runPerIssueScenarioSweepTick(cycleCount: number, sweep: (() => Promise<unknown>) | null = boundPerIssueSweep()): Promise<void>` that, in order: returns early off-cadence (`cycleCount % PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES !== 0`); logs `perIssueScenarioSweep: no launch GitContext available — skipping pass` at `warn` and returns when `sweep === null`; otherwise `await sweep()` inside a `try/catch` that logs at `error` and swallows. Document it exactly like `runPromotionSweepTick`'s existing docstring.
- Widen `runPromotionSweepTick`'s second parameter to `(() => Promise<unknown>) | null` with default `boundPromotionSweep()`, and add the same null-skip branch **before** the `try`. **Keep the parameter in position 2 and keep the cadence gate first** — this is what keeps `feature-745.steps.ts:78`'s `runPromotionSweepTick(cycleCount, fakeSweep)` compiling and its five scenarios green.
- In `checkAndTrigger`, replace the bare `if (cycleCount % PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES === 0) { await runPerIssueScenarioSweep(); }` block (`:235-238`) with `await runPerIssueScenarioSweepTick(cycleCount);` (the gate now lives inside the tick, and the per-issue sweep gains the call-site swallow it never had), and leave `await runPromotionSweepTick(cycleCount);` (`:243`) as-is.
- **The skip warning stays console-backed — add no logger seam.** Both ticks log through the module-level `log` (`adws/core/logger.ts:62`, which writes to `console.log`); do **not** add an injectable logger parameter to either tick. `@adw-769` §7/§8 assert `the skipped pass is reported in the cron log` by capturing stdout around the tick call, so no extra parameter is needed and adding one would widen the seam the scenario deliberately keeps at two arguments.
- Do **not** migrate `fetchOpenIssues` (`:82`) or `buildTargetRepoArgs` (`:98`) onto `cronGitContext` — explicitly out of scope per the issue.

### 6. Bring the four cwd-derived context constructions into compliance
Each is one line; all four are self-host by construction, so `REPO_ROOT` is the correct, explicit source and the change is behaviour-preserving wherever cwd was already the framework root (which `assertCwdIsRepoRoot` guarantees on the cron and webhook entry paths).
- `adws/github/githubApi.ts:60` → `gitContextForRepo(readLocalRepoInfo(REPO_ROOT)).authenticatedUser()`, importing `readLocalRepoInfo` (already imported at `:5`) and `REPO_ROOT` from `../core/environment`. This also makes the process-lifetime cache (`:48-54`) deterministic instead of dependent on whichever cwd happened to call it first. Add a one-line comment: the authenticated user is a process-level property, resolved against the framework repo's installation, never cwd.
- `adws/triggers/trigger_webhook.ts:93` → `gitContextForRepo(readLocalRepoInfo(REPO_ROOT), { selfHost: true })` (import `REPO_ROOT` from `../core`).
- `adws/healthCheck.tsx:112` → same substitution (import `REPO_ROOT` from `./core`).
- `adws/checkLivingDocsIndex.ts:51` → same substitution (import `REPO_ROOT` from `./core`).
- Do **not** touch the guarded-fallback sites (`repoInfo ?? getRepoInfo()`, `config.targetRepo ? … : getRepoInfo()`, `readLocalRepoInfo(cwd)` pass-throughs) — they are legal and the new rule must keep them legal.

### 7. Extend the git/gh guard with the cwd-derived-identity rule (`adws/checkGitGhGuard.ts`)
- Widen `Violation` to carry the rule that fired, e.g. `{ file: string; line: number; command: string; rule: 'git-gh-shellout' | 'cwd-derived-identity' }`, defaulting existing detections to `'git-gh-shellout'` so the existing tests' `command` assertions still hold.
- Make `scanSource` two-pass over the parsed `SourceFile`:
  1. **Collect** the names of identifiers bound to cwd-derived identity: any `VariableDeclaration` whose initializer is a `CallExpression` with callee `getRepoInfo` or `readLocalRepoInfo` **and zero arguments**. (File-scoped name set; a lint does not need block scoping.)
  2. **Flag** any `CallExpression` whose callee resolves to the identifier `gitContextForRepo` (bare or as a property access) and whose first argument is either (a) a zero-argument `getRepoInfo()`/`readLocalRepoInfo()` call, or (b) an `Identifier` in the collected set. Report `command` as a readable shape string, e.g. `gitContextForRepo(getRepoInfo())`.
- **The local-variable form (b) is mandatory**, not a nicety: `perIssueSweepPersist.ts:51-52`, `perIssueScenarioSweep.ts:72-76`, and `promotionSweepDefaults.ts:142-143` all use it. Without it the guard would not have caught the bug it exists to prevent.
- Do **not** flag: a bare `getRepoInfo()` that never reaches a construction; `getRepoInfo(cwd)`/`readLocalRepoInfo(REPO_ROOT)` with an argument; `repoInfo ?? getRepoInfo()` (a `BinaryExpression` initializer, so never collected); `gitContextForRepo(someParam)`.
- **Introduce no allowlist** — #701 deleted it deliberately. Step 6 leaves zero legitimate violations, and `@adw-769` §11 pins launch-boundary legality **by shape** (guarded-fallback identity feeding the boundary constructor), which is exactly what makes a path allowlist unnecessary.
- Extend `main`'s failure output to print the rule and a remedy line for the new class ("thread the launch-boundary GitContext instead of re-deriving identity from cwd"). **Leave `Git/GH CLI Guard — scanned ${scannedCount} files (0 allowlisted)` byte-identical** — `@adw-695`/`@adw-696`/`@adw-697` and #700's stdout regex depend on it.
- Keep the file's structure (I/O boundary → pure scan core → main) and stay under 300 lines; extract the collect/flag passes into named helpers rather than nesting.

### 8. Update and extend the unit tests
- `adws/triggers/__tests__/perIssueScenarioSweep.test.ts`: add a shared `fakeGitContext` (owner/repo/basePath + the methods used) and pass `gitContext: fakeCtx` in all 13 calls. Change the `gitContextForRepo` module mock from "returns a fake" to an **assertion that it is never called** in every test. Add: (i) the injected context is the one `prepareSweepBase` receives; (ii) `defaultGetMergedAt` calls `fetchMergedPRs` on the **injected** context; (iii) with a target-shaped context (`selfHost: false`, `basePath` under `targetReposDir`), no framework path is touched.
- `adws/triggers/__tests__/perIssueSweepPersist.test.ts`: pass the fake context to `prepareSweepBase(ctx)`; assert `getRepoInfo` is never called and that `repoInfo` handed to `defaultFindPRByBranch`/`mergePR` equals `{ owner: ctx.owner, repo: ctx.repo }`.
- New `adws/triggers/__tests__/promotionSweepDefaults.test.ts`: `makeDefaultDeps(ctx)` constructs **zero** contexts (assert the mocked `gitContextForRepo` is never called), all nine helpers use the passed `ctx`, each read helper degrades to its empty/null fallback on a throwing `ctx`, `tagAndCommit` no-ops with the warning when `getCurrentBranch !== defaultBranch()`, and `fileIssue` labels via `{owner, repo}` taken from `ctx`.
- New tests in `adws/triggers/__tests__/trigger_cron.test.ts` for both tick seams: dispatched exactly once on-cadence with a non-null thunk; not dispatched off-cadence; **not dispatched and warn-logged when the thunk is `null`** (the no-launch-context skip); a throwing sweep is swallowed and the tick resolves.
- `adws/__tests__/checkGitGhGuard.test.ts`: add fixture-string cases — inline composite → 1 violation; local-variable composite (`const info = getRepoInfo(); … gitContextForRepo(info)`) → 1 violation; `readLocalRepoInfo()` composite → 1 violation; `gitContextForRepo(readLocalRepoInfo(REPO_ROOT))` → 0; `const r = repoInfo ?? getRepoInfo(); gitContextForRepo(r)` → 0; `gitContextForRepo(repoInfoParam)` → 0; a bare `getRepoInfo()` never fed to a construction → 0. Keep the existing five tests passing unchanged.

### 9. Update the two BDD step-def files coupled to the new required field
- `features/per-issue/step_definitions/feature-740.steps.ts:237` and `feature-741.steps.ts:247`: add `gitContext: gitCtx,` to the `runPromotionSweep({…})` deps object, reusing the fixture context each file already builds via `makeFixtureCtx(ctx.workdir)`. Both files inject **every** dep, so the added field is inert at runtime — this is a type-level requirement (`bunx tsc --noEmit` covers `features/`), and the scenarios' semantics are unchanged.
- Do **not** modify `feature-745.steps.ts`; confirm it still compiles and that `@adw-745`'s five scenarios pass unchanged.

### 10. Implement the step definitions for the authored `@adw-769` BDD scenario
`features/per-issue/feature-769.feature` is **already authored** — 13 scenarios in §1–§12 plus §T. Add only `features/per-issue/step_definitions/feature-769.steps.ts`, self-contained (own module-private `ctx` and `After({ tags: '@adw-769' })` hook), reusing only the registered `the ADW codebase is checked out` (G18) and `the ADW TypeScript type-check passes` (T22). Assert on injected-seam recordings, real fixture-repo artefacts, and the guard's verdict — **never** by reading `trigger_cron.ts`/`promotionSweep.ts`/`checkGitGhGuard.ts` as text.

What each authored section drives:
1. **§1 A target-repo cron sweeps its own target** — the real `runPerIssueScenarioSweep({ gitContext, persistRemoval })` against a target-shaped recording context; the target fixture's stale scenario (#611) is the one removed.
2. **§2 The framework repo is untouched** (the issue's AC7 cross-repo scenario, and the headline) — the same drive; the framework fixture still tracks its equally-stale #612 and its branch tip is unmoved, even though it is the process working directory.
3. **§3 Every repository operation goes through the injected context** — recorded operations on the injected context cover the pass, including the per-candidate merged-PR lookup, and none is issued outside it. This is the observable form of AC1 + AC5.
4. **§4 The promotion sweep scores the target's candidates** — the real `runPromotionSweep({ gitContext, fileIssue })`; the returned `PromotionSweepReport` names the target's #611 and no framework path.
5. **§5 The promotion sweep queries and writes only through the launch context** — the reconciliation query is recorded on the injected context, no issue is filed in the framework repo, and the framework fixture carries no commit from the pass.
6. **§6 Self-host is not a regression** — the same drive with a self-host-shaped context (`selfHost: true`, `frameworkRepoRoot` = the framework fixture) still sweeps that fixture.
7. **§7 / §8 No launch context ⇒ skip, not fall back** — one scenario per probe: drive the exported tick with `null` in the **sweep position** on a cadence-eligible cycle; the sweep is never invoked, neither fixture is touched, the skip line appears on captured stdout, and nothing throws.
8. **§9 / §10 / §11 The guard rule fires, and does not over-fire** — write each DocString to `<tmpRoot>/<path>` and call the exported `scanFiles([relPath], tmpRoot)`, asserting on the returned violations (the per-file pattern from `@adw-695`/`@adw-696`/`@adw-699`, with a throwaway fixture source so the scenario cannot rot when production files move). `scanFiles` applies **no path exemption**, so §11's launch boundary stays legal **by shape** — a guarded-fallback identity feeding the boundary constructor (`new GitContext(...)`, the real `launchGitContext.ts:87-98` shape) — not by an allowlist. That is consistent with step 7, which adds none.
9. **§12 Whole-repository ratchet** — spawn `bunx tsx adws/checkGitGhGuard.ts` and assert its exit status only.
10. **§T Type-check backstop (T22)** — the ADW type-check passes with the required `gitContext` threaded through both sweeps, both tick seams, and the updated #740/#741 step defs.

Harness contract (from the feature file's step-definition note; every claim below verified against this worktree):
- **Two-checkout fixture world.** The target checkout at `<tmp>/adw-fixture/target-fixture`, so a context with `targetReposDir: <tmp>`, `owner: 'adw-fixture'`, `repo: 'target-fixture'`, `selfHost: false` resolves `basePath` to it through production's own `resolveBasePath` — no monkey-patching. The framework checkout in a separate temp dir. Seed each with `features/per-issue/feature-{N}.feature` plus its step-def sibling, committed, with a real bare `origin` (feature-758's construction; `GitContext` built directly from `GitContextOptions` as in `feature-740.steps.ts:64-80`).
- **The framework fixture's remote must name a fictitious `owner/repo`** (e.g. `adw-fixture/framework-fixture`), and `the cron process is working from the framework repository checkout` does `process.chdir` into it (original cwd restored in `After`). This is what makes the pre-fix RED both meaningful and harmless: the unfixed code derives that identity from cwd, token minting for a repo with no installation throws, every default degrades to `[]`/`null`, and the unfixed pass sweeps nothing — while being structurally unable to reach the real `paysdoc/AI_Dev_Workflow` checkout or make a network call. A real `owner/repo` here would point the unfixed `prepareSweepBase` at a real checkout and create a `chore/scenario-sweep` worktree in it.
- **The injected context is a recording subclass** (the `InjectablePushGitContext` precedent, `feature-758.steps.ts:73`): it records every operation asked of it — at minimum `lsFiles`, `fetchMergedPRs`, `listOpenIssues`, `createIssue`, `defaultBranch` — and overrides **only** the gh-backed seams: `defaultBranch()` → the fixture's branch, `fetchMergedPRs()` → canned JSON linking the seeded issue at the seeded merge date, `listOpenIssues()` → `[]`. Every git operation stays real, so GREEN comes from the threaded production code, never a hand-mirrored stand-in.
- **Inject only the seams that reach gh through free functions**: `persistRemoval` (per-issue — `defaultFindPRByBranch`/`mergePR`) and `fileIssue` (promotion — `applyLabel`). Do **not** inject `listFeatures`, `readFeatureContent`, `getMergedAt`, `listPerIssueFeatures`, `listStepDefSiblings`, `scenariosConfig`, `loadVocabulary`, `loadStats`, `listPromotionIssues` or `tagAndCommit`. Those defaults *are* the retargeting bug; each reaches git/gh only through `ctx` (`promotionSweepDefaults.ts:88-132` — `logSince`, `listOpenIssues`, `defaultBranch`/`addAndCommitPaths`/`pushBranch`), so the recording subclass already intercepts them, and injecting them would make §3/§4/§5 vacuous — §5 in particular asserts that the reconciliation query went through the injected context, which requires `listPromotionIssues` to fall through.
- **`features/` is guard-exempt** (`checkGitGhGuard.ts:24-28`, `EXEMPT_DIR_NAMES`), so neither the new step-def file nor the fixture DocStrings can affect §12.

### 11. Correct the stale documentation
- `README.md:28` — drop "(manual CLI today, not yet wired into cron)"; state that the sweep is cron-dispatched via `runPromotionSweepTick` (`trigger_cron.ts:243`) on the `PROMOTION_SWEEP_INTERVAL_CYCLES` cadence and acts on the repo of the cron's launch `GitContext`.
- `README.md:328` — same correction in the promotion-sweep section prose.
- `README.md:861` — the `promotionSweep.ts` tree comment: replace "manual CLI, not yet wired into cron" with the cron-dispatch fact.
- `README.md:850-851,862` — note in the `perIssueScenarioSweep.ts` / `perIssueSweepPersist.ts` / `promotionSweepDefaults.ts` comments that they take the cron's launch `GitContext` and perform no identity resolution.
- **The issue's `adws/README.md` acceptance item is unfounded** — verified: `adws/README.md` contains no occurrence of "sweep", "promotion", or "perIssue", so it carries no stale claim to correct. Leave it unchanged and record this in the PR description rather than inventing an edit.
- The `app_docs/` conditional-doc updates (`feature-vpb048-…`, `feature-bq1f45-…`) are the document phase's job; do not hand-edit them here.

### 12. Run the Validation Commands
Execute every command in the `Validation Commands` section, in order, and confirm each exits clean.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Commands are the project-specific ones from `.adw/commands.md`.

**Reproduce first (RED — before the fix):**
- `grep -rn "gitContextForRepo(getRepoInfo())" adws --include='*.ts' | grep -v __tests__` → 9 hits (8 in `promotionSweepDefaults.ts`, 1 in `githubApi.ts:60`), plus `grep -n "getRepoInfo()" adws/triggers/perIssueScenarioSweep.ts adws/triggers/perIssueSweepPersist.ts` → the two local-variable composites. **After the fix: zero hits in all three sweep files.**
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-769"` → **RED before the fix**: §1–§6 fail because the sweeps ignore the passed `gitContext` and re-derive identity from cwd (the framework fixture's fictitious remote makes every default degrade to `[]`/`null`, so nothing is swept and the report is empty); §7/§8 fail because `runPerIssueScenarioSweepTick` does not exist and the promotion tick has no null-skip branch; §9 fails because the guard has no such rule. §10, §11, §12 and §T are the non-fire/ratchet guards and pass both before and after. **All GREEN after.**
- `bun run lint:git-guard` → **fails after step 7 and before step 6/1-4 land**, listing the cwd-derived-identity violations in `perIssueScenarioSweep.ts`, `perIssueSweepPersist.ts`, `promotionSweepDefaults.ts`, `githubApi.ts`, `trigger_webhook.ts`, `healthCheck.tsx`, `checkLivingDocsIndex.ts`. **Passes once every one is threaded or made explicit.**

**Prove the fix (GREEN — all must pass):**
- `bun run lint` — ESLint passes (no unused `getRepoInfo`/`gitContextForRepo` imports left behind).
- `bunx tsc --noEmit` — root type-check passes, covering `features/**` (this is what forces the #740/#741 step-def updates).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes (required `gitContext`, `makeDefaultDeps`, `prepareSweepBase(ctx)`, both tick seams).
- `bun run test:unit` — all unit tests pass, including the rewritten per-issue and persist suites, the new `promotionSweepDefaults` suite, the new tick-seam tests, and the extended guard tests. The `isScenarioStale` truth table and every fully-injected test stay green.
- `bun run lint:git-guard` — the guard passes across the whole repository, with the `scanned N files (0 allowlisted)` line unchanged.
- `bun run build` — `tsc` build succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-769"` — the new regression scenario is green.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-745"` — cadence gate + call-site swallow still green **with `feature-745.steps.ts` unmodified** (proves the seam stayed source-compatible).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-740"` and `--tags "@adw-741"` — originate and reconcile lifecycles still green with the required `gitContext` threaded in.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-739"` — the promotion-aware TTL sweep still green (promotion exemption preserved).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-758"` — the sweep origin-sync/PR-persist contract still green (the persist path only changed where its context comes from).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-695"`, `--tags "@adw-696"`, `--tags "@adw-697"` — the whole-repository guard scenarios green again after the compliance fixes.

## Notes
- **Coding guidelines.** `.adw/coding_guidelines.md` applies: keep every touched file under 300 lines (all shrink), use guard clauses over nesting (the tick seams are three early returns then one `try`), keep side effects at the edges (the sweeps' pure decision cores stay untouched), no `any`, and remove now-unused imports.
- **No new libraries.** The fix is pure rewiring plus one TypeScript-compiler-API rule in the existing guard (`typescript` is already a devDependency and already imported by `checkGitGhGuard.ts`).
- **Why `gitContext` is required, not optional.** An optional field with a cwd default would preserve exactly the bug. Required-with-no-default is what makes the wrong call impossible to write; the compiler, not review discipline, becomes the enforcement.
- **Why the tick seam keeps `sweep` in position 2.** Putting the context in position 2 would break `feature-745.steps.ts:79` (`runPromotionSweepTick(cycleCount, fakeSweep)`) and force a rewrite of five passing regression scenarios the issue does not ask to change. A nullable bound thunk satisfies every acceptance criterion (skip-not-fallback is drivable by passing `null`) at zero churn. `@adw-769`'s step-definition note was aligned to this shape during plan/scenario alignment — it originally described "a context parameter" — and its Gherkin is seam-agnostic either way.
- **Why the guard rule needs no allowlist.** Re-adding a path allowlist would regress #701 (which deleted it) and #700 §4b (whose stdout regex asserts `0 allowlisted`). Step 6 removes all four legitimate violations by making self-host identity explicit (`REPO_ROOT`) rather than exempting them.
- **`getAuthenticatedUser` behaviour note.** Today the login it caches depends on whichever cwd first called it; pinning it to `REPO_ROOT` makes it deterministic. With a GitHub App the login is `<app-slug>[bot]` for every installation, and with a PAT it is the same user, so `prCommentDetector`'s author comparison is unaffected. The alternative — threading a `RepoInfo` through `getAuthenticatedUser` → `prCommentDetector` → its callers — is a larger refactor and is not warranted here.
- **Post-fix operational reality for target repos.** Once the context is threaded, a target repo's sweep acts on `$TARGET_REPOS_DIR/<owner>/<repo>`. If that workspace is not cloned yet, `prepareSweepBase` returns `null` and the promotion defaults degrade to `[]`/`null` — the pass no-ops with a warning instead of silently sweeping the wrong repo. That is the correct behaviour and needs no extra code, but it means "the sweep now runs" will show up as clean no-ops on repos ADW has not yet cloned.
- **Out of scope (per the issue).** The `hitl`/promotion lifecycle semantics; migrating `fetchOpenIssues` and the other `gitContextForRepo(cronRepoInfo)` cron call sites onto `cronGitContext`; retroactively sweeping never-swept target repos; clearing this repo's accumulated stale per-issue files (an operator action — on this host `TARGET_REPOS_DIR=/Users/martin/projects`, so `paysdoc/AI_Dev_Workflow`'s target base path *is* `REPO_ROOT` and the self-host/target distinction collapses for this one repo).
- **Deploy note.** The running cron processes must be restarted after this merges — a long-lived cron holds the module it loaded at startup. This is the same class of staleness that made the 2026-07-29 log report a code path that no longer exists (see the second verified correction above).
