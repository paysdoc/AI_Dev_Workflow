# Review Proof Configuration

## Tags

| Tag | Severity | Optional |
|-----|----------|----------|
| @review-proof | blocker | no |
| @adw-{issueNumber} | blocker | yes |

## Supplementary Checks

| Name | Command | Severity |
|------|---------|----------|
| Type Check | bunx tsc --noEmit | blocker |
| Type Check (adws) | bunx tsc --noEmit -p adws/tsconfig.json | blocker |
| Lint | bun run lint | blocker |

## Proof Format

Structure proof as text summaries within the review JSON output:
- Use the `reviewSummary` field for a concise 2-4 sentence overview
- Use the `reviewIssues` array to document any discrepancies
- Use the `screenshots` array for paths to proof artifacts

## What NOT to Do

- Do NOT take browser screenshots (there is no UI to screenshot)
- Do NOT attempt to start a dev server or navigate to a URL
- Do NOT use code-diff as primary proof
- Do NOT run `bun run test` (unit tests are disabled)
