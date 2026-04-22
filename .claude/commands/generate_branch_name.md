---
target: false
---
# Generate Git Branch Name Slug

Based on the `Instructions` below, take the `Variables` and follow the `Run` section to generate a concise slug for a Git branch name. Then follow the `Report` section to report the results of your work.

## Variables

issue: $0

## Instructions

- Generate a **slug only** — a short, descriptive kebab-case string that captures the essence of the issue.
- The slug must be:
  - 3–6 words, all lowercase
  - Words separated by hyphens only
  - Only characters `a-z`, `0-9`, and `-`
  - No leading or trailing hyphens
  - No consecutive hyphens (`--`)
  - ≤ 50 characters total
- **Do NOT include a prefix** like `feature-`, `bugfix-`, `bug-`, `feat-`, `test-`, `chore-`, `review-`, or `adwinit-`. The code assembles those.
- **Do NOT include `issue-<number>`** or any issue number. The code assembles those.
- The code assembles the full branch name from the slug — your only job is the descriptive slug.
- Extract the title and body from the issue JSON to derive a meaningful slug.
- Examples of valid slugs:
  - `add-user-auth`
  - `fix-login-error`
  - `update-dependencies`
  - `deterministic-branch-name-assembly`
  - `json-reporter-findings`

## Run

Generate the slug based on the instructions above.
Do NOT run any git commands. Only generate the slug string.

## Report

Return ONLY the slug string (no other text, no backticks, no prefix, no issue number).
