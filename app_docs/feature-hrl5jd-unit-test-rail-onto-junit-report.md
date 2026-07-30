# Unit Test Verdict Rail (JUnit-Report-Keyed)

## Overview

The unit-test phase (`adws/phases/unitTestPhase.ts`) derives a pass/warn/hard-fail verdict purely from JUnit report presence and content — never from dependency or framework sniffing. `computeTestVerdict` (`adws/core/testVerdict.ts`) is the single pure branch table that decides the outcome, and `formatWorkflowComment('unverified'|'error', ctx)` (`adws/github/workflowCommentsIssue.ts`) is the only place that turns a verdict into issue-facing prose. This module exists so a target repo whose test runner doesn't emit a readable JUnit report gets flagged (`adw:unverified`) without blocking the PR, while a report that proves zero testcases ran hard-fails the workflow outright.

## Responsibilities

- `computeTestVerdict({ enabled, reportPresent, hasFailures, testcaseCount })` maps the four boolean/count inputs to `'pass' | 'warn' | 'hard-fail'` plus a machine-readable `reason` string, in guard-clause order:
  1. `!enabled` → `pass` ("unit tests disabled")
  2. `!reportPresent` → `warn` ("no JUnit report emitted — marking unverified") — the **sole** producer of the `adw:unverified` label/comment from this phase
  3. `hasFailures` → `hard-fail` ("unit tests failed")
  4. `testcaseCount === 0` → `hard-fail` ("zero testcases ran but a JUnit report was emitted — discovery break")
  5. else → `pass`
- `executeUnitTestPhase` (`unitTestPhase.ts`) wires the rail end-to-end: sets `ADW_UNIT_TEST_REPORT_PATH`, runs `runUnitTestsWithRetry` (`adws/agents/testRetry.ts`), calls `computeTestVerdict`, and dispatches on the outcome:
  - `hard-fail` → posts the `'error'` stage comment, writes failed execution state, `process.exit(1)` — no PR.
  - `warn` → applies `ADW_UNVERIFIED_LABEL`, posts the `'unverified'` stage comment via `postIssueStageComment`; failures to label are swallowed (non-fatal, mirrors `stackCoherenceReporter`).
  - `pass` → logs success, phase continues to PR creation.
- `readJUnitReport(filePath)` (`adws/core/testReportParser.ts`) is the sole `reportPresent` source: returns `null` both when the file is absent (`fs.existsSync` guard) and when it exists but throws on parse (`catch`, which logs `[testReportParser] Failed to parse JUnit report at …`) — both collapse to the same `!reportPresent` branch.
- `formatUnverifiedComment` (`workflowCommentsIssue.ts`) renders the `'unverified'` comment body: title `## :warning: ADW Unverified — No JUnit Report Emitted`, names `$ADW_UNIT_TEST_REPORT_PATH` and `## Run Tests`, covers both the never-written and unparseable-report cases, and points at concrete JUnit-emission flags (vitest, cucumber-js, pytest) instead of the unrelated `## Test Framework` key.
- `formatStackIncoherentComment` is the sibling comment for a *different* condition (mis-detected stack, `adw_init` fell back to `cucumber-js`) and is the one place `## Test Framework` guidance still belongs — do not conflate the two.

## Contracts & Invariants

- `computeTestVerdict` is pure and I/O-free — directly unit-testable, no network or filesystem access.
- `reportPresent` never distinguishes "file missing" from "file present but unparseable" — callers (including comment copy) must describe both, not just one.
- A `warn` verdict is **only** reachable via `!reportPresent`. A report that *is* present with `testcaseCount === 0` is always `hard-fail`, never `warn` — the unverified comment must never claim "zero testcases ran".
- `formatUnverifiedComment` makes no claim about dependency/framework detection — that input (`frameworkDetected`) was removed from `TestVerdictInput` when the verdict moved onto the report-presence rail; the comment must not resurrect it.
- Marking `adw:unverified` (label + comment) is always non-fatal to the workflow — labeling failures (e.g. app-token lacking write permission) are caught and logged, never crash the phase.
- The `'unverified'` and `'error'` `WorkflowStage` literals (`adws/types/workflowTypes.ts`) are unaffected by comment-copy changes; renaming either would ripple into `stageClassifier.ts` and persisted state.

## Configuration

- `ADW_UNIT_TEST_REPORT_PATH` — env var set by `unitTestPhase.ts` to `agents/<adwId>/logs/junit-unit.xml`; the runner named in `## Run Tests` (`.adw/commands.md`) must emit JUnit XML to this path for `reportPresent` to be true.
- `## Run Tests` in `.adw/commands.md` — the command `unitTestPhase.ts` invokes; the unverified comment's "Next steps" point here, not at `## Test Framework`.
- `commands.testFramework` (`## Test Framework` in `.adw/commands.md`) — consumed **only** by `stackCoherenceCheck` (`adws/phases/stackCoherenceReporter.ts`), not by the unit-test verdict or its comment.
- `.github/adw.yml` `unitTests: false` opts a repo out of the unit-test phase entirely (default: enabled).

## Gotchas

- Comment copy drifts silently: there is no BDD scenario or test file asserting the `'unverified'` comment body's *text* by default — `adws/github/__tests__/workflowCommentsIssue.test.ts` is the regression guard added for issue #770, including a coupling test that drives real `computeTestVerdict` input through the comment formatter so a future re-key of the branch table fails loudly instead of silently drifting.
- Do not add a "this is not a zero-testcase result" negation to the unverified comment — repeating "zero testcase" phrasing in the one comment that must never claim it re-seeds the exact confusion being fixed.
- The comment names the **env var name** (`$ADW_UNIT_TEST_REPORT_PATH`), not the resolved absolute path — the resolved value is host-internal and meaningless to a repo owner reading a GitHub comment.
- `.claude/commands/adw_init.md` (which seeds `## Run Tests` with JUnit flags per language) is a `hashInputs:` file — editing it raises `.adw-version` and triggers an `adwUpgrade` regen sweep across every registered target repo; avoid touching it for comment-copy-only fixes.
