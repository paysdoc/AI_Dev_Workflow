# Health Check

## Overview

The health check module is a standalone diagnostic tool that validates the ADW system's operating environment before a workflow starts. It constructs a self-host `GitContext` at the entry point and routes every git probe through context methods; the two GitHub-forge probes (authenticated-user check, issue fetch) route through `createGhRepoApi(ctx)` instead, since `GitContext` itself carries no forge semantics. It checks required binaries, credentials, git configuration, directory structure, and issue accessibility, reporting a structured `HealthCheckResult` with per-check details, warnings, and errors.

## Responsibilities

- Check required environment variables (`ANTHROPIC_API_KEY`) and optional ones (`CLAUDE_CODE_PATH`, `GITHUB_PAT`) via `checkEnvironmentVariables`.
- Validate git repository configuration (`.git` presence, remote listing, user identity) via `checkGitRepository(ctx)` — routes through `ctx.getCurrentBranch`, `ctx.remotes`, `ctx.hasUncommittedChanges`, and `ctx.gitConfigUser`.
- Verify the Claude Code CLI binary is resolvable and returns a version via `checkClaudeCodeCLI`.
- Check GitHub CLI (`gh`) installation and authentication status via `checkGitHubCLI(ctx)` — routes authentication through `createGhRepoApi(ctx).authenticatedUser()`.
- Check expected directory structure (`logs/`, `specs/`, `.claude/commands/`) via `checkDirectoryStructure`.
- Fetch and validate a specific GitHub issue number via `checkIssueNumber(issueNumber, ctx)` — routes through `createGhRepoApi(ctx).fetchIssue(issueNumber)`.
- Construct a self-host `GitContext` once in `main()` via `gitContextForRepo(readLocalRepoInfo(), { selfHost: true })` and pass it into the three git/gh-touching predicates.
- Degrade gracefully when `GitContext` construction fails (token not resolvable): record a `gitContext` check failure, mark `success: false`, and still run the three context-independent checks (`checkEnvironmentVariables`, `checkClaudeCodeCLI`, `checkDirectoryStructure`).
- Aggregate all checks into a `HealthCheckResult` with a top-level `success` flag, `warnings` list, and `errors` list.
- Export individual check functions and `CheckResult` type for reuse by other modules (including the webhook `/health` endpoint).

## Contracts & Invariants

- `checkGitRepository` returns `success: true` even when there are uncommitted changes or no remote — these conditions produce warnings, not errors.
- `checkGitRepository` catches `ctx.remotes()` throwing (not a git repo) and degrades to `hasRemote: false`, `remotes: []` — never crashes the diagnostic.
- `checkGitHubCLI` returns `success: true` when `gh` is installed even if not authenticated — absence of both authentication and `GITHUB_PAT` is a warning, not a blocking error.
- `checkGitHubCLI` wraps `createGhRepoApi(ctx).authenticatedUser()` in a try/catch; a throw sets `authenticated: false` (not an exception).
- `checkDirectoryStructure` returns `success: true` in all cases; missing `.claude/commands/` is a warning only.
- `checkIssueNumber` returns `success: false` only for invalid issue numbers (NaN or ≤ 0) or unreachable issues; a `createGhRepoApi(ctx).fetchIssue` throw maps to the "not found or not accessible" failure.
- Signatures are unchanged by the `createGhRepoApi` migration: `checkGitHubCLI(ctx: GitContext)` and `checkIssueNumber(issueNumber: number, ctx: GitContext)` still take a `GitContext`, not a forge-api object — they construct `createGhRepoApi(ctx)` internally, once per call.
- Neither `healthCheck.tsx` nor `healthCheckChecks.ts` appears in the git/gh guard `ALLOWLIST` — both files are scanned by `bun run lint:git-guard` with zero violations.

## Configuration

No configuration file. `CLAUDE_CODE_PATH`, `GITHUB_PAT`, `LOGS_DIR`, and `SPECS_DIR` are read from the environment via `adws/core/environment.ts`. The health check is invoked as a standalone script: `bunx tsx adws/healthCheck.tsx <issueNumber>`.

## Gotchas

- **Mandatory-token contract** — `gitContextForRepo` requires a resolvable auth token (App installation → `GH_TOKEN` → `gh auth token`). On a configured ADW host a token always resolves via `gh auth token`. If resolution fails, the entry point catches the throw and records it as a `gitContext` check failure rather than crashing; the three context-independent checks still run.
- **`commandExists` and `execCommand` remain** — `commandExists` uses `which` (not `git`/`gh`) and `execCommand` is used only for `${resolvedPath} --version` (Claude CLI binary probe). Neither is flagged by the git/gh guard.
- **`process.cwd()` is passed explicitly** as the `cwd` argument to every context read (`getCurrentBranch`, `remotes`, `hasUncommittedChanges`, `gitConfigUser`) — preserving "inspect the current working directory's repo" semantics even though the self-host `GitContext`'s `basePath` is the framework repo root.
- **`checkClaudeCodeCLI` resolves the path via `resolveClaudeCodePath()`** from `adws/core/environment.ts`; if neither `CLAUDE_CODE_PATH` nor a `claude` binary on PATH is found, this check fails with the resolver's error message.
- **The webhook `/health` endpoint** (`adws/triggers/trigger_webhook.ts`) also calls `checkGitRepository` and `checkGitHubCLI` with a self-host `GitContext` constructed on-demand. The same construction-failure guard applies there.
