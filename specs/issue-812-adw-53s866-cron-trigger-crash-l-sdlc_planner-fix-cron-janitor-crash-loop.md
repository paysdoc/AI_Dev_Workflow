# Bug: Cron trigger crash loop — janitor discovery probes non-ADW repos and an unguarded tick kills the process

## Metadata
issueNumber: `812`
adwId: `53s866-cron-trigger-crash-l`
issueJson: `{"number":812,"title":"Cron trigger crash loop: janitor discovery must require .adw marker and isolate per-repo failures","body":"## Problem\n\nThe cron trigger for `paysdoc/AI_Dev_Workflow` is crash-looping every ~5 minutes (17 crashes recorded in `logs/agents/cron/paysdoc_AI_Dev_Workflow.log`), respawned on each webhook event by `ensureCronProcess`. Operator-visible symptom: repeated `Removing stale cron PID file … (PID N is dead)` / `Spawning cron trigger` lines coinciding with ADW's own build-progress comments.\n\n### Failure chain\n\n1. `TARGET_REPOS_DIR` points at a directory that also contains non-ADW projects (e.g. `/Users/martin/projects`, holding course repos like `paicc/paicc-1`).\n2. Every `JANITOR_INTERVAL_CYCLES` (15 × 20s = 5 min), `runJanitorPass()` → `discoverTargetRepoWorktrees()` (`adws/triggers/devServerJanitor.ts`) walks `TARGET_REPOS_DIR/{owner}/{repo}` and treats **any** directory with `.git` as an ADW target repo.\n3. For each such repo, `DEFAULT_DEPS.listWorktrees` calls `gitContextForSync({ owner, repo, selfHost: false })`, whose constructor **eagerly resolves a GitHub App installation token**. For a repo the App is not installed on (`paicc/paicc-1`), `resolveInstallationId` (`adws/providers/github/appAuth.ts:284`) throws `HTTP 404 (Not Found)`.\n4. `discoverTargetRepoWorktrees` has no try/catch around `deps.listWorktrees` (the per-candidate catch in `runJanitorPass` only starts *after* discovery), so the throw escapes.\n5. The tick is invoked as `void checkAndTrigger()` (`adws/triggers/trigger_cron.ts`, both the immediate call and the `setInterval` callback) with no rejection handler → unhandled promise rejection → Node kills the entire cron trigger process.\n6. The PID file goes stale; the next webhook event respawns the cron via `webhookGatekeeper.ensureCronProcess`; five minutes later it crashes again.\n\n## Desired behavior\n\n### 1. Discovery filter: `.adw` marker required\n\n`discoverTargetRepoWorktrees` must only treat `{owner}/{repo}` as an ADW target repo when the directory contains a `.adw` entry **in addition to** `.git`. A repo directory without `.adw` must be skipped entirely — no `GitContext` construction, no App-token resolution, no `lsof` probing, no kill decisions.\n\nRationale: `.adw/` is written by `adw_init` into every ADW-managed repo, so it is the natural marker. On the current operator machine this filter reduces the discovered set from 29 git repos to exactly the 6 ADW-managed ones. The self-host framework repo itself contains `.adw` and remains discoverable — that is intended.\n\n### 2. Per-repo fault isolation in discovery\n\nA failure while listing worktrees for one repo (missing remote, GitHub App not installed → HTTP 404, deleted repo, network error) must log a warning naming the repo and **skip it**, continuing discovery for the remaining repos. A single bad repo must never abort the janitor pass, and must never crash the trigger.\n\n### 3. Tick guard in the cron loop\n\n`checkAndTrigger()` invocations in `adws/triggers/trigger_cron.ts` (initial call and `setInterval` callback) must catch and log any rejection so that no single-cycle throw can kill the cron trigger process. The next tick must still run.\n\n## Files involved\n\n- `adws/triggers/devServerJanitor.ts` — `discoverTargetRepoWorktrees`, `DEFAULT_DEPS` (`isGitRepo` / `listWorktrees`)\n- `adws/triggers/trigger_cron.ts` — tick invocation at the entry-script guard block\n\n## Acceptance criteria\n\n- A `{owner}/{repo}` directory with `.git` but without `.adw` is never probed: no token resolution, no worktree listing, no process scanning.\n- A `{owner}/{repo}` directory with both `.git` and `.adw` is discovered as before.\n- `listWorktrees` throwing for one repo logs a warning and does not prevent other repos' worktrees from being scanned in the same pass.\n- A throw anywhere inside `checkAndTrigger` logs an error and the cron process survives; the subsequent tick executes normally.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-09-04T08:23:32Z","comments":[],"actionableComment":null}`

## Bug Description

The `paysdoc/AI_Dev_Workflow` cron trigger (`bunx tsx adws/triggers/trigger_cron.ts`) dies roughly five minutes after every start and is resurrected by the next webhook event. Verified against the live log on the operator host (`logs/agents/cron/paysdoc_AI_Dev_Workflow.log` in the main checkout, read-only during planning):

- 20 `CRON trigger (backlog sweeper) started` lines and 19 fatal stack traces ending in `Error: GitHub App installation lookup failed for paicc/paicc-1: HTTP 404 (Not Found)` followed by `Node.js v26.4.0` — the shape Node prints when it terminates on an unhandled promise rejection. The issue counted 17; the log has grown since.
- Every trace has the identical frame chain: `resolveInstallationId` (`appAuth.ts:284`) → `getInstallationToken` → `resolveContextToken` (`tokenResolver.ts:52`) → `credentialEnv` (`githubTokenProvider.ts:46`) → `assertCompleteIdentity` (`gitContext.ts:149`) → `new GitContext` (`gitContext.ts:199`) → `gitContextForSync` (`gitContextFactory.ts:109`) → `Object.listWorktrees` (`devServerJanitor.ts:234`) → `discoverTargetRepoWorktrees` (`devServerJanitor.ts:170`).
- Restarts cluster about 5–6 minutes apart on 2026-09-04 (07:42, 07:48, 07:54, 08:00, 08:06, 08:12, 08:23), i.e. one janitor cadence (`JANITOR_INTERVAL_CYCLES` = 15 cycles × 20 s) after each start.

**Expected:** the janitor only inspects ADW-managed target repos, a repo it cannot list is skipped with a warning, and no single tick failure can end the cron process.

**Actual:** the janitor treats every `.git` directory under `TARGET_REPOS_DIR` as a target repo, the first non-ADW repo (`paicc/paicc-1`, on which the GitHub App is not installed) throws during `GitContext` construction, the throw escapes discovery and `checkAndTrigger`, and because the tick is fired with `void` and no rejection handler, Node kills the process. `webhookGatekeeper.ensureCronProcess` then sees a dead PID (`cronProcessGuard.isCronAliveForRepo` logs `Removing stale cron PID file … (PID N is dead)`) and respawns it, restarting the loop. While the loop persists the janitor never cleans anything, the backlog sweeper is down for the gap between crash and next webhook event, and the operator log fills with restart noise.

## Problem Statement

Three independent gaps combine into the crash loop, and each must be closed on its own:

1. **Discovery is too permissive.** `discoverTargetRepoWorktrees` (`adws/triggers/devServerJanitor.ts:147-181`) admits any `{owner}/{repo}` directory that has `.git` (`defaultIsGitRepo`, lines 203-205). `TARGET_REPOS_DIR` on the operator machine is `/Users/martin/projects`, a general projects folder: 27 depth-2 directories carry `.git` but only 6 also carry the `.adw/` config directory that `adw_init` writes into ADW-managed repos (`paysdoc/AI_Dev_Workflow`, `paysdoc/depaudit`, `paysdoc/Millennium`, `paysdoc/paysdoc.nl`, `vestmatic/vestmatic`, `vestmatic/vestmatic-research`). The other 21 are course repos and unrelated projects the framework has no business probing, minting tokens for, or running `lsof` against.
2. **Discovery has no per-repo fault isolation.** The only try/catch in `runJanitorPass` wraps the per-*candidate* body (lines 271-305), which runs strictly after discovery has returned. A throw from `deps.listWorktrees` at line 170 aborts the whole discovery walk, so one bad repo hides every other repo's worktrees and the pass never reaches the kill decisions. The throw is by design in the credential path: `resolveContextToken` (`tokenResolver.ts:46-60`) must "propagate loudly" for a foreign/uninstalled identity (the GH_TOKEN-bleed fix, #791/#792), and `GitContext`'s constructor deliberately performs one validate-and-discard credential probe (`gitContext.ts:141-156`). Neither may be softened; the caller has to isolate.
3. **The cron tick has no rejection guard.** `adws/triggers/trigger_cron.ts:520-521` runs `void checkAndTrigger()` once and again inside `setInterval`. `checkAndTrigger` is `async`, so any throw becomes a rejected promise that nothing awaits. On Node ≥ 15 (`--unhandled-rejections=throw` is the default; the host runs v26.4.0) an unhandled rejection terminates the process. Every other periodic pass dispatched from the tick already has its own swallow (`runPerIssueScenarioSweepTick`, `runPromotionSweepTick`, the `runUpgradeRedriveScan` try/catch) — the janitor call at lines 298-300 and the tick itself do not.

## Solution Statement

Make the three changes the issue asks for, each surgical and independently testable, in the two files it names:

1. **`.adw` marker gate in discovery.** Add a `hasAdwMarker(repoPath)` dependency to `JanitorDeps` (default: `fs.existsSync(path.join(repoPath, '.adw'))`, mirroring `defaultIsGitRepo`). A `{owner}/{repo}` directory is an ADW target repo only when `isGitRepo` **and** `hasAdwMarker` are both true; otherwise it is skipped silently before any `GitContext` construction. No log line for the skip: on the operator host that would be 21 lines every five minutes for repos that are correctly ignored.
2. **Per-repo fault isolation.** Extract the per-repo body of the discovery loop into a named `discoverRepoWorktrees(owner, repo, repoPath, deps)` helper (the coding guidelines' "extract loop bodies" / max-two-levels rule — the current loop is already three levels deep and a try/catch inside it would be four). The helper applies the two guards, wraps `deps.listWorktrees` in try/catch, and on failure logs `Janitor: skipping ${owner}/${repo} — worktree listing failed: ${err}` at `warn` and returns `[]`, so discovery continues with the next repo.
3. **Guarded tick.** Add an exported `runGuardedTick(tick = checkAndTrigger)` to `trigger_cron.ts` that awaits the tick inside try/catch and logs `checkAndTrigger: tick failed (non-fatal): …` at `error` (with the stack when available, since this is the catch-all of last resort and the crash stack is exactly what made this incident diagnosable). Both entry-guard invocations call `runGuardedTick` instead of `checkAndTrigger`. The shape mirrors the existing injectable `runPerIssueScenarioSweepTick` / `runPromotionSweepTick` seams so the swallow is unit-testable without starting the loop.

The three layers are defence in depth: (1) removes the trigger, (2) contains any remaining per-repo failure inside the janitor, (3) guarantees the process outlives any failure anywhere in a tick. Note that (3) alone would *not* fix the janitor — without (1) and (2) the pass would still abort on the first bad repo every five minutes, merely logging instead of crashing — which is why all three are in scope.

Two small, backward-compatible seams accompany the fix so the acceptance scenarios (`features/per-issue/feature-812.feature`, already authored) can drive the **real** filesystem predicates over a throwaway root instead of re-implementing them: `discoverTargetRepoWorktrees` and `runJanitorPass` take an optional trailing `targetReposDir` parameter defaulting to `TARGET_REPOS_DIR` (the module constant is fixed at import time, so an env override cannot reach an in-process scenario), and `DEFAULT_DEPS` is exported frozen so a caller can spread it and override only the network- and process-touching members (`listWorktrees`, `hasProcessesInDirectory`, `killProcessesInDirectory`, `log`). Production call sites are unchanged.

## Steps to Reproduce

**A. Live evidence (operator host, read-only).** From the framework repo root:

```bash
grep -c "installation lookup failed for paicc/paicc-1" logs/agents/cron/paysdoc_AI_Dev_Workflow.log   # 19 at planning time
grep -n "CRON trigger (backlog sweeper) started" logs/agents/cron/paysdoc_AI_Dev_Workflow.log | tail -8  # restarts ~5-6 min apart
```

Each crash prints the stack trace quoted in *Bug Description* and then `Node.js v26.4.0`.

**B. Why the directory is mixed.** Enumerate `TARGET_REPOS_DIR` (`/Users/martin/projects` on this host) two levels deep: 27 directories contain `.git`, 6 of those also contain `.adw`. `paicc/paicc-1` … `paicc/paicc-7` and `tac/tac-1` … `tac/tac-8` are course repos with `.git` only.

**C. Deterministic, offline repro of gap 3 (the tick guard).** Node terminates a `setInterval` loop on an unhandled rejection; `next tick ran` never prints and the exit code is 1:

```bash
node -e "async function tick(){ throw new Error('GitHub App installation lookup failed for paicc/paicc-1: HTTP 404 (Not Found)'); } void tick(); setInterval(()=>{ console.log('next tick ran'); }, 200);"; echo "exit code: $?"
```

**D. Deterministic, offline repro of gaps 1 and 2 (discovery).** Save as `repro812.ts` in the repo root, run with `bunx tsx ./repro812.ts`, delete the file afterwards. It injects `JanitorDeps` that mimic the operator layout (a non-ADW `paicc/paicc-1` next to `paysdoc/AI_Dev_Workflow`) and a `listWorktrees` that throws exactly what `gitContextForSync` throws when the App is not installed:

```ts
import { discoverTargetRepoWorktrees, runJanitorPass, type JanitorDeps } from './adws/triggers/devServerJanitor';

const calls: string[] = [];
const deps: JanitorDeps = {
  readdirTargetRepos: (dir) => {
    if (dir.endsWith('/paicc')) return ['paicc-1'];
    if (dir.endsWith('/paysdoc')) return ['AI_Dev_Workflow'];
    return ['paicc', 'paysdoc'];
  },
  isGitRepo: () => true,
  // After the fix add:  hasAdwMarker: (p) => p.endsWith('/AI_Dev_Workflow'),
  listWorktrees: (owner, repo) => {
    calls.push(`listWorktrees(${owner}/${repo})`);
    if (owner === 'paicc') throw new Error(`GitHub App installation lookup failed for ${owner}/${repo}: HTTP 404 (Not Found)`);
    return ['/repos/paysdoc/AI_Dev_Workflow/.worktrees/feature-issue-1-x'];
  },
  readTopLevelState: () => null,
  readTopLevelStateRaw: () => null,
  listAdwStateDirs: () => [],
  isAgentProcessRunning: () => false,
  getWorktreeAgeMs: () => 0,
  hasProcessesInDirectory: () => { calls.push('hasProcessesInDirectory'); return false; },
  killProcessesInDirectory: () => {},
  log: (m, l) => calls.push(`log[${l ?? 'info'}]: ${m}`),
};

try {
  console.log('discovery returned', discoverTargetRepoWorktrees(deps).length, 'candidate(s)');
} catch (e) {
  console.log('discovery THREW:', (e as Error).message);
}
console.log('calls so far:', calls);
runJanitorPass(deps).then(() => console.log('janitor pass resolved')).catch((e) => console.log('janitor pass REJECTED:', (e as Error).message));
```

Output before the fix (captured during planning):

```
discovery THREW: GitHub App installation lookup failed for paicc/paicc-1: HTTP 404 (Not Found)
calls so far: [ 'listWorktrees(paicc/paicc-1)' ]
janitor pass REJECTED: GitHub App installation lookup failed for paicc/paicc-1: HTTP 404 (Not Found)
```

`paysdoc/AI_Dev_Workflow` is never reached. After the fix (with the `hasAdwMarker` line added) the expected output is `discovery returned 1 candidate(s)`, `calls so far` containing only `listWorktrees(paysdoc/AI_Dev_Workflow)` and `hasProcessesInDirectory`, and `janitor pass resolved`. Removing the `hasAdwMarker` line again (marker present everywhere) must instead print a `log[warn]: Janitor: skipping paicc/paicc-1 — …` entry, still return 1 candidate and still resolve — that is gap 2 on its own.

**E. Optional end-to-end (touches GitHub, operator only).** Point `TARGET_REPOS_DIR` at a directory containing a `.git`-only repo the App is not installed on, start the cron with `JANITOR_INTERVAL_CYCLES=1`, and watch it die within ~20 s before the fix and survive after. Not required; A–D are sufficient and hermetic.

## Root Cause Analysis

- **`TARGET_REPOS_DIR` is a workspace root, not an ADW-only directory.** `adws/core/environment.ts:161` defaults it to `~/.adw/repos` (ADW-only by construction), but the operator overrides it to a general projects folder that ADW shares with unrelated repos. The janitor was written assuming the default layout, so `.git` was a sufficient membership test. Requiring the `.adw` marker restores that assumption regardless of where the directory points. `.adw/` is created by `adw_init` (`.claude/commands/adw_init.md` step 2 creates the directory) and regenerated by `adwUpgrade`, and the framework repo carries it too, so the self-host repo remains discoverable as intended.
- **Listing worktrees does not need a token, but constructing a `GitContext` does.** `worktreeQueryOps.listWorktrees` (`adws/gitContext/worktreeQueryOps.ts:22-35`) is a local `git worktree list --porcelain` that already swallows its own failure and returns `[]`. The throw comes one layer up: `gitContextForSync` (`adws/github/gitContextFactory.ts:96-110`) builds a `GitContext` whose constructor performs a mandatory validate-and-discard credential probe (`gitContext.ts:141-156`). With the GitHub App configured, `resolveContextToken` mints an installation token first and must propagate an uninstalled-identity failure loudly (`tokenResolver.ts:46-60`) — silently substituting an ambient token was the root of the ~13-incident GH_TOKEN-bleed class. So the correct fix is not to make the credential path quieter but to stop constructing contexts for repos ADW does not manage, and to treat any remaining construction failure as "skip this repo".
- **Discovery predates the per-candidate try/catch.** `runJanitorPass` isolates faults per worktree (lines 271-305) but the discovery walk it calls first has only readdir-level catches (lines 151-155, 160-164). `deps.listWorktrees` at line 170 is the single unguarded external call in the walk.
- **`void promise` is not a rejection handler.** `trigger_cron.ts:520-521` discards the promise from `checkAndTrigger`. Node has terminated on unhandled rejections by default since v15. The two other cron-side periodic passes (`runPerIssueScenarioSweepTick`, `runPromotionSweepTick`) were given explicit swallows in #769/#734; the janitor call (`trigger_cron.ts:298-300`) and the tick as a whole never were.
- **The respawn loop is correct behaviour reacting to a crash.** `webhookGatekeeper.ensureCronProcess` (`webhookGatekeeper.ts:169-192`) and `cronProcessGuard.isCronAliveForRepo` (`cronProcessGuard.ts:64-70`) are doing their job: detect a dead PID, clean the stale file, respawn. Nothing there needs to change; the noise stops once the cron stops dying.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/devServerJanitor.ts` — **primary edit.** `JanitorDeps` (lines 44-67) gains `hasAdwMarker`; `discoverTargetRepoWorktrees` (147-181) delegates its per-repo body to a new `discoverRepoWorktrees` helper holding the two guards and the try/catch, and gains an optional `targetReposDir` parameter; `defaultIsGitRepo` (203-205) gets a sibling `defaultHasAdwMarker`; `DEFAULT_DEPS` (231-243) wires it and becomes an exported frozen constant. Leave line 234 (`listWorktrees: (owner, repo) => gitContextForSync(...)`) verbatim — it is a construction call site the git/gh guard's construction rule (#795) tracks, and the fix is to reach it less often and contain it, not to change it. `runJanitorPass` (262-306) changes only in its signature (the pass-through `targetReposDir` parameter); its kill logic is untouched.
- `adws/triggers/trigger_cron.ts` — **primary edit.** `checkAndTrigger` (283-465) stays as is; add `runGuardedTick` next to `runPerIssueScenarioSweepTick` / `runPromotionSweepTick` (170-213, the pattern to mirror) and switch the two invocations in the entry-script guard (520-521) to it.
- `adws/triggers/__tests__/devServerJanitor.test.ts` — existing vitest suite (`makeDeps` at 166-181 builds a full `JanitorDeps`; `discoverTargetRepoWorktrees` block 183-244; `runJanitorPass` block 248+). Extend, do not rewrite.
- `adws/triggers/__tests__/trigger_cron.test.ts` — existing suite that imports `trigger_cron.ts` with every module-level side effect stubbed (`log` from `../../core` is a `vi.fn()`, lines 82-89) and already tests the sibling tick seams (206-270). Add a `runGuardedTick` block in the same style.
- `adws/github/gitContextFactory.ts` (96-110), `adws/gitContext/gitContext.ts` (141-156, 198-203), `adws/providers/github/tokenResolver.ts` (46-60), `adws/providers/github/appAuth.ts` (271-299) — **read-only context** for why the throw exists and why it must stay loud. Do not edit.
- `adws/triggers/webhookGatekeeper.ts` (169-192) and `adws/triggers/cronProcessGuard.ts` (64-70) — **read-only context** for the respawn side of the loop. Do not edit.
- `adws/core/environment.ts:161` (`TARGET_REPOS_DIR`) and `adws/core/config.ts:128` (`JANITOR_INTERVAL_CYCLES`, default 15) — read-only.
- `features/per-issue/feature-812.feature` — **the acceptance contract, already authored** by the `scenario_writer` phase (it runs in parallel with planning, `adws/adwSdlc.tsx:81`; the alignment phase reconciles). 265 lines, tagged `@adw-812 @adw-53s866-cron-trigger-crash-l`: 11 scenario definitions (13 runs with the outline's three examples) in five sections — §1 marker admission, §2 marked repos still scanned (incl. self-host), §3 per-repo isolation at any walk position plus "still cleans behind the failure", §4 two **process-level** scenarios (a tick that raises on every cycle; the end-to-end incident over a root holding a non-ADW repo), §5 type-check. Read it in full before coding. Its stated observation method — "drive the real pass over a real throwaway target-repos root with only the network- and OS-touching deps stubbed" — is what the `targetReposDir` parameter and the exported `DEFAULT_DEPS` exist for; the process-level §4 scenarios spawn `trigger_cron.ts` fresh, so there the env-derived `TARGET_REPOS_DIR` works as-is. Stable seams for its step definitions: `JanitorDeps` (`hasAdwMarker`, `listWorktrees`, `hasProcessesInDirectory`, `killProcessesInDirectory`, `log`), `runJanitorPass(deps, targetReposDir)`, the exported `runGuardedTick(tick)`, and the fixed log substrings `Janitor: skipping <owner>/<repo>` (level `warn`) and `checkAndTrigger: tick failed (non-fatal)` (level `error`). See the coverage map in *Notes*.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — owns `adws/triggers/devServerJanitor.ts` per `.adw/conditional_docs.md`, but currently has **no** janitor bullet at all. Add one (Step 7).
- `app_docs/feature-9gjajh-cron-triggers.md` — owns `adws/triggers/trigger_cron.ts`; its `trigger_cron.ts` bullet (line 9) and Gotchas describe the tick loop and the `process.argv[1]` guard. Update for `runGuardedTick` (Step 7).
- `.adw/conditional_docs.md` — add matching conditions under the two docs above so the next planner touching a cron crash or a janitor skip is routed to them (Step 7).
- `README.md` line 874 — the tree comment for `devServerJanitor.ts`; one-phrase touch (Step 7).
- `.adw/coding_guidelines.md`, `.adw/commands.md`, `.adw/review_proof.md`, `.adw/scenarios.md` — governing config: guard clauses and extraction over nesting, no `any`, `bun` toolchain, validation commands, review proof requirements.

### New Files
None. The fix lives in the two files the issue names, their existing test files, and documentation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Confirm the baseline and reproduce the bug
- Run `git status --short` and `git diff origin/dev --stat`; both were empty at planning time (HEAD == `origin/dev` at `93ba1e59`). Treat any pre-existing diff as a blocker to investigate before editing.
- Record the green baseline (all captured during planning): `bun run test:unit` → **152 test files / 2796 tests** passing; `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json` all clean.
- Run repro C (the node one-liner) and repro D (`repro812.ts`) from *Steps to Reproduce*. Confirm exit code 1 / "discovery THREW" respectively. Delete `repro812.ts` when done (never commit it).
- Read `features/per-issue/feature-812.feature` end to end (it is already in the worktree, untracked) and keep the coverage map in *Notes* at hand while working through Steps 2–6.

### 2. Add the `.adw` marker dependency to `JanitorDeps` and the default deps (`adws/triggers/devServerJanitor.ts`)
- In `JanitorDeps`, directly after `isGitRepo`, add:
  ```ts
  /** Check if a repo directory carries the `.adw` marker written by adw_init (i.e. is ADW-managed). */
  hasAdwMarker: (repoPath: string) => boolean;
  ```
- Next to `defaultIsGitRepo` add `function defaultHasAdwMarker(repoPath: string): boolean { return fs.existsSync(path.join(repoPath, '.adw')); }`.
- In `DEFAULT_DEPS`, add `hasAdwMarker: defaultHasAdwMarker,` after `isGitRepo`, and export the constant frozen: `export const DEFAULT_DEPS: JanitorDeps = Object.freeze({ ... })` with a one-line JSDoc ("Production dependencies. Exported frozen so tests and step definitions can spread it and override only the network- and process-touching members."). Freezing guarantees no caller can mutate the shared production deps; spreading a frozen object yields an ordinary mutable copy, so `{ ...DEFAULT_DEPS, listWorktrees: stub }` works unchanged.
- Update the module header comment (lines 1-11) and the `discoverTargetRepoWorktrees` docstring (143-146) to say the structure is `{targetReposDir}/{owner}/{repo}/` where repo has **both** a `.git` entry and the `.adw` marker, and that per-repo listing failures are isolated (#812).

### 3. Extract per-repo discovery with the marker gate and fault isolation (`adws/triggers/devServerJanitor.ts`)
- Add a named helper above `discoverTargetRepoWorktrees`:
  ```ts
  /**
   * Lists the worktrees of one `{owner}/{repo}` directory, or `[]` when it is not an
   * ADW target repo or its worktrees cannot be listed.
   *
   * Only a directory carrying BOTH `.git` and the `.adw` marker is an ADW target repo;
   * anything else under TARGET_REPOS_DIR is skipped before any GitContext / token
   * resolution happens. A listing failure (GitHub App not installed → HTTP 404, missing
   * remote, deleted repo, network error) is logged as a warning naming the repo and
   * isolated to that repo so discovery continues with the rest (#812).
   */
  function discoverRepoWorktrees(owner: string, repo: string, repoPath: string, deps: JanitorDeps): string[] {
    if (!deps.isGitRepo(repoPath)) return [];
    if (!deps.hasAdwMarker(repoPath)) return [];
    try {
      return deps.listWorktrees(owner, repo);
    } catch (err) {
      deps.log(`Janitor: skipping ${owner}/${repo} — worktree listing failed: ${err}`, 'warn');
      return [];
    }
  }
  ```
  Guard order is `isGitRepo` first, then `hasAdwMarker` (both are one `existsSync`; keeping `.git` first preserves the existing "not a git repo → nothing else consulted" test). The marker-less skip is deliberately silent (see *Solution Statement*).
- Replace the inner `for (const repo of repos)` body of `discoverTargetRepoWorktrees` (lines 166-177) with:
  ```ts
  for (const repo of repos) {
    const repoPath = path.join(ownerPath, repo);
    const worktreePaths = discoverRepoWorktrees(owner, repo, repoPath, deps);
    candidates.push(...worktreePaths.map(wtPath => ({ worktreePath: wtPath, dirName: path.basename(wtPath) })));
  }
  ```
  The outer function keeps its readdir guards untouched; nesting drops from three levels to two.
- Give discovery an injectable root: change the signature to `export function discoverTargetRepoWorktrees(deps: JanitorDeps, targetReposDir: string = TARGET_REPOS_DIR): WorktreeCandidate[]` and use `targetReposDir` in place of the two `TARGET_REPOS_DIR` reads inside (lines 152 and 158). Thread it through the pass: `export async function runJanitorPass(deps: JanitorDeps = DEFAULT_DEPS, targetReposDir: string = TARGET_REPOS_DIR): Promise<void>` and call `discoverTargetRepoWorktrees(deps, targetReposDir)` on line 263. Both parameters default to today's behaviour, so `trigger_cron.ts`'s `runJanitorPass()` call and every existing test are unaffected. Add a `@param targetReposDir` line to each docstring.
- Do **not** touch anything else in `runJanitorPass` or `DEFAULT_DEPS.listWorktrees` (line 234). `bunx tsc --noEmit` must pass at this point; the test file will fail to type-check until Step 5 adds `hasAdwMarker` to `makeDeps` — that is expected.

### 4. Add the guarded tick to the cron loop (`adws/triggers/trigger_cron.ts`)
- Directly after `runPromotionSweepTick` (line 213) add:
  ```ts
  /**
   * Runs one cron tick and contains any escaped rejection. `checkAndTrigger` is
   * fired-and-forgotten from the entry-script guard (initial call and the setInterval
   * callback); without this guard a single throw anywhere in the tick — e.g. the
   * janitor's discovery constructing a GitContext for a repo the GitHub App is not
   * installed on — became an unhandled rejection and Node killed the whole cron
   * process, which the webhook then respawned every ~5 minutes (#812). The error is
   * logged (with its stack, since this is the catch-all of last resort) and the next
   * tick still runs. Exported with an injectable tick so tests can drive the swallow.
   */
  export async function runGuardedTick(tick: () => Promise<void> = checkAndTrigger): Promise<void> {
    try {
      await tick();
    } catch (error) {
      const detail = error instanceof Error && error.stack ? error.stack : String(error);
      log(`checkAndTrigger: tick failed (non-fatal): ${detail}`, 'error');
    }
  }
  ```
  `checkAndTrigger` is a hoisted function declaration, so referencing it in a default parameter above its definition is fine; alternatively place `runGuardedTick` right after `checkAndTrigger` (after line 465) — either position is acceptable, pick one and keep the docstring.
- In the entry-script guard replace lines 520-521 with:
  ```ts
  void runGuardedTick();
  setInterval(() => { void runGuardedTick(); }, POLL_INTERVAL_MS);
  ```
  `void` is now correct: `runGuardedTick` never rejects.
- Leave `checkAndTrigger` itself, `cycleCount`, the janitor cadence block (298-300) and `checkPRsForReviewComments` unchanged. `cycleCount` is incremented at the top of `checkAndTrigger`, so a failed tick still advances the cadence and the next janitor pass runs 15 cycles later, not immediately.

### 5. Unit tests — janitor (`adws/triggers/__tests__/devServerJanitor.test.ts`)
- In `makeDeps` add `hasAdwMarker: vi.fn().mockReturnValue(true),` after `isGitRepo` so every existing test keeps its current behaviour (all existing cases in this file must stay green).
- Add to the `discoverTargetRepoWorktrees` block:
  1. `skips a git repo without an .adw marker — listWorktrees is never called`: owners `['paicc']`, repos `['paicc-1']`, `isGitRepo` → true, `hasAdwMarker` → false. Expect `[]`, `listWorktrees` not called, and `hasAdwMarker` called with a path ending in `paicc/paicc-1`.
  2. `discovers a repo carrying both .git and .adw as before`: same layout with `hasAdwMarker` → true and one worktree path; expect one candidate with the right `dirName`.
  3. `does not consult the .adw marker for a directory that is not a git repo`: `isGitRepo` → false; expect `hasAdwMarker` and `listWorktrees` not called (guard order).
  4. `logs a warning naming the repo and continues with the remaining repos when listWorktrees throws`: `readdirTargetRepos` → `['paicc', 'paysdoc']`, then `['paicc-1']`, then `['AI_Dev_Workflow']`; `listWorktrees` → `mockImplementationOnce` throwing `new Error('GitHub App installation lookup failed for paicc/paicc-1: HTTP 404 (Not Found)')`, then `mockReturnValueOnce(['/repos/paysdoc/AI_Dev_Workflow/.worktrees/feature-issue-1-some-slug'])`. Expect exactly one candidate (`feature-issue-1-some-slug`), `listWorktrees` called twice, and `log` called with `expect.stringContaining('paicc/paicc-1')`, `'warn'`.
  5. `returns an empty array (and does not throw) when the only repo's listWorktrees throws`: expect `[]` and one `warn` log.
- Add to the `runJanitorPass` block:
  6. `still probes and cleans the remaining repos' worktrees when one repo's worktree listing throws`: the layout from case 4 with `hasProcessesInDirectory` → true, `listAdwStateDirs` → `[]`, `readTopLevelStateRaw` → null, `getWorktreeAgeMs` → `OLD`. Expect the pass to resolve, `hasProcessesInDirectory` and `killProcessesInDirectory` called with the `paysdoc` worktree, and the `warn` log for `paicc/paicc-1`.
  7. `real filesystem: only a directory carrying both .git and .adw under the injected root is listed` — the one case that exercises the production predicates. Import `DEFAULT_DEPS`; in the test create a root with `fs.mkdtempSync(path.join(os.tmpdir(), 'janitor-812-'))` holding `paicc/paicc-1/.git`, `paysdoc/AI_Dev_Workflow/.git` + `.adw`, and `acme/notes/.adw` (no `.git`), all as directories; call `await runJanitorPass({ ...DEFAULT_DEPS, listWorktrees, hasProcessesInDirectory: vi.fn().mockReturnValue(false), killProcessesInDirectory: vi.fn(), log: vi.fn() }, root)` where `listWorktrees` is a `vi.fn()` that throws the App-404 error for `paicc` and returns `[]` otherwise. Expect `listWorktrees` called exactly once, with `('paysdoc', 'AI_Dev_Workflow')`, `killProcessesInDirectory` never called, and `log` never called with `'warn'` (nothing failed for an admitted repo). Remove the temp root in `afterEach` with `fs.rmSync(root, { recursive: true, force: true })`. This is acceptance criterion 1 verified against real `existsSync` calls, and it doubles as the proof that the `targetReposDir` parameter is honoured (`readdirTargetRepos` is the real one and never sees `TARGET_REPOS_DIR`).
- Keep cases 1–6 dependency-injected as today; case 7 is the only one that touches the disk, and it must never reach `DEFAULT_DEPS.listWorktrees` (always override it — the real one constructs a `GitContext`).

### 6. Unit tests — cron tick guard (`adws/triggers/__tests__/trigger_cron.test.ts`)
- Extend the import on line 95 with `runGuardedTick`.
- Add a `describe('runGuardedTick (#812)')` block after the `runPromotionSweepTick` block, with `beforeEach(() => vi.mocked(log).mockClear())`, mirroring the sibling blocks:
  1. `awaits the injected tick exactly once`: `const tick = vi.fn(() => Promise.resolve()); await runGuardedTick(tick); expect(tick).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled();`
  2. `swallows a rejecting tick, logs an error naming the cause, and resolves`: tick rejects with `new Error('GitHub App installation lookup failed for paicc/paicc-1: HTTP 404 (Not Found)')`; `await expect(runGuardedTick(tick)).resolves.toBeUndefined(); expect(log).toHaveBeenCalledWith(expect.stringContaining('paicc/paicc-1'), 'error');` — vitest itself fails a test on any unhandled rejection, so this case also proves nothing escapes.
  3. `a rejection on one invocation does not stop the next invocation from running`: call `runGuardedTick` twice with a tick that rejects on the first call and resolves on the second (`mockRejectedValueOnce(...).mockResolvedValueOnce(undefined)`); expect the tick called twice — the setInterval contract in miniature.
  4. `swallows a non-Error rejection value`: tick rejects with the string `'boom'`; expect resolve and `log` called with `expect.stringContaining('boom')`, `'error'`.
- Do not attempt to exercise the real `setInterval` or the entry-script guard; the `process.argv[1]` guard keeps them out of the test import by design (see the cron doc's Gotchas).

### 7. Documentation
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`: under *Responsibilities* add a `runJanitorPass` / `discoverTargetRepoWorktrees` (`devServerJanitor`) bullet describing the walk, the **`.git` + `.adw` marker** membership rule, the silent skip of non-ADW repos, and the per-repo `warn` + skip on a listing failure. Under *Contracts & Invariants* add: "A `{owner}/{repo}` directory under `TARGET_REPOS_DIR` is an ADW target repo for the janitor only when it carries both `.git` and `.adw`; a failure listing one repo's worktrees never aborts the pass (#812)." Under *Gotchas* add: "`DEFAULT_DEPS.listWorktrees` constructs a `GitContext`, whose constructor probes the token provider; with the GitHub App configured that throws `HTTP 404` for any repo the App is not installed on — by design (#791/#792). Isolate it in the caller; never soften the resolver."
- `app_docs/feature-9gjajh-cron-triggers.md`: in the `trigger_cron.ts` bullet (line 9) say the loop invokes `checkAndTrigger` through `runGuardedTick`, which logs and swallows any escaped rejection so no single tick can kill the process; add a *Gotchas* bullet that `void promise` is not a rejection handler on Node ≥ 15 and that every fire-and-forget async call from the entry guard must go through a guard like `runGuardedTick` (#812 crash loop: janitor discovery → App 404 → unhandled rejection → webhook respawn every ~5 min).
- `.adw/conditional_docs.md`: under `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` add conditions "When the janitor skips a repo (`Janitor: skipping owner/repo`), when the `.adw` marker gate / `hasAdwMarker` in `discoverTargetRepoWorktrees` is relevant, or when `TARGET_REPOS_DIR` holds non-ADW repos"; under `app_docs/feature-9gjajh-cron-triggers.md` add "When working with `runGuardedTick` or when the cron trigger crash-loops / is respawned by the webhook after an unhandled rejection (#812)".
- `README.md` line 874: extend the tree comment to `# Janitor probe that kills stale dev server processes in ADW-managed (.adw-marked) target repo worktrees`. No other README change.

### 8. Run the validation commands
- Run every command in *Validation Commands* in order and fix anything that fails before declaring done. Delete any scratch repro file. Check `git diff origin/dev --stat` lists only the files named in the *Final scope check*.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Commands come from `.adw/commands.md` and `.adw/review_proof.md`.

- **Reproduce before the fix** — repro C: `node -e "async function tick(){ throw new Error('x'); } void tick(); setInterval(()=>{ console.log('next tick ran'); }, 200);"` exits 1 without printing `next tick ran`. Repro D: `bunx tsx ./repro812.ts` prints `discovery THREW` and `janitor pass REJECTED`.
- **RED proof** — after Steps 5 and 6 but with Steps 2–4 set aside as a temporary WIP commit (never a bare `git stash`): `bunx vitest run adws/triggers/__tests__/devServerJanitor.test.ts adws/triggers/__tests__/trigger_cron.test.ts` fails (type error on the missing `hasAdwMarker` / `runGuardedTick`, then the new behavioural cases). Optional but cheap.
- **GREEN proof, targeted** — `bunx vitest run adws/triggers/__tests__/devServerJanitor.test.ts adws/triggers/__tests__/trigger_cron.test.ts` — all cases pass, including the 7 new janitor cases and 4 new tick cases.
- **Reproduce after the fix** — repro D with the `hasAdwMarker` line: `discovery returned 1 candidate(s)`, only `listWorktrees(paysdoc/AI_Dev_Workflow)` and `hasProcessesInDirectory` in `calls`, `janitor pass resolved`. Repro D without the marker line (marker everywhere): one `log[warn]: Janitor: skipping paicc/paicc-1 — …` entry, still 1 candidate, still resolved. Then delete `repro812.ts`.
- `bun run lint` — ESLint passes with zero errors and zero warnings (no unused imports/vars; the `catch (err)` binding is used in the log line).
- `bunx tsc --noEmit` — repo type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional ADW type-check passes.
- `bun run build` — build succeeds.
- `bun run test:unit` — full vitest suite green. Baseline **152 files / 2796 tests**; after: **152 files / 2807 tests** (2796 + 7 janitor + 4 tick), zero regressions.
- `bun run lint:git-guard` — the git/gh guard passes exactly as before: `discoverRepoWorktrees` contains no `git`/`gh` shell-out, no `gitContextForRepo` call, and no new construction site; the existing `gitContextForSync` call at `devServerJanitor.ts` is unchanged so the construction-rule ratchet sees the same allowlist state.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-812"` — all 13 scenario runs (11 definitions; the §3 outline runs three times) in `features/per-issue/feature-812.feature` pass once `generate_step_definitions` has produced `features/per-issue/step_definitions/feature-812*.steps.ts`. Expected RED-before/GREEN-after: every §1, §3 and §4 scenario; the two §2 scenarios and the §5 type-check are GREEN both before and after by design. If the step definitions have not landed when you reach this step, run it again in the scenario-test phase; do not skip it.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-proof"` — required by `.adw/review_proof.md` step 4. At planning time no feature file in `features/` carries this tag (grep count 0), so the run is expected to report 0 scenarios and exit 0; that is a pass, not a failure to investigate.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite still green (the janitor and cron changes touch no regression scenario, but the suite is the project's stated quality gate).
- **Verify by inspection** — `grep -n "void checkAndTrigger" adws/triggers/trigger_cron.ts` returns nothing; `grep -n "void runGuardedTick" adws/triggers/trigger_cron.ts` returns exactly two hits; `grep -n "hasAdwMarker" adws/triggers/devServerJanitor.ts` returns the interface field, the guard in `discoverRepoWorktrees`, and the `DEFAULT_DEPS` entry; `grep -n "TARGET_REPOS_DIR" adws/triggers/devServerJanitor.ts` returns only the import and the two default-parameter positions (no bare read inside the walk); `grep -n "runJanitorPass()" adws/triggers/trigger_cron.ts` still returns the single unchanged call.
- **Final scope check** — `git diff origin/dev --stat` shows only: `adws/triggers/devServerJanitor.ts`, `adws/triggers/trigger_cron.ts`, `adws/triggers/__tests__/devServerJanitor.test.ts`, `adws/triggers/__tests__/trigger_cron.test.ts`, `app_docs/feature-9gjajh-issue-routing-and-eligibility.md`, `app_docs/feature-9gjajh-cron-triggers.md`, `.adw/conditional_docs.md`, `README.md`, this spec file, and the scenario-phase files `features/per-issue/feature-812.feature` / `features/per-issue/step_definitions/feature-812*.steps.ts`. Anything else is out of scope.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): the fix is guard clauses plus one extracted loop body — exactly the "extract loop bodies" and "max depth ~2" rules; the try/catch sits at the system boundary (the `listWorktrees` OS/network call and the tick entry point); errors are narrowed with `instanceof`, never cast to `any`; no decorators, no new abstractions. `devServerJanitor.ts` is already 306 lines (over the 300-line guideline before this change) and lands at roughly 320; splitting it is deliberately **not** part of this fix — a split would move `discoverTargetRepoWorktrees` into a new module with a type-only circular import of `JanitorDeps`, a re-export shim for the test file, and a new `conditional_docs` ownership row, all unrelated to the crash loop. Note it as tech debt in the PR if desired.
- **No new libraries.** `.adw/commands.md` gives `bun add <package>` as the install command, but Node builtins cover everything.
- **Why the credential path is not touched.** `resolveContextToken`'s propagate-loudly contract and the `GitContext` constructor probe exist to prevent a wrong-repo ambient token from ever being used (the GH_TOKEN-bleed class, ~13 incidents). Softening either to "fix" the janitor would reopen that class. The janitor is the caller; it must not construct contexts for repos it does not manage, and must contain the failure when it does.
- **Why `.adw` and not, say, `.adw-version` or a `.github/adw.yml` check.** `.adw/` is created unconditionally by `adw_init` step 2 and regenerated by `adwUpgrade`, it exists in every one of the 6 ADW-managed repos on the operator host and in the framework repo, and it is the same marker the framework already treats as "project config" (`UBIQUITOUS_LANGUAGE.md`, *Project Config*). It is also what the issue specifies. Planning-time count on the operator host: 27 depth-2 `.git` directories, 6 with `.adw` (the issue says 29; the difference is immaterial — two entries have spaces in their names and the point is the 21 non-ADW repos).
- **Silent skip vs. logged skip.** A marker-less repo is skipped without a log line; a repo that *is* ADW-managed but cannot be listed gets a `warn`. Logging the former would add ~21 lines per janitor pass on this host for repos that are correctly ignored and would drown the one line that matters.
- **Layering matters for the acceptance criteria.** Criterion 1 (never probed) is delivered by Step 3's marker gate alone; criterion 3 (one bad repo does not block others) by Step 3's try/catch alone; criterion 4 (process survives any tick throw) by Step 4 alone. Each has its own unit tests so a regression in one layer is caught even if the others still mask it in production.
- **Scenario coverage map** (`features/per-issue/feature-812.feature` → plan step that satisfies it):
  - §1 "never listed even when its listing would 404", "neither probed nor considered for cleaning", "marker but no git checkout is not admitted" → Step 3's two guards, in that order (`isGitRepo` then `hasAdwMarker`). The third scenario is the reason the guard is a conjunction and not a swap.
  - §2 "both entries → scanned and cleaned as before", "self-host repo stays in the scan set" → unchanged `runJanitorPass` kill path behind the new guards; GREEN before and after.
  - §3 "logged by name and skipped while the pass continues", outline "failing repo first/middle/last costs only itself", "orphaned dev server behind a failing repo is still cleaned" → Step 3's per-repo try/catch inside `discoverRepoWorktrees` (a catch around the owner loop or a "return [] on first error" would fail the outline and the last scenario respectively — the feature calls both anti-patterns out). The `warn` line must contain `${owner}/${repo}` verbatim.
  - §4 "a poll tick that raises is logged and the cron keeps polling" → Step 4's `runGuardedTick`. The feature's note is important: the step definitions will provoke the throw through a lever the janitor isolation does **not** swallow (a pause-queue entry whose resume fails, `scanPauseQueue` → `resumeWorkflow`), so the guard must wrap the *whole* tick, which `runGuardedTick` does — do not narrow it to the janitor call. Observables: the `error`-level `checkAndTrigger: tick failed (non-fatal)` line in the spawned process's captured log, the PID still alive, and a subsequent `POLL:` line.
  - §4 "survives a janitor cycle over a root holding a non-ADW repository" → all three layers composed, at process level, with `TARGET_REPOS_DIR` set in the spawned cron's env (that works because it is a fresh process; in-process scenarios use the `targetReposDir` parameter instead).
  - §5 type-check → `bunx tsc --noEmit`.
  - The step definitions for §1–§3 should build their deps as `{ ...DEFAULT_DEPS, listWorktrees, hasProcessesInDirectory, killProcessesInDirectory, log }` and call `runJanitorPass(deps, tmpRoot)` so the real `readdirTargetRepos` / `isGitRepo` / `hasAdwMarker` are what is under test; unit-test case 7 in Step 5 shows the pattern.
- **Scope discipline — deliberately not changed:** no global `process.on('unhandledRejection')` backstop (it would mask programming errors elsewhere and the issue asks for guards at the invocation sites); no change to `checkPRsForReviewComments` or its `setInterval` (a *synchronous* throw there would be an uncaught exception, a different mechanism — worth its own issue if it is ever observed); no change to `JANITOR_INTERVAL_CYCLES`, `runJanitorPass`'s kill logic, `killProcessesInDirectory`, or the respawn code in `webhookGatekeeper` / `cronProcessGuard`, which behaved correctly throughout.
- **Operator follow-up (not code).** After this merges, the still-running old cron process on the host will keep crash-looping until it is replaced; restart the webhook/cron pair (or let `ensureCronProcess` respawn from the updated checkout) and confirm the `Removing stale cron PID file` lines stop.
- **Conditional docs consulted.** `.adw/conditional_docs.md` routes `devServerJanitor.ts` to `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` (which currently does not mention the janitor at all — hence the doc addition in Step 7) and `trigger_cron.ts` to `app_docs/feature-9gjajh-cron-triggers.md`. `app_docs/feature-d0hv98-exhaustive-stage-classifier.md` warns not to replace the janitor's `isActiveStage` call with `classifyStageString`; this plan does not touch that call.
- **Worktree hygiene.** The worktree was clean and identical to `origin/dev` at planning time. Re-check `git diff origin/dev --stat` before committing and never commit the scratch repro.
