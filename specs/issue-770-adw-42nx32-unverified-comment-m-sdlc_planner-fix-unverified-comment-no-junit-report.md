# Bug: `adw:unverified` comment misstates its cause — "Zero Testcases Ran" is posted for the no-JUnit-report branch

## Metadata
issueNumber: `770`
adwId: `42nx32-unverified-comment-m`
issueJson: `{"number":770,"title":"Unverified comment misstates cause: 'Zero Testcases Ran' is posted for the no-JUnit-report branch","body":"## Summary\n\nThe issue comment posted when the unit-test phase marks a run `adw:unverified` describes the wrong condition. It is titled **\"ADW Unverified — Zero Testcases Ran\"** and claims *\"The unit-test phase ran but discovered zero testcases, and no test framework was detected in the repository's dependencies\"* — but the only branch that reaches this comment is the **no-JUnit-report** branch. A genuine zero-testcase result (report present, 0 cases) is a *hard-fail* and never posts this comment.\n\n## Code refs\n\n- `adws/core/testVerdict.ts` — branch table:\n  - `!reportPresent` → `warn` (\"no JUnit report emitted — marking unverified\") ← **the only path to the label from this phase**\n  - `testcaseCount === 0` (report present) → `hard-fail` (\"discovery break\"), workflow exits, no PR\n- `adws/phases/unitTestPhase.ts` — the `warn` verdict applies `ADW_UNVERIFIED_LABEL` and posts the `'unverified'` stage comment\n- `adws/github/workflowCommentsIssue.ts:340` — the `'unverified'` comment template with the \"Zero Testcases Ran\" title and \"no test framework was detected in the repository's dependencies\" claim (nothing in this path inspects dependencies)\n\n## Why it matters\n\nThe misleading text sends diagnosis in the wrong direction. On vestmatic/vestmatic, every completed issue got the label while the repo has a 45+-feature Cucumber suite and `@cucumber/cucumber` in devDependencies — the comment's claims were both false. The actual cause was simply that `## Run Tests` emitted no JUnit XML to `$ADW_UNIT_TEST_REPORT_PATH`.\n\nAdditionally, the \"Next steps\" hint — *\"configure `## Test Framework` in `.adw/commands.md` to enable strict zero-testcase detection\"* — is stale: `commands.testFramework` is only consumed by `stackCoherenceCheck`; nothing uses it for zero-testcase detection.\n\n## Suggested fix\n\nReword the `'unverified'` comment to state the real condition, e.g.:\n\n> **ADW Unverified — No JUnit Report Emitted**\n> The unit-test phase ran `## Run Tests`, but no JUnit XML report appeared at `$ADW_UNIT_TEST_REPORT_PATH`. The verdict cannot be verified, so this run is marked `adw:unverified` (non-blocking).\n> **Next steps:** configure the test runner in `## Run Tests` (or its config file) to emit a JUnit report to the path in `$ADW_UNIT_TEST_REPORT_PATH` — e.g. vitest `--reporter=junit --outputFile=$ADW_UNIT_TEST_REPORT_PATH`, cucumber-js `--format junit:$ADW_UNIT_TEST_REPORT_PATH`.\n\nAnd drop or correct the `## Test Framework` hint (it only feeds the stack-coherence check).\n","state":"OPEN","author":"paysdoc","labels":["bug"],"createdAt":"2026-07-30T09:24:04Z","comments":[],"actionableComment":null}`

## Bug Description
When the unit-test phase resolves a `warn` verdict, it applies the `adw:unverified` label and posts the `'unverified'` stage comment on the issue. That comment's copy describes a condition that **cannot** be the one that triggered it.

The comment (`adws/github/workflowCommentsIssue.ts:340`) reads:

> **## :warning: ADW Unverified — Zero Testcases Ran**
> The unit-test phase ran but discovered zero testcases, and no test framework was detected in the repository's dependencies. The workflow has continued without a hard gate.
> **What this means:** The repository may have no tests yet, or the test discovery configuration needs adjustment. …
> **Next steps:** Add tests or configure `## Test Framework` in `.adw/commands.md` to enable strict zero-testcase detection.

Three claims in that text are false for every run that can reach it:

1. **"Zero Testcases Ran" / "discovered zero testcases"** — the only branch that produces `warn` is `!reportPresent`. A run where a report *is* present and shows zero testcases resolves to `hard-fail` ("discovery break"), which exits the workflow at `unitTestPhase.ts:123` and posts the `error` comment, never this one.
2. **"no test framework was detected in the repository's dependencies"** — nothing on this path inspects dependencies. `computeTestVerdict` takes only `{ enabled, reportPresent, hasFailures, testcaseCount }`; the dependency-sniffing `frameworkDetected` input that this sentence was written for was removed when the verdict moved onto the JUnit-report rail.
3. **"configure `## Test Framework` … to enable strict zero-testcase detection"** — stale. `commands.testFramework` has exactly one consumer, `stackCoherenceCheck` (via `adws/phases/stackCoherenceReporter.ts:12`); no code path uses it for zero-testcase detection or for the unit verdict.

**Expected behaviour:** the comment names the condition that actually fired — no readable JUnit XML report at `$ADW_UNIT_TEST_REPORT_PATH` — and its "Next steps" point at the one setting that fixes it (`## Run Tests` in `.adw/commands.md`).

**Actual behaviour:** the comment sends the reader to look for missing tests and a missing framework. On `vestmatic/vestmatic` — a repo with a 45+-feature Cucumber suite and `@cucumber/cucumber` in `devDependencies` — every completed issue received this comment, and both of its claims were false. The real cause was simply that the repo's `## Run Tests` command emitted no JUnit XML.

Verified live in this worktree:

```
!reportPresent   -> {"verdict":"warn","reason":"no JUnit report emitted — marking unverified"}
report + 0 cases -> {"verdict":"hard-fail","reason":"zero testcases ran but a JUnit report was emitted — discovery break"}
--- comment posted on the warn (!reportPresent) branch ---
## :warning: ADW Unverified — Zero Testcases Ran
The unit-test phase ran but discovered zero testcases, and no test framework was detected …
```

## Problem Statement
`formatUnverifiedComment` still carries the copy written for issue #577's verdict model — where `warn` meant *"zero testcases ran **and** no test framework was detected"*. Issue #601 re-keyed the verdict onto JUnit-report presence (`!reportPresent → warn`; `report present + 0 cases → hard-fail`) but the comment template was never updated to match. The comment is now a diagnostic that is wrong 100% of the time it is shown, and it carries a "Next steps" hint pointing at a config key (`## Test Framework`) that has nothing to do with the failure.

## Solution Statement
Rewrite the body of `formatUnverifiedComment` so it states the condition that actually fired, and nothing else. Specifically:

- **Title** → `## :warning: ADW Unverified — No JUnit Report Emitted` (per the issue's suggested wording).
- **Cause line** → the unit-test phase ran `## Run Tests` but no *readable* JUnit XML report appeared at `$ADW_UNIT_TEST_REPORT_PATH`. Cover both ways `reportPresent` goes false: the file was never written, **or** it was written but could not be parsed (`readJUnitReport` returns `null` for both; the parse case logs `[testReportParser] Failed to parse JUnit report at …`).
- **What-this-means line** → the verdict could not be verified against a report, so the run is marked `adw:unverified`; the workflow continued and is **non-blocking**, but the PR was not fully verified. Do **not** add a "this is not a zero-testcase result" negation — see Notes.
- **Next steps** → configure the runner named in `## Run Tests` (`.adw/commands.md`), or its config file, to emit a JUnit report to `$ADW_UNIT_TEST_REPORT_PATH`, with the concrete flag examples the issue asks for (vitest, cucumber-js) plus one non-JS example (pytest), matching the seeding table in `.claude/commands/adw_init.md:45-51`.
- **Drop** the `## Test Framework` hint entirely from this comment. It stays (correctly) in `formatStackIncoherentComment`, which is the one place `commands.testFramework` genuinely feeds.

This is a **copy-only change to one function**. No signature, no `WorkflowContext` field, no `WorkflowStage` literal, no verdict logic, and no call site changes — `computeTestVerdict`'s branch table and `unitTestPhase`'s `warn` handling are already correct and stay untouched.

A new vitest file pins the corrected copy as a regression guard, including a **coupling test** that drives the real `warn`-producing input through `computeTestVerdict` and asserts the comment that stage posts describes *that* condition. That coupling test is RED today and is the direct proof the bug is fixed.

## Steps to Reproduce
1. From the repo root, write a scratch script `repro770.ts`:
   ```ts
   import { computeTestVerdict } from './adws/core/testVerdict.ts';
   import { formatWorkflowComment } from './adws/github/workflowCommentsIssue.ts';

   const noReport = computeTestVerdict({ enabled: true, reportPresent: false, hasFailures: false, testcaseCount: 0 });
   const zeroCases = computeTestVerdict({ enabled: true, reportPresent: true, hasFailures: false, testcaseCount: 0 });
   console.log('!reportPresent   ->', JSON.stringify(noReport));
   console.log('report + 0 cases ->', JSON.stringify(zeroCases));
   console.log(formatWorkflowComment('unverified', { issueNumber: 770, adwId: 'repro' }));
   ```
2. Run `NODE_OPTIONS="--import tsx" bunx tsx repro770.ts`.
3. Observe:
   - `!reportPresent` → `warn` — **this is the only input that leads to the `'unverified'` comment**.
   - `report present + 0 testcases` → `hard-fail` — exits the workflow; can never post the comment.
   - The printed comment is nevertheless titled **"Zero Testcases Ran"**, asserts "no test framework was detected in the repository's dependencies", and tells the reader to configure `## Test Framework`.
4. Delete the scratch file.

Real-world reproduction (no local repro needed): any target repo whose `## Run Tests` command does not emit JUnit XML to `$ADW_UNIT_TEST_REPORT_PATH` gets this comment on every completed issue — e.g. `vestmatic/vestmatic`, which has a large Cucumber suite and therefore falsifies both of the comment's claims.

## Root Cause Analysis
**Copy drift across a verdict-model migration.**

- Issue **#577** introduced the `warn`/`unverified` outcome with a two-input rule: `testcaseCount === 0 && frameworkDetected === false → warn`. The comment text was written to describe exactly that: *zero testcases ran, and no framework was found in the dependencies*. At that time both claims were true.
- Issue **#601** re-keyed the verdict onto JUnit-report presence. `frameworkDetected` was deleted from `TestVerdictInput`, and the branch table became (`adws/core/testVerdict.ts:26-42`):
  - `!enabled` → `pass`
  - `!reportPresent` → **`warn`** ← the only producer of the `unverified` comment
  - `hasFailures` → `hard-fail`
  - `testcaseCount === 0` → `hard-fail` (discovery break)
  - else → `pass`
- `formatUnverifiedComment` was never touched by that migration, so the *only* surviving description of the `warn` outcome now describes the branch that became a `hard-fail`, and cites an input (`frameworkDetected`) that no longer exists.
- The stale "Next steps" hint compounds it: `commands.testFramework` migrated to a single consumer (`stackCoherenceCheck`, wired at `adws/phases/stackCoherenceReporter.ts:12`) and never regained any role in zero-testcase detection, so following the hint changes nothing about the outcome.

Nothing was structurally hidden — the drift survived because there is **no test anywhere that reads the `'unverified'` comment body**. `adws/github/` has no `workflowCommentsIssue` test file, and no `.feature` scenario asserts this copy (`grep -rn "Zero Testcases" app_docs/ features/ README.md .claude/` returns nothing). The regression guard added by this fix closes that gap.

Contributing structural detail worth naming in the new copy: `reportPresent` is `readJUnitReport(path) !== null`, and `readJUnitReport` returns `null` both when the file is absent (`fs.existsSync` guard, `testReportParser.ts:122`) and when it exists but throws on parse (`catch` at `:126`, which logs `[testReportParser] Failed to parse JUnit report at …`). The corrected copy must name both, or it re-creates the same class of misdiagnosis for the parse-failure case.

## Relevant Files
Use these files to fix the bug:

- `adws/github/workflowCommentsIssue.ts` — **the only production edit.** `formatUnverifiedComment` (line 339-341) holds the wrong copy. Neighbours to match for style: `formatStackIncoherentComment` (line 331-337, the sibling `ADW Unverified — …` comment) and `formatPhaseTimeoutComment` (line 343-347). Every formatter ends with `**ADW ID:** \`${ctx.adwId}\`${formatRunningTokenFooter(ctx.runningTokenTotal)}${ADW_SIGNATURE}` — that trailer must be preserved verbatim. The `case 'unverified':` dispatch (line 387) is correct and unchanged.
- `adws/core/testVerdict.ts` — **read-only.** The branch table (lines 26-42) is the authority for what `warn` means. `!reportPresent → warn` is the sole producer of the comment; `testcaseCount === 0 → hard-fail` is what the current copy wrongly describes. Do **not** change this file — the verdict logic is correct; only the prose about it is wrong.
- `adws/phases/unitTestPhase.ts` — **read-only.** Lines 126-144 are the sole call site: on `warn` it applies `ADW_UNVERIFIED_LABEL` and calls `postIssueStageComment(repoContext, issueNumber, 'unverified', ctx)`. Confirms there is exactly one path to this comment. Unchanged.
- `adws/agents/testRetry.ts` — **read-only.** Line 123: `reportPresent = finalReport !== null`. Establishes that "report absent" and "report unparseable" collapse into the same boolean, which is why the new copy must name both.
- `adws/core/testReportParser.ts` — **read-only.** `readJUnitReport` (lines 121-133): `null` on missing file *and* on parse failure, with the `[testReportParser] Failed to parse JUnit report at …` console error on the latter. Source of the log-line breadcrumb quoted in the new copy.
- `adws/phases/stackCoherenceReporter.ts` / `adws/core/stackCoherenceCheck.ts` — **read-only.** Line 12 of the reporter is the *only* consumer of `commands.testFramework`, proving the `## Test Framework` hint belongs to the `stack_incoherent` comment and not to this one. Must keep working unchanged (a guard test pins this).
- `.claude/commands/adw_init.md` — **read-only.** Lines 43-51 are the canonical per-language JUnit-emission table (`vitest --reporter=junit --outputFile=$ADW_UNIT_TEST_REPORT_PATH`, `pytest --junitxml=…`, etc.). The new "Next steps" examples must be consistent with it. **Do not edit this file** — it is a `hashInputs:` file and any edit raises `.adw-version`, triggering an `adwUpgrade` regen sweep across every registered target repo. That propagation is not wanted for a comment-copy fix.
- `adws/types/workflowTypes.ts` — **read-only.** Line 28 declares the `'unverified'` `WorkflowStage` literal. The stage name stays as-is; renaming it would ripple into `stageClassifier.ts:85`, cron/takeover consumers, and persisted state.
- `.adw/commands.md` — no change; source of the exact validation commands (lint, type-check, build, `test:unit`) and of the `## Run Tests` heading the new copy names.
- `.adw/coding_guidelines.md` — no change; the fix must follow it (clarity over cleverness, pure formatter functions, code hygiene).
- `features/per-issue/feature-770.feature` — **the acceptance contract, already authored** (tagged `@adw-770 @adw-42nx32-unverified-comment-m`). Eight sections the reworded copy must satisfy: §1 pins the channel (`warn` composes the `'unverified'` comment) and names the absent JUnit report and `ADW_UNIT_TEST_REPORT_PATH`; §2 makes **no** zero-testcase claim and **no** dependency-detection claim; §3 points at `## Run Tests`, not `## Test Framework`; §4 still names the `adw:unverified` label and reports the run as unblocked; §5 stays recognisable to `isAdwComment` and still carries the `**ADW ID:**` footer; §6 pins that a report-present zero-testcase run hard-fails into the `error` comment instead **and** that no unverified comment is composed for it; §7 the stack-coherence comment keeps its `## Test Framework` guidance; §8 type-check. The scenarios assert **produced comment bodies**, never source text — the wording is free to differ from the issue's suggestion as long as the semantics hold.
- `features/per-issue/step_definitions/` — the step definitions for `feature-770.feature` do not exist yet; the `generate_step_definitions` phase authors them. The feature's own docstring specifies the drive: real `computeTestVerdict` + real `postIssueStageComment` → `formatWorkflowComment`, with a capturing `RepoContext` whose `issueTracker.commentOnIssue` records the body (the fake-commenter pattern from `feature-720.steps.ts` §3 / `feature-639.steps.ts` §3), and the `warn`→`unverified` / `hard-fail`→`error` mapping re-composed in the step (because `executeUnitTestPhase` runs the `/test` agent and `process.exit(1)`s on hard-fail).
- `app_docs/feature-d0hv98-exhaustive-stage-classifier.md` — **reference only.** `.adw/conditional_docs.md` lists `adws/github/workflowCommentsIssue.ts` under this doc's `Owns:` block. Its ownership concerns the `WorkflowStage` union and stage classification, neither of which this fix touches; read it to confirm no stage-classification contract is affected.

### New Files
- `adws/github/__tests__/workflowCommentsIssue.test.ts` — vitest regression guard for the comment copy. The location is already covered by the `adws/**/__tests__/**/*.test.ts` include in `vitest.config.ts`, so `bun run test:unit` picks it up with no config change. Contents are specified in Step 2 below.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Rewrite `formatUnverifiedComment` to describe the real condition
- Open `adws/github/workflowCommentsIssue.ts` and replace the body of `formatUnverifiedComment` (line 339-341). Keep the function signature, its position in the file, and the `case 'unverified':` dispatch exactly as they are.
- The returned string must be a single template literal in the same one-line `\n\n`-separated style as its neighbours, composed of:
  1. Heading: `## :warning: ADW Unverified — No JUnit Report Emitted`
  2. Cause paragraph: the unit-test phase ran `` `## Run Tests` ``, but no **readable** JUnit XML report appeared at `` `$ADW_UNIT_TEST_REPORT_PATH` `` — either the command emitted no report, or the file it wrote could not be parsed (note that a parse failure is logged as `` `[testReportParser] Failed to parse JUnit report at …` ``).
  3. `**What this means:**` paragraph: the unit-test verdict could not be verified against a report, so this run is marked `` `adw:unverified` `` — **non-blocking**, the workflow continued and the PR was not fully verified. Do **not** append a "this is not a zero-testcase result" clarification: the comment must make *no* claim about zero testcases in either direction (see Notes and `features/per-issue/feature-770.feature` §2).
  4. `**Next steps:**` paragraph: configure the runner named in `` `## Run Tests` `` (`` `.adw/commands.md` ``), or its config file, to emit a JUnit report to the path in `` `$ADW_UNIT_TEST_REPORT_PATH` `` — e.g. vitest `` `--reporter=junit --outputFile=$ADW_UNIT_TEST_REPORT_PATH` ``, cucumber-js `` `--format junit:$ADW_UNIT_TEST_REPORT_PATH` ``, pytest `` `--junitxml=$ADW_UNIT_TEST_REPORT_PATH` ``.
  5. The unchanged trailer: `**ADW ID:** \`${ctx.adwId}\`${formatRunningTokenFooter(ctx.runningTokenTotal)}${ADW_SIGNATURE}`.
- **Remove every trace** of: `Zero Testcases`, "discovered zero testcases", "no test framework was detected in the repository's dependencies", "The repository may have no tests yet", and the `## Test Framework` hint.
- Escaping note: `$ADW_UNIT_TEST_REPORT_PATH` is safe inside a TypeScript template literal (`$` followed by `A`, not `{`) and needs no escaping. Backticks around inline code **do** need `` \` ``, exactly as the sibling formatters do it.
- Do not touch `formatStackIncoherentComment` — its `## Test Framework` reference is correct and must stay.

### 2. Add the regression guard
- Create `adws/github/__tests__/workflowCommentsIssue.test.ts`, importing `describe/it/expect` from `vitest`, `formatWorkflowComment` from `../workflowCommentsIssue`, and `computeTestVerdict` from `../../core/testVerdict`.
- Build the body once per suite with a minimal context: `formatWorkflowComment('unverified', { issueNumber: 770, adwId: 'test-adw' })`.
- Assertions on the `'unverified'` body:
  1. **States the real cause** — contains `No JUnit Report`, `$ADW_UNIT_TEST_REPORT_PATH`, and `## Run Tests`.
  2. **Does not state the wrong cause** — does **not** match `/zero testcase/i` **at all** (in either direction — see the Step 1 note), does **not** match `/detected/i`, and does **not** match `/dependenc/i`. These mirror `feature-770.feature` §2.
  3. **Drops the stale hint** — does **not** contain `## Test Framework`.
  4. **Preserves the shared trailer** — contains ``**ADW ID:** `test-adw` `` and the ADW signature marker `<!-- adw-bot -->`.
  5. **Names the non-blocking nature** — contains `adw:unverified` and `non-blocking` (case-insensitive).
- **Coupling test (the direct bug proof, RED today):** assert `computeTestVerdict({ enabled: true, reportPresent: false, hasFailures: false, testcaseCount: 0 }).verdict === 'warn'` (the only producer of this comment) **and**, in the same test, that the `'unverified'` body describes *that* condition — i.e. mentions the missing report and does not mention zero testcases. Add the mirror assertion that `computeTestVerdict({ enabled: true, reportPresent: true, hasFailures: false, testcaseCount: 0 }).verdict === 'hard-fail'`, documenting why a zero-testcase claim can never be correct here. This is the unit-level twin of `feature-770.feature` §1/§6.
- **Over-reach guard:** assert `formatWorkflowComment('stack_incoherent', { issueNumber: 770, adwId: 'test-adw', coherenceWarnings: ['w'] })` **still** contains `## Test Framework` and `Stack Coherence`, so the hint removal is scoped to the one comment that had it wrong.
- Confirm the file follows `.adw/coding_guidelines.md` (no `any`, explicit assertions, no decorators) and matches the style of existing sibling suites such as `adws/core/__tests__/testVerdict.test.ts`.

### 3. Confirm RED → GREEN
- Before applying Step 1 (or by temporarily reverting it), run `bunx vitest run adws/github/__tests__/workflowCommentsIssue.test.ts` and confirm the copy assertions and the coupling test **fail** against the old text.
- With Step 1 applied, run the same command and confirm all tests **pass**.
- Re-run the Steps-to-Reproduce scratch script once and confirm the printed comment now names the missing JUnit report; delete the scratch file afterwards so it is never committed.

### 4. Check for stale references to the old copy
- Run `grep -rn "Zero Testcases\|no test framework was detected" adws/ features/ app_docs/ README.md .claude/` and confirm the only remaining hits are historical `specs/` plan documents (which are immutable records and must not be edited). Nothing in `adws/`, `features/`, `app_docs/`, `README.md`, or `.claude/` should reference the removed wording after the fix.
- Confirm no `.feature` scenario or step definition asserts the old text (`grep -rn "formatWorkflowComment" features/`) — `features/per-issue/step_definitions/feature-637.steps.ts` uses `formatWorkflowComment('phase_timeout', …)` only and is unaffected.

### 5. Satisfy the BDD acceptance contract
- Re-read `features/per-issue/feature-770.feature` and check the reworded copy against all eight sections. The likely trip-wires, in order of risk:
  - **§2** — the body must match neither `/zero testcase/i` nor the detection family (`/detected/i`, `/dependenc/i`). This is why Step 1 forbids the "not a zero-testcase result" negation.
  - **§4** — the body must still name `adw:unverified` and say the run was not blocked (`non-blocking` satisfies it).
  - **§5** — the `## :warning: …` heading, the `ADW_SIGNATURE` trailer and the `**ADW ID:**` footer must survive verbatim. `isAdwComment` keys on the `## :emoji: Title` heading pattern *or* the `<!-- adw-bot -->` signature; the ADW-ID read-back over a **single** produced body is `extractAdwIdFromComment` (`extractLatestAdwId` is its newest-first wrapper over a comment *list*, used by resume routing) — the §5 step definition must call the single-body one.
  - **§7** — `formatStackIncoherentComment` must be untouched.
- The three sections whose `Then` steps pin the *channel* rather than the copy, and which the rewrite must therefore leave reachable exactly as-is:
  - **§1** first `Then` — the `warn` verdict must still compose the `'unverified'` comment. The mapping is unchanged code; the step definition re-composes it (`warn` → `unverified`) for the reason given in the feature's docstring.
  - **§3** — `## Run Tests` must appear in the Next-steps direction and `## Test Framework` must appear nowhere in this body.
  - **§6** second `Then` — no unverified comment may be composed for the report-present/zero-testcase run (`hard-fail` → `error`). Step 1 changes copy only, so this stays GREEN; it fails only if the rewrite is mis-wired into another dispatch case.
- Once `generate_step_definitions` has authored the step definitions, run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-770"` and confirm all eight scenarios pass.

### 6. Validate
- Run every command in **Validation Commands** below and confirm all pass with zero regressions. Baseline before this change: **137 test files / 2360 tests passing**; after the change expect 138 files and 2360 + N tests, all green.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Commands are taken from `.adw/commands.md`.

- **Reproduce before the fix** — with the scratch script from *Steps to Reproduce* in the repo root: `NODE_OPTIONS="--import tsx" bunx tsx repro770.ts`. Expect the printed comment to be titled `ADW Unverified — Zero Testcases Ran` while the `warn` verdict reason is `no JUnit report emitted` (the mismatch). Delete the script afterwards.
- **RED proof** — `bunx vitest run adws/github/__tests__/workflowCommentsIssue.test.ts` against the *unpatched* formatter: the copy assertions and the coupling test fail.
- `bun run lint` — ESLint passes with zero errors/warnings.
- `bunx tsc --noEmit` — repo type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional ADW type-check passes.
- `bun run build` — build succeeds with no errors.
- `bun run test:unit` — vitest runs the full suite; the new `adws/github/__tests__/workflowCommentsIssue.test.ts` passes (GREEN after the fix) and all pre-existing tests still pass (baseline 137 files / 2360 tests, zero regressions).
- **Verify after the fix** — re-run the scratch script: the comment is now titled `ADW Unverified — No JUnit Report Emitted`, names `$ADW_UNIT_TEST_REPORT_PATH` and `## Run Tests`, and contains no "Zero Testcases" / "no test framework was detected" / "## Test Framework" text. Delete the script.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-proof"` — the review-proof scenario suite still passes (required by `.adw/review_proof.md` step 4).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-770"` — all eight scenarios in `features/per-issue/feature-770.feature` pass. §1/§2/§3 are RED before the fix and GREEN after; §4/§5/§6/§7/§8 are GREEN before and must stay GREEN. Requires the step definitions authored by the `generate_step_definitions` phase.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): the change keeps `formatUnverifiedComment` a pure, side-effect-free string builder, matching every sibling formatter; no decorators, no new abstractions, no new libraries. `adws/github/workflowCommentsIssue.ts` is already 417 lines (over the 300-line guideline) — that is a **pre-existing** condition and splitting the module is explicitly out of scope for this bug fix; the change is copy-only and does not meaningfully grow the file.
- **No new libraries.** Per `.adw/commands.md` the install command would be `bun add <package>`, but none is needed.
- **Scope discipline — what is deliberately *not* changed:**
  - `computeTestVerdict`'s branch table is correct; the bug is prose, not logic.
  - The `'unverified'` `WorkflowStage` literal keeps its name. Renaming it (e.g. to `report_missing`) would ripple into `stageClassifier.ts:85`, `workflowTypes.ts:28`, cron/takeover consumers, and already-persisted state files — far beyond this fix.
  - The comment cites the **env var name** `$ADW_UNIT_TEST_REPORT_PATH`, not the resolved path. Plumbing the resolved path would need a new `WorkflowContext` field wired from `unitTestPhase`, and the resolved value (`agents/<adwId>/logs/junit-unit.xml` on the ADW host) is meaningless to someone reading a GitHub comment. The env-var name is what a repo owner actually configures against.
  - `.claude/commands/adw_init.md` is **not** edited. It is a `hashInputs:` file; editing it raises `.adw-version` and triggers an `adwUpgrade` regen sweep across every registered target repo — unwanted blast radius for a comment-copy fix.
- **Why there is no "this is not a zero-testcase result" negation.** An earlier draft of this plan had the comment explicitly rebut the old claim ("a report that *is* present but shows zero testcases is a hard failure and never reaches this comment"). It was dropped for two reasons. On the merits: a comment titled "No JUnit Report Emitted" does not need to relitigate a diagnosis the reader never saw, and repeating "zero testcases" in the one comment whose entire defect was that phrase re-seeds the confusion. On the contract: `feature-770.feature` §2 pins that the body makes **no claim that zero testcases were discovered**, and its step definitions are not yet written, so a token-family match on "zero testcase" would fail the scenario. The distinction between the `warn` and `hard-fail` branches belongs in `testVerdict.ts`'s branch-table docblock (where it already is) and in the new unit test, not in user-facing copy.
- **Why the new copy names two causes, not one.** The issue's suggested text says "no JUnit XML report appeared at `$ADW_UNIT_TEST_REPORT_PATH`". That is the dominant case but not the complete one: `reportPresent` is `readJUnitReport(path) !== null`, and `readJUnitReport` also returns `null` when the file exists but fails to parse (`testReportParser.ts:126`, which logs `[testReportParser] Failed to parse JUnit report at …`). Naming only the "never written" case would recreate the same misdiagnosis class for a repo that emits malformed XML — so the cause line covers both and points at the log breadcrumb. The heading follows the issue's suggested wording verbatim.
  - **No scenario pins the parse-failure half, by design.** `feature-770.feature` §1 asserts only the absent-report *sense* (a token/family match that the two-cause phrasing satisfies), and the issue names only the "never written" case. The parse-failure clause is therefore pinned by the new unit test alone (Step 2 assertion 1 covers the shared `No JUnit Report` / `$ADW_UNIT_TEST_REPORT_PATH` tokens; add a substring assertion for the `[testReportParser] Failed to parse` breadcrumb there if you want it guarded). Do **not** add a scenario for it to `feature-770.feature` — that file is the issue-faithful acceptance contract and deliberately pins semantics the issue mandates, nothing further.
- **Conditional docs.** `.adw/conditional_docs.md` matches five entries for this task — `feature-hrl5jd-unit-test-rail-onto-junit-report.md` (unit verdict / report-path wiring, `adw:unverified` on the unit phase), `feature-zyaojl-configurable-test-directory.md` (troubleshooting the `adw:unverified` label/comment, `## Test Framework`), `feature-19me6a-fix-junit-entity-expansion-limit.md` (report emitted but parse threw silently), `feature-l8a10n-stack-coherence-check.md` (the `stack_incoherent` sibling comment), and `feature-y6hjbr-durable-opt-out-unit-test-gate.md`. **None of those files exists in `app_docs/` in this worktree**, so the code (`adws/core/testVerdict.ts`, `adws/agents/testRetry.ts`, `adws/core/testReportParser.ts`, `adws/phases/unitTestPhase.ts`) is the source of truth. The one present owner doc, `app_docs/feature-d0hv98-exhaustive-stage-classifier.md`, lists `workflowCommentsIssue.ts` under `Owns:` but governs stage classification only — unaffected by a copy change.
- **Why this drifted undetected.** There is no test file for `adws/github/workflowCommentsIssue.ts` and no BDD scenario asserts any `'unverified'` comment text, so the #601 verdict migration could re-key the branch without anything failing. The new test file is the first coverage of this module's copy; the coupling test (verdict input → comment claim) is what makes a future re-key of the branch table fail loudly instead of silently producing another wrong comment.
- **Blast radius.** One function body plus one new test file. No behaviour, gate, label, or state transition changes: the same runs get `adw:unverified` before and after; only what the comment *says* changes.
- **Worktree hygiene — an out-of-scope revert was found and discarded during planning.** This worktree was created with an uncommitted working-tree revert of `.claude/commands/adw_init.md` that deleted the entire step-7 "Copy Starter Guardrails Settings" section (issue #763, merged via `534d8785` / `d166f0cf`) and renumbered steps 8→7. Verified as working-tree-only: `git diff HEAD origin/dev -- .claude/commands/adw_init.md` was empty and `git show HEAD:.claude/commands/adw_init.md` still contained the step, so the revert existed **only** in the unstaged working tree. Discarded with `git checkout HEAD -- .claude/commands/adw_init.md` (pure discard — no commit, no `git add -A`) and re-verified. **The implementer must not re-introduce it**: `.claude/commands/adw_init.md` is out of scope for this issue and must show no diff against `origin/dev` in the final PR. This is a known recurring worktree-birth defect; re-check `git diff origin/dev --stat` before committing.
