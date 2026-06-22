# Feature: GitContext boundary constructor — webhook (per-event)

## Metadata
issueNumber: `664`
adwId: `5vjxem-gitcontext-boundary`
issueJson: `{"number":664,"title":"GitContext boundary constructor: webhook (per-event)","body":"## Parent PRD\n\n`specs/prd/git-context-repo-authority.md` (see **Boundary constructors** and **Testing Decisions §3**)\n\n## What to build\n\nThe long-lived webhook server (`triggers/trigger_webhook.ts`) constructs a fresh `GitContext` **per event** from the event payload's repository, independent of any other in-flight event. Handling events for multiple repos in one process cannot cross-contaminate auth or paths — the per-event context replaces the receipt-time `ensureAppAuthForRepo` + process-global auth that bleeds across interleaved async continuations.\n\n## Acceptance criteria\n\n- [ ] A context is constructed per webhook event from the payload's repository and threaded through that event's handling\n- [ ] No reliance on process-global auth state across async continuations within the webhook server\n- [ ] Test: a context built from an event payload resolves to that repository, independent of any other in-flight event\n- [ ] Interleaved multi-repo events do not cross-contaminate auth or paths (story 2)\n\n## Blocked by\n\n- Blocked by #659\n- Blocked by #660\n\n## User stories addressed\n\n- User story 2\n- User story 12","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-21T10:20:56Z","comments":[],"actionableComment":null}`

## Feature Description

This feature builds the **per-event boundary-constructor** layer of the GitContext PRD (`specs/prd/git-context-repo-authority.md`) for the long-lived webhook server. It is the webhook sibling of the already-merged cron/standalone boundary constructor (#660): where the cron constructs **exactly one** `GitContext` at module-scope startup from its `--target-repo` launch identity, the webhook must construct a **fresh** `GitContext` **per event** from the event payload's `repository`, because a single webhook process handles interleaved events for **many** repositories concurrently.

The foundations already shipped:

- **#658** — the `GitContext` deep module (`adws/gitContext/`): base-path resolution in the constructor (`selfHost ? frameworkRepoRoot : join(targetReposDir, owner, repo)`), `worktreePathFor(branch)`, per-command `commandEnv()`, and mandatory-complete identity (no optional base path, no `cwd` fallback).
- **#660** — the boundary-constructor adapter `adws/core/launchGitContext.ts` (`buildLaunchGitContext(targetRepo, deps?)`) and the `EvaluateCandidateInput.gitContext` threading in `takeoverHandler.ts` (worktree paths resolve via the context's base path, never ambient `cwd`).

What is missing is the **webhook wiring**: the webhook still pokes process-global auth once at request receipt (`ensureAppAuthForRepo`), then does its real `gh`/spawn/takeover work in **async continuations** (`.then(...)`, `(async () => {...})()`). When a second event for a different repo arrives between receipt and continuation, it overwrites the process-global `GH_TOKEN`, so the first event's continuation authenticates against the **wrong** repository — the "Could not resolve to a Repository" bleed (vestmatic #181).

This slice introduces a small, testable per-event resolver that derives the event's repo identity from the payload and reuses `buildLaunchGitContext` to construct one **immutable** per-event `GitContext` synchronously at receipt — *before any `await`*. That context is threaded through the event's handling (into `classifyAndSpawnWorkflow` → `evaluateCandidate`, and the `issues.opened` router), so worktree/takeover path resolution becomes identity-determined per event instead of ambient-`cwd`/process-global-determined. Because each event's context is a distinct immutable object, two interleaved events for two repos cannot clobber each other's base path or token.

## User Story

As the webhook server (story 12) and as an ADW operator running one webhook process against many repositories (story 2),
I want each incoming webhook event to construct its own authoritative `GitContext` from that event's payload repository and thread it through that event's handling,
So that handling events for multiple repos in one process can never cross-contaminate auth or paths — the per-event context replaces the receipt-time `ensureAppAuthForRepo` + process-global mutation that bled across interleaved async continuations and intermittently failed `gh` calls with "could not resolve to a repository."

## Problem Statement

The webhook server is the one ADW process that is **both** long-lived **and** multi-repo **and** asynchronous — the exact combination the GitContext PRD's per-event constructor exists to fix. Today (`adws/triggers/trigger_webhook.ts`):

- **Receipt-time, lines ~107–113:** `ensureAppAuthForRepo(repoOwner, repoName)` mutates the **process-global** `GH_TOKEN` to the event's repo. This is the only auth scoping the event gets.
- **Continuation-time:** the actual work runs later, in async continuations that survive past the synchronous request handler:
  - `issue_comment`: `isAdwRunningForIssue(...).then(async () => { ... checkIssueEligibility(...); classifyAndSpawnWorkflow(...); })` (lines ~186–206).
  - `issues.opened`: `(async () => { ... routeIssueOpened(...) })()` (lines ~247–266).
  - `issues.closed` / `pull_request`: `handleIssueClosedEvent(...)`, `handlePullRequestEvent(...)` (fire-and-forget `.then/.catch`).
- **The bleed:** between an event's receipt and its continuation, a *different* repo's event can arrive and re-run `ensureAppAuthForRepo`, overwriting the process-global `GH_TOKEN`. The first event's continuation then runs `gh` against `--repo ownerX/repoX` while authenticated with repo Y's installation token → "Could not resolve to a Repository" (the documented vestmatic #181 incident). The cron is immune because it is sequential and single-repo per process; the webhook is not.
- **Paths, too:** the webhook's takeover path (`classifyAndSpawnWorkflow` → `evaluateCandidate`) is currently called **without** a `gitContext`, so `takeoverHandler` falls back to `getWorktreePath(branch)` with **no base path** → ambient `cwd` (the framework root). Yet the orchestrator the webhook spawns gets `--target-repo` and creates its worktree under `targetReposDir/owner/repo`. So the in-process takeover resolves the abandoned worktree under a **different base** than where it actually lives — the same wrong-base-repo class #660 fixed for the cron, still live on the webhook path.

The fix the PRD prescribes is structural: stop using a mutable process-global as the per-event auth/scoping carrier; construct a per-event `GitContext` (immutable, identity-baked) at receipt and thread it down.

## Solution Statement

Add a small, testable **per-event boundary resolver** and reuse the existing #660 adapter to construct one `GitContext` per webhook event, then thread it through that event's handling.

1. **New `adws/triggers/webhookRepoResolver.ts`** — the webhook analog of `cronRepoResolver.ts`. Exports `resolveWebhookRepo(payload)` which parses the raw webhook body's `repository` object into a `WebhookRepoResolution = { repoInfo: RepoInfo; targetRepo: TargetRepoInfo; targetRepoArgs: string[] }`, or `null` when the payload carries no usable repository. This consolidates the parsing currently inlined in `trigger_webhook.ts` (`extractTargetRepoArgs` + `getRepoInfoFromPayload`) into one pure, unit-testable function with no I/O.

2. **Per-event construction at receipt.** In the webhook request handler, after parsing the body and **before** any per-event branching (preserving the `ensureCronProcess`-before-branching invariant), call `resolveWebhookRepo(body)` and, when non-null, `buildLaunchGitContext(resolution.targetRepo)` (the #660 adapter, reused unchanged) to build **exactly one** immutable per-event `GitContext`. This happens synchronously, before any `await`/`.then`, so the context captures the event's `owner/repo`, base path, and auth token into an object that later continuations carry — independent of subsequent process-global mutations. Construction is wrapped defensively (a token-resolution failure logs and degrades to the legacy path rather than crashing the long-lived server).
   - The webhook always derives a **target** `TargetRepoInfo` from the payload (the discriminator is the same as #660: the payload repository is treated as a target, exactly as the webhook already does when it threads `--target-repo` args to every spawned subprocess). This makes the in-process per-event context's base path **agree** with the base path the spawned orchestrator uses — fixing the latent wrong-base on the webhook takeover path.

3. **Thread the per-event context through the event's handling.**
   - Extend `classifyAndSpawnWorkflow(...)` with a trailing optional `gitContext?: GitContext` and pass it into `evaluateCandidate({ issueNumber, repoInfo, gitContext })` (the existing `EvaluateCandidateInput.gitContext` seam from #660). When a `precomputedDecision` is supplied (the cron path) the context is not re-consulted — no cron behavior change.
   - Thread the context through `routeIssueOpened(...)` (add `gitContext` to its params and to the `IssueOpenedRouterDeps.classifyAndSpawn` adapter) and through the `issue_comment` continuation's `classifyAndSpawnWorkflow` call, and forward it from `handleIssueClosedDependencyUnblock` for consistency.
   - Replace the receipt-time standalone `ensureAppAuthForRepo` block with the single per-event construction point. `buildLaunchGitContext` still calls `ensureAppAuthForRepo` **internally** (idempotent; the transitional global assertion for not-yet-migrated `gh` calls, exactly as #660 left it), so there is **no regression** for paths that still read the global (`ensureCronProcess`, the `adwPrReview` spawn, the legacy `gh` helpers in the continuation) — but the webhook no longer has its own ad-hoc receipt-time poke, and each event now owns an immutable context.

4. **Acceptance test.** A new `adws/triggers/__tests__/webhookRepoResolver.test.ts` proves the PRD Testing Decisions §3 webhook property: a context built from an event payload's repository resolves to **that** repository (correct `basePath`/`owner`/`repo`), and two contexts built from two different payloads in the same process are mutually isolated, independent of construction/interleaving order. Isolation is proven at the **command-execution boundary** the way `feature-664.feature` §3/§4 pin it: run the context's representative `defaultBranch()` op through an injected **recording `exec`** (the `GitContextDeps.exec` seam) and assert the recorded child `env.GH_TOKEN` is the context's **own** token and the recorded `cwd` is the context's **own** `basePath` — including immunity to a **mid-flight `process.env.GH_TOKEN` overwrite** (the vestmatic #181 bleed) and to interleaved two-repo execution (neither command carries the other's token or base path). Construction composes `resolveWebhookRepo` with `buildLaunchGitContext(targetRepo, injectedDeps)`; the auth-isolation cases additionally inject the recording `exec` into the per-event `GitContext`, so there is no real `gh`/`git`/network I/O.

**Scope boundary (faithful to the PRD's slice sequencing, identical to how #660 left the cron):** this slice delivers the per-event **construction + threading + test**. It does **not** migrate the in-process legacy `gh` helpers (`checkIssueEligibility`, `isAdwRunningForIssue`, `fetchIssueCommentsRest`, `classifyIssueForTrigger`, `resolveAdwId`, etc.) to run each `gh` subcommand with the per-event context's `commandEnv()` — that **per-command auth cutover is story 7**, a later slice, and is what fully eliminates the last reliance on the process-global token. This slice establishes the per-event context as the immutable scoping/auth authority object, threads it for path resolution (closing the wrong-base class on the webhook takeover path, AC4-paths), and makes spawned subprocesses re-derive their own correct context — the structural foundation on which story 7 completes AC2.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/git-context-repo-authority.md` — the parent PRD. Read **Boundary constructors (thin adapters)** ("the webhook from the event payload's repository, constructed **per event**") and **Testing Decisions §3** (the webhook boundary test). The contract this slice implements. Stories 2 and 12.
- `specs/issue-660-adw-k2tkdn-gitcontext-boundary-sdlc_planner-gitcontext-boundary-constructor.md` — the directly analogous, already-merged sibling slice (cron + standalone). This plan mirrors its structure, its scope boundaries, and its proof-path threading; read it for the established pattern.
- `adws/triggers/trigger_webhook.ts` — **the boundary**. The receipt-time `ensureAppAuthForRepo` block (lines ~107–113), `extractTargetRepoArgs` (lines ~66–73), and the async continuations for `issue_comment` (~186–206) and `issues.opened` (~247–266). Construct the per-event context here; thread it into the spawn/takeover calls. Currently 296 lines — extracting parsing into the resolver keeps it under the 300-line guideline.
- `adws/triggers/cronRepoResolver.ts` — the pattern to mirror: a trigger-extracted, side-effect-free resolver (`resolveCronRepo`, `buildCronTargetRepoArgs`) so the logic is testable without the trigger's module-level side effects.
- `adws/core/launchGitContext.ts` — `buildLaunchGitContext(targetRepo, deps?)` (reused **unchanged**) and its injectable `LaunchGitContextDeps` (token/identity seams) used by the new test. Its internal `ensureAppAuthForRepo` is the transitional global assertion this slice relies on for not-yet-migrated `gh` calls.
- `adws/core/__tests__/launchGitContext.test.ts` — mirror its no-I/O, injected-deps (`resolveToken`/`resolveGitIdentity`/`frameworkRepoRoot`/`targetReposDir`) style for the new webhook resolver test.
- `adws/gitContext/gitContext.ts` — the `GitContext` class constructed per event: `basePath`, `worktreePathFor`, `commandEnv`, `owner`/`repo`/`selfHost`, the representative `defaultBranch()` read op (runs through the single `#run` chokepoint with `cwd === basePath` and `env === commandEnv(process.env)`, which re-overrides `GH_TOKEN` with the context's own token), and the injectable `GitContextDeps.exec` seam (#658/#659) that the acceptance test's recording runner injects to capture each command's `(cwd, env)` hermetically. Not modified this slice.
- `adws/gitContext/__tests__/gitContext.test.ts` — the existing two-context-isolation assertions (distinct `basePath`, distinct `commandEnv().GH_TOKEN`) the webhook test reuses at the boundary level. Must stay green; `gitContext/` source is unchanged.
- `adws/triggers/webhookGatekeeper.ts` — `classifyAndSpawnWorkflow(...)` (add the trailing `gitContext?` param → `evaluateCandidate`) and `handleIssueClosedDependencyUnblock(...)` (forward the context). The `precomputedDecision` path (cron) must be untouched.
- `adws/triggers/takeoverHandler.ts` — `EvaluateCandidateInput.gitContext` already exists (#660); `resolveWorktreePath` already prefers `input.gitContext.worktreePathFor(branch)`. No change needed here — the webhook just starts **supplying** the context. Read to confirm the seam.
- `adws/triggers/issueOpenedRouter.ts` — `routeIssueOpened(params, deps)` and `IssueOpenedRouterDeps.classifyAndSpawn`. Add `gitContext` to `params` and forward it through the `classifyAndSpawn` adapter to `classifyAndSpawnWorkflow`.
- `adws/github/githubApi.ts` — `getRepoInfoFromPayload(fullName)` and `RepoInfo`; the resolver reuses `getRepoInfoFromPayload`.
- `adws/types/issueTypes.ts` — `TargetRepoInfo` (`{ owner, repo, cloneUrl, workspacePath? }`) and `PullRequestWebhookPayload`; the resolver returns a `TargetRepoInfo`.
- `adws/triggers/webhookHandlers.ts` — `handleIssueClosedEvent` (closed path). Verify whether it forwards to `handleIssueClosedDependencyUnblock`/`classifyAndSpawnWorkflow` and forward the per-event context for consistency. (Read during implementation; the comment + opened paths are the primary proof.)
- `adws/core/index.ts` / `adws/triggers/index.ts` (if present) — barrels; export `resolveWebhookRepo` near the existing trigger-resolver exports if the trigger index re-exports siblings like `cronRepoResolver`.

### Conditional docs (matched on this task's files)

- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — **the #660 boundary-constructor doc**. Matched conditions: "When working with `buildLaunchGitContext` …", "When `EvaluateCandidateInput.gitContext` … are relevant in `takeoverHandler.ts`", "When wiring `gitContext.basePath` into worktree creation". Read for the construction contract and the path-threading invariants this slice extends to the webhook.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — the #658 foundation doc (the `GitContext` construction contract, `worktreePathFor`/`commandEnv`/two-context isolation, and the note that call-site migration is sliced). Read for the isolation property the webhook test asserts.
- `app_docs/feature-0cv18u-fix-cross-trigger-spawn-dedup.md` — matched: "When working with `classifyAndSpawnWorkflow` in `webhookGatekeeper.ts` or the cron/webhook trigger paths". The signature change to `classifyAndSpawnWorkflow` must preserve the cross-trigger spawn-dedup contract.
- `app_docs/feature-tcewff-cron-gh-token-bleed-fix.md` — matched: the `GH_TOKEN`-bleed class, `ensureAppAuthForRepo`/`activateGitHubAppAuth`. The webhook is the concurrency-bleed counterpart of this cron fix; read for the auth-identity-vs-async-continuation reasoning.
- `app_docs/feature-n96c4j-webhook-ensure-cron-on-every-event.md` — matched: "When modifying the top-level request body handler in `trigger_webhook.ts` (the `ensureCronProcess` call site is now before all per-event branching)". The per-event construction must **preserve** `ensureCronProcess` placement before branching.
- `app_docs/feature-wqzfqj-ensure-cron-before-webhook-gates.md` — matched: `ensureCronProcess` placement / gate ordering in `trigger_webhook.ts`. Same invariant to preserve.
- `app_docs/feature-ie8l08-fix-pr-review-target-repo.md` — the canonical "wrong repository" worktree-base class; the shape this slice eliminates on the webhook takeover path.

### New Files

- `adws/triggers/webhookRepoResolver.ts` — the per-event boundary resolver. Exports `resolveWebhookRepo(payload: Record<string, unknown>): WebhookRepoResolution | null` and the `WebhookRepoResolution` interface (`{ repoInfo: RepoInfo; targetRepo: TargetRepoInfo; targetRepoArgs: string[] }`). Pure payload parsing (no I/O); imports `getRepoInfoFromPayload`/`RepoInfo` from `../github/githubApi` and `TargetRepoInfo` from `../types/issueTypes`. Kept well under the 300-line guideline.
- `adws/triggers/__tests__/webhookRepoResolver.test.ts` — the acceptance-criterion test (PRD Testing Decisions §3, webhook). Mirrors the no-I/O, injected-deps style of `launchGitContext.test.ts`/`gitContext.test.ts`.

## Implementation Plan

### Phase 1: Foundation

Create the per-event resolver (`webhookRepoResolver.ts`) — a pure, side-effect-free function that maps a raw webhook body to `{ repoInfo, targetRepo, targetRepoArgs } | null`. Unit-test it in isolation. This is the testable seam that makes the per-event boundary assertable without starting the HTTP server (which the existing `triggerWebhook.test.ts` cannot import, hence its source-string assertions).

### Phase 2: Core Implementation (per-event construction + threading)

Wire the webhook request handler to construct exactly one immutable per-event `GitContext` (via the reused `buildLaunchGitContext`) synchronously at receipt, replacing the standalone `ensureAppAuthForRepo` block, and thread it through `classifyAndSpawnWorkflow` → `evaluateCandidate` and `routeIssueOpened`. This is the acceptance-criteria proof path (stories 2, 12): each event's continuation carries its own context; takeover worktree resolution becomes identity-determined per event.

### Phase 3: Integration

Forward the context through the remaining spawn-bearing continuation (`handleIssueClosedDependencyUnblock`, and the closed-event handler if applicable), confirm the cron `precomputedDecision` path is untouched, and run the full validation suite (lint, both type-checks, unit tests, build) to prove zero regressions.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1 — Create the per-event resolver (`adws/triggers/webhookRepoResolver.ts`)

- Create the file with a module JSDoc explaining it is the webhook analog of `cronRepoResolver.ts`: a side-effect-free resolver extracted so the per-event boundary is testable without the webhook server's module-level side effects.
- Define `export interface WebhookRepoResolution { repoInfo: RepoInfo; targetRepo: TargetRepoInfo; targetRepoArgs: string[]; }`.
- Implement `export function resolveWebhookRepo(body: Record<string, unknown>): WebhookRepoResolution | null`:
  - Read `const repository = body.repository as Record<string, unknown> | undefined;` — guard-clause `return null` if absent.
  - Derive `fullName = repository.full_name as string | undefined` and `cloneUrl = (repository.clone_url ?? repository.html_url) as string | undefined` (mirror the existing `extractTargetRepoArgs` precedence). Guard-clause `return null` if either is missing.
  - `const repoInfo = getRepoInfoFromPayload(fullName);` (reuse the existing helper; it validates `owner/repo`).
  - `const targetRepo: TargetRepoInfo = { owner: repoInfo.owner, repo: repoInfo.repo, cloneUrl };`.
  - `const targetRepoArgs = ['--target-repo', fullName, '--clone-url', cloneUrl];` (byte-identical to today's `extractTargetRepoArgs` output so downstream spawn behavior is unchanged).
  - Return `{ repoInfo, targetRepo, targetRepoArgs }`.
- Keep it pure (no `gh`/`git`/env access); guard clauses, ≤2 nesting, no `any` beyond the unavoidable raw-payload `Record<string, unknown>` casts (which match the existing `trigger_webhook.ts` style).

### Task 2 — Unit-test the resolver + per-event context (`adws/triggers/__tests__/webhookRepoResolver.test.ts`)

- Mirror `launchGitContext.test.ts`: a `baseDeps()` helper supplying `LaunchGitContextDeps` with fake `resolveToken`/`resolveGitIdentity` and injected `frameworkRepoRoot`/`targetReposDir`; no real I/O.
- A `makePayload(owner, repo, { token? })` helper that builds a minimal raw webhook body `{ repository: { full_name: 'owner/repo', name: repo, owner: { login: owner }, clone_url: 'https://github.com/owner/repo.git' } }`.
- A `recordingExec()` helper returning an `ExecFn` spy that records each `(command, { cwd, env })` it is handed and returns canned success output — the `GitContextDeps.exec` seam, so `defaultBranch()` runs hermetically (no real `gh`/`git`/network). Because `buildLaunchGitContext` does not currently forward an `exec` seam to the constructor, the auth-isolation cases inject the recording `exec` into the per-event `GitContext` directly — composing the resolver's identity (`resolution.targetRepo`) + resolved token into `new GitContext({ owner, repo, selfHost: false, token, gitIdentity, frameworkRepoRoot, targetReposDir }, { exec: recordingExec() })`. (Equivalently, forward an optional `exec?` through `LaunchGitContextDeps`; pin the recorded `(cwd, env)`, not the seam shape — consistent with the scenario's "pin the decision, not the shape" stance.)
- Cases (the PRD §3 webhook property — mirroring `feature-664.feature` §1–§5):
  - **Resolver parsing:** `resolveWebhookRepo(payload)` yields `repoInfo === { owner, repo }`, `targetRepo.cloneUrl` from `clone_url`, and `targetRepoArgs === ['--target-repo', 'owner/repo', '--clone-url', '…']`.
  - **Resolves to that repository (§1):** `buildLaunchGitContext(resolveWebhookRepo(payload)!.targetRepo, baseDeps())` ⇒ `ctx.basePath === join(targetReposDir, owner, repo)`, `ctx.owner/ctx.repo` from the payload, `ctx.selfHost === false`.
  - **Per-event independence (§2):** build context A, then construct a second context B from a different-repo payload; assert A's `owner`/`repo`/`basePath` are unchanged by B's construction, and that the result is identical regardless of construction order (build A-then-B vs B-then-A → same per-context values).
  - **Per-event command auth + cwd (§3a):** run `ctx.defaultBranch()` through an injected `recordingExec()`; assert the recorded `env.GH_TOKEN` equals the payload's token and the recorded `cwd === ctx.basePath`.
  - **Mid-flight global-overwrite immunity (§3b):** construct `ctx` for repo X (token `token-acme`); set `process.env.GH_TOKEN = 'token-octo'` (a later in-flight event clobbering the global; restore in `afterEach`); run `ctx.defaultBranch()`; assert the recorded `env.GH_TOKEN === 'token-acme'` and that no recorded env value equals `'token-octo'` — the vestmatic #181 bleed is invisible to the per-event command (`commandEnv` re-overrides `GH_TOKEN` with the context's own token).
  - **Interleaved two-repo isolation (§4):** two contexts for two repos (tokens `token-alpha`/`token-beta`), each with its own `recordingExec()`; run both `defaultBranch()` ops interleaved; assert each recorded command carries its own token + its own `basePath` cwd, and neither recorded env carries the other's token.
  - **`worktreePathFor` (§5):** for a payload-derived context resolves under `join(targetReposDir, owner, repo, '.worktrees', branch)`, `cwd`-independent (`process.chdir(os.tmpdir())` between two calls returns the same path).
  - **No-repository payload:** `resolveWebhookRepo({})` and `resolveWebhookRepo({ repository: {} })` return `null`.
  - **Incomplete identity propagation:** an empty resolved token surfaces the `GitContext` construction error (`buildLaunchGitContext(targetRepo, baseDeps({ resolveToken: () => '' }))` throws `/GitContext/`).

### Task 3 — Construct the per-event context in the webhook handler (`adws/triggers/trigger_webhook.ts`)

- Add imports: `buildLaunchGitContext` from `../core`, `type GitContext` from `../gitContext`, and `resolveWebhookRepo` from `./webhookRepoResolver`. Remove the now-unused `getRepoInfoFromPayload`, `ensureAppAuthForRepo`, and `extractTargetRepoArgs` imports/local helper if no longer referenced (code hygiene).
- Replace the receipt-time block (lines ~107–118: the standalone `ensureAppAuthForRepo` poke, the `webhookRepoFullName`/`webhookRepoInfo` derivation, `extractTargetRepoArgs`, and `ensureCronProcess`) with:
  - `const resolution = resolveWebhookRepo(body);`
  - `const webhookRepoInfo = resolution?.repoInfo;`
  - `const webhookTargetRepoArgs = resolution?.targetRepoArgs ?? [];`
  - Construct exactly one immutable per-event context, defensively:
    ```ts
    let eventGitContext: GitContext | undefined;
    if (resolution) {
      try {
        // Per-event boundary constructor. buildLaunchGitContext also asserts
        // process-global app auth internally (transitional, for not-yet-migrated
        // gh calls — story 7), so there is no regression for legacy paths.
        eventGitContext = buildLaunchGitContext(resolution.targetRepo);
      } catch (err) {
        log(`Per-event GitContext construction failed for ${resolution.repoInfo.owner}/${resolution.repoInfo.repo}: ${err}`, 'warn');
      }
      ensureCronProcess(resolution.repoInfo, webhookTargetRepoArgs);
    }
    ```
  - **Preserve** the `ensureCronProcess`-before-per-event-branching invariant (`feature-n96c4j` / `feature-wqzfqj`): this construction + `ensureCronProcess` stays above all event-type branches.
- This construction is synchronous (before any `await`/`.then`), so the context captures owner/repo, base path, and token immutably for this event.

### Task 4 — Add the `gitContext` parameter to `classifyAndSpawnWorkflow` (`adws/triggers/webhookGatekeeper.ts`)

- Add a trailing optional parameter `gitContext?: GitContext` to `classifyAndSpawnWorkflow(issueNumber, repoInfo, targetRepoArgs, existingAdwId?, precomputedDecision?, labelRouting?, gitContext?)`. Import `type GitContext` from `../gitContext`.
- At the single `evaluateCandidate` call site inside the function, pass it through:
  `const decision = precomputedDecision ?? evaluateCandidate({ issueNumber, repoInfo: resolvedRepoInfo, gitContext });`
- Do **not** change anything on the `precomputedDecision` branch — when the cron supplies a precomputed decision it already threaded its own `cronGitContext` into its own `evaluateCandidate` call, so cron behavior is byte-identical. The new param is consumed only when the webhook calls without a precomputed decision.
- In `handleIssueClosedDependencyUnblock(closedIssueNumber, repoInfo, targetRepoArgs, gitContext?)`, add the trailing optional `gitContext?` and forward it to the internal `classifyAndSpawnWorkflow(dependent.number, repoInfo, targetRepoArgs, undefined, undefined, undefined, gitContext)` call.

### Task 5 — Thread the context through the `issues.opened` router (`adws/triggers/issueOpenedRouter.ts`)

- Add `gitContext?: GitContext` to the `routeIssueOpened` `params` object (import `type GitContext` from `../gitContext`).
- Extend `IssueOpenedRouterDeps.classifyAndSpawn` signature with a trailing `gitContext?: GitContext`, and update `buildDefaultIssueOpenedRouterDeps` so the adapter forwards it: `classifyAndSpawn: (n, r, a, lr, gc) => classifyAndSpawnWorkflow(n, r, a, undefined, undefined, lr, gc)`.
- At both `deps.classifyAndSpawn(...)` call sites inside `routeIssueOpened` (the `classified` and `infer` branches), pass `params.gitContext` as the trailing arg.

### Task 6 — Thread the per-event context into the webhook continuations (`adws/triggers/trigger_webhook.ts`)

- **`issue_comment` path:** in the `.then(async (running) => { ... })` continuation, pass the captured `eventGitContext` to the spawn call: `await classifyAndSpawnWorkflow(issueNumber, webhookRepoInfo, webhookTargetRepoArgs, undefined, undefined, undefined, eventGitContext);`. (`eventGitContext` is captured by the closure, so it is the *first* event's context even if a later event has since mutated the global.)
- **`issues.opened` path:** pass it into the router call: `routeIssueOpened({ issueNumber, issueBody, issueTitle, labelNames, repoInfo: webhookRepoInfo ?? { owner: '', repo: '' }, targetRepoArgs: webhookTargetRepoArgs, gitContext: eventGitContext })`.
- **`issues.closed` path:** if `handleIssueClosedEvent` (in `webhookHandlers.ts`) ultimately calls `handleIssueClosedDependencyUnblock`/`classifyAndSpawnWorkflow`, forward `eventGitContext` so the dependency-unblock spawn also resolves takeover paths per event. (Read `webhookHandlers.ts` first; if threading requires a signature change there, make the minimal consistent change. The comment + opened paths remain the primary proof and must not be blocked on this.)
- Leave the `pull_request_review` / `pull_request_review_comment` / `pull_request` paths unchanged: they `spawnDetached` with `webhookTargetRepoArgs` and the spawned child re-derives its own context from those args (its own launch identity) — no in-process takeover, so no context needed.

### Task 7 — Confirm no regression to the existing `triggerWebhook.test.ts` source assertions

- The existing `adws/__tests__/triggerWebhook.test.ts` asserts on `trigger_webhook.ts` **source text** (catch-block contents, no `labeled` handler). Re-read those assertions and ensure the edits in Tasks 3/6 keep them true (the `issues.opened` catch block must still not contain `spawnDetached`/`adwPlanBuildTest.tsx` and must still `log(..., 'error')`; the `issue_comment` `.catch` must still `log(..., 'error')`). Adjust the edits, not the test, if any assertion would break.

### Task 8 — Type-check, lint, and full unit-test pass

- Run the validation commands below; fix any regressions until everything passes with zero failures. Pay attention to `bunx tsc --noEmit -p adws/tsconfig.json` catching the threaded-signature changes across `webhookGatekeeper.ts`, `issueOpenedRouter.ts`, and `trigger_webhook.ts`.

### Task 9 — Run the Validation Commands

- Execute every command in the `Validation Commands` section and confirm zero errors and zero test regressions.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, and the PRD's Testing Decisions §3 explicitly calls for the webhook boundary-constructor test. Tests assert **external, observable behaviour** (resolved base path, worktree path, env/token injection, isolation) — never internal call structure.

- **`webhookRepoResolver.test.ts` (new, the acceptance-criterion test — mirrors `feature-664.feature` §1–§5):**
  - `resolveWebhookRepo(payload)` parses `repoInfo`/`targetRepo`/`targetRepoArgs` correctly; `null` for a payload without a usable repository.
  - **(§1)** A context built from an event payload (`buildLaunchGitContext(targetRepo, injectedDeps)`) resolves `basePath` to `join(targetReposDir, owner, repo)`, `owner`/`repo` from the payload, `selfHost === false`.
  - **(§2)** Constructing a second event's context does not mutate the first: the first context's `owner`/`repo`/`basePath` are unchanged after the second construction, independent of build order ("independent of any other in-flight event").
  - **(§3a)** Running the context's representative `defaultBranch()` op through an injected recording `exec` records a child `env.GH_TOKEN` equal to the context's own token and a `cwd` equal to the context's own `basePath`.
  - **(§3b)** After a mid-flight `process.env.GH_TOKEN` overwrite (a later in-flight event clobbering the global), the recorded `env.GH_TOKEN` of the first context's command is *still* its own token and never the overwriting token — the vestmatic #181 bleed is foreclosed at the command boundary.
  - **(§4)** Two contexts for two repos, exercised interleaved with per-context recording `exec`s, each record their own token + own `basePath` cwd; neither recorded env carries the other's token (no cross-contamination of auth or paths).
  - **(§5)** `worktreePathFor(branch)` resolves under the payload-derived base, `cwd`-independent.
  - Empty resolved token surfaces the `GitContext` construction error (story 23 propagation).
  - All I/O behind injected seams — the recording `exec` (`GitContextDeps.exec`) and the `LaunchGitContextDeps` token/identity stubs (no network, no real `gh`/`git`).
- **`launchGitContext.test.ts` (existing):** must remain green — `launchGitContext.ts` is reused unchanged.
- **`gitContext.test.ts` (existing):** must remain green — `gitContext/` source is unchanged this slice.
- **`triggerWebhook.test.ts` (existing):** must remain green — the source-text catch-block / no-`labeled` assertions still hold after the handler edits (Task 7).
- **`cronRepoResolver` / `takeoverHandler` tests (existing):** must remain green — the cron path threads its own context via `precomputedDecision`, unchanged.

### Edge Cases

- **Interleaved multi-repo events** — event A (repo X) and event B (repo Y) construct distinct immutable contexts; A's continuation uses A's context (token X, base X) even after B mutated the process-global. Proven at the command boundary by running each context's representative `defaultBranch()` op through an injected recording `exec` and asserting the recorded child `env.GH_TOKEN` is the context's **own** token and the recorded `cwd` is the context's **own** `basePath` — surviving a mid-flight `process.env.GH_TOKEN` overwrite and interleaved two-repo execution (`feature-664.feature` §3/§4).
- **Payload missing `repository`** (or missing `full_name`/`clone_url`) — `resolveWebhookRepo` returns `null`; the handler skips context construction and degrades to the legacy path without crashing.
- **Per-event token-resolution failure** — `buildLaunchGitContext` throwing is caught, logged at `warn`, and the event proceeds with `eventGitContext === undefined` (legacy behavior). The long-lived server never crashes on one malformed event.
- **Self-host repo arriving via the webhook** — treated as a target context (basePath under `targetReposDir/owner/repo`), matching the `--target-repo` args the webhook already threads to every spawned subprocess. This intentionally aligns the in-process takeover base with the subprocess worktree base (fixing the latent wrong-base on the webhook takeover path); it is the same "presence-of-target ⇒ target" discriminator #660 documented.
- **Cron path unaffected** — `classifyAndSpawnWorkflow` called with a `precomputedDecision` ignores the new `gitContext` param; the cron continues to thread `cronGitContext` through its own `evaluateCandidate` call.
- **`ensureCronProcess` ordering** — the per-event construction sits before all per-event branching, preserving the `feature-n96c4j`/`feature-wqzfqj` invariant.
- **`pull_request*` spawn paths** — unchanged; the spawned child builds its own context from `--target-repo` args.

## Acceptance Criteria

- A fresh `GitContext` is constructed **per webhook event** from the payload's `repository` (via `resolveWebhookRepo` + `buildLaunchGitContext`), synchronously at receipt, and threaded through that event's handling into `classifyAndSpawnWorkflow` → `evaluateCandidate` and `routeIssueOpened` (AC1, story 12).
- The webhook's standalone receipt-time `ensureAppAuthForRepo` poke is gone; each event's auth/scoping authority is its own immutable per-event context (the transitional global assertion now lives only inside `buildLaunchGitContext`, for not-yet-migrated `gh` calls). Spawned orchestrators re-derive their own context from `--target-repo` args. This removes the webhook's *own* reliance on mutable process-global auth for per-event scoping; the remaining per-command application to in-process legacy `gh` helpers is story 7 (AC2 — structurally founded here, completed by the per-command cutover).
- Interleaved multi-repo events do not cross-contaminate **paths**: takeover worktree resolution on the webhook path is now identity-determined via the per-event context's base path (the ambient-`cwd` `getWorktreePath` default is no longer reached on this path). **Auth** isolation is established at the per-event-context level (distinct immutable token per event) (AC4, story 2).
- **Test:** a context built from an event payload resolves to that repository (`basePath`/`owner`/`repo`), and two contexts from two different payloads are mutually isolated independent of order — proven at the command boundary by capturing each context's `defaultBranch()` op through a recording `exec` (recorded `env.GH_TOKEN` = own token, recorded `cwd` = own `basePath`), including immunity to a mid-flight `process.env.GH_TOKEN` overwrite and to interleaved two-repo execution — `adws/triggers/__tests__/webhookRepoResolver.test.ts`, mirroring `feature-664.feature` §1–§5 (AC3/AC4, PRD §3).
- The cron `precomputedDecision` path is unchanged; all existing unit tests (`launchGitContext`, `gitContext`, `triggerWebhook`, `cronRepoResolver`, `takeoverHandler`) pass; lint, both type-checks, and build are clean.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Run from the repo root.

- `bun run lint` — ESLint clean (code hygiene: no unused imports/vars, including the removed `extractTargetRepoArgs`/`ensureAppAuthForRepo`/`getRepoInfoFromPayload` imports in `trigger_webhook.ts`).
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type-check passes (catches the threaded `gitContext` signature changes across `trigger_webhook.ts`, `webhookGatekeeper.ts`, `issueOpenedRouter.ts`).
- `bun run test:unit` — full unit suite passes with zero regressions, including the new `adws/triggers/__tests__/webhookRepoResolver.test.ts`.
- `bun run build` — build succeeds with no errors.
- Targeted runs while iterating (optional): `bunx vitest run adws/triggers/__tests__/webhookRepoResolver.test.ts adws/__tests__/triggerWebhook.test.ts adws/core/__tests__/launchGitContext.test.ts adws/triggers/__tests__/takeoverHandler.test.ts adws/gitContext/__tests__/gitContext.test.ts`.

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`): keep `resolveWebhookRepo` pure (payload-in, identity-out; no `gh`/`git`/env side effects) and isolate the side-effectful construction (`buildLaunchGitContext`, `ensureCronProcess`) at the webhook handler boundary; guard clauses + ≤2 nesting; no `any` beyond the unavoidable raw-payload casts already idiomatic in `trigger_webhook.ts`; JSDoc the new public function/interface; keep `trigger_webhook.ts` under the 300-line ceiling (extracting parsing into the resolver helps — it is currently 296 lines).
- **Reuse over reinvention:** this slice adds **no** new context-construction logic — it reuses #660's `buildLaunchGitContext` verbatim and only adds (a) the per-event payload resolver and (b) the per-event call site + threading. The per-event-vs-once-at-startup difference is entirely in *where/when* the existing adapter is called.
- **Why a separate resolver module (not inline in the handler):** mirrors `cronRepoResolver.ts`. The webhook server starts an HTTP listener on import, so `trigger_webhook.ts` cannot be imported by a unit test (hence the existing `triggerWebhook.test.ts` only does source-string assertions). Extracting `resolveWebhookRepo` gives the per-event boundary a directly importable, I/O-free seam — the only way to write the PRD §3 webhook test as a real behavioral assertion rather than a source grep.
- **Scope boundaries (explicitly deferred to later PRD slices, identical to how #660 left the cron):**
  - *Per-command auth cutover* (story 7) — migrating the in-process legacy `gh` helpers reachable from the webhook continuations (`checkIssueEligibility`, `isAdwRunningForIssue`, `fetchIssueCommentsRest`, `classifyIssueForTrigger`, `issueHasLabel`, `applyLabel`, and `resolveAdwId` inside `evaluateCandidate`) to run each `gh` subcommand with the per-event context's `commandEnv()`. This is what *fully* eliminates the last reliance on the process-global `GH_TOKEN` for those calls and completes AC2 end-to-end. Until then those calls scope the repo correctly via `--repo owner/repo` flags and rely on the transitional global assertion inside `buildLaunchGitContext`.
  - *Identity persistence + cross-check* (stories 13/14), *CI/lint guard banning raw `git`/`gh`* (story 8), and the *full worktree/branch/issue/PR method surface on the context* (stories 16/17/18) — all later slices.
- **No new dependencies.** Library install command (`.adw/commands.md`): `bun add <package>`. This feature composes existing modules only.
- **Cron parity check:** after this slice, both long-lived triggers construct a `GitContext` at their launch boundary — cron once at module scope (#660), webhook once per event (#664) — and thread it into the shared `evaluateCandidate` takeover decision. The asymmetry (per-event vs once) is the whole point: the webhook is the multi-repo, async, long-lived process the per-event constructor exists for.
