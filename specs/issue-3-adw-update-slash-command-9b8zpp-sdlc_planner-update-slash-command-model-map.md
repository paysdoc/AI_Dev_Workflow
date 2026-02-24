# Chore: Update SLASH_COMMAND_MODEL_MAP

## Metadata
issueNumber: `3`
adwId: `update-slash-command-9b8zpp`
issueJson: `{"number":3,"title":"Update SLASH_COMMAND_MODEL_MAP","body":"The SLASH_COMMAND_MODEL_MAP contains the models to be used for various commands. If the user wants a cheaper option, the models should be adjusted.\n\nThe current (default) setting should be:\n  - '/classify_adw': 'haiku',\n  - '/classify_issue': 'sonnet',\n  - '/feature': 'opus',\n  - '/bug': 'opus',\n  - '/chore': 'opus',\n  - '/pr_review': 'opus',\n  - '/implement': 'opus',\n  - '/patch': 'opus',\n  - '/review': 'opus',\n  - '/test': 'haiku',\n  - '/resolve_failed_test': 'opus',\n  - '/resolve_failed_e2e_test': 'opus',\n  - '/generate_branch_name': 'sonnet',\n  - '/commit': 'sonnet',\n  - '/pull_request': 'sonnet',\n  - '/document': 'sonnet',\n  - '/find_plan_file': 'sonnet',\n\nWhen the issue contains the keyword '/fast' or '/cheap' then the stting is:\n\nThe current (default) setting is:\n  - '/classify_adw': 'haiku',\n  - '/classify_issue': 'haiku',\n  - '/feature': 'opus',\n  - '/bug': 'opus',\n  - '/chore': 'opus',\n  - '/pr_review': 'opus',\n  - '/implement': 'sonnet',\n  - '/patch': 'opus',\n  - '/review': 'sonnet',\n  - '/test': 'haiku',\n  - '/resolve_failed_test': 'opus',\n  - '/resolve_failed_e2e_test': 'opus',\n  - '/generate_branch_name': 'haiku',\n  - '/commit': 'haiku',\n  - '/pull_request': 'haiku',\n  - '/document': 'sonnet',\n  - '/find_plan_file': 'haiku',","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-24T15:32:34Z","comments":[],"actionableComment":null}`

## Chore Description
Update the `SLASH_COMMAND_MODEL_MAP` in `adws/core/config.ts` to:

1. **Fix the default model map** — Two values differ from the desired defaults:
   - `/classify_issue`: currently `'haiku'` → should be `'sonnet'`
   - `/test`: currently `'sonnet'` → should be `'haiku'`

2. **Add a fast/cheap model map variant** — When a GitHub issue body contains the keyword `/fast` or `/cheap`, agents should use a cost-optimized model map that downgrades certain commands:
   - `/classify_issue`: `'sonnet'` → `'haiku'`
   - `/implement`: `'opus'` → `'sonnet'`
   - `/review`: `'opus'` → `'sonnet'`
   - `/generate_branch_name`: `'sonnet'` → `'haiku'`
   - `/commit`: `'sonnet'` → `'haiku'`
   - `/pull_request`: `'sonnet'` → `'haiku'`
   - `/find_plan_file`: `'sonnet'` → `'haiku'`

3. **Thread the issue body to all agents** so each can resolve the correct model via a helper function, and update all agent files that reference `SLASH_COMMAND_MODEL_MAP` to use the new function.

## Relevant Files
Use these files to resolve the chore:

- `adws/core/config.ts` — Contains the `SLASH_COMMAND_MODEL_MAP` constant that needs updating plus the new fast map and helper function.
- `adws/core/index.ts` — Re-exports from `config.ts`; must export the new function.
- `adws/agents/buildAgent.ts` — Uses `SLASH_COMMAND_MODEL_MAP['/implement']`; must switch to new helper.
- `adws/agents/planAgent.ts` — Uses `SLASH_COMMAND_MODEL_MAP[issueType]`; must switch to new helper.
- `adws/agents/reviewAgent.ts` — Uses `SLASH_COMMAND_MODEL_MAP['/review']`; must switch to new helper.
- `adws/agents/testAgent.ts` — Uses `SLASH_COMMAND_MODEL_MAP['/test']`, `['/resolve_failed_test']`, `['/resolve_failed_e2e_test']`; must switch to new helper.
- `adws/agents/gitAgent.ts` — Uses `SLASH_COMMAND_MODEL_MAP['/generate_branch_name']` and `['/commit']`; must switch to new helper.
- `adws/agents/patchAgent.ts` — Uses `SLASH_COMMAND_MODEL_MAP['/patch']`; must switch to new helper.
- `adws/agents/prAgent.ts` — Uses `SLASH_COMMAND_MODEL_MAP['/pull_request']`; must switch to new helper.
- `adws/agents/documentAgent.ts` — Uses `SLASH_COMMAND_MODEL_MAP['/document']`; must switch to new helper.
- `adws/core/issueClassifier.ts` — Uses `SLASH_COMMAND_MODEL_MAP['/classify_adw']` and `['/classify_issue']`; must switch to new helper.

### New Files
- `adws/__tests__/slashCommandModelMap.test.ts` — Unit tests for the new `getModelForCommand` function and both model maps.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update the default model map and add fast map in `adws/core/config.ts`

- Update `SLASH_COMMAND_MODEL_MAP` to fix the two default values:
  - Change `'/classify_issue': 'haiku'` → `'/classify_issue': 'sonnet'`
  - Change `'/test': 'sonnet'` → `'/test': 'haiku'`
- Add a new constant `SLASH_COMMAND_MODEL_MAP_FAST` of the same type `Record<SlashCommand, 'opus' | 'sonnet' | 'haiku'>` with the fast/cheap values specified in the issue.
- Add a pure helper function:
  ```typescript
  /**
   * Detects whether `/fast` or `/cheap` keywords appear in text.
   * Returns true if the text contains either keyword.
   */
  export function isFastMode(issueBody?: string): boolean {
    if (!issueBody) return false;
    return /\/fast\b|\/cheap\b/i.test(issueBody);
  }

  /**
   * Returns the model for a given slash command, selecting the fast/cheap map
   * when the issue body contains `/fast` or `/cheap` keywords.
   */
  export function getModelForCommand(
    command: SlashCommand,
    issueBody?: string,
  ): 'opus' | 'sonnet' | 'haiku' {
    const map = isFastMode(issueBody)
      ? SLASH_COMMAND_MODEL_MAP_FAST
      : SLASH_COMMAND_MODEL_MAP;
    return map[command];
  }
  ```
- Keep the original `SLASH_COMMAND_MODEL_MAP` exported for backward compatibility; the new `getModelForCommand` is the preferred API going forward.

### Step 2: Update exports in `adws/core/index.ts`

- Add `getModelForCommand` and `isFastMode` to the exports from `./config`.
- Keep `SLASH_COMMAND_MODEL_MAP` exported (it remains the default map and is still useful for direct access when no issue body is available).
- Also export `SLASH_COMMAND_MODEL_MAP_FAST` for testing and direct access.

### Step 3: Update `adws/core/issueClassifier.ts`

- Import `getModelForCommand` from `../core/config` (or from `../core`).
- Replace `SLASH_COMMAND_MODEL_MAP['/classify_adw']` with `getModelForCommand('/classify_adw', issue.body)`.
- Replace `SLASH_COMMAND_MODEL_MAP['/classify_issue']` with `getModelForCommand('/classify_issue', issue.body)`.
- Note: `issueClassifier.ts` already has access to the `issue` object including `issue.body`.

### Step 4: Update `adws/agents/planAgent.ts`

- Import `getModelForCommand` instead of (or in addition to) `SLASH_COMMAND_MODEL_MAP`.
- In `runPlanAgent()`: replace `SLASH_COMMAND_MODEL_MAP[issueType]` with `getModelForCommand(issueType, issue.body)`. The `issue` object is already available as a parameter.
- In `runPrReviewPlanAgent()`: replace `SLASH_COMMAND_MODEL_MAP['/pr_review']` with `getModelForCommand('/pr_review', issue.body)`. The `issue` object is available via function params.

### Step 5: Update `adws/agents/buildAgent.ts`

- Import `getModelForCommand`.
- In `runBuildAgent()`: replace `SLASH_COMMAND_MODEL_MAP['/implement']` with `getModelForCommand('/implement', issueBody)`. Add an `issueBody?: string` parameter to the function signature if not already present, and thread it from the caller.
- In `runPrReviewBuildAgent()`: similarly replace with `getModelForCommand('/implement', issueBody)` and add the `issueBody` parameter.
- Update callers in `adws/phases/buildPhase.ts` to pass `config.issue.body` as the issue body argument.

### Step 6: Update `adws/agents/reviewAgent.ts`

- Import `getModelForCommand`.
- In `runReviewAgent()`: replace `SLASH_COMMAND_MODEL_MAP['/review']` with `getModelForCommand('/review', issueBody)`. Add `issueBody?: string` parameter.
- Update callers in `adws/phases/prReviewPhase.ts` to pass `config.issue.body`.

### Step 7: Update `adws/agents/testAgent.ts`

- Import `getModelForCommand`.
- In `runTestAgent()`: replace `SLASH_COMMAND_MODEL_MAP['/test']` with `getModelForCommand('/test', issueBody)`. Add `issueBody?: string` parameter.
- In `runResolveTestAgent()`: replace `SLASH_COMMAND_MODEL_MAP['/resolve_failed_test']` with `getModelForCommand('/resolve_failed_test', issueBody)`. Add `issueBody?: string` parameter.
- In `runResolveE2ETestAgent()`: replace `SLASH_COMMAND_MODEL_MAP['/resolve_failed_e2e_test']` with `getModelForCommand('/resolve_failed_e2e_test', issueBody)`. Add `issueBody?: string` parameter.
- Update callers in `adws/phases/testPhase.ts` to pass the issue body.

### Step 8: Update `adws/agents/gitAgent.ts`

- Import `getModelForCommand`.
- In `runGenerateBranchNameAgent()`: replace `SLASH_COMMAND_MODEL_MAP['/generate_branch_name']` with `getModelForCommand('/generate_branch_name', issueBody)`. Add `issueBody?: string` parameter.
- In `runCommitAgent()`: replace `SLASH_COMMAND_MODEL_MAP['/commit']` with `getModelForCommand('/commit', issueBody)`. Add `issueBody?: string` parameter.
- Update callers in relevant phases (`planPhase.ts`, `buildPhase.ts`, `prPhase.ts`, etc.) to pass the issue body.

### Step 9: Update `adws/agents/patchAgent.ts`

- Import `getModelForCommand`.
- In `runPatchAgent()`: replace `SLASH_COMMAND_MODEL_MAP['/patch']` with `getModelForCommand('/patch', issueBody)`. Add `issueBody?: string` parameter.
- Update callers to pass the issue body.

### Step 10: Update `adws/agents/prAgent.ts`

- Import `getModelForCommand`.
- In `runPullRequestAgent()`: replace `SLASH_COMMAND_MODEL_MAP['/pull_request']` with `getModelForCommand('/pull_request', issueBody)`. Add `issueBody?: string` parameter.
- Update callers in `adws/phases/prPhase.ts` to pass the issue body.

### Step 11: Update `adws/agents/documentAgent.ts`

- Import `getModelForCommand`.
- In `runDocumentAgent()`: replace `SLASH_COMMAND_MODEL_MAP['/document']` with `getModelForCommand('/document', issueBody)`. Add `issueBody?: string` parameter.
- Update callers in `adws/phases/documentPhase.ts` to pass the issue body.

### Step 12: Write unit tests in `adws/__tests__/slashCommandModelMap.test.ts`

- Test that the default `SLASH_COMMAND_MODEL_MAP` has the correct values for all 17 commands.
- Test that `SLASH_COMMAND_MODEL_MAP_FAST` has the correct values for all 17 commands.
- Test `isFastMode()`:
  - Returns `false` for `undefined` input.
  - Returns `false` for empty string.
  - Returns `false` for body without keywords.
  - Returns `true` for body containing `/fast`.
  - Returns `true` for body containing `/cheap`.
  - Returns `true` for body containing both `/fast` and `/cheap`.
  - Returns `true` when keywords appear mid-sentence (e.g., `"Please use /fast mode"`).
  - Returns `false` for partial matches like `/faster` (the `\b` word boundary should prevent this).
- Test `getModelForCommand()`:
  - Returns default map value when no issue body provided.
  - Returns default map value when body has no keywords.
  - Returns fast map value when body contains `/fast`.
  - Returns fast map value when body contains `/cheap`.
  - Specifically test the commands that differ between maps (`/classify_issue`, `/implement`, `/review`, `/generate_branch_name`, `/commit`, `/pull_request`, `/find_plan_file`).

### Step 13: Run validation commands

- Run all validation commands listed below to ensure zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the chore is complete with zero regressions

## Notes
- IMPORTANT: strictly adhere to the coding guidelines in `/guidelines`. If necessary, refactor existing code to meet the coding guidelines as part of accomplishing the chore.
- The `SLASH_COMMAND_MODEL_MAP` constant is kept exported so existing direct references still compile, but going forward `getModelForCommand()` is the preferred API since it supports fast mode.
- When adding `issueBody?: string` parameters to agent functions, place them as the last optional parameter to maintain backward compatibility with existing callers that don't pass it.
- The `/fast` and `/cheap` keyword detection uses word boundary (`\b`) to avoid false positives on words like `/faster` or `/cheapest`.
- The `issueClassifier.ts` already has access to the full issue object, so no signature changes are needed there.
- For agents called from phases, the `WorkflowConfig.issue.body` is the source of the issue body text. Each phase file has access to `config.issue` through the `WorkflowConfig` parameter.
