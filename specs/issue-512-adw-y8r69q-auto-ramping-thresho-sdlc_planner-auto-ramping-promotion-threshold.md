# Feature: Auto-ramping promotion threshold N from 90-day activity ratio

## Metadata
issueNumber: `512`
adwId: `y8r69q-auto-ramping-thresho`
issueJson: `{"number":512,"title":"Auto-ramping threshold N from 90-day activity ratio","body":"## Parent PRD\n\n`specs/prd/scenario-rot-prevention-and-promotion.md`\n\n## What to build\n\nReplace the hardcoded `N = 3` in `promotionThreshold` (from slice #509) with the auto-ramping formula described in the PRD:\n\n- **Numerator** — count of scenarios moved into the regression directory by `promotionMover` over the last 90 days (queried from git history of `regression-promotion`-labelled PRs)\n- **Denominator** — count of per-issue scenarios written by `scenario_writer` over the last 90 days (queried from git history of per-issue files)\n- **Bootstrap** — when denominator is zero, return the framework default of `3`\n- **Above bootstrap** — N rises with the ratio; the exact curve is a constant inside `promotionThreshold`\n\nThe formula is framework-owned and not per-repo overridable. The curve shape is a design decision that warrants review before merge — hence HITL.\n\n## Acceptance criteria\n\n- [ ] `promotionThreshold` reads promotion stats from git history (no external state file)\n- [ ] Bootstrap behaviour: when no per-issue scenarios have been written in the 90-day window, N = 3\n- [ ] Curve produces a monotonically non-decreasing N as the promotion ratio rises\n- [ ] Curve is bounded (no unbounded growth) — bounds defined as constants in `promotionThreshold`\n- [ ] Unit tests cover bootstrap, low-ratio, mid-ratio, high-ratio, and bound conditions with synthetic `PromotionStats`\n- [ ] No `.adw/scenarios.md` knob for overriding N (verify by inspection of the prompt)\n- [ ] Smoke scenario under `features/regression/` confirms a synthetic repo with high promotion ratio produces a higher N than a young repo\n\n## Blocked by\n\n- Blocked by #511\n\n## User stories addressed\n\n- User story 6 (N auto-ramps with promotion-activity ratio)\n- User story 7 (N framework-owned, not per-repo overridable)","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-05-20T22:45:30Z","comments":[],"actionableComment":null}`

## Feature Description

This slice ships the auto-ramping behaviour of the promotion-threshold function described in `specs/prd/scenario-rot-prevention-and-promotion.md` §"Activity ratio formula" and user stories 6 and 7. Slice #4 (issue #509) introduced `promotionThreshold.computeThreshold` as a deep module returning the hardcoded bootstrap value of `3`. Slice #5 (issue #511) wired the `promotionMover` half of the HITL promotion loop so that the regression-bound history needed for the *numerator* of the activity ratio can actually exist. This slice closes the formula: `computeThreshold` becomes ratio-aware, the caller (`promotionCommenter`) sources real `PromotionStats` from git history, and the curve grows N from `BOOTSTRAP_THRESHOLD = 3` up to a new `MAX_THRESHOLD` constant as the repo's promotion-to-write ratio rises across the rolling 90-day window.

Two layers change:

1. **`promotionThreshold.ts` (pure deep module).** `computeThreshold(stats)` keeps its current signature (`PromotionStats → number`) but its body becomes a ratio-aware piecewise-linear ramp bounded between two new constants (`BOOTSTRAP_THRESHOLD = 3`, `MAX_THRESHOLD = 7`). The ramp saturates at a new `RATIO_CAP = 0.5` (50% promotion rate maps to `MAX_THRESHOLD`). Bootstrap behaviour (`totalPerIssueCount90d === 0 → 3`) is preserved.

2. **New thin module `promotionStatsLoader.ts` (orchestrator-side I/O).** Pure function `loadPromotionStats(deps)` that shells out to `git log` twice — once to count regression-promotion commits in the last 90 days (numerator), once to count `+Scenario:` line additions in per-issue feature files in the same window (denominator) — and returns a `PromotionStats`. All git invocations behind injected `runGit` and `now` deps so the unit tests can drive it without standing up a repo.

The orchestrator `adwPromotionSweep.tsx` builds a default `loadPromotionStats` dep wired to `execWithRetry('git log …', { cwd })` and threads the produced stats through a new `loadStats` dep on `PromotionCommenterDeps`. `promotionCommenter` calls `deps.loadStats()` once at the top and passes the result into the existing `computeThreshold(stats)` call site (`adws/promotion/promotionCommenter.ts:45`), replacing the hardcoded zeros.

The framework owns the curve constants in `promotionThreshold.ts`. There is no per-repo override knob — `.adw/scenarios.md` is unchanged (and the `scenario_writer.md` prompt already documents in its `## Polymorphism on \`.adw/scenarios.md\`` block that only the three directory / vocabulary sections are honoured; nothing about a threshold N). Acceptance criterion 6 ("No `.adw/scenarios.md` knob for overriding N") is satisfied by *absence* and is verified by inspection of `scenario_writer.md` plus the `ScenariosConfig` interface in `adws/core/projectConfig.ts:36`.

## User Story

As an ADW developer
I want the promotion-suggestion threshold N to auto-ramp from the framework default of 3 in a young repo up to a bounded maximum as the repo's 90-day promotion-activity ratio rises
So that early repos get lenient suggestions to grow their vocabulary while mature repos with consistent curation get tighter thresholds, all without per-repo configuration drift or accumulated state files.

## Problem Statement

After slice #4 (issue #509) landed, `computeThreshold` returns a hardcoded `3` regardless of the repo's promotion activity. The `_stats` parameter is prefixed with an underscore — the deep module exists but ignores its input. The `promotionCommenter` orchestrator (`adws/promotion/promotionCommenter.ts:45`) passes hardcoded zeros (`{ promotedCount90d: 0, totalPerIssueCount90d: 0 }`) because there is no caller-side wiring to source real stats.

The consequence in a mature repo: every per-issue scenario that scores ≥ 3 gets a `@promotion-suggested-<date>` tag and a comment. That is the right behaviour while the team is still building vocabulary, but once promotion is a regular event the noise floor stays at 3 forever, producing fatigue and weakening the signal that any single suggestion is worth acting on. PRD §"Threshold N is auto-ramping" (and user story 6) calls for the threshold to grow with the ratio of promoted-to-written scenarios over a rolling 90-day window so that a repo that promotes one scenario every two months sees the same suggestion rate as a repo that promotes ten — both are well-curated and should not be nagged.

In parallel, the team has explicitly ruled out per-repo overrides of N (user story 7). The current code already has no such knob, but the *absence* needs to be confirmed by inspection of the `scenario_writer.md` prompt and the `ScenariosConfig` interface (`adws/core/projectConfig.ts:36`) so that a future PR cannot quietly add one without surfacing the policy violation.

## Solution Statement

Three additions, all bounded and consistent with the slice-#4 / slice-#5 design:

1. **Make `computeThreshold` ratio-aware (pure deep module change).** Replace the body of `adws/promotion/promotionThreshold.ts:7-9` with a piecewise-linear ramp:
   - `if totalPerIssueCount90d === 0: return BOOTSTRAP_THRESHOLD` (preserves PRD bootstrap §)
   - `ratio = clamp(promotedCount90d / totalPerIssueCount90d, 0, 1)`
   - `cappedRatio = min(ratio, RATIO_CAP) / RATIO_CAP` (saturates at RATIO_CAP)
   - `span = MAX_THRESHOLD - BOOTSTRAP_THRESHOLD`
   - `return BOOTSTRAP_THRESHOLD + Math.round(span * cappedRatio)`
   - Three constants exported at the top of the module: `BOOTSTRAP_THRESHOLD = 3` (already exists, retained), `MAX_THRESHOLD = 7` (new), `RATIO_CAP = 0.5` (new). The `7` is one above the typical "well-scored scenario" (3 surface + 3 subprocess = 6) so suggestions stop firing when the bar is meaningfully higher than the comfort floor; the `0.5` corresponds to "half of all per-issue scenarios are getting promoted" which is treated as the mature-curation saturation point. Both values are documented inline alongside the curve so a future tuner sees the rationale, not just the magic numbers.

2. **Add a thin `promotionStatsLoader` deep module (pure, I/O behind injected deps).** New file `adws/promotion/promotionStatsLoader.ts` exports `loadPromotionStats(deps): PromotionStats`. The two queries:
   - **Numerator** — count of commits matching the structural prefix `^regression-promotion:` written by `promotionMover.commitChanges` (`adws/promotion/promotionMover.ts:166`) within the last 90 days. Shell: `git log --since="${isoSince}" --grep="^regression-promotion:" --no-merges --oneline`. The count is `splitLines(stdout).filter(nonEmpty).length`. The prefix is structural (matches `promotionMover.ts` exactly) so this query stays robust across repos that change their `Regression Scenario Directory` setting.
   - **Denominator** — count of `Scenario:` keyword additions inside `features/per-issue/feature-*.feature` files in the same window. Shell: `git log --since="${isoSince}" --no-merges -p -- 'features/per-issue/feature-*.feature'`. The denominator is the count of diff lines matching `^\+\s*Scenario:` (the unified-diff `+` prefix means "added"). This counts *scenario blocks added*, not files added, so a per-issue file that has additional scenarios appended in a later commit is correctly counted. The file glob is hardcoded to `features/per-issue/` (the framework default for `## Per-Issue Scenario Directory`); deps factory could be extended to honour `loadProjectConfig(...).scenarios.perIssueScenarioDirectory` so target repos with a non-default directory still count correctly — addressed by Step 7 of the implementation plan.
   - Deps: `runGit(args: string, options: { cwd: string }) → string` (sync stdout), `now() → Date`, `perIssueGlob: string`, `cwd: string`, `log?` (debug-level only — git command failures fall back to zero stats rather than throwing, so a brand-new repo without commits cannot crash the orchestrator).

3. **Inject the loader into `promotionCommenter`.** Add `loadStats: () => PromotionStats` to `PromotionCommenterDeps` (`adws/promotion/promotionCommenter.ts:9`). Replace `const threshold = computeThreshold({ promotedCount90d: 0, totalPerIssueCount90d: 0 });` (`promotionCommenter.ts:45`) with `const threshold = computeThreshold(deps.loadStats());`. The default factory in `adws/adwPromotionSweep.tsx:47` wires `loadStats: () => loadPromotionStats({ runGit: realRunGit, now: () => new Date(), perIssueGlob: resolvePerIssueGlob(config), cwd: process.cwd() })`.

`adwPromotionSweep.tsx` and the call site inside `promotionCommenter` are the *only* orchestrator changes — every other consumer of the function continues to use the same signature. No state files are read or written; the 90-day window is computed on demand from git history each invocation. The "no external state file" acceptance criterion (#1) is satisfied by construction: the only persistent state is the git history of `features/per-issue/` and the `regression-promotion:` commits already produced by slice #5.

The framework-owned constraint (acceptance criterion #6) is verified by **manual inspection** of `.claude/commands/scenario_writer.md`, `.adw/scenarios.md`, and `adws/core/projectConfig.ts`: none of these files contains any reference to a threshold override, and the rot-prevention block in `scenario_writer.md:38` already calls out the framework-owned / non-overridable policy. This verification is performed during the planning + build phases via the greps documented in Step 13 of the implementation plan. No per-issue BDD scenario asserts against the contents of these framework source files — the parent PRD's rot-prevention rule prohibits source-content assertions in scenarios (asserting against `.claude/commands/scenario_writer.md`, `.adw/scenarios.md`, or `adws/promotion/promotionThreshold.ts` from inside a scenario is exactly the rot pattern the PRD was designed to stop).

The smoke scenario (acceptance criterion #7) lives under `features/regression/smoke/promotion_threshold_auto_ramp.feature`, follows the existing `promotion_commenter.feature` shape (mock GitHub API + worktree + manifest-driven Claude stub), and uses two seeded variants of the same scenario: one against a "young repo" worktree (no promotion history) and one against a "mature repo" worktree (pre-seeded git commits matching the `regression-promotion:` and per-issue-scenario conventions). The observable assertion is whether a borderline-score scenario (score = 4) is tagged or not: in the young repo it IS tagged (N=3, 4 ≥ 3), in the mature repo it is NOT tagged (N=5 once promotion ratio ≈ 0.25). The scenario remains pending behind the ISSUE-3-CUTOVER stub in `features/regression/step_definitions/whenSteps.ts:80` (same as `promotion_commenter.feature` and `promotion_mover.feature`); the file shape is the documented contract for the next cutover.

## Relevant Files

Use these files to implement the feature:

### Read-only references (existing code/docs informing the design)

- `specs/prd/scenario-rot-prevention-and-promotion.md` — Parent PRD. **Sections to load**: Solution (HITL gate + auto-ramping threshold), User stories 6 and 7, Modules (`promotionThreshold` as a pure deep module), Activity ratio formula (90-day window, numerator/denominator definitions, bootstrap rule, framework ownership), State storage (no external state file).
- `app_docs/feature-tdauam-promotion-commenter-deep-modules.md` — Slice #4 (issue #509) documentation. Background for the deep-module layout under `adws/promotion/` and the `adwPromotionSweep.tsx` orchestrator shape. Notes that auto-ramp arrives in slice #7 (this slice).
- `app_docs/feature-2wrg9y-promotion-mover-regression-pr.md` — Slice #5 (issue #511) documentation. Background for the `regression-promotion:` commit prefix and `regression-promotion-issue-{N}-{slug}` branch naming convention that this slice's numerator query relies on.
- `features/per-issue/feature-509.feature` — Reference for the per-issue BDD scenario shape used by the commenter half. The new per-issue file for this slice (`feature-512.feature`) follows the same shape: `@adw-512 @adw-y8r69q-auto-ramping-thresho` Feature/Scenario tag pattern, Background `Given the ADW codebase is checked out`, manifest-driven Given/When/Then.
- `features/per-issue/feature-511.feature` — Reference for the multi-scenario per-issue file pattern (8 scenarios) — useful for the threshold per-issue file which will mix several deep-module unit-test surface behaviours.
- `features/regression/smoke/promotion_commenter.feature` — Reference for the smoke-scenario shape (`@regression @smoke`, Background with G1/G4/G11, manifest-driven claude-cli-stub, W1 invocation, assertions on recorded mock-API calls). The new threshold smoke scenario follows the same shape.
- `features/regression/smoke/promotion_mover.feature` — Reference for the slice-#5 smoke scenario layout. Confirms the two-scenario "high signal vs no signal" smoke pattern that this slice mirrors ("young repo vs mature repo").
- `features/regression/step_definitions/whenSteps.ts` — `ORCHESTRATOR_FILES` map already contains `'promotion-sweep': 'adwPromotionSweep.tsx'` from slice #4; no change. The W1 step is still gated by the ISSUE-3-CUTOVER `return 'pending';` — smoke scenarios remain pending.
- `features/regression/vocabulary.md` — Phrase registry. The threshold-smoke assertions reuse existing T2 (recorded comment), T3 (comment containing text), T5 (exit code), T8 (PR creation), G1, G4, G11. No new vocabulary phrases are added in this slice; new per-issue Then steps (git-history seeding assertions) are documented in pending step definitions, not the vocabulary file (consistent with the slice-#4/slice-#5 pattern).
- `adws/promotion/promotionThreshold.ts` — **Direct edit target.** Current 10-line file with `BOOTSTRAP_THRESHOLD = 3` constant and `computeThreshold(_stats)` returning the bootstrap. This slice replaces the function body with the ratio-aware ramp and adds two new exported constants (`MAX_THRESHOLD`, `RATIO_CAP`).
- `adws/promotion/types.ts` — `PromotionStats` interface (lines 29–32) already defines `promotedCount90d: number; totalPerIssueCount90d: number;`. No change needed.
- `adws/promotion/promotionCommenter.ts` — **Direct edit target** at line 9 (`PromotionCommenterDeps` adds `loadStats`) and line 45 (replace hardcoded zeros with `deps.loadStats()`). The rest of the file (vocabulary parse → file iteration → score → tag → comment) is unchanged.
- `adws/promotion/index.ts` — Barrel export. Extended to re-export `loadPromotionStats` from the new module and `MAX_THRESHOLD`, `RATIO_CAP` constants from `promotionThreshold.ts`.
- `adws/promotion/__tests__/promotionThreshold.test.ts` — Existing 22-line test file with four cases (bootstrap, low-ratio, high-ratio, type-shape). All four cases currently assert `3` (the bootstrap return). This slice replaces the file body with the full case matrix from "Testing Strategy" below (bootstrap, low, mid, high, saturation, monotonicity, exact bounds) — the assertions change but the file stays unit-test-only with no I/O.
- `adws/promotion/__tests__/promotionCommenter.test.ts` — Reference for the orchestrator-coordination unit-test style (dep injection via `makeDeps(overrides)`, `vi.fn()` mocks). Extended with two new cases that supply a `loadStats` returning non-zero stats and assert the resulting threshold gates the score correctly. The existing tests get an injected `loadStats: () => ({ promotedCount90d: 0, totalPerIssueCount90d: 0 })` so their behaviour is unchanged.
- `adws/adwPromotionSweep.tsx` — **Direct edit target** in the `buildCommenterDeps(...)` factory (lines 47–63). One new field `loadStats` wired to a `loadPromotionStats(...)` call with the default git-shell dep. Optional: extend `buildCommenterDeps` signature to accept `cwd` (already implicitly `process.cwd()` via the orchestrator's caller).
- `adws/core/utils.ts` — `execWithRetry` (lines 53–78). Used by the default `runGit` dep in `adwPromotionSweep.tsx` (with `{ cwd, encoding: 'utf-8' }`). Existing rate-limit / auth NON_RETRYABLE_PATTERNS short-circuit correctly for `git` invocations (none of those patterns appear in git stderr).
- `adws/github/prCommentDetector.ts` — Reference for the existing in-tree pattern of querying `git log` from a TypeScript module (`execSync` directly, structural regex match against commit subjects). The new stats loader follows the same wrapping pattern but uses `execWithRetry` for retry behaviour. The single existing call site (`getLastAdwCommitTimestamp`) is left untouched.
- `adws/core/projectConfig.ts` — `ScenariosConfig` interface (lines 36–46). **Inspected (not edited)** to verify acceptance criterion #6: no `thresholdN`, `promotionThresholdOverride`, or similar field exists. If any future maintainer attempts to add one, the per-issue scenario added by this slice will flag the violation.
- `.claude/commands/scenario_writer.md` — **Inspected (not edited)** to verify acceptance criterion #6. The existing rot-prevention block (line 38) reads: `Universality: This rule applies to every scenario written, in every target repository, on every invocation. It is framework-owned and is not overridable via .adw/scenarios.md or any per-repo configuration.` The per-issue inspection scenario asserts the absence of any `override` / `threshold` / `tunable` reference.
- `cucumber.js` — Cucumber paths/imports config. No change; new `.feature` files and step definitions under `features/per-issue/step_definitions/` are picked up automatically (the `features/per-issue/` directory is intentionally excluded from the `@regression` runner — scenarios there are agent-input, not executed).
- `vitest.config.ts` — Vitest config (`adws/**/__tests__/**/*.test.ts`). New unit tests are picked up automatically.
- `.adw/project.md` — Confirms `## Unit Tests: enabled` (line 34); unit tests are required for this slice.
- `.adw/scenarios.md` — Polymorphism flags. **Inspected (not edited)** — the file MUST NOT gain a threshold-override section. Confirms acceptance criterion #6 by absence.
- `.adw/coding_guidelines.md` — Mandatory coding guidelines (TypeScript strict, no `any`, guard clauses, max nesting depth ~2, declarative over imperative, isolate side effects, files under 300 lines). Strictly followed.

### New Files

#### Deep modules (extensions to `adws/promotion/`)

- `adws/promotion/promotionStatsLoader.ts` — Pure function `loadPromotionStats(deps: PromotionStatsLoaderDeps): PromotionStats` plus the `PromotionStatsLoaderDeps` interface. Composes two git-log invocations and returns a `PromotionStats`. All I/O behind the injected `runGit` and `now` deps. Total module size target: under 100 lines.

#### Unit tests (extensions/additions under `adws/promotion/__tests__/`)

- `adws/promotion/__tests__/promotionStatsLoader.test.ts` — Eight cases covering the loader against synthetic `runGit` outputs:
  - (a) numerator-only happy path: `runGit('log --grep regression-promotion ...')` returns `"abc1234\ndef5678"` → `promotedCount90d = 2`.
  - (b) denominator-only happy path: `runGit('log -p -- features/per-issue/...')` returns a diff with three `^+\s*Scenario:` lines → `totalPerIssueCount90d = 3`.
  - (c) empty repo: both `runGit` calls return `''` → `{ promotedCount90d: 0, totalPerIssueCount90d: 0 }` (graceful bootstrap).
  - (d) `runGit` throws (e.g., not-a-git-repo) → returns the bootstrap zeros without re-throwing (logged at warn).
  - (e) numerator regex strictness: a non-promotion commit message containing `regression-promotion` as substring (e.g., `chore: rename regression-promotion-foo`) does NOT increment the count — the `--grep "^regression-promotion:"` constraint is enforced by the git invocation, not by post-hoc filtering, so this case asserts the *command string* sent to `runGit` rather than re-parsing.
  - (f) denominator counts only `+` lines (added), not `-` lines or context — diff `"-  Scenario: removed\n   Scenario: context\n+  Scenario: added"` returns `1`.
  - (g) denominator counts ALL added Scenario blocks across multiple files — single `runGit` call returns concatenated diffs for two files with 2 + 3 scenario additions → `5`.
  - (h) `now()` is called once per invocation; the resulting ISO date is passed to `runGit` as `--since="<iso 90 days ago>"`. Asserted by capturing the command string the mock `runGit` receives.
- `adws/promotion/__tests__/promotionThreshold.test.ts` — Existing 22-line file is rewritten to cover the ratio ramp. Eleven cases:
  - (i) bootstrap: `{ 0, 0 } → 3` (preserves existing slice-#4 behaviour).
  - (ii) numerator alone with zero denominator: `{ 5, 0 } → 3` (denominator-guard precedence — even nonsense input cannot crash; the divide-by-zero guard fires first).
  - (iii) zero-ratio: `{ 0, 100 } → 3`.
  - (iv) low-ratio: `{ 5, 100 } → 3` (`ratio = 0.05`; `cappedRatio = 0.1`; `3 + round(4 * 0.1) = 3`).
  - (v) mid-low-ratio: `{ 12, 100 } → 4` (`ratio = 0.12`; `cappedRatio = 0.24`; `3 + round(4 * 0.24) = 4`).
  - (vi) mid-ratio: `{ 25, 100 } → 5` (`ratio = 0.25`; `cappedRatio = 0.5`; `3 + round(4 * 0.5) = 5`).
  - (vii) mid-high-ratio: `{ 40, 100 } → 6` (`ratio = 0.4`; `cappedRatio = 0.8`; `3 + round(4 * 0.8) = 6`).
  - (viii) saturation at RATIO_CAP: `{ 50, 100 } → 7` (`ratio = 0.5`; `cappedRatio = 1.0`).
  - (ix) above-cap: `{ 90, 100 } → 7` (saturates at `MAX_THRESHOLD`, no further growth).
  - (x) full-ratio: `{ 100, 100 } → 7` (still saturates).
  - (xi) monotonicity property: parameterised over a sequence of stats with monotonically increasing ratios — assert `computeThreshold(s_{i+1}) >= computeThreshold(s_i)` for every adjacent pair. Six pairs covering 0 → 0.05 → 0.12 → 0.25 → 0.4 → 0.5 → 1.0.
- `adws/promotion/__tests__/promotionCommenter.test.ts` — Two new cases appended (existing nine cases are updated only by adding `loadStats: () => ({ promotedCount90d: 0, totalPerIssueCount90d: 0 })` to the `makeDeps` defaults so legacy assertions still see the bootstrap threshold):
  - (j) high-stats injection raises threshold above scenario score: a feature file whose only scenario scores `4` (subprocess pattern with one phrase outside the surface block) is suggested when `loadStats` returns `{ 0, 0 }` (N=3) but NOT suggested when `loadStats` returns `{ 50, 100 }` (N=7). Two sub-assertions; one `runPromotionCommenter` call per stats variant.
  - (k) `loadStats` is invoked exactly once per `runPromotionCommenter` call regardless of how many changed files or scenarios are iterated — verified by `vi.fn()` call count.

#### Smoke scenarios

- `features/regression/smoke/promotion_threshold_auto_ramp.feature` — Tagged `@regression @smoke`. Background mirroring `promotion_commenter.feature` (G1, G4, G11). Two scenarios:
  - (a) young repo, borderline-score scenario tagged: pre-seeded worktree has no promotion history (no `regression-promotion:` commits, no per-issue feature files older than the fixture). Manifest pre-seeds a `feature-9200.feature` with one subprocess-pattern scenario that scores 4. `loadPromotionStats` returns `{ 0, 0 }` → bootstrap N = 3 → 4 ≥ 3 → scenario IS tagged.
  - (b) mature repo, same borderline-score scenario NOT tagged: pre-seeded worktree contains five `regression-promotion:` commits (one per scenario, mirrors slice-#5 mover output) and twenty per-issue `Scenario:` additions in `features/per-issue/feature-*.feature` diffs. Ratio = 5/20 = 0.25 → cappedRatio = 0.5 → N = 5 → 4 < 5 → scenario is NOT tagged.
  - The pending W1 step (`when the {string} orchestrator is invoked ...`) keeps both scenarios in the documented-but-not-executed slot until the ISSUE-3-CUTOVER lifts; the scenario shape is the documented contract for the next cutover.

#### Per-issue BDD scenarios + pending step definitions

- `features/per-issue/feature-512.feature` — Tagged `@adw-512 @adw-y8r69q-auto-ramping-thresho`. Ten functional scenarios plus a TypeScript type-check guard. Each functional scenario seeds a synthetic 90-day git history into a test worktree (a fixed number of per-issue `Scenario:` additions and a fixed number of `regression-promotion`-labelled PR commits dated inside or outside the 90-day window), seeds a per-issue `.feature` file containing a scenario calibrated to a known `promotionScorer` score, invokes `promotion-sweep`, and asserts whether the `@promotion-suggested-<today>` tag is present on the seeded scenario in the post-invocation artefact file. The observable behaviour of N is read indirectly through the tag-presence outcome, never by asserting against the contents of `promotionThreshold.ts`, `.adw/scenarios.md`, or any other framework source file.
  - §1.a — Bootstrap (tag): zero per-issue scenarios in the 90-day window triggers bootstrap N = 3 and tags a scoring-3 scenario.
  - §1.b — Bootstrap (no-tag): same zero-history conditions leave a scoring-2 scenario untagged (proves the floor is N = 3, not lower).
  - §2 — Low ratio: a repo with per-issue activity but zero promotions in 90 days still tags a scoring-3 scenario (N stays at the floor when the ratio is at the bottom).
  - §3 — High ratio: a mature repo with a high promotion ratio (8/10) leaves a scoring-3 scenario untagged because N has risen above 3.
  - §4.a — Monotonic floor: a scoring-3 scenario tagged at low ratio (0/20) remains tagged when extra denominator activity is added that does not raise the ratio (ratio cannot decrease N).
  - §4.b — Monotonic rise: raising the promotion ratio from low to high does not lower the tagging-bar — a scoring-3 scenario tagged at low ratio is no longer tagged at high ratio (9/10).
  - §5.a — Bounded (at-bound tagged): a scenario scoring at the upper bound of N is tagged even at an extreme promotion ratio approaching 1.0 (10/10), proving the curve is bounded (if N could exceed the upper bound, the scoring-at-bound scenario would not be tagged at extreme ratio).
  - §5.b — Bounded (above-bound tagged): a scenario scoring one above the upper bound of N remains tagged at an extreme promotion ratio (50/50), reinforcing the bound from the opposite direction.
  - §6 — No external state file: threshold computation responds to a change in git history alone — no promotion-stats state file is read or written under the worktree before or after invocation (directly verifies acceptance criterion #1).
  - §7 — 90-day window: promotion activity older than 90 days does not affect N — an old high-promotion history (20 per-issue / 18 promotions, all dated > 90 days ago) with no recent activity behaves like a young repo (a scoring-3 scenario IS tagged).
  - §type-check — `bunx tsc --noEmit -p adws/tsconfig.json` passes after the auto-ramp changes (standard per-issue TypeScript guard; `Given the ADW codebase is checked out` / `Then the ADW TypeScript type-check passes`).

  Acceptance criterion #6 ("no `.adw/scenarios.md` knob for overriding N") is verified by the manual grep at Step 13, NOT by a per-issue BDD scenario — asserting against the contents of `.claude/commands/scenario_writer.md`, `.adw/scenarios.md`, or `adws/promotion/promotionThreshold.ts` from inside a scenario would be the rot pattern the parent PRD was designed to stop. Acceptance criterion #5 (unit test coverage for bootstrap / low-ratio / mid-ratio / high-ratio / bound conditions) is verified by `adws/promotion/__tests__/promotionThreshold.test.ts`, which is the canonical acceptance check for that AC bullet.
- `features/per-issue/step_definitions/feature-512.steps.ts` — Pending stubs (`return 'pending';`) for every step in `feature-512.feature` not already defined in `features/regression/step_definitions/`. New step phrases to stub: (a) `Given the worktree git history records {int} per-issue scenarios written in the last 90 days`, (b) `Given the worktree git history records {int} regression-promotion PRs merged in the last 90 days`, (c) `Given the worktree git history records {int} per-issue scenarios written more than 90 days ago`, (d) `Given the worktree git history records {int} regression-promotion PRs merged more than 90 days ago`, (e) `Given a per-issue feature file at {string} is seeded into the worktree for adwId {string} with one scenario scoring exactly {int}`, (f) `Given a per-issue feature file at {string} is seeded into the worktree for adwId {string} with one scenario scoring exactly the upper bound of N`, (g) `Given a per-issue feature file at {string} is seeded into the worktree for adwId {string} with one scenario scoring exactly one above the upper bound of N`, (h) `Given no promotion-stats state file exists anywhere under the worktree for adwId {string}`, (i) `Then the artefact file at {string} in the worktree for adwId {string} carries a {string} tag dated today on the seeded scenario`, (j) `Then the artefact file at {string} in the worktree for adwId {string} carries no {string} tag on the seeded scenario`, (k) `Then no promotion-stats state file is present anywhere under the worktree for adwId {string} after the invocation`. Each step body is `return 'pending';` (no live assertion — the harness's subprocess support is still gated by ISSUE-3-CUTOVER per `whenSteps.ts:80`).

#### Mock manifest fixtures

Smoke scenario manifests (for `features/regression/smoke/promotion_threshold_auto_ramp.feature`):

- `test/fixtures/jsonl/manifests/promotion-threshold-young-repo.json` — Pre-seeds a per-issue file with one subprocess-pattern scenario scoring 4. Does NOT pre-seed any promotion history (`runGit` returns empty stdout for the numerator query). The orchestrator should record the `@promotion-suggested-<date>` tag insertion + comment post.
- `test/fixtures/jsonl/manifests/promotion-threshold-mature-repo.json` — Pre-seeds the same per-issue file but with a synthetic git history: five `regression-promotion:`-prefixed commits and twenty per-issue `Scenario:` additions across several `features/per-issue/feature-*.feature` files. The orchestrator should NOT tag the scoring-4 scenario (N rises to 5).

Per-issue scenario manifests (one per scenario in `features/per-issue/feature-512.feature`; each pre-seeds the worktree to the 90-day history shape required by the named scenario):

- `test/fixtures/jsonl/manifests/promotion-threshold-bootstrap.json` — empty git history (0 per-issue / 0 promotions in 90d); seeds one scenario scoring exactly 3.
- `test/fixtures/jsonl/manifests/promotion-threshold-bootstrap-below.json` — empty git history; seeds one scenario scoring exactly 2 (below floor).
- `test/fixtures/jsonl/manifests/promotion-threshold-low-ratio.json` — 12 per-issue scenario additions, 0 promotions in 90d; seeds one scenario scoring exactly 3.
- `test/fixtures/jsonl/manifests/promotion-threshold-high-ratio.json` — 10 per-issue scenario additions, 8 promotions in 90d; seeds one scenario scoring exactly 3.
- `test/fixtures/jsonl/manifests/promotion-threshold-monotonic-floor.json` — 20 per-issue scenario additions, 0 promotions in 90d; seeds one scenario scoring exactly 3 (denominator-only growth at zero ratio).
- `test/fixtures/jsonl/manifests/promotion-threshold-monotonic-rises.json` — 10 per-issue scenario additions, 9 promotions in 90d; seeds one scenario scoring exactly 3.
- `test/fixtures/jsonl/manifests/promotion-threshold-bound-tagged.json` — 10 per-issue scenario additions, 10 promotions in 90d; seeds one scenario scoring exactly the upper bound of N.
- `test/fixtures/jsonl/manifests/promotion-threshold-above-bound-tagged.json` — 50 per-issue scenario additions, 50 promotions in 90d; seeds one scenario scoring exactly one above the upper bound of N.
- `test/fixtures/jsonl/manifests/promotion-threshold-git-history-only.json` — empty git history, no state file present; seeds one scenario scoring exactly 3 (asserts AC #1 directly).
- `test/fixtures/jsonl/manifests/promotion-threshold-stale-history.json` — 20 per-issue scenario additions and 18 promotions ALL dated more than 90 days ago, 0 inside the 90d window; seeds one scenario scoring exactly 3 (asserts the window).

Mock-manifest seed mechanism: all manifests use the existing `edits[]` shape that `promotion-sweep-high-score.json` (slice #4) and `promotion-mover-single-move.json` (slice #5) already use for content seeding, plus a new `commits[]` entry shape (`Array<{ subject: string; date?: string }>`) that records pre-seeded commit subjects and optional commit dates (the latter needed by the stale-history scenario to date commits more than 90 days ago) to be replayed into the worktree by the harness's manifest interpreter. The interpreter extension (translating `commits[]` to `git commit --allow-empty -m <subject> [--date=<date>]` calls during worktree setup) is a small additive change to `test/mocks/manifestInterpreter.ts` and is documented in the implementation steps below.

#### Documentation

- App-feature doc deferred to the documentation phase (build agent + `/document` slash command will produce `app_docs/feature-y8r69q-auto-ramping-promotion-threshold.md` after merge). No additional README change is required because the existing `README.md` `### Scenario Promotion` subsection (line 312, added by slice #5) already documents the promotion mechanism end-to-end; the auto-ramp behaviour is a refinement of the threshold mechanic mentioned there and does not warrant a separate top-level section.

## Implementation Plan

### Phase 1: Foundation

Replace the hardcoded `computeThreshold` body with the ratio-aware ramp, exporting two new constants (`MAX_THRESHOLD`, `RATIO_CAP`) and preserving the existing `BOOTSTRAP_THRESHOLD = 3`. This phase touches only `adws/promotion/promotionThreshold.ts` and its unit-test file; no orchestrator wiring changes. After Phase 1, `computeThreshold` is fully ratio-aware as a pure function and the eleven new unit-test cases pass green, but the orchestrator is still feeding it hardcoded zeros — behaviour at runtime is unchanged.

This isolation is deliberate: the curve constants are the load-bearing design decision under HITL review, and landing them behind a green test matrix *before* wiring the loader means the human reviewer can inspect curve behaviour from the unit tests alone without needing to read orchestrator wiring.

### Phase 2: Core Implementation (Stats Loader)

Implement `promotionStatsLoader.ts` as a pure function with all I/O behind injected deps. Eight unit-test cases (a–h) under `promotionStatsLoader.test.ts` cover the happy paths, the empty-repo bootstrap fall-through, the throw-recovery, and the command-string assertions. No orchestrator wiring changes yet — the loader is testable in complete isolation. After Phase 2, the deep-module surface is complete; the question of "does git history actually look like this in real repos?" is left to Phase 3's integration wiring.

The barrel export at `adws/promotion/index.ts` is extended in Phase 2 (`loadPromotionStats` + `MAX_THRESHOLD` + `RATIO_CAP`) so Phase 3 can import them without further re-exports.

### Phase 3: Integration (Commenter Wiring + Smoke + Per-Issue Scenarios)

Compose the loader into `promotionCommenter` via the new `loadStats` dep, build the default factory in `adwPromotionSweep.tsx`, add the smoke scenario, and add the per-issue acceptance scenarios with pending stubs. After Phase 3, the orchestrator behaviour at runtime changes for the first time: real git history drives the threshold.

The `loadStats` field is required (no `?` modifier) so any future orchestrator that consumes `runPromotionCommenter` must consciously decide what stats to inject (avoiding the silent-bootstrap-fallback footgun). The existing nine `promotionCommenter.test.ts` cases inject `loadStats: () => ({ promotedCount90d: 0, totalPerIssueCount90d: 0 })` via the `makeDeps` factory so their assertions are unchanged.

The smoke scenario writes both halves (young + mature variants) as a single feature file under `features/regression/smoke/`. The manifest interpreter extension (`commits[]` seeding) is a small additive change to `test/mocks/manifestInterpreter.ts`; if its scope grows beyond ~30 lines, that work is split into a follow-up slice with the smoke scenario kept pending in the meantime — the per-issue scenarios in `feature-512.feature` would still document the acceptance contract.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read existing slice-#4 / slice-#5 surfaces

- Read `adws/promotion/promotionThreshold.ts` end-to-end (10 lines, no skimming).
- Read `adws/promotion/types.ts` end-to-end (66 lines).
- Read `adws/promotion/promotionCommenter.ts` end-to-end (93 lines).
- Read `adws/adwPromotionSweep.tsx` end-to-end (159 lines).
- Read `adws/promotion/__tests__/promotionThreshold.test.ts` and `adws/promotion/__tests__/promotionCommenter.test.ts` end-to-end.
- Read `features/regression/smoke/promotion_commenter.feature` and `features/regression/smoke/promotion_mover.feature` end-to-end.
- Skim `features/per-issue/feature-509.feature` and `features/per-issue/feature-511.feature` for the per-issue scenario shape and tag conventions.
- Skim `adws/github/prCommentDetector.ts` (specifically `getLastAdwCommitTimestamp`, lines 26–50) for the in-tree `git log` invocation pattern.

### Step 2: Update `promotionThreshold.ts` to the ratio-aware ramp

- Edit `adws/promotion/promotionThreshold.ts`.
- Keep the existing `export const BOOTSTRAP_THRESHOLD = 3;` line.
- Add two new exported constants:
  ```ts
  export const MAX_THRESHOLD = 7;
  export const RATIO_CAP = 0.5;
  ```
  Each gets a single-line comment explaining its semantic role (one above max realistic non-extra-phase score; mature-curation saturation point).
- Replace the body of `computeThreshold`:
  ```ts
  export function computeThreshold(stats: PromotionStats): number {
    if (stats.totalPerIssueCount90d === 0) return BOOTSTRAP_THRESHOLD;
    const ratio = stats.promotedCount90d / stats.totalPerIssueCount90d;
    const cappedRatio = Math.min(ratio, RATIO_CAP) / RATIO_CAP;
    const span = MAX_THRESHOLD - BOOTSTRAP_THRESHOLD;
    return BOOTSTRAP_THRESHOLD + Math.round(span * cappedRatio);
  }
  ```
- Remove the leading underscore from `_stats` (now consumed).
- Remove the `TODO(slice #7)` comment block — this slice is #7.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` and confirm zero errors.

### Step 3: Replace `promotionThreshold.test.ts` with the full case matrix

- Edit `adws/promotion/__tests__/promotionThreshold.test.ts`.
- Replace the four existing cases with the eleven cases (i–xi) listed in the "Unit tests" section of "Testing Strategy" below.
- For case (xi) (monotonicity), use a parameterised loop:
  ```ts
  it('produces a monotonically non-decreasing N as ratio rises', () => {
    const series: PromotionStats[] = [
      { promotedCount90d: 0, totalPerIssueCount90d: 100 },
      { promotedCount90d: 5, totalPerIssueCount90d: 100 },
      // ...
    ];
    for (let i = 1; i < series.length; i++) {
      expect(computeThreshold(series[i])).toBeGreaterThanOrEqual(computeThreshold(series[i - 1]));
    }
  });
  ```
- Add `import { computeThreshold, BOOTSTRAP_THRESHOLD, MAX_THRESHOLD, RATIO_CAP } from '../promotionThreshold.ts';` at the top.
- Run `bunx vitest run adws/promotion/__tests__/promotionThreshold.test.ts` and confirm all eleven cases green.

### Step 4: Implement `promotionStatsLoader.ts`

- Create `adws/promotion/promotionStatsLoader.ts`.
- Define:
  ```ts
  export interface PromotionStatsLoaderDeps {
    runGit: (args: string, options: { cwd: string }) => string;
    now: () => Date;
    perIssueGlob: string;
    cwd: string;
    log?: (msg: string, level?: string) => void;
  }
  ```
- Implement `export function loadPromotionStats(deps: PromotionStatsLoaderDeps): PromotionStats`.
- Compute `isoSince` as 90 days before `deps.now()`, formatted as `YYYY-MM-DD` (sufficient resolution for `git log --since`).
- **Numerator query**: build the command `log --since="${isoSince}" --grep="^regression-promotion:" --no-merges --oneline`, call `deps.runGit(...)` inside a try/catch. On success, count non-empty lines of stdout. On throw, log warn and use 0.
- **Denominator query**: build the command `log --since="${isoSince}" --no-merges -p -- ${deps.perIssueGlob}`, call `deps.runGit(...)` inside a try/catch. On success, count lines matching `/^\+\s*Scenario:/m`. On throw, log warn and use 0.
- Return `{ promotedCount90d, totalPerIssueCount90d }`.
- Keep the module under 100 lines; extract the two queries into small named helpers (`countPromotionCommits`, `countPerIssueScenarioAdditions`) inside the file so the body of `loadPromotionStats` reads as a two-line composition.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` and confirm zero errors.

### Step 5: Implement `promotionStatsLoader.test.ts`

- Create `adws/promotion/__tests__/promotionStatsLoader.test.ts`.
- Implement the eight cases (a–h) listed in "New Files".
- Pattern: each test uses a `vi.fn()` for `runGit` and asserts both on the returned `PromotionStats` and on the command string that `runGit` received (verifying the `--since` formatting and the structural-grep argument).
- Use a fixed `now: () => new Date('2026-05-21T00:00:00Z')` so `isoSince` is deterministic (`2026-02-20`).
- Run `bunx vitest run adws/promotion/__tests__/promotionStatsLoader.test.ts` and confirm all eight cases green.

### Step 6: Extend the barrel export

- Edit `adws/promotion/index.ts`.
- Add `export { loadPromotionStats } from './promotionStatsLoader.ts';`.
- Update the `computeThreshold` re-export line to include `MAX_THRESHOLD, RATIO_CAP`:
  ```ts
  export { computeThreshold, BOOTSTRAP_THRESHOLD, MAX_THRESHOLD, RATIO_CAP } from './promotionThreshold.ts';
  ```
- Add `export type { PromotionStatsLoaderDeps } from './promotionStatsLoader.ts';`.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` and confirm zero errors.

### Step 7: Wire `loadStats` into `PromotionCommenterDeps`

- Edit `adws/promotion/promotionCommenter.ts`.
- Add `loadStats: () => PromotionStats;` to `PromotionCommenterDeps` (around line 16, alongside the other deps). Import `PromotionStats` from `./types.ts`.
- Replace `const threshold = computeThreshold({ promotedCount90d: 0, totalPerIssueCount90d: 0 });` (line 45) with `const threshold = computeThreshold(deps.loadStats());`.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` and confirm zero errors. (The commenter's unit tests will fail until Step 8 — that is expected.)

### Step 8: Update `promotionCommenter.test.ts`

- Edit `adws/promotion/__tests__/promotionCommenter.test.ts`.
- Update `makeDeps(overrides)` to include `loadStats: () => ({ promotedCount90d: 0, totalPerIssueCount90d: 0 }),` so existing tests see N = 3 unchanged.
- Add the two new cases (j) and (k) from "New Files".
- Run `bunx vitest run adws/promotion/__tests__/promotionCommenter.test.ts` and confirm all eleven cases (nine existing + two new) green.

### Step 9: Wire the default `loadStats` into `adwPromotionSweep.tsx`

- Edit `adws/adwPromotionSweep.tsx`.
- Add an import: `import { loadPromotionStats } from './promotion/index.ts';`.
- In `buildCommenterDeps(...)`, add a new field to the returned object:
  ```ts
  loadStats: () => loadPromotionStats({
    runGit: (args, opts) => execWithRetry(`git ${args}`, opts),
    now: () => new Date(),
    perIssueGlob: 'features/per-issue/feature-*.feature',
    cwd: process.cwd(),
    log: (msg, level) => log(msg, (level ?? 'info') as LogLevel),
  }),
  ```
- If the active repo has a custom `## Per-Issue Scenario Directory`, resolve it from `loadProjectConfig(process.cwd()).scenarios.perIssueScenarioDirectory ?? 'features/per-issue/'` and substitute the glob (`<dir>/feature-*.feature`). This is a defensive addition; the default still works for the framework repo.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` and confirm zero errors.

### Step 10: Add the smoke scenario

- Create `features/regression/smoke/promotion_threshold_auto_ramp.feature` with the two scenarios described in "New Files".
- Add `test/fixtures/jsonl/manifests/promotion-threshold-young-repo.json` and `test/fixtures/jsonl/manifests/promotion-threshold-mature-repo.json` mirroring the `edits[]` shape used by slice-#4 / slice-#5 manifests.
- If the mature manifest needs the `commits[]` seed mechanism (Step 11), the smoke scenario stays pending behind the ISSUE-3-CUTOVER stub even after that work; the manifest fields are documented for the next cutover.

### Step 11: Extend the manifest interpreter to support `commits[]` seeding (optional, additive)

- Edit `test/mocks/manifestInterpreter.ts`.
- Add a `commits?: Array<{ subject: string; date?: string }>` field on the manifest schema.
- During worktree setup, for each entry in `commits[]`, run `git commit --allow-empty -m <subject>` (optionally `--date=<date>`) inside the seeded worktree. This produces synthetic history that `loadPromotionStats` can read.
- This step is OPTIONAL — if it slips, the smoke scenario stays pending and the per-issue scenarios remain the authoritative acceptance documentation. The unit tests for `promotionStatsLoader` already cover the loader contract directly.
- Run `bunx vitest run test/mocks/__tests__/manifestInterpreter.test.ts` and confirm green.

### Step 12: Add the per-issue scenarios + pending step definitions

- Create `features/per-issue/feature-512.feature` with the ten functional scenarios (§1.a, §1.b, §2, §3, §4.a, §4.b, §5.a, §5.b, §6, §7) plus the standard TypeScript type-check guard scenario described in "New Files".
- Create `features/per-issue/step_definitions/feature-512.steps.ts` with pending stubs for the eleven new step phrases listed in "New Files" (git-history seeding for in-window and stale-window counts; scoring-N / scoring-at-bound / scoring-above-bound scenario seeding; no-state-file Given and Then assertions; dated-tag-presence and tag-absence assertions on the seeded scenario).
- Confirm `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-512" --dry-run` reports zero undefined steps (all stubs registered).

### Step 13: Verify by inspection acceptance criterion #6

- Grep `.claude/commands/scenario_writer.md` for `/override|threshold/i` — confirm only the existing universality block (line 38) matches and no override knob exists.
- Grep `adws/core/projectConfig.ts` for `threshold|override` — confirm no field in `ScenariosConfig` mentions threshold.
- Grep `.adw/scenarios.md` for `threshold|override|tunable` — confirm no section exists.
- This manual verification is the canonical proof-of-compliance for acceptance criterion #6. There is NO per-issue BDD scenario asserting against framework prompt or configuration content — the parent PRD's rot-prevention rule prohibits source-content assertions in scenarios. If a future PR attempts to add a threshold override, the violation surfaces in human PR review at this step, not via a brittle scenario.

### Step 14: Run the validation commands

- Run all commands in the "Validation Commands" section below.
- Confirm every command exits 0.
- If any unit test or type check fails, fix the failure before moving on (do NOT mask via `.skip`).

## Testing Strategy

### Unit Tests

Project config: `.adw/project.md` declares `## Unit Tests: enabled` (line 34), so unit tests are required.

#### `adws/promotion/__tests__/promotionThreshold.test.ts` (rewritten, eleven cases)

Each case is a single `it(...)` block. The matrix exhaustively covers the curve domain plus the monotonicity property:

| # | Stats input | Expected N | Why |
|---|---|---|---|
| i | `{ 0, 0 }` | 3 | bootstrap — denominator zero |
| ii | `{ 5, 0 }` | 3 | bootstrap precedence over nonsense numerator |
| iii | `{ 0, 100 }` | 3 | zero-ratio |
| iv | `{ 5, 100 }` | 3 | low-ratio (rounds to 3) |
| v | `{ 12, 100 }` | 4 | mid-low-ratio |
| vi | `{ 25, 100 }` | 5 | mid-ratio |
| vii | `{ 40, 100 }` | 6 | mid-high-ratio |
| viii | `{ 50, 100 }` | 7 | saturation at RATIO_CAP |
| ix | `{ 90, 100 }` | 7 | above-cap saturation |
| x | `{ 100, 100 }` | 7 | full-ratio saturation |
| xi | series property | non-decreasing | monotonicity verification |

#### `adws/promotion/__tests__/promotionStatsLoader.test.ts` (new, eight cases)

Each case uses `vi.fn()` for `runGit` and asserts on both return value and command string. Cases (a)–(h) listed in "New Files".

#### `adws/promotion/__tests__/promotionCommenter.test.ts` (extended, eleven cases total)

Existing nine cases pass through `makeDeps` with `loadStats: () => ({ 0, 0 })`. Two new cases (j) and (k) assert the threshold-from-loaded-stats behaviour and the once-per-invocation contract.

### Edge Cases

- **Empty repo / brand new clone** — both `runGit` calls return empty stdout; loader returns `{ 0, 0 }`; threshold falls through bootstrap to 3. Covered by `promotionStatsLoader.test.ts` (c) and `promotionThreshold.test.ts` (i).
- **`git` not on PATH / not a git directory** — `runGit` throws; loader logs warn and returns `{ 0, 0 }`. Covered by `promotionStatsLoader.test.ts` (d).
- **Non-promotion commits containing the substring `regression-promotion`** — git's `--grep` is regex-anchored by `^`, so substring matches in commit-body lines or in unrelated subjects do NOT increment the numerator. Covered by `promotionStatsLoader.test.ts` (e) via the command-string assertion.
- **Removed scenarios** — diff lines starting with `-` are NOT counted; only `+ Scenario:` (additions) increment the denominator. Covered by (f).
- **Multiple per-issue files in one diff** — the single `runGit` call returns concatenated unified diffs; the regex sums across all files. Covered by (g).
- **Floating-point edge: ratio exactly at RATIO_CAP** — `Math.min(0.5, 0.5) / 0.5 = 1.0`; `round(4 * 1.0) = 4`; result is exactly `MAX_THRESHOLD`. Covered by `promotionThreshold.test.ts` (viii).
- **Floating-point edge: ratio just below a rounding boundary** — `25/100 = 0.25; cappedRatio = 0.5; round(4 * 0.5) = 2; result = 5`. Covered by (vi). The next denominator-tick (`26/100`) crosses to 5 still, ensuring monotonicity is not violated by floating-point flutter.
- **Empty `loadStats` call from a test** — `makeDeps` injects bootstrap zeros; existing tests are unchanged.
- **Verify-by-inspection drift** — if a future PR adds a `threshold` field to `ScenariosConfig`, the manual Step 13 grep (run during planning of the next slice) flags the violation. There is no automated per-issue scenario for this — see Notes for the rot-prevention rationale.

## Acceptance Criteria

- `adws/promotion/promotionThreshold.ts` reads no external state file. The only inputs to `computeThreshold` are the values in the `PromotionStats` argument, which the caller sources from `loadPromotionStats`, which itself sources from `git log` (a structural git artefact, not a separate state file).
- For `PromotionStats { promotedCount90d: X, totalPerIssueCount90d: 0 }` with any `X`, `computeThreshold` returns `3` (BOOTSTRAP_THRESHOLD). Verified by `promotionThreshold.test.ts` (i) and (ii).
- For any two `PromotionStats` `s1`, `s2` with `s1.promotedCount90d / s1.totalPerIssueCount90d <= s2.promotedCount90d / s2.totalPerIssueCount90d` and both denominators > 0: `computeThreshold(s1) <= computeThreshold(s2)`. Verified by `promotionThreshold.test.ts` (xi).
- For any `PromotionStats`, `computeThreshold(...) <= MAX_THRESHOLD` (= 7). Verified by (viii), (ix), (x).
- `MAX_THRESHOLD`, `RATIO_CAP`, and `BOOTSTRAP_THRESHOLD` are all `export const` at the top of `promotionThreshold.ts`. Verified by reading the file and by `import` in `promotionThreshold.test.ts`.
- `promotionThreshold.test.ts` covers bootstrap (i, ii, iii), low-ratio (iv), mid-ratio (v, vi, vii), high-ratio (viii, ix, x), and monotonicity (xi). Eleven cases pass green.
- `.adw/scenarios.md` contains no section name matching `/override|threshold/i`. `scenario_writer.md` body contains no instruction to read or honour any per-repo threshold. `ScenariosConfig` interface (`adws/core/projectConfig.ts:36`) contains no field naming a threshold. Verified by Step 13 grep.
- `features/regression/smoke/promotion_threshold_auto_ramp.feature` exists, is tagged `@regression @smoke`, contains two scenarios (young / mature repo), and uses the two new manifest fixtures.
- All commands in "Validation Commands" exit 0.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — Ensure dependencies are up to date.
- `bun run lint` — Run ESLint over the codebase.
- `bunx tsc --noEmit` — Root-level TypeScript type check (catches issues in new test files).
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/`-scoped type check (catches issues in `promotionThreshold`, `promotionStatsLoader`, `promotionCommenter`, `adwPromotionSweep`).
- `bun run test:unit` — Full Vitest suite (covers the eleven `promotionThreshold` cases, the eight `promotionStatsLoader` cases, and the eleven `promotionCommenter` cases plus all unchanged tests). Confirm zero failures and zero skipped tests outside known-pending blocks.
- `bunx vitest run adws/promotion/__tests__/promotionThreshold.test.ts` — Targeted run for the threshold matrix.
- `bunx vitest run adws/promotion/__tests__/promotionStatsLoader.test.ts` — Targeted run for the stats loader.
- `bunx vitest run adws/promotion/__tests__/promotionCommenter.test.ts` — Targeted run for the commenter contract.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-512" --dry-run` — Verify zero undefined steps for the new per-issue scenarios (pending stubs are present for all step phrases).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run the full regression suite (asserts no existing scenario regresses; the new smoke scenario stays pending behind the ISSUE-3-CUTOVER stub).
- `bun run build` — Build sanity (no-op for this slice but kept for regression).
- Grep verification (one-off, manual): `grep -nEi 'threshold|override' .adw/scenarios.md .claude/commands/scenario_writer.md adws/core/projectConfig.ts | grep -v 'BOOTSTRAP_THRESHOLD\|MAX_THRESHOLD\|RATIO_CAP\|computeThreshold\|promotionThreshold\|universality\|framework-owned'` — expect zero matches (only the legitimate framework references remain after exclusion).

## Notes

- `.adw/coding_guidelines.md` is strictly followed: TypeScript strict mode, no `any` (the `runGit` dep is typed `(args: string, options: { cwd: string }) => string`), guard clauses (`if (stats.totalPerIssueCount90d === 0) return BOOTSTRAP_THRESHOLD;` opens `computeThreshold`), max nesting depth ~2, isolate side effects (the loader keeps all I/O behind injected deps), files under 300 lines (`promotionStatsLoader.ts` targets <100, `promotionThreshold.ts` stays at ~20).
- No new dependency installs are required. The package install command per `.adw/commands.md` would be `bun add <package>` if needed.
- The curve constants (`MAX_THRESHOLD = 7`, `RATIO_CAP = 0.5`) are the single design decision under HITL review. They are scoped at the top of `promotionThreshold.ts` with inline rationale so a future tuner can adjust them in a one-line PR. The PRD §"Bootstrap" explicitly notes: *"If field experience shows it is too low (too many false-positive suggestions) or too high (no vocabulary growth), tuning is a framework PR."* The same applies to the ramp constants.
- The denominator counts *scenario blocks added*, not *files added*. This matches the numerator's semantic (one move PR per scenario, per slice-#5 `promotionMover` design). If a future slice changes the mover to bundle multiple promoted scenarios into one PR, the numerator query would need to change to count `regression-promotion:` *scenarios* rather than commits — flagged here so the consistency stays explicit.
- The smoke scenario depends on the optional `commits[]` manifest seed mechanism (Step 11) to set up synthetic git history in the test worktree. If that step is descoped, the smoke scenario stays pending and the per-issue scenarios remain the authoritative acceptance documentation. The unit tests for `promotionStatsLoader` cover the loader contract directly without needing a real git repo.
- The per-issue scenarios in `feature-512.feature` deliberately do NOT include any assertion against the contents of `.claude/commands/scenario_writer.md`, `.adw/scenarios.md`, `adws/promotion/promotionThreshold.ts`, or any other framework source file. Acceptance criterion #6 ("no `.adw/scenarios.md` knob for overriding N") is verified by manual grep at Step 13, consistent with the parent PRD's rot-prevention rule which prohibits source-content assertions in scenarios. Earlier drafts of this plan considered a "verify by inspection" BDD scenario; that approach was rejected during plan-scenario alignment because reading framework prompt or config files from inside a scenario is the rot pattern the parent PRD was designed to stop. The scenarios file (`features/per-issue/feature-512.feature`) records this rationale in its preamble for future maintainers.
- This slice does NOT change `promotionMover` or `promotionScorer`. Their existing contracts (commit-message prefix, branch naming, score weights) are load-bearing inputs to this slice's queries and curve.
- The `loadStats` dep is intentionally NOT optional (no `?` modifier) on `PromotionCommenterDeps`. Any future orchestrator that consumes `runPromotionCommenter` must consciously decide what stats to inject. If a test or alternative orchestrator wants the bootstrap behaviour, it injects `() => ({ promotedCount90d: 0, totalPerIssueCount90d: 0 })` explicitly — matching the slice-#4 pre-existing behaviour without making it a silent default.
