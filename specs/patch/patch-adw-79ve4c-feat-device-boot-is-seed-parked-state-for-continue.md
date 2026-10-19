# Patch: Seed the parked workflow's top-level state so that the `## Continue` scenario can fail

## Metadata
adwId: `79ve4c-feat-device-boot-is`
reviewChangeRequest: `` Issue #1: features/per-issue/step_definitions/feature-989-phase.steps.ts: the `## Continue` branch this branch added to `When('{string} is posted on issue {int}')` (lines 105-109) breaks Rule 2 (the assertion can fail). With it, the Then steps of the scenario '"## Continue" on a workflow parked for "device_boot_failed" waives nothing' cannot fail either: 'the workflow for issue {int} is parked as {string}', and feature-1048-phase.steps.ts's 'the workflow for issue {int} is parked for the reason {string}' and 'the workflow's state records no waiver'. The branch calls `handleContinueDirective` and discards its answer. The workflow it acts on was parked by feature-1048-phase.steps.ts's 'the workflow's scenario test phase has run and parked the workflow as {string}'. That workflow is a feature-929 `createWorkflow` workflow, which never runs `initializeWorkflow`, so its top-level state holds only the `workflowStage` and `parkReason` that `parkWorkflow` writes, with no `issueNumber`. `handleContinueDirective` records a waiver only after checking that `state.issueNumber` equals the issue number. So a `## Continue` that wrongly waived `device_boot_failed` (for example, with the reason added to `WAIVABLE_PARK_REASONS`) would stop at that check and write nothing. The stage, the park reason and the absent `baseline` would read exactly as they do now, and the scenario passes whether or not `## Continue` waives this park. Resolution: Change only the step definitions: leave the .feature file alone and loosen no assertion. Run `## Continue` against the state a real parked run leaves. Write the workflow's `adwId` and `issueNumber` to its top-level state, as `initializeWorkflow` does (`writeInitialTopLevelState` in features/regression/support/phaseConfig.ts is prior art). Do it either before the phase runs in 'the workflow's scenario test phase has run and parked the workflow as {string}', or in the `## Continue` branch before it calls `handleContinueDirective`. A `## Continue` that waived this park would then re-arm `phase_timeout` and record a `baseline` waiver, and the existing Then steps would catch it. The `## Continue` branch can also assert that `handleContinueDirective` answered `false`. ``

## Issue Summary
**Original Spec:** `specs/issue-1048-adw-79ve4c-feat-device-boot-is-sdlc_planner-device-boot-retry-park.md`

**Issue:** The scenario `"## Continue" on a workflow parked for "device_boot_failed" waives nothing` (`features/per-issue/feature-1048.feature:222-234`, issue 104808) passes whether or not `## Continue` waives the park.
- The scenario posts `## Continue` through feature-989's `When('{string} is posted on issue {int}')`. This branch added a `## Continue` branch to that step (`feature-989-phase.steps.ts:105-109`). It calls `handleContinueDirective` and leaves the verdict to the Then steps, as Task 12 of the spec says.
- The workflow is a feature-929 `createWorkflow` workflow. It is parked by `the workflow's scenario test phase has run and parked the workflow as {string}` (`feature-1048-phase.steps.ts:40-47`). No `initializeWorkflow` runs, so the top-level state holds only what `parkWorkflow` writes (`adws/phases/workflowPark.ts:27`): `workflowStage: 'human_gated'` and `parkReason: 'device_boot_failed'`. It has no `adwId` and no `issueNumber`.
- `handleContinueDirective` records a waiver only when `state.issueNumber` equals the issue the directive is posted on (`adws/triggers/continueHandler.ts:78-81`). A `## Continue` that wrongly waived `device_boot_failed` stops at that check and writes nothing. The stage, the park reason and the absent `baseline` then read exactly as they do now.
- **Reproduced on this branch.** `ParkReason.DeviceBootFailed` was temporarily added to `WAIVABLE_PARK_REASONS`, and the scenario still passed (`1 scenario (1 passed)`). The log read `Continue #104808: top-level state for adwId=… belongs to issue #none not #104808; no waiver recorded`.

**Solution:** Give the workflow the state a real run has before the phase parks it.
- In the Given, before the phase runs, write the workflow's `adwId` and `issueNumber` to its top-level state, as `initializeWorkflow` does (`adws/phases/workflowInit.ts:341-343`). The BDD prior art is `writeInitialTopLevelState` in `features/regression/support/phaseConfig.ts:197-209`.
- `parkWorkflow` then merges the stage and the reason on top. That leaves the state of a real parked run.
- A wrongful waiver now passes the issue check and writes `phase_timeout` and a `baseline` waiver, and the existing Then steps catch it.
- **Prototyped on this branch, then reverted:**
  - all 27 `@adw-1048` scenarios pass;
  - with the mutation above, the scenario fails at `Then the workflow for issue 104808 is parked as "human_gated"`.

Why the seed goes in the Given rather than in the `## Continue` branch of the When step:
- The state is arranged where production arranges it, before any phase runs, so the When step stays the bare action.
- Only feature-1048's two scenarios use this Given (`feature-1048.feature:213` and `:230`). The other one, 104807, is the `## Retry` scenario. `## Retry` re-arms a `human_gated` park without reading `issueNumber` (`adws/triggers/retryHandler.ts:147-150`); only the `paused` path checks it (`:80`). The prototype confirmed that 104807 still passes.
- `executeScenarioTestPhase` neither reads nor writes the top-level state, so the seed does not change the phase run.
- `endScenario` already removes `agents/<adwId>/`, which the park writes to as well.

Why the When step does not assert that `handleContinueDirective` answered `false`:
- Every early return (no ADW ID in the comments, no state, a park that is not waivable, a state for another issue) also answers `false`. That assertion would be no stronger than the Then steps.
- It would make the shared step wrong for a later `## Continue` on a base-branch park, which answers `true`.
- Task 12 of the spec keeps the verdict in the Then steps, so `feature-989-phase.steps.ts` stays unchanged.

## Files to Modify
Use these files to implement the patch:

- `features/per-issue/step_definitions/feature-1048-phase.steps.ts`: **edit (the only file changed).** Seed `adwId` and `issueNumber` in the Given at lines 40-47.

Read-only references (do **not** edit):
- `adws/triggers/continueHandler.ts:78-81`: the issue check, which a wrongful waiver now passes.
- `adws/phases/workflowInit.ts:341-343` and `features/regression/support/phaseConfig.ts:197-209`: how a real run, and the regression suite's stand-in for one, name the ADW ID and the issue in the top-level state.
- `features/per-issue/step_definitions/feature-989-phase.steps.ts:100-112`: the shared When step, which stays as it is.
- `features/per-issue/feature-1048.feature`: stays as it is. The review says to leave the `.feature` file alone.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Seed the parked workflow's top-level state before the phase runs
- Open `features/per-issue/step_definitions/feature-1048-phase.steps.ts` and find the Given `"the workflow's scenario test phase has run and parked the workflow as {string}"` (lines 40-47).
- After the `assert.strictEqual(stage, PARKED_STAGE, …)` guard and before `await attemptScenarioTestPhase(this);`, add:
  ```ts
  const { adwId, issueNumber } = requireWorkflow();
  // As `initializeWorkflow` does before any phase runs: `## Continue` waives a park only when the state names the issue it is posted on.
  AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber });
  ```
- In the step's last assertion, use the destructured `adwId`: `stateOf(adwId)?.workflowStage` instead of `stateOf(requireWorkflow().adwId)?.workflowStage`.
- No import changes: `AgentStateManager` (line 12) and `requireWorkflow` (line 16) are already imported.
- Write only `adwId` and `issueNumber`. They are what `handleContinueDirective` checks, and what the review names. A `workflowStage` written here would be overwritten by the park's `human_gated`.
- The step then reads:
  ```ts
  Given("the workflow's scenario test phase has run and parked the workflow as {string}", { timeout: PHASE_TIMEOUT_MS }, async function (this: RegressionWorld, stage: string) {
    assert.strictEqual(stage, PARKED_STAGE, `The stage a park leaves is "${PARKED_STAGE}"`);
    const { adwId, issueNumber } = requireWorkflow();
    // As `initializeWorkflow` does before any phase runs: `## Continue` waives a park only when the state names the issue it is posted on.
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber });
    await attemptScenarioTestPhase(this);

    const attempt = requireAttempt();
    assert.ok(attempt.error instanceof TrappedExit && attempt.error.exitCode === 0, `Expected the scenario test phase to park the workflow (exit code 0), but ${describeAttempt(attempt)}`);
    assert.strictEqual(stateOf(adwId)?.workflowStage, stage, `Expected the workflow to be parked as "${stage}"`);
  });
  ```

### Step 2: Leave everything else as it is
- Do not edit:
  - `features/per-issue/feature-1048.feature`;
  - `adws/triggers/continueHandler.ts`;
  - the `## Continue` branch of `When('{string} is posted on issue {int}')` in `feature-989-phase.steps.ts`.
- Loosen no assertion.
- Add no `false` assertion on `handleContinueDirective`'s answer (see **Solution**).

## Validation
Execute every command to validate the patch is complete with zero regressions. Run them from the worktree root.

1. `bunx tsc --noEmit`: the type check of every `**/*.ts`, including `features/`. No diagnostics.
2. `bun run lint`: no problems.
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1048"`: `27 scenarios (27 passed)`, none undefined. The log reads:
   - `Retry #104807: re-armed adwId=… human_gated → phase_timeout`;
   - `Continue #104808: adwId=… is human_gated for device_boot_failed, which is not a base-branch park; no waiver recorded`.

   It no longer reads `belongs to issue #none`.
4. **Mutation check: the assertion can now fail.** Temporarily make `device_boot_failed` waivable, run the `## Continue` scenario, then restore the handler:
   ```sh
   perl -0pi -e 's/(  ParkReason\.PreExistingRegression,\n)/$1  ParkReason.DeviceBootFailed,\n/' adws/triggers/continueHandler.ts \
     && NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1048" --name '"## Continue" on a workflow parked'; \
     git checkout -- adws/triggers/continueHandler.ts && git status --short adws/triggers/continueHandler.ts
   ```
   Expected:
   - the log line `Continue #104808: waived the baseline … (device_boot_failed)`;
   - then `1 scenario (1 failed)`, with `AssertionError [ERR_ASSERTION]: Expected the workflow for issue 104808 to be parked as "human_gated"`;
   - the final `git status` prints nothing, which means the handler is restored. Never commit the mutation.
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-989 or @adw-991 or @adw-1043"`: the other scenarios that go through the shared `{string} is posted on issue {int}` step. Expect `102 scenarios (102 passed)`, as before the patch.

## Patch Scope
**Lines of code to change:** about 4 lines in one step-definition file. Three are added (the destructuring, the comment and the state write) and one is changed (the last assertion reuses `adwId`). No production code and no `.feature` file change.
**Risk level:** low.
- Only feature-1048's two scenarios use this Given.
- The phase never touches the top-level state.
- `## Retry`'s `human_gated` re-arm never reads `issueNumber`.

**Testing required:**
- the type check and the lint;
- the `@adw-1048` scenarios;
- the mutation check, which shows that the `## Continue` scenario now fails when `device_boot_failed` is waivable;
- the other users of the shared directive step.
