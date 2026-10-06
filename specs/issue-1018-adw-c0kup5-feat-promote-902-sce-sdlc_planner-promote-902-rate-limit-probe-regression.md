# Feature: Promote the #902 rate-limit probe scenario into the @regression suite

## Metadata
issueNumber: `1018`
adwId: `c0kup5-feat-promote-902-sce`
issueJson: `{"number":1018,"title":"feat: promote #902 scenario into the @regression suite","body":"Promotes: feature-902\n\nDirect relocation (matches #734 (score: 3)): move this scenario from the per-issue directory,\nwhere only its own workflow's test phase runs it (by its `@adw-902` tag), into the `@regression` suite.\n\n## What to do\n\n- `git mv features/per-issue/feature-902.feature features/regression/<subdir>/feature-902.feature`\n  (choose a short subdirectory name reflecting the scenario's subject).\n- Add a feature-level `@regression` tag to the moved feature file.\n- Remove the `@adw-` tags from the moved feature file, at feature and scenario level: a regression feature never carries a per-issue tag.\n- Where a `Before`/`After` hook in the moved step definitions is scoped to one of those `@adw-` tags, re-scope it to a descriptive tag you add to the moved feature, so the hook still runs.\n- Register the scenario's phrases in `features/regression/vocabulary.md` under the appropriate\n  Given/When/Then sections, with rubric-compliant descriptions (assert an observable artefact,\n  never a source-file property).\n- Do not rewrite the step-def files' relative imports.\n\n## Source paths\n\n- Feature: `features/per-issue/feature-902.feature`\n- Step definitions:\n- (no step-def siblings found)\n\n## Phrases to register\n\n- `the Claude CLI answers the rate-limit probe with exit code <exit> and stdout:`\n- `the rate-limit probe runs`\n- `the rate-limit probe reports \"limited\"`\n- `the Claude CLI answers the rate-limit probe with exit code 1 and <stream>:`\n- `the rate-limit probe reports \"unknown\"`\n- `the Claude CLI answers the rate-limit probe with exit code 0 and stdout:`\n- `the rate-limit probe reports \"clear\"`\n- `the rate-limit probe requested \"stream-json\" output from the Claude CLI`\n- `the rate-limit probe requested verbose output from the Claude CLI`\n- `the Claude CLI answers the rate-limit probe with exit code 1 and stdout:`\n- `the same Claude CLI output is streamed through an agent run`\n- `the agent run ends rate-limited`\n- `the mock GitHub API is configured to accept issue comments`\n- `a workflow for issue 871 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the pause-queue scanner runs 36 probe cycles`\n- `the pause queue still holds the workflow for issue 871`\n- `the pause queue entry for issue 871 has not gained a probe failure`\n- `the mock harness recorded zero comment posts on issue 871`\n- `the pause-queue scanner runs 1 probe cycle`\n- `the paused workflow for issue 871 is relaunched under its original adwId`\n- `the pause queue no longer holds the workflow for issue 871`\n- `the mock GitHub API recorded a comment on issue 871`\n- `a workflow for issue 875 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the paused workflow for issue 875 has already recorded 2 unknown probe failures`\n- `the pause queue still holds the workflow for issue 875`\n- `the pause queue entry for issue 875 has not gained a probe failure`\n- `the mock harness recorded zero comment posts on issue 875`\n- `a workflow for issue 872 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `a workflow for issue 874 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `a workflow for issue 876 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `a workflow for issue 877 is paused in the rate-limit queue for the target repository \"acme/widgets\"`\n- `the pause-queue scanner runs 3 probe cycles`\n- `the pause queue still holds a workflow for each of these issues, none of which has gained a probe failure:`\n- `the Claude CLI answers the rate-limit probe with exit code 1 and stderr:`\n- `the pause-queue scanner runs 2 probe cycles`\n- `the pause queue entry for issue 876 records 2 probe failures`\n- `the pause queue no longer holds the workflow for issue 876`\n- `the mock GitHub API recorded a comment containing the text \"failed to resume after 3 probe attempts\"`\n- `the mock GitHub API recorded a comment containing the text \"## Retry\"`\n- `the ADW codebase is checked out`\n- `the ADW TypeScript type-check passes`\n\n## Acceptance\n\n- `--tags \"@regression\"` executes the moved scenario(s) and they prove `@regression` green.\n- The old per-issue paths (`features/per-issue/feature-902.feature` and its step-def siblings) no longer exist.\n- No ambiguous-step error is introduced.\n\n## Note\n\n`hitl` is set on this issue — the resulting PR must be human-approved before merge.","state":"OPEN","author":"app/paysdoc-adw","labels":["hitl","adw:feature","regression-promotion"],"createdAt":"2026-10-06T16:57:59Z","comments":[],"actionableComment":null}`

## Feature Description
Issue #902 fixed a production stranding. On 2026-09-24 the pause-queue scanner dropped six
session-limited `adwChore` workflows after three "unknown" probes. `probeRateLimit()` had been
substring-matching plain-text CLI output against a hand-kept list that did not know the new wording of
the session limit. The fix made the probe structural:

- it runs the Claude CLI with `--verbose --output-format stream-json`;
- it classifies `limited` from the same stream-parser state the agents pause on
  (`adws/core/claudeStreamParser.ts`, consumed by `adws/agents/agentProcessHandler.ts`);
- a limited probe never counts as a strike.

Later issues changed the same code: #907 deleted the text fallback, and #910 and #911 put the scanner
behind the pure decider and per-cron ownership. Each amended feature-902's scenarios and flagged the
rows it relies on with its own `@adw-` tag.

The behavioural proof is `features/per-issue/feature-902.feature`: 12 scenario and outline blocks that
expand to **21 scenarios** (7 plain scenarios plus 14 outline rows) in four sections:

- **§1, the probe's verdict.**
  - A rejected `rate_limit_event` makes the probe report `limited`, whatever the text or the exit code.
  - Non-JSON limit wording reports `unknown`.
  - A clean reply, or a `rate_limit_event` that was not rejected, reports `clear`.
  - Any other failure reports `unknown`.
  - The probe asks the CLI for verbose stream-json.
- **§2, one detector.** Every stream event that ends an agent run rate-limited also makes the probe
  report `limited`.
- **§3, the scanner.**
  - A workflow held by a session limit stays queued through 36 probe cycles (three hours) with no
    strike and no comment, and resumes on the first clear probe.
  - A limited probe does not push an entry one strike short of eviction over the threshold.
  - The 2026-09-24 incident is replayed.
  - A genuinely unknown failure still strikes, and the third evicts with a comment that names
    `## Retry`.
- **§4, the type-check backstop.**

The harness these scenarios run on, `feature-902.steps.ts` and `feature-902-queue.steps.ts`, already
lives in `features/regression/step_definitions/`. The #910 promotion (#923) moved it there because the
promoted feature-910 and feature-911 run on it. Only the feature file is still in `features/per-issue/`,
which is why the issue lists no step-def siblings.

Only workflows that selected `@adw-902` (or the flagged `@adw-907`, `@adw-910` and `@adw-911` rows) ran
these scenarios, and all four issues have merged. The promotion sweep stamped the file
`@promotion-suggested-2026-10-06` (PR #1017) and filed this issue (`adw:feature`,
`regression-promotion`, `hitl`).

This feature performs the direct relocation the issue prescribes:

- the feature moves into the existing `features/regression/pause-queue/` lane, beside feature-910 and
  feature-911, and is tagged `@regression @pause-queue-probe`;
- every `@adw-` tag and the promotion marker are dropped. The four §3 rows flagged by the
  already-promoted #910 and #911 carry those features' descriptive tags instead
  (`@pause-queue-reset-time`, `@pause-queue-ownership`), as feature-910's own #911-flagged rows already do;
- the three pause-queue harness hooks are re-scoped from `@adw-902` to `@pause-queue-probe`;
- the two unregistered phrases are registered in a new vocabulary section. The other 20 step
  definitions the feature uses are already registered.

The value: the probe's classification, its parity with the agents' detector and the scanner's
never-strike-on-limited rule join the always-run safety net. A change that strands session-limited
workflows again is then caught by every workflow's scenario test phase and by the daily Regression
Scenarios workflow.

## User Story
As an ADW maintainer
I want the #902 rate-limit probe scenarios executed on every `@regression` run
So that a change to the probe classifier, the shared stream parser, the agents' rate-limit detection or the pause-queue scanner that would again drop session-limited workflows after three probes is caught by the standing suite, rather than lost when the per-issue sweep deletes the scenarios

## Problem Statement
`features/per-issue/feature-902.feature` has no `@regression` tag, so `--tags "@regression"` never
selects it. No open workflow selects `@adw-902`, `@adw-907`, `@adw-910` or `@adw-911` any more. Once its
marker resolves, the 14-day per-issue sweep deletes the file.

It is the only executable proof of four behaviours:

- **The probe asks the CLI for `--verbose --output-format stream-json`.** Without that request the real
  CLI never emits a `rate_limit_event`. Every structured row would pass against a stub while
  production silently fell back to unclassifiable text.
- **The probe's verdict table over raw CLI output.** This includes #907's inversion: limit wording
  without JSON is now `unknown`.
- **Detector parity with `handleAgentProcess`** for the `api_retry` overload and server-error events.
  feature-909 pins parity only for the real capture and the CLI stub.
- **A three-hour session limit never costs a strike**, and the workflow resumes on the first clear
  probe. The 2026-09-24 replay pins this too. feature-910 covers the decider and the reset-time paths,
  not these.

The relocation has three side requirements:

- **The harness hooks are keyed on `@adw-902`, which a regression feature may not carry.** If they were
  not re-scoped, the rows would still run, because the `@regression` hook gives them a mock server. But
  they would run without the harness:
  - the operator's live `agents/paused_queue.json` would not be saved, cleared and restored;
  - the scanner's `gh issue comment` calls would reach the real `gh` instead of the recording shadow;
  - the GitHub App variables would not be blanked;
  - the probe stub would not be reset between rows.

  T2 and T3 would then fail, but only after the damage.
- **Two of the feature's phrases are not in the registry.**
- **Text the move makes false.** These name tags, hook scopes and per-issue paths that no longer hold
  after the move:
  - the moved feature's description;
  - the cross-references in promoted feature-910 and feature-911;
  - two step-file header comments.

## Solution Statement
A **direct relocation**, following the #734, #923 and #1001 precedent
(`specs/issue-734-adw-ikwe55-feat-promote-729-adw-sdlc_planner-promote-729-regression-scenario.md`,
`specs/issue-923-adw-8d7505-feat-promote-910-sce-sdlc_planner-promote-910-pause-queue-regression.md`,
`specs/issue-1001-adw-stecnx-feat-promote-912-sce-sdlc_planner-promote-912-rate-limit-wait-regression.md`)
and the tag shape set by repair commit `517f823d`: `@regression @<descriptive-tag>`, no `@adw-` tag
anywhere, and hooks keyed on the descriptive tag.

1. **Move the feature.** `git mv features/per-issue/feature-902.feature features/regression/pause-queue/feature-902.feature`.
   - `pause-queue/` already exists and holds the two features that build on this harness.
   - The filename stays `feature-902.feature`, because the rot advisory
     (`.claude/commands/promote_regression_vocabulary.md`) looks the promoted feature up by that id
     under `features/regression/`.
   - No step file moves, so no import is touched.
2. **Re-tag the feature.** Line 1 becomes `@regression @pause-queue-probe`.
   - **Why `@pause-queue-probe`:**
     - the feature's own title calls the subject "the pause-queue probe";
     - it sits naturally beside its lane siblings `@pause-queue-reset-time` and `@pause-queue-ownership`;
     - it avoids the generic `@rate-limit-probe`, which a concurrent promotion of feature-907 (also
       about the probe) might reasonably pick (see Notes).
   - **Scenario level:**
     - delete the eight tag lines that carry only `@adw-` tags;
     - on the four §3 lines, drop `@adw-902`, `@adw-0uxemg-pause-queue-probe-mi` and `@adw-907`;
     - map `@adw-910` to `@pause-queue-reset-time` and `@adw-911` to `@pause-queue-ownership`.

     This is the rule `517f823d` applied to feature-910's rows. A flag from an issue that has been
     promoted becomes that feature's descriptive tag: `@adw-911` became `@pause-queue-ownership`. A flag
     from an issue that has not been promoted is dropped: `@adw-912`. #907 is not promoted, so its flag
     is dropped.
   - The mapping keeps the hooks in `feature-910.steps.ts` and `feature-911.steps.ts` running for
     exactly the rows they run for today:
     - `feature-910.steps.ts`: `@adw-910 or @adw-911 or @pause-queue-reset-time or @pause-queue-ownership`;
     - `feature-911.steps.ts`: `@adw-911 or @pause-queue-ownership`.
   - The `@promotion-suggested-2026-10-06` marker is dropped. Only the per-issue sweeps read it.
3. **Re-scope the three harness hooks:**
   - `feature-902.steps.ts:62` `Before`;
   - `feature-902-queue.steps.ts:207` `Before`;
   - `feature-902-queue.steps.ts:229` `After`.

   Each expression changes in one token, `@adw-902` → `@pause-queue-probe`:
   `(@pause-queue-probe or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or @pause-queue-ownership) and not @adw-908 and not @adw-812`.
   The `@adw-907`, `@adw-910` and `@adw-911` alternatives stay, because per-issue rows still carry those
   tags (see Edge Cases).
4. **Keep prose truthful.** Update the sentences that name the old tags, hook scope and per-issue paths
   in four places:
   - the moved feature's description;
   - the two step-file header comments that quote the hook expression;
   - feature-910's "Changes to feature-902 and feature-907" sentence;
   - feature-911's "Changes to existing features" sentence.

   No step line, DocString, data table, Examples table, scenario title, Feature title or Background
   changes.
5. **Register the two novel phrases.** Add T-PP1 and T-PP2 in a new
   `## Given/When/Then — Pause-Queue Rate-Limit Probe (@pause-queue-probe)` section of
   `features/regression/vocabulary.md`. Each asserts the invocation the probe recorded at its injected
   exec seam, which is a runtime artefact. The section lists the 20 reused registered phrases and does
   not register them again.
6. **Update the README.** Extend the README's `pause-queue/` tree line with #902, then prove the result:
   - the 21 scenarios run and pass under `@pause-queue-probe` and inside the full `@regression` run;
   - `@adw-902` selects nothing;
   - the per-issue feature-907 rows still reach the harness through `@adw-907`;
   - every static check stays green.

**Why this is safe (verified during planning, read-only):**

- **Closed dependency set.** The feature uses 22 distinct step definitions. Each resolves to exactly
  one definition in a regression-owned file, and no per-issue step file contributes a step. The move
  changes no loaded definition, because `cucumber.js` loads the same step files for every run, so it
  cannot introduce an ambiguity.

  | Phrase (cucumber expression) | Registry row(s) today | Defined in |
  |---|---|---|
  | `the ADW codebase is checked out` | G18 | `givenSteps.ts` |
  | `the Claude CLI answers the rate-limit probe with exit code {int} and {word}:` | G-PQ10 (`@pause-queue-reset-time`), G-PQ1 (`@pause-queue-ownership`) | `feature-902.steps.ts` |
  | `the rate-limit probe runs` | W-EC6 | `feature-902.steps.ts` |
  | `the rate-limit probe reports {string}` | T-EC15 | `feature-902.steps.ts` |
  | `the rate-limit probe requested {string} output from the Claude CLI` | **none, new T-PP1** | `feature-902.steps.ts` |
  | `the rate-limit probe requested verbose output from the Claude CLI` | **none, new T-PP2** | `feature-902.steps.ts` |
  | `the same Claude CLI output is streamed through an agent run` | W-EC7 | `feature-902.steps.ts` |
  | `the agent run ends rate-limited` | T-EC14 | `feature-902.steps.ts` |
  | `the mock GitHub API is configured to accept issue comments` | G1 | `givenSteps.ts` |
  | `a workflow for issue {int} is paused in the rate-limit queue for the target repository {string}` | G20 | `feature-902-queue.steps.ts` |
  | `the paused workflow for issue {int} has already recorded {int} unknown probe failures` | G-PQ8 / G-PQ9 | `feature-902-queue.steps.ts` |
  | `the pause-queue scanner runs {int} probe cycle(s)` (regex `^the pause-queue scanner runs (\d+) probe cycles?$`) | W-PQ5 (`@pause-queue-reset-time`) | `feature-902-queue.steps.ts` |
  | `the pause queue still holds the workflow for issue {int}` | T-PQ7 / T-PQ2 | `feature-902-queue.steps.ts` |
  | `the pause queue no longer holds the workflow for issue {int}` | T-PQ8 / T-PQ3 | `feature-902-queue.steps.ts` |
  | `the pause queue entry for issue {int} has not gained a probe failure` | T-PQ9 / T-PQ6 | `feature-902-queue.steps.ts` |
  | `the pause queue entry for issue {int} records {int} probe failure(s)` | T-PQ10 / T-PQ5 | `feature-902-queue.steps.ts` |
  | `the pause queue still holds a workflow for each of these issues, none of which has gained a probe failure:` | T-PQ11 / T-PQ7 | `feature-902-queue.steps.ts` |
  | `the paused workflow for issue {int} is relaunched under its original adwId` | T-PQ18 / T-PQ14 | `feature-902-queue.steps.ts` |
  | `the mock harness recorded zero comment posts on issue {int}` | T14 | `thenSteps.ts` |
  | `the mock GitHub API recorded a comment on issue {int}` | T2 | `thenSteps.ts` |
  | `the mock GitHub API recorded a comment containing the text {string}` | T3 | `thenSteps.ts` |
  | `the ADW TypeScript type-check passes` | T22 | `thenSteps.ts` |

  These definitions do not overlap the nearby ones. `the rate-limit probe reports {string}` does not
  match feature-907's `… reports a {string} limit …` or feature-911's G22
  `… reports the limit has cleared`. The scanner regex does not match feature-911's
  `the pause-queue scanner of … runs …`.
- **The hook set per row only gains the idempotent `@regression` pair and loses one unneeded per-issue
  pair.** Today:
  - every row runs the harness hooks and the untagged guardrails hook;
  - the 19 rows tagged `@adw-907` also run per-issue `feature-907.steps.ts`'s `@adw-907` hooks;
  - the four §3 rows also run feature-910's hooks;
  - the three-hour journey and the unknown-drop row also run feature-911's hooks.

  After the move:
  - every row gains the `@regression` `Before`/`After` pair. It is idempotent, and it already wraps
    feature-910 and feature-911 under this same harness;
  - no row runs feature-907's hooks any more. They only capture `console.log` and restore
    `CLAUDE_CODE_PATH` around feature-907's own `an agent command runs against the same Claude CLI output`
    step, which no feature-902 row uses. The two rows already run without them today: the probe-request
    row and §4;
  - feature-910's and feature-911's hooks run for the same four and two rows as before, through the
    mapped tags.
- **The other users of the harness expression are unaffected:**
  - per-issue feature-907 still matches through `@adw-907`;
  - feature-910 and feature-911 match through their descriptive tags;
  - the flagged feature-908 and feature-812 rows stay excluded;
  - no other `.feature` file carries `@adw-902` as a tag. Its other occurrences are prose in
    feature-907, feature-909, feature-910 and feature-911.
- **The resume path leaves no spawn lock behind.** `resumeWorkflow` (`adws/triggers/pauseQueueResume.ts`)
  releases its verification-only spawn lock before it spawns. So the journey row leaves no lock under
  the Cucumber process's pid for the later feature-912 rows that use `acme/widgets#871–#877`.
- **Double mock lifecycle.** The harness hooks and the `@regression` hooks both call
  `setupMockInfrastructure()` and `teardownMockInfrastructure()`. Both functions are idempotent
  (`test/mocks/test-harness.ts`), so this is safe in either order. It is the same arrangement feature-910
  and feature-911 already pass under.

## Relevant Files
Use these files to implement the feature:

**Moved (`git mv`; edited only as listed in the tasks):**
- `features/per-issue/feature-902.feature` → `features/regression/pause-queue/feature-902.feature`. It is
  366 lines long and contains:
  - the feature tag line at line 1;
  - 12 scenario-level tag lines at 178, 196, 212, 223, 240, 254, 264, 283, 308, 324, 348 and 363;
  - description lines 77–78, 90–91, 96–97, 101, 139–140 and 168–173, which name tags, hook scope,
    per-issue paths and the registry. Line 97, `#911 changes what they exercise:`, is parsed as a
    Gherkin comment today;
  - Background G18 at lines 175–176.

**Edited:**
- `features/regression/step_definitions/feature-902.steps.ts`: line 62, the `Before` that resets the
  probe stub, keyed on the shared harness expression.
- `features/regression/step_definitions/feature-902-queue.steps.ts`: lines 207 and 229, the `Before`
  and `After` that own the mock infrastructure, the `gh` shadow, the blanked GitHub App variables, the
  queue-file save and restore, and the fixture cleanup.
- `features/regression/step_definitions/feature-910.steps.ts`: header comment, lines 6–8, which quote
  the harness expression.
- `features/regression/step_definitions/feature-911.steps.ts`: header comment, lines 5–7, which quote
  the harness expression.
- `features/regression/pause-queue/feature-910.feature`: lines 78–79, the "Changes to feature-902 and
  feature-907" sentence about which rows carry `@adw-910`. Prose only.
- `features/regression/pause-queue/feature-911.feature`: lines 100–102, the "Changes to existing
  features" sentence about which rows carry `@adw-911` or `@pause-queue-ownership`. Prose only.
- `features/regression/vocabulary.md`: gains the new `@pause-queue-probe` section. It goes after the
  `@pause-queue-ownership` section's closing paragraph (around line 307) and before the `---` that
  precedes `## Given/When/Then — Rate-Limit In-Process Wait (@rate-limit-in-process-wait)`.
- `README.md`: the `features/regression/pause-queue/` tree line (line 1214).

**Read-only references:**
- `cucumber.js`: `paths` and `import` already cover `features/regression/**`. No edit needed.
- `features/regression/support/hooks.ts`: the `@regression` mock lifecycle that will now also wrap the
  feature, and `setDefaultTimeout(60_000)`.
- `test/mocks/test-harness.ts`: the idempotent `setupMockInfrastructure` (it returns the live context
  when `isSetUp && gitLog`) and the guarded `teardownMockInfrastructure`.
- `features/regression/step_definitions/givenSteps.ts` (G1, G18), `thenSteps.ts` (T2, T3, T14, T22)
  and `world.ts` (`RegressionWorld.mockContext`): the reused generic definitions. None is redefined.
- `features/per-issue/step_definitions/feature-907.steps.ts`: its `@adw-907` hooks stop running for the
  feature-902 rows. Its import of `../../regression/step_definitions/feature-902.steps.ts` is unchanged.
  Not edited.
- `features/per-issue/feature-907.feature` and `features/per-issue/feature-908.feature`: the remaining
  carriers of `@adw-907`, `@adw-910` and `@adw-911`. Their prose mentions feature-902 and `@adw-902`.
  Not edited (see Notes).
- `features/regression/envelope/feature-909.feature` and
  `features/regression/step_definitions/feature-909-tooling.steps.ts`: they reuse the 902 probe phrases
  under `@envelope-conformance`, with their own `Before` that calls `resetFeature902ProbeState()`.
  Unaffected.
- The system under test. None of it is edited:
  - `adws/triggers/rateLimitProbe.ts` (`probeRateLimit`, `PROBE_ARGS`, `classifyProbeResult`);
  - `adws/core/claudeStreamParser.ts`;
  - `adws/agents/agentProcessHandler.ts` (`handleAgentProcess`);
  - `adws/triggers/pauseQueueScanner.ts` (`scanPauseQueue`);
  - `adws/triggers/pauseQueueDecider.ts`;
  - `adws/triggers/pauseQueueResume.ts` (`resumeWorkflow`);
  - `adws/core/pauseQueue.ts`.
- `adws/promotion/vocabularyParser.ts`: the registry contract.
  - Only `## Given|When|Then…` sections are parsed, and a row needs five `|` columns.
  - The phrase is column 2 with backticks stripped.
  - The pattern (column 4) must be `subprocess`, `phase-import` or `mock-query`, or it falls back to
    `mock-query`.
  - Entries are keyed by phrase, so a duplicate row would silently override an earlier one.
- `.claude/commands/promote_regression_vocabulary.md` and `adws/phases/promotionRotAdvisory.ts`: the
  rot/reuse advisory, which expects `feature-902` under `features/regression/`.
- `adws/core/promotionTagState.ts`, `adws/triggers/perIssueScenarioSweep.ts` and
  `adws/triggers/promotionSweep.ts`: the only readers of `@promotion-suggested-*`, all scoped to
  `features/per-issue/`.
- `.adw/scenarios.md` and `.adw/commands.md`: the scenario directories, the registry path and the
  validation commands.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` (conditional doc). Matches:
  - manually promoting a `features/per-issue/` scenario into `features/regression/`;
  - the vocabulary registry and its rubric;
  - the relocated pause-queue harness step definitions;
  - the double-hook arrangement.
- `app_docs/feature-9gjajh-bdd-per-issue.md` (conditional doc). Matches working on BDD per-issue
  scenario files in `features/per-issue/`.
- `app_docs/feature-9gjajh-promotion-system.md` (conditional doc). Matches the #734-shaped promotion
  issue body and promotion tag-state tracking. It is the basis for dropping the marker.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` (conditional doc). Matches the pause-queue
  rate-limit probe (`rateLimitProbe.ts`) and its outcome classification, pause-queue scanning, the
  decider and the resume path: the system the promoted scenarios guard.
- `app_docs/feature-9gjajh-claude-stream-parser.md` (conditional doc). Matches `claudeStreamParser.ts`,
  the shared parser behind §2's parity.

### New Files
- `features/regression/pause-queue/feature-902.feature`: the relocated feature, created by `git mv` in
  the existing `features/regression/pause-queue/` directory. No other file is created.

## Implementation Plan
### Phase 1: Foundation
Confirm the promotion is safe before anything moves:

- the system under test is merged: `probeRateLimit` with its injectable exec, the stream-json probe
  arguments, and `scanPauseQueue`;
- the harness already lives under `features/regression/step_definitions/` and no per-issue
  `feature-902*` step file remains;
- `@adw-902` is a tag only in `features/per-issue/feature-902.feature`;
- the new tag `@pause-queue-probe` is unused.

Every task is verify-then-act, so a partially applied worktree (a rename already staged) is reconciled
rather than re-run.

### Phase 2: Core Implementation
1. Relocate the feature with `git mv`.
2. Re-tag it: the feature level, the deleted `@adw-` lines and the four mapped §3 lines.
3. Re-scope the three harness hooks.
4. Refresh the prose that names the old tags, hook scope and paths:
   - the moved feature;
   - the two header comments;
   - feature-910 and feature-911.
5. Register T-PP1 and T-PP2 in the vocabulary registry.
6. Extend the README tree line.

### Phase 3: Integration
Prove the following:

- the 21 scenarios are discovered with no undefined or ambiguous step;
- exactly four of them carry `@pause-queue-reset-time` and two `@pause-queue-ownership`;
- all 21 pass under `@pause-queue-probe` and inside the full `@regression` run, alongside feature-910,
  feature-911 and feature-912, which share the queue file, the fixture issue numbers and the
  double-hook arrangement;
- `@adw-902` now selects nothing;
- the per-issue feature-907 rows still pass under the re-scoped harness;
- lint, both type-checks, the build and the unit suite stay green.

## Step by Step Tasks
Execute every step in order, top to bottom. Each task is idempotent: check the current state first
and skip an action that is already applied.

### 1. Verify preconditions
- The system under test is merged:
  - `grep -n "export function probeRateLimit(exec: ProbeExec" adws/triggers/rateLimitProbe.ts` matches;
  - `grep -n "'--print', '--verbose', '--output-format', 'stream-json'" adws/triggers/rateLimitProbe.ts`
    matches;
  - `grep -n "export async function scanPauseQueue" adws/triggers/pauseQueueScanner.ts` matches.
- The harness is regression-owned. `ls features/regression/step_definitions/feature-902*` lists
  `feature-902-queue.steps.ts` and `feature-902.steps.ts`, and
  `find features/per-issue -name 'feature-902*'` lists only `features/per-issue/feature-902.feature`.
- Only this feature carries the tag. `grep -rnE '^\s*@' features --include='*.feature' | grep '@adw-902'`
  lists only lines of `features/per-issue/feature-902.feature`.
- The new tag is free. `grep -rn "@pause-queue-probe" features README.md` returns nothing.
  `@adw-0uxemg-pause-queue-probe-mi` is a different tag: Cucumber matches whole tags.
- If the destination already exists or the tag is already used, a previous run applied part of this
  plan. Reconcile; do not redo.

### 2. Move the feature file
- If `features/per-issue/feature-902.feature` still exists, run
  `git mv features/per-issue/feature-902.feature features/regression/pause-queue/feature-902.feature`.
  The directory exists, so no `mkdir` is needed.
- If it was already moved, confirm that `git status --porcelain` shows the rename and take no action.
- Do not move, copy or edit any step-definition file's location or imports.

### 3. Re-tag the moved feature
- Replace line 1, `@adw-902 @adw-0uxemg-pause-queue-probe-mi @promotion-suggested-2026-10-06`, with
  exactly `@regression @pause-queue-probe`.
- Delete these eight scenario-level tag lines entirely. Each holds only `@adw-` tags. Keep the blank
  line above each scenario.
  - Original lines 178, 196, 212, 223 and 240 (`  @adw-902 @adw-0uxemg-pause-queue-probe-mi @adw-907`):
    the §1 rejected-event outline, non-JSON outline, clean-reply scenario, not-rejected-event outline
    and failed-probe outline.
  - Original line 254 (`  @adw-902 @adw-0uxemg-pause-queue-probe-mi`): "The probe asks the Claude CLI
    for the verbose stream-json output …".
  - Original line 264 (`… @adw-907`): the §2 parity outline.
  - Original line 363 (`  @adw-902 @adw-0uxemg-pause-queue-probe-mi`): the §4 type-check scenario.
- Replace these four §3 tag lines, keeping the two-space indent:
  - original line 283 (`… @adw-907 @adw-910 @adw-911`, the three-hour journey) →
    `  @pause-queue-reset-time @pause-queue-ownership`;
  - original line 308 (`… @adw-907 @adw-910`, the threshold row) → `  @pause-queue-reset-time`;
  - original line 324 (`… @adw-907 @adw-910`, the 2026-09-24 replay) → `  @pause-queue-reset-time`;
  - original line 348 (`… @adw-907 @adw-910 @adw-911`, the unknown-drop row) →
    `  @pause-queue-reset-time @pause-queue-ownership`.
- Do not add `@regression` or `@pause-queue-probe` at scenario level. The feature-level tags are
  inherited.
- Check: `grep -nE '^\s*@' features/regression/pause-queue/feature-902.feature` prints exactly five
  lines, in this order:
  1. `1:@regression @pause-queue-probe`
  2. `@pause-queue-reset-time @pause-queue-ownership`
  3. `@pause-queue-reset-time`
  4. `@pause-queue-reset-time`
  5. `@pause-queue-reset-time @pause-queue-ownership`
- Touch no step line, DocString, data table, Examples table, scenario title, the Feature title (line 2)
  or the Background.

### 4. Keep the moved feature's description truthful
Prose-only edits inside the Feature description:

- Keep the existing indentation and wrap near the paragraph's width.
- **Never start a description line with `@`, `|` or `#`.** A leading `#` turns the line into a Gherkin
  comment. A leading `@` or `|` breaks the parse.
- **Never start a line with a step keyword followed by a space** (`Given `, `When `, `Then `, `And `,
  `But `, `* `).

The edits:

- **(a) Lines 77–78, the #907 paragraph.** Replace
  "Those scenarios also carry `@adw-907`, as do the unchanged ones that guard the classifier #907
  rewrites. The rest of #907's behaviour is specified in `features/per-issue/feature-907.feature`."
  with:
  ```
    Those scenarios, and the unchanged ones that guard the classifier #907 rewrites, carry no
    `@adw-907` tag, because a promoted scenario drops its `@adw-` tags. The rest of #907's behaviour
    is specified in `features/per-issue/feature-907.feature`.
  ```
- **(b) Lines 90–91, the #910 paragraph.** Replace
  "Those four scenarios also carry `@adw-910`. The rest of #910's behaviour is specified in
  `features/per-issue/feature-910.feature`."
  with:
  ```
    Those four scenarios also carry `@pause-queue-reset-time`, the tag of the promoted feature-910.
    The rest of #910's behaviour is specified in
    `features/regression/pause-queue/feature-910.feature`.
  ```
- **(c) Lines 96–97 and 101, the #911 paragraph.**
  - Replace the two lines
    "seeded here, so no scenario in this file changes. Two of them also carry `@adw-911`, because" /
    "#911 changes what they exercise:" with:
    ```
      seeded here, so no scenario in this file changes. Two of them also carry
      `@pause-queue-ownership`, the tag of the promoted feature-911, because #911 changes what they
      exercise:
    ```
    The old line 97 began with `#911` and was silently a Gherkin comment. The new wrap keeps `#911`
    mid-line.
  - Replace line 101, "The rest of #911's behaviour is specified in
    `features/per-issue/feature-911.feature`.", with:
    ```
      The rest of #911's behaviour is specified in
      `features/regression/pause-queue/feature-911.feature`.
    ```
- **(d) Lines 139–140, the acme/widgets note.** Replace the sentence "Mock setup is scoped to
  `@regression`, so initialise it in a `Before` hook scoped to `@adw-902`." so that the two lines become:
  ```
        to the mock GitHub API, and give the process no real GitHub App credentials. The
        `@regression` hooks and the pause-queue harness's mock `Before` hook, scoped to
        `@pause-queue-probe`, both set it up; the second set-up returns the running mock. Every
  ```
  Leave the following lines unchanged, from "scenario that asserts zero comment posts also carries …"
  onward. Line 142's leading `Given,` has no following space, so it stays description text.
- **(e) Lines 168–173, the vocabulary note.**
  - Change "The registry has no phrase for any of the following, so novel phrasing is introduced for
    them:" to "The registry had no phrase for any of the following, so novel phrasing was introduced
    for them:".
  - Keep the five bullets.
  - Directly after the last bullet ("• asserting pause-queue entry presence, failure counts and the
    relaunch."), add:
    ```
      Those phrases are now registered in `features/regression/vocabulary.md`: the probe's request
      pair as T-PP1 and T-PP2 under `@pause-queue-probe`, and the rest under `@pause-queue-reset-time`
      and `@envelope-conformance`, the promoted features that reused them first.
    ```
  - Keep the blank line before `  Background:`.
- Leave the rest of the description unchanged:
  - its historical narrative (the "#902 as shipped" text, which the AMENDED BY #907 paragraph already
    qualifies);
  - the AC5 paragraph about `smoke/pause_resume_rate_limit.feature`;
  - every other step-definition note.

### 5. Re-scope the pause-queue harness hooks
- In each of the three hook tag strings below, replace the single token `@adw-902` with
  `@pause-queue-probe`:
  - `features/regression/step_definitions/feature-902.steps.ts` line 62, `Before(...)`;
  - `features/regression/step_definitions/feature-902-queue.steps.ts` line 207, `Before(...)`;
  - `features/regression/step_definitions/feature-902-queue.steps.ts` line 229, `After(...)`.
- Each string becomes exactly:
  `'(@pause-queue-probe or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or @pause-queue-ownership) and not @adw-908 and not @adw-812'`
- Keep every hook body as it is. That includes the idempotent
  `setupMockInfrastructure()`/`teardownMockInfrastructure()` calls beside the `@regression` hooks.
- Do not add a separate `@pause-queue-probe` hook. A second hook would initialise the harness twice.
- Do not touch any import, any step definition or any other line.
- Check: `grep -n "tags:" features/regression/step_definitions/feature-902.steps.ts features/regression/step_definitions/feature-902-queue.steps.ts`
  prints three lines. Each contains `@pause-queue-probe`, and none contains `@adw-902`.

### 6. Refresh the header comments that quote the harness expression
- `features/regression/step_definitions/feature-910.steps.ts` line 7. Change
  `` * `(@adw-902 or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or `` to
  `` * `(@pause-queue-probe or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or ``.
- `features/regression/step_definitions/feature-911.steps.ts` line 6. Change
  `` * (widened to `(@adw-902 or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or `` to
  `` * (widened to `(@pause-queue-probe or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or ``.
- Comment text only. No other change in either file. In particular, the feature-910 and feature-911
  hook expressions stay as they are: the mapped §3 rows reach them through `@pause-queue-reset-time`
  and `@pause-queue-ownership`.
- Check: `grep -rn "@adw-902" features/regression --include='*.ts'` returns nothing.

### 7. Update promoted feature-910's and feature-911's cross-references
- **`features/regression/pause-queue/feature-910.feature`, lines 78–79.**
  - Replace
    "Changes to feature-902 and feature-907. Their scanner rows now run through the decider. The" /
    "rows that pin behaviour this slice must keep carry `@adw-910`:"
    with:
    ```
      Changes to feature-902 and feature-907. Their scanner rows now run through the decider. The
      rows that pin behaviour this slice must keep carry `@adw-910`, or `@pause-queue-reset-time` in
      the promoted feature-902:
    ```
  - Leave the bullet list below it unchanged.
- **`features/regression/pause-queue/feature-911.feature`, lines 100–102.**
  - Replace
    "path, so the existing rows that depend on either now also carry `@adw-911`, or" /
    "`@pause-queue-ownership` in the promoted feature-910. None of their steps change, and each" /
    "file's description records why:"
    with:
    ```
      path, so the existing rows that depend on either now also carry `@adw-911`, or
      `@pause-queue-ownership` in the promoted feature-910 and feature-902. None of their steps
      change, and each file's description records why:
    ```
  - Leave the bullet list below it unchanged.
- Prose only, with the same Gherkin description cautions as task 4. Leave the historical "Notes for
  the step definitions" in both files ("Widen each of its hooks …" and "Widen the 902 hooks to …")
  unchanged. They record the instruction each build followed.

### 8. Register the phrases in `features/regression/vocabulary.md`
Insert a new domain section directly after the `@pause-queue-ownership` section's closing paragraph
("This scenario also reuses already-registered phrases, so they need no new rows: … and the generic
W16/T34 above."), separated from it by one blank line. Keep the existing blank line and `---` that
follow, before `## Given/When/Then — Rate-Limit In-Process Wait (@rate-limit-in-process-wait)`.

Format rules:

- Use the established five-column schema.
- The Pattern column is exactly `phase-import`, so `vocabularyParser.ts` classifies it.
- Write each phrase exactly as its cucumber expression appears in `feature-902.steps.ts`.
- No phrase contains `|`.
- Do not register any of the 20 already-registered phrases again. The parser keys entries by phrase,
  so a duplicate would silently override the earlier row.

Paste this section:

```md
## Given/When/Then — Pause-Queue Rate-Limit Probe (@pause-queue-probe)

These phrases drive the pause queue's rate-limit probe in-process (phase-import): the real
`probeRateLimit` (`adws/triggers/rateLimitProbe.ts`), called with the pause-queue harness's injected
exec seam (`probeStub.exec` in `feature-902.steps.ts`) in place of a spawned Claude CLI. The seam
records the arguments of every call. Every assertion targets a runtime artefact: the invocation the
probe made at that seam, which is what the system asked of its dependency. No step reads, greps or
parses a source file, satisfying the Rot-Detection Rubric. Both definitions live in
`feature-902.steps.ts`.

| # | Phrase | Semantics | Pattern | Assertion target |
|---|--------|-----------|---------|-----------------|
| T-PP1 | `the rate-limit probe requested {string} output from the Claude CLI` | Reads the arguments the probe passed on its last call to the injected exec seam; asserts `--output-format` is among them and is followed by the given format. Fails when the probe never called the seam | phase-import | recorded probe invocation (argv) |
| T-PP2 | `the rate-limit probe requested verbose output from the Claude CLI` | Asserts the arguments the probe passed on its last call to the injected exec seam include `--verbose`. Fails when the probe never called the seam | phase-import | recorded probe invocation (argv) |

The rest of `features/regression/pause-queue/feature-902.feature` reuses already-registered phrases,
so they need no new rows:

- generic: G1, G18, G20, T2, T3, T14 and T22;
- `@pause-queue-reset-time`: G-PQ8, G-PQ10, W-PQ5, T-PQ7–T-PQ11 and T-PQ18, which the
  `@pause-queue-ownership` section registers again under its own numbers;
- `@envelope-conformance`: W-EC6, W-EC7, T-EC14 and T-EC15.

The probe and pause-queue phrases are defined in the pause-queue harness (`feature-902.steps.ts`,
`feature-902-queue.steps.ts`). The harness's hooks reset the probe stub, set up the mock GitHub API and
the `gh` shadow, and save, clear and restore `agents/paused_queue.json`. They run only for scenarios
that carry `@pause-queue-probe`, `@pause-queue-reset-time` or `@pause-queue-ownership`, or one of the
per-issue tags `@adw-907`, `@adw-910` or `@adw-911` while per-issue rows still carry them. A new
scenario that reuses these phrases must carry one of those tags, or reset the probe stub itself as the
`@envelope-conformance` hook does.
```

- Check: `grep -cE '^\| T-PP[0-9]+ \|' features/regression/vocabulary.md` prints `2`.
- Check: `grep -E '^\| T-PP' features/regression/vocabulary.md | awk -F'|' '{print NF}' | sort -u`
  prints only `7`, so each row has exactly five columns.

### 9. Extend the README tree line
- In `README.md`'s `features/` tree, replace the line
  `│   ├── pause-queue/    # Regression scenarios covering the pause queue's reset-time wait, decider, eviction (#910), ownership and remove-before-spawn resume (#911)`
  with
  `│   ├── pause-queue/    # Regression scenarios covering the rate-limit probe's verdict, its parity with the agents' rate-limit detector and a limited probe never counting toward eviction (#902), the pause queue's reset-time wait, decider, eviction (#910), ownership and remove-before-spawn resume (#911)`
- Change nothing else in `README.md`.

### 10. Unit tests: no new test, existing coverage re-run
- No unit test is added. The reasons are under Testing Strategy → Unit Tests.
- Run the unit tests that own the behaviour the promoted scenarios prove, plus the parser that reads
  the edited registry:
  `bunx vitest run adws/triggers/__tests__/rateLimitProbe.test.ts adws/triggers/__tests__/pauseQueueScanner.test.ts adws/triggers/__tests__/pauseQueueDecider.test.ts adws/core/__tests__/claudeStreamParser.test.ts adws/agents/__tests__/agentProcessHandler.test.ts adws/promotion/__tests__/vocabularyParser.test.ts`
- Then run the full unit suite: `bun run test:unit`.

### 11. Run the Validation Commands
Execute every command in `Validation Commands`, in order. The expected results:

- the source is gone and the destination exists;
- the feature has the five expected tag lines and no `@adw-` or marker tag;
- its steps from the Background on are unchanged;
- the three hooks name `@pause-queue-probe`;
- the vocabulary has the two new rows;
- the moved feature is discovered with 21 scenarios and no undefined or ambiguous step;
- four of the 21 match `@pause-queue-reset-time` or `@pause-queue-ownership`, and two match
  `@pause-queue-ownership`;
- `@adw-902` selects 0 scenarios;
- all 21 pass under `@pause-queue-probe`;
- the per-issue `@adw-907` rows still pass;
- the full `@regression` run is green, with the 21 among the passed scenarios;
- lint, both type-checks, the build and the unit suites pass.

If a run fails, first check whether it also fails on the base branch before you change anything.

## Testing Strategy
### Unit Tests
Unit tests are enabled: `.github/adw.yml` leaves `unitTests` commented out. **No new unit test is
needed**, because this feature adds no production code path. It moves one BDD feature, changes one
token in three Cucumber hook tag strings and edits comments and Markdown.

The behaviour the promoted scenarios prove is already unit-tested where it lives:

- `adws/triggers/__tests__/rateLimitProbe.test.ts`: the probe's classification table and its
  arguments.
- `adws/core/__tests__/claudeStreamParser.test.ts` and
  `adws/agents/__tests__/agentProcessHandler.test.ts`: the shared detector that §2 compares against.
- `adws/triggers/__tests__/pauseQueueScanner.test.ts` and
  `adws/triggers/__tests__/pauseQueueDecider.test.ts`: the scanner's strike, resume and evict
  behaviour behind the injected probe seam.

The edited registry is read by `adws/promotion/vocabularyParser.ts`, whose row contract is covered by
`adws/promotion/__tests__/vocabularyParser.test.ts`. The new rows follow that contract (five columns
and the known `phase-import` pattern), so no parser change or test is needed. No unit test reads the
real `features/regression/` tree or `vocabulary.md`.

Task 10 re-runs these six files and then the whole suite (`bun run test:unit`) to confirm zero
regressions.

### Edge Cases
- **A missed re-scope is silent until it is harmful.** Without the harness hooks the rows still run,
  because `@regression` supplies a mock server. They would then touch the operator's real
  `agents/paused_queue.json` and the real `gh`. The positive controls catch this:
  - T2, the journey's resumed comment, and T3, the drop row's error comment, pass only when the `gh`
    shadow recorded the post and the harness replayed it;
  - `--tags "@pause-queue-probe"` must therefore pass with all 21 scenarios green, not only appear in
    the dry run.
- **Double mock lifecycle.** The harness hooks and the `@regression` hooks both set up and tear down
  the mock. Both functions are idempotent, so there is one server per scenario whichever hook runs
  first.
  - The harness `Before` prepends the `gh` shadow to `PATH` after its own setup.
  - The `@regression` `After` restores the saved environment, and the harness `After` then finds
    nothing left to tear down.

  feature-910 and feature-911 already pass under this arrangement.
- **Hooks that stop running.** Per-issue `feature-907.steps.ts`'s `@adw-907` hooks no longer wrap these
  rows. They only capture `console.log` and restore `CLAUDE_CODE_PATH` for feature-907's own
  agent-command step, which no feature-902 row uses. The probe-request row and §4 already run without
  them today.
- **Cached Claude CLI path.** `probeRateLimit` resolves the CLI path before calling the injected exec,
  and feature-907's `After` used to clear that cache after its rows. In the `@regression` run, every
  scenario pins `CLAUDE_CODE_PATH` to the same stub, and every feature that points it elsewhere clears
  the cache itself. feature-910 and feature-911 already call the probe this way without feature-907's
  hook.
- **Alternatives left in the expression.** The harness expression keeps `@adw-907`, `@adw-910` and
  `@adw-911`:
  - `@adw-907` is still carried by the per-issue feature-907 rows, which rely on the harness;
  - `@adw-910` is still carried by feature-907's expired-login row. That row also carries `@adw-907`, so
    the alternative is redundant there;
  - `@adw-911` is still carried only by feature-908's still-queued row, which `not @adw-908` excludes.
    It is inert in this expression, but it still matters in feature-910's and feature-911's own hooks.

  Pruning them belongs to the promotions of feature-907 and feature-908. They are untouched here.
- **Tag selection widens on purpose.** `--tags "@pause-queue-reset-time"` now also selects the four §3
  rows, and `--tags "@pause-queue-ownership"` the journey and the drop row. Those are the rows that pin
  #910's and #911's behaviour. Promoted feature-910's #911-flagged rows work the same way.
- **Shared real artefacts.** The scenarios write the following, and the harness `After` removes or
  restores each:
  - `agents/paused_queue.json` (saved, cleared and restored, never clobbered);
  - `agents/<adwId>/` and `agents/paused_queue_logs/<adwId>.resume.log`;
  - throwaway worktrees;
  - the fixture orchestrator processes, which `pkill` by script path.

  The fixture issue numbers 871–877 recur in feature-910 and feature-912. Cucumber runs scenarios
  serially, every scenario cleans up, and the resume path releases its spawn lock before it spawns.
- **Timing.** The heaviest rows are the 36-cycle journey, whose resume waits out the 2 s readiness
  window and then polls up to 10 s for the fixture's launch record, and §4's type-check
  (`bunx tsc --noEmit --incremental false`). Nine regression features already run that type-check.
  Every step stays inside the 60 s default, and the daily `regression.yml` 30-minute jobs keep their
  headroom.
- **A pre-existing env-restore quirk, not fixed here.** The harness `After` restores
  `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY_PATH` by assignment. A variable that
  was unset comes back as the string `"undefined"`. feature-910 and feature-911 already trigger this in
  the `@regression` run, so feature-902, which sorts before them, adds nothing new for later features.
- **Gherkin description pitfalls.**
  - A description line that starts with `#` is a comment: the old line 97 was one.
  - A line that starts with `@` or `|` breaks the parse.
  - A line that starts with a step keyword followed by a space is read as a step.

  The dry run catches a broken parse. The Background-onward diff proves the steps are untouched.
- **Old tags select nothing.** `--tags "@adw-902"` matches 0 scenarios, and `@adw-907`, `@adw-910` and
  `@adw-911` no longer select feature-902 rows. All four issues are merged, and the rows now run in
  every `@regression` pass.
- **The marker is gone on purpose.** The relocated file carries no `@promotion-suggested-*` tag. The
  per-issue sweep and the promotion sweep only list `features/per-issue/`. If a fresh stamp lands on
  the per-issue path on `dev` before this PR merges, git's rename detection carries it into the
  regression copy. Drop it there.
- **Docker leg.** The fixture orchestrators start through `bunx tsx` and are killed with `pkill`, exactly
  as feature-910's and feature-911's resume rows already are. T22 already passes `--incremental false`
  for the read-only mount.

## Acceptance Criteria
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` passes, and its run includes the
  21 scenarios of `features/regression/pause-queue/feature-902.feature`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@pause-queue-probe"` runs 21 scenarios and all
  21 pass.
- `features/per-issue/feature-902.feature` no longer exists, because it was moved, not copied. No
  `features/per-issue/**/feature-902*` file exists.
- `features/regression/pause-queue/feature-902.feature` has exactly five tag lines:
  - `@regression @pause-queue-probe` on line 1;
  - `@pause-queue-reset-time @pause-queue-ownership` on the three-hour journey and the unknown-drop row;
  - `@pause-queue-reset-time` on the threshold row and the 2026-09-24 replay.

  It has no `@adw-` or `@promotion-suggested-*` tag. Everything from the Background to the end of the
  file is byte-identical to the source, apart from the removed and replaced tag lines.
- The three pause-queue harness hooks read
  `(@pause-queue-probe or @adw-907 or @adw-910 or @adw-911 or @pause-queue-reset-time or @pause-queue-ownership) and not @adw-908 and not @adw-812`.
  No hook anywhere is keyed on `@adw-902`. No step file moved, and no relative import changed.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-902" --dry-run` selects 0 scenarios.
- The per-issue feature-907 rows still pass under `--tags "@adw-907"`.
- `features/regression/vocabulary.md` has the `@pause-queue-probe` section:
  - T-PP1 and T-PP2, each with five columns, the `phase-import` pattern and an artefact assertion
    target;
  - a paragraph naming the 20 reused registered phrases, none of which is registered again.
- No undefined or ambiguous step is reported for the moved feature or anywhere in the `@regression`
  run.
- The prose matches the change:
  - the moved feature's description names the new tags, regression paths and registry rows;
  - the feature-910 and feature-911 cross-references name `@pause-queue-reset-time` and
    `@pause-queue-ownership` in feature-902;
  - the feature-910 and feature-911 step-file headers quote the new expression;
  - the README `pause-queue/` line names #902.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build` and
  `bun run test:unit` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `test ! -e features/per-issue/feature-902.feature && test -z "$(find features/per-issue -name 'feature-902*')" && echo MOVED-OK`:
  the source is gone, and the command prints `MOVED-OK`.
- `test -f features/regression/pause-queue/feature-902.feature && echo DEST-OK`: the file landed, and
  the command prints `DEST-OK`.
- `grep -nE '^\s*@' features/regression/pause-queue/feature-902.feature`: exactly five lines.
  - `1:@regression @pause-queue-probe`;
  - then `@pause-queue-reset-time @pause-queue-ownership`, `@pause-queue-reset-time`,
    `@pause-queue-reset-time` and `@pause-queue-reset-time @pause-queue-ownership`.
- `grep -nE '^\s*@' features/regression/pause-queue/feature-902.feature | grep -cE '@adw-|@promotion-suggested-'`:
  prints `0`.
- `diff <(git show "$(git merge-base HEAD origin/dev)":features/per-issue/feature-902.feature | sed -n '/^  Background:/,$p' | grep -vE '^\s*@') <(sed -n '/^  Background:/,$p' features/regression/pause-queue/feature-902.feature | grep -vE '^\s*@') && echo STEPS-UNCHANGED`:
  every step, DocString, table and title from the Background on is unchanged. The command prints
  `STEPS-UNCHANGED`.
- `grep -n "tags:" features/regression/step_definitions/feature-902.steps.ts features/regression/step_definitions/feature-902-queue.steps.ts`:
  three lines, each with `@pause-queue-probe` and none with `@adw-902`.
- `grep -rn "tags:.*@adw-902" features; grep -rnE '^\s*@' features --include='*.feature' | grep -c '@adw-902'`:
  the first prints nothing, and the second prints `0`.
- `grep -cE '^\| T-PP[0-9]+ \|' features/regression/vocabulary.md`: prints `2`.
- `grep -E '^\| T-PP' features/regression/vocabulary.md | awk -F'|' '{print NF}' | sort -u`: prints
  only `7`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@pause-queue-probe" --dry-run`: 21 scenarios
  discovered, with no undefined and no ambiguous steps.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@pause-queue-probe and (@pause-queue-reset-time or @pause-queue-ownership)" --dry-run`:
  4 scenarios.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@pause-queue-probe and @pause-queue-ownership" --dry-run`:
  2 scenarios.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-902" --dry-run`: 0 scenarios.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@pause-queue-probe"`: 21 scenarios, 21 passed.
  The T2 and T3 rows prove the harness hooks ran.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-907"`: the per-issue feature-907 rows
  still pass, reaching the harness through `@adw-907`. If a concurrent promotion has already moved
  feature-907, 0 scenarios is also fine.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`: the full regression suite is
  green and includes the moved feature. This is the primary acceptance command, and it must report no
  ambiguous step.
- `bun run lint`: the linter passes.
- `bunx tsc --noEmit`: the root type-check passes, covering the edited step files.
- `bunx tsc --noEmit -p adws/tsconfig.json`: the ADW type-check passes.
- `bun run build`: the build succeeds.
- `bunx vitest run adws/triggers/__tests__/rateLimitProbe.test.ts adws/triggers/__tests__/pauseQueueScanner.test.ts adws/triggers/__tests__/pauseQueueDecider.test.ts adws/core/__tests__/claudeStreamParser.test.ts adws/agents/__tests__/agentProcessHandler.test.ts adws/promotion/__tests__/vocabularyParser.test.ts`:
  the owning unit tests pass.
- `bun run test:unit`: the unit suite passes with zero regressions.

## Notes
- **Coding guidelines.** Adhere to `.adw/coding_guidelines.md`. The TypeScript edits are one token in
  three hook tag strings and one token in two existing header comments. No comment is added. Per the
  **Comments** guideline, no issue-number citation is introduced.
- **`hitl` is set.** The resulting PR must be human-approved before merge. The `regression-promotion`
  label also makes the review phase post the non-blocking rot/reuse advisory comment
  (`executePromotionRotAdvisory`). That comment needs the promoted file to stay named
  `feature-902.feature` under `features/regression/`.
- **No new library** is required. The repository's install command, per `.adw/commands.md`, is
  `bun add <package>`.
- **A likely concurrent promotion of feature-907.** At planning time a sibling worktree,
  `feature-issue-1019-promote-rate-limit-probe-regression`, exists with no changes. The same sweep
  (PR #1017) marked feature-907 for promotion, so that worktree is most likely its promotion. Expect
  textual conflicts with it on:
  - the three harness hook lines, where it would replace `@adw-907`;
  - `vocabulary.md`;
  - the README tree;
  - feature-910's "Changes to feature-902 and feature-907" sentence.

  Whichever PR merges second resolves the conflicts. The resolution must keep both descriptive tags in
  the hook expression and no `@adw-` alternative that no feature still carries. If feature-907 moves
  first, the "The rest of #907's behaviour is specified in `features/per-issue/feature-907.feature`"
  sentence in the moved feature needs that path updated. For the same reason this plan does not edit
  per-issue `feature-907.feature` or `feature-907.steps.ts`.
- **Deliberately not changed:**
  - **Per-issue prose.** `feature-907.feature`, `feature-907.steps.ts`, `feature-908.feature` and
    `feature-928.feature` mention feature-902 or `@adw-902`. They are per-issue files outside this
    promotion, and feature-907 is likely being moved concurrently.
  - **Historical "Notes for the step definitions".** In feature-909, feature-910 and feature-911
    they quote older hook scopes, such as feature-909's "#902's reset hook is scoped to `@adw-902`".
    They record what each build was told. The current expression is quoted in the two step-file
    headers updated by task 6.
  - **The moved feature's narrative.** Its title still mentions "a text fallback", which describes
    #902 as shipped. Its AMENDED BY #907 paragraph already qualifies this.
  - **The harness's own `setupMockInfrastructure()`/`teardownMockInfrastructure()` calls.** They are
    redundant beside the `@regression` hooks, but idempotent.
  - **The inert or redundant `@adw-910`/`@adw-911` alternatives** in the harness expression (see Edge
    Cases).
  - **The env-restore quirk** in the harness `After` (see Edge Cases).
- **Docs for the document phase.** The precedent promotions updated these in their document-agent
  commit, not the build commit.
  - `app_docs/feature-9gjajh-bdd-regression-suite.md`:
    - the "Maintain `features/regression/pause-queue/`" bullets gain the promoted `feature-902.feature`
      (`@regression @pause-queue-probe`, 21 scenarios);
    - the harness bullet's "mock-infra hooks tagged `@adw-902/907/910/911` …" becomes
      `@pause-queue-probe`/`@adw-907/910/911`;
    - the list of promoted features' descriptive tags gains `@pause-queue-probe` (`feature-902`);
    - the "rows still under `features/per-issue/` (`feature-902`, `feature-907`, `feature-908`)"
      sentence drops `feature-902`;
    - the new vocabulary section gets a mention.
  - `.adw/conditional_docs.md`: the pause-queue condition (the promoted reset-time scenario and the
    relocated harness step definitions) should also name `features/regression/pause-queue/feature-902.feature`.
- **Scorer limitation (out of scope).** `promotionScorer.matchPhrase` turns only `{string}` and `{int}`
  into wildcards. Registered phrases that use `{word}` or optional text therefore never match a concrete
  step for scoring: G-PQ10's `{word}`, and W-PQ5 and T-PQ10's `(s)`. This is a pre-existing
  limitation, not addressed here.
