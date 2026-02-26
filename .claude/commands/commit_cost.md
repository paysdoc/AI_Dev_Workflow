# Commit Cost CSV Files

Based on the `Instructions` below, take the `Variables` follow the `Run` section to commit only cost-related CSV files with a properly formatted message. Then follow the `Report` section to report the results of your work.

## Variables

agentName: $1
issueClass: $2
issue: $3
repoName: $4

## Instructions

- Generate a concise commit message in the format: `<agentName>: <issueClass>: <commit message>`
- The `<commit message>` should be:
  - Present tense (e.g., "add", "fix", "update", not "added", "fixed", "updated")
  - 50 characters or less
  - Descriptive of the actual changes made
  - No period at the end
- Examples:
  - `sdlc_planner: feat: add cost data for issue #42`
  - `sdlc_implementor: feat: update cost CSV for issue #10`
- Extract context from the issue JSON to make the commit message relevant
- Don't include any 'Generated with...' or 'Authored by...' in the commit message. Focus purely on the changes made.

## Run

1. Run `git diff HEAD` to understand what changes have been made
2. Stage only cost-related CSV files:
   - `git add projects/<repoName>/<issueNumber>-*.csv` (issue cost CSV)
   - `git add projects/<repoName>/total-cost.csv` (project total CSV)
3. Run `git commit -m "<generated_commit_message>"` to create the commit

## Report

Return ONLY the commit message that was used (no other text)
