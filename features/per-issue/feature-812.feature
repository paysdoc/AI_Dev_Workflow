@adw-812 @adw-53s866-cron-trigger-crash-l
Feature: The janitor walks only the repositories ADW manages, one unreachable repository never ends the pass, and no single tick can kill the cron trigger

  Issue #812 is a production crash loop, not a refactor. The cron trigger for
  `paysdoc/AI_Dev_Workflow` died and was respawned every ~5 minutes — 17 crashes recorded in
  `logs/agents/cron/paysdoc_AI_Dev_Workflow.log` — with the operator seeing alternating
  `Removing stale cron PID file … (PID N is dead)` / `Spawning cron trigger` lines interleaved with
  ADW's own build-progress comments. Every crash landed on a janitor cycle.

  The chain, as recorded in the issue:

    1. `TARGET_REPOS_DIR` points at a directory that also holds NON-ADW projects — on the operator
       machine `/Users/martin/projects`, which carries course repos such as `paicc/paicc-1`
       alongside the six ADW-managed ones (29 git repos in total).
    2. Every `JANITOR_INTERVAL_CYCLES` (15 × 20s = 5 min) `runJanitorPass()` calls
       `discoverTargetRepoWorktrees()` (`adws/triggers/devServerJanitor.ts:147`), which walks
       `TARGET_REPOS_DIR/{owner}/{repo}` and admits ANY directory carrying a `.git` entry
       (`defaultIsGitRepo`) as an ADW target repository.
    3. For each admitted repository `DEFAULT_DEPS.listWorktrees` builds
       `gitContextForSync({ owner, repo, selfHost: false })`, whose construction EAGERLY resolves a
       GitHub App installation token. For a repository the App was never installed on,
       `resolveInstallationId` (`adws/providers/github/appAuth.ts:284`) throws `HTTP 404 (Not Found)`.
    4. Discovery has no `try`/`catch` around `deps.listWorktrees`. The per-candidate `catch` in
       `runJanitorPass` (`devServerJanitor.ts:271-305`) only begins AFTER discovery returns, so the
       throw sails straight out of the pass.
    5. The tick is launched as `void checkAndTrigger()` — both the immediate call and the
       `setInterval` callback (`adws/triggers/trigger_cron.ts:520-521`) — with no rejection handler.
       Node treats the rejected promise as unhandled and kills the whole trigger process.
    6. The PID file goes stale, the next webhook event respawns the cron via
       `webhookGatekeeper.ensureCronProcess`, and five minutes later it happens again.

  Three independent defects sit on that chain, and this feature pins all three, because fixing any
  one alone leaves the trigger killable:

    §1  ADMISSION IS THE `.adw` MARKER (Desired behavior 1; AC1, AC2). A `{owner}/{repo}` directory
        is an ADW target repository only when it carries a `.adw` entry IN ADDITION TO `.git`.
        `.adw/` is written by `adw_init` into every ADW-managed repository, so it is the marker that
        already exists. An unmarked repository is skipped ENTIRELY — no `GitContext` construction,
        no App-token resolution, no `lsof` probing, no kill decision. On the operator host this cuts
        the scanned set from 29 repositories to the 6 ADW manages. The self-host framework
        repository carries `.adw` and stays discoverable: that is intended, not incidental.

    §2  ONE UNREACHABLE REPOSITORY IS A WARNING, NOT THE END OF THE PASS (Desired behavior 2; AC3).
        `.adw` narrows the blast radius but does not close the hole: an ADW-managed repository can
        still fail its worktree listing — App uninstalled, remote deleted, network down — and today
        that single failure aborts discovery for every repository behind it. The failure must log a
        warning NAMING the repository and skip it, with the rest of the pass unaffected.

    §3  A TICK THAT THROWS MUST NOT TAKE THE PROCESS WITH IT (Desired behavior 3; AC4). §1 and §2
        remove the throw that was actually observed; §3 removes the class. `void checkAndTrigger()`
        converts ANY rejection anywhere in a tick — pause-queue resume, auth gate, sweep, a future
        caller nobody has written yet — into process death. The guard catches and logs, and the
        interval keeps firing.

  How these scenarios observe the system. Every assertion below targets a runtime artefact: the
  injected `JanitorDeps` invocations the pass actually records (which repositories were listed,
  which worktrees were probed, which processes were killed), the warning stream the pass emits, and
  — for §3 — the liveness and captured log stream of a spawned cron process. `discoverTargetRepoWorktrees`
  and `runJanitorPass` both take injectable deps, so §1 and §2 drive the real pass over a real
  throwaway target-repos root (`TARGET_REPOS_DIR` is env-derived, `adws/core/environment.ts:161`)
  with only the network- and OS-touching deps stubbed. No scenario reads a source file.

  The RED/GREEN pivot in §1 is deliberate and worth stating: the unmarked repository's stubbed
  worktree listing THROWS the App-installation 404, exactly as production does. If discovery still
  admits the repository, the scenario fails the way the operator's cron failed; once the marker
  filter lands, the stub is never called at all. The assertion "no listing was attempted" and the
  assertion "the pass survived" are the same fact seen from two sides.

  A note for the §3 step definitions: the lever that makes a tick throw must be one the §1/§2
  discovery isolation does NOT swallow — otherwise the guard is never exercised and the scenario
  goes green for the wrong reason. A pause-queue entry whose resume fails (`scanPauseQueue` →
  `resumeWorkflow`, `adws/triggers/pauseQueueScanner.ts:245-258`, unguarded at the tick level) is
  such a lever; the janitor-shaped one is not, and is used only in the end-to-end incident scenario
  that closes §3.

  Background:
    Given the ADW codebase is checked out

  # ── §1 ADMISSION IS THE `.adw` MARKER (Desired behavior 1; AC1) ─────────────────────────
  #
  # The headline, and a faithful reproduction of the incident: one ADW-managed repository beside one
  # course repository the GitHub App was never installed on. Today discovery admits both, builds a
  # GitContext for `paicc/paicc-1`, eats the 404 and takes the trigger down with it. After the fix
  # the unmarked repository is never touched — and the ADW-managed repository beside it is still
  # scanned in the same pass, which is what makes this a filter rather than a mute. RED before.

  @adw-812 @adw-53s866-cron-trigger-crash-l
  Scenario: A repository without the ADW marker is never listed, even when its worktree listing would fail with an App-installation 404
    Given the target repositories root holds "paysdoc/AI_Dev_Workflow" with a git checkout and an ADW marker directory
    And the target repositories root holds "paicc/paicc-1" with a git checkout and no ADW marker directory
    And the repository "paysdoc/AI_Dev_Workflow" has a worktree "feature-issue-800-provider-triple"
    And the worktree listing for "paicc/paicc-1" fails with a GitHub App installation not-found error
    When the janitor pass runs
    Then the janitor lists no worktrees for repository "paicc/paicc-1"
    And the janitor lists the worktrees of repository "paysdoc/AI_Dev_Workflow"
    And the janitor pass completes without raising

  # An unmarked repository must be skipped ENTIRELY, not merely spared the token resolution. The
  # issue enumerates three probes that must not happen for it, and each is a separate observable:
  # the worktree listing, the `lsof` process probe, and the kill. A fix that filtered only at the
  # listing site would still `lsof +D` and SIGTERM inside a course repository the operator never
  # handed to ADW — the most expensive way to be wrong here. (AC1.)

  @adw-812 @adw-53s866-cron-trigger-crash-l
  Scenario: An unmarked repository is neither probed for processes nor considered for cleaning
    Given the target repositories root holds "paicc/paicc-1" with a git checkout and no ADW marker directory
    And the repository "paicc/paicc-1" has a worktree "feature-issue-31-course-exercise"
    And the worktree "feature-issue-31-course-exercise" holds a live process
    And the worktree "feature-issue-31-course-exercise" is older than the janitor grace period with no live orchestrator
    When the janitor pass runs
    Then the janitor lists no worktrees for repository "paicc/paicc-1"
    And the janitor probes no worktree under repository "paicc/paicc-1"
    And the janitor kills no processes under repository "paicc/paicc-1"

  # The filter is a CONJUNCTION, not a swap. A directory carrying `.adw` but no `.git` is not a
  # repository at all — a bare `.adw` config folder, a half-deleted clone, an operator's notes
  # directory — and admitting it would hand a non-repository to `git worktree list`. Pinned as
  # negative space because the cheapest wrong fix is to replace the `.git` test with a `.adw` test
  # rather than to require both. (Desired behavior 1: "in addition to `.git`".)

  @adw-812 @adw-53s866-cron-trigger-crash-l
  Scenario: A directory carrying the ADW marker but no git checkout is not admitted as a target repository
    Given the target repositories root holds "acme/notes" with an ADW marker directory and no git checkout
    When the janitor pass runs
    Then the janitor lists no worktrees for repository "acme/notes"
    And the janitor probes no worktree under repository "acme/notes"

  # ── §2 THE MARKED REPOSITORY IS DISCOVERED EXACTLY AS BEFORE (AC2) ──────────────────────
  #
  # The other half of the filter, and the reason the janitor still earns its keep: a repository
  # carrying both entries reaches the full decision path — listed, probed, and cleaned when the kill
  # rule says so. GREEN before and after; this is the scenario that fails if the marker filter is
  # written too tightly (wrong marker name, file-vs-directory confusion, case sensitivity).

  @adw-812 @adw-53s866-cron-trigger-crash-l
  Scenario: A repository carrying both a git checkout and the ADW marker is scanned and cleaned as before
    Given the target repositories root holds "paysdoc/paysdoc.nl" with a git checkout and an ADW marker directory
    And the repository "paysdoc/paysdoc.nl" has a worktree "feature-issue-28-cancel-directive"
    And the worktree "feature-issue-28-cancel-directive" holds a live process
    And the worktree "feature-issue-28-cancel-directive" is older than the janitor grace period with no live orchestrator
    When the janitor pass runs
    Then the janitor lists the worktrees of repository "paysdoc/paysdoc.nl"
    And the janitor probes the worktree "feature-issue-28-cancel-directive"
    And the janitor cleans the orphaned processes in worktree "feature-issue-28-cancel-directive"

  # The self-host case, called out explicitly in the issue ("The self-host framework repo itself
  # contains `.adw` and remains discoverable — that is intended"). The framework dogfoods itself, so
  # its own worktrees are exactly the ones that strand dev servers most often; a marker filter that
  # accidentally excluded the framework repository would silently retire the janitor's main job.

  @adw-812 @adw-53s866-cron-trigger-crash-l
  Scenario: The self-host framework repository carries the marker and stays in the janitor's scan set
    Given the target repositories root holds "paysdoc/AI_Dev_Workflow" with a git checkout and an ADW marker directory
    And the repository "paysdoc/AI_Dev_Workflow" has a worktree "bugfix-issue-812-cron-janitor-marker"
    And the worktree "bugfix-issue-812-cron-janitor-marker" holds a live process
    When the janitor pass runs
    Then the janitor lists the worktrees of repository "paysdoc/AI_Dev_Workflow"
    And the janitor probes the worktree "bugfix-issue-812-cron-janitor-marker"

  # ── §3 ONE UNREACHABLE REPOSITORY IS A WARNING, NOT THE END OF THE PASS (AC3) ───────────
  #
  # The marker filter narrows WHICH repositories are listed; it does not make listing infallible. An
  # ADW-managed repository whose App installation was revoked, whose remote was deleted, or whose
  # network call times out still throws from inside discovery. Today that throw ends the pass for
  # every repository — including ones already walked past — and continues out to the tick. The
  # failure must be logged with the repository NAMED (an unnamed warning is unactionable when six
  # repositories are in the set) and the pass must carry on. RED before.

  @adw-812 @adw-53s866-cron-trigger-crash-l
  Scenario: A repository whose worktree listing fails is logged by name and skipped while the pass continues
    Given the target repositories root holds "paysdoc/AI_Dev_Workflow" with a git checkout and an ADW marker directory
    And the target repositories root holds "paysdoc/revoked-app" with a git checkout and an ADW marker directory
    And the target repositories root holds "paysdoc/paysdoc.nl" with a git checkout and an ADW marker directory
    And the repository "paysdoc/AI_Dev_Workflow" has a worktree "feature-issue-796-migrate-orchestrators"
    And the repository "paysdoc/paysdoc.nl" has a worktree "feature-issue-28-cancel-directive"
    And the worktree listing for "paysdoc/revoked-app" fails with a GitHub App installation not-found error
    When the janitor pass runs
    Then the janitor logs a warning naming repository "paysdoc/revoked-app"
    And the janitor lists the worktrees of repository "paysdoc/AI_Dev_Workflow"
    And the janitor lists the worktrees of repository "paysdoc/paysdoc.nl"
    And the janitor pass completes without raising

  # Isolation must not depend on WHERE the bad repository sits in the walk. A `try`/`catch` placed
  # around the whole owner loop rather than around the single listing would pass the scenario above
  # (the failing repository happens to sit in the middle of one owner) and still lose every
  # repository behind the failure under a different directory ordering. The outline drives the same
  # three-repository set with the failure first, middle and last; in every ordering the two healthy
  # repositories are listed.

  @adw-812 @adw-53s866-cron-trigger-crash-l
  Scenario Outline: A failing repository at any position in the walk costs only itself
    Given the target repositories root holds three ADW-marked repositories with the failing one "<position>"
    And the worktree listing for the failing repository fails with "network unreachable"
    When the janitor pass runs
    Then the janitor lists the worktrees of both healthy repositories
    And the janitor logs a warning naming the failing repository
    And the janitor pass completes without raising

    Examples:
      | position |
      | first    |
      | middle   |
      | last     |

  # Surviving the failure is necessary but not sufficient: the pass must still do its WORK. A skip
  # implemented by returning an empty candidate list on the first error would satisfy every
  # assertion above and quietly stop cleaning anything the moment one repository goes bad — the
  # janitor equivalent of failing silent. Here an orphaned dev server sits in a repository walked
  # after the failing one, and it still gets cleaned in the same pass.

  @adw-812 @adw-53s866-cron-trigger-crash-l
  Scenario: An orphaned dev server behind a failing repository is still cleaned in the same pass
    Given the target repositories root holds "paysdoc/revoked-app" with a git checkout and an ADW marker directory
    And the target repositories root holds "paysdoc/paysdoc.nl" with a git checkout and an ADW marker directory
    And the worktree listing for "paysdoc/revoked-app" fails with a GitHub App installation not-found error
    And the repository "paysdoc/paysdoc.nl" has a worktree "feature-issue-28-cancel-directive"
    And the worktree "feature-issue-28-cancel-directive" holds a live process
    And the worktree "feature-issue-28-cancel-directive" is older than the janitor grace period with no live orchestrator
    When the janitor pass runs
    Then the janitor cleans the orphaned processes in worktree "feature-issue-28-cancel-directive"

  # ── §4 A TICK THAT THROWS MUST NOT TAKE THE PROCESS WITH IT (AC4) ───────────────────────
  #
  # The class-level fix, and the one that would have contained this incident on its own. `void
  # checkAndTrigger()` promotes any rejection in any part of a tick into process death — the janitor
  # was merely the caller that found it first. The guard is asserted through the three facts an
  # operator would check: the failure is in the log, the process is still there, and the loop moved
  # on. The third matters most: a guard that catches and then stops rescheduling trades a crash loop
  # for a silent stall, which is strictly worse to diagnose. RED before on all three.

  @adw-812 @adw-53s866-cron-trigger-crash-l
  Scenario: A poll tick that raises is logged and the cron trigger keeps polling
    Given a cron trigger process whose poll tick raises on every cycle
    When the cron trigger loop runs past the failing tick
    Then the cron trigger logs the tick failure as an error
    And the cron trigger process is still running
    And the cron trigger executes its next poll tick

  # The incident itself, end to end, at the process level: a cron trigger polling a target
  # repositories root that holds a non-ADW repository the App was never installed on, driven through
  # the janitor cycle that killed it 17 times. This is the scenario that reproduces the operator's
  # `Removing stale cron PID file … (PID N is dead)` loop, and the one that proves the three fixes
  # compose — the repository is filtered out (§1), a listing failure could only warn (§2), and even
  # an unexpected throw could not end the process (§3). RED before: the trigger dies on the first
  # janitor cycle and never reaches the next tick.

  @adw-812 @adw-53s866-cron-trigger-crash-l
  Scenario: The cron trigger survives a janitor cycle over a target repositories root holding a non-ADW repository
    Given a cron trigger process polling a target repositories root that holds "paicc/paicc-1" with a git checkout and no ADW marker directory
    And the GitHub App is not installed on "paicc/paicc-1"
    When the cron trigger loop runs its janitor cycle
    Then the cron trigger process is still running
    And the cron trigger process has not exited on an unhandled promise rejection
    And the cron trigger executes its next poll tick

  # ── §5 TYPE-CHECK ───────────────────────────────────────────────────────────────────────
  #
  # The discovery filter adds a dependency to the injectable `JanitorDeps` surface and the tick guard
  # changes the shape of two call sites; both are places where a plausible edit compiles in the
  # author's head and not in `tsc`.

  @adw-812 @adw-53s866-cron-trigger-crash-l
  Scenario: TypeScript type-check passes after the marker filter, the discovery isolation and the tick guard
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
