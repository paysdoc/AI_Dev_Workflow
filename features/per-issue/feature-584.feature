@adw-584 @adw-vv6d4h-classifier-can-assig
Feature: The trigger classifier can no longer assign the retired /adw_init bootstrap type, so adw.yml-themed issues stop dying with an ENOENT plan-file error

  Issue #584 closes a latent trap left behind by #547. `/adw_init` is an
  operator-only bootstrap command (run interactively to generate a target repo's
  `.adw/` config); it lost its dedicated orchestrator in #547 but was never removed
  from the classifier's assignable domain. Because `/adw_init` is still listed in
  `VALID_ISSUE_TYPES` (`adws/types/issueTypes.ts`) — the exact array the AI
  classifier turns into its last-match regex (`issueClassifier.ts` ~line 67) — the
  classifier can capture `/adw_init` straight out of the model's output. There is no
  `adw:adw_init` label, so the label-override path cannot produce it; the AI
  classifier is the only path that can. When it does, routing falls back to
  `adwPlanBuildTest.tsx` (no `/adw_init` entry in `issueTypeToOrchestratorMap`),
  which runs `/adw_init` as a *plan agent*. `/adw_init` writes no plan file, so the
  build phase resolves an absent plan path and `fs.readFileSync` throws `ENOENT` —
  the issue is moved to **Blocked**. This was observed live on #576, whose
  `adwinit-` branch prefix and `adwinit:` commit prefix confirm it was classified as
  `/adw_init`.

  The fix is domain-only and additive-safe:

    • Drop `/adw_init` from `VALID_ISSUE_TYPES`. This is the single source the AI
      classifier's regex is built from AND the domain `orchestratorCli.ts` validates
      `--issue-type` against, so one edit closes BOTH the classifier path and the
      CLI path.
    • KEEP `/adw_init` in the `IssueClassSlashCommand` union. The exhaustive
      `Record<IssueClassSlashCommand, string>` maps (`commitPrefixMap`,
      `branchPrefixMap`, `branchPrefixAliases` in `issueRouting.ts`) still require
      every union member, and the manual operator init/upgrade flow still references
      the command — so the union must retain it for the codebase to compile.

  With `/adw_init` out of the regex domain the classifier degrades to the last REAL
  type present in the model output, or defaults to `/feature` when none is present —
  it can never resolve to `/adw_init` again.

  The behavioural contract pinned below:

    1. SAFETY DEFAULT (the headline fix). When the model's classification output
       names ONLY the retired `/adw_init` type, the classifier resolves `/feature`
       — never `/adw_init`. This is precisely the #576 incident input; before the
       fix it resolved `/adw_init` and the issue was trapped.
    2. LAST-REAL-TYPE WINS. When the model names a genuine type (`/bug`) and then
       trails `/adw_init` as the textually-last token, the classifier resolves
       `/bug`. The trailing `/adw_init` is invisible to the regex, so the last-match
       rule lands on the last REAL type. A "fix" that merely reordered the regex but
       left `/adw_init` in the domain would resolve `/adw_init` here and fail.
    3. CLI DOMAIN CLOSED. Invoking an orchestrator with `--issue-type /adw_init` is
       rejected at argument validation (non-zero exit, an "Invalid issue type"
       diagnostic) — the same `VALID_ISSUE_TYPES` edit that closes the classifier
       path also closes the operator/automation CLI path.
    4. UNION RETAINED. The TypeScript type-check still passes, proving `/adw_init`
       stayed in the union so the exhaustive prefix maps and the manual init/upgrade
       flow still compile. A naive fix that deleted `/adw_init` from the union too
       would break those `Record<IssueClassSlashCommand, …>` maps — this backstop
       catches it.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system PRODUCES at runtime, never
    the text of a source file of this repo:

      • §1/§2 assert the classifier's resolved issue type — the runtime OUTPUT of
        running the classifier's own last-match logic (the regex it builds from the
        live `VALID_ISSUE_TYPES`) over a canned model classification output. The
        resolved type is a produced value, not a source-file property; keying the
        resolution to the live domain is what makes it flip exactly when the fix
        lands.
      • §3 asserts the orchestrator CLI subprocess's exit code (`World.lastExitCode`,
        the same surface behind registry T5) and its standard-error stream
        (Observability Surface 5, "Log streams") — both runtime outputs of a spawned
        process.
      • §4 asserts the type-checker's verdict — the OUTPUT of running `tsc`
        (registry T22), not any file's contents.

    The canned model outputs in §1/§2 are claude-cli-stub fixtures
    (`test/fixtures/jsonl/payloads/classify-*.json`) — INPUT data the rubric
    explicitly permits, the same category as the sibling `classify-as-feature.json`
    and every manifest under `test/fixtures/jsonl/`.

    Deliberately NOT asserted (would violate the framework Rot-Prevention rule): that
    `VALID_ISSUE_TYPES` excludes `/adw_init`, that `IssueClassSlashCommand` retains
    it, or any substring/AST match against `issueTypes.ts`, `issueClassifier.ts`, or
    `orchestratorCli.ts`. Those source-structure facts are the implementer's unit
    tests (the issue's Tests section); these scenarios pin only observable behaviour.
    No step reads any source file as text, substring-matches its contents, or parses
    it as JSON/AST.

  Scope notes:

    • The `ENOENT`-on-the-plan-file / moved-to-Blocked symptom is the DOWNSTREAM
      consequence of the classifier emitting `/adw_init`; removing the trigger (§1)
      removes the symptom. The intentional `getWorkflowScript('/adw_init')` →
      `adwPlanBuildTest.tsx` fallback is NOT changed by this issue and stays pinned
      by `adws/core/__tests__/workflowMapping.test.ts` ("orchestrator removed in
      #547") — these scenarios do not touch it.
    • The label-override path cannot produce `/adw_init` (there is no
      `adw:adw_init` label — see `labelManager.ts`), so the label branches proven in
      feature-540/542 need no change and are out of scope here.
    • The operational incident cleanup named in the issue (the stranded
      `adwinit-issue-576-…` worktree, the misplaced `adw-unknown` plan file, and
      `## Cancel`-ing #576 so it re-queues) is a one-time human chore with nothing to
      automate or observe, and is out of scope.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      G9  (`the claude-cli-stub is loaded with fixture {string}`),
      T5  (`the orchestrator subprocess exited {int}`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here (no registered phrase fits — the registry has no
    classifier-resolution or CLI-issue-type-validation phrase). The classification
    surface most closely resembles the sibling feature-542 webhook idiom
    (`inferTypeFromFixture`, which resolves a fixture against the live
    `VALID_ISSUE_TYPES`), but that idiom observes the spawned orchestrator's
    classification rather than the classifier's own resolved type, so a direct
    phrasing is introduced. The gap is surfaced to the maintainer in the Output:
      • `the issue classifier resolves the type for issue {int}`
      • `the resolved issue type for issue {int} is {string}`
      • `the resolved issue type for issue {int} is not {string}`
      • `the {string} orchestrator CLI is invoked with the pre-classified issue type {string}`
      • `the orchestrator's standard error reports {string} as an invalid issue type`

    New stub fixtures required (created alongside this feature; canned model outputs,
    not source files):
      • `test/fixtures/jsonl/payloads/classify-emits-adw-init-only.json`
      • `test/fixtures/jsonl/payloads/classify-bug-then-adw-init.json`

  Background:
    Given the ADW codebase is checked out

  # ── §1 Safety default — model output naming only /adw_init resolves to /feature ──
  #
  # The #576 incident input: the model returns the retired `/adw_init` as its sole
  # classification. With `/adw_init` out of the regex domain the classifier finds no
  # valid token and falls back to its `/feature` safety default. Before the fix this
  # captured `/adw_init` and the issue was trapped at the missing-plan build phase.

  @adw-584 @adw-vv6d4h-classifier-can-assig
  Scenario: AI output naming only the retired /adw_init type degrades to /feature
    Given the claude-cli-stub is loaded with fixture "classify-emits-adw-init-only.json"
    When the issue classifier resolves the type for issue 8584
    Then the resolved issue type for issue 8584 is "/feature"
    And the resolved issue type for issue 8584 is not "/adw_init"

  # ── §2 Last-real-type wins — a trailing /adw_init never beats a genuine type ────
  #
  # The model names `/bug` and then trails `/adw_init` as the textually-last token.
  # The classifier's rule is "last matchable type wins"; with `/adw_init` removed
  # from the domain the trailing token is invisible, so the resolution lands on the
  # last REAL type, `/bug`. Pre-fix the trailing `/adw_init` was matchable and won —
  # so this scenario is a true regression guard, not merely a happy path.

  @adw-584 @adw-vv6d4h-classifier-can-assig
  Scenario: AI output naming /bug before a trailing /adw_init resolves to /bug
    Given the claude-cli-stub is loaded with fixture "classify-bug-then-adw-init.json"
    When the issue classifier resolves the type for issue 8585
    Then the resolved issue type for issue 8585 is "/bug"
    And the resolved issue type for issue 8585 is not "/adw_init"

  # ── §3 CLI domain closed — --issue-type /adw_init is rejected at arg validation ─
  #
  # The same `VALID_ISSUE_TYPES` edit closes the operator/automation CLI path:
  # `--issue-type /adw_init` is now an invalid value. Argument validation runs before
  # any workflow/network/auth, so the orchestrator exits non-zero with an
  # "Invalid issue type" diagnostic naming the rejected value — a fast, deterministic
  # spawn that never reaches the heavyweight orchestrator body.

  @adw-584 @adw-vv6d4h-classifier-can-assig
  Scenario: The orchestrator CLI rejects a pre-classified /adw_init issue type at argument validation
    When the "sdlc" orchestrator CLI is invoked with the pre-classified issue type "/adw_init"
    Then the orchestrator subprocess exited 1
    And the orchestrator's standard error reports "/adw_init" as an invalid issue type

  # ── §4 Union retained — type-check proves /adw_init stayed in the type union ────
  #
  # Removing `/adw_init` from the union as well would break the exhaustive
  # `Record<IssueClassSlashCommand, string>` prefix maps and the manual init/upgrade
  # flow. The type-check is the backstop that keeps the fix domain-only.

  @adw-584 @adw-vv6d4h-classifier-can-assig
  Scenario: TypeScript type-check passes with /adw_init out of VALID_ISSUE_TYPES but retained in the type union
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
