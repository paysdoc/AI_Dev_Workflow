# Create Pull Request

Based on the `Instructions` below, take the `Variables` follow the `Run` section to create a pull request. Then follow the `Report` section to report the results of your work.

## Variables

branchName: $1, default to current branch if not provided
issue: $2
plan_file: $3
adwId: $4
defaultBranch: $5, defaults to the output of `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` if not provided
repoOwner: $6, the owner of the repository where the issue lives (may be empty for same-repo PRs)
repoName: $7, the name of the repository where the issue lives (may be empty for same-repo PRs)

## Instructions

- Use the `defaultBranch` variable as the base branch for the PR
- Generate a pull request title in the format: `<issue_type>: #<issueNumber> - <issue_title>`
- The PR body should include:
  - A summary section with the issue context
  - Link to the implementation `plan_file` if it exists
  - Reference to the issue: if `repoOwner` and `repoName` are provided and non-empty, use `Closes repoOwner/repoName#<issueNumber>`; otherwise use `Closes #<issueNumber>`
  - ADW tracking ID
  - A checklist of what was done
  - A summary of key changes made
- Extract issue number, type, and title from the issue JSON
- Examples of PR titles:
  - `feat: #123 - Add user authentication`
  - `bug: #456 - Fix login validation error`
  - `chore: #789 - Update dependencies`
  - `test: #1011 - Test xyz`
- Don't mention Claude Code in the PR body - let the author get credit for this.

## Run

1. Run `git diff origin/<defaultBranch>...HEAD --stat` to see a summary of changed files
2. Run `git log origin/<defaultBranch>..HEAD --oneline` to see the commits that will be included
3. Run `git diff origin/<defaultBranch>...HEAD --name-only` to get a list of changed files
4. Run `git push -u origin <branchName>` to push the branch
5. Run `gh pr create --title "<pr_title>" --body "<pr_body>" --base <defaultBranch>` to create the PR
6. Capture the PR URL from the output

## Report

Return ONLY the PR URL that was created (no other text)