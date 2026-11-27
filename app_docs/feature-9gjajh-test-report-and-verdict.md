# Test Report & Verdict

## Overview

This module parses JUnit XML test reports and maps their results to structured verdicts used by the ADW orchestration pipeline. It separates I/O (reading report files), parsing (XML to typed data), and verdict logic (pure decision functions) into three distinct layers. It also flags cucumber's undefined and pending scenarios as `incomplete`, which the scenario proof uses to fail a run that left step definitions unwritten.

## Responsibilities

- Parses JUnit XML files (both `<testsuites>` wrapper and bare `<testsuite>` root forms) into a typed `TestReport` structure with per-case status and failure messages.
- Classifies each `<testcase>` as `passed`, `failed`, or `skipped`, applying Cucumber-specific rules: a bare `<failure/>` or `<error/>` element with no attributes and no text maps to `skipped`, not `failed`, and sets the case's `incomplete` flag (an UNDEFINED or PENDING scenario).
- Counts `incomplete` cases into `TestReport.incomplete`; those cases are also counted in `skipped`, so unit-test counts and verdicts are unaffected.
- Extracts failure messages from `<failure message="...">` attributes, text-body failures, or `#text` nodes produced by `fast-xml-parser`.
- Computes a unit-test verdict (`pass` / `warn` / `hard-fail`) from four signals — `enabled`, `reportPresent`, `hasFailures`, `testcaseCount` — via a guard-clause branch table: disabled → `pass`; no report → `warn`; failures present → `hard-fail`; report present but zero testcases → `hard-fail`; otherwise → `pass`. Each verdict carries a machine-readable `reason` string alongside the `pass`/`warn`/`hard-fail` outcome.
- Computes a resolve verdict (`pass` / `retry` / `hard-fail`) from target-test pass, regression-test pass, optional post-resolve alignment, and whether retry budget remains.

## Contracts & Invariants

- `parseJUnitXml` returns `null` for empty input or invalid XML; it never throws on bad input.
- `readJUnitReport` returns `null` for a missing file or a read/parse-level error; it logs to console only in the latter case, not on absence.
- The `reportPresent` signal this produces therefore never distinguishes "file missing" from "file present but unreadable" — any caller that surfaces a verdict to a user must describe both possibilities, not just one.
- `testcase` and `testsuite` elements are always treated as arrays by the XML parser, so single-element suites parse correctly without special-casing.
- Entity-expansion limits are set to `Infinity` because JUnit reports come from the project's own test runner, not untrusted input. Large suites with XML entities in test names or `<system-out>` blocks do not trip the fast-xml-parser billion-laughs guard.
- Every `TestCaseResult` carries `incomplete: boolean` and every `TestReport` carries `incomplete: number`; hand-built literals in tests must set both. A genuine `<skipped/>` is never `incomplete`.
- The scenario proof (`adws/proof/proofAssembler.ts` `reportedOutcome`) fails a tag whose report has `incomplete > 0` when the run exited non-zero, with the warning "… scenario(s) have an undefined or pending step and the run exited N: write the missing step definitions". A failed blocker tag enters the scenario fix loop (`runScenarioTestFixLoop` → `executeScenarioFixPhase`). This is the only check for undefined steps: the builder (`/implement-tdd`) writes every step definition, and there is no separate step-definition phase.
- A clean report (`failed === 0`, `incomplete === 0`) from a run that exited non-zero still passes, with a warning that keeps post-suite noise in the proof's Output section.
- `computeTestVerdict` is a pure function with no I/O; it is directly unit-testable.
- `computeTestVerdict` treats a report present with zero test cases as `hard-fail` (discovery break), not `warn` — `warn` is reachable only through the `!reportPresent` branch.
- `computeTestVerdict` treats a disabled test suite as `pass` regardless of any other signals.
- `TestVerdictInput` carries exactly those four report-presence-rail signals — there is no dependency/framework-detection field. A mis-detected test stack is a separate, sibling concern and must not be folded back into this input shape.
- `computeResolveVerdict` is a pure function; it returns `retry` only when both target and regression suites are not green and budget remains.
- `postResolveAligned === false` (explicitly false, not `undefined`) forces `hard-fail` even when both test suites pass.

## Configuration

No configuration. The XML parser is module-level and fixed. Callers supply file paths, XML strings, or signal structs directly.

## Gotchas

- Cucumber's JUnit formatter emits a bare `<failure/>` for PENDING and UNDEFINED scenarios (cucumber gives no message or exception for them). The parser maps them to `skipped` + `incomplete`, never `failed`; failing them is the proof assembler's job, keyed on the exit code.
- Cucumber exits non-zero for an undefined step always, but for a pending step only under `strict` (the default). Because the proof rule requires a non-zero exit, a pending scenario in a non-strict run still passes — the rule mirrors the runner's own verdict.
- `failureMessage` is only populated for `status === 'failed'` cases; skipped cases with a bare failure marker carry no message even if the marker technically contained text.
- `postResolveAligned` is optional: `undefined` (signal absent) is treated as aligned and does not block a `pass`. Only `false` (signal explicitly negative) triggers `hard-fail`.
- The `passed` count in `TestReport` is derived as `total - failed - skipped`, not read from JUnit attributes; attribute-level counts are ignored entirely.
- `readJUnitReport` uses `fs.existsSync` before reading, so callers cannot distinguish a race where the file disappears between the existence check and the read — both cases return `null`.

## Decisions

- [ADR-0043](../docs/adr/0043-multi-language-test-seam.md) — Multi-language test seam: detected descriptor, Gherkin mandate, JUnit report rail
- [ADR-0067](../docs/adr/0067-scenarios-prove-only-behaviour-at-a-declared-real-boundary.md) — Scenarios prove only behaviour at a declared real boundary, one per acceptance criterion; unit tests are not paired with them
