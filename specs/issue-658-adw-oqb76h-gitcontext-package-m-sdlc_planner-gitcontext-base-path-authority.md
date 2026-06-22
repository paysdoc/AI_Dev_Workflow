# Feature: GitContext package — mandatory identity + base-path authority

## Metadata
issueNumber: `658`
adwId: `oqb76h-gitcontext-package-m`
issueJson: `{"number":658,"title":"GitContext package: mandatory identity + base-path authority","body":"## Parent PRD\n\n`specs/prd/git-context-repo-authority.md`\n\n## What to build\n\nThe foundational slice: a new **standalone, importable package** housing the `GitContext` deep module. A `GitContext` is constructed from an explicit identity — `owner`, `repo`, a self-host discriminator, the auth token, and the git author/committer identity — and is the single place that decides \"which repo's filesystem.\"\n\nBase-path resolution lives **only** in this constructor: self-host resolves to the framework repo root; target resolves to the target-repos workspace for that `owner/repo` (mirroring `core/targetRepoManager.ts`'s `getTargetRepoWorkspacePath`). There is **no optional base path and no `cwd` fallback** — incomplete identity is a hard construction error.\n\nThis slice ships the interface and the resolution authority (a `basePath` accessor and a `worktreePathFor(branch)` method that computes under the context's base path, not ambient cwd). It does not yet migrate call sites — those are later slices — but it is verifiable standalone via unit tests. The package must not depend on ADW-specific globals (identity/config injected at construction) so future projects can import it (stories 19, 20).\n\nThis is the deep-module API commitment everything else threads through; HITL so the public interface is reviewed once before merge.\n\n## Acceptance criteria\n\n- [ ] New package exposes `GitContext` + a single constructor; no context-free git/`gh` free functions\n- [ ] Constructor requires `owner`, `repo`, self-host flag, token, git author/committer identity; **no** optional base-path param, no cwd fallback\n- [ ] Constructing with incomplete identity throws a clear, loud error (story 23)\n- [ ] Self-host identity resolves `basePath` to the framework repo root; target identity resolves to the target-repos workspace for `owner/repo` (stories 21, 22)\n- [ ] Base-path resolution exists in exactly one place (the constructor) — no other code re-derives it (story 6)\n- [ ] `worktreePathFor(branch)` computes under the context base path, not ambient cwd\n- [ ] Package has no dependency on ADW globals; identity/config injected at construction (stories 19, 20)\n- [ ] Unit tests mirror `providers/__tests__/repoContext.test.ts` / `vcs/__tests__/worktreeReset.test.ts`: per-identity base-path selection, incomplete-identity failure, worktree-path-under-base\n\n## Blocked by\n\nNone - can start immediately.\n\n## User stories addressed\n\n- User story 6\n- User story 19\n- User story 20\n- User story 21\n- User story 22\n- User story 23\n- #671","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-06-21T10:20:01Z"}`

## Feature Description

Introduce a new, self-contained module — the **`GitContext` deep module** — that is the single authority for answering *"which repository's filesystem am I operating on?"*. A `GitContext` is constructed exactly once, at a process launch boundary, from an explicit, mandatory identity: `owner`, `repo`, a `selfHost` discriminator, the auth `token`, and the git author/committer identity. From that identity it resolves — **in the constructor, and nowhere else** — a single `basePath`:

- **self-host** → the framework repo root (the directory ADW itself lives in), mirroring `environment.ts`'s `REPO_ROOT`;
- **target** → the target-repos workspace for that `owner/repo`, mirroring `core/targetRepoManager.ts`'s `getTargetRepoWorkspacePath(owner, repo)`.

There is **no optional base-path parameter and no `cwd` fallback**. Constructing a context with incomplete identity throws a clear, loud error instead of silently defaulting to the framework repo (the historical detonation point). The module ships two pieces of resolution authority this slice: a `basePath` accessor and a `worktreePathFor(branch)` method that always computes worktree paths under the context's `basePath` (mirroring the `.worktrees/{sanitized-branch}` layout from `vcs/worktreeOperations.ts`'s `getWorktreePath`) — never from `process.cwd()`. It also carries the token + git identity privately and can produce a per-command child-process environment overlay without mutating the parent process's global environment, laying the foundation for the per-command auth model the parent PRD mandates.

The module depends on **no ADW-specific globals** — all identity and configuration (the framework repo root and the target-repos directory) are injected at construction — so it satisfies the PRD's reuse goal (a future project can import the same mechanism). This slice deliberately does **not** migrate any existing call sites; it ships and unit-tests the API surface and resolution authority standalone. Because this is the deep-module API everything else will thread through, the public interface is reviewed once (HITL) before merge.

## User Story

As an **ADW maintainer**
I want **a single deep module that decides "which repo's filesystem," constructed from a mandatory identity with base-path resolution living in exactly one constructor (no optional base path, no `cwd` fallback)**
So that **worktree/`cwd` resolution can no longer silently default to the wrong repository, and a new call site cannot reintroduce the wrong-repo class of bug.**

Supporting stories from the PRD: 6 (one base-path decision in one constructor), 19 (importable by future projects), 20 (deep module, simple interface), 21 (self-host → framework root), 22 (target → target workspace), 23 (clear failure on incomplete identity).

## Problem Statement

Today, "which repo's filesystem" is derived ad hoc at every call site. The worktree base path is computed by `vcs/worktreeOperations.ts`'s `getWorktreePath(branchName, baseRepoPath?)` / `getWorktreesDir(baseRepoPath?)`, where `baseRepoPath` is **optional** and silently defaults — via `getMainRepoPath()` — to the ambient repo discovered from the current process. Because ADW dogfoods itself, the default is *correct* in the most-exercised self-host path and only detonates against target repos, so the bug ships and then fails in production. Mining the history surfaces ~13 distinct fix episodes of this exact shape (wrong-repo worktree discovery, wrong PR-review target, "thread the base path through these callers"). A prior centralization attempt (extracting branch-name assembly, threading an *optional* base-path parameter through *some* callers) did not hold: it centralized the computation while leaving an optional defaulting parameter reachable, and a newer call site (orchestrator takeover) re-introduced the same defect and stranded a real production issue in an unrecoverable retry loop. The root cause is that the authoritative identity is neither **mandatory** nor resolved in **exactly one place**.

## Solution Statement

Ship the foundational slice of the parent PRD (`specs/prd/git-context-repo-authority.md`): a new self-contained module, `adws/gitContext/`, exposing a `GitContext` class with a single options-object constructor. The constructor:

1. **Requires** a complete identity — `owner`, `repo`, `selfHost`, `token`, and a `gitIdentity` (author + committer name/email) — plus the injected resolution config (`frameworkRepoRoot`, `targetReposDir`). Any missing/empty field throws a clear, loud `Error` (story 23). There is no optional base-path parameter and no `cwd` fallback.
2. **Resolves `basePath` once**, in a single module-private helper called only by the constructor: `selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)` (story 6, 21, 22). No other code re-derives it.
3. Exposes a read-only `basePath` accessor and a `worktreePathFor(branch)` method that returns `join(basePath, '.worktrees', sanitize(branch))` — under the context base path, never `process.cwd()`.
4. Carries `token` + `gitIdentity` as private fields and exposes `commandEnv(base?)`, a pure overlay that returns a **new** environment object carrying `GH_TOKEN` and the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` variables, **without mutating `process.env`** — the foundation for the PRD's per-command auth model (and the second core property the PRD wants demonstrated from day one).

The module imports nothing from `adws/core`, `adws/providers`, or any ADW global; the framework root and target-repos directory are injected by the caller (stories 19, 20). The public surface (a barrel `index.ts`) exports only the `GitContext` class and its types — **no context-free git/`gh` free functions**. Migrating existing call sites, implementing the full git/`gh` operation surface, and the CI guard that bans raw `git`/`gh` are explicitly later slices and out of scope here. The slice is verified standalone with unit tests that mirror the cited prior-art tests.

## Relevant Files

Use these files to implement the feature:

### Existing files to reference (read; not all modified)

- `specs/prd/git-context-repo-authority.md` — The parent PRD. The authoritative contract for this slice: mandatory identity, one-constructor base-path resolution, per-command auth (no process-global mutation), deep-module bet, reuse-as-package goal, and the "Testing Decisions" that this plan's tests must satisfy.
- `adws/core/targetRepoManager.ts` — `getTargetRepoWorkspacePath(owner, repo)` returns `join(TARGET_REPOS_DIR, owner, repo)`. The **target** base-path formula `GitContext` must mirror exactly.
- `adws/core/environment.ts` — `REPO_ROOT` (framework repo root, derived from file location, independent of `process.cwd()`) is the **self-host** base path the caller will inject as `frameworkRepoRoot`; `TARGET_REPOS_DIR` is the value injected as `targetReposDir`. `SAFE_ENV_VARS` / `getSafeSubprocessEnv()` show the env-overlay pattern and the exact `GH_TOKEN` / `GIT_AUTHOR_*` / `GIT_COMMITTER_*` variable names `commandEnv()` must set. (Reference only — the package must **not** import these globals; the caller injects their values.)
- `adws/vcs/worktreeOperations.ts` — `getWorktreePath`, `getWorktreesDir`, and the private `sanitizeBranchName` regex (`/[/\\:*?"<>|`]/g → '-'`) plus the `.worktrees` directory layout that `worktreePathFor` must reproduce under `basePath`. This is the **optional-base-path helper the new authority supersedes** — note its `baseRepoPath?` defaulting to `getMainRepoPath()` is precisely the unsafe default being removed.
- `adws/providers/repoContext.ts` — `createRepoContext` (factory + `Object.freeze`), `validateRepoIdentifier` usage, and the throw-on-invalid validation style to mirror for construction-time failure.
- `adws/providers/types.ts` — `RepoIdentifier`, `validateRepoIdentifier` (the loud-throw-on-empty-field pattern), and the `Readonly<{...}>` immutable-context shape to mirror for the `GitContext` types.
- `adws/providers/__tests__/repoContext.test.ts` — Test style to mirror: `describe`/`it` blocks grouped by case, deterministic input→output assertions, an `edge cases` group. Prior art cited by the acceptance criteria.
- `adws/vcs/__tests__/worktreeReset.test.ts` — Prior art cited by the acceptance criteria: deterministic, pure assertions and explicit "throws on failure" cases (`expect(() => ...).toThrow(/.../)`). Mirror its loud-failure assertion style for the incomplete-identity tests.
- `adws/github/githubAppAuth.ts` — `configureGitIdentity()` shows the exact env var names and bot identity model (`GIT_AUTHOR_NAME/EMAIL`, `GIT_COMMITTER_NAME/EMAIL`, `GH_TOKEN`) that `commandEnv()` overlays. The process-global `process.env.GH_TOKEN = token` mutation here is exactly what the context's per-command overlay replaces.
- `adws/vcs/index.ts` — Barrel re-export convention to mirror for `adws/gitContext/index.ts`.

### Conditional docs (matched conditions in `.adw/conditional_docs.md`)

- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — Matches "adding new git operations that must target an external target repository", "worktree creation … in target repo workflows", "modifying … `targetRepoManager.ts`". Background on the target-repo base-path class.
- `app_docs/feature-1773073902212-9l2nv9-repo-context-factory.md` — Matches "working with `RepoContext`, `createRepoContext`, or `adws/providers/repoContext.ts`" and "workflow entry points that need validated repo context". The construction-from-identity precedent this slice generalizes.
- `app_docs/feature-ie8l08-fix-pr-review-target-repo.md` — Matches "the 'wrong repository' class of bugs (#23, #33, #52, #56, #62, #119, #217, #223)" and "`ensureWorktree` called without `baseRepoPath`". The exact failure class `GitContext` makes unrepresentable.

### New Files

- `adws/gitContext/types.ts` — Public type surface: `GitIdentity` (author/committer name+email), `GitContextOptions` (the single constructor's input: `owner`, `repo`, `selfHost`, `token`, `gitIdentity`, `frameworkRepoRoot`, `targetReposDir`).
- `adws/gitContext/gitContext.ts` — The `GitContext` class (single constructor), the module-private `resolveBasePath(options)` (the one and only base-path decision), the module-private `assertCompleteIdentity(options)` loud validation, the private `sanitizeBranchName`, and the public `basePath` accessor, `worktreePathFor(branch)`, `commandEnv(base?)`, plus read-only `owner`/`repo`/`selfHost` accessors.
- `adws/gitContext/index.ts` — Barrel: exports `GitContext` and the public types only. No git/`gh` free functions.
- `adws/gitContext/__tests__/gitContext.test.ts` — Unit tests mirroring the cited prior art.

## Implementation Plan

### Phase 1: Foundation
Create the self-contained module directory `adws/gitContext/` with a clean public surface and zero imports from ADW globals. Define the public types (`GitIdentity`, `GitContextOptions`) in `types.ts`, mirroring the immutable, explicit-shape style of `providers/types.ts`. This establishes the deep-module API commitment (HITL-reviewed) before any logic.

### Phase 2: Core Implementation
Implement the `GitContext` class in `gitContext.ts`:
- A single options-object constructor that first calls `assertCompleteIdentity` (loud throw on any missing/empty field) then resolves and stores `basePath` via the single private `resolveBasePath` helper.
- `resolveBasePath` is the **only** place the self-host-vs-target decision lives: `selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`.
- Read-only accessors (`basePath`, `owner`, `repo`, `selfHost`); `worktreePathFor(branch)` computing `join(basePath, '.worktrees', sanitize(branch))`; `commandEnv(base?)` returning a fresh env overlay with `GH_TOKEN` + `GIT_*` and never touching `process.env`.
Keep the file under the 300-line guideline and use guard clauses (validate-and-throw first) per the coding guidelines.

### Phase 3: Integration
Wire the barrel `index.ts` to export only `GitContext` and its public types. No existing call sites are migrated in this slice (later slices). Confirm the module type-checks under both the root and `adws/` tsconfigs and that it pulls in no ADW global (verified by inspection + the no-import discipline). Add unit tests and run the full validation suite for zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Create the module directory and public types (`adws/gitContext/types.ts`)
- Create `adws/gitContext/`.
- Define and export `interface GitIdentity { authorName: string; authorEmail: string; committerName: string; committerEmail: string }`.
- Define and export `interface GitContextOptions { owner: string; repo: string; selfHost: boolean; token: string; gitIdentity: GitIdentity; frameworkRepoRoot: string; targetReposDir: string }` with JSDoc on each field. Document that `frameworkRepoRoot` and `targetReposDir` are injected (so the package depends on no ADW globals) — the caller passes `environment.ts`'s `REPO_ROOT` and `TARGET_REPOS_DIR` respectively.
- Add a file-level JSDoc stating the deep-module contract: identity in, repo-scoped operations out; base-path resolution lives only in the constructor; no optional base path, no `cwd` fallback.

### 2. Implement base-path resolution and validation (`adws/gitContext/gitContext.ts`)
- Import only Node built-ins (`path`) and the local `./types`. Import nothing from `adws/*`.
- Add module-private `assertCompleteIdentity(options: GitContextOptions): void`: guard-clause throws (clear `GitContext: ...` messages) for empty/whitespace `owner`, `repo`, `token`, each `gitIdentity` field, `frameworkRepoRoot`, and `targetReposDir`, **and for an omitted/non-boolean `selfHost` discriminator** (`typeof options.selfHost !== 'boolean'`, so a missing flag throws while both `true` and `false` are accepted — story 23 / AC2 list the self-host flag as a mandatory field). Mirror `validateRepoIdentifier`'s loud style.
- Add module-private `resolveBasePath(options: GitContextOptions): string` — the **single** self-host-vs-target decision: `selfHost ? frameworkRepoRoot : path.join(targetReposDir, owner, repo)`. This is the only base-path derivation in the module.
- Add module-private `sanitizeBranchName(branch: string): string` reproducing `worktreeOperations.ts`'s regex (`/[/\\:*?"<>|`]/g` → `'-'`).

### 3. Implement the `GitContext` class (`adws/gitContext/gitContext.ts`)
- `export class GitContext` with `readonly` private fields for the resolved `basePath`, `owner`, `repo`, `selfHost`, `token`, and `gitIdentity`.
- Constructor `(options: GitContextOptions)`: call `assertCompleteIdentity(options)` first, then set fields, computing `basePath` via `resolveBasePath(options)`.
- Public read-only accessors: `get basePath()`, `get owner()`, `get repo()`, `get selfHost()`.
- `worktreePathFor(branch: string): string` — throw on empty `branch`; return `path.join(this.basePath, '.worktrees', sanitizeBranchName(branch))`. Must not reference `process.cwd()`.
- `commandEnv(base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv` — return a **new** object: `{ ...base, GH_TOKEN: token, GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL }` from the stored identity. Do not mutate `base` or `process.env`.
- Keep the public surface git/`gh`-free; add a class JSDoc noting the full git/`gh` operation surface (worktree create/remove/reset/list, branch, commit/push, issue/PR/`gh`) is the documented API commitment to be implemented in later slices.

### 4. Add the barrel (`adws/gitContext/index.ts`)
- Re-export `GitContext` from `./gitContext` and `GitIdentity`, `GitContextOptions` from `./types`. Export nothing else (no free functions). Add a module JSDoc describing it as the standalone, importable public surface.

### 5. Write unit tests (`adws/gitContext/__tests__/gitContext.test.ts`)
- Mirror the `describe`/`it` grouping and deterministic-assertion style of `repoContext.test.ts`, and the `toThrow(/.../)` loud-failure style of `worktreeReset.test.ts`. Use a shared `validOptions()` helper returning a complete `GitContextOptions` (self-host and target variants).
- **Base-path selection** group: self-host → `basePath === frameworkRepoRoot`; target → `basePath === path.join(targetReposDir, owner, repo)`.
- **Incomplete identity** group: each of empty `owner`, empty `repo`, an omitted/non-boolean `selfHost` discriminator (e.g. `undefined`), empty `token`, each empty `gitIdentity` field, empty `frameworkRepoRoot`, empty `targetReposDir` → `expect(() => new GitContext(...)).toThrow(/GitContext/)`. (The discriminator case backs scenario §3's `the self-host/target discriminator` row.)
- **worktree-path-under-base** group: self-host `worktreePathFor('feature-x')` === `join(frameworkRepoRoot, '.worktrees', 'feature-x')`; target `worktreePathFor('feature/issue-1-x')` sanitizes the slash and nests under the target workspace `.worktrees`; assert the result is unaffected by `process.cwd()` (compute an expected path from `basePath` only); empty branch throws.
- **Isolation** group: two contexts (one self-host, one target with a different `owner/repo`) constructed in the same test resolve distinct `basePath`/`worktreePathFor` values and distinct `commandEnv().GH_TOKEN`.
- **commandEnv** group: result carries the token + all four `GIT_*` vars; `process.env.GH_TOKEN` is unchanged after the call; a passed `base` object is not mutated and its unrelated keys are preserved.

### 6. Run the validation commands
- Run every command in `## Validation Commands` and confirm all pass with zero regressions (lint clean, both tsconfigs type-check, full `vitest run` green including the new file, build succeeds).

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, and the issue explicitly requires unit tests mirroring `providers/__tests__/repoContext.test.ts` and `vcs/__tests__/worktreeReset.test.ts`. Tests live in `adws/gitContext/__tests__/gitContext.test.ts` (auto-discovered by `vitest.config.ts`'s `adws/**/__tests__/**/*.test.ts` glob) and are pure — no network, no real git, no `child_process` (the implemented surface is pure path/string/env computation, so unlike `worktreeReset.test.ts` no `execSync` mock is needed). They assert **external, observable behaviour** (the resolved base path per identity, the worktree path under that base, the env overlay produced, and loud failure on incomplete identity) per the PRD's Testing Decisions — not internal call structure. Coverage:

- Per-identity base-path selection (self-host → framework root; target → target workspace).
- Incomplete-identity construction failure (every required field, loud throw).
- Worktree-path-under-base, including branch sanitization and `process.cwd()`-independence.
- Per-command env overlay carries token + git identity and leaves `process.env` and the passed base object unmutated.
- Two-context isolation in one process.

### Edge Cases
- Empty or whitespace-only `owner`, `repo`, `token`, or any `gitIdentity` field → loud construction error.
- Omitted or non-boolean `selfHost` discriminator → loud construction error (mirrors scenario §3's discriminator case).
- Empty `frameworkRepoRoot` (self-host) or `targetReposDir` (target) injected config → loud construction error.
- Branch names containing `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, or backtick → sanitized to `-` in `worktreePathFor`.
- Empty `branch` passed to `worktreePathFor` → throws.
- `worktreePathFor` invoked from a different `process.cwd()` → identical result (path derived only from `basePath`).
- `commandEnv` called twice / with a shared base object → returns fresh objects, no cross-contamination, `process.env` never written.
- Self-host and target contexts sharing the same `owner/repo` resolve different `basePath` values (discriminator, not identity, selects the base).

## Acceptance Criteria
- The new module `adws/gitContext/` exposes a `GitContext` class via a single options-object constructor and a barrel `index.ts`; the public surface contains **no** context-free git/`gh` free functions.
- The constructor requires `owner`, `repo`, `selfHost`, `token`, and `gitIdentity` (author + committer name/email); there is **no** optional base-path parameter and **no** `cwd` fallback.
- Constructing with any missing/empty identity or injected-config field — including an omitted self-host/target discriminator — throws a clear, loud `Error` (story 23), verified by tests.
- Self-host identity resolves `basePath` to the injected framework repo root; target identity resolves to `join(targetReposDir, owner, repo)` (stories 21, 22), verified by tests.
- Base-path resolution exists in exactly one place — the constructor's single `resolveBasePath` helper — and no other code in the module re-derives it (story 6).
- `worktreePathFor(branch)` returns a path under `basePath` (`.../.worktrees/{sanitized-branch}`) and never consults `process.cwd()`, verified by tests.
- The module imports nothing from `adws/core`, `adws/providers`, or any ADW global; `frameworkRepoRoot` and `targetReposDir` are injected at construction (stories 19, 20).
- Unit tests mirror the cited prior art and cover per-identity base-path selection, incomplete-identity failure, and worktree-path-under-base.
- All validation commands pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands sourced from `.adw/commands.md`.

- `bun run lint` — ESLint clean across the new module (no unused vars, `prefer-const`, etc.).
- `bunx tsc --noEmit` — Root type-check passes (root `tsconfig.json` includes `**/*.ts`, so the new module is covered).
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional `adws/` project type-check passes (declaration/sourcemap build settings).
- `bun run test:unit` — Full `vitest run` is green, including the new `adws/gitContext/__tests__/gitContext.test.ts`.
- `bunx vitest run adws/gitContext` — Targeted run of just the new suite passes (fast feedback; the new tests cover base-path selection, incomplete-identity failure, worktree-path-under-base, env-overlay isolation).
- `bun run build` — `tsc` build succeeds with no errors.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): single-responsibility files under ~300 lines; immutability (`readonly` fields, no setters; `commandEnv` returns fresh objects and never mutates inputs or `process.env`); guard clauses / early throws over nested conditionals; explicit types and enums-over-magic-values; isolate side effects (this module is pure path/string/env computation — no I/O — which is what makes it cheaply unit-testable).
- **No new libraries required.** The module uses only the Node `path` built-in and `@types/node` (already a dev dependency). If a dependency ever becomes necessary, the install command per `.adw/commands.md` is `bun add <package>`.
- **"Package" interpretation.** The repo has no workspace/monorepo tooling configured (`package.json` is a single `private` package, no `workspaces`). To match existing conventions and get lint/type-check/test coverage for free (vitest globs `adws/**/__tests__`, both tsconfigs include `adws/`), the module ships as a self-contained directory `adws/gitContext/` with its own barrel and **zero imports from ADW globals**. The "standalone, importable package" guarantee is satisfied structurally by the no-ADW-dependency discipline (config injected at construction), making a future literal extraction to `packages/git-context/` a mechanical move rather than a rewrite. Physical workspace extraction is deferred (not required by this slice's acceptance criteria).
- **Deliberately out of scope (later slices / separate stories):**
  - Migrating existing call sites (`worktreeOperations.ts` callers, takeover, PR-review, webhook) to the context — later slices; the optional-base-path helpers remain until then.
  - Implementing the full git/`gh` operation surface (worktree create/remove/reset/list, branch, commit/push, issue/PR/label/board) as context methods — later slices. This slice ships the interface commitment + base-path/worktree/env resolution authority only.
  - The CI/lint guard that fails the build on any direct `exec`/`spawn` of `git`/`gh` outside the package (PRD story 8) — shipped later as a CI rule; explicitly not unit-tested per the PRD.
  - Identity persistence into top-level workflow state and the resume cross-check (PRD stories 13, 14) — later slice.
- **Why this won't regress like the prior centralization:** identity is **mandatory** (no optional base, no `cwd` fallback), base-path resolution is in **exactly one** constructor helper, and the public surface exposes no context-free git/`gh`. The unsafe `getWorktreePath(branch, baseRepoPath?)` default-to-`getMainRepoPath()` path is *not reachable* through `GitContext`.
- **HITL:** this is a deep-module API commitment everything threads through; the issue is gated for human review of the public interface before merge. Keep the constructor/options shape and the `basePath`/`worktreePathFor`/`commandEnv` signatures stable and minimal.
