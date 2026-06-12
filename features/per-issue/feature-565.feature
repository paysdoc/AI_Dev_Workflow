@adw-565 @adw-tcewff-cron-gh-token-bleed
Feature: Pause-queue resume authenticates against the workflow's target repo, never the cron host's own checkout

  Issue #565 closes a cross-repo GitHub-App-token bleed in the pause-queue resume
  path. A single cron process polls one target repo (its `--target-repo`), but the
  framework authenticates via a **process-global `process.env.GH_TOKEN`** plus a
  module-level `activeRepo` in `adws/github/githubAppAuth.ts`, shared across every
  repo the process touches. When a rate-limited workflow resumes, the resume path
  pins that global token to the **wrong** repo and the poller goes blind to its
  real target until the process is restarted.

  Root cause:

    `resumeWorkflow` (`adws/triggers/pauseQueueScanner.ts`) resolves the repo with
    a bare `getRepoInfo()` — no cwd — which reads `git remote get-url origin` in
    the cron process's own checkout (the framework repo, `paysdoc/AI_Dev_Workflow`),
    not the paused workflow's target repo. It then calls
    `activateGitHubAppAuth(owner, repo)` with that wrong repo, pinning the global
    `GH_TOKEN`/`activeRepo` to the framework repo. The same wrong identity is handed
    to the resumed-comment `createRepoContext` (`repoId` = framework repo) while its
    `cwd` is the target worktree, so `validateGitRemote` throws
    `Remote owner "<target>" !== declared owner "<framework>"` and the comment fails.
    The periodic refresh only refreshes the *active* repo, so it never self-heals;
    every subsequent `gh --repo <target>` returns "Could not resolve to a Repository"
    and the poller logs `POLL: 0 open` on every tick.

  Confirmed incident (2026-06-11): a cron polling `vestmatic/vestmatic` resumed
  paused issue #143; auth bled to `paysdoc/AI_Dev_Workflow`; PR #150 (gate open,
  mergeable) was never auto-merged and the whole repo went invisible until restart.

  The fix (issue → Proposed fix):

    1. The resume path passes the **target** repo explicitly to
       `activateGitHubAppAuth` / `ensureAppAuthForRepo`, never relying on the
       local-git-remote fallback against the cron host's own checkout. Auth and the
       resumed-comment repo identity both resolve to the target repo, so the comment
       lands on the target issue with no cross-repo owner-mismatch failure.
    2. The cron poll batch re-asserts `ensureAppAuthForRepo(targetOwner, targetRepo)`
       at the top of each tick, so a stray activation for another repo cannot
       persist across ticks and blind the poller.

  Observability / rot-prevention note:

    Every assertion below targets a runtime artefact, never the text of a source
    file. No step reads `pauseQueueScanner.ts`, `githubAppAuth.ts`, `repoContext.ts`,
    `trigger_cron.ts`, or any module as text, substring-matches its contents, or
    parses it as JSON/AST.

      • §1 observes which repo the resume *authenticates against* as a recorded call
        on the GitHub-App-auth seam — the same recorded-invocation category as the
        git-mock recording git invocations (vocabulary Observability Surface 2/“Mock
        query”), not a source-file read.
      • §2 asserts the resumed comment recorded by the mock GitHub API (recorded
        requests, behind T2/T14) and the absence of the cross-repo owner-mismatch
        failure — both produced outputs.
      • §3 asserts the auth re-assertion recorded at the top of a poll batch and the
        open-issue list the poller fetches for its target repo (recorded requests).
      • §4 asserts the type-checker's verdict.

    The two-repo world is established as real harness state: the cron's target-repo
    context versus the host checkout the cwd fallback would resolve to, plus a paused
    workflow whose worktree git remote points at the target repo — a git artefact,
    a permitted target — and the system's response is the observable behaviour pinned.

  Vocabulary note:

    Reused registered phrases from `features/regression/vocabulary.md`:
    `the ADW codebase is checked out` (background), `the ADW TypeScript type-check
    passes` (backstop), `an issue {int} exists in the mock issue tracker` (G4), and
    `the mock GitHub API is configured to accept issue comments` (G1). The recorded-
    comment assertions extend T2/T14 with a target-repository qualifier. The registry
    has no phrase for: a cron polling a target repo distinct from its host checkout,
    a workflow paused in the rate-limit queue for a target repo, the rate-limit probe
    reporting clear, the resume scan running, which repo the resume authenticates
    against, a stray GitHub-App activation pinned to another repo, or a poll batch
    re-asserting auth before fetching issues. Novel phrasing is introduced for those
    and the gap is surfaced to the maintainer in the agent Output.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Resume authenticates against the workflow's target repo (root fix #1) ─
  #
  # The resume path must resolve the paused workflow's target repo and authenticate
  # for it — never the cron host's own checkout that the bare-getRepoInfo() / local
  # git-remote fallback would resolve to.

  @adw-565 @adw-tcewff-cron-gh-token-bleed
  Scenario: The resume authenticates against the paused workflow's target repository
    Given the cron is polling the target repository "vestmatic/vestmatic" from a host checked out at "paysdoc/AI_Dev_Workflow"
    And a workflow for issue 143 is paused in the rate-limit queue for the target repository "vestmatic/vestmatic"
    And the rate-limit probe reports the limit has cleared
    When the pause-queue resume scan runs
    Then the resume authenticates against the target repository "vestmatic/vestmatic"

  @adw-565 @adw-tcewff-cron-gh-token-bleed
  Scenario: The resume never falls back to the cron host's own checkout for authentication
    Given the cron is polling the target repository "vestmatic/vestmatic" from a host checked out at "paysdoc/AI_Dev_Workflow"
    And a workflow for issue 143 is paused in the rate-limit queue for the target repository "vestmatic/vestmatic"
    And the rate-limit probe reports the limit has cleared
    When the pause-queue resume scan runs
    Then the resume does not authenticate against the cron host's own repository "paysdoc/AI_Dev_Workflow"

  # ── §2 Resumed comment reaches the target repo, no cross-repo owner mismatch ──
  #
  # With auth and the resumed-comment repo identity both resolved to the target
  # repo, the comment lands on the target issue and the tell-tale
  # `Remote owner X !== declared owner Y` failure never fires. Token bleed to the
  # cron host's own repo is structurally absent.

  @adw-565 @adw-tcewff-cron-gh-token-bleed
  Scenario: The resumed comment is recorded on the target repository's issue without a cross-repo owner-mismatch failure
    Given the cron is polling the target repository "vestmatic/vestmatic" from a host checked out at "paysdoc/AI_Dev_Workflow"
    And an issue 143 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And a workflow for issue 143 is paused in the rate-limit queue for the target repository "vestmatic/vestmatic", with its worktree remote pointing at "vestmatic/vestmatic"
    And the rate-limit probe reports the limit has cleared
    When the pause-queue resume scan runs
    Then the resumed comment is recorded on issue 143 in the target repository "vestmatic/vestmatic"
    And the resume completes without a remote-owner-mismatch failure between the target worktree and the declared repository

  @adw-565 @adw-tcewff-cron-gh-token-bleed
  Scenario: No resumed comment bleeds to the cron host's own repository
    Given the cron is polling the target repository "vestmatic/vestmatic" from a host checked out at "paysdoc/AI_Dev_Workflow"
    And an issue 143 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And a workflow for issue 143 is paused in the rate-limit queue for the target repository "vestmatic/vestmatic", with its worktree remote pointing at "vestmatic/vestmatic"
    And the rate-limit probe reports the limit has cleared
    When the pause-queue resume scan runs
    Then the mock harness recorded zero comment posts on issue 143 in the cron host's own repository "paysdoc/AI_Dev_Workflow"

  # ── §3 Poll batch re-asserts target-repo auth; poller not blinded (root fix #2) ─
  #
  # Even if a stray activation pinned the global token to another repo, the next
  # poll batch re-asserts auth for the cron's target repo before fetching issues —
  # so the poller keeps seeing its target repo's open issues across ticks instead of
  # logging POLL: 0 open until the process is restarted.

  @adw-565 @adw-tcewff-cron-gh-token-bleed
  Scenario: The cron poll batch re-asserts GitHub App authentication for its target repository before fetching issues
    Given the cron is polling the target repository "vestmatic/vestmatic" from a host checked out at "paysdoc/AI_Dev_Workflow"
    And GitHub App authentication has been pinned to the repository "paysdoc/AI_Dev_Workflow" by a stray activation
    When the cron poll batch runs
    Then GitHub App authentication is re-asserted for the target repository "vestmatic/vestmatic" before any issues are fetched

  @adw-565 @adw-tcewff-cron-gh-token-bleed
  Scenario: A stray activation for another repository does not blind the poller on the next tick
    Given the cron is polling the target repository "vestmatic/vestmatic" from a host checked out at "paysdoc/AI_Dev_Workflow"
    And an issue 143 exists in the mock issue tracker
    And GitHub App authentication has been pinned to the repository "paysdoc/AI_Dev_Workflow" by a stray activation
    When the cron poll batch runs
    Then the poll batch fetches open issues from the target repository "vestmatic/vestmatic"
    And the target repository's open issue 143 is visible to the poller

  # ── §4 Type-check backstop ───────────────────────────────────────────────────

  @adw-565 @adw-tcewff-cron-gh-token-bleed
  Scenario: TypeScript type-check passes after scoping pause-queue resume auth to the target repo
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
