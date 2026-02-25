# Feature: Update coding guidelines path references in slash commands

## Metadata
issueNumber: `10`
adwId: `coding-guidelines-in-9qbluw`
issueJson: `{"number":10,"title":"Coding guidelines in target repo","body":"Some of the claude skills / commands contain a reference to guidelines/coding_guidelines.md. These are in the TARGET git repo. Update the prompts to make sure that the model understands this.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-25T07:39:55Z","comments":[],"actionableComment":null}`

## Feature Description
Several Claude slash commands (`.claude/commands/feature.md`, `.claude/commands/bug.md`, `.claude/commands/chore.md`, `.claude/commands/pr_review.md`) contain references to a `/guidelines` directory for coding guidelines. These guidelines do not exist in the ADW repository itself — they exist in the TARGET git repository that ADW operates on. The current prompts do not make this distinction clear, leading to confusion when the model tries to read guidelines that don't exist in the ADW repo, or when the model doesn't understand the guidelines are in the target repo's working directory.

This feature updates all affected slash command prompts to:
1. Clarify that `guidelines/` refers to the TARGET repository's coding guidelines directory
2. Add conditional language so the model checks if the directory exists before trying to read from it
3. Ensure the model understands these are target-repo-specific guidelines, not ADW-repo guidelines

## User Story
As an ADW operator
I want the slash commands to clearly indicate that coding guidelines are located in the target repository
So that the AI model correctly reads and applies the target repo's coding guidelines (when they exist) instead of failing to find them in the ADW repo

## Problem Statement
The slash commands (`/feature`, `/bug`, `/chore`, `/pr_review`) reference `/guidelines` as if it's always present and local to the current working directory. When ADW runs on an external target repo, Claude Code operates in that repo's directory via the `cwd` parameter. The `/guidelines` path resolves correctly in that context, but:
1. The prompts don't explain that the guidelines are part of the TARGET repo, not the ADW repo
2. There's no conditional handling for when the target repo doesn't have a `guidelines/` directory
3. Previous plan specs have noted this confusion: "The `guidelines/` directory referenced in the original plan does not exist in the repository. This is a boilerplate reference and is non-blocking."

## Solution Statement
Update all four affected slash command files to:
1. Replace absolute-looking `/guidelines` references with explicit language stating these are the **target repository's** coding guidelines
2. Add conditional instructions: "if a `guidelines/` directory exists in the repository"
3. Update the `Relevant Files` section to clarify that `guidelines/**` is a target-repo path that may or may not exist
4. Update the Plan Format `Notes` sections with the same conditional language

## Relevant Files
Use these files to implement the feature:

- `.claude/commands/feature.md` — Contains 4 references to `/guidelines` on lines 30, 31, 37, and 121. These need to be updated to clarify the guidelines are in the target repo and should be conditionally read.
- `.claude/commands/bug.md` — Contains 4 references to `/guidelines` on lines 14, 32, 38, and 101. Same updates needed.
- `.claude/commands/chore.md` — Contains 4 references to `/guidelines` on lines 14, 23, 31, and 77. Same updates needed.
- `.claude/commands/pr_review.md` — Contains 3 references to `/guidelines` on lines 14, 23, and 31. Same updates needed.

## Implementation Plan
### Phase 1: Foundation
Identify and document all exact locations in each command file that reference `/guidelines`. Determine the consistent replacement language to use across all files.

### Phase 2: Core Implementation
Update each of the four command files with consistent language that:
- Replaces "the coding guidelines in `/guidelines`" with "the target repository's coding guidelines in `guidelines/` (if the directory exists)"
- Updates the `Relevant Files` bullet for `guidelines/**` to include "(target repository — may not exist in all repos)"
- Updates Plan Format `Notes` sections with conditional language

### Phase 3: Integration
Verify all changes are consistent across the four files. Run linting and tests to ensure no regressions.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `.claude/commands/feature.md`
- **Line 30**: Change `IMPORTANT: Planning and implementation must strictly adhere to the coding guidelines in \`/guidelines\`.` to `IMPORTANT: If a \`guidelines/\` directory exists in the target repository, planning and implementation must strictly adhere to those coding guidelines.`
- **Line 31**: Change `Start your research by reading the \`README.md\` file and the coding guidelines in \`/guidelines\`.` to `Start your research by reading the \`README.md\` file. If a \`guidelines/\` directory exists in the target repository, also read those coding guidelines.`
- **Line 37**: Change `\`guidelines/**\` - Contains coding guidelines that must be followed.` to `\`guidelines/**\` - Contains coding guidelines that must be followed (target repository — may not exist in all repos). If present, read and follow these guidelines.`
- **Line 121**: Change `IMPORTANT: strictly adhere to the coding guidelines in \`/guidelines\`. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature.` to `IMPORTANT: If a \`guidelines/\` directory exists in the target repository, strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature.`

### Step 2: Update `.claude/commands/bug.md`
- **Line 14**: Change `IMPORTANT: Planning and implementation must strictly adhere to the coding guidelines in \`/guidelines\`.` to `IMPORTANT: If a \`guidelines/\` directory exists in the target repository, planning and implementation must strictly adhere to those coding guidelines.`
- **Line 32**: Change `Start your research by reading the \`README.md\` file and the coding guidelines in \`/guidelines\`.` to `Start your research by reading the \`README.md\` file. If a \`guidelines/\` directory exists in the target repository, also read those coding guidelines.`
- **Line 38**: Change `\`guidelines/**\` - Contains coding guidelines that must be followed.` to `\`guidelines/**\` - Contains coding guidelines that must be followed (target repository — may not exist in all repos). If present, read and follow these guidelines.`
- **Line 101**: Change `IMPORTANT: strictly adhere to the coding guidelines in \`/guidelines\`. If necessary, refactor existing code to meet the coding guidelines as part of fixing the bug.` to `IMPORTANT: If a \`guidelines/\` directory exists in the target repository, strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of fixing the bug.`

### Step 3: Update `.claude/commands/chore.md`
- **Line 14**: Change `IMPORTANT: Planning and implementation must strictly adhere to the coding guidelines in \`/guidelines\`.` to `IMPORTANT: If a \`guidelines/\` directory exists in the target repository, planning and implementation must strictly adhere to those coding guidelines.`
- **Line 23**: Change `Start your research by reading the \`README.md\` file and the coding guidelines in \`/guidelines\`.` to `Start your research by reading the \`README.md\` file. If a \`guidelines/\` directory exists in the target repository, also read those coding guidelines.`
- **Line 31**: Change `\`guidelines/**\` - Contains coding guidelines that must be followed.` to `\`guidelines/**\` - Contains coding guidelines that must be followed (target repository — may not exist in all repos). If present, read and follow these guidelines.`
- **Line 77**: Change `IMPORTANT: strictly adhere to the coding guidelines in \`/guidelines\`. If necessary, refactor existing code to meet the coding guidelines as part of accomplishing the chore.` to `IMPORTANT: If a \`guidelines/\` directory exists in the target repository, strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of accomplishing the chore.`

### Step 4: Update `.claude/commands/pr_review.md`
- **Line 14**: Change `IMPORTANT: Planning and implementation must strictly adhere to the coding guidelines in \`/guidelines\`.` to `IMPORTANT: If a \`guidelines/\` directory exists in the target repository, planning and implementation must strictly adhere to those coding guidelines.`
- **Line 23**: Change `Start your research by reading the \`README.md\` file and the coding guidelines in \`/guidelines\`.` to `Start your research by reading the \`README.md\` file. If a \`guidelines/\` directory exists in the target repository, also read those coding guidelines.`
- **Line 31**: Change `\`guidelines/**\` - Contains coding guidelines that must be followed.` to `\`guidelines/**\` - Contains coding guidelines that must be followed (target repository — may not exist in all repos). If present, read and follow these guidelines.`

### Step 5: Run Validation Commands
- Run `npm run lint` to check for code quality issues
- Run `npm run build` to verify no build errors
- Run `npm test` to validate no regressions

## Testing Strategy
### Unit Tests
No new unit tests are required. The changes are to markdown prompt templates (`.claude/commands/*.md`), not to executable code. Existing tests should continue to pass unchanged.

### Edge Cases
- Target repo **has** a `guidelines/` directory — the model should read and follow those guidelines
- Target repo **does not have** a `guidelines/` directory — the model should skip guideline reading gracefully without errors or confusion
- ADW running on itself (self-referential) — no `guidelines/` directory exists in the ADW repo, so the conditional language prevents confusion

## Acceptance Criteria
- All four command files (feature.md, bug.md, chore.md, pr_review.md) are updated with consistent language
- References to `/guidelines` are replaced with `guidelines/` (relative, not absolute-looking)
- All references include conditional language ("if exists in the target repository")
- The `Relevant Files` sections clarify that `guidelines/**` is a target-repo path
- Plan Format `Notes` sections use conditional language
- `npm run lint`, `npm run build`, and `npm test` all pass without errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the feature works with zero regressions

## Notes
- No `guidelines/` directory exists in the ADW repository. The guidelines are exclusively a target-repo convention.
- Previous specs (e.g., `specs/issue-2-plan.md` line 89, `specs/issue-0-adw-adw-unknown-sdlc_planner-fix-webhook-port-eaddrinuse.md` line 87) have already noted this confusion with comments like "The `guidelines/` directory referenced in the original plan does not exist in the repository. This is a boilerplate reference and is non-blocking."
- The changes are purely to markdown prompt templates and do not affect any TypeScript code or runtime behavior.
- No new libraries are needed.
