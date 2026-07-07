@adw-730 @adw-g5arv0-feat-make-failed-fra
Feature: Failed framework upgrades are redrivable and bounded — step-6 commit/push failures return a counted failure comment instead of an uncaught throw, and a cron redrive scan re-dispatches a stranded #UPG (respecting the per-issue spawn lock) so the existing MAX_FAILURES cap can bound and escalate it

  Issue #730 closes the recurrence engine behind the repeated `#UPG` stalls (adwId
  `72nhdz` on 2026-07-07): a one-line commit failure in the framework self-upgrade
  lane turns into a permanently stuck upgrade that nothing ever retries. Two
  structural gaps, fixed together (shipping either alone is unsafe — see "one story"):

    GAP 1 — UNGUARDED THROW IN STEP 6. `executeUpgrade` (`adws/adwUpgrade.tsx`; the
    function the issue calls `runUpgrade`) has a consistent failure idiom used for
    `worktree_error`, `llm_failed`, and `regen_incomplete`: post
    `commentOnIssue(buildUpgradeFailureComment(...))` and `return { outcome: 'failed',
    reason }`. Step 6 is the outlier — `deps.commitChanges` (`adwUpgrade.tsx:366`) has
    NO try/catch, and the `deps.pushBranch` catch (`:367-385`) handles only
    `deps.isPushRejection(error)` (parking silently as `completed` / `claim_lost`) and
    re-throws everything else (`:384`). Either throw kills the process mid-run:
    heartbeat stops, no state persisted, no failure comment recorded.

    GAP 2 — NO REDRIVE PATH. `adwUpgrade` is spawned ONCE per framework hash, by the
    claim winner (`upgradeGate.ts`). The claim branch `adw-upgrade-<hash>` is created
    once and never released on failure; every later workflow re-enters the claim, sees
    "branch already exists", and PARKS as loser — it never re-spawns. Cron does not
    route `#UPG` issues to `adwUpgrade`: `adw:upgrade` is not an ADW classification
    label, so a stranded #UPG whose only remaining signal is bot failure comments reads
    as fresh + `no_adw_label` (`cronLabelEligibility.ts` → `cronIssueFilter.ts`) and is
    filtered out. So nothing re-invokes the upgrade. The top-of-`executeUpgrade`
    idempotency guard + `MAX_FAILURES` escalation (`adwUpgrade.tsx:277-296`) were built
    FOR re-invocation but are never re-invoked.

  THE FIX (two parts, one story):

    PART 1 — step-6 failures return, not throw. Wrap `commitChanges` and the
    non-rejection `pushBranch` throw in the existing idiom: post
    `buildUpgradeFailureComment(...)` and `return { outcome: 'failed', reason:
    'commit_error' | 'push_error' }`. This removes the uncaught throw AND records a
    failure comment, which feeds the existing `MAX_FAILURES` comment-count cap. The
    `isPushRejection` park path (`completed` / `claim_lost`, silent) is untouched.

    PART 2 — cron redrive scan. Add a cron sweep (structural sibling of
    `runHungDetectorSweep`, wired into `checkAndTrigger`) that re-spawns `adwUpgrade`
    for a stranded `#UPG`. A candidate is redrivable when it is open, carries the
    `adw:upgrade` label, is NOT terminal-labeled (`adw:blocked`), and has no PR on its
    claim branch; the sweep then re-spawns only if the per-issue spawn lock (keyed by
    issue number — `acquireIssueSpawnLock`) is free or reclaimable (absent, or held by
    a dead PID). On match it re-spawns `adwUpgrade.tsx <UPG#> --target-repo …`. The
    top-of-`executeUpgrade` idempotency guard rebuilds regen (no PR on the claim
    branch); `MAX_FAILURES` (counting Part 1's comments) bounds retries and escalates
    via the existing terminal-label / board / Slack path.

  WHY THE TWO PARTS ARE ONE STORY (and how this file proves it):

    Part 2 (redrive) without Part 1 (throw→return) would re-spawn an upgrade that
    crashes without ever posting a failure comment, so `MAX_FAILURES` never trips →
    UNBOUNDED redrive. Together: Part 1 posts a COUNTED comment per failure, Part 2
    re-spawns, and the existing cap escalates after N. This file pins BOTH halves of
    that loop:
      • Part 1 (§1/§2) proves each step-6 failure records a comment that
        `countUpgradeFailureComments` COUNTS (the round-trip through the real
        `isUpgradeFailureComment`) — the bound's fuel.
      • Part 2 (§4–§6) proves the stranded upgrade is actually re-invoked (the
        re-spawn) — the bound's trigger.
    The CAP ITSELF (count ≥ N → `escalated` + `adw:blocked` + board `Blocked` + one
    Slack alert; already-labelled → idempotent exit) is OWNED by feature-685 §B3–§B5
    and is deliberately NOT re-pinned here. #730 supplies the fuel (Part 1's counted
    comment) and the trigger (Part 2's re-invocation) that feature-685's cap was built
    to consume but never received.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test — a
    function return value, a recorded call on an injected dependency, or a spawn-lock
    artefact — NEVER the text, shape, or existence of a source file of this repo. No
    step reads `adws/adwUpgrade.tsx`, `adws/triggers/spawnGate.ts`,
    `adws/triggers/cronIssueFilter.ts`, `adws/triggers/trigger_cron.ts`,
    `adws/core/upgradeFailureCap.ts`, `adws/core/upgradeClaim.ts`, or
    `adws/github/labelManager.ts` as text, substring-matches its contents, or parses it
    as JSON/AST.

      • §1–§3 phase-import `executeUpgrade` with an injected `UpgradeDeps` (the
        `makeDeps`-style fake `adws/__tests__/adwUpgrade.test.ts` already uses), rig
        ONLY `deps.commitChanges` / `deps.pushBranch` / `deps.isPushRejection` to fail,
        and assert the returned `UpgradeRunResult` (`outcome`, `reason`), whether the
        call threw, and the body captured by the injected `commentOnIssue` spy — the
        feature-685 §B3–§B6 injected-deps surface. "The comment is counted by the cap"
        round-trips that captured body through the REAL `isUpgradeFailureComment` /
        `countUpgradeFailureComments` (a builder→classifier round-trip, exactly
        feature-685 §B1's technique), never a hard-coded substring of source.
      • §4 phase-imports the pure redrive-eligibility predicate and asserts the boolean
        verdict it RETURNS over a constructed candidate — the function-of-the-system
        return-value surface feature-653 §1 (`evaluateIssue`) and feature-685 §B1
        (`isUpgradeFailureComment`) assert against.
      • §5–§6 phase-import the redrive sweep with an injected `findPRByBranch`, an
        injected upgrade-spawn SPY, and REAL spawn-lock files written under the test
        `spawn_locks` dir; they assert which issues the spawn spy was invoked for and
        the spawn-lock artefact state — recorded calls on injected deps + a lock-file
        artefact (registry observability surfaces #1/#2). The detached subprocess
        itself is out of scope (feature-721 precedent); the spy is the observed signal.
      • §T asserts the type-checker's verdict (registry T22).

    The strings in the steps — the reason tokens `commit_error` / `push_error` /
    `claim_lost`, the labels `adw:upgrade` / `adw:blocked`, and the orchestrator script
    `adws/adwUpgrade.tsx` — are INPUT/OUTPUT test data: a value the system reads from an
    artefact, a documented return-contract token named verbatim in the issue, or the
    spawn target the sweep is asked to launch. That is the artefact category the
    Rot-Detection Rubric permits, exactly as feature-685 pinned `escalated` /
    `adw:blocked` and feature-721 pinned `adws/adwPrReview.tsx` behaviourally.

  Scope notes:

    • THE CAP AND ITS ESCALATION ARE NOT RE-PINNED HERE. feature-685 §B already pins:
      the counter tallies only bot-authored failure comments (§B2); at the cap the
      upgrade escalates with `adw:blocked` + board + one Slack + a distinct comment and
      returns `escalated` (§B3); an already-`adw:blocked` issue exits idempotently
      (§B5). #730 pins only the two NEW connections into that machinery — Part 1's
      counted comment (§1/§2) and Part 2's re-invocation (§4–§6). A scenario re-asserting
      "count ≥ 3 → escalated" would duplicate feature-685 §B3 and is deliberately omitted.
    • §3 is a NON-REGRESSION GUARD, green before and after the fix. The `isPushRejection`
      park path (`adwUpgrade.tsx:377-382`) returns `completed` / `claim_lost` SILENTLY —
      it is the rightful-loser "another orchestrator owns this claim" path (#627/#648
      lineage), and posting a failure comment there would wrongly inflate the cap toward
      a false escalation. §3 pins that Part 1's fix catches only the NON-rejection throw
      and leaves the rejection park untouched — a guard against an over-broad catch that
      turns every push error into `push_error`.
    • THE spawnGate PID-STALENESS RECLAIM IS PRE-EXISTING and separately tested
      (`adws/triggers/__tests__/spawnGate.test.ts`); §5 does NOT re-test it. §5 pins that
      the redrive sweep CONSULTS it — re-spawning when `acquireIssueSpawnLock` succeeds
      (absent or dead-PID lock) and skipping when a LIVE PID holds it — reusing the
      existing lock keyed by issue number, so no new `#UPG`→adwId mapping is introduced.
    • THE REAL DETACHED SPAWN IS OUT OF SCOPE, as it was in feature-638/#639/#721. §5/§6
      pin the sweep's re-dispatch DECISION via an injected spawn spy; that the live
      `checkAndTrigger` calls the real `spawnDetached` for the sweep's chosen issues is
      thin wiring covered by §T's type-check and the existing `cron_trigger_spawn` smoke
      harness, and is deliberately NOT re-driven as a real subprocess.
    • BLOCKED BY #729. The redrive re-spawns `adwUpgrade`, whose step-6 commit keeps
      hitting the double-exclusion crash until #729's ignore-safe commit filter lands.
      #730 §1 pins that even a step-6 commit FAILURE now RETURNS (no crash) and posts a
      counted comment — so the redrive loop is BOUNDED even while #729 is unlanded — but
      a GREEN end-to-end upgrade still needs #729 first. The two are complementary:
      #729 removes one specific commit crash; #730 §1 makes ANY step-6 commit/push
      failure survivable and countable.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes. The issue's Tests §3 requests a
      `@regression` scenario (the stranded-vs-terminal scan, encoded here as §6) plus
      vocabulary registration; that promotion request is SURFACED to the maintainer in
      the agent Output rather than self-applied.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    (Registered G5 `no spawn lock exists for issue {int}` names the same artefact §5's
    parametric spawn-lock Given writes; §5 uses a novel parametric phrase because it
    varies the lock across absent / dead-PID / live-PID in one Scenario Outline, a
    dimension G5 does not carry. Surfaced below.)

    Novel phrasing introduced here — the registry has no phrase for a step-6
    failure→return, for the redrive-eligibility predicate, or for the redrive sweep;
    and feature-685's cap phrases are bound to `@adw-685`'s own step-def module state,
    so reusing them verbatim would cross-wire per-feature `ctx` under the globally
    loaded step defs (the feature-614/#729 self-contained-step-file precedent). All
    novel phrasing is surfaced to the maintainer in the agent Output. By part:

      Part 1 (step-6 failures return, not throw):
        • `an upgrade whose step-6 regen commit fails with a non-rejection error`
        • `an upgrade whose step-6 branch push fails with a non-rejection error`
        • `an upgrade whose step-6 branch push is rejected as non-fast-forward`
        • `the framework upgrade orchestration is executed for tracking issue {int}`
        • `the framework upgrade orchestration returns without throwing`
        • `the framework upgrade orchestration outcome is {string}`
        • `the framework upgrade orchestration reason is {string}`
        • `a bot-authored upgrade-failure comment that the failure cap counts is recorded on issue {int}`
        • `no upgrade-failure comment is recorded on issue {int}`

      Part 2 (redrive predicate + sweep):
        • `a candidate upgrade issue that is <state>, <upgradeLabel> the adw:upgrade label, <terminalLabel> the adw:blocked label, and <claimPr> a PR on its claim branch`
        • `the upgrade redrive eligibility is evaluated`
        • `the candidate upgrade is redrivable: <redrivable>`
        • `a stranded upgrade tracking issue {int} with no PR on its claim branch`
        • `the per-issue spawn lock for issue {int} is <lock>`
        • `an already-escalated upgrade tracking issue {int} carrying the adw:blocked label`
        • `the cron upgrade-redrive sweep runs`
        • `the redrive sweep re-spawns the upgrade orchestrator for issue {int}`
        • `the redrive sweep does not re-spawn the upgrade orchestrator for issue {int}`

    Step-definition note for the maintainer (feature-730.steps.ts — keep it
    SELF-CONTAINED with its own `@adw-730` Before/After; do NOT reach into feature-685's
    module-private cap `ctx`):
      • §1–§3 phase-import `executeUpgrade` (`adws/adwUpgrade.tsx`). Build the deps with
        the `makeDeps(overrides)` factory pattern from `adws/__tests__/adwUpgrade.test.ts`
        (a happy path that reaches step 6: `findPRByBranch` → null, `fetchIssueLabels` →
        [], `fetchIssueComments` → [] so the cap is below threshold, and worktree / init /
        `verifyAdwRegen` all succeed). Override only step 6:
          – commit-fail Given → `commitChanges: () => { throw new Error('commit boom'); }`;
          – push-fail Given → `pushBranch: () => { throw new Error('push boom'); }` with
            `isPushRejection: () => false`;
          – rejection Given → `pushBranch: () => { throw pushErr; }` with
            `isPushRejection: () => true` (mirrors the real
            `adws/core/upgradeClaim.ts` `isPushRejectionError`).
        Capture `commentOnIssue` as a recording spy. The When calls
        `executeUpgrade(...)` inside try/catch, storing the returned `UpgradeRunResult`
        AND whether it threw. `returns without throwing` asserts it did not throw AND a
        result object exists. `outcome` / `reason` assert `result.outcome` /
        `result.reason`. `a bot-authored upgrade-failure comment that the failure cap
        counts` asserts the spy captured a body for the issue AND that
        `countUpgradeFailureComments([{ body, author: '<slug>[bot]' }])` (real import
        from `adws/core/upgradeFailureCap`) returns 1 — proving Part 1 feeds the cap.
        `no upgrade-failure comment is recorded` asserts the spy captured nothing for the
        issue (the silent park).
      • §4 phase-imports the new pure redrive-eligibility predicate (the maintainer names
        it; e.g. `isRedrivableUpgrade(issue, hasClaimPr)`), a deterministic function of
        an issue's `state` + `labels` and a `hasClaimPr` boolean (the boolean the sweep
        derives from `findPRByBranch(buildClaimBranchName(hash), repoInfo)` — kept as an
        injected input so the predicate stays pure, exactly as feature-685 §B6 modelled
        "already has an open pull request"). The Given constructs `{ state, labels[] }`
        + `hasClaimPr` from the Examples columns; the Then asserts the returned boolean.
      • §5–§6 phase-import the new redrive sweep (structural sibling of
        `runHungDetectorSweep` in `adws/triggers/trigger_cron.ts`, tested with the
        module-level `vi.mock` pattern of `adws/triggers/__tests__/trigger_cron.test.ts`).
        Inject `findPRByBranch` (→ null for the stranded issues), an upgrade-spawn spy in
        place of the detached `spawnDetached('bunx', ['tsx','adws/adwUpgrade.tsx', …])`,
        and point `AGENTS_STATE_DIR` at a temp dir. The spawn-lock Given writes a REAL
        lock via `getSpawnLockFilePath(repoInfo, issueNumber)`:
          – `absent` → ensure no file;
          – `held by a dead process` → `{ pid: <an unused PID>, pidStartedAt: '<bogus>' }`
            so `isProcessLive` is false (reclaimable);
          – `held by a live process` → `{ pid: process.pid, pidStartedAt:
            getProcessStartTime(process.pid) }` so `isProcessLive` is true (held).
        `re-spawns … for issue N` asserts the spawn spy was invoked with a command
        naming `adws/adwUpgrade.tsx` and the issue number N; `does not re-spawn … for
        issue N` asserts the spy was NOT invoked for N. §6 seeds both a stranded issue
        (redrivable, no lock) and an `adw:blocked` issue in one sweep and asserts the
        spy fired for the former only. Clean up `spawn_locks` in the `@adw-730` After.

  Background:
    Given the ADW codebase is checked out

  # ════════════════════════════════════════════════════════════════════════════════
  # Part 1 — step-6 failures return a counted comment, not an uncaught throw
  # ════════════════════════════════════════════════════════════════════════════════

  # ── §1 A step-6 commit failure returns failed(commit_error) with a counted comment ─
  #
  # THE headline fix for GAP 1's first half. Today `deps.commitChanges` at
  # `adwUpgrade.tsx:366` has no try/catch, so a commit failure throws uncaught and kills
  # the process mid-run — no state, no comment, no cap signal. After the fix the orchestration
  # RETURNS `{ outcome: 'failed', reason: 'commit_error' }` and posts a
  # `buildUpgradeFailureComment` — a bot-authored, signature-prefixed comment that
  # `countUpgradeFailureComments` counts, so the failure feeds feature-685's cap. RED
  # before the fix (the When throws); GREEN after (it returns).

  @adw-730 @adw-g5arv0-feat-make-failed-fra
  Scenario: A step-6 commit failure returns failed(commit_error) with a cap-counting comment instead of an uncaught throw
    Given an upgrade whose step-6 regen commit fails with a non-rejection error
    When the framework upgrade orchestration is executed for tracking issue 7301
    Then the framework upgrade orchestration returns without throwing
    And the framework upgrade orchestration outcome is "failed"
    And the framework upgrade orchestration reason is "commit_error"
    And a bot-authored upgrade-failure comment that the failure cap counts is recorded on issue 7301

  # ── §2 A non-rejection step-6 push failure returns failed(push_error) with a counted comment ─
  #
  # GAP 1's second half. The `pushBranch` catch (`:367-385`) handles only
  # `isPushRejection` and RE-THROWS everything else (`:384`) — so a non-rejection push
  # error (auth failure, remote 500, network) throws uncaught. After the fix that branch
  # posts a failure comment and RETURNS `{ outcome: 'failed', reason: 'push_error' }`,
  # and the comment likewise feeds the cap. RED before, GREEN after.

  @adw-730 @adw-g5arv0-feat-make-failed-fra
  Scenario: A non-rejection step-6 push failure returns failed(push_error) with a cap-counting comment instead of an uncaught throw
    Given an upgrade whose step-6 branch push fails with a non-rejection error
    When the framework upgrade orchestration is executed for tracking issue 7302
    Then the framework upgrade orchestration returns without throwing
    And the framework upgrade orchestration outcome is "failed"
    And the framework upgrade orchestration reason is "push_error"
    And a bot-authored upgrade-failure comment that the failure cap counts is recorded on issue 7302

  # ── §3 GUARD: a non-fast-forward push rejection still parks silently, unchanged ─────
  #
  # The non-regression guard for the fix's blast radius. A non-fast-forward REJECTION is
  # the rightful-loser "another orchestrator owns this claim" path: it must keep
  # returning `{ outcome: 'completed', reason: 'claim_lost' }` and post NO comment
  # (posting one would wrongly inflate the cap toward a false escalation). This pins that
  # Part 1 catches only the NON-rejection throw and leaves the `isPushRejection` park
  # (`:377-382`) untouched. GREEN before AND after the fix.

  @adw-730 @adw-g5arv0-feat-make-failed-fra
  Scenario: A non-fast-forward push rejection still parks silently as claim_lost with no failure comment
    Given an upgrade whose step-6 branch push is rejected as non-fast-forward
    When the framework upgrade orchestration is executed for tracking issue 7303
    Then the framework upgrade orchestration returns without throwing
    And the framework upgrade orchestration outcome is "completed"
    And the framework upgrade orchestration reason is "claim_lost"
    And no upgrade-failure comment is recorded on issue 7303

  # ════════════════════════════════════════════════════════════════════════════════
  # Part 2 — cron redrive: eligibility predicate (§4), lock-gated sweep (§5), mixed sweep (§6)
  # ════════════════════════════════════════════════════════════════════════════════

  # ── §4 The redrive-eligibility predicate selects only a stranded, non-escalated, PR-less open #UPG ─
  #
  # The pure core of GAP 2's fix. The predicate decides which `#UPG` issues the sweep
  # even considers: open AND carrying `adw:upgrade` AND not terminal-labelled
  # (`adw:blocked` — already escalated) AND with no PR on its claim branch (a claim that
  # reached the PR stage is not stranded). One row per clause, asserted behaviourally on
  # the predicate's returned boolean — the feature-685 §B1 / feature-653 §1 unit-matrix
  # surface. The lock dimension is spawnGate's job and is exercised in §5, not here.

  @adw-730 @adw-g5arv0-feat-make-failed-fra
  Scenario Outline: The redrive-eligibility predicate matches only a stranded, non-escalated, PR-less open upgrade issue
    Given a candidate upgrade issue that is <state>, <upgradeLabel> the adw:upgrade label, <terminalLabel> the adw:blocked label, and <claimPr> a PR on its claim branch
    When the upgrade redrive eligibility is evaluated
    Then the candidate upgrade is redrivable: <redrivable>

    Examples:
      | state  | upgradeLabel | terminalLabel | claimPr | redrivable | note                          |
      | open   | carries      | lacks         | lacks   | true       | stranded — the redrive target |
      | open   | carries      | carries       | lacks   | false      | already escalated             |
      | open   | carries      | lacks         | has     | false      | claim reached the PR stage    |
      | open   | lacks        | lacks         | lacks   | false      | not an upgrade issue          |
      | closed | carries      | lacks         | lacks   | false      | closed — nothing to redrive   |

  # ── §5 The sweep re-spawns a stranded #UPG only when its per-issue spawn lock is free or stale ─
  #
  # GAP 2's re-invocation, gated by the EXISTING spawn lock. For a stranded #UPG the
  # sweep calls `acquireIssueSpawnLock(repoInfo, issueNumber, pid)` (keyed by issue
  # number, no new mapping): an absent lock or one held by a DEAD PID is acquired and the
  # sweep re-spawns `adwUpgrade`; a lock held by a LIVE PID is authoritative and the
  # sweep skips (an orchestrator is already running it). This pins that the sweep
  # CONSULTS spawnGate's pre-existing PID-staleness reclaim — it does not re-test the
  # reclaim itself.

  @adw-730 @adw-g5arv0-feat-make-failed-fra
  Scenario Outline: The redrive sweep re-spawns a stranded upgrade only when its per-issue spawn lock is free or stale
    Given a stranded upgrade tracking issue 7305 with no PR on its claim branch
    And the per-issue spawn lock for issue 7305 is <lock>
    When the cron upgrade-redrive sweep runs
    Then the redrive sweep <disposition> the upgrade orchestrator for issue 7305

    Examples:
      | lock                   | disposition          |
      | absent                 | re-spawns            |
      | held by a dead process | re-spawns            |
      | held by a live process | does not re-spawn    |

  # ── §6 The sweep re-spawns a stranded #UPG but leaves an already-escalated one alone ─
  #
  # The end-to-end redrive contract (issue Acceptance 2 and the issue's `@regression`
  # ask, encoded here as one sweep over a mixed backlog). A stranded #UPG (open,
  # `adw:upgrade`, no PR, no lock) is re-dispatched; an already-escalated #UPG carrying
  # the terminal `adw:blocked` label is left untouched — cron re-spawning a blocked lane
  # would fight the human escalation. Because the @regression sweep is skipped for this
  # repo, this stays `@adw-730`; its promotion to `@regression` is surfaced to the
  # maintainer in the Output.

  @adw-730 @adw-g5arv0-feat-make-failed-fra
  Scenario: The redrive sweep re-spawns a stranded upgrade but leaves an already-escalated one alone
    Given a stranded upgrade tracking issue 7306 with no PR on its claim branch
    And the per-issue spawn lock for issue 7306 is absent
    And an already-escalated upgrade tracking issue 7307 carrying the adw:blocked label
    When the cron upgrade-redrive sweep runs
    Then the redrive sweep re-spawns the upgrade orchestrator for issue 7306
    And the redrive sweep does not re-spawn the upgrade orchestrator for issue 7307

  # ════════════════════════════════════════════════════════════════════════════════
  # §T Type-check backstop
  # ════════════════════════════════════════════════════════════════════════════════
  #
  # The new `commit_error` / `push_error` reasons, the redrive-eligibility predicate, and
  # the redrive sweep wired into `checkAndTrigger` keep the ADW codebase type-clean. A
  # backstop consistent with feature-685 §T1, feature-653 §5, and feature-721 §4.

  @adw-730 @adw-g5arv0-feat-make-failed-fra
  Scenario: The ADW TypeScript type-check passes with the step-6 no-throw and redrive-sweep changes wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
