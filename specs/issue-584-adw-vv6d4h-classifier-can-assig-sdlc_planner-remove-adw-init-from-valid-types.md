# Bug: Classifier can assign the removed `/adw_init` bootstrap type, blocking issues with an ENOENT plan-file error

## Metadata
issueNumber: `584`
adwId: `vv6d4h-classifier-can-assig`
issueJson: `{"number":584,"title":"Classifier can assign a removed bootstrap type, blocking issues with an ENOENT plan-file error","body":"The trigger classifier can assign an issue the operator-only bootstrap type /adw_init. That type lost its dedicated orchestrator in #547, so it silently falls back to adwPlanBuildTest.tsx, which then runs /adw_init as a plan agent. /adw_init writes no plan file, so the build phase dies with ENOENT on the plan file and the issue is moved to Blocked. Observed on issue #576. Root cause: /adw_init is still listed in VALID_ISSUE_TYPES (adws/types/issueTypes.ts), the exact-match domain the AI classifier builds its regex from, and the --type CLI-validation domain in orchestratorCli.ts. Proposed fix: drop /adw_init from VALID_ISSUE_TYPES while keeping it in the IssueClassSlashCommand union.","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-06-15T12:16:49Z","comments":[],"actionableComment":null}`

## Bug Description
The trigger classifier can assign an issue the operator-only bootstrap type `/adw_init`. Because #547 removed its dedicated orchestrator, `getWorkflowScript('/adw_init')` falls back to `adws/adwPlanBuildTest.tsx`, which then runs `/adw_init` as a **plan agent**. `/adw_init` is a target-repo bootstrap command — it regenerates `.adw/` config and **writes no plan file**. The build phase then cannot find a plan file in the worktree, falls back to the legacy `specs/issue-{N}-plan.md`, and `fs.readFileSync` throws `ENOENT`, after which the issue is moved to **Blocked**.

**Expected behavior:** The auto-classifier (and the `--issue-type` CLI override) should only ever assign real, auto-runnable workflow types — `/chore`, `/bug`, `/feature`, `/pr_review`. It must never assign `/adw_init`.

**Actual behavior:** The classifier can emit `/adw_init`, which dead-ends in an `ENOENT` on the plan file and blocks the issue.

**Symptoms observed on issue #576 ("durable unit-test gate for `adw.yml`"):**
- `adwinit-` branch prefix and `adwinit:` commit prefix on the run (confirms classification as `/adw_init`).
- Workflow failure:
  ```
  plan-build-test-orchestrator workflow failed: Error: Cannot read plan file at
  .worktrees/adwinit-issue-576-adw-yml-unit-test-gate/specs/issue-576-plan.md:
  ENOENT: no such file or directory
  ```
- Issue moved to **Blocked** on the project board.

## Problem Statement
`/adw_init` appears in `VALID_ISSUE_TYPES` (`adws/types/issueTypes.ts`). That array is simultaneously:
1. the exact-match domain the AI classifier builds its capture regex from (`adws/core/issueClassifier.ts` line 67), and
2. the validation domain for the `--issue-type` CLI option (`adws/core/orchestratorCli.ts` line 57).

Because `/adw_init` has **no** orchestrator mapping (`issueTypeToOrchestratorMap` was relaxed to `Partial<Record<...>>` in #547), any path that yields `/adw_init` routes to the generic `adwPlanBuildTest.tsx` fallback, runs `/adw_init` as a plan agent, and dies with `ENOENT` in the build phase. We must make `/adw_init` **un-assignable** by the classifier and CLI, while keeping it a valid type-union member so the prefix/alias/model/comment maps and the manual init/upgrade flow keep compiling.

## Solution Statement
Remove the single `/adw_init` element from the `VALID_ISSUE_TYPES` array in `adws/types/issueTypes.ts`, **keeping** `/adw_init` in the `IssueClassSlashCommand` union (line 5) and the `SlashCommand` union (line 53).

This one change:
- Drops `/adw_init` from the classifier's regex domain (`issueClassifier.ts` line 67), so the classifier can never capture it. It degrades to the last real type in the AI output, or defaults to `/feature` when none is present — it can never route to `/adw_init` again.
- Drops `/adw_init` from the `--issue-type` CLI validation domain (`orchestratorCli.ts` line 57) and from the printed usage text, so `--issue-type /adw_init` is rejected.

Add a focused regression test that (1) asserts `VALID_ISSUE_TYPES` excludes `/adw_init` and equals exactly the four real types, and (2) drives the **real** `classifyGitHubIssue` with a mocked classification agent returning `/adw_init` to prove it degrades to `/feature` and never returns `/adw_init`. Keep `workflowMapping.test.ts` exactly as-is (the type union still includes `/adw_init`, so that fallback test still compiles and passes).

## Steps to Reproduce
1. Have an issue whose content makes the AI classifier emit `/adw_init` (e.g. an `adw.yml`-themed issue like #576).
2. The cron/webhook trigger calls `classifyIssueForTrigger` / `classifyGitHubIssue`; the regex built from `VALID_ISSUE_TYPES` (which still contains `/adw_init`) captures `/adw_init` from the model output.
3. `getWorkflowScript('/adw_init')` returns `adws/adwPlanBuildTest.tsx` (no orchestrator mapping → fallback).
4. The plan phase runs `/adw_init` as the plan agent; no `specs/issue-{N}-adw-{adwId}-sdlc_planner-*.md` plan file is written (it generates `.adw/` config instead).
5. The build phase resolves the plan path via `getPlanFilePath`, finds nothing in the worktree, falls back to `specs/issue-{N}-plan.md`, and `fs.readFileSync` throws `ENOENT: no such file or directory` (`adws/phases/buildPhase.ts` line 49–56).
6. The issue is moved to **Blocked**.

**Deterministic unit reproduction (used by the regression test):** mock the classification agent (`runClaudeAgentWithCommand`) to return `{ success: true, output: '/adw_init' }`; before the fix, `classifyGitHubIssue(...)` returns `issueType: '/adw_init'`; after the fix it returns `issueType: '/feature'`.

## Root Cause Analysis
The classifier and CLI both derive their assignable domain from `VALID_ISSUE_TYPES`. Issue #547 removed the `/adw_init` orchestrator (deleting `adwInit.tsx` and relaxing `issueTypeToOrchestratorMap` from `Record` to `Partial<Record<...>>`) but **left `/adw_init` in `VALID_ISSUE_TYPES`**. That left a latent trap: `/adw_init` stayed classifiable/assignable yet had no orchestrator, so it silently fell back to `adwPlanBuildTest.tsx`, which runs `/adw_init` as a plan agent that writes no plan file → `ENOENT` in the build phase → issue Blocked.

The `adw:*` label-override path **cannot** produce `/adw_init` (`issueTypeToAdwLabel('/adw_init')` returns `null` — there is no `adw:adw_init` label), so the AI classifier and the `--issue-type` CLI override are the only producers. Closing those two paths by removing `/adw_init` from `VALID_ISSUE_TYPES` eliminates the trap at its source.

## Relevant Files
Use these files to fix the bug:

- `adws/types/issueTypes.ts` — **THE FIX.** Remove `/adw_init` from the `VALID_ISSUE_TYPES` array (line 7). Keep `/adw_init` in the `IssueClassSlashCommand` union (line 5) and the `SlashCommand` union (line 53) — both unions must remain intact so the prefix/alias/model/comment maps and the manual init/upgrade flow keep compiling.
- `adws/core/issueClassifier.ts` — builds the capture regex from `VALID_ISSUE_TYPES` (lines 67–70). After the fix, `/adw_init` is out of the regex domain; `classifyWithIssueCommand` degrades to the last real type or defaults to `/feature`. No code change here; behavior is locked in by the new test.
- `adws/core/orchestratorCli.ts` — validates `--issue-type` against `VALID_ISSUE_TYPES` (line 57) and prints it in usage text (lines 108, 121). After the fix, `--issue-type /adw_init` is rejected. No code change.
- `adws/types/issueRouting.ts` — `commitPrefixMap`, `branchPrefixMap`, and `branchPrefixAliases` are full `Record<IssueClassSlashCommand, ...>` maps that still require a `/adw_init` entry; because the union is unchanged, they stay valid. Confirms why the union must be kept. No change.
- `adws/core/workflowMapping.ts` (+ `issueTypeToOrchestratorMap` in `issueRouting.ts`) — `/adw_init` has no entry in the `Partial` map → `getWorkflowScript('/adw_init')` falls back to `adws/adwPlanBuildTest.tsx`. This is the downstream trap the fix defuses upstream. No change.
- `adws/github/labelManager.ts` — `issueTypeToAdwLabel('/adw_init')` returns `null`; confirms the label-override path cannot produce `/adw_init`, so the classifier/CLI are the only producers. No change.
- `adws/phases/buildPhase.ts` (lines 49–56) and `adws/agents/planAgent.ts` `getPlanFilePath` (lines 85–92) — the `ENOENT` crash site and the legacy `specs/issue-{N}-plan.md` fallback. Documents the failure tail. No change.
- `adws/core/__tests__/workflowMapping.test.ts` — keep exactly as-is; it documents the intentional `/adw_init` → fallback mapping and still compiles because the type union is unchanged.
- `app_docs/feature-cy2xzc-delete-adwinit-tsx-orchestrator.md` — conditional doc (matched via `.adw/conditional_docs.md`): context for #547 removing the `/adw_init` orchestrator and why a `/adw_init` lookup now returns `undefined`/falls back. Read for root-cause context.
- `app_docs/feature-u8okxe-bug-sdlc-chore-classifier.md` — conditional doc (matched via `.adw/conditional_docs.md`): context for issue classification logic and the `/classify_issue` command / orchestrator routing. Read for classifier-behavior context.

### New Files
- `adws/core/__tests__/issueClassifier.test.ts` — regression test covering: (1) `VALID_ISSUE_TYPES` excludes `/adw_init` and equals `['/chore','/bug','/feature','/pr_review']`; (2) with `runClaudeAgentWithCommand` mocked to return `/adw_init`, `classifyGitHubIssue` degrades to `/feature` (never `/adw_init`); (3) with output `'... /bug ... /adw_init'`, it captures `/bug` (the last real type, ignoring `/adw_init`).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Remove `/adw_init` from the classifier/CLI domain
- In `adws/types/issueTypes.ts`, change line 7 from:
  ```ts
  export const VALID_ISSUE_TYPES: readonly IssueClassSlashCommand[] = ['/chore', '/bug', '/feature', '/pr_review', '/adw_init'] as const;
  ```
  to:
  ```ts
  // /adw_init is intentionally excluded: it is an operator-only bootstrap command with no
  // orchestrator since #547. Keeping it here would let the AI classifier / --issue-type CLI
  // assign it, which dead-ends in an ENOENT plan-file error (issue #584). It remains in the
  // IssueClassSlashCommand/SlashCommand unions for the prefix/alias maps and manual init flow.
  export const VALID_ISSUE_TYPES: readonly IssueClassSlashCommand[] = ['/chore', '/bug', '/feature', '/pr_review'] as const;
  ```
- Do **NOT** modify the `IssueClassSlashCommand` union (line 5) or the `SlashCommand` union (line 53). `/adw_init` must stay a type member so `commitPrefixMap`/`branchPrefixMap`/`branchPrefixAliases` (`Record<IssueClassSlashCommand, ...>`), the `modelRouting.ts` maps (`Record<SlashCommand, ...>`), `workflowCommentsIssue.ts`, and the manual init/upgrade flow keep compiling.

### 2. Add the classifier regression test
- Create `adws/core/__tests__/issueClassifier.test.ts`.
- Mock `'../../agents/claudeAgent'` so `runClaudeAgentWithCommand` is a `vi.fn()` you control (mirror the hoisted-mock pattern in `adws/agents/__tests__/refactorAgent.test.ts`). **Do NOT** mock `'../../core'` or `'../../types/issueTypes'` — the test must exercise the **real** `VALID_ISSUE_TYPES` and the real regex-building code in `issueClassifier.ts`.
- Add a small `makeIssue(overrides?)` helper returning a valid `GitHubIssue` (e.g. `number: 576`, a title/body, `author: { login: 'paysdoc', isBot: false }`, empty `assignees`/`labels`/`comments`, ISO `createdAt`/`updatedAt`, and a `url`). `classifyGitHubIssue` does not call `fetchGitHubIssue`, so no GitHub/network mocking is required.
- **Test A (domain invariant):** `expect([...VALID_ISSUE_TYPES]).toEqual(['/chore', '/bug', '/feature', '/pr_review'])` and `expect(VALID_ISSUE_TYPES).not.toContain('/adw_init')`.
- **Test B (cannot route to `/adw_init`):** mock the agent to resolve `{ success: true, output: '/adw_init' }`; `const result = await classifyGitHubIssue(makeIssue())`; assert `result.issueType` is `'/feature'` and `expect(result.issueType).not.toBe('/adw_init')`.
- **Test C (degrades to last real type):** mock the agent to resolve `{ success: true, output: 'this looks like /bug, not /adw_init' }`; assert `result.issueType` is `'/bug'`.
- Reset the mock between tests (`beforeEach(() => mock.mockReset())`).

### 3. Validate
- Run every command in **Validation Commands** below. All must pass with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx tsc --noEmit` — base type check passes (proves removing `/adw_init` from the array breaks nothing; the union is still complete for the `Record<IssueClassSlashCommand, ...>` maps).
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws project type check passes.
- `bun run lint` — eslint clean.
- `bun run build` — `tsc` build succeeds.
- `bun run test:unit` — full vitest suite passes, including the new `adws/core/__tests__/issueClassifier.test.ts` and the unchanged `adws/core/__tests__/workflowMapping.test.ts`.
- `bunx vitest run adws/core/__tests__/issueClassifier.test.ts` — the new regression test passes. (To confirm it actually guards the bug: temporarily re-add `/adw_init` to `VALID_ISSUE_TYPES` → Test A and Test B go RED; restore the fix → GREEN.)

**Before/after reproduction:** With `/adw_init` present in `VALID_ISSUE_TYPES`, `classifyGitHubIssue` returns `/adw_init` for an agent output of `/adw_init` (the bug). With it removed, the same input returns `/feature`. Test B encodes exactly this before/after difference.

## Notes
- Adhere to `.adw/coding_guidelines.md`. Note that line 15 states ADW itself does not rely on unit tests as quality gates — but `.adw/project.md` declares `## Unit Tests: enabled` and the repo already ships vitest suites (`bun run test:unit`, e.g. `workflowMapping.test.ts`). The bug explicitly requests a unit regression test, so adding one is consistent with both the project config and the existing suite.
- No new libraries are required. (If one were ever needed, the install command per `.adw/commands.md` is `bun add <package>`.)
- **Surgical scope:** exactly one production line changes (the `VALID_ISSUE_TYPES` array literal, plus an explanatory comment) and one new test file is added. The `IssueClassSlashCommand`/`SlashCommand` unions, all prefix/alias/model/comment maps, `issueTypeToOrchestratorMap`, and `workflowMapping.test.ts` are intentionally untouched.
- Conditional docs consulted per `.adw/conditional_docs.md`: `app_docs/feature-cy2xzc-delete-adwinit-tsx-orchestrator.md` (#547 orchestrator removal — root-cause context) and `app_docs/feature-u8okxe-bug-sdlc-chore-classifier.md` (issue classification / `/classify_issue` routing).
- **Operational cleanup (NOT part of this code change — perform after the fix merges):** reset the stranded worktree `.worktrees/adwinit-issue-576-adw-yml-unit-test-gate`; remove the misplaced untracked plan written to the main repo root, `specs/issue-576-adw-adw-unknown-sdlc_planner-durable-unit-test-gate-adw-yml.md`; and run `## Cancel` on issue #576 so it re-enters the queue and reclassifies to a real type.
