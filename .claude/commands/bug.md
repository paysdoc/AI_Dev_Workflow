---
target: false
---
# Bug Planning

Create a new plan to resolve the `Bug` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files.

## Variables
issueNumber: $0 — MUST be a numeric GitHub issue number (e.g., 31, 456). Default: 0
adwId: $1 — MUST be the alphanumeric ADW workflow ID string (e.g., "init-adw-env-4qugib", "abc123"). Default: `adw-unknown`
issueJson: $2 — JSON string containing full issue details. Default: `{}`

CRITICAL: $0 is ALWAYS the numeric issue number. $1 is ALWAYS the ADW ID string. Do NOT swap these values.
Example: if $0=31 and $1=init-adw-env-4qugib, the filename is `issue-31-adw-init-adw-env-4qugib-sdlc_planner-{descriptiveName}.md`

## Instructions

- IMPORTANT: You are writing a **plan**, not fixing the bug. The output is a plan document in `Plan Format` below, not code changes.
- The plan should be thorough and precise so we fix the root cause and prevent regressions.
- Create the plan in the `specs/` directory with filename: `issue-{issueNumber}-adw-{adwId}-sdlc_planner-{descriptiveName}.md`
  - Replace `{descriptiveName}` with a short, descriptive name based on the bug (e.g., "fix-login-error", "resolve-timeout", "patch-memory-leak")
- Use the plan format below to create the plan. Replace every `<placeholder>` with the requested value.
- Research the codebase to understand the bug, reproduce it, and put together a plan to fix it.
- Be surgical: solve the bug at hand with the minimal number of changes. Don't fall off track.
- Don't use decorators. Keep it simple.
- If you need a new library, read `.adw/commands.md` for the library install command (under `## Library Install Command`). If `.adw/commands.md` does not exist, use `bun install`. Be sure to report it in the `Notes` section of the `Plan Format`.
- Respect requested files in the `Relevant Files` section.
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback for older repos), planning and implementation must strictly adhere to those coding guidelines.
- Start your research by reading the `README.md` file. Also read `.adw/coding_guidelines.md` if present (or `guidelines/coding_guidelines.md` as a fallback).

## Relevant Files

Read `.adw/project.md` from the current working directory to determine the relevant files for this project. Use the `## Relevant Files` section from that file.

If `.adw/project.md` does not exist, use these defaults:
- `README.md` - Contains the project overview and instructions.
- `.adw/coding_guidelines.md` - Coding guidelines that must be followed if present (fall back to `guidelines/coding_guidelines.md` for older repos; may not exist in all repos).
- `adws/**` - Contains the AI Developer Workflow (ADW) scripts.

- Read `.adw/conditional_docs.md` from the current working directory to check if your task requires additional documentation. If `.adw/conditional_docs.md` does not exist, read `.claude/commands/conditional_docs.md` as a fallback.
- If your task matches any of the conditions listed, include those documentation files in the `Plan Format: Relevant Files` section of your plan

Ignore all other files in the codebase.

## Plan Format

```md
# Bug: <bug name>

## Metadata
issueNumber: `{issueNumber}`
adwId: `{adwId}`
issueJson: `{issueJson}`

## Bug Description
<describe the bug in detail, including symptoms and expected vs actual behavior>

## Problem Statement
<clearly define the specific problem that needs to be solved>

## Solution Statement
<describe the proposed solution approach to fix the bug>

## Steps to Reproduce
<list exact steps to reproduce the bug>

## Root Cause Analysis
<analyze and explain the root cause of the bug>

## Relevant Files
Use these files to fix the bug:

<find and list the files that are relevant to the bug describe why they are relevant in bullet points. If there are new files that need to be created to fix the bug, list them in an h3 'New Files' section.>

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. use as many h3 headers as needed to fix the bug. Order matters, start with the foundational shared changes required to fix the bug then move on to the specific changes required to fix the bug. Include tests that will validate the bug is fixed with zero regressions.>

<Your last step should be running the `Validation Commands` to validate the bug is fixed with zero regressions.>

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

<list commands you'll use to validate with 100% confidence the bug is fixed with zero regressions. every command must execute without errors so be specific about what you want to run to validate the bug is fixed with zero regressions. Include commands to reproduce the bug before and after the fix.>
Read `.adw/commands.md` from the current working directory for the project-specific validation commands. If `.adw/commands.md` does not exist, use these defaults:
- `bun run lint` - Run linter to check for code quality issues
- `bun run build` - Build the application to verify no build errors
- `bun run test` - Run tests to validate the bug is fixed with zero regressions

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of fixing the bug.
<optionally list any additional notes or context that are relevant to the bug that will be helpful to the developer>
```

## Bug
If the `issueJson` variable contains a valid JSON object with `title` and `body` fields, extract the bug details from it.
Otherwise, use the text passed as the argument to this command as the bug description directly.

## Report
- Summarize the work you've just done in a concise bullet point list.
- Include the full path to the plan file you created (e.g., `specs/issue-456-adw-xyz789-sdlc_planner-add-auth-system.md`)