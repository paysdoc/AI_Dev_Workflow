# Generate Git Branch Name

Based on the `Instructions` below, take the `Variables` follow the `Run` section to generate a concise Git branch name following the specified format. Then follow the `Report` section to report the results of your work.

## Variables

issueClass: $1
issue: $2

## Instructions

- Generate a branch name in the format: `<issueClass>-issue-<issueNumber>-<concise_name>`
- The `<concise_name>` should be:
  - 3-6 words maximum
  - All lowercase
  - Words separated by hyphens
  - Descriptive of the main task/feature
  - No special characters except hyphens
- Examples:
  - `feat-issue-123-add-user-auth`
  - `bug-issue-456-fix-login-error`
  - `chore-issue-789-update-dependencies`
  - `test-issue-323-fix-failing-tests`
- Extract the issue number, title, and body from the issue JSON

## Run

Generate the branch name based on the instructions above.
Do NOT run any git commands. Only generate the branch name string.

## Report

Return ONLY the branch name (no other text)
