# Feature: Promote the #907 rate-limit detection scenario into the @regression suite

## Metadata
issueNumber: `1019`
adwId: `fecg87-feat-promote-907-sce`
issueJson: `{"number":1019,"title":"feat: promote #907 scenario into the @regression suite","body":"Promotes: feature-907\n\nDirect relocation (matches #734 (score: 3)): move this scenario from the per-issue directory,\nwhere only its own workflow's test phase runs it (by its `@adw-907` tag), into the `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-907.feature features/regression/<subdir>/feature-907.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- `git mv features/per-issue/step_definitions/feature-907.steps.ts features/regression/step_definitions/feature-907.steps.ts`\n- Add a feature-level `@regression` tag to the moved feature file.\n- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.\n- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.\n- Register the scenario's phrases in `features/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-907.feature`\n- Step definitions:\n- `features/per-issue/step_definitions/feature-907.steps.ts`\n\n## Phrases to register\n\n- `the Claude CLI answers the rate-limit probe with exit code <exit> and stdout:`\n- `the rate-limit probe runs`\n- `an agent command runs against the same Claude CLI output`\n- `the rate-limit probe reports \"limited\"`\n- `the rate-limit probe reports a \"five_hour\" limit that resets at \"2026-09-22T12:50:00Z\"`\n- `the agent command fails with a rate-limit error`\n- `the rate-limit error carries a \"five_hour\" limit that resets at \"2026-09-22T12:50:00Z\"`\n- `the Claude CLI answers the rate-limit probe with exit code 1 and stdout:`\n- `the rate-limit probe reports a \"seven_day\" limit that resets at \"2026-09-28T07:00:00Z\"`\n- `the rate-limit error carries a \"seven_day\" limit that resets at \"2026-09-28T07:00:00Z\"`\n- `the rate-limit probe reports a \"five_hour\" limit with no reset time`\n- `the rate-limit error carries a \"five_hour\" limit with no reset time`\n- `the rate-limit probe reports no limit type and no reset time`\n- `the rate-limit error carries no limit type and no reset time`\n- `the same Claude CLI output is streamed through an agent run`\n- `the agent run ends with an authentication failure`\n- `the agent run does not end rate-limited`\n- `the rate-limit probe reports a confirmed non-rate-limit failure`\n- `the mock GitHub API is configured to accept issue comments`\n- `a workflow for issue 911 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the pause-queue scanner runs 2 probe cycles`\n- `the pause queue entry for issue 911 records 2 probe failures`\n- `the pause-queue scanner runs 1 probe cycle`\n- `the pause queue no longer holds the workflow for issue 911`\n- `the mock GitHub API recorded a comment on issue 911`\n- `the Claude CLI answers the rate-limit probe with exit code <exit> and <stream>:`\n- `the rate-limit probe reports \"unknown\"`\n- `the Claude CLI answers the rate-limit probe with exit code 1 and <stream>:`\n- `the rate-limit probe logged a warning quoting \"<text>\"`\n- `the ADW codebase is checked out`\n- `the ADW TypeScript type-check passes`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-907.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-10-06T16:58:05Z","comments":[],"actionableComment":null}`

## Feature Description
Issue #907 is the "Detection" slice of `specs/prd/rate-limit-indefinite-retry.md`. It made ADW's
rate-limit decisions rest on structured stream-json facts end to end:

- the stream parser captures the limit type and reset time from a rejected `rate_limit_event`, and
  classifies `api_retry` and the `result` envelope's `api_error_status` by the documented enum and HTTP
  codes;
- `RateLimitError` carries `rateLimitType` and `resetsAt` when the parser captured them, and never
  invents them;
- the pause-queue probe (`probeRateLimit` / `classifyProbeResult`, `adws/triggers/rateLimitProbe.ts`)
  returns those facts with its verdict, has no text fallback (output with no JSON is `unknown`), and
  reports an authentication failure as a confirmed failure (`failed`), never `limited`.

The behavioural proof is `features/per-issue/feature-907.feature`: 10 scenario and outline blocks that
expand to **30 scenarios** across §1–§5 (the 2026-09-22 incident replay, the documented signals, the
authentication signals and the expired-login eviction at the scanner, the no-JSON rows and the probe's
log tail, and the type-check backstop). Its 12 novel step definitions are in
`features/per-issue/step_definitions/feature-907.steps.ts`; every other step reuses the pause-queue
harness and the generic registries already under `features/regression/`.

Only #907's own workflow ran these scenarios, selected by `@adw-907`. #907 has merged, so the file is on
the per-issue sweep's 14-day path, held there only by its `@promotion-suggested-2026-10-06` marker
(added by #1017). The promotion sweep scored it over its threshold and filed this issue
(`adw:feature`, `regression-promotion`, `hitl`).

This feature performs the direct relocation the issue prescribes:

- the feature moves into the existing `features/regression/rate-limit/` lane, beside feature-912,
  tagged `@regression @rate-limit-detection`;
- the step file moves to the flat `features/regression/step_definitions/`;
- every `@adw-` tag and the promotion marker are dropped;
- the moved file's two hooks are re-keyed from `@adw-907` to `@rate-limit-detection`, and the shared
  pause-queue harness hooks, which reach these rows today only through `@adw-907`/`@adw-910`, are
  widened to the new tag;
- the 12 novel phrases are registered in the vocabulary registry in their own domain section.

The value: the behaviour that stops a CLI wording change or an expired login from stranding a paused
workflow (the 2026-09-22 and 2026-09-24 incidents) joins the always-run safety net. Every workflow's
scenario test phase and the daily Regression Scenarios workflow will run it, and the sweep can no longer
delete it.

## User Story
As an ADW maintainer
I want the #907 rate-limit detection scenarios executed on every `@regression` run
So that a change to the stream parser, `RateLimitError`, the agent runner or the pause-queue probe that drops the limit type or reset time, brings back a text fallback, or mistakes an authentication failure for a rate limit is caught by the standing suite, instead of disappearing when the per-issue sweep deletes the scenarios

## Problem Statement
The #907 scenarios live in `features/per-issue/`, which the `@regression` run never selects. They are the
only executable, end-to-end proof that:

- the same Claude CLI output gives the probe's verdict and the agent's `RateLimitError` the same limit
  type and reset time, whatever the exit code, and a seven-day limit is read rather than assumed;
- each documented `api_retry` signal and `result.api_error_status` decides on its own, with no limit
  facts invented;
- an authentication signal ends the agent run as `authExpired`, never rate-limited, and makes the probe
  report a confirmed failure, so the scanner strikes and then evicts an expired login with a comment;
- output with no JSON is `unknown` on either stream, whatever it says, and the probe logs its tail.

Once the marker resolves, the 14-day sweep deletes the feature and its step file, and a regression in
`claudeStreamParser.ts`, `agentProcessHandler.ts`, `claudeAgent.ts`, `RateLimitError` or
`rateLimitProbe.ts` would then go undetected by BDD.

The relocation has four side requirements:

- **Hooks keyed on per-issue tags.** The moved file's `Before`/`After` are keyed on `@adw-907`. The
  shared pause-queue harness hooks (`feature-902.steps.ts` line 62, `feature-902-queue.steps.ts` lines
  207 and 229) reach these rows only through `@adw-907` (and `@adw-910` on the scanner row). Once those
  tags go, the probe stub is no longer reset, and the scanner row loses its mock GitHub API, its `gh`
  shadow and the save/clear/restore of the operator's real `agents/paused_queue.json`.
- **Hook order changes.** In `features/regression/step_definitions/` the file registers before
  `features/regression/support/hooks.ts`. Cucumber runs `After` hooks in reverse registration order, so
  the `@regression` teardown, which restores the host's `CLAUDE_CODE_PATH`, runs *before* the moved
  `After`. That `After` would then write the stub path back, or delete the variable, for the rest of the
  run.
- **Phrases not registered.** The 12 novel phrases are not in the registry.
- **Stale prose.** The moved feature's description and the step file's header name the old hook scope
  and claim #902's phrases are unregistered. Two promoted step files quote the shared hook expression.

## Solution Statement
A **direct relocation**, following the #734 / #923 / #924 / #1001 precedent (see
`specs/issue-1001-adw-stecnx-feat-promote-912-sce-sdlc_planner-promote-912-rate-limit-wait-regression.md`
and `specs/issue-923-adw-8d7505-feat-promote-910-sce-sdlc_planner-promote-910-pause-queue-regression.md`),
and the tag shape of repair commit `517f823d`: `@regression @<descriptive-tag>`, no `@adw-` tag anywhere,
hooks re-keyed, and shared hooks widened by appending the descriptive tag.

1. `git mv features/per-issue/feature-907.feature features/regression/rate-limit/feature-907.feature`.
   `rate-limit/` already holds feature-912; #907 is the detection half of the same PRD. The filename stays
   `feature-907.feature`, because the rot advisory looks the promoted feature up by that name under
   `features/regression/`.
2. `git mv features/per-issue/step_definitions/feature-907.steps.ts features/regression/step_definitions/feature-907.steps.ts`.
   **No import is rewritten.** Both directories are three levels deep, so `../../../adws/…` still resolves
   from the repo root, and `../../regression/step_definitions/feature-902.steps.ts` now resolves to the
   sibling file.
3. Replace the feature tag line `@adw-907 @adw-orkxdp-structured-rate-limi @promotion-suggested-2026-10-06`
   with `@regression @rate-limit-detection`, and delete all 10 scenario-level tag lines. Those lines are
   `@adw-907 @adw-orkxdp-structured-rate-limi`, with `@adw-910` also on the scanner row. The marker only
   means something under `features/per-issue/`, where its sole readers (`promotionTagState.ts` via
   `perIssueScenarioSweep.ts` and `promotionSweep.ts`) look.
4. Re-key the moved `Before`/`After` from `'@adw-907'` to `'@rate-limit-detection'`.
5. Make the moved harness order-independent. The agent-command When puts `CLAUDE_CODE_PATH` back in a
   `finally` before it returns, and the `After` stops writing the variable. This is the same concern
   the #930 promotion solved for its Claude CLI stand-in (`feature-930-plan-fixture.ts`,
   `restoreClaudeCli`). Here the override only has to live for one step, so the restore moves into the
   step.
6. Widen the three shared pause-queue harness hooks by appending `or @rate-limit-detection` inside their
   parenthesised OR list, exactly as `517f823d` appended `@pause-queue-reset-time` and
   `@pause-queue-ownership`. Keep every other alternative, including `@adw-907`, which the per-issue
   feature-902 rows still carry. Update the header comments of `feature-910.steps.ts` and
   `feature-911.steps.ts` that quote the expression.
7. Keep prose truthful in three description passages and the step file's header. No step line, data
   table, Examples table, scenario title or Background changes.
8. Register the 12 novel phrases in a new `## Given/When/Then — Rate-Limit Detection (@rate-limit-detection)`
   section of `features/regression/vocabulary.md` (W-RD1, T-RD1–T-RD11). Every row asserts a runtime
   artefact. The other 19 phrases the issue lists are already registered, so they are reused and not
   registered again (mapping in task 9).
9. Extend the README tree line for `rate-limit/` to name #907. Then prove the result: the 30 scenarios run
   and pass under `@rate-limit-detection` and inside the full `@regression` run, with no undefined or
   ambiguous step, and every static check stays green.

**Why this is safe (verified during planning, read-only):**

- **Closed dependency set.** Every step in the feature matches exactly one definition:
  - the 12 in `feature-907.steps.ts`, all of them used;
  - G18 and G1 in `features/regression/step_definitions/givenSteps.ts`;
  - T2 and T22 in `thenSteps.ts`;
  - in `feature-902.steps.ts`: the probe reply (`the Claude CLI answers the rate-limit probe with exit
    code {int} and {word}:`), `the rate-limit probe runs`, `the rate-limit probe reports {string}` and
    `the same Claude CLI output is streamed through an agent run`;
  - in `feature-902-queue.steps.ts`: G20, the scanner regex `^the pause-queue scanner runs (\d+) probe
    cycles?$`, `the pause queue entry for issue {int} records {int} probe failure(s)` and `the pause
    queue no longer holds the workflow for issue {int}`.

  No per-issue step file contributes a step. Nothing imports `feature-907.steps.ts`. It imports nothing
  from `features/per-issue/`. No other feature uses its 12 phrases.
- **No new ambiguity.** `cucumber.js` imports both `features/regression/step_definitions/**/*.ts` and
  `features/per-issue/step_definitions/**/*.ts` on every run, so the set of loaded definitions does not
  change. The moved module is still evaluated exactly once.
- **Hook coverage after the move, row by row.**
  - *Before:* the 902 probe reset, the 902-queue mock/`gh`/queue lifecycle and the 907 hooks, via
    `@adw-907`; the 910 hooks too on the scanner row, via `@adw-910`; and `hooks.ts`'s untagged
    guardrails hooks.
  - *After:* the same 902, 902-queue and 907 hooks, via `@rate-limit-detection` once tasks 6 and 8 are
    done, plus `hooks.ts`'s untagged and `@regression` hooks.
  - The `@regression` mock setup and teardown are idempotent beside the 902-queue ones. This is the
    double-hook arrangement promoted feature-910 and feature-911 already run under.
  - The 910 hooks drop out for the scanner row. That is inert: they reset the pinned clock, the `bunx`
    relaunch intercept and the decider world, and this row never sets any of them. `setPinnedClock` and
    `enableBunxRelaunchIntercept` are only called from feature-910's own steps.
- **Per-issue feature-902 is unaffected.** Its rows that carry `@adw-907` also carry `@adw-902`, so they
  keep the 902 hooks. They use none of feature-907's steps, so losing the 907 hooks (console capture, env
  restore) changes nothing for them.
- **No other hook newly matches.** None of these match `@regression @rate-limit-detection`:
  `OWN_ROWS` (`@dead-orchestrator-takeover`), webhook `HOOK_TAGS` (`@webhook or @adw-961`), and the
  `@regression and (@subprocess or @webhook)` harness hook.
- **Checks still cover the moved code.** `adws/checkGitGhGuard.ts` exempts `features/`.
  `tsconfig.json` includes `**/*.ts`. `eslint.config.js` has no per-directory rules.

## Relevant Files
Use these files to implement the feature:

**Moved (`git mv`; edited only as listed in the tasks):**
- `features/per-issue/feature-907.feature` → `features/regression/rate-limit/feature-907.feature`. The
  scenario file:
  - the feature tag line at line 1;
  - 10 scenario-level tag lines at lines 136, 157, 172, 187, 210, 231, 251 (also `@adw-910`), 267, 288
    and 303;
  - a long description whose lines 93–95, 112–113 and 128–131 name the old hook scope, the old
    env-restore design and the registry state;
  - Background G18.
- `features/per-issue/step_definitions/feature-907.steps.ts` →
  `features/regression/step_definitions/feature-907.steps.ts`. It holds:
  - the 12 novel definitions;
  - the module-scoped `world` (`thrownAgentError`, `savedClaudeCodePath`) and the console capture;
  - `Before`/`After` at lines 61 and 71, tagged `@adw-907`;
  - the agent-command When at lines 86–109;
  - a header comment at lines 1–7 quoting the old hook scope.

**Edited:**
- `features/regression/step_definitions/feature-902.steps.ts`: the `Before` at line 62 (`resetFeature902ProbeState`).
  Its tag expression gains `@rate-limit-detection`.
- `features/regression/step_definitions/feature-902-queue.steps.ts`: the `Before` at line 207 and the
  `After` at line 229 (mock infrastructure, `gh` shadow, `GITHUB_APP_*` blanking, pause-queue
  save/clear/restore, seeded-entry cleanup). Their tag expressions gain `@rate-limit-detection`.
- `features/regression/step_definitions/feature-910.steps.ts`: the header comment, lines 5–8, which quotes
  the 902 hook expression. Comment only.
- `features/regression/step_definitions/feature-911.steps.ts`: the header comment, lines 5–7, which quotes
  the 902 hook expression. Comment only.
- `features/regression/vocabulary.md`: gains the new domain section between the
  `@rate-limit-in-process-wait` section and `## Given/When/Then — Surface phases and lifecycles`.
- `README.md`: the `features/regression/rate-limit/` tree line (line 1216) names #907.

**Read-only references:**
- `cucumber.js`: `paths` and `import` already cover `features/regression/**`. Support files load as
  sorted groups in the configured order, so `features/regression/step_definitions/**` registers before
  `features/regression/support/hooks.ts`. No edit needed.
- `node_modules/@cucumber/cucumber/lib/assemble/assemble_test_cases.js` (`makeAfterHookSteps`, which
  calls `.reverse()`) and `lib/paths/paths.js` (`expandPaths`, sorted per glob). These are the basis of
  the hook-order argument in task 7.
- `features/regression/support/hooks.ts`: the untagged guardrails hooks and the `@regression` mock
  lifecycle that now also wraps the feature. It sets `setDefaultTimeout(60_000)`.
- `test/mocks/test-harness.ts`: the idempotent `setupMockInfrastructure` (it saves `CLAUDE_CODE_PATH` and
  `PATH`, then points `CLAUDE_CODE_PATH` at `claude-cli-stub.ts`) and `teardownMockInfrastructure`
  (restores them once).
- `features/regression/step_definitions/feature-930-plan-fixture.ts` (`restoreClaudeCli`): the precedent
  for an order-independent `CLAUDE_CODE_PATH` restore.
- `features/regression/step_definitions/feature-909-tooling.steps.ts`: the other reuser of the
  `feature-902.steps.ts` probe harness, keyed on its own `@envelope-conformance` tag.
- `features/regression/step_definitions/givenSteps.ts` (G18, G1), `thenSteps.ts` (T2, T22) and
  `world.ts` (`RegressionWorld`): reused, not redefined.
- `features/per-issue/feature-902.feature`: still carries `@adw-907` on its amended rows (lines 178–348).
  Those rows keep the 902 hooks via `@adw-902`. Not edited (see Notes).
- The system under test. None of it is edited:
  - `adws/triggers/rateLimitProbe.ts`;
  - `adws/core/claudeStreamParser.ts`;
  - `adws/agents/agentProcessHandler.ts`;
  - `adws/agents/claudeAgent.ts` (`runClaudeAgentWithCommand`);
  - `adws/types/agentTypes.ts` (`RateLimitError`);
  - `adws/core/environment.ts` (`resolveClaudeCodePath`, `clearClaudeCodePathCache`);
  - `adws/triggers/pauseQueueScanner.ts` and `pauseQueueDecider.ts`.
- `adws/promotion/vocabularyParser.ts`: the registry contract.
  - Only `## Given|When|Then…` sections are parsed.
  - A row needs five `|`-separated columns.
  - The phrase is column 2 with backticks stripped.
  - The pattern (column 4) must be `subprocess`, `phase-import` or `mock-query`; anything else falls
    back to `mock-query`.
  - Entries are keyed by phrase, so a re-registered phrase silently overwrites the earlier row.
- `adws/core/promotionTagState.ts`, `adws/triggers/perIssueScenarioSweep.ts` and
  `adws/triggers/promotionSweep.ts`: the only readers of `@promotion-suggested-*`. All of them are
  scoped to `features/per-issue/`.
- `.claude/commands/promote_regression_vocabulary.md`: the rot advisory expects `feature-907` under
  `features/regression/`.
- `.adw/scenarios.md` and `.adw/commands.md`: scenario directories, the registry path, and the
  validation commands.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` (conditional doc). It matches "manually promoting a
  `features/per-issue/` scenario into `features/regression/`", the vocabulary registry, "the Claude CLI
  stand-in's order-independent `CLAUDE_CODE_PATH` restore when the `@regression` teardown runs before a
  step file's own `After` hook", and the relocated pause-queue harness step definitions.
- `app_docs/feature-9gjajh-bdd-per-issue.md` (conditional doc). It matches "working on BDD per-issue
  scenario files or step definitions in `features/per-issue/`".
- `app_docs/feature-9gjajh-promotion-system.md` (conditional doc). It matches the #734-shaped promotion
  issue body, promotion tag-state tracking, and the rot/reuse advisory. It is the basis for dropping the
  marker.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` (conditional doc). It matches "the pause-queue
  rate-limit probe (`rateLimitProbe.ts`) or its outcome classification" and pause queue scanning, the
  system the promoted scenarios guard.
- `app_docs/feature-9gjajh-claude-stream-parser.md` (conditional doc). It matches the Claude JSONL
  stream parser, which captures the limit facts.
- `app_docs/feature-9gjajh-claude-agents-core.md` (conditional doc). It matches the agent runner and the
  agent process lifecycle (`claudeAgent.ts`, `agentProcessHandler.ts`): the `RateLimitError` facts and
  `authExpired`.

### New Files
- `features/regression/rate-limit/feature-907.feature`: the relocated feature, created by `git mv` in
  the existing `rate-limit/` lane.
- `features/regression/step_definitions/feature-907.steps.ts`: the relocated step file, created by
  `git mv` in the existing directory.

## Implementation Plan
### Phase 1: Foundation
Confirm the promotion is safe before anything moves:

- the system under test is merged;
- every reused definition lives in a regression-owned file;
- nothing imports the step file;
- the new tag is unused, and the `rate-limit/` lane exists.

Every task is verify-then-act, so a partially applied worktree (renames already staged) is reconciled
rather than re-run.

### Phase 2: Core Implementation
1. Relocate the two files.
2. Re-tag the feature and re-key the moved hooks.
3. Move the `CLAUDE_CODE_PATH` restore into the agent-command step.
4. Widen the shared pause-queue harness hooks and their quoting comments.
5. Refresh the prose that names the old scope, design and registry state.
6. Register the 12 phrases and extend the README tree line.

### Phase 3: Integration
Prove the following:

- the 30 scenarios are discovered with no undefined or ambiguous step;
- they pass under their own tag and inside the full `@regression` run, next to feature-909, feature-910
  and feature-911, which share the probe stub, the queue file and the double-hook arrangement;
- the per-issue feature-902 rows still tagged `@adw-907` keep passing without the 907 hooks;
- lint, both type-checks, the build and the unit suite stay green.

## Step by Step Tasks
Execute every step in order, top to bottom. Each task is idempotent: check the current state first and
skip an action that is already applied. Use the Edit tool for the `.feature` edits. The file holds
non-ASCII text (`•`, `§`, `–`, `·`, `’`), which must survive byte-for-byte.

### 1. Verify preconditions
- Check that the system under test is merged:
  - `grep -n "export function probeRateLimit" adws/triggers/rateLimitProbe.ts` matches;
  - `grep -n "export interface ProbeClassification extends RateLimitFacts" adws/triggers/rateLimitProbe.ts` matches;
  - `grep -n "readonly resetsAt?: number" adws/types/agentTypes.ts` matches;
  - `grep -n "export async function runClaudeAgentWithCommand" adws/agents/claudeAgent.ts` matches.
- Check that the reused definitions are regression-owned. Do not add or redefine any of them:
  - `the ADW codebase is checked out` and `the mock GitHub API is configured to accept issue comments`
    in `features/regression/step_definitions/givenSteps.ts`;
  - `the mock GitHub API recorded a comment on issue {int}` and `the ADW TypeScript type-check passes`
    in `thenSteps.ts`;
  - in `feature-902.steps.ts`: the probe reply, `the rate-limit probe runs`, `the rate-limit probe
    reports {string}` and `the same Claude CLI output is streamed through an agent run`, plus the
    exports `probeStub`, `getLastProbeClassification` and `getLastAgentRunResult`;
  - in `feature-902-queue.steps.ts`: G20, the scanner regex and the two queue Thens.
- `grep -rn "feature-907.steps" features adws test` returns nothing, so no importer needs repointing.
- `grep -rn "rate-limit-detection" features adws` returns nothing, and `features/regression/rate-limit/`
  holds only `feature-912.feature`. If the tag already exists, a previous run applied part of this plan:
  reconcile, do not redo.

### 2. Move the feature file
- If `features/per-issue/feature-907.feature` still exists, run
  `git mv features/per-issue/feature-907.feature features/regression/rate-limit/feature-907.feature`.
  The destination directory already exists.
- If it was already moved, confirm `git status --porcelain` shows the rename and take no action.

### 3. Re-tag the moved feature
- Replace line 1, `@adw-907 @adw-orkxdp-structured-rate-limi @promotion-suggested-2026-10-06`, with exactly
  `@regression @rate-limit-detection`.
- Delete each of the 10 scenario-level tag lines that sit directly above a `Scenario:` or
  `Scenario Outline:` line. In the original file they are lines 136, 157, 172, 187, 210, 231, 251, 267,
  288 and 303. Each reads `@adw-907 @adw-orkxdp-structured-rate-limi`, and line 251 adds `@adw-910`.
  - Delete each whole line, as was done for feature-537, feature-729 and feature-912.
  - Keep the blank line above each scenario.
  - Do not add `@regression` at scenario level: the feature-level tag is inherited.
- Check: `grep -nE '^\s*@' features/regression/rate-limit/feature-907.feature` prints exactly one line,
  `1:@regression @rate-limit-detection`.
- Touch no step line, doc string, data table, Examples table, scenario title or the Background.

### 4. Keep the moved feature's description truthful
These are prose-only edits inside the Feature description. Keep the indentation. Never start a
description line with `@`, `|`, `#`, `*` or a Gherkin keyword: a line starting with `#` is parsed as a
comment.

- (a) The harness note, original lines 93–95. Replace
  "Their hooks are scoped to `@adw-902`. Widen each existing hook to `@adw-902 or @adw-907`
  instead of adding a second `@adw-907` hook. The amended feature-902 scenarios carry both
  tags, and a second hook would initialise the mock infrastructure twice."
  with these two lines, indented six spaces like their neighbours:
  ```
        Their hooks are widened to `@rate-limit-detection`, the tag this feature carries, rather
        than duplicated in this feature's step file.
  ```
  Keep lines 91–92, the bullet's opening.
- (b) The agent-command note, original lines 112–113. Replace the sub-bullet
  "– Clear the cached CLI path before and after the run, and restore the env in an `After` hook."
  with these lines, at the same eight- and ten-space indentation:
  ```
          – Clear the cached CLI path before and after the run, and put the env back before the
            step returns: the `@regression` teardown runs before this feature's `After` hook, so a
            restore there would overwrite the value the teardown put back.
  ```
  Keep the other three sub-bullets.
- (c) The vocabulary note, original lines 128–131. Replace
  "#902's phrases have step definitions but are not registered; they are reused as written. The
  following are novel, because the registry has nothing for them: the agent-command When, the
  rate-limit error assertions, the probe's limit-fact assertions, the confirmed-failure assertion,
  the agent-run authentication assertions, and the probe-log assertion."
  with these lines, at two-space indentation:
  ```
    The phrases #902 introduced are registered too, by the promotions that reuse its harness: the
    probe reply (G-PQ10), the scanner and queue phrases (W-PQ5, T-PQ8, T-PQ10), and the probe and
    agent-run phrases (W-EC6, W-EC7, T-EC15). The following were novel, because the registry had
    nothing for them: the agent-command When, the rate-limit error assertions, the probe's
    limit-fact assertions, the confirmed-failure assertion, the agent-run authentication
    assertions, and the probe-log assertion. They are registered under `@rate-limit-detection`
    (W-RD1, T-RD1–T-RD11).
  ```
  The original first line began with `#`, so Gherkin silently dropped it as a comment. The rewrite
  starts with "The".
- Leave the rest of the description unchanged:
  - line 79's statement that feature-902's amended rows carry `@adw-907`, which is still true of that
    per-issue file;
  - the pre-existing `#902 moved the probe…` line 13, a harmless comment line.
- Check: `git diff -M HEAD -- features/per-issue/feature-907.feature features/regression/rate-limit/feature-907.feature`
  shows the rename with only the 11 tag-line changes and these three passages.

### 5. Move the step-definition file
- If `features/per-issue/step_definitions/feature-907.steps.ts` still exists, run
  `git mv features/per-issue/step_definitions/feature-907.steps.ts features/regression/step_definitions/feature-907.steps.ts`.
  If it was already moved, confirm the rename and take no action.
- Do **not** rewrite any relative import. Each of these resolves identically from the destination:
  - `../../../adws/core/index.ts`;
  - `../../../adws/agents/claudeAgent.ts`;
  - `../../../adws/types/agentTypes.ts`;
  - `../../../adws/triggers/rateLimitProbe.ts`;
  - `../../regression/step_definitions/feature-902.steps.ts`.

### 6. Re-key the moved hooks to the descriptive tag
- Line 61: `Before({ tags: '@adw-907' }, …)` becomes `Before({ tags: '@rate-limit-detection' }, …)`.
- Line 71: `After({ tags: '@adw-907' }, …)` becomes `After({ tags: '@rate-limit-detection' }, …)`. Task 7
  changes its body.
- Header comment, lines 5–6: replace "(widened to\n * `@adw-902 or @adw-907`)." with "(widened to\n *
  `@rate-limit-detection`).". Leave the rest of the comment as it is.
- Check: `grep -n "tags:" features/regression/step_definitions/feature-907.steps.ts` shows only
  `'@rate-limit-detection'`, twice.

### 7. Put `CLAUDE_CODE_PATH` back inside the agent-command step
Why: after the move, `hooks.ts` registers after this file, and Cucumber runs `After` hooks in reverse
registration order. The `@regression` teardown therefore restores the host's `CLAUDE_CODE_PATH` before
this file's `After` runs. Today's `After` would then write the stub path back, or delete the variable on
the 16 rows that never run the agent command, for the rest of the run.

- In the `world` object, remove the `savedClaudeCodePath` field from both the type and the initialiser.
  `thrownAgentError` stays.
- In `When('an agent command runs against the same Claude CLI output', …)`:
  - change `world.savedClaudeCodePath = process.env['CLAUDE_CODE_PATH'];` to
    `const savedClaudeCodePath = process.env['CLAUDE_CODE_PATH'];`. Keep the existing two-line comment
    above it.
  - Add a `finally` to the existing `try`/`catch` around `runClaudeAgentWithCommand`, and delete the
    trailing standalone `clearClaudeCodePathCache();` that the `finally` replaces:
    ```ts
      } finally {
        // Put back before the step returns: the @regression teardown registers after this file, so its After runs before ours and a later write-back would clobber the value it restored.
        if (savedClaudeCodePath === undefined) delete process.env['CLAUDE_CODE_PATH'];
        else process.env['CLAUDE_CODE_PATH'] = savedClaudeCodePath;
        clearClaudeCodePathCache();
      }
    ```
- Reduce the `After` hook to restoring `console.log` (the existing `if (originalConsoleLog) { … }`
  block) followed by a single `clearClaudeCodePathCache();`. Delete the `CLAUDE_CODE_PATH` restore
  branch, the `world.savedClaudeCodePath = undefined;` reset and the duplicate cache clear.
- Leave the `Before` body, the console capture, `writeThrowawayClaudeScript` and every Then step
  unchanged.
- Check: `grep -n "savedClaudeCodePath" features/regression/step_definitions/feature-907.steps.ts` shows
  only the When step's local constant and its `finally` uses.

### 8. Widen the shared pause-queue harness hooks to the new tag
- In `features/regression/step_definitions/feature-902.steps.ts` (line 62, the `Before`) and
  `features/regression/step_definitions/feature-902-queue.steps.ts` (line 207, the `Before`; line 229,
  the `After`), replace the tag expression
  `'(@adw-902 or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or @pause-queue-ownership) and not @adw-908 and not @adw-812'`
  with
  `'(@adw-902 or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or @pause-queue-ownership or @rate-limit-detection) and not @adw-908 and not @adw-812'`.
  - Change nothing else in those hooks.
  - Keep `@adw-907`: the per-issue feature-902 rows still carry it.
- In `features/regression/step_definitions/feature-910.steps.ts`, lines 7–8 of the header comment, change
  the quoted expression the same way:
  ```
   * `(@adw-902 or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or
   * @pause-queue-ownership or @rate-limit-detection) and not @adw-908 and not @adw-812`).
  ```
- In `features/regression/step_definitions/feature-911.steps.ts`, lines 6–7 of the header comment, insert
  ` or @rate-limit-detection` after `@pause-queue-ownership` inside the first quoted expression. Re-wrap
  only as far as needed to stay within the comment's width. The second quoted expression is the 910
  hooks' own; leave it unchanged.
- Leave the feature-910 and feature-911 `.feature` descriptions alone. Their hook-widening notes are
  historical instructions, and `517f823d` did not update them either.
- Check: `grep -c "or @rate-limit-detection)" features/regression/step_definitions/feature-902.steps.ts features/regression/step_definitions/feature-902-queue.steps.ts`
  prints `1` and `2`.

### 9. Register the phrases in `features/regression/vocabulary.md`
The issue lists 31 phrase instances. They reduce to 12 novel cucumber expressions plus 19 that are
already registered. The registered ones are reused and must **not** be registered again: the parser
keys entries by phrase, so a second row would silently overwrite the first.

| Issue phrase (instances) | Registry row |
|---|---|
| `the Claude CLI answers the rate-limit probe with exit code <exit>/1 and stdout/<stream>:` | already registered: `… with exit code {int} and {word}:` (G-PQ10) |
| `the rate-limit probe runs` | already registered: W-EC6 |
| `the rate-limit probe reports "limited"` / `"unknown"` | already registered: T-EC15 |
| `the same Claude CLI output is streamed through an agent run` | already registered: W-EC7 |
| `the mock GitHub API is configured to accept issue comments` | already registered: G1 |
| `a workflow for issue 911 is paused in the rate-limit queue for the target repository "acme/widgets"` | already registered: G20 |
| `the pause-queue scanner runs 2 probe cycles` / `1 probe cycle` | already registered: W-PQ5 |
| `the pause queue entry for issue 911 records 2 probe failures` | already registered: T-PQ10 |
| `the pause queue no longer holds the workflow for issue 911` | already registered: T-PQ8 |
| `the mock GitHub API recorded a comment on issue 911` | already registered: T2 |
| `the ADW codebase is checked out` | already registered: G18 |
| `the ADW TypeScript type-check passes` | already registered: T22 |
| `an agent command runs against the same Claude CLI output` | **new**: W-RD1 |
| `the rate-limit probe reports a "five_hour"/"seven_day" limit that resets at "…"` | **new**: T-RD1 |
| `the rate-limit probe reports a "five_hour" limit with no reset time` | **new**: T-RD2 |
| `the rate-limit probe reports no limit type and no reset time` | **new**: T-RD3 |
| `the rate-limit probe reports a confirmed non-rate-limit failure` | **new**: T-RD4 |
| `the rate-limit probe logged a warning quoting "<text>"` | **new**: T-RD5 |
| `the agent command fails with a rate-limit error` | **new**: T-RD6 |
| `the rate-limit error carries a "five_hour"/"seven_day" limit that resets at "…"` | **new**: T-RD7 |
| `the rate-limit error carries a "five_hour" limit with no reset time` | **new**: T-RD8 |
| `the rate-limit error carries no limit type and no reset time` | **new**: T-RD9 |
| `the agent run ends with an authentication failure` | **new**: T-RD10 |
| `the agent run does not end rate-limited` | **new**: T-RD11 |

Where to insert: directly after the `@rate-limit-in-process-wait` section, i.e. after its closing
paragraph ("This section also reuses already-registered phrases, … guard pair."), and before the `---`
that precedes `## Given/When/Then — Surface phases and lifecycles`. Separate the new section from both
neighbours with a `---` line.

Format rules:

- Use the established five-column schema.
- The Pattern column is exactly `phase-import` for every row.
- Write each phrase exactly as its cucumber expression appears in `feature-907.steps.ts`.
- No cell contains `|`. `vocabularyParser.ts` splits on every `|`, escaped or not.

Paste this section:

```md
## Given/When/Then — Rate-Limit Detection (@rate-limit-detection)

These phrases prove that ADW's rate-limit decisions rest on structured stream-json facts end to end
(phase-import). One stubbed Claude CLI reply, set with `the Claude CLI answers the rate-limit probe
with exit code {int} and {word}:`, is fed to three consumers: the real rate-limit probe
(`probeRateLimit`, through the pause-queue harness's injected exec seam `probeStub`, W-EC6), the real
`handleAgentProcess` on a fake child process (W-EC7), and the real `runClaudeAgentWithCommand`, which
spawns a throwaway executable that replays the same output and exit code (W-RD1). The real Claude CLI
is never spawned. Every assertion targets a runtime artefact: the classification the probe returns
(verdict, limit type, reset time), the error the agent command throws and the limit facts it carries,
the `authExpired`/`rateLimited` outcome of the agent run, and the log lines written while the scenario
ran. No step reads a source file, satisfying the Rot-Detection Rubric. The definitions live in
`feature-907.steps.ts`. Its hooks are keyed on `@rate-limit-detection`: they clear the recorded error,
capture `console.log` for the scenario and restore it, and clear the CLI path cache. The pause-queue
harness hooks in `feature-902.steps.ts` and `feature-902-queue.steps.ts` also run for that tag: they
reset the probe stub and its recorded results, set up the mock GitHub API and the `gh` shadow, and save,
clear and restore the pause queue. A scenario that uses these phrases must carry the tag.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| W-RD1 | `an agent command runs against the same Claude CLI output` | Writes a throwaway executable that prints the probe exec seam's stubbed stdout and stderr, each newline-terminated, and exits with the stubbed code; points `CLAUDE_CODE_PATH` at it for this step only, putting the previous value back before the step returns; runs the real `runClaudeAgentWithCommand` with no state path and a throwaway output file and cwd; records the error it throws | phase-import | thrown agent error (artefact) |
| T-RD1 | `the rate-limit probe reports a {string} limit that resets at {string}` | Asserts the classification W-EC6 recorded carries the limit type verbatim and a `resetsAt` (epoch seconds, as the CLI emits it) that is the given ISO 8601 instant | phase-import | returned probe classification |
| T-RD2 | `the rate-limit probe reports a {string} limit with no reset time` | As T-RD1, with `resetsAt` absent; a defaulted value fails | phase-import | returned probe classification |
| T-RD3 | `the rate-limit probe reports no limit type and no reset time` | Asserts the classification carries neither `rateLimitType` nor `resetsAt` | phase-import | returned probe classification |
| T-RD4 | `the rate-limit probe reports a confirmed non-rate-limit failure` | Asserts the classification's verdict is none of `clear`, `limited` or `unknown`; `unknown` is reserved for output with no JSON | phase-import | returned probe classification |
| T-RD5 | `the rate-limit probe logged a warning quoting {string}` | Asserts a line of the `console.log` output captured during the scenario, where the probe's `log()` writes its unknown-result warning, contains the given text | phase-import | log stream (captured console output) |
| T-RD6 | `the agent command fails with a rate-limit error` | Asserts the error W-RD1 recorded is a `RateLimitError` | phase-import | thrown agent error (artefact) |
| T-RD7 | `the rate-limit error carries a {string} limit that resets at {string}` | Asserts the `RateLimitError` carries the limit type verbatim and a `resetsAt` (epoch seconds) that is the given ISO 8601 instant | phase-import | thrown agent error (artefact) |
| T-RD8 | `the rate-limit error carries a {string} limit with no reset time` | As T-RD7, with `resetsAt` absent; a defaulted value fails | phase-import | thrown agent error (artefact) |
| T-RD9 | `the rate-limit error carries no limit type and no reset time` | Asserts the `RateLimitError` carries neither `rateLimitType` nor `resetsAt` | phase-import | thrown agent error (artefact) |
| T-RD10 | `the agent run ends with an authentication failure` | Asserts the `AgentResult` W-EC7 recorded has `authExpired: true` | phase-import | returned agent result |
| T-RD11 | `the agent run does not end rate-limited` | Asserts the `AgentResult` W-EC7 recorded does not have `rateLimited: true` | phase-import | returned agent result |

This section also reuses already-registered phrases, so they need no new rows: `the ADW codebase is
checked out` (G18, Background), G1, G20, T2, T22, the probe reply `the Claude CLI answers the
rate-limit probe with exit code {int} and {word}:` (G-PQ10), the scanner and queue phrases W-PQ5,
T-PQ8 and T-PQ10 (`@pause-queue-reset-time`), and the probe and agent-run phrases W-EC6, W-EC7 and
T-EC15 (`@envelope-conformance`).
```

### 10. Extend the README tree line
- In `README.md`'s `features/` tree, replace the `rate-limit/` line (line 1216):
  `│   ├── rate-limit/     # Regression scenarios covering the in-process wait for a five-hour rate limit: the wait policy, the announced waits, liveness while waiting, and the pause-path fallback (#912)`
  with
  `│   ├── rate-limit/     # Regression scenarios covering rate-limit detection — the limit type and reset time carried from the stream parser through the rate-limit error to the pause-queue probe, which classifies documented signals only (#907) — and the in-process wait for a five-hour rate limit: the wait policy, the announced waits, liveness while waiting, and the pause-path fallback (#912)`
- Change nothing else in `README.md`.

### 11. Unit tests: no new test, owning tests re-run
- No unit test is added. The reasons are under Testing Strategy → Unit Tests.
- Run the unit tests that own the behaviour the promoted scenarios prove, plus the parser that reads the
  edited registry:
  `bunx vitest run adws/triggers/__tests__/rateLimitProbe.test.ts adws/core/__tests__/claudeStreamParser.test.ts adws/agents/__tests__/agentProcessHandler.test.ts adws/agents/__tests__/claudeAgent.test.ts adws/triggers/__tests__/pauseQueueScanner.test.ts adws/promotion/__tests__/vocabularyParser.test.ts`
- Then run the full unit suite with `bun run test:unit`.

### 12. Run the Validation Commands
- Execute every command in `Validation Commands`, in order. Expected results:
  - the moved feature is discovered with 30 scenarios and no undefined or ambiguous step;
  - all 30 pass under `@rate-limit-detection`;
  - the per-issue rows still tagged `@adw-907` (feature-902's) pass;
  - the full `@regression` run is green, with those 30 scenarios among the passed ones;
  - lint, both type-checks, the build and the unit suite pass.
- If a `@regression` failure appears outside the moved feature, check first whether it involves
  `CLAUDE_CODE_PATH`, `console.log`, the probe stub or `agents/paused_queue.json`: these are the only
  shared state this change touches. Trace it to tasks 7–8 before changing anything else.

## Testing Strategy
### Unit Tests
Unit tests are enabled: `.github/adw.yml` leaves `unitTests` commented out. **No new unit test is
needed**, because this feature adds no production code path. It moves BDD assets, re-keys and widens
Cucumber hook tag expressions, moves one test-harness env restore into a step, and edits Markdown and
comments.

The behaviour the promoted scenarios prove is already unit-tested where it lives:

- `adws/core/__tests__/claudeStreamParser.test.ts`: it captures `rateLimitType`/`resetsAt` from a
  rejected event, keeps the type with no reset time, reads `seven_day` rather than assuming `five_hour`,
  classifies `api_retry` by the documented enum and HTTP status, and covers `authentication_failed`.
- `adws/triggers/__tests__/rateLimitProbe.test.ts`: it covers `limited` with or without facts, the
  documented `api_retry` signals, `failed` on authentication, `unknown` for output with no JSON, and the
  warn tail.
- `adws/agents/__tests__/agentProcessHandler.test.ts`: it carries the 2026-09-22 facts, carries no facts
  for a signal-only rate limit, and reports `authExpired`, not `rateLimited`, on authentication signals.
- `adws/agents/__tests__/claudeAgent.test.ts`: it throws a `RateLimitError` carrying the handler's facts.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts`: it covers strikes and eviction with a comment.

The edited registry is read by `adws/promotion/vocabularyParser.ts`, whose row contract is covered by
`adws/promotion/__tests__/vocabularyParser.test.ts`. The new rows follow that contract (five columns, a
known `phase-import` pattern), so no parser change or test is needed.

Task 11 re-runs these six files and then the whole suite (`bun run test:unit`) to confirm zero
regressions.

### Edge Cases
- **Hook order flips.**
  - *Before.* The moved file's `Before` now runs before `hooks.ts`'s `Before` hooks rather than after.
    The console capture is unaffected, because no other applicable hook replaces `console.log`.
  - *After.* Its `After` now runs after the `@regression` teardown. Task 7 makes that harmless:
    `CLAUDE_CODE_PATH` is restored inside the step, and the `After` only restores `console.log` and
    clears the path cache. The cache is keyed on the live variable anyway.
- **Double mock lifecycle.** The 902-queue hooks and the `@regression` hooks both set up and tear down
  the mock infrastructure. Both functions are idempotent: one mock server per scenario, and the
  host's `PATH`, `CLAUDE_CODE_PATH` and `GH_*` are restored exactly once, by whichever teardown runs
  first. The 902-queue `After` then runs its file and process cleanup, which needs no mock.
- **The scanner row loses its `@adw-910` hooks.** This is inert, because it never pins the clock or arms
  the `bunx` intercept. Its probe answers an authentication failure, so the decider strikes twice, the
  third cycle evicts, and the comment goes through the `gh` shadow to the mock. It never reaches the
  resume path. `acme/widgets` is fictional, so a mis-wired post cannot reach a real issue.
- **Real artefacts.** The scanner row seeds `agents/bdd902-911-*` state and a pause-queue entry. The
  902-queue `After` removes the state, kills the fixture orchestrator and restores the operator's
  `agents/paused_queue.json`, never clobbering it. The agent-command rows write only under
  `os.tmpdir()`.
- **Same output, three consumers.** The outline rows with exit code `0` must still end the agent command
  with a `RateLimitError`: the stream decides, not the exit code. The `’` typographic-apostrophe and
  `·` rows must stay byte-identical (use the Edit tool, task 3).
- **Docker leg.** The rows are new to `regression.yml`'s Docker job (`test/docker-run.sh` copies the
  read-only checkout to `/tmp/bdd/workspace`). The throwaway executable is `#!/bin/sh` plus `cat`. T22
  already passes `--incremental false`. The scanner row needs the same `agents/` writes that promoted
  feature-910 and feature-911 already make there.
- **Timing.** Most of the 30 rows are in-process, and 14 of them spawn a sub-second shell script. The
  scanner row runs three cycles with no resume, so it skips the 2 s readiness window. Add one T22
  type-check. Everything stays well inside the 60 s step default and the daily jobs' 30-minute budget.
- **Run order.** `features/regression/rate-limit/feature-907.feature` sorts directly before
  `feature-912.feature`. The 907 rows leave `console.log`, `CLAUDE_CODE_PATH` and the pause queue as they
  found them, so feature-912 starts clean.
- **Old tags.** The moved file carries no `@adw-` tag. `--tags "@adw-907"` now selects only the
  per-issue feature-902 rows that still carry it, and nothing at all once feature-902 is promoted.
  `--tags "@adw-910"` no longer selects the scanner row. #910 is merged and promoted, so nothing runs
  that tag any more.

## Acceptance Criteria
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` passes, and its run includes the
  30 scenarios of `features/regression/rate-limit/feature-907.feature`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-detection"` runs 30 scenarios and all
  30 pass.
- `features/per-issue/feature-907.feature` and `features/per-issue/step_definitions/feature-907.steps.ts`
  no longer exist (moved, not copied), and nothing named `feature-907*` remains under
  `features/per-issue/`.
- `features/regression/rate-limit/feature-907.feature` has exactly one tag line,
  `@regression @rate-limit-detection`, and no `@adw-` or `@promotion-suggested-*` tag at feature or
  scenario level. Its steps, doc strings, tables, Examples, titles and Background are byte-identical to
  the source, and its description differs only in the three passages of task 4.
- `features/regression/step_definitions/feature-907.steps.ts`:
  - keys both hooks on `@rate-limit-detection`;
  - keeps its relative imports unchanged;
  - restores `CLAUDE_CODE_PATH` inside the agent-command step before it returns;
  - has an `After` that no longer writes `CLAUDE_CODE_PATH`.
- The tag expressions of the `Before` in `feature-902.steps.ts` and the `Before`/`After` in
  `feature-902-queue.steps.ts` include `@rate-limit-detection` in their OR list and are otherwise
  unchanged. The header comments of `feature-910.steps.ts` and `feature-911.steps.ts` quote the widened
  expression.
- `features/regression/vocabulary.md` has the `@rate-limit-detection` section:
  - W-RD1 and T-RD1–T-RD11, 12 rows;
  - each row has five columns, the Pattern `phase-import` and an artefact assertion target;
  - none of the already-registered phrases (G1, G18, G20, T2, T22, G-PQ10, W-PQ5, T-PQ8, T-PQ10, W-EC6,
    W-EC7, T-EC15) is registered again.
- No undefined or ambiguous step is reported for the moved feature or anywhere in the `@regression` run.
- The per-issue feature-902 rows still tagged `@adw-907` pass, or the tag selects nothing if feature-902
  has been promoted.
- The README tree's `rate-limit/` line names #907's detection scenarios.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build` and
  `bun run test:unit` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `test -z "$(find features/per-issue -name 'feature-907*')" && echo MOVED-OK`: the sources are gone, and
  the command prints `MOVED-OK`.
- `test -f features/regression/rate-limit/feature-907.feature && test -f features/regression/step_definitions/feature-907.steps.ts && echo DEST-OK`:
  the files landed, and the command prints `DEST-OK`.
- `grep -nE '^\s*@' features/regression/rate-limit/feature-907.feature`: prints exactly
  `1:@regression @rate-limit-detection`.
- `grep -n "tags:" features/regression/step_definitions/feature-907.steps.ts`: two lines, both
  `'@rate-limit-detection'`, with no `@adw-`.
- `grep -c "or @rate-limit-detection)" features/regression/step_definitions/feature-902.steps.ts features/regression/step_definitions/feature-902-queue.steps.ts`:
  prints `…feature-902.steps.ts:1` and `…feature-902-queue.steps.ts:2`.
- `grep -cE '^\| [GWT]-RD[0-9]+ \|' features/regression/vocabulary.md`: prints `12`.
- `grep -E '^\| [GWT]-RD' features/regression/vocabulary.md | awk -F'|' '{print NF}' | sort -u`: prints
  only `7`. Every new row has exactly five columns.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-detection" --dry-run`: 30 scenarios
  discovered, no undefined and no ambiguous steps.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-detection"`: 30 scenarios, 30 passed.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-907"`: the per-issue feature-902 rows that
  still carry the tag all pass. They now run without the 907 hooks. If feature-902 has already been
  promoted, the run selects 0 scenarios.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --dry-run`: no undefined and no
  ambiguous steps anywhere in the suite.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the full regression suite is green
  and includes the moved feature. This is the primary acceptance command.
- `bun run lint`: the linter passes.
- `bunx tsc --noEmit`: the root type-check passes, covering the moved and edited step files.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the ADW type-check passes.
- `bun run build`: the build succeeds.
- `bunx vitest run adws/triggers/__tests__/rateLimitProbe.test.ts adws/core/__tests__/claudeStreamParser.test.ts adws/agents/__tests__/agentProcessHandler.test.ts adws/agents/__tests__/claudeAgent.test.ts adws/triggers/__tests__/pauseQueueScanner.test.ts adws/promotion/__tests__/vocabularyParser.test.ts`:
  the owning unit tests pass.
- `bun run test:unit`: the unit suite passes with zero regressions.

## Notes
- **Coding guidelines.** Adhere to `.adw/coding_guidelines.md`. Apart from file moves and Markdown, the
  TypeScript edits are:
  - five hook tag strings (two in the moved file, three in the 902 harness);
  - the When step's local constant and its `finally` block, with a one-line comment;
  - the `world` field removal and the trimmed `After`;
  - three header comments.

  Per the **Comments** guideline, the new comment states only the ordering constraint. No edited comment
  may cite an issue number.
- **`hitl` is set.** The resulting PR must be human-approved before merge. The `regression-promotion`
  label also makes the review phase post the non-blocking rot/reuse advisory comment. That comment needs
  the promoted file to stay named `feature-907.feature` under `features/regression/`.
- **Concurrent promotion of feature-902.** #1017 marked both feature-902 and feature-907
  `@promotion-suggested-2026-10-06`. A sibling worktree, `feature-issue-1018-promote-rate-limit-probe-regression`,
  sits at the same base commit and is almost certainly the feature-902 promotion. It will touch the same
  three hook expressions and the 910/911 header comments, and probably `vocabulary.md` and the README's
  `rate-limit/`/`pause-queue/` lines too. Whichever PR merges second must resolve the conflict:
  - keep both descriptive tags in the hook OR list;
  - drop `@adw-907` only once no feature carries it;
  - keep both vocabulary sections.
- **No new library** is required. The repository's install command, per `.adw/commands.md`, is
  `bun add <package>`.
- **Deliberately not changed:**
  - `@adw-907`, `@adw-910` and `@adw-911` stay in the shared hook expressions, because per-issue
    feature-902 rows still carry them. `517f823d` kept the per-issue alternatives the same way.
  - `features/per-issue/feature-902.feature` line 78 still points to `features/per-issue/feature-907.feature`.
    That file belongs to its own pending promotion, and editing it here would only add a conflict with
    #1018.
  - The historical hook-widening instructions in the promoted feature-910 and feature-911 descriptions.
  - In the moved step file: its non-null assertions, its `'sonnet'` model argument, and the throwaway
    `adw-907-agent-*` temp directories it leaves under `os.tmpdir()`. These are pre-existing and outside
    a relocation.
  - The description's pre-existing comment line 13 (`#902 moved the probe…`), which Gherkin ignores.
- **Docs.** The document phase should reflect the promotion. The precedent promotions made these
  changes in their document-agent commit, not the build commit.
  - In `app_docs/feature-9gjajh-bdd-regression-suite.md`:
    - the "Maintain `features/regression/rate-limit/`" bullet gains feature-907
      (`@regression @rate-limit-detection`, 30 scenarios, W-RD1 and T-RD1–11);
    - the promoted-features tag list ("the ten promoted features") gains `@rate-limit-detection`
      (`feature-907`);
    - the per-issue rows named in the pause-queue-hooks sentence drop `feature-907`;
    - the order-independent `CLAUDE_CODE_PATH` restore gets a mention.
  - `.adw/conditional_docs.md` needs a condition for the promoted rate-limit detection scenario.
