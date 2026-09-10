# Health Check

## Overview

The health check module is a standalone diagnostic tool that validates the ADW system's operating environment before a workflow starts. It builds a self-host `LaunchBoundary` at the entry point: git probes route through the boundary's `GitContext` methods, and the two forge probes (authenticated-user check, issue fetch) route through the boundary's `CodeHost`/`IssueTracker` ports (#844) — never a `createGhRepoApi(ctx)` bound view — since `GitContext` itself carries no forge semantics. It checks required binaries, credentials, git configuration, directory structure, and issue accessibility, reporting a structured `HealthCheckResult` with per-check details, warnings, and errors.

## Responsibilities

- Check required environment variables (`ANTHROPIC_API_KEY`) and optional ones (`CLAUDE_CODE_PATH`, `GITHUB_PAT`) via `checkEnvironmentVariables`.
- Validate git repository configuration (`.git` presence, remote listing, user identity) via `checkGitRepository(ctx)` — routes through `ctx.getCurrentBranch`, `ctx.remotes`, `ctx.hasUncommittedChanges`, and `ctx.gitConfigUser`.
- Verify the Claude Code CLI binary is resolvable and returns a version via `checkClaudeCodeCLI`.
- Check GitHub CLI (`gh`) installation and authentication status via `checkGitHubCLI(codeHost: Pick<CodeHost, 'getAuthenticatedUser'>)` (#844) — routes authentication through the port's `getAuthenticatedUser()`, inside a try/catch so a non-GitHub code host that refuses the operation by name (e.g. GitLab) still yields `authenticated: false` rather than an uncaught throw.
- Check expected directory structure (`logs/`, `specs/`, `.claude/commands/`) via `checkDirectoryStructure`.
- Fetch and validate a specific issue number via `checkIssueNumber(issueNumber, issueTracker: Pick<IssueTracker, 'fetchIssue'>): Promise<CheckResult>` (#844, now async) — awaits the port's `fetchIssue(issueNumber)` and fills `details.title/state/exists` from the returned `Issue`; the invalid-issue-number guard runs before the tracker is ever asked.
- Build the self-host `LaunchBoundary` once in `main()` via `buildLaunchBoundary(null, { getRepoInfo: () => readLocalRepoIdentity(REPO_ROOT) })` (#844 — `readLocalRepoIdentity` pins the identity read to `REPO_ROOT` rather than `process.cwd()`); pass `boundary.gitContext` into `checkGitRepository` and `boundary.providers.codeHost`/`.issueTracker` into the two forge probes.
- Degrade gracefully at two independent points: a `GitContext` construction failure (token not resolvable) records a `gitContext` check failure; a lazy-provider-mint failure (e.g. an unrecognised forge name in `.adw/providers.md`) is caught in its own try/catch and records a `providers` check failure instead of crashing the script. Either way `success: false` is set and the context-independent checks (`checkEnvironmentVariables`, `checkClaudeCodeCLI`, `checkDirectoryStructure`) still run.
- Aggregate all checks into a `HealthCheckResult` with a top-level `success` flag, `warnings` list, and `errors` list.
- Export individual check functions and `CheckResult` type for reuse by other modules (including the webhook `/health` endpoint).

## Contracts & Invariants

- `checkGitRepository` returns `success: true` even when there are uncommitted changes or no remote — these conditions produce warnings, not errors.
- `checkGitRepository` catches `ctx.remotes()` throwing (not a git repo) and degrades to `hasRemote: false`, `remotes: []` — never crashes the diagnostic.
- `checkGitHubCLI` returns `success: true` when `gh` is installed even if not authenticated — absence of both authentication and `GITHUB_PAT` is a warning, not a blocking error.
- `checkGitHubCLI` wraps `codeHost.getAuthenticatedUser()` in a try/catch; a throw (a refusing non-GitHub port) or a `null` return both set `authenticated: false` (not an exception).
- `checkDirectoryStructure` returns `success: true` in all cases; missing `.claude/commands/` is a warning only.
- `checkIssueNumber` returns `success: false` only for invalid issue numbers (NaN or ≤ 0, checked before the tracker is called) or a rejected `fetchIssue` — the "Could not resolve"/JSON-parse failure branches from the legacy free-function era no longer exist, since the port returns a typed `Issue` or throws.
- Both forge probes take **port `Pick`s**, not a `GitContext` (#844): `checkGitHubCLI(codeHost: Pick<CodeHost, 'getAuthenticatedUser'>)` and `checkIssueNumber(issueNumber: number, issueTracker: Pick<IssueTracker, 'fetchIssue'>): Promise<CheckResult>` — the latter now async. `checkGitRepository(ctx: GitContext)` is unchanged; git reads stay the core's job.
- Neither `healthCheck.tsx` nor `healthCheckChecks.ts` appears in the git/gh guard `ALLOWLIST` — both files are scanned by `bun run lint:git-guard` with zero violations.

## Configuration

No configuration file. `CLAUDE_CODE_PATH`, `GITHUB_PAT`, `LOGS_DIR`, and `SPECS_DIR` are read from the environment via `adws/core/environment.ts`. The health check is invoked as a standalone script: `bunx tsx adws/healthCheck.tsx <issueNumber>`.

## Gotchas

- **Mandatory-token contract** — `buildLaunchBoundary`'s underlying `GitContext` construction requires a resolvable auth token (App installation → `GH_TOKEN` → `gh auth token`). On a configured ADW host a token always resolves via `gh auth token`. If resolution fails, the entry point catches the throw and records it as a `gitContext` check failure rather than crashing; the three context-independent checks still run.
- **`commandExists` and `execCommand` remain** — `commandExists` uses `which` (not `git`/`gh`) and `execCommand` is used only for `${resolvedPath} --version` (Claude CLI binary probe). Neither is flagged by the git/gh guard.
- **`process.cwd()` is passed explicitly** as the `cwd` argument to every context read (`getCurrentBranch`, `remotes`, `hasUncommittedChanges`, `gitConfigUser`) — preserving "inspect the current working directory's repo" semantics even though the self-host `GitContext`'s `basePath` is the framework repo root.
- **`checkClaudeCodeCLI` resolves the path via `resolveClaudeCodePath()`** from `adws/core/environment.ts`; if neither `CLAUDE_CODE_PATH` nor a `claude` binary on PATH is found, this check fails with the resolver's error message.
- **The webhook `/health` endpoint** (`adws/triggers/trigger_webhook.ts`) also calls `checkGitRepository` (with `selfHostBoundary()?.gitContext`, the same memoised boundary `webhookRepoResolver.ts` uses for other self-host reads, since #822) and `checkGitHubCLI` (with `selfHostBoundary()?.providers.codeHost`, resolved in its own try/catch, since #844). The same construction/mint-failure guard applies there.
