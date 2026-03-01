# Feature: Add Logging to Issue Classifier

## Metadata
issueNumber: `46`
adwId: `add-logging-to-class-5dutxn`
issueJson: `{"number":46,"title":"Add logging to classifier","body":"The issue classifier should log more to giva a better idea which classifier (code or heuristic) it chose and why it has arrived at the classification that it did","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-01T15:26:20Z","comments":[],"actionableComment":null}`

## Feature Description
The issue classifier (`adws/core/issueClassifier.ts`) currently has minimal logging — it logs when a regex match succeeds, when it falls back to heuristic classification, and the final result. However, it does not provide enough detail to understand *why* a particular classification was chosen. This feature adds comprehensive logging throughout the classification pipeline so operators can trace the decision-making process: which classifier path was taken (deterministic regex vs. AI heuristic), what patterns were checked, what the AI model returned, and how the final issue type was resolved.

## User Story
As an ADW operator
I want to see detailed logs from the issue classifier showing which classifier was chosen and why
So that I can debug classification decisions and understand how issues are being routed to workflows

## Problem Statement
When the issue classifier produces an unexpected classification, there is insufficient logging to understand why. The current logs only indicate the final result and whether regex or heuristic was used, but not the intermediate reasoning — e.g., what text was scanned, what the AI raw output was before parsing, or why a default was applied.

## Solution Statement
Add structured, detailed `log()` calls at each decision point in the classification pipeline:
1. Log the input text being scanned (truncated for readability)
2. Log which classifier path is being attempted and why
3. Log the regex scan result (matched command or no match, and the patterns checked)
4. Log the raw AI output when heuristic classification is used
5. Log the parsed result from the AI output and how it was matched
6. Log when and why defaults are applied
7. Log a final summary showing the complete classification decision chain

## Relevant Files
Use these files to implement the feature:

- `adws/core/issueClassifier.ts` — The main file to modify. Contains all classification functions: `extractAdwCommandFromText`, `extractAdwIdFromText`, `classifyWithAdwCommand`, `classifyWithIssueCommand`, `classifyIssueForTrigger`, `classifyGitHubIssue`, and `getWorkflowScript`.
- `adws/core/utils.ts` — Contains the `log()` function definition and `LogLevel` type. Needed for reference on the logging API.
- `adws/__tests__/issueClassifier.test.ts` — Existing test file for the classifier. Must be updated to verify new log messages.
- `adws/core/dataTypes.ts` — Contains type definitions (`AdwSlashCommand`, `IssueClassSlashCommand`, `adwCommandToIssueTypeMap`, etc.) used by the classifier.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

## Implementation Plan
### Phase 1: Foundation
- Review the existing log calls in `issueClassifier.ts` to understand what is already logged and identify gaps.
- Identify each decision point in the classifier pipeline where additional logging adds value.
- Define a consistent log message format that makes logs easy to grep and follow.

### Phase 2: Core Implementation
- Add logging to `extractAdwCommandFromText`: log the number of valid commands checked and whether a match was found.
- Add logging to `classifyWithAdwCommand`: log the text being scanned (truncated), the extracted adwId if found, and the mapped issue type.
- Add logging to `classifyWithIssueCommand`: log the raw AI output before parsing, the regex match attempt, and the parsed command.
- Add logging to `classifyIssueForTrigger` and `classifyGitHubIssue`: log a classification summary at the end showing the full decision chain (classifier used, result, and routing).
- Add logging to `getWorkflowScript`: log the routing decision (which map was used and the resulting script).

### Phase 3: Integration
- Update existing tests to accommodate new log calls (tests mock `log` and assert on specific messages).
- Add new test cases verifying that the enhanced log messages contain the expected detail at each decision point.
- Run the full test suite to confirm zero regressions.

## Step by Step Tasks

### Step 1: Add enhanced logging to `extractAdwCommandFromText`
- After the function determines its result, add a `log()` call that reports:
  - Whether a command was found or not
  - If found, which command matched
  - The number of valid commands that were checked
- Keep this at `info` level since it is called as a subroutine

### Step 2: Add enhanced logging to `classifyWithAdwCommand`
- Log the text being scanned (first 100 chars, truncated with `...`) at `info` level
- Log the extracted `adwId` if one was found
- Log the mapped `issueType` for the matched command
- Enhance the existing success log to include the mapped issue type

### Step 3: Add enhanced logging to `classifyWithIssueCommand`
- Log that heuristic classification is starting (already partially done — enhance with issue title context)
- Log the raw AI output (trimmed, first 200 chars) at `info` level before parsing
- Log the regex pattern being used to extract the command
- Log whether the regex matched and what command was extracted
- When defaulting to `/feature`, log the full raw output that could not be parsed (at `warn` level)

### Step 4: Add enhanced logging to `classifyIssueForTrigger`
- Log the issue title and body length after fetching the issue
- After classification completes (either path), log a classification summary: `Classification complete for issue #N: classifier=regex|heuristic, issueType=X, adwCommand=Y, success=Z`

### Step 5: Add enhanced logging to `classifyGitHubIssue`
- Log the issue labels being included in context
- After classification completes (either path), log the same classification summary as Step 4

### Step 6: Add enhanced logging to `getWorkflowScript`
- Log the routing decision: which map was consulted (adwCommand map vs issueType map) and the resulting script path
- Log at `info` level

### Step 7: Update existing tests for new log calls
- Update test assertions in `adws/__tests__/issueClassifier.test.ts` to accommodate new `log()` calls
- Since `log` is mocked with `vi.fn()`, existing `toHaveBeenCalledWith` assertions remain valid; verify none break
- Add new assertions verifying key log messages exist:
  - Test that regex-path classification logs contain "regex" and the matched command
  - Test that heuristic-path classification logs contain "heuristic" and the raw output reference
  - Test that classification summary logs contain classifier type, issue type, and success status
  - Test that `getWorkflowScript` logs the routing decision

### Step 8: Run validation commands
- Run `npm run lint`, `npx tsc --noEmit`, `npx tsc --noEmit -p adws/tsconfig.json`, `npm test`, and `npm run build` to validate zero regressions.

## Testing Strategy
### Unit Tests
- Verify that each classifier function emits the expected log messages by asserting on the mocked `log` function
- Test that `classifyWithAdwCommand` logs the truncated input text
- Test that `classifyWithIssueCommand` logs the raw AI output when heuristic classification is used
- Test that both `classifyIssueForTrigger` and `classifyGitHubIssue` log a classification summary
- Test that `getWorkflowScript` logs the routing decision
- Test that default/fallback scenarios log appropriate warnings

### Edge Cases
- Empty issue body — verify logging still works and reports "no text to scan" or similar
- Very long issue body — verify text is truncated in logs to maintain readability
- AI output with multiple commands — verify the raw output and parsed result are both logged
- AI classification failure — verify the failure reason and default are logged at `warn`/`error` level
- Exception during classification — verify the error is logged with context

## Acceptance Criteria
- Every classification decision point in `issueClassifier.ts` has a `log()` call explaining what happened and why
- Logs clearly indicate which classifier was used: "regex" (deterministic) or "heuristic" (AI-based `/classify_issue`)
- A classification summary log is emitted at the end of both `classifyIssueForTrigger` and `classifyGitHubIssue`
- `getWorkflowScript` logs which routing map was used and the selected script
- All existing tests continue to pass
- New test assertions verify the enhanced log messages
- No new dependencies or libraries are required
- Coding guidelines in `guidelines/coding_guidelines.md` are followed

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the Next.js application
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the ADW scripts
- `npm test` — Run all unit tests to validate zero regressions
- `npm run build` — Build the application to verify no build errors

## Notes
- Follow coding guidelines in `guidelines/coding_guidelines.md`, particularly: clarity over cleverness, meaningful messages, and isolating side effects at boundaries.
- Keep log messages concise but informative — truncate long text (issue bodies, AI output) to avoid flooding the console.
- Use appropriate log levels: `info` for normal flow, `warn` for unexpected-but-handled scenarios (e.g., unparseable AI output), `error` for failures, `success` for positive outcomes.
- No new libraries needed — this feature only uses the existing `log()` utility from `adws/core/utils.ts`.
