# Bug: Webhook server crashes with EADDRINUSE on port 8001

## Metadata
issueNumber: `0`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description
When starting the webhook server via `npx tsx adws/triggers/trigger_webhook.ts`, it crashes with an unhandled `EADDRINUSE` error on `0.0.0.0:8001`. The server is supposed to detect when port 8001 is in use and fall back to a random available port, but the fallback mechanism fails because the port availability check uses a different network interface than the server's listen call.

**Expected behavior**: The webhook server detects port 8001 is occupied and automatically binds to a random available port.

**Actual behavior**: The server crashes with `Error: listen EADDRINUSE: address already in use 0.0.0.0:8001`.

## Problem Statement
The `isPortAvailable()` function checks port availability by binding a test server to `127.0.0.1` (loopback only), but the webhook server listens on `0.0.0.0` (all interfaces). A port can be free on `127.0.0.1` while simultaneously occupied on `0.0.0.0`, causing `isPortAvailable()` to return `true` for a port that will fail when the server actually tries to listen. Additionally, `startServer()` has no error recovery for the TOCTOU race condition inherent in check-then-listen patterns.

## Solution Statement
1. Add an optional `host` parameter to `isPortAvailable()` (defaulting to `'0.0.0.0'`) so callers can check availability on the same interface they intend to bind to.
2. Add EADDRINUSE error handling in `startServer()` so that if the listen still fails (due to the TOCTOU race between checking and binding), the server retries with a random available port instead of crashing.
3. Update existing tests and add new tests to cover the interface-aware check and the server retry logic.

## Steps to Reproduce
1. Start a process that binds to `0.0.0.0:8001` (e.g., another webhook server instance, or `python3 -m http.server 8001 --bind 0.0.0.0`)
2. Run `npx tsx adws/triggers/trigger_webhook.ts`
3. The server crashes with `EADDRINUSE: address already in use 0.0.0.0:8001`

## Root Cause Analysis
Two compounding issues:

1. **Interface mismatch**: `isPortAvailable()` in `adws/core/portAllocator.ts` (line 23) binds its test server to `127.0.0.1`, but `startServer()` in `adws/triggers/trigger_webhook.ts` (line 294) calls `server.listen(actualPort, '0.0.0.0', ...)`. On most operating systems, a port bound on `0.0.0.0` is considered in use for all interfaces, but a port bound only on `127.0.0.1` does not conflict with `0.0.0.0` bindings. So `isPortAvailable()` can return `true` even when the port is occupied on `0.0.0.0`.

2. **No error recovery (TOCTOU)**: Even if the interfaces matched, there is an inherent race condition between checking port availability and actually binding. Between the check and the `server.listen()` call, another process could claim the port. `startServer()` has no catch for `EADDRINUSE` to retry with a fallback port, so any race results in a crash.

## Relevant Files
Use these files to fix the bug:

- `adws/core/portAllocator.ts` — Contains `isPortAvailable()` which hardcodes `127.0.0.1` as the check interface. Needs a `host` parameter added.
- `adws/triggers/trigger_webhook.ts` — Contains `resolveWebhookPort()` and `startServer()`. `resolveWebhookPort()` needs to pass `'0.0.0.0'` to `isPortAvailable()`. `startServer()` needs EADDRINUSE error recovery.
- `adws/core/index.ts` — Re-exports `isPortAvailable` and `allocateRandomPort`. May need updated export if the signature changes (no change needed since adding an optional param is backward-compatible).
- `adws/__tests__/portAllocator.test.ts` — Existing tests for `isPortAvailable` and `allocateRandomPort`. Need updates to test the new `host` parameter.
- `adws/__tests__/triggerWebhookPort.test.ts` — Existing tests for `resolveWebhookPort`. Need updates to verify host is passed through.
- `adws/README.md` — Documents webhook server behavior including port fallback. Already accurately describes the fallback behavior; no change needed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Update `isPortAvailable()` to accept an optional `host` parameter
- In `adws/core/portAllocator.ts`, change the function signature from `isPortAvailable(port: number)` to `isPortAvailable(port: number, host: string = '0.0.0.0')`.
- Replace the hardcoded `'127.0.0.1'` on line 23 with the `host` parameter.
- This change is backward-compatible: existing callers without a `host` argument will now default to checking `0.0.0.0`, which is the more correct and conservative default (matches what most servers bind to).

### 2. Update `resolveWebhookPort()` to pass the correct host
- In `adws/triggers/trigger_webhook.ts`, update the `resolveWebhookPort()` function to pass `'0.0.0.0'` as the second argument to `isPortAvailable()`.
- This ensures the availability check matches the interface the server will bind to.

### 3. Add EADDRINUSE error handling in `startServer()`
- In `adws/triggers/trigger_webhook.ts`, add an `'error'` event listener on the `server` object inside `startServer()` before calling `server.listen()`.
- When an `EADDRINUSE` error is caught:
  - Log a warning that the resolved port was taken (TOCTOU race).
  - Call `allocateRandomPort()` to get a new port.
  - Retry `server.listen()` with the new port.
- Only retry once to avoid infinite loops. If the retry also fails, let the error propagate (crash with a clear message).

### 4. Update `portAllocator.test.ts`
- Update the existing `isPortAvailable` tests:
  - Add a test that verifies `isPortAvailable(port, '0.0.0.0')` works correctly by checking a free port on `0.0.0.0`.
  - Add a test that verifies `isPortAvailable` returns `false` when a port is occupied on the specified host.
  - Ensure the existing test that checks an in-use port uses the correct host binding.

### 5. Update `triggerWebhookPort.test.ts`
- Update existing mock assertions to verify that `isPortAvailable` is called with the correct host parameter (`'0.0.0.0'`).
- Verify that `resolveWebhookPort(8001)` passes `'0.0.0.0'` as the second argument to `isPortAvailable`.

### 6. Run validation commands
- Run all validation commands listed below to confirm the bug is fixed and there are no regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npx tsx -e "import { isPortAvailable } from './adws/core/portAllocator'; isPortAvailable(8001, '0.0.0.0').then(r => console.log('0.0.0.0:8001 available:', r))"` — Verify the new host parameter works
- `npm run lint` — Run linter to check for code quality issues
- `npm run build` — Build the application to verify no build errors
- `npm test` — Run tests to validate the bug is fixed with zero regressions

## Notes
- No `guidelines/` directory exists in the repo, so no coding guidelines files were found to enforce.
- The default host change from `127.0.0.1` to `0.0.0.0` in `isPortAvailable()` is intentionally more conservative — it checks the broadest interface by default, which is the correct behavior for most use cases (servers typically bind to `0.0.0.0`).
- No new libraries are needed for this fix.
- The `allocateRandomPort()` function also calls `isPortAvailable()` internally and will inherit the new default host (`0.0.0.0`), which makes its checks more reliable too.
