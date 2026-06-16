# Patch: Restore Step 0 contamination — re-baseline the three contaminated prompt files to #579

## Metadata
adwId: `l8a10n-stack-coherence-chec`
reviewChangeRequest: `Issue #1: Step 0 contamination was committed instead of restored — the branch's committed diff (git diff 55379c7...HEAD) reverts merged #579 work in three prompt files, violating spec Step 0, the Validation Commands check ('confirm the Step 0 contamination is not reintroduced'), and the acceptance criterion 'No adw_init.md change ... the Step 0 contamination is not reintroduced'. (1) .claude/commands/adw_init.md strips its init-time adw:unverified fallback-flagging block. (2) .claude/commands/scenario_writer.md deletes the 'Scenario format — Gherkin mandate' section and re-introduces the 'Detect or bootstrap E2E tool' behavior the PRD removed. (3) .claude/commands/generate_step_definitions.md is de-polymorphized, reverting #579's BDD-framework / Step-Def-Directory polymorphism back to hardcoded cucumber-js/TypeScript step definitions. The #581 feature code (adws/core, adws/phases, adws/github, adws/types, README, tests, feature-581) is correct and is NOT the problem. Resolution: git checkout 55379c7 -- the three .claude/commands files, verify, and confirm git diff 55379c7...HEAD no longer lists them. Make no change to the #581 feature code.`

## Issue Summary
**Original Spec:** `specs/issue-581-adw-l8a10n-stack-coherence-chec-sdlc_planner-stack-coherence-check.md`

**Issue:** The branch committed the **Step 0 contamination** instead of restoring it. The committed diff `git diff 55379c7...HEAD` reverts merged #579 work in three prompt files, violating spec **Step 0**, the **Validation Commands** check ("confirm the Step 0 contamination is not reintroduced"), and the **acceptance criterion** "No `adw_init.md` change … the Step 0 contamination is not reintroduced." Verified in the current tree:
- **`.claude/commands/adw_init.md`** — the init-time `adw:unverified` fallback-flagging block is **stripped**: baseline `55379c7` has the "Flag determination" branch, the `gh issue edit … --add-label "adw:unverified"` / comment calls, and the `unverified-fallback: <raised | not raised>` recording; HEAD has none of them. This removes the complementary init-time defense the #581 runtime check is explicitly designed to back up ("defense-in-depth, not replacement").
- **`.claude/commands/scenario_writer.md`** — the "## Scenario format — Gherkin mandate" section (baseline line 14) is **deleted** and the "### 2. Detect or bootstrap E2E tool" behavior the PRD removed is **re-introduced**.
- **`.claude/commands/generate_step_definitions.md`** — **de-polymorphized**: baseline's "Polymorphism on `.adw/scenarios.md`" detail (BDD-Framework / Step-Def-Directory branches, per-framework import/registration idioms) is reverted back to hardcoded cucumber-js/TypeScript.

**Solution:** Restore exactly those three files to their committed `55379c7` baseline (the #579 merge = the pre-contamination committed state) and re-commit. **`README.md` is NOT contaminated** — its `55379c7...HEAD` diff is the legitimate #581 Project-Structure addition (new `stackCoherenceCheck.ts` / `stackCoherenceReporter.ts` / `isGherkinFramework` entries) and must be left untouched. Make **no** change to the #581 feature code (`adws/core`, `adws/phases`, `adws/github`, `adws/types`, tests, `features/per-issue/feature-581.*`).

## Files to Modify
Restore only these three files (no other file changes):

- `.claude/commands/adw_init.md` — restore from `55379c7`.
- `.claude/commands/generate_step_definitions.md` — restore from `55379c7`.
- `.claude/commands/scenario_writer.md` — restore from `55379c7`.

**Do NOT touch:** `README.md` (legitimate #581 change) or any `adws/**`, test, or `features/**` file.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore the three contaminated prompt files from the #579 baseline
- Run exactly:
  ```bash
  git checkout 55379c7 -- .claude/commands/adw_init.md .claude/commands/generate_step_definitions.md .claude/commands/scenario_writer.md
  ```
- `55379c7` is the `#579` merge commit ("Merge pull request #603 … feature-issue-579-polymorphic-step-def-descriptor-generation") = the pre-contamination committed state.
- Do **not** add `README.md` (or any other path) to this checkout — `README.md`'s `55379c7...HEAD` diff is intended #581 work.

### Step 2: Verify the restored content is the #579 baseline (not the contamination)
- Confirm `adw_init.md` again contains its init-time `adw:unverified` fallback-flagging block:
  ```bash
  grep -n -i "Flag determination\|adw:unverified\|unverified-fallback" .claude/commands/adw_init.md
  ```
  Expect hits for "Flag determination", the `gh issue edit … --add-label "adw:unverified"` call, and `unverified-fallback`.
- Confirm `scenario_writer.md` again contains the Gherkin mandate and no longer bootstraps an E2E tool:
  ```bash
  grep -n -i "Scenario format — Gherkin mandate" .claude/commands/scenario_writer.md   # expect a hit
  grep -n -i "Detect or bootstrap E2E tool" .claude/commands/scenario_writer.md         # expect NO hit
  ```
- Confirm `generate_step_definitions.md` is re-polymorphized:
  ```bash
  grep -n -i "Polymorphism on the BDD framework\|Step Def Directory" .claude/commands/generate_step_definitions.md  # expect hits
  ```

### Step 3: Confirm the contamination is gone from the committed diff, then re-commit
- The three files must now match `55379c7` exactly:
  ```bash
  git diff 55379c7 -- .claude/commands/adw_init.md .claude/commands/generate_step_definitions.md .claude/commands/scenario_writer.md
  ```
  Expect **empty** output.
- After staging+committing the restore, `git diff 55379c7...HEAD` must **no longer list** any of the three `.claude/commands/*.md` files (it should still list `README.md` and the #581 feature files — those are correct).

## Validation
Execute every command to validate the patch is complete with zero regressions. (The patch touches only `.claude/commands/*.md` prompt files — no TypeScript changes — so the standard suite must remain green exactly as before; the git checks below are the substantive proof.)

- `git diff 55379c7 -- .claude/commands/adw_init.md .claude/commands/generate_step_definitions.md .claude/commands/scenario_writer.md` — **must be empty** (three files identical to the #579 baseline).
- `git diff --stat 55379c7...HEAD` — must **not** list `.claude/commands/adw_init.md`, `.claude/commands/generate_step_definitions.md`, or `.claude/commands/scenario_writer.md`; `README.md` and the `adws/**` + `features/per-issue/feature-581.*` files **should** still appear (legitimate #581 work, unchanged).
- `grep -n -i "Flag determination" .claude/commands/adw_init.md` — non-empty (init-time `adw:unverified` fallback-flagging block restored).
- `grep -n -i "Scenario format — Gherkin mandate" .claude/commands/scenario_writer.md` — non-empty (Gherkin-mandate section restored).
- `bun run lint` — ESLint over application + ADW code (zero new errors).
- `bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json` — type-check app + ADW scripts (unaffected by prompt-file restore; must stay green).
- `bun run test:unit` — full Vitest suite, including `adws/core/__tests__/stackCoherenceCheck.test.ts` and the extended `stepDefDetection.test.ts`, must pass with zero regressions (proves the #581 feature code was not touched).

## Patch Scope
**Lines of code to change:** 0 lines of source; restore ~123 changed lines across three `.claude/commands/*.md` prompt files back to their `55379c7` baseline (`adw_init.md` ~14, `generate_step_definitions.md` ~65, `scenario_writer.md` ~44).
**Risk level:** low — a pure `git checkout`-from-baseline of three non-code prompt files; no TypeScript, build, or test logic is altered, and the #581 feature code is deliberately left untouched.
**Testing required:** Git-diff verification (three files == `55379c7`; absent from `git diff 55379c7...HEAD`), content greps for the restored fallback-flagging + Gherkin-mandate blocks, and a regression run of lint / tsc / `test:unit` to confirm the #581 feature code still passes unchanged.
