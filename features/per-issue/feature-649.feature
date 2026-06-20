@adw-649 @adw-ni6fpk-feat-serialize-issue
Feature: Serialize issues that edit overlapping code regions instead of spawning them in parallel — defer one colliding sibling behind the other rather than letting both build on a base that will go stale

  Issue #649 removes the *cause* of the stale-base / forced-rebase / push-deadlock
  chain. When a PRD is sliced into issues (or dependencies are extracted), two
  issues that edit the SAME code region can be marked as independent siblings and
  spawned in parallel. If both modify that region and one merges first, the second
  is left on a stale base whose merge would silently revert the first's work —
  caught (at best) as an integration-regression review blocker and resolved only by
  rebasing the second onto the merged base. That rebase rewrites history and then
  trips the non-forcing push deadlock (companion issue #648).

  Live incident this slice prevents: #638 and #639 were sliced as parallel siblings
  (both "blocked by #637") but both edit the `phase_timeout` recovery branch in
  `takeoverHandler` — i.e. the same file `adws/triggers/takeoverHandler.ts`. #639
  merged first; #638's stale base would have dropped #639's resume cap. The forced
  rebase then deadlocked on push. Had #638 been ordered *after* #639, the rebase —
  and the deadlock — would never have happened.

  The fix lives in dependency extraction / issue routing: detect when two open or
  in-flight issues are likely to edit overlapping files/regions and SERIALIZE them
  (one defers behind the other) rather than letting both spawn. This reuses the
  existing routing surfaces rather than inventing a parallel one:

    • `filterEligibleIssues` (`adws/triggers/cronIssueFilter.ts`) already decides,
      over the whole backlog, which issues are eligible to spawn and emits an
      annotation for every excluded one — the natural home for a cross-issue
      serialization pass (it is the only routing surface that sees all candidates
      at once; `evaluateIssue` is per-issue and cannot see a sibling).
    • `EligibilityResult` / `FilterResult` already carry a `reason` (and
      `blockingIssues`) field, so a deferral cause is a RETURNED value, exactly the
      shape the dependency path already uses (`reason: 'open_dependencies',
      blockingIssues: [...]`).
    • `globsOverlap` (`adws/core/docsGuards.ts`) is the existing path-overlap
      template the heuristic mirrors — a pure, side-effect-free decision over two
      path inputs.
    • `parseDependencies` already recognises a `## Blocked by` section, so
      "register a `## Blocked by` dependency" is one permitted mechanism whose
      observable proxy is identical to the in-memory deferral (see Scope notes).
    • The cron already logs `Issue #N deferred: <reason>`
      (`adws/triggers/trigger_cron.ts:278-280`) — the operator-visible surface the
      new deferral reuses.

  The behavioural contract pinned below:

    1. REGION-OVERLAP HEURISTIC (AC1 core). A pure decision over two issues'
       touched-file sets returns overlap=true iff the sets share at least one
       touched path, and false when the sets are disjoint. The headline incident —
       two issues both touching `adws/triggers/takeoverHandler.ts` — overlaps;
       two issues touching different files do not.
    2. NO FALSE SERIALIZATION (AC2). Two spawn-eligible issues whose touched-file
       sets are disjoint BOTH remain eligible to spawn — parallel throughput is
       preserved, nothing is needlessly held back.
    3. OVERLAP SERIALIZES (AC1). Of two spawn-eligible issues that share a touched
       file, EXACTLY ONE remains eligible to spawn and the other is deferred behind
       it for an overlapping region — never both in parallel. A disjoint third
       issue in the same backlog still spawns (selective, not blanket,
       serialization).
    4. THE DEFERRAL IS OPERATOR-VISIBLE (AC3). The deferred issue's decision
       identifies the overlapping-region cause and names the issue it is serialized
       behind, so an operator can see WHY it was held back — the same way the
       dependency deferral names its blocking issues.
    5. DETERMINISTIC PARTITION (no flapping). Re-evaluating the same backlog yields
       the SAME eligible/deferred split — the same issue keeps proceeding and the
       same one keeps waiting. Without this the pair would alternate and neither
       would make durable progress.
    6. POST-PLANNING ORDERING RECOMMENDATION (issue bullet 2). When the overlap is
       only knowable after planning — two in-flight issues whose plans declare
       overlapping relevant files — an operator-visible ordering recommendation
       naming the colliding issues is surfaced before build.
    7. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the
       overlap heuristic and the serialization pass land.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES — the verdict a
    pure decision returns, the eligible/deferred partition the backlog router
    computes over injected candidates, the deferral reason it returns, the ordering
    recommendation it records, or the type-checker's verdict. No step reads
    `adws/triggers/cronIssueFilter.ts`, `adws/triggers/issueEligibility.ts`,
    `adws/triggers/issueDependencies.ts`, `adws/core/docsGuards.ts`, the
    PRD-to-issues SKILL, or any source file as text, substring-matches its
    contents, or parses it as JSON/AST.

      • §1 asserts the RETURNED verdict of the pure overlap decision over literal
        path-set inputs — the same assert-the-returned-value pattern feature-641 §1
        uses for `deterministicBranchName` and feature-639 §1 for
        `nextResumeAction`. The `"true"`/`"false"` verdict is the decision's
        documented return, not a source property.
      • §2–§5 drive the backlog router over CONSTRUCTED candidate issues — each an
        in-memory `CronIssue` that is otherwise spawn-eligible (fresh, past the
        grace period, no open dependencies), annotated with a touched-file set
        supplied as injected test input. They assert the returned
        eligible/deferred partition and the returned deferral reason — registry
        surfaces #1-style returned state, exactly as feature-639 §4 and feature-636
        assert the returned `FilterResult` of `evaluateIssue`.
      • §6 drives the post-planning scan over two in-flight issues whose relevant
        files are supplied as injected test input, and asserts the recorded
        ordering recommendation.
      • §7 asserts the type-checker's verdict (registry T22).

    The touched-file sets and plan relevant-file lists in the steps are
    INPUT/artefact test data — the values the system reads at runtime (sourced in
    production from plan-spec "Relevant Files", touched paths, or LLM analysis) —
    exactly the artefact category the Rot-Detection Rubric permits (the same
    category as the stage strings feature-639 feeds the cron filter). They are NOT
    source files of this repo, and no scenario asserts that any source file exists,
    contains a string, or has a given structure.

  Scope notes:

    • The pinned behaviour is the OBSERVABLE outcome — the overlap verdict, the
      eligible/deferred partition, the named deferral cause, the partition's
      stability, and the post-planning recommendation — NOT the name of the overlap
      function, the internal `reason` enum literal, WHERE the serialization pass is
      wired (inside `filterEligibleIssues`, a new pass over its eligible output, or
      `checkIssueEligibility`), or HOW the touched files are sourced. An implementer
      may structure any of these freely as long as the outcomes hold — consistent
      with the #636/#637/#639 "pin the decision, not the taxonomy" stance.
    • REGISTERING A `## Blocked by` DEPENDENCY is one of the two permitted
      mechanisms named in the issue. Whether the router (a) defers the colliding
      issue in-memory with an overlap reason, or (b) writes/records a
      `## Blocked by #<other>` so the EXISTING dependency gate
      (`findOpenDependencies` → `checkIssueEligibility`) defers it, the observable
      is the same: the colliding issue is not eligible to spawn and its deferral
      names the issue it must wait for. §3–§4 pin that shared observable, so either
      mechanism satisfies them.
    • TOUCHED-FILE GRANULARITY is file-level: two issues that touch a common file
      are treated as overlapping. Finer region/line-range granularity (same file,
      disjoint line ranges → allow parallel) is an ACCEPTED, NON-PINNED refinement
      — file-level is the conservative contract that catches the #638/#639 incident
      (AC1) without false-serializing genuinely disjoint work (AC2). Pinning
      line-range math would over-constrain the heuristic.
    • WHICH of an overlapping pair proceeds is deliberately NOT pinned to a fixed
      winner. §3 asserts only that EXACTLY ONE proceeds and the OTHER defers behind
      it; §5 asserts the choice is stable. The tiebreak rule (oldest-first, lowest
      number, plan-readiness, …) is the implementer's — `filterEligibleIssues`
      already sorts oldest-first, so deferring the newer of an overlapping group is
      the natural extension, but the scenarios hold under any deterministic rule.
    • AC4 — UPDATING THE PRD-TO-ISSUES GUIDANCE
      (`.claude/skills/prd-to-issues/SKILL.md`) to order region-colliding slices —
      is a DOCUMENTATION deliverable, verified by the implementer and reviewer. It
      is deliberately NOT pinned by a BDD scenario: asserting a SKILL/doc file's
      text would be a prohibited substring-match against source-file content. This
      mirrors feature-641 leaving its literal Vitest unit tests to the implementer.
    • The end-to-end cron consequence — that the deferred issue is genuinely not
      spawned by `checkAndTrigger` and re-checked next cycle — is the downstream
      effect of the routing partition driven through the full cron subprocess (W10),
      whose live driver is still PENDING the ISSUE-3-CUTOVER. §2–§5 pin the CAUSE
      that effect depends on (the partition the router returns) at the pure-routing
      level, so these scenarios run NOW rather than waiting on the subprocess
      driver — the same level feature-639 §4 chose for the cron exclusion decision.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry covers
    orchestrator/phase/dependency/stage/auth behaviours and has NO phrase for the
    region-overlap heuristic, the serialization partition, or the post-planning
    recommendation. Reusing feature-639's dependency-deferral phrasing would assert
    the wrong cause (`open_dependencies`, not overlap). Surfaced to the maintainer
    in the agent Output:
      • `the region-overlap decision is evaluated between issue {int} touching {string} and issue {int} touching {string}`
      • `the region-overlap verdict is {string}`
      • `a backlog issue {int} otherwise eligible to spawn, annotated with touched files {string}`
      • `the issue router evaluates the backlog for overlapping-region collisions`
      • `the issue router re-evaluates the same backlog`
      • `both issue {int} and issue {int} are eligible to spawn`
      • `issue {int} is eligible to spawn`
      • `exactly one of issue {int} and issue {int} is eligible to spawn`
      • `the other of issue {int} and issue {int} is deferred behind the eligible one for an overlapping code region`
      • `the deferral of the non-eligible issue names the eligible issue as the colliding one`
      • `the same issue remains deferred behind the same eligible issue`
      • `an in-flight issue {int} whose plan declares relevant files {string}`
      • `the post-planning overlap scan runs`
      • `an ordering recommendation is surfaced naming issues {int} and {int} as region-colliding`

    Step-definition note for the maintainer:
      • §1 calls the pure overlap decision over two comma-separated path sets
        (split on ",", trimmed) and asserts the returned boolean equals the
        Examples `verdict` — a pure call, no fixtures. Map the step to whatever
        seam the implementer exposes (a standalone predicate, or the overlap branch
        of the routing pass driven with two single-candidate inputs).
      • §2–§5 build in-memory `CronIssue` fixtures that are otherwise spawn-eligible
        (createdAt/updatedAt older than the grace period, no `## Blocked by`, no
        prior ADW stage) and drive the backlog router
        (`filterEligibleIssues`, extended for overlap) with an injected
        touched-files resolver returning each issue's annotated set — the same
        injection pattern feature-636/639 use for `resolveStage`/`labelRecovery`.
        "Eligible to spawn" = present in the returned `eligible` list; "deferred
        behind X" = absent from `eligible` with the returned annotation/reason (and
        for mechanism (b), the registered `## Blocked by #X`) naming X. §3's
        "exactly one of A and B" reads the partition and asserts cardinality 1 over
        {A,B}; §4 asserts the non-eligible one's deferral record names the eligible
        one (its `reason`/`blockingIssues`/annotation, or the cron deferral log of
        registry surface #5); §5 re-runs the identical input and asserts the same
        member of {A,B} stays deferred behind the same eligible member.
      • §6 supplies two in-flight issues' relevant-file lists as injected input,
        runs the post-planning overlap scan, and asserts the recorded ordering
        recommendation names both issues (the recommendation channel — returned
        list, log, or comment — is the implementer's; assert the operator-visible
        record).

  Background:
    Given the ADW codebase is checked out

  # ── §1 The region-overlap heuristic — pure decision over touched-file sets (AC1) ─
  #
  # The core of the whole feature, the analogue of `globsOverlap`. Two issues
  # overlap iff their touched-file sets share at least one path. The headline
  # incident is the first row: two issues both touching
  # `adws/triggers/takeoverHandler.ts` (the `phase_timeout` recovery file #638 and
  # #639 collided on) overlap. Disjoint sets do not. Granularity is file-level;
  # finer line-range refinement is an accepted, non-pinned extension. (Contract §1.)

  @adw-649 @adw-ni6fpk-feat-serialize-issue
  Scenario Outline: Two issues overlap exactly when their touched-file sets share a path
    When the region-overlap decision is evaluated between issue <a> touching "<filesA>" and issue <b> touching "<filesB>"
    Then the region-overlap verdict is "<verdict>"

    Examples:
      | a | b | filesA                                                            | filesB                                                                          | verdict | note                                  |
      | 1 | 2 | adws/triggers/takeoverHandler.ts                                  | adws/triggers/takeoverHandler.ts                                                | true    | identical file — the #638/#639 collision |
      | 1 | 2 | adws/triggers/takeoverHandler.ts, adws/core/logger.ts             | adws/core/logger.ts, adws/triggers/cronIssueFilter.ts                           | true    | one shared file among larger sets     |
      | 1 | 2 | adws/phases/planPhase.ts, adws/triggers/takeoverHandler.ts        | adws/agents/dependencyExtractionAgent.ts, adws/triggers/takeoverHandler.ts      | true    | shared file among many                |
      | 1 | 2 | adws/triggers/takeoverHandler.ts                                  | adws/triggers/cronIssueFilter.ts                                                | false   | disjoint single files                 |
      | 1 | 2 | adws/core/logger.ts, adws/core/index.ts                           | adws/phases/planPhase.ts, adws/triggers/trigger_cron.ts                         | false   | fully disjoint sets                   |

  # ── §2 No false serialization — disjoint issues stay parallelizable (AC2) ────────
  #
  # The throughput-preserving half. Two spawn-eligible issues whose touched files
  # do not intersect are BOTH left eligible — the router does not hold back work
  # that cannot collide. This is the regression guard against an over-eager
  # heuristic that serialises everything. (Contract §2.)

  @adw-649 @adw-ni6fpk-feat-serialize-issue
  Scenario: Two spawn-eligible issues that touch disjoint files both remain eligible
    Given a backlog issue 6491 otherwise eligible to spawn, annotated with touched files "adws/triggers/cronIssueFilter.ts"
    And a backlog issue 6492 otherwise eligible to spawn, annotated with touched files "adws/phases/planPhase.ts"
    When the issue router evaluates the backlog for overlapping-region collisions
    Then both issue 6491 and issue 6492 are eligible to spawn

  # ── §3 Overlap serializes — exactly one proceeds, the other defers (AC1) ─────────
  #
  # THE fix. Two spawn-eligible issues sharing a touched file are not both spawned:
  # exactly one stays eligible and the other defers behind it for an overlapping
  # region. The second scenario proves the serialization is SELECTIVE, not blanket
  # — a disjoint third issue in the same backlog still spawns, so only the genuine
  # collider is held back. (Contract §3; the headline file is the #638/#639
  # recovery file.)

  @adw-649 @adw-ni6fpk-feat-serialize-issue
  Scenario: Two spawn-eligible issues that touch the same file are serialized to one
    Given a backlog issue 6493 otherwise eligible to spawn, annotated with touched files "adws/triggers/takeoverHandler.ts"
    And a backlog issue 6494 otherwise eligible to spawn, annotated with touched files "adws/triggers/takeoverHandler.ts"
    When the issue router evaluates the backlog for overlapping-region collisions
    Then exactly one of issue 6493 and issue 6494 is eligible to spawn
    And the other of issue 6493 and issue 6494 is deferred behind the eligible one for an overlapping code region

  @adw-649 @adw-ni6fpk-feat-serialize-issue
  Scenario: Only the colliding sibling is held back — a disjoint third issue still spawns in parallel
    Given a backlog issue 6495 otherwise eligible to spawn, annotated with touched files "adws/triggers/takeoverHandler.ts"
    And a backlog issue 6496 otherwise eligible to spawn, annotated with touched files "adws/triggers/takeoverHandler.ts"
    And a backlog issue 6497 otherwise eligible to spawn, annotated with touched files "adws/core/logger.ts"
    When the issue router evaluates the backlog for overlapping-region collisions
    Then issue 6497 is eligible to spawn
    And exactly one of issue 6495 and issue 6496 is eligible to spawn
    And the other of issue 6495 and issue 6496 is deferred behind the eligible one for an overlapping code region

  # ── §4 The deferral is operator-visible and names the blocker (AC3) ──────────────
  #
  # The decision must be legible: the deferred issue's record identifies the
  # overlapping-region cause and names the issue it is serialized behind — the same
  # way the dependency deferral names its blocking issues
  # (`trigger_cron.ts:278`). An operator can see WHY the issue was deferred without
  # reading code. (Contract §4.)

  @adw-649 @adw-ni6fpk-feat-serialize-issue
  Scenario: The deferral names the colliding issue so an operator can see why it was held back
    Given a backlog issue 6498 otherwise eligible to spawn, annotated with touched files "adws/triggers/takeoverHandler.ts"
    And a backlog issue 6499 otherwise eligible to spawn, annotated with touched files "adws/triggers/takeoverHandler.ts"
    When the issue router evaluates the backlog for overlapping-region collisions
    Then the other of issue 6498 and issue 6499 is deferred behind the eligible one for an overlapping code region
    And the deferral of the non-eligible issue names the eligible issue as the colliding one

  # ── §5 The partition is deterministic — no flapping (Contract §5) ────────────────
  #
  # Serialization is only useful if it is stable: re-evaluating the same backlog
  # must keep the same issue proceeding and the same one waiting. If the partition
  # alternated, neither sibling would make durable progress and the stale-base race
  # would reappear. This pins the determinism the whole approach rests on.

  @adw-649 @adw-ni6fpk-feat-serialize-issue
  Scenario: Re-evaluating the same backlog keeps the same issue deferred behind the same one
    Given a backlog issue 64901 otherwise eligible to spawn, annotated with touched files "adws/triggers/takeoverHandler.ts"
    And a backlog issue 64902 otherwise eligible to spawn, annotated with touched files "adws/triggers/takeoverHandler.ts"
    When the issue router evaluates the backlog for overlapping-region collisions
    And the issue router re-evaluates the same backlog
    Then the same issue remains deferred behind the same eligible issue

  # ── §6 Post-planning overlap surfaces an ordering recommendation (issue bullet 2) ─
  #
  # When overlap is only knowable AFTER planning — two in-flight issues whose plan
  # specs declare overlapping relevant files — the system cannot un-spawn them, so
  # it surfaces an operator-visible ordering recommendation naming the colliding
  # issues before build, rather than silently letting one go stale. This is the
  # advisory complement to the pre-spawn hard serialization of §3. (Contract §6.)

  @adw-649 @adw-ni6fpk-feat-serialize-issue
  Scenario: Overlap discovered after planning surfaces an operator-visible ordering recommendation
    Given an in-flight issue 64903 whose plan declares relevant files "adws/triggers/takeoverHandler.ts, adws/core/logger.ts"
    And an in-flight issue 64904 whose plan declares relevant files "adws/triggers/takeoverHandler.ts"
    When the post-planning overlap scan runs
    Then an ordering recommendation is surfaced naming issues 64903 and 64904 as region-colliding

  # ── §8 Live-wiring regression — production default resolver (no injected helper) ──
  #
  # §2–§5 drive filterEligibleIssues with an injected touched-files resolver so the
  # overlap pass is exercised in isolation. But the production caller (trigger_cron.ts)
  # omits the resolver parameter entirely — the pass was dead code until the default
  # was wired. These two scenarios drive filterEligibleIssues with NO injected resolver,
  # reading touched files from real issue bodies via the production default
  # (resolveTouchedFilesFromBody → parseRelevantFilesSection). They guard against the
  # dead-wiring regression the review identified.

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

  # ── §7 Type-check backstop (T22) ─────────────────────────────────────────────────
  #
  # The overlap heuristic, the serialization pass, and any extension to the routing
  # `reason` keep the ADW codebase type-clean. A backstop, consistent with
  # feature-639 §6 and feature-641 §7.

  @adw-649 @adw-ni6fpk-feat-serialize-issue
  Scenario: The ADW TypeScript type-check passes with the overlap-serialization heuristic wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes

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
