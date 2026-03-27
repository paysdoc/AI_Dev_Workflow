# Chore: Align codebase with ubiquitous language glossary

## Metadata
issueNumber: `323`
adwId: `bbmxlp-chore-align-codebase`
issueJson: `{"number":323,"title":"chore: align codebase with ubiquitous language glossary","body":"## Summary\n\nThe `UBIQUITOUS_LANGUAGE.md` glossary was established and 7 ambiguities were resolved. The glossary now documents canonical terms, but the codebase still uses the old terminology in several places. This issue tracks the renames needed to bring code in line with the glossary.\n\n## Code changes required\n\n### 1. Rename build stage constants (`workflowTypes.ts`)\nAlign with `{phase}_{action}` naming convention:\n- `'implementing'` → `'build_running'`\n- `'build_progress'` → `'build_progress'` (already correct)\n- `'implemented'` → `'build_completed'`\n- `'implementation_committing'` → `'build_committing'`\n\n### 2. Rename `WorkItem` → `Issue` in provider types\n- `WorkItem` interface → `Issue`\n- `WorkItemComment` → `IssueComment`\n- `mapGitHubIssueToWorkItem()` → `mapGitHubIssueToIssue()`\n- Update all references in `adws/providers/`\n\n### 3. Rename `MergeRequest` → `PullRequest` in provider types\n- `MergeRequest` interface → `PullRequest`\n- `MergeRequestResult` → `PullRequestResult`\n- `CreateMROptions` → `CreatePROptions`\n- `createMergeRequest()` → `createPullRequest()`\n- `fetchMergeRequest()` → `fetchPullRequest()`\n- `commentOnMergeRequest()` → `commentOnPullRequest()`\n- `listOpenMergeRequests()` → `listOpenPullRequests()`\n- Update all references in `adws/providers/`\n\n### 4. Rename continuation tracking → context reset\n- `continuationCount` → `contextResetCount`\n- `maxContinuations` → `maxContextResets`\n- `MAX_TOKEN_CONTINUATIONS` → `MAX_CONTEXT_RESETS`\n- Update `retryOrchestrator.ts`, `PhaseCostRecord`, and all call sites\n\n### 5. Fix vocabulary in generated `app_docs/`\n- Ensure \"Validation\" and \"Alignment\" are used precisely (not interchangeably)\n- Ensure \"Build\" is used for the Phase, not \"implementation phase\"\n\n### 6. Update comment parsing for renamed stages\n- `workflowCommentParsing.ts` stage-to-emoji mappings must reflect renamed build stages\n\n## Acceptance criteria\n\n- [ ] All renames applied with no runtime breakage\n- [ ] BDD `@regression` scenarios pass\n- [ ] `UBIQUITOUS_LANGUAGE.md` sync mode reports no drift\n\n## Reference\n\nSee `UBIQUITOUS_LANGUAGE.md` \"Resolved ambiguities\" section for full decision context.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T07:11:37Z","comments":[],"actionableComment":null}`

## Chore Description
The `UBIQUITOUS_LANGUAGE.md` glossary was established and 7 ambiguities were resolved. The glossary documents canonical terms, but the codebase still uses old terminology in several places. This chore applies systematic renames across the codebase to bring code in line with the glossary: renaming build stage constants to `{phase}_{action}` convention, replacing `WorkItem` with `Issue`, replacing `MergeRequest` with `PullRequest` in the platform-agnostic layer, renaming continuation tracking to context reset, fixing vocabulary in `app_docs/`, and updating comment parsing mappings.

## Relevant Files
Use these files to resolve the chore:

### Build stage constants (Task 1 & 6)
- `adws/types/workflowTypes.ts` — `WorkflowStageName` type union defines `'implementing'`, `'implemented'`, `'implementation_committing'` (lines 15, 17, 18). Also defines `PRWorkflowStageName` with `'pr_review_implementing'`, `'pr_review_implemented'` (lines 106-107, out of scope but noted).
- `adws/core/workflowCommentParsing.ts` — `STAGE_ORDER` array (lines 23, 25, 26) and `STAGE_HEADER_MAP` display-label-to-stage mapping (lines 46-48) reference the 3 old build stages.
- `adws/github/workflowCommentsIssue.ts` — Switch case at lines 328, 330, 331 maps `'implementing'`, `'implemented'`, `'implementation_committing'` to comment formatter functions.
- `adws/github/workflowCommentsPR.ts` — Switch case at lines 36, 39 for `'pr_review_implementing'`, `'pr_review_implemented'` (out of scope).
- `adws/phases/buildPhase.ts` — Uses `'implemented'` in `shouldExecuteStage` check (line 61), posts `'implementing'` (line 63), `'implemented'` (line 272), `'implementation_committing'` (line 279, 281) stage comments.
- `adws/triggers/trigger_cron.ts` — `ACTIVE_STAGES` set includes `'implementing'`, `'implemented'`, `'implementation_committing'` (lines 47-48).

### WorkItem → Issue (Task 2)
- `adws/providers/types.ts` — Defines `WorkItemComment` interface (lines 43-48), `WorkItem` interface (lines 53-62), `IssueTracker.fetchIssue(): Promise<WorkItem>` (line 78), `IssueTracker.fetchComments(): WorkItemComment[]` (line 83).
- `adws/providers/github/mappers.ts` — Imports `WorkItem`, `WorkItemComment` (line 9). Defines `mapGitHubCommentToWorkItemComment()` (line 17), `mapGitHubIssueToWorkItem()` (line 29), `mapIssueCommentSummaryToWorkItemComment()` (line 45).
- `adws/providers/github/githubIssueTracker.ts` — Imports `WorkItem`, `WorkItemComment` (line 7). Imports and calls `mapGitHubIssueToWorkItem` (lines 20, 41), `mapIssueCommentSummaryToWorkItemComment` (lines 21, 62). Method signatures: `fetchIssue(): Promise<WorkItem>` (line 39), `fetchComments(): WorkItemComment[]` (line 60).
- `adws/providers/jira/jiraIssueTracker.ts` — Imports `WorkItem`, `WorkItemComment` (line 7). Defines `toWorkItemComment()` (line 55), `toWorkItem()` (line 65). Method signatures: `fetchIssue(): Promise<WorkItem>` (line 82), `fetchComments(): WorkItemComment[]` (line 165).

### MergeRequest → PullRequest (Task 3)
- `adws/providers/types.ts` — Defines `MergeRequest` interface (line 101), `CreateMROptions` interface (line 114), `MergeRequestResult` interface (line 125). `CodeHost` interface methods: `createMergeRequest()` (line 137), `fetchMergeRequest()` (line 138), `commentOnMergeRequest()` (line 139), `listOpenMergeRequests()` (line 141).
- `adws/providers/github/mappers.ts` — Imports `MergeRequest` (line 9). Defines `mapPRDetailsToMergeRequest()` (line 65), `mapPRListItemToMergeRequest()` (line 95).
- `adws/providers/github/githubCodeHost.ts` — Imports `CreateMROptions`, `MergeRequest`, `MergeRequestResult` (lines 15-17). Implements `fetchMergeRequest()` (line 53), `commentOnMergeRequest()` (line 59), `listOpenMergeRequests()` (line 70), `createMergeRequest()` (line 80).
- `adws/providers/gitlab/mappers.ts` — Imports `MergeRequest` (line 6). Defines `mapGitLabMRToMergeRequest()` (line 32).
- `adws/providers/gitlab/index.ts` — Re-exports `mapGitLabMRToMergeRequest` (line 2).
- `adws/providers/gitlab/gitlabCodeHost.ts` — Imports `CreateMROptions`, `MergeRequest`, `MergeRequestResult` (lines 7-9). Implements `fetchMergeRequest()` (line 50), `commentOnMergeRequest()` (line 56), `listOpenMergeRequests()` (line 67), `createMergeRequest()` (line 73).
- `adws/phases/prPhase.ts` — Calls `repoContext.codeHost.createMergeRequest()` (line 77). JSDoc comment references `CodeHost.createMergeRequest()` (line 4).
- `adws/phases/phaseCommentHelpers.ts` — Calls `repoContext.codeHost.commentOnMergeRequest()` (line 47).

**NOT renamed (internal GitLab API types reflecting GitLab's own terminology):**
- `adws/providers/gitlab/gitlabTypes.ts` — `GitLabMergeRequest` interface (line 18) stays.
- `adws/providers/gitlab/gitlabApiClient.ts` — `createMergeRequest()`, `getMergeRequest()`, `listMergeRequests()` methods stay (they call GitLab's `/merge_requests` API endpoints).

### Continuation → Context Reset (Task 4)
- `adws/core/config.ts` — Defines `MAX_TOKEN_CONTINUATIONS` constant from env var (line 88). Env var name `MAX_TOKEN_CONTINUATIONS` also referenced.
- `adws/core/index.ts` — Re-exports `MAX_TOKEN_CONTINUATIONS` (line 10).
- `adws/core/retryOrchestrator.ts` — Imports `MAX_TOKEN_CONTINUATIONS` (line 10). Uses `continuationCount` property and `maxContinuations` config option (lines 18, 52, 94). Retry loop logic at lines 97-160.
- `adws/cost/types.ts` — `PhaseCostRecord.continuationCount` field (line 121). `CreatePhaseCostRecordsOptions.continuationCount` (line 138). Factory function destructuring (lines 148, 167).
- `adws/cost/reporting/csvWriter.ts` — CSV header `'continuation_count'` (lines 57, 72, 152). Parsing field `continuationCount` from `'continuation_count'` (line 175).
- `adws/phases/buildPhase.ts` — Imports `MAX_TOKEN_CONTINUATIONS` (line 11). Initializes `continuationCount = 0` (line 59). Loop with `continuationNumber <= MAX_TOKEN_CONTINUATIONS` (line 71). Increments and logs (lines 188-189, 220-221). Throws on exceed (lines 202-203, 233-234). Returns in cost records (line 294).
- `adws/agents/reviewRetry.ts` — Imports `MAX_TOKEN_CONTINUATIONS` (line 7). `ReviewRetryResult.continuationCount` (line 38). Compaction handling comparison checks (lines 125, 206-213, 264-270, 294-300). Returns `continuationCount` (lines 241, 331).
- `adws/agents/testRetry.ts` — Imports `MAX_TOKEN_CONTINUATIONS` (line 7). `TestRetryResult.continuationCount` (line 28). Initialization and returns (lines 110-115, 129, 256). Compaction handling (lines 171-177, 281-287). Returns `continuationCount` (lines 225, 322).
- `adws/phases/testPhase.ts` — Captures `phaseContinuationCount = result.continuationCount` (line 81). Passes to cost records (line 116).
- `adws/phases/workflowCompletion.ts` — Captures `reviewContinuationCount = reviewResult.continuationCount` (line 130). Passes to cost records (line 216).
- **11 more phase files** that pass `continuationCount: 0` in cost record creation: `installPhase.ts`, `scenarioPhase.ts`, `documentPhase.ts`, `prPhase.ts`, `kpiPhase.ts`, `alignmentPhase.ts`, `autoMergePhase.ts`, `prReviewCompletion.ts`, `stepDefPhase.ts`, `planPhase.ts`, `prReviewPhase.ts` (if applicable).

### Vocabulary in app_docs/ (Task 5)
- **No instances of "implementation phase"** found in `app_docs/` — no changes needed.
- **Validation vs Alignment** are used in distinct contexts (older docs describe Validation; newer docs describe Alignment as its replacement). The existing docs accurately reflect the timeline — no conflation found that requires correction.

### Conditional docs (read for context, not modified)
- `adws/README.md` — conditional doc for operating in `adws/` directory.

### New Files
None — all changes are renames within existing files.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rename build stage constants in type definitions
- In `adws/types/workflowTypes.ts`, update the `WorkflowStageName` type union:
  - `'implementing'` → `'build_running'`
  - `'implemented'` → `'build_completed'`
  - `'implementation_committing'` → `'build_committing'`
- Do NOT rename `'pr_review_implementing'` or `'pr_review_implemented'` in `PRWorkflowStageName` — those are out of scope for this issue.

### Step 2: Rename `WorkItem` → `Issue` and `WorkItemComment` → `IssueComment` in provider types
- In `adws/providers/types.ts`:
  - Rename `WorkItemComment` interface → `IssueComment`
  - Rename `WorkItem` interface → `Issue`
  - Update `IssueTracker.fetchIssue()` return type: `Promise<WorkItem>` → `Promise<Issue>`
  - Update `IssueTracker.fetchComments()` return type: `WorkItemComment[]` → `IssueComment[]`
- In `adws/providers/github/mappers.ts`:
  - Update imports: `WorkItem, WorkItemComment` → `Issue, IssueComment`
  - Rename function `mapGitHubCommentToWorkItemComment()` → `mapGitHubCommentToIssueComment()`
  - Rename function `mapGitHubIssueToWorkItem()` → `mapGitHubIssueToIssue()`
  - Rename function `mapIssueCommentSummaryToWorkItemComment()` → `mapIssueCommentSummaryToIssueComment()`
  - Update all return type annotations accordingly
- In `adws/providers/github/githubIssueTracker.ts`:
  - Update imports: `WorkItem, WorkItemComment` → `Issue, IssueComment`
  - Update imported function names from mappers
  - Update method return type annotations: `Promise<WorkItem>` → `Promise<Issue>`, `WorkItemComment[]` → `IssueComment[]`
- In `adws/providers/jira/jiraIssueTracker.ts`:
  - Update imports: `WorkItem, WorkItemComment` → `Issue, IssueComment`
  - Rename private method `toWorkItemComment()` → `toIssueComment()`
  - Rename private method `toWorkItem()` → `toIssue()`
  - Update all return type annotations and internal references accordingly

### Step 3: Rename `MergeRequest` → `PullRequest` in platform-agnostic provider types
- In `adws/providers/types.ts`:
  - Rename `MergeRequest` interface → `PullRequest`
  - Rename `CreateMROptions` interface → `CreatePROptions`
  - Rename `MergeRequestResult` interface → `PullRequestResult`
  - Update JSDoc comments for the renamed interfaces
  - In `CodeHost` interface, rename methods:
    - `createMergeRequest(options: CreateMROptions): MergeRequestResult` → `createPullRequest(options: CreatePROptions): PullRequestResult`
    - `fetchMergeRequest(mrNumber: number): MergeRequest` → `fetchPullRequest(prNumber: number): PullRequest`
    - `commentOnMergeRequest(mrNumber: number, body: string): void` → `commentOnPullRequest(prNumber: number, body: string): void`
    - `listOpenMergeRequests(): MergeRequest[]` → `listOpenPullRequests(): PullRequest[]`
- In `adws/providers/github/mappers.ts`:
  - Update import: `MergeRequest` → `PullRequest`
  - Rename function `mapPRDetailsToMergeRequest()` → `mapPRDetailsToPullRequest()`
  - Rename function `mapPRListItemToMergeRequest()` → `mapPRListItemToPullRequest()`
  - Update return type annotations
  - Update JSDoc comments
- In `adws/providers/github/githubCodeHost.ts`:
  - Update imports: `CreateMROptions` → `CreatePROptions`, `MergeRequest` → `PullRequest`, `MergeRequestResult` → `PullRequestResult`
  - Rename method `fetchMergeRequest()` → `fetchPullRequest()`
  - Rename method `commentOnMergeRequest()` → `commentOnPullRequest()`
  - Rename method `listOpenMergeRequests()` → `listOpenPullRequests()`
  - Rename method `createMergeRequest()` → `createPullRequest()`
  - Update JSDoc comments
- In `adws/providers/gitlab/mappers.ts`:
  - Update import: `MergeRequest` → `PullRequest`
  - Rename function `mapGitLabMRToMergeRequest()` → `mapGitLabMRToPullRequest()`
  - Update return type annotation and JSDoc
- In `adws/providers/gitlab/index.ts`:
  - Update re-export: `mapGitLabMRToMergeRequest` → `mapGitLabMRToPullRequest`
- In `adws/providers/gitlab/gitlabCodeHost.ts`:
  - Update imports: `CreateMROptions` → `CreatePROptions`, `MergeRequest` → `PullRequest`, `MergeRequestResult` → `PullRequestResult`
  - Rename method `fetchMergeRequest()` → `fetchPullRequest()`
  - Rename method `commentOnMergeRequest()` → `commentOnPullRequest()`
  - Rename method `listOpenMergeRequests()` → `listOpenPullRequests()`
  - Rename method `createMergeRequest()` → `createPullRequest()`
  - Update JSDoc comments
- **DO NOT rename** internal GitLab API types/methods that reflect GitLab's own API:
  - `GitLabMergeRequest` in `gitlabTypes.ts` stays (mirrors GitLab API response shape)
  - `gitlabApiClient.ts` methods (`createMergeRequest`, `getMergeRequest`, `listMergeRequests`) stay (they call GitLab's `/merge_requests` endpoints)
- In `adws/phases/prPhase.ts`:
  - Update call site: `repoContext.codeHost.createMergeRequest(...)` → `repoContext.codeHost.createPullRequest(...)`
  - Update variable name if applicable: `mrResult` → `prResult`
  - Update JSDoc reference to `CodeHost.createMergeRequest()` → `CodeHost.createPullRequest()`
- In `adws/phases/phaseCommentHelpers.ts`:
  - Update call site: `repoContext.codeHost.commentOnMergeRequest(...)` → `repoContext.codeHost.commentOnPullRequest(...)`

### Step 4: Rename continuation tracking → context reset
- In `adws/core/config.ts`:
  - Rename constant `MAX_TOKEN_CONTINUATIONS` → `MAX_CONTEXT_RESETS`
  - Update env var name in `process.env.MAX_TOKEN_CONTINUATIONS` → `process.env.MAX_CONTEXT_RESETS`
  - Update JSDoc comment from "continuation attempts" to "context reset attempts"
- In `adws/core/index.ts`:
  - Update re-export: `MAX_TOKEN_CONTINUATIONS` → `MAX_CONTEXT_RESETS`
- In `adws/core/retryOrchestrator.ts`:
  - Update import: `MAX_TOKEN_CONTINUATIONS` → `MAX_CONTEXT_RESETS`
  - Rename property `continuationCount` → `contextResetCount` in type definitions
  - Rename config option `maxContinuations` → `maxContextResets`
  - Update all references in retry loop logic
- In `adws/cost/types.ts`:
  - Rename `PhaseCostRecord.continuationCount` → `PhaseCostRecord.contextResetCount`
  - Rename `CreatePhaseCostRecordsOptions.continuationCount` → `CreatePhaseCostRecordsOptions.contextResetCount`
  - Update factory function destructuring and record creation
- In `adws/cost/reporting/csvWriter.ts`:
  - Rename CSV header `'continuation_count'` → `'context_reset_count'` in all 3 locations (header definition, header array, parsing map)
  - Update field mapping: `continuationCount: parseInt(get('continuation_count'), 10)` → `contextResetCount: parseInt(get('context_reset_count'), 10)`
- In `adws/phases/buildPhase.ts`:
  - Update import: `MAX_TOKEN_CONTINUATIONS` → `MAX_CONTEXT_RESETS`
  - Rename local variable `continuationCount` → `contextResetCount`
  - Rename loop variable `continuationNumber` → `contextResetNumber` (if applicable)
  - Update all comparison checks, log messages, and error messages
  - Update cost record creation: `continuationCount` → `contextResetCount`
- In `adws/agents/reviewRetry.ts`:
  - Update import: `MAX_TOKEN_CONTINUATIONS` → `MAX_CONTEXT_RESETS`
  - Rename `ReviewRetryResult.continuationCount` → `ReviewRetryResult.contextResetCount`
  - Update all comparison checks and return statements
- In `adws/agents/testRetry.ts`:
  - Update import: `MAX_TOKEN_CONTINUATIONS` → `MAX_CONTEXT_RESETS`
  - Rename `TestRetryResult.continuationCount` → `TestRetryResult.contextResetCount`
  - Update all comparison checks and return statements
- In `adws/phases/testPhase.ts`:
  - Rename capture variable: `phaseContinuationCount` → `phaseContextResetCount`
  - Update cost record field: `continuationCount` → `contextResetCount`
- In `adws/phases/workflowCompletion.ts`:
  - Rename capture variable: `reviewContinuationCount` → `reviewContextResetCount`
  - Update cost record field: `continuationCount` → `contextResetCount`
- In all remaining phase files that pass `continuationCount: 0`, update to `contextResetCount: 0`:
  - `adws/phases/installPhase.ts`
  - `adws/phases/scenarioPhase.ts`
  - `adws/phases/documentPhase.ts`
  - `adws/phases/prPhase.ts`
  - `adws/phases/kpiPhase.ts`
  - `adws/phases/alignmentPhase.ts`
  - `adws/phases/autoMergePhase.ts`
  - `adws/phases/prReviewCompletion.ts`
  - `adws/phases/stepDefPhase.ts`
  - `adws/phases/planPhase.ts`

### Step 5: Verify app_docs/ vocabulary (no changes needed)
- Research confirmed: no instances of "implementation phase" exist in `app_docs/`.
- Research confirmed: "Validation" and "Alignment" are used in distinct contexts (older docs describe Validation; newer docs describe Alignment as the replacement). No conflation found.
- No file changes required for this task.

### Step 6: Update comment parsing for renamed build stages
- In `adws/core/workflowCommentParsing.ts`:
  - In `STAGE_ORDER` array, replace:
    - `'implementing'` → `'build_running'`
    - `'implemented'` → `'build_completed'`
    - `'implementation_committing'` → `'build_committing'`
  - In `STAGE_HEADER_MAP`, update the 3 build-stage entries (both display label keys and stage value strings):
    - `':hammer_and_wrench: Implementing Solution': 'implementing'` → `':hammer_and_wrench: Running Build': 'build_running'`
    - `':white_check_mark: Implementation Complete': 'implemented'` → `':white_check_mark: Build Completed': 'build_completed'`
    - `':floppy_disk: Committing Implementation': 'implementation_committing'` → `':floppy_disk: Committing Build': 'build_committing'`
- In `adws/github/workflowCommentsIssue.ts`:
  - Update switch case labels:
    - `case 'implementing':` → `case 'build_running':`
    - `case 'implemented':` → `case 'build_completed':`
    - `case 'implementation_committing':` → `case 'build_committing':`
  - Rename the corresponding comment formatter functions for clarity:
    - `formatImplementingComment` → `formatBuildRunningComment`
    - `formatImplementedComment` → `formatBuildCompletedComment`
    - `formatImplementationCommittingComment` → `formatBuildCommittingComment`
  - Update the display text inside these formatter functions to use "Build" terminology instead of "Implementation"
- In `adws/triggers/trigger_cron.ts`:
  - In `ACTIVE_STAGES` set, replace:
    - `'implementing'` → `'build_running'`
    - `'implemented'` → `'build_completed'`
    - `'implementation_committing'` → `'build_committing'`

### Step 7: Update adws/README.md if it references renamed terms
- Check `adws/README.md` for any references to old terminology (`WorkItem`, `MergeRequest`, `implementing` stage, `continuationCount`, `MAX_TOKEN_CONTINUATIONS`) and update to new terms.

### Step 8: Run validation commands
- Run all validation commands listed below to confirm zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws project (catches type errors from renamed interfaces/methods)
- `bun run build` — Build the application to verify no build errors
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run BDD regression scenarios to validate no runtime breakage

## Notes
- Strictly follow the coding guidelines in `guidelines/coding_guidelines.md`. In particular: use explicit types, meaningful names, and keep code hygiene (no unused variables or imports after renames).
- **GitLab internal types are NOT renamed**: `GitLabMergeRequest` (in `gitlabTypes.ts`) and `gitlabApiClient.ts` methods (`createMergeRequest`, `getMergeRequest`, `listMergeRequests`) reflect the actual GitLab API and must stay as-is. Only the platform-agnostic `CodeHost`/`types.ts` layer is renamed.
- **CSV column rename**: The `continuation_count` CSV header changes to `context_reset_count`. This is a breaking change for reading old CSV files. Existing CSV files in `projects/` will need their headers updated manually, or the CSV reader can be updated to accept both column names as a fallback. Prefer the clean rename — old CSVs can be regenerated.
- **PR review stages out of scope**: `pr_review_implementing` and `pr_review_implemented` in `PRWorkflowStageName` still use old vocabulary. Consider a follow-up issue to rename these to `pr_review_build_running` and `pr_review_build_completed` for full glossary alignment.
- **Environment variable rename**: `MAX_TOKEN_CONTINUATIONS` env var becomes `MAX_CONTEXT_RESETS`. Any `.env` files or deployment configs referencing the old name must be updated. Check `.env.sample` if it documents this variable.
- **Continuation log messages**: Update log message strings that say "continuation" to say "context reset" for consistency (e.g., `"continuation ${n}/${max}"` → `"context reset ${n}/${max}"`).
- **Order matters**: Start with `types.ts` renames (Steps 1-3) since those define the interfaces, then update all consuming files. TypeScript compiler errors will guide you to any missed references.
