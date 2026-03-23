---
target: false
---
# Commit Cost CSV Files

Based on the `Instructions` below, take the `Variables` follow the `Run` section to commit only cost-related CSV files with a properly formatted message. Then follow the `Report` section to report the results of your work.

## Variables

agentName: $1 (optional)
issueClass: $2 (optional)
issue: $3 (optional)
project: $4 (optional)

## Instructions

- Generate a concise commit message with a flexible prefix based on which variables are provided:
  - If both agentName and issueClass provided: `<agentName>: <issueClass>: <commit message>`
  - If only agentName provided: `<agentName>: <commit message>`
  - If only issueClass provided: `<issueClass>: <commit message>`
  - If neither provided: `<commit message>`
- The `<commit message>` should be:
  - Present tense (e.g., "add", "fix", "update", not "added", "fixed", "updated")
  - 50 characters or less
  - Descriptive of the actual changes made
  - No period at the end
- Examples:
  - `sdlc_planner: feat: add cost data for issue #42`
  - `sdlc_implementor: feat: update cost CSV for issue #10`
  - `feat: add cost data for my-repo`
  - `add cost data for all projects`
- Extract context from the issue JSON to make the commit message relevant
- Don't include any 'Generated with...' or 'Authored by...' in the commit message. Focus purely on the changes made.

## Run

1. Run `git diff HEAD` to understand what changes have been made
2. Stage cost-related CSV files based on which parameters are provided:
   - If `project` is not provided but `issue` is: log an error explaining project is required when issue is specified, and stop.
   - If both `project` and `issue` are provided: stage `projects/<project>/<issueNumber>-*.csv` and `projects/<project>/total-cost.csv` (single issue mode).
   - If `project` is provided but `issue` is not: stage all CSV files in `projects/<project>/` via `git add projects/<project>/*.csv` (project mode).
   - If neither `project` nor `issue` is provided: stage everything in `projects/` via `git add projects/` (all projects mode).
3. Run `git commit -m "<generated_commit_message>"` to create the commit

## Report

Return ONLY the commit message that was used (no other text)
