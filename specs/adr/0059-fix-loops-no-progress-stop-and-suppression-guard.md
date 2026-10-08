---
status: accepted
date: 2026-10-02
recorded: 2026-10-04
provenance:
  - kind: transcript
    source: "Claude Code session 2dc3e364, 2026-10-01 to 2026-10-04"
supersedes: []
superseded-by: []
---

# Static-check fixes are retried until they stop making progress and may not suppress; test fix loops keep their caps

## Context and Problem Statement

[ADR-0058](0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md) makes type check, lint and build deterministic gates in the unit-test phase. A red gate needs a fix loop, and a fix loop has two failure modes: it gives up too early, or the fixing agent makes the check pass by silencing it (`// eslint-disable`, `@ts-ignore`, a looser rule in the lint config).

Today the unit-test and scenario fix loops each have a fixed retry cap and fail the run with no pull request when it is exhausted (checked 2026-10-01 at `c351b62b`: `adws/phases/unitTestPhase.ts`, `adws/agents/testRetry.ts`, `adws/phases/scenarioTestFixLoop.ts`).

The decision covers every fix round that follows a failed static check, unit test or scenario run.

## Decision Drivers

* The owner (2026-10-01): "Keep on retrying until the checks pass. Build and lint issues are not hard problems should be fixable."
* A test failure can be a hard problem; a cap is the right brake there.
* A suppression is a cheat the pipeline must catch mechanically, not leave to the reviewer alone.
* Framework rules lead; a repository may add to them, never weaken them.

## Considered Options

For the static-check loop's end: a fixed cap; no cap with a no-progress stop; no cap at all.

For the suppression guard: prompt rule only; a deterministic guard on each fix round; both.

For where the suppression patterns come from: a framework table by language; a per-repository list in `.adw/commands.md`; the table plus per-repository additions; no comment guard.

For the test fix loops: unchanged; the same no-progress rule as static checks; a cap whose exhaustion parks the issue.

## Decision Outcome

* **The static-check fix loop has no fixed cap.** It stops when a round makes no progress, defined as check output identical to the previous round's. It then parks the issue as `human_gated`, with a comment that says what failed and that `## Retry` continues the loop. The owner's reason is quoted above.
* **Anti-suppression is both a guard and a rule.** A deterministic guard rejects a fix round whose diff adds a suppression comment or edits lint, compiler or build configuration, `.adw/commands.md`, or the ADW-owned Playwright configuration of [ADR-0061](0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md). A rejected round counts as no progress. The fix prompt forbids suppression and the reviewer treats one it finds as a blocker. The guard applies to fix rounds only, not to the build phase.
* **Suppression patterns: framework table plus repository additions.** ADW holds a table keyed by language; a repository may add patterns in `.adw/commands.md`. The owner: "the framework is leading. In other words contradicting per-repo instructions are ignored, supplementary instructions are honoured." A repository can add a pattern, never remove or weaken a framework one. A language with no table entry gets the configuration-file guard and the reviewer only.
* **The unit-test and scenario fix loops are unchanged**: fixed cap, then the run fails with no pull request. The no-cap rule does not carry over because a failing test can be a hard problem, and because test output carries timings and ordering that make "identical output" useless as a progress signal.

### Consequences

* Good, because a lint or build failure is fixed rather than abandoned after N tries.
* Good, because the cheapest cheat, one disabling comment, is caught before any agent judges anything.
* Bad, because "identical output" is a coarse signal: a loop that oscillates between two outputs never stops on its own. The cost is bounded by the owner's willingness to watch the run; no cap means no automatic bound.
* Bad, because the guard's table cannot be complete; an unknown linter's suppression syntax passes the guard.

### Confirmation

Implemented. Checked on 2026-10-04 in the working tree on top of `19de14fc`, and the reviewer's rule on 2026-10-07 on top of `5dd20ad2`:

* `adws/core/fixRoundGuard.ts` (`evaluateFixRound`, `buildFixRoundGuardConfig`), with the tables in `adws/core/fixRoundGuardTable.ts`, rejects a fix round whose diff adds a framework suppression pattern of the repository's language (`javascript`, which covers TypeScript, `python`, `go`, `rust` or `ruby`; the language comes from `inferStackLanguages` over the stack descriptors in `.adw/`) or a pattern listed under `## Suppression Patterns` in `.adw/commands.md`. It also rejects a round that creates, edits or deletes lint, compiler or build configuration, `.adw/commands.md` or `features/playwright.config.*`. A repository entry can only add a pattern: an entry that starts with `!` is ignored and logged. Unit tests: `adws/core/__tests__/fixRoundGuard.test.ts` (every framework pattern of every language, additions, removal attempts, every protected path, a clean diff) and `adws/core/__tests__/unifiedDiff.test.ts`.
* `adws/core/staticCheckFixLoop.ts` (`runStaticCheckFixLoop`) has no cap. A round makes no progress when `combinedCheckOutput` is identical to the previous run's, or when the guard rejects it. `adws/phases/staticCheckFixRound.ts` reverts a rejected round by resetting the worktree to the round's base on the remote, and fails closed if it cannot. Unit tests: `adws/core/__tests__/staticCheckFixLoop.test.ts` (fake check runner and fake fix agent returning scripted diffs: identical output stops the loop, a rejected round is no progress, changed output continues, a loop that starts again after `## Retry` begins a round on the unchanged output) and `adws/phases/__tests__/staticCheckFixRound.test.ts`.
* `adws/phases/staticCheckGate.ts` runs the loop in `executeUnitTestPhase`. A stalled loop parks the workflow as `human_gated` through `adws/phases/workflowPark.ts`, with the `fix_loop_stalled` comment of `adws/forge/parkComment.ts`, which names each failing check, quotes its output, and says what `## Retry` and `## Continue` do. `## Retry` re-arms the workflow to `phase_timeout` (`decideRetryAction`), and the resumed orchestrator re-runs the unit-test phase and with it the loop. Unit tests: `adws/phases/__tests__/unitTestPhase.test.ts`, `adws/phases/__tests__/workflowPark.test.ts` and `adws/forge/__tests__/parkComment.test.ts`. Scenarios: `features/per-issue/feature-989.feature`.
* `.claude/commands/resolve_failed_test.md`, the fix prompt, forbids suppression: `grep -n "Never silence a failure" .claude/commands/resolve_failed_test.md` finds the rule.
* The unit-test and scenario fix loops keep their caps: `git diff --quiet origin/HEAD -- adws/agents/testRetry.ts adws/phases/scenarioTestFixLoop.ts adws/phases/scenarioFixPhase.ts` exits 0.
* The reviewer treats a suppression it finds as a blocker. The rule is in place: `grep -n -i "suppress" .claude/commands/review.md` finds it in step 3, and `adws/__tests__/reviewPrompt.test.ts` asserts that the step calls a suppression comment the diff adds a `blocker` and names a framework pattern of every language of `FRAMEWORK_SUPPRESSION_PATTERNS`. The rule covers the whole diff, the build phase included, where the guard covers fix rounds only, so that a configuration change planned for the issue can still be made: the reviewer blocks a change to lint, compiler or build configuration only when it weakens a check. See the Confirmation of [ADR-0058](0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md).

## More Information

* The guard protecting `.adw/commands.md` is also what makes the per-repository pattern additions safe: the fix agent cannot edit the file that configures the guard.
* Related: [ADR-0056](0056-planner-commits-only-the-plan.md) keeps `.adw/` off-limits to the planner; this decision keeps `.adw/commands.md` off-limits to the fix agent.
