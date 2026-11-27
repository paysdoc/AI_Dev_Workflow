---
status: accepted
date: 2026-11-27
recorded: 2026-11-27
provenance:
  - kind: transcript
    source: "Claude Code session a2ef503a, grill of 2026-11-27"
  - kind: contemporaneous
    source: "Handoff note of 2026-11-27 from a session in vestmatic/deckerly, holding the line counts quoted here; read in the session and not kept in the repository"
  - kind: contemporaneous
    source: "Sample of vestmatic/deckerly at origin/dev 42cbe6b (issues 264, 278, 317), read in the same session"
supersedes: ["0014", "0018", "0024", "0031", "0037"]
superseded-by: []
---

# Scenarios prove only behaviour at a declared real boundary, one per acceptance criterion; unit tests are not paired with them

## Context and Problem Statement

vestmatic/deckerly is built through ADW. On 2026-11-27 its test code outweighed its production code 3.6 to 1 (112,684 lines of unit tests, 30,421 lines under `features/`, 39,785 lines of production code), and PR #271 carried about 25,000 lines of tests for 4,123 lines of production code.

A sample of three issues (23 scenarios) was read against the Vitest suite. 19 scenarios ran in the test process, and 16 of those repeated an existing Vitest case. The Worker scenarios loaded the Vitest harness itself (`features/support/deck-brief.ts` imports `worker/test/deck/deck-job-harness.ts`). No scenario in the sample asserted something no unit test did. Issue 317 had 12 scenarios, most of them tables of PNG filters, byte limits and thresholds. Of 1,416 step definitions, 657 were used by no feature file and 330 by exactly one scenario.

The prompts produce this. `scenario_writer.md` has no rule on how many scenarios to write, on which behaviour belongs in a scenario and which in a unit test, or on the level a scenario runs at. `implement-tdd` tells the builder to "write the step definition AND a unit test alongside it", so every scenario is proven twice by instruction. ADR-0018 justifies the pairing by calling scenarios "the independent proof layer". The vocabulary's three permitted execution patterns include two that run in the test process. Two agents write step definitions, the builder first, so the vocabulary refusal in the second guards nothing; no code reads its `vocabularyViolations` output. In deckerly the registry grew to 551 phrases over 36 bot commits.

This record covers scenario writing, step definitions and the split between scenarios and unit tests, in target repositories and in ADW's own. Promotion to the regression suite is in [ADR-0068](0068-promotion-by-nomination-and-human-decided-proposal.md).

## Decision Drivers

* A behaviour change costs three edits (unit test, scenario, step definitions), paid again in agent tokens and context on every later issue.
* Nobody reviews 25,000 lines of tests in one pull request, so the volume gives less confidence than it suggests.
* A scenario that runs on memory adapters inside the test process proves nothing a unit test does not.
* The step code is written by the builder, so the independence ADR-0018 relies on is weaker than it assumed.

## Considered Options

For which behaviour gets a scenario: every behaviour of the issue, as today; only behaviour observable through a real boundary; keep both layers and cap the count.

For how the boundaries are known: judged by the scenario agent on each issue; a list kept by each target.

For how many scenarios: a numeric cap per issue; one per acceptance criterion observable at a boundary.

For step-definition reuse: a deterministic gate requiring every phrase to be registered; a budget of new step definitions per scenario; no gate on per-issue scenarios, with the vocabulary applying to the regression suite only.

For who writes step definitions: the builder and the step-definition agent, as today; the builder alone.

## Decision Outcome

Chosen: scenarios only at a real boundary; a list kept by each target; one scenario per acceptance criterion; no reuse gate on per-issue scenarios; the builder alone writes step definitions.

* **Layer rule.** A scenario may only prove behaviour observable through a real boundary of the target: its real runtime, a real browser, the built artifact or a real command-line invocation. Behaviour provable inside the test process belongs to unit tests alone. The rule holds for ADW's own repository too, for new scenarios, with the subprocess pattern as its boundary; the phase-import and mock-query patterns stop being scenario material. Existing scenarios are not migrated.
* **Declared boundaries.** Each target lists its real boundaries in `.adw/scenarios.md`. `adw_init` writes the list from the application type. Where an existing target has none, the scenario agent creates it on its first run there. The list is changed in the pull request that adds or removes a boundary, by the agents working that issue, and the change is called out in the pull request description.
* **Boundary tag.** Every scenario carries a tag naming the boundary it drives. Code checks the tag against the list. The reviewer checks that the step code really drives that boundary, because that can only be seen by tracing the step definitions into the support code.
* **One scenario per acceptance criterion** that is observable at a boundary. Variants, edge cases and error tables go to unit tests. There is no numeric cap, because agents write up to a number.
* **Zero scenarios is a valid outcome.** When an issue has no behaviour at a declared boundary, the scenario agent writes nothing and says why. The reviewer judges that claim. A missing scenario blocks review only when the issue changes boundary behaviour.
* **Unit tests are not paired with scenarios.** `implement-tdd` loses the instruction to write a unit test alongside every step definition. Unit tests come from the plan. The feature and bug planning prompts state the layer rule, so the plan's unit-test section takes the variants and edge tables that scenarios no longer hold.
* **The builder is the only author of step definitions.** The step-definition phase becomes a deterministic check for undefined steps.
* **No reuse gate on per-issue scenarios.** They live 14 days after merge, and the registry gate turned into a registry that agents fill. The vocabulary applies to the regression suite only and is applied when a scenario is promoted.

No test budget and no scaling of unit-test depth by code risk are decided here. That question was set aside for a separate session.

### Consequences

* Good, because an issue with in-process behaviour produces one artifact per behaviour instead of three.
* Good, because the tag turns "this scenario drives a real boundary" into a stated claim the reviewer can check.
* Good, because the count is tied to the issue's acceptance criteria, which the reviewer can count.
* Bad, because in-process behaviour loses its independent proof: only the builder's own unit tests cover it.
* Bad, because the layer rule, the count rule and the zero-scenario claim are prompt text judged by the reviewer. Only the tag check and the undefined-step check are code. ADR-0066 took the same route and records that nothing mechanical stops an agent that ignores the text.
* Bad, because duplication remains where a target's unit tests also drive the real runtime, as deckerly's scraper tests do with Chromium. It is one scenario per acceptance criterion and was accepted.
* Bad, because unit tests are 55% of deckerly and this decision reduces them only by the unpairing.

### Confirmation

No check exists yet. Once built, the boundary-tag check and the undefined-step check run in the pipeline; everything else is judged in review. The owner asked for deckerly's line counts to be measured again a month after release, by running `git diff --numstat --no-renames $(git hash-object -t tree /dev/null) HEAD` in deckerly and splitting the result by path: `features/**` as scenarios, anything under a `test/` directory as unit tests, every `src/`, `scraper/in-page/` and `scripts/` as production code.

Checked against the code on 2026-11-27, before any prompt was changed:

* `.claude/commands/scenario_writer.md` has no sentence on scenario count, layer or execution level; its only content rule is rot prevention (lines 30-42).
* `.claude/skills/implement-tdd/SKILL.md:84` reads "Write the step definition AND a unit test alongside it".
* `.claude/commands/review.md:49` makes a missing per-issue scenario a blocker for features and bugs.
* `adws/agents/stepDefAgent.ts` parses only `removedScenarios`; `grep -rn vocabularyViolations adws` finds nothing.
* `adw_init.md` never writes `## Vocabulary Registry`; `templates/vocabulary.md.template` lists three execution patterns.

## Divergence

The code does not yet follow this decision; the checks above show the state it replaces. The difference is deliberate until the work is specified in a PRD and built through issues. Nothing was changed in the session that produced this record except `UBIQUITOUS_LANGUAGE.md`.

## More Information

* Supersedes, in part, [ADR-0014](0014-bdd-as-validation-contract-unit-tests-removed.md): scenarios are no longer the validation contract for every behaviour of an issue, only for behaviour at a declared real boundary.
* Supersedes, in part, [ADR-0018](0018-unit-tests-restored-alongside-bdd.md): unit tests no longer only supplement scenarios. For in-process behaviour they are the only proof.
* Supersedes, in part, [ADR-0024](0024-tdd-in-build-phase-single-pass-alignment.md): the build loop no longer writes a unit test for every scenario.
* Supersedes, in part, [ADR-0031](0031-active-test-phase-passive-review-judge.md): the step-definition phase between build and unit test is a deterministic check, not an agent.
* Supersedes, in part, [ADR-0037](0037-tiered-regression-suite-with-fixed-vocabulary.md): the fixed vocabulary binds the regression suite only, and of its three permitted execution patterns only those that cross a real boundary remain.
* [ADR-0066](0066-build-agents-implement-the-plan-and-nothing-else.md) is unchanged. Its "extra tests never qualify" now has no per-scenario unit-test rule beside it.
* Left out on purpose: converting existing in-process per-issue scenarios to unit tests (the per-issue sweep removes them); detecting stale entries in the boundary list (a scenario against a dead boundary fails when it runs); mutation testing on deckerly.
* The terms Real Boundary, Per-Issue Scenario and Regression Suite are defined in `UBIQUITOUS_LANGUAGE.md`.
