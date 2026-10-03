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

### Confirmation

Checked on 2026-09-29: `.adw/scenarios.md` declares the three sections; `RETENTION_DAYS = 14` in `adws/triggers/perIssueScenarioSweep.ts`; `scenario_writer.md` has the "Rot Prevention" block; no per-issue file carries a `@regression` tag. The suite holds 6 smoke and 34 surface files. `vocabulary.md` registers 73 phrases, against the 25 to 35 the PRD expected. The cutover landed on 2026-04-28 (23e88251). The CI gate is absent; see Divergence. Checked on 2026-10-03: the hybrid execution model is in force. The smoke scenarios run real processes: `adwChore.tsx`, `adwSdlc.tsx`, the promotion sweep and the cron trigger as child processes behind the `gh` shadow and the Claude CLI stub, and the cancel directive through the real webhook dispatcher. The surface scenarios import phase functions; rows 01, 10, 11, 16, 19, 29 and 30 need a process boundary and run on the same subprocess harness. The suite still holds 6 smoke and 34 surface files. No step under `features/regression/` returns `'pending'`, and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` exits 0.

## Divergence

1. **Per-issue scenarios are executed.** The PRD scoped `cucumber.js` to `features/regression/**` so that per-issue scenarios are "never executed by the test runner". Commit 23e88251 did that; commit 523f0650 (2026-05-13, #504) added `features/per-issue/**` back, and `cucumber.js` lists both paths today. Ruling (owner, 2026-09-29): per-issue scenarios are run by their own workflow's test phase, by `@adw-{N}` tag, and never as part of the regression run. The PRD and README wording is wrong; the code is correct. Deliberate.
2. **The suite is not a required check.** The ruleset on the default branch and `main` has the rules `deletion`, `non_fast_forward` and `pull_request`, and no status checks (`gh api repos/paysdoc/AI_Dev_Workflow/rulesets/14100115`). `.github/workflows/regression.yml` runs on a daily schedule and manual dispatch only. It has two jobs, `host` and `docker`, each with a 30-minute timeout; the schedule runs both, and a manual dispatch runs the one its `runtime` input names. A job fails when Cucumber exits non-zero, which a failed, pending or undefined scenario causes. The `docker` job mounts the checkout read-only and runs the suite in a writable copy inside the container, because ADW writes its runtime state (`agents/`, `logs/`) under the working directory. Until #962 both legs ran in one job: the host step ended with `exit 0` and could not fail it, and the Docker step ran the suite on the read-only mount, where the pause-queue scenarios failed with `EROFS`. Of the 100 runs from 2026-06-22 to 2026-09-28, 80 failed, 19 were cancelled and 1 passed. Ruling (owner, 2026-09-29): the PRD stands. This is a bug, blocked on teaching the merge path to wait for checks ([ADR-0019](0019-dev-and-main-branches-with-runner-clone.md), [ADR-0038](0038-stateless-merge-gate.md)). Meanwhile ADW's own workflows run `@regression` as a blocker tag in their test phase (`getDefaultReviewProofConfig`); PRs opened by people have no gate at all.

## More Information

* `date` is 2026-04-25: issues #491 and #492 were filed and the surface matrix committed that day; the PRD file followed on 2026-04-26.
* Promotion by tag edit was the first mechanism ([ADR-0040](0040-scenario-promotion-by-tag-edit.md)), replaced by ADR-0049. The test phase that runs both tags is in [ADR-0031](0031-active-test-phase-passive-review-judge.md).
