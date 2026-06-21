# Patch: Wire the region-overlap serialization gate into the live cron

## Metadata
adwId: `ni6fpk-feat-serialize-issue`
reviewChangeRequest: `Issue #1: The region-overlap serialization gate is never invoked in production. trigger_cron.ts:238 calls filterEligibleIssues with only 7 arguments, omitting the 8th resolveTouchedFiles parameter, so cronIssueFilter.ts:215-217 hits the early guard and returns before the overlap pass runs; overlapDeferrals is also discarded at the call site. grep confirms trigger_cron.ts is the sole non-test caller. The feature is dead code at runtime — the green @adw-649 scenarios pass only because the BDD steps inject resolveTouchedFiles themselves (feature-649.steps.ts:128). Acceptance criterion 'two issues that edit the same region are not built in parallel; one blocks the other' is unmet in the live cron. Resolution: Wire a real touched-files resolver into the filterEligibleIssues call in trigger_cron.ts, consume the returned overlapDeferrals (e.g. log them via the cron deferral path), and add a regression scenario that drives the live cron path rather than the injected helper so the wiring cannot silently regress.`

## Issue Summary
**Original Spec:** `specs/issue-649-adw-ni6fpk-feat-serialize-issue-sdlc_planner-serialize-overlapping-region-issues.md`

**Issue:** The region-overlap serialization gate built into `filterEligibleIssues` is dead code in production. The sole non-test caller — `trigger_cron.ts:238` — invokes `filterEligibleIssues` with 7 arguments, omitting the 8th `resolveTouchedFiles` parameter and discarding the returned `overlapDeferrals`. With no resolver, `cronIssueFilter.ts:215-217` hits the early guard `if (!resolveTouchedFiles) { return ... overlapDeferrals: [] }` and returns *before* the overlap pass runs. The cron therefore never serializes region-colliding issues. The green `@adw-649` scenarios pass only because the BDD steps inject their own resolver (`feature-649.steps.ts:128`), so the production gap is invisible to the suite. AC1 ("two issues that edit the same region are not built in parallel; one blocks the other") is unmet in the live cron.

**Solution:** Provide a real, deterministic, I/O-free touched-files resolver (`resolveTouchedFilesFromBody`, derived from the issue body's `## Touched Files` / `## Relevant Files` section via the existing `parseRelevantFilesSection`) and make it the **default** value of the `resolveTouchedFiles` parameter so the overlap pass runs in production and cannot be silently dropped by a future call-site omission. Wire it explicitly at the `trigger_cron.ts` call site (per the review), destructure and **log** the returned `overlapDeferrals` through the existing cron deferral path (`Issue #N deferred: ...`). Add a per-issue regression scenario whose step driver invokes `filterEligibleIssues` with **no injected resolver** — exercising the production default over real issue *bodies* — so the resolver wiring cannot silently regress. Belt-and-braces: a unit test asserting the default resolver serializes two body-overlapping issues.

## Files to Modify
Use these files to implement the patch:

- `adws/triggers/cronIssueFilter.ts` — add `resolveTouchedFilesFromBody`, default the `resolveTouchedFiles` param to it, replace the now-dead `!resolveTouchedFiles` early guard with a `spawnCandidates.length < 2` short-circuit.
- `adws/triggers/trigger_cron.ts` — pass `resolveTouchedFilesFromBody` to the `filterEligibleIssues` call, destructure `overlapDeferrals`, and log each one via the cron deferral path.
- `features/per-issue/step_definitions/feature-649.steps.ts` — add a body-fixture builder, a `Given` that declares touched files in the issue **body**, and a `When` that drives `filterEligibleIssues` using the production **default** resolver (no injected helper).
- `features/per-issue/feature-649.feature` — add a `§8` block (tagged `@adw-649`) with two scenarios proving the live default resolver serializes overlapping bodies and keeps disjoint bodies parallel.
- `adws/triggers/__tests__/cronIssueFilter.test.ts` — add a unit test asserting `filterEligibleIssues` with **no** injected resolver serializes two issues whose bodies declare the same touched file (guards the default wiring).

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add the real resolver and make it the default in `cronIssueFilter.ts`
- Extend the existing import on line 13 to also pull in the body parser:
  `import { decideSerialization, parseRelevantFilesSection } from './regionOverlap';`
- Add an exported, pure resolver (place it just above `filterEligibleIssues`):
  ```ts
  /**
   * Production touched-files resolver: derives an issue's touched paths from its
   * body's `## Touched Files` / `## Relevant Files` section. Deterministic, no I/O.
   * It is the default `resolveTouchedFiles` for `filterEligibleIssues`, so the
   * region-overlap pass runs in the live cron and cannot be silently dropped at a
   * call site. Tests may inject a different resolver to drive the pass directly.
   */
  export function resolveTouchedFilesFromBody(issue: CronIssue): string[] {
    return parseRelevantFilesSection(issue.body ?? '');
  }
  ```
- Change the parameter from optional to defaulted:
  `resolveTouchedFiles: (issue: CronIssue) => string[] = resolveTouchedFilesFromBody,`
- Replace the dead early guard (currently `cronIssueFilter.ts:215-217`)
  ```ts
  if (!resolveTouchedFiles) {
    return { eligible: initialEligible, filteredAnnotations, overlapDeferrals: [] };
  }

  // Region-overlap serialization pass over spawn-eligible candidates.
  const spawnCandidates = initialEligible.filter(e => e.action === 'spawn');
  ```
  with a "nothing can collide" short-circuit that also avoids parsing bodies on the common path:
  ```ts
  // Region-overlap serialization pass over spawn-eligible candidates.
  const spawnCandidates = initialEligible.filter(e => e.action === 'spawn');
  if (spawnCandidates.length < 2) {
    return { eligible: initialEligible, filteredAnnotations, overlapDeferrals: [] };
  }
  ```
- Update the `filterEligibleIssues` JSDoc to state that `resolveTouchedFiles` defaults to `resolveTouchedFilesFromBody` (issue-body section parse) and that the pass therefore runs by default.
- Note (safety): existing `cronIssueFilter.test.ts` fixtures use `body: 'issue body'`, which `parseRelevantFilesSection` returns as `[]`, and every existing `filterEligibleIssues` test has ≤1 spawn-eligible candidate — both the empty-signal rule and the `< 2` guard preserve their current results.

### Step 2: Wire the resolver and log deferrals in `trigger_cron.ts`
- Extend the import on line 35:
  `import { filterEligibleIssues, resolveTouchedFilesFromBody } from './cronIssueFilter';`
- Update the call at lines 238-246 to pass the resolver and destructure `overlapDeferrals`:
  ```ts
  const { eligible: candidates, filteredAnnotations, overlapDeferrals } = filterEligibleIssues(
    issues,
    now,
    { spawns: processedSpawns },
    GRACE_PERIOD_MS,
    resolveIssueWorkflowStage,
    cancelledThisCycle,
    labelRecovery,
    resolveTouchedFilesFromBody,
  );
  ```
- Immediately after the `POLL: ...` log line (~line 250), surface each region-overlap deferral through the existing cron deferral path (mirrors the `Issue #N deferred: ...` shape at lines 277-281). Region-deferred issues are absent from `candidates`, so they must be logged here:
  ```ts
  for (const deferral of overlapDeferrals) {
    log(`Issue #${deferral.issueNumber} deferred: region overlap with #${deferral.blockedBy} [${deferral.overlapPaths.join(', ')}]`);
  }
  ```

### Step 3: Add a live-path regression scenario driver in `feature-649.steps.ts`
- Add a body-fixture builder beside `makeEligibleCronIssue` (it must keep `comments: []` so the default stage resolver yields `stage=null` → spawn-eligible, and `OLD_DATE` so the grace period passes):
  ```ts
  function makeBodyIssue(number: number, touchedFiles: string): CronIssue {
    const bullets = parsePaths(touchedFiles).map(p => `- \`${p}\``).join('\n');
    return {
      number,
      body: `## Touched Files\n${bullets}\n`,
      comments: [],
      createdAt: OLD_DATE,
      updatedAt: OLD_DATE,
      labels: [],
    };
  }
  ```
- Add a runner that drives the production default (no injected resolver, no injected stage resolver):
  ```ts
  function runFilterLive(): EvalResult {
    const issues = [...ctx.cronIssues.values()];
    const result = filterEligibleIssues(issues, NOW, { spawns: new Set() }, GRACE_PERIOD_MS);
    return { eligible: result.eligible, overlapDeferrals: result.overlapDeferrals };
  }
  ```
- Add the two new step phrases (reuse the existing `Then` assertions for eligibility/deferral):
  ```ts
  Given(
    'a backlog issue {int} whose body declares touched files {string}',
    function (issueNumber: number, touchedFiles: string) {
      ctx.cronIssues.set(issueNumber, makeBodyIssue(issueNumber, touchedFiles));
    },
  );

  When(
    'the issue router evaluates the backlog with the live touched-files resolver',
    function () {
      ctx.firstEval = runFilterLive();
    },
  );
  ```

### Step 4: Add the `§8` live-wiring scenarios to `feature-649.feature`
- Append a commented `§8` block (after `§7`) tagged `@adw-649 @adw-ni6fpk-feat-serialize-issue` only — NOT `@regression`: the `@regression` Before/After hooks call the heavyweight `setupMockInfrastructure()`, which this pure in-memory pass does not need, and the existing `@adw-649` scenarios deliberately use only the lightweight local hooks. The block explains that these scenarios drive the **production default** resolver (`resolveTouchedFilesFromBody` over the issue body) rather than an injected map, closing the dead-wiring gap the review found:
  ```gherkin
  @adw-649 @adw-ni6fpk-feat-serialize-issue
  Scenario: The live cron resolver serializes two issues whose bodies declare the same touched file
    Given a backlog issue 64905 whose body declares touched files "adws/triggers/takeoverHandler.ts"
    And a backlog issue 64906 whose body declares touched files "adws/triggers/takeoverHandler.ts"
    When the issue router evaluates the backlog with the live touched-files resolver
    Then exactly one of issue 64905 and issue 64906 is eligible to spawn
    And the other of issue 64905 and issue 64906 is deferred behind the eligible one for an overlapping code region

  @adw-649 @adw-ni6fpk-feat-serialize-issue
  Scenario: The live cron resolver leaves issues whose bodies declare disjoint files both eligible
    Given a backlog issue 64907 whose body declares touched files "adws/triggers/cronIssueFilter.ts"
    And a backlog issue 64908 whose body declares touched files "adws/phases/planPhase.ts"
    When the issue router evaluates the backlog with the live touched-files resolver
    Then both issue 64907 and issue 64908 are eligible to spawn
  ```

### Step 5: Add a unit test guarding the default wiring in `cronIssueFilter.test.ts`
- Add a `describe('filterEligibleIssues — region-overlap default resolver wiring')` with a test that calls `filterEligibleIssues([a, b], NOW, { spawns: new Set() }, GRACE_PERIOD_MS)` — **omitting** the resolver — where `a` and `b` have `comments: []` and bodies containing the same `## Touched Files` path. Assert exactly one is eligible and the other appears in `overlapDeferrals` with the correct `blockedBy`. This fails if the default is ever removed (the exact dead-code regression).

### Step 6: Run the Validation Commands
- Execute every command in "Validation" and resolve all errors/regressions to zero.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Lint for code-quality issues.
- `bunx tsc --noEmit` — Type-check the repository.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the `adws/` workspace (catches the new param-default / destructure typings).
- `bun run test:unit` — Run the Vitest unit suite (includes the new default-resolver wiring test and confirms no `cronIssueFilter` regressions).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-649"` — Run the per-issue suite, including the new `§8` live-wiring scenarios (the regression guard).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Confirm no behavioural regressions in the spawn/eligibility/plan paths.
- `bun run build` — Verify a clean build.

## Patch Scope
**Lines of code to change:** ~75 (≈20 production across two files; ≈55 test across three files)
**Risk level:** low — production behavioural change is exactly the intended fix (the cron now runs the overlap pass); the empty-signal rule + `< 2` guard keep every existing unit/BDD result unchanged; the new resolver is pure and I/O-free.
**Testing required:** Unit (`bun run test:unit`) for the default-resolver wiring; BDD `@adw-649` for the live-path scenarios; `@regression` BDD plus lint/tsc/build for zero-regression confirmation.
