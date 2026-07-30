@adw-663 @adw-d31wqy-migrate-gh-issue-pr
Feature: GitContext gh-operation migration — issue/PR/comment/label/board ops authenticate per-command, never through the process-global token

  Issue #663 (parent PRD `specs/prd/git-context-repo-authority.md`, see
  **Operation surface** and **Auth model**) is the call-site MIGRATION slice of
  the repo-context authority. Two slices precede it:

    • #658 shipped the `GitContext` deep module — mandatory identity, the
      one-constructor base-path decision, `worktreePathFor(branch)`, and the
      `commandEnv()` overlay BUILDER carrying the token + git author/committer.
    • #659 routed ONE representative read op (default-branch) through the context
      to prove the spawn path end to end: a single operation actually launches its
      `gh` command with cwd = base path and a child env carrying the token, while
      the parent process global is never mutated.

  #659 deliberately left CALL-SITE MIGRATION out of scope. This slice does it.
  It routes the full GitHub-operation surface through `GitContext` so the target
  repo is never ambiguous: issue read/comment, PR read/create/merge/review, label,
  and project-board operations (today scattered across `github/*` and
  `providers/github/*`) all become context methods, with the existing modules
  reduced to thin adapters. With every call site migrated, the process-global
  token mutation and the module-global "currently-authed repo" gate
  (`github/githubAppAuth.ts` `process.env.GH_TOKEN = ...`, `let activeRepo`) are
  removed from the hot path, so concurrent contexts are isolated by construction.

  Why this slice exists — the defect it forecloses:

    Today each `gh` operation authenticates against whatever repo last wrote the
    process-global `GH_TOKEN`, gated by a module-global `activeRepo`. A long-lived
    multi-repo process (the webhook server; the project-board manager — whose own
    source comments admit board ops "must run sequential … concurrent instances in
    the same process would race on process.env.GH_TOKEN") overwrites that global
    mid-flight, so an in-flight `gh` call for repo A authenticates with repo B's
    token and intermittently reports "could not resolve to a repository." History
    records ~repeated episodes of exactly this token-bleed shape.

    After migration the token rides ON the context and is injected PER COMMAND into
    each spawned child's environment. There is no shared process-global to
    overwrite, so two contexts in one process — even with interleaved async work,
    even when one of them is a project-board op that previously hot-swapped the
    global — cannot clobber each other's auth. The cross-contamination path is
    structurally gone.

  Contract pinned here (the observable behaviour, not the field shape):

    • full surface migrated   → every migrated gh op (issue read/comment, PR
                                read/create/merge/review, label, project-board)
                                spawns its command with cwd = the context base path
                                and a child env carrying the per-command auth token
                                (AC1, AC2; story 18).
    • per-command auth        → a migrated op's auth token lives in the spawned
                                child's environment, not in a process-global the op
                                reads or writes (AC2).
    • parent global never set  → running ANY migrated op — including the
                                project-board and PR-review ops that legacy code
                                hot-swapped `GH_TOKEN` for — leaves the parent
                                process environment byte-for-byte unchanged; the
                                `activeRepo`/global-mutation hot path is gone (AC3).
    • no cross-repo bleed     → an op for repo A neither reads nor overwrites a
                                pre-existing parent token for repo B; interleaved
                                ops across two repo contexts each carry their own
                                token — the precise "could not resolve to a
                                repository" case (AC5; stories 2, 7).
    • two-context isolation   → two contexts for two repos run their migrated ops
                                with their OWN token + cwd; neither op's child env
                                carries the other's token (AC5; stories 2, 7).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never
    a source file. No step reads `githubAppAuth.ts`, `issueApi.ts`, `prApi.ts`,
    `labelManager.ts`, `projectBoardApi.ts`, the providers layer, or the GitContext
    package as text, substring-matches their contents, or parses them as JSON/AST.
    In particular, the REMOVAL of `activeRepo` and the `process.env.GH_TOKEN`
    hot-path mutation (AC3) is NOT asserted by grepping the source — it is proven
    only through its OBSERVABLE CONSEQUENCE: running a migrated op never mutates the
    parent environment (§2), and interleaved multi-repo ops never share or clobber
    a token (§3).

      • The PRD's Testing Decisions name the observable explicitly: "assert
        external, observable behaviour — THE CWD AND ENVIRONMENT A CONTEXT ACTUALLY
        RUNS COMMANDS WITH … not internal call structure." Each migrated op is run
        with a RECORDING RUNNER injected as the context's command boundary (a fake
        spawn, the same recorder category as the registered `git-mock`/`mock server`
        collaborators in `vocabulary.md`); the steps assert the RECORDED `cwd` and
        the RECORDED child `env` the context handed that runner. The recorded
        `(cwd, env)` is a runtime artefact — the command's actual launch
        parameters — not a source property.
      • The "parent env unchanged" steps read the LIVE `process.env` before and
        after an operation. `process.env` is live runtime state, the canonical
        observable for "was the global mutated"; comparing it across an operation is
        the artefact category the Rot-Detection Rubric permits, NOT a source read.
      • §5 asserts the type-checker's verdict (registry T22).

    The owners/repos, tokens, authors, and friendly op names in the steps are INPUT
    test data; the recorded `cwd`/`env`, the live `process.env`, and the type-check
    exit code are the system's OUTPUTS — exactly the artefact category the rubric
    permits. The recording runner means no real `gh` is spawned and no network is
    touched, so the scenarios are hermetic.

  Scope notes:

    • This slice proves the OPERATION surface routes its spawns through per-command
      auth/env. #659 already proved the single representative read op end to end and
      the env-overlay builder's purity is covered by #658's unit tests; these
      scenarios do not restate those — they prove the WHOLE migrated surface
      (issue/PR/comment/label/board write AND read ops) goes through the context.
    • The exact context method names, the adapter shapes (whether `commentOnIssue`
      becomes `ctx.commentOnIssue(...)` or a thin wrapper taking a context), the
      auth env-var name, and the runner's injection seam are an implementer's choice
      and are NOT pinned (consistent with #658/#659's "pin the decision, not the
      shape" stance). The friendly op names in the steps (e.g. `"issue-comment"`,
      `"board-move"`) map to context methods inside the step definitions.
    • The PR-review (approve) and project-board ops legitimately need a different
      identity than the context's primary app token (GitHub forbids approving one's
      own bot PR; app tokens lack Projects V2 access). This slice does NOT pin WHICH
      token those two ops carry — only that they (a) run under the base-path cwd
      with a per-command auth env and (b) leave the parent global unmutated (§2).
      Whether the implementer routes their alternate identity through a per-command
      env overlay or a net-zero save/restore, the observable "parent unchanged"
      holds either way; the migration's guarantee is the absence of a LEAKED global,
      not the elimination of the alternate identity.
    • Auth ACQUISITION is unchanged: token minting/refresh (`getInstallationToken`,
      the JWT exchange) is untouched; only token APPLICATION (per-command vs
      process-global) changes (AC4). No scenario here drives the minting path.
    • Existing `github/__tests__/*` behaviour is preserved (AC4); this feature adds
      coverage, it does not relax the existing unit suites.
    • The CI/lint guard banning context-free `git`/`gh` (PRD Enforcement) is
      ARCHITECTURAL and explicitly NOT unit-tested; no scenario asserts it.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`
      T22 `the ADW TypeScript type-check passes`

    Phrases reused verbatim from feature-659 (established in the per-issue corpus,
    not yet in the registry) so the step definitions share #659's recording-runner
    and parent-env machinery:
      • `a GitContext for owner {string} repo {string} with auth token {string} and git author {string}`
      • `a GitContext for owner {string} repo {string} with auth token {string}`
      • `the context's git and gh commands are captured by a recording runner`
      • `each context's git and gh commands are captured by a recording runner`
      • `the parent process environment has auth token {string}`
      • `a baseline snapshot of the parent process environment is captured`
      • `the captured command ran with auth token {string} in its child environment`
      • `the captured command ran with git author {string} in its child environment`
      • `the captured command ran with cwd equal to the context base path`
      • `the parent process environment still has auth token {string}`
      • `the parent process environment matches the baseline snapshot`
      • `the {string} command ran with auth token {string} in its child environment`
      • `the {string} command ran with cwd equal to the {string} context base path`
      • `the {string} command's child environment does not carry auth token {string}`

    Novel phrasing introduced here — the registry (and #659) only have a
    `read operation` runner phrase; this slice generalises it to the full gh-op
    surface. Surfaced to the maintainer in the agent Output:
      • `the {string} gh operation runs through the context`
      • `the {string} gh operation runs through the {string} context`

    Step-definition note for the maintainer:
      • All steps phase-import `GitContext` from `adws/gitContext/index.ts` and
        construct it from a full injected identity (the `makeFullOptions(...)` shape
        used by `feature-659.steps.ts`: `{ owner, repo, selfHost:false, token,
        gitIdentity, frameworkRepoRoot, targetReposDir }`), overriding
        `owner`/`repo`/`token` and `gitIdentity.author*` per the step args, with a
        fixed sentinel target-repos root so each base path is `join(root, owner,
        repo)`. Reuse `feature-659.steps.ts` wholesale for the construction,
        recording-runner, parent-env, and assertion steps.
      • `the {string} gh operation runs through the context` extends #659's
        `runOp(ctx, opName)` map to the migrated surface:
          "issue-view"    → the issue read method
          "issue-comment" → the issue-comment method
          "issue-create"  → the create-issue method
          "label-apply"   → the add/apply-label method
          "pr-view"       → the PR read method
          "pr-comment"    → the PR-comment method
          "pr-create"     → the create-PR method
          "pr-merge"      → the merge-PR method
          "pr-review"     → the approve/review-PR method
          "board-move"    → the project-board move-status method
        Each runs via the injected recording runner; store the recorded
        invocation(s) on the scenario world (the keyed map for two-context steps).
      • THE RECORDING RUNNER RETURNS CANNED, PARSEABLE OUTPUT per command so each op
        completes its spawn(s) (e.g. minimal valid JSON for `--json`/`graphql`
        calls). Some ops (board-move) launch SEVERAL commands; assert against the
        recorded invocation(s) — for the token/cwd assertions inspect the recorded
        call, for "carries auth token" the last recorded call is sufficient. No real
        subprocess and no network is touched.
      • The token/git-author/cwd assertions are value-based comparisons against the
        recorded child `env` and `cwd` (`recorded.env.GH_TOKEN === token`,
        `recorded.cwd === ctx.basePath`) — never a source read — exactly as in
        `feature-659.steps.ts`.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════ FULL SURFACE MIGRATED — PER-COMMAND AUTH (AC1, AC2; story 18) ═
  #
  # Surface: each migrated gh op actually spawns its command. Its observable output
  # is the command's launch parameters — the cwd and the child environment the
  # context handed the runner. #659 proved this for ONE read op; here it is the
  # whole issue/PR/comment/label/board surface.

  # ── §1a A representative WRITE op carries token + git identity + base-path cwd ──
  #
  # The headline for the write surface (#659 proved only a READ op). An issue
  # comment routed through the context spawns its command with the context's token
  # AND git author/committer in the child env, with cwd = the context base path.

  @adw-663 @adw-d31wqy-migrate-gh-issue-pr
  Scenario: A migrated issue-comment op supplies the context token, git identity, and base-path cwd to its child command
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "issue-comment" gh operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with git author "Acme Bot <bot@acme.dev>" in its child environment
    And the captured command ran with cwd equal to the framework repository root

  # ── §1b Every migrated read/write op carries the context token + base-path cwd ──
  #
  # Breadth proof: each op across the issue/PR/comment/label/create/merge surface
  # routes through the per-command spawn path. cwd = base path is itself a strong
  # migration signal — the legacy `execWithRetry` ran with the ambient process cwd;
  # a migrated op runs under the context base path. (PR-review and board-move carry
  # an alternate identity by design and are covered for non-mutation in §2.)

  @adw-663 @adw-d31wqy-migrate-gh-issue-pr
  Scenario Outline: Each migrated gh operation runs with the context token and the base-path cwd
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    When the "<op>" gh operation runs through the context
    Then the captured command ran with auth token "token-acme" in its child environment
    And the captured command ran with cwd equal to the framework repository root

    Examples:
      | op           |
      | issue-view   |
      | issue-create |
      | label-apply  |
      | pr-view      |
      | pr-comment   |
      | pr-create    |
      | pr-merge     |

  # ═══════════════ PARENT GLOBAL NEVER MUTATED (AC3) ═══════════════════════════
  #
  # Surface: the live `process.env`. AC3 removes `activeRepo` and the
  # `process.env.GH_TOKEN` hot-path mutation. Observable consequence: running ANY
  # migrated op leaves the parent environment unchanged — INCLUDING the PR-review
  # and project-board ops that the legacy code hot-swapped the global for.

  # ── §2 No migrated op mutates the parent environment ──────────────────────────

  @adw-663 @adw-d31wqy-migrate-gh-issue-pr
  Scenario Outline: A migrated gh operation leaves the parent process environment byte-for-byte unchanged
    Given a GitContext for owner "acme" repo "webapp" with auth token "token-acme" and git author "Acme Bot <bot@acme.dev>"
    And the context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "<op>" gh operation runs through the context
    Then the parent process environment matches the baseline snapshot

    Examples:
      | op            |
      | issue-view    |
      | issue-comment |
      | issue-create  |
      | label-apply   |
      | pr-view       |
      | pr-comment    |
      | pr-create     |
      | pr-merge      |
      | pr-review     |
      | board-move    |

  # ═══════════════ NO CROSS-REPO TOKEN BLEED (AC5; stories 2, 7) ═══════════════
  #
  # The "could not resolve to a repository" defect, foreclosed. The legacy global
  # let an op for repo A read or overwrite repo B's token. Per-command auth removes
  # the shared global, so neither can happen.

  # ── §3a An op for repo A uses its own token and never touches repo B's global ──
  #
  # The exact legacy shape: the parent already holds a DIFFERENT repo's token
  # (as if repo B was the last-activated repo). A migrated op for repo A must run
  # with repo A's OWN token in its child env, and must leave repo B's parent token
  # untouched — it neither read the global nor overwrote it.

  @adw-663 @adw-d31wqy-migrate-gh-issue-pr
  Scenario: A migrated op authenticates with its own context token and does not overwrite another repo's pre-existing parent token
    Given a GitContext for owner "acme" repo "alpha" with auth token "token-alpha"
    And the context's git and gh commands are captured by a recording runner
    And the parent process environment has auth token "token-other-repo"
    When the "issue-comment" gh operation runs through the context
    Then the captured command ran with auth token "token-alpha" in its child environment
    And the parent process environment still has auth token "token-other-repo"

  # ── §3b A project-board op on repo A does not contaminate a concurrent issue op on repo B ─
  #
  # The precise multi-repo concurrency case the legacy process-global FAILED: the
  # project-board op (which legacy code hot-swapped `GH_TOKEN` for, and whose source
  # warns it must run sequential) interleaves with an issue op for a DIFFERENT repo
  # in one long-lived process. With per-command auth, repo B's issue op still
  # carries repo B's token, never repo A's, and the parent global is never mutated.

  @adw-663 @adw-d31wqy-migrate-gh-issue-pr
  Scenario: A board-move on one repo interleaved with an issue op on another keeps each op's auth isolated and the parent untouched
    Given a GitContext for owner "acme" repo "alpha" with auth token "token-alpha"
    And a GitContext for owner "octo" repo "beta" with auth token "token-beta"
    And each context's git and gh commands are captured by a recording runner
    And a baseline snapshot of the parent process environment is captured
    When the "board-move" gh operation runs through the "acme/alpha" context
    And the "issue-comment" gh operation runs through the "octo/beta" context
    Then the "octo/beta" command ran with auth token "token-beta" in its child environment
    And the "octo/beta" command's child environment does not carry auth token "token-alpha"
    And the parent process environment matches the baseline snapshot

  # ═══════════════ TWO-CONTEXT ISOLATION BY CONSTRUCTION (AC5; stories 2, 7) ════
  #
  # Two contexts for two repos, exercised in one process across the migrated WRITE
  # ops, each launch their commands with their own token + cwd. Complements #659's
  # default-branch isolation by proving it for the real issue/PR write surface.

  # ── §4 Two repo contexts run their write ops with their own token and cwd ──────

  @adw-663 @adw-d31wqy-migrate-gh-issue-pr
  Scenario: Two contexts run their migrated write ops with their own token and cwd, neither carrying the other's token
    Given a GitContext for owner "acme" repo "alpha" with auth token "token-alpha"
    And a GitContext for owner "octo" repo "beta" with auth token "token-beta"
    And each context's git and gh commands are captured by a recording runner
    When the "pr-comment" gh operation runs through the "acme/alpha" context
    And the "issue-comment" gh operation runs through the "octo/beta" context
    Then the "acme/alpha" command ran with auth token "token-alpha" in its child environment
    And the "acme/alpha" command ran with cwd equal to the framework repository root
    And the "octo/beta" command ran with auth token "token-beta" in its child environment
    And the "octo/beta" command ran with cwd equal to the framework repository root
    And the "acme/alpha" command's child environment does not carry auth token "token-beta"
    And the "octo/beta" command's child environment does not carry auth token "token-alpha"

  # ═══════════════ TYPE-CHECK BACKSTOP (registry T22) ══════════════════════════
  #
  # ── §5 The migrated operation surface keeps the ADW codebase type-clean ────────
  #
  # A backstop consistent with the sibling per-issue features (feature-658 §7,
  # feature-659 §6): the migrated context methods and the now-adapter modules
  # compile within the ADW codebase's type-check.

  @adw-663 @adw-d31wqy-migrate-gh-issue-pr
  Scenario: The ADW TypeScript type-check passes with the migrated gh-operation surface in place
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
