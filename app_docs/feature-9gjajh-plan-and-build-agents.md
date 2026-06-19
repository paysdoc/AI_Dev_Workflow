# Plan & Build Agents

## Overview

These four agents form the core execution pipeline of ADW's SDLC workflow. Together they prime agent context (Install), generate implementation plans (Plan), align plans with BDD scenarios (Alignment), and implement solutions from those plans (Build).

## Responsibilities

- **Install Agent** (`installAgent.ts`): Runs the `/install` slash command to prime agent context with project files. Receives issue number and ADW ID as positional args; CWD is set to the target worktree so the agent reads from the correct repo.
- **Plan Agent** (`planAgent.ts`): Generates an implementation plan from a GitHub issue by dispatching to the appropriate slash command (`/feature`, `/bug`, `/chore`, or `/pr_review`) based on issue type. Accepts an optional `adwId` used for naming the output plan file.
- **Alignment Agent** (`alignmentAgent.ts`): Runs `/align_plan_scenarios` in a single pass to reconcile the implementation plan with BDD scenario files. Uses the GitHub issue as the sole source of truth for resolving conflicts. Returns a structured `AlignmentResult` JSON with `aligned`, `warnings`, `changes`, and `summary` fields.
- **Build Agent** (`buildAgent.ts`): Implements the solution from the plan. Detects BDD `.feature` files tagged `@adw-{issueNumber}` in the worktree and auto-routes to `/implement-tdd` (red-green-refactor) when found, falling back to `/implement` when no scenarios exist. Also handles PR review revisions via a separate `runPrReviewBuildAgent` entry point.
- **Plan Agent utilities**: Locates plan files using the canonical naming convention `issue-{number}-adw-{adwId}-sdlc_planner-{name}.md` under `specs/`, with a legacy fallback to `specs/issue-{number}-plan.md`. Detects and automatically renames files where `issueNumber` and `adwId` were swapped in the filename.
- **Plan Agent comment filtering**: Strips ADW bot comments from issue context before passing comments to plan commands; surfaces the most recent actionable comment content as a prominent `### Actionable Comment` section.

## Contracts & Invariants

- Plan files live under `specs/` and follow the naming pattern `issue-{issueNumber}-adw-{adwId}-sdlc_planner-{descriptiveName}.md`. Legacy `issue-{number}-plan.md` names are supported for backward compatibility.
- `planFileExists` returns `true` only when the file is both present on disk and non-empty.
- `correctPlanFileNaming` is a write operation — it renames files in place and logs a `warn` when a swap is corrected. It is a no-op if the file is already correctly named or no file exists.
- `AlignmentResult` is always returned — on parse failure the agent treats the run as fully aligned (`aligned: true`) and appends a warning rather than blocking the workflow.
- The Alignment Agent's `extractAlignmentResult` function requires the `aligned` boolean field to be present; all other fields degrade gracefully to empty arrays/strings.
- Build Agent TDD mode is triggered automatically by the presence of scenario files; no caller configuration is needed.
- All four agents write their JSONL output log to `logsDir` and accept an optional `statePath` for state tracking and an optional `cwd` to pin execution to a specific worktree.

## Configuration

All four agents delegate configuration (model selection, effort level) to `getModelForCommand` / `getEffortForCommand` from `../core`, keyed by the slash command string and optionally the issue body. No standalone configuration files or environment variables are read by these agents directly.

## Gotchas

- The Plan Agent has a known failure mode where it swaps `issueNumber` and `adwId` in the output filename. `correctPlanFileNaming` must be called after plan generation to detect and fix this before downstream agents try to locate the file.
- `findScenarioFiles` searches the worktree path (defaulting to `process.cwd()`), so passing the wrong `cwd` to `runBuildAgent` will silently suppress TDD mode even when scenario files exist.
- `formatIssueContextAsArgs` and `runPlanAgent` both independently filter ADW bot comments and extract actionable content — they are not shared; changes to filtering logic must be applied in both places.
- The Alignment Agent passes the `worktreePath` as the `scenarioGlob` positional argument (fourth arg), not a file glob string — the `/align_plan_scenarios` command is responsible for interpreting it.
- On alignment parse failure the workflow is never blocked, but the `warnings` array in the returned `AlignmentResult` will contain a raw preview of the unparseable output, which may contain sensitive plan content.
