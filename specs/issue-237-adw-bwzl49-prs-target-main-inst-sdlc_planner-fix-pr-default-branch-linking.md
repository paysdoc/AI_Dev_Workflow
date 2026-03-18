# Bug: PRs target main instead of default branch and issue linking fails on foreign repos

## Metadata
issueNumber: `237`
adwId: `bwzl49-prs-target-main-inst`
issueJson: `{"number":237,"title":"PRs target main instead of default branch and issue linking fails on foreign repos","body":"## Problem\n\nTwo related issues when creating PRs for foreign target repos:\n\n1. **Wrong base branch**: PRs sometimes target `main` instead of the repo's actual default branch (e.g., `master`, `develop`)\n2. **Issue linking fails**: GitHub does not auto-link PRs to issues on cross-repo PRs because the reference uses bare `#N` instead of `owner/repo#N`\n\nThese correlate because both stem from missing target repo context in the PR creation path. Observed on the vestmatic project board (issue #24).\n\n## Root Cause\n\n### Wrong base branch\nThe `/pull_request` slash command (`pull_request.md:11`) defaults to `main` if `$5` is not provided:\n> `defaultBranch: $5, defaults to 'main' if not provided`\n\nWhile `prAgent.ts:59` does call `getDefaultBranch(cwd)` and passes it as `$5`, if this fails or returns an empty string, the AI falls back to `main`.\n\n### Issue linking\n`pullRequestCreator.ts:23` generates `Implements #${issue.number}` — a bare `#N` reference. The `/pull_request` slash command says `Closes #<issueNumber>`. For cross-repo PRs (PR on repo A referencing issue on repo B), GitHub requires the fully-qualified form: `Closes owner/repo#N`.\n\nThe PR agent receives `issueJson` (which has the issue number) but **no information about which repo the issue belongs to**. `prPhase.ts` has access to `config.repoContext.repoId` (`{owner, repo}`) but doesn't pass it to `runPullRequestAgent()`.\n\n## Proposed Solution\n\n1. **Pass repo context to PR agent**: Add `repoOwner` and `repoName` parameters to `runPullRequestAgent()` and `formatPullRequestArgs()`, sourced from `config.repoContext.repoId` in `prPhase.ts`\n2. **Update slash command**: Add `$6` (repoOwner) and `$7` (repoName) variables to `pull_request.md`, use them to generate `Closes owner/repo#N` references\n3. **Harden default branch**: If `$5` is empty, run `gh repo view --json defaultBranchRef` as a reliable fallback instead of hardcoding `main`\n\n## Files to Change\n\n- `adws/agents/prAgent.ts` — add repo context to `formatPullRequestArgs()` and `runPullRequestAgent()`\n- `adws/phases/prPhase.ts` — pass `config.repoContext.repoId` to `runPullRequestAgent()`\n- `.claude/commands/pull_request.md` — add `$6`/`$7` variables, use qualified issue references, improve default branch fallback\n- `adws/github/pullRequestCreator.ts` — update `generatePrBody()` to use qualified issue references","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-18T13:43:55Z","comments":[{"author":"paysdoc","createdAt":"2026-03-18T14:12:07Z","body":"## Take action"}],"actionableComment":null}`

## Bug Description
Two related issues when creating PRs for foreign target repos:

1. **Wrong base branch**: PRs sometimes target `main` instead of the repo's actual default branch (e.g., `master`, `develop`). The `/pull_request` slash command (`pull_request.md:11`) tells the AI to default to `main` if `$5` is not provided. While `prAgent.ts:59` calls `getDefaultBranch(cwd)` and passes it as `$5`, the slash command prompt still instructs the AI to fall back to `main` — creating a fragile safety net.

2. **Issue linking fails**: GitHub does not auto-link PRs to issues on cross-repo PRs because both `pullRequestCreator.ts:23` (`Implements #${issue.number}`) and the slash command (`Closes #<issueNumber>`) use bare `#N` references. For cross-repo PRs (PR on repo A referencing issue on repo B), GitHub requires the fully-qualified form `Closes owner/repo#N`.

Both stem from missing target repo context in the PR creation path.

## Problem Statement
The PR creation flow lacks the issue's repo owner/name context, causing two failures:
1. The slash command's fallback default branch is hardcoded to `main` instead of querying the actual repo.
2. Issue references in PR bodies use bare `#N` syntax which only works for same-repo PRs — cross-repo PRs require `owner/repo#N`.

## Solution Statement
Pass the issue's `repoOwner` and `repoName` through the PR creation chain (`prPhase.ts` → `prAgent.ts` → `pull_request.md` and `pullRequestCreator.ts`) so that:
1. Issue references use fully-qualified `owner/repo#N` syntax.
2. The slash command's default branch fallback uses `gh repo view` instead of hardcoding `main`.

## Steps to Reproduce
1. Configure ADW to target a foreign repo whose default branch is NOT `main` (e.g., `master` or `develop`).
2. Run a workflow that creates a PR (e.g., `adwPlanBuild.tsx`).
3. Observe the PR targets `main` if `getDefaultBranch()` is somehow unavailable.
4. Observe the PR body contains `Closes #N` which does not link to the issue on the foreign repo.

## Root Cause Analysis
### Default branch
- `prAgent.ts:59` calls `getDefaultBranch(cwd)` which uses `gh repo view --json defaultBranchRef` — this works when the worktree remote points to the correct repo. However, the slash command `pull_request.md:11` reads: `defaultBranch: $5, defaults to 'main' if not provided`. This means the AI agent interpreting the prompt will use `main` as fallback if `$5` appears empty, rather than querying the repo itself.

### Issue linking
- `pullRequestCreator.ts:23` generates `Implements #${issue.number}` — a bare reference.
- `pull_request.md` instructs `Closes #<issueNumber>` — also bare.
- Neither receives the issue's owner/repo, so neither can produce `owner/repo#N`.
- `prPhase.ts` has access to `config.repoContext.repoId` (`{owner, repo}`) but does not pass it to `runPullRequestAgent()`.

## Relevant Files
Use these files to fix the bug:

- `adws/agents/prAgent.ts` — PR agent that calls the `/pull_request` slash command. Must be updated to accept and forward `repoOwner`/`repoName` parameters.
- `adws/phases/prPhase.ts` — PR creation phase that orchestrates the PR agent. Has access to `config.repoContext.repoId` but doesn't pass owner/repo to the PR agent.
- `.claude/commands/pull_request.md` — Slash command template that the AI follows to create PRs. Must add `$6`/`$7` variables for owner/repo and use `gh repo view` as default branch fallback.
- `adws/github/pullRequestCreator.ts` — Generates PR body/title programmatically. `generatePrBody()` uses bare `#N` references.
- `adws/agents/index.ts` — Agent barrel export file, no API changes needed but signature updates propagate through here.
- `adws/providers/types.ts` — Defines `RepoIdentifier` (`{owner, repo, platform}`) and `RepoContext` — read-only reference.
- `adws/phases/workflowInit.ts` — Defines `WorkflowConfig` interface showing `repoContext?: RepoContext` — read-only reference.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `app_docs/feature-2umujr-fix-pr-auth-token-override.md` — Recent PR auth fix context — reference to avoid conflicting changes in `pull_request.md`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `formatPullRequestArgs()` and `runPullRequestAgent()` in `adws/agents/prAgent.ts`

- Add `repoOwner: string` and `repoName: string` parameters to `formatPullRequestArgs()` after `defaultBranch`.
- Append `repoOwner` and `repoName` to the returned args array (positions `$6` and `$7`).
- Add `repoOwner?: string` and `repoName?: string` optional parameters to `runPullRequestAgent()` after `issueBody`.
- Pass `repoOwner ?? ''` and `repoName ?? ''` to `formatPullRequestArgs()`.
- Add log lines for the new parameters.

Updated `formatPullRequestArgs` signature:
```typescript
function formatPullRequestArgs(
  branchName: string,
  issueJson: string,
  planFile: string,
  adwId: string,
  defaultBranch: string,
  repoOwner: string,
  repoName: string,
): string[] {
  return [branchName, issueJson, planFile, adwId, defaultBranch, repoOwner, repoName];
}
```

Updated `runPullRequestAgent` signature:
```typescript
export async function runPullRequestAgent(
  branchName: string,
  issueJson: string,
  planFile: string,
  adwId: string,
  logsDir: string,
  statePath?: string,
  cwd?: string,
  issueBody?: string,
  repoOwner?: string,
  repoName?: string,
): Promise<AgentResult & { prUrl: string }>
```

### Step 2: Update `executePRPhase()` in `adws/phases/prPhase.ts`

- Extract `repoOwner` and `repoName` from `config.repoContext?.repoId` if available.
- Pass them as the last two arguments to `runPullRequestAgent()`.

```typescript
const repoOwner = repoContext?.repoId.owner ?? '';
const repoName = repoContext?.repoId.repo ?? '';

const result = await runPullRequestAgent(
  currentBranch,
  JSON.stringify(issue),
  planFile,
  adwId,
  logsDir,
  undefined,
  worktreePath,
  issue.body,
  repoOwner,
  repoName,
);
```

### Step 3: Update `.claude/commands/pull_request.md` slash command

- Add `$6` (repoOwner) and `$7` (repoName) to the `## Variables` section.
- Change the default branch fallback from hardcoded `'main'` to: `defaults to the output of 'gh repo view --json defaultBranchRef --jq .defaultBranchRef.name' if not provided`.
- Update the `## Instructions` reference from `Closes #<issueNumber>` to use a conditional qualified reference:
  - If `repoOwner` and `repoName` are provided and non-empty, use `Closes repoOwner/repoName#<issueNumber>`.
  - Otherwise, fall back to `Closes #<issueNumber>`.

Updated Variables section:
```markdown
## Variables

branchName: $1, default to current branch if not provided
issue: $2
plan_file: $3
adwId: $4
defaultBranch: $5, defaults to the output of `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` if not provided
repoOwner: $6, the owner of the repository where the issue lives (may be empty for same-repo PRs)
repoName: $7, the name of the repository where the issue lives (may be empty for same-repo PRs)
```

Updated Instructions reference:
```markdown
- Reference to the issue: if `repoOwner` and `repoName` are provided and non-empty, use `Closes repoOwner/repoName#<issueNumber>`; otherwise use `Closes #<issueNumber>`
```

### Step 4: Update `generatePrBody()` in `adws/github/pullRequestCreator.ts`

- Add optional `repoOwner?: string` and `repoName?: string` parameters to `generatePrBody()`.
- Build a qualified issue reference: if both `repoOwner` and `repoName` are non-empty, use `Implements owner/repo#N`; otherwise use `Implements #N`.
- Update the call site in `createPullRequest()` to pass `repoOwner` and `repoName` through.

Updated `generatePrBody` signature:
```typescript
function generatePrBody(
  issue: GitHubIssue,
  planSummary: string,
  buildSummary: string,
  repoOwner?: string,
  repoName?: string,
): string {
  const issueRef = repoOwner && repoName
    ? `${repoOwner}/${repoName}#${issue.number}`
    : `#${issue.number}`;
  return `## Summary
Implements ${issueRef} - ${issue.title}
...`;
}
```

Update `createPullRequest` to accept and forward `repoOwner`/`repoName`:
```typescript
export function createPullRequest(
  issue: GitHubIssue,
  planSummary: string,
  buildSummary: string,
  baseBranch: string = 'develop',
  cwd: string,
  repoInfo: RepoInfo,
  repoOwner?: string,
  repoName?: string,
): string {
  ...
  const prBody = generatePrBody(issue, planSummary, buildSummary, repoOwner, repoName);
  ...
}
```

### Step 5: Create BDD feature file `features/pr_default_branch_linking.feature`

- Tag the feature with `@adw-237`.
- Write scenarios that verify:
  1. `formatPullRequestArgs` includes `repoOwner` and `repoName` at positions 6 and 7.
  2. The `/pull_request` slash command contains `$6` and `$7` variable definitions for `repoOwner` and `repoName`.
  3. The slash command no longer hardcodes `'main'` as the default branch fallback.
  4. The slash command references `gh repo view` as the default branch fallback.
  5. The slash command instructs qualified issue references when `repoOwner`/`repoName` are provided.
  6. `generatePrBody` produces qualified `owner/repo#N` when both params are provided.
  7. `generatePrBody` falls back to bare `#N` when params are absent.
  8. `executePRPhase` extracts `repoOwner`/`repoName` from `repoContext.repoId` (verify by reading `prPhase.ts` source).

### Step 6: Create step definitions `features/step_definitions/prDefaultBranchLinkingSteps.ts`

- Implement Cucumber step definitions for each scenario in the feature file.
- Use file reads and `spawnSync` where needed to verify source code structure.
- Follow the same pattern as existing step definition files (e.g., `prAuthTokenOverrideSteps.ts`).

### Step 7: Run validation commands

- Run all validation commands listed below to confirm the fix is correct with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

```bash
# Lint
bun run lint

# Type check (root)
bunx tsc --noEmit

# Type check (adws)
bunx tsc --noEmit -p adws/tsconfig.json

# Build
bun run build

# Run tagged BDD scenarios for this issue
bunx cucumber-js --tags "@adw-237"

# Run regression BDD scenarios
bunx cucumber-js --tags "@regression"

# Verify slash command no longer hardcodes 'main' as default
grep -c "defaults to 'main'" .claude/commands/pull_request.md  # should be 0

# Verify slash command references gh repo view fallback
grep -c "gh repo view" .claude/commands/pull_request.md  # should be >= 1

# Verify slash command has $6 and $7 variables
grep -c '\$6' .claude/commands/pull_request.md  # should be >= 1
grep -c '\$7' .claude/commands/pull_request.md  # should be >= 1

# Verify pullRequestCreator supports qualified references
grep -c "repoOwner" adws/github/pullRequestCreator.ts  # should be >= 1
grep -c "repoName" adws/github/pullRequestCreator.ts   # should be >= 1

# Verify prAgent passes repoOwner/repoName
grep -c "repoOwner" adws/agents/prAgent.ts  # should be >= 1
grep -c "repoName" adws/agents/prAgent.ts   # should be >= 1

# Verify prPhase extracts from repoContext
grep -c "repoId.owner" adws/phases/prPhase.ts  # should be >= 1
grep -c "repoId.repo" adws/phases/prPhase.ts   # should be >= 1
```

## Notes
- This is a surgical fix: 4 source files modified, 2 new BDD files created.
- No new libraries are required.
- The `pullRequestCreator.ts` `createPullRequest()` function is not currently called from the PR slash command flow (the slash command drives `gh pr create` directly). However, updating it ensures consistency if this code path is ever invoked directly.
- The `getDefaultBranch()` function in `branchOperations.ts` already correctly uses `gh repo view` and throws on failure — no changes needed there. The fix is to the slash command's prompt-level fallback instruction.
- Follow `guidelines/coding_guidelines.md`: immutability, type safety, meaningful names, no `any`.
- Be careful not to conflict with the recent PR auth token fix (issue #236) — the slash command's `## Run` section should remain as-is; only `## Variables` and `## Instructions` sections change.
