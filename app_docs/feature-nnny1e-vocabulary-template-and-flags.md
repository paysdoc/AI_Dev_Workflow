# Vocabulary Template & adwInit Polymorphism Flags

**ADW ID:** nnny1e-vocabulary-md-templa
**Date:** 2026-05-21
**Specification:** specs/issue-507-adw-nnny1e-vocabulary-md-templa-sdlc_planner-vocabulary-template-and-flags.md

## Overview

This feature (slice #2 of the rot-prevention-and-promotion PRD) distributes the framework's rot-prevention rubric to every target repo bootstrapped via `adwInit`. It ships a checked-in template at `templates/vocabulary.md.template` and extends `/adw_init` step 7 to copy the template verbatim into the target repo and write per-issue/regression directory polymorphism flags to `.adw/scenarios.md` by default.

## What Was Built

- `templates/vocabulary.md.template` — checked-in framework asset with three sections: Rot-Detection Rubric, Observability Surfaces placeholder (TODO for slice #3), and Three Permitted Execution Patterns with minimal universal Given/When/Then seed phrases
- Extended `.claude/commands/adw_init.md` step 7 to always write `## Per-Issue Scenario Directory` and `## Regression Scenario Directory` sections to `.adw/scenarios.md`
- Extended `adws/adwInit.tsx` to resolve the framework repo root and pass it as a 4th positional argument (`$3`) to the `/adw_init` slash command
- BDD scenarios in `features/per-issue/feature-507.feature` (7 scenarios, tagged `@adw-507`) covering vocabulary file materialisation and polymorphism flag population
- Step definitions in `features/per-issue/step_definitions/feature-507.steps.ts`
- Three JSONL manifest fixtures: `adw-init-writes-vocab.json`, `adw-init-writes-scenarios.json`, `adw-init-writes-vocab-and-scenarios.json`
- Unit test `adws/__tests__/vocabularyTemplate.test.ts` verifying the template file structure

## Technical Implementation

### Files Modified

- `adws/adwInit.tsx`: Added `path` and `fileURLToPath` imports; resolves `frameworkRepoRoot` from `import.meta.url` and appends it as a 4th positional arg to `runClaudeAgentWithCommand('/adw_init', ...)`
- `.claude/commands/adw_init.md`: Added `frameworkRepoRoot: $3` variable; extended step 7 with `mkdir -p features/regression && cp "$3/templates/vocabulary.md.template" features/regression/vocabulary.md`; updated step 8 report to mention the new files and flag sections

### New Files

- `templates/vocabulary.md.template`: Universal rot-detection rubric (verbatim from `features/regression/vocabulary.md`), observability surfaces placeholder with `<!-- TODO (slice #3) -->` marker, and seed phrase tables for G1/G2, W1, T1/T2
- `features/per-issue/feature-507.feature`: 7 BDD scenarios in three sections (vocabulary materialisation, polymorphism flags, combined run)
- `features/per-issue/step_definitions/feature-507.steps.ts`: Step implementations asserting artefact-level outputs in target worktrees via the `claude-cli-stub` + JSONL manifest pattern
- `test/fixtures/jsonl/manifests/adw-init-writes-vocab.json`: Manifest simulating `/adw_init` writing `features/regression/vocabulary.md`
- `test/fixtures/jsonl/manifests/adw-init-writes-scenarios.json`: Manifest simulating `/adw_init` writing `.adw/scenarios.md` with both polymorphism sections
- `test/fixtures/jsonl/manifests/adw-init-writes-vocab-and-scenarios.json`: Combined manifest for a single run producing both artefacts
- `adws/__tests__/vocabularyTemplate.test.ts`: Unit assertions on template file structure and section headers

### Key Changes

- `frameworkRepoRoot` is resolved in `adwInit.tsx` via `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')` — mirrors the pattern in `adws/phases/worktreeSetup.ts`
- The template copy uses a Bash `cp` (not LLM generation) to guarantee byte-stable distribution of the rot rubric across repos
- Both polymorphism flag sections are written unconditionally — they do not depend on the detected scenario tool and apply to Cucumber, Playwright, and Cypress target repos alike
- When `$3` is empty (legacy invocation without framework repo root), step 7 skips the template copy and logs a warning; the polymorphism flags are still written
- All BDD step definitions assert on artefacts written to the target worktree, not on source-file properties of the framework — consistent with the rot-prevention rubric the feature itself distributes

## How to Use

After this feature ships, `adwInit` automatically bootstraps every new target repo with:

1. **`features/regression/vocabulary.md`** — copied verbatim from `templates/vocabulary.md.template`. The repo-specific observability surfaces section is a TODO placeholder until slice #3 fills it via LLM-drafting.
2. **`.adw/scenarios.md`** with both sections populated:
   - `## Per-Issue Scenario Directory` → `features/per-issue/`
   - `## Regression Scenario Directory` → `features/regression/`

These flags activate the tiered regression model in `scenario_writer`: per-issue draft scenarios land in `features/per-issue/`, promoted regression scenarios land in `features/regression/`. No manual configuration is required.

To invoke manually:
```bash
# adwInit.tsx passes frameworkRepoRoot as $3 automatically
bun run adws/adwInit.tsx <issueNumber> <adwId> <issueJson>
```

If calling `/adw_init` directly (e.g., from a custom harness), pass the framework repo root as `$3`:
```bash
# In .claude/commands/adw_init.md context:
# $0 = issueNumber, $1 = adwId, $2 = issueJson, $3 = frameworkRepoRoot
```

## Configuration

No new environment variables. The 4th positional arg (`$3`) is resolved automatically by `adwInit.tsx` from `import.meta.url`. Legacy callers without `$3` receive the polymorphism flags but skip the vocabulary copy (a warning is noted in the step 8 report).

## Testing

```bash
# Unit test — template structure
bun run test:unit

# Issue-507 BDD scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-507"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- This is the **target-repo distribution half** of the rot-prevention story. The **framework-prompt half** (rot-prevention block in `scenario_writer.md`) landed in issue #506 (`app_docs/feature-mzgyjj-rot-prevention-block.md`). After both slices ship, every `scenario_writer` invocation in any onboarded target repo enforces the rot-prevention rubric and prefers registered vocabulary phrases.
- **Section 2 (Observability Surfaces) is a deliberate TODO placeholder.** Slice #3 will add LLM-drafting of repo-specific surface examples based on the detected project stack.
- **Re-init behaviour**: if a target repo already has `features/regression/vocabulary.md`, `cp` overwrites it. Re-init is rare; custom vocabulary files should be preserved manually before re-running `adwInit`.
- **Non-Cucumber repos** receive the polymorphism flags pointing at `features/per-issue/` and `features/regression/`; `scenario_writer` creates the directories on first invocation.
- **Out of scope for this slice:** LLM-drafting the examples block (slice #3); `## Vocabulary Registry` in `.adw/scenarios.md` for `generate_step_definitions` enforcement (slice #3 or #4); backporting to existing target repos (deferred to an `adwUpgrade` mechanism).
