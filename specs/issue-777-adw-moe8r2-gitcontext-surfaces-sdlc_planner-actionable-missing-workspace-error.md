# Bug: A missing target workspace surfaces as `spawnSync /bin/sh ENOENT`, naming neither the directory nor the repository

## Metadata
issueNumber: `777`
adwId: `moe8r2-gitcontext-surfaces`
issueJson: `{"number":777,"title":"GitContext surfaces a missing workspace as cryptic spawnSync ENOENT — validate cwd and fail with an actionable error","body":"# GitContext surfaces a missing workspace as cryptic \"spawnSync /bin/sh ENOENT\" — validate basePath and fail with an actionable error\n\n## Blocked by\n#775 <!-- adw:region-overlap -->\n\n- #775\n\n## Symptom\n\nWhen a GitContext command runs for a target repo whose workspace directory does not exist on the host, the failure surfaces as:\n\n```\nError: spawnSync /bin/sh ENOENT\n```\n\nNode reports a nonexistent spawn **cwd** as ENOENT on the shell binary. Nothing in the error names the missing directory, the repo, or the likely cause. Diagnosing the 2026-07-30 webhook outage (paysdoc.nl#28 Cancel directive) took a full morning largely because of this misleading error shape.\n\n## Root cause\n\n`GitContext` resolves `#basePath` in its constructor (`resolveBasePath` — `TARGET_REPOS_DIR/{owner}/{repo}` for non-self-host) but never checks the directory exists. The first symptom is whatever `execSync` produces when handed a nonexistent cwd, deep inside an unrelated call.\n\n## Desired behavior\n\n- When a spawn is about to use a cwd (basePath or explicit worktree path) that does not exist, fail with an error naming the path and the repo identity, e.g.:\n  `GitContext: working directory does not exist: /path/to/owner/repo (owner/repo, selfHost=false) — has a workflow ever cloned this workspace on this host?`\n- Constructor-time validation is likely wrong: legitimate flows construct a GitContext before the workspace is cloned (`repoWorkspace.ts` clone path) — the check belongs at spawn time (`#run`), or as an ENOENT catch-and-rewrap around the exec.\n- After #775 lands, repo-API gh commands no longer use the target basePath, so this check should only fire for commands that genuinely need a local repo.\n\n## Relevant files\n\n- `adws/gitContext/gitContext.ts` — `#run` spawn chokepoint, `resolveBasePath`\n- `adws/gitContext/repoWorkspace.ts` — the legitimate construct-before-clone flow the check must not break\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-07-30T11:31:46Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-07-30T12:40:27Z","body":"⏸️ **Deferred behind #775 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #775, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #775 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/gitcontext/gitcontext.ts`\n\nThis issue will spawn automatically once #775 merges and closes. To override, remove the `#775 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Bug Description
`GitContext` routes every git and workspace-scoped command through one private spawn chokepoint, `#run` (`adws/gitContext/gitContext.ts:162-169`), which spawns with `cwd = opts.cwd ?? this.#basePath`. For a target (non-self-host) context, `#basePath` is `join(targetReposDir, owner, repo)` (`resolveBasePath`, `:97-101`) — a directory that exists only *after* some workflow has cloned a workspace for that repo **on that host**.

Nothing validates that the directory exists, and nothing interprets the failure when it doesn't. Node resolves a spawn's `cwd` *before* exec'ing the shell, so a missing directory fails as an ENOENT **on the shell binary**, which reads like a broken system rather than a missing workspace.

**Expected behaviour:** a command that genuinely needs a local checkout, run against a workspace that is not on this host, fails with an error that names the missing directory, the repository identity, and the likely cause.

**Actual behaviour** (verified live in this worktree on 2026-07-30, target repo `acme/never-cloned`, `targetReposDir=/tmp/adw-777-repos-does-not-exist`):

```
basePath: /tmp/adw-777-repos-does-not-exist/acme/never-cloned
MESSAGE : spawnSync /bin/sh ENOENT
code    : ENOENT | syscall: spawnSync /bin/sh
mentions the missing dir?  false
mentions the repo?         false
```

The message names neither the directory nor `acme/never-cloned`, and `path` on the error is `/bin/sh` — actively misleading, since `/bin/sh` is present and fine. The 2026-07-30 `paysdoc.nl#28` Cancel outage cost a morning of diagnosis largely because of this error shape.

Runtime note (verified 2026-07-30 on darwin, both runtimes): the *message* differs — node says `spawnSync /bin/sh ENOENT`, bun says `ENOENT: no such file or directory, posix_spawn '/bin/sh'` — but `code === 'ENOENT'`, `syscall === 'spawnSync /bin/sh'` and `path === '/bin/sh'` are identical. Any detection must key off `code`, never the message.

## Problem Statement
The failure carries no diagnostic content. Three facts the process already holds at the moment of failure — the resolved `cwd`, the `owner/repo` identity, and the `selfHost` discriminator — are all present on the `GitContext` instance and none of them reach the error.

This is a **diagnosability** bug, not a control-flow bug: the operation genuinely cannot proceed without a checkout, and it *should* fail. #775 already removed the illegitimate half of the coupling (repo-API `gh` calls, which need no checkout at all, now spawn from the injected `frameworkRepoRoot` — re-verified in this worktree: the same pre-clone `fetchIssueComments` call now reaches GitHub and fails on credentials, never touching the missing workspace). What remains is that the legitimate failure is unreadable.

The fix must not regress two things the current design gets right:

1. **Construct-before-clone must keep working.** `ensureTargetRepoWorkspace` (`adws/core/targetRepoManager.ts:62-71`) builds a `GitContext` at `:64` and passes `getDefaultBranch: () => ctx.defaultBranch()` into `ensureRepoWorkspace` (`adws/gitContext/repoWorkspace.ts:107-129`) — the very function whose job is to *create* the workspace. Constructor-time validation would make the clone path unreachable. The issue says this explicitly; it is confirmed by reading the call.
2. **Errors that are already precise must stay verbatim.** `gitContextOperations.test.ts:524-528` pins "surfaces exec errors at the system boundary" (`gh: unauthenticated` propagates unchanged). Blanket wrapping would degrade every other failure to diagnose one.

## Solution Statement
Diagnose the failure **after** the spawn fails, never before it, and only when the diagnosis is certain.

Add one small pure module inside the package, `adws/gitContext/workingDirectoryGuard.ts`, exporting `isSpawnEnoent`, `describeMissingWorkingDirectory`, and `rewrapMissingWorkingDirectory(error, ctx, exists)`. Wrap the single `this.#exec(...)` call in `#run` in a `try`/`catch` that routes the caught error through `rewrapMissingWorkingDirectory`. The rewrap fires only when **both** conditions hold:

- the error carries `code === 'ENOENT'` (runtime-independent; the codebase already uses this exact predicate at `adws/core/authGate.ts:67` and `adws/triggers/spawnGate.ts:38`), **and**
- the resolved `cwd` really is absent, probed through the already-injected `this.#fsDeps.existsSync`.

Everything else is returned untouched and rethrown verbatim. The rewrapped error **preserves `code: 'ENOENT'`** (plus `syscall`/`path`) and carries the original as `cause`, so it remains a spawn-ENOENT to every existing consumer while gaining a message that names the path, the repo, and the cause.

**Why catch-and-rewrap rather than a pre-spawn `existsSync` guard** — the issue offers both; the pre-check is not viable here, for a concrete reason verified in this worktree:

> Every existing GitContext test drives the context with **imaginary** paths (`FRAMEWORK_ROOT = '/srv/adw/framework'`, `TARGET_REPOS_ROOT = '/srv/adw/repos'` — `features/per-issue/step_definitions/gitContextSharedWorld.ts:10-11`, `adws/gitContext/__tests__/repoApiCwd.test.ts:8-9`) plus a spy `ExecFn` that never spawns; three step-def sites additionally inject `makeNoOpFsDeps()`, whose `existsSync` returns `false` unconditionally (`gitContextSharedWorld.ts:107-113`). A guard that threw *before* the exec would throw in essentially every one of those tests — 14 per-issue step-def files import that shared world (`@adw-659`, `@adw-661`, `@adw-662`, `@adw-691`…`@adw-700`, `@adw-775`), plus the `adws/gitContext/__tests__/` suites. Catch-and-rewrap cannot misfire there: a spy exec that returns a canned string never throws, so nothing changes.

A pre-check would also add an `fs.stat` to every spawned command for a condition that is, in production, essentially never true. The rewrap costs nothing on the happy path.

**Scope of the check.** Because it fires only on a real spawn failure, it automatically satisfies the issue's "should only fire for commands that genuinely need a local repo": post-#775, repo-API `gh` commands spawn at `frameworkRepoRoot`, which exists, so they never reach the rewrap. `#runRepoApi` delegates to `#run` (`gitContext.ts:181-183`), so it inherits the same protection for free if the framework root is ever itself missing — and the message adapts to say so.

**Message shape** — one shape for every case, the issue's example verbatim:

```
GitContext: working directory does not exist: {cwd} ({owner}/{repo}, selfHost={selfHost}) — has a workflow ever cloned this workspace on this host? [while running: {command}]
```

Do **not** vary the trailing question by which kind of directory is missing. `feature-777.feature` §2 asserts `the failure asks whether the workspace was ever cloned on this host` for the missing-**worktree** case as well as the missing-basePath case (§1), so a cwd-classifying hint would pass §1 and fail §2. A single shape is also what the issue specifies — it gives one example message for both cwd sources ("basePath or explicit worktree path"). This keeps the diagnosis module free of any `basePath`/`frameworkRepoRoot` classification logic.

The failing command is appended, truncated to 120 characters, because the issue's second complaint is that the failure appears "deep inside an unrelated call". Command strings are safe to print: every credential travels in the child *environment* (`commandEnv`, `:143-152`) or over stdin (`input`), never in argv.

This is one new ~60-line pure module, one `try`/`catch` in `#run`, one new unit-test file, the `@adw-777` scenarios, and two documentation updates. No signature changes, no new exports from `index.ts`, no call-site changes anywhere outside the package, no new dependencies.

## Steps to Reproduce
1. From the worktree root, write a scratch script `repro777.ts`:
   ```ts
   import { GitContext } from './adws/gitContext/index.ts';
   const ctx = new GitContext({
     owner: 'acme', repo: 'never-cloned', selfHost: false,
     token: 'unused-for-this-repro',
     gitIdentity: { authorName: 'ADW Bot', authorEmail: 'bot@adw.dev', committerName: 'ADW Bot', committerEmail: 'bot@adw.dev' },
     frameworkRepoRoot: process.cwd(),
     targetReposDir: '/tmp/adw-777-repos-does-not-exist',
   });
   console.log('basePath:', ctx.basePath);
   try { ctx.getCurrentBranch(); } catch (e) {
     const err = e as NodeJS.ErrnoException;
     console.log('MESSAGE :', err.message);
     console.log('code    :', err.code, '| syscall:', err.syscall);
     console.log('mentions the missing dir? ', err.message.includes(ctx.basePath));
     console.log('mentions the repo? ', err.message.includes('acme/never-cloned'));
   }
   ```
2. Run `bunx tsx repro777.ts`.
3. **Before the fix** (confirmed 2026-07-30): `MESSAGE : spawnSync /bin/sh ENOENT`, `code: ENOENT`, and both `mentions…` lines print `false`. The error names `/bin/sh` — a file that exists and is irrelevant — and says nothing about `/tmp/adw-777-repos-does-not-exist/acme/never-cloned`.
4. **After the fix:** the same call throws `GitContext: working directory does not exist: /tmp/adw-777-repos-does-not-exist/acme/never-cloned (acme/never-cloned, selfHost=false) — has a workflow ever cloned this workspace on this host? [while running: git rev-parse --abbrev-ref HEAD]`, still with `code === 'ENOENT'`, and both `mentions…` lines print `true`.
5. Delete the scratch file (`git status` must be clean afterwards).

**Production repro (what actually happened):** on a host that has never cloned a registered target repo, any workspace-scoped git operation for that repo — takeover worktree probing, `## Cancel` worktree removal, `getCurrentBranch` — fails with `spawnSync /bin/sh ENOENT` and no indication of which directory is missing.

**Hermetic repro (the shape the tests use):** construct a `GitContext` whose `targetReposDir` is a real `fs.mkdtempSync` root under which `{owner}/{repo}` is deliberately *not* created, and inject an `ExecFn` that throws `Object.assign(new Error('spawnSync /bin/sh ENOENT'), { code: 'ENOENT', syscall: 'spawnSync /bin/sh', path: '/bin/sh' })` — a faithful stand-in for what Node raises, with no real spawn required. The `code` property is load-bearing: a bare `new Error('spawnSync /bin/sh ENOENT')` has no `code` and must (correctly) pass through unrewrapped. Real-spawn coverage already exists in `@adw-775` §10 and is reused as a regression guard rather than duplicated.

## Root Cause Analysis
**The information needed to explain the failure exists, and is thrown away.**

- Issue **#658** put base-path resolution in the constructor: identity in, base path out, no cwd fallback (`resolveBasePath`, `gitContext.ts:97-101`; contract in `types.ts:49-93`). Correct, and unchanged by this fix.
- Issue **#659** made `#run` the single spawn chokepoint with an explicit `cwd` and per-command env. Also correct — but `#run` passes `cwd` straight to the injected `ExecFn` and has **no `try`/`catch` at all** (`:162-169`), so whatever the OS raises is what the caller sees.
- For a target repo, `#basePath` is **lifecycle state**, not identity: it materialises only when `ensureRepoWorkspace` clones (`repoWorkspace.ts:119-126`). A host that has never run a workflow for that repo has no such directory.
- Node (and bun) resolve the spawn `cwd` **before** exec'ing `/bin/sh`, so a missing directory is reported as `ENOENT` with `path: '/bin/sh'`. The error names the shell it was *about* to run, not the directory it failed to enter — which is why it reads as a broken system and cost a morning of diagnosis.
- **#775 fixed the coupling; it could not fix the message.** Repo-API `gh` calls no longer touch `basePath` (`#runRepoApi`, `:181-183`), so the *illegitimate* pre-clone failures are gone. Git operations still legitimately require the checkout, so they still fail — and still fail unreadably. That residue is exactly this issue.

Two properties of the surrounding code shape the fix:

- **The `fsDeps` seam already exists.** `GitContextDeps.fsDeps` (`types.ts:23-39`) is injected at construction and defaults to real `fs` (`gitContext.ts:130`). The existence probe needs no new dependency and stays hermetically testable.
- **Error-swallowing probes must keep swallowing.** `worktreeProbeOps` returns `null`/`'missing'` on any throw (`worktreeProbeOps.ts:13-63`), `worktreeQueryOps.listWorktrees`/`worktreeBranches` return `[]`, `branchOps.deleteLocalBranch` returns `false`. Because the rewrap still *throws* (only with a better message), every one of these is unaffected — which is the second reason to rewrap rather than restructure.

## Relevant Files
Use these files to fix the bug:

- `adws/gitContext/gitContext.ts` — **the wiring.** `#run` (`:162-169`, the one site that gains a `try`/`catch`); `#runRepoApi` (`:181-183`, inherits it by delegation); `resolveBasePath` (`:97-101`); the constructor's `#basePath`/`#repoApiCwd`/`#fsDeps` fields (`:108-131`); `defaultExec` (`:57-68`, the real spawn).
- `adws/gitContext/types.ts` — `ExecFn` (`:17`), `FsDeps` (`:23-28`), `GitContextDeps` (`:35-39`). Read-only reference: the two seams the fix uses. No changes.
- `adws/gitContext/repoWorkspace.ts` — `ensureRepoWorkspace` (`:107-129`) and `isRepoCloned` (`:53-56`): the legitimate construct-before-clone flow the check must not break. Runs its **own** `execFn` (`:115`), never `#run`, and gates the fetch behind `isRepoCloned`, so it is untouched by this change. No changes.
- `adws/core/targetRepoManager.ts` — `ensureTargetRepoWorkspace` (`:62-71`) constructs a `GitContext` at `:64` *before* the clone and calls `ctx.defaultBranch()` through it. The proof that constructor-time validation is wrong. No changes.
- `adws/gitContext/worktreeProbeOps.ts` — `resolveGitDir`/`currentBranchSymbolic`/`worktreeRegistration` (`:13-63`) swallow throws by design and legitimately probe absent worktree paths. No changes; their behaviour is pinned as a regression guard.
- `adws/gitContext/worktreeQueryOps.ts`, `adws/gitContext/worktreeCreateOps.ts`, `adws/gitContext/worktreeRemoveOps.ts`, `adws/gitContext/worktreeResetOps.ts` — verified: every one runs its commands from `baseCwd` or an already-created worktree path; none deliberately spawns into a directory it expects to be absent. Read-only reference. No changes.
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — `:524-528` ("surfaces exec errors at the system boundary", `gh: unauthenticated`) and `:530-536` ("does not mutate process.env when exec throws"). Both inject plain `Error`s with **no `code`**, so both must stay green **unchanged** — the guard that the rewrap is not a blanket wrap.
- `adws/gitContext/__tests__/repoApiCwd.test.ts` — `:108-115` `makeConditionalExec` throws a bare `new Error('spawnSync /bin/sh ENOENT')` (no `code`) and its repo-API cwd is a real `mkdtemp` root that exists, so it is doubly unaffected. Must stay green **unchanged**.
- `adws/gitContext/__tests__/gitContext.test.ts` — construction-validation suite (`:50-101`). Must stay green **unchanged**: this fix adds no construction-time validation.
- `features/per-issue/step_definitions/feature-775.steps.ts` — **`:334-337` is the critical cross-feature coupling.** `the workspace-git operation fails with a spawn working-directory failure` asserts `(w.lastError as NodeJS.ErrnoException).code === 'ENOENT'`, and `buildContext` (`:110-123`) passes only `{ exec }` — real `fs`, real `mkdtemp` roots — so `@adw-775` §10 will now hit the rewrap for real. It stays green **only if the rewrapped error preserves `code: 'ENOENT'`**. Do not change this file; make the fix satisfy it.
- `features/per-issue/feature-775.feature` — §10 (`:441-455`), the real-spawn pre-clone git read. Reused as this issue's regression guard. No changes.
- `features/per-issue/step_definitions/gitContextSharedWorld.ts` — `FRAMEWORK_ROOT`/`TARGET_REPOS_ROOT` imaginary sentinels (`:10-11`) and `makeNoOpFsDeps()` with `existsSync: () => false` (`:107-113`), imported by 14 per-issue step-def files. The reason a pre-spawn guard is not viable. No changes; all 14 families must stay green unchanged.
- `features/regression/vocabulary.md` — the phrase registry `generate_step_definitions` validates step phrases against; `G18` (`the ADW codebase is checked out`) and `T22` (`the ADW TypeScript type-check passes`, defined in `feature-504.steps.ts`) are reused, never redefined.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — the conditional doc that **owns** `adws/gitContext/**` and `adws/gitContext/__tests__/**`. Read before editing; update after (`## Overview` chokepoint description, `## Responsibilities`, `### Package-private operation modules`, `## Gotchas`).
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — conditional doc for the launch-boundary constructor and the `spawnSync ENOENT` wrong-base-repo class; context for why this error shape was historically confusing.
- `README.md` — `:634-672` the `gitContext/` file tree (a new module and a new test file each need one line) and `:17` the GitContext bullet.
- `.adw/coding_guidelines.md` — binding: clarity, purity, guard clauses, max ~2 nesting levels, no `any`, meaningful error messages at system boundaries.
- `.adw/commands.md` — project-specific validation commands.

### New Files
- `adws/gitContext/workingDirectoryGuard.ts` — the pure diagnosis module: `WorkingDirectoryContext`, `isSpawnEnoent`, `describeMissingWorkingDirectory`, `rewrapMissingWorkingDirectory`. No `fs`, no spawn, no ADW-core imports; the existence probe is injected. A separate module rather than more code in `gitContext.ts`, which is already 634 lines against a 300-line guideline, and which the package's `*Ops.ts` convention already keeps thin.
- `adws/gitContext/__tests__/workingDirectoryGuard.test.ts` — the pure-message suite plus the `GitContext`-level wiring assertions (rewrap fires, pass-throughs stay verbatim, no fs probe on success, probes still swallow).
- `features/per-issue/feature-777.feature` — **already authored** by the scenario phase; ten sections (§1-§9 plus the §T type-check backstop) that this plan's acceptance criteria in step 6 mirror one-to-one. Read it before implementing: its scope notes carry the harness contract the step definitions must honour, and §2/§4/§6/§8 each foreclose a specific near-miss implementation.
- `features/per-issue/step_definitions/feature-777.steps.ts` — its step definitions, generated against the authored feature file.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the owning documentation and confirm the RED state
- Read `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` (owns `adws/gitContext/**`) and `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md`.
- Read `.adw/coding_guidelines.md` and follow it for every edit below.
- Read `features/per-issue/feature-777.feature` in full — its scope notes carry the harness contract the step definitions must honour.
- Run the "Reproduce first" command in **Validation Commands** and confirm the message names neither the directory nor the repo. Do not proceed until you have seen the RED output.

### 2. Add the pure diagnosis module (`adws/gitContext/workingDirectoryGuard.ts`)
- File-level JSDoc: Node reports a nonexistent spawn cwd as an ENOENT on the shell binary (message differs per runtime, `code` does not); this module turns that one error into an actionable one and leaves every other failure alone. State that it is pure — no `fs`, no spawn; the existence probe is injected.
- Export `interface WorkingDirectoryContext { cwd, command, owner, repo, selfHost }` — exactly the five facts the message needs. Deliberately **no** `basePath`/`frameworkRepoRoot`: the message does not classify which kind of directory is missing (see the Solution Statement and `feature-777.feature` §2).
- Export `isSpawnEnoent(error: unknown): boolean` — a structural check: `typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'`. Match the codebase idiom at `adws/core/authGate.ts:67` and `adws/triggers/spawnGate.ts:38`. Comment **why** it keys off `code` and not the message (node vs bun message divergence, verified 2026-07-30). Use a structural test rather than `instanceof Error` so an injected `ExecFn` seam that throws a plain shaped object is still diagnosed.
- Export `describeMissingWorkingDirectory(ctx: WorkingDirectoryContext): string` — a single template, no branching:
  `GitContext: working directory does not exist: {cwd} ({owner}/{repo}, selfHost={selfHost}) — has a workflow ever cloned this workspace on this host? [while running: {command}]`
  Truncate the command with a private helper at a `MAX_COMMAND_CHARS = 120` module constant (append `…` when truncated).
- Export `rewrapMissingWorkingDirectory(error: unknown, ctx: WorkingDirectoryContext, exists: (path: string) => boolean): unknown` — guard clauses, no nesting:
  - `if (!isSpawnEnoent(error)) return error;`
  - `if (exists(ctx.cwd)) return error;`
  - otherwise return `Object.assign(new Error(describeMissingWorkingDirectory(ctx)), { code: 'ENOENT', syscall: original.syscall, path: original.path, cause: original })`.
  **Do not write `new Error(msg, { cause })`** — the repo's tsconfigs are `target/lib: ES2020` (`tsconfig.json`, `adws/tsconfig.json`) and the `ErrorOptions` overload is ES2022; verified in this worktree, it fails as `TS2554: Expected 0-1 arguments, but got 2`. `Object.assign` gives the same result and type-checks.
  JSDoc must state the contract: **returns the original error untouched in every case except a confirmed missing cwd**, and the returned error **preserves `code: 'ENOENT'`** so existing ENOENT handling — including `@adw-775` §10 — keeps working.

### 3. Wire the guard into the spawn chokepoint (`adws/gitContext/gitContext.ts`)
- Import `rewrapMissingWorkingDirectory` from `./workingDirectoryGuard`.
- In `#run` (`:162-169`), hoist the resolved cwd into a local (`const cwd = opts.cwd ?? this.#basePath;`) so the same value is passed to the exec and to the diagnosis, then wrap only the `this.#exec(...)` call:
  ```ts
  try {
    return this.#exec(command, { cwd, env, input: opts.input }).trim();
  } catch (error) {
    throw rewrapMissingWorkingDirectory(
      error,
      { cwd, command, owner: this.#owner, repo: this.#repo, selfHost: this.#selfHost },
      this.#fsDeps.existsSync,
    );
  }
  ```
- Pass the **resolved** `cwd`, never `this.#basePath`. `feature-777.feature` §2 exists to kill a check written against `#basePath`: with an explicit worktree path the missing directory is the worktree, and that is the path the error must name.
- Use `this.#fsDeps.existsSync`, **not** a direct `fs` import: the seam already exists (`:117`, `:130`) and keeps the probe hermetically testable.
- Do **not** touch `#runRepoApi` — it delegates to `#run` (`:181-183`) and inherits the diagnosis for free.
- Probe **at each spawn**; do not resolve existence once and cache the verdict (`feature-777.feature` §4 — the cron and webhook both hold a context across the clone `ensureTargetRepoWorkspace` performs, so a cached "absent" verdict would make the workspace unreachable for the life of the process).
- Do **not** add any constructor-time validation, and do **not** probe before the spawn. Extend the class JSDoc (`:1-20`) with one sentence: a spawn failure caused by a missing working directory is rewrapped into an error naming the path and repo identity, preserving `code: 'ENOENT'`; every other failure propagates verbatim.
- Confirm the rewrap sits *inside* `#run`, **below** the ops modules' own `try`/`catch` blocks, so probe ops keep swallowing it (`feature-777.feature` §8: a validation placed in a public wrapper or in `worktreePathFor` would let the throw escape `worktreeProbeOps` and kill the cron loop, as in vestmatic #187).

### 4. Add the unit suite (`adws/gitContext/__tests__/workingDirectoryGuard.test.ts`)
Pure-module tests (no `GitContext`):
- The message contains the cwd, `owner/repo`, `selfHost=<bool>`, and the "has a workflow ever cloned this workspace on this host?" question — for a base-path cwd and for an explicit worktree cwd alike (the §1/§2 pin: one shape, no classification).
- A command longer than 120 chars is truncated with `…`; a short one is verbatim.
- `isSpawnEnoent` is true for `{ code: 'ENOENT' }`-shaped errors and false for a bare `new Error('spawnSync /bin/sh ENOENT')` (no `code`) — the message-vs-code pin.
- `rewrapMissingWorkingDirectory` returns the **same object reference** when the error is not a spawn ENOENT, and when `exists(cwd)` is true.
- The rewrapped error has `code === 'ENOENT'` and `cause` === the original error object.

`GitContext`-level wiring tests (spy `ExecFn` that throws `Object.assign(new Error('spawnSync /bin/sh ENOENT'), { code: 'ENOENT', syscall: 'spawnSync /bin/sh', path: '/bin/sh' })`, real `mkdtemp` roots with `{owner}/{repo}` deliberately absent):
- A workspace-scoped git op (`getCurrentBranch()`) throws a message containing `ctx.basePath`, `acme/webapp`, and `selfHost=false`, and still has `code === 'ENOENT'`.
- An op given an explicit, absent worktree path (`getCurrentBranch(worktreePath)`) names **that** path and not `basePath`, with the same message shape.
- A context built while the workspace was absent reads it successfully once `mkdirSync` creates it — no cached existence verdict (§4).
- A non-ENOENT throw (`new Error('gh: unauthenticated')`) propagates with its message intact.
- An ENOENT-coded throw whose `cwd` **does** exist (create the workspace with `mkdirSync`) propagates verbatim — the "not a blanket wrap" pin.
- No fs probe on the happy path: inject `fsDeps` whose `existsSync` increments a counter, run a successful op, assert the counter is `0`.
- Construct-before-clone still works: constructing a context for an absent workspace does not throw, and a repo-API op (`defaultBranch()`) against an existing framework root succeeds — the `repoWorkspace.ts` flow pin.
- Swallowing probes still swallow: with the ENOENT-throwing exec, `worktreeRegistration(path)` returns `'missing'`, `resolveGitDir(path)` returns `null`, and `listWorktrees()` returns `[]`.

### 5. Verify the pinned neighbours are untouched
- Run `adws/gitContext/__tests__/gitContextOperations.test.ts`, `repoApiCwd.test.ts` and `gitContext.test.ts` and confirm they pass **without edits**. If any needs editing, the rewrap is firing too widely — narrow it rather than changing the test.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-775"` and confirm all scenarios pass **without edits**, especially §10 (`the workspace-git operation fails with a spawn working-directory failure` → `code === 'ENOENT'`). This is the single most likely regression from this change.

### 6. Generate the step definitions for the authored `@adw-777` scenarios
- Read `features/per-issue/feature-777.feature` and implement `features/per-issue/step_definitions/feature-777.steps.ts` against it.
- Keep the file **self-contained**: its own `@adw-777` `Before`/`After` and module-private world; do **not** import `gitContextSharedWorld.ts` (imaginary sentinel roots and an `existsSync: () => false` stub — this feature needs real directories and a truthful probe). Follow `feature-775.steps.ts`'s fixture shape: two `mkdtempSync` roots per scenario (`targetReposDir`, `frameworkRepoRoot`), `{owner}/{repo}` created or not per the Given, `rmSync` both in `After`.
- Assert on **`code`, never on the runtime's own message**, for any "still an ENOENT" step; assert on the *new* message only for the rewrapped error, which this repo produces and therefore controls.
- Reuse `G18` and `T22` from `features/regression/vocabulary.md`; never redefine `T22` (it lives in `feature-504.steps.ts:1126` — redefining it is an `AmbiguousStepDefinition`).

The acceptance criteria, mapped one-to-one onto the authored sections (verified against `feature-777.feature` while writing this plan):
- **AC1 (headline) → §1.** A workspace-scoped git read for a repo whose workspace is not on this host fails with an error that names the missing directory, names `acme/webapp`, reports `selfHost=false`, and asks whether the workspace was ever cloned on this host. RED before on all four (today the whole message is `spawnSync /bin/sh ENOENT`).
- **AC2 → §2.** A read against a **missing worktree** under an existing workspace names the *worktree* path, names `acme/webapp`, and carries the same question. This is what forecloses a check written against `#basePath` instead of the resolved cwd. RED before.
- **AC3 → §3.** The real `ensureRepoWorkspace` flow still runs for a never-cloned repo and records its clone — no constructor-time validation. GREEN before and after.
- **AC4 → §4.** A context built before the workspace existed reads it once it appears — the verdict is re-evaluated per spawn, never cached at construction. GREEN before and after.
- **AC5 → §5.** Repo-API operations (`fetch-issue-comments`, `default-branch`, `issue-comment`, `apply-label`, `authenticated-user`) are unaffected on a host with no clone — the #775 outage is not resurrected one issue later. GREEN before and after.
- **AC6 → §6.** A git command that fails *inside a directory that exists* still reports its own failure (verified 2026-07-30: that failure arrives with status 128 and **no** error code, so `isSpawnEnoent` already excludes it; the `exists(cwd)` probe is the second guard). GREEN before and after.
- **AC7 → §7.** A self-host context still reads its own framework checkout — the check is structurally a no-op where `basePath === frameworkRepoRoot`. GREEN before and after.
- **AC8 → §8.** Two scenarios: the takeover probes still answer `missing` for an absent worktree instead of raising, and `listWorktrees()` still answers empty for a never-cloned base path (the same guard at the `#basePath` spawn site the janitor sweeps hit). The rewrap sits below their `try`/`catch`, never in a public wrapper or in `worktreePathFor`. GREEN before and after.
- **AC9 → §9.** The enriched failure keeps `code === 'ENOENT'`, **names the missing workspace directory**, and **carries the original spawn failure as its `cause`**. The `code` half is what keeps `feature-775.steps.ts:334-337` classifying it, so merged `@adw-775` §10 stays green without edits. **GREEN before on the code; RED before on the message and the `cause`** — today there is no wrapper at all — so the scenario as a whole is RED before and must be GREEN after.
- **AC10 → §T (T22).** The ADW TypeScript type-check passes.

Two criteria have no scenario and belong only in the unit suite — `feature-777.feature`'s last scope note, items (c) and (d), records the same split:

- A **successful** command performs no filesystem existence probe (counting `fsDeps` spy, expect 0) — the happy path is untouched.
- An **ENOENT-coded failure whose working directory does exist** propagates verbatim. A real spawn cannot produce that combination, so it needs the injected exec of step 4; it is the complement of §6, which covers the same guard for a non-ENOENT failure.

Message truncation at `MAX_COMMAND_CHARS` is likewise unit-only: the scenarios assert message *components*, never the sentence.

### 7. Update the owning documentation
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`: extend the `## Overview` `#run` bullet with the rewrap contract; add a `## Responsibilities` line for it; add `workingDirectoryGuard.ts` to `### Package-private operation modules`; add a `## Gotchas` entry recording that (a) detection keys off `code === 'ENOENT'` because the message differs between node and bun, (b) a pre-spawn `existsSync` guard is **not** viable because every GitContext test drives imaginary paths and `makeNoOpFsDeps` returns `existsSync: () => false`, and (c) `code` must stay `'ENOENT'` on the rewrapped error or `@adw-775` §10 goes RED.
- `README.md`: add `workingDirectoryGuard.ts` to the `gitContext/` tree (`:634-672`, alphabetical among the package files) and `workingDirectoryGuard.test.ts` to the `__tests__/` list; extend the GitContext bullet at `:17` with one clause about the actionable missing-workspace error. Audit the final diff of `README.md`: additions only, no incidental deletions of lines documenting other files.
- Do not edit `.adw/conditional_docs.md` by hand — the document phase owns it.

### 8. Run the Validation Commands
- Execute every command in **Validation Commands**, top to bottom, and confirm each exits cleanly.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

**Reproduce first (RED, before any code change):**
```bash
cat > repro777.ts <<'EOF'
import { GitContext } from './adws/gitContext/index.ts';
const ctx = new GitContext({
  owner: 'acme', repo: 'never-cloned', selfHost: false,
  token: 'unused-for-this-repro',
  gitIdentity: { authorName: 'ADW Bot', authorEmail: 'bot@adw.dev', committerName: 'ADW Bot', committerEmail: 'bot@adw.dev' },
  frameworkRepoRoot: process.cwd(),
  targetReposDir: '/tmp/adw-777-repos-does-not-exist',
});
console.log('basePath:', ctx.basePath);
try { ctx.getCurrentBranch(); } catch (e) {
  const err = e as NodeJS.ErrnoException;
  console.log('MESSAGE :', err.message);
  console.log('code    :', err.code);
  console.log('names the missing dir? ', err.message.includes(ctx.basePath));
  console.log('names the repo?        ', err.message.includes('acme/never-cloned'));
}
EOF
bunx tsx repro777.ts
```
Expected **before**: `MESSAGE : spawnSync /bin/sh ENOENT`, both `names the …?` lines `false`.
Expected **after**: the message begins `GitContext: working directory does not exist: /tmp/adw-777-repos-does-not-exist/acme/never-cloned (acme/never-cloned, selfHost=false) — has a workflow ever cloned this workspace on this host?`, `code : ENOENT`, both `names the …?` lines `true`.

**Then remove the scratch file and confirm the tree is clean:**
```bash
git rm -f --ignore-unmatch repro777.ts 2>/dev/null; git checkout -- . 2>/dev/null; git status --porcelain repro777.ts
```
Expected: no output.

**Static checks:**
```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run build
bun run lint:git-guard
```

**Unit tests (whole suite — zero regressions):**
```bash
bun run test:unit
```

**Unit tests, the directly affected package (must include the new suite, all green):**
```bash
bunx vitest run adws/gitContext
```

**BDD — this issue's scenarios (must be GREEN after the fix):**
```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-777"
```

**BDD — the coupled family that must stay GREEN *without edits* (the `code === 'ENOENT'` contract at `feature-775.steps.ts:334-337`):**
```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-775"
```

**BDD — the GitContext families that share `gitContextSharedWorld.ts`; all must stay GREEN *unmodified* (the proof the rewrap does not misfire on spy execs and imaginary paths):**
```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-659 or @adw-661 or @adw-662 or @adw-663 or @adw-664"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-691 or @adw-692 or @adw-693 or @adw-694 or @adw-695"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-696 or @adw-697 or @adw-698 or @adw-699 or @adw-700"
```

**BDD — regression suite:**
```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

**Confirm no file was accidentally modified beyond scope:**
```bash
git diff --stat origin/dev
```
Expected paths only: `adws/gitContext/workingDirectoryGuard.ts`, `adws/gitContext/gitContext.ts`, `adws/gitContext/__tests__/workingDirectoryGuard.test.ts`, `features/per-issue/feature-777.feature`, `features/per-issue/step_definitions/feature-777.steps.ts`, `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`, `README.md`, this spec file, and whatever the document phase adds to `.adw/conditional_docs.md`. Anything else — in particular a deletion inside `.claude/commands/` or a `-` line in `README.md` for a file no longer documented anywhere — is out of scope and must be reverted before the PR.

## Notes
- `.adw/coding_guidelines.md` is binding. The new module is pure (no `fs`, no spawn — the probe is injected), uses guard clauses with no nesting beyond one level, exports explicit interfaces, uses no `any`, and stays well under 300 lines. `gitContext.ts` is already 634 lines against that guideline, which is the second reason the diagnosis lives in its own module rather than inline.
- **No new libraries.** Were one ever needed, `.adw/commands.md` gives `bun add <package>`.
- **The one contract this fix must not break:** `features/per-issue/step_definitions/feature-775.steps.ts:334-337` asserts `code === 'ENOENT'` on a **real** spawn failure in a **real** missing directory (its `buildContext` at `:110-123` injects only `exec`, so real `fs` is used). Preserving `code` on the rewrapped error is what keeps `@adw-775` §10 green; it is also semantically honest — the failure *is* an ENOENT, it just now says which directory.
- **Detect on `code`, never on the message.** Verified in this worktree on 2026-07-30 (darwin): node raises `spawnSync /bin/sh ENOENT`, bun raises `ENOENT: no such file or directory, posix_spawn '/bin/sh'`; both carry `code: 'ENOENT'`, `syscall: 'spawnSync /bin/sh'`, `path: '/bin/sh'`. A message match would make the fix depend on which runtime `bunx cucumber-js` resolves.
- **`new Error(msg, { cause })` does not compile here.** Both tsconfigs are `target`/`lib` `ES2020`; the `ErrorOptions` overload is ES2022. Verified: `TS2554: Expected 0-1 arguments, but got 2`. Use `Object.assign(new Error(msg), { code, syscall, path, cause })`.
- **Why not validate in the constructor** — `ensureTargetRepoWorkspace` (`targetRepoManager.ts:62-71`) builds a context at `:64` and hands `() => ctx.defaultBranch()` to `ensureRepoWorkspace`, whose whole purpose is to create the missing workspace. Constructor validation would make the clone path unreachable. The issue calls this out; the code confirms it.
- **The command string is safe to include in the message.** Credentials travel in the child environment (`commandEnv`, `gitContext.ts:143-152`) or over stdin (`opts.input` — e.g. `setSecret`'s value, `commentOnIssue`'s body), never in argv. Only the command is printed, never `input`, never `env`.
- **`repoWorkspace.ts` is genuinely untouched.** `ensureRepoWorkspace` runs its own injected `execFn` (`:115`), not `#run`; `cloneRepo` spawns with no `cwd` at all (`:89`); the fetch branch is gated behind `isRepoCloned` (`:119`). Nothing in the clone path reaches the new code.
- **`processCleanup.ts` is untouched** — `killProcessesInDirectory` shells out to `lsof` with no `cwd` and swallows everything (`:9-37`).
- **`#runRepoApi` needs no separate handling.** Post-#775 it spawns at `frameworkRepoRoot`, which exists, so the rewrap never fires for repo-API calls in practice — satisfying the issue's "should only fire for commands that genuinely need a local repo" without a second code path. Re-verified in this worktree: a pre-clone `fetchIssueComments` now reaches GitHub and fails on credentials, never on a missing directory.
- **Out of scope, deliberately:** a `cwd` that exists but is a file (`ENOTDIR`), a `cwd` that exists but is not a git repository, and any change to *whether* an operation fails. This issue is about what the failure says, not about making failing operations succeed.
