---
status: accepted
date: 2026-03-23
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-275-adw-3n5bwi-mock-infrastructure-sdlc_planner-mock-infrastructure-layer.md
  - kind: contemporaneous
    source: specs/issue-277-adw-8fyj7u-regression-periodic-sdlc_planner-regression-github-action.md
  - kind: contemporaneous
    source: specs/issue-279-adw-6bi1qq-fixture-target-repo-sdlc_planner-fixture-repo-test-harness.md
  - kind: contemporaneous
    source: specs/issue-280-adw-02r4w9-jsonl-schema-probe-c-sdlc_planner-jsonl-schema-probe-ci-check.md
  - kind: contemporaneous
    source: specs/issue-281-adw-78celh-docker-image-for-beh-sdlc_planner-docker-behavioral-test-isolation.md
supersedes: []
superseded-by: []
---

# Behavioural test harness with mocked external boundaries

## Context and Problem Statement

ADW's orchestrators coordinate three external systems: the Claude Code CLI, the GitHub API and git remotes. In March 2026 the BDD scenarios only checked "code structure and patterns (no API calls or external services)" (#277 spec). The #275 spec states the gap: "there is no way to test these orchestration flows without calling real services, which is slow, expensive, non-deterministic, and blocks CI automation". The decision covers `test/mocks/`, `test/fixtures/`, `adws/jsonl/`, `test/Dockerfile` and `.github/workflows/regression.yml`.

## Decision Drivers

* Tests must run real orchestration code, not a model of it.
* Test runs must be deterministic and free of LLM cost.
* A change in the Claude CLI's output format must fail loudly, not corrupt cost tracking silently (#280).

## Considered Options

For routing GitHub calls to the mock (#275 spec notes):

* Point the `gh` CLI at the mock through `GH_HOST`
* Intercept at the provider interface

Otherwise none recorded.

## Decision Outcome

ADW is tested by mocking its three external boundaries and running everything between them for real.

* **Claude CLI stub** (`test/mocks/claude-cli-stub.ts`). Selected through the existing `CLAUDE_CODE_PATH` variable. It accepts the real CLI's arguments and streams canned JSONL. Fixtures are split into envelope (message structure) and payload (agent content).
* **GitHub API mock server** (`test/mocks/github-api-server.ts`). A local HTTP server with fixture defaults, state that a Given step can set, and a record of every request for Then steps to assert on.
* **Git remote mock** (`test/mocks/git-remote-mock.ts`). A `git` wrapper placed first on `PATH`. It answers `push`, `fetch`, `clone`, `pull` and `ls-remote` without a network; every local git operation runs for real.
* **Harness and fixture repo.** `test/mocks/test-harness.ts` starts and stops the three mocks and restores every environment variable it changed. `test/fixtures/cli-tool/` is a minimal target repo, copied to a fresh temporary directory and initialised with git for each scenario.
* **Envelope conformance (#280).** A probe makes one short real CLI call and writes the envelope schema to `adws/jsonl/schema.json`, which is committed. A conformance check validates the fixtures against that schema and through ADW's own parsers.
* **Docker is optional (#281).** `test/Dockerfile` holds only Bun and git; the repo is mounted at run time. The suite must give the same result on the host.
* **Scheduled regression run (#277).** `.github/workflows/regression.yml` runs the `@regression` scenarios daily and on manual dispatch. At the time, failures were "informational, not blocking".

For the GitHub routing, the harness sets `GH_HOST` and `MOCK_GITHUB_API_URL` (`test/mocks/test-harness.ts`). The sources do not say why this option won.

### Consequences

* Good, because code that calls the Claude CLI, GitHub or a git remote can be run in a scenario without spending tokens or touching the network.
* Good, because envelope drift in the Claude CLI is caught in CI before it reaches a workflow.
* Bad, because fixtures are hand-maintained payloads and must follow every change in agent output.
* Bad, because building the harness did not make scenarios use it. A month later the BDD rewrite PRD found it "is barely used by the scenarios themselves".
* Good, because the harness now carries a whole orchestrator run, which the #492 spec recorded as out of reach: mocking "the orchestrator's full GitHub App auth + target-repo workspace + end-to-end Claude pipeline". The subprocess harness of [ADR-0037](0037-tiered-regression-suite-with-fixed-vocabulary.md) runs `adwSdlc.tsx` and `adwChore.tsx` to completion as child processes, against a throwaway target workspace and with a fake `GITHUB_PAT`. The Claude CLI stub answers each slash command from a per-command manifest. A `gh` shadow stands in for GitHub, and its writes are replayed against the GitHub API mock after the child exits.

### Confirmation

Checked against the code on 2026-09-29:

* The files named above exist. `features/regression/support/hooks.ts` calls `setupMockInfrastructure()` before scenarios.
* `test/mocks/__tests__/` holds three Vitest files. `bunx vitest run` passed `manifestInterpreter.test.ts` (9 tests) and `test-harness.test.ts` (3 tests); `claude-cli-stub.test.ts` could not be loaded because `@paysdoc/devplatform` is not installed in this checkout.
* CI gate: `.github/workflows/envelope-conformance.yml` runs `bun run jsonl:check` on every pull request and on pushes to `dev` and `main`, and a live probe when an API key is configured.
* `.github/workflows/regression.yml` has a `host` and a `docker` job. The daily schedule runs both; a manual dispatch runs the one its `runtime` input names. It is not a required check (ADR-0037, Divergence, item 2). A local run of the `@regression` suite on 2026-10-03 reported no pending, undefined or failed scenario and exited 0.
* Not checked: whether the GitHub adapter in `@paysdoc/devplatform` honours `GH_HOST`. The package is not installed in this checkout.

## More Information

* The issues name `specs/prd/prd-review-revamp.md` as parent PRD. That file is not in the repository and `git log --all` finds no commit that ever contained it. The rationale above comes from the issue specs.
* The #275 spec proposed `Bun.serve()` for the mock server. The server uses Node's `http.createServer`, which fits [ADR-0009](0009-bun-as-package-manager-node-as-runtime.md).
* The stub became programmable through per-test manifests (`test/mocks/manifestInterpreter.ts`) in ADR-0037. The conformance gate was extended in [ADR-0055](0055-rate-limit-structured-signals-two-tier-wait.md).
* The proof-comment and screenshot issues of the same PRD (#274, #276, #278) are recorded in [ADR-0022](0022-review-proof-in-r2-behind-router-worker.md).
