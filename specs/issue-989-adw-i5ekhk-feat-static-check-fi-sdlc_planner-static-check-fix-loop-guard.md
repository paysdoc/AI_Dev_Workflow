# Feature: Static-check fix loop without a cap, stopped on no progress, every round checked by a suppression guard

## Metadata
issueNumber: `989`
adwId: `i5ekhk-feat-static-check-fi`
issueJson: `{"number":989,"title":"feat: static-check fix loop without a cap, stopped on no progress, every round checked by a suppression guard","body":"Source: `specs/prd/review-proof-redesign.md` and the ADR named below, in `specs/adr/`. The PRD section **Implementation Decisions** describes the module; the ADR holds the decision and its reasons. Read both before planning; they are the specification. Do not change the decisions.\n\n## Decision record\n\nADR-0059 (fix loop and guard); ADR-0060 for the park comment. PRD modules: **Fix-round guard**, **Static-check fix loop**, **Park comment builder**.\n\n## What to build\n\n- A **fix-round guard** (pure): takes a diff and the guard configuration; returns accepted or rejected with reasons. Rejects a diff that adds a suppression comment, or edits lint, compiler or build configuration, `.adw/commands.md`, or the ADW-owned Playwright configuration in `features/`. Patterns: a framework table keyed by language plus per-repository additions read from `.adw/commands.md`; additions can only add patterns, never remove or weaken a framework one. The language comes from the stack descriptors already in `.adw/`.\n- A **static-check fix loop**: check runner → fix agent → guard → check runner. No cap. Progress is a change in the check runner's combined output between rounds; identical output, or a rejected round, is no progress and ends the loop. The end state is `human_gated` with a park comment; `## Retry` continues the loop.\n- A **park comment builder** (pure): one function from a park reason and its evidence to the comment text, including the meaning of `## Retry` and `## Continue` for that park. Reasons: `baseline_red`, `pre_existing_regression`, `fix_loop_stalled`, `missing_application_type`, `base_server_down`. Only `fix_loop_stalled` is wired in this issue; the others are wired by the issues that introduce them.\n- The fix prompt gains the rule that suppression is forbidden.\n- The unit-test and scenario fix loops keep their caps; this issue does not touch them.\n\n## Acceptance criteria\n\n- [ ] A fix round that adds any pattern from the framework table, or touches any protected path, is rejected and counted as no progress.\n- [ ] A repository addition is honoured; a repository entry that tries to remove a framework pattern has no effect.\n- [ ] The loop stops on identical output and parks as `human_gated` with a comment that names the failing check and says what `## Retry` does; `## Retry` resumes the loop.\n- [ ] Unit tests: guard (every framework pattern per language, additions, protected paths, clean diff passes); loop with a fake check runner and a fake fix agent returning scripted diffs (stop on identical output, rejected round is no progress, changed output continues, resume on `## Retry`); park comment builder (every reason, both directives).\n- [ ] The `### Confirmation` section of ADR-0059 names the implemented check.\n\n## Blocked by\n\n#988\n","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-10-03T23:13:10Z","comments":[],"actionableComment":null}`

## Feature Description
Issue #988 made type check, additional type checks, lint and build deterministic gates in the unit-test phase (`adws/core/checkRunner.ts`, `runStaticChecks`). Today a red check still ends the run, the way an exhausted unit-test loop does (`endRunOnFailedGate` → `process.exit(1)`), because ADR-0058's confirmation scoped that behaviour "until the fix loop of ADR-0059 lands". This issue lands that fix loop (ADR-0059) and the park comment it ends in (ADR-0060), as three PRD modules:

1. **Fix-round guard** (pure). It takes the unified diff of one fix round and the guard configuration, and returns `accepted`, or `rejected` with reasons. It rejects a round that:
   - adds a suppression comment: a pattern from a framework table keyed by language, plus the repository's own additions from a new `## Suppression Patterns` section of `.adw/commands.md`. Additions can only add patterns; an entry that tries to remove one is ignored. The language comes from the stack descriptors that `.adw/` already holds (`## Test Framework`, `## Run Tests`, `## BDD Framework`, `## Run Scenarios by Tag`), through the same inference `stackCoherenceCheck` uses;
   - creates, edits or deletes a protected path: lint, compiler or build configuration, `.adw/commands.md`, or the ADW-owned Playwright configuration in `features/`.
2. **Static-check fix loop**: check runner → fix agent → guard → check runner, with no cap. A round is one run of the fix agent, handed every failing check; the round's diff is what that run changed. Progress means the check runner's combined output changed between rounds. Identical output, or a rejected round, is no progress and ends the loop. A rejected round is reverted before the loop ends. When the loop stalls, the workflow parks as `human_gated` with a park comment. `## Retry` re-arms it to `phase_timeout`, and the resumed orchestrator re-runs the unit-test phase, which re-runs the checks and continues the loop.
3. **Park comment builder** (pure). One function turns a park reason and its evidence into the comment text: what failed (each failing check or scenario by name, with a bounded excerpt of its output where the evidence carries one), a base-branch note where one applies, and what `## Retry` and `## Continue` each do for that park. It supports all five reasons of the PRD; only `fix_loop_stalled` is wired here.

The fix prompt (`.claude/commands/resolve_failed_test.md`, the prompt that fixed static-check failures before #988 and that the loop's fix agent uses again) gains the rule that suppression is forbidden. The unit-test and scenario fix loops keep their caps and their code is not touched.

Value: a lint or build failure is fixed instead of ending the run. A cheat (one disabling comment, a looser lint rule) is caught mechanically before any agent judges anything. An agent that is not getting anywhere stops spending money, and the operator gets one comment that says what failed and what to do.

## User Story
As an ADW operator
I want a red static check to be fixed by an agent round after round until it passes, with every round rejected when it silences a check or changes the rules, and with the run parked as `human_gated` and a clear comment once a round makes no progress
So that lint, type and build failures are fixed rather than abandoned after a fixed number of tries, no check is ever passed by suppressing it, and a stalled run tells me exactly what failed and that `## Retry` continues the loop

## Problem Statement
- A red static check ends the run today (`adws/phases/unitTestPhase.ts` → `endRunOnFailedGate` → `process.exit(1)`). The owner's ruling (ADR-0059): "Keep on retrying until the checks pass. Build and lint issues are not hard problems should be fixable."
- Nothing under `adws/` inspects a fix round's diff, so an agent can make a check pass by adding `// eslint-disable`, `@ts-ignore` or `# noqa`, or by loosening `eslint.config.*`, `tsconfig.json` or `.adw/commands.md`.
- There is no deterministic notion of progress for a fix loop without a cap, and no state for a run that is not failed but waits for a human (`human_gated`) after a static-check failure.
- The PRD's parks share one comment format with the directive meanings spelled out (ADR-0060 "Every park comment carries instructions"). No builder exists.
- ADR-0059's `### Confirmation` says "Not yet implemented".

## Solution Statement
- **Combined output (`adws/core/checkRunner.ts`).** Add `combinedCheckOutput(verdicts)`, a deterministic serialisation of every verdict (check, status, exit code, output) in check order. It is the loop's progress signal, and the baseline gate can reuse it later.
- **Stack languages (`adws/core/stackCoherenceCheck.ts`).** Export the `StackLanguage` type and an `inferStackLanguages(input: StackCoherenceInput)` that returns the set of languages the existing private `inferLanguage` finds in the four descriptors. `stackCoherenceCheck` keeps its behaviour and reuses the new function.
- **Repository additions (`adws/core/projectConfig.ts`).** `CommandsConfig` gains `suppressionPatterns: string`, the raw body of `## Suppression Patterns` (default `''`). Parsing the body into patterns is the guard module's job.
- **Unified-diff parser (`adws/core/unifiedDiff.ts`, pure).** `parseUnifiedDiff(diff)` returns one `DiffFile` per file: old path, new path (`null` for a created or deleted file), added lines and removed lines. Lines inside a hunk that start with `+++` or `---` are not mistaken for headers. Binary and mode-only entries still yield their paths.
- **Fix-round guard (`adws/core/fixRoundGuardTable.ts` data + `adws/core/fixRoundGuard.ts` logic, pure).**
  - `FRAMEWORK_SUPPRESSION_PATTERNS` is keyed by `StackLanguage` (`javascript`, which covers TypeScript, then `python`, `go`, `rust`, `ruby`). Each entry carries `{ pattern, example }`, where `example` is the idiomatic suppression line. The tests iterate the table, so "every framework pattern" is tested by construction.
  - `PROTECTED_PATH_RULES` holds `{ category, scope, matches, example }` rules. Basename-scoped rules match at any depth (a nested `.eslintrc.json` or `tsconfig.json` counts). Repo-path-scoped rules cover exactly `.adw/commands.md` and `features/playwright.config.{ts,js,mjs,cjs,mts,cts}`.
  - `buildFixRoundGuardConfig(languages, section)` merges the framework patterns of every detected language with the repository additions. The merge is a union, so an addition can never remove or weaken a framework pattern. A `!`-prefixed entry (a removal attempt) is ignored and reported in `ignoredAdditions`.
  - `evaluateFixRound(diff, config)` matches patterns case-insensitively and whitespace-insensitively. It counts per file and rejects when a pattern occurs more often in the added lines than in the removed lines. This rejects a new suppression but not a line edited in place that keeps an existing one. Any touched protected path is rejected.
- **Static-check fix loop (`adws/core/staticCheckFixLoop.ts`, orchestration over injected ports, no agent/git/forge imports).** `runStaticCheckFixLoop({ runChecks, fixRounds, guardConfig, report? })`:
  - it runs the checks, and while any is red it starts a round: `fixRounds.fix(failedVerdicts, round)` returns the round's diff and cost;
  - the guard judges the diff. If rejected, it calls `fixRounds.discard(round)` and stalls as `rejected_round`, without re-running the checks;
  - if accepted, it calls `fixRounds.keep(round)` and re-runs the checks. Green ends the loop green. Output identical to the previous run's stalls the loop as `identical_output`. Anything else starts the next round.
  - There is no round limit anywhere.
- **Real fix-round port (`adws/phases/staticCheckFixRound.ts`).** `buildStaticCheckFixRoundPort(config, deps?)` uses only typed `GitContext` methods, so the git/gh guard stays green:
  - `fix`:
    - records the round base (`headShort(worktreePath)`);
    - publishes it (`pushBranch`), so the remote branch always equals the last kept state;
    - runs `runResolveTestAgent` (`/resolve_failed_test`) once per round, with one `TestResult` that hands the agent every failing check of the round (name, command, exit code and output, each output capped at `MAX_FIX_PROMPT_OUTPUT_CHARS`), so the round's diff is what that one run changed;
    - commits everything the round changed (`commitChanges`, so new untracked files are inside the diff too);
    - returns `diff('--no-renames <base> HEAD')`.
    - If the agent throws (rate limit, timeout, auth), the partial round is discarded before the error is rethrown.
  - `keep` pushes the branch.
  - `discard` resets the worktree to the remote branch (`fetchAndResetToRemote(branchName, worktreePath)`), then verifies that HEAD equals the round base. If the fix agent pushed its own commit, HEAD will not match, and `discard` fails closed with an error, so a rejected round can never survive.
- **Park comment builder (`adws/forge/parkComment.ts`, pure).**
  - `ParkReason` enum with the five PRD values. `ParkEvidence` is a discriminated union by reason.
  - `parkDirectives(evidence)` returns `{ retry, continue }`.
  - `buildParkComment(adwId, evidence)` builds `## :raised_hand: ADW Parked — <title>`, what failed (check names, commands and exit codes, each with its output quoted as an excerpt cut at `MAX_PARK_OUTPUT_CHARS`; the server's output for `base_server_down`), the base-branch note for `baseline_red`, `pre_existing_regression` and `base_server_down`, the two directive lines, the ADW ID line and `ADW_SIGNATURE`. The full output stays in the execution log. #988's error comment, which carries names and exit codes only, is unchanged.
  - The heading is deliberately absent from `STAGE_HEADER_MAP`, so recovery never reads a park as a lifecycle stage.
  - The comment never contains a line that on its own reads `## Retry`, `## Continue` or `## Cancel`, so ADW cannot trigger its own directives. Quoted output is indented line by line, so not even a quoted line can.
- **Park handler (`adws/phases/workflowPark.ts`).** `parkWorkflow(config, evidence): never`. It logs, appends to the execution log, writes the top-level `workflowStage: 'human_gated'`, posts the park comment (non-fatal on failure), and calls `process.exit(0)`. This is the same family as `handlePhaseTimeout`. The later baseline issues reuse it.
- **Static-check gate (`adws/phases/staticCheckGate.ts`).** Move `runStaticCheckGate`, `logCheckVerdict` and `describeFailedCheck` out of `unitTestPhase.ts` into this module.
  - A green first run returns at once.
  - A red run builds the guard configuration and the real port lazily, so the regression harness, whose fixture checks are green, never touches git. It then runs the loop, logging every check run (full output of failing checks), every round and every guard rejection to the console and `execution.log`.
  - Green returns the loop's cost. Stalled calls `parkWorkflow` with `fix_loop_stalled` evidence.
  - `executeUnitTestPhase` gains an optional `fixRounds` dependency and adds the gate's cost to its result. `unitTests: false` still skips only the test run.
- **Prompts.**
  - `.claude/commands/resolve_failed_test.md` gains a "Never silence a failure" rule: no suppression comments, no lint/compiler/build configuration, `.adw/commands.md` or `features/` Playwright configuration edits, no skipping or weakening tests, no commits or pushes. It explains that ADW rejects and reverts such a static-check round and stops for a human, and how a static-check failure maps onto the input fields.
  - `.claude/commands/adw_init.md` preserves an existing `## Suppression Patterns` section verbatim, so a repository's additions survive framework upgrades.
- **Records.** ADR-0059's `### Confirmation` names the implemented guard, loop, park and tests. ADR-0058's interim "red check ends the run" bullet is updated. The README describes the fix loop and lists the new files.

## Relevant Files
Use these files to implement the feature:

- `specs/prd/review-proof-redesign.md` — The specification. Under *Implementation Decisions*: **Fix-round guard**, **Static-check fix loop**, **Park comment builder**. Under *Testing Decisions*: the guard, loop and park-builder test lists. Read-only.
- `specs/adr/0059-fix-loops-no-progress-stop-and-suppression-guard.md` — The decision: no cap, identical output = no progress, rejected round = no progress, framework table plus repository additions, protected paths, the prompt rule. Its `### Confirmation` must be rewritten (acceptance criterion).
- `specs/adr/0060-baseline-gate-on-the-base-branch.md` — The park rules: every park comment says what failed, notes a base-branch failure where it applies, and says what `## Retry` and `## Continue` each do. It defines the directive meanings for `baseline_red`, `pre_existing_regression` and `base_server_down`. Read-only.
- `specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md` — The ADW-owned Playwright configuration lives in `features/` and is protected by the ADR-0059 guard. A missing application type parks with "re-run `adw_init`", with no default. Read-only.
- `specs/adr/0062-dev-server-start-failure-is-a-failed-review.md` — Context for `base_server_down`: a base-branch start failure parks and is not a failed review. Read-only.
- `specs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md` — Its `### Confirmation` bullet "A red check ends the run … until the fix loop of ADR-0059 lands" becomes stale and must be updated.
- `specs/adr/0032-explicit-cancel-and-retry-directives.md` — `## Retry`/`## Continue`/`## Cancel` directive background. Read-only.
- `README.md` — Line 11 bullet ("a red check ends the run") and the directory tree entries around `checkRunner.ts`, `resolveFreezeGuard.ts`, `stackCoherenceCheck.ts`, `workflowCommentsIssue.ts`, `unitTestPhase.ts` and the `__tests__` listings.
- `.adw/coding_guidelines.md` — Must be followed: guard clauses, nesting ≤ 2, extracted named functions, enums for named constant sets, `readonly`, no `any`, comments only for invariants/ordering/non-obvious reasons (no issue numbers, no banners, no name-echoing JSDoc), files under 300 lines.
- `.adw/commands.md` — Source of the validation commands. ADW's own static checks are what the loop fixes on self-host runs. Read-only.
- `.github/adw.yml` — `unitTests` is not set to `false`, so unit tests are enabled. Read-only.
- `adws/core/checkRunner.ts` — `CheckVerdict`, `CheckStatus`, `ProcessRunner`, `runStaticChecks`. Add `combinedCheckOutput`.
- `adws/core/stackCoherenceCheck.ts` — Private `inferLanguage`/`LANGUAGE_TOKENS`/`StackLanguage`. Export the type and add `inferStackLanguages`.
- `adws/core/projectConfig.ts` — `CommandsConfig`, `HEADING_TO_KEY`, `getDefaultCommandsConfig`, `parseCommandsMd`. Add `suppressionPatterns`. The file is already over 300 lines (pre-existing). Add only the three lines needed.
- `adws/core/resolveFreezeGuard.ts`, `adws/phases/gherkinFreeze.ts`, `adws/core/__tests__/resolveFreezeGuard.test.ts` — Prior art: a pure guard (decision in core, fs/git edges in phases) and its tests.
- `adws/phases/planCommitGuard.ts` — Prior art for a guard over git state that uses `gitCtx.diff('--name-only --no-renames <head> HEAD')` and typed `GitContext` methods only.
- `adws/phases/unitTestPhase.ts` — Integration point. Move the static-check gate out, add the `fixRounds` dependency, and add the gate's cost to the phase result.
- `adws/phases/__tests__/unitTestPhase.test.ts` — #988's phase tests. The "red check ends the run with exit code 1" cases now describe superseded behaviour and must be rewritten for the loop and the park.
- `adws/phases/scenarioFixPhase.ts`, `adws/phases/scenarioTestFixLoop.ts`, `adws/agents/testRetry.ts` — Prior art for a fix round (resolve agent → freeze guard → commit → push). Their caps stay: do NOT modify these files.
- `adws/agents/testAgent.ts` — `runResolveTestAgent(failedTest: TestResult, logsDir, statePath?, cwd?, issueBody?, launchContext?)` and the `TestResult` shape. The loop's fix agent. Not modified.
- `adws/agents/claudeAgent.ts` — `runClaudeAgentWithCommand` throws `RateLimitError`, `AuthRequiredError` and `AgentTimeoutError` itself. The prompt arguments travel as one argv element, which is why the output given to the agent is capped. Not modified.
- `adws/agents/gitAgent.ts` — `buildCommitPrefix(agentName, issueClass)` for the deterministic round commit message. Not modified.
- `adws/phases/workflowRepoIdentity.ts` — `requireWorkflowGitContext`, `workflowLaunchContext`.
- `@paysdoc/devplatform/git` (`node_modules/@paysdoc/devplatform/dist/git/gitContext.d.ts`) — The typed `GitContext` methods used: `headShort`, `pushBranch` (fetch then `--force-with-lease --force-if-includes`), `commitChanges` (`git add -A` + commit, returns `false` when clean), `diff(range, cwd)` (runs `git diff <range>`, trimmed, 10 MB buffer) and `fetchAndResetToRemote(branch, cwd)` (fetch + `reset --hard origin/<branch>`; no `clean -x`, so `node_modules` survives). `resetWorktree` is NOT suitable because it runs `git clean -fdx`.
- `adws/checkGitGhGuard.ts` — Flags any call whose first argument is a string literal starting with `git `/`gh `. Use only typed `GitContext` methods, never `gitCtx.exec('git …')`.
- `adws/phases/workflowCompletion.ts` — `handlePhaseTimeout`/`handleRateLimitPause`: the pattern for a deliberate stop that writes top-level state, posts a comment and calls `process.exit(0)`.
- `adws/phases/sdlcReviewHandoff.ts` — The existing human-gated park (`review_failed`) for comparison.
- `adws/phases/orchestratorLock.ts` — Documents that a `process.exit` inside a phase leaves the spawn lock for liveness reclaim. Safe for the park.
- `adws/forge/workflowCommentsIssue.ts` — `formatHumanGatedComment`/`formatRateLimitWaitComment` are the context-free formatter precedent (headings kept out of `STAGE_HEADER_MAP`). Already 404 lines, so the builder goes in its own file.
- `adws/core/workflowCommentParsing.ts` — `ADW_SIGNATURE`, `STAGE_HEADER_MAP`, `parseWorkflowStageFromComment`, `extractAdwIdFromComment`/`extractLatestAdwId` (how `## Retry` finds the adwId), `RETRY_COMMENT_PATTERN`, `ACTIONABLE_COMMENT_PATTERN`, `CANCEL_COMMENT_PATTERN`.
- `adws/triggers/retryHandler.ts` — `decideRetryAction('human_gated')` → `rearm_phase_timeout` (`workflowStage: 'phase_timeout'`, `resumeAttempts: 0`). This is how `## Retry` continues the loop. Not modified.
- `adws/triggers/takeoverHandler.ts`, `adws/vcs/worktreeReuseGate.ts` — `phase_timeout` → resume in place (healthy) or reset from remote. Pushing kept rounds means a reset loses no accepted fix. Not modified.
- `adws/core/stageClassifier.ts`, `adws/triggers/cronIssueFilter.ts` — `human_gated` is excluded by the cron until `## Retry`. Not modified.
- `adws/core/phaseRunner.ts` — The unit-test phase is unnamed in most orchestrators (`'test'` in `adwTest.tsx`), so a resumed run always re-enters it. A `RateLimitError` wait re-runs the whole phase. Not modified.
- `adws/core/index.ts` — Core barrel. Add the new core exports next to the `checkRunner` exports.
- `.claude/commands/resolve_failed_test.md` — The fix prompt. Add the no-suppression rule.
- `.claude/commands/adw_init.md` — Step 2 (`.adw/commands.md`). Preserve an existing `## Suppression Patterns` section verbatim. A `hashInputs` file (see Notes).
- `templates/claude-settings-starter.json`, `.claude/settings.json` — Only force pushes are denied to agents. That is why `discard` verifies HEAD after resetting.
- `adws/core/__tests__/checkRunner.test.ts`, `adws/core/__tests__/stackCoherenceCheck.test.ts`, `adws/core/__tests__/projectConfigCommands.test.ts`, `adws/core/__tests__/topLevelState.test.ts` — Test files to extend, and the precedent for unique adwIds plus cleanup of `agents/<adwId>`.
- `adws/triggers/__tests__/retryHandler.test.ts` — Existing coverage of `## Retry` on `human_gated`.
- `features/per-issue/feature-988.feature` — Two of its scenarios (issues 9882 and 9884) were rewritten for the fix loop and also tagged `@adw-989`: a red lint or build goes to the static-check fix agent and never to the test agent, a round that changes nothing parks the workflow as `human_gated`, and the park comment names the failing check. They belong to this issue's scenario set (task 16). Do not edit the file further.
- `features/per-issue/step_definitions/feature-988-*.ts`, `features/per-issue/step_definitions/feature-929-workflow.ts`, `features/per-issue/step_definitions/feature-929-compacting-cli.ts`, `features/per-issue/step_definitions/feature-796.steps.ts` — The harness the `@adw-989` step definitions reuse: #988's shared phase steps, hooks, state, commands-file writer and recording process runner; `createWorkflow` (a throwaway git worktree with no `origin`) and `commitFile`; the throwaway Claude CLI; the recording providers and `commentsOn`.
- `features/regression/support/phaseConfig.ts`, `test/fixtures/cli-tool/.adw/commands.md` — The in-process regression harness runs the real unit-test phase over a fixture whose checks are green. That is why the gate builds the guard and the git port only when a check is red. Read-only.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md` — Conditional doc that owns `unitTestPhase.ts` and `checkRunner.ts` (static-check gate condition).
- `app_docs/feature-9gjajh-state-and-config.md` — Conditional doc that owns `projectConfig.ts` and `adws/core/index.ts`.
- `app_docs/feature-9gjajh-commands-and-skills.md` — Conditional doc that owns `.claude/commands/adw_init.md` and the command prompts.
- `app_docs/feature-9gjajh-scenario-and-stepdef-agents.md` — Conditional doc that owns `testAgent.ts`/`testRetry.ts` (the resolve agent).
- `app_docs/feature-9gjajh-github-api.md` — Conditional doc that owns `adws/forge/**` (comment formatting).
- `features/per-issue/feature-989.feature` — This issue's `@adw-989` scenarios: the guard, the loop through the real unit-test phase, `## Retry`, the unit-test loop's cap, and the park comment for every reason. Implement its step definitions together with those of the two `@adw-989` scenarios of `feature-988.feature` (task 16), and do not edit either feature file.

### New Files
- `adws/core/unifiedDiff.ts` — Pure unified-diff parser (`parseUnifiedDiff`, `DiffFile`, `touchedPaths`).
- `adws/core/fixRoundGuardTable.ts` — Framework data: `FRAMEWORK_SUPPRESSION_PATTERNS` (by `StackLanguage`) and `PROTECTED_PATH_RULES`, each entry with an `example`.
- `adws/core/fixRoundGuard.ts` — Pure guard: `parseSuppressionPatternAdditions`, `buildFixRoundGuardConfig`, `evaluateFixRound`, `describeGuardRejection`.
- `adws/core/staticCheckFixLoop.ts` — The loop over injected ports: `FixRoundPort`, `FixLoopStall`, `runStaticCheckFixLoop`.
- `adws/phases/staticCheckFixRound.ts` — The real port (resolve agent plus typed `GitContext` operations): `buildStaticCheckFixRoundPort`, `toStaticCheckFailure`, `MAX_FIX_PROMPT_OUTPUT_CHARS`.
- `adws/phases/staticCheckGate.ts` — The gate moved out of `unitTestPhase.ts`, now running the loop and parking.
- `adws/phases/workflowPark.ts` — `parkWorkflow(config, evidence): never`.
- `adws/forge/parkComment.ts` — `ParkReason`, `ParkEvidence`, `parkDirectives`, `buildParkComment`.
- `adws/core/__tests__/unifiedDiff.test.ts`
- `adws/core/__tests__/fixRoundGuard.test.ts`
- `adws/core/__tests__/staticCheckFixLoop.test.ts`
- `adws/phases/__tests__/staticCheckFixRound.test.ts`
- `adws/phases/__tests__/workflowPark.test.ts`
- `adws/forge/__tests__/parkComment.test.ts`
- `features/per-issue/step_definitions/feature-989*.ts` — Step definitions for `features/per-issue/feature-989.feature`. Split helpers into `feature-989-*.ts` modules to stay under 300 lines.

## Implementation Plan
### Phase 1: Foundation
Small, pure building blocks, each test-first:
- `combinedCheckOutput` in the check runner (the progress signal).
- `inferStackLanguages` exported from the stack coherence check (the guard's language source).
- `suppressionPatterns` in `CommandsConfig` (the repository's raw additions).
- The unified-diff parser.

### Phase 2: Core Implementation
- The guard table and the guard (config merge, removal attempts ignored, per-file net counting of suppression patterns, protected paths).
- The park comment builder for all five reasons.
- The fix loop core over injected ports, with no cap.
- The real fix-round port (one resolve-agent run per round, commit, diff, push/keep, reset/discard with fail-closed verification, discard on interruption).
- The park handler (`human_gated`, comment, `process.exit(0)`).

### Phase 3: Integration
- Move the static-check gate into `staticCheckGate.ts`, wire the loop and the park, and thread `fixRounds` and the gate cost through `executeUnitTestPhase`. Rewrite the superseded phase tests, including a resume-after-`## Retry` case.
- Add the no-suppression rule to the fix prompt. Make `adw_init` preserve `## Suppression Patterns`.
- Add step definitions for the `@adw-989` scenarios of `feature-989.feature` and `feature-988.feature`.
- Rewrite ADR-0059's `### Confirmation`, update ADR-0058's interim bullet, update the README.
- Run all validation commands, including `@adw-989` and `@regression`.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add `combinedCheckOutput` to the check runner (test first)
- In `adws/core/__tests__/checkRunner.test.ts` add a `describe('combinedCheckOutput')`:
  - two equal verdict lists produce identical strings;
  - a change in any verdict's `output`, `exitCode` or `status` changes the string;
  - the string lists the checks in the order given and includes skipped checks.
- In `adws/core/checkRunner.ts` add `export function combinedCheckOutput(verdicts: readonly CheckVerdict[]): string`. Render one block per verdict, e.g. `` `[${check}] ${status} (exit ${exitCode ?? 'none'})\n${output}` ``, joined with `\n`. Pure; no trimming or normalisation. ADR-0059 defines progress as the output changing, and normalising timings would be a new decision.
- Export it from the `checkRunner` export line in `adws/core/index.ts`.

### 2. Export the stack-language inference (test first)
- In `adws/core/__tests__/stackCoherenceCheck.test.ts` add `inferStackLanguages` cases:
  - ADW's own descriptors (`vitest`, `cucumber-js`, `bun run test:unit`, `bunx cucumber-js …`) → `{javascript}`;
  - `pytest`/`behave` → `{python}`;
  - `godog`/`go test` → `{go}`;
  - `cargo test` → `{rust}` (not go);
  - `rspec` → `{ruby}`;
  - `cucumber-rs` → `{rust}`, `cucumber-ruby` → `{ruby}`;
  - a mixed pytest + cucumber-js stack → `{python, javascript}`;
  - an unknown stack (`ExUnit`, `cabbage`) and all empty → empty set.
- In `adws/core/stackCoherenceCheck.ts`:
  - `export type StackLanguage`;
  - add `export function inferStackLanguages(input: StackCoherenceInput): ReadonlySet<StackLanguage>` over the same four signals, reusing the private `inferLanguage`;
  - make `stackCoherenceCheck` derive `knownLangs` from it.
  - Existing tests must pass unchanged.
- Export `inferStackLanguages` and `type StackLanguage` from `adws/core/index.ts` next to `stackCoherenceCheck`.

### 3. Add `## Suppression Patterns` to `CommandsConfig` (test first)
- In `adws/core/__tests__/projectConfigCommands.test.ts`:
  - a `.adw/commands.md` with `## Suppression Patterns` containing a bulleted list yields `suppressionPatterns` equal to the trimmed section body;
  - an absent section yields `''`;
  - `getDefaultCommandsConfig().suppressionPatterns === ''`.
- In `adws/core/projectConfig.ts`:
  - add `suppressionPatterns: string` to `CommandsConfig`;
  - add `'suppression patterns': 'suppressionPatterns'` to `HEADING_TO_KEY`;
  - add `suppressionPatterns: ''` to `getDefaultCommandsConfig()`.
  - Nothing else changes. Splitting the over-long file is out of scope.
- Fix every TypeScript literal that builds a full `CommandsConfig` and now fails to compile (search `adws/` and `features/` for `runRegressionScenarios:`). Test configs built from `getDefaultCommandsConfig()`/`getDefaultProjectConfig()` need no change.

### 4. Write the unified-diff parser (test first)
- Create `adws/core/__tests__/unifiedDiff.test.ts` with literal `git diff --no-renames` outputs:
  - a modified file → `oldPath === newPath`, added/removed lines without their `+`/`-` prefix, context lines excluded;
  - a new file (`--- /dev/null`) → `oldPath: null`;
  - a deleted file (`+++ /dev/null`) → `newPath: null`;
  - several files in one diff → one `DiffFile` each, in order;
  - an added line whose content starts with `++` (diff line `+++ x`) or `--` (diff line `--- y`) inside a hunk → counted as added/removed, not as a header;
  - `\ No newline at end of file` → ignored;
  - a binary entry (`Binary files a/x.png and b/x.png differ`) and a mode-only entry (`old mode`/`new mode`) → paths from the `diff --git` line, no lines;
  - a quoted path (`"a/sp ce\"q.ts"`) → unquoted;
  - an empty string → `[]`.
- Create `adws/core/unifiedDiff.ts`:
  - `export interface DiffFile { readonly oldPath: string | null; readonly newPath: string | null; readonly addedLines: readonly string[]; readonly removedLines: readonly string[] }`
  - `export function parseUnifiedDiff(diff: string): readonly DiffFile[]`
  - `export function touchedPaths(file: DiffFile): readonly string[]` (the distinct non-null paths).
  - Implement as a small state machine: a `diff --git ` line opens a file; header lines (`---`/`+++`/`new file mode`/`deleted file mode`/`Binary files`) apply only before the first `@@`; inside hunks, `+`/`-`/` `/`\` classify lines.
  - Strip the `a/`/`b/` prefixes. Unquote C-style quoted paths (surrounding quotes, `\"`, `\\`; octal escapes may be left as-is, since no protected file name needs them).
  - Pure; no imports. Extract the per-line handling into named functions to keep nesting at most 2.

### 5. Write the fix-round guard table and guard (test first)
- Create `adws/core/__tests__/fixRoundGuard.test.ts`. Build diffs with a small local helper (`addedLinesDiff(path, lines)`, `editedLineDiff(path, before, after)`, `touchedFileDiff(path, kind: 'added' | 'modified' | 'deleted')`). Cases:
  - **Every framework pattern per language**: `describe.each(Object.entries(FRAMEWORK_SUPPRESSION_PATTERNS))`, then for every entry, a config for that language alone plus a diff adding `entry.example` to `src/sample.txt`. Expect rejection with a `suppression` reason naming `src/sample.txt` and `entry.pattern` (source `framework`, that language).
  - **Language keying**: a `javascript` line (`// eslint-disable-next-line no-console`) under a `python`-only config is accepted, and a `python` line (`x = 1  # noqa: E501`) under a `javascript`-only config is accepted.
  - **Net counting**: removing a suppression line is accepted. Editing a line in place that keeps its existing `// eslint-disable-line` (one removed, one added) is accepted. Adding a second suppression to a file that keeps its first is rejected. A suppression that the diff shows only as a context line is not counted.
  - **Normalisation**: `#  TYPE:  ignore` and `// ESLINT-disable` are caught (case- and whitespace-insensitive).
  - **Repository additions honoured**: `buildFixRoundGuardConfig(['javascript'], '- `@acme-lint off`')` rejects a diff adding `// @acme-lint off`, with source `repository`. An addition with no detected language is still honoured.
  - **Removal attempts have no effect**: `buildFixRoundGuardConfig(['javascript'], '- !eslint-disable')` still rejects `// eslint-disable-next-line`, and `ignoredAdditions` equals `['!eslint-disable']`. An addition equal to a framework pattern does not duplicate it. Entries that word a removal differently (`- -@ts-ignore`, `- allow: @ts-ignore`) are read as additions and leave `@ts-ignore` a framework pattern: a diff adding `// @ts-ignore` is still rejected with source `framework`.
  - **`parseSuppressionPatternAdditions`**: bullets (`-`, `*`, `+`), backticks, blank lines, HTML comments, a fenced-code marker line, and `N/A` (no additions) are handled. `!`-prefixed entries land in `ignored`.
  - **Every protected path**: for every rule in `PROTECTED_PATH_RULES`, its `example` is rejected when created, modified and deleted, with the rule's `category`. For basename-scoped rules, `packages/nested/<example basename>` is also rejected. `test/fixtures/x/.adw/commands.md` is NOT protected (repo-path scope), and `features/per-issue/feature-1.feature` is not protected.
  - **Clean diff passes**: an edit to `src/a.ts` with ordinary code is accepted, and an empty diff is accepted.
  - **Several reasons**: a diff with a suppression and a protected file returns both reasons.
  - **`describeGuardRejection`** returns one readable line per reason, naming the path and the pattern or category.
- Create `adws/core/fixRoundGuardTable.ts` (data only, imports `type StackLanguage`):
  - `export interface SuppressionPatternEntry { readonly pattern: string; readonly example: string }`
  - `export const FRAMEWORK_SUPPRESSION_PATTERNS: Readonly<Record<StackLanguage, readonly SuppressionPatternEntry[]>>`. Every `example` must contain its pattern under the normaliser. At least:
    - `javascript` (JS and TS): `eslint-disable` (`// eslint-disable-next-line no-console`), `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `oxlint-disable`, `tslint:disable`, `jshint ignore`, `deno-lint-ignore`, `prettier-ignore`.
    - `python`: `noqa` (`x = 1  # noqa: E501`), `# type: ignore`, `# pyright: ignore`, `# pylint: disable`, `# mypy: ignore-errors`, `# nosec`, `# pyre-ignore`, `# pyre-fixme`, `# pytype: disable`.
    - `go`: `//nolint`, `//lint:ignore`, `//lint:file-ignore`, `#nosec` (`// #nosec G104`), `//go:build ignore`, `// +build ignore`.
    - `rust`: `#[allow(`, `#![allow(`, `#[expect(`, `#![expect(`.
    - `ruby`: `rubocop:disable`, `rubocop:todo`, `standard:disable`, `steep:ignore`, `# typed: ignore`.
  - `export enum ProtectedPathCategory`: `Lint = 'lint configuration'`, `Compiler = 'compiler configuration'`, `Build = 'build configuration'`, `AdwCommands = 'ADW commands configuration'`, `Playwright = 'ADW-owned Playwright configuration'`.
  - `export enum PathScope { Basename = 'basename', RepoPath = 'repo path' }`
  - `export interface ProtectedPathRule { readonly category: ProtectedPathCategory; readonly scope: PathScope; readonly matches: RegExp; readonly example: string }`
  - `export const PROTECTED_PATH_RULES`. At least:
    - repo path: `^\.adw/commands\.md$` (AdwCommands); `^features/playwright\.config\.[cm]?[jt]s$` (Playwright).
    - basename, Lint: `.eslintrc(.*)`, `eslint.config.[cm]?[jt]s`, `.eslintignore`, `biome.json(c)`, `.oxlintrc.json`, `.prettierrc(.*)`, `prettier.config.[cm]?[jt]s`, `.prettierignore`, `.stylelintrc(.*)`, `stylelint.config.[cm]?[jt]s`, `.flake8`, `(.)pylintrc`, `(.)ruff.toml`, `.golangci.(ya?ml|toml|json)`, `staticcheck.conf`, `(.)clippy.toml`, `(.)rustfmt.toml`, `.rubocop(_todo).yml`, `.standard.yml`, `.shellcheckrc`.
    - basename, Compiler: `tsconfig(.*).json`, `jsconfig.json`, `babel.config.*`, `.babelrc(.*)`, `.swcrc`, `(.)mypy.ini`, `pyrightconfig.json`, `rust-toolchain(.toml)`.
    - basename, Build: `package.json`, `pyproject.toml`, `setup.cfg`, `setup.py`, `tox.ini`, `Cargo.toml`, `go.mod`, `Makefile`, `vite.config.[cm]?[jt]s`, `webpack.config.[cm]?[jt]s`, `rollup.config.[cm]?[jt]s`, `tsup.config.[cm]?[jt]s`, `next.config.[cm]?[jt]s`, `turbo.json`, `bunfig.toml`.
  - Anchor every regex (`^…$`).
- Create `adws/core/fixRoundGuard.ts`:
  - `export enum PatternSource { Framework = 'framework', Repository = 'repository' }`
  - `export interface GuardPattern { readonly pattern: string; readonly source: PatternSource; readonly language?: StackLanguage }`
  - `export interface FixRoundGuardConfig { readonly suppressionPatterns: readonly GuardPattern[]; readonly protectedPaths: readonly ProtectedPathRule[]; readonly ignoredAdditions: readonly string[] }`
  - `export function parseSuppressionPatternAdditions(section: string): { readonly added: readonly string[]; readonly ignored: readonly string[] }`:
    - strip HTML comments;
    - per line: trim; skip blank lines and fence markers; strip one leading list marker (`-`, `*` or `+`, followed by whitespace) and surrounding backticks;
    - `N/A` → none;
    - a `!` prefix → `ignored`;
    - otherwise → `added`.
  - `export function buildFixRoundGuardConfig(languages: Iterable<StackLanguage>, repositorySection: string): FixRoundGuardConfig`:
    - framework patterns of every given language first (source `framework`), then additions whose normalised form is not already present (source `repository`);
    - `protectedPaths: PROTECTED_PATH_RULES`.
    - Comment the invariant: the union means an addition can never remove or weaken a framework pattern.
  - `export type GuardRejection = { readonly kind: 'suppression'; readonly path: string; readonly pattern: GuardPattern } | { readonly kind: 'protected_path'; readonly path: string; readonly category: ProtectedPathCategory }`
  - `export type FixRoundVerdict = { readonly accepted: true } | { readonly accepted: false; readonly reasons: readonly GuardRejection[] }`
  - `export function evaluateFixRound(diff: string, config: FixRoundGuardConfig): FixRoundVerdict`:
    - parse the diff;
    - `protectedPathRejections(file, config)` over `touchedPaths` (basename rules test `path.posix.basename`, repo-path rules test the full path);
    - `suppressionRejections(file, config)` per pattern: `countOccurrences(normalised added lines) > countOccurrences(normalised removed lines)`, where `normalise = s => s.replace(/\s+/g, '').toLowerCase()`, applied to pattern and line alike;
    - matching is literal substring matching, never `RegExp` built from repository text.
  - `export function describeGuardRejection(rejection: GuardRejection): string`, e.g.:
    - `` `src/a.ts` adds `eslint-disable` (javascript suppression pattern) ``
    - `` `src/a.ts` adds `@acme-lint off` (suppression pattern from .adw/commands.md) ``
    - `` `tsconfig.json` is compiler configuration, which a fix round may not change ``
  - Pure. Imports only `./unifiedDiff`, `./fixRoundGuardTable`, `type StackLanguage` and `path` (posix).
- Run `bunx vitest run adws/core/__tests__/unifiedDiff.test.ts adws/core/__tests__/fixRoundGuard.test.ts` until green.
- Export from `adws/core/index.ts`:
  - types `DiffFile`, `FixRoundGuardConfig`, `FixRoundVerdict`, `GuardRejection`, `GuardPattern`, `ProtectedPathRule`, `SuppressionPatternEntry`;
  - values `parseUnifiedDiff`, `buildFixRoundGuardConfig`, `parseSuppressionPatternAdditions`, `evaluateFixRound`, `describeGuardRejection`, `FRAMEWORK_SUPPRESSION_PATTERNS`, `PROTECTED_PATH_RULES`, `ProtectedPathCategory`, `PathScope`, `PatternSource`.

### 6. Write the park comment builder (test first)
- Create `adws/forge/__tests__/parkComment.test.ts` with one sample evidence per reason. Cases:
  - **every reason**: the comment starts with `## :raised_hand: ADW Parked — `, carries `` **ADW ID:** `<adwId>` `` and ends with `ADW_SIGNATURE`;
  - **what failed**:
    - `baseline_red` and `fix_loop_stalled` list each failing check as `` `<check>` — `<command>` (exit <code|none>) ``, followed by its output quoted as an indented block;
    - `pre_existing_regression` names the scenario;
    - `base_server_down` says the dev server did not start and quotes the server's output;
    - `missing_application_type` names the `## Application Type` section and the value found there (or says the section is missing), and says to re-run `adw_init`;
  - **base-branch note**: present and naming the base branch for `baseline_red`, `pre_existing_regression` and `base_server_down`; absent for `fix_loop_stalled` and `missing_application_type`;
  - **both directives**: for every reason, the comment contains `` `## Retry` — `` followed by `parkDirectives(evidence).retry`, and `` `## Continue` — `` followed by `parkDirectives(evidence).continue`. Assert the reason-specific meanings:
    - `baseline_red`/`base_server_down`: Retry re-runs the baseline and parks the issue again if it is still red; Continue waives the baseline, so this run fixes the pre-existing failures too;
    - `pre_existing_regression`: Retry re-runs the scenario on the base branch and parks again if it still fails there; Continue waives it, so this run fixes the pre-existing failure too;
    - `fix_loop_stalled`: Retry re-runs the static checks and continues the static-check fix loop, parking again on no progress; Continue waives nothing and points to `## Retry`;
    - `missing_application_type`: Retry re-reads `## Application Type` after `adw_init` has been re-run; Continue waives nothing, because ADW never assumes a type;
  - **`fix_loop_stalled` variants**:
    - `identical_output` says the checks produced the same output as the round before and gives the round count;
    - `rejected_round` says the fix-round guard rejected the round's change and that it was reverted, lists every rejection line (each names its file), and says that counts as no progress;
  - **safety**: for every reason, `parseWorkflowStageFromComment(comment) === null` (never read as a lifecycle stage), and `extractAdwIdFromComment(comment) === adwId` (so `## Retry` finds the workflow). No line matches `RETRY_COMMENT_PATTERN`, `ACTIONABLE_COMMENT_PATTERN` or `CANCEL_COMMENT_PATTERN`, so ADW never triggers its own directives;
  - **bounded, directive-safe quoting**: each failing check's output, and the server's output for `base_server_down`, appears in the comment. An output longer than `MAX_PARK_OUTPUT_CHARS` is cut to that length plus a marker saying the full output is in the run's execution log. Every quoted line is indented, so a sample output holding a line `## Retry`, `## Continue` or `## Cancel` still leaves no line matching the directive patterns.
- Create `adws/forge/parkComment.ts`:
  - `export enum ParkReason { BaselineRed = 'baseline_red', PreExistingRegression = 'pre_existing_regression', FixLoopStalled = 'fix_loop_stalled', MissingApplicationType = 'missing_application_type', BaseServerDown = 'base_server_down' }`
  - `export interface ParkedCheck { readonly check: string; readonly command: string; readonly exitCode: number | null; readonly output: string }`
  - `export type ParkEvidence` (discriminated by `reason`):
    - `BaselineRed { baseBranch; failedChecks }`
    - `PreExistingRegression { baseBranch; scenario }`
    - `FixLoopStalled { failedChecks; stall: FixLoopStall; rounds: number; rejections: readonly string[] }` (`FixLoopStall` from task 7, imported as a type-only enum from `../core/staticCheckFixLoop`; or define the stall union here if import order makes that simpler)
    - `MissingApplicationType { found: string | null }`
    - `BaseServerDown { baseBranch; output }`
  - `export interface ParkDirectives { readonly retry: string; readonly continue: string }`
  - `export function parkDirectives(evidence: ParkEvidence): ParkDirectives` — an exhaustive `switch` with a `never` default, like `classifyStage`.
  - `export const MAX_PARK_OUTPUT_CHARS = 2_000` (per quoted output; keeps a park comment with four failing checks far below GitHub's comment size limit).
  - `export function buildParkComment(adwId: string, evidence: ParkEvidence): string`:
    - a title per reason;
    - `describeFailure(evidence)`, quoting every output through one helper that cuts it at `MAX_PARK_OUTPUT_CHARS` and indents each line;
    - an optional base-branch note;
    - a line saying the workflow is parked as `human_gated` and that each check's full output is in the run's execution log (for check-based reasons);
    - the two directive bullets, each written inline as `` - `## Retry` — … `` so that no line reads as a bare directive;
    - `` **ADW ID:** `…` ``;
    - `ADW_SIGNATURE` (from `../core/workflowCommentParsing`).
  - Keep the heading out of `STAGE_HEADER_MAP` and add a one-line comment saying why (recovery must never treat a park as a stage).
  - Use the directive wording of the test above. For the three reasons not wired here, follow ADR-0060/ADR-0061 literally.
- Run `bunx vitest run adws/forge/__tests__/parkComment.test.ts` until green.

### 7. Write the static-check fix loop core (test first)
- Create `adws/core/__tests__/staticCheckFixLoop.test.ts`. Inputs:
  - a fake check runner that returns a scripted sequence of verdict lists (helpers `red(check, output)`, `green()`) and records how many times it ran;
  - a fake `FixRoundPort` whose `fix` returns scripted `{ diff, costUsd, modelUsage }` per round and records the failed verdicts it was given, and whose `keep`/`discard` record their calls;
  - `buildFixRoundGuardConfig(['javascript'], '')`.

  Cases:
  - **green first**: no round, `fix` never called, result `green` with `rounds: 0`.
  - **changed output continues**: red(lint: A) → round 1 clean diff → red(lint: B) → round 2 clean diff → green. Result `green`, `rounds: 2`, checks ran 3 times, `keep` called for rounds 1 and 2, `discard` never.
  - **stop on identical output**: red(A) → round 1 clean diff → red(A). Result `stalled` with `stall: FixLoopStall.IdenticalOutput`, `rounds: 1`, `failed` equal to the red verdicts, and no second `fix`.
  - **rejected round is no progress**: red(A) → round 1 diff adds `// eslint-disable-next-line`. Result `stalled` with `stall: FixLoopStall.RejectedRound`, the guard reasons, `discard(1)` called, `keep` never, and checks ran exactly once (no re-run after a rejected round). Also a round that touches `tsconfig.json`.
  - **no cap**: twelve rounds, each changing the output, then green. Result `green` with `rounds: 12`. Twelve is above `MAX_TEST_RETRY_ATTEMPTS`; no hidden limit.
  - **only the failing checks reach the fix agent**: passed and skipped verdicts are not passed to `fix`.
  - **cost**: `costUsd` and `modelUsage` are summed over rounds, on green and on stalled.
  - **resume on `## Retry`**: a first run stalls on identical output. A second `runStaticCheckFixLoop` call (what the resumed orchestrator runs after `## Retry`) starts from a fresh check run whose output is identical to the output the first run stalled on, and still starts a round (`fix` is called), because the loop keeps no state between runs. After that round the scripted checks turn green.
  - **errors propagate**: a `fix` that throws (e.g. a `RateLimitError`) rejects the loop with that same error.
  - **report**: the optional `report` callback receives `checks_ran`, `round_kept` and `round_rejected` events in order.
- Create `adws/core/staticCheckFixLoop.ts`:
  - `export interface FixRoundResult { readonly diff: string; readonly costUsd: number; readonly modelUsage: ModelUsageMap }`
  - `export interface FixRoundPort { fix(failed: readonly CheckVerdict[], round: number): Promise<FixRoundResult>; keep(round: number): void | Promise<void>; discard(round: number): void | Promise<void> }`
  - `export enum FixLoopStall { IdenticalOutput = 'identical_output', RejectedRound = 'rejected_round' }`
  - `export type FixLoopEvent = { kind: 'checks_ran'; round: number; verdicts } | { kind: 'round_kept'; round } | { kind: 'round_rejected'; round; reasons }` (readonly fields).
  - `export type StaticCheckFixLoopResult = { kind: 'green'; verdicts; rounds; costUsd; modelUsage } | { kind: 'stalled'; stall: FixLoopStall; failed: readonly CheckVerdict[]; rejections: readonly GuardRejection[]; rounds; costUsd; modelUsage }`
  - `export interface StaticCheckFixLoopInput { readonly runChecks: () => Promise<readonly CheckVerdict[]>; readonly fixRounds: FixRoundPort; readonly guardConfig: FixRoundGuardConfig; readonly report?: (event: FixLoopEvent) => void }`
  - `export async function runStaticCheckFixLoop(input): Promise<StaticCheckFixLoopResult>`:
    - run the checks and report `round 0`;
    - loop while any verdict is `Failed`, with no counter limit;
    - extract `runRound(…)` (fix → `evaluateFixRound` → rejected: `discard`, return stalled; accepted: `keep`, run the checks, report) so nesting stays at most 2;
    - after an accepted round: no failure → green; `combinedCheckOutput(next) === combinedCheckOutput(previous)` → stalled `IdenticalOutput`; else continue.
  - State the no-cap invariant in one comment: the loop has no round limit by decision; only a round that makes no progress ends it. Cite ADR-0059 by number only if the codebase's comment style allows; otherwise state the rule.
  - Imports: `./checkRunner`, `./fixRoundGuard`, and the `ModelUsageMap` type plus `mergeModelUsageMaps`/`emptyModelUsageMap` from `../cost` (as `phaseRunner.ts` does). No agent, git, forge, logger or state imports.
- Run `bunx vitest run adws/core/__tests__/staticCheckFixLoop.test.ts` until green.
- Export `runStaticCheckFixLoop`, `FixLoopStall` and the types from `adws/core/index.ts`.

### 8. Write the real fix-round port (test first)
- Create `adws/phases/__tests__/staticCheckFixRound.test.ts`. Inject a fake `git` (records calls; `headShort` returns scripted values; `commitChanges` returns `true`/`false`; `diff` returns a scripted diff) and a fake `runResolveTestAgent` (records each `TestResult`, returns `{ success: true, output: '', totalCostUsd: 0.5, modelUsage: {…} }`). Config: a minimal `WorkflowConfig` cast (`issueNumber`, `adwId`, `issue.body`, `issueType`, `worktreePath`, `branchName`, `logsDir`, a temp-dir `orchestratorStatePath`). Cases:
  - **`fix` order**: `headShort(worktreePath)` → `pushBranch(branchName, worktreePath)` → the agent once for the round, handed every failed verdict in check order → `commitChanges(<round message>, worktreePath)` → `diff('--no-renames <base> HEAD', worktreePath)`. It returns that diff and the agent's cost and model usage. Two failing checks in one round still mean one agent call.
  - **the agent input**: one `TestResult` per round. `test_name` is `static-checks-round-<n>`, `execution_command` lists each failing check's command, one per line, `passed: false`, `test_purpose` names the failing checks and says each passes on exit 0, and `error` holds one section per failing check, in check order, with its name, command, exit code and output.
  - **output cap**: an output longer than `MAX_FIX_PROMPT_OUTPUT_CHARS` is cut to that length plus a marker line telling the agent to run the command for the rest. A shorter output passes unchanged.
  - **commit message**: starts with `buildCommitPrefix('static-check-fix-agent', issueType)` and names the round and the failing checks.
  - **interrupted round**: an agent that throws → `fetchAndResetToRemote(branchName, worktreePath)` is called, then the original error is rethrown. A failing reset during that cleanup is logged and does not mask the original error.
  - **`keep`** → `pushBranch(branchName, worktreePath)`.
  - **`discard`** → `fetchAndResetToRemote(branchName, worktreePath)`, then `headShort(worktreePath)` is compared with the round's base. If they differ (the agent pushed its own commit), it throws an error naming the branch and both commits.
- Create `adws/phases/staticCheckFixRound.ts`:
  - `export const MAX_FIX_PROMPT_OUTPUT_CHARS = 20_000` (keeps four checks' outputs well under Linux's 128 KiB single-argument limit).
  - `export function toStaticCheckFailure(failed: readonly CheckVerdict[], round: number): TestResult` — the one input of a round's agent run.
  - `export interface StaticCheckFixRoundDeps { readonly git: Pick<GitContext, 'headShort' | 'pushBranch' | 'commitChanges' | 'diff' | 'fetchAndResetToRemote'>; readonly runResolveTestAgent: typeof runResolveTestAgent }`
  - `export function buildStaticCheckFixRoundPort(config: WorkflowConfig, deps: Partial<StaticCheckFixRoundDeps> = {}): FixRoundPort`:
    - default `git` = `requireWorkflowGitContext(config)`, resolved inside the function;
    - default agent = `runResolveTestAgent`, imported from `'../agents/testAgent'` (not the barrel);
    - per agent call: `AgentStateManager.initializeState(adwId, 'static-check-fix-agent', orchestratorStatePath)`, `cwd: worktreePath`, `issueBody: issue.body`, `launchContext: workflowLaunchContext(config)`;
    - remember the round base per round number, for `discard`'s verification.
  - Use typed `GitContext` methods only. The guard flags any `git …` string-literal first argument.
  - Comment the invariants:
    - the round base is pushed before the agent runs, so the remote branch is the restore point;
    - `commitChanges` runs before the diff, so files the agent created are judged too;
    - `discard` fails closed when HEAD is not the round base.
- Run `bunx vitest run adws/phases/__tests__/staticCheckFixRound.test.ts` until green.

### 9. Write the park handler (test first)
- Create `adws/phases/__tests__/workflowPark.test.ts`. Setup:
  - a unique adwId (`park-test-${Date.now()}`), with `agents/<adwId>` removed in `afterEach`, as in `topLevelState.test.ts`;
  - a temp `orchestratorStatePath`;
  - a fake `repoContext.issueTracker.commentOnIssue` (`vi.fn`);
  - a `process.exit` spy that throws a sentinel.

  Cases:
  - writes `workflowStage: 'human_gated'` to the top-level state;
  - posts exactly `buildParkComment(adwId, evidence)` on `issueNumber`;
  - appends a line naming the reason to `execution.log`;
  - calls `process.exit(0)`;
  - a throwing `commentOnIssue` is logged and still parks and exits;
  - no `repoContext` → state written, no comment, exit 0;
  - the stage written is exactly what `decideRetryAction` turns into `rearm_phase_timeout` (import it from `adws/triggers/retryHandler`). This ties the park to `## Retry`.
- Create `adws/phases/workflowPark.ts`: `export function parkWorkflow(config: Pick<WorkflowConfig, 'adwId' | 'issueNumber' | 'orchestratorStatePath' | 'repoContext'>, evidence: ParkEvidence): never`, in this order:
  1. `log(…, 'warn')`;
  2. `AgentStateManager.appendLog`;
  3. `AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'human_gated' })`;
  4. post the comment through `repoContext.issueTracker.commentOnIssue` inside try/catch;
  5. `process.exit(0)`.

  Comment why the stage is written before the comment: an observer that reads state after seeing the comment must find `human_gated`. Do not move the board and do not label: the existing human-gated parks (`review_failed`, resume-cap escalation) do neither.

### 10. Move the static-check gate, wire the loop and the park into the unit-test phase (test first)
- Rewrite the superseded cases in `adws/phases/__tests__/unitTestPhase.test.ts`. Keep the green-check, order, worktree, N/A and unit-test hard-fail cases. Infrastructure:
  - inject a fake `fixRounds: FixRoundPort` through the new dep;
  - use a scripted `runProcess` whose outcome per command can change per call (e.g. a queue per command);
  - use a fake `repoContext` (`issueTracker: { moveToStatus: vi.fn(async () => {}), commentOnIssue: vi.fn(), applyLabel: vi.fn() }`);
  - give each test a unique adwId and remove `agents/<adwId>` afterwards.

  Replace the old red-check cases with these, run for both `unitTests: true` and `false`:
  - **a red check the loop fixes**: lint red then green after round 1 → the phase completes; `fix` was given the lint verdict; the test run starts only after the checks are green (`unitTests: true`); the phase cost includes the round's cost.
  - **a stalled loop parks**: lint red with identical output after round 1 → `process.exit(0)`; the top-level state is `human_gated`; one comment on the issue headed `ADW Parked`, naming `lint` and its command, quoting the lint's output and containing `` `## Retry` ``; `execution.log` holds the lint output; the test run never starts; `ctx.errorMessage` is not set; no `ADW Workflow Error` comment.
  - **a rejected round parks**: the fake port returns a diff that adds `// @ts-ignore` → `discard` called, the comment lists the rejection, and the phase parks.
  - **resume on `## Retry`**: park as above; assert `decideRetryAction(readTopLevelState(adwId).workflowStage)` is `rearm_phase_timeout`; then re-enter `executeUnitTestPhase` with the same fakes. Its first check run prints exactly what it printed when the loop stalled, and a new round still starts; after that round the checks turn green and the phase completes, as the resumed orchestrator's re-run does.
  - **guard configuration from the repository**: with `commands.suppressionPatterns = '- `@acme-off`'`, a round adding `// @acme-off` is rejected.
- Create `adws/phases/staticCheckGate.ts`:
  - move `describeFailedCheck`, `logCheckVerdict` and the gate from `unitTestPhase.ts`, with their log lines unchanged;
  - `export interface StaticCheckGateDeps { readonly runProcess: ProcessRunner; readonly fixRounds?: FixRoundPort }`
  - `export interface StaticCheckGateResult { readonly costUsd: number; readonly modelUsage: ModelUsageMap; readonly fixRounds: number }`
  - `export async function runStaticCheckGate(config: WorkflowConfig, deps: StaticCheckGateDeps): Promise<StaticCheckGateResult>`:
    - `log('Phase: Static Checks')` + `appendLog`;
    - `runChecks` = `runStaticChecks(config.projectConfig.commands, config.worktreePath, deps.runProcess)` with every verdict logged;
    - first run green → zero result;
    - otherwise build the guard configuration lazily:
      - `inferStackLanguages({ testFramework, bddFramework, runTests, runScenariosByTag })` from `config.projectConfig`;
      - `buildFixRoundGuardConfig(languages, commands.suppressionPatterns)`;
      - log each `ignoredAdditions` entry as a warning;
    - get the port lazily (`deps.fixRounds ?? buildStaticCheckFixRoundPort(config)`);
    - call `runStaticCheckFixLoop` with a `report` that logs the events: round start with the failing checks, every guard rejection via `describeGuardRejection`, kept rounds, and each later check run, with full output for failed checks;
    - green → log `Static checks green after N fix round(s)` and return the cost;
    - stalled → `parkWorkflow(config, { reason: ParkReason.FixLoopStalled, failedChecks: failed.map(v => ({ check: v.check, command: v.command, exitCode: v.exitCode, output: v.output })), stall, rounds, rejections: rejections.map(describeGuardRejection) })`.
  - Avoid running the first check run twice: either let the loop own the first run (the gate checks the loop's `rounds === 0` green result), or hand the first verdicts to the loop. Choose one, keep it simple, and keep the "four checks ran" assertions of the existing tests true.
  - Import `checkRunner`, the guard, the loop and the stack inference directly from their module files, not from the `'../core'` barrel (several tests mock `../core` wholesale; #988 did the same).
- In `adws/phases/unitTestPhase.ts`:
  - delete the moved functions;
  - extend `UnitTestPhaseDeps` with `readonly fixRounds: FixRoundPort`;
  - call `const gate = await runStaticCheckGate(config, { runProcess: deps.runProcess ?? runShellCommand, fixRounds: deps.fixRounds })`;
  - add `gate.costUsd` to the returned `costUsd`, and merge `gate.modelUsage` into `modelUsage` and into the `createPhaseCostRecords` model usage;
  - update the header comment: the static checks always run first, a red check goes to the static-check fix loop, a stalled loop parks the workflow as `human_gated`, and `unitTests: false` skips only the unit-test run;
  - keep `endRunOnFailedGate` for the unit-test hard-fail path only. Keep the file under 300 lines and nesting at most 2.
- Run `bunx vitest run adws/phases/__tests__/unitTestPhase.test.ts adws/phases/__tests__/workflowPark.test.ts` until green. Then run `bunx vitest run adws/__tests__/adwChore.test.ts adws/__tests__/adwPlanBuildReview.test.ts adws/__tests__/adwPlanBuildTestReview.test.ts` to confirm the injectable orchestrators still compile and pass.

### 11. Finish the core barrel exports
- Confirm `adws/core/index.ts` exports everything added in tasks 1, 2, 5 and 7, with types in `export type { … }` lines and values in `export { … }` lines, next to the `checkRunner` lines. The phase modules keep importing from module paths directly.

### 12. Add the no-suppression rule to the fix prompt
- In `.claude/commands/resolve_failed_test.md`:
  - **Step 1** (Analyze): add that a static-check round hands over every failing static check (type check, additional type checks, lint, build) at once: `execution_command` holds each failing check's command from `.adw/commands.md`, one per line, and `error` holds one section per failing check with its output, cut short when long. Run each command to see all of it, and fix every listed check.
  - **Step 4** (Fix the Issue): add a **Never silence a failure** rule. Fix the cause in the code, and do not:
    - add a comment that suppresses a check: `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `# noqa`, `# type: ignore`, `# pylint: disable`, `//nolint`, `#[allow(…)]`, `# rubocop:disable`, or the equivalent for any other tool;
    - edit lint, compiler or build configuration (`eslint.config.*`, `.eslintrc*`, `tsconfig*.json`, `package.json`, `pyproject.toml`, `setup.cfg`, `.golangci.*`, `Cargo.toml` and the like), `.adw/commands.md`, or the Playwright configuration in `features/`;
    - skip, delete or weaken a failing test or its assertion.
  - **Then**: do not commit or push; ADW commits each round itself. ADW checks the diff of every static-check fix round. A round that adds a suppression comment or touches one of those files is rejected and reverted, and the run stops for a human.
- Keep `target: false`, the `$ARGUMENTS` input section and the Report section. Name no branch (the `lint:branch-names` guard scans `.claude/commands/`).

### 13. Preserve `## Suppression Patterns` in `adw_init`
- In `.claude/commands/adw_init.md` step 2 (the `.adw/commands.md` section list), after `## Test Framework`, add a bullet for `## Suppression Patterns`:
  - **If `.adw/commands.md` already has this section, preserve it verbatim**; never create, populate or reorder it.
  - It holds the repository owner's own additions to ADW's suppression-pattern table, one pattern per line. ADW's framework table always applies as well, and a line starting with `!` is ignored.
  - Mirror the existing "preserve it verbatim" wording of `## Run Tests`.
- Do not touch the `.github/adw.yml` heredoc or the Comments entry, which `adws/__tests__/adwInitPrompt.test.ts` guards. Name no branch.

### 14. Rewrite ADR-0059's `### Confirmation`
- In `specs/adr/0059-fix-loops-no-progress-stop-and-suppression-guard.md`, replace "Not yet implemented; …" with "Partly implemented. Checked on <date> at `<short hash>`:", followed by bullets:
  - `adws/core/fixRoundGuard.ts` (`evaluateFixRound`, `buildFixRoundGuardConfig`) with the table in `adws/core/fixRoundGuardTable.ts`:
    - rejects a fix round whose diff adds a framework suppression pattern of the repository's language (`javascript`, `python`, `go`, `rust`, `ruby`; language from `inferStackLanguages` over the `.adw/` stack descriptors) or a pattern from `## Suppression Patterns` in `.adw/commands.md`;
    - rejects a round that touches lint, compiler or build configuration, `.adw/commands.md` or `features/playwright.config.*`;
    - repository entries can only add, and a `!` entry is ignored.
    - Unit tests: `adws/core/__tests__/fixRoundGuard.test.ts` (every framework pattern per language, additions, removal attempts, every protected path, clean diff) and `adws/core/__tests__/unifiedDiff.test.ts`.
  - `adws/core/staticCheckFixLoop.ts` (`runStaticCheckFixLoop`):
    - no cap; no progress means `combinedCheckOutput` identical to the previous run, or a rejected round, which `adws/phases/staticCheckFixRound.ts` reverts by resetting to the round base on the remote, failing closed if it cannot.
    - Unit tests: `adws/core/__tests__/staticCheckFixLoop.test.ts` (fake check runner and fake fix agent with scripted diffs: identical output stops, rejected round is no progress, changed output continues, resume after `## Retry`) and `adws/phases/__tests__/staticCheckFixRound.test.ts`.
  - `adws/phases/staticCheckGate.ts` runs the loop in `executeUnitTestPhase`:
    - a stalled loop parks the workflow as `human_gated` through `adws/phases/workflowPark.ts`, with the `fix_loop_stalled` comment of `adws/forge/parkComment.ts`, which names the failing checks, quotes their output and says what `## Retry` and `## Continue` do;
    - `## Retry` re-arms it to `phase_timeout` (`decideRetryAction`), and the resumed orchestrator re-runs the unit-test phase and the loop.
    - Unit tests: `adws/phases/__tests__/unitTestPhase.test.ts`, `adws/phases/__tests__/workflowPark.test.ts`, `adws/forge/__tests__/parkComment.test.ts`.
  - `.claude/commands/resolve_failed_test.md`, the fix prompt, forbids suppression: `grep -n "Never silence a failure" .claude/commands/resolve_failed_test.md` finds the rule.
  - Still open: the reviewer treating a suppression as a blocker (`review.md`, carried by the PRD's prompt work). The unit-test and scenario fix loops keep their caps by decision (`adws/agents/testRetry.ts`, `adws/phases/scenarioTestFixLoop.ts` unchanged).
- Keep `### Confirmation` as an h3 in place. Do not edit the decision, the drivers or the front matter.
- In `specs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md` `### Confirmation`, change the second bullet's "A red check ends the run as a hard-failed unit-test run does, with the check's output in the execution log, until the fix loop of ADR-0059 lands" to say that a red check goes to the static-check fix loop of ADR-0059, with the check's output in the execution log. Nothing else in that ADR changes.

### 15. Update the README
- Line 11 bullet: replace "and a red check ends the run with the check's output in the log" with a description of the loop:
  - a red check goes to a static-check fix loop with no cap (`adws/core/staticCheckFixLoop.ts`);
  - every round is judged by a pure fix-round guard (`adws/core/fixRoundGuard.ts`) that rejects and reverts suppression comments (a framework table by language plus `## Suppression Patterns` additions in `.adw/commands.md`) and edits to lint, compiler or build configuration, `.adw/commands.md` or `features/playwright.config.*`;
  - the loop stops when a round makes no progress (identical check output or a rejected round) and parks the workflow as `human_gated` with a park comment (`adws/forge/parkComment.ts`); `## Retry` continues it.
  - Keep the rest of the bullet.
- Directory tree, in alphabetical position:
  - `adws/core/`: `fixRoundGuard.ts`, `fixRoundGuardTable.ts`, `staticCheckFixLoop.ts`, `unifiedDiff.ts`;
  - core `__tests__`: `fixRoundGuard.test.ts`, `staticCheckFixLoop.test.ts`, `unifiedDiff.test.ts`;
  - `adws/forge/`: `parkComment.ts`;
  - `adws/phases/`: `staticCheckFixRound.ts`, `staticCheckGate.ts`, `workflowPark.ts`;
  - phases `__tests__`: `staticCheckFixRound.test.ts`, `workflowPark.test.ts`;
  - forge `__tests__`: `parkComment.test.ts`, if the tree lists that directory.
  - Change the `unitTestPhase.ts` description to "static-check gate with its fix loop (always), then the unit-test run (unless `unitTests: false`)".

### 16. Write the step definitions for `@adw-989`
- The `@adw-989` scenarios are all of `features/per-issue/feature-989.feature` plus the two re-tagged scenarios of `features/per-issue/feature-988.feature` (issues 9882 and 9884). Write their step definitions in `features/per-issue/step_definitions/feature-989*.ts`, with helpers split into `feature-989-*.ts` modules to stay under 300 lines. Do not edit either feature file.
- Reuse, never redefine (Cucumber fails on an ambiguous step):
  - the Background step `the ADW codebase is checked out` from `features/regression/step_definitions/givenSteps.ts`;
  - #988's phase steps in `feature-988-phase.steps.ts`: `a workflow for issue {int} whose worktree's {string} configures these static checks, in this order:`, `the worktree's {string} holds:`, `the test agent writes a JUnit report in which every unit test passes`, `the workflow's unit-test phase runs`, `the unit-test phase completed`, `the unit-test phase ended the workflow with exit code {int}`, `the workflow's execution log holds {string}` and `the unit-test phase posted a comment headed {string} on issue {int}`;
  - #988's commands-file helpers, recording process runner and shared state `s`; #929's `createWorkflow`, `commitFile`, throwaway CLI (`failingTestRuns` drives the unit-test cap scenario) and `commentsOn`; #796's recording providers. Export what the `@adw-989` steps need from #988's step files (e.g. the phase runner that traps `process.exit`) instead of copying it.
- Hooks: #988's `Before`/`After` hooks are tagged `@adw-988`, so they do not run for `feature-989.feature`. The `@adw-989` hooks must also reset and clean up the shared state (reset `s` and `world796`, restore the throwaway CLI and `ADW_UNIT_TEST_REPORT_PATH`, remove the temp dirs and `agents/<adwId>`/`logs/<adwId>`), and must be idempotent, because the two re-tagged scenarios carry both tags and run both hook sets.
- The fix-round port of the phase scenarios:
  - extend the shared step `the workflow's unit-test phase runs` minimally so it passes `fixRounds` when an `@adw-989` step prepared one (a field of the shared state, unset by default, so the `@adw-988`-only scenarios run exactly as before);
  - prepare the real `buildStaticCheckFixRoundPort(workflow.config, { runResolveTestAgent: scriptedAgent })`, so the real commit, diff, push and discard run. Scenarios 9895/9896 (the rejected change is not left in the worktree) and 9897 (a change committed before the round is not judged) depend on it;
  - in the throwaway worktree, check out a branch named `config.branchName` and add a local bare repository as `origin`, so `pushBranch` and `fetchAndResetToRemote` work;
  - commit the scenario's setup files (`.adw/commands.md`, `.github/adw.yml`, the `.adw/` stack descriptors) with `commitFile` before the phase runs. Otherwise the first round's `commitChanges` sweeps `.adw/commands.md` into the round, and the guard rejects it.
- The scripted fix agent (`the static-check fix agent's rounds go as follows:`, `the static-check fix agent's rounds change nothing`): on its n-th call it records the `TestResult` it was handed and how many throwaway-CLI runs exist so far, applies round n's change to the worktree (`adds "<line>" to "<file>"`), and switches what each check with a column for that round prints afterwards. Keep that switch outside the worktree: before the setup commit, rewrite the check's command so it prints the content of, and exits with the code in, files in a temp directory that the agent rewrites. The switch is then never part of a round's diff. A check without a column keeps its output.
- Counting and order:
  - "the static-check fix agent was started N time(s)" counts the scripted agent's calls: one per round, however many checks fail;
  - rounds are numbered by the agent's calls across the whole scenario, including across a park and a resume; the loop's own round counter starts again at 1 in a resumed run;
  - "round N was handed the failing check X with the output Y" reads the section for X in the `TestResult` recorded for call N;
  - "the test agent was not started" and "the test agent was started once, after the last static-check fix round" read the throwaway CLI's `/test` runs and compare them with the CLI-run counts the agent recorded;
  - "the test agent was started as many times as the unit-test fix loop's cap allows" derives the count from `MAX_TEST_RETRY_ATTEMPTS` and what `runUnitTestsWithRetry` does when every run's report fails.
- Park assertions: "parked as human_gated" reads `AgentStateManager.readTopLevelState(adwId).workflowStage`; "the unit-test phase did not complete" is the trapped `process.exit(0)`; the park comment is the comment headed `ADW Parked` in `commentsOn(issueNumber)` (`isHeaded`); "no park comment was posted" means there is none.
- `## Retry` (issue 9898): the Given step runs the phase once and asserts the park. "`## Retry` is posted" calls `handleRetryDirective` (or `decideRetryAction` plus the top-level state write it implies) with recording deps. "The resumed workflow's unit-test phase runs" runs the phase again with the same port and agent script, so the lint's first output equals the one the loop stopped on. The fix-agent and CLI records span both runs.
- Guard scenarios call `inferStackLanguages`, `buildFixRoundGuardConfig` and `evaluateFixRound` directly:
  - build the `StackCoherenceInput` from the two named descriptors only, with `runTests` and `runScenariosByTag` empty, so no default command adds a language (the Elixir scenarios need an empty language set);
  - "the repository's .adw/commands.md lists these entries as its own suppression patterns" becomes a `## Suppression Patterns` body with one `- <entry>` bullet per row;
  - "adds the line …", "creates", "edits" and "deletes" become a modified-file diff with that added line, a new-file diff, a modified-file diff and a deleted-file diff; a doc-string diff is used as given;
  - "rejects the fix round with a reason that names <path>" checks the `describeGuardRejection` lines.
- Park-builder scenarios build `ParkEvidence` from the table and fill the fields the table leaves out (a check's command and exit code) with sample values. The directive assertions read `parkDirectives(evidence)` and find its lines in the comment. "ADW would take none of them … for a directive" checks `isRetryComment`, `isActionableComment` and `isCancelComment` on each comment.
- Cucumber expressions treat `/` as alternation: use `{string}` for quoted paths or escape the slash.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-989"` and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-988"` until both are green.

### 17. Run the validation commands
- Run every command in `Validation Commands` and fix any failure before finishing.

## Testing Strategy
### Unit Tests
- `adws/core/__tests__/unifiedDiff.test.ts`:
  - modified, new, deleted, binary and mode-only entries;
  - `+++`/`---` content lines inside hunks;
  - quoted paths, no-newline markers, empty diff.
- `adws/core/__tests__/fixRoundGuard.test.ts`:
  - every framework pattern per language, by iterating `FRAMEWORK_SUPPRESSION_PATTERNS` and each entry's `example`;
  - language keying; net counting (removed, edited in place, added); case and whitespace insensitivity;
  - repository additions honoured; `!` removal attempts ignored and reported; removals worded as `-@ts-ignore` or `allow: @ts-ignore` read as additions; duplicates not doubled;
  - `parseSuppressionPatternAdditions` formats;
  - every protected path, by iterating `PROTECTED_PATH_RULES` and their `example`s: created, modified, deleted, nested for basename rules; repo-path rules exact;
  - clean and empty diffs pass; several reasons together; `describeGuardRejection`.
- `adws/core/__tests__/staticCheckFixLoop.test.ts` (fake check runner, fake fix agent with scripted diffs):
  - green first; changed output continues; stop on identical output;
  - rejected round is no progress (discarded, not kept, no check re-run);
  - no cap (12 rounds); only failing checks reach the agent;
  - cost summed; resume on `## Retry` (a fresh run starts a round although its first output equals the stalled output); errors propagate; report events.
- `adws/phases/__tests__/staticCheckFixRound.test.ts` (fake git, fake agent):
  - order of operations, with one agent run per round handed every failing check; `TestResult` mapping; output cap; commit message;
  - interrupted round discarded and error rethrown;
  - keep pushes; discard resets and fails closed when HEAD is not the base.
- `adws/phases/__tests__/workflowPark.test.ts`:
  - `human_gated` written; exact comment posted; execution log line; `process.exit(0)`;
  - comment failure non-fatal; no repo context;
  - the stage maps to `rearm_phase_timeout` under `## Retry`.
- `adws/forge/__tests__/parkComment.test.ts`:
  - every reason: heading, failure description, base-branch note where applicable, both directive meanings, ADW ID, signature;
  - `fix_loop_stalled` identical-output and rejected-round variants;
  - never a lifecycle stage; adwId extractable; no bare directive line, even when a quoted output holds one; outputs quoted and cut at `MAX_PARK_OUTPUT_CHARS`.
- `adws/phases/__tests__/unitTestPhase.test.ts` (rewritten red-check cases):
  - loop fixes → phase completes and tests run after;
  - stalled → park (`human_gated`, comment quoting the output, exit 0, no test run, no error comment);
  - rejected round → park with reasons;
  - resume after `## Retry` → a new round starts on the unchanged output and continues to green;
  - repository addition applied; `unitTests: false` still gates.
  - The hard-failed unit-test run still exits 1.
- `adws/core/__tests__/checkRunner.test.ts` (`combinedCheckOutput`), `adws/core/__tests__/stackCoherenceCheck.test.ts` (`inferStackLanguages`), `adws/core/__tests__/projectConfigCommands.test.ts` (`## Suppression Patterns`).
- Unchanged and still passing: `adws/agents/testRetry.ts` and `adws/phases/scenarioTestFixLoop.ts` behaviour (caps), `adws/triggers/__tests__/retryHandler.test.ts`, the injectable orchestrator tests.

### Edge Cases
- **Edited line that keeps an existing suppression** (`foo(); // eslint-disable-line` → `bar(); // eslint-disable-line`): net count 0, accepted. A suppression moved to another file is rejected (counting is per file).
- **The agent creates a new config file**, e.g. a nested `src/.eslintrc.json` overriding rules: caught, because the round is committed (`git add -A`) before the diff and basename rules match at any depth.
- **Rename of a protected file** (`tsconfig.json` → `tsconfig.old.json`): `--no-renames` shows a delete and an add, and both paths are judged.
- **The agent commits itself**: the diff runs from the round base to HEAD, so its commits are judged. **The agent pushes a rejected commit**: `discard` sees HEAD ≠ base after the reset and fails closed with an error. The run ends with an error comment, and no suppression survives.
- **Rate limit, timeout or auth expiry during a round**: the port discards the partial round, then rethrows. `runPhase` waits and re-runs the phase (fresh checks, fresh loop), or the orchestrator pauses or times out as today.
- **A round changes nothing**: `commitChanges` returns `false`, the diff is empty, the guard accepts, the checks re-run with identical output, and the workflow parks.
- **Output oscillating between two states, or carrying timings**: never identical, so the loop runs on (accepted in ADR-0059; `## Cancel` is the escape hatch).
- **Huge lint output**: capped at `MAX_FIX_PROMPT_OUTPUT_CHARS` per check in the prompt, with a marker; the full text stays in `execution.log`. The park comment quotes at most `MAX_PARK_OUTPUT_CHARS` per output, with a marker pointing to `execution.log`.
- **Several checks red at once**: one agent run per round handles all of them, so the round's diff is what that one run changed, and progress is judged on the combined output (a round that leaves one check's output as it was but changes another's is progress).
- **Uncommitted changes at round start**: the round's `commitChanges` sweeps them into the round, where the guard judges them. The phases before the unit-test phase commit their work; the BDD harness must commit its setup files (task 16).
- **Repository additions**: an `N/A` body or HTML comments mean no additions. `!eslint-disable` is ignored and logged. An addition identical to a framework pattern is not doubled. Additions apply even when no language is detected.
- **No detected language**: only the protected paths and the repository additions apply (ADR-0059: "a language with no table entry gets the configuration-file guard and the reviewer only").
- **Polyglot or incoherent stack**: the patterns of every detected language apply. That is a superset, never weaker.
- **Self-host** (ADW's own repo): the guard table and the fix prompt contain pattern literals. A fix round that adds such a line to `fixRoundGuardTable.ts` is rejected and the run parks for a human.
- **`unitTests: false`**: the gate and the loop still run; only the test run is skipped.
- **Green first run** (every regression surface row and smoke run): no guard, no git port, no push. Behaviour is identical to #988.
- **Park inside `adwTest` (named phase `test`)**: the phases-map entry stays `running` and the top-level stage is `human_gated`. On resume the phase is not "completed", so it re-runs. In `adwPrReview` the park uses `config.base` (the issue's adwId, the PR's source branch).
- **Reset-from-remote takeover after `## Retry`** (unhealthy worktree): kept rounds were pushed, so no accepted fix is lost.
- **The park comment and the webhook**: the comment is ADW's own `issue_comment`. It never contains a bare `## Retry`/`## Continue`/`## Cancel` line, so it cannot trigger a directive.

## Acceptance Criteria
- `evaluateFixRound` rejects a fix round that adds any pattern of the framework table for the repository's language (every entry of every language, proven by iterating the table), or that creates, edits or deletes any protected path (every rule, proven by iterating the rules). The loop treats such a round as no progress: it discards the round, keeps nothing, does not re-run the checks, and parks.
- A `## Suppression Patterns` addition in `.adw/commands.md` is honoured. An entry that tries to remove a framework pattern (`!pattern`) has no effect and is reported in `ignoredAdditions`.
- The loop has no round limit. When an accepted round leaves `combinedCheckOutput` identical to the previous run, the workflow parks as `human_gated` (top-level `workflowStage`) with a comment that names each failing check (with command and exit code), quotes a bounded excerpt of its output, and says what `## Retry` and `## Continue` do. `## Retry` re-arms it to `phase_timeout`, and re-entering the unit-test phase re-runs the checks and continues the loop: it starts a new round even when the checks print what they printed when the loop stopped.
- `buildParkComment` produces the comment for all five reasons, each with its failure description, a base-branch note where applicable, and both directive meanings. Only `fix_loop_stalled` is wired.
- `.claude/commands/resolve_failed_test.md` forbids suppression comments, configuration edits and test weakening. The unit-test and scenario fix loops (`testRetry.ts`, `scenarioTestFixLoop.ts`) are unchanged and keep their caps.
- The unit tests listed under *Testing Strategy* exist and pass, including the guard, loop and park-builder tests the issue names.
- ADR-0059's `### Confirmation` names the implemented guard, loop, park, prompt rule and their tests. ADR-0058's interim bullet no longer says a red check ends the run.
- `executeUnitTestPhase` still runs the static checks whatever `unitTests` says. A green first run behaves exactly as before, and the `@regression` suite passes.
- Lint, both type checks, the unit suite, the build, the git/gh guard, the branch-name guard, the model-literal guard and the docs-index gate pass. The `@adw-989` scenarios pass, those of `feature-989.feature` and the two re-tagged scenarios of `feature-988.feature`, and the `@adw-988` scenarios still pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/core/__tests__/unifiedDiff.test.ts adws/core/__tests__/fixRoundGuard.test.ts adws/core/__tests__/staticCheckFixLoop.test.ts adws/core/__tests__/checkRunner.test.ts adws/core/__tests__/stackCoherenceCheck.test.ts adws/core/__tests__/projectConfigCommands.test.ts` — guard, diff parser, loop and foundation tests pass
- `bunx vitest run adws/forge/__tests__/parkComment.test.ts adws/phases/__tests__/staticCheckFixRound.test.ts adws/phases/__tests__/workflowPark.test.ts adws/phases/__tests__/unitTestPhase.test.ts` — park builder, real port, park handler and phase tests pass
- `bunx vitest run adws/triggers/__tests__/retryHandler.test.ts adws/__tests__/adwChore.test.ts adws/__tests__/adwPlanBuildReview.test.ts adws/__tests__/adwPlanBuildTestReview.test.ts` — `## Retry` handling and the injectable orchestrators still pass
- `grep -n "Never silence a failure" .claude/commands/resolve_failed_test.md` — the fix prompt carries the rule
- `git diff --quiet origin/HEAD -- adws/agents/testRetry.ts adws/phases/scenarioTestFixLoop.ts adws/phases/scenarioFixPhase.ts` — the capped fix loops are untouched (exits 0)
- `bun run lint` — Run Linter
- `bunx tsc --noEmit` — Type Check
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional Type Checks
- `bun run test:unit` — full unit suite, zero regressions
- `bun run build` — Run Build
- `bun run lint:git-guard` — the new port uses typed `GitContext` methods only, with no `git …` shell-out
- `bun run lint:branch-names` — the edited prompts and new `adws/` code name no branch
- `bun run lint:model-literals` — no model literal introduced
- `bun run lint:docs-index` — the conditional-docs index stays healthy
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-989"` — this issue's scenarios pass, including the two re-tagged scenarios of `feature-988.feature`
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-988"` — #988's scenarios still pass with the extended shared phase step
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite passes (green fixture checks never enter the loop; surface rows 06/20 and the smoke runs unchanged)

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md` strictly:
  - guard clauses and nesting ≤ 2 (hence `runRound`, `protectedPathRejections`, `suppressionRejections`, `describeFailure`, `parkDirectives`);
  - string enums for named sets (`ParkReason`, `FixLoopStall`, `ProtectedPathCategory`, `PathScope`, `PatternSource`); `readonly` everywhere; no `any`;
  - pure core modules with side effects only in `staticCheckFixRound.ts`, `staticCheckGate.ts` and `workflowPark.ts`;
  - comments only for invariants, ordering and non-obvious reasons (no restating, no issue numbers, no banners); files under 300 lines.
- **No new library.** If one were needed, `.adw/commands.md` says `bun add <package>`.
- **Fix agent choice.** The loop reuses `/resolve_failed_test` through `runResolveTestAgent`, once per round, handed every failing check of that round. Reasons:
  - before #988 that prompt was what fixed static-check failures (`linting`, `typescript_check`, `app_build`), so "the fix prompt gains the rule" lands there;
  - ADR-0059 lets the prompt rule cover every fix round;
  - no new slash command, model routing entry or agent runner is needed;
  - the loop is check runner → fix agent → guard → check runner: one agent run per round means the guard judges exactly what that run changed, and one agent sees every failure at once.
  The unit-test loop's code and cap are untouched; it only reads the stricter prompt.
- **Output in the park comment.** The park comment quotes a bounded excerpt of each failing output, because the PRD (user story 7) wants a stalled park to say what failed so that the operator knows what to do without reading logs, and the `@adw-989` scenarios require the quote. Lint or build output can carry absolute paths, so the excerpt is cut at `MAX_PARK_OUTPUT_CHARS` and the full output stays in `execution.log`. #988's error comment for the unit-test hard-fail path keeps names and exit codes only.
- **Why push at round start and reset to the remote.** `GitContext` exposes no local `reset --hard <sha>`, `resetWorktree` runs `git clean -fdx` (it would delete `node_modules`), and the git/gh guard forbids `gitCtx.exec('git …')`. Pushing the round base, then `fetchAndResetToRemote(branchName)` on rejection, is the only exact revert built from typed methods. The HEAD check after the reset makes it fail closed if the agent pushed (agents may push; only force pushes are denied). As a side effect, every kept round is on the remote, so a reset-from-remote takeover after `## Retry` loses nothing. A target repository whose pre-commit hook rejects the round commit surfaces as a workflow error, as any commit failure does today.
- **The park exits with `process.exit(0)`**, like `handlePhaseTimeout`. The spawn lock is reclaimed by liveness (`orchestratorLock.ts`). The phase's cost records are not posted to D1 on that path, as on the other abnormal exits. The cost of a fix loop that ends green is part of the phase's result and cost records.
- **Directive wording for the reasons not wired here** (`baseline_red`, `pre_existing_regression`, `missing_application_type`, `base_server_down`) follows ADR-0060/ADR-0061 literally. The issues that wire them own their evidence fields and may refine the text without changing the builder's shape. For `fix_loop_stalled`, ADR-0059 gives only `## Retry` a meaning, so the comment says `## Continue` waives nothing there and points to `## Retry`. That is true whatever the generic `## Continue` handling does.
- **`adw_init.md` is a `hashInputs` file.** Task 13 raises the framework hash, so `adwUpgrade` regenerates `.adw/` in registered target repositories. That is intended: without the preservation rule, an upgrade would drop a repository's `## Suppression Patterns`. The section is never created by `adw_init`, so existing repositories get no new content.
- **`@adw-988` scenarios 6 and 8** (issues 9882/9884) asserted the interim "red check ends the workflow with exit code 1 before any agent starts", which ADR-0058 scoped until this fix loop. They have been rewritten for the fix loop and also tagged `@adw-989`: a red lint (9882) or build (9884) now goes to the static-check fix agent, a round that changes nothing parks the workflow as `human_gated` with a park comment naming the check, the check's output is in the execution log, and the test agent never starts. They are part of this issue's scenario set (task 16) and run under both `@adw-989` and `@adw-988`. Do not edit `feature-988.feature` further. The #988 phase unit tests that asserted the old behaviour are rewritten in task 10.
- **Docs.** The `/document` phase updates the module docs that own the touched files:
  - `app_docs/feature-9gjajh-test-and-scenario-phases.md` (gate, loop);
  - `…-state-and-config.md` (`suppressionPatterns`, barrel);
  - `…-commands-and-skills.md` (`resolve_failed_test.md`, `adw_init.md`);
  - `…-github-api.md` (`adws/forge/parkComment.ts`).
  If a doc adds ADR-0059 or ADR-0060 to its `## Decisions`, the matching `Decisions:` block in `.adw/conditional_docs.md` must change in the same commit, or `bun run lint:docs-index` fails. `UBIQUITOUS_LANGUAGE.md` may gain **Park** and **Fix-Round Guard** entries at that point.
- **Not in scope:**
  - the baseline gate and its parks (ADR-0060);
  - the reviewer's suppression blocker (`review.md`);
  - application-type parks;
  - any change to the caps of the unit-test or scenario fix loops.
  `specs/adr/README.md` still says records 0058–0063 are not yet implemented. Refresh that sentence when the PRD's work completes; each record's own `### Confirmation` is authoritative meanwhile.
