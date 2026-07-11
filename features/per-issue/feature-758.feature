@adw-758 @adw-cz390a-perissuescenariosswee
Feature: The per-issue scenario sweep syncs to origin and lands its removals via a pushed branch + PR — a cron host whose local default branch is behind origin no longer strands the removal locally

  Issue #758 fixes a persistence hole in the 14-day per-issue retention sweep
  (`runPerIssueScenarioSweep`, `adws/triggers/perIssueScenarioSweep.ts`, invoked every
  backlog cycle at `adws/triggers/trigger_cron.ts`). #735 made the sweep COMMIT and PUSH
  its removals; but that push goes DIRECTLY to the default branch from whatever stale local
  `dev` the cron host happens to hold, and on a host that is behind origin it is structurally
  doomed and silently swallowed. Observed live: two bot-authored
  `chore: sweep stale per-issue scenarios (>14d post-merge)` commits stranded on a local
  `dev` that was 47 commits behind `origin/dev`, never pushed.

  Three defects compose into the strand:

    Defect 1 — no origin sync before decide/commit. `defaultPersistRemoval`
    (`perIssueScenarioSweep.ts`) only checks the checkout is ON the default branch BY NAME
    (`getCurrentBranch(...) !== branch`); there is no `git fetch origin dev &&
    git reset --hard origin/dev` anywhere in the sweep path, and `trigger_cron.ts` calls
    the sweep with no preceding sync. So the removal is committed onto a stale base.

    Defect 2 — the direct default-branch push is doomed and swallowed. `commitOps.pushBranch`
    runs `git push --force-with-lease --force-if-includes -u origin dev`. `--force-if-includes`
    requires the overwritten commits to already be in local history; when local `dev` is
    behind `origin/dev` it is (correctly) lease-rejected. `defaultPersistRemoval`'s `catch`
    then swallows it at `warn` ("...leaving removal uncommitted for next sweep"). Nothing
    reaches origin, and the failure is invisible to an operator. (The default branch can also
    carry branch/commit protections that reject direct pushes outright — an additional,
    environment-dependent doom on top of the lease rejection.)

    Defect 3 — "self-heals on next sweep" is false for this path. `removeAndCommitPaths`
    COMMITS the removal, so the files leave the git index. `defaultListFeatures` lists from
    `ls-files` (the index), so the next sweep does not re-list them, finds nothing stale,
    returns early, and NEVER retries the push. The commit strands until some unrelated
    feature ages past 14d and triggers a fresh commit that happens to carry the backlog.

  THE FIX (issue "Proposed fix"): stop pushing the sweep directly to the default branch.
  Sync to fresh `origin/<default>` first (so the removal sits on the current tip), push the
  removal to a DEDICATED sweep branch, and open a PR that lands via auto-merge — surfacing
  and retrying push failures instead of swallowing them.

  The behavioural contract pinned below (the OBSERVABLE half of the acceptance criteria):

    1. STALE-BASE HOST STILL LANDS THE REMOVAL ON ORIGIN (AC1 / AC4). A sweep on a cron host
       whose local default branch is behind origin still lands the removal on origin — on a
       dedicated sweep branch, with an open PR — rather than lease-rejecting and stranding it
       locally. This is the regression coverage the issue asks for (stale-base cron host →
       removal reaches origin).
    2. THE SWEEP OPERATES ON A SYNCED BASE (AC2). The sweep fetches and resets to
       `origin/<default>` before it decides and commits, so the removal is built on origin's
       CURRENT tip — the sweep branch it pushes contains the origin commit the host had not
       yet fetched. No stale-base decision, no removal committed onto a phantom base.
    3. NO STRANDED LOCAL COMMIT (AC1). After the sweep, the cron host's local default branch
       carries no commit that origin's default branch lacks — the removal is not sitting
       unpushed on a local `dev`, which was the live symptom.
    4. THE DEFAULT BRANCH IS NEVER PUSHED DIRECTLY (AC1 "via PR"). Even on a clean-base host
       where the old direct push WOULD have succeeded, the sweep leaves origin's default
       branch tip untouched and routes the removal onto a sweep branch — the fix removes the
       direct-default-branch push unconditionally (branch protections, not just staleness).
    5. THE REMOVAL LANDS VIA A PULL REQUEST (AC1 "via PR"). The sweep opens a pull request
       from the sweep branch into the default branch — the removal reaches the default branch
       through review/auto-merge, never a direct push.
    6. A REJECTED PUSH IS SURFACED, NOT SWALLOWED (AC3). A push / lease rejection is reported
       as an ERROR (an operator can see it), instead of the current silent `warn`-and-drop.
    7. A FAILED PERSISTENCE IS RETRIED, NOT ABANDONED (AC3 / Defect 3). When the first push
       is rejected, a subsequent sweep re-attempts and lands the removal on origin — the
       removal is not hidden from the next sweep by a local commit and permanently stranded.
    8. TYPE-CHECK BACKSTOP (T22). The ADW TypeScript type-check still passes with the
       origin-syncing, branch-and-PR persistence wired in.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the sweep PRODUCES — the branches and commit
    trees on a real bare `origin` remote, the commit graph of the cron host's local default
    branch, a recorded pull-request-open call, a recorded error-level log entry, or the
    type-checker's verdict (T22). These are vocabulary registry surfaces #3 ("git artefacts:
    branches, commits, pushes, and worktree state produced by the system under test"), #2
    (recorded calls), and #5 (log streams). No step reads `perIssueScenarioSweep.ts`,
    `commitOps.ts`, `trigger_cron.ts`, or any framework source file as text, substring-matches
    its contents, or parses it as JSON/AST.

      • The seeded `feature-{N}.feature` and `feature-{N}.steps.ts` files are INPUT TEST
        FIXTURES committed into a throwaway temp git repo whose `origin` is a real bare
        remote — git artefacts the sweep consumes, the exact category the Rot-Detection
        Rubric permits (as feature-735 / feature-739 seed their fixture scenarios and
        feature-648 seeds commits into a real temp repo). They are NOT source files of this
        framework; asserting where the sweep PUTS the resulting removal (a sweep branch on
        origin, not the local default) is asserting the SUT's observable OUTPUT.
      • §6 asserts against a recorded, injected logger call (an error-level entry), not source
        text — the operator-facing surfacing behaviour, which is exactly what "surfaced, not
        swallowed" means.
      • §5 asserts against a recorded, injected pull-request-open call (head branch → base
        branch), not source text — see the merge-mechanism scope note below.

  Scope notes:

    • THIS SLICE SUPERSEDES feature-735 §2 AND §3. feature-735's persistence contract pins a
      DIRECT push to the DEFAULT branch: §2 "the sweep commit ON THE DEFAULT BRANCH records
      the deletion…" and §3 "the removal is pushed so the ORIGIN REMOTE'S DEFAULT BRANCH no
      longer carries the scenario." This fix deliberately REPLACES that with sync →
      sweep-branch → PR, so those two assertions no longer describe production. feature-735 /
      feature-739 do not regress mechanically — their step defs INJECT a hand-wired
      `persistRemoval` mirror of the old direct-push logic (they never call the real
      `defaultPersistRemoval`), so they stay green while asserting a contract production has
      abandoned. Because they belong to another issue's tag and encode a now-stale contract,
      this writer does NOT silently rewrite them; the supersession is flagged for maintainer
      triage (retire feature-735 §2/§3, or retarget them onto the branch/PR contract owned
      here). Surfaced in the agent Output.
    • THE MERGE MECHANISM IS UNPINNED — it is the issue's OPEN DESIGN QUESTION. How the chore
      PR actually merges (GitHub-native `gh pr merge --auto` vs a label-driven cron path) is
      the implementer's decision; these scenarios pin ONLY the framework's responsibility —
      the removal is synced, pushed to a sweep branch, and a PR is opened — never how or when
      that PR merges. The in-process harness's bare remote cannot auto-merge a PR, so "the
      removal reaches origin" is asserted as "the removal is on origin, on a sweep branch,
      with a PR open," NOT "origin's default branch no longer carries the scenario" (which
      would require the external merge). The actual merge-to-default is GitHub-side /
      cron-side and out of this harness's reach, by design.
    • THE RETENTION WINDOW, THE SIBLING-CLEANUP, AND THE NO-EMPTY-COMMIT GUARD ARE
      feature-735 / feature-739's CONTRACT and are not re-pinned here. This fix changes only
      WHERE and HOW the removal is persisted (synced base → sweep branch → PR, with failures
      surfaced and retried); it must not widen, narrow, or disable the 14-day window, nor
      change which files are swept.
    • THE PURE-UNIT HALVES ARE THE IMPLEMENTER'S, NOT BDD. The exact sweep-branch naming, the
      idempotency of re-opening a PR across cycles, the precise retry cadence, and the
      structural choice of how the persist path is factored to be fixture-drivable belong in
      the implementer's Vitest coverage — exactly as feature-735 / feature-739 split their
      unit tests from their end-to-end BDD scenarios. The BDD layer here pins only the
      observable integration behaviour over a real repo + remote.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the regression suite is
      a deliberate human decision and the agent never auto-promotes. The issue's "regression
      scenario covering: stale-base cron host → removal reaches origin" is provided as the
      durable per-issue scenario §1 below; whether it is later promoted into
      `features/regression/` is a human call.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for an origin-syncing sweep,
    a cron host whose default branch is behind origin, a dedicated sweep branch on the remote,
    a stranded-vs-clean local default branch, a sweep-opened pull request, or a surfaced push
    failure. The phrasing is deliberately DISTINCT from feature-735's plain-sweep phrases
    (`the per-issue scenario sweep runs over the repository`, `the origin remote's default
    branch no longer carries…`, `the sweep commit on the default branch records…`) and
    feature-739's promotion-aware phrases, so feature-758.steps.ts can define its own
    self-contained step defs without an AmbiguousStepDefinition clash under the globally-loaded
    per-issue step defs (the bespoke-per-feature convention; zero phrase collisions across the
    suite). The gap is surfaced to the maintainer in the agent Output:
      • `a per-issue scenario for issue {int} whose linked PR merged {int} days ago is committed on origin's default branch`
      • `the cron host's local default branch is behind origin by a commit it has never fetched`
      • `the cron host's local default branch is up to date with origin`
      • `the push of the sweep's removal to origin will be rejected`
      • `the sweep's first push of the removal to origin will be rejected`
      • `the per-issue scenario sweep runs on the cron host`
      • `origin carries a sweep branch that omits the per-issue scenario for issue {int}`
      • `the sweep branch on origin includes the origin commit the cron host had not fetched`
      • `the cron host's local default branch carries no commit absent from origin's default branch`
      • `origin's default branch tip is unchanged by the sweep`
      • `a pull request is opened from the sweep branch into the default branch`
      • `the sweep reports the push failure as an error`

    Step-definition note for the maintainer (feature-758.steps.ts — keep it SELF-CONTAINED
    with its own `@adw-758` Before/After and module-private `ctx`; do NOT reach into
    feature-735's / feature-739's sweep step defs):
      • Build the harness as feature-735.steps.ts does: a REAL temp git repo cloned from a
        REAL bare remote (`git init --bare` + `git clone`), default branch checked out. Seed
        `features/per-issue/feature-{N}.feature` AND its
        `features/per-issue/step_definitions/feature-{N}.steps.ts` sibling, commit on the
        default branch, and push so the remote carries the pre-sweep tree.
      • `the cron host's local default branch is behind origin by a commit it has never
        fetched` advances origin underneath the host: from a SECOND clone of the bare remote,
        add and push an unrelated commit to the default branch, and do NOT fetch it into the
        host clone. The host's default branch is now behind origin by a commit it has never
        seen — the precise stale-base condition. `…is up to date with origin` is the no-op
        clean-base counterpart (used by §4 to prove the direct-push removal is unconditional).
      • DRIVE THE REAL PERSIST PATH — do NOT re-mirror it. `the per-issue scenario sweep runs
        on the cron host` must drive the production sync + sweep-branch + push + PR-open
        persistence over the temp repo (the fix must expose it as a fixture-drivable seam
        parameterised by a `GitContext` over the temp repo, since the default
        `defaultPersistRemoval` resolves the real ADW repo via `getRepoInfo()` and cannot be
        pointed at a fixture). Inject ONLY: a FIXED `now`, `getMergedAt` per seeded issue
        (`FIXED_NOW − {int} days`; stale ≥ 14, fresh < 14), a capturing logger, and a
        recording pull-request-open seam (defaulting to `ctx.createPR`). If the step re-wired
        `removeAndCommitPaths` + `pushBranch` by hand (as feature-735 did) the scenario would
        be VACUOUS against #758's real bug — the RED must come from the real
        no-sync/direct-push/swallow code, the GREEN from the real sync/branch/PR code.
      • The "sweep branch" is the branch on the bare remote OTHER than the default branch (the
        sweep's dedicated removal branch); enumerate origin's branches, exclude the default,
        and assert against the remaining branch. `…omits the per-issue scenario for issue {int}`
        reads `git ls-tree -r --name-only <sweep-branch>` on the bare remote and asserts the
        feature path is absent. `…includes the origin commit the cron host had not fetched`
        asserts that unrelated commit's SHA/subject is an ancestor of the sweep branch on the
        remote (proving the sync happened before the removal was built).
      • `…local default branch carries no commit absent from origin's default branch` compares
        the host's default-branch tip against the bare remote's default-branch tip (assert the
        host tip is an ancestor of — or equal to — the remote tip; equivalently
        `git rev-list origin/<default>..<default>` is empty after a fetch). `origin's default
        branch tip is unchanged by the sweep` records the bare remote's default-branch SHA
        before the sweep and asserts it is identical afterwards.
      • `a pull request is opened from the sweep branch into the default branch` reads the
        injected PR-open recorder and asserts one open was requested with head = the sweep
        branch and base = the default branch. `the sweep reports the push failure as an error`
        forces a rejected push (`the push of the sweep's removal to origin will be rejected`
        via an injected push seam that throws, or a pre-diverged sweep branch on the remote)
        and asserts the injected logger recorded an ERROR-level entry — the current code logs
        this swallow at `warn`, so the scenario is RED until the fix raises it to `error`.
      • `the sweep's first push of the removal to origin will be rejected` fails the FIRST
        push and lets a later one succeed; §7 runs the sweep twice and asserts the removal
        lands on origin on the second pass — RED before (the first sweep hides the file behind
        a local commit and the second finds nothing to re-list), GREEN after (the synced,
        never-hidden removal is re-attempted).

  Background:
    Given the ADW codebase is checked out

  # ── §1 STALE-BASE HOST STILL LANDS THE REMOVAL ON ORIGIN (AC1 / AC4) ───────────────────
  #
  # The headline and the regression coverage the issue asks for. On a cron host whose local
  # default branch is behind origin, the old path lease-rejects and swallows, stranding the
  # removal locally. The fix syncs, pushes the removal to a dedicated sweep branch, and opens
  # a PR — so the removal reaches origin. RED before (no sweep branch on origin: the direct
  # default push was rejected and swallowed); GREEN after.

  @adw-758 @adw-cz390a-perissuescenariosswee
  Scenario: A sweep on a cron host whose default branch is behind origin still lands the removal on origin
    Given a per-issue scenario for issue 665 whose linked PR merged 20 days ago is committed on origin's default branch
    And the cron host's local default branch is behind origin by a commit it has never fetched
    When the per-issue scenario sweep runs on the cron host
    Then origin carries a sweep branch that omits the per-issue scenario for issue 665

  # ── §2 THE SWEEP OPERATES ON A SYNCED BASE (AC2) ───────────────────────────────────────
  #
  # The removal must be built on origin's CURRENT tip, not the host's stale local base. After
  # a fetch-and-reset to origin, the sweep branch it pushes contains the origin commit the
  # host had never fetched. RED before (no sync → the removal, if it committed at all, sits on
  # the stale base and never carries the missing origin commit); GREEN after.

  @adw-758 @adw-cz390a-perissuescenariosswee
  Scenario: The sweep decides and commits on a base synced to origin's current tip
    Given a per-issue scenario for issue 665 whose linked PR merged 20 days ago is committed on origin's default branch
    And the cron host's local default branch is behind origin by a commit it has never fetched
    When the per-issue scenario sweep runs on the cron host
    Then the sweep branch on origin includes the origin commit the cron host had not fetched

  # ── §3 NO STRANDED LOCAL COMMIT (AC1) ──────────────────────────────────────────────────
  #
  # The live symptom was two removal commits stranded on a local `dev` that never reached
  # origin. After the fix, the host's local default branch carries no commit that origin's
  # default branch lacks — the removal lives only on the pushed sweep branch. RED before (the
  # stranded, unpushed removal commit sits on local `dev`); GREEN after.

  @adw-758 @adw-cz390a-perissuescenariosswee
  Scenario: The sweep leaves no stranded removal commit on the cron host's local default branch
    Given a per-issue scenario for issue 665 whose linked PR merged 20 days ago is committed on origin's default branch
    And the cron host's local default branch is behind origin by a commit it has never fetched
    When the per-issue scenario sweep runs on the cron host
    Then the cron host's local default branch carries no commit absent from origin's default branch

  # ── §4 THE DEFAULT BRANCH IS NEVER PUSHED DIRECTLY (AC1 "via PR") ───────────────────────
  #
  # The fix removes the direct-default-branch push UNCONDITIONALLY — the default branch can
  # carry protections that reject direct pushes, so even on a clean-base host where the old
  # push would have succeeded, the sweep must leave origin's default tip untouched and route
  # the removal onto a sweep branch. RED before (on a clean base the old sweep pushes the
  # removal straight onto origin's default branch, advancing its tip, and creates no sweep
  # branch); GREEN after.

  @adw-758 @adw-cz390a-perissuescenariosswee
  Scenario: The sweep never pushes the removal directly to the default branch
    Given a per-issue scenario for issue 665 whose linked PR merged 20 days ago is committed on origin's default branch
    And the cron host's local default branch is up to date with origin
    When the per-issue scenario sweep runs on the cron host
    Then origin's default branch tip is unchanged by the sweep
    And origin carries a sweep branch that omits the per-issue scenario for issue 665

  # ── §5 THE REMOVAL LANDS VIA A PULL REQUEST (AC1 "via PR") ──────────────────────────────
  #
  # "Lands the removal on origin (via PR)" — the sweep opens a pull request from the sweep
  # branch into the default branch, so the removal reaches the default branch through
  # auto-merge rather than a direct push. HOW that PR merges (the issue's open design
  # question) is deliberately NOT pinned. RED before (no PR is opened — the old path pushes
  # directly); GREEN after.

  @adw-758 @adw-cz390a-perissuescenariosswee
  Scenario: The sweep opens a pull request to land the removal
    Given a per-issue scenario for issue 665 whose linked PR merged 20 days ago is committed on origin's default branch
    And the cron host's local default branch is behind origin by a commit it has never fetched
    When the per-issue scenario sweep runs on the cron host
    Then a pull request is opened from the sweep branch into the default branch

  # ── §6 A REJECTED PUSH IS SURFACED, NOT SWALLOWED (AC3) ─────────────────────────────────
  #
  # The current `catch` swallows a lease rejection at `warn` ("…leaving removal uncommitted
  # for next sweep") — invisible to an operator. The fix must surface a push / lease rejection
  # as an ERROR. RED before (the swallow is logged at `warn`, so no error-level entry is
  # emitted); GREEN after.

  @adw-758 @adw-cz390a-perissuescenariosswee
  Scenario: A rejected push is surfaced as an error, not silently swallowed
    Given a per-issue scenario for issue 665 whose linked PR merged 20 days ago is committed on origin's default branch
    And the push of the sweep's removal to origin will be rejected
    When the per-issue scenario sweep runs on the cron host
    Then the sweep reports the push failure as an error

  # ── §7 A FAILED PERSISTENCE IS RETRIED, NOT ABANDONED (AC3 / Defect 3) ──────────────────
  #
  # "Self-heals on next sweep" is false under the bug: the old sweep COMMITS the removal
  # (files leave the index), so `defaultListFeatures` (ls-files) does not re-list them, the
  # next sweep finds nothing stale, and the failed push is never retried. Under the fix, a
  # first-push rejection does not hide the removal — a subsequent sweep re-syncs, re-lists,
  # and lands it on origin. RED before (the removal is hidden and permanently stranded after
  # the first failed push); GREEN after.

  @adw-758 @adw-cz390a-perissuescenariosswee
  Scenario: A removal whose first push is rejected is re-attempted on the next sweep, not abandoned
    Given a per-issue scenario for issue 665 whose linked PR merged 20 days ago is committed on origin's default branch
    And the sweep's first push of the removal to origin will be rejected
    When the per-issue scenario sweep runs on the cron host
    And the per-issue scenario sweep runs on the cron host
    Then origin carries a sweep branch that omits the per-issue scenario for issue 665
    And the cron host's local default branch carries no commit absent from origin's default branch

  # ── §T Type-check backstop (T22) ───────────────────────────────────────────────────────
  #
  # The origin-syncing, branch-and-PR persistence keeps the ADW codebase type-clean. A
  # backstop consistent with feature-735 §6 and feature-739 §T.

  @adw-758 @adw-cz390a-perissuescenariosswee
  Scenario: The ADW TypeScript type-check passes with the origin-syncing sweep persistence wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
