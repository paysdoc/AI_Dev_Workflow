@adw-735 @adw-qwfm4x-bug-per-issue-scenar
Feature: Per-issue scenario sweep persists its removals and cleans up orphaned step-def siblings

  Issue #735 fixes two defects in the 14-day per-issue retention sweep
  (`runPerIssueScenarioSweep`, `adws/triggers/perIssueScenarioSweep.ts`), invoked
  every backlog cycle at `adws/triggers/trigger_cron.ts`. Together they mean the
  "retention sweep" retains nothing durably and instead leaves the cron host's
  working tree permanently dirty.

  Defect 1 — deletions are never persisted. The sweep removes a stale scenario
  with a raw `fs.rmSync`, and neither it nor its caller stages, commits, or
  pushes. So the scenario is never removed from the default branch (`origin/dev`);
  and because the working-tree deletion is never committed, every subsequent cron
  cycle re-deletes the SAME already-merged file, so the host's tree accumulates
  uncommitted deletions without bound. Observed live: 67 `feature-*.feature` files
  sat unstaged-deleted in the cron host's tree, none committed. A perpetually
  dirty tree is a latent hazard for any git operation that assumes a clean
  checkout.

  Defect 2 — orphaned step-def siblings. The filename filter matches only
  `feature-{N}.feature`, so when a stale scenario is swept its sibling
  `features/per-issue/step_definitions/feature-{N}.steps.ts` is left behind. The
  result is a growing population of step-def files whose scenarios no longer exist
  (observed: 19 feature files against 85 step-def files on disk).

  The fix makes the sweep CORRECT and PERSISTENT without changing WHEN it fires:
  when a stale scenario is swept, its step-def sibling is removed too, and the
  removal is staged, committed, and pushed to the default branch so it actually
  leaves the repository — with the no-op case (nothing stale) guarded so no empty
  commit is produced.

  The behavioural contract pinned below:

    1. ORPHANED SIBLING REMOVED (Defect 2 / AC-a). Sweeping a stale issue removes
       BOTH `feature-{N}.feature` AND its `feature-{N}.steps.ts` step-def sibling
       from the worktree — not just the feature file.
    2. REMOVAL PERSISTED, TREE LEFT CLEAN (Defect 1 / AC-b). The sweep records the
       deletion of both files in a commit on the default branch, and afterwards
       the working tree carries NO uncommitted deletions — so the next cron cycle
       finds nothing to re-delete and the tree never accumulates.
    3. REMOVAL REACHES THE DEFAULT BRANCH (AC-b). The deletion commit is pushed so
       the origin remote's default branch no longer carries the swept scenario —
       the scenario is durably gone from the repository, not just the local tree.
    4. NO-OP GUARD & RETENTION WINDOW UNCHANGED (AC-c). A scenario still inside the
       14-day window is retained and the sweep produces NO commit; the fix must not
       widen the window, disable the sweep, or manufacture an empty commit when
       nothing is stale.
    5. NO ACCUMULATION ACROSS CYCLES (Defect 1, the live symptom). Running the
       sweep on successive cron cycles never leaves uncommitted deletions behind —
       the second cycle over an already-persisted removal makes no further commit
       and leaves the tree clean.
    6. TYPE-CHECK BACKSTOP (T22). The ADW TypeScript type-check still passes after
       the sweep gains its persistence and sibling-cleanup behaviour.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the sweep PRODUCES — worktree file
    state after the sweep, the deletion commit's name-status, the working tree's
    cleanliness, the origin remote's default-branch tree, or the type-checker's
    verdict (T22). These are all vocabulary registry surface #3 ("git artefacts:
    branches, commits, pushes, and worktree state produced by the system under
    test"). No step reads `perIssueScenarioSweep.ts`, `trigger_cron.ts`,
    `gitContext.ts`, or any framework source file as text, substring-matches its
    contents, or parses it as JSON/AST.

      • The seeded `feature-{N}.feature` and `feature-{N}.steps.ts` files are INPUT
        TEST FIXTURES committed into a throwaway temp git repo — git artefacts
        consumed by the system under test, the exact category the Rot-Detection
        Rubric permits (as feature-648 §1–§4 seed commits into a real temp repo and
        feature-583 seeds a fixture repo). They are NOT source files of this
        framework, so asserting that the sweep DELETES them is asserting the SUT's
        observable OUTPUT, not performing a prohibited "does a source file exist"
        check. The sweep's entire job is to delete scenario files; the presence or
        absence of the seeded fixture after the sweep is the behaviour under test.
      • §2 reads the deletion commit's name-status and the porcelain status of the
        worktree — commit and worktree artefacts, not source text.
      • §3 reads the tree of the origin remote's default branch (a real bare
        remote) — a push artefact, the same real-remote technique feature-648 uses.
      • §6 asserts the type-checker's verdict (registry T22).

  Scope notes:

    • The pinned behaviour is the OBSERVABLE outcome — are both files gone, is the
      removal committed and pushed, is the tree left clean, is a sub-window
      scenario retained — NOT the mechanism. Whether the fix removes via `git rm`
      or `fs.rmSync`-then-stage, whether it commits through `commitChanges` and
      pushes through `pushBranch` or some other GitContext seam, the exact commit
      message, and how it enumerates sibling step-def extensions are all
      SOURCE-STRUCTURE choices, deliberately NOT asserted — exactly as feature-648
      left its push-seam wiring unpinned.
    • These scenarios drive the real sweep IN-PROCESS over a real temp git repo
      whose `origin` is a real bare remote, so the commit and push artefacts are
      genuine. The repo's git-remote-mock no-ops `push`/`fetch`, so it cannot
      exercise a real deletion commit landing on a remote; routing this through the
      mock would make the persistence assertions vacuous. The registry git-mock
      phrases (G2 / T4 / T11) only assert branch-NAME agreement for that reason and
      are not reused here (same rationale feature-648 documented).
    • OUT OF SCOPE — flagged for separate human triage, NOT asserted here: whether
      the 14-day auto-delete should happen at all now that per-issue scenarios have
      human-curated promotion value (the direct-relocation promotion decision /
      issue #734). A 14-day auto-delete races against manual promotion. This fix
      only makes the sweep correct and persistent; it must not change the retention
      window or disable the sweep, and these scenarios pin exactly that (§4).
    • The Vitest unit coverage AC-c calls for (both-files-removed, removal-is-a-git-
      artefact, no-op-when-nothing-stale) is the implementer's, exactly as
      feature-648 split its unit tests from its end-to-end BDD scenarios. The BDD
      layer here pins the integration behaviour over a real repo and remote.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for a per-issue
    retention sweep, a stale/fresh linked-PR merge age, a swept feature/step-def
    pair, a deletion commit's name-status, an uncommitted-deletion-free worktree,
    or a scenario's absence from the origin remote's default branch (the registry's
    git surfaces G2 / T4 / T11 are git-MOCK bound and assert only branch-name
    agreement — see scope notes). The gap is surfaced to the maintainer in the
    agent Output:
      • `a per-issue feature and step-def sibling for issue {int} are committed on the repository's default branch`
      • `issue {int}'s linked PR was merged {int} days ago`
      • `the per-issue scenario sweep runs over the repository`
      • `the feature file for issue {int} is absent from the worktree`
      • `the step-def sibling for issue {int} is absent from the worktree`
      • `the feature file for issue {int} is retained in the worktree`
      • `the step-def sibling for issue {int} is retained in the worktree`
      • `the sweep commit on the default branch records the deletion of the feature file and step-def sibling for issue {int}`
      • `the worktree has no uncommitted deletions`
      • `the origin remote's default branch no longer carries the per-issue scenario for issue {int}`
      • `the sweep creates no new commit on the default branch`

    Step-definition note for the maintainer:
      • Build a real temp git repo (`git init`) whose `origin` is a real bare
        remote (`git init --bare`), with the default branch checked out — the same
        real-git temp-repo construction feature-648 / feature-583 use. Seed
        `features/per-issue/feature-{N}.feature` and
        `features/per-issue/step_definitions/feature-{N}.steps.ts`, commit them on
        the default branch, and push so the remote has the pre-sweep tree.
      • `the per-issue scenario sweep runs over the repository` drives the
        production `runPerIssueScenarioSweep` IN-PROCESS with the temp repo as its
        working directory and a FIXED run time, injecting the linked-PR merge date
        set by `issue {int}'s linked PR was merged {int} days ago` (stale ≥ 14 days,
        fresh < 14 days, measured against the fixed run time). Do NOT drive it
        through an orchestrator subprocess or the git-remote-mock (see scope notes).
      • The absent/retained phrases read the worktree file's presence after the
        sweep; the deletion-commit phrase reads `git show --name-status HEAD`
        (assert both paths listed as deleted); the no-uncommitted-deletions phrase
        reads `git status --porcelain` (assert empty); the origin-remote phrase
        reads the tree of the bare remote's default branch (assert the scenario
        path is absent); the no-new-commit phrase compares HEAD before and after
        the sweep on the default branch.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Orphaned step-def sibling is removed with the feature file (Defect 2) ───
  #
  # The headline of Defect 2: sweeping a stale issue must remove BOTH the feature
  # file and its step-def sibling. Under the bug the filename filter matches only
  # `feature-{N}.feature`, so the `feature-{N}.steps.ts` sibling is orphaned and
  # accumulates. (Contract §1 / AC-a.)

  @adw-735 @adw-qwfm4x-bug-per-issue-scenar
  Scenario: Sweeping a stale issue removes both the feature file and its step-def sibling
    Given a per-issue feature and step-def sibling for issue 665 are committed on the repository's default branch
    And issue 665's linked PR was merged 20 days ago
    When the per-issue scenario sweep runs over the repository
    Then the feature file for issue 665 is absent from the worktree
    And the step-def sibling for issue 665 is absent from the worktree

  # ── §2 Removal is persisted and the tree is left clean (Defect 1) ─────────────
  #
  # The core of Defect 1: the removal must be recorded in a commit on the default
  # branch, and the working tree must be left with NO uncommitted deletions — so
  # the next cron cycle sees a clean checkout instead of an ever-growing pile of
  # unstaged deletions. (Contract §2 / AC-b.)

  @adw-735 @adw-qwfm4x-bug-per-issue-scenar
  Scenario: The sweep commits the removal of both files and leaves no uncommitted deletions
    Given a per-issue feature and step-def sibling for issue 665 are committed on the repository's default branch
    And issue 665's linked PR was merged 20 days ago
    When the per-issue scenario sweep runs over the repository
    Then the sweep commit on the default branch records the deletion of the feature file and step-def sibling for issue 665
    And the worktree has no uncommitted deletions

  # ── §3 Removal reaches the default branch on the remote (AC-b) ────────────────
  #
  # "Persists to the default branch" means the deletion actually leaves the local
  # tree: the commit is pushed so the origin remote's default branch no longer
  # carries the swept scenario. (Contract §3 / AC-b.)

  @adw-735 @adw-qwfm4x-bug-per-issue-scenar
  Scenario: The removal is pushed so the origin remote's default branch no longer carries the scenario
    Given a per-issue feature and step-def sibling for issue 665 are committed on the repository's default branch
    And issue 665's linked PR was merged 20 days ago
    When the per-issue scenario sweep runs over the repository
    Then the origin remote's default branch no longer carries the per-issue scenario for issue 665

  # ── §4 No-op guard: sub-window scenario retained, no commit (AC-c) ────────────
  #
  # A scenario whose PR merged inside the 14-day window must be retained, and with
  # nothing stale the sweep must produce NO commit (no empty commit). This also
  # pins that the fix does not widen or disable the retention window — the
  # out-of-scope policy question is left untouched. (Contract §4 / AC-c.)

  @adw-735 @adw-qwfm4x-bug-per-issue-scenar
  Scenario: A scenario still inside the retention window is retained and produces no commit
    Given a per-issue feature and step-def sibling for issue 665 are committed on the repository's default branch
    And issue 665's linked PR was merged 13 days ago
    When the per-issue scenario sweep runs over the repository
    Then the feature file for issue 665 is retained in the worktree
    And the step-def sibling for issue 665 is retained in the worktree
    And the sweep creates no new commit on the default branch

  # ── §5 No accumulation across cron cycles (Defect 1, the live symptom) ────────
  #
  # The live defect was 67 uncommitted deletions accumulated because every cycle
  # re-deleted the same never-committed files. Once a removal is persisted, a
  # subsequent cycle finds nothing stale, makes no further commit, and leaves the
  # tree clean — the accumulation cannot happen. (Contract §5.)

  @adw-735 @adw-qwfm4x-bug-per-issue-scenar
  Scenario: A second cron cycle over an already-persisted removal leaves no uncommitted deletions
    Given a per-issue feature and step-def sibling for issue 665 are committed on the repository's default branch
    And issue 665's linked PR was merged 20 days ago
    And the per-issue scenario sweep runs over the repository
    When the per-issue scenario sweep runs over the repository
    Then the sweep creates no new commit on the default branch
    And the worktree has no uncommitted deletions

  # ── §6 Type-check backstop (T22) ──────────────────────────────────────────────

  @adw-735 @adw-qwfm4x-bug-per-issue-scenar
  Scenario: The ADW TypeScript type-check passes after the sweep persists and cleans up siblings
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
