# Bug: HITL Review→Slack notification dropped (fire-and-forget `notifyReviewTransition` exits before POST lands)

## Metadata
issueNumber: `647`
adwId: `k3x7dc-bug-hitl-review-slac`
issueJson: `{"number":647,"title":"bug: HITL Review→Slack notification dropped (fire-and-forget notifyReviewTransition exits before POST lands)","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-06-20T18:02:45Z"}`

## Bug Description
HITL Slack notifications for the project board **"Review" transition** are silently dropped. When a `hitl`-labelled issue is moved to the board's "Review" column by its `adwSdlc` run, the orchestrator is supposed to post a Slack message (`:eyes: HITL issue #N … → In Review. Approve to merge: <pr-url>`) so a human knows a merge is waiting on their approval.

**Expected:** every `hitl` issue moved to Review reliably produces one Slack message before the orchestrator process exits, and the delivery (success or failure) is visible in `logs/webhook.log`.

**Actual:** issues #612 and #641 (both `hitl`) were moved to Review on 2026-06-19, every notifier gate passed (label present, linked open PR found, `SLACK_WEBHOOK_URL` set, webhook live), yet no Slack message was delivered and there are zero "Slack" lines in the log. Both runs show the identical ~1-second shape between the notification starting and the process exiting, which makes this a structural timing bug rather than two independent Slack-side misses.

## Problem Statement
`moveIssueToStatus` dispatches the Review notification as an un-awaited (`void`) promise:

```ts
// adws/github/projectBoardApi.ts:287-289
if (targetStatus.toLowerCase() === 'review') {
  void notifyReviewTransition({ issueNumber, repoInfo }); // orphaned promise — not awaited
}
```

`notifyReviewTransition` runs two synchronous `gh` reads and then `await postSlack(...)`, which initiates a `fetch()` and yields. Because nobody holds that promise, the orchestrator continues, `main()` returns, and the process tears down before the detached `fetch` settles. The blocking `gh exec` of the immediately-following Proof-Publish phase starves the event loop for ~1s, then teardown wins the race. The POST never lands.

A secondary problem: `postSlack` logs nothing on success, so "did the HITL ping go out?" is unanswerable from the log — the failure was only detectable by its absence.

## Solution Statement
1. **Await the notification (the fix).** Change `void notifyReviewTransition(...)` to `await notifyReviewTransition(...)` in `moveIssueToStatus`. The entire caller chain above this point already awaits (`prPhase`/`prReviewPhase` → `issueTracker.moveToStatus` → `moveIssueToStatus`), so awaiting here propagates the wait all the way up to the orchestrator's `main()`, guaranteeing the Slack POST settles before the process can exit.
2. **Add a delivery signal.** Add a one-line success log to `postSlack` so a delivered notification is observable in the log (the existing code only `warn`s on failure).
3. **Codify `.env` loading at the webhook entrypoint (defensive only).** Add an explicit `import '../core/environment';` at the top of `trigger_webhook.ts`. See **Root Cause Analysis → Fix #3** — the bug report's premise (that the webhook never loads `.env`) is **empirically false**; `.env` is already loaded transitively via the `../core` import chain. This change is belt-and-suspenders documentation of an existing contract, not a behavior fix, and is included to honor the reported scope and the codebase's "codify implicit contracts at chokepoints" principle.

## Steps to Reproduce
1. Configure an environment with `SLACK_WEBHOOK_URL` set and a GitHub Project board with a "Review"/"In Review" status.
2. Open an issue, add the `hitl` label **before** the PR opens, and let `adwSdlc` run it to the point where it opens a PR and moves the issue to "Review".
3. Observe: the board transition is logged (`Moved issue #N to "In Review" …`) but no Slack message arrives and `logs/webhook.log` contains no "Slack" line.

Deterministic unit-level reproduction (added by this plan):
- Before the fix, the new `adws/github/__tests__/projectBoardApi.test.ts` await-ordering test is **RED** (the notifier's post-`await` completion flag is still `false` when `moveIssueToStatus` resolves, because the promise was `void`-discarded).
- The new `postSlack` success-log assertion in `adws/core/__tests__/slackNotifier.test.ts` is **RED** before the fix (no delivery log emitted on a 2xx response).

## Root Cause Analysis

### Fix #1 — the actual root cause (verified call chain)
The Review transition is reached through two call sites, **both already awaited**:
- `adws/phases/prPhase.ts:92` — `await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.Review)`
- `adws/phases/prReviewPhase.ts:346` — `await repoContext.issueTracker.moveToStatus(config.base.issueNumber, BoardStatus.Review)`

These resolve through `adws/providers/github/githubIssueTracker.ts:65-66` (`async moveToStatus(...) { return moveIssueToStatus(...); }`, returning the promise) into `moveIssueToStatus`. The **only** broken link is line 288, where the notification promise is `void`-discarded instead of awaited. Changing `void` → `await` makes the whole chain hold until `postSlack` settles, so the orchestrator's `main()` cannot return early. This is precise and complete — no other Review-transition path exists.

`notifyBlockedTransition` (the sibling notifier) is **not affected**: all three of its call sites already await it (`adws/adwMerge.tsx:163`, `adws/phases/prReviewCompletion.ts:91`, `adws/phases/workflowCompletion.ts:229`). Only `notifyReviewTransition` at `projectBoardApi.ts:288` is fire-and-forget.

**GH_TOKEN / PAT-fallback nuance (intentional, harmless):** `moveIssueToStatus` may set `process.env.GH_TOKEN = GITHUB_PAT` for Projects V2 access and restore it in a `finally` block. With `await` placed inside the `try` (the minimal change), the notifier's two `gh` reads now run under `GITHUB_PAT` instead of under the original token (previously the `void` promise resolved *after* the `finally` restored the token). This is safe because: (a) both are valid GitHub tokens for read-only `gh issue view` / `gh pr list` calls (a classic PAT with `project` scope also carries `repo` read scope); (b) the Review transition runs only inside the **sequential, single-issue orchestrator** (`prPhase`/`prReviewPhase`) where there is no concurrent token-mutating operation, so this does **not** reintroduce the `GH_TOKEN` bleed class seen in the cron-resume and webhook-concurrency paths; (c) the token is still correctly restored in `finally`. This is called out so review does not misflag it as a regression.

### Fix #2 — observability gap
`adws/core/slackNotifier.ts:28-40` only logs on `!res.ok` or on a thrown error. A successful delivery is silent, so the dropped POST left no positive or negative trace. Adding a success log makes delivery answerable from the log and directly satisfies the acceptance criterion "delivery success/failure is observable."

### Fix #3 — the bug report's third claim is incorrect (`.env` IS already loaded)
The report claims the webhook (`node` via `npm exec tsx`) never loads `.env`, so any `postSlack` called directly from the webhook process silently no-ops. **This was tested and disproven.**

`adws/triggers/trigger_webhook.ts:12` imports `{ log, …, assertCwdIsRepoRoot }` from `'../core'`. The barrel `adws/core/index.ts` re-exports from `./config`, which (lines 14-39) re-exports `assertCwdIsRepoRoot`/`REPO_ROOT`/`GITHUB_PAT`/… from `./environment`. `adws/core/environment.ts:42` runs `dotenv.config()` as a top-level side effect. Therefore importing `../core` evaluates `environment.ts` and loads `.env` — independent of runtime (node or bun) and regardless of which named exports are used.

Empirical proof (run under `node --import tsx`, i.e. exactly the webhook's claimed runtime, with `SLACK_WEBHOOK_URL` unset in the ambient env):

```
PROBE before: undefined
PROBE after : <set, len=81>
PROBE .env-loaded-by-core-import: true
```

So the reported "silently no-ops" symptom does not occur, and Fix #3 is **not** the cause of the dropped HITL Review notification (Fix #1 is). The explicit `import '../core/environment';` added by this plan is therefore defensive documentation only: it makes the env-load contract explicit at the entrypoint and robust against a hypothetical future refactor, with a comment stating it is redundant-but-intentional. No automated test is added for it (a top-level `dotenv.config()` side effect depends on a real `.env` on disk and is not meaningfully unit-testable); the probe above is the validation.

## Relevant Files
Use these files to fix the bug:

- `adws/github/projectBoardApi.ts` — **(edit, Fix #1)** `moveIssueToStatus`; line 288 `void notifyReviewTransition(...)` → `await`. The single root-cause change.
- `adws/core/slackNotifier.ts` — **(edit, Fix #2)** `postSlack`; add a success delivery log alongside the existing failure `warn`.
- `adws/triggers/trigger_webhook.ts` — **(edit, Fix #3, defensive)** add an explicit `import '../core/environment';` at the top with an explanatory comment.
- `adws/github/hitlBoardNotifier.ts` — **(no change; context only)** `notifyReviewTransition` already correctly `await`s `postSlack`; the bug is entirely in its caller. Listed because the issue names it as an affected file.
- `adws/providers/github/githubIssueTracker.ts` — **(no change; context only)** `moveToStatus` returns the `moveIssueToStatus` promise; confirms the caller chain awaits.
- `adws/phases/prPhase.ts` / `adws/phases/prReviewPhase.ts` — **(no change; context only)** the two Review-transition call sites; both already `await moveToStatus`. Confirms Fix #1 propagates to `main()`.
- `adws/core/environment.ts` / `adws/core/config.ts` / `adws/core/index.ts` — **(no change; context only)** the `../core` → `config` → `environment` → `dotenv.config()` chain that already loads `.env` (Fix #3 evidence).

### New Files
- `adws/github/__tests__/projectBoardApi.test.ts` — new vitest unit test proving `moveIssueToStatus` **awaits** `notifyReviewTransition` for a Review transition (RED before Fix #1, GREEN after) and does **not** call it for a non-Review target.

### Conditional / Living Documentation (read; update if behavior/contract changes)
Per `.adw/conditional_docs.md`, the touched files map to:
- `app_docs/feature-9gjajh-github-api.md` — owns `adws/github/**` (covers `projectBoardApi.ts`, `hitlBoardNotifier.ts`).
- `app_docs/feature-9gjajh-slack-and-logging.md` — owns `adws/core/slackNotifier.ts` and `adws/core/__tests__/slackNotifier.test.ts`.
- `app_docs/feature-9gjajh-webhook-triggers.md` — owns `adws/triggers/trigger_webhook.ts`.
- `app_docs/feature-9gjajh-specs-and-prd.md` — owns `specs/**` (this plan).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Fix #1 — await the Review notification in `moveIssueToStatus`
- In `adws/github/projectBoardApi.ts`, in `moveIssueToStatus`, replace the fire-and-forget dispatch:
  ```ts
  if (targetStatus.toLowerCase() === 'review') {
    void notifyReviewTransition({ issueNumber, repoInfo });
  }
  ```
  with an awaited call:
  ```ts
  if (targetStatus.toLowerCase() === 'review') {
    // Await delivery so the orchestrator process cannot exit before the Slack
    // POST settles (issue #647: the void-dispatched fetch was torn down on exit).
    await notifyReviewTransition({ issueNumber, repoInfo });
  }
  ```
- Do not change the function signature, the `try/finally` token-restore structure, or any other call site. `moveIssueToStatus` is already `async`, and `notifyReviewTransition` is no-throw at its boundary, so the existing `catch`/`finally` semantics are preserved.

### 2. Fix #2 — add a success delivery log to `postSlack`
- In `adws/core/slackNotifier.ts`, update the `try` block of `postSlack` to log on success, using a guard clause to keep nesting flat:
  ```ts
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log(`Slack notification returned HTTP ${res.status}`, 'warn');
      return;
    }
    log(`Slack notification delivered (HTTP ${res.status})`, 'info');
  } catch (err) {
    log(`Slack notification failed: ${err}`, 'warn');
  }
  ```
- Keep the existing "`SLACK_WEBHOOK_URL` not set; skipping" early-return `warn` untouched.

### 3. Fix #3 — make `.env` loading explicit at the webhook entrypoint (defensive)
- In `adws/triggers/trigger_webhook.ts`, add an explicit side-effect import as the **first** import (immediately after the shebang/JSDoc block, before `import * as http from 'http'`):
  ```ts
  // Load .env explicitly at the entrypoint so secrets (SLACK_WEBHOOK_URL, …) are
  // present regardless of runtime (node vs bun) or import ordering. Note: `.env`
  // is already loaded transitively via the `../core` import below
  // (config.ts → environment.ts → dotenv.config()); this line codifies that
  // implicit contract at the entrypoint (issue #647, fix #3 — defensive only).
  import '../core/environment';
  ```
- Make no other change to the webhook server logic.

### 4. Add the await-ordering regression test (`projectBoardApi.test.ts`)
- Create `adws/github/__tests__/projectBoardApi.test.ts`.
- Mock the module's I/O boundaries so the move "succeeds" deterministically and the notifier is observable:
  - `vi.mock('child_process', () => ({ execSync: vi.fn() }))` and stub four sequenced return values for the four internal `gh` GraphQL calls, in order:
    1. find project: `'{"data":{"repository":{"projectsV2":{"nodes":[{"id":"PVT_1"}]}}}}'`
    2. find issue item (current status deliberately **not** Review): `'{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"ITEM_1","project":{"id":"PVT_1"},"fieldValueByName":{"name":"In Progress"}}]}}}}}'`
    3. status field options (includes an "In Review" option): `'{"data":{"node":{"field":{"id":"FIELD_1","options":[{"id":"OPT_REVIEW","name":"In Review"},{"id":"OPT_PROG","name":"In Progress"}]}}}}'`
    4. update mutation: `'{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"ITEM_1"}}}}'`
  - `vi.mock('../githubAppAuth', () => ({ isGitHubAppConfigured: () => false, refreshTokenIfNeeded: () => undefined }))` so the PAT-fallback branch is skipped and `GH_TOKEN` is untouched (deterministic regardless of ambient app env).
  - `vi.mock('../hitlBoardNotifier', () => ({ notifyReviewTransition: vi.fn() }))`.
- Test "awaits the Review notification before resolving":
  - Configure the mocked `notifyReviewTransition` to flip a flag after a yield: `mockImplementation(async () => { await new Promise((r) => setTimeout(r, 5)); completed = true; })`.
  - `const ok = await moveIssueToStatus(123, 'Review', { owner: 'acme', repo: 'r' });`
  - Assert `ok === true`, `notifyReviewTransition` was called once, and `completed === true` (this is the RED→GREEN assertion: `false` when the call is `void`-discarded, `true` once awaited).
- Test "does not notify for a non-Review target":
  - Re-stub the four execSync values with a non-Review `targetStatus` (e.g. `'In Progress'`), call `await moveIssueToStatus(123, 'In Progress', …)`, assert `notifyReviewTransition` was **not** called.
- Reset mocks between tests (`beforeEach(() => vi.clearAllMocks())`).

### 5. Extend `slackNotifier.test.ts` for the delivery log (Fix #2)
- In `adws/core/__tests__/slackNotifier.test.ts`, add `vi.mock('../logger', () => ({ log: vi.fn() }))` at the top of the file and import the mocked `log` (`import { log } from '../logger'`). The existing fetch-based assertions are unaffected (they do not assert on `log`).
- Add a `describe('postSlack')` block importing `postSlack` directly and covering:
  - **Success:** `SLACK_WEBHOOK_URL` set, fetch resolves `{ ok: true, status: 200 }` → asserts `log` was called with a message containing `delivered` at level `'info'` (RED before Fix #2).
  - **Non-2xx:** fetch resolves `{ ok: false, status: 400 }` → asserts a `warn` containing `HTTP 400` and **no** delivery/`info` log.
  - **Thrown fetch:** fetch rejects → asserts a `warn` containing `failed` and resolves without throwing.
  - **Unset URL:** `delete process.env.SLACK_WEBHOOK_URL` → asserts the skip `warn` and that `fetch` is not called.

### 6. (Optional) per-issue BDD scenario
- This bug is a low-level async/observability fix in pure `adws/` modules; the authoritative validation is the vitest unit tests above. If the SDLC scenario phase generates a per-issue scenario, place it at `features/per-issue/feature-647.feature` tagged `@adw-647`, asserting "a `hitl` issue moved to Review delivers exactly one Slack message and logs a delivery line." Do not add it to the executed regression suite.

### 7. Run all validation commands
- Run every command in **Validation Commands** and confirm each exits cleanly with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Run from the repo root.

- `bun run lint` — ESLint; no new violations (per `.adw/commands.md`).
- `bunx tsc --noEmit` — root type check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check passes (additional check from `.adw/commands.md`).
- `bun run build` — `tsc` build succeeds.
- `bunx vitest run adws/github/__tests__/projectBoardApi.test.ts adws/core/__tests__/slackNotifier.test.ts adws/github/__tests__/hitlBoardNotifier.test.ts` — the new/edited tests pass (focused reproduction: these are RED before the fix, GREEN after).
- `bun run test:unit` — full vitest suite passes with zero regressions (`vitest run`).
- Fix #3 evidence (optional, manual; confirms `.env` already loads under the webhook's `node`+`tsx` runtime — expect `PROBE after` to be `<set …>`):
  ```bash
  cat > ./__env_probe.mjs <<'EOF'
  async function main() {
    const before = process.env.SLACK_WEBHOOK_URL;
    await import('./adws/core/index.ts');
    const after = process.env.SLACK_WEBHOOK_URL;
    console.log('PROBE before:', JSON.stringify(before));
    console.log('PROBE after :', after ? '<set, len=' + after.length + '>' : JSON.stringify(after));
  }
  main();
  EOF
  env -u SLACK_WEBHOOK_URL node --import tsx ./__env_probe.mjs; rm -f ./__env_probe.mjs
  ```

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) apply: the `postSlack` change uses a guard clause (`if (!res.ok) { …; return; }`) to keep nesting ≤2; no decorators; immutable/explicit style preserved; `async`/`await` over `.then()`. No new dependencies — `dotenv` is already in `package.json`.
- **Surgical scope:** Fix #1 is a single-word change (`void` → `await`) at `projectBoardApi.ts:288`; it is the complete fix for the reported drop because every caller above already awaits. Fixes #2 and #3 are additive (a log line and a documented side-effect import) and change no control flow.
- **Fix #3 is defensive, not causal.** The bug report's claim that the webhook never loads `.env` is empirically false (proof in Root Cause Analysis → Fix #3). The explicit import is included to honor the reported scope and codify the existing contract; a reviewer may drop it without affecting the HITL Review fix. It is called out so it is not mistaken for the cause.
- **GH_TOKEN window:** awaiting inside `moveIssueToStatus`'s `try` runs the notifier's `gh` reads under the PAT-fallback token; this is harmless in the sequential orchestrator context (see Root Cause Analysis → Fix #1) and is flagged here to preempt a false-positive review finding. If review prefers the notifier to run under the original token, an acceptable alternative is to capture a `movedToReview` boolean inside the `try` and `await notifyReviewTransition(...)` after the `try/finally` returns — but the minimal `void` → `await` change is recommended.
- **Acceptance mapping:** "reliably produces a Slack message before the orchestrator exits" → Fix #1 + test #4; "delivery success/failure observable in the log" → Fix #2 + test #5; "`postSlack` works when invoked from the webhook (`node`) process" → already true (Fix #3 proof), made explicit by the entrypoint import.
