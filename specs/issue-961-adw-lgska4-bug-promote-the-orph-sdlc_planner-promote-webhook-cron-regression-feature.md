# Bug: The orphan webhook cron-on-every-event feature never runs, so nothing tests that behaviour

## Metadata
issueNumber: `961`
adwId: `lgska4-bug-promote-the-orph`
issueJson: `{"number":961,"title":"bug: promote the orphan webhook cron-on-every-event feature into the regression suite","body":"Source: the `## Divergence` section of `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, item 6. It states the facts and the owner's ruling. Read it before planning.\n\nSplit from #935, which was too large for one run and is closed. The facts below come from #935's planning research. Check them against the code before relying on them.\n\n## What to build\n\n`features/webhook_ensure_cron_on_every_event.feature` (17 scenarios, `@adw-501`) sits outside the `cucumber.js` paths and never runs:\n\n- Every scenario except the type-check reads `adws/triggers/trigger_webhook.ts` as text.\n- Three of them would fail today, because `ensureAppAuthForRepo(` and `if (webhookRepoInfo) ensureCronProcess(` no longer exist.\n- The behaviour it describes still holds: `trigger_webhook.ts` calls `ensureCronProcess` for every accepted event that names a repository. Nothing exercises it, so promote it rather than delete it.\n\n**Watch out: G18.** The orphan's step file `features/step_definitions/ensureCronOnEveryEventSteps.ts` holds the only definition of the registered Background phrase G18 `the ADW codebase is checked out`. The Backgrounds of `regression/hashing/feature-537`, `upgrade/feature-729`, `pause-queue/feature-910`, `pause-queue/feature-911` and several per-issue features use it. Move G18 (a no-op) into `features/regression/step_definitions/givenSteps.ts` first.\n\n**The promoted feature:** `features/regression/webhook/cron_on_every_event.feature`, tagged `@regression @webhook`, with no `@adw-` tag (ADR-0037 item 5). Write it to the rubric and the fixed vocabulary. It drives the real exported `dispatchWebhookEvent(req, res, rawBody, mintEventBoundary)` in-process:\n\n- **Request and response.** A fake request carries `x-github-event`, plus `x-hub-signature-256` (HMAC-SHA256 of the raw body) when signing. A fake response records `writeHead` and `end`. `mintEventBoundary` returns a minimal fake boundary; never mint a real one.\n- **Payloads.** Use `repository.full_name` and `repository.clone_url`, both required by `resolveWebhookRepo`. Choose actions that end in `ignored` without reaching a provider: `issues` `edited`, `pull_request` `opened`, a plain `issue_comment` `created`, and an approved `pull_request_review` (`submitted`, `review.state: approved`). Errors on provider branches end in `reportWebhookEventFailure`, which posts to Slack.\n- **Signatures.** Set or delete `process.env.GITHUB_WEBHOOK_SECRET`; it is read at call time.\n- **Launch recorder.** Put a `bunx` shadow on `process.env.PATH` for the dispatch. It records its argv and exits at once. `ensureCronProcess` spawns with the inherited `PATH`. A cron launch is a record that names `adws/triggers/trigger_cron.ts` and `--target-repo <repo>`. Later slices reuse this recorder, so put it in `features/regression/support/`.\n- **Already running.** Simulate it with `writeCronPid('<repo>', process.pid)`.\n- **Auth gate.** Save and clear `agents/.auth_gate` before each dispatch, and restore it afterwards, as feature-908's hook does. While the gate holds a record, the `pull_request_review`, `pull_request_review_comment` and `issue_comment` branches answer `ignored` (`auth_gate_set`) before they look at the event.\n- **Safety.** Blank the GitHub App variables. An event that names no repository makes the dispatcher build its own memoised self-host boundary (`webhookRepoResolver.ts`). With the App variables blank it contacts nothing, and the no-repository branch never uses it.\n- **Restorers.** Restore `PATH`, `GITHUB_WEBHOOK_SECRET`, the GitHub variables and `agents/.auth_gate`. Remove `agents/cron/<owner>_<repo>.json` and the cron log the dispatch created.\n\n**Scenarios:**\n\n- an approved review launches exactly one cron and nothing else;\n- a Scenario Outline over `pull_request_review`/`dismissed`, `pull_request_review_comment`/`edited`, `pull_request`/`opened`, `issue_comment`/`created`, `issues`/`edited` and `check_run`/`completed`;\n- a cron that is already running is left alone;\n- a wrong signature gets 401 and no cron;\n- invalid JSON gets 400 and no cron;\n- no repository gets 200 and no cron.\n\n**Claims that get no row.** Name these in the pull request, with the reason for each:\n\n- the ordering against `ensureAppAuthForRepo`, which the dispatcher no longer calls;\n- `/health`, 404 and 405, which the HTTP listener answers (`/health` runs a real `claude -p` probe);\n- `issues` `opened`/`closed` and `pull_request` `closed`, which hand work to a provider.\n\nDelete the orphan feature and `ensureCronOnEveryEventSteps.ts`. Register the new phrases in `features/regression/vocabulary.md`, and note G18's new home. Update `README.md`'s Project Structure.\n\n## Acceptance criteria\n\n- [ ] No `.feature` file exists outside the `cucumber.js` paths.\n- [ ] The promoted feature passes, and no step in it reads a source file.\n- [ ] Every Background that uses G18 still resolves: 537, 729, 910, 911 and the per-issue features that use it.\n- [ ] After the run, `agents/.auth_gate`, `PATH`, `GITHUB_WEBHOOK_SECRET` and the cron registry are as they were before it.\n- [ ] Divergence item 6 of ADR-0037 is removed in the same pull request.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-02T07:59:05Z","comments":[],"actionableComment":null}`

## Bug Description
`features/webhook_ensure_cron_on_every_event.feature` (17 scenarios, `@adw-501`) sits at the top of `features/`. That is outside both `cucumber.js` paths (`features/regression/**/*.feature` and `features/per-issue/**/*.feature`), so no run ever selects it. Its step file, `features/step_definitions/ensureCronOnEveryEventSteps.ts`, is still loaded on every run through the `features/step_definitions/**/*.ts` import.

The behaviour the feature describes still holds in the code. `dispatchWebhookEvent` (`adws/triggers/trigger_webhook.ts:126-314`) handles a delivery in this order:

1. It validates the signature when `GITHUB_WEBHOOK_SECRET` is set, and answers 401 on a bad one (`:130-134`).
2. It parses the JSON and answers 400 on a parse failure (`:136`).
3. It resolves the repository (`:140`).
4. At `:146`, before any per-event branch, it runs `if (resolution) ensureCronProcess(resolution.repoInfo, webhookTargetRepoArgs)`.

`ensureCronProcess` (`adws/triggers/webhookGatekeeper.ts:169-191`) spawns `bunx tsx adws/triggers/trigger_cron.ts --target-repo <repo> --clone-url <url>`. It skips the spawn when `isCronAliveForRepo` finds a live PID in `agents/cron/<owner>_<repo>.json`.

**Expected.** A scenario in the regression run guards "the webhook ensures a cron for the repository of every accepted event".

**Actual:**
- No executed test exercises the behaviour. The only unit test that mentions `ensureCronProcess` (`adws/triggers/__tests__/trigger_webhook.test.ts`) replaces it with `vi.fn()` and never asserts on it.
- 16 of the 17 orphan scenarios read `adws/triggers/trigger_webhook.ts` as text, through `Given "<path>" is read`, `indexOf` and brace matching. This is the pattern ADR-0037's rot rubric forbids. If run today, three of them would fail:
  - "called at the request handler top-level" and "called after `ensureAppAuthForRepo`": `ensureAppAuthForRepo(` no longer exists.
  - "gated on a resolved repoInfo": `if (webhookRepoInfo) ensureCronProcess(` no longer exists.

  The other 14 would pass on character offsets, not on behaviour.
- The orphan step file holds the only definition of the registered Background phrase G18, `the ADW codebase is checked out`. These Backgrounds use it:
  - `features/regression/hashing/feature-537.feature`
  - `features/regression/upgrade/feature-729.feature`
  - `features/regression/pause-queue/feature-910.feature`
  - `features/regression/pause-queue/feature-911.feature`
  - 19 per-issue features: 848, 902, 907, 908, 909, 912, 927–934 and 936–940.

  Deleting the orphan without moving G18 first would leave all 23 of those Backgrounds undefined.
- ADR-0037 records the problem as Divergence item 6. The owner ruled it a bug on 2026-10-01.

## Problem Statement
Replace the orphan with a behavioural regression feature that:
- is selected by the configured `cucumber.js` paths and the `@regression` tag;
- drives the real `dispatchWebhookEvent` in-process;
- asserts only on the response the dispatcher writes and on the launches it makes, never on source text.

The change must not break any Background that uses G18. It must leave no residue: `PATH`, `GITHUB_WEBHOOK_SECRET`, the GitHub App variables, `agents/.auth_gate`, the cron registry and the cron log must be as they were before the run.

## Solution Statement
This change touches tests and docs only; there is no production code change.

1. **Move G18 first.** Define the no-op `the ADW codebase is checked out` in `features/regression/step_definitions/givenSteps.ts`, and remove it from the orphan step file in the same edit, so it is never defined twice.
2. **Delete the orphan.** Remove `features/webhook_ensure_cron_on_every_event.feature` and `features/step_definitions/ensureCronOnEveryEventSteps.ts`. Leave `cucumber.js` and `features/step_definitions/repoIdentityPersistenceSteps.ts` as they are.
3. **Add a reusable launch recorder** in `features/regression/support/launchRecorder.ts`:
   - A `/bin/sh` `bunx` shadow, put first on `PATH` only for the synchronous dispatch. It writes its argv to its own record file and exits at once.
   - Pure query helpers: the recorded launches, a quiet-window settle, a bounded wait, and the "cron launch for repo" predicate.
   - No hooks, so later slices can import it.
4. **Add `features/regression/step_definitions/webhookCronSteps.ts`.**
   - Hooks scoped to `@webhook or @adw-961` save and neutralise these, and restore them after each scenario:
     - the environment: unset `GITHUB_WEBHOOK_SECRET`, blank the GitHub App variables, unset `SLACK_WEBHOOK_URL`. `PATH` is saved unchanged, as a backstop;
     - `agents/.auth_gate`;
     - each touched cron registry entry and cron log.
   - The `@adw-961` arm gives the rows of `features/per-issue/feature-961.feature` the same hooks. Those rows carry only their `@adw-` tags.
   - Fourteen registered phrases. They build:
     - fake requests, signed or unsigned;
     - a recording response;
     - a fake boundary whose `providers` getter throws;
     - minimal payloads.

     They assert on the recorded response, the recorded launches and the cron registry record.
5. **Write `features/regression/webhook/cron_on_every_event.feature`.** It is tagged `@regression @webhook`, with no `@adw-` tag, and holds six scenarios (11 examples), as the issue lists them. Its rows mirror §1–§4 of `features/per-issue/feature-961.feature` step for step.
6. **Add the per-issue step definitions** for §5 of `features/per-issue/feature-961.feature` in `features/per-issue/step_definitions/feature-961.steps.ts`: the G18 dry-run row and the promoted-run row. They go with the per-issue file when the sweep deletes it.
7. **Register the phrases** in `features/regression/vocabulary.md`, and note G18's new home.
8. **Remove Divergence item 6** from ADR-0037.
9. **Update `README.md`'s Project Structure.**

## Steps to Reproduce
Do not run these during planning. They show the bug on the current tree.

1. `find features -name '*.feature' -not -path 'features/regression/*' -not -path 'features/per-issue/*'`. It prints `features/webhook_ensure_cron_on_every_event.feature`, a feature outside the configured paths.
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-501"`. It reports `0 scenarios`: the configured run never selects the orphan.
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-501" features/webhook_ensure_cron_on_every_event.feature`. This gives the path explicitly and narrows by the orphan's tag. A path argument does not narrow a run here: Cucumber adds it to the configured `paths` (see Notes), so without the tag this runs the whole suite. Three scenarios fail on the vanished `ensureAppAuthForRepo(` and `if (webhookRepoInfo) ensureCronProcess(` markers. The other 14 pass by reading source text.
4. `grep -n "ensureCronProcess" adws/triggers/__tests__/trigger_webhook.test.ts`. It shows `ensureCronProcess: vi.fn()` only, so no executed test observes a cron launch.
5. `grep -rn --include='*.ts' "'the ADW codebase is checked out'" features`. The only definition is in `features/step_definitions/ensureCronOnEveryEventSteps.ts`, the file the fix must delete.

## Root Cause Analysis
- **Placement.** The `ensureCronProcess`-on-every-event fix (4e0fbe29, 2026-04-28) added its feature at the top level of `features/`. The BDD cutover (23e88251, also 2026-04-28) narrowed `cucumber.js` to `features/regression/**`; `features/per-issue/**` was added back later. The file therefore landed outside every configured path and has never been selected. Its step file is still matched by the `features/step_definitions/**/*.ts` import, so it kept loading.
- **Silent rot.** The scenarios assert on source text, and they never ran. Refactors of the dispatcher went unnoticed:
  - `ensureAppAuthForRepo` was dropped;
  - `webhookRepoInfo` became `resolution`;
  - the handler was extracted into the exported `dispatchWebhookEvent`, with an injectable `mintEventBoundary`.

  Even run, these scenarios would only check character positions, not whether a cron is launched.
- **Accidental shared dependency.** Because the step file kept loading, its no-op `the ADW codebase is checked out` became the de facto home of G18. Later registered regression features and per-issue features reuse G18.
- **Net effect.** The behaviour is unguarded. A regression that moves `ensureCronProcess` back into some branches would strand approved pull requests in `awaiting_merge`, as happened in the original incident. That regression would pass every executed test: the unit test mocks `ensureCronProcess`, and the orphan never runs.

## Relevant Files
Use these files to fix the bug:

- `README.md`: Project Structure → the `features/` tree. Remove the orphan line, fix the top-level `step_definitions/` description, add `webhook/` under `regression/`, and describe the launch recorder under `regression/support/`.
- `.adw/coding_guidelines.md`: guidelines to follow. Files under 300 lines, no `any`, guard clauses, nesting depth of at most 2. Comments explain only non-obvious reasons, and never cite issue numbers.
- `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`: the source of the bug. Remove Divergence item 6 (the `6. **One feature file is never run.** …` line) without renumbering; item 5's removal in 517f823d is the precedent.
- `cucumber.js`: `paths` (regression + per-issue) and the `import` globs. No change. The `features/step_definitions/**/*.ts` import must stay for `repoIdentityPersistenceSteps.ts`.
- `features/webhook_ensure_cron_on_every_event.feature`: the orphan. Delete it.
- `features/step_definitions/ensureCronOnEveryEventSteps.ts`: the orphan step file. It is the only definition of G18 and of `{string} is read`, which no other feature uses. Delete it after G18 has moved.
- `features/step_definitions/repoIdentityPersistenceSteps.ts`: stays. It is the only other top-level step file.
- `features/regression/step_definitions/givenSteps.ts`: G18's new home. At 264 lines it stays under 300 with a 3-line addition.
- `features/regression/vocabulary.md`: the registry. Update the G18 row and append the new `@webhook` section.
- `adws/promotion/vocabularyParser.ts` (read-only): the registry format the new rows must keep.
  - A section heading must start with `## Given`, `## When` or `## Then`.
  - Rows have 5 pipe-separated columns, and no cell may contain a literal `|`.
  - The Pattern value is one of `subprocess`, `phase-import` or `mock-query`; anything else falls back to `mock-query`.
- `features/regression/support/hooks.ts` (read-only):
  - It sets a 60 s step timeout.
  - The `@regression` Before/After hooks set up and tear down the mock harness, which prepends a git shadow to `PATH`.
  - Step files load before support files, so `@webhook` Before hooks run before the harness setup, and the `@webhook` After hooks run after its teardown.
- `test/mocks/test-harness.ts` (read-only): the harness's own save and restore of `PATH`, `GH_TOKEN` and `GH_HOST`. The recorder must restore `PATH` to the value it found, not the original.
- `features/regression/step_definitions/realCronProcess.ts` (read-only): exports `cronPidFilePath(repoKey)` (`agents/cron/<owner>_<repo>.json`) and `readCronPid(repoKey)` (the registered pid, or `null`). Reuse them; do not derive the path or parse the record again.
- `features/regression/step_definitions/world.ts` (read-only): `RegressionWorld`. The new steps keep their own module-level context, as `feature-537.steps.ts` does.
- `adws/triggers/trigger_webhook.ts` (read-only, the system under test): `dispatchWebhookEvent`.
  - It reads `GITHUB_WEBHOOK_SECRET` at call time (`:130`) and returns 401 `{ error: 'invalid signature' }` and 400 `{ error: 'invalid json' }`.
  - `mintEventBoundary` is called only when `resolution` is non-null (`:145`). The cron call is at `:146`.
  - When `resolution` is null, `selfHostBoundary()` is built (`:149`).
  - The auth-gate short-circuits are at `:152`, `:169` and `:189`.
  - Every chosen event ends in `{ status: 'ignored' }` with no reason: `:158`, `:175`, `:178`, `:221`, `:259`, `:263` and `:313`.
- `adws/triggers/webhookGatekeeper.ts` (read-only):
  - `ensureCronProcess`. Its module-level `cronSpawnedForRepo` set re-spawns once the registry entry is gone. It opens `logs/agents/cron/<owner>_<repo>.log` in append mode, then spawns `bunx` with no `env` and no `cwd`, using the relative script path `adws/triggers/trigger_cron.ts`.
  - `spawnDetached` also launches through `bunx`, so the shadow catches workflow launches too.
- `adws/triggers/cronProcessGuard.ts` (read-only): `writeCronPid(repoKey, pid)`, `isCronAliveForRepo`, and the registry path under `AGENTS_STATE_DIR`.
- `adws/triggers/webhookRepoResolver.ts` (read-only):
  - `resolveWebhookRepo` needs both `repository.full_name` and `repository.clone_url`, and yields `['--target-repo', fullName, '--clone-url', cloneUrl]`.
  - `selfHostBoundary()` is built once and memoised.
- `adws/triggers/webhookSignature.ts` (read-only): the header format is `sha256=<hex HMAC-SHA256 of the raw body>`, compared in constant time.
- `adws/triggers/webhookEventBoundary.ts` (read-only): `reportWebhookEventFailure` posts to Slack, which is why provider branches are avoided.
- `adws/core/slackNotifier.ts` (read-only): `postSlack` reads `SLACK_WEBHOOK_URL` at call time and skips the post when it is unset.
- `adws/core/githubAppAuth.ts` (read-only): `readGitHubAppConfig` reads `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY_PATH` at call time.
- `adws/core/launchGitContext.ts` (read-only): the `LaunchBoundary` type, and what the self-host boundary mint does with blank App variables.
- `adws/core/authGate.ts` (read-only): exports `AUTH_GATE_PATH` (`'agents/.auth_gate'`), `readAuthGate` and `writeAuthGate`. §5's auth-gate row calls `writeAuthGate` to write a record in the real shape.
- `adws/core/config.ts` (read-only): exports `LOGS_DIR` and `AGENTS_STATE_DIR`.
- `adws/core/workflowCommentParsing.ts` (read-only): the `## Continue`, `## Cancel` and `## Retry` patterns. The plain comment must match none of them.
- `adws/types/issueTypes.ts` (read-only): the `TargetRepoInfo` parameter of `mintEventBoundary`.
- `features/per-issue/step_definitions/feature-908.steps.ts` (read-only precedent): `fakeWebhookReq`, `fakeWebhookRes` and `buildFakeWebhookBoundary`, the save, clear and restore of the auth gate and `GITHUB_WEBHOOK_SECRET`, and `writeCronPid(repo, process.pid)`.
- `features/per-issue/step_definitions/feature-932-world.ts` (read-only precedent): the argv-recording `/bin/sh` `bunx` shadow (`recordArgvLine`, NUL-separated) and the quiet-window `settle()` (750 ms). Copy the idea, not an import: per-issue files are swept 14 days after merge.
- `features/regression/step_definitions/feature-902-queue.steps.ts` (read-only precedent): `withBunxShadow`, which scopes the `PATH` shadow to one call and restores it in `finally`.
- `features/regression/step_definitions/feature-910.steps.ts` and `feature-911.steps.ts` (read-only precedent): regression step files whose hooks are scoped to a descriptive tag and `@adw-` tags together, for example `@adw-911 or @pause-queue-ownership`. That is how per-issue rows get the same hooks.
- `features/per-issue/feature-961.feature`: this issue's BDD scenarios, which are the build's RED tests. The file exists, so the build runs in TDD mode (`/implement-tdd`) and writes every step definition the file still lacks. Do not edit it.
  - §1–§4 are the promoted feature's rows, step for step. Each row states its own precondition instead of using a Background, and the rows carry only `@adw-961 @adw-lgska4-bug-promote-the-orph`.
  - §5 holds the issue's own checks:
    - G18 resolves to exactly one definition at every use.
    - The promoted feature passes in a child Cucumber run, and leaves the auth gate, the cron registry and the cron logs as it found them.
    - T22, the type-check.
  - Its "Notes for the step definitions" specify the hooks, the child runs and every §5 phrase.
- `features/per-issue/step_definitions/feature-934-regression.steps.ts` (read-only precedent):
  - `spawnSync('bunx', ['cucumber-js', '--dry-run', '--format', 'message', …])` with `NODE_OPTIONS: '--import tsx'` and a 256 MiB `maxBuffer`;
  - the parsing of the `pickle` and `testCase` message envelopes.

  Copy the idea; do not import it. That file goes when the sweep deletes feature-934.
- `features/regression/step_definitions/thenSteps.ts` (read-only): T22 `the ADW TypeScript type-check passes`, which §5 reuses. Do not redefine it.
- The G18 users, which must keep resolving:
  - `features/regression/hashing/feature-537.feature`
  - `features/regression/upgrade/feature-729.feature`
  - `features/regression/pause-queue/feature-910.feature`
  - `features/regression/pause-queue/feature-911.feature`
  - `features/per-issue/feature-{848,902,907,908,909,912,927,928,929,930,931,932,933,934,936,937,938,939,940}.feature`
- `.adw/scenarios.md` (read-only): the regression contract (Regression Scenario Directory, Vocabulary Registry).
- Matched through `.adw/conditional_docs.md`:
  - `app_docs/feature-9gjajh-bdd-regression-suite.md`: owns `features/regression/**`. Read it for the regression conventions and ADR-0037. The document phase updates it, not the build.
  - `app_docs/feature-9gjajh-webhook-triggers.md`: `dispatchWebhookEvent` and the `ensureCronProcess`-before-branching invariant over `resolution`.
  - `app_docs/feature-9gjajh-cron-triggers.md`: `cronProcessGuard.ts`.
  - `app_docs/feature-9gjajh-pause-and-auth-queues.md`: `authGate.ts`.

### New Files
- `features/regression/support/launchRecorder.ts`: the shared launch recorder. It has no hooks and no import-time side effects, because `cucumber.js` loads `features/regression/support/**/*.ts` as support code.
- `features/regression/step_definitions/webhookCronSteps.ts`: the `@webhook or @adw-961` hooks and the 14 new step definitions.
- `features/regression/webhook/cron_on_every_event.feature`: the promoted feature.
- `features/per-issue/step_definitions/feature-961.steps.ts`: the step definitions for §5 of `feature-961.feature`. They are per-issue and go with that file. If the file would pass 300 lines, move the child-run helpers into `feature-961-cucumber.ts`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Move G18 into the regression Given registry
- Append to the end of `features/regression/step_definitions/givenSteps.ts`:
  ```ts
  Given('the ADW codebase is checked out', function () {
    // Deliberate no-op: every scenario already runs inside the ADW checkout.
  });
  ```
- In the same edit, delete the G18 `Given(...)` block from `features/step_definitions/ensureCronOnEveryEventSteps.ts`. Cucumber reports a phrase defined twice as ambiguous in every feature that uses it.

### 2. Delete the orphan feature and its step file
- `git rm features/webhook_ensure_cron_on_every_event.feature features/step_definitions/ensureCronOnEveryEventSteps.ts`.
- Do not touch `cucumber.js` or `features/step_definitions/repoIdentityPersistenceSteps.ts`.
- `{string} is read` and the 16 Then phrases go with the file. `grep` confirmed that no other feature uses them.

### 3. Create the shared launch recorder `features/regression/support/launchRecorder.ts`
Write a pure module under 120 lines: no `Before`/`After`, no `any`, guard clauses. Exports:
- `interface LaunchRecorder { readonly rootDir: string; readonly binDir: string; readonly recordsDir: string }`.
- `createLaunchRecorder(): LaunchRecorder`
  - Run `mkdtempSync(join(tmpdir(), 'adw-launch-recorder-'))` and create `bin/` and `records/` inside it.
  - Write `bin/bunx` with mode `0o755`. It must be executable: a non-executable shadow makes `spawn` emit an unhandled `'error'` event. Content, with `<recordsDir>` embedded in single quotes as `feature-932-world.ts` does:
    ```sh
    #!/bin/sh
    record='<recordsDir>/launch-'$$
    printf '%s\0' "$@" > "$record.tmp" && mv "$record.tmp" "$record.args"
    ```
  - The shadow records its argv, NUL-separated, and exits at once with status 0. The rename means a reader never sees a half-written record.
- `withLaunchRecorderOnPath<T>(recorder, fn: () => T): T`
  - Save `process.env.PATH`, set it to `` `${binDir}${path.delimiter}${saved ?? ''}` ``, run `fn`, and in `finally` restore the saved value (`delete process.env.PATH` if it was `undefined`).
  - Comment the reason: `ensureCronProcess` and `spawnDetached` call `spawn('bunx', …)` with no `env`, so Node resolves `bunx` from `process.env.PATH` at the moment of the call. The shadow therefore only has to be on `PATH` while the synchronous dispatch runs, and `PATH` is back the moment the dispatch returns.
- `recordedLaunches(recorder): string[][]`: the `*.args` files in `recordsDir`, sorted, each split on `'\0'` with the trailing empty element dropped.
- `settleLaunches(recorder): Promise<void>`
  - Poll every 50 ms. Resolve once the `recordsDir` listing has stayed unchanged for `QUIET_MS = 750` and holds no `*.tmp`.
  - Fail with `assert.fail` after `SETTLE_CAP_MS = 10_000`.
- `waitForLaunch(recorder, predicate: (argv: readonly string[]) => boolean, timeoutMs: number): Promise<void>`: poll until some record satisfies `predicate`, or until `timeoutMs` elapses. The caller asserts.
- `isCronLaunch(argv: readonly string[]): boolean`: some element, with `\` normalised to `/`, ends with `adws/triggers/trigger_cron.ts`.
- `isCronLaunchFor(argv, repoFullName): boolean`: `isCronLaunch(argv)` holds, and the element after `--target-repo` equals `repoFullName`.
- `describeLaunches(recorder): string`: JSON of each argv joined by spaces, for assertion messages.
- `disposeLaunchRecorder(recorder): void`: best-effort `rmSync(rootDir, { recursive: true, force: true })`.

### 4. Create `features/regression/step_definitions/webhookCronSteps.ts`
Keep the file under 300 lines. Use the house import style, with relative `.ts` paths as `feature-908.steps.ts` uses them.

**Imports.**
- From `@cucumber/cucumber`: `Before`, `After`, `Given`, `When`, `Then`.
- `assert`, `fs`, `path`, `createHmac` from `crypto`, and `type * as http from 'http'`.
- `Platform` from `@paysdoc/devplatform`.
- `type LaunchBoundary` from `../../../adws/core/launchGitContext.ts`.
- `type TargetRepoInfo` from `../../../adws/types/issueTypes.ts`.
- `LOGS_DIR` from `../../../adws/core/config.ts`.
- `AUTH_GATE_PATH` from `../../../adws/core/authGate.ts`.
- `writeCronPid` from `../../../adws/triggers/cronProcessGuard.ts`.
- `dispatchWebhookEvent` from `../../../adws/triggers/trigger_webhook.ts`.
- `cronPidFilePath` and `readCronPid` from `./realCronProcess.ts`.
- The recorder exports from `../support/launchRecorder.ts`.

**Module context `ctx`.**
- `recorder: LaunchRecorder | null`
- `response: { statusCode?: number; body?: Record<string, unknown> }`
- `savedEnv: Map<string, string | undefined>`, which also holds `PATH`
- `savedAuthGate: string | null`
- `cronSnapshots: Map<string, { registry: string | null; logExisted: boolean }>`

**Constants.**
- `WEBHOOK_ENV_KEYS = ['GITHUB_WEBHOOK_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_SLUG', 'GITHUB_APP_PRIVATE_KEY_PATH', 'SLACK_WEBHOOK_URL'] as const`
- `LAUNCH_WAIT_MS = 10_000`

**Hook scope.** Both hooks use the tag expression `@webhook or @adw-961`.
- The rows of `features/per-issue/feature-961.feature` carry only `@adw-961 @adw-lgska4-bug-promote-the-orph`.
- With a `@webhook`-only scope those rows would run with no recorder, a live auth gate and the host's secret. §5's promoted-run row also relies on these hooks to restore the registry entry that G-WH2 writes for it.
- feature-910's and feature-911's hooks are the precedent: they pair a descriptive tag with `@adw-` tags.
- The coding guideline against citing issue numbers covers comments, not tag expressions.
- Once the sweep deletes the per-issue file, the `@adw-961` arm matches nothing.

**`Before({ tags: '@webhook or @adw-961' })`:**
- Create the recorder, reset `ctx.response`, and clear `ctx.cronSnapshots`.
- Save every key in `WEBHOOK_ENV_KEYS`, then:
  - unset `GITHUB_WEBHOOK_SECRET`. Deliveries are unsigned unless G-WH3 sets a secret.
  - set `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY_PATH` to `''`. With these blank, the no-repository row's memoised self-host boundary contacts nothing.
  - unset `SLACK_WEBHOOK_URL`. An event that strayed onto a provider branch would end in `reportWebhookEventFailure`, which posts to Slack.
- Save `PATH` too, without changing it. The After hook puts it back as a backstop. `withLaunchRecorderOnPath` already restores it the moment each dispatch returns.
- Save the contents of `AUTH_GATE_PATH` (or `null`), then remove the file. While a gate record exists, the review, review-comment and comment branches answer `auth_gate_set` before they look at the event.

**`After({ tags: '@webhook or @adw-961' })`:**
- For each `cronSnapshots` entry, write the saved registry content back to `cronPidFilePath(repo)`, or `rmSync(..., { force: true })` it. If the cron log did not exist before, remove it.
- Restore `AUTH_GATE_PATH`: `mkdirSync` its directory and write the saved content, or `rmSync` with `force`.
- Restore every saved env key, `PATH` included: `delete process.env[key]` when the saved value is `undefined`, otherwise assign it. Never assign `undefined`: Node stores it as the string `"undefined"`.
- Dispose of the recorder and set it to `null`.

**Helpers.** Each is small and named; inline callbacks stay at three lines or fewer.
- `cronLogPath(repoFullName)` = `path.join(LOGS_DIR, 'agents', 'cron', `${repoFullName.replace('/', '_')}.log`)`. This mirrors `ensureCronProcess`.
- `snapshotCronState(repoFullName)`: a no-op if the repo is already in `ctx.cronSnapshots`. Otherwise it records the registry file's content (or `null`) and whether the cron log exists.
- `repositoryFields(repoFullName)` = `{ full_name, clone_url: `https://example.invalid/${repoFullName}.git` }`.
- `EVENT_FIELDS: Readonly<Record<string, Record<string, unknown>>>` holds only the fields each branch reads:
  - `pull_request_review`, `pull_request_review_comment`, `pull_request`: `{ pull_request: { number: 77 } }`
  - `issue_comment`: `{ issue: { number: 42, body: '' }, comment: { body: 'Thanks, this looks good.' } }`. A plain comment: not `## Continue`, `## Cancel` or `## Retry`.
  - `issues`: `{ issue: { number: 42 } }`
  - `check_run`: `{ check_run: { id: 1, status: 'completed' } }`
- `approvedReviewPayload(repository?)` = `{ action: 'submitted', pull_request: { number: 77 }, review: { state: 'approved' }, ...(repository ? { repository } : {}) }`.
- `fakeRequest(event, signature?)`: `{ headers: { 'x-github-event': event, ...(signature ? { 'x-hub-signature-256': signature } : {}) } } as unknown as http.IncomingMessage`.
- `recordingResponse()`: `writeHead(code)` stores `ctx.response.statusCode` and returns itself. `end(payload?)` stores `JSON.parse(payload)` in `ctx.response.body`. Cast with `as unknown as http.ServerResponse`.
- `fakeEventBoundary(targetRepo: TargetRepoInfo | null): LaunchBoundary | undefined`
  - Guard: return `undefined` for `null`.
  - Otherwise return `{ gitContext: {}, repoId: { owner, repo, platform: Platform.GitHub }, get providers(): never { throw new Error('A @webhook scenario event reached a forge provider; pick an event that ends in "ignored"') } } as unknown as LaunchBoundary`.
  - The throwing getter makes a stray provider branch fail the step loudly instead of acting.
- `sign(rawBody, secret)` = `` `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}` ``.
- `async deliver(event, rawBody, signature?)`:
  - Assert that the recorder exists, and reset `ctx.response`.
  - Run `withLaunchRecorderOnPath(recorder, () => dispatchWebhookEvent(fakeRequest(event, signature), recordingResponse(), rawBody, fakeEventBoundary))`.
  - Then `await settleLaunches(recorder)`.
- `async deliverPayload(event, payload, repoFullName?, signingSecret?)`: call `snapshotCronState(repoFullName)` when a repository is named, before dispatching, so the log's prior absence is captured. Then build `Buffer.from(JSON.stringify(payload))`, sign it when a secret is given, and call `deliver`.

**Step definitions** (IDs as registered in Task 8):
- G-WH1 `no cron is running for the repository {string}`: `snapshotCronState(repo)`, then `fs.rmSync(cronPidFilePath(repo), { force: true })`.
- G-WH2 `a cron is already running for the repository {string}`: `snapshotCronState(repo)`, then `writeCronPid(repo, process.pid)`. The live test process stands in for the cron.
- G-WH3 `the webhook secret is set to {string}`: `process.env.GITHUB_WEBHOOK_SECRET = secret`.
- W-WH1 `the webhook receives an approved review from the repository {string}`: `deliverPayload('pull_request_review', approvedReviewPayload(repositoryFields(repo)), repo)`.
- W-WH2 `the webhook receives an approved review from the repository {string}, signed with the secret {string}`: as W-WH1, with `signingSecret`.
- W-WH3 `the webhook receives a {string} event with the action {string} from the repository {string}`: `deliverPayload(event, { action, repository: repositoryFields(repo), ...(EVENT_FIELDS[event] ?? {}) }, repo)`.
- W-WH4 `the webhook receives an approved review that names no repository`: `deliverPayload('pull_request_review', approvedReviewPayload())`.
- W-WH5 `the webhook receives a {string} delivery whose body is not valid JSON`: `deliver(event, Buffer.from('{"action": "submitted",'))`.
- T-WH1 `the webhook answers {int} with the status {string}`:
  - `assert.strictEqual(ctx.response.statusCode, code)` and `assert.deepStrictEqual(ctx.response.body, { status })`.
  - The exact body is deliberate. A reason such as `auth_gate_set`, `duplicate`, `boundary_unavailable` or `no_repository` fails it, so a leaked auth gate or cooldown cannot pass a row by accident.
- T-WH2 `the webhook answers {int} with the error {string}`: the status code, and `assert.deepStrictEqual(ctx.response.body, { error })`.
- T-WH3 `exactly one cron is launched, for the repository {string}`:
  - `await waitForLaunch(recorder, (argv) => isCronLaunchFor(argv, repo), LAUNCH_WAIT_MS)`.
  - Then assert that `recordedLaunches(recorder).filter(isCronLaunch)` has length 1 and that its only entry satisfies `isCronLaunchFor(…, repo)`. Use `describeLaunches` in the messages.
- T-WH4 `nothing other than that cron is launched`: `assert.deepStrictEqual(recordedLaunches(recorder).filter((argv) => !isCronLaunch(argv)), [])`.
- T-WH5 `no cron is launched`: `assert.deepStrictEqual(recordedLaunches(recorder).filter(isCronLaunch), [])`. The When step has already settled.
- T-WH6 `the cron that was already running is still the one registered for the repository {string}`: `assert.strictEqual(readCronPid(repo), process.pid, …)`. The registry still names the pid that G-WH2 wrote, so the dispatch neither replaced nor removed the running cron.

No step reads, greps or parses a source file. Every assertion targets one of these:
- the recorded response;
- the recorder's launch records;
- the cron registry record.

The hooks read only the state artefacts they restore: the auth gate, the registry entry and the cron log.

### 5. Write the promoted feature `features/regression/webhook/cron_on_every_event.feature`
Content (the scenario wording is fixed; tighten the prose if needed):
```gherkin
@regression @webhook
Feature: The webhook ensures a cron for the repository of every accepted event

  Auto-merge happens only when a cron polls the repository (`trigger_cron.ts`). The webhook does
  not run `adwMerge` on an approved review; it relies on that repository's cron to sweep
  `awaiting_merge` issues. So `dispatchWebhookEvent` calls `ensureCronProcess` for every delivery
  that passes the signature and JSON checks and names a repository, before it branches on the
  event. When only some branches did this, an approved review could leave its repository with no
  cron and its pull request waiting in `awaiting_merge` indefinitely. `ensureCronProcess` launches
  nothing when the repository's cron is already alive, and a rejected delivery launches nothing.

  Each scenario drives the real exported `dispatchWebhookEvent` in-process, with a fake request
  and response and a fake per-event boundary, so no provider is ever minted. The shared launch
  recorder puts a `bunx` shadow on `PATH` for the dispatch; it records the argv of every launch and
  exits at once. A cron launch is a record naming `adws/triggers/trigger_cron.ts` and
  `--target-repo <repository>`. Every assertion targets the response the dispatcher wrote or the
  launches the recorder captured; no step reads a source file.

  Not covered here: ordering against `ensureAppAuthForRepo`, which the dispatcher no longer calls;
  `/health`, 404 and 405, which the HTTP listener answers before dispatch (`/health` runs a real
  `claude -p` probe); and `issues` opened/closed and `pull_request` closed, which hand work to a
  provider.

  Background:
    Given the ADW codebase is checked out
    And no cron is running for the repository "acme/widgets"

  Scenario: An approved review launches exactly one cron, for its repository, and nothing else
    Given the webhook secret is set to "adw-regression-webhook-secret"
    When the webhook receives an approved review from the repository "acme/widgets", signed with the secret "adw-regression-webhook-secret"
    Then the webhook answers 200 with the status "ignored"
    And exactly one cron is launched, for the repository "acme/widgets"
    And nothing other than that cron is launched

  Scenario Outline: A "<event>" event with the action "<action>" launches a cron for its repository
    When the webhook receives a "<event>" event with the action "<action>" from the repository "acme/widgets"
    Then the webhook answers 200 with the status "ignored"
    And exactly one cron is launched, for the repository "acme/widgets"

    Examples:
      | event                       | action    |
      | pull_request_review         | dismissed |
      | pull_request_review_comment | edited    |
      | pull_request                | opened    |
      | issue_comment               | created   |
      | issues                      | edited    |
      | check_run                   | completed |

  Scenario: A cron that is already running for the repository is left alone
    Given a cron is already running for the repository "acme/widgets"
    When the webhook receives an approved review from the repository "acme/widgets"
    Then the webhook answers 200 with the status "ignored"
    And no cron is launched
    And the cron that was already running is still the one registered for the repository "acme/widgets"

  Scenario: A delivery with a wrong signature is answered 401 and launches no cron
    Given the webhook secret is set to "adw-regression-webhook-secret"
    When the webhook receives an approved review from the repository "acme/widgets", signed with the secret "not-the-webhook-secret"
    Then the webhook answers 401 with the error "invalid signature"
    And no cron is launched

  Scenario: A delivery whose body is not valid JSON is answered 400 and launches no cron
    When the webhook receives a "pull_request_review" delivery whose body is not valid JSON
    Then the webhook answers 400 with the error "invalid json"
    And no cron is launched

  Scenario: An event that names no repository is answered 200 and launches no cron
    When the webhook receives an approved review that names no repository
    Then the webhook answers 200 with the status "ignored"
    And no cron is launched
```
- The file carries `@regression @webhook` only: no `@adw-` tag (ADR-0037) and no scenario-level tags.
- The headline scenario is signed with the configured secret, so the accepting side of signature validation is exercised alongside the 401 row.
- Every step matches §1–§4 of `features/per-issue/feature-961.feature` word for word. The per-issue rows repeat the shared precondition in each row; this file states it once, in its Background. The scenario titles follow the issue's list.
- The Background keeps G18, as 537, 729, 910 and 911 do. The per-issue file leaves this choice to the plan. If G18 were lost, these rows would become undefined, and two checks would fail: the per-issue G18 row and Validation Command 7.

### 6. Write the per-issue step definitions for §5 of `features/per-issue/feature-961.feature`
§1–§4 of the per-issue file use only the phrases from Task 4, so this task defines nothing for them. §5 needs `features/per-issue/step_definitions/feature-961.steps.ts`. The file is per-issue: it goes with the feature file when the sweep deletes it. Keep it under 300 lines.

**Reused, not redefined:**
- G-WH2 `a cron is already running for the repository {string}`, from `webhookCronSteps.ts`. The `@webhook or @adw-961` hooks restore the `acme/elsewhere` entry it writes.
- T22 `the ADW TypeScript type-check passes`, from `thenSteps.ts`.

**Child Cucumber runs:**
- Spawn `bunx cucumber-js` with `NODE_OPTIONS=--import tsx` and `--format message`, as `feature-934-regression.steps.ts` does.
- Build the child's environment from `process.env` without `ADW_JUNIT_REPORT_PATH`. ADW's test phase sets that variable for the parent run. A child that inherits it gets a `junit:` formatter from `cucumber.js` and writes its report to the parent's report path.
- `--format message` replaces `progress` on stdout, because Cucumber gives stdout to the last formatter that has no target.
- Pass no path argument. Cucumber adds a path to the configured `paths` instead of narrowing the run, so select by tag expression only.
- Parse stdout as NDJSON envelopes. Keep the `pickle`, `testCase` and `testStepFinished` messages.
- Give each step a Cucumber timeout of several minutes, for example `{ timeout: 5 * 60_000 }`. Give `spawnSync` a `timeout` just under it: `spawnSync` blocks the event loop, so Cucumber's own timer cannot fire while it runs.

**Steps:**
- `Cucumber dry-runs every feature its configuration loads`: pass `--dry-run --format message` and nothing else. Do not assert the exit status. A dry run exits 0 even with undefined steps, and another feature's undefined step is not this row's concern.
- `every {string} step in the dry run matches exactly one step definition`:
  - Map each pickle step id to its text.
  - Across every `testCase`, collect the test steps whose pickle step has the given text.
  - Assert that there is at least one such step, and that each has exactly one entry in `stepDefinitionIds`. Zero entries means undefined; more than one means ambiguous.
  - Name the offending `uri`s in the assertion message.
  - At baseline, G18 matched one definition at each of its 402 uses, across 23 features.
- `the dry run holds a {string} step in each of these features:`: the data table has one column, `feature`. For each row, assert that some pickle with that `uri` has a step with the given text.
- `ADW's auth gate holds a record of an earlier authentication failure`: call `writeAuthGate({ adwId: null, issueNumber: null, agentName: '<any fixed name>' })`. The hooks have already saved and cleared the real gate, and they restore it afterwards.
- `Cucumber runs the scenarios tagged {string} in a child process`:
  - Just before it spawns, snapshot the state:
    - the content of `agents/.auth_gate`, or `null`;
    - the sorted names and contents of the files in `agents/cron/` and in `logs/agents/cron/`. An absent directory counts as empty.
  - Then spawn with `--tags <expression> --format message`. Never select by path. Cucumber adds a path to the configured `paths`, so a path-selected child would run every configured feature, this file included, and so recurse.
  - Keep the exit status and the envelopes.
- `that run held at least one scenario, and every one of them passed`. It requires:
  - exit status 0;
  - at least one `testCase`;
  - the status `PASSED` on every `testStepFinished`.

  Report the messages of any failing steps.
- `ADW's auth gate, the cron registry and the cron logs are as they were before that run`: take the same snapshot again, and `assert.deepStrictEqual` it against the snapshot taken before the run.

The child run starts with two records in place: the gate record that the auth-gate row wrote, and the `acme/elsewhere` registry entry that G-WH2 wrote. Its rows must:
- clear the gate for each dispatch and restore it afterwards;
- leave the unrelated registry entry alone;
- remove the `acme/widgets` entry and the cron log that they created.

### 7. Prove the rows can fail (temporary mutation, reverted)
The behaviour already holds, so the scenarios are green as soon as their steps exist. Show that they are not vacuous:
- Temporarily delete the line `if (resolution) ensureCronProcess(resolution.repoInfo, webhookTargetRepoArgs);` from `adws/triggers/trigger_webhook.ts`.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @webhook"`. Expect `11 scenarios (7 failed, 4 passed)`: the headline scenario and all six outline rows fail on "exactly one cron is launched".
- Restore the file with `git checkout -- adws/triggers/trigger_webhook.ts`. Then `git diff --quiet -- adws/` must exit 0: `adws/` stays untouched by this fix.

### 8. Register the vocabulary in `features/regression/vocabulary.md`
- In the G18 row, append to Semantics: `Defined in features/regression/step_definitions/givenSteps.ts.` The pattern and target columns are unchanged.
- Append this section at the end of the file, keeping its 5-column shape. No cell may contain a literal `|`; `vocabularyParser.ts` splits on it.
  ```markdown
  ---

  ## Given/When/Then — Webhook Cron On Every Event (@webhook)

  These phrases drive the real exported `dispatchWebhookEvent(req, res, rawBody, mintEventBoundary)`
  in-process (phase-import pattern). The request is a fake that carries `x-github-event` and, when
  signed, `x-hub-signature-256`; the response records the status code and body the dispatcher
  writes. `mintEventBoundary` returns a fake boundary whose providers throw if touched, so no
  provider is ever minted. Launches are caught by the shared launch recorder
  (`features/regression/support/launchRecorder.ts`): a `bunx` shadow put first on `PATH` for the
  dispatch, which records its argv and exits at once. A cron launch is a record that names
  `adws/triggers/trigger_cron.ts` and `--target-repo <repository>`. Every assertion targets a
  runtime artefact: the response the dispatcher wrote, the launches the recorder captured, or the
  cron registry record. No step reads, greps or parses a source file, satisfying the Rot-Detection
  Rubric. The definitions
  live in `webhookCronSteps.ts`; every `@webhook` scenario starts with `GITHUB_WEBHOOK_SECRET` unset,
  the GitHub App variables blank, `SLACK_WEBHOOK_URL` unset and `agents/.auth_gate` cleared, and
  each is restored afterwards together with the cron registry entries and cron logs it touched.

  | # | Phrase | Semantics | Pattern | Assertion target |
  |---|--------|-----------|---------|-----------------|
  | G-WH1 | `no cron is running for the repository {string}` | Removes the repository's cron registry entry (`agents/cron/<owner>_<repo>.json`) after saving it for restoration | phase-import | cron registry artefact |
  | G-WH2 | `a cron is already running for the repository {string}` | Registers the live test process as the repository's cron (`writeCronPid(<repo>, process.pid)`) after saving any existing entry for restoration | phase-import | cron registry artefact |
  | G-WH3 | `the webhook secret is set to {string}` | Sets `GITHUB_WEBHOOK_SECRET`, which the dispatcher reads at call time | phase-import | SUT input (environment) |
  | W-WH1 | `the webhook receives an approved review from the repository {string}` | Dispatches an unsigned `pull_request_review` event (`submitted`, `review.state` approved) naming the repository (`full_name`, `clone_url`) with the launch recorder on `PATH`, then waits until no new launch has been recorded for a quiet window | phase-import | recorded response + launch records |
  | W-WH2 | `the webhook receives an approved review from the repository {string}, signed with the secret {string}` | As W-WH1, with `x-hub-signature-256` set to `sha256=` plus the HMAC-SHA256 of the raw body under the given secret | phase-import | recorded response + launch records |
  | W-WH3 | `the webhook receives a {string} event with the action {string} from the repository {string}` | As W-WH1 for an unsigned event of the given type and action, carrying only the fields its branch reads (a pull request number, an issue number, a plain comment) | phase-import | recorded response + launch records |
  | W-WH4 | `the webhook receives an approved review that names no repository` | As W-WH1, with no `repository` object in the payload | phase-import | recorded response + launch records |
  | W-WH5 | `the webhook receives a {string} delivery whose body is not valid JSON` | As W-WH1 for an unsigned delivery of the given event type whose raw body is truncated JSON | phase-import | recorded response + launch records |
  | T-WH1 | `the webhook answers {int} with the status {string}` | Asserts the recorded status code and that the recorded body is exactly the given status, so a reason such as `auth_gate_set` or `duplicate` fails it | phase-import | recorded response |
  | T-WH2 | `the webhook answers {int} with the error {string}` | Asserts the recorded status code and that the recorded body is exactly the given error | phase-import | recorded response |
  | T-WH3 | `exactly one cron is launched, for the repository {string}` | Waits (bounded) for a cron launch record, then asserts the recorder holds exactly one cron launch and that it names `--target-repo <repo>` | mock-query | launch records |
  | T-WH4 | `nothing other than that cron is launched` | Asserts every launch the recorder captured is a cron launch: no workflow or other `bunx` launch was made | mock-query | launch records |
  | T-WH5 | `no cron is launched` | Asserts the recorder captured no cron launch | mock-query | launch records |
  | T-WH6 | `the cron that was already running is still the one registered for the repository {string}` | Reads the repository's cron registry record and asserts it still names the pid G-WH2 registered, so the dispatch neither replaced nor removed the running cron | phase-import | cron registry artefact |

  This scenario also reuses `the ADW codebase is checked out` (G18, Background no-op), now defined in
  `givenSteps.ts`.
  ```
- Do not reuse W11 (`the webhook handler receives a {string} event for issue {int}`). It is a subprocess stub that POSTs to a mock listener, and it can name neither a repository nor an action.

### 9. Remove Divergence item 6 from ADR-0037
- In `specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`, delete the single line that starts with `6. **One feature file is never run.**`.
- Leave items 1–4 and their numbers as they are; the 517f823d removal of item 5 is the precedent. No other text in the ADR refers to item 6.

### 10. Update `README.md`'s Project Structure (`features/` block only)
- Under `├── regression/`:
  - Change `│   ├── support/        # Cucumber hooks for @regression suite` to `│   ├── support/        # Cucumber hooks for @regression suite; launchRecorder.ts, the shared bunx PATH shadow that records each launch's argv`.
  - After the `│   ├── upgrade/ …` line, add `│   ├── webhook/        # Regression scenarios covering the webhook launching a cron for every accepted event that names a repository`.
- Change `├── step_definitions/   # Top-level step definitions (webhook integration scenario; repo-identity persistence scenario)` to `├── step_definitions/   # Top-level step definitions (repo-identity persistence scenario)`.
- Delete the line `└── webhook_ensure_cron_on_every_event.feature  # Integration scenario: cron fires on every webhook event (issue #501)`.
- Change `├── support/            # Top-level Cucumber support (tsx registration)` to start with `└──`, since it is now the last entry.
- Touch nothing else in the README. It already carries two uncommitted lines from the worktree setup (`selfHostLaunch.ts` and `planCommitGuard.ts` in the `adws/` tree). Leave them as they are.

### 11. Run the validation commands
- Run every command in **Validation Commands** and confirm each expectation.
- Run cucumber commands one at a time, never two at once from this checkout. Scenarios share `agents/` state under the working directory.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

Before the fix, the reproduction commands in **Steps to Reproduce** show the bug. In particular, command 1 below prints the orphan path and fails.

1. `test -z "$(find features -name '*.feature' -not -path 'features/regression/*' -not -path 'features/per-issue/*')"`: exits 0. No `.feature` exists outside the `cucumber.js` paths.
2. `test ! -e features/webhook_ensure_cron_on_every_event.feature && test ! -e features/step_definitions/ensureCronOnEveryEventSteps.ts && test -e features/step_definitions/repoIdentityPersistenceSteps.ts`: exits 0.
3. `test "$(grep -rn --include='*.ts' "'the ADW codebase is checked out'" features | wc -l | tr -d ' ')" = 1 && grep -q "'the ADW codebase is checked out'" features/regression/step_definitions/givenSteps.ts`: exits 0. G18 is defined exactly once, in `givenSteps.ts`.
4. `head -1 features/regression/webhook/cron_on_every_event.feature`: prints `@regression @webhook`. Then `! grep -n "@adw-" features/regression/webhook/cron_on_every_event.feature` exits 0.
5. `! grep -rnE "[\"']adws/triggers/trigger_webhook\.ts[\"']" features`: exits 0. No step reads the dispatcher's source by path.
6. `! grep -n "One feature file is never run" specs/adr/0037-tiered-regression-suite-with-fixed-vocabulary.md`: exits 0. Divergence item 6 is removed.
7. `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --format summary`: 0 undefined and 0 ambiguous steps across the whole tree.
   - A dry run exits 0 even with undefined steps, so read the counts, not the exit code. Every scenario and step must be reported `skipped`.
   - At baseline, the only undefined steps (54) are in `features/per-issue/feature-961.feature`, whose step definitions this change adds.
   - Every configured feature is in this run, so it also shows that every Background using G18 resolves: 537, 729, 910, 911 and the 19 per-issue features.
8. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-961"`: `14 scenarios (14 passed)`, exit 0. This is the issue's own proof. It covers:
   - §1–§4, the promoted rows with per-row preconditions;
   - the G18 row: G18 has exactly one definition at every use, and 537, 729, 910 and 911 hold it;
   - the promoted-run row: the promoted feature passes in a child run, and leaves the seeded auth gate, the cron registry and the cron logs as they were;
   - T22.

   It spawns two child Cucumber runs, so allow a few minutes and run it alone. A path-based dry run cannot replace it. Cucumber adds path arguments to the configured `paths` instead of narrowing the run, and a dry run exits 0 whatever it finds.
9. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @webhook"`: `11 scenarios (11 passed)`, exit 0. The configured paths select the promoted feature.
10. State restoration, with a seeded auth gate. The run must pass and leave the auth gate, the cron registry and the cron logs exactly as before. The command refuses to run if a real gate already exists:
    `bash -c 'test ! -e agents/.auth_gate || { echo "agents/.auth_gate exists; refusing to seed"; exit 1; }; snap() { cat agents/.auth_gate 2>/dev/null; ls -1 agents/cron 2>/dev/null; ls -1 logs/agents/cron 2>/dev/null; }; mkdir -p agents; printf "%s" "{\"adwId\":null,\"issueNumber\":961,\"agentName\":\"restore-probe\",\"firstDetectedAt\":\"2026-10-02T00:00:00.000Z\"}" > agents/.auth_gate; snap > /tmp/adw-961-before.txt; NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @webhook"; run=$?; snap > /tmp/adw-961-after.txt; rm -f agents/.auth_gate; diff /tmp/adw-961-before.txt /tmp/adw-961-after.txt && exit $run'`
    Expected: `11 scenarios (11 passed)`, no diff output, exit 0. A passing run also proves the hooks cleared the seeded gate for every dispatch: otherwise the review and comment rows answer `auth_gate_set`, and T-WH1's exact-body check fails. `PATH` and `GITHUB_WEBHOOK_SECRET` are in-process, so review them in the diff:
    - `PATH` is restored in `withLaunchRecorderOnPath`'s `finally`, and again by the After hook's backstop;
    - the secret is restored by the After hook.

    Command 8's promoted-run row automates the same file check from inside Cucumber.
11. `! pgrep -fl "adw-launch-recorder|trigger_cron.ts --target-repo acme/widgets"`: exits 0. No shadow lingers, and no real cron was ever started.
12. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the 11 new scenarios pass, with 0 failed, 0 undefined and 0 ambiguous. The exit code stays 1 only because of the pre-existing `return 'pending'` smoke and surface stubs (ADR-0037 Divergence item 3), and the pending count matches baseline.
13. `bun run lint`: ESLint passes.
14. `bunx tsc --noEmit`: the root type-check passes. It covers `features/**`, including the new recorder and step files.
15. `bunx tsc --noEmit -p adws/tsconfig.json`: the ADW type-check passes.
16. `bun run lint:git-guard`: the git/gh guard passes.
17. `bun run test:unit`: the Vitest suite is green and unchanged.
18. `bun run build`: the build succeeds.
19. `git status --porcelain -- features specs/adr README.md adws`. Expected changes:
    - the two deletions;
    - the three new regression files;
    - the per-issue feature `features/per-issue/feature-961.feature` and its new step definitions under `features/per-issue/step_definitions/`;
    - `givenSteps.ts`, `vocabulary.md`, the ADR and `README.md`;
    - this spec;
    - nothing under `adws/`.

    `agents/` and `logs/` are gitignored.

## Notes
- **Coding guidelines.** Follow `.adw/coding_guidelines.md` strictly.
  - Every new `.ts` file stays under 300 lines.
  - Use no `any`. Fakes use `as unknown as` casts, as in the 908 and 932 precedents.
  - Use guard clauses and keep nesting to depth 2 at most.
  - Name helpers instead of writing long inline callbacks.
  - Write comments only for non-obvious reasons:
    - why the `PATH` shadow lives only for the dispatch;
    - why `SLACK_WEBHOOK_URL` and the App variables are blanked;
    - why env values are restored by `delete`;
    - why the boundary's `providers` throws.

    Cite no issue numbers in code.
- **No new libraries.** `crypto`, `fs`, `path` and `os` are built in. If one were ever needed, the command is `bun add <package>`.
- **No production code change.** `adws/` is untouched; Task 7's mutation is reverted and checked with `git diff --quiet -- adws/`. No unit test is added, because nothing pure in `adws/` changes. The BDD feature is the proof, as ADR-0037 intends.
- **Claims that get no row.** Put these in the pull request description, each with its reason:
  1. The ordering of `ensureCronProcess` against `ensureAppAuthForRepo`: the dispatcher no longer calls `ensureAppAuthForRepo`, so there is no order to pin.
  2. `/health`, 404 and 405: the HTTP listener (`http.createServer` in `trigger_webhook.ts`) answers them before `dispatchWebhookEvent` is reached, and `/health` runs a real `claude -p` guardrails probe. They cannot be driven in-process without a real listener and a paid probe.
  3. `issues` `opened`/`closed` and `pull_request` `closed`: they hand work to a provider, through the per-event boundary's issue tracker or `routeIssueOpened`. Errors there end in `reportWebhookEventFailure`, which posts to Slack.

  Also name the 17 orphan scenarios as replaced, not migrated. Their source-text assertions are dropped under ADR-0037's rubric.
- **Choices beyond the literal issue text, and why:**
  1. `SLACK_WEBHOOK_URL` is unset for `@webhook` scenarios and restored afterwards. This is defence in depth: if a future dispatcher change routes one of these events onto a provider branch, the failure is logged, not posted to Slack.
  2. The fake boundary's `providers` getter throws. Any provider access fails the scenario at once, with a clear message.
  3. T-WH1 asserts the exact body `{ status }`. A leaked auth gate, a cooldown or a missing boundary cannot pass a row for the wrong reason. This also makes Validation Command 10 a real test of the auth-gate clearing.
  4. The Background states `no cron is running for the repository "acme/widgets"`, which makes the precondition of the launch rows explicit. The `already running` scenario then overrides it.
  5. The headline scenario is signed correctly. A configured secret with a valid signature launches the cron, and only a wrong signature is rejected.
  6. The already-running row also asserts T-WH6: the running cron is still the registered one. The per-issue §2 row does the same, because "left alone" means no second launch and no replaced registration.
- **Hook order.** `cucumber.js` loads `features/regression/step_definitions/**` before `features/regression/support/**`:
  - The `@webhook or @adw-961` Before runs before the `@regression` mock-harness setup. After hooks run in reverse registration order, so its After runs after the harness teardown.
  - `withLaunchRecorderOnPath` restores `PATH` to the value it found. That value still includes the harness's git shadow, and the harness restores the original afterwards.
  - The After hook's `PATH` backstop then writes back the value its Before saw, which is that same original. The restores therefore unwind in reverse order of the changes.
  - A `bunx` shadow left on `PATH` would also answer §5's child runs and T22's `bunx tsc`, and T22 would then pass without type-checking anything. That is why the shadow lives only for the dispatch.
  - The per-issue rows carry no `@regression` tag, so they run without the mock harness. The dispatch needs none.
- **Cucumber CLI facts** (`@cucumber/cucumber` 12.7.0, checked 2026-10-02):
  - `paths` is an additive array (`ADDITIVE_ARRAYS` in `lib/configuration/merge_configurations.js`). A path on the command line is added to the `cucumber.js` paths, never substituted for them, so only tags and `--name` narrow a run.
  - A dry run exits 0 even with undefined steps. The baseline dry run did, with 54 undefined steps, all in `feature-961.feature`.
  - Stdout goes to the last formatter that has no target (`lib/api/convert_configuration.js`). So `--format message` or `--format summary` on the command line replaces the configured `progress`.
  - `cucumber.js` adds a `junit:` formatter whenever `ADW_JUNIT_REPORT_PATH` is set. A child run must not inherit it.
- **Module state in the system under test** needs no reset:
  - `ensureCronProcess`'s `cronSpawnedForRepo` set re-spawns once the registry entry is gone. The Background guarantees that; in the per-issue rows, each launch row's own `no cron is running…` step does.
  - The review and issue cooldown maps are never reached by the chosen actions.
  - `selfHostBoundary()` is memoised for the whole process; with blank App variables it contacts nothing.
- **Reuse.** The recorder is generic so later slices can import it. Do not refactor the existing per-suite shadows to use it here: the `bunx` shadow in `feature-902-queue.steps.ts` and the 932 shadows are out of scope.
- **Pre-existing pending stubs.** The `@regression` command exits 1 at baseline because of the `return 'pending'` W1/W9/W10 stubs (ADR-0037 item 3). For this fix, "green" means: 0 failed, 0 undefined, 0 ambiguous, and all 11 new scenarios passed.
- **Docker leg.** `test/docker-run.sh` mounts the checkout read-only. This feature writes `agents/cron/…` and `logs/agents/cron/…`, as the pause-queue features already write `agents/paused_queue.json`. That is the Docker leg's known limitation (ADR-0037 item 2) and out of scope here.
- **Worktree hygiene.** The worktree started with unrelated uncommitted edits: under `.claude/**`, plus two `README.md` lines in the `adws/` tree. They are not part of this fix. Do not revert or rewrite them, and do not stage `.claude/**` with this change.
- **Docs.** `app_docs/feature-9gjajh-bdd-regression-suite.md` owns `features/regression/**`. Leave its update to the document phase.
