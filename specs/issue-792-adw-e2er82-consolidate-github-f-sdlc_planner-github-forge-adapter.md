# Feature: GitHub knowledge consolidates into the forge adapter package over the core executor

## Metadata
issueNumber: `792`
adwId: `e2er82-consolidate-github-f`
issueJson: `{"number":792,"title":"Consolidate GitHub forge adapter package over the executor","body":"## Parent PRD\n\nspecs/prd/gitcontext-forge-agnostic-refactor.md\n\n## What to build\n\nConsolidate all GitHub knowledge into the GitHub forge adapter package: the gh command-string builders, GitHub App authentication (direct process.env reads become injected configuration), and token resolution move out of the gitContext core. The adapter's gh call sites feed command strings into the core executor — the adapter never spawns processes itself. The CI git/gh guard's exempt set is updated in the same change to exactly two named packages (git core for git commands, adapter for gh call sites) so the move and the guard change land atomically.\n\nSee PRD sections: Implementation Decisions (GitHub forge adapter, CI guard extension a), Testing Decisions (GitHub forge adapter).\n\nHITL rationale: thickest slice of the phase — human review before merge.\n\n## Acceptance criteria\n\n- [ ] Command builders, App auth, and token resolution live in the adapter package; core has no GitHub-specific modules left except the semantic methods pending migration\n- [ ] App auth reads no process.env directly; configuration is injected\n- [ ] Adapter issues gh commands only through the core executor; no direct spawns\n- [ ] Guard exempt set names exactly the two packages; `bun run lint:git-guard` green; a gh call site in any third package fails the guard\n- [ ] Relocated tests (token resolution, command builders, App auth) green in their new home; full suite green\n\n## Blocked by\n#791 <!-- adw:region-overlap -->\n\n- Blocked by #791\n\n## Touched Files\n\n- adws/gitContext/commands/ (moves out)\n- adws/gitContext/appAuth.ts (moves out)\n- adws/gitContext/tokenResolver.ts (moves out)\n- adws/providers/github/\n- adws/github/issueApi.ts\n- adws/github/prApi.ts\n- adws/github/projectBoardApi.ts\n- adws/checkGitGhGuard.ts\n- adws/__tests__/checkGitGhGuard.test.ts\n\n## User stories addressed\n\n- User story 9\n- User story 11\n- User story 13\n- User story 15","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-08-14T12:18:39Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-08-14T13:11:13Z","body":"⏸️ **Deferred behind #791 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #791, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #791 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/gitcontext/tokenresolver.ts`\n\nThis issue will spawn automatically once #791 merges and closes. To override, remove the `#791 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Feature Description

Every file in `adws/gitContext/` that knows the word "GitHub" moves into the GitHub forge adapter package at `adws/providers/github/`, and the CI git/gh guard's exempt set becomes a **closed, named, two-entry structure** in the same commit — the git core for git commands, the GitHub adapter for gh call sites.

Three families move:

1. **The gh command-string builders** — `adws/gitContext/commands/{issue,pr,label,secret,board}Commands.ts` (`gh issue view …`, `gh pr create …`, the Projects V2 GraphQL documents and their response parsers). Pure string factories with zero imports; they relocate byte-for-byte.
2. **GitHub App authentication** — `adws/gitContext/appAuth.ts`. Its three direct `process.env` reads (`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_PATH`, at `:62-68` and `:75-76`) become an injected `GitHubAppConfig` parameter. The ADW wiring shim `adws/github/githubAppAuth.ts` becomes the one place those variables are read.
3. **Token resolution** — `tokenResolver.ts` (the veracious resolution order) and `githubTokenProvider.ts` (#791's TokenProvider port implementation, written in the last slice explicitly as "the first file of the forge adapter #792 will relocate wholesale").

Alongside the move, the adapter gains the primitive that makes AC3 structural rather than conventional: **`ghCommandRunner.ts`**, a one-function seam that turns a built command string into an executed one by calling `GitContext.exec` (#790's public forge-neutral executor) with the framework-root cwd class and a per-command credential overlay. The adapter never touches `child_process`. `adws/providers/github/githubBoardManager.ts` — today the only module outside the core that issues `gh` work of its own (seven `runGraphQL`/`runGraphQLInput` calls at `:93`, `:111`, `:119`, `:127`, `:134`, `:159`, `:185`) — is rewired onto the runner plus the relocated board builders, so the adapter demonstrably feeds command strings into the core executor rather than borrowing a core semantic method.

This is slice 3 of the GitContext forge-agnostic refactor (`specs/prd/gitcontext-forge-agnostic-refactor.md`, user stories 9, 11, 13, 15). #790 promoted the spawn chokepoint to `exec(command, { cwd, env, input? })`; #791 plugged the credential hole with the TokenProvider port. This slice moves the GitHub *material* to the far side of that seam and closes the guard around the result.

## User Story

As a framework developer
I want every GitHub-specific module to live in the GitHub forge adapter, feeding command strings into the core's executor, with the CI guard naming exactly which package may run git and which may issue gh
So that the closed set of privileged code is explicit and reviewable, and the core can later be extracted as a forge-neutral library without dragging GitHub machinery with it

## Problem Statement

The gitContext package is advertised by its own `index.ts` header as "standalone, importable public surface", but eleven of its files are GitHub-shaped:

- **The builders are in the wrong package.** `adws/gitContext/commands/` holds 41 exported functions emitting `gh` command strings plus three Projects V2 response parsers. Nothing in them is forge-neutral, and `adws/gitContext/index.ts` does not even export them — they exist solely to feed `gitContext.ts`'s semantic methods (`:61-77`). PRD story 20 wants the core's public API to be "git, worktree, workspace, and executor operations plus the ports it consumes"; five files of `gh` grammar sitting inside that package contradict it.
- **App auth reads the environment from inside the package.** `isGitHubAppConfigured()` (`appAuth.ts:62-68`) and `getInstallationToken()` (`:75-76`) read `process.env.GITHUB_APP_ID` / `GITHUB_APP_SLUG` / `GITHUB_APP_PRIVATE_KEY_PATH` directly. #791's plan deferred this deliberately: "the PRD assigns 'GitHub App authentication (environment reads become injected configuration)' to the adapter slice explicitly". A package that reads three GitHub-App environment variables cannot be published as forge-neutral, and its unit suite currently has to mutate `process.env` in `beforeAll` to test it (`__tests__/appAuth.test.ts:37-39`).
- **Token resolution is GitHub auth policy in the core.** `resolveContextToken` (`tokenResolver.ts:46-61`) encodes App-installation-token → PAT → `gh auth token` ordering, and `githubTokenProvider.ts` encodes the PAT-versus-installation-token answer to an `'alternateIdentity'` request. PRD story 13 wants that policy to "live with the forge that requires it".
- **The guard's exempt set no longer says what it means.** `adws/checkGitGhGuard.ts:46` is a single string, `EXEMPT_PACKAGE_DIR = 'adws/gitContext'`, applied as one directory skip in `visitDir` (`:81`). The PRD (Further Notes) states the intended shift: from "only GitContext may touch git/gh" to "only the git core may run git; only the GitHub adapter may issue gh — still a closed, named, CI-enforced set." A lone string constant names one package and describes neither role. Once the adapter starts issuing gh, either the exemption grows without a stated contract, or the adapter's legitimate call sites fail the build.
- **The adapter borrows the core's semantics to reach gh.** `githubBoardManager.ts` builds Projects V2 GraphQL documents inline (`:92`, `:106-133`, `:184`) and then calls `this.ctx.runGraphQL(...)` — a *core* semantic method — to run them. The adapter therefore has GitHub knowledge but no sanctioned way to execute it; PRD story 11 wants the adapter to "feed command strings into the core's executor rather than spawning processes myself", which requires a named seam that does not exist yet.

## Solution Statement

### 1. The adapter package absorbs the GitHub material

`adws/providers/github/` becomes the GitHub forge adapter package:

```
adws/providers/github/
├── __tests__/
│   ├── appAuth.test.ts             ← relocated from adws/gitContext/__tests__/
│   ├── ghCommandRunner.test.ts     ← NEW
│   ├── githubTokenProvider.test.ts ← relocated
│   └── tokenResolver.test.ts       ← relocated
├── commands/                       ← relocated from adws/gitContext/commands/
│   ├── __tests__/issueCommands.test.ts
│   ├── boardCommands.ts  issueCommands.ts  labelCommands.ts
│   ├── prCommands.ts     secretCommands.ts
├── appAuth.ts                      ← relocated, config injected
├── ghCommandRunner.ts              ← NEW — adapter → core-executor seam
├── githubTokenProvider.ts          ← relocated
├── tokenResolver.ts                ← relocated
├── githubBoardManager.ts           ← rewired onto ghCommandRunner + boardCommands
├── githubCodeHost.ts  githubIssueTracker.ts  mappers.ts  index.ts
```

**Deep imports, never the barrel.** `adws/providers/index.ts` does `export * from './github'`, and `githubCodeHost.ts` imports `../../github/gitContextFactory`, which imports `../gitContext`. Every consumer added by this slice (the core's transitional builder imports, `gitContextFactory.ts`, `launchGitContext.ts`, `githubAppAuth.ts`) must therefore import the **deep module path** (`../providers/github/tokenResolver`), not `../providers/github`. The barrel's public surface stays as it is today plus `createGhCommandRunner`, `createGitHubTokenProvider`, `isGitHubAppConfigured`, `getInstallationToken` — the ~41 command builders are deliberately **not** re-exported through it, both to avoid `export *` name collisions across `providers/{github,gitlab,jira}` and to keep the barrel a provider surface rather than a command catalogue.

### 2. App auth: configuration in, environment reads out

`appAuth.ts` keeps its shape (module-scope expiry-aware caches, the curl `--config` stdin channel from #780, the sanitized failure builders) and gains a first parameter:

```ts
export interface GitHubAppConfig {
  readonly appId?: string;
  readonly appSlug?: string;
  readonly privateKeyPath?: string;
}

export function isGitHubAppConfigured(config: GitHubAppConfig): boolean;
export function getInstallationToken(
  config: GitHubAppConfig, owner: string, repo: string, deps?: AppAuthDeps,
): string;
```

**Parameterised functions, not a bound factory.** A factory would capture config once at construction; today `isGitHubAppConfigured()` re-reads `process.env` on every call, and at least one merged BDD proof depends on that late binding (`feature-780.steps.ts:269-271` assigns `process.env.GITHUB_APP_*` inside a `When` step, after module load). Keeping the functions parameterised and resolving config per call in the ADW shim preserves the current semantics exactly, and keeps the installation-token cache module-scoped and shared across both construction boundaries, as it is today.

`adws/github/githubAppAuth.ts` — already a pure re-export shim since #701 — becomes the **single environment-binding site**:

```ts
const readAppConfig = (): GitHubAppConfig => ({
  appId: process.env.GITHUB_APP_ID,
  appSlug: process.env.GITHUB_APP_SLUG,
  privateKeyPath: process.env.GITHUB_APP_PRIVATE_KEY_PATH,
});

export const isGitHubAppConfigured = (): boolean => adapterIsConfigured(readAppConfig());
export const getInstallationToken = (owner: string, repo: string): string =>
  adapterGetInstallationToken(readAppConfig(), owner, repo);
```

The exported signatures are unchanged, so `adws/github/index.ts:71-75`, `adws/phases/workflowInit.ts:141`, `adws/phases/reviewPhase.ts:110` and their `vi.mock` stubs are untouched. AC2 is about the *adapter*: after this change `adws/providers/github/appAuth.ts` contains no `process.env` read at all, and its relocated test constructs config explicitly instead of mutating the environment.

### 3. `ghCommandRunner` — the adapter's only route to a child process

```ts
// adws/providers/github/ghCommandRunner.ts
export interface GhCommandRunner {
  run(command: string, opts?: { input?: string; purpose?: CredentialPurpose }): string;
}

export function createGhCommandRunner(ctx: GitContext): GhCommandRunner {
  return {
    run: (command, opts = {}) => ctx.exec(command, {
      cwd: { kind: 'frameworkRoot' },
      env: ctx.commandEnv({}, opts.purpose ?? 'default'),
      input: opts.input,
    }),
  };
}
```

This is `gitContext.ts`'s private `#runRepoApi` (`:308-316`) reproduced verbatim on the public `exec` surface — same framework-root cwd class (#775's repo-API contract: repo-independent gh commands carry their identity in the command string and must not depend on a cloned workspace), same per-command credential overlay through the TokenProvider port (#791). It imports `GitContext` as a type and `ctx.exec` as the only execution path; it imports nothing from `child_process`.

**No import cycle:** `gitContext.ts → providers/github/commands/*` terminates immediately (the builders are leaves with zero imports), and `providers/github/ghCommandRunner.ts → gitContext/index.ts → gitContext.ts → commands/*` terminates at the same leaves.

### 4. `githubBoardManager` becomes the first adapter gh call site

Its seven calls swap the core's semantic methods for the runner plus relocated builders — a mechanical, behaviour-identical substitution, since `GitContext.runGraphQL` *is* `#runRepoApi(graphQLCmd(query, vars), { purpose: 'alternateIdentity' })`:

| today (`githubBoardManager.ts`) | after |
|---|---|
| `this.ctx.runGraphQL(q, vars)` | `this.gh.run(graphQLCmd(q, vars), { purpose: 'alternateIdentity' })` |
| `this.ctx.runGraphQLInput(body)` | `this.gh.run(graphQLInputCmd(), { input: JSON.stringify(body), purpose: 'alternateIdentity' })` |

`'alternateIdentity'` is preserved on every call — that is the PAT path Projects V2 writes require on user-owned repos (`app_docs/feature-hjcays-fix-board-pat-auth.md`), and dropping it would silently regress board writes to an app token that lacks access. `adws/providers/__tests__/boardManager.test.ts` exercises only the pure `mergeStatusOptions`, so this rewire carries no unit-test churn.

### 5. The guard's exempt set becomes a named closed pair

`EXEMPT_PACKAGE_DIR` (a bare string) becomes a two-entry table with an exported pure predicate:

```ts
/** The closed, CI-enforced set of packages permitted to shell out. Exactly two. */
export const EXEMPT_PACKAGES = [
  { dir: 'adws/gitContext',
    role: 'git core — the only package that may run git commands' },
  { dir: 'adws/providers/github',
    role: 'GitHub forge adapter — the only package whose gh call sites may feed the core executor' },
] as const;

export function isExemptPackage(relPath: string): boolean { … }
```

The exemption stays applied **only in `visitDir`** (`:81`), never in `scanFiles`. That distinction is load-bearing: `scanFiles` skipping nothing is what makes the guard's `(0 allowlisted)` report true, and `features/per-issue/feature-700.feature` §4b asserts that printed count via a `/(\d+)\s+allowlisted/` regex in `feature-700.steps.ts:231-243`. The `(0 allowlisted)` fragment at `checkGitGhGuard.ts:239` is preserved verbatim; a new line naming the two exempt packages and their roles is printed beneath it, so AC4's "names exactly the two packages" is visible in the run output as well as the source.

### 6. What the core keeps, and the one deliberate transitional inversion

The issue's AC1 concedes it: "core has no GitHub-specific modules left **except the semantic methods pending migration**." `GitContext.fetchIssue`/`commentOnIssue`/`createPR`/`applyLabel`/`setSecret`/`runGraphQL`/`moveIssueToStatus`/… stay exactly as they are — roughly twenty consumer modules still call them, and migrating those consumers is #796 (orchestrators and phases) and #797 (core/triggers), each gated behind #794's provider-minting launch boundary. Deleting the methods here would pull that entire migration into this slice.

Those surviving methods still need their builders, so `gitContext.ts:60-77` keeps its five import statements and repoints them from `./commands/…` to `../providers/github/commands/…`. This is a **temporary upward dependency from the core into the adapter**, and it is the one judgment call in this plan worth a reviewer's attention:

- It is the direct, unavoidable consequence of AC1's own carve-out. The alternatives are worse: inlining the command strings back into `gitContext.ts` duplicates 41 builders and puts raw `gh` literals back in the core; a re-export shim inside `gitContext/` would itself be "a GitHub-specific module left in the core", failing AC1 literally.
- It is confined to five import statements in one file, all in the block immediately above the semantic methods, and it disappears in the same commit that deletes those methods (#796/#797). A block comment marks it `TRANSITIONAL — deleted with the semantic methods (#796/#797)`.
- It costs nothing structurally today: the core is not extracted until Phase B (explicitly out of PRD scope), and the builders are import-free leaves, so no cycle exists at any point.

Also staying in the core, and explicitly **not** this slice's work:

- `bootstrapIdentity.ts` — `parseGitHubRemoteUrl`, the `[bot]`/`users.noreply.github.com` identity derivation (`:118-133`) and `ghAuthToken()`'s `gh auth token` read. **#793** owns this split ("bootstrap identity splits into generic git-config reads (stay in core) and GitHub derivation … which moves to the adapter"). `ghAuthToken` in particular cannot move onto `ghCommandRunner`: it is the pre-context read that *produces* the credential the runner needs, so routing it through a credentialed executor is circular by construction. Leave it where #793 will find it.
- `repoWorkspace.ts`'s `github.com` clone-URL rewriting — also #793.
- `GitContextOptions.token` / `.pat`, the transitional literal-credential path #791 left behind. Its ~350 construction sites are the regression net for the credential work; #796/#797 delete it.

## Relevant Files

Use these files to implement the feature:

### Moving out of the core

- `adws/gitContext/commands/issueCommands.ts`, `prCommands.ts`, `labelCommands.ts`, `secretCommands.ts`, `boardCommands.ts` — 41 pure builders plus `parseProjectId`/`parseIssueItem`/`parseStatusField`. Zero imports; relocate byte-for-byte with `git mv`. Only the module header comments change.
- `adws/gitContext/commands/__tests__/issueCommands.test.ts` — moves with them; import path is relative and unchanged.
- `adws/gitContext/appAuth.ts` — the only file whose *content* changes on relocation: delete the `ENV` constant (`:21-25`), add `GitHubAppConfig`, thread it through `isGitHubAppConfigured` (`:62-68`) and `getInstallationToken` (`:74-93`). Everything else — `tokenCache`/`installationIdCache`/`REFRESH_BUFFER_MS`, `buildCurlConfig`, `redactBearerTokens`, `describeApiFailure`, `requestGitHubApi` — is untouched; #780's credential-on-stdin guarantee must survive verbatim.
- `adws/gitContext/tokenResolver.ts` — `resolveContextToken` (`:46-61`) relocates unchanged. All its I/O is already injected.
- `adws/gitContext/githubTokenProvider.ts` — relocates unchanged except its `import { resolveContextToken } from './tokenResolver'` (`:13`), which stays relative and therefore also unchanged.
- `adws/gitContext/__tests__/{appAuth,tokenResolver,githubTokenProvider}.test.ts` — relocate to `adws/providers/github/__tests__/`. Only `appAuth.test.ts` changes materially (explicit config instead of the `process.env` mutation at `:21-49`).

### Core

- `adws/gitContext/gitContext.ts` — **only** the five builder import statements (`:60-77`) are repointed, under a `TRANSITIONAL` block comment. The module header (`:1-39`) gains one sentence naming the residual dependency. `exec` (`:261-274`), `#run`, `#runRepoApi` (`:308-316`) and every semantic method body are untouched.
- `adws/gitContext/index.ts` — drop `isGitHubAppConfigured`/`getInstallationToken` (`:31`), `resolveContextToken`/`ResolveContextTokenInput` (`:34-35`), `createGitHubTokenProvider`/`GitHubTokenProviderInput` (`:23-24`); rewrite the header paragraph that advertises the TokenProvider's GitHub implementation as part of this package. `GitContext`, the executor types and the port *types* (`TokenProvider`, `CredentialRequest`, `CredentialPurpose` — forge-neutral, defined in `types.ts`) stay.

### Adapter

- `adws/providers/github/githubBoardManager.ts` — `private get ctx()` (`:84-86`) becomes a `gh` runner getter; the seven call sites (`:93`, `:111`, `:119`, `:127`, `:134`, `:159`, `:185`) route through it. The inline GraphQL document strings stay where they are: they are GitHub knowledge already correctly located in the adapter.
- `adws/providers/github/index.ts` — extend with `createGhCommandRunner`, `createGitHubTokenProvider`, `isGitHubAppConfigured`, `getInstallationToken` and their types. Do **not** `export *` the command builders.
- `adws/providers/github/{githubIssueTracker,githubCodeHost,mappers}.ts` — read-only reference. They reach gh through `adws/github/{issueApi,prApi,projectBoardApi}.ts` → `GitContext` semantic methods → `exec`, which already satisfies "only through the core executor". Their migration onto providers is #796/#797; **no edit in this slice**.

### ADW wiring (the injection sites)

- `adws/github/githubAppAuth.ts` — the re-export shim becomes the environment-binding shim (`readAppConfig()`), keeping both exported signatures identical.
- `adws/github/gitContextFactory.ts` — imports at `:11-18` repoint: `isGitHubAppConfigured`/`getInstallationToken` from `./githubAppAuth`, `createGitHubTokenProvider` from `../providers/github/githubTokenProvider` (deep path — importing the barrel here would close a cycle through `githubCodeHost.ts`). `buildTokenProvider` (`:48-54`) is otherwise unchanged; `readLocalRepoInfo`/`resolveBootstrapGitIdentity` still come from `../gitContext`.
- `adws/core/launchGitContext.ts` — same repoint for its imports (`:22-29`); `resolveLaunchToken` (`:65-72`) and `createLaunchTokenProvider` (`:91-97`) keep their bodies.
- `adws/github/index.ts` (`:71-75`) — unchanged; it re-exports from `./githubAppAuth`, whose signatures are preserved.

### Guard

- `adws/checkGitGhGuard.ts` — `EXEMPT_PACKAGE_DIR` (`:46`) → `EXEMPT_PACKAGES` + exported `isExemptPackage`; `visitDir` (`:75-91`) uses the predicate; `main` (`:233-241`) keeps `(0 allowlisted)` verbatim and adds the named-set report. `scanFiles` (`:104-117`) keeps its two-parameter signature — `checkGitGhGuard.test.ts:69` asserts `scanFiles.length === 2`.
- `adws/__tests__/checkGitGhGuard.test.ts` — extend with the exempt-set assertions (both directions).
- `.github/workflows/git-cli-guard.yml:23` — read-only reference; runs `bun run lint:git-guard` in CI, which is what makes this rule structural.

### BDD scenarios for this slice

- `features/per-issue/feature-792.feature` — the behavioural proof for this issue, tagged `@adw-792`. Twenty-four scenarios (five of them outlines) over five surfaces: the executed command strings (§1, §2), the core carrying no GitHub credential machinery (§3), injected App configuration (§4–§6) with the mint's regression net (§7–§10), the executor seam (§11, §11a, §12–§14) and the guard's two-package exempt set (§15–§19), plus the type-check backstop (§20). §4, §5, §6, §11a and §15 are the RED-before rows; the rest are GREEN-before regression guards that must stay green across the move. §11a drives `createGhCommandRunner` directly over a `GitContext` built with an injected `exec`, so the runner must remain constructible from a context alone (Solution §3) and the alternate credential purpose must survive the board rewire (Solution §4). The scenario file's own scope notes flag three HITL questions — user story 15, `ghAuthToken`, and how literally story 9's kind-scoping can be enforced in this slice — all of which this plan resolves the same way (see Solution §6 and Notes).

### BDD step definitions importing the relocated modules (import repoints only)

- `features/per-issue/step_definitions/feature-780.steps.ts` (`:33-36`, `:141-143`, `:269-271`, `:367`) — repoint to `adws/providers/github/appAuth.ts`; the step that sets `process.env.GITHUB_APP_*` becomes an explicit `GitHubAppConfig` passed to `getInstallationToken`, which makes the JWT-redaction scenario hermetic without changing what it asserts.
- `features/per-issue/step_definitions/feature-779.steps.ts` (`:24`) and `feature-700.steps.ts` (`:32`) — repoint `resolveContextToken` to `adws/providers/github/tokenResolver.ts`.
- `features/per-issue/step_definitions/feature-791.steps.ts` (`:26`) — split: `GitContext` from `adws/gitContext/index.ts`, `createGitHubTokenProvider` from `adws/providers/github/githubTokenProvider.ts`.

### Documentation

- `README.md` — the `gitContext/` subtree (`:635-677`) loses `commands/`, `appAuth.ts`, `tokenResolver.ts`, `githubTokenProvider.ts` and their test entries; the `providers/github/` subtree (`:798-803`) gains them plus `ghCommandRunner.ts`. **Additive-and-relocating only** — do not delete any README line documenting a file that still exists.

### Conditional documentation (from `.adw/conditional_docs.md`)

- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — owns `adws/gitContext/**` and `adws/gitContext/__tests__/**`.
- `app_docs/feature-9gjajh-providers.md` — owns `adws/providers/**`.
- `app_docs/feature-hjcays-fix-board-pat-auth.md` — `GitHubBoardManager` auth handling and the PAT path behind `findBoard`/`createBoard`/`ensureColumns`; directly relevant to the runner rewire preserving `'alternateIdentity'`.
- `app_docs/feature-qm6gwx-board-manager-provider.md` — `BoardManager` / `BOARD_COLUMNS` provider contract.
- `app_docs/feature-vpb048-promotion-sweep-originate.md` — `ListOpenIssuesOptions.state` / `listOpenIssuesCmd` in the relocating `commands/issueCommands.ts`.
- `app_docs/feature-tcewff-cron-gh-token-bleed-fix.md` — the GH_TOKEN-bleed history behind token resolution and per-repo App auth.
- `app_docs/feature-9gjajh-health-check.md` — records that `healthCheck.tsx`/`healthCheckChecks.ts` must stay guard-clean and un-exempt.

### New Files

- `adws/providers/github/ghCommandRunner.ts` — `GhCommandRunner` interface and `createGhCommandRunner(ctx)`. The adapter's sole execution path.
- `adws/providers/github/__tests__/ghCommandRunner.test.ts` — behavioural tests over an injected exec fake.
- `adws/providers/github/appAuth.ts`, `tokenResolver.ts`, `githubTokenProvider.ts`, `commands/*.ts`, `commands/__tests__/issueCommands.test.ts`, `__tests__/{appAuth,tokenResolver,githubTokenProvider}.test.ts` — new *paths* for relocated files (create with `git mv` so history follows).

## Implementation Plan

### Phase 1: Foundation

Relocate the three GitHub families with `git mv` and repoint every importer, changing no behaviour. The builders and the two token modules move byte-for-byte; only `appAuth.ts` changes shape, gaining its injected `GitHubAppConfig` while the ADW shim absorbs the environment reads so all downstream signatures stay identical. Trim the core's public surface and repoint the core's five transitional builder imports. At the end of this phase the suite is green with no semantic change anywhere.

### Phase 2: Core Implementation

Add `ghCommandRunner.ts` — the adapter's named, testable route into `GitContext.exec` — and rewire `githubBoardManager.ts`'s seven gh call sites onto it plus the relocated board builders, preserving the `'alternateIdentity'` credential purpose on every one. Then convert the guard's exempt set into the named two-entry structure with an exported pure predicate, keeping the `(0 allowlisted)` report intact and adding the named-set output.

### Phase 3: Integration

Repoint the four merged BDD step-definition files that import the relocated modules by deep path, update `README.md`'s two subtrees, and run the full validation set: type check (root and `adws/tsconfig.json`), lint, unit suite, whole-repo guard, this slice's own `@adw-792` scenarios, and the regression plus merged per-issue scenario tags that cover the touched surface.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Relocate the command builders

- `git mv adws/gitContext/commands adws/providers/github/commands`.
- Update each file's header comment to name the adapter package; do not change a single command string.
- Repoint `adws/gitContext/gitContext.ts:60-77` from `./commands/…` to `../providers/github/commands/…`, and wrap the five imports in a block comment: `TRANSITIONAL — the semantic methods below are pending migration (#796/#797); these imports leave with them.`
- Add a sentence to the `gitContext.ts` module header (`:1-39`) recording the residual dependency and its exit condition.

### 2. Relocate token resolution

- `git mv adws/gitContext/tokenResolver.ts adws/providers/github/tokenResolver.ts`.
- `git mv adws/gitContext/githubTokenProvider.ts adws/providers/github/githubTokenProvider.ts` (its relative import of `./tokenResolver` still resolves).
- `git mv adws/gitContext/__tests__/tokenResolver.test.ts adws/providers/github/__tests__/tokenResolver.test.ts` and the same for `githubTokenProvider.test.ts`; both import `../<module>`, so no edit is required.
- Update the header comments: `githubTokenProvider.ts:6-7` currently says "The first file of the forge adapter #792 will relocate wholesale" — replace with a statement that it now lives in the adapter.

### 3. Relocate App auth and inject its configuration

- `git mv adws/gitContext/appAuth.ts adws/providers/github/appAuth.ts`.
- Delete the `ENV` constant (`:21-25`). Add and export `GitHubAppConfig { appId?, appSlug?, privateKeyPath? }`.
- Change `isGitHubAppConfigured(config: GitHubAppConfig): boolean` to test the three config fields.
- Change `getInstallationToken(config: GitHubAppConfig, owner: string, repo: string, deps: AppAuthDeps = {}): string`; read `appId`/`privateKeyPath` from `config` and fail with a clear error if either is missing (today's non-null assertions at `:75-76` assume `isGitHubAppConfigured` was checked first — keep that contract but make the failure explicit rather than a `TypeError` from `fs.readFileSync(undefined)`).
- Leave the caches, `REFRESH_BUFFER_MS`, `clearAppAuthCaches`, `redactBearerTokens`, `buildCurlConfig`, `describeApiFailure`, `requestGitHubApi`, `createAppJWT`, `resolveInstallationId` and `fetchInstallationToken` untouched.
- Verify with `grep -n "process\[.\]env" adws/providers/github/appAuth.ts` that the file has zero environment reads (use the bracket form — a backslash-escaped dot trips the repo's pre-tool-use hook).

### 4. Turn `adws/github/githubAppAuth.ts` into the environment-binding shim

- Import `isGitHubAppConfigured as adapterIsConfigured` and `getInstallationToken as adapterGetInstallationToken` from `../providers/github/appAuth` (deep path, not the barrel).
- Add a module-private `readAppConfig()` that reads the three `GITHUB_APP_*` variables **per call**, preserving today's late binding.
- Re-export `isGitHubAppConfigured(): boolean` and `getInstallationToken(owner, repo): string` with unchanged signatures.
- Update the module header to state that this shim is the sole environment-binding site for GitHub App configuration.

### 5. Relocate the App-auth test and make it hermetic

- `git mv adws/gitContext/__tests__/appAuth.test.ts adws/providers/github/__tests__/appAuth.test.ts`.
- Replace the `beforeAll`/`afterAll` `process.env` mutation (`:20-49`) with a suite-scoped `GitHubAppConfig` literal built from the throwaway RSA key path; keep the key generation and `scratchDir` cleanup.
- Pass the config as the first argument at every `getInstallationToken` call site (`:108`, `:125`, `:140`, `:157`, `:179`, `:205`, `:224`, `:248`, `:252`, `:263`, `:272`, `:281`, `:293`, `:299`).
- Add two assertions for AC2: `isGitHubAppConfigured` returns `false` for an empty config and `true` for a complete one, with `process.env.GITHUB_APP_ID` deleted for the duration — proving the module no longer consults the environment.

### 6. Trim the core's public surface and repoint the wiring layer

- `adws/gitContext/index.ts`: remove the `isGitHubAppConfigured`/`getInstallationToken` export (`:31`), the `resolveContextToken`/`ResolveContextTokenInput` exports (`:34-35`) and the `createGitHubTokenProvider`/`GitHubTokenProviderInput` exports (`:23-24`); rewrite the header paragraph that describes the GitHub token-provider implementation as part of this package.
- `adws/github/gitContextFactory.ts:11-18`: take `isGitHubAppConfigured`/`getInstallationToken` from `./githubAppAuth` and `createGitHubTokenProvider` from `../providers/github/githubTokenProvider`; keep `readLocalRepoInfo`, `resolveBootstrapGitIdentity` and `ghAuthToken` coming from `../gitContext`.
- `adws/core/launchGitContext.ts:22-29`: the same repoint, plus `resolveContextToken` from `../providers/github/tokenResolver`.
- Confirm no remaining importer references the old paths: `grep -rn "gitContext/appAuth\|gitContext/tokenResolver\|gitContext/githubTokenProvider\|gitContext/commands" adws features test --include='*.ts' --include='*.tsx'` must return nothing.

### 7. Add the adapter's executor seam

- Create `adws/providers/github/ghCommandRunner.ts` with `GhCommandRunner` and `createGhCommandRunner(ctx: GitContext)` as specified in Solution §3.
- Document in the header that this is the adapter's only route to a child process, that the framework-root cwd class is #775's repo-API contract, and that the credential arrives per command through the TokenProvider port (#791).
- Import nothing from `child_process`; import `GitContext` and `CredentialPurpose` as types from `../../gitContext`.

### 8. Write the `ghCommandRunner` unit tests

- New `adws/providers/github/__tests__/ghCommandRunner.test.ts`, driving a real `GitContext` constructed with an injected `exec` spy (the established pattern in `adws/gitContext/__tests__/repoApiCwd.test.ts`).
- Assert: the command string reaches `exec` verbatim; cwd is the injected `frameworkRepoRoot` for both self-host and target contexts; `env.GH_TOKEN` carries the provider's credential and the four `GIT_*` identity variables are present; `'alternateIdentity'` yields the alternate credential while `'default'` yields the primary; `input` is piped through; and `process.env` is not mutated.

### 9. Rewire `githubBoardManager` onto the runner

- Replace `private get ctx()` (`:84-86`) with a `gh` getter returning `createGhCommandRunner(gitContextForRepo(this.repoInfo))`.
- Convert the five `runGraphQL` calls (`:93`, `:111`, `:119`, `:127`, `:134`, `:185`) to `this.gh.run(graphQLCmd(query, vars), { purpose: 'alternateIdentity' })` and the `runGraphQLInput` call (`:159`) to `this.gh.run(graphQLInputCmd(), { input: JSON.stringify(body), purpose: 'alternateIdentity' })`.
- Import `graphQLCmd`/`graphQLInputCmd` from `./commands/boardCommands`.
- Change nothing else: the inline GraphQL documents, the `try`/`catch` shapes, the `log(...)` warnings and every return value stay as they are.

### 10. Convert the guard's exempt set to the named pair

- Replace `EXEMPT_PACKAGE_DIR` (`:46`) with the exported `EXEMPT_PACKAGES` table (`dir` + `role`) and an exported pure `isExemptPackage(relPath: string): boolean` matching the directory itself or any path beneath it.
- Use the predicate in `visitDir` (`:81`). Do **not** introduce any skip into `scanFiles` — the `(0 allowlisted)` invariant depends on `scanFiles` skipping nothing.
- Update the file header (`:1-27`) to state the two-package contract in the PRD's words.
- In `main` (`:233-241`), keep the `(0 allowlisted)` fragment byte-identical and print the exempt set beneath it, one line per package with its role.
- Update the `git-gh-shellout` remedy text (`:250-253`) to name both packages.

### 11. Extend the guard's unit tests

- In `adws/__tests__/checkGitGhGuard.test.ts`, add a `describe` for the exempt set asserting: `EXEMPT_PACKAGES` has exactly two entries with dirs `adws/gitContext` and `adws/providers/github`; `isExemptPackage` returns `true` for both dirs and for files beneath them; and `false` for `adws/github/issueApi.ts`, `adws/providers/gitlab/gitlabCodeHost.ts`, `adws/phases/reviewPhase.ts` and `adws/providers/repoContext.ts`.
- Add the AC4 third-package case: `scanFiles` over a synthetic `adws/github/someNewApi.ts` whose source contains `execSync('gh issue view 1')` yields exactly one `git-gh-shellout` violation.
- Add the counterpart: the same source at `adws/providers/github/someAdapterOp.ts` is exempt by `isExemptPackage`, i.e. never reaches `scanFiles` in a whole-repo walk.
- Keep the existing `scanFiles.length === 2` assertion (`:69`) passing.

### 12. Repoint the BDD step definitions

- `feature-780.steps.ts`: import from `../../../adws/providers/github/appAuth.ts`; replace the `process.env.GITHUB_APP_*` assignment step (`:269-271`) with an explicit `GitHubAppConfig` stored on the world and passed to `getInstallationToken(config, owner, repo, deps)` at `:367`; drop the now-dead env save/restore (`:141-143`, `:157-159`).
- `feature-779.steps.ts:24` and `feature-700.steps.ts:32`: repoint `resolveContextToken` to `../../../adws/providers/github/tokenResolver.ts`.
- `feature-791.steps.ts:26`: split into `GitContext` from `../../../adws/gitContext/index.ts` and `createGitHubTokenProvider` from `../../../adws/providers/github/githubTokenProvider.ts`.
- Change no `Given`/`When`/`Then` phrase and no assertion — these are merged regression proofs; only import paths and the App-config plumbing move.

### 13. Update the README

- In the `gitContext/` subtree (`:635-677`), remove the `commands/` block, `appAuth.ts`, `githubTokenProvider.ts`, `tokenResolver.ts` and their `__tests__` entries; annotate the `gitContext.ts` line with the transitional builder dependency.
- In the `providers/github/` subtree (`:798-803`), add `__tests__/`, `commands/` (with the five builders and its test), `appAuth.ts`, `ghCommandRunner.ts`, `githubTokenProvider.ts`, `tokenResolver.ts`, each with a one-line description matching the surrounding style.
- Before committing, verify no line documenting a still-existing file was dropped: for each removed line, confirm the file no longer exists at that path.

### 14. Run the validation commands

- Execute every command in `## Validation Commands` and confirm each exits clean. Investigate and fix any failure rather than re-running.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, and the PRD's Testing Decisions name the relocated suites as the proof for this slice ("mostly relocated existing tests (token resolution, command builders, App auth); new tests only for clone-URL construction moving in" — clone-URL is #793, so this slice's only new suite is the executor seam).

**Relocated, assertions unchanged:**
- `adws/providers/github/commands/__tests__/issueCommands.test.ts` — the builders' output strings.
- `adws/providers/github/__tests__/tokenResolver.test.ts` — resolution order, the loud throw on a foreign App identity, and the sentinel proving `process.env.GH_TOKEN` is never read (`:145-150`).
- `adws/providers/github/__tests__/githubTokenProvider.test.ts` — per-call resolution with no memoisation, `'alternateIdentity'` selection, the graceful fallback when no alternate PAT is set.

**Relocated and strengthened:**
- `adws/providers/github/__tests__/appAuth.test.ts` — every existing assertion survives (JWT never in argv, credential on the `--config` stdin channel, sanitized failure shapes, the expiry-aware cache, `apiBaseUrl` override, the throw on an uninstalled App). Config becomes an explicit argument, and two new cases prove the module reads no environment: `isGitHubAppConfigured({})` is `false` and `isGitHubAppConfigured(completeConfig)` is `true` while `GITHUB_APP_*` are deleted from `process.env`.

**New:**
- `adws/providers/github/__tests__/ghCommandRunner.test.ts` — external behaviour only, over an injected exec fake: command string verbatim, framework-root cwd for both context kinds, credential and `GIT_*` identity in the per-command env, `'alternateIdentity'` versus `'default'` selection, stdin pass-through, and no `process.env` mutation.

**Extended:**
- `adws/__tests__/checkGitGhGuard.test.ts` — `EXEMPT_PACKAGES` is exactly two named entries; `isExemptPackage` true for both packages and their descendants, false for `adws/github/`, `adws/providers/gitlab/`, `adws/providers/repoContext.ts` and `adws/phases/`; a synthetic gh call site in a third package produces a violation.

**Regression net, untouched:** `adws/gitContext/__tests__/{gitContext,gitContextOperations,repoApiCwd,gitReadOps,workingDirectoryGuard}.test.ts` and `adws/providers/__tests__/boardManager.test.ts` must pass with **zero edits**. If any of them needs changing, the relocation stopped being behaviour-neutral and the cause must be found rather than the expectation updated.

### BDD Scenarios

`features/per-issue/feature-792.feature` (`@adw-792`) is this slice's behavioural proof and the build's RED-first driver. Its coverage maps onto the acceptance criteria as: AC1 → §1, §2, §3, §10, §19; AC2 → §4, §5, §6 with §7–§9 as the regression net; AC3 → §11, §11a, §12, §13, §14; AC4 → §15–§19; AC5 → the unit suites above plus §20's type check, deliberately not a scenario (a scenario shelling out to the whole unit suite would be slow, circular and would assert nothing this file does not already assert — feature-790's precedent for the identical criterion).

Two consequences for the implementation:

- §11a issues a gh command through the adapter's runner over an injected `exec` seam, so `createGhCommandRunner(ctx)` must be constructible from a `GitContext` alone, with no ambient state — the shape Solution §3 specifies.
- §11a's second row asserts a board command carries the alternate identity credential, which is the same `'alternateIdentity'` purpose Solution §4 preserves on all seven rewired `githubBoardManager` call sites. A dropped purpose fails that scenario rather than only surfacing as a silent `false` from a live Projects V2 write.

The physical-location half of AC1 — which directory holds which file — has no runtime witness and deliberately none is invented; the guard (§15–§19), the builder-equality row (§2) and HITL review carry it.

### Edge Cases

- **App config partially set** — `appId` present but `privateKeyPath` missing: `isGitHubAppConfigured` returns `false`, and a direct `getInstallationToken` call fails with a named error instead of a `TypeError` from `readFileSync(undefined)`.
- **Late-bound environment** — a process that assigns `GITHUB_APP_*` after module load (as `feature-780`'s steps and `feature-776`'s spawned webhook server both do) must still see the new values, because the shim reads them per call.
- **Installation-token cache sharing** — `gitContextFactory` and `launchGitContext` must keep hitting the same module-scope cache; a per-instance cache would silently double the mint rate for a long-running cron.
- **Board writes keep the PAT** — every rewired `githubBoardManager` call must still carry `'alternateIdentity'`; a dropped purpose regresses Projects V2 writes on user-owned repos to a credential that lacks access, and the failure is a silent `false` return.
- **Import cycles** — importing `../providers/github` (the barrel) from `gitContextFactory.ts`, `launchGitContext.ts` or `githubAppAuth.ts` closes a cycle through `githubCodeHost.ts`. Deep module paths only.
- **Guard report contract** — `(0 allowlisted)` must survive verbatim in stdout; `feature-700` §4b regex-matches it, and an absent count fails that merged scenario.
- **Guard scannedCount contract** — the exemption stays in `visitDir`; adding it to `scanFiles` would make files silently uncounted and break the `feature-695`/`696`/`697` de-allowlist proofs that assert `scannedCount === 1`.
- **Third-package gh call site** — a `gh` string literal introduced anywhere outside the two exempt packages (including `adws/providers/gitlab/` and `adws/providers/jira/`) must fail `bun run lint:git-guard`.
- **`git mv` history** — use `git mv`, not delete-and-create, so `git log --follow` still reaches #700/#780/#791 on the relocated files.

## Acceptance Criteria

- [ ] `adws/gitContext/` contains no `commands/` directory, no `appAuth.ts`, no `tokenResolver.ts` and no `githubTokenProvider.ts`; all four live under `adws/providers/github/`. The only GitHub material remaining in the core is the semantic methods pending migration and their five transitional builder imports, both marked as such in comments.
- [ ] `adws/providers/github/appAuth.ts` contains zero `process.env` reads; `GitHubAppConfig` is supplied by the caller, and `adws/github/githubAppAuth.ts` is the single site that reads `GITHUB_APP_ID`/`GITHUB_APP_SLUG`/`GITHUB_APP_PRIVATE_KEY_PATH`.
- [ ] `adws/providers/github/` imports nothing from `child_process`; every gh command it issues goes through `createGhCommandRunner` → `GitContext.exec`, and `githubBoardManager.ts` calls no `GitContext` semantic method.
- [ ] `adws/checkGitGhGuard.ts` names exactly two exempt packages — `adws/gitContext` (git core) and `adws/providers/github` (GitHub adapter) — each with its role; `bun run lint:git-guard` exits 0 across the whole repository and prints both names; a synthetic gh call site in a third package produces a `git-gh-shellout` violation in the guard's unit tests.
- [ ] The relocated token-resolution, command-builder and App-auth suites pass in their new home with no assertion weakened; `adws/gitContext/__tests__/*` and `adws/providers/__tests__/boardManager.test.ts` pass unedited.
- [ ] `bun run test:unit` is green with no test skipped or removed; `bunx tsc --noEmit` is clean at the repository root and under `adws/tsconfig.json`; `bun run lint` is clean.
- [ ] Every `@adw-792` scenario in `features/per-issue/feature-792.feature` is green, including the five RED-before rows (§4, §5, §6 injected App configuration; §11a the adapter's own gh call site; §15 a gh call site in the adapter passing the guard).
- [ ] The `@regression` suite and the per-issue tags `@adw-700`, `@adw-776`, `@adw-779`, `@adw-780`, `@adw-790`, `@adw-791` are green — the merged proofs covering token veracity, App-auth redaction, the executor and the TokenProvider port.
- [ ] `README.md` documents the new adapter layout, and no line documenting a still-existing file was removed.
- [ ] No behaviour change: the same gh commands run against the same repositories with the same credentials and the same working directories as before.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — ESLint across the repository.
- `bunx tsc --noEmit` — root type check (also what `bun run test` runs).
- `bunx tsc --noEmit -p adws/tsconfig.json` — the `adws/` project type check (`.adw/commands.md` → `## Additional Type Checks`).
- `bun run build` — `tsc` build.
- `bun run test:unit` — full vitest suite; must be green with no skips.
- `bun run lint:git-guard` — whole-repo git/gh guard; must exit 0, print `(0 allowlisted)`, and list exactly the two exempt packages.
- `bunx vitest run adws/providers/github adws/__tests__/checkGitGhGuard.test.ts adws/gitContext` — focused run over the relocated adapter suites, the guard suite and the untouched core suites.
- `grep -rn "gitContext/appAuth\|gitContext/tokenResolver\|gitContext/githubTokenProvider\|gitContext/commands" adws features test --include='*.ts' --include='*.tsx'` — must return no matches (no importer left on an old path).
- `grep -rn "child_process" adws/providers/github/` — must return no matches (AC3: the adapter never spawns).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression scenario suite.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-792"` — this slice's own scenarios; all must pass, none pending.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-700 or @adw-776 or @adw-779 or @adw-780 or @adw-790 or @adw-791"` — the merged per-issue proofs covering the relocated modules.

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` applies. The relocation is guideline-driven work: it deepens `adws/providers/github/` into a real module with a single responsibility, keeps the builders pure, isolates the environment read at one boundary, and keeps every new file well under the 300-line ceiling. `ghCommandRunner.ts` is a ~25-line module justified by named intent, exactly as the extraction rule describes.
- **No new libraries.** Nothing here needs a dependency. (`.adw/commands.md` → `## Library Install Command` is `bun add <package>` if that changes.)
- **The one judgment call to review** is Solution §6: `gitContext.ts` keeps five imports pointing *up* into the adapter, because AC1 explicitly leaves the semantic methods in the core. It is five lines in one file, marked `TRANSITIONAL`, and it is deleted by #796/#797 along with the methods themselves. The alternatives — inlining 41 builders back into the core, or leaving a GitHub re-export shim inside `gitContext/` — both fail AC1 more severely. Extraction (Phase B) is explicitly out of PRD scope, so the inversion costs nothing operationally in the meantime.
- **Deliberately out of scope**, with their owning slices: `bootstrapIdentity.ts`'s GitHub bot-identity derivation, `parseGitHubRemoteUrl` and the `github.com` clone-URL rewriting in `repoWorkspace.ts` (**#793**); minting bound providers at the launch boundary (**#794**); the guard's new provider-construction rule (**#795**); migrating the ~20 semantic callers and deleting `GitContext`'s semantic methods plus `GitContextOptions.token`/`.pat` (**#796**, **#797**).
- **`ghAuthToken` stays in the core on purpose.** It is the only `gh` shell-out left in `adws/gitContext/` after this slice, and it cannot route through `ghCommandRunner`: it is the pre-context read that produces the credential the runner needs, so a credentialed executor would be circular. It sits in `bootstrapIdentity.ts`, which **#793** splits. Until then, the guard's `adws/gitContext` exemption legitimately covers it.
- **Sequencing note from the PRD** ("land the executor + TokenProvider reshaping before the caller migration, so migrated callers land directly on the final shape"): after this slice, `createGhCommandRunner` is the shape #796/#797's migrated callers should land on.
- **HITL slice.** This issue carries the `hitl` label — a human reviews before merge. Keep the diff legible: the `git mv` relocations, the `appAuth` config injection, the `ghCommandRunner` addition, the board-manager rewire and the guard change should be separable in review even if they land in one commit.
