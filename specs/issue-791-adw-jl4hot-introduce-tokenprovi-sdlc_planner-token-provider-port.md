# Feature: Credentials reach every command through a TokenProvider port

## Metadata
issueNumber: `791`
adwId: `jl4hot-introduce-tokenprovi`
issueJson: `{"number":791,"title":"Introduce TokenProvider port resolved per command","body":"## Parent PRD\n\nspecs/prd/gitcontext-forge-agnostic-refactor.md\n\n## What to build\n\nA TokenProvider port consumed by the GitContext core: credentials are resolved per command through the port, never cached at construction and never read from the environment by the core. The existing token resolution (PAT vs installation token order, GitHub App expiry handling) is wrapped as the port's GitHub implementation. The `usePat` distinction leaves the executor — the provider implementation decides which credential a command gets.\n\nSee PRD sections: Implementation Decisions (TokenProvider port), Testing Decisions (TokenProvider port).\n\n## Acceptance criteria\n\n- [ ] Core resolves credentials via the port on every command; no construction-time token caching\n- [ ] Core contains no environment reads for credentials\n- [ ] PAT-vs-token selection moved out of the executor signature and into the GitHub provider implementation\n- [ ] Board operations still receive the PAT; ordinary operations still receive the resolved token (behavior unchanged)\n- [ ] Tests cover per-call resolution (no caching) and resolution order\n\n## Blocked by\n#790 <!-- adw:region-overlap -->\n\n- Blocked by #790\n\n## Touched Files\n\n- adws/gitContext/gitContext.ts\n- adws/gitContext/types.ts\n- adws/gitContext/tokenResolver.ts\n- adws/gitContext/__tests__/tokenResolver.test.ts\n- adws/gitContext/__tests__/gitContext.test.ts\n\n## User stories addressed\n\n- User story 12\n- User story 13","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-08-14T12:18:27Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-08-14T13:11:11Z","body":"⏸️ **Deferred behind #790 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #790, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #790 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/gitcontext/gitcontext.ts`\n- `adws/gitcontext/types.ts`\n- `adws/gitcontext/__tests__/gitcontext.test.ts`\n\nThis issue will spawn automatically once #790 merges and closes. To override, remove the `#790 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Feature Description

The GitContext core stops holding a credential and starts *asking* for one. A new **TokenProvider port** — `credentialEnv({ owner, repo, purpose })` — is consumed by the core on every single command; its GitHub implementation owns the resolution order (App installation token → PAT → `gh auth token`) and owns the PAT-versus-installation-token decision that today travels as a `usePat` boolean through the core's private classifiers.

Two things change materially:

1. **Freshness.** Today `buildLaunchGitContext` resolves a token once, at construction, and the resulting GitHub App installation token — valid for one hour — is handed to every command for the rest of the process's life. ADW's long-lived processes (`trigger_cron`, `trigger_webhook`) outlive that hour. After this slice the credential is resolved at the moment each command runs, so `appAuth.ts`'s expiry-aware refresh (`REFRESH_BUFFER_MS`, `adws/gitContext/appAuth.ts:40`) actually gets a chance to fire.
2. **Forge-neutrality.** The word "PAT" leaves the core. `#run`/`#runRepoApi` declare a forge-neutral **purpose** (`'default'` or `'alternateIdentity'`); the GitHub provider decides that `alternateIdentity` means "the PAT, because GitHub forbids bot self-approval and app tokens lack Projects V2 access on user-owned repos". That is the seam #792's forge adapter plugs into.

This is slice 2 of the GitContext forge-agnostic refactor (`specs/prd/gitcontext-forge-agnostic-refactor.md`, user stories 12 and 13). It builds directly on #790, which promoted the spawn chokepoint to the public `exec(command, { cwd, env, input? })` executor. `exec`'s `env` parameter is exactly the hole this slice plugs: after #790 the executor *carries* a credential environment; after #791 something *produces* it, per command, through a named port.

## User Story

As the GitContext core
I want to resolve credentials through a TokenProvider port on every command
So that expiring GitHub App installation tokens are never served stale from a construction-time cache, and forge-specific auth policy lives with the forge that requires it

## Problem Statement

Three coupled defects, all in `adws/gitContext/gitContext.ts`:

- **The token is a construction-time snapshot.** `GitContextOptions.token` (`types.ts:110`) is a resolved string, captured into `#token` (`gitContext.ts:139`) and replayed by `commandEnv` (`:161`) for the life of the object. `buildLaunchGitContext` (`adws/core/launchGitContext.ts:94`) calls `resolveLaunchToken(owner, repo)` once. An installation token minted at cron startup is still being handed to `git push` four hours later. `appAuth.ts` already knows how to refresh; nothing ever asks it to.
- **The core makes a GitHub auth decision.** `commandEnv(base, usePat)` (`:158-167`) computes `(usePat && this.#pat) ? this.#pat : this.#token`. That ternary is GitHub policy — Personal Access Token versus App installation token — sitting in what the PRD wants to be a forge-neutral, extractable core. `usePat` threads through both private classifiers (`:228`, `:248`) to seven internal call sites (`:622`, `:658`, `:663`, `:675`, `:682`, `:692`, `:701`). #790 kept it out of `exec`'s public signature and documented it as "private and temporary — leaves in the TokenProvider slice (#791)". This is that slice.
- **The core names a GitHub environment variable.** `GH_TOKEN` is written by the core (`:161`), so the core cannot be published as a forge-neutral library without shipping GitHub vocabulary.

The consequence chain is not hypothetical: PRD story 12 exists because a stale credential in a long-lived orchestrator fails at an arbitrary later moment with a `gh` authentication error that carries no hint of its cause.

## Solution Statement

### 1. The port

Forge-neutral, defined in the core's `types.ts` next to `ExecFn`/`ExecOptions`:

```ts
export type CredentialPurpose = 'default' | 'alternateIdentity';

export interface CredentialRequest {
  readonly owner: string;
  readonly repo: string;
  readonly purpose: CredentialPurpose;
}

export interface TokenProvider {
  /** Returns the credential environment overlay for ONE command. Called per command; never memoised by the core. */
  credentialEnv(request: CredentialRequest): NodeJS.ProcessEnv;
}
```

Two deliberate shape decisions:

- **The port returns an environment overlay, not a token string.** If it returned a string the core would still have to write `GH_TOKEN` — GitHub vocabulary in a forge-neutral core. Returning the overlay puts the variable *name* on the provider's side of the line, which is what PRD story 1 requires. It also composes exactly with `ExecOptions.env` from #790.
- **The core declares a *purpose*, never a credential kind.** `'alternateIdentity'` says "the primary automation identity cannot perform this operation" — true of both PAT sites (GitHub forbids bot self-approval; app tokens lack Projects V2 access on user-owned repos) and expressible on any forge. `'default'` is everything else. The core never learns that the answer is a PAT.

### 2. The GitHub implementation

`createGitHubTokenProvider(input): TokenProvider` in a new `adws/gitContext/githubTokenProvider.ts`. It wraps — does not replace — the existing `resolveContextToken` (`tokenResolver.ts:46`), which stays byte-identical along with its test suite:

```ts
credentialEnv({ owner, repo, purpose }) {
  if (purpose === 'alternateIdentity' && input.alternateIdentityPat?.trim()) {
    return { GH_TOKEN: input.alternateIdentityPat };
  }
  return { GH_TOKEN: resolveContextToken({ owner, repo, pat: input.pat, isAppConfigured, mintInstallationToken, ghAuthToken }) };
}
```

**Why two PAT fields.** They are two different roles GITHUB_PAT plays today, and conflating them would be a behaviour change:

| Role | Field | Who supplies it today |
|---|---|---|
| A candidate in the resolution order, after the App mint | `pat` | *every* factory — `resolveToken`/`resolveLaunchToken` always pass `GITHUB_PAT` into `resolveContextToken` |
| The credential served to `alternateIdentity` operations | `alternateIdentityPat` | **only** `gitContextForRepo` (`gitContextFactory.ts:119` sets `GitContextOptions.pat`); `gitContextForSync` and `buildLaunchGitContext` do not |

So a launch-boundary context's `approvePR` falls back to the resolved token today, and must keep doing so. Modelling one field would silently promote or demote one of those paths.

### 3. What the core keeps and what it drops

`#token` and `#pat` are deleted. One field replaces them: `#credentials: TokenProvider`. `commandEnv(base = {}, purpose: CredentialPurpose = 'default')` calls `this.#credentials.credentialEnv(...)` on every invocation and merges the result over `base` plus the four `GIT_*` identity variables. `#run`/`#runRepoApi` swap `usePat?: boolean` for `purpose?: CredentialPurpose`; the seven call sites become `{ purpose: 'alternateIdentity' }`. Git identity stays in the core — the core is forge-neutral, not git-neutral (PRD story 14).

### 4. Fail-fast survives, as validation rather than caching

`buildLaunchGitContext` throws **at construction** today when no veracious token exists, and four separate suites pin that: `launchGitContext.test.ts:167` and `webhookRepoResolver.test.ts:357` (`resolveToken: () => ''` → `/GitContext/`), `feature-700.steps.ts:134` (an unavailable mint must throw out of `buildLaunchGitContext`), and `feature-776`'s webhook-resilience scenario, whose whole RED depends on `gitContextForRepo` throwing `no veracious token`. Moving resolution to command time without care deletes that early warning and breaks all four.

`assertCompleteIdentity` therefore performs **one probe** when a provider is supplied: call `credentialEnv({ owner, repo, purpose: 'default' })`, reject an overlay that is empty or carries a blank value, then **discard the result**. Validate at construction, resolve per command — the probe stores nothing, so AC1's "no construction-time token caching" holds literally, while the loud-failure-at-launch discipline is preserved unchanged.

### 5. Transitional: `GitContextOptions.token` stays

`token`/`pat` remain accepted, and when no `tokenProvider` is supplied the constructor wraps them in a private static provider (`staticCredentialProvider`, module-scope in `gitContext.ts`, marked TRANSITIONAL). This is deliberate and load-bearing:

- ~350 existing `new GitContext(...)` call sites across `gitContextOperations.test.ts` (166), `gitContext.test.ts` (67), `gitReadOps.test.ts` (51), `repoApiCwd.test.ts` (19), `workingDirectoryGuard.test.ts` (10) and ~20 BDD step-definition files construct with a literal `token` and assert `calls[0].env.GH_TOKEN`. Those suites are this slice's regression net. Rewriting them is not proof of behaviour-neutrality; leaving them untouched and green *is*.
- Production stops using the path entirely. Both boundaries (`buildLaunchGitContext`, `gitContextFactory`) pass a live provider and stop passing `token`, so the construction-time snapshot genuinely disappears from every real process. The remaining literal-token path is a caller handing over a credential it already owns, not the core caching a resolution.
- `token` and the static provider are deleted when the forge adapter lands (#792/#796). One marked helper, one deletion.

`assertCompleteIdentity` enforces exactly-one-of: a `tokenProvider`, or a non-empty `token`.

### 6. What is deliberately not in this slice

- **Moving the provider into a forge adapter package.** `githubTokenProvider.ts` sits beside `appAuth.ts`, `tokenResolver.ts` and `commands/*.ts` — all GitHub-flavoured files that the package already holds and that #792 relocates together.
- **`appAuth.ts`'s own environment reads** (`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_PATH`, `:62-68`, `:75-76`). The PRD assigns "GitHub App authentication (environment reads become injected configuration)" to the adapter slice explicitly. After #791 those reads are reached only through the provider's injected `isAppConfigured`/`mintInstallationToken` seams — which is the shape AC2 asks for; converting them to constructor config is #792's edit.
- **Removing `usePat` from anything but the core.** It has no other home; after this slice the identifier does not exist in `adws/`.
- **The CI guard's new construction rule** (#795) and the ~20 semantic-caller migration (#796/#797).

## Relevant Files

Use these files to implement the feature:

- `adws/gitContext/gitContext.ts` — **the core edit.** Module header (`:1-34`, its paragraph on "per-command auth (token or PAT, via the GitHub-specific `usePat` flag)" must be rewritten to describe the port); `assertCompleteIdentity` (`:85-110`, gains exactly-one-of + the discard-after-validate probe); private fields (`:122-132`, `#token`/`#pat` → `#credentials`); constructor (`:134-146`); `commandEnv` (`:158-167`, the `GH_TOKEN` ternary is deleted and replaced by a provider call); `#run` (`:217-234`) and `#runRepoApi` (`:236-254`) swap `usePat` for `purpose`; the seven `usePat: true` call sites at `:622` (`approvePR`), `:658` (`runGraphQL`), `:663` (`runGraphQLInput`), `:675`/`:682`/`:692`/`:701` (`moveIssueToStatus`'s four board calls). `exec` (`:202-215`) and `#resolveWorkingDirectory` (`:169-175`) are **untouched** — #790's signature is final.
- `adws/gitContext/types.ts` — **the port lives here.** Add `CredentialPurpose`, `CredentialRequest` and `TokenProvider` after `ExecOptions` (`:45-56`). Add `tokenProvider?: TokenProvider` to `GitContextOptions` (`:98-135`) and re-document `token` (`:110`) and `pat` (`:131`) as the transitional literal-credential path.
- `adws/gitContext/tokenResolver.ts` — `resolveContextToken` (`:46-62`) and `ResolveContextTokenInput` (`:19-29`). **Read-only reference: no edit.** It is already the pure resolution-order function the port wraps; changing it would put its 168-line test suite at risk for no gain. (The issue's Touched Files anticipated the provider being written into this file; a separate module is the modularity-guideline choice and gives #792 one file to relocate.)
- `adws/gitContext/appAuth.ts` — `isGitHubAppConfigured` (`:62`), `getInstallationToken` (`:74-93`) and the expiry-aware `tokenCache`/`REFRESH_BUFFER_MS` (`:35`, `:40`). **Read-only reference, and the reason per-command resolution is cheap on the production path:** the mint already returns from cache until five minutes before expiry, so calling the provider per command costs a `Map.get` plus a date comparison, not an API round-trip.
- `adws/gitContext/index.ts` — **public surface** (`:16-36`). Export `createGitHubTokenProvider` and the three port types.
- `adws/core/launchGitContext.ts` — **boundary 1.** `LaunchGitContextDeps` (`:31-42`) gains `tokenProvider?`; `resolveLaunchToken` (`:49-58`) becomes the body of the production provider; `buildLaunchGitContext` (`:77-99`) passes `tokenProvider` instead of `token: resolveToken(owner, repo)` (`:94`). The existing `deps.resolveToken` seam is **retained** and adapted into a provider — five test files and two step-definition files inject it.
- `adws/github/gitContextFactory.ts` — **boundary 2.** `resolveToken` (`:40-49`) becomes provider construction; `gitContextForSync` (`:93-106`) passes a provider with `pat` only; `gitContextForRepo` (`:109-121`) passes a provider with `pat` **and** `alternateIdentityPat` (both `GITHUB_PAT`), preserving the `:119` asymmetry exactly. Neither exported signature changes, so its ~30 consumers are untouched.
- `adws/core/environment.ts` — `GITHUB_PAT` (`:106`). Read-only reference; it stays the ADW-side environment read, which is where AC2 wants credential reads to live.
- `adws/gitContext/__tests__/gitContext.test.ts` — **primary test extension** (597 lines). Holds `validOptions()` (`:11-27`), the `commandEnv` suite (`:180-238`) and #790's `exec` suite. Gains the port suite; existing assertions must survive **unmodified** on the transitional literal-token path.
- `adws/gitContext/__tests__/gitContextOperations.test.ts` — **regression net, zero edits** (1560 lines). Pins `GH_TOKEN` injection (`:55-80`), the PAT-selection contract (`:911-923`: PAT when configured, primary token when not), `PATH` inheritance, and no process-global environment mutation. Green with no diff is the behaviour-neutrality proof.
- `adws/gitContext/__tests__/repoApiCwd.test.ts` — **regression net, zero edits** (340 lines). `:263-268` pins `approvePR` spawning with the PAT; `:270-277` pins no process-global environment mutation. Both must hold through the rewrite.
- `adws/gitContext/__tests__/tokenResolver.test.ts` — **zero edits** (168 lines). Its `SENTINEL` discipline (`:25-28`: an ambient `GH_TOKEN` is seeded and must never be returned) is the pattern the new provider suite copies.
- `adws/core/__tests__/launchGitContext.test.ts` — **extension.** `baseDeps` (`:26-34`) injects `resolveToken`; `:141-144` asserts `commandEnv().GH_TOKEN`; `:165-171` asserts the empty-token construction throw. All must stay green; the file gains provider-path coverage.
- `adws/triggers/__tests__/webhookRepoResolver.test.ts` — `:356-362` pins the same construction throw via `buildLaunchGitContext`. **Zero edits expected.**
- `features/per-issue/step_definitions/gitContextSharedWorld.ts` — `W`, `makeSpyExec` (`:60-76`), `makeFullOptions` (`:78-99`, sets `token`, no `pat`), `makeNoOpFsDeps` (`:104-111`). The world every `@adw-6xx`/`@adw-7xx` GitContext family drives. `makeFullOptions` keeps producing a literal `token`, so every existing family is unaffected; `@adw-791` builds its provider-backed options at its own call site.
- `features/per-issue/step_definitions/feature-700.steps.ts` — `:126-141` injects the real `resolveContextToken` as `deps.resolveToken` and expects `buildLaunchGitContext` to throw on an unavailable mint. The seam-retention decision in §4 exists to keep this green.
- `specs/prd/gitcontext-forge-agnostic-refactor.md` — Implementation Decisions → *TokenProvider port*; Testing Decisions → *TokenProvider port*; user stories 12 and 13. The authority for this slice's scope.
- `specs/issue-790-adw-q46zy4-promote-gitcontext-s-sdlc_planner-forge-neutral-executor.md` — the predecessor plan. Its Notes state what #791 is expected to do; the executor signature it landed is fixed input here.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — the owning living doc. Overview describes `commandEnv()` and the temporary `usePat`; Responsibilities and the Token Veracity section need the port.
- `.adw/conditional_docs.md` — that doc's Conditions block (`:2028+`). Gains TokenProvider conditions.
- `README.md` — the `adws/gitContext/` tree block (`:635-675`): `gitContext.ts` (`:662`), `tokenResolver.ts` (`:668`), `types.ts` (`:669`) one-liners, plus a new `githubTokenProvider.ts` entry and its test file under `__tests__/` (`:637-648`, alphabetical).
- `.adw/coding_guidelines.md` — binding: clarity over cleverness, modularity, immutability, type safety (no `any`, discriminated unions over loose optionals), guard clauses / max depth ~2, isolate side effects, JSDoc on public APIs.

### New Files

- `adws/gitContext/githubTokenProvider.ts` — `createGitHubTokenProvider(input): TokenProvider` and `GitHubTokenProviderInput`. The port's GitHub implementation; relocates wholesale to the forge adapter in #792.
- `adws/gitContext/__tests__/githubTokenProvider.test.ts` — resolution order, purpose selection, per-call resolution, the ambient-`GH_TOKEN` sentinel.
- `features/per-issue/step_definitions/feature-791.steps.ts` — the `@adw-791` step definitions.

## Implementation Plan

### Phase 1: Foundation

Define the vocabulary before any behaviour moves. Add `CredentialPurpose`, `CredentialRequest` and `TokenProvider` to `types.ts` with JSDoc stating the two contracts that make the port worth having: it is called **per command** and its result is never memoised by the core; and the core declares a *purpose*, never a credential kind. Add the optional `tokenProvider` field to `GitContextOptions` and re-document `token`/`pat` as transitional. Write `githubTokenProvider.ts` as a pure factory over the untouched `resolveContextToken`, and its test suite. Export everything from `index.ts`. Nothing in `gitContext.ts` changes yet; `bunx tsc --noEmit` and the full unit suite stay green.

### Phase 2: Core Implementation

Rewire the core onto the port. Delete `#token`/`#pat`, add `#credentials`, add the module-scope `staticCredentialProvider` for the transitional literal path, and extend `assertCompleteIdentity` with the exactly-one-of check plus the discard-after-validate probe. Rewrite `commandEnv` to call the provider per invocation. Rename `usePat` to `purpose` on both classifiers and update the seven call sites. `exec` is not touched. Extend `gitContext.test.ts` with the port suite — most importantly the no-caching proof: a provider that returns a different credential on each call must put a *different* `GH_TOKEN` on the second spawn.

### Phase 3: Integration

Point production at the port. `launchGitContext.ts` and `gitContextFactory.ts` build a live `createGitHubTokenProvider` and stop passing `token`, preserving the `alternateIdentityPat` asymmetry between `gitContextForRepo` and the other two factories, and preserving the `deps.resolveToken` injection seam by adapting it into a provider. Then prove neutrality across everything downstream: `gitContextOperations.test.ts`, `repoApiCwd.test.ts`, `tokenResolver.test.ts` and `workingDirectoryGuard.test.ts` green with **zero diff**; the four construction-throw pins still throwing; the ~15 existing `@adw-*` GitContext BDD families green with their step definitions unmodified. Add `@adw-791` step definitions, then update the living documentation.

## Step by Step Tasks

Execute every step in order, top to bottom.

### 1. Add the port to `adws/gitContext/types.ts`

- After `ExecOptions` (`:56`) add:
  - `export type CredentialPurpose = 'default' | 'alternateIdentity';`
  - `export interface CredentialRequest { readonly owner: string; readonly repo: string; readonly purpose: CredentialPurpose; }`
  - `export interface TokenProvider { credentialEnv(request: CredentialRequest): NodeJS.ProcessEnv; }`
- JSDoc all three, stating: (a) `credentialEnv` is called on **every** command and the core never memoises its result — a GitHub App installation token expires and the port is what lets it refresh; (b) the return value is a per-command **overlay**, merged over the inherited process environment by `exec`, never a whole environment and never a process-global mutation; (c) `purpose` is the core's forge-neutral declaration of *why* a credential is needed, never a credential kind — `'alternateIdentity'` means "the primary automation identity cannot perform this operation", and the provider alone decides what answers it.
- In `GitContextOptions`, add `tokenProvider?: TokenProvider` with JSDoc: supplying it is the supported path; the core then holds no credential at all.
- Re-document `token` (`:110`) and `pat` (`:131`): TRANSITIONAL literal-credential path, kept so ~350 existing construction sites stay untouched; exactly one of `token` or `tokenProvider` is required; both fields are removed with the forge adapter (#792/#796).
- Leave `ExecFn`, `ExecWorkingDirectory`, `ExecOptions`, `FsDeps`, `GitContextDeps` and `GitIdentity` unchanged.

### 2. Create `adws/gitContext/githubTokenProvider.ts`

- Module header: this is the port's **GitHub** implementation and the first file of the forge adapter #792 will relocate. It owns resolution order and the PAT-versus-installation-token decision, so the core does not.
- `export interface GitHubTokenProviderInput` with, all injected (no environment reads in this file):
  - `pat?: string | undefined` — candidate in the resolution order, after the App mint.
  - `alternateIdentityPat?: string | undefined` — served to `'alternateIdentity'` requests; absent → the resolved token, preserving `runGraphQLInput`'s documented graceful fallback.
  - `isAppConfigured: () => boolean`
  - `mintInstallationToken: (owner: string, repo: string) => string`
  - `ghAuthToken: () => string`
- `export function createGitHubTokenProvider(input: GitHubTokenProviderInput): TokenProvider` returning an object whose `credentialEnv` is a guard-clause function (max depth 1): `alternateIdentity` + a non-blank `alternateIdentityPat` → `{ GH_TOKEN: alternateIdentityPat }`; otherwise `{ GH_TOKEN: resolveContextToken({ owner, repo, pat, isAppConfigured, mintInstallationToken, ghAuthToken }) }`.
- Return a **fresh object every call** (immutability guideline) and hold **no memo of any kind** — every call re-enters `resolveContextToken`. Document that the App path's caching is `appAuth.ts`'s expiry-aware cache and belongs there, not here.
- Do not import from `gitContext.ts`; import only the port types and `resolveContextToken`.

### 3. Write `adws/gitContext/__tests__/githubTokenProvider.test.ts`

- Copy `tokenResolver.test.ts:25-28`'s sentinel discipline verbatim: seed an ambient `GH_TOKEN` in `beforeEach`, delete it in `afterEach`, and assert no returned credential ever equals it.
- **Resolution order:** App configured → the mint bound to the requested `owner/repo`; App configured + mint throws → the throw propagates and no ambient value is substituted; App absent + PAT set → the PAT; App absent + blank PAT + `gh auth token` non-empty → that; nothing available → throws `/no veracious token for acme\/webapp/`.
- **Purpose selection:** `alternateIdentity` + `alternateIdentityPat` set → that value, *even when the App is configured* (the mint must not be consulted); `alternateIdentity` + no `alternateIdentityPat` → identical to `default`; `alternateIdentity` + whitespace-only `alternateIdentityPat` → identical to `default`; `default` never returns `alternateIdentityPat`.
- **Per-call resolution (no caching) — the AC's headline test:** a counting `mintInstallationToken` that returns `token-1`, `token-2`, `token-3`; three `credentialEnv` calls must yield those three values and a mint call count of exactly 3. Repeat for the `ghAuthToken` branch.
- **Per-repo binding:** two requests with different `owner/repo` yield differently-bound credentials from one provider instance.
- **Shape:** the returned overlay carries only the credential variable — no `GIT_*` keys (the core adds identity, not the provider).

### 4. Export the port and the provider from `adws/gitContext/index.ts`

- Add `export { createGitHubTokenProvider } from './githubTokenProvider';` and `export type { GitHubTokenProviderInput } from './githubTokenProvider';`
- Extend the existing `export type { ... } from './types'` line (`:17`) with `TokenProvider`, `CredentialPurpose` and `CredentialRequest`.
- Update the header comment: the public surface now includes the TokenProvider port a forge adapter implements, alongside the executor primitive it feeds.

### 5. Add the transitional static provider to `adws/gitContext/gitContext.ts`

- At module scope, beside `defaultExec` (`:71-83`):

```ts
/**
 * TRANSITIONAL — the literal-credential path for callers that still pass
 * `options.token`/`options.pat` instead of a `tokenProvider`. Production no
 * longer takes this path; it exists so the ~350 existing construction sites
 * stay untouched and keep acting as this slice's regression net. Deleted with
 * `GitContextOptions.token`/`pat` in #792/#796.
 */
function staticCredentialProvider(token: string, pat: string | undefined): TokenProvider { ... }
```

- Its `credentialEnv` reproduces `:161` exactly: `{ GH_TOKEN: (purpose === 'alternateIdentity' && pat) ? pat : token }`. This is the *only* place `GH_TOKEN` survives in the core, and it is one deletion away from gone.

### 6. Replace the credential fields in `gitContext.ts`

- Delete `readonly #token: string` and `readonly #pat: string | undefined` (`:128-129`) and their constructor assignments (`:139-140`).
- Add `readonly #credentials: TokenProvider`.
- Constructor: `this.#credentials = options.tokenProvider ?? staticCredentialProvider(options.token, options.pat);`
- Import `TokenProvider` and `CredentialPurpose` from `./types`.

### 7. Extend `assertCompleteIdentity` with exactly-one-of and the discard-after-validate probe

- Remove `token` from the unconditional required-field list (`:86-92`); it is now conditionally required.
- Guard-clause order, after the owner/repo/path/identity checks:
  - Neither `tokenProvider` nor a non-empty `token` → `throw new Error('GitContext: exactly one of tokenProvider or token must be provided')`.
  - `tokenProvider` absent and `token` blank → the existing `GitContext: token must not be empty` message, unchanged.
  - `tokenProvider` present → probe once: `const probe = options.tokenProvider.credentialEnv({ owner, repo, purpose: 'default' })`. Reject an overlay with no entries, or any entry whose value is a blank string, with `GitContext: tokenProvider returned no credential for <owner>/<repo>`. **Discard `probe`** — never store it.
- JSDoc the probe: *validate at construction, resolve per command.* It preserves the launch-time loud failure that `launchGitContext.test.ts:167`, `webhookRepoResolver.test.ts:357`, `feature-700.steps.ts:134` and `feature-776` all depend on, while storing nothing — which is what keeps AC1 literally true.
- The blank-value check is what makes `resolveToken: () => ''` still throw; keep the message prefixed `GitContext:` so both `.toThrow(/GitContext/)` assertions still match.

### 8. Rewrite `commandEnv` onto the port

- New signature: `commandEnv(base: NodeJS.ProcessEnv = {}, purpose: CredentialPurpose = 'default'): NodeJS.ProcessEnv`.
- Body: `return { ...base, ...this.#credentials.credentialEnv({ owner: this.#owner, repo: this.#repo, purpose }), GIT_AUTHOR_NAME: ..., GIT_AUTHOR_EMAIL: ..., GIT_COMMITTER_NAME: ..., GIT_COMMITTER_EMAIL: ... };`
- Credential spread **before** the `GIT_*` assignments so a provider cannot accidentally clobber git identity; still after `base`, preserving today's precedence for the eight phase call sites that pass an overlay base.
- Update the JSDoc: the credential is resolved on **every** call, not captured at construction; the agent-subprocess call sites (`buildPhase.ts:157`/`:235`, `documentPhase.ts:68`/`:118`, `reviewPhase.ts:90`/`:204`, `prPhase.ts:39`/`:72`, `prReviewPhase.ts:285`/`:340`, `scenarioFixPhase.ts:131`, `promotionRotAdvisory.ts:132`) get a freshly-resolved credential per invocation, which is a strict improvement for long-running orchestrators.
- All existing production call sites pass zero or one argument, so no call site changes.

### 9. Swap `usePat` for `purpose` on the two classifiers

- `#run(command, opts: { cwd?: string; input?: string; purpose?: CredentialPurpose } = {})` → `env: this.commandEnv({}, opts.purpose ?? 'default')`.
- `#runRepoApi(command, opts: { input?: string; purpose?: CredentialPurpose } = {})` → same.
- Rewrite both JSDoc blocks: the classifier declares a credential **purpose**; the provider decides which credential answers it. Delete the "GitHub-specific `usePat` flag… leaves in the TokenProvider slice (#791)" note — this slice is where it left.
- Update the seven call sites from `{ usePat: true }` to `{ purpose: 'alternateIdentity' }`: `approvePR` (`:622`), `runGraphQL` (`:658`), `runGraphQLInput` (`:663`), and `moveIssueToStatus`'s four board calls (`:675`, `:682`, `:692`, `:701`). Keep `approvePR`'s and `moveIssueToStatus`'s existing comments explaining *why* GitHub needs a different identity — that rationale is now the only GitHub knowledge left at these sites, and it is documentation, not policy.
- `grep -rc "usePat" adws/` must report `0` everywhere afterwards.

### 10. Rewrite the `gitContext.ts` module header

- Replace the paragraph at `:24-27` ("Both inject per-command auth (token or PAT, via the GitHub-specific `usePat` flag — private and temporary…)") with: both classifiers assemble their credential environment through the **TokenProvider port**, called once per command and never cached by the core; they declare a forge-neutral `CredentialPurpose` and the provider decides which credential answers it. Note that the core holds no token, that identity validation probes the provider once at construction and discards the result, and that `token`/`pat` remain only as the transitional literal path.

### 11. Extend `adws/gitContext/__tests__/gitContext.test.ts` with the port suite

All additive — no existing assertion may be modified. Add a `providerOptions()` helper beside `validOptions()` (`:11-27`) that supplies a `tokenProvider` and omits `token`.

- **Per-command resolution:** a recording provider + spy exec; run three operations; the provider was called three times, each with the context's `owner`/`repo`.
- **No caching (the AC's headline):** a provider returning `token-1`, `token-2`, `token-3` on successive calls; three spawns carry three different `GH_TOKEN` values. This is RED against today's `#token` field.
- **`commandEnv` is per-call too:** two `commandEnv()` calls on one context return different credentials from the same incrementing provider.
- **Purpose routing:** `approvePR` and each of `moveIssueToStatus`'s board calls reach the provider with `purpose: 'alternateIdentity'`; `defaultBranch` and an ordinary git op reach it with `'default'`.
- **Identity precedence:** a provider that returns `{ GH_TOKEN, GIT_AUTHOR_NAME: 'Hijack' }` must not displace the context's `gitIdentity` in the spawned environment.
- **Construction validation:** provider present + `token` absent → constructs; both absent → throws `/GitContext/`; provider returning `{}` → throws `/GitContext/`; provider returning `{ GH_TOKEN: '' }` → throws `/GitContext/`; provider throwing → the throw propagates out of the constructor unchanged.
- **The probe caches nothing:** construct with an incrementing provider, then run one command; the command carries the *second* value, not the probe's.
- **Legacy path unchanged:** `validOptions({ token: 'tok', pat: 'pat-tok' })` still yields `tok` for a default op and `pat-tok` for `approvePR` — the same contract `gitContextOperations.test.ts:911-923` pins, restated at the seam this slice moved.

### 12. Point `adws/core/launchGitContext.ts` at the port

- Add `tokenProvider?: TokenProvider` to `LaunchGitContextDeps` (`:31-42`).
- Add `export function createLaunchTokenProvider(): TokenProvider` returning `createGitHubTokenProvider({ pat: GITHUB_PAT, isAppConfigured: isGitHubAppConfigured, mintInstallationToken: getInstallationToken, ghAuthToken })`. No `alternateIdentityPat` — `buildLaunchGitContext` sets no `pat` today, so adding one would change behaviour.
- Keep `resolveLaunchToken` exported (it is public API and documents the resolution order) but note it is no longer the construction path.
- In `buildLaunchGitContext` (`:77-99`), resolve the provider in precedence order: `deps.tokenProvider` → a provider adapting `deps.resolveToken` (`{ credentialEnv: ({ owner, repo }) => ({ GH_TOKEN: deps.resolveToken(owner, repo) }) }`) → `createLaunchTokenProvider()`. Pass `tokenProvider` to `new GitContext({...})` and **remove** the `token: resolveToken(owner, repo)` line (`:94`).
- The adapted `resolveToken` seam keeps `launchGitContext.test.ts`, `webhookRepoResolver.test.ts`, `feature-660.steps.ts`, `feature-664.steps.ts` and `feature-700.steps.ts` working unmodified — and makes those injections per-call, which is what the empty-string and unavailable-mint pins now exercise through the step-7 probe.

### 13. Point `adws/github/gitContextFactory.ts` at the port

- Replace the private `resolveToken` (`:40-49`) with two provider builders that keep today's asymmetry explicit:
  - `gitContextForSync` (`:93-106`) → `createGitHubTokenProvider({ pat: GITHUB_PAT, ... })`, **no** `alternateIdentityPat` (it sets no `GitContextOptions.pat` today).
  - `gitContextForRepo` (`:109-121`) → `createGitHubTokenProvider({ pat: GITHUB_PAT, alternateIdentityPat: GITHUB_PAT, ... })`, reproducing `:119`.
- Stop passing `token` and `pat` in both; pass `tokenProvider`.
- Neither exported signature changes, so the ~30 consumer modules are untouched.
- Comment the asymmetry at both sites, citing that it is preserved deliberately (see Notes) rather than tidied.

### 14. Extend `adws/core/__tests__/launchGitContext.test.ts`

- Existing tests unmodified — `baseDeps` keeps injecting `resolveToken`, `:141` still asserts `commandEnv().GH_TOKEN`, `:165-171` still asserts the empty-token throw.
- Add: `deps.tokenProvider` takes precedence over `deps.resolveToken`; a launch context built with a provider resolves per command (two operations, two credentials); a provider that throws surfaces at construction; and the launch provider serves the same credential for `'default'` and `'alternateIdentity'` (no `alternateIdentityPat` at this boundary).

### 15. Add the `@adw-791` BDD step definitions

Implement `features/per-issue/step_definitions/feature-791.steps.ts` against `features/per-issue/feature-791.feature` and its declared phrase list. The feature file is written by the scenario phase and reconciled with this plan in the alignment phase; where it and this plan disagree on wording, the feature file wins on *phrasing* and this plan wins on *shape*.

- **Reuse `gitContextSharedWorld.ts`** — `W`, `makeSpyExec`, `makeNoOpFsDeps`, `FRAMEWORK_ROOT`, `TARGET_REPOS_ROOT`. Do not create a second world. `makeFullOptions` keeps returning a literal `token`; `@adw-791` builds provider-backed options at its own call site through a local helper, so no existing family's construction changes.
- **One binding point.** A single module-private helper builds the recording provider and the context; if review reshapes the port, exactly one helper changes.
- **Intended coverage:** (a) one context, three commands, three different credentials on the wire — the no-caching proof; (b) an operation needing the alternate identity spawns with the alternate credential while an ordinary operation on the *same context* spawns with the resolved one; (c) the resolution order end-to-end through the real `createGitHubTokenProvider` with test-controlled sources — App mint wins, then PAT, then `gh auth token`, then a loud throw; (d) an ambient `GH_TOKEN` sentinel is never served and never mutated, across both purposes; (e) a context whose provider cannot produce a credential fails loudly at construction, naming the repository; (f) git identity still reaches the child process unchanged alongside the resolved credential.
- **Phrasing.** Every phrase is deliberately novel and deliberately distinct from `feature-659`/`feature-775`/`feature-777`/`feature-790` — `cucumber.js` globally imports `features/per-issue/step_definitions/**/*.ts`, so a phrase reused from another family is an `AmbiguousStepDefinition` at load time. Reuse only phrases the feature file explicitly names as registered in `features/regression/vocabulary.md`.
- Restore the environment snapshot in `After` for any scenario that perturbs it, per the `feature-775` precedent.

### 16. Prove the untouched suites stayed untouched

- `bun run test:unit` green with **zero edits** to `gitContextOperations.test.ts`, `repoApiCwd.test.ts`, `tokenResolver.test.ts`, `workingDirectoryGuard.test.ts` and `webhookRepoResolver.test.ts`.
- Confirm with `git diff --stat` over those five files — it must print nothing.
- If any pre-existing assertion needs modification, **stop**: that is a behaviour change this slice must not make (PRD story 24, "operationally invisible"), and it needs re-planning rather than a test edit.

### 17. Update the living documentation

- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — Overview: replace the `commandEnv`/`usePat` sentences with the port (called per command, never cached by the core, purpose-declared not credential-declared, provider owns `GH_TOKEN` and the PAT decision). Responsibilities: rewrite the `commandEnv(base?)` bullet, add a TokenProvider-port bullet, and note the construction probe validates-and-discards. Token Veracity section: `resolveContextToken` is unchanged and is now reached *through* `createGitHubTokenProvider`. Add `githubTokenProvider.ts` to the package-modules table. Note that the port is what #792's adapter implements.
- `.adw/conditional_docs.md` — under that doc's Conditions (`:2028+`), add: working with `TokenProvider`, `CredentialPurpose` or `createGitHubTokenProvider`; changing which credential an operation receives; debugging an expired GitHub App installation token in a long-running orchestrator; adding a construction site for `GitContext` (provider versus transitional literal token).
- `README.md` — update the `gitContext.ts` (`:662`), `tokenResolver.ts` (`:668`) and `types.ts` (`:669`) one-liners; add `githubTokenProvider.ts` to the tree in alphabetical position and `githubTokenProvider.test.ts` under `__tests__/` (`:637-648`). Surgical edits only; do not restructure the tree.

### 18. Run the Validation Commands

Execute every command in the `Validation Commands` section below and confirm each one passes.

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, and the PRD names the existing package suites as this refactor's regression net.

- **`adws/gitContext/__tests__/githubTokenProvider.test.ts` (new)** — the port's GitHub implementation in isolation, no `GitContext` involved: resolution order (App mint → PAT → `gh auth token` → loud throw), purpose selection and its blank/absent fallbacks, per-call resolution proved by a counting mint, per-repo binding, overlay shape, and the ambient-`GH_TOKEN` sentinel. All seams injected; no network, no subprocess.
- **`adws/gitContext/__tests__/gitContext.test.ts` (extended)** — the core against the port through the injected exec fake: provider called once per command with the context identity; three commands carrying three different credentials; `commandEnv` re-resolving per call; `'alternateIdentity'` routing for the seven forge sites and `'default'` everywhere else; git identity surviving a hostile provider; construction validation (exactly-one-of, empty overlay, blank value, propagated throw); the probe caching nothing; and the transitional literal-token contract restated.
- **`adws/core/__tests__/launchGitContext.test.ts` (extended)** — boundary wiring: `tokenProvider` precedence over `resolveToken`, per-command resolution through a launch context, construction-time propagation of a provider throw, and the deliberate absence of an alternate identity at this boundary.
- **Zero-edit regression net** — `gitContextOperations.test.ts` (1560 lines, pins `GH_TOKEN`/`GIT_*` injection, PATH inheritance, no process-global environment mutation, PAT-versus-primary selection at `:911-923`), `repoApiCwd.test.ts` (`approvePR` PAT contract at `:263`, the 35-method framework-root table), `tokenResolver.test.ts`, `workingDirectoryGuard.test.ts`, `webhookRepoResolver.test.ts`. Green with an empty diff is the proof this slice is behaviour-neutral.

Every test asserts external behaviour only — which command was spawned, with which environment and working directory, and what the caller observed. No private state, no call-order assertions beyond the credential-per-call counts the AC explicitly requires.

### Edge Cases

- **Provider returns a blank credential** (`{ GH_TOKEN: '' }`) — must fail loudly at construction, preserving the `resolveToken: () => ''` pins in two existing suites.
- **Provider returns an empty overlay** (`{}`) — same loud failure; a provider that silently produces nothing is the wrong-repo class in new clothing.
- **Provider throws at construction** (App configured, repo has no installation) — propagates verbatim; `feature-700` and `feature-776` both depend on this.
- **Provider throws mid-command** (token expired and the refresh mint fails) — propagates from `commandEnv` *before* `exec` is entered, so it is not wrapped by the ENOENT rewrap and the resolver's own message reaches the caller intact.
- **`alternateIdentityPat` absent** — `alternateIdentity` must resolve identically to `default`, preserving `runGraphQLInput`'s documented graceful fallback and `gitContextOperations.test.ts:918-923`.
- **`alternateIdentityPat` whitespace-only** — treated as absent, matching `resolveContextToken`'s existing `pat?.trim()` discipline.
- **Provider returns `GIT_AUTHOR_NAME`** — the context's git identity must win; a credential provider has no business setting commit authorship.
- **Both `token` and `tokenProvider` supplied** — the provider wins (the constructor never reads `token` when a provider is present), and the exactly-one-of validation message documents the intent.
- **An ambient `GH_TOKEN` is set on the host** — never read as a credential source and never mutated; the sentinel pattern from `tokenResolver.test.ts:25-28` is repeated in both new suites.
- **Two contexts, two repos, one process** — each resolves against its own `owner/repo` per command; no cross-context credential bleed (the original GH_TOKEN-bleed class).
- **A command that runs with no PAT configured anywhere** — `alternateIdentity` degrades to the resolved token rather than throwing, exactly as today.

## Acceptance Criteria

- [ ] `TokenProvider`, `CredentialRequest` and `CredentialPurpose` exist in `adws/gitContext/types.ts` and are exported from `adws/gitContext/index.ts`.
- [ ] `GitContext` holds no token field. `#token` and `#pat` are gone; a single `#credentials: TokenProvider` replaces them.
- [ ] `commandEnv` calls the port on **every** invocation. Three commands through one context, with a provider returning three different credentials, spawn with three different `GH_TOKEN` values.
- [ ] Construction validates the provider once and discards the result — the first command's credential is the provider's *second* value, not the probe's.
- [ ] A context whose provider yields nothing (empty overlay, blank value) or throws fails loudly at construction, and the four existing construction-throw pins (`launchGitContext.test.ts:167`, `webhookRepoResolver.test.ts:357`, `feature-700.steps.ts:134`, `feature-776`) still hold.
- [ ] The identifier `usePat` appears nowhere in `adws/` (`grep -rc "usePat" adws/` reports 0 for every file). Both classifiers take `purpose: CredentialPurpose`; `exec`'s signature is unchanged from #790.
- [ ] `createGitHubTokenProvider` owns the resolution order and the PAT decision; the core names no credential kind. The only `GH_TOKEN` literal left in the core is the TRANSITIONAL `staticCredentialProvider`.
- [ ] `approvePR`, `runGraphQL`, `runGraphQLInput` and `moveIssueToStatus`'s four board calls still spawn with the PAT when one is configured, and still fall back to the resolved token when none is; ordinary operations still spawn with the resolved token.
- [ ] `buildLaunchGitContext`, `gitContextForSync` and `gitContextForRepo` pass a live provider and no literal `token`; `gitContextForRepo` alone supplies `alternateIdentityPat`, preserving today's asymmetry.
- [ ] `deps.resolveToken` still works as an injection seam; no existing test or step-definition file that uses it needed an edit.
- [ ] `gitContextOperations.test.ts`, `repoApiCwd.test.ts`, `tokenResolver.test.ts`, `workingDirectoryGuard.test.ts` and `webhookRepoResolver.test.ts` pass with a **zero-line diff**.
- [ ] All Validation Commands pass, including the full unit suite, the `@regression` suite and the GitContext BDD families listed below.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are the project-specific ones from `.adw/commands.md`.

**Prove the new surface (RED before, GREEN after):**
- `bunx vitest run adws/gitContext/__tests__/githubTokenProvider.test.ts` — **RED before** (module does not exist); GREEN after.
- `bunx vitest run adws/gitContext/__tests__/gitContext.test.ts` — the port suite is RED before (no `tokenProvider` option; a per-call provider cannot change the spawned credential); GREEN after, with every pre-existing assertion still green in both states.
- `bunx vitest run adws/core/__tests__/launchGitContext.test.ts` — the new provider cases are RED before; the four pre-existing cases are green in both states.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-791"` — RED before, GREEN after.

**Prove zero regressions (all must pass):**
- `bun run lint` — ESLint clean.
- `bunx tsc --noEmit` — root type-check (covers `adws/**`, `features/**` and the test files).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check.
- `bun run test:unit` — full vitest suite green.
- `git diff --stat adws/gitContext/__tests__/gitContextOperations.test.ts adws/gitContext/__tests__/repoApiCwd.test.ts adws/gitContext/__tests__/tokenResolver.test.ts adws/gitContext/__tests__/workingDirectoryGuard.test.ts adws/triggers/__tests__/webhookRepoResolver.test.ts` — must print **nothing**: the behaviour-neutrality proof.
- `bun run lint:git-guard` — whole-repo git/gh guard passes with no new violations and no allowlist change (all new code is inside the structurally exempt `adws/gitContext/` package).
- `bun run build` — `tsc` build succeeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression suite green.

**Cross-family regression net — each green with its feature file and step definitions unmodified** (these assert per-command auth, token isolation, cwd contracts and construction-time failure through exactly the code this slice rewires):
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-790"` — the executor this slice feeds.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-700"` — launch-boundary token veracity and the unavailable-mint construction throw.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-659"` — per-command auth, explicit cwd, two-context isolation.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-776"` — the webhook-resilience scenario whose RED depends on construction-time token failure.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-775"`, `--tags "@adw-777"`, `--tags "@adw-779"`, `--tags "@adw-780"` — repo-API cwd, ENOENT rewrap, mint injection, appAuth redaction.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-658"`, `--tags "@adw-661"`, `--tags "@adw-662"`, `--tags "@adw-663"`, `--tags "@adw-664"`, `--tags "@adw-691"`, `--tags "@adw-692"`, `--tags "@adw-693"`, `--tags "@adw-694"`, `--tags "@adw-695"`, `--tags "@adw-696"`, `--tags "@adw-697"`, `--tags "@adw-698"`, `--tags "@adw-699"`, `--tags "@adw-701"` — the remaining GitContext families.

**Structural checks:**
- `grep -rc "usePat" adws/` — must report `0` for every file.
- `grep -c "GH_TOKEN" adws/gitContext/gitContext.ts` — must print `1` (the TRANSITIONAL `staticCredentialProvider` only).
- `grep -c "#token\|#pat" adws/gitContext/gitContext.ts` — must print `0`.
- `grep -n "process\.env" adws/gitContext/githubTokenProvider.ts` — must print nothing (all sources injected).
- `grep -n "token:" adws/core/launchGitContext.ts adws/github/gitContextFactory.ts` — no `token:` passed into a `GitContext` constructor in either file.

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` applies. `credentialEnv` is a guard-clause function at nesting depth 1; `CredentialPurpose` is a string union rather than a boolean flag (type safety — the shape makes "the core picked a credential kind" unrepresentable); every overlay is a fresh object (immutability); all three port types and both public functions carry JSDoc. `githubTokenProvider.ts` lands well under the 300-line guideline. `gitContext.ts` is ~705 lines, already an accepted deep-module exception; this slice is net-neutral on its size and adds no new responsibility — the file shrinks when #792 moves the forge semantics out.
- **No new libraries.** Pure rewiring plus tests. (`.adw/commands.md` install command, if ever needed: `bun add <package>`.)
- **Deviation from the issue's Touched Files, stated plainly.** The issue lists five files. This plan touches nine implementation/test files plus documentation. Three additions are load-bearing: (a) `adws/gitContext/githubTokenProvider.ts` — the provider gets its own module rather than being appended to `tokenResolver.ts`, per the modularity guideline and so #792 relocates one whole file; (b) `adws/core/launchGitContext.ts` and (c) `adws/github/gitContextFactory.ts` — **without these two, the slice does not cure the disease.** They are where the construction-time resolution actually happens (`launchGitContext.ts:94`, `gitContextFactory.ts:94`/`:111`); shipping the port while production still hands over a snapshot would satisfy the letter of the ACs and leave PRD story 12's stale-token failure exactly where it is. `tokenResolver.ts` and `tokenResolver.test.ts` are correspondingly **not** touched — the resolver is already the right pure function, and its 168-line suite is worth more unmodified.
- **Why `GitContextOptions.token` survives.** ~350 construction sites assert `env.GH_TOKEN` against a literal they passed in. Those suites are the regression net the PRD explicitly designates for this refactor; rewriting them to prove the refactor is safe would be circular. The transitional path is one module-scope function, marked, with a named deletion point (#792/#796). Production takes it in exactly zero places after step 13.
- **Performance on the `gh auth token` fallback path.** When neither the GitHub App nor `GITHUB_PAT` is configured, `resolveContextToken` shells out `gh auth token` — previously once per context, now once per command. On the two production paths this is a non-issue: the App path returns from `appAuth.ts`'s expiry-aware `Map` (a lookup and a date comparison), and the PAT path is a string read. The `gh` branch is the local-dev last resort, and the executor already spawns a process per command, so the worst case is roughly a doubling on that path only. If it ever bites, the fix belongs in the provider (a short TTL on the `gh` branch specifically, which has no expiry semantics to get wrong), not in the core — but it is deliberately **not** done here, because a memo inside the provider would make the AC's "per-call resolution, no caching" test a lie.
- **The `alternateIdentityPat` asymmetry is preserved, not endorsed.** Only `gitContextForRepo` sets `GitContextOptions.pat` today, so a launch-boundary context's `approvePR` and Projects V2 writes silently run with the app token and fall back rather than using the PAT. That may well be a latent bug — an app token cannot approve its own PR — but the PRD requires this refactor to be operationally invisible (story 24), so this slice reproduces the asymmetry exactly and flags it here. Worth its own issue after the migration lands; changing it inside a refactor slice would make a real behaviour change indistinguishable from refactor fallout.
- **AC2, "no environment reads for credentials", read precisely.** After this slice the core reads no environment variable for a credential: the only process-environment touch in `gitContext.ts` is the inherit-then-overlay merge in `exec` (`:205`), which passes the parent environment through so children keep `PATH` — not a credential read, and the same reading #790's plan recorded. All credential sources (`GITHUB_PAT`, `GITHUB_APP_*`) are reached only through the provider's injected seams. Converting `appAuth.ts`'s own environment reads to injected configuration is explicitly the adapter slice's work in the PRD.
- **Why the port returns an environment overlay rather than a string.** A `token(): string` port would leave the core writing `GH_TOKEN` — a GitHub variable name in a core the PRD wants published as forge-neutral. Returning the overlay puts the name on the provider's side, and composes exactly with `ExecOptions.env` from #790: the classifier hands `exec` an overlay it did not author. The cost is that a provider *could* return unrelated variables, which is why step 11 pins git identity winning over a hostile provider.
- **What this unblocks.** #792's GitHub forge adapter implements this port and calls `ctx.exec(cmd, { cwd, env: provider.credentialEnv(...) })` directly, instead of new methods being added to the core; `githubTokenProvider.ts` and its suite move into that adapter as-is. #793 finishes the core cleanup (clone URL, identity split, logger port). #796/#797 migrate the ~20 semantic callers and delete `GitContextOptions.token`/`pat` along with the transitional static provider.
- **Operationally invisible.** Same commands, same working directories, same repositories, same credentials on the wire, same loud failures at the same moment (PRD story 24). The one intended difference is the point of the slice: a credential resolved four hours into a cron run is a *fresh* credential.
