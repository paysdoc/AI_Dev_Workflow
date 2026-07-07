# Feature: Make failed framework upgrades redrivable and bounded (cron redrive + step-6 no-throw)

## Metadata
issueNumber: `730`
adwId: `g5arv0-feat-make-failed-fra`
issueJson: `{"number":730,"title":"feat: make failed framework upgrades redrivable and bounded (cron redrive + step-6 no-throw)","body":"When a framework upgrade fails it becomes stranded and un-redrivable — the recurrence engine behind repeated #UPG stalls (e.g. adwId 72nhdz on 2026-07-07). Part 1: step-6 commitChanges/pushBranch failures return {outcome:'failed'} + post a failure comment instead of throwing. Part 2: a cron redrive scan re-spawns adwUpgrade for a stranded #UPG (open, adw:upgrade, not terminal-labeled, no PR on claim branch, spawn lock absent/stale). Blocked by #729 (already merged via PR #731).","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-07-07T12:31:59Z"}`

## Feature Description

The ADW framework self-upgrade lane (`adwUpgrade.tsx`) regenerates a target repo's `.adw/` directory when the framework content hash drifts from the repo's stored `.adw-version`. Today a **single failure in that lane permanently strands the upgrade**: nothing ever re-runs it, and the process that failed can die mid-run without leaving a trace. This is the recurrence engine behind the repeated `#UPG` stalls (most recently adwId `72nhdz` on 2026-07-07).

This feature makes a failed upgrade **redrivable and bounded** through two changes that ship as one story:

1. **Part 1 — step-6 failures return, not throw.** In `executeUpgrade` step 6, `commitChanges` has no `try/catch` and `pushBranch` re-throws any non-rejection error. Either throw escapes `executeUpgrade`, kills the orchestrator process mid-run, and persists no state or comment. Part 1 converts both into the module's existing handled-failure idiom: post `buildUpgradeFailureComment(...)` and `return { outcome: 'failed', reason: 'commit_error' | 'push_error' }`. This removes the uncaught throw **and** records a failure comment that feeds the existing `MAX_FAILURES` comment-count cap.

2. **Part 2 — cron redrive scan.** `adwUpgrade` is spawned exactly once per hash (by the upgrade-claim winner in `runUpgradeGate`). The claim branch `adw-upgrade-<hash>` is created once and never released on failure, so every later workflow loses the claim and parks — nothing re-invokes the upgrade. The cron never routes `#UPG` issues to `adwUpgrade` (they carry only `adw:upgrade`, which reads as `no_adw_label` and is filtered out). Part 2 adds a dedicated cron pass that re-spawns `adwUpgrade` for a **stranded** `#UPG`, reusing `adwUpgrade`'s own top-of-run idempotency guard and failure cap for correctness and bounding.

Together: Part 1 makes each failure leave a counted comment; Part 2 re-spawns until either the upgrade succeeds or the cap escalates to a human via the existing `adw:blocked` / Slack path. Part 2 without Part 1 would re-spawn an upgrade that crashes without ever posting a comment → `MAX_FAILURES` never trips → unbounded redrive. They must ship together.

Note: the commit crash that triggered the most recent incident (a gitignored path also named in an `:(exclude)` pathspec) is the separate bug **#729**, already merged via PR #731 — `committableExcludePaths` in `adws/gitContext/commitOps.ts`. Part 1 here is the *general* no-throw guard for step 6: it catches any residual commit/push failure (not just the #729 class) so the lane degrades to a counted, redrivable failure rather than a silent crash.

## User Story

As an **ADW operator maintaining target repos on the framework self-upgrade lane**
I want **a failed framework upgrade to be automatically retried a bounded number of times and then escalated to me**
So that **a transient commit/push failure self-heals on the next cron tick instead of permanently stranding the upgrade lane, and a persistent failure surfaces as an `adw:blocked` escalation instead of dying silently**.

## Problem Statement

A failed `adwUpgrade` run is terminal and invisible:

- **Uncaught throw (step 6).** `commitChanges` (`adws/adwUpgrade.tsx:366`) has no `try/catch`; `pushBranch` (`:367-385`) catches only `isPushRejection` and re-throws everything else (`:384`). Either throw escapes `executeUpgrade`, crashes the orchestrator mid-run, stops the heartbeat, and persists **no failure comment** — so even the redrive machinery in Part 2 would have nothing to count.
- **No redrive path.** `runUpgradeGate` (`adws/phases/upgradeGate.ts:151`) spawns `adwUpgrade` only for the claim **winner**, once. The claim branch `adw-upgrade-<hash>` is created once (`adws/core/upgradeClaim.ts`) and never released on failure, so every later workflow re-enters `claimUpgrade(hash)`, loses ("branch already exists"), and **parks** (`upgradeGate.ts:155-166`). The cron's `filterEligibleIssues` drops `#UPG` issues as `no_adw_label` (`adws/triggers/cronLabelEligibility.ts:53`). The idempotency guard + `MAX_FAILURES` escalation at the top of `executeUpgrade` (`adwUpgrade.tsx:237-296`) are built for re-invocation, but **nothing re-invokes them**. Restarting cron does not help.

Result: one one-line commit failure turns a `#UPG` issue into a permanently stuck lane (verified: adwId `72nhdz`, 2026-07-07).

## Solution Statement

Reuse the existing handled-failure idiom and the existing spawn/lock/cap primitives — add no new state and no new `#UPG`→`adwId` mapping.

- **Part 1 (`adwUpgrade.tsx`):** wrap `commitChanges` in `try/catch` (→ post failure comment, `return { outcome: 'failed', reason: 'commit_error' }`) and replace the non-rejection `throw error` in the `pushBranch` catch with the same idiom (`reason: 'push_error'`). The `isPushRejection` → `claim_lost` path is unchanged. Each failure now posts a `buildUpgradeFailureComment(...)`, which `countUpgradeFailureComments` already counts toward `MAX_FAILURES`.

- **Part 2 (new `adws/triggers/upgradeRedrive.ts` + wiring in `trigger_cron.ts`):** a dedicated cron pass over the already-fetched open issues that selects each **stranded** `#UPG` and re-spawns `adwUpgrade.tsx <UPG#> …` via `spawnDetached`. A `#UPG` is stranded when it is open, carries `adw:upgrade`, is **not** terminal-labeled (`adw:blocked`), has **no PR on its claim branch** (any state), and its per-issue spawn lock (keyed by `issueNumber`, so no new mapping) is **absent or held by a dead PID**. The predicate mirrors `adwUpgrade`'s own top-of-run guards, so it is a cheap pre-filter and `adwUpgrade`'s idempotency guard remains the source of truth. Bounding is inherited: each redrive posts one failure comment (Part 1); on the Nth re-spawn `executeUpgrade`'s cap gate applies `adw:blocked` + Slack; the next redrive pass sees the terminal label and stops.

The design follows the codebase's pure-decision + dependency-injection pattern (as in `cronLabelEligibility.ts`, `mergeDispatchGate.ts`, `upgradeGate.ts`): a pure `decideUpgradeRedrive(signals)` decision plus a thin composing scanner that derives signals from real I/O behind injectable deps.

## Relevant Files

Use these files to implement the feature:

- `adws/adwUpgrade.tsx` — **Part 1.** `executeUpgrade` step 6 (`:364-385`). Wrap `commitChanges`; convert the `pushBranch` non-rejection `throw` to a handled failure. `buildUpgradeFailureComment` (`:153`) and `UpgradeRunResult` (`:64-68`, `reason` is a free `string` so no union to extend) are already present.
- `adws/__tests__/adwUpgrade.test.ts` — **Part 1 unit tests.** Extend with commit/push failure cases. `makeDeps(overrides)` (`:23`) already stubs `commitChanges`/`pushBranch`/`commentOnIssue`; override them to throw.
- `adws/triggers/trigger_cron.ts` — **Part 2 wiring.** `checkAndTrigger` (`:192`) already fetches `issues` (with `labels`) via `fetchOpenIssues` (`:78`) and builds `targetRepoArgs` (`:92`). Add a redrive pass here (reuse the fetched `issues`). `REPO_ROOT`, `spawnDetached`, `cronRepoInfo` are all in scope.
- `adws/triggers/spawnGate.ts` — the per-issue spawn lock. Reuse `readSpawnLockRecord(repoInfo, issueNumber)` (`:88`) + `isProcessLive` for the stale-lock pre-filter (same shape `shouldDispatchMerge` uses). `acquireIssueSpawnLock` (`:52`) already reclaims stale locks inside `adwUpgrade`'s lifecycle, so the cron check is only a pre-filter.
- `adws/triggers/mergeDispatchGate.ts` — **reference pattern.** `shouldDispatchMerge` (`:39`) is the exact "dispatch iff spawn lock is free or dead-PID" pre-filter to mirror (read lock → `null`/empty/dead-PID ⇒ dispatch; live-PID ⇒ defer).
- `adws/phases/upgradeGate.ts` — **reference.** `spawnUpgradeOrchestrator` (`:190-191`) shows the canonical `spawnDetached('bunx', ['tsx', 'adws/adwUpgrade.tsx', String(upgNumber), ...targetRepoArgs])` spawn to reuse. The `#UPG` issue body it writes (`:143-148`) contains the `Claim branch: \`adw-upgrade-<hash>\`` line the redrive scan parses.
- `adws/core/upgradeClaim.ts` — `buildClaimBranchName(hash)` (`:48`) for constructing/validating the claim branch name; `isPushRejectionError` for reference.
- `adws/core/upgradeFailureCap.ts` — `countUpgradeFailureComments` / `UPGRADE_FAILURE_SIGNATURE` (`:7`); the cap that Part 1's comments feed and Part 2 relies on for bounding. No change needed.
- `adws/github/labelManager.ts` — `ADW_UPGRADE_LABEL` (`:20` = `adw:upgrade`) and `ADW_BLOCKED_LABEL` (`:22` = `adw:blocked`, the terminal label) for the predicate.
- `adws/github/prApi.ts` — `defaultFindPRByBranch(branchName, repoInfo)` (`:61`) and `RawPR` (`:10`); the "no PR on claim branch" lookup (any state), identical to `adwUpgrade`'s idempotency guard.
- `adws/triggers/cronIssueFilter.ts` / `adws/triggers/cronLabelEligibility.ts` — confirm `#UPG` issues fall through as `no_adw_label` (`cronLabelEligibility.ts:53`) and are therefore invisible to the standard candidate loop; the redrive pass is independent and must not disturb them.
- `.adw/scenarios.md` — the regression-suite contract: `## Per-Issue Scenario Directory` = `features/per-issue/`, `## Regression Scenario Directory` = `features/regression/`. Because both are configured, per-issue scenarios are tagged `@adw-730` and **`@regression` promotion is a deliberate human decision surfaced in Output — never auto-promoted** (see #729 precedent, `features/per-issue/feature-729.feature`).
- `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — **required reading** (conditional_docs: owns `adwUpgrade.tsx`, `upgradeFailureCap.ts`, `commitOps.ts`). Documents the entry gate, failure-cap escalation, `commitChanges` `excludePaths`, and the `committableExcludePaths` (#729) fix. Update its Gotchas/Contracts to record the step-6 no-throw behaviour.

### New Files

- `adws/triggers/upgradeRedrive.ts` — the redrive decision + scan module:
  - `parseClaimBranch(issueBody: string): string | null` — pure; extracts `adw-upgrade-<hash>` from the `Claim branch: \`…\`` line of a `#UPG` body.
  - `UpgradeRedriveSignals` + `decideUpgradeRedrive(signals): { redrive: boolean; reason: string }` — pure guard-clause decision (order: `closed` → `not_upgrade` → `terminal` → `pr_present` → `live_lock` → `redrive`).
  - `UpgradeRedriveDeps` + `findRedrivableUpgrades(issues, repoInfo, deps): number[]` — composing evaluator that derives signals (claim-PR lookup, spawn-lock liveness) and returns the `#UPG` numbers to re-spawn.
  - `runUpgradeRedriveScan(issues, repoInfo, targetRepoArgs, deps?)` — spawns `adwUpgrade` for each returned number via `spawnDetached`; plus `buildDefaultUpgradeRedriveDeps(...)`.
- `adws/triggers/__tests__/upgradeRedrive.test.ts` — unit tests for `parseClaimBranch`, `decideUpgradeRedrive` (truth table), and `findRedrivableUpgrades` (composing).
- `features/per-issue/feature-730.feature` — BDD scenario(s) tagged `@adw-730 @adw-g5arv0-feat-make-failed-fra` (authored by the scenario phase).

## Implementation Plan

### Phase 1: Foundation — Part 1 (step-6 no-throw)

Make step-6 failures observable and countable before any redrive can re-invoke them. This is the prerequisite for bounding: without a posted failure comment, `MAX_FAILURES` never trips. Change `executeUpgrade` step 6 so `commitChanges` and the non-rejection `pushBranch` error both post `buildUpgradeFailureComment(...)` and return `{ outcome: 'failed', reason }`, matching the existing `worktree_error` / `llm_failed` / `regen_incomplete` idiom. Add unit tests. After this phase the orchestrator can never crash out of step 6, and every step-6 failure leaves exactly one counted comment.

### Phase 2: Core Implementation — Part 2 predicate + scan module

Build the pure redrive decision and the composing scanner in a new, fully unit-tested `adws/triggers/upgradeRedrive.ts`, with all I/O injected. Nothing is wired into the live cron yet, so this phase is inert and safe. The predicate mirrors `adwUpgrade`'s top-of-run guards so the cron pass is a cheap pre-filter and `adwUpgrade` remains the correctness authority.

### Phase 3: Integration — wire the scan into the cron; scenario proof

Call `runUpgradeRedriveScan` from `checkAndTrigger` (reusing the already-fetched `issues` and `targetRepoArgs`), as an independent pass that does not touch the standard candidate loop. Add the `@adw-730` per-issue scenario proving the end-to-end redrive decision (stranded → re-spawn; terminal / PR-present / live-lock → left alone). Update the owning app_doc. Run the full validation suite.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1 — Part 1: convert step-6 commit failure to a handled return
- In `adws/adwUpgrade.tsx` `executeUpgrade` step 6 (around `:365-366`), wrap `deps.commitChanges(...)` in a `try/catch`.
- On catch: call `deps.commentOnIssue(issueNumber, buildUpgradeFailureComment(String(error), adwId, issueNumber), repoInfo)` and `return { outcome: 'failed', reason: 'commit_error' }` — identical shape to the `worktree_error` block (`:310-317`).
- Keep `deps.writeAdwVersion(...)` (`:365`) as-is; it is a trivial local write outside the issue's two named throw sites. (If you choose to guard it, fold it into the same `try` and keep `reason: 'commit_error'` — note the decision in the PR.)

### Task 2 — Part 1: convert step-6 push non-rejection throw to a handled return
- In the existing `pushBranch` `catch` (`adwUpgrade.tsx:369-385`), leave the `isPushRejection(error)` → `return { outcome: 'completed', reason: 'claim_lost' }` branch **unchanged**.
- Replace the final `throw error;` (`:384`) with: `deps.commentOnIssue(issueNumber, buildUpgradeFailureComment(String(error), adwId, issueNumber), repoInfo)` then `return { outcome: 'failed', reason: 'push_error' }`.

### Task 3 — Part 1: unit tests for step-6 no-throw
- Extend `adws/__tests__/adwUpgrade.test.ts` with a `describe('executeUpgrade — step 6 commit/push failures')` block using `makeDeps(overrides)`:
  - `commitChanges` throws → `executeUpgrade` resolves (does not reject) with `outcome: 'failed'`, `reason: 'commit_error'`; `commentOnIssue` called once with a body starting `UPGRADE_FAILURE_SIGNATURE`; `pushBranch` and `createPullRequest` **not** called.
  - `pushBranch` throws a non-rejection error (`isPushRejection` stub returns `false`) → `outcome: 'failed'`, `reason: 'push_error'`; failure comment posted; `createPullRequest` **not** called.
  - `pushBranch` throws with `isPushRejection` stub returning `true` → still `outcome: 'completed'`, `reason: 'claim_lost'`, and **no** failure comment (regression guard: the loser path stays silent).
  - The posted failure comment is not an ADW workflow comment (reuse the existing `isAdwComment` assertion style) so it still feeds `countUpgradeFailureComments`.

### Task 4 — Part 2: pure claim-branch parser + redrive decision
- Create `adws/triggers/upgradeRedrive.ts`.
- `parseClaimBranch(issueBody: string): string | null` — match the `Claim branch: \`adw-upgrade-<hash>\`` line written by `runUpgradeGate` (`upgradeGate.ts:146`); return the branch or `null` when absent/malformed. Keep it tolerant (case-insensitive heading, backtick-wrapped value).
- Define `UpgradeRedriveSignals` (`isOpen`, `hasUpgradeLabel`, `isTerminalLabeled`, `hasClaimPr`, `spawnLockHeldByLiveProcess`: booleans) and `decideUpgradeRedrive(signals): { redrive: boolean; reason: string }` as a pure guard-clause function in strict order: `!isOpen → { redrive:false, reason:'closed' }`; `!hasUpgradeLabel → { redrive:false, reason:'not_upgrade' }`; `isTerminalLabeled → 'terminal'`; `hasClaimPr → 'pr_present'`; `spawnLockHeldByLiveProcess → 'live_lock'`; else `{ redrive:true, reason:'stranded' }`. The leading `isOpen` guard encodes the issue's "issue is open" clause (and the Solution Statement's "it is open" stranded condition) at the pure-decision level so a **closed** `#UPG` is never redriven — scenario §4 asserts `closed → redrivable:false`. In production `findRedrivableUpgrades` only ever receives open issues (from `fetchOpenIssues`), so the guard is defensive but keeps the decision complete and unit-testable. Scenario §4 drives this decision over the `isOpen` / label / `hasClaimPr` signals with `spawnLockHeldByLiveProcess:false`; the lock signal is proven by the sweep tests (§5) and the `decideUpgradeRedrive` truth table (Task 6).

### Task 5 — Part 2: composing scanner + default deps + spawn
- In the same module, define `UpgradeRedriveDeps`:
  - `findClaimPr(issueBody: string): RawPR | null` — production: `parseClaimBranch(body)` then `defaultFindPRByBranch(branch, repoInfo)`; `null` branch ⇒ `null`.
  - `readSpawnLock(issueNumber): { pid: number; pidStartedAt: string } | null` — `readSpawnLockRecord(repoInfo, issueNumber)`.
  - `isProcessLive(pid, pidStartedAt): boolean` — from `core/processLiveness`.
  - `spawn(upgNumber, targetRepoArgs): void` — `spawnDetached('bunx', ['tsx', 'adws/adwUpgrade.tsx', String(upgNumber), ...targetRepoArgs])`.
  - `log`.
- `findRedrivableUpgrades(issues, repoInfo, deps): number[]` — for each issue, build labels set, derive signals (`isOpen` from the issue state; label checks; `hasClaimPr = deps.findClaimPr(body) !== null`; `spawnLockHeldByLiveProcess` from the lock record + `isProcessLive`, mirroring `shouldDispatchMerge`'s `null`/empty-`pidStartedAt`/dead-PID = not-held logic), call `decideUpgradeRedrive`, collect numbers where `redrive === true`.
- `runUpgradeRedriveScan(issues, repoInfo, targetRepoArgs, deps = buildDefault…)` — call `findRedrivableUpgrades`, `log` each redrive with its reason, and `deps.spawn(n, targetRepoArgs)` per match.
- `buildDefaultUpgradeRedriveDeps(repoInfo)` — wire the production implementations above.
- Keep the file focused and under the 300-line guideline; use guard clauses (no nesting > 2).

### Task 6 — Part 2: unit tests for the redrive module
- Create `adws/triggers/__tests__/upgradeRedrive.test.ts`:
  - `parseClaimBranch`: extracts `adw-upgrade-<hash>` from a realistic `#UPG` body (as built by `runUpgradeGate`); returns `null` for a body with no claim-branch line.
  - `decideUpgradeRedrive` truth table: stranded (upgrade label, not terminal, no PR, no live lock) → `redrive:true`; terminal-labeled → `pr_present`? no — `terminal`; PR present → `pr_present`; live lock → `live_lock`; non-upgrade issue → `not_upgrade`; dead-PID lock and absent lock → `redrive:true`.
  - `findRedrivableUpgrades` (composing, injected deps): a fixture of several issues (a stranded `#UPG`, a terminal-labeled `#UPG`, a `#UPG` with a claim PR, a `#UPG` with a live lock, and a normal non-upgrade issue) returns exactly the stranded `#UPG` number; assert `spawn` is invoked only for it via a `runUpgradeRedriveScan` call with a `vi.fn()` spawn dep.

### Task 7 — Part 2: wire the scan into the cron tick
- In `adws/triggers/trigger_cron.ts` `checkAndTrigger`, after `fetchOpenIssues()` populates `issues` and after `targetRepoArgs` is available, call `runUpgradeRedriveScan(issues, cronRepoInfo, targetRepoArgs)` as its own pass (import from `./upgradeRedrive`).
- Place it so it does not interfere with the cancel/retry scan or `filterEligibleIssues` (the `#UPG` issues are already excluded from `candidates` as `no_adw_label`). Wrap in a defensive `try/catch` that logs and continues (a redrive-scan failure must never abort the tick), consistent with other cron passes.
- Confirm no behavioural change to the standard candidate loop (the redrive pass only ever spawns `adwUpgrade` for `adw:upgrade` issues).

### Task 8 — BDD scenario (`@adw-730`)
- Author `features/per-issue/feature-730.feature`, tagged `@adw-730 @adw-g5arv0-feat-make-failed-fra`, driving the **redrive decision** (`findRedrivableUpgrades` / `runUpgradeRedriveScan`) in-process over a fixture set and asserting the **recorded spawn decisions** (a behavioural artefact — which `#UPG` numbers the scan dispatches), not source-file text:
  - A stranded `#UPG` (open, `adw:upgrade`, no claim PR, dead/absent lock) is selected for re-spawn.
  - A terminal-labeled (`adw:blocked`) `#UPG` is left alone.
  - A `#UPG` with a PR on its claim branch is left alone.
  - A `#UPG` whose spawn lock is held by a live process is left alone.
- Obey the rot-prevention rule: assert against the injected `spawn` invocations / decision list, never against reading `upgradeRedrive.ts`/`adwUpgrade.tsx`/`trigger_cron.ts` as text. Prefer registered vocabulary phrases where they exist; surface any novel phrasing to the maintainer in the agent Output.
- Follow the #729 precedent: do **not** auto-promote to `@regression`. Because `.adw/scenarios.md` configures a `## Regression Scenario Directory`, promotion + vocabulary registration is a human decision; surface the issue's `@regression` request in the Output rather than self-applying it.
- (Optional second scenario for Part 1: drive `executeUpgrade` with a `commitChanges` that throws and assert the tracking issue receives one bot-authored failure comment and the run returns `failed` without crashing — an observable behavioural surface. If the harness can't cleanly observe the injected comment, leave Part 1 to the unit tests in Task 3 and note it in Output.)

### Task 9 — Documentation
- Update `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md`: add a Contract/Gotcha that step 6 `commitChanges` and non-rejection `pushBranch` failures now return `{ outcome: 'failed', reason: 'commit_error' | 'push_error' }` with a posted failure comment (no uncaught throw), and that the cron `upgradeRedrive` scan re-spawns stranded `#UPG` issues bounded by `MAX_FAILURES` (terminal-label short-circuit stops the loop).
- Add a conditional-docs entry (or extend the t6m62c `Owns`/`Conditions`) covering `adws/triggers/upgradeRedrive.ts` and the redrive predicate so future work discovers it.

### Task 10 — Validate
- Run every command in **Validation Commands** below and confirm zero errors and zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope (framework: vitest; command `bun run test:unit`).

- **Part 1 (`adws/__tests__/adwUpgrade.test.ts`, extend):**
  - `commitChanges` throws → `outcome:'failed'`, `reason:'commit_error'`, one non-ADW failure comment posted, `pushBranch`/`createPullRequest` not called, promise does **not** reject.
  - `pushBranch` throws non-rejection → `outcome:'failed'`, `reason:'push_error'`, failure comment posted, no PR opened.
  - `pushBranch` throws rejection (`isPushRejection`→true) → unchanged `claim_lost`, **no** failure comment (guard against Part 1 leaking a comment onto the silent loser path).
- **Part 2 (`adws/triggers/__tests__/upgradeRedrive.test.ts`, new):**
  - `parseClaimBranch` — extracts branch from a real `#UPG` body; `null` on malformed/missing.
  - `decideUpgradeRedrive` — full truth table across the signals (stranded, closed, terminal, pr_present, live_lock, not_upgrade, dead-lock, absent-lock).
  - `findRedrivableUpgrades` / `runUpgradeRedriveScan` — composing test with injected deps: only the stranded `#UPG` is returned and only its number is passed to the `spawn` dep; terminal/PR-present/live-lock/non-upgrade issues are skipped.

### Edge Cases
- `#UPG` body missing the `Claim branch:` line → `parseClaimBranch` returns `null` → `findClaimPr` returns `null` → treated as "no PR" (redrive proceeds; `adwUpgrade`'s own idempotency guard is the backstop). Verified by a unit test.
- Claim PR in any state (OPEN / CLOSED / MERGED) → `hasClaimPr:true` → skip, matching `adwUpgrade`'s idempotency guard which also no-ops for CLOSED PRs.
- Spawn lock present but held by a **live** `adwUpgrade` (an in-flight retry) → skip (no double-spawn); lock with a **dead** PID or absent → redrive (stale reclaim happens inside `adwUpgrade`'s lifecycle).
- Terminal-labeled `#UPG` (`adw:blocked`, already escalated) → never redriven — the loop terminates at the cap.
- Closed `#UPG` (upgrade already succeeded and the tracking issue was closed) → `isOpen:false` → `decideUpgradeRedrive` returns `{ redrive:false, reason:'closed' }`; never redriven. In production `findRedrivableUpgrades` receives only open issues, so this is a defensive guard proven at the unit level (scenario §4).
- Bounding: N consecutive failures each post one comment (Part 1); the Nth `executeUpgrade` hits its cap gate, applies `adw:blocked` + Slack; the next redrive pass short-circuits on the terminal label. No unbounded re-spawn.
- Redrive-scan internal error must not abort the cron tick (defensive `try/catch` in the wiring).
- Standard (non-`#UPG`) issues are untouched by the new pass (they never carry `adw:upgrade`).

## Acceptance Criteria
- A `commitChanges` or non-rejection `pushBranch` failure in `executeUpgrade` returns `{ outcome: 'failed', reason: 'commit_error' | 'push_error' }` with a posted `buildUpgradeFailureComment(...)`, and `executeUpgrade` never throws out of step 6.
- The `isPushRejection` → `claim_lost` path is unchanged and posts no failure comment.
- A stranded `#UPG` (open, `adw:upgrade`, not `adw:blocked`, no PR on its claim branch, spawn lock absent or dead-PID) is re-dispatched by the cron redrive scan via `spawnDetached('bunx', ['tsx', 'adws/adwUpgrade.tsx', <UPG#>, …])`.
- A terminal-labeled `#UPG`, a `#UPG` with a claim-branch PR, and a `#UPG` with a live spawn lock are all left alone by the scan.
- Retries are bounded: failure comments feed `MAX_FAILURES`, and once the cap escalates (`adw:blocked` applied), the redrive scan no longer re-spawns.
- The new redrive pass makes no change to the standard candidate loop's behaviour.
- All unit tests and the `@adw-730` scenario pass; `lint`, `tsc`, and `build` are clean.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — linter clean.
- `bunx tsc --noEmit` — root type-check clean.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type-check clean.
- `bun run test:unit` — full unit suite passes (new Part 1 + Part 2 tests, zero regressions).
- `bun run build` — build succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-730"` — the new per-issue scenario(s) pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite still green (no regressions from the cron wiring).

## Notes
- `.adw/coding_guidelines.md` applies: keep `upgradeRedrive.ts` under 300 lines, pure-decision + DI, guard clauses (max nesting ~2), immutable data, no `any`, side effects only in the composing/default-deps layer. Match the shape of `cronLabelEligibility.ts` and `mergeDispatchGate.ts`.
- No new libraries. (If one were needed, `.adw/commands.md` specifies `bun add <package>`.)
- **#729 is already merged** (PR #731 → `committableExcludePaths` in `commitOps.ts`), satisfying the "Blocked by #729" gate. Part 1 here is the general step-6 no-throw guard; it is complementary to #729, not a duplicate — it catches any residual commit/push failure, not just the gitignored-exclude class.
- **Why the pre-filter mirrors `adwUpgrade`'s own guards:** the redrive predicate (`terminal` / `pr_present` / lock) intentionally duplicates `executeUpgrade`'s entry gate, idempotency guard, and lifecycle lock. This is deliberate — it keeps the cron cheap (avoids spawning a process every 20s that would immediately no-op) while `adwUpgrade` remains the single source of truth for correctness. If the pre-filter is ever wrong (spawns when it shouldn't), `adwUpgrade` returns `pr_already_exists` / `already_escalated` cleanly; if it skips when it should spawn, the next tick retries.
- **No new `#UPG`→`adwId` mapping:** the spawn lock is keyed by `issueNumber` (`getSpawnLockFilePath`), and `adwUpgrade` mints/derives its own `adwId` on spawn, so the redrive path needs only the `#UPG` number.
- Claim-branch resolution parses the `#UPG` body's `Claim branch:` line (authoritative for that specific upgrade attempt, and decoupled from re-computing the framework hash in the cron). An alternative is to recompute `computeFrameworkHash(REPO_ROOT)` + `buildClaimBranchName(hash)`; the body-parse is preferred because it is exact to the stranded issue and needs no framework-repo assumptions. The lookup is injected, so the choice is swappable without touching the pure decision.
- Related memory: `project_adwupgrade_commit_gitignore_deadlock` (this incident + Fault 1/Fault 2 analysis) and `project_adw_self_upgrade_noop_loop` (the byte-identical no-op regen shape that a successful redrive lands as the `.adw-version` bump).
