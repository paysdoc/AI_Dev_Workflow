# Bug: Regression Then steps T1 and T5 assert on source text instead of runtime artefacts

## Metadata
issueNumber: `960`
adwId: `f2mx98-bug-regression-then`
issueJson: `{"number":960,"title":"bug: regression Then steps T1 and T5 assert on source text instead of runtime artefacts","body":"Source: the `## Divergence` section of `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, item 4. It states the facts and the owner's ruling. Read it before planning.\n\nSplit from #935, which was too large for one run and is closed. The facts below come from #935's planning research. Check them against the code before relying on them.\n\n## What to build\n\nTwo Then steps in `features/regression/step_definitions/thenSteps.ts` pass by reading source files:\n\n- **T1** `the state file for adwId {string} records workflowStage {string}`. It branches on `this.mockContext === null`, which is true in every scenario the `@regression` hooks do not reach. It then reads `adws/adwSdlc.tsx` and `adws/phases/authPause.ts` and passes on `.includes(...)`. Outside the hooks it passes for `paused_auth` whatever the state file says, and even when there is no state file.\n- **T5** `the orchestrator subprocess exited {int}`. It reads `authPause.ts` the same way, and passes for `0` whether or not anything ran.\n\nMake both assert on runtime artefacts only:\n\n- **T1** reads `agents/<adwId>/state.json`, or failing that the worktree state that G6/G11 registered. It fails, naming the paths it tried, when neither exists. It fails when `workflowStage` differs.\n- **T5** always compares `World.lastExitCode`. That stays `-1` until a subprocess step sets it, so \"exited 0\" fails when nothing ran.\n- **W1 and W10 in `whenSteps.ts`**: delete the `if (this.mockContext === null) return;` silent no-ops. A step must never pass by doing nothing. W1 and W10 stay `pending` until later slices give them real bodies.\n\nThe per-issue features that reuse T1 (908, 912, 927) write the top-level state themselves and should keep passing. Confirm by running them.\n\nUpdate the T1/T5 rows in `features/regression/vocabulary.md`.\n\n## Acceptance criteria\n\n- [ ] `grep -rnE \"readFileSync\\(.*'adws/\" features/regression/step_definitions` finds nothing.\n- [ ] A throwaway feature whose only step is `Then the orchestrator subprocess exited 0` fails.\n- [ ] A throwaway feature asserting T1 for an adwId with no state file fails, and the failure names the paths it tried.\n- [ ] Every scenario that passes on `dev` today still passes. Pending scenarios stay pending.\n- [ ] Divergence item 4 of ADR-0037 is removed in the same pull request.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-02T07:59:03Z","comments":[],"actionableComment":null}`

## Bug Description
The specification is item 4 of `## Divergence` in `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md` (line 76). Owner's ruling (2026-10-01): the rot rubric applies to everything under `features/regression/`, and the two source-reading branches are a bug.

Every fact in the issue was checked against this branch (base `ddaf010a`) and holds:

- `RegressionWorld.mockContext` defaults to `null` (`features/regression/step_definitions/world.ts:18`). Only `Before` hooks set it: the `@regression` hook (`features/regression/support/hooks.ts:25-27`) and a few per-feature hooks (902-queue, 908, 912, 927).
- **T1** `the state file for adwId {string} records workflowStage {string}` (`thenSteps.ts:13-47`). When `mockContext === null` (lines 16-28) it never looks for a state file. It reads `adws/adwSdlc.tsx` and passes if that file contains `handleAuthRequiredPause(` (it does, line 140). It then reads `adws/phases/authPause.ts` and passes if that file contains the expected stage as a quoted literal. `authPause.ts` contains `'paused_auth'` (lines 35 and 48), `'paused'` (24) and `'auth_required'` (30). So outside the hooks, T1 passes for those stages whatever the state file says, and when there is no state file. It fails for real stages such as `build_running`, even when the state file records them.
- **T5** `the orchestrator subprocess exited {int}` (`thenSteps.ts:101-119`). When `mockContext === null` (lines 104-112) it passes if `authPause.ts` contains `process.exit(N)`. Line 39 has `process.exit(0)`, so "exited 0" passes whether or not anything ran.
- **W1** `the {string} orchestrator is invoked with adwId {string} and issue {int}` (`whenSteps.ts:53-71`) and **W10** `the cron probe runs once` (`whenSteps.ts:211-233`). When `mockContext === null` they `return;` (lines 56-57 and 214-215), which Cucumber scores as passed, so they pass by doing nothing. With a mock context they return `'pending'`.
- All four branches came in with commit `523f0650` (#504, 2026-05-13) so that #504's per-issue scenarios could reuse the phrases. `features/per-issue/feature-504.feature` was swept on 2026-09-10 (`24ae0a98`), but the branches stayed.

**Expected:** T1 and T5 assert on runtime artefacts only, whichever hooks ran.
- T1 reads `agents/<adwId>/state.json`, or failing that the worktree state G6 or G11 registered.
- T1 fails, naming the paths it tried, when neither exists, and fails when `workflowStage` differs.
- T5 always compares `World.lastExitCode`.
- W1 and W10 never pass by doing nothing.

**Actual:** outside the hooks, a scenario such as `When the "sdlc" orchestrator is invoked …` / `Then the state file … records workflowStage "paused_auth"` / `And the orchestrator subprocess exited 0` passes from start to finish. Nothing runs and no artefact exists.

## Problem Statement
T1 and T5 have a second mode, selected by whether a hook happened to set `mockContext`, that asserts on source text. The ADR-0037 rot rubric forbids that pattern. W1 and W10 have a matching mode that passes without doing anything.

No feature on `dev` reaches these branches today:
- Every smoke and surface scenario is `@regression`, so W1/W10 return `pending` and T1/T5 are skipped.
- The per-issue reusers of T1 (908, 912, 927) start their own mock infrastructure precisely to avoid the branch. See `feature-908.feature:146-149`, `feature-912.feature:250-251`, `feature-927.feature:200-201` and `feature-927.steps.ts:30-31`.

The bug is still live: any new scenario outside the hooks that reuses these registered phrases passes vacuously. The fix:
- gives each of the four steps one behaviour that is the same for every scenario;
- makes T1 and T5 fail loudly when their artefact is missing;
- updates the vocabulary registry;
- removes Divergence item 4 from ADR-0037.

## Solution Statement
- **T1** (`thenSteps.ts`): delete the `mockContext === null` branch and its comment. Build the list of candidate state files:
  - `resolve(ROOT, 'agents/<adwId>/state.json')`;
  - then, only if a worktree is registered for the adwId in `this.worktreePaths` (G6 and G11 both register one), `<worktree>/.adw/state.json`.

  Read the first candidate that exists. If none exists, fail with `No state file artefact for adwId "<adwId>". Tried: <every candidate>`. This replaces today's message, which prints `null` when no worktree was registered. Then strictly compare `workflowStage` and name the file that was read in the failure message.
- **T5** (`thenSteps.ts`): delete the `mockContext === null` branch and its comment. The remaining `assert.strictEqual(this.lastExitCode, expectedCode, …)` always runs. Cucumber builds a fresh `RegressionWorld` for every scenario and `lastExitCode` defaults to `-1`. In the regression suite only W1 and W10 would set it, and their bodies are still commented out. Inside throwaway features, feature-960's stand-in step also sets it (see below). So "exited 0" fails whenever no subprocess step ran.
- **W1 and W10** (`whenSteps.ts`): delete the comment line and `if (this.mockContext === null) return;` from both. Each then begins with `return 'pending';`, like W2–W9 and W11. Leave the `ISSUE-3-CUTOVER` comments and the preserved bodies untouched.
- **`features/regression/vocabulary.md`**: rewrite the Semantics cell of the T1 and T5 rows to state the artefact-only contract and the failure behaviour.
- **ADR-0037**: delete Divergence item 4 (line 76) and nothing else. Do not renumber: item 5 was removed the same way in `517f823d`, which left items 1, 2, 3 and 6.
- **`features/per-issue/step_definitions/feature-960.steps.ts`** (new): step definitions for `features/per-issue/feature-960.feature`, which the scenario phase wrote. They automate acceptance criteria 2 and 3, plus the mismatch, fallback and W1/W10 checks. Each scenario writes a throwaway feature to a temp directory and runs it through Cucumber in a child process. It then asserts on the child's step results and error messages. They read no source file and no step-definition file.
- The scenario phase also tagged the T1 scenarios of features 908, 912 and 927 with `@adw-960`, so this issue's test phase runs them, as the issue's "Confirm by running them" asks. Keep those tags.
- Nothing else changes:
  - no `.feature` file beyond what the scenario phase wrote, no regression hook and no `World` field;
  - T9 (`records no error`) keeps its own lookup;
  - no new regression step definitions or vocabulary phrases. The feature-960 phrases are per-issue and stay out of `vocabulary.md`.

  The manual acceptance checks also use throwaway features under `/tmp`, deleted afterwards.

## Steps to Reproduce
Run from the repository root before any code change:

1. `grep -rnE "readFileSync\(.*'adws/" features/regression/step_definitions` reports three hits: `thenSteps.ts:18`, `thenSteps.ts:21` and `thenSteps.ts:106`.
2. Create two throwaway features outside the repository. Their only tag is `@throwaway-960-manual`. No hook is keyed on it, so no hook sets `mockContext`:
   ```sh
   mkdir -p /tmp/adw-960-throwaway
   cat > /tmp/adw-960-throwaway/t5-only.feature <<'EOF'
   @throwaway-960-manual
   Feature: Throwaway 960 - T5 outside the regression hooks

     Scenario: T5 when no subprocess step ran
       Then the orchestrator subprocess exited 0
   EOF
   cat > /tmp/adw-960-throwaway/t1-artefact.feature <<'EOF'
   @throwaway-960-manual
   Feature: Throwaway 960 - T1 outside the regression hooks

     Scenario: T1 for an adwId with no state file
       Then the state file for adwId "throwaway-960-missing" records workflowStage "paused_auth"

     Scenario: T1 for an adwId whose registered worktree has no state file
       Given the worktree for adwId "throwaway-960-worktree" is initialised at branch "throwaway-960"
       Then the state file for adwId "throwaway-960-worktree" records workflowStage "paused_auth"

     Scenario: T1 when the state file records a different stage
       Given a state file exists for adwId "throwaway-960-mismatch" at stage "build_running"
       Then the state file for adwId "throwaway-960-mismatch" records workflowStage "paused_auth"

     Scenario: T1 when the state file records the expected stage
       Given a state file exists for adwId "throwaway-960-match" at stage "build_running"
       Then the state file for adwId "throwaway-960-match" records workflowStage "build_running"
   EOF
   ```
   - cucumber-js 12.7 does not let a feature path on the command line replace the `paths` in `cucumber.js`. It merges the two and prints a deprecation notice ("You have specified paths in both your configuration file and as CLI arguments"). See `loadConfiguration` in `node_modules/@cucumber/cucumber/lib/api/load_configuration.js`.
   - Without a tag filter, the run would execute the whole regression and per-issue suite as well. Every run below therefore passes `--tags "@throwaway-960-manual"`.
   - The `import` list in `cucumber.js` loads every step definition.
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --format-options '{"colorsEnabled":false}' --tags "@throwaway-960-manual" /tmp/adw-960-throwaway/t5-only.feature`
   - Buggy result: `1 scenario (1 passed)`, exit 0. T5 passed although nothing ran.
4. `NODE_OPTIONS="--import tsx" bunx cucumber-js --format-options '{"colorsEnabled":false}' --tags "@throwaway-960-manual" /tmp/adw-960-throwaway/t1-artefact.feature`
   - Buggy result: `4 scenarios (1 failed, 3 passed)`.
   - The missing-file, worktree-without-state and mismatching-stage scenarios pass vacuously.
   - The one real match fails with `Expected 'build_running' in authPause.ts`, because T1 never opened the state file G6 wrote.

## Root Cause Analysis
- `mockContext` says whether a hook started the mock infrastructure. It says nothing about whether a runtime artefact exists. Commit `523f0650` used it as a switch between two contracts:
  - with a mock context, T1 and T5 assert on the artefacts;
  - without one, they assert that strings appear in `adws/adwSdlc.tsx` and `adws/phases/authPause.ts`.
- The source-text contract does not depend on the scenario at all:
  - T1 matches any stage spelled as a literal in `authPause.ts`;
  - T5 matches any `N` for which `process.exit(N)` appears there.
- The same commit made W1 and W10 return `undefined`, which Cucumber scores as passed, instead of `'pending'`. A W1 + T1/T5 scenario outside the hooks therefore passes from start to finish without running anything.
- The branches outlived their only caller (feature-504, swept 2026-09-10). Later features had to work around them by starting a mock context they would not otherwise need.
- The rubric is enforced by review only (ADR-0037, Consequences), so nothing caught the forbidden `readFileSync(...).includes(...)` pattern in a shared regression step.

## Relevant Files
Use these files to fix the bug:

- `README.md` — project overview, read first per the instructions.
- `.adw/coding_guidelines.md` — guard clauses, no `any`, and comments only where the code cannot speak. The new code needs no comments.
- `features/regression/step_definitions/thenSteps.ts` — **change.**
  - T1 (lines 13-47): delete the null branch at lines 16-28 and rework the lookup.
  - T5 (lines 101-119): delete the null branch at lines 104-112.
  - T9 (lines 173-193) duplicates T1's lookup and is left unchanged.
  - The imports (`readFileSync`, `existsSync`, `join`, `resolve`, `ROOT`) all remain in use.
- `features/regression/step_definitions/whenSteps.ts` — **change.** W1 (lines 53-71) and W10 (lines 211-233); delete the no-ops at lines 56-57 and 214-215.
- `features/regression/vocabulary.md` — **change.** T1 row (line 103) and T5 row (line 107).
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md` — **change.** Delete Divergence item 4 (line 76).
- `features/regression/step_definitions/world.ts` — read only.
  - `mockContext` defaults to `null` and `lastExitCode` to `-1`.
  - Cucumber constructs a new World per scenario, so `-1` holds at the start of every scenario.
- `features/regression/support/hooks.ts` — read only.
  - The `@regression` `Before` sets `mockContext`. Feature-960's "inside" throwaway runs rely on it.
  - Its `After` resets `lastExitCode`.
- `features/regression/step_definitions/givenSteps.ts` — read only.
  - G6 (lines 76-94) writes `<tmp>/.adw/state.json` and registers the worktree.
  - G11 (lines 246-264) registers a temp git repo.
  - Both are used by the throwaway reproduction and inside feature-960's throwaway features. They make their temp directories with `mkdtempSync(join(tmpdir(), 'adw-reg-<adwId>-'))` and `'adw-wt-<adwId>-'`.
- `features/per-issue/feature-960.feature` — read only. This issue's BDD scenarios, written by the scenario phase. They are the RED tests for the build (task 2).
  - The "Notes for the step definitions" in its description specify the new step definitions.
  - It reuses G18 and T22 and names the phrases under test only inside DocStrings, which run as throwaway features.
- `features/per-issue/feature-908.feature`, `feature-912.feature`, `feature-927.feature` and their step definitions — read only.
  - These are the only per-issue reusers of T1. No per-issue feature uses T5, W1 or W10. Feature-960 uses them only inside throwaway features.
  - The scenario phase tagged their T1 scenarios `@adw-960`, so `--tags "@adw-960"` runs them with feature-960. Keep the tags and change nothing else in these files.
  - Step definitions: `features/per-issue/step_definitions/feature-908.steps.ts`, `feature-912.steps.ts`, `feature-927.steps.ts`, `feature-927-world.ts`, `feature-927-run.ts`.
  - Each sets `mockContext` in its own `Before` hook and writes `agents/<adwId>/state.json` through `AgentStateManager.writeTopLevelState`. They already take T1's artefact path, so they must keep passing; confirm by running them.
- `features/per-issue/step_definitions/feature-934-regression.steps.ts` — read only. It is the precedent for running Cucumber in a child process from a step. It calls `spawnSync('bunx', ['cucumber-js', …, '--format', 'message', …])` with `NODE_OPTIONS: '--import tsx'` and parses the message envelopes. Its header notes that `cucumber.js` adds its own paths to any CLI path.
- `features/step_definitions/ensureCronOnEveryEventSteps.ts` — read only. It defines G18 `the ADW codebase is checked out`, feature-960's Background step. T22 `the ADW TypeScript type-check passes` is in `thenSteps.ts`. Do not redefine either.
- `test/mocks/claude-cli-stub.ts` — read only. The child Cucumber process gets it as `CLAUDE_CODE_PATH`.
- `adws/core/agentState.ts` (`getTopLevelStatePath`) and `adws/core/environment.ts:121` (`AGENTS_STATE_DIR = path.join(process.cwd(), 'agents')`) — read only. This is the same file as T1's `resolve(ROOT, 'agents/<adwId>/state.json')`, because Cucumber runs from the repository root. `REPO_ROOT` (`adws/core/environment.ts:16`, exported from `adws/core`) is that root. Feature-960's steps run the child from it and seed `agents/<adwId>/state.json` under it.
- `adws/phases/authPause.ts` and `adws/adwSdlc.tsx` — read only. These are the source files the deleted branches read; they are not changed.
- `adws/promotion/vocabularyParser.ts` — read only. It splits vocabulary rows on `|` and expects five cells, so the rewritten T1/T5 cells must not contain a `|`.
- `cucumber.js` — read only. It sets the feature paths and the step-definition imports, and pins `MAX_REVIEW_RETRY_ATTEMPTS` for 927.
  - It imports `features/per-issue/step_definitions/**/*.ts`, so a child run loads feature-960's stand-in step.
  - A feature path on the command line is merged with its `paths`, so every child or throwaway run needs a `--tags` filter.
  - When `ADW_JUNIT_REPORT_PATH` is set, it adds a JUnit formatter. The scenario proof sets that variable for the outer run, so feature-960's child must not inherit it.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — conditional doc for `features/regression/**` (decisions 0021, 0037). It records the contract "W1 populates `World.lastExitCode`; T5 reads this field", which T5 now enforces unconditionally. Read for context; the document phase owns any update.

### New Files
- `features/per-issue/step_definitions/feature-960.steps.ts` — the step definitions for `features/per-issue/feature-960.feature` (task 2). If the file grows large, a helper module beside it is fine, as with the `feature-927-*.ts` files.

`features/per-issue/feature-960.feature` already exists; the scenario phase wrote it. The manual throwaway features live in `/tmp/adw-960-throwaway/` and are deleted after verification. No throwaway feature is committed under `features/`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Capture the baseline and reproduce the bug before editing anything
- Run the acceptance grep: `grep -rnE "readFileSync\(.*'adws/" features/regression/step_definitions`. Note the three hits.
- Create the two throwaway features exactly as shown in `Steps to Reproduce`, step 2.
- Run both throwaway features as in `Steps to Reproduce`, steps 3 and 4. Record the buggy results:
  - `t5-only.feature`: `1 scenario (1 passed)`;
  - `t1-artefact.feature`: `4 scenarios (1 failed, 3 passed)`, where the only failure is `Expected 'build_running' in authPause.ts`.
- Capture the scenario baseline. Run the two commands one after the other, never in parallel, because the pause-queue scenarios share `agents/paused_queue.json` and the spawn locks:
  - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-960-regression.before 2>&1; echo "exit=$?"; tail -n 3 /tmp/adw-960-regression.before`
  - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-908 or @adw-912 or @adw-927" > /tmp/adw-960-perissue.before 2>&1; echo "exit=$?"; tail -n 3 /tmp/adw-960-perissue.before`
- Keep the two summary lines (`N scenarios (…)` and `N steps (…)`) of each run. They are the bar for task 8.
- The `@regression` run exits 1 on `dev` because its smoke and surface scenarios are pending (ADR-0037 Divergence item 3). That is expected; compare summaries, not exit codes.
  - A dry run (`--dry-run --tags "@smoke or @surface"`) on this branch selects 42 scenarios and finds no undefined step.
  - Feature-960 §6 relies on all 42 being reported pending.

### 2. Write the step definitions for `features/per-issue/feature-960.feature` (the RED tests)
- Create `features/per-issue/step_definitions/feature-960.steps.ts`. The "Notes for the step definitions" in the feature's description are the specification; follow them exactly. In summary:
  - **System under test.** The system under test is the step library under `features/regression/step_definitions/`, as Cucumber runs it.
    - Every scenario writes a throwaway feature and runs it through Cucumber in a child process.
    - Never call a step function directly, and never read a source file or a step-definition file.
  - **Writing the throwaway feature.** `a throwaway feature whose only scenario runs outside|inside the @regression hooks, with the steps:` is one definition that captures `outside` or `inside`, for example with a regular expression.
    - It writes one Feature with one Scenario into a fresh temp directory outside the checkout. The DocString's lines become the scenario's steps.
    - The scenario carries a tag unique to the run. `inside` also tags it `@regression`. Never give it an `@adw-` tag.
  - **Running it.** `the throwaway feature is run through Cucumber` spawns `bunx cucumber-js --tags <unique tag> --format message:<temp file> <feature path>` from the checkout root (`REPO_ROOT`), with `NODE_OPTIONS=--import tsx`.
    - The `--tags` filter is required, because cucumber-js merges the CLI path with the `paths` in `cucumber.js`.
    - In the child's environment, remove `ADW_JUNIT_REPORT_PATH`, blank `GH_TOKEN` and every `GITHUB_APP_*` variable, and set `CLAUDE_CODE_PATH` to `test/mocks/claude-cli-stub.ts`.
    - Read the step results from the message file, not from the progress output.
    - Assert that the child ran exactly one scenario, the throwaway one.
  - **Verdicts.**
    - `passes`: every step PASSED.
    - `fails`: a step FAILED. An UNDEFINED or AMBIGUOUS step is an error, not a failure of the step under test.
    - `is reported pending`: a step is PENDING, no step is FAILED, UNDEFINED or AMBIGUOUS, and every later step was SKIPPED.
    - When a verdict does not hold, show the child's step results and error messages.
  - **Failure messages.**
    - `the failure message names the state file path {string}` matches the path, relative to the checkout root, as a substring of the failed step's error message.
    - `the failure message names the state file path inside the worktree registered for adwId {string}` matches a path that ends in `/.adw/state.json`.
    - `the failure message reports the recorded workflowStage {string}` matches the stage as a substring.
  - **Stand-in step.** `a stand-in subprocess step has recorded exit code {int}` sets `World.lastExitCode` (`RegressionWorld`). It appears only inside throwaway features and stands in for W1 and W10 until they get real bodies.
  - **Seeding the top-level state.**
    - `the ADW checkout holds a top-level state file for adwId {string} recording workflowStage {string}` writes `{ "adwId": X, "workflowStage": S }` to `agents/X/state.json` under the checkout root.
    - `the ADW checkout holds no top-level state file for adwId {string}` makes sure `agents/X/` is absent.
  - **Smoke and surface run.** `the regression suite's smoke and surface scenarios are run through Cucumber` runs the child with `--tags "@smoke or @surface"`, under the same environment rules.
    - `every smoke and surface scenario is reported pending` asserts that the child ran at least one scenario from `features/regression/smoke/` and one from `features/regression/surfaces/`.
    - It also asserts that every scenario the child ran is pending, as defined above.
  - **Hooks.** Key every hook on `@adw-f2mx98-bug-regression-then`, never on `@adw-960`, because the tagged 908, 912 and 927 scenarios carry `@adw-960` and must not run these hooks.
    - An `After` hook removes `agents/<adwId>/` for every adwId the steps named.
    - It also removes every temp directory the scenario made, including the `adw-reg-<adwId>-*` and `adw-wt-<adwId>-*` directories that G6 and G11 create in the child's temp directory.
  - **Reuse and registry.** Reuse G18 `the ADW codebase is checked out` and T22 `the ADW TypeScript type-check passes`; do not redefine them. Add nothing to `features/regression/vocabulary.md`.
- Before tasks 3–5, run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-f2mx98-bug-regression-then"`.
  - Every step must be defined.
  - Against today's code, the §1 scenario and most of the "outside" rows fail. That is the RED state.
  - The "inside" rows, §6 and §7 already pass.

### 3. Make T1 read runtime artefacts only (`features/regression/step_definitions/thenSteps.ts`)
- Delete line 16 (`// Per-issue (source-inspection) scenarios: …`) and the whole `if (this.mockContext === null) { … return; }` block (lines 17-28).
- Replace the lookup and failure message with a candidate list, so the failure names exactly the paths tried. The step becomes:
  ```ts
  Then(
    'the state file for adwId {string} records workflowStage {string}',
    function (this: RegressionWorld, adwId: string, expectedStage: string) {
      const worktreePath = this.worktreePaths.get(adwId);
      const candidates = [
        resolve(ROOT, `agents/${adwId}/state.json`),
        ...(worktreePath ? [join(worktreePath, '.adw', 'state.json')] : []),
      ];
      const stateFile = candidates.find((candidate) => existsSync(candidate));
      assert.ok(stateFile, `No state file artefact for adwId "${adwId}". Tried: ${candidates.join(', ')}`);

      const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
      assert.strictEqual(
        state['workflowStage'],
        expectedStage,
        `Expected workflowStage "${expectedStage}" in ${stateFile} but got "${String(state['workflowStage'])}"`,
      );
    },
  );
  ```
- Notes on the new code:
  - `assert.ok` is an assertion signature, so `stateFile` narrows to `string`. The existing code already relies on this.
  - `existsSync` here locates a runtime artefact, which the rubric permits. It is not a check on a source file.
  - Keep the lookup order: the top-level state first, then the registered worktree.
- Leave T9 (`the state file for adwId {string} records no error`) untouched.

### 4. Make T5 compare `World.lastExitCode` unconditionally (same file)
- Delete line 104 (the comment) and the whole `if (this.mockContext === null) { … return; }` block (lines 105-112). The step becomes:
  ```ts
  Then(
    'the orchestrator subprocess exited {int}',
    function (this: RegressionWorld, expectedCode: number) {
      assert.strictEqual(
        this.lastExitCode,
        expectedCode,
        `Expected subprocess exit code ${expectedCode} but got ${this.lastExitCode}`,
      );
    },
  );
  ```
- Confirm `grep -nE "readFileSync\(.*'adws/|mockContext === null" features/regression/step_definitions/thenSteps.ts` now prints nothing.

### 5. Remove the W1 and W10 silent no-ops (`features/regression/step_definitions/whenSteps.ts`)
- In W1, delete line 56 (`// Per-issue (source-inspection) scenarios: mockContext is null → no-op.`) and line 57 (`if (this.mockContext === null) return;`).
- In W10, delete line 214 (the same comment) and line 215 (`if (this.mockContext === null) return;`).
- Each body now starts with `return 'pending';`. Do not touch the `ISSUE-3-CUTOVER` comments, the block-commented bodies, `spawnOrchestrator`, `ORCHESTRATOR_FILES` or their `eslint-disable` lines.
  - The unused `_`-prefixed parameters are allowed by the ESLint `argsIgnorePattern: '^_'`.
  - An unused TypeScript `this` parameter is not reported.
- Confirm `grep -rn "mockContext === null" features/regression/step_definitions` prints nothing.

### 6. Update the T1 and T5 rows in `features/regression/vocabulary.md`
- Replace line 103 (T1) with:
  ```
  | T1 | `the state file for adwId {string} records workflowStage {string}` | Reads `agents/<adwId>/state.json`, or failing that `.adw/state.json` under the worktree G6 or G11 registered for the adwId, and asserts its `workflowStage` field equals the expected value. Fails naming every path it tried when no state file exists. Never reads source files, whichever hooks ran. (State file is an *artefact*, not a source file — permitted read.) | subprocess / phase-import | state file artefact |
  ```
- Replace line 107 (T5) with:
  ```
  | T5 | `the orchestrator subprocess exited {int}` | Reads `World.lastExitCode`; asserts it equals N. The field is `-1` until a subprocess When step (W1, W10) records an exit code, so the step fails when no subprocess ran. Never reads source files, whichever hooks ran. | subprocess | exit code |
  ```
- Keep the five cells and the Pattern and Assertion-target values. Put no `|` inside a cell (`vocabularyParser.ts` splits on it). Do not touch any other row.

### 7. Remove Divergence item 4 from ADR-0037
- In `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, delete line 76, which starts with `4. **Two step definitions assert on source text.**`.
- Do not renumber. Items 1, 2, 3 and 6 keep their numbers, as when item 5 was removed in `517f823d`.
- Change nothing else in the ADR. The write-an-adr rules only allow `status`, `superseded-by`, `## Divergence` and the supersession note to change. Nothing else in the ADR refers to item 4.

### 8. Verify the fix, confirm zero regressions and clean up
- Re-run the throwaway features (the self-checking commands are under `Validation Commands`). Expected after the fix:
  - `t5-only.feature`: exit 1, `1 scenario (1 failed)`, with `Expected subprocess exit code 0 but got -1`.
  - `t1-artefact.feature`: exit 1, `4 scenarios (3 failed, 1 passed)`:
    - missing: `No state file artefact for adwId "throwaway-960-missing". Tried: <repo>/agents/throwaway-960-missing/state.json`;
    - worktree: `… Tried: <repo>/agents/throwaway-960-worktree/state.json, <tmpdir>/adw-wt-throwaway-960-worktree-XXXXXX/.adw/state.json`;
    - mismatch: `Expected workflowStage "paused_auth" in <tmpdir>/adw-reg-throwaway-960-mismatch-XXXXXX/.adw/state.json but got "build_running"`;
    - the matching scenario passes. This is the positive control, and it failed before the fix.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-960"`. Every scenario must pass and the run must exit 0. That covers all of feature-960 and the `@adw-960`-tagged T1 scenarios of 908, 912 and 927.
- Re-run the `@regression` and `@adw-908 or @adw-912 or @adw-927` commands, one after the other, writing to `*.after` files. The two summary lines of each run must equal the task 1 baseline, with no `failed`: passing scenarios still pass and pending ones stay pending.
- Delete the throwaway artefacts. The repository's pre-tool hook (`.claude/hooks/pre-tool-use.ts`) blocks `rm -r`, so use `find … -delete`:
  - `find /tmp/adw-960-throwaway -delete`
  - `find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'adw-*-throwaway-960-*' -exec find {} -delete \;`
  - Confirm `find agents "${TMPDIR:-/tmp}" -maxdepth 1 -name '*throwaway960-*' 2>/dev/null` prints nothing. The feature-960 `After` hook must have removed every top-level state and temp directory it made.
  - Confirm `git status --porcelain -- features/` lists no file except these:
    - `thenSteps.ts`, `whenSteps.ts` and `vocabulary.md`;
    - the new `features/per-issue/step_definitions/feature-960.steps.ts`, and any helper beside it;
    - the scenario phase's `feature-960.feature`, `feature-908.feature`, `feature-912.feature` and `feature-927.feature`, if they are not committed yet.

    No throwaway feature may be left under `features/`.

### 9. Run the Validation Commands
- Execute every command in `Validation Commands` below and confirm each expectation.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

Each command is run from the repository root. The throwaway features are created in task 1 (`Steps to Reproduce`, step 2); re-create them if `/tmp/adw-960-throwaway` is gone.

- `! grep -rnE "readFileSync\(.*'adws/" features/regression/step_definitions` — acceptance criterion 1. Exits 0 because nothing is found. Before the fix it reports `thenSteps.ts:18`, `:21` and `:106`.
- `! grep -rn "mockContext === null" features/regression/step_definitions` — no hook-dependent branch is left in T1, T5, W1 or W10.
- `! grep -n "Two step definitions assert on source text" specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md` — acceptance criterion 5.
- `grep -rln --include='*.feature' -e "records workflowStage" -e "orchestrator subprocess exited" -e "orchestrator is invoked with adwId" -e "the cron probe runs once" features/ | sort` — the scope proof. It must list only these files:
  - `features/regression/smoke/*` and `features/regression/surfaces/*`;
  - `features/per-issue/feature-908.feature`, `feature-912.feature` and `feature-927.feature`;
  - `features/per-issue/feature-960.feature`. There the phrases appear only in the description and inside DocStrings, which its step definitions run as throwaway features in a child Cucumber process.

  The runs below cover all of them.
- `! grep -nE "readFileSync\(.*'(adws|features)/" features/per-issue/step_definitions/feature-960*.ts` — the feature-960 step definitions read no source file and no step-definition file.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --format-options '{"colorsEnabled":false}' --tags "@throwaway-960-manual" /tmp/adw-960-throwaway/t5-only.feature > /tmp/adw-960-throwaway/t5.out 2>&1; test $? -eq 1 && grep -q "^1 scenario (1 failed)" /tmp/adw-960-throwaway/t5.out && grep -q "Expected subprocess exit code 0 but got -1" /tmp/adw-960-throwaway/t5.out && echo "T5 throwaway fails as required"` — acceptance criterion 2. Before the fix the run reports `1 scenario (1 passed)` and this command exits non-zero.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --format-options '{"colorsEnabled":false}' --tags "@throwaway-960-manual" /tmp/adw-960-throwaway/t1-artefact.feature > /tmp/adw-960-throwaway/t1.out 2>&1; test $? -eq 1 && grep -q "^4 scenarios (3 failed, 1 passed)" /tmp/adw-960-throwaway/t1.out && grep -q 'No state file artefact for adwId "throwaway-960-missing". Tried: .*/agents/throwaway-960-missing/state.json' /tmp/adw-960-throwaway/t1.out && grep -qE 'Tried: .*/agents/throwaway-960-worktree/state\.json, .*/adw-wt-throwaway-960-worktree-[^/]+/\.adw/state\.json' /tmp/adw-960-throwaway/t1.out && grep -q 'Expected workflowStage "paused_auth" in .* but got "build_running"' /tmp/adw-960-throwaway/t1.out && echo "T1 throwaway fails as required"` — acceptance criterion 3, plus the mismatch and positive-control checks. Before the fix the run reports `4 scenarios (1 failed, 3 passed)` and this command exits non-zero.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-960" > /tmp/adw-960-issue.after 2>&1; echo "exit=$?"; tail -n 3 /tmp/adw-960-issue.after` — this issue's BDD scenarios: all of `feature-960.feature` (acceptance criteria 2, 3 and 4 run as throwaway features in a child process) and the `@adw-960`-tagged T1 scenarios of 908, 912 and 927. Expected: exit 0, every scenario passed, with nothing `failed`, `pending` or `undefined`. Run it on its own, before the next two commands.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-908 or @adw-912 or @adw-927" > /tmp/adw-960-perissue.after 2>&1; echo "exit=$?"; tail -n 3 /tmp/adw-960-perissue.after` — the per-issue reusers of T1. The summary must match `/tmp/adw-960-perissue.before` and contain no `failed` (expected: every scenario passed, exit 0).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" > /tmp/adw-960-regression.after 2>&1; echo "exit=$?"; tail -n 3 /tmp/adw-960-regression.after` — the summary lines must equal `/tmp/adw-960-regression.before`, with the same passed, pending and undefined counts and no `failed`. Exit 1 is expected on `dev` and after the fix while the smoke and surface scenarios stay pending (ADR-0037 Divergence item 3). Run this only after the previous command has finished.
- `bun run lint` — zero errors or warnings.
- `bunx tsc --noEmit` — the root type check passes; it covers `features/**/*.ts`.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional type check passes.
- `bun run build` — passes.
- `bun run test:unit` — the Vitest suite passes. It includes `adws/promotion/__tests__/vocabularyParser.test.ts` and the promotion tests that parse vocabulary rows.
- `find /tmp/adw-960-throwaway -delete && find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'adw-*-throwaway-960-*' -exec find {} -delete \; && test -z "$(find agents "${TMPDIR:-/tmp}" -maxdepth 1 -name '*throwaway960-*' 2>/dev/null)" && git status --porcelain -- features/` — clean-up. It uses `find … -delete` because the repository's pre-tool hook blocks `rm -r`. The `test -z` fails if the feature-960 `After` hook left a top-level state or temp directory behind. The `git status` output may list only these files:
  - `features/regression/step_definitions/thenSteps.ts`, `features/regression/step_definitions/whenSteps.ts` and `features/regression/vocabulary.md`;
  - `features/per-issue/step_definitions/feature-960.steps.ts`, and any helper beside it;
  - if not yet committed, the scenario phase's `features/per-issue/feature-960.feature`, `feature-908.feature`, `feature-912.feature` and `feature-927.feature`.

  No throwaway feature may remain under `features/`.

## Notes
- Strictly follow `.adw/coding_guidelines.md`:
  - guard-clause style;
  - no `any`;
  - no restating or issue-number comments; the new code needs none, and the deleted `// Per-issue (source-inspection) …` comments go with their branches.
- No new library is needed.
- **Why removing the branches cannot turn a passing `dev` scenario red.** The four changed steps are used only by:
  - the `@regression` smoke and surface features, where the `@regression` `Before` sets `mockContext`, every When step returns `pending`, and T1/T5 are skipped. That is unchanged.
  - per-issue features 908, 912 and 927, which set `mockContext` in their own hooks and so already run T1's artefact path. Only T1's failure text changes for them.
  - feature-960, which names them only inside throwaway features that run in a child process. Its §6 scenario also checks that the smoke and surface scenarios stay pending.

  The scope-proof grep in `Validation Commands` enforces this. The baseline-versus-after summaries prove it.
- **Deliberately left alone:**
  - T9 has the same two-path lookup, including the `… or null (G11 temp worktree)` message. The issue scopes this fix to T1 and T5, and T9 is only ever reached after a pending When step.
  - The `.feature` descriptions of 908, 912 and 927 and the comment at `features/per-issue/step_definitions/feature-927.steps.ts:30-31` still say T1 "falls into a legacy source-inspection branch". They become stale but harmless. They are per-issue artefacts owned by their own issues, removed by the 14-day sweep, and `.feature` files are under the Gherkin freeze. Do not edit them. The only change to those files is the `@adw-960` tag the scenario phase added to their T1 scenarios; keep it.
  - `features/per-issue/step_definitions/feature-533.steps.ts:90-96` has a similar `mockContext`-gated When step. It lies outside `features/regression/`, and no feature file uses it (`feature-533.feature` no longer exists). It is out of scope here.
  - Do not add `@regression` scenarios or vocabulary phrases. Promotion is a human decision (ADR-0049).
- `lastExitCode` is also `-1` when W1's `spawnSync` result has a `null` status (killed by a signal or timeout). T5 "exited 0" then fails too, which is correct.
- T1 resolves the top-level state against `ROOT`, while `AgentStateManager` writes under `process.cwd()/agents`. They are the same directory because Cucumber is always run from the repository root, where `cucumber.js` lives. Keep it that way.
- The scenario writer added `features/per-issue/feature-960.feature`. The build runs as `/implement-tdd`, so task 2 writes its step definitions as the RED tests. They must not re-introduce source reads. They prove the T1/T5/W1/W10 verdicts by driving throwaway features through a `cucumber-js` child process and reading its message stream.
- Never run two Cucumber processes from the same checkout at once. The pause-queue scenarios share `agents/paused_queue.json` and the spawn-lock files.
  - The child process that feature-960's steps start does not break this rule. The outer run waits for it (`spawnSync`) and runs nothing else meanwhile, and the child runs only its throwaway scenario, or the smoke and surface scenarios.
  - The global `BeforeAll`/`AfterAll` hooks (`feature-908.steps.ts`, `feature-902-queue.steps.ts`, `feature-818.steps.ts`) use per-process temp directories, so a nested run does not disturb the outer one.
