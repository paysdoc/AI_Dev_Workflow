# Bug: Fix board setup — updateProjectV2Field mutation rejects projectId and wipes existing options

## Metadata
issueNumber: `432`
adwId: `w12d7t-fix-board-setup-upda`
issueJson: `{"number":432,"title":"Fix board setup: updateProjectV2Field mutation rejects projectId and wipes existing options","body":"## Problem\n\nBoard initialization fails during workflow init with:\n\n```\ngh: InputObject 'UpdateProjectV2FieldInput' doesn't accept argument 'projectId'\nVariable $projectId is declared by anonymous mutation but not used\n```\n\nThe `addStatusOption` method in `githubBoardManager.ts` passes `projectId` inside the `updateProjectV2Field` mutation input, but GitHub's `UpdateProjectV2FieldInput` does not accept that argument.\n\nAdditionally, even after fixing the `projectId` error, the current per-column approach calls `updateProjectV2Field` once per missing column with `singleSelectOptions: [{ name, color, description }]`. This is a **replacement** operation — it would wipe all existing options each time.\n\n## Fix\n\n1. **Remove `projectId` from the mutation input** — `updateProjectV2Field` only needs `fieldId` plus field properties\n2. **Extend `getStatusFieldOptions` query** to also fetch `color` and `description` for each existing option\n3. **Replace per-column `addStatusOption` with a single bulk update in `ensureColumns`:**\n   - Fetch all existing options (name, color, description)\n   - Merge: existing non-ADW options preserve their original properties; existing ADW-matching options get overwritten with `BOARD_COLUMNS` defaults; missing ADW columns get appended\n   - Single `updateProjectV2Field` call with the full merged list\n4. **Non-blocking behavior stays as-is** — board setup is fire-and-forget in `workflowInit.ts`; manual addition is always an option if it fails\n\n## Affected files\n\n- `adws/providers/github/githubBoardManager.ts` — `addStatusOption`, `ensureColumns`, `getStatusFieldOptions`\n\n## Out of scope\n\n- Verifying `createBoard()` mutations — untested but not confirmed broken\n- The `/adw_init` command flow is unaffected; this only touches the board column setup path","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-16T14:49:23Z","comments":[],"actionableComment":null}`

## Bug Description
Board initialization fails during every workflow invocation (`initializeWorkflow` in `workflowInit.ts`) with a GraphQL error:

```
gh: InputObject 'UpdateProjectV2FieldInput' doesn't accept argument 'projectId'
Variable $projectId is declared by anonymous mutation but not used
```

**Expected behavior:** The fire-and-forget board setup in `initializeWorkflow` silently ensures all five ADW status columns (Blocked, Todo, In Progress, Review, Done) exist on the GitHub Projects V2 board without disrupting existing columns.

**Actual behavior:** Two defects prevent this:
1. The `addStatusOption` method passes `projectId` in the `updateProjectV2Field` mutation input, but GitHub's `UpdateProjectV2FieldInput` schema does not accept that argument — the call always fails.
2. Even if the `projectId` error were removed, the current per-column approach calls `updateProjectV2Field` once per missing column with `singleSelectOptions: [{ name, color, description }]`. This is a **replacement** operation — each call would overwrite the entire options list, wiping all previously existing options.

## Problem Statement
The `GitHubBoardManager.addStatusOption` method in `githubBoardManager.ts` has an invalid GraphQL mutation that includes `projectId` in the `UpdateProjectV2FieldInput`, which is not accepted by GitHub's API. Additionally, the per-column update strategy replaces all existing options on each call instead of merging new columns into the existing set.

## Solution Statement
1. Remove the `addStatusOption` private method entirely — its per-column approach is fundamentally flawed for a replacement-style API.
2. Extend `getStatusFieldOptions` to also fetch `color` and `description` for each existing option, so we have full context for the merge.
3. Replace the per-column loop in `ensureColumns` with a single bulk update:
   - Fetch all existing options (name, color, description).
   - Build a merged list: existing non-ADW options keep their original properties; existing ADW-matching options get overwritten with `BOARD_COLUMNS` defaults; missing ADW columns get appended.
   - Issue a single `updateProjectV2Field` call with the full merged list (no `projectId` in the input — only `fieldId` and `singleSelectOptions`).
4. If no columns are missing, skip the mutation entirely (no-op).

## Steps to Reproduce
1. Configure ADW with a GitHub repository that has a Projects V2 board linked.
2. Run any workflow that calls `initializeWorkflow` (e.g., `bunx tsx adws/adwPlanBuild.tsx 123`).
3. Observe the fire-and-forget board setup logs a warning: `Board setup failed (non-blocking): ...InputObject 'UpdateProjectV2FieldInput' doesn't accept argument 'projectId'`.

## Root Cause Analysis
The `addStatusOption` method at `githubBoardManager.ts:221-245` declares `$projectId` as a GraphQL variable and passes it inside the `updateProjectV2Field` mutation input:

```graphql
mutation($projectId: ID!, $fieldId: ID!, ...) {
  updateProjectV2Field(input: {
    projectId: $projectId    # <-- NOT accepted by UpdateProjectV2FieldInput
    fieldId: $fieldId
    singleSelectOptions: [{ name: $name, color: $color, description: $description }]
  }) { ... }
}
```

GitHub's `UpdateProjectV2FieldInput` only accepts `fieldId` plus field-specific properties (`name`, `singleSelectOptions`, etc.) — there is no `projectId` argument. This causes the GraphQL call to reject immediately.

The secondary issue is architectural: `singleSelectOptions` in `updateProjectV2Field` is a **replacement** operation. Passing a single-element array like `[{ name: "Blocked", color: "RED", description: "..." }]` replaces the entire options list with just that one option. The per-column loop in `ensureColumns` would therefore wipe all existing options on the first call, then replace them again on each subsequent call.

## Relevant Files
Use these files to fix the bug:

- `adws/providers/github/githubBoardManager.ts` — Contains the broken `addStatusOption` method, the `ensureColumns` loop, and the `getStatusFieldOptions` query. This is the only file that needs code changes.
- `adws/providers/types.ts` — Defines `BOARD_COLUMNS`, `BoardColumnDefinition`, and `BoardStatus`. Needed for reference (no changes required).
- `adws/providers/__tests__/boardManager.test.ts` — Existing unit tests for board manager types and stubs. New tests for the merge logic should be added here.
- `adws/phases/workflowInit.ts` — Calls `ensureColumns` fire-and-forget. No changes needed, but useful to confirm the calling convention.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `app_docs/feature-qm6gwx-board-manager-provider.md` — Conditional documentation for the BoardManager provider feature (reference only).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Extend `getStatusFieldOptions` to fetch `color` and `description`

- In `adws/providers/github/githubBoardManager.ts`, update the `getStatusFieldOptions` private method.
- Change the GraphQL query's `options` selection from `{ id name }` to `{ id name color description }`.
- Update the return type from `Array<{ id: string; name: string }>` to `Array<{ id: string; name: string; color: string; description: string }>`.
- Update the `as` type assertion on the parsed result to match the new shape.

### Step 2: Replace per-column `addStatusOption` with a single bulk `updateStatusFieldOptions` method

- Delete the `addStatusOption` private method entirely (lines 221-245).
- Add a new private method `updateStatusFieldOptions(fieldId: string, options: Array<{ name: string; color: string; description: string }>): void` that:
  - Constructs a `updateProjectV2Field` mutation with **only** `fieldId` and `singleSelectOptions` in the input (no `projectId`).
  - Since `singleSelectOptions` is an array of objects and the `gh api graphql` CLI does not support passing arrays as `-f` arguments, use `gh api graphql --input -` with a JSON body piped via stdin. The JSON body should contain `query` and `variables` fields. Use `execSync` with `{ input: JSON.stringify(body), encoding: 'utf-8' }` to pipe the JSON.
  - The mutation shape should be:
    ```graphql
    mutation($fieldId: ID!, $singleSelectOptions: [ProjectV2SingleSelectFieldOptionInput!]!) {
      updateProjectV2Field(input: {
        fieldId: $fieldId
        singleSelectOptions: $singleSelectOptions
      }) {
        projectV2Field {
          ... on ProjectV2SingleSelectField { id }
        }
      }
    }
    ```
  - Variables should be `{ fieldId, singleSelectOptions: options }`.

### Step 3: Rewrite `ensureColumns` to use merge-then-bulk-update strategy

- In the `ensureColumns` method, replace the existing per-column loop with:
  1. Build a `Map<string, { name: string; color: string; description: string }>` keyed by lowercase name from the existing options (preserving original casing and properties).
  2. Build the ADW columns lookup: a `Map<string, BoardColumnDefinition>` keyed by lowercase status from `BOARD_COLUMNS`.
  3. Iterate through existing options: if an existing option matches an ADW column (by lowercase name), overwrite it with the `BOARD_COLUMNS` defaults (name, color, description). Otherwise, preserve the original option.
  4. Append any ADW columns that are not yet in the existing options.
  5. Compare the merged list to the original existing options. If no changes are needed (all ADW columns already present with correct properties), skip the mutation entirely and return `true`.
  6. If changes are needed, call the new `updateStatusFieldOptions` with the full merged list.
  7. Log each newly added column name.
  8. Return `true`.

### Step 4: Add unit tests for the merge logic

- In `adws/providers/__tests__/boardManager.test.ts`, add a new `describe('GitHubBoardManager merge logic')` block.
- Since the actual `GitHubBoardManager` class uses `execSync` for GraphQL calls (not easily mockable in unit tests), extract the merge logic into a **pure, exported helper function** in `githubBoardManager.ts`:
  - `export function mergeStatusOptions(existing: Array<{ name: string; color: string; description: string }>, adwColumns: readonly BoardColumnDefinition[]): { merged: Array<{ name: string; color: string; description: string }>; changed: boolean; added: string[] }`
  - This function encapsulates the merge algorithm from Step 3.
- Update `ensureColumns` to call `mergeStatusOptions` instead of inlining the logic.
- Add unit tests:
  - **Empty board**: no existing options, all ADW columns should be added. `changed` should be `true`, `added` should list all 5.
  - **All ADW columns already present with correct properties**: no changes needed. `changed` should be `false`, `added` should be empty.
  - **Partial overlap**: some ADW columns exist, some don't. Missing ones should be appended, existing ones should be overwritten. `changed` should be `true`.
  - **Non-ADW columns preserved**: existing options that don't match any ADW column should remain in the merged list with their original properties.
  - **ADW columns with wrong color/description get overwritten**: if an existing option matches an ADW column by name but has different color/description, it should be overwritten.
  - **Case-insensitive matching**: an existing option named "todo" should match `BoardStatus.Todo` ("Todo").

### Step 5: Run Validation Commands

- Run `bun run lint` to check for code quality issues.
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify no type errors.
- Run `bun run test:unit` to validate the fix with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

```bash
# Lint
bun run lint

# Type check (root)
bunx tsc --noEmit

# Type check (adws)
bunx tsc --noEmit -p adws/tsconfig.json

# Unit tests
bun run test:unit
```

## Notes
- The `guidelines/coding_guidelines.md` file must be strictly followed. Key guidelines: prefer pure functions (the merge logic is extracted as a pure helper), use explicit types, prefer declarative code (map/filter over loops), and keep files under 300 lines.
- The `addStatusOption` method is deleted entirely, not patched. Its per-column replacement approach is fundamentally incompatible with the `singleSelectOptions` replacement semantics.
- The `gh api graphql --input -` pattern (piping JSON via stdin) is necessary because `singleSelectOptions` is an array of objects that cannot be passed as flat `-f` flags. This is a well-documented `gh` CLI pattern.
- The fire-and-forget behavior in `workflowInit.ts` (lines 270-285) remains unchanged — board setup never blocks the workflow.
- `createBoard()` mutations are out of scope per the issue description.
- No new libraries are needed.
