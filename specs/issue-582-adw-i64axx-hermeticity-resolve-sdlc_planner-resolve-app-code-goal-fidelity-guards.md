# Feature: Hermeticity + resolve app-code editing + goal-fidelity guards

## Metadata
issueNumber: `582`
adwId: `i64axx-hermeticity-resolve`
issueJson: `{"number":582,"title":"Hermeticity + resolve app-code editing + goal-fidelity guards","body":"## Parent PRD\n\n`specs/prd/multi-language-test-and-bdd-support.md`\n\n## What to build\n\nEnable UI BDD on non-hermetic apps and prevent the resolve loop from gaming the gate. The build agent creates/maintains the target app's test mode as definition-of-done; the resolve loop may **edit app code** to reach hermeticity, **capped** via the existing max-retry budget and **hard-failing** if not reached. Goal fidelity: the Gherkin `.feature` is **frozen during resolve** (step defs + app code only), with a **post-resolve `validationAgent` re-check** against the issue and `@regression` as a hard gate on every re-run. **HITL** — the agent now edits implementation code. See PRD Implementation Decisions → Hermeticity, resolve, and goal fidelity.\n\n## Acceptance criteria\n\n- [ ] Resolve loop can edit app code to reach hermeticity, capped + hard-fail on exhaustion\n- [ ] Gherkin `.feature` files are not modified during resolve\n- [ ] Post-resolve scenario re-validation against the issue body runs\n- [ ] `@regression` enforced as a hard gate on every resolve re-run\n- [ ] Build-agent definition-of-done includes the app's hermetic test mode\n\n## Blocked by\n\n- Blocked by #579\n- Blocked by #580\n\n## User stories addressed\n\n- User story 23\n- User story 24\n- User story 25\n- User story 26\n- User story 27","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-06-15T11:51:43Z","comments":[],"actionableComment":null}`

## Feature Description

This feature closes the last open seam in the Multi-Language Test & BDD PRD: making UI BDD work on **non-hermetic** target apps without letting the auto-resolve loop "win" by quietly weakening the test contract.

Two related capabilities ship together:

1. **Resolve may edit app code to reach hermeticity.** The scenario-fix (resolve) loop has historically been positioned to fix step definitions and test wiring. UI BDD on a real app requires the *app itself* to be hermetic — stubbed externals, seeded/deterministic data, a switchable test mode. This feature explicitly authorizes the resolve loop to **edit application/implementation code** to reach that hermetic state, keeps it **capped** by the existing `MAX_TEST_RETRY_ATTEMPTS` budget, and **hard-fails the workflow** when hermeticity (green blocker scenarios) is not reached within the cap — replacing today's silent "loop exits, workflow continues to review" behaviour.

2. **Goal-fidelity guards stop the loop from gaming the gate.** Because the resolve agent can now edit code *and* (without guards) could edit scenarios, three guards keep the run honest:
   - **Gherkin freeze** — the `.feature` files are frozen for the duration of resolve. Resolve edits step definitions and app code only; any `.feature` modification, addition, or deletion made during a fix attempt is detected and reverted before re-test and before commit.
   - **Post-resolve fidelity re-check** — after the resolve loop makes scenarios green, a `validationAgent`-style re-check compares the (frozen) scenarios against the **issue body** to confirm they still encode the issue's intent; misalignment hard-fails the workflow.
   - **`@regression` hard gate on every re-run** — the regression suite (a non-optional blocker tag) runs on every scenario-test pass inside the loop, and an unresolved regression failure participates in the hard-fail on exhaustion.

3. **Build-agent definition-of-done includes the app's hermetic test mode.** The TDD build skill (`/implement-tdd`, plus a note in `/implement`) is updated so that, for apps exercised by UI BDD, creating and maintaining the app's hermetic test mode (test-mode switch, stubbed externals, seeded data, deterministic clock) is part of "done" — not an afterthought left to resolve.

Value: ADW can drive UI BDD against real, non-hermetic apps; the gate cannot be gamed by weakening the Gherkin; and unrun/failing hermetic scenarios surface as a loud hard failure instead of a silent green. This is a **HITL** feature (`hitl` label already on the issue) because the agent now edits implementation code — the human merge gate stays closed until a person approves.

## User Story

As an ADW operator running UI BDD against a non-hermetic app
I want the resolve loop to be able to edit app code to reach hermeticity — capped, hard-failing on exhaustion, and unable to weaken the Gherkin contract
So that scenarios run against stubbed externals and seeded data, the gate cannot be gamed, and a fix that does not genuinely pass surfaces as a hard failure rather than a silent green.

(Covers PRD user stories 23–27: build-agent-owned hermetic test mode; resolve edits app code; capped + hard-fail; Gherkin frozen + re-validated against the issue; regression as a hard gate on every re-run.)

## Problem Statement

The scenario test → fix retry loop today (see `app_docs/feature-1bg58c-scenario-test-fix-phases.md`) has three gaps that block UI BDD on real apps and allow gate-gaming:

1. **No app-code mandate and no hard-fail.** `.claude/commands/resolve_failed_scenario.md` tells the resolver to "make minimal, targeted changes to resolve only this scenario failure" with no notion of *hermeticity* or *app test mode*. And the orchestrator loop, on exhausting `MAX_TEST_RETRY_ATTEMPTS` with blocker failures still present, simply **exits and continues to review** — a silent green for a suite that never passed. (Confirmed in `adwSdlc.tsx` lines 86–99 and the doc note: "on exhaustion the loop exits (does not hard-fail).")

2. **Nothing stops the resolve agent from editing `.feature` files.** The resolver could make a scenario "pass" by weakening or deleting the Gherkin. There is no freeze and no detection. The `.feature` is the plan/implementation contract (a load-bearing decision in the README) and must be immutable during resolve.

3. **No post-resolve check that the scenarios still match the issue.** Once the app code can be edited to make scenarios green, a fix could drift from the issue's intent. There is no re-validation of the frozen scenarios against the issue body after resolve. `validationAgent` exists but only compares **plan vs scenarios** (`/validate_plan_scenarios`), never **scenarios vs issue**.

4. **The scenario test/fix loop is duplicated across 5 orchestrators.** `adwSdlc`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwChore`, and `adwPrReview` each carry a near-identical inline loop. Adding the hard-fail + freeze + fidelity guards to each by copy-paste would drift immediately (exactly the failure mode the README's "rebuild the primitive" lesson warns against).

## Solution Statement

Centralize the loop and add the guards in one place, plus two prompt updates:

- **Extract a shared `runScenarioTestFixLoop` phase helper** (`adws/phases/scenarioTestFixLoop.ts`) that replaces the duplicated inline loop in all 5 orchestrators. It runs `executeScenarioTestPhase → executeScenarioFixPhase → executeScenarioTestPhase` up to `MAX_TEST_RETRY_ATTEMPTS`, and adds the two new behaviours: **hard-fail on exhaustion** (throw when blocker failures — including `@regression` — persist after the cap) and a **post-resolve fidelity re-check** (only when resolve actually ran and scenarios are green).

- **Add a Gherkin-freeze guard** (`adws/phases/gherkinFreeze.ts`, pure helpers) and wire it into `scenarioFixPhase`: snapshot every `.feature` file's content at fix-phase entry, then detect and revert any `.feature` change/add/delete before the phase commits. Resolve's step-def and app-code edits survive; Gherkin edits never reach the commit.

- **Add a scenario-fidelity agent + command** (`runScenarioFidelityAgent` + `.claude/commands/validate_scenario_fidelity.md`) modelled on the existing `validationAgent`/`/validate_plan_scenarios` pattern but comparing **frozen scenarios vs the issue body**. Reuses the `ValidationResult` schema, `commandAgent` retry loop, and `OutputValidationError` handling. `aligned: false` post-resolve → hard-fail.

- **Update `.claude/commands/resolve_failed_scenario.md`** to: authorize editing app/implementation code to reach hermeticity (test mode, stubbed externals, seeded data, deterministic clock); forbid editing/adding/deleting `.feature` files (frozen — step defs + app code only); state the cap and that exhaustion is a hard failure.

- **Update `.claude/skills/implement-tdd/SKILL.md`** (and a short note in `.claude/commands/implement.md`) so the build agent's definition-of-done includes creating/maintaining the app's hermetic test mode for UI-BDD-exercised apps.

`@regression` is already a non-optional blocker tag in `getDefaultReviewProofConfig()` and runs on every `executeScenarioTestPhase` call; the shared loop's hard-fail makes "a persistent `@regression` failure fails the workflow" real, satisfying the hard-gate criterion without touching the proof-tag config.

**No new parsed `.adw/` descriptor fields are introduced**, so the framework-version hash does not move and `adw_init.md` does **not** need to change (contrast with #579, which added `bddFramework`/`stepDefDirectory`). All changes here are framework-resident prompts and code that take effect on merge. See Notes → Hash-propagation rule.

## Relevant Files

Use these files to implement the feature:

- `adws/adwSdlc.tsx` — full SDLC orchestrator; contains the canonical inline scenario test→fix loop (lines ~86–99). Replace with a call to `runScenarioTestFixLoop`; consume returned `scenarioProofPath`/`scenarioRetries`.
- `adws/adwPlanBuildTest.tsx` — inline loop (lines ~76–87). Rewire to the shared helper.
- `adws/adwPlanBuildTestReview.tsx` — inline loop (lines ~86–99). Rewire to the shared helper.
- `adws/adwChore.tsx` — inline loop (lines ~107–120). Rewire to the shared helper.
- `adws/adwPrReview.tsx` — inline loop (lines ~79–90) operating on `config.base`. Rewire to the shared helper (pass `config.base`).
- `adws/phases/scenarioFixPhase.ts` — resolve phase; wrap the per-tag resolve loop with the Gherkin-freeze snapshot/restore so `.feature` edits never reach the commit. Already calls `runResolveScenarioAgent` and commits/pushes.
- `adws/phases/scenarioTestPhase.ts` — scenario test phase; unchanged behaviourally, but its `ScenarioProofResult` (`hasBlockerFailures`) is the loop's pass/fail signal. Read for context.
- `adws/phases/scenarioProof.ts` — `runScenarioProof`; iterates `reviewProofConfig.tags` (`@regression` blocker + `@adw-{issueNumber}` optional) and computes `hasBlockerFailures`. Confirms `@regression` runs every pass. Read for context.
- `adws/core/projectConfig.ts` — `getDefaultReviewProofConfig()` (lines ~187–195) shows `@regression` is a non-optional blocker. No change required; read to justify the hard-gate criterion.
- `adws/agents/validationAgent.ts` — model for the new fidelity agent; reuse exported `findScenarioFiles`, `readScenarioContents`, `ValidationResult`, `validationResultSchema`, and the `commandAgent` wiring pattern.
- `adws/agents/resolutionAgent.ts` — model for passing the issue body as a positional command arg (`formatResolutionArgs` passes `issueJson`); mirror for `formatFidelityArgs`.
- `adws/phases/planValidationPhase.ts` — reference for the validate→(resolve)→re-validate retry/hard-fail pattern and `OutputValidationError` graceful degradation.
- `adws/core/config.ts` — `MAX_TEST_RETRY_ATTEMPTS` (line 57) is the existing cap reused by the loop; `MAX_VALIDATION_RETRY_ATTEMPTS` (line 63) for fidelity-agent output-retry context. No new constant required.
- `adws/core/retryOrchestrator.ts` — `retryWithResolution` pattern reference (not directly reused; the loop is phase-level, not agent-level).
- `adws/phases/index.ts` / `adws/workflowPhases.ts` / `adws/agents/index.ts` — barrel exports; add the new helper and agent.
- `adws/types/issueTypes.ts` — `SlashCommand` union; add `/validate_scenario_fidelity` literal.
- `adws/core/modelRouting.ts` — `SLASH_COMMAND_MODEL_MAP` / `SLASH_COMMAND_EFFORT_MAP` (and `*_FAST` variants); add a model/effort entry for `/validate_scenario_fidelity` (mirror `/validate_plan_scenarios`).
- `.claude/commands/resolve_failed_scenario.md` — resolve prompt; add hermeticity app-code mandate + Gherkin freeze + cap/hard-fail framing.
- `.claude/commands/validate_plan_scenarios.md` — template for the new `validate_scenario_fidelity.md` command (args, JSON-only final output contract).
- `.claude/skills/implement-tdd/SKILL.md` — TDD build skill (`target: true`, propagates to target repos); add the hermetic-test-mode definition-of-done section.
- `.claude/commands/implement.md` — non-TDD build prompt; add a short hermetic-test-mode note for parity.
- `.adw/scenarios.md` — confirms tiered layout: per-issue → `features/per-issue/`, step defs → `features/step_definitions`, registry → `features/regression/vocabulary.md`. New BDD scenarios for this issue route here.
- `features/regression/vocabulary.md` — canonical phrase registry; `generate_step_definitions` validates new step phrases against it. Read before authoring scenario steps.
- `app_docs/feature-1bg58c-scenario-test-fix-phases.md` — design of the scenario test/fix phases and the explicit "does not hard-fail" note this feature changes.
- `app_docs/feature-sinbtg-plan-scenario-validation-resolution.md` — design of the validation/resolution agents the fidelity check is modelled on.
- `specs/prd/multi-language-test-and-bdd-support.md` — parent PRD; "Hermeticity, resolve, and goal fidelity" decision block is the spec of record.

### New Files

- `adws/phases/scenarioTestFixLoop.ts` — shared scenario test→fix loop helper with hard-fail-on-exhaustion and the post-resolve fidelity hook. Exports `runScenarioTestFixLoop(config, tracker, opts?)` returning `{ scenarioProof?, scenarioProofPath, scenarioRetries }` and throwing a typed `ScenarioHermeticityError` / `GoalFidelityError` on failure.
- `adws/phases/gherkinFreeze.ts` — pure helpers: `captureGherkinSnapshot(worktreePath) → Map<relPath, content>`, `detectGherkinViolations(snapshot, worktreePath) → string[]`, `restoreGherkinSnapshot(snapshot, worktreePath) → string[]` (revert modified, recreate deleted, remove added). fs only at the edges.
- `adws/agents/scenarioFidelityAgent.ts` — `runScenarioFidelityAgent(adwId, issueNumber, issueBody, scenarioGlob, logsDir, statePath?, cwd?)`; reuses `ValidationResult`/`validationResultSchema` and the `commandAgent` config pattern. Returns `{ ...AgentResult, fidelityResult: ValidationResult }`.
- `.claude/commands/validate_scenario_fidelity.md` — slash command (`target: false`) comparing frozen `.feature` scenarios against the issue body; emits the same JSON `ValidationResult` contract as `/validate_plan_scenarios`.
- `adws/phases/__tests__/gherkinFreeze.test.ts` — unit tests for snapshot/detect/restore over temp-dir fixtures.
- `adws/phases/__tests__/scenarioTestFixLoop.test.ts` — unit tests for the loop's decision logic (pass-first-try, resolve-then-pass, exhaustion-hard-fail, fidelity-fail-hard-fail) with injected phase stubs.
- `adws/agents/__tests__/scenarioFidelityAgent.test.ts` — unit tests for the fidelity result extractor (valid/invalid JSON → `ExtractionResult`).
- `features/per-issue/feature-582.feature` — per-issue BDD scenarios tagged `@adw-582` covering the five acceptance criteria.
- `features/per-issue/step_definitions/feature-582.steps.ts` — step definitions for the above.

## Implementation Plan

### Phase 1: Foundation
Build the two pure, independently-testable primitives that the loop depends on, plus the fidelity agent:
- `gherkinFreeze.ts` — snapshot/detect/restore of `.feature` files (content-keyed, so restore can recreate deleted files).
- `scenarioFidelityAgent.ts` + `.claude/commands/validate_scenario_fidelity.md` — the scenarios-vs-issue re-check, reusing the `ValidationResult` rail.
- Register the new slash command in the `SlashCommand` union and model/effort maps.

### Phase 2: Core Implementation
- Wire the Gherkin freeze into `scenarioFixPhase` (snapshot at entry → run resolvers → restore violations → then commit).
- Build the shared `scenarioTestFixLoop.ts`: the bounded loop, hard-fail on exhaustion, and the post-resolve fidelity gate (run only when `scenarioRetries > 0`, scenarios are green, and `@adw-{issueNumber}` scenario files exist).
- Update the two build/resolve prompts (`resolve_failed_scenario.md`, `implement-tdd/SKILL.md` + `implement.md`).

### Phase 3: Integration
- Replace the inline loop in all 5 orchestrators with `runScenarioTestFixLoop`, preserving each orchestrator's downstream use of `scenarioProofPath`/`scenarioRetries` (review proof path, KPI metadata, completion state).
- Add per-issue BDD scenarios + step definitions for the acceptance criteria.
- Add a conditional-docs entry and run the full validation suite.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Read context and confirm conventions
- Read `app_docs/feature-1bg58c-scenario-test-fix-phases.md`, `app_docs/feature-sinbtg-plan-scenario-validation-resolution.md`, and the PRD "Hermeticity, resolve, and goal fidelity" block.
- Read `features/regression/vocabulary.md` to learn the registered step-phrase vocabulary before authoring scenarios.
- Confirm the 5 orchestrators carrying the inline loop: `grep -ln "executeScenarioFixPhase" adws/*.tsx`.

### 2. Add the Gherkin-freeze pure module
- Create `adws/phases/gherkinFreeze.ts` with:
  - `captureGherkinSnapshot(worktreePath: string): Map<string, string>` — recursively find every `*.feature` file (reuse the scan shape from `validationAgent.findScenarioFiles`), keyed by path relative to `worktreePath`, value = file content. Skip `node_modules`/`.git`/`.worktrees`.
  - `detectGherkinViolations(snapshot: Map<string,string>, worktreePath: string): string[]` — return relative paths that were modified, added, or deleted versus the snapshot.
  - `restoreGherkinSnapshot(snapshot: Map<string,string>, worktreePath: string): string[]` — rewrite modified files to snapshot content, recreate deleted files, delete added files; return the list of restored/removed paths.
  - Keep functions ≤ ~2 nesting levels (guard clauses); fs calls isolated at the edges.
- Export from `adws/phases/index.ts`.

### 3. Unit-test the Gherkin-freeze module
- Create `adws/phases/__tests__/gherkinFreeze.test.ts` (Vitest), using a temp dir (mirror `adws/proof/__tests__/proofArtifactHarvester.test.ts`):
  - snapshot then no change → `detectGherkinViolations` returns `[]`.
  - modify a `.feature` → detected; `restore` returns content to snapshot.
  - add a new `.feature` → detected; `restore` deletes it.
  - delete a `.feature` → detected; `restore` recreates it with original content.
  - non-`.feature` edits are ignored.

### 4. Wire the freeze into `scenarioFixPhase`
- In `adws/phases/scenarioFixPhase.ts`, call `captureGherkinSnapshot(worktreePath)` before the per-tag resolve loop.
- After all `runResolveScenarioAgent` calls and before `runCommitAgent`, call `detectGherkinViolations`; if non-empty, call `restoreGherkinSnapshot`, `log` a warning, and `AgentStateManager.appendLog` a "Gherkin freeze: reverted N .feature change(s) during resolve" entry. The commit then contains only step-def + app-code edits.
- Surface a `gherkinFreezeViolations: string[]` field on the returned object for telemetry/assertions.

### 5. Add the scenario-fidelity command
- Create `.claude/commands/validate_scenario_fidelity.md` (frontmatter `target: false`), modelled on `validate_plan_scenarios.md`:
  - Args: `$0 adwId`, `$1 issueNumber`, `$2 scenarioGlob`, `$3 issueBody` (passed inline like `resolutionAgent` passes `issueJson`).
  - Instructions: read every `.feature` tagged `@adw-$1` under `$2`; compare each scenario against the issue body in `$3`; identify mismatches where a scenario tests behaviour **not** described/intended by the issue (`scenario_untested`) or an issue acceptance criterion has **no** covering scenario (`plan_uncovered`, reused enum value).
  - Final output: the exact JSON-only `ValidationResult` contract (`aligned`, `mismatches[]`, `summary`) — last message starts with `{` and ends with `}`.

### 6. Add the scenario-fidelity agent
- Create `adws/agents/scenarioFidelityAgent.ts`:
  - Reuse `ValidationResult` + `validationResultSchema` from `validationAgent.ts`.
  - `formatFidelityArgs(adwId, issueNumber, scenarioGlob, issueBody)` → positional args (mirror `formatResolutionArgs`).
  - `extractFidelityResult` → `ExtractionResult<ValidationResult>` (mirror `extractValidationResult`).
  - `runScenarioFidelityAgent(...)` via `runCommandAgent` with `command: '/validate_scenario_fidelity'`; return `{ ...result, fidelityResult: result.parsed }`.
- Export from `adws/agents/index.ts`.
- Add `/validate_scenario_fidelity` to the `SlashCommand` union in `adws/types/issueTypes.ts`.
- Add `/validate_scenario_fidelity` entries to `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST` in `adws/core/modelRouting.ts`, mirroring `/validate_plan_scenarios`.

### 7. Unit-test the fidelity-agent extractor
- Create `adws/agents/__tests__/scenarioFidelityAgent.test.ts`: valid JSON → `success: true` with normalized `mismatches`/`summary`; missing `aligned` boolean → `success: false` with a descriptive error (mirror existing validation-agent extractor expectations).

### 8. Build the shared scenario test→fix loop
- Create `adws/phases/scenarioTestFixLoop.ts`:
  - Define typed errors `ScenarioHermeticityError` and `GoalFidelityError` (extend `Error` with a stable `name`).
  - `runScenarioTestFixLoop(config: WorkflowConfig, tracker: CostTracker, opts?: { maxAttempts?: number }): Promise<{ scenarioProof?: ScenarioProofResult; scenarioProofPath: string; scenarioRetries: number }>`.
  - Loop body identical to today's inline version (`runPhase(config, tracker, executeScenarioTestPhase)` → break when `!hasBlockerFailures` → else `runPhase(config, tracker, fixWrapper)`), bounded by `opts?.maxAttempts ?? MAX_TEST_RETRY_ATTEMPTS`.
  - **Hard-fail on exhaustion:** after the loop, if the last `scenarioProof?.hasBlockerFailures` is still true, throw `ScenarioHermeticityError` with a message naming the failing blocker tags (e.g. `@regression`, `@adw-582`) and the attempt count. Skip the throw when scenarios were never configured (proof `undefined` / no blocker tags) so repos without scenarios are unaffected.
  - **Post-resolve fidelity gate:** when `scenarioRetries > 0`, scenarios are green, and `findScenarioFiles(issueNumber, worktreePath).length > 0`, run `runScenarioFidelityAgent` once (accumulate cost via `tracker`/`persistTokenCounts`); on `aligned: false`, throw `GoalFidelityError` with the summary. Catch `OutputValidationError` and degrade to a logged warning (do not hard-fail on a parser exhaustion — mirror `planValidationPhase`'s graceful path).
  - Return `{ scenarioProof, scenarioProofPath, scenarioRetries }`.
- Export from `adws/phases/index.ts` and `adws/workflowPhases.ts`.

### 9. Unit-test the loop decision logic
- Create `adws/phases/__tests__/scenarioTestFixLoop.test.ts` injecting stubbed phase/agent functions (follow the dependency-injection style used in existing phase tests):
  - pass on first attempt → no fix, no fidelity call, returns `scenarioRetries: 0`.
  - fail then pass within cap → fix called; fidelity called once; returns on green.
  - fidelity returns `aligned: false` → throws `GoalFidelityError`.
  - blocker failures persist to cap → throws `ScenarioHermeticityError`.
  - no scenarios configured (proof undefined) → returns cleanly, no throw, no fidelity call.

### 10. Rewire the 5 orchestrators
- In each of `adwSdlc.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildTestReview.tsx`, `adwChore.tsx`, `adwPrReview.tsx`:
  - Replace the inline `for` loop with `const { scenarioProofPath, scenarioRetries } = await runScenarioTestFixLoop(config, tracker)` (pass `config.base` in `adwPrReview`).
  - Preserve all downstream uses: `adwSdlc`/`adwPlanBuildTestReview` feed `scenarioProofPath` into the review loop and `scenarioRetries` into completion metadata; `adwPlanBuildTest`/`adwChore` feed `scenarioRetries` into `completeWorkflow`.
  - Remove now-unused direct imports (`executeScenarioFixPhase`, `MAX_TEST_RETRY_ATTEMPTS`, `WorkflowConfig` fix-wrapper) where the helper subsumes them; keep imports still used elsewhere.
  - The thrown `ScenarioHermeticityError`/`GoalFidelityError` propagate to each orchestrator's existing `try/catch → handleWorkflowError`, producing a visible failed workflow (no silent green).

### 11. Update the resolve prompt
- Edit `.claude/commands/resolve_failed_scenario.md`:
  - Add a "Hermeticity" instruction: you MAY edit application/implementation code to make the app hermetic for this scenario — switchable test mode, stub external services, seed deterministic data, freeze time/randomness — in addition to step definitions.
  - Add a "Frozen contract" instruction: do NOT edit, add, or delete any `.feature` file; the Gherkin scenario is the immutable contract. Fix the code/step-defs to satisfy it, never the reverse. (Note any `.feature` change will be automatically reverted.)
  - Add a "Budget" note: attempts are capped by the workflow's max-retry budget; if hermeticity/green is not reached within the budget the workflow hard-fails — do not stub the assertion itself to force a pass.

### 12. Update the build-agent definition-of-done
- Edit `.claude/skills/implement-tdd/SKILL.md`: add a "Hermetic Test Mode (Definition of Done)" section — for apps exercised by UI/browser BDD, creating and maintaining the app's hermetic test mode is part of done: a test-mode switch (env/flag/route), stubbed externals, seeded/deterministic data, deterministic clock, and a documented way for scenarios to drive it. Scenarios drive the browser; the app owns hermeticity.
- Edit `.claude/commands/implement.md`: add a one-line pointer that, when the plan involves UI/browser scenarios, the app's hermetic test mode is part of the deliverable.

### 13. Author per-issue BDD scenarios
- Create `features/per-issue/feature-582.feature` tagged `@adw-582`, with scenarios for: (a) resolve edits app code + hard-fail on exhaustion, (b) `.feature` files unchanged after a resolve that touched them (freeze revert), (c) post-resolve fidelity re-check runs and can hard-fail, (d) `@regression` blocker failure participates in the hard-fail, (e) build-agent definition-of-done includes hermetic test mode. Prefer phrases already in `features/regression/vocabulary.md`.
- Create `features/per-issue/step_definitions/feature-582.steps.ts` exercising `runScenarioTestFixLoop`, `gherkinFreeze`, and `scenarioFidelityAgent` through their public interfaces (inject stubs; assert verdicts/throws, not internals). Use the mock infrastructure in `test/mocks/` where agent calls are involved.

### 14. Add a conditional-docs entry
- Append an entry to `.adw/conditional_docs.md` for the (later document-phase-generated) feature doc, with conditions covering: working on `scenarioTestFixLoop.ts`/`gherkinFreeze.ts`/`scenarioFidelityAgent.ts`; the `/resolve_failed_scenario` app-code/freeze behaviour; `/validate_scenario_fidelity`; the hard-fail-on-exhaustion behaviour change; and the `/implement-tdd` hermetic-test-mode definition-of-done.

### 15. Validate
- Run every command in **Validation Commands** below and confirm all pass with zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope. Following the PRD's testing principle (assert external behaviour through the public interface; no assertions on private helpers or call sequencing) and the existing pure-helper test style:

- **`gherkinFreeze`** (`adws/phases/__tests__/gherkinFreeze.test.ts`) — temp-dir fixtures → snapshot/detect/restore over modify, add, delete, and no-op cases; non-`.feature` edits ignored.
- **`scenarioTestFixLoop`** (`adws/phases/__tests__/scenarioTestFixLoop.test.ts`) — injected phase/agent stubs → table over: pass-first-try, resolve-then-pass (fidelity called once), fidelity-fail (`GoalFidelityError`), exhaustion (`ScenarioHermeticityError`), no-scenarios (clean return). Assert returned `{scenarioProofPath, scenarioRetries}` and thrown error types — not internal call order.
- **`scenarioFidelityAgent`** (`adws/agents/__tests__/scenarioFidelityAgent.test.ts`) — extractor over valid JSON, missing `aligned`, and malformed output → `ExtractionResult` shape.

### Edge Cases
- Target repo with **no scenarios** configured (`scenariosMd` empty or `runScenariosByTag` `N/A`): `executeScenarioTestPhase` returns passing; loop must **not** hard-fail and must **not** run the fidelity check.
- Only `@regression` exists, no `@adw-{issueNumber}` scenarios: `@adw-` tag is optional/skipped; a `@regression` blocker failure still drives resolve and the hard-fail; fidelity check is skipped (no `@adw-582` files).
- Scenarios pass on the **first** attempt (no resolve): no fidelity re-check, no freeze churn, `scenarioRetries === 0`.
- Resolve agent edits a `.feature` file: freeze reverts it; the re-test sees the original contract; committed diff contains no `.feature` change.
- Resolve agent **adds** or **deletes** a `.feature`: freeze removes the addition / recreates the deletion.
- Fidelity agent output unparseable after retries (`OutputValidationError`): degrade to a logged warning, do not hard-fail (mirror `planValidationPhase`).
- `adwPrReview` path operating on `config.base`: helper receives `config.base` and behaves identically.
- Cap exhausted with scenarios green only after the final fix but before re-test: loop re-tests after each fix and breaks on the first green pass; hard-fail only when the last proof still has blocker failures.

## Acceptance Criteria
- Resolve loop can edit app code to reach hermeticity: `resolve_failed_scenario.md` authorizes app/implementation-code edits for hermeticity; attempts are capped by `MAX_TEST_RETRY_ATTEMPTS`; on exhaustion with blocker failures the workflow throws `ScenarioHermeticityError` and fails (no silent continue-to-review).
- Gherkin `.feature` files are not modified during resolve: any `.feature` change/add/delete made by a resolve attempt is detected and reverted by `gherkinFreeze` before `scenarioFixPhase` commits; the committed diff never contains `.feature` edits.
- Post-resolve scenario re-validation against the issue body runs: when resolve occurred and scenarios are green, `runScenarioFidelityAgent` compares frozen scenarios vs the issue body; `aligned: false` throws `GoalFidelityError`.
- `@regression` enforced as a hard gate on every resolve re-run: `@regression` (non-optional blocker) runs on every `executeScenarioTestPhase` inside the loop, and a persistent `@regression` failure participates in the hard-fail on exhaustion.
- Build-agent definition-of-done includes the app's hermetic test mode: `/implement-tdd` (and a note in `/implement`) make creating/maintaining the app's hermetic test mode part of "done".
- All 5 orchestrators use the shared `runScenarioTestFixLoop`; no orchestrator carries the inline loop.
- New unit tests and the full existing suite pass; lint, type-check, and build are clean.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — ESLint clean (zero errors/warnings).
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes (new modules, agent, and rewired orchestrators type-check).
- `bun run test:unit` — full Vitest suite passes, including the three new test files (`gherkinFreeze`, `scenarioTestFixLoop`, `scenarioFidelityAgent`).
- `bun run build` — build succeeds with no errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-582"` — per-issue BDD scenarios for this feature pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — full regression suite passes (no regression from the orchestrator rewire or the hard-fail behaviour change).

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (it does), strictly adhere to it. Specifically: keep new files single-responsibility and under 300 lines; prefer guard clauses over nested conditionals (max ~2 levels); isolate fs/side-effects at the edges of `gherkinFreeze` and the loop; avoid `any`; use explicit types for `ValidationResult`, the loop result, and the typed errors.
- **No new library is required.** Per `.adw/commands.md` the library install command is `bun add <package>` if that changes, but this feature uses only existing modules (`fs`, `path`, `crypto` if hashing is preferred over content compare, and existing ADW agent/cost infra).
- **Hash-propagation rule (PRD "Further Notes").** This feature adds **no parsed `.adw/` descriptor fields**, so the framework-version hash (computed only over `adw_init.md` + the vocabulary template) does **not** move and `adw_init.md` is intentionally **not** edited. The changed prompts (`resolve_failed_scenario.md`, `implement-tdd/SKILL.md`, `implement.md`, new `validate_scenario_fidelity.md`) and framework code are framework-resident and take effect immediately on merge — no `adwUpgrade` regeneration is involved. Do not add descriptor fields here; if a future change does, it must edit `adw_init.md` in the same PR.
- **Behaviour change — silent green removed.** Today a scenario suite that never goes green within the cap lets the workflow continue to review (`app_docs/feature-1bg58c` line 45). After this feature it hard-fails. This is intentional (PRD's silent-green elimination) and is the load-bearing part of acceptance criterion 1 and 4. Repos with **no** scenarios are unaffected (the loop returns cleanly).
- **`hitl` is already on the issue.** Because resolve now edits implementation code, the human merge gate must stay closed until reviewed. No code change is needed for gating (the stateless `(no hitl) OR (approved)` gate already defers merge while `hitl` is present), but the PR description should call out that the agent edits app code.
- **Scope boundary.** `adwPlanBuildReview.tsx` runs `executeScenarioTestPhase` but resolves via the review-patch cycle (no `executeScenarioFixPhase`), so it is intentionally **out of scope** for the shared resolve loop; its scenario output continues to feed the passive review judge. If a future issue routes its scenario failures through resolve, adopt `runScenarioTestFixLoop` there too.
- **Future consideration.** The fidelity re-check currently runs once post-resolve. If gate-gaming via app-code edits (rather than scenario edits) becomes a concern, a stronger guard would diff the resolve-phase app-code changes against the plan's relevant-files scope — deferred unless a real incident surfaces it.
