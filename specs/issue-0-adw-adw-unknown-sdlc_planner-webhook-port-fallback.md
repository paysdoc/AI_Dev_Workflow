# Chore: Webhook trigger port fallback when default port is in use

## Metadata
issueNumber: `0`
adwId: `adw-unknown`
issueJson: `{}`

## Chore Description
The webhook trigger (`adws/triggers/trigger_webhook.ts`) currently listens on a hardcoded default port of `8001` (configurable via the `PORT` environment variable). If port 8001 is already in use by another process, the server crashes with an `EADDRINUSE` error and no fallback is attempted.

This chore adds automatic port fallback logic: when the desired port (default `8001` or `PORT` env var) is already in use, the webhook server should detect the conflict and automatically select an available port using the existing `portAllocator` utility, then log the actual port being used so the operator knows where the server is listening.

## Relevant Files
Use these files to resolve the chore:

- `adws/triggers/trigger_webhook.ts` — The webhook server entry point. Contains the hardcoded default port `8001` and the `server.listen()` call that needs fallback logic.
- `adws/core/portAllocator.ts` — Existing utility with `isPortAvailable()` (currently not exported) and `allocateRandomPort()`. The `isPortAvailable` function needs to be exported so the webhook trigger can check the preferred port before binding.
- `adws/core/index.ts` — Core barrel export file. Needs to re-export `isPortAvailable` once it is exported from `portAllocator.ts`.
- `adws/__tests__/portAllocator.test.ts` — Existing tests for `allocateRandomPort`. Will need additional tests for the newly exported `isPortAvailable`.
- `adws/README.md` — Documents the webhook trigger default port. Should be updated to mention the automatic fallback behavior.

### New Files
- `adws/__tests__/triggerWebhookPort.test.ts` — New test file to verify the port fallback logic in isolation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Export `isPortAvailable` from `portAllocator.ts`

- In `adws/core/portAllocator.ts`, add the `export` keyword to the existing `isPortAvailable` function (line 16) so it becomes `export function isPortAvailable(port: number): Promise<boolean>`.
- No other changes to this file are needed.

### Step 2: Re-export `isPortAvailable` from the core barrel

- In `adws/core/index.ts`, update line 97 to also export `isPortAvailable`:
  ```ts
  export { allocateRandomPort, isPortAvailable } from './portAllocator';
  ```

### Step 3: Make webhook server startup async with port fallback

- In `adws/triggers/trigger_webhook.ts`, import `isPortAvailable` alongside existing core imports (or from `../core/portAllocator` directly).
- Replace the synchronous server startup at the bottom of the file (lines 279–282) with an async `startServer()` function that:
  1. Reads the preferred port from `process.env.PORT || '8001'`.
  2. Calls `isPortAvailable(preferredPort)` to check if the preferred port is free.
  3. If available, uses the preferred port.
  4. If NOT available, logs a warning like `Port ${preferredPort} is in use, allocating a random available port...` using the existing `log()` utility.
  5. Calls `allocateRandomPort()` to get a free port.
  6. Calls `server.listen(actualPort, '0.0.0.0', callback)` with the resolved port.
  7. Logs the actual port the server is listening on.
- The `port` constant at line 30 should be moved inside the `startServer()` function as the `preferredPort`.
- Call `startServer()` at module level (the function handles its own error logging).
- Wrap the `startServer()` call with `.catch()` to log fatal errors if even the fallback port fails.

### Step 4: Add tests for `isPortAvailable`

- In `adws/__tests__/portAllocator.test.ts`, add a new `describe('isPortAvailable', ...)` block with:
  - Test: returns `true` for a port that is not in use (pick a random high port, verify it returns true).
  - Test: returns `false` for a port that is in use (bind a temporary server to a port, verify `isPortAvailable` returns false, then clean up).

### Step 5: Add tests for webhook port fallback logic

- Create `adws/__tests__/triggerWebhookPort.test.ts` to test the port resolution logic:
  - Extract the port resolution logic into a small, testable helper function (e.g., `resolveWebhookPort(preferredPort: number): Promise<number>`) exported from `trigger_webhook.ts`.
  - Test: when preferred port is available, returns the preferred port.
  - Test: when preferred port is in use, returns a different port from the allocator.
  - Use `vi.mock` to mock `isPortAvailable` and `allocateRandomPort` for deterministic testing.

### Step 6: Update documentation

- In `adws/README.md`, update the webhook trigger section (around line 329) to document the fallback behavior:
  - Change `- Default port: 8001` to mention that if port 8001 is in use, the server automatically selects an available port.
  - Example: `- Default port: 8001 (automatically falls back to a random available port if 8001 is in use)`

### Step 7: Run validation commands

- Run all validation commands listed below to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the chore is complete with zero regressions

## Notes
- IMPORTANT: strictly adhere to the coding guidelines in `/guidelines`. If necessary, refactor existing code to meet the coding guidelines as part of accomplishing the chore.
- The existing `portAllocator.ts` already uses the range 10000–60000 for random ports, which avoids conflict with the default 8001 webhook port.
- The `PORT` environment variable is already in the `SAFE_ENV_VARS` allowlist in `config.ts`, so subprocesses can inherit it if needed.
- Keep the fallback behavior transparent to the operator: always log the actual port the server ends up using so they can configure their GitHub webhook URL accordingly.
