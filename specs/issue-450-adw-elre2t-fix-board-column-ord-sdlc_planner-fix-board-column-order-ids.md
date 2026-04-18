# Bug: Fix board column ordering and preserve option IDs in ensureColumns

## Metadata
issueNumber: `450`
adwId: `elre2t-fix-board-column-ord`
issueJson: `{"number":450,"title":"Fix board column ordering and preserve option IDs in ensureColumns","body":"## Summary\n\nTwo bugs in `mergeStatusOptions` / `updateStatusFieldOptions` (`adws/providers/github/githubBoardManager.ts`):\n\n1. **Column order ignored** — missing ADW columns are always appended to the right of the board, regardless of their `BOARD_COLUMNS.order`. The `order` field exists but is never read for sorting.\n2. **Option IDs stripped on update** — `updateProjectV2Field` is called with `singleSelectOptions` that omit each option's `id`. GitHub treats each entry as a new option, deleting the old one. Any project items referencing the old option IDs are orphaned and their Status column goes blank. Observed impact: 3 of 9 active workflows lost their Status when `Blocked` was added programmatically. Manual column creation via the GitHub UI does not have this problem because the UI preserves existing IDs.\n\n## Root cause\n\n- `StatusOption` type (line 16) is `{ name, color, description }` — no `id`.\n- `getStatusFieldOptions` (line 246) fetches `id` but it's discarded in `mergeStatusOptions`.\n- `mergeStatusOptions` iterates `existing` first and `.push()`es missing ADW columns to the end.\n\n## Fix\n\n### `mergeStatusOptions`\n\n1. Accept `existing` options with `id`; add optional `id` to `StatusOption`.\n2. Preserved and overwritten options retain their existing `id`.\n3. Insertion position for each missing ADW column:\n   - **Anchor**: existing ADW column with the highest `order <= missing.order`. Insert at `anchor_index + 1`.\n   - **No lower-order anchor but other ADW columns exist**: insert immediately before the first existing ADW column.\n   - **No ADW columns at all**: prepend all missing columns in `BOARD_COLUMNS` order.\n4. Non-ADW options keep their relative positions (pushed aside as needed).\n\n### `updateStatusFieldOptions`\n\nInclude `id` in the mutation payload when present so GitHub updates in place instead of deleting and recreating.\n\n## Tests (unit only, `adws/providers/__tests__/boardManager.test.ts`)\n\nColumn order:\n- Missing `Blocked` inserted at index 0 when `[Todo, InProgress, Review, Done]` exist.\n- Missing `Review` inserted between `InProgress` and `Done`.\n- All five missing → `[Blocked, Todo, InProgress, Review, Done]` in `BOARD_COLUMNS` order.\n- Existing non-ADW options keep their relative position.\n\nID preservation:\n- Every existing option's `id` survives into `merged`.\n- Newly added ADW options have `id === undefined` (GitHub assigns one on write).\n\n## Files\n\n- `adws/providers/github/githubBoardManager.ts`\n- `adws/providers/__tests__/boardManager.test.ts`\n\n## Out of scope\n\n- Already-corrupted items on existing boards. The fix prevents future corruption; it does not restore lost Status values.\n- The uncommitted color change in `adws/providers/types.ts`.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-18T17:28:03Z","comments":[],"actionableComment":null}`

## Bug Description
`GitHubBoardManager.ensureColumns` has two defects that manifest the first time an ADW column is programmatically added to a repository's GitHub Projects V2 board (most commonly when `Blocked` is introduced to a board that was created before the five-column scheme landed):

1. **Column order ignored.** `mergeStatusOptions` walks the existing options array and `.push()`es any missing ADW columns onto the end. The `order` field on `BOARD_COLUMNS` is never read. As a result a newly added `Blocked` column always lands to the right of `Done` even though it should be leftmost (`order: 1`). Boards that started with `[Todo, InProgress, Review, Done]` end up as `[Todo, InProgress, Review, Done, Blocked]` instead of `[Blocked, Todo, InProgress, Review, Done]`.
2. **Option IDs stripped on update.** `updateStatusFieldOptions` serializes each merged option as `{ name, color, description }` with no `id` — even though `getStatusFieldOptions` already fetches it. GitHub's `updateProjectV2Field` treats an entry without an `id` as a brand-new option, so it deletes the pre-existing option with the same name and creates a fresh one with a new node ID. Any `ProjectV2Item` row whose Status still references the old ID becomes orphaned and its Status cell renders blank. Observed impact: 3 of 9 active workflows lost their Status when `Blocked` was added programmatically. Manual column creation through the GitHub UI does not corrupt items because the UI preserves existing IDs.

**Expected behavior:** `ensureColumns` inserts missing ADW columns at the position dictated by `BOARD_COLUMNS.order`, overwrites existing ADW columns in place (reusing their GitHub option ID), and leaves non-ADW custom columns untouched — never losing the Status of any board item.

**Actual behavior:** Missing ADW columns are appended to the end, and every existing option is silently replaced with a new-ID duplicate, orphaning any item referencing the old IDs.

## Problem Statement
Two bugs inside `mergeStatusOptions` and `updateStatusFieldOptions` (`adws/providers/github/githubBoardManager.ts`) cause ADW to corrupt the Status column on GitHub project boards when it adds any missing ADW column: newly added columns land in the wrong position, and every existing option is re-created with a new node ID that orphans items referencing the old IDs.

## Solution Statement
Surgical changes inside `githubBoardManager.ts` only:

1. Widen the internal `StatusOption` type (and `mergeStatusOptions` inputs) to include an optional `id: string` so IDs fetched by `getStatusFieldOptions` flow through the merge instead of being dropped.
2. Rewrite `mergeStatusOptions` so that:
   - Preserved and overwritten options retain their original `id`.
   - Missing ADW columns are inserted using an anchor-based rule driven by `BOARD_COLUMNS.order`, not appended.
   - Non-ADW options keep their relative position.
3. Update `updateStatusFieldOptions` to include `id` in each `singleSelectOptions` entry when present so GitHub updates the option in place instead of deleting and recreating it.
4. Extend unit tests in `adws/providers/__tests__/boardManager.test.ts` to lock down the new ordering and ID-preservation contract.

No behavioral change to `findBoard`, `createBoard`, `getStatusFieldOptions`, the PAT fallback wrapper, or the fire-and-forget wiring in `workflowInit.ts`. No new dependencies.

## Steps to Reproduce
1. Link a GitHub Projects V2 board to the repository with a Status field that contains four columns: `Todo`, `In Progress`, `Review`, `Done` (matching the GitHub default template minus `Blocked`).
2. Add several `ProjectV2Item`s to the board and set each to a non-empty Status.
3. Run any workflow that calls `initializeWorkflow` (e.g. `bunx tsx adws/adwPlanBuild.tsx 123`).
4. Observe in the board UI:
   - A new `Blocked` column appears to the right of `Done` (wrong position; should be leftmost).
   - Items previously set to `Todo`, `In Progress`, `Review`, or `Done` now show an empty Status cell (their Status value references a node ID that `updateProjectV2Field` just deleted).

## Root Cause Analysis
The defects sit inside two methods in `adws/providers/github/githubBoardManager.ts`:

### 1. Missing `order`-based insertion in `mergeStatusOptions` (lines 28–59)
The function builds `merged` by mapping over `existing` (preserving input order), then appends missing ADW columns with `merged.push(...)`. `BoardColumnDefinition.order` is declared in `adws/providers/types.ts:80` but never consulted. There is no anchor lookup, no ordering logic, no reference to `BOARD_COLUMNS` order in the merge at all — the control flow literally cannot produce any ordering other than "existing order, then missing-ADW order".

### 2. Dropped `id` field
- The internal `StatusOption` type at line 16 is `{ name: string; color: string; description: string }` — no `id`.
- `getStatusFieldOptions` at lines 235–271 fetches `id name color description` from GitHub and returns the `id`.
- `mergeStatusOptions` at line 36 re-constructs each preserved option as `opt` (an object that does have `id` on it at runtime because it is a reference to the fetched option), but the ADW-overwrite branch at line 39 builds a fresh object `{ name, color, description }` that discards the `id`. The `existing` parameter type signature also does not declare `id`, so callers cannot rely on it.
- `updateStatusFieldOptions` at lines 273–288 serializes `options` as-is. Because the merge output does not carry `id` for any ADW-overwritten option (and does not declare it for preserved options either), every option GitHub receives is interpreted as a new option. The mutation's replacement semantics then delete the old option + create a new one with a fresh node ID.
- Any `ProjectV2Item.field` row whose value points to the old node ID is silently orphaned, which is why items lose their Status cell value.

The net effect is the same regardless of which code path removes the ID: the mutation payload has no `id` to anchor on, so GitHub treats every entry as new.

## Relevant Files
Use these files to fix the bug:

- `adws/providers/github/githubBoardManager.ts` — Contains the buggy `mergeStatusOptions`, `updateStatusFieldOptions`, and the `StatusOption` type. All code changes land here.
- `adws/providers/__tests__/boardManager.test.ts` — Existing unit-test suite for `mergeStatusOptions`. New tests for order-based insertion and ID preservation extend the existing `describe('mergeStatusOptions')` block.
- `adws/providers/types.ts` — Declares `BOARD_COLUMNS`, `BoardColumnDefinition`, and `BoardStatus`. **Read-only reference** — no edits; per the issue the uncommitted color change in this file is out of scope.
- `adws/phases/workflowInit.ts` — Calls `ensureColumns` fire-and-forget (lines 281–293). **Read-only reference** — no edits; calling convention is unchanged.
- `guidelines/coding_guidelines.md` — Coding guidelines (purity, declarative code, avoid `any`, prefer explicit types). Must be followed throughout.
- `app_docs/feature-qm6gwx-board-manager-provider.md` — Conditional doc for the BoardManager provider feature (reference only).
- `app_docs/feature-w12d7t-fix-board-update-mutation.md` — Conditional doc for the prior fix that introduced `mergeStatusOptions` and `updateStatusFieldOptions` (reference only — useful background for the structure being modified).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Extend the `StatusOption` type to carry an optional `id`

- In `adws/providers/github/githubBoardManager.ts`, change the `StatusOption` type (currently `type StatusOption = { name: string; color: string; description: string };` at line 16) to:
  ```ts
  type StatusOption = { id?: string; name: string; color: string; description: string };
  ```
- This single type is used by `mergeStatusOptions`' return value and by `updateStatusFieldOptions`' input. The `?` keeps it compatible with newly added columns that have no ID yet — GitHub will assign one when the mutation runs.

### Step 2: Widen the `mergeStatusOptions` `existing` parameter to accept `id`

- Change the parameter type of `mergeStatusOptions` so the `existing` array can carry the ID that `getStatusFieldOptions` already fetches:
  ```ts
  existing: Array<{ id?: string; name: string; color: string; description: string }>,
  ```
- This matches the shape returned by `getStatusFieldOptions` (which returns `Array<{ id: string; name: string; color: string; description: string }>` — assignable to the widened optional-id shape).
- Keep the second parameter `adwColumns: readonly BoardColumnDefinition[]` and the return-type shape `{ merged: StatusOption[]; changed: boolean; added: string[] }` unchanged (but `merged`'s element type now allows `id`).

### Step 3: Rewrite `mergeStatusOptions` to preserve IDs and insert missing ADW columns in the correct position

Replace the body of `mergeStatusOptions` with the algorithm below. Keep the function pure and exported.

1. Build the canonical ADW lookup:
   - `adwByName`: `Map<string, BoardColumnDefinition>` keyed by `status.toLowerCase()`.
2. Build `merged: StatusOption[]` by mapping over `existing`:
   - If the option does **not** match any ADW column (by case-insensitive name), keep it verbatim, including its `id`.
   - If it **does** match an ADW column, overwrite `name` / `color` / `description` with `BOARD_COLUMNS` defaults but **preserve the original `id`**:
     ```ts
     { id: opt.id, name: adwCol.status, color: adwCol.color, description: adwCol.description }
     ```
3. Determine which ADW columns are missing:
   - `existingLower`: `Set<string>` of lowercase existing names.
   - `missingCols = adwColumns.filter((col) => !existingLower.has(col.status.toLowerCase()))`.
4. Insert each missing column into `merged`, in `BOARD_COLUMNS` order, using the anchor rule:
   - Compute the current set of ADW columns already in `merged` (recomputed after each insertion because indices shift). For each, remember its `order` from `BOARD_COLUMNS` and its index in `merged`.
   - For the missing column `col`:
     - **Anchor**: the ADW column already in `merged` with the highest `order` such that `order <= col.order`. If found, insert `col` at `anchorIndex + 1`.
     - **No lower-order anchor but other ADW columns exist in `merged`**: insert `col` immediately before the index of the first existing ADW column in `merged`.
     - **No ADW columns in `merged` at all**: append `col` to the end of the "missing-columns prefix" — i.e. insert at the position of the last previously inserted missing column, or at `0` if none has been inserted yet. This collapses to "prepend all missing columns in `BOARD_COLUMNS` order" when `merged` starts empty or contains only non-ADW options.
   - Because `missingCols` iterates in `BOARD_COLUMNS` order (ascending `order`), earlier-inserted ADW columns naturally act as anchors for later ones, producing `[Blocked, Todo, InProgress, Review, Done]` when all five are missing.
5. Track `added: string[]` = `missingCols.map((c) => c.status)`.
6. Compute `changed`:
   - `true` if `added.length > 0`, OR
   - `existing.length !== merged.length` (defensive; should not happen given the algorithm), OR
   - any position `i` differs by `name`, `color`, or `description` between `merged[i]` and `existing[i]`.
   - The ID field does **not** affect `changed`: a preserved ID is expected and must not force a mutation when nothing else changed.
7. Return `{ merged, changed, added }`.

Implementation notes:
- Keep the code declarative where practical (`filter`, `map`, `reduce`) but use a small imperative loop for step 4 because each insertion shifts indices and the anchor lookup has to re-scan `merged`. Prioritize readability over cleverness per the guidelines.
- Do **not** mutate the input `existing` array or any `BoardColumnDefinition`. Build `merged` by creating new objects; use `array.splice` only on the local `merged` working copy.
- Do **not** introduce new helper exports beyond `mergeStatusOptions` itself.

### Step 4: Include `id` in the `updateStatusFieldOptions` mutation payload when present

- In `updateStatusFieldOptions` (lines 273–288), change the GraphQL mutation so each `singleSelectOptions` entry can carry an optional `id`. The `ProjectV2SingleSelectFieldOptionInput` type on GitHub already accepts `id` (update-in-place) alongside `name`, `color`, `description`.
- The fix is entirely at the payload level — the existing mutation string can stay as-is (`$singleSelectOptions: [ProjectV2SingleSelectFieldOptionInput!]!`) because the variable type already permits `id`.
- Map `options` to the exact shape GitHub expects, including `id` only when defined (omit the key for newly added columns):
  ```ts
  const singleSelectOptions = options.map((o) => {
    const entry: { id?: string; name: string; color: string; description: string } = {
      name: o.name,
      color: o.color,
      description: o.description,
    };
    if (o.id !== undefined) entry.id = o.id;
    return entry;
  });
  const body = { query: mutation, variables: { fieldId, singleSelectOptions } };
  execSync('gh api graphql --input -', { input: JSON.stringify(body), encoding: 'utf-8' });
  ```
- Do not pass `id: undefined` or `id: null` in the JSON — omit the key entirely for new options. GitHub rejects `null` for non-nullable input scalars, and having an explicit `undefined` key would serialize inconsistently across `JSON.stringify` runtimes.

### Step 5: Confirm `ensureColumns` still flows correctly

- `ensureColumns` (lines 167–184) already calls `mergeStatusOptions(statusField.options, BOARD_COLUMNS)` and passes `merged` straight to `updateStatusFieldOptions`. No changes required in this method — but double-check that `statusField.options` continues to come from `getStatusFieldOptions` with its `id` field intact (the field is already in the returned object shape, so this should "just work" after the type widening in Steps 1–2).
- No change to the early-exit `if (!changed) return true;` short-circuit: preserving IDs should not trigger a write when nothing else changed.

### Step 6: Extend unit tests — column ordering

In `adws/providers/__tests__/boardManager.test.ts`, extend the existing `describe('mergeStatusOptions')` block with the four ordering tests below. Use the existing import of `BOARD_COLUMNS` and `BoardStatus`.

- **Missing `Blocked` inserted at index 0 when `[Todo, InProgress, Review, Done]` exist.**
  - Input `existing`: the four non-`Blocked` ADW columns in canonical order, each with a stable placeholder `id` like `'opt-todo'`.
  - Expect `merged[0].name === BoardStatus.Blocked`.
  - Expect `merged.map((o) => o.name)` === `[Blocked, Todo, 'In Progress', Review, Done]` (use `BoardStatus.InProgress` for the literal).
  - Expect `added` === `[BoardStatus.Blocked]`.
  - Expect `changed === true`.

- **Missing `Review` inserted between `InProgress` and `Done`.**
  - Input `existing`: `[Blocked, Todo, InProgress, Done]` with placeholder IDs.
  - Expect `merged.map((o) => o.name)` === `[Blocked, Todo, 'In Progress', Review, Done]`.
  - Expect `added` === `[BoardStatus.Review]`.

- **All five missing → `[Blocked, Todo, InProgress, Review, Done]` in `BOARD_COLUMNS` order.**
  - Input `existing`: `[]`.
  - Expect `merged.map((o) => o.name)` === `['Blocked', 'Todo', 'In Progress', 'Review', 'Done']`.
  - Expect `added.length === 5`.
  - Expect every `merged[i].id === undefined` (no IDs to preserve on an empty board).

- **Existing non-ADW options keep their relative position.**
  - Input `existing`: `[{ id: 'opt-custom-1', name: 'Custom1', color: 'BLUE', description: 'x' }, Todo, Done, { id: 'opt-custom-2', name: 'Custom2', color: 'PINK', description: 'y' }]`.
  - Expect `Custom1` to remain at index 0 in `merged`.
  - Expect `Custom2` to remain at the tail of `merged` (after any inserted ADW columns that would anchor to `Done`; since `Done` has the highest ADW order, no ADW column is inserted between `Done` and `Custom2`).
  - Expect the missing ADW columns (`Blocked`, `InProgress`, `Review`) to appear among the ADW columns in canonical positions driven by their `order` values.

### Step 7: Extend unit tests — ID preservation

Still in `adws/providers/__tests__/boardManager.test.ts`, add these two tests to the same `describe('mergeStatusOptions')` block.

- **Every existing option's `id` survives into `merged`.**
  - Input `existing`: each of the five `BOARD_COLUMNS` with a unique placeholder `id` (e.g. `'opt-blocked'`, `'opt-todo'`, ...).
  - For every ADW option in `merged`, expect its `id` to equal the placeholder that was set on the matching input option.
  - Also construct a test with an altered color (e.g. `Blocked` input with `color: 'BLUE'`): assert that `merged` has `name: 'Blocked'`, `color: 'RED'` (overwritten), but `id: 'opt-blocked'` (preserved).
  - Include at least one non-ADW option (e.g. `'Custom'`) with its own ID, and assert that its ID is preserved too.

- **Newly added ADW options have `id === undefined`.**
  - Input `existing`: empty array.
  - Expect every option in `merged` to satisfy `option.id === undefined` (GitHub will assign one on write).
  - Also cover a partial-overlap case: input `existing` contains `[Todo, Done]` with IDs → expect `Todo` and `Done` entries in `merged` retain their IDs, while `Blocked`, `InProgress`, `Review` entries in `merged` all have `id === undefined`.

### Step 8: Ensure the existing tests still pass

The pre-existing `describe('mergeStatusOptions')` tests (empty board, all-present, partial overlap, non-ADW preserved, overwrite color/description, case-insensitive matching) must continue to pass. Specifically:

- The "empty board" test currently does not assert ordering; update it to also assert `merged.map((o) => o.name)` matches `[Blocked, Todo, 'In Progress', Review, Done]` — this is the new post-fix ordering guarantee.
- The "partial overlap" test currently expects `merged.length === 5` but does not assert ordering; update it to additionally assert `merged.map((o) => o.name)` equals `[Blocked, Todo, 'In Progress', Review, Done]` (canonical full order when the starting set is `[Todo, Done]`).
- The "non-ADW columns are preserved" test already seeds `BOARD_COLUMNS` fully and therefore `changed` remains `false`; leave this test unchanged.
- The "case-insensitive matching" test only seeds `'todo'`; update its ordering assertion to `[Blocked, Todo, 'In Progress', Review, Done]` now that missing columns are inserted in canonical positions rather than appended.

Do not change any other test blocks (`BOARD_COLUMNS`, `BoardStatus enum`, `JiraBoardManager stub`, `GitHubBoardManager PAT fallback wrapper`, `GitLabBoardManager stub`).

### Step 9: Run Validation Commands

- `bun run lint`
- `bunx tsc --noEmit`
- `bunx tsc --noEmit -p adws/tsconfig.json`
- `bun run test:unit`

All four must pass with zero errors and zero test failures before the bug is considered fixed.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

```bash
# Lint
bun run lint

# Type check (root)
bunx tsc --noEmit

# Type check (adws)
bunx tsc --noEmit -p adws/tsconfig.json

# Unit tests (includes the extended mergeStatusOptions describe block)
bun run test:unit
```

Reproduction-level confirmation (no live GitHub call needed): the new unit tests in Steps 6–7 encode both bug conditions as assertions. Before the fix they would fail (`merged[0]` is not `Blocked` on a `[Todo, InProgress, Review, Done]` board, and every preserved option's `id` is `undefined` in the merged output). After the fix they pass.

## Notes
- Strictly follow `guidelines/coding_guidelines.md`. The merge function stays pure (no side effects, same input → same output); the mutation call remains the only side-effecting boundary. Use explicit types — no `any`, no non-null `!` assertions. Keep the file under the 300-line guideline limit (it is currently 298 lines; adding the payload mapper and widening the type should stay comfortably within the limit — if a minor extraction is needed, keep it local to the module and do not add a new file).
- No new libraries required (`bun add` not needed). Only existing imports are touched.
- The uncommitted color change in `adws/providers/types.ts` is explicitly out of scope per the issue; do not touch that file as part of this fix.
- Restoration of already-corrupted items (boards where `Blocked` was previously added programmatically and items lost their Status) is out of scope. This fix prevents future corruption only.
- `findBoard`, `createBoard`, `getStatusFieldOptions`, the `withProjectBoardAuth` PAT fallback, and the fire-and-forget wiring in `workflowInit.ts` are unchanged.
- The mutation payload change (Step 4) is backward compatible: GitHub's `ProjectV2SingleSelectFieldOptionInput` accepts `id` as an optional field. Omitting the key for new options continues to work exactly as before.
