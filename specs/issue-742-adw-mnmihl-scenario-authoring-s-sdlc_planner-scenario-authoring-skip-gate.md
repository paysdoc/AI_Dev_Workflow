# Feature: Scenario-authoring skip-gate for promotion issues

## Metadata
issueNumber: `742`
adwId: `mnmihl-scenario-authoring-s`
issueJson: `{"number":742,"title":"Scenario-authoring skip-gate for promotion issues","body":"## Parent PRD\n\n`specs/prd/automated-scenario-promotion-sweep.md` (PR #738)\n\n## What to build\n\nStop the SDLC pipeline from authoring junk scenarios for a promotion issue. Add a pure `shouldSkipScenarioAuthoring(labels)` gate (true when `regression-promotion` is present) and wire it into `scenarioPhase` so that, for a promotion issue, `scenario_writer` and the dependent alignment / validation / gherkin-freeze / fidelity steps no-op. Without this, the unconditional scenario phase can invent a junk `feature-<promotionIssueN>.feature` that reddens the run and becomes its own future promotion candidate (promotion-of-a-promotion).\n\nSee PRD user story 11 and Implementation Decision \"Pipeline modifications\".\n\n## Acceptance criteria\n\n- [ ] An issue carrying the `regression-promotion` label runs through plan/build/test WITHOUT producing any `features/per-issue/feature-<promotionIssueN>.feature` file\n- [ ] The dependent alignment/validation/gherkin-freeze/fidelity steps cleanly no-op for such an issue (no spurious failures)\n- [ ] A normal (non-promotion) feature issue is unaffected — scenario authoring runs exactly as today\n- [ ] `shouldSkipScenarioAuthoring` is a pure gate consistent with `regression-promotion` label detection\n\n## Blocked by\n\n- Blocked by #740\n\n## Touched Files\n\n- adws/phases/scenarioPhase.ts\n- adws/phases/alignmentPhase.ts\n\n## User stories addressed\n\n- User story 11","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-07-08T11:43:07Z","comments":[],"actionableComment":null}`

## Feature Description

The Automated Scenario Promotion Sweep (parent PRD `specs/prd/automated-scenario-promotion-sweep.md`) reuses ADW's normal plan → build → test → PR pipeline to move a high-scoring per-issue BDD scenario into the executed `@regression` suite. The sweep files a self-contained `adw:feature` promotion issue labelled `regression-promotion` + `hitl`, and the ordinary SDLC orchestrator turns it into a `hitl`-gated PR that relocates the whole feature file plus its step-definitions, adds `@regression`, and proves the regression suite green.

The one problem with reusing the ordinary pipeline verbatim: the SDLC orchestrator runs `executeScenarioPhase` (the `/scenario_writer` skill) unconditionally, in parallel with planning. For a **promotion** issue there is nothing to author — the scenario already exists under `features/per-issue/` and is merely being relocated. If `scenario_writer` runs anyway, it invents a brand-new `features/per-issue/feature-<promotionIssueN>.feature`. That junk scenario:

1. **Reddens the run** — it needs step-definitions and can fail the scenario test/fix loop for a feature that was never supposed to author anything.
2. **Becomes a promotion-of-a-promotion** — the freshly-authored per-issue file is itself a future candidate the sweep would later try to promote, creating an unbounded self-referential loop.

The hand-done reference promotion (#734, promoting #729) got away with this on `n=1` purely because the LLM chose not to author a spurious file. This feature removes that reliance on LLM discretion with a **deterministic** gate: a pure `shouldSkipScenarioAuthoring(labels)` predicate (true when the `regression-promotion` label is present) wired into `executeScenarioPhase` and `executeAlignmentPhase` so that, for a promotion issue, scenario authoring and its dependent steps (alignment / validation / gherkin-freeze / fidelity) cleanly no-op. Normal feature issues are entirely unaffected.

## User Story

As an ADW maintainer,
I want the scenario-authoring phase to be skipped for promotion issues (those carrying the `regression-promotion` label),
So that the pipeline never invents junk `feature-<promotionIssueN>.feature` scenarios that would redden the run or become their own future promotion candidates.

(Parent PRD User Story 11.)

## Problem Statement

`adwSdlc.tsx` runs `executeScenarioPhase` (`/scenario_writer`) unconditionally, in parallel with `executePlanPhase`, for every issue type — including promotion issues. A promotion issue's job is to **relocate** an existing per-issue scenario into `features/regression/`, not to author a new one. Running `scenario_writer` for a promotion issue produces a spurious `features/per-issue/feature-<promotionIssueN>.feature`, which (a) needs step-definitions and can fail the scenario test/fix loop, reddening a run that should be green, and (b) becomes its own future promotion candidate the next time the sweep runs (promotion-of-a-promotion). There is currently no deterministic mechanism to suppress scenario authoring for these issues.

## Solution Statement

Add a trivial pure gate `shouldSkipScenarioAuthoring(labels)` — `true` when the `regression-promotion` label is present — co-located with the existing `ADW_REGRESSION_PROMOTION_LABEL` constant and the other pure label readers (`readAdwLabelNames`, `readAdwLabels`) in `adws/github/labelManager.ts`. Wire it into the two scenario-authoring phases:

1. **`executeScenarioPhase`** (`adws/phases/scenarioPhase.ts`) — early-return a zero-cost no-op result (mirroring the existing resume-skip guard) when `shouldSkipScenarioAuthoring(issue.labels)` is true, **before** the `/scenario_writer` agent is invoked. This is the load-bearing change: no `@adw-<promotionIssueN>` feature file is ever authored.
2. **`executeAlignmentPhase`** (`adws/phases/alignmentPhase.ts`) — add the same early-return gate for defense-in-depth and legibility. (Alignment already no-ops when `findScenarioFiles(issueNumber)` is empty, but an explicit gate makes the promotion-skip intent unmistakable and independent of that implicit path.)

The remaining dependent steps require **no code change** because they already key off the absence of `@adw-<issueNumber>` scenario files (see Implementation Plan, Phase 3, for the verified no-op cascade). The gate is deterministic and orchestration-level, so the `/scenario_writer` prompt file itself is untouched — the skip does not depend on LLM discretion.

## Relevant Files

Use these files to implement the feature:

- `adws/github/labelManager.ts` — Home for the new `shouldSkipScenarioAuthoring(labels)` pure gate. Already owns `ADW_REGRESSION_PROMOTION_LABEL = 'regression-promotion'` (line 32) and the pure read-side (`readAdwLabelNames`, `readAdwLabels`, lines 77-94). `GitHubLabel` is already imported here (line 13). Co-locating the gate keeps the label constant and its interpretation together.
- `adws/github/index.ts` — Barrel that re-exports the label API (lines 40-54). Must add `shouldSkipScenarioAuthoring` (and `ADW_REGRESSION_PROMOTION_LABEL`) to the `from './labelManager'` export block so the phases can import it via `../github`.
- `adws/phases/scenarioPhase.ts` — `executeScenarioPhase` (the `/scenario_writer` phase). The primary wiring point: add the skip gate near the top (before `runScenarioAgent` at line 51). Already destructures `issue` from `config` (line 27); `issue.labels` is the input to the gate.
- `adws/phases/alignmentPhase.ts` — `executeAlignmentPhase` (single-pass alignment). Secondary wiring point: add the same skip gate after the resume-skip guard (line 54). Already destructures `issue` (line 45). Existing behaviour at line 88 (skip when `findScenarioFiles` is empty) is the implicit fallback the explicit gate reinforces.
- `adws/types/issueTypes.ts` — Defines `GitHubIssue.labels: GitHubLabel[]` (line 141) and the `GitHubLabel` type. Confirms `config.issue.labels` is the label array the gate consumes. Read-only reference.
- `adws/agents/validationAgent.ts` — `findScenarioFiles(issueNumber, worktreePath)` (line 49) scans for `.feature` files containing `@adw-<issueNumber>`. This is the shared predicate every downstream step uses to decide whether to run; understanding it proves the no-op cascade. Read-only reference.
- `adws/phases/scenarioTestFixLoop.ts` — The fidelity re-check (`runScenarioFidelityAgent`) is gated on `findScenarioFiles(issueNumber, worktreePath).length > 0` AND `scenarioRetries > 0` (lines 76-78). Confirms fidelity no-ops with no authored file. Read-only reference.
- `adws/phases/scenarioFixPhase.ts` — Owns the gherkin-freeze (`captureGherkinSnapshot`/`restoreGherkinSnapshot`, lines 66/114). Only entered when the scenario test loop finds blocker failures to fix. Read-only reference.
- `adws/phases/planValidationPhase.ts` — `executePlanValidationPhase` skips when `findScenarioFiles(issueNumber)` is empty (~line 68). Not in `adwSdlc.tsx`'s main flow (alignment replaced it in SDLC), but is the "validation" step named in the PRD; confirms it no-ops. Read-only reference.
- `adws/adwSdlc.tsx` — The SDLC orchestrator. Shows the phase order: `runPhasesParallel([executePlanPhase, executeScenarioPhase])` (line 80) → `executeAlignmentPhase` (line 81) → build → stepDef → unitTest → `runScenarioTestFixLoop` (line 86). No orchestrator change is required — the gate lives inside the phases. Read-only reference.
- `specs/prd/automated-scenario-promotion-sweep.md` — Parent PRD. User Story 11 and Implementation Decisions "Pipeline modifications" (line 95), "Empty-target-tag invariant" (line 106), and "Residual to finalise" (line 175, the skip-gate cascade scope) are the governing spec. Read-only reference.
- `adws/github/__tests__/labelManager.test.ts` — Existing unit-test home for the pure label readers; read-only reference for the `GitHubLabel`-array test style. Per the parent PRD's Testing Decisions, `shouldSkipScenarioAuthoring` is **"Not unit-tested (integration-covered)"**, so **no new gate unit test is added here** — the gate is proved behaviourally by the `@adw-742` BDD scenarios.

### Conditional Documentation
Per `.adw/conditional_docs.md`, these app_docs match the touched files and should be read before implementing:

- `app_docs/feature-hpq6cn-implement-scenario-p-scenario-planner-agent.md` — Condition: "When modifying `adws/agents/scenarioAgent.ts` or `adws/phases/scenarioPhase.ts`". Directly matches the primary wiring point.
- `app_docs/feature-sinbtg-plan-scenario-validation-resolution.md` — Condition: "When working with `planValidationPhase`, `validationAgent`, or `resolutionAgent`" / "the plan-scenario alignment gate between planning and build". Context for the alignment/validation no-op reasoning.
- `app_docs/feature-1bg58c-scenario-test-fix-phases.md` — Condition: "When working with `adws/phases/scenarioTestPhase.ts` or `adws/phases/scenarioFixPhase.ts`". Context for the gherkin-freeze/fidelity no-op cascade.

### New Files

- `features/per-issue/feature-742.feature` — BDD acceptance scenarios for the skip gate (authored during this issue's own SDLC run by `scenario_writer`; described here as the behavioural contract). These scenarios are the coverage for **both** the pure gate and the phase wiring: per the parent PRD's Testing Decisions, `shouldSkipScenarioAuthoring` and the pipeline wiring are "integration-covered … exercised via BDD/pipeline behaviour rather than isolated units", so **no new `scenarioPhase.test.ts` / `alignmentPhase.test.ts` unit tests are added**. Note: issue #742 is itself a **normal** `/feature` issue with no `regression-promotion` label, so its own scenario authoring runs as today.

## Implementation Plan

### Phase 1: Foundation — the pure gate

Add the `shouldSkipScenarioAuthoring(labels)` predicate to `adws/github/labelManager.ts` in the "Pure read-side" section, and export it through the `adws/github/index.ts` barrel. The gate is a one-liner over the already-present `ADW_REGRESSION_PROMOTION_LABEL` constant and `GitHubLabel` import — no I/O, no logging, trivially unit-testable. This is the shared decision both phases consume.

### Phase 2: Core Implementation — wire the gate into the two authoring phases

Add an early-return skip guard to `executeScenarioPhase` (before the `/scenario_writer` agent runs) and to `executeAlignmentPhase` (after the resume-skip guard), each returning the same zero-cost `{ costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] }` shape the existing resume-skip guards already return. The scenario-phase guard is load-bearing (prevents authoring); the alignment-phase guard is explicit defense-in-depth. Both log a clear reason and append an orchestrator-state log line for observability.

### Phase 3: Integration — verify the dependent no-op cascade (no code changes)

Confirm — by reading the code, not by adding gates — that the remaining dependent steps cleanly no-op once no `@adw-<promotionIssueN>` feature file is authored, because they all key off `findScenarioFiles(issueNumber)`:

- **Alignment** — `alignmentPhase.ts:88` skips when `findScenarioFiles(issueNumber).length === 0` (now also short-circuited earlier by the explicit gate from Phase 2).
- **Validation** — `planValidationPhase.ts` (~line 68) skips when `findScenarioFiles(issueNumber).length === 0`. (Also not invoked by `adwSdlc.tsx`'s main flow; alignment superseded it in SDLC.)
- **Fidelity** — `scenarioTestFixLoop.ts:76-78` only runs `runScenarioFidelityAgent` when `findScenarioFiles(issueNumber).length > 0` AND after ≥1 resolve retry.
- **Gherkin-freeze** — `scenarioFixPhase.ts` (the freeze/restore) is only entered from the scenario test/fix loop when there are blocker failures to fix. With no `@adw-<promotionIssueN>` file, the `@adw-{issueNumber}` proof tag is optional and skipped (`scenarioProof.ts` `deriveTagOutcome`, zero-testcase + optional → `{passed:true, skipped:true}`), so `hasBlockerFailures` is false, the loop returns early (`scenarioTestFixLoop.ts:62-64`), and the fix phase is never entered.

This satisfies the PRD's "Residual to finalise" item (confirm the skip-gate cascade scope) and keeps the change surface to exactly the touched files named in the issue plus the gate's home module.

The green-proof still runs: the promotion issue's `@regression` tag pass (the relocated scenario, now tagged `@regression`) executes normally in `scenarioTestPhase`; only the empty `@adw-<promotionIssueN>` target tag is skipped — consistent with the PRD's "Empty-target-tag invariant".

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read the governing spec and conditional docs
- Read `specs/prd/automated-scenario-promotion-sweep.md` — User Story 11, Implementation Decisions "Pipeline modifications" (line 95), "Empty-target-tag invariant" (line 106), "Residual to finalise" (line 175).
- Read the three conditional app_docs listed under Relevant Files → Conditional Documentation.
- Read `adws/github/labelManager.ts`, `adws/phases/scenarioPhase.ts`, `adws/phases/alignmentPhase.ts`, `adws/agents/validationAgent.ts` (`findScenarioFiles`), and `adws/adwSdlc.tsx` to confirm the phase order and the no-op cascade.

### Step 2: Add the pure `shouldSkipScenarioAuthoring` gate
- In `adws/github/labelManager.ts`, in the "Pure read-side" section (near `readAdwLabelNames`/`readAdwLabels`), add:
  ```ts
  /**
   * True when scenario authoring must be skipped for this issue — i.e. the issue
   * carries the `regression-promotion` label. Promotion issues relocate an existing
   * per-issue scenario into the regression suite; authoring a fresh
   * feature-<promotionIssueN>.feature for them would redden the run and create a
   * promotion-of-a-promotion candidate. Pure — no I/O, no logging.
   */
  export function shouldSkipScenarioAuthoring(labels: readonly GitHubLabel[]): boolean {
    return labels.some((l) => l.name === ADW_REGRESSION_PROMOTION_LABEL);
  }
  ```
- `GitHubLabel` and `ADW_REGRESSION_PROMOTION_LABEL` are already in scope in this file — no new imports.

### Step 3: Export the gate through the github barrel
- In `adws/github/index.ts`, add `shouldSkipScenarioAuthoring,` (and, for completeness, `ADW_REGRESSION_PROMOTION_LABEL,`) to the existing `export { ... } from './labelManager';` block (lines 40-54).

### Step 4: Wire the gate into `executeScenarioPhase`
- In `adws/phases/scenarioPhase.ts`, import the gate: `import { shouldSkipScenarioAuthoring } from '../github';`.
- After the `config` destructure (line 27) and as the first guard, add:
  ```ts
  // Promotion issues must never author scenarios: a junk feature-<promotionIssueN>.feature
  // would redden the run and become its own future promotion candidate. See PRD user story 11.
  if (shouldSkipScenarioAuthoring(issue.labels)) {
    log('Skipping scenario authoring: regression-promotion issue', 'info');
    AgentStateManager.appendLog(orchestratorStatePath, 'Scenario phase skipped: regression-promotion label present (promotion issue)');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }
  ```
- This returns the exact zero-cost shape the existing resume-skip guard returns, so no cost/token/state accounting is disturbed.

### Step 5: Wire the gate into `executeAlignmentPhase`
- In `adws/phases/alignmentPhase.ts`, import the gate: `import { shouldSkipScenarioAuthoring } from '../github';`.
- Immediately after the resume-skip guard (line 54-57), add:
  ```ts
  // Promotion issues skip scenario authoring entirely; with no @adw-N scenarios the
  // alignment pass has nothing to align. Explicit gate (defense-in-depth on top of the
  // "no scenario files" skip below). See PRD user story 11.
  if (shouldSkipScenarioAuthoring(issue.labels)) {
    log('Skipping alignment phase: regression-promotion issue (no scenario authoring)', 'info');
    AgentStateManager.appendLog(orchestratorStatePath, 'Alignment phase skipped: regression-promotion label present (promotion issue)');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }
  ```
- The gate fires before `readPlanFile`/`findScenarioFiles`, so the promotion path allocates no agent state and posts no stage comment.

### Step 6: Coverage for the gate and wiring is behavioural (no new unit tests)
- Per the parent PRD's **Testing Decisions** (`specs/prd/automated-scenario-promotion-sweep.md`), `shouldSkipScenarioAuthoring` is **"Not unit-tested (integration-covered)"** and the pipeline wiring is **"validated behaviourally (BDD), not unit-tested against mocks of git/gh internals"**. Therefore do **not** add a `shouldSkipScenarioAuthoring` unit test to `labelManager.test.ts`, and do **not** create `scenarioPhase.test.ts` / `alignmentPhase.test.ts`.
- The gate's label truth-table (`regression-promotion` present ⇒ skip; absent ⇒ run, including the `hitl`-but-not-`regression-promotion` discriminator) and the two phases' no-op wiring are proved by the `@adw-742` BDD scenarios authored in Step 7 (§1/§2 scenario-phase truth-table, §3 no-junk-file with the writer armed, §4 alignment no-op, §5 alignment normal-path, §T type-check backstop). This is the behavioural cover the parent PRD assigns to this slice.
- The pre-existing Vitest suite must still pass unchanged (`bun run test:unit`) as a zero-regression guard.

### Step 7: Author the BDD acceptance scenarios (`features/per-issue/feature-742.feature`)
- Tag the feature `@adw-742` (and `@adw-mnmihl-scenario-authoring-s`), following the existing per-issue feature-file conventions.
- Encode the behavioural contract as scenarios (step-definitions generated by the step-def phase; some steps may remain pending stubs behind the harness's ISSUE-3-CUTOVER, per existing per-issue convention — the file shape is the documented contract):
  - Scenario: a `regression-promotion`-labelled issue runs plan/build/test and no `features/per-issue/feature-<promotionIssueN>.feature` is produced (AC #1).
  - Scenario: for such an issue the alignment/validation/gherkin-freeze/fidelity steps report skipped/no-op, not failed (AC #2).
  - Scenario: a normal `adw:feature` issue (no `regression-promotion` label) authors its per-issue scenario exactly as today (AC #3).
- Prefer phrases already registered in `features/regression/vocabulary.md` where they exist; do not assert against framework source-file contents (rot-prevention rule).

### Step 8: Run the full validation suite
- Run every command in "Validation Commands" below and confirm zero errors and zero regressions.

## Testing Strategy

### Test Coverage — integration-covered (BDD), not unit-tested
`.adw/project.md` declares `## Unit Tests: enabled` in general, but the parent PRD's **Testing Decisions** deliberately place this slice in the integration-covered bucket: `shouldSkipScenarioAuthoring` is listed as **"Not unit-tested (integration-covered)"**, and the pipeline wiring is **"validated behaviourally (BDD), not unit-tested against mocks of git/gh internals"**. So **no new Vitest unit tests are added** for the gate or the two phases; the coverage is the `@adw-742` BDD feature file.

- **Pure gate — AC #4** (`shouldSkipScenarioAuthoring`): pinned behaviourally by the label truth-table observed through the phases — `regression-promotion` present ⇒ authoring skipped (feature §1), absent ⇒ authoring runs (feature §2), including the `hitl`-but-not-`regression-promotion` discriminator that proves the gate keys on the right label. The scenarios deliberately do **not** call `shouldSkipScenarioAuthoring([...])` directly and assert its boolean (that would test a source-code property, contrary to the PRD's "externally-observable behaviour, not implementation detail" rule).
- **Scenario-phase skip wiring — AC #1** (feature §1/§3): with the `regression-promotion` label, `/scenario_writer` is never invoked (read from the claude-cli-stub's recorded-invocation log) and no `features/per-issue/feature-<promotionIssueN>.feature` is authored even with the writer armed; without the label the agent runs as today.
- **Alignment-phase skip wiring — AC #2** (feature §4/§5): with the label, `/align_plan_scenarios` is never invoked and the phase returns without raising even when a plan and a `@adw-<N>` scenario are seeded; without the label the normal alignment path still runs.

The pre-existing Vitest suite continues to run unchanged (`bun run test:unit`) as a zero-regression guard; this slice simply adds no new units, per the PRD's Testing Decisions.

### Edge Cases
- Issue with the full promotion label set `[adw:feature, regression-promotion, hitl]` → gate returns true (authoring skipped). This is the real-world input from `promotionIssueBody`.
- Issue with `regression-promotion` sitting among unrelated labels → still true (`.some` match, order-independent).
- Normal feature issue (`adw:feature`, no `regression-promotion`) → gate returns false; scenario authoring runs exactly as today (AC #3 — the "unaffected" guarantee).
- Empty label array → false (no accidental skip of un-labelled issues).
- Case/substring safety — the gate matches the exact label name `regression-promotion` via equality (`l.name === ADW_REGRESSION_PROMOTION_LABEL`), not a substring, so a hypothetical `regression-promotion-foo` label would not trigger it.
- Resume path — on a resumed promotion run the scenario/alignment phases still skip (the gate is independent of `shouldExecuteStage`); the zero-cost return shape matches the resume-skip guard, so cost/state accounting is unchanged.
- Downstream cascade — with no authored `@adw-<promotionIssueN>` file, validation/fidelity/gherkin-freeze skip via `findScenarioFiles` returning empty; the `@regression` green-proof still executes the relocated scenario.

## Acceptance Criteria
- An issue carrying the `regression-promotion` label runs through plan/build/test WITHOUT producing any `features/per-issue/feature-<promotionIssueN>.feature` file (proved by the `@adw-742` BDD scenarios §1/§3 — `/scenario_writer` not invoked, no junk file authored even with the writer armed).
- The dependent alignment/validation/gherkin-freeze/fidelity steps cleanly no-op for such an issue with no spurious failures (proved by the `@adw-742` BDD scenario §4 and the verified `findScenarioFiles`-keyed cascade in Phase 3).
- A normal (non-promotion) feature issue is unaffected — scenario authoring runs exactly as today (proved by the "label absent → `/scenario_writer` invoked" BDD scenarios §2/§5).
- `shouldSkipScenarioAuthoring` is a pure gate consistent with `regression-promotion` label detection: no I/O, no logging, exported from `adws/github/labelManager.ts`, and — per the parent PRD's Testing Decisions ("Not unit-tested (integration-covered)") — proved behaviourally by the `@adw-742` label truth-table (§1/§2) rather than an isolated unit test.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, and `bun run build` all pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Lint the codebase; zero errors.
- `bunx tsc --noEmit` — Type-check the root project; zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the `adws/` project (additional check per `.adw/commands.md`); zero errors.
- `bun run test:unit` — Run the vitest unit suite; the full pre-existing suite passes with zero regressions (this slice adds **no new unit tests** — the gate and wiring are integration-covered by the `@adw-742` BDD scenarios per the PRD's Testing Decisions).
- `bun run build` — Build the project; no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-742"` — Run this issue's BDD scenarios (per `.adw/commands.md` "Run Scenarios by Tag"); no blocker failures.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run the regression suite; no regressions.

## Notes
- **No `.claude/commands/scenario_writer.md` change.** The skip is deterministic and orchestration-level (a phase early-return), not a prompt instruction. This is deliberate — the PRD's whole point is to remove the reliance on LLM discretion that the hand-done #734 promotion got away with on `n=1`.
- **No `adwSdlc.tsx` change.** The gate lives inside `executeScenarioPhase`/`executeAlignmentPhase`, so it fires correctly even though the scenario phase runs in `runPhasesParallel([executePlanPhase, executeScenarioPhase])`.
- **Gate placement.** `shouldSkipScenarioAuthoring` lives in `adws/github/labelManager.ts` (beside `ADW_REGRESSION_PROMOTION_LABEL` and the other pure label readers), not in `adws/core/`, so the label constant and its interpretation stay together and share the existing `labelManager.test.ts`. The `regression-promotion` label is intentionally kept out of `ADW_CLASSIFICATION_LABELS` / `LABEL_TO_COMMAND` (invisible to routing) and out of `ADW_LABEL_DEFINITIONS`; the gate reads only its presence.
- **Empty-target-tag invariant (PRD, verified — must preserve).** A promotion issue has zero `@adw-<promotionIssueN>` scenarios. Because `.adw/review_proof.md` has no `## Tags` table, `@adw-{issueNumber}` defaults to `severity: blocker, optional: true`; a zero-scenario run of an optional tag is `{passed:true, skipped:true}` and does not contribute to `hasBlockerFailures`. This is exactly why suppressing authoring cleanly no-ops the downstream steps and does not redden the run. Do not make `@adw-{issueNumber}` non-optional without explicitly exempting promotion issues.
- **Dependency:** blocked by #740 (the originate path), which is merged (`ADW_REGRESSION_PROMOTION_LABEL`, `promotionSweep`, `promotionIssueBody`, and the deciders are already present). This slice only adds the authoring skip-gate.
- **No new libraries.** Per `.adw/commands.md`, the library install command is `bun add <package>` if one were needed — none is.
- **Coding guidelines.** `.adw/coding_guidelines.md` is present and must be followed. The design already adheres to it: the gate is a **pure** function (Principle 5, side effects isolated at the phase boundary), takes a `readonly GitHubLabel[]` (Type safety / utility types), is written declaratively with `.some` (Functional Programming Practices), uses **guard-clause early returns** for the skip (Nesting & Extraction — happy path stays at the leftmost indent), and carries a JSDoc comment on the public API (Documentation). All three touched files stay well under the 300-line limit (`labelManager.ts` ~183 → ~193; `scenarioPhase.ts` ~98 → ~105; `alignmentPhase.ts` ~209 → ~217). The guidelines flag that BDD scenarios are ADW's primary validation mechanism and agent-written unit tests are a weaker gate — and the parent PRD's Testing Decisions place `shouldSkipScenarioAuthoring` and the pipeline wiring explicitly in the **"Not unit-tested (integration-covered)"** bucket. This plan therefore relies on the `@adw-742` BDD scenarios as the behavioural proof of the gate and its wiring and adds **no new unit tests**; the pre-existing Vitest suite runs unchanged as a zero-regression guard.
