# Feature: The launch boundary mints providers bound to the context's identity

## Metadata
issueNumber: `794`
adwId: `ncj1hq-launch-boundary-mint`
issueJson: `{"number":794,"title":"Launch boundary mints providers bound to context identity","body":"## Parent PRD\n\nspecs/prd/gitcontext-forge-agnostic-refactor.md\n\n## What to build\n\nExtend the launch-boundary constructor to mint bound provider instances (IssueTracker / CodeHost / BoardManager) alongside the GitContext, from the same identity, in the same call. The boundary becomes the only sanctioned construction site for both contexts and providers; downstream code receives providers, never constructs them.\n\nSee PRD sections: Implementation Decisions (Launch boundary), user stories 5/6.\n\n## Acceptance criteria\n\n- [ ] One boundary call yields context + providers bound to identical owner/repo identity; no code path can produce divergent identities from one call\n- [ ] Provider selection remains config-driven per target repo (defaulting to GitHub), unchanged\n- [ ] Existing boundary consumers (cron, merge, workflow init) receive providers through the boundary result\n- [ ] Tests assert identity binding equivalence between the minted context and providers\n\n## Blocked by\n\n- Blocked by #792\n\n## Touched Files\n\n- adws/core/launchGitContext.ts\n- adws/providers/repoContext.ts\n- adws/core/__tests__/launchGitContext.test.ts\n- adws/providers/__tests__/repoContext.test.ts\n\n## User stories addressed\n\n- User story 5\n- User story 6","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-08-14T12:18:54Z","comments":[],"actionableComment":null}`

## Feature Description

`buildLaunchGitContext(targetRepo, deps)` (`adws/core/launchGitContext.ts:119`) is the one sanctioned place where an ADW process decides *which repository it is operating on*. It resolves `{owner, repo}` exactly once — from `--target-repo`, or from the local git remote when self-hosting — and hands that identity to a `GitContext`. Everything downstream that needs a repo-bound *forge* operation, however, resolves identity a **second** time: `createRepoContext({repoId, cwd})` is called at four sites with a hand-built `RepoIdentifier`, `adwMerge.tsx:271` calls `buildRepoIdentifier(targetRepo)` one line after building its context, and `adwUpgrade.tsx:503` constructs a `CodeHost` outright. Two independent derivations of the same fact are exactly the shape the GitContext PRD was written to kill.

This slice makes the boundary yield both. `buildLaunchBoundary(targetRepo, deps)` returns a `LaunchBoundary` — `{ gitContext, repoId, providers }` — where `providers` is the `{issueTracker, codeHost, boardManager?}` triple bound, in that same call, to the *same* `{owner, repo}` value the `GitContext` received, with no second read of any identity source. (Identity is fixed at the call; the instances themselves are minted on first access and memoised — Solution §3.) `buildLaunchGitContext` survives as the context-only view of that same call (`buildLaunchBoundary(...).gitContext`), so the six existing call sites and four merged BDD proofs that use it keep working byte-for-byte.

Provider *selection* — which platform implements each port — is untouched: it still comes from `.adw/providers.md` per target repo and still defaults to GitHub (`loadProviderConfig`, `adws/providers/repoContext.ts:73`). What changes is that the selected implementations are bound to boundary identity rather than to an identity re-derived at the call site.

This is slice 4 of the GitContext forge-agnostic refactor (`specs/prd/gitcontext-forge-agnostic-refactor.md`, user stories 5 and 6). #790 promoted the spawn chokepoint to a public executor, #791 replaced the cached credential with a `TokenProvider` port, #792 moved the GitHub material into the forge adapter. This slice closes the *construction* half of the hexagon so that #795 can make it structural (a CI rule forbidding provider construction outside the boundary) and #796/#797 can migrate the ~20 semantic callers onto providers they are *handed* rather than providers they build.

## User Story

As an ADW orchestrator
I want one launch-boundary call to hand me both a GitContext and the provider instances bound to the same repository identity
So that no code path downstream can address a different repository than the one my process was launched for

## Problem Statement

**Identity is derived twice, from two different sources, one line apart.** In `adwMerge.main()` (`adws/adwMerge.tsx:270-272`):

```ts
const gitContext = buildLaunchGitContext(targetRepo);          // identity #1
const repoId = buildRepoIdentifier(targetRepo);                // identity #2 — getRepoInfo() when targetRepo is null
const repoInfo: RepoInfo = { owner: gitContext.owner, repo: gitContext.repo };
```

`buildRepoIdentifier` (`adws/core/orchestratorCli.ts:139-145`) falls back to `getRepoInfo()` — a cwd-derived read — while `buildLaunchGitContext` falls back to `deps.getRepoInfo()`. They agree today because both land on the same function under the same cwd. That agreement is a coincidence of wiring, not a property of the code, and it is precisely the coincidence the wrong-repo bug class (~13 incidents, PRD Problem Statement) kept breaking.

**Providers are constructed at consumption sites, not at the boundary.** `createRepoContext` is called from `adws/phases/workflowInit.ts:305`, `adws/phases/prReviewPhase.ts:110`, `adws/phases/upgradeGate.ts:194`, and four times in `adws/triggers/pauseQueueScanner.ts` (`:124`, `:160`, `:214`, `:271`). Three of those sites rebuild the `RepoIdentifier` inline from `repoInfo ?? getRepoInfo()`; `pauseQueueScanner` builds it from a queue entry and passes `cwd: process.cwd()`. `adwUpgrade.tsx:503` skips the factory entirely and calls `createGitHubCodeHost(repoId)`. PRD story 6 wants construction "restricted to the launch boundary, so that identity selection stays in one audited place"; today there is no boundary API that *can* hand a provider to a caller, so every caller must build one.

**The boundary has no provider vocabulary at all.** `LaunchGitContextDeps` knows about tokens, git identity and directories; `RepoIdentifier`, `Platform` and the provider ports do not appear in `launchGitContext.ts`. #795's guard rule ("fail the build when a module constructs a provider outside the sanctioned boundary") has nothing to allowlist until this slice creates the sanctioned site.

**Constraints that make this non-trivial:**

1. **`createRepoContext` cannot run at launch time.** It calls `validateWorkingDirectory(cwd)` and `validateGitRemote(cwd, repoId)` (`repoContext.ts:118-176`), so it needs a cloned, checked-out workspace. At the boundary there may be none: `adwMerge.tsx` calls `ensureTargetRepoWorkspace(targetRepo)` *four lines after* building its context (`:274`), and `initializeWorkflow` creates the worktree ~140 lines after its boundary call. Provider minting at the boundary must therefore be free of workspace validation.
2. **The boundary must not gain new failure modes or new eager I/O.** `buildLaunchGitContext` runs inside the cron's module-scope entry guard (`trigger_cron.ts:76`), the webhook's per-event resolution (`trigger_webhook.ts:158`) and `promotionSweep.ts:283`. `loadProviderConfig` → `parsePlatform` *throws* on an unrecognised platform string (`repoContext.ts:57-62`); making that read eager would turn a malformed `.adw/providers.md` in a target workspace into a cron that will not start — a regression, against a PRD whose bar is "operationally invisible".
3. **Reading provider config before the workspace exists is simply wrong.** `loadProviderConfig` returns GitHub defaults when the file is absent (`:76-78`). Read at boundary time for a not-yet-cloned target repo, a GitLab-configured repo would silently select GitHub — a behaviour change that depends on clone state.

## Solution Statement

### 1. `BoundProviders` — the identity-bound provider triple, named

`adws/providers/types.ts` gains the type that is currently only implied, and `RepoContext` is re-expressed in terms of it (structurally identical to today — a `Readonly` object with the same five members, so every existing consumer and every `Object.freeze({...})` producer type-checks unchanged):

```ts
export type BoundProviders = Readonly<{
  issueTracker: IssueTracker;
  codeHost: CodeHost;
  boardManager?: BoardManager;
}>;

/** A RepoContext is bound providers plus the workspace they were validated against. */
export type RepoContext = BoundProviders & Readonly<{ cwd: string; repoId: RepoIdentifier }>;
```

### 2. `mintBoundProviders` — provider resolution split out of workspace validation

`adws/providers/repoContext.ts` keeps one provider-selection site; what changes is that the *selection* is separable from the *validation* that only a workspace-bearing caller can satisfy:

```ts
export interface MintProvidersOptions {
  repoId: RepoIdentifier;
  codeHostPlatform: Platform;
  issueTrackerPlatform: Platform;
}

/**
 * Mints the frozen provider triple bound to `repoId`. No filesystem, no git, no network.
 * A platform with no implementation is refused BY NAME — never substituted with GitHub.
 */
export function mintBoundProviders(options: MintProvidersOptions): BoundProviders;
```

It is the body that `createRepoContext` runs today, lifted verbatim: `resolveIssueTracker`, `resolveCodeHost`, and `resolveBoardManager` inside the existing `try`/`catch` that makes `boardManager` optional. `createRepoContext` becomes composition, keeping all three validations and gaining one optional field:

```ts
export interface RepoContextOptions {
  repoId: RepoIdentifier;
  cwd: string;
  codeHostPlatform?: Platform;
  issueTrackerPlatform?: Platform;
  providersConfig?: ProvidersConfig;
  /** Boundary-minted providers. When supplied, resolution is skipped and these instances are reused. */
  providers?: BoundProviders;
}

export function createRepoContext(options: RepoContextOptions): RepoContext {
  const { repoId, cwd } = options;
  validateRepoIdentifier(repoId);
  validateWorkingDirectory(cwd);
  validateGitRemote(cwd, repoId);
  const providers = options.providers ?? mintBoundProviders({ repoId, ...resolvePlatformSelection(options, cwd) });
  return Object.freeze({ ...providers, cwd, repoId });
}
```

`resolvePlatformSelection` is the existing three-branch platform decision (`repoContext.ts:239-252`) extracted to a named function — explicit platforms, then `providersConfig`, then `loadProviderConfig(cwd)`. Extraction is justified by named intent and by reuse from `mintBoundProviders`' caller, not by line count. `loadProviderConfig`, `validateWorkingDirectory`, `validateGitRemote`, `parseOwnerRepoFromUrl` and the three `resolve*` functions keep their exported signatures — `validateGitRemote` is imported by the merged proof `features/per-issue/step_definitions/feature-565.steps.ts:43`.

### 3. `buildLaunchBoundary` — one call, one identity, both artefacts

```ts
export interface LaunchBoundary {
  readonly gitContext: GitContext;
  /** The boundary's repo identity — the same owner/repo the GitContext carries. */
  readonly repoId: RepoIdentifier;
  /** Providers bound to `repoId`. Minted on first access, then memoised. */
  readonly providers: BoundProviders;
}

export function buildLaunchBoundary(
  targetRepo: TargetRepoInfo | null,
  deps: LaunchGitContextDeps = {},
): LaunchBoundary {
  // ... existing dep defaulting, unchanged ...
  const selfHost = targetRepo === null;
  const { owner, repo } = targetRepo ?? getInfo();          // resolved EXACTLY ONCE
  const gitContext = new GitContext({ owner, repo, selfHost, tokenProvider, gitIdentity: resolveIdentity(), frameworkRepoRoot, targetReposDir });
  const repoId: RepoIdentifier = { owner, repo, platform: deps.platform ?? Platform.GitHub };
  return freezeBoundary(gitContext, repoId, () => {
    const config = loadConfig(gitContext.basePath);          // identity-derived path, never cwd
    return mint({ repoId, codeHostPlatform: config.codeHost, issueTrackerPlatform: config.issueTracker });
  });
}

/** The context-only view of a boundary call. Unchanged behaviour for every existing caller. */
export function buildLaunchGitContext(targetRepo: TargetRepoInfo | null, deps: LaunchGitContextDeps = {}): GitContext {
  return buildLaunchBoundary(targetRepo, deps).gitContext;
}
```

`freezeBoundary` is a ~8-line helper holding the memo:

```ts
function freezeBoundary(gitContext: GitContext, repoId: RepoIdentifier, mint: () => BoundProviders): LaunchBoundary {
  let minted: BoundProviders | undefined;
  return Object.freeze({ gitContext, repoId, get providers() { return (minted ??= mint()); } });
}
```

Three properties fall out of this shape:

- **AC1 is structural, not conventional.** `owner`/`repo` are destructured once into two consumers. There is no second call to `getInfo()`, no `getRepoInfo()` import reachable from the provider path, and `repoId` is captured by the mint closure — so divergence would require editing the destructuring itself, and the unit suite pins that with a repo-info source that deliberately answers differently on a second call.
- **Deferred minting adds no eager failure mode and no eager I/O** (Problem constraints 2 and 3). Building a context reads no `.adw/providers.md`; the first provider *use* does — by which time `ensureTargetRepoWorkspace` has run and the file, if any, is the target repo's own.
- **Identity is fixed at the call regardless.** Laziness affects only *when* the config is read, never *which repo* the providers address: the closure holds the boundary's `repoId`, so `boundary.providers.codeHost.getRepoIdentifier()` can only ever equal `boundary.repoId`.

Two new injectable seams join `LaunchGitContextDeps` (all optional, production defaults applied): `loadProviderConfig?: (dir: string) => ProviderConfig` and `mintProviders?: (o: MintProvidersOptions) => BoundProviders`, plus `platform?: Platform` for the identifier's declared platform.

### 4. Provider selection stays exactly where it is (AC2)

The boundary decides *nothing* about platforms. It calls the same `loadProviderConfig` the factory calls, which returns `{codeHost: Platform.GitHub, issueTracker: Platform.GitHub}` when `.adw/providers.md` is absent, and it hands the answer to the same `resolveIssueTracker`/`resolveCodeHost`/`resolveBoardManager` switches. The only difference is the directory the config is read from: **`gitContext.basePath`** — `<targetReposDir>/<owner>/<repo>` for a target, `frameworkRepoRoot` for self-host — instead of a caller-supplied `cwd`. That is identity-derived by construction (PRD invariant: no cwd fallback), and for the migrated `workflowInit` path it is the same repository as the worktree it replaces, one commit-ish away.

**Refused, never substituted.** A configured platform ADW has no implementation for (`bitbucket` as a code host, anything non-GitHub as an issue tracker) throws from `resolveCodeHost`/`resolveIssueTracker` naming the platform, and an unparseable value throws from `parsePlatform` naming the value. That is today's behaviour, kept verbatim: falling back to GitHub because a repo's configuration could not be honoured would address the right repository through the wrong forge, which is the wrong-repo bug class in different clothes. Under deferred minting the refusal surfaces on the first provider request rather than at the boundary call — the same moment it surfaces today, inside `workflowInit`'s existing `try`/`catch` — which is what AC2's "unchanged" and the PRD's "operationally invisible" bar both ask for. `@adw-794` §8 is worded to observe the refusal at the *request*, so it holds for either minting strategy and fails only for a substituting one.

`RepoIdentifier.platform` stays `Platform.GitHub` by default, reproducing `buildRepoIdentifier` exactly. It is a *declared* identity field (`adwMerge` gates deps on it at `:279`), not the provider-selection input; unifying it with the configured code host would change `adwMerge`'s behaviour on a GitLab repo and belongs to #796.

### 5. The three named consumers receive providers through the boundary result (AC3)

| Consumer | Change |
| --- | --- |
| **workflow init** (`adws/phases/workflowInit.ts:137`, `:305`) | Holds the `LaunchBoundary` instead of a bare context. `gitContext` becomes `boundary?.gitContext`; `repoId` for the `RepoContext` becomes `options?.repoId ?? boundary?.repoId ?? <existing fallback>`; `createRepoContext` receives `providers: boundary.providers` when the resolved `repoId` matches the boundary identity (`sameRepoIdentity`, `adws/core/repoIdentityCrossCheck.ts:16`). Both existing `try`/`catch` fallbacks stay: a boundary that fails to build still yields `undefined`, and `createRepoContext` still degrades to "direct API calls". |
| **merge** (`adws/adwMerge.tsx:270-272`) | `const boundary = buildLaunchBoundary(targetRepo)`; `gitContext` and `repoId` both come from it. The second derivation — `buildRepoIdentifier(targetRepo)` — is deleted from this file. `buildRepoIdentifier` itself stays exported for `adwSdlc`/`adwBuild`/`adwPlanBuildTest`/`adwPlanBuildReview`/`adwUpgrade` (#796). |
| **cron** (`adws/triggers/trigger_cron.ts:71-77`) | The module-scope `cronGitContext` is fed from a module-scope `cronBoundary`, and `export function getCronProviders(): BoundProviders \| null` exposes the boundary-minted triple. Every existing use of `cronGitContext` (`:134`, `:140`, `:390`) is untouched. Cron has no provider-shaped call site today — its `listOpenIssues`/`remoteUrl` calls are `GitContext` semantics that #797 migrates — so this slice delivers the receiving end, deliberately and visibly, rather than pre-empting #797's migration. |

`trigger_webhook.ts:158` and `promotionSweep.ts:283` keep calling `buildLaunchGitContext`, which is now a view over the same one call. They need no edit, and get providers the moment #796/#797 ask for them.

### 6. What this slice deliberately does not do

Provider factory signatures are unchanged: `createGitHubCodeHost(repoId)` and friends still construct their own `GitContext` internally (`githubBoardManager.ts:88`, `githubCodeHost.ts:47`). Threading the boundary's context *into* providers is a real improvement and a real behaviour risk (it would change which credential and cwd class every provider call uses); it belongs with the semantic-caller migration in #796/#797. `adwUpgrade.tsx:503`'s ad-hoc `createGitHubCodeHost` and the three non-boundary `createRepoContext` sites (`prReviewPhase`, `upgradeGate`, `pauseQueueScanner`) also stay — #795's guard rule is what forces them, and this slice's job is to make sure a sanctioned alternative exists first.

## Relevant Files

Use these files to implement the feature:

### The boundary
- `adws/core/launchGitContext.ts` — the boundary constructor. Gains `LaunchBoundary`, `buildLaunchBoundary`, the `freezeBoundary` memo helper, and three new `LaunchGitContextDeps` seams; `buildLaunchGitContext` becomes the context-only view.
- `adws/core/index.ts:166-168` — re-exports the boundary API; must export `buildLaunchBoundary` and the `LaunchBoundary` type (cron and `adwMerge` import from this barrel).
- `adws/core/repoIdentityCrossCheck.ts` — `sameRepoIdentity` is reused by `workflowInit` to decide whether boundary providers match a caller-supplied `repoId`.

### The provider factory
- `adws/providers/repoContext.ts` — gains `mintBoundProviders` and `resolvePlatformSelection`; `createRepoContext` gains the optional `providers` passthrough. `loadProviderConfig`, `validateWorkingDirectory`, `validateGitRemote`, `parseOwnerRepoFromUrl`, `resolveIssueTracker`, `resolveCodeHost`, `resolveBoardManager` keep their signatures.
- `adws/providers/types.ts` — gains `BoundProviders`; `RepoContext` re-expressed as `BoundProviders & Readonly<{cwd, repoId}>`.
- `adws/providers/index.ts` — already `export * from './types'` and `'./repoContext'`; no edit needed, but confirm the new names surface.
- `adws/providers/github/githubCodeHost.ts:107`, `githubIssueTracker.ts:75`, `githubBoardManager.ts:207`, `adws/providers/gitlab/gitlabCodeHost.ts:88` — the factories being minted. **Read-only for this slice**; `CodeHost.getRepoIdentifier()` (`types.ts`) is the identity witness the tests assert on.

### Consumers migrated
- `adws/adwMerge.tsx:270-272` — the clearest double-derivation; collapses to one boundary call.
- `adws/triggers/trigger_cron.ts:69-77` — module-scope launch boundary under the `process.argv[1]` entry-script guard.
- `adws/phases/workflowInit.ts:133-140`, `:296-311`, `:320-321` — boundary call, `RepoContext` creation, and the launch-identity derivation feeding `crossCheckRepoIdentity`.

### Consumers deliberately untouched (context for the reviewer)
- `adws/triggers/trigger_webhook.ts:152-160`, `adws/triggers/promotionSweep.ts:283` — keep the context-only view.
- `adws/phases/prReviewPhase.ts:110`, `adws/phases/upgradeGate.ts:194`, `adws/triggers/pauseQueueScanner.ts:124/160/214/271`, `adws/adwUpgrade.tsx:503` — remaining non-boundary construction sites, owned by #795/#796.

### Tests
- `adws/core/__tests__/launchGitContext.test.ts` — the boundary suite (§1–§7 today); gains the provider-minting sections.
- `adws/providers/__tests__/repoContext.test.ts` — currently only `parseOwnerRepoFromUrl`; gains `mintBoundProviders` coverage.
- `adws/phases/__tests__/workflowInit.test.ts:66` — mocks `createRepoContext` with a `vi.fn()`; its existing cases must keep passing, and it gains the assertion that the mock was handed the boundary's `providers` (AC3's workflow-init half).
- `adws/triggers/__tests__/pauseQueueScanner.test.ts:54`, `adws/triggers/__tests__/webhookRepoResolver.test.ts:82/360` — regression net for the untouched callers.

### BDD scenarios for this slice
- `features/per-issue/feature-794.feature` — `@adw-794 @adw-ncj1hq-launch-boundary-mint`, this slice's behavioural proof.
- `features/per-issue/step_definitions/feature-794.steps.ts` — in-process module composition over `buildLaunchBoundary` / `createRepoContext`, following `feature-791.steps.ts:388-400` and `feature-700.steps.ts:137`.

### Merged proofs that must stay green
- `features/per-issue/feature-791.feature` + steps (`:394` builds through `buildLaunchGitContext`), `feature-700`, `feature-664`, `feature-660` (`:120`, `:129`), `feature-565` (imports `validateGitRemote`).

### Conditional documentation (from `.adw/conditional_docs.md`)
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — **owns** `adws/core/launchGitContext.ts` and its test. Conditions match directly ("working with `buildLaunchGitContext`, `LaunchGitContextDeps`…", "constructing a GitContext at a process launch boundary (cron entry-script guard, `adwMerge.main()`, `initializeWorkflow`)").
- `app_docs/feature-9gjajh-providers.md` — **owns** `adws/providers/**`.
- `app_docs/feature-1773073902212-9l2nv9-repo-context-factory.md` — "working with `RepoContext`, `createRepoContext`, or `adws/providers/repoContext.ts`"; "adding support for new provider platforms"; "configuring `.adw/providers.md` for a target repository".
- `app_docs/feature-1773073910340-o5ncqk-repo-context-factory.md` — "working with the RepoContext factory or repo context abstraction".
- `app_docs/feature-1773312009789-vruh95-migrate-phases-to-repo-context.md` — "migrating phases to use RepoContext instead of direct GitHub calls".
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — owns `adws/core/launchGitContext.ts`, `adws/phases/workflowInit.ts`, `adws/github/gitContextFactory.ts`.
- `app_docs/feature-e2er82-github-forge-adapter.md` — the adapter package layout and the deep-import rule (#792).
- `app_docs/feature-9gjajh-promotion-system.md` — `promotionSweep.ts`'s CLI entry guard as a real launch boundary; confirms it must keep working through the context-only view.
- `README.md:135`, `:570`, `:822` — the provider-abstraction note and the two file-tree lines that describe `launchGitContext.ts` and `repoContext.ts`.

### New Files
- `features/per-issue/feature-794.feature`
- `features/per-issue/step_definitions/feature-794.steps.ts`

(No new source modules: the whole slice is additive surface on two existing files. The `freezeBoundary` memo helper is module-private in `launchGitContext.ts`.)

## Implementation Plan

### Phase 1: Foundation
Name the provider triple (`BoundProviders`) and split provider *resolution* from workspace *validation* in `adws/providers/repoContext.ts`, so the same selection logic can serve both a validating workspace caller and a workspace-free launch boundary. Nothing changes behaviourally: `createRepoContext` still validates identity, working directory and git remote, and still resolves platforms through the same three-branch decision.

### Phase 2: Core Implementation
Add `LaunchBoundary` and `buildLaunchBoundary` to `adws/core/launchGitContext.ts`, resolving `{owner, repo}` once and feeding both the `GitContext` and the `RepoIdentifier`; mint providers through a memoised getter so the context-only path gains no eager I/O and no new failure mode. Reduce `buildLaunchGitContext` to `buildLaunchBoundary(...).gitContext` so there is exactly one construction path. Prove identity binding and config-driven selection in the unit suites.

### Phase 3: Integration
Migrate the three named consumers — cron, merge, workflow init — onto the boundary result: merge drops its second identity derivation, workflow init passes boundary providers into `createRepoContext`, cron exposes the minted triple for #797. Prove the whole thing with `@adw-794` scenarios, re-run the merged boundary proofs, and update the README lines that describe the two changed modules.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Read the ground truth before editing

- Read `specs/prd/gitcontext-forge-agnostic-refactor.md` (Implementation Decisions → "Launch boundary", "Provider selection", "Wrong-repo invariants preserved throughout"; Testing Decisions → "Launch-boundary extension"; user stories 5, 6, 21).
- Read `.adw/coding_guidelines.md` and apply it throughout: single responsibility per unit, files under 300 lines, immutability, explicit types over `any`, guard clauses over nesting, side effects at the edges.
- Read `adws/core/launchGitContext.ts`, `adws/providers/repoContext.ts`, `adws/providers/types.ts`, and the two test files in full.
- Read the conditional docs listed above for `launchGitContext.ts` and `adws/providers/**`.
- Read `features/per-issue/feature-794.feature` if the scenario phase has already written it; it is the RED-first driver for this build.

### 2. Add `BoundProviders` to the provider types

- In `adws/providers/types.ts`, add `BoundProviders` (readonly `issueTracker`, `codeHost`, optional `boardManager`) with a JSDoc line stating that the triple is bound to one `RepoIdentifier` at construction.
- Re-express `RepoContext` as `BoundProviders & Readonly<{ cwd: string; repoId: RepoIdentifier }>`.
- Run `bunx tsc --noEmit -p adws/tsconfig.json`: zero errors expected — the intersection is structurally identical to the previous literal, so no consumer of `RepoContext` should need an edit. If any consumer breaks, the shape diverged; fix the type, not the consumer.

### 3. Extract `mintBoundProviders` and `resolvePlatformSelection` in `repoContext.ts`

- Add `MintProvidersOptions` and `mintBoundProviders(options): BoundProviders`, moving the `resolveIssueTracker` / `resolveCodeHost` / `resolveBoardManager` block out of `createRepoContext` verbatim — including the `try`/`catch` that leaves `boardManager` undefined for platforms without support, comment intact.
- Extract the three-branch platform decision into `resolvePlatformSelection(options, cwd): { codeHostPlatform: Platform; issueTrackerPlatform: Platform }`, preserving precedence exactly: both explicit platforms → `providersConfig` → `loadProviderConfig(cwd)`.
- Rewrite `createRepoContext` as validation + `options.providers ?? mintBoundProviders(...)` + freeze, per Solution §2. Keep every existing export signature.
- Confirm the file stays under the 300-line guideline ceiling.

### 4. Unit-test `mintBoundProviders`

- Extend `adws/providers/__tests__/repoContext.test.ts` (no filesystem, no git — `mintBoundProviders` touches neither):
  - GitHub/GitHub returns all three providers; `codeHost.getRepoIdentifier()` deep-equals the supplied `repoId`.
  - An unsupported code-host platform (`Platform.Bitbucket`) throws naming `bitbucket`; an unsupported issue-tracker platform (`Platform.GitLab`) throws naming `gitlab`. These are the "refused by name, never substituted with GitHub" rows AC2 turns on, and they mirror `@adw-794` §8.
  - A `repoId` with an empty owner or repo throws through `validateRepoIdentifier`.
  - The returned triple is frozen, and two calls with the same `repoId` return distinct `codeHost`/`issueTracker` instances.
- **Do not write a positive GitLab row.** `createGitLabCodeHost` requires `GITLAB_TOKEN`, which `adws/core/environment.ts:124` reads into a module-scope constant at load time — a test cannot arrange it without rewriting the module graph. The same constraint makes `resolveBoardManager`'s optional-swallow branch unreachable from a unit test: reaching it needs a code host that resolves on a platform the board manager does not serve, i.e. GitLab. That `try`/`catch` moves verbatim and keeps its existing coverage; the positive non-GitHub path stays proven where it already is, in the provider suites. `features/per-issue/feature-794.feature` records the identical finding for the BDD harness.
- Run `bunx vitest run adws/providers/__tests__/repoContext.test.ts` — green.

### 5. Add `LaunchBoundary`, `buildLaunchBoundary` and the deps seams

- In `adws/core/launchGitContext.ts`: add the `LaunchBoundary` interface, the module-private `freezeBoundary` memo helper, and `buildLaunchBoundary` per Solution §3.
- Extend `LaunchGitContextDeps` with `platform?: Platform`, `loadProviderConfig?: (dir: string) => ProviderConfig`, `mintProviders?: (o: MintProvidersOptions) => BoundProviders` — each JSDoc'd with its production default, matching the existing seam style.
- Import `mintBoundProviders` / `loadProviderConfig` / the types from the **deep module path** `../providers/repoContext` and `../providers/types`, never the `../providers` barrel (#792's deep-import rule; the barrel re-exports `githubCodeHost`, which imports the `../../core` barrel).
- Reduce `buildLaunchGitContext` to `return buildLaunchBoundary(targetRepo, deps).gitContext;`, keeping its JSDoc and adding one line noting it is the context-only view of the boundary call.
- Update the file header comment to state that the boundary now mints providers alongside the context (#794).
- Export `buildLaunchBoundary` and `type LaunchBoundary` from `adws/core/index.ts` beside the existing boundary exports (`:166-168`).

### 6. Unit-test the boundary's identity binding and selection

Extend `adws/core/__tests__/launchGitContext.test.ts` with new sections, keeping §1–§7 **unedited** (they are the proof that `buildLaunchGitContext` is behaviourally unchanged — if any of them needs a change, the delegation is not behaviour-neutral and the cause must be found, not the expectation updated):

- **Identity binding (AC1/AC4).** For a target boundary and a self-host boundary: `boundary.repoId.owner/repo` equal `boundary.gitContext.owner/repo`, and `boundary.providers.codeHost.getRepoIdentifier()` deep-equals `boundary.repoId`.
- **Divergence foreclosed.** A `getRepoInfo` seam that returns a *different* owner/repo on its second call still yields a boundary whose context and providers agree, and is called exactly once for a self-host boundary (zero times for a target boundary).
- **Both ports and the board manager get the same identity.** With an injected `mintProviders` recording its argument: one invocation, whose `repoId` is the boundary's.
- **Config-driven selection unchanged (AC2).** Injected `loadProviderConfig` returning `{codeHost: Platform.GitLab, issueTracker: Platform.GitHub}` reaches `mintProviders` as exactly those platforms; a loader returning the GitHub defaults yields GitHub for both; the loader is called with `gitContext.basePath` (target: `join(targetReposDir, owner, repo)`; self-host: `frameworkRepoRoot`).
- **Deferred, memoised minting.** Building the boundary calls neither the config loader nor the mint seam; the first `boundary.providers` access calls each once; a second access calls neither again and returns the identical object.
- **The context-only view is total.** `buildLaunchGitContext` succeeds with a config loader that throws — proving the cron/webhook/promotionSweep startup path gained no failure mode — and returns a context whose identity matches a `buildLaunchBoundary` call with the same arguments.
- **Default platform.** `boundary.repoId.platform` is `Platform.GitHub` with no `deps.platform`, and honours an injected override.
- Run `bunx vitest run adws/core/__tests__/launchGitContext.test.ts` — green, with §1–§7 untouched.

### 7. Migrate merge to a single identity

- In `adws/adwMerge.tsx:270-272`: build one `LaunchBoundary`; take `gitContext` and `repoId` from it; delete the `buildRepoIdentifier(targetRepo)` call and its now-unused import from the `./core` import list (leave the exported function itself in place — four other orchestrators use it).
- Verify `repoInfo` still derives from `gitContext.owner/repo` (unchanged) and that `buildDefaultDeps(repoId.platform, gitContext)` still receives `Platform.GitHub` for a GitHub repo.
- Run `bunx vitest run adws/__tests__ adws/phases/__tests__` (whichever suites cover merge) plus `bunx tsc --noEmit -p adws/tsconfig.json`.

### 8. Migrate cron to the boundary result

- In `adws/triggers/trigger_cron.ts`: replace the module-scope `cronGitContext` assignment with a `cronBoundary: LaunchBoundary | null` assigned inside the existing `process.argv[1]` entry-script guard, and set `cronGitContext = cronBoundary.gitContext` from it. Do not change the guard, the null-when-imported semantics, or any existing `cronGitContext` use (`:134`, `:140`, `:390`).
- Add `export function getCronProviders(): BoundProviders | null` returning `cronBoundary?.providers ?? null`, JSDoc'd as the receiving end for the semantic-caller migration (#797) and as bound to the same identity as `cronGitContext`.
- Confirm `runPerIssueScenarioSweepTick` / `runPromotionSweepTick` and their null-context skips are untouched.

### 9. Migrate workflow init to boundary providers

- In `adws/phases/workflowInit.ts:133-140`: hold `boundary: LaunchBoundary | undefined` from `buildLaunchBoundary(targetRepo ?? null)` inside the existing `try`/`catch`; derive `gitContext` from it. The graceful-fallback comment stays accurate and should be extended to mention providers.
- At `:296-311`: resolve `repoIdForContext` as `options?.repoId ?? boundary?.repoId ?? <existing repoInfo/getRepoInfo fallback>`; pass `providers: boundary.providers` to `createRepoContext` only when `boundary` exists **and** `sameRepoIdentity(repoIdForContext, boundary.repoId)`; keep the surrounding `try`/`catch` and its "falling back to direct API calls" log.
- Leave `:320-321` (`launchRepoIdentity` from `gitContext`) and `crossCheckRepoIdentity` unchanged.
- Extend `adws/phases/__tests__/workflowInit.test.ts`: its `createRepoContext` mock is a `vi.fn()` (`:66`), so assert the call it received carries a `providers` field identical to the boundary's triple when the resolved identity matches, and carries none when a caller-supplied `repoId` names a different repository. This is the workflow-init half of AC3 — `@adw-794` §11 proves `createRepoContext` *reuses* what it is handed; this proves workflow init *hands* it.
- Run `bunx vitest run adws/phases/__tests__/workflowInit.test.ts` — green.

### 10. Write the RED-first BDD proof

- `features/per-issue/feature-794.feature` (tags `@adw-794 @adw-ncj1hq-launch-boundary-mint`) already exists and is the authority on scenario wording — implement against it, do not reword it. Write `features/per-issue/step_definitions/feature-794.steps.ts` to cover its twelve sections (summarised in **Testing Strategy → BDD Scenarios** below) and honour its own "Testing notes for the step definitions" block.
- Drive real modules in-process — `buildLaunchBoundary`, `createRepoContext`, `resolveCronRepo`, `parseTargetRepoArgs` — over injected seams, as `feature-791.steps.ts` and `feature-700.steps.ts` do. `makeTestDeps` in `feature-660.steps.ts:80` is the deps model; `feature-565.steps.ts:265` is the model for §11's `mkdtempSync` + `execSync('git init')` fixture repo, which is how `validateGitRemote` is already driven successfully in this harness. Never assert on private state.
- Reuse, do not redefine, `the ADW codebase is checked out` (G18) and `the ADW TypeScript type-check passes` (T22) — redefining either is an `AmbiguousStepDefinition`.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-794"` — every scenario green, none pending.

### 11. Update the README

- `README.md:570` — the `launchGitContext.ts` tree line: state that the boundary mints bound providers alongside the context.
- `README.md:822` — the `repoContext.ts` tree line: mention `mintBoundProviders` as the provider-minting factory shared with the boundary.
- `README.md:135` — extend the provider-abstraction note with the boundary-minting rule if it reads as construction-site guidance.
- Remove no line that documents a still-existing file (a `-` line for a file the worktree still documents nowhere is a revert, not a dedup).

### 12. Run the Validation Commands

Execute every command in the `Validation Commands` section below and confirm each exits clean, including the merged per-issue proofs and `bun run lint:git-guard`.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, and the PRD's Testing Decisions name this slice's proof precisely: "**Launch-boundary extension** (extend existing suite): providers minted bound to the same identity as the GitContext; no path exists to divergent identities from one boundary call."

**Extended — `adws/core/__tests__/launchGitContext.test.ts`:** the new sections listed in Step 6, all over injected seams (no filesystem, no git, no network), matching the file's existing identity-in/paths-out style. §1–§7 are the behaviour-neutrality net for the `buildLaunchGitContext` → `buildLaunchBoundary` delegation and must pass **unedited**.

**Extended — `adws/providers/__tests__/repoContext.test.ts`:** the `mintBoundProviders` cases from Step 4, plus the existing `parseOwnerRepoFromUrl` cases untouched. Deliberately no `createRepoContext` unit test: it needs a real `.git` workspace with a matching remote, and `adws/**/__tests__/` is *not* in the git/gh guard's exempt directory set (`EXEMPT_DIR_NAMES` covers `features` and `test`, not `__tests__`), so a fixture-repo setup there would trip `bun run lint:git-guard`. The `providers` passthrough is proven in BDD over a fixture repo instead — `@adw-794` §11, following `feature-565.steps.ts:265`.

**Extended — `adws/phases/__tests__/workflowInit.test.ts`:** the boundary-providers passthrough assertion from Step 9, over the existing `createRepoContext` mock. Its existing cases pass unedited.

**Regression net, untouched:** `adws/triggers/__tests__/webhookRepoResolver.test.ts`, `adws/triggers/__tests__/pauseQueueScanner.test.ts`, `adws/providers/__tests__/boardManager.test.ts`.

### BDD Scenarios

`features/per-issue/feature-794.feature` (`@adw-794 @adw-ncj1hq-launch-boundary-mint`) is the behavioural proof and the build's RED-first driver. It is already written; its twelve sections are the contract this plan implements, and they are the authority on scenario wording. Coverage, mapped to the acceptance criteria:

- **§1 The boundary hands back providers at all (AC1).** One call yields a git context *and* an issue tracker *and* a code host *and* a board manager. The load-bearing RED: `buildLaunchBoundary` does not exist today.
- **§2 Every minted provider carries the context's identity (AC1, AC4).** A `Scenario Outline` over the three provider kinds, asserted through the injected `mintProviders` seam because only `CodeHost` exposes `getRepoIdentifier()`.
- **§3 The uninjected path is the one that ships (AC4).** With no provider seam installed, `boundary.providers.codeHost.getRepoIdentifier()` reports what the context names — for both the target and the self-host shape. The anti-vacuity row for §2.
- **§4 One identity read, not several (AC1).** A `getRepoInfo` seam answering `acme/webapp` then `octo/infra` forever still yields agreeing context and providers, and is consulted at most once.
- **§5 The target argument wins (AC1).** With `--target-repo`, the local remote is never read — by the context or by any provider.
- **§6 The three named consumers (AC3).** Six rows driving the real `resolveCronRepo` / `parseTargetRepoArgs` / `targetRepo ?? null` resolutions into the boundary, in both the target and self-host shape.
- **§7 Providers minted before the workspace exists (AC3).** A target repo that has not been cloned still gets its providers — the hazard Problem constraint 1 names.
- **§8 Selection stays config-driven and GitHub-defaulted (AC2).** Five rows over `.adw/providers.md` at the identity-derived workspace path: absent config yields the full GitHub set; an unimplemented code host (`bitbucket`) and an unimplemented issue tracker (`gitlab`) are refused **by name**; an unparseable value (`bananas`) is refused naming the value; two repositories in one process get their own answers. The refusal rows observe the failure when the boundary's *providers are requested*, so they hold under deferred minting and fail only for an implementation that substitutes GitHub. No positive GitLab row — `GITLAB_TOKEN` is a load-time constant (`environment.ts:124`), the same constraint that shapes Step 4.
- **§9 The context half is unchanged (regression net).** Base-path resolution for both launch shapes, plus #791's per-command credential resolution through the boundary-built context.
- **§10 The result cannot be re-pointed (AC1).** An attempted reassignment on the boundary result leaves the context's and code host's identity unchanged — the `Object.freeze` in `freezeBoundary`.
- **§11 Downstream receives, never constructs (AC3).** `createRepoContext` over a `git init` fixture repo, handed the boundary's providers, returns a context whose `issueTracker`/`codeHost` are the *same instances* (object identity) the boundary minted — and still refuses a workspace whose `origin` contradicts the declared repository. This is the home of the `providers` passthrough proof; see the unit-test note above for why it cannot live in `adws/**/__tests__/`.
- **§12 Type-check backstop (T22).** `bunx tsc` over the call sites that adopt the new result and the two that stay on the context-only view.

`@adw-791`, `@adw-700`, `@adw-664`, `@adw-660` and `@adw-565` are the merged boundary and repo-context proofs; they must stay green with zero edits.

### Edge Cases

- **Target workspace not cloned yet.** `adwMerge.main()` builds the boundary *before* `ensureTargetRepoWorkspace`. Deferred minting means the provider config is read after the clone; eager minting would silently select GitHub defaults for a GitLab-configured repo depending on clone state.
- **Malformed `.adw/providers.md`.** `parsePlatform` throws on an unknown platform string. With deferred minting the throw surfaces on first provider use — inside `workflowInit`'s existing `try`/`catch` — instead of killing the cron at module load.
- **A caller-supplied `repoId` that disagrees with the boundary.** `initializeWorkflow(options.repoId)` (used by the upgrade path) must *not* silently receive providers bound to a different repo: the `sameRepoIdentity` gate falls back to resolution from the caller's identity.
- **Self-host boundary.** `targetRepo === null` must still consult `getRepoInfo()` exactly once, and the provider config must be read from `frameworkRepoRoot`, not `process.cwd()`.
- **Providers accessed twice.** The memo must return the identical instance — a second mint would create a second board-manager instance and double any per-instance state.
- **Boundary construction failure.** An empty token or incomplete git identity still throws from `GitContext` construction *before* any provider is minted; `workflowInit`'s fallback path must still produce `gitContext === undefined` and a `RepoContext` resolved the old way.
- **Import cycles.** `adws/core/index.ts → launchGitContext.ts → providers/repoContext.ts → providers/github/githubIssueTracker.ts → github/issueApi.ts → core` closes a cycle of the same class that already exists today (`launchGitContext.ts → github/githubApi.ts → github/issueApi.ts → core`). Keep every import deep (never the `../providers` barrel) and keep the mint call inside the getter, so nothing in the cycle is *invoked* during module initialisation.
- **`buildRepoIdentifier` still has four callers.** Deleting its use in `adwMerge.tsx` must not delete the export.
- **Case-insensitive identity.** `sameRepoIdentity` lowercases; a caller passing `Acme/WebApp` against a boundary of `acme/webapp` should reuse the boundary providers, matching `validateGitRemote`'s existing case-insensitive comparison.

## Acceptance Criteria

- [ ] `buildLaunchBoundary(targetRepo, deps)` returns `{ gitContext, repoId, providers }` in which `repoId.owner/repo` equal `gitContext.owner/repo` and `providers.codeHost.getRepoIdentifier()` deep-equals `repoId`, for both the target and self-host paths.
- [ ] The boundary reads its identity source at most once per call: a `getRepoInfo` seam that answers differently on a second call cannot produce a context and providers that disagree, and is never consulted at all when `--target-repo` is present.
- [ ] Provider selection is unchanged: platforms come from `.adw/providers.md` through the existing `loadProviderConfig` and the existing `resolveIssueTracker`/`resolveCodeHost`/`resolveBoardManager` switches, defaulting to GitHub when the file is absent; the config is read from the identity-derived workspace path, never from `process.cwd()`.
- [ ] A configured platform ADW has no implementation for is refused **by name**, and an unparseable platform value is refused naming the value — never substituted with GitHub. Under deferred minting the refusal surfaces on the first provider request, which is where it surfaces today.
- [ ] The `LaunchBoundary` result is frozen: a caller cannot re-point it at another repository after it is handed over, and `boundary.providers` returns the identical triple on every access.
- [ ] `buildLaunchGitContext` returns `buildLaunchBoundary(...).gitContext` and its existing unit sections §1–§7 pass **unedited**; building a context performs no provider-config read and gains no new failure mode.
- [ ] `adws/adwMerge.tsx` derives `gitContext` and `repoId` from one boundary call and no longer calls `buildRepoIdentifier`; `buildRepoIdentifier` remains exported for its four other callers.
- [ ] `adws/triggers/trigger_cron.ts` holds a `LaunchBoundary` at module scope under the unchanged entry-script guard and exposes the minted providers; every existing `cronGitContext` use is unchanged.
- [ ] `adws/phases/workflowInit.ts` passes boundary-minted providers into `createRepoContext` when the resolved identity matches the boundary, keeps both existing `try`/`catch` fallbacks, and still cross-checks launch identity against persisted state.
- [ ] `createRepoContext` accepts optional `providers`, reuses those instances when supplied, and still runs `validateRepoIdentifier`, `validateWorkingDirectory` and `validateGitRemote` in every case; `mintBoundProviders` performs no filesystem, git or network I/O.
- [ ] `bun run test:unit` is green with nothing skipped or removed; `bunx tsc --noEmit` clean at the repo root and under `adws/tsconfig.json`; `bun run lint` clean; `bun run lint:git-guard` exits 0.
- [ ] Every `@adw-794` scenario is green with none pending, and `@adw-660`, `@adw-664`, `@adw-700`, `@adw-791`, `@adw-565` plus the `@regression` suite pass unedited.
- [ ] `README.md` describes the boundary's provider minting and `mintBoundProviders`, with no line documenting a still-existing file removed.
- [ ] No behaviour change in production: the same repositories are addressed by the same provider implementations with the same credentials as before.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — ESLint across the repository.
- `bunx tsc --noEmit` — root type check (also what `bun run test` runs).
- `bunx tsc --noEmit -p adws/tsconfig.json` — the `adws/` project type check (`.adw/commands.md` → `## Additional Type Checks`).
- `bun run build` — `tsc` build.
- `bun run test:unit` — full vitest suite; must be green with no skips.
- `bunx vitest run adws/core/__tests__/launchGitContext.test.ts adws/providers/__tests__/repoContext.test.ts` — focused run over the two extended suites.
- `bunx vitest run adws/phases/__tests__/workflowInit.test.ts adws/triggers/__tests__/webhookRepoResolver.test.ts adws/triggers/__tests__/pauseQueueScanner.test.ts adws/providers/__tests__/boardManager.test.ts` — the consumer regression net.
- `bun run lint:git-guard` — whole-repo git/gh guard; must exit 0.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-794"` — this slice's scenarios; all green, none pending.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-660 or @adw-664 or @adw-700 or @adw-791 or @adw-565"` — the merged boundary and repo-context proofs.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression scenario suite.
- `grep -rn "buildRepoIdentifier" adws/adwMerge.tsx` — must return no matches (merge's second identity derivation is gone).
- `grep -n "from '../providers'" adws/core/launchGitContext.ts` — must return no matches (deep imports only; the barrel closes an import cycle).

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` applies. This slice is guideline-shaped work: it gives the provider triple a name, separates provider resolution (pure) from workspace validation (I/O) so the side effect sits at one edge, keeps `repoContext.ts` and `launchGitContext.ts` well under the 300-line ceiling, and replaces an implicit convention ("everyone builds their own `RepoIdentifier`") with an explicit type. `freezeBoundary` is an ~8-line helper justified by named intent, exactly as the extraction rule describes.
- **No new libraries.** Nothing here needs a dependency (`.adw/commands.md` → `## Library Install Command` is `bun add <package>` if that changes).
- **The one judgment call to review** is deferred minting (Solution §3). Eager minting reads `.adw/providers.md` at boundary time — before `ensureTargetRepoWorkspace` in `adwMerge`, and before the cron has done anything — which both risks selecting GitHub defaults for a not-yet-cloned GitLab repo and turns a malformed config into a cron that will not start. Deferral costs nothing on AC1: identity is fixed at the call and captured by the closure, so the providers can only ever address the boundary's repo. If a reviewer prefers eager minting, the swap is one line in `freezeBoundary`, and the failure modes above must be re-examined.
- **Why `buildLaunchGitContext` survives.** Deleting it would touch six call sites and four merged BDD proofs for no design gain; as a one-line view over `buildLaunchBoundary` there is still exactly one construction path, which is what PRD story 6 asks for. `trigger_webhook.ts` and `promotionSweep.ts` deliberately stay on it until #796/#797 need their providers.
- **Cron's exported accessor is a deliberate handoff seam.** Cron has no provider-shaped call site today — its `listOpenIssues`/`remoteUrl` calls are `GitContext` semantics that #797 migrates. `getCronProviders()` is the receiving end AC3 asks for, made visible and testable rather than deferred; migrating cron's semantic calls in this slice would be #797's work done early and without #797's regression net.
- **Deliberately out of scope**, with their owning slices: threading the boundary's `GitContext` into provider instances so they stop calling `gitContextForRepo` internally (**#796**/**#797**); the CI rule forbidding provider construction outside the boundary allowlist (**#795**); migrating `prReviewPhase`, `upgradeGate`, `pauseQueueScanner` and `adwUpgrade.tsx:503` off ad-hoc construction (**#795**/**#796**); unifying `RepoIdentifier.platform` with the configured code host (**#796** — it gates `adwMerge`'s deps today).
- **Sequencing.** This slice is the last one that can add boundary surface cheaply: #795 makes construction sites structurally enforced, so any site not sanctioned here becomes a build failure there. Leaving `createRepoContext` exported and validating is intentional — #795 will allowlist it or force its remaining callers to migrate, and that decision belongs with the guard, not here.
