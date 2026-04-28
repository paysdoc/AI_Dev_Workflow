# Chore: BDD rewrite (3/3) — cutover, polymorphic prompts, 14-day per-issue sweep cron

## Metadata
issueNumber: `493`
adwId: `oobdbg-bdd-rewrite-3-3-cuto`
issueJson: `{"number":493,"title":"BDD rewrite (3/3): cutover — cucumber scope + polymorphic prompts + 14-day sweep cron","state":"OPEN","author":"paysdoc","labels":["hitl"]}` (full body in conversation)

## Chore Description

Final cutover for the BDD rewrite (PRD: `specs/prd/bdd-rewrite-tiered-regression.md`, migration issue 3 of 3). Three things happen together:

1. **Delete the legacy BDD layer.** Remove every top-level `features/*.feature` (~121 files) and obsolete `features/step_definitions/*.ts` (~117 files). Only `features/regression/` and the new (empty-but-created) `features/per-issue/` remain. `features/support/register-tsx.mjs` is preserved.
2. **Scope the runner.** `cucumber.js` `paths` becomes `features/regression/**/*.feature` so per-issue agent-input scenarios are never executed by the test runner. `import` glob is also tightened to `features/regression/**/*` so the deleted top-level step definitions are not loaded.
3. **Make agent prompts polymorphic and add the per-issue sweep cron.** `.adw/scenarios.md` gets three new optional sections (`## Per-Issue Scenario Directory`, `## Regression Scenario Directory`, `## Vocabulary Registry`). `adws/core/projectConfig.ts` parses them as optional fields (absent ⇒ `undefined`). `.claude/commands/scenario_writer.md` and `.claude/commands/generate_step_definitions.md` branch on those sections so the ADW host gets the new constrained behaviour and existing target repos initialised today are unaffected on the next `adw_init` run. A new cron probe under `adws/triggers/` (with a pure `isScenarioStale` predicate covered by a vitest unit test) deletes `features/per-issue/feature-{N}.feature` files 14 days after the corresponding issue's PR was merged.

Backward-compatibility contract: with all three new sections absent from a target repo's `.adw/scenarios.md`, both prompts behave exactly as today. No production code under `adws/phases/`, `adws/agents/`, `adws/github/`, etc. is modified — only `adws/core/projectConfig.ts` (config loader) and `adws/triggers/` (new probe + thin wiring) are touched.

## Relevant Files

Use these files to resolve the chore:

- `README.md` — Documents the new `.adw/scenarios.md` schema and the backward-compatibility contract; the existing "BDD scenarios" section already references `features/regression/` so the cutover edits are minimal but must reflect that top-level features are gone and per-issue scenarios live under `features/per-issue/`.
- `.adw/scenarios.md` — Add the three new sections (`## Per-Issue Scenario Directory` → `features/per-issue/`, `## Regression Scenario Directory` → `features/regression/`, `## Vocabulary Registry` → `features/regression/vocabulary.md`). Existing `## Scenario Directory`, `## Run Scenarios by Tag`, `## Run Regression Scenarios` stay.
- `.adw/coding_guidelines.md` — Strict mode TS, max nesting depth 2, declarative-over-imperative, isolate side effects, files under 300 lines.
- `cucumber.js` — Scope `paths` to `features/regression/**/*.feature` and the import glob to `features/regression/**/*.ts` (drop the top-level `features/step_definitions/**` import).
- `features/*.feature` (~121 files at the top level) — All deleted.
- `features/step_definitions/*.ts` (~117 files at the top level) — All deleted (none are referenced from `features/regression/step_definitions/`; verify with a grep before deleting).
- `features/support/register-tsx.mjs` — Preserved (still loaded via the `cucumber.js` `import` array if needed by either suite). Verify whether `features/regression/support/hooks.ts` already covers register/setup; if so, prune `features/support/` too.
- `features/regression/**` — Untouched (already migrated in PR2 / issue #492). Read-only for this chore.
- `adws/core/projectConfig.ts` — Extend `ScenariosConfig` with three new optional string fields (`perIssueScenarioDirectory?`, `regressionScenarioDirectory?`, `vocabularyRegistry?`). Update `SCENARIOS_HEADING_TO_KEY`, `parseScenariosMd`, defaults, and types. Preserve current behaviour when sections absent (fields are `undefined`).
- `adws/core/__tests__/projectConfig.test.ts` — Add cases for all-present, all-absent, and partial-presence permutations; assert existing fields unchanged when new ones are present.
- `.claude/commands/scenario_writer.md` — Make polymorphic: read `.adw/scenarios.md`, prefer `## Per-Issue Scenario Directory` over `## Scenario Directory` for per-issue output, drop the `@regression` maintenance sweep step when `## Regression Scenario Directory` is set. With both absent, behaviour is identical to today.
- `.claude/commands/generate_step_definitions.md` — Make polymorphic on `## Vocabulary Registry`: when set, compose only from registered phrases and fail loudly on any unknown phrase; when absent, current free-form behaviour is preserved.
- `adws/triggers/cronStageResolver.ts` (prior art) — Pattern for extracting a pure-query module callable both from cron and from tests.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts` (prior art) — Vitest pattern for trigger modules with mocked fs/child_process/github.
- `adws/triggers/__tests__/cronStageResolver.test.ts`, `cronRepoResolver.test.ts` (prior art) — Vitest patterns for pure-function predicates extracted from a cron driver.
- `adws/triggers/trigger_cron.ts` — Wire the new sweep into the existing cycle gate (every Nth cycle, like `JANITOR_INTERVAL_CYCLES` / `HUNG_DETECTOR_INTERVAL_CYCLES`). The sweep is the only production-code touch outside the new files; keep it minimal.
- `adws/core/index.ts` (or wherever `JANITOR_INTERVAL_CYCLES` is defined) — Add a new cycle constant (e.g. `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES`).
- `adws/github/**` — Read-only; the sweep probe queries `merged_at` for an issue's PR via the existing GitHub helpers.

### New Files

- `features/per-issue/.gitkeep` — Empty placeholder so the per-issue directory exists in-tree even when no per-issue scenarios are present (the scenario-writer agent and the sweep probe both rely on the directory existing).
- `adws/triggers/perIssueScenarioSweep.ts` — The cron probe. Exports two things:
  - `isScenarioStale(filePath: string, mergedAt: Date | null, retentionDays: number, now: Date): boolean` — pure predicate. `mergedAt === null` ⇒ not stale (issue still open / unmerged). `now - mergedAt >= retentionDays * 86_400_000` ⇒ stale. Independent of fs and gh.
  - `runPerIssueScenarioSweep(deps?: { now?: Date; listFeatures?: () => string[]; getMergedAt?: (issueNum: number) => Promise<Date | null>; deleteFile?: (path: string) => void; log?: typeof console.log })` — thin orchestration shim. Lists `features/per-issue/feature-{N}.feature` files, parses N from the filename, calls `getMergedAt(N)`, applies `isScenarioStale` with `RETENTION_DAYS = 14`, deletes stale files. Returns the list of deleted paths.
- `adws/triggers/__tests__/perIssueScenarioSweep.test.ts` — Vitest unit test covering the `(filePath, mergedAt, retentionDays, now)` truth table (just-merged → not stale; merged exactly 14d ago → stale; merged 13d ago → not stale; `mergedAt = null` → not stale; future `mergedAt` (clock skew) → not stale) plus an integration-flavoured test for `runPerIssueScenarioSweep` with mocked deps that verifies the right files are deleted and unmerged/recent ones are skipped.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Verify per-issue dependencies

- Confirm `features/per-issue/` is empty / non-existent (it is, per current tree); plan to create it with a `.gitkeep` so `features/per-issue/feature-{N}.feature` listings have a stable parent directory.
- Grep `features/regression/step_definitions/**` and `features/regression/support/**` for any imports from the legacy `features/step_definitions/**` or top-level `features/support/**`. Expected: none. If any import is found, document the dependency and either copy/rename the symbol into `features/regression/` or keep just that one legacy file (justify in PR description).
- Grep the entire repo for references to `features/<name>.feature` paths (including in `.github/workflows/`, `Dockerfile`, `docker-run.sh`, scripts) to surface any path that would break after deletion. Update or note them.

### 2. Extend `adws/core/projectConfig.ts` with optional sections

- Add three optional string fields to `ScenariosConfig`:
  ```ts
  perIssueScenarioDirectory?: string;
  regressionScenarioDirectory?: string;
  vocabularyRegistry?: string;
  ```
- Add their lowercased headings to `SCENARIOS_HEADING_TO_KEY`:
  ```ts
  'per-issue scenario directory': 'perIssueScenarioDirectory',
  'regression scenario directory': 'regressionScenarioDirectory',
  'vocabulary registry': 'vocabularyRegistry',
  ```
- Do **not** add defaults to `getDefaultScenariosConfig()`. Absent sections must remain `undefined` so that target repos initialised today behave exactly as before.
- Re-run `parseScenariosMd` mentally to confirm the existing "missing sections fall back to defaults" path still yields `undefined` for the three new fields (the loop only assigns when the heading exists).
- Keep the file under the 300-line guideline; do not touch unrelated config types.

### 3. Cover the new fields in the projectConfig vitest

- Extend `adws/core/__tests__/projectConfig.test.ts` with a new `describe('parseScenariosMd — per-issue / regression / vocabulary fields', ...)` block:
  - All three sections absent → all three fields `undefined`; existing `scenarioDirectory`, `runByTag`, `runRegression` defaults preserved.
  - All three sections present → all three fields populated with the trimmed body string.
  - Partial presence (e.g. only `## Vocabulary Registry`) → that one field populated, the other two `undefined`.
  - Whitespace trimming behaves like other sections (lean on the existing `parseMarkdownSections` invariants — one positive case is enough).
- Add a `loadProjectConfig` integration case using `mkdtempSync` that writes a `.adw/scenarios.md` containing all three new sections and asserts the parsed config exposes them.

### 4. Add the staleness predicate and sweep probe

- Create `adws/triggers/perIssueScenarioSweep.ts`. Export `RETENTION_DAYS = 14` and:
  - `export function isScenarioStale(filePath: string, mergedAt: Date | null, retentionDays: number, now: Date): boolean` — pure. Implementation:
    - if `mergedAt === null`, return `false`;
    - compute `ageMs = now.getTime() - mergedAt.getTime()`;
    - return `ageMs >= retentionDays * 86_400_000`.
    - `filePath` is part of the signature (per the issue spec) but is not consulted by the predicate; it is there so callers can log it without juggling tuples. Add a one-line comment noting why it's in the signature.
  - `export interface PerIssueSweepDeps { now?: Date; listFeatures?: () => string[]; getMergedAt?: (issueNum: number) => Promise<Date | null>; deleteFile?: (path: string) => void; log?: (msg: string, level?: string) => void; }`
  - `export async function runPerIssueScenarioSweep(deps?: PerIssueSweepDeps): Promise<string[]>` — thin shim:
    - Default `listFeatures` to a `readdirSync`-based listing of `features/per-issue/feature-*.feature`, returning relative paths.
    - Default `getMergedAt` to a wrapper around the existing GitHub helper that fetches an issue's linked PR and returns its `merged_at` (`null` when unmerged or no PR).
    - For each file, parse the issue number from the filename; if parsing fails, skip with a warn-level log (no throw).
    - Compute staleness via `isScenarioStale`; if stale, call `deleteFile` and accumulate the path in the result array.
    - Wrap `getMergedAt` calls in `try/catch`; treat errors as non-stale and continue (no scenario deletion on transient GitHub failure).
- Use `import.ts` style and keep the file under 300 lines. Apply guard clauses; max nesting depth 2.

### 5. Unit-test the predicate and probe

- Create `adws/triggers/__tests__/perIssueScenarioSweep.test.ts`. Mirror the `pauseQueueScanner.test.ts` mocking style (hoisted `vi.mock` for `fs`, `../../github`, `../../core`).
- Predicate truth table (one `describe` block):
  - `mergedAt = null` → `false` (issue not yet merged or unmergeable).
  - `now - mergedAt = 13d` → `false`.
  - `now - mergedAt = 14d` → `true`.
  - `now - mergedAt = 30d` → `true`.
  - `now - mergedAt = -1h` (clock skew, future merge) → `false`.
- Sweep integration block (separate `describe`):
  - Three feature files exist: one merged 20d ago (stale), one merged 5d ago (fresh), one without a merged PR (`mergedAt = null`).
  - Assert only the stale file is deleted; the other two are left alone.
  - Assert the function returns the deleted-paths list.
  - Assert a `getMergedAt` rejection for one issue does not delete that file and does not abort processing of the other two.

### 6. Wire the probe into `trigger_cron.ts` minimally

- Import `runPerIssueScenarioSweep` from `./perIssueScenarioSweep`.
- Add a new cycle constant in `adws/core/` (alongside `JANITOR_INTERVAL_CYCLES`, e.g. `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES`) — pick a value that runs once-per-day-ish given the 20s `POLL_INTERVAL_MS` (e.g. `4320`). Document the choice with a one-line comment.
- In `checkAndTrigger`, add a guarded invocation matching the pattern of the existing janitor / hung-detector sweeps:
  ```ts
  if (cycleCount % PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES === 0) {
    await runPerIssueScenarioSweep();
  }
  ```
- This is the **only** edit allowed in `trigger_cron.ts`. Do not refactor the surrounding code. The acceptance criterion "no production code in `adws/triggers/` (excluding the new probe) is modified" treats this as part of "the new probe" wiring.

### 7. Make `scenario_writer.md` polymorphic

- Insert a short "Polymorphism on `.adw/scenarios.md`" section near the top of the prompt. Specify the resolution rules:
  - Per-issue output directory: prefer `## Per-Issue Scenario Directory`; fall back to `## Scenario Directory`; final fallback `features/`.
  - `@regression` maintenance sweep (current Step 6): execute only if `## Regression Scenario Directory` is **absent**. When present, skip the sweep entirely (no auto-promotion ever).
- Edit Step 1 ("Read configuration") to load all three optional sections and pass the resolved per-issue directory to Step 5.
- Replace Step 5's "Create new scenario files or add new scenarios to existing files" wording so the per-issue case writes specifically to `<perIssueDir>/feature-{issueNumber}.feature`. Keep the legacy free-form behaviour intact when `## Per-Issue Scenario Directory` is absent.
- Replace Step 6 with: "If `## Regression Scenario Directory` is set in `.adw/scenarios.md`, skip this step (regression promotion is a deliberate human decision). Otherwise, perform the existing `@regression` maintenance sweep as documented below." — keep the existing sweep description verbatim.
- Update the "Output" template's `### @regression maintenance` section to allow the literal value `skipped (regression directory configured)` so the polymorphic branch produces a clean output.
- Acceptance: with both `## Per-Issue Scenario Directory` and `## Regression Scenario Directory` absent, the prompt's effective behaviour is byte-for-byte equivalent to the current behaviour.

### 8. Make `generate_step_definitions.md` polymorphic

- Add a "Polymorphism on `.adw/scenarios.md`" section: if `## Vocabulary Registry` is set, the agent must compose only from phrases listed there and **fail loudly** (return an explicit error in the JSON output) when a scenario uses any unregistered phrase. If absent, current free-form generation is preserved.
- Edit Step 1 to read `## Vocabulary Registry` along with the existing `## Scenario Directory`. When set, load the registry file and parse its phrase table.
- Insert a new step (between current Steps 4 and 5) titled "Validate against vocabulary registry (when configured)": for each scenario step that does not match a registered phrase, record a `vocabularyViolations` entry. If any violations exist, do not generate step defs and emit:
  ```
  {
    "generatedFiles": [],
    "removedScenarios": [],
    "vocabularyViolations": [{ "scenario": "...", "phrase": "..." }]
  }
  ```
- Add `vocabularyViolations` to the output schema as an optional field that defaults to `[]`. Document that PR review (the `pr_review` skill / human reviewer) is responsible for catching non-empty `vocabularyViolations`.
- Confirm: with `## Vocabulary Registry` absent, the prompt's behaviour is unchanged from today (no validation step, free-form composition, optional field is `[]`).

### 9. Update the ADW host's `.adw/scenarios.md`

- Append the three new sections (in this order, after the existing three):
  ```md
  ## Per-Issue Scenario Directory
  features/per-issue/

  ## Regression Scenario Directory
  features/regression/

  ## Vocabulary Registry
  features/regression/vocabulary.md
  ```
- Leave the existing `## Scenario Directory`, `## Run Scenarios by Tag`, `## Run Regression Scenarios` entries unchanged.
- Add a one-paragraph header note explaining backward compatibility: "The three optional sections below activate the regression-suite contract. Target repos that omit them keep current free-form behaviour."

### 10. Scope `cucumber.js`

- Edit `cucumber.js`:
  ```js
  export default {
    paths: ['features/regression/**/*.feature'],
    import: ['features/support/register-tsx.mjs', 'features/regression/step_definitions/**/*.ts', 'features/regression/support/**/*.ts'],
    format: ['progress'],
  };
  ```
- If `features/support/register-tsx.mjs` is the only file under `features/support/` and is referenced solely by `cucumber.js`, leave it where it is (top-level support is not a behavioural feature directory). If `features/regression/support/hooks.ts` already triggers the tsx registration through its own loader chain, consider relocating `register-tsx.mjs` into `features/regression/support/`. Choose the simpler option and justify in the PR.

### 11. Delete the legacy BDD layer

Order matters here: delete features first, then step defs, so the cucumber config never sees half-removed pairs.

- Delete every `features/*.feature` at the top level (~121 files). Use `git rm features/*.feature` (no recursion).
- Delete `features/step_definitions/*.ts` (~117 files). Skip any file confirmed in Step 1 to be referenced from `features/regression/step_definitions/` (expected: zero such files).
- Run `git status` and confirm the staged deletions match the expected count. No files under `features/regression/`, `features/per-issue/`, or `features/support/register-tsx.mjs` should appear.
- Create `features/per-issue/.gitkeep` (empty file) so the directory exists.

### 12. Update `README.md`

- Section "BDD scenarios" / lines around 186–230 in the existing tree:
  - State that top-level `features/*.feature` is gone after the cutover.
  - Document `features/per-issue/feature-{N}.feature` as the per-issue output location and the 14-day retention contract.
  - Document the three new `.adw/scenarios.md` sections and the backward-compatibility contract: "absent = current behaviour".
  - Mention the new sweep cron in the "Single-host coordination" / "trigger_cron" prose, alongside the existing janitor and hung-detector sweeps.
- Keep the existing `Run @regression scenarios` and Docker examples (they continue to work because `cucumber.js` is now scoped to `features/regression/`).

### 13. Update `.adw/scenarios.md` documentation header

- Within the same `.adw/scenarios.md` file edited in Step 9, ensure the header paragraph plus inline comments above each new section are clear about: (a) optionality, (b) absence ⇒ current behaviour, (c) which prompt is parameterised by which section.

### 14. Run validation

- Run every command listed in **Validation Commands** below. Resolve any failure before declaring the chore complete.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions. (Project-specific commands sourced from `.adw/commands.md`.)

- `bun install` — Ensure dependencies are present.
- `bun run lint` — Linter passes.
- `bunx tsc --noEmit` — Project type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes (covers `adws/core/projectConfig.ts` and the new `adws/triggers/perIssueScenarioSweep.ts`).
- `bun run test:unit` — Vitest passes, including the extended `adws/core/__tests__/projectConfig.test.ts` and the new `adws/triggers/__tests__/perIssueScenarioSweep.test.ts`.
- `bun run build` — Build succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — The regression suite runs against `features/regression/**` only and passes (proves the `cucumber.js` `paths` scoping took effect and the deleted top-level features are no longer required).
- `find features -maxdepth 1 -name '*.feature' | wc -l` — Returns `0` (no top-level feature files left). *(Deviation from "no curl/grep validation" rule is acceptable here because this is a tree-shape sanity check on the output of the deletion step, not behaviour validation.)*
- `git status` — Working tree is clean apart from the intended deletions and additions; no stray top-level `features/step_definitions/*.ts` left behind.

## Notes

- **Coding guidelines compliance.** Strict TypeScript, no `any`, guard clauses, max nesting depth ~2, files under 300 lines, declarative-over-imperative, isolate side effects to module boundaries (predicate is pure; sweep shim is the side-effect surface). Apply these to `adws/triggers/perIssueScenarioSweep.ts` and to the additions in `adws/core/projectConfig.ts`.
- **Production code untouched.** Only `adws/core/projectConfig.ts` (config-loader extension) and `adws/triggers/trigger_cron.ts` (one cycle-gated call into the new probe) are modified outside `adws/triggers/perIssueScenarioSweep.ts`. No edits to `adws/phases/`, `adws/agents/`, `adws/github/`, `adws/vcs/`, `adws/providers/`. If a needed change pulls the diff into those directories, stop and re-plan.
- **Operator follow-ups (out of scope).** Toggling `features/regression/` as a required GitHub branch protection check is a manual UI step the operator does after merge. PR-revert mechanics for missed deadlines are also operator-side.
- **Why backward compatibility matters.** Target repos initialised today have a minimal three-section `.adw/scenarios.md`. The next `adw_init` run on those repos must not break their scenario-writer / step-def-generator workflows. The optional-sections approach guarantees that with all three new fields `undefined`, the prompts execute the legacy code path unchanged.
- **Sweep cycle constant.** `JANITOR_INTERVAL_CYCLES` and `HUNG_DETECTOR_INTERVAL_CYCLES` define the existing cycle cadence; `POLL_INTERVAL_MS` is 20 s. Pick `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` so the sweep runs roughly once a day (≈4,320 cycles). The exact value is a judgement call — document the rationale next to the constant.
- **Predicate purity.** `isScenarioStale` accepts an explicit `now: Date` so the unit test is deterministic; do not call `Date.now()` inside the predicate. The sweep shim is the only place `Date.now()` may be invoked, and the dep-injection signature lets the integration test override it.
- **Reading the rot-detection rubric.** The issue body's rubric is a constraint on `features/regression/step_definitions/**`, not on this chore's deliverables (we are not authoring scenarios). It is included so the planner and reviewer can validate that the polymorphic prompts will not generate rot-y step defs in repos that opt in to the vocabulary registry.
