# Bug: Pause-queue probe misclassifies an active session limit as `unknown`, stranding paused workflows

## Metadata
issueNumber: `902`
adwId: `0uxemg-pause-queue-probe-mi`
issueJson: `{"number":902,"title":"Pause-queue probe misclassifies session limit as unknown, stranding paused workflows","body":"## Problem\n\nThe pause-queue probe misclassifies a still-active Claude **session limit** as an `unknown` failure. The queue entry is dropped after 3 probes (~15 min), and the workflow is stranded in `workflowStage: paused` with no recovery path.\n\nOn 2026-09-24 this stranded six workflows: #871, #872 and #874–#877 (adwChore comment sweeps). They paused around 10:12 UTC and were dropped around 10:26 UTC with \"failed to resume after 3 probe attempts. Manual restart required.\" Each had to be re-queued by hand. While stranded, they also counted against `MAX_CONCURRENT_PER_REPO`, which starved downstream issues (#878/#879 sat untouched).\n\n## Root cause\n\n`adws/triggers/pauseQueueScanner.ts` `probeRateLimit()` runs `claude --print \"ping\"` and substring-matches the output against `RATE_LIMIT_STRINGS`:\n\n```ts\nconst RATE_LIMIT_STRINGS = [\n  \"You've hit your limit\",\n  \"You're out of extra usage\",\n  '502 Bad Gateway',\n  'Invalid authentication credentials',\n];\n```\n\nThe CLI now emits `You've hit your session limit · resets 1:50pm (Europe/Amsterdam)`. That does not contain `\"You've hit your limit\"`, so the probe exits non-zero with unmatched text and returns `'unknown'`. With `MAX_UNKNOWN_PROBE_FAILURES=3` and `PROBE_INTERVAL_CYCLES=15` (× 20s poll ≈ 5 min), any real multi-hour session limit is dropped after about 15 minutes.\n\nThe code comment `/** Rate-limit indicator strings — same as agentProcessHandler detection. */` is false. The orchestrator side does **not** match text. It detects the limit structurally from the stream-json `rate_limit_event` with `rate_limit_info.status === \"rejected\"` (`adws/core/claudeStreamParser.ts:138`, consumed at `adws/agents/agentProcessHandler.ts:89`). That is why the orchestrator correctly paused on this limit while the probe failed to recognise it. The two detectors have silently diverged.\n\n## Fix\n\n1. **Make the probe structural, like the orchestrator.** Run the probe with `--output-format stream-json --verbose`, and classify `limited` through the same `claudeStreamParser` state the agents use: `rateLimitRejected`, plus the server-error and overloaded flags that `agentProcessHandler` already treats as pause-worthy. There should be one detection source of truth, not a hand-maintained string list that drifts.\n2. Keep substring matching only as a fallback for non-JSON failure output (e.g. the process dies before emitting stream-json). Add `\"hit your session limit\"` to it, or better, match the stable part: `\"You've hit your\"`.\n3. Delete or correct the false \"same as agentProcessHandler\" comment.\n4. Update `adws/known_issues.md` (pattern at line 39) with the session-limit text.\n\n## Acceptance criteria\n\n- A probe whose output contains a `rate_limit_event` with `status: \"rejected\"` returns `'limited'`, regardless of the human-readable text.\n- A probe that fails with `You've hit your session limit · resets …` text only (non-JSON) returns `'limited'`, not `'unknown'`.\n- A `'limited'` probe does not increment `probeFailures`, so the entry stays queued across a multi-hour limit and resumes when the limit clears.\n- Unit tests cover the three probe outcomes (`clear` / `limited` via structured event / `limited` via fallback text / `unknown`), with the probe's exec injectable so tests don't spawn the real CLI.\n- Existing @adw pause/resume scenarios stay green.\n\n## Out of scope (note only)\n\n`## Retry` / `## continue` comments do nothing for a stranded `paused` workflow (5 attempts on #871 had no effect). The only recovery is hand-editing `agents/paused_queue.json`. That's a separate recovery-path gap. Worth its own issue if this fix doesn't make it moot.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-09-25T05:55:04Z","comments":[],"actionableComment":null}`

## Bug Description

The cron trigger's pause-queue scanner (`scanPauseQueue` in `adws/triggers/pauseQueueScanner.ts`) runs a cheap `claude --print "ping"` probe every `PROBE_INTERVAL_CYCLES` cycles to decide whether paused workflows can resume. The probe's result is one of `clear`, `limited`, or `unknown`:

- `clear` resumes every queued entry.
- `limited` only touches `lastProbeAt` and leaves the entry queued.
- `unknown` increments `probeFailures`; at `MAX_UNKNOWN_PROBE_FAILURES` (3) the entry is removed and an error comment "failed to resume after 3 probe attempts. Manual restart required." is posted.

**Actual behaviour:** while a Claude *session limit* is active, the CLI exits non-zero and prints `You've hit your session limit · resets 1:50pm (Europe/Amsterdam)`. The probe substring-matches against a hand-maintained list whose closest entry is `"You've hit your limit"`. The new wording does not contain that substring, so the probe returns `unknown`. Three probes later (≈15 minutes at defaults) the entry is dropped. The workflow is left at `workflowStage: paused` on disk, the takeover handler classifies `paused` as `terminal` and never touches it, and `## Retry` / `## continue` have no effect. Meanwhile the stranded workflow still counts toward `MAX_CONCURRENT_PER_REPO`, starving other issues.

**Expected behaviour:** a still-active limit, however it is worded, is classified `limited`. The entry stays queued for the whole multi-hour limit without consuming its `probeFailures` budget, and resumes automatically on the first `clear` probe after the limit lifts.

**Incident:** 2026-09-24, six `adwChore` comment-sweep workflows (#871, #872, #874–#877) paused ≈10:12 UTC and were dropped ≈10:26 UTC. All six were re-queued by hand. #878 / #879 sat untouched while the stranded entries held concurrency slots.

## Problem Statement

`probeRateLimit()` and the orchestrator's `agentProcessHandler` are two independent rate-limit detectors that have silently diverged. The orchestrator detects a limit *structurally* from the stream-json `rate_limit_event` (`rate_limit_info.status === "rejected"`) parsed by `adws/core/claudeStreamParser.ts`, plus the `serverErrorDetected` / `overloadedErrorDetected` flags. The probe detects it by *text* against a private string list that a wording change in the CLI can defeat at any time. The probe therefore misclassifies real limits as `unknown`, and `unknown` is the one outcome that burns the entry's survival budget. The probe is also not injectable, so this class of bug has never had a unit test.

## Solution Statement

Make the probe structural and put the detection logic behind one seam:

1. **New module `adws/triggers/rateLimitProbe.ts`.** Run the probe with the same output mode the pipeline agents use (`--print --verbose --output-format stream-json`), feed stdout through the shared `parseJsonlOutput` from `adws/core/claudeStreamParser.ts`, and classify `limited` when any of the flags that `agentProcessHandler` already treats as pause-worthy are set (`rateLimitRejected`, `serverErrorDetected`, `overloadedErrorDetected`), plus `authErrorDetected` (parity with the retained `Invalid authentication credentials` fallback string: an auth outage must not burn the probe budget either). Text matching survives only as a fallback for output that never reached stream-json, and matches the stable prefix `You've hit your`. The subprocess call is injected (`ProbeExec`) so tests never spawn the real CLI, and the classifier is a pure function over `{ status, stdout, stderr }`.
2. **`pauseQueueScanner.ts` consumes the probe through an injectable parameter** (`scanPauseQueue(cycleCount, probe = probeRateLimit)`), deletes its private string list, and flattens the per-entry outcome branch into named helpers so the file stays under the 300-line guideline.
3. **Unit tests** for the pure classifier (all four outcomes, structured-vs-text precedence, trailing partial line), for `probeRateLimit` (passes stream-json args, never throws), and for `scanPauseQueue` (`limited` does not touch `probeFailures`; `unknown` increments and eventually drops; `clear` resumes).
4. **Docs:** correct the false comment, register the session-limit wording in `adws/known_issues.md`, add a registry entry for this incident, update the owning app doc and `.adw/conditional_docs.md`, and add the new module to the README tree.

## Steps to Reproduce

1. **Deterministic, no CLI needed (before the fix).** Evaluate the current `RATE_LIMIT_STRINGS` list against the live wording:
   ```bash
   bunx tsx -e "const S=[\"You've hit your limit\",\"You're out of extra usage\",'502 Bad Gateway','Invalid authentication credentials']; const out=\"You've hit your session limit · resets 1:50pm (Europe/Amsterdam)\"; console.log(S.some(s=>out.includes(s)) ? 'limited' : 'unknown')"
   ```
   Prints `unknown`. This is exactly the value `probeRateLimit()` returns from its `catch` branch when the CLI exits non-zero with that text.
2. **Queue consequence.** With an entry in `agents/paused_queue.json` and the probe returning `unknown`, each probe cycle increments `probeFailures`; at 3 the scanner logs `Max probe failures reached for <adwId> — removing from queue` and posts the "failed to resume after 3 probe attempts" comment. At default `PROBE_INTERVAL_CYCLES=15` × 20 s poll that is ≈15 minutes, far shorter than any real session limit.
3. **Live, while a session limit is active.** Run the exact command the scanner runs today: `claude --print "ping" --model haiku --max-turns 1 --dangerously-skip-permissions`. Observe a non-zero exit and the `You've hit your session limit · resets …` text. Then run the stream-json form and observe that the same CLI emits a `{"type":"rate_limit_event","rate_limit_info":{"status":"rejected",…}}` line, which `claudeStreamParser` already understands:
   ```bash
   claude --print --verbose --output-format stream-json --model haiku --max-turns 1 --dangerously-skip-permissions "ping" < /dev/null
   ```
4. **Healthy baseline of the same stream-json command** (verified during planning on 2026-09-25): exit 0, lines `system/init`, two `assistant` messages, `rate_limit_event` with `status: "allowed"` (and `overageStatus: "rejected"`, which the parser correctly ignores), and `result` with `subtype: "success"`, `is_error: false`. Stderr carried `Warning: no stdin data received in 3s, proceeding without it` because stdin was an open pipe. The new exec must pass `stdin: 'ignore'` to avoid that 3 s stall.

## Root Cause Analysis

- `probeRateLimit()` (`adws/triggers/pauseQueueScanner.ts`) uses `execSync` with a shell string and inspects only `err.message` on failure. That message is `Command failed: <cmd>\n<stderr>`, so classification depends on the CLI's *human-readable* wording. The list `RATE_LIMIT_STRINGS` contains `"You've hit your limit"`; the CLI now says `You've hit your session limit`. No match, non-zero exit ⇒ `unknown`.
- The comment `/** Rate-limit indicator strings — same as agentProcessHandler detection. */` is false. `agentProcessHandler.ts` never matches text: it kills and pauses when `state.rateLimitRejected || state.serverErrorDetected || state.overloadedErrorDetected` is set by `parseJsonlOutput` from the `rate_limit_event` / `system api_retry` envelopes. `adws/known_issues.md` records (`rate-limit-false-positive`) that text matching on the orchestrator side was *removed* precisely because it was unreliable; the probe was never migrated.
- `unknown` is the only outcome that increments `probeFailures`, and `MAX_UNKNOWN_PROBE_FAILURES=3` is sized for genuine probe breakage (CLI missing, timeout), not for a multi-hour limit. So a misclassification is not a transient inconvenience; it converts a recoverable pause into a permanent strand, because `paused` is in the `terminal` stage class (`stageClassifier`) and neither the takeover handler nor `## Retry` will touch it.
- The probe has no seam: `execSync` and `resolveClaudeCodePath()` are called directly inside the function, so no unit test ever exercised the classification against real wording, and the drift went unnoticed until production.

## Relevant Files

Use these files to fix the bug:

- `adws/triggers/pauseQueueScanner.ts` — owns the buggy `probeRateLimit()`, the false comment, `RATE_LIMIT_STRINGS`, and `scanPauseQueue`'s outcome handling. Loses the probe implementation, gains an injectable `probe` parameter and flattened outcome helpers.
- `adws/core/claudeStreamParser.ts` — read-only. `parseJsonlOutput` and `JsonlParserState` are the single source of truth for structural detection. Note that it buffers a trailing segment without `\n` into `lineBuffer`, so the probe must append a newline before parsing.
- `adws/agents/agentProcessHandler.ts` — read-only. Defines which parser flags are pause-worthy (`rateLimitRejected || serverErrorDetected || overloadedErrorDetected`, line ≈89) and which are auth (`authErrorDetected`). The probe must mirror that set.
- `adws/agents/claudeAgent.ts` — read-only. The CLI args the agents use (`--print --verbose --dangerously-skip-permissions --output-format stream-json --model …`), which the probe must mirror so it sees the same envelopes.
- `adws/core/config.ts` / `adws/core/environment.ts` — read-only. `PROBE_INTERVAL_CYCLES`, `MAX_UNKNOWN_PROBE_FAILURES`, `resolveClaudeCodePath()` (throws when no CLI is found; the probe must keep mapping that to `unknown`).
- `adws/core/pauseQueue.ts` — one-line comment fix on `probeFailures` ("did not match rate-limit text" is no longer how classification works).
- `adws/triggers/__tests__/pauseQueueScanner.test.ts` — existing `resumeWorkflow` tests; extend the `child_process` mock and add a `scanPauseQueue` describe block driven by an injected probe.
- `adws/core/__tests__/claudeStreamParser.test.ts` — read-only reference for the exact envelope shapes (`rate_limit_event`, `system api_retry`) to reuse in the new fixtures.
- `adws/triggers/__tests__/mergeDispatchGate.test.ts` — read-only precedent for the minimal `vi.mock('../../core', () => ({ log: vi.fn() }))` pattern used by pure trigger-module tests.
- `adws/known_issues.md` — `rate-limit-crash` entry (pattern at line 39) needs the session-limit wording; add a new registry entry for the probe misclassification.
- `app_docs/feature-9gjajh-takeover-and-coordination.md` — owning doc for `pauseQueueScanner.ts`; its `scanPauseQueue` bullet (line 17) and Gotchas describe the text-matching probe and must be corrected.
- `.adw/conditional_docs.md` — the takeover doc's `Owns:` list (≈line 222–234) must gain the new module and its test so the docs-index gate stays coherent.
- `README.md` — directory tree entry for `adws/triggers/` (line ≈835) gains a line for the new module. Note: the working tree already carries an unrelated uncommitted README edit (de-duplicated tree lines); leave it as is.
- `features/regression/smoke/pause_resume_rate_limit.feature` — read-only. The existing pause/resume scenario; its `When` step is a cutover stub that returns `pending`, so the scenario is `pending` at baseline and must simply not regress.
- `features/per-issue/feature-902.feature` — read-only. The per-issue BDD scenarios for this issue (`@adw-902`), which the fix must satisfy. Its "Notes for the step definitions" rely on the seams this plan introduces: the CLI is stubbed through `probeRateLimit(exec?)` (or a throwaway `CLAUDE_CODE_PATH` script), and the scanner is driven through `scanPauseQueue(cycleCount, probe?)`. The step definitions go in `features/per-issue/step_definitions/`.
  - **§1, the probe's verdict:**
    - A rejected `rate_limit_event` ⇒ `limited`, whatever the text and exit code.
    - Non-JSON limit wording on stdout or stderr ⇒ `limited`.
    - A clean exit-0 reply ⇒ `clear`. This includes one carrying a non-rejected `rate_limit_event` (`allowed_warning`, or `allowed` with `overageStatus: "rejected"`).
    - No pause-worthy event and no limit wording ⇒ `unknown`.
    - The probe requests `--output-format stream-json` and `--verbose`.
  - **§2, parity:** the same stdout goes through `handleAgentProcess` and through the probe. For a rejected `rate_limit_event`, `api_retry` `overloaded_error` at attempt 1, and `api_retry` `api_error` 500 at attempt 2, the agent run must end `rateLimited` and the probe must report `limited`.
  - **§3, the scanner:**
    - `limited` never adds a probe failure or a comment. This covers a 36-cycle journey, an entry already at 2 failures, and a six-workflow replay of 2026-09-24.
    - `clear` relaunches the workflow under its original adwId and posts the resumed comment.
    - A genuine `unknown` still drops the entry at the third failure, with the manual-restart comment.
- `test/mocks/claude-cli-stub.ts` — read-only; do not change the stub. #812's tick-guard scenario ("A poll tick that raises is logged and the cron trigger keeps polling") points `CLAUDE_CODE_PATH` at this stub and spawns a real cron. It relies on the default, un-injected probe classifying the stub's reply as `clear`. The stub's `extractPrompt` treats `--max-turns` as a boolean flag, so under `PROBE_ARGS` it reads the prompt as `1`. It then streams the default plan-agent payload and exits 0. That payload is an `assistant` line and a `result` line, with no `rate_limit_event` and no limit wording, so `classifyProbeResult` must still return `clear` for it.
- `.adw/coding_guidelines.md` — 300-line file cap (motivates the new module), nesting ≤2 (motivates the outcome-helper extraction), comment discipline (no issue numbers in code comments, no name-echoing JSDoc).
- Conditional docs to read (matched conditions in `.adw/conditional_docs.md`): `app_docs/feature-9gjajh-takeover-and-coordination.md` (pause queue scanning), `app_docs/feature-9gjajh-claude-stream-parser.md` (`claudeStreamParser.ts`), `app_docs/feature-9gjajh-pause-and-auth-queues.md` (`pauseQueue.ts`, stuck-pause debugging), `app_docs/feature-9gjajh-claude-agents-core.md` (`agentProcessHandler.ts`, `claudeAgent.ts`), `app_docs/feature-9gjajh-root-config.md` (`known_issues.md`, `README.md`, `.adw/` metadata).

### New Files

- `adws/triggers/rateLimitProbe.ts` — the probe: `ProbeOutcome`, `ProbeExecResult`, `ProbeExec`, `PROBE_ARGS`, pure `classifyProbeResult`, default `runClaudeProbe` (`spawnSync`), and `probeRateLimit(exec = runClaudeProbe)`.
- `adws/triggers/__tests__/rateLimitProbe.test.ts` — unit tests for the classifier and the injectable probe.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Create `adws/triggers/rateLimitProbe.ts` (structural probe with an injectable exec)

- Imports: `spawnSync` from `child_process`; `log`, `resolveClaudeCodePath` from `'../core'`; `parseJsonlOutput`, `type JsonlParserState` from `'../core/claudeStreamParser'`.
- Export the types and constants:
  ```ts
  export type ProbeOutcome = 'clear' | 'limited' | 'unknown';

  export interface ProbeExecResult {
    status: number | null;
    stdout: string;
    stderr: string;
  }

  export type ProbeExec = (claudePath: string, args: readonly string[]) => ProbeExecResult;

  // Same output mode the pipeline agents run under, so the probe sees the same
  // rate_limit_event / api_retry envelopes the orchestrator pauses on.
  export const PROBE_ARGS: readonly string[] = [
    '--print', '--verbose', '--output-format', 'stream-json',
    '--model', 'haiku', '--max-turns', '1', '--dangerously-skip-permissions',
    'ping',
  ];
  ```
- Fallback list, used only when stdout carried no structured signal. Replace `"You've hit your limit"` with the stable prefix `"You've hit your"` (covers both "limit" and "session limit"); keep `"You're out of extra usage"`, `'502 Bad Gateway'`, `'Invalid authentication credentials'`. In `containsRateLimitText`, normalise typographic apostrophes (`‘`, `’`) to `'` before matching so the same class of wording drift cannot recur through punctuation. Comment it honestly: fallback for output that never reached stream-json; it is *not* the primary detector.
- Pure classifier. Order matters: structural first, then text fallback, then exit code. Checking text before `status === 0` keeps the old guarantee that the scanner never resumes while limit text is present.
  ```ts
  function createProbeParserState(): JsonlParserState {
    return {
      lastResult: null, fullOutput: '', turnCount: 0, toolCount: 0, lineBuffer: '',
      rateLimitRejected: false, authErrorDetected: false, serverErrorDetected: false,
      overloadedErrorDetected: false, compactionDetected: false, deniedToolCallCount: 0,
    };
  }

  // parseJsonlOutput holds back a final segment that lacks '\n'; a rate_limit_event
  // that is the last thing the CLI wrote would otherwise never be parsed.
  function withTrailingNewline(text: string): string {
    return text.endsWith('\n') ? text : `${text}\n`;
  }

  function hasPauseWorthySignal(state: JsonlParserState): boolean {
    return state.rateLimitRejected || state.serverErrorDetected
      || state.overloadedErrorDetected || state.authErrorDetected;
  }

  export function classifyProbeResult(result: ProbeExecResult): ProbeOutcome {
    const state = createProbeParserState();
    parseJsonlOutput(withTrailingNewline(result.stdout), state);
    if (hasPauseWorthySignal(state)) return 'limited';
    if (containsRateLimitText(`${result.stdout}\n${result.stderr}`)) return 'limited';
    if (result.status === 0) return 'clear';
    return 'unknown';
  }
  ```
  Do not derive `clear` from `state.lastResult`: the raw envelope uses `is_error` while `ClaudeCodeResultMessage` declares `isError`, so that field is unreliable. Exit status is the contract.
- Default exec. Use `spawnSync` with an args array (no shell quoting; a `claudePath` containing spaces is safe), `encoding: 'utf-8'`, `timeout: 30_000`, and `stdio: ['ignore', 'pipe', 'pipe']` (the CLI waits 3 s for stdin and writes a warning when stdin is an open pipe). Rethrow `result.error` (ENOENT, ETIMEDOUT) so the caller's catch maps it to `unknown` with the message logged; coerce `stdout`/`stderr` with `?? ''`.
  ```ts
  export function runClaudeProbe(claudePath: string, args: readonly string[]): ProbeExecResult {
    const result = spawnSync(claudePath, [...args], {
      encoding: 'utf-8', timeout: PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }
  ```
- Probe entry point. On `unknown`, log the exit status and the last ~300 characters of stderr (or stdout when stderr is empty) at `warn`; the 2026-09-24 logs carried no output at all, which is why triage needed a hand-run probe. `resolveClaudeCodePath()` throwing (no CLI) must still yield `unknown`, as today.
  ```ts
  export function probeRateLimit(exec: ProbeExec = runClaudeProbe): ProbeOutcome {
    try {
      const result = exec(resolveClaudeCodePath(), PROBE_ARGS);
      const outcome = classifyProbeResult(result);
      if (outcome === 'unknown') {
        log(`Rate-limit probe unclassified (exit ${result.status}): ${tailOf(result.stderr || result.stdout)}`, 'warn');
      }
      return outcome;
    } catch (err) {
      log(`Rate-limit probe could not run: ${err}`, 'warn');
      return 'unknown';
    }
  }
  ```
- Keep the file well under 300 lines, no decorators, no `any`, comments only for the non-obvious (the newline flush, the stdin `ignore`, the fallback's role, the check ordering).

### 2. Rewire `adws/triggers/pauseQueueScanner.ts` onto the new probe

- Remove `execSync` from the `child_process` import (keep `spawn`). Delete `RATE_LIMIT_STRINGS`, `containsRateLimitText`, `probeRateLimit`, and the false `/** Rate-limit indicator strings — same as agentProcessHandler detection. */` comment.
- Import `{ probeRateLimit, type ProbeOutcome } from './rateLimitProbe'`.
- Change the signature to `export async function scanPauseQueue(cycleCount: number, probe: () => ProbeOutcome = probeRateLimit): Promise<void>`. `trigger_cron.ts` keeps calling `scanPauseQueue(cycleCount)` unchanged; its test already mocks the module, so no change there.
- Flatten the per-entry branch (guideline: max nesting 2, extract loop bodies with branching). Suggested shape, preserving every log line and side effect exactly:
  ```ts
  function recordUnknownProbeFailure(entry: PausedWorkflow): void {
    const failures = (entry.probeFailures ?? 0) + 1;
    log(`Unknown probe failure for workflow ${entry.adwId} (${failures}/${MAX_UNKNOWN_PROBE_FAILURES})`, 'warn');
    if (failures < MAX_UNKNOWN_PROBE_FAILURES) {
      updatePauseQueueEntry(entry.adwId, { probeFailures: failures, lastProbeAt: new Date().toISOString() });
      return;
    }
    log(`Max probe failures reached for ${entry.adwId} — removing from queue`, 'error');
    removeFromPauseQueue(entry.adwId);
    postEntryStageComment(entry, 'error', { /* unchanged message */ });
  }

  async function applyProbeOutcome(entry: PausedWorkflow, outcome: ProbeOutcome): Promise<void> {
    if (outcome === 'clear') { log(`Rate limit cleared — resuming workflow ${entry.adwId}`, 'success'); await resumeWorkflow(entry); return; }
    if (outcome === 'limited') { log(`Rate limit still active for workflow ${entry.adwId} — will retry later`, 'info'); updatePauseQueueEntry(entry.adwId, { lastProbeAt: new Date().toISOString() }); return; }
    recordUnknownProbeFailure(entry);
  }
  ```
  `scanPauseQueue` becomes: cadence gate → `readPauseQueue()` → empty guard → log count → `const outcome = probe();` → `for (const entry of entries) await applyProbeOutcome(entry, outcome);`. The probe still runs exactly once per scan, not once per entry.
- Update the file's header comment so it no longer claims the probe is a bare `claude --print "ping"` text check; say the probe is delegated to `rateLimitProbe` and classified structurally.
- Confirm the file stays under 300 lines (it is 257 today and loses ~25 lines of probe code).

### 3. Correct the stale `probeFailures` comment in `adws/core/pauseQueue.ts`

- Change `/** Number of consecutive probe failures that did not match rate-limit text. */` to `/** Consecutive probes classified 'unknown' (not a rate limit); reset is not automatic. */` or similar wording that does not reference text matching. No behavioural change.

### 4. Add `adws/triggers/__tests__/rateLimitProbe.test.ts`

- Mocks: `vi.mock('../../core', () => ({ log: vi.fn(), resolveClaudeCodePath: () => '/fake/claude' }))` and `vi.mock('../../core/agentState', () => ({ AgentStateManager: { writeRawOutput: vi.fn(), appendLog: vi.fn() } }))` (the parser imports it; the probe never passes `statePath`, but keep the module side-effect-free). Do **not** mock `../../core/claudeStreamParser`: the point is to run the real parser.
- Fixtures (mirror the real envelopes observed during planning):
  ```ts
  const INIT = JSON.stringify({ type: 'system', subtype: 'init', cwd: '/tmp', session_id: 's1' });
  const ASSISTANT = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Pong!' }] } });
  const RATE_LIMIT_ALLOWED = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1790333400, rateLimitType: 'five_hour', overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled', isUsingOverage: false } });
  const RATE_LIMIT_REJECTED = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1790333400, rateLimitType: 'five_hour' } });
  const RESULT_OK = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Pong!' });
  const RESULT_ERR = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Rate limit reached' });
  const SESSION_LIMIT_TEXT = "You've hit your session limit · resets 1:50pm (Europe/Amsterdam)";
  ```
- `describe('classifyProbeResult')`:
  - **clear**: `{ status: 0, stdout: [INIT, ASSISTANT, RATE_LIMIT_ALLOWED, RESULT_OK].join('\n') + '\n', stderr: '' }` → `'clear'` (also proves `overageStatus: 'rejected'` does not trip detection). The same clean stream with a `rate_limit_event` whose `status` is `'allowed_warning'` → `'clear'`: only `rejected` holds the probe.
  - **limited via structured event, text-agnostic**: `{ status: 1, stdout: [RATE_LIMIT_REJECTED, RESULT_ERR].join('\n') + '\n', stderr: '' }` → `'limited'`; the same stdout with `status: 0` → `'limited'` (structure beats exit code).
  - **limited via other pause-worthy flags**:
    - `system api_retry` with `attempt: 1, error: 'overloaded_error', error_status: 529` → `'limited'`. This is the first retry, which is when `agentProcessHandler` already pauses.
    - `system api_retry` with `error: 'api_error', error_status: 500, attempt: 2` → `'limited'`. The error name matches the parser's own tests and the §2 scenario example.
    - `system api_retry` with `error_status: 401` → `'limited'`.
  - **limited via fallback text only (non-JSON)**: `{ status: 1, stdout: '', stderr: SESSION_LIMIT_TEXT }` → `'limited'`; legacy `"You've hit your limit"` → `'limited'`; typographic-apostrophe variant `"You’ve hit your session limit"` → `'limited'`; `"You're out of extra usage"` → `'limited'`; text on stdout instead of stderr → `'limited'`.
  - **trailing partial line**: `{ status: 1, stdout: RATE_LIMIT_REJECTED, stderr: '' }` (no trailing newline) → `'limited'`.
  - **unknown**:
    - `{ status: 1, stdout: '', stderr: 'Error: EACCES: permission denied' }` → `'unknown'`.
    - `{ status: null, stdout: '', stderr: '' }` (timeout) → `'unknown'`.
    - An `api_retry` with `attempt: 1` and a non-overloaded error, plus exit 1 → `'unknown'`. This mirrors `agentProcessHandler`, which pauses on a non-overloaded retry only from `attempt >= 2`.
    - A stream-json `result` with `subtype: 'error_during_execution'`, `is_error: true` and `result: 'API Error: 400 invalid_request_error'`, plus exit 1 → `'unknown'`. An error result is not a limit by itself.
- `describe('probeRateLimit')`:
  - Calls `exec` once with `'/fake/claude'` and `PROBE_ARGS`; asserts the args include `'--output-format', 'stream-json'`, `'--verbose'`, `'--print'`, and end with `'ping'` (regression hook against someone dropping the structured mode).
  - Returns the classifier's outcome for the exec result (`'clear'` for a status-0 healthy stdout; `'limited'` for `RATE_LIMIT_REJECTED`).
  - An exec that throws (`ENOENT`) → `'unknown'`, no throw, and `log` called with a `'warn'` level message.
  - An `'unknown'` outcome logs a `'warn'` message containing the exit status and a snippet of stderr.

### 5. Extend `adws/triggers/__tests__/pauseQueueScanner.test.ts` for `scanPauseQueue`

- Update the `child_process` mock factory to `{ spawn: vi.fn(), spawnSync: vi.fn() }` (drop `execSync`; the scanner no longer imports it, and the probe module's `spawnSync` binding must exist on the mock).
- Import `readPauseQueue` from the already-mocked `'../../core/pauseQueue'` and `scanPauseQueue` from `'../pauseQueueScanner'`. `PROBE_INTERVAL_CYCLES` is mocked to `1`, so every `cycleCount` passes the gate; call `scanPauseQueue(1, probe)`.
- Add `describe('scanPauseQueue')` with `beforeEach` seeding `vi.mocked(readPauseQueue).mockReturnValue([entry])`:
  - **limited does not touch `probeFailures` (the acceptance criterion)**: `probe = () => 'limited'`, entry `probeFailures: 2` → `updatePauseQueueEntry` called once with `entry.adwId` and an object containing `lastProbeAt` and **no** `probeFailures` key (`expect(updates).not.toHaveProperty('probeFailures')`); `removeFromPauseQueue` and `postIssueStageComment` not called.
  - **unknown below the cap increments**: `probe = () => 'unknown'`, `probeFailures: 0` → `updatePauseQueueEntry(entry.adwId, objectContaining({ probeFailures: 1 }))`, not removed.
  - **unknown at the cap drops and comments**: `probe = () => 'unknown'`, `probeFailures: 2` → `removeFromPauseQueue(entry.adwId)` and an `'error'` stage comment whose `errorMessage` contains `failed to resume after 3 probe attempts`.
  - **clear resumes**: `probe = () => 'clear'` with `spawn` returning `makeFakeChild()` and `vi.runAllTimersAsync()` → `childProcess.spawn` called once and `removeFromPauseQueue(entry.adwId)` called.
  - **one probe per scan**: two entries, `probe = vi.fn(() => 'limited')` → `probe` called exactly once, `updatePauseQueueEntry` called twice.
- Leave every existing `resumeWorkflow` test untouched.

### 6. Update `adws/known_issues.md`

- `rate-limit-crash` entry (line 39): extend the pattern to `` `You've hit your limit`, `You've hit your session limit`, `You're out of extra usage` ``.
- Append a new entry documenting this incident so the notification agent classifies it as known:
  - slug `pause-probe-session-limit-unknown`
  - pattern: `` `Unknown probe failure for workflow` ``, `` `failed to resume after 3 probe attempts. Manual restart required.` ``
  - description: the text-list probe misclassified the session-limit wording as `unknown`, dropped the entry after `MAX_UNKNOWN_PROBE_FAILURES`, and stranded the workflow at `workflowStage: paused` (terminal class, no `## Retry` path) while it still held a `MAX_CONCURRENT_PER_REPO` slot; stranded #871, #872, #874–#877 on 2026-09-24.
  - status `solved`; solution: `adws/triggers/rateLimitProbe.ts` classifies from the shared `claudeStreamParser` state under `--output-format stream-json`, text matching is fallback-only on the stable prefix `You've hit your`, and the probe/exec are injectable and unit-tested.
  - fix_attempts `1`; linked_issues `#902`; first_seen `2026-09-24`; sample_log with the three representative lines (`Unknown probe failure … (1/3)`, `(2/3)`, `Max probe failures reached … removing from queue`), timestamps marked approximate.

### 7. Update the owning docs, the docs index, and the README tree

- `app_docs/feature-9gjajh-takeover-and-coordination.md`: rewrite the `scanPauseQueue` bullet (line 17) to say the probe is `probeRateLimit` from `rateLimitProbe.ts`, run with `--output-format stream-json --verbose`, classified by `classifyProbeResult` from the shared `claudeStreamParser` state (`rateLimitRejected` / `serverErrorDetected` / `overloadedErrorDetected` / `authErrorDetected` ⇒ `limited`), text fallback only for non-JSON output, exit 0 ⇒ `clear`, else `unknown`; `scanPauseQueue(cycleCount, probe?)` and `probeRateLimit(exec?)` are injectable. Add a Gotchas bullet: `unknown` is the only outcome that consumes `probeFailures`, so any new CLI failure wording must be classified `limited` structurally or via the fallback, never by adding to a text list first. Keep the existing `--dangerously-skip-permissions` gotcha (still true).
- `.adw/conditional_docs.md`: under the `app_docs/feature-9gjajh-takeover-and-coordination.md` entry's `Owns:` list (≈line 222), add `adws/triggers/rateLimitProbe.ts` and `adws/triggers/__tests__/rateLimitProbe.test.ts`; add a condition line "When working on the pause-queue rate-limit probe (`rateLimitProbe.ts`) or its outcome classification".
- `README.md`: in the `adws/triggers/` tree (after the `pauseQueueScanner.ts` line ≈835) add `│   ├── rateLimitProbe.ts  # Pause-queue probe: stream-json ping classified through claudeStreamParser (limited/clear/unknown), text fallback only for non-JSON output, injectable exec`. Do not revert the unrelated README edit already present in the working tree.

### 8. Run the `Validation Commands`

- Run every command listed below; all must pass. Compare the BDD scenario result against the baseline described in the Notes.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- Reproduce **before** the fix (prints `unknown`; after the fix the equivalent case is the `session limit text → limited` unit test):
  ```bash
  bunx tsx -e "const S=[\"You've hit your limit\",\"You're out of extra usage\",'502 Bad Gateway','Invalid authentication credentials']; const out=\"You've hit your session limit · resets 1:50pm (Europe/Amsterdam)\"; console.log(S.some(s=>out.includes(s)) ? 'limited' : 'unknown')"
  ```
- Targeted unit tests (new and touched files; must be green **after** the fix):
  ```bash
  bunx vitest run adws/triggers/__tests__/rateLimitProbe.test.ts adws/triggers/__tests__/pauseQueueScanner.test.ts adws/core/__tests__/claudeStreamParser.test.ts adws/triggers/__tests__/trigger_cron.test.ts
  ```
- Full unit suite: `bun run test:unit`
- Lint: `bun run lint`
- Type check (root and adws project): `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`
- Build: `bun run build`
- Git/gh chokepoint guard (new file spawns `claude`, never `git`/`gh`): `bun run lint:git-guard`
- Docs-index gate (because `.adw/conditional_docs.md` changed): `bun run lint:docs-index`
- Existing pause/resume scenario must not regress. Baseline is `1 scenario (1 pending)` because its `When` step is a cutover stub; after the fix it must still report `pending`, never `failed` or `undefined`:
  ```bash
  NODE_OPTIONS="--import tsx" bunx cucumber-js --name "orchestrator records paused stage on rate-limit detection"
  ```
- Per-issue scenarios in `features/per-issue/feature-902.feature`. Every scenario must pass once its step definitions exist in `features/per-issue/step_definitions/`:
  ```bash
  NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-902"
  ```
- Cross-check of the default, un-injected probe path. #812's tick-guard scenario spawns a real cron against `test/mocks/claude-cli-stub.ts` and relies on the new `runClaudeProbe` + `classifyProbeResult` returning `clear` for the stub's clean stream-json reply. If the probe returned `unknown`, the seeded entry would never reach `resumeWorkflow` and the tick would never raise. It must not regress from its pre-change result:
  ```bash
  NODE_OPTIONS="--import tsx" bunx cucumber-js --name "A poll tick that raises is logged and the cron trigger keeps polling"
  ```
- Live smoke of the new probe command (optional, needs a working `claude` login; expect exit 0 and a `rate_limit_event` line with `"status":"allowed"`):
  ```bash
  claude --print --verbose --output-format stream-json --model haiku --max-turns 1 --dangerously-skip-permissions "ping" < /dev/null; echo "exit=$?"
  ```

## Notes

- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of fixing the bug.
- No new libraries are needed. (Install command, if ever required: `bun add <package>`.)
- Guideline-driven choices: the probe moves to a new module because adding it inline would push `pauseQueueScanner.ts` past the 300-line cap; the outcome helpers exist to bring `scanPauseQueue` back to ≤2 nesting levels. Comments must not cite issue numbers (`git blame` carries history); the `linked_issues` field in `known_issues.md` is a registry field, not a code comment.
- Detection parity table (probe ⇔ `agentProcessHandler`): `rateLimitRejected`, `serverErrorDetected`, `overloadedErrorDetected` ⇒ pause on the orchestrator side and `limited` on the probe side. `authErrorDetected` is additionally mapped to `limited` on the probe side only because the previous probe already treated the `Invalid authentication credentials` text as `limited`; a Claude auth outage must not spend the entry's three-strike budget. `compactionDetected` and `deniedToolCallCount` are irrelevant to a one-turn ping and are ignored. §2 of `features/per-issue/feature-902.feature` checks the forward direction at runtime: every stream event that ends a `handleAgentProcess` run `rateLimited` must make the probe report `limited`. The `authErrorDetected` ⇒ `limited` mapping exists only on the probe side, and no scenario exercises it. The unit test with `error_status: 401` is its only coverage.
- The classifier order (structural → text fallback → exit 0 → unknown) is deliberate. Text is checked before the exit code so an exit-0 run whose text still says the limit is active is never treated as `clear` (the previous behaviour on the success path).
- Baseline BDD state in this environment on 2026-09-25: the full `@regression` run reports pre-existing failures (122 failed, 8 undefined, 42 pending of 517), unrelated to this change; the specific pause/resume smoke scenario is `pending`. Passing a feature-file path to `cucumber-js` does not narrow the run (the config's `paths` wins); use `--name` or `--tags` as shown above.
- The probe's `--dangerously-skip-permissions` flag is retained on purpose for a one-turn ping (documented gotcha in the takeover app doc).
- Out of scope, carried from the issue: `## Retry` / `## continue` do nothing for a workflow stranded at `paused`; the only recovery is hand-editing `agents/paused_queue.json`. Recommend filing a follow-up issue for a `paused`-stage recovery directive if this fix does not make the case moot.
