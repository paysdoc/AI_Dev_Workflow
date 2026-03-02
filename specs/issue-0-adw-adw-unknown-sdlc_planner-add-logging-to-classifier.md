# Chore: Add logging to classifier

## Metadata
issueNumber: `0`
adwId: `adw-unknown`
issueJson: `{}`

## Chore Description
The issue classifier (`adws/core/issueClassifier.ts`) needs enhanced logging to make it clearer which classifier path was taken (code/regex vs heuristic/AI) and why each classification decision was made. Currently, some high-level log messages exist but the logs don't clearly communicate:
- Which classifier was selected and why
- What text was matched (for code/regex path) and which pattern triggered the match
- What the raw AI output was (for heuristic path) and how the final command was parsed from it
- Whether an adwId was extracted alongside the command
- A clear summary of the final classification result at the end of each top-level function

## Relevant Files

- `adws/core/issueClassifier.ts` — The main file to update. Contains all classification logic: `classifyWithAdwCommand` (regex/code path), `classifyWithIssueCommand` (heuristic/AI path), `classifyIssueForTrigger`, and `classifyGitHubIssue` (top-level entry points).
- `adws/__tests__/issueClassifier.test.ts` — Unit tests that assert on specific `log` call messages. Must be updated to match any new or changed log message strings.

## Step by Step Tasks

### Step 1: Enhance logging in `classifyWithAdwCommand` (regex/code path)

In `adws/core/issueClassifier.ts`, update `classifyWithAdwCommand` to add more detailed logs:

- At the start of the function, log that the code/regex classifier is being used:
  ```
  log(`Issue #${issueNumber}: using code classifier (regex) to extract ADW command...`)
  ```
- After a successful match, in addition to the existing success log, add a log showing the extracted adwId (if any):
  ```
  log(`Issue #${issueNumber}: regex matched command "${adwCommand}", adwId: ${adwId ?? 'none'}`, 'success')
  ```
  Keep the existing log: `Issue #${issueNumber} matched ADW command ${adwCommand} via regex` (tests assert on `'regex'` being in the message).
- When no command is found, log that the regex classifier found nothing and is returning null:
  ```
  log(`Issue #${issueNumber}: code classifier found no ADW command in text`)
  ```

### Step 2: Enhance logging in `classifyWithIssueCommand` (heuristic/AI path)

In `adws/core/issueClassifier.ts`, update `classifyWithIssueCommand` to add more detailed logs:

- At the start of the function, log that the heuristic classifier is being invoked:
  ```
  log(`Issue #${issueNumber}: using heuristic classifier (/classify_issue)...`)
  ```
- After receiving the agent result, log the raw output (trimmed) for visibility:
  ```
  log(`Issue #${issueNumber}: heuristic classifier raw output: "${output}"`)
  ```
- When a command is matched from the output, add a log explaining the match:
  ```
  log(`Issue #${issueNumber}: heuristic classifier matched command "${matchedCommand}" from output`, 'success')
  ```
  Keep the existing success log: `Issue #${issueNumber} classified as ${matchedCommand}`.
- When the output cannot be parsed, add a more descriptive log explaining what was attempted:
  ```
  log(`Issue #${issueNumber}: heuristic classifier output did not match any known command, defaulting to /feature`, 'warn')
  ```
  Keep (or adjust) the existing error log for when `result.success` is false.

### Step 3: Enhance logging in `classifyIssueForTrigger` (top-level)

In `adws/core/issueClassifier.ts`, update `classifyIssueForTrigger` to add a final summary log:

- After the ADW command path returns a result, log the summary:
  ```
  log(`Issue #${issueNumber}: classification complete — classifier: code, result: ${adwResult.issueType}`, 'success')
  ```
- After the heuristic path returns a result, log the summary:
  ```
  log(`Issue #${issueNumber}: classification complete — classifier: heuristic, result: ${result.issueType}`, result.success ? 'success' : 'warn')
  ```
- On error, the existing error log is sufficient.

### Step 4: Enhance logging in `classifyGitHubIssue` (top-level)

In `adws/core/issueClassifier.ts`, update `classifyGitHubIssue` the same way:

- After the ADW command path returns a result, log the summary:
  ```
  log(`Issue #${issue.number}: classification complete — classifier: code, result: ${adwResult.issueType}`, 'success')
  ```
- After the heuristic path returns a result, log the summary:
  ```
  log(`Issue #${issue.number}: classification complete — classifier: heuristic, result: ${result.issueType}`, result.success ? 'success' : 'warn')
  ```

### Step 5: Update tests in `adws/__tests__/issueClassifier.test.ts`

Review all `log` assertions in the test file and update them to match any new or renamed log messages:

- In `classifyWithAdwCommand` tests: the test asserts `expect(log).toHaveBeenCalledWith(expect.stringContaining('regex'), 'success')` — this will still pass as the existing regex-match log is kept. Add assertions for the new start log and the adwId log if desired.
- In `classifyIssueForTrigger` tests: the tests check for `'falling back to /classify_issue'` and `'Attempting heuristic classification'` — these are kept, so tests will still pass. Add assertions for new summary logs if desired.
- In `classifyGitHubIssue` tests: same as above.
- Ensure no test is broken by the additional logs (they use `toHaveBeenCalledWith` which checks for specific calls, not exclusivity, so adding new log calls should not break existing assertions).

### Step 6: Run Validation Commands

Run all validation commands to confirm the chore is complete with zero regressions.

## Validation Commands

```bash
npm run lint
npx tsc --noEmit
npx tsc --noEmit -p adws/tsconfig.json
npm test
```

## Notes
- The existing log messages that tests assert on must be preserved exactly. New log messages are additive.
- Use the existing `log` utility from `'.'` (the `core/index.ts` re-export) — no new imports needed.
- Log levels: use `'info'` (default) for informational flow logs, `'success'` for successful classification outcomes, `'warn'` for fallback/default scenarios, `'error'` for failures.
- Do not log full issue body text (could be very long); log only the extracted command, adwId, and classification result.
