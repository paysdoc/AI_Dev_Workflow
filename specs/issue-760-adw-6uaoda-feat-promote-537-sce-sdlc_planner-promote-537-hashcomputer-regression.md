# Feature: Promote #537 hashComputer scenario into the @regression suite

## Metadata
issueNumber: `760`
adwId: `6uaoda-feat-promote-537-sce`
issueJson: `{"number":760,"title":"feat: promote #537 scenario into the @regression suite","body":"Promotes: feature-537\n\nDirect relocation (matches #734 (score: 4)): move this scenario from the per-issue directory (input-only, never executed) into the executed `@regression` suite.\n\n## What to do\n- git mv features/per-issue/feature-537.feature -> features/regression/<subdir>/feature-537.feature (choose a short subdirectory name reflecting the scenario's subject).\n- git mv features/per-issue/step_definitions/feature-537.steps.ts -> features/regression/step_definitions/feature-537.steps.ts\n- Add a feature-level `@regression` tag to the moved feature file (keep its existing tags for traceability).\n- Register the scenario's phrases in features/regression/vocabulary.md under the appropriate Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact, never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Acceptance\n- --tags \"@regression\" executes the moved scenario(s) and they prove @regression green.\n- The old per-issue paths (features/per-issue/feature-537.feature and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-07-12T06:27:40Z"}`

## Feature Description
Relocate the existing BDD scenario for issue #537 — the behavioural contract for the pure
`computeFrameworkHash` deep module (`adws/core/hashComputer.ts`) — out of the **input-only**
`features/per-issue/` directory and into the **executed** `@regression` suite. Today `feature-537`
carries only `@adw-537` / `@adw-zapagn-hashcomputer-deep-mo` tags, so the CI/review regression gate
(`--tags "@regression"`) never selects it, and the per-issue retention sweep
(`adws/triggers/perIssueScenarioSweep.ts`) deletes per-issue feature files 14 days after their
issue's PR merges. The scenario is high-quality and rot-compliant (every step asserts a runtime
artefact — the returned SHA256 digest or a raised error — never a source-file property), and was
flagged for promotion (score 4, matching the #734 precedent).

This is a **direct relocation**, the only promotion mechanism that actually works in this repo. The
automated mover flow under `adws/promotion/` is dead code and is intentionally not used here; a human
(HITL) carries out the move exactly as this plan describes. The change is a `git mv` of the feature +
step-def into the regression tree, a feature-level `@regression` tag, registration of the scenario's
novel Gherkin phrases in the regression vocabulary registry, and a green `@regression` proof. **No
source-code (`adws/**`) changes are made and no step-def imports are rewritten.**

## User Story
As an **ADW framework maintainer**
I want **the #537 `hashComputer` content-hash contract to run on every `@regression` sweep**
So that **a regression in the framework content-hash module (the digest the whole init/upgrade
redesign keys on) is caught automatically, and the scenario is no longer at risk of silent deletion
by the 14-day per-issue retention sweep.**

## Problem Statement
`feature-537.feature` lives in `features/per-issue/`. Cucumber loads that directory (it is in
`cucumber.js` `paths`), but the regression gate runs `--tags "@regression"` and the scenario has no
`@regression` tag, so it is **never executed** by the safety net. Worse, per-issue scenarios are
purged 14 days after the issue's PR merges. The result: a behavioural contract that was carefully
authored to be deterministic, order-independent, byte-sensitive, and error-clear sits as dead
documentation and will eventually be deleted, leaving the `computeFrameworkHash` module with no
executable acceptance coverage in the regression suite.

## Solution Statement
Perform the established, working promotion — **direct relocation**:

1. `git mv` the feature file into a new regression subdirectory
   (`features/regression/hashing/feature-537.feature`) and the step-def file into the flat regression
   step-definitions directory (`features/regression/step_definitions/feature-537.steps.ts`), mirroring
   the #729 precedent (`features/regression/upgrade/…` + flat `step_definitions/…`).
2. Add a feature-level `@regression` tag (keeping `@adw-537` and `@adw-zapagn-hashcomputer-deep-mo`
   for traceability and because the step-def's `Before`/`After` cleanup hooks are keyed on `@adw-537`).
3. Register the scenario's 16 novel Given/When/Then phrase-patterns in
   `features/regression/vocabulary.md` with rubric-compliant descriptions (assertion target = the
   returned digest or the raised error — a runtime artefact — never a source-file property). The two
   shared phrases the scenario reuses (`the ADW codebase is checked out` = G18, `the ADW TypeScript
   type-check passes` = T22) are **already registered**; no new rows for them.
4. Prove the full `@regression` suite green, with the 8 `feature-537` scenarios executing and no
   ambiguous-step error, then verify the old per-issue paths no longer exist.

**Why this is safe (verified during planning):**
- `cucumber.js` loads *all* step-def globs regardless of tag (regression, shared
  `features/step_definitions/**`, and per-issue). So the two shared steps remain resolvable after the
  move, and because `feature-537.steps.ts` is *already* loaded today (from the per-issue glob),
  relocating it to the regression glob keeps it loaded **exactly once** — introducing **zero new
  ambiguity**.
- `features/per-issue/step_definitions/` and `features/regression/step_definitions/` are both **3
  directories deep**, so the step-def's `import … from '../../../adws/core/hashComputer.ts'` resolves
  to the same repo-root module before and after. Imports are left untouched, per the issue.
- The `@regression` `Before` hook (`features/regression/support/hooks.ts`) spins up mock
  infrastructure for every `@regression` scenario. `feature-537`'s steps are World-agnostic
  (module-scope `ctx`, no `this.mockContext`), exactly like the merged-green `feature-729` — so the
  hook runs harmlessly and the scenario passes. This is why an actual green run is a required step,
  not an assumption.

## Relevant Files
Use these files to implement the feature:

- `features/per-issue/feature-537.feature` — **source** feature file to `git mv` into the regression
  tree; feature-level tag line (`@adw-537 @adw-zapagn-hashcomputer-deep-mo`) gains `@regression`.
- `features/per-issue/step_definitions/feature-537.steps.ts` — **source** step-def file to `git mv`
  into `features/regression/step_definitions/`; content and imports unchanged. Its `Before`/`After`
  hooks are keyed on `@adw-537` (retained), and it imports `../../../adws/core/hashComputer.ts`
  (depth-invariant across the move).
- `features/regression/vocabulary.md` — the canonical phrase registry with the Rot-Detection Rubric;
  add a new domain subsection registering the 16 novel hashComputer phrase-patterns (Given/When/Then),
  following the existing `## Given/When/Then — Python Fixture E2E (@python-e2e)` subsection pattern.
- `cucumber.js` — **read-only reference**; confirms all step-def globs load regardless of tag and that
  `features/regression/**/*.feature` is in `paths`. No change needed.
- `features/regression/upgrade/feature-729.feature` + `features/regression/step_definitions/feature-729.steps.ts`
  — **read-only reference**; the #729 direct-relocation precedent (feature-level `@regression` tag,
  regression subdir, flat step-def, World-agnostic module-scope steps). Mirror its shape.
- `features/regression/support/hooks.ts` — **read-only reference**; the `@regression` `Before`/`After`
  mock-infra lifecycle hooks that will now wrap `feature-537`'s scenarios (compatible, per #729).
- `adws/core/hashComputer.ts` — **read-only reference**; the system under test the step-defs import.
  Not modified.
- `.adw/commands.md` / `.adw/project.md` — **read-only reference**; validation commands, unit-tests
  flag, and the `## Run Regression Scenarios` command.
- `README.md` — **caution, do not sweep**: the working tree already carries **unrelated, uncommitted**
  README drift (promotion-sweep cron-dispatch docs, `perIssueSweepPersist.ts`, and `multilang/` /
  `upgrade/` tree entries) that is not on `origin/dev` and does not belong to #760. Keep the commit
  scoped (see Notes / hygiene task).

### Relevant Documentation (matched via `.adw/conditional_docs.md`)
- `app_docs/feature-mzgyjj-rot-prevention-block.md` — the Rot-Prevention rule governing
  `features/regression/vocabulary.md`; the new phrase descriptions must assert observable artefacts,
  never source-file properties.
- `app_docs/feature-mnmihl-scenario-authoring-skip-gate.md` — explains why a `regression-promotion`-
  labelled issue must **not** author a new `features/per-issue/feature-760.feature` and must not redden
  on the alignment/validation/fidelity gates (`shouldSkipScenarioAuthoring` /
  `ADW_REGRESSION_PROMOTION_LABEL`). This plan is a pure relocation; no per-issue scenario is written
  for #760.
- `app_docs/feature-2evbnk-bdd-smoke-surface-scenarios.md` — the `@regression` Cucumber lifecycle
  hooks in `features/regression/support/hooks.ts` that will now wrap the moved scenarios.

### New Files / New Paths
No new *source* files. The move creates one new path and one new directory:
- `features/regression/hashing/` — **new subdirectory** (subject: framework content hashing) holding
  `feature-537.feature`.
- `features/regression/step_definitions/feature-537.steps.ts` — new path for the relocated step-def
  (flat in the existing regression `step_definitions/` dir; not nested, to preserve import depth).

## Implementation Plan
### Phase 1: Foundation — relocate the files with history preserved
Use `git mv` (not copy+delete) so blame/history follows the files, create the new `hashing/`
subdirectory, and confirm the source per-issue paths are gone. Do not touch the step-def contents or
imports.

### Phase 2: Core Implementation — tag + vocabulary registration
Add the feature-level `@regression` tag to the moved feature file (retaining existing tags). Register
the 16 novel Given/When/Then phrase-patterns in `features/regression/vocabulary.md` under a new domain
subsection, each row asserting a runtime artefact (returned digest / raised error), reusing the
already-registered G18 and T22 for the two shared phrases.

### Phase 3: Integration — prove green and keep the commit scoped
Run the full `@regression` suite (and a focused `@adw-537` run) to prove all 8 scenarios execute green
with no ambiguous-step error, run the standard validation gates (lint, type-checks, unit tests, build),
confirm the old per-issue paths are gone and no references dangle, and ensure the commit contains only
this feature's paths (excluding the pre-existing unrelated README drift).

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1: Create the regression subdirectory and relocate the feature file
- Create the destination directory: `mkdir -p features/regression/hashing`.
- Relocate the feature file with history preserved:
  `git mv features/per-issue/feature-537.feature features/regression/hashing/feature-537.feature`.

### Task 2: Relocate the step-definition file (flat, imports untouched)
- Relocate the step-def file:
  `git mv features/per-issue/step_definitions/feature-537.steps.ts features/regression/step_definitions/feature-537.steps.ts`.
- Do **not** edit the file's `import { computeFrameworkHash } from '../../../adws/core/hashComputer.ts'`
  line or any other relative import — both source and destination are 3 directories deep, so the path
  resolves identically. Leave the `Before({ tags: '@adw-537' })` / `After({ tags: '@adw-537' })` hooks
  as-is.

### Task 3: Add the feature-level `@regression` tag
- In `features/regression/hashing/feature-537.feature`, change the first line from
  `@adw-537 @adw-zapagn-hashcomputer-deep-mo`
  to
  `@regression @adw-537 @adw-zapagn-hashcomputer-deep-mo`.
- Keep all existing per-scenario `@adw-537 @adw-zapagn-hashcomputer-deep-mo` tags unchanged (needed for
  traceability and for the `@adw-537` cleanup hooks).

### Task 4: Register the novel phrases in the regression vocabulary
- Append a new domain subsection at the end of `features/regression/vocabulary.md` (after the
  `## Given/When/Then — Python Fixture E2E (@python-e2e)` subsection), mirroring that subsection's
  format. Header:
  `## Given/When/Then — Framework Content Hash (@adw-537)`
- Add an intro sentence stating: these phrases drive the pure `computeFrameworkHash` module
  (`adws/core/hashComputer.ts`) via an **in-process import (phase-import pattern)**; the fixture
  `adw_init` spec and fixture input files each scenario writes are **inputs to the system under test**,
  not framework source files; every assertion targets a **runtime artefact** — the returned SHA256
  digest or the raised error — never the text of a source file, satisfying the Rot-Detection Rubric.
- Register these **Given** rows (parameterised forms):
  - `a fixture framework whose adw_init spec declares hash inputs:` — writes a throwaway fixture
    framework whose `adw_init.md` `hashInputs:` frontmatter lists the given paths. Target: fixture
    input (SUT input, not source).
  - `a fixture framework whose adw_init spec omits the hash inputs frontmatter` — writes a fixture
    framework whose `adw_init.md` has no `hashInputs:` frontmatter. Target: fixture input.
  - `the fixture input file {string} contains {string}` — writes a fixture input file (SUT input) at
    the given path with the given content. Target: fixture input.
  - `a second fixture framework whose adw_init spec declares hash inputs:` — writes a second throwaway
    fixture framework (for the same-filenames-different-content case). Target: fixture input.
  - `the fixture input file {string} in the second fixture framework contains {string}` — writes a
    fixture input file into the second fixture framework. Target: fixture input.
- Register these **When** rows:
  - `the framework content hash is computed for the fixture framework` — calls
    `computeFrameworkHash(fixtureRoot)`, records the returned digest. Target: returned digest (artefact).
  - `the framework content hash computation is attempted for the fixture framework` — calls
    `computeFrameworkHash` inside try/catch, recording either the digest or the thrown error. Target:
    returned digest / raised error (artefact).
  - `the hash inputs in the fixture adw_init spec are reordered to:` — rewrites the fixture
    `adw_init.md` `hashInputs:` list in the given order (order-independence probe). Target: fixture input.
  - `the fixture input file {string} is modified by a single byte` — flips one byte of the named
    fixture input file (byte-sensitivity probe). Target: fixture input.
  - `the framework content hash is computed for the second fixture framework` — calls
    `computeFrameworkHash(secondFixtureRoot)`, records the digest. Target: returned digest (artefact).
  - `the framework content hash is computed for the ADW framework under test` — calls
    `computeFrameworkHash(process.cwd())` over the real ADW checkout; proves the real `adw_init.md`
    carries a resolvable `hashInputs:` field **behaviourally** (a digest, not an error). Target:
    returned digest (artefact).
- Register these **Then** rows:
  - `the most recent computed hash is a 64-character lowercase hexadecimal SHA256 digest` — asserts the
    last recorded hash matches `^[0-9a-f]{64}$`. Target: returned digest (artefact).
  - `the recorded hashes are all identical` — asserts every recorded hash equals the first (determinism
    / order-independence). Target: returned digests (artefacts).
  - `the recorded hashes are all different` — asserts the recorded hashes are pairwise distinct
    (byte-sensitivity / distinct-framework). Target: returned digests (artefacts).
  - `the hash computation fails with an error reporting the absent hash inputs declaration` — asserts an
    error was thrown whose message mentions `hashInputs`. Target: raised error (artefact).
  - `the hash computation fails with an error that names the missing input file {string}` — asserts an
    error was thrown whose message contains the named missing file. Target: raised error (artefact).
- Add a closing note: `the ADW codebase is checked out` (G18) and `the ADW TypeScript type-check passes`
  (T22) are already registered and reused by this scenario — no new rows.

### Task 5: (Optional) run the promotion-vocabulary advisory
- Optionally run the `/promote_regression_vocabulary` (or `promote-regression-vocabulary` skill)
  advisory over the moved scenario to double-check per-phrase reuse/rot verdicts against the registry.
  It is advisory-only and writes nothing; use its output only to confirm no phrase collides and every
  new phrase is rubric-compliant. Skip if the green run and the ambiguity check (Task 6) already pass.

### Task 6: Prove the scenario executes green under @regression (no ambiguity)
- Run the moved scenario in isolation first:
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-537"` — expect all 8 scenarios pass.
- Run the regression gate and confirm the scenario is now included and the whole suite is green:
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — expect 0 failed, 0 undefined,
  **0 ambiguous**, and the 8 `feature-537` scenarios present in the run.
- If any step reports "undefined" or "ambiguous", stop and diagnose before proceeding (undefined ⇒ a
  step-def glob or import regression; ambiguous ⇒ a genuine phrase collision to resolve).

### Task 7: Confirm the old per-issue paths are gone and nothing dangles
- Assert absence:
  `test ! -e features/per-issue/feature-537.feature && test ! -e features/per-issue/step_definitions/feature-537.steps.ts && echo "old paths removed"`.
- Grep for stray references to the old paths (should return nothing outside this plan/spec):
  `grep -rn "per-issue/feature-537\|per-issue/step_definitions/feature-537" --include=*.ts --include=*.js --include=*.md --include=*.json . | grep -v node_modules | grep -v specs/`.

### Task 8: Keep the commit scoped (exclude unrelated README drift)
- The worktree has **pre-existing uncommitted `README.md` drift** unrelated to #760 (promotion-sweep
  cron-dispatch docs, `perIssueSweepPersist.ts`, `multilang/`/`upgrade/` tree entries). Do **not**
  `git add -A`. Stage only this feature's paths:
  `git add features/regression/hashing/feature-537.feature features/regression/step_definitions/feature-537.steps.ts features/regression/vocabulary.md specs/issue-760-adw-6uaoda-feat-promote-537-sce-sdlc_planner-promote-537-hashcomputer-regression.md`
  (the two per-issue deletions are captured by the `git mv` and are already staged).
- If the SDLC document phase updates `README.md` (e.g. to add the new `features/regression/hashing/`
  tree entry, mirroring how #729 added `upgrade/`), it must first discard the unrelated drift
  (`git checkout origin/dev -- README.md`) and then add only the single `hashing/` line — so the HITL
  PR carries no out-of-scope README changes.

### Task 9: Run the full validation suite (zero regressions)
- Execute every command in **Validation Commands** below and confirm all pass with zero regressions.

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so this subsection is included. However, this
feature is a **pure relocation plus a documentation-registry edit** — it adds no new TypeScript logic,
so **no new unit tests are warranted or created**. The `computeFrameworkHash` module already owns its
exact-value fixture unit tests (per the parent PRD's Testing Decisions), and those, together with the
whole unit suite, must remain green as a regression guard. Validate with `bun run test:unit`. Inventing
a unit test for a `git mv` would be cargo-cult; the behavioural proof for this change is the
`@regression` BDD run (Task 6).

### Edge Cases
- **Ambiguous step after move** — the primary risk. Guarded by: (a) the file is loaded exactly once
  (per-issue glob no longer matches, regression glob now matches); (b) the explicit ambiguity check in
  Task 6 (`0 ambiguous` in the cucumber summary). The phrases are hashComputer-specific and share no
  vocabulary with existing registered phrases.
- **Undefined shared steps** — `the ADW codebase is checked out` (defined in
  `features/step_definitions/ensureCronOnEveryEventSteps.ts`) and `the ADW TypeScript type-check passes`
  (defined in `features/per-issue/step_definitions/feature-504.steps.ts`) must still resolve. They do,
  because `cucumber.js` imports both `features/step_definitions/**` and
  `features/per-issue/step_definitions/**` unconditionally. Task 6's run confirms `0 undefined`.
- **Broken import after move** — mitigated by identical directory depth; the `@adw-537` run (Task 6)
  and `bunx tsc --noEmit` (Validation) would fail loudly if `../../../adws/core/hashComputer.ts` no
  longer resolved.
- **`@regression` mock-infra hook incompatibility** — the mock-infra `Before`/`After` hooks now wrap
  `feature-537`'s World-agnostic scenarios; proven compatible by the identically-shaped, merged-green
  `feature-729`. Confirmed empirically by Task 6's green `@regression` run.
- **§7 real-framework hash stability** — `computeFrameworkHash(process.cwd())` reads the real
  `adw_init.md` `hashInputs:` (`.claude/commands/adw_init.md`, `templates/vocabulary.md.template`).
  Editing `features/regression/vocabulary.md` does **not** change those inputs, so the real-framework
  digest is unaffected and §7 stays green.
- **Unrelated README drift riding into the HITL PR** — guarded by the scoped-commit task (Task 8).

## Acceptance Criteria
- `features/regression/hashing/feature-537.feature` exists, carries a feature-level `@regression` tag,
  and retains its `@adw-537` / `@adw-zapagn-hashcomputer-deep-mo` tags.
- `features/regression/step_definitions/feature-537.steps.ts` exists with its imports unchanged.
- `features/per-issue/feature-537.feature` and `features/per-issue/step_definitions/feature-537.steps.ts`
  no longer exist.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` executes the 8 moved scenarios and
  the whole suite is green: **0 failed, 0 undefined, 0 ambiguous**.
- The 16 novel Given/When/Then phrase-patterns are registered in `features/regression/vocabulary.md`
  with rubric-compliant (artefact-asserting) descriptions; the two shared phrases reuse G18/T22.
- No ambiguous-step error is introduced anywhere in the suite.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`,
  and `bun run build` all pass with zero regressions.
- The commit/PR contains only this feature's paths — no unrelated `README.md` drift.
- (Governance) The resulting PR is `hitl`-labelled and merges only after human approval; no auto-merge.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `mkdir -p features/regression/hashing` — (idempotent) ensure the destination subdir exists.
- `test ! -e features/per-issue/feature-537.feature && test ! -e features/per-issue/step_definitions/feature-537.steps.ts && echo "OLD PATHS REMOVED"` — confirm the source per-issue paths are gone.
- `test -e features/regression/hashing/feature-537.feature && test -e features/regression/step_definitions/feature-537.steps.ts && echo "NEW PATHS PRESENT"` — confirm the relocation landed.
- `head -1 features/regression/hashing/feature-537.feature | grep -q '@regression' && echo "REGRESSION TAG PRESENT"` — confirm the feature-level `@regression` tag.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-537"` — run the moved scenario in isolation; expect all 8 scenarios pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — run the full regression gate; expect 0 failed, 0 undefined, 0 ambiguous, with the `feature-537` scenarios included.
- `bun run lint` — linter passes.
- `bunx tsc --noEmit` — root type-check passes (also exercised by scenario §8).
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws type-check passes.
- `bun run test:unit` — full unit suite (incl. hashComputer fixture tests) green, zero regressions.
- `bun run build` — build succeeds.
- `git status --porcelain` — review before committing; confirm only the intended paths are staged and
  the unrelated `README.md` drift is not swept in.

## Notes
- **`.adw/coding_guidelines.md`** is not present in this repo (no `guidelines/coding_guidelines.md`
  fallback either); no additional guideline refactor is required. This change touches no `adws/**`
  source.
- **No new libraries** are needed (per `.adw/project.md` the install command would be
  `bun add <package>`, but nothing is added here).
- **Direct relocation is deliberate.** The `adws/promotion/` automated mover HITL flow is dead code and
  has never promoted a scenario; this plan does the move by hand exactly as #734/#729 did. Do **not**
  attempt to route this through the mover, and do **not** author a new
  `features/per-issue/feature-760.feature` — this is a `regression-promotion`-labelled issue whose
  scenario-authoring/alignment/validation/fidelity gates are skipped by design
  (`shouldSkipScenarioAuthoring`), and writing a new scenario would be the spurious-authoring bug.
- **Subdirectory name.** `hashing` is chosen as a short, single-word subdir reflecting the scenario's
  subject (framework content hashing), consistent with the existing single-word regression subdirs
  (`smoke`, `surfaces`, `upgrade`, `multilang`). The step-def stays **flat** in
  `features/regression/step_definitions/` (not nested under `hashing/`) so the relative import depth is
  preserved.
- **HITL gate.** The `hitl` label routes the PR through `adwMerge`'s human-approval gate; the PR must be
  approved by a human before merge. Nothing in this plan bypasses that.
- **README hygiene.** The working tree's `README.md` modification is unrelated, uncommitted local drift
  (verified: not present on `origin/dev`; `HEAD == origin/dev`). Keep it out of this feature's commit
  (Task 8). If the tree listing should gain a `features/regression/hashing/` entry, do it deliberately
  from a clean `origin/dev` README, adding only that one line.
