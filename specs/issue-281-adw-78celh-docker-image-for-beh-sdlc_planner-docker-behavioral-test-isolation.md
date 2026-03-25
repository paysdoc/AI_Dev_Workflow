# Feature: Docker Image for Behavioral Test Isolation

## Metadata
issueNumber: `281`
adwId: `78celh-docker-image-for-beh`
issueJson: `{"number":281,"title":"Docker image for behavioral test isolation","body":"## Parent PRD\n\n`specs/prd/prd-review-revamp.md`\n\n## What to build\n\nCreate a generic Docker image for running behavioral tests in an isolated environment. The image provides the runtime and tooling; ADW source is mounted or copied at test time.\n\n**Docker image contents:**\n- Bun runtime\n- Git\n- Mock infrastructure (Claude CLI stub, GitHub API mock server, git remote mock)\n- Test runner (Cucumber)\n\n**Key properties:**\n- Generic — not ADW-specific, reusable by other repos\n- Optional — the test suite runs identically on the host without Docker\n- A flag or environment variable switches between Docker and host execution\n- ADW source is mounted as read-only or copied into the container\n- Fixture target repo is initialized inside the container at test time\n\n**Dockerfile** location TBD (e.g., `test/Dockerfile` or `docker/Dockerfile`).\n\nSee PRD sections: \"Docker Image\", \"Test Harness\".\n\n## Acceptance criteria\n\n- [ ] Dockerfile exists and builds successfully\n- [ ] Image includes Bun, Git, and mock infrastructure\n- [ ] Image is generic (no ADW-specific code baked in)\n- [ ] Behavioral test suite runs inside the container and produces the same results as on host\n- [ ] A flag/env var switches between Docker and host execution\n- [ ] Container starts and tears down cleanly\n- [ ] Documentation on how to build and run tests in Docker\n\n## Blocked by\n\n- Blocked by #279 (fixture target repo + test harness + first behavioral review scenario)\n\n## User stories addressed\n\n- User story 25\n- User story 26","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-23T17:02:09Z","comments":[{"author":"paysdoc","createdAt":"2026-03-24T18:55:02Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Create a generic Docker image that provides an isolated runtime for behavioral (Cucumber BDD) tests. The image bundles Bun, Git, and the mock infrastructure layer (Claude CLI stub, GitHub API mock server, git remote mock) so that the full `@regression` test suite can run inside a container with the same results as on the host. ADW source code is mounted read-only at test time — no ADW-specific code is baked into the image. A `TEST_RUNTIME` environment variable switches between `docker` and `host` execution, and a wrapper script (`test/docker-run.sh`) orchestrates the container lifecycle.

## User Story
As a developer contributing to ADW
I want to run behavioral tests inside a Docker container
So that test results are reproducible across environments and CI runners without host-specific dependencies

## Problem Statement
The BDD test suite currently requires Bun, Git, and tsx to be installed on the host machine. Environment differences (OS, shell config, PATH ordering, binary versions) can cause flaky or inconsistent test results between developer machines and CI. There is no isolation boundary preventing tests from accidentally leaking state through the host filesystem or network.

## Solution Statement
Introduce a lightweight Docker image (`test/Dockerfile`) based on `oven/bun` that pre-installs Git and provides the mock infrastructure tooling. A shell script (`test/docker-run.sh`) builds the image (if needed), mounts the ADW repo read-only, and runs Cucumber inside the container. The `TEST_RUNTIME=docker|host` env var lets the existing `package.json` scripts and CI workflow dispatch to either runtime. The image is generic — it ships a Bun + Git + Cucumber base; all project-specific files (features, step definitions, mocks, fixtures) are mounted at runtime.

## Relevant Files
Use these files to implement the feature:

- `README.md` — project overview; update Testing section with Docker instructions
- `guidelines/coding_guidelines.md` — coding conventions to follow
- `test/mocks/test-harness.ts` — existing test harness; no changes expected but must work identically inside container
- `test/mocks/types.ts` — mock type definitions
- `test/mocks/claude-cli-stub.ts` — Claude CLI stub (bundled in image via mount)
- `test/mocks/git-remote-mock.ts` — Git remote mock
- `test/mocks/github-api-server.ts` — GitHub API mock server
- `test/fixtures/` — fixture files mounted into the container
- `features/` — BDD feature files and step definitions
- `cucumber.js` — Cucumber configuration
- `package.json` — add `test:docker` script
- `.github/workflows/regression.yml` — CI workflow; add optional Docker execution path
- `.adw/commands.md` — project commands reference
- `app_docs/feature-lnef5d-mock-infrastructure-layer.md` — mock infrastructure documentation (for understanding existing patterns)
- `app_docs/feature-6bi1qq-fixture-repo-test-harness.md` — fixture repo documentation (for understanding fixture setup)

### New Files
- `test/Dockerfile` — generic Docker image for behavioral test execution
- `test/.dockerignore` — excludes unnecessary files from Docker build context
- `test/docker-run.sh` — wrapper script to build image and run tests in container
- `features/docker_behavioral_test_isolation.feature` — BDD scenarios validating Docker execution
- `features/step_definitions/dockerBehavioralTestIsolationSteps.ts` — step definitions for Docker scenarios

## Implementation Plan
### Phase 1: Foundation
Create the Dockerfile and `.dockerignore`. The image is based on `oven/bun:latest`, adds Git via `apt-get`, creates a working directory structure, and sets the entrypoint to the Cucumber runner command. The image is intentionally generic — no ADW source code is copied in. All project files are provided at runtime via volume mounts.

### Phase 2: Core Implementation
Build the `test/docker-run.sh` wrapper script that:
1. Builds the Docker image (tagged `adw-bdd-runner:latest`) if not already cached
2. Mounts the ADW repo root as read-only at `/workspace`
3. Creates a writable temp overlay for test artifacts (fixture repos, mock temp dirs)
4. Passes through relevant env vars (`TEST_RUNTIME`, `MOCK_STREAM_DELAY_MS`, etc.)
5. Runs `cucumber-js` with the specified tags or defaults to `@regression`
6. Returns the container exit code for CI integration

Add a `test:docker` script to `package.json` and the `TEST_RUNTIME` env var switching logic.

### Phase 3: Integration
Write BDD scenarios that validate the Docker runtime works correctly. Update the CI workflow (`.github/workflows/regression.yml`) to support an optional Docker execution matrix. Update `README.md` with Docker build and run instructions.

## Step by Step Tasks

### Step 1: Create the Dockerfile
- Create `test/Dockerfile` based on `oven/bun:latest`
- Install `git` via `apt-get install --no-install-recommends`
- Create working directories: `/workspace` (for mounted source) and `/tmp/bdd` (for writable test artifacts)
- Set `WORKDIR /workspace`
- Set default `CMD` to run Cucumber: `["sh", "-c", "bun install --frozen-lockfile && NODE_OPTIONS='--import tsx' bunx cucumber-js --tags \"${BDD_TAGS:-@regression}\" --format progress"]`
- The image must NOT copy any ADW source — it only provides the runtime environment

### Step 2: Create the .dockerignore
- Create `test/.dockerignore` to minimize build context
- Exclude: `node_modules/`, `.git/`, `projects/`, `specs/`, `app_docs/`, `.env`
- Keep the context minimal since we're not copying source files (the Dockerfile only installs system packages)

### Step 3: Create the docker-run.sh wrapper script
- Create `test/docker-run.sh` (executable)
- Accept optional arguments: `--tags <tag>` (default `@regression`), `--build` (force rebuild), `--shell` (open interactive shell for debugging)
- Build the image from `test/Dockerfile` tagged as `adw-bdd-runner:latest`
- Mount the repo root read-only: `-v "$(pwd):/workspace:ro"`
- Mount a tmpfs for `/tmp/bdd` (writable temp space for fixture repos and mock artifacts)
- Pass env vars: `TEST_RUNTIME=docker`, `BDD_TAGS`, `MOCK_STREAM_DELAY_MS`
- Run the container with `--rm` for automatic cleanup
- Forward the exit code from `cucumber-js`
- Handle the `--shell` flag by overriding entrypoint to `/bin/bash` for debugging

### Step 4: Add package.json script and TEST_RUNTIME env var
- Add `"test:docker": "bash test/docker-run.sh"` to `package.json` scripts
- Add `"test:docker:build": "docker build -t adw-bdd-runner:latest -f test/Dockerfile test/"` for just building the image
- The `TEST_RUNTIME` env var is informational — the test harness already works identically in both environments because it uses relative paths and `REAL_GIT_PATH` resolution. No source code changes needed in `test/mocks/`.

### Step 5: Handle container-specific path adjustments
- The test harness's `setupFixtureRepo()` uses `os.tmpdir()` for temp directories. Inside Docker, this resolves to `/tmp` which is writable. Verify this works correctly.
- The git remote mock uses `which -a git` to find the real binary. Inside the container, git is at `/usr/bin/git`. Verify `REAL_GIT_PATH` resolves correctly.
- The Claude CLI stub at `test/mocks/claude-cli-stub.ts` is launched via `CLAUDE_CODE_PATH`. Since the workspace is mounted at `/workspace`, the path becomes `/workspace/test/mocks/claude-cli-stub.ts`. The test harness sets this relative to `process.cwd()` — verify it resolves correctly with a read-only mount.
- If any path resolution issues are found, fix them by using `import.meta.dir` or `path.resolve()` to compute absolute paths that work in both host and container environments.

### Step 6: Write BDD scenarios for Docker execution validation
- Create `features/docker_behavioral_test_isolation.feature` tagged `@docker-isolation @adw-78celh-docker-bdd`
- Scenario 1: "Docker image builds successfully" — verify `docker build` exits 0
- Scenario 2: "Container starts and provides Bun runtime" — verify `bun --version` exits 0 inside container
- Scenario 3: "Container provides Git" — verify `git --version` exits 0 inside container
- Scenario 4: "Mounted workspace is accessible" — verify files at `/workspace` are readable
- Scenario 5: "Behavioral tests run identically in container" — run a single `@mock-infrastructure` scenario inside Docker and verify it passes
- Create step definitions in `features/step_definitions/dockerBehavioralTestIsolationSteps.ts`
- These scenarios use `spawnSync('docker', [...])` to validate image/container behavior from the host

### Step 7: Update CI workflow for optional Docker execution
- Update `.github/workflows/regression.yml` to add a `runtime` input for `workflow_dispatch` with choices `host` and `docker` (default `host`)
- Add a conditional step that builds and runs tests via `test/docker-run.sh` when `runtime == 'docker'`
- Keep the existing host-based steps as the default path — Docker execution is opt-in

### Step 8: Update README.md with Docker documentation
- Add a "### Docker (optional)" subsection under "## Testing"
- Document how to build the image: `bun run test:docker:build`
- Document how to run tests in Docker: `bun run test:docker`
- Document how to pass custom tags: `bash test/docker-run.sh --tags "@mock-infrastructure"`
- Document the `--shell` flag for interactive debugging
- Note that Docker execution is optional and the test suite runs identically on the host

### Step 9: Run validation commands
- Run all validation commands listed below to confirm zero regressions

## Testing Strategy

### Edge Cases
- Read-only mount: verify that tests creating temp files (fixture repos, mock artifacts) use `/tmp` not the mounted workspace
- Large fixture repos: verify `cpSync` works correctly when source is on a read-only mount (it copies to `/tmp`)
- Port allocation: the GitHub mock server uses `portAllocator.ts` — verify port 0 (random) works inside the container
- Git config: `setupFixtureRepo()` runs `git config user.name` and `user.email` — verify these succeed inside the container (git may require config)
- PATH ordering: the git remote mock prepends a temp dir to PATH — verify this works with the container's PATH
- Signal handling: verify container responds to SIGTERM and cleans up gracefully (Cucumber handles signals)
- Empty BDD_TAGS env var: wrapper script should default to `@regression`
- Docker not installed: `test/docker-run.sh` should fail with a clear error message if `docker` is not on PATH

## Acceptance Criteria
- [ ] `test/Dockerfile` exists and `docker build -t adw-bdd-runner:latest -f test/Dockerfile test/` succeeds
- [ ] Built image includes `bun` and `git` binaries at expected paths
- [ ] No ADW source code is baked into the image (verified by inspecting image layers)
- [ ] `bun run test:docker` runs the `@regression` BDD suite inside the container and exits with the same pass/fail result as `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` on the host
- [ ] `TEST_RUNTIME=docker` env var is available for runtime detection
- [ ] Container starts cleanly, runs tests, and is removed automatically (`--rm`)
- [ ] `test/docker-run.sh --shell` opens an interactive shell inside the container for debugging
- [ ] `README.md` documents Docker build and run instructions
- [ ] All existing `@regression` scenarios continue to pass on the host
- [ ] Type checks pass: `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors (this runs `bunx tsc --noEmit`)
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type check for adws module
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression BDD suite on host to verify zero regressions
- `docker build -t adw-bdd-runner:latest -f test/Dockerfile test/` — Verify Docker image builds successfully
- `bash test/docker-run.sh --tags "@mock-infrastructure"` — Run mock infrastructure scenarios inside Docker container
- `bash test/docker-run.sh --tags "@regression"` — Run full regression suite inside Docker container and compare exit code with host run

## Notes
- The `guidelines/coding_guidelines.md` must be followed throughout implementation. Key points: clarity over cleverness, modularity, type safety, and BDD scenarios as the validation mechanism (not unit tests).
- Unit tests are disabled per `.adw/project.md` — do NOT create any unit test files.
- The Dockerfile is intentionally minimal — it only provides Bun + Git. All project-specific files (features, step definitions, mocks, fixtures, node_modules) come from the volume mount. This makes the image reusable by other repos that use the same Bun + Cucumber testing pattern.
- The `bun install --frozen-lockfile` in the container CMD ensures dependencies are installed from the mounted `bun.lock` without modifying it. This runs inside the container on a writable overlay, not on the read-only mount.
- Since `bun install` needs to write `node_modules/`, the wrapper script must mount a writable overlay or use a tmpfs for the install target. The simplest approach: mount the repo read-only but bind-mount a writable volume over `/workspace/node_modules`.
- The existing CI workflow (`.github/workflows/regression.yml`) already runs on `ubuntu-latest` which has Docker pre-installed, making the Docker runtime path zero-setup for CI.
- Future consideration: the Docker image could be published to a container registry (GHCR) for faster CI startup, avoiding per-run image builds. This is out of scope for this issue.
