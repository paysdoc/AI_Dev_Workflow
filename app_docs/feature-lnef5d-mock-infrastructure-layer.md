# Mock Infrastructure Layer

## Overview

`test/mocks/` provides the mocked external services (GitHub API, git remotes, the Claude CLI) that let Cucumber BDD scenarios drive real ADW code paths without hitting the network or a real `git`/`gh`. `test/mocks/test-harness.ts` is the composition root: it wires the mocks together, exposes `setupMockInfrastructure()`/`teardownMockInfrastructure()` for `Before`/`After` hooks, and manages all scratch state (temp dirs, env var overrides) needed to make that substitution transparent to the code under test.

## Responsibilities

- `setupMockInfrastructure(config?)` — starts the GitHub API mock server, points `CLAUDE_CODE_PATH` at the CLI stub, prepends a temp dir containing a mock `git` wrapper to `PATH`, and sets `GH_TOKEN`/`GH_HOST`/`MOCK_GITHUB_API_URL`/`MOCK_SERVER_PORT` so `gh` and `git` calls route to the mocks. Idempotent — a second call while already set up returns the existing context instead of starting a second server.
- `teardownMockInfrastructure()` — stops the mock server, removes the git-mock temp dir, and restores every environment variable to its pre-setup value.
- `resetMock()` — clears mock server state between scenarios without stopping the server (used when scenarios keep the server running for performance).
- `setupFixtureRepo(fixtureName)` / `teardownFixtureRepo(ctx)` — copies a fixture template (`test/fixtures/{fixtureName}/`) into a fresh `mkdtemp` directory and `git init`s it with the real git binary, for scenarios that need an actual working directory. Must be called after `setupMockInfrastructure()` so `REAL_GIT_PATH` is already set.
- `createGitMockDir` / `cleanupGitMockDir` — create and remove the temp directory holding the `git` wrapper script that delegates to `git-remote-mock.ts` via `bun`.

## Contracts & Invariants

- **All scratch directories are writable in every runtime.** Both `createGitMockDir` and `setupFixtureRepo` use `mkdtempSync(join(tmpdir(), '<prefix>-'))` — never `process.cwd()`. This matters because the Docker regression runtime mounts the repo root read-only at `/workspace` (see [feature-78celh-docker-behavioral-test-isolation](feature-78celh-docker-behavioral-test-isolation.md)); only `os.tmpdir()` (`/tmp`) is writable there.
- **`teardownMockInfrastructure()` is unconditional and idempotent.** It has no `isSetUp` guard — every step it performs (`stopMockServer()`, `cleanupGitMockDir()`, env restore) is individually guarded on the resource it releases (`activeServer`, `gitMockTempDir`, `savedEnv`), so calling it before, during, or after a successful setup is always safe and never double-closes or throws.
- **`setupMockInfrastructure()` is crash-safe.** Everything after `savedEnv` is captured runs inside a `try/catch`; any failure (e.g. the git-mock temp dir can't be created) triggers `await teardownMockInfrastructure()` before the error is rethrown. This guarantees a mock server that started listening is always stopped, even if a later step in the same setup call throws — no code path can leak a running server.
- **Environment mutation is fully reversible.** `savedEnv` snapshots every variable `setupMockInfrastructure` is about to overwrite; teardown restores each one (or deletes it, if it was previously unset) rather than assuming a fixed baseline.

## Configuration

- `MOCK_FIXTURE_PATH`, `MOCK_STREAM_DELAY_MS` — control the Claude CLI stub's canned JSONL output and streaming delay.
- `GH_HOST`, `GH_TOKEN`, `MOCK_GITHUB_API_URL`, `MOCK_SERVER_PORT` — set by `setupMockInfrastructure` to route `gh`/HTTP calls to the mock server; restored by teardown.
- `CLAUDE_CODE_PATH` — overridden to point at `claude-cli-stub.ts` for the duration of the mock session.
- `REAL_GIT_PATH` — the real `git` binary path, resolved before `PATH` is modified, so `setupFixtureRepo` and other real-git callers can bypass the mock wrapper.

## Gotchas

- A setup failure orphaning a listening HTTP server used to hang the whole process (Bun's event loop stays alive on an open socket), which silently turned Docker CI failures into 6-hour job timeouts before this module's crash-safety and unconditional-teardown invariants were added — see the regression job's `timeout-minutes` backstop in [feature-78celh-docker-behavioral-test-isolation](feature-78celh-docker-behavioral-test-isolation.md).
- `createGitMockDir`'s temp dir is prefixed `adw-git-mock-` and is unique per call (via `mkdtempSync`), so there is no fixed-name collision risk between concurrent setups.
- `test/mocks/__tests__/test-harness.test.ts` exercises these invariants directly (writable-location assertion via `os.tmpdir()`, teardown-always-closes-server by calling `startMockServer` directly before teardown, and setup-crash-safety by pointing `TMPDIR` at a non-existent path) — it's the fastest way to reproduce either bug deterministically without Docker.
