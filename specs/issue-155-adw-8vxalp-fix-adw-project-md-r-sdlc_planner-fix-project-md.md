# Chore: Fix .adw/project.md — remove stale Next.js paths, add accurate ADW module structure

## Metadata
issueNumber: `155`
adwId: `8vxalp-fix-adw-project-md-r`
issueJson: `{"number":155,"title":"Fix .adw/project.md — remove stale Next.js paths, add accurate ADW module structure","body":"## Problem\n\n\\`.adw/project.md\\` currently lists six file paths that do not exist in the ADW project:\n\n\\`\\`\\`\nsrc/app/**\nsrc/components/**\nsrc/lib/**\nsrc/hooks/**\nsrc/styles/**\npublic/**\n\\`\\`\\`\n\nThe project overview also incorrectly states \"It uses Next.js for the web interface\". ADW has no web UI — it is a pure automation system in \\`adws/\\`.\n\nEvery planner reads this file at the start of each workflow run and tries to explore these non-existent paths, wasting tool calls and tokens before planning begins.\n\n## Solution\n\nUpdate \\`.adw/project.md\\` to accurately reflect the actual ADW codebase:\n\n1. Remove all six non-existent \\`src/\\` and \\`public/\\` paths from the Relevant Files section\n2. Fix the Project Overview — remove the incorrect Next.js mention\n3. Replace the stale paths with accurate ADW module pointers:\n   - \\`adws/core/\\` — configuration, state management, cost tracking, token management\n   - \\`adws/agents/\\` — Claude Code CLI agent runners (plan, build, test, review, etc.)\n   - \\`adws/phases/\\` — workflow phase implementations\n   - \\`adws/github/\\` — GitHub API, issue/PR operations, workflow comments\n   - \\`adws/vcs/\\` — VCS-agnostic git and worktree operations\n   - \\`adws/providers/\\` — pluggable IssueTracker and CodeHost backends\n   - \\`adws/triggers/\\` — cron and webhook automation triggers\n   - \\`adws/types/\\` — shared TypeScript types\n   - \\`.claude/commands/\\` — slash command prompt files\n   - \\`.adw/\\` — project configuration files read by planners\n\n4. Keep the existing \\`guidelines/**\\` and \\`README.md\\` entries\n\n## Acceptance Criteria\n\n- \\`.adw/project.md\\` contains no references to \\`src/\\`, \\`public/\\`, or Next.js\n- All listed paths in Relevant Files actually exist in the repository\n- The Project Overview accurately describes ADW as a TypeScript/Bun automation system","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-12T22:36:42Z","comments":[],"actionableComment":null}`

## Chore Description
`.adw/project.md` contains inaccurate information inherited from the `/adw_init` command's initial generation. The file lists six `src/` and `public/` paths that do not exist in the ADW repository, incorrectly describes ADW as a Next.js project, and includes a `Framework Notes` section about Next.js App Router. Every planner slash command (`/feature`, `/bug`, `/chore`, `/patch`, `/pr_review`) reads the `## Relevant Files` section from this file, causing agents to waste tool calls exploring non-existent directories before planning begins.

The fix is straightforward: update `.adw/project.md` to accurately describe the ADW codebase — a pure TypeScript/Bun automation system with no web UI.

## Relevant Files
Use these files to resolve the chore:

- `.adw/project.md` — **The file being fixed.** Contains the stale Next.js references and non-existent paths that need to be corrected.
- `README.md` — **Reference for accurate project structure.** The `## Project Structure` section contains the authoritative directory tree that `.adw/project.md` should reflect.
- `guidelines/coding_guidelines.md` — **Coding guidelines** that must be followed during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix the Project Overview section
- Open `.adw/project.md`
- Replace the current `## Project Overview` content:
  ```
  AI Dev Workflow (ADW) is a TypeScript/Node.js project that automates software development by integrating GitHub issues with Claude Code CLI. It uses Next.js for the web interface, and the `adws/` directory contains the workflow automation scripts.
  ```
  With:
  ```
  AI Dev Workflow (ADW) is a TypeScript/Bun automation system that integrates GitHub issues with Claude Code CLI to classify issues, generate plans, implement solutions, and create pull requests. The `adws/` directory contains the workflow orchestrators, agents, and supporting modules.
  ```

### Step 2: Replace the Relevant Files section
- Remove all six non-existent paths:
  - `src/app/**`
  - `src/components/**`
  - `src/lib/**`
  - `src/hooks/**`
  - `src/styles/**`
  - `public/**`
- Keep the existing entries:
  - `README.md`
  - `guidelines/**`
  - `adws/**`
- Add the following accurate ADW module pointers between `guidelines/**` and `adws/**`:
  - `adws/core/**` — Configuration, state management, cost tracking, token management.
  - `adws/agents/**` — Claude Code CLI agent runners (plan, build, test, review, etc.).
  - `adws/phases/**` — Workflow phase implementations.
  - `adws/github/**` — GitHub API, issue/PR operations, workflow comments.
  - `adws/vcs/**` — VCS-agnostic git and worktree operations.
  - `adws/providers/**` — Pluggable IssueTracker and CodeHost backends.
  - `adws/triggers/**` — Cron and webhook automation triggers.
  - `adws/types/**` — Shared TypeScript types.
  - `.claude/commands/**` — Slash command prompt files.
  - `.adw/**` — Project configuration files read by planners.
- The final `## Relevant Files` section should be:
  ```
  ## Relevant Files
  - `README.md` - Contains the project overview and instructions.
  - `guidelines/**` - Contains coding guidelines that must be followed (target repository — may not exist in all repos). If present, read and follow these guidelines.
  - `adws/**` - Contains the AI Developer Workflow (ADW) orchestrators, agents, and supporting modules.
  - `adws/core/**` - Configuration, state management, cost tracking, token management.
  - `adws/agents/**` - Claude Code CLI agent runners (plan, build, test, review, etc.).
  - `adws/phases/**` - Workflow phase implementations.
  - `adws/github/**` - GitHub API, issue/PR operations, workflow comments.
  - `adws/vcs/**` - VCS-agnostic git and worktree operations.
  - `adws/providers/**` - Pluggable IssueTracker and CodeHost backends.
  - `adws/triggers/**` - Cron and webhook automation triggers.
  - `adws/types/**` - Shared TypeScript types.
  - `.claude/commands/**` - Slash command prompt files.
  - `.adw/**` - Project configuration files read by planners.
  ```

### Step 3: Fix the Framework Notes section
- Replace the current `## Framework Notes` content:
  ```
  This is a Next.js App Router project using React and TypeScript. Use server components by default. The `adws/` directory contains standalone TypeScript scripts that run with `bunx tsx` and are separate from the Next.js application.
  ```
  With:
  ```
  This is a TypeScript/Bun automation project. The `adws/` directory contains standalone TypeScript orchestrator scripts that run with `bunx tsx`. There is no web UI — ADW is a pure CLI automation system.
  ```

### Step 4: Verify no stale references remain
- Search the updated `.adw/project.md` to confirm:
  - No references to `src/`
  - No references to `public/`
  - No references to `Next.js` or `next`
  - No references to `Node.js` (replaced with `Bun`)
  - All listed paths actually exist in the repository

### Step 5: Run validation commands
- Execute every validation command to confirm the chore is complete with zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type check the adws directory
- `bun run test` - Run tests to validate no regressions
- `grep -c 'src/' .adw/project.md` - Verify count is 0 (no stale src/ references)
- `grep -c 'public/' .adw/project.md` - Verify count is 0 (no stale public/ references)
- `grep -ci 'next.js' .adw/project.md` - Verify count is 0 (no Next.js references)

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
- This is a documentation-only change to `.adw/project.md`. No TypeScript code is modified, so lint/typecheck/test regressions are not expected, but should still be verified.
- The `## Library Install Command` and `## Script Execution` sections at the bottom of `.adw/project.md` are correct (`bun install` and `bunx tsx <script_name>`) and should be left unchanged.
- `.adw/commands.md` also contains a `bunx next dev --port {PORT}` reference in the `## Prepare App` section, but that is out of scope for this issue which focuses solely on `project.md`.
