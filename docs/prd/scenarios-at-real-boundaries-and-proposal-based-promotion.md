# PRD: Scenarios at Real Boundaries and Proposal-Based Promotion

Decisions: [ADR-0067](../adr/0067-scenarios-prove-only-behaviour-at-a-declared-real-boundary.md) and [ADR-0068](../adr/0068-promotion-by-nomination-and-human-decided-proposal.md), both of 2026-11-27. Terms in capitals (Real Boundary, Per-Issue Scenario, Regression Suite, Nomination, Promotion Proposal, Promotion, Per-Issue Sweep) are defined in `UBIQUITOUS_LANGUAGE.md`.

## Problem Statement

Repositories built through ADW collect far more test code than the behaviour warrants. In vestmatic/deckerly on 2026-11-27, test code outweighed production code 3.6 to 1, and one pull request carried about 25,000 lines of tests for 4,123 lines of production code. Nobody reviews that much test code, every behaviour change costs three edits (unit test, scenario, step definitions), and each later issue pays for it in agent tokens and context.

Reading the tests showed where the excess comes from:

- **Scenarios repeat unit tests.** In a sample of 23 scenarios, 19 ran inside the test process and 16 of those repeated an existing unit test. None asserted something no unit test did. The workflow tells the builder to write a unit test alongside every step definition, so the repetition is by instruction.
- **Scenario writing has no limits.** The scenario agent has no rule on how many scenarios to write, on what belongs in a scenario and what in a unit test, or on the level a scenario runs at. One issue produced 12 scenarios, most of them tables of edge cases.
- **Step code is never cleaned up.** The Per-Issue Sweep deletes feature files 14 days after merge but leaves their step definitions in target repositories. In deckerly 657 of 1,416 step definitions, about 5,700 lines, were used by no feature file.
- **The vocabulary restrains nothing.** Agents register whatever phrases they need; deckerly's registry reached 551 phrases. Two agents write step definitions, and the one that enforces the vocabulary runs second.
- **Promotion is too eager.** A cron sweep scores Per-Issue Scenarios and files a promotion issue that the pipeline builds. The scorer passes scenarios with no registered step, takes whole files, and ignores age. The human gate approved everything: 21 of 21 in ADW, 27 of 27 in deckerly, some merged by the bot. deckerly's Regression Suite held 213 scenarios against 169 Per-Issue Scenarios, and the suite runs as a blocking step in every workflow.

## Solution

**Scenarios prove only what unit tests cannot.** A scenario is written only for behaviour observable through a Real Boundary of the target: its real runtime, a real browser, the built artifact or a real command-line invocation. Each target keeps a list of its Real Boundaries, and every scenario names the one it drives. The scenario agent writes one scenario per acceptance criterion that is observable at a boundary, and none when the issue has no such behaviour. Variants and edge cases go to unit tests, which the plan specifies. The builder no longer writes a unit test for every scenario, and it is the only agent that writes step definitions.

**The Regression Suite grows only by the owner's decision.** The scenario agent may nominate at most one scenario per issue, and nominates nothing by default. Once a week ADW gathers a repository's Nominations into one Promotion Proposal: an issue that explains, per candidate, why it qualifies and how it fits the existing suite. The owner ticks the candidates to promote and closes the issue as completed. Only then does ADW file an issue that the pipeline builds unattended, moving the approved scenarios into the suite one by one. Everything not promoted is deleted by the Per-Issue Sweep.

**Dead step code is removed.** The Per-Issue Sweep also finds step definitions that no feature file uses and files a chore issue to remove them.

**Existing suites are audited once.** Per repository, the owner starts an audit that lists every scenario in the Regression Suite with its execution level and any unit test that already covers it, and decides what stays through the same proposal mechanism.

## User Stories

### Scenario writing

1. As a repository owner, I want a scenario written only for behaviour observable through a Real Boundary, so that scenarios stop repeating what unit tests already prove.
2. As a repository owner, I want one scenario per acceptance criterion at a boundary, so that the number of scenarios follows the issue and not the agent's thoroughness.
3. As a repository owner, I want variants, edge cases and error tables kept out of scenarios, so that they are written once, as unit tests.
4. As a repository owner, I want an issue with no behaviour at a Real Boundary to get no scenarios, so that in-process changes produce one test artifact per behaviour.
5. As a reviewer, I want the scenario agent to state why it wrote no scenarios, so that I can judge the claim.
6. As a reviewer, I want a missing scenario to block review only when the issue changes behaviour at a Real Boundary, so that the block matches the rule.
7. As a repository owner, I want the same rule to hold in ADW's own repository for new scenarios, so that the prompts have one mode.
8. As an ADW maintainer, I want existing scenarios left as they are, so that this change does not require a migration.

### Real Boundaries

9. As a repository owner, I want my repository's Real Boundaries listed in its ADW configuration, so that what counts as a boundary is not judged afresh on every issue.
10. As a repository owner setting up a new target, I want the list written at initialisation from the application type, so that I start with a sensible list.
11. As the owner of an existing target, I want the scenario agent to create the list on its first run there, so that I need no migration issue per repository.
12. As a repository owner, I want the list changed in the pull request that adds or removes a boundary, so that the list follows the code.
13. As a reviewer, I want a change to the list called out in the pull request description, so that I do not miss it.
14. As a scenario agent working an issue that creates a new boundary, I want to be allowed to add the entry myself, so that I can write the scenario for it.
15. As a repository owner, I want every scenario tagged with the boundary it drives, so that the claim is explicit.
16. As a repository owner, I want a scenario whose boundary tag is missing or not on the list to fail the scenario test phase, so that the fix loop corrects it before review.
17. As a reviewer, I want to be told to check that a scenario's step code really drives the boundary its tag names, so that an in-process scenario cannot pass as a boundary scenario.

### Unit tests and planning

18. As a repository owner, I want the builder to stop writing a unit test for every scenario, so that boundary behaviour is not proven twice.
19. As a planner, I want to know the layer rule, so that the plan's unit-test section takes the variants and edge cases that scenarios no longer hold.
20. As a builder, I want unit tests to come from the plan, so that I know which to write.
21. As a repository owner, I want the unit-test switch of a target to keep working as it does today, so that repositories without unit tests are unaffected.

### Step definitions

22. As a repository owner, I want the builder to be the only agent that writes step definitions, so that one agent owns the step code of an issue.
23. As an ADW maintainer, I want the step-definition agent and its phase removed, so that the pipeline has one phase and one agent fewer.
24. As a repository owner, I want an undefined step to fail the scenario test phase as it does today, so that removing the phase loses no check.
25. As a scenario agent, I want to phrase Per-Issue Scenarios freely, so that I am not registering phrases for scenarios that live 14 days.
26. As a repository owner, I want the vocabulary to bind the Regression Suite only, so that it describes the scenarios that stay.
27. As a repository owner, I want the vocabulary template to describe Real Boundaries and no in-process execution patterns, so that it does not contradict the layer rule.

### Nomination

28. As a repository owner, I want the scenario agent to nominate at most one scenario per issue, so that proposals stay small.
29. As a repository owner, I want nominating nothing to be the stated default, so that "at most one" is not read as "one".
30. As a repository owner, I want a scenario nominated only when it guards a behaviour that is expensive to break and that the Regression Suite does not yet guard, so that candidates are worth my time.
31. As a repository owner, I want a Nomination recorded as a tag on the scenario, so that it travels with the merge and needs no separate store.
32. As a repository owner, I want a nominated scenario kept out of the Per-Issue Sweep while its Promotion Proposal is open, so that it is not deleted before I decide.

### Promotion Proposal

33. As a repository owner, I want one Promotion Proposal per repository per week covering all open Nominations, so that I judge candidates side by side.
34. As a repository owner, I want no proposal filed in a week without Nominations, so that I get no empty issues.
35. As a repository owner, I want the proposal to say for each candidate why it qualifies, so that I can decide without reading the code first.
36. As a repository owner, I want the proposal to say how each candidate fits the existing Regression Suite, including overlap with scenarios already there, so that I do not promote a duplicate.
37. As a repository owner, I want each candidate to have a checkbox, so that I can approve some and not others.
38. As a repository owner, I want the proposal labelled so the pipeline does not work it, so that nothing is built before I decide.
39. As a repository owner, I want only scenarios whose issue has merged to appear in a proposal, so that I am not asked about unfinished work.
40. As a repository owner, I want at most one open proposal per repository, so that new Nominations wait for my decision on the current one.

### Approval

41. As a repository owner, I want my decision to take effect when I close the proposal as completed, so that a half-read proposal with ticked boxes does nothing.
42. As a repository owner, I want the candidates ticked at the moment of closing to be the approved set, so that partial approval needs no prose.
43. As a repository owner, I want closing the proposal as not planned to decline every candidate, so that I can reject a whole proposal in one act.
44. As a repository owner, I want a proposal closed as completed with nothing ticked to count as declined, so that an empty approval builds nothing.
45. As a repository owner, I want a proposal I have not answered within 30 days to count as declined and be closed, so that nominated scenarios do not pile up.
46. As a repository owner, I want declined candidates to lose their Nomination and be removed by the Per-Issue Sweep, so that declining needs no further action.
47. As a repository owner, I want a declined scenario not to be nominated again, so that I am not asked twice.

### Promotion

48. As a repository owner, I want ADW to file one implementation issue for the approved candidates of a proposal, so that the work is done without me.
49. As a repository owner, I want the implementation issue to link back to the proposal, so that every change to the Regression Suite can be traced to my decision.
50. As a repository owner, I want Promotion to move single scenarios and never whole feature files, so that one qualifying scenario does not bring 39 others.
51. As a repository owner, I want a promoted scenario reworded to the vocabulary, with new phrases registered only when none fits, so that the suite keeps a shared language.
52. As a repository owner, I want the step definitions a promoted scenario needs to move with it, so that it still runs.
53. As a repository owner, I want the implementation pull request to merge without a second approval from me, so that I do not decide the same thing twice.
54. As a repository owner, I want the implementation issue to run the normal test and review phases, so that a broken promotion does not merge.
55. As a repository owner, I want the implementation issue to skip scenario writing, so that promoting scenarios does not create new ones.

### Removal of the old mechanism

56. As a repository owner, I want the scoring sweep to stop filing promotion issues, so that the Regression Suite stops growing on its own.
57. As an ADW maintainer, I want the scorer, the threshold ramp, the statistics loader, the cron origination and the suggestion tag removed, so that dead code does not stay behind.
58. As a repository owner, I want scenarios that still carry the old suggestion tag treated as not nominated, so that they are swept normally.
59. As an ADW maintainer, I want the promotion analysis skill to write the fit section of a proposal, so that its rubric is reused and its stale text about the old mechanism is gone.

### Unused step definitions

60. As a repository owner, I want the Per-Issue Sweep to find step definitions that no feature file uses, in my configured step-definition directory, so that deleted scenarios do not leave their step code behind.
61. As a repository owner, I want unused step definitions removed through a chore issue that lists them, so that the removal also cleans up helpers and imports and passes my static checks.
62. As a repository owner, I want at most one such chore issue open per repository, so that the sweep does not file duplicates.
63. As a repository owner, I want step definitions used only by a nominated scenario counted as used, so that they survive until I decide.
64. As the owner of a repository whose runner cannot report unused step definitions, I want the sweep to skip that part and log it, so that it never guesses.

### Audit

65. As a repository owner, I want to start an audit of a repository's Regression Suite by hand, so that I choose the order and the moment.
66. As a repository owner, I want the audit to list every regression scenario with the boundary it drives or the fact that it runs in-process, so that I can apply the layer rule to the existing suite.
67. As a repository owner, I want the audit to name any unit test that already covers a scenario, so that I can see what is duplicated.
68. As a repository owner, I want a keep-or-remove recommendation per scenario, so that I confirm or correct and do not start from nothing.
69. As a repository owner, I want to decide the audit the same way as a Promotion Proposal, so that I learn one mechanism.
70. As a repository owner, I want the audit's implementation issue to remove the scenarios I reject and their unused step definitions, so that the suite shrinks to what I kept.
71. As a repository owner, I want the audit's implementation issue to prune the vocabulary to the phrases still in use, so that the registry matches the suite.
72. As a repository owner, I want an audit I leave unanswered to change nothing, so that silence never deletes regression scenarios.

### Documentation

73. As an ADW maintainer, I want the README, the conditional docs and the stale wording in the affected skills updated, so that the documentation describes the new process.

## Implementation Decisions

### Modules

- **Boundary list.** Reads a target's declared Real Boundaries from its scenario configuration and checks the boundary tags of scenarios against them. Pure: configuration text and feature-file text in, a list of boundaries and a list of violations out. An absent list is reported as absent, not as empty.
- **Nomination collector.** Reads the Per-Issue Scenarios on the default branch and returns the nominated ones with their state: awaiting a proposal, in an open proposal, declined. Only scenarios whose issue has merged are eligible.
- **Proposal.** Builds the body of a Promotion Proposal from candidates and their analysis, and reads the ticked candidates back from an issue body. Candidates are identified by issue number and scenario name, stable under the owner's edits elsewhere in the body. The same module serves the audit, with "keep" as the ticked meaning.
- **Promotion decider.** From a proposal's state (open, closed as completed, closed as not planned), its ticked candidates and its age, decides one of: wait, approve these, decline all. It also answers, for the sweep, whether a given scenario is exempt from deletion. Pure.
- **Unused step report.** Turns a runner's usage report into a list of unused step definitions with file and line. One reader per BDD framework; a framework without a reader yields "not supported".

### Pipeline

- The scenario-writing phase is unchanged in where it runs. Its prompt gains the layer rule, the boundary list (read, created when absent, extended when the issue creates a boundary), the boundary tag, the one-per-acceptance-criterion rule, the zero-scenario outcome with a stated reason, and Nomination with its criterion and its default of none. It loses the vocabulary preference for Per-Issue Scenarios and the automatic regression tagging.
- The step-definition phase and its agent are removed from every orchestrator, the chore orchestrator included. The builder writes step definitions in its loop as it already does.
- The scenario test phase checks boundary tags before it runs the scenarios. A violation is reported like a failing scenario and goes into the existing fix loop. The check is skipped when the target has no boundary list yet.
- The build skill loses the unit test written alongside each step definition and the sentence that makes scenarios the independent proof layer for all behaviour. The scope and verification text pinned by ADR-0066 is not changed.
- The feature and bug planning prompts state the layer rule and direct variants and edge cases into the plan's unit-test section.
- The review prompt blocks on a missing scenario only when the issue changes behaviour at a declared boundary, judges a zero-scenario claim, checks that step code drives the tagged boundary, and reads boundary-list changes from the pull request description. The pull request prompt calls out such a change.
- Initialisation writes the boundary list from the application type and the reworked vocabulary template.

### Promotion

- The per-repository cron gains a weekly proposal pass and a decision pass on its normal sweep cadence, both for target repositories and ADW's own.
- Proposal pass: when eligible Nominations exist and no proposal is open, an agent writes the qualification and fit analysis using the promotion analysis skill, and ADW files the issue with the label that keeps the pipeline away and a label that identifies it as a Promotion Proposal.
- Decision pass: for each open or just-closed proposal, the promotion decider rules. On approval ADW files one implementation issue, routed as a chore and carrying the existing regression-promotion label, which names the approved scenarios and links the proposal. On decline ADW removes the Nomination tags through a sweep pull request and, for an expired proposal, closes it with a comment.
- A declined scenario carries a declined tag until the Per-Issue Sweep removes it, which stops a second Nomination.
- The implementation issue merges without the human-in-the-loop label. The chore route has no scenario-writing phase and still runs the scenario tests.
- The scorer, threshold ramp, statistics loader, promotion sweep, its cadence setting and the suggestion tag are deleted. The post-pull-request advisory comment on promotion pull requests goes with them, since the analysis now happens before the decision.

### Per-Issue Sweep

- The 14-day rule stands. Exemption changes from the suggestion tag to "nominated and not yet decided".
- The sweep reads the target's configured per-issue and step-definition directories instead of fixed paths.
- After deleting feature files, the sweep obtains the runner's usage report in dry-run mode and, when unused definitions exist and no removal issue is open, files a chore issue listing them. Supported at first: cucumber-js and cucumber-jvm. Whether the Playwright-based runner can report usage is to be established in the issue that builds this; if it cannot, web repositories are skipped and logged.

### Audit

- A command started by hand for one repository. An agent reads the Regression Suite, classifies each scenario's execution level by tracing its step code, searches the unit tests for the same assertion, and recommends keep or remove.
- ADW files the result as an issue in the proposal format, with every recommended-keep scenario ticked in advance. Closing it as completed files a chore issue that removes the unticked scenarios, removes step definitions left unused, and prunes the vocabulary to phrases still used. The 30-day expiry does not apply to audits.

### Order of delivery

- The removal of the scoring sweep comes first and stands alone, because the pipeline host runs the release branch and the sweep keeps filing issues until a release removes it.
- Prompt changes for the layer rule can ship before the boundary-tag check, since the check is skipped where no list exists.

## Testing Decisions

A good test here exercises a module through its public interface with plain inputs (configuration text, feature-file text, issue bodies and states, runner reports) and asserts on what it returns. It does not assert on prompt wording beyond pinned phrases, on call order, or on log text.

- **Unit tests** for the five modules: boundary list, nomination collector, proposal, promotion decider, unused step report. The promotion decider gets a table over state, ticked set and age, since it is where a wrong answer deletes or promotes. The proposal module gets a round trip (build, tick, read back) and bodies edited by hand.
- **Prompt-pinning tests** for the changed prompts, in the style of the existing planning-prompt test: the required phrases are present, the removed instructions are absent, and ADR-0066's pinned blocks still match.
- **Removals** need no new tests; the tests of the deleted modules go with them.
- **Scenarios** are not prescribed. Under ADR-0067 the scenario agent decides, per issue, whether behaviour is observable at ADW's subprocess boundary. The cron passes are the likely cases.
- Prior art: the unit tests of the sweep decider and the sweep removal gate for decision tables over repository state; the planning-prompt test for pinning.

## Out of Scope

- Test budgets and scaling unit-test depth by code risk (operator tooling tested as heavily as product code). This is the larger share of deckerly's excess and gets its own design session.
- Mutation testing of target repositories.
- Converting existing in-process Per-Issue Scenarios to unit tests; the Per-Issue Sweep removes them.
- Migrating ADW's existing scenarios to the layer rule before its audit.
- Detecting stale entries in a boundary list.
- Reducing duplication where a target's unit tests also drive the real runtime.
- A pipeline guard that enforces the layer rule or the scenario count mechanically; both are judged in review.
- Running the audits themselves. This PRD delivers the command; the owner runs it, deckerly first.
- Migrating `UBIQUITOUS_LANGUAGE.md` to a glossary.

## Further Notes

- Until the removal of the scoring sweep is released, the owner pauses it on the pipeline host through its cadence setting.
- The layer rule, the count rule, the Nomination default and the zero-scenario claim are prompt text. ADR-0066 took the same route and records that nothing mechanical stops an agent that ignores the text. The owner asked for deckerly's line counts to be measured again a month after release.
- The measurement this work started from was a handoff note from a deckerly session. It is not kept in the repository; the figures it held are quoted in the two ADRs.
- The step-definition agent also reported scenarios it removed; no other code depends on that output beyond its own phase, which is to be confirmed when the phase is deleted.
