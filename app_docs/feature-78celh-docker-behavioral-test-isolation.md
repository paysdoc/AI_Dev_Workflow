# Docker Image for Behavioral Test Isolation

**ADW ID:** 78celh-docker-image-for-beh
**Date:** 2026-03-25
**Specification:** specs/issue-281-adw-78celh-docker-image-for-beh-sdlc_planner-docker-behavioral-test-isolation.md

## Overview

A generic Docker image (`adw-bdd-runner:latest`) that provides an isolated runtime for the full Cucumber BDD test suite. The image ships only Bun and Git — all project source files are volume-mounted at run time — making it reusable by any repo that uses the same Bun + Cucumber testing pattern. A `TEST_RUNTIME=docker` environment variable and `test/docker-run.sh` wrapper script let developers and CI switch between host and container execution without changing any test code.

## What Was Built

- `test/Dockerfile` — minimal Docker image based on `oven/bun:latest` with Git installed
- `test/.dockerignore` — minimal build context (no source files copied into the image)
- `test/docker-run.sh` — wrapper script that builds the image, mounts the repo, and runs Cucumber
- `features/docker_behavioral_test_isolation.feature` — BDD scenarios validating the Docker runtime
- `features/step_definitions/dockerBehavioralTestIsolationSteps.ts` — step definitions for Docker scenarios
- `package.json` — two new scripts: `test:docker` and `test:docker:build`
- `.github/workflows/regression.yml` — optional `runtime` input for `workflow_dispatch` to run tests in Docker

## Technical Implementation

### Files Modified

- `test/Dockerfile`: new file; `oven/bun:latest` base, installs `git`, creates `/workspace` and `/tmp/bdd`, sets `BDD_TAGS` and `TEST_RUNTIME` env vars, CMD runs `bun install --frozen-lockfile && cucumber-js`
- `test/.dockerignore`: new file; excludes `node_modules/`, `.git/`, `projects/`, `specs/`, `app_docs/`, `.env` from build context
- `test/docker-run.sh`: new executable script; handles `--tags`, `--build`, `--shell` flags; mounts repo root read-only at `/workspace`; mounts anonymous volume over `/workspace/node_modules` for writable `bun install` target; forwards `TEST_RUNTIME`, `BDD_TAGS`, `MOCK_STREAM_DELAY_MS`
- `package.json`: added `test:docker` (`bash test/docker-run.sh`) and `test:docker:build` (`docker build -t adw-bdd-runner:latest -f test/Dockerfile test/`) scripts
- `.github/workflows/regression.yml`: added `runtime` choice input (`host` | `docker`); two conditional steps build the image and run `@regression` scenarios in Docker when `runtime == 'docker'`
- `features/docker_behavioral_test_isolation.feature`: BDD scenarios tagged `@docker-isolation @adw-78celh-docker-bdd` validating image build, Bun/Git availability, workspace mount, and test-suite equivalence
- `features/step_definitions/dockerBehavioralTestIsolationSteps.ts`: step definitions using `spawnSync('docker', [...])` to drive container lifecycle from the host

### Key Changes

- The Docker image is intentionally **generic** — no ADW code is baked in; all project files arrive via `-v "${REPO_ROOT}:/workspace:ro"` at run time
- An anonymous Docker volume (`-v /workspace/node_modules`) overlays the read-only mount so `bun install` can write `node_modules/` without touching the host checkout
- `test/docker-run.sh` pre-flight checks that `docker` is on PATH and exits with a clear error if not
- The `--shell` flag overrides the container entrypoint to `/bin/bash` for interactive debugging
- CI Docker execution is **opt-in**: the existing host-based steps remain the default; the Docker path only runs when `runtime == 'docker'` is selected at `workflow_dispatch`

## How to Use

### Build the image

```bash
bun run test:docker:build
# or explicitly:
docker build -t adw-bdd-runner:latest -f test/Dockerfile test/
```

### Run the full regression suite inside Docker

```bash
bun run test:docker
```

### Run a specific tag subset

```bash
bash test/docker-run.sh --tags "@mock-infrastructure"
```

### Force image rebuild

```bash
bash test/docker-run.sh --build --tags "@regression"
```

### Open an interactive shell for debugging

```bash
bash test/docker-run.sh --shell
```

### Run via CI (workflow_dispatch)

Select `docker` in the **runtime** input when manually triggering the `regression.yml` workflow on GitHub Actions.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `BDD_TAGS` | `@regression` | Cucumber tag filter passed to `cucumber-js` |
| `TEST_RUNTIME` | `docker` (set automatically by the script) | Signals to test code that it is running inside Docker |
| `MOCK_STREAM_DELAY_MS` | _(unset)_ | Optional delay forwarded to the Claude CLI stub |

No `.env` changes are required — the wrapper script sets `TEST_RUNTIME=docker` automatically.

## Testing

Run the Docker-specific BDD scenarios from the host:

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@docker-isolation"
```

These scenarios validate that the image builds, that Bun and Git are available inside the container, that the mounted workspace is readable, and that a sample `@mock-infrastructure` scenario produces the same exit code as on the host.

## Notes

- The image is **reusable** by other repos that use Bun + Cucumber — it ships no ADW-specific content
- `bun install --frozen-lockfile` runs inside the container on a writable overlay; the host `bun.lock` is never modified
- GitHub Actions `ubuntu-latest` runners have Docker pre-installed, so the Docker runtime path is zero-setup in CI
- Future consideration (out of scope): publish the image to GHCR to avoid per-run builds in CI
