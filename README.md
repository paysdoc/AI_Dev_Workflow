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
npm install
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

### 4. Run ADW

```bash
# Process a single issue (plan + build)
npx tsx adws/adwPlanBuild.tsx 123

# Full pipeline with testing
npx tsx adws/adwPlanBuildTest.tsx 123

# Complete SDLC (plan + build + test + review + document)
npx tsx adws/adwSdlc.tsx 123
```

See [adws/README.md](adws/README.md) for full usage documentation.

## Testing

```bash
npm test              # Run tests once
npm run test:watch    # Run tests in watch mode
```

## Project Structure

```
.adw/                   # Project configuration for ADW (see adws/README.md)
├── commands.md         # Build/test/lint command mappings
├── project.md          # Project structure and relevant files
└── conditional_docs.md # Conditional documentation paths
.claude/
├── commands/           # Claude Code slash commands
│   ├── adw_init.md
│   ├── bug.md
│   ├── chore.md
│   ├── classify_adw.md
│   ├── classify_issue.md
│   ├── clean_local_repo.md
│   ├── commit.md
│   ├── conditional_docs.md
│   ├── document.md
│   ├── feature.md
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
├── __tests__/          # Unit tests (31 test files)
├── agents/             # Claude Code agent runners
│   ├── buildAgent.ts
│   ├── claudeAgent.ts
│   ├── documentAgent.ts
│   ├── gitAgent.ts
│   ├── jsonlParser.ts
│   ├── patchAgent.ts
│   ├── planAgent.ts
│   ├── prAgent.ts
│   ├── reviewAgent.ts
│   ├── reviewRetry.ts
│   ├── testAgent.ts
│   ├── testRetry.ts
│   └── tokenManager.ts
├── core/               # Configuration, types, utilities
│   ├── agentState.ts
│   ├── agentTypes.ts
│   ├── config.ts
│   ├── costPricing.ts
│   ├── costReport.ts
│   ├── costTypes.ts
│   ├── dataTypes.ts
│   ├── issueClassifier.ts
│   ├── issueTypes.ts
│   ├── jsonParser.ts
│   ├── orchestratorLib.ts
│   ├── portAllocator.ts
│   ├── projectConfig.ts
│   ├── retryOrchestrator.ts
│   ├── stateHelpers.ts
│   ├── utils.ts
│   └── workflowTypes.ts
├── github/             # GitHub API and git operations
│   ├── gitOperations.ts
│   ├── githubApi.ts
│   ├── issueApi.ts
│   ├── prApi.ts
│   ├── prCommentDetector.ts
│   ├── pullRequestCreator.ts
│   ├── workflowComments.ts
│   ├── workflowCommentsBase.ts
│   ├── workflowCommentsIssue.ts
│   ├── workflowCommentsPR.ts
│   ├── worktreeCleanup.ts
│   ├── worktreeCreation.ts
│   └── worktreeOperations.ts
├── phases/             # Workflow phase implementations
│   ├── buildPhase.ts
│   ├── documentPhase.ts
│   ├── planPhase.ts
│   ├── prPhase.ts
│   ├── prReviewPhase.ts
│   ├── testPhase.ts
│   └── workflowLifecycle.ts
├── triggers/           # Automation triggers
│   ├── trigger_cron.ts
│   ├── trigger_webhook.ts
│   └── webhookHandlers.ts
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
.env.sample             # Environment variable template
.gitignore
package.json
README.md               # This file
```
