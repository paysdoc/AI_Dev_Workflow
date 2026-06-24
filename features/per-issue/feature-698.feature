@adw-698 @adw-t0asur-gitcontext-migrate-u
Feature: GitContext upgradeClaim migration — the distributed-lock git ops (fetch/worktree/commit/push/cleanup) route through the per-command-auth chokepoint, the winner/loser election semantics are preserved, and the guard no longer exempts upgradeClaim

  Issue #698 (parent PRD `specs/prd/git-context-repo-authority.md`, user stories 5
  and 17) migrates `adws/core/upgradeClaim.ts` — the distributed upgrade-claim
  primitive — off raw `execSync` git shell-outs and onto `GitContext`.

  `upgradeClaim` is the coordination primitive that elects a single winner among
  concurrent, single-host-uncoordinated orchestrators by racing a non-force push
  into the remote branch namespace. Its `defaultPushClaimBranch` currently shells
  out directly:

    • `git fetch origin <defaultBranch>`              (base repo)
    • `git worktree add --detach <tmp> origin/<def>`  (base repo)   ← detached, no local branch
    • `git commit --allow-empty -m "... [<nonce>]"`   (temp worktree)
    • `git push origin HEAD:refs/heads/<claimBranch>` (temp worktree) ← NO --force: the atomic gate
    • `git worktree remove --force <tmp>`             (base repo, in `finally`)

  After this migration each of those operations runs through new `GitContext`
  methods that route via the private `#run()` chokepoint — inheriting per-command
  token injection, git-identity injection, and an explicit `cwd` — and the claim
  fetch reuses the `fetchRemote` method already added by #696. `upgradeClaim.ts`
  is removed from the `checkGitGhGuard` `ALLOWLIST`.

  Scope boundary with #539:

    Issue #539 already pins the *election decision* — push-accepted ⇒ `{ won: true }`,
    push-rejected ⇒ `{ won: false, existingIssueNumber, existingBranch }`, and
    exactly-one-winner under a same-hash race — and that decision logic is UNCHANGED
    by this migration. This file does NOT re-prove #539's orchestration decision;
    it pins what the migration itself changes: that the lock-critical git operations
    now flow through the GitContext chokepoint, and that the load-bearing command
    shapes the winner/loser election depends on (a NON-force claim push, an
    allow-empty per-attempt-unique-nonce commit, a DETACHED worktree that never
    touches the local claim-branch namespace, and a best-effort force cleanup) are
    preserved byte-for-byte through the migration. #539 stays green and untagged.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime, never
    the text of a source file:

      • the commands the migrated primitive EMITS to the spawn boundary, captured by
        the recording runner (the same recorded-invocation channel as the rest of the
        GitContext epic) — their cwd, child environment, and argument shape;
      • the value the migrated claim push RETURNS (won / lost) and the error it
        propagates on a genuine (non-rejection) failure — produced outputs;
      • the git/gh guard's runtime scan result and process exit status — an artefact,
        not the ALLOWLIST source array.

    No step reads `upgradeClaim.ts` (or any source file) as text, substring-matches
    its contents, or parses it as JSON/AST. "Removed from ALLOWLIST" and "no raw git"
    are proven the only behaviourally-honest way: a now-scanned (non-allowlisted)
    `upgradeClaim.ts` over which the guard reports zero violations can only be true
    when both the de-allowlisting and the no-raw-git migration have landed together.

  Vocabulary note:

    §1 reuses the registered GitContext recording-runner phrases (context construction,
    "captured by a recording runner", the token / git-author / supplied-worktree-path /
    base-path-cwd, and parent-env-unchanged assertions). §3 reuses the git/gh guard
    phrases, and §4 reuses the T22 type-check phrase. The claim-op dispatcher and the
    §2 lock-contract phrases (non-force claim push, allow-empty unique-nonce commit,
    detached-worktree / no-local-claim-branch, force cleanup, won/lost/propagated push
    outcome) have no registered phrase — the registry is scoped to orchestrator/phase/
    mock-query behaviours. Per the vocabulary-preference rule, novel phrasing is
    introduced here and the gap is surfaced to the maintainer in the agent Output.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ §1  THE NEW CLAIM GIT-OPS ROUTE THROUGH #run (story 17) ════════
  #
  # Each lock op now flows through a GitContext method backed by the #run chokepoint,
  # so it carries the context token + git identity and spawns with the EXACT cwd it is
  # handed (base repo for fetch/worktree-add/worktree-remove; the temp worktree for
  # commit/push) — never the ambient process cwd, the root of the wrong-base-repo class.

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario Outline: Each migrated claim git-op supplies the context token, git identity, and the supplied cwd to its child command
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "<op>" claim-op operation runs through the context for worktree path "/srv/adw/repos/acme/webapp/.worktrees/adw-claim-tmp"
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the supplied worktree path "/srv/adw/repos/acme/webapp/.worktrees/adw-claim-tmp"

    Examples:
      | op                    |
      | add-detached-worktree |
      | commit-empty-claim    |
      | push-claim-ref        |
      | remove-claim-worktree |

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: A migrated claim git-op leaves the parent process environment byte-for-byte unchanged
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "push-claim-ref" claim-op operation runs through the context for worktree path "/srv/adw/repos/acme/webapp/.worktrees/adw-claim-tmp"
    Then the parent process environment matches the baseline snapshot

  # ═══════════════ §2  THE LOCK CONTRACT SURVIVES THE MIGRATION (HITL — stories 5 & 17) ══
  #
  # The HITL review surface: the migrated primitive must elect winners and losers exactly
  # as before. These scenarios drive the REAL migrated claim push through a recording
  # GitContext and pin the four command shapes the election correctness rests on, plus the
  # push-result → won/lost mapping, without re-proving #539's orchestration decision.

  # ── §2a  push accepted ⇒ this orchestrator won the claim ─────────────────────────

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: When the remote accepts the claim push the migrated primitive reports the upgrade was won
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the recording runner is configured to accept the claim push
    When the migrated upgrade-claim push runs through the context for claim hash "deadbeef"
    Then the migrated claim push reports the upgrade claim was won

  # ── §2b  push rejected (non-fast-forward) ⇒ lost, not a crash ─────────────────────

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: When the remote rejects the claim push as non-fast-forward the migrated primitive reports the upgrade was lost rather than crashing
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the recording runner is configured to reject the claim push as non-fast-forward
    When the migrated upgrade-claim push runs through the context for claim hash "deadbeef"
    Then the migrated claim push reports the upgrade claim was lost

  # ── §2c  a genuine (non-rejection) push failure must NOT be mis-read as a lost claim ─

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: A genuine claim-push failure propagates as an error instead of being mistaken for a lost claim
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the recording runner is configured to fail the claim push with a non-rejection git error
    When the migrated upgrade-claim push runs through the context for claim hash "deadbeef"
    Then the migrated claim push propagates the git failure as an error

  # ── §2d  the atomic gate: the claim push is NON-force ─────────────────────────────
  #
  # The single most important lock invariant. A force push would let a loser clobber the
  # winner's claim, collapsing the election. The migration must keep the push non-force.

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: The migrated claim push publishes the claim branch ref WITHOUT a force flag
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the recording runner is configured to accept the claim push
    When the migrated upgrade-claim push runs through the context for claim hash "deadbeef"
    Then the recorded claim push publishes the claim branch ref for hash "deadbeef"
    And the recorded claim push carries no force flag

  # ── §2e  the claim commit is allow-empty and per-attempt unique (the nonce) ───────
  #
  # Without a unique nonce, two orchestrators with identical git identity in the same
  # wall-clock second produce the SAME commit SHA; the second push is "everything
  # up-to-date" (not rejected) and BOTH believe they won. The nonce forces the second
  # push to be a true non-fast-forward rejection — exactly one winner.

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: The migrated claim commit is an allow-empty commit carrying the upgrade hash
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the recording runner is configured to accept the claim push
    When the migrated upgrade-claim push runs through the context for claim hash "deadbeef"
    Then the recorded claim commit is an allow-empty commit
    And the recorded claim commit message contains the upgrade hash "deadbeef"

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: Two claim attempts for the same hash emit distinct claim commit messages so the second push is a true rejection
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the recording runner is configured to accept the claim push
    When the migrated upgrade-claim push runs twice through the context for claim hash "deadbeef"
    Then the two recorded claim commit messages differ

  # ── §2f  Bug-B regression: detached worktree, never a local claim branch ──────────
  #
  # The claim adds a DETACHED worktree at origin/<default> and pushes HEAD to the remote
  # ref, deliberately never creating a local branch named after the claim. A named local
  # branch from a prior attempt would otherwise make the next run crash with "branch
  # already exists" — a hard throw that escapes the push try/catch and bypasses the loser
  # path. The migration must keep the worktree detached and the local claim namespace untouched.

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: The migrated claim adds a detached worktree and never creates a local branch in the claim namespace
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the recording runner is configured to accept the claim push
    When the migrated upgrade-claim push runs through the context for claim hash "deadbeef"
    Then the recorded commands add the claim worktree in detached mode
    And the recorded commands never create a local branch named after the claim for hash "deadbeef"

  # ── §2g  cleanup survives the loser path (the finally block) ──────────────────────

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: The temporary claim worktree is force-removed even when the claim push is rejected
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And the recording runner is configured to reject the claim push as non-fast-forward
    When the migrated upgrade-claim push runs through the context for claim hash "deadbeef"
    Then the recorded commands force-remove the temporary claim worktree

  # ═══════════════ §3  upgradeClaim DE-ALLOWLISTED AND GUARD-CLEAN (story 5) ════════
  #
  # With upgradeClaim.ts no longer on the ALLOWLIST, the guard now scans it. A zero-violation
  # scan can only hold once every raw git shell-out has been routed through GitContext — so
  # this single behavioural check proves both "removed from ALLOWLIST" and "no raw git".

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: The git/gh guard scans the de-allowlisted upgradeClaim primitive and finds no direct git/gh shell-out
    Given the ADW codebase is checked out
    When the git/gh guard scans the file "adws/core/upgradeClaim.ts"
    Then the git/gh guard scanned that file
    And the git/gh guard reports no violation in that file

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: The git/gh guard passes across the whole repository after upgradeClaim is de-allowlisted
    Given the ADW codebase is checked out
    When the git/gh guard is run across the repository
    Then the git/gh guard reports no violations

  # ═══════════════ §4  TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════

  @adw-698 @adw-t0asur-gitcontext-migrate-u
  Scenario: The ADW TypeScript type-check passes with the migrated upgrade-claim surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
