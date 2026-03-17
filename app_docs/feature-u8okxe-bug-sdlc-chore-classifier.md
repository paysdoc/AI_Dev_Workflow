# Bug SDLC Routing and Chore Classifier Tightening

**ADW ID:** u8okxe-bug-issues-should-us
**Date:** 2026-03-17
**Specification:** specs/issue-211-adw-u8okxe-bug-issues-should-us-sdlc_planner-bug-sdlc-chore-classifier.md

## Overview

Bug issues now route through the full SDLC pipeline (`adwSdlc.tsx`) instead of the abbreviated `adwPlanBuildTest.tsx`, ensuring that regression scenario proof is generated and posted to the PR for all bug fixes. The `/chore` classifier was also tightened so that issues touching application logic are not silently downgraded to chores that skip testing, review, and documentation.

## What Was Built

- **Bug routing change**: `issueTypeToOrchestratorMap` updated so `/bug` maps to `adws/adwSdlc.tsx` (was `adws/adwPlanBuildTest.tsx`)
- **Classifier guardrail**: `/classify_issue` prompt updated to restrict `/chore` to explicit requests or strictly config/docs/CI-only changes; ambiguous issues must default to `/bug` or `/feature`
- **Documentation update**: `adws/README.md` corrected to reflect the new bug orchestrator (`adwSdlc.tsx` in both workflow selection and usage example)
- **Test phase refactor**: `testPhase.ts` migrated from `runBddScenariosWithRetry` to the leaner `runScenariosByTag` API
- **BDD regression suite**: New feature file `features/bug_sdlc_chore_classifier.feature` with 7 scenarios covering the map entries, classifier prompt content, and TypeScript type-check; supporting step definitions added in `features/step_definitions/`

## Technical Implementation

### Files Modified

- `adws/types/issueTypes.ts`: Changed `/bug` entry in `issueTypeToOrchestratorMap` from `adws/adwPlanBuildTest.tsx` to `adws/adwSdlc.tsx`
- `.claude/commands/classify_issue.md`: Replaced the permissive `/chore` rule with an explicit guardrail requiring `/chore` only for config/docs/CI-only or explicitly labelled issues; added tie-breaking rule to prefer `/bug` or `/feature` when in doubt
- `adws/README.md`: Updated workflow selection table and "Process a bug report" example to reference `adwSdlc.tsx`
- `adws/phases/testPhase.ts`: Replaced `runBddScenariosWithRetry` call with `runScenariosByTag`; updated result shape check from `bddResult.passed` to `bddResult.allPassed`

### Files Added

- `features/bug_sdlc_chore_classifier.feature`: BDD regression scenarios tagged `@adw-u8okxe-bug-issues-should-us`
- `features/step_definitions/bugSdlcChoreClassifierSteps.ts`: Step definitions for the new feature file
- `features/step_definitions/removeRunBddScenariosSteps.ts`: Step definitions supporting removal of the old `runBddScenariosWithRetry` API
- `features/step_definitions/removeUnitTestsSteps.ts`: Additional step definitions for unit-test removal scenarios

### Key Changes

- The single-line change to `issueTypeToOrchestratorMap` gives bug fixes the same full pipeline (plan → build → test → review → document) that features already receive, so PRs include regression scenario proof.
- The classifier prompt change moves `/chore` from a first-class option to a last-resort option, reducing the risk of real bugs being silently skipped through the quality gates.
- `testPhase.ts` now calls the unified `runScenariosByTag` helper, simplifying the call site and aligning it with the API used by the review phase.
- All seven BDD scenarios in the new feature file act as a regression guard: if the map or classifier prompt ever regresses, the scenario suite will catch it.

## How to Use

1. **Bug issues are now automatically routed to the full pipeline** — no operator action required. When ADW picks up a `/bug` issue, it will run plan, build, test, review, and document phases.
2. **Classifying an ambiguous issue**: Run `/classify_issue` as usual. If the issue is even partly about application logic, the LLM will now return `/bug` or `/feature` rather than `/chore`.
3. **Forcing chore routing**: If you genuinely want chore routing (plan + build only, no tests or review), add the text `/chore` explicitly in the issue body or label.

## Configuration

No configuration changes are required. The routing is driven by `issueTypeToOrchestratorMap` in `adws/types/issueTypes.ts`. The classifier prompt lives in `.claude/commands/classify_issue.md`.

## Testing

Run the BDD regression suite to verify the mapping and classifier prompt:

```bash
bunx cucumber-js --tags "@adw-u8okxe-bug-issues-should-us"
```

Type-check the ADW project:

```bash
bunx tsc --noEmit --project adws/tsconfig.json
```

## Notes

- `/chore` remains mapped to `adws/adwPlanBuild.tsx` (plan + build only) — this is intentional for genuine chores.
- `/feature` remains mapped to `adws/adwSdlc.tsx` — unchanged.
- The fallback value in `workflowMapping.ts` (`adwPlanBuildTest.tsx`) was intentionally left unchanged; it is never reached in practice because `issueTypeToOrchestratorMap` covers all `IssueClassSlashCommand` values.
- The `adwCommandToIssueTypeMap` (explicit `/adw_*` commands) was not modified; `/adw_plan_build` still maps to `/bug` for direct command invocations.
