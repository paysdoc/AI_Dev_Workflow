# Bug: Repo-API `gh` commands run from the target workspace cwd, so Cancel/Retry directives crash before the first clone

## Metadata
issueNumber: `775`
adwId: `uvv9hm-repo-api-gh-commands`
issueJson: `{"number":775,"title":"Repo-API gh commands must not depend on a target workspace cwd — Cancel/Retry crashes before first clone","body":"# Repo-API gh commands must not depend on a target workspace cwd — Cancel/Retry directives crash before first clone\n\n## Symptom\n\nPosting a Cancel directive comment on `paysdoc/paysdoc.nl#28` crashed the webhook server on the production host:\n\n```\nError: Failed to fetch comments for issue #28: Error: spawnSync /bin/sh ENOENT\n    at fetchIssueCommentsRest (adws/github/issueApi.ts:235)\n    at IncomingMessage.<anonymous> (adws/triggers/trigger_webhook.ts)\n```\n\n`spawnSync /bin/sh ENOENT` is Node's error for a **nonexistent spawn cwd**, not a missing shell.\n\n## Root cause\n\n`fetchIssueCommentsRest` → `gitContextForRepo(repoInfo).fetchIssueComments(issueNumber)` → `GitContext.#run` executes `gh api repos/{owner}/{repo}/issues/{n}/comments` with `cwd = this.#basePath` (`adws/gitContext/gitContext.ts`, `#run`, `opts.cwd ?? this.#basePath`). For a non-self-host repo, basePath is `TARGET_REPOS_DIR/{owner}/{repo}` — a directory that only exists after the first workflow for that repo has cloned a workspace on that host.\n\nThe Cancel/Retry directive path in `trigger_webhook.ts` (and the equivalent cron path) fetches issue comments **before** any workspace exists, so on a host that has never run a workflow for that repo, the spawn cwd does not exist and every directive comment fails.\n\nVerified both directions on 2026-07-30: the identical call succeeds when `TARGET_REPOS_DIR/paysdoc/paysdoc.nl` exists, and reproduces `spawnSync /bin/sh ENOENT` exactly when it does not.\n\n## Why this is a design bug, not just a missing directory\n\n`gh api` (and `gh issue view -R owner/repo`, etc.) are pure GitHub API calls — they need **no repository working directory at all**. Tying their cwd to the target workspace couples directive handling (\"stop this workflow\") to workflow-lifecycle state (\"a workspace was cloned here once\"), which is exactly backwards: Cancel must work *especially* when the local state is absent or broken.\n\n## Desired behavior\n\n- GitContext runs repo-independent gh commands (API calls that carry explicit `owner/repo` in the command string) from a cwd that always exists — e.g. the framework repo root — instead of the target workspace basePath.\n- Git commands and workspace-scoped gh commands keep their current basePath/worktree cwd semantics.\n- A Cancel or Retry comment on a registered repo must be processable on a host that has never cloned that repo's workspace.\n\n## Relevant files\n\n- `adws/gitContext/gitContext.ts` — `#run` cwd resolution; the repo-API command methods (`fetchIssueComments`, `issueTitle`, `issueHasLabel`, `defaultBranch`, etc.)\n- `adws/gitContext/commands/issueCommands.ts` — command strings already embed explicit repo identity\n- `adws/github/issueApi.ts` — `fetchIssueCommentsRest` (the crash site)\n- `adws/triggers/trigger_webhook.ts` — Cancel/Retry directive path that triggers the fetch pre-clone\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-07-30T11:31:04Z","comments":[{"author":"paysdoc","createdAt":"2026-07-30T11:36:59Z","body":"## Continue"}],"actionableComment":null}`

## Bug Description
`GitContext` routes **every** command — git and `gh` alike — through one private chokepoint, `#run` (`adws/gitContext/gitContext.ts:152-159`), which spawns with `cwd: opts.cwd ?? this.#basePath`. For a target (non-self-host) context, `#basePath` is `join(targetReposDir, owner, repo)` (`resolveBasePath`, `gitContext.ts:89-93`) — a directory that only exists **after** ADW has cloned a workspace for that repo on that host.

Roughly 38 of the `#run` call sites are pure GitHub REST/GraphQL calls that already carry their repository identity inside the command string (`gh api repos/{owner}/{repo}/…`, `gh issue view N --repo owner/repo`, `gh pr list --repo owner/repo`, …). Those calls need no repository working directory whatsoever, yet they are spawned into a directory that may not exist.

**Expected behaviour:** posting `## Cancel` or `## Retry` on an issue in a registered repository is processed on any host, including one that has never cloned that repository's workspace — cancel is precisely the directive you reach for when local state is absent or broken.

**Actual behaviour:** the directive path calls `fetchIssueCommentsRest` → `gitContextForRepo(repoInfo).fetchIssueComments(n)` → `#run('gh api repos/…/comments --paginate', { cwd: <nonexistent> })`, and Node fails the spawn before the shell ever runs:

```
Error: Failed to fetch comments for issue #28: Error: spawnSync /bin/sh ENOENT
    at fetchIssueCommentsRest (adws/github/issueApi.ts:235)
    at IncomingMessage.<anonymous> (adws/triggers/trigger_webhook.ts)
```

The throw happens inside the synchronous `issue_comment` branch of the `req.on('end', …)` listener (`trigger_webhook.ts:181-211`), which has no enclosing `try`/`catch`, so the uncaught exception takes down the whole webhook server process.

`spawnSync /bin/sh ENOENT` is Node's error for a **nonexistent spawn cwd**, not a missing shell — confirmed in this worktree:

```
$ node -e "require('child_process').execSync('gh --version', { cwd: '/tmp/definitely-not-here-775' })"
ERR: spawnSync /bin/sh ENOENT
code: ENOENT syscall: spawnSync /bin/sh path: /bin/sh
```

## Problem Statement
The GitContext PRD's base-path authority ("identity decides the base path; no cwd fallback") was applied uniformly to **all** commands, but only *workspace-scoped* commands actually have a working directory in their contract. Repo-API `gh` calls are addressed by the identity **inside the command string**; giving them a workspace cwd adds a dependency the operation does not have, and makes directive handling ("stop this workflow") depend on workflow-lifecycle state ("a workspace was cloned here once") — the exact inversion the issue describes.

The consequence is not limited to Cancel/Retry: on a host that has never cloned a given target repo, *every* GitContext GitHub-API operation for that repo fails the same way — issue polling (`listOpenIssues`), label reads, PR queries, board moves. Cancel is simply the first path that runs before `ensureRepoWorkspace` has ever been reached.

## Solution Statement
Split the single cwd rule into the two rules the operations actually have, inside the same package that already owns them:

1. Keep `#run(command, { cwd })` exactly as-is — `opts.cwd ?? this.#basePath` — for git commands and workspace-scoped operations. Nothing about worktrees, commits, branches, merges or probes changes.
2. Add a second, thin chokepoint `#runRepoApi(command, { input?, usePat? })` that delegates to `#run` with `cwd` **pinned to the injected `frameworkRepoRoot`** (a directory that always exists: `REPO_ROOT` is derived from the running module's own location, `adws/core/environment.ts:20`). It deliberately accepts no `cwd` override — a fixed cwd is the whole point.
3. Route the ~38 repo-API `#run` call sites through `#runRepoApi`. Every one of them already embeds `owner/repo` in the command string (or needs no repo at all: `gh api user`, `gh api graphql`), so **which repository is addressed does not change** — only the spawn directory does.

This is a change to one file (`adws/gitContext/gitContext.ts`) plus the test/scenario updates the changed contract forces. No signature changes, no new exports, no call-site changes outside the package, no new dependencies. Self-host contexts are bit-for-bit unaffected (`basePath === frameworkRepoRoot` for them already).

Because the previous contract was pinned by existing unit tests and by **eight** merged BDD feature families (`@adw-659`, `@adw-663`, `@adw-664`, `@adw-691`, `@adw-692`, `@adw-695`, `@adw-697`, `@adw-700` — six of which reuse `feature-659.steps.ts`'s step definitions without owning a step-def file for them), every site that asserts base-path cwd about a **gh** operation must be migrated. Their shared intent — "per-command auth + explicit, non-ambient, context-owned cwd + two-context token isolation" — is preserved in every case; only the directory the contract names moves. Two migration shapes apply: `@adw-659`/`@adw-664`, whose scenarios also assert per-repo cwd *isolation*, are re-pointed at a git read op (where per-repo cwd is genuinely meaningful); the rest keep their gh operation and swap the cwd assertion to the framework root (steps 7-9).

An explicit anti-drift guard is added: a unit test asserting every method routed through `#runRepoApi` emits a command carrying explicit `owner/repo` (excluding the four genuinely repo-free GraphQL/`user` methods). Without it, a future method that lets `gh` *infer* the repo from the cwd would silently resolve to `paysdoc/AI_Dev_Workflow` (the framework repo's own remote) instead of failing loudly.

## Steps to Reproduce
1. Pick a repo that is registered with ADW but not cloned on this host, e.g. ensure `$TARGET_REPOS_DIR/paysdoc/paysdoc.nl` does **not** exist (`TARGET_REPOS_DIR` defaults to `~/.adw/repos`, `adws/core/environment.ts:161`).
2. From the repo root, write a scratch script `repro775.ts`:
   ```ts
   import { gitContextForRepo } from './adws/github/gitContextFactory.ts';
   const ctx = gitContextForRepo({ owner: 'paysdoc', repo: 'paysdoc.nl' }, { selfHost: false });
   console.log('basePath:', ctx.basePath);
   console.log(ctx.fetchIssueComments(28).slice(0, 120));
   ```
3. Run `NODE_OPTIONS="--import tsx" bunx tsx repro775.ts`.
4. Observe the throw: `Error: spawnSync /bin/sh ENOENT` — the `gh api repos/paysdoc/paysdoc.nl/issues/28/comments --paginate` command never ran, because `cwd` (`basePath`) does not exist.
5. `mkdir -p "$TARGET_REPOS_DIR/paysdoc/paysdoc.nl"` and re-run: the identical call now succeeds. The only variable is the existence of the spawn cwd.
6. Delete the scratch file and the scratch directory.

**Production repro (what actually happened):** post `## Cancel` on an issue in a registered-but-never-cloned repo. `trigger_webhook.ts:198` calls `fetchIssueCommentsRest` synchronously inside the `req.on('end')` listener, the ENOENT propagates uncaught, and the webhook server process dies.

**Hermetic repro (drives the same OS contract, no network):** construct a `GitContext` whose `targetReposDir` is a real `fs.mkdtempSync` root under which `{owner}/{repo}` is deliberately **not** created, and inject an `ExecFn` that records `{command, cwd, env}` and then **really spawns** a harmless stand-in — `execSync("printf '%s' '[]'", { ...options })`, passing `options.cwd` through unchanged. The production failure is **cwd-borne, not command-borne**: `spawnSync` fails while spawning `/bin/sh` in a nonexistent working directory, before the command string is ever parsed. So the stand-in reproduces the exact failure with no `gh` binary, no network, no token and no PATH manipulation, and returns a valid `[]` payload once the fix lands. `ctx.fetchIssueComments(28)` throws before the fix and returns `[]` after it. This is the shape the `@adw-775` step definitions use (`features/per-issue/feature-775.feature` §1, §2, §10).

**Assert the error code, never the message.** Verified 2026-07-30 on darwin: the thrown error carries `code === 'ENOENT'` and `syscall === 'spawnSync /bin/sh'` under both runtimes, but the *message* differs — node says `spawnSync /bin/sh ENOENT` (the production stack trace) while bun says `ENOENT: no such file or directory, posix_spawn '/bin/sh'`. Every "fails with a spawn working-directory failure" assertion must test `err.code === 'ENOENT'`; a message match would make the proof depend on which runtime `bunx cucumber-js` resolves.

## Root Cause Analysis
**One cwd rule was applied to two kinds of operation.**

- Issue **#658** established the base-path authority: identity in → base path out, no optional base path, no cwd fallback (`adws/gitContext/types.ts:49-93`). That contract is correct and remains correct — for commands that *have* a working directory.
- Issue **#659** introduced `#run` as the single spawn chokepoint injecting per-command auth and an explicit cwd, replacing the ambient `process.cwd()`/process-global `GH_TOKEN` model. To eliminate the ambient cwd it gave *every* command `this.#basePath`, including the `gh` API calls migrated in #660–#662 and later slices.
- For a target repo, `#basePath = join(targetReposDir, owner, repo)` is **lifecycle state**, not identity: it comes into existence only when `ensureRepoWorkspace` clones (`adws/gitContext/repoWorkspace.ts:104-127`). So every repo-API command acquired an implicit precondition — "a workflow has already cloned this repo on this host" — that its own contract never had.
- Node's `child_process` resolves the spawn cwd **before** exec'ing the shell; a missing directory therefore fails as `spawnSync /bin/sh ENOENT`, which reads like a missing shell and hid the real cause.

The Cancel/Retry directive path is the first consumer that runs *before* any clone, so it is where the latent precondition surfaced. The same latent failure exists for every pre-clone GitHub-API call (`listOpenIssues` at cron poll time, `issueHasLabel`, `defaultBranch` in `ensureRepoWorkspace`'s fetch branch, board moves).

Two secondary facts that shape the fix's scope:

- **The rest of the cancel sequence is already safe.** `handleCancelDirective` wraps worktree removal (`cancelHandler.ts:63-68`) and comment clearing (`:82-88`) in `try`/`catch`-and-continue. Once the comment fetch stops throwing, cancel completes: the worktree-removal `git worktree list` still ENOENTs on a never-cloned workspace, gets logged as a warning, and the sequence proceeds. No change is needed there.
- **The framework repo root always exists.** `REPO_ROOT` is `path.resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')` (`adws/core/environment.ts:20`) — the directory containing the code that is currently running. It is what every factory injects as `frameworkRepoRoot` (`gitContextFactory.ts:102`, `launchGitContext.ts`), so it is the natural always-exists cwd.

## Relevant Files
Use these files to fix the bug:

- `adws/gitContext/gitContext.ts` — **the fix.** `#run` (`:152-159`) cwd resolution; `resolveBasePath` (`:89-93`); the ~38 repo-API methods at `:161-165`, `:327-389`, `:501-560`, `:562-609`.
- `adws/gitContext/types.ts` — `GitContextOptions.frameworkRepoRoot` (already mandatory and non-empty-validated) and the `ExecFn` seam the tests inject. Read-only reference; the doc comment on the no-cwd-fallback contract is worth extending.
- `adws/gitContext/commands/issueCommands.ts` — proof that identity lives in the command string (`--repo ${owner}/${repo}`, `gh api repos/${owner}/${repo}/…`). Unchanged.
- `adws/gitContext/commands/prCommands.ts` — same, plus `createPRCmd`'s explicit `--head` (the reason `gh pr create` is cwd-independent). Unchanged.
- `adws/gitContext/commands/labelCommands.ts`, `adws/gitContext/commands/secretCommands.ts` — `--repo`-scoped. Unchanged.
- `adws/gitContext/commands/boardCommands.ts` — `gh api graphql` builders; repo identity travels as `-f owner=… -f repo=…` variables, never via cwd. Unchanged, but they are the exception list for the anti-drift guard.
- `adws/core/environment.ts` — `REPO_ROOT` (`:20`, module-derived, always exists) and `TARGET_REPOS_DIR` (`:161`). Read-only reference.
- `adws/github/gitContextFactory.ts` — injects `REPO_ROOT` as `frameworkRepoRoot`; `gitContextForRepo` is the constructor used by the crash path. Unchanged.
- `adws/github/issueApi.ts` — `fetchIssueCommentsRest` (`:224-237`), the reported crash site. Unchanged; it is fixed by the change beneath it.
- `adws/triggers/trigger_webhook.ts` — the Cancel (`:192-203`) / Retry (`:205-209`) directive branch that fetches comments pre-clone. Unchanged; context only.
- `adws/triggers/cancelHandler.ts` — downstream cleanup sequence; already `try`/`catch`-guarded per step. Unchanged; context only.
- `adws/gitContext/repoWorkspace.ts` — `ensureRepoWorkspace`; shows why `basePath` is lifecycle state and why `defaultBranch()` must be callable pre-clone. Read-only reference.
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — the exec-spy suite; contains the assertions that currently pin repo-API commands to `basePath` (lines 52, 195, 252, 317, 433-437, 531, 852, 900, 1116, 1186). **Must be updated.**
- `adws/gitContext/__tests__/gitReadOps.test.ts` — git read ops pinned to `basePath` (lines 133, 264, 341, 418). **Must stay green unchanged** — proof the git contract did not move.
- `adws/triggers/__tests__/webhookRepoResolver.test.ts` — `:226` "recorded command cwd equals the context basePath", driven by `defaultBranch()`. **Must be updated** (re-point at a git op).
- `features/per-issue/feature-659.feature` — scenarios at `:219`, `:235`, `:298` assert base-path cwd while driving the `"default-branch"` **gh** op. **Must be updated.**
- `features/per-issue/step_definitions/feature-659.steps.ts` — `runOp` dispatch (`:28-60`, all gh ops) and the base-path-cwd Then steps (`:237`, `:298`). **Must be updated.**
- `features/per-issue/feature-664.feature` — scenarios at `:320` and `:356` assert per-event base-path cwd, also driving `defaultBranch()`. **Must be updated.**
- `features/per-issue/step_definitions/feature-664.steps.ts` — op dispatch (`:239-250`) and the interleaved-op step (`:264-282`). **Must be updated.**
- `features/per-issue/feature-663.feature` — `:221` (`issue-comment` write), `:237` (outline over `issue-view`, `issue-create`, `label-apply`, `pr-view`, `pr-comment`), `:337`/`:339` (two-context write ops) assert base-path cwd while driving **gh** ops. Reuses `feature-659.steps.ts`'s phrases; has no step-def file of its own for them. **Must be updated.**
- `features/per-issue/feature-691.feature` — `:246` (`list-open-issues`), `:261` (outline over `list-open-issues`, `view-issue-comments`, `list-merged-prs`) — gh reads on base-path cwd. **Must be updated.**
- `features/per-issue/feature-692.feature` — `:276` outline, whose Examples mix a git op (`remote-url`, stays green) with a repo-API op (`authenticated-user` → `gh api user`, moves). Only the `authenticated-user` row is affected. `:259` (`remote-url`) is a git op and stays green. **Must be updated (split the outline).**
- `features/per-issue/feature-695.feature` — `:337` (`set-secret`, `gh secret set --repo …`). **Must be updated.**
- `features/per-issue/feature-697.feature` — `:37` (`pr-changed-files`, gh). `:58` (`stats-log`) is a **git** read and stays green. **Must be updated (`:37` only).**
- `features/per-issue/feature-700.feature` — `:342` (`default-branch` under a `process.chdir`, gh). **Must be updated.**
- `features/per-issue/step_definitions/gitContextSharedWorld.ts` — shared `W`, `makeSpyExec`, `makeFullOptions` (`selfHost: false`, exported `FRAMEWORK_ROOT = '/srv/adw/framework'`, `TARGET_REPOS_ROOT = '/srv/adw/repos'`), used by the whole `@adw-659`…`@adw-700` GitContext family. Its exported `FRAMEWORK_ROOT` is what the new framework-root Then phrase asserts against. **`feature-775.steps.ts` must NOT import it**: its roots are imaginary sentinel paths and `makeNoOpFsDeps` hardcodes `existsSync: () => false`, whereas `@adw-775` needs **real** directories — the failure being fixed is a real spawn against a real missing path.
- `features/per-issue/step_definitions/feature-699.steps.ts` — builds a **self-host** context (`:51`), where `basePath === frameworkRepoRoot`, so its reused "cwd equals the context base path" step stays green for both `current-branch` and the `gh-auth` probe (`feature-699.feature:360`, `:377`). Verified no-change.
- `features/per-issue/feature-661.feature`, `feature-693.feature`, `feature-694.feature`, `feature-696.feature`, `feature-698.feature` — base-path cwd assertions driven by **git** ops (worktree list, vcs probes, `ls-files`/`headShort`, `ls-remote`). Verified no-change.
- `features/regression/vocabulary.md` — the phrase registry `generate_step_definitions` validates new step phrases against.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — conditional doc that **owns** `adws/gitContext/**`, `adws/gitContext/commands/**`, and `gitContextFactory.ts`. Must be read before editing and updated after.
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — conditional doc for the launch-boundary constructor and the `spawnSync ENOENT` wrong-base-repo class.
- `app_docs/feature-9gjajh-webhook-triggers.md` — conditional doc that owns `trigger_webhook.ts` and `webhookRepoResolver.test.ts` (the per-event-context cwd assertion changes here).
- `.adw/coding_guidelines.md` — binding guidelines (clarity, purity, guard clauses, files under 300 lines, no `any`).
- `.adw/commands.md` — the project-specific validation commands.

### New Files
- `adws/gitContext/__tests__/repoApiCwd.test.ts` — the new unit suite: the modelled-ENOENT reproduction, the table-driven "every repo-API method spawns at the framework root" assertion, the "git/worktree ops still spawn at basePath" counter-assertion, and the anti-drift guard that every `#runRepoApi` command carries explicit `owner/repo`.
- `features/per-issue/feature-775.feature` — **already authored** by the scenario phase; twelve sections (§1-§11 plus the §T type-check backstop) that this plan's acceptance criteria in step 6 mirror one-to-one. Read it before implementing: its scope notes carry the harness contract the step definitions must honour.
- `features/per-issue/step_definitions/feature-775.steps.ts` — its step definitions (to be generated against the authored feature file).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the owning documentation and confirm the current contract
- Read `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` (owns `adws/gitContext/**`), `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md`, and `app_docs/feature-9gjajh-webhook-triggers.md`.
- Read `.adw/coding_guidelines.md` and follow it for every edit in this plan.
- Confirm the RED state before touching code by running the reproduction in **Validation Commands** ("Reproduce first").

### 2. Add the repo-API chokepoint to `GitContext` (`adws/gitContext/gitContext.ts`)
- Add a private readonly field `#repoApiCwd: string` alongside `#basePath`, assigned in the constructor from `options.frameworkRepoRoot` (already validated non-empty by `assertCompleteIdentity`). `frameworkRepoRoot` is currently **not retained** — the constructor (`:100-121`) feeds it to `resolveBasePath` and discards it — so retaining it is part of the fix. Do **not** re-derive it, do **not** read `process.cwd()`, and do **not** import `REPO_ROOT` from `adws/core/environment` inside the package: that would put a framework-global import back into `adws/gitContext` and re-couple it to the ADW checkout it was factored out of by #700. The value arrives by injection, from the factories that already pass it.
- Add the second chokepoint directly beneath `#run`:
  ```ts
  /**
   * Repo-API chokepoint — gh commands whose repository identity travels in the
   * command string (`--repo owner/repo`, `gh api repos/owner/repo/…`) or that
   * address no repository at all (`gh api user`, `gh api graphql`) are pure
   * GitHub API calls: they need no repository working directory. They run from
   * the framework repo root, which always exists, so directive handling
   * (Cancel/Retry) never depends on a target workspace having been cloned.
   *
   * Deliberately accepts no cwd override — the fixed cwd is the contract.
   */
  #runRepoApi(command: string, opts: { input?: string; usePat?: boolean } = {}): string {
    return this.#run(command, { ...opts, cwd: this.#repoApiCwd });
  }
  ```
- Leave `#run` itself untouched (`opts.cwd ?? this.#basePath`) — it remains the single spawn site and keeps injecting per-command auth and git identity for both classes.
- Extend the class-level doc comment (`:1-12`) with the two-cwd rule: workspace-scoped commands → `basePath`/explicit worktree path; repo-API commands → framework repo root.

### 3. Route every repo-API method through `#runRepoApi`
Change `this.#run(` → `this.#runRepoApi(` at exactly these methods, preserving each call's `input` / `usePat` options:
- `defaultBranch` (`:161`)
- Issue ops (`:327-381`): `fetchIssue`, `commentOnIssue`, `issueState`, `closeIssue`, `issueTitle`, `fetchIssueComments`, `issueHasLabel`, `addIssueLabel`, `createIssue`, `updateIssueBody`, `findOpenUpgradeIssue`, `deleteIssueComment`, `listOpenIssues`, `issueComments`
- `fetchMergedPRs` (`:383`), `authenticatedUser` (`:387`)
- PR ops (`:501-548`): `findPRByBranch`, `fetchPRDetails`, `fetchPRReviews`, `fetchPRReviewComments`, `commentOnPR`, `mergePR`, `approvePR` (keeps `usePat: true`), `prApprovalState`, `fetchPRList`, `fetchAllPRs`, `fetchPRChangedFiles`, `createPR` (keeps stdin `input`)
- `createLabel` (`:550`), `applyLabel` (`:554`), `setSecret` (`:558`)
- `runGraphQL` (`:562`), `runGraphQLInput` (`:567`) — both keep `usePat: true`
- `moveIssueToStatus` (`:577-609`) — all four internal `#run` calls (`projectQueryCmd`, `itemQueryCmd`, `fieldQueryCmd`, `moveStatusCmd`), each keeping `usePat: true`

Leave every other `#run` call untouched — `remoteUrl`, `remotes`, `gitConfigUser`, and all delegating git/worktree/probe/claim/read ops (`branchOps`, `commitOps`, `worktree*Ops`, `gitReadOps`, `remoteOps`, `claimOps`). Their cwd semantics (`basePath` default or an explicit worktree path) are unchanged.

### 4. Add the new unit suite (`adws/gitContext/__tests__/repoApiCwd.test.ts`)
- **Reproduction (the RED→GREEN proof).** Build a context with `targetReposDir` = a real path under `os.tmpdir()` that is deliberately **not** created, `frameworkRepoRoot` = a directory that **is** created (`fs.mkdtempSync`), and inject an `ExecFn` that models `execSync`'s contract: `if (!fs.existsSync(opts.cwd)) throw new Error('spawnSync /bin/sh ENOENT')`, else return a canned JSON payload. Assert `ctx.fetchIssueComments(28)` returns the payload (this throws before the fix). Clean up in `afterEach`. The *model* is acceptable at this layer because the `@adw-775` scenarios (`feature-775.feature` §1, §2, §10) back it with a **real** spawn of a harmless stand-in command against the same real directories — see **Steps to Reproduce**. Do not carry the modelled error's *message* into any assertion the BDD layer shares.
- **Table-driven cwd assertion.** For every method listed in step 3, invoke it against a spy exec and assert `calls[0].cwd === FRAMEWORK_ROOT` and `calls[0].cwd !== ctx.basePath` for a target context.
- **Self-host invariance.** With `selfHost: true`, assert the same methods spawn at `frameworkRepoRoot` (identical to before, since `basePath === frameworkRepoRoot`).
- **Workspace ops unmoved.** Assert `getCurrentBranch()`, `listWorktrees()`, `headShort()`, `remoteUrl()` still spawn at `ctx.basePath`, and that ops taking an explicit worktree path still spawn there.
- **No ambient cwd.** `process.chdir(os.tmpdir())` before a repo-API call; assert the recorded cwd is `frameworkRepoRoot`, not the process cwd. Restore the cwd in `afterEach`.
- **Anti-drift guard.** Iterate the repo-API methods and assert each emitted command string contains `` `${owner}/${repo}` ``, excluding the four genuinely repo-free methods (`authenticatedUser`, `runGraphQL`, `runGraphQLInput`, `moveIssueToStatus` — the latter three carry identity as GraphQL variables). This is what stops a future repo-*inferring* `gh` command from being routed here and silently resolving to the framework repo's own remote.
- **Auth/env unchanged.** Assert a repo-API call still carries `GH_TOKEN` and the four `GIT_*` vars, still honours `usePat`, and still does not mutate `process.env`.

### 5. Update the unit tests that pinned the old contract
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — change the cwd expectation from `ctx.basePath` to the injected `FRAMEWORK_ROOT` for the repo-API describes: `defaultBranch()` (`:52`), `listOpenIssues()` (`:195`), `issueComments()` (`:252`), `fetchMergedPRs()` (`:317`), `setSecret()` (`:852`), `runGraphQLInput()` (`:900`), `fetchPRChangedFiles()` (`:1116`), `createPR() with labels` (`:1186`). Rename the `it` titles to say "framework repo root" so they read as the new contract, not a patched old one.
- Same file, `two-context isolation` (`:416-438`): `defaultBranch()` now yields the same cwd for both contexts, so `expect(callsA[0].cwd).not.toBe(callsB[0].cwd)` is no longer meaningful there. Keep the token-isolation assertions on `defaultBranch()`, and move the per-context **cwd** isolation assertions onto a git op (e.g. `getCurrentBranch()`), which is what genuinely resolves per repo.
- Same file, `explicit cwd (not process.cwd())` (`:521-533`): keep the scenario, assert the recorded cwd equals `FRAMEWORK_ROOT` and is not `/tmp`. Add a sibling case driving a git op that asserts `basePath` under the same `chdir` — both halves of "never ambient".
- Leave `adws/gitContext/__tests__/gitReadOps.test.ts` (`:133`, `:264`, `:341`, `:418`) untouched; it must stay green as-is.
- `adws/triggers/__tests__/webhookRepoResolver.test.ts:221-227` — the §3a "recorded command cwd equals the context basePath" case drives `defaultBranch()`. Re-point it at a git op (`getCurrentBranch()`) so the per-event base-path intent survives, and leave the token assertion above it on `defaultBranch()`.

### 6. Generate the step definitions for the authored `@adw-775` scenarios
`features/per-issue/feature-775.feature` is **already written** (tags `@adw-775` + `@adw-uvv9hm-repo-api-gh-commands`); this step generates `features/per-issue/step_definitions/feature-775.steps.ts` against it and registers any new step phrases in `features/regression/vocabulary.md`. The acceptance criteria the feature pins, in behavioural terms, and the section that pins each:

- **AC1 — Directive works pre-clone (§1, §2).** Given a registered repository whose workspace has never been cloned on this host, when a Cancel directive's comments are fetched for that repository, then the comments are returned and no spawn working-directory failure occurs. (Before the fix: `spawnSync /bin/sh ENOENT`.) The same fetch must still succeed once the workspace *has* been cloned — the fix must not trade one broken host state for another.
- **AC2 — Repo-API calls run from a directory that exists (§4, §6).** Given the same never-cloned repository, when a repository-API operation runs (issue read, issue comment, label read, PR read, board move, `gh api user`), then it is issued from a working directory that exists and is not the target workspace, and the command still addresses the target repository — identity comes from the command, not the directory.
- **AC3 — Workspace operations are unmoved (§8, §9, §10).** Given a cloned target workspace, when a git or worktree operation runs, then it is still issued inside that workspace (or the explicitly passed worktree path) — no silent retarget onto the framework checkout.
- **AC4 — Self-host unchanged (§11).** Given a self-host context, when either class of operation runs, then both are issued from the framework repository checkout, exactly as before.
- **AC5 — No ambient working directory (§5 for repo-API, §8 for git).** Given the process working directory is changed away from both roots, when either class of operation runs, then neither command inherits the process working directory; the repo-API command records the **injected** `frameworkRepoRoot`.
- **AC6 — The repo-API spawn cwd is workspace-independent (§3).** Given the same repo-API operation is run twice, once before and once after the workspace appears on disk, then both commands record the *same* working directory, and that directory exists and is not the workspace. This is the design half of the bug and it forecloses a "probe `basePath`, fall back when missing" implementation, which would satisfy AC1, AC2 and AC4 while leaving the spawn cwd varying with workflow-lifecycle state. See the "Why not fall back…" note.
- **AC7 — Moving the cwd moves nothing else (§7).** Given a target context authenticated with its own installation token, when a repo-API command runs from the framework root, then it still carries the **target** repository's token in its child environment. The cheapest wrong way to obtain an always-exists cwd is to reach for the self-host context, which would reintroduce the `GH_TOKEN`-bleed class (vestmatic #143/#181/#187).
- **AC8 — A pre-clone git read still fails, and is never answered from the framework checkout (§10).** Given a host with no cloned workspace, when a git read runs, then it fails with a spawn working-directory failure and **no** command ran with the framework repository root as its cwd. This pins the dangerous over-fix — changing `#run`'s *default* cwd wholesale would make every git op read branches, remotes and worktrees out of the framework repo while believing it was reading the target's: a silent wrong-repo answer, strictly worse than the crash being fixed.

Harness notes for the step definitions (these mirror the feature file's own scope notes — follow those where they are more specific):
- Drive the **real** `GitContext` in-process through the injected `ExecFn` seam, as `@adw-659`/`@adw-664` do, with explicit identity and an explicit token. Do **not** drive `fetchIssueCommentsRest`: it resolves its own context through `gitContextForRepo`, whose token resolver mints an installation token for `owner/repo` and throws loudly on a fixture repo — RED for the wrong reason, and still RED after the fix.
- **Real fixture directories, production layout.** Per scenario create two `fs.mkdtempSync` roots — a `targetReposDir` and a `frameworkRepoRoot` — and construct the context with `{owner, repo, selfHost: false, token, gitIdentity, frameworkRepoRoot, targetReposDir}` so production's `resolveBasePath` computes `basePath = <targetReposDir>/<owner>/<repo>` unaided. "Never cloned" = leave that path absent; "already cloned" = `mkdirSync(basePath, { recursive: true })`. The framework root must be a temp dir, **not** the real ADW checkout: it keeps AC5 honest (a `process.cwd()` implementation would record the test's cwd, a different path) and makes an accidental real invocation harmless. `rmSync` both roots in the `After` hook.
- **One recorder, two modes.** Both Given phrases install the same `deps.exec` recorder pushing `{command, cwd: options.cwd, env: {...options.env}}`. Record-only mode returns a benign canned stdout and never spawns; real-spawn mode records and then calls `execSync("printf '%s' '[]'", { ...options, encoding: 'utf-8' })`, passing `options.cwd` through unchanged and mirroring `defaultExec`'s `input` branch (`gitContext.ts:49-60`) when `options.input !== undefined`.
- **Assert `err.code === 'ENOENT'`, never the error message** (node and bun word it differently — see "Assert the error code" under **Steps to Reproduce**).
- Keep a module-private world and an `@adw-775`-scoped `Before`/`After` pair. Do **not** import `gitContextSharedWorld.ts` (imaginary sentinel roots, `existsSync: () => false`), and do not redefine step phrases owned by `feature-659.steps.ts` / `feature-664.steps.ts` or the registry phrase `T22`, which lives in `feature-504.steps.ts:1126` and is reused, not redefined.
- The chdir steps (AC5, AC8) must `process.chdir` to a **third** temp dir, distinct from both the framework root and the target workspace, and restore the original cwd in `After`.

### 7. Re-point the `@adw-659` scenarios at a workspace-scoped operation
The three `@adw-659` scenarios that assert base-path cwd drive the `"default-branch"` **gh** op, which is now framework-rooted by design. Preserve their intent (per-command auth/identity + explicit non-ambient cwd + two-context isolation) by driving a git read op instead:
- `features/per-issue/step_definitions/feature-659.steps.ts` — add a `'current-branch'` case to `runOp` (`:28-60`) calling `ctx.getCurrentBranch()`. Leave every existing case in place.
- `features/per-issue/feature-659.feature:219-225` — change the When to the `"current-branch"` read operation. All three Thens (token, git author, base-path cwd) remain valid because `#run` injects the same env for git commands.
- `features/per-issue/feature-659.feature:235-240` — same substitution; this is the "cwd survives `process.chdir`" guard.
- `features/per-issue/feature-659.feature:298-310` — same substitution for both contexts; the token-isolation Thens are unchanged.
- Do **not** touch the `@adw-659` §3 parent-environment scenarios or `feature-699`'s reuse of the shared step (it builds a self-host context, where base path *is* the framework root).

### 8. Re-point the `@adw-664` per-event scenarios the same way
- `features/per-issue/step_definitions/feature-664.steps.ts:239-250` — extend the `"{string} read operation runs through the per-event context"` dispatch with a `'current-branch'` case calling `ctx.getCurrentBranch()`; keep `'default-branch'` working for the token scenarios.
- Same file `:264-282` — make the interleaved-events step run the git op so its per-context cwd assertions stay meaningful (keep the token capture as-is).
- `features/per-issue/feature-664.feature:320-327` and `:356-367` — change the When to the `"current-branch"` read operation. The auth/token Thens are unchanged; the cwd Thens now assert a genuinely per-repo working directory.

### 9. Migrate the six *other* feature families that assert the superseded contract
The phrases `the captured command ran with cwd equal to the context base path` (`feature-659.steps.ts:237`) and `the {string} command ran with cwd equal to the {string} context base path` (`:298`) are defined **only** in `feature-659.steps.ts`, but six other per-issue features **reuse** them without owning a step-def file for them. Re-pointing feature-659's own scenarios (step 7) therefore does **not** rescue the reusers: each of these sites asserts the superseded contract about a **gh** operation and goes RED when this fix lands. Verified 2026-07-30 by reading every site.

First add the replacement assertions to `features/per-issue/step_definitions/feature-659.steps.ts` — one new `Then` pair, asserting against the shared world's exported `FRAMEWORK_ROOT` (which `makeFullOptions` already injects as `frameworkRepoRoot`), leaving the two base-path phrases in place for the git-op sites that still need them:
- `the captured command ran with cwd equal to the framework repository root`
- `the {string} command ran with cwd equal to the framework repository root`

Then, at each site below, **keep the operation and its token / git-identity assertions unchanged** and swap only the cwd assertion. The intent of every one of these scenarios is "this *gh* op routes through the per-command spawn path with an explicit, non-ambient, context-owned cwd" — that intent survives verbatim; only which directory the contract names has moved. Do not re-point them at git ops (that would delete the gh-surface coverage they exist for):
- `features/per-issue/feature-663.feature` — `:221` (`issue-comment`), `:237` (the outline over `issue-view`, `issue-create`, `label-apply`, `pr-view`, `pr-comment`), and `:337`/`:339` (two-context write ops → the `{string}` variant). The token-isolation assertions at `:336`, `:338`, `:340`, `:341` are unchanged; per-repo **cwd** isolation is now carried by feature-659's re-pointed git-op scenario (step 7), which is where it is actually meaningful.
- `features/per-issue/feature-691.feature` — `:246` and the `:261` outline (`list-open-issues`, `view-issue-comments`, `list-merged-prs`).
- `features/per-issue/feature-692.feature` — `:276`'s Examples **mix the two classes**: `remote-url` is a git op that keeps base-path cwd, `authenticated-user` (`gh api user`) moves. Split it — leave the outline with the `remote-url` row and its base-path assertion, and add a sibling scenario for `authenticated-user` with the framework-root assertion (token assertion unchanged). Leave `:259` (`remote-url`) untouched.
- `features/per-issue/feature-695.feature` — `:337` (`set-secret`).
- `features/per-issue/feature-697.feature` — `:37` (`pr-changed-files`) only. Leave `:58` (`stats-log`) untouched: it is a **git** read and stays green.
- `features/per-issue/feature-700.feature` — `:342` (`default-branch` run after `process.chdir`). The framework-root form still proves the non-ambient property, because `FRAMEWORK_ROOT` is a sentinel path that is never the test process's cwd.

Verified unaffected — do **not** touch: `feature-661` (worktree git ops), `feature-693` (vcs probes), `feature-694:351` (git reads), `feature-696:48` (`ls-remote`), `feature-698`, and `feature-699:360`/`:377` (self-host, where `basePath` **is** the framework root, so both its `current-branch` and its `gh-auth` probe stay green).

### 10. Update the owning documentation
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — document the two-chokepoint rule (`#run` → workspace cwd; `#runRepoApi` → framework repo root), the list of repo-API methods, and why identity is unaffected (it lives in the command string).
- `.adw/conditional_docs.md` — add conditions under that doc for: working with `#runRepoApi` or the repo-API cwd rule; troubleshooting `spawnSync /bin/sh ENOENT` from a GitHub-API call; a Cancel/Retry directive failing on a host that has never cloned the target repo.
- `app_docs/feature-9gjajh-webhook-triggers.md` — note that the per-event cwd assertion in `webhookRepoResolver.test.ts` is pinned by a git op because repo-API calls are now framework-rooted.
- `README.md` — only if it documents the GitContext cwd contract; keep any edit additive.

### 11. Run the Validation Commands
Execute every command in the section below and confirm each one passes.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Commands are the project-specific ones from `.adw/commands.md`.

**Reproduce first (RED — before the fix):**
- `node -e "const {execSync}=require('child_process'); try{execSync('gh --version',{cwd:'/tmp/definitely-not-here-775'})}catch(e){console.log(e.message.split('\n')[0])}"` → prints `spawnSync /bin/sh ENOENT`, establishing that a nonexistent spawn cwd is the failure mode. Passes before and after (it is an OS fact, not ADW behaviour).
- The scratch-script repro in **Steps to Reproduce** (steps 2-5) → throws `spawnSync /bin/sh ENOENT` before the fix; returns the comment JSON after it, with the target workspace still absent.
- `bun run test:unit` limited to the new suite (`bunx vitest run adws/gitContext/__tests__/repoApiCwd.test.ts`) → **RED before the fix**: the modelled-ENOENT reproduction throws and every framework-root cwd assertion fails. **GREEN after.**
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-775"` → **RED before the fix** (AC1/AC2/AC5 fail on the nonexistent cwd); **GREEN after.**

**Prove the fix (GREEN — all must pass):**
- `bun run lint` — ESLint clean (no unused imports left in the touched tests/step defs).
- `bunx tsc --noEmit` — root type-check passes, covering `features/**` (this is what forces the `feature-659`/`feature-664` step-def updates to compile).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes.
- `bun run test:unit` — the full unit suite passes: the new `repoApiCwd` suite, the updated `gitContextOperations` describes, the untouched `gitReadOps` suite, and the updated `webhookRepoResolver` §3a case.
- `bun run lint:git-guard` — the git/gh guard still passes whole-repo with its `scanned N files (0 allowlisted)` line unchanged (the fix is inside the structurally exempt `adws/gitContext` package, so no new violations and no allowlist changes).
- `bun run build` — the `tsc` build succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-775"` — the new regression scenarios are green.

*Families whose superseded assertions this fix migrates (steps 7-9) — each must be green **after** its migration, and each is RED if its migration was skipped:*
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-659"` — per-command auth / explicit-cwd / two-context isolation green with the re-pointed git operation.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-664"` — per-event boundary-context scenarios green with the re-pointed git operation.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-663"` — migrated issue/PR/label/board gh surface green with the framework-root cwd assertion.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-691"` — migrated gh-read surface green with the framework-root cwd assertion.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-692"` — identity reads green with the outline split (`remote-url` → base path, `authenticated-user` → framework root).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-695"` — `setSecret` green with the framework-root cwd assertion.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-697"` — promotion PR ops green (`pr-changed-files` → framework root; `stats-log` still base path).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-700"` — boundary-absorption guards green with the framework-root cwd assertion.

*Families that must be green **with their feature files and step definitions unmodified** — this is the counter-proof that the git contract did not move:*
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-658"` — base-path resolution unchanged (pure `basePath` return-value assertions).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-661"` — worktree ops still run at the base path (git-op driven).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-662"` — worktree-cwd contract.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-699"` — self-host diagnostic probes (self-host base path *is* the framework root, so even its `gh-auth` probe is unaffected).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-693"`, `--tags "@adw-694"`, `--tags "@adw-696"`, `--tags "@adw-698"` — the migrated phase/read-op families (all git ops with explicit cwds).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite is green.

**Sweep for stragglers.** Before declaring done, re-run the search that found these families and confirm every remaining hit drives a **git** op or a self-host context:
`grep -rn "cwd equal to the context base path\|cwd equal to the .* context base path" features/per-issue/*.feature`

## Notes
- **Coding guidelines.** `.adw/coding_guidelines.md` applies. `#runRepoApi` is a 3-line delegation with a doc comment explaining intent (clarity over cleverness); the change adds no nesting, no `any`, no decorators, and leaves `gitContext.ts` structurally as it was — it is a `#run` → `#runRepoApi` rename at 38 call sites plus one field and one method. `gitContext.ts` is already over the 300-line guideline (610 lines) as an accepted deep-module exception; this change adds ~15 lines and no new responsibility, so do not open a split as part of this fix.
- **No new libraries.** Pure rewiring plus tests.
- **Why not "fall back to the framework root when `basePath` is missing".** An existence-based fallback would make behaviour depend on host state and would resurrect exactly the cwd-fallback the GitContext PRD bans — and for *git* commands it would be actively dangerous (a missing target workspace would silently operate on the framework checkout). The split is by **command class**, statically, at the call site.
- **Why the target repository is still addressed correctly.** Every routed command carries `--repo owner/repo` or a full `repos/owner/repo/…` API path; `gh` honours the explicit flag over any local remote. The only repo-free commands routed here are `gh api user` and the `gh api graphql` builders, which address no repository. The anti-drift test in step 4 is what keeps that true.
- **`gh pr create` was verified cwd-independent** on 2026-07-30: run from `/tmp` (not a git repository) with explicit `--repo`/`--head`/`--base`, `gh` reached the GitHub API and failed on the invalid refs (`Head ref must be a branch`), not on a missing git repository. Combined with `createPRCmd`'s mandatory explicit `--head` (`prCommands.ts:44-52`), routing it through the repo-API cwd cannot reintroduce the #659-era empty-diff PR bug — the `--head` regression guard at `gitContextOperations.test.ts:537-566` stays green.
- **`gh pr merge` is safe too**: the built command is `gh pr merge N --merge --repo owner/repo` with no `--delete-branch`, so it performs no local-branch work regardless of cwd.
- **Out of scope (deliberate).** (a) Wrapping the `req.on('end')` webhook listener in a `try`/`catch` so *any* future synchronous throw in a directive branch cannot kill the server — real hardening, but a different bug from the one reported; the root-cause fix already restores Cancel/Retry. (b) Making `handleCancelDirective` skip worktree removal when the workspace is absent — it is already `try`/`catch`-guarded and only logs a warning. (c) Auto-cloning a workspace on directive receipt — the opposite of what the issue asks for. If (a) is wanted, file it separately.
- **Operational note.** After this fix, the *first* GitHub-API interaction with a newly registered repository (directive handling, cron polling, label reads) works before any clone. Workspace-scoped work still requires `ensureRepoWorkspace` to have run, and will still fail loudly if it has not — which is the correct behaviour, since those operations genuinely need a checkout.
