# Review Proof Requirements

This file defines the proof requirements for the ADW (AI Dev Workflow) project.
The `/review` command reads this file to determine what evidence to produce and how to attach it to a pull request.

## Proof Type

ADW is a CLI/automation tool with no UI. Proof consists of:

1. **Code-diff verification** - Confirm the git diff matches the spec requirements. Summarize which spec items are addressed and which files were changed.
2. **Test output summaries** - Run the project's test suite (`bun run test`) and summarize pass/fail results. Include the number of test suites and individual tests that passed.
3. **Type check verification** - Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`. Report whether type checking passed cleanly.
4. **Lint verification** - Run `bun run lint` and report whether linting passed cleanly.
5. **Spec compliance checklist** - For each acceptance criterion in the spec, state whether it is met or not with a brief justification.

## Proof Format

Structure proof as text summaries within the review JSON output:
- Use the `reviewSummary` field for a concise 2-4 sentence overview
- Use the `reviewIssues` array to document any discrepancies between spec and implementation
- Use the `screenshots` array for paths to any generated proof artifacts (e.g., test output logs saved to the reviewImage_dir)

## Proof Attachment

Proof is attached to the PR via the review JSON output fields:
- `reviewSummary` - Human-readable summary for the PR comment
- `screenshots` - Array of absolute paths to proof artifacts in the `reviewImage_dir`
- `reviewIssues` - Structured list of any issues found during review

## What NOT to Do

- Do NOT take browser screenshots (there is no UI to screenshot)
- Do NOT attempt to start a dev server or navigate to a URL
- Do NOT skip the spec compliance checklist
