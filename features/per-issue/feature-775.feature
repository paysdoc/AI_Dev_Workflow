@adw-775 @adw-uvv9hm-repo-api-gh-commands
Feature: Repo-API gh commands run from a working directory that always exists — a Cancel or Retry directive is processable on a host that has never cloned the target workspace

  Issue #775 fixes a spawn-cwd coupling in `GitContext.#run` (`adws/gitContext/gitContext.ts:152-159`).
  Every git/gh command the package issues goes through that one chokepoint, which resolves
  `cwd = opts.cwd ?? this.#basePath`. For a non-self-host context `#basePath` is
  `path.join(targetReposDir, owner, repo)` (`resolveBasePath`, :89-93) — a directory that exists only
  after some workflow has cloned a workspace for that repo ON THAT HOST.

  `gh api repos/{owner}/{repo}/issues/{n}/comments --paginate` needs no repository working directory
  at all. Running it under the target workspace couples directive handling ("stop this workflow") to
  workflow-lifecycle state ("a workspace was cloned here once") — backwards, because Cancel must work
  ESPECIALLY when local state is absent or broken. On the production host a `## Cancel` comment on
  `paysdoc/paysdoc.nl#28` therefore crashed the webhook server:

    Error: Failed to fetch comments for issue #28: Error: spawnSync /bin/sh ENOENT
        at fetchIssueCommentsRest (adws/github/issueApi.ts:235)

  `spawnSync /bin/sh ENOENT` is Node's error for a NONEXISTENT SPAWN CWD, not a missing shell.

  THE FIX: repo-independent gh commands run from a cwd that always exists — the injected
  `frameworkRepoRoot` — while git commands and worktree-scoped commands keep their current
  basePath/worktree cwd semantics.

  The behavioural contract pinned below:

    1. THE CRASH IS GONE (Symptom, Desired behavior 3). A repo-API fetch for a registered target repo
       succeeds on a host that has never cloned that repo's workspace. This is the headline: RED
       before with the exact production failure (a spawn working-directory error), GREEN after.
    2. NO REGRESSION WHEN THE WORKSPACE DOES EXIST. The same fetch still succeeds once the workspace
       has been cloned — the fix must not trade one broken host state for another.
    3. THE SPAWN CWD IS WORKSPACE-INDEPENDENT (Desired behavior 1, "instead of"). The same repo-API
       operation runs from the SAME directory whether or not the workspace exists. This is the
       deliberate strong reading: it forecloses a "probe basePath, fall back when missing"
       implementation, which would fix the crash while leaving the design bug — a spawn cwd that
       still varies with workflow-lifecycle state — in place.
    4. THAT DIRECTORY EXISTS, AND IS NOT THE WORKSPACE. The two properties the issue actually
       requires, asserted directly rather than via any particular choice of directory.
    5. IT IS THE INJECTED FRAMEWORK ROOT, NOT THE AMBIENT CWD (PRD: "no cwd fallback"). Perturbing
       `process.cwd()` before the operation leaves the recorded spawn cwd unchanged. The issue says
       "e.g. the framework repo root"; §5 pins that example, because the only other always-exists
       candidates are the ambient working directory — which is precisely the fallback the GitContext
       PRD bans, and would resurrect the wrong-base-repo class — or an identity-less temp dir.
       `frameworkRepoRoot` is already mandatory injected config on every context.
    6. THE WHOLE REPO-API SURFACE, NOT JUST THE CRASH SITE (Desired behavior 1, "the repo-API command
       methods"). Reads, writes, the GraphQL/board surface, and `gh api user` all run pre-clone.
    7. THE TOKEN IS STILL THE TARGET REPO'S (PRD story 2). Moving the cwd must not move the identity:
       a repo-API command running from the framework root still carries the TARGET repo's token in
       its child environment. A fix that reached for the self-host context to get an existing cwd
       would reintroduce the GH_TOKEN-bleed class (vestmatic #143/#181/#187).
    8. GIT COMMANDS KEEP BASEPATH (Desired behavior 2). A workspace-scoped git read still runs from
       the target workspace directory.
    9. WORKTREE-SCOPED COMMANDS KEEP THE SUPPLIED WORKTREE CWD (Desired behavior 2). The explicit
       `opts.cwd` override still wins.
   10. A GIT READ PRE-CLONE STILL FAILS — IT IS NOT ANSWERED FROM THE FRAMEWORK CHECKOUT. The most
       dangerous over-fix is changing `#run`'s DEFAULT cwd wholesale: every git op would then read
       branches, remotes and worktrees out of the framework repo while believing it was reading the
       target's. Absence of a checkout must still be an error, never a silent wrong-repo answer.
   11. SELF-HOST IS UNCHANGED (structurally). For a self-host context `basePath === frameworkRepoRoot`,
       so the fix is a no-op there; asserted so the fix cannot narrow to "target repos only" in a way
       that moves self-host commands somewhere new.
   12. TYPE-CHECK BACKSTOP (T22).

  Mapping onto the plan's acceptance criteria (plan step 6): AC1 (directive works pre-clone) → §1, §2;
  AC2 (repo-API calls run from a directory that exists, identity from the command) → §4, §6; AC3
  (workspace operations unmoved) → §8, §9, §10; AC4 (self-host unchanged) → §11; AC5 (no ambient
  working directory) → §5 for the repo-API class and §8 for the git class; AC6 (the repo-API spawn cwd
  is workspace-independent — forecloses "probe basePath, fall back when missing") → §3; AC7 (moving
  the cwd moves nothing else: the target repo's own token still rides the child env) → §7; AC8 (a
  pre-clone git read still FAILS rather than being answered from the framework checkout) → §10.

  Observability / rot-prevention note:

    Every assertion targets an artefact the system PRODUCES: the `(command, cwd, env)` triple the
    context hands its spawn runner (vocabulary surface #2, recorded calls — the same surface
    feature-659 / feature-663 / feature-691 use), the value a context method returns, the error a
    context method raises, real on-disk temp directories the step itself creates as fixtures, and the
    type-checker's exit status (surface #4). No step reads `gitContext.ts`, `issueCommands.ts`,
    `issueApi.ts`, `trigger_webhook.ts` or any other framework source as text, substring-matches its
    contents, or parses it as JSON/AST. `exists on disk` (§4) is asserted about a temp fixture
    directory tree the step constructed — never about a source file.

  Scope notes:

    • WHY THE SCENARIOS DRIVE `GitContext` DIRECTLY AND NOT `fetchIssueCommentsRest`. The crash site
      in the stack trace is `adws/github/issueApi.ts:224-237`, but it takes `(issueNumber, repoInfo)`
      and resolves its own context through `gitContextForRepo(repoInfo)` — no injection seam. That
      factory calls `resolveContextToken`, whose FIRST branch is "App configured → mint an
      installation token for owner/repo, propagate any throw loudly"
      (`adws/gitContext/tokenResolver.ts:49-53`). On any host where the GitHub App is configured — the
      production host, the maintainer's host — a fictitious fixture repo has no installation, so the
      construction throws before the spawn cwd is ever computed: RED for the wrong reason, and still
      RED after the fix. A real owner/repo is worse: it would point `resolveBasePath` at a real
      checkout. Driving `GitContext` with an explicit identity and an explicit token is the
      established pattern here (feature-658 / feature-659 / feature-663) and isolates exactly the
      seam this issue changes. The webhook and cron plumbing ABOVE the fetch
      (`trigger_webhook.ts:192-207`, `trigger_cron.ts:312-315`) is untouched by this fix and is
      deliberately not re-pinned.
    • "WORKSPACE-SCOPED GH COMMANDS" IS AN EMPTY CATEGORY TODAY — verified 2026-07-30 by reading every
      command builder in `adws/gitContext/commands/` plus the one inline `gh` string in
      `gitContext.ts:163`. EVERY gh command the package builds carries explicit repo identity
      (`--repo owner/repo`, `repos/{owner}/{repo}/…`, or `-f owner= -f repo=`). There are exactly two
      commands with no repo identity in the string, and BOTH are repo-independent by nature:
      `gh api user` (`authenticatedUser`) and the free-form `graphQLCmd(query, variables)`. So the
      issue's rule ("API calls that carry explicit `owner/repo` in the command string") read
      LITERALLY would leave those two on basePath and STILL CRASHING pre-clone — `authenticatedUser`
      is exactly the kind of pre-clone identity probe that must not need a workspace. §6 pins both,
      closing that gap: the operative distinction is git-vs-gh, not "does the string contain a slash".
      The implementer must decide HOW the chokepoint classifies (a flag on the command builders, a
      `#runRepoApi` sibling of `#run`, or a prefix test at the chokepoint); the scenarios are
      behavioural and hold either way.
    • `frameworkRepoRoot` IS NOT CURRENTLY RETAINED. It is consumed by `resolveBasePath` in the
      constructor and then discarded — `gitContext.ts:100-121` keeps `#basePath` but no
      `#frameworkRepoRoot` field. The fix has to retain it. Flagged because it is easy to reach for
      `REPO_ROOT` from `adws/core/environment` instead, which would put a framework-global import
      back inside the package and re-couple it to the ADW checkout it was factored out of (#700).
    • `gh pr create` IS THE ONE COMMAND WITH KNOWN CWD SENSITIVITY and is deliberately NOT pinned in
      §6, because the claim rests on gh CLI behaviour rather than on anything this repo controls.
      Outside a git repository `gh pr create` requires an explicit `--head`, and ADW always passes one
      (`prCommands.ts:44-51`), so it is safe to move — the plan for this issue records a live
      verification on 2026-07-30 (run from `/tmp`, gh reached the API and failed on the refs, not on a
      missing git repository). Recorded here so the omission from §6 reads as a deliberate choice of
      what to assert, not as an open question.
    • THIS FIX SUPERSEDES A CONTRACT THAT SEVEN OTHER PER-ISSUE FEATURES ASSERT, AND SIX OF THEM DO
      NOT OWN THE STEP DEFINITION. `the captured command ran with cwd equal to the context base path`
      and `the {string} command ran with cwd equal to the {string} context base path` are defined ONLY
      in `feature-659.steps.ts:237` and `:298`; feature-663, feature-691, feature-692, feature-695,
      feature-697 and feature-700 have no step-def file of their own for them and REUSE feature-659's.
      So re-pointing feature-659's own scenarios at a git operation does NOT rescue the reusers — each
      of these sites asserts the superseded contract about a GH operation and will go RED when this fix
      lands (every line verified 2026-07-30):
        feature-659.feature:225, :240, :305, :307   (`default-branch`)
        feature-663.feature:221, :237 (outline: issue-view, issue-create, label-apply, pr-view,
                            pr-comment), :337, :339 (two-context write ops)
        feature-691.feature:246, :261 (outline: list-open-issues, view-issue-comments, list-merged-prs)
        feature-692.feature:276 (outline) — MIXED CLASSES: the `remote-url` row is a git op and stays
                            green; only the `authenticated-user` row (`gh api user`) moves, so this
                            outline must be SPLIT rather than swapped wholesale. `:259` (`remote-url`)
                            is unaffected.
        feature-695.feature:337   (`set-secret`, `gh secret set --repo …`)
        feature-697.feature:37    (`pr-changed-files`) — `:58` (`stats-log`) is a GIT read, unaffected
        feature-700.feature:342   (`default-branch`, under a process.chdir)
        feature-664.feature:327 (§3a `default-branch`), :365, :367 (§4 interleaved, both driven by
                            `defaultBranch()` at `feature-664.steps.ts:243` and `:274-275`) — own step
                            defs
      They are NOT tagged `@adw-775`: tagging them would pull assertions of the superseded contract
      into this issue's proof run, which could then never go green. Rewriting another issue's scenarios
      also requires rewriting their step definitions, which is not this agent's output. THE IMPLEMENTER
      MUST MIGRATE ALL EIGHT GROUPS — the natural migration is to keep the token/git-identity
      assertions and either re-point the driving operation to a git op (right where the scenario also
      asserts per-repo cwd ISOLATION, i.e. feature-659 and feature-664) or replace the cwd assertion
      with a framework-root form (right where the scenario exists to cover the GH surface, i.e. the
      other six — re-pointing those to git ops would delete the coverage they exist for).
      RESOLVED WITH THE PLAN: the accompanying plan covers feature-659 and feature-664 (steps 7-8) and
      all six reusers (step 9, which also adds the two framework-root Then phrases to
      `feature-659.steps.ts`, the file that owns the superseded pair); its validation list runs
      `@adw-659`, `@adw-663`, `@adw-664`, `@adw-691`, `@adw-692`, `@adw-695`, `@adw-697`, `@adw-700`
      as migrated-and-green, and `@adw-658`, `@adw-661`, `@adw-662`, `@adw-693`, `@adw-694`,
      `@adw-696`, `@adw-698`, `@adw-699` as green-while-UNMODIFIED. The same superseded contract lives
      in unit tests: `adws/gitContext/__tests__/gitContextOperations.test.ts:52` (`defaultBranch`),
      `:195` (`listOpenIssues`), `:252` (`issueComments`), `:317` (`fetchMergedPRs`), `:852`
      (`setSecret`), `:899`/`:900` (`runGraphQLInput`), plus `:433-437`, `:531`, `:1116`, `:1186` per
      the plan. Unaffected, because their ops are git or self-host: feature-661, feature-662,
      feature-693:342, feature-694:351, feature-696:48, feature-697:58, feature-698, feature-699:360
      and :377 (self-host, where basePath IS the framework root, so even its `gh-auth` probe is green).
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md` configures a
      `## Regression Scenario Directory`, so promotion is a deliberate human decision and this agent
      never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here — the registry has no phrase for a spawn working directory, a
    pre-clone host, or a real-spawn stand-in, and the GitContext cwd families live in per-issue step
    defs rather than the registry. Every phrase below is deliberately DISTINCT from the existing
    GitContext families (`… read operation runs through the context` / `… gh operation …` /
    `… gh-read operation …` / `… git-read operation …` / `… remote-op operation …` / `… secret
    operation …` / `… promotion PR operation …` / `… claim-op operation …` / `… vcs-probe operation …`
    / `… identity-read operation …` / `… self-host probe …`, and from `the captured command ran with
    cwd equal to …`), so feature-775.steps.ts can be self-contained with zero
    AmbiguousStepDefinition risk under the globally-loaded per-issue step defs. Surfaced to the
    maintainer in the agent Output:
      • `a target repository {string} registered on a host that has never cloned its workspace`
      • `a target repository {string} registered on a host that has already cloned its workspace`
      • `a self-host framework context for {string}`
      • `the context is authenticated with the installation token {string}`
      • `the context's spawned commands are recorded by a spawn recorder`
      • `the context's spawned commands are recorded and then really spawned with a harmless stand-in command`
      • `the process working directory is moved to a directory that is neither the framework repository root nor the target workspace`
      • `the issue comments for issue {int} are fetched through the context`
      • `the {string} repo-API operation runs through the context`
      • `the {string} workspace-git operation runs through the context`
      • `the {string} workspace-git operation runs through the context for the worktree of branch {string}`
      • `the target repository's workspace directory is created on this host`
      • `the repo-API operation completes without a spawn working-directory failure`
      • `the repo-API operation returns the stand-in command's output`
      • `the recorded repo-API command's spawn working directory exists on disk`
      • `the recorded repo-API command's spawn working directory is not the target workspace directory`
      • `the recorded repo-API command still addresses the repository {string}`
      • `both recorded repo-API commands ran with the same spawn working directory`
      • `the recorded repo-API command's spawn working directory is the injected framework repository root`
      • `the recorded repo-API command carried the auth token {string} in its child environment`
      • `the recorded workspace-git command's spawn working directory is the target workspace directory`
      • `the recorded workspace-git command's spawn working directory is the worktree directory for branch {string}`
      • `the workspace-git operation fails with a spawn working-directory failure`
      • `no recorded command ran with the injected framework repository root as its spawn working directory`

    Step-definition note for the maintainer (feature-775.steps.ts — keep it SELF-CONTAINED with its
    own `@adw-775` Before/After and module-private world; in particular do NOT import
    `gitContextSharedWorld.ts`, whose `TARGET_REPOS_ROOT` / `FRAMEWORK_ROOT` are imaginary sentinels
    and whose `makeNoOpFsDeps` hardcodes `existsSync: () => false` — this feature needs REAL
    directories, because the failure being fixed is a real spawn against a real missing path):

      • REAL FIXTURE DIRECTORIES, PRODUCTION LAYOUT, NO MONKEY-PATCHING. Per scenario, create two
        `mkdtempSync` roots: a `targetReposDir` and a `frameworkRepoRoot`. Construct the context with
        `{owner: 'acme', repo: 'webapp', selfHost: false, token, gitIdentity, frameworkRepoRoot,
        targetReposDir}`, so production's `resolveBasePath` computes
        `basePath = <targetReposDir>/acme/webapp` unaided. "has never cloned its workspace" = leave
        that path absent (the pre-clone state); "has already cloned its workspace" =
        `mkdirSync(basePath, {recursive: true})`. The framework root must be a temp dir, NOT the real
        ADW checkout: it keeps §5 honest (a `process.cwd()` implementation would record the test's
        cwd, which is a different path) and makes an accidental real invocation harmless. `rmSync`
        both roots in `After`.
      • ONE RECORDER, TWO MODES. Both Given phrases install the same `deps.exec` recorder pushing
        `{command, cwd: options.cwd, env: {...options.env}}`. Record-only mode returns a benign
        canned stdout and never spawns. Real-spawn mode records and then calls
        `execSync("printf '%s' '[]'", {...options, encoding: 'utf-8'})` — passing `options.cwd`
        THROUGH UNCHANGED, mirroring `defaultExec`'s `input` branch (`gitContext.ts:49-60`) when
        `options.input !== undefined`.
      • WHY SUBSTITUTING THE COMMAND KEEPS THE REPRODUCTION FAITHFUL. The production failure is
        CWD-BORNE, not command-borne: `spawnSync` fails while spawning `/bin/sh` in a nonexistent
        working directory, before the command string is ever parsed. So a harmless stand-in command
        reproduces the exact failure with no `gh` binary, no network, no token and no PATH
        manipulation, and returns a valid `[]` payload on success.
      • ASSERT THE ERROR CODE, NEVER THE MESSAGE. Verified 2026-07-30 on darwin: the thrown error
        carries `code === 'ENOENT'` and `syscall === 'spawnSync /bin/sh'` under BOTH runtimes, but the
        MESSAGE differs — node says `spawnSync /bin/sh ENOENT` (the production stack trace) while bun
        says `ENOENT: no such file or directory, posix_spawn '/bin/sh'`. `… fails with a spawn
        working-directory failure` must test `err.code === 'ENOENT'`; a message match would make the
        scenario depend on which runtime `bunx cucumber-js` resolves.
      • OPERATION NAME MAPS. `repo-API` names → `fetch-issue-comments` → `fetchIssueComments(28)`,
        `issue-title` → `issueTitle(28)`, `issue-has-label` → `issueHasLabel(28, 'adw:bug')`,
        `default-branch` → `defaultBranch()`, `issue-state` → `issueState(28)`, `list-open-issues` →
        `listOpenIssues({fields: ['number']})`, `find-pr-by-branch` → `findPRByBranch('feature/x')`,
        `pr-changed-files` → `fetchPRChangedFiles(7)`, `issue-comment` → `commentOnIssue(28, 'body')`
        (stdin-carrying write), `apply-label` → `applyLabel(28, 'adw:bug')`, `authenticated-user` →
        `authenticatedUser()`, `board-status-move` → `moveIssueToStatus(28, 'In Progress')`.
        `workspace-git` names → `remote-url` → `remoteUrl()`, `current-branch` →
        `getCurrentBranch(worktreePath)`. `board-status-move` swallows parse failures and returns
        `false`, so with a canned recorder response it stops after its first command
        (`projectQueryCmd(owner, repo)`) — which is the one whose cwd is under test.
      • SINGULAR VS PAIRED ASSERTIONS. `the recorded repo-API command …` and `the recorded
        workspace-git command …` assert against the MOST RECENT recorded call of that kind, so §3 can
        combine the paired assertion (`both recorded repo-API commands …`, comparing the two recorded
        cwds) with the singular ones in one scenario. Every other scenario records exactly one call of
        the kind it asserts on.
      • THE CHDIR STEP (§5, §8) must `process.chdir` to a third temp dir — distinct from both the
        framework root and the target workspace — and restore the original cwd in `After`
        (feature-769's precedent).
      • `… still addresses the repository {string}` asserts the recorded COMMAND STRING contains
        `owner/repo` (the recorded command is part of the same runtime artefact as the recorded cwd, so
        this stays a recorded-call assertion and never a source read). Only asserted for
        `fetch-issue-comments`, whose command carries `repos/{owner}/{repo}/…`; it is deliberately NOT
        an outline assertion, because `authenticated-user` (`gh api user`) addresses no repository at
        all and the GraphQL builders carry identity as variables rather than in a path.
      • T22 (`the ADW TypeScript type-check passes`) is reused, not redefined — redefining it would be
        an AmbiguousStepDefinition. It currently lives in `feature-504.steps.ts:1126`, inside the
        14-day per-issue TTL sweep's reach; that coupling is feature-769's open item, not this
        issue's, and is re-surfaced in the Output.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE CRASH IS GONE — a repo-API fetch works pre-clone (Symptom; DB 3) ─────────────
  #
  # The headline, and a faithful reproduction of the production incident: a registered target repo,
  # a host that has never cloned its workspace, and the very call that crashed the webhook server.
  # RED before with the exact production failure mode (spawn working-directory error, `ENOENT`);
  # GREEN after, returning the payload.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario: The issue-comments fetch succeeds on a host that has never cloned the target repository's workspace
    Given a target repository "acme/webapp" registered on a host that has never cloned its workspace
    And the context's spawned commands are recorded and then really spawned with a harmless stand-in command
    When the issue comments for issue 28 are fetched through the context
    Then the repo-API operation completes without a spawn working-directory failure
    And the repo-API operation returns the stand-in command's output

  # ── §2 NO REGRESSION ON A HOST THAT HAS CLONED THE WORKSPACE ────────────────────────────
  #
  # The other half of the host-state matrix: the fix must not trade a broken pre-clone host for a
  # broken post-clone one. GREEN before and after — the guard that keeps §1's fix honest.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario: The issue-comments fetch still succeeds on a host whose target workspace has been cloned
    Given a target repository "acme/webapp" registered on a host that has already cloned its workspace
    And the context's spawned commands are recorded and then really spawned with a harmless stand-in command
    When the issue comments for issue 28 are fetched through the context
    Then the repo-API operation completes without a spawn working-directory failure
    And the repo-API operation returns the stand-in command's output

  # ── §3 THE SPAWN CWD IS WORKSPACE-INDEPENDENT (DB 1, "instead of") ──────────────────────
  #
  # The design half, and the reason this is filed as a design bug rather than a missing directory:
  # the repo-API spawn cwd must not vary with workflow-lifecycle state at all. The same operation is
  # performed twice — once pre-clone, once after the workspace appears — and must record the same
  # working directory both times, AND that directory must be one that exists and is not the
  # workspace. The three assertions are load-bearing together: invariance alone is satisfied by the
  # unfixed code (which records basePath both times), and existence alone is satisfied by a "probe
  # basePath, fall back when missing" implementation — which would pass §1, §2 and §4 while leaving
  # the spawn cwd varying with lifecycle state, i.e. the design bug intact. The pair is what
  # forecloses it. RED before on the last two assertions.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario: A repo-API command's spawn working directory does not change when the workspace appears
    Given a target repository "acme/webapp" registered on a host that has never cloned its workspace
    And the context's spawned commands are recorded by a spawn recorder
    When the issue comments for issue 28 are fetched through the context
    And the target repository's workspace directory is created on this host
    And the issue comments for issue 28 are fetched through the context
    Then both recorded repo-API commands ran with the same spawn working directory
    And the recorded repo-API command's spawn working directory exists on disk
    And the recorded repo-API command's spawn working directory is not the target workspace directory

  # ── §4 THE DIRECTORY EXISTS, IS NOT THE WORKSPACE, AND IDENTITY IS UNMOVED (DB 1) ───────
  #
  # The properties the issue actually requires, asserted directly on the recorded spawn parameters
  # rather than through any particular choice of directory. RED before on the first two counts:
  # pre-clone, basePath neither exists nor is anything other than the workspace.
  #
  # The third assertion is what makes moving the cwd safe: identity must come from the COMMAND, not
  # from the directory. Running a gh command inside the framework checkout means any command that
  # would infer its repository from the surrounding git remote silently addresses the FRAMEWORK repo.
  # Every repo-API command must therefore still name the target repo in its own command string.
  # GREEN before and after — the drift guard for future command builders.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario: A repo-API command runs from a directory that exists, is not the target workspace, and still addresses the target repository
    Given a target repository "acme/webapp" registered on a host that has never cloned its workspace
    And the context's spawned commands are recorded by a spawn recorder
    When the issue comments for issue 28 are fetched through the context
    Then the recorded repo-API command's spawn working directory exists on disk
    And the recorded repo-API command's spawn working directory is not the target workspace directory
    And the recorded repo-API command still addresses the repository "acme/webapp"

  # ── §5 IT IS THE INJECTED FRAMEWORK ROOT, NOT THE AMBIENT CWD (PRD "no cwd fallback") ───
  #
  # Which always-exists directory matters: the ambient working directory is the fallback the
  # GitContext PRD bans and the root of the wrong-base-repo class, so "a cwd that always exists"
  # must not be satisfied by `process.cwd()`. Perturbing the process working directory before the
  # operation must leave the recorded spawn cwd on the INJECTED framework root — mandatory config on
  # every context, never derived from the environment at call time.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario: A repo-API command runs from the injected framework repository root even when the process working directory has moved
    Given a target repository "acme/webapp" registered on a host that has never cloned its workspace
    And the context's spawned commands are recorded by a spawn recorder
    And the process working directory is moved to a directory that is neither the framework repository root nor the target workspace
    When the issue comments for issue 28 are fetched through the context
    Then the recorded repo-API command's spawn working directory is the injected framework repository root

  # ── §6 THE WHOLE REPO-API SURFACE, NOT JUST THE CRASH SITE (DB 1) ───────────────────────
  #
  # Breadth. The issue names `fetchIssueComments`, `issueTitle`, `issueHasLabel`, `defaultBranch`,
  # "etc."; the surface is wider and the "etc." is where a partial fix hides. Reads AND writes AND
  # the GraphQL/board query are pure API calls, so all of them must work pre-clone — a Cancel that
  # can be read but not acknowledged is still broken. The last two rows close the gap left by a
  # literal reading of "carries explicit owner/repo in the command string": `gh api user` carries no
  # repo identity at all and the free-form GraphQL command may not either, yet both are the MOST
  # repo-independent calls in the package. RED before on every row.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario Outline: Every repo-API operation runs from a working directory that exists on a host with no cloned workspace
    Given a target repository "acme/webapp" registered on a host that has never cloned its workspace
    And the context's spawned commands are recorded by a spawn recorder
    When the "<operation>" repo-API operation runs through the context
    Then the recorded repo-API command's spawn working directory exists on disk
    And the recorded repo-API command's spawn working directory is not the target workspace directory

    Examples:
      | operation            |
      | fetch-issue-comments |
      | issue-title          |
      | issue-has-label      |
      | default-branch       |
      | issue-state          |
      | list-open-issues     |
      | find-pr-by-branch    |
      | pr-changed-files     |
      | issue-comment        |
      | apply-label          |
      | authenticated-user   |
      | board-status-move    |

  # ── §7 THE TOKEN IS STILL THE TARGET REPO'S (PRD story 2) ───────────────────────────────
  #
  # The anti-bleed guard. The cheapest way to get "a cwd that always exists" is to reach for the
  # self-host context — which would carry the FRAMEWORK's token and blind the call to the target
  # repo, the exact ~13-incident GH_TOKEN-bleed class the PRD exists to kill. Moving the cwd must
  # move nothing else: the command runs from the framework root carrying the TARGET repo's token.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario: A repo-API command run outside the workspace still carries the target repository's own auth token
    Given a target repository "acme/webapp" registered on a host that has never cloned its workspace
    And the context is authenticated with the installation token "token-acme-installation"
    And the context's spawned commands are recorded by a spawn recorder
    When the issue comments for issue 28 are fetched through the context
    Then the recorded repo-API command's spawn working directory is the injected framework repository root
    And the recorded repo-API command carried the auth token "token-acme-installation" in its child environment

  # ── §8 GIT COMMANDS KEEP BASEPATH, AND NEVER THE AMBIENT CWD (DB 2) ─────────────────────
  #
  # The unchanged half of the contract. A git read is genuinely workspace-scoped, so it still runs
  # from the target workspace directory — and, like §5, not from wherever the process happens to sit.
  # GREEN before and after — the guard against a wholesale change to `#run`'s default cwd, and the
  # git half of the no-ambient-cwd contract that §5 pins for the repo-API half.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario: A workspace-scoped git command still runs from the target repository's workspace directory even when the process working directory has moved
    Given a target repository "acme/webapp" registered on a host that has already cloned its workspace
    And the context's spawned commands are recorded by a spawn recorder
    And the process working directory is moved to a directory that is neither the framework repository root nor the target workspace
    When the "remote-url" workspace-git operation runs through the context
    Then the recorded workspace-git command's spawn working directory is the target workspace directory

  # ── §9 WORKTREE-SCOPED COMMANDS KEEP THE SUPPLIED WORKTREE CWD (DB 2) ───────────────────
  #
  # The explicit `opts.cwd` override still wins over both the base path and the framework root: a
  # per-worktree git read runs in the worktree it was given. GREEN before and after.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario: A worktree-scoped git command still runs from the supplied worktree directory
    Given a target repository "acme/webapp" registered on a host that has already cloned its workspace
    And the context's spawned commands are recorded by a spawn recorder
    When the "current-branch" workspace-git operation runs through the context for the worktree of branch "feature-issue-775-x"
    Then the recorded workspace-git command's spawn working directory is the worktree directory for branch "feature-issue-775-x"

  # ── §10 A GIT READ PRE-CLONE STILL FAILS — NEVER ANSWERED FROM THE FRAMEWORK CHECKOUT ───
  #
  # The dangerous over-fix, pinned as behaviour. Changing `#run`'s DEFAULT cwd instead of routing
  # only the repo-API commands would make every git op read branches, remotes and worktrees out of
  # the FRAMEWORK repo while believing it was reading the target's — a silent wrong-repo answer,
  # strictly worse than the crash being fixed. On a host with no clone, a git read must still fail,
  # and no command may have run in the framework root. GREEN before and after.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario: A git read on a host with no cloned workspace still fails instead of answering from the framework checkout
    Given a target repository "acme/webapp" registered on a host that has never cloned its workspace
    And the context's spawned commands are recorded and then really spawned with a harmless stand-in command
    When the "remote-url" workspace-git operation runs through the context
    Then the workspace-git operation fails with a spawn working-directory failure
    And no recorded command ran with the injected framework repository root as its spawn working directory

  # ── §11 SELF-HOST IS UNCHANGED ──────────────────────────────────────────────────────────
  #
  # For a self-host context `basePath === frameworkRepoRoot`, so this fix is structurally a no-op
  # there. Asserted so the change cannot accidentally relocate self-host commands, and so the
  # framework repo's own dogfooded workflows keep spawning where they always have. GREEN before and
  # after.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario: A self-host context's repo-API commands still run from the framework repository root
    Given a self-host framework context for "adw-fixture/framework-fixture"
    And the context's spawned commands are recorded by a spawn recorder
    When the issue comments for issue 28 are fetched through the context
    Then the recorded repo-API command's spawn working directory is the injected framework repository root
    And the recorded repo-API command's spawn working directory exists on disk

  # ── §T Type-check backstop (T22) ────────────────────────────────────────────────────────
  #
  # The retained `frameworkRepoRoot` field and the repo-API/git split at the chokepoint keep the ADW
  # codebase type-clean. Consistent with feature-769 §T.

  @adw-775 @adw-uvv9hm-repo-api-gh-commands
  Scenario: The ADW TypeScript type-check passes with the repo-API spawn working directory decoupled from the workspace
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
