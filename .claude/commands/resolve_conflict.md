---
target: false
---
# Resolve Merge Conflicts

Resolve git merge conflicts by analyzing the implementation plans from **both branches** to produce a merge strategy that preserves the intent of each change. Follow the `Instructions` to understand the conflict, formulate a strategy, and resolve every conflict. Then follow the `Report` section to report the results of your work.

## Variables

adwId: $1
specPath: $2 - path to the current branch's implementation plan (spec file)
incomingBranch: $3 - the branch being merged in (e.g., `main`, `develop`, `feature-42-adw-abc123-add-auth`)

## Instructions

- IMPORTANT: You are resolving merge conflicts, not re-implementing features. Stay surgical — only modify conflicted regions and their immediate context.
- If a `guidelines/` directory exists in the target repository, conflict resolution must strictly adhere to those coding guidelines.

### 1. Understand the Current State

- Run `git status` to identify all files with merge conflicts
- Run `git diff --name-only --diff-filter=U` to list only the conflicted files
- If there are no conflicts, report that there are no conflicts to resolve and stop

### 2. Gather Implementation Plans

**Current branch plan:**
- Read the spec file at `specPath` to understand the goals, relevant files, and implementation steps for the current branch

**Incoming branch plan:**
- Search for the incoming branch's implementation plan:
  1. Extract the issue number from `incomingBranch` if it follows the pattern `{type}-{issueNumber}-adw-{adwId}-{slug}` or `{type}-issue-{issueNumber}-...`
  2. Search `specs/` for a matching spec file using the extracted issue number (e.g., `specs/issue-{issueNumber}-*.md`)
  3. If no spec file is found locally, check the incoming branch for spec files: `git show {incomingBranch}:specs/` and read the matching file with `git show {incomingBranch}:<specPath>`
  4. If no plan is found through any method, use `git log {incomingBranch} --oneline -20` and `git diff HEAD...{incomingBranch} --stat` to infer the intent of the incoming changes
- Read the incoming branch's plan to understand its goals, relevant files, and implementation steps

### 3. Analyze Conflicts

For each conflicted file:
- Read the file to see the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
- Cross-reference both implementation plans to understand:
  - **What the current branch intended** for this file
  - **What the incoming branch intended** for this file
  - **Whether the changes are complementary** (both can coexist) or **contradictory** (only one approach can survive)

### 4. Formulate Merge Strategy

Before making any changes, determine the merge strategy for each conflicted file. For each file, decide one of:

- **Combine**: Both changes are complementary and can be merged together (e.g., both branches added different functions to the same file)
- **Prefer current**: The current branch's change takes priority because it is more aligned with the active work
- **Prefer incoming**: The incoming branch's change takes priority because it is a foundational change that the current branch should build on
- **Rewrite**: Neither version is correct as-is; a new version is needed that satisfies both plans' intent

Document your strategy before executing it.

### 5. Resolve Conflicts

- Resolve each conflict according to the strategy from Step 4
- After resolving all conflicts, ensure the code is syntactically valid and logically consistent.
- Do not introduce changes outside of the conflicted regions unless absolutely necessary for the resolved code to compile or function.
- Stage each resolved file with `git add <file>`

### 6. Validate

Read `.adw/commands.md` from the current working directory for validation commands. If `.adw/commands.md` does not exist, use these defaults:
- `bun run lint` - Run linter to check for code quality issues
- `bun run build` - Build the application to verify no build errors
- `bun run test` - Run tests to validate no regressions

Run the validation commands to confirm the resolution is correct. If validation fails, revisit the conflicted files and fix the issue.

### 7. Complete the Merge

- Run `git diff --cached --stat` to see the final resolved changes
- If all conflicts are resolved and validation passes, finalize with a commit message following this pattern:
  `merge: resolve conflicts between <currentBranch> and <incomingBranch>`

## Report

- List each conflicted file and the strategy used (combine / prefer current / prefer incoming / rewrite)
- Summarize what each plan intended and how the merge preserves both
- Report the final `git diff --cached --stat`
- Report any validation issues encountered and how they were resolved
