---
target: false
---
# Feature Planning

Create a new plan to implement the `Feature` using the exact specified markdown `Plan Format`. Follow the `Instructions` to create the plan use the `Relevant Files` to focus on the right files.

## Variables
issueNumber: $0 — MUST be a numeric GitHub issue number (e.g., 31, 456). Default: 0
adwId: $1 — MUST be the alphanumeric ADW workflow ID string (e.g., "init-adw-env-4qugib", "abc123"). Default: `adw-unknown`
issueJson: $2 — JSON string containing full issue details. Default: `{}`

CRITICAL: $0 is ALWAYS the numeric issue number. $1 is ALWAYS the ADW ID string. Do NOT swap these values.
Example: if $0=31 and $1=init-adw-env-4qugib, the filename is `issue-31-adw-init-adw-env-4qugib-sdlc_planner-{descriptiveName}.md`

## Instructions

- IMPORTANT: You are writing a **plan**, not implementing the feature. The output is a plan document in `Plan Format` below, not code changes.
- Create the plan in the `specs/` directory with filename: `issue-{issueNumber}-adw-{adwId}-sdlc_planner-{descriptive-name}.md`
  - Replace `{descriptive-name}` with a short, descriptive name based on the feature (e.g., "add-auth-system", "implement-search", "create-dashboard")
- Use the `Plan Format` below to create the plan. Replace every `<placeholder>` with the requested value.
- Research the codebase to understand existing patterns, architecture, and conventions before planning the feature.
- Research is read-only. Read files and use `cat`, `grep`, `ls` and `git log/show/diff`. Do NOT run tests, builds, linters, type checks or the plan's `Validation Commands`, and do not dry-run them to see whether they fail today. The build agent runs them.
- Write exactly one file: the plan. Do not create or edit anything else: no reproduction tests, no scratch files, no source changes.
- Planning runs under a hard time limit. Write the plan as soon as your research answers every section of the `Plan Format`. Once it is written, stop. Do not revise it to match `features/` files that appear while you work; aligning the plan with the scenarios is a separate, later step.
- Follow existing patterns and conventions in the codebase. Don't reinvent the wheel.
- Design for extensibility and maintainability.
- If you need a new library, read `.adw/commands.md` for the library install command (under `## Library Install Command`). If `.adw/commands.md` does not exist, use `bun install`. Be sure to report it in the `Notes` section of the `Plan Format`.
- Don't use decorators. Keep it simple.
- Respect requested files in the `Relevant Files` section.
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback for older repos), planning and implementation must strictly adhere to those coding guidelines.
- Start your research by reading the `README.md` file. Also read `.adw/coding_guidelines.md` if present (or `guidelines/coding_guidelines.md` as a fallback).

## Behavioural Equivalence

If the issue ports, rewrites, migrates, re-bundles or restructures existing code, and says or implies that what the code does stays the same, the plan must include a behavioural equivalence step. Examples: a library ported to another language or to a typed package, a build moved to another bundler, a module split, merged or moved, a dependency replaced by another. The plan's other tests check only what the plan names, so whatever else such a change breaks is found only by luck.

The behavioural equivalence step is a task of its own in `## Step by Step Tasks`, before the last task. It does three things:

1. Keeps a copy of the old implementation that the tests can run, for example the old code as the base branch has it (`git show origin/<base branch>:<path>`) or the previous released version, and says where that copy lives.
2. Writes a comparison that runs the old and the new implementation on the same inputs and diffs what they produce. The comparison covers the public API, including odd inputs (`null` and `undefined` options, empty collections, boundary values), not just the happy path. When the input space is large, random or property-based inputs are fine; give them a fixed seed so that a difference can be reproduced.
3. Lists the command that runs the comparison in `## Validation Commands`, so that the plan is complete only when the old and new implementations agree.

These are not behavioural equivalence checks, because they do not compare the new code with the old:

- a byte-for-byte check of a build artefact against the build's own output;
- the existing tests still passing.

If the old implementation cannot be run, or what the code does is meant to change, there is no behavioural equivalence step, and `## Notes` must say so and why, so that the gap is a conscious decision. If only part of what the code does is meant to change, the comparison covers the rest, and `## Notes` names the intended differences.

An issue that restructures no existing code, such as one that adds new behaviour or fixes a bug in place, gets no behavioural equivalence step and needs no note about one.

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
Execute every step in order, top to bottom.

IMPORTANT: Read `.github/adw.yml` from the current working directory. Unit tests are disabled only when that file sets `unitTests` to `false` on an uncommented line; then do NOT include any tasks for creating, writing, or running unit tests. Otherwise (no file, no `unitTests` key, a commented-out key, or `unitTests: true`) unit tests are enabled: include unit test tasks.

<list step by step tasks as h3 headers plus bullet points. use as many h3 headers as needed to implement the feature. Order matters, start with the foundational shared changes required then move on to the specific implementation. Include creating tests throughout the implementation process.>

<Your last step should be running the `Validation Commands` to validate the feature works correctly with zero regressions.>

## Testing Strategy
### Unit Tests
Read `.github/adw.yml` from the current working directory. If it sets `unitTests` to `false` on an uncommented line, OMIT this entire `### Unit Tests` subsection from the plan. Do not plan any unit test tasks or unit test file creation.
Otherwise unit tests are enabled (a missing file or key means enabled): describe the unit tests needed for the feature here.

### Edge Cases
<list edge cases that need to be tested>

## Acceptance Criteria
<list specific, measurable criteria that must be met for the feature to be considered complete>

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

<list commands you'll use to validate with 100% confidence the feature is implemented correctly with zero regressions. every command must execute without errors so be specific about what you want to run to validate the feature works as expected. Include commands to test the feature end-to-end. List these commands; do not execute them while planning.>

<if the plan has a behavioural equivalence step, list the command that runs its comparison; see Behavioural Equivalence above>

Read `.adw/commands.md` from the current working directory for the project-specific validation commands. If `.adw/commands.md` does not exist, use these defaults:
- `bun run lint` - Run linter to check for code quality issues
- `bun run build` - Build the application to verify no build errors
- `bun run test` - Run tests to validate the feature works with zero regressions

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature.
<if the issue ports, rewrites, migrates, re-bundles or restructures existing code and the plan has no behavioural equivalence step, say why; see Behavioural Equivalence above>
<optionally list any additional notes, future considerations, or context that are relevant to the feature that will be helpful to the developer>
```

## Feature
If the `issueJson` variable contains a valid JSON object with `title` and `body` fields, extract the feature details from it.
Otherwise, use the text passed as the argument to this command as the feature description directly.

## Report
- Summarize the work you've just done in a concise bullet point list.
- Include the full path to the plan file you created (e.g., `specs/issue-456-adw-xyz789-sdlc_planner-add-auth-system.md`)