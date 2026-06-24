# Git/GH CLI Guard

## Overview

This module enforces the GitContext PRD invariant that all `git` and `gh` shell-outs must route through the `adws/gitContext/` package. It is an AST-based standalone scanner (`adws/checkGitGhGuard.ts`) wired into a dedicated CI workflow that fails the build on any direct `exec`/`spawn`/`execSync` of a `git …` or `gh …` command string outside the allowed package and allowlist. As of #700, the `ALLOWLIST` is empty — the four former bootstrap files (`launchGitContext.ts`, `gitContextFactory.ts`, `githubAppAuth.ts`, `targetRepoManager.ts`) have been absorbed or rewired with zero raw git/gh strings — making the wrong path mechanically unrepresentable end-to-end.

## Responsibilities

- Walk all `.ts`/`.tsx` source files under the repo (excluding `node_modules`, `dist`, `.worktrees`, `.claude`, `features`, `test`, `adws/gitContext/**`, and `*.test.ts` / `__tests__/**`)
- Parse each non-allowlisted file with the TypeScript compiler API (AST-based scan — comment text is never a false positive)
- Detect call expressions whose first argument is a string/template literal matching `/^(git|gh)(\s|$)/` — catches `execSync('git …')`, `execWithRetry(\`gh …\`)`, `execFileSync('git', […])`, injected `deps.exec(\`gh …\`)`, and any other call shape
- Maintain a documented `ALLOWLIST` of repo-relative paths that may shell out directly (currently empty — the ratchet is at zero)
- Exit `0` (pass) when no non-allowlisted violations are found; exit `1` (fail) with a `path:line  command` listing and a one-line remedy when any are found
- Run as `bun run lint:git-guard` and as the sole step in `.github/workflows/git-cli-guard.yml` (triggers on every `pull_request` and `push`)

## Contracts & Invariants

- **Structural exemption:** the entire `adws/gitContext/` directory is never scanned — it is the one place permitted to shell out to `git`/`gh`
- **Detection by command string, not callee:** the scanner matches the literal string argument, not the function name. This catches `execSync`, `execWithRetry`, `spawn`, `execFileSync`, and injected callback forms uniformly
- **AST-only, no regex on source text:** `ts.createSourceFile` + node walking means `git …` mentions in JSDoc, comments, or string variables not passed as a first argument are never flagged
- **Allowlist is the source of truth:** any file added to `ALLOWLIST` with a category comment is silently skipped; any unallowlisted file with a violation causes exit `1`
- **`scanFiles` is pure:** no I/O inside the scan core — filesystem reads are isolated to `collectTsFiles` / the `fs.readFileSync` call before `scanSource`. `main()` owns all I/O and the exit code
- **The ratchet is at zero:** `ALLOWLIST` is empty after #700. Any new raw `git`/`gh` shell-out anywhere outside `adws/gitContext/` immediately breaks CI. New bootstrap code must live in the package.

## Configuration

- `EXEMPT_DIR_NAMES` (Set in `adws/checkGitGhGuard.ts`): directory basenames pruned during file discovery. Currently: `node_modules`, `dist`, `.worktrees`, `.claude`, `features`, `test`
- `EXEMPT_PACKAGE_DIR` (string): `'adws/gitContext'` — the structurally exempt package path
- `ALLOWLIST` (readonly string[] in `adws/checkGitGhGuard.ts`): **empty as of #700**. The bootstrap category is closed (primitives absorbed into `adws/gitContext/`); the diagnostic category was closed in #699; the residual category was emptied across #691–#698.
- `package.json` `scripts.lint:git-guard`: `bunx tsx adws/checkGitGhGuard.ts`
- `.github/workflows/git-cli-guard.yml`: CI trigger (`on: [pull_request, push]`), single job, steps: checkout → setup-bun → bun install → `bun run lint:git-guard`

## Gotchas

- **The ALLOWLIST is now empty (#700).** All three former categories (`bootstrap`, `residual`, `diagnostic`) have been closed. Bootstrap primitives live in the structurally-exempt `adws/gitContext/` package; no allowlist entry is needed for them. Any future bootstrap code must be added there.
- **Any new raw git/gh call outside `adws/gitContext/` immediately fails CI.** This is the ratchet. Resolution: either add the code to the package, or (rarely) add an allowlist entry with a justified category comment — but the bootstrap and diagnostic categories are intentionally closed.
- **Allowlist mismatch causes exit 1.** If a new file shells out to `git`/`gh` and is not in `ALLOWLIST`, the guard fails the build
- **`features/` and `test/` are fully excluded from scanning.** BDD step definitions and test harness utilities legitimately use `git`/`gh` for fixture repo setup
- **No unit tests for the guard itself.** Validated by CI (the workflow) and by manual end-to-end verification (temporarily add a violation, confirm exit 1, revert)
- **`upgradeClaim.ts` has many `git …` mentions in comments.** The AST scan correctly skips these — only call-expression first-arguments are inspected
