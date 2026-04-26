# Patch: Treat clean cucumber tally as PASS in scenarioProof.ts when post-suite warnings cause non-zero exit

## Metadata
adwId: `2evbnk-bdd-rewrite-2-3-auth`
reviewChangeRequest: `Issue #1: scenario_proof.md reports @regression as FAILED with exit code 1. The captured regression-full-output.log shows the actual cucumber outcome is "1646 scenarios (41 pending, 1605 passed)" with 0 failed and 0 undefined; the non-zero exit traces to four "⚠️ D1 write failed: TypeError: fetch failed" lines emitted after suite teardown (KPI telemetry). Spec patch-4 amendment acknowledges this as pre-existing and unrelated to scenario outcomes, but the proof artefact reviewers see still records FAILED, which violates Strategy A's blocker check verbatim. Resolution: Either (a) make the cucumber exit reflect scenario outcomes only — e.g. wrap the post-suite D1 KPI write in a try/catch that does not propagate non-zero, or run KPI writes outside the cucumber subprocess — so exit 0 matches the clean tally; or (b) update adws/phases/scenarioProof.ts to parse the cucumber summary line ("X scenarios (Y pending, Z passed)") and treat 0 failed / 0 undefined as PASS even when exit != 0, with the D1 fetch failure surfaced as a non-blocking warning. Re-run regression and regenerate scenario_proof.md so it records PASS before merge.`

## Issue Summary
**Original Spec:** `specs/issue-492-adw-2evbnk-bdd-rewrite-2-3-auth-sdlc_planner-bdd-authoring-smoke-surface-scenarios.md`

**Issue:** After patch 4 fixed the two pre-existing @regression failures, the cucumber summary line is clean — `1646 scenarios (41 pending, 1605 passed)` with zero `failed` and zero `undefined`. Yet the cucumber subprocess still exits with code 1, which propagates through `adws/agents/bddScenarioRunner.ts:70` (`allPassed: exitCode === 0`) and lands in `adws/phases/scenarioProof.ts:166` as `passed: false`, so `agents/2evbnk-bdd-rewrite-2-3-auth/scenario_proof.md` continues to report `❌ FAILED` for the `@regression` blocker tag — which violates Strategy A's blocker check (`hasBlockerFailures = tagResults.some(r => r.severity === 'blocker' && !r.passed && !r.skipped)`) and blocks merge despite the clean scenario tally.

The non-zero exit traces to four `⚠️ D1 write failed: TypeError: fetch failed` lines emitted **after** the cucumber summary, by post-suite KPI telemetry (`adws/cost/d1Client.ts` invoked fire-and-forget from `adws/core/phaseRunner.ts:84`). These are pre-existing post-teardown noise unrelated to scenario outcomes — both the baseline (pre-patch-4) and patched runs show the same four D1 warnings — and the spec patch-4 amendment already acknowledges the noise as out-of-scope.

**Solution:** Implement reviewer option **(b)** — the localised, lower-risk option. Update `adws/phases/scenarioProof.ts` to parse the cucumber summary tally line (e.g. `1646 scenarios (41 pending, 1605 passed)`), and when the tally reports zero `failed` and zero `undefined` scenarios, treat the tag as PASSED even if the subprocess exit code is non-zero. The non-zero exit code is preserved in the proof markdown alongside a `**Warning:**` line that explains the override and surfaces the post-suite noise so reviewers retain full visibility.

Option (a) — modifying `adws/cost/d1Client.ts` or `adws/core/phaseRunner.ts` to suppress the exit-1 — was rejected because the d1Client already wraps fetch in `try/catch` and `phaseRunner.commit()` already chains `.catch(...)` on the unawaited promise (see `adws/core/phaseRunner.ts:84-85`), so the fetch error is already swallowed at every layer the patch could reach. The exit 1 originates from process-shutdown behaviour (likely an unhandled rejection from the `fetch` retry-internal promise that escapes both catch handlers under Node 20+), and tracking that down would require diagnostic instrumentation across `adws/cost/`, `adws/core/`, and possibly `adws/triggers/`. Option (b) is a single-file change that addresses the symptom directly without risk of masking real KPI failures (the D1 write was already best-effort by design).

## Files to Modify
Use these files to implement the patch:

- `adws/phases/scenarioProof.ts` — add a `parseCucumberSummary()` helper, derive `scenarioOutcomePassed` from the tally, and surface a `warning` field on `TagProofResult` that the markdown builder renders when the override applies.
- `specs/issue-492-adw-2evbnk-bdd-rewrite-2-3-auth-sdlc_planner-bdd-authoring-smoke-surface-scenarios.md` — append a `### Scope amendment (post-build patch 5)` block under `## Notes` recording the targeted `adws/phases/scenarioProof.ts` edit, the rationale for relaxing the spec's "no edits to `adws/`" guard for this specific reviewer-sanctioned change, and the post-patch outcome (proof markdown now records PASS).

Out-of-scope (do NOT modify): `adws/cost/d1Client.ts` (option-a path, rejected above), `adws/core/phaseRunner.ts` (option-a path, rejected above), `adws/agents/bddScenarioRunner.ts` (the `allPassed = exitCode === 0` derivation is the source-of-truth process signal and other non-scenario callers may depend on its current semantics), `cucumber.js`, `test/mocks/**`, `features/regression/**`, `features/step_definitions/**`, every `.feature` file. The patch touches exactly one TypeScript file plus the spec markdown.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add a cucumber summary parser to `scenarioProof.ts`

Open `adws/phases/scenarioProof.ts`. Add the following helper between the existing `truncate()` function (currently lines 57-60) and `isNoScenariosOutput()` (currently lines 62-65):

```ts
/** Cucumber-js scenario tally extracted from a `--format summary` output line. */
interface CucumberTally {
  failed: number;
  undefinedSteps: number;
  pending: number;
  passed: number;
}

/**
 * Parses the cucumber-js scenarios summary line — e.g. `1646 scenarios (41 pending, 1605 passed)`.
 * Cucumber emits one such line per run. Only non-zero counts appear in the breakdown, so missing
 * categories default to 0. Returns null when no summary line is present (means cucumber crashed
 * before emitting one and the exit code is the only signal available).
 */
function parseCucumberSummary(stdout: string): CucumberTally | null {
  const matches = [...stdout.matchAll(/^\s*\d+ scenarios? \(([^)]+)\)\s*$/gm)];
  if (matches.length === 0) return null;
  const breakdown = matches[matches.length - 1][1];
  const numFor = (label: string): number => {
    const m = breakdown.match(new RegExp(`(\\d+) ${label}\\b`));
    return m ? Number(m[1]) : 0;
  };
  return {
    failed: numFor('failed'),
    undefinedSteps: numFor('undefined'),
    pending: numFor('pending'),
    passed: numFor('passed'),
  };
}
```

The `undefinedSteps` field name avoids the reserved-word collision the TypeScript compiler would flag for `undefined` as a property name in some strict configurations (the file already runs under `bunx tsc --noEmit -p adws/tsconfig.json`).

### Step 2: Add an optional `warning` field to `TagProofResult`

Inside the `TagProofResult` interface (currently lines 20-35), append a new optional field after `skipped`:

```ts
  /**
   * Optional explanation when scenario outcome and process exit code disagree —
   * e.g. cucumber tally was clean (0 failed, 0 undefined) but the subprocess
   * exited non-zero due to post-suite noise (KPI/D1 write failures, unhandled
   * rejections in shutdown hooks). Rendered in the proof markdown so reviewers
   * see why a non-zero exit was overridden to PASS.
   */
  warning?: string;
```

### Step 3: Override `passed` in the `runScenarioProof` loop body when the tally is clean

Locate the `for (const entry of reviewProofConfig.tags)` loop (currently starting at line 141). Replace the body's pass-derivation block with a tally-aware version. The current block reads:

```ts
    const result = await runScenariosByTag(runByTagCommand, tagName, cwd);

    const noScenarios = result.allPassed && isNoScenariosOutput(result.stdout);
    if (entry.optional && noScenarios) {
      tagResults.push({
        tag: entry.tag,
        resolvedTag,
        severity: entry.severity,
        optional: true,
        passed: true,
        output: '',
        exitCode: result.exitCode,
        skipped: true,
      });
    } else {
      tagResults.push({
        tag: entry.tag,
        resolvedTag,
        severity: entry.severity,
        optional: entry.optional ?? false,
        passed: result.allPassed,
        output: truncate(result.stdout),
        exitCode: result.exitCode,
        skipped: false,
      });
    }
```

Replace with:

```ts
    const result = await runScenariosByTag(runByTagCommand, tagName, cwd);

    // Cucumber can exit non-zero from post-suite noise (e.g. KPI/D1 write failures
    // logged after the summary line, unhandled rejections in shutdown hooks) even
    // when every scenario passed. Trust the cucumber summary tally over the exit
    // code when it is unambiguous: 0 failed AND 0 undefined ⇒ scenario outcome is
    // PASS regardless of exitCode. Surface a warning so reviewers see why an
    // override applied.
    const tally = parseCucumberSummary(result.stdout);
    const tallyClean = tally !== null && tally.failed === 0 && tally.undefinedSteps === 0;
    const scenarioOutcomePassed = result.allPassed || tallyClean;
    const overrideWarning =
      !result.allPassed && tallyClean
        ? `Process exited ${result.exitCode} but cucumber tally was clean ` +
          `(${tally!.passed} passed, ${tally!.pending} pending, 0 failed, 0 undefined). ` +
          `Treating as PASS — non-scenario noise (e.g. post-suite KPI/D1 writes, ` +
          `shutdown-hook rejections) is preserved verbatim in the Output section below.`
        : undefined;

    const noScenarios = scenarioOutcomePassed && isNoScenariosOutput(result.stdout);
    if (entry.optional && noScenarios) {
      tagResults.push({
        tag: entry.tag,
        resolvedTag,
        severity: entry.severity,
        optional: true,
        passed: true,
        output: '',
        exitCode: result.exitCode,
        skipped: true,
      });
    } else {
      tagResults.push({
        tag: entry.tag,
        resolvedTag,
        severity: entry.severity,
        optional: entry.optional ?? false,
        passed: scenarioOutcomePassed,
        output: truncate(result.stdout),
        exitCode: result.exitCode,
        skipped: false,
        warning: overrideWarning,
      });
    }
```

The non-null assertion `tally!` is safe inside the `tallyClean` branch (`tallyClean` requires `tally !== null`).

### Step 4: Render the warning in the proof markdown

Update `buildProofMarkdown` (currently lines 67-98). After the `**Exit Code:** …` line and before the existing blank line preceding `### Output`, conditionally insert a `**Warning:** …` line when `result.warning` is set. The current block reads:

```ts
    lines.push(
      `## ${result.resolvedTag} Scenarios (severity: ${result.severity})`,
      '',
      `**Status:** ${statusLabel}`,
      `**Exit Code:** ${result.exitCode ?? 'null'}`,
      '',
      '### Output',
      '',
      '```',
      result.skipped ? '(skipped — no matching scenarios)' : (result.output || '(no output)'),
      '```',
      '',
    );
```

Replace with:

```ts
    lines.push(
      `## ${result.resolvedTag} Scenarios (severity: ${result.severity})`,
      '',
      `**Status:** ${statusLabel}`,
      `**Exit Code:** ${result.exitCode ?? 'null'}`,
    );
    if (result.warning) {
      lines.push(`**Warning:** ${result.warning}`);
    }
    lines.push(
      '',
      '### Output',
      '',
      '```',
      result.skipped ? '(skipped — no matching scenarios)' : (result.output || '(no output)'),
      '```',
      '',
    );
```

This keeps the per-tag rendering format stable for tags without a warning (the current consumers `adws/github/proofCommentFormatter.ts` only reference `tag`, `resolvedTag`, `severity`, `passed`, `skipped`, `output`, `exitCode` — adding a new `**Warning:**` markdown line is additive and they continue to work unchanged).

### Step 5: Re-run @regression and regenerate the proof artefact

From the worktree root:

```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary --format @cucumber/pretty-formatter \
  > agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log 2>&1; \
  echo "EXIT_CODE=$?" >> agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log
```

Then trigger scenarioProof regeneration. Because the existing proof artefact at `agents/2evbnk-bdd-rewrite-2-3-auth/scenario_proof.md` was written by a prior pipeline run, regenerate it via the same code path the orchestrator uses. The minimal way is a one-off `bunx tsx` script that calls `runScenarioProof` with the project's `ReviewProofConfig` (loaded via `adws/core/projectConfig.ts`):

```sh
bunx tsx -e '
  import("./adws/phases/scenarioProof.ts").then(async ({ runScenarioProof }) => {
    const { loadReviewProofConfig } = await import("./adws/core/projectConfig.ts");
    const fs = await import("fs");
    const reviewProofConfig = loadReviewProofConfig();
    const scenariosMd = fs.readFileSync(".adw/scenarios.md", "utf-8");
    const runByTagCommand = `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@{tag}"`;
    const result = await runScenarioProof({
      scenariosMd,
      reviewProofConfig,
      runByTagCommand,
      issueNumber: 492,
      proofDir: "agents/2evbnk-bdd-rewrite-2-3-auth",
    });
    console.log("hasBlockerFailures:", result.hasBlockerFailures);
    console.log("resultsFilePath:", result.resultsFilePath);
  });
'
```

Inspect the regenerated `agents/2evbnk-bdd-rewrite-2-3-auth/scenario_proof.md`:

- The `## @regression Scenarios (severity: blocker)` heading must report `**Status:** ✅ PASSED`.
- The `**Exit Code:**` line will continue to read `1` (this is preserved deliberately).
- A new `**Warning:** …` line must appear documenting the override and the clean tally.
- The console output from the regeneration script must print `hasBlockerFailures: false`.

If `loadReviewProofConfig` is exposed under a different name in `adws/core/projectConfig.ts`, adjust the import accordingly — the only shape the regeneration script depends on is the same `ReviewProofConfig` type referenced by `scenarioProof.ts:13`.

### Step 6: Append spec scope amendment

Open `specs/issue-492-adw-2evbnk-bdd-rewrite-2-3-auth-sdlc_planner-bdd-authoring-smoke-surface-scenarios.md` and append after the existing `### Scope amendment (post-build patch 4)` block:

```md
### Scope amendment (post-build patch 5)

Patch 4's final captured outcome left the cucumber subprocess exiting non-zero (1) due to
four pre-existing post-suite `D1 write failed: TypeError: fetch failed` warnings emitted
after the scenario summary, even though the tally was clean (1646 scenarios — 41 pending,
1605 passed, 0 failed, 0 undefined). The non-zero exit propagated through
`adws/agents/bddScenarioRunner.ts:70` (`allPassed: exitCode === 0`) and caused
`agents/2evbnk-bdd-rewrite-2-3-auth/scenario_proof.md` to record `@regression` as
`❌ FAILED` — which violates Strategy A's blocker check verbatim despite the clean
scenario tally.

To resolve this without further deepening the post-shutdown investigation in `adws/cost/`
or `adws/core/`, the reviewer sanctioned a single targeted edit to
`adws/phases/scenarioProof.ts` (option (b) of the change request): parse the cucumber
summary line and override `passed` to `true` when the tally reports `0 failed` and
`0 undefined`, regardless of process exit code. The exit code itself is preserved in the
proof artefact and a new `**Warning:** …` line documents the override so reviewers retain
full visibility into the post-suite noise.

This is the first patch in the Issue #492 sequence to touch `adws/`. Spec line 44's
"no edits to `adws/`" guard applies to the original chore scope (BDD authoring); this
patch does not author scenarios — it fixes a proof-generation defect surfaced only by
running the new authored scenarios. The reviewer's change request explicitly directs the
edit ("update adws/phases/scenarioProof.ts to parse the cucumber summary line"), making
this a sanctioned scope deviation for patch-time defect resolution.

Patch file: `specs/patch/patch-adw-2evbnk-bdd-rewrite-2-3-auth-scenario-proof-pass-on-clean-tally.md`

Final captured outcome (re-run after this patch):
- Cucumber process exit code: 1 (unchanged — pre-existing D1 KPI write noise after teardown)
- Summary tally: 1646 scenarios (41 pending, 1605 passed, 0 failed, 0 undefined)
- `scenario_proof.md` `@regression` status: `✅ PASSED` (override applied, warning surfaced)
- Strategy A blocker check: `hasBlockerFailures: false` — merge gate satisfied.
```

If the regeneration in step 5 produces a different tally, replace the `Final captured outcome` block with the actual numbers before committing.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — `adws/phases/scenarioProof.ts` must lint cleanly. The new helper, the optional interface field, and the additive `lines.push` branch are all idiomatic and engage no new ESLint rules.
- `bunx tsc --noEmit` — host TypeScript type-check passes. The new `CucumberTally` interface and `parseCucumberSummary` helper introduce no new external deps.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` project type-check passes. Critical because `TagProofResult` is re-exported from `adws/phases/index.ts:45` and consumed by `adws/github/proofCommentFormatter.ts` and `adws/phases/scenarioFixPhase.ts` — adding an optional field is type-compatible with all existing readers.
- `bun run test:unit` — vitest still green. `adws/core/__tests__/phaseRunner.test.ts` mocks `postCostRecordsToD1` (line 21) and is unaffected. There is no existing unit test for `scenarioProof.ts` (verified via `find . -name "scenarioProof*.test.ts"` — none); this patch does not add one because the change is mechanical and the end-to-end re-run in step 5 is the canonical evidence.
- `bun run build` — full build succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary --format @cucumber/pretty-formatter > agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log 2>&1; echo "EXIT_CODE=$?" >> agents/2evbnk-bdd-rewrite-2-3-auth/regression-full-output.log` — the captured log must continue to show the clean tally (`1646 scenarios (41 pending, 1605 passed)`) and `EXIT_CODE=1` (the underlying post-suite noise is intentionally not addressed by this patch).
- Regenerate `agents/2evbnk-bdd-rewrite-2-3-auth/scenario_proof.md` per step 5's `bunx tsx -e …` script and inspect the file: the `## @regression Scenarios` block must report `**Status:** ✅ PASSED`, must include a `**Warning:** Process exited 1 but cucumber tally was clean …` line, and the `hasBlockerFailures` console output must read `false`.

## Patch Scope
**Lines of code to change:** ~50 lines added in `adws/phases/scenarioProof.ts` (a 20-line helper for the summary parser, a 7-line interface field with comment, an ~18-line replacement of the loop body's pass-derivation block, and a 5-line conditional `lines.push` for the warning rendering). Zero lines deleted from existing logic. Plus ~30 lines of spec amendment.

**Risk level:** low. The patch is additive across all three changes:
- The `parseCucumberSummary` helper is a pure function with no side effects and a defensive `null` return when no summary line is present (cucumber-crash case preserves the original `result.allPassed` semantics).
- The `scenarioOutcomePassed` derivation falls back to `result.allPassed` when the tally is unparseable or non-clean — i.e. the patch only changes behaviour for the specific case the reviewer flagged (clean tally + non-zero exit).
- The `warning` field is optional; consumers that don't read it (`proofCommentFormatter.ts`, `scenarioFixPhase.ts`) are unaffected.
- The markdown rendering change is purely additive — tags without a warning produce identical output to the pre-patch behaviour.

**Testing required:** Lint + type-check + unit-test + full @regression re-run + regenerated `scenario_proof.md` inspection. The regenerated proof artefact is the canonical merge-gate evidence: `✅ PASSED` for `@regression` blocker tag confirms Strategy A's `hasBlockerFailures: false` gate is satisfied.
