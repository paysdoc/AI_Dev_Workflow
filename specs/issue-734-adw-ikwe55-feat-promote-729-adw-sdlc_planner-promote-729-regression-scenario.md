# Feature: Promote the #729 adwUpgrade gitignore-exclude scenario into the @regression suite

## Metadata
issueNumber: `734`
adwId: `ikwe55-feat-promote-729-adw`
issueJson: `{"number":734,"title":"feat: promote #729 adwUpgrade gitignore-exclude scenario into the @regression suite","body":"Promote the #729 scenario (the adwUpgrade gitignored-exclude regression guard) from the per-issue directory (input-only, never executed) into the executed @regression suite. Direct relocation: git mv the feature + step-def files, add a feature-level @regression tag, register the scenario's phrases in features/regression/vocabulary.md with rubric-compliant (git-artefact / surface #3) descriptions, and prove both feature-729 scenarios pass under --tags \"@regression\". hitl is set — the resulting PR must be human-approved before merge.","state":"OPEN","author":"paysdoc","labels":["hitl","adw:feature"],"createdAt":"2026-07-07T15:35:00Z"}`

## Feature Description
Issue #729 authored a durable BDD regression guard for the `adwUpgrade` self-upgrade lane: when the framework regen commit excludes `.claude/commands/adw_init.md` and that path is *also* gitignored (the real upgrade-worktree state), the old `commitChanges` crashed at `git add -A -- '.' ':(exclude)…'`. The `#729` fix (merged as `15f0743`, `commitOps.committableExcludePaths` + `git check-ignore`) removed the double-exclusion crash. Two scenarios guard it: **§1** (RED→GREEN — the gitignored-exclude commit is now recorded) and **§2** (a GREEN-both-ways guard that the tracked/self-host exclude is still held out).

Because `.adw/scenarios.md` opts this repo into the tiered regression-suite contract (a `## Regression Scenario Directory` is set), the `scenario_writer` agent is **forbidden to auto-promote `@regression`** — so the #729 workflow correctly routed the scenario to `features/per-issue/` and *surfaced* the promotion request to the maintainer instead of self-applying it (commit `2066986`, "route #729 scenario per-issue not @regression"). Files in `features/per-issue/` are loaded by cucumber but **never executed under the `--tags "@regression"` pass**, and the 14-day per-issue sweep will eventually delete them.

This feature is the maintainer's deliberate promotion: a **direct relocation** of the scenario and its step-defs into the executed `@regression` suite, plus registration of its seven novel phrases in the regression vocabulary registry. The built-in `adws/promotion/` flow is deliberately NOT used — it has never successfully promoted a scenario (it does not relocate step-defs, register vocabulary, or add `@regression`), so the promotion is done by hand exactly as the issue prescribes.

The value: the `adwUpgrade` ignore-safe-commit behaviour becomes part of the permanent, always-run regression safety net (executed on every `@regression` CI pass) instead of an orphaned, soon-to-be-swept per-issue artifact.

## User Story
As an ADW maintainer
I want the #729 adwUpgrade gitignore-exclude regression guard executed on every `@regression` pass
So that the self-upgrade commit lane cannot silently regress (re-introducing the double-exclusion crash that stranded upgrades on 2026-06-24 and again on 2026-07-07) and the guard is not deleted by the per-issue sweep.

## Problem Statement
The #729 regression guard lives in `features/per-issue/` where the `@regression` runner never executes it. The tiered-suite contract (rightly) prevents `scenario_writer` from auto-tagging `@regression`, so a durable guard authored as a regression test is stranded input-only and is on the 14-day deletion path. It must be relocated into the executed `@regression` suite and its vocabulary registered — a maintainer-only action the automated promotion flow cannot perform.

## Solution Statement
Perform a **direct relocation** exactly as the issue specifies:
1. `git mv features/per-issue/feature-729.feature features/regression/upgrade/feature-729.feature` (new `upgrade/` subdir).
2. Add a feature-level `@regression` tag (keeping the existing `@adw-729 @adw-5o6zmy-bug-adwupgrade-regen` tags and the scenario-level `@adw-729` tags for traceability).
3. `git mv features/per-issue/step_definitions/feature-729.steps.ts features/regression/step_definitions/feature-729.steps.ts` — relative imports (`../../../adws/…`) are unchanged because both source and destination are three directories deep, so `../../../adws` still resolves to the repo root. Keep the `{ tags: '@adw-729' }`-scoped `Before`/`After` hooks and module-scoped state as-is.
4. Register the scenario's seven novel phrases in `features/regression/vocabulary.md` under the appropriate Given/When/Then sections, each described as asserting a **git artefact — the tree of the commit `commitChanges` records over a real temp repo** (observability surface #3), never file-on-disk existence, per the Rot-Detection Rubric.
5. Validate: `--tags "@regression"` executes **both** `feature-729` scenarios and they pass (the fix is merged, so §1 is green), the old per-issue paths no longer exist, and no ambiguous-step error is introduced.

This works because the change is **glob-neutral**: `cucumber.js` already globs both `features/regression/**/*.feature` and `features/regression/step_definitions/**/*.ts` (recursively), so the moved files stay discovered/loaded; the *only* behavioural change is the `@regression` tag turning execution on under the regression pass.

> **⚠️ Observed worktree state at planning time (2026-07-07):** a concurrent implementation of #734 has **already staged the two `git mv` renames** (`R`/`RM` in `git status`), **already added the `@regression` tag** to the moved feature line, and is **actively writing the vocabulary rows** (`vocabulary.md` shows ` M`, 3 of the 7 phrases already present). The implementer must **reconcile with this partial state, not blindly re-run `git mv`** (the per-issue sources no longer exist — a re-run would fail). Treat every task below as **idempotent / verify-then-act**.

## Relevant Files
Use these files to implement the feature:

- `features/per-issue/feature-729.feature` — **source** of the move (already relocated to the destination below in the current worktree). The scenario file: two `@adw-729` scenarios (§1 RED→GREEN, §2 guard) plus an extensive rot-prevention/observability preamble and a maintainer note listing exactly the seven phrases to register.
- `features/per-issue/step_definitions/feature-729.steps.ts` — **source** step-def of the move (already relocated). Module-scoped `let` state (`worktreeDir`, `preCommitHead`, `commitThrew`), `@adw-729`-scoped `Before`/`After` hooks, imports `copyAdwInitCommandToWorktree` from `../../../adws/phases/worktreeSetup.ts` and `commitOps` from `../../../adws/gitContext/commitOps.ts`, and drives real git over a temp repo via `execSync`.
- `features/regression/vocabulary.md` — **the file to edit** (Change #4). Contains the Rot-Detection Rubric, the Observability Surfaces table (surface #3 = git artefacts), and the Given (`G1`–`G23`), When (`W1`–`W14`), and Then (`T1`–`T30`) registries. `G18 "the ADW codebase is checked out"` is already registered (Background no-op) — do NOT duplicate it. Append the seven new phrases as `G24`/`G25`/`G26`, `W15`, `T31`/`T32`/`T33`.
- `cucumber.js` — **read-only reference.** `paths` already includes `features/regression/**/*.feature`; `import` already includes `features/regression/step_definitions/**/*.ts` and `features/regression/support/**/*.ts`. No edit required — the recursive globs already cover `features/regression/upgrade/` and the moved step file.
- `.adw/scenarios.md` — **read-only reference.** Declares `## Per-Issue Scenario Directory` (`features/per-issue/`), `## Regression Scenario Directory` (`features/regression/`), and `## Vocabulary Registry` (`features/regression/vocabulary.md`). Its presence is *why* the scenario was routed per-issue and *why* this promotion is a manual maintainer action.
- `features/regression/support/hooks.ts` — **read-only reference; behavioural gotcha.** `Before({ tags: '@regression' })` runs `setupMockInfrastructure()` and `After` runs `teardownMockInfrastructure()`. Once feature-729 carries `@regression`, these hooks **newly wrap its scenarios**. `setupMockInfrastructure` **prepends a git-mock dir to `PATH`** and sets `GH_TOKEN`/`GH_HOST`/`MOCK_*` env vars — but see the next file for why this is safe.
- `test/mocks/git-remote-mock.ts` — **read-only reference; de-risks the promotion.** The git-mock wrapper only intercepts network subcommands (`push`, `fetch`, `clone`, `pull`, `ls-remote`) and **delegates every other subcommand to real git** via `REAL_GIT_PATH`. feature-729 uses only local subcommands (`init`, `config`, `add`, `commit`, `rev-parse`, `show`, `status`, `check-ignore`), so its real-git steps run against real git even under the `@regression` mock infrastructure. This is why §1/§2 stay green after promotion.
- `test/mocks/test-harness.ts` — **read-only reference.** `setupMockInfrastructure` / `teardownMockInfrastructure` and the `PATH`/env mutation described above.
- `features/regression/step_definitions/world.ts` — **read-only reference.** Registers the `RegressionWorld` constructor globally (`setWorldConstructor`). feature-729's steps use `function () {}` callbacks but only module-level state (never `this`), so the World constructor does not conflict.
- `adws/gitContext/commitOps.ts` — **read-only reference; system under test.** Holds the merged #729 fix (`committableExcludePaths` + `git check-ignore` filter). Not edited here.
- `adws/phases/worktreeSetup.ts` — **read-only reference; system under test.** `copyAdwInitCommandToWorktree` (line 152) copies `adw_init.md` in untracked and gitignores it — the production double-exclusion state that §1 drives. Not edited here.
- `app_docs/feature-mzgyjj-rot-prevention-block.md` — **conditional doc (matches: working with `features/regression/vocabulary.md` and the rot-prevention rule).** Governs the required rubric-compliant phrasing of the vocabulary rows (assert an observable artefact, never a source-file property).
- `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — **conditional doc (matches: `commitChanges`/`commitOps.ts` `excludePaths`, the gitignored-exclude-path crash, `committableExcludePaths`, `git check-ignore`).** Explains the behaviour the promoted scenario guards; confirms this feature does not touch that owned code.

### New Files
- `features/regression/upgrade/feature-729.feature` — the relocated scenario (new `features/regression/upgrade/` directory). Created by the `git mv` in Change #1 (already staged in the current worktree).
- `specs/issue-734-adw-ikwe55-feat-promote-729-adw-sdlc_planner-promote-729-regression-scenario.md` — this plan document.

> The moved step-def lands in the **existing** `features/regression/step_definitions/` directory, so it is not a new directory — only the relocated file.

## Implementation Plan
### Phase 1: Foundation
Confirm the promotion is safe and the fix is in place before moving anything:
- Verify the #729 fix is merged into this branch (`adws/gitContext/commitOps.ts` contains `committableExcludePaths` / `git check-ignore`) so §1 is green after promotion.
- Confirm `G18 "the ADW codebase is checked out"` is registered (vocabulary `G18`, defined in `features/step_definitions/ensureCronOnEveryEventSteps.ts`, globally loaded) so the Background step still resolves.
- Confirm `cucumber.js` recursive globs already cover the destination paths (no config edit needed).
- Confirm the `@regression` mock infrastructure (`hooks.ts` → `setupMockInfrastructure`) is transparent for the local git subcommands feature-729 uses (`test/mocks/git-remote-mock.ts` passthrough).

### Phase 2: Core Implementation
Perform the relocation and tagging (Changes #1–#3) and register the vocabulary (Change #4). Every step is **verify-then-act** because a concurrent process may already have applied it.

### Phase 3: Integration
Prove both `feature-729` scenarios execute and pass under `--tags "@regression"`, the old per-issue paths are gone, the moved step file type-checks, and no ambiguous-step error is introduced. Run the full validation suite for zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom. Each task is **idempotent** — check the current state first and skip the action if it is already applied (a concurrent implementation may already have done Changes #1–#3 and part of #4).

### Task 1 — Verify preconditions (fix merged, vocabulary anchor present)
- Confirm `adws/gitContext/commitOps.ts` contains the merged #729 fix: `grep -nE "committableExcludePaths|git check-ignore" adws/gitContext/commitOps.ts` returns matches. If absent, STOP — §1 cannot be green; the promotion is premature.
- Confirm `G18 "the ADW codebase is checked out"` exists in `features/regression/vocabulary.md` and its step-def is present under `features/step_definitions/` (globally loaded). Do not duplicate it.

### Task 2 — Move the scenario file (Change #1)
- If `features/per-issue/feature-729.feature` still exists: `git mv features/per-issue/feature-729.feature features/regression/upgrade/feature-729.feature` (this creates the `features/regression/upgrade/` directory).
- If it has already been moved (destination exists, source gone — the current worktree state), verify the destination is present and staged as a rename (`git status --porcelain` shows `R … -> features/regression/upgrade/feature-729.feature`) and take no further move action.

### Task 3 — Add the feature-level `@regression` tag (Change #2)
- Ensure the first line of `features/regression/upgrade/feature-729.feature` is exactly:
  `@regression @adw-729 @adw-5o6zmy-bug-adwupgrade-regen`
  (prepend `@regression`; keep the two existing `@adw-*` tags). If already applied (current worktree state), leave it.
- Confirm both scenario headers retain their `@adw-729 @adw-5o6zmy-bug-adwupgrade-regen` tag lines (traceability + the `@adw-729`-scoped hooks). Do not add `@regression` at the scenario level — the feature-level tag is inherited by both scenarios.

### Task 4 — Move the step-definition file (Change #3)
- If `features/per-issue/step_definitions/feature-729.steps.ts` still exists: `git mv features/per-issue/step_definitions/feature-729.steps.ts features/regression/step_definitions/feature-729.steps.ts`.
- Do **NOT** rewrite the relative imports — `../../../adws/phases/worktreeSetup.ts` and `../../../adws/gitContext/commitOps.ts` resolve identically from the destination (both are three dirs deep). Keep the `{ tags: '@adw-729' }`-scoped `Before`/`After` hooks and module-scoped `let` state unchanged.
- If already moved (current worktree state), verify the destination file exists and is staged as a rename, and take no action.

### Task 5 — Register the seven phrases in `features/regression/vocabulary.md` (Change #4)
Append rows under the existing tables, using the established column schema `| # | Phrase | Semantics | Pattern | Assertion target |`. Continue the numbering: Given → `G24`–`G26`, When → `W15` (last registered is `W14`), Then → `T31`–`T33` (last registered is `T30`). Each **Pattern** is `phase-import` (the steps import and drive the real `copyAdwInitCommandToWorktree` / `commitOps.commitChanges` over a real temp git repo). Each **Assertion target** is a **git artefact (observability surface #3)** — the recorded commit's tree / the worktree branch HEAD — explicitly NOT file-on-disk existence, per the Rot-Detection Rubric. Do NOT re-add `G18`.

Add to the **Given — Mock Setup** table:
- `G24` | `` `an upgrade regen worktree whose command file ".claude/commands/adw_init.md" is gitignored by the real copy-init-command step` `` | Inits a real temp git repo with a committed `.adw/project.md` baseline, then calls the REAL `copyAdwInitCommandToWorktree` so the command file lands untracked AND gitignored — the production double-exclusion state | phase-import | worktree git artefact (untracked + gitignored path) |
- `G25` | `` `an upgrade regen worktree with a tracked, modified ".claude/commands/adw_init.md" that is not gitignored` `` | Inits a real temp git repo, commits `.adw/project.md` and a tracked `.claude/commands/adw_init.md`, then modifies the command file with no `.gitignore` entry — the tracked self-host state | phase-import | worktree git artefact (tracked modified path) |
- `G26` | `` `the worktree has a pending regen change to {string}` `` | Writes regenerated content to the named path under the temp worktree, leaving an uncommitted change staged for the regen commit | phase-import | worktree git artefact (pending change) |

Add to the **When — Orchestrator / Phase Invocation** table:
- `W15` | `` `the framework upgrade commits the regen excluding {string}` `` | Drives the REAL `commitOps.commitChanges(run, message, worktree, { excludePaths: [path] })` over the temp worktree, recording the pre-call HEAD and any thrown error | phase-import | recorded commit (git artefact) |

Add to the **Then — State / Mock / Artefact Assertions** table:
- `T31` | `` `the regen commit is recorded on the worktree branch` `` | Asserts the commit step did not throw AND HEAD advanced past the baseline — a new commit exists on the worktree branch (a git artefact, not a source file). This is the RED/GREEN pivot for §1 | phase-import | git artefact (worktree branch HEAD) |
- `T32` | `` `the recorded commit's tree includes {string}` `` | Asserts the named path is a member of `git show --name-only --format= HEAD` — the tree of the commit `commitChanges` recorded (a git artefact, not file-on-disk existence) | phase-import | git artefact (recorded commit tree) |
- `T33` | `` `the recorded commit's tree excludes {string}` `` | Asserts the named path is absent from `git show --name-only --format= HEAD` — the recorded commit's tree (a git artefact, not file-on-disk existence) | phase-import | git artefact (recorded commit tree) |

### Task 6 — Confirm the old per-issue paths no longer exist
- `test ! -e features/per-issue/feature-729.feature` and `test ! -e features/per-issue/step_definitions/feature-729.steps.ts` both succeed (files moved, not copied).

### Task 7 — Discovery / ambiguity smoke check
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-729" --dry-run` and confirm both `feature-729` scenarios are discovered with **all steps defined** (no undefined, no ambiguous). Because the moved step file was already loaded globally before the move (the per-issue glob) and the destination glob loads the same set, the move cannot introduce a new ambiguity — this check confirms it.

### Task 8 — Run the Validation Commands (zero regressions)
- Execute every command in the `Validation Commands` section. The regression pass must execute **both** `feature-729` scenarios and report them **passing**, with no ambiguous-step errors anywhere in the suite.

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so this subsection is included. **No new unit tests are required for this feature.** The change is a pure relocation of an existing scenario plus a Markdown vocabulary-registry edit — it introduces **no new production code path** to unit-test. The unit-level coverage of the underlying fix (that the emitted `git add` omits the `:(exclude)` token for an ignored path and retains it otherwise) is **owned by #729** under `adws/gitContext/__tests__/` and is unchanged here. The behavioural proof for this feature is the two `feature-729` BDD scenarios executing green under `--tags "@regression"` (see Validation Commands). Do not add or modify unit tests as part of this feature.

### Edge Cases
- **Concurrent partial state:** Changes #1–#3 (and part of #4) may already be applied in the worktree — every task is idempotent/verify-then-act so re-execution neither fails nor duplicates.
- **`@regression` mock infra newly wrapping the scenario:** `hooks.ts` prepends a git-mock to `PATH`; the git-mock passes through all local git subcommands to real git, so §1/§2 remain green. Verified via `test/mocks/git-remote-mock.ts`.
- **§1 RED-guard integrity:** if `commitChanges` throws (pre-fix behaviour), `the regen commit is recorded on the worktree branch` fails clearly (the step-def guards against asserting a stale HEAD). The fix being merged makes this green — but the guard must fail loudly if the fix is ever reverted.
- **§2 over-correction guard:** a fix that unconditionally drops every exclude would let `adw_init.md` back into the tracked/self-host commit; §2 (`the recorded commit's tree excludes ".claude/commands/adw_init.md"`) fails in that case.
- **Ambiguous steps:** the seven phrases are novel (the feature preamble asserts the registry had no equivalents, and the #685 §D commit phrases are intentionally not reused). The dry-run in Task 7 confirms no collision.
- **`G18` duplication:** must NOT be re-registered — it is already `G18` and the Background step resolves globally.

## Acceptance Criteria
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` executes **both** `feature-729` scenarios and they **pass**.
- `features/regression/upgrade/feature-729.feature` exists and its `Feature:` line carries `@regression` (alongside `@adw-729 @adw-5o6zmy-bug-adwupgrade-regen`); both scenarios retain their `@adw-729` tags.
- `features/regression/step_definitions/feature-729.steps.ts` exists with its relative imports (`../../../adws/…`) and `@adw-729`-scoped hooks unchanged.
- `features/per-issue/feature-729.feature` and `features/per-issue/step_definitions/feature-729.steps.ts` no longer exist (moved, not copied).
- The seven phrases are present in `features/regression/vocabulary.md` (`G24`–`G26`, `W15`, `T31`–`T33`) with rubric-compliant descriptions asserting a git artefact (surface #3 — the recorded commit's tree / worktree branch HEAD), not file-on-disk existence; `G18` is not duplicated.
- No other regression scenario changes behaviour and no ambiguous-step error is introduced (`--tags "@regression"` and the `@adw-729 --dry-run` both clean).
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, and `bun run build` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `grep -nE "committableExcludePaths|git check-ignore" adws/gitContext/commitOps.ts` — confirm the #729 fix is present so §1 is green (must return matches).
- `head -1 features/regression/upgrade/feature-729.feature` — must be `@regression @adw-729 @adw-5o6zmy-bug-adwupgrade-regen`.
- `test ! -e features/per-issue/feature-729.feature && test ! -e features/per-issue/step_definitions/feature-729.steps.ts && echo MOVED-OK` — confirm the sources are gone (prints `MOVED-OK`).
- `test -e features/regression/step_definitions/feature-729.steps.ts && echo STEPDEF-OK` — confirm the step-def landed in the regression dir.
- `grep -nE "G24|G25|G26|W15|T31|T32|T33" features/regression/vocabulary.md` — confirm the seven new rows are registered.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-729" --dry-run` — both scenarios discovered, all steps defined, no ambiguous/undefined steps.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the full regression suite runs green, executing **both** `feature-729` scenarios (this is the primary acceptance command; no ambiguous-step errors anywhere).
- `bun run lint` — linter passes.
- `bunx tsc --noEmit` — root type-check passes (the moved step file resolves its imports).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes.
- `bun run build` — build succeeds.
- `bun run test:unit` — unit suite passes with zero regressions (no new unit tests added; confirms nothing was broken).

## Notes
- **This is a maintainer-only direct relocation, not the automated promotion flow.** The `adws/promotion/` HITL flow is deliberately bypassed — it does not relocate step-defs, register vocabulary, or add `@regression`, and has never successfully promoted a scenario. See `app_docs/feature-mzgyjj-rot-prevention-block.md` (rot rule / vocabulary) and the promotion-system docs for the rationale; do **not** invoke or modify any promotion module here.
- **`hitl` label is set** — the resulting PR must be **human-approved before merge** (do not auto-merge). This is enforced by the `hitl` label gate in `adwMerge.tsx` / `autoMergePhase.ts`.
- **Glob-neutrality is the safety property.** `cucumber.js` already globs `features/regression/**/*.feature` and `features/regression/step_definitions/**/*.ts`, and previously globbed the per-issue equivalents. The moved files are loaded before and after the move; the *only* behavioural change is the `@regression` tag enabling execution. No `cucumber.js` edit is needed.
- **Do not rewrite the step-def's relative imports.** Source and destination are both three directories deep, so `../../../adws/…` resolves to the repo root in both locations.
- **Vocabulary rows must be rubric-compliant.** Per the Rot-Detection Rubric and the issue, each phrase asserts a **git artefact (surface #3 — the recorded commit's tree over a real temp repo)**, never file existence, file contents, or a source-file property. The path literals in the phrases (`.claude/commands/adw_init.md`, `.adw/project.md`) are documented production I/O values (the exact paths `adwUpgrade.tsx` reads/writes) — INPUT/OUTPUT test data the Rubric permits, not source-file references.
- **No new library is required** — this feature adds no dependencies. (Library install command for this repo, per `.adw/commands.md`, is `bun add <package>`.)
- If `.adw/coding_guidelines.md` (or `guidelines/coding_guidelines.md`) exists in the repo, adhere to it; this change is a file move + Markdown edit and introduces no TypeScript that would need refactoring.
