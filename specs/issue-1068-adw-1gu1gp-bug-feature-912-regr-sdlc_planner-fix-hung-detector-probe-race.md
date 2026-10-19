# Bug: feature-912 hung-detector probe races the heartbeat on a 120 ms real-clock threshold

## Metadata
issueNumber: `1068`
adwId: `1gu1gp-bug-feature-912-regr`
issueJson: `{"number":1068,"title":"bug: feature-912 regression scenario flakes — hung-detector probe races the heartbeat on a 120 ms real-clock threshold","body":"## Summary\n\nScheduled regression run [39244502409](https://github.com/paysdoc/AI_Dev_Workflow/actions/runs/39244502409) (dev @ `f7541232`) failed in the **Docker** job only; the host job passed the same scenario.\n\n```\n368 scenarios (1 failed, 367 passed)\n\n1) Scenario: While it waits, a workflow whose phase runs under its name stays in that phase's running stage\n   and keeps its heartbeat, so the hung-orchestrator detector never mistakes it for a wedged process\n   # features/regression/rate-limit/feature-912.feature:410\n   ✔ Then the state file for adwId \"wait912-871\" recorded workflowStage \"stepDef_running\" throughout every wait\n   ✔ And the heartbeat advanced lastSeenAt in the state file for adwId \"wait912-871\" during every wait\n   ✖ And the hung-orchestrator detector did not report adwId \"wait912-871\" at the end of any wait\n       AssertionError: Expected adwId wait912-871 not reported hung at the end of wait 2\n       at features/regression/step_definitions/feature-912.steps.ts:569\n```\n\nWait 1 passed; wait 2 failed. Stage and heartbeat assertions both passed in the same run, so the heartbeat was alive.\n\nNot a recurrence of the previous red runs: 2026-10-18 (`39117594886`) was the `feature-966-isolation → feature-961.steps.ts` `ERR_MODULE_NOT_FOUND` cross-import (#1043 class); 2026-10-07 was the #937 screenshot scenarios. This scenario has been in `@regression` since `f288f31d` (#1001, 2026-10-06) and passed ~10 daily runs before this — consistent with a low-rate flake.\n\n## Root cause (hypothesis — derived from code, not reproduced)\n\nThe scenario races real wall-clock timers with very thin margins (`feature-912.steps.ts:55-57`):\n\n| constant | value |\n|---|---|\n| `TEST_HEARTBEAT_INTERVAL_MS` | 20 ms |\n| `TEST_HUNG_THRESHOLD_MS` | 120 ms |\n| `WAIT_SUSPEND_REAL_MS` | 200 ms |\n\n`makeOrchestratorClock().sleep` (`:388-416`) awaits `setTimeout(200)` and then **immediately** (in the microtask after that timer callback) calls `findHungOrchestrators(Date.now(), 120, …)`.\n\nThe heartbeat (`adws/core/heartbeat.ts`) is a `setInterval` on the same event loop. If the loop stalls for roughly ≥100–120 ms near the end of the wait (GC pause, sync fs I/O in `writeTopLevelState`, a noisy shared CI runner inside Docker), then when the loop resumes the sleep's timer (earlier expiry) fires before the overdue heartbeat tick. Node drains microtasks between timer callbacks, so the detector runs against a `lastSeenAt` that is > 120 ms old **before** the pending heartbeat gets to write. Result: a live, healthy orchestrator is reported hung.\n\nThe product code is fine. A stall long enough to trip the production threshold (minutes) is not plausible. This is a test-harness timing defect.\n\n## Proposed fix\n\n1. In the `sleep` stub, yield past the timers phase before probing, so any overdue heartbeat tick runs first:\n   ```ts\n   await new Promise<void>((resolve) => setTimeout(resolve, WAIT_SUSPEND_REAL_MS));\n   await new Promise<void>((resolve) => setImmediate(resolve)); // let overdue heartbeat ticks fire\n   ```\n   This removes the specific ordering race regardless of stall length.\n2. Widen the margin so one GC pause can't decide the verdict. For example, keep heartbeat at 20 ms, raise `TEST_HUNG_THRESHOLD_MS` to ~500 ms and `WAIT_SUSPEND_REAL_MS` to ~700 ms. The scenario still proves its point because the wait outlasts the threshold, and runtime grows by only ~1 s.\n3. Do **not** weaken the assertion, and do not tag `@host-only`. The Docker job is the one that exposes the flake.\n\n## Acceptance criteria\n\n- [ ] `feature-912.steps.ts` sleep stub yields (`setImmediate`) before calling `findHungOrchestrators`.\n- [ ] Hung threshold and wait duration have ≥ ~400 ms of headroom over a single event-loop stall, with `WAIT_SUSPEND_REAL_MS > TEST_HUNG_THRESHOLD_MS` preserved.\n- [ ] Negative control still holds: with the heartbeat stopped during the wait, the detector **does** report the adwId as hung (so the fix can't turn the scenario vacuous).\n- [ ] `@regression` passes in both the host and Docker jobs.\n\n\n## Blocked by\n\n- #1069\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-19T12:33:17Z","comments":[],"actionableComment":null}`

## Bug Description
Scheduled regression run 39244502409 (dev @ `f7541232`) failed in the **Docker** job only; the host job passed the same commit. One of 368 scenarios failed: the `stepDef` example (`features/regression/rate-limit/feature-912.feature:410`) of the §3 Scenario Outline at line 392, "While it waits, a workflow whose phase runs under its name stays in that phase's running stage and keeps its heartbeat, so the hung-orchestrator detector never mistakes it for a wedged process" (adwId `wait912-871`).

- **Symptom:** T-RW11 (stage `stepDef_running` throughout every wait) and T-RW12 (heartbeat advanced `lastSeenAt` during every wait) passed. T-RW13 failed with `AssertionError: Expected adwId wait912-871 not reported hung at the end of wait 2` (`feature-912.steps.ts:569`). Wait 1 passed and wait 2 failed.
- **Expected:** an orchestrator whose real heartbeat writes `lastSeenAt` every 20 ms is never reported hung by `findHungOrchestrators` at the end of a wait, on any runner.
- **Actual:** in about one run in ten or more, the probe at the end of a wait reads a `lastSeenAt` older than the 120 ms test threshold and reports a live, heartbeating orchestrator as hung.

The product code (`adws/core/heartbeat.ts`, `adws/core/hungOrchestratorDetector.ts`, `adws/core/phaseRunner.ts`) is correct. The defect is entirely in the scenario's injected test clock.

## Problem Statement
The `WaitClock.sleep` stub built by `makeOrchestratorClock` (`features/regression/step_definitions/feature-912.steps.ts:385-418`) holds each wait on a real `setTimeout(WAIT_SUSPEND_REAL_MS)` (200 ms). It then runs `findHungOrchestrators(Date.now(), TEST_HUNG_THRESHOLD_MS, …)` (120 ms) in the same microtask continuation. Two harness defects make the verdict depend on event-loop scheduling noise:
1. **Ordering:** the probe can run before an overdue heartbeat tick has written `lastSeenAt`.
2. **Margin:** a 120 ms threshold over a 20 ms heartbeat tolerates only about 100 ms of stall.

The scenario must give a deterministic "not hung" verdict for a live heartbeat. It must also still prove that a stopped heartbeat **would** be reported hung, so the assertion stays meaningful.

## Solution Statement
This is a test-harness-only fix in `features/regression/step_definitions/feature-912.steps.ts`. No product code changes, no assertion is weakened, no step or scenario text changes and no `@host-only` tag is added.

1. **Fix the ordering.** In the sleep stub, directly after the wait's `setTimeout` resolves, add `await new Promise<void>((resolve) => setImmediate(resolve));`. This comes before the candidate evaluation, the `findHungOrchestrators` probe and the `endState` read.
   - On Node, `setImmediate` callbacks run in the check phase, after every timer that was due in the current timers phase.
   - On Bun, they run after `drainTimers` has fired every expired timer.
   - Either way, an overdue heartbeat tick always writes `lastSeenAt` before the probe reads it, however long the stall was.
2. **Widen the real-time margin.**
   - Keep `TEST_HEARTBEAT_INTERVAL_MS = 20`.
   - Set `TEST_HUNG_THRESHOLD_MS = 500`. Size it in real time, not as `6 * TEST_HEARTBEAT_INTERVAL_MS`, because stalls are measured in absolute time.
   - Set `WAIT_SUSPEND_REAL_MS = 700`. `WAIT_SUSPEND_REAL_MS > TEST_HUNG_THRESHOLD_MS` still holds, so a heartbeat that stopped during a wait would still be reported.
   - Stall tolerance rises from about 100 ms to about 480 ms.
3. **Update the design notes that state the old timing.** These notes are the specification the step definitions are generated from, so stale text here would bring the bug back:
   - the `T-RW13` semantics in `features/regression/vocabulary.md` ("a threshold of six test heartbeat ticks");
   - the narrative "INSIDE EVERY WAIT" note in `features/regression/rate-limit/feature-912.feature` ("Scale the threshold … so six ticks"). This is description text only;
   - the timing sentence in `app_docs/feature-9gjajh-bdd-regression-suite.md` ("200 ms … about 7 s").

## Steps to Reproduce
On CI the flake hits about one run in ten or more. Force the stall to reproduce it deterministically.

**A. The mechanism in isolation.** This touches no repository file. Run it with the host's Node (≥ 11):
```bash
node -e '
let lastSeenAt = Date.now();
const heartbeat = setInterval(() => { lastSeenAt = Date.now(); }, 20);
const stall = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
async function ageAtProbe(yieldFirst) {
  setTimeout(() => stall(150), 199);
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (yieldFirst) await new Promise((resolve) => setImmediate(resolve));
  return Date.now() - lastSeenAt;
}
(async () => {
  console.log("probe right after the timer:", await ageAtProbe(false), "ms");
  console.log("probe after setImmediate:   ", await ageAtProbe(true), "ms");
  clearInterval(heartbeat);
})();'
```
Expected output:
- The first line prints about 150–170 ms. That is over the 120 ms threshold, and is what the scenario's detector saw.
- The second line prints about 0–2 ms.

**B. In the scenario.** This is a temporary edit and must never be committed.
1. In `makeOrchestratorClock(...).sleep`, immediately before `await new Promise<void>((resolve) => setTimeout(resolve, WAIT_SUSPEND_REAL_MS));`, add:
   ```ts
   setTimeout(() => { const end = Date.now() + 150; while (Date.now() < end) { /* stall */ } }, WAIT_SUSPEND_REAL_MS - 1); // TEMP-REPRO
   ```
   This blocks the loop for 150 ms starting 1 ms before the wait's timer is due, just after the wait's last heartbeat tick.
2. Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-in-process-wait" --name "keeps its heartbeat"`.
3. Expected result before the fix: both examples (`build`, `stepDef`) pass T-RW11 and T-RW12 and fail T-RW13 with `Expected adwId wait912-871 not reported hung at the end of wait 1`. This is the CI failure, made deterministic.
4. The working tree is mounted into the container, so the same edit also reproduces the failure in the Docker leg with `bash test/docker-run.sh --tags "@rate-limit-in-process-wait"`.

## Root Cause Analysis
- **Thin, ratio-scaled margins** (`feature-912.steps.ts:55-57`): heartbeat 20 ms, threshold `6 * 20 = 120` ms, wait 200 ms.
  - The threshold copies production's ratio: a 30 s heartbeat against a 180 s threshold, six ticks (`adws/core/config.ts:63,66`). The feature narrative at `feature-912.feature:204-209` and vocabulary entry T-RW13 prescribe this.
  - Scaling by ratio keeps the number of missed ticks tolerated, but shrinks the absolute stall tolerance from about 150 s in production to about 100 ms in the test.
  - Stalls are absolute: GC pauses, CPU steal on a shared runner, and synchronous state-file I/O on the container's overlay filesystem (`writeTopLevelState` reads, writes and renames on every 20 ms tick).
- **Probe ordering** (`feature-912.steps.ts:397-411`):
  - The stub awaits `setTimeout(resolve, 200)`. With no yield, it then runs `evaluateCandidate` (when configured), `findHungOrchestrators(Date.now(), 120, …)` and the `endState` read.
  - The heartbeat is a `setInterval` on the same loop (`adws/core/heartbeat.ts:18-24`). Its callback writes `lastSeenAt` synchronously.
  - Node fires expired timer lists in expiry order. It drains microtasks (`runNextTicks()`) between lists and between timers.
  - Take a stall that begins after a heartbeat tick in the last 20 ms of the wait, so the heartbeat's next expiry is later than the sleep's. When the loop resumes, both timers are overdue. The sleep's timer fires first, and its `resolve()` queues the async continuation.
  - That continuation runs the probe during the microtask drain, before the overdue heartbeat callback writes. The probe sees `Date.now() − lastSeenAt` equal to the stall plus the time since that tick, which exceeds 120 ms. It reports a live PID in `stepDef_running` as hung.
  - Bun's `drainTimers` also fires expired timers in deadline order and drains microtasks after each callback, so the same race exists there.
- **Why it is rare:** it needs a stall of at least about 100–120 ms, starting inside the window of at most 20 ms between the wait's last heartbeat tick and its timer. That fits about 10 green daily runs before the first red one.
- **Why the Docker leg is more exposed:**
  - It is noisier: a container on a shared VM, with state files on overlayfs.
  - `test/Dockerfile` is `oven/bun:latest` plus Git, with no Node.js. The cucumber-js bin's `#!/usr/bin/env node` shebang most likely resolves to the image's bun-as-node fallback shim, so this leg probably runs the suite on Bun's runtime and GC.
  - The fix must, and does, hold on both runtimes.
- **Why T-RW11 and T-RW12 passed in the same run:** `endState` is read after the probe. It still carries the last tick before the stall, which is later than `beginState.lastSeenAt`. So "heartbeat advanced" holds even when the probe sees a stale `lastSeenAt`, which matches the CI output exactly.
- **Production is unaffected:** with a 30 s heartbeat and a 180 s threshold, no plausible event-loop stall comes near the threshold. This is a test-harness timing defect only.

## Relevant Files
Use these files to fix the bug:

- `features/regression/step_definitions/feature-912.steps.ts` — the defect lives here:
  - lines 55-57: the timing constants;
  - lines 385-418: `makeOrchestratorClock().sleep`;
  - line 268: the heartbeat start;
  - lines 556-571: the T-RW12 and T-RW13 Then steps. These stay unchanged; read them to confirm no assertion is weakened.
- `features/regression/rate-limit/feature-912.feature` — the §3 outline at line 392 (example `stepDef` at line 410) that flaked. Its narrative "INSIDE EVERY WAIT" note (lines 198-210) prescribes the six-tick threshold scaling and must be rewritten. Only description text changes.
- `features/regression/vocabulary.md` — T-RW13 (line 442) states "a threshold of six test heartbeat ticks" and must be updated. W-RW2 (line 427, "stays suspended … longer than the detector's threshold") and G-RW6 (line 421, "20 ms tick") stay true; read them to confirm.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` — the conditional doc for the promoted feature-912 scenario, the Docker runner and the daily regression workflow. Line 116 says "each wait suspends 200 ms of real time, so the feature takes about 7 s" and must be updated.
- `app_docs/feature-9gjajh-coordination-kernel.md` — the conditional doc for heartbeat and hung-detector semantics: reported only when the age *strictly exceeds* the threshold, for a live PID in a `*_running` stage. Reference only.
- `adws/core/heartbeat.ts` — the real `setInterval` heartbeat that writes `lastSeenAt` synchronously. Unchanged.
- `adws/core/hungOrchestratorDetector.ts` — `findHungOrchestrators(now, staleThresholdMs, deps)`. Unchanged.
- `adws/core/agentState.ts` — `writeTopLevelState` and `readTopLevelState` (synchronous read, merge, then `atomicWriteJson` write-and-rename). The heartbeat and the probe both use them. Unchanged.
- `adws/core/phaseRunner.ts` — `runPhase` and `waitForRateLimitReset` ask the injected clock for exactly one sleep per wait. Unchanged.
- `adws/core/rateLimitWaitPolicy.ts` — the `WaitClock` contract: sleep is timer-based and never blocks the event loop. Unchanged.
- `adws/core/config.ts` — production `HEARTBEAT_TICK_INTERVAL_MS` (30 s) and `HEARTBEAT_STALE_THRESHOLD_MS` (180 s), the basis for "production is fine". Unchanged.
- `test/Dockerfile`, `test/docker-run.sh` — the Docker leg, the one that flaked: `oven/bun:latest` with no Node.js, running `bunx cucumber-js`. Unchanged; used for validation.
- `.github/workflows/regression.yml` — the `host` and `docker` jobs that must both pass. Unchanged.
- `.adw/coding_guidelines.md` — comment discipline (invariants and ordering constraints only, no issue numbers, no banners), no `any`, no `!`.

No new files.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Reproduce the race before the fix (temporary, never committed)
- Run the mechanism demo from Steps to Reproduce A. Confirm the probe right after the timer reports more than 120 ms, and the probe after `setImmediate` reports about 0.
- Apply the one-line `// TEMP-REPRO` stall from Steps to Reproduce B. Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-in-process-wait" --name "keeps its heartbeat"`. Confirm T-RW13 fails with `not reported hung at the end of wait 1` while T-RW11 and T-RW12 pass.
- Remove the TEMP-REPRO line. At this point the file has no other edits, so `git checkout -- features/regression/step_definitions/feature-912.steps.ts` is safe.

### 2. Yield past the timers phase before the hung-detector probe
- In `makeOrchestratorClock(o).sleep` (`feature-912.steps.ts`), directly after `await new Promise<void>((resolve) => setTimeout(resolve, WAIT_SUSPEND_REAL_MS));`, add:
  ```ts
  // After a stalled loop this timer can fire ahead of an overdue heartbeat tick, and its continuation runs before
  // later timers do: yield past the timers phase so every overdue tick has written lastSeenAt before the probe reads it.
  await new Promise<void>((resolve) => setImmediate(resolve));
  ```
- The yield must sit **before** the `world.candidateArrivalIssue` block, the `findHungOrchestrators(...)` call and the `endState` read.
- Leave the rest of the stub untouched: the `until` computation, the `beginState` sample, `world.firstWaitBegunResolve?.()`, the never-resolving `diedDuringFirstWait` branch, the `waitEvents` push with its `seq`, and `world.clockNow = until`.
- Use `setImmediate`. `process.nextTick`, `queueMicrotask` and `await Promise.resolve()` do not help, because they run before the next timer callback. The repo already uses the same pattern in `adws/core/__tests__/fixtures/recordingDeviceHost.ts:96`, and it type-checks.

### 3. Widen the real-time margin of the test clock
- Replace lines 55-57 with constants equivalent to:
  ```ts
  const TEST_HEARTBEAT_INTERVAL_MS = 20;
  // Real time, not a multiple of the tick: no single event-loop stall (a GC pause, a throttled CI container) may outlast it.
  const TEST_HUNG_THRESHOLD_MS = 500;
  const WAIT_SUSPEND_REAL_MS = 700; // real ms a wait actually blocks — longer than the hung threshold, so a stopped heartbeat would be reported
  ```
- Keep the heartbeat at 20 ms. The normal age of `lastSeenAt` stays at about 20 ms, so a stall can use about 480 ms of the threshold, and T-RW12 gets about 35 ticks per wait.
- Do not change any assertion, step text, tag or scenario.
- Runtime check:
  - The feature has 34 real waits (§2: 3 + 3 + 6 + 12; §3: 2 × 2 + 1 + 2; §4: 3 × 1). Its time goes from about 7 s to about 24 s per leg.
  - The longest When step (12 waits) takes about 8.4 s, well within `setDefaultTimeout(60_000)`.

### 4. Update the design notes that state the old timing
- `features/regression/vocabulary.md`, T-RW13: replace "with a threshold of six test heartbeat ticks" so the cell reads equivalent to: "…run at the end of each wait — after a `setImmediate` yield, so any overdue heartbeat tick has written first — over the real top-level state and real process liveness with a 500 ms threshold (far above the 20 ms test heartbeat, below the wait's 700 ms real suspension), did not report the adwId". It is a table cell, so it must contain no `|`.
- `features/regression/rate-limit/feature-912.feature`, narrative bullet "the hung-orchestrator detector did not report adwId X at the end of any wait" (lines 204-209):
  - Replace the sentence "Scale the threshold to the test heartbeat the way production does (a 30 s heartbeat against a 180 s threshold, so six ticks)." with guidance equivalent to: yield to `setImmediate` before the call, because after a stalled event loop the wait's timer can fire ahead of an overdue heartbeat tick; size the threshold in real time, not in heartbeat ticks (production's 30 s against 180 s is six ticks, but a stall is absolute), far enough above the test heartbeat that no single stall outlasts it, for example 500 ms against a 20 ms heartbeat.
  - Keep "Keep each wait suspended for longer than the threshold, so that a stopped heartbeat WOULD be reported."
  - Edit description text only. Keep the existing indentation and `–` bullet layout, and do not let any re-wrapped line start with a Gherkin keyword (`Given`, `When`, `Then`, `And`, `But`, `*`, `Scenario`, `Example`, `Examples`, `Background`, `Rule`) or with `|`, `@`, `#` or `"""`. Such a line breaks parsing of the feature.
- `app_docs/feature-9gjajh-bdd-regression-suite.md` line 116: replace "each wait suspends 200 ms of real time, so the feature takes about 7 s." with text equivalent to "each wait suspends 700 ms of real time, longer than the detector's 500 ms threshold, and yields to `setImmediate` before the detector runs, so the feature takes about 24 s."

### 5. Prove the fix against the forced stall (temporary, never committed)
- Re-apply the Steps to Reproduce B `// TEMP-REPRO` stall line on top of the fix, immediately before the wait's `setTimeout`. Its `WAIT_SUSPEND_REAL_MS - 1` now evaluates to 699 ms.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-in-process-wait" --name "keeps its heartbeat"` with the stall at 150 ms, then again with the stall at 1000 ms. Both must pass, which shows the ordering race is gone whatever the stall length.
- Remove the TEMP-REPRO line by hand. Do **not** `git checkout` the file now, because that would discard the fix.

### 6. Prove the negative control still holds (temporary, never committed)
- In the sleep stub, after the `diedDuringFirstWait` early return and before the wait's `setTimeout`, add:
  ```ts
  if (!o.heartbeat) o.heartbeat = startHeartbeat(o.adwId, TEST_HEARTBEAT_INTERVAL_MS); // TEMP-REPRO
  const stoppedHeartbeat = o.heartbeat; // TEMP-REPRO
  setTimeout(() => { stopHeartbeat(stoppedHeartbeat); o.heartbeat = null; }, 3 * TEST_HEARTBEAT_INTERVAL_MS); // TEMP-REPRO
  ```
  This stops the heartbeat about 60 ms into every wait, after it has advanced `lastSeenAt` at least once, so T-RW12 still passes and T-RW13 is actually evaluated.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-in-process-wait" --name "keeps its heartbeat"`. T-RW13 **must fail** with `Expected adwId wait912-871 not reported hung at the end of wait 1` for both examples, while T-RW11 and T-RW12 pass. At the probe, `lastSeenAt` is about 640 ms old, which exceeds 500 ms, so the detector does report a stopped heartbeat. The scenario is not vacuous.
- Remove the three TEMP-REPRO lines by hand. Then confirm:
  - `grep -n "TEMP-REPRO" features/regression/step_definitions/feature-912.steps.ts` prints nothing;
  - `git diff` shows only the Step 2–4 changes.

### 7. Run the validation commands
- Run every command in `Validation Commands` below. Each must succeed.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `node -e 'let lastSeenAt = Date.now(); const heartbeat = setInterval(() => { lastSeenAt = Date.now(); }, 20); const stall = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} }; async function ageAtProbe(yieldFirst) { setTimeout(() => stall(150), 199); await new Promise((resolve) => setTimeout(resolve, 200)); if (yieldFirst) await new Promise((resolve) => setImmediate(resolve)); return Date.now() - lastSeenAt; } (async () => { console.log("probe right after the timer:", await ageAtProbe(false), "ms"); console.log("probe after setImmediate:   ", await ageAtProbe(true), "ms"); clearInterval(heartbeat); })();'` — the mechanism, before the fix (first line, over 120 ms) and after it (second line, about 0 ms). The scenario-level before and after reproduction is Steps 1 and 5.
- `! grep -n "TEMP-REPRO" features/regression/step_definitions/feature-912.steps.ts` — no temporary reproduction or negative-control code is left behind.
- `bun run lint` — lint passes.
- `bunx tsc --noEmit` — the root type-check passes; it covers `features/**/*.ts`.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional type-check passes.
- `bun run build` — the build passes.
- `bun run test:unit` — unit tests pass. No unit tests change, and no product code changes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-in-process-wait"` — all of feature-912 passes (about 24 s of waits).
- `bash -c 'for i in 1 2 3 4 5; do NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@rate-limit-in-process-wait" --name "keeps its heartbeat" || exit 1; done'` — the outline that flaked passes five times in a row.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1068"` — this issue's per-issue scenarios pass. The scenario agent writes them.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the full regression suite passes on the host.
- `bun run test:docker:build && bash test/docker-run.sh --tags "@regression"` — the full regression suite passes in the Docker leg, the one that flaked. It needs a running Docker daemon.

## Notes
- Strictly follow `.adw/coding_guidelines.md`:
  - The two new comments state an ordering constraint and an invariant. Do not restate the code, do not add section banners and do not cite issue numbers. The file's existing `── §n ──` banners are pre-existing; leave them alone.
  - No `any` and no `!` non-null assertions.
- No new library is needed.
- Scope guard:
  - Do not touch product code (`adws/**`).
  - Do not weaken or remove any assertion.
  - Do not change step phrases, scenarios, tags or Examples tables.
  - Do not tag anything `@host-only`. The Docker leg is the one that exposes the flake.
- The issue estimated a runtime increase of about 1 s; that covers the flaked outline alone. `WAIT_SUSPEND_REAL_MS` applies to all 34 real waits in the feature, so each regression leg grows by about 17 s (about 7 s to about 24 s). That is negligible against the jobs' 30-minute timeouts.
- Docker runtime: the image carries no Node.js, so the Docker leg most likely runs Cucumber on Bun through the image's node-fallback shim. Confirm with `docker run --rm --entrypoint sh adw-bdd-runner:latest -c 'command -v node; node --version'` if needed. The fix holds on both Node and Bun, because each runtime fires all expired timers before it runs `setImmediate` callbacks.
- Acceptance criterion 4 (the `@regression` host **and** Docker jobs pass) is confirmed on CI by the next scheduled `Regression Scenarios` run after merge, or by a manual `workflow_dispatch` with `runtime: docker`.
- The issue is `Blocked by #1069`. Nothing in the repository ties this fix to #1069's content. After #1069 lands, merge the latest base branch, then check that `feature-912.steps.ts` lines 55-57 and 385-418 still match this plan before building.
- The worktree already carried an unrelated `README.md` modification (two device-module lines in the source-tree listing) before planning. It is not part of this fix; leave it as found.
