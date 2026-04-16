# Review Proof Requirements

This file defines the proof requirements for the `/review` command. The `/review` slash command reads this file to determine what evidence to collect and how to structure the review output.

## Proof Type

This is a **CLI/automation tool** project (TypeScript/Bun, no web UI). Evidence required:

1. Type check output — run `bunx tsc --noEmit` and confirm zero errors
2. Auxiliary type check output — run `bunx tsc --noEmit -p adws/tsconfig.json` and confirm zero errors
3. Lint output — run `bun run lint` and confirm zero errors or warnings
4. BDD scenario output — run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-proof"` and confirm all scenarios pass
5. Issue-specific scenario output — run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-{issueNumber}"` (optional; skip if no such tagged scenarios exist)
6. Code-diff review — confirm changed files are consistent with the issue scope and plan

## Proof Format

Structure proof as text summaries in the review JSON output:
- `reviewSummary` — concise 2–4 sentence overview of what was verified and the outcome
- `reviewIssues` — array of discrepancies found (blockers or tech-debt); empty array if none
- `screenshots` — array of proof artifact paths (for CLI projects this is typically empty)

## Proof Attachment

Proof is attached to the PR via review JSON fields:
- `reviewSummary` contains the narrative verification overview
- `screenshots` contains paths to any captured artifacts (e.g. command output files)
- `reviewIssues` lists any blockers or non-blockers found during review

## What NOT to Do

- Do NOT take browser screenshots — there is no UI to screenshot
- Do NOT attempt to start a dev server or navigate to a URL
- Do NOT rely on code-diff alone as primary proof — run the type checks, lint, and scenarios
- Do NOT skip the `@review-proof` scenario tag check — it is a blocker
- Do NOT run `bun run test` (it only runs `tsc --noEmit`, already covered by the type check step)
