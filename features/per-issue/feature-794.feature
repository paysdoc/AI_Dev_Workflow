@adw-794 @adw-ncj1hq-launch-boundary-mint
Feature: The launch boundary mints forge providers bound to the context identity — one call, one identity read, providers and git context that cannot disagree about which repository they address

  Issue #794 is the fifth slice of the GitContext forge-agnostic refactor
  (`specs/prd/gitcontext-forge-agnostic-refactor.md`). #790 promoted the spawn chokepoint to a public
  executor, #791 replaced the construction-time credential with a TokenProvider port, #792 moved the
  GitHub material into the forge adapter. Those three reshaped what a provider is BUILT ON. This one
  decides WHERE a provider may be built at all.

  The PRD names the hazard in its own Solution section: "if migrated callers construct their own
  provider instances with hand-picked owner/repo arguments scattered across call sites, identity
  selection re-fragments and the wrong-repo bug class returns in new clothing." The migration slices
  that follow (#796, #797) move ~20 modules onto the provider interfaces. If those modules each
  reach for a provider factory with their own idea of owner/repo, the refactor will have rebuilt the
  disease GitContext cured. This slice builds the alternative — one call that hands back both — so
  the migration has somewhere to land, and #795's guard rule has something to point at.

  Today the boundary hands back HALF of what a launch needs. `buildLaunchGitContext`
  (`adws/core/launchGitContext.ts:119`) resolves one identity — `targetRepo ?? getInfo()` — and
  returns a `GitContext` and nothing else. Every consumer then goes and gets its providers somewhere
  else, from an identity it derives a SECOND time:

    • `adws/adwMerge.tsx:270-271` — `buildLaunchGitContext(targetRepo)` on one line,
      `buildRepoIdentifier(targetRepo)` on the next. Two derivations from one argument; when
      `targetRepo` is null they are two INDEPENDENT reads of the local git remote
      (`launchGitContext.ts:131` and `orchestratorCli.ts:143`).
    • `adws/triggers/trigger_cron.ts:76` builds the launch context; `:82` fetches the issue list
      through `gitContextForRepo(cronRepoInfo)` — a second context, from `resolveCronRepo`'s
      identity, constructed ad hoc at the call site.
    • `adws/phases/workflowInit.ts:137` builds the launch context from `targetRepo`; `:305` builds
      the RepoContext from `options?.repoId ?? (repoInfo ?? getRepoInfo())`. A caller that passes a
      `repoId` naming one repository and a `targetRepo` naming another gets a config whose
      `gitContext` and `repoContext` address DIFFERENT repositories, silently, with no error — and
      `crossCheckRepoIdentity` at `:327` only ever sees the gitContext half.

  After this slice there is one call, one identity resolution, and a result that carries the context
  and its IssueTracker / CodeHost / BoardManager together. Divergence stops being a bug to catch and
  becomes a state with no way to construct.

  The behavioural contract pinned below:

     1. THE BOUNDARY HANDS BACK PROVIDERS AT ALL (AC1). The load-bearing RED. One call yields a git
        context AND an issue tracker AND a code host AND a board manager. Everything else in this
        file presumes there is something to compare; this row is the one that fails today for the
        plainest possible reason — `buildLaunchGitContext` returns a bare `GitContext`.
     2. EVERY MINTED PROVIDER CARRIES THE CONTEXT'S IDENTITY (AC1, AC4). The equivalence AC4 asks
        for, stated per provider: the identity each of the three was minted from is the identity the
        git context reports. Asserted through a recorded mint so that all three are covered
        uniformly — only `CodeHost` exposes an identity accessor (`types.ts`, `getRepoIdentifier`);
        `IssueTracker` and `BoardManager` expose none. See the observability note.
     3. THE UNINJECTED PATH IS THE ONE THAT SHIPS (AC4, the anti-vacuity row). §2 observes a seam;
        a seam proves nothing if production wiring differs from it. With no provider seam injected
        at all, the boundary's code host reports — through its own public accessor — the repository
        the boundary's git context names. One provider is all this row can reach, and it is enough
        to prove the default wiring is not a fiction.
     4. ONE IDENTITY READ, NOT SEVERAL (AC1, "no code path can produce divergent identities from one
        call"). The sharp one. A local git remote that answers `acme/webapp` on its first read and
        `octo/infra` on every later read is exactly the shape today's consumers are exposed to —
        adwMerge reads it twice, workflowInit up to three times, and nothing forces the answers to
        agree. One boundary call must consult it AT MOST ONCE and hand every product the same
        answer. An implementation that resolves identity once for the context and again for the
        providers passes §2 (both agree when the remote is stable) and fails here.
     5. THE TARGET ARGUMENT WINS AND THE REMOTE IS NEVER CONSULTED (AC1, the wrong-repo invariant).
        The other direction. With `--target-repo octo/infra` present, the local remote — which would
        answer `acme/webapp` — is not read at all, by the context or by any provider. This is the
        invariant `launchGitContext.test.ts:69` already pins for the context half; the providers
        must not reintroduce a fallback the context does not have.
     6. THE THREE NAMED CONSUMERS GET THEIR PROVIDERS THIS WAY (AC3). Cron, merge and workflow init
        each parse their own launch arguments through their own resolver — `resolveCronRepo`,
        `parseTargetRepoArgs`, `targetRepo ?? null`. Each of those resolutions, fed to the boundary,
        yields providers bound to the repository the arguments named, in both the target and the
        self-host shape. This is AC3 driven through the real argument paths; what it cannot reach is
        the orchestrator processes themselves — see the scope note.
     7. PROVIDERS ARE MINTED BEFORE THE WORKSPACE EXISTS (AC3, a hazard found in the code). A trap
        the obvious implementation walks straight into. The natural move is to reuse
        `createRepoContext` (`repoContext.ts`), which validates that the working directory exists,
        is a directory, contains `.git`, and has a matching `origin` remote. But `adwMerge.tsx:270`
        asks the boundary for its context BEFORE `ensureTargetRepoWorkspace(targetRepo)` at `:274`,
        and `trigger_cron.ts:76` builds its context at module load, before anything is cloned. A
        boundary that validated the workspace would abort both on a first-ever run against a new
        target repo. The boundary must mint from the identity alone.
     8. SELECTION STAYS CONFIG-DRIVEN PER TARGET REPO, DEFAULTING TO GITHUB (AC2). Four rows, all
        about `.adw/providers.md` in the workspace of the repository being launched: absent
        configuration yields the full GitHub set; a configured platform ADW has no implementation
        for is refused BY NAME rather than quietly substituted with GitHub; an unparseable platform
        value is refused naming the value; and two repositories launched in one process get their
        own answers. Substitution is the failure mode that matters here — a boundary that fell back
        to GitHub when it could not honour a repo's configuration would address the right repository
        through the wrong forge, which is the wrong-repo bug class wearing a different hat. The
        refusal is observed when the boundary's providers are REQUESTED, which holds whether they
        are minted eagerly in the call or on first request — see the scope note.
     9. THE CONTEXT HALF IS UNCHANGED (the regression net). This slice adds to what the boundary
        can hand back, and the call sites that stay on the context-only view must not notice.
        Base-path resolution for both launch shapes, and per-command credential resolution (#791's
        property), must survive the change untouched. GREEN before and after.
    10. THE RESULT CANNOT BE RE-POINTED AFTER THE FACT (AC1, the last hole). "No code path can
        produce divergent identities from one call" includes the path where a caller takes the
        result and reassigns a provider or an identity field on it. `createRepoContext` already
        freezes what it returns (`repoContext.ts:268`); the boundary result inherits
        that discipline or it does not hold it.
    11. DOWNSTREAM RECEIVES THE BOUNDARY'S PROVIDERS RATHER THAN BUILDING ITS OWN (AC3). The
        receiving half of AC3, at the one seam this harness can reach. `createRepoContext`
        (`repoContext.ts`) is what workflow init calls to get its providers; handed the boundary's
        triple it must reuse those exact instances rather than resolving a second set, and it must
        still refuse a workspace whose `origin` contradicts the declared identity. A passthrough
        that quietly re-resolved would hand workflow init providers the boundary never minted —
        AC3 satisfied in the type system and defeated in fact.
    12. TYPE-CHECK BACKSTOP (T22). The boundary gains a return shape
        (`buildLaunchBoundary`) beside the one it already has; the call sites that adopt it
        (`adwMerge.tsx:270`, `trigger_cron.ts:76`, `workflowInit.ts:137`), the ones that stay on
        the context-only view (`trigger_webhook.ts:158`, `promotionSweep.ts:283`), and
        `launchGitContext.test.ts` / `webhookRepoResolver.test.ts` all have to agree.

  Mapping onto the issue's acceptance criteria:
    AC1 (one call yields context + providers on one identity; no path to divergent identities)
        → §1, §2, §4, §5, §10.
    AC2 (selection stays config-driven per target repo, defaulting to GitHub, unchanged) → §8.
    AC3 (cron, merge and workflow init receive providers through the boundary result) → §6, §7,
        §11, with §12 as the compile-time half. The orchestrator processes themselves are out of
        the harness's reach — scope note below.
    AC4 (tests assert identity binding equivalence between the minted context and providers)
        → §2 and §3. The criterion is literally about the unit suites named in Touched Files
        (`launchGitContext.test.ts`, `repoContext.test.ts`); those are a plan VALIDATION command
        (`bun run test:unit`), not a scenario — following feature-790's and feature-792's precedent
        for criteria phrased as "tests exist". §2 and §3 are the behavioural mirror, so an
        implementation that satisfies AC4 with a vacuous unit test still fails this file.

  Observability / rot-prevention note:

    Every assertion targets something the system PRODUCES: the object graph one boundary call
    returns, the values its public accessors report, the `(kind, identity)` pairs handed to an
    injected provider-mint seam (vocabulary surface #2, recorded calls), the number of times an
    injected remote-reader was called, the error a refused call raises, the object identity of the
    provider instances a repo context carries, the `(command, env)` tuple handed to the injected
    command seam, and the type-checker's exit status. The `.adw/providers.md`
    files written under §8 are INPUTS the step itself authors into a throwaway directory — the same
    shape as the `G-HC*` hash-computer fixtures — never framework source. No step reads a framework
    source file as text, substring-matches its contents, or parses it as JSON or AST.

    THE OBSERVABILITY LIMIT, SAID OUT LOUD: of the three provider interfaces, only `CodeHost`
    exposes its bound identity (`getRepoIdentifier()`). `IssueTracker` and `BoardManager` expose no
    accessor, and their operations reach a repository through `adws/github/*Api.ts`, which construct
    their own contexts internally (`issueApi.ts:128`, `gitContextForRepo`) — so no injected seam of
    this file's can observe the repository an issue-tracker call addresses. §2 therefore observes
    all three at the moment of minting, and §3 covers the production path for the one provider that
    can answer for itself. The residual gap is real and worth naming: a provider minted from the
    right identity that then addresses a different repository internally is invisible here. If the
    implementer adds identity accessors to `IssueTracker` and `BoardManager`, §2 can be strengthened
    to read them directly — that is an option, not a requirement of this issue.

  Scope notes — four findings from writing these scenarios, all for review:

    • WHAT §8 PINS IS THE REFUSAL, NOT THE MOMENT IT HAPPENS — RESOLVED. Two separable questions
      hide in "selection unchanged". WHAT happens on a platform ADW cannot serve: it is refused BY
      NAME, never substituted with GitHub (`repoContext.ts`, `resolveIssueTracker` throws on any
      non-GitHub platform). That is settled, it is what AC2 means read literally, and §8 pins it.
      WHEN it happens — at the boundary call, or at the first request for the boundary's providers
      — is a consumer-visible decision, because today `workflowInit.ts:305-310` wraps
      `createRepoContext` in a try/catch and logs "Failed to create RepoContext (falling back to
      direct API calls)", so a repo whose configuration names an unimplemented platform runs
      anyway. Eager minting would move that failure to process launch: for cron, module load
      (`trigger_cron.ts:76`); for merge, before the spawn lock is taken. The plan settles this on
      the side of AC2's "unchanged" and the parent PRD's "operationally invisible" bar — providers
      are minted on first request and memoised, so the boundary CALL gains no new failure mode and
      the refusal surfaces exactly where it surfaces today. §8 is therefore worded to observe the
      refusal when the providers are REQUESTED, which is satisfied by either implementation and
      pins the behaviour AC2 actually names.
    • THE BOUNDARY CANNOT REUSE `createRepoContext` WHOLESALE. §7's rationale, repeated here because
      it is the single most likely implementation mistake: `createRepoContext` runs
      `validateWorkingDirectory` and `validateGitRemote` (a real `git remote get-url` through
      `gitContextForRepo`) before it resolves anything. The boundary is called before the workspace
      is cloned, and in cron's case before `main()` has run at all. The sanctioned pieces to build on
      are the `resolveIssueTracker` / `resolveCodeHost` / `resolveBoardManager` factories and
      `loadProviderConfig` — which is why `repoContext.ts` is a Touched File and why the identity,
      not the workspace, is the input.
    • THE NON-GITHUB SELECTION PATH CANNOT BE EXERCISED POSITIVELY IN THIS HARNESS. `GITLAB_TOKEN`
      is a load-time constant (`adws/core/environment.ts:124`), so a Given cannot arrange for
      `createGitLabCodeHost` to succeed — the value is frozen before any step runs. §8's non-GitHub
      rows therefore use platforms whose refusal is deterministic regardless of ambient environment
      (`bitbucket` for the code host, `gitlab` for the issue tracker — neither has an
      implementation) and prove selection through the refusal rather than through a minted GitLab
      provider. The positive GitLab path stays covered where it already is, in the provider suites.
    • AC3 CANNOT BE DRIVEN THROUGH THE ORCHESTRATOR PROCESSES. All three consumers hide their
      boundary call behind an entry-script guard: `trigger_cron.ts:75` checks `process.argv[1]`,
      `adwMerge.tsx:292` checks `import.meta.url`, and the regression harness's own
      `the workflow is initialised with config {string}` step (W9) is a pending stub
      (`features/regression/step_definitions/whenSteps.ts:245`) because `initializeWorkflow` needs a
      stubbed Claude CLI and GitHub API to run at all. §6 drives each consumer's REAL argument
      resolver into the boundary, which is the part of the consumer this slice changes, and §11
      drives the real `createRepoContext` — the function workflow init reaches its providers
      through — to prove the receiving end reuses what it was handed. What neither can see is a
      consumer that receives providers and then ignores them to construct its own somewhere else.
      That is precisely what #795's guard rule exists to make structural, and until it lands, code
      review is the witness.

  Testing notes for the step definitions:

    • THE BOUNDARY IS DRIVEN THROUGH ITS EXISTING INJECTION SEAMS, exactly as feature-660,
      feature-700 and feature-791 drive it: `buildLaunchGitContext(targetRepo, deps)` with
      `LaunchGitContextDeps` supplying `getRepoInfo`, `tokenProvider`, `resolveGitIdentity`,
      `frameworkRepoRoot` and `targetReposDir`. `makeTestDeps` in
      `features/per-issue/step_definitions/feature-660.steps.ts:80` is the model. Do not reuse
      feature-660's Given/When phrases — they write into that file's world, not this one's, and the
      step bodies here need a recording remote-reader that file's does not have.
    • THE PROVIDER-MINT SEAM IS NEW AND OPTIONAL, in the shape `LaunchGitContextDeps` already uses:
      one more optional field, `mintProviders`, taking the boundary's `RepoIdentifier` plus the two
      selected platforms and returning the triple, defaulting to the real `mintBoundProviders` in
      `repoContext.ts` (which is the existing `resolveIssueTracker` / `resolveCodeHost` /
      `resolveBoardManager` trio, lifted out of `createRepoContext`). The step records one
      `(kind, RepoIdentifier)` entry per provider kind from the identity the seam was handed, and
      returns stand-in objects. §3 is the row that must NOT install it — build the boundary with
      the seam absent and read `codeHost.getRepoIdentifier()`.
    • §11 NEEDS A REAL FIXTURE REPOSITORY, because `createRepoContext` runs `validateWorkingDirectory`
      and `validateGitRemote` before it does anything else, and `validateGitRemote` shells a real
      `git remote get-url` through `gitContextForRepo`. `feature-565.steps.ts:265` already drives
      `validateGitRemote` successfully in this harness against a `mkdtempSync` + `execSync('git init')`
      workspace with an `origin` set to the declared owner/repo — copy that setup. The "same
      instances" assertion is object identity (`assert.strictEqual`) between
      `repoContext.issueTracker` / `.codeHost` and the objects the boundary handed back; nothing is
      read from a source file.
    • THE REMOTE READER MUST COUNT ITS CALLS AND MAY ANSWER DIFFERENTLY PER CALL. §4 needs an answer
      sequence (first `acme/webapp`, then `octo/infra` forever); §5 and §4 both assert the call
      count. A `getRepoInfo` fake that pushes to an array and shifts a queue covers all three rows.
    • THE ROOTS ARE THROWAWAY DIRECTORIES, one per scenario, removed in `After`. §8 writes
      `<targetReposDir>/<owner>/<repo>/.adw/providers.md` from the docstring; §7 deliberately writes
      nothing, so the workspace path resolves to a directory that does not exist. Nothing in this
      file touches the real `TARGET_REPOS_DIR` or `REPO_ROOT`.
    • §6's CONSUMER RESOLVERS ARE THE REAL ONES, imported directly: `cron` →
      `resolveCronRepo(args, fallback)` (`adws/triggers/cronRepoResolver.ts:21`); `merge` →
      `parseTargetRepoArgs(args)` (`adws/core/orchestratorCli.ts:156`); `workflow init` →
      `parseTargetRepoArgs(args)` then `targetRepo ?? null`, which is the expression at
      `workflowInit.ts:137`. Note that `parseTargetRepoArgs` MUTATES the array it is handed while
      `resolveCronRepo` copies first — pass a fresh array per row. An empty launch-arguments cell
      means "no arguments", and the fallback the step supplies is the recording remote reader, so
      the self-host rows also exercise the call counter.
    • §9's CREDENTIAL ROW REUSES #791's PROPERTY THROUGH THIS FILE'S OWN WORDING. The context is
      built with a token provider that answers a new credential per request and a recording exec
      seam (`new GitContext(options, { exec })` is not reachable from the boundary, so record via
      `deps.tokenProvider` call count and `ctx.commandEnv` instead — the boundary constructs the
      context itself, which is the point of the row). Two operations, two different credentials.
    • §10's STEP MUST CATCH. Reassigning a property of a frozen object throws `TypeError` under ES
      module strict mode; returning silently is also a legal outcome for a non-frozen result whose
      identity is read from elsewhere. The step attempts the reassignment inside try/catch and then
      asserts the identity is unchanged, so both implementations of "cannot be re-pointed" pass and
      a mutable result fails.
    • REUSED, NOT REDEFINED — redefining either is an AmbiguousStepDefinition: `the ADW codebase is
      checked out` (G18, `features/step_definitions/ensureCronOnEveryEventSteps.ts:8`) and `the ADW
      TypeScript type-check passes` (T22, `feature-504.steps.ts:1126`).
    • EVERY OTHER PHRASE BELOW IS NEW. Two neighbourhoods needed deliberate distance: feature-791
      owns the phrase family built on "the credential provider …", so this file says "the boundary
      resolves credentials from …" for the same kind of seam; and feature-660 owns "the boundary
      context …", so this file says "the boundary's git context …". "Provider" in feature-791 means
      a CREDENTIAL provider; in this file the three forge providers are always named individually —
      issue tracker, code host, board manager — for exactly that reason.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE BOUNDARY HANDS BACK PROVIDERS AT ALL (AC1) ────────────────────────────────────
  #
  # The plainest RED in the file. Today `buildLaunchGitContext` resolves one identity and returns a
  # bare `GitContext`; a caller that wants an issue tracker goes and builds one somewhere else, from
  # an identity it derives again. Every other scenario here presumes there is something to compare
  # against the context — this row is the one that establishes there is.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: One boundary call yields a git context together with its three forge providers
    Given a launch boundary rooted in throwaway framework and target-repos directories
    When the launch boundary is asked for the repository "acme/webapp"
    Then the boundary result carries a git context, an issue tracker, a code host and a board manager

  # ── §2 EVERY MINTED PROVIDER CARRIES THE CONTEXT'S IDENTITY (AC1, AC4) ───────────────────
  #
  # AC4's "identity binding equivalence" stated per provider. Observed at the moment of minting
  # because that is the only surface all three share — `IssueTracker` and `BoardManager` expose no
  # identity accessor, so a uniform assertion has to watch what the boundary HANDED to the factory.
  # A boundary that minted the code host from the launch argument and the issue tracker from a
  # second read of the remote fails this row the moment the two disagree; §4 makes them disagree on
  # purpose.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario Outline: Each provider the boundary mints was minted from the identity its git context names
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And every provider the boundary mints is recorded with the identity it was minted from
    When the launch boundary is asked for the repository "octo/infra"
    Then the boundary's git context names the repository "octo/infra"
    And the boundary's <provider> was minted for the repository "octo/infra"

    Examples:
      | provider      |
      | issue tracker |
      | code host     |
      | board manager |

  # ── §3 THE UNINJECTED PATH IS THE ONE THAT SHIPS (AC4) ───────────────────────────────────
  #
  # §2 watches a seam. A seam that production does not use proves nothing, and this file would be
  # vacuous without one row that installs no seam at all. `CodeHost.getRepoIdentifier()` is the only
  # identity a provider will report about itself, so it is the only witness available for the real
  # wiring — and it is enough to prove the default is not a fiction. Both launch shapes, because the
  # self-host shape is the one whose identity comes from the remote rather than from an argument.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: With no provider seam injected, the boundary's code host reports the repository its context names
    Given a launch boundary rooted in throwaway framework and target-repos directories
    When the launch boundary is asked for the repository "acme/webapp"
    Then the boundary's git context names the repository "acme/webapp"
    And the boundary's code host reports the repository "acme/webapp"

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: A self-host launch binds its code host to the identity the remote answered
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the local git remote at the launch boundary answers "acme/webapp"
    When the launch boundary is asked with no target repository
    Then the boundary's git context names the repository "acme/webapp"
    And the boundary's code host reports the repository "acme/webapp"

  # ── §4 ONE IDENTITY READ, NOT SEVERAL (AC1) ──────────────────────────────────────────────
  #
  # The scenario the issue's second clause is about: "no code path can produce divergent identities
  # from one call". A remote that answers differently on a second read is not a contrived fixture —
  # it is the hazard adwMerge lives with today, reading it once at `launchGitContext.ts:131` and
  # again at `orchestratorCli.ts:143`, and workflowInit up to three times. An implementation that
  # resolves identity once for the context and again for the providers passes §2 and §3 (both agree
  # while the remote is stable) and fails only here. Two assertions, deliberately: the products
  # agree, AND the read happened at most once — the second is what makes the first non-accidental.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: A git remote that answers differently on a second read cannot split the boundary's identity
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the local git remote at the launch boundary answers "acme/webapp" first and "octo/infra" on every later read
    And every provider the boundary mints is recorded with the identity it was minted from
    When the launch boundary is asked with no target repository
    Then the boundary's git context names the repository "acme/webapp"
    And the boundary's issue tracker was minted for the repository "acme/webapp"
    And the boundary's code host was minted for the repository "acme/webapp"
    And the boundary's board manager was minted for the repository "acme/webapp"
    And the launch boundary read the local git remote at most once

  # ── §5 THE TARGET ARGUMENT WINS AND THE REMOTE IS NEVER CONSULTED (AC1) ──────────────────
  #
  # The other direction, and the invariant `launchGitContext.test.ts:69` already holds for the
  # context half: when `--target-repo` names a repository, the local remote is not a fallback, not a
  # cross-check, and not read. The providers must inherit that — a provider factory that reached for
  # `getRepoInfo()` when its caller did not hand it an identity would reopen the wrong-repo class on
  # a machine whose checkout happens to be something else.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: A target launch binds every provider to the argument and never reads the local remote
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the local git remote at the launch boundary answers "acme/webapp"
    And every provider the boundary mints is recorded with the identity it was minted from
    When the launch boundary is asked for the repository "octo/infra"
    Then the boundary's git context names the repository "octo/infra"
    And the boundary's issue tracker was minted for the repository "octo/infra"
    And the boundary's code host was minted for the repository "octo/infra"
    And the boundary's board manager was minted for the repository "octo/infra"
    And the launch boundary never read the local git remote

  # ── §6 THE THREE NAMED CONSUMERS GET THEIR PROVIDERS THIS WAY (AC3) ──────────────────────
  #
  # AC3 names cron, merge and workflow init. Each one resolves its launch identity through a
  # different real function — `resolveCronRepo`, `parseTargetRepoArgs`, and workflowInit's
  # `targetRepo ?? null` — and each is driven here with the arguments its orchestrator actually
  # receives, in both shapes: a target repo named on the command line, and no target repo at all
  # (where identity comes from the remote). What this cannot reach is the orchestrator processes
  # themselves; see the scope note on entry-script guards.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario Outline: A consumer's own launch arguments produce providers bound to the repository they name
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the local git remote at the launch boundary answers "acme/webapp"
    And every provider the boundary mints is recorded with the identity it was minted from
    When the "<consumer>" consumer resolves the launch arguments "<arguments>" and asks the boundary
    Then the boundary's git context names the repository "<repository>"
    And the boundary's issue tracker was minted for the repository "<repository>"
    And the boundary's code host was minted for the repository "<repository>"
    And the boundary's board manager was minted for the repository "<repository>"

    Examples:
      | consumer      | arguments                            | repository  |
      | cron          | --target-repo octo/infra             | octo/infra  |
      | cron          |                                      | acme/webapp |
      | merge         | 42 abc123 --target-repo octo/infra   | octo/infra  |
      | merge         | 42 abc123                            | acme/webapp |
      | workflow init | 42 abc123 --target-repo octo/infra   | octo/infra  |
      | workflow init | 42 abc123                            | acme/webapp |

  # ── §7 PROVIDERS ARE MINTED BEFORE THE WORKSPACE EXISTS (AC3) ────────────────────────────
  #
  # The trap. `createRepoContext` is the obvious thing to reuse and it validates the working
  # directory, its `.git`, and its `origin` remote before resolving a single provider. But
  # `adwMerge.tsx:270` asks the boundary for its context four lines BEFORE
  # `ensureTargetRepoWorkspace(targetRepo)`, and `trigger_cron.ts:76` builds its context at module
  # load. A boundary that validated the workspace would abort every first run against a
  # not-yet-cloned target repo — a regression with no error message anyone would connect to this
  # slice. The identity is the input; the workspace is not.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: A target repository that has not been cloned yet still gets its providers minted
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the workspace for the repository "octo/infra" has not been cloned
    And every provider the boundary mints is recorded with the identity it was minted from
    When the launch boundary is asked for the repository "octo/infra"
    Then the boundary result carries a git context, an issue tracker, a code host and a board manager
    And the boundary's issue tracker was minted for the repository "octo/infra"
    And the boundary's code host was minted for the repository "octo/infra"

  # ── §8 SELECTION STAYS CONFIG-DRIVEN PER TARGET REPO, DEFAULTING TO GITHUB (AC2) ─────────
  #
  # AC2 asks for "unchanged", which is a claim about four behaviours, one row each. Absent
  # configuration must default to the full GitHub set — that is what every target repo in production
  # relies on today. A platform ADW has no implementation for must be refused BY NAME: substituting
  # GitHub would address the right repository through the wrong forge, which is the wrong-repo bug
  # class in different clothes, and it is the failure a "sensible default" would introduce here
  # without anyone noticing. An unparseable value must name the value, because a silent fall-through
  # to GitHub on a typo is the same defect with a friendlier cause. And the answers must be
  # per-repository, since one cron host polls many targets in one process.
  #
  # The refusal rows ask the boundary for the repository AND for its providers, capturing whatever
  # fails. That is deliberate: AC2 is a claim about WHAT selection does, not about when the config
  # is read, and the plan mints on first request so the boundary call itself gains no new failure
  # mode. Either implementation satisfies these rows; a substituting one satisfies neither.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: A target repository with no provider configuration gets the default GitHub set
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the workspace for the repository "acme/webapp" carries no provider configuration
    When the launch boundary is asked for the repository "acme/webapp"
    Then the boundary result carries a git context, an issue tracker, a code host and a board manager
    And the boundary's code host reports the repository "acme/webapp"

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: A repository configured for an issue tracker ADW cannot serve is refused by name, not substituted
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the workspace for the repository "acme/webapp" carries the provider configuration:
      """
      ## Issue Tracker
      gitlab
      """
    When the boundary's providers are requested for the repository "acme/webapp" and any failure is captured
    Then the provider request failed naming the platform "gitlab"
    And the boundary handed back no providers

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: A repository configured for a code host ADW cannot serve is refused by name, not substituted
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the workspace for the repository "acme/webapp" carries the provider configuration:
      """
      ## Code Host
      bitbucket
      """
    When the boundary's providers are requested for the repository "acme/webapp" and any failure is captured
    Then the provider request failed naming the platform "bitbucket"
    And the boundary handed back no providers

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: An unparseable platform value is refused naming the value rather than falling back to GitHub
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the workspace for the repository "acme/webapp" carries the provider configuration:
      """
      ## Code Host
      bananas
      """
    When the boundary's providers are requested for the repository "acme/webapp" and any failure is captured
    Then the provider request failed naming the platform "bananas"
    And the boundary handed back no providers

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: Two target repositories launched in one process each get the selection their own configuration names
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the workspace for the repository "acme/webapp" carries no provider configuration
    And the workspace for the repository "octo/infra" carries the provider configuration:
      """
      ## Issue Tracker
      gitlab
      """
    When the boundary's providers are requested for the repository "acme/webapp" and any failure is captured
    Then the boundary result carries a git context, an issue tracker, a code host and a board manager
    When the boundary's providers are requested for the repository "octo/infra" and any failure is captured
    Then the provider request failed naming the platform "gitlab"

  # ── §9 THE CONTEXT HALF IS UNCHANGED (the regression net) ────────────────────────────────
  #
  # This slice adds a richer result beside the context the boundary already hands back, and edits
  # the call sites that adopt it while `trigger_webhook.ts:158` and `promotionSweep.ts:283` stay on
  # the context-only view. The properties all of them depend on are base-path resolution — target
  # launches under the target-repos root, self-host launches at the framework root — and #791's
  # per-command credential resolution, which is the reason a long-running orchestrator does not
  # replay an expired installation token hours later. GREEN before and after; the risk is the
  # rework behind the new result quietly dropping one of them.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: A target launch still resolves its base path under the target-repos root
    Given a launch boundary rooted in throwaway framework and target-repos directories
    When the launch boundary is asked for the repository "octo/infra"
    Then the boundary's git context works from the target-repos root path for "octo/infra"

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: A self-host launch still resolves its base path to the framework root
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the local git remote at the launch boundary answers "acme/webapp"
    When the launch boundary is asked with no target repository
    Then the boundary's git context works from the framework root path

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: The context the boundary returns still resolves a fresh credential for every command
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the boundary resolves credentials from a source that answers a new credential each time
    When the launch boundary is asked for the repository "acme/webapp"
    And the boundary's git context assembles the environment for two commands
    Then the two commands carried different credentials

  # ── §10 THE RESULT CANNOT BE RE-POINTED AFTER THE FACT (AC1) ─────────────────────────────
  #
  # The last way to get divergent identities out of one call: take the result and reassign something
  # on it. `createRepoContext` already freezes what it hands back; a boundary result that does not
  # inherit that discipline leaves the invariant to convention, which is what this whole PRD is
  # replacing. The step attempts the reassignment and catches whatever happens, so a frozen result
  # (throws) and a getter-backed one (silently ignores) both pass, and only a mutable one fails.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: The boundary result cannot be re-pointed at another repository after it is handed over
    Given a launch boundary rooted in throwaway framework and target-repos directories
    When the launch boundary is asked for the repository "acme/webapp"
    And the boundary result is re-pointed at the repository "octo/infra"
    Then the boundary's git context names the repository "acme/webapp"
    And the boundary's code host reports the repository "acme/webapp"

  # ── §11 DOWNSTREAM RECEIVES, IT DOES NOT CONSTRUCT (AC3) ─────────────────────────────────
  #
  # AC3's other half. §6 proves the boundary hands back providers bound to what a consumer's own
  # arguments named; this proves the consuming end actually USES them. Workflow init reaches its
  # providers through `createRepoContext` (`workflowInit.ts:305`), which today resolves a second
  # set from an identity it derives itself. Handed the boundary's triple it must reuse those exact
  # instances — a passthrough that re-resolved would satisfy AC3 in the type system and defeat it
  # in fact, since the reused instances are the only evidence the boundary's identity travelled.
  # And the workspace validation `createRepoContext` exists for must survive the passthrough: a
  # worktree whose `origin` contradicts the declared repository is still refused, because handing
  # in providers is not a way to skip the check that catches a wrong-repo worktree.
  #
  # This is the seam the harness CAN reach; `initializeWorkflow` itself cannot be driven (see the
  # scope note on entry-script guards), and the identity `createRepoContext` is handed is #796's
  # migration, not this slice's.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: A repo context built from the boundary's providers reuses the very instances the boundary minted
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And a cloned workspace whose origin remote names the repository "acme/webapp"
    When the launch boundary is asked for the repository "acme/webapp"
    And a repo context is built for that workspace from the boundary's providers
    Then the repo context carries the same issue tracker and code host instances the boundary minted

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: A workspace whose origin contradicts the declared repository is refused even when providers are handed in
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And a cloned workspace whose origin remote names the repository "acme/webapp"
    When the launch boundary is asked for the repository "octo/infra"
    And a repo context is built for that workspace from the boundary's providers and any failure is captured
    Then building the repo context failed naming the repository the remote actually points at

  # ── §12 TYPE-CHECK BACKSTOP (T22) ────────────────────────────────────────────────────────
  #
  # The boundary gains a result shape beside the one it already returns, three call sites adopt it,
  # two stay on the context-only view, and two suites read both. Nothing else in this file would
  # notice a consumer left reading the wrong one.

  @adw-794 @adw-ncj1hq-launch-boundary-mint
  Scenario: The ADW TypeScript type-check passes with providers minted at the launch boundary
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
