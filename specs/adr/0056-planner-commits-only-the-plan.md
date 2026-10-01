---
status: accepted
date: 2026-10-01
recorded: 2026-10-01
provenance:
  - kind: transcript
    source: "Claude Code session 2dc3e364, 2026-10-01"
  - kind: contemporaneous
    source: commits d45d708e and ca72a4a7 (2026-06-16), bebda8dd and c3606f9e (2026-09-24)
supersedes: []
superseded-by: []
---

# The planner commits only the plan; `.claude/` and `.adw/` are off-limits to it

## Context and Problem Statement

The plan phase ends by committing the planner's work in the issue's worktree. Twice, that commit undid a prompt change another agent had made minutes earlier:

* On 2026-06-16 at 21:58 the build commit for #579 (d45d708e) rewrote `.claude/commands/generate_step_definitions.md` and `.claude/commands/scenario_writer.md`. At 22:52 the plan commit for #583 (ca72a4a7) changed both files again, and `.claude/commands/adw_init.md` and `README.md` with them. See the Divergence section of [ADR-0043](0043-multi-language-test-seam.md).
* On 2026-09-24 at 10:38 the build commit for the comment guard (bebda8dd) added a rule to `scenario_writer.md`. At 10:57 a plan commit (c3606f9e) removed that line. See the Divergence section of [ADR-0054](0054-comment-discipline.md).

Neither loss was noticed when it happened. Both were found on 2026-09-29 while the ADRs were being written.

The decision covers the commit made by the plan phase in every orchestrator.

## Considered Options

None recorded.

## Decision Outcome

The owner, in the session of 2026-10-01: "The planner should ONLY commit the plan. .claude/* and .adw/* are off-limits and a guardrail should check that."

So the plan commit carries the plan file and nothing under `.claude/` or `.adw/`, and a guard rejects a planner commit that touches either folder. The form of the guard was not decided.

### Consequences

* Good, because a prompt or configuration change can no longer be lost to a commit whose job was something else.
* Good, because a reviewer can read a plan commit as the plan and nothing more.
* Bad, because a plan that genuinely needs a prompt or configuration change cannot make it in the plan phase. The change has to be a task in the plan, made by the build agent.

### Confirmation

Checked on 2026-10-01:

* `adws/phases/planPhase.ts` commits through `runCommitAgent`, which runs the `/commit` command.
* Step 2 of `.claude/commands/commit.md` is "Run `git add -A` to stage all changes". The plan commit therefore stages every file that differs in the worktree.
* `git show --stat ca72a4a7` and `git show --stat c3606f9e` list the prompt files named above.

No guard exists.

## Divergence

1. **The plan commit stages everything.** As shown under Confirmation, the planner commits through `git add -A` and nothing restricts the paths. Ruling (owner, 2026-10-01): the decision above; the current behaviour is a bug. Why the worktree's copies of the prompt files differed from the branch in the two cases was not determined.

## More Information

* Not settled: the plan commit ca72a4a7 also carried `features/per-issue/feature-583.feature`. Whether the per-issue scenario file belongs in the plan commit was not asked.
* A regeneration chore, not a plan commit, caused a third loss of the same kind (commit 1ab26649, see ADR-0043). This decision does not cover it.
