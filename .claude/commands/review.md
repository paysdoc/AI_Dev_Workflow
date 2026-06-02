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

- Read `.adw/coding_guidelines.md` (fall back to `guidelines/coding_guidelines.md`); if neither exists, skip this step entirely.
- Compute changed files: `git diff origin/<default> --name-only`.
- Inspect ONLY those changed files for violations against the guidelines. Ignore pre-existing violations in untouched files.
- If any violations are found across the changed files, emit a SINGLE `blocker` reviewIssue with `remediationStrategy: "refactor"`. Its `issueDescription` must enumerate each affected file and the specific rule(s) it violates (one line per file is recommended). Its `issueResolution` must read: "Run `/refactor` on the listed files".
- If no violations are found in the changed files, emit nothing for this step — no `tech-debt` placeholder.

## Issue Severity Reference

- `skippable` --- non-blocking but still a problem
- `tech-debt` --- non-blocking but creates technical debt to address later
- `blocker` --- blocks release; harms user experience or breaks expected functionality

The optional `remediationStrategy` field on a `blocker` tells the patch cycle how to fix it: `"refactor"` routes to the `/refactor` skill; `"patch"` (or absent) routes to `/patch`.

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
            "issueSeverity": "skippable | tech-debt | blocker",
            "remediationStrategy": "patch"
        }
    ],
    "screenshots": [
        "/absolute/path/to/proof_artifact.md"
    ]
}
```

The `remediationStrategy` field is optional. When `issueSeverity` is `"blocker"` and the issue is a coding-guideline violation (Step 3), set `remediationStrategy: "refactor"`. For all other blockers, omit the field or set `remediationStrategy: "patch"`.
