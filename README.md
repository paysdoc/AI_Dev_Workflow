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

Copy the root-level `.env.sample` to `.env` and fill in the required values:

```bash
cp .env.sample .env
# Then edit .env with your actual credentials and configuration
```

Required and optional environment variables (see `.env.sample` for full reference):
- `GITHUB_REPO_URL` - Your GitHub repository URL
- `ANTHROPIC_API_KEY` - Your Anthropic API key
- `CLAUDE_CODE_PATH` - (Optional) Path to Claude CLI, defaults to `claude`
- `GITHUB_PAT` - (Optional) GitHub personal access token, only needed if using a different account than `gh auth login`
- `GITHUB_APP_ID` - (Optional) GitHub App ID for app-based authentication (comments appear as the app)
- `GITHUB_APP_SLUG` - (Optional) GitHub App slug, used with `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY_PATH` - (Optional) Path to GitHub App private key PEM file
- `GITHUB_WEBHOOK_SECRET` - (Optional) Required only for webhook trigger
- `TARGET_REPOS_DIR` - (Optional) Directory for storing cloned target repository workspaces, defaults to `~/.adw/repos`
- `MAX_CONCURRENT_PER_REPO` - (Optional) Maximum concurrent in-progress issues per repository, defaults to `5`
- `RUNNING_TOKENS` - (Optional) Show running token totals in issue comments, defaults to `false`
- `JIRA_BASE_URL` - (Optional) Jira instance URL, required only when using Jira as the issue tracker
- `JIRA_PROJECT_KEY` - (Optional) Default Jira project key
- `JIRA_EMAIL` - (Optional) Jira Cloud auth email
- `JIRA_API_TOKEN` - (Optional) Jira Cloud API token
- `JIRA_PAT` - (Optional) Jira Data Center/Server personal access token (use instead of email + API token)
- `GITLAB_TOKEN` - (Optional) GitLab personal access token (needs api scope), required only when using GitLab
- `GITLAB_INSTANCE_URL` - (Optional) GitLab instance URL, defaults to `https://gitlab.com`

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

ADW uses BDD scenarios for validation (see `.adw/scenarios.md`).

## Project Structure

```
.adw/                   # Project configuration for ADW (see adws/README.md)
├── commands.md         # Build/test/lint command mappings
├── conditional_docs.md # Conditional documentation paths
├── project.md          # Project structure and relevant files
├── providers.md        # Provider configuration (issue tracker, code host)
├── review_proof.md     # Review proof requirements for target projects
└── scenarios.md        # BDD scenario configuration
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
│   ├── extract_dependencies.md
│   ├── feature.md
│   ├── find_issue_dependencies.md
│   ├── generate_branch_name.md
│   ├── implement.md
│   ├── in_loop_review.md
│   ├── install.md
│   ├── patch.md
│   ├── pr_review.md
│   ├── prepare_app.md
│   ├── prime.md
│   ├── pull_request.md
│   ├── resolve_conflict.md
│   ├── resolve_failed_e2e_test.md
│   ├── resolve_failed_test.md
│   ├── resolve_plan_scenarios.md
│   ├── review.md
│   ├── scenario_writer.md
│   ├── start.md
│   ├── test.md
│   ├── test_e2e.md
│   ├── tools.md
│   ├── track_agentic_kpis.md
│   └── validate_plan_scenarios.md
├── hooks/              # Claude Code hooks
│   ├── notification.ts
│   ├── post-tool-use.ts
│   ├── pre-tool-use.ts
│   ├── stop.ts
│   ├── subagent-stop.ts
│   └── utils/
│       └── constants.ts
├── skills/             # Claude Code skills
│   ├── grill-me/
│   │   └── SKILL.md
│   ├── improve-codebase-architecture/
│   │   ├── REFERENCE.md
│   │   └── SKILL.md
│   ├── prd-to-issues/
│   │   └── SKILL.md
│   ├── tdd/
│   │   ├── SKILL.md
│   │   ├── deep-modules.md
│   │   ├── interface-design.md
│   │   ├── mocking.md
│   │   ├── refactoring.md
│   │   └── tests.md
│   ├── ubiquitous-language/
│   │   └── SKILL.md
│   └── write-a-prd/
│       └── SKILL.md
└── settings.json
adws/                   # ADW workflow system
├── agents/             # Claude Code agent runners
│   ├── agentProcessHandler.ts  # Process spawning handler
│   ├── bddScenarioRunner.ts  # BDD scenario execution
│   ├── buildAgent.ts
│   ├── claudeAgent.ts
│   ├── regressionScenarioProof.ts  # Regression scenario proof for reviews
│   ├── dependencyExtractionAgent.ts  # LLM-based issue dependency extraction
│   ├── documentAgent.ts
│   ├── gitAgent.ts
│   ├── index.ts
│   ├── jsonlParser.ts
│   ├── installAgent.ts # Install phase agent
│   ├── kpiAgent.ts     # KPI tracking agent
│   ├── patchAgent.ts
│   ├── planAgent.ts
│   ├── prAgent.ts
│   ├── resolutionAgent.ts  # Plan-scenario mismatch resolution
│   ├── reviewAgent.ts
│   ├── reviewRetry.ts
│   ├── scenarioAgent.ts  # BDD scenario planner agent
│   ├── stepDefAgent.ts  # Step definition generation agent
│   ├── testAgent.ts
│   ├── testDiscovery.ts  # E2E test discovery
│   ├── testRetry.ts
│   └── validationAgent.ts  # Plan-scenario validation
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
│   ├── tokenManager.ts  # Token counting (relocated from agents/)
│   ├── utils.ts
│   ├── workflowCommentParsing.ts  # Comment parsing utilities
│   └── workflowMapping.ts  # Issue type → orchestrator mapping
├── github/             # GitHub API operations
│   ├── githubApi.ts
│   ├── githubAppAuth.ts  # GitHub App authentication
│   ├── index.ts
│   ├── issueApi.ts
│   ├── prApi.ts
│   ├── prCommentDetector.ts
│   ├── projectBoardApi.ts
│   ├── pullRequestCreator.ts
│   ├── workflowComments.ts
│   ├── workflowCommentsBase.ts
│   ├── workflowCommentsIssue.ts
│   └── workflowCommentsPR.ts
├── vcs/                # Version control operations (git)
│   ├── branchOperations.ts  # Branch management
│   ├── commitOperations.ts  # Commit/push operations
│   ├── index.ts
│   ├── worktreeCleanup.ts
│   ├── worktreeCreation.ts
│   ├── worktreeOperations.ts
│   └── worktreeQuery.ts  # Worktree query utilities
├── cost/               # Cost tracking module
│   ├── __tests__/      # Vitest unit tests
│   │   ├── computation.test.ts
│   │   └── extractor.test.ts
│   ├── providers/anthropic/  # Anthropic token usage extraction
│   │   ├── extractor.ts
│   │   ├── index.ts
│   │   └── pricing.ts
│   ├── reporting/      # Cost CSV reporting
│   │   ├── csvWriter.ts
│   │   └── index.ts
│   ├── computation.ts  # Cost computation logic
│   ├── exchangeRates.ts
│   ├── index.ts
│   └── types.ts
├── phases/             # Workflow phase implementations
│   ├── autoMergePhase.ts  # Auto-approve and merge PR after review passes
│   ├── buildPhase.ts
│   ├── documentPhase.ts
│   ├── index.ts
│   ├── installPhase.ts # Install phase implementation
│   ├── kpiPhase.ts     # KPI tracking phase
│   ├── phaseCommentHelpers.ts  # Shared phase comment utilities
│   ├── phaseCostCommit.ts  # Phase cost data commit logic
│   ├── planPhase.ts
│   ├── planValidationPhase.ts  # Plan-scenario validation phase
│   ├── prPhase.ts
│   ├── prReviewCompletion.ts  # PR review completion/error handling
│   ├── prReviewPhase.ts
│   ├── scenarioPhase.ts  # BDD scenario generation phase
│   ├── stepDefPhase.ts  # Step definition generation phase
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
├── providers/          # Provider interfaces and implementations
│   ├── github/         # GitHub provider
│   │   ├── githubCodeHost.ts
│   │   ├── githubIssueTracker.ts
│   │   ├── index.ts
│   │   └── mappers.ts
│   ├── gitlab/         # GitLab provider
│   │   ├── gitlabApiClient.ts
│   │   ├── gitlabCodeHost.ts
│   │   ├── gitlabTypes.ts
│   │   ├── index.ts
│   │   └── mappers.ts
│   ├── jira/           # Jira provider
│   │   ├── adfConverter.ts
│   │   ├── index.ts
│   │   ├── jiraApiClient.ts
│   │   ├── jiraIssueTracker.ts
│   │   └── jiraTypes.ts
│   ├── index.ts
│   ├── repoContext.ts  # RepoContext factory
│   └── types.ts
├── triggers/           # Automation triggers
│   ├── autoMergeHandler.ts  # Auto-merge approved PRs
│   ├── cloudflareTunnel.tsx  # Cloudflare tunnel for webhooks
│   ├── concurrencyGuard.ts
│   ├── cronProcessGuard.ts  # Duplicate cron process prevention
│   ├── issueDependencies.ts
│   ├── issueEligibility.ts
│   ├── trigger_cron.ts
│   ├── trigger_shutdown.ts  # Graceful shutdown handler
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
├── healthCheck.tsx     # Health check orchestrator
├── healthCheckChecks.ts
├── workflowPhases.ts   # Workflow phase re-exports
├── index.ts
├── tsconfig.json
└── README.md
app_docs/               # Generated feature documentation
bun.lock                # Bun lockfile
eslint.config.js        # ESLint configuration
cucumber.js             # Cucumber.js configuration
features/               # BDD feature files (Gherkin .feature)
└── step_definitions/   # Cucumber step definition files (.ts)
guidelines/
└── coding_guidelines.md
projects/               # Cost tracking CSV files per project
specs/                  # Generated implementation specs
.env.sample             # Environment variable template
.gitignore
package.json
tsconfig.json           # Root TypeScript configuration
README.md               # This file
```
