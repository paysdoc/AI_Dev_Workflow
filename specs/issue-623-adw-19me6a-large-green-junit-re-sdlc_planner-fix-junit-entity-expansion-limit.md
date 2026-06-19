# Feature: Fix large green JUnit reports falsely marked `adw:unverified` (entity-expansion limit)

## Metadata
issueNumber: `623`
adwId: `19me6a-large-green-junit-re`
issueJson: `{"number":623,"title":"Large green JUnit reports falsely marked adw:unverified (entity-expansion limit)","body":"## Summary\n\nA fully-green unit-test suite is being marked `adw:unverified` with the comment\n\"no JUnit report emitted — marking unverified\", even though the test runner DID\nwrite a valid JUnit report and every test passed. The verdict is wrong: the suite\nis green, but ADW reports it as unverified.\n\n## Observed behaviour\n\n- The unit-test phase runs `bun run test:unit` (vitest), which writes a valid JUnit\n  XML report (~1380 testcases, 0 failures) to `$ADW_UNIT_TEST_REPORT_PATH`.\n- The phase nonetheless logs `Unit tests unverified: no JUnit report emitted` and\n  applies the `adw:unverified` label.\n- The two log lines on the same run contradict each other: `unit tests passed!`\n  immediately followed by `Unit tests unverified: no JUnit report emitted`.\n\n## Root cause\n\nIn `adws/core/testReportParser.ts`:\n\n- `parseJUnitXml` parses the report with `fast-xml-parser`. On a large report,\n  `parser.parse()` THROWS `Entity expansion limit exceeded: <n> > 1000`. This is\n  fast-xml-parser v5's billion-laughs DoS guard (`maxTotalExpansions`, default\n  `1000`). Every predefined XML entity in the report (`&gt;`, `&amp;`, `&apos;`,\n  `&lt;`, `&quot;` — abundant in testcase names and embedded `<system-out>`) counts\n  toward that limit, so any sufficiently large suite exceeds it.\n- `readJUnitReport` wraps the parse in a bare `try { … } catch { return null }`.\n  The throw is silently swallowed to `null`.\n- The caller cannot distinguish \"report file absent\" from \"report present but\n  parse threw\" — both surface as `null`. The test phase reads `null` as\n  `reportPresent: false`, and `computeTestVerdict` maps that to the `warn`\n  (\"unverified\") outcome.\n\nNet effect: a present, valid, all-green report is treated as if no report existed.\n\nThese reports are produced by our own test runner, not untrusted input.\n\n## Required outcome\n\n- A large, all-green JUnit report parses successfully: `readJUnitReport` returns a\n  non-null `TestReport` with correct `total` / `passed` / `failed` / `skipped`\n  counts, and the unit-test phase verdict is `pass` (no `adw:unverified`).\n- Existing `testReportParser.ts` behaviour is preserved: entity decoding still works\n  (e.g. a `&gt;` in a failure message still decodes to `>`), bare `<failure/>`\n  pending markers still classify as skipped, `<testsuites>` and bare `<testsuite>`\n  shapes both still parse, and genuinely malformed / truncated XML still returns\n  `null`.\n\n## Required test (failing-first)\n\nAdd a unit test to `adws/core/__tests__/testReportParser.test.ts` that reproduces\nthis failure mode:\n\n- RED on the current code: a synthetic report large enough to trip the entity-\n  expansion limit causes `parseJUnitXml` / `readJUnitReport` to throw or return\n  `null`.\n- GREEN after the fix: that same large, all-green report parses to a non-null\n  `TestReport` with the correct counts.\n\nThis GREEN assertion is the acceptance guardrail — the fix is correct only if a\nlarge green report parses to a non-null green report.\n\n## Out of scope / leave to the implementer\n\nThis issue deliberately does NOT prescribe the fix mechanism — choose the\nappropriate approach so the required outcome and test above hold. Do not change the\nverdict semantics in `computeTestVerdict` to mask the symptom; the report must\nactually parse.\n\n\n## Blocked by\n\n- #624\n\n- #629","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-17T13:20:38Z","comments":[{"author":"paysdoc","createdAt":"2026-06-18T15:23:09Z","body":"## continue"}],"actionableComment":null}`

## Feature Description
ADW's unit-test phase derives its verdict (`pass` / `hard-fail` / `warn`) from a JUnit XML report written by the target repo's test runner. The report is read by `readJUnitReport` → `parseJUnitXml` in `adws/core/testReportParser.ts`, which uses `fast-xml-parser`. `fast-xml-parser` v5 ships a billion-laughs DoS guard that caps the number of XML-entity expansions per parsed document. On a build where that ceiling is finite, a large all-green suite (~1380 testcases, with `&gt;`/`&amp;`/`&apos;`/`&quot;`/`&lt;` entities in testcase names and embedded `<system-out>` blocks) accumulates more than the ceiling's worth of entity expansions, so `parser.parse()` throws `Entity expansion count limit exceeded: <n> > <limit>`.

`readJUnitReport` swallows that throw in a bare `catch { return null }`. Because a missing file *also* returns `null`, the unit-test phase cannot tell "report present but parse threw" apart from "no report emitted at all". It reads `null` as `reportPresent: false`, and `computeTestVerdict` maps `reportPresent: false` to the `warn` outcome — applying the `adw:unverified` label and posting "no JUnit report emitted — marking unverified", directly after logging "Unit tests passed!". The suite is green; ADW reports it as unverified.

The fix makes the parser robust to large reports from our own (trusted) test runner by explicitly raising `fast-xml-parser`'s entity-expansion limits to `Infinity` on the module-level parser, so a present, valid, all-green report always parses to a non-null `TestReport`. The bare `catch` is also upgraded to log the parse error, so a future parse failure is observable in logs instead of silently collapsing to the "absent" path. The verdict logic in `computeTestVerdict` is **not** touched — the report genuinely parses; the symptom is not masked.

## User Story
As an ADW operator running unit-test-gated workflows against repos with large test suites
I want a large, fully-green JUnit report to parse correctly and be recognised as a passing report
So that a green suite is reported as `pass` and is never falsely labelled `adw:unverified`, and so that any real future parse failure is visible in logs rather than silently swallowed.

## Problem Statement
`parseJUnitXml` inherits `fast-xml-parser`'s entity-expansion ceiling. When that ceiling is finite, parsing a sufficiently large report throws; `readJUnitReport`'s bare `catch { return null }` collapses the throw into the same `null` returned for an absent file. The unit-test phase then treats a present, valid, all-green report as if no report existed, yielding a `warn` verdict and the `adw:unverified` label on a green suite. Two contradictory log lines result on the same run ("Unit tests passed!" followed by "no JUnit report emitted — marking unverified").

### Precise mechanics (verified against installed dependencies)
Research against the installed dependency versions established the exact, somewhat subtle, behaviour — important so the fix and test target the right thing:

- The entity-expansion counter lives in `@nodable/entities` (`EntityDecoder`), which `fast-xml-parser` delegates to. It is **cumulative across the whole document** (reset once per `parse()` call), not per attribute/text value. With `applyLimitsTo: "all"` (fast-xml-parser's default tier), **predefined** XML entities (`&gt; &amp; &apos; &quot; &lt;`) all count toward the limit. So a large report with more than `maxTotalExpansions` total entity refs throws — *if* that ceiling is finite.
- The error text is `[EntityReplacer] Entity expansion count limit exceeded: <n> > <maxTotalExpansions>` (the issue paraphrases this as "Entity expansion limit exceeded: <n> > 1000").
- **Version nuance:** the repo currently pins `fast-xml-parser@5.9.0` (see `bun.lock`) with `@nodable/entities@2.2.0`. In that build, `processEntities.maxTotalExpansions` normalises to a **default of `Infinity`**, so the guard never trips on a fresh install today — the bug was reported against a build whose default was finite (~1000). `maxEntityCount` defaults to `1000` but applies only to DTD `<!ENTITY>` *definitions* (our reports contain none). `maxExpandedLength` (default `100000`) does not trip on predefined entities because they shrink on decode (`&gt;` → `>`).
- **Implication:** the correct fix is a *version-independent pin* of the expansion limits, not reliance on the upstream default. A transitive downgrade, a default revert, or version skew (note `@aws-sdk/xml-builder` already pins `fast-xml-parser@5.5.8` in the same lockfile) could otherwise silently reintroduce the bug. It also means a unit test cannot be RED on the *current* installed baseline through this path; see the Testing Strategy for how the failing-first intent is satisfied in a durable, version-independent way.

## Solution Statement
Two focused, low-risk changes in `adws/core/testReportParser.ts`, with no change to verdict semantics:

1. **Pin the entity-expansion limits on the module-level `XMLParser`.** Pass `fast-xml-parser`'s object-form `processEntities` option to lift the expansion ceiling to `Infinity`, so large reports from our own test runner always parse. The object form keeps entity decoding *enabled* (so `&gt;` still decodes to `>`), and only removes the DoS ceiling:

   ```ts
   const parser = new XMLParser({
     ignoreAttributes: false,
     attributeNamePrefix: '@_',
     isArray: (name) => name === 'testcase' || name === 'testsuite',
     // JUnit reports come from our own test runner, not untrusted input.
     // Pin the entity-expansion limits so large suites (> 1000 entity
     // expansions across testcase names and <system-out>) never trip
     // fast-xml-parser's billion-laughs guard and get swallowed to null.
     // This is version-independent: it does not rely on the upstream default.
     processEntities: {
       maxTotalExpansions: Infinity, // load-bearing: cumulative per-document count
       maxEntityCount: Infinity,     // DTD <!ENTITY> definition ceiling (default 1000)
     },
   });
   ```

   `maxTotalExpansions: Infinity` is the load-bearing change (it is the cumulative-per-document expansion count that throws on large reports). `maxEntityCount: Infinity` is defensive — our reports have no DTD, but lifting it makes the "trusted, uncapped" intent total. `maxExpandedLength` need not be set (predefined entities shrink on decode and never trip it); it may optionally be added for completeness but is not required.

2. **Make `readJUnitReport` log on parse failure** so "report absent" and "report present but parse threw" are distinguishable in logs. Both still return `null` (callers unchanged), but the silent swallow — the reason this bug was invisible for a full run — is removed:

   ```ts
   } catch (err) {
     // Surface parse errors so callers can distinguish "report absent" from
     // "report present but failed to parse". Both return null; only the latter
     // logs — the fs.existsSync guard handles the absent case above.
     console.error(`[testReportParser] Failed to parse JUnit report at ${filePath}: ${err}`);
     return null;
   }
   ```

The existing structure of `parseJUnitXml` is preserved: the `XMLValidator.validate(xml) !== true` guard still returns `null` for genuinely malformed/truncated XML *before* parsing, so raising the entity limits does not weaken the malformed-input contract. `computeTestVerdict` / `adws/core/testVerdict.ts` and the unit-test phase are **not** modified — once the report parses, `reportPresent` becomes `true`, `hasFailures` is `false`, `testcaseCount > 0`, and the existing verdict table already returns `pass`.

> Note: the working tree for this issue already contains a candidate implementation of both changes (with `maxEntityCount` + `maxTotalExpansions` set to `Infinity`) and two large-report tests. This plan documents the authoritative intended end state and tightens the test contract (see Testing Strategy); the build phase should reconcile the working tree to this plan, in particular fixing the entity-count arithmetic in the existing large-report test and adding the version-independence proof.

## Relevant Files
Use these files to implement the feature:

- `adws/core/testReportParser.ts` — **primary change.** Holds the module-level `XMLParser` (add `processEntities` pin) and `readJUnitReport` (add error logging in the `catch`). `parseJUnitXml`'s `XMLValidator` guard and suite/case collection stay as-is.
- `adws/core/__tests__/testReportParser.test.ts` — **test change.** Add/repair the large-report tests (GREEN acceptance guardrail) and add a version-independent demonstration that the limit override is load-bearing. Keep all existing behaviour tests (entity decoding, bare `<failure/>` → skipped, `<testsuites>`/bare `<testsuite>`, malformed → null, single-testcase coercion, `failureMessage` extraction).
- `adws/core/testVerdict.ts` — **read-only / do-not-edit.** `computeTestVerdict` is the consumer that maps `reportPresent: false` → `warn`. Confirms the symptom path; must not be changed to mask it.
- `adws/agents/testRetry.ts` — **read-only context.** `runUnitTestsWithRetry` calls `readJUnitReport(unitReportPath)` and derives `reportPresent = finalReport !== null`, `hasFailures`, `testcaseCount`. Shows exactly how a parser-thrown `null` becomes `reportPresent: false`.
- `adws/phases/unitTestPhase.ts` — **read-only context.** `executeUnitTestPhase` calls `computeTestVerdict({ enabled, reportPresent, hasFailures, testcaseCount })`; the `warn` branch applies `ADW_UNVERIFIED_LABEL` and posts the "unverified" comment. End-to-end symptom site.
- `.adw/commands.md` — **read-only.** Source of the validation commands (`bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, `bun run build`) and confirms the test framework is `vitest`.
- `.adw/coding_guidelines.md` — **read-only.** Guidelines to adhere to (clarity, type safety, error handling at boundaries, files < 300 lines, declarative style). The logging-in-`catch` change aligns with "try-catch at system boundaries; provide meaningful error messages".
- `package.json` / `bun.lock` — **read-only context.** Confirm `fast-xml-parser: ^5.9.0` (resolved `5.9.0`) and transitive `@nodable/entities@2.2.0`; relevant to the version nuance above. No dependency change is required.

### Conditional Documentation
These app_docs match the conditions in `.adw/conditional_docs.md` for this task and should be read before implementing:

- `app_docs/feature-u3l5q0-junit-report-rail-migration.md` — directly covers `adws/core/testReportParser.ts` (`parseJUnitXml`, `readJUnitReport`) and the JUnit-report rail. **Primary reference.**
- `app_docs/feature-hrl5jd-unit-test-rail-onto-junit-report.md` — covers `adws/phases/unitTestPhase.ts`, `computeTestVerdict` (report-keyed verdict), `ADW_UNIT_TEST_REPORT_PATH`, and troubleshooting `adw:unverified` on the unit phase.
- `app_docs/feature-zyaojl-configurable-test-directory.md` — covers `computeTestVerdict` and the `adw:unverified` label/comment path (verdict-table context).

### New Files
None. The change is confined to the existing parser module and its existing test file. No new dependency, no new module.

## Implementation Plan
### Phase 1: Foundation
Confirm the precise failure mechanism and the constraint boundary before editing. Read the three conditional app_docs above and the `parseJUnitXml`/`readJUnitReport` flow. Establish the two facts the fix relies on: (a) `fast-xml-parser`'s `processEntities` accepts an object form (`boolean | ProcessEntitiesOptions`) whose `maxTotalExpansions` / `maxEntityCount` keys are real and typed in this version, and passing the object keeps `enabled: true` (decoding preserved); (b) the `XMLValidator.validate` guard runs before `parser.parse`, so the malformed-input → `null` contract is independent of the entity limits. Confirm that `computeTestVerdict` is off-limits.

### Phase 2: Core Implementation
Apply the two changes in `adws/core/testReportParser.ts`: add the `processEntities` pin to the `XMLParser` config, and upgrade `readJUnitReport`'s `catch` to log the error (still returning `null`). No other files change.

### Phase 3: Integration
Verify the change flows correctly through the consumers without editing them: `readJUnitReport` returns a non-null `TestReport` for a large green report → `runUnitTestsWithRetry` sets `reportPresent: true`, `hasFailures: false`, `testcaseCount > 0` → `computeTestVerdict` returns `pass` → `executeUnitTestPhase` logs "Unit tests passed!" and applies **no** `adw:unverified` label. Confirm via the unit tests for the parser and by reasoning over the (unchanged) verdict table; run the full validation suite for zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1 — Read context and confirm constraints
- Read `app_docs/feature-u3l5q0-junit-report-rail-migration.md`, `app_docs/feature-hrl5jd-unit-test-rail-onto-junit-report.md`, and `app_docs/feature-zyaojl-configurable-test-directory.md`.
- Re-read `adws/core/testReportParser.ts`, `adws/core/testVerdict.ts`, `adws/agents/testRetry.ts`, and `adws/phases/unitTestPhase.ts` to confirm the symptom path end-to-end.
- Confirm the hard constraint: **do not modify `computeTestVerdict` / `testVerdict.ts` or the unit-test phase verdict branches.**

### Step 2 — Write/repair the failing-first + acceptance tests (RED/GREEN)
- In `adws/core/__tests__/testReportParser.test.ts`, ensure the large-report acceptance test uses a report whose **total** predefined-entity expansions clearly **exceed 1000** (e.g. ≥ 600 testcases each carrying a `<system-out>` with ~5 entities, or otherwise ≥ ~1100 total entity refs). Fix the existing test whose comment claims "× 3 entity refs" but whose markup actually contains 2 per case (500 × 2 = 1000, which does not exceed the threshold). Assert the result is non-null with correct `total` / `passed` / `failed` (0) / `skipped` and that entity decoding is preserved (`&gt;` → `>`, `&amp;` → `&`). Cover both the bare `<testsuite>` shape and the `<testsuites>` wrapper (vitest) shape with `<system-out>`.
- Add a **version-independent load-bearing test**: in the test file, construct a *local* `new XMLParser({ …, processEntities: { maxTotalExpansions: 1000 } })` over the same large input and assert it **throws** `Entity expansion count limit exceeded` (this reproduces the original finite-ceiling failure deterministically, regardless of the installed default), then assert that the module's `parseJUnitXml` returns a **non-null** green report over the same input. This makes the RED→GREEN delta explicit and durable even though the installed `fast-xml-parser@5.9.0` default is permissive.
- Run only this file and confirm the new acceptance assertions express the intended contract: `bunx vitest run adws/core/__tests__/testReportParser.test.ts`.

### Step 3 — Apply the parser fix
- In `adws/core/testReportParser.ts`, add the `processEntities: { maxTotalExpansions: Infinity, maxEntityCount: Infinity }` option to the module-level `XMLParser`, with the explanatory comment from the Solution Statement (trusted input; version-independent pin). Do not change `ignoreAttributes`, `attributeNamePrefix`, or `isArray`.
- Keep the `XMLValidator.validate(xml) !== true` guard in `parseJUnitXml` exactly as-is so malformed/truncated XML still returns `null` before parsing.

### Step 4 — Improve `readJUnitReport` error visibility
- Change `readJUnitReport`'s `catch {` to `catch (err) {` and log `console.error(\`[testReportParser] Failed to parse JUnit report at ${filePath}: ${err}\`)` before `return null`. Behaviour for callers is unchanged (still `null`); only observability improves.

### Step 5 — Confirm no verdict-semantics drift
- Diff the change set and confirm only `adws/core/testReportParser.ts` and `adws/core/__tests__/testReportParser.test.ts` are touched (plus this spec). Confirm `testVerdict.ts` and `unitTestPhase.ts` are unchanged.

### Step 6 — Run the full validation suite (zero regressions)
- Run every command in **Validation Commands** below and confirm all pass with no errors and no regressions. In particular, confirm all pre-existing parser tests (entity decoding, bare `<failure/>` → skipped, `<testsuites>`/bare `<testsuite>`, malformed → null, single-testcase coercion, `failureMessage` extraction) still pass alongside the new large-report tests.

## Testing Strategy
### Unit Tests
Unit tests are enabled for this project (`.adw/project.md` → `## Unit Tests: enabled`; framework `vitest`). All tests live in `adws/core/__tests__/testReportParser.test.ts`.

New / updated tests:
- **Large all-green report — acceptance guardrail (GREEN).** A synthetic report with > 1000 total predefined-entity expansions (testcase names + `<system-out>` with `&apos;`/`&quot;`/`&amp;`/`&lt;`/`&gt;`), all passing, in the `<testsuites>` wrapper shape. Assert `parseJUnitXml` returns non-null with `total` matching the case count, `passed === total`, `failed === 0`, `skipped === 0`, and entity decoding preserved in `cases[0].name` (`&gt;` → `>`). This is the issue's stated acceptance guardrail: *the fix is correct only if a large green report parses to a non-null green report.*
- **Large green report — bare `<testsuite>` shape.** The same scale in the bare-suite shape, asserting non-null with correct counts and decoding.
- **Limit-override is load-bearing (version-independent RED→GREEN proof).** A local `XMLParser` configured with `processEntities: { maxTotalExpansions: 1000 }` over the same large input **throws** `Entity expansion count limit exceeded`; the module's `parseJUnitXml` over the same input returns **non-null**. Documents that the module's pin is what prevents the throw, independent of the installed `fast-xml-parser` default.

Preserved (must stay green): valid mixed report (bare `<testsuite>`); all-passed cucumber shape; `<error>` counts as failed; zero testcases; malformed / empty / truncated → `null`; `<testsuites>` wrapper summation; bare `<failure/>`/`<failure></failure>` → skipped vs attributed `<failure>` → failed; all-pending suite → `failed === 0`; single-testcase object coercion; `readJUnitReport` missing-file → `null`; `readJUnitReport` valid-file-from-disk → non-null; `failureMessage` extraction from `@_message`, text body, `<error message>`, bare `<failure/>` → undefined, passed → undefined, multiple failures each carry their own message (including `&gt;` decoding in a `@_message`).

### Edge Cases
- Report large enough that total entity expansions exceed the (historically finite) ceiling but every case passes → must parse non-null and `pass` (the core bug).
- Entity-decoding correctness must survive the limit change: `&gt;` in a `@_message` still decodes to `>` (existing `failureMessage` test).
- Bare `<failure/>` (cucumber pending/undefined) still classifies as `skipped`, not `failed`.
- `<testsuites>` wrapper and bare `<testsuite>` both parse and sum correctly.
- Genuinely malformed / truncated XML still returns `null` (validated by `XMLValidator` *before* parsing, so unaffected by the entity-limit change).
- Empty string / whitespace-only input still returns `null`.
- Missing report file (true absence) still returns `null` from `readJUnitReport` and does **not** log a parse error (only the parse-failure branch logs).

## Acceptance Criteria
- A large, all-green JUnit report (> 1000 total predefined-entity expansions across testcase names and `<system-out>`) parses via `parseJUnitXml` and `readJUnitReport` to a **non-null** `TestReport` with correct `total` / `passed` / `failed` (0) / `skipped` counts. *(Issue acceptance guardrail.)*
- Through the unchanged pipeline, such a report yields `reportPresent: true`, `hasFailures: false`, `testcaseCount > 0`, and `computeTestVerdict` returns `pass` — the `adw:unverified` label is **not** applied and the "no JUnit report emitted" comment is **not** posted for a green suite.
- Entity decoding is preserved (`&gt;` → `>`, `&amp;` → `&`, `&apos;` → `'`, `&quot;` → `"`, `&lt;` → `<`).
- Bare `<failure/>` pending markers still classify as `skipped`; attributed `<failure>` still classifies as `failed`.
- `<testsuites>` wrapper and bare `<testsuite>` shapes both parse correctly.
- Genuinely malformed / truncated / empty XML still returns `null`.
- `readJUnitReport` logs a diagnostic on parse failure (distinguishing present-but-threw from absent) and still returns `null`.
- `computeTestVerdict` / `testVerdict.ts` and `unitTestPhase.ts` verdict branches are unchanged (symptom not masked; report actually parses).
- Only `adws/core/testReportParser.ts` and `adws/core/__tests__/testReportParser.test.ts` change (plus this spec). No dependency changes.
- All validation commands pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are taken from `.adw/commands.md`.

- `bunx vitest run adws/core/__tests__/testReportParser.test.ts` — run the targeted parser test file; all tests (existing + new large-report + load-bearing) pass.
- `bun run test:unit` — run the full vitest unit-test suite (`vitest run`); zero failures, confirming no regression elsewhere.
- `bun run lint` — ESLint (`eslint .`) passes with no new errors.
- `bunx tsc --noEmit` — root type-check passes (also the project's `test` script).
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws` project type-check passes (confirms the `processEntities` object form type-checks against `fast-xml-parser`'s `ProcessEntitiesOptions`).
- `bun run build` — build (`tsc`) succeeds with no errors.

## Notes
- **Coding guidelines:** `.adw/coding_guidelines.md` applies. The change is small, explicit, and type-safe; the `catch (err)` logging change implements "try-catch at system boundaries / provide meaningful error messages". No `any`, no decorators, file stays well under 300 lines. Add a clear comment on the `processEntities` block explaining *why* the limit is lifted (trusted input; version-independent pin) so the intent is not lost.
- **No new library / no dependency bump.** `fast-xml-parser@^5.9.0` already provides the object-form `processEntities` API. (Library install command, if ever needed: `bun add <package>` per `.adw/commands.md`.)
- **Why pin instead of relying on the upstream default:** the installed `fast-xml-parser@5.9.0` already defaults `maxTotalExpansions` to `Infinity`, so the bug does not reproduce on a fresh install today — it was reported against a build with a finite default. Pinning the limit explicitly makes parser behaviour deterministic and immune to a transitive downgrade or an upstream default revert. The same lockfile already contains a second, finite-era `fast-xml-parser@5.5.8` under `@aws-sdk/xml-builder`, evidencing real version skew. This is also why the failing-first test is expressed as a *load-bearing* contrast (local finite-limit parser throws; module parser does not) rather than a RED-on-current-baseline assertion — the latter is not achievable on the installed default and would be misleading.
- **Security note:** raising the billion-laughs ceiling is safe here precisely because these JUnit reports are produced by our own test runner, not untrusted input — explicitly stated in the issue. The `XMLValidator` guard still rejects malformed XML.
- **Blocked-by context:** the issue lists `#624` and `#629` as blockers; the dependency baseline they establish (`fast-xml-parser@5.9.0`) is the reason this work is a forward-looking pin + regression guardrail rather than a behaviour change against today's default.
- **Working-tree state:** this issue's worktree already contains a candidate implementation and two large-report tests. Treat this spec as authoritative: keep the parser pin and the `catch` logging, fix the entity-count arithmetic in the existing large-report test so it genuinely exceeds 1000 expansions, and add the version-independent load-bearing test described above.
