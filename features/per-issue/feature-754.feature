@adw-754 @adw-uhkozf-cron-requires-adw-la
Feature: A fresh unlabeled cron candidate is spawn-eligible for downstream LLM classification, not filtered as no_adw_label

  Issue #754 reverses a regression introduced by #545 (commit f7504771,
  2026-06-08). #545 ("CRON recovery layer for label eligibility", PR #554) was
  scoped as an *additive* recovery scan for already-`adw:*`-labelled stranded
  issues, but was implemented as a *replacement* gate on the cron's fresh path:
  `decideLabelRecovery` (`cronLabelEligibility.ts`) returns
  `{ eligible: false, reason: 'no_adw_label' }` whenever the label reading yields
  no classification, and that gate is wired into the truly-fresh branch of
  `evaluateIssue` (`cronIssueFilter.ts`). The net effect inverted the pre-#545
  fresh-issue default from unconditionally-eligible to label-required.

  That default is wrong: `adw:*` is a deterministic *override* of AI
  classification, not a precondition for pickup. The spawn path the gate feeds
  already LLM-classifies unlabeled issues — `trigger_cron.ts` sets `labelRouting`
  undefined when there is no label and `classifyAndSpawnWorkflow` then runs the
  classifier, exactly as the webhook opened-path and comment-path do. Cron was the
  only trigger that *required* a label, so an unlabeled issue stranded whenever the
  webhook — which AI-classifies and applies the `adw:*` label on `issues.opened` —
  was down (incident: vestmatic-research #28/#29, 2026-07-10, sitting at
  `filtered: #N(label:no_adw_label)` on every 20s poll).

  The fix, in `decideLabelRecovery`: stop rejecting a *truly-unlabeled* fresh issue.
  An issue carrying no `adw:*` label becomes eligible with no deterministic
  classification attached (classification omitted → downstream LLM classification),
  after still passing every other guard. The null-classification rejection is not
  deleted outright — it is *narrowed* to fire only when the issue still carries a
  reserved, non-classification `adw:*` label (`adw:upgrade` / `adw:blocked` /
  `adw:unverified`), and its reason is renamed `no_adw_label` → `reserved_label`.
  That narrowing preserves the load-bearing invariant that `#UPG` (`adw:upgrade`)
  tracking issues stay out of the standard spawn loop — `upgradeRedrive.ts` depends
  on their being filtered — which a bare removal of the guard would regress. The
  genuinely-useful #545 guards are kept exactly as they were — `opt_out`
  (`adw:none`), `multi_label` (conflict), `in_progress_comment`, `linked_closed_pr`
  — and, because the old `no_adw_label` guard sat *before* them in the precedence
  chain, those guards now correctly apply to truly-unlabeled issues too (previously
  they were masked: an unlabeled issue that also tripped a later guard was reported
  as `no_adw_label`).

  Precedence chain after the fix:

    opt_out → multi_label → reserved_label (non-classification adw:* label)
      → in_progress_comment → linked_closed_pr → eligible

  (the old `no_adw_label` guard between `multi_label` and `in_progress_comment` is
  narrowed to `reserved_label` — it no longer fires for a truly-unlabeled issue,
  only for a reserved `adw:*` label such as `adw:upgrade`.)

  Observability / rot-prevention note:

    Every assertion below targets the return value of the pure eligibility decision
    exercised in-process — an *output* of the system under test, not the text of a
    source file. `evaluateLabelRecovery` (which composes `readAdwLabelNames`,
    `isAdwComment`, `hasLinkedMergedOrClosedPR`, and the fixed `decideLabelRecovery`)
    is invoked directly with the scenario's seeded issue state and linked-PR list;
    the scenarios assert the returned `{ eligible, reason, classification }`. No step
    reads `cronLabelEligibility.ts` (or any module) as text, substring-matches its
    contents, or parses it as JSON/AST. This is the pure-decision, in-process drive
    the acceptance criteria call for.

  Scope notes:

    • The `{ optOut, classification, conflict }` label reading these signals are
      derived from is owned by `labelManager.readAdwLabels` (issue #540) and proven
      exhaustively there — including that non-`adw:` labels (`bug`, `enhancement`)
      and look-alikes (`adw-bug`, `adwesome`) yield no classification. This feature
      exercises only what the eligibility decision *does* with a null classification,
      not a re-enumeration of the reading.
    • The composition level — that the cron sweep's fresh path
      (`evaluateIssue` in `cronIssueFilter.ts`) now spawns an unlabeled issue instead
      of annotating it `label:no_adw_label` — is proven end-to-end by the #754-updated
      "no adw:* labels" scenario in feature-545.feature. This feature pins the
      pure decision beneath it.
    • The unit test on `decideLabelRecovery` (`classification: null` + clean signals →
      eligible, RED→green) lives alongside the module; these BDD scenarios pin the
      same reversal at the composed `evaluateLabelRecovery` altitude.

  Vocabulary note:

    `features/regression/vocabulary.md` registers no phrase for a fresh-issue label
    eligibility decision (it covers orchestrator/phase invocation and mock/artefact
    assertions, not this pure cron-eligibility function). Novel Gherkin phrasing is
    introduced below for seeding a fresh cron candidate's labels / in-progress
    comment / linked-PR state, evaluating its label eligibility, and asserting the
    decision's eligibility, reason, and attached classification. The gap is surfaced
    to the maintainer in the agent Output. The phrasing is deliberately distinct from
    feature-545's issue-numbered "cron recovery scan" phrases so the two per-issue
    step-definition modules do not collide.

  Defaults: unless a scenario states otherwise, the fresh candidate has no
  in-progress ADW workflow comment and no linked pull request — a clean candidate —
  so each scenario adds only the one signal it exercises.

  Background:
    Given the ADW codebase is checked out

  # ── The reversal: a clean unlabeled fresh issue is eligible (AC1, RED→green) ──
  # Pre-#754 this returned no_adw_label; the fix makes it eligible with no
  # deterministic classification so the downstream LLM classifies it.

  @adw-754 @adw-uhkozf-cron-requires-adw-la
  Scenario: A fresh unlabeled issue with clean signals is eligible and defers classification to the LLM
    Given a fresh cron candidate issue carrying no adw:* label
    When its cron label eligibility is evaluated
    Then the fresh issue is eligible for spawn
    And the eligibility decision attaches no deterministic classification

  # ── #UPG regression guard: a reserved adw:* label stays filtered (reserved_label) ─
  # The null-classification rejection is narrowed, not removed: an issue carrying a
  # reserved, non-classification adw:* label (adw:upgrade / adw:blocked /
  # adw:unverified) still reads as classification === null but keeps being filtered,
  # now under the renamed reason `reserved_label`. This is the load-bearing invariant
  # that keeps #UPG upgrade-tracking issues out of the standard spawn loop —
  # `upgradeRedrive.ts` depends on it; a bare removal of the guard would regress it.

  @adw-754 @adw-uhkozf-cron-requires-adw-la
  Scenario: A reserved adw:upgrade label is still filtered as reserved_label, not spawned
    Given a fresh cron candidate issue carrying the labels "adw:upgrade"
    When its cron label eligibility is evaluated
    Then the fresh issue is not eligible, with reason "reserved_label"

  # ── adw:none opt-out still wins (AC2) ────────────────────────────────────────

  @adw-754 @adw-uhkozf-cron-requires-adw-la
  Scenario: A lone adw:none label still opts the fresh issue out
    Given a fresh cron candidate issue carrying the labels "adw:none"
    When its cron label eligibility is evaluated
    Then the fresh issue is not eligible, with reason "opt_out"

  @adw-754 @adw-uhkozf-cron-requires-adw-la
  Scenario: adw:none alongside a single adw:* type still opts out — opt-out precedence preserved
    Given a fresh cron candidate issue carrying the labels "adw:none,adw:bug"
    When its cron label eligibility is evaluated
    Then the fresh issue is not eligible, with reason "opt_out"

  # ── Two adw:* labels still rejected as a conflict (AC3) ──────────────────────

  @adw-754 @adw-uhkozf-cron-requires-adw-la
  Scenario: Two distinct adw:* type labels are still rejected as a conflict
    Given a fresh cron candidate issue carrying the labels "adw:bug,adw:feature"
    When its cron label eligibility is evaluated
    Then the fresh issue is not eligible, with reason "multi_label"

  # ── In-progress ADW comment still defers — now for unlabeled issues too (AC4) ─
  # Pre-#754 this returned no_adw_label (the null-classification guard sat first, and
  # for an unlabeled issue it is now narrowed away); the fix lets the
  # in_progress_comment guard fire on an unlabeled issue. RED→green on the reason.

  @adw-754 @adw-uhkozf-cron-requires-adw-la
  Scenario: A fresh unlabeled issue already carrying an in-progress ADW workflow comment still defers
    Given a fresh cron candidate issue carrying no adw:* label
    And the fresh issue has an in-progress ADW workflow comment
    When its cron label eligibility is evaluated
    Then the fresh issue is not eligible, with reason "in_progress_comment"

  # ── Linked merged/closed PR still skips — now for unlabeled issues too (AC5) ──

  @adw-754 @adw-uhkozf-cron-requires-adw-la
  Scenario: A fresh unlabeled issue with a linked merged pull request still skips
    Given a fresh cron candidate issue carrying no adw:* label
    And the fresh issue has a linked merged pull request
    When its cron label eligibility is evaluated
    Then the fresh issue is not eligible, with reason "linked_closed_pr"

  @adw-754 @adw-uhkozf-cron-requires-adw-la
  Scenario: A fresh unlabeled issue with a linked closed (unmerged) pull request still skips
    Given a fresh cron candidate issue carrying no adw:* label
    And the fresh issue has a linked closed pull request
    When its cron label eligibility is evaluated
    Then the fresh issue is not eligible, with reason "linked_closed_pr"

  # ── A single adw:* label still routes deterministically, no LLM (AC6, unchanged) ─

  @adw-754 @adw-uhkozf-cron-requires-adw-la
  Scenario: A single adw:feature label still routes deterministically without the LLM
    Given a fresh cron candidate issue carrying the labels "adw:feature"
    When its cron label eligibility is evaluated
    Then the fresh issue is eligible for spawn
    And the eligibility decision attaches the deterministic classification "/feature"
