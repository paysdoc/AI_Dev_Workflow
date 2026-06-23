# Git/GH CLI Guard

## Overview

This module enforces the GitContext PRD invariant that all `git` and `gh` shell-outs must route through the `adws/gitContext/` package. It is an AST-based standalone scanner (`adws/checkGitGhGuard.ts`) wired into a dedicated CI workflow that fails the build on any direct `exec`/`spawn`/`execSync` of a `git …` or `gh …` command string outside the allowed package and allowlist. The guard makes the wrong path mechanically unrepresentable and prevents the wrong-repo / token-bleed class of bug from re-entering via new call sites.

## Responsibilities

- Walk all `.ts`/`.tsx` source files under the repo (excluding `node_modules`, `dist`, `.worktrees`, `.claude`, `features`, `test`, `adws/gitContext/**`, and `*.test.ts` / `__tests__/**`)
- Parse each non-allowlisted file with the TypeScript compiler API (AST-based scan — comment text is never a false positive)
- Detect call expressions whose first argument is a string/template literal matching `/^(git|gh)(\s|$)/` — catches `execSync('git …')`, `execWithRetry(\`gh …\`)`, `execFileSync('git', […])`, injected `deps.exec(\`gh …\`)`, and any other call shape
- Maintain a documented `ALLOWLIST` of repo-relative paths that may shell out directly, split into three categories: **bootstrap** (permanent — can't use GitContext before it exists), **diagnostic** (permanent — non-hot-path tooling), and **residual** (temporary — follow-up migration)
- Exit `0` (pass) when no non-allowlisted violations are found; exit `1` (fail) with a `path:line  command` listing and a one-line remedy when any are found
- Run as `bun run lint:git-guard` and as the sole step in `.github/workflows/git-cli-guard.yml` (triggers on every `pull_request` and `push`)

## Contracts & Invariants

- **Structural exemption:** the entire `adws/gitContext/` directory is never scanned — it is the one place permitted to shell out to `git`/`gh`
- **Detection by command string, not callee:** the scanner matches the literal string argument, not the function name. This catches `execSync`, `execWithRetry`, `spawn`, `execFileSync`, and injected callback forms uniformly
- **AST-only, no regex on source text:** `ts.createSourceFile` + node walking means `git …` mentions in JSDoc, comments, or string variables not passed as a first argument are never flagged
- **Allowlist is the source of truth:** any file added to `ALLOWLIST` with a category comment is silently skipped; any unallowlisted file with a violation causes exit `1`
- **`scanFiles` is pure:** no I/O inside the scan core — filesystem reads are isolated to `collectTsFiles` / the `fs.readFileSync` call before `scanSource`. `main()` owns all I/O and the exit code

## Configuration

- `EXEMPT_DIR_NAMES` (Set in `adws/checkGitGhGuard.ts`): directory basenames pruned during file discovery. Currently: `node_modules`, `dist`, `.worktrees`, `.claude`, `features`, `test`
- `EXEMPT_PACKAGE_DIR` (string): `'adws/gitContext'` — the structurally exempt package path
- `ALLOWLIST` (readonly string[] in `adws/checkGitGhGuard.ts`): repo-relative paths allowed to call `git`/`gh` directly. Each entry carries an inline comment stating its category and reason. Add new entries here with a justification comment; do not remove entries without migrating the call site
- `package.json` `scripts.lint:git-guard`: `bunx tsx adws/checkGitGhGuard.ts` — the npm script alias
- `.github/workflows/git-cli-guard.yml`: CI trigger (`on: [pull_request, push]`), single job, steps: checkout → setup-bun → bun install → `bun run lint:git-guard`

## Gotchas

- **The current tree is not a clean zero-shell-out state.** `#661`–`#664` migrated the main call sites, but several workflow files still shell out directly and are temporarily allowlisted. The allowlist `residual` entries are the authoritative list of remaining migrations; they shrink as follow-up issues land
- **Allowlist mismatch causes exit 1.** If a new file shells out to `git`/`gh` and is not in `ALLOWLIST`, the guard fails the build. Resolution: either migrate the call to a `GitContext` method, or add the file to `ALLOWLIST` with a category and justification comment
- **`features/` and `test/` are fully excluded from scanning.** BDD step definitions and test harness utilities legitimately use `git`/`gh` for fixture repo setup; excluding them avoids noise and keeps the guard focused on production code
- **No unit tests for the guard itself.** Per the PRD Enforcement note, the guard is validated by CI (the workflow) and by the manual end-to-end verification (temporarily add a violation, confirm exit 1, revert). Agent-written unit tests for the scanner are not added; BDD/CI gates are the proof mechanism
- **`upgradeClaim.ts` has many `git …` mentions in comments.** The AST scan correctly skips these — only call-expression first-arguments are inspected, so the extensive JSDoc in `upgradeClaim.ts` produces zero false positives
