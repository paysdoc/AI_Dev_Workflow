# Review

Follow the `Instructions` below to **review work done against a specification file** (spec/*.md) to ensure implemented features match requirements. Use the spec file to understand the requirements and then use the git diff if available to understand the changes made. Produce proof of the review as documented in the `Proof Requirements` and `Instructions` sections. If there are issues, report them if not then report success.

## Variables

adwId: $1
specFile: $2
agentName: $3 if provided, otherwise use 'reviewAgent'
applicationUrl: $4 if provided, otherwise use http://localhost:3000
scenarioProofPath: $5 if provided, otherwise empty
reviewImage_dir: `<absolute path to codebase>/agents/<adwId>/<agentName>/reviewImg/`

## Proof Requirements

**If `scenarioProofPath` is provided and the file exists**: Read the scenario proof file at `scenarioProofPath`. Use the BDD scenario execution results as the **primary proof** for this review. Classify `@crucial` failures as `blocker` issues. Classify non-crucial `@adw-{issueNumber}` failures as `tech-debt` issues. The `reviewSummary` should describe scenario pass/fail results. Still run type-check and lint as supplementary checks.

**If `scenarioProofPath` is NOT provided**: Read the file `.adw/review_proof.md` from the current working directory.

- **If the file exists and is non-empty**: Follow its instructions for what proof to produce and how to attach it. The file specifies the proof type (screenshots, test output, code-diff verification, etc.), the format, and how it gets attached to the PR. Override the default screenshot-based proof instructions below with whatever `.adw/review_proof.md` specifies.
- **If the file does not exist or is empty**: Fall back to the default proof behavior described in the Instructions section below (screenshot-based UI validation).

## Instructions

- Retrieve the `default` branch from the remote repository using `git remote show origin` and parse the output to get the default branch name (e.g., `main` or `develop`)
- Check current git branch using `git branch` to understand context
- Run `git diff origin/<default>` to see all changes made in current branch. Continue even if there are no changes related to the spec file.
- Find the spec file by looking for spec/*.md files in the diff that match the current branch name
- Read the identified spec file to understand requirements
- IMPORTANT: Produce proof according to the `Proof Requirements` section above:
  - **If `scenarioProofPath` is provided**:
    - Read the scenario proof markdown file at `scenarioProofPath`
    - Check the `## @crucial Scenarios` section status:
      - If **FAILED**: create a `reviewIssue` with `issueSeverity: 'blocker'`, `issueDescription` summarising the @crucial failures, `issueResolution` advising investigation of the scenario proof file, and `screenshotPath` set to `scenarioProofPath`
    - Check the `## @adw-{issueNumber} Scenarios` section status (where `{issueNumber}` is derived from the spec file name or branch name):
      - If **FAILED**: create a `reviewIssue` with `issueSeverity: 'tech-debt'` describing the non-crucial failures
    - Run type-check and lint as supplementary checks:
      - Run `bunx tsc --noEmit` and report any type errors as additional `reviewIssues`
      - Run `bun run lint` and report any lint errors as additional `reviewIssues`
    - Set `screenshots` to include `scenarioProofPath` as a proof artifact (plus any supplementary artifacts)
    - `reviewSummary` should describe: how many @crucial scenarios passed/failed and how many @adw-{issueNumber} scenarios passed/failed
  - **If `scenarioProofPath` is NOT provided**: follow `.adw/review_proof.md` instructions (if present) or use the default UI validation approach below:
  - If the work can be validated by UI validation then (if not skip the section):
    - Look for corresponding e2e test files in ./claude/commands/e2e-examples/test*.md that mirror the feature name
    - Use e2e test files only as navigation guides for screenshot locations, not for other purposes
    - IMPORTANT: To be clear, we're not testing. We know the functionality works. We're reviewing the implementation against the spec to make sure it matches what was requested.
    - IMPORTANT: Take screen shots along the way to showcase the new functionality and any issues you find
      - Capture visual proof of working features through targeted screenshots
      - Navigate to the application and capture screenshots of only the critical paths based on the spec
      - Compare implemented changes with spec requirements to verify correctness
      - Do not take screenshots of the entire process, only the critical points.
      - IMPORTANT: Aim for `1-5` screenshots to showcase that the new functionality works as specified.
      - If there is a review issue, take a screenshot of the issue and add it to the `reviewIssues` array. Describe the issue, resolution, and severity.
      - Number your screenshots in the order they are taken like `01_<descriptive name>.png`, `02_<descriptive name>.png`, etc.
      - IMPORTANT: Be absolutely sure to take a screen shot of the critical point of the new functionality
      - IMPORTANT: Copy all screenshots to the provided `reviewImage_dir`
      - IMPORTANT: Store the screenshots in the `reviewImage_dir` and be sure to use full absolute paths.
      - Focus only on critical functionality paths - avoid unnecessary screenshots
      - Ensure screenshots clearly demonstrate that features work as specified
      - Use descriptive filenames that indicate what part of the change is being verified
- IMPORTANT: Issue Severity Guidelines
  - Consider the impact of the issue on the feature and the user
  - Guidelines:
    - `skippable` - the issue is nonBlocker for the work to be released but is still a problem
    - `tech-debt` - the issue is nonBlocker for the work to be released but will create technical debt that should be addressed in the future
    - `blocker` - the issue is a blocker for the work to be released and should be addressed immediately. It will harm the user experience or will not function as expected.
- IMPORTANT: Return ONLY the JSON array with test results
  - IMPORTANT: Output your result in JSON format based on the `Report` section below.
  - IMPORTANT: Do not include any additional text, explanations, or markdown formatting
  - We'll immediately run JSON.parse() on the output, so make sure it's valid JSON
- Ultra think as you work through the review process. Focus on the critical functionality paths and the user experience. Don't report issues if they are not critical to the feature.

## Setup

Extract the port number from the `applicationUrl` (e.g. if applicationUrl is `http://localhost:12345`, the port is `12345`).
IMPORTANT: Read and **Execute** `.claude/commands/prepare_app.md` with the extracted port number to prepare the application for the review.
Use the `applicationUrl` when navigating to the application for screenshots.

## Report

- IMPORTANT: Return results exclusively as a JSON array based on the `Output Structure` section below.
- `success` should be `true` if there are NO BLOCKING issues (implementation matches spec for critical functionality)
- `success` should be `false` ONLY if there are BLOCKING issues that prevent the work from being released
- `reviewIssues` can contain issues of any severity (skippable, tech-debt, or blocker)
- `screenshots` should ALWAYS contain paths to proof artifacts showcasing the review evidence, regardless of success status. Use full absolute paths. These can be screenshots, test output logs, scenario proof files, or any other proof artifacts as specified by `.adw/review_proof.md` or the scenario proof path.
- This allows subsequent agents to quickly identify and resolve blocking errors while documenting all issues

### Output Structure

```json
{
    success: "boolean - true if there are NO BLOCKING issues (can have skippable/tech-debt issues), false if there are BLOCKING issues",
    reviewSummary: "string - 2-4 sentences describing what was built and whether it matches the spec. Written as if reporting during a standup meeting. Example: 'The natural language query feature has been implemented with drag-and-drop file upload and interactive table display. The implementation matches the spec requirements for SQL injection protection and supports both CSV and JSON formats. Minor UI improvements could be made but all core functionality is working as specified.'",
    reviewIssues: [
        {
            "reviewIssueNumber": "number - the issue number based on the index of this issue",
            "screenshotPath": "string - /absolute/path/to/screenshotThat_showsReview_issue.png",
            "issueDescription": "string - description of the issue",
            "issueResolution": "string - description of the resolution",
            "issueSeverity": "string - severity of the issue between 'skippable', 'tech-debt', 'blocker'"
        },
        ...
    ],
    screenshots: [
        "string - /absolute/path/to/proof_artifact.png",
        "string - /absolute/path/to/proof_artifact.png",
        "...",
    ]
}
