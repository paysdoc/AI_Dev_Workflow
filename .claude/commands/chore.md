# Chore Planning

Create a new plan to resolve the `Chore` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files. Follow the `Report` section to properly report the results of your work.

## Variables
issueNumber: $1, default 0 if not provided
adwId: $2, default to `adw-unknown` if not provided
issueJson: $3, default to empty JSON object if not provided (`{}`)

## Instructions

- IMPORTANT: You're writing a plan to resolve a chore based on the `Chore` that will add value to the application.
- IMPORTANT: The `Chore` describes the chore that will be resolved but remember we're not resolving the chore, we're creating the plan that will be used to resolve the chore based on the `Plan Format` below.
- IMPORTANT: If a `guidelines/` directory exists in the target repository, planning and implementation must strictly adhere to those coding guidelines.
- You're writing a plan to resolve a chore, it should be simple but we need to be thorough and precise so we don't miss anything or waste time with any second round of changes.
- Create the plan in the `specs/` directory with filename: `issue-{issueNumber}-adw-{adwId}-sdlc_planner-{descriptive-name}.md`
  - Replace `{descriptive-name}` with a short, descriptive name based on the chore (e.g., "update-readme", "fix-tests", "refactor-auth")
- Use the plan format below to create the plan. 
- Research the codebase and put together a plan to accomplish the chore.
- IMPORTANT: Replace every <placeholder> in the `Plan Format` with the requested value. Add as much detail as needed to accomplish the chore.
- Consider the plan and the steps to accomplish the chore.
- Respect requested files in the `Relevant Files` section.
- Start your research by reading the `README.md` file. If a `guidelines/` directory exists in the target repository, also read those coding guidelines.
- `adws/*.tsx` contain node tsx single file typescript scripts. So if you want to run them use `npx tsx <script_name>`.
- When you finish creating the plan for the chore, follow the `Report` section to properly report the results of your work.

## Relevant Files

Focus on the following files:
- `README.md` - Contains the project overview and instructions.
- `guidelines/**` - Contains coding guidelines that must be followed (target repository — may not exist in all repos). If present, read and follow these guidelines.
- `src/app/**` - Contains Next.js App Router pages, layouts, and route handlers.
- `src/components/**` - Contains React components.
- `src/lib/**` - Contains utility functions and shared logic.
- `src/hooks/**` - Contains custom React hooks.
- `src/styles/**` - Contains global styles and CSS modules.
- `public/**` - Contains static assets.
- `adws/**` - Contains the AI Developer Workflow (ADW) scripts.

- Read `.claude/commands/conditional_docs.md` to check if your task requires additional documentation
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
- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the chore is complete with zero regressions

## Notes
- IMPORTANT: If a `guidelines/` directory exists in the target repository, strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of accomplishing the chore.
<optionally list any additional notes or context that are relevant to the chore that will be helpful to the developer>
```

## Chore
If the `issueJson` variable contains a valid JSON object with `title` and `body` fields, extract the chore details from it.
Otherwise, use the text passed as the argument to this command as the chore description directly.

## Report

- IMPORTANT: Return exclusively the path to the plan file created and nothing else.