# Fix JUnit Entity-Expansion Limit on Large Reports

**ADW ID:** 19me6a-large-green-junit-re
**Date:** 2026-06-19
**Specification:** specs/issue-623-adw-19me6a-large-green-junit-re-sdlc_planner-fix-junit-entity-expansion-limit.md

## Overview

Large all-green JUnit reports were being falsely marked `adw:unverified` because `fast-xml-parser`'s billion-laughs DoS guard threw `Entity expansion count limit exceeded` when parsing reports with more than ~1000 XML entity references. The throw was silently swallowed to `null` by `readJUnitReport`, making a present, valid, all-green report indistinguishable from an absent report. This fix pins `maxTotalExpansions: Infinity` on the module-level parser and upgrades the bare `catch` to log on parse failure.

## What Was Built

- **Parser entity-limit pin** — `processEntities: { maxTotalExpansions: Infinity, maxEntityCount: Infinity }` added to the module-level `XMLParser` in `adws/core/testReportParser.ts`; entity decoding (`&gt;` → `>`) is preserved
- **Diagnostic logging in `readJUnitReport`** — bare `catch {}` upgraded to `catch (err)` with a `console.error` so "report present but failed to parse" is distinguishable from "report absent"
- **Large-report acceptance tests** — three new tests in `testReportParser.test.ts` covering the bare `<testsuite>` shape, the vitest `<testsuites>` wrapper shape, and a version-independent load-bearing proof

## Technical Implementation

### Files Modified

- `adws/core/testReportParser.ts`: Added `processEntities` object to module-level `XMLParser`; upgraded `catch {}` → `catch (err)` with `console.error` in `readJUnitReport`
- `adws/core/__tests__/testReportParser.test.ts`: Added three tests — large-report acceptance, load-bearing proof, and vitest-shaped large report with `<system-out>` and five entity types

### Key Changes

- **Root cause**: `fast-xml-parser` accumulates entity-expansion counts cumulatively per document. Predefined entities (`&gt;`, `&amp;`, `&apos;`, `&quot;`, `&lt;`) all count toward `maxTotalExpansions`. A 1380-testcase suite with entities in names and `<system-out>` blocks exceeds the historical default of 1000.
- **Fix is a version-independent pin**: `fast-xml-parser@5.9.0` happens to default to `Infinity`, but transitive version skew (the lockfile already contains `fast-xml-parser@5.5.8` under `@aws-sdk/xml-builder`) could silently reintroduce the bug. The explicit pin makes behaviour deterministic.
- **`XMLValidator.validate` guard is untouched**: malformed/truncated XML still returns `null` before `parser.parse()` is called, so raising the entity limits does not weaken the malformed-input contract.
- **Verdict semantics unchanged**: `computeTestVerdict` / `testVerdict.ts` and `unitTestPhase.ts` are not modified — the report now actually parses, so `reportPresent: true` flows naturally to the existing `pass` verdict.
- **Load-bearing test**: a local `XMLParser` with `maxTotalExpansions: 1000` over the same 1500-entity input asserts it throws `Entity expansion count limit exceeded`; `parseJUnitXml` over the same input asserts it returns non-null. This makes the RED→GREEN delta explicit regardless of the installed `fast-xml-parser` default.

## How to Use

No API or configuration changes. The fix is transparent — the parser now handles large JUnit reports correctly without any caller changes.

To verify a large JUnit report parses correctly:

1. Ensure the target repo's test runner emits a JUnit report to `$ADW_UNIT_TEST_REPORT_PATH`
2. Run a unit-test-gated ADW workflow against a large test suite (>1000 testcases with entities in names or `<system-out>`)
3. Confirm the phase logs "Unit tests passed!" without a subsequent "no JUnit report emitted — marking unverified" contradiction

## Configuration

No configuration changes. `fast-xml-parser@^5.9.0` already provides the object-form `processEntities` API used by this fix.

## Testing

```bash
# Run just the parser test file (includes new large-report tests)
bunx vitest run adws/core/__tests__/testReportParser.test.ts

# Full unit test suite — confirms no regressions
bun run test:unit
```

The three new test cases are:
- `parses without throwing when entity-expansion count exceeds 1000` — 500 testcases × 3 entity refs = 1500 total; bare `<testsuite>` shape
- `limit override is load-bearing — local finite-ceiling parser throws, module parser does not` — version-independent proof
- `parses a vitest-shaped large report (testsuites wrapper, system-out, apos/quot entities)` — 350 testcases with `<system-out>` blocks; `<testsuites>` wrapper shape

## Notes

- **Security**: raising the entity-expansion ceiling is safe because JUnit reports come from our own test runner, not untrusted input. The `XMLValidator` guard still rejects malformed XML before parsing.
- **Version nuance**: the installed `fast-xml-parser@5.9.0` already defaults `maxTotalExpansions` to `Infinity`, so the bug does not reproduce on a fresh install today. The explicit pin guards against transitive downgrades (e.g. `@aws-sdk/xml-builder` pins `5.5.8` in the same lockfile).
- **Only two files change**: `adws/core/testReportParser.ts` and `adws/core/__tests__/testReportParser.test.ts` — no dependency changes, no new modules.
