# Github Issue Command Selection

Based on the `Github Issue` below, follow the `Instructions` to select the appropriate command to execute based on the `Command Mapping`.

## Instructions

- Based on the details in the `Github Issue`, select the appropriate command to execute.
- IMPORTANT: Respond exclusively with '/' followed by the command to execute based on the `Command Mapping` below.
- Use the command mapping to help you decide which command to respond with.
- Don't examine the codebase just focus on the `Github Issue` and the `Command Mapping` below to determine the appropriate command to execute.

## Command Mapping

- Respond with `/bug` if the issue is a bug.
- Respond with `/feature` if the issue is a feature.
- Respond with `/pr_review` if the issue is requesting a PR review, code review, or review-related changes.
- Respond with `/chore` ONLY when the issue **explicitly** requests `/chore`, or when the changes are strictly config-only, documentation-only, dependency bumps, or CI/CD pipeline changes with no application logic impact. Do NOT use `/chore` for issues that touch application logic, even if they seem like maintenance. If there is any doubt, prefer `/bug` or `/feature` over `/chore`.
- Respond with `0` if the issue isn't any of the above.

## Github Issue

$ARGUMENTS