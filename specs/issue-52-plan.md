# PR-Review: Implement central target repo registry across ADW codebase

## PR-Review Description
The original implementation for issue #52 fixed the immediate bug by passing `repoInfo` from the webhook trigger to the issue classifier. However, the PR review from **paysdoc** rejected this approach because it did not adhere to the issue's core requirement:

> Instead of allowing individual ADW components to determine which repository they are working in, they need to get the target repository from a central registry (e.g. state) and only ever use that repository.
> IMPORTANT: the central registry is the only truth for determining which repository to use.

The current implementation still relies on:
1. **Optional `repoInfo?` parameters** threaded through every function call
2. **`getRepoInfo()` fallback** in every GitHub API function that reads from `git remote get-url origin` (the ADW repo's local git remote)
3. **No central source of truth** — each component independently determines or receives its repo context

The review requires a **central registry pattern** implemented across the **whole ADW codebase** so that:
- A single registry holds the target repo identity per process
- All GitHub API functions read from this registry by default
- No individual component calls `getRepoInfo()` as a fallback
- Entry points (triggers, orchestrators) initialize the registry once at startup

## Summary of Original Implementation Plan
The original plan at `specs/issue-52-adw-issue-classifier-run-0hgk57-sdlc_planner-fix-classifier-wrong-repo.md` addressed the immediate bug by:
1. Adding `repoInfo?: RepoInfo` parameter to `classifyIssueForTrigger()` in `issueClassifier.ts`
2. Passing target repo info from the webhook trigger's payload to the classifier in `trigger_webhook.ts`
3. Adding tests for the new parameter in `issueClassifier.test.ts`

This was a targeted fix that threaded `repoInfo` through the classifier. The PR review requires replacing this ad-hoc threading with a centralized registry pattern across the entire codebase.

## Relevant Files
Use these files to resolve the review:

### New Files
- `adws/core/targetRepoRegistry.ts` — The new central registry module. Provides `setTargetRepo()`, `getTargetRepo()`, `clearTargetRepo()`, and `hasTargetRepo()` functions. This is the single source of truth for all repository context.
- `adws/__tests__/targetRepoRegistry.test.ts` — Unit tests for the registry module covering: setting/getting, clearing, fallback behavior, and `hasTargetRepo()`.

### Modified Files
- `adws/core/index.ts` — Add exports for the new registry functions so they're available across the codebase.
- `adws/github/issueApi.ts` — Replace all 7 instances of `repoInfo ?? getRepoInfo()` with `repoInfo ?? getTargetRepo()` so that when `repoInfo` is not explicitly passed, the registry is consulted instead of the local git remote. Remove the direct `getRepoInfo` import.
- `adws/github/prApi.ts` — Replace all 4 instances of `repoInfo ?? getRepoInfo()` with `repoInfo ?? getTargetRepo()`. Remove the direct `getRepoInfo` import.
- `adws/phases/workflowLifecycle.ts` — Call `setTargetRepo()` in `initializeWorkflow()` to initialize the registry for all downstream phases. If `targetRepo` is provided, use it; otherwise, set from `getRepoInfo()` so the registry is always initialized.
- `adws/phases/prReviewPhase.ts` — Call `setTargetRepo()` in `initializePRReviewWorkflow()` to initialize the registry. Replace the `getRepoInfo()` fallback at line 305 (`config.repoInfo?.repo ?? getRepoInfo().repo`) with `config.repoInfo?.repo ?? getTargetRepo().repo`.
- `adws/triggers/trigger_webhook.ts` — Set the registry via `setTargetRepo()` before processing each webhook event (before calling `classifyIssueForTrigger`, `clearIssueComments`, etc.). Clear after spawning the detached orchestrator.
- `adws/triggers/trigger_cron.ts` — Call `setTargetRepo(repoInfo)` at startup after extracting local repo info, so all downstream calls (e.g., `classifyIssueForTrigger`, `clearIssueComments`) use the registry.
- `adws/github/workflowCommentsBase.ts` — The `isAdwRunningForIssue` function already passes `repoInfo` explicitly to `fetchGitHubIssue`, and the fallback in `fetchGitHubIssue` will now use the registry. No changes needed to this file, but verify it works correctly.
- `adws/__tests__/issueClassifier.test.ts` — Existing tests remain valid. Add mock for `getTargetRepo` to ensure registry-based fallback is tested.
- `guidelines/coding_guidelines.md` — Referenced for adherence. No changes needed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Create the central target repo registry module

- Create `adws/core/targetRepoRegistry.ts` with:
  - `import type { RepoInfo } from '../github/githubApi'` (type-only import to avoid circular runtime deps)
  - Module-level state: `let registryRepoInfo: RepoInfo | null = null`
  - `setTargetRepo(repoInfo: RepoInfo): void` — Sets the registry value. Log the setting for debugging: `log(\`Target repo registry set: \${repoInfo.owner}/\${repoInfo.repo}\`)`
  - `getTargetRepo(): RepoInfo` — Returns the registry value if set. If not set, lazily import and call `getRepoInfo()` as a fallback (log a warning: `'Target repo registry not initialized, falling back to local git remote'`). Use dynamic import or direct import of `getRepoInfo` to handle this.
  - `clearTargetRepo(): void` — Resets registry to null. Used by triggers between webhook events.
  - `hasTargetRepo(): boolean` — Returns `true` if registry has been set.
- Keep the file minimal and pure. The fallback to `getRepoInfo()` ensures backward compatibility for any code path that doesn't initialize the registry.

**Implementation note on circular dependencies**: The `adws/core/` and `adws/github/` layers already have circular import patterns (e.g., `workflowLifecycle.ts` imports from `../github` and `github/` imports from `../core`). These work because ESM uses live bindings and the values are accessed at function call time, not import time. Use `import { getRepoInfo } from '../github/githubApi'` directly — no lazy loading needed.

### 2. Export registry functions from core index

- Open `adws/core/index.ts`
- Add a new export block for the target repo registry:
  ```
  // Target repo registry
  export { setTargetRepo, getTargetRepo, clearTargetRepo, hasTargetRepo } from './targetRepoRegistry';
  ```

### 3. Update `adws/github/issueApi.ts` to use registry fallback

- Add import: `import { getTargetRepo } from '../core/targetRepoRegistry'`
- Remove `getRepoInfo` from the import of `./githubApi` (keep `type RepoInfo`)
- Replace all 7 instances of `repoInfo ?? getRepoInfo()` with `repoInfo ?? getTargetRepo()`:
  - `fetchGitHubIssue` (line 110)
  - `commentOnIssue` (line 132)
  - `getIssueState` (line 171)
  - `closeIssue` (line 194)
  - `getIssueTitleSync` (line 229)
  - `fetchIssueCommentsRest` (line 250)
  - `deleteIssueComment` (line 274)

### 4. Update `adws/github/prApi.ts` to use registry fallback

- Add import: `import { getTargetRepo } from '../core/targetRepoRegistry'`
- Remove `getRepoInfo` from the import of `./githubApi` (keep `type RepoInfo`)
- Replace all 4 instances of `repoInfo ?? getRepoInfo()` with `repoInfo ?? getTargetRepo()`:
  - `fetchPRDetails` (line 56)
  - `fetchPRReviewComments` (line 124)
  - `commentOnPR` (line 169)
  - `fetchPRList` (line 187)

### 5. Initialize registry in `adws/phases/workflowLifecycle.ts`

- Add import: `import { setTargetRepo } from '../core/targetRepoRegistry'`
- In `initializeWorkflow()`, after resolving `repoInfo` (around line 158-160), add:
  ```typescript
  // Initialize central target repo registry
  if (repoInfo) {
    setTargetRepo(repoInfo);
  }
  ```
- This ensures ALL downstream phase functions automatically use the correct repo from the registry, even without explicit `repoInfo` parameter threading.

### 6. Initialize registry in `adws/phases/prReviewPhase.ts`

- Add import: `import { setTargetRepo, getTargetRepo } from '../core/targetRepoRegistry'`
- In `initializePRReviewWorkflow()`, after resolving the config, set the registry if `repoInfo` is available. Currently the function doesn't receive `repoInfo` — it needs to accept it as a parameter or derive it from the PR details. Add `repoInfo?: RepoInfo` parameter and set the registry:
  ```typescript
  if (repoInfo) {
    setTargetRepo(repoInfo);
  }
  ```
  Also store `repoInfo` in the returned config so it propagates to phases.
- In `completePRReviewWorkflow()` at line 305, replace:
  ```typescript
  const repoName = config.repoInfo?.repo ?? getRepoInfo().repo;
  ```
  with:
  ```typescript
  const repoName = config.repoInfo?.repo ?? getTargetRepo().repo;
  ```
- Remove the `getRepoInfo` import from `../github` (keep the `import type { RepoInfo }`).

### 7. Update `adws/adwPrReview.tsx` to pass `repoInfo` to PR review workflow

- Read the current `adwPrReview.tsx` to understand how it initializes the PR review workflow.
- It already parses `--target-repo` args via `parseTargetRepoArgs`. Convert the `TargetRepoInfo` to `RepoInfo` and pass it to `initializePRReviewWorkflow()`:
  ```typescript
  const targetRepo = parseTargetRepoArgs(args);
  const repoInfo = targetRepo ? { owner: targetRepo.owner, repo: targetRepo.repo } : undefined;
  const config = await initializePRReviewWorkflow(prNumber, adwId, repoInfo);
  ```

### 8. Set registry in `adws/triggers/trigger_webhook.ts`

- Add import: `import { setTargetRepo, clearTargetRepo } from '../core/targetRepoRegistry'` (import from `../core` barrel or directly)
- In the **issue_comment** handler (around line 220-224), after extracting `webhookRepoInfo`, add:
  ```typescript
  if (webhookRepoInfo) {
    setTargetRepo(webhookRepoInfo);
  }
  ```
  This sets the registry before `clearIssueComments` and `classifyIssueForTrigger` are called.
- In the **issues opened** handler (around line 327-329), after extracting `issueRepoInfo`, add:
  ```typescript
  if (issueRepoInfo) {
    setTargetRepo(issueRepoInfo);
  }
  ```
- In the **pull_request_review** handler (around line 171-194), extract repoInfo from payload and set registry:
  ```typescript
  const prRepository = body.repository as Record<string, unknown> | undefined;
  const prRepoFullName = prRepository?.full_name as string | undefined;
  if (prRepoFullName) {
    setTargetRepo(getRepoInfoFromPayload(prRepoFullName));
  }
  ```
- In the **issue closed** handler (around line 307-315), extract repoInfo and set registry before `removeWorktreesForIssue`:
  ```typescript
  const closedRepoFullName = closedTargetRepoArgs.length >= 2 ? closedTargetRepoArgs[1] : undefined;
  if (closedRepoFullName) {
    setTargetRepo(getRepoInfoFromPayload(closedRepoFullName));
  }
  ```
- In the **pull_request closed** handler (around line 270-284), set registry before `handlePullRequestEvent`:
  ```typescript
  const prCloseRepository = body.repository as Record<string, unknown> | undefined;
  const prCloseRepoFullName = prCloseRepository?.full_name as string | undefined;
  if (prCloseRepoFullName) {
    setTargetRepo(getRepoInfoFromPayload(prCloseRepoFullName));
  }
  ```

### 9. Set registry in `adws/triggers/trigger_cron.ts`

- Add import: `import { setTargetRepo } from '../core/targetRepoRegistry'` (import from `../core` barrel or directly)
- After `const repoInfo = getRepoInfo()` (line 27), add:
  ```typescript
  setTargetRepo(repoInfo);
  ```
- The cron trigger always works on the local repo, so this sets the registry once at startup. All downstream calls (`classifyIssueForTrigger`, `clearIssueComments`, `fetchOpenIssues`, etc.) will automatically use the registry.

### 10. Create unit tests for the registry

- Create `adws/__tests__/targetRepoRegistry.test.ts` with tests:
  - **`setTargetRepo` and `getTargetRepo`**: Set a repo, verify `getTargetRepo()` returns it.
  - **`clearTargetRepo`**: Set a repo, clear it, verify `getTargetRepo()` falls back to `getRepoInfo()`.
  - **`hasTargetRepo`**: Verify returns `false` initially, `true` after setting, `false` after clearing.
  - **Fallback behavior**: When registry is not set, verify `getTargetRepo()` calls `getRepoInfo()` and returns its result.
  - **Override behavior**: When registry IS set, verify `getTargetRepo()` returns the registry value even if `getRepoInfo()` would return something different.
- Mock `getRepoInfo` from `../github/githubApi` in tests.
- Mock `log` from `../core` to suppress output.
- Use `beforeEach` to call `clearTargetRepo()` for test isolation.

### 11. Update existing tests to work with the registry

- Review `adws/__tests__/issueClassifier.test.ts`:
  - The existing mock of `fetchGitHubIssue` should continue to work since `fetchGitHubIssue` is fully mocked.
  - Verify that the tests for `classifyIssueForTrigger` with and without `repoInfo` still pass.
- Review other test files that mock `getRepoInfo`:
  - Search for `vi.mock.*githubApi` or `getRepoInfo` in test files.
  - If any test relies on `getRepoInfo` being the fallback in `issueApi.ts` or `prApi.ts`, update to mock `getTargetRepo` from the registry instead.
  - Since API functions are fully mocked in most tests, the fallback change should be transparent.

### 12. Run validation commands

- Run all validation commands to confirm zero regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npx vitest run adws/__tests__/targetRepoRegistry.test.ts` — Run the new registry tests
- `npx vitest run adws/__tests__/issueClassifier.test.ts` — Run classifier tests to validate registry integration
- `npx vitest run adws/__tests__/triggerSpawnArgs.test.ts` — Run trigger spawn args tests
- `npx vitest run adws/__tests__/webhookClearComment.test.ts` — Run webhook clear comment tests
- `npx vitest run adws/__tests__/triggerCommentHandling.test.ts` — Run trigger comment handling tests
- `npm test` — Run full test suite to validate zero regressions
- `npx tsc --noEmit` — Type-check main project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type-check ADW scripts
- `npm run lint` — Lint for code quality issues
- `npm run build` — Build to verify no build errors

## Notes
- **Circular import safety**: The `adws/core/` and `adws/github/` layers already have bidirectional import patterns (e.g., `workflowLifecycle.ts` imports from `../github`, and `github/` imports from `../core`). ESM live bindings ensure these work correctly since values are accessed at function call time, not import time. The new `targetRepoRegistry.ts` follows this established pattern.
- **Backward compatibility**: The `getTargetRepo()` function falls back to `getRepoInfo()` when the registry is not set. This ensures any untouched code path (e.g., test utilities, one-off scripts) continues to work. However, all primary entry points (orchestrators, triggers) should initialize the registry.
- **Optional `repoInfo` parameters preserved**: The `repoInfo?` parameters on GitHub API functions are kept for explicit overrides. The registry acts as the default when `repoInfo` is not provided. This is a practical approach — the registry IS the central truth, but explicit overrides are still possible for edge cases.
- **Trigger process scope**: The webhook trigger handles multiple repos across different events in a single process. The registry is set per-event before processing. Since webhook events are handled sequentially (Node.js single-threaded), this is safe without additional concurrency controls.
- **PR Review workflow**: The `initializePRReviewWorkflow` function currently doesn't accept `repoInfo`. Step 6 adds this parameter so external repo context flows into the PR review workflow and the registry is initialized.
