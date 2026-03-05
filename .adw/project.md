# ADW Project Configuration

## Project Overview
AI Dev Workflow (ADW) is a TypeScript/Node.js CLI automation tool that integrates GitHub issues with the Claude Code CLI. It classifies issues, generates implementation plans (specs), runs build/test/review agents, and creates pull requests — forming a full automated SDLC pipeline. There is no web server or frontend; all orchestration runs via `npx tsx` scripts.

## Relevant Files
- `README.md` — Project overview, setup instructions, and structure guide
- `adws/README.md` — Detailed ADW workflow documentation
- `guidelines/**` — Coding guidelines that must be followed (read before implementing)
- `adws/core/config.ts` — Central configuration: model routing (`SLASH_COMMAND_MODEL_MAP`), env vars, constants
- `adws/agents/claudeAgent.ts` — Claude CLI agent runner (`runClaudeAgent`, `runClaudeAgentWithCommand`)
- `adws/agents/` — All agent runners (build, plan, test, review, document, patch, PR, git)
- `adws/core/` — Shared utilities: config, cost tracking, issue classification, orchestration helpers
- `adws/phases/` — Workflow phase implementations (plan, build, test, review, document, PR)
- `adws/github/` — GitHub API and git operations (worktree, PR, issue, comments)
- `adws/types/` — TypeScript type definitions
- `adws/triggers/` — Automation triggers (cron, webhook)
- `.claude/commands/` — Claude Code slash command definitions (markdown files)
- `.adw/` — ADW project configuration for this repository
- `specs/` — Generated implementation spec files (per issue)
- `app_docs/` — Generated feature documentation
- `projects/` — Cost tracking CSV files per project
- `logs/` — Runtime workflow logs
- `package.json` — npm scripts: build (tsc), lint (eslint), test (vitest run)
- `tsconfig.json` — Root TypeScript configuration
- `adws/tsconfig.json` — ADW-specific TypeScript configuration
- `vitest.config.ts` — Vitest test runner configuration
- `eslint.config.js` — ESLint configuration

## Framework Notes
This is a pure TypeScript/Node.js project with no web framework. Key patterns:
- All orchestration scripts run with `npx tsx <script>` (e.g., `npx tsx adws/adwPlanBuild.tsx 123`)
- Model routing is centralized in `adws/core/config.ts` via `SLASH_COMMAND_MODEL_MAP`
- Slash command definitions live in `.claude/commands/*.md`
- The `adws/` directory has its own `tsconfig.json` separate from the root
- Tests use vitest — run with `npm test`
- Two type check targets: root (`npx tsc --noEmit`) and adws (`npx tsc --noEmit -p adws/tsconfig.json`)

## Library Install Command
npm install <package-name>

## Script Execution
npx tsx <script-path>
