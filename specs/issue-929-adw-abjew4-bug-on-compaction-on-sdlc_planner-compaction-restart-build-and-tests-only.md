# Bug: On compaction every agent is killed, but only build and unit tests restart

## Metadata
issueNumber: `929`
adwId: `abjew4-bug-on-compaction-on`
issueJson: `{"number":929,"title":"bug: on compaction only build and tests restart; other phases run on","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision record\n\nADR-0023 (`## Divergence`).\n\n## What to build\n\nThe agent process handler kills every agent when it detects compaction. Only the build phase and the unit-test path restart it; every other phase is killed and its partial output is accepted.\n\nRuling: only build and tests restart on compaction. Every other phase runs on with the compacted context and is not killed.\n\nRemove what is left of the old review handling: the `review_compaction_recovery` stage and its comment formatter, which nothing posts.\n\n## Acceptance criteria\n\n- [ ] An agent in the build phase or the unit-test path is killed and restarted on compaction, as today.\n- [ ] An agent in any other phase is not killed on compaction and runs to completion.\n- [ ] Unit tests cover both cases.\n- [ ] The dead stage and formatter are gone, and the stage taxonomy checks still pass.\n- [ ] The Divergence section of ADR-0023 is removed in the same pull request.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-01T19:19:56Z","comments":[],"actionableComment":null}`

## Bug Description
`handleAgentProcess` (`adws/agents/agentProcessHandler.ts:85-92`) sends `SIGTERM` to every Claude Code agent as soon as the stream parser reports a `system`/`compact_boundary` event. It then resolves the run as `{ success: true, compactionDetected: true, output: <text streamed so far> }` (`agentProcessHandler.ts:206-222`). The kill always happens. The handler has no way to know whether its caller will restart the agent.

Only two callers restart a compacted agent:
- **The build phase.** `adws/phases/buildPhase.ts:187-237` starts the build agent again with a continuation prompt.
- **The unit-test path.** `adws/core/retryOrchestrator.ts:89-98` and `121-130`, together with `adws/agents/testRetry.ts:97-99`, run the test agent or test resolver again without using up a retry.

No other agent's caller reads `compactionDetected`. Among them are plan, plan validation and alignment, scenario writer, step definitions, scenario fix, the passive review judge, the review phase's patch, refactor and build agents (`adws/phases/reviewPatchHelpers.ts:59` and `109`), document, PR-review plan and build (`adws/phases/prReviewPhase.ts:251`), install, the rot advisory, the commit and branch-name agents, and the classifier. For all of them, compaction ends the run early, and the caller treats the cut-off output as a finished, successful run.

- **Actual:** any agent outside the build phase and the unit-test path is killed at its first compaction, and its partial output is accepted as the result. For example, in the review phase `applyPatchBlocker` logs `Built patch for blocker #N` for a build agent that was killed partway through the patch. The review cycle then commits and pushes the half-applied patch.
- **Expected:** the owner's ruling in ADR-0023 `## Divergence` says only the build phase and the unit-test path kill and restart an agent on compaction. Every other agent is not killed. It runs to completion with the compacted context and returns its normal final result.

The review handling that #299 added also left dead code behind: the `review_compaction_recovery` stage and `formatReviewCompactionRecoveryComment`. The review retry loop that posted that stage (`adws/agents/reviewRetry.ts`) was deleted on 2026-04-08 (commit a805a4b6, ADR-0031), and nothing posts it now.

## Problem Statement
The kill-on-compaction decision is made in the wrong place. The spawn layer makes it for every agent, but it cannot know whether the caller will restart the agent. Only a caller that restarts (the build phase loop and `runUnitTestsWithRetry`) may ask for the kill. Every other agent must run on.

Separately, the unused `review_compaction_recovery` stage and its comment formatter must be removed without breaking the stage taxonomy checks:
- the `never` guard in `classifyStage`, enforced by `tsc`;
- the `Record<WorkflowStage, StageClass>` table in `stageClassifier.test.ts`.

## Solution Statement
Make the compaction kill an explicit opt-in that is off by default:

1. **Handler.** `handleAgentProcess` gets a trailing parameter `killOnCompaction = false` and kills on `compact_boundary` only when it is `true`. When it is `false`, the compaction is ignored. The agent runs on, and the run resolves through the normal completion path with its final result. The result does not set `compactionDetected`, because the agent was not terminated.
2. **Spawn layer.** The flag is passed through unchanged:
   - `runClaudeAgentWithCommand` gets a trailing `killOnCompaction = false` and applies it to the first spawn, the ENOENT retries and the auth retry.
   - `runCommandAgent` reads it from `CommandAgentOptions.killOnCompaction?`.
   - The Haiku output-correction retry in `runRetryLoop` does not receive it.
3. **Only the restarting callers set it:**
   - `buildPhase.ts` passes `true` to `runBuildAgent`, which gets a trailing `killOnCompaction = false`. `reviewPatchHelpers.ts` keeps calling `runBuildAgent` without it, so the review phase's build agent runs on. This shared use is why the flag cannot be hard-coded inside `runBuildAgent`.
   - `runUnitTestsWithRetry` passes `killOnCompaction = onCompactionDetected !== undefined` to `runTestAgent` and `runResolveTestAgent`, which each get a trailing `killOnCompaction = false`. An agent is killed only when a restart handler exists.
4. **Remove the dead stage.** Delete `review_compaction_recovery` from:
   - the `WorkflowStage` union;
   - the exhaustive classifier;
   - the classifier's test table;
   - the comment-header map.

   Also delete `formatReviewCompactionRecoveryComment` and its `case` in `formatWorkflowComment`.
5. **Docs.** Delete only the `## Divergence` section of ADR-0023. Fix the two statements in the agents-core living doc that say every agent is terminated on compaction.

Off by default is the safe direction. A new or forgotten caller gets the ruling's behaviour (it runs on), not a kill whose partial output is accepted silently.

## Steps to Reproduce
1. **Spawn-layer reproduction (deterministic, no CLI needed).** Feed a `compact_boundary` event to `handleAgentProcess` through a fake child process, the way any agent outside build and tests would see it:
   ```ts
   const promise = handleAgentProcess(child, 'review-agent', outputFile, undefined, undefined, 'haiku');
   child.stdout.emit('data', Buffer.from('{"type":"system","subtype":"compact_boundary"}\n'));
   // child.kill('SIGTERM') has already been called at this point
   child.emit('close', null);
   await promise; // { success: true, compactionDetected: true, output: '' }
   ```
   Running this during planning gave the following: the child was killed right away, the log said `Context compaction detected — killing process to restart with fresh context.`, and the run resolved to `{"success":true,"compactionDetected":true,"output":""}`. That is a "successful" run with empty output, which no caller outside build and tests restarts. Task 1 turns this into a failing unit test.
2. **In a workflow.** Run any orchestrator whose review phase reaches `executeReviewPatchCycle` with a blocker, on an issue large enough that the review-phase patch build agent compacts. That agent is `runBuildAgent`, called from `reviewPatchHelpers.ts`. The log shows `Context compaction detected — killing process…`, then `Build terminated due to context compaction`, then `Built patch for blocker #N`. No restart follows, and the half-applied patch is committed and pushed.
3. **Code search.** Run `grep -rn "compactionDetected" adws --include='*.ts' | grep -v __tests__`. Outside the handler and the type, the only consumers are `buildPhase.ts`, `retryOrchestrator.ts` and `testRetry.ts`.

## Root Cause Analysis
- **Original design.** #298 (commit f8b38d31) added compaction handling as a kill in the shared stream handler, paired with a restart in the build loop. #299 added restarts to the test and review retry loops. The design assumed that every agent whose compaction mattered had a restart around it.
- **The review restart was removed, the kill was not.** On 2026-04-08 the review phase became a passive judge (commit a805a4b6, ADR-0031), and the review retry loop (`adws/agents/reviewRetry.ts`) was deleted. The kill in the handler stayed unconditional. Review agents, and every other agent outside build and tests, lost their restart but were still killed.
- **A compaction kill looks like a successful run.** The handler resolves it as `success: true`, so that restarting callers do not count it as a failure, with the partial text as `output`. A caller that does not check `compactionDetected` cannot tell it from a finished run, so the partial output is accepted silently.
- **The handler has no input that says whether the caller restarts.** The only phase hint on the spawn path is `phaseName`, which just two callers pass (`stepDefAgent.ts`, `promotionRotAdvisory.ts`), so it cannot be used. The fix is an explicit opt-in owned by the caller that restarts.
- **`runBuildAgent` has two kinds of caller.** The build phase restarts it; the review phase's patch and refactor path does not. So the opt-in must come from the call site in `buildPhase.ts`, not from inside `runBuildAgent`.
- **Leftovers of #299's review handling:**
  - the `review_compaction_recovery` literal in `WorkflowStage`;
  - its case in `classifyStage`;
  - its row in the classifier test table;
  - its `STAGE_HEADER_MAP` entry;
  - `formatReviewCompactionRecoveryComment` and its `formatWorkflowComment` case.

  Nothing posts this stage.

## Relevant Files
Use these files to fix the bug:

- `README.md`: project overview, read at the start.
- `.adw/coding_guidelines.md`: rules that apply here:
  - at most 300 lines per file;
  - nesting depth of about 2 at most;
  - comments only for invariants or reasons, never issue numbers;
  - unit tests go through public interfaces.
- `specs/adr/0023-context-exhaustion-is-a-reset.md`: the specification (`## Divergence`, lines 73-76). This fix removes that section.
- `.claude/skills/write-an-adr/SKILL.md`: under "What may change after an ADR is accepted", only `status`, `superseded-by`, `## Divergence` and the supersession note may change. So only the Divergence section is removed from ADR-0023.
- `specs/adr/0036-stage-taxonomy-and-exhaustive-classifier.md`: the stage taxonomy checks that must keep passing. These are the `never` guard in `classifyStage`, enforced by `bunx tsc --noEmit`, and the `Record<WorkflowStage, StageClass>` test table.
- `adws/agents/agentProcessHandler.ts`: contains the unconditional kill (lines 85-92) and the compaction resolve (lines 206-222). Gets the `killOnCompaction` opt-in.
- `adws/agents/claudeAgent.ts`: `runClaudeAgentWithCommand`, the single spawn path. It calls `handleAgentProcess` three times (lines 156, 184, 226). Passes the opt-in through.
- `adws/agents/commandAgent.ts`: `CommandAgentOptions` and `runCommandAgent`, used by `runBuildAgent` and `runTestAgent`. Passes the opt-in through.
- `adws/agents/buildAgent.ts`: `runBuildAgent`, shared by the build phase and the review patch path. Gets a trailing opt-in parameter. `runPrReviewBuildAgent` is unchanged.
- `adws/phases/buildPhase.ts`: the build restart loop. It reads `compactionDetected` at line 189, and its `runBuildAgent` call at line 145 opts in. The file is 290 lines and must stay at 300 or fewer.
- `adws/phases/reviewPatchHelpers.ts`: review-phase `runBuildAgent` calls (lines 59, 109) that do not restart. Read-only reference; it stays unchanged so these agents run on.
- `adws/agents/testAgent.ts`: `runTestAgent` and `runResolveTestAgent` get the opt-in. `runResolveScenarioAgent` is unchanged.
- `adws/agents/testRetry.ts`: `runUnitTestsWithRetry`, the unit-test restart path. Derives the opt-in from `onCompactionDetected` and passes it at lines 69 and 92.
- `adws/core/retryOrchestrator.ts`: the restart logic in `retryWithResolution`. Read-only reference, unchanged.
- `adws/phases/unitTestPhase.ts`: always passes `onCompactionDetected` (line 67) and posts `test_compaction_recovery`. Read-only reference, unchanged.
- `adws/types/agentTypes.ts`: `AgentResult.compactionDetected`. Unchanged; it keeps the meaning "terminated because of compaction".
- `adws/types/workflowTypes.ts`: the `WorkflowStage` union. Remove `'review_compaction_recovery'` (line 35).
- `adws/core/stageClassifier.ts`: the exhaustive `classifyStage`. Remove its case (line 86).
- `adws/core/__tests__/stageClassifier.test.ts`: `EXPECTED: Record<WorkflowStage, StageClass>`. Remove the row (line 56).
- `adws/core/workflowCommentParsing.ts`: `STAGE_HEADER_MAP`. Remove the `':warning: Review Compaction Recovery'` entry (line 51). `parseWorkflowStageFromComment` returns `null` for an unknown header, and the stage is not in `STAGE_ORDER`, so an old comment with that header is ignored safely.
- `adws/forge/workflowCommentsIssue.ts`: delete `formatReviewCompactionRecoveryComment` (lines 178-181) and its case (line 354).
- `adws/agents/__tests__/agentProcessHandler.test.ts`: has an existing fake-child harness (`createFakeChild`, `tmpOutputFile`). Gets the compaction tests.
- `adws/agents/__tests__/claudeAgent.test.ts`: has an existing harness that mocks `spawn` and `handleAgentProcess`. Gets a pass-through test.
- `adws/phases/__tests__/reviewPhase.test.ts`: style reference for phase tests with mocked agent runners. Must keep passing unchanged.
- `features/per-issue/feature-929.feature`: this issue's BDD scenarios, written in parallel by the scenario writer:
  - §1 and §2: build and unit-test restart;
  - §3: run-on rows for plan, step-definition, review, review-patch build, scenario-resolution, document and PR review build;
  - §4: the retired stage.

  They match this plan. The build agent drives them with `/implement-tdd`.
- `app_docs/feature-9gjajh-claude-agents-core.md`: the living doc that owns `agentProcessHandler`, `claudeAgent` and `commandAgent`. Line 14 (Responsibilities) and line 67 (Gotchas) say every agent is terminated on compaction; both are updated.
- `app_docs/feature-9gjajh-build-and-plan-phases.md`: conditional doc for `buildPhase.ts` (build continuation loop). Context only; still accurate.
- `app_docs/feature-9gjajh-scenario-and-stepdef-agents.md`: conditional doc for `testAgent.ts` and `testRetry.ts`. Context only.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md`: conditional doc for `unitTestPhase.ts`. Context only.
- `app_docs/feature-9gjajh-takeover-and-coordination.md`: conditional doc that owns `stageClassifier.ts`. Context only; it does not name the removed stage.
- `app_docs/feature-9gjajh-classifier-and-routing.md`: conditional doc that owns `workflowCommentParsing.ts`. Context only.
- `app_docs/feature-9gjajh-github-api.md`: conditional doc that owns `adws/forge/**`, the comment formatters. Context only.
- `app_docs/feature-9gjajh-types.md`: conditional doc that owns `adws/types/**`. Context only.

### New Files
- `adws/phases/__tests__/buildPhase.test.ts`: unit test showing that the build phase asks for the kill and restarts the build agent on compaction.
- `adws/agents/__tests__/testRetry.test.ts`: unit tests showing that the unit-test path asks for the kill and restarts on compaction, and does not ask for it without a restart handler.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Reproduce the bug with failing handler tests
- In `adws/agents/__tests__/agentProcessHandler.test.ts`, add a `describe('handleAgentProcess — context compaction', …)` block that reuses `createFakeChild()` and `tmpOutputFile()`. Add two tests:
  - **Other phases run on (default).**
    - Call `handleAgentProcess(child, 'review-agent', outputFile, undefined, undefined, 'haiku')` with no seventh argument, which is how every caller outside build and tests spawns.
    - Emit `{"type":"system","subtype":"compact_boundary"}` on stdout and assert `wasKilled()` is `false`.
    - Emit an `assistant` text line and a final `result` line, for example `{ type: 'result', subtype: 'success', isError: false, result: 'final verdict', sessionId: 's1' }`. Then emit `close` with code `0`.
    - Assert the result has `success: true`, `output: 'final verdict'`, `sessionId: 's1'`, and `compactionDetected` undefined.
  - **Build and tests restart (opt-in).**
    - Call with `true` as the seventh argument and emit the same `compact_boundary` line.
    - Assert `wasKilled()` is `true`, then emit `close` with `null`.
    - Assert the result has `success: true` and `compactionDetected: true`.
- Run `bunx vitest run adws/agents/__tests__/agentProcessHandler.test.ts`. The run-on test must fail because the child is killed; this reproduces the bug. The opt-in test already passes at runtime because today's kill is unconditional, and Vitest does not type-check the extra argument.

### 2. Make the compaction kill opt-in in the process handler
- In `adws/agents/agentProcessHandler.ts`, add a trailing parameter `killOnCompaction = false` to `handleAgentProcess`, after `model`.
- Change the compaction guard (line 85) to `if (killOnCompaction && !compactionDetected && state.compactionDetected)`. Leave its body as it is: the log line, `appendLog` and `SIGTERM`. Do not add a new branch or nesting level inside the `data` callback.
- Leave the `close` handler unchanged. The local `compactionDetected` is now set only when the process was killed for compaction, so a run that was not killed takes the normal completion branches. It returns the agent's final result, `sessionId` and cost, without `compactionDetected`.

### 3. Pass the opt-in through the spawn layer
- **`adws/agents/claudeAgent.ts`:**
  - Add a trailing parameter `killOnCompaction = false` to `runClaudeAgentWithCommand`, after `launchContext`.
  - Pass it as the seventh argument to all three `handleAgentProcess` calls (the first spawn, the ENOENT retry loop and the auth retry), so a retried agent keeps its caller's compaction behaviour.
  - Add one `@param killOnCompaction` entry to the existing JSDoc stating the invariant: only a caller that restarts the agent when the result carries `compactionDetected` sets it, and every other agent runs on with the compacted context. Do not cite issue numbers.
- **`adws/agents/commandAgent.ts`:**
  - Add `killOnCompaction?: boolean` to `CommandAgentOptions`.
  - Destructure it in `runCommandAgent` and pass it as the new last argument of that function's `runClaudeAgentWithCommand` call.
  - Do not pass it from `runRetryLoop`. The Haiku output-correction retry is never restarted, so it runs on.
- **`adws/agents/__tests__/claudeAgent.test.ts`:** add a test that `runClaudeAgentWithCommand` passes `killOnCompaction` to `handleAgentProcess`, by asserting on `mockHandleAgentProcess.mock.calls[n][6]`:
  - `false` when the argument is omitted;
  - `true` when `true` is passed, on the first spawn and again on the ENOENT retry spawn. Use the same `mockResolvedValueOnce` pattern as the existing ENOENT test, `carries the switch through the ENOENT retry spawn as well`.

### 4. Opt the build phase in
- **`adws/agents/buildAgent.ts`:** add a trailing parameter `killOnCompaction = false` to `runBuildAgent` and pass it into the `runCommandAgent` options. Leave `runPrReviewBuildAgent` unchanged, because the PR review phase runs on.
- **`adws/phases/buildPhase.ts`:** pass `true` as the new last argument of the `runBuildAgent` call at line 145. This loop is the code that restarts on `compactionDetected`. Change nothing else in the loop, and keep the file at 300 lines or fewer.
- Do not touch `adws/phases/reviewPatchHelpers.ts`. Its two `runBuildAgent` calls keep the default, so the review phase's build agent runs on.

### 5. Opt the unit-test path in
- **`adws/agents/testAgent.ts`:**
  - Add a trailing parameter `killOnCompaction = false` to `runTestAgent` and pass it into the `runCommandAgent` options.
  - Add the same parameter to `runResolveTestAgent` and pass it as the new last argument of its `runClaudeAgentWithCommand` call.
  - Leave `runResolveScenarioAgent` unchanged, because the scenario phases run on.
- **`adws/agents/testRetry.ts`:** in `runUnitTestsWithRetry`, add `const killOnCompaction = onCompactionDetected !== undefined;` and pass it to both `runTestAgent(…)` (line 69) and `runResolveTestAgent(…)` (line 92). The agent is then killed only when a restart handler exists. A future caller that leaves out `onCompactionDetected` gets the run-on behaviour, not a partial run accepted silently.

### 6. Add unit tests for the two restart paths
- **New `adws/phases/__tests__/buildPhase.test.ts`** (follow the style of `reviewPhase.test.ts`):
  - **Mocks.** Partially mock `../../agents`: use `importOriginal`, replace `runBuildAgent` and `runCommitAgent` with `vi.fn()`, and make `getPlanFilePath` return `'plan.md'`.
  - **Temp dirs.** Use `fs.mkdtempSync` temp dirs for:
    - `worktreePath`, containing a `plan.md` with known text;
    - `logsDir`;
    - `orchestratorStatePath`.

    Given a parent state path, the real `AgentStateManager` writes under that path, so no repo files are touched.
  - **Config.** Build a `WorkflowConfig` cast with:
    - `recoveryState: { canResume: false, lastCompletedStage: null, adwId: null, branchName: null, planPath: null, prUrl: null }`;
    - `repoContext: undefined`, so no comments are posted;
    - `defaultBranch: 'dev'`, plus the issue, issue type, `adwId`, `ctx` and `orchestratorName`;
    - a fake `gitContext`: `{ getHeadTreeHash: () => 'tree-a', hasUncommittedChanges: () => false, commandEnv: () => ({}) }`.
  - **Agent results.** `runBuildAgent` first resolves `{ success: true, compactionDetected: true, output: 'partial' }`, then `{ success: true, output: 'done' }`. `runCommitAgent` resolves a commit result.
  - **Assertions:**
    - `executeBuildPhase` completes;
    - `runBuildAgent` is called twice, and every call passes `true` as its ninth argument (`killOnCompaction`);
    - the second call's plan content (third argument) contains both the original plan text and `## Continuation Context`. This shows the restart got a fresh context.
- **New `adws/agents/__tests__/testRetry.test.ts`:**
  - **Mocks.** Partially mock `../testAgent`: use `importOriginal`, replace `runTestAgent` and `runResolveTestAgent` with `vi.fn()`, and keep `testResultFromCase` real.
  - **Temp dir and options.** Use a temp dir for `orchestratorStatePath`, `logsDir` and `unitReportPath`. Call `runUnitTestsWithRetry` with `maxRetries: 3` (Test B needs a second attempt) and any `runTestsCommand`.
  - **The `runTestAgent` mock stands in for the agent.** It writes the JUnit XML that the real test command would write to `unitReportPath`, then resolves an object shaped like `TestAgentResult`. Example reports:
    - passing: `<testsuite tests="1"><testcase classname="S" name="ok"/></testsuite>`;
    - failing: a `<testcase>` containing `<failure message="boom"/>`.
  - **Test A (restart).**
    - Setup: pass `onCompactionDetected: vi.fn()`. The first `runTestAgent` call resolves with `compactionDetected: true`. The second writes a passing report.
    - Assert that `runTestAgent` is called twice, each time with `true` as its sixth argument.
    - Assert that `onCompactionDetected` is called once, with `1`.
    - Assert that the result has `passed: true`, `totalRetries: 0` and `contextResetCount: 1`.
  - **Test B (resolver).**
    - Setup: pass `onCompactionDetected`. The first run writes a failing report, the second a passing one. `runResolveTestAgent` resolves `{ success: true, output: 'fixed' }`.
    - Assert that `runResolveTestAgent` is called with `true` as its seventh argument.
  - **Test C (no restart handler).** Without `onCompactionDetected`, assert that `runTestAgent` gets `false` as its sixth argument.
- Re-run `bunx vitest run adws/agents/__tests__/agentProcessHandler.test.ts`. Both compaction tests now pass.

### 7. Remove the dead review compaction stage and formatter
- **`adws/types/workflowTypes.ts`:** delete the line `| 'review_compaction_recovery'`.
- **`adws/core/stageClassifier.ts`:** delete `case 'review_compaction_recovery':`.
- **`adws/core/__tests__/stageClassifier.test.ts`:** delete the `review_compaction_recovery: 'resumable',` row from `EXPECTED`. Because of the `Record<WorkflowStage, StageClass>` type, `tsc` would otherwise reject it as an excess property.
- **`adws/core/workflowCommentParsing.ts`:** delete the `':warning: Review Compaction Recovery': 'review_compaction_recovery',` entry from `STAGE_HEADER_MAP`.
- **`adws/forge/workflowCommentsIssue.ts`:** delete `formatReviewCompactionRecoveryComment` and the line `case 'review_compaction_recovery': …` in `formatWorkflowComment`. Keep `compaction_recovery` and `test_compaction_recovery`, which `buildPhase.ts` and `unitTestPhase.ts` still post.
- Check that nothing else in code references the stage: `grep -rn "review_compaction_recovery\|formatReviewCompactionRecoveryComment\|Review Compaction Recovery" adws features test` must return nothing. The historical plans in `specs/` are records; leave them as they are.

### 8. Update the decision record and the living doc
- **`specs/adr/0023-context-exhaustion-is-a-reset.md`:**
  - Delete the whole `## Divergence` section (the heading and its item 1), so `## More Information` comes directly after the `### Confirmation` list.
  - Change nothing else in the record. An accepted ADR may only change `status`, `superseded-by`, `## Divergence` and the supersession note (`.claude/skills/write-an-adr/SKILL.md`).
  - `specs/adr/README.md` needs no change, because its table has no divergence column.
- **`app_docs/feature-9gjajh-claude-agents-core.md`:**
  - **Line 14 (Responsibilities).** It currently says the handler "early-terminates on auth errors, rate limits/API outages, context compaction, and output token threshold breaches". Change it so compaction terminates the agent only when the caller passes `killOnCompaction`.
  - **Line 67 (Gotchas).** Replace the bullet with one stating:
    - compaction terminates the agent only when the caller passes `killOnCompaction`, which only the build phase and the unit-test path do because they restart the agent;
    - the result is then `success: true` with `compactionDetected: true`;
    - every other agent runs on with the compacted context and resolves normally, without `compactionDetected`.

### 9. Run the validation commands
- Run every command in `Validation Commands` below, in order, and fix any failure before finishing.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bunx vitest run adws/agents/__tests__/agentProcessHandler.test.ts`: the reproduction. Before Step 2 the run-on compaction test fails because the agent is killed. After the fix, both compaction tests and the four existing rate-limit and auth tests pass.
- `bunx vitest run adws/agents/__tests__/agentProcessHandler.test.ts adws/agents/__tests__/claudeAgent.test.ts adws/agents/__tests__/testRetry.test.ts adws/phases/__tests__/buildPhase.test.ts adws/phases/__tests__/reviewPhase.test.ts adws/core/__tests__/stageClassifier.test.ts adws/core/__tests__/workflowCommentParsing.test.ts adws/forge/__tests__/workflowCommentsIssue.test.ts`: the targeted suites. Baseline at planning time, before any change: the `agentProcessHandler`, `claudeAgent`, `stageClassifier`, `workflowCommentsIssue` and `reviewPhase` suites passed 117 of 117 tests.
- `! grep -rn "review_compaction_recovery\|formatReviewCompactionRecoveryComment\|Review Compaction Recovery" adws features test`: the dead stage and formatter are gone.
- `! grep -n "^## Divergence" specs/adr/0023-context-exhaustion-is-a-reset.md`: the Divergence section of ADR-0023 is removed.
- `bun run lint`: lint.
- `bunx tsc --noEmit`: type check. This includes the stage taxonomy compile-time checks, the `never` guard in `classifyStage` and the `Record<WorkflowStage, StageClass>` table.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the additional type check for `adws/`.
- `bun run build`: build.
- `bun run test:unit`: the full Vitest suite.
- `bun run lint:docs-index`: health of the living-docs index after the `app_docs` edit. It passed at planning time.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-929"`: this issue's BDD scenarios, if the scenario phase wrote any.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the regression suite. Baseline at planning time: 122 scenarios, 80 passed, 42 pending, exit 0, about 36 seconds. The Claude CLI stub never emits `compact_boundary`, so no scenario output should change.

## Notes
- **Coding guidelines.** Strictly follow `.adw/coding_guidelines.md`:
  - files stay at 300 lines or fewer (`buildPhase.ts` is at 290);
  - no new nesting level in the handler's `data` callback;
  - comments only for invariants and never with issue numbers (the single `@param killOnCompaction` JSDoc line is the only new comment needed);
  - tests go through public interfaces, with mocks only at the agent and process boundary.
- **No new library.**
- **Naming.** The parameter is called `killOnCompaction` at every layer, because at the handler that is exactly what it does. Restarting stays the caller's job, and the JSDoc invariant ties the two together.
- **Positional parameters.** The trailing positional parameters follow the existing style; `launchContext` was added the same way. Converting the runners to options objects is out of scope. All new parameters are optional and default to `false`, so `adws/index.ts` and `adws/agents/index.ts` re-exports and every untouched caller keep compiling.
- **Scenario alignment.** The §3 rows of `features/per-issue/feature-929.feature` pin down which callers must stay on the default, so these must not opt in:
  - the review-patch `runBuildAgent` calls in `reviewPatchHelpers.ts`;
  - `runResolveScenarioAgent`;
  - `runPrReviewBuildAgent`;
  - the plan, step-definition, review and document runners.

  The §4 formatter scenario expects `formatWorkflowComment('review_compaction_recovery', …)` to fall through to the generic `## ADW Workflow Update` body once the case is removed. That is the existing `default` branch, so no new code is needed for it.
- **`AgentResult.compactionDetected` keeps its meaning**, "terminated because of compaction". It is set only after an opt-in kill, so `buildPhase.ts`, `retryOrchestrator.ts`, `testRetry.ts` and `unitTestPhase.ts` read it as before.
- **Out of scope, noted for the owner.** The output-token-limit kill in the same handler (`tokenLimitReached`, about 57.6K output tokens with the defaults) is also unconditional, and only the build phase restarts on `tokenLimitExceeded`. The ruling does not cover it, so it is unchanged here.
- **Unchanged docs.** `UBIQUITOUS_LANGUAGE.md` describes compaction and its remedy as concepts. The `context-compaction-degradation` entry in `adws/known_issues.md` is about build sessions. Both still read correctly and are not changed. The ADR-0023 consequence about the test retry loop's fixed `MAX_CONTEXT_RESETS` cap is a separate accepted consequence and is not changed either.
