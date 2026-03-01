# Chore: Remove /classify_adw command

## Metadata
issueNumber: `44`
adwId: `remove-classify-adw-jfxgze`
issueJson: `{"number":44,"title":"Remove /classify_adw command","body":"The /classify_adw command does not add any useful LLM reasoning. The command can be rplaced by a simple regex - as is already being applied through the use of VALID_ISSUE_TYPES.\n\nadwId should also be findable using code","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-01T13:11:35Z","comments":[],"actionableComment":null}`

## Chore Description
The `/classify_adw` slash command is an LLM-based classifier that extracts ADW workflow commands (e.g., `/adw_plan`, `/adw_build`) and `adwId` values from issue text. However, the `classifyWithAdwCommand` function in `issueClassifier.ts` already has a deterministic regex pre-check (`extractAdwCommandFromText`) that handles ADW command extraction without any LLM call. The LLM fallback via `/classify_adw` adds no useful reasoning — it's a pattern-matching task that regex handles better, faster, and cheaper.

Additionally, `adwId` extraction (the second thing the LLM was doing) can be handled deterministically using regex, similar to the existing `extractAdwIdFromComment` function in `workflowCommentsBase.ts`.

This chore removes the `/classify_adw` command entirely, makes `classifyWithAdwCommand` fully deterministic (regex-only), adds a new `extractAdwIdFromText` regex function for adwId extraction, and cleans up all references across the codebase.

## Relevant Files
Use these files to resolve the chore:

- **`.claude/commands/classify_adw.md`** — The slash command file to delete. Contains the LLM prompt for ADW workflow extraction.
- **`adws/core/issueClassifier.ts`** — Core classification logic. Contains `classifyWithAdwCommand` (needs LLM call removed), `parseAdwClassificationOutput` (to remove), and `extractAdwCommandFromText` (keep). Needs new `extractAdwIdFromText` function.
- **`adws/core/issueTypes.ts`** — Type definitions. Contains `SlashCommand` type (remove `'/classify_adw'` entry) and `AdwClassificationResult` interface (to remove).
- **`adws/core/config.ts`** — Model routing maps. Contains `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_MODEL_MAP_FAST` (remove `'/classify_adw'` entries).
- **`adws/core/index.ts`** — Barrel exports. Remove `parseAdwClassificationOutput` export and `AdwClassificationResult` type export.
- **`adws/__tests__/issueClassifier.test.ts`** — Tests for issue classification. Remove `parseAdwClassificationOutput` tests, update `classifyWithAdwCommand` tests to reflect regex-only behavior, add tests for `extractAdwIdFromText`.
- **`adws/__tests__/slashCommandModelMap.test.ts`** — Tests for model maps. Remove `/classify_adw` references, update count from 19 to 18.
- **`.adw/conditional_docs.md`** — Conditional documentation registry. Remove the `.claude/commands/classify_adw.md` entry.
- **`README.md`** — Project structure listing. Remove `classify_adw.md` from the `.claude/commands/` tree.
- **`guidelines/coding_guidelines.md`** — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Delete the `/classify_adw` slash command file
- Delete `.claude/commands/classify_adw.md`

### Step 2: Remove `AdwClassificationResult` from `adws/core/issueTypes.ts`
- Remove the `AdwClassificationResult` interface (lines 83-88):
  ```typescript
  export interface AdwClassificationResult {
    adwSlashCommand?: AdwSlashCommand;
    adwId?: string;
  }
  ```
- Remove `'/classify_adw'` from the `SlashCommand` type union (line 137)

### Step 3: Remove `/classify_adw` from model maps in `adws/core/config.ts`
- Remove the `'/classify_adw': 'haiku'` entry from `SLASH_COMMAND_MODEL_MAP` (line 137)
- Remove the `'/classify_adw': 'haiku'` entry from `SLASH_COMMAND_MODEL_MAP_FAST` (line 170)

### Step 4: Update `adws/core/index.ts` barrel exports
- Remove `AdwClassificationResult` from the type exports (line 12)
- Remove `parseAdwClassificationOutput` from the function exports (line 112)

### Step 5: Refactor `adws/core/issueClassifier.ts` to be regex-only
- Remove the import of `runClaudeAgentWithCommand` from `'../agents/claudeAgent'`
- Remove the import of `AdwClassificationResult` from `'.'`
- Remove the import of `getModelForCommand` from `'.'`
- Remove the import of `extractJson` from `'./jsonParser'`
- Remove the `parseAdwClassificationOutput` function entirely (lines 63-92)
- Add a new `extractAdwIdFromText` function that extracts adwId from text using regex. The function should match patterns like `adwId: <value>`, `ADW ID: <value>`, or backtick-wrapped adw IDs (`` `adw-{slug}-{random}` ``). Use the same pattern as `extractAdwIdFromComment` in `workflowCommentsBase.ts` for backtick format, and also match label-prefixed formats. The function signature:
  ```typescript
  export function extractAdwIdFromText(text: string): string | null {
    if (!text) return null;
    // Match label-prefixed patterns: "adwId: xyz" or "ADW ID: xyz" or "adw_id: xyz"
    const labelMatch = text.match(/(?:adwId|adw[_\s-]id)\s*[:=]\s*[`"']?([a-z0-9][a-z0-9-]*[a-z0-9])[`"']?/i);
    if (labelMatch) return labelMatch[1];
    // Match backtick-wrapped ADW IDs (same pattern as extractAdwIdFromComment)
    const backtickMatch = text.match(/`(adw-[a-z0-9][a-z0-9-]*[a-z0-9])`/);
    return backtickMatch ? backtickMatch[1] : null;
  }
  ```
- Refactor `classifyWithAdwCommand` to be synchronous and regex-only:
  - Change the signature from `async` to synchronous, returning `IssueClassificationResult | null` instead of `Promise<IssueClassificationResult | null>`
  - Remove the `outputFile` parameter (no longer needed)
  - Use `extractAdwCommandFromText` for command extraction (already present)
  - Use `extractAdwIdFromText` for adwId extraction (new)
  - Remove the entire LLM agent call block (the try/catch with `runClaudeAgentWithCommand`)
  - The function body should be:
    ```typescript
    export function classifyWithAdwCommand(
      issueContext: string,
      issueNumber: number,
      issueBody?: string,
    ): IssueClassificationResult | null {
      const text = issueBody ?? issueContext;
      const adwCommand = extractAdwCommandFromText(text);
      if (!adwCommand) return null;

      const issueType = adwCommandToIssueTypeMap[adwCommand];
      const adwId = extractAdwIdFromText(text);
      log(`Issue #${issueNumber} matched ADW command ${adwCommand} via regex`, 'success');

      return {
        issueType,
        success: true,
        adwCommand,
        ...(adwId ? { adwId } : {}),
      };
    }
    ```
- Update `classifyIssueForTrigger` call to `classifyWithAdwCommand`:
  - Remove the output file argument (`/tmp/adw-trigger-adw-classifier-${issueNumber}.jsonl`)
  - Remove the `await` (function is now synchronous)
  - Update log messages to remove "Attempting ADW classification (/classify_adw)" — change to "Checking for explicit ADW command in issue #${issueNumber}..."
- Update `classifyGitHubIssue` call to `classifyWithAdwCommand`:
  - Remove the output file argument (`/tmp/adw-adw-classifier-${issue.number}.jsonl`)
  - Remove the `await` (function is now synchronous)
  - Update log messages to remove "Attempting ADW classification (/classify_adw)" — change to "Checking for explicit ADW command in issue #${issue.number}..."

### Step 6: Update `adws/__tests__/issueClassifier.test.ts`
- Remove the `parseAdwClassificationOutput` import and its entire `describe` block
- Remove `AdwClassificationResult` from imports if present
- Add a new `describe('extractAdwIdFromText', ...)` block testing:
  - Returns adwId for `"adwId: fix-bug-abc123"` → `"fix-bug-abc123"`
  - Returns adwId for `"ADW ID: my-workflow-xyz789"` → `"my-workflow-xyz789"`
  - Returns adwId for backtick-wrapped: `` "ID: `adw-fix-bug-abc123`" `` → `"adw-fix-bug-abc123"`
  - Returns null for empty text
  - Returns null for text with no adwId patterns
- Update `classifyWithAdwCommand` tests:
  - Remove all tests that mock `runClaudeAgentWithCommand` for the `/classify_adw` flow (these tests relied on LLM agent calls which are now removed)
  - Keep the regex pre-check test (`'returns immediately via regex pre-check when issueBody contains explicit /adw_init'`)
  - Update the test to not pass the `outputFile` argument
  - Add a test for adwId extraction: when text has both `/adw_build` and `adwId: abc12345`, both should be returned
  - Add a test: returns null when no ADW command is found in text
  - Keep the `'maps each ADW command to the correct IssueClassSlashCommand'` test but refactor it to test via direct function calls with text containing the command, not via LLM mocks
- Update `classifyIssueForTrigger` tests:
  - The test `'uses ADW classification when /classify_adw finds a command (no regex match)'` should be removed (no more LLM fallback)
  - The test `'falls back to /classify_issue when /classify_adw returns empty'` should be updated: now it falls back when no regex match is found (no more first `runClaudeAgentWithCommand` call for classify_adw). The mock should only have one call for `/classify_issue`, not two calls (one for classify_adw, one for classify_issue)
  - The test `'defaults to /feature when both classifiers fail'` should be updated: only one `runClaudeAgentWithCommand` call expected (for classify_issue), not two
  - Keep the regex pre-check test
- Update `classifyGitHubIssue` tests:
  - The test `'uses ADW classification when /classify_adw finds a command (no regex match)'` should be removed
  - The test `'falls back to /classify_issue when /classify_adw returns empty'` should be updated: only one mock call expected (for classify_issue)
  - The test `'defaults to /feature when both classifiers fail'` should be updated: only one mock call
  - Keep the regex pre-check test
  - Keep the labels test but update to expect only one `runClaudeAgentWithCommand` call
  - Keep the last command test but update to expect only one call

### Step 7: Update `adws/__tests__/slashCommandModelMap.test.ts`
- Remove `expect(SLASH_COMMAND_MODEL_MAP['/classify_adw']).toBe('haiku');` from the default map test
- Remove `expect(SLASH_COMMAND_MODEL_MAP_FAST['/classify_adw']).toBe('haiku');` from the fast map test
- Update both `'has exactly 19 entries'` tests to `'has exactly 18 entries'` and change `toHaveLength(19)` to `toHaveLength(18)`
- Remove the `it('/classify_adw stays haiku', ...)` test from the "commands that stay the same" describe block

### Step 8: Update `.adw/conditional_docs.md`
- Remove the entire `.claude/commands/classify_adw.md` entry (lines 9-11):
  ```markdown
  - .claude/commands/classify_adw.md
    - Conditions:
      - When adding or removing new `adws/adw_*.ts*` files
  ```

### Step 9: Update `README.md`
- Remove `│   ├── classify_adw.md` from the project structure tree (line 83)

### Step 10: Run validation commands
- Run all validation commands to ensure zero regressions

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Type check the adws project
- `npm test` - Run tests to validate the chore is complete with zero regressions
- `npm run build` - Build the application to verify no build errors

## Notes
- IMPORTANT: Follow `guidelines/coding_guidelines.md` strictly — especially type safety, code hygiene (remove unused imports/variables), and functional programming practices.
- The `classifyWithAdwCommand` function changes from async to synchronous. Callers use `await` on it, which is harmless (awaiting a non-Promise is a no-op in TypeScript/JavaScript), but the `await` keywords should be removed for clarity.
- The `IssueClassificationResult` interface and `IssueClassificationResult.adwId` field remain unchanged — only the source of adwId changes from LLM output to regex extraction.
- The `extractAdwIdFromText` function is distinct from `extractAdwIdFromComment` in `workflowCommentsBase.ts`. The comment extractor matches backtick-wrapped IDs in ADW-posted comments. The new text extractor also handles label-prefixed patterns (e.g., `adwId: value`) that users might write in issue bodies.
- The `adwCommandToIssueTypeMap` test (`'maps each ADW command...'`) should be refactored to construct text containing each command and call the function directly, instead of mocking the LLM agent.
