# Feature: Activate the promotion sweep in cron (go-live + backlog)

## Metadata
issueNumber: `745`
adwId: `tpdqb8-activate-promotion-s`
issueJson: `{"number":745,"title":"Activate promotion sweep in cron (go-live + backlog)","body":"## Parent PRD\n\n`specs/prd/automated-scenario-promotion-sweep.md` (PR #738)\n\n## What to build\n\nTurn the sweep on. Wire `runPromotionSweep` into `trigger_cron` under a new interval gate `PROMOTION_SWEEP_INTERVAL_CYCLES` (generous cadence, alongside the existing per-issue sweep). Once live, the first run processes the existing backlog of `@promotion-suggested-*` files (#509/510/511/512/609 — re-scored, then filed-or-withdrawn per the reconciliation lifecycle). Promotion issues inherit ADW'\''s existing resilience (takeover, hung-detector, `## Retry`, stateless `(no hitl) OR (approved)` merge gate).\n\n**HITL:** this slice activates autonomous, `hitl`-issue-filing against the live repo and triggers backlog processing — merge only after human review of the activation and backlog behavior.\n\nSee PRD user stories 21-22, 24-25 and Implementation Decision \"Trigger wiring\".\n\n## Acceptance criteria\n\n- [ ] `runPromotionSweep` is invoked from `trigger_cron` on the `PROMOTION_SWEEP_INTERVAL_CYCLES` cadence\n- [ ] A sweep failure is swallowed and never crashes the cron loop\n- [ ] First live run re-scores the existing backlog and files promotion issues for those still >= threshold, withdrawing the rest\n- [ ] Filed promotion issues flow through the normal pipeline and reach `awaiting_merge` behind the `hitl` gate\n- [ ] Interval cadence is generous (git/gh actions do not run every 20s tick)\n\n## Blocked by\n\n- Blocked by #739\n- Blocked by #740\n- Blocked by #741\n\n## Touched Files\n\n- adws/triggers/trigger_cron.ts\n\n## User stories addressed\n\n- User story 21\n- User story 22\n- User story 24\n- User story 25","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-07-08T11:43:33Z","comments":[],"actionableComment":null}`

## Feature Description
Turn the automated scenario promotion sweep **on** by wiring the already-built, already-tested `runPromotionSweep()` shell into the cron loop (`trigger_cron.ts` → `checkAndTrigger`). Today the sweep is invocable only by hand (`bunx tsx adws/triggers/promotionSweep.ts`); nothing calls it periodically, so per-issue BDD scenarios that would make good permanent regression tests are never discovered, prepared, or protected from the 14-day retention sweep.

This slice adds a new interval gate, `PROMOTION_SWEEP_INTERVAL_CYCLES` (generous cadence, mirroring the sibling `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES`), and invokes the sweep on that cadence inside a non-fatal guard. Once live, the sweep reconciles the in-flight set of `@promotion-suggested-*` per-issue files each eligible cycle: fresh high-scorers are marked and filed as `adw:feature` + `regression-promotion` + `hitl` promotion issues; stranded candidates are re-driven or withdrawn; rejected/blocked ones are declined. The **first live run** re-scores the existing backlog (#509/510/511/512/609 and any other tagged files) and files-or-withdraws each per the reconciliation lifecycle.

The value: promotion discovery + preparation becomes autonomous while a human still gates every promotion at the `hitl` PR merge. No promotion-specific orchestrator, resilience, or recovery machinery is added — filed issues ride ADW's normal plan → build → test → PR pipeline and its existing takeover / hung-detector / `## Retry` / merge-gate resilience.

## User Story
As an ADW maintainer
I want the cron loop to run the promotion sweep on a generous interval, non-fatally
So that high-scoring per-issue scenarios are automatically discovered, protected from the retention sweep, and prepared as `hitl`-gated promotion PRs — and the existing `@promotion-suggested-*` backlog is either promoted or cleanly withdrawn rather than silently lost.

## Problem Statement
`runPromotionSweep()` and its full reconciliation lifecycle (pure `promotionSweepDecider`, `promotionTagState`, `promotionReconcileLink`, `promotionIssueBody`, and the DI shell + production defaults) were built and unit-tested in the blocking slices (#739/#740/#741), but the shell is **wired into no trigger**. Consequences:

- No promotion candidates are ever discovered or filed automatically; the only promotion to date (#734) was done entirely by hand.
- The existing backlog of `@promotion-suggested-*` per-issue files (#509/510/511/512/609) sits tagged but unreconciled — TTL-exempt yet unpromoted, indefinitely stranded.
- The maintainer has no periodic, self-healing reconciliation of tagged files against their tracking issues.

The wiring must be **non-fatal**: `runPromotionSweep`'s per-candidate actions are internally guarded, but its context setup — the injected reconciliation query (`gh issue list`), vocabulary/stats loads, and `parseVocabulary`/`computeThreshold` — runs *outside* any try/catch and can throw on a transient git/gh error. A raw `await runPromotionSweep()` in the cron tick could therefore surface an exception into `checkAndTrigger` and, if unhandled, crash the cron loop. The cadence must also be generous so the sweep's git/gh *actions* (all-state issue listing, commit-to-default, issue creation) do not run on every 20-second tick.

## Solution Statement
Mirror the established sibling-sweep wiring (`runPerIssueScenarioSweep`) and the non-fatal scan precedent (`runUpgradeRedriveScan`):

1. **Add a new interval constant** `PROMOTION_SWEEP_INTERVAL_CYCLES` in `adws/core/config.ts`, immediately beside `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES`, defaulting to a generous cadence (`4320` ≈ once per day at the 20s poll), overridable via the env var of the same name. Export it through the `adws/core/index.ts` barrel alongside the other interval constants.

2. **Add a small exported guarded pass** `runPromotionSweepPass()` in `trigger_cron.ts` that invokes `runPromotionSweep()` inside a try/catch, logging a non-fatal warning and swallowing any throw (mirroring the `runUpgradeRedriveScan` try/catch at `trigger_cron.ts:270-274`). It takes a dependency-injected `sweep` function defaulting to the real `runPromotionSweep`, so the swallow guarantee is unit-testable at an exported seam — exactly the pattern by which `runHungDetectorSweep` is exported for test access in this same file.

3. **Wire the gated call** into `checkAndTrigger`, immediately after the per-issue scenario sweep block (`trigger_cron.ts:212-215`), using the identical `cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0` gate: `if (cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0) await runPromotionSweepPass();`. Update the `../core` import to include the new constant and add a `runPromotionSweep` import from `./promotionSweep`.

4. **Rely on already-built machinery for the rest.** The backlog re-score/file/withdraw behaviour (criterion 3), the pipeline routing to `awaiting_merge` behind the `hitl` gate (criterion 4), and the reconciliation lifecycle are all provided by the blocking slices and the normal SDLC pipeline; this slice only turns the sweep on. Those criteria are observed at go-live under human review (this is a `hitl` issue) — no new code implements them.

The change is intentionally minimal and additive: one constant + one barrel export + one exported guarded helper + one gated call + import lines. No modification to the sweep, its deciders, its defaults, or the pipeline.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/trigger_cron.ts` — **Primary (modified).** The cron entry/backlog sweeper. `checkAndTrigger()` (line 193) already gates the sibling sweeps (`runHungDetectorSweep` :203, `runJanitorPass` :208, `runPerIssueScenarioSweep` :213, `runUpgradeRedriveScan` :270). Add the new `../core` constant to the line-12 import, add a `runPromotionSweep` import, add the exported `runPromotionSweepPass` helper, and insert the gated call after the per-issue sweep block.
- `adws/core/config.ts` — **Modified.** Home of the interval constants. Add `PROMOTION_SWEEP_INTERVAL_CYCLES` beside `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` (line 135), same `parseInt(process.env... || '4320', 10)` shape with a doc comment stating the cadence.
- `adws/core/index.ts` — **Modified.** The `./config` barrel (line 10) that re-exports every interval constant consumed by `trigger_cron.ts`. Add `PROMOTION_SWEEP_INTERVAL_CYCLES` to that export list.
- `adws/triggers/promotionSweep.ts` — **Read-only (not modified).** Defines `runPromotionSweep(deps?): Promise<PromotionSweepReport>` (line 239). Confirms: async, no required args (production defaults resolve repo via `getRepoInfo()`), per-candidate actions internally guarded, but ctx setup (`listPromotionIssues()`, vocab/stats loads, `parseVocabulary`/`computeThreshold`) outside try/catch — the reason the cron site must guard the call.
- `adws/triggers/promotionSweepDefaults.ts` — **Read-only (not modified).** Production deps. `defaultListPromotionIssues`/`defaultLoad*`/`defaultScenariosConfig` self-defend (return empty on error); `defaultTagAndCommit`/`defaultFileIssue` deliberately throw (guarded by the shell's per-candidate try/catch). Establishes that a transient failure at setup is still possible and must be caught at the cron site.
- `adws/triggers/perIssueScenarioSweep.ts` — **Read-only (not modified).** The sibling sweep whose cron wiring and DI-with-production-defaults shell this slice mirrors.
- `adws/triggers/__tests__/trigger_cron.test.ts` — **Modified (unit tests).** Existing cron-integration test that already `vi.mock`s all module-level side effects and imports `runHungDetectorSweep` from `../trigger_cron`. Extend it with a `runPromotionSweepPass` describe block asserting the swallow-and-log and happy-path behaviours.

### Conditional Docs (read before implementing)
- `app_docs/feature-vpb048-promotion-sweep-originate.md` — **Primary.** Owns `promotionSweep.ts`/`promotionSweepDefaults.ts` and the deciders; its conditions explicitly include *"When wiring the sweep into `trigger_cron.ts` (interval-gate) in a later slice"* — i.e. this issue. Read for the sweep's contract, non-fatal seams, and the reconciliation lifecycle the go-live activates.
- `app_docs/feature-9gjajh-issue-routing-and-eligibility.md` — Owns `perIssueScenarioSweep.ts` + `devServerJanitor.ts` and covers the per-issue retention sweep + `trigger_cron.ts` cron-probe additions. Read for the sibling wiring pattern being mirrored.
- `app_docs/feature-ne2we8-promotion-tag-state.md` — Owns `promotionTagState.ts` (the `@promotion-suggested-<date>` / `@promotion-declined` markers and `isPromotionExempt`). Supporting context for what the sweep reads/writes when it runs against the backlog.

## Implementation Plan
### Phase 1: Foundation
Introduce the interval gate as a first-class, env-overridable constant, keeping it centralized with its siblings.
- Add `PROMOTION_SWEEP_INTERVAL_CYCLES` to `adws/core/config.ts` (default `4320`, overridable via env), documented with a comment matching the sibling constant's style.
- Re-export it from the `adws/core/index.ts` `./config` barrel so `trigger_cron.ts` can import it from `../core` like the other interval constants.

### Phase 2: Core Implementation
Wire the sweep into the cron tick behind the gate, non-fatally.
- Add an exported `runPromotionSweepPass(sweep = runPromotionSweep)` helper in `trigger_cron.ts` that awaits the sweep inside a try/catch and logs-and-swallows any throw. The injectable `sweep` param (defaulting to the real function) exposes a unit-testable seam for the swallow guarantee.
- Import `runPromotionSweep` from `./promotionSweep` and add `PROMOTION_SWEEP_INTERVAL_CYCLES` to the existing `../core` import.
- Insert the gated call `if (cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0) await runPromotionSweepPass();` in `checkAndTrigger`, immediately after the per-issue scenario sweep block, with a one-line comment explaining the generous cadence.

### Phase 3: Integration
Confirm the activation integrates cleanly with the existing cron probes and the downstream pipeline.
- Verify the new gate coexists with the sibling probes (hung-detector, janitor, per-issue sweep, upgrade-redrive) and does not perturb the eligibility loop that follows.
- Confirm (by reading, no code change) that filed promotion issues carry `[adw:feature, regression-promotion, hitl]`, so `adw:feature` deterministically routes them through the normal SDLC pipeline (`regression-promotion` is not an `adw:*` label and is invisible to `LABEL_TO_COMMAND`) and `hitl` blocks the merge until human approval — satisfying criterion 4 via inherited behaviour.
- Preserve the empty-target-tag invariant (PRD lines 106-112): a promotion issue has zero `@adw-{promotionIssueN}` scenarios and must remain classified `{passed, skipped}` so the run does not redden. This slice must not add any code that treats `@adw-{issueNumber}` as non-optional.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1: Add the interval constant
- In `adws/core/config.ts`, immediately after the `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` definition (line 135), add:
  - A doc comment: `/** Number of cron poll cycles between promotion-sweep passes. Default 4320 ≈ once per day at 20s POLL_INTERVAL_MS. Generous so the sweep's git/gh actions (all-state issue listing, commit-to-default, issue creation) do not run every 20s tick. */`
  - `export const PROMOTION_SWEEP_INTERVAL_CYCLES = parseInt(process.env.PROMOTION_SWEEP_INTERVAL_CYCLES || '4320', 10);`

### Task 2: Barrel-export the constant
- In `adws/core/index.ts`, add `PROMOTION_SWEEP_INTERVAL_CYCLES` to the `export { ... } from './config';` list (line 10), adjacent to `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES`.

### Task 3: Import the sweep and constant into the cron
- In `adws/triggers/trigger_cron.ts`, add `PROMOTION_SWEEP_INTERVAL_CYCLES` to the existing `import { ... } from '../core';` (line 12).
- Add a new import: `import { runPromotionSweep } from './promotionSweep';` next to the `runPerIssueScenarioSweep` import (line 36).

### Task 4: Add the exported guarded pass
- In `adws/triggers/trigger_cron.ts`, add near the other exported sweep helper (`runHungDetectorSweep`):
  ```ts
  /**
   * Promotion sweep pass: reconciles tagged per-issue scenarios and files/withdraws
   * promotion issues. Non-fatal — a transient git/gh failure during setup (the
   * reconciliation query, vocab/stats loads) is logged and swallowed so it can
   * never abort the cron tick. Exported so tests can drive the guard directly.
   */
  export async function runPromotionSweepPass(sweep: () => Promise<unknown> = runPromotionSweep): Promise<void> {
    try {
      await sweep();
    } catch (error) {
      log(`promotionSweep: pass failed (non-fatal): ${error}`, 'error');
    }
  }
  ```

### Task 5: Wire the gated call into checkAndTrigger
- In `adws/triggers/trigger_cron.ts` `checkAndTrigger()`, immediately after the per-issue scenario sweep block (line 215), add:
  ```ts
  // Run the promotion sweep every PROMOTION_SWEEP_INTERVAL_CYCLES cycles (generous
  // cadence: git/gh actions must not run every 20s tick). Non-fatal by construction.
  if (cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0) {
    await runPromotionSweepPass();
  }
  ```

### Task 6: Add unit tests for the guarded pass
- Extend `adws/triggers/__tests__/trigger_cron.test.ts` with a `describe('runPromotionSweepPass', ...)` block. Import `runPromotionSweepPass` from `../trigger_cron` (alongside the existing `runHungDetectorSweep` import). Assert:
  - **Swallows a throwing sweep:** injecting a `sweep` that rejects, `await expect(runPromotionSweepPass(rejectingSweep)).resolves.toBeUndefined()` (does not reject) and the non-fatal `log` is called.
  - **Swallows a synchronous throw:** injecting a `sweep` that throws synchronously is also caught and does not reject.
  - **Happy path invokes the sweep once:** injecting a resolving spy `sweep` calls it exactly once and does not log an error.
- Follow the existing file's conventions: reuse its module-level `vi.mock` setup (all side-effect deps already mocked) and, if it spies on the core `log`, assert against that mock; otherwise inject observable behaviour via the `sweep` param only.

### Task 7: Validate
- Run every command in `## Validation Commands` and confirm zero errors and zero test regressions.

## Testing Strategy
### Unit Tests
Unit tests are enabled (`.adw/project.md` → `## Unit Tests: enabled`, framework `vitest`, `bun run test:unit`).

- **`runPromotionSweepPass` (new, in `adws/triggers/__tests__/trigger_cron.test.ts`):** the one new behaviour introduced at the wiring layer is the non-fatal guarantee (acceptance criterion 2). Cover it at the exported seam using the injectable `sweep` param:
  - A rejecting `sweep` is swallowed — the pass resolves (does not reject) and the non-fatal `log` fires.
  - A synchronously-throwing `sweep` is swallowed identically.
  - A resolving `sweep` is invoked exactly once and produces no error log (happy path).
- **Not newly unit-tested (already covered / integration-covered):** `runPromotionSweep` and all its pure deciders (`promotionSweepDecider`, `promotionTagState`, `promotionReconcileLink`, `promotionIssueBody`) are exhaustively unit-tested by the blocking slices #739/#740/#741. Per the PRD Testing Decisions, the sweep shell and pipeline wiring are validated behaviourally, not against mocks of git/gh internals. The interval-gate arithmetic (`cycleCount % N === 0`) and the constant parse mirror the already-shipped sibling and need no bespoke test.

### Edge Cases
- **Transient git/gh failure at sweep setup** (reconciliation `gh issue list`, vocab/stats read): must be caught by `runPromotionSweepPass` and logged non-fatally; the cron tick continues to the eligibility loop. (Directly tested.)
- **Cadence boundary:** on cron start `cycleCount` begins at 0 and increments to 1 on the first tick, so the first promotion sweep fires at `cycleCount === 4320` (≈24h), identical to the per-issue sweep. For immediate go-live backlog observation, the operator uses the manual CLI (`bunx tsx adws/triggers/promotionSweep.ts`) — see Notes.
- **Env override:** `PROMOTION_SWEEP_INTERVAL_CYCLES=<n>` changes the cadence; a non-numeric value falls back through `parseInt` to `NaN` (matching sibling behaviour — no new handling required, but do not introduce stricter validation than the siblings).
- **Empty/absent backlog:** with no tagged files, `runPromotionSweep` returns an empty report and performs no git/gh writes (no-op), so the gated call is safe on a clean repo.
- **Non-default branch checkout:** `defaultTagAndCommit` no-ops (does not throw) when the cron checkout is not on the default branch, so persistence is skipped safely — inherited, unchanged.

## Acceptance Criteria
- `runPromotionSweep` is invoked from `trigger_cron` (`checkAndTrigger`) on the `PROMOTION_SWEEP_INTERVAL_CYCLES` cadence via the `cycleCount % PROMOTION_SWEEP_INTERVAL_CYCLES === 0` gate, adjacent to the per-issue sweep.
- A sweep failure (including a throw at setup) is swallowed by `runPromotionSweepPass` and never propagates into the cron loop — proven by unit test.
- `PROMOTION_SWEEP_INTERVAL_CYCLES` exists in `adws/core/config.ts`, is barrel-exported from `adws/core/index.ts`, defaults to a generous once-per-day cadence, and is env-overridable — so git/gh actions do not run every 20s tick.
- Filed promotion issues carry `[adw:feature, regression-promotion, hitl]` and route through the normal SDLC pipeline to `awaiting_merge` behind the `hitl` gate (inherited, unchanged by this slice).
- On the first eligible live run the sweep re-scores the existing `@promotion-suggested-*` backlog (#509/510/511/512/609 and any other tagged files) and files-or-withdraws each per the reconciliation lifecycle (inherited behaviour, observed at go-live under human review).
- `bun run lint`, `bunx tsc --noEmit` (both tsconfigs), `bun run test:unit`, and `bun run build` all pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Lint the codebase; must pass with no new errors.
- `bunx tsc --noEmit` — Type-check the root project; must pass.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the `adws/` project (where all changed files live); must pass.
- `bun run test:unit -- adws/triggers/__tests__/trigger_cron.test.ts` — Focused run of the extended cron test; the new `runPromotionSweepPass` cases must pass.
- `bun run test:unit` — Full unit suite; must pass with zero regressions.
- `bun run build` — Build the project; must complete with no errors.

> Note: do **not** run `bunx tsx adws/triggers/promotionSweep.ts` as an automated validation step — it performs real git commits to the default branch and files live GitHub issues against the repo. It is the operator's manual go-live tool, exercised deliberately under human review, not a CI check.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): keep the change modular and pure at the edges. `runPromotionSweepPass` isolates the side effects (sweep invocation + logging) behind a named function with a single responsibility and a guard-clause try/catch — no nesting beyond one level. The additions to `trigger_cron.ts` are minimal (imports + one exported helper + one gated call); the file is a pre-existing orchestrator entry already above the 300-line guideline, and a wholesale refactor of it is out of scope for this wiring slice.
- **Touched-files note:** the issue lists only `adws/triggers/trigger_cron.ts`, but the interval constant must live with its siblings in `adws/core/config.ts` and be re-exported from `adws/core/index.ts` (that is where `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` and every other interval constant is defined and exported). Defining it inline in `trigger_cron.ts` would break the established centralized, env-overridable pattern. The two extra files are the correct, convention-matching locations; the issue's list is indicative of the primary file, not exhaustive.
- **Why an exported wrapper rather than an inline try/catch:** the swallow guarantee (criterion 2) is the one novel wiring behaviour, and unit tests are enabled. An exported `runPromotionSweepPass` with an injectable `sweep` makes that guarantee testable at a clean seam — directly following the in-file precedent by which `runHungDetectorSweep` is exported "so integration tests can invoke the sweep logic directly." Inline `try/catch` (as with `runUpgradeRedriveScan`) would work but leaves criterion 2 unpinnable by a unit test.
- **Cadence value:** `4320` matches the per-issue sweep (once per day at the 20s poll) and is the natural sibling default the PRD calls for ("interval-gated, like the per-issue sweep"). Tune via the `PROMOTION_SWEEP_INTERVAL_CYCLES` env var without a code change.
- **Go-live / backlog observation:** because the first cron-driven sweep only fires after a full interval (≈24h), the go-live operator should process the backlog immediately by running the manual CLI once — `bunx tsx adws/triggers/promotionSweep.ts` — and review the filed/withdrawn results and the resulting `hitl` PRs before merging this activation. This is consistent with the issue's HITL note ("merge only after human review of the activation and backlog behavior").
- **Inherited invariants to preserve (no code change):** filed issues route via `adw:feature` (deterministic, bypasses AI classification); `regression-promotion` is not an `adw:*` label; the empty-target-tag invariant keeps a zero-`@adw-{promotionIssueN}` run classified `{passed, skipped}` so promotions don't redden; the stateless `(no hitl) OR (approved)` merge gate holds the PR until human approval. This slice must not disturb any of these.
- **Repo context:** `runPromotionSweep`'s production defaults resolve the repo via `getRepoInfo()` / `gitContextForRepo(getRepoInfo())`, identical to the already-live `runPerIssueScenarioSweep`, so target-repo behaviour matches the established, proven sibling — no new repo-resolution logic is introduced.
- **No new libraries** are required.
