@adw-664 @adw-5vjxem-gitcontext-boundary
Feature: GitContext boundary constructor — the webhook server builds one context PER EVENT from the event payload's repository, so interleaved multi-repo events never cross-contaminate auth or paths

  Issue #664 (parent PRD `specs/prd/git-context-repo-authority.md`, see
  **Boundary constructors** and **Testing Decisions §3**) is the webhook half of the
  boundary-constructor work. #658 shipped the `GitContext` deep module (mandatory
  identity, the one-constructor base-path decision, `worktreePathFor`, and the
  `commandEnv()` per-command env overlay). #659 routed an operation's spawn through
  the context so the per-command auth/env injection path is proven end to end. #660
  wired the launch-boundary constructor (`buildLaunchGitContext`) into the cron /
  standalone-orchestrator entry points and the merge handoff. #660 explicitly left
  the webhook per-event context (PRD story 12) OUT of scope — this slice owns it.

  What this slice builds:

    • The long-lived webhook server (`adws/triggers/trigger_webhook.ts`) constructs
      EXACTLY ONE `GitContext` PER EVENT from that event payload's repository, and
      threads it through that event's handling. The per-event context is built from
      the same authoritative identity the webhook already extracts from the payload
      (`body.repository.full_name` / `clone_url`, via `extractTargetRepoArgs` /
      `getRepoInfoFromPayload`), composed with the launch-boundary constructor.
    • The per-event context REPLACES the receipt-time `ensureAppAuthForRepo` +
      process-global auth: auth and base path ride ON the per-event context and are
      injected per command, so handling events for multiple repos in one process can
      no longer cross-contaminate auth or paths across interleaved async
      continuations.

  Why this slice exists — the defect it forecloses:

    Today the webhook authenticates each request by MUTATING a process-global
    (`ensureAppAuthForRepo(owner, repo)` at receipt, `adws/triggers/trigger_webhook.ts`
    lines 107-112, which pins `process.env.GH_TOKEN` + a module-global `activeRepo`).
    But the webhook does its real `gh`/git work in ASYNC CONTINUATIONS — e.g. the
    `issue_comment` path runs `isAdwRunningForIssue(...).then(async () => { ...
    classifyAndSpawnWorkflow(...) })`. When events for two repos interleave, a second
    event's receipt overwrites the process-global mid-flight, so the first event's
    in-flight continuation authenticates against the SECOND repo and `gh` reports
    "could not resolve to a repository." This is the documented webhook token-bleed
    (vestmatic #181, 2026-06-18) — the same process-global shape the PRD mined ~13
    times, here triggered by interleaving rather than by sequence.

    A per-event `GitContext` makes the bleed unrepresentable: the token, base path,
    and git identity are properties of the per-event context, not of the process.
    Two events in one process build two independent contexts; neither construction
    mutates the other, and neither command reads a shared global. Auth and path
    become properties of the EVENT, not of the process.

  Contract pinned here (the OBSERVABLE behaviour, not the field/signature shape):

    • payload → context      → a context built from an event payload's repository
                               resolves to THAT repository: owner/repo and a base
                               path under the target-repos workspace (AC1; stories 2,
                               12).
    • per-event independence → a context built from one event's payload still
                               resolves to its repository after another in-flight
                               event's context is constructed; the second construction
                               never mutates the first (AC3; stories 2, 12).
    • per-event auth         → the per-event context runs its command with ITS OWN
                               token and base-path cwd; a later in-flight event that
                               overwrites the process-global auth token does not change
                               what the first event's command carries (AC2; stories 2,
                               7-adjacent) — the vestmatic #181 bleed pin.
    • interleaved isolation  → two per-event contexts for two repos, exercised
                               interleaved in one process, each run their commands with
                               their own token AND under their own base path; neither
                               command carries the other's token or resolves under the
                               other's base path (AC4; story 2).
    • payload-determined      → a worktree resolved through the threaded per-event
                               context is a function of the payload identity alone — it
                               does not change with the process working directory (AC1;
                               story 12).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never a
    source file. No step reads `trigger_webhook.ts`, `launchGitContext.ts`, the
    GitContext package, `githubAppAuth.ts`, or any module as text, substring-matches
    its contents, or parses it as JSON/AST.

      • §1 and §2 phase-import the per-event boundary constructor, build a context
        from a SYNTHETIC EVENT PAYLOAD (the authoritative per-event identity), and
        assert the RETURN VALUES `basePath` and the resolved `owner/repo` — the
        construction-from-identity return-value pattern the acceptance criteria call
        for (mirroring `feature-660` §1 and `providers/__tests__/repoContext.test.ts`).
        A resolved path / owner / repo is an observable output, not a source property.
      • §3 and §4 run a representative operation through the per-event context with a
        RECORDING RUNNER injected as the context's command boundary (the same
        injected `exec`/spawn seam #659 established — the recorder category of the
        registered `git-mock`/`mock server` collaborators in `vocabulary.md`), and
        assert the RECORDED `cwd` and the RECORDED child `env` the context handed that
        runner. The recorded `(cwd, env)` is the command's actual launch parameters —
        a runtime artefact, not a source read. The "process-global overwritten
        mid-flight" steps mutate the LIVE `process.env` (restored in an `After` hook):
        `process.env` is live runtime state, the canonical observable for "did the
        global bleed," which the Rot-Detection Rubric permits.
      • §5 asserts the path the threaded per-event context resolves a worktree to — a
        pure path computation, the deterministic-path pattern of
        `vcs/__tests__/worktreeReset.test.ts`. The "from two different working
        directories" perturbation is the cwd-independence pin.
      • §6 asserts the type-checker's verdict (registry T22).

    The repositories, payloads, tokens, and op names in the steps are INPUT test
    data; the resolved base paths / owner / repo, the recorded `(cwd, env)`, the live
    `process.env`, and the type-check exit code are the system's OUTPUTS — exactly the
    artefact category the Rot-Detection Rubric permits. The sentinel roots
    ("/srv/adw/framework", "/srv/adw/repos") are pure construction inputs and
    `worktreePathFor` is a pure path join; the recording runner means no real git/`gh`
    is spawned and no network is touched, so every scenario is hermetic and
    global-free.

  Scope notes:

    • Behaviour pinned here is the OBSERVABLE per-event boundary resolution — the
      context an event payload builds, the per-command auth/cwd that context runs with,
      the independence of two in-flight events, and the payload-determinism of the
      threaded resolution. The per-event constructor's name/signature, where it lives,
      and whether it wraps `buildLaunchGitContext` or is a dedicated
      `gitContextFromWebhookEvent` are an implementer's choice and are NOT pinned
      (consistent with the sibling features' "pin the decision, not the shape" stance).
    • AC1's "EXACTLY ONE context per event, threaded through that event's handling —
      no reliance on process-global auth across async continuations" is partly
      architectural. Its observable CONSEQUENCES are pinned: the per-event command
      carries the context's own token even after the process-global is overwritten
      (§3), interleaved events keep their own auth and paths (§4), and the threaded
      resolution is payload-determined, not cwd-determined (§5). A construction-count
      or "threaded as a parameter" assertion would require reading source and is
      deliberately not attempted.
    • This slice does NOT drive the webhook as a subprocess (registry W11). The
      subprocess harness cannot observe GitHub-App auth (it curls real
      api.github.com) — the exact blind spot that let prior auth regressions through —
      so the per-event auth isolation is unobservable there. Per the PRD's Testing
      Decisions §3 webhook bullet ("a context built from an event payload's repository
      resolves to that repository, independent of any other in-flight event"), the
      proof is construction-from-payload + per-command-env capture via phase-import,
      hermetic and global-free, exactly as the sibling slices #659/#660 established.
    • The GitContext package internals — base-path resolution, incomplete-identity
      failure, `worktreePathFor` layout, the `commandEnv()` overlay builder — are owned
      by #658/#659 and proven in `feature-658.feature` / `feature-659.feature`; this
      slice consumes that authority and does not re-pin it.
    • Removing the legacy receipt-time `ensureAppAuthForRepo` call and the
      module-global `activeRepo` gate from `githubAppAuth.ts` is the implementation
      mechanism; this slice pins its OBSERVABLE consequence (per-event auth isolation),
      not the deletion itself. The legacy auth module's own regression coverage
      (registry T23/T24, `pause_resume_rate_limit.feature`) is left untouched.
    • Identity persistence as a cross-check (PRD stories 13, 14) and the CI/lint guard
      banning raw `git`/`gh` (PRD story 8 — shipped as a build rule the PRD explicitly
      does NOT unit-test) are owned elsewhere and not pinned here.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18 `the ADW codebase is checked out`              (background + type-check)
      T22 `the ADW TypeScript type-check passes`          (backstop)

    Novel phrasing introduced here — the registry has no phrase for a PER-EVENT
    context built from a webhook payload, the process-global-overwritten-mid-flight
    bleed trigger, or interleaved per-event isolation. Phrased DISTINCTLY from #659's
    globally-registered per-command-auth steps (e.g. "per-event context" not
    "context", "captured per-event command" not "captured command") and from #660's
    boundary-constructor steps ("webhook event payload" not "launch arguments") so the
    three step files do not collide as Cucumber loads them all globally. Surfaced to
    the maintainer in the agent Output:
      Webhook server & payload setup:
        • `a webhook server is handling events with framework root {string} and target-repos root {string}`
        • `a webhook event payload for repository {string}`
        • `a webhook event payload for repository {string} carrying auth token {string}`
      Per-event construction:
        • `a per-event GitContext is constructed from the webhook event payload`
        • `a per-event GitContext is constructed from the webhook event payload for repository {string}`
      Recording-runner setup:
        • `the per-event context's git and gh commands are captured by a recording runner`
        • `each per-event context's git and gh commands are captured by a recording runner`
      Running the representative op / interleaving / bleed trigger:
        • `the {string} read operation runs through the per-event context`
        • `events for repository {string} and repository {string} are handled with interleaved operations`
        • `a later in-flight event overwrites the process-global auth token with {string}`
        • `the per-event worktree for branch {string} is resolved from two different working directories`
      Identity / path assertions:
        • `the per-event context targets owner {string} repo {string}`
        • `the per-event context base path is {string}`
        • `the per-event context for repository {string} targets owner {string} repo {string}`
        • `the per-event context for repository {string} base path is {string}`
        • `both per-event resolutions return {string}`
      Per-command auth/cwd assertions:
        • `the captured per-event command ran with auth token {string} in its child environment`
        • `the captured per-event command ran with cwd equal to the per-event context base path`
        • `the captured per-event command's child environment does not carry auth token {string}`
        • `the per-event command for repository {string} ran with auth token {string} in its child environment`
        • `the per-event command for repository {string} ran with cwd equal to its per-event context base path`
        • `the per-event command for repository {string} child environment does not carry auth token {string}`

    Step-definition note for the maintainer:
      • All steps phase-import production code; nothing spawns a subprocess and no step
        reads a source file. Construction steps import the per-event constructor this
        slice introduces. The exact seam is the implementer's choice — likely either
        (a) composing the existing `extractTargetRepoArgs(body)` →
        `parseTargetRepoArgs(...)` → `buildLaunchGitContext(targetRepo, deps)`
        (`adws/core/launchGitContext.ts`) per event, or (b) a thin
        `gitContextFromWebhookEvent(payload, deps)` near
        `adws/triggers/trigger_webhook.ts`. Pin only the OBSERVABLE outputs.
      • `a webhook server is handling events with framework root {string} and
        target-repos root {string}` stashes the injected framework root + target-repos
        root on World, plus injectable deps so construction is hermetic and global-free
        (mirror `feature-660.steps.ts` `makeTestDeps()`): a `resolveToken(owner, repo)`
        that returns the per-repo token seeded by the payload step (default sentinel if
        none), a fixed `resolveGitIdentity()`, and — crucially — a way to SUPPRESS or
        inject the receipt-time process-global auth side effect so the test mints no
        real token (`buildLaunchGitContext` calls `ensureAppAuthForRepo` internally; the
        per-event seam must let tests stub it). In production the boundary passes
        `REPO_ROOT` / `TARGET_REPOS_DIR`; the tests pass sentinels.
      • `a webhook event payload for repository {string}` builds a COMPLETE synthetic
        payload object `{ repository: { full_name: "<owner>/<repo>", owner: { login:
        "<owner>" }, name: "<repo>", clone_url: "https://github.com/<owner>/<repo>.git"
        } }` and stashes it on World keyed by `"<owner>/<repo>"` (and as the "current"
        payload for single-context scenarios). The `clone_url` is REQUIRED:
        `extractTargetRepoArgs` returns `[]` without it, so an incomplete payload would
        wrongly fall through to self-host — include it. The `... carrying auth token
        {string}` variant additionally seeds the per-repo token the injected
        `resolveToken` will return for that repo.
      • `a per-event GitContext is constructed from the webhook event payload` feeds the
        current stashed payload to the per-event constructor and stashes the resulting
        `GitContext` as current. The `... for repository {string}` variant builds from
        the keyed payload and stashes the context keyed by repo (for the multi-context
        scenarios). Construction-as-Given, like `feature-660` §1.
      • `the per-event context targets owner {string} repo {string}` asserts
        `ctx.owner`/`ctx.repo`; `the per-event context base path is {string}` asserts
        `ctx.basePath` (target base ≡ `join(targetReposRoot, owner, repo)`). The keyed
        `... for repository {string} ...` variants look up the context stored under that
        repo key. Value-based, never a source read.
      • The recording-runner steps inject a recording `exec` (the `GitContextDeps.exec`
        seam #659 added) into the per-event context so the op's launched `(command,
        args, cwd, env)` is captured and the runner returns canned success output — no
        real subprocess, no network. `the {string} read operation runs through the
        per-event context` maps `"default-branch"` → the context's default-branch read
        and stashes the single recorded invocation. `the captured per-event command ran
        with auth token {string} in its child environment` asserts the recorded `env`
        carries the token VALUE (e.g. `recorded.env.GH_TOKEN === token`); `... cwd equal
        to the per-event context base path` asserts `recorded.cwd === ctx.basePath`.
      • `a later in-flight event overwrites the process-global auth token with {string}`
        sets `process.env.GH_TOKEN` (and/or calls `ensureAppAuthForRepo` for the other
        repo) to the sentinel, simulating a second event's receipt clobbering the
        global mid-flight; an `After` hook restores the original (mirror
        `feature-659.steps.ts`). The subsequent op asserts the per-event command STILL
        carries its own token — the immunity proof.
      • `events for repository {string} and repository {string} are handled with
        interleaved operations` runs the representative op on the first keyed context,
        then the second, capturing each context's recorded invocation independently (the
        per-command env means each carries its own token with no shared global). The
        keyed assertions look up each context's recorded invocation; `... child
        environment does not carry auth token {string}` scans the recorded env values
        and asserts the other context's token value is absent.
      • `the per-event worktree for branch {string} is resolved from two different
        working directories` calls `ctx.worktreePathFor(branch)`, `process.chdir`s to
        `os.tmpdir()`, and calls it again; `both per-event resolutions return {string}`
        asserts both equal the expected path (`<basePath>/.worktrees/<branch>`). Restore
        the original cwd in an `After` hook.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════ §1  PER-EVENT CONSTRUCTION — the payload's repository decides the context ═══
  #
  # AC1; stories 2, 12. The webhook builds the single per-event context from the event
  # payload's repository. Observable output: the resolved owner/repo and the base path,
  # both return values of the per-event constructor. The base path resolves under the
  # target-repos workspace (never the webhook's own framework checkout), so events for
  # many repos land in the right place.

  # ── §1a  A payload for owner/repo → a context at that repo's target workspace ────────
  #
  # The headline construction-from-payload (the PRD Testing Decisions §3 webhook bullet).
  # Two distinct payloads under the same injected root resolve to two distinct base
  # paths, pinning that the decision is per-event-payload, not ambient.

  @adw-664 @adw-5vjxem-gitcontext-boundary
  Scenario Outline: A per-event context built from a webhook payload resolves to that payload's repository
    Given a webhook server is handling events with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And a webhook event payload for repository "<owner>/<repo>"
    And a per-event GitContext is constructed from the webhook event payload
    Then the per-event context targets owner "<owner>" repo "<repo>"
    And the per-event context base path is "<basePath>"

    Examples:
      | owner | repo        | basePath                        |
      | acme  | webapp      | /srv/adw/repos/acme/webapp      |
      | octo  | hello-world | /srv/adw/repos/octo/hello-world |

  # ═══════════════════ §2  PER-EVENT INDEPENDENCE — one event's context survives another's ═══
  #
  # AC3; stories 2, 12 — "a context built from an event payload resolves to that
  # repository, INDEPENDENT OF ANY OTHER IN-FLIGHT EVENT" (PRD Testing Decisions §3).
  # Constructing a second event's context must not mutate the first event's context.
  # Observable output: the first context's owner/repo and base path are unchanged after
  # the second construction.

  @adw-664 @adw-5vjxem-gitcontext-boundary
  Scenario: A per-event context still resolves to its own repository after another in-flight event's context is constructed
    Given a webhook server is handling events with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And a webhook event payload for repository "acme/webapp"
    And a webhook event payload for repository "octo/other"
    And a per-event GitContext is constructed from the webhook event payload for repository "acme/webapp"
    When a per-event GitContext is constructed from the webhook event payload for repository "octo/other"
    Then the per-event context for repository "acme/webapp" targets owner "acme" repo "webapp"
    And the per-event context for repository "acme/webapp" base path is "/srv/adw/repos/acme/webapp"
    And the per-event context for repository "octo/other" base path is "/srv/adw/repos/octo/other"

  # ═══════════════════ §3  PER-EVENT AUTH — the command carries the context's token, not the global ═══
  #
  # AC2; stories 2, 7-adjacent — the vestmatic #181 webhook bleed. The per-event context
  # runs its command with ITS OWN token and base-path cwd; the process-global auth being
  # overwritten by a later in-flight event does not change what the first event's command
  # carries. Observable output: the recorded child env + cwd the context handed the runner.

  # ── §3a  The per-event command carries the context's token and base-path cwd ─────────

  @adw-664 @adw-5vjxem-gitcontext-boundary
  Scenario: A per-event context's command runs with the context's own token and base-path cwd
    Given a webhook server is handling events with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And a webhook event payload for repository "acme/webapp" carrying auth token "token-acme"
    And a per-event GitContext is constructed from the webhook event payload
    And the per-event context's git and gh commands are captured by a recording runner
    When the "default-branch" read operation runs through the per-event context
    Then the captured per-event command ran with auth token "token-acme" in its child environment
    And the captured per-event command ran with cwd equal to the per-event context base path

  # ── §3b  A mid-flight global overwrite does not bleed into the per-event command (the headline) ──
  #
  # The exact vestmatic #181 defect: a second event's receipt overwrites the
  # process-global auth token while the first event's continuation is still in flight.
  # With per-command auth the first event's command STILL carries its own token — the
  # global clobber is invisible to it. The legacy receipt-time `ensureAppAuthForRepo`
  # would have authenticated the in-flight `gh` call against the wrong repo.

  @adw-664 @adw-5vjxem-gitcontext-boundary
  Scenario: A per-event command keeps its own token after a later in-flight event overwrites the process-global auth
    Given a webhook server is handling events with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And a webhook event payload for repository "acme/webapp" carrying auth token "token-acme"
    And a per-event GitContext is constructed from the webhook event payload
    And the per-event context's git and gh commands are captured by a recording runner
    When a later in-flight event overwrites the process-global auth token with "token-octo"
    And the "default-branch" read operation runs through the per-event context
    Then the captured per-event command ran with auth token "token-acme" in its child environment
    And the captured per-event command's child environment does not carry auth token "token-octo"

  # ═══════════════════ §4  INTERLEAVED ISOLATION — two repos' events never cross-contaminate ═══
  #
  # AC4; story 2. Two per-event contexts for two repos, exercised interleaved in one
  # process, each run their commands with their own token AND under their own base path;
  # neither command carries the other's token or resolves under the other's base path.
  # This is the precise concurrency case the legacy process-global failed.

  @adw-664 @adw-5vjxem-gitcontext-boundary
  Scenario: Interleaved events for two repos each run their commands with their own auth and base path
    Given a webhook server is handling events with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And a webhook event payload for repository "acme/alpha" carrying auth token "token-alpha"
    And a webhook event payload for repository "octo/beta" carrying auth token "token-beta"
    And a per-event GitContext is constructed from the webhook event payload for repository "acme/alpha"
    And a per-event GitContext is constructed from the webhook event payload for repository "octo/beta"
    And each per-event context's git and gh commands are captured by a recording runner
    When events for repository "acme/alpha" and repository "octo/beta" are handled with interleaved operations
    Then the per-event command for repository "acme/alpha" ran with auth token "token-alpha" in its child environment
    And the per-event command for repository "acme/alpha" ran with cwd equal to its per-event context base path
    And the per-event command for repository "octo/beta" ran with auth token "token-beta" in its child environment
    And the per-event command for repository "octo/beta" ran with cwd equal to its per-event context base path
    And the per-event command for repository "acme/alpha" child environment does not carry auth token "token-beta"
    And the per-event command for repository "octo/beta" child environment does not carry auth token "token-alpha"

  # ═══════════════════ §5  PAYLOAD-DETERMINED THREADING — resolution ignores the process cwd ═══
  #
  # AC1; story 12. The per-event context is threaded through the event's handling;
  # downstream resolution is a function of the payload identity ALONE, so changing the
  # process working directory between two resolutions through the SAME threaded context
  # leaves the result identical. The general proof that nothing downstream re-derives
  # from ambient cwd.

  @adw-664 @adw-5vjxem-gitcontext-boundary
  Scenario: A worktree resolved through the threaded per-event context does not change with the process working directory
    Given a webhook server is handling events with framework root "/srv/adw/framework" and target-repos root "/srv/adw/repos"
    And a webhook event payload for repository "acme/webapp"
    And a per-event GitContext is constructed from the webhook event payload
    When the per-event worktree for branch "feature-x" is resolved from two different working directories
    Then both per-event resolutions return "/srv/adw/repos/acme/webapp/.worktrees/feature-x"

  # ═══════════════════ §6  TYPE-CHECK BACKSTOP (registry T22) ═══════════════════════════
  #
  # Consistent with the sibling per-issue features (feature-658 §7, feature-659 §6,
  # feature-660 §5): the per-event webhook boundary constructor and its wiring compile
  # within the ADW codebase's type-check.

  @adw-664 @adw-5vjxem-gitcontext-boundary
  Scenario: The ADW TypeScript type-check passes with the per-event webhook context wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
