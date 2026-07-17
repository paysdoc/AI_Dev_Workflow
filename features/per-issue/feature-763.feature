@adw-763 @adw-i46l4f-adw-init-write-start
Feature: adw_init copies a starter guardrail settings.json into target repos that ship none — a repo owner without Claude Code guardrail experience gets ADW's deny list for their OWN interactive sessions, while a repo that already has a settings.json is never touched

  Issue #763 closes the OTHER half of the guardrail hole #762 opened. #762 injects ADW's
  guardrails into ADW's own agent spawns via `--settings` (framework-internal, never committed).
  But that protects only ADW runs — the repo OWNER, sitting in their own `claude` session in the
  same repo, still gets no deny rules at all, because they never had a `.claude/settings.json`.

  THE FIX: during `/adw_init` (and therefore automatically during framework-upgrade regeneration,
  which re-runs `/adw_init` — `adwUpgrade.tsx`), if the target repo ships NO `.claude/settings.json`,
  copy `templates/claude-settings-starter.json` — the deny-only canonical template #762 created —
  VERBATIM to `.claude/settings.json` and let it ride into the init/upgrade PR. The file is the
  OWNER's from that point on: theirs to keep, edit, or delete.

  Four rules constrain the copy, each with teeth against a realistic mis-implementation:

    • SKIP IF IT ALREADY EXISTS. If `.claude/settings.json` is already present, the owner has
      opinions — never merge into it, never overwrite it. The copy is skipped and the existing
      file is left byte-for-byte untouched. (Risk guarded: a copy that clobbers the owner's file.)
    • GUARDRAILS ONLY — DENY PERMISSIONS, NO HOOKS. The committed file must be the plain deny-list
      template, NOT #762's spawn payload. #762's `buildGuardrailsSettings` (`guardrailsPayload.ts`)
      reads the SAME template but ADDS all five hooks at spawn time; committing THAT would ship a
      hook script that imposes a bun/node runtime on non-JS repos. The framework's own
      `.claude/settings.json` (a larger, different file) is likewise the wrong source. (Risk
      guarded: copying the hook-bearing payload or the framework's own settings instead of the
      template.)
    • NOT GITIGNORED. Unlike the commands/skills that `copyClaudeAssetsToWorktree` copies AND
      gitignores (`# ADW: copied slash commands (do not commit)`), this file must be committable —
      it is the owner's to keep. So the copy must NOT call `ensureGitignoreEntry`. (Risk guarded:
      copying via the gitignoring helper, which would strand the file untracked and out of the PR.)
    • IDEMPOTENT REGEN. Re-running init (the upgrade regen path, which fires on every framework
      upgrade) on a repo that already RECEIVED the starter must be a no-op: no change, no duplicate.
      This is just the skip-if-exists rule applied to the framework's own prior output. (Risk
      guarded: an unconditional re-write that dirties every upgrade PR.)

  The behavioural contract pinned below (the HARNESS-OBSERVABLE half of the acceptance criteria —
  see "What this harness cannot reach" for the other half):

    §1  THE STARTER LANDS IN THE INIT/REGEN COMMIT, UNCENSORED BY GITIGNORE (AC1). A fresh target
        worktree that ships no `.claude/settings.json` gains one that rides into the recorded
        commit's tree AND is not gitignored. A gitignored file would never reach the tree via
        `git add -A`, so the commit-tree membership proves BOTH "committed" and "not gitignored" at
        once; the explicit non-ignore check names the rule. RED before (no copy step exists).
    §2  THE COMMITTED FILE IS A VERBATIM COPY OF THE DENY-ONLY TEMPLATE (AC1). The committed
        `.claude/settings.json` is byte-for-byte identical to `templates/claude-settings-starter.json`.
        This is the assertion that catches the wrong SOURCE: the hook-bearing spawn payload and the
        framework's own settings both differ from the template byte-for-byte. RED before.
    §3  AN EXISTING settings.json IS LEFT UNTOUCHED, AND THE SKIP IS RECORDED (AC2). A target repo
        that already ships its own `.claude/settings.json` keeps it byte-for-byte, and init records
        that it skipped rather than silently doing nothing. RED-ish before: with no skip guard a
        naive copy would overwrite the owner's file; the "records the skip" half is the AC2 "init
        logs the skip".
    §4  A RE-RUN ON A REPO THAT ALREADY RECEIVED THE STARTER CHANGES NOTHING (AC3). After the
        starter has been written and committed once, a second init/regen leaves the file unchanged
        and stages no further change — the upgrade PR stays clean. RED before (an unconditional copy
        re-dirties the file every regen).
    §5  THE COMMITTED STARTER CARRIES A DENY LIST AND NO HOOKS (the guardrails-only rule). The
        committed artefact declares deny permissions and registers no hooks — the legible statement
        of the non-JS-runtime rule, and a second guard against the hook-bearing payload source. RED
        before.
    §T  TYPE-CHECK BACKSTOP (T22). The ADW TypeScript type-check still passes with the new copy step
        and its skip-if-exists decision wired in. Consistent with feature-762 §T / feature-758 §T.

  Observability / rot-prevention note:

    Every assertion below targets an ARTEFACT the system under test PRODUCES over a REAL throwaway
    temporary git repository the step def constructs — the tree of the commit init records
    (registry surface #3), the committed blob's bytes, the worktree's `git check-ignore` /
    `git status` verdict, the copy step's own recorded skip signal, or the type-checker's verdict
    (T22). NO step reads `adws/phases/worktreeSetup.ts`, `adws/gitContext/commitOps.ts`,
    `adws/adwUpgrade.tsx`, `.claude/commands/adw_init.md`, or any framework source file as text,
    substring-matches its contents, or parses it as JSON/AST.

      • THE COMMIT TREE IS THE OUTPUT, NOT A SOURCE FILE. §1 asserts membership in
        `git show --name-only HEAD` over the temp worktree — the produced git artefact, exactly the
        surface feature-729 (T31–T33) and feature-685 §D pin. The copied `.claude/settings.json`
        living in that temp worktree is init's OUTPUT, not a source file of this repo; asserting its
        commit-tree membership is NOT a prohibited source-file-existence check.
      • "VERBATIM COPY OF THE TEMPLATE" COMPARES A PRODUCED ARTEFACT TO A DECLARED COPY-SOURCE. §2
        reads the committed blob (`git show HEAD:.claude/settings.json`, the SUT's output) and the
        copy-SOURCE `templates/claude-settings-starter.json` (the input the SUT itself reads at
        `guardrailsPayload.ts:15`), and asserts they are equal — the "copies VERBATIM" BEHAVIOUR.
        This is NOT an assertion that the template contains any particular bytes: if #762 later adds
        a fourteenth deny pattern, both sides move together and §2 stays green. The category is the
        artefact-vs-documented-input comparison the Rubric permits, exactly as feature-729 G24 uses
        the real `adw_init.md` "purely as COPY INPUT".
      • PARSING THE COMMITTED BLOB IS PARSING THE SUT's OUTPUT. §5 parses the committed
        `.claude/settings.json` as JSON and asserts on its shape (a deny list present, no hooks
        key). Parsing that blob is the same category as parsing a state file (T1), a recorded
        request body (T3), or feature-762's recorded spawn argv — the SUT's output — and is
        explicitly permitted. It is NOT parsing `templates/claude-settings-starter.json` as a source
        file, which would be a prohibited structural source-file assertion.
      • THE SKIP SIGNAL AND THE GITIGNORE/STATUS VERDICTS ARE RUNTIME ARTEFACTS. §3's "records the
        skip" reads the copy step's own return value or captured log line (surface #5); §1's
        non-ignore and §4's no-staged-change read `git check-ignore` / `git status --porcelain` over
        the temp worktree (surface #3). None reads a framework source file.

  What this harness cannot reach (surfaced to the maintainer, not papered over):

    • THE FRESH `/adw_init` BOOTSTRAP FIRING THE COPY IS LLM-DRIVEN AND OUT OF REACH. There is no
      TypeScript orchestrator for a fresh `/adw_init` — it is an operator-run LLM command
      (`.claude/commands/adw_init.md`); the only programmatic caller is the upgrade-regen path
      (`adwUpgrade.tsx`, which itself runs `/adw_init` as an LLM subprocess). So the copy BEHAVIOUR
      is pinned here by driving the real TypeScript copy step directly (the seam AC4's unit test
      also needs), but the LLM prompt actually performing the `cp` on a live fresh bootstrap — like
      the existing `cp templates/vocabulary.md.template …` at `adw_init.md:144-149` — is
      non-hermetic and is NOT a scenario, the same harness boundary #762 recorded for real-CLI
      enforcement. The implementation is expected to share ONE skip-if-exists decision between the
      TS copy step (regen path, unit-tested) and the `adw_init.md` `cp` step (fresh path).
    • THE INIT-GENERATED DOCS SECTION IS LLM-AUTHORED PROSE AND OUT OF REACH. The issue asks for a
      short section in the init-generated docs noting that the `Read(!…)` negation carve-outs rely
      on undocumented CLI behaviour, verified by #762's probe, to be re-run after Claude Code CLI
      upgrades. Those docs are the LLM-generated `.adw/*.md` (most naturally `.adw/project.md`) or
      the init report — non-deterministic prose. Pinning it with a substring assertion against
      generated text would be both flaky and a content-match against a produced-but-freeform doc; it
      is instead surfaced as a documentation deliverable for the implementer/maintainer to verify by
      reading the `adw_init.md` prompt, not a BDD scenario here.
    • WHETHER THE COMMITTED DENY RULES ARE ACTUALLY ENFORCED BY THE REAL CLI is #762's probe
      boundary, unchanged and not re-pinned here.

  Scope notes:

    • THE COPY STEP MUST ACTUALLY BE WIRED INTO THE REGEN — AND THAT WIRING IS THE UNIT TEST'S JOB.
      A perfect `copyGuardrailsSettingsToWorktree` that `executeUpgrade` never calls is exactly the
      #762-class bug (a correct builder never reaching the spawn). Driving the full `executeUpgrade`
      end-to-end would require stubbing its `/adw_init` LLM subprocess, so — as feature-729 did for
      the commit fix — this file pins the copy step's BEHAVIOUR directly, and the ordering assertion
      "the settings copy is invoked during the upgrade" belongs beside the existing E3 ordering
      block in `adws/__tests__/adwUpgrade.test.ts` (unit, via the `makeDeps()` fakes). Surfaced so
      the maintainer does not mistake a green BDD suite for proof the step is reached.
    • THE BYTE-EXACT DENY-LIST CONTENTS ARE THE UNIT TEST'S, NOT BDD. #762 already unit-tests the
      thirteen deny patterns off the real template (`guardrailsPayload.test.ts`); §2 asserts
      "identical to the template" (a copy-fidelity behaviour) and §5 asserts "a deny list, no
      hooks" (the shape rule) — deliberately NOT the thirteen strings verbatim, which would rot the
      moment a pattern is added. The skip-if-exists DECISION's own unit test (AC4) lands in
      `adws/phases/__tests__/worktreeSetup.test.ts` beside the existing copy tests.
    • §2 SUBSUMES §5, AND §5 IS KEPT ANYWAY. A verbatim copy of a deny-only, hook-free template is
      trivially deny-only and hook-free, so §2 passing implies §5. §5 is retained because it is the
      LEGIBLE statement of the "guardrails only, NO hooks" rule with the non-JS-runtime rationale,
      and it fails with a direct message ("committed starter carries hooks") when the hook-bearing
      payload is copied — where §2 fails only as "not identical to template". Distinct rules, distinct
      scenarios, per feature-762's §2/§4 precedent (deny rules and no-allow-list pinned separately).
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md` configures a
      `## Regression Scenario Directory`, so promotion to the regression suite (and registration of
      these phrases in `features/regression/vocabulary.md`) is a deliberate human decision and this
      agent never auto-promotes. §1 (the starter lands committed and not gitignored) and §3 (an
      existing file is untouched) are the natural promotion candidates — a human call.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`      (Background no-op)
      T22  `the ADW TypeScript type-check passes` (§T)

    Novel phrasing introduced here — the registry has no phrase for copying a starter settings file
    into a target worktree, a skip-if-exists decision, or a committed-settings artefact assertion.
    The phrasing is deliberately DISTINCT from feature-729's registered commit-tree phrases
    (`the recorded commit's tree includes {string}` etc.), which are bound to feature-729's own
    step-def module state under the globally-loaded step defs — reusing them would cross-wire state,
    re-declaring them would be a duplicate-step-definition error (the exact hazard feature-729's own
    vocab note records against #685 §D). It is likewise distinct from feature-762's spawn/injection
    phrases. The gap is surfaced to the maintainer in the agent Output:
      • `a fresh target-repo worktree with no ".claude/settings.json"`
      • `a target-repo worktree that already ships an owner-authored ".claude/settings.json"`
      • `the starter guardrail settings have already been written and committed into the target worktree`
      • `the framework init runs its starter-guardrail-settings step over the target worktree`
      • `the resulting commit tree carries {string}`
      • `{string} is not gitignored in the target worktree`
      • `the committed ".claude/settings.json" is a verbatim copy of the starter guardrail template`
      • `the pre-existing ".claude/settings.json" is left byte-for-byte unchanged`
      • `the framework init records that it skipped the existing settings file`
      • `the starter-guardrail-settings step stages no change to {string}`
      • `the committed starter settings carries a deny permission list`
      • `the committed starter settings carries no hooks`

    Step-definition note for the maintainer (feature-763.steps.ts — keep it SELF-CONTAINED with its
    own `@adw-763` Before/After and module-private state; mirror feature-729.steps.ts's helpers;
    do NOT reach into feature-729's or feature-762's step defs):
      • Each Given inits a REAL temp git repo under the test tmp dir (feature-729's `initGitRepo` /
        `execSync` pattern), writes a baseline file (e.g. `.adw/project.md`) and COMMITS it, so a
        subsequent commit is observable. The "fresh" Given writes NO `.claude/settings.json`; the
        "owner-authored" Given writes one with DISTINCTIVE content (e.g.
        `{"permissions":{"allow":["Bash(ls:*)"]}}` — plainly not the starter) and commits it as the
        baseline.
      • `the starter guardrail settings have already been written and committed …` (the §4 idempotence
        setup) drives the REAL copy step + a REAL commit ONCE, so the second run has a genuine prior
        artefact to be idempotent against.
      • `the framework init runs its starter-guardrail-settings step …` (the When) must call the REAL
        new copy step — NOT a hand-rolled `cp`. The seam is the implementer's to name; the expected
        shape is a sibling of `copyAdwInitCommandToWorktree` in `adws/phases/worktreeSetup.ts`
        (e.g. `copyGuardrailsSettingsToWorktree(worktreePath, frameworkRepoRoot)`) that copies
        `templates/claude-settings-starter.json` → `.claude/settings.json` ONLY when absent and does
        NOT call `ensureGitignoreEntry`. `frameworkRepoRoot` is the ADW checkout (`process.cwd()`),
        which holds the real template used as COPY INPUT. After running the copy, the step commits
        via the REAL `commitOps.commitChanges(realRun, …)` (feature-729's driver) GUARDED on there
        being a pending change (`git status --porcelain`), so a skip case does not attempt an empty
        commit. If the step assembled its own copy the scenarios would be VACUOUS against the actual
        bug — the RED must come from the real copy step being absent/wrong, the GREEN from the real
        one.
      • `the resulting commit tree carries {string}` asserts membership in
        `git show --name-only --format= HEAD` over the temp worktree (feature-729's
        `committedTreeFiles` helper). Guard it so a RED (no commit recorded) yields a clear failure,
        not an assertion against a stale HEAD.
      • `{string} is not gitignored in the target worktree` runs `git check-ignore -- <path>` in the
        temp worktree and asserts it reports the path NOT ignored (exit 1 / no output) — the git
        artefact that names the "must be committable" rule directly.
      • `the committed ".claude/settings.json" is a verbatim copy of the starter guardrail template`
        reads the committed blob (`git show HEAD:.claude/settings.json`) and the copy-source
        `templates/claude-settings-starter.json` from the ADW checkout, and asserts byte-equality.
        Read the template as the SUT's INPUT to prove verbatim-copy — do NOT hardcode its bytes.
      • `the pre-existing ".claude/settings.json" is left byte-for-byte unchanged` snapshots the
        file's bytes in the Given and re-reads them after the When; assert equality. This is the
        skip-if-exists OUTCOME and is always drivable regardless of how the skip is signalled.
      • `the framework init records that it skipped the existing settings file` binds to whatever the
        copy step exposes as its skip signal — its return value (e.g. `{written:false}`) OR a
        captured log line. AC2 requires the skip to be logged, so a captured log substring is a
        legitimate target; keep the assertion on the SIGNAL, not on any exact string, to avoid rot.
      • `the starter-guardrail-settings step stages no change to {string}` asserts
        `git status --porcelain -- <path>` is empty after the §4 re-run — the idempotence artefact.
      • `the committed starter settings carries a deny permission list` / `… carries no hooks` parse
        the committed blob as JSON (the SUT's OUTPUT) and assert `permissions.deny` is a non-empty
        array and no `hooks` key is present. Parse the COMMITTED blob, never the template on disk.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE STARTER LANDS IN THE INIT/REGEN COMMIT, UNCENSORED BY GITIGNORE (AC1) ────────
  #
  # The headline plumbing. A fresh target repo that ships no settings of its own gains one that
  # rides into the recorded commit AND is not gitignored — so the owner actually keeps it. Commit-
  # tree membership proves committed-and-not-gitignored together (a gitignored file never reaches
  # the tree via `git add -A`); the explicit non-ignore check names the rule. RED before the copy
  # step exists (no file is written, nothing lands in the tree); GREEN after.

  @adw-763 @adw-i46l4f-adw-init-write-start
  Scenario: A fresh target repo receives a committed, non-gitignored starter settings file
    Given a fresh target-repo worktree with no ".claude/settings.json"
    When the framework init runs its starter-guardrail-settings step over the target worktree
    Then the resulting commit tree carries ".claude/settings.json"
    And ".claude/settings.json" is not gitignored in the target worktree

  # ── §2 THE COMMITTED FILE IS A VERBATIM COPY OF THE DENY-ONLY TEMPLATE (AC1) ────────────
  #
  # The content rule, and the catch for the wrong SOURCE. #762's `buildGuardrailsSettings` reads the
  # same template but ADDS five hooks; the framework's own `.claude/settings.json` is a larger,
  # different file. Both differ from the template byte-for-byte, so "identical to the template" is
  # what rejects them. Asserted as the copies-VERBATIM behaviour (committed blob == copy-source),
  # not as a hardcoded byte string, so a later template edit does not rot it. RED before.

  @adw-763 @adw-i46l4f-adw-init-write-start
  Scenario: The committed starter settings is a byte-for-byte copy of the canonical template
    Given a fresh target-repo worktree with no ".claude/settings.json"
    When the framework init runs its starter-guardrail-settings step over the target worktree
    Then the committed ".claude/settings.json" is a verbatim copy of the starter guardrail template

  # ── §3 AN EXISTING settings.json IS LEFT UNTOUCHED, AND THE SKIP IS RECORDED (AC2) ──────
  #
  # The owner has opinions. A repo that already ships its own `.claude/settings.json` must keep it
  # exactly — never merged into, never overwritten — and init must record that it skipped rather
  # than silently no-op. RED-ish before: with no skip guard a naive copy overwrites the owner's
  # file; "records the skip" is the AC2 "init logs the skip".

  @adw-763 @adw-i46l4f-adw-init-write-start
  Scenario: An owner-authored settings.json is left untouched and the skip is recorded
    Given a target-repo worktree that already ships an owner-authored ".claude/settings.json"
    When the framework init runs its starter-guardrail-settings step over the target worktree
    Then the pre-existing ".claude/settings.json" is left byte-for-byte unchanged
    And the framework init records that it skipped the existing settings file

  # ── §4 A RE-RUN ON A REPO THAT ALREADY RECEIVED THE STARTER CHANGES NOTHING (AC3) ───────
  #
  # Upgrade regen fires on every framework upgrade, re-running `/adw_init`. On a repo that already
  # received the starter, that must be a pure no-op — the skip-if-exists rule applied to the
  # framework's own prior output. No change, no duplicate, a clean upgrade PR. RED before (an
  # unconditional copy re-dirties the file every regen).

  @adw-763 @adw-i46l4f-adw-init-write-start
  Scenario: Re-running init on a repo that already received the starter changes nothing
    Given a fresh target-repo worktree with no ".claude/settings.json"
    And the starter guardrail settings have already been written and committed into the target worktree
    When the framework init runs its starter-guardrail-settings step over the target worktree
    Then the pre-existing ".claude/settings.json" is left byte-for-byte unchanged
    And the starter-guardrail-settings step stages no change to ".claude/settings.json"

  # ── §5 THE COMMITTED STARTER CARRIES A DENY LIST AND NO HOOKS (guardrails-only rule) ────
  #
  # The legible statement of the non-JS-runtime rule: the committed file is the plain deny-list, not
  # #762's hook-bearing spawn payload. A committed hook script would impose a bun/node runtime on
  # non-JS repos. Subsumed by §2 (a verbatim copy of a hook-free template is hook-free) but kept as
  # the direct, well-named guard — it fails with "committed starter carries hooks" the instant the
  # payload source is used. RED before.

  @adw-763 @adw-i46l4f-adw-init-write-start
  Scenario: The committed starter settings declares deny permissions and registers no hooks
    Given a fresh target-repo worktree with no ".claude/settings.json"
    When the framework init runs its starter-guardrail-settings step over the target worktree
    Then the committed starter settings carries a deny permission list
    And the committed starter settings carries no hooks

  # ── §T Type-check backstop (T22) ───────────────────────────────────────────────────────
  #
  # The new copy step and its skip-if-exists decision keep the ADW codebase type-clean. A backstop
  # consistent with feature-762 §T and feature-758 §T.

  @adw-763 @adw-i46l4f-adw-init-write-start
  Scenario: The ADW TypeScript type-check passes with the starter-settings copy step wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
