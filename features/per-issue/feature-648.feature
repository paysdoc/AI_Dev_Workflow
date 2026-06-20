@adw-648 @adw-1n12vq-fix-adw-push-path-de
Feature: Recover a rewritten/rebased feature branch in the PR-creating push with --force-with-lease instead of deadlocking the pr_creating resume loop

  Issue #648 removes a deadlock in ADW's PR-creating push. `pushBranch`
  (`adws/vcs/commitOperations.ts`) pushes with a plain, non-forcing command —
  `git push -u origin "${branchName}"` — present since the initial commit
  (`5c4067c`). That is harmless under ADW's normal append-only model (a fresh
  per-issue branch only ever gains forward commits, so the push fast-forwards).
  But the moment a feature branch's history is REWRITTEN — a rebase to clear a
  stale base, a squash, or an amend — the local branch and its pushed remote
  counterpart diverge, and the plain push is rejected non-fast-forward.

  `executePRPhase` (`adws/phases/prPhase.ts`) calls `pushBranch` BEFORE it
  creates the PR. When that push throws, the `pr_created` stage never completes,
  so the workflow resumes from `pr_creating`, re-attempts the IDENTICAL plain
  push, is rejected again, and loops indefinitely — burning tokens (one #638
  cycle spent ~245K opus tokens) and never opening the PR. The live incident was
  issue #638, whose branch had to be rebased onto post-#639 `dev` (because
  #638/#639 edit the same `phase_timeout` recovery region and #639 merged
  first); the rebase rewrote history, ADW could never push it, and it was
  unblocked manually with `git push --force-with-lease`.

  The fix switches the PR-phase push to `--force-with-lease`. The lease only
  overwrites the remote when it still matches ADW's remote-tracking ref, so it
  recovers a branch ADW itself rewrote WITHOUT clobbering work pushed by anyone
  else: if the remote genuinely moved underneath ADW, the push degrades to a
  safe rejection rather than a force-overwrite. This is the SYMPTOM fix; the
  companion issue that serialises region-colliding slices removes the CAUSE (the
  forced rebase).

  The behavioural contract pinned below:

    1. REWRITTEN BRANCH RECOVERS (AC1). When ADW is the sole writer and rewrites
       its own already-pushed branch (rebase / squash / amend), the PR-creating
       push succeeds and the origin remote's branch tip advances to ADW's
       rewritten local tip — instead of being rejected and deadlocking.
    2. APPEND-ONLY UNCHANGED (AC2). A branch that only gained a forward
       (fast-forwardable) commit still pushes successfully, exactly as before —
       no behaviour change for the normal path.
    3. FIRST PUSH UNCHANGED. A branch that has never been pushed (no remote
       tracking ref yet) is still created on the remote at its local tip — the
       force-with-lease change does not break the common first-push case.
    4. GENUINE DIVERGENCE IS A SAFE, DISTINCT REJECTION (AC3). When the remote
       branch was advanced by another writer to a commit ADW never had, the push
       does NOT overwrite that commit; it is rejected as a distinct
       branch-divergence failure, reported separately from a retryable transient
       push error so the PR phase does not resume `pr_creating` into the same
       push forever.
    5. TYPE-CHECK BACKSTOP. The ADW TypeScript type-check still passes after the
       push path changes (T22).

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES — the branch
    tip the push writes to a REAL origin remote (a git ref, vocabulary registry
    surface #3, "git artefacts"), the pass/fail outcome the push operation
    raises, or the type-checker's verdict (T22). No step reads
    `adws/vcs/commitOperations.ts`, `adws/phases/prPhase.ts`, or any other source
    file as text, substring-matches its contents (e.g. asserting the string
    "--force-with-lease" appears), or parses it as JSON/AST. Asserting that the
    push COMMAND contains a flag would be a source/command-shape check; instead
    these scenarios assert the OBSERVABLE EFFECT of that flag — a rewritten
    branch lands on the remote, a concurrent writer's commit is preserved.

      • §1–§4 drive the real `pushBranch` IN-PROCESS over a real temp git repo
        whose `origin` is a real bare remote, then assert the remote's branch tip
        (`git rev-parse origin/<branch>` on the bare remote) and the push's
        success/rejection outcome — the same real-temp-git-repo technique
        feature-641 §3–§6 uses for branch-identity resolution and feature-583 for
        the fixture repo. The temp local repo, the bare remote, and their commits
        are INPUT/artefact test data — the category the Rot-Detection Rubric
        permits (git artefacts produced by / consumed by the system under test) —
        NOT source files of this repo.
      • §5 asserts the type-checker's verdict (registry T22).

  Scope notes:

    • The pinned behaviour is the OBSERVABLE outcome — does the push land on the
      remote, does the remote tip match ADW's rewritten tip, is a concurrent
      writer's commit preserved, is the failure distinct from a retryable one —
      NOT the mechanism. Whether the fix flags the existing `pushBranch` or adds
      a new helper, whether it fetches to refresh the remote-tracking ref then
      leases bare or pins `--force-with-lease=<branch>:<expected-sha>` to the
      pre-rewrite tip, and the exact error type / result discriminant it raises,
      are all SOURCE-STRUCTURE choices, deliberately NOT asserted — exactly as
      feature-641 left its fallback-seam wiring unpinned and feature-639 left its
      resume-policy module free. §4's no-clobber assertion is what rules OUT the
      one unsafe shape (a blind fetch-then-bare-force that overwrites a
      concurrent writer); any lease form that preserves the other writer's commit
      satisfies it.
    • These scenarios MUST run against the REAL git binary, driving `pushBranch`
      in-process. The repo's git-remote-mock (`test/mocks/git-remote-mock.ts`)
      no-ops `push`/`fetch` (it prints "Everything up-to-date" and exits 0), so
      it cannot exercise force-with-lease semantics, a non-fast-forward
      rejection, or branch divergence at all — routing this push through the mock
      would make every scenario vacuously pass. The registry's git-mock phrases
      (G2 / T4 / T11) only assert branch-NAME agreement for that reason, so they
      are not reused here.
    • The end-to-end consequence — the orchestrator does NOT enter an infinite
      `pr_creating` resume loop on a genuine lease failure — is the DOWNSTREAM
      effect of §4's distinct, non-retryable rejection. It is driven through the
      full orchestrator subprocess (registry W1 / W5 over the live phase), whose
      live driver is still PENDING the ISSUE-3-CUTOVER. §4 pins the CAUSE the
      non-loop depends on (the push surfaces a distinct branch-divergence failure
      rather than a generic retryable error) at the push-operation level, so this
      scenario runs NOW rather than waiting on the subprocess driver — the same
      level feature-641 §3 chose for the no-second-PR consequence.
    • The literal Vitest unit tests AC4 calls for ("unit/integration coverage for
      the rewritten-branch push path") are the implementer's, exactly as
      feature-641 split its pure-primitive unit tests from its end-to-end BDD
      scenarios. The BDD layer here pins the integration behaviour over a real
      remote; the unit layer pins the command internals.
    • The @regression maintenance sweep is SKIPPED for this issue:
      `.adw/scenarios.md` configures a `## Regression Scenario Directory`, so
      promotion is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry's git surfaces (G2 / T4 / T11)
    are bound to the git-MOCK and assert only branch-name agreement; they cannot
    express a real remote's branch tip, history divergence, a concurrent writer,
    or a no-clobber outcome. So the real-remote push behaviour introduces its
    own phrases. The gap is surfaced to the maintainer in the agent Output:
      • `a target repository with a feature branch {string} pushed to its origin remote`
      • `a target repository with an unpushed feature branch {string}`
      • `the local history of branch {string} is rewritten by a {string}`
      • `a forward commit is appended to branch {string}`
      • `another writer advances branch {string} on the origin remote to a commit ADW has never seen`
      • `ADW pushes branch {string} in the PR-creating step`
      • `the push to branch {string} succeeds`
      • `the origin remote tip of branch {string} matches ADW's local tip`
      • `the origin remote has a branch {string} at ADW's local tip`
      • `the push to branch {string} is rejected as a branch-divergence failure`
      • `the rejection is reported distinctly from a retryable transient push failure`
      • `the origin remote tip of branch {string} still matches the commit pushed by the other writer`

    Step-definition note for the maintainer:
      • §1–§4 build a real temp git repo (`git init`) whose `origin` is a real
        bare remote (`git init --bare`), commit on the feature branch, and
        `git push -u origin <branch>` to seed the remote-tracking ref — the same
        real-git temp-repo construction feature-641 / feature-583 use. They then
        drive the production `pushBranch` from `adws/vcs/commitOperations.ts`
        IN-PROCESS with the local repo as `cwd`, NOT through any orchestrator
        subprocess and NOT with the git-remote-mock on PATH (see scope notes).
        Capture whether `pushBranch` returns or throws to satisfy the
        succeeds / rejected phrases; read `git rev-parse <branch>` on the bare
        remote for the remote-tip phrases.
      • `the local history of branch {string} is rewritten by a {string}` takes a
        rewrite mode — `rebase`, `squash`, or `amend` — and realises each so the
        local tip is NO LONGER a descendant of the pushed tip: `amend` =
        `git commit --amend`; `squash` = two local commits combined via
        `git reset --soft HEAD~1 && git commit`; `rebase` = replay the branch
        commit onto an advanced base. All three diverge the branch, which the old
        plain push rejects non-fast-forward and the fixed push recovers.
      • `another writer advances branch {string} on the origin remote to a commit
        ADW has never seen` pushes an unrelated commit to the bare remote's
        branch from a SECOND clone, leaving ADW's local remote-tracking ref stale
        — the genuine concurrent-divergence the lease must refuse to clobber.
      • `the rejection is reported distinctly from a retryable transient push
        failure` maps to whatever discriminant the implementer exposes (a typed
        error, a result flag, a distinct message) that lets the PR phase / resume
        logic treat a lease failure as terminal rather than re-attempting the
        identical push — the cause behind the no-infinite-loop AC. Assert against
        that discriminant, not against source text.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Rewritten branch recovers — the core fix (AC1) ─────────────────────────
  #
  # ADW is the SOLE writer and rewrites its own already-pushed branch. Under the
  # old plain `git push -u`, local and remote have diverged, the push is rejected
  # non-fast-forward, `executePRPhase` throws before the PR is created, and the
  # workflow loops re-attempting the identical push. With `--force-with-lease`
  # the lease still matches ADW's own last push, so the push lands and the origin
  # tip advances to the rewritten local tip. The Examples cover all three rewrite
  # shapes the issue names. (Contract §1.)

  @adw-648 @adw-1n12vq-fix-adw-push-path-de
  Scenario Outline: A branch ADW rewrote by <rewrite> pushes successfully instead of deadlocking
    Given a target repository with a feature branch "bugfix-issue-648-fix-push" pushed to its origin remote
    And the local history of branch "bugfix-issue-648-fix-push" is rewritten by a "<rewrite>"
    When ADW pushes branch "bugfix-issue-648-fix-push" in the PR-creating step
    Then the push to branch "bugfix-issue-648-fix-push" succeeds
    And the origin remote tip of branch "bugfix-issue-648-fix-push" matches ADW's local tip

    Examples:
      | rewrite |
      | rebase  |
      | squash  |
      | amend   |

  # ── §2 Append-only branch is unchanged — no regression (AC2) ──────────────────
  #
  # The normal ADW model: the branch only gained a forward, fast-forwardable
  # commit. This pushed cleanly before the fix and must still push cleanly after
  # — the force-with-lease change must not perturb the common path. (Contract §2.)

  @adw-648 @adw-1n12vq-fix-adw-push-path-de
  Scenario: An append-only branch still pushes with no behaviour change
    Given a target repository with a feature branch "bugfix-issue-648-fix-push" pushed to its origin remote
    And a forward commit is appended to branch "bugfix-issue-648-fix-push"
    When ADW pushes branch "bugfix-issue-648-fix-push" in the PR-creating step
    Then the push to branch "bugfix-issue-648-fix-push" succeeds
    And the origin remote tip of branch "bugfix-issue-648-fix-push" matches ADW's local tip

  # ── §3 First push of a never-pushed branch is unchanged ───────────────────────
  #
  # A guard for the common case the force-with-lease change could regress: a
  # branch with no remote-tracking ref yet. The first push must still create the
  # branch on the remote at its local tip (an empty lease is satisfied because
  # the remote has nothing to overwrite). (Contract §3.)

  @adw-648 @adw-1n12vq-fix-adw-push-path-de
  Scenario: A branch that was never pushed is created on the remote at its local tip
    Given a target repository with an unpushed feature branch "bugfix-issue-648-fix-push"
    When ADW pushes branch "bugfix-issue-648-fix-push" in the PR-creating step
    Then the push to branch "bugfix-issue-648-fix-push" succeeds
    And the origin remote has a branch "bugfix-issue-648-fix-push" at ADW's local tip

  # ── §4 Genuine divergence is a safe, distinct rejection (AC3) ─────────────────
  #
  # The remote branch was advanced by ANOTHER writer to a commit ADW never had,
  # and ADW's local history was rewritten too. The lease must NOT be honoured:
  # the push must be rejected, the other writer's commit must remain the remote
  # tip (no clobber), and the failure must be reported distinctly from a
  # retryable transient error — so the PR phase surfaces a terminal divergence
  # instead of resuming `pr_creating` into the same push forever. This rules out
  # the one unsafe implementation (a blind fetch-then-bare-force). (Contract §4.)

  @adw-648 @adw-1n12vq-fix-adw-push-path-de
  Scenario: A push that would clobber a concurrent writer is rejected distinctly and preserves their commit
    Given a target repository with a feature branch "bugfix-issue-648-fix-push" pushed to its origin remote
    And another writer advances branch "bugfix-issue-648-fix-push" on the origin remote to a commit ADW has never seen
    And the local history of branch "bugfix-issue-648-fix-push" is rewritten by a "amend"
    When ADW pushes branch "bugfix-issue-648-fix-push" in the PR-creating step
    Then the push to branch "bugfix-issue-648-fix-push" is rejected as a branch-divergence failure
    And the origin remote tip of branch "bugfix-issue-648-fix-push" still matches the commit pushed by the other writer
    And the rejection is reported distinctly from a retryable transient push failure

  # ── §5 Type-check backstop (T22) ──────────────────────────────────────────────

  @adw-648 @adw-1n12vq-fix-adw-push-path-de
  Scenario: The ADW TypeScript type-check passes after the force-with-lease push path lands
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
