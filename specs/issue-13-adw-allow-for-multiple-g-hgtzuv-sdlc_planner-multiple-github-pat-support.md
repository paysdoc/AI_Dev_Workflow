# Feature: Multiple GITHUB_PAT Support

## Metadata
issueNumber: `13`
adwId: `allow-for-multiple-g-hgtzuv`
issueJson: `{"number":13,"title":"Allow for multiple GITHUB_PAT variables","body":"I'm using different repositories, sometimes not my own. Therefore, a single github PAT is insufficient. \n\nRead the GITHUB_PAT env var as comma separated value and test each PAT against the target repo until one of them matches. \n\nIf no GITHUB_PAT is available, or no PAT's match, try the repo without PAT.\n\nIf the github remains unavailable, log an error and end the workflow.\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-25T09:00:50Z","comments":[],"actionableComment":null}`

## Feature Description
Currently ADW supports a single `GITHUB_PAT` environment variable for authenticating with GitHub when operating on repositories that differ from the user's `gh auth login` account. When working with multiple repositories owned by different organizations or users, a single PAT is insufficient as each repository may require a different token with appropriate permissions.

This feature extends the `GITHUB_PAT` environment variable to support multiple comma-separated tokens. The system will test each PAT against the target repository until a working one is found. If no PATs match, it falls back to unauthenticated access (relying on `gh auth login`). If the repository remains inaccessible, the workflow terminates with an error.

## User Story
As an ADW operator working with multiple GitHub repositories across different organizations
I want to provide multiple GitHub PATs as a comma-separated list in the `GITHUB_PAT` environment variable
So that ADW can automatically select the correct PAT for each target repository

## Problem Statement
When ADW processes issues from external repositories (via `--target-repo`), it needs GitHub API access to that repository. Currently, only a single PAT is supported. Users who work with repositories across multiple organizations must manually switch the `GITHUB_PAT` value for each workflow run, which is error-prone and prevents automated processing of issues from different repositories.

## Solution Statement
1. Parse `GITHUB_PAT` as a comma-separated list of tokens in `adws/core/config.ts`
2. Create a new `adws/core/githubPatResolver.ts` module that:
   - Takes the list of PATs and a target repo (owner/repo)
   - Tests each PAT against the GitHub API to verify access to the target repo
   - Returns the first working PAT, or `null` if none work
3. Integrate the PAT resolver into the workflow initialization (`adws/phases/workflowLifecycle.ts`) so the correct PAT is selected and set as `GH_TOKEN` in the process environment before any `gh` CLI or git commands run
4. Update the health check to report on multi-PAT configuration
5. Maintain backward compatibility: a single PAT (no commas) works exactly as before

## Relevant Files
Use these files to implement the feature:

- `adws/core/config.ts` — Contains `GITHUB_PAT` constant and `getSafeSubprocessEnv()`. Must change to parse comma-separated PATs and export the list.
- `adws/core/index.ts` — Barrel exports for core module. Must export new `githubPatResolver` functions.
- `adws/core/githubPatResolver.ts` — **New file.** Contains the PAT resolution logic: parsing, validation against a repo, and selection.
- `adws/phases/workflowLifecycle.ts` — `initializeWorkflow()` is the entry point for all orchestrators. Must integrate PAT resolution early in the workflow, before any GitHub API or git operations.
- `adws/healthCheckChecks.ts` — Health check functions. Must update to report number of configured PATs and their validity status.
- `.env.sample` — Environment variable template. Must update the `GITHUB_PAT` comment to document comma-separated format.
- `adws/README.md` — ADW documentation. Must update to document multi-PAT support.
- `README.md` — Project README. Must update the `GITHUB_PAT` description.
- `adws/__tests__/githubPatResolver.test.ts` — **New file.** Unit tests for the PAT resolver module.
- `adws/__tests__/healthCheckMultiPat.test.ts` — **New file.** Unit tests for updated health check PAT reporting.

### New Files
- `adws/core/githubPatResolver.ts` — PAT resolution logic
- `adws/__tests__/githubPatResolver.test.ts` — Unit tests for PAT resolver
- `adws/__tests__/healthCheckMultiPat.test.ts` — Unit tests for updated health check

## Implementation Plan
### Phase 1: Foundation
Create the PAT parsing and resolution module (`githubPatResolver.ts`):
- Parse `GITHUB_PAT` env var as comma-separated list, trimming whitespace
- Implement a function to test a single PAT against a specific repo using `gh api` with the PAT as auth
- Implement the resolver function that iterates through PATs, tests each one, and returns the first working PAT
- Handle edge cases: empty string, single PAT, whitespace around commas, duplicate PATs

### Phase 2: Core Implementation
Integrate PAT resolution into the workflow:
- In `config.ts`, export both the raw PAT string (for backward compat) and the parsed PAT list
- In `workflowLifecycle.ts`, resolve the correct PAT during `initializeWorkflow()` before any GitHub operations
- Set the resolved PAT as `GH_TOKEN` and `GITHUB_PAT` in `process.env` so all downstream `gh` CLI calls and `getSafeSubprocessEnv()` automatically use it
- If no PAT resolves, log a warning and continue without PAT (fallback to `gh auth login`)
- If the repo is still inaccessible (test with a simple API call), log an error and exit

### Phase 3: Integration
Update supporting systems:
- Update health check to report multi-PAT configuration
- Update `.env.sample` and READMEs with new format documentation
- Ensure `getSafeSubprocessEnv()` passes the resolved PAT (not the raw comma-separated string) to subprocesses

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `adws/core/githubPatResolver.ts`
- Create a new module with the following functions:
  - `parseGitHubPats(rawPat: string | undefined): string[]` — Splits the raw `GITHUB_PAT` env var by commas, trims whitespace, filters empty strings, and returns an array of PATs
  - `testPatAccess(pat: string, owner: string, repo: string): boolean` — Tests if a PAT has access to a specific repo by running `gh api repos/{owner}/{repo} --jq .full_name` with the PAT set as `GH_TOKEN` env var. Returns `true` if the command succeeds, `false` otherwise. Uses `execSync` with `stdio: 'pipe'` to suppress output.
  - `testRepoAccessWithoutPat(owner: string, repo: string): boolean` — Tests repo access without any PAT (relying on `gh auth login`). Same API call as above but without setting `GH_TOKEN`.
  - `resolveGitHubPat(owner: string, repo: string): { pat: string | null; method: 'pat' | 'gh_auth' | 'none' }` — Main resolver function:
    1. Get PAT list from `parseGitHubPats(process.env.GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN)`
    2. If PATs are available, test each one against the repo. Return the first working PAT with `method: 'pat'`.
    3. If no PATs work (or no PATs configured), test access without PAT. If accessible, return `{ pat: null, method: 'gh_auth' }`.
    4. If repo is completely inaccessible, return `{ pat: null, method: 'none' }`.
  - Use `log()` from `../core/utils` for logging which PAT is being tested (masking the token — show only last 4 characters)

### Step 2: Create unit tests `adws/__tests__/githubPatResolver.test.ts`
- Test `parseGitHubPats`:
  - Returns empty array for `undefined`
  - Returns empty array for empty string
  - Returns single PAT for string without commas
  - Returns multiple PATs for comma-separated string
  - Trims whitespace around PATs
  - Filters out empty entries (e.g., trailing comma)
- Test `testPatAccess`:
  - Mock `execSync` to return success — should return `true`
  - Mock `execSync` to throw — should return `false`
  - Verify the command includes `GH_TOKEN` in the env
- Test `resolveGitHubPat`:
  - Single PAT that works — returns `{ pat, method: 'pat' }`
  - Multiple PATs, second one works — returns second PAT with `method: 'pat'`
  - No PATs configured, gh auth works — returns `{ pat: null, method: 'gh_auth' }`
  - No access at all — returns `{ pat: null, method: 'none' }`

### Step 3: Update `adws/core/config.ts`
- Import `parseGitHubPats` from `./githubPatResolver`
- Keep the existing `GITHUB_PAT` export for backward compatibility (it remains the raw env var value)
- Add a new export: `GITHUB_PATS: string[]` — the parsed list of PATs from `parseGitHubPats(GITHUB_PAT)`
- No changes to `getSafeSubprocessEnv()` — it already passes through the env vars; the resolved PAT will be set in `process.env` at runtime

### Step 4: Update `adws/core/index.ts`
- Export the new functions and constants from `githubPatResolver`:
  - `parseGitHubPats`
  - `resolveGitHubPat`
  - `testPatAccess`
  - `testRepoAccessWithoutPat`
  - `GITHUB_PATS`

### Step 5: Integrate PAT resolution into `adws/phases/workflowLifecycle.ts`
- Import `resolveGitHubPat` from `../core`
- In `initializeWorkflow()`, after resolving the `repoInfo` (owner/repo) but **before** the `fetchGitHubIssue()` call:
  1. Call `resolveGitHubPat(repoInfo.owner, repoInfo.repo)` (use the target repo info if available, otherwise get repo info from the local git remote)
  2. If result is `method: 'pat'`:
     - Set `process.env.GH_TOKEN = result.pat`
     - Set `process.env.GITHUB_PAT = result.pat`
     - Log: `Resolved GitHub PAT for {owner}/{repo} (token: ...{last4})`
  3. If result is `method: 'gh_auth'`:
     - Log: `No PAT matched {owner}/{repo}, using gh auth login credentials`
  4. If result is `method: 'none'`:
     - Log error: `Cannot access {owner}/{repo}: no valid PAT and gh auth login insufficient`
     - Throw an error to halt the workflow
- Note: For non-target-repo workflows (operating on the local repo), we still need to resolve repo info from the git remote. Import and use `getRepoInfo()` from `../github/githubApi` for this case.

### Step 6: Update `adws/healthCheckChecks.ts`
- Import `parseGitHubPats` from `./core`
- Update `checkEnvironmentVariables()`:
  - Instead of just checking if `GITHUB_PAT` is present, also report the number of configured PATs
  - Add `patCount` to the details object
- Update `checkGitHubCLI()`:
  - Replace `details.hasGitHubPAT = Boolean(GITHUB_PAT)` with `details.githubPatCount = GITHUB_PATS.length`
  - Update the warning condition to use `GITHUB_PATS.length === 0`

### Step 7: Create unit tests `adws/__tests__/healthCheckMultiPat.test.ts`
- Test that health check reports correct PAT count for:
  - No PATs configured
  - Single PAT
  - Multiple PATs

### Step 8: Update documentation
- Update `.env.sample`:
  - Change the `GITHUB_PAT` comment to: `# Optional - GitHub personal access token(s), comma-separated for multiple tokens`
  - Add example: `# GITHUB_PAT="ghp_token1,ghp_token2,ghp_token3"`
- Update `README.md`:
  - Update the `GITHUB_PAT` description to mention comma-separated support
- Update `adws/README.md`:
  - Update the Quick Start `GITHUB_PAT` example to show comma-separated format
  - Add a section under "Common Usage Scenarios" about multi-PAT configuration

### Step 9: Run validation commands
- Run all validation commands listed below to ensure zero regressions

## Testing Strategy
### Unit Tests
- `githubPatResolver.test.ts`: Test PAT parsing, individual PAT validation, and the resolver function with mocked `execSync`
- `healthCheckMultiPat.test.ts`: Test health check correctly reports multi-PAT configuration
- Existing tests must continue passing (no regressions)

### Edge Cases
- `GITHUB_PAT` is `undefined` — should fall back to `gh auth login`
- `GITHUB_PAT` is empty string — should fall back to `gh auth login`
- `GITHUB_PAT` has trailing comma (e.g., `"token1,"`) — should parse as single token
- `GITHUB_PAT` has whitespace around tokens (e.g., `" token1 , token2 "`) — should trim
- `GITHUB_PAT` has duplicate tokens — should try each (dedup is optional)
- Single PAT (no commas) — backward compatible, works as before
- All PATs fail but `gh auth login` works — should proceed without PAT
- All PATs fail and `gh auth login` fails — should log error and exit
- PAT has access to one repo but not another — should select the correct PAT per repo
- PAT resolution happens once during `initializeWorkflow()` — subsequent operations use the resolved PAT from the process environment

## Acceptance Criteria
- `GITHUB_PAT` can be set as a comma-separated list of tokens (e.g., `"ghp_abc,ghp_def,ghp_ghi"`)
- The system tests each PAT against the target repo and uses the first one that works
- If no PAT works, the system falls back to `gh auth login` credentials
- If the repo is completely inaccessible, the workflow logs an error and terminates
- Single PAT (no commas) continues to work exactly as before (backward compatible)
- Health check reports the number of configured PATs
- All existing tests pass without modification
- New unit tests cover PAT parsing, resolution, and edge cases
- Documentation is updated to reflect the new comma-separated format

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the feature works with zero regressions

## Notes
- No `guidelines/` directory exists in this repository, so no additional coding guidelines apply.
- The PAT resolution uses `gh api` rather than raw HTTP requests to stay consistent with the existing pattern of using `gh` CLI throughout the codebase.
- The resolved PAT is set in `process.env` early in the workflow so all downstream code (including `getSafeSubprocessEnv()` which filters env vars for Claude CLI subprocesses) automatically picks it up.
- Token masking in logs shows only the last 4 characters for security.
- The feature is designed to be transparent: if only a single PAT is configured, the behavior is identical to the current implementation.
