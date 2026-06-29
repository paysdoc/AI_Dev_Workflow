# Git/GH CLI Guard

## Overview

This module enforces the GitContext PRD invariant that all `git` and `gh` shell-outs must route through the `adws/gitContext/` package. It is an AST-based standalone scanner (`adws/checkGitGhGuard.ts`) wired into a dedicated CI workflow that fails the build on any direct `exec`/`spawn`/`execSync` of a `git …` or `gh …` command string outside the structurally-exempt package. As of #701 (the capstone), the `ALLOWLIST` machinery has been entirely removed — the `ALLOWLIST` const, the `allowed` Set, and the per-file skip are gone. The only legitimate exemption is the structural `EXEMPT_PACKAGE_DIR = 'adws/gitContext'`. The wrong path is now mechanically unrepresentable.

## Responsibilities

- Walk all `.ts`/`.tsx` source files under the repo (excluding `node_modules`, `dist`, `.worktrees`, `.claude`, `features`, `test`, `adws/gitContext/**`, and `*.test.ts` / `__tests__/**`)
- Parse each scanned file with the TypeScript compiler API (AST-based scan — comment text is never a false positive)
- Detect call expressions whose first argument is a string/template literal matching `/^(git|gh)(\s|$)/` — catches `execSync('git …')`, `execWithRetry(\`gh …\`)`, `execFileSync('git', […])`, injected `deps.exec(\`gh …\`)`, and any other call shape
- Exit `0` (pass) when no violations are found; exit `1` (fail) with a `path:line  command` listing and a one-line remedy when any are found
- Print `Git/GH CLI Guard — scanned N files (0 allowlisted)` on every run — the `(0 allowlisted)` literal preserves the capstone `(\d+) allowlisted` regex observable and makes the zero invariant visible
- Run as `bun run lint:git-guard` and as the sole step in `.github/workflows/git-cli-guard.yml` (triggers on every `pull_request` and `push`)

## Contracts & Invariants

- **Structural exemption:** the entire `adws/gitContext/` directory is never scanned — it is the one place permitted to shell out to `git`/`gh`
- **No allowlist:** the `ALLOWLIST` const and per-file skip were deleted in #701. The sole exemption is the directory-walk skip on `EXEMPT_PACKAGE_DIR`. Any raw `git`/`gh` call outside the package fails CI immediately.
- **Detection by command string, not callee:** the scanner matches the literal string argument, not the function name. This catches `execSync`, `execWithRetry`, `spawn`, `execFileSync`, and injected callback forms uniformly
- **AST-only, no regex on source text:** `ts.createSourceFile` + node walking means `git …` mentions in JSDoc, comments, or string variables not passed as a first argument are never flagged
- **`scanFiles` is pure:** no I/O inside the scan core — filesystem reads are isolated to `collectTsFiles` / the `fs.readFileSync` call before `scanSource`. `main()` owns all I/O and the exit code
- **The ratchet is at zero and the escape hatch is closed:** `ALLOWLIST` is deleted. Any new raw `git`/`gh` shell-out anywhere outside `adws/gitContext/` immediately breaks CI. New bootstrap code must live in the package.
- **Unit-tested since #701:** `adws/__tests__/checkGitGhGuard.test.ts` asserts that a raw `git`/`gh` call string in a scanned (non-package) fixture is a violation, and that the function signature carries no allowlist parameter and applies no per-file skip.

## Configuration

- `EXEMPT_DIR_NAMES` (Set in `adws/checkGitGhGuard.ts`): directory basenames pruned during file discovery. Currently: `node_modules`, `dist`, `.worktrees`, `.claude`, `features`, `test`
- `EXEMPT_PACKAGE_DIR` (string): `'adws/gitContext'` — the structurally exempt package path; the sole file exemption
- `package.json` `scripts.lint:git-guard`: `bunx tsx adws/checkGitGhGuard.ts`
- `.github/workflows/git-cli-guard.yml`: CI trigger (`on: [pull_request, push]`), single job, steps: checkout → setup-bun → bun install → `bun run lint:git-guard`

## Gotchas

- **The ALLOWLIST has been deleted (#701).** The `ALLOWLIST` const, the `allowed` Set, and the `if (allowed.has(relPath)) continue;` skip are all gone. There is no allowlist parameter to `scanFiles`. The only exemption is the directory-walk skip on `EXEMPT_PACKAGE_DIR`. The remedy text now reads "route through GitContext, or place inside the adws/gitContext package."
- **`(0 allowlisted)` is now a literal string.** The runtime print previously used `${ALLOWLIST.length}`. After deletion, it is the literal `0 allowlisted`. This preserves the `(\d+) allowlisted` step-definition regex used by the #700/#701 BDD guard scenarios.
- **Any new raw git/gh call outside `adws/gitContext/` immediately fails CI.** Resolution: add the code to the package. There is no allowlist escape hatch.
- **`features/` and `test/` are fully excluded from scanning.** BDD step definitions and test harness utilities legitimately use `git`/`gh` for fixture repo setup
- **AST scan only — comments and string variables are not flagged.** `upgradeClaim.ts` has many `git …` mentions in comments; these are correctly skipped.
- **`scanFiles` and `scanSource` are exported as a module** — `main()` is only called when `process.argv[1]` includes `checkGitGhGuard`, so test imports work without triggering the guard.
