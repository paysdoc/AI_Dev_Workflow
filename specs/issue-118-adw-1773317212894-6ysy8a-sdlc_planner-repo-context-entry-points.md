# Chore: Refactor triggers and orchestrators to create RepoContext at entry points

## Metadata
issueNumber: `118`
adwId: `1773317212894-6ysy8a`
issueJson: `{"number":118,"title":"Refactor triggers and orchestrators to create RepoContext at entry points","body":"## Summary\nUpdate all workflow entry points (orchestrators and triggers) to create a `RepoContext` at startup and pass it through to phases. This completes the migration away from the global mutable registry.\n\n## Dependencies\n- #117 — Phases must accept RepoContext before entry points can provide it\n\n## User Story\nAs a developer, I want every workflow run to establish an immutable, validated repo context at the very start so that all subsequent operations are guaranteed to target the correct repository.\n\n## Acceptance Criteria\n\n### Update orchestrators\nFor each orchestrator (`adwPlan.tsx`, `adwBuild.tsx`, `adwPlanBuild.tsx`, `adwSdlc.tsx`, etc.):\n- After parsing CLI arguments, create `RepoContext` via the factory\n- Pass `RepoContext` to `initializeWorkflow()` / phase execution\n- Remove any direct calls to `setTargetRepo()`\n\n### Update triggers\n**`trigger_cron.ts`**:\n- When spawning orchestrator processes, pass repo identifier as CLI argument (not relying on env var alone)\n- Each spawned process creates its own `RepoContext`\n\n**`trigger_webhook.ts`**:\n- Extract repo identifier from webhook payload\n- Create `RepoContext` for the target repo before dispatching to orchestrator logic\n- Remove `setTargetRepo()` calls in webhook handlers\n\n### Entry-point validation\n- Each entry point validates that the repo context is consistent:\n  - CLI-provided repo URL matches git remote in working directory\n  - Webhook payload repo matches expected configuration\n- Fail fast with clear error messages on mismatch\n\n### Tests\n- Test orchestrator entry points create valid `RepoContext`\n- Test triggers pass repo identity correctly to spawned processes\n- Test validation catches mismatches\n\n## Notes\n- After this issue, `setTargetRepo()` / `getTargetRepo()` should have zero callers in orchestrators and triggers. They may still be called internally during transition — full removal happens in the next issue.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:18:51Z","comments":[],"actionableComment":null}`

## Chore Description
This chore migrates all workflow entry points (orchestrators and triggers) away from the global mutable `setTargetRepo()`/`getTargetRepo()` registry toward explicit `RepoContext` creation at startup. Currently, `RepoContext` is created deep inside `initializeWorkflow()` (in `workflowInit.ts`) after worktree setup. The goal is to establish repo identity at the outermost entry point so that every downstream operation receives an immutable, validated context — not a global singleton.

Key changes:
1. **Orchestrators** parse CLI args, construct a `RepoIdentifier`, and pass it explicitly to `initializeWorkflow()` which creates the `RepoContext` after worktree setup — removing the `setTargetRepo()` call.
2. **Triggers** extract repo identity from webhook payloads or CLI config, pass it via spawned process args, and remove their own `setTargetRepo()` calls. Internal trigger operations that need repo info will receive it explicitly.
3. **Entry-point validation** ensures CLI-provided repo identity matches the git remote in the working directory (already handled by `createRepoContext()`'s `validateGitRemote()`).
4. After this issue, `setTargetRepo()`/`getTargetRepo()` should have zero callers in orchestrators and triggers.

## Relevant Files
Use these files to resolve the chore:

### Core Infrastructure
- `adws/providers/types.ts` — Defines `RepoContext`, `RepoIdentifier`, `Platform` types. Reference for the target type.
- `adws/providers/repoContext.ts` — `createRepoContext()` factory function with validation (`validateRepoIdentifier`, `validateWorkingDirectory`, `validateGitRemote`). This is the factory orchestrators will use.
- `adws/core/targetRepoRegistry.ts` — Contains `setTargetRepo()`, `getTargetRepo()`, `clearTargetRepo()`, `hasTargetRepo()`. These calls will be removed from orchestrators/triggers.
- `adws/core/targetRepoManager.ts` — `ensureTargetRepoWorkspace()`, `getTargetRepoWorkspacePath()`. Used for external repo workspace setup.
- `adws/core/orchestratorCli.ts` — Shared CLI argument parsing (`parseOrchestratorArguments()`). May need extension to parse/return `RepoIdentifier`.
- `adws/core/utils.ts` — `parseTargetRepoArgs()` function that extracts `--target-repo` and `--clone-url` from CLI args.
- `adws/core/config.ts` — Configuration management, `getRepoInfo()` for local repo detection.
- `adws/core/constants.ts` — `OrchestratorId` constants used by all orchestrators.

### Workflow Initialization
- `adws/phases/workflowInit.ts` — `initializeWorkflow()` function and `WorkflowConfig` interface. Currently calls `setTargetRepo()` (line 101) and creates `RepoContext` internally (lines 215-229). Must be refactored to accept `RepoIdentifier` / skip `setTargetRepo()`.
- `adws/phases/prReviewPhase.ts` — `initializePRReviewWorkflow()` function and `PRReviewWorkflowConfig`. Similarly calls `setTargetRepo()` (line 49) and creates `RepoContext` internally.

### Orchestrators (all need updating)
- `adws/adwPlan.tsx` — Planning orchestrator. Uses `parseTargetRepoArgs()` + `parseOrchestratorArguments()` + `initializeWorkflow()`.
- `adws/adwBuild.tsx` — Build orchestrator. Custom `parseArguments()` helper, does NOT use shared `parseOrchestratorArguments()`. Needs alignment.
- `adws/adwPlanBuild.tsx` — Plan+Build orchestrator. Uses shared parsing + `initializeWorkflow()`.
- `adws/adwPlanBuildTest.tsx` — Plan+Build+Test orchestrator. Uses shared parsing + `initializeWorkflow()`.
- `adws/adwPlanBuildTestReview.tsx` — Plan+Build+Test+Review orchestrator. Uses shared parsing + `initializeWorkflow()`.
- `adws/adwPlanBuildReview.tsx` — Plan+Build+Review orchestrator. Uses shared parsing + `initializeWorkflow()`.
- `adws/adwPlanBuildDocument.tsx` — Plan+Build+Document orchestrator. Uses shared parsing + `initializeWorkflow()`.
- `adws/adwSdlc.tsx` — Full SDLC orchestrator. Uses shared parsing + `initializeWorkflow()`.
- `adws/adwTest.tsx` — Test orchestrator. Custom parsing, minimal init.
- `adws/adwDocument.tsx` — Document orchestrator. Custom parsing, minimal init.
- `adws/adwPatch.tsx` — Patch orchestrator. Uses `parseOrchestratorArguments()`.
- `adws/adwPrReview.tsx` — PR Review orchestrator. Different workflow, uses `initializePRReviewWorkflow()`.
- `adws/adwInit.tsx` — Init orchestrator. Uses shared parsing + `initializeWorkflow()`.
- `adws/adwClearComments.tsx` — Utility script. Minimal parsing.
- `adws/adwBuildHelpers.ts` — Shared helpers for adwBuild.

### Triggers
- `adws/triggers/trigger_cron.ts` — Cron polling trigger. Calls `setTargetRepo(getRepoInfo())` at startup (line 32). Spawns orchestrators via `classifyAndSpawnWorkflow()`.
- `adws/triggers/trigger_webhook.ts` — Webhook trigger. Calls `setTargetRepo()` at 5 locations for different event types. Uses `getRepoInfoFromPayload()` and `extractTargetRepoArgs()`.
- `adws/triggers/webhookHandlers.ts` — Webhook event processing logic. Functions may depend on `getTargetRepo()` fallback.
- `adws/triggers/webhookGatekeeper.ts` — `classifyAndSpawnWorkflow()`, `spawnDetached()`. Constructs spawn args.
- `adws/triggers/concurrencyGuard.ts` — Concurrency management for trigger processing.

### Existing Tests (patterns to follow)
- `adws/phases/__tests__/helpers/makeRepoContext.ts` — Test helper factory for mock `RepoContext`.
- `adws/providers/__tests__/repoContext.test.ts` — Tests for `createRepoContext()` factory.
- `adws/core/__tests__/targetRepoRegistry.test.ts` — Tests for the registry.
- `adws/triggers/__tests__/` — Existing trigger tests (spawn verification, argument construction).
- `adws/__tests__/` — Root-level orchestrator tests.

### Coding Guidelines
- `guidelines/coding_guidelines.md` — Must follow: immutability, type safety, modularity, single responsibility, strict TypeScript.

### New Files
- `adws/core/__tests__/orchestratorRepoContext.test.ts` — Tests for orchestrator entry-point RepoContext creation and validation.
- `adws/triggers/__tests__/triggerRepoContext.test.ts` — Tests for trigger repo identity passing and validation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `repoId` option to `initializeWorkflow()` in `workflowInit.ts`

- Read `adws/phases/workflowInit.ts` fully.
- Add an optional `repoId?: RepoIdentifier` field to the `initializeWorkflow()` options parameter (alongside existing `targetRepo`, `cwd`, `issueType`).
- When `repoId` is provided, use it directly for `RepoContext` creation (lines 215-229) instead of deriving from `targetRepo` or `getRepoInfo()`.
- Remove the `setTargetRepo(repoInfo)` call (line 101) when `repoId` is provided. Keep backward compatibility: if `repoId` is NOT provided, fall back to existing behavior (derive from `targetRepo` or local git remote, call `setTargetRepo()`).
- Update the `RepoContext` creation block (lines 215-229) to use `repoId` when available, using `worktreePath` as the `cwd`.
- Import `RepoIdentifier` and `Platform` from `adws/providers/types.ts`.
- Ensure the `WorkflowConfig` returned always has `repoContext` populated when `repoId` is provided.

### Step 2: Add `repoId` option to `initializePRReviewWorkflow()` in `prReviewPhase.ts`

- Read `adws/phases/prReviewPhase.ts` fully.
- Add an optional `repoId?: RepoIdentifier` field to the function's options.
- When `repoId` is provided, use it for `RepoContext` creation instead of deriving from `repoInfo`.
- Remove the `setTargetRepo()` call (line 49) when `repoId` is provided. Keep backward compat fallback.
- Import `RepoIdentifier` from `adws/providers/types.ts`.

### Step 3: Create a shared helper to build `RepoIdentifier` from CLI args

- Read `adws/core/orchestratorCli.ts` and `adws/core/utils.ts`.
- Add a new exported function `buildRepoIdentifier(targetRepo: TargetRepoInfo | null): RepoIdentifier` to `adws/core/orchestratorCli.ts` (or `utils.ts`, wherever fits best alongside existing parsing).
- This function:
  - If `targetRepo` is provided (external repo), constructs `RepoIdentifier` from `targetRepo.owner` and `targetRepo.repo` with `Platform.GitHub`.
  - If `targetRepo` is null (local repo), calls `getRepoInfo()` from `config.ts` to get owner/repo and constructs `RepoIdentifier` with `Platform.GitHub`.
- This centralizes the logic so every orchestrator can call it after `parseTargetRepoArgs()`.

### Step 4: Update orchestrators that use `initializeWorkflow()` to pass `repoId`

For each of these orchestrators, apply the same pattern:
- `adws/adwPlan.tsx`
- `adws/adwPlanBuild.tsx`
- `adws/adwPlanBuildTest.tsx`
- `adws/adwPlanBuildTestReview.tsx`
- `adws/adwPlanBuildReview.tsx`
- `adws/adwPlanBuildDocument.tsx`
- `adws/adwSdlc.tsx`
- `adws/adwInit.tsx`

For each file:
- After `parseTargetRepoArgs(args)` and `parseOrchestratorArguments(args, ...)`, call `buildRepoIdentifier(targetRepo)` to get the `RepoIdentifier`.
- Pass `repoId` in the options to `initializeWorkflow()`:
  ```typescript
  const repoId = buildRepoIdentifier(targetRepo);
  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.XXX, {
    issueType: ...,
    targetRepo: targetRepo || undefined,
    repoId,
  });
  ```
- Import `buildRepoIdentifier` from the appropriate module.
- Do NOT remove the `targetRepo` option yet — it's still needed for workspace cloning logic in `initializeWorkflow()`.

### Step 5: Update `adwBuild.tsx` to construct `RepoIdentifier`

- Read `adws/adwBuild.tsx` and `adws/adwBuildHelpers.ts` fully.
- `adwBuild.tsx` uses a custom `parseArguments()` helper and does not call `initializeWorkflow()`. It has its own initialization flow.
- After parsing arguments, call `buildRepoIdentifier(null)` (adwBuild currently doesn't support `--target-repo` — if it parses targetRepo args, use them).
- If adwBuild calls `setTargetRepo()` directly, remove that call.
- Pass the `RepoIdentifier` or `RepoContext` to any phase functions that need it.
- If adwBuild doesn't directly call `setTargetRepo()` but relies on it being set by a parent process, no change is needed here — the parent orchestrator (e.g., `adwPlanBuild.tsx`) handles it.

### Step 6: Update `adwPatch.tsx` to pass `repoId`

- Read `adws/adwPatch.tsx` fully.
- If it calls `initializeWorkflow()`, add `repoId` to the options (same pattern as Step 4).
- If it has custom init logic, construct `RepoIdentifier` and pass it through.

### Step 7: Update `adwPrReview.tsx` to pass `repoId`

- Read `adws/adwPrReview.tsx` fully.
- It uses `initializePRReviewWorkflow()` (updated in Step 2).
- After parsing CLI args, construct `RepoIdentifier` via `buildRepoIdentifier()`.
- Pass `repoId` to `initializePRReviewWorkflow()`.

### Step 8: Update `adwTest.tsx` and `adwDocument.tsx`

- Read both files fully.
- These have minimal/custom init. If they call `setTargetRepo()` directly, remove those calls and construct `RepoIdentifier` instead.
- If they don't call `setTargetRepo()` and don't go through `initializeWorkflow()`, verify they don't depend on the global registry being set by an external caller. If they do, construct `RepoIdentifier` and create `RepoContext` at startup.

### Step 9: Update `adwClearComments.tsx`

- Read the file. This is a utility script.
- If it calls `setTargetRepo()`, remove the call and construct `RepoIdentifier` explicitly.
- If it doesn't interact with the registry, no changes needed.

### Step 10: Update `trigger_cron.ts` to remove `setTargetRepo()` call

- Read `adws/triggers/trigger_cron.ts` fully.
- Remove the `setTargetRepo(getRepoInfo())` call at line 32.
- The cron trigger already passes `--target-repo` and `--clone-url` via `buildTargetRepoArgs()` to spawned orchestrators. Each spawned orchestrator will create its own `RepoContext` at startup (from Steps 4-9).
- For any internal operations within the cron trigger process that depend on `getTargetRepo()` (e.g., GitHub API calls for issue scanning), pass repo info explicitly or construct a local `RepoIdentifier`/`RepoContext` for the trigger's own use.
- Import `getRepoInfo` if needed for explicit passing to internal functions.

### Step 11: Update `trigger_webhook.ts` to remove `setTargetRepo()` calls

- Read `adws/triggers/trigger_webhook.ts` fully.
- Remove all 5 `setTargetRepo()` calls from webhook event handlers.
- For each handler that previously called `setTargetRepo(getRepoInfoFromPayload(repoFullName))`:
  - Extract `repoFullName` from the webhook payload (already done).
  - Construct a `RepoIdentifier` from the payload: `{ owner, repo, platform: Platform.GitHub }`.
  - Pass repo info explicitly to any internal functions that need it (e.g., `classifyAndSpawnWorkflow`, comment posting, eligibility checks).
- The spawned orchestrator processes already receive `--target-repo` and `--clone-url` via `extractTargetRepoArgs(body)` — no changes needed for spawn args.
- Remove the `clearTargetRepo()` call if present (no longer needed when not using the registry).
- Update `webhookHandlers.ts` if any handler functions rely on `getTargetRepo()` being set — pass repo info as an explicit parameter instead.

### Step 12: Update `webhookHandlers.ts` to accept explicit repo info

- Read `adws/triggers/webhookHandlers.ts` fully.
- If handler functions call GitHub API functions that rely on `getTargetRepo()` fallback, update those handler function signatures to accept `repoInfo: RepoInfo` (or `repoId: RepoIdentifier`) as a parameter.
- Thread the repo info through from the webhook event handler in `trigger_webhook.ts`.
- This ensures webhook handlers work without the global registry.

### Step 13: Write tests for orchestrator RepoContext creation

- Create `adws/core/__tests__/orchestratorRepoContext.test.ts` (or add to existing orchestrator test files in `adws/__tests__/`).
- Follow existing test patterns (mock `child_process`, `vi.mock` for dependencies, `beforeEach` resets).
- Test cases:
  - `buildRepoIdentifier()` with external `TargetRepoInfo` returns correct `RepoIdentifier`.
  - `buildRepoIdentifier()` with null (local repo) calls `getRepoInfo()` and returns correct `RepoIdentifier`.
  - `initializeWorkflow()` with `repoId` option does NOT call `setTargetRepo()`.
  - `initializeWorkflow()` without `repoId` option still calls `setTargetRepo()` (backward compat).
  - `initializeWorkflow()` with `repoId` populates `config.repoContext` with matching owner/repo.
- Test entry-point validation:
  - `createRepoContext()` with mismatched git remote throws an error (this is already tested in `adws/providers/__tests__/repoContext.test.ts` — verify coverage).

### Step 14: Write tests for trigger repo identity passing

- Create `adws/triggers/__tests__/triggerRepoContext.test.ts` (or extend existing trigger test files).
- Test cases:
  - Cron trigger does NOT call `setTargetRepo()` after refactor.
  - Cron trigger still passes `--target-repo` args to spawned processes.
  - Webhook handler extracts repo identity from payload correctly.
  - Webhook handler does NOT call `setTargetRepo()` after refactor.
  - Webhook handler passes repo info explicitly to internal functions.
  - Webhook handler spawn args still include `--target-repo` and `--clone-url`.
- Test validation:
  - Webhook payload with missing repo info fails fast with clear error.

### Step 15: Update existing tests for compatibility

- Read existing test files in `adws/__tests__/`, `adws/phases/__tests__/`, and `adws/triggers/__tests__/`.
- Update any tests that assert `setTargetRepo()` is called from orchestrators — they should now assert it is NOT called when `repoId` is provided.
- Update any tests that mock `setTargetRepo()` in trigger contexts — remove expectations for those calls.
- Ensure all existing phase tests still pass (phases receive `repoContext` via `WorkflowConfig` — no changes needed there).

### Step 16: Run validation commands

- Run all validation commands to ensure zero regressions:
  - `bun run lint`
  - `bunx tsc --noEmit`
  - `bunx tsc --noEmit -p adws/tsconfig.json`
  - `bun run test`

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws project
- `bun run test` — Run all tests to validate zero regressions

## Notes
- IMPORTANT: Strictly adhere to `guidelines/coding_guidelines.md`: immutability (RepoContext is already `Readonly` + `Object.freeze`), type safety (use `RepoIdentifier` not raw strings), modularity (shared helper for `buildRepoIdentifier`), purity (no global state mutation in entry points).
- `setTargetRepo()`/`getTargetRepo()` may still be called internally by GitHub API functions as a fallback during transition. This issue only removes calls from orchestrators and triggers. Full removal of the registry is a separate follow-up issue.
- The `createRepoContext()` factory already performs entry-point validation via `validateGitRemote()` — it checks that the git remote in the working directory matches the declared `RepoIdentifier`. No additional validation logic is needed; orchestrators just need to ensure they call the factory early enough to fail fast.
- `adwBuild.tsx`, `adwTest.tsx`, `adwDocument.tsx` have custom initialization paths (they don't use `initializeWorkflow()`). These need individual attention — they may be called standalone or as part of a parent orchestrator. When called standalone, they must create their own `RepoContext`. When called as a phase within a parent orchestrator, they receive config from the parent.
- Keep backward compatibility: if `repoId` is not provided to `initializeWorkflow()`, fall back to the existing `targetRepo`/`getRepoInfo()` path with `setTargetRepo()`. This ensures gradual migration and avoids breaking any callers that haven't been updated yet.
