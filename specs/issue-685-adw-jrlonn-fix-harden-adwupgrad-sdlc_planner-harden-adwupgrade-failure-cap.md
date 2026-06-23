# Feature: Harden adwUpgrade — failure cap + validity-only regen gate + scoped upgrade commit

## Metadata
issueNumber: `685`
adwId: `jrlonn-fix-harden-adwupgrad`
issueJson: `{"number":685,"title":"fix: harden adwUpgrade — failure cap + validity-only regen gate + scoped upgrade commit","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-23T07:31:42Z"}`

## Feature Description

Hardens the framework self-upgrade lane (`adwUpgrade.tsx`) so it can neither silently loop forever nor be reverted by its own commit. The upgrade lane regenerates a target repo's `.adw/` directory whenever the framework content hash drifts from the repo's stored `.adw-version`. Three independent, verified failure modes are fixed together:

- **Part A — validity-only regen gate.** `verifyAdwRegen` currently hard-requires a `.adw/.regen-receipt` file stamped with the current `frameworkHash`. But `adw_init.md` carries **no instruction to write that receipt** (it was added for #614 then deleted by upgrade commit `184b600`), so whether the gate passes depends on whether the LLM happens to write the receipt unprompted — non-deterministic. The gate is changed to prove **validity** (the six `.adw/` files + `vocabulary.md` present and non-empty), not **authorship** (the receipt). A byte-identical no-op regen is valid and should pass, then stamp the hash and resume.

- **Part B — `MAX_FAILURES` cap + escalation.** A failing upgrade posts a comment and exits 0; cron re-dispatches it every tick with no bound, no Slack, no blocked-lane move (#657 looped silently). `adwUpgrade` lives outside the `initializeWorkflow` recovery kernel, so the #639 resume-cap / `human_gated` escalation never applies to it. This adds an upgrade-lane-specific cap: after `MAX_FAILURES` (default 3) failure comments, escalate — apply a terminal `adw:blocked` label, move the board to **Blocked**, post one Slack alert, post a distinct escalation comment, and stop.

- **Part D — scoped upgrade commit.** `commitChanges` uses `git add -A`. The upgrade worktree carries a runtime-copied (gitignored-but-tracked-on-host) `.claude/commands/adw_init.md`; `git add -A` sweeps whatever version the cron host holds into the regen commit — sometimes reverting merged work (this is how the receipt instruction was deleted). `commitChanges` gains an optional `excludePaths` pathspec so the upgrade commit holds out `.claude/commands/adw_init.md` while still committing genuine outputs.

> Note: the issue labels these Part A / Part B / Part D (there is no Part C). This plan preserves that lettering.

## User Story

As the **operator of an unattended ADW host**,
I want the framework self-upgrade lane to **fail loudly and finitely, gate on validity rather than a coin-flip receipt, and never revert merged work through its own commit**,
So that **a stuck upgrade surfaces to a human after a bounded number of attempts instead of burning tokens in a silent re-dispatch loop, and an upgrade PR never silently reverts a previously merged change**.

## Problem Statement

The upgrade lane has three independent defects, all verified against real incidents (#657 froze the head of the GitContext PRD):

1. **Coin-flip receipt gate** — `verifyAdwRegen` (`adws/phases/worktreeSetup.ts`) requires `.adw/.regen-receipt` carrying `frameworkHash === expectedHash`, but nothing instructs the LLM to write it. Passing is non-deterministic; #657 failed 3× then a later run passed by luck.
2. **No failure terminator** — a failed regen posts a non-workflow comment and exits 0. Cron re-dispatches `adw:upgrade` issues every tick with no cap, no human signal, no board move. The lane sits outside the `initializeWorkflow` resume-cap kernel, so #639's `human_gated` escalation does not cover it.
3. **Self-reverting commit** — the regen commit is staged with `git add -A`, which sweeps the runtime-copied `.claude/commands/adw_init.md` (whatever version the host holds) into the upgrade PR. Every historical upgrade commit touched `adw_init.md` (`64fde74` +receipt, `184b600` −17, `e799faa` +44, `1ab2664` −39), sometimes reverting merged work.

## Solution Statement

Implement the three parts against the **post-GitContext-migration** surfaces (the issue is blocked by #661/#662/#663, all merged):

- **Part A:** strip the receipt existence/freshness checks and the dead helpers from `verifyAdwRegen`, dropping the `expectedHash` param; keep the validity checks (six `.adw/` files non-empty + `vocabulary.md`). Untrack and gitignore `.adw/.regen-receipt` so it can never re-enter a commit.
- **Part B:** add a `MAX_FAILURES` env constant; add a pure, unit-tested `core/upgradeFailureCap.ts` (`isUpgradeFailureComment`, `countUpgradeFailureComments`); add two gates to `executeUpgrade` (entry: terminal-label short-circuit; post-PR-guard: failure-cap escalation) returning a new `escalated` outcome; register the `adw:blocked` terminal label so it exists before first use.
- **Part D:** add an optional `opts.excludePaths` to the migrated `commitChanges` (GitContext + `commitOps.ts`) that scopes both the `git add` and the porcelain check via an exclude pathspec; `adwUpgrade` passes `excludePaths: ['.claude/commands/adw_init.md']`. Callers that pass no `opts` are byte-identical to today.

All side effects in `executeUpgrade` remain injected via `UpgradeDeps`, so every new gate is unit-testable without I/O — consistent with the existing test suite.

## Relevant Files

Use these files to implement the feature:

- `adws/adwUpgrade.tsx` — **(Parts A, B, D)** the upgrade orchestrator. Holds `executeUpgrade` (the gates go here), `UpgradeDeps` (new deps), `UpgradeRunResult` (new `escalated` outcome), the comment-builder helpers, and `buildDefaultUpgradeDeps` (wires defaults). Currently calls `deps.verifyAdwRegen(worktreePath, hash)` and `deps.commitChanges(message, cwd)`.
- `adws/phases/worktreeSetup.ts` — **(Part A)** holds `verifyAdwRegen`, `REGEN_RECEIPT_RELATIVE_PATH`, `parseRegenReceiptHash`, `receiptIsFresh` (to remove), `REQUIRED_ADW_FILES` (keep), `copyAdwInitCommandToWorktree` (add receipt gitignore), `ensureGitignoreEntry`.
- `adws/core/config.ts` — **(Part B)** retry/limit constants live here; add `MAX_FAILURES`.
- `adws/core/index.ts` — **(Part B)** barrel; add `MAX_FAILURES` to the `./config` re-export and export the new `upgradeFailureCap` symbols.
- `adws/gitContext/commitOps.ts` — **(Part D)** package-private `commitChanges(run, message, cwd)`; add the optional `excludePaths` pathspec to `git add -A` and `git status --porcelain`.
- `adws/gitContext/gitContext.ts` — **(Part D)** public `commitChanges(message, worktreePath)` method (line ~182) delegating to `commitOps.commitChanges`; thread `opts` through. Also exposes `fetchIssueComments`, `issueHasLabel`, `applyLabel`, `createLabel`, `moveIssueToStatus`, `commentOnIssue` used to wire Part B defaults.
- `adws/github/labelManager.ts` — **(Part B)** owns `ADW_LABEL_DEFINITIONS` + `ensureAdwLabelsExist`; add the `adw:blocked` terminal label definition + an exported `ADW_BLOCKED_LABEL` constant so the label is created before first use.
- `adws/core/slackNotifier.ts` — **(Part B)** `postSlack(text)` (async, no-throw at the boundary) — wired as the Slack escalation dep default.
- `adws/providers/types.ts` — **(Part B, reference)** `BoardStatus.Blocked = 'Blocked'` / `BOARD_COLUMNS` — the target status string for the board move.

### Files to read for context (do not necessarily modify)
- `adws/triggers/webhookGatekeeper.ts` — shows how `adw:upgrade` issues are routed solely to `adwUpgrade.tsx` (the re-dispatch loop the cap terminates).
- `adws/triggers/cancelHandler.ts` — `handleCancelDirective` already clears all GitHub comments; confirms `## Cancel` resets the failure count (no new Cancel code needed).
- `adws/github/issueApi.ts` (`commentOnIssue`), `adws/github/prApi.ts` (`mergePR`, `hasWontFixLabel`) — existing free-function deps wired in `buildDefaultUpgradeDeps`.

### New Files
- `adws/core/upgradeFailureCap.ts` — **(Part B)** pure helpers: `isUpgradeFailureComment(body, author)`, `countUpgradeFailureComments(comments)`, the shared `UPGRADE_FAILURE_SIGNATURE` constant, and an `IssueCommentRecord` type. No I/O.
- `adws/core/__tests__/upgradeFailureCap.test.ts` — **(Part B)** unit tests for the pure helpers.

### Files with new tests (existing test files to extend)
- `adws/__tests__/adwUpgrade.test.ts` — extend `makeDeps` with the new deps; add escalation/entry-gate describes; update the receipt-threading tests to the validity-only signature.
- `adws/phases/__tests__/worktreeSetup.test.ts` — delete receipt-specific cases; add no-op-no-receipt → ok:true and missing/empty-file → ok:false.
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — add `excludePaths` command-string assertions; assert the no-opts path is byte-identical.

### Conditional documentation (from `.adw/conditional_docs.md`)
These match this task's conditions and should be consulted:
- `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — `executeUpgrade()`/`UpgradeDeps`, the `.adw/` regen path (`copyAdwInitCommandToWorktree`, `verifyAdwRegen`), and the `target:` gitignore policy in `worktreeSetup.ts`.
- `app_docs/feature-6zw7n2-hitl-opt-in-adw-yml.md` — `adwUpgrade.tsx`'s gated-merge step and `.github/adw.yml` HITL distinction.
- `app_docs/feature-wrzj5j-harden-project-board-status.md` — `moveIssueToStatus`/`moveToStatus` board transitions (the Blocked move).
- `app_docs/feature-n9880l-adwversion-read-write-module.md` — `writeAdwVersion` / `.adw-version` write-back retained around the new gate.

## Implementation Plan

### Phase 1: Foundation
Establish the shared, pure, low-risk pieces that the orchestrator changes depend on, so each can be unit-tested in isolation before wiring:
- Part A's `verifyAdwRegen` simplification + receipt untracking/gitignore (no orchestrator behaviour change beyond dropping a param).
- Part B's `MAX_FAILURES` constant, the `core/upgradeFailureCap.ts` pure helpers, and the `adw:blocked` label registration.
- Part D's `commitChanges` `excludePaths` extension in `gitContext/commitOps.ts` + `gitContext.ts` (additive; default path unchanged).

### Phase 2: Core Implementation
Wire the foundation into `executeUpgrade`:
- Replace the `verifyAdwRegen` callsite/dep-type (Part A).
- Add the `escalated` outcome, the new `UpgradeDeps` (`fetchIssueComments`, `fetchIssueLabels`, `applyLabel`, `moveToStatus`, `postSlack`, `ensureLabel`, `maxFailures`), the entry gate (terminal-label short-circuit) and the escalation gate (failure-cap), plus the escalation comment/Slack builders (Part B).
- Pass `excludePaths: ['.claude/commands/adw_init.md']` at the regen-commit callsite (Part D).

### Phase 3: Integration
Wire production defaults and prove the system end-to-end:
- `buildDefaultUpgradeDeps` binds the new deps to `gitCtx` methods + `postSlack` + `MAX_FAILURES`.
- `.env.sample` documents `MAX_FAILURES`.
- Extend the three existing test files and add the new helper test; run the full validation suite for zero regressions.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1 — Part A: simplify `verifyAdwRegen` to validity-only
- In `adws/phases/worktreeSetup.ts`:
  - Delete `REGEN_RECEIPT_RELATIVE_PATH` (the exported const), `parseRegenReceiptHash`, and `receiptIsFresh`.
  - Change `verifyAdwRegen(worktreePath: string, expectedHash: string)` to `verifyAdwRegen(worktreePath: string)`. Keep the six-`REQUIRED_ADW_FILES` present-and-non-empty checks and the `features/regression/vocabulary.md` presence check. Remove the receipt existence/freshness block (the `.adw/.regen-receipt (missing)` / `(stale)` pushes). Update the JSDoc to describe a validity-only gate (drop the receipt/claim-vs-verdict prose).
  - In `copyAdwInitCommandToWorktree`, after the existing `ensureGitignoreEntry(worktreePath, '.claude/commands/adw_init.md')`, add `ensureGitignoreEntry(worktreePath, '.adw/.regen-receipt')` so the receipt can never be staged in an upgrade commit (covers target-repo worktrees where the receipt would otherwise be a brand-new untracked file).

### Task 2 — Part A: untrack the receipt in the framework repo
- Run `git rm --cached .adw/.regen-receipt` (it is currently tracked) so it leaves the framework repo's index.
- Add `.adw/.regen-receipt` to the framework root `.gitignore` so it is never re-added on self-host upgrade worktrees.

### Task 3 — Part A: update the `verifyAdwRegen` callsite and dep type in `adwUpgrade.tsx`
- Change `UpgradeDeps.verifyAdwRegen` to `(worktreePath: string) => { ok: boolean; missing: readonly string[] }`.
- Change the callsite (currently `const verify = deps.verifyAdwRegen(worktreePath, hash);`) to `deps.verifyAdwRegen(worktreePath)`.
- Update the surrounding comment block (the "Receipt-freshness gate" prose) to describe a validity-only gate, and change the failure-comment reason fallback from `'receipt absent or stale'` to a validity message, e.g. `\`.adw/ regeneration incomplete: ${verify.missing.join(', ') || 'no .adw/ files produced'}\``.
- The `verifyAdwRegen` import and the `buildDefaultUpgradeDeps` wiring (`verifyAdwRegen,`) stay — only the signature changes.

### Task 4 — Part A: update `worktreeSetup.test.ts`
- Remove the imports of `parseRegenReceiptHash` and `REGEN_RECEIPT_RELATIVE_PATH`.
- Delete the entire `parseRegenReceiptHash` describe block and the `writeReceipt` helper.
- In the `verifyAdwRegen` describe block: drop `expectedHash` from all calls (`verifyAdwRegen(verifyDir)`), delete the receipt-specific cases (fresh-receipt, stale-receipt, receipt-absent), and keep/relabel:
  - **no-op, no receipt** — seed and commit all six `.adw/` files + `vocabulary.md`, write **no** receipt → `ok: true`, `missing` empty (this is the byte-identical no-op the old gate wrongly blocked).
  - **missing required `.adw/` file** → `ok: false`, `missing` contains the file name (preserve the #572 case).
  - **empty required `.adw/` file** (zero bytes) → `ok: false`.
  - **missing `vocabulary.md`** → `ok: false`, `missing` contains `features/regression/vocabulary.md`.
- The `copyClaudeAssetsToWorktree` fixture tests (E4a–E4e) are unchanged.

### Task 5 — Part B: add `MAX_FAILURES` config constant
- In `adws/core/config.ts`, add (in the retry-constants section): `export const MAX_FAILURES = Math.max(1, parseInt(process.env.MAX_FAILURES || '3', 10)) || 3;` with a JSDoc noting it is the upgrade-lane failure cap.
- In `adws/core/index.ts`, add `MAX_FAILURES` to the existing `export { ... } from './config'` list.

### Task 6 — Part B: create the pure `core/upgradeFailureCap.ts` helper
- Create `adws/core/upgradeFailureCap.ts` with no I/O:
  - `export const UPGRADE_FAILURE_SIGNATURE = 'ADW upgrade regeneration failed.';` (the first line of `buildUpgradeFailureComment`).
  - `export interface IssueCommentRecord { readonly body: string; readonly author: string; }`.
  - `export function isUpgradeFailureComment(body: string, author: string): boolean` — returns `true` iff the comment is bot-authored (`author.endsWith('[bot]')`) **and** `body` begins with `UPGRADE_FAILURE_SIGNATURE`. This deliberately excludes the HITL comment (`'This upgrade PR awaits human review…'`), the merge-failed comment (`'ADW upgrade PR auto-merge failed…'`), the new escalation comment (different first line), and any human-authored comment.
  - `export function countUpgradeFailureComments(comments: readonly IssueCommentRecord[]): number` — `comments.filter(c => isUpgradeFailureComment(c.body, c.author)).length`.
- In `adws/adwUpgrade.tsx`, import `UPGRADE_FAILURE_SIGNATURE` and use it as the first line of `buildUpgradeFailureComment` so the matcher and the builder can never drift.
- In `adws/core/index.ts`, add `export { isUpgradeFailureComment, countUpgradeFailureComments, UPGRADE_FAILURE_SIGNATURE } from './upgradeFailureCap';` and `export type { IssueCommentRecord } from './upgradeFailureCap';`.

### Task 7 — Part B: register the `adw:blocked` terminal label
- In `adws/github/labelManager.ts`, add `export const ADW_BLOCKED_LABEL = 'adw:blocked';` and add `{ name: 'adw:blocked', color: 'b60205', description: 'ADW lane escalated to human (terminal)' }` to `ADW_LABEL_DEFINITIONS` so `ensureAdwLabelsExist` creates it during init (mirrors how `adw:upgrade` is created before use).

### Task 8 — Part B: add the `escalated` outcome, escalation builders, and new deps to `adwUpgrade.tsx`
- Extend `UpgradeRunResult.outcome` to `'completed' | 'failed' | 'escalated'`.
- Add a module constant `const TERMINAL_LABEL = ADW_BLOCKED_LABEL;` (import from `./github`).
- Add two exported pure builders (for unit testing), both **non-ADW** (no `## :emoji:` heading, no `<!-- adw-bot -->`) and **non-failure-signature** (must NOT start with `UPGRADE_FAILURE_SIGNATURE`):
  - `buildUpgradeEscalationComment(adwId: string, issueNumber: number, maxFailures: number): string` — first line e.g. `'ADW upgrade escalated to human review.'`, explaining the cap was reached, how to re-arm (remove the `adw:blocked` label and clear the failure comments, or post `## Cancel`), and including the ADW ID.
  - `buildUpgradeEscalationSlack(repoInfo: RepoInfo, issueNumber: number, failureCount: number, maxFailures: number): string` — a one-line Slack alert (`:rotating_light:` style) naming the repo + issue + count.
- Extend `UpgradeDeps` with:
  - `readonly fetchIssueLabels: (issueNumber: number) => readonly string[];`
  - `readonly fetchIssueComments: (issueNumber: number) => readonly IssueCommentRecord[];`
  - `readonly ensureLabel: (name: string, color: string, description: string) => void;`
  - `readonly applyLabel: (issueNumber: number, label: string) => void;`
  - `readonly moveToStatus: (issueNumber: number, status: string) => boolean;`
  - `readonly postSlack: (text: string) => Promise<void>;`
  - `readonly maxFailures: number;`

### Task 9 — Part B: add the entry gate and escalation gate in `executeUpgrade`
- **Entry gate** — at the very top of `executeUpgrade`, before computing the hash:
  ```
  const labels = deps.fetchIssueLabels(issueNumber);
  if (labels.includes(TERMINAL_LABEL)) {
    deps.log(`adwUpgrade: issue #${issueNumber} carries ${TERMINAL_LABEL}; already escalated — no work`, 'info');
    return { outcome: 'escalated', reason: 'already_escalated' };
  }
  ```
  This makes escalation idempotent and stops re-dispatch work (no hash compute, no worktree).
- **Escalation gate** — immediately after the existing PR-idempotency guard (the `existingClaimPr` block that returns `pr_already_exists`), and before `const defaultBranch = deps.getDefaultBranch();`:
  ```
  const failureCount = countUpgradeFailureComments(deps.fetchIssueComments(issueNumber));
  if (failureCount >= deps.maxFailures) {
    deps.ensureLabel(TERMINAL_LABEL, 'b60205', 'ADW lane escalated to human (terminal)');
    deps.applyLabel(issueNumber, TERMINAL_LABEL);          // durable idempotency signal first
    deps.moveToStatus(issueNumber, 'Blocked');             // best-effort; false on no board is non-fatal
    await deps.postSlack(buildUpgradeEscalationSlack(repoInfo, issueNumber, failureCount, deps.maxFailures));
    deps.commentOnIssue(issueNumber, buildUpgradeEscalationComment(adwId, issueNumber, deps.maxFailures), repoInfo);
    deps.log(`adwUpgrade: failure cap reached (${failureCount}/${deps.maxFailures}); escalated issue #${issueNumber}`, 'warn');
    return { outcome: 'escalated', reason: 'failure_cap_reached' };
  }
  ```
  Placing it after the PR-idempotency guard guarantees a claim that already has a PR returns `pr_already_exists` and never escalates. Applying the label before the noisier steps means a throw in a later step still leaves the entry gate short-circuiting the next tick (no duplicate Slack/escalation).

### Task 10 — Part D: add `excludePaths` to `commitChanges` (gitContext)
- In `adws/gitContext/commitOps.ts`:
  - Change the package-private signature to `function commitChanges(run: Runner, message: string, cwd: string, opts?: { excludePaths?: readonly string[] }): boolean`.
  - Add a small helper `function pathspecSuffix(excludePaths?: readonly string[]): string` that returns `''` when `excludePaths` is empty/undefined, else ` -- '.' ` followed by space-joined `':(exclude)<path>'` tokens (one per path, single-quoted).
  - Use the suffix identically for **both** the porcelain check and the stage step:
    - `const status = run(\`git status --porcelain${suffix}\`, cwd);`
    - `run(\`git add -A${suffix}\`, cwd);`
  - With no `opts`, the emitted commands are exactly `git status --porcelain` and `git add -A` — byte-identical to today.
- In `adws/gitContext/gitContext.ts`, change the public method to `commitChanges(message: string, worktreePath: string, opts?: { excludePaths?: readonly string[] }): boolean` and forward `opts`: `return commitOps.commitChanges((cmd, cwd) => this.#run(cmd, { cwd }), message, worktreePath, opts);`.

### Task 11 — Part D: scope the upgrade regen commit in `adwUpgrade.tsx`
- Change `UpgradeDeps.commitChanges` to `(message: string, cwd: string, opts?: { excludePaths?: readonly string[] }) => boolean`.
- Change the regen-commit callsite to pass the exclude:
  `deps.commitChanges(\`chore: regenerate .adw/ for framework upgrade ${hash.slice(0, 12)}\`, worktreePath, { excludePaths: ['.claude/commands/adw_init.md'] });`
- The default wiring becomes `commitChanges: (message, cwd, opts) => gitCtx.commitChanges(message, cwd, opts),`.

### Task 12 — Part B+D: wire production defaults in `buildDefaultUpgradeDeps`
- In `buildDefaultUpgradeDeps(repoId, gitCtx)`, add:
  - `fetchIssueLabels: (issueNumber) => parseLabelNames(gitCtx.issueHasLabel(issueNumber, TERMINAL_LABEL)),` where a small local `parseLabelNames(json)` does `JSON.parse(json).labels.map(l => l.name)` with a try/catch returning `[]`.
  - `fetchIssueComments: (issueNumber) => parseIssueComments(gitCtx.fetchIssueComments(issueNumber)),` where a local `parseIssueComments(json)` maps the `gh api .../comments` array to `{ body: c.body ?? '', author: c.user?.login ?? '' }`, try/catch returning `[]`.
  - `ensureLabel: (name, color, description) => gitCtx.createLabel(name, color, description),` (idempotent — `gh label create … --force`).
  - `applyLabel: (issueNumber, label) => gitCtx.applyLabel(issueNumber, label),`
  - `moveToStatus: (issueNumber, status) => gitCtx.moveIssueToStatus(issueNumber, status),`
  - `postSlack,` (imported from `./core`).
  - `maxFailures: MAX_FAILURES,` (imported from `./core`).
- Add the necessary imports: `MAX_FAILURES`, `postSlack`, `countUpgradeFailureComments`, `UPGRADE_FAILURE_SIGNATURE`, `type IssueCommentRecord` from `./core`; `ADW_BLOCKED_LABEL` from `./github`.

### Task 13 — Part B: document `MAX_FAILURES` in `.env.sample`
- Add, near the `MAX_CONCURRENT_PER_REPO` entry:
  ```
  # Optional - max upgrade-lane regeneration failures before escalating to a human (default: 3)
  # MAX_FAILURES=3
  ```

### Task 14 — Part B: unit-test the pure cap helpers
- Create `adws/core/__tests__/upgradeFailureCap.test.ts`:
  - `isUpgradeFailureComment`: failure body + `*[bot]` author → `true`; failure body + human author → `false`; HITL body + bot → `false`; merge-failed body + bot → `false`; escalation body + bot → `false`; arbitrary human comment → `false`. Build the failure/HITL/merge-failed/escalation bodies via the real `buildUpgrade*Comment` builders imported from `../../adwUpgrade` to lock the cross-file contract.
  - `countUpgradeFailureComments`: mixed list returns the exact failure count; empty list → 0; boundary list of exactly `MAX_FAILURES` failure comments returns `MAX_FAILURES`.

### Task 15 — Part B: extend `adwUpgrade.test.ts`
- Extend `makeDeps` defaults with: `fetchIssueLabels: vi.fn().mockReturnValue([])`, `fetchIssueComments: vi.fn().mockReturnValue([])`, `ensureLabel: vi.fn()`, `applyLabel: vi.fn()`, `moveToStatus: vi.fn().mockReturnValue(true)`, `postSlack: vi.fn().mockResolvedValue(undefined)`, `maxFailures: 3`. Update the existing `verifyAdwRegen` mock to the one-arg signature `(worktreePath) => ({ ok: true, missing: [] })`.
- Update the existing **receipt-freshness gate: expectedHash is threaded** describe: change the assertion to `expect(deps.verifyAdwRegen).toHaveBeenCalledWith(expect.any(String))` (no hash); keep the "legitimate no-op ok:true → pr_merged" and "ok:false → regen_incomplete" cases (they exercise the gate-pass/gate-fail outcomes, which are unchanged).
- Add a new **failure-cap escalation** describe:
  - count == `MAX_FAILURES` (`fetchIssueComments` returns 3 bot-authored failure records) → `outcome: 'escalated'`, `reason: 'failure_cap_reached'`; asserts `applyLabel(541, 'adw:blocked')`, `moveToStatus(541, 'Blocked')`, `postSlack` called once, `commentOnIssue` called once with a body where `isAdwComment(body) === false` **and** `isUpgradeFailureComment(body, '<bot>') === false`; and that **no regen happened** (`runInitCommand`, `writeAdwVersion`, `commitChanges`, `pushBranch`, `createPullRequest`, `mergePR` not called).
  - count < `MAX_FAILURES` (e.g. 2) → proceeds to `pr_merged`; `applyLabel`/`moveToStatus`/`postSlack` not called.
  - terminal label present (`fetchIssueLabels` returns `['adw:blocked']`) → `outcome: 'escalated'`, `reason: 'already_escalated'`; asserts `computeFrameworkHash`, `ensureWorktree`, `runInitCommand`, `createPullRequest` **not** called (no work).
  - PR exists **and** count ≥ MAX (`findPRByBranch` returns an open PR, `fetchIssueComments` returns 3 failures) → `reason: 'pr_already_exists'`, `applyLabel`/`postSlack` not called (PR guard wins; never escalates).
- Add a **scoped commit** assertion: on the success path, `commitChanges` is called with a third argument `{ excludePaths: ['.claude/commands/adw_init.md'] }`.

### Task 16 — Part D: extend `gitContextOperations.test.ts`
- Add a `commitChanges excludePaths` describe driving the public `GitContext.commitChanges` with a recording fake runner:
  - With `opts.excludePaths: ['.claude/commands/adw_init.md']` and a dirty porcelain result, assert the recorded commands are `git status --porcelain -- '.' ':(exclude).claude/commands/adw_init.md'` and `git add -A -- '.' ':(exclude).claude/commands/adw_init.md'` (held-out file excluded from staging) and the commit ran.
  - With **no** `opts`, assert the recorded commands are exactly `git status --porcelain` and `git add -A` (byte-identical to today) — guards every other caller.
  - Empty porcelain → returns `false`, no `git add`/`git commit` (preserve existing no-change short-circuit, with and without the pathspec).

### Task 17 — Validate
- Run the full **Validation Commands** section below and confirm zero failures and zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope (vitest, run via `bun run test:unit`).

- **`adws/core/__tests__/upgradeFailureCap.test.ts` (new):** pure-function coverage of `isUpgradeFailureComment` (signature + bot-author discrimination across failure / HITL / merge-failed / escalation / human bodies) and `countUpgradeFailureComments` (count + `MAX_FAILURES` boundary). Bodies built via the real `adwUpgrade` builders to lock the contract.
- **`adws/__tests__/adwUpgrade.test.ts` (extend):** new escalation gate (count==MAX → escalated, no regen), entry gate (terminal label → escalated/no work), proceed path (count<MAX), PR-precedence (PR exists → never escalates), validity-only `verifyAdwRegen` call shape, and the Part D `excludePaths` argument on the regen commit. Existing success/HITL/merge-failed/claim-lost/LLM-failure/worktree-error/hash-error/reconcile suites must remain green.
- **`adws/phases/__tests__/worktreeSetup.test.ts` (edit):** validity-only `verifyAdwRegen` (no-op-no-receipt → ok:true; missing/empty `.adw/` file → ok:false; missing vocabulary → ok:false); receipt-specific cases and the `parseRegenReceiptHash` block deleted. `copyClaudeAssetsToWorktree` fixtures unchanged.
- **`adws/gitContext/__tests__/gitContextOperations.test.ts` (extend):** `commitChanges` `excludePaths` builds the scoped `git add`/porcelain pathspec; no-opts path is byte-identical; empty-porcelain short-circuit preserved.

### Edge Cases
- **Byte-identical no-op regen** — all `.adw/` files present and unchanged, no receipt written → `verifyAdwRegen` returns `ok:true`; the lane stamps `.adw-version` and opens a PR (the exact case the old receipt gate flakily blocked).
- **Missing/empty `.adw/` file** — `verifyAdwRegen` returns `ok:false` with the file in `missing` (anti-brick #572 preserved).
- **Failure count exactly at the cap vs. one below** — `>= MAX_FAILURES` escalates; `MAX_FAILURES - 1` proceeds.
- **PR already exists with count ≥ cap** — PR-idempotency guard returns first; no escalation, no duplicate work.
- **Already escalated (label present)** — entry gate returns before any hash/worktree work; no duplicate Slack on subsequent cron ticks.
- **Human-pasted failure text** — non-bot author → not counted (no false escalation).
- **Escalation comment must not self-count** — its first line differs from `UPGRADE_FAILURE_SIGNATURE`, so it never inflates the count or blocks a post-Cancel re-arm.
- **No project board** — `moveToStatus` returns `false`; escalation still completes via label + Slack + comment (best-effort board move).
- **`postSlack` with no `SLACK_WEBHOOK_URL`** — logs a warning and resolves; escalation still completes (no-throw boundary).
- **Re-arm** — removing `adw:blocked` re-opens the entry gate; the failure-count gate re-escalates unless the failure comments are cleared, so a full reset requires clearing comments (the operator action documented in the escalation comment) — `## Cancel` already clears all comments via `handleCancelDirective`, giving a one-shot full re-arm with no new code.
- **Target repo where `adw_init.md`/receipt are untracked** — `excludePaths` and the receipt gitignore are no-ops (nothing to hold out); genuine `.adw/` outputs still commit.
- **No-opts `commitChanges` callers** (every non-upgrade caller) — emit exactly `git status --porcelain` / `git add -A`, unchanged.

## Acceptance Criteria
- `verifyAdwRegen(worktreePath)` takes a single argument, proves validity only (six `.adw/` files non-empty + `vocabulary.md`), and `REGEN_RECEIPT_RELATIVE_PATH`, `parseRegenReceiptHash`, `receiptIsFresh` no longer exist.
- A byte-identical no-op regen (no receipt) passes the gate, stamps `.adw-version`, and opens a PR.
- `.adw/.regen-receipt` is untracked in the framework repo, listed in the root `.gitignore`, and gitignored in upgrade worktrees.
- `MAX_FAILURES` exists in `core/config.ts` (default 3, env-overridable) and is documented in `.env.sample`.
- `core/upgradeFailureCap.ts` exports `isUpgradeFailureComment` / `countUpgradeFailureComments`, matches the bot-authored failure-comment signature, and excludes HITL / merge-failed / escalation / human comments — unit-tested.
- `executeUpgrade` returns `outcome: 'escalated'` when (a) the terminal label is already present (`already_escalated`, no work) or (b) failure-comment count ≥ `MAX_FAILURES` after the PR guard (`failure_cap_reached`), applying `adw:blocked`, moving the board to **Blocked**, posting exactly one Slack alert, and posting one distinct non-failure-signature escalation comment — with no regen/PR side effects.
- A claim branch that already has a PR returns `pr_already_exists` and never escalates, even when the count is at/over the cap.
- `adw:blocked` is registered in `ADW_LABEL_DEFINITIONS` (created by `ensureAdwLabelsExist`) and self-ensured in the escalation path.
- `commitChanges(message, cwd, { excludePaths })` scopes both `git add -A` and the porcelain check via an exclude pathspec; with no `opts` the emitted commands are byte-identical to the current `git add -A` / `git status --porcelain`.
- The upgrade regen commit passes `excludePaths: ['.claude/commands/adw_init.md']`, so `adw_init.md` is held out while genuine `.adw/`, `.adw-version`, and any real `target:true` `.claude` propagation still commit.
- All Validation Commands pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — lint for code-quality issues.
- `bunx tsc --noEmit` — root type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` project type-check (additional, per `.adw/commands.md`).
- `bun run test:unit` — full vitest unit suite (must pass, including the new `upgradeFailureCap.test.ts` and the updated `adwUpgrade.test.ts`, `worktreeSetup.test.ts`, `gitContextOperations.test.ts`).
- `bun run build` — verify no build errors.
- `git ls-files .adw/.regen-receipt` — must return **empty** (receipt no longer tracked).
- `git check-ignore .adw/.regen-receipt` — must echo the path (receipt is gitignored).

## Notes
- **Coding guidelines:** `.adw/coding_guidelines.md` applies — keep `verifyAdwRegen` and the cap helpers pure (side effects injected via `UpgradeDeps`), use guard clauses for the two new gates (happy path stays at the left margin), keep files under 300 lines, prefer `unknown`/explicit types over `any`, and add JSDoc on the new public helpers.
- **No new libraries** — uses existing `vitest`, GitContext, `slackNotifier`, and `labelManager`. Library install command (if ever needed) per `.adw/commands.md`: `bun add <package>`.
- **Sequencing (resolved):** the issue is "Blocked by #661/#662/#663" (the GitContext migration). All three are merged on `dev`, so this plan targets the migrated surfaces: commit ops live in `gitContext/commitOps.ts` + `GitContext.commitChanges` (the old `vcs/commitOperations.ts` is an empty stub), and the GH/board/label/comment ops are GitContext methods. The issue's pre-migration test-file names map as: `commitOperations.test.ts` → `gitContext/__tests__/gitContextOperations.test.ts`; "worktree ops"/"gh ops" → GitContext.
- **Bot-author detection:** `isUpgradeFailureComment` treats `author.endsWith('[bot]')` as bot-authored, matching GitHub App comment logins (the upgrade lane posts under the configured app identity). If a deployment ever posts upgrade comments under a non-`[bot]` PAT user, the cap would not engage; the constant/predicate is centralized in `upgradeFailureCap.ts` so the bot-identity rule can be tightened later without touching the orchestrator.
- **Scope boundaries (from the issue):** cap counting is upgrade-lane-specific (counts GH failure comments); `MAX_FAILURES` is the shared env knob — the existing cap zoo (`MAX_RESUME_ATTEMPTS`, etc.) is **not** migrated. The trigger/hash model is **not** redesigned. The same `git add -A` reversion class affecting normal workflow commits (`copyClaudeAssetsToWorktree`) is **out of scope** — the `excludePaths` technique generalizes and is tracked separately; this change only wires the upgrade lane.
- **Why validity over authorship:** a valid `.adw/` is valid whether the LLM rewrote it or left it byte-identical. The receipt only ever proved authorship (the irrelevant part) and was itself the artifact the `git add -A` reversion deleted — removing it eliminates both the flaky gate and one reversion vector.
- **Idempotency of escalation** rests on the terminal label + the entry gate: apply the label first, so any later failure in the escalation steps still short-circuits the next cron tick rather than re-alerting.
- **Related history (memory):** this directly fixes the "ADW self-upgrade no-op loop" (byte-identical regen → infinite `adwUpgrade` loop) and adds an upgrade-lane analogue of the #639 bounded resume-cap / `human_gated` escalation; Part D addresses the recurring `git add -A` worktree-reversion class.
```