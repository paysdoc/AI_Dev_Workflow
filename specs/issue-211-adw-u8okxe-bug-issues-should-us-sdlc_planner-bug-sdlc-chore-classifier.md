# Feature: Bug SDLC routing and chore classification tightening

## Metadata
issueNumber: `211`
adwId: `u8okxe-bug-issues-should-us`
issueJson: `{"number":211,"title":"Bug issues should use full SDLC orchestrator; tighten chore classification","body":"## Description\n\nTwo related changes to improve review coverage and classification accuracy:\n\n### 1. Route bug issues through `adwSdlc`\n\nBug issues currently map to `adwPlanBuildTest.tsx` (plan + build + test), which skips the review phase entirely. This means no regression scenario proof is generated or posted to the PR for bug fixes.\n\nBug fixes can introduce regressions just as easily as features. They should go through the full SDLC pipeline (plan + build + test + review + document) so that scenario proof is generated and visible on the PR.\n\n**Change in `adws/types/issueTypes.ts`:**\n```ts\n// Before\n'/bug': 'adws/adwPlanBuildTest.tsx',\n\n// After\n'/bug': 'adws/adwSdlc.tsx',\n```\n\n`/chore` remains `adwPlanBuild.tsx`. `/feature` remains `adwSdlc.tsx`.\n\n### 2. Tighten chore classification\n\nThe issue classifier currently assigns `/chore` too liberally. Since chores skip testing, review, and documentation, misclassifying a bug or feature as a chore means no proof is generated.\n\nThe classifier should only assign `/chore` when:\n- The issue explicitly requests it (e.g., contains `/chore`)\n- The changes are very unlikely to affect application logic (e.g., config-only, documentation-only, dependency bumps, CI/CD changes)\n\nIf there is any doubt, prefer `/bug` or `/feature` over `/chore`.\n\n**File:** `adws/core/issueClassifier.ts` (and any related classifier prompt/logic)\n\n## Acceptance Criteria\n\n- [ ] `issueTypeToOrchestratorMap` maps `/bug` to `adws/adwSdlc.tsx`\n- [ ] `/chore` mapping remains `adws/adwPlanBuild.tsx` (unchanged)\n- [ ] `/feature` mapping remains `adws/adwSdlc.tsx` (unchanged)\n- [ ] Classifier only assigns `/chore` when explicitly stated or when changes are config/docs-only\n- [ ] Ambiguous issues default to `/bug` or `/feature`, not `/chore`\n- [ ] Type-checks pass (`bunx tsc --noEmit --project adws/tsconfig.json`)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-17T10:01:09Z","comments":[],"actionableComment":null}`

## Feature Description
Two related changes to improve review coverage and issue classification accuracy in ADW:

1. **Route bug issues through the full SDLC pipeline** (`adwSdlc.tsx`) instead of `adwPlanBuildTest.tsx`. Bug fixes currently skip the review and documentation phases, meaning no regression scenario proof is generated or posted to the PR. Since bug fixes can introduce regressions just as easily as features, they should receive the same review coverage.

2. **Tighten chore classification** in the AI classifier prompt. The current prompt allows the LLM to assign `/chore` too liberally. Because chores skip testing, review, and documentation, misclassification means no proof is generated. The classifier should only assign `/chore` when the issue explicitly requests it or when changes are strictly non-logic (config-only, docs-only, dependency bumps, CI/CD).

## User Story
As an ADW operator
I want bug issues to go through the full SDLC pipeline and chore classification to be stricter
So that bug fix PRs include regression scenario proof and issues are not silently downgraded to chores that skip quality gates

## Problem Statement
Bug issues currently map to `adwPlanBuildTest.tsx`, which skips review and documentation. This means no regression scenario proof is generated for bug fix PRs. Additionally, the AI classifier assigns `/chore` too liberally, which can cause bugs or features to skip testing, review, and documentation entirely.

## Solution Statement
1. Change the `issueTypeToOrchestratorMap` entry for `/bug` from `adws/adwPlanBuildTest.tsx` to `adws/adwSdlc.tsx`, giving bug fixes the same full pipeline as features.
2. Update the `/classify_issue` prompt in `.claude/commands/classify_issue.md` to add explicit guardrails around `/chore` assignment: only assign it when the issue explicitly requests `/chore` or when changes are strictly config/docs/CI-only. When in doubt, prefer `/bug` or `/feature`.
3. Update `adws/README.md` workflow selection documentation to reflect the new bug routing.

## Relevant Files
Use these files to implement the feature:

- `adws/types/issueTypes.ts` — Contains `issueTypeToOrchestratorMap` where `/bug` must be remapped from `adwPlanBuildTest.tsx` to `adwSdlc.tsx` (line 75).
- `.claude/commands/classify_issue.md` — Contains the AI classifier prompt used by the heuristic fallback; needs tightened `/chore` classification rules.
- `adws/README.md` — Documents workflow selection per issue type (line 321); must be updated to reflect bug → `adwSdlc.tsx`.
- `adws/core/issueClassifier.ts` — Contains the classifier logic; no code changes needed but important for understanding the two-step classification flow (regex + AI fallback).
- `adws/core/workflowMapping.ts` — Contains `getWorkflowScript()` which consumes the map; no changes needed but relevant for understanding routing.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Implementation Plan
### Phase 1: Foundation
Update the orchestrator mapping constant in `issueTypes.ts` to route `/bug` through `adwSdlc.tsx`. This is a single-line change that affects all downstream routing.

### Phase 2: Core Implementation
Tighten the `/classify_issue` prompt in `.claude/commands/classify_issue.md` to add explicit guardrails:
- Only assign `/chore` when the issue explicitly contains `/chore` or when changes are strictly non-logic (config-only, documentation-only, dependency bumps, CI/CD changes).
- When in doubt, prefer `/bug` or `/feature` over `/chore`.

### Phase 3: Integration
Update documentation in `adws/README.md` to reflect the new bug routing and ensure consistency across all references.

## Step by Step Tasks

### Step 1: Update bug orchestrator mapping
- Open `adws/types/issueTypes.ts`
- Change line 75 from `'/bug': 'adws/adwPlanBuildTest.tsx',` to `'/bug': 'adws/adwSdlc.tsx',`
- Verify `/chore` remains `adws/adwPlanBuild.tsx` (line 76)
- Verify `/feature` remains `adws/adwSdlc.tsx` (line 77)

### Step 2: Tighten chore classification in AI classifier prompt
- Open `.claude/commands/classify_issue.md`
- Update the `## Command Mapping` section to add stricter `/chore` classification rules:
  - Only respond with `/chore` when the issue **explicitly** requests `/chore` OR when the changes are strictly config-only, documentation-only, dependency bumps, or CI/CD-only
  - If there is any doubt whether an issue is a chore or a bug/feature, prefer `/bug` or `/feature`
  - Clarify that `/chore` should NOT be used for issues that touch application logic, even if they seem like "maintenance"

### Step 3: Update adws/README.md documentation
- Open `adws/README.md`
- Update the "Workflow selection" section (around line 321) to change `Bug issues → adwPlanBuildTest.tsx` to `Bug issues → adwSdlc.tsx`
- Update the "Common Usage Scenarios > Process a bug report" section (around line 382) to reference `adwSdlc.tsx` instead of `adwPlanBuild.tsx`

### Step 4: Run validation commands
- Run `bunx tsc --noEmit --project adws/tsconfig.json` to verify type-checks pass
- Run `bun run lint` to verify no lint errors
- Run `bun run build` to verify no build errors

## Testing Strategy
### Edge Cases
- Verify `/chore` mapping is unchanged (`adws/adwPlanBuild.tsx`)
- Verify `/feature` mapping is unchanged (`adws/adwSdlc.tsx`)
- Verify `/pr_review` mapping is unchanged (`adws/adwPlanBuild.tsx`)
- Verify `/adw_init` mapping is unchanged (`adws/adwInit.tsx`)
- Verify the `getWorkflowScript()` fallback in `workflowMapping.ts` still functions correctly

## Acceptance Criteria
- `issueTypeToOrchestratorMap` maps `/bug` to `adws/adwSdlc.tsx`
- `/chore` mapping remains `adws/adwPlanBuild.tsx` (unchanged)
- `/feature` mapping remains `adws/adwSdlc.tsx` (unchanged)
- Classifier prompt only assigns `/chore` when explicitly stated or when changes are config/docs-only
- Classifier prompt instructs to prefer `/bug` or `/feature` over `/chore` when in doubt
- Type-checks pass (`bunx tsc --noEmit --project adws/tsconfig.json`)
- Lint passes (`bun run lint`)
- Build passes (`bun run build`)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit --project adws/tsconfig.json` — Type-check the ADW TypeScript project
- `bunx tsc --noEmit` — Type-check the root TypeScript project
- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors

## Notes
- The `adwCommandToIssueTypeMap` in `issueTypes.ts` does NOT need changes. It maps explicit `/adw_*` commands to issue types, and `/adw_plan_build` already maps to `/bug` which is correct — an explicit `/adw_plan_build` command should still route to `adwPlanBuild.tsx` via `adwCommandToOrchestratorMap`, not through the issue-type map.
- The `getWorkflowScript()` fallback value `'adws/adwPlanBuildTest.tsx'` in `workflowMapping.ts:33` is a safety net for unexpected issue types. It could theoretically be updated to `adwSdlc.tsx` but the map already covers all `IssueClassSlashCommand` values, so it is never reached in practice. Leave it unchanged to minimize scope.
- Follow `guidelines/coding_guidelines.md` for all changes.
