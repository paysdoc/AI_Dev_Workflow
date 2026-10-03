# Bug: The full-pipeline smoke scenarios are still pending, so the `@regression` run can never pass

## Metadata
issueNumber: `968`
adwId: `6zth7b-bug-run-the-full-pip`
issueJson: `{"number":968,"title":"bug: run the full-pipeline smoke scenarios as real orchestrators and close the pending regression suite","body":"Source: the `## Divergence` section of `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, item 3. Read it before planning.\n\nSplit from #935, which was too large for one run and is closed. The facts below come from #935's planning research. Check them against the code before relying on them.\n\nThis is the last slice of the regression-suite repair. It moves the four full-pipeline smoke scenarios onto real orchestrator subprocesses, using the harness from #966, deletes the dead phrases, and closes Divergence item 3.\n\n## What to build\n\n**Smoke scenarios.** Rewrite in place, keeping `@regression @smoke`. Each uses per-command stub manifests (`byCommand`), delivered through the workspace marker file.\n\n- **`adw_chore_diff_verdicts`, `safe`.** W1 `chore`. Program the stub so that:\n  - `/chore` writes the plan at the path `getPlanFilePath` resolves;\n  - `/implement` makes a docs-only edit, and `/commit` commits it;\n  - `/diff_evaluator` answers the `safe` verdict JSON the phase parses;\n  - the PR and review commands answer in a form their callers can parse.\n\n  Then: T1 `awaiting_merge`, T5 0, and the PR creation for issue 200.\n- **`adw_chore_diff_verdicts`, `regression_possible`.** The same, with the `regression_possible` verdict and a passing review. Then: T1 `awaiting_merge`, T5 0, and T3 `Chore Escalation: Regression Possible`.\n- **`adw_sdlc_happy_path`.** W1 `sdlc`, with per-command entries for every agent the pipeline runs:\n  - install, plan and scenario, alignment, build, step-defs, review, document, PR;\n  - unit tests and scenarios come from the fixture's `N/A` and echo commands.\n\n  Then: T1 `awaiting_merge`, T5 0, the PR, the comments, and the labels.\n- **`pause_resume_rate_limit`.** W1 `sdlc`. The first agent call answers rate-limited with `rateLimitType: \"seven_day\"` and a reset hours ahead. Any type other than `five_hour` enqueues; `five_hour` would sleep in process until the reset (`adws/core/rateLimitWaitPolicy.ts`), which is why the old manifest could never pause.\n  - Then: T1 `paused`, T5 0.\n  - The harness snapshots `agents/paused_queue.json` before the run and restores it after.\n\nRewrite or replace the manifests these scenarios use (`adw-sdlc-happy.json`, `safe-verdict.json`, `regression-possible-verdict.json`, `rate-limit-pause-resume.json`), and remove every `.adw/state.json` edit. Leave unused leftover manifests alone.\n\n**Cleanup.**\n\n- **Dead steps.** Delete W2–W8, W11, their commented bodies, `buildMockedWorkflowConfig`, the dead `ORCHESTRATOR_FILES` entries and the `eslint-disable` lines that only served them.\n- **No pending markers.** Confirm that no step under `features/regression/` returns `'pending'`.\n- **Vocabulary.** Retire the W2–W8 and W11 rows in `features/regression/vocabulary.md`. Keep the table format that `.claude/skills/promote-regression-vocabulary/scripts/list-registered-phrases.ts` parses.\n\n**Records.**\n\n- **ADR-0037.**\n  - Remove Divergence item 3 and renumber.\n  - Remove the Consequences bullet that says the intended gain is not delivered yet.\n  - In Confirmation, replace \"The hybrid execution model is not in force\" with a dated confirmation that smoke scenarios run real processes and surface scenarios import phase functions, and update the file counts if they changed.\n- **ADR-0021.** Replace the \"still pending\" Consequences bullet and the \"is failing; see ADR-0037\" Confirmation line with the current facts.\n- **`app_docs/feature-9gjajh-bdd-regression-suite.md`.** Describe W1 as a real async subprocess in a hermetic environment, W-S1/W-S2 as in-process with a non-posting cost tracker, the `gh` shadow and its replay, and the per-command stub manifests.\n\n## Acceptance criteria\n\n- [ ] `NODE_OPTIONS=\"--import tsx\" bunx cucumber-js --tags \"@regression\"` reports no pending, no undefined and no failed scenario, and exits 0.\n- [ ] Every `@smoke` and `@surface` scenario passes, with no scenario dropped or untagged.\n- [ ] `grep -rn \"return 'pending'\" features/regression` finds nothing.\n- [ ] Divergence item 3 of ADR-0037 is removed in the same pull request.\n\n## Blocked by\n\n#964\n#965\n#966\n#967\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-02T07:59:14Z","comments":[],"actionableComment":null}`

## Bug Description

On `dev`, `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` still exits 1. Four scenarios in three smoke files are reported **pending** at W1 `the {string} orchestrator is invoked with adwId {string} and issue {int}`:

- `features/regression/smoke/adw_chore_diff_verdicts.feature`:
  - `safe diff verdict — docs-only change completes without escalation`
  - `regression_possible diff verdict — adws-touching change escalates to review`
- `features/regression/smoke/adw_sdlc_happy_path.feature`: `adwSdlc completes the full pipeline end-to-end`
- `features/regression/smoke/pause_resume_rate_limit.feature`: `orchestrator records paused stage on rate-limit detection`

These files carry `@regression @smoke` and no `@subprocess`. So the `@regression and (@subprocess or @webhook)` Before hook (`features/regression/support/hooks.ts:33-35`) never creates the subprocess harness, and W1 returns at its first line, `if (!this.subprocess) return 'pending';` (`features/regression/step_definitions/whenSteps.ts:25`). Cucumber is strict, so one pending scenario fails the run. Both jobs of the daily regression workflow stay red, and the suite cannot become the required check ADR-0037 calls for.

Adding `@subprocess` alone would not make them pass, because their inputs cannot drive a real pipeline:

- **The manifests are not per-command.** `safe-verdict.json`, `regression-possible-verdict.json`, `adw-sdlc-happy.json` and `rate-limit-pause-resume.json` predate the stub's `byCommand` routing, so every agent gets the same prose answer. Several callers extract JSON from their answer: the diff evaluator, review, alignment, step-def, unit-test and PR agents. Prose fails that, goes through `/correct_output`, and the run fails.
- **The plan lands where nothing looks.** `adw-sdlc-happy.json` and `rate-limit-pause-resume.json` write `specs/plan.md`. `getPlanFilePath` (`adws/agents/planAgent.ts:39-70`) only finds `specs/issue-<N>-adw-*-sdlc_planner-*.md` or the legacy `specs/issue-<N>-plan.md`.
- **Nothing stands in for `/commit`.** The commit agent throws on failure, and the build and document phases always call it.
- **The rate-limit manifest can never pause.** It asks for `rateLimitType: "five_hour"` with `limitedInvocations: 1`:
  - Its one rejection lands on `/install`, the first call that finds the manifest. The install phase swallows every error (`adws/phases/installPhase.ts:150-155`).
  - A `five_hour` rejection with a future reset is slept out in process (`decideRateLimitWait`, `adws/core/rateLimitWaitPolicy.ts:53-65`). The stub always sends a finite `resetsAt` (now + 300 s by default), which outlasts the harness's 120 s orchestrator bound.
- **G11 makes a decoy worktree.** `the worktree for adwId {string} is initialised at branch {string}` lays out a temp repo that a subprocess run never uses: the orchestrator creates its own worktree under the harness's `TARGET_REPOS_DIR`. G11 also puts `MOCK_WORKTREE_PATH` into the child's environment.

The cleanup and the records are owed as well:

- **`whenSteps.ts` still holds the dead cutover steps.** W2–W8 and W11 always `return 'pending';` and keep their old bodies in block comments. `buildMockedWorkflowConfig`, `buildSubprocessEnv` and two `eslint-disable-next-line` lines (one on the unused `assert` import, one on `buildMockedWorkflowConfig`) serve only them. `grep -rn "return 'pending'" features/regression` finds 11 lines, all in `whenSteps.ts`: W1–W11.
- **The vocabulary still registers the dead phrases.** `features/regression/vocabulary.md` lists W2–W8 and W11 (lines 85-91 and 94) and describes W1, W9 and W10 as pending without the harness.
- **The records still describe a pending suite.**
  - ADR-0037 keeps Divergence item 3, the Consequences bullet "the intended gain … is not delivered yet", and the Confirmation sentence "The hybrid execution model is not in force; see Divergence, item 3".
  - ADR-0021 keeps a Consequences bullet saying the steps "are still pending", and a Confirmation line saying the workflow "is failing; see ADR-0037".
  - `app_docs/feature-9gjajh-bdd-regression-suite.md` says three smoke files "stay pending".

**Expected:**

- The `@regression` run reports no pending, undefined or failed scenario, and exits 0.
- The four smoke scenarios run real `adws/adwChore.tsx` and `adws/adwSdlc.tsx` child processes through the hermetic harness, and assert only on artefacts:
  - the top-level state file;
  - the exit code;
  - the GitHub writes the `gh` shadow logged and the harness replayed against the mock.
- No step under `features/regression/` returns `'pending'`.
- The ADRs and the living doc describe the suite as it runs.

**Actual:** 4 scenarios pending, Cucumber exit 1, 11 `return 'pending'` lines, stale records.

## Problem Statement

1. The four full-pipeline smoke scenarios never reach the subprocess harness. Even with it, their manifests cannot carry an `adwChore` or `adwSdlc` run to `awaiting_merge`, nor an `adwSdlc` run to `paused`.
2. Dead phrases (W2–W8, W11) and the pending guards of W1, W9 and W10 keep `return 'pending'` in `features/regression/`.
3. Nothing protects `agents/paused_queue.json`, a checkout-level file that a paused child run appends to.
4. ADR-0037 (Divergence item 3, a Consequences bullet, Confirmation), ADR-0021 (a Consequences bullet, a Confirmation line) and the living doc still record a pending suite.

## Solution Statement

Run the four scenarios on the subprocess harness #966 built, and program the Claude CLI stub per slash command:

- **Tags.** Add `@subprocess` next to `@regression @smoke` in the three smoke files, as #967 did for `cron_trigger_spawn` and `promotion_threshold_auto_ramp`.
  - Drop G11 from them.
  - Keep every scenario and its name.
  - Rewrite the Thens to what the issue asks for.
- **Manifests.** Rewrite the four manifests in place as `byCommand` manifests whose top level carries `"onCommitCommand": "stage-all-and-commit"`. W1's `deliverStubMarker` already copies G3's manifest to `<TARGET_REPOS_DIR>/.adw-stub-manifest.json`, which every agent running in the workspace or a worktree finds. Each entry answers what its caller parses, or writes the file its phase needs. The answers that already pass in the surface rows are reused verbatim:
  - `surface-chore-plan-phase.json`, `surface-plan-phase.json`, `surface-build-phase.json`
  - `surface-unit-test-phase.json`, `surface-diff-evaluation-phase.json`, `surface-review-phase.json`
  - `surface-alignment-phase.json`, `surface-document-phase.json`, `surface-pr-phase.json`
- **The pause.** The rate-limit manifest answers **every** call rate-limited, with `rateLimitType: "seven_day"` and a fixed `resetsAt` far in the future.
  - The branch-name fallback, the install phase and the scenario phase swallow the rejection.
  - The plan agent's `RateLimitError` reaches `runPhasesParallel`, where any type other than `five_hour` is enqueued.
  - `handleRateLimitPause` then writes `paused`, appends to the pause queue and exits 0.
- **Harness.** `createSubprocessHarness` saves `agents/paused_queue.json` alongside the auth gate and the cron files, and restores it byte for byte at teardown.
- **Cleanup.**
  - Delete W2–W8, W11, their comments, `buildMockedWorkflowConfig`, `buildSubprocessEnv`, the unused `assert` import and both `eslint-disable` lines. `ORCHESTRATOR_FILES` is already gone (#966).
  - Remove the `return 'pending'` guards from W1, W9 and W10. Without a harness they now fail through `requireHarness`, so a step still never passes by doing nothing.
  - Retire the eight vocabulary rows.
- **Records.**
  - Close ADR-0037 Divergence item 3 and fix the Consequences and Confirmation text.
  - Update ADR-0021.
  - Update the living doc.

No production code under `adws/` changes.

## Steps to Reproduce

Run one at a time, never two Cucumber processes from the same checkout. The rows share `agents/`, `logs/` and spawn locks.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary; echo "exit=$?"`
   - Expect: the four smoke scenarios above are reported pending, and `exit=1`.
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@smoke and not @subprocess and not @webhook" --format summary; echo "exit=$?"`
   - Expect: exactly 4 scenarios, all pending at W1, and `exit=1`.
3. `grep -rn "return 'pending'" features/regression`
   - Expect: 11 lines, all in `features/regression/step_definitions/whenSteps.ts` (W1–W11).
4. `grep -n "Smoke and surface scenarios are pending" specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`
   - Expect: Divergence item 3 is present.

## Root Cause Analysis

1. **Gating.** The harness hook is keyed on `@regression and (@subprocess or @webhook)` and never on `@smoke`. Until a smoke file opts in with `@subprocess`, W1 has no harness and returns pending. #967 opted in the three smoke files that need no agent pipeline. It left these four for this slice because their manifests cannot drive one.
2. **The manifests predate both the per-command stub (#963) and the real pipeline.** They were written for the in-process cutover that never happened (6ffd1416), and asserted on a `.adw/state.json` the manifest wrote itself. #963 removed that self-written state and nothing replaced it.
   - Each pipeline agent is selected by the slash command that opens its prompt.
   - The callers are strict:
     - plan file: `getPlanFilePath`;
     - JSON extraction: `runCommandAgent` with `extractOutput`, which retries through `/correct_output`;
     - the commit agent, which throws.

   A single prose payload satisfies none of them.
3. **The pause path filters rate limits before they reach `runPhase`.** Facts below are confirmed by tracing `adwSdlc.tsx`.
   - **`/generate_branch_name`.** The first call runs in `initializeWorkflow` with the ADW checkout as cwd. It never finds the marker under `os.tmpdir()`. Its default answer fails `validateSlug`, and `resolveWorkflowBranchName` falls back to `feature-issue-<N>`. That catch also swallows a `RateLimitError`.
   - **`/install`.** Runs in the worktree and finds the marker, but `executeInstallPhase` catches everything.
   - **`/feature` and `/scenario_writer`.** Run in parallel. The scenario phase is non-fatal, but `executePlanPhase` has no catch. Its `RateLimitError` goes through `runPhasesParallel` → `decideRateLimitWait`, which enqueues any type other than `five_hour` → `failParallel` → `handleRateLimitPause` (`adws/phases/workflowCompletion.ts:113-159`).
   - **`handleRateLimitPause`** writes `workflowStage: 'paused'`, appends to `agents/paused_queue.json` (`PAUSE_QUEUE_PATH`, cwd-relative), posts the `paused` comment and calls `process.exit(0)`.
   - **`five_hour`** with a future reset sleeps in process (`sleepUntil`) and re-runs the phase. The old manifest's single `five_hour` rejection was spent on `/install` anyway.
4. **Dead steps.** W2–W8 and W11 come from the #492 cutover stub (commit 6ffd1416). The surface tier now runs on W-S1–W-S4 (in-process, #963–#965) and on W1/W9/W10 (subprocess, #966–#967); the webhook rows run on W-WH*/W-CD1. Nothing calls W2–W8 or W11. The W1/W9/W10 guards existed only to keep un-harnessed rows pending. After this slice no row needs that, and the acceptance grep forbids it.
5. **Records.** ADR-0037 item 3 was written while the suite was pending (owner ruling 2026-09-30). The ADR-0021 bullet and line point at it.
   - ADR-0037 also still lists items 4 and 6, though both bugs are fixed:
     - #960 (ee84e005) and #961 (b2f7f8d4) each removed their item.
     - The conflict-resolution merges 3d6b78a1 and 736b80a9 brought the two lines back.
   - Verified on this branch:
     - `grep -rnE "readFileSync\(.*'adws/" features/regression/step_definitions` finds nothing.
     - `grep -rn "mockContext === null" features/regression/step_definitions` finds nothing.
     - `features/webhook_ensure_cron_on_every_event.feature` no longer exists.

## Relevant Files
Use these files to fix the bug:

- `README.md` — project overview; read first.
  - It has an uncommitted change at planning time, in the Project Structure lines for `smoke/` and `support/`, that this plan did not make. Leave it as it is.
  - No README change is needed for this bug.
- `.adw/coding_guidelines.md` — the guidelines that bind the step-definition and harness edits:
  - no comments that restate code or cite issue numbers;
  - remove unused code and imports;
  - files under 300 lines.
- `features/regression/smoke/adw_chore_diff_verdicts.feature`, `adw_sdlc_happy_path.feature`, `pause_resume_rate_limit.feature` — the four pending scenarios; rewritten in place.
- `features/regression/smoke/cron_trigger_spawn.feature`, `promotion_threshold_auto_ramp.feature` — the precedent for `@regression @smoke @subprocess` and the description style. Not edited.
- `features/regression/surfaces/row-16-adwPatch-planPhase-happy.feature` — precedent: a full orchestrator run under W1 with a `byCommand` manifest and no G11. Not edited.
- `test/fixtures/jsonl/manifests/safe-verdict.json`, `regression-possible-verdict.json`, `adw-sdlc-happy.json`, `rate-limit-pause-resume.json` — rewritten in place.
  - Only the three smoke features reference them.
  - None writes `.adw/state.json` any more; #963 (b0659c8e) removed those edits. Keep it that way.
- `test/fixtures/jsonl/manifests/surface-*.json` — proven per-command answers to copy. Not edited.
- `test/mocks/manifestSchema.ts`, `manifestInterpreter.ts`, `manifestRefusalGuard.ts`, `stubResponse.ts`, `stubMarker.ts`, `claude-cli-stub.ts` — what a manifest can say:
  - `byCommand` entries hold only `jsonlPath`, `edits`, `commits` and `response`.
  - `onCommitCommand` is top-level only, and applies to `/commit` when no entry matches it.
  - `resetsAt` is a literal number.
  - The refusal guard rejects `.adw/state.json`, `agents/**` and paths outside the worktree.
  - Not edited.
- `features/regression/step_definitions/whenSteps.ts` — W1, W9, W10 guards; W2–W8 and W11 deleted.
- `features/regression/step_definitions/world.ts` — the `subprocess` field's comment says W1, W9 and W10 "stay pending"; update it.
- `features/regression/support/hooks.ts` — the comment on the harness hook mentions "the rows that stay pending"; update it.
- `features/regression/support/subprocessHarness.ts` — add the pause-queue snapshot and restore.
- `features/regression/support/subprocessDrivers.ts`, `subprocessRun.ts`, `harnessOrchestrators.ts`, `fixtureTargetRepo.ts`, `fixtureWorktree.ts`, `forgeShadow.ts` — how W1 runs and what the child sees. Read only.
  - `deliverStubMarker`: the marker goes to `<TARGET_REPOS_DIR>/.adw-stub-manifest.json`.
  - 120 s orchestrator bound.
  - Hermetic env; `requireHarness`; the workspace `.gitignore` for the stub files.
- `features/regression/step_definitions/givenSteps.ts`, `thenSteps.ts`, `subprocessSteps.ts` — the reused phrases. Not edited: G1, G3, G4, T1, T2, T3, T5, T7, T8, T9, T12.
- `features/regression/vocabulary.md` — retire W2–W8 and W11; reword W1, W9 and W10 and the "Smoke processes" section.
- `.claude/skills/promote-regression-vocabulary/scripts/list-registered-phrases.ts` — parses `| id | \`phrase\` | …` rows. The retirement must leave the remaining rows in that shape.
- `adws/adwChore.tsx` — the chore phase order and `postEscalationComment` (`## Chore Escalation: Regression Possible`). It writes `awaiting_merge` after `executePRPhase` and `preApprovePr`, and never merges. Read only.
- `adws/adwSdlc.tsx` — the SDLC phase order. Read only. It writes `awaiting_merge` after:
  - install, then plan and scenario in parallel, then alignment, build, step-def and unit test;
  - the scenario loop, then the review loop;
  - document, PR, proof publish and promotion advisory.
- `adws/agents/planAgent.ts` (`getPlanFilePath`), `adws/agents/buildAgent.ts` (`/implement-tdd` once an `@adw-<N>` feature exists), `adws/agents/gitAgent.ts` + `adws/phases/branchNameResolution.ts` (branch-name fallback), `adws/phases/installPhase.ts`, `scenarioPhase.ts`, `stepDefPhase.ts` (non-fatal phases), `adws/agents/stepDefAgent.ts` (`{"removedScenarios":[]}`), `adws/agents/testAgent.ts` (JSON array), `adws/phases/alignmentPhase.ts` (runs only with a plan file and a feature file tagged `@adw-<N>`), `adws/phases/scenarioTestFixLoop.ts` (returns at once when the first proof has no blocker failures), `adws/phases/unitTestPhase.ts` (no JUnit report → `adw:unverified` label and comment), `adws/phases/documentPhase.ts` (always commits), `adws/phases/prPhase.ts` — why each manifest entry looks as it does. Read only.
- `adws/core/rateLimitWaitPolicy.ts`, `adws/core/phaseRunner.ts`, `adws/phases/workflowCompletion.ts` (`handleRateLimitPause`), `adws/core/pauseQueue.ts` (`PAUSE_QUEUE_PATH = 'agents/paused_queue.json'`, cwd-relative) — the pause path. Read only.
- `adws/forge/workflowCommentsIssue.ts` — the stage-comment headings the SDLC Thens match: `## :white_check_mark: Review Passed`, `## :link: Pull Request Created`. Read only.
- `node_modules/@paysdoc/devplatform/dist/providers/github/commands/labelCommands.js` — `applyLabel` runs `gh issue edit <n> --repo <o/r> --add-label '<name>'`. The shadow logs that as `POST …/issues/<n>/labels {"labels":[name]}`, the request T12 reads. Read only.
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md` — the Divergence, Consequences and Confirmation edits.
- `specs/adr/0021-behavioural-test-harness-with-mocked-boundaries.md` — the Consequences and Confirmation edits.
- `.claude/skills/write-an-adr/SKILL.md` — normally only `## Divergence` may change in an accepted ADR. The issue explicitly orders the Consequences and Confirmation edits, which take precedence. Change nothing else in either ADR.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — conditional doc. It owns `features/regression/**`, `test/mocks/**` and `test/fixtures/jsonl/manifests/**`, the smoke scenarios, the subprocess harness, the `gh` shadow and the per-command manifests. Update it.
- `app_docs/feature-9gjajh-test-and-scenario-phases.md`, `app_docs/feature-9gjajh-pause-and-auth-queues.md`, `app_docs/feature-9gjajh-claude-stream-parser.md` — conditional docs. Context only:
  - the scenario proof and the fix loop;
  - the pause queue;
  - `rateLimitWaitPolicy.ts` and `phaseRunner.ts`.

### New Files
None.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Record the baseline
- Run the reproduction commands of "Steps to Reproduce", one at a time. Save the first to `/tmp/adw-968-regression.before`:
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary > /tmp/adw-968-regression.before 2>&1; echo "exit=$?"`
- Confirm that the only non-passing scenarios are the four smoke scenarios. Note any other non-passing scenario as pre-existing and outside this plan.
- Record the pause queue: `shasum agents/paused_queue.json 2>/dev/null || echo absent`, and keep the output for task 12.

### 2. Snapshot and restore the pause queue in the subprocess harness (`features/regression/support/subprocessHarness.ts`)
- Import `PAUSE_QUEUE_PATH` from `'../../../adws/core/pauseQueue.ts'`.
- Add `const PAUSE_QUEUE_FILE = resolve(REPO_ROOT, PAUSE_QUEUE_PATH);` next to `AUTH_GATE_FILE`. `PAUSE_QUEUE_PATH` is cwd-relative, and the child runs with the checkout as cwd.
- In `createSubprocessHarness`:
  - add `const savedPauseQueue = saveFile(PAUSE_QUEUE_FILE);` beside `savedAuthGate`;
  - make the restore entry `[savedAuthGate, savedPauseQueue, ...savedCronFiles].forEach(restoreFile)`.
- Do not remove the queue at setup. A run only appends to it, and the restore puts back the exact bytes, or removes the file if it was absent.
- The restore entry is pushed during setup, so it runs after the entries a run pushes later: killing the process group and removing `agents/<adwId>/`. No child can append after the restore.
- Extend the file's header comment, which lists what setup saves, with "the pause queue, which a paused run appends to". Keep the comment style; cite no issue numbers.

### 3. Remove the pending guards and the dead steps (`features/regression/step_definitions/whenSteps.ts`)
- Delete the following:
  - W2–W8 and W11, their `ISSUE-3-CUTOVER` comments and block-commented bodies;
  - `buildMockedWorkflowConfig` and `buildSubprocessEnv` (used only by `buildMockedWorkflowConfig`);
  - the `import assert from 'assert';` line;
  - both `// eslint-disable-next-line @typescript-eslint/no-unused-vars` lines.
- In W1, W9 and W10, delete the `if (!this.subprocess) return 'pending';` line. Their drivers already call `requireHarness` (W1 and W9 through `claimAdwId`; W10 first thing). Without the harness they fail with "Expected the @regression and (@subprocess or @webhook) Before hook to have set up the subprocess harness".
- Reword the three comments above them:
  - W1: `// Fails without the subprocess harness, so a scenario outside \`@regression and (@subprocess or @webhook)\` never passes by doing nothing.`
  - W9: `// Fails without the subprocess harness, for the reason W1 does.`
  - W10: `// Fails without the subprocess harness, for the reason W1 does. Records no exit code: the harness kills the cron.`
- Keep W16 and the imports it needs: `execFileSync`, `resolve`, `dirname`, `fileURLToPath`, `__dirname` and `ROOT`. Keep the step options (`timeout: 150_000`, `60_000`, `90_000`) unchanged.
- The result holds W1, W9, W10 and W16 only, about 60 lines.

### 4. Update the two stale comments
- `features/regression/step_definitions/world.ts`, the `subprocess` field: "…; without it W1, W9 and W10 stay pending." becomes "…; without it W1, W9 and W10 fail."
- `features/regression/support/hooks.ts`, the comment above the `@regression and (@subprocess or @webhook)` Before hook. Keep the first line about ordering. Replace the second with: `// A \`@webhook\` scenario needs the same workspace and adwId claims. The hook keys on neither \`@smoke\` nor \`@surface\`: the in-process surface rows need no harness.`

### 5. Rewrite `test/fixtures/jsonl/manifests/safe-verdict.json`
Replace the whole file with the manifest below. It runs W1 `chore` for issue 200 under adwId `chore-smoke-200`.
- `/chore` writes the plan where `getPlanFilePath` finds it.
- `/implement` makes the docs-only edit, which the top-level `onCommitCommand` commits when the build phase calls `/commit`.
- `/diff_evaluator` answers `safe`.
- `/pull_request` answers the title/body JSON.
- `/install`, `/generate_step_definitions` and `/test` answer what their callers accept, so no call goes through `/correct_output`.

Do not add `/generate_branch_name`. That agent runs with the ADW checkout as its cwd, never finds the marker, and falls back to `chore-issue-200`.

```json
{
  "jsonlPath": ".adw-stub-payload.json",
  "edits": [
    {
      "path": ".adw-stub-payload.json",
      "contents": "[{\"type\":\"text\",\"text\":\"Chore smoke stub (safe verdict): the prompt opened with no command this manifest answers.\\n\"}]\n"
    }
  ],
  "onCommitCommand": "stage-all-and-commit",
  "byCommand": {
    "/install": {
      "jsonlPath": ".adw-stub-payload.json",
      "edits": [
        { "path": ".adw-stub-payload.json", "contents": "[{\"type\":\"text\",\"text\":\"The project context was read.\\n\"}]\n" }
      ]
    },
    "/chore": {
      "jsonlPath": ".adw-stub-payload.json",
      "edits": [
        { "path": ".adw-stub-payload.json", "contents": "[{\"type\":\"text\",\"text\":\"The chore plan for issue 200 was written.\\n\"}]\n" },
        { "path": "specs/issue-200-adw-chore-smoke-200-sdlc_planner-chore-smoke.md", "contents": "# Chore Plan: chore smoke\n\n## Steps\n1. Add a note to README.md\n2. Commit it\n" }
      ]
    },
    "/implement": {
      "jsonlPath": ".adw-stub-payload.json",
      "edits": [
        { "path": ".adw-stub-payload.json", "contents": "[{\"type\":\"text\",\"text\":\"The chore was implemented: README.md gained a note.\\n\"}]\n" },
        { "path": "README.md", "contents": "Fixture CLI tool for ADW behavioral testing.\n\nThe chore smoke scenario added this note.\n" }
      ]
    },
    "/generate_step_definitions": {
      "jsonlPath": ".adw-stub-payload.json",
      "edits": [
        { "path": ".adw-stub-payload.json", "contents": "[{\"type\":\"text\",\"text\":\"{\\\"removedScenarios\\\":[]}\"}]\n" }
      ]
    },
    "/test": {
      "jsonlPath": ".adw-stub-payload.json",
      "edits": [
        { "path": ".adw-stub-payload.json", "contents": "[{\"type\":\"text\",\"text\":\"[{\\\"test_name\\\":\\\"app_tests\\\",\\\"passed\\\":true,\\\"execution_command\\\":\\\"N/A\\\",\\\"test_purpose\\\":\\\"Runs the fixture's unit tests\\\",\\\"testcase_count\\\":1}]\"}]\n" }
      ]
    },
    "/diff_evaluator": {
      "jsonlPath": ".adw-stub-payload.json",
      "edits": [
        { "path": ".adw-stub-payload.json", "contents": "[{\"type\":\"text\",\"text\":\"{\\\"verdict\\\":\\\"safe\\\",\\\"reason\\\":\\\"The diff changes README.md only.\\\"}\"}]\n" }
      ]
    },
    "/pull_request": {
      "jsonlPath": ".adw-stub-payload.json",
      "edits": [
        { "path": ".adw-stub-payload.json", "contents": "[{\"type\":\"text\",\"text\":\"{\\\"title\\\":\\\"chore: #200 - Issue 200\\\",\\\"body\\\":\\\"Closes #200\\\\nImplements #200\\\\n\\\\nADW tracking ID: chore-smoke-200\\\"}\"}]\n" }
      ]
    }
  }
}
```

- `README.md` of `test/fixtures/cli-tool/` is the single line `Fixture CLI tool for ADW behavioral testing.`. Edits are full-content writes, so the new contents repeat it.
- Validate the file: `bun -e "JSON.parse(require('fs').readFileSync('test/fixtures/jsonl/manifests/safe-verdict.json','utf8'))"`.

### 6. Rewrite `test/fixtures/jsonl/manifests/regression-possible-verdict.json`
Use the same manifest as task 5 with these differences. The scenario title says "adws-touching change", and the old manifest touched `adws/`.
- Payload texts say "regression_possible" instead of "safe verdict".
- `/implement` writes `adws/smoke-stub.ts` with `// The chore smoke scenario's change to adws/.\nexport const smokeStub = true;\n`, instead of the README edit. The payload reads "The chore was implemented: adws/smoke-stub.ts was added."
- `/diff_evaluator` answers `{\"verdict\":\"regression_possible\",\"reason\":\"The diff adds adws/smoke-stub.ts.\"}`, escaped as in task 5.
- Add a `/review` entry that passes:
  - copy the payload shape of `surface-review-phase.json`;
  - `{"success":true,"reviewSummary":"The chore review found no blockers.","reviewIssues":[],"screenshots":[]}`;
  - escaped like the `/diff_evaluator` payload.
- Add a `/document` entry, shaped like `surface-document-phase.json`:
  - It writes `app_docs/feature-chore-smoke-200-chore-smoke.md` with `# Chore: chore smoke\n\nThe escalated chore's document phase wrote this page.\n`.
  - It answers `Documentation written.\napp_docs/feature-chore-smoke-200-chore-smoke.md\n`.
  - The document phase always calls the commit agent, and the `/commit` stand-in fails on a clean worktree, so this file is load-bearing.
- Validate the JSON as in task 5.

### 7. Rewrite `test/fixtures/jsonl/manifests/adw-sdlc-happy.json`
Same top level as task 5: a prose payload for unmatched prompts and `"onCommitCommand": "stage-all-and-commit"`. The `byCommand` entries, in pipeline order:

- `/install`: answers `The project context was read.`
- `/feature`:
  - writes `specs/issue-100-adw-sdlc-smoke-100-sdlc_planner-sdlc-smoke.md` with `# Implementation Plan: sdlc smoke\n\n## Steps\n1. Add src/sdlcSmoke.ts\n2. Export the smoke value\n`;
  - answers `The implementation plan for issue 100 was written.`
- `/scenario_writer`:
  - writes `features/feature-100.feature` with `@adw-100\nFeature: sdlc smoke\n\n  Scenario: the smoke value is exported\n    Given the sdlc smoke module\n    When its value is read\n    Then it is the smoke value\n`;
  - `findScenarioFiles` scans the worktree for `@adw-100`, so alignment runs.
  - It has **no edit of `.adw-stub-payload.json`**. Its `jsonlPath` is still `.adw-stub-payload.json`, so it streams whatever payload is there.
    - `/feature` and `/scenario_writer` run concurrently in the same worktree (`runPhasesParallel`). Two writers of one payload file could interleave, and a torn read makes a stub exit 1.
    - With `/feature` the only writer, the plan stub's read is safe. A torn read could then hit only the scenario stub, whose output nobody parses, whose phase is non-fatal, and whose feature file is written before it reads.
    - Do not give the scenario writer a payload file under another name: the workspace `.gitignore` covers only the three stub file names, and the build's `git add -A` would commit it.
- `/align_plan_scenarios`: answers `{"aligned":true,"warnings":[],"changes":[],"summary":"The plan and the scenarios already agree."}`, the `surface-alignment-phase.json` shape. No changes, so alignment does not commit.
- `/implement-tdd`, **not** `/implement`:
  - `runBuildAgent` (`adws/agents/buildAgent.ts:71-73`) switches to `/implement-tdd` whenever `findScenarioFiles` finds a feature tagged `@adw-100` in the worktree, and the scenario writer has just written one. `byCommand` matches exactly, so an `/implement` entry would never be selected.
  - It writes `src/sdlcSmoke.ts` with `export function sdlcSmoke(): string {\n  return 'smoke';\n}\n`.
  - It answers `The plan was implemented.`
  - The build phase's `/commit` then commits it, together with the uncommitted scenario file.
- `/generate_step_definitions`: answers `{"removedScenarios":[]}` and writes **no** file. This is load-bearing:
  - A step definition in the worktree makes the scenario proof run the fixture's fenced `## Run Scenarios by Tag` command, which exits 127 (surface rows 21 and 22).
  - The `@review-proof` blocker then fails, and the scenario loop ends in `ScenarioHermeticityError`.
  - With none, the proof runs no tag and `runScenarioTestFixLoop` returns on its first attempt.
- `/test`: the JSON array of task 5. The fixture's `## Run Tests` is `N/A`, so no JUnit report appears and the unit-test phase applies `adw:unverified` and posts its `unverified` comment; it is a warning, not a failure.
- `/review`: the passing JSON of task 6, with summary `The SDLC review found no blockers.`
- `/document`:
  - writes `app_docs/feature-sdlc-smoke-100-sdlc-smoke.md` with `# Feature: sdlc smoke\n\nThe SDLC smoke run's document phase wrote this page.\n`;
  - answers `Documentation written.\napp_docs/feature-sdlc-smoke-100-sdlc-smoke.md\n`.
- `/pull_request`: answers `{"title":"feat: #100 - Issue 100","body":"Closes #100\nImplements #100\n\nADW tracking ID: sdlc-smoke-100"}`, escaped as in task 5.

The top-level `edits` keep only the payload file: drop `specs/plan.md`, `src/featureStub.ts` and `README.md`. Validate the JSON.

### 8. Rewrite `test/fixtures/jsonl/manifests/rate-limit-pause-resume.json`
Replace it with:

```json
{
  "jsonlPath": ".adw-stub-payload.json",
  "edits": [
    {
      "path": ".adw-stub-payload.json",
      "contents": "[{\"type\":\"text\",\"text\":\"Rate-limit smoke stub: every call is answered rate-limited, so this payload is never streamed.\\n\"}]\n"
    }
  ],
  "response": { "kind": "rate-limited", "rateLimitType": "seven_day", "resetsAt": 4102444800 }
}
```

- **No `byCommand` and no `limitedInvocations`.** Every call that finds the marker is rejected, and the stub writes no `.adw-stub-invocations` counter. A "first call only" response does not pause `adwSdlc`:
  - `/generate_branch_name` never sees the manifest;
  - `/install` and `/scenario_writer` swallow the rejection.
  - The plan agent's rejection is the one that reaches `runPhase`.
- **`resetsAt: 4102444800`** is 2100-01-01T00:00:00Z.
  - A static manifest cannot say "now + some hours", and `resetsAt` must be a literal number (`manifestSchema.ts`).
  - The capture's own epoch has already passed, and the stub's default is only now + 300 s.
  - A `seven_day` rejection is enqueued whatever the distance, so a far-future reset keeps the manifest valid indefinitely.

### 9. Rewrite the three smoke features
Keep each file, its Feature title, every scenario and every scenario name. Add `@subprocess` to the tag line. Remove G11. Add a short description under `Feature:` in the style of `cron_trigger_spawn.feature`. It says what the child runs and how the manifest programs it; no issue numbers.

- **`features/regression/smoke/adw_chore_diff_verdicts.feature`**
  - Tag line: `@regression @smoke @subprocess`.
  - Background: `Given the mock GitHub API is configured to accept issue comments` and `And an issue 200 exists in the mock issue tracker`. Drop G11.
  - Description content:
    - The real chore orchestrator runs as a child process against the acme/widgets workspace, behind the gh shadow.
    - The stub answers each slash command from the scenario's manifest: the plan lands where `getPlanFilePath` finds it, and the build's edit is committed, so the diff evaluator judges a real diff.
    - `safe` opens the pull request.
    - `regression_possible` posts the escalation comment, runs the review, which passes, and the document phase, then opens the pull request.
    - Either way the run pre-approves the pull request, leaves the merge to the cron and records `awaiting_merge`.
  - Scenario `safe diff verdict — docs-only change completes without escalation`:
    ```gherkin
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/safe-verdict.json"
    When the "chore" orchestrator is invoked with adwId "chore-smoke-200" and issue 200
    Then the state file for adwId "chore-smoke-200" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
    And the mock GitHub API recorded a PR creation for issue 200
    And the mock harness recorded zero PR-merge calls
    ```
  - Scenario `regression_possible diff verdict — adws-touching change escalates to review`:
    ```gherkin
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/regression-possible-verdict.json"
    When the "chore" orchestrator is invoked with adwId "chore-smoke-200" and issue 200
    Then the state file for adwId "chore-smoke-200" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 200
    And the mock GitHub API recorded a comment containing the text "Chore Escalation: Regression Possible"
    ```
- **`features/regression/smoke/adw_sdlc_happy_path.feature`**
  - Tag line: `@regression @smoke @subprocess`.
  - Description content:
    - The real SDLC orchestrator runs every phase as a child process.
    - Each agent is answered by its own manifest entry.
    - The proof runs no tag, because no step definition is written.
    - The fixture's `N/A` unit-test command leaves no JUnit report, so the issue is labelled `adw:unverified`.
    - The run ends `awaiting_merge` with the pull request open.
  - Scenario `adwSdlc completes the full pipeline end-to-end`:
    ```gherkin
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 100 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "sdlc-smoke-100" and issue 100
    Then the state file for adwId "sdlc-smoke-100" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
    And the state file for adwId "sdlc-smoke-100" records no error
    And the mock GitHub API recorded a PR creation for issue 100
    And the mock GitHub API recorded a comment on issue 100
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Review Passed"
    And the mock GitHub API recorded a comment containing the text "## :link: Pull Request Created"
    And the mock GitHub API recorded an application of the "adw:unverified" label on issue 100
    ```
- **`features/regression/smoke/pause_resume_rate_limit.feature`**
  - Tag line: `@regression @smoke @subprocess`.
  - Description content:
    - Every agent call is answered rate-limited for the seven-day window.
    - The branch-name fallback, the install phase and the scenario phase absorb it.
    - The plan agent's rejection reaches the phase runner, which hands any limit other than the five-hour window to the pause queue instead of sleeping in process.
    - The run records `paused`, appends to the pause queue and exits 0.
    - The harness puts the checkout's queue file back afterwards.
    - Resuming is covered by `features/regression/pause-queue/`.
  - Scenario `orchestrator records paused stage on rate-limit detection`:
    ```gherkin
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/rate-limit-pause-resume.json"
    And an issue 400 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "rate-limit-smoke-400" and issue 400
    Then the state file for adwId "rate-limit-smoke-400" records workflowStage "paused"
    And the orchestrator subprocess exited 0
    ```
- Every phrase is already registered: G1, G3, G4, W1, T1, T2, T3, T5, T7, T8, T9 and T12. Add no new phrase.

### 10. Run the four scenarios and make them pass by changing manifests only
- Run each on its own, one after another:
  - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@smoke" --name "safe diff verdict"`
  - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@smoke" --name "regression_possible diff verdict"`
  - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@smoke" --name "full pipeline end-to-end"`
  - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@smoke" --name "paused stage on rate-limit detection"`
- **Debugging a failed run.**
  - T1 runs first, so a wrong stage names the stage the run stopped at.
  - The harness removes `agents/<adwId>/` and `logs/<adwId>/` at teardown. To see the child's output, temporarily append `And the orchestrator subprocess's output contains "<text that cannot occur>"` (T-SP2) to the scenario. Its failure prints the last 40 lines of output. Remove the line afterwards.
  - A `gh shadow: unsupported: <argv>` failure means the run made a `gh` call the shadow does not model. Add that call to the shadow (`test/mocks/ghShadowReads.ts` / `ghShadowWrites.ts`) the way the existing handlers are written, with a Vitest case beside the existing `test/mocks/__tests__/` tests. Do not change production code.
- **Rules.**
  - Do not edit anything under `adws/`.
  - Do not raise `ORCHESTRATOR_TIMEOUT_MS` or the step timeouts.
  - Do not add `.adw/state.json`, `agents/**` or out-of-worktree edits; the refusal guard rejects them.
  - Do not weaken a Then. When the code does something other than what a Then claims, fix the input; if the input cannot be fixed, stop and report.

### 11. Update the vocabulary (`features/regression/vocabulary.md`)
- **Retire W2–W8 and W11.**
  - Delete their eight table rows (lines 85-91 and 94).
  - Directly under the When table, add one plain sentence, not a table row and with no backticked phrase: "W2–W8 and W11 are retired: no scenario ever ran them. Phases are driven by W-S1–W-S4 and webhooks by W-WH1–W-WH5 and W-CD1, and the numbers are not reused."
  - The remaining rows keep the `| id | \`phrase\` | … |` shape.
- **W1 row.** Replace "Pending in a scenario with no subprocess harness, one that carries neither `@subprocess` nor `@webhook`" with "Fails, naming the hook it needs, in a scenario with no subprocess harness, one that carries neither `@subprocess` nor `@webhook`".
- **W9 and W10 rows.** Replace "Pending in a scenario without `@subprocess`" with "Fails in a scenario without the subprocess harness".
- **"Smoke processes" section, intro (lines 450-455).**
  - Replace "Each of them is pending without the harness, so every other smoke and surface scenario stays pending, and a row opts in…" with: each of them fails without the harness, and a row opts in by carrying `@subprocess` next to `@regression`.
  - The harness is never keyed on `@smoke` or `@surface`, because the in-process surface rows need none.
- **"What the … Before hook sets up" paragraph.** Add that the hook saves `agents/paused_queue.json`, and that teardown restores it byte for byte with the auth gate and the cron files.
- **New paragraph after "The stub's manifest": "The full-pipeline smoke rows".** It covers:
  - `adw_chore_diff_verdicts`, `adw_sdlc_happy_path` and `pause_resume_rate_limit` run W1 `chore` or `sdlc` end to end.
  - Each manifest answers per slash command, and its top-level `onCommitCommand` stands in for `/commit`. Every agent whose phase commits must therefore leave a change:
    - `/chore` and `/feature` write the plan at `specs/issue-<N>-adw-<adwId>-sdlc_planner-<name>.md`, where `getPlanFilePath` finds it;
    - the build agent's command and `/document` write a file. The build agent's command is `/implement`, or `/implement-tdd` once a feature tagged `@adw-<N>` is in the worktree, as in the SDLC row;
    - `/scenario_writer` writes a feature tagged `@adw-<N>`;
    - the agents whose callers parse JSON answer with it.
  - `/generate_step_definitions` writes no step definition: with one, the proof would run the fixture's fenced scenario command, which exits 127.
  - `/generate_branch_name` runs with the ADW checkout as its cwd and falls back to `<type>-issue-<N>`.
  - The fixture's `N/A` unit-test command yields no JUnit report, hence `adw:unverified`.
  - The pause row answers every call with a `seven_day` limit and a reset in 2100. The plan phase's rejection is enqueued, because only `five_hour` is slept out in process (`adws/core/rateLimitWaitPolicy.ts`). So the run records `paused` and exits 0.
- **The section's closing "reuses already-registered phrases" list.** Add G1, T9 and T12.
- Check that nothing else names the retired rows: `grep -nE "\bW([2-8]|11)\b" features/regression/vocabulary.md` must list only the new retirement sentence.

### 12. Update ADR-0037 (`specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`)
- **Divergence.**
  - Delete item 3 ("**Smoke and surface scenarios are pending.** …").
  - Also delete items 4 ("**Two step definitions assert on source text.** …") and 6 ("**One feature file is never run.** …"). Their bugs are fixed and their own pull requests removed them (#960 ee84e005, #961 b2f7f8d4); the merges 3d6b78a1 and 736b80a9 restored the lines. The verification is in Root Cause Analysis, item 5.
  - Items 1 and 2 remain and keep their numbers, so the list is renumbered 1, 2.
  - In item 2, delete ", so both jobs are red until the pending scenarios of item 3 execute". The sentence then ends "…which a failed, pending or undefined scenario causes."
- **Consequences.** Delete the bullet "* Bad, because the intended gain, wiring bugs failing the suite, is not delivered yet: the smoke and surface scenarios do not execute (see More Information)."
- **Confirmation.** Replace the last sentence, "The hybrid execution model is not in force; see Divergence, item 3.", with a dated sentence. Use the date of the passing run of task 15. Its content:
  - The hybrid execution model is in force.
  - The smoke scenarios run real processes:
    - `adwChore.tsx`, `adwSdlc.tsx`, the promotion sweep and the cron trigger as child processes behind the `gh` shadow and the Claude CLI stub;
    - the cancel directive through the real webhook dispatcher.
  - The surface scenarios import phase functions. Rows 01, 10, 11, 16, 19, 29 and 30 need a process boundary and run on the same subprocess harness.
  - The suite still holds 6 smoke and 34 surface files. The counts are unchanged; keep them.
  - No step under `features/regression/` returns `'pending'`.
  - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` exits 0.
- Change nothing else in the ADR: front matter, Decision Outcome, More Information, and the 2026-09-29 facts including the 73-phrase count.

### 13. Update ADR-0021 (`specs/adr/0021-behavioural-test-harness-with-mocked-boundaries.md`)
- **Consequences.** Replace the bullet "* Bad, because the harness cannot yet carry a whole orchestrator run. … are still pending; see [ADR-0037](…)." with a bullet stating current facts:
  - The #492 spec recorded that mocking "the orchestrator's full GitHub App auth + target-repo workspace + end-to-end Claude pipeline" was out of reach.
  - The subprocess harness of ADR-0037 now runs `adwSdlc.tsx` and `adwChore.tsx` to completion as child processes. They run against a throwaway target workspace, with a fake `GITHUB_PAT`.
  - The Claude CLI stub answers each slash command from a per-command manifest.
  - A `gh` shadow stands in for GitHub; its writes are replayed against the GitHub API mock after the child exits.
  - Keep the ADR-0037 link.
- **Confirmation.** Replace the line "* `.github/workflows/regression.yml` runs the suite on the host and, on the daily schedule, in Docker. It is not a required check and is failing; see ADR-0037." with current facts:
  - It has a `host` and a `docker` job. The daily schedule runs both; a manual dispatch runs the one its `runtime` input names.
  - It is not a required check (ADR-0037, Divergence item 2).
  - Dated with the passing run of task 15: the `@regression` run reports no pending, undefined or failed scenario and exits 0.
- Change nothing else in the ADR.

### 14. Update the living doc (`app_docs/feature-9gjajh-bdd-regression-suite.md`)
- **Line 13.** "Run three smoke files for real (…; `adw_sdlc_happy_path`, `pause_resume_rate_limit` and `adw_chore_diff_verdicts` stay pending, they need the full agent pipeline):" becomes "Run all six smoke files for real:". Keep the three existing sub-bullets and add three:
  - **`adw_chore_diff_verdicts`** (`@subprocess`, two scenarios). W1 `chore` runs with `safe-verdict.json` or `regression-possible-verdict.json`.
    - safe: T1 `awaiting_merge`, T5 0, the PR for issue 200, no merge.
    - regression_possible: T1 `awaiting_merge`, T5 0, a comment on 200, and `Chore Escalation: Regression Possible`.
  - **`adw_sdlc_happy_path`** (`@subprocess`). W1 `sdlc` runs with `adw-sdlc-happy.json`. It asserts T1 `awaiting_merge`, T5 0, T9, the PR, the review-passed and PR-created comments, and the `adw:unverified` label.
  - **`pause_resume_rate_limit`** (`@subprocess`). W1 `sdlc` runs with `rate-limit-pause-resume.json`: `seven_day`, a reset in 2100, every call rejected. It asserts T1 `paused` and T5 0.
- **Line 27.** `whenSteps.ts (W1–W16 invocation vocabulary, …)` becomes "W1, W9, W10 and W16; W2–W8 and W11 are retired".
- **Line 32.** Delete the closing clause "the remaining surface rows and the smoke scenarios not listed below stay pending (ADR-0037 Divergence item 3 stays open)". Keep, or make explicit, that W-S1 and W-S2 run in-process with `NonPostingCostTracker` recording cost instead of posting it.
- **Line 33.**
  - The harness serves the surface rows 01, 10, 11, 16, 19, 29 and 30 and the five `@subprocess` smoke files.
  - W1 runs a real orchestrator asynchronously (`spawn`, `detached: true`) in the hermetic environment line 35 describes.
  - "Without the tag there is no harness, so those three stay `'pending'`" becomes "Without the tag there is no harness, and those three fail naming the hook they need".
- **Line 34.** Add `agents/paused_queue.json` to what the harness saves and restores.
- **Line 38.** After "Row 16 uses the committed manifest `surface-patch-run.json`", add that the full-pipeline smoke rows use the four rewritten manifests, delivered through the same `<TARGET_REPOS_DIR>/.adw-stub-manifest.json` marker.
- **Line 55.** "`W1`, `W9` and `W10` return `'pending'` unless…" becomes: they fail through `requireHarness` unless the scenario carries `@subprocess` or `@webhook`, and no step under `features/regression/` returns `'pending'`.
- **Line 58.** After "`awaiting_merge` is written only at the end of adwSdlc and adwChore, so no phase row asserts it", add "; the smoke rows do".
- **Line 100.** Note that feature-960's "reported pending" rows for W1 and W10 predate this change, and that the steps now fail without the harness. Keep the warning about running a second Cucumber process.
- **Line 109.** Replace the sentence about the daily run staying red "while the remaining smoke and surface `When` steps return `'pending'`". The new text:
  - Both jobs still fail on a pending or undefined scenario (strict).
  - No step returns `'pending'` any more, so a red run means a failed or undefined scenario.
  - ADW's own test phase scores a pending or undefined scenario as skipped (`classifyTestCase`), which is why a step must never pend.
- **Gotchas.** Add these entries:
  - The install, scenario and step-def phases are non-fatal, and the branch-name agent falls back to `<type>-issue-<N>`. So a rejected call there never pauses a run; the pause comes from the plan phase.
  - Only `five_hour` is slept out in process.
  - A paused run appends to the checkout's `agents/paused_queue.json`, and `appendToPauseQueue` skips an adwId already queued. The harness restores the file.
  - A full-pipeline manifest must write no step definition, or the fixture's fenced scenario command (exit 127) fails the scenario loop.
  - The build agent's command and `/document` must leave a change, because the `/commit` stand-in fails on a clean worktree. The build agent sends `/implement-tdd`, not `/implement`, once a feature tagged `@adw-<N>` is in the worktree.
  - The stub truncates its result text to 500 characters, so a JSON answer must stay shorter than that.
- Keep the doc's style: plain statements, no issue-number citations beyond those already used as identifiers, and no "stay pending" left anywhere: `grep -n "pending" app_docs/feature-9gjajh-bdd-regression-suite.md` should show only the strict-mode explanation and the feature-960 note.

### 15. Run the validation commands
- Run every command in "Validation Commands" in order, one at a time; never two Cucumber processes at once.
- Compare the `@regression` summary with `/tmp/adw-968-regression.before`:
  - the four smoke scenarios moved from pending to passed;
  - every scenario that passed before still passes;
  - none is pending, undefined or failed;
  - the exit code is 0.
- Write the dates into ADR-0037 (task 12) and ADR-0021 (task 13) from this run.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — no lint errors. The unused `assert` import and both `eslint-disable` lines are gone without new warnings.
- `bunx tsc --noEmit` — root type check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional type check passes.
- `bun run test:unit` — the Vitest suite passes, including `test/mocks/__tests__/`. It also covers any shadow handler added in task 10.
- `bun run build` — the build passes.
- `for f in test/fixtures/jsonl/manifests/{safe-verdict,regression-possible-verdict,adw-sdlc-happy,rate-limit-pause-resume}.json; do bun -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "BAD $f"; done` — all four manifests parse.
- `grep -rn "return 'pending'" features/regression; echo "grep-exit=$?"` — prints nothing and `grep-exit=1` (acceptance criterion 3).
- `grep -nE "buildMockedWorkflowConfig|buildSubprocessEnv|ISSUE-3-CUTOVER|eslint-disable|phase is executed with config|webhook handler receives" features/regression/step_definitions/whenSteps.ts` — prints nothing.
- `grep -nE '^\| W(2|3|4|5|6|7|8|11) \|' features/regression/vocabulary.md` — prints nothing.
- `bun .claude/skills/promote-regression-vocabulary/scripts/list-registered-phrases.ts 2>/dev/null | grep -E "phase is executed with config|webhook handler receives"` — prints nothing. The script still runs and the retired phrases are gone from the registry and the step definitions.
- `head -n 1 features/regression/smoke/*.feature` — every file starts `@regression @smoke`. All except `cancel_directive.feature` (`@webhook`) carry `@subprocess`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@smoke and not @subprocess and not @webhook" --format summary` — selects 0 scenarios. No smoke scenario is left outside the harness.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@smoke" --format summary; echo "exit=$?"` — 8 scenarios, 8 passed, `exit=0`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@surface" --format summary; echo "exit=$?"` — 34 scenarios, 34 passed, `exit=0`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary > /tmp/adw-968-regression.after 2>&1; echo "exit=$?"; tail -n 5 /tmp/adw-968-regression.after` — no pending, undefined or failed scenario, and `exit=0` (acceptance criteria 1 and 2). Diff the summary against `/tmp/adw-968-regression.before`: the only change is four pending → passed.
- `shasum agents/paused_queue.json 2>/dev/null || echo absent` — prints exactly what task 1 recorded. The harness restored the pause queue.
- `git status --porcelain` — only the files this plan names are changed (plus the pre-existing README.md change). No `.adw-stub-*` file, `tsconfig.tsbuildinfo` or stray `agents/` artefact appears.
- `grep -nE '^[0-9]+\. \*\*' specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md` — exactly two lines, numbered `1.` and `2.`.
- `grep -nE "Smoke and surface scenarios are pending|is not delivered yet|hybrid execution model is not in force|item 3" specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md` — prints nothing (acceptance criterion 4).
- `grep -nE "still pending|is failing; see ADR-0037" specs/adr/0021-behavioural-test-harness-with-mocked-boundaries.md` — prints nothing.
- `grep -nE "stay pending|stays pending|Divergence item 3" app_docs/feature-9gjajh-bdd-regression-suite.md` — prints nothing.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`):
  - comments state only constraints and reasons;
  - no issue numbers in code comments;
  - remove unused code and imports;
  - keep files under 300 lines (`whenSteps.ts` shrinks to about 60, and `subprocessHarness.ts` grows by about 4);
  - no decorators.
- No new library is needed.
- **ADR edits beyond `## Divergence`.** The write-an-adr skill allows only `## Divergence` to change in an accepted ADR. The issue explicitly orders the ADR-0037 Consequences and Confirmation edits and the ADR-0021 edits, so those are made, and nothing else in either ADR is touched.
- **ADR-0037 items 4 and 6.** The issue asks for item 3 only, plus a renumbering. Items 4 and 6 are stale lines that conflict-resolution merges restored after their own pull requests had removed them; the evidence is in Root Cause Analysis, item 5. Leaving them, renumbered to 3 and 4, would re-assert two fixed bugs as open divergences. They are removed instead, and the pull request description should say so. If the owner wants them kept, restoring the two lines is the whole revert.
- **Per-issue scenarios that describe the old pending guard.** These are `features/per-issue/feature-960.feature` (the "reported pending" rows for W1/W10, and §6, which lists the smoke scenarios that should still be pending) and `feature-966.feature` (the W9 outline). They are per-issue scenarios:
  - They run only under their own `@adw-<N>` tags, never in the `@regression` run.
  - They are swept 14 days after their pull requests merged.
  - They no longer hold once W1, W9 and W10 fail without a harness, which acceptance criterion 3 requires. Do not edit them in this issue.
- **`.adw/conditional_docs.md`.** Its condition text still mentions "W1/W10 staying pending" and lists three real-process smoke files. The document phase refreshes it; the plan does not edit `.adw/`.
- **Run time.**
  - The three full-pipeline runs add roughly a minute or two to the `@regression` run.
  - Each child is bounded at 120 s, and the CI jobs at 30 minutes.
  - Never run two Cucumber processes from the same checkout: the rows share `agents/`, `logs/` and spawn locks.
- **A cron on the developer's machine.** A real cron for another repository may read `agents/paused_queue.json` while the pause row runs. The entry belongs to `acme/widgets`, so that cron skips it ("none owned"). The harness restores the file at teardown.
- **What the SDLC run leaves on the forge** (traced, for checking the Thens):
  - The branch is `feature-issue-100`, from the branch-name fallback.
  - The shadow numbers the pull request 101: one past the highest issue or pull request it holds.
  - The issue gets only the `adw:unverified` label. The stack-coherence check does not fire for the fixture, and adwSdlc applies no PR label.
  - Issue comments include `review_passed` and `pr_created`.
  - Proof publish comments "No scenario proof available." on the pull request.
  - The promotion advisory is skipped: the issue has no `regression-promotion` label.
  - The checkout's `.env` can still supply names the harness leaves unset. `cucumber.js` pins `MAX_REVIEW_RETRY_ATTEMPTS=3`, which the child inherits.
- **Answers already proven in the surface rows.** These are reused as they are: plan file naming, the `/review`, `/diff_evaluator`, `/align_plan_scenarios`, `/test`, `/document` and `/pull_request` answer shapes, and `onCommitCommand`. A failure in task 10 is therefore most likely a subprocess-only difference: a `gh` call the shadow refuses, a commit with nothing to commit, or the proof finding a step definition. Look there first.
