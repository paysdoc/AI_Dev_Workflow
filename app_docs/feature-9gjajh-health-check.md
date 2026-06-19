# Health Check

## Overview

The health check module is a standalone diagnostic tool that validates the ADW system's operating environment before a workflow starts. It checks required binaries, credentials, git configuration, directory structure, and issue accessibility, reporting a structured `HealthCheckResult` with per-check details, warnings, and errors.

## Responsibilities

- Check required environment variables (`ANTHROPIC_API_KEY`) and optional ones (`CLAUDE_CODE_PATH`, `GITHUB_PAT`) via `checkEnvironmentVariables`.
- Validate git repository configuration (`.git` presence, remote config, user identity) via `checkGitRepository`.
- Verify the Claude Code CLI binary is resolvable and returns a version via `checkClaudeCodeCLI`.
- Check GitHub CLI (`gh`) installation and authentication status via `checkGitHubCLI`.
- Check expected directory structure (`logs/`, `specs/`, `.claude/commands/`) via `checkDirectoryStructure`.
- Fetch and validate a specific GitHub issue number via `checkIssueNumber` (uses `gh issue view`).
- Aggregate all checks into a `HealthCheckResult` with a top-level `success` flag, `warnings` list, and `errors` list.
- Export individual check functions and `CheckResult` type for reuse by other modules.

## Contracts & Invariants

- `checkGitRepository` returns `success: true` even when there are uncommitted changes or no remote — these conditions produce warnings, not errors.
- `checkGitHubCLI` returns `success: true` when `gh` is installed even if not authenticated — absence of both authentication and `GITHUB_PAT` is a warning, not a blocking error.
- `checkDirectoryStructure` returns `success: true` in all cases; missing `.claude/commands/` is a warning only.
- `checkIssueNumber` returns `success: false` only for invalid issue numbers (NaN or ≤ 0) or unreachable issues; it uses `gh issue view` and therefore requires `gh` authentication.

## Configuration

No configuration file. `CLAUDE_CODE_PATH`, `GITHUB_PAT`, `LOGS_DIR`, and `SPECS_DIR` are read from the environment via `adws/core/environment.ts`. The health check is invoked as a standalone script: `bunx tsx adws/healthCheck.tsx <issueNumber>`.

## Gotchas

- `checkClaudeCodeCLI` resolves the path via `resolveClaudeCodePath()` from `adws/core/environment.ts`; if neither `CLAUDE_CODE_PATH` nor a `claude` binary on PATH is found, this check fails with the resolver's error message.
- `checkIssueNumber` calls `gh issue view` with `2>&1` piped through `execSync`, so authentication errors appear in the output string rather than as exceptions.
- The health check does not validate that the Claude CLI is authenticated — it only checks that the binary is present and returns a version string.
