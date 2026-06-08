# Chore: Delete adwInit.tsx orchestrator

## Metadata
issueNumber: `547`
adwId: `cy2xzc-delete-adwinit-tsx-o`
issueJson: `{"number":547,"title":"Delete adwInit.tsx orchestrator","body":"## Parent PRD\n\n`specs/prd/adw-init-hash-and-label-classification.md`\n\n## What to build\n\nDelete the `adwInit.tsx` orchestrator file. Its responsibilities are absorbed by `adwUpgrade.tsx` via the hash-driven trigger. The ```/adw_init.md``` slash-command file is preserved as the manual escape hatch (invokable inside a Claude Code CLI session against a target repo).\n\nSee \"Manual escape hatch\" and \"Files to delete\" sections of the parent PRD.\n\n## Acceptance criteria\n\n- [ ] `adws/adwInit.tsx` is deleted\n- [ ] ```.claude/commands/adw_init.md``` (the slash-command file) is preserved\n- [ ] Manual CLI invocation of ```/adw_init``` inside a Claude Code session against a target repo still works\n- [ ] No remaining code references to `adws/adwInit.tsx` anywhere in the codebase\n\n## Blocked by\n\n- Blocked by #544\n\n## User stories addressed\n\n- User story 30","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-08T11:12:01Z","comments":[],"actionableComment":null}`

## Chore Description

Delete the legacy `adws/adwInit.tsx` orchestrator. Per the parent PRD (`specs/prd/adw-init-hash-and-label-classification.md`, user story 30 and the "Files to delete" / "Manual escape hatch" sections), the responsibilities of `adwInit.tsx` are now absorbed by `adwUpgrade.tsx`, which runs `/adw_init` against a target-repo worktree via the hash-driven upgrade trigger (`adwUpgrade.tsx` calls `/adw_init` as a Claude slash command through `runClaudeAgentWithCommand`, not by importing `adwInit.tsx`).

This is the slice that was explicitly deferred by the `adwUpgrade.tsx` work (see `app_docs/feature-gj381g-adwupgrade-tsx-orche.md`: *"Do not delete `adwInit.tsx` — its removal is a separate PRD slice (#30)"*) and by `feature-541.steps.ts` (*"The legacy `init: 'adwInit.tsx'` entry is NOT removed here (separate PRD slice #30)"*). Issue #547 is that slice.

Scope is intentionally narrow:
1. Delete the orchestrator file `adws/adwInit.tsx`.
2. Remove the two code references to the literal path `adws/adwInit.tsx` in the routing maps (`adws/types/issueRouting.ts`).
3. Remove the `init: 'adwInit.tsx'` entry from the BDD test orchestrator map (`features/regression/step_definitions/whenSteps.ts`) and update the now-stale deferral note in `features/per-issue/step_definitions/feature-541.steps.ts`.
4. Update documentation (`README.md`, `adws/README.md`) so it no longer instructs callers to run `bunx tsx adws/adwInit.tsx` and instead documents the preserved manual `/adw_init` escape hatch + the `adwUpgrade.tsx` auto-regeneration path.

**Explicitly OUT of scope** (other PRD slices, NOT part of #547):
- The `.claude/commands/adw_init.md` slash-command file MUST be preserved — it is the manual escape hatch.
- Do NOT remove `extractAdwCommandFromText` / `classifyWithAdwCommand` from `adws/core/issueClassifier.ts` (that is the label-classification slice).
- Do NOT remove `/adw_init` from the `IssueClassSlashCommand` / `AdwSlashCommand` / `SlashCommand` type unions, from `VALID_ISSUE_TYPES`, or from the non-routing maps (`adwCommandToIssueTypeMap`, `commitPrefixMap`, `branchPrefixMap`, `branchPrefixAliases`, `modelRouting` maps, `issueTypeLabels`, `labelManager`). `/adw_init` remains a valid (manual-only) slash command and classification token; `issueTypeToAdwLabel('/adw_init')` is contractually `null` and has a test that depends on `/adw_init` still existing in the type.
- Do NOT remove `OrchestratorId.Init` (`'init-orchestrator'`) from `adws/core/constants.ts`. It is intentionally left unmapped in `ORCHESTRATOR_SCRIPT_BY_NAME`; the `orchestratorNamesForScript` / #529 disambiguation logic relies on `init-orchestrator` being an unmapped name. It does not reference the `adwInit.tsx` path.
- `adws/core/hashComputer.ts` references `.claude/commands/adw_init.md` (the slash-command spec, constant `ADW_INIT_RELATIVE_PATH`) — this is the preserved escape-hatch file, NOT the orchestrator. Leave it untouched.

## Relevant Files

Use these files to resolve the chore:

### Files to delete
- `adws/adwInit.tsx` — the orchestrator being deleted. It is a standalone `bunx tsx` entrypoint (`main()` is called at module load); it is not imported anywhere, so deletion has no import-graph fallout.

### Files to edit
- `adws/types/issueRouting.ts` — contains the only two code references to the literal path `'adws/adwInit.tsx'`:
  - Line ~50: `'/adw_init': 'adws/adwInit.tsx'` inside `adwCommandToOrchestratorMap` (typed `Partial<Record<AdwSlashCommand, string>>` — removing the entry is type-safe).
  - Line ~63: `'/adw_init': 'adws/adwInit.tsx'` inside `issueTypeToOrchestratorMap` (typed `Record<IssueClassSlashCommand, string>` — a *total* record, so the entry cannot be dropped without relaxing the type to `Partial<...>`).
- `adws/core/workflowMapping.ts` — `getWorkflowScript` is the sole consumer of `issueTypeToOrchestratorMap`; it already reads via `issueTypeToOrchestratorMap[issueType] ?? 'adws/adwPlanBuildTest.tsx'`, so a `Partial` map (returning `undefined` for `/adw_init`) is already handled by the existing `??` fallback. Verify only; no edit expected.
- `features/regression/step_definitions/whenSteps.ts` — `ORCHESTRATOR_FILES` map (typed `Record<string, string>`) has `init: 'adwInit.tsx'` (line ~62). Remove that entry. The map is currently only referenced inside a commented-out (ISSUE-3-CUTOVER `return 'pending'`) block, so this is a safe map-key removal.
- `features/per-issue/step_definitions/feature-541.steps.ts` — header comment (line ~21) states the `init: 'adwInit.tsx'` entry is *"NOT removed here (separate PRD slice #30)"*. Update this note to reflect that slice #30 (this issue) removes it, so the comment no longer dangles a reference to `adwInit.tsx`.
- `README.md` — `bunx tsx adws/adwInit.tsx 42 --target-repo ...` usage (line ~225) and the `├── adwInit.tsx` directory-tree entry (line ~751). Update the bootstrap section to describe the preserved manual `/adw_init` escape hatch and the `adwUpgrade.tsx` auto-regeneration trigger; remove the tree entry.
- `adws/README.md` — `adwInit.tsx` description (line ~729), and the "Bootstrapping" section (lines ~784, ~788, ~791) that instructs `bunx tsx adws/adwInit.tsx`. Update to point at the manual `/adw_init` slash command + `adwUpgrade.tsx`.

### Context / conditional documentation (read for background, do not edit)
- `specs/prd/adw-init-hash-and-label-classification.md` — parent PRD; user story 30, "Files to delete", "Manual escape hatch", and `adwUpgrade.tsx` orchestrator sections.
- `app_docs/feature-gj381g-adwupgrade-tsx-orche.md` — documents that `adwUpgrade.tsx` absorbs init via `/adw_init` slash command and that `adwInit.tsx` deletion is this slice (#30).
- `app_docs/feature-n9880l-adwversion-read-write-module.md` — versioned auto-(re)init system context (the hash-driven trigger that replaces the standalone init orchestrator).
- `app_docs/feature-6wnymj-shared-orchestrator-lifecycle-wrapper.md` — `adwInit` used `runWithOrchestratorLifecycle`; confirms no shared wrapper change is needed when the entrypoint is removed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Delete the orchestrator file
- Delete `adws/adwInit.tsx` (e.g. `git rm adws/adwInit.tsx`).
- Confirm `.claude/commands/adw_init.md` is untouched and still present (it is the preserved manual escape hatch — DO NOT delete it).

### 2. Remove the path references in `adws/types/issueRouting.ts`
- In `adwCommandToOrchestratorMap`, delete the line `'/adw_init': 'adws/adwInit.tsx',`. (Type is `Partial<Record<...>>`; no type fallout.)
- In `issueTypeToOrchestratorMap`, change the declared type from `Record<IssueClassSlashCommand, string>` to `Partial<Record<IssueClassSlashCommand, string>>` and delete the line `'/adw_init': 'adws/adwInit.tsx',`.
- Leave `adwCommandToIssueTypeMap`, `commitPrefixMap`, `branchPrefixMap`, and `branchPrefixAliases` (and their `/adw_init` entries) unchanged — they do not reference the orchestrator path and `/adw_init` remains a valid manual command/classification token.

### 3. Confirm `getWorkflowScript` still type-checks and behaves
- Open `adws/core/workflowMapping.ts`. Verify `getWorkflowScript` accesses `issueTypeToOrchestratorMap[issueType] ?? 'adws/adwPlanBuildTest.tsx'`. With the now-`Partial` map, a `/adw_init` lookup returns `undefined` and falls back to `adws/adwPlanBuildTest.tsx` — acceptable, since `/adw_init` is no longer an auto-routed classification. No code change expected; this is a verification step.

### 4. Remove the BDD test orchestrator-map entry
- In `features/regression/step_definitions/whenSteps.ts`, remove the `init: 'adwInit.tsx',` entry from the `ORCHESTRATOR_FILES` map. Leave the surrounding `upgrade: 'adwUpgrade.tsx'` and other entries intact.

### 5. Update the stale deferral note in feature-541 step defs
- In `features/per-issue/step_definitions/feature-541.steps.ts`, update the header comment (the W1 note, ~line 21) so it no longer says the `init: 'adwInit.tsx'` entry is preserved. Reword to note that slice #30 (issue #547) has now removed it, eliminating the dangling `adwInit.tsx` reference. Do not change any `Given`/`Then`/`When` step logic.

### 6. Update `README.md`
- In the "Run `adw_init` to bootstrap a target repo" section (~line 222), replace the `bunx tsx adws/adwInit.tsx 42 --target-repo ...` instruction. Document that (a) framework regeneration now happens automatically via the hash-driven `adwUpgrade.tsx` upgrade trigger, and (b) the manual escape hatch is invoking the `/adw_init` slash command inside a Claude Code CLI session against the target repo. Remove or rephrase the "Phase order" line that described the `adwInit.tsx` orchestrator phases.
- Remove the `├── adwInit.tsx` line (~line 751) from the directory-tree listing.

### 7. Update `adws/README.md`
- Remove the `` - `adwInit.tsx` - Initialize `.adw/` project configuration in target repos `` bullet (~line 729).
- In the "Bootstrapping" subsection (~lines 784–791), replace `Use the `/adw_init` command (via `adwInit.tsx`) ...` and both `bunx tsx adws/adwInit.tsx ...` code samples with guidance to (a) run the `/adw_init` slash command manually inside a Claude Code CLI session against the target repo, and (b) rely on `adwUpgrade.tsx` for automatic `.adw/` regeneration on framework-hash drift. Keep the description of what `/adw_init` produces (detects language/framework/package manager; generates the three config files).

### 8. Verify zero remaining references
- Run a repo-wide search to confirm no code/doc references to `adws/adwInit.tsx` or the bare `adwInit.tsx` filename remain (excluding `node_modules`, `specs/`, this plan, and historical `workers/screenshot-router/logs/` capture files which are immutable run artifacts, not code). See Validation Commands.

### 9. Run all validation commands
- Execute every command in the Validation Commands section. All must pass with zero errors/regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `test ! -f adws/adwInit.tsx && echo "OK: adwInit.tsx deleted"` — confirm the orchestrator file is gone.
- `test -f .claude/commands/adw_init.md && echo "OK: adw_init.md slash command preserved"` — confirm the manual escape hatch is intact.
- `grep -rIn "adws/adwInit.tsx\|adwInit\.tsx" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" --include="*.yml" adws/ features/ README.md` — must return **no matches** (the only remaining hits in the repo are immutable `workers/screenshot-router/logs/**` run captures, which are not code). Confirm zero hits in the searched paths.
- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Type-check the root project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the `adws/` project (catches the `issueTypeToOrchestratorMap` / `getWorkflowScript` change).
- `bun run test:unit` — Run unit tests (covers `gitAgent.test.ts`, `labelManager.test.ts`, `branchOperations.test.ts`, which exercise the preserved `/adw_init` token).
- `bun run build` — Build to verify no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run regression BDD scenarios to confirm the `ORCHESTRATOR_FILES` map edit and step-definition changes introduce no regressions.

## Notes
- `.adw/coding_guidelines.md` and `guidelines/coding_guidelines.md` were not found in this repo; no extra guideline constraints apply beyond matching the surrounding code style.
- The script execution command for this project is `bunx tsx <script name>` (per `.adw/commands.md`).
- Key scope guard: the only literal `adws/adwInit.tsx` path references are the two routing-map entries in `adws/types/issueRouting.ts`. The `init: 'adwInit.tsx'` entry in `whenSteps.ts` is the only other code reference to the filename. Everything else that mentions `/adw_init` refers to the preserved slash command, the classification token, or the `.claude/commands/adw_init.md` spec — all of which must remain.
- `issueTypeToOrchestratorMap` is changed from a total `Record` to `Partial<Record<...>>` so the `/adw_init` key can be dropped; `getWorkflowScript`'s existing `?? 'adws/adwPlanBuildTest.tsx'` fallback already covers the absent key, so no behavioral regression for any real classification path.
- Do not touch `adws/core/hashComputer.ts` — its `ADW_INIT_RELATIVE_PATH = '.claude/commands/adw_init.md'` points at the preserved slash-command spec, not the deleted orchestrator.
