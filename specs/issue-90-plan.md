# PR-Review: Add review_proof.md to adwInit initialization

## PR-Review Description
The PR reviewer identified that the `adwInit` process — which initializes `.adw/` project configuration files for target repositories — does not generate `.adw/review_proof.md`. Since the PR introduced externalized proof requirements via `.adw/review_proof.md`, the init command (`.claude/commands/adw_init.md`) and its orchestrator (`adws/adwInit.tsx`) should also initialize this file alongside the existing `commands.md`, `project.md`, and `conditional_docs.md` files.

## Summary of Original Implementation Plan
The original plan at `specs/issue-90-adw-fix-review-process-8aatht-sdlc_planner-multi-agent-review-with-external-proof.md` introduced two key changes:
1. **Externalized proof requirements**: Created `.adw/review_proof.md` config file and updated `projectConfig.ts` to load it. The `/review` command reads this file at runtime instead of hardcoded screenshot logic.
2. **Multi-agent parallel review**: Refactored `reviewRetry.ts` to launch 3 review agents in parallel per iteration, merge/deduplicate findings, patch blockers, and collate proof across iterations.

The plan did NOT include updating the `adw_init` command to generate `review_proof.md` during initialization — which is the gap this PR review identifies.

## Relevant Files
Use these files to resolve the review:

- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed strictly during implementation.
- `.claude/commands/adw_init.md` — The `/adw_init` slash command that generates `.adw/` config files. Currently creates `commands.md`, `project.md`, and `conditional_docs.md` but NOT `review_proof.md`. This is the primary file to update.
- `.adw/review_proof.md` — The existing review proof config file for the ADW project itself. Serves as a reference for what the init command should generate.
- `adws/adwInit.tsx` — The orchestrator script that runs the `/adw_init` command and commits results. No code changes needed here since it already commits all `.adw/` files, but important for understanding the flow.
- `adws/core/projectConfig.ts` — Already loads `review_proof.md` from `.adw/`. No changes needed, but confirms the config is expected.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `.claude/commands/adw_init.md` to generate `review_proof.md`
- Read `.claude/commands/adw_init.md`
- Add a new step **between step 4 and step 5** (renumbering step 5 → step 6) that creates `.adw/review_proof.md`
- The new step (step 5) should instruct Claude to:
  - Create `.adw/review_proof.md` in the `.adw/` directory
  - Analyze the project type (detected in step 1) to determine appropriate proof requirements:
    - **Web/UI projects** (Next.js, React, Vue, etc.): proof should include browser screenshots, test output, and visual regression checks
    - **CLI/automation tools** (no UI): proof should include code-diff verification, test output summaries, type check and lint verification (no browser screenshots)
    - **API projects** (Express, FastAPI, etc.): proof should include API response validation, test output, and endpoint verification
    - **Library/package projects**: proof should include test output, type check verification, and API compatibility checks
  - Include the following sections in the generated file:
    - `# Review Proof Requirements` — intro explaining the file's purpose
    - `## Proof Type` — what evidence to produce based on the project type
    - `## Proof Format` — how to structure proof in the review JSON output (`reviewSummary`, `reviewIssues`, `screenshots` fields)
    - `## Proof Attachment` — how proof gets attached to the PR
    - `## What NOT to Do` — actions to avoid based on the project type
- Update the existing step 5 (Report) — now step 6 — to include `review_proof.md` in the list of files created

### Step 2: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no TypeScript errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for additional type checks
- Run `bun run test` to validate all tests pass with zero regressions

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the adws module
- `bun run test` - Run all tests to validate zero regressions

## Notes
- This is a documentation-only change — only `.claude/commands/adw_init.md` needs to be modified. No TypeScript code changes are required.
- The `adws/adwInit.tsx` orchestrator already commits all files in `.adw/` after running the `/adw_init` command, so no changes are needed there.
- The `projectConfig.ts` loader already reads `.adw/review_proof.md` (added in the original PR), so no changes are needed there either.
- The generated `review_proof.md` content should be project-type-aware (detected in step 1 of the init command), following the same pattern as the other generated files which adapt to the detected project type.
- Reference the existing `.adw/review_proof.md` in the ADW project root as an example of a CLI/automation project's proof requirements.
