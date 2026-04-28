# Bug: webhook does not call ensureCronProcess on every accepted event

## Metadata
issueNumber: `501`
adwId: `0lhdw4-webhook-call-ensurec`
issueJson: `{"number":501,"title":"webhook: call ensureCronProcess on every accepted event (fixes awaiting_merge stranding)","body":"## Problem\n\nThe webhook server (adws/triggers/trigger_webhook.ts) only calls ensureCronProcess from two of its event branches: issue_comment (created) at trigger_webhook.ts:138 and issues.opened at trigger_webhook.ts:212. Every other inbound event silently returns without ensuring a cron exists for the repo: pull_request_review (115-126), pull_request_review_comment (105-113), pull_request closed (174-182), issues closed/edited/labeled (184-227), and all other events (drops to ignored at 184). This matters because the auto-merge path is cron-only — the webhook explicitly does not dispatch adwMerge directly. So if the only recent inbound traffic for a repo is a pull_request_review.approved, no cron is ever spawned, and the PR sits in awaiting_merge forever.\n\n## Concrete incident\n\nIssue #492 / PR #498: PR is APPROVED + MERGEABLE + CLEAN; agents/2evbnk-bdd-rewrite-2-3-auth/state.json → workflowStage: \"awaiting_merge\" since 2026-04-26T21:30Z; no spawn lock at agents/spawn_locks/issue-492.json; auto-merge gate (no hitl) OR (PR approved) evaluates true; yet the merge never fires, because the only running cron targets vestmatic/vestmatic — there is no cron polling paysdoc/AI_Dev_Workflow, and the human approval (pull_request_review.submitted with state=approved) was 200-ignored without spawning one.\n\n## Proposed fix\n\nCall ensureCronProcess once per accepted webhook event, before any per-event branching, so any inbound signal for a repo guarantees a cron is alive to sweep its backlog. ensureCronProcess is already idempotent (per-repo dedup via a process registry / lock), so calling it on every event is safe. Suggested placement: just after the existing ensureAppAuthForRepo block at trigger_webhook.ts:97-103, gated only on resolving a repoInfo from body.repository.full_name. The two existing call sites (lines 138 and 212) should be removed to avoid double-calls.\n\n## Acceptance criteria\n- Every accepted webhook event with a resolvable body.repository.full_name triggers exactly one ensureCronProcess call for that repo.\n- Existing call sites at trigger_webhook.ts:138 and :212 are removed (no duplicate spawns).\n- Signature-rejected requests (HTTP 401) and unparseable JSON (HTTP 400) do not spawn a cron.\n- /health requests do not spawn a cron.\n- Unit test: a pull_request_review.submitted event with state=approved for a repo with no running cron causes ensureCronProcess to be invoked with that repo's RepoInfo.\n- Manual reproduction: with no cron running for this repo, posting an approval on a PR whose issue is in awaiting_merge results in the PR being merged on the spawned cron's next tick.\n\n## Out of scope\n- Whether the webhook should dispatch adwMerge directly on pull_request_review.approved (separate design decision; the current cron-only path is intentional).\n- The single-host invariant remains unchanged.\n\n## References\n- Bug surfaced while investigating #492 / PR #498\n- Related design context: adws/README.md#single-host-constraint, adws/triggers/mergeDispatchGate.ts, adws/triggers/cronIssueFilter.ts","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-28T08:51:43Z","comments":[],"actionableComment":null}`

## Bug Description
`trigger_webhook.ts` only calls `ensureCronProcess()` from two of its event branches:

- `issue_comment` (`action === 'created'`) at `adws/triggers/trigger_webhook.ts:138`
- `issues.opened` at `adws/triggers/trigger_webhook.ts:212`

Every other accepted event branch silently returns without ensuring a cron exists for the repo:

- `pull_request_review_comment` (lines 105–113)
- `pull_request_review` — including the `state === 'approved'` short-circuit at lines 115–126 (an approved review returns `{ status: 'ignored' }` with no cron spawn)
- `pull_request` closed and other actions (lines 174–182)
- `issues` actions other than `opened` — `closed`, `edited`, `labeled`, etc. (lines 184–227)
- All non-handled `event` values (drops to the `ignored` return at line 227)

The auto-merge path is cron-only: an `awaiting_merge` issue is only swept when `trigger_cron.ts` polls the repo. The webhook explicitly does **not** dispatch `adwMerge` directly (see the comment at `trigger_webhook.ts:120-121`). So if the only recent inbound traffic for a repo is a human approval (`pull_request_review.submitted` with `state === 'approved'`), no cron is ever spawned and the PR sits in `awaiting_merge` indefinitely.

**Symptoms:** PRs whose ADW state is `awaiting_merge` are never merged on hosts where the only inbound webhook signal for the repo is a non-handler-spawning event (most commonly an approving review). The webhook server returns `200 ignored`, the cron poller for the repo is never (re)spawned, and the merge gate never re-evaluates.

**Expected behavior:** Every accepted webhook event for a recognized repo guarantees that a cron poller is running for that repo, so the `awaiting_merge` sweeper has a chance to fire.

## Problem Statement
The cron poller is repo-scoped infrastructure that must be alive for the auto-merge sweeper, the `cronIssueFilter` re-evaluation loop, and stage reconciliation to function. Today, that infrastructure lifecycle is bolted onto two specific event branches (`issue_comment.created` and `issues.opened`). Every other webhook event — including the very signal (`pull_request_review.approved`) that most directly indicates a PR is ready to auto-merge — flows through a path that never touches `ensureCronProcess`. The result is silent stranding of `awaiting_merge` PRs whenever a host's recent inbound signals don't happen to be one of the two cron-respawn-bearing events.

## Solution Statement
Hoist the `ensureCronProcess()` call to a single central location at the top of the request body handler, immediately after `ensureAppAuthForRepo` (line 103) and before any per-event branching. Resolve the `RepoInfo` once from `body.repository.full_name` and the `targetRepoArgs` once via `extractTargetRepoArgs(body)`, then invoke `ensureCronProcess(repoInfo, targetRepoArgs)` exactly once per accepted event. Remove the two existing nested call sites at lines 138 and 212. Because `ensureCronProcess` is already idempotent (in-memory `cronSpawnedForRepo` Set fast-path plus an `isCronAliveForRepo` PID-file liveness check in `webhookGatekeeper.ts:148-160`), this is safe and adds negligible overhead.

The new placement is **after** the early returns for `/health` (line 79), `req.url !== '/webhook'` (line 81), `req.method !== 'POST'` (line 82), HTTP 401 signature rejection (line 91), and HTTP 400 invalid-JSON rejection (line 94). So those paths preserve their no-cron-spawn behavior naturally; no extra guarding is required.

## Steps to Reproduce
1. Start the webhook server on a host that does **not** have a cron poller running for the repo: `bunx tsx adws/triggers/trigger_webhook.ts`.
2. Confirm no cron PID file exists for the repo: `ls agents/cron-pids/ | grep <owner>_<repo>` returns nothing.
3. Drive an ADW issue through the SDLC pipeline so its `agents/<adwId>/state.json` reaches `workflowStage: "awaiting_merge"` and the PR is `APPROVED + MERGEABLE + CLEAN` with no `hitl` label (so the auto-merge gate `(no hitl) OR (PR approved)` is open).
4. Have a reviewer post an approving review (`pull_request_review.submitted` with `state === 'approved'`).
5. Observe the webhook server logs: the request is handled by the `pull_request_review` branch (lines 115–126), short-circuits at the `approved` check (line 121) with `{ status: 'ignored' }`, and never calls `ensureCronProcess`. No cron is spawned for the repo.
6. Observe that the PR remains unmerged indefinitely — the only path that can merge it (`adwMerge.tsx` dispatched by the cron sweep on `awaiting_merge`) never runs.

## Root Cause Analysis
The previous fix (issue #291 / ADW `wqzfqj-ensurecronprocess-no`, see `specs/issue-291-adw-wqzfqj-ensurecronprocess-no-sdlc_planner-ensure-cron-before-gates.md` and `app_docs/feature-wqzfqj-ensure-cron-before-webhook-gates.md`) correctly identified that `ensureCronProcess` was being skipped when issue-specific gates rejected an event — but only fixed the placement *within* the two event branches that already called it (`issue_comment` and `issues.opened`). It did not address the broader architectural problem: the cron lifecycle is per-repo, but it was wired into per-event-type branches, so any event type whose branch did not contain a call (`pull_request_review`, `pull_request_review_comment`, `pull_request.closed`, `issues.closed`, `issues.labeled`, etc.) silently bypasses cron respawn entirely.

The `pull_request_review.approved` short-circuit at lines 120–121 makes this especially painful: that exact signal is the one most likely to mean "this PR is ready to auto-merge," and the webhook intentionally does not dispatch `adwMerge` directly (it relies on the cron sweep, per the inline comment). When the cron is dead, that contract silently breaks.

The fix decouples the per-repo cron lifecycle from the per-event business logic by lifting `ensureCronProcess` to a single call site that runs for every accepted, body-parsed webhook request.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/trigger_webhook.ts` — The webhook HTTP server. Hoist the `ensureCronProcess` call to immediately after `ensureAppAuthForRepo` (line 103), before any `if (event === ...)` branching. Remove the existing calls at line 138 (in the `issue_comment` handler) and line 212 (in the `issues.opened` handler). The existing `commentTargetRepoArgs` declaration at line 137 and `issueTargetRepoArgs` declaration at line 209 should remain as-is (they are still used for the spawn dispatches further down) — they will simply no longer be the only consumers. To avoid duplicate `extractTargetRepoArgs(body)` calls, hoist a single `webhookTargetRepoArgs` declaration up alongside the new top-level `ensureCronProcess` call and reuse it inside the per-event branches.
- `adws/triggers/webhookGatekeeper.ts` — Contains `ensureCronProcess` (lines 144–169) and the `cronSpawnedForRepo` Set. **No changes needed.** Read for context: the function is idempotent — it short-circuits via the in-memory Set, falls through to `isCronAliveForRepo` (PID-file liveness), and only spawns a new `trigger_cron.ts` child if both checks miss.
- `adws/github/githubApi.ts` — Contains `getRepoInfoFromPayload` (line 55). **No changes needed.** Used to convert `body.repository.full_name` into a `RepoInfo`. Throws on invalid input — keep the call inside a try/catch or guard on `repoFullName` truthiness so a malformed payload does not crash the webhook server.
- `features/ensure_cron_on_webhook_gates.feature` — Existing BDD feature for the previous fix (issue #291). Update its top-level tags and per-scenario tags to include `@adw-501` and `@adw-0lhdw4-webhook-call-ensurec` so it participates in this issue's regression sweep, and update its description comment to note that issue #501 supersedes the per-handler placement (the call now lives at the request handler top-level). Its negative-constraint scenarios — that `ensureCronProcess` is not inside the deferred eligibility blocks — remain valid and continue to pass. Use as a reference for the BDD source-reading style and tagging conventions.
- `features/step_definitions/ensureCronBeforeGatesSteps.ts` — Existing step definitions that read `trigger_webhook.ts` source and assert call ordering inside specific handler bodies. **No changes needed.** Use as a reference for parsing handler bodies via brace-depth scanning.
- `features/step_definitions/commonSteps.ts` — Provides the `'{string} is read'` step that populates `sharedCtx.fileContent`. **No changes needed.** Reused by the new step definitions.
- `.adw/coding_guidelines.md` — Coding guidelines. ADW does not use unit tests for itself; BDD scenarios are the validation mechanism. Plan accordingly: the issue's "Unit test" acceptance criterion is satisfied via a structural BDD scenario that proves the `pull_request_review.submitted` branch reaches `ensureCronProcess` (because the call now precedes all event branching).
- `app_docs/feature-wqzfqj-ensure-cron-before-webhook-gates.md` — Prior feature doc; useful for understanding the partial nature of the previous fix.
- `adws/README.md` (Single-host constraint section, line 348) — Confirms the single-host invariant; this fix preserves it.

### New Files

- `features/webhook_ensure_cron_on_every_event.feature` — New BDD feature file with `@regression`, `@adw-501`, and `@adw-0lhdw4-webhook-call-ensurec` tags. Scenarios assert that `ensureCronProcess` is called exactly once at the top level of the request body handler, after `ensureAppAuthForRepo` and before every event branch; that the existing per-handler call sites are gone; that the call is gated on resolving a `RepoInfo` from `body.repository.full_name`; that rejected request paths (signature 401, JSON parse 400, `/health`, non-`/webhook`, non-POST) never reach the call; and that every per-event handler — including the `pull_request_review.approved` short-circuit — is reached after the top-level call.
- `features/step_definitions/ensureCronOnEveryEventSteps.ts` — New step definitions that read `adws/triggers/trigger_webhook.ts` source and assert: (a) `ensureCronProcess` appears exactly once in the file; (b) the call occurs before every `if (event === ...)` branch; (c) the call occurs after the `ensureAppAuthForRepo` call site; (d) the call does not appear inside any of the per-event handler bodies (`pull_request_review_comment`, `pull_request_review`, `issue_comment`, `pull_request`, `issues`/`action === 'opened'`); (e) the call is gated on a resolved `repoInfo` from `body.repository.full_name`; (f) the call is positioned after the signature validation, JSON parse, `/webhook` URL, and POST method checks; (g) the `/health` handler block does not contain the call; (h) the approved-review branch returns `ignored` without calling `ensureCronProcess` itself.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the relevant files for context
- Read `adws/triggers/trigger_webhook.ts` to confirm current line layout (the call sites at 138 and 212; the `ensureAppAuthForRepo` block at 97-103).
- Read `adws/triggers/webhookGatekeeper.ts` to confirm `ensureCronProcess` signature and idempotency contract.
- Read `features/ensure_cron_on_webhook_gates.feature` and `features/step_definitions/ensureCronBeforeGatesSteps.ts` for BDD style reference.
- Read `.adw/coding_guidelines.md`. Key guidelines for this fix: clarity over cleverness, modularity, isolate side effects at boundaries, guard clauses for invalid/edge cases first.

### 2. Hoist `ensureCronProcess` to a single top-level call site in `trigger_webhook.ts`
- Inside the `req.on('end', ...)` handler, immediately after the existing `ensureAppAuthForRepo` block (around lines 97–103) and before the `if (event === 'pull_request_review_comment')` branch:
  - Resolve the repo full name once: `const webhookRepoFullName = (body.repository as Record<string, unknown> | undefined)?.full_name as string | undefined;`
  - Resolve a `RepoInfo` once, guarded on truthiness: `const webhookRepoInfo = webhookRepoFullName ? getRepoInfoFromPayload(webhookRepoFullName) : undefined;`
  - Resolve target repo args once: `const webhookTargetRepoArgs = extractTargetRepoArgs(body);`
  - Call `ensureCronProcess` once, guarded on `webhookRepoInfo`: `if (webhookRepoInfo) ensureCronProcess(webhookRepoInfo, webhookTargetRepoArgs);`
- Place this block **after** the `/health` early return (line 79), the `/webhook` URL guard (line 81), the `POST` method guard (line 82), the signature validation 401 path (line 91), and the JSON parse 400 path (line 94). This preserves the no-cron-spawn behavior for `/health`, signature-rejected requests, and unparseable JSON without any extra guarding.
- The hoist must occur after `ensureAppAuthForRepo` so the spawned cron child inherits the correct app auth context for the repo.

### 3. Remove the now-redundant nested `ensureCronProcess` calls
- In the `issue_comment` handler: delete the line `if (webhookRepoInfo) ensureCronProcess(webhookRepoInfo, commentTargetRepoArgs);` at the existing line 138.
- In the `issues` `action === 'opened'` handler: delete the line `if (issueRepoInfo) ensureCronProcess(issueRepoInfo, issueTargetRepoArgs);` at the existing line 212.

### 4. De-duplicate the per-branch repo info / target args resolutions
- The existing per-branch declarations of `repoFullName` / `webhookRepoInfo` / `commentTargetRepoArgs` (`issue_comment`, lines 135-137) and `issueRepoFullName` / `issueRepoInfo` / `issueTargetRepoArgs` (`issues.opened`, lines 209-211) should be replaced with reuse of the new top-level `webhookRepoInfo` and `webhookTargetRepoArgs` bindings introduced in step 2.
- Likewise, the `closedRepoFullName` / `closedTargetRepoArgs` / `closedRepoInfo` declarations in the `issues.closed` branch (lines 191-195) should reuse the new top-level bindings.
- This is a small in-scope cleanup that follows from the hoist; it eliminates three duplicate `body.repository.full_name` / `extractTargetRepoArgs(body)` reads per request and keeps the code DRY without changing behavior.

### 5. Verify the early-return paths are unaffected
- Confirm by reading the file that `/health` returns at line 78 before reaching the new call site.
- Confirm that the HTTP 401 (invalid signature) and HTTP 400 (invalid JSON) paths return inside `req.on('end', ...)` before the new call site.
- Confirm that `req.url !== '/webhook'` (404) and `req.method !== 'POST'` (405) return at lines 81–82 before reaching the new call site.

### 6. Create new BDD feature file `features/webhook_ensure_cron_on_every_event.feature`
- Tag the feature with `@adw-501` and `@adw-0lhdw4-webhook-call-ensurec`.
- Include `@regression` on every scenario that maps to a stated acceptance criterion so it runs in the regression sweep.
- Scenario groups (each group maps directly to one or more issue acceptance criteria):

  **Top-level placement** (proves the call lives at the request handler top-level, after `ensureAppAuthForRepo` and before any per-event branching):
  1. `ensureCronProcess` is called at the request handler top-level in `trigger_webhook.ts`.
  2. `ensureCronProcess` is called after `ensureAppAuthForRepo` at the request handler top-level.
  3. `ensureCronProcess` is called before the first per-event branch in the request handler.
  4. `ensureCronProcess` is invoked exactly once per accepted webhook request (covers the issue's "no duplicate spawns" criterion).

  **Old per-handler call sites are removed** (proves the previous nested calls at lines 138 and 212 are gone):
  5. `ensureCronProcess` is no longer called inside the `issue_comment` handler.
  6. `ensureCronProcess` is no longer called inside the `issues.opened` handler.

  **Gated on resolving repoInfo**:
  7. The top-level `ensureCronProcess` call is gated on a resolved `repoInfo` from `body.repository.full_name`.

  **Rejected requests must not spawn a cron** (covers the issue's HTTP 401, HTTP 400, `/health`, non-`/webhook`, non-POST acceptance criteria):
  8. Signature-rejected requests do not reach the `ensureCronProcess` call site (the call is positioned after the signature validation check returns valid).
  9. Unparseable JSON requests do not reach the `ensureCronProcess` call site (the call is positioned after the `JSON.parse` step).
  10. GET `/health` requests do not call `ensureCronProcess` (the call is not inside the `/health` request handler block).
  11. Non-`/webhook` paths (404 branch) do not call `ensureCronProcess` (the call is positioned after the `/webhook` URL check).
  12. Non-POST methods on `/webhook` (405 branch) do not call `ensureCronProcess` (the call is positioned after the POST method check).

  **Approved-review path now reaches `ensureCronProcess`** (incident fix; satisfies the issue's "Unit test" acceptance criterion via structural source reading):
  13. `pull_request_review.submitted` with `state=approved` reaches the top-level `ensureCronProcess` call before its `ignored` short-circuit, and the approved-review branch itself does not call `ensureCronProcess`.
  14. `pull_request_review_comment` events reach the top-level `ensureCronProcess` call.
  15. `pull_request.closed` events reach the top-level `ensureCronProcess` call.
  16. `issues.closed` events reach the top-level `ensureCronProcess` call.

  **Type-check**:
  17. TypeScript type-check passes after the `ensureCronProcess` top-level relocation.

### 7. Create step definitions in `features/step_definitions/ensureCronOnEveryEventSteps.ts`
- Reuse `sharedCtx.fileContent` populated by the existing `'{string} is read'` step from `commonSteps.ts`.
- Follow the brace-depth handler-body extraction pattern from `ensureCronBeforeGatesSteps.ts` to scope assertions to specific event handlers.
- Implement steps:
  - `Then('{string} is called exactly once in the file', ...)` — count occurrences of `${name}(` in the full file content and assert exactly 1.
  - `Then('{string} is called before the {string} event branch', ...)` — find the offset of `${name}(` and the offset of `if (event === '${branch}')` (or `if (action === 'opened')` for the issues.opened sub-branch); assert the former is less than the latter.
  - `Then('{string} is called after {string} in the request handler', ...)` — assert offset of first arg is greater than offset of second arg.
  - `Then('{string} is not called inside the {string} handler body', ...)` — extract the handler body via the same brace-scanning logic used in `ensureCronBeforeGatesSteps.ts`, then assert `${name}(` does not appear inside it.
  - Reuse the existing `Then('the ADW TypeScript type-check passes', ...)` step from existing step definitions for the type-check scenario (do not redefine it).

### 8. Run the validation commands
- Run every command in the `Validation Commands` section below.
- The `pull_request_review.approved` BDD scenario in particular structurally proves the issue's "Unit test" acceptance criterion: by demonstrating that `ensureCronProcess` precedes the `pull_request_review` branch in source order, the test guarantees that any `pull_request_review.submitted` request — including `state === 'approved'` — reaches `ensureCronProcess` before the branch's `ignored` short-circuit at line 121.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Root TypeScript type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type-check.
- `bun run build` — Build the application to verify no build errors.
- `bun run test:unit` — Run any unit tests (no new unit tests are added by this fix; this confirms zero regressions in the existing unit suite).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-501"` — Run the new BDD scenarios for this fix and verify they pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-291"` — Re-run the previous-fix scenarios and verify they still pass (the new placement is upstream of the old call sites, so the structural ordering assertions about the `issue_comment` and `issues.opened` handlers must continue to hold even though the actual `ensureCronProcess` call has moved out of those handler bodies — the existing scenarios assert that `ensureCronProcess` appears *before* `isActionableComment` and *before* `checkIssueEligibility`, which is now trivially true because it is no longer in those handlers at all; if any existing scenario instead asserts that `ensureCronProcess` is *inside* a specific handler, update or remove it as part of step 6).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run the full regression scenario sweep.

### Manual reproduction (post-fix)
1. Start the webhook server on a host with no cron running for the repo: `bunx tsx adws/triggers/trigger_webhook.ts`.
2. Drive an ADW issue to `awaiting_merge` with an approved, mergeable PR (no `hitl` label).
3. Post an approving review on the PR.
4. Observe the webhook server logs: `Spawning cron trigger for <owner>/<repo>` should appear once, immediately after the `pull_request_review.submitted` request is received.
5. Within ~20s (the cron poll interval), observe that the auto-merge sweeper merges the PR.

## Notes
- `.adw/coding_guidelines.md` applies. Key relevant guidelines for this fix: clarity over cleverness (a single top-level call site is more readable than per-branch calls), modularity (cron lifecycle is decoupled from per-event business logic), guard clauses (the new call is gated only on `webhookRepoInfo` truthiness — a single early branch that mirrors the existing pattern), and isolate side effects at boundaries (the cron spawn is a side effect that belongs at the top of the request handler, before the per-event business logic).
- ADW itself does not use unit tests; agent-written unit tests are unreliable as quality gates per the coding guidelines. The issue's `Acceptance criteria` line "Unit test: a `pull_request_review.submitted` event with `state=approved`..." is satisfied via the structural BDD scenarios in step 6, which prove that `ensureCronProcess` precedes the `pull_request_review` branch and so will be invoked for any request that reaches that branch — including `state === 'approved'`. This matches the prior fix (issue #291) which used the same source-reading BDD pattern in lieu of a runtime mock-based unit test.
- No new libraries are needed for this fix.
- The previous fix (issue #291 / ADW `wqzfqj`) is partially superseded by this one: the call sites it relocated within `issue_comment` and `issues.opened` will no longer exist after this fix because the calls move to a single top-level location. The intent of the prior fix (cron must be respawned even when issue-specific gates reject an event) is preserved and broadened — every event branch, not just two, now reaches the cron respawn.
- The fix keeps the single-host invariant unchanged. It only ensures that whatever host is receiving webhooks for a repo also runs a cron for that repo. Two hosts receiving webhooks for the same repo remains undefined territory per `adws/README.md#single-host-constraint`.
- `getRepoInfoFromPayload` throws on a malformed `full_name` (e.g. one without exactly one `/`). The new top-level call must guard on `webhookRepoFullName` truthiness so a payload missing `repository.full_name` does not crash the webhook server. A malformed-but-present `full_name` (e.g. `foo` without a slash) is exotic enough that letting `getRepoInfoFromPayload` throw is acceptable — the existing per-branch usages already do this.
