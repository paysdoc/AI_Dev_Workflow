# Review Proof Requirements

This file defines the proof requirements for the ADW (AI Dev Workflow) project.
The `/review` command reads this file to determine what evidence to produce and how to attach it to a pull request.

> **Note:** When a `scenarioProofPath` argument is passed to `/review`, the scenario execution results take precedence over this file. This file applies when no scenario proof path is provided.

## Proof Type

ADW is a CLI/automation tool with no UI. Primary proof is `@regression` BDD scenario execution results. Supplementary proof consists of:

1. **@regression scenario execution** - The primary proof. Results are provided via a scenario proof file (path passed as the `scenarioProofPath` argument to `/review`). Read and classify results: `@regression` failures = `blocker`, `@adw-{issueNumber}` non-regression failures = `tech-debt`.
2. **Type check verification** - Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`. Report whether type checking passed cleanly.
3. **Lint verification** - Run `bun run lint` and report whether linting passed cleanly.
4. **Spec compliance checklist** - For each acceptance criterion in the spec, state whether it is met or not with a brief justification.

## Proof Format

Structure proof as text summaries within the review JSON output:
- Use the `reviewSummary` field for a concise 2-4 sentence overview describing scenario pass/fail results
- Use the `reviewIssues` array to document any discrepancies (classified per the rules above)
- Use the `screenshots` array for paths to proof artifacts (scenario proof file path, test output logs, etc.)

## Proof Attachment

Proof is attached to the PR via the review JSON output fields:
- `reviewSummary` - Human-readable summary for the PR comment
- `screenshots` - Array of absolute paths to proof artifacts (scenario proof file, logs, etc.)
- `reviewIssues` - Structured list of any issues found during review

## Classification Rules

- `@regression` scenario failures → `issueSeverity: 'blocker'`
- `@adw-{issueNumber}` non-regression failures → `issueSeverity: 'tech-debt'`
- Type-check or lint failures → `issueSeverity: 'blocker'` (prevents release)

## What NOT to Do

- Do NOT take browser screenshots (there is no UI to screenshot)
- Do NOT attempt to start a dev server or navigate to a URL
- Do NOT use code-diff as primary proof — scenario execution results are authoritative
- Do NOT run `bun run test` (unit tests are disabled for this project per `.adw/project.md`)
