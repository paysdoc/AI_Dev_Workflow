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
- `REVIEW_AGENT_COUNT` - (Optional) Number of parallel review agents per iteration, defaults to `3`
- `RUNNING_TOKENS` - (Optional) Show running token totals in issue comments, defaults to `false`
- `SHOW_COST_IN_COMMENTS` - (Optional) Show cost breakdowns in GitHub issue/PR comments, defaults to `false`
- `JIRA_BASE_URL` - (Optional) Jira instance URL, required only when using Jira as the issue tracker
- `JIRA_PROJECT_KEY` - (Optional) Default Jira project key
- `JIRA_EMAIL` - (Optional) Jira Cloud auth email
- `JIRA_API_TOKEN` - (Optional) Jira Cloud API token
- `JIRA_PAT` - (Optional) Jira Data Center/Server personal access token (use instead of email + API token)
- `GITLAB_TOKEN` - (Optional) GitLab personal access token (needs api scope), required only when using GitLab
- `GITLAB_INSTANCE_URL` - (Optional) GitLab instance URL, defaults to `https://gitlab.com`
- `CLOUDFLARE_ACCOUNT_ID` - (Optional) Cloudflare account ID, required only for screenshot upload functionality
- `R2_ACCESS_KEY_ID` - (Optional) R2 access key ID, required only for screenshot upload functionality
- `R2_SECRET_ACCESS_KEY` - (Optional) R2 secret access key, required only for screenshot upload functionality
- `COST_API_URL` - (Optional) Cost API Worker URL for D1 cost database writes (e.g., `https://costs.paysdoc.nl`)
- `COST_API_TOKEN` - (Optional) Bearer token for Cost API authentication

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

## Domain Language

ADW uses a DDD-style ubiquitous language to keep code, documentation, and conversation aligned. See [UBIQUITOUS_LANGUAGE.md](UBIQUITOUS_LANGUAGE.md) for canonical term definitions, aliases to avoid, and a worked example dialogue.

## Testing

ADW uses BDD scenarios for validation (see `.adw/scenarios.md`).

### Running BDD scenarios on the host

```bash
# Run all @regression scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Run a specific tag
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@mock-infrastructure"
```

### Docker (optional)

A generic Docker image (`test/Dockerfile`) provides an isolated runtime (Bun + Git) so
the full `@regression` suite can run inside a container without host-specific dependencies.
The image is generic — no ADW source code is baked in; the repo is mounted read-only at run
time. `TEST_RUNTIME=docker` is set automatically inside the container.

```bash
# Build the image once
bun run test:docker:build

# Run @regression scenarios inside the container (same results as host)
bun run test:docker

# Run a specific tag inside the container
bash test/docker-run.sh --tags "@mock-infrastructure"

# Open an interactive shell for debugging
bash test/docker-run.sh --shell
```

Docker execution is entirely optional — the test suite runs identically on the host without it.

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
│   ├── align_plan_scenarios.md
│   ├── bug.md
│   ├── chore.md
│   ├── classify_issue.md
│   ├── clean_local_repo.md
│   ├── commit.md
│   ├── diff_evaluator.md
│   ├── conditional_docs.md
│   ├── document.md
│   ├── extract_dependencies.md
│   ├── feature.md
│   ├── find_issue_dependencies.md
│   ├── generate_branch_name.md
│   ├── generate_step_definitions.md
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
│   ├── implement-tdd/
│   │   ├── SKILL.md
│   │   ├── deep-modules.md
│   │   ├── interface-design.md
│   │   ├── mocking.md
│   │   ├── refactoring.md
│   │   └── tests.md
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
├── __tests__/          # Vitest integration tests
│   └── adwMerge.test.ts
├── agents/             # Claude Code agent runners
│   ├── __tests__/      # Vitest unit tests
│   │   └── gitAgent.test.ts
│   ├── agentProcessHandler.ts  # Process spawning handler
│   ├── alignmentAgent.ts  # Single-pass alignment agent
│   ├── bddScenarioRunner.ts  # BDD scenario execution
│   ├── buildAgent.ts
│   ├── claudeAgent.ts
│   ├── commandAgent.ts  # Generic thin-wrapper agent for slash commands
│   ├── diffEvaluatorAgent.ts  # LLM-based diff safety classification (Haiku)
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
│   ├── __tests__/      # Vitest unit tests
│   │   ├── claudeStreamParser.test.ts
│   │   ├── execWithRetry.test.ts
│   │   ├── phaseRunner.test.ts
│   │   └── topLevelState.test.ts
│   ├── adwId.ts        # ADW ID generation
│   ├── agentState.ts
│   ├── claudeStreamParser.ts  # Claude JSONL stream parsing
│   ├── config.ts
│   ├── constants.ts    # Orchestrator ID constants
│   ├── environment.ts  # Environment variable accessors
│   ├── index.ts
│   ├── issueClassifier.ts
│   ├── jsonParser.ts
│   ├── logger.ts       # Structured logging utilities
│   ├── modelRouting.ts # Model/effort routing utilities
│   ├── orchestratorCli.ts  # Shared CLI parsing utilities
│   ├── orchestratorLib.ts
│   ├── pauseQueue.ts   # Pause queue for rate-limit pause/resume
│   ├── phaseRunner.ts  # PhaseRunner / CostTracker composition
│   ├── portAllocator.ts
│   ├── projectConfig.ts
│   ├── retryOrchestrator.ts
│   ├── stateHelpers.ts
│   ├── targetRepoManager.ts
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
│   ├── proofCommentFormatter.ts
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
│   ├── reporting/      # Cost reporting
│   │   ├── commentFormatter.ts
│   │   └── index.ts
│   ├── computation.ts  # Cost computation logic
│   ├── costHelpers.ts  # Shared cost utility helpers
│   ├── d1Client.ts     # D1 HTTP client — posts PhaseCostRecords to Cost API Worker
│   ├── exchangeRates.ts
│   ├── index.ts
│   └── types.ts
├── jsonl/              # JSONL schema validation and fixtures
│   ├── fixtures/       # JSONL fixture files for testing
│   │   ├── README.md
│   │   ├── assistant-text.jsonl
│   │   ├── assistant-tool-use.jsonl
│   │   ├── result-error.jsonl
│   │   └── result-success.jsonl
│   ├── conformanceCheck.ts  # JSONL conformance validation
│   ├── fixtureUpdater.ts    # Fixture update utility
│   ├── index.ts
│   ├── schema.json          # JSONL envelope schema
│   ├── schemaProbe.ts       # Schema probe utility
│   └── types.ts
├── phases/             # Workflow phase implementations
│   ├── alignmentPhase.ts  # Single-pass alignment phase
│   ├── autoMergePhase.ts  # Auto-approve and merge PR after review passes
│   ├── diffEvaluationPhase.ts  # LLM diff evaluation phase (safe vs regression_possible)
│   ├── buildPhase.ts
│   ├── documentPhase.ts
│   ├── index.ts
│   ├── installPhase.ts # Install phase implementation
│   ├── kpiPhase.ts     # KPI tracking phase
│   ├── phaseCommentHelpers.ts  # Shared phase comment utilities
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
│   └── worktreeSetup.ts  # Gitignore and worktree setup helpers
├── types/              # Type definitions
│   ├── agentTypes.ts
│   ├── dataTypes.ts
│   ├── index.ts
│   ├── issueRouting.ts  # Issue routing type definitions
│   ├── issueTypes.ts
│   └── workflowTypes.ts
├── providers/          # Provider interfaces and implementations
│   ├── __tests__/      # Vitest unit tests
│   │   └── repoContext.test.ts
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
│   ├── __tests__/      # Vitest unit tests
│   │   ├── cronRepoResolver.test.ts
│   │   ├── cronStageResolver.test.ts
│   │   └── triggerCronAwaitingMerge.test.ts
│   ├── autoMergeHandler.ts  # Auto-merge approved PRs
│   ├── cloudflareTunnel.tsx  # Cloudflare tunnel for webhooks
│   ├── concurrencyGuard.ts
│   ├── cronIssueFilter.ts  # Cron issue evaluation and filtering logic (testable, extracted from trigger_cron)
│   ├── cronProcessGuard.ts  # Duplicate cron process prevention
│   ├── cronRepoResolver.ts  # Cron repo identity resolution (testable, extracted from trigger_cron)
│   ├── cronStageResolver.ts  # Cron stage resolution from top-level state file (testable)
│   ├── issueDependencies.ts
│   ├── issueEligibility.ts
│   ├── pauseQueueScanner.ts  # Cron probe for paused issue queue
│   ├── trigger_cron.ts
│   ├── trigger_shutdown.ts  # Graceful shutdown handler
│   ├── trigger_webhook.ts
│   ├── webhookGatekeeper.ts
│   ├── webhookHandlers.ts
│   └── webhookSignature.ts
├── r2/                 # Cloudflare R2 upload module
│   ├── bucketManager.ts  # R2 bucket creation and lifecycle rules
│   ├── r2Client.ts     # R2 client factory
│   ├── types.ts        # R2 type definitions
│   ├── uploadService.ts  # File upload logic
│   └── index.ts
├── known_issues.md     # Known issues registry
├── adwBuild.tsx        # Orchestrators (individual & combined)
├── adwChore.tsx        # Chore pipeline with LLM diff gate (auto-merge)
├── adwMerge.tsx        # Merge orchestrator (awaiting_merge handoff)
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
├── known_issues.md     # Known issues registry
├── workflowPhases.ts   # Workflow phase re-exports
├── index.ts
├── tsconfig.json
└── README.md
.github/
└── workflows/
    ├── deploy-workers.yml  # Auto-deploy Cloudflare Workers on push to main
    └── regression.yml      # Periodic @regression BDD scenario runner
workers/                # Cloudflare Workers
├── cost-api/           # Cost data ingestion API (costs.paysdoc.nl, D1-backed)
│   ├── src/
│   │   ├── auth.ts         # Bearer token authentication
│   │   ├── cors.ts         # CORS middleware
│   │   ├── index.ts        # Worker entry point
│   │   ├── ingest.ts       # POST /api/cost handler
│   │   ├── migrations/     # D1 SQL migrations
│   │   ├── queries.ts      # D1 query helpers
│   │   ├── schema.sql      # D1 database schema
│   │   └── types.ts        # Worker type definitions
│   ├── test/
│   │   ├── cors.test.ts    # CORS middleware tests
│   │   ├── ingest.test.ts  # Ingest endpoint tests
│   │   └── queries.test.ts # D1 query tests
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── wrangler.toml       # Cloudflare Workers config
└── screenshot-router/  # Screenshot URL routing worker
    ├── src/
    │   └── index.ts    # Worker entry point
    ├── package.json
    ├── tsconfig.json
    └── wrangler.toml   # Cloudflare Workers config
test/                   # Integration test infrastructure
├── fixtures/           # Static test fixtures
│   ├── cli-tool/       # Fixture target repo for BDD scenario testing
│   │   ├── .adw/       # ADW config for fixture repo
│   │   ├── src/        # Minimal CLI tool source
│   │   ├── README.md
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── github/         # GitHub API response fixtures (issue, PR, comments)
│   └── jsonl/          # JSONL envelope and payload fixtures
│       ├── envelopes/
│       └── payloads/
├── mocks/              # Mock implementations
│   ├── claude-cli-stub.ts      # Claude CLI process stub
│   ├── git-remote-mock.ts      # Git remote mock
│   ├── github-api-server.ts    # GitHub API mock HTTP server
│   ├── test-harness.ts         # Test harness orchestrating all mocks
│   └── types.ts                # Mock type definitions
├── Dockerfile          # Generic Docker image for isolated @regression runs
├── docker-run.sh       # Helper script to run scenarios inside Docker
└── .dockerignore       # Files excluded from Docker build context
app_docs/               # Generated feature documentation
bun.lock                # Bun lockfile
eslint.config.js        # ESLint configuration
cucumber.js             # Cucumber.js configuration
features/               # BDD feature files (Gherkin .feature)
├── step_definitions/   # Cucumber step definition files (.ts)
└── support/            # Cucumber support files (tsx registration)
guidelines/
└── coding_guidelines.md
specs/                  # Generated implementation specs
├── patch/              # Generated patch specs
└── prd/                # Product requirement documents
.env.sample             # Environment variable template
.gitignore
package.json
tsconfig.json           # Root TypeScript configuration
vitest.config.ts        # Vitest test configuration
README.md               # This file
UBIQUITOUS_LANGUAGE.md  # DDD ubiquitous language glossary
```
