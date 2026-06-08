# Feature: Delete the `extractAdwCommandFromText` regex classification path

## Metadata
issueNumber: `546`
adwId: `d6rky0-delete-extractadwcom`
issueJson: `{"number":546,"title":"Delete extractAdwCommandFromText regex path","body":"## Parent PRD\n\n`specs/prd/adw-init-hash-and-label-classification.md`\n\n## What to build\n\nRemove `extractAdwCommandFromText` and `classifyWithAdwCommand` from `core/issueClassifier.ts`. Remove ```/adw_init``` entries from `adwCommandToIssueTypeMap` and related routing maps in `types/issueRouting.ts`. The `classifyIssueForTrigger` two-step path collapses to LLM-only.\n\nOrchestrator-level commands (`/adw_sdlc`, `/adw_plan_build_test`, etc.) lose body/comment invocation entirely. Power-user invocation is via CLI or via labels.\n\n**Point of no return** — once merged, body slash-commands no longer trigger ADW. Confirm the hash-driven trigger (#544) and label routing (#542) are working before merging this.\n\nSee \"Trigger plumbing\" and \"Files to delete\" sections of the parent PRD.\n\n## Acceptance criteria\n\n- [ ] `extractAdwCommandFromText` and `classifyWithAdwCommand` functions removed\n- [ ] ```/adw_init``` entries removed from `adwCommandToIssueTypeMap` and any related routing maps\n- [ ] `classifyIssueForTrigger` simplified to LLM-only path\n- [ ] No body or comment text scanning for `/adw_*` commands remains anywhere in the codebase\n- [ ] Existing tests for the removed functions are deleted\n- [ ] Existing comment-trigger workflow control (`## Continue`, `## Cancel`, `## Retry`) is unaffected\n\n## Blocked by\n\n- Blocked by #544\n- Blocked by #542\n\n## User stories addressed\n\n- User story 24","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-08T11:11:57Z","comments":[],"actionableComment":null}`

## Feature Description

ADW classifies every incoming issue to decide which orchestrator to spawn. Today that classification is a **two-step path** in `adws/core/issueClassifier.ts`:

1. **Step 1 — deterministic regex command extraction.** `classifyWithAdwCommand` calls `extractAdwCommandFromText`, which scans the issue body/comments for `/adw_*` slash-command substrings (the keys of `adwCommandToIssueTypeMap`). A match short-circuits classification and routes directly.
2. **Step 2 — LLM heuristic fallback.** If no command is matched, `classifyWithIssueCommand` runs the `/classify_issue` Claude agent.

The regex step is the last surviving member of the **trigger-by-substring** failure class documented in the README ("Classifier misidentification"): any issue author who writes `/adw_init`, `/adw_sdlc`, or `/feature` in prose without backticking it can accidentally trigger (or misroute) an ADW workflow. The parent PRD (`specs/prd/adw-init-hash-and-label-classification.md`) eliminates this class by replacing the two upstream invocation mechanisms:

- **Hash-driven init/upgrade** (#544 — already merged: `upgradeGate.ts` runs inside `initializeWorkflow()`) replaces the `/adw_init` body trigger.
- **Label-based classification** (#542 — already merged: `labelManager.ts` + `classifyAndSpawnWorkflow`'s `labelRouting`) replaces body slash-command classification for `/feature`, `/bug`, `/chore`, `/pr_review`.

With both replacements in place, **this issue is the demolition step**: delete the regex command-extraction path entirely so classification collapses to LLM-only, and remove the now-orphaned command-routing maps and types it fed. After this change, orchestrator-level commands (`/adw_sdlc`, `/adw_plan_build_test`, etc.) can only be invoked via the CLI (`bunx tsx adws/<orchestrator>.tsx <issueNumber>`) or via `adw:*` labels — never by body/comment text.

This is a **point-of-no-return** change: once merged, body slash-commands no longer trigger ADW. #544 and #542 are confirmed merged into this branch (`upgradeGate.ts` and `labelManager.ts` both present), satisfying the blockers.

## User Story

As the **framework operator** (User Story 24),
I want **orchestrator-level commands (`/adw_sdlc`, `/adw_plan_build_test`, etc.) and `/adw_init` to lose their body/comment invocation path**,
So that **the entire body-regex misfire class is eliminated for both classification and orchestrator routing, and an author can never accidentally trigger or misroute a workflow by mentioning a slash command in prose.**

## Problem Statement

The deterministic regex step in `classifyIssueForTrigger` / `classifyGitHubIssue` scans free-form issue text for `/adw_*` substrings. This is the residual surface of the recurring "trigger-by-substring" failure mode: a slash command typed in unrelated prose collides with normal English/Markdown and silently triggers or misroutes an ADW workflow. The hash-driven trigger (#544) and label-based classification (#542) now cover every legitimate invocation path, so the regex step is both **redundant** and a **liability**. Leaving it in place keeps the misfire class alive and keeps a now-dead chain of supporting code (`adwCommandToIssueTypeMap`, `adwCommandToOrchestratorMap`, the `AdwSlashCommand` type, and the `adwCommand` plumbing) in the tree.

## Solution Statement

Delete the regex command-extraction path and let classification collapse to a single LLM-only step, then remove every symbol that becomes unreachable as a direct consequence:

1. **Delete the regex functions** `extractAdwCommandFromText`, `classifyWithAdwCommand` from `issueClassifier.ts`, plus their now-orphaned helpers `extractAdwIdFromText` and `stripFencedCodeBlocks` (both only reachable from the deleted functions).
2. **Collapse** `classifyIssueForTrigger` and `classifyGitHubIssue` to the LLM-only path (`classifyWithIssueCommand`), preserving the existing comment-based `adwId` recovery (which uses `extractAdwIdFromComment`, a separate heading/backtick parser — unaffected).
3. **Remove the command-routing maps** that fed the regex scan and that become dead once the functions are gone: `adwCommandToIssueTypeMap` (its only consumers were the two deleted functions) and `adwCommandToOrchestratorMap` (its only consumer is the now-dead `adwCommand` branch of `getWorkflowScript`). Removing the `/adw_init` map entries is therefore subsumed by deleting the whole dead maps.
4. **Remove the `AdwSlashCommand` type** and the `IssueClassificationResult.adwCommand` field, which become unreferenced once the maps and the regex path are gone, and **simplify `getWorkflowScript`** to `getWorkflowScript(issueType)`.
5. **Preserve** everything tied to `/adw_init` as a *classification type* (`IssueClassSlashCommand`, `VALID_ISSUE_TYPES`, `issueTypeToOrchestratorMap`, `commitPrefixMap`, `branchPrefixMap`, `branchPrefixAliases`) because `adws/adwInit.tsx` still exists — its deletion is User Story 30 / a separate issue and explicitly out of scope here. `/adw_init` must remain a routable issue type for the CLI escape hatch.
6. **Preserve** the heading-based comment directives (`## Continue`, `## Cancel`, `## Retry`) — they live in `core/workflowCommentParsing.ts` and are never touched by this change.

This satisfies all six acceptance criteria while honoring the coding guideline "remove unused variables, functions, and imports" (no half-removed dead maps left behind). See **Notes** for the explicit scope boundary on what stays vs. goes.

## Relevant Files

Use these files to implement the feature:

### Files to edit

- `adws/core/issueClassifier.ts` — **primary surgery.** Delete `stripFencedCodeBlocks`, `extractAdwCommandFromText`, `extractAdwIdFromText`, `classifyWithAdwCommand`; remove the `adwCommand` field from `IssueClassificationResult`; strip the Step-1 regex blocks from `classifyIssueForTrigger` and `classifyGitHubIssue` so they call only `classifyWithIssueCommand`; fix the module JSDoc and the surviving log lines that print `adwCommand`; drop the `AdwSlashCommand` / `adwCommandToIssueTypeMap` imports. Keep the `extractAdwIdFromComment` import (comment-based `adwId` recovery stays) and the tail `getWorkflowScript` re-export.
- `adws/types/issueRouting.ts` — delete the `adwCommandToIssueTypeMap` and `adwCommandToOrchestratorMap` map definitions and the `import type { AdwSlashCommand }`. Keep `issueTypeToOrchestratorMap`, `commitPrefixMap`, `branchPrefixMap`, `branchPrefixAliases` (all retain their `/adw_init` entries). Update the file's top doc comment.
- `adws/types/issueTypes.ts` — delete the `AdwSlashCommand` type definition (lines ~9–25); remove `adwCommandToIssueTypeMap` and `adwCommandToOrchestratorMap` from the re-export block (lines ~28–35). Keep `IssueClassSlashCommand` (with `/adw_init`), `VALID_ISSUE_TYPES` (with `/adw_init`), `SlashCommand` (with `/adw_init`), and the remaining map re-exports.
- `adws/core/workflowMapping.ts` — simplify `getWorkflowScript` to `getWorkflowScript(issueType: IssueClassSlashCommand): string` (drop the `adwCommand` param and the `adwCommandToOrchestratorMap` branch); remove the `AdwSlashCommand` and `adwCommandToOrchestratorMap` imports; update the JSDoc.
- `adws/core/index.ts` — remove `AdwSlashCommand` from the type re-export (line ~16); remove `adwCommandToIssueTypeMap, adwCommandToOrchestratorMap` from the routing-maps re-export (line ~57); remove `extractAdwIdFromText` from the issueClassifier re-export (line ~113).
- `adws/triggers/webhookGatekeeper.ts` — in `classifyAndSpawnWorkflow`: remove `adwCommand: undefined` from the precomputed-classification object literal (line ~112) and change the two `getWorkflowScript(...)` calls (lines ~102, ~121) to pass only `issueType`.
- `README.md` — fix the one stale "What it does" bullet that claims "explicit ADW slash commands override the heuristic" (line ~113), which becomes false after this change. Minimal one-line edit; documentation accuracy only.

### Files to verify unchanged (regression guards — do NOT modify)

- `adws/core/workflowCommentParsing.ts` — home of `## Continue`/`## Cancel`/`## Retry` parsing (`isCancelComment`, `isRetryComment`, `isActionableComment`, `extractAdwIdFromComment`). Must remain functionally identical (AC#6).
- `adws/adwInit.tsx` — still exists; `/adw_init` stays a routable issue type. Do not delete (User Story 30 / separate issue).
- `adws/phases/__tests__/workflowInit.test.ts` — mocks `classifyGitHubIssue` (kept, only internally simplified). The mock stays valid; confirm it still passes.
- `.claude/commands/classify_issue.md` — the LLM classifier prompt; only emits `/bug`/`/feature`/`/pr_review`/`/chore`/`0` (never `/adw_init`), so no change needed. Confirms the LLM path cannot produce `/adw_init`.

### Conditional docs (read for context per `.adw/conditional_docs.md`)

- `app_docs/feature-u8okxe-bug-sdlc-chore-classifier.md` — matches "modifying issue classification logic or the `/classify_issue` command", "working with `issueTypeToOrchestratorMap`", "updating orchestrator routing for any issue type".
- `app_docs/feature-gmfhco-issues-opened-label-routed-handler.md` — matches "extending `classifyAndSpawnWorkflow` in `webhookGatekeeper.ts` with `labelRouting` options" (the #542 replacement path and the file edited here).
- `app_docs/feature-0cv18u-fix-cross-trigger-spawn-dedup.md` — matches "working with `classifyAndSpawnWorkflow` in `webhookGatekeeper.ts` or the cron/webhook trigger paths".
- `specs/prd/adw-init-hash-and-label-classification.md` — parent PRD; see "Trigger plumbing" and "Files to delete".

### New Files

None. This is a deletion/simplification change; no new modules are created.

## Implementation Plan

### Phase 1: Foundation — remove the dead routing maps and type

Start at the data layer so the type system surfaces every downstream break immediately. Delete `adwCommandToIssueTypeMap` and `adwCommandToOrchestratorMap` from `issueRouting.ts`, delete the `AdwSlashCommand` type from `issueTypes.ts`, and prune the re-exports in `issueTypes.ts` and `core/index.ts`. After this phase the compiler will flag exactly the remaining call sites that must change (`issueClassifier.ts`, `workflowMapping.ts`, `webhookGatekeeper.ts`), which de-risks the rest.

### Phase 2: Core Implementation — delete the regex path in `issueClassifier.ts`

Remove `stripFencedCodeBlocks`, `extractAdwCommandFromText`, `extractAdwIdFromText`, and `classifyWithAdwCommand`; remove the `adwCommand` field from `IssueClassificationResult`; collapse `classifyIssueForTrigger` and `classifyGitHubIssue` to call only `classifyWithIssueCommand`, keeping the comment-based `adwId` recovery loops. Update the module JSDoc and surviving log lines. Simplify `getWorkflowScript` to drop the `adwCommand` parameter.

### Phase 3: Integration — fix consumers and verify the trigger paths

Update `webhookGatekeeper.ts` (the precomputed-classification literal and the two `getWorkflowScript` calls). Fix the stale README bullet. Then run the full validation suite and the symbol-absence greps to prove the regex path is gone with zero dangling references and zero behavior change to `## Continue`/`## Cancel`/`## Retry`.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1: Remove the command-routing maps from `issueRouting.ts`
- Delete the entire `adwCommandToIssueTypeMap` definition.
- Delete the entire `adwCommandToOrchestratorMap` definition.
- Delete the now-unused `import type { AdwSlashCommand } from './issueTypes';` line.
- Keep `issueTypeToOrchestratorMap`, `commitPrefixMap`, `branchPrefixMap`, `branchPrefixAliases` exactly as-is (they retain their `/adw_init` entries because `/adw_init` remains a valid `IssueClassSlashCommand`).
- Update the file's top-of-file doc comment so it no longer describes the deleted command maps.

### Task 2: Remove the `AdwSlashCommand` type and prune re-exports in `issueTypes.ts`
- Delete the `AdwSlashCommand` type definition block.
- In the `export { ... } from './issueRouting';` re-export block, remove `adwCommandToIssueTypeMap` and `adwCommandToOrchestratorMap`; keep `issueTypeToOrchestratorMap`, `commitPrefixMap`, `branchPrefixMap`, `branchPrefixAliases`.
- Leave `IssueClassSlashCommand`, `VALID_ISSUE_TYPES`, and `SlashCommand` untouched (all keep `/adw_init`).

### Task 3: Prune re-exports in `core/index.ts`
- Remove `AdwSlashCommand` from the `export type { ... } from '../types/issueTypes';` block (line ~16).
- Remove `adwCommandToIssueTypeMap, adwCommandToOrchestratorMap` from the routing-maps re-export (line ~57), keeping `commitPrefixMap, branchPrefixMap, branchPrefixAliases, issueTypeToOrchestratorMap`.
- Remove `extractAdwIdFromText` from the `export { classifyIssueForTrigger, classifyGitHubIssue, extractAdwIdFromText } from './issueClassifier';` line (line ~113), keeping `classifyIssueForTrigger, classifyGitHubIssue`.

### Task 4: Simplify `getWorkflowScript` in `workflowMapping.ts`
- Change the signature to `export function getWorkflowScript(issueType: IssueClassSlashCommand): string`.
- Delete the `if (adwCommand) { ... adwCommandToOrchestratorMap[adwCommand] ... }` branch.
- Remove `AdwSlashCommand` and `adwCommandToOrchestratorMap` from the imports (keep `IssueClassSlashCommand` and `issueTypeToOrchestratorMap`).
- Update the JSDoc to describe issue-type-only routing with the `adws/adwPlanBuildTest.tsx` default fallback.

### Task 5: Delete the regex functions and helpers in `issueClassifier.ts`
- Delete `stripFencedCodeBlocks` (orphaned once both extract functions are gone).
- Delete `extractAdwCommandFromText`.
- Delete `extractAdwIdFromText` (its only caller was `classifyWithAdwCommand`; no other repo consumer).
- Delete `classifyWithAdwCommand`.
- Remove the `adwCommand?: AdwSlashCommand;` field from the `IssueClassificationResult` interface.
- Remove `AdwSlashCommand` and `adwCommandToIssueTypeMap` from the `import { ... } from '.';` block. Keep `IssueClassSlashCommand`, `VALID_ISSUE_TYPES`, `log`, `GitHubIssue`, `getModelForCommand`, `getEffortForCommand`. Keep the `extractAdwIdFromComment` import from `./workflowCommentParsing` and the `fetchGitHubIssue`, `RepoInfo`, `runClaudeAgentWithCommand` imports.

### Task 6: Collapse `classifyIssueForTrigger` to LLM-only
- Remove the "Step 1: Try deterministic ADW command extraction" block (the `classifyWithAdwCommand` call and its `if (adwResult) { ... }` branch, including that branch's comment-`adwId` recovery and `return`).
- Keep the LLM step: build `issueContext`, call `classifyWithIssueCommand`, then run the comment-`adwId` recovery loop over `issue.comments` on the heuristic result, and return `{ ...heuristicResult, issueTitle: issue.title }`.
- Update the surviving "Classification complete" log line to drop the `adwCommand=` field and the `classifier=heuristic` qualifier may be simplified (LLM is now the only classifier).
- Update the function's JSDoc to say LLM-only (no "two-step").

### Task 7: Collapse `classifyGitHubIssue` to LLM-only
- Remove the "Step 1: Try deterministic ADW command extraction" block and its `if (adwResult) { ... return adwResult; }`.
- Keep the LLM step (`classifyWithIssueCommand`) and the final return.
- Update the surviving log line to drop `adwCommand=`, and update the JSDoc to say LLM-only.
- Update the module-level JSDoc header (lines 1–7) to describe single-step LLM classification instead of "two-step".

### Task 8: Fix consumers in `webhookGatekeeper.ts`
- In the `labelRouting?.precomputedClassification` object literal, remove `adwCommand: undefined` (keep `issueType`, `success: true as const`, `issueTitle`, `adwId: undefined`).
- Change `getWorkflowScript(classification.issueType, classification.adwCommand)` → `getWorkflowScript(classification.issueType)`.
- Change `getWorkflowScript('/feature', undefined)` (takeover path) → `getWorkflowScript('/feature')`.

### Task 9: Fix the stale README bullet
- In `README.md` "What it does", update the issue-classification bullet that reads "explicit ADW slash commands override the heuristic" to reflect the new reality: classification is LLM-only with `adw:*` labels as the deterministic override; body/comment slash-commands no longer trigger ADW. Keep it to one accurate sentence.

### Task 10: Add/confirm unit coverage for `getWorkflowScript`
- Add a focused Vitest unit test (e.g. `adws/core/__tests__/workflowMapping.test.ts`) asserting the pure-function routing after simplification: each `IssueClassSlashCommand` (`/bug`, `/chore`, `/feature`, `/pr_review`, `/adw_init`) maps to its expected orchestrator from `issueTypeToOrchestratorMap`, and an unmapped/garbage value falls back to `adws/adwPlanBuildTest.tsx`. This is genuinely unit-testable (no Claude calls) and guards the signature change.
- Confirm `adws/phases/__tests__/workflowInit.test.ts` still passes unchanged (its `classifyGitHubIssue` mock remains valid).

### Task 11: Prove the regex path is gone (symbol-absence assertions)
- Run repo-wide greps and confirm **zero** non-spec matches for: `extractAdwCommandFromText`, `classifyWithAdwCommand`, `adwCommandToIssueTypeMap`, `adwCommandToOrchestratorMap`, `AdwSlashCommand`, `extractAdwIdFromText`, `stripFencedCodeBlocks`, and `.adwCommand`.
- Confirm there is no remaining logic anywhere that scans `issue.body` or comment text for `/adw_*` command substrings (AC#4).
- Confirm `## Continue` / `## Cancel` / `## Retry` parsing in `core/workflowCommentParsing.ts` is untouched (AC#6).

### Task 12: Run the Validation Commands
- Execute every command in the **Validation Commands** section and ensure each exits cleanly with zero errors and zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit coverage is in scope. Note the parent PRD's testing decision (its "Modules NOT tested in isolation" section): modifications to `issueClassifier.ts` are validated at the integration/BDD level rather than by isolated unit tests, because unit-testing an LLM-calling function in isolation only exercises mocks. Unit tests here therefore focus on the genuinely pure, deterministic surface affected by the change:

- **`getWorkflowScript` (pure function)** — new test `adws/core/__tests__/workflowMapping.test.ts`:
  - Maps `/bug → adws/adwSdlc.tsx`, `/chore → adws/adwChore.tsx`, `/feature → adws/adwSdlc.tsx`, `/pr_review → adws/adwPlanBuild.tsx`, `/adw_init → adws/adwInit.tsx` (asserting against `issueTypeToOrchestratorMap`).
  - Falls back to `adws/adwPlanBuildTest.tsx` for an unmapped value.
  - (Implicitly verifies the signature no longer accepts/needs a second `adwCommand` argument.)
- **Regression guard** — `adws/phases/__tests__/workflowInit.test.ts` continues to pass with no edits, confirming `classifyGitHubIssue` remains a valid, mockable export after the internal collapse.

### Edge Cases
- An issue **body containing `/adw_init`, `/adw_sdlc`, or `/adw_plan_build_test` in prose** (un-backticked) must NOT trigger or alter routing — classification now depends solely on the LLM / `adw:*` labels.
- An issue body with a **fenced code block** containing `/adw_*` text — previously stripped by `stripFencedCodeBlocks`; now irrelevant since no body command scanning exists.
- A **retry scenario** where the `adwId` lives only in a prior issue comment — the comment-based recovery (`extractAdwIdFromComment`) must still recover it on the LLM-only path (both `classifyIssueForTrigger` and the cron recovery flow).
- **`## Cancel`, `## Retry`, `## Continue`** comments must still be detected and acted upon (heading-based, in `workflowCommentParsing.ts`).
- A **label-routed issue** (`labelRouting.precomputedClassification` set) must still spawn the correct orchestrator after `adwCommand` is removed from the precomputed literal.
- The **CLI escape hatch** `bunx tsx adws/adwInit.tsx <n>` / `--issue-type /adw_init` must still resolve via `issueTypeToOrchestratorMap['/adw_init']` → `adws/adwInit.tsx`.
- An issue where the **LLM classifier fails** must still default to `/feature` (existing fail-safe in `classifyWithIssueCommand`), unchanged.

## Acceptance Criteria

- [ ] `extractAdwCommandFromText` and `classifyWithAdwCommand` are removed from `adws/core/issueClassifier.ts` (along with their orphaned helpers `extractAdwIdFromText` and `stripFencedCodeBlocks`).
- [ ] `/adw_init` map entries are removed; the dead `adwCommandToIssueTypeMap` and `adwCommandToOrchestratorMap` maps (and the `AdwSlashCommand` type) are deleted from `types/issueRouting.ts` and `types/issueTypes.ts`, with re-exports pruned in `core/index.ts`.
- [ ] `classifyIssueForTrigger` and `classifyGitHubIssue` are simplified to the LLM-only path (`classifyWithIssueCommand`), preserving comment-based `adwId` recovery.
- [ ] No body or comment text scanning for `/adw_*` commands remains anywhere in the codebase (verified by symbol-absence greps and a manual check of classifier/trigger code).
- [ ] No dedicated tests existed for the removed functions; the only consumer test (`workflowInit.test.ts`) is unaffected and still passes. A new pure-function test covers the simplified `getWorkflowScript`.
- [ ] `## Continue`, `## Cancel`, and `## Retry` comment-trigger workflow control is unaffected (`workflowCommentParsing.ts` untouched; behavior confirmed).
- [ ] `/adw_init` remains a valid `IssueClassSlashCommand` routable to `adws/adwInit.tsx` via the CLI escape hatch (adwInit.tsx is NOT deleted in this issue).
- [ ] All Validation Commands pass with zero errors and zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are sourced from `.adw/commands.md`.

- `bun run lint` — ESLint (`eslint .`); also catches any unused import/variable left behind by the deletions, validating the dead-code removal.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check (from `## Additional Type Checks`); the strongest gate — surfaces every dangling reference to a removed symbol/type.
- `bun run build` — root TypeScript build (`tsc`); confirms no build errors.
- `bun run test:unit` — Vitest (`vitest run`); runs the new `workflowMapping` test and confirms `workflowInit.test.ts` (and the rest of the suite) still pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression BDD scenarios; confirms no end-to-end regression in trigger/classification/cancel/retry flows.
- Symbol-absence assertion (must print nothing outside `specs/`):
  `grep -rn "extractAdwCommandFromText\|classifyWithAdwCommand\|adwCommandToIssueTypeMap\|adwCommandToOrchestratorMap\|AdwSlashCommand\|extractAdwIdFromText\|stripFencedCodeBlocks\|\.adwCommand" adws/ --include="*.ts" --include="*.tsx"`
- Comment-directive guard (must still find the parsers, proving AC#6 untouched):
  `grep -rn "isCancelComment\|isRetryComment\|isActionableComment" adws/core/workflowCommentParsing.ts`

## Notes

- **Coding guidelines:** `.adw/coding_guidelines.md` applies. The mandate "Remove unused variables, functions, and imports" / "Code hygiene" is the reason this plan deletes the *entire* dead maps (`adwCommandToIssueTypeMap`, `adwCommandToOrchestratorMap`) and the `AdwSlashCommand` type rather than merely stripping their `/adw_init` entries — once the two regex functions are gone, those maps have **zero runtime consumers**, so leaving them (or leaving an always-`undefined` `adwCommand` field and a dead `getWorkflowScript` branch) would itself violate the guidelines. This is a strict superset of acceptance criterion #2 ("remove `/adw_init` entries … and any related routing maps").

- **Explicit scope boundary — what STAYS:** `/adw_init` is preserved as an `IssueClassSlashCommand` and in the four issue-**type**-keyed maps (`issueTypeToOrchestratorMap`, `commitPrefixMap`, `branchPrefixMap`, `branchPrefixAliases`) plus `VALID_ISSUE_TYPES` and the standalone `SlashCommand` union. Rationale: `adws/adwInit.tsx` still exists — its removal is **User Story 30 / a separate issue**, and the PRD preserves `/adw_init` as a manual CLI escape hatch. Removing `/adw_init` from `IssueClassSlashCommand` would force-orphan the still-live `adwInit.tsx` routing and exceed this issue's scope. The maps deleted here are only the `AdwSlashCommand`-keyed **command-routing** maps that fed the body-regex path.

- **Why `extractAdwIdFromText` and `stripFencedCodeBlocks` are deleted too:** both are reachable only from the deleted regex functions (verified repo-wide — `extractAdwIdFromText` has no consumer beyond its own re-export; `stripFencedCodeBlocks` is used only by the two deleted extractors). They are part of "the regex path" named in the issue title. The separate, still-needed `adwId` recovery uses `extractAdwIdFromComment` in `workflowCommentParsing.ts` (heading/backtick parser), which is **not** touched.

- **Blockers confirmed merged into this branch:** `adws/phases/upgradeGate.ts` (#544 hash-driven init/upgrade) and `adws/github/labelManager.ts` + `classifyAndSpawnWorkflow`'s `labelRouting` (#542 label classification) are both present. The two upstream invocation paths the regex step replaced are live, so this demolition is safe to proceed.

- **Point of no return:** after merge, body/comment slash-commands no longer trigger or route ADW. Orchestrator-level commands are CLI-only (`bunx tsx adws/<orchestrator>.tsx <issueNumber>`) or label-driven going forward. This is an intended, documented behavior change (PRD "Significant policy shifts vs. today").

- **No new libraries.** Library install command (per `.adw/commands.md`) is `bun add <package>` if ever needed — not needed here.

- **Documentation:** `app_docs/` feature docs are produced by the ADW document phase; this plan only corrects the one actively-contradictory README bullet. `UBIQUITOUS_LANGUAGE.md` mentions of `/adw_sdlc`/`/adw_plan_build` as examples remain valid (they still exist as CLI orchestrators), so no edit is required there.
