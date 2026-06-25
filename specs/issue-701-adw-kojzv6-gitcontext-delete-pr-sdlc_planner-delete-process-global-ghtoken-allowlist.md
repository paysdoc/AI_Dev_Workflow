# Feature: Delete the process-global `GH_TOKEN` mutation and the git/gh-guard `ALLOWLIST` (GitContext capstone, HITL)

## Metadata
issueNumber: `701`
adwId: `kojzv6-gitcontext-delete-pr`
issueJson: `{"number":701,"title":"GitContext: delete process-global GH_TOKEN + ALLOWLIST (capstone, HITL)","body":"## Parent PRD\n`specs/prd/git-context-repo-authority.md` — makes the Enforcement invariant real.\n\n## What to build\nWith every consumer routed through a context, delete the process-global `GH_TOKEN` mutation (githubAppAuth `activateGitHubAppAuth`, webhook startup) and remove the `ALLOWLIST` array from checkGitGhGuard.ts so the only exemption is `EXEMPT_PACKAGE_DIR`. Also remove the surgical `adwUpgrade`/`adwMerge` activate-auth stopgaps now superseded by per-command auth.\n\n## Acceptance criteria\n- [ ] No `process.env.GH_TOKEN = …` mutation remains in the hot path\n- [ ] `ALLOWLIST` removed; guard exempts only the package dir\n- [ ] `lint:git-guard` passes against the whole tree with no allowlist\n- [ ] Full unit + integration suite green; webhook handles interleaved multi-repo events without bleed\n\n## Blocked by\n- Blocked by #700\n\n## Touched Files\n- adws/github/githubAppAuth.ts\n- adws/triggers/trigger_webhook.ts\n- adws/checkGitGhGuard.ts\n- adws/adwUpgrade.tsx\n- adws/adwMerge.tsx\n\n## User stories addressed\n- User story 2\n- User story 5\n- User story 7\n- User story 8","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-06-23T11:45:36Z","comments":[],"actionableComment":null}`

## Feature Description

This is the **capstone** of the GitContext repo-context-authority epic (PRD `specs/prd/git-context-repo-authority.md`). The epic introduced a `GitContext` deep module that owns every `git`/`gh` interaction and applies auth **per spawned command** (`GitContext.commandEnv()` overlays a child-process environment) rather than by mutating a process-global. Across slices #658–#700 every ADW-owned consumer family was migrated onto per-command auth, and the bootstrap files were absorbed into the structurally-exempt package — driving the guard's `ALLOWLIST` to empty.

Two vestiges of the old, unsafe model remain, and this feature removes both:

1. **The process-global token mutation.** `activateGitHubAppAuth()` and `refreshTokenIfNeeded()` (in `adws/github/githubAppAuth.ts`) still write `process.env.GH_TOKEN` and the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` identity variables. Per the #700 documentation (`app_docs/feature-oqb76h-gitcontext-base-path-authority.md`, lines 113 & 230) these writes were **deliberately retained and deferred to a follow-up** because they serve exactly **one** remaining consumer: the **Claude CLI subprocess** (the agent process spawned by `claudeAgent.ts`, which runs `/implement`, `/commit`, `/pull_request`, `/resolve_conflict`, etc. and itself shells out to `git`/`gh`). That subprocess inherits its auth from the ambient `process.env` via `getSafeSubprocessEnv()`. To delete the writes without breaking the subprocess, the subprocess's auth must first be **re-sourced from the launch-boundary `GitContext`** — exactly the "re-source `getSafeSubprocessEnv` from the launch-boundary context" step the epic always anticipated.

2. **The git/gh-guard `ALLOWLIST` machinery.** `adws/checkGitGhGuard.ts` still carries the now-empty `ALLOWLIST` array and the per-file skip logic that consulted it. With the array at zero (since #700) this is dead code; the only legitimate exemption is the structural `EXEMPT_PACKAGE_DIR = 'adws/gitContext'`. Removing the array machinery makes "route through a `GitContext`, or live inside the package" the *only* representable shape — the Enforcement invariant the PRD demands.

The value: the wrong-repo / `GH_TOKEN`-bleed class of bug (≈13 historical incidents) becomes **structurally unrepresentable**. No process-global token can be re-pointed mid-flight (closing the webhook concurrency bleed at its last root), and no new call site can quietly escape the guard via an allowlist entry.

## User Story

As an **ADW maintainer/operator** (User stories 2, 5, 7, 8 from the PRD),
I want **every** `git`/`gh` interaction — including the work the Claude subprocess does — to be authenticated per-command from an explicit repo context, and the build to fail on any direct `git`/`gh` shell-out with no allowlist escape hatch,
So that **concurrent multi-repo activity can never authenticate against the wrong repository**, a new call site **cannot reintroduce** the wrong-repo class of bug, and the per-command auth guarantee is enforced **mechanically** rather than by convention.

## Problem Statement

The PRD's **Auth model** ("auth applied per command rather than via a process-global") and **Enforcement** ("the build fails when someone shells out to `git` or `gh` directly") invariants are not yet *fully* real:

- `activateGitHubAppAuth`/`refreshTokenIfNeeded` still mutate `process.env.GH_TOKEN` + `GIT_*`. These are the last process-global token writes. They exist solely to feed the Claude CLI subprocess, whose env (`getSafeSubprocessEnv()` → `claudeAgent.ts:118`) snapshots `process.env`. In a long-lived multi-repo process (webhook) a per-event flow that spawned an agent would inherit whatever token was last written globally — the exact bleed shape the PRD set out to eliminate.
- `checkGitGhGuard.ts` keeps an `ALLOWLIST` array + a per-file skip path. Even though the array is empty today, its presence is an escape hatch: a future change could add a path and silently re-open the wrong-repo door. The guard should exempt **only** the package directory.

The two are entangled: the guard cannot be reduced to "package-only" while a real consumer (the subprocess) still depends on the global write, because deleting the write first would strand the subprocess with no token. The write must be replaced by per-command injection **before** it can be deleted.

## Solution Statement

Land the change in three ordered movements so the subprocess is never left without auth:

1. **Re-source the subprocess auth from the launch-boundary context (foundation, must land first).** Add a single optional per-invocation `subprocessEnv?: NodeJS.ProcessEnv` seam to the two agent chokepoints — `runClaudeAgentWithCommand` (`adws/agents/claudeAgent.ts`) and `runCommandAgent`/`CommandAgentOptions` (`adws/agents/commandAgent.ts`). `claudeAgent` merges it over `getSafeSubprocessEnv()`: `{ ...getSafeSubprocessEnv(), ...(subprocessEnv ?? {}) }`. Thread `gitContext.commandEnv()` (which already returns `{GH_TOKEN, GIT_AUTHOR_*, GIT_COMMITTER_*}`) from the launch-boundary context — every agent-running phase already constructs a `gitCtx` (e.g. `buildPhase`, `prPhase`, `documentPhase`, `reviewPhase`, `scenarioFixPhase`, `prReviewPhase`) or receives one on `config.gitContext` (produced by `initializeWorkflow`). When no context is available (self-host without a configured App), the overlay is omitted and behaviour is identical to today (subprocess relies on `gh auth login` credentials in `HOME`) — **no regression**.

2. **Delete the process-global mutation (core).** Reduce `githubAppAuth.ts` to the pure re-export shim it already advertises itself as: keep `isGitHubAppConfigured` / `getInstallationToken` re-exports; delete `activateGitHubAppAuth`, `refreshTokenIfNeeded`, and the private `configureGitIdentity` (the only `process.env.GH_TOKEN`/`GIT_*` writers). Drop the two symbols from `adws/github/index.ts`. The TypeScript compiler then forces removal of every now-dead caller + import: `trigger_webhook.ts` (startup), `trigger_cron.ts` (startup + poll-interval refresh), `workflowInit.ts`, `prReviewPhase.ts`, `pauseQueueScanner.ts`, `adwUpgrade.tsx` (the surgical stopgap), and `prAgent.ts` (`refreshTokenIfNeeded()`).

3. **Remove the `ALLOWLIST` machinery (enforcement) and verify the stopgaps are gone.** In `checkGitGhGuard.ts` delete the `ALLOWLIST` array, the `allowed` Set + `if (allowed.has(relPath)) continue;` skip in `scanFiles`, and the `ALLOWLIST`-mention in the remedy text — leaving `EXEMPT_PACKAGE_DIR` as the sole exemption. Preserve the runtime `(0 allowlisted)` print as a permanent zero-invariant so the epic's capstone observable (the guard reports zero allowlisted files) stays valid. Confirm `adwUpgrade.tsx`'s stopgap is removed and `adwMerge.tsx` already carries none (it migrated to `buildLaunchGitContext` in a prior slice).

This is faithful to the PRD: auth becomes truly per-command (including for the subprocess), and the wrong path becomes unrepresentable (package-only exemption, no allowlist).

## Relevant Files

Use these files to implement the feature:

### Re-sourcing the subprocess auth (foundation)
- `adws/agents/claudeAgent.ts` — **chokepoint #1.** `runClaudeAgentWithCommand` builds `spawnEnv = getSafeSubprocessEnv()` at line 118 and spawns the Claude CLI. Add a trailing optional `subprocessEnv?` param and merge it over `getSafeSubprocessEnv()`. This is the single spot the subprocess env is assembled.
- `adws/agents/commandAgent.ts` — **chokepoint #2.** `runCommandAgent(config, options)` wraps `runClaudeAgentWithCommand`; most agents go through it. Add `subprocessEnv?` to `CommandAgentOptions` and forward it (including into the retry-loop respawn).
- `adws/core/environment.ts` — `getSafeSubprocessEnv()` (line 189) and `SAFE_ENV_VARS` (line 156). Keep `GH_TOKEN`/`GIT_*` in the allowlist (harmless; the overlay supplies the authoritative values). No functional change required here, but it is the base the overlay merges over.
- `adws/gitContext/gitContext.ts` — `commandEnv(base, usePat)` (line 133) already returns the exact `{...base, GH_TOKEN, GIT_AUTHOR_*, GIT_COMMITTER_*}` bundle. This is the overlay source; no change needed.
- The agent runners that funnel to the chokepoints and whose subprocess touches `git`/`gh` (commit identity, push, `gh`): `adws/agents/buildAgent.ts`, `gitAgent.ts`, `prAgent.ts`, `patchAgent.ts`, `refactorAgent.ts`, `documentAgent.ts`, `reviewAgent.ts`, `resolutionAgent.ts`, `installAgent.ts`. Each gains an optional `subprocessEnv` (or `gitContext`) param forwarded to the chokepoint. Pure-analysis runners (`planAgent.ts`, `scenarioAgent.ts`, `stepDefAgent.ts`, `validationAgent.ts`, `alignmentAgent.ts`, `scenarioFidelityAgent.ts`, `diffEvaluatorAgent.ts`, `dependencyExtractionAgent.ts`) do not need it; threading is harmless if added uniformly.
- The agent-running phases that already construct a `gitCtx` and must pass `gitCtx.commandEnv()` to their agent calls: `adws/phases/buildPhase.ts` (gitCtx @ line 46), `prPhase.ts` (@ 55-56), `documentPhase.ts` (@ 38), `reviewPhase.ts` (@ 180), `scenarioFixPhase.ts` (@ 46), `prReviewPhase.ts` (@ 92/330), and `reviewPatchHelpers.ts` (dispatches patch/refactor agents). Where a phase only conditionally builds a `gitCtx`, fall back to `config.gitContext?.commandEnv()`.
- `adws/phases/workflowInit.ts` — produces the launch-boundary `gitContext` (line 141, returned at 455) carried on the workflow config as `config.gitContext` (the uniform fallback source). Also a caller of `activateGitHubAppAuth` (line 133) to delete.

### Deleting the process-global mutation (core)
- `adws/github/githubAppAuth.ts` — **primary.** Delete `activateGitHubAppAuth` (writes `process.env.GH_TOKEN` @ 58, calls `configureGitIdentity`), `refreshTokenIfNeeded` (writes `process.env.GH_TOKEN` @ 77), and `configureGitIdentity` (writes `GIT_AUTHOR_*`/`GIT_COMMITTER_*` @ 95-98). Reduce to the re-export shim for `isGitHubAppConfigured`/`getInstallationToken` (still imported by ~7 consumers and by the package's token resolver). Update the file header comment.
- `adws/github/index.ts` — remove `activateGitHubAppAuth` (line 71) and `refreshTokenIfNeeded` (line 72) from the barrel exports.
- `adws/triggers/trigger_webhook.ts` — remove the `activateGitHubAppAuth` import (line 19) and the `activateGitHubAppAuth()` startup call (line 292). The webhook already constructs a **per-event** `GitContext` (line 121) and routes its own `gh` through it, so the startup global is now pure redundancy. (User story 2/7 acceptance — interleaved multi-repo events without bleed.)
- `adws/triggers/trigger_cron.ts` — remove the `activateGitHubAppAuth`/`refreshTokenIfNeeded` import (line 16), the startup `activateGitHubAppAuth` (line 72), and the poll-interval `refreshTokenIfNeeded` (line 393). Update/delete the now-stale comment at line 216 ("transitional activateGitHubAppAuth at startup covers legacy global-token callers"). The cron routes its own `gh` via `gitContextForRepo` (line 79) per-call.
- `adws/phases/workflowInit.ts` — remove the `activateGitHubAppAuth` import (line 42) and call (line 133) plus the now-stale comment (lines 130-131). The launch-boundary `gitContext` already covers the orchestrator's repo identity.
- `adws/phases/prReviewPhase.ts` — remove the `activateGitHubAppAuth` import (line 8) and call (line 44).
- `adws/triggers/pauseQueueScanner.ts` — remove the `activateGitHubAppAuth` import (line 21) and call (line 117). (Cross-reference: `app_docs/feature-tcewff-cron-gh-token-bleed-fix.md`.)
- `adws/adwUpgrade.tsx` — remove the `activateGitHubAppAuth` import (line 53) and the surgical stopgap `if (targetRepo) activateGitHubAppAuth(...)` (line 517) + its explanatory comment (lines 513-516). The upgrade lifecycle already builds `gitContextFor(...)` (line 520); the pre-context `ensureTargetRepoWorkspace` clone/fetch (line 518) must be confirmed to authenticate via the package's veracious token path (it was absorbed into `adws/gitContext/repoWorkspace.ts` in #700 with an injected `defaultBranch` thunk), not via the ambient global. If `ensureTargetRepoWorkspace` still relied on the ambient global, route it through the package's per-command auth before removing the stopgap.
- `adws/agents/prAgent.ts` — remove the `refreshTokenIfNeeded` import (line 9) and the `refreshTokenIfNeeded()` call (line 99). The `/pull_request` subprocess receives its env via the new `subprocessEnv` seam instead.

### Removing the ALLOWLIST machinery (enforcement)
- `adws/checkGitGhGuard.ts` — delete the `ALLOWLIST` array (line 43), the `allowed` Set + `if (allowed.has(relPath)) continue;` in `scanFiles` (lines 97, 102), and the `ALLOWLIST` mention in the remedy text (line 161) and header comment (line 8). Replace the `(${ALLOWLIST.length} allowlisted)` substitution in the runtime print (line 148) with the literal `(0 allowlisted)` so the epic's "zero allowlisted" capstone observable is preserved. Leave `EXEMPT_PACKAGE_DIR`/`EXEMPT_DIR_NAMES` and the directory-walk skip untouched — they are the sole, structural exemption.
- `adws/adwMerge.tsx` — verification only: confirm it contains no `activateGitHubAppAuth`/`refreshTokenIfNeeded`/`process.env.GH_TOKEN` (it already uses `buildLaunchGitContext`; the issue's listed "adwMerge stopgap" was removed in a prior slice).

### Context / guidance docs (read before implementing)
- `specs/prd/git-context-repo-authority.md` — the parent PRD (Auth model; Enforcement; "Removal of the unsafe primitives"; out-of-scope: auth *acquisition* is unchanged).
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — the #700 doc; lines 113 & 230 explicitly defer the `process.env` writes' removal to this issue ("subprocess provisioning, tracked separately by the PRD").
- `app_docs/feature-tcewff-cron-gh-token-bleed-fix.md` — conditions match any path calling `activateGitHubAppAuth` in cron/pause-queue.
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — the git/gh CLI guard's own doc.
- `.adw/coding_guidelines.md` — immutability, purity, guard clauses, files < 300 lines, isolate side effects at boundaries.

### New Files
- `features/per-issue/feature-701.feature` — BDD scenarios for this capstone (per-issue directory per `.adw/scenarios.md`), tagged `@adw-701` and `@adw-kojzv6-gitcontext-delete-pr`. Assert **runtime/observable** behaviour only (no source-text grepping), mirroring `feature-700.feature`'s rot-prevention discipline.
- `features/step_definitions/feature-701.steps.ts` — **not required.** This slice introduces zero novel step phrasing; every `@adw-701` phrase is already registered (`feature-691` guard phrases, `feature-659`/`gitContextSharedWorld.ts` recording-runner phrases, `feature-504` T22). Do not create this file with redefinitions, or Cucumber raises a duplicate-definition error.

## Implementation Plan

### Phase 1: Foundation — re-source the Claude subprocess auth from the launch-boundary context
The deletion in Phase 2 is only safe once the subprocess no longer depends on the ambient global. So first add the per-command subprocess-auth seam and thread `GitContext.commandEnv()` to the agents whose subprocess does `git`/`gh`. Land this with the build green **while the global writes are still in place** (the overlay simply takes precedence over the ambient value), proving the new path works before anything is removed.

### Phase 2: Core — delete the process-global token/identity writes and every dead caller
Gut `githubAppAuth.ts` down to the re-export shim, drop the barrel exports, and let `tsc` enumerate the dead call sites; remove each import + call. After this phase, `grep` proves no `process.env.GH_TOKEN =`/`process.env.GIT_AUTHOR|COMMITTER =` write remains outside test setup.

### Phase 3: Integration — collapse the guard to package-only exemption and verify the suite
Remove the `ALLOWLIST` machinery from the guard (keeping `EXEMPT_PACKAGE_DIR` and the `(0 allowlisted)` print), confirm the upgrade/merge stopgaps are gone, write the `@adw-701` BDD scenarios, update unit tests, and run the full validation matrix (lint, type-check both tsconfigs, build, unit suite, `lint:git-guard`, `@adw-701` + `@regression`).

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1 — Read context and confirm the current global-consumer surface
- Read the PRD, `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` (esp. lines 113, 230), `app_docs/feature-tcewff-cron-gh-token-bleed-fix.md`, and `app_docs/feature-bq1f45-git-gh-cli-guard.md`.
- Confirm the only `process.env.GH_TOKEN =`/`GIT_*` writers are in `adws/github/githubAppAuth.ts`: `grep -rn "process.env.GH_TOKEN\s*=\|process.env.GIT_AUTHOR\|process.env.GIT_COMMITTER" adws --include="*.ts" --include="*.tsx" | grep -v __tests__`.
- Confirm the only ambient-`GH_TOKEN` consumer is the subprocess env: `getSafeSubprocessEnv()` callers are `adws/agents/claudeAgent.ts:118` and `adws/jsonl/schemaProbe.ts:58` (the latter only probes the CLI schema — no `git`/`gh`, so it does not need the overlay).

### Step 2 — Add the `subprocessEnv` seam to the agent chokepoints
- In `adws/agents/claudeAgent.ts`, add a trailing optional parameter `subprocessEnv?: NodeJS.ProcessEnv` to `runClaudeAgentWithCommand`. Change `const spawnEnv = getSafeSubprocessEnv();` to merge the overlay: `const spawnEnv = { ...getSafeSubprocessEnv(), ...(subprocessEnv ?? {}) };`. Keep the existing `ADW_WORKTREE_PATH`/`ADW_MAIN_REPO_PATH` injection. Ensure both retry respawns (`spawnOptions` reuse) inherit the merged env (they already reuse `spawnOptions`). Do **not** import `GitContext` here — the param is a plain env map, keeping the agent runner decoupled and unit-testable.
- In `adws/agents/commandAgent.ts`, add `subprocessEnv?: NodeJS.ProcessEnv` to `CommandAgentOptions`, destructure it in `runCommandAgent`, pass it as the new trailing arg to `runClaudeAgentWithCommand`, and forward it into the corrective retry-loop respawn (`runRetryLoop` → its `runClaudeAgentWithCommand` call).

### Step 3 — Thread `gitContext.commandEnv()` from the agent runners
- For each `git`/`gh`-touching agent runner (`buildAgent.ts`, `gitAgent.ts`, `prAgent.ts`, `patchAgent.ts`, `refactorAgent.ts`, `documentAgent.ts`, `reviewAgent.ts`, `resolutionAgent.ts`, `installAgent.ts`), add an optional `subprocessEnv?: NodeJS.ProcessEnv` parameter (or accept a `gitContext?` and compute `gitContext.commandEnv()` internally — pick one shape and apply it consistently) and forward it to `runCommandAgent`/`runClaudeAgentWithCommand`.
- Keep the param optional so existing test call sites compile unchanged.

### Step 4 — Pass each phase's context env to its agent calls
- In `buildPhase.ts`, `prPhase.ts`, `documentPhase.ts`, `reviewPhase.ts`, `scenarioFixPhase.ts`, `prReviewPhase.ts`, and `reviewPatchHelpers.ts`, pass `gitCtx.commandEnv()` (the `gitCtx` each phase already constructs for its push/read ops) as `subprocessEnv` to the agents they run.
- Where a phase builds `gitCtx` only conditionally (e.g. `prPhase` self-host branch), fall back to `config.gitContext?.commandEnv()`. `config.gitContext` is the launch-boundary context produced by `initializeWorkflow` (`workflowInit.ts:141/455`) and already read by `diffEvaluationPhase`/`autoMergePhase`.
- Rationale to preserve in a short code comment at the seam: the subprocess receives per-command auth from the launch-boundary context, never from a process-global (PRD Auth model).

### Step 5 — Verify the new path with the global writes still present
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` — must pass.
- Run `bun run test:unit` — must pass (existing claudeAgent test mocks `getSafeSubprocessEnv` → `{}`; the merge of `{}` with an undefined overlay is unchanged).
- This checkpoint proves the subprocess can be authenticated via the overlay before any global write is removed.

### Step 6 — Delete the process-global writers in `githubAppAuth.ts`
- Remove `activateGitHubAppAuth`, `refreshTokenIfNeeded`, and `configureGitIdentity`. Keep the `isGitHubAppConfigured`/`getInstallationToken` re-exports and `readLocalRepoInfo` import only if still needed. Rewrite the header comment to describe the file as a pure re-export shim with **no** `process.env` writes.
- In `adws/github/index.ts`, delete the `activateGitHubAppAuth` and `refreshTokenIfNeeded` exports (lines 71-72).

### Step 7 — Remove every now-dead caller and import (compiler-driven)
- `adws/triggers/trigger_webhook.ts`: drop the import (line 19) and the `activateGitHubAppAuth()` startup call (line 292).
- `adws/triggers/trigger_cron.ts`: drop the import (line 16), the startup `activateGitHubAppAuth` (line 72), the interval `refreshTokenIfNeeded` (line 393 → leave `void checkAndTrigger()` in the `setInterval`), and update/remove the stale comment (line 216).
- `adws/phases/workflowInit.ts`: drop the import (line 42), the call (line 133), and the stale comment (lines 130-131).
- `adws/phases/prReviewPhase.ts`: drop the import (line 8) and the call (line 44).
- `adws/triggers/pauseQueueScanner.ts`: drop the import (line 21) and the call (line 117).
- `adws/adwUpgrade.tsx`: drop the import (line 53) and the stopgap call + comment (lines 513-517). Confirm `ensureTargetRepoWorkspace(targetRepo)` (line 518) authenticates via the package's veracious per-command path (absorbed `repoWorkspace.ts`, #700); if it still depended on the ambient global, route it through the per-command auth before removing the stopgap.
- `adws/agents/prAgent.ts`: drop the import (line 9) and the `refreshTokenIfNeeded()` call (line 99).
- Re-run both `tsc` invocations until clean (the compiler surfaces any missed importer).

### Step 8 — Remove the `ALLOWLIST` machinery from the guard
- In `adws/checkGitGhGuard.ts`: delete the `ALLOWLIST` array (line 43) and its JSDoc; delete `const allowed = new Set(ALLOWLIST);` and `if (allowed.has(relPath)) continue;` in `scanFiles`; remove the `ALLOWLIST` mention from the remedy text (line 161) and the header comment (line 8).
- Replace `(${ALLOWLIST.length} allowlisted)` in the runtime print (line 148) with the literal `(0 allowlisted)` so the printed `(\d+) allowlisted` capstone observable remains valid and reads zero. (Alternatively reword to make zero explicit, but keep a `(\d+) allowlisted`-matching token so the epic's shared guard step definitions do not rot.)
<!-- ADW-WARNING: Unresolved (HITL) — this plan preserves a literal `(0 allowlisted)` print so feature-700 §4b (`the git/gh guard reports zero allowlisted files`, a `(\d+) allowlisted` regex in feature-700.steps.ts) keeps passing unchanged. The feature-701 scenario preamble and this project's history instead expect removing the `ALLOWLIST` array to REMOVE the printed count entirely, which BREAKS #700 §4b unless feature-700.steps.ts is updated to treat an absent count as zero. Issue #701 is silent on whether to keep a zero-count print, so it cannot arbitrate: choose either (a) keep `(0 allowlisted)` as a literal — no #700 change needed; or (b) drop the count and update feature-700.steps.ts. The delivered feature-701 §1a asserts only "no violations" (not the count), so it passes under EITHER choice. -->
- Leave `EXEMPT_PACKAGE_DIR`, `EXEMPT_DIR_NAMES`, and the `visitDir` directory-walk skip unchanged — the package directory is now the sole exemption.

### Step 9 — Verify the stopgaps are fully gone
- `grep -rn "activateGitHubAppAuth\|refreshTokenIfNeeded" adws --include="*.ts" --include="*.tsx" | grep -v __tests__` → no production references remain.
- `grep -rn "activateGitHubAppAuth\|refreshTokenIfNeeded\|process.env.GH_TOKEN" adws/adwMerge.tsx adws/adwUpgrade.tsx` → empty.
- `grep -rn "ALLOWLIST" adws/checkGitGhGuard.ts` → empty.

### Step 10 — Write the `@adw-701` BDD scenarios
- Create `features/per-issue/feature-701.feature` tagged `@adw-701 @adw-kojzv6-gitcontext-delete-pr`. Assert observable runtime behaviour only (mirror `feature-700.feature`'s rot-prevention preamble — no opening source files as text). The literal deletions have no isolated harness-drivable RED (the write only fires on a real installation-token mint; the `ALLOWLIST` array is already empty), and the Phase 1 subprocess-env overlay is verified by the Step 11 unit tests — so the BDD set is composed of REGRESSION GUARDS reusing already-registered phrases verbatim (**zero new step phrasing**). The delivered scenarios cover:
  - **§1a Whole-repo guard passes with the package dir the sole exemption.** `When the git/gh guard is run across the repository / Then the git/gh guard reports no violations` (reuse `feature-691` phrases). Doubles as the botched-removal backstop: a dangling `ALLOWLIST.length` makes the guard crash instead of reporting "no violations". <!-- ADW-WARNING: whether to ALSO assert `the git/gh guard reports zero allowlisted files` (feature-700 §4b) is the unresolved keep-vs-remove-count decision flagged at Step 8; §1a passes either way. -->
  - **§1b Each #701-touched non-package file is scanned (not exempt) and clean.** Scenario Outline over `adws/triggers/trigger_webhook.ts`, `adws/adwUpgrade.tsx`, `adws/adwMerge.tsx` via `the git/gh guard scans the file {string}` / `the git/gh guard scanned that file` / `the git/gh guard reports no violation in that file` (reuse `feature-691` phrases) — proving the package directory is the only exemption (real-file scans, not planted fixtures, to keep zero new step-defs).
  - **§2 Interleaved multi-repo events stay token-isolated (no bleed, no process-global mutation).** Reusing #659's two-context recording-runner verbatim: contexts `acme/webapp` (`token-acme`) and `octo/infra` (`token-octo`) with a FOREIGN `process.env.GH_TOKEN` seeded; after interleaving, each command carries its own repo's token in its child env, neither carries the other's, and the parent process env is unchanged. Covers AC#4 (interleaved multi-repo without bleed) and pins the write-deleted world.
  - **§3 Type-check backstop (T22).** `the ADW TypeScript type-check passes` (reuse `feature-504` step) — catches a botched deletion (stopgap removed but import left behind, or `ALLOWLIST.length` referenced after the array is gone) a behaviour test cannot.
- No new step definitions are required: every phrase is already registered (`feature-691` guard phrases, `feature-659`/`gitContextSharedWorld.ts` recording-runner phrases, `feature-504` T22). Do **not** create `feature-701.steps.ts` with redefinitions or Cucumber raises duplicate-definition errors. The #659 shared world's untagged `After` already restores `process.env.GH_TOKEN` for every scenario (including `@adw-701`); no planted-fixture cleanup is needed.

### Step 11 — Unit tests (`.adw/project.md` → Unit Tests: enabled)
- `adws/agents/__tests__/claudeAgent.test.ts`: add cases asserting (a) when `subprocessEnv` is provided, the `spawn` mock is called with an `env` containing those keys/values merged over `getSafeSubprocessEnv()`; (b) when `subprocessEnv` is omitted, the env equals the prior behaviour; (c) `process.env.GH_TOKEN` is never assigned by the runner.
- `adws/github/__tests__/githubAppAuth.test.ts` (create if absent): assert the module no longer exports `activateGitHubAppAuth`/`refreshTokenIfNeeded` and still re-exports `isGitHubAppConfigured`/`getInstallationToken`. (Keep this behavioural, not source-text based.)
- Guard: add/extend a unit test for `scanFiles` proving a raw-`git` source string outside the package yields a violation and there is no allowlist parameter/skip remaining (drive `scanFiles` over a temp fixture set). If a guard unit test does not yet exist, add `adws/__tests__/checkGitGhGuard.test.ts` importing the exported `scanFiles`/`scanSource`.

### Step 12 — Run the full validation matrix (last step)
- Execute every command in **Validation Commands** below. All must exit 0 with zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope (BDD remains the primary gate per the coding guidelines):
- **`claudeAgent` subprocess-env merge** (`adws/agents/__tests__/claudeAgent.test.ts`): the spawned `env` is `getSafeSubprocessEnv()` overlaid with the provided `subprocessEnv`; absent overlay ⇒ unchanged env; the runner performs no `process.env` mutation. The existing harness already mocks `child_process.spawn` and `getSafeSubprocessEnv`, so assertions read `mockSpawn`'s call args.
- **`githubAppAuth` shim** (`adws/github/__tests__/githubAppAuth.test.ts`): the deleted writers are gone; `isGitHubAppConfigured`/`getInstallationToken` still resolve via the re-export.
- **`checkGitGhGuard.scanFiles`** (`adws/__tests__/checkGitGhGuard.test.ts`): a raw `git`/`gh` call string in a scanned (non-package) fixture is a violation; the function signature carries no allowlist parameter and applies no per-file allowlist skip; package-dir files are excluded by the directory walk, not by an allowlist.

### Edge Cases
- **Self-host without a configured GitHub App:** `buildLaunchGitContext` may not yield a context (the resolver fails loudly with no veracious token); `config.gitContext` is `undefined`; the overlay is omitted and the subprocess inherits `gh auth login` credentials via `HOME` — identical to today's `activateGitHubAppAuth()` returning `false`. No regression.
- **Target repo with App installed:** the phase's `gitCtx.commandEnv()` supplies a token minted for that exact `owner/repo`; the subprocess authenticates correctly and as the App identity (commits carry `GIT_AUTHOR_*`/`GIT_COMMITTER_*` from the same overlay).
- **Webhook interleaving two repos:** each event constructs its own per-event `GitContext`; the spawned orchestrator is a fresh single-repo process; no shared mutable global exists to clobber (AC#4 — no bleed).
- **Pure-analysis agents (classify, extract_dependencies, scenario, validation, diff_evaluator) running in a trigger process:** their subprocess does no `git`/`gh`; omitting the overlay leaves them unaffected.
- **Long-running phase vs. installation-token TTL:** per-phase `gitContextFor()` mints a fresh token at phase construction, so the subprocess token is at least as fresh as before; periodic global refresh is removed but token *acquisition/refresh* semantics are explicitly **out of scope** in the PRD. Note this in the PR for the HITL reviewer.
- **Guard `(0 allowlisted)` observable:** retained as a literal so the epic's "zero allowlisted" capstone assertion and any shared `(\d+) allowlisted` step definition stay valid after the array is deleted.
- **`schemaProbe.ts`** still calls `getSafeSubprocessEnv()` for a no-`git`/`gh` CLI probe — intentionally left without an overlay.

## Acceptance Criteria
- No `process.env.GH_TOKEN = …` (nor `process.env.GIT_AUTHOR_*`/`GIT_COMMITTER_* = …`) mutation remains in the hot path: `grep -rn "process.env.GH_TOKEN\s*=\|process.env.GIT_AUTHOR\|process.env.GIT_COMMITTER" adws --include="*.ts" --include="*.tsx" | grep -v __tests__` returns nothing.
- `activateGitHubAppAuth`/`refreshTokenIfNeeded` are deleted and have no remaining production callers/imports.
- The Claude subprocess receives its `GH_TOKEN` + git identity per-invocation from the launch-boundary `GitContext.commandEnv()`; with no context available, behaviour is unchanged (no regression).
- `ALLOWLIST` and its per-file skip are removed from `checkGitGhGuard.ts`; `EXEMPT_PACKAGE_DIR` is the sole exemption; the guard still prints a `(\d+) allowlisted` count reading `0`.
- `bun run lint:git-guard` passes against the whole tree (exit 0) with no allowlist; a raw `git`/`gh` call planted outside the package fails the guard.
- `adwUpgrade.tsx` and `adwMerge.tsx` contain no activate-auth stopgap.
- Full unit + integration suite green; type-check passes for both tsconfigs; `@adw-701` and `@regression` BDD suites pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions (from `.adw/commands.md`):

- `bun run lint` — ESLint across the repo; zero errors.
- `bunx tsc --noEmit` — root type-check; zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws` project type-check; zero errors.
- `bun run build` — `tsc` build; succeeds.
- `bun run test:unit` — Vitest unit + integration suite; all green (includes the new claudeAgent/guard/githubAppAuth tests).
- `bun run lint:git-guard` — runs `bunx tsx adws/checkGitGhGuard.ts`; exits 0 and prints `(0 allowlisted)`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-701"` — the new capstone scenarios pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite has zero new failures.
- Spot-check greps (must each return empty):
  - `grep -rn "process.env.GH_TOKEN\s*=\|process.env.GIT_AUTHOR\|process.env.GIT_COMMITTER" adws --include="*.ts" --include="*.tsx" | grep -v __tests__`
  - `grep -rn "activateGitHubAppAuth\|refreshTokenIfNeeded" adws --include="*.ts" --include="*.tsx" | grep -v __tests__`
  - `grep -rn "ALLOWLIST" adws/checkGitGhGuard.ts`

## Notes
- **Strictly adhere to `.adw/coding_guidelines.md`:** immutability (the overlay builds a *new* env object — never mutate `process.env`), purity / side-effects-at-the-boundary (`commandEnv()` is pure; the only side effect is the per-spawn child env), guard clauses, and files under 300 lines (deleting the writers shrinks `githubAppAuth.ts`; the guard shrinks).
- **Scope reconciliation for the HITL reviewer.** The issue's "Touched Files" list (5 files) is the headline surface; the true change set is larger and the expansion is *grounded*, not scope-creep:
  - The `process.env` writes live in `githubAppAuth.ts`; deleting the exported symbols forces the compiler to touch **every** importer (`trigger_webhook`, `trigger_cron`, `workflowInit`, `prReviewPhase`, `pauseQueueScanner`, `adwUpgrade`, `prAgent`). Leaving any caller would not compile.
  - Per `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` (lines 113 & 230), the writes were retained **solely** for the Claude subprocess and their removal was **explicitly deferred to this issue**. Removing them without first re-sourcing the subprocess env (`claudeAgent.ts`/`commandAgent.ts` + phase threading) would strand `/implement`, `/commit`, `/pull_request`, `/resolve_conflict` with no token against App-auth/target repos — failing AC#1's intent and AC#4 ("full suite green"). The re-sourcing is the heart of the capstone, not an optional extra.
  - `adwMerge.tsx` is listed as touched but already carries no stopgap (it migrated to `buildLaunchGitContext` earlier); this issue verifies that and removes any residue only.
- **Out of scope (per PRD):** auth *acquisition* (App JWT mint, installation-token caching/refresh) is unchanged — only *application* (per-command vs process-global) changes. Consolidating the two parallel boundary constructors (`buildLaunchGitContext` vs `gitContextFor`/`gitContextForSync`) noted in the epic is a separate concern and not addressed here.
- **No new libraries required.** If one were ever needed, the install command is `bun add <package>` (`.adw/commands.md`).
- **Ordering is load-bearing:** Phase 1 (re-source) must land and be verified green **before** Phase 2 (delete). Do not delete the global writes before the subprocess overlay is wired, or the intermediate build will authenticate the subprocess off an unset global.
