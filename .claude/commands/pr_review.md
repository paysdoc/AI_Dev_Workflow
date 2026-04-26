---
target: false
---
# PR-review Planning

Create a new plan at `specs/issue-{issueNumber}-plan.md` (where `{issueNumber}` is the issue number) to resolve the `PR-Review` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files. Follow the `Report` section to properly report the results of your work.

## Instructions

- IMPORTANT: You are writing a **plan**, not resolving the review. The output is a plan document in `Plan Format` below, not code changes.
- The plan should be thorough and precise so we don't miss anything or waste time with any second round of changes.
- Analyze each review comment carefully and understand what changes are required to resolve the review.
- Create a revision plan at `specs/issue-{issueNumber}-plan.md` (where `{issueNumber}` is the issue number from the GitHub Issue) that addresses ALL review comments in the `PR-Review`.
- Use the plan format below to create the plan. Replace every `<placeholder>` with the requested value.
- Research the codebase and put together a plan to accomplish the review.
- Respect requested files in the `Relevant Files` section.
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback for older repos), planning and implementation must strictly adhere to those coding guidelines.
- Start your research by reading the `README.md` file. Also read `.adw/coding_guidelines.md` if present (or `guidelines/coding_guidelines.md` as a fallback).
- `adws/*.tsx` contain node tsx single file typescript scripts. Read `.adw/commands.md` for the script execution command (under `## Script Execution`). If `.adw/commands.md` does not exist, use `bunx tsx <script_name>`.

## Relevant Files

Read `.adw/project.md` from the current working directory to determine the relevant files for this project. Use the `## Relevant Files` section from that file.

If `.adw/project.md` does not exist, use these defaults:
- `README.md` - Contains the project overview and instructions.
- `.adw/coding_guidelines.md` - Coding guidelines that must be followed if present (fall back to `guidelines/coding_guidelines.md` for older repos; may not exist in all repos).
- `adws/**` - Contains the AI Developer Workflow (ADW) scripts.

Ignore all other files in the codebase.

## Plan Format

```md
# PR-Review: <review name>

## PR-Review Description
<describe the review in detail>

## Summary of Original Implementation Plan
<retrieve existingPlanContent from the original implementation plan base on the issue number. Search the agent state first, then search recent github commits in the current branch for new *.md files and evaluate if that was the plan. If it does not exit, write "N/A", otherwise write a summary of the original implementation plan.>

## Relevant Files
Use these files to resolve the review:

<find and list the files that are relevant to the review describe why they are relevant in bullet points. If there are new files that need to be created to accomplish the review, list them in an h3 'New Files' section.>

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. use as many h3 headers as needed to accomplish the review. Order matters, start with the foundational shared changes required to fix the review then move on to the specific changes required to fix the review. Your last step should be running the `Validation Commands` to validate the review is complete with zero regressions.>

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

<list commands you'll use to validate with 100% confidence the review is complete with zero regressions. every command must execute without errors so be specific about what you want to run to validate the review is complete with zero regressions. Don't validate with curl commands.>
Read `.adw/commands.md` from the current working directory for the project-specific validation commands. If `.adw/commands.md` does not exist, use these defaults:
- `bun run lint` - Run linter to check for code quality issues
- `bun run build` - Build the application to verify no build errors
- `bun run test` - Run tests to validate the review is complete with zero regressions

## Notes
<optionally list any additional notes or context that are relevant to the review that will be helpful to the developer>
```

## PR-Review
$ARGUMENTS

## Report
- Summarize the work you've just done in a concise bullet point list.
- Include a path to the plan you created in the `specs/*.md` file.