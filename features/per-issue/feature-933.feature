@adw-933 @adw-ydsij5-bug-no-hardcoded-bra
Feature: ADW names no branch to act on — the protected branch and the docs-index report's branch come from the repository at run time, and a check fails when a branch name is written back in — and every commit an agent makes in a worktree carries the GitHub App's identity, never the host's

  Issue #933 resolves item 1 of the `## Divergence` section of ADR-0019
  (`specs/adr/0019-dev-and-main-branches-with-runner-clone.md`) and item 1 of the
  `## Divergence` section of ADR-0016 (`specs/adr/0016-github-app-identity.md`). Those two items
  are the specification.

  Branch names (ADR-0019). Code never names the base branch; it is resolved at run time from the
  code host. The divergence lists the places that still name one:
    • the docs-index sweep (`adws/triggers/docsIndexSweep.ts`) writes `main` into its report
      issue when the default-branch lookup throws;
    • the protected-branch list is `main`, `master` and `develop`. It lacks the default branch,
      so `dev`, ADW's own default branch, can be deleted. The list in force is the one in
      `@paysdoc/devplatform` that guards `GitContext.deleteRemoteBranch` and
      `deleteLocalBranch`; `adws/vcs/branchOperations.ts` exports an unused copy. The deletion
      that matters is the issue-closed cleanup (`handleIssueClosedEvent`), which deletes from the
      remote whatever branch the closed issue's workflow recorded;
    • `/document` and `/resolve_failed_test` diff against `origin/main`.
  A search made for these scenarios found one more: `/clean_local_repo` deletes every local
  branch except `main` and `develop`. Ruling (owner, 2026-09-29): all of these are bugs.
  `.github/dependabot.yml`, which sets `target-branch: "dev"`, is the one accepted exception.

  Commit identity (ADR-0016). Of the non-merge commits on `dev` since 2026-09-01, 53 carry the
  host's git identity, with agent prefixes such as `plan-orchestrator:` and `build-agent:`.
  Ruling (owner, 2026-09-29): every pipeline commit must carry the App's identity.

  The cause, as found while writing these scenarios and completed by the plan. The pull request
  must state it.
    • An agent commits through `runCommitAgent`, which starts the Claude CLI on `/commit`. The
      CLI runs `git commit` itself, in the environment ADW gave it: `getSafeSubprocessEnv()` plus
      the `subprocessEnv` the caller passes. The conflict resolver commits the same way: the
      `/resolve_conflict` agent finalizes its merge by running `git commit` itself.
    • The App's identity reaches git only through `GitContext.commandEnv()`, which sets
      `GIT_AUTHOR_*` and `GIT_COMMITTER_*`.
    • Four call sites the orchestrators run pass no `subprocessEnv`: the plan phase
      (`plan-orchestrator:`), the alignment phase (`alignment-agent:`), the build phase's
      final commit (`build-agent:`), and the conflict resolver's spawn in
      `adws/triggers/autoMergeHandler.ts`, which `adwMerge.tsx` runs
      (`merge: resolve conflicts between <branch> and <base>`). The build phase's batch-boundary
      commit, after a context reset, does pass it. That is why some `build-agent:` commits carry
      the App identity and some do not. The plan validation phase passes none either, but no
      orchestrator runs it.
    • Nothing in the host's environment names the App, so git falls back to the host's own
      identity: `Martin <martin@macmini.local>`.
    • The document, review-patch, scenario-fix, pre-PR and PR-review commits pass
      `commandEnv()`, and carry the App identity.
  `git log origin/dev --since=2026-09-01 --no-merges` agrees: no `plan-orchestrator:` or
  `alignment-agent:` commit carries the App identity, and `build-agent:` commits carry both.
  With merges included, no `merge: resolve conflicts …` commit carries the App identity either.

  The labels below are the section numbers used for the scenario groups further down (§1–§6):

    §1  THE BRANCH-NAME CHECK (AC1). A check fails when a file under `adws/` or
        `.claude/commands/` names `main`, `master`, `dev` or `develop` as a branch to act on, and
        its report names the file. It passes the same words where they name no branch: a
        `main()` function, the main repository path, a dev server. It passes the Dependabot
        configuration, the accepted exception. And it passes on the ADW checkout, which today
        still holds every place the divergence lists.

    §2  THE DEFAULT BRANCH IS PROTECTED (AC2). When an issue closes, the cleanup deletes the
        branch its workflow recorded, unless that branch is the repository's default branch as
        the code host reports it at run time: `dev`, `trunk` or `main`. When the code host
        cannot report it, the cleanup still leaves the remote's default branch alone. A
        workflow's own branch is deleted, as today.

    §3  THE DOCS-INDEX REPORT INVENTS NO BRANCH. The report issue names the default branch the
        code host reports. When the lookup fails, the sweep still files the report, and the
        report names none of `main`, `master`, `dev` and `develop`.

    §4  THE COMMITS THAT CARRY THE HOST IDENTITY TODAY (AC3). The host's git identity is in git
        config and none is in the environment, as on the cron host. The commit the plan,
        alignment or build phase makes in the worktree is authored and committed by the App.
        The conflict resolver's merge commit has no row; see "WHY SOME CRITERIA GET NO SCENARIO
        OF THEIR OWN".

    §5  THE COMMITS THAT CARRY THE APP IDENTITY TODAY STAY THAT WAY. The same, for the commits
        of the document, review, scenario fix, PR and PR review phases.

    §6  BACKSTOP. The type-check.

  Each row is written to fail for a specific wrong implementation:
    • the checkout row is RED today. It fails while any listed place still names a branch, and
      for a check that does not read `.claude/commands/`, where the prompts live;
    • the failing fixture rows cover each of the four names, in TypeScript and in Markdown,
      under `adws/` and under `.claude/commands/`. They fail for a check that reads only one of
      the two languages or one of the two directories, and for one that knows only `main`;
    • the passing fixture rows fail for a check that matches the bare words: `adws/` is full of
      `main()` functions and `getMainRepoPath`, and `bun run dev` starts a dev server. The
      Dependabot row fails for a check that reads the whole repository;
    • the §2 `dev` and `trunk` rows are RED today, because the library's list holds neither.
      The `trunk` row also fails for a fix that writes `dev` into the list instead of resolving
      the default branch. The `main` row is GREEN today; it fails for a fix that loses the
      protection `main` has when it is the default branch;
    • the §2 failed-lookup row is RED today. It also fails for a fix that deletes the branch
      when it cannot learn the default branch. The own-branch row is GREEN today; it fails for
      a fix that protects every branch, so that issue branches pile up on the remote;
    • the §3 `trunk` row is GREEN today; it fails for a fix that stops naming the branch the
      code host does report. The §3 failed-lookup row is RED today: the report says `main`. It
      also fails for a fix that swaps `main` for another written name, for one that lets the
      lookup's error escape the sweep, which must never throw, and for one that drops the
      report;
    • every §4 row is RED today: the commit carries the host identity. "authored and committed
      by" also fails for a fix that sets only the author (`--author` in the prompt, or
      `GIT_AUTHOR_*` alone), because the committer is still the host;
    • "added a commit whose message starts with" fails when the phase made no commit, so the
      identity assertion cannot pass on an empty set of commits;
    • §5 is GREEN today and must stay green. It fails for a fix that moves the identity into
      one place and loses it on a path that has it today.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  AC3 asks for the cause to be stated. The pull request description states it, and the review
  checks it. AC4 (the `## Divergence` sections of ADR-0019 and ADR-0016 are removed in the same
  pull request) is a documentation change. A scenario asserting that a document lacks a section
  would assert a file's contents, which the Rot-Detection Rubric forbids, so the review checks
  it. The prompts `/document`, `/resolve_failed_test` and `/clean_local_repo` run only inside a
  real Claude session, which this harness never starts. §1's checkout row holds them to the
  rule without reading them. The conflict resolver's merge commit (`merge: resolve conflicts …`)
  also carries the host identity today, but has no §4 row. A row would have to drive a real
  merge conflict through the auto-merge loop. And a merge brings in commits the conflict
  resolver did not make, so "every commit the phase added" could not hold. The plan's
  integration test (`adws/agents/__tests__/commitIdentity.integration.test.ts`) commits through
  the conflict resolver's spawn in a real worktree and checks for the App identity. The plan puts
  the fix once in the agent runner, which every spawn shares.

  Not pinned here, and left to the plan:
    • the form of the check: a lint script with a `lint:` package script that CI runs, as
      `lint:git-guard` and `lint:docs-index` run in `.github/workflows/git-cli-guard.yml`, or a
      unit test;
    • whether test files under `adws/` are in its scope. About twenty-five of them name a branch
      as a stubbed code-host answer or as fixture data. The checkout row forces a decision,
      either way;
    • how prose that mentions a branch name without acting on it is treated: the examples in
      `/resolve_conflict` and `/review`, `adws/README.md`, and the log excerpts in
      `adws/known_issues.md`;
    • how `/document` and `/resolve_failed_test` learn the base branch: an argument from the
      orchestrator (`WorkflowConfig.defaultBranch` is resolved at start-up), or a run-time
      lookup the prompt tells the agent to make;
    • whether `main`, `master` and `develop` stay protected where they are not the default
      branch. The library's list keeps them protected unless the dependency changes;
    • where the identity fix sits: at each call site, or once in the agent runner, from the
      launch context's `GitContext`. The §4 and §5 rows run the real phase functions and pass
      either way. A fix at each call site would also have to reach the conflict resolver's
      spawn, which no row runs;
    • what the docs-index report says about the branch when the lookup fails, beyond naming
      none of the four.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the branch-name check's exit status and report, over a throwaway fixture tree or over the
      checkout;
    • the branches on a throwaway bare repository that stands in for the remote, and the result
      the issue-closed cleanup returns;
    • the report issue the docs-index sweep files, recorded at its filing seam;
    • the commits on a throwaway worktree's branch: their author, committer and message;
    • the type-check's exit status.
  No scenario reads, greps or parses a source file.

  Notes for the step definitions:
    • THE CHECK. The build adds it; follow the plan for its entry point. Run it from the ADW
      checkout root and capture its exit status and its whole output. A script that takes the
      root to check as its first argument, as `adws/checkLivingDocsIndex.ts` does, is run as a
      subprocess (`bunx tsx adws/<script>.ts <root>`). A check exported as a function may be
      called in-process over the root instead. "is run over the ADW checkout" checks the
      checkout root, through the package script when there is one. "passes" is exit 0, or no
      finding; "fails" is a non-zero exit, or at least one finding. "report names" matches the
      file's path, relative to the root, as a substring of the output.
    • THE FIXTURE TREE. "a fixture tree that the branch-name check passes" builds a throwaway
      directory holding `adws/core/fixtureModule.ts` (a small function that names no branch),
      `.claude/commands/fixture_command.md` (a few instruction lines that name no branch) and
      an empty `.github/`. It runs the check over the tree and asserts that it passes, so a
      later failure can only come from the line the scenario adds. "the file {string} in the
      fixture tree contains the line:" creates the file, or appends to it, with the doc string
      as one line. Remove the tree after each scenario.
    • THE REMOTE. "a remote for the target repository "<owner/repo>" whose default branch is
      "<B>"" makes a throwaway bare repository (`git init --bare --initial-branch=<B>`), seeds
      `<B>` with one commit, and clones it to `<targetReposDir>/<owner>/<repo>`, so that the
      clone's `origin/HEAD` names `<B>`. "the workflow for issue N in "<owner/repo>" recorded the
      branch "<X>"" pushes `<X>` to the remote when the remote lacks it. It writes the top-level
      state `agents/<adwId>/state.json` with `adwId`, `issueNumber`, `branchName: <X>` and
      `workflowStage: 'completed'`, a stage the grace period does not hold back. It has the
      issue tracker answer `fetchComments(N)` with one comment carrying
      `**ADW ID:** \`<adwId>\``. "still holds" and "no longer holds" read
      `git ls-remote --heads` on the bare repository.
    • THE BOUNDARY. One launch boundary per repository, built by `buildLaunchBoundary` with
      every seam injected: `targetReposDir` set to the throwaway directory, a literal token
      provider, a git identity and recording providers. Never let a call reach GitHub. The code
      host answers `getDefaultBranch()` with the branch that "the code host reports "<B>" as
      the default branch of …" names. After "the code host fails to report the default branch
      of …" it throws `Error('default branch lookup failed')`. The issue tracker answers
      `listIssues` with no issue, so the dependency unblock that follows the cleanup spawns
      nothing.
    • "issue N in "<owner/repo>" is closed" calls `handleIssueClosedEvent(N, boundary,
      undefined, [])` with its production collaborators. Never inject `deleteRemoteBranch`: its
      default is what is under test. "the issue-closed cleanup deleted no branch" reads
      `branchDeleted: false` from the result.
    • THE SWEEP. "the docs-index sweep runs over "<owner/repo>"" calls `runDocsIndexSweep` with
      the repository's boundary and every other seam injected, so that it prepares no worktree:
      `readIndex` returns the index text, `readDoc` and `listFiles` agree with it,
      `persistIndex`, `refreshReport` and `closeReport` record their calls,
      `listReportCandidates` answers no issue, `fileReport` records the spec and answers 9339,
      and `countBand` is null. "has a violation that needs a human decision" builds a canonical
      index in which two entries share a doc path (`duplicate-entry`), a violation the sweep
      reports and never repairs. No doc path or text in the fixture contains one of the four
      branch names. "completed without an error" means the returned promise resolved. "filed
      one report issue" means `fileReport` was called once. "names the branch" and "names none
      of the branches" match each name as a whole word in the filed title and body.
    • THE CLAUDE CLI. Never spawn the real one. Point `CLAUDE_CODE_PATH` at a throwaway
      executable, as feature-907 (`writeThrowawayClaudeScript`) and feature-929 do. Clear the
      cached path (`clearClaudeCodePathCache()`) before and after, and restore the variable in
      an `@adw-933` `After` hook. `getSafeSubprocessEnv()` filters out `MOCK_*` variables, so
      bake absolute paths into the script. The script picks its behaviour from the slash
      command at the start of its prompt, the last argument:
        – `/commit '<prefix>' '<context>'` does what the real `/commit` tells the agent to do:
          `git add -A`, then `git commit -m "<prefix>: <description>"` in its working directory.
          It uses the environment it was started with, and never `-c user.*`, `--author` or
          `GIT_*` variables of its own, so the commit carries whatever identity the phase gave
          the agent. Its final result is the commit message;
        – every other command leaves the change its phase commits and ends with a final result
          that the phase's own parser accepts: `/align_plan_scenarios` changes the plan file
          and reports that change; `/implement` writes one source file; `/document` writes a doc
          under `app_docs/` and answers its path; `/patch` and `/resolve_failed_scenario` write
          one file each; `/pull_request` answers a title and a body.
    • THE WORKFLOW. "a workflow for issue N in the target repository "<owner/repo>" that acts as
      the GitHub App "<slug>" with id <id>" builds a `WorkflowConfig` over a throwaway git
      repository on a branch of its own, with recording providers. Feature-929's
      `createWorkflow` over the `world796` harness is the precedent. The repository's `origin`
      is a throwaway bare repository, so the push after each commit lands without the network.
      Its `GitContext` is real, and its git identity is the one `resolveBootstrapGitIdentity`
      derives for that App: `<slug>[bot]` with the email
      `<id>+<slug>[bot]@users.noreply.github.com`, as author and as committer. Inject it through
      `resolveGitIdentity`; never set `GITHUB_APP_*`.
    • THE HOST. "the host's own git identity is "<name>" with the email "<email>"" sets
      `user.name` and `user.email` in the throwaway repository's local config. "no git identity
      is set in the host's environment" removes `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`,
      `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` from `process.env` for the whole When step,
      and restores them afterwards. None of them is set on the cron host, and a runner that
      exports them would hide the bug.
    • THE PHASES. "the <phase> phase makes its commit" records `HEAD`, then runs the real phase
      function:
        – plan: `executePlanPhase`, with an uncommitted plan file already where
          `getPlanFilePath` looks, so the plan agent is skipped and only the commit runs;
        – alignment: `executeAlignmentPhase`, with the plan file and one scenario file;
        – build: `executeBuildPhase`, with the plan file;
        – document: `executeDocumentPhase`;
        – review: `executeReviewPatchCycle` with one blocker, the review phase's only commit;
        – scenario fix: `executeScenarioFixPhase` with a scenario proof that reports one
          failing scenario;
        – PR: `executePRPhase`, with an uncommitted change in the worktree, so that its
          safety-net commit runs;
        – PR review: `executePRReviewCommitPushPhase`, over a PR-review configuration whose
          source branch is the worktree's branch, with an uncommitted change.
      Never call `runCommitAgent` directly: its callers are what is under test. "the phase added
      a commit whose message starts with "<prefix>:"" finds such a commit among the commits
      after the recorded `HEAD`. "every commit the phase added was authored and committed by
      "<name>" with the email "<email>"" compares `%an`, `%ae`, `%cn` and `%ce` of each of them.
    • HOOKS. Scope every hook to `@adw-933`. `After`: restore `CLAUDE_CODE_PATH`, the cached CLI
      path and the `GIT_*` variables if a step left them changed. Remove every throwaway
      directory, and `agents/<adwId>` for every adwId used.
    • REUSED, NOT REDEFINED. G18 is defined in
      `features/step_definitions/ensureCronOnEveryEventSteps.ts`, and T22 in
      `features/regression/step_definitions/thenSteps.ts`. Redefining either is an
      AmbiguousStepDefinition.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T22 `the ADW TypeScript type-check passes`
  These registered phrases are deliberately NOT reused:
    • W16 and T34 run the git/gh guard, a different check. It reads only TypeScript and skips
      `.claude/`, where the prompts that diff against `origin/main` live;
    • G11 initialises a worktree in the regression World, and T4 and T11 read the git
      invocations the git-mock recorded. Here the phases run on a workflow harness, and the
      commits are real git artefacts in a throwaway repository, read with `git log`;
    • T31, T32 and T33 assert the commit the framework upgrade records and its tree, not who
      made a commit.
  No unregistered phrase from another per-issue feature is reused: their step definitions are
  swept with their feature. That is why the wording avoids feature-929's "a workflow for issue
  {int} in the target repository {string} whose providers record every call" and its "… phase
  runs" steps, and feature-940's "the docs-index gate …" steps. The registry has no phrase for
  the branch-name check, its fixture tree, a remote's branches, the code host's default branch,
  closing an issue, the docs-index sweep's report, the App and host identities, or the commits
  a phase makes, so novel phrasing is introduced for them.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE BRANCH-NAME CHECK ──────────────────────────────────────────────────────────────────

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario: The branch-name check passes on the ADW checkout
    When the branch-name check is run over the ADW checkout
    Then the branch-name check passes

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario Outline: A line that names main, master, dev or develop as a branch to act on, added under adws/ or .claude/commands/, fails the branch-name check, whose report names the file
    Given a fixture tree that the branch-name check passes
    And the file "<file>" in the fixture tree contains the line:
      """
      <line>
      """
    When the branch-name check is run over the fixture tree
    Then the branch-name check fails
    And the branch-name check report names "<file>"

    Examples:
      | file                                | line                                                                                     |
      | adws/triggers/fixtureSweep.ts       | const baseBranch = lookedUpBranch ?? 'main';                                             |
      | adws/vcs/fixtureBranches.ts         | export const PROTECTED_BRANCHES = ['main', 'master', 'develop'];                         |
      | adws/phases/fixturePhase.ts         | codeHost.createPullRequest({ title, body, sourceBranch: branchName, targetBranch: 'dev' }); |
      | .claude/commands/fixture_command.md | - Run `git diff origin/main --stat` to see the files changed                             |
      | .claude/commands/fixture_command.md | - Rebase the branch onto `origin/dev` before you push it                                 |
      | .claude/commands/fixture_command.md | - Delete every local branch except `master` and `develop` with `git branch -D`           |

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario Outline: A line that uses the word main or dev without naming a branch to act on passes the branch-name check
    Given a fixture tree that the branch-name check passes
    And the file "<file>" in the fixture tree contains the line:
      """
      <line>
      """
    When the branch-name check is run over the fixture tree
    Then the branch-name check passes

    Examples:
      | file                                | line                                                  |
      | adws/fixtureCli.ts                  | async function main(): Promise<void> {}               |
      | adws/core/fixtureWorktree.ts        | const mainRepoPath = getMainRepoPath(gitContext, cwd); |
      | adws/core/fixtureConfig.ts          | export const startDevServer = 'bun run dev';          |
      | .claude/commands/fixture_command.md | - Describe the main implementation work for the issue |
      | .claude/commands/fixture_command.md | - Start the dev server with `bun run dev --port 3000` |

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario: The Dependabot configuration's target branch, the one accepted exception, passes the branch-name check
    Given a fixture tree that the branch-name check passes
    And the file ".github/dependabot.yml" in the fixture tree contains the line:
      """
      target-branch: "dev"
      """
    When the branch-name check is run over the fixture tree
    Then the branch-name check passes

  # ── §2 THE DEFAULT BRANCH IS PROTECTED ────────────────────────────────────────────────────────

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario Outline: An issue whose workflow recorded the repository's default branch closes, and ADW leaves that branch on the remote, whatever the code host says it is called
    Given a remote for the target repository "acme/widgets" whose default branch is "<default branch>"
    And the code host reports "<default branch>" as the default branch of "acme/widgets"
    And the workflow for issue <issue> in "acme/widgets" recorded the branch "<default branch>"
    When issue <issue> in "acme/widgets" is closed
    Then the remote of "acme/widgets" still holds the branch "<default branch>"
    And the issue-closed cleanup deleted no branch

    Examples:
      | default branch | issue |
      | dev            | 9331  |
      | trunk          | 9332  |
      | main           | 9333  |

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario: When the code host cannot report the default branch, the issue-closed cleanup still leaves the remote's default branch alone
    Given a remote for the target repository "acme/widgets" whose default branch is "trunk"
    And the code host fails to report the default branch of "acme/widgets"
    And the workflow for issue 9334 in "acme/widgets" recorded the branch "trunk"
    When issue 9334 in "acme/widgets" is closed
    Then the remote of "acme/widgets" still holds the branch "trunk"
    And the issue-closed cleanup deleted no branch

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario: An issue whose workflow recorded its own branch closes, and ADW deletes that branch from the remote and keeps the default branch, as today
    Given a remote for the target repository "acme/widgets" whose default branch is "dev"
    And the code host reports "dev" as the default branch of "acme/widgets"
    And the workflow for issue 9335 in "acme/widgets" recorded the branch "bugfix-issue-9335-fix-login-typo"
    When issue 9335 in "acme/widgets" is closed
    Then the remote of "acme/widgets" no longer holds the branch "bugfix-issue-9335-fix-login-typo"
    And the remote of "acme/widgets" still holds the branch "dev"

  # ── §3 THE DOCS-INDEX REPORT INVENTS NO BRANCH ────────────────────────────────────────────────

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario: The docs-index sweep's report issue names the default branch the code host reports
    Given the code host reports "trunk" as the default branch of "acme/widgets"
    And the living-docs index of "acme/widgets" has a violation that needs a human decision
    When the docs-index sweep runs over "acme/widgets"
    Then the docs-index sweep completed without an error
    And the docs-index sweep filed one report issue
    And the filed docs-index report names the branch "trunk"

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario: When the code host cannot report the default branch, the docs-index sweep still files its report issue, and the report names none of main, master, dev and develop
    Given the code host fails to report the default branch of "acme/widgets"
    And the living-docs index of "acme/widgets" has a violation that needs a human decision
    When the docs-index sweep runs over "acme/widgets"
    Then the docs-index sweep completed without an error
    And the docs-index sweep filed one report issue
    And the filed docs-index report names none of the branches "main, master, dev, develop"

  # ── §4 THE COMMITS THAT CARRY THE HOST IDENTITY TODAY ─────────────────────────────────────────

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario Outline: The commit the <phase> phase makes in the worktree is authored and committed by the GitHub App, not by the host's git identity
    Given a workflow for issue 9336 in the target repository "acme/widgets" that acts as the GitHub App "adw-test-app" with id 4242
    And the host's own git identity is "Host Operator" with the email "operator@host.invalid"
    And no git identity is set in the host's environment
    And the Claude CLI commits the worktree's changes whenever it is asked to commit
    When the <phase> phase makes its commit
    Then the phase added a commit whose message starts with "<prefix>:"
    And every commit the phase added was authored and committed by "adw-test-app[bot]" with the email "4242+adw-test-app[bot]@users.noreply.github.com"

    Examples:
      | phase     | prefix            |
      | plan      | plan-orchestrator |
      | alignment | alignment-agent   |
      | build     | build-agent       |

  # ── §5 THE COMMITS THAT CARRY THE APP IDENTITY TODAY STAY THAT WAY ────────────────────────────

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario Outline: The commit the <phase> phase makes in the worktree is still authored and committed by the GitHub App, as today
    Given a workflow for issue 9337 in the target repository "acme/widgets" that acts as the GitHub App "adw-test-app" with id 4242
    And the host's own git identity is "Host Operator" with the email "operator@host.invalid"
    And no git identity is set in the host's environment
    And the Claude CLI commits the worktree's changes whenever it is asked to commit
    When the <phase> phase makes its commit
    Then the phase added a commit whose message starts with "<prefix>:"
    And every commit the phase added was authored and committed by "adw-test-app[bot]" with the email "4242+adw-test-app[bot]@users.noreply.github.com"

    Examples:
      | phase        | prefix                 |
      | document     | document-agent         |
      | review       | review-patch-agent     |
      | scenario fix | scenario-fix-agent     |
      | PR           | pre-pr-commit          |
      | PR review    | pr-review-orchestrator |

  # ── §6 BACKSTOP ────────────────────────────────────────────────────────────────────────────────

  @adw-933 @adw-ydsij5-bug-no-hardcoded-bra
  Scenario: TypeScript type-check passes with every branch resolved at run time and the App identity on every agent commit
    Then the ADW TypeScript type-check passes
