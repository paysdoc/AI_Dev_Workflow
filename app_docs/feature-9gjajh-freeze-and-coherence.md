# Freeze Guards & Stack Coherence

## Overview

This module enforces two complementary safety invariants during ADW workflows: it prevents `.feature` file mutations during conflict resolution (freeze guard), and it detects incoherent test stack configurations before a build begins (stack coherence). Together they protect the Gherkin BDD contract that ADW's promotion, per-issue-sweep, and vocabulary subsystems depend on.

## Responsibilities

- **Freeze guard** (`resolveFreezeGuard.ts`): inspects a list of changed file paths and blocks any edit that touches a `.feature` file, returning a verdict with the flagged path.
- **Stack coherence check** (`stackCoherenceCheck.ts`): validates that `testFramework`, `bddFramework`, `runTests`, and `runScenariosByTag` all resolve to the same runtime language; emits a `language-mismatch` warning when they diverge.
- **Gherkin mandate check** (`stackCoherenceCheck.ts`): rejects any non-empty `bddFramework` value that is not a recognized Gherkin-based runner, emitting a `non-gherkin-bdd` warning.
- **Step definition detection** (`stepDefDetection.ts`): maps a BDD framework name to its expected file extensions, walks a step definition directory recursively, and reports whether any matching files exist.
- **Framework classification** (`stepDefDetection.ts`): exposes `isGherkinFramework()` so callers can distinguish recognized Gherkin runners from unknown or unit-test-only frameworks.

## Contracts & Invariants

- `evaluateResolveEdit` returns `permitted: false` for **any** path ending in `.feature`, regardless of directory depth or other file changes in the same set.
- `stackCoherenceCheck` returns `ok: true` only when `warnings` is empty; callers must not bypass this result.
- Language inference uses an ordered token list; longer, more-specific tokens appear before shorter, generic ones (e.g., `cucumber-js` before `cucumber`, `cargo` before `go test`) to prevent prefix-collision false matches.
- An empty `bddFramework` string is treated as the default `cucumber-js` (Gherkin); `isGherkinFramework('')` returns `true`.
- `stepDefExtensionsFor` falls back to `['.ts']` for any unrecognized framework name, preserving existing cucumber-js/TypeScript behavior.
- `hasStepDefinitions` returns `false` if the resolved directory does not exist; directory-read errors are silently skipped rather than thrown.

## Configuration

No configuration. Framework-to-extension mappings and language token tables are compiled into the module. The BDD framework name passed in at call time drives all branching.

## Gotchas

- The `language-mismatch` warning fires when **any two** of the four input fields resolve to different languages. A project using `jest` for unit tests alongside `cucumber-js` for BDD will produce a false-positive warning unless both fields agree on JavaScript tokens — in practice, `testFramework` and `bddFramework` should both carry JS-identifying strings.
- `adw_init` defaults to `cucumber-js` when it cannot recognize the BDD runner; this may silently suppress a `non-gherkin-bdd` warning even if the real runner is non-Gherkin. Verify `.adw/commands.md` and `.adw/scenarios.md` manually if the stack looks wrong.
- The freeze guard operates on path strings only — it does not check file content or git status. A renamed `.feature` file or a path constructed with a non-standard extension will not be caught.
- `hasStepDefinitions` performs a synchronous recursive directory walk on every call; avoid calling it in hot loops on large trees.
- `cargo` is listed before `go test` in the language token table specifically because the string `"cargo test"` contains `"go test"` as a substring; reordering these entries would cause Rust commands to be misidentified as Go.
