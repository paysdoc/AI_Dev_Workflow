# Chore: Explore Codebase for Architectural Improvement Opportunities

## Metadata
issueNumber: `262`
adwId: `4y4lmi-chore-explore-codeba`
issueJson: `{"number":262,"title":"chore: explore codebase for architectural improvement opportunities","body":"## Description\n\nRun the `improve-codebase-architecture` skill on the ADW codebase to identify shallow modules, tightly-coupled clusters, and opportunities to deepen modules for better testability and AI-navigability.\n\n## Goals\n\n- Explore the codebase organically and surface architectural friction\n- Identify clusters of shallow modules that could be consolidated into deeper, more testable modules\n- Propose module-deepening refactors as RFC issues\n\n## Scope\n\nFocus on the `adws/` directory — agents, phases, core, and providers.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-22T09:52:36Z","comments":[{"author":"paysdoc","createdAt":"2026-03-22T18:56:15Z","body":"## Take action"}],"actionableComment":null}`

## Chore Description
Run the `improve-codebase-architecture` skill on the ADW codebase to identify shallow modules, tightly-coupled clusters, and opportunities to deepen modules for better testability and AI-navigability. Focus on `adws/` — agents, phases, core, and providers. The output is a numbered list of deepening candidates presented to the user for selection, followed by interface design and GitHub RFC issue creation.

## Relevant Files
Use these files to resolve the chore:

- `adws/agents/**` — Agent runner infrastructure and 21 agent implementations. Most agents are thin wrappers around `claudeAgent.ts`. Key coupling: agents import from `core/` for config/logging/state but never from `phases/` or `github/`.
- `adws/phases/**` — 19 phase implementations that are thin orchestrators delegating to agents. Heavy coupling to `WorkflowConfig` and mutable `WorkflowContext`. Repeated cost-tracking and state-management boilerplate across all phases.
- `adws/core/**` — 17 modules including config, state management, orchestrator utilities, project config, workflow comment parsing, issue classification, retry framework. `utils.ts` is a grab bag of 6 unrelated concerns. `index.ts` is a 171-line barrel re-export hub.
- `adws/providers/**` — Provider abstraction layer with `IssueTracker` and `CodeHost` interfaces. GitHub provider is a thin wrapper around `github/` API functions (inconsistent with GitLab/Jira which have their own API clients).
- `adws/github/**` — GitHub API layer with 12 files. Workflow comment files (`workflowComments*.ts`) are split across 4 files for formatting that could be consolidated. `issueApi.ts` and `prApi.ts` mix HTTP wrapping with business logic.
- `adws/vcs/**` — Version control operations split across 7 files. Worktree operations split across 4 files (creation, query, cleanup, operations) that are tightly coupled on the same concept.
- `adws/types/**` — Type definitions in 5 files. `issueTypes.ts` mixes GitHub data models with command classification routing maps. `dataTypes.ts` is just re-exports.
- `adws/*.tsx` — 13 orchestrator scripts with ~95% identical boilerplate (argument parsing, cost aggregation loops, error handling).
- `adws/triggers/**` — Cron and webhook automation with well-bounded modules but no caching layer for repeated GitHub API calls.
- `adws/cost/**` — Cost tracking module with Vitest unit tests. Well-structured with clear boundaries.
- `.claude/skills/improve-codebase-architecture/SKILL.md` — The skill definition that guides the exploration process.
- `.claude/skills/improve-codebase-architecture/REFERENCE.md` — Dependency categories and issue template for RFC creation.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Run the `improve-codebase-architecture` skill

- Invoke the `improve-codebase-architecture` skill using the Skill tool.
- The skill will guide the entire process: exploration, candidate presentation, user selection, interface design, and RFC issue creation.
- The skill's process is interactive — it requires user input at Steps 3 and 6.

**Context to provide the skill**: The codebase has already been explored. The following deepening candidates have been identified through thorough exploration of all `adws/` subdirectories:

#### Candidate 1: Orchestrator Composition Engine
- **Cluster**: `adws/*.tsx` orchestrator scripts (13 files, ~2,000 lines) + `adws/phases/*.ts` (19 files) + `adws/core/orchestratorCli.ts` + `adws/core/orchestratorLib.ts` + `adws/workflowPhases.ts`
- **Why they're coupled**: All 13 orchestrators duplicate identical patterns — argument parsing, workflow initialization, cost aggregation loops (`mergeModelUsageMaps`, `persistTokenCounts`, `commitPhasesCostData`), error handling, and RUNNING_TOKENS updates. The only variation is which phases are called and in what order.
- **Dependency category**: In-process (pure computation, no I/O at the orchestrator layer — phases handle all I/O)
- **Test impact**: Currently untested. A deepened module with a declarative phase sequence could be unit-tested to verify phase ordering, cost accumulation, and recovery behavior without running actual agents.

#### Candidate 2: GitHub Provider Consolidation
- **Cluster**: `adws/providers/github/` (4 files) + `adws/github/` (12 files) + `adws/github/workflowComments*.ts` (4 files)
- **Why they're coupled**: GitHub providers (`githubIssueTracker.ts`, `githubCodeHost.ts`) are thin wrappers that import directly from `github/issueApi.ts`, `github/prApi.ts`, `github/pullRequestCreator.ts`. Unlike GitLab/Jira providers which have their own API clients, GitHub providers just delegate to the pre-existing API layer. The 4 workflow comment files split a single concept (comment formatting) across too many files.
- **Dependency category**: Remote but owned (Ports & Adapters) — GitHub API is a network boundary, but we own both sides. The provider interface already defines the port; the GitHub implementation needs a proper adapter.
- **Test impact**: Could replace current untested thin wrappers with a consolidated `GitHubApiClient` that follows the GitLab/Jira pattern. Boundary tests at the provider interface would verify issue operations, PR operations, and comment formatting.

#### Candidate 3: Workflow State & Recovery Module
- **Cluster**: `adws/core/agentState.ts` + `adws/core/stateHelpers.ts` + `adws/core/workflowCommentParsing.ts` + `adws/core/orchestratorLib.ts` (shouldExecuteStage, getNextStage) + `adws/types/workflowTypes.ts` (WorkflowStage, RecoveryState)
- **Why they're coupled**: Recovery state is built from comment parsing (`detectRecoveryState`), consumed by orchestrator lib (`shouldExecuteStage`), and driven by stage definitions in `workflowTypes.ts`. Agent state management (`AgentStateManager`) writes/reads state that recovery depends on. Understanding recovery requires bouncing between 5 files across 3 directories.
- **Dependency category**: In-process (pure computation for parsing/state logic) + Local-substitutable (file-based state could use in-memory filesystem for tests)
- **Test impact**: Recovery logic is untested. A deepened module could be tested with in-memory state to verify stage progression, recovery detection, and state persistence without file I/O.

#### Candidate 4: Worktree Lifecycle Manager
- **Cluster**: `adws/vcs/worktreeCreation.ts` + `adws/vcs/worktreeQuery.ts` + `adws/vcs/worktreeCleanup.ts` + `adws/vcs/worktreeOperations.ts` + `adws/phases/worktreeSetup.ts`
- **Why they're coupled**: All 5 files operate on the same concept (git worktrees) and share data patterns (worktree paths, branch names, issue numbers). Creation depends on query (check existing), cleanup depends on query (find by pattern), and worktreeSetup in phases crosses the module boundary into vcs concerns.
- **Dependency category**: Local-substitutable (git operations could be tested with a temporary git repository fixture)
- **Test impact**: Currently untested. A unified worktree manager with a clear `create/find/cleanup` interface could be tested with a temporary git repo, verifying the full lifecycle without mocking.

#### Candidate 5: Phase Cost & Progress Tracking
- **Cluster**: `adws/phases/phaseCostCommit.ts` + `adws/phases/phaseCommentHelpers.ts` + `adws/cost/reporting/commentFormatter.ts` + `adws/core/costCommitQueue.ts` + the cost-tracking boilerplate repeated in every phase (`createPhaseCostRecords`, `mergeModelUsageMaps`, `persistTokenCounts`, `commitPhasesCostData`)
- **Why they're coupled**: Every phase repeats the same 5-line cost aggregation ritual. Cost commit, cost formatting, and progress comments are split across 4 files in 3 directories. The `costCommitQueue` serializes operations that `phaseCostCommit` enqueues, while `commentFormatter` formats what `phaseCommentHelpers` posts.
- **Dependency category**: In-process (cost computation) + Remote but owned (GitHub comment posting)
- **Test impact**: Cost tracking boilerplate is untested. A deepened module could own the full cost lifecycle (record → aggregate → format → commit → comment) and be tested at the boundary.

#### Candidate 6: Issue Classification & Routing
- **Cluster**: `adws/core/issueClassifier.ts` + `adws/types/issueTypes.ts` (routing maps: `adwCommandToOrchestratorMap`, `issueTypeToOrchestratorMap`, prefix maps) + `adws/core/workflowMapping.ts`
- **Why they're coupled**: Issue classification (`classifyGitHubIssue`) produces a type that routing maps in `issueTypes.ts` consume. `workflowMapping.ts` uses the same maps to route to orchestrator scripts. The maps live in the types file but contain routing logic, not type definitions.
- **Dependency category**: In-process (pure computation for regex classification) + True external (LLM fallback via Claude agent)
- **Test impact**: Classification regex logic is untested. A deepened module could encapsulate classification + routing with the LLM as an injected port, enabling boundary tests that verify routing for all issue types.

### Step 2: Present candidates to user and await selection

- Present the 6 candidates above as a numbered list with their cluster, coupling rationale, dependency category, and test impact.
- Ask: "Which of these would you like to explore?"
- Wait for user selection before proceeding.

### Step 3: Frame the problem space for the selected candidate

- Write a user-facing explanation of the constraints any new interface would need to satisfy.
- Include the dependencies it would rely on.
- Provide a rough illustrative code sketch to ground the constraints.
- Show this to the user, then immediately proceed to Step 4.

### Step 4: Design multiple interfaces using parallel sub-agents

- Spawn 3+ sub-agents in parallel, each with a different design constraint:
  - Agent 1: "Minimize the interface — aim for 1-3 entry points max"
  - Agent 2: "Maximize flexibility — support many use cases and extension"
  - Agent 3: "Optimize for the most common caller — make the default case trivial"
  - Agent 4 (if applicable): "Design around ports & adapters for cross-boundary dependencies"
- Each sub-agent produces: interface signature, usage example, hidden complexity, dependency strategy, trade-offs.
- Present designs sequentially, compare in prose, and give a strong recommendation.

### Step 5: User picks an interface (or accepts recommendation)

- Wait for user selection.

### Step 6: Create GitHub RFC issue

- Create a refactor RFC issue using `gh issue create` following the template in REFERENCE.md.
- Include: Problem, Proposed Interface, Dependency Strategy, Testing Strategy, Implementation Recommendations.
- Share the issue URL with the user.

### Step 7: Run validation commands

- Run the validation commands below to ensure no regressions were introduced (this chore is exploratory — the only artifact is the GitHub RFC issue, so validation confirms the codebase is unchanged).

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bun run build` - Build the application to verify no build errors
- `bunx tsc --noEmit` - Type check root configuration
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check adws configuration

## Notes
- IMPORTANT: If a `guidelines/` directory exists in the target repository, strictly adhere to those coding guidelines. The `guidelines/coding_guidelines.md` file emphasizes modularity (single responsibility, <300 line files), type safety, and functional programming practices.
- This chore is interactive — it requires user input at Steps 2 and 5 to select candidates and interfaces.
- The primary deliverable is one or more GitHub RFC issues proposing module-deepening refactors, not code changes.
- The exploration has already been completed. The 6 candidates above were identified through thorough analysis of all `adws/` subdirectories (agents, phases, core, providers, github, vcs, types, triggers, cost, and orchestrator scripts).
- Candidate 1 (Orchestrator Composition Engine) has the highest impact — ~1,500 lines of duplicated boilerplate across 13 files could be replaced with a declarative phase sequence configuration.
- Candidate 3 (Workflow State & Recovery) addresses the highest friction — understanding recovery requires bouncing between 5 files across 3 directories.
