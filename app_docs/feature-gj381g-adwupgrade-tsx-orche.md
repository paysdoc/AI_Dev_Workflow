# `adwUpgrade.tsx` Standalone Upgrade Orchestrator

**ADW ID:** gj381g-adwupgrade-tsx-orche
**Date:** 2026-06-08
**Specification:** specs/issue-541-adw-gj381g-adwupgrade-tsx-orche-sdlc_planner-adw-upgrade-orchestrator.md

## Overview

`adwUpgrade.tsx` is the orchestrator that performs the regeneration half of the versioned auto-(re)init system. When a target repo's `.adw-version` hash is stale, this orchestrator checks out the pre-claimed upgrade branch, drives `/adw_init` via the Claude CLI to regenerate `.adw/`, writes the fresh runtime-computed hash to `.adw-version`, commits the result, and opens a PR linked to the tracking issue. LLM failures post a non-workflow comment (invisible to the concurrency guard) and exit cleanly with no PR.

## What Was Built

- `adws/adwUpgrade.tsx` — new exception-list orchestrator (no `initializeWorkflow()`, uses `runWithRawOrchestratorLifecycle`)
- `UpgradeDeps` injectable interface enabling full unit testing without I/O
- Pure helpers: `buildUpgradePrBody`, `buildUpgradePrTitle`, `buildUpgradeFailureComment`
- `executeUpgrade` core function with guard-clause error paths for hash error, worktree error, and LLM failure
- `buildDefaultUpgradeDeps()` factory wiring production implementations
- `adws/__tests__/adwUpgrade.test.ts` — Vitest unit suite covering all decision branches
- `features/per-issue/feature-541.feature` — BDD acceptance scenarios (4 scenarios)
- `features/per-issue/step_definitions/feature-541.steps.ts` — step definitions with mock harness
- Test fixtures: `test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json` and `adw-upgrade-regen-failure.json`

## Technical Implementation

### Files Modified

- `adws/adwUpgrade.tsx`: new file — full orchestrator: `main()`, `executeUpgrade()`, `UpgradeDeps`, `buildDefaultUpgradeDeps()`, and pure helpers
- `adws/__tests__/adwUpgrade.test.ts`: new file — injected-deps Vitest suite; mirrors `adwMerge.test.ts` pattern
- `features/per-issue/feature-541.feature`: new file — BDD scenarios for success, two-commit PR, `.adw-version` content, and LLM failure
- `features/per-issue/step_definitions/feature-541.steps.ts`: new file — step definitions wired to mock infrastructure
- `test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json`: new fixture — happy-path JSONL manifest for mock Claude CLI stub
- `test/fixtures/jsonl/manifests/adw-upgrade-regen-failure.json`: new fixture — failure-path JSONL manifest

### Key Changes

- **Runtime hash recomputation:** `executeUpgrade` always calls `deps.computeFrameworkHash(frameworkRepoRoot)` at its own runtime — the branch name is a claim token only; the value written to `.adw-version` is the fresh result, not the hash embedded in the branch name.
- **Concurrency-neutral failure comment:** `buildUpgradeFailureComment` deliberately contains no `## :emoji: ` headings and no `<!-- adw-bot -->` signature, so `isAdwComment()` returns `false` — failed upgrades are invisible to `concurrencyGuard.getInProgressIssueCount()`.
- **Silent success:** no workflow comment is posted on success; the opened PR (body starting with `Implements #<issueNumber>`) is the sole signal. This satisfies the auto-close and `concurrencyGuard` linked-PR detection contracts.
- **Exception-list membership:** does not call `initializeWorkflow()`; uses `runWithRawOrchestratorLifecycle` (lock → heartbeat → run → cleanup) exactly as `adwMerge.tsx` does.
- **Two-commit PR guarantee:** `ensureWorktree` checks out the existing remote claim branch (which already carries the empty claim commit from `upgradeClaim`); the regen commit lands on top, producing the required two-commit history.

## How to Use

1. Ensure the target repo has a pre-pushed `adw-upgrade-<hash>` branch and a tracking issue with the `adw:upgrade` label (created by `claimUpgradeOrFindExisting`).
2. Run the orchestrator against the tracking issue number:
   ```bash
   # Self-hosted (framework repo as target):
   bunx tsx adws/adwUpgrade.tsx <issueNumber>

   # External target repo:
   bunx tsx adws/adwUpgrade.tsx <issueNumber> [adw-id] --target-repo owner/repo
   ```
3. On success: a PR opens on `adw-upgrade-<hash>` with two commits, body containing `Implements #<issueNumber>`, and `.adw-version` set to the runtime hash. No comment is posted to the tracking issue.
4. On LLM failure: a non-workflow comment is posted to the tracking issue with the reason and a retry command. No PR is opened.

## Configuration

No new configuration files or environment variables are required. The orchestrator composes from existing modules and reads from the environment already consumed by other orchestrators (`GH_TOKEN`, `GITHUB_PAT`, Claude CLI configuration).

## Testing

```bash
# Unit suite (all executeUpgrade branches + pure helpers):
bunx vitest run adws/__tests__/adwUpgrade.test.ts

# Full unit suite (zero regressions):
bun run test:unit

# Type checks:
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Lint:
bun run lint

# BDD regression suite:
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Build:
bun run build
```

## Notes

- **Do not delete `adwInit.tsx`** — its removal is a separate PRD slice (#30). `adwUpgrade.tsx` calls `/adw_init` as a Claude slash command via `runClaudeAgentWithCommand`, not by importing `adwInit.tsx`.
- **`deriveOrchestratorScript()` / `OrchestratorId` not modified** — the cron/webhook spawn wiring that invokes `adwUpgrade` belongs to the `initializeWorkflow()` hash-check slice (separate PRD). Adding unused constants here would be dead code.
- **Rate-limit/auth pause is out of scope** — any `/adw_init` non-success (including transient rate-limits) is treated as LLM failure → non-workflow comment + clean exit. Pause/resume queue participation is a future enhancement.
- **Idempotent PR creation** — `createGitHubCodeHost.createPullRequest` reuses an existing PR for the branch, so re-running after a partial failure is safe.
- **Hash drift edge case** — if the framework hash advances between the `upgradeClaim` run and this orchestrator's runtime, the derived branch name may not match the pushed claim branch. This is accepted per PRD Q26/Q32; the runtime hash is always authoritative for `.adw-version`.
