# Feature: GitContext — per-command auth/env injection with isolation

## Metadata
issueNumber: `659`
adwId: `6phrv4-gitcontext-per-comma`
issueJson: `{"number":659,"title":"GitContext: per-command auth/env injection with isolation","body":"## Parent PRD\n\n`specs/prd/git-context-repo-authority.md` (see **Auth model** and **Testing Decisions §1**)\n\n## What to build\n\nMake every `GitContext` operation spawn its underlying git/`gh` command with an explicit `cwd` and an explicit **child-process environment** carrying the auth token and git author/committer identity. The parent process's global environment is **never** mutated for auth — replacing the `process.env.GH_TOKEN = ...` mutation and module-global `activeRepo` gate in `github/githubAppAuth.ts`.\n\nIncludes at least one representative operation (e.g. a read op like default-branch or issue read) routed through the context to prove the spawn-with-env path end to end. Two contexts for two different repos, exercised in the same process, never observe each other's `cwd` or token — the bleed becomes structurally impossible.\n\n## Acceptance criteria\n\n- [ ] Operation methods spawn git/`gh` with an explicit `cwd` and a per-command child env carrying token + git author/committer\n- [ ] Parent `process.env` is never mutated for auth on the operation hot path\n- [ ] A representative op runs through the context with the expected token/author env supplied to the child process\n- [ ] Test: parent global env is left unmutated after an operation runs\n- [ ] Test: two contexts for two repos in one process never observe each other's `cwd` or token (isolation)\n\n## Blocked by\n\n- Blocked by #658\n\n## User stories addressed\n\n- User story 2\n- User story 7"}`

## Feature Description

This feature delivers the **auth-injection slice** of the `GitContext` repo-context authority described in `specs/prd/git-context-repo-authority.md` (see the **Auth model** and **Testing Decisions §1** sections). Issue #658 (its blocker, now merged) shipped the `GitContext` deep module with mandatory identity, single-authority base-path resolution, `worktreePathFor()`, and a pure `commandEnv()` helper that assembles the per-command child environment (`GH_TOKEN` + the four `GIT_AUTHOR_*`/`GIT_COMMITTER_*` vars) **without mutating `process.env`**.

#658 stopped at *computing* that environment. #659 makes it *load-bearing*: it adds the spawn mechanism — a single private command-runner inside `GitContext` — and at least one representative read operation (default-branch lookup) routed through it. Every such operation spawns its underlying git/`gh` command with an explicit `cwd` (the context's resolved base path) and an explicit child-process environment carrying the auth token and git identity. The parent process's global environment is never written for auth on this hot path.

This is the structural fix for the long-running **`GH_TOKEN` bleed** class of bug (`app_docs/feature-tcewff-cron-gh-token-bleed-fix.md`, and the webhook-concurrency variant). Today auth is applied by mutating the process-global `process.env.GH_TOKEN`, gated by a module-global `activeRepo` in `adws/github/githubAppAuth.ts`. In a long-lived process that interleaves work for multiple repos (notably the webhook server), an async continuation for repo B overwrites the global token mid-flight, so a `gh` call meant for repo A authenticates against B and fails with "could not resolve to a repository." By carrying the token on the context and injecting it per spawned command, two contexts for two repos exercised in the same process can no longer clobber each other's auth or `cwd` — the bleed becomes *structurally impossible* rather than merely discouraged.

The value to the operator (PRD user stories 2 and 7): concurrent multi-repo activity stops intermittently authenticating against the wrong repository, and interleaved async work in a long-lived process cannot bleed tokens between repos.

## User Story

As an ADW maintainer (PRD user story 7)
I want auth applied per command rather than via a process-global
So that interleaved async work in a long-lived process cannot bleed tokens between repos.

As an ADW operator (PRD user story 2)
I want concurrent multi-repo activity to never authenticate against the wrong repository
So that `gh` calls stop intermittently failing with "could not resolve to a repository."

## Problem Statement

`GitContext` (post-#658) knows *which repo's filesystem* it operates on and can *compute* the correct per-command environment, but it cannot yet *run* anything. Meanwhile every real git/`gh` call in ADW still resolves auth the unsafe way:

- `adws/github/githubAppAuth.ts` applies the token by assigning `process.env.GH_TOKEN = token` (line 197) and records the currently-authed repo in a module-global `activeRepo` (line 198). `configureGitIdentity()` likewise mutates `process.env.GIT_AUTHOR_*`/`GIT_COMMITTER_*` (lines 240–243). `ensureAppAuthForRepo()` (the webhook's per-request guard) reads/writes that same global state.
- Because the token lives in one process-global slot, **two repos cannot be authenticated at once in one process**. Interleaved async continuations overwrite each other's token, authenticating a call against the wrong repository. This is a recurring failure mode, not a one-off.

There is no operation surface on `GitContext` and no test proving that two contexts in one process stay isolated. Until at least one operation is routed through the context with per-command env injection, the PRD's central guarantee ("the bleed becomes structurally impossible") is unproven and unenforced.

## Solution Statement

Add the **per-command spawn mechanism** to `GitContext` and route one representative read operation through it, proving the spawn-with-env path end to end:

1. **A single private command-runner** inside `GitContext` is the one chokepoint that ever spawns a child process. It runs its command with `cwd = this.basePath` and `env = this.commandEnv(process.env)` — i.e. the parent environment *read* and overlaid with the context's token + git identity into a **new** object, never written back. `commandEnv()` (shipped by #658) already guarantees no mutation of `process.env` or of the base object; the runner reuses it verbatim.
2. **A representative read operation** — `defaultBranch()` — calls the runner with `gh repo view <owner>/<repo> --json defaultBranchRef --jq .defaultBranchRef.name`. This mirrors the existing precedent in `adws/core/targetRepoManager.ts:73` but is **identity-driven** (explicit `owner/repo`, `cwd` from the context) and **token-injected** (the per-command env), which the precedent is not. It is a pure read, so it is safe to add without touching write paths.
3. **An injectable exec seam** (the established ADW `Deps` idiom — `JanitorDeps`, `MergeDeps`, `ReconcileDeps`) lets tests substitute a spy for the real `execSync`, so the isolation/non-mutation/env-injection properties are asserted hermetically (no network), exactly as the PRD's Testing Decisions §1 and the existing GitHub-API suites prescribe. The default exec is a thin `execSync` wrapper — the single real spawn site in the package, which the future CI guard (PRD Enforcement, out of scope here) will rely on.

This slice deliberately **does not** rip out the legacy `process.env` mutation in `githubAppAuth.ts`: many existing `execSync('gh …')` call sites still depend on the process-global token, and migrating them is later-slice work per the PRD's staged operation surface. The new context path simply never participates in that global mutation, and the overlay (`commandEnv(process.env)`) means the context's token always wins for context-routed commands regardless of any ambient `GH_TOKEN`.

## Relevant Files

Use these files to implement the feature:

- `adws/gitContext/gitContext.ts` — The `GitContext` deep module from #658. Holds identity (`#owner`, `#repo`, `#token`, `#gitIdentity`), `#basePath`, `worktreePathFor()`, and the existing `commandEnv(base)` helper. **Add** the injectable exec, the private `#run()` command-runner chokepoint, and the `defaultBranch()` representative operation here. Currently 116 lines — well under the 300-line ceiling after the additions.
- `adws/gitContext/types.ts` — Public types (`GitIdentity`, `GitContextOptions`). **Add** the `ExecFn` type and the optional `GitContextDeps` interface (the injectable exec seam) here, keeping `GitContextOptions` purely identity/config.
- `adws/gitContext/index.ts` — Standalone package barrel. **Add** exports for the new `ExecFn` / `GitContextDeps` types so the package's public surface stays explicit and importable.
- `adws/github/githubAppAuth.ts` — The legacy auth module this feature structurally replaces on the operation hot path: `activateGitHubAppAuth()` mutates `process.env.GH_TOKEN` + `activeRepo`; `configureGitIdentity()` mutates the `GIT_*` vars; `ensureAppAuthForRepo()` is the webhook per-request guard. **Read for reference only** — do not modify it in this slice (see Notes on scope). It documents the exact pattern the per-command env replaces and the token-acquisition path (`getInstallationToken`) that a later launch-boundary slice will feed into the context.
- `adws/core/targetRepoManager.ts` — `fetchLatestRefs()` (line 69) is the existing precedent for the representative op: `execSync('gh repo view --json defaultBranchRef --jq .defaultBranchRef.name', { encoding: 'utf-8', cwd })`. Mirror its command shape; improve on it with explicit identity + per-command env. Reference only.
- `adws/github/issueApi.ts` — Reference for the alternative "issue read" representative op (`gh issue view <n> --repo <owner>/<repo> --json …`, lines 115/175/231/277), if the implementer prefers issue-read over default-branch. Reference only.
- `adws/vcs/__tests__/worktreeReset.test.ts` & `adws/vcs/__tests__/commitOperations.test.ts` — Prior art for deterministic git-operation tests and for the "spy on exec, assert the command/cwd/trimmed-output" pattern this feature's tests follow. Reference only.
- `specs/prd/git-context-repo-authority.md` — Parent PRD. The **Auth model** section (lines 78–79) and **Testing Decisions §1** (lines 93–96) are the binding spec for this slice. Reference only.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — Conditional doc owning `adws/gitContext/**` (matched: "When `commandEnv` … is relevant", "When adding unit tests for `adws/gitContext/`"). Read for the #658 design intent and the documented operation-surface commitment. Reference only.
- `app_docs/feature-tcewff-cron-gh-token-bleed-fix.md` — Conditional doc for the `GH_TOKEN` bleed (matched: "When implementing or reviewing any path that calls `activateGitHubAppAuth` or `ensureAppAuthForRepo`"). Read for the failure mode this feature structurally eliminates. Reference only.

### New Files

- `adws/gitContext/__tests__/gitContextOperations.test.ts` — New vitest unit-test file for the operation/spawn behaviour: env injection (token + 4 git-identity vars + `cwd`), parent-`process.env` non-mutation, and two-context isolation. Kept separate from the existing `gitContext.test.ts` (already ~240 lines) so both files stay under the 300-line guideline and pure-computation tests stay distinct from operation tests.

## Implementation Plan

### Phase 1: Foundation

Establish the injectable exec seam without changing any existing behaviour. Add an `ExecFn` type (`(command: string, options: { cwd: string; env: NodeJS.ProcessEnv }) => string`) and an optional `GitContextDeps` interface (`{ exec?: ExecFn }`) to `types.ts`, and export both from `index.ts`. This keeps `GitContextOptions` purely identity/config and matches the ADW `Deps` dependency-injection idiom used across the codebase, giving tests a hermetic seam while the default remains a real `execSync` wrapper.

### Phase 2: Core Implementation

Add the spawn chokepoint and the representative operation to `GitContext`:
- A module-scope `defaultExec: ExecFn` that thinly wraps `execSync(command, { ...options, encoding: 'utf-8' })` and returns the string output. This is the single place in the package that actually spawns.
- An optional second constructor parameter `deps: GitContextDeps = {}`; store `#exec = deps.exec ?? defaultExec`. All existing `new GitContext(options)` call sites keep working unchanged (deps defaults to `{}`).
- A private `#run(command: string): string` that calls `this.#exec(command, { cwd: this.#basePath, env: this.commandEnv(process.env) })` and returns the trimmed result. This is the one method that supplies `cwd` and per-command env; every operation goes through it.
- A public `defaultBranch(): string` that returns `this.#run(\`gh repo view ${this.#owner}/${this.#repo} --json defaultBranchRef --jq .defaultBranchRef.name\`)`. Owner/repo are construction-validated (non-empty, trimmed) by #658's `assertCompleteIdentity`, so the interpolation carries only vetted identity.

### Phase 3: Integration

Prove the path end to end with hermetic unit tests in the new `gitContextOperations.test.ts`, and confirm zero regressions against the existing `gitContext.test.ts` suite. Tests inject a spy exec that records `{ command, cwd, env }` and returns canned stdout, then assert: the child receives the context's token + git identity and `cwd === basePath`; `process.env` is unchanged after the op; and two contexts (different repos/tokens) sharing one spy produce distinct `cwd` + `GH_TOKEN` with no cross-observation. Run the full validation command set last.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Re-read the #658 surface and PRD auth spec

- Read `adws/gitContext/gitContext.ts`, `types.ts`, and `index.ts` to confirm the current `commandEnv()` signature (`commandEnv(base: NodeJS.ProcessEnv = {})`) and the private-field naming (`#basePath`, `#owner`, `#repo`, `#token`, `#gitIdentity`).
- Re-read `specs/prd/git-context-repo-authority.md` **Auth model** (lines 78–79) and **Testing Decisions §1** (lines 93–96) to anchor the contract: per-command env injection, parent global env left unmutated, two-context isolation.
- Confirm the representative-op command shape against `adws/core/targetRepoManager.ts:73`.

### 2. Add the injectable exec seam to `types.ts`

- Add `export type ExecFn = (command: string, options: { cwd: string; env: NodeJS.ProcessEnv }) => string;`.
- Add `export interface GitContextDeps { /** Injectable command runner; defaults to a thin execSync wrapper. */ exec?: ExecFn; }`.
- Do **not** add an `exec` field to `GitContextOptions` — keep options purely identity/config.
- Add JSDoc explaining the seam exists for hermetic testing and standalone-package reuse.

### 3. Export the new types from `index.ts`

- Extend the existing `export type { … } from './types';` line to also export `ExecFn` and `GitContextDeps`, keeping the package's public surface explicit.

### 4. Add the default exec wrapper and deps wiring in `gitContext.ts`

- Import `execSync` from `child_process` and the `ExecFn` / `GitContextDeps` types.
- Add a module-scope `const defaultExec: ExecFn = (command, options) => execSync(command, { ...options, encoding: 'utf-8' });` (returns the captured stdout string).
- Add a second constructor parameter `deps: GitContextDeps = {}` and a `readonly #exec: ExecFn;` field assigned `deps.exec ?? defaultExec`. Place the assignment after `assertCompleteIdentity(options)` so existing construction-validation order is preserved.

### 5. Add the private `#run()` command-runner chokepoint

- Implement `#run(command: string): string` that returns `this.#exec(command, { cwd: this.#basePath, env: this.commandEnv(process.env) }).trim()`.
- Add a JSDoc comment marking it as the single spawn site: explicit `cwd` (base path) + per-command env (token + git identity), never mutating `process.env`.
- Keep the method body flat (no nested conditionals) per the coding guidelines.

### 6. Add the `defaultBranch()` representative operation

- Implement `defaultBranch(): string` returning `this.#run(\`gh repo view ${this.#owner}/${this.#repo} --json defaultBranchRef --jq .defaultBranchRef.name\`)`.
- Add JSDoc: a representative read op proving the spawn-with-env path; identity-driven (explicit owner/repo) and token-injected.

### 7. Write the operation/isolation unit tests (`gitContextOperations.test.ts`)

- Create `adws/gitContext/__tests__/gitContextOperations.test.ts`.
- Add a local `validOptions(overrides)` helper (mirroring `gitContext.test.ts`) and a `makeSpyExec(stdout = 'main\n')` helper returning `{ exec, calls }` where `exec` records `{ command, cwd, env }` into `calls` and returns `stdout`.
- **Env-injection test:** construct a context with a known token + identity and the spy exec; call `defaultBranch()`; assert the recorded `cwd === ctx.basePath`, `env.GH_TOKEN === <token>`, and all four `GIT_AUTHOR_*`/`GIT_COMMITTER_*` values match the injected identity; assert the recorded `command` is the expected `gh repo view <owner>/<repo> …` string.
- **Return-value test:** assert `defaultBranch()` returns the trimmed stdout (`'main'`).
- **Parent-env-non-mutation test:** snapshot `process.env.GH_TOKEN`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` before; run `defaultBranch()`; assert each is byte-identical after (use an `afterEach` to restore, mirroring `gitContext.test.ts`'s `commandEnv` block).
- **Two-context isolation test:** build `ctxA` (owner/repo/token A) and `ctxB` (owner/repo/token B) sharing **one** spy exec; call `defaultBranch()` on each; assert the two recorded calls have distinct `cwd` (each equal to its own `basePath`) and distinct `env.GH_TOKEN` (each equal to its own token), and that neither call's env carries the other's token — the cross-contamination is impossible.
- **Ambient-bleed test (edge):** set `process.env.GH_TOKEN` to a sentinel stale value, construct a context with a different token + the spy exec, run `defaultBranch()`; assert the child env carried the *context* token (overlay wins) and `process.env.GH_TOKEN` is still the untouched sentinel afterward.
- **Error-propagation test (edge):** inject an exec that throws; assert `defaultBranch()` propagates the error (system-boundary behaviour) and still does not mutate `process.env`.

### 8. Run the validation commands

- Run every command in the **Validation Commands** section below and confirm all pass with zero regressions (lint, type-check on both tsconfigs, full unit suite, build), plus the scoped `bunx vitest run adws/gitContext` to confirm the new and existing GitContext tests are green together.

## Testing Strategy

### Unit Tests

Unit tests are **enabled** (`.adw/project.md` → `## Unit Tests: enabled`; framework: vitest; glob `adws/**/__tests__/**/*.test.ts`). All new tests live in `adws/gitContext/__tests__/gitContextOperations.test.ts` and are hermetic — they inject a spy exec, never spawning a real git/`gh` process or hitting the network (mirroring the PRD prior art: the GitHub-API suites that "test operation behaviour without hitting the network", and the `commitOperations`/`worktreeReset` exec-spy pattern).

Tests to write (detailed in Step 7):
- **Env injection** — the representative op supplies `cwd === basePath` and an env carrying the context's `GH_TOKEN` and all four `GIT_*` identity vars to the child; the spawned command string is the expected `gh repo view <owner>/<repo> …`.
- **Return value** — the op returns the trimmed child stdout.
- **Parent-env non-mutation** — `process.env` (`GH_TOKEN` + the four `GIT_*` vars) is byte-identical before and after an operation runs.
- **Two-context isolation** — two contexts for two repos sharing one process/one spy produce distinct `cwd` and `GH_TOKEN` per call and never observe each other's token.
- **Ambient-bleed resistance** (edge) — a stale `process.env.GH_TOKEN` is overridden in the child by the context token and remains untouched in the parent.
- **Error propagation** (edge) — an exec that throws surfaces the error at the boundary without mutating `process.env`.

The existing `adws/gitContext/__tests__/gitContext.test.ts` (base-path, identity validation, worktree-path, `commandEnv`) must continue to pass unchanged — this slice only *adds* surface.

### Edge Cases

- A stale/wrong `process.env.GH_TOKEN` set by the legacy `githubAppAuth.ts` path is present when a context op runs → the child still receives the context's token (overlay wins) and `process.env` is left as-is.
- The child command exits non-zero / `execSync` throws (e.g. `gh` unauthenticated, network down) → the operation surfaces a meaningful error at the system boundary and does not mutate `process.env`.
- Two contexts constructed for the **same** `owner/repo` but **different** tokens → each op carries its own token (no module-global pinning, unlike `activeRepo`).
- `commandEnv(process.env)` must inherit `PATH` etc. so the child can locate the `gh`/`git` binaries, while still overlaying the auth/identity vars into a fresh object (no parent mutation) — assert an unrelated inherited key (e.g. `PATH`) survives in the child env.
- Child stdout has trailing whitespace/newline → the op returns the trimmed value.

## Acceptance Criteria

- [ ] `GitContext` exposes at least one operation method (`defaultBranch()`) that spawns its git/`gh` command with an explicit `cwd` (the context base path) and a per-command child env carrying the token + git author/committer identity (via the private `#run()` chokepoint using `commandEnv(process.env)`).
- [ ] The operation hot path never mutates the parent `process.env` for auth (no `process.env.GH_TOKEN = …`, no `GIT_*` assignment); auth is supplied only through the spawned command's `env`.
- [ ] The representative op runs through the context with the expected token/author env supplied to the child process, asserted by a hermetic spy-exec test.
- [ ] Test present and passing: parent global env (`GH_TOKEN` + four `GIT_*` vars) is left unmutated after an operation runs.
- [ ] Test present and passing: two contexts for two repos in one process never observe each other's `cwd` or token (isolation).
- [ ] `githubAppAuth.ts` is **not** modified (legacy global path retained for unmigrated callers; see Notes).
- [ ] `GitContextOptions` is unchanged (identity/config only); the exec seam lives in a separate optional `GitContextDeps` parameter.
- [ ] All existing `adws/gitContext/__tests__/gitContext.test.ts` tests still pass.
- [ ] Lint, both type-checks, the full unit suite, and the build all pass with zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Run from the repository root.

- `bun run lint` — ESLint over the codebase (`eslint .`); zero new errors.
- `bunx tsc --noEmit` — Root type-check (the project's `test` script); zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional `adws/` type-check (per `.adw/commands.md`); zero errors.
- `bunx vitest run adws/gitContext` — Scoped run of the new `gitContextOperations.test.ts` plus the existing `gitContext.test.ts`; all green.
- `bun run test:unit` — Full vitest unit suite (`vitest run`); zero regressions across the repo.
- `bun run build` — Production build (`tsc`); compiles cleanly.

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`) are in force: clarity over cleverness; single-responsibility files **under 300 lines** (hence the new sibling test file); **immutability** (`commandEnv` returns a fresh object; `process.env` is never written); **purity / side-effects at the edges** (the lone side effect — spawning — is isolated to `#run()`/`defaultExec`); **type safety** (no `any`; `ExecFn` is explicitly typed); guard-clause/early-return style with max ~2 nesting depth.
- **Scope — `githubAppAuth.ts` is intentionally not touched.** The issue's "What to build" frames the per-command env as *replacing* the `process.env.GH_TOKEN` mutation and module-global `activeRepo`. This slice establishes and proves the replacement *mechanism* on the context's operation path; it does not delete the legacy globals, because many existing `execSync('gh …')` call sites still read `process.env.GH_TOKEN`. Wholesale migration of those call sites onto the context (and the eventual removal of the legacy mutation) is later-slice work per the PRD's staged operation surface and `gitContext.ts`'s own header comment ("the full git/gh operation surface … to be implemented in later slices"). The acceptance criteria scope the guarantee precisely to the *operation hot path*.
- **Token acquisition is unchanged** (PRD Out of Scope, line 116). `getInstallationToken(owner, repo)` in `githubAppAuth.ts` still mints/refreshes App installation tokens; only how the token is *applied* (per-command env vs process-global) changes. Wiring the minted token into a context at each process's launch boundary is a separate later slice (PRD "Boundary constructors").
- **Why an injectable exec rather than `vi.mock('child_process')`.** The `Deps` injection idiom (used by `JanitorDeps`, `MergeDeps`, `ReconcileDeps`, `UpgradeDeps`) makes the two-context isolation assertion clean — one spy shared across two contexts captures per-call `{ cwd, env }` directly — and keeps the package standalone/reusable (PRD "Reuse", lines 123). Module-mocking `execSync` globally is brittle and obscures per-context capture; it is the inferior alternative here.
- **`execSync` (not `execFileSync`) for convention-consistency.** `execSync(cmd, { cwd, env })` is the dominant ADW idiom (221 call sites) and matches the representative-op precedent exactly. Owner/repo are construction-validated identity (non-empty, trimmed), so the command interpolation carries only vetted values. Migrating the package to arg-array `execFileSync` for defence-in-depth is a reasonable future hardening but is out of scope here ("Keep it simple").
- **CI/lint enforcement guard** (PRD Enforcement, lines 81–82 — fail the build on any direct `git`/`gh` spawn outside the package) ships as a separate CI rule and was explicitly **not** selected for unit testing; it is not part of this slice. Centralising all spawning behind `#run()`/`defaultExec` is what makes that future guard enforceable.
- **No new libraries.** `child_process` is a Node built-in. Library install command, if ever needed: `bun add <package>` (per `.adw/commands.md`).
- **Future operations** (worktree create/remove/reset/list, branch, commit/push, fetch/reset, issue/PR/label/board ops) become additional methods that all funnel through `#run()`, inheriting the same `cwd` + per-command-env guarantee proven by this slice.
