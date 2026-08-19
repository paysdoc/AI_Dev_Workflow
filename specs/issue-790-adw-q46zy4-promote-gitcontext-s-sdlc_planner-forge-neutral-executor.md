# Feature: GitContext exposes one public, forge-neutral executor

## Metadata
issueNumber: `790`
adwId: `q46zy4-promote-gitcontext-s`
issueJson: `{"number":790,"title":"Promote GitContext spawn chokepoint to public forge-neutral executor","body":"## Parent PRD\n\nspecs/prd/gitcontext-forge-agnostic-refactor.md\n\n## What to build\n\nPromote the private spawn chokepoint to the core's public forge-neutral primitive: one `exec` entry taking a command, a working-directory class (target workspace vs framework root — preserving the existing repo-API cwd contract from #775), a per-command credential environment, and optional stdin. All internal git/gh operations route through it. The missing-working-directory ENOENT rewrap stays inside. No forge semantics: the executor must not know what the command means. The GitHub-specific `usePat` flag remains functional in this slice (it leaves in the TokenProvider slice) but must not leak into the new public signature.\n\nSee PRD sections: Implementation Decisions (Disciplined executor), Testing Decisions (Executor).\n\nHITL rationale: this API is the foundation every later slice builds on — human review of the signature before dependents land.\n\n## Acceptance criteria\n\n- [ ] Public executor accepts command + cwd-class + credential env + optional stdin; no GitHub-specific parameters in its signature\n- [ ] Repo-independent commands still run from the framework root (existing repoApiCwd behavior unchanged)\n- [ ] ENOENT rewrap still produces the actionable error naming path and repo identity\n- [ ] All existing GitContext operations route through the executor; full unit suite green\n- [ ] Extended tests assert executed command, env, and cwd via the injected exec fake; no process.env mutation\n\n## Blocked by\n\nNone - can start immediately\n\n\n- #798\n## Touched Files\n\n- adws/gitContext/gitContext.ts\n- adws/gitContext/types.ts\n- adws/gitContext/__tests__/gitContext.test.ts\n- adws/gitContext/__tests__/repoApiCwd.test.ts\n\n## User stories addressed\n\n- User story 10\n- User story 16\n- User story 22","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-08-14T12:18:15Z","comments":[{"author":"paysdoc","createdAt":"2026-08-19T11:55:19Z","body":"## continue"}],"actionableComment":null}`

## Feature Description

`GitContext` already owns every git and `gh` spawn in the codebase, and it owns four disciplines around that spawn: an explicit working directory (never `process.cwd()`), a per-command credential/identity environment (never a `process.env` mutation), a rewrap of the missing-working-directory `ENOENT` into an actionable error, and a single 10 MB-buffered spawn site. Today those disciplines are reachable **only from inside the class**, through the private `#run` (`adws/gitContext/gitContext.ts:168-179`) and `#runRepoApi` (`:192-194`) chokepoints.

This slice promotes that chokepoint to the core's **public, forge-neutral primitive**:

```ts
exec(command: string, options: ExecOptions): string
```

where `ExecOptions` is `{ cwd: ExecWorkingDirectory; env: NodeJS.ProcessEnv; input?: string }` and `ExecWorkingDirectory` is the discriminated union `{ kind: 'workspace'; path?: string } | { kind: 'frameworkRoot' }`. Nothing in that signature knows what a command *means*: no `usePat`, no token selection, no `--repo` awareness, no issue/PR/label vocabulary.

The two private chokepoints survive as three-line **classifiers** over the public executor — `#run` says "this command is workspace-scoped", `#runRepoApi` says "this command carries its own repository identity and runs from the framework root" (#775's contract). They keep the GitHub-specific `usePat` flag, which the issue explicitly says stays functional in this slice and leaves in the TokenProvider slice (#791). All 45 `#run` and 38 `#runRepoApi` call sites are untouched, and every one of them still reaches exactly one spawn site — now a public one.

The value is entirely downstream: #792 (the GitHub forge adapter) can feed command strings into the core's executor instead of reimplementing spawn discipline (PRD story 11), and #793/Phase B can publish a core whose public API is git + worktree + workspace + executor with no GitHub machinery attached (PRD story 20).

## User Story

As the GitContext core (and the GitHub forge adapter that will be built on top of it)
I want a single public, disciplined executor that takes a command, a working-directory class, a credential environment, and optional stdin
So that credential-environment assembly, working-directory resolution, and missing-directory error rewrapping live in exactly one place that forge adapters can *use* rather than *reimplement*

Parent PRD user stories addressed: **10** (single disciplined executor for all child-process spawns), **16** (repo-independent forge API commands keep running from the framework root), **22** (executor testable through an injected exec fake — assert command, env and cwd without touching a real repository).

## Problem Statement

The PRD's next slice (#792) consolidates every `gh` command builder, GitHub App auth, token resolution and identity derivation into a GitHub forge adapter that lives **outside** the core. That adapter has to spawn processes. Today it has exactly two options, and both are bad:

1. **Add another method to `GitContext`.** This is precisely the disease the PRD is curing — it is how the class grew ~38 forge-semantic methods and how ~20 consumer modules learned to bypass the provider layer.
2. **Spawn its own child processes.** This duplicates cwd resolution, per-command env injection, the `maxBuffer` ceiling and the `ENOENT` rewrap, and re-opens the wrong-repo/token-bleed bug classes the whole GitContext design exists to kill. The CI guard would also have to grow a *second* exempt spawn site rather than a second exempt *call-site* package.

A third, quieter problem: the private chokepoint's own signature is forge-coupled. `#run(command, { cwd?, input?, usePat? })` carries `usePat` — a GitHub concept (PAT versus App installation token, needed because GitHub forbids bot self-approval and gates Projects V2 behind a PAT). Promoting that signature verbatim would publish GitHub semantics in the core's first public primitive, and the TokenProvider slice would then have to make a breaking change to the very API it was supposed to build on.

There is also an accuracy problem in the current shape that this slice can fix for free: `#run` resolves its directory as `opts.cwd ?? this.#basePath`, so the *kind* of directory being requested is implicit in whether an argument was passed. `#runRepoApi` then expresses "framework root" by passing an explicit `cwd` override — the same channel that "explicit worktree path" uses. Two semantically different requests travel down one untyped string parameter.

## Solution Statement

Introduce one public method and two small public types; re-point the two private chokepoints onto it; change nothing else.

### 1. The public signature

```ts
// adws/gitContext/types.ts
export type ExecWorkingDirectory =
  | { readonly kind: 'workspace'; readonly path?: string }
  | { readonly kind: 'frameworkRoot' };

export interface ExecOptions {
  readonly cwd: ExecWorkingDirectory;
  readonly env: NodeJS.ProcessEnv;
  readonly input?: string;
}

// adws/gitContext/gitContext.ts (public method on GitContext)
exec(command: string, options: ExecOptions): string
```

- **command** — first **positional** parameter (see §4; this is load-bearing for the CI guard).
- **cwd** — the working-directory *class*, not a path. `{ kind: 'workspace' }` resolves to the context base path; `{ kind: 'workspace', path }` narrows to an explicit worktree beneath it; `{ kind: 'frameworkRoot' }` resolves to the injected `frameworkRepoRoot` and preserves #775's contract exactly. There is no fourth option and no `process.cwd()` fallback anywhere.
- **env** — the per-command credential/identity overlay, merged over the inherited process environment inside the executor (`{ ...process.env, ...options.env }`). Read-only: `process.env` is never written. Callers pass an overlay, not a whole environment, so no caller can accidentally strip `PATH` (which `gitContextOperations.test.ts:91-95` pins).
- **input** — optional stdin, unchanged in behaviour.
- **returns** — stdout, `.trim()`ed. Every one of the 83 existing call sites depends on trimmed output; the trim is part of the contract, documented, not incidental.

`ExecWorkingDirectory` is deliberately a discriminated union rather than a `'workspace' | 'frameworkRoot'` string plus a loose optional `path`, so "framework root with an explicit worktree path" is unrepresentable rather than merely undocumented.

### 2. The private chokepoints become classifiers

```ts
#run(command: string, opts: { cwd?: string; input?: string; usePat?: boolean } = {}): string {
  return this.exec(command, {
    cwd: { kind: 'workspace', path: opts.cwd },
    env: this.commandEnv({}, opts.usePat ?? false),
    input: opts.input,
  });
}

#runRepoApi(command: string, opts: { input?: string; usePat?: boolean } = {}): string {
  return this.exec(command, {
    cwd: { kind: 'frameworkRoot' },
    env: this.commandEnv({}, opts.usePat ?? false),
    input: opts.input,
  });
}
```

`#runRepoApi` stops delegating through `#run` with a cwd override and states its class directly — which is what it always meant. `usePat` stays exactly where the issue says it should: functional, private, invisible from the public signature.

**Why keep the private helpers at all.** The alternative — deleting them and rewriting all 83 call sites to call `this.exec(...)` with an inline options object — produces a ~500-line diff whose every hunk is mechanical, buries the one thing this HITL slice exists to review (the signature), and multiplies the chance of a transposed cwd class. Keeping them costs six lines, and the acceptance criterion "all existing GitContext operations route through the executor" is satisfied literally: after this change there is exactly one spawn site, one `try`/`catch`, one env merge, and one cwd resolution in the package, and every operation reaches it. The ops modules (`branchOps`, `commitOps`, `worktreeCreateOps`, …) keep their `Runner = (command: string, cwd: string) => string` seam untouched, so package-private orchestration is unaffected.

### 3. Env-overlay equivalence (no behaviour change)

Today: `env = this.commandEnv(process.env, usePat)` → `{ ...process.env, GH_TOKEN, GIT_AUTHOR_*, GIT_COMMITTER_* }`.
After: `env = { ...process.env, ...this.commandEnv({}, usePat) }` → the identical object content, because `commandEnv`'s default base is `{}` and its overlay keys are the same four-plus-one. Every existing env assertion (`gitContextOperations.test.ts:55-96, 495-509`, `repoApiCwd.test.ts:229-283`) stays green unmodified. `commandEnv`'s own public signature — including its second `usePat` parameter, used by no caller outside the package — is **not** touched in this slice; it is the TokenProvider slice's to remove.

### 4. Command stays the first positional argument — verified guard finding

The CI guard's `git-gh-shellout` rule flags a `CallExpression` whose **first argument** is a string/template literal matching `^(git|gh)( |$)` (`adws/checkGitGhGuard.ts:134-153`). Verified in this worktree on 2026-08-19 by running the real `scanFiles` over a fixture:

| call shape | flagged? |
|---|---|
| `ctx.exec('git push origin main', { … })` | **yes** — `git-gh-shellout` |
| `ctx.exec({ command: 'git push origin main', … })` | **no** |
| ``ctx.exec(`gh pr view 7 --repo o/r`, { … })`` | **yes** — `git-gh-shellout` |

So a single-object-argument executor (`exec({ command, cwd, env })`) would silently punch a hole in the guard the day it becomes public: any module outside `adws/gitContext/` could route a raw `git`/`gh` string through it and CI would pass. Keeping `command` first positional preserves the guard's coverage byte-for-byte with no guard changes in this slice — and the exempt-set extension the PRD schedules for #792 then only has to name the adapter package, not teach the rule a new call shape.

### 5. `ENOENT` rewrap and the empty-argument guards

The rewrap moves *into* `exec` verbatim: same `rewrapMissingWorkingDirectory(error, { cwd, command, owner, repo, selfHost }, this.#fsDeps.existsSync)` call, same double condition (`code === 'ENOENT'` **and** the resolved cwd genuinely absent), same preserved `code`/`syscall`/`path`/`cause`. Because it sits in the one place both classifiers reach, `#runRepoApi` keeps inheriting it exactly as it does today.

Two cheap guards are added alongside, in the house style of `worktreePathFor`'s empty-branch throw (`gitContext.ts:144-147`):

- empty/whitespace `command` → `GitContext: exec command must not be empty`
- `{ kind: 'workspace', path: '' }` (or whitespace) → `GitContext: exec working directory path must not be empty`

The second closes a live hole: `opts.cwd ?? this.#basePath` treats `''` as a *real* directory (empty string is not nullish), so today an empty path would be handed to the spawn instead of falling back. Verified: no call site in `adws/`, `features/` or `test/` passes an empty cwd, so this converts an unreachable silent misroute into a loud error with no caller impact.

### 6. What is deliberately not in this slice

- **`repoWorkspace.ts` and `appAuth.ts` keep their own exec seams.** They are pre-context bootstrap primitives — `cloneRepo`/`ensureRepoWorkspace` run *before* a workspace exists (`WorkspaceExecFn` is a different, void-returning shape, `repoWorkspace.ts:24`) and `appAuth.ts` shells `curl`, not `git`/`gh`. Neither is a `GitContext` *operation*, so neither is in the AC's "all existing GitContext operations". Routing them would require an instance that does not yet exist.
- **No token/TokenProvider work** (#791). **No adapter, no builder relocation** (#792). **No caller migration** (#796/#797). **No guard rule changes** (#795).
- **No `commandEnv` signature change** (TokenProvider slice).

Net: two new exported types, one new ~20-line public method plus one 6-line private resolver, two rewritten 6-line private helpers, one private field rename (`#exec` → `#execFn`, so the injected seam is not confused with the new public method), extended unit tests, `@adw-790` scenarios, and documentation updates. No new dependencies, no call-site changes anywhere outside `adws/gitContext/gitContext.ts`.

## Relevant Files

Use these files to implement the feature:

- `adws/gitContext/gitContext.ts` — **the whole implementation.** Module header (`:1-25`, describes "two private spawn chokepoints" and must be rewritten to describe one public executor plus two classifiers); `defaultExec` (`:63-75`, the real `execSync` wrapper — unchanged); private fields (`:114-123`, `#exec` → `#execFn`); constructor (`:125-137`, `#basePath`/`#repoApiCwd`/`#fsDeps` wiring — unchanged); `commandEnv` (`:149-158`, unchanged, now called with the default `{}` base); `#run` (`:160-179` → classifier); `#runRepoApi` (`:181-194` → classifier); the 45 `this.#run(` and 38 `this.#runRepoApi(` call sites (unchanged), including the 7 `usePat: true` sites at `:562, 598, 603, 615, 622, 632, 641`.
- `adws/gitContext/types.ts` — **new public types.** `ExecWorkingDirectory` and `ExecOptions` are added here next to `ExecFn` (`:17`), `FsDeps` (`:23-28`) and `GitContextDeps` (`:35-39`). `ExecFn` itself is **not** changed — it stays the injected low-level seam `(command, { cwd, env, input? }) => string`, which is what every existing test fake implements.
- `adws/gitContext/index.ts` — **public surface.** Re-export `ExecWorkingDirectory` and `ExecOptions` alongside the existing type exports (`:14`) so #792's adapter and future library consumers can type their calls without reaching into `types.ts`.
- `adws/gitContext/workingDirectoryGuard.ts` — `rewrapMissingWorkingDirectory` (`:53-67`), `describeMissingWorkingDirectory` (`:41-43`), `isSpawnEnoent` (`:34-36`), `WorkingDirectoryContext` (`:15-21`). Read-only reference: the rewrap call relocates from `#run` into `exec` unchanged; the module itself needs no edit.
- `adws/gitContext/__tests__/gitContext.test.ts` — **primary test extension** (361 lines). Already holds the `commandEnv`, `remotes()` and `gitConfigUser()` suites with spy execs. Gains the new `exec()` executor suite (command/cwd-class/env/stdin/trim/rewrap/guards) and the compile-time "no forge parameters" guard.
- `adws/gitContext/__tests__/repoApiCwd.test.ts` — **second test extension** (283 lines). Owns #775's contract: the table over all 35 repo-API methods asserting `cwd === FRAMEWORK_ROOT` (`:131-143`), self-host invariance (`:145-157`), workspace ops pinned to `basePath` (`:159-198`), the post-`chdir` non-ambient check (`:200-214`) and the auth/env contract including `approvePR`'s PAT (`:235-283`). Gains direct `exec` coverage of the `{ kind: 'frameworkRoot' }` class and a routing assertion that repo-API methods reach the public executor.
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — **regression net, unmodified** (1560 lines). Pins `PATH` inheritance (`:91-95`), `GH_TOKEN`/`GIT_*` injection (`:55-80`), `process.env` non-mutation including the throwing path (`:485-537`), verbatim error propagation for non-`ENOENT` failures (`:524-528`), non-ambient cwd after `process.chdir()` (`:539-564`), and `createPR`'s `--head` contract. It must pass with **zero edits** — that is the proof this slice is behaviour-neutral.
- `adws/gitContext/__tests__/workingDirectoryGuard.test.ts` — the pure-module rewrap tests. Unmodified; the executor-level rewrap test in `gitContext.test.ts` is the integration counterpart.
- `adws/gitContext/branchOps.ts` (`:9`), `commitOps.ts` (`:5`), `claimOps.ts` (`:21`), `gitReadOps.ts` (`:9`), `remoteOps.ts` (`:10`), `worktreeProbeOps.ts` (`:11`), `worktreeQueryOps.ts` (`:8`), `worktreeRemoveOps.ts` (`:10`), `worktreeCreateOps.ts` (`:9`), `worktreeResetOps.ts` (`:8`) — each declares `Runner = (command: string, cwd: string) => string`. Read-only reference: this seam is unchanged, which is why the classifier approach touches no ops module.
- `adws/gitContext/repoWorkspace.ts` — `WorkspaceExecFn` (`:24`) and `ensureRepoWorkspace` (`:107-129`). Read-only reference: the documented reason bootstrap primitives keep their own exec seam.
- `adws/checkGitGhGuard.ts` — `walkNode`/`extractGitGhCommand` (`:134-153`), `EXEMPT_PACKAGE_DIR` (`:46`). Read-only reference: the first-positional-argument requirement in §4 comes from this rule. **No changes** — the guard extension is #792/#795.
- `features/per-issue/step_definitions/gitContextSharedWorld.ts` — `W`, `makeSpyExec` (`:60-73`), `makeFullOptions` (`:75-95`), `makeNoOpFsDeps` (`:104-111`), `FRAMEWORK_ROOT`/`TARGET_REPOS_ROOT` (`:10-11`). The BDD world every `@adw-6xx`/`@adw-775` GitContext family drives; `@adw-790`'s step definitions reuse it rather than building a second world. **One additive edit is required here** (step 12): `SpyCall` records `{command, cwd, env}` but not `input`, so the `@adw-790` stdin scenarios cannot assert through it — widen `SpyCall` with `readonly input?: string` and record `options.input` in `makeSpyExec`. Verified additive: the only `makeSpyExec` consumers are `feature-659.steps.ts` (`:126`, `:138`) and `feature-699.steps.ts` (`:46`), neither of which reads `input`. `makeFullOptions` sets no `pat` and `makeNoOpFsDeps` hardcodes `existsSync: () => false`; both are overridden per-scenario at the call site, not changed in the factory.
- `features/per-issue/feature-790.feature` — the `@adw-790` scenarios (§1–§14), written against this plan and reconciled with it in the alignment phase. It is the contract step 12 implements; its §-numbered headings are the coverage list.
- `specs/prd/gitcontext-forge-agnostic-refactor.md` — Implementation Decisions → *Disciplined executor*; Testing Decisions → *Executor*. The authority for this slice's scope.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — the owning living doc. Its Overview and Responsibilities describe the two private chokepoints and must be updated to the executor-plus-classifiers shape.
- `.adw/conditional_docs.md` — `app_docs/feature-oqb76h-…` conditions block (around `:2008-2135`). Gains conditions for the public executor.
- `.adw/coding_guidelines.md` — binding: clarity over cleverness, immutability, type safety (no `any`, discriminated unions over loose optionals), guard clauses, isolate side effects, JSDoc on public APIs.
- `README.md` — the `adws/gitContext/` tree block (`:635-676`); the `gitContext.ts` (`:662`), `types.ts` (`:669`) and `workingDirectoryGuard.ts` (`:670`) one-liners mention the private `#run` and need re-wording.

### New Files

- `features/per-issue/step_definitions/feature-790.steps.ts` — the `@adw-790` step definitions (step 12). The only new file in this slice.

No new **implementation** source files. The types belong beside `ExecFn` in the existing `types.ts` (the issue's Touched Files list agrees), and the executor belongs on the class because it needs `#basePath`, `#repoApiCwd`, identity and `#fsDeps`.

## Implementation Plan

### Phase 1: Foundation

Define the vocabulary before the behaviour. Add `ExecWorkingDirectory` and `ExecOptions` to `types.ts` with JSDoc that states the forge-neutrality contract (the executor must not know what a command *means*) and the #775 framework-root rule, then re-export both from `index.ts`. Rename the private injected-seam field `#exec` → `#execFn` so the public method name `exec` is unambiguous at every read site. Nothing behavioural changes in this phase; `bunx tsc --noEmit` and the full unit suite stay green throughout.

### Phase 2: Core Implementation

Add the public `exec(command, options)` and a private `#resolveWorkingDirectory(spec)`. `exec` performs, in order: the two empty-argument guard clauses, cwd-class resolution, env overlay (`{ ...process.env, ...options.env }`), the single `this.#execFn(...)` spawn, `.trim()`, and — in the one `catch` — the `rewrapMissingWorkingDirectory` call moved verbatim from `#run`. Then re-point `#run` and `#runRepoApi` onto it as classifiers, deleting the old spawn/catch body from `#run` and the cwd-override delegation from `#runRepoApi`. Extend the two unit suites to assert command, cwd class, env and stdin through the injected fake, plus the compile-time no-forge-parameter guard.

### Phase 3: Integration

Prove behaviour neutrality across everything that already depends on the chokepoint: the untouched `gitContextOperations` suite, the untouched `repoApiCwd` table over 35 repo-API methods, and the ~15 existing `@adw-*` GitContext BDD families that assert cwd/env/token contracts through the shared world. Add the `@adw-790` step definitions over that same world so the executor is driven as the public API a forge adapter will use. Finish by updating the living documentation (`app_docs`, `.adw/conditional_docs.md`, `README.md`) to describe one public executor with two private classifiers instead of two private chokepoints.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Add the executor types to `adws/gitContext/types.ts`

- Add `ExecWorkingDirectory` as a discriminated union directly below `ExecFn`:
  - `{ readonly kind: 'workspace'; readonly path?: string }` — the workspace this context is bound to; `path` narrows to an explicit worktree beneath it. Omitting `path` means the context base path.
  - `{ readonly kind: 'frameworkRoot' }` — the injected framework repository root, for commands that carry their own repository identity and need no checkout (#775). Deliberately carries no `path`.
- Add `ExecOptions` with `readonly cwd: ExecWorkingDirectory`, `readonly env: NodeJS.ProcessEnv`, `readonly input?: string`.
- JSDoc both, stating: (a) the executor is forge-neutral — no forge semantics, no token selection, no `usePat`; (b) `env` is a per-command **overlay** merged over the inherited process environment, never a `process.env` mutation; (c) `cwd` is a *class*, never a bare path, and there is no `process.cwd()` fallback.
- Leave `ExecFn`, `FsDeps`, `GitContextDeps`, `GitIdentity` and `GitContextOptions` unchanged.

### 2. Export the new types from `adws/gitContext/index.ts`

- Extend the existing `export type { GitIdentity, GitContextOptions, ExecFn, GitContextDeps, FsDeps }` line with `ExecWorkingDirectory` and `ExecOptions`.
- Update the file's header comment to note that the public surface now includes the forge-neutral executor primitive.

### 3. Rename the private exec seam field in `adws/gitContext/gitContext.ts`

- `readonly #exec: ExecFn` → `readonly #execFn: ExecFn` (`:122`) and its constructor assignment (`:135`).
- Update the single usage inside the old `#run` body (`:172`) — it is about to move into `exec` anyway.
- No public behaviour change; `GitContextDeps.exec` (the injection key) keeps its name.

### 4. Add the private working-directory resolver

- Add `#resolveWorkingDirectory(spec: ExecWorkingDirectory): string` immediately above the new `exec`:
  - `if (spec.kind === 'frameworkRoot') return this.#repoApiCwd;`
  - `if (spec.path === undefined) return this.#basePath;`
  - `if (!spec.path.trim()) throw new Error('GitContext: exec working directory path must not be empty');`
  - `return spec.path;`
- Guard-clause style, max depth 1, no `else` — per `.adw/coding_guidelines.md`.

### 5. Add the public `exec` method

- Signature: `exec(command: string, options: ExecOptions): string`.
- Body, in order:
  1. `if (!command.trim()) throw new Error('GitContext: exec command must not be empty');`
  2. `const cwd = this.#resolveWorkingDirectory(options.cwd);`
  3. `const env = { ...process.env, ...options.env };`
  4. `try { return this.#execFn(command, { cwd, env, input: options.input }).trim(); }`
  5. `catch (error) { throw rewrapMissingWorkingDirectory(error, { cwd, command, owner: this.#owner, repo: this.#repo, selfHost: this.#selfHost }, this.#fsDeps.existsSync); }` — moved verbatim from `#run`.
- JSDoc it as the package's public forge-neutral primitive: one spawn site; explicit cwd class; per-command credential overlay; optional stdin; trimmed stdout; missing-working-directory `ENOENT` rewrapped with the path and repo identity while every other failure propagates verbatim; `process.env` never mutated. State explicitly that `command` is the first positional parameter **by contract**, because `adws/checkGitGhGuard.ts`'s `git-gh-shellout` rule only inspects a call's first argument — an options-object form would silently disable the guard for every consumer.
- Place `exec` next to `commandEnv` in the class body (the "spawn discipline" block), above the private classifiers.

### 6. Re-point `#run` onto the executor

- Replace the body with the classifier form from Solution Statement §2: `cwd: { kind: 'workspace', path: opts.cwd }`, `env: this.commandEnv({}, opts.usePat ?? false)`, `input: opts.input`.
- Keep the `{ cwd?: string; input?: string; usePat?: boolean }` options shape so all 45 call sites compile unchanged.
- Update its doc comment: it is no longer the spawn chokepoint, it is the workspace-scoped **classifier** over `exec`, and `usePat` is the GitHub-specific flag that stays private in this slice and leaves in #791.
- Delegate with `this.exec(...)` — dynamic dispatch through the instance, **not** through a private alias or `GitContext.prototype.exec.call(this, …)`. `@adw-790` §10 observes routing by shadowing the public method with an instance own-property; a statically-bound delegation would bypass the observer and fail that scenario while looking correct.

### 7. Re-point `#runRepoApi` onto the executor

- Replace the `#run(command, { ...opts, cwd: this.#repoApiCwd })` delegation with a direct `this.exec(command, { cwd: { kind: 'frameworkRoot' }, env: this.commandEnv({}, opts.usePat ?? false), input: opts.input })`.
- Keep the "deliberately accepts no cwd override" contract in the doc comment, and note it is now expressed as a cwd *class* rather than an override — the class makes the override unrepresentable rather than merely unpassed.
- Delegate with `this.exec(...)` for the same dynamic-dispatch reason as step 6.
- Leave all 38 call sites and all 7 `usePat: true` sites untouched.

### 8. Rewrite the module header of `gitContext.ts`

- The header (`:1-25`) currently says "Every gh/git operation is routed through one of two private spawn chokepoints". Rewrite to: one **public** forge-neutral executor `exec(command, { cwd, env, input? })` is the single spawn site; two private classifiers choose the working-directory class (`#run` → workspace, `#runRepoApi` → framework root) and assemble the credential env (including the GitHub-specific `usePat`, which is private and temporary); the missing-working-directory rewrap lives inside the executor.

### 9. Extend `adws/gitContext/__tests__/gitContext.test.ts` with the executor suite

Add a `describe('exec() — public forge-neutral executor')` block using the file's existing `validOptions()` + spy-exec idiom. Cases:

- **Command**: the exact string reaches the fake, verbatim and untransformed.
- **cwd class — workspace default**: `{ kind: 'workspace' }` records `cwd === ctx.basePath`, for both a target context and a self-host context.
- **cwd class — explicit worktree**: `{ kind: 'workspace', path: '/srv/adw/repos/acme/webapp/.worktrees/feature-x' }` records that path.
- **cwd class — framework root**: `{ kind: 'frameworkRoot' }` records `FRAMEWORK_ROOT` for a target context (whose `basePath` differs) and after a `process.chdir(os.tmpdir())` (restore in `afterEach`).
- **Credential env parameterization**: an `env` of `{ GH_TOKEN: 'call-scoped-token' }` is recorded verbatim; two calls with different `env` values on the *same* context record different tokens (proving per-command, not per-context, credentials).
- **Env inheritance**: `PATH` from `process.env` survives into the recorded env when the overlay does not mention it.
- **Env immutability**: the caller's `env` object is not mutated; `process.env` is unchanged after the call, including when the fake throws.
- **stdin**: `input` reaches the fake when supplied and is `undefined` when omitted.
- **Trim**: a fake returning `'main\n'` makes `exec` return `'main'`.
- **ENOENT rewrap through the public entry**: with a real `mkdtemp`'d `targetReposDir` under which `{owner}/{repo}` is deliberately absent and a fake throwing `Object.assign(new Error('spawnSync /bin/sh ENOENT'), { code: 'ENOENT', syscall: 'spawnSync /bin/sh', path: '/bin/sh' })`, `exec('git status', { cwd: { kind: 'workspace' }, env: {} })` throws an error whose message contains the resolved path, `owner/repo` and `selfHost=false`, and which still carries `code === 'ENOENT'` and the original as `cause`.
- **Rewrap does not over-fire**: a non-`ENOENT` throw (`new Error('gh: unauthenticated')`) propagates verbatim; an `ENOENT` throw whose cwd *does* exist propagates verbatim.
- **Guards**: `exec('', …)` and `exec('   ', …)` throw `/GitContext/`; `{ kind: 'workspace', path: '' }` throws `/GitContext/`.

### 10. Add the compile-time "no forge parameters" guard

- In the same suite, add a `@ts-expect-error` case asserting that an options object carrying `usePat: true` is a **type** error (TypeScript's excess-property check on object literals rejects it). Both type-checks reach this file — the root `tsconfig.json` includes `**/*.ts`, and `adws/tsconfig.json` includes `./**/*.ts` excluding only `node_modules`/`dist` (verified 2026-08-19) — so if a future change re-adds a GitHub-specific parameter to `ExecOptions`, the unused `@ts-expect-error` fails both `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`.
- **This case is what makes `@adw-790` §14 non-vacuous.** That scenario reuses the registered T22 phrase, whose step definition (`feature-504.steps.ts:1126`) runs exactly `bunx tsc --noEmit -p adws/tsconfig.json`. §14 is where the issue's "no GitHub-specific parameters in its signature" criterion is enforced, and it enforces nothing if this case is omitted — so do not skip it.
- Add a runtime companion assertion that the same call still executes correctly at runtime with the extra property stripped (documenting that the ban is structural/type-level, not a runtime rejection).

### 11. Extend `adws/gitContext/__tests__/repoApiCwd.test.ts` with executor-class coverage

- Add a `describe` proving the `{ kind: 'frameworkRoot' }` class *is* the #775 contract: a direct `exec('gh api user', { cwd: { kind: 'frameworkRoot' }, env: ctx.commandEnv() })` records `FRAMEWORK_ROOT`, for both target and self-host contexts, and on a host where `basePath` does not exist (reuse the file's `makeConditionalExec` reproduction idiom at `:99-129`).
- Add one routing assertion that the promotion is real: with a spy `exec` injected, invoking a repo-API method and a workspace method each produces exactly **one** recorded call, at the expected cwd — i.e. no double-spawn and no second spawn path.
- Leave the existing 35-method table, self-host invariance, anti-drift, `approvePR`-PAT and non-mutation cases **unmodified**; they are the regression net.

### 12. Add the `@adw-790` BDD step definitions

`features/per-issue/feature-790.feature` is already written and reconciled with this plan. Implement `features/per-issue/step_definitions/feature-790.steps.ts` against its §1–§14 sections and its declared phrase list; the feature file's "Step-definition note for the maintainer" block is binding guidance, not commentary.

- **Reuse `gitContextSharedWorld.ts`** — `W`, `makeSpyExec`, `makeFullOptions`, `makeNoOpFsDeps`, `FRAMEWORK_ROOT`, `TARGET_REPOS_ROOT`. Do not create a second world. Nothing spawns a real process or touches a real directory: every scenario drives the real `GitContext` in-process with an injected `deps.exec`.
- **Three shared-world adjustments, all additive:**
  - (a) `makeFullOptions` sets no `pat`, so §7, §8, §10 and §13 must construct with `{ ...makeFullOptions(...), pat: 'token-pat' }`. `commandEnv`'s fallback is `(usePat && this.#pat) ? this.#pat : this.#token`, so without a PAT those scenarios pass vacuously.
  - (b) Widen `SpyCall` with `readonly input?: string` and record `options.input` in `makeSpyExec` — §9 cannot assert stdin otherwise. Verified additive: the only consumers are `feature-659.steps.ts` and `feature-699.steps.ts`, neither of which reads `input`.
  - (c) `makeNoOpFsDeps` hardcodes `existsSync: () => false` (what §11 needs). §12's "missing-file failure raised while the working directory is present" row needs the opposite — pass a local `{ ...makeNoOpFsDeps(), existsSync: () => true }` at that call site rather than changing the shared factory.
- **One binding point.** Every step reaches the new API through a single module-private helper (e.g. `runThroughExecutor(ctx, command, cwdClass, env?, stdin?)`) that is the only place naming the literal options shape. This is a HITL slice: if review reshapes the signature, exactly one helper changes.
- **Phrasing.** Reuse only the two registered phrases the feature file names — G18 `the ADW codebase is checked out` (`features/step_definitions/ensureCronOnEveryEventSteps.ts:8`) and T22 `the ADW TypeScript type-check passes` (`feature-504.steps.ts:1126`); redefining either is an `AmbiguousStepDefinition`. Every other phrase is **deliberately novel and deliberately distinct** from the existing GitContext families (`feature-659`, `feature-775`, `feature-777`), because `cucumber.js` globally imports `features/per-issue/step_definitions/**/*.ts` — so a phrase reused from another family would collide at load time. Do not "consolidate" these phrases into the older families' wording.
- **Coverage is the feature file's §-sections**, each of which needs step definitions: §1 command passthrough + trimmed return; §2 caller-chosen cwd class over crossed command/directory rows (the executor must not infer from the command string); §3 framework-root class after `process.chdir` away; §4 workspace class and explicit-worktree narrowing; §5 the eight-row table of existing context operations keeping their working directories, plus the worktree-scoped operation; §6 per-command credential env (two calls, two tokens, one context) and `PATH` still inherited; §7 `approvePR` still spawning with the PAT while an ordinary repo-API read spawns with the primary token; §8 a PAT-selection flag on the public entry not displacing the caller's credential; §9 stdin supplied, stdin omitted, and an internal write still delivering its body on stdin; §10 the pass-through observer proving no internal operation reaches the seam around the public executor; §11 the rewrap firing from inside the executor (error code, directory, repository); §12 every other failure reaching the caller by identity, unwrapped; §13 no `process.env` mutation across both credential paths; §14 the T22 type-check.
- **Two implementation details §10 and §12 depend on.** §10 shadows `ctx.exec` with an instance own-property and compares the observer's call count against the seam recorder's — which works only because steps 6 and 7 delegate via `this.exec(...)`; delete the own property in `After`. §12 asserts error **identity** (`caught === sentinel`), which holds because `rewrapMissingWorkingDirectory` returns the original error object untouched whenever it does not fire (`workingDirectoryGuard.ts:59-60`).
- **Un-escape the seam answer.** §1 writes `answers "executor-passthrough\n"` and then asserts `the executor returns the trimmed output "executor-passthrough"`. Cucumber's `{string}` parameter does not process escape sequences, so the step definition receives a literal backslash-`n` and `.trim()` would not strip it. Have `the context's spawn seam records every command and answers {string}` translate `\n` to a real newline before handing the payload to the seam — that is what makes the scenario prove the `.trim()` all 83 existing call sites depend on.
- Assert the missing-directory failure by `code === 'ENOENT'`, never by the spawn message — node and bun word it differently. The other two §11 assertions do read the message, correctly: that message is this repo's own `describeMissingWorkingDirectory` output.
- Restore `process.cwd()` and the `process.env` snapshot in `After` for the scenarios that perturb them (§3, §4, §13), per the `feature-775` precedent.

### 13. Run the unit suite and prove the untouched files stayed untouched

- `bun run test:unit` must be green with **zero edits** to `gitContextOperations.test.ts` and `workingDirectoryGuard.test.ts`, and with only *additive* edits to `gitContext.test.ts` and `repoApiCwd.test.ts`. If any pre-existing assertion needs modification, stop: that is a behaviour change this slice must not make, and it needs re-planning rather than a test edit.
- Confirm with `git diff --stat adws/gitContext/__tests__/` that the two untouched suites show no changes.

### 14. Update the living documentation

- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — rewrite the Overview's two-chokepoint paragraph and the corresponding Responsibilities bullets to: one public `exec(command, { cwd, env, input? })` primitive (forge-neutral, single spawn site, `ENOENT` rewrap inside, trimmed stdout, no `process.env` mutation) plus two private classifiers `#run` (workspace class) and `#runRepoApi` (framework-root class, #775) that assemble the credential env and carry the temporary GitHub-specific `usePat`. Add the guard rationale for `command` being first positional. Note the executor is what #792's adapter will consume.
- `.adw/conditional_docs.md` — under the same doc's Conditions, add: working with `GitContext.exec`, `ExecOptions` or `ExecWorkingDirectory`; adding a new spawn path to the gitContext package; changing the executor's argument order (guard interaction); troubleshooting a working-directory-class mistake (workspace vs framework root).
- `README.md` — update the `gitContext.ts`, `types.ts` and `workingDirectoryGuard.ts` one-liners at `:662`, `:669` and `:670` in the package tree so they name the public executor rather than the private `#run`. Keep edits surgical and additive-in-spirit; do not restructure the tree.

### 15. Run the Validation Commands

Execute every command in the `Validation Commands` section below and confirm each one passes.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope. Framework: `vitest` (`bun run test:unit`), pattern `adws/**/__tests__/**/*.test.ts`.

**Extended: `adws/gitContext/__tests__/gitContext.test.ts`** — the executor suite from step 9, driven entirely through the injected `ExecFn` fake, asserting only externally observable facts (the recorded `command`/`cwd`/`env`/`input`, the returned string, the thrown error). No private state is asserted and no call *sequence* is asserted, per the PRD's testing decisions. Plus the step-10 compile-time guard that `ExecOptions` admits no forge-specific parameter.

**Extended: `adws/gitContext/__tests__/repoApiCwd.test.ts`** — direct coverage of the `{ kind: 'frameworkRoot' }` class (including on a host with no cloned workspace), and the single-spawn routing assertion. The existing 35-method table remains the proof that every repo-API operation still lands at the framework root after the rewiring.

**Unmodified regression net** — `gitContextOperations.test.ts` (env injection, `PATH` inheritance, `process.env` non-mutation on both the happy and throwing paths, verbatim non-`ENOENT` error propagation, non-ambient cwd after `process.chdir`, `createPR --head`), `workingDirectoryGuard.test.ts` (the pure rewrap module), and every other `adws/gitContext/__tests__/` suite. These must pass untouched; that is the behaviour-neutrality proof.

**BDD (`@adw-790`)** — `features/per-issue/feature-790.feature` (§1–§14) driven by `feature-790.steps.ts` over `gitContextSharedWorld.ts` as described in step 12: the real `GitContext` in-process with a spy `ExecFn`, asserting the recorded `(command, cwd, env, input)` tuple, the returned value, the raised error and the type-checker's exit status. Nothing reads framework source as text. §5, §7, §12 and §13 are GREEN before and after (they guard existing behaviour); §1, §2, §3, §4, §6, §8, §9, §10 and §11 are RED before. The ~15 existing GitContext families (`@adw-658`, `@adw-659`, `@adw-661`…`@adw-700`, `@adw-775`, `@adw-777`) are re-run unmodified as the cross-family regression net — `gitContextSharedWorld.ts`'s `SpyCall` widening is additive, so none of them changes.

### Edge Cases

- **Empty / whitespace command** → loud `GitContext:` error, not a spawn of `''`.
- **`{ kind: 'workspace', path: '' }`** → loud error, not a silent fall-through to the spawn (today `?? basePath` does not catch `''`).
- **`{ kind: 'workspace' }` on a self-host context** → base path *is* the framework root; both classes resolve to the same directory and must stay consistent (pinned by `repoApiCwd.test.ts`'s self-host invariance table).
- **`{ kind: 'frameworkRoot' }` when the target workspace has never been cloned** → succeeds; this is #775's whole point and must not regress.
- **Framework root itself missing** → the rewrap fires for the framework-root class too, naming that path (inherited behaviour, unchanged).
- **`ENOENT` whose cwd exists** (e.g. the *command* binary is missing) → propagates verbatim, unrewrapped.
- **Non-`ENOENT` failure** (`gh: unauthenticated`, a real git error) → propagates verbatim.
- **Empty `env` overlay `{}`** → the child still inherits `process.env`; no crash, no credential invented.
- **Overlay key colliding with a real `process.env` key** (`GH_TOKEN` set globally to a stale value) → the overlay wins in the child and the global stays stale (pinned by `gitContextOperations.test.ts:495-509`).
- **stdin omitted vs supplied** → `input` is `undefined` vs the exact string; `defaultExec`'s two branches (`:63-75`) are selected accordingly.
- **Output needing trimming** (`'main\n'`, `'  \n'`) → trimmed; an all-whitespace payload becomes `''`.
- **Two contexts in one process** with different tokens/base paths → no cross-talk through the shared public executor (each `exec` resolves against its own instance fields).
- **`usePat: true` internal ops** (`approvePR`, `runGraphQL`, `runGraphQLInput`, the four `moveIssueToStatus` calls) → still send the PAT as `GH_TOKEN`, still with no `usePat` anywhere in the public signature.

## Acceptance Criteria

1. `GitContext.exec(command, { cwd, env, input? })` is public, and its signature contains **no** GitHub-specific parameter — no `usePat`, no token argument, no forge vocabulary. `ExecWorkingDirectory` and `ExecOptions` are exported from `adws/gitContext/index.ts`.
2. `command` is the executor's **first positional** parameter, so `adws/checkGitGhGuard.ts`'s `git-gh-shellout` rule keeps flagging raw `git`/`gh` strings routed through it from outside the package; `bun run lint:git-guard` passes with its `(0 allowlisted)` line unchanged.
3. Repo-independent `gh` commands still run from the injected framework repository root: the `repoApiCwd.test.ts` table over all 35 repo-API methods passes unmodified, for both target and self-host contexts, and after `process.chdir()`.
4. Workspace-scoped commands still run at `basePath`, or at an explicit worktree path when one is supplied.
5. The missing-working-directory `ENOENT` rewrap still fires from inside the executor, producing an error naming the resolved path, `owner/repo` and `selfHost`, preserving `code: 'ENOENT'` and the original error as `cause`; every other failure — including `ENOENT` at a cwd that exists — propagates verbatim.
6. All existing `GitContext` operations route through the executor: after the change the package contains exactly one `this.#execFn(...)` call site, one env merge, one cwd resolution and one rewrap `catch`; `#run` and `#runRepoApi` are thin classifiers over `exec` and all 45 + 38 call sites are unchanged.
7. `usePat` remains functional for the 7 PAT-requiring operations and is reachable only through the private classifiers.
8. Per-command credential environment is preserved exactly: `GH_TOKEN` plus the four `GIT_*` identity vars overlaid on the inherited environment, `PATH` still inherited, `process.env` never written — including when the spawn throws.
9. `bun run test:unit` is green with `gitContextOperations.test.ts` and `workingDirectoryGuard.test.ts` **unmodified**, and with only additive changes to `gitContext.test.ts` and `repoApiCwd.test.ts`.
10. New tests assert the executed command, the credential env, the resolved cwd and the stdin through the injected exec fake, plus `process.env` non-mutation; a `@ts-expect-error` case fails the type-check if a forge-specific parameter is ever added to `ExecOptions`.
11. All `@adw-790` scenarios pass, and every pre-existing `@adw-*` GitContext family plus `@regression` passes with its feature files and its own step definitions unmodified — the only shared-step-definition change is the additive `SpyCall.input` field and its recording in `makeSpyExec` (`gitContextSharedWorld.ts`), which no existing family reads.
12. `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json` and `bun run build` all pass.
13. `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`, `.adw/conditional_docs.md` and `README.md` describe the public executor and its two private classifiers.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are the project-specific ones from `.adw/commands.md`.

**Prove the new surface (RED before, GREEN after):**
- `bunx vitest run adws/gitContext/__tests__/gitContext.test.ts` — the new `exec()` suite. **RED before the change** (the method does not exist / does not compile); **GREEN after**.
- `bunx vitest run adws/gitContext/__tests__/repoApiCwd.test.ts` — the framework-root class and single-spawn routing cases are RED before, GREEN after; the pre-existing 35-method table is green in both states (that is the point).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-790"` — RED before (no executor), GREEN after.

**Prove zero regressions (all must pass):**
- `bun run lint` — ESLint clean.
- `bunx tsc --noEmit` — root type-check (covers `adws/**`, `features/**` and the test files, so it is what enforces the `@ts-expect-error` forge-parameter guard).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check.
- `bun run test:unit` — full vitest suite green, including `gitContextOperations.test.ts` and `workingDirectoryGuard.test.ts` **with no edits**.
- `git diff --stat adws/gitContext/__tests__/gitContextOperations.test.ts adws/gitContext/__tests__/workingDirectoryGuard.test.ts` — must print **nothing** (empty diff): the behaviour-neutrality proof.
- `bun run lint:git-guard` — whole-repo git/gh guard passes, `scanned N files (0 allowlisted)` line unchanged; no new violations, no allowlist changes (the work is inside the structurally exempt `adws/gitContext/` package).
- `bun run build` — `tsc` build succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite green.

**Cross-family regression net — each must be green with its feature file and its own step definitions unmodified** (these are the families that assert cwd, per-command env, token isolation and worktree contracts through the chokepoint this slice rewires). The one shared file that does change, `gitContextSharedWorld.ts`, gains only the additive optional `SpyCall.input` field from step 12, which no existing family reads:
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-659"` — per-command auth / explicit-cwd / two-context isolation.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-775"` — repo-API framework-root cwd contract.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-777"` — missing-working-directory rewrap.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-658"`, `--tags "@adw-661"`, `--tags "@adw-662"`, `--tags "@adw-663"`, `--tags "@adw-664"`, `--tags "@adw-691"`, `--tags "@adw-692"`, `--tags "@adw-693"`, `--tags "@adw-694"`, `--tags "@adw-695"`, `--tags "@adw-696"`, `--tags "@adw-697"`, `--tags "@adw-698"`, `--tags "@adw-699"`, `--tags "@adw-700"` — the remaining GitContext families.

**Structural check — one spawn site:**
- `grep -c "this.#execFn(" adws/gitContext/gitContext.ts` — must print `1`.
- `grep -n "rewrapMissingWorkingDirectory" adws/gitContext/gitContext.ts` — exactly one call site (inside `exec`), plus the import.
- `grep -c "usePat" adws/gitContext/types.ts` — must print `0` for the new `ExecOptions`/`ExecWorkingDirectory` region (the word may not appear in the executor types at all).

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` applies. The executor is a guard-clause function with max nesting depth 1; `ExecWorkingDirectory` is a discriminated union rather than a loose optional (type safety, unrepresentable illegal states); the env overlay is a fresh object each call (immutability — the caller's object and `process.env` are both left alone); the public method carries JSDoc. `gitContext.ts` is already 645 lines, well over the 300-line guideline, as an accepted deep-module exception; this slice adds ~30 lines and **no** new responsibility, so do not open a file split here — the PRD's later slices (#792 onward) are what actually shrink this file by moving forge semantics out.
- **No new libraries.** Pure rewiring plus tests. (`.adw/commands.md` install command, if ever needed: `bun add <package>`.)
- **The `- #798` line in the issue's Blocked by section is an artifact.** The section's own text says "None - can start immediately", and #798 is a **closed** auto-generated ADW framework-upgrade tracking issue, unrelated to this PRD. Verified via `gh issue view 798` on 2026-08-19. Nothing blocks this slice.
- **Why `env` is an overlay, not a whole environment.** Handing the executor a complete environment would make every future adapter call site responsible for remembering `process.env` — and the first one that forgets ships a child with no `PATH`. The overlay form makes the disciplined behaviour the default and keeps `gitContextOperations.test.ts:91-95` (PATH inheritance) meaningful. Reading `process.env` to build the child's environment is not a credential read; the PRD's ban is on the core reading environment variables *for credentials*, which this does not do.
- **Why the classifiers survive.** See Solution Statement §2. If a reviewer prefers the full inlining, it is a mechanical follow-up that can land any time after the signature is approved — but doing it in this slice would bury the signature review under ~500 lines of mechanical diff, and this is the HITL slice precisely because the signature is what needs human eyes.
- **Guard interaction is the one non-obvious constraint** (§4, verified by running `scanFiles` over a fixture on 2026-08-19). If a future refactor changes `exec` to a single options object, `adws/checkGitGhGuard.ts` must be extended in the same commit to inspect a `command:` property — otherwise the shell-out rule silently stops protecting the repository. The step-5 JSDoc records this so the constraint travels with the code.
- **What this unblocks.** #791 replaces the `usePat`/`commandEnv` credential path with a `TokenProvider` port resolved per command — the executor's `env` parameter is the seam it plugs into. #792 moves the `gh` command builders and GitHub App auth into an adapter that calls `ctx.exec(cmd, { cwd: { kind: 'frameworkRoot' }, … })` instead of getting new methods added to the core. #793 finishes the core cleanup (clone URL, identity split, logger port). Nothing in those slices requires re-shaping the signature this slice lands.
- **Operationally invisible.** Same commands, same working directories, same environments, same errors, same repositories (PRD story 24). The only externally visible difference is that a new public method exists on `GitContext`.
