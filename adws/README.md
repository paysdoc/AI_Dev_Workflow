# AI Developer Workflow (ADW) System

ADW automates software development by integrating GitHub issues with Claude Code CLI to classify issues, generate plans, implement solutions, and create pull requests.

## Key Concepts

### ADW ID
Each workflow run is assigned a unique 8-character identifier (e.g., `a1b2c3d4`). This ID:
- Tracks all phases of a workflow (plan → build → test → review → document)
- Appears in GitHub comments, commits, and PR titles
- Creates an isolated workspace at `agents/{adwId}/`
- Enables resuming workflows and debugging

### State Management
ADW uses persistent state files (`agents/{adwId}/adw_state.json`) to:
- Share data between workflow phases
- Enable workflow composition and chaining
- Track essential workflow data:
  - `adwId`: Unique workflow identifier
  - `issueNumber`: GitHub issue being processed
  - `branchName`: Git branch for changes
  - `planFile`: Path to implementation plan
  - `issueClass`: Issue type (`/chore`, `/bug`, `/feature`)

### Workflow Composition
Workflows can be:
- Run individually (e.g., just planning or just building)
- Combined in orchestrator scripts (e.g., `adwPlanBuildTestReview.tsx` runs plan, build, test, and review phases)

## Quick Start

### 1. Set Environment Variables

```bash
export GITHUB_REPO_URL="https://github.com/owner/repository"
export ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export CLAUDE_CODE_PATH="/path/to/claude"  # Optional, defaults to "claude"
export GITHUB_PAT="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # Optional, only if using different account than 'gh auth login'
```

### 2. Install Prerequisites

```bash
# GitHub CLI
brew install gh              # macOS
# or: sudo apt install gh    # Ubuntu/Debian
# or: winget install --id GitHub.cli  # Windows

# Claude Code CLI
# Follow instructions at https://docs.anthropic.com/en/docs/claude-code

# Node.js dependencies (tsx is included as a devDependency)
bun install

# Authenticate GitHub
gh auth login
```

### 3. Run ADW

```bash
# Process a single issue manually (plan + build)
bunx tsx adws/adwPlanBuild.tsx 123

# Process a single issue with testing (plan + build + test)
bunx tsx adws/adwPlanBuildTest.tsx 123

# Process with review (plan + build + test + review)
bunx tsx adws/adwPlanBuildTestReview.tsx 123

# Process with review but skip tests (plan + build + review)
bunx tsx adws/adwPlanBuildReview.tsx 123

# Process with documentation (plan + build + document)
bunx tsx adws/adwPlanBuildDocument.tsx 123

# Run complete SDLC (plan + build + test + review + document)
bunx tsx adws/adwSdlc.tsx 123

# Run individual phases
bunx tsx adws/adwPlan.tsx 123               # Planning phase only
bunx tsx adws/adwBuild.tsx 123 <adw-id>     # Build phase only (requires existing plan)
bunx tsx adws/adwTest.tsx [adw-id]          # Testing phase only
bunx tsx adws/adwDocument.tsx [adw-id]      # Documentation phase only
bunx tsx adws/adwPatch.tsx 123 [adw-id]     # Direct patch from issue

# Run continuous monitoring (polls every 20 seconds)
bunx tsx adws/triggers/trigger_cron.ts

# Start webhook server (for instant GitHub events)
bunx tsx adws/triggers/trigger_webhook.ts
```

## ADW Workflow Scripts

### Individual Phase Scripts

#### adwPlan.tsx - Planning Phase
Creates implementation plans for GitHub issues.

**Requirements:**
- GitHub issue number
- Issue must be open and accessible

**Usage:**
```bash
bunx tsx adws/adwPlan.tsx <issueNumber> [adw-id]
```

**What it does:**
1. Fetches issue details from GitHub
2. Classifies issue type (`/chore`, `/bug`, `/feature`)
3. Creates feature branch with semantic naming
4. Generates detailed implementation plan
5. Commits plan as `{adwId}_plan_spec.md`
6. Creates/updates pull request
7. Outputs state JSON for chaining

#### adwBuild.tsx - Implementation Phase
Implements solutions based on existing plans.

**Requirements:**
- Existing plan file (from `adwPlan.tsx` or manual)

**Usage:**
```bash
# With explicit arguments
bunx tsx adws/adwBuild.tsx <issueNumber> <adw-id>
```

**What it does:**
1. Locates existing plan file
2. Implements solution per plan specifications
3. Commits implementation changes
4. Updates pull request

#### adwTest.tsx - Testing Phase
Runs test suites and handles test failures.

**Usage:**
```bash
bunx tsx adws/adwTest.tsx [adw-id] [--cwd <path>]
```

**Requirements:**
- Working directory with test suite
- Optional: E2E test setup

**What it does:**
1. Runs unit test suite with automatic failure resolution
2. Runs E2E tests (browser automation) with automatic failure resolution
3. Auto-resolves test failures (up to MAX_TEST_RETRY_ATTEMPTS attempts)
4. Reports pass/fail results

#### adwPrReview.tsx - Review Phase
Reviews implementation against specifications.

**Requirements:**
- Existing specification file
- Completed implementation
- ADW ID is required

**Usage:**
```bash
bunx tsx adws/adwPrReview.tsx <issueNumber> <adw-id> [--skip-resolution]
```

**What it does:**
1. Locates specification file
2. Reviews implementation for spec compliance
3. Captures screenshots of functionality
4. Identifies issues (blockers, tech debt, skippable)
5. Auto-resolves blockers (unless `--skip-resolution`)
6. Uploads screenshots to cloud storage
7. Posts detailed review report

#### adwDocument.tsx - Documentation Phase
Generates comprehensive documentation using the `/document` skill.

**Usage:**
```bash
bunx tsx adws/adwDocument.tsx [adw-id] [--cwd <path>]
```

**Requirements:**
- ADW ID (optional, auto-generated if not provided)

**What it does:**
1. Analyzes git diff against main branch
2. Generates technical documentation in `app_docs/`
3. Updates conditional docs registry
4. Optionally includes screenshots from review phase

#### adwPatch.tsx - Direct Patch Workflow
Creates direct patches from GitHub issues without a full plan cycle.

**Usage:**
```bash
bunx tsx adws/adwPatch.tsx <issueNumber> [adw-id] [--cwd <path>]
```

**Requirements:**
- GitHub issue number

**What it does:**
1. Fetches GitHub issue details
2. Creates a targeted patch plan using the `/patch` skill
3. Implements the patch using the build agent
4. Commits changes and creates PR
5. Skips full planning phase

### Orchestrator Scripts

#### adwPlanBuild.tsx - Plan + Build
Combines planning and implementation phases.

**Usage:**
```bash
bunx tsx adws/adwPlanBuild.tsx <issueNumber> [adw-id]
```

#### adwPlanBuildTest.tsx - Plan + Build + Test
Full pipeline with automated testing.

**Usage:**
```bash
bunx tsx adws/adwPlanBuildTest.tsx <issueNumber> [adw-id]
```

**Phases:**
1. Planning (creates implementation spec)
2. Building (implements solution)
3. Testing (runs test suite, auto-fixes failures)

#### adwPlanBuildTestReview.tsx - Plan + Build + Test + Review
Complete pipeline with quality review.

**Usage:**
```bash
bunx tsx adws/adwPlanBuildTestReview.tsx <issueNumber> [adw-id]
```

**Phases:**
1. Planning (creates implementation spec)
2. Building (implements solution)
3. Testing (ensures functionality)
4. Review (validates against spec, auto-fixes issues)

#### adwPlanBuildReview.tsx - Plan + Build + Review
Pipeline with review but skipping tests.

**Usage:**
```bash
bunx tsx adws/adwPlanBuildReview.tsx <issueNumber> [adw-id]
```

**Phases:**
1. Planning (creates implementation spec)
2. Building (implements solution)
3. PR creation
4. Review (validates against spec, auto-fixes issues)

**Note:** Review phase evaluates implementation against specification but without test verification. Best for non-critical changes or when testing is handled separately.

#### adwPlanBuildDocument.tsx - Plan + Build + Document
Fast documentation pipeline skipping tests and review.

**Usage:**
```bash
bunx tsx adws/adwPlanBuildDocument.tsx <issueNumber> [adw-id]
```

**Phases:**
1. Planning (creates implementation spec)
2. Building (implements solution)
3. PR creation
4. Document (generates documentation without screenshots)

#### adwSdlc.tsx - Complete SDLC
Full Software Development Life Cycle automation.

**Usage:**
```bash
bunx tsx adws/adwSdlc.tsx <issueNumber> [adw-id]
```

**Phases:**
1. **Plan**: Creates detailed implementation spec
2. **Build**: Implements the solution
3. **Test**: Runs comprehensive test suite
4. **PR**: Creates pull request
5. **Review**: Validates implementation vs spec
6. **Document**: Generates technical and user docs (includes review screenshots)

**Output:**
- Feature implementation
- Passing tests
- Review report with screenshots
- Complete documentation in `app_docs/`

### Automation Triggers

#### trigger_cron.ts - Polling Monitor
Continuously monitors GitHub for triggers.

**Usage:**
```bash
bunx tsx adws/triggers/trigger_cron.ts
```

**Triggers on:**
- New issues with no comments
- Any issue where latest comment is exactly "adw"
- Polls every 20 seconds

**Workflow selection:**
- Bug issues → `adwPlanBuildTest.tsx`
- Chore issues → `adwPlanBuild.tsx`
- Feature issues → `adwSdlc.tsx`
- PR review issues → `adwPlanBuild.tsx`

#### trigger_webhook.ts - Real-time Events
Webhook server for instant GitHub event processing.

**Usage:**
```bash
bunx tsx adws/triggers/trigger_webhook.ts
```

**Configuration:**
- Default port: 8001 (falls back to a random available port if 8001 is in use, unless `GITHUB_WEBHOOK_SECRET` is set — then it throws an error to prevent breaking the Cloudflare tunnel)
- Endpoints:
  - `/webhook` - GitHub event receiver
  - `/health` - Health check
- GitHub webhook settings:
  - Payload URL: `https://api.paysdoc.nl/webhook`
  - Content type: `application/json`
  - Events: `issues`, `issue_comment`, `pull_request`, `pull_request_review`, `pull_request_review_comment`

**Security:**
- When `GITHUB_WEBHOOK_SECRET` is set: validates GitHub `x-hub-signature-256` HMAC-SHA256 signatures, rejects invalid/missing signatures with HTTP 401
- When `GITHUB_WEBHOOK_SECRET` is not set: all requests pass through without validation (backward compatible)

## How ADW Works

1. **Issue Classification**: Analyzes GitHub issue and determines type:
   - `/chore` - Maintenance, documentation, refactoring
   - `/bug` - Bug fixes and corrections
   - `/feature` - New features and enhancements

2. **Planning**: `planAgent` creates implementation plan with:
   - Technical approach
   - Step-by-step tasks
   - File modifications
   - Testing requirements

3. **Implementation**: `buildAgent` executes the plan:
   - Analyzes codebase
   - Implements changes
   - Runs tests
   - Ensures quality

4. **Integration**: Creates git commits and pull request:
   - Semantic commit messages
   - Links to original issue
   - Implementation summary

## Common Usage Scenarios

### Process a bug report
```bash
# User reports bug in issue #789
bunx tsx adws/adwPlanBuild.tsx 789
# ADW analyzes, creates fix, and opens PR
```

### Run full pipeline
```bash
# Complete pipeline with testing
bunx tsx adws/adwPlanBuildTest.tsx 789
# ADW plans, builds, and tests the solution
```

### Run complete SDLC
```bash
# Full SDLC with review and documentation
bunx tsx adws/adwSdlc.tsx 789
# ADW plans, builds, tests, reviews, and documents the solution
# Creates comprehensive documentation in app_docs/
```

### Run individual phases
```bash
# Plan only
bunx tsx adws/adwPlan.tsx 789

# Build based on existing plan
bunx tsx adws/adwBuild.tsx 789 <adw-id>
```

### Enable automatic processing
```bash
# Start cron monitoring
bunx tsx adws/triggers/trigger_cron.ts
# New issues are processed automatically
# Users can comment "adw" to trigger processing
```

### Deploy webhook for instant response
```bash
# Start webhook server
bunx tsx adws/triggers/trigger_webhook.ts
# Configure in GitHub settings
# Issues processed immediately on creation
```

## Troubleshooting

### Environment Issues
```bash
# Check required variables
env | grep -E "(GITHUB|ANTHROPIC|CLAUDE)"

# Verify GitHub auth
gh auth status

# Test Claude Code
claude --version
```

### Common Errors

**"Claude Code CLI is not installed"**
```bash
which claude  # Check if installed
# Reinstall from https://docs.anthropic.com/en/docs/claude-code
```

**"Missing GITHUB_PAT"** (Optional - only needed if using different account than 'gh auth login')
```bash
export GITHUB_PAT=$(gh auth token)
```

**"Agent execution failed"**
```bash
# Check agent output
cat agents/*/sdlc_planner/raw_output.jsonl | tail -1 | jq .
```

### Debug Mode
```bash
export ADW_DEBUG=true
bunx tsx adws/adwPlanBuild.tsx 123  # Verbose output
```

## Configuration

### ADW Tracking
Each workflow run gets a unique 8-character ID (e.g., `a1b2c3d4`) that appears in:
- Issue comments: `a1b2c3d4_ops: ✅ Starting ADW workflow`
- Output files: `agents/a1b2c3d4/sdlc_planner/raw_output.jsonl`
- Git commits and PRs

### Model Selection
Edit `agents/claudeAgent.ts` to change model:
- `model: "sonnet"` - Faster, lower cost (default)
- `model: "opus"` - Better for complex tasks

### Modular Architecture
The system uses a modular TypeScript architecture with composable scripts:

- **State Management**: `core/agentState.ts` manages workflow state and chaining
- **Git Operations**: Centralized git operations in `github/gitOperations.ts`
- **Workflow Phases**: Phase implementations in `phases/` directory
- **Agent Integration**: Standardized Claude Code CLI interface in `agents/claudeAgent.ts`
- **Type Definitions**: TypeScript types in `core/dataTypes.ts`, `core/agentTypes.ts`, `core/workflowTypes.ts`

### Orchestrator Composition
Orchestrators combine phases internally, managing state between each step:
```bash
# Use an orchestrator that combines the phases you need
bunx tsx adws/adwPlanBuild.tsx 123              # plan + build
bunx tsx adws/adwPlanBuildTest.tsx 123           # plan + build + test
bunx tsx adws/adwPlanBuildReview.tsx 123         # plan + build + review
bunx tsx adws/adwPlanBuildDocument.tsx 123       # plan + build + document
bunx tsx adws/adwPlanBuildTestReview.tsx 123     # plan + build + test + review
bunx tsx adws/adwSdlc.tsx 123                   # plan + build + test + review + document
```

### Workflow Output Structure

Each ADW workflow creates an isolated workspace:

```
agents/
└── {adwId}/                     # Unique workflow directory
    ├── adw_state.json            # Persistent state file
    ├── {adwId}_plan_spec.md     # Implementation plan
    ├── planner/                  # Planning agent output
    │   └── raw_output.jsonl      # Claude Code session
    ├── implementor/              # Implementation agent output
    │   └── raw_output.jsonl
    ├── tester/                   # Test agent output
    │   └── raw_output.jsonl
    ├── reviewer/                 # Review agent output
    │   ├── raw_output.jsonl
    │   └── review_img/           # Screenshots directory
    ├── documenter/               # Documentation agent output
    │   └── raw_output.jsonl
    └── patch_*/                  # Patch resolution attempts

app_docs/                         # Generated documentation
└── features/
    └── {feature_name}/
        ├── overview.md
        ├── technical-guide.md
        └── images/
```

## Security Best Practices

- Store tokens as environment variables, never in code
- Use GitHub fine-grained tokens with minimal permissions
- Set up branch protection rules
- Require PR reviews for ADW changes
- Monitor API usage and set billing alerts

## Technical Details

### Core Components

**Agents** (`agents/`):
- `claudeAgent.ts` - Claude Code CLI integration
- `planAgent.ts` - Planning agent implementation
- `buildAgent.ts` - Build/implementation agent
- `testAgent.ts` - Testing agent
- `reviewAgent.ts` - Review agent
- `gitAgent.ts` - Git operations agent (branch name, commit)
- `patchAgent.ts` - Patch/quick-fix agent
- `prAgent.ts` - Pull request creation agent
- `documentAgent.ts` - Documentation generation agent
- `tokenManager.ts` - Token count management

**Core** (`core/`):
- `agentTypes.ts` - Agent type definitions
- `agentState.ts` - State management for workflow chaining
- `workflowTypes.ts` - Workflow-related types
- `dataTypes.ts` - General data type definitions
- `config.ts` - Configuration management
- `projectConfig.ts` - Target repo `.adw/` project configuration loader
- `utils.ts` - Utility functions
- `issueClassifier.ts` - Issue classification logic

**GitHub** (`github/`):
- `githubApi.ts` - Core GitHub API wrapper
- `gitOperations.ts` - Git command operations (branching, commits, PRs)
- `issueApi.ts` - GitHub issue API operations
- `prApi.ts` - Pull request API operations
- `pullRequestCreator.ts` - PR creation logic
- `workflowCommentsBase.ts` - Workflow comment management

**Phases** (`phases/`):
- `planPhase.ts` - Planning phase implementation
- `buildPhase.ts` - Build phase implementation
- `testPhase.ts` - Testing phase implementation
- `prPhase.ts` - PR creation phase implementation
- `documentPhase.ts` - Documentation phase implementation
- `prReviewPhase.ts` - PR review phase implementation

**Orchestrators** (root `.tsx` files):
- `adwPlan.tsx` - Planning phase workflow
- `adwBuild.tsx` - Implementation phase workflow
- `adwTest.tsx` - Standalone testing workflow
- `adwDocument.tsx` - Standalone documentation workflow
- `adwPatch.tsx` - Standalone direct patch workflow
- `adwPrReview.tsx` - Standalone PR review orchestration
- `adwPlanBuild.tsx` - Plan + build orchestration
- `adwPlanBuildTest.tsx` - Plan + build + test orchestration
- `adwPlanBuildReview.tsx` - Plan + build + review orchestration
- `adwPlanBuildDocument.tsx` - Plan + build + document orchestration
- `adwPlanBuildTestReview.tsx` - Plan + build + test + review orchestration
- `adwSdlc.tsx` - Full SDLC orchestration (plan + build + test + review + document)
- `adwInit.tsx` - Initialize `.adw/` project configuration in target repos

**Triggers** (`triggers/`):
- `trigger_cron.ts` - Cron-based polling monitor
- `trigger_webhook.ts` - Webhook-based event handler

### Branch Naming
```
{type}-{issueNumber}-{adwId}-{slug}
```
Example: `feat-456-e5f6g7h8-add-user-authentication`

### Project Configuration (`.adw/` Directory)

Target repositories can provide project-specific configuration in a `.adw/` directory. When present, ADW slash commands read from these files instead of using hardcoded defaults. When the `.adw/` directory is absent, all commands fall back to backward-compatible defaults.

**Configuration Files:**

- **`.adw/commands.md`** — Maps command placeholders to actual implementations using markdown headings:
  - `## Package Manager` — e.g., `bun`, `pip`, `cargo`
  - `## Install Dependencies` — e.g., `bun install`, `pip install -r requirements.txt`
  - `## Run Linter` — e.g., `bun run lint`, `ruff check .`
  - `## Type Check` — e.g., `bunx tsc --noEmit`, `mypy .`
  - `## Additional Type Checks` — Extra type checking commands
  - `## Run Tests` — e.g., `bun run test`, `pytest`
  - `## Run Build` — e.g., `bun run build`, `cargo build`
  - `## Start Dev Server` — e.g., `bun run dev`, `python manage.py runserver`
  - `## Prepare App` — Multi-step app preparation instructions (supports `{PORT}` placeholder)
  - `## Run E2E Tests` — e.g., `bunx playwright test`, `cypress run`
  - `## Library Install Command` — e.g., `bun install`, `pip install`
  - `## Script Execution` — e.g., `bunx tsx`, `python`

- **`.adw/project.md`** — Describes the project structure and context:
  - `## Project Overview` — Brief description of the project, language, and framework
  - `## Relevant Files` — File paths and descriptions for planning commands
  - `## Framework Notes` — Framework-specific instructions for the ADW
  - `## Library Install Command` — How to install new libraries
  - `## Script Execution` — How to run project scripts

- **`.adw/conditional_docs.md`** — Defines conditional documentation paths and conditions for the target project's module boundaries

**Bootstrapping:**

Use the `/adw_init` command (via `adwInit.tsx`) to automatically generate `.adw/` configuration for a target repository:

```bash
# Initialize .adw/ config for issue #42
bunx tsx adws/adwInit.tsx 42

# Initialize for a target repo
bunx tsx adws/adwInit.tsx 42 --target-repo https://github.com/owner/repo
```

The init command analyzes the target codebase to detect language, framework, package manager, and project conventions, then generates all three config files.

**Examples by Project Type:**

| Project Type | Package Manager | Run Tests | Start Dev Server |
|---|---|---|---|
| Node.js/Next.js | `bun` | `bun run test` | `bun run dev` |
| Python/Django | `pip` | `pytest` | `python manage.py runserver` |
| Rust | `cargo` | `cargo test` | `cargo run` |
| Go | `go` | `go test ./...` | `go run .` |

**Runtime Loading:**

The `projectConfig.ts` module loads configuration during `initializeWorkflow()`. The `ProjectConfig` object is stored in `WorkflowConfig` and available throughout the workflow. The `loadProjectConfig(targetRepoPath)` function:
1. Checks for `.adw/` directory at the target repo path
2. Parses each markdown file using heading-based section extraction
3. Returns defaults matching current hardcoded values when files are absent
