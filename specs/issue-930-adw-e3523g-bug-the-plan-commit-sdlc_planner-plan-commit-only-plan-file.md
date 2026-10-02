# Bug: The plan commit stages the whole worktree and reverts prompt changes under `.claude/`

## Metadata
issueNumber: `930`
adwId: `e3523g-bug-the-plan-commit`
issueJson: `{"number":930,"title":"bug: the plan commit carries only the plan; a guard rejects .claude/ and .adw/ changes","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision record\n\nADR-0056.\n\n## What to build\n\nThe plan phase commits through the `/commit` command, which stages everything in the worktree. Twice a plan commit overwrote prompt changes that another agent had made minutes earlier (commits ca72a4a7 and c3606f9e).\n\n- The plan commit stages the plan file only.\n- A guard rejects a plan commit that touches anything under `.claude/` or `.adw/`. The form of the guard was not decided; choose one that fails the phase loudly and cannot be skipped by the agent.\n- Find out why the worktree's copies of the prompt files differed from the branch in the two commits named above, and state the cause in the pull request. If the cause is a copy step in worktree setup, fix it.\n\nADR-0056 leaves one question open: whether the per-issue scenario file belongs in the plan commit. Do not change how that file is committed; say in the pull request what the plan commit carries today.\n\n## Acceptance criteria\n\n- [ ] A plan-phase commit contains no path under `.claude/` or `.adw/`.\n- [ ] A unit test shows the guard failing when such a path is modified in the worktree during the plan phase.\n- [ ] Other phases commit as before.\n- [ ] The Divergence section of ADR-0056 is removed in the same pull request.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-01T19:19:58Z","comments":[{"author":"paysdoc","createdAt":"2026-10-01T20:22:43Z","body":"## Retry"}],"actionableComment":null}`

## Bug Description
`executePlanPhase` (`adws/phases/planPhase.ts`) is the plan phase of every orchestrator that plans (`adwPlan`, `adwPlanBuild*`, `adwSdlc`, `adwChore`). It ends by calling `runCommitAgent(OrchestratorId.Plan, …)`, which runs the `/commit` slash command. Step 2 of `.claude/commands/commit.md` is `git add -A`, so the plan commit carries every change in the worktree, not only the plan.

What happened:
- **ca72a4a7** (plan commit for #583, 2026-06-16 22:52) wrote back the blobs from before d45d708e of `.claude/commands/scenario_writer.md` (923cbe33), `generate_step_definitions.md` (72837d9f) and `adw_init.md` (c87ea0eb). Its parent b94d6575 already contained d45d708e, which was merged as #603 at 22:10.
- **c3606f9e** (plan commit, 2026-09-24 10:57) wrote back `scenario_writer.md` blob 923cbe33. That removed the comment rule bebda8dd had added. Its parent 34901ec0 (the merge of #885) already contained bebda8dd.
- **It is still happening.** ecb15bf3 (plan commit for #937, 2026-10-01 23:10) and 95e81cc4 (plan commit for #933, 23:30) both reverted `.claude/commands/{adw_init,bug,chore,document,feature}.md`. On the branch for #937, 86aec027 restored them by hand: "Creating the worktree copied the ADW runner's stale main checkout over the tracked .claude/commands/ files, and the plan commit picked them up."

Expected: the plan commit carries the plan file and nothing else. A change under `.claude/` or `.adw/` during the plan phase fails the phase loudly. Worktree setup never leaves the framework's own tracked prompt files different from the branch.

Actual: the plan commit carries whatever differs in the worktree. No guard exists. For ADW's own repository, worktree setup overwrites the branch's tracked prompts with the copies in the checkout the orchestrator runs from.

## Problem Statement
There are three defects:
1. **The plan commit stages everything.** `executePlanPhase` commits through an LLM `/commit` agent that runs `git add -A`. Nothing limits which paths the commit carries.
2. **No guard protects `.claude/` and `.adw/`.** Nothing stops the planner, or the plan commit, from changing or committing prompt and configuration files (ADR-0056).
3. **Worktree setup writes stale prompts.** `copyClaudeAssetsToWorktree` (`adws/phases/worktreeSetup.ts`) copies the running checkout's `.claude/commands/*.md` and `.claude/skills/**` over the new worktree. It overwrites files the worktree's branch tracks. On the `--target-repo` path of `initializeWorkflow`, nothing resets the worktree afterwards. Every trigger-launched run takes that path, including runs on ADW's own repository. When the checkout the orchestrator runs from (the runner clone on `main`, ADR-0019) is behind the branch (`dev`), its older prompts become uncommitted changes, and defect 1 commits them.

## Solution Statement
1. **Commit only the plan file, in code.** Replace the `runCommitAgent` call in `executePlanPhase` with `GitContext.addAndCommitPaths([planFile], message, worktreePath)` from `@paysdoc/devplatform`. It stages and commits exactly that path with `git add -- <path>` and `git commit -m … -- <path>`. Every other change in the worktree, staged or not, stays uncommitted. The message is deterministic and keeps today's prefix: `plan-orchestrator: <keyword>: add plan for issue #<n>`, built with the existing `buildCommitPrefix`. No LLM call is made. `runCommitAgent` and `.claude/commands/commit.md` stay as they are, so the other phases commit as before.
2. **Guard the plan commit in code.** Add a new module `adws/phases/planCommitGuard.ts`.
   - At the start of the plan phase it records a baseline: the HEAD commit and a sha256 of every file under `.claude/` and `.adw/` in the worktree.
   - Just before the plan commit it collects two sets of paths:
     - every file under those directories that was created, modified or deleted since the baseline;
     - every path under those directories in commits added since the baseline HEAD.
   - If either set has any path, it throws `PlanCommitGuardError` naming every path. The plan phase fails and no plan commit is made.
   - The guard runs in the orchestrator process after the agent has exited, so the agent cannot skip it. Changes that existed before the phase, such as those worktree setup left, are part of the baseline and do not trip it.
3. **Fix the copy step at its source.** When the worktree belongs to the framework's own repository, `copyClaudeAssetsToWorktree` leaves every file the worktree's branch tracks as the branch has it. "Own repository" means the target `owner/repo` equals the identity of the framework checkout's `origin`, read with `readLocalRepoIdentity(frameworkRepoRoot)` and compared with `sameRepoIdentity`.
   - Files that only the running checkout has are still copied and gitignored as today, so every command the running code calls stays available.
   - External target repositories keep today's copy, refresh and gitignore behaviour. For example, vestmatic/vestmatic tracks `install.md`, `prime.md` and the `tdd`/`implement-tdd` skills and relies on the refresh.
4. Remove the `## Divergence` section of ADR-0056. That is the only edit an accepted ADR allows for this.

## Steps to Reproduce
Do not run these during planning. They are for the implementer, before and after the fix.

1. **The `/commit` sweep.** This runs `/commit` steps 2 and 3 by hand in a scratch repository:
   ```bash
   tmp=$(mktemp -d) && cd "$tmp" && git init -q && git config user.email t@e.co && git config user.name T
   mkdir -p .claude/commands specs && echo branch > .claude/commands/scenario_writer.md && echo r > README.md
   git add -A && git commit -qm init
   echo stale > .claude/commands/scenario_writer.md        # what worktree setup leaves behind
   echo plan > specs/issue-1-adw-x-sdlc_planner-p.md       # what the planner writes
   git add -A && git commit -qm "plan-orchestrator: fix: add plan"
   git show --name-only --format= HEAD                     # lists .claude/commands/scenario_writer.md
   ```
2. **The copy step overwrites a tracked prompt.** Run this from the repository root. Before the fix, the last command prints ` M .claude/commands/scenario_writer.md`; after the fix it prints nothing.
   ```bash
   tmp=$(mktemp -d) && git clone -q "$PWD" "$tmp/wt"
   printf 'newer copy on the branch\n' > "$tmp/wt/.claude/commands/scenario_writer.md"
   git -C "$tmp/wt" commit -qam "newer prompt on the branch"
   WT="$tmp/wt" REPOS="$tmp" bunx tsx -e "
   import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';
   import { copyClaudeAssetsToWorktree } from './adws/phases/worktreeSetup.ts';
   import { readLocalRepoIdentity } from './adws/core/localRepoIdentity.ts';
   const { owner, repo } = readLocalRepoIdentity(process.cwd());
   const ctx = new GitContext({ owner, repo, selfHost: false, tokenProvider: createLiteralTokenProvider('t'),
     gitIdentity: { authorName: 'T', authorEmail: 't@e.co', committerName: 'T', committerEmail: 't@e.co' },
     frameworkRepoRoot: process.cwd(), targetReposDir: process.env.REPOS! });
   copyClaudeAssetsToWorktree(process.env.WT!, ctx);"
   git -C "$tmp/wt" status --porcelain -- .claude/commands/scenario_writer.md
   ```
3. **The history.** All four lines print `923cbe33`, which shows each plan commit wrote back the prompt from before the change. `git rev-parse --short` takes one revision at a time, so the commands loop:
   ```bash
   for r in d45d708e^ ca72a4a7 bebda8dd^ c3606f9e; do
     echo "$r $(git rev-parse --short "$r:.claude/commands/scenario_writer.md")"
   done
   ```

## Root Cause Analysis
**Why the plan commit carried prompt files.** `executePlanPhase` → `runCommitAgent` → `/commit`, whose step 2 is `git add -A`. Every path that differs in the worktree goes into the plan commit.

**Why the worktree's prompt files differed from the branch.** This was confirmed on 2026-10-02 and is the cause the pull request must state.
1. **The triggers always pass `--target-repo`, including for ADW's own repository.**
   - `buildCronTargetRepoArgs` (`adws/triggers/cronRepoResolver.ts`) always returns `['--target-repo', '<owner>/<repo>', …]`. With no `--target-repo` of its own, it falls back to the identity of the local remote.
   - `resolveWebhookRepo` (`adws/triggers/webhookRepoResolver.ts`) passes `--target-repo` for every payload.
   - On this host, the running orchestrator for this very issue is `adwSdlc.tsx 930 e3523g-bug-the-plan-commit --target-repo paysdoc/AI_Dev_Workflow --clone-url …`, launched from `/Users/martin/projects/paysdoc/AI_Dev_Workflow`, which has `main` checked out.
2. **On that path, nothing undoes the copy.** `initializeWorkflow` (`adws/phases/workflowInit.ts`) takes the `targetRepoWorkspacePath` branch and runs:
   - `gitCtx.ensureWorktree(branchName, defaultBranch)`, which makes a new branch from `origin/dev` or reuses an existing worktree;
   - then `copyClaudeAssetsToWorktree(worktreePath, gitCtx)`.

   That function calls `copyFileSync` for every `.claude/commands/*.md` and every file of every `.claude/skills/<name>/` in `adwRepoRoot`, the checkout the orchestrator runs from, and writes them over the worktree. It checks whether a file is tracked only to decide on `.gitignore` entries, never to decide whether to copy. The self-host branch follows the copy with `gitCtx.fetchAndResetToRemote` (`git reset --hard origin/<default>`, ADR-0002), which restores tracked files. The target-repo branch has no such step.
3. **The checkout the triggers run from is behind the branch.** The runner clone has `main` checked out (ADR-0019), while pipeline branches start from `dev`. Every prompt change merged to `dev` but not yet promoted to `main` shows up in each new worktree as an uncommitted modification that undoes it.
4. **The evidence fits.**
   - For c3606f9e, `origin/main` was 6973e6e0 (promoted 2026-09-24 09:31; the next promotion was 2026-09-25 09:49). Its `scenario_writer.md` is blob 923cbe33, exactly the blob the plan commit wrote back.
   - For ca72a4a7, the blobs written back (923cbe33, 72837d9f, c87ea0eb) are the ones on the commits before #603 merged, for example 81848774 at 18:33 that day.
   - For ecb15bf3 and 95e81cc4, the message of 86aec027 names the runner's stale `main` checkout.
5. **Retries make it worse.** A worktree reused on the target-repo path is copied over again. A retry therefore also reverts prompt changes the branch itself has committed, for example an issue whose build phase edits a prompt.

**What the plan commit carries.** The pull request must state this.
- **Before this fix:** everything that differs in the worktree when the commit runs:
  - the plan file;
  - stale `.claude/` copies left by worktree setup;
  - any edits the planner made;
  - in `adwSdlc`, `adwPlanBuildReview` and `adwPlanBuildTestReview`, where the scenario agent runs alongside the plan phase, the per-issue scenario file whenever the scenario agent had already written it. ca72a4a7 carried `features/per-issue/feature-583.feature`. It would also carry the scenario agent's `.adw/commands.md` rewrite if the agent bootstrapped Cucumber.
- **After this fix:** the plan file only. No code changes how the per-issue scenario file is committed. Because the plan commit no longer stages the whole worktree, that file goes into the next commit that does: the `alignment-agent` commit when alignment changes artifacts, otherwise the `build-agent` commit.

## Relevant Files
Use these files to fix the bug:

- `README.md` — project overview. It was read first, as the planning instructions require.
- `.adw/coding_guidelines.md` — the rules every change must follow:
  - files under 300 lines;
  - guard clauses and at most two levels of nesting;
  - pure functions with side effects at the edges;
  - no `any`;
  - comments only for what the code cannot say, with no issue numbers.
- `adws/phases/planPhase.ts` — `executePlanPhase`. It calls `runCommitAgent` (line 130), which this fix replaces with the guarded, plan-only commit, and it captures the baseline.
- `adws/agents/gitAgent.ts` — `runCommitAgent` and `buildCommitPrefix`. Reuse `buildCommitPrefix` for the plan commit message. Leave `runCommitAgent` unchanged; the other phases still use it.
- `.claude/commands/commit.md` — `/commit` (`git add -A`). Read it for context only. **Do not edit it**: the other phases must commit as before.
- `adws/agents/planAgent.ts` — `getPlanFilePath` returns the plan path relative to the worktree (`specs/issue-…-sdlc_planner-….md`). `planFileExists` lives here too.
- `adws/phases/workflowRepoIdentity.ts` — `requireWorkflowGitContext(config)`, the usual way a phase gets its `GitContext`.
- `adws/phases/worktreeSetup.ts` — `copyClaudeAssetsToWorktree`, the copy step to fix. Its existing tracked-file helpers are `getTrackedBasenames` and `getTrackedTopDirs`.
- `adws/phases/workflowInit.ts` — the two call sites of `copyClaudeAssetsToWorktree`: the target-repo branch without a reset (line 256) and the self-host branch followed by `fetchAndResetToRemote` (lines 277–279). Read it for context; no change is planned.
- `adws/core/localRepoIdentity.ts` — `readLocalRepoIdentity(cwd)`. Called with an explicit root, the git/gh guard's `cwd-derived-identity` rule allows it.
- `adws/core/repoIdentityCrossCheck.ts` — `sameRepoIdentity`, a case-insensitive comparison of owner and repo.
- `adws/core/environment.ts` — `REPO_ROOT`, the same path `copyClaudeAssetsToWorktree` computes today.
- `node_modules/@paysdoc/devplatform/dist/git/commitOps.js` and `gitContext.d.ts` — reference for the semantics of `addAndCommitPaths`, `diff(range, cwd)`, `headShort`, `lsFiles` and `hasUncommittedChanges`.
- `adws/checkGitGhGuard.ts` — a constraint on the implementation: non-test code must never pass a string that starts with `git ` or `gh ` as the first argument of any call. Use the `GitContext` methods only.
- `adws/core/phaseRunner.ts` — `runPhase` and `runPhasesParallel`. A thrown guard error fails the phase or parallel group; it is not a rate-limit error.
- `adws/adwSdlc.tsx`, `adws/adwPlanBuildReview.tsx`, `adws/adwPlanBuildTestReview.tsx` — these run `executePlanPhase` and `executeScenarioPhase` in parallel in the same worktree. This matters for the open overlap described in Notes.
- `adws/phases/alignmentPhase.ts`, `adws/phases/buildPhase.ts` — the next commits that stage the whole worktree, which is where the per-issue scenario file is now committed. They stay unchanged.
- `adws/triggers/cronRepoResolver.ts`, `adws/triggers/webhookRepoResolver.ts` — evidence that the triggers always pass `--target-repo`.
- `adws/phases/__tests__/worktreeSetup.test.ts` — the pattern for unit tests with a temp git repository and a real `GitContext`. Its fixtures use owner/repo `o`/`r`, so the existing cases keep their current behaviour.
- `adws/phases/__tests__/reviewPhase.test.ts` — the `vi.mock`/`vi.hoisted` pattern for driving a phase function with mocked agents and core.
- `features/per-issue/feature-930.feature` — the scenarios this fix must satisfy (tags `@adw-930`, `@adw-e3523g-bug-the-plan-commit`).
- `test/mocks/claude-cli-stub.ts`, `test/mocks/manifestInterpreter.ts`, `test/mocks/gitContextFixture.ts` — the stand-in Claude CLI and fixtures for the step definitions.
- `features/regression/step_definitions/whenSteps.ts` and `thenSteps.ts` — the existing steps "the git/gh guard is run across the repository" (W16), "the git/gh guard reports no violations" (T34) and "the ADW TypeScript type-check passes" (T22). "the ADW codebase is checked out" (G18) is in `features/step_definitions/ensureCronOnEveryEventSteps.ts`. There is no `codebaseBackstopSteps.ts`, although `.adw/conditional_docs.md` names one.
- `specs/adr/0056-planner-commits-only-the-plan.md` — remove its `## Divergence` section.
- `specs/adr/0002-worktree-per-issue.md`, `specs/adr/0019-dev-and-main-branches-with-runner-clone.md` — context for the copy-then-reset order and the runner clone on `main`. Do not edit them.
- `app_docs/feature-9gjajh-build-and-plan-phases.md` — conditional doc for plan, build and alignment phases (owns `planPhase.ts`).
- `app_docs/feature-9gjajh-worktree-and-vcs.md` — conditional doc for `copyClaudeAssetsToWorktree` and `worktreeSetup.ts`.
- `app_docs/feature-9gjajh-workflow-lifecycle-phases.md` — conditional doc for `workflowInit.ts` and `workflowRepoIdentity.ts`.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — conditional doc for the git/gh guard (`checkGitGhGuard.ts`, `adws/guard/**`) and `readLocalRepoIdentity`.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — conditional doc for `test/mocks/**` (the Claude CLI stub) and the codebase backstop steps.
- `app_docs/feature-9gjajh-bdd-per-issue.md` — conditional doc for `features/per-issue/**`.
- `app_docs/feature-9gjajh-commands-and-skills.md` — conditional doc for `.claude/commands/commit.md`. Read it only; no command file changes.

### New Files
- `adws/phases/planCommitGuard.ts` — the baseline, the guard and the plan-only commit helper.
- `adws/phases/__tests__/planCommitGuard.test.ts` — unit tests. They include the acceptance-criterion test: the guard fails when a `.claude/` or `.adw/` path is modified in the worktree during the plan phase.
- `features/per-issue/step_definitions/feature-930.steps.ts` — step definitions for `feature-930.feature`, unless the step-definition phase generates them.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Create `adws/phases/planCommitGuard.ts`: the baseline and pure detection
- Add `export const PLANNER_OFF_LIMITS_DIRS = ['.claude', '.adw'] as const;`.
- Add pure `isOffLimitsToPlanner(relPath: string): boolean`.
  - Normalise to POSIX separators and strip a leading `./`.
  - Return true only when the path equals one of the directories or starts with `<dir>/`.
  - `.adw-version`, `.adw-stub-invocations`, `.adw-stub-manifest.json` and `.claude-x` are **not** off-limits.
- Add `interface PlanPhaseBaseline { readonly head: string; readonly offLimitsFiles: ReadonlyMap<string, string> }`. The map is POSIX relative path → sha256 hex.
- Add `hashOffLimitsFiles(worktreePath: string): ReadonlyMap<string, string>`.
  - Walk `<worktree>/.claude` and `<worktree>/.adw` recursively when they exist, using `fs.readdirSync(dir, { withFileTypes: true })`.
  - Hash regular files with `crypto.createHash('sha256')`. For a symlink, hash its `fs.readlinkSync` target and do not follow it.
  - Move the per-entry logic into small named functions to keep nesting to two levels at most.
- Add `capturePlanPhaseBaseline(gitCtx: GitContext, worktreePath: string): PlanPhaseBaseline`, returning `{ head: gitCtx.headShort(worktreePath), offLimitsFiles: hashOffLimitsFiles(worktreePath) }`.
- Add pure `changedFilePaths(before, after): string[]`: paths created (only in `after`), deleted (only in `before`) or modified (different hash). Return them sorted.
- Add pure `parseNameOnlyDiff(output: string): string[]`: split lines, trim, drop empty lines, and strip one pair of surrounding double quotes (git quotes unusual paths).
- Add `committedPathsSince(gitCtx, worktreePath, head): string[]`, returning `parseNameOnlyDiff(gitCtx.diff(`--name-only --no-renames ${head} HEAD`, worktreePath))`.
  - `GitContext.diff` adds the `git diff ` prefix itself, and the argument does not start with `git`, so the git/gh guard stays green.
  - `--no-renames` lists both sides of a rename, so a rename out of `.claude/` is still reported.
- Add pure `findOffLimitsChanges(baseline, current: { offLimitsFiles; committedPaths }): string[]`: the sorted, de-duplicated union of `changedFilePaths(baseline.offLimitsFiles, current.offLimitsFiles)` and `current.committedPaths.filter(isOffLimitsToPlanner)`.

### 2. Add the guard and the plan-only commit to `adws/phases/planCommitGuard.ts`
- Add `export class PlanCommitGuardError extends Error` with `readonly paths: readonly string[]` and `name = 'PlanCommitGuardError'`.
- Add `assertPlanPhaseLeftOffLimitsAlone(gitCtx, worktreePath, baseline): void`. It reads the current state with `hashOffLimitsFiles` and `committedPathsSince`, then calls `findOffLimitsChanges`. If the result is non-empty, it throws `PlanCommitGuardError`. The message names every path, for example: `Plan phase guard: the plan phase changed 2 path(s) under .claude/ or .adw/, which the planner must not touch (ADR-0056): .adw/commands.md, .claude/commands/scenario_writer.md. The plan was not committed; a prompt or configuration change has to be a task in the plan, made by the build agent.`
- Add pure `buildPlanCommitMessage(issueType: IssueClassSlashCommand, issueNumber: number): string`, returning `${buildCommitPrefix(OrchestratorId.Plan, issueType)}: add plan for issue #${issueNumber}`. For `/bug` and #930 this gives `plan-orchestrator: fix: add plan for issue #930`.
- Add `commitPlanFileOnly(gitCtx, worktreePath, planFile, message): boolean`.
  - If `path.join(worktreePath, planFile)` does not exist, throw an `Error` naming the expected plan path.
  - Otherwise return `gitCtx.addAndCommitPaths([planFile], message, worktreePath)`. It returns `false` when the plan is already committed and unchanged.
- Keep the file under 300 lines. Keep comments to the reasons the code cannot state, with no issue numbers.

### 3. Commit only the plan file, behind the guard, in `executePlanPhase`
In `adws/phases/planPhase.ts`:
- At the top of `executePlanPhase`, before `moveToStatus` and before the plan agent can run, add:
  - `const gitCtx = requireWorkflowGitContext(config);`
  - `const baseline = capturePlanPhaseBaseline(gitCtx, worktreePath);`
- Inside `if (shouldExecuteStage('plan_committing', recoveryState))`, keep `postIssueStageComment(… 'plan_committing' …)`. Replace the `runCommitAgent(...)` call with:
  - `assertPlanPhaseLeftOffLimitsAlone(gitCtx, worktreePath, baseline);`
  - `const planFile = getPlanFilePath(issueNumber, worktreePath);`
  - `const committed = commitPlanFileOnly(gitCtx, worktreePath, planFile, buildPlanCommitMessage(issueType, issueNumber));`
  - a `log` line that says whether the plan file was committed or was already committed.
- Remove the imports that are now unused: `runCommitAgent`, and `OrchestratorId` if nothing else uses it. `bun run lint` must stay clean.
- Do not touch `runCommitAgent`, `.claude/commands/commit.md`, or any other phase's commit.

### 4. Leave the framework's own tracked Claude assets as the branch has them, in `adws/phases/worktreeSetup.ts`
- Change the signature to `copyClaudeAssetsToWorktree(worktreePath: string, gitContext: GitContext, frameworkRepoRoot: string = REPO_ROOT)`, reusing `REPO_ROOT` from `adws/core/environment.ts` in place of today's `import.meta.url` computation. The callers in `workflowInit.ts` stay unchanged.
- Add `readFrameworkIdentity(frameworkRepoRoot): RepoIdentity | null`. It wraps `readLocalRepoIdentity(frameworkRepoRoot)` in try/catch and returns `null` on failure, in which case the copy behaves as today. The explicit root keeps the `cwd-derived-identity` rule satisfied.
- Add pure `isFrameworkOwnRepository(target: { owner: string; repo: string }, framework: RepoIdentity | null): boolean`, returning `framework !== null && sameRepoIdentity(framework, target)`.
- In `copyClaudeAssetsToWorktree`:
  - compute `preserveTracked = isFrameworkOwnRepository({ owner: gitContext.owner, repo: gitContext.repo }, readFrameworkIdentity(frameworkRepoRoot))`;
  - collect the set of tracked paths under `.claude/` with `gitContext.lsFiles(worktreePath, '.claude/')`, using a try/catch helper like the existing ones that returns an empty set on failure;
  - skip any command file or skill file whose destination path (`.claude/commands/<f>` or `.claude/skills/<skill>/<file>`) is tracked when `preserveTracked` is true. Pass a skip predicate into `copyDirContents` for skills;
  - when anything was skipped, log once: `Worktree belongs to the framework repository <owner>/<repo>; left N tracked Claude asset(s) as its branch has them`.
- Leave the `.gitignore` policy unchanged. Untracked assets that only the running checkout has are still copied, and still gitignored when `target: false`, so every command the running code calls stays available.
- Add a one-line reason to the doc comment: the branch of the framework's own repository is the authority for its prompts, and the running checkout can be behind it.
- External target repositories (identity differs, or the framework identity cannot be read) keep today's behaviour exactly.
- Check that `worktreeSetup.ts` stays under 300 lines.

### 5. Unit tests: `adws/phases/__tests__/planCommitGuard.test.ts`
Use a real temp git repository and a real `GitContext` built with `createLiteralTokenProvider`, as in `worktreeSetup.test.ts`. Tests may use `execSync('git …')`, because `__tests__/` is outside the git/gh guard.
- **Acceptance-criterion test.** Commit `.claude/commands/scenario_writer.md`, take a baseline, then modify the file in the worktree. `assertPlanPhaseLeftOffLimitsAlone` throws `PlanCommitGuardError`; its message contains `.claude/commands/scenario_writer.md` and `paths` equals `['.claude/commands/scenario_writer.md']`.
- The guard also fails for each of these after the baseline, naming the path:
  - creating `.claude/commands/plan_checklist.md`;
  - deleting `.claude/skills/tdd/SKILL.md`;
  - modifying and staging `.adw/commands.md`;
  - creating `.adw/plan_notes.md`;
  - modifying `.claude/commands/scenario_writer.md` and committing it with `git add -A && git commit`;
  - committing, after the baseline, a `.claude/` change that already existed before it. This is found by the commit check, although the file content is unchanged.
- The guard passes when:
  - `.claude/` and `.adw/` changes existed before the baseline and stay unchanged;
  - only `README.md`, `docs/x.md`, `.adw-version` or `.adw-stub-invocations` change.
- `commitPlanFileOnly`:
  - Set up the worktree with `README.md` modified, `src/widget.ts` modified and staged, `.claude/commands/install.md` modified, and a new plan file.
  - After the commit, `git show --name-only --format= HEAD` lists only the plan file.
  - `git status --porcelain` still lists `README.md`, `src/widget.ts` (still staged) and `.claude/commands/install.md`.
  - It returns `false` when the plan file is already committed and unchanged, and throws when the plan file is missing.
- Pure-function cases for `isOffLimitsToPlanner`, `changedFilePaths`, `parseNameOnlyDiff` and `buildPlanCommitMessage`.
- **Phase-level test** that the guard fails the plan phase.
  - Mock `../../agents`, as `reviewPhase.test.ts` does, so that `runPlanAgent` writes the plan file and modifies `.claude/commands/scenario_writer.md`. Mock the state writes and logging from `../../core` as well, with no `repoContext`.
  - Run `executePlanPhase` on a real temp repository with `gitContext` set.
  - The call rejects with an error naming `.claude/commands/scenario_writer.md`, and HEAD does not move.

### 6. Unit tests for the copy-step fix in `adws/phases/__tests__/worktreeSetup.test.ts`
- **Framework's own repository.**
  - Create a temp "framework checkout" repository with `git remote add origin https://github.com/acme/framework.git`. Give it an older `.claude/commands/scenario_writer.md`, an older `.claude/skills/tdd/SKILL.md` and a command that exists only there, all with frontmatter.
  - Create a temp worktree repository that tracks newer versions of the two files.
  - Build a `GitContext` with owner `acme` and repo `framework`, then call `copyClaudeAssetsToWorktree(worktree, ctx, frameworkRoot)`.
  - Both tracked files keep the branch's content, and `git status --porcelain -- <both paths>` is empty.
  - The command that only the framework checkout has is copied.
- **External target repository** (owner `acme`, repo `widgets`, tracking an older `install.md`): the tracked file is still overwritten, as today.
- **Framework identity cannot be read** (framework root without `origin`): the copy behaves as today.
- The existing E4a–E4e cases stay unchanged and still pass.

### 7. Step definitions for `features/per-issue/feature-930.feature`
Write `features/per-issue/step_definitions/feature-930.steps.ts`, reusing the existing steps where they exist ("the ADW codebase is checked out", the type-check and git/gh guard backstop steps).
- Build the worktree fixtures with a real `GitContext`.
- Drive `executePlanPhase` with a `WorkflowConfig` that has `gitContext` and no `repoContext`.
- Drive the other phases' commits through `runCommitAgent('<agent>', …)`.
- Point `CLAUDE_CODE_PATH` at a stand-in that does two things:
  - for the plan command, writes the plan file plus the scenario's changes, and commits everything when the scenario asks for it;
  - for `/commit`, does what `/commit` does today: `git add -A`, then `git commit`, then prints the commit message.
- Prefer extending `test/mocks/claude-cli-stub.ts`/`manifestInterpreter.ts` with an opt-in step over changing their default behaviour. The step for "the plan phase fails with an error that names <path>" checks the rejected error's message.
- For the worktree-setup scenarios, use a framework-checkout fixture and the explicit `frameworkRepoRoot` argument from task 6, so the steps do not depend on the real checkout's `origin`.
  - For the framework's own repository, use the fixture from task 6. Its `origin` identity equals the worktree's `GitContext` owner/repo, and it holds older copies of `.claude/commands/scenario_writer.md` and `.claude/skills/tdd/SKILL.md`.
  - For the target repository that tracks nothing under `.claude/`, the framework checkout must hold `.claude/commands/feature.md` with `target: false` and `.claude/commands/install.md` with `target: true`, as the real checkout does. Its identity must differ from the target's. The scenario then checks today's gitignore policy: `feature.md` is ignored, and `install.md` is untracked but not ignored.

### 8. Remove the Divergence section of ADR-0056
- In `specs/adr/0056-planner-commits-only-the-plan.md`, delete the whole `## Divergence` section: the heading and its single numbered item, up to but not including `## More Information`.
- Change nothing else. `write-an-adr` allows only `status`, `superseded-by`, `## Divergence` and the supersession note to change after acceptance.
- Leave `specs/adr/README.md`, ADR-0043 and ADR-0054 untouched.

### 9. Run the validation commands
- Run every command in `Validation Commands` and fix any failure before finishing.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun install` — prepare dependencies.
- `bun run lint` — ESLint, including no unused imports in `planPhase.ts`.
- `bunx tsc --noEmit` — type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional ADW type check.
- `bun run build` — build.
- `bun run lint:git-guard` — the git/gh guard must report no violations. This covers the new `GitContext.diff`/`headShort`/`addAndCommitPaths` calls and `readLocalRepoIdentity(frameworkRepoRoot)`.
- `bun run lint:docs-index` — the living-docs index must stay healthy. If it flags `adws/phases/planCommitGuard.ts` as unowned, add it to the `Owns:` list of `app_docs/feature-9gjajh-build-and-plan-phases.md` in `.adw/conditional_docs.md`.
- `bun run lint:comment-only` — the comment-discipline gate.
- `bunx vitest run adws/phases/__tests__/planCommitGuard.test.ts adws/phases/__tests__/worktreeSetup.test.ts adws/phases/__tests__/planPhase.test.ts adws/phases/__tests__/workflowInit.test.ts` — the targeted unit tests, including the acceptance-criterion guard test.
- `bun run test:unit` — the full unit suite, to confirm no regressions.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-930"` — the issue's scenarios: plan commit carries only the plan file, the guard fails the phase, the other agents commit as before, the copy step preserves the framework's tracked assets and still copies the framework's assets into a target repository that tracks none of them, and the type-check and git/gh guard pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite.
- `! grep -q '^## Divergence' specs/adr/0056-planner-commits-only-the-plan.md` — confirms the Divergence section is gone.
- Run Steps to Reproduce 2 again after the fix. Its final `git status --porcelain` prints nothing.

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of fixing the bug.
- No new library is needed.
- **For the pull request description** (required by the issue):
  - **Cause.** State the Root Cause Analysis in short:
    - every trigger-launched run uses `--target-repo`, including runs on ADW's own repository;
    - on that path `initializeWorkflow` runs `copyClaudeAssetsToWorktree`, which overwrites the worktree's tracked `.claude/commands` and `.claude/skills` with the running checkout's copies and never resets;
    - the runner checkout is on `main`, behind `dev`;
    - the `git add -A` in `/commit` then put the older prompts into the plan commit.

    Cite the blob evidence (923cbe33 / 72837d9f / c87ea0eb) and the later cases ecb15bf3 and 95e81cc4, fixed by hand in 86aec027.
  - **What the plan commit carries.** Before this change it carried everything in the worktree, including the per-issue scenario file whenever the scenario agent had written it first (ca72a4a7 carried `features/per-issue/feature-583.feature`). Now it carries only the plan file. No code changes how the per-issue scenario file is committed; it goes into the next commit that stages the whole worktree (`alignment-agent` when alignment changes artifacts, otherwise `build-agent`). ADR-0056's open question stays open.
  - **Open overlap, not covered by a scenario.** In `adwSdlc`, `adwPlanBuildReview` and `adwPlanBuildTestReview`, the scenario agent runs alongside the plan phase in the same worktree. When `## Run E2E Tests` in `.adw/commands.md` is absent or `n/a`, it bootstraps Cucumber and rewrites `.adw/commands.md`. If that happens before the plan commit, the guard cannot tell it from a planner change and fails the plan phase. A retry gets past it, because the change is then part of the baseline. Flag this to the owner.
- **The guard's form.** The guard is TypeScript in the orchestrator process. It does not depend on a prompt rule or a Claude Code permission. It runs after the agent has exited and throws, so the phase and the workflow fail loudly. The agent cannot skip it, and Bash cannot get around it.
- **Limit of the guard.** It does not undo the planner's changes. If a failed plan phase is retried in the same worktree, those changes are part of the new baseline and stay uncommitted until a later `git add -A` commit. Restoring them automatically was left out to keep the fix small.
- **Commit author.** The plan commit is now made through the launch `GitContext`, so it carries that context's git identity, like other commits made in code. It no longer uses the host's `git config`, as the `/commit` agent did (c3606f9e was authored by `Martin <martin@macmini.local>`).
- **Self-host path.** On the self-host path the copy step now also skips tracked files. Its existing `fetchAndResetToRemote` already restored them, so nothing changes there in practice.
- **Out of scope.** The prompt text lost in ca72a4a7 and c3606f9e is restored under the Divergence items of ADR-0043 and ADR-0054, not here. The upgrade regeneration loss (1ab26649) is not a plan commit and is outside ADR-0056.
- **No prompt edits.** This fix needs no edits under `.claude/` or `.adw/`, apart from a possible `Owns:` entry required by `lint:docs-index`.
