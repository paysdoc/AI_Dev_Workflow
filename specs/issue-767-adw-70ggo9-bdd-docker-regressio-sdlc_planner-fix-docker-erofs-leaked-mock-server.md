# Bug: BDD Docker regression run — EROFS in read-only `/workspace` fails all scenarios; leaked mock server hangs the job for 6 hours

## Metadata
issueNumber: `767`
adwId: `70ggo9-bdd-docker-regressio`
issueJson: `{"number":767,"title":"BDD Docker regression run: EROFS in read-only /workspace fails all scenarios, leaked mock server hangs job for 6 hours","body":"## Symptom\n\nThe daily `Regression Scenarios` workflow run https://github.com/paysdoc/AI_Dev_Workflow/actions/runs/29986051019 ran for 6 hours and was cancelled by GitHub's default 360-minute job timeout. The tests themselves are fast:\n\n| Time (UTC) | What happened |\n|---|---|\n| 06:45:40–06:45:57 | Host run: 53 scenarios in 17s (11 passed, 42 pending) |\n| 06:45:57–06:46:08 | Docker image build (~11s) |\n| 06:46:08–06:46:11 | Docker run: 53 scenarios in 0.3s — all 53 failed |\n| 06:46:11 → 12:45:46 | 359 minutes of silence, then timeout cancellation |\n\n## Bug 1 — git mock dir is created inside the read-only `/workspace` mount\n\nEvery Docker scenario fails in the `Before` hook with:\n\n```\nError: EROFS: read-only file system, mkdir '/workspace/.tmp-git-mock'\n    at createGitMockDir (/workspace/test/mocks/test-harness.ts:55:3)\n    at setupMockInfrastructure (/workspace/test/mocks/test-harness.ts:135:42)\n```\n\n`test/docker-run.sh` mounts the repo at `/workspace` read-only (by design), but `createGitMockDir` (`test/mocks/test-harness.ts:54`) creates the git-wrapper dir at `join(process.cwd(), '.tmp-git-mock')` — inside the read-only mount. The Dockerfile already provisions `/tmp/bdd` as writable scratch space exactly for this, but the harness does not use it. Broken since the mock-infrastructure layer landed; PR #766 (safe.directory fix) merely unmasked the next failure in line.\n\n## Bug 2 — leaked mock server keeps the container alive for 6 hours\n\nCrash order in `setupMockInfrastructure` (`test/mocks/test-harness.ts:107-147`):\n\n1. `startMockServer()` — HTTP server is now listening\n2. `createGitMockDir()` — throws EROFS\n3. `isSetUp = true` — never reached\n\n`teardownMockInfrastructure` starts with `if (!isSetUp) return;`, so the listening server is never stopped. Each of the 53 scenarios retries setup and leaks another server. The open sockets keep the Bun event loop alive: cucumber prints its summary but the process never exits, `docker run` never returns, and the job hangs until GitHub kills it (job teardown logs show orphan `bash` and `docker` processes being terminated).\n\n## Fixes\n\n1. **Write the git mock dir to a writable location** — `mkdtemp` under `os.tmpdir()` (or `/tmp/bdd` when `TEST_RUNTIME=docker`) instead of `process.cwd()`. Fixes all 53 Docker failures.\n2. **Make `setupMockInfrastructure` crash-safe** — on any setup failure after the mock server starts, stop the server before rethrowing (or track the server handle independently of `isSetUp` so teardown always closes it). Kills the hang class even if a future setup step fails.\n3. **Add `timeout-minutes` (e.g. 15) to the `regression` job** in `.github/workflows/regression.yml` — a real run takes under a minute, so a hang should cost minutes, not 6 hours of runner time.\n\n## Out of scope (separate observation)\n\nThe host run passes only 11 of 53 scenarios; 42 are \"pending\" (undefined/unimplemented steps). That is independent of the Docker breakage and may deserve its own issue.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-07-24T11:45:30Z","comments":[],"actionableComment":null}`

## Bug Description
The daily **Regression Scenarios** GitHub Actions workflow runs the `@regression` Cucumber BDD suite twice: once on the host and once inside a Docker container that mounts the repo read-only at `/workspace`. The Docker leg fails, and the failure mode is a **6-hour hang** that is only stopped by GitHub's default 360-minute job timeout.

There are two distinct defects, both in the BDD mock test harness `test/mocks/test-harness.ts`:

**Bug 1 — EROFS on the read-only mount.** Every Docker scenario fails in the `@regression` `Before` hook with:
```
Error: EROFS: read-only file system, mkdir '/workspace/.tmp-git-mock'
    at createGitMockDir (/workspace/test/mocks/test-harness.ts:55:3)
    at setupMockInfrastructure (/workspace/test/mocks/test-harness.ts:135:42)
```
`createGitMockDir` writes the git-wrapper directory to `join(process.cwd(), '.tmp-git-mock')`. In Docker `process.cwd()` is `/workspace`, which `test/docker-run.sh` mounts read-only (`-v "${REPO_ROOT}:/workspace:ro"`). `mkdirSync` therefore throws `EROFS`, failing all 53 scenarios at setup.

**Bug 2 — leaked mock server hangs the process.** `setupMockInfrastructure` starts the HTTP mock server (`startMockServer()`, line 127) *before* it calls `createGitMockDir()` (line 135). When `createGitMockDir` throws, the function unwinds before reaching `isSetUp = true` (line 146). The corresponding `After` hook calls `teardownMockInfrastructure`, whose first line is `if (!isSetUp) return;` (line 156) — so `stopMockServer()` is never called and the listening server is left open. The open server socket keeps the Bun event loop alive: Cucumber prints its summary, but the process never exits, `docker run` never returns, and the job hangs for ~6 hours until GitHub cancels it.

**Expected behavior:** The Docker regression leg completes in well under a minute — the git mock dir is created in a writable scratch location, scenarios run, and the container process exits cleanly regardless of whether setup succeeded or failed.

**Actual behavior:** All 53 Docker scenarios fail at setup with EROFS, and the container never exits, burning ~6 hours of runner time per daily run.

## Problem Statement
The BDD mock harness (1) writes scratch state into the current working directory, which is a read-only mount in the Docker regression runtime, and (2) is not crash-safe — a failure between "server started" and "`isSetUp = true`" strands a listening HTTP server that the teardown path refuses to close, hanging the process indefinitely. There is also no CI-level guard bounding how long a hung regression job may run.

## Solution Statement
Three surgical changes:

1. **Writable scratch location (Bug 1).** Change `createGitMockDir` to create its temp directory with `mkdtempSync(join(tmpdir(), 'adw-git-mock-'))` instead of `mkdirSync(join(process.cwd(), '.tmp-git-mock'))`. This mirrors the already-correct sibling helper `setupFixtureRepo` (line 202, `mkdtempSync(join(tmpdir(), 'adw-fixture-'))`). `os.tmpdir()` resolves to a writable path on the host and to `/tmp` inside the container (only `/workspace` is mounted read-only), so the write succeeds in both runtimes. It also gives each call a unique directory, removing the latent fixed-name (`​.tmp-git-mock`) collision risk.

2. **Crash-safe setup / unconditional teardown (Bug 2).**
   - Remove the `if (!isSetUp) return;` early-return guard from `teardownMockInfrastructure`. Every cleanup step is already individually guarded (`stopMockServer` checks `activeServer`; `cleanupGitMockDir` checks `gitMockTempDir`; the env restore checks `savedEnv`), so teardown stays idempotent and safe to call at any time — but now it **always closes a server that was left listening by a partial setup**. This is the "track the server handle independently of `isSetUp`" fix: the `After` hook now closes the leaked server.
   - Wrap the body of `setupMockInfrastructure` (everything after `savedEnv` is captured) in a `try/catch`; on any error, `await teardownMockInfrastructure()` and rethrow. This stops the server immediately at the point of failure and restores partially-mutated env vars, making setup self-healing even when it is not driven by a Cucumber `After` hook. Teardown is idempotent, so the subsequent `After`-hook teardown is a safe no-op.

3. **Job timeout (Fix 3).** Add `timeout-minutes: 15` to the `regression` job in `.github/workflows/regression.yml` so any future hang costs minutes, not 6 hours.

A new vitest unit test file exercises all three invariants (writable location, teardown-always-closes-server, setup-crash-safety) as deterministic RED→GREEN regression tests, discovered by the existing `test/mocks/__tests__/**/*.test.ts` include in `vitest.config.ts`.

## Steps to Reproduce
1. Build and run the Docker regression leg the way CI does:
   ```
   bun run test:docker:build
   bash test/docker-run.sh --tags "@regression"
   ```
2. Observe every scenario fail in the `Before` hook with `EROFS: read-only file system, mkdir '/workspace/.tmp-git-mock'` (Bug 1).
3. Observe that after Cucumber prints its summary, the container **does not exit** — `docker run` hangs indefinitely (Bug 2). In CI this is the 6-hour job that GitHub eventually cancels.

(Host-only runs — `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — do *not* reproduce this, because `process.cwd()` is writable on the host; the bug is specific to the read-only `/workspace` mount.)

## Root Cause Analysis
- **Bug 1 root cause:** `createGitMockDir` (`test/mocks/test-harness.ts:53-68`) hard-codes its scratch directory to `join(process.cwd(), '.tmp-git-mock')`. This assumes `process.cwd()` is writable — true on the host, false in the Docker runtime, where `test/docker-run.sh` deliberately mounts the repo root at `/workspace` read-only for isolation. The Dockerfile provisions `/tmp/bdd` (and `/tmp` generally) as the writable scratch area, but the harness never uses it. The correct pattern already exists in the same file (`setupFixtureRepo` uses `mkdtempSync(join(tmpdir(), ...))`); `createGitMockDir` simply did not adopt it.
- **Bug 2 root cause:** `setupMockInfrastructure` mutates shared, process-global resources in a non-transactional order — it starts a listening HTTP server (side effect that must be undone) *before* the fallible `createGitMockDir` step, and only flips the `isSetUp` "commit" flag at the very end. `teardownMockInfrastructure` treats `isSetUp` as the single gate for *all* cleanup, so a failure in the window between "server listening" and "`isSetUp = true`" produces an orphaned server that teardown declines to close. The orphaned server's socket keeps the Bun/libuv event loop alive, so the process never exits. This is a classic "acquire-then-partially-fail with an all-or-nothing release guard" leak: the release must be keyed to *whether each resource was actually acquired*, not to a single end-of-setup flag.
- **Missing backstop:** the `regression` job has no `timeout-minutes`, so it inherits GitHub's 360-minute default — turning a harness hang into 6 hours of wasted runner time.

## Relevant Files
Use these files to fix the bug:

- `test/mocks/test-harness.ts` — **primary fix.** Contains `createGitMockDir` (Bug 1: change scratch dir to `mkdtempSync` under `os.tmpdir()`; drop the now-unused `mkdirSync` import), `setupMockInfrastructure` (Bug 2: wrap post-`savedEnv` body in `try/catch` → teardown-and-rethrow), and `teardownMockInfrastructure` (Bug 2: remove the `if (!isSetUp) return;` guard so cleanup is unconditional/idempotent). The sibling `setupFixtureRepo` (line 196-222) is the reference for the correct `mkdtempSync(join(tmpdir(), ...))` pattern.
- `test/mocks/github-api-server.ts` — no change required, but read for context: `startMockServer` (line 252, guards on `activeServer?.listening`) and `stopMockServer` (line 298, guards on `activeServer`) are the server-lifecycle functions the fix relies on; both are already individually safe to call.
- `features/regression/support/hooks.ts` — no change required; documents the call sites. The `@regression` `Before` hook calls `setupMockInfrastructure()` and the `After` hook calls `teardownMockInfrastructure()`. Cucumber runs the `After` hook even when the `Before` hook throws, so the unconditional-teardown fix takes effect here.
- `.github/workflows/regression.yml` — **Fix 3.** Add `timeout-minutes: 15` to the `regression` job (under `runs-on: ubuntu-latest`).
- `test/Dockerfile` — no change required; read for context. It mounts `/workspace` and provisions `/tmp/bdd`; confirms `/tmp` is writable in the container (so `os.tmpdir()` works). Sets `TEST_RUNTIME=docker`.
- `test/docker-run.sh` — no change required; read for context. Line 89/99 mounts `-v "${REPO_ROOT}:/workspace:ro"`, the source of the read-only cwd.
- `vitest.config.ts` — no change required; confirms the new test file location (`test/mocks/__tests__/**/*.test.ts`) is already in the `include` array and will be run by `bun run test:unit`.
- `.adw/commands.md` — no change; source of the exact validation commands (lint, type-check, build, `test:unit`).
- `.adw/coding_guidelines.md` — no change; the fix must follow these (guard clauses, immutability, side-effect isolation at boundaries, remove unused imports, files < 300 lines — `test-harness.ts` stays well under).

### New Files
- `test/mocks/__tests__/test-harness.test.ts` — vitest unit tests that reproduce and lock down both bugs. Placed under `test/mocks/__tests__/` to match the existing `manifestInterpreter.test.ts` and the `vitest.config.ts` include glob. Tests (all black-box via exported functions):
  1. **Bug 1 — writable scratch location:** call `setupMockInfrastructure()`, read the git-mock dir from the first `PATH` segment (`process.env.PATH.split(':')[0]`), assert it is **not** under `process.cwd()` and **is** under `os.tmpdir()` and exists; then `teardownMockInfrastructure()`. (RED before fix: dir is `join(process.cwd(), '.tmp-git-mock')`.)
  2. **Bug 2 — teardown always closes the server:** call `startMockServer(0)` directly (models the "server listening but `isSetUp` still false" partial-setup state), then `teardownMockInfrastructure()`, then assert the server is no longer listening (a `fetch` to the returned URL rejects). (RED before fix: the `!isSetUp` guard early-returns and leaves the server up.)
  3. **Bug 2 — setup is crash-safe:** temporarily point `TMPDIR` at a non-existent path so `createGitMockDir`'s `mkdtempSync` throws *after* the server has started, call `setupMockInfrastructure({ port: <fixed> })` and assert it rejects, then assert the fixed port is not listening (`fetch` rejects); restore `TMPDIR` and `teardownMockInfrastructure()` in `finally`. (RED before fix: server leaked on the fixed port.)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Fix Bug 1 — write the git mock dir to a writable location
- In `test/mocks/test-harness.ts`, edit `createGitMockDir` (line 53): replace the two lines
  ```ts
  const tempDir = join(process.cwd(), '.tmp-git-mock');
  mkdirSync(tempDir, { recursive: true });
  ```
  with
  ```ts
  const tempDir = mkdtempSync(join(tmpdir(), 'adw-git-mock-'));
  ```
  (`mkdtempSync` creates the directory atomically, so the separate `mkdirSync` call is no longer needed. `mkdtempSync` and `tmpdir` are already imported.)
- Remove the now-unused `mkdirSync` from the `fs` import on line 9 (`import { mkdtempSync, cpSync, writeFileSync, existsSync } from 'fs';`). Verify no other reference to `mkdirSync` remains in the file.
- Leave `cleanupGitMockDir` unchanged — it already `rm -rf`s `gitMockTempDir` regardless of location.

### 2. Fix Bug 2a — make teardown unconditional (always close the server)
- In `test/mocks/test-harness.ts`, in `teardownMockInfrastructure`, delete the `if (!isSetUp) return;` guard (line 156). The remaining body already guards each resource individually (`stopMockServer` → `activeServer`, `cleanupGitMockDir` → `gitMockTempDir`, env restore → `savedEnv`), so it stays idempotent and safe to call when nothing was set up, while now always closing a server left listening by a partial setup.
- Keep the closing `isSetUp = false;` line so the flag is reset.
- Update the function's doc comment if needed so it still accurately reads "Safe to call multiple times." (it remains true).

### 3. Fix Bug 2b — make setup self-heal on failure
- In `test/mocks/test-harness.ts`, in `setupMockInfrastructure`, wrap the body that runs **after** `savedEnv = { ... }` (i.e. from `startMockServer(...)` through `return buildContext(port);`) in a `try { ... } catch (err) { await teardownMockInfrastructure(); throw err; }`.
- Rationale: if any step after the server starts throws (Bug 1's EROFS, or any future step), the server is stopped immediately and partially-mutated env is restored, before the error propagates to the `Before` hook. Teardown is idempotent, so the follow-up `After`-hook teardown is a safe no-op.
- Do not change the early `if (isSetUp) { ... return buildContext(existingPort); }` idempotency branch (it is before the `try`).

### 4. Fix Fix 3 — bound the CI job runtime
- In `.github/workflows/regression.yml`, add `timeout-minutes: 15` to the `regression` job, directly under `runs-on: ubuntu-latest` (job-level, not step-level), so the whole job — including the Docker leg — is capped.

### 5. Add regression tests
- Create `test/mocks/__tests__/test-harness.test.ts` using vitest (`describe`/`it`/`expect`/`afterEach`), mirroring the style of `test/mocks/__tests__/manifestInterpreter.test.ts`.
- Import `setupMockInfrastructure`, `teardownMockInfrastructure` from `../test-harness.ts` and `startMockServer` from `../github-api-server.ts`.
- Add an `afterEach(async () => { await teardownMockInfrastructure(); })` to reset module-level state between tests.
- Implement the three tests described in **New Files** above (Bug 1 writable location; Bug 2a teardown-closes-server; Bug 2b setup-crash-safe). Use `fetch(url).then(() => true).catch(() => false)` to probe whether a server is still listening; for the crash-safe test, save/restore `process.env.TMPDIR` in a `finally` block and pass a fixed `{ port }` so the leaked port is known.
- Confirm each test would fail against the unpatched harness (RED) and passes after the fix (GREEN).

### 6. Validate
- Run every command in **Validation Commands** and confirm all pass with zero regressions. In particular, confirm the new vitest tests pass, the host `@regression` Cucumber run still behaves as before (11 passing / 42 pending, process exits), and — where Docker is available — the Docker leg now completes in under a minute and the container exits.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Commands are taken from `.adw/commands.md`.

- `bun run lint` — lint passes (confirms no unused `mkdirSync` import and no style violations).
- `bunx tsc --noEmit` — repo type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional type-check passes.
- `bun run build` — build succeeds with no errors.
- `bun run test:unit` — vitest runs and **the new `test/mocks/__tests__/test-harness.test.ts` tests pass** (RED before the fix, GREEN after), with zero regressions in existing unit tests.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — host regression suite still runs and the **process exits cleanly** (proves the harness change does not break the host path or leave the event loop alive). Expect the pre-existing 11 passing / 42 pending split (the 42 pending steps are explicitly out of scope for this issue).
- **Docker reproduction (requires a Docker daemon)** — the real end-to-end proof:
  - `bun run test:docker:build`
  - `bash test/docker-run.sh --tags "@regression"` — **before the fix**: all 53 scenarios fail with `EROFS ... mkdir '/workspace/.tmp-git-mock'` and the container hangs (never returns). **After the fix**: scenarios run without the EROFS error and the container **exits within seconds/under a minute**. If Docker is unavailable in the execution environment, note this explicitly; the vitest crash-safety test (`test:unit`) covers the same leaked-server invariant deterministically without Docker.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): the fix follows guard-clause / early-return style, isolates side effects at the boundary (setup acquires, teardown releases, release keyed per-resource), keeps `test-harness.ts` well under the 300-line limit, and removes the dead `mkdirSync` import (code hygiene). No decorators, no new libraries.
- **No new libraries** — the fix uses only `fs`/`os` built-ins already imported. Per `.adw/commands.md`, the library install command would be `bun add <package>` if one were needed, but none is.
- **`os.tmpdir()` vs `/tmp/bdd`:** the issue offers `/tmp/bdd` when `TEST_RUNTIME=docker` as an alternative. This plan uses `os.tmpdir()` unconditionally because (a) it resolves to a writable path in *both* runtimes (`/tmp` in the container — only `/workspace` is `:ro`), (b) it matches the already-correct `setupFixtureRepo` helper in the same file, and (c) it avoids a runtime branch. `/tmp/bdd` remains provisioned by the Dockerfile and continues to work as scratch space; no change to it is required.
- **Why unconditional teardown is safe:** `stopMockServer` (`github-api-server.ts:298`) checks `if (activeServer)`, `cleanupGitMockDir` checks `if (gitMockTempDir && existsSync(...))`, and the env restore checks `if (savedEnv)`. Removing the single `!isSetUp` gate cannot cause a double-close or throw when nothing was set up; it only *adds* the ability to close a server orphaned by a partial setup.
- **Cucumber After-hook semantics:** Cucumber runs `@regression` `After` hooks even when the `Before` hook throws, so fix 2a (unconditional teardown) is sufficient on its own to stop the leaked server in CI; fix 2b (setup self-heals) is defense-in-depth that also covers non-Cucumber callers and restores partially-mutated env immediately.
- **Conditional docs:** `.adw/conditional_docs.md` flags three entries whose conditions match this task — `feature-lnef5d-mock-infrastructure-layer.md`, `feature-6bi1qq-fixture-repo-test-harness.md`, and `feature-78celh-docker-behavioral-test-isolation.md`. The corresponding files under `app_docs/` are **not present in this worktree**, so the code itself (`test/mocks/`, `test/Dockerfile`, `test/docker-run.sh`) is the source of truth for this fix.
- **Out of scope:** the 42 "pending" host scenarios (undefined/unimplemented steps) are an independent observation and are not addressed here; they may warrant a separate issue.
