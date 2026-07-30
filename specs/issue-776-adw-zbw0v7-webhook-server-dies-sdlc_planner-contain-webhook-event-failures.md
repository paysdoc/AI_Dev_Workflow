# Bug: Webhook server dies on any unhandled per-event exception — one bad event takes the trigger down

## Metadata
issueNumber: `776`
adwId: `zbw0v7-webhook-server-dies`
issueJson: `{"number":776,"title":"Webhook server dies on any unhandled per-event exception — one bad event takes the trigger down","body":"# Webhook server dies on any unhandled per-event exception — one bad event takes the trigger down\n\n## Symptom\n\nOn 2026-07-30 between 11:00Z and 11:22Z, every `issue_comment` delivery to the webhook returned **502**. The first Cancel directive on `paysdoc/paysdoc.nl#28` threw inside the event handler, the exception was uncaught, and the Node process exited:\n\n```\nError: Failed to fetch comments for issue #28: Error: spawnSync /bin/sh ENOENT\n    at fetchIssueCommentsRest (adws/github/issueApi.ts:235)\n    at IncomingMessage.<anonymous> (adws/triggers/trigger_webhook.ts)\n[1]  + exit 1     nohup npx tsx ...\n```\n\nGitHub's delivery log for the hook shows the blast radius: last 200 at 10:59:36Z, then six consecutive 502s (11:00, 11:01, 11:06, 11:14, 11:16, 11:22) — each retry either hit the dead server or killed a freshly restarted instance the same way. The trigger was down for the whole window and the directive was never processed.\n\n## Root cause\n\nThe entire event dispatch in `trigger_webhook.ts` runs synchronously inside the `req.on('end', ...)` callback with no try/catch. Any synchronous throw (here: `fetchIssueCommentsRest` rethrowing a spawn failure) is an uncaught exception at the top of the event loop, which terminates the process.\n\nThe underlying spawn failure has its own issue (#775); this issue is about the missing resilience boundary. Any future per-event bug reproduces the same outage.\n\n## Desired behavior\n\n- Wrap per-event processing in a try/catch (and catch rejections in the async `.then` branches, e.g. the `isAdwRunningForIssue` chain).\n- On failure: log the error with event type + repo + issue number, send a Slack alert via the existing `slackNotifier`, respond 500 to GitHub (so the delivery log shows a real failure), and keep serving.\n- A crashing event handler must never terminate the webhook server process.\n\n## Relevant files\n\n- `adws/triggers/trigger_webhook.ts` — `req.on('end')` handler and async continuation branches\n- `adws/core/slackNotifier.ts` — existing alerting channel\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-07-30T11:31:45Z","comments":[],"actionableComment":null}`

## Bug Description
The ADW webhook trigger (`adws/triggers/trigger_webhook.ts`) dispatches every GitHub delivery synchronously inside the `req.on('end', …)` callback of its `http.createServer` handler. That callback has **no try/catch**. A synchronous throw anywhere in the ~190-line dispatch is therefore an uncaught exception raised from a Node event emitter, which terminates the process.

On 2026-07-30 a `## Cancel` directive on `paysdoc/paysdoc.nl#28` hit that path: `fetchIssueCommentsRest` (called synchronously and unguarded at `adws/triggers/trigger_webhook.ts:198`) rethrew a wrapped spawn failure, and the webhook server exited. GitHub's delivery log records the blast radius — a last `200` at 10:59:36Z, then six consecutive `502`s (11:00, 11:01, 11:06, 11:14, 11:16, 11:22). Each retry either hit the dead port or killed a freshly restarted instance the same way. The trigger was down for 22 minutes and the directive was never processed.

**Expected behaviour:** a failing event handler is contained — the delivery is answered `500` (so GitHub's delivery log shows an honest failure and the redelivery is meaningful), the failure is logged and Slack-alerted with enough identity to act on (event type, repo, issue number), and the server keeps serving subsequent deliveries.

**Actual behaviour:** the connection is dropped with **no response at all** (`curl: (52) Empty reply from server`; the Cloudflare tunnel turns that into the observed `502`), and the process is gone. Every subsequent delivery fails until a human notices and restarts the server.

Reproduced end-to-end in this worktree against the real entrypoint (see *Steps to Reproduce*), producing the incident's exact stack shape:

```
Error: Failed to fetch comments for issue #28: Error: resolveContextToken: no veracious token for paysdoc/webhook-776-repro
    at fetchIssueCommentsRest (adws/github/issueApi.ts:235:11)
    at IncomingMessage.<anonymous> (adws/triggers/trigger_webhook.ts:198:13)
    at IncomingMessage.emit (node:events:509:20)
    ...
Node.js v26.5.0
```

## Problem Statement
`trigger_webhook.ts` has no resilience boundary around per-event work, so the reliability of a long-running daemon is coupled to the correctness of every function it calls on the request path. The unguarded synchronous calls in the dispatch include `ensureCronProcess`, `fetchIssueCommentsRest` (twice), `handleCancelDirective`, `handleRetryDirective`, `getRepoInfo`, `resolvePrReviewSpawn`, `spawnDetached`, `readAuthGate` and `jsonResponse` — any one of them throwing kills the trigger for the whole host.

Two secondary gaps belong to the same failure class:

1. **Reporting.** The three async continuations on the request path (`isAdwRunningForIssue(…).then(…)`, `handlePullRequestEvent(…)`, `handleIssueClosedEvent(…)`) already carry a `.catch`, so they do not kill the process — but they only `log`. An async failure is invisible to an operator who is not tailing `logs/webhook.log`, and the log lines do not carry the repo (only the issue number), so on a multi-target host you cannot tell which repository lost an event.
2. **The `/health` continuation.** The `GET /health` handler runs `void (async () => { … })()` with **no** `.catch` (`trigger_webhook.ts:88-108`). A throw from any of the five sync probes inside it (`checkGitRepository`, `checkGitHubCLI`, …) becomes an unhandled rejection, which under Node's default `--unhandled-rejections=throw` also terminates the process. Same outage, different door.

Nothing in the codebase installs a `process.on('uncaughtException')` net, so there is no second line of defence (verified: `grep -rn "uncaughtException\|unhandledRejection" adws/` returns nothing).

## Solution Statement
Add one per-event resilience boundary plus one reporting channel, and route every failure path on the request handler through them.

1. **New module `adws/triggers/webhookEventBoundary.ts`** — small, pure-where-possible, unit-testable, no `http` types:
   - `describeWebhookEvent(event, body)` → `WebhookEventContext { event, repo, issueNumber, prNumber }`, defensively extracted from the raw payload (`x-github-event` header, `body.repository.full_name`, `body.issue.number`, `body.pull_request.number`), each falling back to `'unknown'` / `null`.
   - `safeParseWebhookBody(rawBody)` → parsed object or `undefined`, never throws.
   - `formatWebhookFailureLog(context, error)` and `formatWebhookFailureAlert(context, error)` — pure string builders that both name the event type, the `owner/repo` and the issue number.
   - `reportWebhookEventFailure(context, error, deps?)` — logs at level `'error'` and fires a **best-effort, never-awaited** Slack alert through the existing `postSlack` (`adws/core/slackNotifier.ts`). Contractually never throws, even if the logger or the notifier does.
2. **Extract the dispatch.** Move the body of the `req.on('end', …)` callback verbatim into a top-level named function `dispatchWebhookEvent(req, res, rawBody)` in the same file, so the callback shrinks to a try/catch that calls it. This keeps the indentation of 190 lines flat instead of wrapping them one level deeper (`.adw/coding_guidelines.md` — max depth ~2, extract instead of nest), and keeps every `if (event === …)` branch inside `trigger_webhook.ts`.
3. **Contain synchronous failures.** The `catch` calls a local `containEventFailure(error, res, rawBody, event)` which reports the failure and then answers `500` — guarded by `if (res.headersSent) return;` so a throw that happens *after* a response was already flushed cannot produce an `ERR_HTTP_HEADERS_SENT` secondary crash, and guarded by its own try/catch so a failing `res.end()` cannot escape either.
4. **Report async failures.** Wire `reportWebhookEventFailure` into the four existing async catch sites (the `isAdwRunningForIssue` chain, `handlePullRequestEvent`, `handleIssueClosedEvent`, and the `issues.opened` IIFE's internal catch, whose `AuthRequiredError` early-return is preserved). No `500` is attempted there: those deliveries were already answered `200 processing` before the continuation ran, and a response cannot be retracted.
5. **Close the `/health` door.** Add a `.catch` to the health-probe IIFE that logs and answers `500` when headers have not been sent.

Answers that are already correct must survive untouched: unparseable JSON still returns `400`, an invalid signature still returns `401`, and an ignored event still returns `200` — the boundary only fires on a *throw*, so none of those paths reach it (pinned by `features/per-issue/feature-776.feature` §4). No `process.on('uncaughtException')` handler is added — see *Notes*.

## Steps to Reproduce
Verified in this worktree on 2026-07-30. The recipe is hermetic (no network, no real credentials, no interference with the live trigger) and is the same shape the `@adw-776` step definitions need.

1. Build a `gh` stub that always fails, so `ghAuthToken()` yields nothing:
   ```bash
   mkdir -p /tmp/repro776/bin && printf '#!/bin/sh\nexit 1\n' > /tmp/repro776/bin/gh && chmod +x /tmp/repro776/bin/gh
   ```
2. Write the delivery payload. **`repository.clone_url` (or `html_url`) is mandatory** — `resolveWebhookRepo` returns `null` without it, and then the `## Cancel` branch never calls the throwing fetch and the reproduction goes vacuous:
   ```bash
   cat > /tmp/repro776/payload.json <<'EOF'
   {"action":"created","issue":{"number":28,"body":"repro"},"comment":{"body":"## Cancel"},"repository":{"full_name":"paysdoc/webhook-776-repro","clone_url":"https://github.com/paysdoc/webhook-776-repro.git"}}
   EOF
   ```
3. Stop `ensureCronProcess` from detach-spawning a real cron by pre-seeding a PID record it will treat as live (`isCronAliveForRepo` → `isProcessAlive`), using a throwaway repo name no real run uses:
   ```bash
   nohup sleep 300 >/dev/null 2>&1 & SLEEPER=$!
   mkdir -p agents/cron
   printf '{"pid":%s,"repoKey":"paysdoc/webhook-776-repro","startedAt":"2026-07-30T00:00:00.000Z"}\n' "$SLEEPER" \
     > agents/cron/paysdoc_webhook-776-repro.json
   ```
4. Start the **real** entrypoint from the repo root (`assertCwdIsRepoRoot` exits otherwise) on a spare port, with credentials emptied. They must be **present-but-empty**, not absent: `adws/core/environment` runs `dotenv.config()`, and dotenv does not overwrite keys already in `process.env`. `SLACK_WEBHOOK_URL=` empty is mandatory so the run cannot post to the real Slack channel; `GITHUB_WEBHOOK_SECRET=` empty disables signature validation so an unsigned `curl` is accepted:
   ```bash
   env PORT=9777 GITHUB_WEBHOOK_SECRET= SLACK_WEBHOOK_URL= GITHUB_PAT= GITHUB_APP_ID= GITHUB_APP_SLUG= \
       GITHUB_APP_PRIVATE_KEY_PATH= GH_TOKEN= PATH="/tmp/repro776/bin:$PATH" \
     nohup bunx tsx adws/triggers/trigger_webhook.ts > /tmp/repro776/webhook.log 2>&1 &
   ```
   Wait for `Webhook server listening on 0.0.0.0:9777` in the log.
5. Send the delivery:
   ```bash
   curl -sS -m 10 -X POST http://127.0.0.1:9777/webhook \
     -H 'content-type: application/json' -H 'x-github-event: issue_comment' \
     --data-binary @/tmp/repro776/payload.json -o /dev/null -w 'http_code=%{http_code}\n'
   ```
6. Observe the bug:
   - `curl: (52) Empty reply from server`, `http_code=000` — no response at all (the tunnel renders this as the incident's `502`).
   - The process is gone: `lsof -nP -iTCP:9777` is empty. (Do **not** use `pgrep -f trigger_webhook` — it also matches the live server running from the main checkout.)
   - `/tmp/repro776/webhook.log` ends with the fatal `Error: Failed to fetch comments for issue #28: … at IncomingMessage.<anonymous> (adws/triggers/trigger_webhook.ts:198:13)` and `Node.js v26.5.0`.
7. Clean up: `kill "$SLEEPER"`, delete `agents/cron/paysdoc_webhook-776-repro.json` and `/tmp/repro776/`. Confirm the live webhook is untouched: `lsof -nP -iTCP:8001 -sTCP:LISTEN` still shows a listener.

**After the fix**, step 5 must return `http_code=500`, the log must carry a `Webhook event handler failed [event=issue_comment repo=paysdoc/webhook-776-repro issue=#28]: …` line, the listener on 9777 must still be there, and a repeat of step 5 must return `500` again rather than a dropped connection.

Isolated confirmation of the mechanism (no ADW code involved) — a 6-line server that throws inside `req.on('end')` reproduces `curl: (52)` plus process death with the identical `at IncomingMessage.<anonymous> … endReadableNT` frame shape, so the failure is structural to the callback and not specific to `fetchIssueCommentsRest`.

## Root Cause Analysis
**A long-running daemon with no boundary between "one event failed" and "the process is invalid".**

- `trigger_webhook.ts:116-302` is one `req.on('end', () => { … })` callback holding the whole dispatch: signature check, JSON parse, repo resolution, per-event `GitContext` construction, `ensureCronProcess`, and five event branches. Only two operations inside it are individually guarded — `JSON.parse` (`:124`) and `buildLaunchGitContext` (`:138-142`). Everything else can throw straight out of the callback.
- A throw from an `EventEmitter` listener is not routed to the HTTP server's `'error'` event; it propagates as an uncaught exception. With no `process.on('uncaughtException')` listener anywhere in the codebase, Node prints the stack and exits non-zero — the socket is closed without a response, and the port is released. Verified above.
- The incident's specific thrower is `fetchIssueCommentsRest` (`adws/github/issueApi.ts:224-237`), which wraps *every* failure — `catch (error) { throw new Error(\`Failed to fetch comments for issue #${issueNumber}: ${error}\`) }` — and is called synchronously from both the `## Cancel` (`:197-199`) and `## Retry` (`:205`) branches. Its inner failure was `spawnSync /bin/sh ENOENT`, the wrong-base-repo/missing-cwd signature tracked separately as #775. Under the harness the same call throws `resolveContextToken: no veracious token for …` — a different inner cause, the identical outer shape, which is exactly the point: **the boundary is the fix, not the particular thrower.**
- The absence is historical rather than deliberate. Every *async* continuation on this path acquired a `.catch` as its own incident was fixed (`Cron will retry.`, `Error handling PR close`, `Issue close handler failed`), and `webhookHandlers.ts`/`webhookGatekeeper.ts` are internally defensive. The synchronous trunk was never audited as a whole, so directive handling — the one branch that does synchronous `gh` I/O before responding — was left as the single unguarded reach into the network on the request path.
- Why it stayed invisible until now: the crash is only reachable when a synchronous request-path call fails, which needs a broken environment (missing token, missing cwd, missing `/bin/sh`). Under healthy credentials every one of these calls succeeds, so no test, scenario, or review pass ever exercised the path. There is no coverage of `trigger_webhook.ts` behaviour at all today — its only tests (`adws/__tests__/triggerWebhook.test.ts`) read the file as **text** and assert on substrings, and the one BDD feature that targets it (`features/webhook_ensure_cron_on_every_event.feature`) is stranded outside the `cucumber.js` `paths:` globs and has not run since those globs were narrowed to `features/regression/**` + `features/per-issue/**` (verified: `--tags "@adw-501"` collects **0 scenarios**, and two of its `@regression` steps have already rotted — they grep for `ensureAppAuthForRepo(`, deleted by the GitContext migration).

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/trigger_webhook.ts` — **the primary edit.** The `req.on('end', …)` callback (`:116-302`) becomes a try/catch around an extracted `dispatchWebhookEvent`; the four async catch sites (`:234-236` comment chain, `:243` PR close, `:262` issue closed, `:289-296` `issues.opened` IIFE) gain reporting; the `/health` IIFE (`:88-108`) gains a `.catch`. `jsonResponse` (`:63-67`) is the existing responder and is reused unchanged — note it already logs `HTTP <status>: <body>` at `'error'` for any status ≥ 400, so the `500` is self-logging in addition to the boundary's own line.
- `adws/core/slackNotifier.ts` — **read-only.** `postSlack(text)` is the alerting channel named by the issue. Already no-throw at the boundary (`try/catch` around `fetch`, 10 s `AbortSignal.timeout`, warn-and-return on `!res.ok`, warn-and-return when `SLACK_WEBHOOK_URL` is unset). This is what makes §5 of the acceptance contract satisfiable without extra defence — but the new reporter must still never `await` it, or a black-holed Slack endpoint would delay the `500` by up to 10 s.
- `adws/core/logger.ts` — **read-only.** `log(message, level)` writes to stdout via `console.log` (errors in red). This is why the `@adw-776` step definitions can assert the failure log against the spawned subprocess's captured output (Observability Surface #5).
- `adws/github/issueApi.ts` — **read-only.** `fetchIssueCommentsRest` (`:224-237`) is the incident's thrower and the harness's lever. Do **not** change its throwing contract here: swallowing the error would silently drop `## Cancel` / `## Retry` directives, and the spawn failure itself is #775's scope.
- `adws/triggers/webhookRepoResolver.ts` — **read-only.** `resolveWebhookRepo` needs **both** `full_name` **and** `clone_url`/`html_url`; without the URL it returns `null`, `webhookRepoInfo` is `undefined`, and the Cancel branch substitutes `[]` for the comment fetch and never throws. Any RED reproduction (harness or manual) must carry both fields.
- `adws/triggers/webhookGatekeeper.ts` — **read-only.** `ensureCronProcess` (`:169-192`) is itself unguarded and runs before every per-event branch; it is one of the calls the new boundary now protects. Its `isCronAliveForRepo` short-circuit is the hook the reproduction and the step definitions use to avoid detach-spawning a real cron.
- `adws/triggers/cronProcessGuard.ts` — **read-only.** `getCronPidFilePath` → `agents/cron/<owner>_<repo>.json`; the shape of the PID record the harness pre-seeds.
- `adws/triggers/webhookHandlers.ts` — **read-only.** `handlePullRequestEvent` and `handleIssueClosedEvent` are `async`, so their failures arrive as rejections at the call sites in `trigger_webhook.ts`; only those call sites change.
- `adws/github/workflowCommentsBase.ts` — **read-only.** `isAdwRunningForIssue` is `async` (`:19`), which is why the comment-path chain's survival is already GREEN and only its *reporting* is RED (`features/per-issue/feature-776.feature` §3).
- `adws/core/workflowCommentParsing.ts` — **read-only.** `isCancelComment` / `isRetryComment` / `isActionableComment` (`## Cancel`, `## Retry`, `## Continue`, all case-insensitive, anchored per-line) — the exact comment bodies the scenarios send.
- `adws/__tests__/triggerWebhook.test.ts` — **must be updated.** Its `getOpenedCatchBlock` / `getCommentCatchBlock` helpers slice the source using hard-coded 8-space indentation markers (`'\n        }'`, `'\n        });'`), which the dispatch extraction shifts by two columns. Fix the extraction, keep the assertions.
- `features/per-issue/feature-776.feature` — **the acceptance contract, already authored** (`@adw-776 @adw-zbw0v7-webhook-server-dies`, 15 scenarios in six sections). §1 containment (500 + alive + next delivery served + a 6-delivery retry storm + the `## Retry` twin), §2 reporting (log **and** Slack each naming event type, `paysdoc/paysdoc.nl`, issue 28), §3 the async half (alert is RED; survival is an already-GREEN guard; explicitly **no** 500), §4 non-distortion (400/401/200 keep their answers, no alert), §5 best-effort alerting (no endpoint / unreachable endpoint still 500 + survive), §6 type-check. Every assertion targets a runtime artefact — the fix must not answer it with source-shape changes.
- `features/per-issue/step_definitions/` — the `@adw-776` step definitions do not exist yet; `generate_step_definitions` authors them. The feature's own notes plus the verified recipe in *Steps to Reproduce* are the spec for them.
- `.adw/commands.md` — no change; source of the validation commands.
- `.adw/coding_guidelines.md` — no change; the fix must follow it (try/catch **at system boundaries**, guard clauses over nesting, extract instead of indenting, isolate side effects, no `any`).
- `README.md` — the `document` phase adds the new module to the `adws/triggers/` tree listing and a line to the resilience-primitives bullet.

### New Files
- `adws/triggers/webhookEventBoundary.ts` — the boundary/reporting module described in *Solution Statement* step 1. `adws/triggers/` has no barrel file, so no index registration is needed.
- `adws/triggers/__tests__/webhookEventBoundary.test.ts` — vitest guard for the module. Already covered by `vitest.config.ts`'s `adws/**/__tests__/**/*.test.ts` include, so `bun run test:unit` picks it up with no config change.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Create the boundary module
- Create `adws/triggers/webhookEventBoundary.ts` with a docblock stating its one job: contain and report a per-event failure so the webhook process survives (cite issue #776).
- Import leaf modules directly — `import { log, type LogLevel } from '../core/logger';` and `import { postSlack } from '../core/slackNotifier';` — rather than the `../core` barrel, to keep the module free of the barrel's load-time side effects (`dotenv`, path constants).
- Export:
  ```ts
  export interface WebhookEventContext {
    event: string;              // 'issue_comment' | … | 'unknown'
    repo: string;               // 'owner/repo' | 'unknown'
    issueNumber: number | null;
    prNumber: number | null;
  }
  ```
- `safeParseWebhookBody(rawBody: Buffer): Record<string, unknown> | undefined` — `JSON.parse` in a try/catch, `undefined` on failure, and `undefined` when the parse result is not a non-null object (so `describeWebhookEvent` cannot be handed an array or a bare string).
- `describeWebhookEvent(event: string | undefined, body: Record<string, unknown> | undefined): WebhookEventContext` — pure. `event || 'unknown'`; `repo` from `body.repository.full_name` when it is a non-empty string, else `'unknown'`; `issueNumber` from `body.issue.number`, `prNumber` from `body.pull_request.number`, each `null` when absent or not a number. Read every nested field through optional chaining and a `typeof` check — the boundary must survive a hostile or truncated payload.
- `formatWebhookFailureLog(context: WebhookEventContext, error: unknown): string` — exactly:
  `` `Webhook event handler failed [event=${context.event} repo=${context.repo} issue=${issueLabel}]: ${message}` ``
  where `issueLabel` is `#${context.issueNumber}` when set, else `PR #${context.prNumber}` when set, else `n/a`, and `message` is `error instanceof Error ? error.message : String(error)`.
- `formatWebhookFailureAlert(context: WebhookEventContext, error: unknown): string` — a multi-line Slack message in the style of the existing notifier functions: a `:rotating_light:` heading naming the webhook event failure, then `• event: `, `• repo: `, `• issue: ` (same `issueLabel` rule) and `• error: ` bullets. Make **no** claim about the HTTP response — the same alert is used for the already-answered async paths.
- `export interface WebhookFailureDeps { logger?: (message: string, level?: LogLevel) => void; notify?: (text: string) => Promise<void>; }`
- `reportWebhookEventFailure(context: WebhookEventContext, error: unknown, deps: WebhookFailureDeps = {}): void`:
  - Defaults `logger = log`, `notify = postSlack`.
  - Calls `logger(formatWebhookFailureLog(context, error), 'error')`.
  - Fires the alert without awaiting: `void Promise.resolve(notify(formatWebhookFailureAlert(context, error))).catch((alertError) => logger(\`Webhook failure alert could not be delivered: ${alertError}\`, 'warn'));` — `Promise.resolve(...)` so a notifier that throws *synchronously* still lands in the `.catch` instead of escaping.
  - Wraps the whole body in an outer try/catch whose handler is a single best-effort `console.error` — a reporter that throws would re-create the outage it exists to prevent. Add a one-line comment saying exactly that, so the swallow does not read as sloppiness.
- Keep the module under ~110 lines and free of `http` types, so it is testable without touching the server.

### 2. Extract the dispatch out of the `req.on('end')` callback
- In `adws/triggers/trigger_webhook.ts`, add a top-level function declaration (hoisted, so it may sit directly below `const server = …`):
  ```ts
  /**
   * Dispatches a single webhook delivery. Any throw is contained by the caller's
   * boundary (see containEventFailure) — this function must never be called
   * outside a try/catch.
   */
  function dispatchWebhookEvent(req: http.IncomingMessage, res: http.ServerResponse, rawBody: Buffer): void { … }
  ```
- Move the current callback body into it **verbatim**, minus the `const rawBody = Buffer.concat(chunks);` line (now the parameter) and re-indented two columns left. Do not reorder, rename, or "improve" anything inside — this step must be a pure move, reviewable as such.
- Keep every `if (event === '…')` / `if (action === '…')` branch, the signature check, the `JSON.parse` guard and the `ensureCronProcess` call in this file and in this order. They are load-bearing for the (currently stranded) `features/webhook_ensure_cron_on_every_event.feature` markers and for reviewability.
- Immediately after `const event = req.headers['x-github-event'] as string | undefined;`, add:
  ```ts
  const eventContext = describeWebhookEvent(event, body);
  ```
  and import `describeWebhookEvent`, `reportWebhookEventFailure`, `safeParseWebhookBody` from `./webhookEventBoundary`.

### 3. Add the synchronous containment boundary
- Reduce the callback to:
  ```ts
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    try {
      dispatchWebhookEvent(req, res, rawBody);
    } catch (error) {
      containEventFailure(error, res, rawBody, req.headers['x-github-event'] as string | undefined);
    }
  });
  ```
- Add the local helper alongside `dispatchWebhookEvent`:
  ```ts
  /**
   * Contains a synchronous per-event dispatch failure: reports it, then answers 500
   * so GitHub's delivery log shows a real failure instead of a dropped connection.
   * Never throws — a throw here would kill the server, which is the bug (#776).
   */
  function containEventFailure(error: unknown, res: http.ServerResponse, rawBody: Buffer, event: string | undefined): void {
    const context = describeWebhookEvent(event, safeParseWebhookBody(rawBody));
    reportWebhookEventFailure(context, error);
    if (res.headersSent) return;
    try {
      jsonResponse(res, 500, { error: 'event handler failed', event: context.event, issue: context.issueNumber });
    } catch (responseError) {
      log(`Webhook 500 response could not be sent: ${responseError}`, 'error');
    }
  }
  ```
- The `res.headersSent` guard is mandatory: a throw *after* a branch already called `jsonResponse` would otherwise raise `ERR_HTTP_HEADERS_SENT` from inside the catch and kill the process anyway.
- Re-parsing the body here (rather than threading the parsed object out of the dispatch) is deliberate: it costs one `JSON.parse` on the failure path only, and it keeps the boundary independent of how far the dispatch got before throwing.

### 4. Report the asynchronous failures
- Comment chain (`isAdwRunningForIssue(…).then(…)`): replace the `.catch` body's bare `log(...)` with `reportWebhookEventFailure(eventContext, error)`. Do **not** add a `500` — the `200 processing` was already flushed.
- `handlePullRequestEvent(…).catch(…)` and `handleIssueClosedEvent(…).catch(…)`: same substitution, keeping the existing success-path `.then(…)` logging on the issue-closed call untouched.
- `issues.opened` async IIFE: keep the `AuthRequiredError` branch exactly as it is (write the gate, log at `'warn'`, return), and replace only the trailing generic `log(…, 'error')` with `reportWebhookEventFailure(eventContext, error)`.
- The four bespoke log strings (`Error handling comment on issue #N: … Cron will retry.`, `Error processing issue #N: …`, `Error handling PR close: …`, `Issue close handler failed for #N: …`) are replaced by the uniform reporter line, which is strictly more informative (adds event type and repo). Verified that nothing else depends on them: `grep -rn "Cron will retry\|Error handling PR close\|Issue close handler failed" adws/ features/ test/` matches only `trigger_webhook.ts`.

### 5. Close the `/health` unhandled-rejection door
- Give the health IIFE a terminal `.catch`:
  ```ts
  })().catch((error) => {
    log(`Health check failed: ${error}`, 'error');
    if (!res.headersSent) jsonResponse(res, 500, { error: 'health check failed' });
  });
  ```
  and drop the now-redundant `void` operator.
- Do **not** route this through `reportWebhookEventFailure`: a health probe is not a GitHub event, has no event context, and must not page anyone on Slack.

### 6. Add the boundary unit tests
- Create `adws/triggers/__tests__/webhookEventBoundary.test.ts` (vitest, `vi.fn()` for injected deps).
- **Never let these tests reach the real `postSlack`.** `.env` supplies a live `SLACK_WEBHOOK_URL` on this host, and `adws/core/environment` loads it; every `reportWebhookEventFailure` call in the suite must pass an injected `notify`. Do not import `adws/triggers/trigger_webhook` from any test either — importing it starts an HTTP server.
- Cover:
  1. `describeWebhookEvent` on a full `issue_comment` payload → `{ event: 'issue_comment', repo: 'paysdoc/paysdoc.nl', issueNumber: 28, prNumber: null }`.
  2. `describeWebhookEvent(undefined, undefined)` → `{ event: 'unknown', repo: 'unknown', issueNumber: null, prNumber: null }`; and a hostile payload (`repository: 'nope'`, `issue: { number: 'x' }`) degrades to the same fallbacks without throwing.
  3. `describeWebhookEvent` picks up `pull_request.number` for a `pull_request` payload.
  4. `safeParseWebhookBody` → object for valid JSON, `undefined` for `Buffer.from('not json')` and for a valid-but-non-object body (`'[]'`, `'"x"'`).
  5. `formatWebhookFailureLog` and `formatWebhookFailureAlert` each contain the event type, `paysdoc/paysdoc.nl`, `28`, and the error message — the unit-level twin of feature §2. Assert the `n/a` and `PR #N` label variants too.
  6. `reportWebhookEventFailure` calls `logger` once with level `'error'`, and `notify` exactly once with the alert text.
  7. **Never throws** — three separate cases: `notify` throws synchronously; `notify` returns `Promise.reject(...)`; `logger` throws. Each asserts `expect(() => reportWebhookEventFailure(ctx, err, deps)).not.toThrow()`. For the rejection case, `await` a macrotask afterwards and assert the process saw no unhandled rejection (e.g. `vi.spyOn` on the fallback logger, or simply that the returned rejection was consumed by the internal `.catch`).
  8. `reportWebhookEventFailure` does **not** await the notifier: with a `notify` that returns a never-settling promise, the call still returns synchronously.

### 7. Repair the source-shape tests in `adws/__tests__/triggerWebhook.test.ts`
- Replace the indentation-sensitive slicing in `getOpenedCatchBlock` / `getCommentCatchBlock` with brace-matched extraction (find the `} catch (error)` / `.catch((error)` anchor, then walk braces to the matching close), so the helpers stop depending on a specific nesting depth. This is the reason the file must change at all — the assertions themselves stay valid.
- Keep every existing assertion: no `spawnDetached` and no `adwPlanBuildTest.tsx` in either catch block, and no `action === 'labeled'` handler in the file.
- Replace the two `log(` / `/'error'/` assertions with `expect(catchBlock).toContain('reportWebhookEventFailure')` — the error-level logging they were guarding is now pinned directly, and more strongly, by Step 6 case 6.
- Add one wiring guard: the `req.on('end'` listener body contains `try {` and `containEventFailure(`. Keep it to that — behaviour is proven by `@adw-776`, and deeper source-shape assertions are exactly the rot this repo has already been bitten by.

### 8. Confirm RED → GREEN against the real server
- With the fix applied, re-run *Steps to Reproduce*. Required observations: `http_code=500`; the log carries the `Webhook event handler failed [event=issue_comment repo=… issue=#28]` line; the listener on the test port survives; a second identical delivery is answered `500` again; a following harmless delivery (e.g. `x-github-event: ping` with no `repository`) is answered `200`.
- Then repeat with `SLACK_WEBHOOK_URL` pointed at a local sink (`node -e "require('http').createServer((q,s)=>{q.resume();q.on('end',()=>s.end('ok'))}).listen(9778)"`) and confirm one POST arrives whose body names `issue_comment`, the repo and `28` — feature §2's Slack half.
- Clean up every scratch artefact (`/tmp/repro776/`, the seeded `agents/cron/*.json`, the sleeper process, any scratch `.ts` in the repo root) before committing.

### 9. Satisfy the BDD acceptance contract
- Re-read `features/per-issue/feature-776.feature` and check the implementation against all six sections. Highest-risk trip-wires:
  - **§4** — the boundary must not touch the `400`/`401`/`200` answers, and must raise no alert for them. It fires only on a throw, so this holds by construction; it breaks if the containment is ever widened into "any non-200 becomes a 500".
  - **§5** — the `500` must not wait on Slack. Guaranteed only by the never-awaited alert; an accidental `await` turns a black-holed endpoint into a 10 s stall per delivery.
  - **§3** — no `500` on the async path, and the pre-existing `.catch`es must remain in place.
  - **§2** — the log line and the alert must each carry all three identifiers, with the repo in `owner/repo` form.
- Hand the `generate_step_definitions` phase the harness facts verified in *Steps to Reproduce*: the mandatory `clone_url` in the payload, the present-but-empty credential env (dotenv does not overwrite), the failing `gh` stub on `PATH`, `SLACK_WEBHOOK_URL` (empty for the "no endpoint" case, sink URL otherwise), `GITHUB_WEBHOOK_SECRET` empty except for the 401 scenario, `cwd` at the repo root, the pre-seeded `agents/cron/<owner>_<repo>.json` live-PID record to keep `ensureCronProcess` from spawning a real cron, the absent-`agents/.auth_gate` precondition, `setDefaultTimeout` above cucumber's 5 s default, and an `After` hook that always kills the spawned server.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-776"` and confirm all 15 scenarios pass.

### 10. Validate
- Run every command in **Validation Commands** below and confirm all pass with zero regressions. Baseline for `bun run test:unit` before this change, measured in this worktree: **139 test files / 2408 tests passing**; afterwards expect 140 files and 2408 + N tests, all green.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Commands are taken from `.adw/commands.md`.

- **Reproduce before the fix** — run *Steps to Reproduce* against the unpatched entrypoint: `curl` reports `(52) Empty reply from server`, `lsof -nP -iTCP:9777` is empty, and the log ends in the fatal `at IncomingMessage.<anonymous> (adws/triggers/trigger_webhook.ts:198:13)` frame.
- **RED proof (unit)** — `bunx vitest run adws/triggers/__tests__/webhookEventBoundary.test.ts` before Step 1: fails (module absent). After Steps 1 + 6: all cases pass.
- `bun run lint` — ESLint passes with zero errors/warnings.
- `bunx tsc --noEmit` — repo type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional ADW type-check passes (this is what feature §6 asserts).
- `bun run build` — build succeeds with no errors.
- `bun run test:unit` — full vitest suite green: the new `webhookEventBoundary.test.ts` passes, the repaired `adws/__tests__/triggerWebhook.test.ts` passes, and all pre-existing tests still pass (baseline 139 files / 2408 tests, zero regressions).
- **Verify after the fix** — re-run *Steps to Reproduce*: `http_code=500`, the `Webhook event handler failed [event=issue_comment repo=… issue=#28]` log line is present, the listener survives, a repeat delivery is answered `500`, and a following harmless delivery is answered `200`. With a local Slack sink configured, exactly one alert POST arrives naming the event, repo and issue. Delete every scratch artefact afterwards.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-776"` — all 15 scenarios in `features/per-issue/feature-776.feature` pass. §1/§2/§5 and the alert half of §3 are RED before the fix; §4, §6 and the survival half of §3 are GREEN before and must stay GREEN. Requires the step definitions authored by `generate_step_definitions`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-proof"` — the review-proof suite still passes (blocker per `.adw/review_proof.md` step 4).

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): the fix applies "try-catch at system boundaries" literally — one boundary at the HTTP edge — and the dispatch is *extracted* rather than wrapped so nesting does not deepen. `describeWebhookEvent`, `safeParseWebhookBody` and both formatters are pure; the side effects (log, Slack, response) sit in one reporter and one containment helper. No decorators, no `any`, no new abstractions beyond the single module. `trigger_webhook.ts` is already 326 lines (over the 300-line guideline) and grows by roughly 20 — a **pre-existing** condition; splitting the file is out of scope and would break the branch markers Step 2 deliberately preserves.
- **No new libraries.** Per `.adw/commands.md` the install command would be `bun add <package>`; none is needed.
- **Why no `process.on('uncaughtException')` net.** It was considered and rejected. A process-level handler would also swallow genuinely fatal, non-request-scoped errors (a corrupted module load, an OOM path) and leave a half-initialised daemon serving, and it gives no place to answer the delivery that failed. The issue asks for a *per-event* boundary, and this fix instead removes every unguarded fire-and-forget on the request path (four async catches + the `/health` IIFE), which closes the reachable set. If a future audit still wants a last-resort net, it belongs in its own issue with an explicit crash-and-restart policy (e.g. log, alert, `server.close()`, exit non-zero, and let a supervisor restart) — not smuggled in here.
- **Why the `500` is not attempted on the async paths.** Those deliveries were answered `200 processing` before the continuation ran; HTTP has no retraction. Feature §3 pins this explicitly, so "respond 500 on failure" is scoped to failures that occur before the response is flushed. `res.headersSent` is the single switch that encodes it.
- **`AuthRequiredError` is deliberately not special-cased in the sync boundary.** The two async handlers keep their existing gate-writing branches. No synchronous request-path call is known to throw `AuthRequiredError` (it originates from agent runs, all async), and if one ever did, answering `500` + alerting is a visible, safe outcome — whereas duplicating gate-writing logic into the containment helper would put auth policy in the crash path.
- **The alert carries no host name.** `sendSlackDetectionNotification` takes an explicit `host` because the auth gate is host-scoped; a per-event failure alert does not need it, and adding `os.hostname()` would be unrequested scope. If multi-host disambiguation is ever wanted, add it to `formatWebhookFailureAlert` alone.
- **Slack noise.** Every contained failure now pings Slack, so GitHub's retry pattern (six deliveries over 22 minutes in this incident) produces one alert per retry. That is the intended signal — an ongoing outage should be loud — and it is bounded by GitHub's own retry policy. No dedup/rate-limit is added; if it turns out to be needed, it belongs in `slackNotifier.ts` where every caller benefits.
- **The stranded `@adw-501` feature.** `features/webhook_ensure_cron_on_every_event.feature` asserts on `trigger_webhook.ts` *source text* and is not collected by `cucumber.js` (`paths:` covers only `features/regression/**` and `features/per-issue/**`); `--tags "@adw-501"` collects 0 scenarios, and two of its `@regression`-tagged steps have already rotted against the GitContext migration (`ensureAppAuthForRepo(`, `if (webhookRepoInfo) ensureCronProcess(`). Step 2 keeps every branch marker it greps for, but its two file-order assumptions about the `/webhook` path guard and the `POST` method guard (both **untagged**, so not part of the regression suite) would no longer hold if the dispatch function were placed *above* `http.createServer`. Declare the function **below** `const server = …` (function declarations hoist) and the file order is preserved. Repairing or deleting that stranded file is out of scope — flag it, do not fix it here.
- **Do not extract the dispatch into a new file.** Moving the event branches out of `trigger_webhook.ts` would break the `if (event === …)` markers the stranded feature and `adws/__tests__/triggerWebhook.test.ts` both key on, for no behavioural gain. The new module holds only the boundary/reporting logic, which has no such coupling.
- **Vocabulary registry.** `.adw/scenarios.md` sets `## Vocabulary Registry: features/regression/vocabulary.md`, and `generate_step_definitions` refuses to write step definitions when a phrase is unregistered. `feature-776.feature` introduces ~24 novel phrases (it lists them, reusing only G18 and T22). Every one of the 97 existing per-issue features has step definitions despite the same situation, so this is expected to proceed; if the phase does return `vocabularyViolations`, hand-author `features/per-issue/step_definitions/feature-776.steps.ts` rather than editing `features/regression/vocabulary.md` — promotion into the registry is a deliberate human decision and `@regression` promotion is explicitly out of scope for this issue.
- **Harness safety, learned during planning.** Running the real entrypoint on this host is safe only with the guards in *Steps to Reproduce*: `SLACK_WEBHOOK_URL=` empty (or a local sink) so no real channel is paged; a throwaway `repository.full_name` plus a pre-seeded live-PID `agents/cron/<owner>_<repo>.json` so `ensureCronProcess` detach-spawns nothing; a non-default `PORT`; and liveness checked with `lsof -nP -iTCP:<port>` rather than `pgrep -f trigger_webhook`, which also matches the **live** production server running from the main checkout. The planning run confirmed the live listener on `:8001` was unaffected.
- **Worktree hygiene — an out-of-scope revert was found and discarded during planning.** This worktree was born with an uncommitted working-tree revert of `.claude/commands/adw_init.md` deleting the entire step-7 "Copy Starter Guardrails Settings" section (issue #763, merged) and renumbering steps 8→7 / 9→8. Verified working-tree-only (`git diff HEAD origin/dev -- .claude/commands/adw_init.md` empty; `git show HEAD:.claude/commands/adw_init.md` still contained the section) and discarded with `git checkout HEAD -- .claude/commands/adw_init.md` — pure discard, no commit, never `git add -A`. **Do not re-introduce it**; `.claude/commands/adw_init.md` must show no diff against `origin/dev` in the final PR (it is also a `hashInputs:` file, so any edit would fan an `adwUpgrade` regen across every registered target repo). This is the 10th occurrence of this recurring worktree-birth defect — re-check `git diff origin/dev --stat` before committing.
- **The `README.md` modification present at planning time is benign and pre-existing.** It *adds* two `__tests__` entries (`workflowCommentsIssue.test.ts`, `promotionSweepDefaults.test.ts`) to the file-tree listing; both files exist on disk and neither is documented on `origin/dev`, so the lines are additive and true, not a revert (the `-` lines are tree-drawing characters only). It was left in place. The `document` phase will add this fix's own entries (`webhookEventBoundary.ts`, `webhookEventBoundary.test.ts`) alongside them.
