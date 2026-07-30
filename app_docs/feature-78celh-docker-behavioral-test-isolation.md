# Docker Behavioral Test Isolation

## Overview

`test/Dockerfile` and `test/docker-run.sh` run the `@regression` Cucumber BDD suite inside a container as a second, isolated leg of CI, catching bugs that only surface when the repo is mounted read-only and dependencies are installed fresh. The `regression` job in `.github/workflows/regression.yml` runs the host leg first, then this Docker leg.

## Responsibilities

- `test/Dockerfile` — a generic `oven/bun:latest`-based image with Git installed. No ADW source is baked in; the repo is supplied entirely via volume mount at run time.
- `test/docker-run.sh` — builds the image (cached unless `--build` is passed) and runs it, mounting the repo read-only at `/workspace` and an anonymous volume over `/workspace/node_modules` so `bun install` has somewhere writable to install into.
- `.github/workflows/regression.yml` `regression` job — invokes the host suite, then `bun run test:docker:build` and `test/docker-run.sh --tags "@regression"` for the Docker leg.

## Contracts & Invariants

- **`/workspace` is read-only.** `docker-run.sh` mounts `-v "${REPO_ROOT}:/workspace:ro"` by design, for isolation. Anything under test that needs to write scratch state must use `os.tmpdir()` (resolves to `/tmp` in the container) or the dedicated `/tmp/bdd` scratch directory the Dockerfile provisions — never `process.cwd()`. See [feature-lnef5d-mock-infrastructure-layer](feature-lnef5d-mock-infrastructure-layer.md) for the harness-side half of this contract.
- **`node_modules` is the only writable path under `/workspace`.** It's overlaid with an anonymous Docker volume so `bun install --frozen-lockfile` (run at container start, per the Dockerfile `CMD`) can install fresh every run without polluting the host checkout.
- **Safe-directory is pre-configured system-wide.** The Dockerfile runs `git config --system --add safe.directory /workspace` at build time, because the mounted repo is owned by the host/CI-runner UID, which differs from the container user — git ≥2.35.2 otherwise refuses to operate on it ("dubious ownership"). System-level config (rather than a per-user or per-process env var) covers every container user and survives env-sanitized subprocess spawns.
- **The `regression` job is time-bounded.** `timeout-minutes: 15` is set at the job level (covering both the host and Docker legs) so a hang in either leg costs minutes of runner time, not GitHub's 360-minute default.
- **`TEST_RUNTIME=docker`** is set as an image `ENV` so code under test (and the mock harness) can detect the container runtime if it ever needs runtime-specific behavior, though the current fix intentionally avoids branching on it in favor of a runtime-agnostic `os.tmpdir()` scratch location.

## Configuration

- `BDD_TAGS` (default `@regression`) — the Cucumber tag filter, overridable via `--tags` on `docker-run.sh` or `-e BDD_TAGS=...` directly.
- `MOCK_STREAM_DELAY_MS` — forwarded into the container if set on the host, for the Claude CLI stub's streaming delay.
- `--build` — forces an image rebuild even if `adw-bdd-runner:latest` is already cached.
- `--shell` — opens an interactive shell inside the container (entrypoint override) for debugging mount/permission issues.

## Gotchas

- A hang inside the container (e.g. a leaked listening server keeping the event loop alive) does not surface as a normal test failure — `docker run` simply never returns, and without the job-level `timeout-minutes` backstop, GitHub's default 360-minute timeout is the only thing that stops it.
- Every scenario failure inside the container should be checked against the read-only `/workspace` mount before assuming it's a logic bug — an `EROFS` error at a path under `/workspace` almost always means some helper tried to write into the mounted repo tree instead of `os.tmpdir()`/`/tmp/bdd`.
- The image has no ADW source baked in, so a stale cached image (`docker image inspect` hit, no `--build` passed) can mask source changes that aren't otherwise re-triggering `bun install` — pass `--build` when in doubt.
