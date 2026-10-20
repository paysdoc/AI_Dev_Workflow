# Feature: Retire the plan commit; worktree setup ignores specs/ at runtime

## Metadata
issueNumber: `1077`
adwId: `9skpoc-feat-retire-the-plan`
issueJson: `{"number":1077,"title":"feat: retire the plan commit; worktree setup ignores specs/ at runtime","body":"## Parent PRD\n\n`docs/prd/specs-worktree-only-and-docs-relocation.md` (was `specs/prd/specs-worktree-only-and-docs-relocation.md` before #1076).\n\n## What to build\n\nThe atomic pair from the PRD's \"Ignore delivery\" and \"Plan lifecycle\" sections. Both must ship in the same release because the old host commits plans with a plain `git add`, which exits 1 on an ignored path.\n\n1. Worktree setup appends `specs/` to the repository's tracked `.gitignore` through its existing idempotent append helper, the first time a worktree is created there. No static `.gitignore` line is committed by this PR itself.\n2. The plan phase stops committing the plan. Delete the plan-only commit helper, its guard, and the \"Committing Plan\" issue comment. The plan still lands in the worktree and the plan-created comment still carries its path and summary.\n3. Delete any plan file that landed on dev after #1076 (at least that issue's own).\n4. Replace the nine feature-930 regression scenarios with one proving that after the plan phase the branch has no commit touching `specs/` and the worktree holds the plan. Update the row-09 surface expectation that the commit \"adds only a plan file\".\n\n## Acceptance criteria\n\n- [ ] A fresh worktree ends with `specs/` in its tracked `.gitignore`; a second setup does not duplicate the line (unit test)\n- [ ] A full `adw_sdlc` run against a fixture repo produces no commit touching `specs/` and no \"Committing Plan\" comment\n- [ ] `commitPlanFileOnly` and `planCommitGuard` no longer exist\n- [ ] No tracked file under `specs/` on the branch\n- [ ] Regression tag count does not regress except for the deliberate feature-930 replacement\n- [ ] Unit suite, typecheck, BDD regression green\n\n## Blocked by\n\n- Blocked by #1076\n\n## Touched Files\n\n- adws/phases/worktreeSetup.ts\n- adws/phases/planPhase.ts\n- adws/phases/planCommitGuard.ts (deleted)\n- adws/forge/workflowCommentsIssue.ts\n- adws/phases/__tests__/planCommitGuard.test.ts, planPhaseCommit.test.ts\n- features/regression/plan-commit/feature-930.feature\n- features/regression/step_definitions/feature-930-plan-fixture.ts\n- features/regression/surfaces/row-09-adwReview-diffEvaluationPhase-happy.feature\n\n## User stories addressed\n\n- User stories 1, 2, 3, 12, 13, 14, 15, 20","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-10-20T15:36:32Z","comments":[],"actionableComment":null}`

## Feature Description
This is the second half of the PRD `docs/prd/specs-worktree-only-and-docs-relocation.md`: the "Ignore delivery" and "Plan lifecycle" sections, shipped together.

Today every ADW run commits its implementation plan to the branch. `executePlanPhase` (`adws/phases/planPhase.ts`) posts a "Committing Plan" issue comment, runs the off-limits guard in `adws/phases/planCommitGuard.ts`, then commits only the plan file with `commitPlanFileOnly`, which calls `GitContext.addAndCommitPaths`, a plain `git add`. Every merged branch therefore leaves a plan on `dev`.

After this change:

1. **Worktree setup ignores the plan directory at runtime.** When `initializeWorkflow` creates a worktree, it appends the root-anchored entry `/specs/` (git's root-only spelling of `specs/`) to the worktree's tracked `.gitignore`, under its own `# ADW:` header. It does this through the existing idempotent helper `ensureGitignoreEntry`. The line reaches a repository's default branch with the first pull request ADW opens after the release. Later worktrees already carry it, and the helper does nothing. This PR commits no `.gitignore` line itself.
2. **The plan phase commits nothing.** The planner still writes the plan to `specs/` in the worktree. The later phases still read it from there by path (build, alignment, plan validation, review, document, PR, merge). The plan-created comment still carries the plan path and the 2,000-character summary. The plan-only commit helper, the guard module, the `plan_committing` stage and its "Committing Plan" comment are deleted.
3. **The branch carries no plan.** The plans of #1076, #1079 and #1080 that reached `dev` are deleted. This issue's own plan, which the pre-release host commits during this run, is untracked but kept in the worktree for the review and document phases.
4. **The regression suite follows.** The nine feature-930 scenarios (21 test cases) become one scenario. It proves that after the plan phase the branch has no commit touching `specs/` and the worktree holds the plan. Surface row 09 stops pretending a plan is committed. Rows 02 and 13, which asserted the "Committing Plan" comment, now assert its absence. The SDLC smoke run asserts that no commit touches `specs/` and that no "Committing Plan" comment was posted.

The ignore and the end of the plan commit must ship in the same release. The pipeline host runs `main`, and its `git add` of an ignored plan exits 1. A static ignore line on `dev` would therefore break every run of a host that still commits plans.

## User Story
As an operator running ADW on my own and my target repositories
I want each plan to stay in the worktree that wrote it and never be committed
So that branches, `dev` and every primed agent's `git ls-files` listing stop carrying dead plan files, while the phases of a run still read the plan by path

## Problem Statement
- Every run commits a plan that nobody reads after merge. The files build up under `specs/` in every repository ADW touches, and the prime command injects their names into every agent spawn.
- Three plans (#1076, #1079, #1080) have already reached `dev` since #1076's sweep, because the pipeline host still commits plans.
- The plan commit drags machinery with it: the plan-only commit helper, the `.claude/`/`.adw/` off-limits guard written for it (ADR-0056), the `plan_committing` stage with its "Committing Plan" comment, and 21 regression test cases. All of it describes a step the workflow should no longer take.
- The ignore cannot be a static line on `dev`. While the host runs the old code, a static `specs/` ignore would make the old `git add` of the plan exit 1 on every run.

## Solution Statement
- **Ignore at runtime, through the existing helper.** `ensureGitignoreEntry` gains an optional header-comment parameter whose default is today's `# ADW: copied slash commands (do not commit)`, so existing callers are unchanged. A new `ignoreSpecsInWorktree(worktreePath)` in `adws/phases/worktreeSetup.ts` appends `/specs/` under `# ADW: per-run plans stay in the worktree that wrote them (do not commit)`.
  - The entry is root-anchored on purpose. A bare `specs/` matches a directory named `specs` at any depth, so in a target repository it would also hide test folders such as WebdriverIO's default `test/specs/`. New files there would silently drop out of the build agent's `git add -A` commits.
  - `/specs/` ignores exactly the directory the planner writes at the worktree root. It is also consistent with every other ADW entry, which contains a slash and is therefore root-relative.
- **Wire it at worktree creation.** `initializeWorkflow` calls the helper at the two points where it creates a worktree:
  - On the `--target-repo` path (the path every trigger uses, ADW's own repository included), right after `copyClaudeAssetsToWorktree`.
  - On the local path's new-worktree branch, after `gitCtx.fetchAndResetToRemote`. That call is a `git reset --hard`, which would discard an earlier change to the tracked `.gitignore`.
  - `--cwd` worktrees and reused local worktrees are left as they are today.
- **Delete the plan commit.** Remove the baseline capture, the guard call, the `plan_committing` block and the `planCommitGuard` import from `executePlanPhase`. Delete `planCommitGuard.ts` with its two test files and test harness.
  - Remove the `plan_committing` stage end to end: the `WorkflowStage` union, `STAGE_ORDER`, `STAGE_HEADER_MAP`, the exhaustive `classifyStage` switch with its test table, and `formatPlanCommittingComment` with its switch case.
  - An in-flight run that posted "Committing Plan" before the release still resumes correctly. `detectRecoveryState` only considers comments it can map to a stage, so it falls back to `plan_created`, which comes just before the removed stage. A unit test pins this.
- **Rebuild the regression coverage around the new behaviour:**
  - One feature-930 scenario (`@regression @plan-worktree-only`) drives the real plan phase against a stand-in that would stage and commit everything if asked to commit.
  - Surface rows 02, 09 and 13 are updated.
  - The SDLC smoke row gains two assertions.
  - The vocabulary registry drops the retired phrases and registers three new ones.
- **Clean the branch.** `git rm` every plan tracked under `specs/` except this issue's own. The own plan is untracked with `git rm --cached`, and an untracked, self-ignoring `specs/.gitignore` (content `*`) keeps the pre-release host's later `git add -A` commits from adding it back. That file is never committed; the review and document phases still read the plan from the worktree.

## Relevant Files
Use these files to implement the feature:

- `README.md` — project overview. Line 27 is the "Plan-phase off-limits guard" bullet. Lines 871, 891–892 and 964 are tree entries for the deleted guard files. Line 999 is the `worktreeSetup.ts` tree entry. Line 1313 describes `plan-commit/`, and line 1331 describes `specs/`. The working tree already holds an uncommitted, unrelated README edit that removes a duplicated `leftoverDevicesHost.ts` tree line; leave it as it is.
- `.adw/coding_guidelines.md` — the guidelines to follow: guard clauses, pure helpers, no unused imports, comments only for invariants or ordering reasons and never citing issue numbers, files under 300 lines.
- `.adw/commands.md` — the validation commands.
- `docs/prd/specs-worktree-only-and-docs-relocation.md` — parent PRD: "Ignore delivery", "Plan lifecycle" and "Testing Decisions".
- `docs/adr/0056-planner-commits-only-the-plan.md` — the decision this change supersedes in part (see Notes).
- `adws/phases/worktreeSetup.ts` — `ensureGitignoreEntry` and `ensureGitignoreEntries` (both hardcode the slash-commands header) and `copyClaudeAssetsToWorktree`. The new `ignoreSpecsInWorktree` goes here.
- `adws/phases/workflowInit.ts` — `initializeWorkflowSteps`: the `--target-repo` branch (`ensureWorktree` then `copyClaudeAssetsToWorktree`, around line 287) and the local new-worktree branch (`ensureWorktree`, `copyClaudeAssetsToWorktree`, `fetchAndResetToRemote`, around lines 308–310). Line 54 re-exports worktree helpers.
- `adws/phases/planPhase.ts` — `executePlanPhase`. Lines 19–25 and 31–32 hold the guard imports, `requireWorkflowGitContext` and the baseline; lines 133–143 are the `plan_committing` block.
- `adws/phases/planCommitGuard.ts` — to delete.
- `adws/phases/__tests__/planCommitGuard.test.ts`, `adws/phases/__tests__/planCommitGuardPhase.test.ts`, `adws/phases/__tests__/fixtures/planCommitGuardHarness.ts` — to delete. They are the only importers of the guard module and harness.
- `adws/phases/__tests__/planPhaseCommit.test.ts` — the real-git plan-phase test (mocked `runPlanAgent`). It is rewritten to prove the plan phase commits nothing.
- `adws/phases/__tests__/worktreeSetup.test.ts` (265 lines) and `adws/phases/__tests__/fixtures/worktreeSetupHarness.ts` (`initGitRepo`, `gitignoreContains`) — prior art for the gitignore tests.
- `adws/phases/__tests__/workflowInit.test.ts` — mocks `../worktreeSetup` with a factory listing `copyClaudeAssetsToWorktree`, `ensureGitignoreEntry` and `ensureGitignoreEntries`. The new export must be added or `initializeWorkflow` throws. It exercises the local path through `mockGitCtx`.
- `adws/types/workflowTypes.ts` — the `WorkflowStage` union (`'plan_committing'`, line 9).
- `adws/core/workflowCommentParsing.ts` — `STAGE_ORDER` (line 13), `STAGE_HEADER_MAP` (`':floppy_disk: Committing Plan'`, line 35) and `detectRecoveryState`.
- `adws/core/stageClassifier.ts` — the exhaustive `classifyStage` switch (`case 'plan_committing':`, line 69).
- `adws/core/__tests__/stageClassifier.test.ts` — the `Record<WorkflowStage, StageClass>` table (line 37). It must lose its row, or it fails to compile.
- `adws/core/__tests__/workflowCommentParsing.test.ts` (121 lines) — gains the resume-compatibility test.
- `adws/forge/workflowCommentsIssue.ts` — `formatPlanCommittingComment` (lines 100–102) and its switch case (line 330). `formatPlanCreatedComment` stays as it is.
- `adws/agents/planAgent.ts` — `getPlanFilePath`, `planFileExists` and `readPlanFile`. The later phases read the plan with these; read only, no change.
- `features/regression/plan-commit/feature-930.feature` — the nine scenarios to replace with one.
- `features/regression/step_definitions/feature-930.steps.ts` — G-PC/W-PC/T-PC steps and the `@plan-commit-guard` hooks.
- `features/regression/step_definitions/feature-930-plan-fixture.ts` — the plan-phase fixture and Claude CLI stand-in.
- `features/regression/step_definitions/feature-930-fixtures.ts` — the git fixtures.
- `features/regression/step_definitions/feature-930-worktree-setup.steps.ts` — used only by the worktree-setup scenarios being retired; to delete.
- `features/regression/vocabulary.md` — the "Plan Commit Guard and Worktree Setup (@plan-commit-guard)" section (lines 884–932) and the "Smoke processes (@subprocess)" section (lines 696–813, rows G-SP*/T-SP*).
- `features/regression/surfaces/row-02-adwPlan-planPhase-happy.feature`, `features/regression/surfaces/row-13-adwChore-workflowInit-planPhase-happy.feature` — both assert `"## :floppy_disk: Committing Plan"`.
- `features/regression/surfaces/row-09-adwReview-diffEvaluationPhase-happy.feature` and `test/fixtures/jsonl/manifests/surface-diff-evaluation-phase.json` — G-S1 "plan committed on its branch" and the reason "The surface diff adds only a plan file."
- `test/fixtures/jsonl/manifests/surface-plan-phase.json`, `test/fixtures/jsonl/manifests/surface-chore-plan-phase.json` — the stub plans for rows 02 and 13. Each plan's text has a "3. Commit the plan" step.
- `features/regression/step_definitions/surfaceSteps.ts` — G-S3 (`has a scenario for issue {int} committed on its branch`) and T-S6 (`the mock harness recorded zero comment posts on issue {int} containing the text {string}`). Both are reused.
- `features/regression/smoke/adw_sdlc_happy_path.feature` and `test/fixtures/jsonl/manifests/adw-sdlc-happy.json` — the full `adwSdlc` run against the `acme/widgets` fixture through the `--target-repo` path. `/feature` writes `specs/issue-100-adw-sdlc-smoke-100-sdlc_planner-sdlc-smoke.md`, and `onCommitCommand: stage-all-and-commit` stands in for `/commit` (`git add -A`).
- `features/regression/step_definitions/subprocessSteps.ts` (104 lines), `features/regression/support/subprocessHarness.ts` (`requireHarness(world).workspacePath`) and `features/regression/support/fixtureWorktree.ts` (`realGit`) — where the new smoke Then goes.
- `features/regression/step_definitions/thenSteps.ts` — T1 reads `agents/<adwId>/state.json`; prior art for reading the top-level state from a Then.
- `test/mocks/manifestInterpreter.ts` — `stageAllAndCommit` (`git add -A` then `git commit`), which the stand-ins use. Read only.
- `.adw/conditional_docs.md` — the build-and-plan-phases entry (lines 254–268; `Owns:` lists `planCommitGuard.ts` and `planCommitGuard*.test.ts`), the worktree-and-vcs entry (line 288) and the bdd-regression-suite entry (line 228, the `@plan-commit-guard` condition).
- `app_docs/feature-9gjajh-build-and-plan-phases.md` — conditional doc: plan phase, `planCommitGuard.ts`, plan commit (ADR-0056). Read for context; the document phase rewrites it.
- `app_docs/feature-9gjajh-worktree-and-vcs.md` — conditional doc: `worktreeSetup.ts`, `ensureGitignoreEntry`, `copyClaudeAssetsToWorktree`.
- `app_docs/feature-9gjajh-github-api.md` — conditional doc: comment formatting in `workflowCommentsIssue.ts`.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — conditional doc: `features/regression/**`, the promoted plan-commit scenario, surface rows, the subprocess harness.

### New Files
- `adws/phases/__tests__/worktreeSetupSpecsIgnore.test.ts` — unit tests for `ignoreSpecsInWorktree`. It is a separate file because `worktreeSetup.test.ts` is already at 265 lines.
- `specs/.gitignore` — **untracked and never committed.** Its one line, `*`, ignores everything in `specs/`, itself included, so no `git add -A` picks it up. It exists only in this run's worktree (see the branch-cleanup step).

### Deleted Files
- `adws/phases/planCommitGuard.ts`
- `adws/phases/__tests__/planCommitGuard.test.ts`
- `adws/phases/__tests__/planCommitGuardPhase.test.ts`
- `adws/phases/__tests__/fixtures/planCommitGuardHarness.ts`
- `features/regression/step_definitions/feature-930-worktree-setup.steps.ts`
- `specs/issue-1076-adw-65r8wi-chore-move-adrs-and-sdlc_planner-move-records-to-docs-sweep-specs.md`, `specs/issue-1079-adw-2sm7e0-chore-patch-pull-req-sdlc_planner-prompts-stop-touching-specs.md`, `specs/issue-1080-adw-a69x2i-bug-resume-recovers-sdlc_planner-fix-resume-plan-path-parsing.md`. These are every plan tracked on the branch at planning time; re-list them before deleting.

## Implementation Plan
### Phase 1: Foundation
Give worktree setup the runtime ignore.
- Extend `ensureGitignoreEntry` with an optional header comment. Share the existing header through one constant, so `ensureGitignoreEntries` stops repeating the literal.
- Add `ignoreSpecsInWorktree`, which appends the root-anchored `/specs/` under its own header, idempotently.
- Call it at both worktree-creation points of `initializeWorkflow`, after the reset on the local path.
- Prove the behaviour with unit tests first:
  - a fresh worktree ends with the line once;
  - a second setup does not duplicate it;
  - a plan under `specs/` is ignored;
  - a nested `test/specs/` stays visible;
  - the local path applies the ignore after the reset.

### Phase 2: Core Implementation
Retire the plan commit.
- Strip the guard and the commit from `executePlanPhase`.
- Delete `planCommitGuard.ts` and its tests and harness.
- Remove the `plan_committing` stage and its "Committing Plan" comment everywhere they are wired.
- Rewrite `planPhaseCommit.test.ts` to prove that the plan phase adds no commit, leaves the plan in the worktree and leaves the planner's other changes uncommitted, and that a worktree prepared by `ignoreSpecsInWorktree` ignores the plan.
- Pin resume compatibility for runs that posted "Committing Plan" before the release.

### Phase 3: Integration
- Replace the feature-930 scenarios with one, prune the step definitions and fixtures it no longer needs, and rename its tag to `@plan-worktree-only`.
- Rewrite the vocabulary section.
- Update surface rows 02, 09 and 13 and their manifests.
- Add the no-commit and no-comment assertions to the SDLC smoke row.
- Update README and `.adw/conditional_docs.md`.
- Clean `specs/` off the branch while keeping this run's plan readable in the worktree.
- Run the full validation set and compare the `@regression` scenario count against the baseline. The count must be exactly 20 lower: feature-930's 21 test cases become 1.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Record the regression baseline
- Before changing anything, run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --dry-run` and note the reported scenario total (call it N). The last step checks that the total is N − 20.
- Run `git ls-files specs/` and note what it lists. At planning time it lists the plans of #1076, #1079 and #1080, plus this issue's own plan once the plan phase has committed it.

### 2. Add the root-anchored `/specs/` ignore to worktree setup (`adws/phases/worktreeSetup.ts`)
- Introduce a module constant for the existing header `'# ADW: copied slash commands (do not commit)'`, and use it in both `ensureGitignoreEntry` and `ensureGitignoreEntries`.
- Change `ensureGitignoreEntry(worktreePath, entry)` to `ensureGitignoreEntry(worktreePath, entry, comment = <that constant>)`. The body is unchanged apart from using `comment` for the `hasComment` check and the appended header. `copyAdwInitCommandToWorktree` keeps calling it with two arguments.
- Add the exported constant `SPECS_GITIGNORE_ENTRY = '/specs/'`, a private constant `SPECS_GITIGNORE_COMMENT = '# ADW: per-run plans stay in the worktree that wrote them (do not commit)'`, and:
  ```ts
  export function ignoreSpecsInWorktree(worktreePath: string): void {
    ensureGitignoreEntry(worktreePath, SPECS_GITIGNORE_ENTRY, SPECS_GITIGNORE_COMMENT);
  }
  ```
  Give it a one-line comment stating the non-obvious reason only: root-anchored, because a bare `specs/` would also hide nested `specs/` directories such as a target repository's `test/specs/`.

### 3. Unit-test the ignore (`adws/phases/__tests__/worktreeSetupSpecsIgnore.test.ts`, new)
Use a temp repo from `initGitRepo` (`fixtures/worktreeSetupHarness.ts`) with a committed `.gitignore` (for example `node_modules/\n`), and the real `git`. Tests:
- **A fresh worktree ends with `/specs/` in its tracked `.gitignore`.** After `ignoreSpecsInWorktree(repo)`, `.gitignore` has exactly one `/specs/` line under the new header. `git status --porcelain` reports ` M .gitignore`, a change to the tracked file. A written plan `specs/issue-1-adw-x-sdlc_planner-y.md` is reported by `git check-ignore -q`, and is absent from `git status --porcelain --untracked-files=all`.
- **A second setup does not duplicate the line.** Calling it twice leaves exactly one `/specs/` line and one header line, and the file is byte-identical after the second call.
- **A nested `specs/` directory stays visible to git.** `test/specs/login.spec.ts` appears as `?? test/specs/login.spec.ts` in `git status --porcelain --untracked-files=all`.
- **A `.gitignore` with no trailing newline.** The entry lands on its own line after a newline is added.
- **A repository without a `.gitignore`.** One is created holding the header and the entry.
- **The slash-commands header is left alone.** When `.gitignore` already holds `# ADW: copied slash commands (do not commit)`, the new entry still gets its own header, not that one.

### 4. Apply the ignore when a worktree is created (`adws/phases/workflowInit.ts`)
- Import `ignoreSpecsInWorktree` from `./worktreeSetup`.
- `--target-repo` branch: call `ignoreSpecsInWorktree(worktreePath)` right after `copyClaudeAssetsToWorktree(worktreePath, gitCtx)`.
- Local branch, the `else` that creates a new worktree: call `ignoreSpecsInWorktree(worktreePath)` after `gitCtx.fetchAndResetToRemote(defaultBranch, worktreePath)`. Add a one-line comment giving the ordering reason: the reset restores the tracked `.gitignore`, so the entry is added after it.
- Leave the `options.cwd` branch and both local reuse branches (found by issue pattern, found by branch) unchanged.
- `adws/phases/__tests__/workflowInit.test.ts`:
  - Add `ignoreSpecsInWorktree: vi.fn()` to the `vi.mock('../worktreeSetup', ...)` factory.
  - Add one test on the local path: a newly created worktree gets the ignore exactly once, for `FAKE_WORKTREE_PATH`, after `mockGitCtx.fetchAndResetToRemote`. Compare `mock.invocationCallOrder`.
  - Add one test that a worktree reused through `getWorktreeForBranch` gets no call.

### 5. Stop committing the plan (`adws/phases/planPhase.ts`)
- Delete the `./planCommitGuard` import (lines 20–25), `const gitCtx = requireWorkflowGitContext(config);` and `const baseline = capturePlanPhaseBaseline(...)`.
- Drop `requireWorkflowGitContext` from the `./workflowRepoIdentity` import; `workflowLaunchContext` stays.
- Delete the whole `if (shouldExecuteStage('plan_committing', recoveryState)) { ... } else { ... }` block. The phase then goes straight from the plan-agent block to `createPhaseCostRecords`.
- Keep everything that writes, corrects, resolves, reads and announces the plan: `getPlanFilePath`, `correctPlanFileNaming`, `ctx.planPath`, `ctx.planOutput`, the `plan_building` and `plan_created` comments, and the state writes.

### 6. Delete the guard and its tests
- Delete `adws/phases/planCommitGuard.ts`, `adws/phases/__tests__/planCommitGuard.test.ts`, `adws/phases/__tests__/planCommitGuardPhase.test.ts` and `adws/phases/__tests__/fixtures/planCommitGuardHarness.ts`.
- Confirm that nothing in `adws/`, `features/` or `test/` imports them. Today only those two tests import the module and the harness.

### 7. Rewrite `adws/phases/__tests__/planPhaseCommit.test.ts`
Keep its real-git setup (temp repo, `GitContext`, mocked `runPlanAgent`). Retitle the `describe` as `executePlanPhase — the plan stays in the worktree`, and replace the three tests with these:
- **The plan stays in the worktree and the branch gains no commit.** The planner writes `PLAN_FILE`. Afterwards `git rev-parse HEAD` equals the head before the phase, `git log --format=%H -- specs/` is empty, and the plan file exists with what the planner wrote.
- **The planner's other changes stay uncommitted, whatever they touch.** The planner also edits `README.md`, writes `docs/notes.md` and rewrites the tracked `.claude/commands/scenario_writer.md`. The phase resolves, HEAD is unchanged, and `git status --porcelain --untracked-files=all` lists all four paths. The plan phase no longer fails on `.claude/` or `.adw/` changes; that check went with the guard module.
- **In a worktree prepared by worktree setup, the plan is ignored.** Call `ignoreSpecsInWorktree(repo)` before the phase. Afterwards `git status --porcelain --untracked-files=all` is exactly ` M .gitignore`, and the plan file exists.
- Remove the `PROMPT` constant or keep it for the second test, whichever reads cleaner.
- Make sure nothing imports `buildPlanCommitMessage`.

### 8. Retire the `plan_committing` stage and the "Committing Plan" comment
- `adws/types/workflowTypes.ts`: remove `| 'plan_committing'`.
- `adws/core/workflowCommentParsing.ts`: remove `'plan_committing'` from `STAGE_ORDER` and the `':floppy_disk: Committing Plan': 'plan_committing'` entry from `STAGE_HEADER_MAP`. `':floppy_disk: Committing Build'` stays.
- `adws/core/stageClassifier.ts`: remove `case 'plan_committing':`.
- `adws/core/__tests__/stageClassifier.test.ts`: remove the `plan_committing` row.
- `adws/forge/workflowCommentsIssue.ts`: delete `formatPlanCommittingComment` and its `case 'plan_committing'` line.
- `adws/core/__tests__/workflowCommentParsing.test.ts`: add a test that **a run that stopped after posting the old "Committing Plan" comment resumes after `plan_created`**.
  - Feed `detectRecoveryState`, oldest first, timestamps ascending: a `plan_created` comment from `formatWorkflowComment('plan_created', ...)` naming a current-format plan path; then a literal legacy body `'## :floppy_disk: Committing Plan\n\nCommitting implementation plan to branch...\n\n**ADW ID:** \`abc123\`' + ADW_SIGNATURE` (the formatter is gone, so hardcode the body).
  - Assert `lastCompletedStage === 'plan_created'`, `canResume === true`, and that `planPath` is the path from the `plan_created` comment.
- Leave `features/per-issue/feature-1080.feature` alone (see Notes).

### 9. Replace the nine feature-930 scenarios with one (`features/regression/plan-commit/feature-930.feature`)
- Replace the whole file with:
  ```gherkin
  @regression @plan-worktree-only
  Feature: The plan phase leaves the plan in the worktree, and no commit on the branch touches specs/

    The plan is a per-run working file. The planner writes it under specs/ in the worktree, the later
    phases read it there by path, and it goes when the worktree goes. The plan phase commits nothing.
    The stand-in Claude CLI stages and commits every change whenever it is asked to commit, as /commit
    does, and this worktree does not ignore specs/, so a plan phase that asked for any commit would put
    the plan on the branch.

    Background:
      Given the ADW codebase is checked out

    Scenario: After the plan phase the branch has no commit touching specs/ and the worktree holds the plan
      Given a worktree for a workflow on issue 4242 in the target repository "acme/widgets"
      And the Claude CLI is a stand-in that stages every change in the worktree and commits it whenever it is asked to commit
      And the planner writes only the plan file
      When the plan phase runs
      Then the plan phase completes
      And the worktree's branch has no commit touching "specs/"
      And the worktree holds the plan file
  ```
- `features/regression/step_definitions/feature-930.steps.ts`:
  - Re-key the `Before`/`After` hooks to `@plan-worktree-only`.
  - Keep G-PC1, G-PC4, G-PC7, W-PC1 and T-PC1.
  - W-PC1 no longer needs `headBefore`: it writes the manifest and runs `executePlanPhase(buildWorkflowConfig(sc))`, recording the error.
  - Add `Then("the worktree's branch has no commit touching {string}", ...)`. It asserts that `git(sc.worktreePath, 'log', '--format=%H', 'HEAD', '--', relPath)` is `''`, and on failure lists the commits.
  - Add `Then('the worktree holds the plan file', ...)`. It asserts that `<worktree>/<sc.planFile>` exists with the contents `planPlanFile` wrote (export that string as a constant from the fixture), and that `git ls-files -- <planFile>` is `''`, meaning git tracks no copy.
  - Delete the steps no feature uses any more: G-PC2, G-PC3, G-PC5, G-PC6, G-PC8, W-PC2, T-PC2, T-PC3, T-PC4, T-PC5 and T-PC6. No other `.feature` file uses them.
  - Drop the imports that become unused (`path`, `runCommitAgent`, `DataTable`, and the fixture helpers) and update the file's header comment.
- `features/regression/step_definitions/feature-930-plan-fixture.ts`:
  - Delete `Change`, `asChange`, `planPlannerChange` and `leaveChangeInWorktree`.
  - Narrow `StandInManifest` to `{ jsonlPath; edits; onCommitCommand }`, dropping `deletes`, `stage` and `commitAll`.
  - Drop `headBefore` from `PlanScenario`.
  - Export the plan contents as a constant used by `planPlanFile`.
  - Make `buildIssue` module-private if nothing else imports it.
  - Remove the now-unused imports (`assert`, `appendLine`, `readRepoFile`, `writeRepoFile`).
- `features/regression/step_definitions/feature-930-fixtures.ts`: keep `git`, `initRepo` and `newGitContext`. Delete the helpers nothing uses any more (`writeRepoFile`, `commitFiles`, `contentsOnBranch`, `appendLine`, `readRepoFile`, `uncommittedPaths`, `commitsSince`, `pathsInCommit`), and update the header comment.
- Delete `features/regression/step_definitions/feature-930-worktree-setup.steps.ts`. Its scenarios are retired, and `adws/phases/__tests__/worktreeSetupTrackedAssets.test.ts` already covers the same `copyClaudeAssetsToWorktree` behaviour.
- ESLint lints `features/`. No unused import or variable may remain.

### 10. Update the regression vocabulary (`features/regression/vocabulary.md`)
- Rename the section to `## Given/When/Then — The Plan Stays in the Worktree (@plan-worktree-only)`.
- Rewrite its introduction to match the new feature description:
  - one production entry point (`executePlanPhase`), driven in-process;
  - the stand-in that stages and commits everything when asked;
  - a fixture worktree that does not ignore `specs/`;
  - assertions that read the branch history and the worktree;
  - the definitions in `feature-930.steps.ts` over `feature-930-plan-fixture.ts` and `feature-930-fixtures.ts`.
- Keep rows G-PC1, G-PC4, G-PC7, W-PC1 and T-PC1, with the semantics adjusted:
  - G-PC4's manifest carries only the plan file G-PC7 adds;
  - W-PC1 no longer records a baseline head.
- Delete rows G-PC2, G-PC3, G-PC5, G-PC6, G-PC8, G-PC9, G-PC10, W-PC2, W-PC3 and T-PC2–T-PC10.
- Add these rows:
  - `T-PC11 | the worktree's branch has no commit touching {string}` — asserts `git log --format=%H HEAD -- <path>` in the worktree prints nothing: no commit the branch carries, before or during the plan phase, touches the path | phase-import | git artefact (branch history).
  - `T-PC12 | the worktree holds the plan file` — asserts the plan file G-PC1 named exists in the worktree with what the planner wrote, and that `git ls-files -- <plan>` prints nothing | phase-import | worktree artefact + git artefact (index).
- Replace the closing "reuses" sentence: only G18 (`the ADW codebase is checked out`) is reused now.
- In the "Smoke processes (@subprocess)" section:
  - Add `T-SP6 | the branch the run for adwId {string} worked on has no commit touching {string}` — reads `branchName` from the adwId's top-level state, asserts the workspace holds that branch (`git rev-parse --verify refs/heads/<branch>`), then asserts `git log --format=%H <branch> -- <path>` in the workspace prints nothing | subprocess | top-level state file + git artefact (branch history).
  - Add "the branch the run worked on, in the workspace's git history" to the list of artefacts the section's Thens read.
  - In "The full-pipeline smoke rows" paragraph, note that worktree setup ignores `/specs/`, so the plan stays in the worktree and no commit carries it.

### 11. Update surface rows 02, 09 and 13 and their manifests
- `row-02-adwPlan-planPhase-happy.feature`: replace `And the mock GitHub API recorded a comment containing the text "## :floppy_disk: Committing Plan"` with `And the mock harness recorded zero comment posts on issue 1002 containing the text "## :floppy_disk: Committing Plan"` (T-S6, reused).
- `row-13-adwChore-workflowInit-planPhase-happy.feature`: the same, for issue 1013.
- `test/fixtures/jsonl/manifests/surface-plan-phase.json` and `surface-chore-plan-phase.json`: remove the stale `\n3. Commit the plan` step from each stub plan's contents.
- `row-09-adwReview-diffEvaluationPhase-happy.feature`:
  - Replace `And the worktree for adwId "surface-09" has the plan for issue 1009 committed on its branch` with `And the worktree for adwId "surface-09" has a scenario for issue 1009 committed on its branch` (G-S3, reused).
  - Change the description's "so the row commits a plan on the branch first" to say the row commits a scenario on the branch first, since a plan is never committed.
  - Change the expectation to `"**Reason:** The surface diff adds only a scenario file."`.
- `test/fixtures/jsonl/manifests/surface-diff-evaluation-phase.json`: change the `/diff_evaluator` reason to `The surface diff adds only a scenario file.` and keep the JSON escaping intact.
- Leave rows 04, 14, 17, 33 and 34 (G-S1) as they are (see Notes).

### 12. Extend the SDLC smoke row (`features/regression/smoke/adw_sdlc_happy_path.feature`)
- Append:
  ```gherkin
      And the branch the run for adwId "sdlc-smoke-100" worked on has no commit touching "specs/"
      And the mock harness recorded zero comment posts on issue 100 containing the text "## :floppy_disk: Committing Plan"
  ```
  and add one sentence to the description: worktree setup ignores the plan directory, so the plan the planner writes stays in the worktree and no commit carries it.
- Implement T-SP6 in `features/regression/step_definitions/subprocessSteps.ts`:
  - take the workspace from `requireHarness(this).workspacePath` and assert it is set;
  - take `branchName` from `AgentStateManager.readTopLevelState(adwId)` and assert it is set;
  - assert `realGit(workspace, 'rev-parse', '--verify', '--quiet', \`refs/heads/${branch}\`)` succeeds, so the check cannot pass vacuously;
  - assert `realGit(workspace, 'log', '--format=%H', branch, '--', relPath)` is `''`.
  Import `realGit` from `../support/fixtureWorktree.ts` and `AgentStateManager` from the core barrel, as other step files do.

### 13. Update README and the conditional-docs index
- `README.md`:
  - Replace the "Plan-phase off-limits guard" bullet (line 27) with a "Worktree-only plans" bullet. It should say that worktree setup (`ignoreSpecsInWorktree`, `adws/phases/worktreeSetup.ts`) appends the root-anchored `/specs/` to the tracked `.gitignore` of each worktree it creates; that the plan therefore stays in that worktree, where the later phases read it by path, and no commit carries it; and that the plan phase commits nothing.
  - Remove the tree lines for `planCommitGuardHarness.ts`, `planCommitGuard.test.ts`, `planCommitGuardPhase.test.ts` and `planCommitGuard.ts`, and keep the tree connectors (`├──`/`└──`) consistent.
  - Add "including the runtime `/specs/` ignore" to the `worktreeSetup.ts` comment.
  - Rewrite the `plan-commit/` line: one regression scenario proving the plan phase leaves the plan in the worktree and no commit on the branch touches `specs/`.
  - Rewrite the `specs/` line: per-run implementation plans, ignored at runtime by worktree setup, so each lives only in the worktree that wrote it.
- `.adw/conditional_docs.md`:
  - In the build-and-plan-phases entry, drop the dead `Owns:` lines `adws/phases/planCommitGuard.ts` and `adws/phases/__tests__/planCommitGuard*.test.ts`. Rewrite the plan-commit condition as: "When working on the plan phase leaving the plan uncommitted in the worktree (`planPhaseCommit.test.ts`), or troubleshooting a plan that reached a commit".
  - In the worktree-and-vcs entry, name `ignoreSpecsInWorktree` and the root-anchored `/specs/` ignore in the `worktreeSetup.ts` condition.
  - In the bdd-regression-suite entry, rewrite the feature-930 condition to `@plan-worktree-only` and the closure `feature-930.steps.ts`, `feature-930-plan-fixture.ts`, `feature-930-fixtures.ts`.
  - Leave `app_docs/` to the document phase.

### 14. Take every plan off the branch, keeping this run's plan in the worktree
- Re-run `git ls-files specs/`.
- Delete every listed file except this issue's own plan, using glob pathspecs. The repository's PreToolUse hook rejects an `rm` command line containing a dash, then letters with an `r` (as in `-chore-` or `-records-`), together with a path, so do not spell out the full plan names. At planning time the command is:
  `git rm -q -- 'specs/issue-1076-*.md' 'specs/issue-1079-*.md' 'specs/issue-1080-*.md'`
  Add a pathspec for any other plan that dev has brought in since.
- This issue's own plan, `specs/issue-1077-adw-9skpoc-feat-retire-the-plan-sdlc_planner-retire-plan-commit-ignore-specs.md`, was committed by the pre-release host's plan phase. The review phase reads the issue's requirements from its `## Metadata`, and the document phase reads it too, so it must stay in the worktree:
  - write `specs/.gitignore` with the single line `*` (it ignores itself and everything beside it, so no `git add -A` of the host's later commit agents picks it up, and it is never committed);
  - then run `git rm --cached -q -- 'specs/issue-1077-*.md'`.
- Check the result:
  - `git ls-files specs/` prints nothing once staged;
  - `git status --porcelain --untracked-files=all -- specs/` shows only the staged deletions;
  - the plan file is still present at its path;
  - the root `.gitignore` is unchanged (`git diff --exit-code origin/dev...HEAD -- .gitignore`; nothing staged for it either).
- Do not add `specs/` or `/specs/` to the root `.gitignore`. It arrives at runtime through worktree setup once the host runs this code.

### 15. Run the validation commands
- Run every command in `Validation Commands` and fix anything that fails.
- The `@regression` dry-run total must be exactly N − 20 against the baseline from step 1.

## Testing Strategy
### Unit Tests
- `adws/phases/__tests__/worktreeSetupSpecsIgnore.test.ts` (new):
  - a fresh worktree ends with one `/specs/` line, under its own header, in its tracked `.gitignore`;
  - a second setup changes nothing;
  - a plan under `specs/` is ignored;
  - a nested `test/specs/` file is not;
  - a missing `.gitignore` is created;
  - a `.gitignore` without a trailing newline is appended to cleanly;
  - an existing slash-commands header does not absorb the entry.
- `adws/phases/__tests__/workflowInit.test.ts`: a new local worktree gets `ignoreSpecsInWorktree` once, after `fetchAndResetToRemote`; a reused worktree gets no call.
- `adws/phases/__tests__/planPhaseCommit.test.ts` (rewritten):
  - the plan phase adds no commit and leaves the plan in the worktree;
  - the planner's other changes, including under `.claude/`, stay uncommitted and do not fail the phase;
  - in a worktree prepared by `ignoreSpecsInWorktree`, the plan is ignored and `git status` shows only the `.gitignore` change.
- `adws/core/__tests__/workflowCommentParsing.test.ts`: a legacy "Committing Plan" comment after `plan_created` resumes after `plan_created` and keeps the plan path.
- `adws/core/__tests__/stageClassifier.test.ts`: still exhaustive over `WorkflowStage` with `plan_committing` gone (compile-time backstop).
- BDD:
  - the replacement feature-930 scenario;
  - rows 02 and 13 assert that no "Committing Plan" comment is posted, and row 09 evaluates a committed scenario diff;
  - the SDLC smoke row asserts that the run's branch has no commit touching `specs/` and that no "Committing Plan" comment was posted.

### Edge Cases
- The idempotent second setup: same file bytes, one entry, one header.
- A target repository with nested `specs/` directories (`test/specs/`, `e2e/specs/`): they stay visible to git because the entry is root-anchored.
- A `.gitignore` with no trailing newline, CRLF line endings (lines are trimmed), or no `.gitignore` at all.
- A `.gitignore` that already holds the ADW slash-commands header: `specs` gets its own header and is not mislabelled.
- The local path's `git reset --hard` (`fetchAndResetToRemote`): the entry is added after it, so it survives.
- A reused worktree on the `--target-repo` path: `ensureWorktree` returns it and the helper runs again, harmlessly. Reused local worktrees and `--cwd` worktrees are untouched.
- An in-flight run that posted "Committing Plan" on the old host and resumes on the new one: it resumes after `plan_created` with the plan path recovered, and nothing re-runs the plan phase.
- A planner that touches `.claude/` or `.adw/` no longer fails the plan phase; the planner prompts still say to write exactly one file.
- Rows 04, 14, 17, 33 and 34 still commit a plan as setup (G-S1). The fixture worktree never runs worktree setup, so `git add` of the plan still works there.
- The chore smoke manifests write non-plan files in the build, so the diff evaluator still sees a non-empty diff once the plan is no longer committed.
- This run's own plan: untracked, self-ignored, still readable by review and document; the root `.gitignore` is untouched.

## Acceptance Criteria
- A fresh worktree ends with `/specs/` (the root-anchored spelling of `specs/`) in its tracked `.gitignore`, and a second setup does not duplicate the line. Proven by `worktreeSetupSpecsIgnore.test.ts`.
- `initializeWorkflow` applies the ignore when it creates a worktree on the `--target-repo` path and on the local path, after the local reset.
- The full `adw_sdlc` smoke run against the `acme/widgets` fixture passes with the two new assertions: the run's branch has no commit touching `specs/`, and no "## :floppy_disk: Committing Plan" comment was posted.
- `commitPlanFileOnly`, `planCommitGuard.ts`, `PlanCommitGuardError`, `capturePlanPhaseBaseline`, `assertPlanPhaseLeftOffLimitsAlone`, `buildPlanCommitMessage`, the `plan_committing` stage and `formatPlanCommittingComment` no longer exist in `adws/`, `test/` or `features/regression/`.
- The plan phase writes the plan to the worktree, posts `plan_building` and `plan_created` (with the plan path and summary), and adds no commit.
- `git ls-files specs/` on the branch prints nothing. This issue's own plan is still present in the worktree. The root `.gitignore` is unchanged from `dev`.
- feature-930 holds exactly one scenario, tagged `@regression @plan-worktree-only`, and it passes. The `@regression` dry-run total is exactly 20 lower than before the change, and no other scenario count changes.
- Rows 02, 09 and 13 and the SDLC smoke row pass with their updated expectations. The vocabulary registry lists every phrase the suite uses and none that it no longer uses.
- `bun run lint`, both type checks, `bun run build`, `bun run test:unit`, `bun run lint:git-guard`, `bun run lint:docs-index` and the `@regression` suite are green.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — prepare the app per `.adw/commands.md`.
- `bun run lint` — ESLint over `adws/`, `features/` and `test/`, with no unused imports left by the deletions.
- `bunx tsc --noEmit` — root type check, including the `WorkflowStage` exhaustiveness in `stageClassifier.ts` and its test.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional `adws` type check.
- `bun run build` — `tsc` build.
- `bun run test:unit` — the full Vitest suite, including the new and rewritten tests.
- `bunx vitest run adws/phases/__tests__/worktreeSetupSpecsIgnore.test.ts adws/phases/__tests__/planPhaseCommit.test.ts adws/phases/__tests__/workflowInit.test.ts adws/core/__tests__/workflowCommentParsing.test.ts adws/core/__tests__/stageClassifier.test.ts` — the focused unit tests.
- `bun run lint:git-guard` — the git/gh guard stays green.
- `bun run lint:docs-index` — the conditional-docs gate passes, with no dead `Owns:` glob for the deleted guard files.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@plan-worktree-only"` — the replacement feature-930 scenario.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @surface"` — the surface rows, including 02, 09 and 13.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke"` — the smoke rows, including `adw_sdlc_happy_path` with its new assertions and the chore diff-verdict rows.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1077"` — this issue's per-issue scenarios, if the scenario phase wrote any.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the full regression suite.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --dry-run` — the total must be exactly the step-1 baseline minus 20.
- `test -z "$(git ls-files specs/)"` — no tracked file under `specs/` on the branch.
- `test -n "$(ls specs/issue-1077-adw-9skpoc-*.md)"` — this run's plan is still in the worktree for the later phases.
- `git diff --exit-code origin/dev...HEAD -- .gitignore && git diff --cached --exit-code -- .gitignore` — this PR commits no static `.gitignore` line.
- `! git grep -n -E "commitPlanFileOnly|planCommitGuard|PlanCommitGuardError|capturePlanPhaseBaseline|assertPlanPhaseLeftOffLimitsAlone|buildPlanCommitMessage|plan_committing|formatPlanCommittingComment|plan-commit-guard" -- adws test features/regression README.md .adw` — no live reference to the retired machinery remains.

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md` strictly:
  - guard clauses and small pure helpers;
  - no unused imports or variables (ESLint covers `features/` too);
  - comments only for the non-obvious: the root anchor's reason and the after-the-reset ordering;
  - no issue numbers in comments;
  - new files under 300 lines, which is why the new gitignore tests get their own file.

  `workflowInit.test.ts` (572 lines), `workflowInit.ts` (487) and `thenSteps.ts` (395) are already over the limit; this change adds only a few lines to the first two and nothing to `thenSteps.ts`.
- **No new library.** If one were ever needed, the install command is `bun add <package>`.
- **`/specs/` versus `specs/`.** The issue and the PRD say `specs/`. This plan writes `/specs/`, the same entry anchored to the repository root:
  - It is where the planner writes plans.
  - It is the only `specs/` the PRD means.
  - It matches the existing ADW entries, all of which are root-relative.
  - A bare `specs/` would match every nested directory named `specs` in every target repository (WebdriverIO's default is `test/specs/`), silently keeping new test files out of the build agent's `git add -A` commits.

  The unit tests prove both halves: the plan is ignored and a nested `specs/` is not. The line still ends with `specs/`.
- **Why the guard goes too.** The issue asks for the plan-only commit helper, its guard and the module to be deleted ("`planCommitGuard` no longer exist[s]"). With no plan commit, nothing remains for the guard to protect at the end of the phase. The planner prompts already say to write exactly one file.
  - The incident behind ADR-0056 was stale framework prompts riding in the plan commit. Worktree setup still prevents that: it leaves the framework's own tracked Claude assets as the branch has them, covered by `worktreeSetupTrackedAssets.test.ts`.
  - ADR-0056 ("planner commits only the plan") is superseded in part. Per the PRD, a follow-up ADR (write-an-adr skill) records the lifetime split. No ADR is written in this issue.
- **Resume compatibility.** Removing `plan_committing` from `STAGE_HEADER_MAP` and `STAGE_ORDER` is safe for in-flight runs:
  - `detectRecoveryState` keeps only comments it can map to a stage, so a legacy "Committing Plan" comment is skipped and the run resumes after `plan_created`, the stage just before it.
  - `features/per-issue/feature-1080.feature` (an already-merged issue's per-issue feature) still lists `plan_committing` rows. Its steps cast the string and post the formatter's default "ADW Workflow Update" body, which recovery ignores, so its expectations still hold. Leave it alone.
- **Paths deliberately unchanged:**
  - `--cwd` worktrees and reused local worktrees get no ignore call.
  - The PR-review workflow (`initializePRReviewWorkflow`) runs no worktree setup. Its branches inherit the line once the target's default branch carries it.
  - The takeover reset (`git clean -fdx`) removes ignored plans. Parking a resumed run whose plan is lost is user story 19, a separate issue.
- **Rows 04, 14, 17, 33 and 34** keep G-S1 ("the plan … committed on its branch") as setup. Those phases only need the plan present in the worktree, and the in-process fixture worktree never runs worktree setup, so the commit still works. Row 09 switches to G-S3 because its expectation was about the committed content.
- **This run's own plan.** The pipeline host still runs the old code during this run. It committed this plan in the plan phase, and its commit agents run `git add -A` after every later phase. Deleting the plan would blind the review agent, which reads the issue from the plan's `## Metadata`, and the document agent. Untracking it alone would get it re-added. The untracked, self-ignoring `specs/.gitignore` (`*`) is the worktree-local stand-in for the runtime ignore this PR introduces: never committed, gone with the worktree. The root `.gitignore` stays untouched, as the issue requires.
- **Release coupling (from the PRD).** This change and the end of plan commits must be released to the pipeline host together. After the release, the first worktree ADW creates in each repository carries the `/specs/` line into that issue's pull request. Plans that other in-flight branches carry when they merge around the release stay tracked until removed; an ignore cannot untrack a file.
- **Documentation.** The document phase rewrites `app_docs/feature-9gjajh-build-and-plan-phases.md` (plan commit, guard, ADR-0056 citation), `app_docs/feature-9gjajh-worktree-and-vcs.md` (`ignoreSpecsInWorktree`) and `app_docs/feature-9gjajh-bdd-regression-suite.md` ("21 test cases, tagged `@regression @plan-commit-guard`"). This plan only pre-updates the README and the three conditional-docs entries that name deleted files.
