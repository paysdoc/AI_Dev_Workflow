# Feature Planning

Create a new plan to implement the `Feature` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files.

## Variables
issueNumber: $1 — MUST be a numeric GitHub issue number (e.g., 31, 456). Default: 0
adwId: $2 — MUST be the alphanumeric ADW workflow ID string (e.g., "init-adw-env-4qugib", "abc123"). Default: `adw-unknown`
issueJson: $3 — JSON string containing full issue details. Default: `{}`

IMPORTANT: $1 is ALWAYS the numeric issue number. $2 is ALWAYS the ADW ID string. Do NOT swap these values.
Example: if $1=31 and $2=init-adw-env-4qugib, the filename is `issue-31-adw-init-adw-env-4qugib-sdlc_planner-{descriptiveName}.md`

## Before you do anything else
Read and exectute .claude/commands/install.md

## Instructions

- IMPORTANT: You're writing a plan to implement a net new feature based on the `Feature` that will add value to the application.
- IMPORTANT: The `Feature` describes the feature that will be implemented but remember we're not implementing a new feature, we're creating the plan that will be used to implement the feature based on the `Plan Format` below.
- Create the plan in the `specs/` directory with filename: `issue-{issueNumber}-adw-{adwId}-sdlc_planner-{descriptive-name}.md`
  - Replace `{descriptive-name}` with a short, descriptive name based on the feature (e.g., "add-auth-system", "implement-search", "create-dashboard")
- Use the `Plan Format` below to create the plan. 
- Research the codebase to understand existing patterns, architecture, and conventions before planning the feature.
- IMPORTANT: Replace every <placeholder> in the `Plan Format` with the requested value. Add as much detail as needed to implement the feature successfully.
- Consider the feature requirements, design, and implementation approach.
- Follow existing patterns and conventions in the codebase. Don't reinvent the wheel.
- Design for extensibility and maintainability.
- If you need a new library, read `.adw/commands.md` for the library install command (under `## Library Install Command`). If `.adw/commands.md` does not exist, use `bun install`. Be sure to report it in the `Notes` section of the `Plan Format`.
- Don't use decorators. Keep it simple.
- IMPORTANT: If the feature includes UI components or user interactions:
  - Add a task in the `Step by Step Tasks` section to create a separate E2E test file in `e2e-tests/test_<descriptive_name>.md` based on examples in that directory
  - Add E2E test validation to your Validation Commands section
  - IMPORTANT: When you fill out the `Plan Format: Relevant Files` section, add an instruction to read `.claude/commands/test_e2e.md`, and `.claude/commands/e2e-examples/test_basic_query.md` to understand how to create an E2E test file. List your new E2E test file to the `Plan Format: New Files` section.
  - To be clear, we're not creating a new E2E test file, we're creating a task to create a new E2E test file in the `Plan Format` below
- Respect requested files in the `Relevant Files` section.
- IMPORTANT: If a `guidelines/` directory exists in the target repository, planning and implementation must strictly adhere to those coding guidelines.
- Start your research by reading the `README.md` file. If a `guidelines/` directory exists in the target repository, also read those coding guidelines.

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
# Feature: <feature name>

## Metadata
issueNumber: `{issueNumber}`
adwId: `{adwId}`
issueJson: `{issueJson}`

## Feature Description
<describe the feature in detail, including its purpose and value to users>

## User Story
As a <type of user>
I want to <action/goal>
So that <benefit/value>

## Problem Statement
<clearly define the specific problem or opportunity this feature addresses>

## Solution Statement
<describe the proposed solution approach and how it solves the problem>

## Relevant Files
Use these files to implement the feature:

<find and list the files that are relevant to the feature describe why they are relevant in bullet points. If there are new files that need to be created to implement the feature, list them in an h3 'New Files' section.>

## Implementation Plan
### Phase 1: Foundation
<describe the foundational work needed before implementing the main feature>

### Phase 2: Core Implementation
<describe the main implementation work for the feature>

### Phase 3: Integration
<describe how the feature will integrate with existing functionality>

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

IMPORTANT: Read `.adw/project.md` from the current working directory. If it contains `## Unit Tests: disabled` or the `## Unit Tests` section is absent, do NOT include any tasks for creating, writing, or running unit tests. Do not create unit test files. Only include unit test tasks when `.adw/project.md` explicitly contains `## Unit Tests: enabled`.

<list step by step tasks as h3 headers plus bullet points. use as many h3 headers as needed to implement the feature. Order matters, start with the foundational shared changes required then move on to the specific implementation. Include creating tests throughout the implementation process.>

<If the feature affects UI, include a task to create a E2E test file (like `.claude/commands/e2e-examples/test_basic_query.md` and `.claude/commands/e2e-examples/test_complex_query.md`) as one of your early tasks. That e2e test should validate the feature works as expected, be specific with the steps to demonstrate the new functionality. We want the minimal set of steps to validate the feature works as expected and screen shots to prove it if possible.>

<Your last step should be running the `Validation Commands` to validate the feature works correctly with zero regressions.>

## Testing Strategy
### Unit Tests
Read `.adw/project.md` from the current working directory. If it contains `## Unit Tests: disabled` or the `## Unit Tests` section is absent, OMIT this entire `### Unit Tests` subsection from the plan. Do not plan any unit test tasks or unit test file creation.
If `.adw/project.md` contains `## Unit Tests: enabled` (inline) or a `## Unit Tests` section with body `enabled`, describe the unit tests needed for the feature here.

### Edge Cases
<list edge cases that need to be tested>

## Acceptance Criteria
<list specific, measurable criteria that must be met for the feature to be considered complete>

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

<list commands you'll use to validate with 100% confidence the feature is implemented correctly with zero regressions. every command must execute without errors so be specific about what you want to run to validate the feature works as expected. Include commands to test the feature end-to-end.>

<If you created an E2E test, include the following validation step: `Read .claude/commands/test_e2e.md`, then read and execute your new E2E `e2e-tests/test_<descriptive_name>.md` test file to validate this functionality works.>

Read `.adw/commands.md` from the current working directory for the project-specific validation commands. If `.adw/commands.md` does not exist, use these defaults:
- `bun run lint` - Run linter to check for code quality issues
- `bun run build` - Build the application to verify no build errors
- `bun run test` - Run tests to validate the feature works with zero regressions

## Notes
- IMPORTANT: If a `guidelines/` directory exists in the target repository, strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature.
<optionally list any additional notes, future considerations, or context that are relevant to the feature that will be helpful to the developer>
```

## Feature
If the `issueJson` variable contains a valid JSON object with `title` and `body` fields, extract the feature details from it.
Otherwise, use the text passed as the argument to this command as the feature description directly.

## Report

- IMPORTANT: Return exclusively the path to the plan file created and nothing else.