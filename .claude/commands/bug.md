# Bug Planning

Create a new plan to resolve the `Bug` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files.

## Variables
issueNumber: $1, default 0 if not provided
adwId: $2, default to `adw-unknown` if not provided
issueJson: $3, default to empty JSON object if not provided (`{}`)

## Instructions

- IMPORTANT: You're writing a plan to resolve a bug based on the `Bug` that will add value to the application.
- IMPORTANT: The `Bug` describes the bug that will be resolved but remember we're not resolving the bug, we're creating the plan that will be used to resolve the bug based on the `Plan Format` below.
- IMPORTANT: Planning and implementation must strictly adhere to the coding guidelines in `/guidelines`.
- You're writing a plan to resolve a bug, it should be thorough and precise so we fix the root cause and prevent regressions.
- Create the plan in the `specs/` directory with filename: `issue-{issueNumber}-adw-{adwId}-sdlc_planner-{descriptiveName}.md`
  - Replace `{descriptiveName}` with a short, descriptive name based on the bug (e.g., "fix-login-error", "resolve-timeout", "patch-memory-leak")
- Use the plan format below to create the plan. 
- Research the codebase to understand the bug, reproduce it, and put together a plan to fix it.
- IMPORTANT: Replace every <placeholder> in the `Plan Format` with the requested value. Add as much detail as needed to fix the bug.
- Consider the bug, its root cause, and the steps to fix it properly.
- IMPORTANT: Be surgical with your bug fix, solve the bug at hand and don't fall off track.
- IMPORTANT: We want the minimal number of changes that will fix and address the bug.
- Don't use decorators. Keep it simple.
- If you need a new library, use `npm install` and be sure to report it in the `Notes` section of the `Plan Format`.
- IMPORTANT: If the bug affects the UI or user interactions:
  - Add a task in the `Step by Step Tasks` section to create a separate E2E test file in `e2e-tests/test_<descriptiveName>.md` based on examples in `.claude/commands/e2e-examples/` that validates the bug is fixed with zero regressions. Be specific about the steps to validate the bug is fixed and include screenshots if possible.
  - Add E2E test validation to your Validation Commands section
  - IMPORTANT: When you fill out the `Plan Format: Relevant Files` section, add an instruction to read `.claude/commands/test_e2e.md`, and `.claude/commands/e2e-examples/test_basic_query.md` to understand how to create an E2E test file. List your new E2E test file to the `Plan Format: New Files` section.
  - To be clear, we're not creating a new E2E test file, we're creating a task to create a new E2E test file in the `Plan Format` below
- Respect requested files in the `Relevant Files` section.
- Start your research by reading the `README.md` file and the coding guidelines in `/guidelines`.

## Relevant Files

Focus on the following files:
- `README.md` - Contains the project overview and instructions.
- `guidelines/**` - Contains coding guidelines that must be followed.
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

<If the bug affects UI, include a task to create a E2E test file. Your task should look like: "Read `.claude/commands/e2e-examples/test_basic_query.md` and `.claude/commands/e2e-examples/test_complex_query.md` and create a new E2E test file in `e2e-tests/test_<descriptive_name>.md` that validates the bug is fixed, be specific with the steps to prove the bug is fixed. We want the minimal set of steps to validate the bug is fixed and screen shots to prove it if possible.">

<Your last step should be running the `Validation Commands` to validate the bug is fixed with zero regressions.>

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

<list commands you'll use to validate with 100% confidence the bug is fixed with zero regressions. every command must execute without errors so be specific about what you want to run to validate the bug is fixed with zero regressions. Include commands to reproduce the bug before and after the fix.>
<If you created an E2E test, include the following validation step: "Read .claude/commands/test_e2e.md`, then read and execute your new E2E `e2e-tests/test_<descriptive_name>.md` test file to validate this functionality works.">
- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the bug is fixed with zero regressions

## Notes
- IMPORTANT: strictly adhere to the coding guidelines in `/guidelines`. If necessary, refactor existing code to meet the coding guidelines as part of fixing the bug.
<optionally list any additional notes or context that are relevant to the bug that will be helpful to the developer>
```

## Bug
If the `issueJson` variable contains a valid JSON object with `title` and `body` fields, extract the bug details from it.
Otherwise, use the text passed as the argument to this command as the bug description directly.

## Report
- Summarize the work you've just done in a concise bullet point list.
- Include the full path to the plan file you created (e.g., `specs/issue-456-adw-xyz789-sdlc_planner-add-auth-system.md`)