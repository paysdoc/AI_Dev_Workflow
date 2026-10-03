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

- Retrieve the default branch: the branch on the `HEAD branch:` line of `git remote show origin`
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

## Step 4: Step Definition Independence Check

Step definitions must be independent of the implementation: written against the observable behaviour the scenarios describe, not shaped to make the build agent's code pass. The agent that wrote the implementation may also have written the step definitions, so nothing else checks them.

- Compute changed files: `git diff origin/<default> --name-only`. Select the added or modified (not deleted) files that define BDD steps: any file registering Given/When/Then steps, for example `Given(`/`When(`/`Then(` in cucumber-js or `@given`/`@when`/`@then` in pytest-bdd and behave.
- `## Step Def Directory` in `.adw/scenarios.md` names the usual location, but per-issue and regression suites may keep their own `step_definitions/` directories. Select by what a file registers, not by where it lives.
- If no such file changed (including a project without BDD scenarios), skip this step entirely and emit nothing.
- Read each selected file in full, the `.feature` scenarios whose steps it implements, and the implementation code it exercises. This step only reads code: do not run scenarios or tests.
- Judge every step the file adds or changes, and ignore steps the branch left alone, against four rules:
  1. **Observable behaviour through a public interface.** The step drives and observes the system the way the scenario describes it: a CLI, an exported function or class, an HTTP endpoint, files written, or calls recorded by a mocked external boundary. The harness's GitHub, Claude CLI and git mocks are legitimate, and so is a stand-in installed through an injection point the implementation exposes for that purpose. The step must not use unexported helpers, private state, or internal collaborators the scenario does not name.
  2. **The assertion can fail.** A Then step must fail when the behaviour is broken. Flag an assertion that compares a value with itself or with a stub's canned return value the implementation never acted on, asserts a constant, is missing or empty, swallows the failure in a catch, or passes by returning early or marking the step pending or skipped.
  3. **Expectations come from the scenario.** Expected values come from the scenario text and the issue. They are not computed by calling the code under test, not re-derived by copying the implementation's logic into the step, and not copied from the implementation's current output.
  4. **No accommodation.** The step does not special-case the scenario's inputs, and adds no condition, retry or tolerance whose only purpose is to let the current implementation through. It does not weaken what the step phrase promises.
- Emit one `blocker` reviewIssue per violating file, with `remediationStrategy: "patch"`. Its `issueDescription` names the file, the step or steps, and the rule each one breaks. Its `issueResolution` says how to rewrite the step so it tests the behaviour the scenario describes: change the step definition only, never the `.feature` file, and never by loosening the assertion.
- If no violation is found, emit nothing for this step.

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

The `remediationStrategy` field is optional. When `issueSeverity` is `"blocker"` and the issue is a coding-guideline violation (Step 3), set `remediationStrategy: "refactor"`. When it is a step-definition independence violation (Step 4), set `remediationStrategy: "patch"`. For all other blockers, omit the field or set `remediationStrategy: "patch"`. Any blocker, including one from Step 3 or Step 4, makes `success` `false`.
