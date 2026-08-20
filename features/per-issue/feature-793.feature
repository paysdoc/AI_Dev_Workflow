@adw-793 @adw-mdtv54-forge-agnostic-core
Feature: The last GitHub conventions leave the git core — the workspace manager clones the URL it is handed, bootstrap identity splits into generic git reads and GitHub derivation, and the two worktree operations log through an injected port instead of importing ADW's logger

  Issue #793 is the fourth slice of the GitContext forge-agnostic refactor
  (`specs/prd/gitcontext-forge-agnostic-refactor.md`) and the one that finishes the CORE side of the
  phase. #790 promoted the private spawn chokepoint to a public forge-neutral executor. #791 replaced
  the construction-time credential with a TokenProvider port resolved per command. #792 moved the gh
  command builders, App authentication and token resolution into the GitHub forge adapter
  (`adws/providers/github/`) and closed the guard's exempt set to exactly two named packages. What is
  left is smaller, but it is what still makes the package unpublishable as `@paysdoc/gitcontext`:
  three GitHub conventions and one application dependency, none of which pass through the seams the
  three previous slices built.

  WHAT IS STILL FORGE-SHAPED, AND WHERE:

    • `repoWorkspace.ts:62-67` — `convertToSshUrl`. The workspace manager rewrites the clone URL
      before cloning: `https://github.com/o/r` becomes `git@github.com:o/r.git`, via two `github.com`
      literals and a call into the GitHub remote parser. A forge-neutral workspace manager clones
      what it is given; deciding that a GitHub HTTPS URL should be cloned over SSH is forge policy and
      belongs to whoever knows the forge.
    • `bootstrapIdentity.ts:42-45` — `HTTPS_REMOTE_RE` and `SSH_REMOTE_RE`, the GitHub remote-URL
      parser (including the SCP-style `git@github.com:owner/repo` form). `github.com` is written into
      both patterns.
    • `bootstrapIdentity.ts:125-133, 152-157` — GitHub App bot-identity derivation
      (`${appSlug}[bot]`, `${appId}+${appSlug}[bot]@users.noreply.github.com`) reading
      `GITHUB_APP_ID` / `GITHUB_APP_SLUG` / `GITHUB_APP_PRIVATE_KEY_PATH` straight out of the
      environment, plus the built-in fallback `ADW Bot <adw-bot@users.noreply.github.com>` — another
      `users.noreply.github.com` literal. The generic half of the same function — `GIT_AUTHOR_*` /
      `GIT_COMMITTER_*` environment reads and `git config user.name` / `user.email` — is exactly the
      kind of git-native resolution the core SHOULD own. The function is one resolver doing two jobs.
    • `worktreeCreateOps.ts:6` and `worktreeRemoveOps.ts:7` — `import { log } from '../core/utils'`.
      Two files, one import each, and they are the only reason the core package cannot be lifted out
      of this repository: they reach up into the host application for its logger.

  THE SHAPE THIS SLICE PRODUCES:

      clone URL:   boundary prepares the URL  →  core clones exactly what it was handed
      identity:    core reads git config      →  adapter derives forge conventions on top
      logging:     core reports to a port     →  boundary supplies ADW's logger; default is console

  WHAT MUST NOT CHANGE (AC4, and PRD story 24 — "the refactor is invisible in production"): ADW must
  still clone target repositories over SSH, must still commit as the App's bot identity when an App
  is configured, must still fall back through `GIT_AUTHOR_*` → `git config` → `ADW Bot
  <adw-bot@users.noreply.github.com>` in that order, and must still print worktree progress in the
  ADW log format. Every one of those is a scenario below, because the cheap way to satisfy "no
  `github.com` in the core" is to delete the behaviour rather than relocate it, and a deletion passes
  every AC in this issue except the fourth.

  THE BEHAVIOURAL CONTRACT PINNED BELOW:

     1. THE WORKSPACE MANAGER CLONES THE URL IT WAS HANDED (AC1). Whatever URL arrives, that exact
        string appears in the `git clone` command — no rewriting, no scheme translation, no
        forge-conditional branch. RED before for every GitHub HTTPS form, which is silently rewritten
        to SSH today.
     2. THE FETCH PATH NEVER CONSULTS THE CLONE URL (AC1). An already-cloned workspace fetches and
        reads its default branch; handing it an unusable clone URL changes nothing, because nothing
        in that path interprets one. GREEN before and after — the pin that says the URL is data, not
        input to a decision.
     3. ADW STILL CLONES OVER SSH (AC4). The rewrite MOVED; it was not deleted. The ADW path that
        turns a repository's published clone URL into the URL the core is handed still produces
        `git@github.com:owner/repo.git` — including the dotted-name case #779 fixed. GREEN before and
        after, and the single most important scenario in this file: it is what separates a relocation
        from a regression.
     4. WORKSPACE CLONE AND FETCH BEHAVIOUR IS OTHERWISE UNTOUCHED (AC4). Absent workspace → clone,
        return its path; present workspace → fetch, read default branch, never re-clone.
     5. THE CORE'S IDENTITY RESOLUTION IGNORES FORGE APP CONFIGURATION (AC1). With App variables
        exported in the environment, the core resolves the identity git itself would use — the
        `GIT_AUTHOR_*` variables, or `git config`. RED before: the App branch wins today and returns
        a `[bot]` identity no git config asked for.
     6. THE CORE NEVER ANSWERS WITH A FORGE ADDRESS (AC2). With nothing configured at all, no field
        of whatever the core produces carries a forge host. RED before: the built-in default is
        `adw-bot@users.noreply.github.com`.
     7. THE FORGE BOT IDENTITY STILL DERIVES, AT THE GITHUB BOUNDARY (AC4). App configured → author
        AND committer are `<slug>[bot]` / `<id>+<slug>[bot]@users.noreply.github.com`; and the full
        four-step resolution order — App, then `GIT_AUTHOR_*`, then `git config`, then `ADW Bot
        <adw-bot@users.noreply.github.com>` — answers exactly as it does today. GREEN before and
        after. This is where §5 and §6's deletions have to reappear, or ADW's commits change author.
     8. THE REMOTE PARSE MOVES BUT THE ANSWERS DO NOT (AC1/AC2/AC4). Every remote form still resolves
        to the same owner/repo through the GitHub boundary, dotted names included (#779); a remote on
        another forge is still refused THERE. Meanwhile the core's own origin-remote read hands back
        the URL exactly as git reported it — RED before, because the only pre-context remote read the
        core has today insists the URL is a GitHub one and throws when it is not.
     9. THE WORKTREE OPERATIONS REPORT TO AN INJECTED PORT (AC3). Create and remove both deliver
        their messages, with their levels, to a logger the caller supplied; with a logger injected,
        nothing from the operation reaches the console directly. RED before on both counts — today
        both files call ADW's `log` and an injected port would receive nothing.
    10. WITHOUT A LOGGER, THE CONSOLE IS THE DEFAULT (AC3). The issue specifies a console default;
        an operation run with no logger injected still reports.
    11. THE OPERATOR'S OUTPUT IS UNCHANGED IN PRODUCTION (AC4). A worktree created through a
        context built the way ADW builds one still prints the ADW-formatted line — emoji prefix,
        ISO timestamp, and the `[adwId]` segment that makes concurrent workflows legible in a shared
        terminal. See the risk note below: this scenario deliberately forces a decision.
    12. THE GIT COMMANDS THEMSELVES DO NOT MOVE (AC4). Whatever the logger port does, the worktree
        operations issue exactly the git commands they issue today.

  Risks, near-misses and things the planner must not miss:

    • THE TOUCHED FILES ARE INCOMPLETE, AND EVERY MISSING ONE IS AN IMPORT OF A MOVING SYMBOL. The
      issue lists the four core modules, `types.ts`, `gitContextFactory.ts` and two unit suites. But
      the symbols leaving the core have importers the list does not mention, and each is a build
      break rather than a behaviour question:
        – `adws/core/targetRepoManager.ts:21,37,43` imports and RE-EXPORTS `convertToSshUrl`, and
          `:62-70` is the production caller of `ensureRepoWorkspace`. This is where the rewrite has to
          be applied before the core is handed the URL, so §3 cannot pass without editing this file.
        – `adws/github/githubApi.ts:6,28` imports `parseGitHubRemoteUrl` from `../gitContext`.
        – `adws/core/launchGitContext.ts:22` imports `resolveBootstrapGitIdentity` and `ghAuthToken`
          from `../gitContext`; `:76` is `resolveLaunchGitIdentity`.
        – `adws/gitContext/index.ts:32,35-41` is the export surface both moves have to be removed
          from — and `adws/github/gitContextFactory.ts:87` re-exports `readLocalRepoInfo` for
          downstream importers, one of which is a live step definition
          (`features/per-issue/step_definitions/feature-572.steps.ts:55`). That re-export must
          survive whatever happens underneath it.
        – `features/per-issue/step_definitions/feature-779.steps.ts:21-22` imports `readLocalRepoInfo`
          AND its `RepoInfo` type directly from `adws/gitContext/bootstrapIdentity.ts`. If the file
          stops exporting them, cucumber fails at IMPORT time and the entire regression run dies —
          not one scenario, all of them. AC4 says "full suite green"; this is the likeliest way to
          break it.
    • THE PARSE CANNOT SIMPLY MOVE — IT HAS TO SPLIT, AND THE GUARD DECIDES WHERE THE SEAM GOES.
      `readLocalRepoInfo` does two things: runs `git remote get-url origin` (a git command — after
      #792 only `adws/gitContext` may issue one) and parses GitHub owner/repo out of the result (a
      forge convention — only the adapter should know it). So the raw read STAYS in the core and the
      parse moves; the adapter composes them. §8's third scenario pins the core half, and it is
      phrased around the read rather than around a function name for exactly this reason.
    • `ghAuthToken` IS NOT COVERED BY ANY ACCEPTANCE CRITERION, AND IT SHOULD BE RAISED, NOT SILENTLY
      MOVED. `bootstrapIdentity.ts:91-100` shells out to `gh auth token` — a GitHub CLI invocation
      sitting in the core, in a file this issue touches. It carries no `github.com` literal, so AC2
      does not catch it, and it is not identity derivation, so the "What to build" text does not
      either. But #792's stated guard meaning is "only the git core may run git; only the GitHub
      adapter may issue gh", and all three consumers (`launchGitContext.ts:67,91`,
      `gitContextFactory.ts:52`, `tokenResolver.ts:25`) already take it as an injected seam, so the
      move is cheap. This file does NOT pin it — that is the planner's call — but leaving it means
      the core still runs a forge CLI after the slice that was supposed to end that.
    • AC3 CANNOT BE MET LITERALLY IN THIS SLICE, AND THAT IS BY DESIGN, NOT BY OVERSIGHT.
      "Core has zero imports from ADW application code" reads absolutely, but `gitContext.ts:70-87`
      still imports the adapter's command builders under an explicit TRANSITIONAL comment: #792's AC1
      kept the semantic methods in the core, so the core depends upward on the adapter until the
      caller migration (#796/#797) removes those methods. The two logger imports are the ones this
      slice can remove, and the parenthesised "(logger injected)" in the AC is what it actually asks
      for. §9 pins the logger; nothing here pins the builder imports.
    • §11 DELIBERATELY FORCES A DECISION THE ISSUE LEAVES OPEN. "An injected logger port with a
      console default" does not say who injects in production. If nobody does, every worktree line
      ADW prints loses its emoji, its timestamp and its `[adwId]` tag — which is an operator-visible
      change in a refactor whose PRD story 24 says workflows behave identically, and AC4 says worktree
      behaviour is unchanged. §11 therefore requires the production path to keep the ADW format. If
      the plan decides operator output may change, §11 must be struck deliberately and the reasoning
      recorded — it must not go green by accident.
    • THE CHEAP WRONG FIX FOR §1 IS TO DELETE THE REWRITE. Every GitHub HTTPS row of §1 passes the
      moment `convertToSshUrl` stops being called. §3 is the counterweight: production must still end
      up cloning `git@github.com:…`. Neither section is meaningful without the other.
    • THE CHEAP WRONG FIX FOR §6 IS TO CHANGE THE DEFAULT ADDRESS IN PLACE. Rewriting
      `adw-bot@users.noreply.github.com` to something neutral inside the core satisfies §6 and breaks
      §7's fourth row, where ADW must still fall back to that exact identity. The default has to be
      supplied by whoever knows the forge, not edited out of existence.
    • WHAT THIS FILE DOES NOT RE-PIN. #790 owns the executor's working-directory classes, stdin and
      missing-directory rewrap; #791 owns per-command credential resolution; #792 owns the command
      builders, App authentication and the two-package guard; #777 owns the missing-workspace error
      surface (its §3 asserts a clone is recorded into the workspace DIRECTORY, not the URL form, so
      it stays green under §1); #779 owns dotted-name identity resolution through
      `readLocalRepoInfo` and `getRepoInfo`; #658 owns mandatory identity at construction. All stay
      green and unmodified. This file pins only what moves: who prepares the clone URL, who derives
      forge identity, and where the core's log lines go.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md` configures a
      `## Regression Scenario Directory`, so promotion is a deliberate human decision and this agent
      never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here. The registry has no phrase for a workspace clone URL, a git
    identity resolution, a remote-URL read or a logger port. Every phrase below is deliberately
    DISTINCT from its neighbours in the GitContext family, because all per-issue step definitions load
    into one global cucumber registry (`cucumber.js` imports
    `features/per-issue/step_definitions/**/*.ts`) and a verbatim reuse would bind to another file's
    world, which this file's Givens never populate. Specifically: feature-777 says `a target workspace
    repository {string} that has never been cloned on this host` / `the workspace-ensure flow runs for
    the repository`, so this file says `a workspace manager for the repository {string} …` / `the
    workspace is ensured for that repository`; feature-779 says `a local clone whose origin remote is
    {string}` / `the local repository identity is read from that clone`, so this file says `a local
    checkout whose origin remote URL is {string}` / `the origin remote URL is read through the core`;
    feature-790 says `the context's spawn seam records every command` and feature-791 says `the spawn
    seam records every command with the credential it carried`, so this file says `the worktree spawn
    seam records the commands it is given`. Surfaced to the maintainer in the agent Output:
      • `a workspace manager for the repository {string} with no local clone present`
      • `a workspace manager for the repository {string} whose local clone is already present`
      • `the clone URL handed to the workspace manager is {string}`
      • `the workspace manager records the commands it runs`
      • `an ADW target repository {string} that publishes the clone URL {string}`
      • `the core identity resolution sees the environment:`
      • `the core identity resolution sees a git config of {string}`
      • `the core identity resolution sees no git config at all`
      • `the GitHub identity resolution sees the environment:`
      • `the GitHub identity resolution sees a git config of {string}`
      • `the GitHub identity resolution sees no git config at all`
      • `a local checkout whose origin remote URL is {string}`
      • `a git context for the repository {string} with a logger injected`
      • `a git context for the repository {string} with no logger injected`
      • `the worktree spawn seam records the commands it is given`
      • `the console output of the run is captured`
      • `a production-built git context over a real local repository`
      • `the ADW workflow id is set to {string}`
      • `the workspace is ensured for that repository`
      • `the target repository workspace is ensured the way ADW ensures it`
      • `the core resolves a git identity`
      • `the GitHub boundary resolves a git identity`
      • `the origin remote URL is read through the core`
      • `the repository identity is derived from that checkout through the GitHub boundary`
      • `the resolved identity is carried into a git command by a context`
      • `the worktree for branch {string} is ensured through the context`
      • `the worktrees for issue {int} are removed through the context`
      • `the recorded clone command carries the clone URL {string}`
      • `the recorded clone command is exactly {string}`
      • `no clone command was recorded`
      • `the recorded workspace commands are exactly {string}`
      • `the default-branch reader was consulted`
      • `the workspace path returned is the repository's directory under the target repositories root`
      • `the resolved git identity is {string} for both author and committer`
      • `the core answered with no forge address`
      • `the derived identity is owner {string} and repository {string}`
      • `deriving the repository identity fails rather than returning a forge identity`
      • `the core read returns the remote URL {string} unchanged`
      • `the git command spawned with author {string} and committer {string} in its environment`
      • `the injected logger received a message containing {string}`
      • `the injected logger received a message containing {string} at level {string}`
      • `the captured console output contains {string}`
      • `the captured console output carries no message from the operation`
      • `the captured console output carries an ADW-formatted line containing {string}`
      • `the recorded worktree commands are exactly:`

    Step-definition note for the maintainer (feature-793.steps.ts):

      • FOUR BINDING POINTS, ONE HELPER EACH. This slice's function names are the planner's to choose,
        so every scenario is phrased around behaviour and exactly four module-private helpers know
        which function is called: (1) the core workspace manager (today
        `ensureRepoWorkspace(owner, repo, cloneUrl, deps)` in `adws/gitContext/repoWorkspace.ts`);
        (2) the core identity resolver (today `resolveBootstrapGitIdentity({env, exec})` in
        `adws/gitContext/bootstrapIdentity.ts`; the plan splits it, so this helper becomes a
        COMPOSITION of the two readers the core keeps — the `GIT_AUTHOR_*` / `GIT_COMMITTER_*` read
        first, then the `git config user.name` / `user.email` read, each returning a complete
        identity or nothing); (3) the GitHub identity resolver (today the same function, reached
        through `adws/github/gitContextFactory.ts`; after the split, the adapter's);
        (4) the ADW clone-URL preparation (today `convertToSshUrl`, re-exported from
        `adws/core/targetRepoManager.ts:37`). If the plan renames or relocates any of them, four
        helpers change and no scenario does.
      • REUSE `gitContextSharedWorld.ts` for the context-based sections — `FRAMEWORK_ROOT`,
        `TARGET_REPOS_ROOT`, `makeFullOptions`, `makeNoOpFsDeps`, `makeSpyExec`, `parseAuthor` — and
        keep issue-793 bookkeeping (the workspace recorder, the identity fixtures, the logger sink,
        the console capture) in a module-private world, as feature-790.steps.ts does with `w790`.
      • THE WORKSPACE RECORDER IS NOT `makeSpyExec`. `ensureRepoWorkspace` takes `WorkspaceExecFn`
        (`(cmd, {cwd, stdio, encoding}) => void`), a different seam from `ExecFn`. Record
        `{command, cwd}` exactly as `feature-777.steps.ts:238-240` already does, and pass
        `fsDeps: {existsSync, mkdirSync}` to choose the clone branch (`existsSync: () => false`) or
        the fetch branch (`existsSync: (p) => String(p).endsWith('.git')`). Nothing here spawns.
      • §3 COMPOSES RATHER THAN CALLING `ensureTargetRepoWorkspace`, ON PURPOSE. That function
        (`targetRepoManager.ts:62-70`) builds a real `gitContextForRepo`, whose construction probe
        resolves a real credential (App mint / PAT / `gh auth token`), and then runs the workspace
        manager with the REAL `execSync` — i.e. it would clone for real, into the real
        `TARGET_REPOS_DIR`. The step must therefore compose ADW's clone-URL preparation with the core
        workspace manager under the recording seam — the same two calls production makes, minus the
        credential and the spawn. State that in the step file's header so nobody "fixes" it later by
        calling the production function.
      • THE IDENTITY STEPS INJECT `env` AND `exec`, NEVER `isAppConfigured`. The core resolver's
        default `isAppConfigured` reads the App variables out of the injected `env`
        (`bootstrapIdentity.ts:121-123`), so passing the App variables and letting the resolver decide
        for itself is what makes §5 RED today. Injecting `isAppConfigured: () => false` would make it
        pass vacuously, and after the split the core resolver will not accept that dep at all.
        `the … identity resolution sees a git config of "Name <email>"` → an `exec` fake answering
        `git config user.name` / `git config user.email`; `… sees no git config at all` → an `exec`
        that throws, exactly as `bootstrapIdentity.test.ts:171` does. Empty Examples cells mean the
        variable is absent from the environment, not present and empty.
      • `the core answered with no forge address` ACCEPTS TWO OUTCOMES, deliberately and by contract:
        either an identity was returned and no field of it contains a forge host (`github.com`), or
        the core declined to answer at all (returned nothing / threw). Both satisfy "no forge string
        can come out of the core", and the pin holds whether the plan keeps a neutral default in the
        core or pushes the default out to the adapter. The plan takes the second: neither core reader
        supplies a fallback, so with nothing configured the core answers with nothing, and the
        `ADW Bot <adw-bot@users.noreply.github.com>` default lives in the adapter where §7's fourth
        row expects it. It is RED today either way, because today's answer is
        `ADW Bot <adw-bot@users.noreply.github.com>`.
      • `the resolved git identity is {string} for both author and committer` parses
        `Name <email>` with `gitContextSharedWorld.parseAuthor` and asserts all FOUR fields — author
        name/email and committer name/email. The App branch sets committer equal to author today
        (`bootstrapIdentity.ts:131`) and §7 is where that has to survive the move.
      • §7's CHILD-ENVIRONMENT SCENARIO COMPOSES the boundary resolution with a spy-exec context:
        resolve the identity through helper (3), build a `GitContext` over `makeSpyExec` carrying it,
        run one operation, and read `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_NAME` /
        `GIT_COMMITTER_EMAIL` off the recorded call. `commandEnv` (`gitContext.ts:227-236`) is the
        thing under observation only incidentally — what is pinned is that a SPLIT identity still
        reaches git.
      • §8's CHECKOUT STEPS BUILD A REAL THROWAWAY REPO — `git init` plus `git remote add origin
        <url>`, both purely local, in a `mkdtempSync` directory, exactly as `feature-779.steps.ts`
        does. Do not re-implement the parse in the step; call the real functions. Clean the temp
        directory up in `After`.
      • THE LOGGER SINK is an array of `{message, level}` pushed by the injected logger. Drive the
        create side with `ctx.ensureWorktree('feature-issue-793-x')`: under `makeSpyExec`'s default
        `'main\n'` stdout the branch resolves as existing and not checked out elsewhere, so
        `git worktree add` runs and the operation logs a `success` message, followed by two `info`
        messages from `copyEnvToWorktree` (`makeNoOpFsDeps`'s `existsSync: () => false` takes the
        "no file found, skipping copy" branch — assert on the `skipping copy` substring, never on the
        environment-file name). Drive the remove side with `ctx.removeWorktreesForIssue(793)`: the
        default stdout contains no `worktree ` lines, so nothing matches,
        `killProcessesInDirectory` is never reached, and the operation logs its
        "No worktrees found matching issue #793" message at `info`. Both paths are deterministic and
        spawn nothing.
      • THE CONSOLE CAPTURE stubs `console.log` into an array in the Given and restores it in `After`
        — never leave it stubbed, or every later scenario's diagnostics vanish. `the captured console
        output carries no message from the operation` asserts that no captured line contains the
        operation's message text, not that the array is empty, so an unrelated library line does not
        fail the scenario.
      • §11 IS THE ONE SCENARIO THAT TOUCHES A REAL REPOSITORY. Build the context the way ADW builds
        one — `buildLaunchGitContext` with `frameworkRepoRoot` pointed at a `mkdtempSync` git repo
        (one commit), an injected `tokenProvider` and an injected `getRepoInfo`, so no credential is
        minted and no network is touched (`LaunchGitContextDeps` already exposes all three) — call
        `setLogAdwId('mdtv54')` first, capture `console.log`, run a real `ensureWorktree`, and assert
        the captured line carries the ADW format: an emoji prefix, a bracketed ISO timestamp and
        `[mdtv54]`. Call `resetLogAdwId()` and remove the temp repo in `After`.
      • T22 (`the ADW TypeScript type-check passes`) and G18 (`the ADW codebase is checked out`) are
        REUSED, not redefined — redefining either is an AmbiguousStepDefinition. They live in
        `feature-504.steps.ts:1126` and `features/step_definitions/ensureCronOnEveryEventSteps.ts:8`.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE WORKSPACE MANAGER CLONES THE URL IT WAS HANDED (AC1) ─────────────────────────
  #
  # The headline. `repoWorkspace.ts:87` runs the clone URL through `convertToSshUrl` before cloning,
  # so a caller who hands the core `https://github.com/acme/webapp.git` gets
  # `git@github.com:acme/webapp.git` cloned instead — a forge-specific decision, taken inside a
  # package whose stated destiny is to be published as a forge-neutral library. After the split the
  # core is a courier: the URL it was handed is the URL in the command. RED before on every GitHub
  # HTTPS row; the SSH and non-GitHub rows pass today only because `convertToSshUrl` declines to touch
  # them, which is the forge knowledge in miniature.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario Outline: The workspace clone command carries the clone URL exactly as supplied (<form>)
    Given a workspace manager for the repository "acme/webapp" with no local clone present
    And the clone URL handed to the workspace manager is "<url>"
    And the workspace manager records the commands it runs
    When the workspace is ensured for that repository
    Then the recorded clone command carries the clone URL "<url>"

    Examples:
      | form                     | url                                       |
      | GitHub HTTPS             | https://github.com/acme/webapp            |
      | GitHub HTTPS with suffix | https://github.com/acme/webapp.git        |
      | GitHub HTTPS dotted name | https://github.com/paysdoc/paysdoc.nl.git |
      | GitHub SSH               | git@github.com:acme/webapp.git            |
      | GitLab HTTPS             | https://gitlab.com/acme/webapp.git        |
      | self-hosted forge HTTPS  | https://git.acme.internal/acme/webapp.git |
      | local mirror             | file:///srv/mirrors/acme/webapp.git       |

  # The whole command, not just the URL: the destination directory is the only thing the core adds.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: The clone destination is the only thing the workspace manager adds to the URL it was given
    Given a workspace manager for the repository "acme/webapp" with no local clone present
    And the clone URL handed to the workspace manager is "https://github.com/acme/webapp.git"
    And the workspace manager records the commands it runs
    When the workspace is ensured for that repository
    Then the recorded clone command is exactly "git clone \"https://github.com/acme/webapp.git\" \"/srv/adw/repos/acme/webapp\""

  # ── §2 THE FETCH PATH NEVER CONSULTS THE CLONE URL (AC1) ────────────────────────────────
  #
  # The negative half of §1, and the pin that says the URL is data rather than input to a decision.
  # An already-cloned workspace fetches and reads its default branch through the injected thunk
  # (`repoWorkspace.ts:119-123`); the clone URL is never looked at, so an unusable one changes
  # nothing. GREEN before and after — an implementation that parses the URL "just to validate it"
  # fails here, and that parse would be forge knowledge creeping back in.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: An already-cloned workspace fetches and reads its default branch without consulting the clone URL
    Given a workspace manager for the repository "acme/webapp" whose local clone is already present
    And the clone URL handed to the workspace manager is "not-a-url"
    And the workspace manager records the commands it runs
    When the workspace is ensured for that repository
    Then the recorded workspace commands are exactly "git fetch origin"
    And the default-branch reader was consulted
    And no clone command was recorded

  # ── §3 ADW STILL CLONES OVER SSH (AC4) ──────────────────────────────────────────────────
  #
  # The counterweight to §1, and the difference between a relocation and a regression. ADW clones
  # target repositories over SSH because that is what authenticates on the hosts it runs on; the
  # webhook and cron resolvers hand it whatever GitHub published (`webhookRepoResolver.ts:30`,
  # `orchestratorCli.ts:176` — both HTTPS). Once the core stops rewriting, the ADW path must do it
  # before the core is handed the URL, or every fresh target repository onboards over HTTPS and the
  # refactor is visible in production on day one. The dotted-name row is #779's fix riding along: an
  # anchored regex used to leave `paysdoc/paysdoc.nl` un-rewritten. GREEN before and after.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario Outline: Ensuring a target repository workspace through ADW clones the SSH form of its published URL (<form>)
    Given an ADW target repository "<repo>" that publishes the clone URL "<published>"
    And the workspace manager records the commands it runs
    When the target repository workspace is ensured the way ADW ensures it
    Then the recorded clone command carries the clone URL "<cloned>"

    Examples:
      | form               | repo               | published                                 | cloned                                |
      | HTTPS, no suffix   | acme/webapp        | https://github.com/acme/webapp            | git@github.com:acme/webapp.git        |
      | HTTPS, .git suffix | acme/webapp        | https://github.com/acme/webapp.git        | git@github.com:acme/webapp.git        |
      | HTTPS, dotted name | paysdoc/paysdoc.nl | https://github.com/paysdoc/paysdoc.nl.git | git@github.com:paysdoc/paysdoc.nl.git |
      | already SSH        | acme/webapp        | git@github.com:acme/webapp.git            | git@github.com:acme/webapp.git        |
      | not a GitHub URL   | acme/webapp        | https://gitlab.com/acme/webapp.git        | https://gitlab.com/acme/webapp.git    |

  # ── §4 WORKSPACE CLONE AND FETCH BEHAVIOUR IS OTHERWISE UNTOUCHED (AC4) ─────────────────
  #
  # The regression net named by AC4's first clause. Absent workspace → clone and return the path the
  # rest of ADW resolves worktrees under; present workspace → fetch and never re-clone. GREEN before
  # and after; these are the two branches `repoWorkspace.ts:119-126` chooses between, stated as
  # behaviour so they survive the file being reshaped around them.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: A repository with no local clone is cloned into its workspace directory
    Given a workspace manager for the repository "acme/webapp" with no local clone present
    And the clone URL handed to the workspace manager is "git@github.com:acme/webapp.git"
    And the workspace manager records the commands it runs
    When the workspace is ensured for that repository
    Then the recorded clone command carries the clone URL "git@github.com:acme/webapp.git"
    And the workspace path returned is the repository's directory under the target repositories root

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: A repository that is already cloned is fetched rather than cloned again
    Given a workspace manager for the repository "acme/webapp" whose local clone is already present
    And the clone URL handed to the workspace manager is "git@github.com:acme/webapp.git"
    And the workspace manager records the commands it runs
    When the workspace is ensured for that repository
    Then no clone command was recorded
    And the workspace path returned is the repository's directory under the target repositories root

  # ── §5 THE CORE'S IDENTITY RESOLUTION IGNORES FORGE APP CONFIGURATION (AC1) ─────────────
  #
  # `resolveBootstrapGitIdentity` checks for App variables FIRST (`bootstrapIdentity.ts:125`) and,
  # when it finds them, returns a `<slug>[bot]` identity that overrides everything git itself was
  # told — the issue's "GitHub derivation" in one branch. The core's half is the generic one:
  # `GIT_AUTHOR_*` / `GIT_COMMITTER_*`, then `git config user.name` / `user.email`. With the App
  # variables still exported (they are, on every ADW host), the core must now answer with the git
  # identity and nothing else. RED before on both rows: today the bot identity wins.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: Forge App variables in the environment do not displace the configured git identity
    Given the core identity resolution sees the environment:
      | GITHUB_APP_ID               | 12345         |
      | GITHUB_APP_SLUG             | paysdoc-adw   |
      | GITHUB_APP_PRIVATE_KEY_PATH | /keys/adw.pem |
    And the core identity resolution sees a git config of "Config Bot <config@bot.dev>"
    When the core resolves a git identity
    Then the resolved git identity is "Config Bot <config@bot.dev>" for both author and committer

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: Forge App variables in the environment do not displace the author environment variables
    Given the core identity resolution sees the environment:
      | GITHUB_APP_ID               | 12345         |
      | GITHUB_APP_SLUG             | paysdoc-adw   |
      | GITHUB_APP_PRIVATE_KEY_PATH | /keys/adw.pem |
      | GIT_AUTHOR_NAME             | CI Bot        |
      | GIT_AUTHOR_EMAIL            | ci@test.dev   |
    And the core identity resolution sees no git config at all
    When the core resolves a git identity
    Then the resolved git identity is "CI Bot <ci@test.dev>" for both author and committer

  # ── §6 THE CORE NEVER ANSWERS WITH A FORGE ADDRESS (AC2) ────────────────────────────────
  #
  # AC2 stated as behaviour rather than as a grep over source. With no App, no author variables and
  # no git config, today's core answers `ADW Bot <adw-bot@users.noreply.github.com>` — a GitHub
  # address, minted by the core, for a repository it knows nothing about. After the split it must
  # answer with no forge address at all; whether it answers with a neutral identity or declines to
  # answer and leaves the default to the adapter is the plan's choice, and both satisfy this scenario
  # (see the step-definition note). RED before either way. §7's fourth row is where the ADW default
  # has to reappear.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: With no author configuration at all the core produces no forge address
    Given the core identity resolution sees the environment:
      | ADW_UNRELATED | 1 |
    And the core identity resolution sees no git config at all
    When the core resolves a git identity
    Then the core answered with no forge address

  # The generic half, kept honest: what git config holds is what the core reports, unembellished.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: The core reports the git-config identity exactly as git config holds it
    Given the core identity resolution sees the environment:
      | ADW_UNRELATED | 1 |
    And the core identity resolution sees a git config of "Config Bot <config@bot.dev>"
    When the core resolves a git identity
    Then the resolved git identity is "Config Bot <config@bot.dev>" for both author and committer

  # ── §7 THE FORGE BOT IDENTITY STILL DERIVES, AT THE GITHUB BOUNDARY (AC4) ───────────────
  #
  # Where §5 and §6's deletions must reappear. ADW's commits are attributed to the App's bot identity;
  # if the derivation is deleted rather than moved, every commit ADW makes changes author, which is
  # about as visible as a refactor gets. The four-row outline is the resolution order
  # `bootstrapIdentity.test.ts:124-190` pins today, restated at the boundary so it survives the
  # function moving out from under it — including the fourth row, the `ADW Bot` default whose address
  # §6 forbids the core from owning. GREEN before and after.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: An App-configured boundary still commits as the App's bot identity
    Given the GitHub identity resolution sees the environment:
      | GITHUB_APP_ID               | 12345         |
      | GITHUB_APP_SLUG             | paysdoc-adw   |
      | GITHUB_APP_PRIVATE_KEY_PATH | /keys/adw.pem |
    And the GitHub identity resolution sees a git config of "Should Not Win <nope@bot.dev>"
    When the GitHub boundary resolves a git identity
    Then the resolved git identity is "paysdoc-adw[bot] <12345+paysdoc-adw[bot]@users.noreply.github.com>" for both author and committer

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario Outline: The boundary's identity resolution order is unchanged (<source> wins)
    Given the GitHub identity resolution sees the environment:
      | GITHUB_APP_ID               | <appId>      |
      | GITHUB_APP_SLUG             | <appSlug>    |
      | GITHUB_APP_PRIVATE_KEY_PATH | <keyPath>    |
      | GIT_AUTHOR_NAME             | <authorName> |
      | GIT_AUTHOR_EMAIL            | <authorMail> |
    And the GitHub identity resolution sees <gitConfig>
    When the GitHub boundary resolves a git identity
    Then the resolved git identity is "<identity>" for both author and committer

    Examples:
      | source           | appId | appSlug     | keyPath       | authorName | authorMail  | gitConfig                                | identity                                                          |
      | App              | 12345 | paysdoc-adw | /keys/adw.pem | CI Bot     | ci@test.dev | a git config of "Config Bot <c@bot.dev>" | paysdoc-adw[bot] <12345+paysdoc-adw[bot]@users.noreply.github.com> |
      | author env vars  |       |             |               | CI Bot     | ci@test.dev | a git config of "Config Bot <c@bot.dev>" | CI Bot <ci@test.dev>                                              |
      | git config       |       |             |               |            |             | a git config of "Config Bot <c@bot.dev>" | Config Bot <c@bot.dev>                                            |
      | built-in default |       |             |               |            |             | no git config at all                     | ADW Bot <adw-bot@users.noreply.github.com>                        |

  # The consequence that matters in production: a split identity still reaches git's environment.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: The identity the boundary resolved is carried into the child environment of a git command
    Given the GitHub identity resolution sees the environment:
      | GITHUB_APP_ID               | 12345         |
      | GITHUB_APP_SLUG             | paysdoc-adw   |
      | GITHUB_APP_PRIVATE_KEY_PATH | /keys/adw.pem |
    And the GitHub identity resolution sees no git config at all
    When the GitHub boundary resolves a git identity
    And the resolved identity is carried into a git command by a context
    Then the git command spawned with author "paysdoc-adw[bot] <12345+paysdoc-adw[bot]@users.noreply.github.com>" and committer "paysdoc-adw[bot] <12345+paysdoc-adw[bot]@users.noreply.github.com>" in its environment

  # ── §8 THE REMOTE PARSE MOVES BUT THE ANSWERS DO NOT (AC1/AC2/AC4) ──────────────────────
  #
  # `HTTPS_REMOTE_RE` and `SSH_REMOTE_RE` (`bootstrapIdentity.ts:42-45`) are the SCP-style parsing the
  # issue names, and they carry `github.com` in the pattern itself. They move; the answers do not
  # change, dotted names included — #779's incident was exactly this parse truncating
  # `paysdoc/paysdoc.nl` to `paysdoc/paysdoc` and minting a token for a repository that does not
  # exist. The third scenario is the core's remaining half, and the one that proves a SPLIT rather
  # than a wholesale move: after #792 only `adws/gitContext` may run a git command, so the raw
  # `git remote get-url origin` read cannot follow the parse into the adapter — it stays, and hands
  # back what git said without judging it. RED before: the core's only pre-context remote read insists
  # the URL is a GitHub one and throws when it is not.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario Outline: The GitHub boundary still derives owner and repository from every remote form (<form>)
    Given a local checkout whose origin remote URL is "<remote>"
    When the repository identity is derived from that checkout through the GitHub boundary
    Then the derived identity is owner "<owner>" and repository "<repo>"

    Examples:
      | form               | remote                                    | owner   | repo       |
      | SSH, .git suffix   | git@github.com:paysdoc/paysdoc.nl.git     | paysdoc | paysdoc.nl |
      | SSH, no suffix     | git@github.com:acme/webapp                | acme    | webapp     |
      | HTTPS, .git suffix | https://github.com/paysdoc/paysdoc.nl.git | paysdoc | paysdoc.nl |
      | HTTPS, no suffix   | https://github.com/acme/webapp            | acme    | webapp     |

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: A remote on another forge is still refused by the GitHub boundary
    Given a local checkout whose origin remote URL is "https://gitlab.com/acme/webapp.git"
    When the repository identity is derived from that checkout through the GitHub boundary
    Then deriving the repository identity fails rather than returning a forge identity

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: The core's origin-remote read returns a non-GitHub URL exactly as git reported it
    Given a local checkout whose origin remote URL is "https://git.acme.internal/acme/webapp.git"
    When the origin remote URL is read through the core
    Then the core read returns the remote URL "https://git.acme.internal/acme/webapp.git" unchanged

  # ── §9 THE WORKTREE OPERATIONS REPORT TO AN INJECTED PORT (AC3) ─────────────────────────
  #
  # The application dependency, and the last thing keeping the package in this repository:
  # `worktreeCreateOps.ts:6` and `worktreeRemoveOps.ts:7` both `import { log } from '../core/utils'`.
  # One file each, one import each, sixteen call sites between them. After the port, the caller says
  # where the lines go. RED before on all four: an injected logger receives nothing today, and the
  # lines land on the console whether the caller wanted them there or not. The level travels with the
  # message because ADW's `log` colours errors red and prefixes each level differently
  # (`logger.ts:18-23, 67-71`) — a port carrying only the string quietly flattens operator output.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: Creating a worktree reports its progress to the injected logger
    Given a git context for the repository "acme/webapp" with a logger injected
    And the worktree spawn seam records the commands it is given
    When the worktree for branch "feature-issue-793-x" is ensured through the context
    Then the injected logger received a message containing "feature-issue-793-x"

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: Removing worktrees reports to the injected logger
    Given a git context for the repository "acme/webapp" with a logger injected
    And the worktree spawn seam records the commands it is given
    When the worktrees for issue 793 are removed through the context
    Then the injected logger received a message containing "793"

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: The message level travels with the message to the injected logger
    Given a git context for the repository "acme/webapp" with a logger injected
    And the worktree spawn seam records the commands it is given
    When the worktree for branch "feature-issue-793-x" is ensured through the context
    Then the injected logger received a message containing "feature-issue-793-x" at level "success"
    And the injected logger received a message containing "skipping copy" at level "info"

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: With a logger injected the operation writes nothing to the console itself
    Given a git context for the repository "acme/webapp" with a logger injected
    And the worktree spawn seam records the commands it is given
    And the console output of the run is captured
    When the worktree for branch "feature-issue-793-x" is ensured through the context
    Then the injected logger received a message containing "feature-issue-793-x"
    And the captured console output carries no message from the operation

  # ── §10 WITHOUT A LOGGER, THE CONSOLE IS THE DEFAULT (AC3) ──────────────────────────────
  #
  # The issue specifies "an injected logger port with a console default", so a caller who injects
  # nothing still gets its output — a silent core would be a worse regression than a chatty one, and
  # a mandatory logger would break every existing `new GitContext(…)` call site.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: With no logger injected the worktree operation still reports, to the console
    Given a git context for the repository "acme/webapp" with no logger injected
    And the worktree spawn seam records the commands it is given
    And the console output of the run is captured
    When the worktree for branch "feature-issue-793-x" is ensured through the context
    Then the captured console output contains "feature-issue-793-x"

  # ── §11 THE OPERATOR'S OUTPUT IS UNCHANGED IN PRODUCTION (AC4) ──────────────────────────
  #
  # The scenario the risk note flags as decision-forcing. A console default satisfies §10 while
  # silently dropping the emoji prefix, the ISO timestamp and the `[adwId]` segment that make
  # concurrent ADW workflows readable in one terminal — an operator-visible change inside a refactor
  # whose PRD says workflows behave identically. So the production path must supply ADW's logger
  # rather than fall through to the default. This is the only scenario in the file that touches a
  # real repository: it builds the context the way ADW builds one, over a throwaway git repo, with
  # the credential and the repository identity injected so nothing is minted and nothing is fetched.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: A worktree created through a production-built context still logs in the ADW format
    Given the ADW workflow id is set to "mdtv54"
    And a production-built git context over a real local repository
    And the console output of the run is captured
    When the worktree for branch "feature-issue-793-x" is ensured through the context
    Then the captured console output carries an ADW-formatted line containing "feature-issue-793-x"

  # ── §12 THE GIT COMMANDS THEMSELVES DO NOT MOVE (AC4) ───────────────────────────────────
  #
  # AC4's second clause. Reshaping where the log lines go must not reshape what the operations do:
  # the same commands, in the same order, in the same working directory. This is the pin that catches
  # a "while I am in here" edit to the create/remove flows, which are the flows every orchestrator
  # depends on to get a worktree at all.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: Ensuring a worktree issues the same git commands whether or not a logger is injected
    Given a git context for the repository "acme/webapp" with a logger injected
    And the worktree spawn seam records the commands it is given
    When the worktree for branch "feature-issue-793-x" is ensured through the context
    Then the recorded worktree commands are exactly:
      | git worktree list --porcelain                                                                     |
      | git rev-parse --verify "feature-issue-793-x"                                                      |
      | git worktree list --porcelain                                                                     |
      | git worktree add "/srv/adw/repos/acme/webapp/.worktrees/feature-issue-793-x" "feature-issue-793-x" |

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: Removing worktrees for an issue with no matching worktree issues the same single command
    Given a git context for the repository "acme/webapp" with no logger injected
    And the worktree spawn seam records the commands it is given
    When the worktrees for issue 793 are removed through the context
    Then the recorded worktree commands are exactly:
      | git worktree list --porcelain |

  # ── §T THE TYPE CHECK ───────────────────────────────────────────────────────────────────
  #
  # The moves in this slice are import-graph surgery across six production files and two live step
  # definition files, and the likeliest failure is a dangling import rather than a wrong answer.

  @adw-793 @adw-mdtv54-forge-agnostic-core
  Scenario: The ADW TypeScript type-check passes with the core cleared of forge conventions
    Then the ADW TypeScript type-check passes
