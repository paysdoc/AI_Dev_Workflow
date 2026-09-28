# Feature: Per-repo ownership of pause-queue entries and remove-before-spawn resume

## Metadata
issueNumber: `911`
adwId: `gtxas1-per-repo-ownership-o`
issueJson: `{"number":911,"title":"Per-repo ownership of pause-queue entries and remove-before-spawn resume","body":"## Parent PRD\n\n`specs/prd/rate-limit-indefinite-retry.md`\n\n## What to build\n\nGive every pause-queue entry exactly one owning cron, and close the resume race. See PRD section \"Pause queue\" (ownership and remove-before-spawn).\n\nToday every cron process on the host scans every entry in the shared `agents/paused_queue.json`. On 2026-09-22 the devplatform cron and the AI_Dev_Workflow cron burned strikes 1/3 and 2/3 on the same entry 1.9 seconds apart, and the resume path (acquire spawn lock → release → spawn → wait 2 s → remove entry) leaves a window in which a second cron can see the entry, find the lock free, and spawn a duplicate orchestrator.\n\n- The decider from #910 gains the ownership rule: an entry belongs to the cron whose target repo matches the target repo recorded on the entry (`--target-repo` in `extraArgs`); entries with no target repo belong to the self-host cron. A non-owner returns `skip_not_owner` before any other rule.\n- The scanner passes its own launch-boundary repo identity to the decider (the cron already resolves it at startup).\n- On `resume`, the entry is removed from the queue **before** the orchestrator is spawned. If the spawn fails inside the readiness window, the entry is re-appended with its strike count incremented (so a failed spawn still counts toward the budget as it does today).\n\nOrphaned entries whose owning cron is not running are out of scope (PRD \"Out of Scope\").\n\n## Acceptance criteria\n\n- [ ] Decider unit tests: matching target repo → proceeds to the other rules; mismatching → `skip_not_owner`; entry with no target repo and a self-host cron → owned; entry with no target repo and a `--target-repo` cron → not owned\n- [ ] A scan by a non-owning cron leaves the entry's `probeFailures` and `lastProbeAt` untouched and posts no comment\n- [ ] On resume the queue file no longer contains the entry at the moment the child is spawned (observable via the injected spawn seam reading the queue file)\n- [ ] A spawn that exits inside the readiness window re-appends the entry with `probeFailures` incremented\n- [ ] Cron trigger passes its repo identity to the scanner; no new context construction (`bun run lint:git-guard` green)\n- [ ] `bun run test`, `bun run test:unit`, and `bun run lint:git-guard` pass\n\n## Blocked by\n#910 <!-- adw:region-overlap -->\n\n- Blocked by #910\n- Blocked by #908\n\n## Touched Files\n\n- adws/triggers/pauseQueueDecider.ts\n- adws/triggers/__tests__/pauseQueueDecider.test.ts\n- adws/triggers/pauseQueueScanner.ts\n- adws/triggers/__tests__/pauseQueueScanner.test.ts\n- adws/triggers/trigger_cron.ts\n\n## User stories addressed\n\n- User story 18\n- User story 19\n- User story 20\n- User story 21\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-09-25T08:26:15Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-09-25T08:31:22Z","body":"⏸️ **Deferred behind #910 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #910, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #910 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/triggers/pausequeuedecider.ts`\n- `adws/triggers/__tests__/pausequeuedecider.test.ts`\n- `adws/triggers/pausequeuescanner.ts`\n- `adws/triggers/__tests__/pausequeuescanner.test.ts`\n\nThis issue will spawn automatically once #910 merges and closes. To override, remove the `#910 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Feature Description
This is the ownership slice of `specs/prd/rate-limit-indefinite-retry.md` (PRD section "Pause queue"; user stories 18–21, and the decider half of 33/34). It gives every entry in the shared `agents/paused_queue.json` exactly one owning cron process and closes the duplicate-spawn window on the resume path.

Three things change:

1. **The pure decider gains an ownership rule.** `decidePauseQueueAction` takes the scanning cron's identity as a new required input and returns a new `skip_not_owner` action, evaluated before every other rule (before the reset gate, before the verdict). An entry belongs to the cron whose repo matches the `--target-repo` recorded in the entry's `extraArgs`; an entry with no target repo belongs to the self-host cron (the one launched without `--target-repo`). A cron never strikes, refreshes, resumes or evicts an entry it does not own.
2. **The scanner scans as one cron.** `scanPauseQueue` receives the scanning cron's identity through its deps object (the seam #910 left), gates the probe on *owned* entries only (no probe at all when nothing owned is due), and feeds every entry through the decider with that identity. The cron trigger passes the identity it already resolves once at startup — no new `GitContext`, boundary or cwd-derived identity read.
3. **Resume removes the entry before spawning.** `resumeWorkflow` removes the queue entry *before* the orchestrator child exists, so no concurrent reader (another cron tick, the `## Retry` handler) can see an entry whose resume is in flight. If the spawn fails inside the readiness window — early exit, `'error'`, or a synchronous throw — the entry is re-appended with `probeFailures` incremented, so a failed spawn still counts toward the strike budget exactly as it does today. The spawn goes through an injected seam so a test can observe the queue at the moment the child is spawned.

Value: on a host running several crons (the framework's self-host cron plus one `--target-repo` cron per target repository), a paused workflow's three-strike budget is consumed by one process at one cadence, and exactly one process can ever resume it.

## User Story
As an ADW operator running several crons on one host
I want each pause-queue entry to be scanned and resumed by exactly one cron, which removes the entry before it spawns the orchestrator
So that a strike budget is consumed by one process at one cadence and two crons can never spawn duplicate orchestrators for the same issue

## Problem Statement
Every cron process on the host runs `scanPauseQueue` over the whole shared queue. On 2026-09-22 the `paysdoc/devplatform` cron and the `paysdoc/AI_Dev_Workflow` cron each probed and each struck issue #840's entry, burning strikes 1/3 and 2/3 1.9 seconds apart; with three crons the budget can be exhausted in a single probe interval. The budget is therefore shared and non-deterministic across processes, which #910's reset-time gate narrows but does not fix (any cron whose probe returns `failed`/`unknown` after the reset time still strikes).

The resume path has a second, independent race. `resumeWorkflow` acquires the per-issue spawn lock only to verify the canonical claim, releases it, spawns the child, waits two seconds for readiness, and only then removes the entry. A second reader that scans inside that window sees the entry, finds the lock free (the child has not taken its lifetime lock yet), and spawns a second orchestrator for the same issue. The `## Retry` handler (#908) already removes its entry before spawning; the scanner does not.

## Solution Statement
- **Decider (`adws/triggers/pauseQueueDecider.ts`)**: add `ScanningCronIdentity` (`{ repoId: { owner, repo }, selfHost }`), a pure, total read of the entry's `--target-repo` (no mutation, no `process.exit`, unlike `parseTargetRepoArgs`), an exported `isOwnedByScanningCron(entry, scanningCron)` predicate built on the existing case-insensitive `sameRepoIdentity`, the `skip_not_owner` action, and a required `scanningCron` field on `PauseQueueDecisionInput`. Ownership is the first rule in `decidePauseQueueAction`.
- **Resume (`adws/triggers/pauseQueueResume.ts`, new)**: `resumeWorkflow` and its per-entry helpers move out of the scanner (the scanner would otherwise pass the 300-line guideline). `resumeWorkflow(entry, deps)` gains `ResumeDeps = { now?, spawn? }`; after the claim check and lock release it opens the resume log, **removes the entry**, then spawns through `deps.spawn ?? child_process.spawn`. One `try/catch` around spawn + readiness re-appends the entry with `probeFailures + 1` and a fresh `lastProbeAt` on any failure; success no longer removes (already gone) and posts the `resumed` comment as today.
- **Scanner (`adws/triggers/pauseQueueScanner.ts`)**: `PauseQueueScanDeps` becomes `ResumeDeps & { scanningCron }` and the third argument becomes required: `scanPauseQueue(cycleCount, probe, deps)`. The probe gate and the summary line use the owned subset; every entry still goes through the decider (so `skip_not_owner` is a real production path) and the executor treats it as a silent no-op.
- **Cron (`adws/triggers/trigger_cron.ts`)**: the scanner receives the cron's own launch-boundary repo identity, which the cron already resolves at startup. Derive `scanningCron` once from the startup `resolveCronRepo` result that the launch boundary is built from: `{ repoId: cronRepoInfo, selfHost: targetRepo === null }`. These are the same owner/repo and `selfHost` that `buildLaunchBoundary(targetRepo)` sets on `cronBoundary.repoId` and `cronBoundary.gitContext.selfHost`. Dispatch through a small exported `runPauseQueueScanTick(cycleCount, scan?)`, following the file's injectable-tick idiom so the wiring is unit-testable. Zero new context construction; `lint:git-guard` stays green.
- **Harness and docs**:
  - Update the three step-definition call sites so that `bun run test` (whole-repo `tsc`) compiles and the `@adw-902/907/908/910` scenarios keep their meaning. Each call site passes the `acme/widgets` cron explicitly: it owns every entry those rows seed, exactly as `feature-910.feature` anticipates. Never pass an identity derived from the queue's entries.
  - Re-seat feature-812's tick-guard lever. The `--target-repo` cron that must reach it no longer owns it.
  - Make the `@adw-911` scenarios in `features/per-issue/feature-911.feature` pass, together with the rows flagged `@adw-911` in feature-812, 902, 908 and 910.
  - Update the owning living docs, the README tree lines, `known_issues.md` and `.adw/conditional_docs.md`.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/pauseQueueDecider.ts` — the pure decider from #910; gains `ScanningCronIdentity`, the target-repo read, `isOwnedByScanningCron`, `skip_not_owner`, and the required `scanningCron` input. Must stay free of I/O, clock, env and logging.
- `adws/triggers/__tests__/pauseQueueDecider.test.ts` — mock-free decider suite; gains the ownership matrix and the `scanningCron` default in its `decide()` helper.
- `adws/triggers/pauseQueueScanner.ts` — the thin I/O shell; ownership-aware probe gate, required deps with `scanningCron`, `skip_not_owner` executor branch; loses `resumeWorkflow` and its helpers to the new module.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts` — scanner + resume behavioural suite (30 tests today); gains an in-memory fake queue, the non-owner cases, and the remove-before-spawn / re-append cases through the injected spawn seam.
- `adws/triggers/trigger_cron.ts` — resolves `{ repoInfo: cronRepoInfo, targetRepo }` once at startup via `resolveCronRepo`; calls `scanPauseQueue(cycleCount)` today at line 314; gains `scanningCron` and `runPauseQueueScanTick`.
- `adws/triggers/__tests__/trigger_cron.test.ts` — mocks `../pauseQueueScanner` and `../cronRepoResolver` (`targetRepo: null`, `test-owner/test-repo`); the injectable-tick tests (`runPerIssueScenarioSweepTick`) are the idiom to mirror for `runPauseQueueScanTick`.
- `adws/triggers/cronRepoResolver.ts` — read-only: `resolveCronRepo(args, fallback)` returns `{ repoInfo, targetRepo }`; `targetRepo === null` is exactly "self-host cron". `buildCronTargetRepoArgs` always emits `--target-repo owner/repo`, which is why entries paused by the self-host cron's own orchestrators carry its repo name.
- `adws/phases/workflowCompletion.ts` — read-only: `buildPausedWorkflowEntry` writes `extraArgs: ['--target-repo', 'owner/repo']` when the orchestrator ran with a target repo and omits the key otherwise. This is the field ownership reads.
- `adws/core/pauseQueue.ts` — read-only: `PausedWorkflow`, `readPauseQueue`, `removeFromPauseQueue`, `updatePauseQueueEntry` (no-op when the adwId is absent — which is why the re-append must use `appendToPauseQueue`), `appendToPauseQueue` (dedupes by adwId; atomic temp-file write).
- `adws/core/repoIdentityCrossCheck.ts` — read-only: `sameRepoIdentity(a, b)`, the existing case-insensitive owner/repo comparison (pure; only a type import). Reused by the decider.
- `adws/types/agentTypes.ts` — read-only: `RepoIdentity { owner; repo }`.
- `adws/core/orchestratorCli.ts` — read-only: `parseTargetRepoArgs` mutates its array and calls `process.exit(1)` on a malformed value — unusable inside a pure, total decider; the scanner's remaining uses (`resolveEntryRepoInfo`, `resolveEntryBoundary`) move to the resume module unchanged.
- `adws/triggers/retryHandler.ts` — read-only precedent: `resumePausedWorkflow` removes the entry before spawning; unchanged by this issue.
- `adws/triggers/webhookGatekeeper.ts` — read-only: `spawnDetached` returns `void`; not reusable here because the resume path needs the `ChildProcess` for the readiness window, hence the scanner-local `SpawnOrchestrator` seam.
- `adws/triggers/rateLimitProbe.ts` — read-only: `probeRateLimit` and `ProbeClassification`; the cron now passes `probeRateLimit` explicitly.
- `adws/checkGitGhGuard.ts`, `adws/guard/identityRule.ts` — read-only: the lint that must stay green; `readLocalRepoIdentity` is a registered cwd-derived identity reader, so the cron must pass its startup identity through rather than re-reading.
- `features/per-issue/step_definitions/feature-902-queue.steps.ts` (`runOneProbeCycle`, line ~344), `features/per-issue/step_definitions/feature-908.steps.ts` (line ~411), `features/per-issue/step_definitions/feature-910.steps.ts` (`decidePauseQueueAction` call, line ~247) — the only callers outside `adws/`; they must compile under the new signatures and keep their scenarios green.
- `features/per-issue/feature-910.feature` — read-only: its notes (lines ~155–190) prescribe that once this slice lands the decider rows pass `acme/widgets` as the owning identity and the shared scanner step runs as the `acme/widgets` cron.
- `features/per-issue/feature-911.feature` — this issue's BDD scenarios, read-only. Its "Notes for the step definitions" set the harness contract: named scanning crons, the spawn-seam wrapper, overlapping cycles on real timers, the crash-on-first-launch fixture, the held spawn lock, the real cron process, and fictional repositories only. The sections are:
  - §1: the decider's ownership tables.
  - §2: two crons scanning one queue, including the 2026-09-22 replay.
  - §3: remove-before-spawn, the overlapping scan, the failed-spawn re-append and the held spawn lock.
  - §4: a real `trigger_cron.ts --target-repo` process.
  - §5: the type-check and the git/gh guard.
- Rows flagged `@adw-911` in other features, whose steps are unchanged:
  - `features/per-issue/feature-902.feature`: the three-hour journey and the unknown-drop row.
  - `features/per-issue/feature-908.feature`: the still-queued row.
  - `features/per-issue/feature-910.feature`: the four §2 decider outlines and the end-to-end journey.
  - `features/per-issue/feature-812.feature`: the tick-guard row.
- `features/per-issue/step_definitions/feature-812.steps.ts` — the tick-guard lever (`a cron trigger process whose poll tick raises on every cycle`). It is a queue entry with `extraArgs: {}` that a real `--target-repo adw-812-fixture/tick-guard` cron must reach on every tick. Under ownership that cron no longer owns it, so the lever must be re-seated (step 8). `spawnCron` is the helper feature-911 §4 factors out to launch its real cron.
- `specs/prd/rate-limit-indefinite-retry.md` — parent PRD: "Pause queue" decisions, "Testing Decisions" (pure modules get exhaustive unit tests; shells are observed at injected seams), "Out of Scope" (orphaned entries).
- `app_docs/feature-9gjajh-takeover-and-coordination.md` — owns the scanner, decider and their tests; its `scanPauseQueue(cycleCount, probe?, deps?)`, decision-table, `resumeWorkflow` and `PauseQueueScanDeps` descriptions become false and must be corrected.
- `app_docs/feature-9gjajh-cron-triggers.md` — owns `trigger_cron.ts`; the `checkAndTrigger` description gains the identity hand-off.
- `app_docs/feature-9gjajh-pause-and-auth-queues.md` — owns `pauseQueue.ts`; gains the ownership sentence.
- `README.md` — tree lines for `pauseQueueDecider.ts` / `pauseQueueScanner.ts` (lines ~837–838) and a new line for the resume module.
- `adws/known_issues.md` — the rate-limit entry's solution paragraph (line ~42) gains ownership and remove-before-spawn.
- `.adw/conditional_docs.md` — the takeover-and-coordination `Owns` list gains the new module; the decider condition (line ~245) gains ownership/`skip_not_owner`.
- `.adw/coding_guidelines.md` — guard clauses, max nesting two, extraction for named intent, immutability, explicit types, files under 300 lines, comments only for invariants, no issue numbers in code comments.

### New Files
- `adws/triggers/pauseQueueResume.ts` — `resumeWorkflow`, `resolveEntryRepoInfo`, `postEntryStageComment`, `awaitChildReadiness`, `READINESS_WINDOW_MS`, `SpawnOrchestrator`, `ResumeDeps`. Extracted from the scanner so both files stay under 300 lines and so the remove-before-spawn contract has one home. No new test file: the existing scanner suite already carries the full mock preamble and imports `resumeWorkflow` from the new path.

## Implementation Plan
### Phase 1: Foundation
Extend the pure decider first: the identity type, the total target-repo read, the ownership predicate, the `skip_not_owner` action, and the required `scanningCron` input, with the full unit matrix. Everything downstream is a shell over this rule.

### Phase 2: Core Implementation
Extract the resume path into `pauseQueueResume.ts`, add the spawn seam and the remove-before-spawn ordering with re-append-on-failure. Make the scanner ownership-aware: required deps carrying the identity, owned-only probe gate, `skip_not_owner` no-op. Rebuild the scanner test around an in-memory fake queue so the "queue at the moment of spawn" is observable through the seam.

### Phase 3: Integration
Wire the cron's startup launch-boundary identity into the scan through `runPauseQueueScanTick`. Update the three step-definition call sites so the whole repo type-checks and the existing scenarios run as the explicit `acme/widgets` cron. Re-seat feature-812's tick-guard lever on an entry its `--target-repo` cron owns, and make the `@adw-911` scenarios in `features/per-issue/feature-911.feature` pass. Correct the living docs, README, known issues and conditional docs, then run every validation command.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Confirm the base and the baseline
- The branch is cut from `dev` after PR #916 (#910) and PR #914 (#908) merged; confirm `adws/triggers/pauseQueueDecider.ts` and `adws/triggers/retryHandler.ts` exist (`git log --oneline -5` shows `ebed3a39`).
- Run `bunx vitest run adws/triggers/__tests__/pauseQueueDecider.test.ts adws/triggers/__tests__/pauseQueueScanner.test.ts adws/triggers/__tests__/trigger_cron.test.ts` (85 tests green at planning time) and `bun run lint:git-guard` (green) so regressions are attributable.

### 2. Add the ownership rule to `adws/triggers/pauseQueueDecider.ts`
- Import `type RepoIdentity` from `'../types/agentTypes'` and `sameRepoIdentity` from `'../core/repoIdentityCrossCheck'` (the specific module, not the `../core` barrel — keeps the decider free of the barrel's I/O imports).
- Add and export `interface ScanningCronIdentity { readonly repoId: RepoIdentity; readonly selfHost: boolean }` with a one-line comment: `selfHost` is true for a cron launched without `--target-repo`; `repoId` is the identity that cron resolved at startup.
- Add a module-private, pure, total `parseEntryTargetRepo(extraArgs: readonly string[] | undefined): RepoIdentity | null`: find `--target-repo`, take the next element, split on `/`, require exactly two non-empty parts, else `null`. No array mutation, no `process.exit`, ignores any `--clone-url`. Comment why `parseTargetRepoArgs` is not reused (it splices and exits the process on a malformed value; a queue entry must never be able to kill the cron, and a decider must be total). The read must be total over whatever the queue file actually holds:
  - A non-array `extraArgs` reads as `null`, never a throw. An example is the `{}` that feature-812's tick-guard lever writes. Use an `Array.isArray` guard.
  - A non-string value after the flag also reads as `null`. Use a `typeof` guard.
  - Reason: every cron runs this read over every entry in its ownership filter. A throw here would let one malformed entry abort every cron's tick on the host.
- Add and export `isOwnedByScanningCron(entry: Pick<PausedWorkflow, 'extraArgs'>, scanningCron: ScanningCronIdentity): boolean`: `entryRepo === null ? scanningCron.selfHost : sameRepoIdentity(entryRepo, scanningCron.repoId)`.
- Extend `PauseQueueAction` with `| { readonly kind: 'skip_not_owner' }` and `PauseQueueDecisionInput` with `readonly scanningCron: ScanningCronIdentity` (required — there is no sane default owner).
- In `decidePauseQueueAction`, make the ownership check the first statement, before `isBeforeReset`: `if (!isOwnedByScanningCron(entry, scanningCron)) return { kind: 'skip_not_owner' };`.
- Rewrite the header comment: delete the "Ownership … is a seam left for a later slice" paragraph; state the ownership rule (target repo on the entry vs the scanning cron's repo, compared case-insensitively; no target repo → the self-host cron); add the first decision-table row `| entry not owned by the scanning cron | any | skip_not_owner |` and note it is evaluated before the reset gate, so a non-owner can never strike, refresh, resume or evict.
- The file stays pure: `grep -c "from '../core'\|process.env\|new Date()\|process.exit" adws/triggers/pauseQueueDecider.ts` must print `0`.

### 3. Pin the ownership rule in `adws/triggers/__tests__/pauseQueueDecider.test.ts`
- Give `makeEntry` a default `extraArgs: ['--target-repo', 'acme/widgets']`; add `const ACME_CRON: ScanningCronIdentity = { repoId: { owner: 'acme', repo: 'widgets' }, selfHost: false }`, `const DEVPLATFORM_CRON = { repoId: { owner: 'paysdoc', repo: 'devplatform' }, selfHost: false }` and `const SELF_HOST_CRON = { repoId: { owner: 'paysdoc', repo: 'AI_Dev_Workflow' }, selfHost: true }`; extend the `decide()` helper with a trailing `scanningCron = ACME_CRON` parameter so every existing test keeps passing without an assertion change.
- New `describe('decidePauseQueueAction — ownership')`:
  - matching target repo proceeds to the other rules: `clear` after a past reset → `resume`; `failed` → `count_strike`; before reset → `skip_before_reset`.
  - mismatching target repo (`DEVPLATFORM_CRON` on an `acme/widgets` entry) → `{ kind: 'skip_not_owner' }` for each of the four verdicts, both before and after `resetsAt`, and at `probeFailures: 2` (never `evict`).
  - entry with no `extraArgs` and `SELF_HOST_CRON` → owned (`clear` → `resume`); with `ACME_CRON` → `skip_not_owner`.
  - entry tagged with the self-host cron's own repo (`--target-repo paysdoc/AI_Dev_Workflow`) and `SELF_HOST_CRON` → owned — this is how every orchestrator the self-host cron spawns is tagged, because `buildCronTargetRepoArgs` always emits `--target-repo`.
  - `SELF_HOST_CRON` on an `acme/widgets` entry → `skip_not_owner` for `clear` and for `failed` at `probeFailures: 2`. The self-host cron owns target-less entries and entries recorded for its own repo, and nothing else. This row fails for a fix that hands every entry to the self-host cron (feature-911 §1).
  - `Acme/Widgets` vs `acme/widgets` → owned (case-insensitive, same as `sameRepoIdentity`).
  - malformed values (`['--target-repo']`, `['--target-repo', 'acme']`, `['--target-repo', '/widgets']`) never throw and read as "no target repo": owned by `SELF_HOST_CRON`, `skip_not_owner` for `ACME_CRON`.
  - These also never throw and read as "no target repo" (owned by `SELF_HOST_CRON` only):
    - a non-array `extraArgs`: `{}` cast to the entry type, as a hand-written queue file can hold;
    - a non-string value after the flag: `['--target-repo', 42]`, cast.
  - legacy `['--target-repo', 'acme/widgets', '--clone-url', 'https://…']` → owned by `ACME_CRON`.
- New `describe('isOwnedByScanningCron')` covering the same matrix directly (it is the predicate the scanner's probe gate uses).
- Extend the purity block: the input entry with `extraArgs` is not mutated (the read must not splice), and the decision is deterministic across calls.

### 4. Create `adws/triggers/pauseQueueResume.ts` — remove-before-spawn through an injected spawn seam
- Move verbatim from the scanner: `READINESS_WINDOW_MS`, `resolveEntryRepoInfo` (stays exported, behaviour unchanged, including its `readLocalRepoIdentity()` fallback), `resolveEntryBoundary`, `postEntryStageComment` (now exported — the scanner's `evict` branch needs it), `worktreeExists`, `awaitChildReadiness`, `resumeWorkflow`, and their imports (`child_process`, `fs`, `path`, `AGENTS_STATE_DIR`, `REPO_ROOT`, `parseTargetRepoArgs`, `buildLaunchBoundary`, `readLocalRepoIdentity`, `Platform`/`RepoIdentifier`, `postIssueStageComment`, `WorkflowContext`, `acquireIssueSpawnLock`/`releaseIssueSpawnLock`, `AgentStateManager`, `WorkflowStage`, `log`).
- Add `export type SpawnOrchestrator = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;` and `export interface ResumeDeps { readonly now?: () => Date; readonly spawn?: SpawnOrchestrator }` (`SpawnOptions`/`ChildProcess` are type imports from `child_process`).
- `export async function resumeWorkflow(entry: PausedWorkflow, deps: ResumeDeps = {}): Promise<void>`; resolve `const spawnChild = deps.spawn ?? spawn;` and `const now = deps.now ?? (() => new Date());` inside the function, so the default still binds to the (mockable) `child_process` import at call time.
- New ordering after the canonical-claim check and `releaseIssueSpawnLock`:
  1. `mkdirSync` the log dir and `openSync` the resume log — before the removal, so a failure here leaves the entry in the queue exactly as today.
  2. `removeFromPauseQueue(entry.adwId)` — with a comment stating the invariant: the entry must be gone from the file before the child exists, so a concurrent reader (another tick, the `## Retry` handler) cannot resume it a second time.
  3. `try { const child = spawnChild('bunx', spawnArgs, { detached: true, stdio: ['ignore', logFd, logFd], cwd: REPO_ROOT }); await awaitChildReadiness(child, READINESS_WINDOW_MS); child.unref(); log(success); postEntryStageComment(entry, 'resumed', …); } catch (err) { requeueAfterFailedSpawn(entry, err, resumeLogPath, now); } finally { close the fd }`.
- Extract `requeueAfterFailedSpawn(entry, err, resumeLogPath, now)`: logs `Resume spawn failed for … See <resumeLogPath>` at `'error'`, then `appendToPauseQueue({ ...entry, probeFailures: (entry.probeFailures ?? 0) + 1, lastProbeAt: now().toISOString() })`. It must be `appendToPauseQueue`, not `updatePauseQueueEntry` (a no-op on an entry that is no longer in the file); `appendToPauseQueue`'s adwId dedupe makes a double re-append impossible.
- The worktree-gone and claim-diverged paths are unchanged (they already remove the entry and post their error comment).
- The held-lock skip is also unchanged, and it must stay ahead of the removal:
  - When `acquireIssueSpawnLock` returns `false` (a live process holds the issue's spawn lock), `resumeWorkflow` returns before `removeFromPauseQueue`. The entry stays queued with no strike and no comment.
  - Once the holder is gone, the next clear scan reclaims the stale lock and resumes the entry.
  - Feature-911 §3's held-lock row is green today and must stay green. Moving the removal ahead of the lock check would drop the entry on a skipped resume and strand the workflow.
- Header comment: what the module owns (the per-entry I/O the scanner executes: resume, and best-effort stage comments through the entry's own boundary), the remove-before-spawn invariant, and the re-append-with-strike contract.

### 5. Make `adws/triggers/pauseQueueScanner.ts` ownership-aware
- Imports: `resumeWorkflow`, `postEntryStageComment`, `type ResumeDeps` from `'./pauseQueueResume'`; `isBeforeReset`, `decidePauseQueueAction`, `isOwnedByScanningCron`, `type ScanningCronIdentity`, `type PauseQueueAction`, `type StrikeVerdict` from `'./pauseQueueDecider'`; keep `log`, `PROBE_INTERVAL_CYCLES`, `MAX_UNKNOWN_PROBE_FAILURES` from `'../core'`, the three queue functions, `probeRateLimit`/`ProbeClassification`. Remove every import the extraction made unused (ESLint `no-unused-vars` is part of `bun run lint`).
- `export interface PauseQueueScanDeps extends ResumeDeps { readonly scanningCron: ScanningCronIdentity }`; replace the "so the ownership slice can add…" comment with what it is now: the identity that makes this process the owner of exactly the entries paused for its repo, plus the test seams (clock, spawn).
- Signature: `export async function scanPauseQueue(cycleCount: number, probe: () => ProbeClassification, deps: PauseQueueScanDeps): Promise<void>` — all three required (a defaulted `probe` before a required `deps` would force callers to pass `undefined`; the composition root passes `probeRateLimit` explicitly, as `trigger_cron` already passes `scanAuthQueue` its boundary).
- Flow: cadence gate → `readPauseQueue()` → return on empty → `now` → `const owned = entries.filter(entry => isOwnedByScanningCron(entry, deps.scanningCron))`; if `owned.length === 0`: one log line `Pause queue scan: ${entries.length} paused workflow(s), none owned by this cron (${owner}/${repo}) — probe skipped` and return (this is also the only trace an orphaned entry leaves; fixing orphans is out of scope) → `const due = owned.filter(entry => !isBeforeReset(entry, now))`; if none due: the existing summary line, computed over `owned` (earliest owned `resetsAt`) and return without probing → otherwise log `… ${entries.length} paused workflow(s), ${owned.length} owned by ${owner}/${repo}, ${due.length} due for a probe`, call `probe()` once, and loop over **all** `entries` calling `decidePauseQueueAction({ entry, scanningCron: deps.scanningCron, probe: classification, now, maxProbeFailures: MAX_UNKNOWN_PROBE_FAILURES })` then `executePauseQueueAction(entry, action, now, deps)`.
- Executor: `case 'skip_not_owner': return;` (no per-entry log — the summary line already counts it); `case 'resume'` calls `resumeWorkflow(entry, { now: deps.now, spawn: deps.spawn })`; the other four branches unchanged; the `never` guard stays.
- Extract a small `formatScanSummary`/`ownedLabel` helper only if it keeps the function body at two levels of nesting; the loop body must stay `decide → execute`.
- Update the header comment (the six actions, the owned-only probe gate, the one-owner rule) — no issue numbers. `wc -l` must stay under 300 for both the scanner and the resume module.

### 6. Extend `adws/triggers/__tests__/pauseQueueScanner.test.ts`
- Mock `appendToPauseQueue` alongside `readPauseQueue`/`removeFromPauseQueue`/`updatePauseQueueEntry` in the `../../core/pauseQueue` factory.
- Add an in-memory fake queue: `let queue: PausedWorkflow[] = []`, `function seedQueue(entries)`, and in both `beforeEach` blocks install implementations — read returns `queue`; remove filters by adwId; append pushes unless the adwId is present; update maps. Tests that already use `mockReturnValue([entry])` keep working; the new tests use `seedQueue` so the seam can observe the file's state.
- `import { resumeWorkflow } from '../pauseQueueResume'` (the scanner import keeps `scanPauseQueue`). Add `const OWNER_CRON = { repoId: { owner: 'owner', repo: 'repo' }, selfHost: false }` (the owner of `makeEntry`'s default `--target-repo owner/repo`), `const OTHER_CRON` (`paysdoc/devplatform`), `const SELF_HOST_CRON` (`test-owner/test-repo`, `selfHost: true` — the identity the mocked `readLocalRepoIdentity` returns), and `const deps = { scanningCron: OWNER_CRON, now: () => NOW }`; convert every `scanPauseQueue(1, probe)` to `scanPauseQueue(1, probe, { scanningCron: OWNER_CRON })` and every `scanPauseQueue(1, probe, clock)` to `scanPauseQueue(1, probe, deps)`. No existing assertion changes except the one named below.
- New scanner tests (acceptance: "a scan by a non-owning cron leaves `probeFailures` and `lastProbeAt` untouched and posts no comment"):
  - non-owning cron, `failed` probe: probe **not** called (nothing owned), `updatePauseQueueEntry`/`removeFromPauseQueue`/`childProcess.spawn`/`postIssueStageComment` all uncalled.
  - mixed queue (owned due entry + foreign due entry), `failed` probe: probe called once; only the owned entry's `probeFailures` written; the foreign entry untouched.
  - foreign entry due, owned entry still before its reset time: probe not called; nothing written.
  - legacy entry with no `extraArgs`: `SELF_HOST_CRON` + `clear` → spawned once and resumed; `OWNER_CRON` + `clear` → nothing spawned, nothing written.
  - `clear` with an owned entry and a foreign entry → exactly one spawn, and the foreign entry is still in the queue.
- New resume tests through the injected seam (acceptance: "on resume the queue file no longer contains the entry at the moment the child is spawned"; "a spawn that exits inside the readiness window re-appends the entry with `probeFailures` incremented"):
  - `seedQueue([entry])`; `const spawnSeam = vi.fn((…) => { seenAtSpawn = readPauseQueue().map(e => e.adwId); return child; })`; `resumeWorkflow(entry, { spawn: spawnSeam, now: () => NOW })`; run timers; expect `seenAtSpawn` not to contain `entry.adwId`, `childProcess.spawn` (the default) uncalled, the final queue empty, the `resumed` comment posted, `child.unref` called once.
  - the same through `scanPauseQueue(1, () => ({ verdict: 'clear' }), { ...deps, spawn: spawnSeam })`.
  - early exit: the fake child emits `exit(1)` before the timer → final queue contains `{ ...entry, probeFailures: 1, lastProbeAt: NOW.toISOString() }`, `appendToPauseQueue` called once, `updatePauseQueueEntry` uncalled, no `resumed` comment.
  - `'error'` event before the timer → same re-append.
  - a seam that throws synchronously → `resumeWorkflow` resolves (never rejects), entry re-appended with the strike, fd closed.
  - legacy entry with `probeFailures` absent → re-appended with `1`.
  - re-append on top of an entry already back in the queue (seed it again inside the seam) → no duplicate (dedupe).
  - Rewrite `'early child exit: does not remove from queue and increments probeFailures'` to the new contract (`'early child exit: re-appends the entry with probeFailures incremented'`): the end state contains the entry with `probeFailures: 1`; the `removeFromPauseQueue` negative assertion goes.
  - Happy path: `removeFromPauseQueue`'s `mock.invocationCallOrder[0]` is lower than the spawn seam's — the ordering is the contract.
  - Keep `'aborts when spawn lock is already held by another live process'` and extend it: `appendToPauseQueue` and `updatePauseQueueEntry` are also uncalled, and the entry is still in the fake queue. The skip neither removes nor strikes.

### 7. Wire the cron's identity in `adws/triggers/trigger_cron.ts` and pin it in `adws/triggers/__tests__/trigger_cron.test.ts`
- Right after the `resolveCronRepo` destructuring, add `const scanningCron: ScanningCronIdentity = { repoId: cronRepoInfo, selfHost: targetRepo === null };`.
  - This is the cron's launch-boundary repo identity. `buildLaunchBoundary(targetRepo)` gives `cronBoundary` exactly this owner/repo as `repoId` and this `selfHost` on its `gitContext`.
  - Comment that it comes from the same startup resolution the launch boundary is built from. It is resolved once and never re-read: no `readLocalRepoIdentity()`, no `buildLaunchBoundary`, no `GitContext`.
- Add, following the `runPerIssueScenarioSweepTick` idiom: `export async function runPauseQueueScanTick(cycleCount: number, scan: typeof scanPauseQueue = scanPauseQueue): Promise<void> { await scan(cycleCount, probeRateLimit, { scanningCron }); }` — no cadence gate (the scanner owns `PROBE_INTERVAL_CYCLES`) and no swallow (error semantics unchanged: a throw still reaches `runGuardedTick`). `checkAndTrigger` calls `await runPauseQueueScanTick(cycleCount)` where it called `scanPauseQueue(cycleCount)`.
- Imports: `probeRateLimit` from `'./rateLimitProbe'`; `type ScanningCronIdentity` from `'./pauseQueueDecider'`.
- Test (`describe('runPauseQueueScanTick')`): the injected `scan` is called exactly once with `(cycleCount, expect.any(Function), { scanningCron: { repoId: expect.objectContaining({ owner: 'test-owner', repo: 'test-repo' }), selfHost: true } })` — the mocked `resolveCronRepo` returns `targetRepo: null`, i.e. the self-host shape; a second test asserts the second argument is `probeRateLimit` (import it from `'../rateLimitProbe'`). The existing `vi.mock('../pauseQueueScanner')` stays.

### 8. Keep the BDD harness on the new contract
- `features/per-issue/step_definitions/feature-902-queue.steps.ts`:
  - Factor `runOneProbeCycle`/`runProbeCycles` to take the scanning cron as a parameter rather than copying them. Build `deps` as `{ scanningCron, ...(clockAtCall ? { now: () => clockAtCall } : {}) }`.
  - Export a small `scanningCronFor(repoFullName, { selfHost = false } = {})` helper returning `{ repoId: { owner, repo }, selfHost }` for the other files. "The cron polling the target repository R" is `scanningCronFor(R)`. "The self-host cron on a host checked out at R" is `scanningCronFor(R, { selfHost: true })`.
  - The shared "the pause-queue scanner runs N probe cycle(s)" step passes `scanningCronFor('acme/widgets')` explicitly: that cron owns every entry the 902, 907 and 910 rows seed.
  - Never derive the identity from the queue's entries, and never default a missing one. A cron derived from the entries owns them by construction, so ownership would pass vacuously. It would also void feature-910's end-to-end proof that ownership reads the target repository the real pause path records.
- `features/per-issue/step_definitions/feature-908.steps.ts` (~line 411): `scanPauseQueue(PROBE_INTERVAL_CYCLES, () => ({ verdict: 'clear' }), { scanningCron: scanningCronFor('acme/widgets') })`.
  - This is the Background's cron, "polling the target repository "acme/widgets"". Under it, "relaunched nothing" and "exactly one orchestrator was launched" are proven under the owning cron and cannot pass vacuously.
- `features/per-issue/step_definitions/feature-910.steps.ts` (~line 247): add `scanningCron: scanningCronFor('acme/widgets')` to the decider input, exactly as the feature's notes prescribe ("these rows pass `acme/widgets`, the identity that owns the entry, and keep their meaning").
- `features/per-issue/step_definitions/feature-812.steps.ts`, the tick-guard row (now also `@adw-911`):
  - Why it breaks: the row's lever is a queue entry with `extraArgs: {}` that the `--target-repo adw-812-fixture/tick-guard` cron must reach on every tick. With the total ownership read from step 2, that entry has no target repo, so only a self-host cron owns it. The tick-guard cron's scan returns before `resumeWorkflow`, the tick completes at `POLL:`, and the row times out waiting for `checkAndTrigger: tick failed`.
  - What to do: re-seat the lever on an entry that cron owns (`extraArgs: ['--target-repo', 'adw-812-fixture/tick-guard']`, no reset time, so the CLI stub's clear probe resumes it). Its failure must be raised on every tick before the resume removes the entry or takes the spawn lock, as the feature's FLAGGED note requires.
  - One candidate lever: an owned, due entry with an existing `worktreePath` whose spawn-lock path cannot be written (an `issueNumber` containing `/`). `acquireIssueSpawnLock` then throws before any lock file exists. Verify that it raises on every tick.
  - The scenario text does not change.
  - Do not keep the old lever alive by letting the ownership read throw on a non-array `extraArgs` (see step 2).
- The `@adw-911` scenarios already exist in `features/per-issue/feature-911.feature`, and other features have rows flagged `@adw-911` (see Relevant Files). Their step definitions follow that file's "Notes for the step definitions", whether they are written during the TDD build or in the step-definition phase. The notes cover:
  - widening the 902 hooks to `(@adw-902 or @adw-907 or @adw-910 or @adw-911) and not @adw-908 and not @adw-812`, and the 910 hooks to `@adw-910 or @adw-911`;
  - the cron-qualified scanner and decider steps built on the factored runner;
  - the spawn-seam wrapper, passed as `deps.spawn`, that reads `agents/paused_queue.json` and then delegates to the real `child_process.spawn`;
  - overlapping cycles on real timers;
  - the crash-on-first-launch fixture;
  - the held spawn lock;
  - the real cron launched through feature-812's factored `spawnCron`;
  - fictional repositories only.
- Those step definitions need no production seam beyond the ones this plan adds: `PauseQueueScanDeps.scanningCron`/`spawn`/`now`, plus `PROBE_INTERVAL_CYCLES` and `CLAUDE_CODE_PATH` read from the environment.

### 9. Correct the documentation the change makes false
- `app_docs/feature-9gjajh-takeover-and-coordination.md`: `scanPauseQueue(cycleCount, probe, deps)` with required `deps.scanningCron`; the owned-only probe gate and the "none owned" summary line; the decision table's new first row and that ownership precedes the reset gate; `skip_not_owner` in the executor list; `resumeWorkflow` now in `pauseQueueResume.ts`, removes the entry before spawning and re-appends with a strike on any spawn failure through the `SpawnOrchestrator` seam; `postEntryStageComment`/`resolveEntryRepoInfo` locations; a "Fixed bug" bullet for the 2026-09-22 double-strike and the resume window.
- `app_docs/feature-9gjajh-cron-triggers.md`: `checkAndTrigger` dispatches the pause scan through `runPauseQueueScanTick`, handing over the identity resolved once at startup (`selfHost` = launched without `--target-repo`).
- `app_docs/feature-9gjajh-pause-and-auth-queues.md`: one sentence — every entry has exactly one owning cron (its `--target-repo`; none → the self-host cron).
- `README.md`: the tree comments for `pauseQueueDecider.ts` (add ownership/`skip_not_owner`) and `pauseQueueScanner.ts` (scans as one cron), plus a new line for `pauseQueueResume.ts`.
- `adws/known_issues.md`: extend the rate-limit entry's solution with the one-owner rule and remove-before-spawn.
- `.adw/conditional_docs.md`: add `adws/triggers/pauseQueueResume.ts` to the takeover-and-coordination `Owns` list; extend the decider condition with "ownership (`skip_not_owner`)" and the remove-before-spawn resume. Then `bun run lint:docs-index`.

### 10. Run the validation commands
- Run every command under `Validation Commands`; fix anything red before reporting completion.

## Testing Strategy
### Unit Tests
Vitest (`bun run test:unit`, include `adws/**/__tests__/**/*.test.ts`). Per the PRD's testing decision, the pure decider gets an exhaustive matrix and the shells are observed at their injected seams (the action returned, the queue state the seam sees, the entry the queue ends up holding, the comment posted) — never source text.

- `adws/triggers/__tests__/pauseQueueDecider.test.ts` (mock-free): ownership matrix for `decidePauseQueueAction` and `isOwnedByScanningCron` — match proceeds (resume / strike / reset gate as before); mismatch → `skip_not_owner` for every verdict, before and after the reset, at the strike cap; no target repo → self-host owns, `--target-repo` cron does not; the self-host cron owns entries tagged with its own repo; case-insensitive match; malformed and `--clone-url`-bearing `extraArgs` never throw; purity with `extraArgs` present.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts` (existing mock preamble + in-memory fake queue): all 30 existing cases pass as the owning cron; non-owner scans probe nothing and write nothing; mixed queues probe once and touch only owned entries; a foreign due entry does not trigger the probe; legacy entries resume only under the self-host cron; through the spawn seam the queue is already empty when the child is spawned; early exit / `'error'` / synchronous throw each re-append with `probeFailures + 1` and the injected `lastProbeAt`; dedupe on re-append; remove-then-spawn call order.
- `adws/triggers/__tests__/trigger_cron.test.ts`: `runPauseQueueScanTick` hands the injected scan `(cycleCount, probeRateLimit, { scanningCron })` with the startup identity (`test-owner/test-repo`, `selfHost: true` under the mocked resolver).

### BDD Scenarios
`features/per-issue/feature-911.feature` (`@adw-911`) is the behavioural counterpart. It runs over the real queue file, the probe stub, the fixture orchestrator and the mock GitHub API, and every scan and decision names the cron that makes it.
- §1, the decider tables:
  - The owning cron gets #910's decision unchanged.
  - Any other cron gets `skip_not_owner` before every other rule: before the reset time, on a clear probe, one strike short of eviction, and on a limited probe that reports a reset time.
  - Target-less entries belong to the self-host cron only.
  - The self-host cron owns entries recorded for its own repo, and no other entries.
- §2, two crons scanning one queue:
  - The non-owner leaves `probeFailures`, `lastProbeAt` and `resetsAt` untouched, relaunches nothing and posts nothing. The owner then strikes, evicts, refreshes or resumes.
  - A cron with no owned entry that is due runs no probe.
  - The 2026-09-22 replay runs the `acme/platform` cron against the self-host `acme/adw-host` cron.
- §3, observed through the spawn-seam wrapper:
  - At the moment of the spawn, the entry is already gone from `agents/paused_queue.json`.
  - An overlapping second scan relaunches nothing.
  - A fixture that exits on its first launch is re-queued with one more strike, keeps its target repo, reset time and limit type, and gets no comment. The next clear scan relaunches it.
  - A held spawn lock leaves the entry queued with no strike until the holder dies.
- §4: a real `trigger_cron.ts --target-repo acme/widgets` process (`PROBE_INTERVAL_CYCLES=1`, `CLAUDE_CODE_PATH` pointing at the CLI stub) relaunches its own entry on its first tick and leaves the `acme/gadgets` entry alone. This is the end-to-end proof that the cron hands its identity to the scanner.
- §5: `bun run test` (T22) and the git/gh guard.
- The flagged rows in feature-902, 908 and 910 keep their steps and run as the explicit `acme/widgets` cron. Feature-812's tick-guard row runs with its re-seated lever (step 8).

### Edge Cases
- Entry with no `extraArgs` (an orchestrator launched by hand without `--target-repo`): owned by the self-host cron only.
- Entry tagged with the self-host cron's own repo (`--target-repo paysdoc/AI_Dev_Workflow`): owned by the self-host cron — the normal case for every cron-spawned framework workflow, since `buildCronTargetRepoArgs` always emits `--target-repo`.
- Owner/repo differing only in case: owned (`sameRepoIdentity`); the spawn-lock key still uses the entry's own strings, exactly as today.
- Malformed `--target-repo` value or a missing value: read as "no target repo", never a throw or a `process.exit` from inside the scan.
- A non-array `extraArgs`, as a hand-edited or corrupt queue file can hold (for example `{}`, feature-812's old lever): reads as "no target repo", so only the self-host cron owns it. It never throws in any cron's ownership filter.
- Spawn lock held by a live process when a clear probe resumes: the skip happens before the removal, so the entry stays queued with no strike and no comment. Once the holder dies, the stale lock is reclaimed and the next clear scan resumes the entry.
- Legacy `extraArgs` containing `--clone-url`: ignored by the read; ownership unaffected.
- A foreign entry that is due while every owned entry still waits: no probe, no writes, one summary line.
- Only foreign entries in the queue: one "none owned" line per probe-eligible cycle, nothing else — an orphaned entry (its owning cron not running) is visible in the log but deliberately not handled (PRD out of scope).
- Two crons on one host scanning the same entry inside one interval: exactly one of them can ever act; the other's scan is a pure read.
- `## Retry` and the scanner racing on the same entry: both remove before spawning; whichever removes first wins, the other finds no entry (`## Retry`) or holds no owned due entry (scanner); the per-issue spawn lock still serialises the claim check.
- Overlapping ticks inside one cron (a tick longer than the 20 s poll): the second tick's `readPauseQueue` no longer sees an entry whose resume is in flight.
- Spawn fails after the entry was removed — synchronous throw, `'error'`, or `exit` inside the two-second window: re-appended with `probeFailures + 1` and `lastProbeAt` from the injected clock; the next `clear` probe retries it; a later `failed`/`unknown` at the budget evicts it — the same budget semantics as today.
- Opening the resume log fails before the removal: the entry stays in the queue and the error propagates to `runGuardedTick`, as today.
- Re-append when the entry is somehow already back in the file: `appendToPauseQueue` dedupes by adwId — never two entries.
- Legacy entry with `probeFailures` absent whose spawn fails: re-appended with `1`.
- The worktree-gone and claim-diverged paths still remove the entry and post their error comment; nothing is re-appended there.
- `resolveEntryRepoInfo`'s `readLocalRepoIdentity()` fallback is now only reachable by the self-host cron (the sole owner of entries without a target repo), where it equals the cron's own startup identity.

## Acceptance Criteria
- `decidePauseQueueAction` requires `scanningCron` and returns `{ kind: 'skip_not_owner' }` before any other rule for an entry the scanning cron does not own; unit tests cover: matching target repo → proceeds to the other rules; mismatching → `skip_not_owner`; no target repo + self-host cron → owned; no target repo + `--target-repo` cron → not owned.
- `isOwnedByScanningCron` is exported, pure and total; the decider file imports nothing impure (`grep` guard prints `0`).
- A scan by a non-owning cron never calls the probe for that entry, leaves its `probeFailures` and `lastProbeAt` untouched, removes nothing, spawns nothing and posts no comment (scanner unit tests through the injected seams).
- On `resume`, `removeFromPauseQueue` runs before the spawn seam is invoked. The entry is absent from the queue at the moment the child is spawned, observed at the injected spawn seam in two places:
  - the unit test's seam reads the fake queue;
  - in BDD (feature-911 §3), a wrapper passed through `scanPauseQueue`'s `deps.spawn` reads the real `agents/paused_queue.json` and delegates to `child_process.spawn`.
- A spawn that exits, errors, or throws inside the readiness window re-appends the entry with `probeFailures` incremented and a fresh `lastProbeAt`, without duplicating it. The entry keeps its `extraArgs` (`--target-repo`), `resetsAt` and `rateLimitType`, and no comment is posted.
- A resume skipped because a live process holds the issue's spawn lock leaves the entry queued with no strike (unit test and feature-911 §3).
- `trigger_cron.ts` passes `{ repoId: cronRepoInfo, selfHost: targetRepo === null }` and `probeRateLimit` to the scanner via `runPauseQueueScanTick`; it adds no `buildLaunchBoundary`, `GitContext`, or `readLocalRepoIdentity()` call; `bun run lint:git-guard` is green.
- `scanPauseQueue(cycleCount, probe, deps)` and `resumeWorkflow(entry, deps?)` are the only public shapes; `PauseQueueScanDeps.scanningCron` is required; `pauseQueueResume.ts` exists and both it and the scanner are under 300 lines.
- The three step-definition call sites pass the `acme/widgets` cron explicitly and compile.
- The `@adw-902`, `@adw-907`, `@adw-908` and `@adw-910` scenarios pass as that cron.
- Feature-812's tick-guard row passes with a re-seated lever that the `--target-repo` cron owns.
- The `@adw-911` scenarios pass, including the real-cron row in §4.
- `bun run test`, `bun run test:unit`, `bun run lint`, `bun run lint:git-guard` and `bun run lint:docs-index` pass; the owning app docs, README tree lines, `known_issues.md` and `.adw/conditional_docs.md` are updated.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run test` — whole-repo `tsc --noEmit`, including `features/**` step definitions (the new three-argument `scanPauseQueue` calls and the `scanningCron` decider input).
- `bunx tsc --noEmit -p adws/tsconfig.json` — the `adws/` project type check.
- `bun run test:unit` — the full vitest suite.
- `bunx vitest run adws/triggers/__tests__/pauseQueueDecider.test.ts adws/triggers/__tests__/pauseQueueScanner.test.ts adws/triggers/__tests__/trigger_cron.test.ts` — the three suites this feature owns, in isolation.
- `bun run lint` — ESLint (no unused imports left in the scanner after the extraction; no `any`).
- `bun run lint:git-guard` — git/gh guard: no new shell-outs, no new context construction, no cwd-derived identity fed to a constructor.
- `bun run lint:docs-index` — living-docs index gate after the `.adw/conditional_docs.md` edit.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-902"` — legacy-path scanner scenarios over the real queue file, now scanned as the owning cron.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-907"` — probe/parser scenarios sharing the scanner harness.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-908"` — `## Retry`-on-paused scenarios that also drive `scanPauseQueue`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-910"` — the reset-time scenarios, including the decider rows that now pass the owning identity.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-911"` — this issue's scenarios in `features/per-issue/feature-911.feature`, plus the rows flagged `@adw-911` in feature-812, 902, 908 and 910.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-812"` — the tick-guard row with its re-seated lever, plus the janitor rows. Each launches a real `trigger_cron.ts --target-repo` process.
- `grep -c "from '../core'\|process.env\|new Date()\|process.exit" adws/triggers/pauseQueueDecider.ts` — must print `0` (the decider stays pure and total).
- `wc -l adws/triggers/pauseQueueDecider.ts adws/triggers/pauseQueueScanner.ts adws/triggers/pauseQueueResume.ts` — each under 300.
- `grep -n "removeFromPauseQueue(entry.adwId)\|spawnChild(" adws/triggers/pauseQueueResume.ts` — the final `removeFromPauseQueue` line number is lower than the `spawnChild(` line number (the ordering is the contract).
- `grep -c "buildLaunchBoundary\|readLocalRepoIdentity()" adws/triggers/trigger_cron.ts` — must print the same count as on `dev` (`git show dev:adws/triggers/trigger_cron.ts | grep -c "buildLaunchBoundary\|readLocalRepoIdentity()"`): no new construction or identity read.

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature. Concretely here: the ownership check is a guard clause at the top of the decider; the scanner's loop body stays `decide → execute`; the failed-spawn re-append is an extracted, named function; `readonly` on every new interface and union member; no magic strings for the action kinds beyond the union literals; comments only for the two invariants (ownership precedes the reset gate; the entry is gone before the child exists) and the two non-obvious choices (why not `parseTargetRepoArgs`; why `appendToPauseQueue` rather than `updatePauseQueueEntry`); no issue numbers in code comments; every source file under 300 lines — which is the reason for the `pauseQueueResume.ts` extraction.
- **Decision — a narrow `ScanningCronIdentity`, not `CronRepoResolution` or `LaunchBoundary`.** The decider needs exactly two facts: the cron's owner/repo and whether it is the self-host cron. `CronRepoResolution` drags in `TargetRepoInfo` (clone URL, workspace path) and `LaunchBoundary` carries a `GitContext`; neither belongs in a pure decider's input or in its tests. `trigger_cron` derives the narrow shape from the same `resolveCronRepo` result the boundary is built from, so the identity is resolved exactly once.
- **Decision — the identity is required, and the scanner's third argument with it.** There is no sane default owner: "own everything" silently reinstates the incident, "own nothing" silently strands every entry. Making it required turns a forgotten call site into a compile error. `probe` stays the second positional argument (the contract every existing caller uses) and loses its default, because a defaulted parameter before a required one forces callers to pass `undefined`.
- **Decision — every entry still goes through the decider.** The probe gate uses the owned subset (so a foreign due entry never burns a probe), but the loop feeds all entries to `decidePauseQueueAction`, which returns `skip_not_owner` for the rest. The decider stays the single decision point (PRD story 33), the `skip_not_owner` path is exercised in production, and the executor's no-op is one line.
- **Decision — case-insensitive repo match via the existing `sameRepoIdentity`.** GitHub owner/repo names are case-insensitive and `workspaceBinding` already compares identities this way; introducing a stricter comparison here would let a hand-launched `--target-repo Acme/Widgets` orphan an entry for no benefit.
- **Decision — the self-host cron owns entries tagged with its own repo name.** `buildCronTargetRepoArgs` always emits `--target-repo`, so every orchestrator the self-host cron spawns pauses with `--target-repo <self-host repo>`. The rule "match the entry's target repo against the cron's repo; no target repo → the self-host cron" covers both shapes without a special case. Orphaned entries (owning cron not running) remain out of scope; the "none owned" summary line makes them visible in the cron log.
- **Decision — the resume module is extracted, the test file is not split.** The scanner is 287 lines before this change; the ownership gate, the seam types and the re-append logic would push it past 300. Moving `resumeWorkflow` and its helpers gives the remove-before-spawn contract one home. The existing scanner test file keeps its single mock preamble and imports `resumeWorkflow` from the new path; vitest's module mocks apply to the new module through the same paths.
- **Decision — re-append uses `appendToPauseQueue`.** `updatePauseQueueEntry` maps over the file and is a silent no-op once the entry has been removed — using it would drop the strike and the entry. `appendToPauseQueue` re-inserts the full entry (spread from the in-memory copy, with the incremented strike) and its adwId dedupe rules out a duplicate.
- **Not changed, deliberately.** `resolveEntryRepoInfo`'s `readLocalRepoIdentity()` fallback (only the self-host cron reaches it now, and the value equals its startup identity; folding `scanningCron.repoId` in as the fallback is a reasonable follow-up, but it is not needed for the guard or for correctness); the spawn-lock verification and its release-before-spawn (the child takes the lifetime lock — the lock is not what closes the window, the removal is); the `## Retry` handler (already removes before spawning); `## Cancel`; the in-process wait; the envelope gate.
- The fake spawn seam in the unit tests is a plain function returning an `EventEmitter` with `pid`/`unref` (the existing `makeFakeChild`); `awaitChildReadiness` only needs `once`/`removeListener`, so the seam type can be satisfied by the existing fake cast to `ChildProcess`.
- The `@adw-911` scenarios (`features/per-issue/feature-911.feature`) observe remove-before-spawn at the injected spawn seam, as the issue's acceptance criterion words it. They do not use the `bunx` shadow.
  - A wrapper passed as `deps.spawn` reads `agents/paused_queue.json` synchronously and records whether the entry for the adwId it launches is present. It then hands the same arguments to the real `child_process.spawn`, so the readiness window runs on real timers.
  - The failed-spawn row uses a fixture orchestrator that exits at once on its first launch and stays alive on later launches.
  - The ownership rows scan one queue as two named crons, over fictional repositories only: `acme/widgets`, `acme/gadgets`, `acme/platform`, and `acme/adw-host` for the self-host cron.
  - A non-owner leaving `probeFailures`/`lastProbeAt` untouched and posting nothing is asserted with the feature's last-probe steps and T14 (`the mock harness recorded zero comment posts on issue {int}`).
  - No real repository appears in BDD. `paysdoc/devplatform` stays confined to the hermetic unit tests.
- No new library is needed; nothing to install (`bun add` not required).
