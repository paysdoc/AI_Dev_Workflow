@adw-665 @adw-k817bh-persist-repo-identit
Feature: Repo identity persisted into workflow state as a launch-boundary cross-check — identity written at init round-trips, a resumer prefers its launch identity, a divergence is surfaced as an error, and pre-change state still resumes

  Issue #665 (parent PRD `specs/prd/git-context-repo-authority.md`, see **Identity
  persistence** and **Testing Decisions §2**) is the identity-persistence slice of the
  repo-context authority. The foundational package landed in #658 (a `GitContext` deep
  module whose mandatory identity decides the base path); the boundary constructors
  landed in #660 (each process entry point builds EXACTLY ONE context from its launch
  identity and threads it down). This slice makes that launch identity DURABLE: the
  top-level workflow state carries the repo identity (`owner/repo`), written at
  workflow initialization, and a resuming process reads it back as a CROSS-CHECK.

  What this slice builds:

    • The top-level workflow state schema (`AgentState`, persisted at
      `agents/<adwId>/state.json`) is extended to carry the repo identity
      (`owner/repo`), written at workflow initialization from the launch-boundary
      identity (`buildLaunchGitContext`'s `owner`/`repo`).
    • A resuming process reads the persisted identity but PREFERS its own launch
      identity — the launch boundary remains the single source of truth. Persisted
      identity is consulted only as a cross-check.
    • A divergence between the persisted identity and the resumer's launch identity is
      surfaced as a DETECTABLE error rather than silently resolved to either side.
    • No backfill migration: a process resuming a pre-change workflow (state written
      before this slice, lacking the field) uses its launch identity, so the absence
      of the persisted field is harmless.

  Why this slice exists — what durable identity buys:

    The launch boundary already knows the authoritative repo identity (#660). Persisting
    it serves two ends the PRD calls out. First, audit/tooling can see which repo a run
    belonged to from its state alone (story 13). Second — and load-bearing — it is a
    TRIPWIRE: if a resuming process were ever pointed at the wrong workflow (a state
    directory from a DIFFERENT repo than the one its launch identity names), the
    cross-check catches the divergence and surfaces it instead of letting the run
    proceed under a silently-wrong identity and detonate downstream (the wrong-repo
    class this whole PRD forecloses). Crucially, the cross-check does NOT make persisted
    state authoritative: the resumer still acts under its LAUNCH identity, so old state
    lacking the field is a non-event and no backfill is required.

  Contract pinned here (the OBSERVABLE behaviour, not the field/function shape):

    • Identity written at init is recorded in the top-level state file and reads back
      intact — a durable round-trip through the `agents/<adwId>/state.json` artefact
      (AC1, AC2; story 13).
    • A resumer whose launch identity MATCHES the persisted identity passes the
      cross-check and proceeds under its launch identity (AC3; story 14).
    • A resumer whose launch identity DIVERGES from the persisted identity surfaces a
      detectable repo-identity mismatch error naming BOTH identities, rather than
      silently adopting either (AC4; story 14).
    • A resumer reading pre-change state that LACKS the identity field passes the
      cross-check and proceeds under its launch identity — no error, no backfill
      (AC5; story 15).

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never a
    source file. No step reads `agentTypes.ts`, `agentState.ts`, `workflowInit.ts`,
    `launchGitContext.ts`, or any module as text, substring-matches its contents, or
    parses it as JSON/AST.

      • §1 drives the production init-time identity persistence and then reads the
        persisted identity back from the `agents/<adwId>/state.json` STATE-FILE ARTEFACT
        (Observability Surface 1 — the same artefact registry T1 reads for
        `workflowStage`). A state file written by the workflow is an artefact, not a
        source file; reading `owner`/`repo` from it is the permitted round-trip read.
      • §2, §3, §4 phase-import the production resume-time cross-check seam, feed it the
        persisted identity READ FROM the seeded state-file artefact (via the production
        `readTopLevelState`) and a launch identity supplied as test input, and assert
        the RETURN VALUE / surfaced error — the construction-from-identity return-value
        pattern #660 §1 and #658 §1 use ("a resolved discriminator is an observable
        output, not a source property"). The verdict (pass / mismatch error) and the
        error payload are OUTPUTS of phase-imported production code, not source reads.
      • §5 asserts the type-checker's verdict (registry T22).

    The seeded persisted identity, the launch identity owner/repo, and the adwIds are
    INPUT test data; the persisted state-file contents, the cross-check verdict, and the
    surfaced error are the system's OUTPUT — exactly the artefact category the
    Rot-Detection Rubric permits. Nothing here spawns a subprocess or touches the
    network; the state files are written and read under a temp `agents/` root.

  Vocabulary note:

    Reused registered phrases from `features/regression/vocabulary.md`:
      G18 `the ADW codebase is checked out`            (background, §1, §5)
      T22 `the ADW TypeScript type-check passes`        (backstop, §5)

    Novel phrasing introduced here — the registry has no phrase for persisting a repo
    identity into top-level state, reading it back, or cross-checking a persisted
    identity against a launch identity. Phrased DISTINCTLY from #565's
    "remote-owner-mismatch failure between the target worktree and the declared
    repository" (a worktree-remote check, not a state cross-check) and from #660's
    boundary-context phrases, so the step files do not collide. Surfaced to the
    maintainer in the agent Output:
      Identity persisted at init / round-trip:
        • `a workflow for adwId {string} is initialised under launch identity owner {string} repo {string}`
        • `the top-level state for adwId {string} records repo identity owner {string} repo {string}`
      Resume-time cross-check setup:
        • `a top-level state for adwId {string} persists repo identity owner {string} repo {string}`
        • `a top-level state for adwId {string} persists no repo identity`
      Resume-time cross-check outcome:
        • `a process resumes adwId {string} under launch identity owner {string} repo {string}`
        • `the resume cross-check passes`
        • `the resume proceeds under launch identity owner {string} repo {string}`
        • `the resume surfaces a repo-identity mismatch error`
        • `the mismatch error names the persisted identity {string} and the launch identity {string}`

    Step-definition note for the maintainer:
      • All steps phase-import production code or read/write the state-file artefact
        under a temp `agents/` root; nothing spawns a subprocess and no step reads a
        source file. Set `AGENTS_STATE_DIR` (or the harness's state-root seam) to a
        `mkdtempSync` dir in a Before hook and clean it in After, so writes/reads are
        hermetic.
      • `a workflow for adwId {string} is initialised under launch identity owner {string}
        repo {string}` invokes the PRODUCTION init-time identity persistence — the write
        `initializeWorkflow` performs against the top-level state at startup, extended by
        this slice to carry `owner/repo`. Drive the production seam (e.g. the factored
        identity-persistence helper, or `writeTopLevelState` exactly as init now calls
        it with the identity included) so the round-trip exercises real code; do NOT
        hand-roll a bare write. The identity SOURCE in production is the launch
        `GitContext` (`buildLaunchGitContext(...).owner/.repo`); the test supplies
        owner/repo directly. `owner/repo` is the repo identity regardless of the
        self-host/target discriminator, so a single field shape covers both.
      • `the top-level state for adwId {string} records repo identity owner {string} repo
        {string}` reads `agents/<adwId>/state.json` (via the production `readTopLevelState`
        or a direct JSON read of the artefact) and asserts the persisted owner/repo equal
        the expected values — the durable round-trip. (State file is an artefact, not a
        source file — the same permitted read as registry T1.)
      • `a top-level state for adwId {string} persists repo identity owner {string} repo
        {string}` seeds a real `agents/<adwId>/state.json` carrying the identity (write it
        through the production write path, mirroring registry G6's stage seeding). `...
        persists no repo identity` seeds a pre-change state file with the usual fields
        (adwId, workflowStage) but NO identity field, simulating a workflow initialised
        before this slice.
      • `a process resumes adwId {string} under launch identity owner {string} repo {string}`
        reads the persisted identity from the seeded artefact via the production
        `readTopLevelState`, then applies the production resume-time cross-check seam
        against the launch identity {owner, repo} supplied as test input, capturing the
        verdict (and any thrown/returned error) on World. The cross-check is the decision
        `initializeWorkflow` makes in its recovery path; the implementer factors it as a
        pure function over (persistedIdentity | undefined, launchIdentity). Its exact
        name/signature is the implementer's choice — pin only the OBSERVABLE verdict.
      • `the resume cross-check passes` asserts no error/mismatch was surfaced; `the
        resume proceeds under launch identity owner {string} repo {string}` asserts the
        effective identity the resumer would act under equals the LAUNCH identity (the
        source of truth), not the persisted one. `the resume surfaces a repo-identity
        mismatch error` asserts an error was thrown or an error-typed verdict returned;
        `the mismatch error names the persisted identity {string} and the launch identity
        {string}` asserts the surfaced error's message/payload contains BOTH identities
        (e.g. "acme/webapp" and "evil/webapp") — the proof the divergence is detectable
        and not silently resolved.

  Scope notes:

    • Behaviour pinned here is the OBSERVABLE identity persistence and cross-check — the
      identity recorded in the state artefact, its round-trip, and the pass / mismatch /
      pre-change verdicts of the resume-time cross-check. The persisted field's name and
      shape (a flat `owner`/`repo` pair, a nested object, etc.) and the cross-check
      function's name/signature are an implementer's choice and are NOT pinned
      (consistent with the sibling features' "pin the decision, not the shape" stance).
    • The launch boundary remains the SOURCE OF TRUTH; this slice does not change that.
      Persisted identity is a read-only cross-check. The "prefers launch identity"
      guarantee is pinned by §3 (a mismatch is NOT silently resolved to the persisted
      value) and §4 (an absent persisted value still resumes under the launch identity),
      not by making persisted state authoritative.
    • The GitContext package internals (#658), the boundary constructors that BUILD the
      launch identity (#660), and per-command auth/env isolation (#659) are owned by
      those slices and proven in their features; this slice consumes the launch identity
      and does not re-pin its construction.
    • Worktree / branch / PR operation migration onto the context (PRD stories 16–18) is
      out of scope for this slice and owned by later issues.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate human
      decision and the agent never auto-promotes.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════ §1  IDENTITY WRITTEN AT INIT ROUND-TRIPS THROUGH TOP-LEVEL STATE ═══
  #
  # AC1, AC2; story 13. The top-level state schema carries the repo identity, written at
  # workflow initialization from the launch-boundary identity. The headline round-trip:
  # the identity written at init is recorded in the `agents/<adwId>/state.json` artefact
  # and reads back intact. Observable output: the persisted owner/repo in the state file.
  # The identity is owner/repo whether the launch was self-host or target, so one shape
  # covers both rows.

  @adw-665 @adw-k817bh-persist-repo-identit
  Scenario Outline: The launch repo identity written at workflow initialization round-trips through the top-level state file
    Given a workflow for adwId "<adwId>" is initialised under launch identity owner "<owner>" repo "<repo>"
    Then the top-level state for adwId "<adwId>" records repo identity owner "<owner>" repo "<repo>"

    Examples:
      | adwId              | owner    | repo            |
      | k817bh-init-target | acme     | webapp          |
      | k817bh-init-self   | paysdoc  | AI_Dev_Workflow |

  # ═══════════════════ §2  RESUMER PREFERS LAUNCH IDENTITY — MATCHING PERSISTED IS A PASSING CROSS-CHECK ═══
  #
  # AC3; story 14. The common post-cutover case: a resuming process whose launch identity
  # matches the persisted identity passes the cross-check and proceeds under its launch
  # identity. The persisted identity is read back from the real state-file artefact and
  # consulted only as a cross-check. Observable output: the cross-check verdict and the
  # effective (launch) identity the resume proceeds under.

  @adw-665 @adw-k817bh-persist-repo-identit
  Scenario: A resume whose launch identity matches the persisted identity passes the cross-check and proceeds under the launch identity
    Given a top-level state for adwId "k817bh-resume-match" persists repo identity owner "acme" repo "webapp"
    When a process resumes adwId "k817bh-resume-match" under launch identity owner "acme" repo "webapp"
    Then the resume cross-check passes
    And the resume proceeds under launch identity owner "acme" repo "webapp"

  # ═══════════════════ §3  DIVERGENCE IS SURFACED AS A DETECTABLE ERROR — NOT SILENTLY RESOLVED ═══
  #
  # AC4; story 14 (the heart of the cross-check). When the resumer's launch identity
  # diverges from the persisted identity — in the owner, the repo, or both — the
  # cross-check surfaces a DETECTABLE error that names both identities, rather than
  # silently adopting either. This is the tripwire that catches a resumer pointed at a
  # state directory belonging to a different repo than its launch identity names.
  # Observable output: the surfaced error and its payload.

  @adw-665 @adw-k817bh-persist-repo-identit
  Scenario Outline: A resume whose launch identity diverges from the persisted identity surfaces a detectable mismatch error naming both identities
    Given a top-level state for adwId "<adwId>" persists repo identity owner "acme" repo "webapp"
    When a process resumes adwId "<adwId>" under launch identity owner "<launchOwner>" repo "<launchRepo>"
    Then the resume surfaces a repo-identity mismatch error
    And the mismatch error names the persisted identity "acme/webapp" and the launch identity "<launchOwner>/<launchRepo>"

    Examples:
      | adwId                       | launchOwner | launchRepo  |
      | k817bh-resume-owner-differs | evil        | webapp      |
      | k817bh-resume-repo-differs  | acme        | webapp-fork |

  # ═══════════════════ §4  PRE-CHANGE STATE WITHOUT THE FIELD RESUMES UNDER THE LAUNCH IDENTITY — NO BACKFILL ═══
  #
  # AC5; story 15. A workflow initialised BEFORE this slice has no persisted identity
  # field. A process resuming it reads no persisted identity, so the cross-check has
  # nothing to diverge from: it passes and the resume proceeds under the launch identity.
  # This pins the "no backfill migration" guarantee — the absence of the field is a
  # non-event, exercising a different branch than §2's match. Observable output: the
  # cross-check verdict and the effective (launch) identity.

  @adw-665 @adw-k817bh-persist-repo-identit
  Scenario: A resume reading pre-change state that lacks the identity field passes the cross-check and proceeds under the launch identity
    Given a top-level state for adwId "k817bh-resume-legacy" persists no repo identity
    When a process resumes adwId "k817bh-resume-legacy" under launch identity owner "acme" repo "webapp"
    Then the resume cross-check passes
    And the resume proceeds under launch identity owner "acme" repo "webapp"

  # ═══════════════════ §5  TYPE-CHECK BACKSTOP (registry T22) ═══════════════════════════
  #
  # Consistent with the sibling per-issue features (feature-660 §5, feature-658 §7): the
  # extended `AgentState` schema and the resume-time cross-check wiring compile within
  # the ADW codebase's type-check.

  @adw-665 @adw-k817bh-persist-repo-identit
  Scenario: The ADW TypeScript type-check passes with repo identity persisted into the top-level workflow state
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
