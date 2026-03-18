# Bug: PR auth token overridden by slash command instruction

## Metadata
issueNumber: `236`
adwId: `2umujr-prs-created-by-paysd`
issueJson: `{"number":236,"title":"PRs created by paysdoc user instead of paysdoc-adw app","body":"## Problem\n\nPull requests are authored by the `paysdoc` user instead of the `paysdoc-adw[bot]` GitHub App, despite the app token being correctly set in `GH_TOKEN` before the PR agent subprocess is spawned.\n\n## Root Cause\n\nThe `/pull_request` slash command (`.claude/commands/pull_request.md` line 38) instructs the AI model to:\n\n> Set GH_TOKEN environment variable from GITHUB_PAT if available, then run `gh pr create`...\n\nThis causes the AI to **overwrite `GH_TOKEN`** (containing the app's installation token) with `GITHUB_PAT` (the user's personal access token). The `gh pr create` call then authenticates as `paysdoc` instead of `paysdoc-adw[bot]`.\n\nBoth `GH_TOKEN` and `GITHUB_PAT` are in the `SAFE_ENV_VARS` allowlist (`adws/core/config.ts:131-134`), so the subprocess has access to both. The slash command instruction creates the conflict.\n\n## Proposed Solution\n\nRemove the `GITHUB_PAT` override instruction from `.claude/commands/pull_request.md`. The orchestrator already sets `GH_TOKEN` to the correct app token via `activateGitHubAppAuth()` in `workflowInit.ts:104`. The slash command should simply run `gh pr create` without touching auth.\n\nChange line 38 from:\n> Set GH_TOKEN environment variable from GITHUB_PAT if available, then run `gh pr create`...\n\nTo:\n> Run `gh pr create --title \"<pr_title>\" --body \"<pr_body>\" --base <defaultBranch>` to create the PR\n\n## Files to Change\n\n- `.claude/commands/pull_request.md` — remove GITHUB_PAT override instruction","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-18T13:43:41Z","comments":[],"actionableComment":null}`

## Bug Description
Pull requests created by ADW are authored by the `paysdoc` personal user instead of the `paysdoc-adw[bot]` GitHub App. This happens despite the orchestrator correctly generating and setting a GitHub App installation token in `GH_TOKEN` before spawning the PR agent subprocess.

**Expected behavior**: PRs are authored by `paysdoc-adw[bot]` (the GitHub App identity), since `activateGitHubAppAuth()` sets `GH_TOKEN` to the app's installation token in `workflowInit.ts:104`.

**Actual behavior**: PRs are authored by `paysdoc` (the personal user), because the `/pull_request` slash command instructs the AI to overwrite `GH_TOKEN` with `GITHUB_PAT` before running `gh pr create`.

## Problem Statement
The `/pull_request` slash command (`.claude/commands/pull_request.md` line 38) contains an instruction that tells the AI model to set `GH_TOKEN` from `GITHUB_PAT` before creating the PR. This overwrites the GitHub App installation token that the orchestrator already placed in `GH_TOKEN`, causing `gh pr create` to authenticate as the personal user instead of the app.

## Solution Statement
Remove the `GITHUB_PAT` override instruction from step 5 of the `/pull_request` slash command's `## Run` section. The orchestrator already handles authentication via `activateGitHubAppAuth()` in `workflowInit.ts:104`, which sets `GH_TOKEN` to a valid app installation token. The subprocess inherits this token through `getSafeSubprocessEnv()` in `config.ts`. The slash command should simply run `gh pr create` without modifying auth environment variables.

## Steps to Reproduce
1. Configure ADW with GitHub App credentials (`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_PATH`)
2. Also have `GITHUB_PAT` set in the environment (personal access token for `paysdoc` user)
3. Run any ADW orchestrator that creates a PR (e.g., `bunx tsx adws/adwPlanBuild.tsx 123`)
4. Observe the PR is created by `paysdoc` instead of `paysdoc-adw[bot]`

## Root Cause Analysis
The auth flow works correctly up until the slash command execution:

1. **Orchestrator (`workflowInit.ts:104`)**: `activateGitHubAppAuth()` generates a GitHub App installation token and sets `process.env.GH_TOKEN` to it. This is correct.
2. **Subprocess env (`config.ts:130-154`)**: `getSafeSubprocessEnv()` includes both `GH_TOKEN` (app token) and `GITHUB_PAT` (personal token) in the allowlist. The subprocess receives both. This is correct.
3. **PR agent (`prAgent.ts:70-80`)**: Spawns Claude CLI with `/pull_request` command. The subprocess inherits the correct `GH_TOKEN`. This is correct.
4. **Slash command (`pull_request.md:38`)**: Step 5 says "Set GH_TOKEN environment variable from GITHUB_PAT if available, then run `gh pr create`...". The AI model follows this instruction, overwrites `GH_TOKEN` with `GITHUB_PAT`, and `gh pr create` authenticates as the personal user. **This is the bug.**

The fix is purely in the slash command prompt text — no TypeScript code changes are needed.

## Relevant Files
Use these files to fix the bug:

- `.claude/commands/pull_request.md` — The slash command prompt that contains the faulty instruction on line 38. **This is the only file that needs to change.**
- `adws/phases/workflowInit.ts` — Reference: confirms `activateGitHubAppAuth()` sets `GH_TOKEN` correctly at line 104 (no changes needed).
- `adws/github/githubAppAuth.ts` — Reference: confirms `activateGitHubAppAuth()` sets `process.env.GH_TOKEN` to the app installation token (no changes needed).
- `adws/core/config.ts` — Reference: confirms both `GH_TOKEN` and `GITHUB_PAT` are in `SAFE_ENV_VARS` allowlist (no changes needed).
- `adws/agents/prAgent.ts` — Reference: confirms the PR agent spawns with `/pull_request` command (no changes needed).

## Step by Step Tasks

### Step 1: Fix the GITHUB_PAT override instruction in pull_request.md
- Open `.claude/commands/pull_request.md`
- Locate step 5 in the `## Run` section (line 38)
- Change from: `5. Set GH_TOKEN environment variable from GITHUB_PAT if available, then run \`gh pr create --title "<pr_title>" --body "<pr_body>" --base <defaultBranch>\` to create the PR`
- Change to: `5. Run \`gh pr create --title "<pr_title>" --body "<pr_body>" --base <defaultBranch>\` to create the PR`
- This removes the instruction to overwrite `GH_TOKEN` with `GITHUB_PAT`, preserving the app token set by the orchestrator

### Step 2: Run validation commands
- Run `bun run lint` to verify no linting issues
- Run `bunx tsc --noEmit` to verify no type errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws types
- Run `bunx cucumber-js --tags "@adw-236"` to run any tagged BDD scenarios (expected: none found, graceful exit)

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws subproject
- `grep -n "GITHUB_PAT" .claude/commands/pull_request.md` — Verify the GITHUB_PAT reference has been removed from the slash command (should return no matches)
- `grep -n "GH_TOKEN" .claude/commands/pull_request.md` — Verify no GH_TOKEN override remains in the slash command (should return no matches)

## Notes
- This is a prompt-only fix — no TypeScript code changes are required. The auth infrastructure is correct; only the slash command instruction is wrong.
- The `GITHUB_PAT` variable should remain in the `SAFE_ENV_VARS` allowlist in `config.ts` because it may still be needed as a fallback when GitHub App auth is not configured. The fix is specifically about not overriding `GH_TOKEN` in the slash command.
- After this fix, when GitHub App auth is configured, PRs will be created as `paysdoc-adw[bot]`. When it is not configured, `gh` CLI will fall back to its default auth (from `gh auth login`), which is the correct behavior.
