# Git/GH CLI Guard

## Overview

This module enforces the GitContext PRD invariant that all `git` and `gh` shell-outs — and all repo-identity resolution — must route through the `adws/gitContext/` package and its launch-boundary contexts. It is an AST-based standalone scanner (`adws/checkGitGhGuard.ts`) wired into a dedicated CI workflow that fails the build on either of two independent rules: a direct `exec`/`spawn`/`execSync` of a `git …` or `gh …` command string outside the structurally-exempt package (`git-gh-shellout`), or a `gitContextForRepo(…)` construction fed cwd-derived identity instead of a threaded launch-boundary `GitContext` (`cwd-derived-identity`, #769). As of #701 (the capstone), the `ALLOWLIST` machinery has been entirely removed — the `ALLOWLIST` const, the `allowed` Set, and the per-file skip are gone, and #769 introduced no path allowlist either. The only legitimate exemption is the structural `EXEMPT_PACKAGE_DIR = 'adws/gitContext'`. The wrong path is now mechanically unrepresentable for both shell-outs and identity re-derivation.

## Responsibilities

- Walk all `.ts`/`.tsx` source files under the repo (excluding `node_modules`, `dist`, `.worktrees`, `.claude`, `features`, `test`, `adws/gitContext/**`, and `*.test.ts` / `__tests__/**`)
- Parse each scanned file with the TypeScript compiler API (AST-based scan — comment text is never a false positive)
- **`git-gh-shellout` rule:** detect call expressions whose first argument is a string/template literal matching `/^(git|gh)(\s|$)/` — catches `execSync('git …')`, `execWithRetry(\`gh …\`)`, `execFileSync('git', […])`, injected `deps.exec(\`gh …\`)`, and any other call shape
- **`cwd-derived-identity` rule (#769):** two-pass per file. Pass 1 (`collectCwdDerivedIdentityNames`) collects the names of local variables whose initializer is a zero-argument `getRepoInfo()`/`readLocalRepoInfo()` call. Pass 2 (`flagCwdDerivedIdentityUses`) flags any `gitContextForRepo(…)` call (bare identifier or property access) whose first argument is either an inline zero-argument read of one of those two functions, or an identifier collected in pass 1
- Exit `0` (pass) when no violations of either rule are found; exit `1` (fail) with a `path:line  [rule]  command` listing and a per-rule remedy line when any are found
- Print `Git/GH CLI Guard — scanned N files (0 allowlisted)` on every run — the `(0 allowlisted)` literal preserves the capstone `(\d+) allowlisted` regex observable and makes the zero invariant visible
- Run as `bun run lint:git-guard` and as the sole step in `.github/workflows/git-cli-guard.yml` (triggers on every `pull_request` and `push`)

## Contracts & Invariants

- **Structural exemption:** the entire `adws/gitContext/` directory is never scanned — it is the one place permitted to shell out to `git`/`gh` or resolve identity from cwd
- **No allowlist, for either rule:** the `ALLOWLIST` const and per-file skip were deleted in #701, and #769 added no allowlist for `cwd-derived-identity` either. The sole exemption is the directory-walk skip on `EXEMPT_PACKAGE_DIR`. Any raw `git`/`gh` call, or any cwd-derived-identity composite, outside the package fails CI immediately.
- **Detection by command string, not callee (`git-gh-shellout`):** the scanner matches the literal string argument, not the function name. This catches `execSync`, `execWithRetry`, `spawn`, `execFileSync`, and injected callback forms uniformly
- **Detection by composite shape, not a single call (`cwd-derived-identity`):** neither `getRepoInfo()`/`readLocalRepoInfo()` alone nor `gitContextForRepo(x)` alone is flagged — only the composition of a zero-argument cwd read feeding a `gitContextForRepo` construction, either inline or via a local variable bound to one earlier in the same file. The local-variable form is load-bearing: it is the shape most real call sites use, and a purely-inline-only check would miss them.
- **Guarded fallbacks stay legal:** `x ?? getRepoInfo()` is a `BinaryExpression` initializer, never collected by pass 1, so `gitContextForRepo(x ?? getRepoInfo())` is not flagged — this is how a launch boundary is allowed to fall back to a cwd read when no explicit repo was passed. An argument-bearing call (`getRepoInfo(cwd)`, `readLocalRepoInfo(REPO_ROOT)`) is likewise never collected. A bare `getRepoInfo()` that never reaches a `gitContextForRepo` construction is not flagged.
- **AST-only, no regex on source text:** `ts.createSourceFile` + node walking means `git …` mentions or `gitContextForRepo`/`getRepoInfo` mentions in JSDoc, comments, or string variables never passed to a real call are never flagged
- **`scanFiles`/`scanSource` are pure:** no I/O inside the scan core — filesystem reads are isolated to `collectTsFiles` / the `fs.readFileSync` call before `scanSource`. `main()` owns all I/O and the exit code
- **The ratchet is at zero and the escape hatch is closed for both rules:** `ALLOWLIST` is deleted and `cwd-derived-identity` was introduced with none. Any new raw `git`/`gh` shell-out, or any new cwd-derived-identity composite, anywhere outside `adws/gitContext/` immediately breaks CI. Legitimate self-host construction sites pass an explicit `REPO_ROOT` argument instead of being allowlisted.
- **Unit-tested:** `adws/__tests__/checkGitGhGuard.test.ts` covers both rules — a raw `git`/`gh` call string in a scanned (non-package) fixture is a `git-gh-shellout` violation with no allowlist parameter or per-file skip; an inline composite, a local-variable composite, and a `readLocalRepoInfo()` composite are each one `cwd-derived-identity` violation; an explicit-argument construction, a guarded-fallback local, and a construction fed a plain parameter are each zero violations.

## Configuration

- `EXEMPT_DIR_NAMES` (Set in `adws/checkGitGhGuard.ts`): directory basenames pruned during file discovery. Currently: `node_modules`, `dist`, `.worktrees`, `.claude`, `features`, `test`
- `EXEMPT_PACKAGE_DIR` (string): `'adws/gitContext'` — the structurally exempt package path; the sole file exemption
- `package.json` `scripts.lint:git-guard`: `bunx tsx adws/checkGitGhGuard.ts`
- `.github/workflows/git-cli-guard.yml`: CI trigger (`on: [pull_request, push]`), single job, steps: checkout → setup-bun → bun install → `bun run lint:git-guard`

## Gotchas

- **The ALLOWLIST has been deleted (#701).** The `ALLOWLIST` const, the `allowed` Set, and the `if (allowed.has(relPath)) continue;` skip are all gone. There is no allowlist parameter to `scanFiles`. The only exemption is the directory-walk skip on `EXEMPT_PACKAGE_DIR`.
- **`(0 allowlisted)` is now a literal string.** The runtime print previously used `${ALLOWLIST.length}`. After deletion, it is the literal `0 allowlisted`. This preserves the `(\d+) allowlisted` step-definition regex used by the #700/#701 BDD guard scenarios — `cwd-derived-identity` (#769) prints under the same `scanned N files (0 allowlisted)` header, unchanged.
- **Any new raw git/gh call outside `adws/gitContext/` immediately fails CI.** Resolution: add the code to the package. There is no allowlist escape hatch.
- **Any new `gitContextForRepo(getRepoInfo())`-shaped composite immediately fails CI (#769).** This is what caught the class of bug where a cron sweep silently re-derived repo identity from cwd instead of using the launch-boundary context it was handed. Resolution: thread the caller's launch-boundary `GitContext` in instead of reconstructing one; a legitimate self-host construction passes `REPO_ROOT` explicitly (`gitContextForRepo(readLocalRepoInfo(REPO_ROOT))`), which is never flagged since the read takes an argument.
- **`features/` and `test/` are fully excluded from scanning.** BDD step definitions and test harness utilities legitimately use `git`/`gh` for fixture repo setup, and DocString fixtures in `.feature` step-defs (e.g. `@adw-769`'s guard-rule scenarios, which call `scanFiles` directly against a throwaway temp fixture) can freely contain either violation shape without affecting the real repo scan
- **AST scan only — comments and string variables are not flagged.** `upgradeClaim.ts` has many `git …` mentions in comments; these are correctly skipped. Likewise a bare `getRepoInfo()` whose result is never passed to `gitContextForRepo` is not a violation.
- **`scanFiles` and `scanSource` are exported as a module** — `main()` is only called when `process.argv[1]` includes `checkGitGhGuard`, so test imports work without triggering the guard.
- **`Violation.rule` defaults existing detections to `'git-gh-shellout'`.** Adding the second rule widened the `Violation` type but did not change the shape or values of pre-existing shellout violations, so tests asserting on `command`/`file`/`line` for that rule are unaffected.
