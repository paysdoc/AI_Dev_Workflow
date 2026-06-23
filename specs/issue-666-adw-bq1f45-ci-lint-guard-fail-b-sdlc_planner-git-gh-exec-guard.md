# Chore: CI/lint guard — fail build on direct git/gh exec outside GitContext package

## Metadata
issueNumber: `666`
adwId: `bq1f45-ci-lint-guard-fail-b`
issueJson: `{"number":666,"title":"CI/lint guard: fail build on direct git/gh exec outside GitContext package","body":"## Parent PRD\n\n`specs/prd/git-context-repo-authority.md` (see **Enforcement**)\n\n## What to build\n\nA CI/lint guard that **fails the build** on any direct `exec`/`spawn` of `git` or `gh` outside the GitContext package. This is the mechanism that turns \"route through the context\" from convention into an enforced invariant — making the wrong path *unrepresentable*. It lands last, once every call site (worktree #661, branch/commit #662, gh ops #663, and the boundary constructors) has been migrated and no out-of-package direct call remains. Shipped as a CI rule; no unit tests for the guard itself (per PRD).\n\n## Acceptance criteria\n\n- [ ] CI/lint rule detects any direct `exec`/`spawn`/`execSync` of `git` or `gh` outside the GitContext package and fails the build\n- [ ] The package itself is exempt (it is the one place allowed to shell out)\n- [ ] The guard passes on the current tree (confirming all call sites are migrated)\n- [ ] A deliberately-added out-of-package `git`/`gh` shell-out is caught by the guard (manual verification)\n\n## Blocked by\n\n- Blocked by #661\n- Blocked by #662\n- Blocked by #663\n- Blocked by #664\n\n## User stories addressed\n\n- User story 5\n- User story 8","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-21T10:21:09Z","comments":[],"actionableComment":null}`

## Chore Description

Ship the **enforcement** half of the GitContext PRD (`specs/prd/git-context-repo-authority.md`, **Enforcement** section; User Stories 5 and 8): a CI/lint guard that **fails the build** when any code *outside* the `adws/gitContext/` package directly shells out to the `git` or `gh` CLI (via `execSync`, `spawnSync`, `spawn`, `exec`, `execFile`/`execFileSync`, or any wrapper such as `execWithRetry` / injected `exec` callbacks that ultimately runs a `git …` / `gh …` command string). This turns "route all git/gh through the context" from convention into a mechanically enforced invariant, making the wrong path unrepresentable and preventing a new call site from reintroducing the wrong-repo / token-bleed class of bug.

The four blocking issues (#661 worktree, #662 branch/commit/VCS, #663 gh ops, #664 webhook per-event context) are **all merged into `dev`**. However, the tree is **not** a clean "zero out-of-package shell-outs" state — three categories of direct git/gh calls legitimately or residually remain:

1. **Bootstrap / boundary** — code that *must* run git/gh *before* a `GitContext` can be constructed: discovering the auth token (`gh auth token`), the git author identity (`git config user.name/email`), and the self-host remote (`git remote get-url origin`); cloning a target repo for the first time (`git clone`); and the atomic upgrade-claim distributed lock. A `GitContext` cannot bootstrap itself, so these are **permanent, legitimate exemptions**.
2. **Diagnostic / tooling** — health-check and doc-index scripts that run outside the workflow hot path.
3. **Residual / not-yet-migrated** — workflow code that still shells out directly and was not converted to a `GitContext` method by #661–#664 (some need new context methods that are out of scope here).

Because of this, the guard is **allowlist-based**: the package directory is exempt structurally, and a small, explicitly-documented allowlist of files carries the bootstrap/diagnostic (permanent) and residual (temporary, follow-up) exemptions. Everything else fails the build. This satisfies "guard passes on the current tree" honestly while still catching any *new* out-of-package shell-out and any new file. Per the PRD, the guard ships as a CI rule with **no unit tests for the guard itself** (consistent with `.adw/coding_guidelines.md`: ADW uses BDD/CI gates, not agent-written unit tests).

**Mechanism chosen:** a standalone TypeScript scanner script (`adws/checkGitGhGuard.ts`) run via `bunx tsx`, mirroring the existing `adws/checkLivingDocsIndex.ts` precedent. It is AST-based (via the already-present `typescript` dependency) so that `git`/`gh` mentions in comments and JSDoc (e.g. the many in `upgradeClaim.ts`) are **not** false-positives. It is wired into a new `bun run lint:git-guard` script and a dedicated GitHub Actions workflow that runs on `pull_request` and `push` so it fails the build.

## Relevant Files

Use these files to resolve the chore:

- `specs/prd/git-context-repo-authority.md` — Parent PRD; the **Enforcement** section is the authority for this chore. Read it to confirm scope (CI rule, no unit tests, package is the one allowed shell-out site).
- `adws/checkLivingDocsIndex.ts` — **Precedent to mirror.** An existing standalone acceptance-gate script (`bunx tsx adws/checkLivingDocsIndex.ts`, exit 0/1, I/O isolated at boundaries, `CheckResult` shape). The new guard should follow this file's structure and style.
- `adws/gitContext/gitContext.ts` — Contains `defaultExec` (lines ~40–51), the **single allowed real spawn site** for the package. Confirms the package is the one place permitted to call `execSync('git…')` / `execSync('gh…')`. The entire `adws/gitContext/` directory is the structural exemption.
- `adws/gitContext/processCleanup.ts` — Uses `execSync('lsof …')` (not git/gh); confirms the package may shell out to non-git/gh utilities freely. In-package, so exempt regardless.
- `adws/core/utils.ts` — Defines `execWithRetry(command, options)` (~lines 53–78), a retrying wrapper around `execSync`. Several residual call sites run git/gh *through* this wrapper, so the scanner must detect by the **command string** (`git …` / `gh …`), not only by the callee name. The `execWithRetry` definition itself is not a violation (it runs whatever string it is given).
- `eslint.config.js` — Flat ESLint config (`ignores` already lists `node_modules/`, `dist/`, `.claude/`, `.worktrees/`, `**/*.md`). The guard is delivered as a separate script (not an ESLint rule) for robustness against the variety of call shapes; this file is reference for the existing lint surface and the `ignores` set the guard should mirror.
- `package.json` — `scripts` block; add `lint:git-guard`. `build` = `tsc`, `lint` = `eslint .`, `test` = `bunx tsc --noEmit`, `test:unit` = `vitest run`. `typescript` is already a devDependency (used by the AST scanner).
- `.github/workflows/regression.yml`, `.github/workflows/deploy-workers.yml` — Only existing workflows; **neither runs lint/build on `pull_request`/`push`.** Mirror their style (`actions/checkout@v4`, `oven-sh/setup-bun@v2`, `bun install`) for the new guard workflow.
- `tsconfig.json` — `module: ESNext`, `moduleResolution: bundler`, `allowImportingTsExtensions: true`, `strict: true`. The scanner runs under `tsx`, so `.ts` extension imports and ESM are fine.
- `.adw/coding_guidelines.md` — Must be followed: files < 300 lines, single responsibility, guard clauses / max ~2 nesting depth, isolate side effects (fs/exec) at boundaries, no `any`, JSDoc on public/non-obvious logic.
- `.adw/commands.md` — Source of the project-specific validation commands (lint, type-check, build, unit tests, scenario commands).

### Files that seed the guard's allowlist (verify and extend at implementation time)

The following are the **known** out-of-package files that currently shell out to git/gh and must be allowlisted so the guard passes on the current tree. The list was assembled by codebase survey but is **not guaranteed exhaustive** — the implementation step explicitly runs the guard and adds any further real-shell-out file it reports.

- **Permanent — bootstrap/boundary (cannot use a GitContext that does not yet exist):**
  - `adws/core/launchGitContext.ts` — `gh auth token`, `git config user.name/email` (launch-identity discovery)
  - `adws/github/gitContextFactory.ts` — `git config user.name/email`, `gh auth token`, `git remote get-url origin` (context construction)
  - `adws/core/targetRepoManager.ts` — `git clone`, `git fetch origin`, `gh repo view …defaultBranchRef` (first-time clone / workspace setup)
  - `adws/core/upgradeClaim.ts` — `git fetch`/`git worktree add`/`git commit --allow-empty`/`git push`/`git worktree remove` (atomic pre-context upgrade-claim distributed lock; note: also has many `git` mentions in **comments** that must NOT trip an AST scanner)
  - `adws/github/githubAppAuth.ts` — GitHub App token minting (auth acquisition; verify it shells out to `gh`)
- **Permanent — diagnostic/tooling (non-hot-path):**
  - `adws/healthCheckChecks.ts` — `git rev-parse`/`git remote`/`git status`/`git config`, `gh auth status`, `gh issue view`
  - `adws/healthCheck.tsx` — `gh repo view --json url`
  - `adws/checkLivingDocsIndex.ts` — `git ls-files` (one-off doc-index gate script)
- **Temporary — residual / not-yet-migrated (allowlist now, file follow-up migration; see Notes):**
  - `adws/vcs/branchOperations.ts` — `gh repo view …defaultBranchRef`, `git branch -D`
  - `adws/vcs/worktreeProbe.ts` — `git rev-parse --git-dir`, `git symbolic-ref`, `git worktree list`
  - `adws/vcs/worktreeOperations.ts` — `git worktree list --porcelain`
  - `adws/core/orchestratorLib.ts` — `git status --porcelain`
  - `adws/core/remoteReconcile.ts` — `git ls-remote` (via `execWithRetry`)
  - `adws/adwPromotionSweep.tsx` — `gh pr view`, `gh pr create`, `git <args>` (via `execWithRetry`)
  - `adws/phases/depauditSetup.ts` — `gh secret set` (via injected `execWithRetry`)
  - `adws/phases/docsSelfCheck.ts` — `gh issue list` (via injected `execWithRetry`)
  - `adws/github/labelManager.ts` — `gh label create`, `gh issue edit` (via injected `exec` callback)
  - `adws/triggers/autoMergeHandler.ts` — `git fetch`/`git merge` (verify; surfaced by survey, classify on run)

### New Files

- `adws/checkGitGhGuard.ts` — The standalone AST-based guard scanner. Walks `.ts`/`.tsx` files under the repo (excluding `node_modules/`, `dist/`, `.worktrees/`, `.claude/`, `**/*.test.ts`, `**/__tests__/**`, and the structurally-exempt `adws/gitContext/**`), parses each with the TypeScript compiler API, flags any call expression whose first string/template-literal argument is a `git`/`gh` command (starts with `git `/`gh ` or equals `git`/`gh`), skips files on the documented `ALLOWLIST`, prints violations as `path:line  <command>`, and exits `1` if any non-allowlisted violation is found (else `0`). Keep under 300 lines; isolate fs/AST reads at boundaries; export the core pure scan function and a thin `main()` runner.
- `.github/workflows/git-cli-guard.yml` — New GitHub Actions workflow, `on: [pull_request, push]`, `runs-on: ubuntu-latest`, steps: `actions/checkout@v4`, `oven-sh/setup-bun@v2`, `bun install`, then `bun run lint:git-guard`. This is the "fails the build" mechanism.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the PRD Enforcement section and confirm scope

- Read `specs/prd/git-context-repo-authority.md` (especially **Enforcement** and **Removal of the unsafe primitives**) and `adws/gitContext/gitContext.ts` `defaultExec`.
- Confirm: package = `adws/gitContext/` is the only allowed shell-out site; guard ships as a CI rule; **no unit tests** for the guard.

### 2. Implement the guard scanner `adws/checkGitGhGuard.ts`

- Mirror `adws/checkLivingDocsIndex.ts` style: top-of-file JSDoc with purpose + `Run via: bunx tsx adws/checkGitGhGuard.ts`, exit-code contract (0 pass / 1 fail), I/O isolated at boundaries, small named helpers, max ~2 nesting depth (use guard clauses / extracted per-file and per-node functions).
- Define:
  - `EXEMPT_DIRS` — directories never scanned: `node_modules`, `dist`, `.worktrees`, `.claude`, and the package `adws/gitContext`.
  - `EXEMPT_FILE_PATTERNS` — `*.test.ts`, `*.test.tsx`, and anything under `__tests__/`.
  - `ALLOWLIST` — a `readonly` array of repo-relative paths, each with an inline comment giving its category (`bootstrap` / `diagnostic` / `residual #<issue?>`). Seed it from the **"Files that seed the guard's allowlist"** list above (permanent + temporary entries).
- File discovery: recursively collect `.ts`/`.tsx` files, pruning `EXEMPT_DIRS`. (A simple `fs.readdirSync` walk like `checkLivingDocsIndex.ts` is fine; do not shell out to `git ls-files` — keep the guard self-contained.)
- Detection (AST, not regex, to avoid comment false-positives): for each non-allowlisted file, parse with `ts.createSourceFile(...)` and walk nodes. Flag a `ts.CallExpression` when its **first argument** is:
  - a string literal (`ts.isStringLiteral`) whose value matches `/^(git|gh)(\s|$)/`, OR
  - a template expression (`ts.isTemplateExpression` / `ts.isNoSubstitutionTemplateLiteral`) whose leading text (head/quasi) matches `/^(git|gh)\s/` (catches `` `git ${args}` ``, `` `gh pr view ${n}` ``), OR
  - the bare command form `('git', [...])` / `('gh', [...])` (literal exactly `git`/`gh` — catches `execFileSync('git', [...])`).
  - Detecting by the **command string** (regardless of callee) is intentional: it catches `execSync`, `execWithRetry`, injected `deps.exec(...)`, `runGit` wrappers, and `spawn`/`execFile` uniformly. Record `{ file, line, command }` using `sourceFile.getLineAndCharacterOfPosition`.
- Reporting: print a clear header; on violations, list each `path:line  command` and a one-line remedy ("Route through GitContext, or add to ALLOWLIST in adws/checkGitGhGuard.ts with justification"); `process.exit(1)`. On clean, print a pass summary and `process.exit(0)`.
- Structure the scan as a pure function returning the violations array, with a thin `main()` that does I/O + exit — so the side effects sit at the boundary per the guidelines.

### 3. Run the guard and reconcile the allowlist against reality

- Run `bunx tsx adws/checkGitGhGuard.ts`.
- For **every** violation it reports that is NOT yet allowlisted, open the file and classify it:
  - bootstrap/boundary or diagnostic → add to `ALLOWLIST` as a **permanent** entry with a one-line justification comment.
  - residual workflow code → add as a **temporary** entry tagged for follow-up migration (e.g. `// residual — migrate to GitContext method (follow-up)`).
  - If a reported call is actually a non-git/gh command that merely starts with the letters `git`/`gh` (none expected, but verify), refine the matcher rather than allowlisting.
- Iterate until `bunx tsx adws/checkGitGhGuard.ts` exits `0` on the current tree. This satisfies acceptance criterion "guard passes on the current tree."

### 4. Wire the guard into npm scripts

- In `package.json` `scripts`, add: `"lint:git-guard": "bunx tsx adws/checkGitGhGuard.ts"`.
- Do **not** chain it into the existing `lint` (`eslint .`) target unless trivial; keep it a discrete script so its failure message is unambiguous in CI. (Optional, low-risk: also reference it from a `lint:all` if desired — not required.)

### 5. Add the CI workflow `.github/workflows/git-cli-guard.yml`

- `name: Git/GH CLI Guard`; `on: { pull_request: {}, push: {} }`; one job `runs-on: ubuntu-latest`.
- Steps mirror `regression.yml`: `actions/checkout@v4` → `oven-sh/setup-bun@v2` → `run: bun install` → `run: bun run lint:git-guard`.
- This step's non-zero exit fails the build (acceptance criterion 1).

### 6. Manual verification — confirm a real violation is caught

- Temporarily add an out-of-package direct shell-out in a non-allowlisted file (e.g. add `import { execSync } from 'child_process';` + `execSync('git status');` to a scratch spot in an already-imported non-allowlisted module, or create a throwaway `adws/__guardcheck_tmp.ts`).
- Run `bunx tsx adws/checkGitGhGuard.ts` and confirm it reports the violation with the correct `path:line  command` and exits `1`.
- **Revert** the temporary change completely and re-run to confirm exit `0`. Document this verification in the implementation summary (acceptance criterion 4).

### 7. Run all validation commands (zero regressions)

- Execute every command in **Validation Commands** below and confirm each exits cleanly.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions. (Sourced from `.adw/commands.md`.)

- `bunx tsx adws/checkGitGhGuard.ts` — The guard itself; MUST exit `0` on the current tree (acceptance criterion 3).
- `bun run lint:git-guard` — Same guard via the new npm script; MUST exit `0`.
- `bun run lint` — ESLint (`eslint .`); no new lint errors in the added files.
- `bunx tsc --noEmit` — Type-check the repo; the new scanner must type-check (no `any`, strict mode).
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional ADW type-check (per `.adw/commands.md`).
- `bun run build` — `tsc` build; no build errors.
- `bun run test:unit` — `vitest run`; full existing unit suite passes with zero regressions.

## Notes

- **Adhere to `.adw/coding_guidelines.md`:** keep `adws/checkGitGhGuard.ts` under 300 lines and single-responsibility; isolate fs/AST side effects at the boundary with a pure scan core; use guard clauses and ≤2 nesting depth; no `any` (use the `typescript` API's node types and narrow with `ts.isCallExpression` etc.); add JSDoc to the file header and the public scan function.
- **No unit tests for the guard** — per the PRD Enforcement note and `.adw/coding_guidelines.md` (ADW validates via BDD/CI gates, not agent-written unit tests). Step 6's manual verification is the required proof.
- **Why a script, not an ESLint rule:** the violating call shapes vary widely — `execSync('git …')`, `execWithRetry(\`git ${x}\`)`, injected `deps.exec(\`gh …\`)`, `runGit` callbacks, `execFileSync('git', […])`. Detecting by the *command string* in a dedicated AST pass is far more reliable than an `no-restricted-syntax` selector, and matches the existing `checkLivingDocsIndex.ts` precedent. AST (not text/regex) is mandatory so the abundant `git`/`gh` mentions in **comments** (notably `adws/core/upgradeClaim.ts`) do not produce false positives.
- **The current tree is NOT a clean zero-shell-out state**, despite #661–#664 being merged. This chore's allowlist therefore carries two permanent categories (bootstrap, diagnostic) and one temporary category (residual/not-yet-migrated). The guard's primary value from day one is preventing *new* out-of-package shell-outs and new files; the temporary allowlist entries shrink as residual call sites are migrated onto `GitContext` methods (some require new context methods — e.g. `gh secret set`, `gh repo view …defaultBranchRef`, `gh pr create` — which are out of scope here and should be follow-up issues).
- **The seed allowlist may be incomplete.** The survey behind the "Files that seed the guard's allowlist" list was not guaranteed exhaustive (e.g. `adws/triggers/autoMergeHandler.ts` surfaced late). Step 3's run-and-reconcile loop is the authoritative mechanism for reaching a passing tree — trust the guard's own output over the seed list.
- **No existing PR/push CI runs lint or build** (`regression.yml` is scheduled/dispatch; `deploy-workers.yml` is push-to-`main`/`workers/**`). The new `git-cli-guard.yml` is the first per-PR build-failing gate; keep it narrowly scoped to the guard so unrelated lint/build/test concerns do not block PRs through this workflow.
- Path nuance to confirm during implementation: `gitContextFactory.ts` lives at `adws/github/gitContextFactory.ts` (one survey pass mislabeled it under `adws/core/`); allowlist the real path.
