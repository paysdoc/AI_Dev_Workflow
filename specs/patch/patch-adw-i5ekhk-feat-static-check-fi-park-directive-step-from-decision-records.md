# Patch: Read each park directive's meaning from the decision records, not from `parkDirectives`

## Metadata
adwId: `i5ekhk-feat-static-check-fi`
reviewChangeRequest: `Issue #1: Step definition independence: features/per-issue/step_definitions/feature-989-park.steps.ts, step "the park comment says what {string} does for this park". The step is used for "## Continue" in the fix_loop_stalled park scenario, for "## Retry" in the pre_existing_regression scenario, and for both directives in the missing_application_type scenario. It breaks rule 3 (expectations come from the scenario) and rule 2 (the assertion can fail). It gets its expected text by calling parkDirectives(evidence) from adws/forge/parkComment.ts, the module under test, and then checks that the comment from buildParkComment contains that text. But buildParkComment embeds that same parkDirectives output, so the implementation is compared with itself and any meaning the builder gives these directives passes. Resolution: change only this step definition, never the feature file. Remove the parkDirectives import and call. Read the directive's explanation from the comment with directiveMeaning(comment, directive). Assert it against meanings written in the step file from the issue's decision records, keyed by the evidence's reason (pre_existing_regression Retry: ADR-0060; fix_loop_stalled Continue: ADR-0059; missing_application_type Retry and Continue: ADR-0061). Keep the check at least as strict as it is now; do not reduce it to a non-empty test.`

## Issue Summary
**Original Spec:** `specs/issue-989-adw-i5ekhk-feat-static-check-fi-sdlc_planner-static-check-fix-loop-guard.md`
**Issue:** The step `the park comment says what {string} does for this park` (`features/per-issue/step_definitions/feature-989-park.steps.ts:127-132`) takes its expected text from `parkDirectives(evidence)`. `buildParkComment` (`adws/forge/parkComment.ts:187,194`) writes that same output into the comment, so the step compares the builder with itself. It can fail only when a directive line is missing or empty. The circularity is confirmed. In a scratch copy, the builder's `missing_application_type` `## Continue` was changed to "assumes the cli application type and carries on", which ADR-0061 forbids. With the current step, all 6 park scenarios still pass. The step is used three times in `features/per-issue/feature-989.feature`:
- line 295: `fix_loop_stalled`, `## Continue`;
- line 318: `pre_existing_regression`, `## Retry`;
- lines 341-342: `missing_application_type`, `## Retry` and `## Continue`.

**Solution:** In the step file only:
- drop `parkDirectives`;
- write the four decision-record meanings as literals in a `DIRECTIVE_MEANINGS` table keyed by `ParkReason`, then by directive;
- read the comment's explanation with `directiveMeaning(comment, directive)`;
- assert that the explanation contains the whole expected meaning.

This is the same full-sentence `includes` comparison as now, so the check is no weaker. The difference is that the expectation no longer comes from the code under test. Each literal states the meaning that the review's bullets give, worded as the comment must say it. A builder that gives a directive any other meaning now fails the step. The `feature-989.feature` file, `feature-989-comments.ts` and `adws/forge/parkComment.ts` do not change.

## Files to Modify
Use these files to implement the patch:

- `features/per-issue/step_definitions/feature-989-park.steps.ts` — the only file this patch changes.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix the imports and the header comment
- Line 12: remove `parkDirectives` from the import of `'../../../adws/forge/parkComment.ts'`. The result is `import { ParkReason, buildParkComment, type ParkEvidence, type ParkedCheck } from '../../../adws/forge/parkComment.ts';`.
- Line 14: also import `directiveMeaning`. The result is `import { assertDirectiveSays, directiveMeaning } from './feature-989-comments.ts';`. Other steps still use `assertDirectiveSays`, so keep it.
- Lines 2-4: the header says "the assertions read what `parkDirectives` says each directive does", which will no longer be true. Replace that clause so the header reads:
  ```ts
  /**
   * Park-comment scenarios of feature-989. Each calls the pure builder directly: a scenario's table of
   * evidence becomes a `ParkEvidence`, with sample values for the fields the table leaves out (a check's
   * command and exit code). Each directive assertion reads what the comment says the directive does and
   * compares it with the scenario's words, or with `DIRECTIVE_MEANINGS` where the scenario leaves them out.
   */
  ```

### Step 2: Add the decision-record meanings table after `const ADW_ID`
- Insert this block, preceded by a blank line, directly after `const ADW_ID = 'bdd989-park-comment';`:
  ```ts
  /**
   * Written from the decision records, not read from the builder, so that a builder that gives a directive another
   * meaning fails: a pre-existing regression takes a red baseline's meanings (ADR-0060), a stalled fix loop gives only
   * `## Retry` a meaning (ADR-0059), and ADW never assumes an application type (ADR-0061).
   */
  const DIRECTIVE_MEANINGS: Readonly<Partial<Record<ParkReason, Readonly<Record<string, string>>>>> = {
    [ParkReason.PreExistingRegression]: {
      '## Retry': 're-runs the scenario on the base branch and parks the issue again if it still fails there',
    },
    [ParkReason.FixLoopStalled]: {
      '## Continue': 'waives nothing for this park: use `## Retry` to continue the fix loop',
    },
    [ParkReason.MissingApplicationType]: {
      '## Retry': 're-reads `## Application Type` after `adw_init` has been re-run',
      '## Continue': 'waives nothing, because ADW never assumes an application type',
    },
  };
  ```
- Use these four strings verbatim. Each states the meaning from the review's bullets, worded as the park comment must say it. The red-baseline steps in the same file follow the same pattern: the scenario phrase "re-runs the baseline and parks the issue again if it is still red" is ADR-0060's wording as the comment says it.
  - `pre_existing_regression` `## Retry` gives a red baseline's `## Retry` (ADR-0060) to the scenario that fails on the base branch. The comment names that scenario above the directives, which is why the literal says "the scenario" and not the review's "the failing scenario".
  - `fix_loop_stalled` `## Continue` waives nothing and points to `## Retry`, which continues the fix loop (ADR-0059).
  - `missing_application_type` `## Retry` and `## Continue` follow ADR-0061: no default type, and a re-run of `adw_init`. Both literals are word for word the review's bullets.
- Do not add entries for the reason and directive pairs that no scenario sends to this step. Any other directive, or any other reason, must fail the step with the lookup message in Step 3. It must never fall back to anything.

### Step 3: Rewrite the step body (currently lines 127-132)
- Replace the body of `Then('the park comment says what {string} does for this park', …)` with:
  ```ts
  Then('the park comment says what {string} does for this park', function (directive: string) {
    const { reason } = requireEvidence();
    const expected = DIRECTIVE_MEANINGS[reason]?.[directive];
    assert.ok(expected, `DIRECTIVE_MEANINGS holds no meaning of ${directive} for a ${reason} park`);
    const meaning = directiveMeaning(requireComment(), directive);
    assert.ok(meaning.includes(expected), `Expected the park comment to say that ${directive} ${expected}, but it says that ${directive} ${meaning}`);
  });
  ```
- The step text stays the same, so `feature-989.feature` matches it unchanged and Cucumber finds no ambiguity.
- Strictness:
  - The comparison is the same full-meaning `meaning.includes(expected)` that `assertDirectiveSays` made before, now against a fixed literal.
  - `directiveMeaning` still fails when the `- \`<directive>\` — ` line is missing.
  - `assert.ok(expected, …)` replaces both the old `assert.fail('Not a directive this park explains')` branch and the non-empty check, and narrows `expected` to `string`.
  - Do not shorten the literals into fragments, and do not swap `includes` for any looser test.
- Leave every other step, helper and hook in the file as it is.

## Validation
Execute every command to validate the patch is complete with zero regressions.

These checks were already run on a scratch copy of `HEAD` with exactly this change applied:
- the 6 park scenarios passed;
- `eslint` and `bunx tsc --noEmit` passed;
- each of the four mutations below failed exactly one scenario, naming the expected meaning.

1. `grep -c "parkDirectives" features/per-issue/step_definitions/feature-989-park.steps.ts`
   - Prints `0`: the step no longer calls the module under test for its expectation.
   - Run `git diff --quiet HEAD -- adws/ features/per-issue/feature-989.feature features/per-issue/step_definitions/feature-989-comments.ts`. It must exit 0, because no file other than the step file changed.
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-989"`
   - Every `@adw-989` scenario passes, including the three park scenarios that use the rewritten step.
   - Then run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-988"` to confirm the shared step files still load without ambiguity.
3. Prove that the assertion can fail (rules 2 and 3):
   1. Change the builder's `missing_application_type` `## Continue` to one that assumes a default type: `perl -pi -e 's/waives nothing, because ADW never assumes an application type/assumes the cli application type and carries on/' adws/forge/parkComment.ts`.
   2. Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-989" --name "park comment"`. It must report `6 scenarios (1 failed, 5 passed)`, with `Expected the park comment to say that ## Continue waives nothing, because ADW never assumes an application type, but it says that ## Continue assumes the cli application type and carries on.`
   3. Restore the file with `git checkout -- adws/forge/parkComment.ts`. Confirm with `git diff --quiet HEAD -- adws/forge/parkComment.ts`, which must exit 0.
   4. Before this patch, the same mutation reported `6 scenarios (6 passed)`.
4. `bun run lint && bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json`: lint and both type checks pass. The root `tsconfig.json` includes `features/**`.
5. `bunx vitest run adws/forge/__tests__/parkComment.test.ts && bun run test:unit`: the park builder's unit tests and the full unit suite still pass. This also confirms that the builder was restored after the mutation check.

## Patch Scope
**Lines of code to change:** ~25 (one file: about 20 lines added for the table and its comment, 5 step-body lines replaced, 2 import lines and 1 header clause edited)
**Risk level:** low
**Testing required:**
- The `@adw-989` scenarios, especially the three park scenarios that use the step, and the `@adw-988` scenarios as a load check.
- A one-time mutation of `parkComment.ts`, reverted afterwards, proving the step fails when the builder gives a directive a meaning the decision records reject.
- Lint, both type checks and the unit suite.
