@adw-792 @adw-e2er82-consolidate-github-f
Feature: GitHub knowledge consolidates into the forge adapter — the gh command builders, App authentication and token resolution leave the core, App configuration is injected instead of read from the environment, and the guard's exempt set names exactly two packages

  Issue #792 is the third slice of the GitContext forge-agnostic refactor
  (`specs/prd/gitcontext-forge-agnostic-refactor.md`) and the thickest of the phase — the issue is
  labelled `hitl` for that reason. #790 promoted the package's private spawn chokepoint to a public,
  forge-neutral executor (`gitContext.ts:261`). #791 replaced the construction-time credential with a
  TokenProvider port resolved on every command (`gitContext.ts:217`). Both slices built the seams the
  GitHub material was supposed to move THROUGH. This slice performs the move.

  What is still GitHub-shaped inside the git core today:

    • `adws/gitContext/commands/` — five modules of pure `gh …` string factories (issue, PR, label,
      board, secret). GitHub vocabulary, top to bottom, sitting in a package whose stated destiny is
      to be published as a forge-neutral library.
    • `adws/gitContext/appAuth.ts` — the GitHub App JWT dance and installation-token exchange, which
      reads `process.env` for its own configuration at `:62` (`isGitHubAppConfigured`) and `:75-76`
      (`getInstallationToken` reads `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PATH` directly).
    • `adws/gitContext/tokenResolver.ts` and `adws/gitContext/githubTokenProvider.ts` — the resolution
      order (App mint → PAT → `gh auth token` → loud throw) and the PAT-versus-installation-token
      decision. `githubTokenProvider.ts`'s own header already names this slice as the file's exit.

  The three consolidate into the GitHub forge adapter (`adws/providers/github/`), and the CI guard's
  exempt set becomes exactly two named packages in the SAME change — the git core, which may issue
  git commands, and the adapter, which may issue gh commands. The atomicity matters and is the
  reason the guard is in this issue rather than the next one: today `adws/providers/github/` is not
  exempt (`checkGitGhGuard.ts:46` names one path, `adws/gitContext`), so the first gh call site the
  adapter acquires fails the build. Move without guard change → red build. Guard change without move
  → an exemption granted to a package that has nothing to exempt.

  WHY THE ENVIRONMENT READS ARE THE SHARP PART. `isGitHubAppConfigured()` is a function of ambient
  process state, so the answer to "is the App configured?" depends on which variables happened to be
  exported into whichever process is asking. That is the same shape as the credential defect #791
  just closed one layer up: the module reaches out for its configuration instead of being handed it.
  A library consumer (Pi_Dev_Workflow, PRD story 20) cannot configure an App at all under that
  design except by mutating the process environment — which is exactly the process-global mutation
  every slice of this PRD exists to forbid. Injected configuration makes App identity a value the
  boundary passes, testable without touching `process.env` and impossible to activate by accident.

  The behavioural contract pinned below:

     1. THE EXECUTED COMMANDS ARE UNCHANGED BY THE MOVE (AC1). The regression net. For each forge
        operation the command string reaching the executor is byte-identical to today's. This is the
        criterion the PRD's Testing Decisions name first — "which command string was executed" — and
        it is the only assertion that catches a builder mangled in transit. GREEN before and after,
        deliberately: a relocation that changes a command string is a production incident, not a
        refactor.
     2. ONE BUILDER, NOT A COPY (AC1). The command the context executes for an operation equals the
        string the ADAPTER's builder produces for the same arguments. §1 alone passes if the move was
        a copy-paste that left the core's originals in place and wired nothing to the new ones; this
        row fails that shape the moment the two copies drift. It cannot prove the core's copy was
        deleted — see the observability note — but it is the strongest runtime witness available.
     3. THE CORE CARRIES NO GITHUB CREDENTIAL MACHINERY (AC1). A core context handed a forge-neutral
        provider, running in an ambient environment fully configured for GitHub App authentication,
        performs its commands without one GitHub API request. If App auth were still reachable from
        inside the core, that environment would trigger a mint. GREEN before and a standing guard
        after: it is what fails if the move leaves a convenience import behind.
     4. INJECTED CONFIGURATION IS WHAT AUTHENTICATES (AC2). The ambient environment names one App;
        the adapter's injected configuration names another; the mint is signed for the INJECTED one.
        This is AC2 stated as an experiment rather than as a source-code property, and it is the
        scenario that fails today, where `getInstallationToken` reads `process.env[GITHUB_APP_ID]`
        (`appAuth.ts:75`) and could not see an injected value if it were handed one. RED before.
     5. THE ENVIRONMENT ALONE CANNOT ACTIVATE APP AUTHENTICATION (AC2). The other direction, and the
        sharper one. With the App variables exported but the adapter's App configuration absent, no
        mint is attempted at all and resolution falls through to the next credential in the order. An
        implementation that took injected configuration when present and fell back to reading the
        environment when absent would pass §4 and leave the defect fully intact. RED before —
        `isGitHubAppConfigured()` (`appAuth.ts:62`) answers from the environment and nothing else.
     6. INJECTED CONFIGURATION IS SUFFICIENT ON ITS OWN (AC2). With no App variables in the ambient
        environment whatsoever, injected configuration alone mints. §4 and §5 are both satisfiable by
        an implementation that requires the environment AND the injection; this row requires the
        injection to stand alone, which is what a library consumer actually needs. RED before.
     7. THE MINT STILL ADDRESSES THE REPOSITORY IT WAS ASKED FOR (AC2, the wrong-repo invariant). The
        installation lookup names the asked-for repository, and an App not installed on it fails
        loudly rather than serving a credential bound elsewhere. Injecting the configuration changes
        WHERE the App identity comes from; it must not change WHICH repository the credential is
        bound to. GREEN before and after.
     8. THE CREDENTIAL STILL NEVER TOUCHES A COMMAND LINE (#780 regression guard). The bearer travels
        on curl's `--config` stdin channel, never as an argument, so it cannot surface in a thrown
        subprocess error or in the process table. `appAuth.ts:169-176` is the code that guarantees it
        and this slice relocates that file wholesale. GREEN before and after — a security property
        that survives a move only if someone is watching it.
     9. MINT FAILURES STAY DIAGNOSABLE AND SANITISED (regression guard). A failing lookup still names
        the operation, the repository and the HTTP status, and still discloses no credential. Same
        rationale as §8: this is behaviour #780 paid for, being carried across a package boundary.
    10. THE EXPIRY-AWARE MINT CACHE SURVIVES THE MOVE (AC1 + the reason #791 left it alone). #791
        deliberately kept the only cache on the credential path inside App auth, where an
        expiry-aware cache belongs, and put none in the core or the provider. Per-command resolution
        (#791 §2) means a single `commitChanges` now asks three times; without this cache that is
        three JWT signatures and up to six GitHub API round trips per commit. A move that dropped
        the module-level cache would pass every other scenario here and quietly multiply ADW's
        GitHub API traffic by the number of commands it runs. Two directions: a second request
        inside the refresh window issues nothing further; a credential already inside the five-minute
        refresh buffer (`appAuth.ts:41`) is exchanged again.
    11. EVERY GH COMMAND REACHES THE CORE EXECUTOR (AC3). Each forge operation's result is derived
        from what the injected command seam answered — a direct spawn cannot see a canned answer, so
        an operation that bypassed the executor would return the real gh output or fail, never the
        fixture's. This is "the adapter never spawns processes itself" stated as something a test can
        actually observe. GREEN before and after; the risk is the move introducing a shortcut, not
        the current code having one.
    11a. THE ADAPTER'S OWN GH CALL SITE ROUTES THROUGH THE EXECUTOR (AC3). §11 pins the discipline
        for the forge operations the CORE still owns — the semantic methods AC1 defers. AC3 is a
        claim about the ADAPTER: "the adapter's gh call sites feed command strings into the core
        executor — the adapter never spawns processes itself" (issue, What to build). So the same
        properties are pinned one level in, at a gh command issued FROM the adapter: it is answered
        by the seam, and it runs from the framework root it inherits rather than one it re-derives.
        The board row carries the second half — the credential purpose travels with the command, so
        a Projects V2 write still asks for the alternate identity the PAT path requires. RED before:
        the adapter has no sanctioned route to a command today, which is why it borrows the core's
        semantic methods.
    12. THE WORKING-DIRECTORY CONTRACT IS INHERITED, NOT REIMPLEMENTED (AC3). Repository-independent
        gh commands still run from the framework root even when the process working directory has
        moved elsewhere — the contract #790 preserved as a forge-neutral cwd class (PRD story 16),
        and the reason directive handling works on hosts that never cloned the target workspace. An
        adapter that assembled its own spawn would have to re-derive this and would get it wrong.
        GREEN before and after.
    13. THE CREDENTIAL ENVIRONMENT IS THE CORE'S, ASSEMBLED PER COMMAND (AC3). Adapter commands carry
        the credential the port resolved and the git identity the context holds, and the run mutates
        no process environment variable. Spawn discipline is what AC3 says the adapter inherits;
        this is that discipline named item by item.
    14. A REFUSED EXECUTION IS NOT RETRIED THROUGH ANOTHER SPAWN (AC3, the anti-fallback proof). With
        a seam that refuses everything, the operation fails and nothing runs. §11 proves the executor
        is reached; only this proves there is no SECOND path to a child process to fall back on when
        the first one fails — which is exactly where a "just shell out here" shortcut survives code
        review.
    15. A GH CALL SITE IN THE ADAPTER PASSES THE GUARD (AC4). The load-bearing RED of the guard half,
        and the reason the guard change cannot land in a later PR: today `adws/providers/github/` is
        an ordinary package and a gh command string handed to the executor from it fails the build.
    16. A GIT CALL SITE IN THE GIT CORE PASSES THE GUARD (AC4). The half of the exempt set that must
        not be lost while the other half is added. GREEN before and after.
    17. A THIRD PACKAGE FAILS, HOWEVER GITHUB-SHAPED ITS PATH (AC4). "Exactly two packages" is a claim
        about a closed set, so it is worth testing against the near misses that a sloppy predicate
        would admit: `adws/github/` (the name contains "github"), `adws/providers/repoContext.ts`
        (one directory above the adapter), `adws/providers/gitlab/` (the adapter's sibling), and an
        ordinary consumer. A `startsWith('adws/providers')` or a `includes('github')` test passes
        AC4's headline and silently opens the chokepoint to half the codebase. Both command kinds are
        covered: git from a third package fails too.
    18. THE EXEMPTION FOLLOWS CALL SITES, NOT MENTIONS (AC4, the over-fire guard). "Pure string
        builders never trip the shell-out rule" — PRD, verbatim. A module that only RETURNS gh
        strings and never hands one to a call is legal wherever it lives, because the rule inspects a
        call's first argument. Without this row a guard tightened to satisfy §17 by pattern-matching
        the text "gh " would pass every other scenario in this file and fail the build on any module
        that so much as names a gh command. GREEN before and after.
    19. THE WHOLE REPOSITORY IS GREEN (AC4, the ratchet). `bun run lint:git-guard` exits 0 after the
        move, with the two-package exempt set in force AND the core's semantic methods — explicitly
        pending migration per AC1 — still issuing gh. See the scope note on story 9: this is the
        scenario that decides how literally "which package may issue which kind" can be enforced in
        THIS slice.
    20. TYPE-CHECK BACKSTOP (T22). Every import path that moved, every injected-configuration type,
        and every consumer of a relocated builder has to agree.

  Mapping onto the issue's acceptance criteria:
    AC1 (builders, App auth and token resolution live in the adapter; core keeps only the semantic
        methods pending migration) → §1, §2, §3, §10, and §19 for the "pending migration" half.
        The physical-location half has no runtime witness — see the observability note.
    AC2 (App auth reads no process.env directly; configuration is injected) → §4, §5, §6, with §7,
        §8 and §9 as the regression net across the move.
    AC3 (adapter issues gh only through the core executor; no direct spawns) → §11, §11a, §12,
        §13, §14.
    AC4 (exempt set names exactly the two packages; lint green; a gh call site in any third package
        fails) → §15, §16, §17, §18, §19.
    AC5 (relocated tests green in their new home; full suite green) → NOT a scenario. Following
        feature-790's precedent for the identical criterion, "full suite green" is a plan VALIDATION
        command (`bun run test:unit`): a scenario shelling out to the whole unit suite would be slow,
        circular, and would assert nothing this file does not already assert. "Green in their new
        home" is a statement about where test files live, which is a source-structure fact — the
        behaviours those suites cover (resolution order, command strings, App auth) are mirrored
        here, in §1, §2 and §4 through §10, so a relocation that broke one of them fails this file
        regardless of where the vitest files ended up. §20 is the compile-time backstop.

  Observability / rot-prevention note:

    Every assertion targets an artefact the system PRODUCES: the `(command, cwd, env)` tuple handed
    to the injected command seam (vocabulary surface #2, recorded calls), the `(argv, stdin config)`
    pair handed to the injected GitHub API seam, the value a public method returns, the error it
    raises, the guard's violation list and exit status over a throwaway fixture repository (surfaces
    #4 and #5), and the type-checker's exit status. No step reads a framework source file as text,
    substring-matches its contents, or parses it as JSON/AST. The fixture sources written under §15
    through §18 are INPUTS the step itself authors into a temp directory — the system under test
    consumes them, exactly as the `G-HC*` hash-computer fixtures do — never framework source.

    THE ONE CRITERION WITH NO RUNTIME SHADOW, SAID OUT LOUD: "the builders, App auth and token
    resolution LIVE IN the adapter package" is a claim about which directory holds which file. A
    scenario that asserted it would have to read the filesystem, which the rot rubric forbids and
    which would break on any later rename — and this code is scheduled to move again in Phase B.
    Three partial witnesses carry it instead: §2 (the executed command comes from the adapter's
    builder), §4 through §6 (App configuration arrives by injection, which is the behavioural
    consequence of the move that actually matters), and §15 through §19 (the guard, which is the
    project's chosen structural enforcement for exactly this class of claim — PRD story 7: "so that
    the discipline is structural rather than conventional"). The residual gap is real: a copy left
    behind in the core, imported by nothing, is invisible to every scenario here. Code review and
    the diff are the witnesses for that, and this issue is `hitl`.

  Scope notes — three discrepancies found while writing these scenarios, all for HITL review:

    • USER STORY 15 IS LISTED ON THE ISSUE BUT IS NOT IN ITS ACCEPTANCE CRITERIA. Story 15 is "GitHub
      bot-identity derivation and remote-URL parsing" — `adws/gitContext/bootstrapIdentity.ts`, whose
      `resolveBootstrapGitIdentity` (`:118-131`) reads `GITHUB_APP_ID`/`GITHUB_APP_SLUG` from the
      environment to build a `<slug>[bot]@users.noreply.github.com` identity, and whose
      `parseGitHubRemoteUrl` (`:54`) is the single source of truth for GitHub remote parsing. Both
      are unambiguously GitHub-specific and neither is a "semantic method pending migration", so
      AC1 read literally pulls them in. But the issue's "What to build" names only builders, App auth
      and token resolution; the Touched Files list omits `bootstrapIdentity.ts`; and the PRD puts
      identity splitting under a SEPARATE Implementation Decision ("Core cleanup"), not under the
      "GitHub forge adapter" bullet this issue cites. These scenarios follow the acceptance criteria
      and Touched Files — bootstrap identity is NOT pinned here. If the reviewer wants story 15 in
      this slice, it needs its own scenarios and `bootstrapIdentity.ts` in Touched Files.
    • A DIRECT `gh` SPAWN REMAINS IN THE CORE AFTER THIS SLICE, AND AC3 DOES NOT REACH IT.
      `ghAuthToken()` (`bootstrapIdentity.ts:91-93`) is `execSync('gh auth token')` — a gh command
      that does not pass through the executor. It is the third source in the resolution order that
      this slice moves, so "token resolution moves out of the core" arguably takes it along; but it
      is injected into the provider as a function seam by the boundary (`gitContextFactory.ts:53`),
      so as configuration it is the BOUNDARY's spawn, not the adapter's. Routing it through the
      executor is also not free: the provider is built before the context exists, and a provider that
      called `ctx.exec` to answer `commandEnv` would recurse through the credential assembly it is
      being asked for. Left unpinned deliberately, and flagged: whichever way the reviewer decides,
      it should be a decision rather than an oversight.
    • STORY 9's "WHICH PACKAGE MAY ISSUE WHICH KIND" CANNOT BE FULLY ENFORCED IN THIS SLICE. Story 9
      wants the exempt set to name exactly which package may issue git and which may issue gh. Read
      strictly, that makes a gh command in the git core a violation — and the core still has dozens
      of them, in the semantic methods AC1 explicitly defers ("except the semantic methods pending
      migration"), starting with `defaultBranch()` at `gitContext.ts:316`. A kind-scoped rule would
      therefore turn the build red on day one and AC4's "`bun run lint:git-guard` green" would be
      unsatisfiable. §19 pins the shippable reading: both packages structurally exempt, the
      kind-scoping documentary until the caller migration retires the core's gh call sites, and the
      closed-set property enforced against everything else by §17. If the reviewer wants the strict
      reading now, it blocks on the caller-migration slice and this issue's AC4 needs rewording.

  Testing notes for the step definitions:

    • THE COMMAND SEAM IS #790's INJECTED `exec` FAKE, reached the same way feature-790 and
      feature-791 reach it: `new GitContext(options, { exec })`, recording `(command, cwd, env,
      input)` per call. `makeSpyExec` in
      `features/per-issue/step_definitions/gitContextSharedWorld.ts` already does exactly this and
      lets a Given seed responses by substring after the spy is built.
    • THE FORGE OPERATIONS AND THEIR ARGUMENTS ARE FIXED BY THE STEP DEFINITIONS, so the Gherkin
      names an operation and never a method signature. Bind them as: `fetch-issue` →
      `fetchIssue(7)`; `comment-on-issue` → `commentOnIssue(7, 'body text')`; `close-issue` →
      `closeIssue(7)`; `add-issue-label` → `addIssueLabel(7, 'needs-review')`;
      `delete-issue-comment` → `deleteIssueComment(9001)`; `merge-pr` → `mergePR(42)`; `approve-pr` →
      `approvePR(42)`; `pr-changed-files` → `fetchPRChangedFiles(42)` (`gitContext.ts:697`);
      `create-label` → `createLabel('adw:upgrade', 'ededed', 'Framework upgrade')`; `set-secret` →
      `setSecret('ADW_TOKEN', 'secret-value')`; `board-project-query` → the first command of
      `moveIssueToStatus(28, 'In Progress')`. Where an operation issues more than one command, assert
      against its FIRST recorded command — `moveIssueToStatus` swallows parse failures against a
      canned seam answer and stops after `projectQueryCmd` (`gitContext.ts:733`), which is the one
      under test.
    • §11's OPERATIONS ARE BOTH RAW-STRING RETURNS — `fetchIssue` and `fetchPRChangedFiles` hand back
      the executor's trimmed stdout verbatim (`gitContext.ts:482`, `:697`) — so the canned answer can
      be a plain sentinel and the assertion is a string equality. Do not use a JSON payload: braces
      in a Gherkin `{string}` argument are parsed as cucumber-expression parameters.
    • §11a's CALL SITE IS THE ADAPTER'S OWN COMMAND RUNNER, not a context method: build the context
      with `new GitContext(options, { exec })` exactly as every other scenario here does, hand it to
      the adapter's runner factory, and issue the command through that. The board row issues
      `projectQueryCmd('acme', 'webapp')` — the same relocated builder §2 pins — under the alternate
      credential purpose. The alternate identity token is the token provider's `alternateIdentityPat`
      and must differ from the resolved token, or the assertion cannot tell a preserved purpose from
      a dropped one (an absent alternate falls back to the resolved token by design).
    • §2's ASSERTION IS AN EQUALITY BETWEEN TWO RUNTIME VALUES, not a source read: call the adapter's
      builder with the same arguments the operation was given and compare it to the recorded command
      string. The step definition's import path for the builders is the one thing in this file that
      must change if the reviewer relocates the adapter; that is one helper, not thirty scenarios.
    • THE GITHUB API SEAM IS `AppAuthDeps.runCurl` — already injectable (`appAuth.ts:47-53`) and
      already exercised by `appAuth.test.ts`'s `makeRunCurl`, which records `{args, config}` and
      replays canned `${body}\n${status}` responses in order. `apiBaseUrl` is injectable too, so no
      scenario touches `api.github.com`. Reuse that harness rather than inventing one.
    • "SIGNED FOR APP ID {string}" reads the `iss` claim of the JWT in the recorded config's
      `Authorization: Bearer …` line — `appAuth.test.ts:88-95`'s `extractJwt` already extracts it;
      base64url-decode the payload segment. The App id, not the slug, is what the JWT carries.
    • THE THROWAWAY PRIVATE KEY is generated per run with `crypto.generateKeyPairSync('rsa', …)` into
      a temp directory, exactly as `appAuth.test.ts:28-35` does. No fixture key is committed.
    • AMBIENT APP VARIABLES ARE SET IN THE GIVEN AND RESTORED IN `After`, following
      `appAuth.test.ts:21-47` and `tokenResolver.test.ts:27`. `clearAppAuthCaches()` (or whatever
      replaces it once configuration is injected) must run between scenarios or §10's cache
      assertions leak into their neighbours.
    • §10's TWO DIRECTIONS ARE PHRASED AS "no further request" / "a further token exchange" rather
      than as request COUNTS, because the installation-id cache and the token cache are separate
      (`appAuth.ts:34-37`) and a count would pin an internal detail this slice is not changing.
    • THE GUARD IS DRIVEN OVER A THROWAWAY FIXTURE REPOSITORY, not over `scanFiles` directly. This
      matters: the package exemption currently lives in `visitDir` (`checkGitGhGuard.ts:81`), which
      `scanFiles` never consults, so feature-769's `scanFiles`-based steps would report a violation
      for an exempt path and §15/§16 would fail against a correct implementation. Write the fixture
      files into a temp directory and run the guard over that root — `execSync('bunx tsx ' +
      join(repoRoot, 'adws/checkGitGhGuard.ts'), { cwd: fixtureRoot })`, since `main()` takes its
      repo root from `process.cwd()` — capturing exit status and stdout. That exercises collection
      AND scanning, so it stays correct wherever the implementer puts the exempt set. An exported
      repo-root entry point would serve equally well; the Gherkin does not name either.
    • FIXTURE FILE NAMES MUST NOT END IN `.test.ts` OR SIT UNDER `__tests__/`, and no fixture
      directory may be named `features` or `test` — `isScannable` and `EXEMPT_DIR_NAMES`
      (`checkGitGhGuard.ts:39-44`) skip those, and a skipped fixture makes a "fails the guard"
      scenario pass vacuously. Every negative scenario asserts the violation NAMES the fixture path
      for this reason.
    • REUSED, NOT REDEFINED — redefining any of these is an AmbiguousStepDefinition: `the ADW
      codebase is checked out` (G18) and `the ADW TypeScript type-check passes` (T22) live in
      `features/step_definitions/ensureCronOnEveryEventSteps.ts:8` and `feature-504.steps.ts:1126`;
      `the git/gh guard runs across the whole ADW repository` and `the guard run reports no
      violations` live in `feature-769.steps.ts:380` and `:533`.
    • EVERY OTHER PHRASE BELOW IS NEW AND DELIBERATELY WORDED APART FROM ITS NEIGHBOURS. feature-790
      owns `no process environment variable was modified by the run` and feature-791 owns `the run
      modified no process environment variable`; §13 uses a third wording for the same property
      because both existing steps assert against their own file's snapshot.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE EXECUTED COMMANDS ARE UNCHANGED BY THE MOVE (AC1) ────────────────────────────
  #
  # The regression net, and the assertion the PRD's Testing Decisions name first: "which command
  # string was executed". Every family that moves is represented — issue, PR, label, secret — with
  # the exact strings today's builders produce. A relocation that re-flowed a template literal, lost
  # a quote around a label name, or dropped `--body-file -` is a production incident on the next run;
  # this is where it stops. GREEN before and after, on purpose: the point of a move is that nothing
  # observable changes.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario Outline: The command executed for a forge operation is unchanged by the consolidation
    Given a git context for the repository "acme/webapp" wired to the GitHub forge adapter
    And the command seam records every command with its working directory and child environment
    When the forge operation "<operation>" is invoked
    Then the executed command for the forge operation "<operation>" is exactly "<command>"

    Examples:
      | operation            | command                                                             |
      | comment-on-issue     | gh issue comment 7 --repo acme/webapp --body-file -                 |
      | close-issue          | gh issue close 7 --repo acme/webapp                                 |
      | add-issue-label      | gh issue edit 7 --repo acme/webapp --add-label needs-review         |
      | delete-issue-comment | gh api -X DELETE repos/acme/webapp/issues/comments/9001             |
      | merge-pr             | gh pr merge 42 --merge --repo acme/webapp                           |
      | approve-pr           | gh pr review 42 --approve --repo acme/webapp                        |
      | pr-changed-files     | gh pr view 42 --repo acme/webapp --json files                       |
      | set-secret           | gh secret set ADW_TOKEN --repo acme/webapp --body -                 |

  # ── §2 ONE BUILDER, NOT A COPY (AC1) ────────────────────────────────────────────────────
  #
  # §1 passes if the move was a copy that left the core's originals in place and wired the context to
  # them — the adapter would hold five dead modules and the slice would have consolidated nothing.
  # This row compares the executed command against what the ADAPTER's builder returns for the same
  # arguments, so the two are pinned together and any drift between a retained copy and the canonical
  # one fails immediately. It covers the board family too, whose GraphQL command strings are far too
  # long to write into an Examples column but are exactly the strings most likely to be mangled by a
  # move. What it CANNOT prove is that the core's copy was deleted — see the observability note; that
  # is what HITL review is for.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario Outline: The command a forge operation executes is the one the adapter's builder produces
    Given a git context for the repository "acme/webapp" wired to the GitHub forge adapter
    And the command seam records every command with its working directory and child environment
    When the forge operation "<operation>" is invoked
    Then the executed command for the forge operation "<operation>" is exactly the command the adapter builder produces for it

    Examples:
      | operation           |
      | fetch-issue         |
      | comment-on-issue    |
      | add-issue-label     |
      | merge-pr            |
      | approve-pr          |
      | create-label        |
      | set-secret          |
      | board-project-query |

  # ── §3 THE CORE CARRIES NO GITHUB CREDENTIAL MACHINERY (AC1) ────────────────────────────
  #
  # The ambient environment is fully configured for GitHub App authentication — the condition under
  # which any surviving path from the core into `appAuth` would fire — and the context is handed a
  # forge-neutral provider that answers with a plain credential. Nothing may reach the GitHub API.
  # A core that kept a convenience import ("if the App is configured, mint") would light up here and
  # nowhere else in this file. GREEN before, because the core does not consult App auth today; kept
  # as the standing guard that the move does not accidentally invert into a fallback.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: A core context with a forge-neutral provider reaches no GitHub API even with the App configured in the environment
    Given a git context for the repository "acme/webapp" whose credentials come from a forge-neutral provider answering "credential-forge-neutral"
    And the ambient environment carries GitHub App variables for app id "ambient-app-id" and slug "ambient-bot"
    And the GitHub API seam records every request
    And the command seam records every command with its working directory and child environment
    When the forge operation "fetch-issue" is invoked
    And the forge operation "merge-pr" is invoked
    Then every executed command carried the credential "credential-forge-neutral"
    And no request reached the GitHub API seam

  # ── §4 INJECTED CONFIGURATION IS WHAT AUTHENTICATES (AC2) ───────────────────────────────
  #
  # AC2 as an experiment rather than a source-code property. Two Apps are in play: one exported into
  # the ambient environment, one handed to the adapter as configuration. The JWT that signs the mint
  # must be issued for the injected App. RED before and not merely unimplemented — `getInstallationToken`
  # reads `process.env[GITHUB_APP_ID]` at `appAuth.ts:75` and has no parameter through which an
  # injected app id could arrive, so today the ambient App wins by construction.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: The mint is signed for the injected App identity, not the one exported into the environment
    Given the ambient environment carries GitHub App variables for app id "ambient-app-id" and slug "ambient-bot"
    And the adapter's App configuration names app id "injected-app-id", slug "injected-bot" and a throwaway private key
    And the GitHub API seam answers an installation lookup with "installation-4711" and a token exchange with "ghs-installation-credential"
    When an installation credential is minted for the repository "acme/webapp"
    Then the minted credential is "ghs-installation-credential"
    And the recorded mint request was signed for app id "injected-app-id"

  # ── §5 THE ENVIRONMENT ALONE CANNOT ACTIVATE APP AUTHENTICATION (AC2) ───────────────────
  #
  # The sharper direction. An implementation that reads injected configuration when present and falls
  # back to the environment when absent passes §4 completely and preserves the entire defect: the App
  # still activates itself out of ambient process state, and a library consumer still cannot turn it
  # off. So: App variables exported, adapter App configuration absent, and the resolution must skip
  # the App entirely — no request to the GitHub API at all — and hand back the next credential in the
  # order. RED before: `isGitHubAppConfigured()` answers "yes" from the environment
  # (`appAuth.ts:62-67`) and the resolver mints on that answer (`tokenResolver.ts:48-52`).

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: With no injected App configuration the exported App variables do not trigger a mint
    Given the ambient environment carries GitHub App variables for app id "ambient-app-id" and slug "ambient-bot"
    And the adapter's App configuration is absent
    And the adapter is configured with the personal access token "github-pat-xyz" and the gh CLI token "ghs-from-cli"
    And the GitHub API seam records every request
    When a credential is resolved through the adapter for the repository "acme/webapp"
    Then the resolved credential is "github-pat-xyz"
    And no request reached the GitHub API seam

  # ── §6 INJECTED CONFIGURATION IS SUFFICIENT ON ITS OWN (AC2) ────────────────────────────
  #
  # §4 and §5 are both satisfied by an implementation that requires the environment AND the injection
  # to agree — which would still be unusable by a consumer that cannot set environment variables,
  # and is the shape a cautious "add injection alongside the existing reads" patch produces. With the
  # ambient environment carrying no App variables whatsoever, injected configuration alone must mint.
  # RED before: with the variables unset, `appAuth.ts:75-76` reads `undefined` and the JWT cannot be
  # signed.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: Injected App configuration mints with no App variables in the environment at all
    Given the ambient environment carries no GitHub App variables
    And the adapter's App configuration names app id "injected-app-id", slug "injected-bot" and a throwaway private key
    And the GitHub API seam answers an installation lookup with "installation-4711" and a token exchange with "ghs-installation-credential"
    When an installation credential is minted for the repository "acme/webapp"
    Then the minted credential is "ghs-installation-credential"
    And the recorded mint request was signed for app id "injected-app-id"

  # ── §7 THE MINT STILL ADDRESSES THE REPOSITORY IT WAS ASKED FOR (AC2) ───────────────────
  #
  # The invariant the whole PRD protects, re-pinned across this particular move because injection
  # changes where the App identity comes from and it must not change which repository the credential
  # is bound to. The installation lookup names the asked-for repository; an App configured but not
  # installed on it fails loudly rather than serving a credential bound somewhere else — the
  # behaviour `tokenResolver.ts:48-52` propagates deliberately and `appAuth.test.ts:279` pins today.
  # GREEN before and after.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: The installation lookup names the repository the credential was asked for
    Given the ambient environment carries no GitHub App variables
    And the adapter's App configuration names app id "injected-app-id", slug "injected-bot" and a throwaway private key
    And the GitHub API seam answers an installation lookup with "installation-4711" and a token exchange with "ghs-installation-credential"
    When an installation credential is minted for the repository "octo/infra"
    Then the recorded mint request looked up the installation for the repository "octo/infra"

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: An App not installed on the repository fails the mint instead of returning another credential
    Given the ambient environment carries no GitHub App variables
    And the adapter's App configuration names app id "injected-app-id", slug "injected-bot" and a throwaway private key
    And the adapter is configured with the personal access token "github-pat-xyz" and the gh CLI token "ghs-from-cli"
    And the GitHub API seam answers the installation lookup with a not-found response
    When a credential is resolved through the adapter for the repository "acme/webapp" and any failure is captured
    Then the resolution failed naming the repository "acme/webapp"
    And the resolution returned no credential

  # ── §8 THE CREDENTIAL STILL NEVER TOUCHES A COMMAND LINE (#780 regression guard) ────────
  #
  # `appAuth.ts:169-176` sends the bearer on curl's `--config` stdin channel precisely so it cannot
  # appear in a thrown `execFileSync` error or in `ps` output — the fix issue #780 paid for. This
  # slice relocates that file wholesale, and a security property survives a move only if something is
  # watching it. Both halves: nothing credential-bearing in the recorded argv, and exactly one
  # Authorization line on stdin — the second half is what stops a "fix" that satisfies the first by
  # not transmitting the credential at all.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: The relocated App authentication still carries its bearer on standard input and never in an argument
    Given the ambient environment carries no GitHub App variables
    And the adapter's App configuration names app id "injected-app-id", slug "injected-bot" and a throwaway private key
    And the GitHub API seam answers an installation lookup with "installation-4711" and a token exchange with "ghs-installation-credential"
    When an installation credential is minted for the repository "acme/webapp"
    Then no recorded request carried a credential in its command arguments
    And every recorded request carried exactly one authorization header on its standard input

  # ── §9 MINT FAILURES STAY DIAGNOSABLE AND SANITISED (regression guard) ──────────────────
  #
  # The other half of #780's bargain: a failure that discloses nothing is useless if it also says
  # nothing. The message names the operation, the repository and the HTTP status, and contains no
  # bearer. `appAuth.test.ts:103-134` pins both properties today; they are carried across the package
  # boundary here.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: A failing installation lookup is diagnosable without disclosing the bearer credential
    Given the ambient environment carries no GitHub App variables
    And the adapter's App configuration names app id "injected-app-id", slug "injected-bot" and a throwaway private key
    And the GitHub API seam answers the installation lookup with a not-found response
    When an installation credential is minted for the repository "acme/webapp" and any failure is captured
    Then the mint failure names the operation, the repository "acme/webapp" and the response status
    And the mint failure discloses no credential

  # ── §10 THE EXPIRY-AWARE MINT CACHE SURVIVES THE MOVE (AC1) ─────────────────────────────
  #
  # #791 put no cache in the core and none in the provider, on the stated grounds that the only
  # legitimate cache on this path is the expiry-aware one inside App auth. That decision only holds
  # if the cache actually arrives at the far end of this move. It is load-bearing now in a way it was
  # not before #791: per-command resolution means one `commitChanges` asks three times, so a dropped
  # cache turns every commit into three JWT signatures and up to six GitHub round trips — passing
  # every other scenario in this file while multiplying ADW's API traffic by the number of commands
  # it runs. Both directions, because a cache that never expires is as wrong as no cache: a
  # credential already inside the five-minute refresh buffer (`appAuth.ts:41`) must be exchanged
  # again, which is the expiry defect #791 exists to prevent, one layer down.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: A second credential request inside the refresh window is served without another exchange
    Given the ambient environment carries no GitHub App variables
    And the adapter's App configuration names app id "injected-app-id", slug "injected-bot" and a throwaway private key
    And the GitHub API seam answers an installation lookup with "installation-4711" and a token exchange with "ghs-installation-credential" expiring in 60 minutes
    When an installation credential is minted for the repository "acme/webapp"
    And an installation credential is minted for the repository "acme/webapp" a second time
    Then both mints produced the credential "ghs-installation-credential"
    And the second mint issued no further request to the GitHub API seam

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: A credential already inside the refresh buffer is exchanged again rather than served stale
    Given the ambient environment carries no GitHub App variables
    And the adapter's App configuration names app id "injected-app-id", slug "injected-bot" and a throwaway private key
    And the GitHub API seam answers an installation lookup with "installation-4711" and a token exchange with "ghs-installation-credential" expiring in 2 minutes
    When an installation credential is minted for the repository "acme/webapp"
    And an installation credential is minted for the repository "acme/webapp" a second time
    Then the second mint issued a further token exchange to the GitHub API seam

  # ── §11 EVERY GH COMMAND REACHES THE CORE EXECUTOR (AC3) ────────────────────────────────
  #
  # "The adapter never spawns processes itself", stated as something observable. The seam answers a
  # canned payload; the operation's return value must be derived from it. A direct spawn cannot see a
  # canned answer — it would return whatever the real `gh` said, or fail because no `gh` is
  # configured in the test environment — so this distinguishes the two without any source inspection.
  # Asserting the RETURN VALUE rather than merely counting recorded calls is the point: an
  # implementation that both recorded through the seam and spawned for real would pass a call count.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario Outline: A forge operation's result comes from the executor seam, so no process was spawned around it
    Given a git context for the repository "acme/webapp" wired to the GitHub forge adapter
    And the command seam records every command with its working directory and child environment
    And the command seam answers commands matching "<match>" with "<answer>"
    When the forge operation "<operation>" is invoked
    Then the forge operation "<operation>" returned the value the command seam answered
    And every executed command reached the command seam

    Examples:
      | operation        | match         | answer                    |
      | fetch-issue      | gh issue view | seeded-issue-payload      |
      | pr-changed-files | gh pr view    | seeded-changed-file-list  |

  # ── §11a THE ADAPTER'S OWN GH CALL SITE ROUTES THROUGH THE EXECUTOR (AC3) ───────────────
  #
  # §11 covers the forge operations the core still owns. AC3 is about the call sites the ADAPTER
  # acquires in this slice, so the same discipline is pinned one level in: a gh command issued from
  # the adapter is answered by the seam — a direct spawn cannot see a canned answer — and runs from
  # the framework root it INHERITS rather than one it re-derives for itself.
  #
  # The board row is the silent-regression risk the rewire carries. Projects V2 writes on user-owned
  # repositories need the alternate identity rather than an App installation token
  # (`app_docs/feature-hjcays-fix-board-pat-auth.md`), and the credential purpose travels with the
  # command. A board command that lost it would pass every other scenario in this file while board
  # writes failed with a silent `false`.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: A gh command issued by the forge adapter itself is answered by the core executor
    Given a git context for the repository "acme/webapp" wired to the GitHub forge adapter
    And the command seam records every command with its working directory and child environment
    And the command seam answers commands matching "gh api user" with "adapter-seam-answer"
    When the forge adapter issues the gh command "gh api user --jq .login"
    Then the adapter's gh command returned the value the command seam answered
    And the adapter's gh command ran from the framework root directory
    And every executed command reached the command seam

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: A board command issued by the forge adapter still carries the alternate identity credential
    Given a git context for the repository "acme/webapp" wired to the GitHub forge adapter
    And the adapter is configured with the personal access token "github-pat-xyz" and the alternate identity token "github-pat-board"
    And the command seam records every command with its working directory and child environment
    When the forge adapter issues its board project query for the repository "acme/webapp"
    Then the adapter's gh command carried the credential "github-pat-board"
    And the adapter's gh command ran from the framework root directory

  # ── §12 THE WORKING-DIRECTORY CONTRACT IS INHERITED, NOT REIMPLEMENTED (AC3) ────────────
  #
  # Repository-independent gh commands run from the framework root, never from a target workspace —
  # the contract #790 preserved as a forge-neutral cwd class and the reason directive handling
  # (Cancel/Retry) works on a host that never cloned the target repository (PRD story 16). It is
  # inherited by feeding the executor rather than reimplemented, so the process working directory
  # moving elsewhere must change nothing. An adapter that assembled its own spawn would have to
  # re-derive this, and the failure mode is invisible until the day a directive arrives on a host
  # with no workspace.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario Outline: A repository-independent forge command still runs from the framework root after the process working directory moves
    Given a git context for the repository "acme/webapp" wired to the GitHub forge adapter
    And the command seam records every command with its working directory and child environment
    And the process working directory is moved outside both the framework root and the workspace
    When the forge operation "<operation>" is invoked
    Then the forge operation "<operation>" executed its command from the framework root directory

    Examples:
      | operation        |
      | fetch-issue      |
      | comment-on-issue |
      | merge-pr         |
      | set-secret       |

  # ── §13 THE CREDENTIAL ENVIRONMENT IS THE CORE'S, ASSEMBLED PER COMMAND (AC3) ───────────
  #
  # The rest of the spawn discipline AC3 says the adapter inherits: the credential the port resolved
  # travels in the child environment together with the context's git identity, and the process
  # environment itself is never written. The no-mutation half is the one that matters most here —
  # it is the ~13-incident bleed class (vestmatic #143/#181/#187), and "assemble the environment
  # once, export it, spawn" is a tempting simplification for a package that is now feeding command
  # strings across a module boundary.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: Adapter commands carry the resolved credential and the context's git identity without touching the process environment
    Given a git context for the repository "acme/webapp" wired to the GitHub forge adapter
    And the adapter is configured with the personal access token "github-pat-xyz" and the gh CLI token "ghs-from-cli"
    And the command seam records every command with its working directory and child environment
    When the forge operation "fetch-issue" is invoked
    And the forge operation "comment-on-issue" is invoked
    And the forge operation "merge-pr" is invoked
    Then every executed command carried the credential "github-pat-xyz"
    And every executed command carried the context's git author and committer identity
    And the adapter run left every process environment variable untouched

  # ── §14 A REFUSED EXECUTION IS NOT RETRIED THROUGH ANOTHER SPAWN (AC3) ──────────────────
  #
  # §11 proves the executor is reached. Only this proves there is nothing to fall back TO. The seam
  # refuses every command; the operation must surface that refusal and nothing may run. A private
  # spawn kept "just for the cases the executor cannot handle" is precisely the shape that survives
  # code review, and it is invisible to every happy-path scenario above.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: When the executor refuses, the forge operation fails rather than reaching a process another way
    Given a git context for the repository "acme/webapp" wired to the GitHub forge adapter
    And the command seam refuses every command
    When the forge operation "fetch-issue" is invoked and any failure is captured
    Then the forge operation "fetch-issue" failed with the refusal from the command seam
    And no command ran outside the command seam

  # ── §15 A GH CALL SITE IN THE ADAPTER PASSES THE GUARD (AC4) ────────────────────────────
  #
  # The load-bearing RED of the guard half and the reason the exempt-set change cannot be deferred to
  # a later PR: `checkGitGhGuard.ts:46` names one exempt path, `adws/gitContext`, so the first gh
  # command string the adapter hands the executor fails the build. The fixture is the shape the PRD
  # sanctions — an executor call site with a literal gh command as its first argument, which is
  # exactly what the shell-out rule inspects (`checkGitGhGuard.ts:135-147`).

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: A gh command issued through the executor from the adapter package passes the guard
    Given a fixture repository containing the file "adws/providers/github/githubCodeHost.ts":
      """
      import type { GitContext } from '../../gitContext';

      export class GitHubCodeHost {
        constructor(private readonly ctx: GitContext) {}

        authenticatedUser(): string {
          return this.ctx.exec('gh api user --jq .login', { cwd: { kind: 'frameworkRoot' }, env: {} });
        }
      }
      """
    When the git/gh guard runs over the fixture repository
    Then the guard run over the fixture repository reports no violation

  # ── §16 A GIT CALL SITE IN THE GIT CORE PASSES THE GUARD (AC4) ──────────────────────────
  #
  # The half of the exempt set that already exists and must not be lost while the other half is
  # added. A two-entry set is easy to get wrong in the direction of replacing rather than extending,
  # and the failure would be a red build on the package that owns every git command in the codebase.
  # GREEN before and after.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: A git command issued from the git core package passes the guard
    Given a fixture repository containing the file "adws/gitContext/gitReadOps.ts":
      """
      type Run = (command: string, cwd?: string) => string;

      export function currentBranch(run: Run, cwd: string): string {
        return run('git rev-parse --abbrev-ref HEAD', cwd);
      }
      """
    When the git/gh guard runs over the fixture repository
    Then the guard run over the fixture repository reports no violation

  # ── §17 A THIRD PACKAGE FAILS, HOWEVER GITHUB-SHAPED ITS PATH (AC4) ─────────────────────
  #
  # "Exactly two packages" is a claim about a CLOSED set, so it is worth testing against the near
  # misses a sloppy predicate would admit. `adws/github/` contains the word; `adws/providers/` is the
  # adapter's parent; `adws/providers/gitlab/` is its sibling — a `startsWith('adws/providers')` or an
  # `includes('github')` predicate passes AC4's headline while opening the chokepoint to a large part
  # of the codebase. `adws/github/issueApi.ts` is in this issue's own Touched Files and is precisely
  # the kind of module the migration will later point at the adapter: it must stay unprivileged. The
  # last row covers the other command kind, so the closed set holds for git as well as gh.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario Outline: A direct shell-out from any third package fails the guard
    Given a fixture repository containing the file "<path>":
      """
      import { execSync } from 'child_process';

      export function probe(): string {
        return execSync('<command>', { encoding: 'utf-8' });
      }
      """
    When the git/gh guard runs over the fixture repository
    Then the guard run over the fixture repository fails naming "<path>"

    Examples:
      | path                                    | command                                        |
      | adws/github/issueApi.ts                 | gh issue view 7 --repo acme/webapp --json state |
      | adws/providers/repoContext.ts           | gh api user --jq .login                        |
      | adws/providers/gitlab/gitlabCodeHost.ts | gh pr list --repo acme/webapp                  |
      | adws/phases/prPhase.ts                  | gh pr merge 42 --merge --repo acme/webapp      |
      | adws/core/worktreeHelper.ts             | git worktree list --porcelain                  |

  # ── §18 THE EXEMPTION FOLLOWS CALL SITES, NOT MENTIONS (AC4, over-fire guard) ───────────
  #
  # "Pure string builders never trip the shell-out rule; the exemption follows executor call sites,
  # not builders" — PRD, verbatim. The rule inspects a CALL's first argument, so a module that only
  # returns gh strings is legal wherever it lives. This is the row that keeps §17 honest: a guard
  # tightened by pattern-matching the text "gh " would satisfy every negative scenario above and then
  # fail the build on any module that so much as names a gh command in a return value — including,
  # ironically, the relocated builders themselves if the adapter's exemption were ever narrowed.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: A pure command builder that only returns gh strings passes the guard from an unprivileged package
    Given a fixture repository containing the file "adws/core/commandPreview.ts":
      """
      export function previewIssueCmd(owner: string, repo: string, issueNumber: number): string {
        return `gh issue view ${issueNumber} --repo ${owner}/${repo} --json state`;
      }

      export const AUDIT_COMMAND = 'gh auth status';
      """
    When the git/gh guard runs over the fixture repository
    Then the guard run over the fixture repository reports no violation

  # ── §19 THE WHOLE REPOSITORY IS GREEN (AC4, the ratchet) ────────────────────────────────
  #
  # The ratchet, and the scenario that decides how literally story 9's "which package may issue which
  # kind" can be enforced in THIS slice. `bun run lint:git-guard` must exit 0 after the move, with
  # the two-package exempt set in force AND the core's semantic methods — which AC1 explicitly defers
  # ("except the semantic methods pending migration") — still issuing gh, starting with
  # `defaultBranch()` at `gitContext.ts:316`. A kind-scoped rule that forbade gh in the git core
  # would turn this red on day one. See the scope note: if the reviewer wants the strict reading, it
  # blocks on the caller-migration slice.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: The git/gh guard passes across the whole repository with the two-package exempt set in force
    When the git/gh guard runs across the whole ADW repository
    Then the guard run reports no violations

  # ── §20 Type-check backstop (T22) ───────────────────────────────────────────────────────
  #
  # The widest-reaching slice of the phase: five builder modules, App auth and the token resolver
  # change package; the App's configuration becomes a value with a type; and every consumer of a
  # relocated export changes its import. The type-checker is the only cheap complete proof that the
  # move landed everywhere rather than in the adapter alone. `adws/tsconfig.json` globs `./**/*.ts`,
  # so it also covers the relocated unit suites — the compile-time half of AC5's "green in their new
  # home". feature-769 §T, feature-790 §14 and feature-791 §14 precedent.

  @adw-792 @adw-e2er82-consolidate-github-f
  Scenario: The ADW TypeScript type-check passes with GitHub knowledge consolidated into the forge adapter
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
