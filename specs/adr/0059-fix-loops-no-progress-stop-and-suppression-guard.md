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

Not yet implemented; carried by `specs/prd/review-proof-redesign.md`. Checked on 2026-10-02 at `origin/dev`: `adws/agents/testRetry.ts` and `adws/phases/scenarioTestFixLoop.ts` still hard-fail on cap exhaustion; nothing under `adws/` inspects a fix round's diff for suppressions.

## More Information

* The guard protecting `.adw/commands.md` is also what makes the per-repository pattern additions safe: the fix agent cannot edit the file that configures the guard.
* Related: [ADR-0056](0056-planner-commits-only-the-plan.md) keeps `.adw/` off-limits to the planner; this decision keeps `.adw/commands.md` off-limits to the fix agent.
