# Bug: adwId format regression — webhook triggers produce timestamp-only IDs

## Metadata
issueNumber: `140`
adwId: `1773313804570-wb13lk`
issueJson: `{"number":140,"title":"bug: adwId format regression — webhook triggers produce timestamp-only IDs","body":"## Problem\n\nThe `agents/` directory contains a mix of naming formats:\n- **19 directories** with timestamp-only format: `1773068420299-fw4sym`\n- **40 directories** with descriptive format: `add-issue-comments-f-6vrgn2`\n\n### Root cause\n\n`webhookGatekeeper.ts:39` calls `generateAdwId()` **without** the issue title:\n\n```ts\nconst adwId = classification.adwId || generateAdwId();\n```\n\nThe issue title is already fetched inside `classifyIssueForTrigger` (line 201) but `IssueClassificationResult` doesn't carry it back to the caller.\n\nMeanwhile, the other call sites (`workflowInit.ts:107`, `prReviewPhase.ts:49`) correctly pass the title and produce descriptive slugs.\n\n## Desired behavior\n\n1. **All call sites** should pass a summary to `generateAdwId()` so the directory name is always human-readable.\n\n2. **Change the adwId format** so the random ID comes **first**, making it easier to find when searching in the `agents/` directory:\n   - Normal: `<adw-id>-<descriptive-slug>` (e.g., `fw4sym-fix-login-bug`)\n   - Fallback (rare — only when summary produces an empty slug): `<adw-id>-<timestamp>`\n\n3. **Propagate the issue title** from `classifyIssueForTrigger` back to the caller — either by adding a `title` field to `IssueClassificationResult`, or by returning the fetched issue object alongside the classification.\n\n## Files to change\n\n- `adws/core/utils.ts` — `generateAdwId()`: swap format to `{random}-{slug}` / `{random}-{timestamp}`\n- `adws/core/issueClassifier.ts` — `IssueClassificationResult` type + `classifyIssueForTrigger`: return issue title\n- `adws/triggers/webhookGatekeeper.ts` — `classifyAndSpawnWorkflow`: pass title to `generateAdwId()`\n- `adws/core/__tests__/generateAdwId.test.ts` — update expected format\n- Any regex/extraction that parses adwId format (e.g., `extractAdwIdFromComment`)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-12T11:09:49Z","comments":[],"actionableComment":null}`

## Bug Description
Webhook-triggered workflows produce non-descriptive, timestamp-only adwId values (e.g., `1773068420299-fw4sym`) while all other call sites produce human-readable slugified IDs (e.g., `add-issue-comments-f-6vrgn2`). This makes it hard to identify what each agent directory corresponds to in the `agents/` directory. Additionally, the current format puts the slug first and the random ID last, making it harder to search/sort when the slug varies.

**Expected behavior:** All adwIds should be human-readable with format `{random}-{slug}` (e.g., `fw4sym-fix-login-bug`), with a fallback of `{random}-{timestamp}` when no summary is available.

**Actual behavior:** `webhookGatekeeper.ts:39` calls `generateAdwId()` without a summary argument because `classifyIssueForTrigger()` doesn't return the issue title, even though it fetches the issue internally. The `adwDocument.tsx` and `adwTest.tsx` orchestrators also call `generateAdwId()` without a summary.

## Problem Statement
1. `classifyIssueForTrigger()` fetches the issue title internally but does not return it in `IssueClassificationResult`, so `classifyAndSpawnWorkflow()` in `webhookGatekeeper.ts` cannot pass it to `generateAdwId()`.
2. The `generateAdwId()` format is `{slug}-{random}`, but the desired format is `{random}-{slug}` for easier searching.
3. Two additional call sites (`adwDocument.tsx:40`, `adwTest.tsx:46`) also call `generateAdwId()` without a summary — though these are lower priority since they are standalone orchestrators that don't have issue context readily available.

## Solution Statement
1. Add an `issueTitle` field to `IssueClassificationResult` interface.
2. Populate `issueTitle` in `classifyIssueForTrigger()` from the fetched issue.
3. Pass the title to `generateAdwId()` in `classifyAndSpawnWorkflow()`.
4. Swap the `generateAdwId()` format from `{slug}-{random}` to `{random}-{slug}`, and the fallback from `{timestamp}-{random}` to `{random}-{timestamp}`.
5. Update all test expectations to match the new format.

## Steps to Reproduce
1. Trigger a webhook-based workflow (e.g., open a new issue with `/adw /bug`).
2. Observe the spawned agent directory under `agents/` — it uses timestamp format like `1773068420299-fw4sym`.
3. Compare with manually run orchestrators (e.g., `bunx tsx adws/adwSdlc.tsx 123`) which produce descriptive IDs like `fix-login-bug-abc123`.

## Root Cause Analysis
In `webhookGatekeeper.ts:39`:
```ts
const adwId = classification.adwId || generateAdwId();
```
The `generateAdwId()` call has no `summary` argument. The issue title was already fetched inside `classifyIssueForTrigger()` at `issueClassifier.ts:201` but `IssueClassificationResult` (defined at line 71) lacks a field to carry it back.

Other call sites (`workflowInit.ts:107`, `prReviewPhase.ts:49`, `adwPatch.tsx:67`, `adwBuild.tsx:83`) correctly pass `issue.title` or `prDetails.title` to `generateAdwId()`.

## Relevant Files
Use these files to fix the bug:

- `adws/core/utils.ts` — Contains `generateAdwId()` function. Swap format from `{slug}-{random}` to `{random}-{slug}` and fallback from `{timestamp}-{random}` to `{random}-{timestamp}`.
- `adws/core/issueClassifier.ts` — Contains `IssueClassificationResult` interface and `classifyIssueForTrigger()`. Add `issueTitle` field and populate it.
- `adws/triggers/webhookGatekeeper.ts` — Contains `classifyAndSpawnWorkflow()`. Pass `classification.issueTitle` to `generateAdwId()`.
- `adws/core/__tests__/generateAdwId.test.ts` — Tests for `generateAdwId()` and `extractAdwIdFromComment`. Update regex expectations to match new `{random}-{slug}` format.
- `adws/triggers/__tests__/triggerWebhookGatekeeper.test.ts` — Tests for `classifyAndSpawnWorkflow()`. No changes needed (mocks `generateAdwId`), but verify mock is still valid.
- `adws/github/workflowCommentsBase.ts` — Contains `extractAdwIdFromComment()`. Regex is format-agnostic (`/`(adw-[a-z0-9][a-z0-9-]*[a-z0-9])`/`) so no changes needed, but verify.
- `guidelines/coding_guidelines.md` — Read and follow these coding guidelines.

### New Files
No new files needed.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Swap `generateAdwId()` format in `adws/core/utils.ts`
- Change the format from `{slug}-{random}` to `{random}-{slug}` on line 24:
  - Before: `return \`\${slug}-\${random}\`;`
  - After: `return \`\${random}-\${slug}\`;`
- Change the fallback from `{timestamp}-{random}` to `{random}-{timestamp}` on line 26:
  - Before: `return \`\${Date.now()}-\${random}\`;`
  - After: `return \`\${random}-\${Date.now()}\`;`
- Update the JSDoc comment on lines 12-16 to reflect the new format:
  - `{random}-{slugified-summary}` (normal)
  - `{random}-{timestamp}` (fallback)

### Step 2: Add `issueTitle` to `IssueClassificationResult` in `adws/core/issueClassifier.ts`
- Add an optional `issueTitle?: string` field to the `IssueClassificationResult` interface (line 71-76).
- In `classifyIssueForTrigger()` (line 194), populate `issueTitle` from the fetched issue's title. Both the `adwResult` return (line 213) and the `heuristicResult` return (line 228) need to include `issueTitle: issue.title`.
  - For `adwResult`: spread the result and add `issueTitle: issue.title` before returning.
  - For `heuristicResult`: spread the result and add `issueTitle: issue.title` before returning.

### Step 3: Pass issue title to `generateAdwId()` in `adws/triggers/webhookGatekeeper.ts`
- On line 39, change from:
  ```ts
  const adwId = classification.adwId || generateAdwId();
  ```
  To:
  ```ts
  const adwId = classification.adwId || generateAdwId(classification.issueTitle);
  ```

### Step 4: Update test expectations in `adws/core/__tests__/generateAdwId.test.ts`
- Update all regex expectations to match the new `{random}-{slug}` format:
  - Line 9: `expect(id).toMatch(/^[a-z0-9]{6}-fix-login-bug$/);`
  - Line 29: `expect(id).toMatch(/^fix-bug-can-t-login-[a-z0-9]{6}$/);` → `expect(id).toMatch(/^[a-z0-9]{6}-fix-bug-can-t-login$/);`
  - Line 34: `expect(id).toMatch(/^add-new-feature-[a-z0-9]{6}$/);` → `expect(id).toMatch(/^[a-z0-9]{6}-add-new-feature$/);`
- Update truncation test (line 12-17):
  - The summary part is now after the random prefix. Split on first `-` to extract slug portion, or adjust the regex/assertion to validate the slug part comes after the 6-char random prefix.
  - The slug part should still be ≤ 20 characters.
- Update trailing hyphen test (line 20-24):
  - Adjust parsing to extract slug from after the random prefix.
- Update fallback tests (lines 37-52):
  - Timestamp format changes from `^\d+-[a-z0-9]{6}$` to `^[a-z0-9]{6}-\d+$`
- Update random suffix test (lines 55-62):
  - The random part is now the first segment. Adjust `.split('-').pop()` to `.split('-')[0]` or use `.split('-').shift()`.

### Step 5: Verify `extractAdwIdFromComment` tests still pass
- Review the `extractAdwIdFromComment` tests in `adws/core/__tests__/generateAdwId.test.ts` (lines 74-99). The regex `/`(adw-[a-z0-9][a-z0-9-]*[a-z0-9])`/` is format-agnostic and should work with both old and new formats. No changes should be needed.
- Verify that `extractAdwIdFromText` in `issueClassifier.ts` also remains compatible — its regex patterns are format-agnostic.

### Step 6: Run validation commands
- Run all validation commands listed below to confirm the fix is correct with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the ADW scripts
- `bun run test` - Run all tests to validate the bug is fixed with zero regressions

## Notes
- The `extractAdwIdFromComment()` regex in `workflowCommentsBase.ts` is format-agnostic (`/`(adw-[a-z0-9][a-z0-9-]*[a-z0-9])`/`), so the format swap does not break comment parsing or recovery state detection.
- The `extractAdwIdFromText()` regex patterns in `issueClassifier.ts` are also format-agnostic — no changes needed.
- The plan file path regex in `planAgent.ts` (`/^issue-${issueNumber}-adw-.*-sdlc_planner-.*\.md$/`) uses a wildcard for the adwId portion, so the format change is transparent.
- `adwDocument.tsx:40` and `adwTest.tsx:46` also call `generateAdwId()` without a summary. These are standalone orchestrators invoked with a CLI-provided adwId or no issue context. Fixing these is out of scope for this bug — they are not part of the webhook trigger regression.
- Strictly follow `guidelines/coding_guidelines.md` for all changes.
