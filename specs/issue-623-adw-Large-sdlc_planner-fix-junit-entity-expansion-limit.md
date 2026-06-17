# Bug: Large green JUnit reports falsely marked adw:unverified (entity-expansion limit)

## Metadata
issueNumber: `623`
adwId: `Large`
issueJson: `{}`

## Bug Description
A fully-green unit-test suite (~1380 testcases, 0 failures) is marked `adw:unverified` with the comment "no JUnit report emitted — marking unverified", even though the test runner wrote a valid JUnit XML report to `$ADW_UNIT_TEST_REPORT_PATH`. The two log lines on the same run contradict each other: `unit tests passed!` immediately followed by `Unit tests unverified: no JUnit report emitted`.

## Problem Statement
`fast-xml-parser` v5's `XMLParser.parse()` throws `Entity expansion limit exceeded: <n> > 1000` when parsing large JUnit reports that contain many standard XML entities (`&gt;`, `&amp;`, `&apos;`, `&lt;`, `&quot;`) in testcase names or `<system-out>` bodies. The bare `catch { return null }` in `readJUnitReport` silently swallows the throw, making the caller indistinguishable from "file absent". The test verdict then maps `null` to `warn` ("unverified").

## Solution Statement
Raise `maxTotalExpansions` in the `XMLParser` constructor options to a value large enough for our largest expected JUnit reports. Because these reports are emitted by our own trusted test runner (not untrusted input), the DoS guard can be safely increased. Setting `maxTotalExpansions` to `Infinity` disables the cap entirely; a concrete large constant (e.g. `1_000_000`) is a safer alternative that preserves the guard against genuinely adversarial input while accommodating any realistic test suite.

No changes to `computeTestVerdict`, `unitTestPhase`, or label semantics are needed — the fix must live in the parser so the report actually parses to a non-null value.

## Steps to Reproduce
1. Run `bun run test:unit` in a target repo with ~1000+ testcases whose names or output bodies contain XML entities (`&gt;`, `&amp;`, etc.).
2. The phase logs `unit tests passed!` (exit 0) and writes a valid JUnit XML to `$ADW_UNIT_TEST_REPORT_PATH`.
3. `readJUnitReport` calls `parseJUnitXml`, which calls `parser.parse()` → throws `Entity expansion limit exceeded`.
4. The exception is swallowed; `readJUnitReport` returns `null`.
5. The unit-test phase treats `null` as "no report" and applies `adw:unverified`.

## Root Cause Analysis
`adws/core/testReportParser.ts` (line 20–24) creates a module-level `XMLParser` singleton without specifying `maxTotalExpansions`. The `fast-xml-parser` v5 default is `1000`. Predefined XML entities in testcase names and `<system-out>` blocks each count toward this limit; a ~1380-testcase report with common entities exceeds 1000 trivially.

`readJUnitReport` (lines 113–121) wraps the parse in a bare `try { … } catch { return null }`, giving the caller no way to distinguish "file absent" from "parse threw". The throw from `parser.parse()` is silently promoted to `null`.

## Relevant Files

- `adws/core/testReportParser.ts` — contains the `XMLParser` singleton (line 20–24) where `maxTotalExpansions` must be set, and `readJUnitReport` (lines 113–121) where the silent catch swallows parse errors.
- `adws/core/__tests__/testReportParser.test.ts` — unit tests for `parseJUnitXml` and `readJUnitReport`; the new regression test goes here.

## Step by Step Tasks

### 1. Write the failing RED test
Add a new `describe` block in `adws/core/__tests__/testReportParser.test.ts`:

- Generate a synthetic `<testsuite>` with at least 200 `<testcase>` elements whose `name` attributes contain multiple XML entities (e.g. `name="test &gt; 0 &amp;&amp; x &lt; 10"`). At ~6–8 entities per name × 200 cases = 1200–1600 expansions, this reliably exceeds the default limit of 1000.
- Assert that `parseJUnitXml(xml)` returns a non-null `TestReport` with `total === 200`, `passed === 200`, `failed === 0`, `skipped === 0`.
- This test must fail (return `null`) on the current code to confirm the RED state.

### 2. Fix the parser options in `testReportParser.ts`
In `adws/core/testReportParser.ts`, update the `XMLParser` constructor (lines 20–24) to add `maxTotalExpansions: 1_000_000`:

```ts
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'testcase' || name === 'testsuite',
  maxTotalExpansions: 1_000_000,
});
```

This value accommodates any realistic JUnit report (even a 100,000-testcase suite with 10 entities per name) while retaining a guard against genuine billion-laughs XML.

### 3. Verify the RED test is now GREEN
Re-run the unit tests to confirm the new large-report test passes after the fix, and all pre-existing tests continue to pass.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

```sh
# Run unit tests (includes the new regression test)
bun run test:unit

# Type-check the fix
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint
```

## Notes
- No new dependencies are required. `maxTotalExpansions` is a native `fast-xml-parser` v5 option.
- The fix is a single-line change to the parser constructor; no other files need to change.
- The silent `catch { return null }` in `readJUnitReport` is intentional for file-read errors (e.g. permission denied), so it is left in place. The root symptom (parse throwing) is resolved by the parser option change, making the catch irrelevant to this case.
- Strictly adhere to `.adw/coding_guidelines.md`: guard clauses, no `any`, no mutation.
