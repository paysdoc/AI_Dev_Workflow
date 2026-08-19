@adw-791 @adw-jl4hot-introduce-tokenprovi
Feature: GitContext credentials arrive through a TokenProvider port resolved on every command — nothing cached at construction, nothing read from the environment, and the provider, not the core, decides which credential a command gets

  Issue #791 is the second slice of the GitContext forge-agnostic refactor
  (`specs/prd/gitcontext-forge-agnostic-refactor.md`), built directly on #790's public executor.
  #790 gave the package one public, forge-neutral spawn entry that CARRIES a credential
  (`gitContext.ts:202`). This slice supplies that credential from a port instead of from a field
  frozen at construction, and moves the last GitHub concept out of the internal executor path.

  Two construction-time fields are what this slice dismantles: `#token` and `#pat`
  (`gitContext.ts:128-129`, assigned once at `:139-140`), read by `commandEnv` on every command as
  `GH_TOKEN: (usePat && this.#pat) ? this.#pat : this.#token` (`:161`). Both boundaries resolve a
  token exactly once and hand over the string — `launchGitContext.ts:94`
  (`token: resolveToken(owner, repo)`) and `gitContextFactory.ts:90`/`:112`. The resolution itself
  (`tokenResolver.ts:46-61`) is already good: App mint bound to owner/repo, else PAT, else
  `gh auth token`, else a loud throw, and never `process.env.GH_TOKEN`. What is wrong is WHEN it runs
  and WHO holds the answer.

  THE PRODUCTION DEFECT THIS FORECLOSES. A GitHub App installation token expires roughly an hour
  after it is minted; `appAuth.ts` knows this and refreshes five minutes early (`:41`,
  `REFRESH_BUFFER_MS`). But an ADW orchestrator builds ONE GitContext at launch and runs for hours —
  plan, build, test, review, document, PR, merge. Every command after the first hour carries a token
  that expired while the run was still going, and `appAuth`'s refresh never gets consulted because
  the core is holding a copy of the answer rather than the question. The port is the fix: the core
  keeps the question.

  The PRD's shape for this slice:

      per command:   core asks the port  →  port decides which credential  →  core carries it

  Three things move with it:

    • THE CORE STOPS HOLDING A CREDENTIAL. Not "refreshes it periodically" — holds none at all. Every
      command re-asks. A cache with a TTL inside the core would reintroduce exactly the staleness
      this exists to kill, one TTL later.
    • THE CORE STOPS READING THE ENVIRONMENT FOR CREDENTIALS. `process.env.GH_TOKEN` as a token source
      is the ~13-incident wrong-repo/bleed class (vestmatic #143/#181/#187). #700 removed the
      fall-through from the resolver; this slice removes the possibility from the core by leaving it
      nothing to fall back TO.
    • `usePat` LEAVES. #790 kept it out of `exec`'s public signature but alive on the private
      classifiers (`#run` at `:228`, `#runRepoApi` at `:248`), with seven internal call sites —
      `approvePR` (`:622`), `runGraphQL` (`:658`), `runGraphQLInput` (`:663`) and the four
      `moveIssueToStatus` queries (`:675`, `:682`, `:692`, `:701`). The core must no longer decide
      that "approving a PR means use the PAT"; it must say only that this command needs the elevated
      credential class, and the GitHub provider must be the thing that knows an elevated GitHub
      credential is a PAT.

  The behavioural contract pinned below:

     1. EVERY COMMAND RESOLVES AFRESH (AC1). Two ordinary operations against a credential source whose
        answer changes between requests spawn with two DIFFERENT credentials. This is the whole slice
        in one scenario, and it is the expiry story stated behaviourally: what the core carried an
        hour ago is not what it carries now. RED before — `#token` is frozen at construction, so both
        commands carry the same string.
     2. PER COMMAND, NOT PER OPERATION (AC1). The sharp version of §1. `commitChanges` issues three
        commands (`commitOps.ts:67`, `:69`, `:70` — status, add, commit); each must carry its own
        resolution. A core that resolved once per public method call would pass §1 and fail here, and
        would still serve a stale token to any operation that outlived the expiry mid-flight. RED
        before.
     3. CONSTRUCTION KEEPS NOTHING IT WAS TOLD (AC1, "never cached at construction"). Construction
        performs exactly ONE resolution — a validating probe whose answer is thrown away — and the
        first command resolves again, so the credential that reaches the first child process is the
        provider's SECOND answer, never the probe's. This is the criterion read on the issue's own
        word: what is forbidden is a construction-time CACHE, not a construction-time check. It is
        what fails a "resolve eagerly and keep it, then re-resolve per command" implementation, which
        would otherwise pass §1 and §2. The probe is also what preserves the loud launch-time failure
        that `launchGitContext.test.ts:167`, `webhookRepoResolver.test.ts:357`,
        `feature-700.steps.ts:134` and `feature-776` all depend on; a zero-resolution construction
        would delete a fail-fast this refactor was never asked to remove. RED before — today
        construction resolves once and every command replays that one string.
     4. THE CORE KEEPS NO COPY OF WHAT IT WAS TOLD (AC1, the anti-cache proof). A provider that stops
        answering once the first command has been served leaves the core with nothing: the second
        command FAILS rather than reusing the first answer, and never reaches the spawn seam.
        Counting resolutions (§2, §3) can be satisfied by a core that re-asks and then quietly prefers
        its own copy on failure; this cannot. RED before.
     5. NO ENVIRONMENT READ FOR CREDENTIALS (AC2). With a stray `GH_TOKEN` and a stray `GITHUB_PAT` in
        the ambient environment — the exact production condition of the bleed incidents — the child
        environment carries the PROVIDER's credential. And the sharp half: when the provider fails,
        the core does not rescue the command with the ambient value. A core that read the environment
        only on the failure path would pass every happy-path scenario in this file and reintroduce the
        entire bug class. RED before is honest only for the second row; the first is a standing guard.
     6. THE PROVIDER CHOOSES; THE CORE CANNOT SUBSTITUTE (AC3). A provider that answers EVERY request
        with one credential makes PR approval and the board query spawn with THAT credential — the
        core has no PAT of its own to reach for. Today `#pat` wins whenever `usePat` is set, so this
        is RED before, and it is the criterion "PAT-vs-token selection moved out of the executor and
        into the provider implementation" observed at runtime rather than inferred from a signature.
     7. BOARD AND APPROVAL OPERATIONS STILL RECEIVE THE PAT (AC4). The behaviour-unchanged half, and
        the reason §6 cannot be satisfied by simply deleting PAT selection: GitHub forbids an App
        identity from approving a PR, and Projects V2 writes are gated behind a PAT on user-owned
        repos. All four elevated operations and three ordinary ones are pinned. GREEN before and
        after — this is the regression net for the migration.
     8. NO PAT CONFIGURED STILL WORKS (AC4, the fallback that production actually runs on).
        `(usePat && this.#pat) ? this.#pat : this.#token` falls back when no PAT is set, and
        `buildLaunchGitContext` NEVER passes one (`launchGitContext.ts:90-98` sets no `pat` field) —
        so every launch-boundary context in production is in exactly this state. A provider that threw
        or returned empty for an elevated request when no PAT exists would break PR auto-approval and
        every board move on the primary code path while passing §6 and §7. GREEN before and after.
     9. RESOLUTION ORDER SURVIVES THE WRAPPING (AC5). App configured wins outright, else a non-blank
        PAT, else `gh auth token`, else a loud failure naming the repository — the order
        `tokenResolver.ts:49-60` already implements and the order the port's GitHub implementation
        must still implement once it is a port. Asserted through a real command, so it proves the
        wiring and not merely the pure function. A whitespace-only PAT is not a credential, and an
        App that is configured but not installed propagates its failure rather than substituting
        anything.
    10. THE CREDENTIAL IS BOUND TO THE CONTEXT'S OWN REPOSITORY (AC5, the invariant the whole PRD
        protects). Two contexts, two repositories, two different credentials, neither carrying the
        other's. Per-command resolution multiplies the number of places this could go wrong by the
        number of commands, so it is re-pinned here rather than left to #658.
    11. THE PUBLIC EXECUTOR IS UNCHANGED BY THIS SLICE (#790 §6 regression guard). The port is consumed
        ABOVE the executor, in the classifiers — not inside it. A caller that hands the public entry
        its own credential still gets exactly that credential, and the executor consults the provider
        not at all. An implementation that put the port inside `exec()` would silently overwrite every
        caller-supplied credential and break the seam #790 built for the forge adapter to plug into.
        GREEN before, and the most plausible way to get this slice wrong.
    12. THE LAUNCH BOUNDARY HANDS OVER THE QUESTION, NOT THE ANSWER (AC1 in production). The core
        re-resolving per command achieves nothing if the boundary resolves once and passes a constant.
        The boundary must hand over the QUESTION: the only resolution on the clock while it builds is
        the core's single validating probe (§3), whose answer is discarded, and the context it returns
        must produce a fresh credential each time it assembles a command environment. RED before —
        `launchGitContext.ts:94` resolves during construction and the resulting string is replayed for
        the life of the object. See the scope note: this file is not in the issue's Touched Files, and
        it must be.
    13. NO PROCESS-ENVIRONMENT MUTATION (carried from #659/#790). Per-command credentials are only safe
        because they never become process-global. Now that a credential can change between two
        commands of the same operation, an implementation that "simplified" by assigning to
        `process.env` would not merely leak — it would make two concurrent contexts overwrite each
        other mid-operation. GREEN before and after.
    14. TYPE-CHECK BACKSTOP (T22). The port interface, the reshaped classifiers and every construction
        site have to agree; the type-checker is the cheapest complete proof that the migration landed
        everywhere rather than in the core only.

  Mapping onto the issue's acceptance criteria:
    AC1 (core resolves via the port on every command; no construction-time caching)
        → §1, §2, §3, §4, and §12 for the production half
    AC2 (core contains no environment reads for credentials)
        → §5, with §4 as its structural precondition — a core with no cached credential has nothing
          to prefer over the provider, and nothing to fall back to
    AC3 (PAT-vs-token selection out of the executor signature, into the GitHub provider)
        → §6 behaviourally, §11 for the executor boundary it must not cross, §14 for the signature
    AC4 (board operations still receive the PAT; ordinary operations the resolved token)
        → §7, §8
    AC5 (tests cover per-call resolution and resolution order)
        → §2/§3/§4 for per-call, §9/§10 for order. The criterion names UNIT tests in the issue's
          Touched Files (`tokenResolver.test.ts`, `gitContext.test.ts`); these scenarios are the
          behavioural mirror of that coverage, not a replacement for it, and the plan should keep
          both.

  Observability / rot-prevention note:

    Every assertion targets an artefact the system PRODUCES: the `(command, cwd, env, stdin)` tuple
    the context hands its injected spawn seam (vocabulary surface #2, recorded calls — the surface
    feature-659 / feature-663 / feature-691 / feature-775 / feature-790 all use), the value a public
    method returns, the error a public method raises, the call record of the injected credential
    provider, and the type-checker's exit status (surface #4). No step reads `gitContext.ts`,
    `types.ts`, `tokenResolver.ts` or any other framework source as text, substring-matches its
    contents, or parses it as JSON/AST.

    ON COUNTING PROVIDER CALLS (§2, §3, §12). The PRD's Testing Decisions say to assert external
    behaviour, "never private state or call sequences". Counting resolutions is not an exception to
    that rule: the provider is an INJECTED COLLABORATOR AT THE SYSTEM'S OWN BOUNDARY, so its call
    record is an output of the system under test in the same sense as a mock server's recorded
    requests — the port exists precisely so that this interaction is observable. To keep it honest,
    no scenario rests on a count alone: every count assertion sits beside an assertion about the
    credential that actually reached a child environment.

  Scope notes:

    • THE PORT'S SHAPE IS SETTLED BY THE PLAN, AND NO SCENARIO CHANGED FOR IT. This file was written
      before planning and deliberately named no TypeScript shape, saying only "the credential
      provider" and "an ordinary / an elevated request". The plan
      (`specs/issue-791-adw-jl4hot-introduce-tokenprovi-sdlc_planner-token-provider-port.md`) settles
      it: a `TokenProvider` interface in `adws/gitContext/types.ts` with one method,
      `credentialEnv({owner, repo, purpose})`, returning an ENVIRONMENT OVERLAY rather than a token
      string; `purpose` is the forge-neutral union `'default' | 'alternateIdentity'`; the provider
      arrives as `GitContextOptions.tokenProvider`; and `createGitHubTokenProvider` in the new
      `adws/gitContext/githubTokenProvider.ts` is its GitHub implementation, wrapping the untouched
      `resolveContextToken`. Only the step definitions' single binding helper knows any of that. The
      one place the plan's shape reached the scenarios is the construction-time validating probe,
      which §3, §4, §11 and §12 now account for.
    • THE ISSUE'S TOUCHED FILES ARE INCOMPLETE, AND §12 IS WHERE THAT BITES. The listed files are
      `gitContext.ts`, `types.ts`, `tokenResolver.ts` and two unit suites. But both boundary
      constructors resolve a token eagerly and pass a string —`adws/core/launchGitContext.ts:94` and
      `adws/github/gitContextFactory.ts:90`/`:112` — so if they are left alone, the core "resolves via
      the port on every command" only in tests, while every production context still carries a
      credential frozen at launch and the expiry defect survives untouched into #792 and beyond. Both
      files must be in scope. The plan agrees and takes both into scope (Relevant Files; steps 12 and
      13), recording the deviation from the issue's Touched Files explicitly in its Notes — so §12
      stands rather than being struck.
    • BACK-COMPATIBILITY AT 348 CONSTRUCTION SITES. `new GitContext(` appears 348 times across
      `adws/`, `features/` and `test/`, nearly all in unit tests and step definitions passing
      `token: '…'`. Removing `token` from `GitContextOptions` outright rewrites all of them. Every
      scenario here is written to hold under either resolution — a mandatory provider, or an optional
      provider with the existing `token` retained as a constant-credential fallback for test call
      sites — EXCEPT §12, which requires the production boundaries to pass a real provider whichever
      shape wins. Note the trap in the second option: a default provider that closes over
      `options.token` IS a construction-time cache wearing a port's clothing, so it must not become
      the boundary's path. The plan takes that second option and honours the trap: its
      `staticCredentialProvider` wraps `options.token` for existing construction sites only, while
      both production boundaries pass a live provider and no literal `token`.
    • FEATURE-658 PINS `token` AS A MANDATORY CONSTRUCTION FIELD and will need updating if it stops
      being one: `feature-658.feature:234` lists "the auth token" as a row in "Constructing a
      GitContext with an incomplete identity fails loudly". If the port replaces the field, that row
      must become the provider; if the field is retained as a fallback, the row stays green untouched.
      The plan decides the second: `token` survives as a TRANSITIONAL literal-credential path, so that
      row stays green and `feature-658.feature` is not edited.
    • `appAuth`'s INTERNAL CACHE IS LEGITIMATE AND IS NOT WHAT THIS SLICE FORBIDS.
      `appAuth.ts:35`/`:80` caches installation tokens per `owner/repo` and refreshes them five
      minutes before expiry. That cache is expiry-AWARE and lives inside the credential source, which
      is exactly where the PRD wants it. The prohibited cache is the core's, which is expiry-BLIND.
      Every scenario here observes the credential that reaches a child environment, so an
      implementation that keeps `appAuth`'s cache passes; §1 and §2 are RED only against a core that
      holds a copy.
    • FEATURE-790 STAYS GREEN AND UNMODIFIED. Its §7 ("a PAT-requiring operation still spawns with the
      PAT while an ordinary operation spawns with the primary token") and §8 ("a PAT-selection flag
      handed to the public executor cannot displace the caller's credential") describe behaviour this
      slice PRESERVES while replacing the mechanism underneath. §7 here is their successor at the port
      boundary, and §11 here is the guard that #790's §6 contract is not broken by putting the port in
      the wrong place. No scenario in feature-790.feature is retagged or edited.
    • `commandEnv(base, usePat)` IS NARROWED BY THIS SLICE — that is what #790's scope note deferred
      here — but it is pinned only where it is the sole spawn-free observation available (§12, at the
      launch boundary, where no exec seam can be injected). Everywhere else this file asserts on the
      credential that reached a CHILD ENVIRONMENT rather than on `commandEnv`'s return value, because
      the child environment is the thing production depends on and it survives any reshaping of that
      method. Note for the planner: `commandEnv()` is consumed outside the package by
      `adws/phases/buildPhase.ts:157`, `:235` and `adws/phases/scenarioFixPhase.ts:131`, which pass it
      into agent subprocess environments; whatever shape it takes must keep serving them.
    • WHAT THIS FILE DOES NOT RE-PIN. #790 owns the executor's cwd classes, stdin handling and
      missing-directory rewrap; #775 owns the repo-API cwd surface; #777 owns the missing-directory
      error surface; #658 owns mandatory identity. All stay green and unmodified. This file pins only
      what changes: where the credential comes from, when it is resolved, and who chooses it.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md` configures a
      `## Regression Scenario Directory`, so promotion is a deliberate human decision and this agent
      never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Novel phrasing introduced here. The registry has no phrase for a credential provider, a per-command
    resolution or an elevated credential class. Every phrase below is deliberately DISTINCT from the
    neighbouring GitContext families — feature-790's `the context's spawn seam records every command` /
    `the recorded executor command carried the credential token {string} in its child environment` /
    `the {string} context method is invoked`, feature-775's `the recorded repo-API command …`,
    feature-777's `the failure names …`, feature-659's `the captured command ran with cwd equal to …` —
    because all per-issue step definitions load into one global cucumber registry
    (`cucumber.js` imports `features/per-issue/step_definitions/**/*.ts`) and a verbatim reuse would
    bind to feature-790's private world, which this file's Givens never populate. The separation is
    kept legible by prefixing: this file says `operation` where feature-790 says `context method`,
    `the spawn seam records every command with the credential it carried` where feature-790 says
    `the context's spawn seam records every command`, and `credential` where feature-790 says
    `credential token`. Surfaced to the maintainer in the agent Output:
      • `a git context for the repository {string} whose credentials come from a credential provider`
      • `a second git context for the repository {string} whose credentials come from the same credential provider`
      • `a git context for the repository {string} whose credentials come from the GitHub credential source`
      • `the credential provider answers every request with {string}`
      • `the credential provider answers with a fresh credential on every request`
      • `the credential provider answers ordinary requests with {string} and elevated requests with {string}`
      • `the credential provider answers twice with {string} and fails afterwards`
      • `the credential provider fails to resolve a credential`
      • `the GitHub credential source is configured with the App installed, the personal access token {string} and the gh CLI token {string}`
      • `the GitHub credential source is configured with app {string}, personal access token {string} and gh CLI token {string}`
      • `the GitHub credential source is configured with a whitespace-only personal access token and the gh CLI token {string}`
      • `the GitHub credential source is configured with the App installed but not installed on the repository`
      • `the GitHub credential source mints a credential naming the repository it is asked for`
      • `the spawn seam records every command with the credential it carried`
      • `the ambient environment carries a stray GH_TOKEN and GITHUB_PAT of {string}`
      • `the {string} operation runs`
      • `the {string} operation runs and any failure is captured`
      • `the {string} operation runs on each context`
      • `the command {string} is executed through the public executor carrying the credential {string}`
      • `a git context is built through the launch boundary for the repository {string}`
      • `the context is asked to assemble a command environment twice`
      • `the {string} operation spawned with the credential {string}`
      • `the recorded commands carried the credentials {string} and {string} in order`
      • `the recorded command carried the credential {string}`
      • `the recorded commands each carried a different credential`
      • `the credential provider was asked exactly {int} times`
      • `the two operations spawned with the credentials {string} and {string}`
      • `no recorded command carried the stray ambient credential`
      • `no further command reached the spawn seam`
      • `no command reached the spawn seam`
      • `the operation failed with an error naming the repository {string}`
      • `the two assembled command environments carried different credentials`
      • `the run modified no process environment variable`

    Step-definition note for the maintainer (feature-791.steps.ts):

      • REUSE `gitContextSharedWorld.ts` — `FRAMEWORK_ROOT`, `TARGET_REPOS_ROOT`, `makeFullOptions`,
        `makeNoOpFsDeps`, `makeSpyExec` — and keep issue-791 bookkeeping (the provider fake and its
        call log, the operation-invocation map, the ambient-env sentinels, the env snapshot) in a
        module-private world, as feature-790.steps.ts does with `w790`. Nothing here spawns a real
        process or touches a real directory. Note that `makeSpyExec`'s `SpyCall` already records
        `env`, which is all this file needs; feature-790's plan widened it with `input`.
      • THE ONE BINDING POINT. A single module-private helper builds the context from
        `{owner, repo, provider}` and is the only place that knows the literal port shape. When the
        plan settles whether the provider arrives as an option or a dep, and whether the credential
        class is a parameter or a second method, exactly one helper changes and no scenario does.
      • THE PROVIDER FAKE is a recording function/object over a scripted answer list:
        `answers: Array<string | Error>` plus a `calls: Array<{elevated: boolean}>` log.
        `answers every request with {string}` → constant; `a fresh credential on every request` →
        `credential-1`, `credential-2`, `credential-3`, … by call index; `answers twice with {string}
        and fails afterwards` → the first two calls return that value, every later call throws;
        `ordinary requests with {string} and elevated requests with {string}` → branches on the
        credential class the core asked for, which is the ONLY place the elevated/ordinary
        distinction is interpreted.
      • THE CONSTRUCTION PROBE CONSUMES THE FIRST ANSWER. The plan validates the provider once inside
        `assertCompleteIdentity` and discards the result, so every count in this file is "one probe
        plus one per command", and the `a fresh credential on every request` scenarios start their
        commands at `credential-2`. Do NOT delete the probe to make a count come out round: it is what
        keeps the four construction-throw pins (`launchGitContext.test.ts:167`,
        `webhookRepoResolver.test.ts:357`, `feature-700.steps.ts:134`, `feature-776`) green.
      • CONTEXTS ARE BUILT LAZILY. Every scenario configures its credential source in a Given that
        FOLLOWS the context Given, so the binding helper must defer `new GitContext(…)` until the
        context is first used. A source that can produce no credential therefore surfaces its failure
        at the first operation — which is what §5's second row and §9's two failure rows capture —
        rather than throwing inside a Given.
      • THE GITHUB CREDENTIAL SOURCE steps build the port's real GitHub implementation over injected
        seams, mirroring `tokenResolver.test.ts`'s `makeInput`: `isAppConfigured`, `mintInstallationToken`,
        `ghAuthToken` and the PAT. `app "configured"` → `isAppConfigured: () => true` with a mint
        returning `installation-token::<owner>/<repo>`; `app "not configured"` → `() => false` and a
        mint that throws if called (so a wrong-order implementation fails loudly rather than
        silently). Empty Examples cells mean the source is absent — `pat: undefined`,
        `ghAuthToken: () => ''`.
      • OPERATION NAME MAP (`the {string} operation runs`), deliberately echoing feature-790's map so
        the two files read alike: `fetch-issue-comments` → `fetchIssueComments(28)`;
        `remote-url` → `remoteUrl()`; `create-pr` → `createPR('t','body','feature-x')`;
        `commit-changes` → `commitChanges('msg', ctx.worktreePathFor('feature-issue-791-x'))`;
        `approve-pr` → `approvePR(7)`; `graphql` → `runGraphQL('query { viewer { login } }')`;
        `graphql-input` → `runGraphQLInput({query: 'mutation { … }'})`;
        `board-status-move` → `moveIssueToStatus(28, 'In Progress')`.
      • WHY `commit-changes` YIELDS EXACTLY THREE COMMANDS (§2): `commitOps.commitChanges` runs
        `git status --porcelain`, then — only if status is non-empty — `git add -A` and
        `git commit -m …` (`commitOps.ts:67-70`). `makeSpyExec`'s default stdout is `'main\n'`, which
        is non-empty, so all three run without seeding a response. Assert three recorded commands AND
        three distinct credentials; do not hard-code the command strings, which belong to #790.
      • `board-status-move` SWALLOWS PARSE FAILURES and returns `false`, so against a canned seam
        answer it stops after its first command (`projectQueryCmd`) — which is the elevated one under
        test. Assert against the FIRST recorded command for that operation, not the last.
      • §7 AND §8 MUST DIFFER ONLY IN THE PAT. §8 would pass vacuously if the source were configured
        with one, and §7 would pass vacuously if the ordinary and elevated credentials were equal.
        `makeFullOptions` sets no `pat`, so §7's source must be configured with one explicitly. Note
        that the plan's GitHub implementation gives the PAT TWO roles — `pat`, a candidate in the
        resolution order after the App mint, and `alternateIdentityPat`, the credential served to an
        elevated request — while these Givens name only one "personal access token". Set BOTH fields
        from that one value, mirroring `gitContextFactory.gitContextForRepo`, or §7's elevated rows go
        green vacuously.
      • `the ambient environment carries a stray GH_TOKEN and GITHUB_PAT of {string}` sets both
        variables in the Given and restores their prior values in `After` — `tokenResolver.test.ts:27`
        precedent. `no recorded command carried the stray ambient credential` checks every recorded
        call's `env.GH_TOKEN` against the sentinel, not just the last, because a single leaking
        command is the whole bug.
      • §11 REACHES THE PUBLIC EXECUTOR DIRECTLY — `ctx.exec(command, {cwd: …, env: {GH_TOKEN: …}})` —
        and asserts BOTH that the recorded credential is the caller's AND that the provider's ask
        count never rose above the single construction probe. The second half is what fails if the
        port is consumed inside `exec()` rather than in the classifiers above it.
      • §12 CANNOT INJECT A SPAWN SEAM. `buildLaunchGitContext` constructs `new GitContext({…})` with
        no deps argument (`launchGitContext.ts:90`), so nothing can be observed at the seam. Drive it
        through `LaunchGitContextDeps` (the plan retains `resolveToken` as an injection seam and adds
        `tokenProvider`; either injection satisfies this scenario) with a counting fake, and observe
        the assembled command environment instead — the same spawn-free
        surface `adws/core/__tests__/launchGitContext.test.ts:141-143` already asserts on. Supply
        `getRepoInfo` and `resolveGitIdentity` through the same deps bag so the step touches no real
        git.
      • `the run modified no process environment variable` snapshots `{...process.env}` in the Given
        and compares key-by-key in the Then, both directions (no key added, changed or removed) —
        `gitContextSharedWorld.ts`'s `parentEnvSnapshot` and `gitContext.test.ts:210`/`:279` pattern.
        Deliberately phrased differently from feature-790's `no process environment variable was
        modified by the run`, which binds to that file's own snapshot.
      • T22 (`the ADW TypeScript type-check passes`) and G18 (`the ADW codebase is checked out`) are
        REUSED, not redefined — redefining either is an AmbiguousStepDefinition. They live in
        `feature-504.steps.ts:1126` and `features/step_definitions/ensureCronOnEveryEventSteps.ts:8`.

  Background:
    Given the ADW codebase is checked out

  # ── §1 EVERY COMMAND RESOLVES A FRESH CREDENTIAL (AC1) ──────────────────────────────────
  #
  # The slice in one scenario, and the expiry story stated behaviourally. The credential source
  # answers differently each time it is asked — which is what a source backed by an expiring,
  # self-refreshing App installation token actually does over the lifetime of a multi-hour run. Two
  # ordinary operations must carry two different credentials. The construction-time validating probe
  # (§3) takes the source's first answer and throws it away, so the two commands carry its second and
  # third. RED before: `#token` is assigned once at construction, so both commands carry the same
  # frozen string no matter how long the process has been alive.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: Two successive operations carry two successive credentials from the provider
    Given a git context for the repository "acme/webapp" whose credentials come from a credential provider
    And the credential provider answers with a fresh credential on every request
    And the spawn seam records every command with the credential it carried
    When the "fetch-issue-comments" operation runs
    And the "remote-url" operation runs
    Then the recorded commands carried the credentials "credential-2" and "credential-3" in order

  # ── §2 PER COMMAND, NOT PER OPERATION (AC1) ─────────────────────────────────────────────
  #
  # The sharp version of §1, and the row that forecloses the obvious cheap implementation: resolve
  # once when a public method is entered, reuse it for that method's commands. `commitChanges` issues
  # three commands, and an operation is exactly the unit that can outlive a token — a long `git add`
  # over a large tree between the mint and the commit is not hypothetical. Three commands, three
  # resolutions, three distinct credentials — four asks in total, counting the construction probe of
  # §3, whose answer never reaches a command.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: An operation that issues three commands resolves a credential three times
    Given a git context for the repository "acme/webapp" whose credentials come from a credential provider
    And the credential provider answers with a fresh credential on every request
    And the spawn seam records every command with the credential it carried
    When the "commit-changes" operation runs
    Then the credential provider was asked exactly 4 times
    And the recorded commands each carried a different credential

  # ── §3 CONSTRUCTION KEEPS NOTHING IT WAS TOLD (AC1) ─────────────────────────────────────
  #
  # "Never cached at construction", read on the issue's own word: what is forbidden is a construction-
  # time CACHE, not a construction-time check. Construction resolves exactly ONCE — a validating probe
  # that fails loudly when the provider can produce no credential, and then THROWS THE ANSWER AWAY —
  # so the credential reaching the first child process is the provider's SECOND answer, never the
  # probe's. That is the anti-cache criterion stated positively, and it is what a "resolve eagerly and
  # keep it, then re-resolve per command" implementation fails while still passing §1 and §2. The
  # probe is also what preserves the loud launch-time failure pinned by `launchGitContext.test.ts:167`,
  # `webhookRepoResolver.test.ts:357`, `feature-700.steps.ts:134` and `feature-776`; a zero-resolution
  # construction would delete a fail-fast this refactor was never asked to remove. RED before — today
  # construction resolves once and every command replays that answer, so the first command carries it.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: Construction validates the credential provider once and then keeps nothing it was told
    Given a git context for the repository "acme/webapp" whose credentials come from a credential provider
    And the credential provider answers with a fresh credential on every request
    And the spawn seam records every command with the credential it carried
    When the "fetch-issue-comments" operation runs
    Then the credential provider was asked exactly 2 times
    And the "fetch-issue-comments" operation spawned with the credential "credential-2"

  # ── §4 THE CORE KEEPS NO COPY OF WHAT IT WAS TOLD (AC1) ─────────────────────────────────
  #
  # The anti-cache proof that counting cannot give. The source answers twice — once for the
  # construction probe of §3, once for the first command — and then stops. A core that re-asks the
  # provider every command but quietly falls back to the last good answer when the provider fails
  # satisfies §2 and §3 exactly,
  # and is still holding a credential — one that will be served, stale, at precisely the moment the
  # source is unhealthy. The second command must fail, and must not reach the spawn seam: an expired
  # credential sent to GitHub is a 401 attributed to the wrong cause, which is worse than a loud local
  # failure naming the resolution problem.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: When the provider stops answering, the next command fails instead of reusing the last credential
    Given a git context for the repository "acme/webapp" whose credentials come from a credential provider
    And the credential provider answers twice with "credential-first" and fails afterwards
    And the spawn seam records every command with the credential it carried
    When the "fetch-issue-comments" operation runs
    Then the "fetch-issue-comments" operation spawned with the credential "credential-first"
    When the "remote-url" operation runs and any failure is captured
    Then no further command reached the spawn seam

  # ── §5 NO ENVIRONMENT READ FOR CREDENTIALS (AC2) ────────────────────────────────────────
  #
  # The ~13-incident bleed class, pinned from both sides. The ambient environment carries a stray
  # GH_TOKEN and GITHUB_PAT — the exact production condition of vestmatic #143/#181/#187, where one
  # repository's work pinned a token that another repository's work then read. The happy path is a
  # standing guard; the failure path is the sharp one, because a core that consulted the environment
  # ONLY when the provider failed would pass every other scenario in this file and quietly restore the
  # entire bug class. Note what the second row asserts: the command fails. Falling back to an ambient
  # token is not degraded service, it is service against the wrong repository.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: A stray ambient credential never reaches a child process
    Given a git context for the repository "acme/webapp" whose credentials come from a credential provider
    And the ambient environment carries a stray GH_TOKEN and GITHUB_PAT of "ambient-credential-must-not-leak"
    And the credential provider answers every request with "credential-from-provider"
    And the spawn seam records every command with the credential it carried
    When the "fetch-issue-comments" operation runs
    And the "remote-url" operation runs
    Then no recorded command carried the stray ambient credential
    And the "remote-url" operation spawned with the credential "credential-from-provider"

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: A failed resolution is not rescued by the ambient environment
    Given a git context for the repository "acme/webapp" whose credentials come from a credential provider
    And the ambient environment carries a stray GH_TOKEN and GITHUB_PAT of "ambient-credential-must-not-leak"
    And the credential provider fails to resolve a credential
    And the spawn seam records every command with the credential it carried
    When the "fetch-issue-comments" operation runs and any failure is captured
    Then no command reached the spawn seam

  # ── §6 THE PROVIDER CHOOSES; THE CORE CANNOT SUBSTITUTE (AC3) ───────────────────────────
  #
  # "PAT-versus-token selection moved out of the executor and into the provider implementation",
  # observed at runtime rather than read off a signature. First row: a provider that answers every
  # request identically makes PR approval and the board query spawn with THAT credential — proof the
  # core has no PAT of its own to reach for. Today `(usePat && this.#pat)` wins, so it is RED before.
  # Second row: the same operations against a provider that DOES distinguish get the elevated
  # credential — proof the core still tells the provider what class of credential the command needs,
  # which is the forge-neutral half of the distinction and the only part the core is allowed to keep.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario Outline: An elevated operation carries whatever the provider answers, with no substitution by the core
    Given a git context for the repository "acme/webapp" whose credentials come from a credential provider
    And the credential provider answers every request with "the-only-credential"
    And the spawn seam records every command with the credential it carried
    When the "<operation>" operation runs
    Then the "<operation>" operation spawned with the credential "the-only-credential"

    Examples:
      | operation         |
      | approve-pr        |
      | graphql           |
      | graphql-input     |
      | board-status-move |

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario Outline: The provider distinguishes elevated from ordinary requests and the core carries its answer
    Given a git context for the repository "acme/webapp" whose credentials come from a credential provider
    And the credential provider answers ordinary requests with "credential-ordinary" and elevated requests with "credential-elevated"
    And the spawn seam records every command with the credential it carried
    When the "<operation>" operation runs
    Then the "<operation>" operation spawned with the credential "<credential>"

    Examples:
      | operation            | credential          |
      | approve-pr           | credential-elevated |
      | graphql              | credential-elevated |
      | graphql-input        | credential-elevated |
      | board-status-move    | credential-elevated |
      | fetch-issue-comments | credential-ordinary |
      | create-pr            | credential-ordinary |
      | remote-url           | credential-ordinary |

  # ── §7 BOARD AND APPROVAL OPERATIONS STILL RECEIVE THE PAT (AC4) ────────────────────────
  #
  # The behaviour-unchanged half, and the reason §6 cannot be satisfied by deleting PAT selection
  # altogether. GitHub forbids an App identity from approving a PR, and Projects V2 writes are gated
  # behind a PAT on user-owned repositories — so a slice that cleaned up the core by dropping the
  # distinction would pass §6 and break PR auto-approval and every board move in production. Driven
  # through the port's real GitHub implementation, with the App configured so the resolved token is
  # the installation mint and the PAT is genuinely a different credential. GREEN before and after.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario Outline: Elevated GitHub operations spawn with the PAT while ordinary ones spawn with the resolved token
    Given a git context for the repository "acme/webapp" whose credentials come from the GitHub credential source
    And the GitHub credential source is configured with the App installed, the personal access token "token-pat" and the gh CLI token "token-gh-cli"
    And the GitHub credential source mints a credential naming the repository it is asked for
    And the spawn seam records every command with the credential it carried
    When the "<operation>" operation runs
    Then the "<operation>" operation spawned with the credential "<credential>"

    Examples:
      | operation            | credential                      |
      | approve-pr           | token-pat                       |
      | graphql              | token-pat                       |
      | graphql-input        | token-pat                       |
      | board-status-move    | token-pat                       |
      | fetch-issue-comments | installation-token::acme/webapp |
      | create-pr            | installation-token::acme/webapp |
      | remote-url           | installation-token::acme/webapp |

  # ── §8 NO PAT CONFIGURED STILL WORKS (AC4) ──────────────────────────────────────────────
  #
  # The fallback the primary code path actually runs on. `buildLaunchGitContext` never sets a PAT
  # (`launchGitContext.ts:90-98`), so every launch-boundary context has none, and today
  # `(usePat && this.#pat) ? this.#pat : this.#token` quietly hands those operations the resolved
  # token — which `runGraphQLInput`'s own comment calls "graceful fallback". A provider that threw, or
  # returned nothing, for an elevated request with no PAT configured would pass §6 and §7 and take
  # down PR auto-approval and board moves on the path most runs take. GREEN before and after.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: With no PAT configured an elevated operation falls back to the resolved token
    Given a git context for the repository "acme/webapp" whose credentials come from the GitHub credential source
    And the GitHub credential source is configured with app "configured", personal access token "" and gh CLI token ""
    And the GitHub credential source mints a credential naming the repository it is asked for
    And the spawn seam records every command with the credential it carried
    When the "approve-pr" operation runs
    And the "fetch-issue-comments" operation runs
    Then the "approve-pr" operation spawned with the credential "installation-token::acme/webapp"
    And the "fetch-issue-comments" operation spawned with the credential "installation-token::acme/webapp"

  # ── §9 RESOLUTION ORDER SURVIVES THE WRAPPING (AC5) ─────────────────────────────────────
  #
  # The order `tokenResolver.ts:49-60` implements today, re-asserted once it is a port implementation
  # rather than a function called once at a boundary. Asserted THROUGH a real command, so what is
  # proven is that the wiring delivers the resolved credential to a child process — a relocated pure
  # function that nothing consults would pass a direct unit call and fail here. The App wins outright
  # when configured, even with both other sources present; the PAT is next; `gh auth token` last. The
  # two failure rows are separate scenarios because they assert a raised error rather than a spawned
  # command: a blank PAT is not a credential, and an App configured but not installed on the
  # repository propagates loudly instead of substituting a token bound to somewhere else.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario Outline: The GitHub credential source resolves in App, PAT, gh-CLI order
    Given a git context for the repository "acme/webapp" whose credentials come from the GitHub credential source
    And the GitHub credential source is configured with app "<app>", personal access token "<pat>" and gh CLI token "<gh cli>"
    And the GitHub credential source mints a credential naming the repository it is asked for
    And the spawn seam records every command with the credential it carried
    When the "fetch-issue-comments" operation runs
    Then the "fetch-issue-comments" operation spawned with the credential "<credential>"

    Examples:
      | app            | pat            | gh cli       | credential                      |
      | configured     | github-pat-xyz | ghs-from-cli | installation-token::acme/webapp |
      | configured     |                |              | installation-token::acme/webapp |
      | not configured | github-pat-xyz | ghs-from-cli | github-pat-xyz                  |
      | not configured |                | ghs-from-cli | ghs-from-cli                    |

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: A whitespace-only personal access token is not a credential
    Given a git context for the repository "acme/webapp" whose credentials come from the GitHub credential source
    And the GitHub credential source is configured with a whitespace-only personal access token and the gh CLI token "ghs-from-cli"
    And the spawn seam records every command with the credential it carried
    When the "fetch-issue-comments" operation runs
    Then the "fetch-issue-comments" operation spawned with the credential "ghs-from-cli"

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: An App configured but not installed on the repository fails the command rather than substituting a credential
    Given a git context for the repository "acme/webapp" whose credentials come from the GitHub credential source
    And the GitHub credential source is configured with the App installed but not installed on the repository
    And the ambient environment carries a stray GH_TOKEN and GITHUB_PAT of "ambient-credential-must-not-leak"
    And the spawn seam records every command with the credential it carried
    When the "fetch-issue-comments" operation runs and any failure is captured
    Then no command reached the spawn seam

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: With no credential source at all the operation fails naming the repository
    Given a git context for the repository "acme/webapp" whose credentials come from the GitHub credential source
    And the GitHub credential source is configured with app "not configured", personal access token "" and gh CLI token ""
    And the spawn seam records every command with the credential it carried
    When the "fetch-issue-comments" operation runs and any failure is captured
    Then the operation failed with an error naming the repository "acme/webapp"
    And no command reached the spawn seam

  # ── §10 THE CREDENTIAL IS BOUND TO THE CONTEXT'S OWN REPOSITORY (AC5) ───────────────────
  #
  # The invariant the whole GitContext PRD exists to protect, re-pinned because per-command resolution
  # multiplies the number of moments at which it could go wrong by the number of commands in a run.
  # Two contexts, two repositories, two credentials, neither carrying the other's — the same property
  # `tokenResolver.test.ts:159-167` asserts on the resolver, now asserted on what reaches a child
  # process. A provider shared between contexts, or resolved without the asking context's identity,
  # is how a token for one repository ends up authenticating work on another.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: Two contexts for two repositories spawn with credentials bound to their own repository
    Given a git context for the repository "acme/webapp" whose credentials come from the GitHub credential source
    And a second git context for the repository "octo/infra" whose credentials come from the same credential provider
    And the GitHub credential source is configured with app "configured", personal access token "" and gh CLI token ""
    And the GitHub credential source mints a credential naming the repository it is asked for
    And the spawn seam records every command with the credential it carried
    When the "fetch-issue-comments" operation runs on each context
    Then the two operations spawned with the credentials "installation-token::acme/webapp" and "installation-token::octo/infra"

  # ── §11 THE PUBLIC EXECUTOR IS UNCHANGED BY THIS SLICE (#790 §6 regression guard) ───────
  #
  # The most plausible way to get this slice wrong: consume the port INSIDE `exec()`, where the
  # credential environment is assembled, instead of in the classifiers above it. That reading passes
  # §1 through §8 — every internal operation would still get a per-command credential — while
  # silently overwriting the credential of any caller that uses the public entry directly. #790 built
  # that entry precisely so the GitHub adapter (#792) can hand it a credential; an executor that
  # substituted its own would make the adapter's credential decisions unobservable at the very moment
  # they were being moved into it. Both halves are asserted: the caller's credential survives on the
  # one command that ran, and the provider's ask count stays at the single construction probe of §3 —
  # a port consumed inside `exec()` would push it to two.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: A credential handed to the public executor is not replaced by a provider-resolved one
    Given a git context for the repository "acme/webapp" whose credentials come from a credential provider
    And the credential provider answers every request with "credential-from-provider"
    And the spawn seam records every command with the credential it carried
    When the command "gh api user" is executed through the public executor carrying the credential "credential-from-caller"
    Then the recorded command carried the credential "credential-from-caller"
    And the credential provider was asked exactly 1 times

  # ── §12 THE LAUNCH BOUNDARY HANDS OVER THE QUESTION, NOT THE ANSWER (AC1 in production) ─
  #
  # The core re-resolving per command achieves nothing if the boundary resolves once and passes a
  # constant — the context would consult a port that always returns the same launch-time string, every
  # scenario above would still pass, and the expired-token defect would survive the slice intact. The
  # boundary must hand over the QUESTION: the only resolution on the clock while it builds is the
  # core's single validating probe (§3), whose answer is discarded, and every command environment the
  # returned context assembles resolves afresh. Today `launchGitContext.ts:94` calls
  # `resolveToken(owner, repo)` inside the constructor argument and that one string is replayed for
  # the life of the object, so both assertions are RED before. See the scope note: this file is not in
  # the issue's Touched Files and must be — the plan takes it into scope, so this scenario stands.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: The launch boundary hands over the provider rather than a resolved credential, and the context it returns resolves per command
    Given the credential provider answers with a fresh credential on every request
    When a git context is built through the launch boundary for the repository "acme/webapp"
    Then the credential provider was asked exactly 1 times
    When the context is asked to assemble a command environment twice
    Then the two assembled command environments carried different credentials

  # ── §13 NO PROCESS-ENVIRONMENT MUTATION ─────────────────────────────────────────────────
  #
  # The invariant every slice of this PRD carries. Per-command credentials are only safe because they
  # never become process-global. This slice raises the stakes: a credential can now differ between two
  # commands of the SAME operation, so an implementation that "simplified" by assigning to
  # `process.env` before each spawn would not merely leak across repositories — two contexts running
  # concurrently would overwrite each other mid-operation. Both paths are exercised, ordinary and
  # elevated, because either could be implemented that way independently.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: Per-command credential resolution never mutates the process environment
    Given a git context for the repository "acme/webapp" whose credentials come from a credential provider
    And the credential provider answers ordinary requests with "credential-ordinary" and elevated requests with "credential-elevated"
    And the spawn seam records every command with the credential it carried
    When the "fetch-issue-comments" operation runs
    And the "approve-pr" operation runs
    And the "commit-changes" operation runs
    Then the run modified no process environment variable

  # ── §14 Type-check backstop (T22) ───────────────────────────────────────────────────────
  #
  # A new port type in `types.ts`, reshaped classifiers in `gitContext.ts`, a wrapped implementation in
  # `tokenResolver.ts` and every construction site that passes a credential all have to agree. With
  # 348 `new GitContext(` sites across `adws/`, `features/` and `test/`, the type-checker is the only
  # cheap complete proof that the migration landed everywhere rather than in the core alone —
  # feature-775 §T, feature-769 §T and feature-790 §14 precedent. It also carries the compile-time
  # half of AC3: `adws/tsconfig.json` globs `./**/*.ts`, so this command type-checks
  # `gitContext.test.ts`, where #790's `@ts-expect-error` case pins that the executor's options cannot
  # carry `usePat`; re-admitting a GitHub-specific parameter on the way past makes that assertion
  # unused and fails here.

  @adw-791 @adw-jl4hot-introduce-tokenprovi
  Scenario: The ADW TypeScript type-check passes with credentials resolved through the TokenProvider port
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
