# State and Config

## Overview

This module provides file-based agent state persistence and all configuration loading for ADW workflows. It centralises two concerns: tracking the runtime lifecycle of each agent (state files, execution logs, process liveness) and supplying typed configuration drawn from `.env`, target-repo `.adw/` markdown files, and `.github/adw.yml`.

## Responsibilities

- **Agent state management** (`agentState.ts`): initialises per-agent directories under `agents/{adwId}/{agentIdentifier}/`, writes and merges `state.json`, appends timestamped `execution.log` entries, writes raw JSON/JSONL output files, and reads parent-agent state by walking up the directory tree.
- **Top-level workflow state** (`agentState.ts`): reads and writes `agents/{adwId}/state.json` as a separate, workflow-scoped file; deep-merges the `phases` map so individual phase entries are updated without clobbering siblings; all writes are atomic (write-tmp then rename).
- **State helpers** (`stateHelpers.ts`): finds the correct orchestrator state path for an ADW ID by scanning subdirectories for agents whose `state.json` names end in `-orchestrator`; disambiguates multiple orchestrator dirs (e.g. a failed `init-orchestrator` shadowing the real run) by matching against the top-level `orchestratorScript` field. Also creates and completes `AgentExecutionState` objects, and checks OS-level process liveness via PID + start-time.
- **Project config loading** (`projectConfig.ts`): reads `.adw/commands.md`, `.adw/project.md`, `.adw/conditional_docs.md`, `.adw/review_proof.md`, `.adw/providers.md`, and `.adw/scenarios.md` from a target repository; parses each file's `## Heading` sections into typed config structs; returns fully populated `ProjectConfig` with sensible defaults when any file is absent.
- **ADW YAML config** (`adwYmlConfig.ts`): reads and parses `.github/adw.yml` from the target worktree root for two policy flags — `hitl` (human-in-the-loop auto-merge gate) and `unitTests` (unit-test phase gate). Creates the file from a commented template when absent, but never overwrites an existing file.
- **Environment and path constants** (`environment.ts`, re-exported via `config.ts`): loads `.env`, resolves and caches the Claude CLI executable path, exposes provider secrets (GitHub, Jira, GitLab, Cloudflare/R2, Cost API), derives all directory constants (`LOGS_DIR`, `SPECS_DIR`, `AGENTS_STATE_DIR`, `WORKTREES_DIR`, `TARGET_REPOS_DIR`) relative to `process.cwd()`, and builds a filtered subprocess environment that strips secrets not on the allowlist.
- **Numeric and timing constants** (`config.ts`): exports retry limits (`MAX_TEST_RETRY_ATTEMPTS`, `MAX_REVIEW_RETRY_ATTEMPTS`, `MAX_VALIDATION_RETRY_ATTEMPTS`), concurrency caps (`MAX_CONCURRENT_PER_REPO`), token budget constants, heartbeat intervals, pause/resume probe intervals, and comment display flags — all overridable via environment variables.
- **Orchestrator identifier constants** (`constants.ts`): exports the `OrchestratorId` map of canonical agent identifier strings and the `MAX_AUTO_MERGE_ATTEMPTS` limit, eliminating magic string literals for orchestrator names across the codebase.

## Contracts & Invariants

- `AgentStateManager.writeState` shallow-merges new state over existing state; callers cannot atomically replace the full object via this method.
- `AgentStateManager.writeTopLevelState` is atomic (write-to-tmp then `fs.renameSync`) and deep-merges the `phases` sub-map so sibling phases are never clobbered.
- `findOrchestratorStatePath` returns the orchestrator whose `state.json` has `agentName` ending in `-orchestrator`; when multiple candidates exist it prefers the one matching `orchestratorScript` in the top-level state, falling back to the first candidate.
- `isAgentProcessRunning` requires both `pid` and `pidStartedAt` in the orchestrator state; a missing either field returns `false` (no stale-PID false-positives).
- `loadProjectConfig` returns defaults for any missing `.adw/` file; it never throws for absent or unreadable config files.
- `readAdwYmlConfig` defaults to `{ hitl: false, unitTests: true }` for absent or unreadable files; malformed scalar values fall back to the per-key default and emit a warn log.
- `writeAdwYmlTemplateIfAbsent` is idempotent and never overwrites an existing file (operator policy is durable).
- `getSafeSubprocessEnv` passes only the explicitly allowlisted variables to Claude CLI subprocesses, preventing secret leakage.
- `REPO_ROOT` is derived from `import.meta.url` (file location), not `process.cwd()`, so it remains correct regardless of the working directory at launch.
- `assertCwdIsRepoRoot` exits the process with a fatal error if `process.cwd()` does not match `REPO_ROOT`; it must be called at every trigger entry point.

## Configuration

All numeric constants in `config.ts` are overridable via environment variables of the same name (e.g. `MAX_TEST_RETRY_ATTEMPTS`, `MAX_THINKING_TOKENS`, `AGENT_DEFAULT_TIMEOUT_MS`). Provider secrets and directory paths are read from a `.env` file at the project root via `dotenv`. The Claude CLI path resolves from `CLAUDE_CODE_PATH` env var, then falls back to `which claude`.

Target-repo configuration is file-driven: create `.adw/commands.md`, `.adw/project.md`, `.adw/providers.md`, `.adw/scenarios.md`, `.adw/review_proof.md`, and/or `.adw/conditional_docs.md` in the target repository using `## Section Heading` markdown format. Policy flags are set in `.github/adw.yml` in the target repository.

## Gotchas

- `LOGS_DIR`, `SPECS_DIR`, `AGENTS_STATE_DIR`, and `WORKTREES_DIR` are derived from `process.cwd()` at module load time. Launching a trigger from the wrong directory silently produces broken paths; use `assertCwdIsRepoRoot()` to catch this early.
- `AgentStateManager.writeState` does not use atomic rename — only `writeTopLevelState` does. Concurrent writes to per-agent `state.json` can race.
- `isProcessAlive` in `stateHelpers.ts` is deprecated; callers should use `isProcessLive` from `processLiveness.ts` instead, which also validates `pidStartedAt` to avoid PID-reuse false-positives.
- `findOrchestratorStatePath` shadows a failed `init-orchestrator` with the real `sdlc-orchestrator` only when `orchestratorScript` is recorded in top-level state. If that field is missing, the first directory match wins, which may be the wrong orchestrator (see memory note on issue #508).
- `parseMarkdownSections` matches only `##`-level headings. `#` (H1) or `###`+ headings in `.adw/` files are silently ignored.
- `adwYmlConfig.ts` lives outside `.adw/` intentionally so that `/adw_init` regeneration cannot overwrite operator policy.
- `config.ts` is a pure re-export facade; import from `environment.ts` or `modelRouting.ts` directly when tree-shaking matters or side-effects of `dotenv.config()` must be avoided.
