---
status: accepted
date: 2026-04-25
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/bdd-rewrite-tiered-regression.md
  - kind: contemporaneous
    source: specs/prd/bdd-rewrite-surface-matrix.md
  - kind: contemporaneous
    source: specs/prd/scenario-rot-prevention-and-promotion.md
  - kind: contemporaneous
    source: specs/issue-491-adw-5ch3sx-bdd-rewrite-1-3-foun-sdlc_planner-bdd-foundation-stub-vocabulary-matrix.md
  - kind: contemporaneous
    source: specs/issue-492-adw-2evbnk-bdd-rewrite-2-3-auth-sdlc_planner-bdd-authoring-smoke-surface-scenarios.md
  - kind: contemporaneous
    source: specs/issue-493-adw-oobdbg-bdd-rewrite-3-3-cuto-sdlc_planner-bdd-cutover-polymorphic-prompts-sweep.md
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
  - kind: recalled
    source: "Martin Koster, 2026-09-30"
  - kind: recalled
    source: "Martin Koster, 2026-10-01"
supersedes: []
superseded-by: []
---

# Tiered regression suite with a fixed vocabulary

## Context and Problem Statement

By April 2026 ADW had 119 feature files, about 115 tagged `@regression`. The PRD calls the suite "glorified linting": most step definitions checked that a file existed or contained a string. The mock harness of [ADR-0021](0021-behavioural-test-harness-with-mocked-boundaries.md) was barely used. The cause was structural: the scenario writer had no constraint to write behaviour, the step-definition generator implemented whatever was asked, the `@regression` sweep "promotes everything; nothing demotes", and each PR looked plausible alone because "rot is cumulative, not per-PR".

## Decision Drivers

* A phase-coordination bug, for example "`adwChore` silently skipped diff evaluation", must fail the suite.
* Drift back to file-shape assertions must be prevented by structure, not by reviewer attention.
* Target repos with their own scenarios must keep working unchanged.

## Considered Options

* Delete the old suite and rebuild coverage from a surface matrix
* Migrate the existing `@regression` scenarios into the new vocabulary
* Demote the old features to `@adw-{N}` before deleting them

## Decision Outcome

Chosen option: "delete and rebuild", because "The old features have unknown coverage value"; migration was "not attempted".

* **Two tiers, two folders.** `features/regression/` holds the hand-curated `@regression` suite. `features/per-issue/feature-{N}.feature` holds the agent-written `@adw-{N}` scenarios of one issue, deleted by a cron sweep 14 days after the PR merges. A file carries one tag or the other.
* **Promotion is a human decision.** The scenario writer never tags `@regression` when a regression directory is configured. The mechanism is in [ADR-0049](0049-promotion-sweep-files-human-gated-issue.md).
* **Fixed vocabulary.** `features/regression/vocabulary.md` registers the allowed Gherkin phrases, each with one step definition. The generator refuses unregistered phrases. A new phrase needs a PR with the entry and its implementation.
* **Rot rubric.** A step definition does exactly one of: run an orchestrator subprocess and assert on state, recorded calls or artifacts; call a phase function against a mocked `WorkflowConfig`; query the harness's recorded interactions. `existsSync`, `readFileSync(...).includes(...)` and structural parsing of source files are forbidden.
* **Rot prohibition at the source** (PRD of 2026-05-21). `scenario_writer.md` carries a "Rot Prevention" block that applies to every run in every target repo and cannot be overridden per repo.
* **Hybrid execution.** A few smoke scenarios run real orchestrators against a Claude stub programmed by per-test manifests. Surface scenarios import phase functions and run in seconds.
* **Polymorphic prompts.** Three optional sections in `.adw/scenarios.md` switch the contract on. A repo without them keeps free-form behaviour.
* **Required check.** Running `features/regression/` is to be a required check on all PRs, human and ADW.

### Consequences

* Good, because per-issue scenarios no longer pile up in the regression suite.
* Good, because a scenario built from registered phrases cannot assert on file shape without a reviewed vocabulary change.
* Bad, because the old suite's coverage was discarded without an inventory.
* Bad, because the rubric is enforced by review and prompts only. No lint checks step definitions against it.
* Bad, because the intended gain, wiring bugs failing the suite, is not delivered yet: the smoke and surface scenarios do not execute (see More Information).

### Confirmation

Checked on 2026-09-29: `.adw/scenarios.md` declares the three sections; `RETENTION_DAYS = 14` in `adws/triggers/perIssueScenarioSweep.ts`; `scenario_writer.md` has the "Rot Prevention" block; no per-issue file carries a `@regression` tag. The suite holds 6 smoke and 34 surface files. `vocabulary.md` registers 73 phrases, against the 25 to 35 the PRD expected. The cutover landed on 2026-04-28 (23e88251). The CI gate is absent; see Divergence. The hybrid execution model is not in force; see Divergence, item 3.

## Divergence

1. **Per-issue scenarios are executed.** The PRD scoped `cucumber.js` to `features/regression/**` so that per-issue scenarios are "never executed by the test runner". Commit 23e88251 did that; commit 523f0650 (2026-05-13, #504) added `features/per-issue/**` back, and `cucumber.js` lists both paths today. Ruling (owner, 2026-09-29): per-issue scenarios are run by their own workflow's test phase, by `@adw-{N}` tag, and never as part of the regression run. The PRD and README wording is wrong; the code is correct. Deliberate.
2. **The suite is not a required check.** The ruleset on the default branch and `main` has the rules `deletion`, `non_fast_forward` and `pull_request`, and no status checks (`gh api repos/paysdoc/AI_Dev_Workflow/rulesets/14100115`). `.github/workflows/regression.yml` runs on a daily schedule and manual dispatch only. Of its last 100 runs (2026-06-22 to 2026-09-28, `gh run list`) 80 failed, 19 were cancelled and 1 passed, a manual dispatch on 2026-07-22. In the run of 2026-09-28 the Docker step failed; the host step ends with `exit 0` and cannot fail the job. The cause of the other failures was not determined. Ruling (owner, 2026-09-29): the PRD stands. This is a bug, blocked on teaching the merge path to wait for checks ([ADR-0019](0019-dev-and-main-branches-with-runner-clone.md), [ADR-0038](0038-stateless-merge-gate.md)). Meanwhile ADW's own workflows run `@regression` as a blocker tag in their test phase (`getDefaultReviewProofConfig`); PRs opened by people have no gate at all.
3. **Smoke and surface scenarios are pending.** The smoke and surface scenarios are pending. Ten When steps in `features/regression/step_definitions/whenSteps.ts` begin with `return 'pending';` and keep their bodies in a block comment. Commit 6ffd1416 (2026-04-26) added this because the harness could not mock "the orchestrator's full GitHub App auth + target-repo workspace + end-to-end Claude pipeline" within #492's scope; the #492 spec says the cutover issue "flips the pending markers off". It did not. The run of 2026-09-28 reported "53 scenarios (1 undefined, 42 pending, 10 passed)": all 34 surface scenarios and all 8 smoke scenarios were pending, one hashing scenario was undefined, and Cucumber exited 1. ADW's own test phase does not fail on them: `classifyTestCase` (`adws/core/testReportParser.ts`) scores a pending or undefined scenario as skipped. Ruling (owner, 2026-09-30): the pending markers were meant to come off. A bug; the harness work is owed. Making the suite a required check (item 2) depends on it.
4. **Two step definitions assert on source text.** `thenSteps.ts` holds two branches for `this.mockContext === null` that read `adws/adwSdlc.tsx` and `adws/phases/authPause.ts` and assert with `.includes(...)`. This is the pattern the rubric forbids. The comments say the branches serve per-issue scenarios. Ruling (owner, 2026-10-01): the rubric applies to everything under `features/regression/`. The two branches are a bug.
5. **Two regression features keep their per-issue tags.** `features/regression/hashing/feature-537.feature` and `features/regression/upgrade/feature-729.feature` carry both `@regression` and `@adw-{N}`, which the PRD rules out. Ruling (owner, 2026-10-01): promotion must strip the `@adw-` tags. The two files are leftovers and a bug.
6. **One feature file is never run.** `features/webhook_ensure_cron_on_every_event.feature` sits outside both folders and outside the `cucumber.js` paths, so it is never run. Its step definitions in `features/step_definitions/` are still imported. It holds 17 scenarios tagged `@adw-501`, written on 2026-04-28 for the fix that calls `ensureCronProcess` on every webhook event; that behaviour is still in `adws/triggers/trigger_webhook.ts`. Ruling (owner, 2026-10-01): a bug. The file is promoted into `features/regression/`, rewritten to the rubric, or deleted with its step definitions.

## More Information

* `date` is 2026-04-25: issues #491 and #492 were filed and the surface matrix committed that day; the PRD file followed on 2026-04-26.
* Promotion by tag edit was the first mechanism ([ADR-0040](0040-scenario-promotion-by-tag-edit.md)), replaced by ADR-0049. The test phase that runs both tags is in [ADR-0031](0031-active-test-phase-passive-review-judge.md).
