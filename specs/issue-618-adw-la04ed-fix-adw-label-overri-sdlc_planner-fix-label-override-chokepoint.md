# Bug: `adw:*` label override only honored on 2 of 4 spawn paths

## Metadata
issueNumber: `618`
adwId: `la04ed-fix-adw-label-overri`
issueJson: `{"number":618,"title":"fix: adw:* label override only honored on 2 of 4 spawn paths — issue_comment webhook misclassifies labeled issues via LLM","body":"## Problem\n\nThe documented contract — \"adw:* GitHub labels provide a deterministic override that bypasses AI classification entirely\" (README) — is only honored on 2 of 4 spawn paths. An issue carrying a single adw:<type> label can still be sent to the LLM classifier and misclassified.\n\nObserved: Issue #614 carried exactly hitl + adw:bug. An actionable comment on it routed through the issue_comment webhook path, which skipped the label override, ran /classify_issue, and Sonnet classified the fix: issue as /feature (routing to adwSdlc.tsx instead of the bug path). Cost: $0.59 for a classification that should have been a free, deterministic label read.\n\nRoot cause: The override is a per-caller convention, not an enforced invariant. Callers that pre-read labels and pass labelRouting get it; callers that don't, silently fall through to the LLM. Cron + issues.opened pass labelRouting; issue_comment + dependency-closure do not.\n\nProposed fix: Push the override into the chokepoint classifyIssueForTrigger (adws/core/issueClassifier.ts), which already calls fetchGitHubIssue whose result includes labels. Add the deterministic guard there before the LLM call. Conflict (more than one adw:<type> classification label) falls through to the LLM as today.\n\nAcceptance criteria: single adw:<type> label deterministically selects the matching type on every trigger path with no /classify_issue invocation; multiple conflicting adw:* labels fall through to the LLM (unchanged); no adw:* label is classified by the LLM (unchanged); unit test covering single-label override, conflict fall-through, no-label fall-through.","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-06-17T11:54:17Z","comments":[],"actionableComment":null}`

## Bug Description
The README documents a load-bearing contract: *"`adw:*` GitHub labels provide a deterministic override that bypasses AI classification entirely."* In reality this override is honored on only **2 of the 4** orchestrator spawn paths. An issue carrying a single `adw:<type>` classification label can still be routed to the LLM classifier (`/classify_issue`) and **misclassified**.

**Expected behavior:** An issue with exactly one `adw:<type>` label (e.g. `adw:bug`) is deterministically classified as that type (`/bug`) on *every* spawn path — cron backlog sweep, `issues.opened` webhook, `issue_comment` webhook, and dependency-closure spawn — with **no** LLM invocation.

**Actual behavior:** Only the cron and `issues.opened` paths honor the override (they pre-read labels and pass a `labelRouting` argument). The `issue_comment` webhook path and the dependency-closure spawn path call `classifyAndSpawnWorkflow(...)` *without* `labelRouting`, so they fall through to `classifyIssueForTrigger` → `classifyWithIssueCommand` (the Sonnet LLM) with no label check at all.

**Observed incident:** Issue #614 carried exactly `hitl` + `adw:bug`. An actionable comment routed through the `issue_comment` webhook path, skipped the label override, ran `/classify_issue`, and Sonnet classified the `fix:` issue as `/feature` — routing it to `adwSdlc.tsx` (feature path) instead of the bug path. Cost: **$0.59** for a classification that should have been a free, deterministic label read.

## Problem Statement
The deterministic `adw:*` classification override is implemented as a **per-caller convention** rather than an enforced invariant. Each caller of `classifyAndSpawnWorkflow` is independently responsible for pre-reading the issue's labels and passing `labelRouting.precomputedClassification`. Two callers do this; two do not. The two that don't silently invoke the LLM classifier on labeled issues, producing misclassification and wasted LLM spend.

| Spawn path | Call site | Honors `adw:*` override today? |
|---|---|---|
| Cron backlog sweep | `adws/triggers/trigger_cron.ts:320-326` | ✅ pre-computes `labelRouting` from `readAdwLabelNames` |
| `issues.opened` webhook | `adws/triggers/issueOpenedRouter.ts:111,130-135` | ✅ pre-computes route from `readAdwLabelNames` |
| `issue_comment` webhook | `adws/triggers/trigger_webhook.ts:188` | ❌ no `labelRouting` argument |
| Dependency-closure spawn | `adws/triggers/webhookGatekeeper.ts:190` | ❌ no `labelRouting` argument |

## Solution Statement
Push the override down into the **single chokepoint** that every classification path funnels through: `classifyIssueForTrigger` in `adws/core/issueClassifier.ts`. That function already fetches the full issue via `fetchGitHubIssue` (whose JSON request includes `labels`), so the labels are already in hand at zero extra cost. Add a deterministic guard there, *before* the `classifyWithIssueCommand` LLM call:

```ts
const labelReading = readAdwLabels(issue);
if (labelReading.classification && !labelReading.conflict) {
  log(`Issue #${issueNumber}: adw:* label override -> ${labelReading.classification}, skipping AI classification`, 'success');
  return { issueType: labelReading.classification, success: true, issueTitle: issue.title };
}
```

This makes the override a real invariant: a caller that omits `labelRouting` can no longer fall through to the LLM, because the chokepoint enforces the label read itself. It also saves an LLM call on every labeled issue that reaches this function.

The existing `labelRouting` pre-computation in the cron and `issues.opened` paths remains valid and harmless — it is an *earlier* short-circuit inside `classifyAndSpawnWorkflow` (it avoids even fetching the issue for classification), and when present it bypasses `classifyIssueForTrigger` entirely. The new guard is the safety net for the paths that don't pre-compute.

**Conflict handling (unchanged):** When more than one `adw:<type>` classification label is present, `readAdwLabels` returns `{ classification: null, conflict: true }`, so the guard is skipped and the LLM heuristic runs exactly as today. We never pick one arbitrarily.

**No-label handling (unchanged):** When no `adw:<type>` label is present, `classification` is `null`, the guard is skipped, and the LLM heuristic runs as today.

This is a one-function change plus one import plus unit tests. No caller signatures change; no other path is touched.

## Steps to Reproduce
1. Create (or use) a GitHub issue whose body reads like a bug fix but whose *title/body wording* the LLM would plausibly classify as a feature. Apply exactly one classification label: `adw:bug` (optionally also `hitl`, as in #614).
2. Ensure there is **no** local ADW workflow state for the issue (so the takeover decision in `evaluateCandidate` is `spawn_fresh`, not `take_over_adwId`).
3. Trigger the **`issue_comment`** path: post an actionable comment on the issue so the webhook server's `issue_comment` handler fires (`adws/triggers/trigger_webhook.ts:188` → `classifyAndSpawnWorkflow(issueNumber, webhookRepoInfo, webhookTargetRepoArgs)` with no `labelRouting`).
4. **Observe (bug):** `classifyAndSpawnWorkflow` falls through to `classifyIssueForTrigger` → `classifyWithIssueCommand`, which invokes `/classify_issue` (Sonnet). The label `adw:bug` is ignored; the issue can be classified as `/feature` and routed to `adwSdlc.tsx`. An LLM call is billed.
5. Equivalent unit-level reproduction (used as the regression gate): call `classifyIssueForTrigger(n, repoInfo)` with `fetchGitHubIssue` mocked to return an issue carrying a single `adw:bug` label. **Before the fix:** the mocked `runClaudeAgentWithCommand` *is* invoked and the result depends on LLM output. **After the fix:** `runClaudeAgentWithCommand` is *not* invoked and the result is deterministically `/bug`.

## Root Cause Analysis
`classifyAndSpawnWorkflow` (`adws/triggers/webhookGatekeeper.ts:67-156`) chooses the classification source at line 125-127:

```ts
const classification = labelRouting?.precomputedClassification
  ? { issueType: labelRouting.precomputedClassification, success: true as const, issueTitle: labelRouting.issueTitle, adwId: undefined }
  : await classifyIssueForTrigger(issueNumber, resolvedRepoInfo);
```

The deterministic label override lives *only* in the `labelRouting?.precomputedClassification` branch. That branch is populated by callers who do the label read themselves:
- `trigger_cron.ts:320-323` computes `readAdwLabelNames(issue.labels...)` and builds `labelRouting`.
- `issueOpenedRouter.ts` computes `decideIssueOpenedRoute(readAdwLabelNames(labelNames))` and passes `precomputedClassification` for the `classified` route.

The two callers that do **not** pass `labelRouting` — `trigger_webhook.ts:188` (issue_comment) and `webhookGatekeeper.ts:190` (dependency-closure) — therefore take the `: await classifyIssueForTrigger(...)` branch. Inside `classifyIssueForTrigger` (`adws/core/issueClassifier.ts:90-127`) there is **no label inspection** — it fetches the issue and immediately calls the LLM via `classifyWithIssueCommand`. The labels are present in the fetched `issue` object (`fetchGitHubIssue` requests `labels` in its `--json` field list, `adws/github/issueApi.ts:115`) but are never consulted.

The fundamental defect is **placement**: the override is enforced at the call sites (a convention each caller must remember) instead of at the chokepoint they all share. This is the same class of failure the README's *"GitHub Project Board flakiness"* lesson calls out — *"when an external API has a non-obvious auth contract, codify it in a single chokepoint before every call site grows its own copy."* Here the contract is the label override, and the fix is the same shape: enforce it once at the chokepoint.

**adwId-continuity note (important for reviewers):** The early `return` in the override path skips the existing comment-scan adwId recovery at `issueClassifier.ts:109-119`. This is **intentional and consistent**: the cron and `issues.opened` label paths never call `classifyIssueForTrigger` at all (they take the `precomputedClassification` branch, which sets `adwId: undefined`), so they already do not perform comment-scan adwId recovery for label-routed issues. The override short-circuit makes the `issue_comment` and dependency-closure paths behave the *same way*. Furthermore, genuine takeover of an in-flight or recoverable run is decided **earlier** by `evaluateCandidate` (`adws/triggers/takeoverHandler.ts`), which resolves the canonical adwId from comments and returns `take_over_adwId` *before* classification is ever reached. The classifier's comment-scan recovery only matters in the narrow "adwId-in-comments but no local state" case, where `evaluateCandidate` returns `spawn_fresh` — and in that case a fresh adwId via `classifyAndSpawnWorkflow`'s existing `existingAdwId || classification.adwId || generateAdwId(...)` chain is the correct, already-established behavior for label-routed spawns.

## Relevant Files
Use these files to fix the bug:

- `adws/core/issueClassifier.ts` — **primary change.** `classifyIssueForTrigger` (lines 90-127) is the sole chokepoint reached by both `labelRouting`-less callers. Add the `readAdwLabels` import and the deterministic override guard immediately after `fetchGitHubIssue` and before `classifyWithIssueCommand`.
- `adws/core/__tests__/issueClassifier.test.ts` — **test change.** Currently covers only `classifyGitHubIssue`. Add a `describe` block for `classifyIssueForTrigger` covering single-label override (no LLM), conflict fall-through (LLM), and no-label fall-through (LLM). Must mock `fetchGitHubIssue`.
- `adws/github/labelManager.ts` — **read-only, source of truth.** Provides `readAdwLabels(issue: Pick<GitHubIssue,'labels'>): AdwLabelReading` and `ADW_CLASSIFICATION_LABELS` (`adw:chore`→`/chore`, `adw:bug`→`/bug`, `adw:feature`→`/feature`, `adw:pr_review`→`/pr_review`). `readAdwLabels` is a pure, hoisted function declaration — import it directly from this module (mirrors how `issueClassifier` already imports `fetchGitHubIssue` directly from `../github/githubApi`).
- `adws/github/issueApi.ts` — **read-only, confirms data availability.** `fetchGitHubIssue` (line 110) requests `labels` in its `gh issue view --json ...` field list, so `issue.labels` is always populated at the chokepoint.
- `adws/triggers/webhookGatekeeper.ts` — **read-only, context.** `classifyAndSpawnWorkflow` (line 67) is the function whose two `labelRouting`-less callers (`trigger_webhook.ts:188`, line `190` self-call) the fix repairs. No edit needed; the chokepoint fix covers them.
- `adws/triggers/trigger_webhook.ts` — **read-only, context.** The `issue_comment` path (line 188) — one of the two broken callers. No edit needed.
- `adws/triggers/trigger_cron.ts` — **read-only, context.** The cron path (lines 320-326) pre-computes `labelRouting`; its existing behavior remains the correct earlier short-circuit. No edit needed.
- `adws/triggers/issueOpenedRouter.ts` — **read-only, context.** The `issues.opened` path that already honors the override via `decideIssueOpenedRoute`. No edit needed.
- `adws/types/issueTypes.ts` — **read-only, types.** `GitHubIssue.labels: GitHubLabel[]`, `GitHubLabel = { id, name, color, description? }` (needed to build valid test fixtures), and `IssueClassSlashCommand`.

### Conditional Docs (consult before implementing — matched via `.adw/conditional_docs.md`)
- `app_docs/feature-25daxp-label-manager-deep-module.md` — `readAdwLabels` and label-based issue classification routing (`adw:chore`/`adw:bug`/`adw:feature`/`adw:pr_review`); wiring `readAdwLabels` into recovery/classification paths.
- `app_docs/feature-gmfhco-issues-opened-label-routed-handler.md` — `classifyAndSpawnWorkflow` `labelRouting` options, `readAdwLabelNames`, and the four routing branches (opt-out / classified / conflict / infer).
- `app_docs/feature-y35zbi-cron-recovery-label-eligibility-scan.md` — the `precomputedClassification` routing path in `trigger_cron.ts` (cron recovery bypassing the LLM classifier).
- `app_docs/feature-0cv18u-fix-cross-trigger-spawn-dedup.md` — `classifyAndSpawnWorkflow` in `webhookGatekeeper.ts` and the cron/webhook trigger paths.
- `app_docs/feature-u8okxe-bug-sdlc-chore-classifier.md` — modifying issue classification logic / the `/classify_issue` command and orchestrator routing per issue type.
- `app_docs/feature-vv6d4h-remove-adw-init-from-valid-types.md` — the classifier regex domain in `adws/core/issueClassifier.ts` (`classifyGitHubIssue`, `classifyWithIssueCommand`, `VALID_ISSUE_TYPES`).

### New Files
None. The fix is confined to `adws/core/issueClassifier.ts` and its existing test file.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1 — Add the failing regression test first (RED)
- Open `adws/core/__tests__/issueClassifier.test.ts`.
- Add a `vi.mock('../../github/githubApi', ...)` that exposes a mockable `fetchGitHubIssue` (a `vi.fn()`), preserving any other exports the module needs (use `importOriginal` if required for `RepoInfo`/types; only `fetchGitHubIssue` must be a mock). Do **not** mock `../../github/labelManager` — `readAdwLabels` must run for real against the fixture labels.
- Import `classifyIssueForTrigger` from `../issueClassifier` and the mocked `fetchGitHubIssue`. Add a `mockFetchIssue = vi.mocked(fetchGitHubIssue)` and reset it in `beforeEach`.
- Extend the `makeIssue` helper (or add a local builder) so a caller can pass `labels` as `GitHubLabel[]` (each `{ id, name, color }`; `description` optional). Provide a tiny `repoInfo` stub `{ owner: 'paysdoc', repo: 'AI_Dev_Workflow' }`.
- Add a new `describe('classifyIssueForTrigger — adw:* label override', ...)` with three tests:
  1. **single-label override:** `mockFetchIssue` resolves an issue with `labels: [{ id:'1', name:'adw:bug', color:'d73a4a' }]`. Assert `result.issueType === '/bug'`, `result.success === true`, `result.issueTitle === issue.title`, and `expect(mockRunAgent).not.toHaveBeenCalled()`.
  2. **conflict fall-through:** `labels: [adw:bug, adw:feature]`; set `mockRunAgent.mockResolvedValue({ success: true, output: '/feature' })`. Assert `expect(mockRunAgent).toHaveBeenCalledTimes(1)` and `result.issueType === '/feature'`.
  3. **no-label fall-through:** `labels: []`; set `mockRunAgent.mockResolvedValue({ success: true, output: '/chore' })`. Assert `expect(mockRunAgent).toHaveBeenCalledTimes(1)` and `result.issueType === '/chore'`.
- Run only this file (it must FAIL on test 1 before the fix, because today the LLM is always called):
  - `bunx vitest run adws/core/__tests__/issueClassifier.test.ts`

### Step 2 — Implement the chokepoint override (GREEN)
- In `adws/core/issueClassifier.ts`, add the import near the existing GitHub import:
  - `import { readAdwLabels } from '../github/labelManager';`
- In `classifyIssueForTrigger`, immediately after the line that logs the fetched issue title (`log(`classifyIssueForTrigger: issue #${issueNumber} title=...`)`) and **before** building `issueContext` / calling `classifyWithIssueCommand`, insert the guard:

```ts
// Deterministic adw:* label override — a single adw:<type> classification label
// bypasses AI classification on EVERY spawn path. Enforced at this sole
// chokepoint (all four triggers funnel here) rather than per-caller, so a caller
// that omits labelRouting cannot silently fall through to the LLM. Multiple
// conflicting adw:<type> labels (conflict === true) fall through to the
// heuristic, unchanged.
const labelReading = readAdwLabels(issue);
if (labelReading.classification && !labelReading.conflict) {
  log(`Issue #${issueNumber}: adw:* label override -> ${labelReading.classification}, skipping AI classification`, 'success');
  return { issueType: labelReading.classification, success: true, issueTitle: issue.title };
}
```

- Do not change any function signatures, the `classifyWithIssueCommand` implementation, the comment-scan adwId recovery block, or any caller. Keep guard-clause style (early return), consistent with `.adw/coding_guidelines.md` (max ~2 nesting levels, guard clauses, isolate the override as one clear concern).

### Step 3 — Confirm the regression test now passes
- `bunx vitest run adws/core/__tests__/issueClassifier.test.ts`
- All three new tests plus the existing `classifyGitHubIssue` / `VALID_ISSUE_TYPES` tests must pass.

### Step 4 — Type-check the change (catches the cross-module import / cycle concern)
- `bunx tsc --noEmit`
- `bunx tsc --noEmit -p adws/tsconfig.json`
- Both must report zero errors. (`issueClassifier` already imports from `../github/githubApi`; the new direct `readAdwLabels` import is a pure hoisted function and there is no `import/no-cycle` lint rule, so this is safe.)

### Step 5 — Lint
- `bun run lint`
- Must pass with no new errors (remove any unused imports; keep import ordering consistent with the file).

### Step 6 — Full regression: unit suite + build
- `bun run test:unit` — entire vitest suite must pass with zero regressions.
- `bun run build` — must compile with no errors.

### Step 7 — Run the Validation Commands section end-to-end
- Execute every command in `## Validation Commands` in order and confirm each exits cleanly.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Run from the worktree root.

- **Reproduce at unit level BEFORE the fix (expect FAILURE on the single-label test):** with Step 1's tests added but Step 2 not yet applied — `bunx vitest run adws/core/__tests__/issueClassifier.test.ts` → the single-label override test fails because the LLM mock is invoked.
- **Reproduce AFTER the fix (expect PASS):** `bunx vitest run adws/core/__tests__/issueClassifier.test.ts` → all tests pass; `runClaudeAgentWithCommand` is not called for the single-label case.
- `bun run lint` — ESLint clean (`eslint .`).
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` project type-check passes.
- `bun run test:unit` — full vitest suite (`vitest run`) passes with zero regressions.
- `bun run build` — `tsc` build succeeds with no errors.

## Notes
- **Coding guidelines:** `.adw/coding_guidelines.md` applies. The change uses a guard clause / early return (≤2 nesting levels), keeps the override as one clearly-named concern, isolates side effects (`log`, `fetchGitHubIssue`) at the function boundary, and adds a JSDoc-style rationale comment for the non-obvious chokepoint placement. No `any`, no decorators, no new mutation.
- **No new library** is required. (If one ever were, the install command per `.adw/commands.md` is `bun add <package>`.)
- **Why the chokepoint, not the call sites:** fixing the two broken callers individually would re-create the same per-caller convention that caused the bug. Enforcing the override once in `classifyIssueForTrigger` makes it a real invariant across all four paths and additionally saves an LLM call on every labeled issue that reaches the function. This mirrors the README's "single chokepoint" lesson (e.g. `withProjectBoardAuth`).
- **Scope boundary — `adw:none` (opt-out) is intentionally NOT handled here.** This bug is specifically the *classification* override. `readAdwLabels` also surfaces `optOut`, but adding opt-out enforcement at the chokepoint would change behavior on the `issue_comment` / dependency-closure paths (which currently do process `adw:none` issues) and is out of scope for #618. The acceptance criteria mention only `adw:<type>` classification labels. Leave opt-out behavior unchanged.
- **adwId continuity is preserved** for real takeovers via `evaluateCandidate` (`take_over_adwId`), which runs before classification; the override short-circuit only affects genuinely-fresh spawns and aligns the two previously-broken paths with the already-correct cron / `issues.opened` paths. See the Root Cause "adwId-continuity note" above.
- **Test mocking caveat:** `classifyIssueForTrigger` calls `fetchGitHubIssue` from `../github/githubApi`, so the new tests must mock that module (the existing tests only mock `../../agents/claudeAgent`). Keep `readAdwLabels` real so the pure label-reading logic is exercised against the fixtures.
- This fix has no runtime dependency on the BDD/scenario suite; validation is via the vitest unit gate, type-check, lint, and build, consistent with how `issueClassifier` is already covered.
