@adw-572 @adw-t6m62c-fix-adwupgrade-regen
Feature: adwUpgrade anti-brick gate — verify `.adw/` regeneration before stamping `.adw-version`, and propagate skills/commands into target worktrees

  Issue #572 fixes a bricking bug in `adwUpgrade.tsx` (the orchestrator built by
  #541). Today the orchestrator runs `/adw_init` via the Claude CLI in a worktree
  that has **no `adw_init.md` command file**, so the slash command never expands
  and the agent no-ops — yet `runClaudeAgentWithCommand` still returns
  `success: true` (success == exit 0, not "did it write `.adw/`"). The orchestrator
  then **unconditionally** writes `.adw-version`, commits (the only change `git add
  -A` finds is the version stamp), and auto-merges. The target repo is left with a
  stamped `.adw-version` whose hash matches the framework forever after, so the
  upgrade gate (`upgradeGate.ts` / `shouldTriggerUpgrade`) sees a permanent match
  and never retriggers: the repo is bricked with no `.adw/` and no path to
  self-heal.

  This file pins the observable behaviour of the fix. Two adjacent regressions the
  issue diagnoses (dead skill/command propagation, and `/refactor` depending on a
  host-global `~/.claude`) are also pinned, because they are first-class acceptance
  criteria (AC3, AC4).

  The behavioural contract pinned below:

    1. ANTI-BRICK GATE (part B / AC2). When `/adw_init` reports success but the
       worktree's `.adw/` was not actually regenerated, the orchestrator writes NO
       `.adw-version`, opens NO PR, posts a single NON-workflow failure comment
       naming the unverified regeneration, and exits cleanly. The absent PR is
       exactly what lets the next cron dispatch retry (the idempotency guard finds
       no PR on the claim branch and re-runs regeneration) — self-healing without a
       separate watchdog. (THE fix.)
    2. GATE PASSES (part B / AC1). When `.adw/` HAS been regenerated — the six
       canonical config files present and non-empty, `features/regression/
       vocabulary.md` present, and a non-trivial diff under `.adw/` — the
       orchestrator proceeds to stamp `.adw-version`, commit, and open the PR. The
       gate must not false-negative and brick a correctly-regenerated repo.
    3. FORCE-COPIED `adw_init.md` STAYS OUT OF THE PR (part A). The framework's
       `adw_init.md` force-copied into the worktree so the command resolves is
       gitignored, so the regeneration commit `git add -A` produces never carries
       it into the upgrade PR.
    4. `target: true` PROPAGATION (part D / AC3). When the worktree command-and-skill
       propagation runs, `target: true` skills and commands land git-committable in
       the target worktree (refresh + propagation into the product repo).
    5. `target: false` AVAILABILITY (part D / AC3, AC4). `target: false` skills and
       commands — including the `/refactor` skill — are resolvable from the worktree
       (so they no longer depend on a host-global `~/.claude`) yet are gitignored, so
       they provide run-availability without ever entering a product diff.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES at runtime, never
    the text of a source file of this repo:

      • the orchestrator subprocess exit code (`World.lastExitCode`);
      • calls recorded by the mock GitHub API — the PR creation linked to the
        tracking issue, the failure comment, and that comment's ADW-marker absence
        (the same recorded-request surface behind registry T2/T3/T8);
      • the `.adw-version` file the orchestrator writes (or declines to write) into
        the target worktree — a produced data artefact of the system under test, the
        same orchestrator-written-artefact category the registry permits at T1 and
        feature-541 pins for `.adw-version`;
      • git artefacts in the temp target worktree — whether the regeneration commit
        carries the force-copied `adw_init.md`, and whether a copied skill/command
        path is git-ignored or git-committable (`git check-ignore` / commit file
        list, the same git-artefact surface behind registry T4/T11 and feature-541's
        commit-count assertion).

    The propagation scenarios (§4, §5) assert the gitignore/tracking STATE of paths
    the propagation operation copies INTO a target worktree — the OUTPUT of that
    operation — not the existence of any source file of this repo. A skill copied
    into a worktree is an artefact of the copy phase, exactly like the promotion
    feature-file artefacts the registry reads at T15–T19. "copyClaudeCommandsToWorktree
    is deleted" and "the merged function exists" are source-structure facts, NOT
    behaviour, and are deliberately NOT asserted here — the type-check backstop (§6)
    and the issue's unit tests (E4) cover the refactor; these scenarios pin only the
    observable propagation OUTCOME.

    No step reads `adws/adwUpgrade.tsx`, `adws/phases/workflowInit.ts`,
    `adws/phases/worktreeSetup.ts`, or any other source file as text,
    substring-matches its contents, or parses it as JSON/AST.

  Scope notes:

    • Deterministic harness is the established orchestrator-smoke idiom (#509/#541):
      the claude-cli-stub + mock GitHub API + a temp target git worktree, driving the
      real `adwUpgrade.tsx` subprocess (W1) and the real worktree-propagation helper.
    • §1 deliberately loads the SAME `adw-upgrade-regen-happy.json` manifest that
      feature-541 §1 uses for its happy path. Against a virgin worktree the stub
      cannot write `.adw/`, so an exit-0 `/adw_init` leaves `.adw/` empty — proving
      that exit 0 is no longer sufficient to stamp. This is the precise hole #572
      closes, and the precise reason feature-541 §1–§3 (happy manifest, virgin
      worktree, expecting a stamp+PR) are now SUPERSEDED: once the gate lands they
      need §2's populated-`.adw/` precondition to remain valid. feature-541 §4 (LLM
      *failure* manifest → no stamp/PR/comment) is unaffected and reinforced. The
      supersession is surfaced to the maintainer rather than silently editing a
      sibling per-issue file (its narrative and step defs are owned by #541).
    • The end-to-end "a live Claude run actually regenerates `.adw/`" remains the
      implementer's MANUAL smoke check — genuinely infeasible in CI because the mock
      CLI stub cannot write `.adw/` (issue Testing Decisions, E note). §2 therefore
      SEEDS a populated `.adw/` as a worktree fixture and pins the GATE's pass
      direction (a deterministic decision over worktree state), not the LLM's
      regeneration.
    • OUT OF SCOPE here: the one-time manual reset of already-bricked repos (part C —
      a human chore, nothing to automate or observe); the "force-copy runs BEFORE
      `runInitCommand`" ordering (part E3 — a dep-injected unit test, not an
      observable artefact); the wontfix/idempotency escape hatch on the claim branch
      (#570/#571 territory — §1 asserts only the absent PR that ENABLES retry, not the
      guard's PR-exists no-op).

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G1  (`the mock GitHub API is configured to accept issue comments`),
      G3  (`the claude-cli-stub is loaded with manifest {string}`),
      G4  (`an issue {int} exists in the mock issue tracker`),
      G11 (`the worktree for adwId {string} is initialised at branch {string}`),
      W1  (`the {string} orchestrator is invoked with adwId {string} and issue {int}`),
      T2  (`the mock GitHub API recorded a comment on issue {int}`),
      T5  (`the orchestrator subprocess exited {int}`),
      T8  (`the mock GitHub API recorded a PR creation for issue {int}`),
      and the cross-cutting `the ADW TypeScript type-check passes` backstop.

    Reused from the sibling per-issue file feature-541 (established there, not in the
    registry):
      `the upgrade branch {string} already carries the empty upgrade-claim commit`,
      `the ".adw-version" artefact in the worktree for adwId {string} records a
        64-character lowercase hexadecimal SHA256 digest`,
      `the ".adw-version" artefact in the worktree for adwId {string} is absent`,
      `the most recent comment on issue {int} carries no ADW workflow marker`,
      `the mock harness recorded zero PR creations for issue {int}`.

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    regeneration-gate, force-copy-exclusion, or worktree-propagation phrase). The gap
    is surfaced to the maintainer in the agent Output:
      • `the worktree for adwId {string} has a regenerated .adw/ directory containing the six canonical config files and the regression vocabulary file`
      • `the most recent comment on issue {int} reports that the framework regeneration could not be verified`
      • `the regeneration commit on branch {string} does not include the copied "adw_init" command file`
      • `the worktree command-and-skill propagation runs for the worktree of adwId {string}`
      • `the copied path {string} in the worktree for adwId {string} is git-committable`
      • `the copied path {string} in the worktree for adwId {string} is present but git-ignored`

  Background:
    Given the ADW codebase is checked out

  # ── §1 Anti-brick gate — exit-0 `/adw_init` with an empty `.adw/` is blocked ──
  #
  # The headline fix. The stub reports success (the SAME happy manifest feature-541
  # §1 uses), but against a virgin worktree `.adw/` is never written, so the gate
  # must refuse to stamp: no `.adw-version`, no PR, a single non-workflow failure
  # comment, clean exit. The absent PR is what lets the next cron tick retry.

  @adw-572 @adw-t6m62c-fix-adwupgrade-regen
  Scenario: A successful-but-empty /adw_init is gated — no version stamp, no PR, only a non-workflow failure comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 7572 exists in the mock issue tracker
    And the worktree for adwId "upgrade-7572" is initialised at branch "adw-upgrade-1a2b3c4d"
    And the upgrade branch "adw-upgrade-1a2b3c4d" already carries the empty upgrade-claim commit
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-7572" and issue 7572
    Then the orchestrator subprocess exited 0
    And the ".adw-version" artefact in the worktree for adwId "upgrade-7572" is absent
    And the mock harness recorded zero PR creations for issue 7572
    And the mock GitHub API recorded a comment on issue 7572
    And the most recent comment on issue 7572 carries no ADW workflow marker
    And the most recent comment on issue 7572 reports that the framework regeneration could not be verified

  # ── §2 Gate passes — a populated `.adw/` proceeds to stamp + PR ───────────────
  #
  # The pass direction: the harness seeds a genuinely-regenerated `.adw/` (six
  # canonical files + the regression vocabulary file) as uncommitted changes on top
  # of the empty claim commit, so the gate sees the required files AND a non-trivial
  # diff. The orchestrator then stamps `.adw-version` and opens the PR. The
  # force-copied `adw_init.md` (part A) is gitignored, so the regeneration commit
  # never carries it into the upgrade PR.

  @adw-572 @adw-t6m62c-fix-adwupgrade-regen
  Scenario: A regenerated .adw/ passes the gate — the orchestrator stamps .adw-version and opens the PR
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-upgrade-regen-happy.json"
    And an issue 7573 exists in the mock issue tracker
    And the worktree for adwId "upgrade-7573" is initialised at branch "adw-upgrade-2b3c4d5e"
    And the upgrade branch "adw-upgrade-2b3c4d5e" already carries the empty upgrade-claim commit
    And the worktree for adwId "upgrade-7573" has a regenerated .adw/ directory containing the six canonical config files and the regression vocabulary file
    And the mock GitHub API is configured to accept issue comments
    When the "upgrade" orchestrator is invoked with adwId "upgrade-7573" and issue 7573
    Then the orchestrator subprocess exited 0
    And the ".adw-version" artefact in the worktree for adwId "upgrade-7573" records a 64-character lowercase hexadecimal SHA256 digest
    And the mock GitHub API recorded a PR creation for issue 7573
    And the regeneration commit on branch "adw-upgrade-2b3c4d5e" does not include the copied "adw_init" command file

  # ── §3 Propagation — `target: true` skills/commands land git-committable ──────
  #
  # The merged worktree propagation copies ALL commands and skills into the target
  # worktree, overwriting. `target: true` artefacts are left committable so they
  # refresh and propagate into the product repo at the natural cadence of work.

  @adw-572 @adw-t6m62c-fix-adwupgrade-regen
  Scenario: target:true skills and commands are committable in the target worktree
    Given the worktree for adwId "init-7574" is initialised at branch "feat-7574-propagation"
    When the worktree command-and-skill propagation runs for the worktree of adwId "init-7574"
    Then the copied path ".claude/skills/tdd" in the worktree for adwId "init-7574" is git-committable
    And the copied path ".claude/commands/install.md" in the worktree for adwId "init-7574" is git-committable
    And the copied path ".claude/commands/prime.md" in the worktree for adwId "init-7574" is git-committable

  # ── §4 Propagation — `target: false` (incl. /refactor) available yet gitignored ─
  #
  # `target: false` artefacts — the `/refactor` skill among them — are copied into
  # the worktree so they resolve locally (no host-global `~/.claude` dependency, the
  # exact coupling #267 set out to remove) but are gitignored, so they provide
  # run-availability without ever entering a product diff.

  @adw-572 @adw-t6m62c-fix-adwupgrade-regen
  Scenario: target:false skills and commands resolve from the worktree but stay out of commits
    Given the worktree for adwId "init-7575" is initialised at branch "feat-7575-propagation"
    When the worktree command-and-skill propagation runs for the worktree of adwId "init-7575"
    Then the copied path ".claude/skills/refactor" in the worktree for adwId "init-7575" is present but git-ignored
    And the copied path ".claude/commands/feature.md" in the worktree for adwId "init-7575" is present but git-ignored
    And the copied path ".claude/commands/implement.md" in the worktree for adwId "init-7575" is present but git-ignored

  # ── §5 Type-check backstop ────────────────────────────────────────────────────

  @adw-572 @adw-t6m62c-fix-adwupgrade-regen
  Scenario: TypeScript type-check passes after adding the regeneration gate and merged propagation
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
