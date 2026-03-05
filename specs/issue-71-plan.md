# PR-Review: Consistent argument formatting across all agents

## PR-Review Description
The PR review identified that fixing `prAgent` to return an array created an inconsistency across agents. Some agents format args as arrays (positional `$1`, `$2`, etc.) while others use newline-separated or markdown-formatted strings. The reviewer requests a consistent approach across all agents: adwInit, buildAgent, documentAgent, gitAgent, patchAgent, planAgent, prAgent, reviewAgent, testAgent, and issueClassifier.

## Summary of Original Implementation Plan
The original plan (`specs/issue-71-adw-pragent-passes-args-vrcjoy-sdlc_planner-fix-pr-agent-args-array.md`) fixed `formatPullRequestArgs` in `prAgent.ts` to return `string[]` instead of a newline-separated `string`. This ensured the `/pull_request` slash command received 5 separate positional arguments (`$1`–`$5`) instead of one concatenated string. Tests were updated accordingly.

## Relevant Files
Use these files to resolve the review:

- `adws/agents/claudeAgent.ts` — Contains `runClaudeAgentWithCommand` which accepts `string | readonly string[]`. Understanding the escaping behavior is key: strings become a single quoted arg, arrays become multiple quoted args. No changes needed.
- `adws/agents/prAgent.ts` — Already returns `string[]`. No changes needed (already consistent).
- `adws/agents/planAgent.ts` — Already passes `string[]` inline at line 271. No changes needed.
- `adws/agents/buildAgent.ts` — `formatImplementArgs` and `formatPrReviewImplementArgs` return `string`. The `/implement` command uses `$ARGUMENTS` (single blob), so string is correct. No changes needed.
- `adws/agents/documentAgent.ts` — `formatDocumentArgs` returns newline-separated `string` but `/document` uses positional `$1`, `$2`, `$3`. Must convert to `string[]`.
- `adws/agents/gitAgent.ts` — `formatBranchNameArgs` returns a multi-line string but `/generate_branch_name` uses `$1`, `$2`. Must convert to `string[]`. `formatCommitArgs` returns a multi-line string but `/commit` uses `$1`, `$2`, `$3`. Must convert to `string[]`.
- `adws/agents/patchAgent.ts` — `formatPatchArgs` returns newline-separated `string` but `/patch` uses `$1`–`$5`. Must convert to `string[]`.
- `adws/agents/reviewAgent.ts` — Args built inline as newline-separated `string` but `/review` uses `$1`–`$4`. Must convert to `string[]` via a new `formatReviewArgs` function.
- `adws/agents/testAgent.ts` — `runTestAgent` passes empty string (no args needed). `runResolveTestAgent` and `runResolveE2ETestAgent` pass JSON strings for `/resolve_failed_test` and `/resolve_failed_e2e_test` which use `$ARGUMENTS`. String is correct. No changes needed.
- `adws/core/issueClassifier.ts` — Passes a string to `/classify_issue` which uses `$ARGUMENTS`. String is correct. No changes needed.
- `adws/adwInit.tsx` — Passes space-separated string to `/adw_init` which uses `$1`, `$2`, `$3`. Must convert to `string[]`.
- `adws/__tests__/documentAgent.test.ts` — Tests for `formatDocumentArgs` must be updated for array format.
- `adws/__tests__/gitAgent.test.ts` — Tests for `formatBranchNameArgs` and `formatCommitArgs` must be updated for array format.
- `adws/__tests__/patchAgent.test.ts` — Tests for `formatPatchArgs` must be updated for array format.
- `adws/__tests__/reviewAgent.test.ts` — Tests must be updated for array format args.
- `adws/__tests__/adwInit.test.ts` — Tests for adwInit args must be updated for array format (if this file exists).
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Update `formatDocumentArgs` in `adws/agents/documentAgent.ts` to return `string[]`

- Change return type from `string` to `string[]`
- Change the return statement from `return \`${adwId}\n${specPath ?? ''}\n${screenshotsDir ?? ''}\`` to `return [adwId, specPath ?? '', screenshotsDir ?? '']`

### 2. Update `formatBranchNameArgs` in `adws/agents/gitAgent.ts` to return `string[]`

- Change return type from `string` to `string[]`
- Change the return statement from the multi-line template literal to `return [issueClass, JSON.stringify(issue)]`

### 3. Update `formatCommitArgs` in `adws/agents/gitAgent.ts` to return `string[]`

- Change return type from `string` to `string[]`
- Change the return statement from the multi-line template literal to `return [agentName, issueClass, issueContext]`

### 4. Update `formatPatchArgs` in `adws/agents/patchAgent.ts` to return `string[]`

- Change return type from `string` to `string[]`
- Keep the `reviewChangeRequest` variable construction as-is
- Change the return statement from the newline-separated string to `return [adwId, reviewChangeRequest, specPath ?? '', 'patchAgent', screenshots ?? '']`

### 5. Extract `formatReviewArgs` in `adws/agents/reviewAgent.ts` and return `string[]`

- Create a new exported function `formatReviewArgs(adwId: string, specFile: string, agentName: string, applicationUrl?: string): string[]`
- Return `applicationUrl ? [adwId, specFile, agentName, applicationUrl] : [adwId, specFile, agentName]`
- Update `runReviewAgent` to call `formatReviewArgs(adwId, specFile, agentName, applicationUrl)` instead of building the string inline

### 6. Update `adws/adwInit.tsx` to pass args as `string[]`

- Change the inline string `\`${config.issueNumber} ${config.adwId} ${issueJson}\`` to `[String(config.issueNumber), config.adwId, issueJson]`

### 7. Update tests in `adws/__tests__/documentAgent.test.ts`

- Update `formatDocumentArgs` test assertions to expect arrays instead of newline-separated strings
- For example, `expect(result).toEqual(['adw-123', 'specs/plan.md', 'screenshots/'])` instead of checking for newline-separated string

### 8. Update tests in `adws/__tests__/gitAgent.test.ts`

- Update `formatBranchNameArgs` test assertions to expect `[issueClass, JSON.stringify(issue)]` array
- Update `formatCommitArgs` test assertions to expect `[agentName, issueClass, issueContext]` array

### 9. Update tests in `adws/__tests__/patchAgent.test.ts`

- Update `formatPatchArgs` test assertions to expect arrays
- Update any `toContain` assertions on args to use array indexing instead (e.g., `expect(args[2]).toBe('/specs/plan.md')`)

### 10. Update tests in `adws/__tests__/reviewAgent.test.ts`

- Update assertions that check for newline-separated string args to expect arrays
- For example, change `'adw-123\nspecs/issue-1-plan.md\nreview_agent'` to `['adw-123', 'specs/issue-1-plan.md', 'review_agent']`
- Update the `applicationUrl` test to expect 4-element array
- Add tests for the new `formatReviewArgs` function

### 11. Update tests in `adws/__tests__/adwInit.test.ts` (if exists)

- If this test file exists, update any assertions on args passed to `runClaudeAgentWithCommand` to expect arrays instead of space-separated strings

### 12. Run validation commands

- Run all validation commands listed below to validate the review is complete with zero regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws project to verify all return type changes compile correctly
- `npm test` — Run all tests to validate the changes and ensure zero regressions
- `npm run lint` — Run linter to check for code quality issues
- `npm run build` — Build the application to verify no build errors

## Notes
- The guiding principle is: **slash commands that use positional variables (`$1`, `$2`, etc.) should receive arrays; slash commands that use `$ARGUMENTS` (single blob) should receive strings.** This is inherent to how `runClaudeAgentWithCommand` works — strings become one quoted arg, arrays become multiple quoted args.
- Agents that correctly use strings and need NO changes: `buildAgent` (`/implement` uses `$ARGUMENTS`), `testAgent` (`/test` has no args; `/resolve_failed_test` and `/resolve_failed_e2e_test` use `$ARGUMENTS`), `issueClassifier` (`/classify_issue` uses `$ARGUMENTS`).
- Agents that already correctly use arrays and need NO changes: `prAgent` (fixed in original PR), `planAgent` (already uses arrays).
- Agents that need conversion from string to array: `documentAgent`, `gitAgent` (both functions), `patchAgent`, `reviewAgent`, `adwInit`.
- Follow the coding guidelines: use immutability (returning new arrays), type safety (explicit `string[]` return types), and clarity (array literals are more explicit than string concatenation).
