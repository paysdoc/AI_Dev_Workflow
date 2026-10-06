# Feature: Promote the #909 stream-json envelope conformance scenario into the @regression suite

## Metadata
issueNumber: `1000`
adwId: `fwm86h-feat-promote-909-sce`
issueJson: `{"number":1000,"title":"feat: promote #909 scenario into the @regression suite","body":"Promotes: feature-909\n\nDirect relocation (matches #734 (score: 3)): move this scenario from the per-issue directory,\nwhere only its own workflow's test phase runs it (by its `@adw-909` tag), into the `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-909.feature features/regression/<subdir>/feature-909.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- `git mv features/per-issue/step_definitions/feature-909.steps.ts features/regression/step_definitions/feature-909.steps.ts`\n- Add a feature-level `@regression` tag to the moved feature file.\n- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.\n- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.\n- Register the scenario's phrases in `features/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-909.feature`\n- Step definitions:\n- `features/per-issue/step_definitions/feature-909.steps.ts`\n\n## Phrases to register\n\n- `the ADW codebase is checked out`\n- `the envelope conformance gate is run through its package script entry point`\n- `the envelope conformance gate exits 0`\n- `the envelope conformance gate reports no failing fixture`\n- `a copy of the committed JSONL fixture captured from a real rate limit`\n- `in that copy the \"<message>\" message no longer carries the field \"<field>\"`\n- `the envelope conformance gate checks that copy`\n- `the envelope conformance gate fails`\n- `the envelope conformance gate reports \"<field>\" missing from the \"<message>\" message`\n- `a copy of the committed JSONL error-result fixture`\n- `in that copy the \"result\" message carries \"<field>\" under its stale name \"<stale>\"`\n- `the envelope conformance gate reports \"<field>\" missing from the \"result\" message`\n- `the envelope conformance gate passes`\n- `the envelope conformance gate flags no field of the \"rate_limit_event\" message as unknown`\n- `the envelope conformance gate flags none of these fields of the \"result\" message as unknown:`\n- `a copy of the api_retry system message the Claude CLI documents:`\n- `in that copy the \"system\" message no longer carries the field \"<field>\"`\n- `the envelope conformance gate reports \"<field>\" missing from the \"system\" message`\n- `in that copy the \"result\" message no longer carries the field \"session_id\"`\n- `the fixture updater runs over that copy`\n- `that copy's \"result\" message keeps its original \"result\" value`\n- `the Claude CLI answers the schema probe with:`\n- `the schema probe runs`\n- `the schema probe requested \"stream-json\" output from the Claude CLI`\n- `the schema probe requested verbose output from the Claude CLI`\n- `the Claude CLI stub is asked for its rate-limited response`\n- `the Claude CLI stub is run`\n- `the stub's output carries a rate_limit_event that rejects the request`\n- `the stub's rate_limit_event names a reset time that has not yet passed`\n- `the stub's output ends with a result whose api_error_status is 429 and whose is_error is true`\n- `a copy of the Claude CLI stub's rate-limited response`\n- `the Claude CLI answers the rate-limit probe with <reply>`\n- `the rate-limit probe runs`\n- `the same Claude CLI output is streamed through an agent run`\n- `the agent run ends rate-limited`\n- `the rate-limit probe reports \"limited\"`\n- `the Claude CLI answers the rate-limit probe with the Claude CLI stub's default response`\n- `the rate-limit probe reports \"clear\"`\n- `the ADW TypeScript type-check passes`\n- `the git/gh guard is run across the repository`\n- `the git/gh guard reports no violations`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-909.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-10-04T15:35:57Z","comments":[],"actionableComment":null}`

## Feature Description
Move the BDD feature for issue #909 out of `features/per-issue/` and into the standing `@regression`
suite. The feature is ADW's only executable contract with the Claude CLI's stream-json output, and
it pins three things:

- **The envelope conformance gate** (`adws/jsonl/`, `bun run jsonl:check`). It is green on its
  committed fixtures, one of which is a capture of a real rate limit. It goes red, naming the field,
  when a field the pause path reads drifts: in `rate_limit_event`, in the `result` error fields, or
  in the documented `system`/`api_retry` message. The fixture updater it points to keeps a fixture's
  payload, and the schema probe asks the CLI for `--verbose` stream-json.
- **The Claude CLI stub's on-demand rate-limited response** (`test/mocks/claude-cli-stub.ts`,
  `MOCK_RESPONSE=rate-limited`). The stub answers with a rejecting `rate_limit_event` whose reset
  time is in the future, then a 429 `result`, and that response passes the same gate.
- **Detector parity.** The real capture and the stub's response both end an agent run
  rate-limited, and both make the pause-queue probe report `limited`. The stub's default response
  still reports `clear`.

The feature has 21 scenarios (93 steps). Today only #909's own workflow runs them, through the
`@adw-909` tag, and #909 merged long ago (PR #915), so nothing exercises them anymore. The promotion
sweep scored the feature 3 and stamped it `@promotion-suggested-2026-10-04`.

This is a **direct relocation**:

- `git mv` the feature and its step definitions;
- swap the per-issue tags for `@regression` plus a descriptive hook tag;
- re-key the hooks to that tag;
- register the scenario's phrases in the vocabulary registry;
- prove `@regression` green.

No production code (`adws/**`, `test/mocks/**`) changes.

## User Story
As an **ADW framework maintainer**
I want **the stream-json envelope contract and the stub's rate-limited response to run in every `@regression` sweep**
So that **a Claude CLI output change, or drift between the stub and the real CLI, turns the regression gate red before it strands paused workflows, as happened on 2026-09-22 and 2026-09-24.**

## Problem Statement
- `features/per-issue/feature-909.feature` is selected only by `@adw-909`. Only #909's own
  workflow test phase runs that tag, so the daily regression workflow, the Docker leg and every
  other workflow's `@regression` pass never execute these 21 scenarios.
- The CI `envelope-conformance.yml` job runs `jsonl:check`, but nothing guards the rest:
  - the fixture updater and the probe's `--verbose` request;
  - the stub's rate-limited response, which later pause/wait/resume slices depend on;
  - the parity between the real capture and the stub in the two unchanged pause detectors.
- **The step definitions are two files, and the issue lists only one.** The scenarios are defined
  in both `feature-909.steps.ts` and `feature-909-tooling.steps.ts`, and the tooling file imports
  `copyState`/`readFixtureLines` from `./feature-909.steps.ts`. The promotion issue builder
  (`adws/triggers/promotionSweepDefaults.ts`, `listStepDefSiblings`) and the per-issue TTL sweep
  (`adws/triggers/perIssueScenarioSweep.ts`, `defaultListStepDefSiblings`) both match only basenames
  starting `feature-909.`, so neither sees the tooling file. If only the listed file moves, the
  tooling file's import dangles, and every Cucumber load fails with it, `@regression` included.
- **The hooks are keyed on `@adw-909`, which the promotion removes.** One `After` in
  `feature-909.steps.ts`, and one `Before` and one `After` in `feature-909-tooling.steps.ts`, reset
  shared module state: the fixture copies, the fake-CLI probe state and `CLAUDE_CODE_PATH`, the
  stub state, and #902's `probeStub`. Without re-keying they would silently stop running.
- **Four of the scenario's phrases are unregistered.** They are #902's `the rate-limit probe runs`,
  `the same Claude CLI output is streamed through an agent run`, `the agent run ends rate-limited`
  and `the rate-limit probe reports {string}`. They live in the regression tree
  (`features/regression/step_definitions/feature-902.steps.ts`), but no regression scenario has
  used them until now, so `vocabulary.md` has no rows for them.

## Solution Statement
Perform the documented direct relocation (`app_docs/feature-9gjajh-bdd-regression-suite.md`):
promote the whole step-definition dependency closure, and leave every moved file's relative imports
untouched.

1. **Feature file.** `git mv features/per-issue/feature-909.feature features/regression/envelope/feature-909.feature`.
   - `envelope/` is a new subject-named subdirectory, matching `hashing/`, `upgrade/` and
     `pause-queue/`.
   - Line 1 becomes exactly `@regression @envelope-conformance`. That drops `@adw-909`,
     `@adw-uk9ams-stream-json-envelope` and the per-issue-only `@promotion-suggested-2026-10-04`
     marker.
   - Delete the 14 scenario-level tag lines. They hold only `@adw-` tags: 10 carry
     `@adw-909 @adw-uk9ams-stream-json-envelope`, and 4 also carry `@adw-963 @adw-966`.
   - Leave the description prose and every step, table and doc string unchanged.
2. **Step definitions.** `git mv` both step-definition files into the flat
   `features/regression/step_definitions/`.
   - `features/per-issue/step_definitions/` and `features/regression/step_definitions/` are both
     three levels below the repo root. So `../../../adws/…`, `./feature-909.steps.ts` and
     `../../regression/step_definitions/feature-902.steps.ts` resolve to the same modules as before.
   - Import lines stay byte-identical, as the issue requires.
3. **Hooks.** Re-key the three hooks from `{ tags: '@adw-909' }` to
   `{ tags: '@envelope-conformance' }`.
   - No `@adw-909 or …` alternative is kept, because no file carries `@adw-909` after the move.
   - The #902 hooks are not widened. The tooling file's own `Before` already calls
     `resetFeature902ProbeState()`, and the `feature-902-queue` mock-infrastructure and shadow hooks
     never applied to these scenarios.
4. **Vocabulary.** Register the scenario's phrases in a new
   `## Given/When/Then — Envelope Conformance Gate and Rate-Limited Claude CLI Stub (@envelope-conformance)`
   section of `features/regression/vocabulary.md`.
   - Add one row per step-definition pattern, never one per literal: 33 rows (G-EC1–G-EC11,
     W-EC1–W-EC7, T-EC1–T-EC15).
   - The section covers the issue's 41 listed literals. 37 of them map onto the 33 new patterns. The
     other four are G18, T22, W16 and T34, which are already registered and get no new rows.
5. **README.** Add one `envelope/` line to the `features/regression/` tree.
6. **Prove it.**
   - The relocation is load-neutral: the whole-suite dry-run shows the same totals and 0 ambiguous.
   - The 21 scenarios pass under `@regression and @envelope-conformance`.
   - The full `@regression` gate grows by exactly 21 passing scenarios and 93 passing steps.

**Why this is safe (verified during planning):**
- **No new ambiguity.** `cucumber.js` imports every step-definition glob (regression, shared and
  per-issue) in every run, whatever the tags. The 909 step definitions are loaded today and stay
  loaded exactly once after the move.
  - ESM resolves the tooling file's `../../regression/step_definitions/feature-902.steps.ts` from
    its new home to the same URL the regression glob imports, so that module is evaluated once.
  - A move adds no definitions; only a leftover copy could.
- **The `@regression` hooks are compatible.** The `@regression` `Before` in
  `features/regression/support/hooks.ts` now runs `setupMockInfrastructure()` for these scenarios.
  It sets `CLAUDE_CODE_PATH` to the stub, puts a `git` shadow on `PATH`, and sets
  `GH_TOKEN`/`GH_HOST`/`MOCK_GITHUB_API_URL`/`MOCK_SERVER_PORT`/`MOCK_GIT_LOG`/`REAL_GIT_PATH`.
  - None of these steer the stub. Its output depends only on `MOCK_RESPONSE`, `MOCK_FIXTURE_PATH`,
    `MOCK_MANIFEST_PATH`, `MOCK_RATE_LIMIT_*` and a marker that is only ever placed under
    `os.tmpdir()`.
  - The git shadow intercepts only network subcommands.
  - The schema-probe Given sets `CLAUDE_CODE_PATH` after the hook has run.
    `resolveClaudeCodePath()`'s cache is keyed on the live variable, so the fake CLI is picked up.
  - The #902 probe and agent-run steps use an injected exec seam and a fake child process, and
    spawn nothing.
  - `feature-910`/`feature-911` already run the guard (W16/T34) and the type-check (T22) under the
    same hook.
- **No stray files.** The stub writes its `.adw-stub-invocations` counter only when a manifest
  sets `limitedInvocations`. The env route used here never does, so nothing lands in the checkout.

## Relevant Files
Use these files to implement the feature:

- `features/per-issue/feature-909.feature`: **source** to `git mv` into
  `features/regression/envelope/`.
  - Line 1 holds `@adw-909 @adw-uk9ams-stream-json-envelope @promotion-suggested-2026-10-04`.
  - The 14 scenario-level tag lines are 187, 194, 209, 222, 235, 244, 261, 270, 315 and 320
    (`@adw-909 @adw-uk9ams-stream-json-envelope`), plus 282, 290, 296 and 309 (the same tags plus
    `@adw-963 @adw-966`).
- `features/per-issue/step_definitions/feature-909.steps.ts`: **source** to `git mv`.
  - Its `After({ tags: '@adw-909' }, …)` (line 39) cleans up `copyState`.
  - It exports `copyState`/`readFixtureLines` to the tooling file.
  - Its imports are `../../../adws/jsonl/conformanceCheck.ts` and `types.ts`.
- `features/per-issue/step_definitions/feature-909-tooling.steps.ts`: **unlisted sibling source**
  to `git mv` with it.
  - `Before({ tags: '@adw-909' }, …)` (line 44) calls `resetFeature902ProbeState()`.
  - `After({ tags: '@adw-909' }, …)` (line 48) removes the fake CLI's directory, restores
    `CLAUDE_CODE_PATH` and resets the stub state.
  - It imports `./feature-909.steps.ts` and `../../regression/step_definitions/feature-902.steps.ts`.
- `features/regression/vocabulary.md`: the phrase registry and its Rot-Detection Rubric. Append the
  new section here.
- `README.md`: add the `envelope/` line to the `features/regression/` tree, between `drivers/` and
  `hashing/`. **The working tree already carries unrelated, uncommitted README drift**: a refreshed
  `adws/**/__tests__` listing that matches files already on `dev`. Do not revert or extend it (see
  Task 12).
- `features/regression/step_definitions/feature-902.steps.ts` (read-only): provides `probeStub`,
  `resetFeature902ProbeState()` and the four reused, unregistered phrases. Its `Before` tag
  expression is unchanged.
- `features/regression/step_definitions/feature-902-queue.steps.ts` (read-only): its
  mock-infrastructure, shadow and pause-queue hooks must **not** be widened to
  `@envelope-conformance`.
- `features/regression/step_definitions/givenSteps.ts`, `whenSteps.ts` and `thenSteps.ts`
  (read-only): define G18 (`the ADW codebase is checked out`), W16 (the git/gh guard), T22 (the
  type-check, with `--incremental false`) and T34. All are already registered.
- `features/regression/support/hooks.ts` (read-only): the global guardrails hooks and the
  `@regression` `Before`/`After` that will now wrap the moved scenarios. It sets the 60 s default
  step timeout.
- `test/mocks/test-harness.ts` (read-only): `setupMockInfrastructure()`/`teardownMockInfrastructure()`,
  the exact env they save, set and restore.
- `test/mocks/claude-cli-stub.ts` and `test/mocks/stubResponse.ts` (read-only): the stub's steering
  variables and its rate-limited response mode.
- `cucumber.js` (read-only): the `paths` glob picks up `features/regression/**/*.feature`, and the
  `import` order is the regression step definitions, then the regression support, then the per-issue
  step definitions.
- The systems under test (read-only, not modified):
  - `adws/jsonl/conformanceCheck.ts`, `adws/jsonl/fixtureUpdater.ts`, `adws/jsonl/schemaProbe.ts`
    and `adws/jsonl/schema.json`;
  - `adws/jsonl/fixtures/session-rate-limited.jsonl` and `adws/jsonl/fixtures/result-error.jsonl`;
  - `adws/triggers/rateLimitProbe.ts` and `adws/agents/agentProcessHandler.ts`.
- `adws/promotion/vocabularyParser.ts` (read-only): fixes the row format. It parses only headings
  matching `^## (Given|When|Then)`, splits rows naively on `|`, needs 5 cells, and keys entries by
  phrase.
- `adws/promotion/promotionScorer.ts` (read-only): treats only `{string}` (`.*`) and `{int}` (`\d+`)
  as wildcards, and tries the longest phrase first.
- `adws/triggers/promotionSweepDefaults.ts` and `adws/triggers/perIssueScenarioSweep.ts` (read-only):
  their `startsWith('feature-N.')` sibling rule is why the issue under-lists the step-definition
  sources.
- Precedent (read-only):
  - `features/regression/hashing/feature-537.feature` with `step_definitions/feature-537.steps.ts`
    (`@framework-hash`);
  - `features/regression/upgrade/feature-729.feature` with `feature-729.steps.ts`
    (`@upgrade-regen`);
  - `features/regression/pause-queue/feature-910.feature` and `feature-911.feature`.

  These show the tag-line shape (`@regression @<descriptive>`, no scenario-level `@adw-` lines) and
  the hook re-keying.
- `.adw/commands.md` and `.github/adw.yml` (read-only): the validation commands, and
  `unitTests` (commented out, so unit tests are enabled).

### Relevant Documentation (matched via `.adw/conditional_docs.md`)
- `app_docs/feature-9gjajh-bdd-regression-suite.md`. It matches "manually promoting a
  `features/per-issue/` scenario", "the vocabulary registry", "the Claude CLI stub's on-demand
  rate-limited response" and "G18". It codifies four rules:
  - the dependency closure moves with the scenario, imports untouched;
  - every `@adw-` tag is dropped;
  - hooks are re-keyed to a descriptive tag;
  - the `@regression` mock infrastructure is transparent to local git.
- `app_docs/feature-9gjajh-jsonl-schema.md`: the conformance gate, the fixtures, the fixture
  updater and the schema probe these scenarios exercise. Use it for accurate vocabulary semantics.
- `app_docs/feature-9gjajh-promotion-system.md`: what `@promotion-suggested-<date>` means (it is
  only meaningful under `features/per-issue/`), why a merged promotion is structurally `done`, and
  the issue builder's sibling listing.
- `app_docs/feature-9gjajh-bdd-per-issue.md`: owns `features/per-issue/**`, which these files leave.

### New Files
No new source files. The moves create one directory and three paths:
- `features/regression/envelope/`: a **new subdirectory** (subject: the stream-json envelope
  contract) holding `feature-909.feature`.
- `features/regression/step_definitions/feature-909.steps.ts` and
  `features/regression/step_definitions/feature-909-tooling.steps.ts`: new paths of the moved
  step-definition files. They stay flat in `step_definitions/` so the import depth is preserved.

## Implementation Plan
### Phase 1: Foundation
- Record baselines before touching anything:
  - the whole-suite dry-run totals, with 0 ambiguous;
  - the feature at its current location (`@adw-909`: 21 scenarios, 93 steps, all passing);
  - the `@regression` summary.
- Confirm the dependency closure:
  - the two 909 step-definition files;
  - the regression-resident #902 harness module;
  - the regression generic registries for G18/T22/W16/T34.

### Phase 2: Core Implementation
- `git mv` the feature into `features/regression/envelope/` and both step-definition files into
  `features/regression/step_definitions/`.
- Rewrite the feature's tag lines: line 1 becomes `@regression @envelope-conformance`, and the 14
  scenario-level lines are deleted.
- Re-key the three hooks to `@envelope-conformance`.
- Leave every import, hook body, JSDoc and description line as it is.
- Prove the move is load-neutral and that the 21 scenarios pass under the new tags.

### Phase 3: Integration
- Register the 33 phrase patterns in `vocabulary.md` and add the README tree line.
- Prove the full `@regression` gate grows by exactly 21 passing scenarios with nothing else changed.
- Confirm the old paths are gone and the committed fixtures and schema are untouched.
- Run every validation gate.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Record the pre-change baselines
- Whole-suite dry-run:
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`
  - Record the scenario and step totals, with their undefined and ambiguous counts. Expect
    **0 ambiguous**.
- The feature at its current location:
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-909" --format summary`
  - Expect `21 scenarios (21 passed)` and `93 steps (93 passed)`. The summary counts pickle steps
    only, never hooks.
  - **If any scenario fails here, stop and diagnose before moving anything.** A relocation must
    not carry a red scenario into the gate. Never edit Gherkin or weaken an assertion to get past it.
    Record any pre-existing failure and its cause for the PR description.
- Full regression gate:
  `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary`
  - Record the summary lines. They are the baseline for the +21/+93 delta in Task 10.

### 2. Relocate the feature file into a new `envelope/` subdirectory
- `mkdir -p features/regression/envelope`
- `git mv features/per-issue/feature-909.feature features/regression/envelope/feature-909.feature`

### 3. Rewrite the moved feature's tag lines
In `features/regression/envelope/feature-909.feature`:
- Replace line 1, `@adw-909 @adw-uk9ams-stream-json-envelope @promotion-suggested-2026-10-04`, with
  exactly `@regression @envelope-conformance`.
  - The `@promotion-suggested-<date>` marker is lifecycle metadata of the per-issue promotion sweep.
    It means nothing under `features/regression/`, and no promoted feature carries one.
- Delete all 14 scenario-level tag lines. They contain only `@adw-` tags, so nothing is left to keep:
  - 10 lines of `  @adw-909 @adw-uk9ams-stream-json-envelope`;
  - 4 lines of `  @adw-909 @adw-uk9ams-stream-json-envelope @adw-963 @adw-966`.

  Every scenario then inherits `@regression @envelope-conformance` from the feature line, exactly
  like `feature-729.feature`.
- Do **not** edit the Feature title, the description prose, any step, data table, doc string or
  Examples table.
  - The prose keeps historical notes, such as the `@adw-909`-scoped Before and the old
    `feature-844.steps.ts` locations.
  - Gherkin descriptions are not parsed as tags, and the promoted features 910 and 911 kept their
    prose the same way.
- Check: `grep -nE '^\s*@' features/regression/envelope/feature-909.feature` prints exactly one line,
  `1:@regression @envelope-conformance`.

### 4. Relocate both step-definition files together, imports untouched
- `git mv features/per-issue/step_definitions/feature-909.steps.ts features/regression/step_definitions/feature-909.steps.ts`
- `git mv features/per-issue/step_definitions/feature-909-tooling.steps.ts features/regression/step_definitions/feature-909-tooling.steps.ts`
- Both moves are required. `feature-909-tooling.steps.ts` imports `./feature-909.steps.ts`, so
  moving one without the other breaks the entire Cucumber load.
  - The issue's "Source paths" list only `feature-909.steps.ts`, because the issue builder's sibling
    rule matches `feature-909.` only.
  - The acceptance criterion "the old per-issue paths … and its step-def siblings no longer exist"
    covers both files.
- Do not rename the files and do not touch any `import` line:
  - `../../../adws/jsonl/…` still resolves to the repo root, three levels up.
  - `./feature-909.steps.ts` stays a sibling.
  - `../../regression/step_definitions/feature-902.steps.ts` now resolves to a file in its own
    directory, the same module as before.

### 5. Re-key the three hooks to the descriptive tag
Change only the `tags` option strings:
- `features/regression/step_definitions/feature-909.steps.ts`:
  `After({ tags: '@adw-909' }, …)` → `After({ tags: '@envelope-conformance' }, …)`.
- `features/regression/step_definitions/feature-909-tooling.steps.ts`:
  `Before({ tags: '@adw-909' }, …)` → `Before({ tags: '@envelope-conformance' }, …)`, and
  `After({ tags: '@adw-909' }, …)` → `After({ tags: '@envelope-conformance' }, …)`.

Rules for this task:
- Keep no `@adw-909` alternative, since no feature carries that tag any more.
- Do not widen `feature-902.steps.ts`'s or `feature-902-queue.steps.ts`'s tag expressions.
- Leave hook bodies, the JSDoc headers and every other line unchanged. The `adw-909-…` temp-dir
  prefixes are not tags, so leave them too.

Checks:
- `grep -n "tags: '@envelope-conformance'" features/regression/step_definitions/feature-909.steps.ts features/regression/step_definitions/feature-909-tooling.steps.ts`
  prints 3 lines.
- `grep -rn "@adw-909" features --include='*.ts'` prints nothing.
- The hook tag must be byte-identical to the feature-level tag. A mismatch would silently skip
  cleanup, for example leaving `CLAUDE_CODE_PATH` pointed at a fake CLI, and the scenarios could
  still pass.

### 6. Prove the relocation is load-neutral
- Re-run `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`.
  - The scenario and step totals, and the undefined count, must equal Task 1's.
  - Ambiguous must be **0**.
  - There must be no `ERR_MODULE_NOT_FOUND` or other load error.
- Run `bunx tsc --noEmit`. The root `tsconfig.json` includes `**/*.ts`, so it type-checks every
  moved import.

### 7. Prove the promoted scenarios green under their new tags
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @envelope-conformance" --format summary`
  - Expect `21 scenarios (21 passed)` and `93 steps (93 passed)`, exit 0.
  - This is the first run with the `@regression` mock-infrastructure hook wrapping these scenarios.
  - Any failure here is hook interplay; see the edge cases. Diagnose it in the moved step
    definitions' environment handling. Never change the Gherkin.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-909" --format summary` reports
  `0 scenarios`.
- Afterwards, `git status --porcelain -- adws/jsonl` prints nothing, and no `.adw-stub-invocations`
  exists in the checkout. The committed fixtures and `schema.json` are untouched, because every
  input is a throwaway copy.

### 8. Register the phrases in the vocabulary registry
Append the section below to the end of `features/regression/vocabulary.md`, after the closing
paragraph of `## Given/When/Then — Smoke processes (@subprocess)`. Separate it by one blank line,
as the newer sections are.

Rules:
- Phrase text matches the step definition exactly.
- One row per pattern, never one per literal.
- No cell may contain a literal `|`, because the parser splits rows on it naively. That is why
  T-EC13 describes its regex in words.
- The pattern column holds exactly `subprocess`, `phase-import` or `mock-query`.
- Do **not** re-register G18, T22, W16 or T34.

~~~md
## Given/When/Then — Envelope Conformance Gate and Rate-Limited Claude CLI Stub (@envelope-conformance)

These phrases drive ADW's stream-json envelope conformance gate (`adws/jsonl/`) and the regression
suite's Claude CLI stub (`test/mocks/claude-cli-stub.ts`). The gate runs as a subprocess through its
package script (`bun run jsonl:check`, exactly as CI runs it) and in-process (phase-import) through
`checkConformance`, `updateFixtureEnvelopes` and `probeClaudeJsonlSchema` over throwaway inputs. The
stub runs as a subprocess the way an agent spawns the CLI. The real Claude CLI is never spawned: the
schema probe gets a throwaway fake CLI on `CLAUDE_CODE_PATH`, and the rate-limit probe and the agent
run get the pause-queue harness's injected exec seam and a fake child process. Every input is a
throwaway copy under `os.tmpdir()`: committed fixtures are read or copied, never modified, and the
probe writes a throwaway copy of the schema, never `adws/jsonl/schema.json`. Every assertion targets a
runtime artefact: the gate's exit code and report, the per-fixture results `checkConformance` returns
(pass or fail, missing required fields by dot-path, informational unknown fields), the copy the
fixture updater rewrote, the argv the fake CLI recorded, the stub's stdout and exit code, the
rate-limit probe's classification and the agent run's result. No step reads, greps or parses a source
file, satisfying the Rot-Detection Rubric. The definitions live in `feature-909.steps.ts` and
`feature-909-tooling.steps.ts`; W-EC6, W-EC7, T-EC14 and T-EC15 live in the pause-queue harness's
`feature-902.steps.ts`.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| G-EC1 | `a copy of the committed JSONL fixture captured from a real rate limit` | Copies the committed capture of a real rate-limited session (`adws/jsonl/fixtures/session-rate-limited.jsonl`, one message per line) into a fresh throwaway directory under `os.tmpdir()`; later steps mutate and check only that copy | phase-import | fixture input (SUT input, not source) |
| G-EC2 | `a copy of the committed JSONL error-result fixture` | Copies the committed error-result fixture (`adws/jsonl/fixtures/result-error.jsonl`) into a fresh throwaway directory and records the `result` value of the copy's first message as the baseline T-EC8 compares against | phase-import | fixture input (SUT input, not source) |
| G-EC3 | `in that copy the {string} message no longer carries the field {string}` | Deletes the field, a dot-path such as `rate_limit_info.status`, from every message of the given `type` in the throwaway copy and rewrites the copy one message per line: a single-field drift, the way a CLI change arrives | phase-import | fixture input (SUT input, not source) |
| G-EC4 | `in that copy the {string} message carries {string} under its stale name {string}` | Moves the field's value to its stale name (such as `is_error` to `isError`) on every message of the given `type` in the throwaway copy that carries the field | phase-import | fixture input (SUT input, not source) |
| G-EC5 | `a copy of the api_retry system message the Claude CLI documents:` | Writes the DocString, one `system`/`api_retry` JSON line as the Claude CLI's headless documentation publishes it, as `system-api-retry.jsonl` in a fresh throwaway directory | phase-import | fixture input (SUT input, not source) |
| G-EC6 | `the Claude CLI answers the schema probe with:` | Writes a throwaway fake Claude CLI that appends its argv to a record file and prints the DocString as its stream-json output, points `CLAUDE_CODE_PATH` at it (the previous value is put back after the scenario) and copies the committed schema to a throwaway path for the probe to write. The record path is baked into the script rather than passed in a `MOCK_*` variable, which the probe's spawn environment drops | phase-import | stub behaviour (fake Claude CLI) |
| G-EC7 | `the Claude CLI stub is asked for its rate-limited response` | Arms the next W-EC5 run with the stub's on-demand switch, `MOCK_RESPONSE=rate-limited` | subprocess | stub behaviour |
| G-EC8 | `a copy of the Claude CLI stub's rate-limited response` | Runs the Claude CLI stub as W-EC5 does, with `MOCK_RESPONSE=rate-limited`, and writes its stdout as a JSONL file in a fresh throwaway directory, for the gate to check like any fixture | subprocess | fixture input (stub output, SUT input) |
| G-EC9 | `the Claude CLI answers the rate-limit probe with the committed JSONL fixture captured from a real rate limit` | Sets the rate-limit probe exec seam's reply (`probeStub.result`, from `feature-902.steps.ts`) to the committed rate-limited capture on `stdout` with exit code 1 | phase-import | stub behaviour (probe exec seam) |
| G-EC10 | `the Claude CLI answers the rate-limit probe with the Claude CLI stub's rate-limited response` | Runs the Claude CLI stub with `MOCK_RESPONSE=rate-limited` and sets the probe exec seam's reply to its stdout and exit code | subprocess | stub behaviour (probe exec seam) |
| G-EC11 | `the Claude CLI answers the rate-limit probe with the Claude CLI stub's default response` | Runs the Claude CLI stub with no response switch and sets the probe exec seam's reply to its stdout and exit code | subprocess | stub behaviour (probe exec seam) |
| W-EC1 | `the envelope conformance gate is run through its package script entry point` | Runs `bun run jsonl:check` from the ADW checkout root as a subprocess, exactly as CI runs the gate over the committed fixtures, the committed schema and ADW's stream parser; records its exit status and stdout | subprocess | exit code + log stream |
| W-EC2 | `the envelope conformance gate checks that copy` | Calls the gate's check in-process, `checkConformance(<committed schema>, <throwaway directory>)`, over the copy's directory; records the per-fixture results: pass or fail, missing required fields by dot-path, informational unknown fields, parser and extractor errors | phase-import | returned conformance results |
| W-EC3 | `the fixture updater runs over that copy` | Calls `updateFixtureEnvelopes(<committed schema>, <throwaway directory>)` in-process, the updater behind `bun run jsonl:update` that a failing gate report points to; it rewrites the copy in place | phase-import | fixture copy rewritten by the updater |
| W-EC4 | `the schema probe runs` | Calls `probeClaudeJsonlSchema(<throwaway schema path>)` in-process; the probe spawns the fake Claude CLI G-EC6 installed, which records the argv it receives | phase-import | recorded argv |
| W-EC5 | `the Claude CLI stub is run` | Spawns `test/mocks/claude-cli-stub.ts` the way an agent spawns the CLI (`--print --verbose --output-format stream-json` and a prompt, no stream delay), with G-EC7's switch when armed; records its stdout and exit code | subprocess | log stream + exit code |
| W-EC6 | `the rate-limit probe runs` | Calls the real `probeRateLimit` with the injected exec seam (`probeStub.exec`, never a spawned CLI) and records its classification. Defined in `feature-902.steps.ts` | phase-import | returned probe classification |
| W-EC7 | `the same Claude CLI output is streamed through an agent run` | Streams the probe exec seam's stdout, newline-terminated, through the real `handleAgentProcess` on a fake child process (one `data` event, then `close`) and records the `AgentResult`. Defined in `feature-902.steps.ts` | phase-import | returned agent result |
| T-EC1 | `the envelope conformance gate exits 0` | Asserts the exit status W-EC1 recorded is 0; the gate's stdout is shown on failure | subprocess | exit code |
| T-EC2 | `the envelope conformance gate reports no failing fixture` | Asserts W-EC1's stdout carries no failing-fixture marker (`✗`) | subprocess | log stream |
| T-EC3 | `the envelope conformance gate fails` | Asserts at least one result W-EC2 recorded did not pass | phase-import | returned conformance results |
| T-EC4 | `the envelope conformance gate passes` | Asserts every result W-EC2 recorded passed | phase-import | returned conformance results |
| T-EC5 | `the envelope conformance gate reports {string} missing from the {string} message` | Asserts one of W-EC2's missing-required-field reports names the field's dot-path for that message `type`; a report with no message prefix also counts | phase-import | returned conformance results |
| T-EC6 | `the envelope conformance gate flags no field of the {string} message as unknown` | Asserts none of W-EC2's informational unknown-field reports (extra fields, or "no schema coverage") belongs to that message `type` | phase-import | returned conformance results |
| T-EC7 | `the envelope conformance gate flags none of these fields of the {string} message as unknown:` | For each `field` row of the data table, asserts no unknown-field report W-EC2 recorded for that message `type` names the field | phase-import | returned conformance results |
| T-EC8 | `that copy's {string} message keeps its original {string} value` | Reads the copy W-EC3 rewrote and asserts the message's field still equals the baseline G-EC2 recorded | phase-import | fixture copy rewritten by the updater |
| T-EC9 | `the schema probe requested {string} output from the Claude CLI` | Reads the argv the fake Claude CLI recorded for the probe's last invocation; asserts `--output-format` is followed by the given format | phase-import | recorded argv |
| T-EC10 | `the schema probe requested verbose output from the Claude CLI` | Asserts the argv recorded for the probe's last invocation includes `--verbose` | phase-import | recorded argv |
| T-EC11 | `the stub's output carries a rate_limit_event that rejects the request` | Parses W-EC5's stdout line by line; asserts a `rate_limit_event` whose `rate_limit_info.status` is `rejected` | subprocess | log stream |
| T-EC12 | `the stub's rate_limit_event names a reset time that has not yet passed` | Asserts that event's `rate_limit_info.resetsAt`, in epoch seconds like the real capture, is later than now | subprocess | log stream |
| T-EC13 | `the stub's output ends with a result whose api_error_status is {int} and whose is_error is {word}` | Asserts the last line of W-EC5's stdout is a `result` carrying that `api_error_status` and that `is_error`. Defined as a regex whose last group accepts only `true` or `false` | subprocess | log stream |
| T-EC14 | `the agent run ends rate-limited` | Asserts the `AgentResult` W-EC7 recorded has `rateLimited: true`. Defined in `feature-902.steps.ts` | phase-import | returned agent result |
| T-EC15 | `the rate-limit probe reports {string}` | Asserts the verdict of the classification W-EC6 recorded (`clear`, `limited`, `failed` or `unknown`). Defined in `feature-902.steps.ts` | phase-import | returned probe classification |

G-EC9, G-EC10 and G-EC11 are literal phrases on purpose: a single parameterised phrase would collide
with `the Claude CLI answers the rate-limit probe with exit code {int} and {word}:`. The scenario's
`<reply>` outline column expands to G-EC9 and G-EC10. This section also reuses already-registered
phrases, so they need no new rows: `the ADW codebase is checked out` (G18), `the ADW TypeScript
type-check passes` (T22) and the git/gh guard pair W16/T34.
~~~

Checks:
- `grep -cE '^[|] [GWT]-EC[0-9]+ [|]' features/regression/vocabulary.md` prints `33`.
- `awk -F'|' '/^[|] [GWT]-EC[0-9]+ / && NF != 7 { print "BAD COLUMNS:" $2 }' features/regression/vocabulary.md`
  prints nothing. Every row has exactly 5 cells.
- `awk -F'|' '/^[|] [GWT]-EC[0-9]+ / { p = $5; gsub(/ /, "", p); if (p != "subprocess" && p != "phase-import" && p != "mock-query") print "BAD PATTERN:" $2 }' features/regression/vocabulary.md`
  prints nothing.
- `grep -oE '^[|] [GWT]-EC[0-9]+ ' features/regression/vocabulary.md | sort | uniq -d` prints
  nothing, so the IDs are unique.

### 9. Add the new subdirectory to the README tree listing
- In `README.md`'s `features/regression/` tree, insert one line between the `drivers/` and
  `hashing/` entries. Align the `#` column with its neighbours (name padded to 16 characters):
  `│   ├── envelope/       # Regression scenarios covering the Claude CLI stream-json envelope conformance gate, its fixture updater and schema probe, and the Claude CLI stub's on-demand rate-limited response (#909)`
- Make no other README edit.

### 10. Prove the full regression gate
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary`
  - Compared with Task 1's baseline, the scenario total grows by exactly **21** and the step total
    by exactly **93**, all of them passing.
  - Every other count (failed, pending, undefined, skipped) is unchanged, and ambiguous is 0.
  - Judge by the summary lines against the baseline. If the baseline itself was not fully green,
    its non-passing rows must be the same ones.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`: the totals are still
  Task 1's, with 0 ambiguous. The vocabulary and README edits are Markdown and cannot change this;
  the run confirms it.
- The promotion adds one more full `tsc` run (T22) and one guard run (W16) to the regression suite,
  a few tens of seconds, well inside the 30-minute CI job timeout.

### 11. Confirm the old paths are gone and nothing dangles
- `for p in features/per-issue/feature-909.feature features/per-issue/step_definitions/feature-909.steps.ts features/per-issue/step_definitions/feature-909-tooling.steps.ts; do test ! -e "$p" || echo "STILL PRESENT: $p"; done`
  prints nothing.
- `ls features/per-issue/step_definitions | grep -E '^feature-909'` prints nothing.
- `git diff -M --name-status "$(git merge-base HEAD origin/dev)"` lists:
  - the feature and both step-definition files as renames (`R…`);
  - `features/regression/vocabulary.md` and `README.md` as modified;
  - this spec as added.

  It lists nothing else.
- `git diff -M "$(git merge-base HEAD origin/dev)" -- features/per-issue/step_definitions features/regression/step_definitions | grep -E '^[-+][^-+]'`
  prints exactly six lines: three `-` lines with `tags: '@adw-909'` and three `+` lines with
  `tags: '@envelope-conformance'`. No `import` line changed.

### 12. Keep the change scoped
- Changed paths must be only:
  - the three renames;
  - the tag-line edit in the moved feature;
  - the three hook tag strings;
  - `features/regression/vocabulary.md`;
  - the one README line;
  - this spec.
- Leave the pre-existing README drift alone. It is an uncommitted refresh of the `adws/**/__tests__`
  tree listing that matches files already on `dev`, and was present before this workflow started.
  - Do not revert it: it is not this issue's to discard.
  - Do not extend it.
  - ADW's `/commit` stages with `git add -A`, so it will ride along. The PR description must say so
    for the HITL reviewer.
- `git status --porcelain` shows nothing under `adws/`, `test/` or `features/per-issue/` (apart
  from the renames out of it), and no `.adw-stub-invocations`. `agents/`, `logs/` and
  `*.tsbuildinfo` are gitignored.

### 13. Run the Validation Commands
- Execute every command in **Validation Commands** below, and confirm each meets its stated
  expectation with zero regressions.

## Testing Strategy
### Unit Tests
`.github/adw.yml` leaves `unitTests` commented out, so unit tests are enabled. **No new unit tests are
warranted:**
- The change adds no production logic. It relocates BDD test files, edits three hook `tags`
  strings and appends Markdown rows.
- The coding guidelines name BDD scenarios as ADW's behavioural proof and say unit tests never stand
  in for them. The proof here is Tasks 7 and 10.
- The vocabulary rows' structural integrity (5 cells, known pattern, unique IDs, no new duplicate
  phrase) is checked by the read-only commands in Task 8 and Validation Commands. Those cover what a
  unit test over the registry would, without committing a test that reads a Markdown source file.
- `bun run test:unit` must stay green as a regression guard. Vitest collects only
  `adws/**/__tests__/**/*.test.ts` and `test/mocks/__tests__/**/*.test.ts`, so moves under
  `features/` cannot affect it.

### Edge Cases
- **Orphaned sibling import.**
  - If only `feature-909.steps.ts` moves, the tooling file's `./feature-909.steps.ts` dangles and
    Cucumber's whole support-code load fails, taking every run down, `@regression` included.
  - Guarded by moving both files (Task 4) and by the load-neutral dry-run and `tsc` (Task 6).
- **Ambiguity from a leftover copy.**
  - Copying instead of moving duplicates 29 step patterns, and every scenario using them goes
    Ambiguous.
  - Use `git mv` only. The dry-run must report 0 ambiguous, with totals equal to the baseline.
- **Hook silently not running.**
  - If the feature tag and the hook tag differ by one character, cleanup stops: copies, the fake
    CLI directory, `CLAUDE_CODE_PATH`, the stub state and `probeStub`. The scenarios may still pass.
  - Task 5 checks that the three hook strings equal line 1's tag.
- **`@regression` mock infrastructure now wraps these scenarios.** It changes `CLAUDE_CODE_PATH`,
  `PATH` (the git shadow) and the `GH_*`/`MOCK_GITHUB_*`/`MOCK_GIT_LOG`/`REAL_GIT_PATH` variables.
  - None of these steer the stub.
  - The git shadow passes local subcommands through.
  - G-EC6 overrides `CLAUDE_CODE_PATH` after the hook ran.
  - `resolveClaudeCodePath()` re-resolves whenever the variable changes.
  - The #902 steps spawn nothing.
  - Task 7 is the proof.
- **Hook order and `CLAUDE_CODE_PATH` after the schema-probe row (known, benign, unchanged).**
  - After hooks run in reverse registration order, and `hooks.ts` registers after the regression
    step definitions. So the `@regression` teardown restores `CLAUDE_CODE_PATH` first, and the
    tooling `After` then puts back the value G-EC6 saved, which is the stub path set by the
    `@regression` `Before`.
  - After that one row, the variable stays pointed at the stub until the run ends.
  - This is benign: every `@regression` scenario re-pins the same stub, and every other scenario
    that uses the variable (907, 928, 932, 933, 937) sets and restores its own value.
  - Hook bodies are left untouched to keep this a pure relocation.
- **Committed artefacts.**
  - The gate copies fixtures into `os.tmpdir()`, and the schema probe writes a throwaway copy of the
    schema.
  - `adws/jsonl/schema.json` and `adws/jsonl/fixtures/` must be unchanged after every run (Task 7
    check).
- **Vocabulary parser quirks.**
  - Rows are split on every `|`, so T-EC13 avoids writing `(true|false)`.
  - Only `## Given…` headings are parsed.
  - A non-standard pattern value silently falls back to `mock-query`.
  - A duplicate phrase silently overwrites the earlier entry.
  - All four are checked by the Task 8 and Validation commands.
- **Scorer wildcard overlap.**
  - The promotion scorer treats `{string}` as `.*`, so T-EC15 `the rate-limit probe reports {string}`
    also matches G22's text.
  - Longest-phrase-first keeps G22 winning, and Cucumber never confuses them, because G22 has no
    quoted argument.
- **`@adw-963`/`@adw-966` selections shrink by 5 pickles each.**
  - Those tags rode on four §4 scenarios (one is an Outline with two examples).
  - Both issues are merged (PRs #975 and #977).
  - Their hooks key on their own adwId tags, never on these, as stated in `feature-963-state.ts` and
    `feature-966-state.ts`.
  - The scenarios stay covered by `@regression`, which every workflow's scenario test phase runs.
- **Promotion marker.**
  - Dropping `@promotion-suggested-2026-10-04` is safe. The promotion sweep and the 14-day TTL sweep
    list only `features/per-issue/`, and a file moved out of it is structurally `done`.
  - It also defuses the latent hazard of the TTL sweep orphaning `feature-909-tooling.steps.ts`.
- **Docker leg and CI.**
  - `bun run jsonl:check`, the stub, `tsc --noEmit --incremental false` and the guard all run in the
    Docker leg's writable copy.
  - A host or container with no Claude CLI is fine: the `@regression` hook pins the stub, and the
    probe uses an injected exec seam.

## Acceptance Criteria
- **Feature file.**
  - `features/regression/envelope/feature-909.feature` exists.
  - Its only tag line is line 1, exactly `@regression @envelope-conformance`.
  - It has no scenario-level tag lines and no `@adw-*` or `@promotion-suggested-*` tag.
  - The title, description, steps, data tables, doc strings and Examples are unchanged.
- **Step definitions.**
  - `features/regression/step_definitions/feature-909.steps.ts` and
    `features/regression/step_definitions/feature-909-tooling.steps.ts` exist as renames.
  - Their only change is the three hook `tags` strings, `'@adw-909'` → `'@envelope-conformance'`.
  - Every `import` line is byte-identical.
- **Old paths.** `features/per-issue/feature-909.feature` and both of its step-def siblings
  (`feature-909.steps.ts`, `feature-909-tooling.steps.ts`) no longer exist, and no
  `features/per-issue/step_definitions/feature-909*` file remains.
- **`@regression` green.**
  - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` executes the 21 moved
    scenarios (93 steps), and all of them pass.
  - All other counts equal the pre-change baseline.
  - Nothing newly failed or undefined, and 0 ambiguous.
- **No ambiguity introduced.** A whole-suite dry-run reports the same scenario and step totals as
  before, with 0 ambiguous steps and no load error.
- **Vocabulary.**
  - `features/regression/vocabulary.md` has the new `(@envelope-conformance)` section with 33 rows:
    G-EC1–G-EC11, W-EC1–W-EC7 and T-EC1–T-EC15.
  - Each row has 5 cells, a known pattern and artefact-asserting, rubric-compliant semantics.
  - G18, T22, W16 and T34 are not re-registered, and no phrase gains a second row.
- **README.** It gains exactly one `envelope/` tree line.
- **Committed artefacts untouched.** `adws/jsonl/schema.json` and `adws/jsonl/fixtures/**` are
  unchanged after all runs, and no stray `.adw-stub-invocations` file exists.
- **Gates.** `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`,
  `bun run test:unit`, `bun run build`, `bun run lint:git-guard` and `bun run lint:docs-index` all
  pass.
- **Governance.** The PR merges only after human (`hitl`) approval. Its description calls out:
  - the unlisted sibling `feature-909-tooling.steps.ts` moving too, and why;
  - the four #902 phrases registered for the first time;
  - the dropped `@adw-963`/`@adw-966` tags;
  - the pre-existing README drift carried by `git add -A`;
  - the benign `CLAUDE_CODE_PATH` hook-order note.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

The old per-issue paths are gone. Expect no output:
```bash
for p in features/per-issue/feature-909.feature features/per-issue/step_definitions/feature-909.steps.ts features/per-issue/step_definitions/feature-909-tooling.steps.ts; do test ! -e "$p" || echo "STILL PRESENT: $p"; done
```

The relocation landed:
```bash
test -e features/regression/envelope/feature-909.feature && test -e features/regression/step_definitions/feature-909.steps.ts && test -e features/regression/step_definitions/feature-909-tooling.steps.ts && echo "NEW PATHS PRESENT"
```

The feature carries exactly one tag line, `@regression @envelope-conformance`:
```bash
head -1 features/regression/envelope/feature-909.feature | grep -qx '@regression @envelope-conformance' && [ "$(grep -cE '^\s*@' features/regression/envelope/feature-909.feature)" = 1 ] && echo "TAGS OK"
```

The hooks are re-keyed and no `@adw-909` remains in any step definition. Expect 3 matching lines, then `NO @adw-909 IN STEP DEFINITIONS`:
```bash
grep -n "tags: '@envelope-conformance'" features/regression/step_definitions/feature-909.steps.ts features/regression/step_definitions/feature-909-tooling.steps.ts; ! grep -rn "@adw-909" features --include='*.ts' && echo "NO @adw-909 IN STEP DEFINITIONS"
```

Only the three hook tag strings changed in the moved step definitions, and no import line did. Expect exactly 6 lines:
```bash
git diff -M "$(git merge-base HEAD origin/dev)" -- features/per-issue/step_definitions features/regression/step_definitions | grep -E '^[-+][^-+]'
```

The vocabulary section has 33 rows. Expect `33`:
```bash
grep -cE '^[|] [GWT]-EC[0-9]+ [|]' features/regression/vocabulary.md
```

Every new row has 5 cells and a known pattern, and the IDs are unique. Expect no output:
```bash
awk -F'|' '/^[|] [GWT]-EC[0-9]+ / { p = $5; gsub(/ /, "", p); if (NF != 7) print "BAD COLUMNS:" $2; else if (p != "subprocess" && p != "phase-import" && p != "mock-query") print "BAD PATTERN:" $2 }' features/regression/vocabulary.md; grep -oE '^[|] [GWT]-EC[0-9]+ ' features/regression/vocabulary.md | sort | uniq -d
```

No phrase gained a second registry row. G18, T22, W16 and T34 are not re-registered. Run in bash or zsh:
```bash
diff <(git show "$(git merge-base HEAD origin/dev)":features/regression/vocabulary.md | grep -oE '^[|] [GWT](-[A-Z]+)?[0-9]+ [|] `[^`]+`' | sed -E 's/^[|] [^|]+ [|] //' | sort | uniq -d) <(grep -oE '^[|] [GWT](-[A-Z]+)?[0-9]+ [|] `[^`]+`' features/regression/vocabulary.md | sed -E 's/^[|] [^|]+ [|] //' | sort | uniq -d) && echo "NO NEW DUPLICATE PHRASES"
```

Whole-suite load and ambiguity check. Expect the same totals as the Task 1 baseline, 0 ambiguous, exit 0:
```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary
```

The promoted scenarios. Expect `21 scenarios (21 passed)` and `93 steps (93 passed)`, exit 0:
```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @envelope-conformance" --format summary
```

The full regression gate. Expect the baseline plus exactly 21 passing scenarios and 93 passing steps, every other count unchanged, 0 ambiguous:
```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --format summary
```

No feature carries the per-issue tag any more. Expect `0 scenarios`:
```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-909" --format summary
```

ESLint passes over the moved TypeScript:
```bash
bun run lint
```

The root type-check passes. It includes `**/*.ts`, so every moved import is checked:
```bash
bunx tsc --noEmit
```

The ADW type-check passes:
```bash
bunx tsc --noEmit -p adws/tsconfig.json
```

The unit suite stays green:
```bash
bun run test:unit
```

The build succeeds:
```bash
bun run build
```

The git/gh guard is green. It is the same check W16/T34 drive:
```bash
bun run lint:git-guard
```

The living-docs index stays clean. The ownership globs `features/per-issue/**` and `features/regression/**` cover the moved files:
```bash
bun run lint:docs-index
```

Committed fixtures and schema are untouched. Expect no output:
```bash
git status --porcelain -- adws/jsonl test
```

Only the intended paths changed (see Task 12), and no `.adw-stub-invocations` file exists:
```bash
git status --porcelain
```

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`):
  - No logic is added.
  - The only TypeScript edits are three string literals, so both moved files stay under 300 lines
    (191 and 200).
  - No comments are added, and the moved files' existing JSDoc is not reformatted, because this is
    a relocation.
- **No new libraries.** If one were ever needed, `.adw/commands.md`'s install command is
  `bun add <package>`.
- **This plan goes beyond the issue's literal two-file recipe in two places.** The PR description
  must say so:
  1. It moves the unlisted `feature-909-tooling.steps.ts`. Without it, the tooling file's sibling
     import dangles and every Cucumber run fails. The acceptance criteria's "step-def siblings"
     clause requires it anyway.
  2. It registers #902's four phrases (W-EC6, W-EC7, T-EC14, T-EC15). They are defined in the
     regression tree, but no regression scenario used them before, so they had no rows.
- **Follow-up, out of scope.**
  - `listStepDefSiblings` (`adws/triggers/promotionSweepDefaults.ts`) and
    `defaultListStepDefSiblings` (`adws/triggers/perIssueScenarioSweep.ts`) match only
    `feature-N.`-prefixed basenames. That is why this issue under-listed its sources.
  - Several per-issue features carry `feature-N-*.ts` helper modules (for example 928, 932–934, 937
    and 963–967). Their promotions would hit the same gap, and their TTL sweeps would orphan those
    modules.
  - Recommend a separate issue to widen both rules to `feature-N-*` and have the issue builder list
    a candidate's sibling-import closure.
- **For the document phase.** Update `app_docs/feature-9gjajh-bdd-regression-suite.md`:
  - add the `envelope/` subdirectory;
  - add `@envelope-conformance` to the list of descriptive hook tags;
  - correct "Per-issue step files (907, 908, 909-tooling) import them…": `feature-909-tooling.steps.ts`
    is now regression-resident.

  Consider a `.adw/conditional_docs.md` condition for the promoted envelope scenario, mirroring the
  pause-queue one.
- **The rot/reuse advisory runs automatically.** On a `regression-promotion` PR, the review phase
  posts the `promote-regression-vocabulary` per-phrase rot/reuse advisory as a non-blocking comment.
  No manual run is required.
- **The prose is left alone.** The feature's free-text description still describes its original
  per-issue wiring, such as the `@adw-909`-scoped Before and the `feature-844.steps.ts` locations.
  That matches the promoted 910 and 911, whose prose kept their `@adw-` history; a later prose sweep
  can align it.
- **HITL gate.** The `hitl` label holds the PR for human approval. Nothing here bypasses that.
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md`
  as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to
  meet the coding guidelines as part of implementing the feature.
