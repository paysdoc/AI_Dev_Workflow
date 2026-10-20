# Bug: Resume recovers a plan path from issue comments only for the legacy `issue-N-plan.md` name

## Metadata
issueNumber: `1080`
adwId: `a69x2i-bug-resume-recovers`
issueJson: `{"number":1080,"title":"bug: resume recovers a plan path from issue comments only for the old issue-N-plan.md name","body":"## Parent PRD\n\n`docs/prd/specs-worktree-only-and-docs-relocation.md` (was `specs/prd/specs-worktree-only-and-docs-relocation.md` before #1076), user story 26. Pre-existing bug found during the grill; independent of the rest of the PRD.\n\n## What to build\n\nThe comment-parsing regex that recovers a plan path for resume matches only `specs/issue-N-plan.md`. Every plan since the planner moved to `specs/issue-N-adw-<adwId>-sdlc_planner-<slug>.md` is never picked up, so the recovered state carries no plan path and `ctx.planPath` is set only for pre-2026 runs.\n\nMake the parser recognise the current name (and keep the old one), and record the path in the recovery state as it does today.\n\n## Acceptance criteria\n\n- [ ] Unit test: a \"Implementation Plan Created\" comment with a current-format path yields that path in the recovered state\n- [ ] Unit test: the old-format path still resolves\n- [ ] Unit suite, typecheck, BDD regression green\n\n## Blocked by\n\nNone - can start immediately.\n\n## Touched Files\n\n- adws/core/workflowCommentParsing.ts\n- adws/core/__tests__/workflowCommentParsing*.test.ts\n\n## User stories addressed\n\n- User story 26","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-20T15:36:36Z","comments":[],"actionableComment":null}`

## Bug Description
When an orchestrator starts on an issue that already carries ADW workflow comments, `initializeWorkflow()` (`adws/phases/workflowInit.ts:192`) calls `detectRecoveryState(issue.comments)` to work out where the previous run stopped, and on resume copies the recovered fields onto the workflow context (`adws/phases/workflowInit.ts:428-430`: `branchName`, `planPath`, `prUrl`).

`detectRecoveryState` gets the plan path from `extractPlanPathFromComment` (`adws/core/workflowCommentParsing.ts:159-163`). That function's regex accepts only the legacy name, `` `specs/issue-{N}-plan.md` ``. The planner commands (`/bug`, `/feature`, `/chore`, `adw_init`) write plans as `specs/issue-{N}-adw-{adwId}-sdlc_planner-{descriptiveName}.md`. `getPlanFilePath` resolves that name first, `executePlanPhase` sets it on `ctx.planPath`, and the "Implementation Plan Created" comment prints it verbatim as `` **Plan file:** `specs/issue-1080-adw-…-sdlc_planner-….md` ``.

- **Actual:** for every plan with the current name, `extractPlanPathFromComment` returns `null`. `RecoveryState.planPath` is `null` even though the same comments give back `lastCompletedStage`, `adwId` and the branch name, so `ctx.planPath` is never set on resume. Only legacy plans (pre-2026 runs, and `/pr_review` revision plans, which still use `specs/issue-{N}-plan.md`) are recovered.
- **Expected:** a plan path in either name, current or legacy, posted in an ADW stage comment is recovered into `RecoveryState.planPath`. Everything else in `detectRecoveryState` stays as it is: the newest comment that carries a path wins, and comments with no path leave it unchanged.

## Problem Statement
`extractPlanPathFromComment` must recognise the current plan file name `specs/issue-{N}-adw-{adwId}-sdlc_planner-{descriptiveName}.md` and still recognise the legacy `specs/issue-{N}-plan.md`. It must not match spec files that are not plans (PRDs, ADRs, other docs), because ADW stage comments embed free text such as the plan summary and the build summary.

## Solution Statement
Widen the single regex in `extractPlanPathFromComment` to an alternation over the two plan file name shapes, and change nothing else:

```ts
/`(specs\/issue-\d+-(?:plan|adw-[a-z0-9-]+-sdlc_planner-[a-z0-9-]+)\.md)`/
```

- `plan` is the legacy branch and matches exactly what the parser matches today.
- `adw-[a-z0-9-]+-sdlc_planner-[a-z0-9-]+` is the current branch. The adwId comes from `generateAdwId` (`adws/core/adwId.ts`), which produces lowercase kebab text only (base36 random plus a `slugify`d summary). That is the same class `extractAdwIdFromComment` already assumes. The descriptive name is kebab-case by the planner prompts' convention. Every current-format plan under `specs/` matches this class; the only `issue-*` files that don't are the 22 legacy `issue-N-plan.md` / `issue-18-pr-review-plan.md` files. The regex backtracks out of the greedy adwId class to find `-sdlc_planner-`, so adwIds that contain hyphens (e.g. `a69x2i-bug-resume-recovers`, `adw-unknown`, `1773068420299-fw4sym`) parse correctly.
- The surrounding backticks and the fixed `specs/issue-<digits>-` prefix stop the pattern matching PRDs, ADRs or other spec paths.
- `String.prototype.match` keeps its first-match semantics. In an "Implementation Plan Created" comment the `**Plan file:**` line comes before the `<details>` plan summary, so a plan named inside the summary never wins over the real one.

`detectRecoveryState`, `RecoveryState`, the formatter and `workflowInit.ts` stay as they are. The path is recorded in the recovery state exactly as it is today.

## Steps to Reproduce
1. Take the comment body ADW posts after planning this very issue. `formatWorkflowComment('plan_created', { issueNumber: 1080, adwId: 'a69x2i-bug-resume-recovers', planPath: 'specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-fix-resume-plan-path-parsing.md' })` from `adws/forge/workflowCommentsIssue.ts` produces it, and it contains `` **Plan file:** `specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-fix-resume-plan-path-parsing.md` ``.
2. Pass that body to `extractPlanPathFromComment`. It returns `null`; it should return the path.
3. Pass it as a single `IssueComment` (`{ id, author, createdAt, body }`) to `detectRecoveryState`. The result has `lastCompletedStage: 'plan_created'`, `adwId: 'a69x2i-bug-resume-recovers'` and `canResume: true`, but `planPath: null`.
4. Repeat steps 2 and 3 with `planPath: 'specs/issue-1080-plan.md'`. The legacy path is recovered, which shows that only the name shape is the problem.
5. Run the Validation Commands' reproduction one-liner. It prints `null` before the fix and prints the path after it. The RED/GREEN run of `adws/core/__tests__/workflowCommentParsing.test.ts` in the Step by Step Tasks reproduces the bug too, and so do the three `@adw-1080` scenarios in `features/per-issue/feature-1080.feature` whose plan has the current name.

## Root Cause Analysis
- The parser and the file finder disagree on what a plan is called. `findPlanFile` in `adws/agents/planAgent.ts` (the source of truth `getPlanFilePath`, `planFileExists` and `readPlanFile` all go through) tries `^issue-${N}-adw-.*-sdlc_planner-.*\.md$` first and falls back to `specs/issue-${N}-plan.md`. `extractPlanPathFromComment` hard-codes only the fallback: `` /`(specs\/issue-\d+-plan\.md)`/ ``.
- The planner prompts (`.claude/commands/bug.md`, `feature.md`, `chore.md`, `adw_init.md`) tell the agent to write `specs/issue-{issueNumber}-adw-{adwId}-sdlc_planner-{descriptiveName}.md`. `executePlanPhase` (`adws/phases/planPhase.ts:102-105`) calls `correctPlanFileNaming` (fixing a swapped issueNumber/adwId), then sets `ctx.planPath = getPlanFilePath(...)` (the current name) and posts `plan_created`. `formatPlanCreatedComment` (`adws/forge/workflowCommentsIssue.ts:91-94`) prints `ctx.planPath` inside backticks, and the regex never matches it.
- Only `/pr_review` (`.claude/commands/pr_review.md`) still writes `specs/issue-{issueNumber}-plan.md`. That is why the bug went unnoticed for legacy names, and why the legacy branch of the regex has to stay.
- The failure is silent: `detectRecoveryState` treats a `null` extraction as "this comment carries no plan path", so `RecoveryState.planPath` stays `null` with no log or error, and `workflowInit.ts:429` (`if (recoveryState.planPath) ctx.planPath = …`) is skipped.

## Relevant Files
Use these files to fix the bug:

- `adws/core/workflowCommentParsing.ts`: holds the faulty `extractPlanPathFromComment` regex (lines 159-163) and `detectRecoveryState` (lines 165-214), which records the extracted path. This is the only production file that changes.
- `adws/core/__tests__/workflowCommentParsing.test.ts`: the existing Vitest file for this module (it already covers `isRetryComment`, `isCancelComment` and `parseWorkflowStageFromComment`). The new plan-path tests go here. `.adw/conditional_docs.md` lists this exact file under the owning doc's `Owns:`, so no new test file is needed.
- `adws/forge/workflowCommentsIssue.ts`: read-only. `formatWorkflowComment` / `formatPlanCreatedComment` (and `formatPlanFileCreatedComment`) define the comment body the parser has to read. The tests build their fixtures with `formatWorkflowComment` so the parser is pinned to what ADW actually posts. Its own test file, `adws/forge/__tests__/workflowCommentsIssue.test.ts`, already couples the formatter to `parseWorkflowStageFromComment` the same way.
- `adws/agents/planAgent.ts`: read-only. `findPlanFile` / `getPlanFilePath` / `correctPlanFileNaming` are the authority on both plan file names. The new regex must accept what they produce.
- `adws/phases/planPhase.ts`: read-only. Sets `ctx.planPath` to the resolved current-format name and posts the `plan_created` comment.
- `adws/phases/workflowInit.ts`: read-only. Calls `detectRecoveryState(issue.comments)` (line 192) and sets `ctx.planPath` from `recoveryState.planPath` on resume (line 429). This is where the bug shows.
- `adws/types/workflowTypes.ts`: read-only. `RecoveryState.planPath: string | null` stays the same.
- `adws/core/adwId.ts`: read-only. `generateAdwId` / `slugify` show that an adwId is always `[a-z0-9-]`, which justifies the regex's character class.
- `.claude/commands/bug.md`, `.claude/commands/feature.md`, `.claude/commands/chore.md`, `.claude/commands/pr_review.md`: read-only. They specify the current plan file name and the legacy name (`/pr_review`) that both have to resolve.
- `app_docs/feature-9gjajh-classifier-and-routing.md`: conditional doc. `.adw/conditional_docs.md` gives it ownership of `adws/core/workflowCommentParsing.ts` and its test ("When working on … workflow comment parsing"). It describes how plan paths are parsed and recovery is detected. Read it for context; no edit is required by this fix.
- `specs/prd/specs-worktree-only-and-docs-relocation.md`: parent PRD, user story 26, which is the motivation. In this worktree it is still under `specs/prd/`, because the `docs/` move (#1076) has not landed here.
- `.adw/coding_guidelines.md`: guidelines the change must follow (comments only for non-obvious rationale, no issue-number citations, pure functions, no `any`).
- `features/per-issue/feature-1080.feature`: this issue's four BDD scenarios (`@adw-1080`), the RED tests of the TDD build. Each one posts the workflow comments ADW writes for a run, oldest first, reads the recovery state from them and checks the plan file it records:
  - an "Implementation Plan Created" comment that names a plan under the current name `specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-resume-plan-path.md` is recovered with that plan file (acceptance criterion 1);
  - one that names the legacy `specs/issue-1080-plan.md` is still recovered with it (acceptance criterion 2);
  - a run that stopped during the build resumes after `build_running` and keeps the current-format plan file, although no later comment names one;
  - a "Build Completed" comment whose build summary quotes the parent PRD `` `specs/prd/specs-worktree-only-and-docs-relocation.md` `` resumes after `build_completed` and does not replace the plan file.
  A dry run (`NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1080" --dry-run`) leaves four phrases undefined. Only the Background step is already defined.
- `features/regression/step_definitions/givenSteps.ts`: read-only. Defines the Background step `the ADW codebase is checked out` (vocabulary G18). Reuse it, and don't define it again.
- `features/per-issue/step_definitions/feature-929-stage.steps.ts`: read-only. The pattern to follow: per-issue steps that import the comment parser and `formatWorkflowComment` by relative `.ts` paths, keep a file-local world, and reset it in a `Before` hook tagged with the issue.

### New Files
- `features/per-issue/step_definitions/feature-1080.steps.ts`: the step definitions for the four undefined phrases of `features/per-issue/feature-1080.feature` (step 2).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add the failing plan-path tests (RED) to `adws/core/__tests__/workflowCommentParsing.test.ts`
- Extend the existing import from `'../workflowCommentParsing'` with `extractPlanPathFromComment` and `detectRecoveryState`.
- Add `import { formatWorkflowComment } from '../../forge/workflowCommentsIssue';`. Core tests already import from `../../forge/...`, as `applicationType.test.ts` and `forgeWiring.test.ts` do.
- Add `import type { IssueComment } from '@paysdoc/devplatform';`.
- Add file-local fixtures. Only comment where the code cannot speak for itself, and cite no issue numbers in comments:
  - `const ADW_ID = 'a69x2i-bug-resume-recovers';`
  - `const CURRENT_PLAN_PATH = 'specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-fix-resume-plan-path-parsing.md';`
  - `const LEGACY_PLAN_PATH = 'specs/issue-1080-plan.md';`
  - `const planCreatedBody = (planPath: string, planOutput?: string): string => formatWorkflowComment('plan_created', { issueNumber: 1080, adwId: ADW_ID, planPath, planOutput });`
  - `const issueComment = (body: string, createdAt: string): IssueComment => ({ id: createdAt, author: 'adw-bot', createdAt, body });`
- Add `describe('extractPlanPathFromComment', …)` with:
  - `it('ignores a spec path that is not a plan file', …)`: `extractPlanPathFromComment('See `specs/prd/specs-worktree-only-and-docs-relocation.md`')` is `null`. This pins the regex's boundary so it cannot be widened to "any `specs/*.md`".
- Add `describe('detectRecoveryState — plan path', …)` with:
  - `it('recovers a current-format plan path from an Implementation Plan Created comment', …)`: `detectRecoveryState([issueComment(planCreatedBody(CURRENT_PLAN_PATH), '2026-10-20T10:00:00Z')])` has `planPath === CURRENT_PLAN_PATH`, `lastCompletedStage === 'plan_created'` and `canResume === true`. (Acceptance criterion 1.)
  - `it('still recovers a legacy issue-N-plan.md path', …)`: the same with `LEGACY_PLAN_PATH`, giving `planPath === LEGACY_PLAN_PATH`. (Acceptance criterion 2.)
  - `it('takes the plan file line, not a plan named in the plan summary', …)`: `planCreatedBody(CURRENT_PLAN_PATH, 'Follows `specs/issue-930-adw-6k869a-feat-promote-930-sce-sdlc_planner-promote-930-plan-commit-regression.md`.')` recovers `planPath === CURRENT_PLAN_PATH`. The summary sits in `<details>` after the `**Plan file:**` line, and the plan summary is the plan's own text, which often cites other plans.
  - `it('keeps the recovered plan path when a later stage comment carries none', …)`: comments `[issueComment(planCreatedBody(CURRENT_PLAN_PATH), '2026-10-20T10:00:00Z'), issueComment(formatWorkflowComment('build_running', { issueNumber: 1080, adwId: ADW_ID }), '2026-10-20T10:05:00Z')]` give `planPath === CURRENT_PLAN_PATH` and `lastCompletedStage === 'build_running'`.
- Keep the new blocks flat (no nesting beyond `describe` → `it`) and in the existing file's style: single quotes, `expect(...).toBe(...)` / `toEqual`.

### 2. Write the step definitions for the `@adw-1080` scenarios (RED) in `features/per-issue/step_definitions/feature-1080.steps.ts`
- Define exactly the four phrases the dry run leaves undefined:
  - `Given('ADW posted its workflow comments for these stages on issue {int} under adwId {string}, oldest first:', …)` takes a `DataTable`. For each row of `dataTable.hashes()`, build the body with `formatWorkflowComment(row.stage as WorkflowStage, { issueNumber, adwId, planPath, planOutput: summary, buildOutput: summary })`. `planPath` is the `plan file` cell and `summary` the `summary` cell, each `undefined` when the cell is empty or the column is absent (only the last scenario has a `summary` column). Each formatter reads only its own field, so the summary lands in the "Build Completed" comment's build summary. Wrap each body in an `IssueComment` (`{ id, author, createdAt, body }`) whose `createdAt` grows row by row, so the comments keep the table's oldest-first order.
  - `When('ADW reads the recovery state from the comments on issue {int}', …)`: `detectRecoveryState(…)` over the comments posted on that issue.
  - `Then('the recovery state records the plan file {string}', …)`: `assert.strictEqual(recoveryState.planPath, planFile)`.
  - `Then('the recovery state resumes the run after the stage {string}', …)`: `recoveryState.lastCompletedStage` equals the stage, and `recoveryState.canResume` is `true`.
- Import `detectRecoveryState` from `../../../adws/core/workflowCommentParsing.ts`, `formatWorkflowComment` from `../../../adws/forge/workflowCommentsIssue.ts`, the `WorkflowStage` and `RecoveryState` types from `../../../adws/types/workflowTypes.ts`, and the `IssueComment` type from `@paysdoc/devplatform`, as `feature-929-stage.steps.ts` does.
- Keep the posted comments and the recovery state in a file-local world, and reset it in `Before({ tags: '@adw-1080' }, …)`.
- Reuse the Background step `the ADW codebase is checked out` from `givenSteps.ts`. Never define a step twice. The steps drive only the public formatter and parser, and read no source file.

### 3. Confirm the tests fail before the fix
- Run `bunx vitest run adws/core/__tests__/workflowCommentParsing.test.ts`.
- Expected RED: the three current-format `detectRecoveryState` tests (current-format recovery, plan-file-line precedence, later-stage persistence) fail with `planPath` `null`. The legacy-path test and the non-plan negative test already pass, as do all existing tests in the file.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1080"`.
- Expected RED: no step is undefined. The three scenarios whose plan has the current name fail at `the recovery state records the plan file …` with `planPath` `null`. The legacy-name scenario passes, and so do both `the recovery state resumes the run after the stage …` steps.

### 4. Fix `extractPlanPathFromComment` in `adws/core/workflowCommentParsing.ts`
- Replace the regex `` /`(specs\/issue-\d+-plan\.md)`/ `` with `` /`(specs\/issue-\d+-(?:plan|adw-[a-z0-9-]+-sdlc_planner-[a-z0-9-]+)\.md)`/ ``. Keep it as an inline literal, like the sibling extractors (`extractBranchNameFromComment`, `extractPrUrlFromComment`).
- Replace the stale JSDoc `` /** Pattern: `specs/issue-{number}-plan.md` */ `` with one that names both shapes and says why the legacy one stays, for example:
  `` /** Matches `specs/issue-{N}-adw-{adwId}-sdlc_planner-{name}.md` and the legacy `specs/issue-{N}-plan.md`, which /pr_review still writes. */ ``
- Leave the function body (`match ? match[1] : null`) and the signature unchanged. Don't touch `detectRecoveryState`, `RecoveryState`, the formatter or `workflowInit.ts`.

### 5. Confirm the tests pass after the fix
- Re-run `bunx vitest run adws/core/__tests__/workflowCommentParsing.test.ts`. All tests, new and existing, pass (GREEN).
- Re-run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1080"`. All four scenarios pass, and none is undefined (GREEN).

### 6. Run the Validation Commands
- Run every command in `Validation Commands` below and confirm each one exits 0 with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx tsx -e 'import("./adws/core/workflowCommentParsing.ts").then((m) => console.log(m.extractPlanPathFromComment("**Plan file:** `specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-fix-resume-plan-path-parsing.md`")))'`: reproduction. It prints `null` before the fix and `specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-fix-resume-plan-path-parsing.md` after it.
- `bunx vitest run adws/core/__tests__/workflowCommentParsing.test.ts`: the targeted test file. It is RED before step 4 (the current-format plan-path tests) and GREEN after it.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1080"`: this issue's four BDD scenarios in `features/per-issue/feature-1080.feature`. Before step 4 the three current-name scenarios are RED. After it all four pass, and none is undefined.
- `bun run lint`: linter.
- `bunx tsc --noEmit`: type check.
- `bunx tsc --noEmit -p adws/tsconfig.json`: additional type check over `adws/`.
- `bun run build`: build.
- `bun run test:unit`: the full Vitest unit suite, zero regressions.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the BDD regression suite stays green. The plan-phase surfaces `features/regression/surfaces/row-02-adwPlan-planPhase-happy.feature` and `row-13-adwChore-workflowInit-planPhase-happy.feature` post the "Implementation Plan Created" comment, and many regression steps call `detectRecoveryState([])`.

## Notes
- Strictly follow `.adw/coding_guidelines.md`. In particular, comments carry only rationale the code cannot express, never cite issue numbers, and add no section banners. The fix stays a pure function with no new dependencies.
- No new library is needed.
- Scope: the fix touches exactly the issue's Touched Files, `adws/core/workflowCommentParsing.ts` and `adws/core/__tests__/workflowCommentParsing*.test.ts`. The only other file is `features/per-issue/step_definitions/feature-1080.steps.ts`, the step definitions the `@adw-1080` scenarios need. Like `features/per-issue/feature-1080.feature`, it is per-issue BDD scaffolding that the per-issue scenario sweep removes 14 days after the PR merges. `README.md` already shows as modified in this worktree (device-janitor tree entries). That change is unrelated, so keep it out of this change.
- Why widen the name shape rather than anchor on the `**Plan file:**` label: the issue asks to "record the path in the recovery state as it does today". Today any backticked plan path in a non-error/paused/resumed ADW stage comment updates `planPath`, and the newest one wins. Widening only the name shape keeps those semantics, and so keeps the legacy shape resolving from every comment it resolved from before. One consequence to be aware of: a "Build Completed" comment's `<details>` build summary (free agent text) that names a plan in backticks also updates `planPath`. That was already true for legacy names, and in practice the build agent names the plan it implemented, which is the same path.
- Practical reach: `executePlanPhase` re-resolves `ctx.planPath` from the filesystem (`getPlanFilePath`) whenever it runs. The recovered value mainly matters for orchestrators and resume points that skip the plan phase, and for keeping `RecoveryState` truthful. That doesn't reduce the need for the fix (user story 26: recovery must not be silently limited to the pre-2026 name).
- Swapped names (`issue-{adwId}-adw-{N}-…`) never reach a comment: `correctPlanFileNaming` renames them before `ctx.planPath` is resolved and `plan_created` is posted. The regex does not need to accept them.
- `/document` may want to add a Gotchas line to `app_docs/feature-9gjajh-classifier-and-routing.md` saying that `extractPlanPathFromComment` recognises both plan file names. That is optional and outside this fix.
- Adjacent but out of scope: `extractBranchNameFromComment` only accepts the `feat|bug|chore|review|test` prefixes (already listed as a Gotcha in the module doc), so a branch such as `bugfix-issue-1080-…` is not recovered either. Don't change it here.
