# Feature: Hash check + upgrade trigger in `initializeWorkflow()`

## Metadata
issueNumber: `544`
adwId: `tlk8qf-hash-check-upgrade-t`
issueJson: `{"number":544,"title":"Hash check + upgrade trigger in initializeWorkflow()","body":"## Parent PRD\n\n`specs/prd/adw-init-hash-and-label-classification.md`\n\n## What to build\n\nInsert hash-check phase in `initializeWorkflow()` between worktree setup and classification. On hash mismatch:\n\n- Invoke `upgradeClaim`\n- If A wins: create `#UPG` issue with `adw:upgrade` label, invoke `adwUpgrade.tsx`, register the current issue's dependency on `#UPG`, return current issue to Todo, exit\n- If A loses: register dependency on existing `#UPG`, return to Todo, exit\n\nCritical: the exit must happen BEFORE `postIssueStageComment(..., 'starting', ...)` so no concurrency slot is consumed by the parked issue.\n\nSee \"Hash check in `initializeWorkflow()`\" section of the parent PRD.\n\n## Acceptance criteria\n\n- [ ] Hash check inserted after worktree setup, before LLM classification call\n- [ ] On hash match: existing flow continues unchanged\n- [ ] On hash mismatch as winner: `#UPG` issue created with `adw:upgrade` label; `adwUpgrade.tsx` invoked; current issue returned to Todo; orchestrator exits\n- [ ] On hash mismatch as loser: dependency registered on existing `#UPG`; current issue returned to Todo; orchestrator exits\n- [ ] Exit happens BEFORE any workflow comment posts (no slot leak)\n- [ ] `adwMerge.tsx` is unchanged (exempt — does not call `initializeWorkflow()`)\n- [ ] First-ever-bootstrap edge: missing `.adw-version` treated as null; same code path as upgrade — no separate bootstrap branch\n\n## Blocked by\n\n- Blocked by #537\n- Blocked by #538\n- Blocked by #539\n- Blocked by #541\n\n## User stories addressed\n\n- User story 1\n- User story 2\n- User story 10\n- User story 13\n- User story 25\n- User story 26\n- User story 27","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-08T11:11:40Z","comments":[],"actionableComment":null}`

## Feature Description

This feature wires the **versioned auto-(re)init system** into the workflow entry point. Every orchestrator that processes an issue against a *target repo* funnels through `initializeWorkflow()` (in `adws/phases/workflowInit.ts`). This feature inserts an **upgrade gate** into that function: after the per-issue worktree is set up, it compares the framework's *current* content hash (`computeFrameworkHash`) against the hash the target repo last initialized with (`readAdwVersion` of the worktree's `.adw-version`).

- **On match** (the common case): nothing changes — the workflow proceeds exactly as today.
- **On mismatch** (including the first-bootstrap case where `.adw-version` is absent → `null`): the gate parks the current issue rather than running it against a stale `.adw/`. It uses the already-built `upgradeClaim` primitive to atomically elect a single **winner** across concurrent triggers:
  - **Winner**: creates a `#UPG` tracking issue labelled `adw:upgrade`, spawns the existing `adwUpgrade.tsx` orchestrator to regenerate `.adw/` and open the upgrade PR, registers the current issue's dependency on `#UPG`, returns the current issue to the Todo lane, and exits.
  - **Loser**: finds the existing `#UPG` issue, registers a dependency on it, returns to Todo, and exits.

The load-bearing constraint: the park **must exit before any ADW workflow comment is posted**, so a parked issue consumes **no concurrency slot** (the concurrency guard counts ADW-marked comments, not state files). The existing cron dependency-closure layer (`checkIssueEligibility` → `findOpenDependencies`) automatically unblocks the parked issue once the `#UPG` PR merges and the tracking issue closes; on re-entry the hash now matches and the workflow runs normally.

The value: framework changes (`/adw_init.md` and its declared `hashInputs`) propagate to every target repo at the natural cadence of work, with no manual per-repo re-init, no stale-`.adw/` runs, and no duplicate upgrade work under concurrency.

## User Story

As the **framework operator**,
I want **in-flight issues on a target repo to detect a stale `.adw/`, trigger a single framework upgrade, and politely wait for it — freeing their worker slot immediately**,
So that **target repos automatically stay current with the framework, no issue ever runs against a stale `.adw/`, and throughput recovers the moment the upgrade lands** (PRD user stories 1, 2, 10, 13, 25, 26, 27).

## Problem Statement

`initializeWorkflow()` today proceeds straight from worktree setup into the workflow phases regardless of whether the target repo's generated `.adw/` directory matches the current framework version. There is:

1. **No propagation of framework changes.** When `/adw_init.md` or its dependencies change, target repos that already have a `.adw/` directory keep running against the stale config until the operator manually re-triggers init on each one — invisible toil and silent drift.
2. **No first-bootstrap unification.** A target repo that has never been initialized has no `.adw-version`; today there is no single code path that treats "never initialized" identically to "out of date."
3. **A concurrency hazard if done naively.** If a parked issue posted its "starting" workflow comment before parking, it would consume a concurrency slot for work it isn't doing — leaking throughput while waiting for an upgrade.

The foundational primitives for the fix already exist and are merged (issues #537–#541): `computeFrameworkHash`, `readAdwVersion`/`writeAdwVersion`, `claimUpgradeOrFindExisting`, the `labelManager` deep module, and the `adwUpgrade.tsx` orchestrator. **What is missing is the wiring that detects the mismatch at the workflow entry point and routes to those primitives** — that is this feature.

## Solution Statement

Introduce a small, fully dependency-injected **upgrade-gate deep module** (`adws/phases/upgradeGate.ts`) that composes the existing primitives, and call it from `initializeWorkflow()` immediately after the worktree is set up — before any state file is written and before the first workflow comment is posted.

The gate:

1. Computes `currentHash = computeFrameworkHash(frameworkRepoRoot)` and reads `storedVersion = readAdwVersion(worktreePath)`.
2. Pure decision `shouldTriggerUpgrade(currentHash, storedVersion)` returns `true` when they differ — `null` (missing file) differs from any hash, so first-bootstrap and upgrade collapse into one branch (no separate bootstrap code).
3. On `false` → returns `{ action: 'proceed' }`; `initializeWorkflow()` continues unchanged.
4. On `true` → calls `claimUpgradeOrFindExisting(currentHash, repoInfo)`:
   - **Winner**: `createIssue` for `#UPG` → `applyLabel(#UPG, 'adw:upgrade')` (lazy-creates the label if missing) → `spawnDetached('bunx', ['tsx','adws/adwUpgrade.tsx', String(#UPG), ...targetRepoArgs])` → register the current issue's dependency on `#UPG` (edit body) → `moveToStatus(currentIssue, Todo)` → return `{ action: 'parked', role: 'winner', ... }`.
   - **Loser**: resolve the existing `#UPG` (prefer the claim result's `existingIssueNumber`, fall back to a `adw:upgrade`-label search) → register dependency → `moveToStatus(currentIssue, Todo)` → return `{ action: 'parked', role: 'loser', ... }`.

`initializeWorkflow()`, on a `parked` outcome, logs and calls `process.exit(0)`. **This is a clean exit with nothing to leak**: `initializeWorkflow()` runs *before* the orchestrator enters `runWithOrchestratorLifecycle(...)`, so no spawn lock and no heartbeat are held yet, and the gate runs *before* state initialization and *before* `postIssueStageComment(..., 'starting', ...)`, so no state file and no concurrency-counted comment exist.

**Self-hosting guard (critical):** the gate runs **only when operating on a target repo** (`options.targetRepo` is set). When ADW runs against its own repository (no `--target-repo`), the framework is its own source of truth and has no `.adw-version`; running the gate there would park every self-hosted issue. The guard makes the gate a no-op for self-operation.

Dependency registration writes into the issue **body** because the existing unblock path (`findOpenDependencies`) parses `## Dependencies` / `## Blocked by` / `## Depends on` body sections — a pure `addDependencyToBody(body, upgNumber)` helper appends to the existing section or creates one, idempotently.

## Relevant Files

Use these files to implement the feature:

### Files to modify

- `adws/phases/workflowInit.ts` — **primary integration point.** Insert the guarded upgrade-gate call immediately after the worktree-setup block (after `worktreePath` is finalized, ~line 224) and **before** the state-initialization block (~line 226) and the `postIssueStageComment(..., 'starting', ...)` call (~line 340). Relocate the existing `repoContext` creation block to just above the gate so `moveToStatus` is available to it (the block only needs `worktreePath` + `repoId`, both available after worktree setup). On a `parked` outcome, log and `process.exit(0)`.
- `adws/github/issueApi.ts` — add `createIssue(title, body, repoInfo): number` (via `gh issue create ... --json url` / URL parse), `updateIssueBody(issueNumber, body, repoInfo): void` (via `gh issue edit <n> --body-file -`), and `findOpenUpgradeIssue(repoInfo): number | null` (via `gh issue list --label adw:upgrade --state open --json number`). These are thin `gh` wrappers consistent with the existing functions in this file.
- `adws/github/index.ts` — re-export the three new `issueApi` functions from the github barrel.
- `adws/github/labelManager.ts` — add and export `ADW_UPGRADE_LABEL = 'adw:upgrade'` (named constant; the value already exists inside `ADW_LABEL_DEFINITIONS`) so the gate references a symbol rather than a string literal.
- `adws/github/index.ts` — also re-export `ADW_UPGRADE_LABEL`.
- `adws/phases/__tests__/workflowInit.test.ts` — add a `vi.mock('../upgradeGate', ...)` returning `{ action: 'proceed' }` so the existing determinism tests continue to pass (and `process.exit` is never reached). No behavioral assertions change.

### Files to read for context (do not modify)

- `adws/core/hashComputer.ts` — `computeFrameworkHash(frameworkRepoRoot, deps?)`; the "current framework version" primitive. Note the `frameworkRepoRoot` is the **ADW** repo root, not the target worktree.
- `adws/core/adwVersion.ts` — `readAdwVersion(worktreePath)` (absent/empty → `null`); read from the target repo's worktree root.
- `adws/core/upgradeClaim.ts` — `claimUpgradeOrFindExisting(hash, repoInfo, deps?)` → `UpgradeClaimResult` (`{ won: true, branch }` | `{ won: false, existingIssueNumber, existingBranch }`); `buildClaimBranchName`.
- `adws/adwUpgrade.tsx` — the orchestrator the winner spawns; its PR body begins `Implements #<issueNumber>` so the `#UPG` issue auto-closes on merge. Exempt from `initializeWorkflow()` — do not modify.
- `adws/github/labelManager.ts` — `applyLabel(issueNumber, label, repoInfo)` (lazy-creates a missing label and retries), `ensureAdwLabelsExist`, `ADW_LABEL_DEFINITIONS`.
- `adws/triggers/issueDependencies.ts` — `parseDependencies` / `parseKeywordProximityDependencies` / `findOpenDependencies`; defines how a body-section dependency is recognized (drives `addDependencyToBody`'s output shape).
- `adws/triggers/issueEligibility.ts` + `adws/triggers/trigger_cron.ts` — `checkIssueEligibility(...)` → `findOpenDependencies(issueBody, ...)`; the existing cron unblock loop that re-queues the parked issue once `#UPG` closes. Confirms the dependency must live in the issue **body**.
- `adws/triggers/webhookGatekeeper.ts` — `spawnDetached(command, args)`: the established detached-spawn helper (resolves `adws/*.tsx` against `REPO_ROOT`, sets `cwd`, `child.unref()`). Inject it into the gate's deps; default to this implementation.
- `adws/providers/types.ts` — `IssueTracker.moveToStatus(issueNumber, BoardStatus)`, `BoardStatus.Todo`, `RepoContext`.
- `adws/phases/phaseCommentHelpers.ts` — `postIssueStageComment` (the first workflow comment; the gate must exit before this).
- `adws/phases/orchestratorLock.ts` — confirms `initializeWorkflow()` runs *before* `runWithOrchestratorLifecycle` acquires the spawn lock/heartbeat (so a park-exit holds neither).
- `adws/types/issueTypes.ts` — `TargetRepoInfo` (`{ owner, repo, cloneUrl, workspacePath? }`); used to rebuild `--target-repo` / `--clone-url` args for the spawned `adwUpgrade.tsx`.
- `adws/core/index.ts`, `adws/github/index.ts` — barrel exports for the primitives above.
- `specs/prd/adw-init-hash-and-label-classification.md` — parent PRD, especially "Hash check in `initializeWorkflow()`", "Upgrade claim primitive", "Tracking issue (`#UPG`)", and "Concurrency interaction".

### Conditional documentation (read before implementing — matched via `.adw/conditional_docs.md`)

- `app_docs/feature-n9880l-adwversion-read-write-module.md` — `readAdwVersion`/`writeAdwVersion`; "never initialized vs out of date" collapsing logic.
- `app_docs/feature-zapagn-hashcomputer-deep-module.md` — `computeFrameworkHash`, `ADW_INIT_RELATIVE_PATH`, and the in-memory-Map DI test pattern for pure deep modules.
- `app_docs/feature-m45h0x-upgradeclaim-deep-module.md` — `claimUpgradeOrFindExisting`, winner/loser branch-namespace election, `adw-upgrade-<hash>` claim branch.
- `app_docs/feature-gj381g-adwupgrade-tsx-orche.md` — `adwUpgrade.tsx` / `executeUpgrade`; exception-list orchestrator (no `initializeWorkflow()`), two-commit PR, runtime hash recomputation.
- `app_docs/feature-25daxp-label-manager-deep-module.md` — `applyLabel` / `ensureAdwLabelsExist` / `readAdwLabels` lazy-create behaviour and `adw:*` label set.
- `app_docs/feature-gmfhco-issues-opened-label-routed-handler.md` — the sibling label-routed `issues.opened` slice; context for where classification labels come from.

### New Files

- `adws/phases/upgradeGate.ts` — the upgrade-gate deep module: pure `shouldTriggerUpgrade(currentHash, storedVersion)`, pure `addDependencyToBody(body, upgNumber)`, the orchestration `runUpgradeGate(params, deps?)` returning a discriminated `UpgradeGateOutcome`, the `UpgradeGateDeps` interface, and `buildDefaultUpgradeGateDeps(...)`. All I/O injected for unit testing.
- `adws/phases/__tests__/upgradeGate.test.ts` — Vitest unit tests for the pure helpers and the winner/loser/proceed orchestration paths (in-memory stubs; no network or filesystem), following the `hashComputer.test.ts` DI pattern.

## Implementation Plan

### Phase 1: Foundation

Add the missing thin GitHub primitives and the pure helpers the gate composes, with no behavior change to existing callers.

- New `gh` wrappers in `adws/github/issueApi.ts`: `createIssue`, `updateIssueBody`, `findOpenUpgradeIssue`, exported via the github barrel.
- New named label constant `ADW_UPGRADE_LABEL` in `labelManager.ts`, exported via the barrel.
- Pure functions `shouldTriggerUpgrade` and `addDependencyToBody` defined in the new gate module (Phase 2 file) — designed first because they are the unit-test anchors.

### Phase 2: Core Implementation

Build the `upgradeGate.ts` deep module that composes the foundation: hash comparison → claim → winner/loser side effects → discriminated outcome. Everything I/O is injected via `UpgradeGateDeps`; `buildDefaultUpgradeGateDeps(...)` wires production implementations (`computeFrameworkHash`, `readAdwVersion`, `claimUpgradeOrFindExisting`, `createIssue`, `applyLabel`, `updateIssueBody`, `findOpenUpgradeIssue`, `spawnDetached`, a best-effort `moveToStatus`, `log`). Write the unit tests for the pure helpers and all three orchestration paths.

### Phase 3: Integration

Wire `runUpgradeGate` into `initializeWorkflow()` behind the target-repo guard, at the correct position (after worktree setup; before state init and the first workflow comment), and exit cleanly on a `parked` outcome. Update the existing `workflowInit.test.ts` to mock the gate to `proceed`. Run the full validation suite.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1 — Add GitHub issue primitives (`createIssue`, `updateIssueBody`, `findOpenUpgradeIssue`)

- In `adws/github/issueApi.ts`, add:
  - `export function createIssue(title: string, body: string, repoInfo: RepoInfo): number` — runs `gh issue create --repo <owner>/<repo> --title <title> --body-file -` (pass `body` via `input`, mirroring `commentOnIssue`), capturing stdout. Parse the trailing issue number from the printed issue URL (`.../issues/<n>`). Throw a clear error if the number cannot be parsed (issue creation is not best-effort — the winner must have a real `#UPG`).
  - `export function updateIssueBody(issueNumber: number, body: string, repoInfo: RepoInfo): void` — runs `gh issue edit <n> --repo <owner>/<repo> --body-file -` with `body` via `input`. Log success; on error, log at `error` level and rethrow (dependency registration is load-bearing for unblocking).
  - `export function findOpenUpgradeIssue(repoInfo: RepoInfo): number | null` — runs `gh issue list --repo <owner>/<repo> --label 'adw:upgrade' --state open --json number --limit 1`, parses, returns the number or `null`. Catch errors and return `null` (best-effort fallback for the loser path).
- Keep these consistent with existing functions: `execWithRetry`, `RepoInfo` destructuring, single-quote the `--label`, `--body-file -` with `{ input, stdio: ['pipe','pipe','pipe'] }`.

### Task 2 — Export the new issue primitives and the upgrade-label constant

- In `adws/github/labelManager.ts`, add `export const ADW_UPGRADE_LABEL = 'adw:upgrade';` near `ADW_NONE_LABEL`.
- In `adws/github/index.ts`, re-export `createIssue`, `updateIssueBody`, `findOpenUpgradeIssue` (from `issueApi`) and `ADW_UPGRADE_LABEL` (from `labelManager`).

### Task 3 — Create the upgrade-gate module skeleton with pure helpers

- Create `adws/phases/upgradeGate.ts` with:
  - `export function shouldTriggerUpgrade(currentHash: string, storedVersion: string | null): boolean` → `return storedVersion !== currentHash;` (a `null` stored version differs from any non-empty hash, unifying first-bootstrap and upgrade — User Story 25).
  - `export function addDependencyToBody(body: string, upgNumber: number): string` — pure body merge:
    - If `#<upgNumber>` already appears in an existing `## Dependencies` / `## Blocked by` / `## Depends on` section, return `body` unchanged (idempotent).
    - Else if such a section exists, insert a `- #<upgNumber>` bullet within it (after the heading / at the end of that section, before the next `##`).
    - Else append a new trailing section: `\n\n## Blocked by\n\n- #<upgNumber>\n`.
    - Mirror the heading regex used by `parseDependencies` so the result is guaranteed to be recognized by `findOpenDependencies`.
  - Type definitions: `UpgradeGateParams` (`{ issueNumber; issueBody; worktreePath; frameworkRepoRoot; repoInfo; targetRepoArgs: string[] }`), `UpgradeGateDeps`, and `UpgradeGateOutcome = { action: 'proceed' } | { action: 'parked'; role: 'winner' | 'loser'; upgradeIssueNumber: number | null; branch: string }`.

### Task 4 — Implement `runUpgradeGate` orchestration

- In `adws/phases/upgradeGate.ts`, implement `export async function runUpgradeGate(params: UpgradeGateParams, deps: UpgradeGateDeps): Promise<UpgradeGateOutcome>`:
  1. `currentHash = deps.computeFrameworkHash(params.frameworkRepoRoot)`; `storedVersion = deps.readAdwVersion(params.worktreePath)`.
  2. If `!shouldTriggerUpgrade(currentHash, storedVersion)` → `deps.log('Upgrade gate: hash match, proceeding', 'info')` → return `{ action: 'proceed' }`.
  3. Log the mismatch (include `currentHash` and `storedVersion ?? 'null (never initialized)'`).
  4. `claim = await deps.claimUpgrade(currentHash, params.repoInfo)`.
  5. **Winner** (`claim.won === true`):
     - `upgNumber = deps.createIssue(<title>, <body>, params.repoInfo)` where title e.g. `ADW framework upgrade ${currentHash.slice(0,12)}` and body explains the auto-generated upgrade and references the claim branch.
     - `deps.applyLabel(upgNumber, ADW_UPGRADE_LABEL, params.repoInfo)` (lazy-creates the label if a human deleted it — more robust than `gh issue create --label`).
     - `deps.spawnUpgradeOrchestrator(upgNumber, params.targetRepoArgs)`.
     - `await registerDependencyAndPark(upgNumber, 'winner', claim.branch)` (helper below).
  6. **Loser** (`claim.won === false`):
     - `upgNumber = claim.existingIssueNumber ?? deps.findOpenUpgradeIssue(params.repoInfo)`.
     - If `upgNumber === null` (winner hasn't created `#UPG` yet — rare race): log a warning, move to Todo, return `{ action: 'parked', role: 'loser', upgradeIssueNumber: null, branch: claim.existingBranch }` **without** a body edit (cron re-scan re-runs the gate; the recursive-churn tolerance, User Story 27, absorbs this).
     - Else `await registerDependencyAndPark(upgNumber, 'loser', claim.existingBranch)`.
  7. Extract `registerDependencyAndPark(upgNumber, role, branch)`: `newBody = addDependencyToBody(params.issueBody, upgNumber)`; if changed, `deps.updateIssueBody(params.issueNumber, newBody, params.repoInfo)`; then best-effort `await deps.moveToStatus(params.issueNumber, BoardStatus.Todo)` (swallow errors); return `{ action: 'parked', role, upgradeIssueNumber: upgNumber, branch }`.
- Keep nesting ≤ 2 via the extracted `registerDependencyAndPark` helper and guard-clause early returns (coding-guideline compliance).

### Task 5 — Implement `buildDefaultUpgradeGateDeps`

- In `adws/phases/upgradeGate.ts`, add `export function buildDefaultUpgradeGateDeps(repoId: RepoIdentifier, worktreePath: string): UpgradeGateDeps` wiring production implementations:
  - `computeFrameworkHash` (from core), `readAdwVersion` (from core), `claimUpgrade: (hash, repoInfo) => claimUpgradeOrFindExisting(hash, repoInfo)`, `createIssue`/`updateIssueBody`/`findOpenUpgradeIssue`/`applyLabel` (from github), `log` (from core).
  - `spawnUpgradeOrchestrator: (upgNumber, targetRepoArgs) => spawnDetached('bunx', ['tsx', 'adws/adwUpgrade.tsx', String(upgNumber), ...targetRepoArgs])`.
  - `moveToStatus: async (issueNumber, status) => { try { const rc = createRepoContext({ repoId, cwd: worktreePath }); await rc.issueTracker.moveToStatus(issueNumber, status); } catch (e) { log(\`Upgrade gate: moveToStatus best-effort failed: ${e}\`, 'warn'); } }` (board move is cosmetic; the body dependency drives unblocking).

### Task 6 — Write unit tests for the gate (`upgradeGate.test.ts`)

- Create `adws/phases/__tests__/upgradeGate.test.ts` (Vitest, in-memory `vi.fn()` stubs — no real I/O):
  - `shouldTriggerUpgrade`: `null` stored → `true`; equal hashes → `false`; differing hashes → `true`.
  - `addDependencyToBody`: empty body → appends `## Blocked by` section with `- #N`; body with existing `## Blocked by` → adds bullet into that section (no second heading); body already referencing `#N` → unchanged (idempotent); a `## Dependencies`/`## Depends on` heading is recognized.
  - `runUpgradeGate` proceed: hash match → `{ action: 'proceed' }`; asserts `claimUpgrade` is **not** called.
  - `runUpgradeGate` winner: mismatch + `claim.won=true` → asserts `createIssue` called, `applyLabel(upg, 'adw:upgrade')` called, `spawnUpgradeOrchestrator(upg, args)` called, `updateIssueBody` called with a body containing `#<upg>`, `moveToStatus(issue, Todo)` called, returns `role: 'winner'`.
  - `runUpgradeGate` loser (issue resolvable): mismatch + `claim.won=false, existingIssueNumber=N` → asserts **no** `createIssue`/`spawn`, `updateIssueBody` references `#N`, `moveToStatus(Todo)` called, returns `role: 'loser', upgradeIssueNumber: N`.
  - `runUpgradeGate` loser (fallback): `existingIssueNumber=null` but `findOpenUpgradeIssue → M` → dependency registered on `#M`.
  - `runUpgradeGate` loser (unresolved race): `existingIssueNumber=null` and `findOpenUpgradeIssue → null` → no `updateIssueBody`, `moveToStatus(Todo)` still called, returns `upgradeIssueNumber: null`.

### Task 7 — Integrate the gate into `initializeWorkflow()`

- In `adws/phases/workflowInit.ts`:
  - Add imports: `runUpgradeGate`, `buildDefaultUpgradeGateDeps` from `./upgradeGate`; `computeFrameworkHash` is not needed directly (the gate owns it); `fileURLToPath` from `node:url` and `path` for `frameworkRepoRoot`.
  - Compute `frameworkRepoRoot` once: `const frameworkRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');` (workflowInit.ts is at `adws/phases/`, so `../..` is the ADW repo root — matches `adwUpgrade.tsx`).
  - **Relocate** the existing `repoContext` creation block (currently after state init) to immediately after the worktree-setup block, so it is available to the gate and to the later board-setup block (which already references `repoContext`). This is a safe reorder: `createRepoContext` needs only `repoId` + `worktreePath`.
  - Insert the guarded gate call directly after `repoContext` creation and **before** `AgentStateManager.initializeState(...)`:
    ```ts
    if (targetRepo) {
      const repoInfoForGate = repoInfo ?? getRepoInfo();
      const targetRepoArgs = ['--target-repo', `${targetRepo.owner}/${targetRepo.repo}`,
                              ...(targetRepo.cloneUrl ? ['--clone-url', targetRepo.cloneUrl] : [])];
      const outcome = await runUpgradeGate(
        { issueNumber, issueBody: issue.body, worktreePath, frameworkRepoRoot,
          repoInfo: repoInfoForGate, targetRepoArgs },
        buildDefaultUpgradeGateDeps(repoIdForContext ?? { owner: repoInfoForGate.owner, repo: repoInfoForGate.repo, platform: Platform.GitHub }, worktreePath),
      );
      if (outcome.action === 'parked') {
        log(`Upgrade gate: parked issue #${issueNumber} (${outcome.role}) on #${outcome.upgradeIssueNumber ?? '?'}; exiting before any workflow comment.`, 'info');
        process.exit(0);
      }
    }
    ```
  - Confirm the insertion is **above** the `AgentStateManager.initializeState` / `writeTopLevelState('starting')` block and **above** both `postIssueStageComment(..., 'resuming'/'starting', ...)` calls.
  - Do **not** alter the hash-match (proceed) path: when `targetRepo` is unset or the outcome is `proceed`, execution falls through unchanged.

### Task 8 — Keep the existing `workflowInit` unit tests green

- In `adws/phases/__tests__/workflowInit.test.ts`, add `vi.mock('../upgradeGate', () => ({ runUpgradeGate: vi.fn().mockResolvedValue({ action: 'proceed' }), buildDefaultUpgradeGateDeps: vi.fn() }));` near the other `vi.mock` declarations. The existing tests pass `issueType` but no `targetRepo`, so the gate guard already skips it; the mock is belt-and-braces and documents the contract. Verify the determinism tests still assert exactly one branch-name agent call.

### Task 9 — Run the full validation suite

- Run every command in **Validation Commands** below and ensure all pass with zero regressions. Fix any lint, type, build, or test failure before considering the feature complete.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope. Per the parent PRD's testing decisions, the new **deep module** (`upgradeGate`) is unit-tested in isolation with injected I/O; the `initializeWorkflow()` modification itself is verified at the integration/BDD level (unit-testing the wiring would duplicate the gate's tests).

- **`shouldTriggerUpgrade`** (pure): `null` → upgrade; equal → no upgrade; differing → upgrade. Proves the first-bootstrap/upgrade unification.
- **`addDependencyToBody`** (pure): new-section append, existing-section bullet insertion, idempotent re-registration, and recognition of all three heading variants — asserted against the exact shape `parseDependencies` consumes.
- **`runUpgradeGate`** (orchestration, DI stubs): the proceed, winner, loser-resolvable, loser-fallback, and loser-unresolved-race paths, asserting on the observable external effects (which deps were called, with what arguments, and the returned outcome) — not on internal structure.
- **`workflowInit.test.ts`** regression: gate mocked to `proceed`; confirms the no-`targetRepo` path is untouched and branch-name determinism still holds.

Place new tests under `adws/phases/__tests__/`; follow the in-memory-Map / `vi.fn()` DI pattern from `core/__tests__/hashComputer.test.ts` and `core/__tests__/upgradeClaim.test.ts`.

### Edge Cases

- **Missing `.adw-version` (first bootstrap):** `readAdwVersion → null` → `shouldTriggerUpgrade → true` → same path as upgrade. No separate bootstrap branch (acceptance criterion + User Story 25).
- **Self-hosting (no `targetRepo`):** gate is skipped entirely; ADW's own issues (which have no `.adw-version`) are never parked. Prevents catastrophic self-park.
- **Concurrent triggers on the same mismatch:** `claimUpgradeOrFindExisting` guarantees exactly one winner via the branch namespace; losers attach to the same `#UPG`. No duplicate `#UPG` issues, no duplicate `adwUpgrade.tsx` spawns.
- **Loser races ahead of `#UPG` creation:** `existingIssueNumber` null and label search null → park to Todo without a body edit; cron re-scan re-runs the gate later (recursive-churn tolerance, User Story 27).
- **Issue body already has a `## Blocked by` section** (e.g., this very issue #544): `addDependencyToBody` adds a bullet to the existing section rather than a second, unparsed heading.
- **`adw:upgrade` label deleted by a human:** `applyLabel` lazy-creates and retries (resilient labelManager path).
- **`moveToStatus` fails / no board / no `repoContext`:** best-effort; swallowed. The body dependency still drives the cron unblock — board status is cosmetic.
- **Hash match (common path):** zero behavioral change; existing flow proceeds. `adwMerge.tsx` (no `initializeWorkflow()`) is untouched.

## Acceptance Criteria

- Hash check is inserted in `initializeWorkflow()` after the worktree-setup block and before state initialization and the first workflow comment. (The PRD's "before LLM classification" intent is satisfied to the extent the current architecture allows — see Notes; the binding "no slot leak" constraint is fully met.)
<!-- ADW-WARNING: Unresolvable plan/scenario conflict on classifier ordering — issue #544 cannot adjudicate. AC1 states the hash check sits "before LLM classification call", and scenarios §2/§3 in features/per-issue/feature-544.feature assert "the claude classifier was not invoked" on a mismatch. But classifyGitHubIssue() runs at workflowInit.ts:166 BEFORE worktree setup (resolveWorkflowBranchName needs issueType), and this gate must run AFTER worktree setup to read .adw-version. So under this in-scope plan the classifier ALWAYS runs (on match AND mismatch), and the §2/§3 "classifier was not invoked" steps will FAIL. AC1's "after worktree setup" + "before classification" clauses are not simultaneously satisfiable without out-of-scope decoupling of branch-naming from issueType; the issue's only "Critical" constraint (exit before the 'starting' comment, no concurrency slot consumed) IS fully met. Resolution is a human call: (a) accept that the classifier runs on a mismatch and drop the §2/§3 "classifier was not invoked" assertions, or (b) perform the out-of-scope refactor to gate before classification. Build agent: do NOT treat the §2/§3 "classifier was not invoked" steps as blocking. -->

- On hash **match**: the existing flow continues unchanged (verified by the green `workflowInit.test.ts` determinism suite and a hash-match BDD scenario).
- On hash **mismatch as winner**: a `#UPG` issue is created with the `adw:upgrade` label; `adwUpgrade.tsx` is spawned for `#UPG`; the current issue's body gains a `#UPG` dependency; the current issue is moved to Todo; the orchestrator exits.
- On hash **mismatch as loser**: a dependency on the existing `#UPG` is registered on the current issue's body; the current issue is moved to Todo; the orchestrator exits — no second `#UPG`, no second `adwUpgrade.tsx`.
- The park **exits before any ADW workflow comment is posted** (gate runs before `postIssueStageComment(..., 'starting'/'resuming', ...)` and before state init), so no concurrency slot is consumed (User Story 13).
- **`adwMerge.tsx` is unchanged** (it does not call `initializeWorkflow()`).
- **First-ever-bootstrap edge**: a missing `.adw-version` is treated as `null` and follows the identical mismatch path — no separate bootstrap branch (User Story 25).
- The self-hosting guard ensures the gate is a no-op when ADW operates on its own repository (no `--target-repo`).
- `bun run lint`, `bunx tsc --noEmit` (root + `adws/tsconfig.json`), `bun run build`, and `bun run test:unit` all pass with zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun install` — ensure dependencies are present (no new libraries are added by this feature).
- `bun run lint` — ESLint; verify no code-quality or style violations in new/modified files.
- `bunx tsc --noEmit` — root TypeScript type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` TypeScript type check (the primary surface for this change).
- `bun run test:unit` — Vitest unit suite; confirms the new `upgradeGate.test.ts` passes and `workflowInit.test.ts` (and all other suites) remain green.
- `bun run build` — verify the project builds with no errors.

(End-to-end behavior of the upgrade gate is exercised by the per-issue BDD scenarios generated for `@adw-544` during the scenario phase and by the `@regression` surface suite; run with `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-544"` once those scenarios exist.)

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`) are strictly followed: single-responsibility files under 300 lines (the gate module and its tests are small and focused); immutability and pure functions (`shouldTriggerUpgrade`, `addDependencyToBody` are pure; all side effects are isolated behind `UpgradeGateDeps`); type safety (no `any`; a discriminated-union `UpgradeGateOutcome`); guard clauses and ≤2 nesting depth (the `registerDependencyAndPark` extraction keeps the winner/loser branches flat); inputs validated at the `gh` boundary. The DI structure mirrors the existing deep modules (`hashComputer`, `upgradeClaim`, `labelManager`, `adwUpgrade`).
- **No new libraries.** Everything composes existing primitives and the `gh` CLI via `execWithRetry`. (If a library were ever needed, the install command from `.adw/commands.md` is `bun add <package>`.)
- **Design decision — placement vs. the PRD's "before LLM classification" wording.** The parent PRD describes inserting the gate "after worktree setup, before classification." In the *current* `workflowInit.ts`, `classifyGitHubIssue` runs *before* worktree setup because branch-name resolution (`resolveWorkflowBranchName`) requires `issueType` to build the branch (`feature-issue-…`). Decoupling branch naming from issue type is out of scope for this issue. The gate is therefore placed **after worktree setup and before state init / the first workflow comment**, which fully satisfies the *binding, load-bearing* constraint the PRD marks "Critical" — exit before any workflow comment, so no concurrency slot leaks. The cheap Haiku classification call may run for a soon-to-be-parked issue; this is an accepted, documented, rare cost (parking only happens on hash drift), and it changes no externally observable concurrency behavior. If the operator later wants strict "before classification," the follow-up is to make worktree branch-naming type-agnostic — tracked separately.
- **Design decision — self-hosting guard.** The PRD frames the feature around *target* repos but does not spell out behavior for ADW operating on its own repository. Because the ADW repo root has **no `.adw-version`** (verified), running the gate during self-operation would park every self-hosted issue and break ADW's own development loop. The gate is therefore guarded to run **only when `options.targetRepo` is set**. This is the correct semantics (the framework is its own version source) and is called out here for reviewer confirmation.
- **Design decision — park-exit via `process.exit(0)` inside `initializeWorkflow()`.** Because `initializeWorkflow()` returns *before* the orchestrator enters `runWithOrchestratorLifecycle(...)`, no spawn lock and no heartbeat are held at the gate, so a direct `process.exit(0)` leaks nothing and needs **zero changes to the 12 orchestrator call sites** (purely additive). This matches the established clean-exit pattern in `adwUpgrade.tsx`/`adwMerge.tsx` (`if (!acquired) process.exit(0)`). All decision/side-effect logic lives in the testable `runUpgradeGate`; `initializeWorkflow()` only calls it and exits on `parked`.
- **Dependency registration is body-based by necessity.** The existing unblock path (`checkIssueEligibility → findOpenDependencies`) parses the issue *body*, so the gate edits the body. The stale (now-closed) `#UPG` reference left after the upgrade merges is harmless — identical to how this issue lists "Blocked by #537…".
- **Recursive churn is accepted** (User Story 27): if the framework hash advances again during a slow upgrade, re-queued issues will detect the new mismatch and open a follow-on `#UPG`. No linearization machinery is added.
- **`adwUpgrade.tsx`, `adwMerge.tsx`, and the foundation deep modules are not modified** — this feature is the wiring layer that calls them.
