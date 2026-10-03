# PRD: Review-proof redesign — deterministic gates, type-driven evidence, passive reviewer

Decisions: [ADR-0058](../adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md), [ADR-0059](../adr/0059-fix-loops-no-progress-stop-and-suppression-guard.md), [ADR-0060](../adr/0060-baseline-gate-on-the-base-branch.md), [ADR-0061](../adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md), [ADR-0062](../adr/0062-dev-server-start-failure-is-a-failed-review.md), [ADR-0063](../adr/0063-per-issue-scenario-images-are-the-visual-evidence.md). Replaces issue #942. Grill session 2026-10-01 to 2026-10-04.

## Problem Statement

ADW's review cannot be trusted, and the owner cannot tell from a green run what was actually checked.

The reviewer is supposed to be a passive judge (ADR-0031), but the prompt tells it to run type check and lint itself, with hardcoded commands, and to follow a per-repository prose file (`.adw/review_proof.md`) that in ADW's own repository tells it to run scenarios. That file has two readers that disagree about its format: the TypeScript parser wants tables that `adw_init` never writes, so the tag configuration is always the default and one parsed value is never used. The prompt's two strategies contradict each other about whether a failed per-issue scenario is a blocker, and neither applies when a repository has no scenarios.

The unit-test phase runs an agent that executes lint, type check and build, but the phase's verdict is read from the JUnit report only, so those results are thrown away. Turning unit tests off in `.github/adw.yml` turns the whole phase off, static checks included.

Web applications get no visual evidence. `## Application Type` is parsed and used nowhere; `adw_init` never writes it. Whether a scenario run produces a screenshot depends on how each repository happened to write its step definitions, and three inspected web repositories did it three different ways, none of which ADW could hook into.

A dev server that fails to start three times is ignored and the scenarios run anyway, so a server problem surfaces as a wall of scenario errors sent to the wrong fixer.

And a failure the branch inherited from `dev` is charged to the issue: nothing distinguishes a pre-existing red check from one the change caused.

## Solution

The pipeline draws one line: machines decide everything a machine can decide; the reviewer judges only what a machine cannot.

1. **Static checks become gates.** TypeScript runs type check, additional type checks, lint and build from `.adw/commands.md` in the unit-test phase; the exit code is the verdict. They always run; the `unitTests` flag turns off only the test run. A red check goes to a fix loop that has no cap but stops when a round makes no progress, and whose every round is checked by a guard that rejects suppressions and configuration edits.
2. **The base branch is checked first.** A red base parks the issue with instructions; `## Retry` re-checks, `## Continue` lets this run fix everything. A regression scenario that fails on the change is re-run alone on the base branch; if it fails there too it is pre-existing and parks the issue the same way.
3. **The application type decides the evidence.** `adw_init` detects and writes `## Application Type`; a missing type parks the issue. `cli` repositories keep their runner. `web` repositories get a self-contained Playwright project in `features/`, fully ADW-owned, that runs the same Gherkin through `playwright-bdd` and captures an end-state screenshot per scenario. ADW starts the dev server and hands the runner its address; a server that will not start is a failed review.
4. **The reviewer is passive and judges evidence.** It runs nothing. It receives the diff, the issue, the scenarios, the per-issue screenshots of a `web` repository (or the line "no scenario opened a page"), and per-type guidance inside the review prompt. `review_proof.md`, its parser and the tag tables are deleted everywhere; the tags are fixed in framework code.

## User Stories

### Static checks and the fix loop

1. As an ADW operator, I want type check, lint and build to run as deterministic gates before review, so that a green run means those checks actually passed.
2. As an ADW operator, I want the verdict of each static check to be its exit code, so that no agent decides whether a check passed.
3. As an ADW operator, I want static checks to run even when unit tests are turned off for a repository, so that opting out of tests never opts out of lint and build.
4. As an ADW operator, I want each static check's real output in the run log and the fix prompt, so that a failure is diagnosable without re-running it by hand.
5. As an ADW operator, I want a failed static check to be fixed by an agent and re-checked until it passes, so that a lint or build error does not fail a run after a fixed number of tries.
6. As an ADW operator, I want the fix loop to stop when two consecutive rounds produce identical check output, so that an agent that is not getting anywhere does not burn money indefinitely.
7. As an ADW operator, I want a stalled fix loop to park the issue as `human_gated` with a comment that says what failed and what `## Retry` does, so that I know what to do without reading logs.
8. As an ADW operator, I want `## Retry` on such a park to continue the fix loop, so that a nudge is enough when the stall was transient.
9. As an ADW maintainer, I want a fix round that adds a suppression comment to be rejected before it counts, so that a check cannot be passed by silencing it.
10. As an ADW maintainer, I want a fix round that edits lint, compiler or build configuration, `.adw/commands.md` or the ADW-owned Playwright configuration to be rejected, so that the rules of the game cannot be changed by the player.
11. As an ADW maintainer, I want a rejected fix round to count as no progress, so that repeated cheating stalls the loop instead of continuing it.
12. As an ADW maintainer, I want the suppression patterns to live in a framework table keyed by language, so that a correction is made once and reaches every repository.
13. As a target-repository owner, I want to add suppression patterns for my repository in `.adw/commands.md`, so that a linter ADW does not know is still guarded.
14. As an ADW maintainer, I want per-repository additions to be unable to remove or weaken a framework pattern, so that the framework stays leading.
15. As an ADW maintainer, I want the fix prompt to forbid suppression and the reviewer to treat one as a blocker, so that the guard is not the only line of defence.
16. As an ADW maintainer, I want the guard to apply to fix rounds only and not to the build phase, so that a legitimate configuration change planned for the issue can still be made by the builder.
17. As an ADW operator, I want the unit-test and scenario fix loops to keep their fixed caps, so that a genuinely hard test failure fails the run rather than looping.

### Baseline

18. As an ADW operator, I want the static checks run on the base branch before any work on an issue, so that a failure the branch inherited is never charged to the issue.
19. As an ADW operator, I want the dev server started on the base branch as part of the baseline where the repository declares one, so that a server that is already broken is caught before the plan phase.
20. As an ADW operator, I want a red baseline to park the issue as `human_gated` with a comment naming the failing check and the directives, so that I can decide whether to fix `dev` or let the run do it.
21. As an ADW operator, I want `## Retry` on a baseline park to re-run the baseline and park again if it is still red, so that I can use it after fixing `dev`.
22. As an ADW operator, I want `## Continue` on a baseline park to waive the baseline and have this run fix everything, pre-existing failures included, so that one run can repair `dev` when I choose.
23. As an ADW operator, I want no full regression run on the base branch per issue, so that the baseline stays cheap.
24. As an ADW operator, I want a regression scenario that fails on the change to be re-run alone on the base branch, so that a pre-existing failure is told apart from one the change caused.
25. As an ADW operator, I want a pre-existing regression failure kept away from the fix agent, so that the agent never tries to repair code the issue did not touch.
26. As an ADW operator, I want a pre-existing regression failure to park the issue as `human_gated` with a comment that says the scenario also fails on the base branch and what each directive does, so that the same rule covers every red base.
27. As an ADW maintainer, I want one builder for all park comments, so that every park says what failed and what to do in the same words.

### Application type

28. As an ADW maintainer, I want `## Application Type` in `.adw/project.md` to be the only input that decides what evidence a review needs, so that evidence rules are not scattered over per-repository files.
29. As an ADW maintainer, I want a framework-owned mapping from type to scenario runner mode and evidence kinds, so that a third type can be added without touching the phases.
30. As a target-repository owner, I want `adw_init` to detect my application type and write it, so that I do not have to know the section exists.
31. As an ADW operator, I want an issue in a repository with a missing or unknown type to park with a comment that says to re-run `adw_init`, so that no repository is reviewed under a silent default.
32. As an ADW operator, I want no default application type, so that a web repository is never reviewed as a CLI by omission.
33. As a target-repository owner of a `cli` repository, I want my scenario runner and step definitions left exactly as they are, so that this change costs me nothing.

### Web repositories

34. As a target-repository owner of a `web` repository, I want `adw_init` to install a self-contained Node scenario project in `features/` with `@playwright/test` and `playwright-bdd`, so that my scenarios run under a runner that can take screenshots.
35. As a target-repository owner of a non-Node web application, I want that scenario project to work beside my application without touching its own package management, so that a Python or Go web app can use it.
36. As an ADW maintainer, I want the Playwright configuration to be byte-identical in every web repository, with repository-specific values arriving through environment variables, so that one template is the only thing to maintain.
37. As an ADW maintainer, I want that configuration overwritten on every upgrade and protected by the fix-round guard, so that no repository drifts from the template.
38. As an ADW maintainer, I want the configuration to have no `webServer` block and to take the application address from a variable, so that ADW's dev-server lifecycle stays the only owner of the server.
39. As an ADW maintainer, I want the scenario phase to pass the dev-server address to the runner, so that scenarios reach the server ADW started.
40. As an ADW maintainer, I want the scenario writer to produce the same Gherkin in both types, so that the promotion, sweep and vocabulary code keep working unchanged.
41. As an ADW maintainer, I want the step-definition generator to produce TypeScript `playwright-bdd` steps in a `web` repository and the detected framework's steps in a `cli` repository, so that steps match the runner.
42. As a target-repository owner, I want existing e2e setups in my repository left alone and ignored, so that `adw_init` never edits tests ADW did not create.
43. As a target-repository owner of an already-initialised web repository, I want the re-run of `adw_init` to install the Playwright project without converting my old step definitions, so that I decide what to rewrite and what to delete.

### Dev server

44. As an ADW operator, I want a dev server that will not start on the issue branch to produce a review blocker with the server's output, so that the builder who broke the start gets the evidence.
45. As an ADW operator, I want each failed start to use one review attempt and the cap to end in `review_failed`, so that a start that stays broken stops the run like any other failed review.
46. As an ADW operator, I want the failed-review count reset to zero when the server starts, so that a server problem does not eat the attempts the real review needs.
47. As an ADW operator, I want the scenarios never to run against a server that did not start, so that connection errors are never reported as scenario failures.

### Evidence and the reviewer

48. As an ADW operator, I want every per-issue scenario in a `web` repository to yield an end-state screenshot, so that the scenario writer cannot opt out of evidence.
49. As an ADW maintainer, I want TypeScript to select exactly the per-issue images, by tag from the feature file and path from the JUnit attachment line, so that regression images and runner noise are never published.
50. As an ADW operator, I want the reviewer to see those images before the pull request opens, so that a visual mistake is caught in the review loop and not by me on the PR.
51. As an ADW operator, I want the same images in the issue comment of each review attempt and on the pull request, so that I can see what the reviewer saw.
52. As an ADW operator, I want the proof to state "no scenario opened a page" when a `web` issue's scenarios produced no image, so that the reviewer cannot overlook the absence.
53. As an ADW operator, I want the reviewer to block a `web` change that alters something a user can see when no scenario opened a page, so that a UI change tested only through HTTP does not pass unseen.
54. As an ADW operator, I want the reviewer to run no command that checks code, so that every check is one I can see and gate on.
55. As an ADW operator, I want review reached only when static checks, unit tests and scenarios are green, in every orchestrator, so that the reviewer never spends attention on what a machine already decided.
56. As an ADW operator, I want the reviewer to judge whether the diff does what the issue asks and no more, so that scope creep and missed requirements are caught.
57. As an ADW operator, I want the reviewer to judge whether the scenarios really test the issue and are independent of the implementation, so that a passing scenario means something.
58. As an ADW operator, I want the reviewer to judge the images against what the issue asked for, so that a scenario that ends on the wrong page is caught.
59. As an ADW operator, I want the reviewer to check the coding guidelines and the guidance for the repository's application type, so that per-type expectations are applied without a per-repository file.
60. As an ADW maintainer, I want `review_proof.md`, its parser, the `## Tags` and `## Supplementary Checks` tables and `supplementaryChecks` removed, so that a file nobody could get right is gone.
61. As an ADW maintainer, I want the scenario tags fixed in framework code as `@regression` and `@adw-{issueNumber}`, both blocking, so that one rule applies everywhere.
62. As an ADW maintainer, I want `adwPlanBuildReview` to run the scenario fix loop like the other orchestrators, so that green gates are a precondition of review there too.
63. As an ADW maintainer, I want `/test` to stop running lint, type check and build, so that no check runs twice and no agent-run check is mistaken for a gate.

## Implementation Decisions

**Check runner (deep module).** Takes the parsed `.adw/commands.md` and a working directory; runs type check, additional type checks, lint and build in that order; returns one verdict per check with exit code and captured output. It knows nothing about agents, phases or GitHub. `N/A` commands are skipped and reported as such. This is the only place a static check is executed, for the unit-test phase and the baseline alike.

**Fix-round guard (deep module, pure).** Takes a diff and the guard configuration; returns accepted or rejected with the reasons. Configuration is the framework pattern table keyed by language plus the repository's additions, and the protected-path list: lint, compiler and build configuration files, `.adw/commands.md`, the Playwright configuration in `features/`. Additions are merged so that a repository can only add patterns. The language is taken from the detected stack descriptors already in `.adw/`.

**Static-check fix loop.** Orchestrates check runner → fix agent → guard → check runner. Progress is measured as a change in the check runner's combined output between rounds; identical output or a rejected round is no progress. No cap. Exit states: green, or parked as `human_gated` with a park comment. `## Retry` resumes the loop.

**Baseline gate.** Runs before the plan phase in every orchestrator that runs gates. Checks out the base branch in a separate worktree, runs the check runner, and starts the dev server where declared; red parks the issue. Records that the baseline passed so the fix loop can distinguish inherited from introduced failures. Also exposes a single-scenario re-run on the base branch for the scenario fix loop. `## Continue` records a waiver that the fix loop honours.

**Application-type mapping (deep module, pure).** Type → `{ runnerMode, evidenceKinds, reviewGuidanceSection }`. `cli` → descriptor runner from `.adw/scenarios.md`, no images. `web` → ADW Playwright project, per-issue images. Missing or unknown type → park. Every consumer (scenario phase, step-definition generator, proof assembler, review prompt builder) reads the mapping, never the type.

**Proof assembler (deep module, pure).** Takes the JUnit report, the feature files, the artifacts directory and the type mapping; returns the proof document and the list of per-issue image paths. Tags come from the feature file (JUnit names carry none), paths from `[[ATTACHMENT|...]]`. In a `web` repository with no image it emits the "no scenario opened a page" line. Replaces the current `scenario_proof.md` writer and the tag-outcome logic that depended on configurable tags.

**Park comment builder (deep module, pure).** One function from a park reason (`baseline_red`, `pre_existing_regression`, `fix_loop_stalled`, `missing_application_type`, `base_server_down`) and its evidence to the comment text, including the exact meaning of `## Retry` and `## Continue` for that park.

**Dev-server failure handling.** In the scenario phase of a `web` repository, a start failure after the lifecycle's retries becomes a synthetic review blocker carrying the server output, routed into the review patch loop; the review attempt counter is incremented, and reset to zero on a successful start. The lifecycle module itself is unchanged except that "run the work anyway" is removed; the baseline uses the lifecycle directly and parks instead.

**`adw_init` changes.** Detects the application type and writes `## Application Type`. For `web`: writes `features/package.json` and the Playwright configuration from a template in ADW, installs `@playwright/test` and `playwright-bdd`, installs the browser, commits. The configuration template is the one spiked: `defineBddConfig` over `features/**/*.feature` and `features/steps/**/*.ts`, `outputDir` and the JUnit reporter from the ADW variables, `baseURL` from `ADW_APPLICATION_URL`, `screenshot: 'on'`, no `webServer`. Step 6 (`review_proof.md`) is removed. The Playwright branch in step 8 is replaced by the type mapping's runner commands. Upgrade overwrites the configuration file.

**Scenario phase.** Passes `ADW_APPLICATION_URL` in addition to the existing variables; in `web` mode runs `bddgen` then `playwright test --grep` from `features/`; in `cli` mode runs the descriptor commands as today. Hands the proof assembler's output to the review phase.

**Prompts.** `review.md` loses Strategy A and B and every command execution; gains the evidence section (image paths it must open), the per-type guidance sections, and the rule that a suppression is a blocker. The step-definition independence check from #937 stays. `test.md` loses lint, type check and build. `scenario_writer.md` is unchanged in output format; `generate_step_definitions.md` gains the `web` mode (`createBdd()` steps, `page` fixture). The fix prompt gains the no-suppression rule.

**Removals and wiring.** `parseReviewProofMd`, `supplementaryChecks`, the `## Tags` configuration and `.adw/review_proof.md` in ADW's own repository are deleted; the file leaves the required `.adw/` file list that `adw_init` must produce; `adw_init` stops writing it. The review phase's image upload uses the proof assembler's selected list instead of the whole directory. `adwPlanBuildReview` adopts `runScenarioTestFixLoop`. The promotion path gets an explicit rule for issues with no `@adw-{N}` scenarios, since the tag is now blocking.

**Rollout.** Each module ships as its own pull request behind the existing structure; nothing changes behaviour for a repository until `adw_init` is re-run there. Issues reference the ADR they implement.

## Testing Decisions

A good test here feeds a module its inputs and asserts the decision or document it returns. It does not assert which internal function was called, and it does not read the module's intermediate state. Agent calls, git operations and process spawns are replaced by injected fakes, following `adwChore`'s injected-phases pattern.

Modules with unit tests:

- **Check runner**: each command's exit code becomes the right verdict; `N/A` is skipped; output is captured; order is fixed. Fake process runner.
- **Fix-round guard**: every framework pattern per language is caught; a repository addition is honoured; a repository "removal" has no effect; each protected path is rejected; a clean diff passes. Prior art: `gherkinFreeze` tests.
- **Application-type mapping**: both types map correctly; unknown and missing park; adding a type needs no change to consumers (assert consumers read the mapping, via a fake third type).
- **Proof assembler**: tags from feature files, paths from attachment lines, regression images excluded, "no scenario opened a page" line, Scenario Outline rows. Prior art: `scenarioProof` and `proofArtifactHarvester` tests.
- **Park comment builder**: every reason produces the failure, the base-branch note where applicable, and both directive meanings.
- **Static-check fix loop**: stops on identical output; a rejected round counts as no progress; a changed output continues; resumes on `## Retry`. Fake check runner and fake fix agent returning scripted diffs.
- **Baseline gate**: red parks; green records; `## Continue` waiver is honoured by the loop; single-scenario re-run classifies pre-existing. Fake check runner, fake scenario runner, fake worktree.
- **Dev-server failure handling**: a failed start becomes a blocker with the output; the counter increments; a successful start resets it; cap reaches `review_failed`. Fake lifecycle.

Not unit-tested: `adw_init` and the prompts. They are covered by the existing regression suite's source-text scenarios, which is as far as prompt testing goes today.

## Out of Scope

- Baseline visual comparison (before/after images).
- A per-repository review-guidance file; the owner will add one when needed.
- Converting existing cucumber-js step definitions in web repositories.
- Making the regression suite a required check on the merge path (#941).
- Changes to R2 storage, the router Worker or image expiry (ADR-0022).
- A third application type.

## Further Notes

- The spike of 2026-10-02 (`@playwright/test` 1.63.0, `playwright-bdd` 9.2.1) verified: tag selection by `--grep`; JUnit on ADW's path parsed by `readJUnitReport`; one end-state image per scenario that uses `page`; none for a scenario that does not; `[[ATTACHMENT|...]]` per test case; harvest by `harvestProofArtifacts`; a run against an externally started server with only `baseURL`; both scenarios error when the server is down; a Node scenario project beside a Python application. Not tested: a real framework application, parallel workers, Scenario Outlines, long scenario names.
- "No progress" as identical output is a coarse signal; a loop that alternates between two outputs does not stop on its own. Accepted for now; the operator can `## Cancel`.
- The regression re-run on the base branch needs a base-branch worktree, which the baseline gate provides; the two share it.
- Related open issue: #941 (regression suite as required check). #942 is closed by this PRD.
