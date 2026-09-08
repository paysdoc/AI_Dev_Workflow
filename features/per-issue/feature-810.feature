@adw-810 @adw-o0g36j-docs-index-health-cr
Feature: Index health becomes a periodic whole-index property — a cron sweep that repairs what is deterministic, files one hitl issue for what needs judgement, and a gate CI runs on every pull request

  Issue #810 is a regression backstop, not a new capability. #609–#612 shipped the per-module
  living-docs model and landed on `dev` on 2026-06-19 (PR #642, `c7bf098b`): 47 index entries ↔ 47
  module docs, `checkLivingDocsIndex.ts` green. Within 48 hours it was gone. Feature branches cut
  before the migration still carried the old 191-entry `.adw/conditional_docs.md`; where the
  migration's mass deletion collided with a branch's appended entry in the same hunk, ADW's
  `resolve_conflict` agent kept the branch's whole file (`926d8657` → 195 entries, `d918ef65` → 217,
  `9125bc3a` → 217 onto `main`).

  Nothing caught it, and the reason is structural rather than accidental:

    • `checkLivingDocsIndex.ts` was scoped as a ONE-OFF migration acceptance gate. It was never
      wired into `package.json` and never run by CI, so no merge was ever measured against it.
    • The `/document` post-write guards only inspect the entry BEING WRITTEN. Legacy entries carry
      no `Owns:` block, so the regrowth guard is structurally blind to them.
    • The PRD chose write-time convergence over a periodic backstop. Convergence has no notion of a
      "dangling entry" and only ever touches the area of the current change, so 177 dead entries in
      untouched areas survived for two months — while `/document`, unable to route to module owners
      whose docs were gone, kept creating fresh overlapping docs (64 overlapping `Owns:` globs by
      2026-08-28).

  The cost was paid by every planner: ~45k tokens of index per read, 58 % dead links, and no way to
  find the module doc that would have answered in one read (the #797 plan agent hit the 30-minute
  watchdog at ~600k context tokens).

  A one-off hand repair on 2026-08-28 took the index from 222 entries / 179 KB to 70 / 86 KB. That
  repair is the CURRENT state of the checkout, and running the gate over it today prints exactly the
  work this issue has left to do:

      Living Docs Index Check — 70 entries, 68 docs
        ✔ PASS  Round-trip (parse → serialize === original)
        ✖ FAIL  Doc↔entry bijection: no dangling entry docPaths
               Dangling (entry exists, no file): README.md, adws/README.md
        ✔ PASS  Doc↔entry bijection: no orphan docs
        ✔ PASS  Doc↔entry bijection: no duplicate docPaths
        ✖ FAIL  No overlapping ownedGlobs (regrowth guard)
               "adws/providers/github/ghIssueApi.ts" owned by:
                 app_docs/feature-9gjajh-providers.md, app_docs/feature-e2er82-github-forge-adapter.md
        ✖ FAIL  Entry count in sane band [25, 60]
               Count 70 exceeds MAX_ENTRIES (60)

  Three failures, three different kinds of defect, and the scenarios below are organised around that
  distinction because it is the design of the whole issue:

    §1  THE DECISION IS PURE AND WHOLE-INDEX (task 1c). `adws/core/docsIndexHealth.ts` takes a parsed
        registry plus the two facts about the world it needs — which doc files exist, which files git
        tracks — and returns `{repairs, violations}`. What is DETERMINISTIC is a repair: an entry
        whose `docPath` has no file behind it, an `Owns:` glob that matches zero tracked files. What
        needs JUDGEMENT is a violation: overlapping globs (which of the two docs should own the
        file?), an orphan doc (index it, delete it, or fold it?), a count outside the band (fold what,
        into what?). No I/O, no forge, no repo identity — which is what lets the SAME module serve
        both the sweep and the gate instead of the two drifting apart, as the issue requires.

        §1 also carries the gate bug, expressed where it actually lives. `checkLivingDocsIndex.ts`
        resolves every entry's `docPath` against `app_docs/feature-*.md` only, so the two legitimate
        top-level entries `README.md` and `adws/README.md` — both tracked, both present — are
        reported as dangling. Under the shared module they must not be; and because the sweep drops
        dangling entries automatically, the SAME bug in sweep clothing would silently delete the
        repository's two README entries on the first cadence-eligible tick. That is why the
        false-dangling case is pinned as a repair-side scenario and not only as a gate-side one.

    §2  THE SWEEP IS A THIN SHELL ON THE CRON'S CADENCE (task 1, dispatch). `docsIndexSweep.ts` is
        dispatched from `trigger_cron.ts` on `DOCS_INDEX_SWEEP_INTERVAL_CYCLES`, exactly as
        `runPerIssueScenarioSweepTick` and `runPromotionSweepTick` are: cadence gate first, then the
        launch-boundary check (no `GitContext` ⇒ log and skip, NEVER a cwd-derived fallback identity),
        then a try/catch that makes any escaped throw non-fatal. #812 is the standing proof of why
        the last clause is load-bearing: an unguarded throw inside a tick killed the cron process
        every five minutes for a day.

    §3  REPAIRS LAND THROUGH A MERGED PULL REQUEST, NEVER A DIRECT COMMIT (task 1a, persistence).
        The sweep runs on a cron host whose own checkout may be behind origin and may be sitting on
        any branch; committing the repair there is how a sweep strands work or clobbers a developer.
        The repair is decided and committed on a dedicated worktree synced to fresh
        `origin/<default>`, pushed to a dedicated branch, opened as a PR and merged immediately —
        the `perIssueSweepPersist.ts` path. AC3's synthetic regression (restore 20 dangling entries)
        is exercised here as the sweep half, and again in §5 as the CI half.

    §4  JUDGEMENT FINDINGS FILE EXACTLY ONE OPEN HITL ISSUE (task 1b). "Exactly one" is the whole
        requirement. A sweep on a generous cadence that files an issue per violation per tick
        produces a hundred issues nobody reads, which is a different failure of the same kind the
        index itself suffered. The sweep reconciles against an already-open tracker through a
        back-link marker in the issue body — the shape `promotionReconcileLink.ts` established — and
        files nothing when one is open. Violations are NEVER auto-repaired: the overlapping pair is
        listed for a human, and both entries stay in the index untouched.

    §5  THE GATE IS A CI-RUNNABLE COMMAND THAT NEEDS NO FORGE (task 2). `bun run lint:docs-index`
        must exit non-zero on a broken index and 0 on a healthy one, from a CI runner with no
        GitHub App installation and no network — which is why the gate's `gitContextForRepo` call
        (allowlisted in `adws/guard/constructionRule.ts:93` as a transitional entry owned by #796)
        has to go: that construction eagerly resolves an installation token. The guard's own
        self-cleaning ratchet then requires the allowlist entry to be deleted in the same change, or
        `lint:git-guard` reports it stale and fails.

    §6  THE REAL INDEX IS GREEN (AC1, AC4 — task 3's only honest observable). The convergence pass
        folds 23 of the 24 post-migration feature docs the issue lists into their owning
        `feature-9gjajh-*` module docs and promotes the 24th, `oqb76h`, to the module doc for
        `adws/gitContext/`. The MERGED PROSE is LLM output and is not assertable; what is assertable
        is what the fold is FOR — the gate, run over this checkout, reporting zero overlaps, zero
        orphans and a count inside its band, and exiting 0.
        Three of those four are RED today (see the transcript above).

  How these scenarios observe the system. §1 drives the pure module in-process over throwaway fixture
  registries — the fixture index and its doc/tracked-file sets are INPUTS the step constructs, never
  framework source files — and asserts on the returned `{repairs, violations}` value. §2 drives the
  exported dispatch function with an injected sweep, asserting dispatch counts and the log stream.
  §3 and §4 drive the real sweep over throwaway origin/host repository pairs with the forge stubbed,
  asserting git artefacts (which branch carries what, which checkout gained a commit, which PR was
  opened and merged) and recorded forge calls. §5 spawns the gate and asserts its exit code and
  printed report. §6 runs the gate and the git/gh guard over the ADW checkout and asserts their exit
  codes and reports. No step reads `docsIndexHealth.ts`, `docsIndexSweep.ts`, `checkLivingDocsIndex.ts`,
  `trigger_cron.ts` or `package.json` and asserts against their contents.

  Scope notes:

    • Adding the gate to `.github/workflows/git-cli-guard.yml` (or a sibling workflow) is a CI
      wiring change whose only observable is "GitHub ran this step on the pull request". Asserting it
      in-repo would mean parsing or substring-matching the workflow YAML — the structural-source-file
      assertion the Rot-Prevention rule forbids (the same call #767 made for its `timeout-minutes`
      fix). It is intentionally left uncovered here and surfaced to the maintainer. §5 and §6 cover
      the half that is behaviour: the command CI would run exists as an entry point, exits non-zero
      on a broken index, and exits 0 on this one.
    • The prose merged into each module doc by task 3's convergence pass is LLM output; no scenario
      asserts doc BODY content. §6 pins the index-level outcome the fold exists to produce.
    • Whether the band is made module-count-derived or left at a constant is an implementation
      choice the issue explicitly leaves open. §1's count scenarios are phrased against "the band's
      upper bound" rather than the literal 60 so they survive either decision.
    • The issue's Touched Files names `adws/core/environment.ts` for the new cadence constant; its
      siblings `PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES` and `PROMOTION_SWEEP_INTERVAL_CYCLES` in
      fact live in `adws/core/config.ts` and are re-exported through `adws/core/index.ts`. No
      scenario depends on which of the two files it lands in.
    • The follow-up the issue defers — teaching `resolve_conflict` to merge `.adw/conditional_docs.md`
      through the registry rather than by textual union — is out of scope and uncovered here.

  Background:
    Given the ADW codebase is checked out

  # ══════ §1  THE HEALTH DECISION IS PURE, WHOLE-INDEX, AND SHARED (task 1c) ══════════════
  #
  # The headline repair, and the one the June regression needed: an entry pointing at a doc that is
  # not there. Convergence cannot see this — it only looks at the area of the current change — so it
  # is exactly the class of rot a periodic whole-index pass exists to find. Deterministic, so it is a
  # repair, not a violation. RED before: the module does not exist.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: An entry whose doc file is absent is reported as a deterministic drop repair
    Given a docs index fixture holding an entry "app_docs/feature-ghost.md" whose doc file is absent
    And a docs index fixture holding an entry "app_docs/feature-live.md" whose doc file is present
    When the docs index health check runs over the fixture
    Then the health check reports a drop repair for "app_docs/feature-ghost.md"
    And the health check reports no drop repair for "app_docs/feature-live.md"

  # The gate bug, expressed where the fix has to live. `checkLivingDocsIndex.ts` resolves every
  # docPath against `app_docs/feature-*.md`, so the two legitimate top-level entries are reported as
  # dangling — which the transcript in the header shows happening on this checkout right now. Under
  # the shared module the same mistake would be strictly worse than a false gate failure: the sweep
  # auto-drops dangling entries, so the first cadence-eligible tick would delete the repository's
  # two README entries and open a PR that merges the deletion. Pinned on the repair side for that
  # reason. RED before.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A top-level entry whose file is present outside app_docs is never reported as dangling
    Given a docs index fixture holding an entry "README.md" whose doc file is present at the repository root
    And a docs index fixture holding an entry "adws/README.md" whose doc file is present
    When the docs index health check runs over the fixture
    Then the health check reports no drop repair for "README.md"
    And the health check reports no drop repair for "adws/README.md"

  # The second deterministic repair: a glob that owns nothing. A module doc survives a file rename or
  # a package move with a glob pointing into empty space; the glob is dead, but the doc and its other
  # globs are not. Pruning is per-glob, and the surviving globs must be left exactly alone — a prune
  # that rewrote the whole `Owns:` block would round-trip differently and fail the gate's first check.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A glob matching zero tracked files is pruned while the entry's live globs are left alone
    Given a docs index fixture entry "app_docs/feature-live.md" owning the globs:
      | glob                     |
      | adws/core/live.ts        |
      | adws/core/deleted.ts     |
    And the fixture tracks the file "adws/core/live.ts"
    When the docs index health check runs over the fixture
    Then the health check reports a glob prune of "adws/core/deleted.ts" from "app_docs/feature-live.md"
    And the health check reports no glob prune of "adws/core/live.ts"

  # Negative space, and the cheapest wrong implementation to write: pruning an entry's last glob is
  # not the same as dropping the entry. A doc that owns nothing is still a doc — it is reachable by
  # its `Conditions:` lines, which are what `/document` and the planners actually route on — and its
  # file is right there. Dropping it would orphan the doc and re-create, one tick later, the exact
  # state this issue was raised to repair.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: An entry whose every glob is dead keeps its place in the index because its doc file is present
    Given a docs index fixture entry "app_docs/feature-live.md" owning the globs:
      | glob                    |
      | adws/core/deleted.ts    |
      | adws/core/removed.ts    |
    And the fixture tracks no file matching either glob
    And the doc file for "app_docs/feature-live.md" is present
    When the docs index health check runs over the fixture
    Then the health check reports no drop repair for "app_docs/feature-live.md"
    And the health check reports a glob prune of "adws/core/deleted.ts" from "app_docs/feature-live.md"

  # The first judgement finding, and the line the whole design turns on. Two docs owning one file is
  # a real defect — it is what `/document` produced 64 times while the module docs were missing — but
  # WHICH doc should lose the glob is not a decision code can make. The hand repair on 2026-08-28
  # needed a written rule plus two explicit overrides to resolve 37 pairs. So: reported, named, and
  # left in place. An implementation that "helpfully" dropped one side would delete authored
  # documentation on a cron cadence.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: Two entries owning the same tracked file are reported as a violation naming both, and neither is repaired
    Given a docs index fixture entry "app_docs/feature-9gjajh-providers.md" owning the glob "adws/providers/github/*.ts"
    And a docs index fixture entry "app_docs/feature-e2er82-github-forge-adapter.md" owning the glob "adws/providers/github/ghIssueApi.ts"
    And the fixture tracks the file "adws/providers/github/ghIssueApi.ts"
    When the docs index health check runs over the fixture
    Then the health check reports an overlap violation naming "app_docs/feature-9gjajh-providers.md" and "app_docs/feature-e2er82-github-forge-adapter.md"
    And the health check reports the overlapping tracked file "adws/providers/github/ghIssueApi.ts"
    And the health check reports no repairs

  # The second judgement finding, and the mirror image of a dangling entry: the FILE is there and the
  # ENTRY is missing. 25 module docs sat in this state for two months — present, unindexed, and
  # therefore invisible to every planner that reads the index. Index it, fold it, or delete it is a
  # human call; the machine's job is to stop it being invisible.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A doc file no entry indexes is reported as an orphan violation and is never deleted
    Given a docs index fixture holding an entry "app_docs/feature-live.md" whose doc file is present
    And the fixture holds a doc file "app_docs/feature-orphan.md" that no entry indexes
    When the docs index health check runs over the fixture
    Then the health check reports an orphan violation naming "app_docs/feature-orphan.md"
    And the health check reports no repairs

  # The third judgement finding. The band is the only check that speaks about the index as a WHOLE —
  # 217 entries is not a set of 217 local defects, it is one systemic one — and it is the check that
  # would have screamed loudest in June. Phrased against the band's bounds rather than the literal
  # `MAX_ENTRIES = 60`, because the issue leaves the choice between a module-count-derived band and a
  # constant open; either way an index one entry past the top is out and an index inside it is in.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario Outline: An entry count outside the band is a violation and a count inside it is not
    Given a docs index fixture holding <sizing> healthy entries
    When the docs index health check runs over the fixture
    Then the health check reports "<verdict>" for the entry count

    Examples:
      | sizing                          | verdict      |
      | one more than the band allows   | a violation  |
      | a count inside the band         | no violation |
      | one fewer than the band allows  | a violation  |

  # The green path, asserted as a whole rather than per-check. A sweep whose decision module invents
  # a repair on a healthy index opens an empty PR every cadence cycle; a gate that invents a
  # violation turns every pull request red. Both failures are cheap to write and expensive to notice.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A healthy index yields neither repairs nor violations
    Given a docs index fixture whose entries all have present doc files and live globs
    And the fixture holds no doc file that its entries do not index
    And the fixture entry count is inside the band
    When the docs index health check runs over the fixture
    Then the health check reports no repairs
    And the health check reports no violations

  # ══════ §2  CADENCE, LAUNCH BOUNDARY, AND THE NON-FATAL SWALLOW (task 1, dispatch) ══════
  #
  # The dispatch contract, identical in shape to the two sibling sweeps (#745 pinned the same three
  # facts for the promotion sweep). Cadence first: a sweep that pushes branches and opens PRs must
  # not run on every 20-second tick.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: On a cadence-eligible cron cycle the docs-index sweep is dispatched exactly once
    When the cron docs-index-sweep dispatch runs for a "cadence-eligible" cron cycle
    Then the docs-index sweep is dispatched exactly once

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario Outline: On an intervening cron cycle the docs-index sweep is not dispatched
    When the cron docs-index-sweep dispatch runs for a "<cyclePosition>" cron cycle
    Then the docs-index sweep is not dispatched

    Examples:
      | cyclePosition        |
      | one-before-cadence   |
      | one-after-cadence    |
      | mid-interval         |

  # No launch boundary means no verified identity for the repository being swept. The rule the whole
  # #790–#797 phase established is that the pass SKIPS rather than falling back to a cwd-derived
  # identity — on a cron host that polls target repositories, a cwd fallback would repair the
  # FRAMEWORK's index while claiming to repair the target's, and land the result in the wrong repo.
  # The skip must be logged: a silent skip is indistinguishable from a sweep that found nothing.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A cron cycle with no launch context skips the docs-index sweep instead of falling back to the working directory
    Given the cron holds no launch context
    When the cron docs-index-sweep dispatch runs for a "cadence-eligible" cron cycle
    Then the docs-index sweep is not dispatched
    And the cron logs that the docs-index sweep was skipped for want of a launch context
    And the cron docs-index-sweep dispatch completes without raising an error

  # #812's lesson, applied at the point of introduction rather than after the next incident. The tick
  # is fired and forgotten; an escaped rejection anywhere inside it is an unhandled rejection, and
  # Node kills the cron process. A docs-index sweep touches git, the forge and the filesystem on a
  # generous cadence — it is precisely the shape of caller that finds this.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A throwing docs-index sweep is logged and swallowed so the cron tick completes without raising
    Given the injected docs-index sweep is configured to throw a transient error
    When the cron docs-index-sweep dispatch runs for a "cadence-eligible" cron cycle
    Then the cron logs the docs-index sweep failure as an error
    And the cron docs-index-sweep dispatch completes without raising an error

  # ══════ §3  REPAIRS LAND THROUGH A MERGED PULL REQUEST (task 1a, persistence) ═══════════
  #
  # The persistence contract, and AC2's first half. The cron host's own checkout is shared, possibly
  # stale and possibly mid-workflow; the repair is decided and committed on a dedicated worktree
  # synced to fresh `origin/<default>`, then landed by an immediately-merged PR. The "behind origin"
  # given is not decoration — it is the state that makes a direct commit on the host wrong, and #758
  # pinned the same fact for the per-issue sweep.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A tick that finds a dangling entry lands the pruned index on origin through a merged pull request
    Given a docs index on origin's default branch carrying an entry whose doc file is not tracked
    And the cron host's local default branch is behind origin by a commit it has never fetched
    When the cron cycle runs the docs-index sweep
    Then origin carries a docs-index sweep branch whose index omits the dangling entry
    And a pull request is opened from the docs-index sweep branch into the default branch
    And the docs-index sweep pull request is merged

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A dead glob is pruned on the sweep branch while its entry survives
    Given a docs index on origin's default branch whose entry "app_docs/feature-live.md" owns a glob matching no tracked file
    And the doc file for "app_docs/feature-live.md" is tracked on origin's default branch
    When the cron cycle runs the docs-index sweep
    Then the index on the docs-index sweep branch still carries the entry "app_docs/feature-live.md"
    And the index on the docs-index sweep branch no longer carries that entry's dead glob

  # The negative half of the persistence contract, and the reason the sweep is safe to run against a
  # host that is also somebody's working checkout. Nothing the pass does may appear as a commit on
  # the cron host's own default branch, and the repair may reach origin's default branch only by way
  # of the merge — never by a direct push.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: The repair never reaches the default branch except through the merged pull request
    Given a docs index on origin's default branch carrying an entry whose doc file is not tracked
    And the cron host's local default branch is behind origin by a commit it has never fetched
    When the cron cycle runs the docs-index sweep
    Then the docs-index repair reaches origin's default branch only through the merged pull request
    And the cron host's local default branch carries no commit added by the pass

  # A sweep that opens an empty PR on every cadence-eligible cycle is noise with a merge queue
  # attached. Nothing to repair means nothing to push.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A tick over a healthy index opens no pull request and adds no commit anywhere
    Given a docs index on origin's default branch whose entries all have tracked doc files and live globs
    When the cron cycle runs the docs-index sweep
    Then the docs-index sweep opens no pull request
    And origin's default branch tip is unchanged by the sweep
    And the cron host's local default branch carries no commit added by the pass

  # AC3, the sweep half: the June regression in miniature. Twenty dangling entries restored onto the
  # index — the shape a `resolve_conflict` textual union produces — are all dropped in ONE tick, and
  # every live entry survives. Both halves matter: a sweep that dropped only the first, or that
  # over-pruned into the live entries, would be worse than the regression it repairs.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: Twenty restored dangling entries are dropped in a single tick and every live entry survives
    Given a docs index on origin's default branch into which 20 dangling entries have been restored
    And the remaining entries on origin's default branch all have tracked doc files
    When the cron cycle runs the docs-index sweep
    Then the index on the docs-index sweep branch omits all 20 dangling entries
    And the index on the docs-index sweep branch retains every entry whose doc file is tracked

  # Non-fatal at the persistence layer, and self-healing across ticks. A merge that fails leaves the
  # repair unlanded — which is correct, because the repair was never committed to the shared base —
  # and the failure must be visible rather than swallowed silently. The next tick re-derives the same
  # deterministic repair from origin and tries again.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A sweep whose pull request fails to merge reports the failure and re-attempts on the next tick
    Given a docs index on origin's default branch carrying an entry whose doc file is not tracked
    And the merge of the docs-index sweep pull request will fail
    When the cron cycle runs the docs-index sweep
    Then the docs-index sweep reports the merge failure as an error
    And origin's default branch index still carries the dangling entry
    And the cron cycle completes without raising an error
    And a later docs-index sweep re-attempts the repair

  # AC5, the sweep half. On a cron host polling a target repository, the pass must repair the
  # repository the launch boundary names and no other — including when the host's own checkout has
  # the very same defect sitting in front of it. #769 pinned this for the two sibling sweeps; a new
  # sweep is a new chance to reintroduce a cwd-derived identity.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A target-repo cron tick repairs the target repository's index and leaves the framework repository's alone
    Given a target repository checkout whose docs index carries a dangling entry
    And a framework repository checkout whose docs index carries a dangling entry
    And the cron process is working from the framework repository checkout
    And the cron holds a launch context for the target repository
    When the cron cycle runs the docs-index sweep
    Then the sweep repairs the docs index of the target repository
    And the framework repository checkout's docs index still carries its dangling entry
    And every repository operation the pass performed was issued through the cron's launch context

  # ══════ §4  JUDGEMENT FINDINGS FILE EXACTLY ONE OPEN HITL ISSUE (task 1b) ═══════════════
  #
  # The reporting contract. Three violation kinds found in one tick produce ONE issue, `hitl`-
  # labelled so the resulting work is human-approved, and the body must actually name the offenders —
  # an issue that says "overlaps detected" costs a human the same investigation the sweep just did.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: Overlapping globs, an orphan doc and an out-of-band count are reported in a single hitl issue
    Given a docs index on origin's default branch whose entries overlap on a tracked file
    And an app doc tracked on origin's default branch that no entry indexes
    And the index on origin's default branch holds more entries than the band allows
    When the cron cycle runs the docs-index sweep
    Then the docs-index sweep files exactly one issue
    And the filed issue carries the "hitl" label
    And the filed issue body names the overlapping entry pair
    And the filed issue body names the orphan doc
    And the filed issue body reports the entry count against the band

  # "At most one OPEN issue" is the requirement, and a cadence this generous still comes around. The
  # reconciliation is the `promotionReconcileLink.ts` shape: the filed issue carries a back-link
  # marker, the next tick finds the open tracker by it, and files nothing. Without this the sweep
  # becomes an issue generator — a hundred trackers for one unresolved overlap.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A second tick over the same violations reconciles against the open tracker and files no second issue
    Given a docs index on origin's default branch whose entries overlap on a tracked file
    When the cron cycle runs the docs-index sweep
    And the cron cycle runs the docs-index sweep again
    Then the docs-index sweep files exactly one issue across both ticks
    And the second tick reconciles against the open docs-index health issue by its back-link

  # A tracker that was closed — the human resolved the overlaps, or decided they were fine and closed
  # it — must not suppress reporting forever. If the violation is still there on a later tick, a new
  # tracker is filed. "At most one OPEN" is not "at most one ever".

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A violation that outlives a closed tracker is re-filed as one new issue
    Given a docs index on origin's default branch whose entries overlap on a tracked file
    And a closed docs-index health issue carrying the back-link already exists
    When the cron cycle runs the docs-index sweep
    Then the docs-index sweep files exactly one issue
    And the filed issue carries the "hitl" label

  # The line between the two halves of the sweep, asserted as negative space. A violation is reported,
  # never repaired: the overlapping entries stay exactly as they are, and no PR is opened on their
  # account. An implementation that resolved overlaps by dropping one side would delete authored
  # documentation on a cadence, and the deletion would arrive pre-merged.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: Overlapping entries are left untouched in the index and no repair pull request is opened for them
    Given a docs index on origin's default branch whose entries overlap on a tracked file
    And every entry on origin's default branch has a tracked doc file and live globs
    When the cron cycle runs the docs-index sweep
    Then the docs-index sweep opens no pull request
    And origin's default branch index still carries both overlapping entries

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: A tick that finds no violations files no issue at all
    Given a docs index on origin's default branch whose entries all have tracked doc files and live globs
    And the index on origin's default branch holds an entry count inside the band
    When the cron cycle runs the docs-index sweep
    Then the docs-index sweep files no issue

  # AC5, the reporting half. The tracker belongs to the repository whose index is broken. Filing it
  # against the cron host's own repository would bury a target repo's documentation debt in the
  # framework's backlog, where nobody who can fix it is looking.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: The hitl issue is filed in the launch-boundary repository, not the cron host's own
    Given a target repository checkout whose docs index carries overlapping entries
    And the cron process is working from the framework repository checkout
    And the cron holds a launch context for the target repository
    When the cron cycle runs the docs-index sweep
    Then the docs-index health issue is created in the target repository
    And the docs-index sweep creates no issue in the framework repository

  # ══════ §5  THE GATE IS A CI-RUNNABLE COMMAND THAT NEEDS NO FORGE (task 2) ══════════════
  #
  # What CI actually depends on: a broken index fails the command. AC3's CI half — the same 20
  # restored dangling entries §3 repairs — arriving on a branch and being caught before merge. The
  # gate must NAME them: a red check that says only "1 check failed" sends the author back to run it
  # locally, which is the CI equivalent of not reporting at all.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: The docs-index gate fails and names every dangling entry when twenty are restored on a branch
    Given a fixture checkout into which 20 dangling entries have been restored on a branch
    When the docs-index gate runs over the fixture checkout
    Then the docs-index gate exits non-zero
    And the docs-index gate names all 20 dangling entries in its report

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: The docs-index gate exits 0 over a healthy fixture checkout
    Given a fixture checkout whose docs index is healthy
    When the docs-index gate runs over the fixture checkout
    Then the docs-index gate exits 0

  # The gate bug from the CI side. Both READMEs are tracked and present; a gate that reports them
  # dangling turns every pull request red for a defect that does not exist, and the standard response
  # to a permanently-red check is to stop reading it — which is how the index rotted the first time.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: Top-level README entries are not reported as dangling by the gate
    Given a fixture checkout whose docs index indexes "README.md" and "adws/README.md"
    And both README files are tracked in the fixture checkout
    When the docs-index gate runs over the fixture checkout
    Then the docs-index gate reports no dangling entry

  # AC2's prerequisite, asserted as behaviour rather than as an absent line of code. A CI runner has
  # no GitHub App installation for the repository under test; `gitContextForRepo` eagerly resolves an
  # installation token, and #812 showed exactly what that throws when the App is not installed. The
  # observable is that the gate reaches a verdict anyway and asks the forge for nothing.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: The gate reaches its verdict with no forge credentials and issues no forge request
    Given a fixture checkout whose docs index is healthy
    And no forge credentials are available to the gate
    When the docs-index gate runs over the fixture checkout
    Then the docs-index gate exits 0
    And the docs-index gate issued no forge request

  # The other half of removing that call: the guard's self-cleaning ratchet. Leaving the allowlist
  # entry behind after the construction is gone is itself a guard failure, so this scenario fails
  # both ways round — construction removed but entry left, or entry removed but construction left.
  # AC5's `bun run lint:git-guard` green.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: The git/gh guard passes across the repository with the docs-index gate de-allowlisted
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations
    And the git/gh guard reports no stale allowlist entry for the docs-index gate

  # ══════ §6  THE REAL INDEX IS GREEN (AC1, AC4 — the convergence pass's only observable) ══
  #
  # AC1, end to end, through the entry point CI invokes. This is the scenario the whole issue exists
  # to turn green, and it is RED today on three separate checks (header transcript). It is also the
  # only assertion that task 3's fold — 23 feature docs into their owning module docs, `oqb76h`
  # promoted to the module doc for `adws/gitContext/` — can be measured by: the merged prose is LLM
  # output, the resulting index is not.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: The docs-index gate exits 0 over the ADW checkout when run through its package script entry point
    Given the ADW codebase is checked out
    When the docs-index gate is run through its package script entry point
    Then the docs-index gate exits 0

  # AC4, split into its three named checks so a failure says WHICH invariant broke rather than only
  # that the gate is red — and so the convergence pass can be seen landing one at a time. Overlaps
  # and the count are RED today; orphans are green and must stay that way, since folding docs is
  # exactly the operation that leaves orphans behind when the index is not updated with them.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: The ADW index has no overlapping owned globs after the convergence pass
    Given the ADW codebase is checked out
    When the docs-index gate is run over the ADW checkout
    Then the docs-index gate reports no overlapping owned globs

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: The ADW index leaves no doc file unindexed after the convergence pass
    Given the ADW codebase is checked out
    When the docs-index gate is run over the ADW checkout
    Then the docs-index gate reports no orphan docs

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: The ADW index entry count sits inside the gate's band after the convergence pass
    Given the ADW codebase is checked out
    When the docs-index gate is run over the ADW checkout
    Then the docs-index gate reports the entry count inside its band

  # ══════ §7  TYPE-CHECK BACKSTOP (registry T22) ═════════════════════════════════════════
  #
  # A new core module, a new trigger, a new cadence constant, a changed dispatch site and a gate that
  # loses a dependency — five places where a plausible edit compiles in the author's head and not in
  # `tsc`. The removed `gitContextForRepo` import is the likeliest to be left dangling.

  @adw-810 @adw-o0g36j-docs-index-health-cr
  Scenario: TypeScript type-check passes with the docs-index health module, the cron sweep and the reworked gate wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
