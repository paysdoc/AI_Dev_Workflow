@adw-962 @adw-9vqzxl-bug-the-daily-regres
Feature: The daily regression run fails when its suite does: a host job and a docker job each fail when a scenario fails, pends or is undefined, the docker job's container sees the checkout only read-only, and running the suite writes nothing into the checkout

  Issue #962 fixes the daily run described in item 2 of the `## Divergence` section of ADR-0037
  (`specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`). It is split from #935.
  `.github/workflows/regression.yml` has failed every scheduled run since 2026-07-22, and its
  verdict means nothing.

  The workflow today (checked 2026-10-02). It runs on a daily `schedule` and on a manual
  `workflow_dispatch` whose `runtime` input is `host` (the default) or `docker`. Its one job,
  `regression`, has `timeout-minutes: 15` and holds both legs. The host leg runs
  `bunx cucumber-js --tags "@regression"` between `set +e` and `exit 0`, so the suite's result
  never reaches the job. A report step and the upload of the `regression-results` artifact follow
  it with `if: always()`. The Docker leg runs on the schedule or the `docker` runtime, after the
  host leg. It builds the image and runs `test/docker-run.sh`, which mounts the checkout read-only
  at `/workspace`, with an anonymous volume over `/workspace/node_modules`. ADW writes its runtime
  state relative to its working directory (`agents/`, `agents/paused_queue.json`,
  `agents/.auth_gate`, `logs/`), so inside the container every such write fails with `EROFS`.
  T22, `the ADW TypeScript type-check passes`, runs `bunx tsc --noEmit` without the
  `--incremental false` its vocabulary entry promises. The root `tsconfig.json` sets
  `incremental: true`, so T22 writes `tsconfig.tsbuildinfo` into the checkout.

  What #962 changes. `regression.yml` gets a `host` job and a `docker` job, each with
  `timeout-minutes: 30`, both on the schedule, each selected by the `runtime` input on a manual
  run. The host job lets Cucumber's exit status fail it, and keeps the report and the artifact.
  The docker job's container copies the read-only `/workspace` into a writable scratch directory
  with `cp -R` and runs the suite there; the anonymous `node_modules` volume keeps the host's
  modules out of the copy. T22 passes `--incremental false`. Until the later slices of #935 repair
  the pending smoke and surface scenarios, both jobs are red, as intended: a pending or undefined
  scenario must fail the run.

  The labels below are the section numbers used for the scenario groups further down (§1–§6):

    §1  THE HOST JOB'S VERDICT IS THE SUITE'S (AC1, host). Run manually with the runtime `host`,
        the host job fails when the suite's scenario pends, is undefined or fails, and succeeds
        when it passes. Either way it uploads the `regression-results` artifact, which records
        the scenario's outcome.

    §2  EACH JOB RUNS WHEN IT IS ASKED FOR. The daily schedule runs both jobs. A manual run runs
        the job its `runtime` input names, and not the other.

    §3  THE DOCKER JOB'S VERDICT IS ITS CONTAINER'S (AC1, docker: the workflow's half). The docker
        job fails when the suite run inside its container exits non-zero, and succeeds when it
        exits 0, starting from a fresh checkout (F1).

    §4  THE CONTAINER SEES THE CHECKOUT ONLY READ-ONLY. The docker job mounts the checkout
        read-only at `/workspace`, with an anonymous volume over `/workspace/node_modules`. It
        gives its container no other writable mount under `/workspace`, and no writable mount
        of the checkout.

    §5  THE SUITE WRITES NOTHING INTO THE CHECKOUT (AC3). Running the suite's type-check scenario
        leaves no `tsconfig.tsbuildinfo`, and no other new file, in the checkout.

    §6  BACKSTOP. The type-check.

  Each row is written to fail for a specific wrong implementation:
    • §1 is RED today: the workflow has no `host` job, and its one job ends the scenarios step
      with `exit 0`. The pending, undefined and failing rows fail for a fix that keeps the
      `exit 0`, or swallows the status with `continue-on-error`, `|| true` or `--no-strict`. They
      also fail for a fix that drops `if: always()` from the upload, which then never runs after
      a red suite. The passing row fails for a host job that fails whatever the suite says;
    • §2 is RED today: one job holds both legs, and the host leg runs on every event, the
      `docker` runtime included. The schedule row fails for a docker job that tests only the
      `runtime` input, which a scheduled run does not have. The manual rows fail for a job that
      runs whatever the input says;
    • §3 is RED today: there is no `docker` job. The status-1 row fails for a docker job that
      swallows the container's exit status. The status-0 row fails for a docker job that fails
      whatever the container says, and for one that starts Docker from a fresh checkout with no
      `node_modules` directory (F1);
    • §4 is RED today only because there is no `docker` job: `test/docker-run.sh` already sends
      this mount request. It fails for the tempting fix that drops `:ro`. It fails for a fix that
      makes `agents/` or `logs/` writable under `/workspace`, by a bind mount from the checkout
      or from anywhere else, or by a tmpfs. It fails for a fix that drops the `node_modules`
      volume;
    • §5 is RED today. In a throwaway checkout on 2026-10-02 the type-check scenario left
      `tsconfig.tsbuildinfo` and nothing else; with `--incremental false` it left nothing.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  ADW's host has no Docker (`command -v docker` finds nothing, 2026-10-02), and no scenario may
  build or pull an image, so the Docker stand-in never runs the container. What only a real
  container shows is shown by the pull request's manual runs: the container copies `/workspace`
  into a writable scratch directory with `cp -R` and runs the suite there; git reports no dubious
  ownership in the copy; a scenario that fails, pends or is undefined inside the container fails
  the docker job; and the docker job's log has no `EROFS` line (AC2). The runs to link are
  `gh workflow run regression.yml --ref <branch> -f runtime=host` and the same with
  `-f runtime=docker`. Both are red on the current pending scenarios, which is AC1's "show this".
  §3 and §4 pin the workflow's half: the container's exit status decides the docker job, and the
  container sees the checkout only read-only.
  `timeout-minutes: 30` cannot show in a run shorter than 30 minutes, and the runner ignores it.
  The review checks it.
  AC4 (item 2 of ADR-0037 describes the daily run as it now behaves; the required-check part
  stays, for #941), the "Docker (optional)" section of `README.md`, the Docker contract in
  `app_docs/feature-9gjajh-bdd-regression-suite.md` and the mount comments of
  `test/docker-run.sh` are documentation. A scenario asserting a document's text would assert a
  file's contents, which the Rot-Detection Rubric forbids, so the review checks them.
  The report step is kept, but its wording is not pinned; §1 pins the uploaded artifact instead.
  §5 narrows the suite to the type-check scenario, so that its verdict is T22's alone. The
  suite's other scenarios write ADW's runtime state relative to their working directory, which
  on the host is the checkout; #962 moves those writes on the Docker leg only.
  These scenarios never run the real suite, so the later slices of #935 that repair it do not
  change them.

  ── FINDINGS THE ISSUE BODY DOES NOT CARRY ──────────────────────────────────────────────────

  F1  A FRESH CHECKOUT HAS NO MOUNT POINT FOR THE node_modules VOLUME.
      Docker makes the mount point of a volume inside the container. The volume over
      `/workspace/node_modules` lies inside the read-only bind mount of the checkout, so its mount
      point must already exist in the checkout. Without a `node_modules` directory there, the
      container does not start ("mkdir …/workspace/node_modules: read-only file system"). Today's
      single job runs `bun install` on the host before the Docker leg, so the directory exists. A
      separate docker job starts from a fresh checkout and has none, unless it makes one before
      `docker run`: by creating the directory, or by installing on the host. Not reproduced here,
      because this host has no Docker. The Docker stand-in applies the rule, so §3's status-0 row
      fails without it; the manual docker run settles it.

  Notes for the step definitions:
    • NEVER RUN DOCKER, NEVER RUN THE REAL SUITE, AND NEVER LET A RUN INSTALL ANYTHING. The only
      `docker` a run can reach is the stand-in described below. A run's checkout always holds a
      narrowed suite: the one the scenario names, or else a single passing scenario.
    • RUN THE WORKFLOW; NEVER READ IT FOR AN ASSERTION. "the regression workflow runs on its daily
      schedule" and "the regression workflow is run manually with the runtime X" execute
      `.github/workflows/regression.yml` as a GitHub runner would. Use feature-939's runner and
      its rules: expressions, `env`, `run:` shells, annotations, `$GITHUB_OUTPUT`, the 60-second
      step limit, and a throw for any shape it does not understand. No step asserts on the text
      of the workflow, of `test/Dockerfile` or of `test/docker-run.sh`. Extend the runner:
        – the event is `schedule` or `workflow_dispatch`, and the workflow's `on:` must list it.
          A manual run passes `runtime` as the declared input, and refuses a value outside its
          options. `github.event_name`, `inputs.runtime` and `github.event.inputs.runtime`
          resolve, the last two to an empty string on a scheduled run. `GITHUB_EVENT_NAME` is
          the event;
        – each job runs in a fresh checkout of its own, made from feature-939's listing, with no
          `node_modules`. The `bun` shadow makes `bun install`, whatever its arguments, link
          `node_modules` to the ADW checkout's own and install nothing;
        – a job whose `if:` does not hold is skipped;
        – `actions/upload-artifact` stores, under its `name`, the files its `path` names in the
          job's checkout, and honours `if-no-files-found`. A second upload of a name already
          stored in the run fails, as v4 does;
        – `timeout-minutes` stays ignored.
    • "the @regression suite in the checkout is a single scenario whose step is X" replaces every
      `.feature` file under the checkout's `features/` with one `@regression` feature under
      `features/regression/`. It holds one scenario of one step that no step definition of the
      checkout matches. That step's definition, written beside the checkout's own, returns
      'pending' for `pending`, throws for `failing` and returns for `passing`. For `undefined`
      none is written. "… a single scenario that runs the ADW TypeScript type-check" writes the
      scenario `Given the ADW codebase is checked out` / `Then the ADW TypeScript type-check
      passes` instead, so the checkout's own T22 definition runs. Every checkout of a run gets
      the same suite.
    • "the suite run inside the Docker container exits with status N" sets the exit status of
      the stand-in's `docker run`. A scenario that names none gets 0.
    • The Docker stand-in is a throwaway `docker`, first on PATH. It records every call, with its
      arguments and working directory, and never builds, pulls or runs an image. `build`
      succeeds and marks the image built; `image inspect` succeeds once the image is built;
      `run` exits with the scripted status. Like Docker, `run` refuses a volume or mount whose
      target lies inside a read-only bind mount when the bind's source has no entry at that
      path: it writes Docker's "read-only file system" error to stderr and exits 125 (F1). `run`
      understands `-v` and `--volume`, `--mount` and `--tmpfs`. A flag it does not know throws,
      so no new kind of mount slips past §4. Any other subcommand is recorded and succeeds.
    • "the host job" is the job with the id `host`, and "the docker job" the job with the id
      `docker`. "fails" and "succeeds" assert its conclusion. "runs" holds when it was not
      skipped, and "does not run" when it was. A job the workflow does not define fails every
      one of these assertions, and the message names the jobs the run had. Define these phrases
      for `host` and `docker` only, never for any `{word}`, so that no other feature's job
      phrase collides with them. On failure, show every job's and step's conclusion and output.
    • "the host job uploads the artifact X, which records the scenario's step as Y" holds when a
      step of the host job stored the artifact X, and one of its files is a Cucumber JSON report
      whose one scenario's step, hooks aside, has the status Y.
    • §4 reads every `docker run` the docker job made; there must be at least one. The checkout
      is the docker job's checkout, compared after resolving links.
        – "mounted read-only at /workspace": a read-only bind mount of the checkout at that
          target;
        – "an anonymous volume over P": a volume with no source at the target P;
        – "no other mount … under /workspace is writable": every mount at or below `/workspace`
          is read-only, except that anonymous volume;
        – "no writable mount of the checkout or of anything inside it": every bind mount whose
          source is the checkout, or lies inside it, is read-only.
    • "the @regression suite runs in the checkout" runs the host job's command,
      `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`, in a fresh checkout
      whose `node_modules` links to the ADW checkout's own. The environment is built from
      nothing, as feature-939's is. Before and after the run, list every path under the
      checkout, directories included, ignored or not, except inside `node_modules`. "passes"
      asserts exit 0, and shows the output on failure. "holds no file that was not there before
      the suite ran" asserts that the second list adds nothing to the first, and names any path
      it adds.
    • No step of this feature returns 'pending'. ADW's test phase scores a pending scenario as
      skipped (ADR-0037, Divergence item 3), so it would pass unnoticed.
    • These phrases are defined elsewhere:
        – "the ADW codebase is checked out" in
          `features/step_definitions/ensureCronOnEveryEventSteps.ts`;
        – "the ADW TypeScript type-check passes" in
          `features/regression/step_definitions/thenSteps.ts`.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T22 `the ADW TypeScript type-check passes`, also the scenario §5 runs inside the checkout
  These registered phrases are deliberately NOT reused:
    • T5 `the orchestrator subprocess exited {int}`: no orchestrator runs here, and a job's
      conclusion is not a subprocess's exit code.
  feature-939's "the workflow run fails", "the workflow run succeeds" and the rest are not reused
  either. They run only the envelope-conformance workflow, for a pull request. Their definitions,
  in `feature-939.steps.ts`, are removed by the per-issue sweep 14 days after #939's pull request
  merges. Its runner modules (`feature-939-runner.ts` and the modules it imports) stay, and these
  steps may build on them. The registry has no phrase for the following, so novel phrasing is
  introduced for them: the regression workflow's scheduled and manual runs; its host and docker
  jobs and their conclusions; the uploaded artifact; the exit status and mounts of the Docker
  container; and the @regression suite in a checkout, a run of it there, and the files it leaves.

  # ── §1 THE HOST JOB'S VERDICT IS THE SUITE'S ───────────────────────────────────────────────────

  @adw-962 @adw-9vqzxl-bug-the-daily-regres
  Scenario Outline: Run manually with the runtime "host", the host job <verdict> when the suite's only scenario is <status>, and uploads the results, which record that scenario's step as <recorded>
    Given the @regression suite in the checkout is a single scenario whose step is <status>
    When the regression workflow is run manually with the runtime "host"
    Then the host job <verdict>
    And the host job uploads the artifact "regression-results", which records the scenario's step as <recorded>

    Examples: A scenario that pends, is undefined or fails makes the host job fail
      | status    | verdict | recorded  |
      | pending   | fails   | pending   |
      | undefined | fails   | undefined |
      | failing   | fails   | failed    |

    Examples: A scenario that passes leaves the host job green
      | status  | verdict  | recorded |
      | passing | succeeds | passed   |

  # ── §2 EACH JOB RUNS WHEN IT IS ASKED FOR ──────────────────────────────────────────────────────

  @adw-962 @adw-9vqzxl-bug-the-daily-regres
  Scenario: The daily schedule runs both the host job and the docker job
    When the regression workflow runs on its daily schedule
    Then the host job runs
    And the docker job runs

  @adw-962 @adw-9vqzxl-bug-the-daily-regres
  Scenario Outline: A manual run with the runtime "<runtime>" runs the <runtime> job and not the <other> job
    When the regression workflow is run manually with the runtime "<runtime>"
    Then the <runtime> job runs
    And the <other> job does not run

    Examples:
      | runtime | other  |
      | host    | docker |
      | docker  | host   |

  # ── §3 THE DOCKER JOB'S VERDICT IS ITS CONTAINER'S ─────────────────────────────────────────────

  @adw-962 @adw-9vqzxl-bug-the-daily-regres
  Scenario Outline: Run manually with the runtime "docker", the docker job <verdict> when the suite run inside its container exits with status <status>
    Given the suite run inside the Docker container exits with status <status>
    When the regression workflow is run manually with the runtime "docker"
    Then the docker job <verdict>

    Examples:
      | status | verdict  |
      | 1      | fails    |
      | 0      | succeeds |

  # ── §4 THE CONTAINER SEES THE CHECKOUT ONLY READ-ONLY ──────────────────────────────────────────

  @adw-962 @adw-9vqzxl-bug-the-daily-regres
  Scenario: The docker job's container sees the checkout only read-only at /workspace, with an anonymous volume of its own over /workspace/node_modules
    When the regression workflow is run manually with the runtime "docker"
    Then the docker job starts its container with the checkout mounted read-only at "/workspace"
    And the docker job starts its container with an anonymous volume over "/workspace/node_modules"
    And no other mount the docker job gives its container under "/workspace" is writable
    And the docker job gives its container no writable mount of the checkout or of anything inside it

  # ── §5 THE SUITE WRITES NOTHING INTO THE CHECKOUT ──────────────────────────────────────────────

  @adw-962 @adw-9vqzxl-bug-the-daily-regres
  Scenario: Running the suite's type-check scenario leaves no tsconfig.tsbuildinfo, and no other new file, in the checkout
    Given the @regression suite in the checkout is a single scenario that runs the ADW TypeScript type-check
    When the @regression suite runs in the checkout
    Then the @regression suite run passes
    And the checkout holds no file that was not there before the suite ran

  # ── §6 BACKSTOP ────────────────────────────────────────────────────────────────────────────────

  @adw-962 @adw-9vqzxl-bug-the-daily-regres
  Scenario: TypeScript type-check passes with the regression workflow split into a host job and a docker job
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
