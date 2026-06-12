# Bug: Cron GH_TOKEN bleed — pause-queue resume pins app auth to the wrong repo, blinding the poller

## Metadata
issueNumber: `565`
adwId: `tcewff-cron-gh-token-bleed`
issueJson: `{"number":565,"title":"Cron GH_TOKEN bleed: pause-queue resume pins app auth to wrong repo, blinding the poller","body":"## Summary\n\nThe cron poller authenticates via the GitHub App using a **process-global `process.env.GH_TOKEN`** plus a module-level `activeRepo` in `adws/github/githubAppAuth.ts`. These are shared across every repo a single cron process touches (its `--target-repo`, plus the framework's own `paysdoc/AI_Dev_Workflow`). When the **pause-queue resume path** runs, it activates app auth for the wrong repo and permanently pins the global token there, blinding the poller to its actual target repo until the process is restarted.\n\n## Confirmed incident (2026-06-11)\n\n`vestmatic/vestmatic` issue #143 reached `awaiting_merge` (PR #150, gate open — no `hitl`, `MERGEABLE`/`CLEAN`) but was never auto-merged.\n\nCron log transition (UTC):\n\n16:52:44  Pause queue scan: 1 paused workflow(s)\n16:52:48  Rate limit cleared — resuming workflow … for #143\n16:52:48  GitHub App authentication activated for paysdoc/AI_Dev_Workflow   <-- GH_TOKEN pinned to wrong repo\n16:52:50  Failed to post resumed comment for #143: Remote owner \"vestmatic\" !== declared owner \"paysdoc\"\n16:52:51  Failed to fetch issues … GraphQL: Could not resolve to a Repository 'vestmatic/vestmatic'\n\n## Root cause\n\n`activateGitHubAppAuth(owner?, repo?)` falls back to `git remote get-url origin` in the cron's cwd when no repo is passed — that resolves to `paysdoc/AI_Dev_Workflow`. The pause/resume path invokes it without the target repo, so it pins `GH_TOKEN`/`activeRepo` to the framework repo. The periodic token refresh only refreshes the *active* repo, so it never self-heals.\n\n## Proposed fix\n\n- Make the pause-queue resume path pass the **target** repo explicitly to `activateGitHubAppAuth`/`ensureAppAuthForRepo`, never relying on the local-git-remote fallback.\n- Re-assert `ensureAppAuthForRepo(targetOwner, targetRepo)` at the top of each cron poll batch so a stray activation for another repo can't persist across ticks.\n- Consider eliminating the process-global `GH_TOKEN` reliance for multi-repo crons (scope auth per operation/repo) so cross-repo token bleed is structurally impossible.\n\nThis issue tracks the durable code fix only.\n\n## Blocked by\n\n- #566\n","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-06-11T21:46:56Z","comments":[],"actionableComment":null}`

## Bug Description

A single cron poller process (`adws/triggers/trigger_cron.ts`) is launched per target repo with `--target-repo owner/repo`. It authenticates to GitHub via the GitHub App. The app credential lives in a **process-global `process.env.GH_TOKEN`** plus a **module-level `activeRepo`** inside `adws/github/githubAppAuth.ts` — a single shared identity for the whole process.

On every Nth poll cycle the cron runs `scanPauseQueue()` (in `adws/triggers/pauseQueueScanner.ts`) to probe rate-limited workflows and resume them. The resume path, `resumeWorkflow(entry)`, calls:

```ts
const repoInfo = getRepoInfo();                        // pauseQueueScanner.ts:100
activateGitHubAppAuth(repoInfo.owner, repoInfo.repo);  // pauseQueueScanner.ts:101
```

`getRepoInfo()` (with no `cwd` argument) resolves the git remote of `process.cwd()`. The cron always runs from `REPO_ROOT` — the framework checkout `paysdoc/AI_Dev_Workflow` (it calls `assertCwdIsRepoRoot()` and pins every spawn's `cwd` to `REPO_ROOT`). So `getRepoInfo()` returns **`paysdoc/AI_Dev_Workflow`, not the cron's `--target-repo`**. `activateGitHubAppAuth` then pins the process-global `GH_TOKEN`/`activeRepo` to the framework repo.

**Expected behavior:** Resuming a paused workflow leaves the cron's GitHub App auth pointed at its declared target repo, so the next poll batch continues to see that repo's open issues and dispatches `adwMerge` for `awaiting_merge` issues.

**Actual behavior:** After the first resume, `GH_TOKEN` is pinned to `paysdoc/AI_Dev_Workflow`. The framework's installation token has no access to the (private) target repo, so every subsequent `gh --repo <target>` returns `GraphQL: Could not resolve to a Repository`. `fetchOpenIssues()` logs `POLL: 0 open` on every tick, `adwMerge` is never dispatched, and the entire target repo goes invisible until the cron process is restarted. The periodic refresh (`refreshTokenIfNeeded()` with no args) only refreshes the *active* (now-wrong) repo, so the process never self-heals.

The same wrong `repoInfo` also corrupts two adjacent operations in `resumeWorkflow`:
- `acquireIssueSpawnLock(repoInfo, …)` — namespaces the per-issue spawn lock under the wrong repo.
- `createRepoContext({ repoId: { owner: repoInfo.owner, … }, cwd: entry.worktreePath })` — the worktree's real remote is the target repo, but the declared owner is `paysdoc`, so `validateGitRemote` throws `Remote owner "X" !== declared owner "Y"` → the `Failed to post resumed comment` log line (the tell-tale signature).

## Problem Statement

The pause-queue resume path determines "which repo am I operating on" from the cron process's current working directory instead of from the paused workflow's own target repo. Because the cwd is always the framework checkout, every resume mis-activates the process-global GitHub App token for `paysdoc/AI_Dev_Workflow`, permanently blinding a target-repo poller to its own repo. There is also no per-tick safeguard that re-asserts the cron's intended auth identity, so a single stray activation persists indefinitely.

## Solution Statement

Two surgical, complementary changes:

1. **Primary fix — resolve the target repo from the paused entry, not from cwd (`pauseQueueScanner.ts`).** Each `PausedWorkflow` already persists its target as `extraArgs: ['--target-repo', 'owner/repo']` (written in `workflowCompletion.ts`), and that is exactly the repo the orchestrator is respawned with. Add a small helper `resolveEntryRepoInfo(entry)` that parses `--target-repo` out of `entry.extraArgs` via the existing pure `parseTargetRepoArgs(...)`, returning `{ owner, repo }`; fall back to `getRepoInfo()` only when the entry carries no target repo (a framework self-hosting workflow, where the cwd remote *is* the correct repo). Use this resolved repo for `activateGitHubAppAuth`, the spawn lock, and the repo contexts in `resumeWorkflow`, and for the error-comment branch in `scanPauseQueue`.

2. **Defense-in-depth — re-assert the cron's target-repo auth before each poll batch (`trigger_cron.ts`).** At the top of the poll work in `checkAndTrigger()`, after the pause/auth queue scans and immediately before `fetchOpenIssues()`, call `ensureAppAuthForRepo(cronRepoInfo.owner, cronRepoInfo.repo)`. `ensureAppAuthForRepo` is cheap when the active repo already matches (it just refreshes a cached token) and re-activates only when the active repo has drifted — so even if some resume path (this one, the auth-queue path, or a future one) mutates the global token to another repo, the poller's identity is restored every tick before any `gh` poll call. This is a no-op when the GitHub App is not configured, preserving the local-`gh`-auth dev path.

The process-global-`GH_TOKEN` elimination listed third in the issue's "Proposed fix" is a broad structural refactor across many call sites and is intentionally **out of scope** for this surgical bugfix; it is recorded as a follow-up in Notes.

## Steps to Reproduce

Operationally (the confirmed 2026-06-11 incident):
1. Run a cron poller against a private target repo: `bunx tsx adws/triggers/trigger_cron.ts --target-repo vestmatic/vestmatic` from the `paysdoc/AI_Dev_Workflow` checkout, with the GitHub App configured.
2. Let one workflow hit a rate-limit pause so it lands in `agents/paused_queue.json` (its `extraArgs` = `['--target-repo', 'vestmatic/vestmatic']`).
3. When the rate limit clears, the next `scanPauseQueue` tick resumes it. Observe the log: `GitHub App authentication activated for paysdoc/AI_Dev_Workflow`, then `Failed to post resumed comment … Remote owner "vestmatic" !== declared owner "paysdoc"`, then `Could not resolve to a Repository 'vestmatic/vestmatic'`.
4. Every subsequent tick logs `POLL: 0 open`; `awaiting_merge` issues are never merged until the cron is restarted.

Deterministically (unit-level, the regression test added by this plan):
1. In `adws/triggers/__tests__/pauseQueueScanner.test.ts`, `getRepoInfo` is mocked to return `{ owner: 'test-owner', repo: 'test-repo' }` (stands in for the framework cwd remote) and `makeEntry()` carries `extraArgs: ['--target-repo', 'owner/repo']` (the real target).
2. Call `resumeWorkflow(makeEntry())`. On the **current** code, `activateGitHubAppAuth` is invoked with `('test-owner', 'test-repo')` — the bleed. After the fix it is invoked with `('owner', 'repo')` — the target.

## Root Cause Analysis

`activateGitHubAppAuth(owner?, repo?)` and `getRepoInfo(cwd?)` both fall back to `git remote get-url origin` against the process's cwd when not given an explicit repo. The cron's cwd is, by deliberate design, always the framework checkout `REPO_ROOT` (so it can find the `adws/` scripts). The pause-queue resume path resolves its operating repo with bare `getRepoInfo()`, so it always resolves to `paysdoc/AI_Dev_Workflow` regardless of which target repo the paused workflow belongs to.

Because the resolved repo is then handed to `activateGitHubAppAuth`, the resume **writes** the wrong identity into the process-global `GH_TOKEN`/`activeRepo`. Nothing later in the process re-asserts the cron's intended `--target-repo` identity: `refreshTokenIfNeeded()` (called each interval with no args) only refreshes whatever `activeRepo` currently is, faithfully keeping the *wrong* token fresh. The result is a sticky, self-perpetuating misconfiguration that only a process restart clears.

The authoritative source of truth for a paused workflow's repo is the entry's own `extraArgs` (persisted precisely so the respawned orchestrator targets the correct repo). The bug is that the resume path ignores that source and asks the filesystem cwd instead. The fix realigns the resume path with the entry's persisted target and adds a per-tick re-assertion so the poller's identity cannot be left corrupted.

## Relevant Files

Use these files to fix the bug:

- `adws/triggers/pauseQueueScanner.ts` — **Primary fix site.** `resumeWorkflow()` (line ~100) and the `scanPauseQueue()` error branch (line ~255) call bare `getRepoInfo()`, mis-resolving the repo. Add `resolveEntryRepoInfo(entry)` and use it for auth activation, the spawn lock, and the repo contexts.
- `adws/triggers/trigger_cron.ts` — **Defense-in-depth site.** `checkAndTrigger()` polls without re-asserting target-repo auth. Add an `ensureAppAuthForRepo(cronRepoInfo.owner, cronRepoInfo.repo)` call before `fetchOpenIssues()`, and import it from `../github`.
- `adws/github/githubAppAuth.ts` — Defines the process-global `GH_TOKEN`/`activeRepo`, `activateGitHubAppAuth()`, `ensureAppAuthForRepo()`, and `refreshTokenIfNeeded()`. No change required, but it is the locus of the global state and the contract the fix relies on (`ensureAppAuthForRepo` re-activates on repo drift, refreshes when matched). Read to confirm semantics.
- `adws/core/pauseQueue.ts` — Defines `PausedWorkflow` (note `extraArgs?: string[]`, the persisted `--target-repo`). No change; confirms the authoritative target-repo source.
- `adws/phases/workflowCompletion.ts` — Shows where `extraArgs` is written (`['--target-repo', '${owner}/${repo}']`, line ~105), confirming a target-repo workflow always carries it and a framework workflow never does (justifies the `getRepoInfo()` fallback).
- `adws/core/orchestratorCli.ts` — Source of `parseTargetRepoArgs(args)` (re-exported from `adws/core`). Pure parser the helper reuses; note it **mutates** its argument array, so pass a copy.
- `adws/github/githubApi.ts` — `getRepoInfo(cwd?)` and the re-exported `RepoInfo` type. Confirms the cwd fallback that causes the bleed.
- `adws/providers/repoContext.ts` — `createRepoContext()` → `validateGitRemote()` throws `Remote owner … !== declared owner …` when the declared repo disagrees with the worktree remote; this is the tell-tale signature the fix removes.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts` — **Test changes required.** Existing `acquireIssueSpawnLock` assertion (lines ~229–233) expects `test-owner/test-repo` and must be updated to the target `owner/repo`; add `parseTargetRepoArgs` to the `../../core` mock; add new assertions on `activateGitHubAppAuth`.
- `adws/triggers/__tests__/trigger_cron.test.ts` — Add `ensureAppAuthForRepo: vi.fn()` to the `../../github` mock so the new import resolves under test.
- `app_docs/feature-ope038-pause-queue-resume-spawn-hardening.md` — Conditional doc: directly governs `pauseQueueScanner.ts` / `resumeWorkflow()` spawn options and side-effect ordering. Read before editing the resume path.
- `app_docs/feature-bzlaaq-resume-verify-canonical-claim.md` — Conditional doc: governs the per-issue spawn-lock / canonical-claim interaction in `resumeWorkflow()`; the lock is now namespaced under the corrected repo, so honor this contract.
- `app_docs/feature-chpy1a-generic-pipeline-runner-pause-resume.md` — Conditional doc: background on the pause/resume mechanics and the `pauseQueueScanner` cron probe loop.

### New Files
- `features/per-issue/feature-565.feature` — Per-issue BDD scenario (tag `@adw-565`) asserting that resuming a paused, target-repo workflow activates GitHub App auth for the **target** repo (and never re-pins to the framework repo). See Notes re: known vocabulary gaps for cron-internal auth state; if no existing step phrases cover GitHub-App-auth activation assertions, this scenario documents the contract and the unit tests carry the executable regression proof.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the governing conditional docs
- Read `app_docs/feature-ope038-pause-queue-resume-spawn-hardening.md`, `app_docs/feature-bzlaaq-resume-verify-canonical-claim.md`, and `app_docs/feature-chpy1a-generic-pipeline-runner-pause-resume.md` to honor the existing resume-path and spawn-lock contracts before editing.
- Re-read `.adw/coding_guidelines.md`: immutability (don't mutate `entry.extraArgs`), guard clauses, single responsibility, isolate side effects, no `any`.

### 2. Add `resolveEntryRepoInfo` and fix the resume path in `adws/triggers/pauseQueueScanner.ts`
- Extend the existing `../core` import (line ~14) to also import `parseTargetRepoArgs`.
- Extend the existing `../github` import (line ~21) to also import the `RepoInfo` type: `import { getRepoInfo, activateGitHubAppAuth, type RepoInfo } from '../github';`.
- Add a small pure helper (place it after the constants / `containsRateLimitText`, before `resumeWorkflow`):
  ```ts
  /**
   * Resolves the target repo for a paused entry from its persisted `--target-repo`
   * extraArgs — the same repo the orchestrator is respawned with. Falls back to the
   * cron's local git remote ONLY when the entry has no target repo (a framework
   * self-hosting workflow, where cwd's remote IS the correct repo). This stops the
   * resume path from pinning the process-global GH_TOKEN to the cron host's own repo
   * (issue #565).
   */
  function resolveEntryRepoInfo(entry: PausedWorkflow): RepoInfo {
    const targetRepo = parseTargetRepoArgs([...(entry.extraArgs ?? [])]);
    if (targetRepo) {
      return { owner: targetRepo.owner, repo: targetRepo.repo };
    }
    return getRepoInfo();
  }
  ```
  (Pass a **copy** of `extraArgs` because `parseTargetRepoArgs` splices its argument.)
- In `resumeWorkflow`, replace `const repoInfo = getRepoInfo();` (line ~100) with `const repoInfo = resolveEntryRepoInfo(entry);`. Leave the following `activateGitHubAppAuth(repoInfo.owner, repoInfo.repo)` and all downstream uses of `repoInfo` (spawn lock, the three `createRepoContext` calls) unchanged — they now receive the correct repo.
- In `scanPauseQueue`, in the `MAX_UNKNOWN_PROBE_FAILURES` error branch, replace `const repoInfo = getRepoInfo();` (line ~255) with `const repoInfo = resolveEntryRepoInfo(entry);` so the abandonment error comment posts to the correct repo (`entry` is in scope inside the loop).

### 3. Re-assert target-repo auth per poll batch in `adws/triggers/trigger_cron.ts`
- Extend the existing `../github` import (line ~15) to also import `ensureAppAuthForRepo`.
- In `checkAndTrigger()`, immediately before `const issues = fetchOpenIssues();` (line ~210), add:
  ```ts
  // Re-assert app auth for THIS cron's target repo before polling. A pause-queue or
  // auth-queue resume earlier in this tick may have activated auth for another repo
  // and pinned the process-global GH_TOKEN there; without this re-assertion a stray
  // activation blinds the poller until the process is restarted (issue #565).
  ensureAppAuthForRepo(cronRepoInfo.owner, cronRepoInfo.repo);
  ```
- Do not change `scanAuthQueue` — it already receives and uses `cronRepoInfo` and does not activate app auth itself; the new re-assertion covers any token it might disturb.

### 4. Update and extend `adws/triggers/__tests__/pauseQueueScanner.test.ts`
- Add `parseTargetRepoArgs` to the `vi.mock('../../core', …)` factory so the new source import resolves. Provide a tiny faithful implementation:
  ```ts
  parseTargetRepoArgs: (args: string[]) => {
    const i = args.indexOf('--target-repo');
    if (i === -1 || !args[i + 1]) return null;
    const [owner, repo] = args[i + 1].split('/');
    return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
  },
  ```
- Import the mocked auth fn into scope (after the mocks): `import { activateGitHubAppAuth } from '../../github';`.
- **Update** the existing assertion in `resume with matching claim proceeds to spawn …` (lines ~229–233): with the default entry's `extraArgs: ['--target-repo', 'owner/repo']`, `acquireIssueSpawnLock` is now called with `{ owner: 'owner', repo: 'repo' }` (not `test-owner/test-repo`). Change the `expect.objectContaining` accordingly.
- **Add** a test: resume of an entry with `extraArgs: ['--target-repo', 'owner/repo']` calls `activateGitHubAppAuth` with `('owner', 'repo')` — the regression guard proving auth is activated for the target, not the framework cwd.
- **Add** a fallback test: resume of an entry with `extraArgs: undefined` calls `activateGitHubAppAuth` with `('test-owner', 'test-repo')` (the `getRepoInfo()` fallback) and `acquireIssueSpawnLock` with `{ owner: 'test-owner', repo: 'test-repo' }` — proving framework self-hosting workflows are unaffected.

### 5. Keep `adws/triggers/__tests__/trigger_cron.test.ts` importable
- Add `ensureAppAuthForRepo: vi.fn()` to the `vi.mock('../../github', …)` factory so the new import in `trigger_cron.ts` resolves under test (the existing suite imports `trigger_cron` for `runHungDetectorSweep`).

### 6. Add the per-issue BDD scenario `features/per-issue/feature-565.feature`
- Tag it `@adw-565`. Express the contract: given a paused workflow for a target repo distinct from the framework repo, when the pause-queue resume runs and the rate limit is clear, then GitHub App auth is activated for the target repo (never the framework repo) and the poller continues to see the target repo.
- If existing step vocabulary cannot express "GitHub App auth activated for repo X" or "cron pause-queue tick runs" (see the `DEFERRED-VOCAB-GAP` notes in `features/regression/smoke/pause_resume_rate_limit.feature`), document the gap inline as that file does and rely on the Step 4 unit tests as the executable regression proof. Do not assert against source-file structure (rot-prevention rule).

### 7. Run the validation commands
- Execute every command in `## Validation Commands` and confirm each passes with zero errors and zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx vitest run adws/triggers/__tests__/pauseQueueScanner.test.ts` — Targeted: the new assertions fail on the pre-fix code (auth activated for `test-owner/test-repo`) and pass after the fix (activated for `owner/repo`). This is the deterministic before/after reproduction.
- `bunx vitest run adws/triggers/__tests__/trigger_cron.test.ts` — Confirms `trigger_cron.ts` still imports cleanly with the new `ensureAppAuthForRepo` dependency and the hung-detector suite is unaffected.
- `bun run test:unit` — Full Vitest suite; no regressions across triggers/phases/providers/core.
- `bun run lint` — ESLint clean (no unused imports, no `any`).
- `bunx tsc --noEmit` — Root type check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW project type check passes (new helper, imports, and types resolve).
- `bun run build` — `tsc` build succeeds with no errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Regression BDD suite (incl. `pause_resume_rate_limit` smoke) still green.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-565"` — The new per-issue scenario runs (or is reported pending if a documented vocabulary gap prevents execution).

## Notes
- `.adw/coding_guidelines.md` is present and is followed: `resolveEntryRepoInfo` is a small single-responsibility pure helper with a guard-clause early return; it does not mutate `entry.extraArgs` (passes a spread copy to the splicing `parseTargetRepoArgs`); no decorators; no `any`; the `RepoInfo` type is reused rather than re-declared.
- No new libraries are required. (Per `.adw/commands.md`, the library install command would be `bun add <package>` if one were needed.)
- **Why resolve from `entry.extraArgs` rather than threading the cron's `cronRepoInfo` into `scanPauseQueue`:** `agents/paused_queue.json` is shared across repos/workflows (see the `pauseQueue.ts` header). Deriving each resume's repo from its own entry makes the operation self-consistent with the repo the orchestrator is actually respawned for — strictly more correct than assuming every queued entry belongs to this cron's `--target-repo`. The Step 3 per-tick re-assertion then guarantees the cron's *polling* identity is restored regardless of what any resume did.
- **Why the `getRepoInfo()` fallback is safe:** `workflowCompletion.ts` writes `extraArgs` only when the workflow has a `--target-repo`; a framework self-hosting workflow has none, and for it the cron's cwd remote *is* `paysdoc/AI_Dev_Workflow` — the correct repo. Target-repo workflows always carry `extraArgs`, so they never hit the fallback.
- **`ensureAppAuthForRepo` cost:** when `activeRepo` already equals the target it only calls `refreshTokenIfNeeded` (cached token, no API call unless near expiry); it re-activates (one API call) only on drift. Safe to call every ~20s tick. It is a no-op when the GitHub App is not configured, preserving the local-`gh`-auth path.
- **Out of scope (follow-up):** the issue's third suggestion — eliminating the process-global `GH_TOKEN` in favor of per-operation/per-repo scoped auth — is a broad cross-cutting refactor (touches every `gh`/GraphQL call site) and is intentionally not attempted here. The two changes in this plan remove the confirmed bleed and add a structural safety net; full per-operation scoping can be tracked as its own issue.
- Tell-tale triage signature this fix eliminates: `Failed to post resumed comment … Remote owner "X" !== declared owner "Y"` immediately followed by `Could not resolve to a Repository`, then sustained `POLL: 0 open`.
