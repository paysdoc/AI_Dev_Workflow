# AI Dev Workflow (ADW)

ADW automates software development by integrating GitHub issues with Claude Code CLI to classify issues, generate plans, implement solutions, and create pull requests.

## Setup

### 1. Install Prerequisites

```bash
# GitHub CLI
brew install gh              # macOS
# or: sudo apt install gh    # Ubuntu/Debian

# Claude Code CLI
# Follow instructions at https://docs.anthropic.com/en/docs/claude-code

# Authenticate GitHub
gh auth login
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Configure Environment

Copy `.env.sample` to `.env` and fill in the required values:

```bash
cp .env.sample .env
```

Then edit `.env` with your values:
- `GITHUB_REPO_URL` - Your GitHub repository URL
- `ANTHROPIC_API_KEY` - Your Anthropic API key
- `CLAUDE_CODE_PATH` - (Optional) Path to Claude CLI, defaults to `claude`
- `GITHUB_PAT` - (Optional) GitHub personal access token, only needed if using a different account than `gh auth login`
- `GITHUB_WEBHOOK_SECRET` - (Optional) Required only for webhook trigger
- `TARGET_REPOS_DIR` - (Optional) Directory for storing cloned target repository workspaces, defaults to `~/.adw/repos`
- `MAX_CONCURRENT_PER_REPO` - (Optional) Maximum concurrent in-progress issues per repository, defaults to `5`

### 4. Run ADW

```bash
# Process a single issue (plan + build)
bunx tsx adws/adwPlanBuild.tsx 123

# Full pipeline with testing
bunx tsx adws/adwPlanBuildTest.tsx 123

# Complete SDLC (plan + build + test + review + document)
bunx tsx adws/adwSdlc.tsx 123
```

See [adws/README.md](adws/README.md) for full usage documentation.

## Testing

ADW's own unit tests have been removed in favour of BDD scenarios. The test commands below remain available for target repos that opt in to unit tests via `.adw/project.md`.

```bash
bun run test          # Run tests once
bun run test:watch    # Run tests in watch mode
```

## Project Structure

```
.adw/                   # Project configuration for ADW (see adws/README.md)
├── commands.md         # Build/test/lint command mappings
├── conditional_docs.md # Conditional documentation paths
├── project.md          # Project structure and relevant files
└── review_proof.md     # Review proof requirements for target projects
.claude/
├── commands/           # Claude Code slash commands
│   ├── adw_init.md
│   ├── bug.md
│   ├── chore.md
│   ├── classify_issue.md
│   ├── clean_local_repo.md
│   ├── commit.md
│   ├── commit_cost.md
│   ├── conditional_docs.md
│   ├── document.md
│   ├── feature.md
│   ├── find_issue_dependencies.md
│   ├── generate_branch_name.md
│   ├── implement.md
│   ├── install.md
│   ├── patch.md
│   ├── pr_review.md
│   ├── prepare_app.md
│   ├── prime.md
│   ├── pull_request.md
│   ├── resolve_failed_e2e_test.md
│   ├── resolve_failed_test.md
│   ├── review.md
│   ├── start.md
│   ├── test.md
│   └── tools.md
├── hooks/              # Claude Code hooks
│   ├── notification.ts
│   ├── post-tool-use.ts
│   ├── pre-tool-use.ts
│   ├── stop.ts
│   ├── subagent-stop.ts
│   └── utils/
│       └── constants.ts
└── settings.json
adws/                   # ADW workflow system
├── agents/             # Claude Code agent runners
│   ├── agentProcessHandler.ts  # Process spawning handler
│   ├── buildAgent.ts
│   ├── claudeAgent.ts
│   ├── documentAgent.ts
│   ├── gitAgent.ts
│   ├── index.ts
│   ├── jsonlParser.ts
│   ├── patchAgent.ts
│   ├── planAgent.ts
│   ├── prAgent.ts
│   ├── reviewAgent.ts
│   ├── reviewRetry.ts
│   ├── testAgent.ts
│   ├── testDiscovery.ts  # E2E test discovery
│   └── testRetry.ts
├── core/               # Configuration and utilities
│   ├── agentState.ts
│   ├── config.ts
│   ├── constants.ts    # Orchestrator ID constants
│   ├── costCommitQueue.ts
│   ├── costCsvWriter.ts
│   ├── costPricing.ts
│   ├── costReport.ts
│   ├── index.ts
│   ├── issueClassifier.ts
│   ├── jsonParser.ts
│   ├── orchestratorCli.ts  # Shared CLI parsing utilities
│   ├── orchestratorLib.ts
│   ├── portAllocator.ts
│   ├── projectConfig.ts
│   ├── retryOrchestrator.ts
│   ├── stateHelpers.ts
│   ├── targetRepoManager.ts
│   ├── targetRepoRegistry.ts
│   ├── tokenManager.ts  # Token counting (relocated from agents/)
│   ├── utils.ts
│   └── workflowMapping.ts  # Issue type → orchestrator mapping
├── github/             # GitHub API and git operations
│   ├── gitBranchOperations.ts  # Branch management
│   ├── gitCommitOperations.ts  # Commit/push operations
│   ├── gitOperations.ts  # Re-export barrel
│   ├── githubApi.ts
│   ├── index.ts
│   ├── issueApi.ts
│   ├── prApi.ts
│   ├── prCommentDetector.ts
│   ├── projectBoardApi.ts
│   ├── pullRequestCreator.ts
│   ├── workflowComments.ts
│   ├── workflowCommentsBase.ts
│   ├── workflowCommentsIssue.ts
│   ├── workflowCommentsPR.ts
│   ├── worktreeCleanup.ts
│   ├── worktreeCreation.ts
│   ├── worktreeOperations.ts
│   └── worktreeQuery.ts  # Worktree query utilities
├── phases/             # Workflow phase implementations
│   ├── buildPhase.ts
│   ├── documentPhase.ts
│   ├── index.ts
│   ├── planPhase.ts
│   ├── prPhase.ts
│   ├── prReviewCompletion.ts  # PR review completion/error handling
│   ├── prReviewPhase.ts
│   ├── testPhase.ts
│   ├── workflowCompletion.ts  # Workflow completion/error handling
│   ├── workflowInit.ts  # Workflow initialization
│   ├── workflowLifecycle.ts  # Re-export barrel
│   └── worktreeSetup.ts  # Gitignore and worktree setup helpers
├── types/              # Type definitions
│   ├── agentTypes.ts
│   ├── costTypes.ts
│   ├── dataTypes.ts
│   ├── index.ts
│   ├── issueTypes.ts
│   └── workflowTypes.ts
├── providers/          # Provider interfaces and types
│   ├── index.ts
│   └── types.ts
├── triggers/           # Automation triggers
│   ├── concurrencyGuard.ts
│   ├── issueDependencies.ts
│   ├── issueEligibility.ts
│   ├── trigger_cron.ts
│   ├── trigger_webhook.ts
│   ├── webhookGatekeeper.ts
│   ├── webhookHandlers.ts
│   └── webhookSignature.ts
├── adwBuild.tsx        # Orchestrators (individual & combined)
├── adwBuildHelpers.ts
├── adwClearComments.tsx
├── adwDocument.tsx
├── adwInit.tsx
├── adwPatch.tsx
├── adwPlan.tsx
├── adwPlanBuild.tsx
├── adwPlanBuildDocument.tsx
├── adwPlanBuildReview.tsx
├── adwPlanBuildTest.tsx
├── adwPlanBuildTestReview.tsx
├── adwPrReview.tsx
├── adwSdlc.tsx
├── adwTest.tsx
├── healthCheck.tsx
├── healthCheckChecks.ts
├── workflowPhases.ts
├── index.ts
├── tsconfig.json
└── README.md
app_docs/               # Generated feature documentation
bun.lock                # Bun lockfile
eslint.config.js        # ESLint configuration
guidelines/
└── coding_guidelines.md
projects/               # Cost tracking CSV files per project
specs/                  # Generated implementation specs
.env.sample             # Environment variable template
.gitignore
package.json
tsconfig.json           # Root TypeScript configuration
vitest.config.ts        # Vitest test runner configuration
README.md               # This file
```
