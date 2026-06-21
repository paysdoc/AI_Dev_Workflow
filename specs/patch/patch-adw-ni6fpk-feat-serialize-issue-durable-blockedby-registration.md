# Patch: Make region-overlap serialization durable across cron cycles via an audited `## Blocked by` registration

## Metadata
adwId: `ni6fpk-feat-serialize-issue`
reviewChangeRequest: `Issue #2: Even once wired, the in-memory per-cycle pass cannot durably serialize across cron cycles and leaves no GitHub audit trail. inFlight is hardcoded false (cronIssueFilter.ts:224) and only spawn-candidates are considered, so once the anchor issue spawns and transitions to 'active' it leaves the candidate set; on the next ~20s poll the deferred issue has no overlapping sibling among candidates, decideSerialization returns serialize:false, and it spawns in parallel with the still-in-flight anchor — exactly the #638/#639 stale-base race this issue exists to prevent. No '## Blocked by' line is registered and no explanatory comment is posted (updateIssueBody/commentOnIssue are never called anywhere in the diff), so acceptance criterion 'the decision is logged/visible on GitHub so an operator can see why an issue was deferred' is also unmet. Resolution: Per the spec Solution Statement (§3-§4), idempotently register an annotated '## Blocked by #N <!-- adw:region-overlap -->' on the deferred issue and post a one-time explanatory comment, so the existing findOpenDependencies gate enforces it every cycle and handleIssueClosedDependencyUnblock re-spawns it on blocker merge. This makes serialization durable across cycles and auditable, rather than a single-cycle in-memory filter.`

## Issue Summary
**Original Spec:** `specs/issue-649-adw-ni6fpk-feat-serialize-issue-sdlc_planner-serialize-overlapping-region-issues.md`

**Issue:** The region-overlap gate is a purely **in-memory, per-cycle** filter (`filterEligibleIssues` → `overlapDeferrals`, only logged at `trigger_cron.ts:253-255`). Two failures:

1. **Not durable across cycles.** `decideSerialization` only sees this cycle's *spawn candidates*, and `inFlight` is hardcoded `false`. Cycle 1: anchor `#A` (lower number) proceeds, `#B` deferred in-memory. Cycle 2 (~20s later): `#A` is `active`/`processed` → it leaves the spawn-candidate set → `spawnCandidates.length < 2` short-circuits → `#B` is no longer deferred → `#B` spawns in parallel with the still-in-flight `#A`. This is exactly the #638/#639 stale-base race the issue exists to prevent.
2. **No GitHub audit trail.** `updateIssueBody`/`commentOnIssue` are never called in the diff, so AC "the decision is logged/visible on GitHub so an operator can see why an issue was deferred" is unmet.

**Solution:** Per the spec Solution Statement §3–§4, on a serialize decision **idempotently register an annotated `## Blocked by #N <!-- adw:region-overlap -->`** on the deferred issue and **post a one-time explanatory comment**. Enforcement and unblocking then ride the already-proven declared-dependency path:
- The cron's standard candidate loop already calls `checkIssueEligibility` → `findOpenDependencies` every cycle (`trigger_cron.ts:280`), so the registered blocker defers `#B` on **every** subsequent cycle regardless of whether `#A` is still a spawn candidate — closing the durability gap **without** needing to fix the `inFlight` hardcoding.
- `handleIssueClosedDependencyUnblock` (`webhookGatekeeper.ts:167`) re-spawns `#B` the moment `#A`'s PR merges and closes `#A`.

This converts the single-cycle in-memory filter into a durable, auditable serialization, reusing battle-tested infrastructure (minimal new enforcement code), exactly as the spec intended.

### Load-bearing correctness constraint (do not get this wrong)
The two consumers parse dependencies **differently**:
- `findOpenDependencies` (cron enforcement) → `extractDependencies` → `parseKeywordProximityDependencies` (whole-body proximity).
- `handleIssueClosedDependencyUnblock` (webhook unblock) → `parseDependencies` (**heading-only**, matches the **first** `## Dependencies`/`## Depends on`/`## Blocked by` heading and reads until the next `## `).

Sliced issues ship with a `## Blocked by\nNone - can start immediately` section from the PRD-to-issues template (issue #649's own body is an example). Therefore appending a **new** `## Blocked by` section at end-of-body is **invisible to the unblock path** (its first dep-heading is the "None" one). The annotated ref MUST be **inserted into the existing dep-heading section** (right after the heading line) when one exists, and only create a fresh `## Blocked by` section when none exists. Both consumers must resolve `#N` from the result.

## Files to Modify
Use these files to implement the patch:

- **New:** `adws/triggers/regionOverlapSignals.ts` — Side-effecting boundary (keeps `regionOverlap.ts` pure): `buildBlockedByBody`, `formatRegionOverlapComment`, and the idempotent, fail-safe `registerRegionOverlapBlocker`. DI-friendly so unit/BDD tests inject spies.
- `adws/triggers/trigger_cron.ts` — In the existing `overlapDeferrals` loop, look up the deferred issue's fetched body and call `registerRegionOverlapBlocker` (wrapped fail-safe).
- **New:** `adws/triggers/__tests__/regionOverlapSignals.test.ts` — Unit tests: section-aware insertion, `parseDependencies` round-trip (the "None" trap), idempotency, fail-safe, comment content.
- `features/per-issue/feature-649.feature` — Add a `§9` scenario (tagged `@adw-649 @adw-ni6fpk-feat-serialize-issue`) asserting the durable registration + audit trail.
- `features/per-issue/step_definitions/feature-649.steps.ts` — Add `§9` steps driving `registerRegionOverlapBlocker` with injected spies; assert via `parseDependencies` (the exact fn the unblock path uses) + captured comment.

> Out of scope / intentionally unchanged: `cronIssueFilter.ts` (the in-memory pass and the `inFlight: false` value stay — durable registration makes the hardcoding moot for cross-cycle durability) and `regionOverlap.ts` (must stay pure). No change to `issueEligibility.ts`/`issueDependencies.ts`/`webhookGatekeeper.ts` — the registered blocker flows through them unchanged.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create the side-effecting boundary `adws/triggers/regionOverlapSignals.ts`
- Keep all I/O here (per `.adw/coding_guidelines.md`); `regionOverlap.ts` stays pure.
- Implement (explicit types, guard clauses, no `any`):
  ```ts
  /**
   * Side-effecting boundary for region-overlap serialization.
   *
   * The pure decision lives in regionOverlap.ts. This module performs the GitHub
   * I/O that makes a serialization decision DURABLE and AUDITABLE: it registers an
   * annotated `## Blocked by #N` dependency on the deferred issue and posts a
   * one-time explanatory comment. Enforcement (every cron cycle, via
   * findOpenDependencies) and unblocking (on blocker close, via
   * handleIssueClosedDependencyUnblock) then ride the existing declared-dependency
   * path — no new enforcement code.
   */
  import type { RepoInfo } from '../github/githubApi';
  import { updateIssueBody, commentOnIssue } from '../github/issueApi';
  import { log } from '../core';
  import type { OverlapDeferral } from './cronIssueFilter';

  /** Annotation that makes an auto-added Blocked-by ref identifiable and idempotent. */
  export const REGION_OVERLAP_MARKER = '<!-- adw:region-overlap -->';

  /** Injectable I/O so unit/BDD tests can spy without touching GitHub. */
  export interface RegionOverlapRegistrationDeps {
    readonly updateIssueBody: (issueNumber: number, body: string, repoInfo: RepoInfo) => void;
    readonly commentOnIssue: (issueNumber: number, body: string, repoInfo: RepoInfo) => void;
  }

  const defaultDeps: RegionOverlapRegistrationDeps = { updateIssueBody, commentOnIssue };

  /** The annotated blocked-by reference line for a given blocker. */
  export function blockedByRef(blockedBy: number): string {
    return `#${blockedBy} ${REGION_OVERLAP_MARKER}`;
  }

  /**
   * Inserts the annotated ref so BOTH dependency parsers resolve it:
   *  - when a `## Dependencies`/`## Depends on`/`## Blocked by` heading exists,
   *    insert the ref immediately AFTER that first heading line (so the
   *    heading-only parseDependencies used by the unblock path picks it up even
   *    when the section already says "None - can start immediately");
   *  - otherwise append a fresh `## Blocked by` section.
   */
  export function buildBlockedByBody(currentBody: string, blockedBy: number): string {
    const ref = blockedByRef(blockedBy);
    const headingPattern = /^## (?:dependencies|depends on|blocked by)\b.*$/im;
    const match = currentBody.match(headingPattern);
    if (match && match.index !== undefined) {
      const insertAt = match.index + match[0].length;
      return `${currentBody.slice(0, insertAt)}\n${ref}${currentBody.slice(insertAt)}`;
    }
    return `${currentBody.trimEnd()}\n\n## Blocked by\n${ref}\n`;
  }

  /** One-time explanatory comment naming the blocker and the overlapping paths. */
  export function formatRegionOverlapComment(deferral: OverlapDeferral): string {
    const paths = deferral.overlapPaths.length > 0
      ? deferral.overlapPaths.map(p => `- \`${p}\``).join('\n')
      : '- (overlapping paths unavailable)';
    return [
      `⏸️ **Deferred behind #${deferral.blockedBy} — overlapping code region**`,
      '',
      `ADW detected that this issue edits code overlapping with #${deferral.blockedBy}, which is `
        + `already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward `
        + `push deadlock that follows), it has been serialized behind #${deferral.blockedBy} by `
        + `registering a \`## Blocked by\` dependency.`,
      '',
      'Overlapping paths:',
      paths,
      '',
      `This issue will spawn automatically once #${deferral.blockedBy} merges and closes. `
        + `To override, remove the \`${blockedByRef(deferral.blockedBy)}\` line from this issue body.`,
    ].join('\n');
  }

  /**
   * Idempotently registers the region-overlap blocker on the deferred issue and
   * posts a one-time explanatory comment. Returns true when it registered (first
   * time), false when already present or on a handled failure.
   *
   * Fail-safe (cf. app_docs/feature-fequcj): updateIssueBody RETHROWS, so a write
   * failure is caught and logged — the in-memory deferral already excluded the
   * issue THIS cycle (no parallel spawn), and the next cycle retries. The comment
   * is posted only on first successful registration, so it is one-time.
   */
  export function registerRegionOverlapBlocker(
    deferral: OverlapDeferral,
    currentBody: string,
    repoInfo: RepoInfo,
    deps: RegionOverlapRegistrationDeps = defaultDeps,
  ): boolean {
    if (currentBody.includes(blockedByRef(deferral.blockedBy))) {
      return false; // already registered — no double-append, no duplicate comment
    }
    try {
      deps.updateIssueBody(deferral.issueNumber, buildBlockedByBody(currentBody, deferral.blockedBy), repoInfo);
      deps.commentOnIssue(deferral.issueNumber, formatRegionOverlapComment(deferral), repoInfo);
      log(`Registered region-overlap blocker #${deferral.blockedBy} on issue #${deferral.issueNumber}`, 'success');
      return true;
    } catch (err) {
      log(`Failed to register region-overlap blocker on issue #${deferral.issueNumber}: ${err}`, 'warn');
      return false;
    }
  }
  ```

### Step 2: Wire registration into the cron `overlapDeferrals` loop (`trigger_cron.ts`)
- Add the import beside the other trigger imports:
  ```ts
  import { registerRegionOverlapBlocker } from './regionOverlapSignals';
  ```
- Replace the existing log-only loop (currently `trigger_cron.ts:253-255`) with log **plus** durable registration. Use `cronRepoInfo` (the `repoInfo` alias const is declared later, at line 257) and look up the deferred issue's already-fetched body from `issues`:
  ```ts
  for (const deferral of overlapDeferrals) {
    log(`Issue #${deferral.issueNumber} deferred: region overlap with #${deferral.blockedBy} [${deferral.overlapPaths.join(', ')}]`);
    const deferredBody = issues.find(i => i.number === deferral.issueNumber)?.body ?? '';
    registerRegionOverlapBlocker(deferral, deferredBody, cronRepoInfo);
  }
  ```
- (`registerRegionOverlapBlocker` is synchronous and never throws, so no `await`/try-catch is needed at the call site.)

### Step 3: Unit-test the boundary (`adws/triggers/__tests__/regionOverlapSignals.test.ts`)
- Import `parseDependencies` from `../issueDependencies` and use it to prove the round-trip (this is the exact function the unblock path uses):
  - **The "None" trap (regression guard):** `buildBlockedByBody("## Blocked by\nNone - can start immediately\n\n## Notes\nx", 700)` → assert `parseDependencies(result).includes(700)` is **true** and the ref sits inside the `## Blocked by` section (not after `## Notes`).
  - **No section present:** `buildBlockedByBody("Just a plain body.", 700)` → appends a `## Blocked by` section; `parseDependencies(result).includes(700)` true.
  - **Idempotency:** with spy deps, first `registerRegionOverlapBlocker` returns `true` and calls `updateIssueBody` + `commentOnIssue` exactly once; calling it again with the **returned** body (now containing the marker) returns `false` and makes **zero** further calls.
  - **Fail-safe:** spy `updateIssueBody` throws → `registerRegionOverlapBlocker` returns `false`, does not rethrow, and does **not** call `commentOnIssue`.
  - **Audit content:** the body passed to `updateIssueBody` contains `#700 <!-- adw:region-overlap -->`; the comment passed to `commentOnIssue` names `#700` and lists an overlapping path.

### Step 4: Add the `§9` durability/audit BDD scenario (`feature-649.feature`)
- Append after `§8`, tagged `@adw-649 @adw-ni6fpk-feat-serialize-issue` only (NOT `@regression` — this is a hermetic in-process check, matching the existing per-issue scenarios; the `@regression` hooks spin up heavyweight mock infra this does not need):
  ```gherkin
  # ── §9 Durable, auditable serialization (review issue #2) ─────────────────────────
  #
  # §2–§8 prove the in-memory per-cycle partition. But that pass cannot serialize
  # across cron cycles (the anchor leaves the candidate set once active) and writes
  # nothing to GitHub. These steps drive the production registration boundary
  # (registerRegionOverlapBlocker) with injected spies and assert the deferral is
  # made DURABLE (a Blocked-by dependency the gate detects on every cycle) and
  # AUDITABLE (a one-time explanatory comment) — guarding the regression the review
  # identified: that updateIssueBody/commentOnIssue were never called.

  @adw-649 @adw-ni6fpk-feat-serialize-issue
  Scenario: A region-overlap deferral durably registers a Blocked by dependency and posts an explanatory comment
    Given a deferred issue 64909 whose body has a "## Blocked by" section reading "None - can start immediately"
    When ADW registers a region-overlap blocker behind issue 64801 for overlapping path "adws/triggers/takeoverHandler.ts"
    Then issue 64909's updated body declares a dependency on issue 64801 that the dependency parser detects
    And a one-time region-overlap comment naming issue 64801 is posted on issue 64909
  ```

### Step 5: Add the `§9` step definitions (`feature-649.steps.ts`)
- Import the boundary + `parseDependencies`, add `ctx` capture fields, and drive the helper with spies:
  ```ts
  import { registerRegionOverlapBlocker } from '../../../adws/triggers/regionOverlapSignals.ts';
  import { parseDependencies } from '../../../adws/triggers/issueDependencies.ts';
  // ctx additions: regBody: string | null; regComment: string | null; regDeferredNumber: number;
  ```
  ```ts
  Given(
    'a deferred issue {int} whose body has a "## Blocked by" section reading {string}',
    function (issueNumber: number, sectionText: string) {
      ctx.regDeferredNumber = issueNumber;
      ctx.regBodyInput = `## Blocked by\n${sectionText}\n\n## Notes\nplaceholder\n`;
    },
  );

  When(
    'ADW registers a region-overlap blocker behind issue {int} for overlapping path {string}',
    function (blockedBy: number, overlapPath: string) {
      const deferral = { issueNumber: ctx.regDeferredNumber, blockedBy, overlapPaths: [overlapPath] };
      const repoInfo = { owner: 'o', repo: 'r' } as RepoInfo;
      registerRegionOverlapBlocker(deferral, ctx.regBodyInput, repoInfo, {
        updateIssueBody: (_n, body) => { ctx.regBody = body; },
        commentOnIssue: (_n, body) => { ctx.regComment = body; },
      });
    },
  );

  Then(
    "issue {int}'s updated body declares a dependency on issue {int} that the dependency parser detects",
    function (_deferred: number, blockedBy: number) {
      assert.ok(ctx.regBody, 'expected updateIssueBody to be called');
      assert.ok(ctx.regBody!.includes(`#${blockedBy} <!-- adw:region-overlap -->`));
      assert.ok(parseDependencies(ctx.regBody!).includes(blockedBy));
    },
  );

  Then(
    'a one-time region-overlap comment naming issue {int} is posted on issue {int}',
    function (blockedBy: number, _deferred: number) {
      assert.ok(ctx.regComment, 'expected commentOnIssue to be called once');
      assert.ok(ctx.regComment!.includes(`#${blockedBy}`));
    },
  );
  ```
  - Add `RepoInfo` to the type imports and the new `ctx` fields (with resets in the existing `Before`/`After` hooks). Reuse the file's existing assertion/import conventions.

### Step 6: Run the Validation Commands
- Execute every command in "Validation" and resolve all errors/regressions to zero.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Lint for code-quality issues.
- `bunx tsc --noEmit` — Type-check the repository.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the `adws/` workspace (new module + DI typings).
- `bun run test:unit` — Vitest, including the new `regionOverlapSignals` tests (idempotency, fail-safe, and the `parseDependencies` "None"-section round-trip) with zero `cronIssueFilter`/`trigger_cron` regressions.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-649"` — Per-issue suite incl. the new `§9` durability/audit scenario.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — No behavioural regressions in the spawn/eligibility/plan paths.
- `bun run build` — Verify a clean build.

## Patch Scope
**Lines of code to change:** ~210 (≈80 new production in `regionOverlapSignals.ts` + ≈4 in `trigger_cron.ts`; ≈90 unit test + ≈35 BDD).
**Risk level:** medium — introduces GitHub **write** side effects (issue-body edit + comment) into the live cron loop. Mitigated by: the marker-guarded idempotency (one write, one comment, ever), the fail-safe try/catch around the rethrowing `updateIssueBody` (a write failure never crashes the tick and the in-memory deferral still blocks the parallel spawn that cycle), and the writes being gated behind a high-confidence overlap decision that already excluded the issue. Enforcement/unblocking reuse the unchanged, hardened declared-dependency path.
**Testing required:** Unit (`regionOverlapSignals.test.ts`) for insertion/round-trip/idempotency/fail-safe; BDD `@adw-649` `§9` for the durable-audit contract; `@regression` + lint/tsc/build for zero-regression confirmation.
