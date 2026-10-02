# Bug: The daily regression run cannot fail on the host and fails on a read-only mount in Docker

## Metadata
issueNumber: `962`
adwId: `9vqzxl-bug-the-daily-regres`
issueJson: `{"number":962,"title":"bug: the daily regression run cannot fail on the host and fails on a read-only mount in Docker","body":"Source: the `## Divergence` section of `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, the daily run described in item 2. Read it before planning.\n\nSplit from #935, which was too large for one run and is closed. The facts below come from #935's planning research. Check them against the code before relying on them.\n\n## What to build\n\n`.github/workflows/regression.yml` has failed every scheduled run since 2026-07-22, and its verdict means nothing:\n\n- **The host step can't fail.** It runs `set +e … exit 0`, so the suite's result never reaches the job.\n- **The Docker leg fails on a read-only mount.** `test/docker-run.sh` mounts the checkout read-only (`-v \"${REPO_ROOT}:/workspace:ro\"`). ADW writes its runtime state relative to the working directory: `agents/`, `agents/paused_queue.json`, `agents/.auth_gate`, `logs/`. The pause-queue harness saves, removes and restores the queue file and the auth gate. Run 36858638363 reported `122 scenarios (69 failed, 42 pending, 11 passed)`, and every failure is an `EROFS: read-only file system` error on removing `agents/paused_queue.json` or `agents/.auth_gate`.\n- **T22 writes into the checkout.** It (`thenSteps.ts`) runs `bunx tsc --noEmit` without the `--incremental false` its vocabulary entry promises. The root `tsconfig.json` sets `incremental: true`, so it writes `tsconfig.tsbuildinfo`.\n- **One job holds both legs.** It has `timeout-minutes: 15`, which can't fit two full runs once the pending scenarios execute.\n\nFix:\n\n- **Two jobs.** `regression.yml` gets a `host` job and a `docker` job, each with `timeout-minutes: 30`, both on the schedule, and selectable by the existing `runtime` input on manual runs.\n- **Host job.** Runs `NODE_OPTIONS=\"--import tsx\" bunx cucumber-js --tags \"@regression\" …` without `set +e`/`exit 0`, so Cucumber's exit status fails the step. Keep the report and artifact steps.\n- **Docker job.** `test/Dockerfile` keeps `/workspace` read-only. The container copies it into a writable scratch directory and runs the suite there. Use `cp -R`, not `-a`, so the copy is owned by the container user and git does not flag dubious ownership. Keep the anonymous `node_modules` overlay, so host modules stay out of the copy. Update the mount comments in `test/docker-run.sh`.\n- **T22.** Pass `--incremental false`.\n- **Docs.** Update the \"Docker (optional)\" section of `README.md` and the Docker contract in `app_docs/feature-9gjajh-bdd-regression-suite.md`.\n\n**Expect red until the suite is repaired.** Until the pending smoke and surface scenarios are repaired by the later slices split from #935, the run will be red on both legs. That is the intended outcome: a pending or undefined scenario must fail the run.\n\n## Acceptance criteria\n\n- [ ] A manual run of each job fails when a scenario fails, pends or is undefined. Show this with the current pending scenarios.\n- [ ] The Docker job produces no `EROFS` failures.\n- [ ] Running the suite leaves no `tsconfig.tsbuildinfo` or other new file in the checkout.\n- [ ] Item 2 of ADR-0037 describes the daily run as it now behaves. The required-check part stays, because #941 owns it.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-02T07:59:06Z","comments":[],"actionableComment":null}`

## Bug Description
`.github/workflows/regression.yml` runs the `@regression` BDD suite daily at 06:00 UTC and on manual dispatch. It has failed every scheduled run since 2026-07-22, and its verdict means nothing. Four defects cause this; each was checked against the code.

1. **The host step cannot fail.** The step `Run @regression scenarios` (`regression.yml:34-41`) runs `set +e`, then Cucumber, then writes `exit_code=$EXIT_CODE` to `$GITHUB_OUTPUT`, then `exit 0`. No later step reads `steps.scenarios.outputs.exit_code`, so Cucumber's result never reaches the job. Today Cucumber exits 1 on every run because 42 scenarios are pending. cucumber-js 12.7.0 defaults to `strict: true` (`node_modules/@cucumber/cucumber/lib/runtime/helpers.js:96-109`), and in strict mode pending, undefined, failed and ambiguous steps all fail the run.
2. **The Docker leg fails on a read-only mount.** `test/docker-run.sh:89,99` mounts the checkout with `-v "${REPO_ROOT}:/workspace:ro"`. The image's `WORKDIR /workspace` and `CMD` (`test/Dockerfile:31,41`) run Cucumber in that mount. ADW resolves its runtime state against the working directory:
   - `adws/core/environment.ts:117,121` (`LOGS_DIR`, `AGENTS_STATE_DIR`)
   - `adws/core/pauseQueue.ts:9` (`'agents/paused_queue.json'`)
   - `adws/core/authGate.ts:9` (`'agents/.auth_gate'`)

   The pause-queue harness saves, removes and restores those files:
   - `features/regression/step_definitions/feature-902-queue.steps.ts:224-241`: the queue file.
   - `features/regression/step_definitions/feature-911.steps.ts:102-128`: the auth gate.

   Run 36858638363 reported `122 scenarios (69 failed, 42 pending, 11 passed)`, and every failure was `EROFS: read-only file system`. The 69 failures are exactly the 34 `@pause-queue-reset-time` and 35 `@pause-queue-ownership` scenarios.
3. **T22 writes into the checkout.** `the ADW TypeScript type-check passes` (`features/regression/step_definitions/thenSteps.ts:416-427`) runs `execFileSync('bunx', ['tsc', '--noEmit'], …)` at the repo root. The root `tsconfig.json` sets `"incremental": true`, so tsc writes `tsconfig.tsbuildinfo` into the checkout. The vocabulary entry (`features/regression/vocabulary.md:124`) promises `bunx tsc --noEmit --incremental false`. `.gitignore` ignores `*.tsbuildinfo`, so plain `git status` hides the leftover. Three `@regression` scenarios use T22:
   - `hashing/feature-537.feature:169`
   - `pause-queue/feature-910.feature:524`
   - `pause-queue/feature-911.feature:534`
4. **One job holds both legs.** The single `regression` job has `timeout-minutes: 15` (`regression.yml:22`). That covers a host run and a Docker run back to back, which will not fit once the 42 pending scenarios execute.

**Expected:**
- Two jobs, `host` and `docker`. Each has a 30-minute timeout, both run on the schedule, and a manual dispatch runs the one its `runtime` input names.
- Each job fails when a scenario fails, pends or is undefined.
- The Docker job has no `EROFS` failures.
- Running the suite leaves the checkout unchanged: no `tsconfig.tsbuildinfo`, no other new file.

**Actual:**
- The host verdict is always green.
- The Docker leg fails on writes into the read-only mount.
- T22 leaves `tsconfig.tsbuildinfo` behind.
- Both legs share 15 minutes.

## Problem Statement
The daily regression run must report the suite's real result. Four changes are needed:
- The host leg must propagate Cucumber's exit status.
- The Docker leg must run the suite where ADW can write its cwd-relative runtime state, without making the mounted checkout writable.
- T22 must not write build info into the checkout.
- Each leg needs its own job, each with its own 30-minute budget.

The docs (README, the regression-suite living doc, ADR-0037 Divergence item 2) must describe the run as it now behaves.

## Solution Statement
1. **Split `regression.yml` into two jobs.**
   - `host` runs `if: ${{ github.event_name == 'schedule' || github.event.inputs.runtime == 'host' }}`.
   - `docker` runs `if: ${{ github.event_name == 'schedule' || github.event.inputs.runtime == 'docker' }}`.
   - Each sets `timeout-minutes: 30`.
   - The host scenario step runs Cucumber directly, with no `set +e`, `exit 0`, `$GITHUB_OUTPUT` or step `id`, so Actions' default `bash -e` fails the step on Cucumber's exit status.
   - The existing `Report results` and `Upload results artifact` steps stay in the host job, both with `if: always()`.
   - The `docker` job keeps the old leg's sequence: checkout, set up Bun, `bun install`, `bun run test:docker:build`, `bash test/docker-run.sh --tags "@regression"`. `bun install` on the runner creates `node_modules/`, which is the mount point of `docker-run.sh`'s anonymous overlay. Docker cannot create a mount point inside a read-only bind mount, so the step is required even though the container installs its own modules.
2. **Run the Docker leg in a writable copy.**
   - `/workspace` stays read-only.
   - The image's `CMD` first runs `cp -R /workspace/. /tmp/bdd/workspace`, then `cd /tmp/bdd/workspace`, then `bun install --frozen-lockfile`, then Cucumber exactly as today.
   - `cp -R` (not `-a`) makes the copy belong to the container user, so git accepts it without a `safe.directory` exception.
   - The anonymous `/workspace/node_modules` volume stays, so the copy starts with an empty `node_modules` and never sees the host's modules.
   - `/tmp/bdd` is already provisioned as writable scratch and is referenced by no code.
   - Remove the now-unused `git config --system --add safe.directory /workspace`. Nothing runs git against the mount any more: cwd, `REPO_ROOT` (`adws/core/environment.ts:16`) and the step definitions' `ROOT` all resolve to the copy.
   - Update the mount comments in `test/docker-run.sh`. That file changes in comments only.
3. **T22:** pass `'--incremental', 'false'` to tsc. This is the argv the vocabulary entry promises.
4. **Pin the contract** with a Vitest guard, `adws/__tests__/regressionWorkflow.test.ts`. It follows the precedents `adws/__tests__/envelopeConformanceWorkflow.test.ts` and `adws/__tests__/deployWorkersWorkflow.test.ts`: text parsing, no YAML dependency, and running the host step's script with a fake `bunx`.
5. **Docs:**
   - The README "Docker (optional)" section.
   - The Docker contract in `app_docs/feature-9gjajh-bdd-regression-suite.md`.
   - ADR-0037 Divergence item 2: describe the daily run as it now behaves, and keep the required-check part unchanged (#941 owns it).

## Steps to Reproduce
Run from the repo root after `bun install`.

1. **The host step cannot fail.** Run lines 36-41 of `regression.yml` the way Actions does (`bash -e`), against the smoke scenarios, all of which pend:
   ```bash
   bash -e -c 'set +e
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke" --format summary
   EXIT_CODE=$?
   echo "exit_code=$EXIT_CODE"
   exit 0'; echo "step exit status: $?"
   ```
   Observed: the summary shows only pending scenarios, then `exit_code=1`, then `step exit status: 0`. The suite failed and the step passed.
2. **T22 writes build info into the checkout:**
   ```bash
   rm -f tsconfig.tsbuildinfo
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@framework-hash" --name "TypeScript type-check passes"
   ls -l tsconfig.tsbuildinfo
   git status --porcelain --ignored | grep tsbuildinfo
   ```
   Observed: the scenario passes, `tsconfig.tsbuildinfo` exists, and `git status --porcelain --ignored` lists `!! tsconfig.tsbuildinfo`.
3. **The Docker leg fails with EROFS.** CI evidence: `gh run view 36858638363 --log | grep -m5 "EROFS"` shows `EROFS: read-only file system` on `agents/paused_queue.json` and `agents/.auth_gate`. A local reproduction needs Linux with Docker, which this host lacks. The old job ran the host leg first in the same checkout, which created `agents/`. To match that:
   ```bash
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
   bun run test:docker:build
   bash test/docker-run.sh --tags "@regression"
   ```
   The first command is the host leg.
4. **One job, 15 minutes:** `grep -n -E "^  [a-z-]+:$|timeout-minutes" .github/workflows/regression.yml` shows a single `regression:` job with `timeout-minutes: 15`.

## Root Cause Analysis
- **Host step.** `set +e … exit 0` is deliberate. The step was written to report rather than to gate (`fc978021`, the original periodic workflow): it writes `exit_code` to `$GITHUB_OUTPUT`, and nothing reads that output. The job can only go red through the Docker leg.
- **Docker leg.**
  - The container's working directory is the read-only mount.
  - #767 (`6a8962aa`) moved the harness's own scratch (git mock dir, fixture repos) to `os.tmpdir()`, but ADW's runtime state is cwd-relative by design. Triggers call `assertCwdIsRepoRoot()`, and `LOGS_DIR`/`AGENTS_STATE_DIR` are `path.join(process.cwd(), …)`.
  - Every scenario that drives the real pause queue or auth gate therefore writes under `/workspace/agents/`.
  - The pause-queue features were promoted into `features/regression/` on 2026-09-30 (`f81c3b01`, `bcaa1f10`). They are the `@regression` scenarios that do this, and their `Before` hooks immediately `rmSync` the queue file and the auth gate.
  - The fix is not to make the mount writable. ADW must run where it can write, which is a disposable copy.
- **T22.**
  - The #910 promotion (`f81c3b01`) added `features/regression/step_definitions/codebaseBackstopSteps.ts`, whose T22 ran `['tsc', '--noEmit', '--incremental', 'false']`, and it wrote the vocabulary entry.
  - The parallel #911 promotion (`bcaa1f10`) added a second T22 to `thenSteps.ts` without the flag.
  - Merge `e9d3f0ba` resolved the duplicate step by deleting `codebaseBackstopSteps.ts` (-52 lines) and keeping the `thenSteps.ts` version. The vocabulary promise and the code have diverged since then.
- **Timeout.** #767 added `timeout-minutes: 15` as a hang backstop for one job running both legs. A single budget for two full runs is too small once the pending scenarios execute.

## Relevant Files
Use these files to fix the bug:

- `.github/workflows/regression.yml`: the daily workflow. It is one job with a 15-minute timeout (lines 19-22), the host step swallows the exit status (lines 34-41), and the Docker steps run conditionally (lines 76-82). This file becomes two jobs.
- `test/Dockerfile`: the BDD runner image. Its `CMD` runs Cucumber in the read-only `/workspace` (lines 31-41), its `safe.directory /workspace` config (lines 21-25) becomes unused, and it already provisions `/tmp/bdd` as scratch (lines 27-29). The `CMD` changes to run the suite in a `cp -R` copy.
- `test/docker-run.sh`: builds and runs the image. It holds the read-only mount and the anonymous `node_modules` volume (lines 88-104), and the mount comments to update (lines 74-79).
- `features/regression/step_definitions/thenSteps.ts`: T22 at lines 416-427 runs tsc without `--incremental false`.
- `features/regression/vocabulary.md`: T22 entry (line 124), the spec T22 must meet. Read only, no change.
- `features/regression/step_definitions/feature-902-queue.steps.ts`: queue save/remove/restore hooks (lines 207-252) that hit `EROFS` on the mount. Context only.
- `features/regression/step_definitions/feature-911.steps.ts`: auth-gate save/remove/restore hooks (lines 100-129). Context only.
- `adws/core/environment.ts`: `REPO_ROOT` from the file location (line 16), `assertCwdIsRepoRoot` (lines 25-35), and the cwd-relative `LOGS_DIR`/`AGENTS_STATE_DIR` (lines 117-121). These explain why the suite needs a writable cwd, and why the copy must be a real (non-symlinked) path. Context only.
- `adws/core/pauseQueue.ts`, `adws/core/authGate.ts`: the relative `agents/paused_queue.json` and `agents/.auth_gate` paths. Context only.
- `tsconfig.json`: sets `"incremental": true`. This is the reason T22 writes `tsconfig.tsbuildinfo`. Context only.
- `cucumber.js`: config `format: ['progress']`. The stdout formatter is the last format without a target, so the host step's `--format summary` wins. Context only.
- `package.json`: the `test:docker` and `test:docker:build` scripts used by the Docker job. Context only.
- `.gitignore`: ignores `*.tsbuildinfo`, `/agents` and `/logs`, so leftovers are invisible to plain `git status`. Context only.
- `README.md`: the "Docker (optional)" section (lines 358-379) to update.
- `app_docs/feature-9gjajh-bdd-regression-suite.md`: the Docker contract to update. Conditional doc matching "the Docker-based hermetic regression-suite runner" and "the codebase backstop steps (type-check)". The lines are 5, 26, 37-40, 58, 63, and 75-78.
- `app_docs/feature-9gjajh-root-config.md`: conditional doc for `README.md` and `.github/` workflows. Read for context; it only names `regression.yml`, so no change is needed.
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`: Divergence item 2 (line 74) to rewrite. Per `.claude/skills/write-an-adr/SKILL.md`, only `## Divergence` may change in an accepted ADR.
- `adws/__tests__/envelopeConformanceWorkflow.test.ts`, `adws/__tests__/deployWorkersWorkflow.test.ts`: precedents for a workflow contract test. They show text-splitting jobs and steps, and running a step script under `bash -e` with fake binaries.
- `vitest.config.ts`: includes `adws/**/__tests__/**/*.test.ts`, so the new test runs under `bun run test:unit`.
- `.adw/commands.md`: the validation commands.

### New Files
- `adws/__tests__/regressionWorkflow.test.ts`: Vitest contract guard for the two-job workflow, the host step's exit-status propagation, and the Docker leg's read-only mount plus `cp -R` working copy.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Capture the baseline before any change
- Run Steps to Reproduce items 1 and 2 and keep their output: the step exit status `0`, and the existing `tsconfig.tsbuildinfo`.
- Then capture the baseline host summary, which is used for comparison in the last step:
  ```bash
  NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary > /tmp/adw-962-host-before.txt 2>&1; echo "cucumber exit status: $?"
  ```
- Finish with `rm -f tsconfig.tsbuildinfo`.

### 2. Write the contract test first (RED)
- Create `adws/__tests__/regressionWorkflow.test.ts` in the style of `envelopeConformanceWorkflow.test.ts`:
  - Read files relative to `REPO_ROOT = path.resolve(__dirname, '../..')`.
  - Split the jobs with `/^ {2}(?=[\w-]+:\n)/m` after `jobs:`.
  - Split the steps with `/^ {6}- name: /m`.
  - Read a step's `run:` value whether it is inline or a `|` block, removing the block's indentation.
  - Add a short doc comment stating the contract, with no issue numbers (`.adw/coding_guidelines.md`, ADR-0054).
- `describe('regression.yml')`:
  - Has exactly two jobs, `host` then `docker`, and each contains `timeout-minutes: 30`.
  - The `host` job contains `if: ${{ github.event_name == 'schedule' || github.event.inputs.runtime == 'host' }}`. The `docker` job contains the same with `'docker'`.
  - The host step `Run @regression scenarios`:
    - It contains `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` and does not match `/set \+e|exit 0|continue-on-error/`.
    - Execute its `run:` script with `spawnSync('bash', ['-e', '-c', script], …)` and a `PATH` whose first entry is a temp dir holding a fake `bunx` (`#!/bin/sh` + `exit "${FAKE_BUNX_EXIT:-0}"`). Expect status `1` with `FAKE_BUNX_EXIT=1` and `0` with `FAKE_BUNX_EXIT=0`.
    - Create the temp dir in `beforeAll` and remove it in `afterAll`.
  - The host job's `Report results` and `Upload results artifact` steps each contain `if: always()`, and the upload uses `actions/upload-artifact@v4`.
  - In the `docker` job, `run: bun install` appears before `bash test/docker-run.sh --tags "@regression"`. Name this test for the reason: the runner must create the `node_modules/` mount point before the container overlays it.
- `describe('the Docker leg')`:
  - `test/docker-run.sh` contains `-v "${REPO_ROOT}:/workspace:ro"` and `-v /workspace/node_modules`, each twice (the `--shell` path and the run path).
  - The `CMD` line of `test/Dockerfile`:
    - Contains `cp -R /workspace/. /tmp/bdd/workspace` and does not contain `cp -a`.
    - In it, `cp -R` comes before `cd /tmp/bdd/workspace`, which comes before `bun install --frozen-lockfile`, which comes before `cucumber-js`.
- Run `bun run test:unit` and confirm these tests fail against the current files. This is the RED phase.

### 3. Split `.github/workflows/regression.yml` into `host` and `docker` jobs
- Keep `name`, the `schedule` (`'0 6 * * *'` with its comment) and the `workflow_dispatch.inputs.runtime` choice input: options `host`/`docker`, default `host`. Change its description to `'Job to run: host or docker'`.
- Replace the `regression` job with two jobs. Each has `runs-on: ubuntu-latest` and `timeout-minutes: 30`.
- **`host`:**
  - `name: Run @regression BDD scenarios on the host`
  - `if: ${{ github.event_name == 'schedule' || github.event.inputs.runtime == 'host' }}`
  - Steps:
    - `Checkout` (`actions/checkout@v4`)
    - `Set up Bun` (`oven-sh/setup-bun@v2`)
    - `Install dependencies` (`bun install`)
    - `Run @regression scenarios`, a single-line run: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary --format json:regression-results.json`. No `id`, no `set +e`, no `$GITHUB_OUTPUT`, no `exit 0`.
    - `Report results`: keep `if: always()` and its existing script byte for byte.
    - `Upload results artifact`: keep `if: always()`, `actions/upload-artifact@v4`, `name: regression-results`, `path: regression-results.json`, `if-no-files-found: ignore`.
- **`docker`:**
  - `name: Run @regression BDD scenarios in Docker`
  - `if: ${{ github.event_name == 'schedule' || github.event.inputs.runtime == 'docker' }}`
  - Steps:
    - `Checkout`
    - `Set up Bun`
    - `Install dependencies` (`bun install`), preceded by a one-line comment saying it creates `node_modules/`, the mount point `docker-run.sh` overlays inside the read-only checkout.
    - `Build Docker image` (`bun run test:docker:build`)
    - `Run @regression scenarios in Docker` (`bash test/docker-run.sh --tags "@regression"`)
- Do not add a `both` option, `continue-on-error`, `needs:` between the jobs, or a Docker artifact.

### 4. Run the Docker leg in a writable copy (`test/Dockerfile`)
- Remove the `safe.directory` block (lines 21-25: its comment and `RUN git config --system --add safe.directory /workspace`).
- Keep `RUN mkdir -p /workspace /tmp/bdd`, `WORKDIR /workspace`, `ENV BDD_TAGS`, `ENV TEST_RUNTIME`. Update the `/tmp/bdd` line of the directory comment to say the suite runs in a copy of `/workspace` at `/tmp/bdd/workspace`.
- Replace the `CMD` comment and line with:
  ```dockerfile
  # ADW writes its runtime state (agents/, logs/) under the working directory, so the suite runs in a
  # writable copy of the read-only mount. cp -R, not -a: the copy must belong to the container user, or
  # git refuses it as a repository of dubious ownership. docker-run.sh overlays /workspace/node_modules
  # with an empty volume, so the host's modules stay out of the copy.
  CMD ["sh", "-c", "cp -R /workspace/. /tmp/bdd/workspace && cd /tmp/bdd/workspace && bun install --frozen-lockfile && NODE_OPTIONS='--import tsx' bunx cucumber-js --tags \"${BDD_TAGS}\" --format progress"]
  ```
- `/tmp` in the Debian-based `oven/bun` image is a real directory, not a symlink, so the copy's `process.cwd()` equals `REPO_ROOT` and `assertCwdIsRepoRoot()` in the real `trigger_cron.ts` subprocess (feature-911 §4) still passes.

### 5. Update the mount comments in `test/docker-run.sh`
- Replace lines 74-79 with comments only. The `docker run` arguments stay unchanged:
  ```bash
  # Volume mounts:
  #   /workspace              — repo root, read-only; the image's CMD copies it to
  #                             /tmp/bdd/workspace and runs the suite in the copy
  #   /workspace/node_modules — anonymous volume that hides the host's node_modules,
  #                             so the copy starts without them and installs fresh
  #
  # Docker cannot create the node_modules mount point inside the read-only mount,
  # so the checkout needs a node_modules/ directory first (bun install).
  ```

### 6. Fix T22 (`features/regression/step_definitions/thenSteps.ts`)
- Change the argv on line 421 to `['tsc', '--noEmit', '--incremental', 'false']`.
- Add one comment line next to the existing `NODE_OPTIONS` comment: `// tsconfig.json sets \`incremental\`, which would write tsconfig.tsbuildinfo into the checkout.`
- Do not change the vocabulary entry; it already describes this behaviour.

### 7. Update the README "Docker (optional)" section
- Replace the paragraph at lines 360-363 with one that says:
  - The repo is mounted read-only at `/workspace` and is never written.
  - The container copies it with `cp -R` into `/tmp/bdd/workspace`, then installs dependencies and runs the suite there, because ADW writes its runtime state (`agents/`, `logs/`) under the working directory.
  - An anonymous volume over `/workspace/node_modules` keeps the host's `node_modules` out of the copy.
  - `TEST_RUNTIME=docker` is set automatically.
- In the code block:
  - Change the build comment to `# Build the image once (again after any change to test/Dockerfile)`.
  - Change the shell comment to `# Open an interactive shell for debugging (in the read-only /workspace; no copy is made)`.
- After the code block, add one paragraph:
  - The daily `Regression Scenarios` workflow (`.github/workflows/regression.yml`) runs the suite in two jobs, `host` and `docker`.
  - A manual dispatch runs the job its `runtime` input names.
  - Each job fails when a scenario fails, is pending or is undefined.
- Keep the closing "Docker execution is entirely optional…" sentence.

### 8. Update the Docker contract in `app_docs/feature-9gjajh-bdd-regression-suite.md`
- **Line 5 (Overview):** the Docker runner re-executes the suite in a container, in a writable copy of the read-only mounted checkout, as the `docker` job of the daily regression workflow.
- **Line 26 (Responsibilities):**
  - The image's `CMD` copies `/workspace` into `/tmp/bdd/workspace` with `cp -R`, then runs `bun install --frozen-lockfile` and Cucumber there.
  - `.github/workflows/regression.yml` has two jobs:
    - `host` runs the suite on the runner and fails when Cucumber does. Its report and `regression-results` artifact steps run regardless.
    - `docker` runs `bun run test:docker:build` and `test/docker-run.sh --tags "@regression"`.
  - The schedule runs both jobs; a manual dispatch runs the one its `runtime` input names.
  - The contract is pinned by `adws/__tests__/regressionWorkflow.test.ts`.
- **Line 37:**
  - Harness scratch still lives under `os.tmpdir()` and never under `process.cwd()`, because on the host the cwd is the developer's checkout.
  - ADW's own runtime state (`agents/`, `logs/`) is cwd-relative by design.
  - The Docker leg gives that state a writable cwd by running in the `/tmp/bdd/workspace` copy, never in the `/workspace` mount.
- **Line 38:**
  - The anonymous volume over `/workspace/node_modules` hides the host's modules, so the copy starts with an empty `node_modules` and installs fresh every run.
  - Its mount point must already exist in the read-only checkout, which is why the `docker` job runs `bun install` on the runner first.
- **Line 39:**
  - Replace the `safe.directory` invariant: the suite runs in a `cp -R` copy owned by the container user, so git accepts it.
  - `cp -a` would keep the mounted files' host UID, and git ≥2.35.2 would refuse the copy as "dubious ownership".
- **Line 40:** `host` and `docker` each set `timeout-minutes: 30`. Two full runs no longer share one budget.
- **Line 58 (`--shell`):** the shell opens in the read-only `/workspace`. The image's `CMD` does not run, so no copy is made.
- **Line 63:** the reason for `--incremental false` becomes: the root tsconfig is incremental and would otherwise write `tsconfig.tsbuildinfo` into the checkout, and a run of the suite must leave the checkout unchanged.
- **Line 75:** `timeout-minutes: 15` becomes each job's `timeout-minutes: 30`.
- **Line 77:** inside the container, cwd, `REPO_ROOT` and the step definitions' `ROOT` all resolve to `/tmp/bdd/workspace`. An `EROFS` error at a path under `/workspace` therefore means something resolved a path against the mount instead of the copy.
- **Line 78:** add that the copy step lives in the image's `CMD`, so a change to `test/Dockerfile` needs `--build` or `bun run test:docker:build`.
- **New Gotcha:**
  - Both jobs fail on a pending or undefined scenario (Cucumber's default `strict`), so the daily run stays red while smoke and surface `When` steps return `'pending'`.
  - ADW's own test phase scores those scenarios as skipped (`classifyTestCase`).

### 9. Rewrite ADR-0037 Divergence item 2 (`specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, line 74)
- Keep these unchanged:
  - The bold title.
  - The ruleset sentence.
  - The "runs on a daily schedule and manual dispatch only" sentence.
  - The ruling.
  - The "blocked on teaching the merge path…" sentence with its ADR-0019/ADR-0038 links.
  - The "Meanwhile…" sentence.

  These are the required-check part, which #941 owns.
- Replace the history sentences ("Of its last 100 runs … The cause of the other failures was not determined.") with this text, in the ADR's plain style:
  > It has two jobs, `host` and `docker`, each with a 30-minute timeout; the schedule runs both, and a manual dispatch runs the one its `runtime` input names. A job fails when Cucumber exits non-zero, which a failed, pending or undefined scenario causes, so both jobs are red until the pending scenarios of item 3 execute. The `docker` job mounts the checkout read-only and runs the suite in a writable copy inside the container, because ADW writes its runtime state (`agents/`, `logs/`) under the working directory. Until #962 both legs ran in one job: the host step ended with `exit 0` and could not fail it, and the Docker step ran the suite on the read-only mount, where the pause-queue scenarios failed with `EROFS`. Of the 100 runs from 2026-06-22 to 2026-09-28, 80 failed, 19 were cancelled and 1 passed.
- Change nothing else in the ADR.

### 10. Run the validation commands
- Run every command in `Validation Commands` in order and check each expected result.
- Run the type-check and build commands before `rm -f tsconfig.tsbuildinfo`, because they write that file themselves.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

Code quality and unit tests:
- `bun install`
- `bun run lint`: zero errors or warnings.
- `bunx tsc --noEmit`: zero errors. It writes `tsconfig.tsbuildinfo` itself because the root tsconfig is incremental, which is why the `rm -f` below follows.
- `bunx tsc --noEmit -p adws/tsconfig.json`: zero errors.
- `bun run build`: zero errors.
- `bun run test:unit`: all tests pass, including `adws/__tests__/regressionWorkflow.test.ts` (GREEN).
- `bun run lint:docs-index`: exits 0.

Workflow shape:
- `! grep -nE 'set \+e|exit 0|GITHUB_OUTPUT' .github/workflows/regression.yml && echo "OK: the host step no longer swallows Cucumber's exit status"`
- `grep -c 'timeout-minutes: 30' .github/workflows/regression.yml`: prints `2`.

T22 and the checkout:
- `rm -f tsconfig.tsbuildinfo && git status --porcelain --ignored | grep -v '^!! logs/$' > /tmp/adw-962-status-before.txt`. `logs/` is excluded because Claude Code hook logs land there during the session.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --name "TypeScript type-check passes"`: `3 scenarios (3 passed)`. These are the T22 scenarios of feature-537, feature-910 and feature-911.
- `test ! -e tsconfig.tsbuildinfo && echo "OK: T22 wrote no tsconfig.tsbuildinfo"`

The host suite fails on pending scenarios:
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary > /tmp/adw-962-host-after.txt 2>&1; echo "cucumber exit status: $?"`: prints `cucumber exit status: 1`.
- `grep -E "^[0-9]+ scenarios? \(" /tmp/adw-962-host-before.txt /tmp/adw-962-host-after.txt`: both lines report the same counts, including `42 pending`, with no new failure. Only the build-info side effect changed.

Nothing new in the checkout:
- `git status --porcelain --ignored | grep -v '^!! logs/$' > /tmp/adw-962-status-after.txt && diff /tmp/adw-962-status-before.txt /tmp/adw-962-status-after.txt && echo "OK: the suite left no new file in the checkout"`
- `test ! -e tsconfig.tsbuildinfo && echo "OK: no tsconfig.tsbuildinfo after the full suite"`

Per-issue scenarios:
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-962"`: all pass, if the issue's scenarios exist.

CI acceptance, after the branch is pushed. This is the authoritative check of the Docker job, because Docker is not available on the planning host.
- `BRANCH=$(git branch --show-current)`
- `gh workflow run regression.yml --ref "$BRANCH" -f runtime=host`
- `gh workflow run regression.yml --ref "$BRANCH" -f runtime=docker`
- `gh run list --workflow regression.yml --branch "$BRANCH" --event workflow_dispatch --limit 2 --json databaseId,status,conclusion,url`: once complete, both runs have `conclusion: failure`. In each run, the job not selected is skipped.
- `gh run view <host-run-id> --log | grep -E "[0-9]+ scenarios? \("`: shows `42 pending`. The job failed at `Run @regression scenarios`, and `Report results` and `Upload results artifact` still ran.
- `gh run view <docker-run-id> --log | grep -E "[0-9]+ scenarios? \("`: shows `42 pending`. The job failed at `Run @regression scenarios in Docker`.
- `! gh run view <docker-run-id> --log | grep -q "EROFS" && echo "OK: the Docker job produced no EROFS failure"`

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md` strictly.
  - Comments state only reasons and invariants: why `cp -R` rather than `-a`, why the runner's `bun install` in the Docker job, why `--incremental false`.
  - Never cite issue numbers in code or YAML comments (ADR-0054).
  - Keep the new test file well under 300 lines.
- **Red is the expected outcome.** Until later slices split from #935 repair the 42 pending smoke and surface scenarios, both jobs are red. The issue asks for exactly this: a pending or undefined scenario must fail the run.
  - Do not touch the `return 'pending';` markers in `features/regression/step_definitions/whenSteps.ts`.
  - Do not change `classifyTestCase`.
- **The required-check part of ADR-0037 item 2 stays as is.** #941 owns making the suite a required check.
- **No new library.** The contract test parses the workflow as text, like its two precedents. Do not import `yaml`: it is only a transitive dependency of `@cucumber/cucumber`.
- **Removing `safe.directory /workspace`.**
  - Once the suite runs in the copy, nothing runs git against the mount, and the copy is owned by the container user, so the exception has no remaining user.
  - The only effect is that `git` typed by hand in a `--shell` session, inside the read-only `/workspace`, reports dubious ownership.
  - Running `git config --global --add safe.directory /workspace` in that shell restores it if needed.
- **Why the Docker job keeps `bun install`.** The anonymous volume's mount point (`node_modules/`) must already exist in the read-only checkout, because the runtime cannot `mkdir` inside a read-only bind mount. In the old single job, the shared `bun install` provided it.
- **Local Docker runs.**
  - A cached `adw-bdd-runner:latest` keeps the old `CMD` until it is rebuilt (`--build` or `bun run test:docker:build`). CI builds fresh on every run.
  - A local run copies the whole checkout, including gitignored directories such as `.worktrees/`, `agents/` and `logs/`, so it can be slow from a busy main checkout. This is out of scope; the CI checkout is clean.
  - On macOS with the system bash 3.2, `docker-run.sh` stops on `"${EXTRA_ENV[@]}"` under `set -u` when `MOCK_STREAM_DELAY_MS` is unset. This was already the case and is out of scope; Linux CI uses bash 5.
- **Host runs and runtime state.** A host run still writes ADW runtime state under the cwd by design, and the pause-queue hooks restore or remove what they write. Expect at most empty directories under `agents/`, which git does not list.
  - If the before/after `git status --porcelain --ignored` diff shows an `agents/` entry, find the scenario whose `After` hook leaks it before changing anything else.
  - The resume path awaits its readiness window (`adws/triggers/pauseQueueResume.ts:203`), so no queue write is expected after a scenario ends.
- **Things not to change:**
  - `features/regression/vocabulary.md` (T22 already promises `--incremental false`).
  - `cucumber.js`.
  - The `.adw/` files.
  - The `runtime` input's options and default.
