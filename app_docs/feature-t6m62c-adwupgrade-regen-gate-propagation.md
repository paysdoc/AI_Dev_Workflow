# adwUpgrade — Regen Gate, Failure Cap & Scoped Commit

## Overview

`adwUpgrade.tsx` orchestrates the framework self-upgrade lane: it detects when a target repo's `.adw-version` hash drifts from the live framework, regenerates `.adw/` via an LLM-run `/adw_init`, and opens a PR with the updated files. The module is hardened with a validity-only regen gate (no receipt dependency), a bounded failure cap that escalates to a human after `MAX_FAILURES` bot-authored failure comments, and a scoped commit that holds out `.claude/commands/adw_init.md` to prevent self-reverting upgrades.

## Responsibilities

- Compute the framework content hash and compare it to the target repo's `.adw-version`
- Short-circuit when an upgrade PR already exists on the claim branch (idempotency)
- Block re-dispatch immediately when the `adw:blocked` terminal label is present (entry gate)
- Count bot-authored upgrade-failure comments and escalate once `MAX_FAILURES` is reached
- On escalation: apply `adw:blocked` label, move board to Blocked, post one Slack alert, post a distinct non-failure-signature escalation comment
- Invoke `/adw_init` in a fresh worktree to regenerate `.adw/` files
- Gate the resulting worktree with `verifyAdwRegen` (validity-only: six `.adw/` files non-empty + `vocabulary.md` present)
- Stamp `.adw-version`, commit with `excludePaths: ['.claude/commands/adw_init.md']`, push, and create a PR
- Respect `.github/adw.yml` HITL opt-in (defer auto-merge when `hitl: true`)
- All side effects are injected via `UpgradeDeps` so every gate is unit-testable without I/O

## Contracts & Invariants

- `verifyAdwRegen(worktreePath)` takes a single argument (no hash). It returns `{ ok: boolean; missing: readonly string[] }` and proves validity only — files present and non-empty. A byte-identical no-op regen (no receipt written) passes.
- `.adw/.regen-receipt` is untracked in the framework repo, listed in `.gitignore`, and gitignored in upgrade worktrees via `ensureGitignoreEntry`. It never enters a commit.
- The failure-cap escalation gate is placed **after** the PR-idempotency guard: a claim that already has an open PR returns `pr_already_exists` and never escalates, even when the failure count is at or above `MAX_FAILURES`.
- The entry gate (`adw:blocked` label check) runs before any hash computation or worktree work — re-dispatch on an already-escalated issue is a no-op.
- Step 6 (`.adw-version` write, regen commit, push) never throws out of `executeUpgrade` (issue #730). `commitChanges` is wrapped in `try/catch`: a throw posts `buildUpgradeFailureComment(...)` and returns `{ outcome: 'failed', reason: 'commit_error' }`. The `pushBranch` catch keeps its `isPushRejection(error)` → `{ outcome: 'completed', reason: 'claim_lost' }` silent-park branch unchanged, but any other (non-rejection) push error now also posts a failure comment and returns `{ outcome: 'failed', reason: 'push_error' }` instead of re-throwing. Both failure comments feed `countUpgradeFailureComments` toward `MAX_FAILURES`, same as the pre-existing `worktree_error` / `llm_failed` / `regen_incomplete` reasons.
- `applyLabel` is called before the noisier escalation steps (Slack, comment) so a throw in a later step still leaves the entry gate short-circuiting the next cron tick.
- `buildUpgradeEscalationComment` first line is `'ADW upgrade escalated to human review.'` — deliberately different from `UPGRADE_FAILURE_SIGNATURE` so it cannot self-inflate the failure count.
- `commitChanges(message, cwd, { excludePaths: ['.claude/commands/adw_init.md'] })` scopes both `git add -A` and the porcelain check via an exclude pathspec; callers with no `opts` get byte-identical `git add -A` / `git status --porcelain` commands.
- Before building the pathspec, `committableExcludePaths` drops any `excludePaths` entry that is already gitignored in `cwd` (via `git check-ignore`). The same filtered list feeds both `git status --porcelain` and `git add -A`, so the two stay consistent and neither command is handed a redundant-and-crashing `:(exclude)` token for an already-ignored path.
- `## Cancel` clears all GitHub comments via `handleCancelDirective`, giving a full re-arm with no new code (failure count resets to 0).

## Configuration

| Name | Default | Description |
|------|---------|-------------|
| `MAX_FAILURES` | `3` | Number of bot-authored failure comments before escalating. Env-overridable; minimum 1. |
| `SLACK_WEBHOOK_URL` | — | If set, escalation posts one Slack alert via `postSlack`. If absent, logs a warning and continues. |

## Gotchas

- **Re-arm sequence**: removing `adw:blocked` re-opens the entry gate, but the failure count is still `MAX_FAILURES`. Without clearing failure comments the escalation gate re-fires immediately. A full re-arm requires both: remove the label **and** clear the failure comments (or post `## Cancel` which clears all comments).
- **Bot-author detection**: `isUpgradeFailureComment` treats `author.endsWith('[bot]')` as bot-authored. A deployment that posts upgrade comments under a non-`[bot]` PAT would not have its failures counted by the cap; the predicate is centralized in `core/upgradeFailureCap.ts`.
- **`commitChanges` excludePaths pathspec**: the exclude token format is `':(exclude)<path>'` (single-quoted, colon-magic). The pathspec applies to both `git status --porcelain` and `git add -A` so the check and the stage are always consistent.
- **No-opts callers are byte-identical**: every non-upgrade caller of `GitContext.commitChanges` passes no `opts` and gets the same command strings as before. The `excludePaths` extension is strictly additive.
- **Already-gitignored exclude paths used to crash**: naming a path in `excludePaths` that is *also* gitignored (e.g. `.claude/commands/adw_init.md` after `copyAdwInitCommandToWorktree` + `ensureGitignoreEntry` make it untracked-and-ignored in an upgrade worktree) turned `git add -A` into an explicit-pathspec add, which git rejects with exit 1 (`The following paths are ignored by one of your .gitignore files`). `git status --porcelain` with the same pathspec exits 0 and silently omits the path, so the "anything to commit?" guard passed right before `git add -A` threw. `committableExcludePaths` fixes this by dropping already-ignored entries before the pathspec is built; the exclude still works as before for tracked/committable paths (e.g. the self-host case where `.claude/commands/adw_init.md` is tracked, not ignored). `git check-ignore` failing (including "nothing is ignored", which exits non-zero) is treated as "keep every path," so the filter can never behave worse than the pre-fix baseline.
- **`verifyAdwRegen` removed symbols**: `REGEN_RECEIPT_RELATIVE_PATH`, `parseRegenReceiptHash`, and `receiptIsFresh` no longer exist. Any import of these will fail to compile.
- **Escalation outcome**: `executeUpgrade` now returns `outcome: 'escalated'` for two reasons: `'already_escalated'` (entry gate, terminal label present) and `'failure_cap_reached'` (cap gate). Both are terminal — no regen, no PR work.
- **Redrivable, bounded upgrades (issue #730)**: `adwUpgrade` is spawned only once per framework hash (the claim winner in `upgradeGate.ts`); the claim branch `adw-upgrade-<hash>` is never released on failure, so nothing re-invokes a failed run on its own. `adws/triggers/upgradeRedrive.ts` closes that gap with an independent cron pass wired into `checkAndTrigger` (`trigger_cron.ts`): `runUpgradeRedriveScan` re-spawns `adwUpgrade` for any stranded `#UPG` — open, `adw:upgrade`-labeled, not `adw:blocked`, no PR on its claim branch, and a spawn lock that is absent or held by a dead PID. The pure decision (`decideUpgradeRedrive`) is a cheap pre-filter only; `executeUpgrade`'s own entry gate and idempotency guard remain the correctness authority. Bounding is inherited entirely from the existing failure cap: each failed re-spawn posts one counted comment (see the step-6 no-throw contract above), and once `MAX_FAILURES` escalates and applies `adw:blocked`, the predicate's `terminal` guard stops further re-spawns on the next tick. The scan never touches the standard candidate loop — `#UPG` issues already read as `no_adw_label` there and are invisible to it.
