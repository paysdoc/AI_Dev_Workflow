# Dev Server & Port Management

## Overview

This module manages the full lifecycle of development server processes needed during automated workflows, including port allocation, server startup with health-check probing, graceful teardown, and target repository workspace provisioning. It solves the problem of reliably starting ephemeral dev servers on available ports and cleaning them up after work completes, as well as keeping cloned target repositories up-to-date.

## Responsibilities

- Allocates random available TCP ports from the ephemeral range 10000-60000, retrying up to 10 times on collision (`portAllocator.ts`)
- Substitutes the `{PORT}` placeholder in a start command with the allocated port number
- Spawns a dev server as a detached shell process in a specified working directory
- Probes a configurable health endpoint at 1-second intervals for up to 20 seconds per attempt, retrying startup up to 3 times on health-check timeout
- Falls back to running the work callback even when the server never becomes healthy, logging a warning
- Kills the server process group (SIGTERM then SIGKILL after 5 seconds) in a `finally` block, guaranteeing cleanup regardless of whether the work callback throws
- Derives the authoritative `WorkflowStage` for an ADW run from remote GitHub artifacts (branch existence, PR state) rather than trusting potentially-stale local state files (`remoteReconcile.ts`)
- Applies a mandatory double-read verification against the GitHub API to guard against read-your-write lag, retrying up to 3 times on divergence before falling back to the state-file value
- Clones external target repositories to `~/.adw/repos/{owner}/{repo}/` on first use and fetches latest refs on subsequent uses (`targetRepoManager.ts`)
- Converts HTTPS GitHub clone URLs to SSH format before cloning

## Contracts & Invariants

- `allocateRandomPort` always returns a port that was observed free at the moment of the bind test; callers must accept that the port may be taken by the time `spawnServer` runs (TOCTOU window exists)
- `withDevServer` always calls `work()` — even when all health-check attempts fail — and always kills any running process in `finally`; the work callback's return value is propagated unchanged
- `deriveStageFromRemote` never throws; it returns the state-file fallback (`'starting'` if no state exists) whenever remote reads are inconclusive
- `mapArtifactsToStage` returns `null` (not a stage) when artifacts are insufficient, signaling callers to fall back
- `ensureTargetRepoWorkspace` is idempotent: it clones once and fetches on every subsequent call
- `pullLatestDefaultBranch` is deprecated; all callers must use `fetchLatestRefs` instead

## Configuration

- `DevServerConfig.startCommand`: shell command to start the server; use `{PORT}` as a placeholder for the allocated port
- `DevServerConfig.port`: port number (typically from `allocateRandomPort`)
- `DevServerConfig.healthPath`: URL path polled for a 2xx response (e.g. `"/health"`)
- `DevServerConfig.cwd`: working directory for the server process
- `TARGET_REPOS_DIR` (from `./config`): base directory for cloned target repos; defaults to `~/.adw/repos/`
- Timing constants are module-level exports (`PROBE_INTERVAL_MS`, `PROBE_TIMEOUT_MS`, `MAX_START_ATTEMPTS`, `KILL_GRACE_MS`) and can be inspected in tests but are not overridable at runtime without module replacement

## Gotchas

- No production consumers of `withDevServer` are wired yet; this is infrastructure only
- Port availability is checked by attempting a real TCP bind, not by scanning `/proc` or `ss`; the port can be claimed between the check and the spawn
- The health probe uses the global `fetch`; in Node versions without native `fetch`, the caller must polyfill it
- `spawnServer` calls `proc.unref()`, so the Node process can exit while the child is still running if the caller does not hold a reference; `withDevServer` holds the reference until `finally`
- `remoteReconcile` uses `execWithRetry` (a shell call to `git ls-remote`) for branch checks; this requires the ADW process to have network access and a configured `origin` remote pointing to GitHub
- `fetchLatestRefs` shells out to `gh repo view` to determine the default branch name, meaning a valid `gh` CLI session is required in the working directory's context
- HTTPS clone URLs are silently converted to SSH; if SSH keys are not configured, the clone will fail with an opaque git error
