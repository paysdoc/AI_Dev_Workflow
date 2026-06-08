# Delete adwInit.tsx Orchestrator

**ADW ID:** cy2xzc-delete-adwinit-tsx-o
**Date:** 2026-06-08
**Specification:** specs/issue-547-adw-cy2xzc-delete-adwinit-tsx-o-sdlc_planner-delete-adwinit-orchestrator.md

## Overview

Removes the `adws/adwInit.tsx` standalone orchestrator entrypoint (issue #547, PRD user story 30). Its responsibilities are fully absorbed by `adwUpgrade.tsx`, which invokes the `/adw_init` slash command via `runClaudeAgentWithCommand` whenever the ADW framework hash drifts. The `.claude/commands/adw_init.md` slash-command file is preserved as the manual escape hatch.

## What Was Built

- `adws/adwInit.tsx` deleted — 134-line `bunx tsx` orchestrator entrypoint removed
- `adws/types/issueRouting.ts` — removed the two `'adws/adwInit.tsx'` path entries; `issueTypeToOrchestratorMap` type relaxed from `Record` to `Partial<Record<...>>` so the `/adw_init` key can be absent
- `features/regression/step_definitions/whenSteps.ts` — removed `init: 'adwInit.tsx'` from the `ORCHESTRATOR_FILES` test map
- `features/per-issue/step_definitions/feature-541.steps.ts` — updated header comment that previously noted the `init` entry was deferred to this slice (#30)
- `README.md` — replaced `bunx tsx adws/adwInit.tsx` usage instructions and removed `├── adwInit.tsx` from the directory tree
- `adws/README.md` — updated "Bootstrapping" subsection to document the preserved manual `/adw_init` slash command and the `adwUpgrade.tsx` hash-driven auto-regeneration path

## Technical Implementation

### Files Modified

- `adws/adwInit.tsx`: **deleted** — standalone `bunx tsx` orchestrator; was not imported anywhere so no import-graph fallout
- `adws/types/issueRouting.ts`: removed `/adw_init: 'adws/adwInit.tsx'` from `adwCommandToOrchestratorMap` and `issueTypeToOrchestratorMap`; changed `issueTypeToOrchestratorMap` type from `Record<IssueClassSlashCommand, string>` to `Partial<Record<IssueClassSlashCommand, string>>`
- `features/regression/step_definitions/whenSteps.ts`: removed `init: 'adwInit.tsx'` entry from the `ORCHESTRATOR_FILES` map (was already inside a commented-out block)
- `features/per-issue/step_definitions/feature-541.steps.ts`: updated stale comment noting the `init` removal was a separate deferred slice
- `README.md`: updated bootstrap section; removed `├── adwInit.tsx` tree entry
- `adws/README.md`: updated orchestrator list and bootstrapping subsection

### Key Changes

- `/adw_init` remains a valid slash command, classification token, and type-system member — only the orchestrator *path* mapping is removed, not the command itself
- `getWorkflowScript` in `adws/core/workflowMapping.ts` already uses `issueTypeToOrchestratorMap[issueType] ?? 'adws/adwPlanBuildTest.tsx'`; the `Partial` map means a `/adw_init` lookup now returns `undefined` and falls back gracefully — no behavioral regression
- `OrchestratorId.Init` (`'init-orchestrator'`) in `adws/core/constants.ts` is intentionally left unmapped; the orchestrator-name disambiguation logic (#529) relies on `init-orchestrator` being an unmapped name
- `adws/core/hashComputer.ts` `ADW_INIT_RELATIVE_PATH` references `.claude/commands/adw_init.md` (the preserved escape hatch), not the deleted orchestrator — left untouched

## How to Use

**Automatic path (replaces `adwInit.tsx`):** When a target repo's framework hash drifts, `adwUpgrade.tsx` detects it and automatically invokes `/adw_init` inside a Claude Code CLI session against the target repo worktree. No manual intervention required.

**Manual escape hatch (unchanged):** To manually initialize or reinitialize a target repo's `.adw/` configuration:
1. Open a Claude Code CLI session against the target repository.
2. Run `/adw_init` inside that session.
3. The command generates `.adw/commands.md`, `.adw/project.md`, and `.adw/scenarios.md`.

## Configuration

No new configuration required. The preserved `/adw_init` slash command continues to read `.adw/commands.md`, detect language/framework/package manager, and generate the three config files as before.

## Testing

- `test ! -f adws/adwInit.tsx` — confirms the file is deleted
- `test -f .claude/commands/adw_init.md` — confirms the manual escape hatch is intact
- `grep -rIn "adws/adwInit.tsx\|adwInit\.tsx" --include="*.ts" --include="*.tsx" --include="*.md" adws/ features/ README.md` — must return zero matches
- `bun run lint && bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json` — lint and type-check clean
- `bun run test:unit` — covers preserved `/adw_init` token in `labelManager.test.ts`, `branchOperations.test.ts`
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression BDD suite

## Notes

- `/adw_init` is intentionally kept in all non-routing maps (`adwCommandToIssueTypeMap`, `commitPrefixMap`, `branchPrefixMap`, `branchPrefixAliases`, `issueTypeLabels`, `modelRouting`, etc.) because it remains a valid manual classification token
- `issueTypeToAdwLabel('/adw_init')` is contractually `null`; a unit test depends on `/adw_init` still existing in the type union
- See `app_docs/feature-gj381g-adwupgrade-tsx-orche.md` for the `adwUpgrade.tsx` orchestrator that absorbs init responsibilities
- See `app_docs/feature-n9880l-adwversion-read-write-module.md` for the hash-driven versioned auto-(re)init system context
