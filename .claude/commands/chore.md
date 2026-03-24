---
target: false
---
# Chore Planning

Create a new plan to resolve the `Chore` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files. Follow the `Report` section to properly report the results of your work.

## Variables
issueNumber: $1 — MUST be a numeric GitHub issue number (e.g., 31, 456). Default: 0
adwId: $2 — MUST be the alphanumeric ADW workflow ID string (e.g., "init-adw-env-4qugib", "abc123"). Default: `adw-unknown`
issueJson: $3 — JSON string containing full issue details. Default: `{}`

CRITICAL: $1 is ALWAYS the numeric issue number. $2 is ALWAYS the ADW ID string. Do NOT swap these values.
Example: if $1=31 and $2=init-adw-env-4qugib, the filename is `issue-31-adw-init-adw-env-4qugib-sdlc_planner-{descriptiveName}.md`

## Instructions

- IMPORTANT: You are writing a **plan**, not resolving the chore. The output is a plan document in `Plan Format` below, not code changes.
- The plan should be simple but thorough and precise so we don't miss anything or waste time with any second round of changes.
- Create the plan in the `specs/` directory with filename: `issue-{issueNumber}-adw-{adwId}-sdlc_planner-{descriptive-name}.md`
  - Replace `{descriptive-name}` with a short, descriptive name based on the chore (e.g., "update-readme", "fix-tests", "refactor-auth")
- Use the plan format below to create the plan. Replace every `<placeholder>` with the requested value.
- Research the codebase and put together a plan to accomplish the chore.
- Respect requested files in the `Relevant Files` section.
- If a `guidelines/` directory exists in the target repository, planning and implementation must strictly adhere to those coding guidelines.
- Start your research by reading the `README.md` file. If a `guidelines/` directory exists in the target repository, also read those coding guidelines.
- `adws/*.tsx` contain node tsx single file typescript scripts. Read `.adw/commands.md` for the script execution command (under `## Script Execution`). If `.adw/commands.md` does not exist, use `bunx tsx <script_name>`.

## Relevant Files

Read `.adw/project.md` from the current working directory to determine the relevant files for this project. Use the `## Relevant Files` section from that file.

If `.adw/project.md` does not exist, use these defaults:
- `README.md` - Contains the project overview and instructions.
- `guidelines/**` - Contains coding guidelines that must be followed (target repository — may not exist in all repos). If present, read and follow these guidelines.
- `adws/**` - Contains the AI Developer Workflow (ADW) scripts.

- Read `.adw/conditional_docs.md` from the current working directory to check if your task requires additional documentation. If `.adw/conditional_docs.md` does not exist, read `.claude/commands/conditional_docs.md` as a fallback.
- If your task matches any of the conditions listed, include those documentation files in the `Plan Format: Relevant Files` section of your plan

Ignore all other files in the codebase.

## Plan Format

```md
# Chore: <chore name>

## Metadata
issueNumber: `{issueNumber}`
adwId: `{adwId}`
issueJson: `{issueJson}`

## Chore Description
<describe the chore in detail>

## Relevant Files
Use these files to resolve the chore:

<find and list the files that are relevant to the chore describe why they are relevant in bullet points. If there are new files that need to be created to accomplish the chore, list them in an h3 'New Files' section.>

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. use as many h3 headers as needed to accomplish the chore. Order matters, start with the foundational shared changes required to fix the chore then move on to the specific changes required to fix the chore. Your last step should be running the `Validation Commands` to validate the chore is complete with zero regressions.>

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

<list commands you'll use to validate with 100% confidence the chore is complete with zero regressions. every command must execute without errors so be specific about what you want to run to validate the chore is complete with zero regressions. Don't validate with curl commands.>
Read `.adw/commands.md` from the current working directory for the project-specific validation commands. If `.adw/commands.md` does not exist, use these defaults:
- `bun run lint` - Run linter to check for code quality issues
- `bun run build` - Build the application to verify no build errors
- `bun run test` - Run tests to validate the chore is complete with zero regressions

## Notes
- If a `guidelines/` directory exists in the target repository, strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of accomplishing the chore.
<optionally list any additional notes or context that are relevant to the chore that will be helpful to the developer>
```

## Chore
If the `issueJson` variable contains a valid JSON object with `title` and `body` fields, extract the chore details from it.
Otherwise, use the text passed as the argument to this command as the chore description directly.

## Report
- Summarize the work you've just done in a concise bullet point list.
- Include the full path to the plan file you created (e.g., `specs/issue-456-adw-xyz789-sdlc_planner-update-readme.md`)