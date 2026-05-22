# LLM-Drafted Observability-Surfaces Examples Block in adwInit

**ADW ID:** mqwyb7-llm-drafted-observab
**Date:** 2026-05-22
**Specification:** specs/issue-508-adw-mqwyb7-llm-drafted-observab-sdlc_planner-llm-draft-observability-examples.md

## Overview

Extends `/adw_init` step 7 so that after copying `templates/vocabulary.md.template` into the target repo, the agent analyses the target repo's manifest files and devDependencies to classify the stack and replace the `<!-- TODO (slice #3, issue ??): ... -->` placeholder in the materialised `features/regression/vocabulary.md` with a real, repo-specific `## Observability Surfaces (Examples)` Markdown table. This is slice #3 of the scenario-rot-prevention-and-promotion PRD; the drafted block feeds the promotion scorer (slice #4) and prevents the "empty examples" failure mode where all scenarios score zero on the surface-match axis.

## What Was Built

- Stack-classification logic embedded in `.claude/commands/adw_init.md` step 7, distinguishing three classes: **browser-test-equipped**, **CLI-only**, and **fallback**
- Three verbatim Markdown table blocks (one per class) inlined in the prompt so the agent writes exact content — no LLM paraphrasing
- Placeholder-replacement instruction targeting the literal `<!-- TODO (slice #3, issue ??):` comment between `## Observability Surfaces (Examples)` and `## Three Permitted Execution Patterns`
- Step 8 report bullet: class chosen + placeholder replacement outcome (`succeeded | skipped: <reason>`)
- `adwInit.tsx` updated to compute `frameworkRepoRoot` and pass it as the 4th positional arg (`$3`) to `/adw_init`
- Two JSONL manifest fixtures simulating the agent's artefact output for Playwright-equipped and CLI-only target repos
- Five BDD scenarios in `features/per-issue/feature-508.feature` validating the materialised `vocabulary.md` artefact content

## Technical Implementation

### Files Modified

- `.claude/commands/adw_init.md`: Added `frameworkRepoRoot: $3` variable declaration; extended step 7 with `**Draft the observability-surfaces examples block**` sub-bullet (classification rules, three block bodies, Edit-tool replacement instruction); extended step 8 report
- `adws/adwInit.tsx`: Added `path` and `fileURLToPath` imports; computes `frameworkRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')` and passes it as the 4th arg to `runClaudeAgentWithCommand`

### New Files

- `features/per-issue/feature-508.feature`: Five BDD scenarios tagged `@adw-508 @adw-mqwyb7-llm-drafted-observab` covering placeholder removal, DOM/screenshot entries (Playwright), CLI-only scoped block, Markdown table layout conformance, and a combined integration check
- `features/per-issue/step_definitions/feature-508.steps.ts`: Step definitions for all Given/When/Then phrases; re-uses `targetRepos`, `applyManifest`, and artefact-file helpers from feature-506/507 steps
- `test/fixtures/jsonl/manifests/adw-init-drafts-playwright-examples.json`: Manifest stub simulating the agent writing `features/regression/vocabulary.md` with browser-test-equipped block (DOM + screenshot rows present)
- `test/fixtures/jsonl/manifests/adw-init-drafts-cli-examples.json`: Manifest stub for CLI-only block (state files, recorded requests, exit codes, log streams; no DOM/screenshot rows)

### Key Changes

- **Prompt-only on the framework side**: no new TypeScript modules; `adwInit.tsx` change is purely to wire `frameworkRepoRoot` as `$3`, completing the slice-#507 contract
- **Three classification classes** with detection rules for Node (`devDependencies` scan), Python, Ruby, Java, and .NET ecosystems; fallback when no manifest can be parsed
- **Verbatim block bodies** inlined in the prompt — the agent picks one block and uses `Edit` to replace the placeholder; no LLM paraphrasing of surface descriptions
- **Rubber-stamp risk accepted** (PRD user story 19): no gating workflow on the init PR; miscalibration surfaces through the first scenarios produced against the target repo
- **Placeholder-missing guard**: if the file was absent or pre-edited, the drafting sub-step skips silently and logs a warning in the step 8 report

## How to Use

When `/adw_init` runs against a target repo, step 7 now automatically:

1. Classifies the target repo's stack by examining `devDependencies` (or equivalent manifests)
2. Selects the appropriate block — browser-test-equipped (7 surfaces including DOM + screenshots), CLI-only (5 surfaces, no browser entries), or fallback (4 universal surfaces with a manual-refinement note)
3. Replaces the `<!-- TODO (slice #3, issue ??): ... -->` placeholder in `features/regression/vocabulary.md` using the `Edit` tool
4. Reports the outcome in step 8

No manual steps required. The `frameworkRepoRoot` argument is now always passed by `adwInit.tsx`; legacy invocations without `$3` skip the template copy and drafting, and log a warning.

## Configuration

No new environment variables or `.adw/` configuration required. `adwInit.tsx` derives `frameworkRepoRoot` from `import.meta.url` at runtime — it always points to the ADW framework repo root regardless of where the orchestrator is invoked from.

## Testing

Run the per-issue BDD suite:

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-508"
```

All five scenarios should pass. The regression suite must also remain green:

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- This slice is **prompt-only** on the framework side. The only TypeScript change is the `frameworkRepoRoot` wiring in `adwInit.tsx` (two import lines + two lines in `main()`).
- The drafted block is **not** LLM-generated at init time — the agent chooses one of three checked-in blocks based on the classification result. This bounds output variance and keeps the BDD structural-conformance assertion stable across framework iterations.
- **Blocked by slice #507** (`feature-nnny1e-vocabulary-template-and-flags`): if the template-copy bullet has not run first, there is no placeholder to replace and the drafting sub-step skips.
- The **fallback** classification (no parseable manifest) is described in the prompt but has no dedicated BDD scenario in this slice; the binary browser/CLI split is expected to cover the vast majority of repos.
- Backporting to existing target repos that pre-date this slice is explicitly out of scope; an `adwUpgrade`-style mechanism would be needed.
