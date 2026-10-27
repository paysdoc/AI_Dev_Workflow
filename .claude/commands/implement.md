---
target: false
---
# Implement the following plan
Follow the `Instructions` to implement the `Plan` then `Report` the completed work.

## Instructions
- Read the plan and implement it.
- Only read the files listed in the plan's `## Relevant Files` section. Do not explore, glob, or grep the codebase beyond those files. Trust the plan.
- If the plan involves UI/browser BDD scenarios, the app's hermetic test mode (test-mode switch, stubbed externals, seeded data, deterministic clock) is part of the deliverable — see `/implement-tdd` §9 for details.

## Scope

Your task is the plan's steps, or the one failure you were handed, and nothing else. Code beyond it is allowed only when a plan step or an `@adw-{N}` scenario cannot pass without it. List every such addition under a `## Beyond the plan` heading, each with the step or scenario it unblocked; write "none" when there is nothing to list. Refactoring, hardening, extra tests, performance work and cleanup of code you did not write never qualify and are out of scope, whatever a coding guideline says about them.

Coding guidelines bind the lines you add or change. A pre-existing line that breaks a guideline stays as it is unless the plan names it.

## Verification

Run the `@adw-{N}` scenario you are working on, the plan's validation commands, the static checks of `.adw/commands.md` once at the end, and the full test suite once at the end. Unless a plan step names the command, do not start background processes, do not poll with `sleep`, do not re-run a suite that is already green, and do not run stress, fuzz, mutation or benchmark runs. The unit-test, scenario and review phases run every suite again after you.

## Plan
$ARGUMENTS

## Report
- If every step of the plan is done and the plan's validation commands pass, the first line of your final message is this line, exactly, on a line of its own, and nothing else is on that line:

  BUILD_COMPLETE

- Otherwise the first line of your final message is `## Not done`, followed by each step not done and why, and the line above appears nowhere in your message.
- Then `## Beyond the plan` (see Scope), as a list or the word "none". Append the same `## Beyond the plan` section to the end of the plan file in the worktree (the `## Plan` input names it under `## Metadata`; it is the file the reviewer reads as `specFile`), so the reviewer finds it there.
- Summarize the work you've just done in a concise bullet point list.
- Report the files and total lines changed with `git diff --stat`