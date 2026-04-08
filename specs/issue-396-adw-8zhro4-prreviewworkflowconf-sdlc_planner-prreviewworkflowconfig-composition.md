# Chore: PRReviewWorkflowConfig composition refactor

## Metadata
issueNumber: `396`
adwId: `8zhro4-prreviewworkflowconf`
issueJson: `{"number":396,"title":"PRReviewWorkflowConfig composition refactor","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nRestructure `PRReviewWorkflowConfig` (currently in `adws/phases/prReviewPhase.ts`) to compose `WorkflowConfig` rather than declaring all fields flat. The new shape:\n\n```ts\ninterface PRReviewWorkflowConfig {\n  base: WorkflowConfig;\n  prNumber: number;\n  prDetails: PRDetails;\n  unaddressedComments: PRReviewComment[];\n  applicationUrl: string;\n  // ...other PR-specific fields\n}\n```\n\nAll PR review phase signatures (`executePRReviewPlanPhase`, `executePRReviewBuildPhase`, `executePRReviewTestPhase`, `completePRReviewWorkflow`, `handlePRReviewWorkflowError`) update to access shared fields via `config.base.adwId` etc. instead of `config.adwId` directly.\n\nPure type refactor — no behavior change, no new functionality. PR review workflow runs identically before and after this slice.\n\nThis unblocks the next slice (`adwPrReview` migration to `phaseRunner`), which depends on `WorkflowConfig` being separable from PR-specific fields.\n\n## Acceptance criteria\n\n- [ ] `PRReviewWorkflowConfig` declared as composition with `base: WorkflowConfig`\n- [ ] All PR review phase functions updated to access shared fields via `config.base.<field>`\n- [ ] `initializePRReviewWorkflow` returns the new shape\n- [ ] Existing PR review tests still pass\n- [ ] Type check (`bunx tsc --noEmit`) passes\n- [ ] Manual smoke test: run a PR review workflow against a real PR, confirm identical behavior\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 23","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:03:30Z","comments":[],"actionableComment":null}`

## Chore Description
Restructure `PRReviewWorkflowConfig` from a flat interface to a composition-based interface with a `base: WorkflowConfig` field. Currently `PRReviewWorkflowConfig` (in `adws/phases/prReviewPhase.ts`) redeclares fields like `adwId`, `worktreePath`, `logsDir`, `orchestratorStatePath`, `applicationUrl`, `repoContext`, `totalModelUsage`, and `installContext` that already exist on `WorkflowConfig` (in `adws/phases/workflowInit.ts`). The refactor moves these shared fields into a `base: WorkflowConfig` property, keeping only PR-specific fields (`prNumber`, `prDetails`, `unaddressedComments`, `ctx`) at the top level. All consumer functions must then access shared fields via `config.base.<field>`.

This is a pure type refactor — no behavior change. It unblocks the next slice: migrating `adwPrReview` to use `phaseRunner`.

### Field mapping

**Fields that move into `base: WorkflowConfig`:**
- `issueNumber` (note: `WorkflowConfig` has `number`, PR review has `number | null` — the `base` field must use `WorkflowConfig` which requires `number`, so `initializePRReviewWorkflow` must supply `0` when no issue number is found)
- `adwId`
- `worktreePath`
- `logsDir`
- `orchestratorStatePath`
- `applicationUrl`
- `repoContext?`
- `totalModelUsage?`
- `installContext?`

**Fields that `WorkflowConfig` requires but are not currently on `PRReviewWorkflowConfig`** (must be populated in `initializePRReviewWorkflow`):
- `issue: GitHubIssue` — construct a minimal stub from `prDetails`
- `issueType: IssueClassSlashCommand` — infer from branch or use `'pr_review'` constant
- `defaultBranch: string` — use `prDetails.baseBranch`
- `orchestratorName: AgentIdentifier` — use `OrchestratorId.PrReview`
- `recoveryState: RecoveryState` — empty/default recovery state (PR review doesn't support resume)
- `ctx: WorkflowContext` — the existing `PRReviewWorkflowContext` extends `WorkflowContext`, so it satisfies this
- `branchName: string` — use `prDetails.headBranch`
- `projectConfig: ProjectConfig` — load via `loadProjectConfig()`
- `completedPhases?: string[]` — omit (undefined)
- `topLevelStatePath: string` — use the same pattern as `initializeWorkflow`

**Fields that stay on `PRReviewWorkflowConfig` (PR-specific):**
- `prNumber: number`
- `prDetails: PRDetails`
- `unaddressedComments: PRReviewComment[]`
- `ctx: PRReviewWorkflowContext` (shadows `base.ctx` with the PR-specific subtype)

## Relevant Files
Use these files to resolve the chore:

- `adws/phases/prReviewPhase.ts` — Defines `PRReviewWorkflowConfig` interface and `initializePRReviewWorkflow`, `executePRReviewPlanPhase`, `executePRReviewBuildPhase`. Primary file to modify.
- `adws/phases/prReviewCompletion.ts` — Defines `executePRReviewTestPhase`, `completePRReviewWorkflow`, `handlePRReviewWorkflowError`. Imports `PRReviewWorkflowConfig` and destructures its fields. Must update all field accesses.
- `adws/phases/workflowInit.ts` — Defines `WorkflowConfig` and `initializeWorkflow`. Reference for the `WorkflowConfig` shape. Also need to check for helper utilities (e.g. `loadProjectConfig`, `AgentStateManager.initializeState`) used to populate new required fields.
- `adws/adwPrReview.tsx` — The PR review orchestrator. Consumes `PRReviewWorkflowConfig` from `initializePRReviewWorkflow` and accesses fields like `config.adwId`, `config.logsDir`, `config.orchestratorStatePath`, `config.worktreePath`, `config.prNumber`, `config.prDetails`, `config.ctx`. Must update all shared-field accesses to `config.base.<field>`.
- `adws/phases/index.ts` — Re-exports `PRReviewWorkflowConfig` type. No structural changes needed, just verify export still works.
- `adws/workflowPhases.ts` — Re-exports from `phases/index.ts`. No structural changes needed.
- `adws/index.ts` — Re-exports `PRReviewWorkflowConfig`. No structural changes needed.
- `adws/types/workflowTypes.ts` — Defines `PRReviewComment`, `PRDetails`, `RecoveryState`. Reference file.
- `adws/github/workflowCommentsIssue.ts` — Defines `WorkflowContext`. Reference file.
- `adws/github/workflowCommentsPR.ts` — Defines `PRReviewWorkflowContext`. Reference file.
- `adws/core/phaseRunner.ts` — Defines `PhaseRunner` / `CostTracker`. Reference for understanding how `WorkflowConfig` is consumed by the phase runner (this is the target for the next slice).
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Redefine `PRReviewWorkflowConfig` interface in `adws/phases/prReviewPhase.ts`

- Import `WorkflowConfig` from `./workflowInit`.
- Import `ProjectConfig` from `../core/projectConfig` (or via `../core`), `RecoveryState` from `../../types/workflowTypes`, and any other types needed for the new `WorkflowConfig` fields.
- Replace the flat `PRReviewWorkflowConfig` interface with:
  ```ts
  export interface PRReviewWorkflowConfig {
    base: WorkflowConfig;
    prNumber: number;
    prDetails: PRDetails;
    unaddressedComments: PRReviewComment[];
    ctx: PRReviewWorkflowContext;
  }
  ```
- Remove fields that moved into `base`: `issueNumber`, `adwId`, `worktreePath`, `logsDir`, `orchestratorStatePath`, `applicationUrl`, `repoContext`, `totalModelUsage`, `installContext`.
- Keep `ctx` at the top level because phase functions need the PR-specific `PRReviewWorkflowContext` subtype (not just `WorkflowContext`).

### Step 2: Update `initializePRReviewWorkflow` in `adws/phases/prReviewPhase.ts`

- Import `loadProjectConfig` (or whatever utility `initializeWorkflow` uses to load project config).
- Import `TopLevelStateManager` from `../core` to create a top-level state path (same pattern as `initializeWorkflow`).
- Build a `WorkflowConfig` object (`base`) with all required fields:
  - `issueNumber`: `issueNumber ?? 0` (satisfy the `number` type)
  - `adwId`: `resolvedAdwId`
  - `issue`: construct minimal `GitHubIssue` stub from PR details: `{ number: prNumber, title: prDetails.title, body: prDetails.body, state: 'open', labels: [], author: '', createdAt: '' }`
  - `issueType`: use `'pr_review'` as `IssueClassSlashCommand` (check if this value exists; if not, use the closest match like `'chore'`)
  - `defaultBranch`: `prDetails.baseBranch`
  - `worktreePath`
  - `logsDir`
  - `orchestratorStatePath`
  - `orchestratorName`: `OrchestratorId.PrReview`
  - `recoveryState`: `{ lastCompletedStage: null, adwId: null, branchName: null, planPath: null, prUrl: null, canResume: false }`
  - `ctx`: the `PRReviewWorkflowContext` object (it extends `WorkflowContext`)
  - `branchName`: `prDetails.headBranch`
  - `applicationUrl`
  - `repoContext`
  - `projectConfig`: `loadProjectConfig(worktreePath)`
  - `topLevelStatePath`: initialize using the same pattern as `initializeWorkflow`
- Return `{ base, prNumber, prDetails, unaddressedComments, ctx }`.

### Step 3: Update `executePRReviewPlanPhase` in `adws/phases/prReviewPhase.ts`

- Replace the destructuring `const { prNumber, issueNumber, adwId, prDetails, unaddressedComments, worktreePath, logsDir, orchestratorStatePath, ctx, repoContext } = config;` with:
  ```ts
  const { prNumber, prDetails, unaddressedComments, ctx } = config;
  const { issueNumber, adwId, worktreePath, logsDir, orchestratorStatePath, repoContext } = config.base;
  ```
- All downstream code remains unchanged since local variable names are preserved.

### Step 4: Update `executePRReviewBuildPhase` in `adws/phases/prReviewPhase.ts`

- Same pattern as Step 3. Replace destructuring to split between `config` (PR-specific) and `config.base` (shared).
  ```ts
  const { prNumber, prDetails, unaddressedComments, ctx } = config;
  const { issueNumber, adwId, worktreePath, logsDir, orchestratorStatePath, repoContext } = config.base;
  ```

### Step 5: Update `executePRReviewTestPhase` in `adws/phases/prReviewCompletion.ts`

- Replace destructuring:
  ```ts
  const { prNumber, prDetails, unaddressedComments, ctx } = config;
  const { worktreePath, logsDir, orchestratorStatePath, applicationUrl, repoContext } = config.base;
  ```
- Update `config.issueNumber` references to `config.base.issueNumber`.

### Step 6: Update `buildPRReviewCostSection` in `adws/phases/prReviewCompletion.ts`

- Replace `config.issueNumber` with `config.base.issueNumber`.
- Replace `config.adwId` with `config.base.adwId`.
- Replace `config.repoContext` with `config.base.repoContext`.

### Step 7: Update `completePRReviewWorkflow` in `adws/phases/prReviewCompletion.ts`

- Replace destructuring to split between `config` and `config.base`:
  ```ts
  const { prNumber, prDetails, unaddressedComments, ctx } = config;
  const { worktreePath, logsDir, orchestratorStatePath, repoContext } = config.base;
  ```
- Update `config.issueNumber` references to `config.base.issueNumber`.

### Step 8: Update `handlePRReviewWorkflowError` in `adws/phases/prReviewCompletion.ts`

- Replace destructuring:
  ```ts
  const { prNumber, ctx } = config;
  const { orchestratorStatePath, repoContext } = config.base;
  ```

### Step 9: Update `adws/adwPrReview.tsx` orchestrator

- Update all direct `config.<field>` accesses for shared fields to `config.base.<field>`:
  - `config.adwId` -> `config.base.adwId`
  - `config.orchestratorStatePath` -> `config.base.orchestratorStatePath`
  - `config.logsDir` -> `config.base.logsDir`
  - `config.worktreePath` -> `config.base.worktreePath`
  - `config.ctx` -> `config.ctx` (stays — PR-specific)
  - `config.prNumber` -> `config.prNumber` (stays — PR-specific)
  - `config.prDetails` -> `config.prDetails` (stays — PR-specific)
  - `config.installContext` -> `config.base.installContext`
  - `config.totalModelUsage` -> `config.base.totalModelUsage`

### Step 10: Verify type exports still work

- Check `adws/phases/index.ts`, `adws/workflowPhases.ts`, and `adws/index.ts` — these re-export `PRReviewWorkflowConfig` as a type. Since the interface name hasn't changed, no changes should be needed. Verify by running `bunx tsc --noEmit`.

### Step 11: Run validation commands

- Execute all validation commands listed below to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check
- `bun run lint` — Lint check for code quality
- `bun run build` — Build to verify no build errors

## Notes
- Follow `guidelines/coding_guidelines.md` strictly: keep files under 300 lines, use explicit types, prefer immutability.
- This is a pure type/structural refactor. No behavioral changes. Every function should produce identical runtime output.
- The `IssueClassSlashCommand` type must be checked to see what values it accepts — `'pr_review'` may or may not be a valid member. If it is not, check what value the existing code uses for PR review orchestrators and use that.
- The `ProjectConfig` loading in `initializePRReviewWorkflow` should follow the same pattern as `initializeWorkflow` in `workflowInit.ts`. Read that function to see how it loads project config and initializes `topLevelStatePath`.
- Keep the `ctx: PRReviewWorkflowContext` at the top level of `PRReviewWorkflowConfig` even though `base.ctx` exists as `WorkflowContext`. The phase functions need the PR-specific fields on the context. This means `base.ctx` and `config.ctx` will point to the same object (assign the `PRReviewWorkflowContext` to both).
- The `extractInstallContext` import in `adwPrReview.tsx` comes from `./phases` — verify this still resolves after the refactor.
