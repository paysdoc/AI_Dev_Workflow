# Patch Plan

Create a **focused patch plan** to resolve a specific issue based on the `reviewChangeRequest`. Follow the `Instructions` to create a concise plan that addresses the issue with minimal, targeted changes.

## Variables

adwId: $1
reviewChangeRequest: $2
specPath: $3 if provided, otherwise leave it blank
agentName: $4 if provided, otherwise use 'patchAgent'
issueScreenshots: $5 (optional) - commaSeparated list of screenshot paths if provided

## Instructions

- IMPORTANT: You're creating a patch plan to fix a specific review issue. Keep changes small, focused, and targeted
- Read the original specification (spec) file at `specPath` if provided to understand the context and requirements
- IMPORTANT Use the `reviewChangeRequest` to understand exactly what needs and use it as the basis for your patch plan
- If `issueScreenshots` are provided, examine them to better understand the visual context of the issue
- Create the patch plan in `specs/patch/` directory with filename: `patch-adw-{adwId}-{descriptive-name}.md`
  - Replace `{descriptive-name}` with a short name based on the issue (e.g., "fix-button-color", "update-validation", "correct-layout")
- IMPORTANT: This is a PATCH - keep the scope minimal. Only fix what's described in the `reviewChangeRequest` and nothing more. Address only the `reviewChangeRequest`.
- Run `git diff --stat`. If changes are available, use them to understand what's been done in the codebase and so you can understand the exact changes you should detail in the patch plan.
- Ultra think about the most efficient way to implement the solution with minimal code changes
- Base your `Plan Format: Validation` on the validation steps from `specPath` if provided
  - If any tests fail in the validation steps, you must fix them.
  - If not provided, READ `.claude/commands/test.md: ## Test Execution Sequence` and execute the tests to understand the tests that need to be run to validate the patch.
- Replace every <placeholder> in the `Plan Format` with specific implementation details
- IMPORTANT: When you finish writing the patch plan, return exclusively the path to the patch plan file created and nothing else.

## Relevant Files

Focus on the following files:
- `README.md` - Contains the project overview and instructions.
- `app/server/**` - Contains the codebase server.
- `app/client/**` - Contains the codebase client.
- `scripts/**` - Contains the scripts to start and stop the server + client.
- `adws/**` - Contains the AI Developer Workflow (ADW) scripts.

- Read `.claude/commands/conditional_docs.md` to check if your task requires additional documentation
- If your task matches any of the conditions listed, reference those documentation files to understand the context better when creating your patch plan

Ignore all other files in the codebase.


## Plan Format

```md
# Patch: <concise patch title>

## Metadata
adwId: `{adwId}`
reviewChangeRequest: `{reviewChangeRequest}`

## Issue Summary
**Original Spec:** <specPath>
**Issue:** <brief description of the review issue based on the `reviewChangeRequest`>
**Solution:** <brief description of the solution approach based on the `reviewChangeRequest`>

## Files to Modify
Use these files to implement the patch:

<list only the files that need changes - be specific and minimal>

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

<list 2-5 focused steps to implement the patch. Each step should be a concrete action.>

### Step 1: <specific action>
- <implementation detail>
- <implementation detail>

### Step 2: <specific action>
- <implementation detail>
- <implementation detail>

<continue as needed, but keep it minimal>

## Validation
Execute every command to validate the patch is complete with zero regressions.

<list 1-5 specific commands or checks to verify the patch works correctly>

## Patch Scope
**Lines of code to change:** <estimate>
**Risk level:** <low|medium|high>
**Testing required:** <brief description>
```

## Report

- IMPORTANT: Return exclusively the path to the patch plan file created and nothing else.