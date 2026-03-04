# Feature: Permanent Webhook URL + Portfolio Site at paysdoc.nl

## Metadata
issueNumber: `64`
adwId: `permanent-webhook-ur-zqsq62`
issueJson: `{"number":64,"title":"Permanent Webhook URL + Portfolio Site at paysdoc.nl","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-04T13:06:21Z"}`

## Feature Description
Replace the ephemeral ngrok-based webhook URL with a permanent Cloudflare Tunnel endpoint at `api.paysdoc.nl`, add HMAC-SHA256 webhook signature validation for security, enforce port stability when running in tunnel mode, and scaffold a professional portfolio site at `paysdoc.nl` deployed via Cloudflare Pages.

This feature spans four parts:
1. **Cloudflare Setup** (manual — DNS, tunnel, launchd service)
2. **Webhook Signature Validation** (code — this repo)
3. **Portfolio Site Scaffolding** (code — separate `paysdoc/paysdoc.nl` repo)
4. **GitHub Webhook Migration** (manual — update all repo webhooks)

The implementable code changes in this repo focus on Part 2: webhook signature validation, port stability, README fixes, and tests.

## User Story
As a developer using ADW
I want a permanent webhook URL with cryptographic signature validation
So that I don't have to reconfigure GitHub webhooks every time ngrok restarts, and unauthorized requests are rejected

## Problem Statement
The ADW webhook server requires ngrok for a public URL, which resets on every restart — forcing manual webhook reconfiguration in every GitHub repository. Additionally, the webhook endpoint has no signature validation, meaning any party that knows the URL can send forged payloads. The README also incorrectly documents the endpoint as `/gh-webhook` when the code uses `/webhook`.

## Solution Statement
1. Create a `webhookSignature.ts` module that validates GitHub's `x-hub-signature-256` header using HMAC-SHA256 with constant-time comparison.
2. Integrate signature validation into `trigger_webhook.ts` — reject requests with 401 when `GITHUB_WEBHOOK_SECRET` is configured and the signature is invalid/missing. Skip validation when the secret is not set (backward compatibility).
3. Enforce port stability when `GITHUB_WEBHOOK_SECRET` is set — if port 8001 is unavailable, throw a hard error instead of falling back to a random port (which would silently break the Cloudflare tunnel).
4. Fix the README discrepancy (`/gh-webhook` → `/webhook`).
5. Add comprehensive tests for signature validation.

The Cloudflare tunnel setup, portfolio site, and webhook migration are manual/separate-repo tasks documented as notes.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/trigger_webhook.ts` — Main webhook server. Needs raw body extraction, signature validation integration, port stability enforcement. (~413 lines)
- `adws/triggers/webhookHandlers.ts` — PR event handler, no changes needed but relevant for understanding the webhook flow.
- `adws/core/index.ts` — Exports `allocateRandomPort`, `isPortAvailable`, `log` used by the webhook server.
- `adws/__tests__/triggerWebhookPort.test.ts` — Existing port resolution tests. Needs new test cases for tunnel-mode port enforcement.
- `adws/__tests__/webhookHandlers.test.ts` — Existing webhook handler tests. Should remain passing.
- `adws/README.md` — Documents webhook endpoint incorrectly as `/gh-webhook`. Needs correction.
- `.env.sample` — Already has `GITHUB_WEBHOOK_SECRET` placeholder.
- `guidelines/coding_guidelines.md` — Must follow these guidelines (modularity, type safety, security by default, pure functions, testing).

### New Files
- `adws/triggers/webhookSignature.ts` — HMAC-SHA256 signature validation module.
- `adws/__tests__/webhookSignature.test.ts` — Tests for the signature validation module.

## Implementation Plan
### Phase 1: Foundation
Create the standalone `webhookSignature.ts` module with pure validation logic. This module takes a raw body buffer, a secret string, and a signature header string, returning a validation result. Uses `node:crypto` with `timingSafeEqual` for constant-time comparison. No side effects — pure function.

### Phase 2: Core Implementation
Integrate signature validation into `trigger_webhook.ts`:
1. Extract `rawBody` from the request body chunks before JSON parsing.
2. Call the signature validator when `GITHUB_WEBHOOK_SECRET` is set.
3. Return 401 with a JSON error if validation fails.
4. Log a warning on startup when the secret is not configured.
5. Enforce port stability: when `GITHUB_WEBHOOK_SECRET` is set and the preferred port is unavailable, throw an error instead of falling back to a random port.

### Phase 3: Integration
Fix the README, add tests, and verify all existing tests still pass. Ensure backward compatibility — when `GITHUB_WEBHOOK_SECRET` is not set, the server behaves exactly as before.

## Step by Step Tasks

### Step 1: Create `adws/triggers/webhookSignature.ts`
- Create a new module that exports a `validateWebhookSignature` function.
- Parameters: `rawBody: Buffer`, `secret: string`, `signatureHeader: string | undefined`.
- Returns: `{ valid: boolean; error?: string }`.
- Implementation:
  - If `signatureHeader` is missing or empty, return `{ valid: false, error: 'Missing signature header' }`.
  - Compute expected signature: `sha256=` + HMAC-SHA256 hex digest of `rawBody` using `secret`.
  - Compare using `crypto.timingSafeEqual` after converting both to buffers.
  - Handle length mismatch (different buffer lengths) gracefully — return invalid without timing leak.
  - Handle malformed signatures (missing `sha256=` prefix).
- Follow coding guidelines: pure function, explicit types, no `any`.

### Step 2: Create `adws/__tests__/webhookSignature.test.ts`
- Write 7 test cases:
  1. Valid signature → `{ valid: true }`.
  2. Missing header (`undefined`) → `{ valid: false, error: 'Missing signature header' }`.
  3. Empty header (`''`) → `{ valid: false, error: 'Missing signature header' }`.
  4. Wrong secret → `{ valid: false }`.
  5. Tampered payload (correct secret, altered body) → `{ valid: false }`.
  6. Wrong-length signature (truncated hex) → `{ valid: false }`.
  7. Malformed signature (no `sha256=` prefix) → `{ valid: false }`.
- Use `node:crypto` `createHmac` to generate valid test signatures.
- Run tests: `npx jest adws/__tests__/webhookSignature.test.ts`.

### Step 3: Modify `adws/triggers/trigger_webhook.ts` — raw body extraction and signature validation
- Import `validateWebhookSignature` from `./webhookSignature`.
- In the request handler, after collecting chunks into `rawBody = Buffer.concat(chunks)`:
  - Before JSON parsing, if `process.env.GITHUB_WEBHOOK_SECRET` is set:
    - Call `validateWebhookSignature(rawBody, process.env.GITHUB_WEBHOOK_SECRET, req.headers['x-hub-signature-256'] as string | undefined)`.
    - If not valid, return `jsonResponse(res, 401, { error: 'invalid signature' })` and log the error reason.
  - Parse JSON from `rawBody.toString()` (already done, just ensure `rawBody` is extracted before parsing).
- In `startServer()`, log a warning if `GITHUB_WEBHOOK_SECRET` is not set: `log('GITHUB_WEBHOOK_SECRET not set — webhook signature validation disabled', 'warn')`.

### Step 4: Enforce port stability for tunnel mode
- Modify `resolveWebhookPort()` in `trigger_webhook.ts`:
  - After detecting the preferred port is unavailable, check if `process.env.GITHUB_WEBHOOK_SECRET` is set.
  - If set, throw an error: `throw new Error(\`Port ${preferredPort} is in use and GITHUB_WEBHOOK_SECRET is set (tunnel mode). Cannot fall back to a random port — the Cloudflare tunnel requires a fixed port. Stop the process using port ${preferredPort} and restart.\`)`.
  - If not set, fall back to random port as before (backward compat).
- Update `adws/__tests__/triggerWebhookPort.test.ts` with new test cases:
  - When `GITHUB_WEBHOOK_SECRET` is set and port is unavailable → throws error.
  - When `GITHUB_WEBHOOK_SECRET` is not set and port is unavailable → falls back to random port (existing behavior).

### Step 5: Fix README discrepancy in `adws/README.md`
- Replace all references to `/gh-webhook` with `/webhook`.
- Update the payload URL example to use `https://api.paysdoc.nl/webhook`.
- Update the event list to include `pull_request`, `pull_request_review`, `pull_request_review_comment` events (in addition to `issues` and `issue_comment`).
- Update the security section to accurately describe HMAC-SHA256 signature validation behavior (optional when secret not set, enforced when set).

### Step 6: Run validation commands
- Run all validation commands listed below to ensure zero regressions.

## Testing Strategy
### Unit Tests
- `adws/__tests__/webhookSignature.test.ts` — 7 tests for the pure validation function covering valid, missing, empty, wrong secret, tampered, wrong-length, and malformed signatures.
- `adws/__tests__/triggerWebhookPort.test.ts` — Extended with 2 new tests for tunnel-mode port enforcement (throws when secret set + port unavailable; falls back when secret not set).

### Edge Cases
- Missing `x-hub-signature-256` header entirely (GitHub sends ping without it sometimes — should be rejected when secret is set).
- Empty string signature header.
- Signature with correct format but wrong HMAC value.
- Signature with wrong length (truncated or extended hex string).
- Signature missing the `sha256=` prefix.
- Very large payload body (ensure Buffer operations don't fail).
- `GITHUB_WEBHOOK_SECRET` not set — all requests pass through without validation (backward compat).
- Port 8001 in use with `GITHUB_WEBHOOK_SECRET` set — hard error, no silent fallback.

## Acceptance Criteria
- `validateWebhookSignature` correctly validates HMAC-SHA256 signatures using constant-time comparison.
- Requests with invalid/missing signatures are rejected with HTTP 401 when `GITHUB_WEBHOOK_SECRET` is configured.
- Requests pass through without validation when `GITHUB_WEBHOOK_SECRET` is not configured.
- A startup warning is logged when `GITHUB_WEBHOOK_SECRET` is not set.
- Port fallback throws a hard error when `GITHUB_WEBHOOK_SECRET` is set and the preferred port is unavailable.
- All 7 signature validation tests pass.
- All existing webhook tests (22+) continue to pass.
- TypeScript type check passes cleanly.
- `adws/README.md` accurately documents the `/webhook` endpoint and security behavior.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npx tsc --noEmit -p adws/tsconfig.json` — TypeScript type check for adws
- `npx jest adws/__tests__/webhookSignature.test.ts` — Run new signature validation tests
- `npx jest adws/__tests__/triggerWebhookPort.test.ts` — Run updated port resolution tests
- `npx jest adws/__tests__/webhookHandlers.test.ts` — Verify existing webhook handler tests pass
- `npx jest adws/__tests__/webhookClearComment.test.ts` — Verify existing clear comment tests pass
- `npx jest adws/__tests__/triggerCommentHandling.test.ts` — Verify existing comment handling tests pass
- `npx jest adws/__tests__/triggerPrReviewDedup.test.ts` — Verify existing PR review dedup tests pass
- `npx jest adws/__tests__/triggerSpawnArgs.test.ts` — Verify existing spawn args tests pass
- `npm test` — Run full test suite
- `npm run lint` — Run linter
- `npm run build` — Build the application

## Notes
- **Cloudflare Setup (Part 1)** is entirely manual: add `paysdoc.nl` to Cloudflare, create tunnel `adw-webhook`, configure DNS CNAMEs, install `cloudflared` as launchd service. See issue body for detailed steps. The domain stays registered at vdx.nl (cheaper than Cloudflare) — only nameservers point to Cloudflare.
- **Portfolio Site (Part 3)** lives in a separate repo `paysdoc/paysdoc.nl`. It's a Next.js static export deployed to Cloudflare Pages. Not part of this repo's implementation.
- **Webhook Migration (Part 4)** is a manual step after everything is deployed: update all GitHub repo webhooks to `https://api.paysdoc.nl/webhook` with the generated secret.
- **Generate Webhook Secret (Part 2b)**: Run `openssl rand -hex 32` and add to `.env` as `GITHUB_WEBHOOK_SECRET`. This is a manual step.
- Follow `guidelines/coding_guidelines.md`: pure functions, type safety, modularity (files under 300 lines), security by default, comprehensive tests.
- The `HTTP_STATUS_DESCRIPTIONS` map in `trigger_webhook.ts` needs a `401: 'Unauthorized'` entry added.
