# Feature: Slack notifications for HITL-gated board transitions (→ Review / → Blocked)

## Metadata
issueNumber: `587`
adwId: `5jigj8-slack-notifications`
issueJson: `{"number":587,"title":"Slack notifications for HITL-gated board transitions (→ Review / → Blocked)","state":"OPEN","author":"paysdoc","labels":[]}`

## Feature Description
Add Slack notifications that fire whenever a **HITL-gated** issue (one carrying the `hitl` label) undergoes an **ADW-driven** project-board transition that needs human awareness:

- **→ Review** (`BoardStatus.Review`): the PR is open and waiting for a human to approve it so the stateless auto-merge gate (`gate_open = (no hitl) OR (PR approved)`) can open. The notification links to the **PR** so the reviewer can act immediately.
- **→ Blocked** (`BoardStatus.Blocked`), but **only** for the two genuinely human-relevant terminal sources: a **discarded** workflow (PR closed without merge / terminal decision) and a **PR-review error**. The notification links to the **issue**.

All notifications are filtered to issues carrying the `hitl` label (non-HITL issues are silent — they auto-merge without a human in the loop, so there is nothing to notify). Only **ADW-driven** transitions are in scope; manual board drags are out of scope. The feature reuses the existing `SLACK_WEBHOOK_URL` (the same channel as the auth-gate alerts produced by `core/slackNotifier.ts`); splitting channels is deferred until/unless the volume proves noisy.

The value: a reviewer on a human-gated issue gets a push the moment ADW needs them — to approve a PR (unblocking merge) or to look at a terminally-stuck workflow — instead of having to poll the board.

## User Story
As a **reviewer/maintainer responsible for `hitl`-labelled issues**
I want to **receive a Slack message when ADW moves one of my HITL-gated issues into Review (PR awaiting approval) or into a Blocked terminal state (discarded or PR-review error)**
So that **I can approve the PR to open the auto-merge gate, or investigate a stuck workflow, without watching the project board.**

## Problem Statement
ADW's auto-merge gate is stateless and human-gated: when an issue carries the `hitl` label, the PR will not auto-merge until a human approves it. Today nothing actively tells the human that their approval is the only thing standing between the PR and merge — the issue silently sits in Review. Symmetrically, when a HITL-gated workflow ends in a terminal Blocked state that a human should look at (the PR was closed/discarded, or the PR-review phase errored out), there is no push notification; the issue just changes column on the board. Reviewers must poll the board to discover both situations, which defeats the point of a human-in-the-loop gate.

The existing `core/slackNotifier.ts` already proves the delivery mechanism (it sends auth-gate alerts over `SLACK_WEBHOOK_URL`, no-throw at the boundary), but nothing wires board transitions to it, and there is no module that owns the PR/issue lookup + message building for board events.

## Solution Statement
Introduce a thin GitHub-layer module, `adws/github/hitlBoardNotifier.ts`, that owns: (1) the single `gh issue view` read that both checks the `hitl` label and grabs the title, (2) the self-contained PR lookup for the Review message, (3) the two Blocked message templates, and (4) delivery via the existing Slack webhook. It is **no-throw at its boundary** and never blocks or fails a workflow.

Wire it at the three places ADW moves a HITL-relevant issue:

1. **Review (link to PR)** — a **fire-and-forget** call inside `moveIssueToStatus` (`adws/github/projectBoardApi.ts`), placed **after the real board write**, guarded to the Review transition. This single chokepoint covers both Review call sites (`prPhase.ts:92` and `prReviewPhase.ts:344`) automatically, and the function's existing "already in target status" short-circuits give free dedup (re-asserting Review never double-pings).
2. **PR-review error (link to issue)** — an **awaited** call inside `handlePRReviewWorkflowError` (`adws/phases/prReviewCompletion.ts`), which already moves the board to Blocked. The handler becomes `async` and its caller (`adws/adwPrReview.tsx:117`) awaits it **before `process.exit`**, so the notification isn't killed by the exit.
3. **Discarded (link to issue)** — an **awaited** call at the **live discard site** in `adws/adwMerge.tsx` (the "PR closed without merge" branch that writes the `discarded` stage), injected through `MergeDeps` for testability. (See the **Verified discrepancy** note below — the issue named `handleWorkflowCompletion`'s `handleWorkflowDiscarded` as the hook, but that handler has no live caller, so wiring only there would be dead code.)

Because the new module lives in the github layer and `github/` must not depend on `providers/` (that would invert the existing `providers/github → github` dependency and risk a cycle), the **non-GitHub no-op is enforced at the call sites** (which live in `phases/` and the orchestrators, above both layers), not inside the notifier. The Review hook is GitHub-only by construction (it is literally GitHub Projects V2 code); the Blocked hooks guard on `repoContext.repoId.platform === Platform.GitHub` (or the orchestrator's `repoId.platform`).

### ⚠️ Verified discrepancy with the issue (resolution baked into this plan)
The issue specifies the discarded hook as `adws/phases/workflowCompletion.ts:220` (inside `handleWorkflowDiscarded`) and refers to "the discarded caller" that must `await` it. **`handleWorkflowDiscarded` is re-exported but never invoked anywhere in the repo** (verified by full-repo grep — only re-exports in `adwMerge.tsx:39` and `phases/index.ts:14`, plus a doc comment). The live discard path is `adwMerge.tsx:159`, which writes `workflowStage: 'discarded'` directly via `writeTopLevelState` and does **not** move the board to Blocked or call `handleWorkflowDiscarded`. Implemented exactly as the issue describes, the discarded notification would be **dead code with no caller to await**.

**Resolution adopted here:** wire the awaited discarded notification at the **live `adwMerge` discard site** (via `MergeDeps` injection) so it actually fires, **and** additionally honor the issue's named edit by making `handleWorkflowDiscarded` `async` + adding the same notification inside it as a forward-compatible/dormant hook. The two paths are mutually exclusive at runtime (the live discard never routes through `handleWorkflowDiscarded`), so there is no double-notify. The `review_error` half (`handlePRReviewWorkflowError`, called at `adwPrReview.tsx:117`) is live and matches the issue exactly.

## Relevant Files
Use these files to implement the feature:

- `adws/core/slackNotifier.ts` — existing Slack webhook client. Holds the private `postSlack(text)` helper (POST to `SLACK_WEBHOOK_URL`, 10s timeout, no-throw). Must **export** `postSlack` (or add a thin exported `sendSlackMessage(text)`) so the github-layer notifier can reuse it. `github → core` is a legal dependency direction.
- `adws/github/projectBoardApi.ts` — `moveIssueToStatus(issueNumber, targetStatus, repoInfo)` is the single chokepoint for every board transition. The Review hook is added here after the real write (`updateProjectItemStatus`, ~line 284). Note: this file currently imports **no** provider types — keep it that way (guard the Review transition with a string-literal compare, not the `BoardStatus` enum, to avoid a `github → providers` edge).
- `adws/phases/prReviewCompletion.ts` — `handlePRReviewWorkflowError(...)` (line ~77) already moves the board to Blocked on PR-review failure (line 88) and calls `process.exit(1)`. Becomes `async` (`: never` → `: Promise<never>`); awaits the review-error notification (guarded on `Platform.GitHub`) before exit. `phases/` may import both `github/` and `providers/`.
- `adws/adwPrReview.tsx` — line 117 calls `handlePRReviewWorkflowError(config, error, ...)` in the `catch`. Change to `await handlePRReviewWorkflowError(...)` so the floating notification survives the exit.
- `adws/adwMerge.tsx` — the **live discard site**. Line 157–161 (`prState === 'CLOSED'`) writes `workflowStage: 'discarded'`. Add an awaited discarded notification here via a new `MergeDeps` field; update `buildDefaultDeps()`. `executeMerge` already receives `issueNumber` and `repoInfo`; the platform guard uses `repoId` resolved in `main()`.
- `adws/phases/workflowCompletion.ts` — `handleWorkflowDiscarded(...)` (line ~205). Honor the issue by making it `async` and adding the same `notifyBlockedTransition({ source: 'discarded' })` call before `process.exit(0)` (dormant today — see discrepancy note). Guard on `Platform.GitHub`.
- `adws/github/prApi.ts` — reuse `selectPreferredPR(prs)` and the `RawPR`/`RawPRListEntry` shapes for the Review PR lookup; mirror the `body?.match(/Implements #(\d+)/)` convention used in `fetchPRDetails` (line 134) for the digit-boundary filter.
- `adws/github/issueApi.ts` — reference for the gh-read pattern (`issueHasLabel` at line 272 parses `--json labels`; `fetchGitHubIssue` at line 110 uses `gh issue view ... --json ...`). The notifier does its **own single** `gh issue view N --json title,labels` call (one call → label check **and** title), reusing `execWithRetry` from core.
- `adws/github/githubApi.ts` — `RepoInfo` interface (`{ owner, repo }`); the notifier operates on this github-layer type.
- `adws/providers/types.ts` — `BoardStatus` enum (`Review = 'Review'`, `Blocked = 'Blocked'`), `Platform` enum, `RepoIdentifier` (`{ owner, repo, platform }`), `RepoContext` (`{ issueTracker, codeHost, repoId, ... }`). Used at the call sites for the platform guard (not imported into the github-layer notifier).
- `adws/phases/prPhase.ts` (line 92) and `adws/phases/prReviewPhase.ts` (line 344) — the two Review call sites that flow through `moveIssueToStatus`; read-only confirmation that the chokepoint covers both. No edits required.
- `adws/core/__tests__/slackNotifier.test.ts` — the unit-test pattern to mirror (`vi.stubEnv('SLACK_WEBHOOK_URL', ...)`, `vi.stubGlobal('fetch', mockFetch)`, asserts on POST body, no-throw on rejection).
- `adws/__tests__/adwMerge.test.ts` — the `executeMerge — closed PR` test (line ~178) must be updated when `MergeDeps` gains the notifier field (extend the `makeDeps` helper with a mock).
- `adws/github/index.ts` — barrel export; add `hitlBoardNotifier` exports so call sites import from `./github`.

### New Files
- `adws/github/hitlBoardNotifier.ts` — the notifier module. Exports `notifyReviewTransition({ issueNumber, repoInfo })` (fire-and-forget) and `notifyBlockedTransition({ issueNumber, repoInfo, source, errorMessage? })` (awaited). Owns the single `gh issue view` read + `hitl` early-return, the Review PR lookup, the three message templates, and delivery via `postSlack`. No-throw at its boundary. Uses only `core` + sibling `github` modules (no `providers` import). Under 300 lines (coding-guideline cap).
- `adws/github/__tests__/hitlBoardNotifier.test.ts` — unit tests: `hitl` filter (no label → no Slack POST, no PR lookup), Review PR-lookup disambiguation (`Implements #12` vs `#123` digit-boundary; promotion-PR bodies that say "Moves scenario…" do not match), both Blocked templates + error-snippet truncation, and the no-throw boundary.

## Implementation Plan
### Phase 1: Foundation
Expose the Slack primitive and build the self-contained notifier module so the wiring in Phase 2/3 is a one-line call at each site.
- Export `postSlack` from `core/slackNotifier.ts` (minimal change: `async function postSlack` → `export async function postSlack`; keep the existing `sendSlack*` functions using it).
- Create `adws/github/hitlBoardNotifier.ts` with the two public functions, the shared single-`gh issue view` read (`title` + `labels` in one call, early-return when `hitl` is absent), the Review PR lookup (`gh pr list --state open --json number,url,body,headRefName,updatedAt,state` → filter bodies by `Implements #${issueNumber}` with a digit boundary → `selectPreferredPR`), the message builders, and the `issueUrl` derivation (`https://github.com/${owner}/${repo}/issues/${issueNumber}`). Wrap each public function in try/catch so it never throws.
- Add the notifier unit test.

### Phase 2: Core Implementation (wire the three transition sites)
- **Review:** add the fire-and-forget `void notifyReviewTransition({ issueNumber, repoInfo })` inside `moveIssueToStatus`, immediately after the successful `updateProjectItemStatus(...)` call, guarded by `targetStatus.toLowerCase() === 'review'` (string literal — no provider import). The pre-write short-circuits (already-in-status) return before this point, giving free dedup.
- **PR-review error:** make `handlePRReviewWorkflowError` `async` (`Promise<never>`); inside the `if (repoContext)` block, after the existing `moveToStatus(Blocked)`, guard `if (repoContext.repoId.platform === Platform.GitHub)` and `await notifyBlockedTransition({ issueNumber: config.base.issueNumber, repoInfo: { owner: repoContext.repoId.owner, repo: repoContext.repoId.repo }, source: 'review_error', errorMessage: ctx.errorMessage })` before `process.exit(1)`.
- **Discarded (live):** extend `MergeDeps` with `notifyBlockedTransition: typeof notifyBlockedTransition` (default in `buildDefaultDeps()`); in the `prState === 'CLOSED'` branch, after `deps.writeTopLevelState(adwId, { workflowStage: 'discarded' })`, `await deps.notifyBlockedTransition({ issueNumber, repoInfo, source: 'discarded' })`. Apply the `Platform.GitHub` guard using the `repoId` available in `main()` (thread platform into `executeMerge`, or guard before the awaited call).
- **Discarded (dormant, honor the issue):** make `handleWorkflowDiscarded` `async` (`Promise<never>`) and add the same `notifyBlockedTransition({ source: 'discarded' })` call (guarded on `Platform.GitHub`) before `process.exit(0)`. Re-exports of this symbol remain valid for an async function.

### Phase 3: Integration
- Update `adws/adwPrReview.tsx:117` to `await handlePRReviewWorkflowError(...)`.
- Export the notifier from `adws/github/index.ts`.
- Update `adws/__tests__/adwMerge.test.ts` `makeDeps` to provide a mock `notifyBlockedTransition`, and assert it is called (with `source: 'discarded'`) in the closed-PR test.
- Run the full validation suite (lint, typecheck, unit tests, build) and confirm zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Export the Slack primitive
- In `adws/core/slackNotifier.ts`, change `async function postSlack(text: string)` to `export async function postSlack(text: string)`. Do not change its behavior (it already no-ops when `SLACK_WEBHOOK_URL` is unset and is no-throw).
- Confirm `adws/core/index.ts` re-exports it if call sites import `postSlack` from `../core` (the notifier may import directly from `../core/slackNotifier` to keep the barrel minimal — match the surrounding import style).

### 2. Create the notifier module `adws/github/hitlBoardNotifier.ts`
- Add a file-level doc comment stating: owns PR/issue lookup + message building + Slack delivery for HITL board events; no-throw at boundary; GitHub-layer (no `providers` import — non-GitHub no-op is enforced by callers).
- Define `interface NotifyReviewArgs { issueNumber: number; repoInfo: RepoInfo }` and `interface NotifyBlockedArgs { issueNumber: number; repoInfo: RepoInfo; source: 'discarded' | 'review_error'; errorMessage?: string }`.
- Implement a private `readIssueTitleAndHitl(issueNumber, repoInfo): { title: string; hasHitl: boolean } | null` doing a **single** `gh issue view ${issueNumber} --repo ${owner}/${repo} --json title,labels` via `execWithRetry`, parsing `{ title, labels: { name }[] }`; return `null` on error (fail-closed → no notification).
- Implement a private `findReviewPr(issueNumber, repoInfo): string | null` (returns the PR URL): `gh pr list --repo ${owner}/${repo} --state open --json number,url,body,headRefName,updatedAt,state --limit 50`, filter entries whose body matches `Implements #${issueNumber}` with a digit boundary (parse `/Implements #(\d+)/g` and compare the captured number `=== issueNumber`, or use `new RegExp(\`Implements #${issueNumber}(?!\\d)\`)`), pass the filtered list to `selectPreferredPR`, return the chosen entry's `url` (or `null`).
- Implement `notifyReviewTransition(args)`: in a try/catch — read title+hitl; **return early if `!hasHitl`**; look up the PR URL; if found, `await postSlack(\`:eyes: HITL issue #${issueNumber} "${title}" → In Review. Approve to merge: ${prUrl}\`)`; log + swallow on any error.
- Implement `notifyBlockedTransition(args)`: in a try/catch — read title+hitl; **return early if `!hasHitl`**; derive `issueUrl`; build the message by `source`:
  - `discarded` → `:no_entry: HITL issue #${issueNumber} "${title}" discarded (PR closed/terminal): ${issueUrl}`
  - `review_error` → `:warning: HITL issue #${issueNumber} "${title}" — PR review failed: ${snippet} — needs attention: ${issueUrl}` where `snippet` is `errorMessage` truncated to ~200 chars with newlines replaced by spaces (e.g. `(errorMessage ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)`).
  - `await postSlack(message)`; log + swallow on any error.
- Keep the file under 300 lines; extract the message builders into small named pure functions if the file grows.

### 3. Add the notifier unit test `adws/github/__tests__/hitlBoardNotifier.test.ts`
- Mirror `slackNotifier.test.ts`: `vi.stubEnv('SLACK_WEBHOOK_URL', ...)`, `vi.stubGlobal('fetch', mockFetch)`, and mock the `gh` reads (mock `execWithRetry` / the `child_process` boundary the notifier uses).
- Cases: (a) issue without `hitl` → no `fetch` POST and (for Review) no PR lookup; (b) Review with multiple open PRs where only `Implements #587` matches (not `#5870`/`#58`) → message contains that PR's URL; (c) a promotion-style PR body ("Moves scenario…") does not false-match; (d) discarded template content + `issueUrl`; (e) review_error template truncates a long multi-line `errorMessage` to a single ≤200-char line; (f) a rejected `fetch`/`gh` error is swallowed (function resolves, never throws).

### 4. Wire the Review notification into `moveIssueToStatus`
- In `adws/github/projectBoardApi.ts`, import `notifyReviewTransition` from `./hitlBoardNotifier`.
- After the successful `updateProjectItemStatus(projectId, projectItem.itemId, statusField.fieldId, matchedOption.id)` call (~line 284) and its success `log(...)`, add:
  ```ts
  if (targetStatus.toLowerCase() === 'review') {
    void notifyReviewTransition({ issueNumber, repoInfo });
  }
  ```
- Confirm placement is **after** the real write and **inside** the success path (so skips/early-returns at lines ~261/279 never reach it → free dedup).

### 5. Wire the PR-review-error notification (live)
- In `adws/phases/prReviewCompletion.ts`, import `notifyBlockedTransition` from `../github` and `Platform` from `../providers/types`.
- Change `handlePRReviewWorkflowError(...)` return type from `: never` to `: Promise<never>` and mark it `async`.
- Inside `if (repoContext) { ... }`, after `repoContext.issueTracker.moveToStatus(config.base.issueNumber, BoardStatus.Blocked).catch(() => {})`, add:
  ```ts
  if (repoContext.repoId.platform === Platform.GitHub) {
    await notifyBlockedTransition({
      issueNumber: config.base.issueNumber,
      repoInfo: { owner: repoContext.repoId.owner, repo: repoContext.repoId.repo },
      source: 'review_error',
      errorMessage: ctx.errorMessage,
    });
  }
  ```
- Keep `process.exit(1)` as the last statement.

### 6. Update the PR-review error caller to await
- In `adws/adwPrReview.tsx`, change line 117 from `handlePRReviewWorkflowError(config, error, ...)` to `await handlePRReviewWorkflowError(config, error, ...)`. The enclosing function is already `async`.

### 7. Wire the discarded notification at the live `adwMerge` site
- In `adws/adwMerge.tsx`, import `notifyBlockedTransition` from `./github`.
- Add `readonly notifyBlockedTransition: typeof notifyBlockedTransition;` to the `MergeDeps` interface and set it in `buildDefaultDeps()`.
- In the `prState === 'CLOSED'` branch (after `deps.writeTopLevelState(adwId, { workflowStage: 'discarded' })`), add an awaited call:
  ```ts
  await deps.notifyBlockedTransition({ issueNumber, repoInfo, source: 'discarded' });
  ```
- Enforce the GitHub-only guard: thread the platform from the `repoId` built in `main()` into `executeMerge` (e.g. add it to the call or guard the dep call), so non-GitHub targets no-op. `adwMerge`'s `main()` already builds `repoId = buildRepoIdentifier(targetRepo)` which carries `platform`.

### 8. Wire the dormant `handleWorkflowDiscarded` hook (honor the issue)
- In `adws/phases/workflowCompletion.ts`, import `notifyBlockedTransition` from `../github` and `Platform` from `../providers/types`.
- Make `handleWorkflowDiscarded(...)` `async` (`: never` → `: Promise<never>`). Inside `if (repoContext)`, after the existing `moveToStatus(Blocked)`, add the `Platform.GitHub`-guarded `await notifyBlockedTransition({ issueNumber, repoInfo: { owner: repoContext.repoId.owner, repo: repoContext.repoId.repo }, source: 'discarded' })` before `process.exit(0)`.
- Add a short comment noting this handler is currently uninvoked (the live discard notification is wired in `adwMerge.tsx`); this hook is forward-compatible for any future caller and must be `await`ed by such a caller before exiting.
- Verify the existing re-exports (`adwMerge.tsx:39`, `phases/index.ts:14`) still typecheck for the now-async signature.

### 9. Export the notifier from the github barrel
- Add `export { notifyReviewTransition, notifyBlockedTransition } from './hitlBoardNotifier';` (and any shared types) to `adws/github/index.ts`.

### 10. Update existing tests affected by `MergeDeps`
- In `adws/__tests__/adwMerge.test.ts`, extend the `makeDeps` helper to include a `notifyBlockedTransition: vi.fn().mockResolvedValue(undefined)`.
- In the `executeMerge — closed PR` test, assert `deps.notifyBlockedTransition` was called with `{ issueNumber: 42, repoInfo: REPO_INFO, source: 'discarded' }` (or `expect.objectContaining({ source: 'discarded' })`).
- Scan for any other test that constructs `MergeDeps` and add the new field.

### 11. Run the validation commands
- Execute every command in **Validation Commands** below and confirm all pass with zero regressions.

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so the feature includes Vitest unit tests.

- **New — `adws/github/__tests__/hitlBoardNotifier.test.ts`:**
  - `hitl` filter: an issue whose `labels` lack `hitl` produces **no** Slack POST (and, for Review, **no** PR lookup) — the single `gh issue view` is the only read.
  - Review PR-lookup disambiguation: with several open PRs, only the one whose body contains `Implements #587` (digit-boundary) is selected; `#5870` and `#58` do not match; a "Moves scenario…" promotion body never matches; `selectPreferredPR` picks the most-recently-updated open PR when more than one legitimately matches.
  - Message templates: Review (`:eyes:` + PR URL), discarded (`:no_entry:` + issue URL), review_error (`:warning:` + truncated snippet + issue URL).
  - Error-snippet hygiene: a multi-line ~1KB `errorMessage` is collapsed to a single line ≤200 chars.
  - No-throw boundary: a rejected `fetch` or a failing `gh` read resolves without throwing.
- **Updated — `adws/__tests__/adwMerge.test.ts`:** the closed-PR test asserts the injected `notifyBlockedTransition` is invoked with `source: 'discarded'`; the merged/open paths do **not** invoke it.
- Mock the Slack delivery with `vi.stubGlobal('fetch', ...)` and mock the `gh` reads at the `execWithRetry`/`child_process` boundary, exactly as the existing tests do — never hit the network or `gh`.

### Edge Cases
- **Non-HITL issue** at every site → single `gh issue view`, early return, zero Slack traffic.
- **No matching PR found** for a Review transition (read-your-write lag is avoided by using the immediately-consistent `gh pr list` list endpoint, not `--search`) → no message, no throw, workflow unaffected.
- **`SLACK_WEBHOOK_URL` unset** → `postSlack` logs a warning and no-ops (inherited behavior).
- **Re-asserting Review** when the issue is already in Review → `moveIssueToStatus` short-circuits before the hook → no duplicate ping.
- **Non-GitHub repo** (GitLab/Jira issue tracker; board managers are stubs) → call-site `Platform.GitHub` guard skips the Blocked notification; the Review hook is never reached (GitHub Projects code only).
- **`abandoned` transitions** (`handleWorkflowError`, `workflowCompletion.ts:155`) are intentionally **silent** — that path auto-retries via cron (`isRetriableStage`), so it self-heals. Do not wire it.
- **Process exit race:** the awaited Blocked calls must complete before `process.exit`; the fire-and-forget Review call runs while the orchestrator keeps executing (it is not exiting), so it has time to complete.
- **Error snippet never leaks secrets/stack traces in full** — capped at ~200 single-line chars.

## Acceptance Criteria
- A new module `adws/github/hitlBoardNotifier.ts` exports `notifyReviewTransition` and `notifyBlockedTransition`, is no-throw at its boundary, imports nothing from `adws/providers/`, and is under 300 lines.
- Moving a **`hitl`** issue to Review via `moveIssueToStatus` triggers exactly one `:eyes:` Slack message linking to the correct PR (disambiguated by `Implements #${issueNumber}` with a digit boundary); a non-HITL issue triggers none; re-asserting Review triggers none.
- A PR-review error on a **`hitl`** issue posts one `:warning:` message linking to the issue, with a ≤200-char single-line error snippet, and the message is delivered **before** `adwPrReview` exits (handler is `async`, caller awaits).
- A discarded (PR-closed-without-merge) **`hitl`** workflow in `adwMerge` posts one `:no_entry:` message linking to the issue, delivered before exit; non-HITL discards are silent.
- `abandoned` transitions post nothing.
- Non-GitHub targets post nothing (call-site platform guard).
- All four validation commands pass; `bun run test:unit` is green including the new notifier tests and the updated `adwMerge` test; no existing test regresses.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are taken from `.adw/commands.md`.

- `bun run lint` — ESLint clean (no unused imports, nesting within guidelines).
- `bunx tsc --noEmit` — root typecheck passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws typecheck passes (catches the `: never` → `: Promise<never>` signature change and the `MergeDeps` extension propagating to all constructors/tests).
- `bun run test:unit` — all Vitest unit tests pass, including `adws/github/__tests__/hitlBoardNotifier.test.ts` and the updated `adws/__tests__/adwMerge.test.ts`.
- `bun run build` — build succeeds with no errors.
- (Optional, regression safety net) `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — confirm no board/merge/PR-review regression scenarios break.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) apply strictly: guard clauses / early returns over nesting (the `hitl` early-return and the `Platform.GitHub` guards are guard clauses by design); each file single-responsibility and under 300 lines; isolate side effects (the gh reads and Slack POST are the only effects, confined to the notifier and the thin call-site hooks); no `any` (type the `gh` JSON shapes); no decorators.
- **Layering decision (load-bearing):** the notifier stays in the `github/` layer and must not import from `providers/`. `providers/github/*` already imports `github/*`; a reverse edge would create a cycle and invert the intended direction. Consequently the "no-op for non-GitHub" property the issue assigns to the notifier is implemented at the **call sites** (`phases/`, orchestrators) via `Platform.GitHub` guards — the Review hook is GitHub-only by construction. Do not "fix" this by importing `Platform` into the notifier.
- **Guard the Review transition with a string literal** (`targetStatus.toLowerCase() === 'review'`) rather than importing `BoardStatus` into `projectBoardApi.ts`, for the same layering reason. `BoardStatus.Review === 'Review'` is asserted by `providers/__tests__/boardManager.test.ts:88`, so the literal stays correct. (The board column may display as "In Review" via fuzzy match, but callers always pass the `'Review'` target — guard on the request, not the matched option name.)
- **Discrepancy resolution (see the ⚠️ section above):** `handleWorkflowDiscarded` is currently uninvoked, so the issue's literal hook would be dead code. This plan wires the *live* discarded notification in `adwMerge.tsx` (via `MergeDeps`) **and** keeps the issue's `handleWorkflowDiscarded` edit as a dormant, forward-compatible hook. If the maintainer prefers strictly one location, the live `adwMerge` wiring is the one that must stay (it is what fires today). This was surfaced for confirmation during planning; the dual approach is the safe default (mutually exclusive at runtime → no double-notify).
- **No new dependencies** are required (`fetch`, `gh` CLI, and the existing cost/state plumbing suffice). Library install command, if ever needed: `bun add <package>` (per `.adw/commands.md`).
- **Channel reuse is intentional** — `SLACK_WEBHOOK_URL` is shared with the auth-gate alerts; splitting channels is explicitly deferred until volume warrants it.
- **Teardown latency** is bounded: each discarded/review_error exit adds one `gh issue view` (and, for Review, one `gh pr list`) plus an optional Slack POST capped by `postSlack`'s 10s `AbortSignal.timeout`. Slack traffic only occurs on `hitl` issues.
- **BDD/regression:** per-issue scenarios tagged `@adw-587` are authored by the downstream `scenario_writer` phase, not in this plan; the regression suite above is the safety net for the touched chokepoints (`moveIssueToStatus`, the completion handlers, `adwMerge`).
