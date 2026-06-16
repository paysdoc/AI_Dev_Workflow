# Polymorphic Step-Def Descriptor-Driven Generation

**ADW ID:** bfdyaj-polymorphic-step-def
**Date:** 2026-06-16
**Specification:** specs/issue-579-adw-bfdyaj-polymorphic-step-def-sdlc_planner-descriptor-driven-generation.md

## Overview

This feature makes ADW's BDD generation fully language-agnostic by making the two generation prompts polymorphic on a `## BDD Framework` / `## Step Def Directory` descriptor in `.adw/scenarios.md`. Before this change, generation was hardcoded to cucumber-js / TypeScript; now any Gherkin-based runner (pytest-bdd, behave, godog, cucumber-rs, cucumber-ruby, …) is supported with zero framework code change per language. The descriptor is detected and emitted by `adw_init`, consumed at generation time, and enforced as a strict Gherkin-only invariant throughout the pipeline.

## What Was Built

- **Polymorphic `generate_step_definitions.md`** — reads `## BDD Framework` and `## Step Def Directory` from `.adw/scenarios.md` and emits idiomatic step definitions (import mechanism, file extension, assertion style) for the named framework. Backward-compatible: absent sections default to `cucumber-js` / `features/step_definitions`.
- **Cucumber-bootstrap removal from `scenario_writer.md`** — deleted Step 2 ("Detect or bootstrap E2E tool") and the `## Run E2E Tests` read; added an explicit Gherkin mandate section: scenarios are always `.feature` files and runner installation never happens here.
- **Loud fallback in `adw_init.md`** — when `adw_init` cannot identify a Gherkin runner for a recognised non-JS/TS stack (or an unrecognised stack) and falls back to `cucumber-js`, it now applies the `adw:unverified` label and posts an issue comment. TS/JS targets never trigger the flag.
- **`adws/README.md` alignment** — replaced the "Scenario file format resolution" / bootstrap wording with the Gherkin-always + `## BDD Framework` / `## Step Def Directory` description; added field reference docs with defaults.
- **`cucumber-ruby` unit-test gap closed** — `adws/core/__tests__/stepDefDetection.test.ts` now covers `cucumber-ruby → ['.rb']`.
- **`@adw-579` BDD regression guard** — per-issue Gherkin feature + TypeScript step definitions that assert the descriptor-seam contract through `parseScenariosMd`, `loadProjectConfig`, `stepDefExtensionsFor`, and `hasStepDefinitions` against temp-dir fixtures.

## Technical Implementation

### Files Modified

- `.claude/commands/generate_step_definitions.md`: rewritten to read `## BDD Framework` + `## Step Def Directory`, added "Polymorphism on the BDD framework" subsection with per-framework import/extension/assertion guidance, made verification framework-conditional.
- `.claude/commands/scenario_writer.md`: removed Step 2 (cucumber-bootstrap-on-N/A), added Gherkin mandate section, renumbered steps, reduced polymorphism branches from three to two.
- `.claude/commands/adw_init.md`: added `adw:unverified` flag path (non-JS/TS or unrecognised stack falls back to cucumber-js and signals via label + issue comment); added BDD framework decision to Step 8 report. This file is a `hashInputs:` entry — editing it raises `.adw-version` and triggers `adwUpgrade` across registered targets.
- `adws/README.md`: replaced `## Run E2E Tests` bullet and "Scenario file format resolution" subsection with descriptor-driven Gherkin-always description; added `## BDD Framework` / `## Step Def Directory` field reference.
- `adws/core/__tests__/stepDefDetection.test.ts`: added `cucumber-ruby → ['.rb']` case.
- `adws/core/__tests__/testVerdict.test.ts` / `adws/core/testVerdict.ts`: minor fixes (unit-test discovery downgrade to warn).

### New Files

- `features/per-issue/feature-579.feature`: `@adw-579` scenarios asserting backward-compat defaults (empty descriptor → cucumber-js/`.ts`) and non-TS descriptor flow (`pytest-bdd` + `features/steps` → `.py` detection).
- `features/per-issue/step_definitions/feature-579.steps.ts`: step definitions driving `parseScenariosMd` / `loadProjectConfig` / `stepDefExtensionsFor` / `hasStepDefinitions` against temp-dir fixtures.
- `specs/issue-579-adw-bfdyaj-polymorphic-step-def-sdlc_planner-descriptor-driven-generation.md`: feature specification.

### Key Changes

- **Single polymorphic prompt, no per-language code.** Generation keys entirely on the `bddFramework` string + Claude's knowledge of that framework — no enum, no per-language prompt file, no code provider.
- **Gherkin mandate is load-bearing.** The promotion / per-issue-sweep / vocabulary pipeline is wired to `.feature`; `scenario_writer` enforces this for every language and `adw_init` never emits a non-Gherkin `bddFramework`.
- **Loud unverified signal.** The `adw:unverified` flag is conservative: it fires only on the non-recognition fallback, never on a normal TS→cucumber-js default, so false positives are avoided.
- **`adw_init.md` is a hash input.** Editing it raises `.adw-version` → `adwUpgrade` regenerates `.adw/` across all registered target repos — the intended propagation for the BDD-framework emission.
- **Residual per-language touch-point.** The *generation* path is zero-code-per-language. The one remaining per-language site is `stepDefExtensionsFor`'s extension map (used for step-def *detection* in `scenarioProof`). It already covers every language named in the issue; a brand-new unlisted language defaults to `.ts` detection (proof skips rather than false-passes).

## How to Use

1. **Point `adw_init` at a target repo.** It detects the primary language, identifies a Gherkin runner (e.g. `pytest-bdd` for Python), and writes `## BDD Framework: pytest-bdd` + `## Step Def Directory: features/steps` into `.adw/scenarios.md`. If it cannot identify a runner, it falls back to `cucumber-js` and applies `adw:unverified`.
2. **Run `/scenario_writer`.** Scenarios are always written as Gherkin `.feature` files — no runner is installed or configured by this step.
3. **Run `/generate_step_definitions`.** The agent reads `## BDD Framework` and `## Step Def Directory`, emits idiomatic step defs for the named framework (correct imports, file extension, assertion style), and writes them to the configured directory.
4. **Scenario test phase runs as the correctness guardrail.** `scenarioTestPhase` / `scenarioProof` already consume `bddFramework` and `stepDefDirectory` (delivered by blocker #578) to detect step defs by the correct extension and run the configured runner.

For TypeScript repos with no descriptor: all defaults apply (`cucumber-js`, `features/step_definitions`, `.ts`), and behavior is identical to before this change.

## Configuration

All configuration lives in `.adw/scenarios.md`:

| Section | Default | Description |
|---|---|---|
| `## BDD Framework` | `cucumber-js` | Named Gherkin step-def runtime. Only Gherkin-based runners are valid. |
| `## Step Def Directory` | `features/step_definitions` | Directory where step-def files are written and scanned. |

`adw_init` emits these sections. They can be manually corrected in `.adw/scenarios.md` if auto-detection was wrong (clear the `adw:unverified` label after correcting).

## Testing

```bash
# Unit tests (covers stepDefDetection + projectConfig parsing)
bun run test:unit

# Per-issue descriptor-seam regression guard
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-579"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Type and lint checks
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run build
```

Manual / fix-forward: point `/adw_init` at a Python/pytest-bdd repo and confirm `.adw/scenarios.md` gets `## BDD Framework: pytest-bdd` (no `adw:unverified`), then confirm `/scenario_writer` writes `.feature` and `/generate_step_definitions` emits `.py` step defs under the configured directory.

## Notes

- **`adw_init.md` hash propagation.** Editing this file raises `.adw-version` → `adwUpgrade` regenerates `.adw/` across all registered targets. No new parsed field is introduced (emission of `## BDD Framework` / `## Step Def Directory` already shipped in #578).
- **Adding a new language.** The generation path requires zero code change. The only residual touch-point for a brand-new unlisted language is adding its extension to `stepDefExtensionsFor` in `adws/core/stepDefDetection.ts` so step-def detection works at proof time. Making the extension itself descriptor-driven (`## Step Def Extensions`) is a possible follow-up but is out of scope here.
- **Non-Gherkin frameworks are permanently out of scope.** The Gherkin coupling is load-bearing (promotion / per-issue-sweep / vocabulary parsers). `adw_init` must never emit a non-Gherkin `bddFramework`; there is no configuration to override this.
