# ADW Project Configuration

## Project Overview
AI Dev Workflow (ADW) is a TypeScript/Bun automation system that integrates GitHub issues with Claude Code CLI to classify issues, generate plans, implement solutions, and create pull requests. The `adws/` directory contains the workflow orchestrators, agents, and supporting modules.

## Relevant Files
- `README.md` - Contains the project overview and instructions.
- `guidelines/**` - Contains coding guidelines that must be followed (target repository — may not exist in all repos). If present, read and follow these guidelines.
- `adws/**` - Contains the AI Developer Workflow (ADW) orchestrators, agents, and supporting modules.
- `adws/core/**` - Configuration, state management, cost tracking, token management.
- `adws/agents/**` - Claude Code CLI agent runners (plan, build, test, review, etc.).
- `adws/phases/**` - Workflow phase implementations.
- `adws/github/**` - GitHub API, issue/PR operations, workflow comments.
- `adws/vcs/**` - VCS-agnostic git and worktree operations (branch, commit, worktree management).
- `adws/providers/**` - Pluggable IssueTracker and CodeHost backends.
- `adws/triggers/**` - Cron and webhook automation triggers.
- `adws/types/**` - Shared TypeScript types.
- `.claude/commands/**` - Slash command prompt files.
- `.adw/**` - Project configuration files read by planners.
  - `.adw/scenarios.md` - BDD scenario configuration (scenario directory, run-by-tag command, crucial scenarios command)

## Framework Notes
This is a TypeScript/Bun automation project. The `adws/` directory contains standalone TypeScript orchestrator scripts that run with `bunx tsx`. There is no web UI — ADW is a pure CLI automation system.

## Library Install Command
bun add <package>

## Script Execution
bunx tsx <script_name>

## Unit Tests: disabled
