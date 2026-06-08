# HITL Opt-In for Framework-Upgrade PRs via `.github/adw.yml`

**ADW ID:** 6zw7n2-hitl-opt-in-via-gith
**Date:** 2026-06-08
**Specification:** specs/issue-543-adw-6zw7n2-hitl-opt-in-via-gith-sdlc_planner-hitl-opt-in-adw-yml.md

## Overview

Adds a gated merge step to the `adwUpgrade.tsx` orchestrator: after opening the upgrade PR, it reads `.github/adw.yml` from the target repo's worktree. If `hitl: true` is set, the PR is left open for human review; otherwise it auto-merges immediately (best-effort, non-fatal). The opt-in config lives outside `.adw/` so `/adw_init` regeneration can never clobber it.

## What Was Built

- **`adws/core/adwYmlConfig.ts`** — new deep module exposing `readAdwYmlConfig(worktreePath)` and pure `parseAdwYml(content)` for determining the HITL policy from `.github/adw.yml`
- **Gated merge step in `adwUpgrade.tsx`** — after PR open, reads config and either auto-merges (`reason: 'pr_merged'`), defers to human (`reason: 'pr_opened_hitl'`), or handles merge failure non-fatally (`reason: 'merge_failed'`)
- **Two new non-workflow comment builders** — `buildUpgradeHitlComment` and `buildUpgradeMergeFailedComment`, both invisible to `isAdwComment()` so the concurrency guard ignores them
- **`adwYmlConfig` exported from `adws/core/index.ts`** — `ADW_YML_RELATIVE_PATH`, `readAdwYmlConfig`, `parseAdwYml`, and `AdwYmlConfig` type
- **Unit tests** — `adws/core/__tests__/adwYmlConfig.test.ts` (parser + reader, all config states) and extended `adws/__tests__/adwUpgrade.test.ts` (merge-gate logic for all three paths)

## Technical Implementation

### Files Modified

- `adws/adwUpgrade.tsx`: added `readAdwYmlConfig` and `mergePR` to `UpgradeDeps`; added gated merge step in `executeUpgrade`; added `buildUpgradeHitlComment` and `buildUpgradeMergeFailedComment` helpers; wired production deps in `buildDefaultUpgradeDeps`; updated workflow docstring
- `adws/core/index.ts`: exported the new `adwYmlConfig` module symbols
- `adws/__tests__/adwUpgrade.test.ts`: added `readAdwYmlConfig` and `mergePR` stubs to `makeDeps`; updated existing `pr_opened` assertions to `pr_merged`; added tests for all three merge-gate paths

### New Files

- `adws/core/adwYmlConfig.ts`: deep module with `parseAdwYml` (pure, no I/O) and `readAdwYmlConfig` (filesystem wrapper)
- `adws/core/__tests__/adwYmlConfig.test.ts`: fixture-driven tests via temp dirs (mirrors `adwVersion.test.ts` structure)

### Key Changes

- **No new runtime dependency** — the YAML parser is hand-rolled (one `hitl:` boolean scalar), consistent with `core/projectConfig.ts` conventions
- **Merge is best-effort** — a merge failure (branch protection, required CI, race) logs a warning and posts a non-workflow comment but still returns `outcome: 'completed'`; the PR stays open and visible
- **File location is intentional** — `.github/adw.yml` mirrors `.adw-version`'s rationale: both live outside `.adw/` to survive `/adw_init` regeneration that would otherwise clobber them
- **Distinct from the `hitl` label gate** — the `hitl` GitHub label gates the normal `awaiting_merge` flow in `adwMerge.tsx`/`autoMergePhase.ts`; this config gates only framework-upgrade PRs and is read from the worktree, not from issue labels
- **Tracking-issue lifecycle unchanged** — whether ADW auto-merges or a human merges later, the `Implements #<N>` PR body linkage auto-closes the tracking issue; no new state management required

## How to Use

### Default behaviour (auto-merge)

No action required. With `.github/adw.yml` absent or containing `hitl: false`, upgrade PRs auto-merge immediately after regeneration.

### Opt in to human review

1. Commit `.github/adw.yml` to the **target repo** (the repo being upgraded, not the ADW framework repo):

   ```yaml
   hitl: true
   ```

2. On the next framework upgrade, `adwUpgrade.tsx` will open the PR but not merge it. A comment is posted to the tracking issue noting the PR awaits human review.

3. Review and merge the PR manually. The `Implements #<N>` linkage auto-closes the tracking issue on merge, and the CRON dependency-closure unblocks any dependent issues — identical to the auto-merge path, just human-paced.

### Opt back out

Set `hitl: false` or delete the file. The next upgrade will auto-merge again.

## Configuration

**File:** `.github/adw.yml` (target repo root, outside `.adw/`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `hitl` | boolean | `false` | `true` = require human review; `false` = auto-merge |

**Parsing rules:**
- File absent → `{ hitl: false }` (no warning)
- `hitl` key missing from file → `{ hitl: false }` (file is not malformed)
- Quoted values (`"true"`) and uppercase (`TRUE`) are accepted
- Inline comments are stripped (`hitl: true # gate` → `true`)
- Non-boolean value (e.g. `hitl: maybe`) → `{ hitl: false }` + warn log
- File unreadable → `{ hitl: false }` + warn log

## Testing

Run the targeted suite while iterating:

```bash
bunx vitest run adws/core/__tests__/adwYmlConfig.test.ts adws/__tests__/adwUpgrade.test.ts
```

Full validation:

```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run test:unit
bun run build
```

Tests cover: absent file, `hitl: false`, `hitl: true`, missing key, malformed value, quoted/uppercase/inline-comment tolerance, default auto-merge path, HITL-deferred path, and non-fatal merge failure.

## Notes

- The merge happens **inside `adwUpgrade.tsx`**, not via the CRON/`adwMerge.tsx` path. The upgrade orchestrator is on the exception list (writes no `awaiting_merge` workflow state, posts no `adwId` workflow comment), so the CRON stage resolver never routes upgrade tracking issues to `adwMerge.tsx`. The in-process gated merge is the minimal self-contained implementation.
- **Future:** if the CRON→`adwMerge` path is extended to cover upgrade tracking issues, the `.github/adw.yml` read should be consolidated to one site. For now `executeUpgrade` is the single merge site for upgrades.
- **Merge primitive:** uses `mergePR` (`gh pr merge --merge`) — the upgrade branch is freshly created off the default branch, so a clean merge is the common case. `mergeWithConflictResolution` (used by `adwMerge.tsx`) is available if conflict handling is later needed.
