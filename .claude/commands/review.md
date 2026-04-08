---
target: false
---
# Review

Review implementation against a specification file and produce proof that the work matches requirements.

## Variables

adwId: $0
specFile: $1
agentName: $2 if provided, otherwise use 'reviewAgent'
scenarioProofPath: $3 if provided, otherwise empty

## Step 1: Gather Context

- Retrieve the default branch: `git remote show origin` (parse for `main`, `develop`, etc.)
- Check current branch: `git branch`
- View all changes: `git diff origin/<default>`
- Read the spec file at `specFile` to understand requirements

## Step 2: Produce Proof

Determine which proof strategy to use, in priority order:

### Strategy A: Scenario Proof (if `scenarioProofPath` is provided)

1. Read the scenario proof file at `scenarioProofPath`
2. Check `## @regression Scenarios` --- if FAILED, create a `blocker` reviewIssue summarising the failures
3. Check `## @adw-{issueNumber} Scenarios` --- if FAILED, create a `tech-debt` reviewIssue
4. Run supplementary checks: `bunx tsc --noEmit` and `bun run lint` --- report errors as additional reviewIssues
5. Set `screenshots` to include `scenarioProofPath` as a proof artifact
6. Write `reviewSummary` describing scenario pass/fail counts

### Strategy B: Custom Proof (if `.adw/review_proof.md` exists and is non-empty)

Follow the instructions in `.adw/review_proof.md` for what proof to produce, what format to use, and how to attach it. Override the default approach entirely.

## Step 3: Coding Guidelines Check

- Read `.adw/coding_guidelines.md` (fall back to `guidelines/coding_guidelines.md`)
- If neither exists, skip this step
- Compare changes from `git diff origin/<default>` against the guidelines
- Report violations as `tech-debt` reviewIssues with the specific guideline and file/line location

## Issue Severity Reference

- `skippable` --- non-blocking but still a problem
- `tech-debt` --- non-blocking but creates technical debt to address later
- `blocker` --- blocks release; harms user experience or breaks expected functionality

Focus on critical functionality and user experience. Don't report non-critical issues.

## Report

CRITICAL: Return ONLY a JSON object. No additional text or markdown --- `JSON.parse()` runs directly on your output.

- `success`: `true` if no `blocker` issues (can have skippable/tech-debt), `false` if any blockers exist
- `reviewSummary`: 2-4 sentences describing what was built and whether it matches the spec
- `reviewIssues`: all issues found, any severity
- `screenshots`: full absolute paths to all proof artifacts (e.g. scenarioProofPath), regardless of success status

### Output Structure

```json
{
    "success": true,
    "reviewSummary": "The feature has been implemented as specified. All core functionality works correctly. Minor style improvements could be made but nothing blocks release.",
    "reviewIssues": [
        {
            "reviewIssueNumber": 1,
            "issueDescription": "Description of the issue",
            "issueResolution": "How to resolve it",
            "issueSeverity": "skippable | tech-debt | blocker"
        }
    ],
    "screenshots": [
        "/absolute/path/to/proof_artifact.md"
    ]
}
```
