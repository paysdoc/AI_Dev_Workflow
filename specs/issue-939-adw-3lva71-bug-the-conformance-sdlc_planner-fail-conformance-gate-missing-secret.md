# Bug: The envelope conformance gate passes when its live probe cannot run

## Metadata
issueNumber: `939`
adwId: `3lva71-bug-the-conformance`
issueJson: `{"number":939,"title":"bug: the conformance gate fails when its live probe cannot run","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision record\n\nADR-0055 (`## Divergence`).\n\n## What to build\n\nThe envelope-conformance workflow skips its live probe with a warning when the `ANTHROPIC_API_KEY` secret is missing, and reports success. Make a missing secret fail the run.\n\nKeep the note that a probe authenticated by API key never sees the rate-limit event, so that part of the schema stays covered by the committed fixture only.\n\n## Human step\n\nThe repository secret `ANTHROPIC_API_KEY` must exist before this merges, or every later run of the workflow is red. This issue carries `hitl` for that reason: the owner adds the secret, then approves the pull request.\n\n## Acceptance criteria\n\n- [ ] With the secret absent, the workflow run fails with a message naming the secret.\n- [ ] With the secret present, the live probe runs.\n- [ ] The Divergence section of ADR-0055 is replaced by a one-line note of the known limit under More Information.\n","state":"OPEN","author":"paysdoc","labels":["hitl","adw:bug"],"createdAt":"2026-10-01T19:20:13Z","comments":[],"actionableComment":null}`

## Bug Description
The specification is item 1 of `## Divergence` in `specs/adr/0055-rate-limit-structured-signals-two-tier-wait.md` (lines 74–76).

`.github/workflows/envelope-conformance.yml` has two legs:
- The offline leg, `bun run jsonl:check`, checks the committed fixtures against `adws/jsonl/schema.json` and ADW's parsers.
- The live leg, `bun run jsonl:probe:check`, runs a one-turn probe against the pinned Claude CLI (2.1.282). It fails when a probe-owned entry (`system/init`, `assistant`, `result/success`) is not observed or lacks a required field.

The live leg runs only when the repository secret `ANTHROPIC_API_KEY` exists:
- The job sets `HAS_ANTHROPIC_KEY: ${{ secrets.ANTHROPIC_API_KEY != '' }}` (line 22).
- The live step has `if: env.HAS_ANTHROPIC_KEY == 'true'` (line 49).
- A second step, `Live envelope check skipped` (lines 54–56), runs when the secret is absent and only prints a `::warning` annotation.

The secret has never existed, so the live leg has never run in CI and every run is green.

Observed on 2026-10-02:
- `gh secret list` shows `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `SLACK_WEBHOOK_URL` and `SOCKET_API_TOKEN`. There is no `ANTHROPIC_API_KEY`. `gh secret list --app dependabot` shows no Dependabot secrets.
- The last eight runs of the workflow (2026-10-01) all concluded `success`.
- In run `36938167526` (push to `dev`):
  - `Live envelope check against the pinned CLI` is `skipped`.
  - `Live envelope check skipped` is `success`.
  - The run carries the warning "ANTHROPIC_API_KEY secret is not set, so the live probe of Claude CLI 2.1.282 was skipped. Only the committed schema, fixtures and parsers were checked."

**Expected** (owner's ruling, 2026-10-01): the live probe is the decision. A missing secret fails the run with a message naming the secret, and does not warn. With the secret present, the live probe runs.

**Actual:** a missing secret produces a warning and a green run. An envelope change that only the live probe can see passes CI unnoticed.

## Problem Statement
The workflow treats its live leg as optional. No path through the job may skip the live leg while the run still succeeds. ADR-0055 must also stop recording the divergence: its `## Divergence` section is replaced by a one-line note of the known limit under `## More Information`.

## Solution Statement
- **Workflow.** Make the live step unconditional. It receives the secret as before. Its script first tests the key:
  - When `ANTHROPIC_API_KEY` is empty, it prints an `::error` annotation naming the secret and exits 1.
  - Otherwise it runs `bun run jsonl:probe:check`.

  Delete the job-level `HAS_ANTHROPIC_KEY` and the `Live envelope check skipped` step.
  - A secret that does not exist evaluates to the empty string in `${{ secrets.ANTHROPIC_API_KEY }}`, so `[ -z "${ANTHROPIC_API_KEY}" ]` is the test.
  - **Why the guard goes inside the live step, not in a separate fail-fast step:**
    - The secret keeps reaching exactly one step, as ADR-0057 records under Confirmation: "The secret of the same name in CI reaches one step only, the live probe".
    - The offline leg still runs and reports before it.
    - No condition is left that could skip the live leg.
  - **Why not in `adws/jsonl/schemaProbe.ts`:** the same probe runs locally on the operator's subscription login, with no key. ADR-0057 makes the subscription the default. Requiring the key is a CI rule, so it lives in the workflow.
- **The known limit is kept** in two places:
  - a two-line YAML comment over the live step, where whoever bumps the CLI pin will read it;
  - the one-line note in ADR-0055.
- **ADR-0055.** Delete the `## Divergence` section. Add the one-line note under `## More Information`. Change nothing else, per the write-an-adr rules; the note itself is the owner's explicit instruction in this issue.
- **Documents.** Correct the four sentences that describe the optional live leg:
  - `README.md` line 19;
  - `app_docs/feature-9gjajh-jsonl-schema.md` lines 5 and 31;
  - `app_docs/feature-9gjajh-root-config.md` line 26.
- **Test.** Add a contract test, `adws/__tests__/envelopeConformanceWorkflow.test.ts`, in the style of `adws/__tests__/deployWorkersWorkflow.test.ts`. It runs the live step's own script under `bash -e`, the shell Actions uses for a `run` step with no `shell`, once with an empty key and once with a key.
- **Scenarios.** Write the step definitions for `features/per-issue/feature-939.feature`. They run the whole workflow file the way a GitHub runner would, against a stand-in Claude CLI, and check only what the run produces:
  - §1 (AC1): with the secret absent, the run fails, an error names `ANTHROPIC_API_KEY`, and no warning names it;
  - §2 (AC2): with the secret present, the live probe runs on that key, and a conforming answer without a rate-limit event leaves the run green;
  - §3: with the secret present, an answer that lacks a required field fails the run, naming the field;
  - §4: the type-check passes.

  AC3 has no scenario. It is a documentation change, checked by review and by the grep checks under Validation Commands.

## Steps to Reproduce
1. `gh secret list --repo paysdoc/AI_Dev_Workflow` lists no `ANTHROPIC_API_KEY`.
2. `gh run list --repo paysdoc/AI_Dev_Workflow --workflow envelope-conformance.yml --limit 8 --json conclusion,event,headBranch` shows every run as `success`.
3. `gh run view 36938167526 --repo paysdoc/AI_Dev_Workflow --json jobs --jq '.jobs[] | .steps[] | "\(.name): \(.conclusion)"'` prints:
   - `Live envelope check against the pinned CLI: skipped`
   - `Live envelope check skipped: success`
4. Locally, `grep -n -E "HAS_ANTHROPIC_KEY|::warning|if: env" .github/workflows/envelope-conformance.yml` shows the skip path on lines 22, 49, 55 and 56.
5. Locally, `grep -c 'secrets.ANTHROPIC_API_KEY' .github/workflows/envelope-conformance.yml` prints `2`: the secret is read at job level and in the live step.
6. Once the contract test of step 2 exists, `bunx vitest run adws/__tests__/envelopeConformanceWorkflow.test.ts` against the unfixed workflow fails three of its four cases:
   - the skip path exists;
   - the secret appears twice;
   - an empty key runs the probe and exits 0 instead of failing.
7. Once the step definitions of step 3 exist, `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-939"` against the unfixed workflow fails §1 of `features/per-issue/feature-939.feature`: the run without the secret is green and raises a `::warning` naming `ANTHROPIC_API_KEY`. §2, §3 and §4 pass.

## Root Cause Analysis
The live leg was optional by design. The plan for #909 (`specs/issue-909-adw-uk9ams-stream-json-envelope-sdlc_planner-envelope-conformance-gate.md`, Solution item 7 and task 9) said to "run `bun run jsonl:probe:check` when an `ANTHROPIC_API_KEY` secret is present and emit a workflow warning when it is not (the repo has no such secret today, so the PR is green and the live leg activates the moment the human adds it)".

Creating the secret was left to the human and never happened. The absent-secret path only emits a `::warning`, so nothing turned red and nobody noticed. The owner has since ruled that the live probe is the decision.

The workflow encodes "optional" in three places, and the fix removes all three:
- the job env `HAS_ANTHROPIC_KEY` (lines 21–22);
- the `if:` on the live step (line 49);
- the warning step (lines 54–56).

No code change is needed for the probe to authenticate in CI. `getSafeSubprocessEnv()` in `adws/core/environment.ts` passes `ANTHROPIC_API_KEY`, the first entry of `SAFE_ENV_VARS`, to the CLI subprocess that `adws/jsonl/schemaProbe.ts` spawns.

## Relevant Files
Use these files to fix the bug:

- `.github/workflows/envelope-conformance.yml` — the gate:
  - lines 21–22: `HAS_ANTHROPIC_KEY`;
  - lines 48–52: the conditional live step;
  - lines 54–56: the warning step.
- `specs/adr/0055-rate-limit-structured-signals-two-tier-wait.md` — the specification (`## Divergence`, lines 74–76). That section is replaced by a one-line note under `## More Information` (lines 78–84).
- `specs/adr/0057-subscription-by-default-api-key-by-choice.md` — Confirmation, line 48: the CI secret reaches one step only, the live probe. The fix keeps that true. More Information, line 62, points to "the Divergence section of ADR-0055"; see Notes.
- `.claude/skills/write-an-adr/SKILL.md` — once an ADR is accepted, only `status`, `superseded-by`, `## Divergence` and the supersession note may change. The note in ADR-0055 is the owner's explicit instruction in this issue. Nothing else in any ADR changes.
- `specs/issue-909-adw-uk9ams-stream-json-envelope-sdlc_planner-envelope-conformance-gate.md` — the plan that made the live leg optional. It also records the known limit: an API-key probe never sees `rate_limit_event`.
- `adws/jsonl/schemaProbe.ts` — the `bun run jsonl:probe:check` entry point (`--check`). It exits 1 on:
  - an unobserved probe-owned type;
  - a missing required field;
  - a CLI that produced no output.

  It prints a missing required field by its path on stderr, for example `Missing required fields: result/success.is_error`; that is the error §3 expects. Unchanged.
- `adws/jsonl/schemaMerge.ts` — `PROBE_OWNED_TYPES` is `system/init`, `assistant` and `result/success`, so the live check never requires `rate_limit_event` (§2). `findLiveDrift` checks only that fields are present. Unchanged.
- `adws/core/environment.ts` — unchanged:
  - `SAFE_ENV_VARS` and `getSafeSubprocessEnv()` forward `ANTHROPIC_API_KEY` to the probe's CLI subprocess.
  - `resolveClaudeCodePath()` uses `CLAUDE_CODE_PATH` when it is set and `which claude` otherwise. With `CLAUDE_CODE_PATH` unset, the probe reaches the scenarios' stand-in `claude` on PATH.
  - `dotenv.config()` runs on import. That is why the scenarios run in a throwaway checkout: the host's env file could otherwise set `CLAUDE_CODE_PATH` or `ANTHROPIC_API_KEY`.
- `features/per-issue/feature-939.feature` — this issue's BDD scenarios (§1–§4; see Solution Statement):
  - They execute `.github/workflows/envelope-conformance.yml` as a GitHub runner would, in a throwaway copy of the checkout, against a stand-in `claude` on PATH. They never read the workflow for an assertion.
  - Its "Notes for the step definitions" specify the runner, the checkout, the environment, the stand-in and every phrase.
  - The file exists, so the build agent runs in TDD mode (`/implement-tdd`, `adws/agents/buildAgent.ts:72-73`) and writes the step definitions in `features/per-issue/step_definitions/`.
- `features/per-issue/step_definitions/feature-936-workflowConfig.ts` — the precedent for reading a workflow file in step definitions without a YAML library. It understands only block-style YAML, and any shape it does not know throws.
- `adws/jsonl/fixtures/session-rate-limited.jsonl`, `adws/jsonl/fixtures/assistant-text.jsonl`, `adws/jsonl/fixtures/result-success.jsonl` — the committed captures from which the scenarios build the stand-in's conforming answer.
- `features/step_definitions/ensureCronOnEveryEventSteps.ts` and `features/regression/step_definitions/thenSteps.ts` — they define `the ADW codebase is checked out` and `the ADW TypeScript type-check passes`, which §4 reuses. Do not redefine them.
- `package.json` — the `jsonl:check` and `jsonl:probe:check` scripts. Unchanged.
- `adws/__tests__/deployWorkersWorkflow.test.ts` — the precedent: a contract test that reads a workflow file as text, with no YAML dependency.
- `test/mocks/__tests__/claude-cli-stub.test.ts` — the precedent for spawning a subprocess from a Vitest test.
- `adws/checkGitGhGuard.ts` — `bun run lint:git-guard` flags only commands that start with `git` or `gh`. The new test spawns `bash` and a fake `bun`, so it passes the guard. `features/` is exempt, so the step definitions may run `git ls-files` to build their throwaway checkout.
- `vitest.config.ts` — `adws/**/__tests__/**/*.test.ts` picks up the new test.
- `README.md` — line 19 says the workflow runs `jsonl:probe:check` "once an `ANTHROPIC_API_KEY` secret is configured". Line 958 (the directory tree) is not wrong and stays as it is.
- `.github/dependabot.yml` — Dependabot opens weekly `@paysdoc/devplatform` bump PRs against `dev`. Their `pull_request` runs see Dependabot secrets, not Actions secrets; see Notes.
- `.adw/coding_guidelines.md` — the guidelines. Comments say only what the code cannot (ADR-0054).
- Conditional docs (from `.adw/conditional_docs.md`):
  - `app_docs/feature-9gjajh-jsonl-schema.md` — its condition covers the CI envelope conformance gate. Lines 5 and 31 describe the optional live leg. Line 37 (Gotchas) already records the known limit and stays.
  - `app_docs/feature-9gjajh-root-config.md` — covers `.github/workflows/`. Line 26 says the live check runs "only when an `ANTHROPIC_API_KEY` secret is configured, warning instead of failing when it is not".

### New Files
- `adws/__tests__/envelopeConformanceWorkflow.test.ts` — a contract test proving that the live leg cannot be skipped, that the secret reaches the live step only, that a missing key fails with a message naming it, and that a present key runs the probe.
- `features/per-issue/step_definitions/feature-939*.ts` — the step definitions for `feature-939.feature`, with the workflow runner and the stand-in Claude CLI they need. Name them like the `feature-936-*` files.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the specification and confirm the baseline
- Read `## Divergence` in `specs/adr/0055-rate-limit-structured-signals-two-tier-wait.md`.
- Read `### Confirmation` and `## More Information` in `specs/adr/0057-subscription-by-default-api-key-by-choice.md`.
- Read `.github/workflows/envelope-conformance.yml` and `adws/__tests__/deployWorkersWorkflow.test.ts`.
- Run `bun run test:unit` and note the baseline file and test counts.

### 2. Write the contract test (red)
- Create `adws/__tests__/envelopeConformanceWorkflow.test.ts`.
- Follow `deployWorkersWorkflow.test.ts` for the setup:
  - Read `.github/workflows/envelope-conformance.yml` with `fs`, resolved from `__dirname` (`fileURLToPath(import.meta.url)`).
  - Make text assertions only; do not add a YAML dependency.
  - One short header comment may say why the contract exists. No issue numbers (ADR-0054).
- Module-level values:
  - `liveStep`: split the workflow on `/^ {6}- name: /m` and take the chunk that starts with `Live envelope check against the pinned CLI`.
  - `liveScript`: from a small named function that reads the step's `run:` value in either form:
    - inline: the text after `run: `. The unfixed workflow uses this form, `run: bun run jsonl:probe:check`.
    - block (`run: |`): the following lines up to the first non-blank line indented less than the block, with the block's indentation removed.

    Supporting both forms makes the red run fail for the real reason, a missing guard, rather than a parse error.
- Fake `bun`:
  - In `beforeAll`, create a temp directory with `fs.mkdtempSync(path.join(os.tmpdir(), 'adw-envelope-gate-'))`.
  - Write an executable `bun` into it (mode `0o755`) containing `#!/bin/sh` and `echo "bun $*"`.
  - Remove the directory in `afterAll`.
- `runLiveStep(apiKey: string | undefined)`:
  - Returns `spawnSync('bash', ['-e', '-c', liveScript], { env, encoding: 'utf-8' })`.
  - `env` is a fresh object, so the developer's own `ANTHROPIC_API_KEY` never leaks in. It holds:
    - `PATH`: the fake-bin directory, then `process.env.PATH`;
    - `CLAUDE_CLI_VERSION: '2.1.282'`;
    - `ANTHROPIC_API_KEY` only when `apiKey` is defined.
- Cases:
  1. **The live step cannot be skipped or softened.**
     - The workflow does not contain `HAS_ANTHROPIC_KEY`, `::warning` or `Live envelope check skipped`.
     - `liveStep` has no `if:` key (match `/^\s+if:/m`, so the script's own `if [` does not count) and no `continue-on-error`.
  2. **The secret reaches the live step only.**
     - `secrets.ANTHROPIC_API_KEY` occurs exactly once in the workflow.
     - `liveStep` contains `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}`.
  3. **A missing secret fails the step with a message naming it.** Use `it.each` over `''` (what Actions passes for a secret that does not exist) and `undefined` (variable unset):
     - `status` is `1`;
     - `stdout` contains `::error` and `ANTHROPIC_API_KEY`;
     - `stdout` does not contain `bun run`.
  4. **A present secret runs the live probe.** With `'test-key'`:
     - `status` is `0`;
     - `stdout` contains `bun run jsonl:probe:check`;
     - `stdout` does not contain `::error`.
- Keep nesting at depth 2 or less and extract any callback longer than about 3 lines into a named function (coding guidelines).
- Run `bunx vitest run adws/__tests__/envelopeConformanceWorkflow.test.ts`. Against the current workflow, cases 1, 2 and 3 fail and case 4 passes.

### 3. Write the step definitions for the scenarios (red)
- Read `features/per-issue/feature-939.feature` in full. Its "Notes for the step definitions" are the specification of the runner, the checkout, the environment, the stand-in `claude` and each phrase. Follow them exactly. In particular:
  - **Never spawn the real Claude CLI, and never let the run install anything.**
    - `claude` and `npm` are stand-ins on PATH.
    - `bun install` is shadowed to do nothing, and every other `bun` command runs the real `bun`.
  - **Run the workflow; never read it for an assertion.**
    - The workflow file is read only to execute it, with a block-YAML reader like `feature-936-workflowConfig.ts`.
    - A shape the reader does not know throws, which is a scenario error, never a failed run.
    - Add no YAML library.
    - The text assertions belong to the Vitest contract test of step 2, not to the step definitions.
  - **Run in a throwaway checkout.**
    - The run happens in a throwaway copy of the files that `git ls-files --cached --others --exclude-standard` lists, with `node_modules` linked to the ADW checkout's own. It never runs in the ADW checkout itself.
    - The environment is built from nothing: no `ANTHROPIC_API_KEY`, `CLAUDE_CODE_PATH` or `MOCK_*` from the host.
    - Remove every temporary directory after each scenario, in an `After` hook scoped to `@adw-939`.
  - **Pick a timeout for the When step.** The runner kills a workflow step after 60 seconds, and that is also the default step timeout set in `features/regression/support/hooks.ts`. Give the When step a longer timeout, so that a hung step fails the run instead of timing out the scenario.
- Reuse the existing §4 phrases (see Relevant Files) and define every other phrase of the file.
- Follow the coding guidelines: nesting depth of 2 or less, named helpers, no `any`.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-939"`. Against the current workflow:
  - §1 fails on `Then the workflow run fails`, because the run is green and raises a warning naming `ANTHROPIC_API_KEY`;
  - §2, §3 and §4 pass.

  A scenario error does not count as red: fix the step definitions until §1 fails on that assertion.

### 4. Make the live step mandatory
- In `.github/workflows/envelope-conformance.yml`, delete the job-level `env:` block (lines 21–22, `env:` and `HAS_ANTHROPIC_KEY: ...`). The job has no other job-level env.
- Replace the live step (lines 48–52) and delete the warning step (lines 54–56), so the job ends like this:
  ```yaml
      timeout-minutes: 10

      steps:
        # ... Checkout, Set up Bun, Set up Node, Install dependencies, Install the pinned Claude CLI,
        # ... Assert the installed CLI is the pinned version, and the jsonl:check step: all unchanged ...

        # The probe runs on the API key, and only subscription logins receive rate_limit_event,
        # so that schema entry is covered by the committed fixture alone.
        - name: Live envelope check against the pinned CLI
          env:
            ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          run: |
            if [ -z "${ANTHROPIC_API_KEY}" ]; then
              echo "::error title=Envelope conformance::ANTHROPIC_API_KEY secret is not set, so the live probe of Claude CLI ${CLAUDE_CLI_VERSION} cannot run. Add the ANTHROPIC_API_KEY repository secret (Dependabot pull requests read Dependabot secrets, not Actions secrets)."
              exit 1
            fi
            bun run jsonl:probe:check
  ```
- Keep everything else unchanged:
  - the triggers;
  - `CLAUDE_CLI_VERSION` and its comment block;
  - the job name, `runs-on` and `timeout-minutes`;
  - every other step.
- Keep the order. The offline leg runs first, so its result is reported even when the secret is missing.
- The YAML comment is the only comment added. It states a limit the YAML cannot show (ADR-0054). Do not add others.
- Run `bunx vitest run adws/__tests__/envelopeConformanceWorkflow.test.ts`; all four cases pass.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-939"`; all four scenarios pass.

### 5. Replace the Divergence section of ADR-0055
- In `specs/adr/0055-rate-limit-structured-signals-two-tier-wait.md`, delete lines 74–77: the `## Divergence` heading, its blank line, item 1 and the blank line after it. The last bullet of `### Confirmation` ("The repository has no required status checks, …") is then followed by one blank line and `## More Information`.
- Add this bullet as the first bullet under `## More Information`. It must be a single line:
  ```md
  * Known limit: the live probe in CI authenticates with the secret `ANTHROPIC_API_KEY`, and a probe authenticated by API key never sees the rate-limit event, so that part of the schema is covered by the committed fixture only. The key's effect on billing is in [ADR-0057](0057-subscription-by-default-api-key-by-choice.md).
  ```
- Change nothing else in the ADR:
  - the front matter (`status: accepted`, dates, provenance);
  - `### Confirmation`, which records the check of 2026-09-29;
  - the other bullets.
- Do not edit `specs/adr/README.md`. The status stays `accepted`, and the index does not list divergences.
- Do not edit ADR-0057 or ADR-0021 (see Notes).

### 6. Correct the documents that describe the optional live leg
- `README.md`, line 19. Replace the last sentence:
  - from: `` `.github/workflows/envelope-conformance.yml` runs `jsonl:check` on every pull request against a pinned Claude CLI version, plus `jsonl:probe:check` once an `ANTHROPIC_API_KEY` secret is configured. ``
  - to: `` `.github/workflows/envelope-conformance.yml` runs `jsonl:check` and the live `jsonl:probe:check` on every pull request against a pinned Claude CLI version; the live check authenticates with the `ANTHROPIC_API_KEY` secret, and a missing secret fails the run. ``
- `app_docs/feature-9gjajh-jsonl-schema.md`, line 5. Replace the last sentence:
  - from: `` `.github/workflows/envelope-conformance.yml` runs the checker (and, once a secret is configured, the live probe's read-only `--check` mode) on every pull request. ``
  - to: `` `.github/workflows/envelope-conformance.yml` runs the checker and the live probe's read-only `--check` mode on every pull request. ``
- `app_docs/feature-9gjajh-jsonl-schema.md`, line 31. Replace the clause after the semicolon:
  - from: `` `ANTHROPIC_API_KEY` is the CI secret that gates whether the live leg runs at all. ``
  - to: `` in CI the session authenticates with the `ANTHROPIC_API_KEY` secret, and a missing secret fails the run with an error naming it. ``
- `app_docs/feature-9gjajh-jsonl-schema.md`, line 37 (Gotchas: an API-key probe never observes `rate_limit_event`) stays as it is. It is the same known limit.
- `app_docs/feature-9gjajh-root-config.md`, line 26. Replace the end of the `envelope-conformance.yml` description:
  - from: `` runs `bun run jsonl:check` unconditionally, then `bun run jsonl:probe:check` only when an `ANTHROPIC_API_KEY` secret is configured, warning instead of failing when it is not). ``
  - to: `` runs `bun run jsonl:check`, then `bun run jsonl:probe:check`, which authenticates with the `ANTHROPIC_API_KEY` secret and fails the run with an error naming the secret when it is missing). ``
- Do not edit `.adw/conditional_docs.md`. Its condition text still fits.

### 7. Run the validation commands
- Run every command under `Validation Commands` and fix anything that fails before finishing.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

**Lint, type checks and build**
- `bun run lint` — ESLint, including the new test and the new step definitions.
- `bunx tsc --noEmit` — type check, including the new step definitions. §4 runs this same check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — type check of `adws/`, including the new test.
- `bun run build` — build.
- `bun run lint:git-guard` — the new test under `adws/` must not shell out to git or gh.
- `bun run lint:docs-index` — the two edited living docs still pass the docs-index health gate.

**Tests**
- `bunx vitest run adws/__tests__/envelopeConformanceWorkflow.test.ts` — the contract test. Before step 4, cases 1–3 fail (the bug reproduced). After step 4, all pass.
- `bun run test:unit` — the full unit suite: the step-1 baseline plus the new file, all passing.
- `bun run jsonl:check` — the offline leg still exits 0. No schema or fixture changed.

**Checks on the edited files.** Before the fix, every check except the third fails; after it, all succeed.
- `! grep -n -E "HAS_ANTHROPIC_KEY|::warning|if: env" .github/workflows/envelope-conformance.yml` — the skip path is gone.
- `test "$(grep -c 'secrets.ANTHROPIC_API_KEY' .github/workflows/envelope-conformance.yml)" = 1` — the secret reaches one step only.
- `grep -n 'bun run jsonl:probe:check' .github/workflows/envelope-conformance.yml` — the live step still runs the probe.
- `! grep -n '^## Divergence' specs/adr/0055-rate-limit-structured-signals-two-tier-wait.md` — the section is removed.
- `test "$(sed -n '/^## More Information/,$p' specs/adr/0055-rate-limit-structured-signals-two-tier-wait.md | grep -c '^\* Known limit:')" = 1` — exactly one known-limit note, under `## More Information`.
- ``! grep -rn -E 'once an `ANTHROPIC_API_KEY` secret is configured|once a secret is configured|gates whether the live leg runs|warning instead of failing' README.md app_docs/`` — no document still describes the optional leg. Before the fix this matches exactly the four sentences of step 6.

**Scenarios**
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-939"` — the four scenarios of `features/per-issue/feature-939.feature`. Before step 4, §1 fails: the run without the secret is green and warns. §2, §3 and §4 pass. After step 4, all four pass. No scenario may reach the real Claude CLI or install anything.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite.

## Notes
- **Guidelines.** Follow `.adw/coding_guidelines.md` strictly:
  - nesting depth of 2 or less;
  - named helpers instead of long inline callbacks;
  - no `any`;
  - immutable values, with a fresh `env` object per run;
  - comments only for what the code cannot say, with no issue numbers (ADR-0054).
- **No new library.** The test uses `fs`, `os`, `path` and `child_process` only. It reads the workflow as text, like `deployWorkersWorkflow.test.ts`. `yaml` is only a transitive dependency and is deliberately not imported. The step definitions do not import it either: they read the workflow with a block-YAML reader, as `feature-936-workflowConfig.ts` does.
- **Human steps (`hitl`).** These are owner actions; the build agent cannot perform them.
  - **Before merge:** `gh secret set ANTHROPIC_API_KEY --repo paysdoc/AI_Dev_Workflow`. Until then this PR's own conformance run fails at `Live envelope check against the pinned CLI`, with the error annotation naming `ANTHROPIC_API_KEY`. That failure is acceptance criterion 1, shown on the real workflow:
    - `gh run list --workflow envelope-conformance.yml --branch bugfix-issue-939-fail-conformance-gate-missing-secret --limit 1` shows `failure`;
    - `gh run view <id> --json jobs --jq '.jobs[] | .steps[] | "\(.name): \(.conclusion)"'` shows that step as `failure`.
  - **After adding the secret:** `gh run rerun <id>` runs the live step with the key. Its log shows `Observed types: …` and `Live envelope check passed.` That is acceptance criterion 2. Then approve the PR.
- **Dependabot.** Runs triggered by Dependabot see Dependabot secrets, never Actions secrets.
  - With this fix, every `@paysdoc/devplatform` bump PR fails the gate unless the owner also runs `gh secret set ANTHROPIC_API_KEY --app dependabot --repo paysdoc/AI_Dev_Workflow`. Today there are no Dependabot secrets.
  - The red check does not block a merge, because the repository has no required status checks and bump PRs are merged by hand.
  - The owner's ruling allows no exception, so the workflow adds none. The error text mentions Dependabot so that a red bump PR explains itself.
  - Pull requests from forks never receive secrets and would fail the same way. The repository receives none today.
- **Billing.** Each run makes one `haiku` `say hello` call on the API key, on every pull request and every push to `dev` and `main`. ADR-0057 records that the key moves billing to the API. In CI it reaches this one step only, and no workflow runs pipeline agents.
- **The live leg's first real run.**
  - The probe-owned entries were last reconciled from an operator session on the subscription login. The check is presence-only and ignores added fields, so an API-key session should pass.
  - If the first live run reports a missing required field or an unobserved type, the gate has found a real difference between the two login kinds. That is not a defect of this fix.
  - In that case, reproduce it locally with the key set (`bun run jsonl:probe:check`) and handle it in a follow-up issue. Do not weaken the check here.
- **ADR text left alone, following the write-an-adr rules and the precedent of #936:**
  - **ADR-0057, More Information line 62** says the CI secret "is recorded in the Divergence section of ADR-0055". After this PR the secret is recorded in ADR-0055's More Information note instead. If the owner wants the pointer fixed, change "in the Divergence section of ADR-0055" to "under More Information in ADR-0055".
  - **ADR-0021, Confirmation line 69** ("a live probe when an API key is configured") is a dated record of a check.
- **Out of scope, observed in run `36938167526`:**
  - the Node 20 deprecation warning for `actions/checkout@v4` and `actions/setup-node@v4`;
  - the notice that `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19.
- **Out of scope, recorded by the scenario agent (F2 in `feature-939.feature`): a key the API rejects still passes the live leg.**
  - A made-up key once reached a real Claude CLI. The CLI answered with an API-error assistant message and a `result/success` message, and the presence-only check reported "Live envelope check passed".
  - A revoked, expired or mistyped secret would therefore leave the run green without a successful probe.
  - The issue's criteria name only the absent secret, so this fix leaves that case alone, and no scenario pins it. Whether the gate should also fail on it is the owner's call.
- **Uncommitted `.claude/` changes in the worktree.** The worktree has uncommitted edits under `.claude/commands/` and `.claude/skills/depaudit-triage/` that predate this plan. They revert newer prompt text on the branch. They are not part of this fix and must not be committed with it (ADR-0056).
- **BDD scenarios.**
  - The separate scenario agent wrote `features/per-issue/feature-939.feature`; this plan does not write scenarios.
  - The build agent writes its step definitions (step 3). They assert only on what a run produces: its conclusion, annotations and step output, and what the stand-in CLI recorded. They never assert on the workflow's text.
  - The structural checks (no skip path; the secret used once) stay in the Vitest contract test.
