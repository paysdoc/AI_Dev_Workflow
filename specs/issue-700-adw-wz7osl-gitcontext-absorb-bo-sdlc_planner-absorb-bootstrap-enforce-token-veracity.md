# Feature: GitContext — absorb bootstrap construction + enforce token veracity

## Metadata
issueNumber: `700`
adwId: `wz7osl-gitcontext-absorb-bo`
issueJson: `{"number":700,"title":"GitContext: absorb bootstrap construction + enforce token veracity (HITL)","body":"## Parent PRD\n`specs/prd/git-context-repo-authority.md` — Auth model + \"Removal of the unsafe primitives\".\n\n## What to build\nMove the bootstrap/construction code INTO the gitContext package so it is structurally exempt (not allowlisted): token mint (githubAppAuth), identity/derivation (gitContextFactory, launchGitContext), and clone/fetch/default-branch resolution (targetRepoManager). In doing so, enforce **token veracity**: a context'\''s token must be a mint bound to its owner/repo; remove the `resolveToken` fallback to the ambient global. This is the fix for the `fetchLatestRefs` crash class at its root.\n\n## Acceptance criteria\n- [ ] Bootstrap construction/clone/fetch/default-branch live inside adws/gitContext/ (or use verified per-command auth)\n- [ ] `resolveToken` no longer falls back to `process.env.GH_TOKEN`; bad/foreign identity fails loudly\n- [ ] Those bootstrap files removed from `ALLOWLIST` (or absorbed)\n- [ ] `lint:git-guard` passes; GitContext base-path + auth-isolation tests green\n\n## Blocked by\n- Blocked by #691, #692, #693, #694, #695, #696, #697, #698, #699\n\n## Touched Files\n- adws/gitContext/\n- adws/core/launchGitContext.ts\n- adws/github/gitContextFactory.ts\n- adws/github/githubAppAuth.ts\n- adws/core/targetRepoManager.ts\n- adws/checkGitGhGuard.ts\n\n## User stories addressed\n- User story 2\n- User story 7\n- User story 23","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-06-23T11:45:34Z","comments":[],"actionableComment":null}`

## Feature Description

This is the capstone slice of the **GitContext repo-context authority** epic (PRD: `specs/prd/git-context-repo-authority.md`). Slices #691–#699 progressively migrated every git/`gh` *consumer* onto `GitContext` methods and emptied the guard's `residual` and `diagnostic` ALLOWLIST categories. Four files remain on the ALLOWLIST under the `bootstrap (permanent)` category — the code that runs *before* a `GitContext` exists and is needed to *construct* one:

```
'adws/core/launchGitContext.ts',     // gh auth token, git config user.name/email
'adws/github/gitContextFactory.ts',  // git config, gh auth token, git remote get-url
'adws/core/targetRepoManager.ts',    // git clone, git fetch, gh repo view
'adws/github/githubAppAuth.ts',      // GitHub App token minting + git remote get-url
```

This feature **absorbs the bootstrap/construction primitives into the `adws/gitContext/` package** so they are *structurally exempt* (the guard skips the package by directory, not by allowlist), and **rewires the four files to be thin ADW adapters** that call those absorbed primitives instead of shelling out to raw `git`/`gh`. With no raw git/gh strings left in them, all four come off the ALLOWLIST and `lint:git-guard` passes against an empty bootstrap category.

Crucially, the absorption is paired with a semantic hardening — **token veracity**. Today two near-duplicate token resolvers (`resolveToken` in `gitContextFactory.ts`, `resolveLaunchToken` in `launchGitContext.ts`) silently fall back to `process.env.GH_TOKEN` when a GitHub-App installation lookup fails. Because `activateGitHubAppAuth()` mutates `process.env.GH_TOKEN` to the *last-authed* repo's token, that fallback hands a context a token bound to the **wrong repository**. Any subsequent `gh` call against the context's real `owner/repo` then fails with "could not resolve to a Repository" — the `fetchLatestRefs` crash class named in the issue (and the GH_TOKEN-bleed incidents in memory: vestmatic #143/#181/#187). The fix consolidates both resolvers into one **veracious** resolver that, when the App is configured, returns *only* a mint bound to the requested `owner/repo` and **fails loudly** on a foreign/uninstalled identity — never substituting an ambient global.

Value: it closes the root cause of the ~13-episode wrong-repo / token-bleed bug class at the one remaining unguarded surface (bootstrap), making the "wrong path" not merely discouraged but *unrepresentable* end-to-end.

## User Story

As an **ADW maintainer/operator** (PRD user stories 2, 7, 23)
I want the bootstrap construction (token mint, identity derivation, clone/fetch/default-branch) to live inside the `GitContext` package and a context's token to be a mint provably bound to its `owner/repo`
So that concurrent multi-repo activity can never authenticate against the wrong repository, a foreign/misconfigured identity fails loudly instead of silently using an ambient global, and no new bootstrap call site can reintroduce the wrong-repo class of bug.

## Problem Statement

1. **Unguarded bootstrap surface.** Four files still shell out to raw `git`/`gh` and sit on the guard ALLOWLIST. The ALLOWLIST is an escape hatch; as long as bootstrap construction lives outside the package, a future edit to these files (or a new bootstrap call site copied from them) can re-derive repo scoping or auth ad hoc — exactly the regression mode the PRD was written to eliminate.

2. **Token un-veracity (the `fetchLatestRefs` crash class).** Both token resolvers fall through to `process.env.GH_TOKEN` on an App-installation miss:
   - `adws/github/gitContextFactory.ts:56-68` — `if (isGitHubAppConfigured()) { try { return getInstallationToken(owner, repo); } catch { /* fall through */ } } if (process.env.GH_TOKEN) return process.env.GH_TOKEN; …`
   - `adws/core/launchGitContext.ts:54-70` — App → `GITHUB_PAT` → `gh auth token` → `process.env.GH_TOKEN` fallback (lines 67-68).

   `process.env.GH_TOKEN` is mutated by `activateGitHubAppAuth()` (`adws/github/githubAppAuth.ts:198`) and `refreshTokenIfNeeded()` (`:241`) to whichever repo was authed last. A context built for repo B while the global still holds repo A's token silently carries A's token; `targetRepoManager.fetchLatestRefs()` then runs `gh repo view` for B under A's token and crashes. The "fix" episodes (memory: GH_TOKEN bleed via pause-queue resume / webhook concurrency / cron crash on takeover) were all point-fixes against this same fallthrough.

3. **Duplication.** Two token resolvers and two git-identity derivers (`deriveGitIdentity` / `resolveLaunchGitIdentity`) implement the same logic with subtly different fallback chains, so a veracity fix applied to one silently leaves the other vulnerable.

## Solution Statement

**Absorb the pre-context primitives into the `adws/gitContext/` package and route the four bootstrap files through them; consolidate token resolution into one veracious resolver.**

Introduce four package-private modules inside `adws/gitContext/` (structurally exempt — the guard skips `EXEMPT_PACKAGE_DIR = 'adws/gitContext'` by directory):

1. **`adws/gitContext/appAuth.ts`** — absorbs the GitHub-App **token mint** from `githubAppAuth.ts` (`createAppJWT`, `resolveInstallationId`, `fetchInstallationToken`, `getInstallationToken`, `isGitHubAppConfigured`). The mint uses `curl` (not git/gh), but it *belongs* in the package as the auth provider per the issue ("token mint (githubAppAuth)").

2. **`adws/gitContext/bootstrapIdentity.ts`** — absorbs the **chicken-and-egg git reads** needed before a context exists: `readLocalRepoInfo(cwd?)` (`git remote get-url origin` → `{owner, repo}`, HTTPS+SSH) and `resolveBootstrapGitIdentity(deps?)` (`git config user.name/email` → `GitIdentity`, with env / App-slug / default fallbacks). This is the *only* legitimate permanent exception for a pre-context remote/config read, now living *inside* the exempt package rather than on the ALLOWLIST.

3. **`adws/gitContext/tokenResolver.ts`** — the single **veracious** `resolveContextToken(input)` (injectable seams: `owner`, `repo`, `pat?`, `isAppConfigured()`, `mintInstallationToken(owner, repo)`, `ghAuthToken()`). Rule:
   - **App configured** → return `mintInstallationToken(owner, repo)`. If minting throws (app not installed on `owner/repo` = foreign/misconfigured identity), **rethrow loudly** — do *not* substitute any ambient token.
   - **App not configured** → `pat` if set, else `ghAuthToken()` if non-empty, else throw `no veracious token for owner/repo`.
   - **Never** reads `process.env.GH_TOKEN` as a token source.

4. **`adws/gitContext/repoWorkspace.ts`** — absorbs **clone/fetch/default-branch** from `targetRepoManager.ts` (`getTargetRepoWorkspacePath`, `isRepoCloned`, `convertToSshUrl`, `cloneRepo`, `ensureRepoWorkspace`). `ensureRepoWorkspace` clones via SSH when absent, otherwise runs `git fetch origin` and reads the default branch **with per-command veracious auth** (reusing `GitContext.defaultBranch()` semantics so the `gh repo view` runs under the bound token). This is the structural fix for the `fetchLatestRefs` crash.

Then convert the four files to thin adapters (preserving their public import paths to avoid a ~40-call-site blast radius):

- **`launchGitContext.ts`** — `resolveLaunchToken` → delegates to `resolveContextToken`; `resolveLaunchGitIdentity` → delegates to `resolveBootstrapGitIdentity`; local-remote read → package `readLocalRepoInfo`. No raw git/gh remains.
- **`gitContextFactory.ts`** — `resolveToken`, `deriveGitIdentity`, `getSelfHostIdentity`, `readLocalRepoInfo` → delegate to / re-export package primitives. `gitContextFor*` factories stay (they inject `REPO_ROOT`/`TARGET_REPOS_DIR`/`GITHUB_PAT`, keeping the package free of ADW globals). No raw git/gh remains.
- **`githubAppAuth.ts`** — re-exports `getInstallationToken`/`isGitHubAppConfigured` from package `appAuth` (stable path for its 7 consumers); retains the **transitional** `activateGitHubAppAuth`/`refreshTokenIfNeeded` `process.env` provisioning for not-yet-migrated subprocess consumers, but routes their `git remote get-url origin` through package `readLocalRepoInfo`. No raw git/gh remains.
- **`targetRepoManager.ts`** — re-exports the workspace helpers from package `repoWorkspace` (stable path for trigger_cron/webhook/workflowInit/prReviewPhase). No raw git/gh remains.

Finally, **empty the bootstrap ALLOWLIST** in `checkGitGhGuard.ts` (all four entries removed) and run the guard to confirm zero violations.

**Scope guard (out of scope):** the `process.env.GH_TOKEN` *writes* in `activateGitHubAppAuth`/`refreshTokenIfNeeded` are deliberately **retained** — they are the transitional boundary-provisioning for subprocess consumers (agent env) that the PRD tracks separately. This feature removes the two GH_TOKEN *reads* (the token-source fallthrough), not the transitional writes. Per the PRD, auth *acquisition* (how App tokens are minted) is unchanged; only how the token is *resolved/applied* changes.

## Relevant Files

Use these files to implement the feature:

- `adws/checkGitGhGuard.ts` — **edit.** Remove all four bootstrap entries from `ALLOWLIST` (lines 39-45), emptying the bootstrap category. The `EXEMPT_PACKAGE_DIR = 'adws/gitContext'` directory exemption (line 30) already covers the new package modules; no allowlist entry is needed for them.
- `adws/github/githubAppAuth.ts` — **edit (absorb + shim).** Token mint moves to `adws/gitContext/appAuth.ts`; this file re-exports the mint and keeps `activateGitHubAppAuth`/`refreshTokenIfNeeded` (transitional `process.env` writes retained) with their remote read routed through package `readLocalRepoInfo`.
- `adws/github/gitContextFactory.ts` — **edit (rewire).** `resolveToken` → veracious `resolveContextToken`; `deriveGitIdentity`/`readLocalRepoInfo`/`getSelfHostIdentity` → package primitives. `gitContextFor`/`gitContextForSync`/`gitContextForRepo` retained as ADW factories injecting env config.
- `adws/core/launchGitContext.ts` — **edit (rewire).** `resolveLaunchToken`/`resolveLaunchGitIdentity` delegate to the package resolver/identity primitives; drop the `process.env.GH_TOKEN` fallback (lines 67-68). `buildLaunchGitContext` signature/behavior preserved for its 3 callers (trigger_cron, trigger_webhook, workflowInit).
- `adws/core/targetRepoManager.ts` — **edit (absorb + shim).** Clone/fetch/default-branch move to `adws/gitContext/repoWorkspace.ts`; this file re-exports for its importers (trigger_cron:228, trigger_webhook:173/237, workflowInit:215, prReviewPhase:89). The `pullLatestDefaultBranch` deprecated alias is preserved.
- `adws/gitContext/gitContext.ts` — **reference.** `GitContext.defaultBranch()` (line 161) and the `#run` per-command-env chokepoint (line 152) are the patterns `ensureRepoWorkspace` reuses for veracious default-branch reads. `assertCompleteIdentity` (line 62) is the "fail loudly on incomplete identity" precedent for the veracity error style.
- `adws/gitContext/index.ts` — **edit.** Add public exports for any newly-absorbed surface the ADW adapters import (e.g. `readLocalRepoInfo`, `resolveContextToken`, `getInstallationToken`, `isGitHubAppConfigured`, workspace helpers, types).
- `adws/gitContext/types.ts` — **reference.** `GitIdentity`, `GitContextOptions` — the absorbed identity/resolver primitives produce/consume these.
- `adws/core/environment.ts` — **reference.** `REPO_ROOT`, `TARGET_REPOS_DIR`, `GITHUB_PAT` — injected by the ADW adapters into the package primitives (keeps the package ADW-global-free).
- `adws/core/config.ts` — **reference.** `TARGET_REPOS_DIR` used by `targetRepoManager`; the absorbed `repoWorkspace` must receive it by injection, not import it.
- `adws/github/index.ts` / `adws/core/index.ts` — **edit if needed.** Barrel re-exports for `getInstallationToken`/`isGitHubAppConfigured`/`activateGitHubAppAuth`/`refreshTokenIfNeeded`, the `gitContextFor*` factories, `buildLaunchGitContext`, and the `targetRepoManager` workspace helpers must keep resolving after the rewire.
- `adws/github/githubApi.ts` — **reference.** `getRepoInfo` (line 19) calls `readLocalRepoInfo`; confirm its import still resolves (re-export) after the move.
- `specs/prd/git-context-repo-authority.md` — **reference (parent PRD).** "Auth model" and "Removal of the unsafe primitives" sections; user stories 2, 7, 23; the "Why this is different from the prior centralization that regressed" note.

### New Files
- `adws/gitContext/appAuth.ts` — absorbed GitHub-App token mint (JWT creation, installation-ID resolution, installation-token exchange, token cache, `isGitHubAppConfigured`).
- `adws/gitContext/bootstrapIdentity.ts` — pre-context git reads: `readLocalRepoInfo(cwd?)` and `resolveBootstrapGitIdentity(deps?)`.
- `adws/gitContext/tokenResolver.ts` — the single veracious `resolveContextToken(input)` with injectable seams.
- `adws/gitContext/repoWorkspace.ts` — absorbed clone/fetch/default-branch workspace management (`getTargetRepoWorkspacePath`, `isRepoCloned`, `convertToSshUrl`, `cloneRepo`, `ensureRepoWorkspace`).
- `adws/gitContext/__tests__/tokenResolver.test.ts` — veracity unit tests (new).
- `adws/gitContext/__tests__/bootstrapIdentity.test.ts` — remote/identity parsing unit tests (new).
- `adws/gitContext/__tests__/repoWorkspace.test.ts` — workspace path/clone/fetch unit tests (new).

### Relevant Documentation (from `.adw/conditional_docs.md`)
These conditional docs match this task and must be consulted during implementation:
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — Owns `adws/gitContext/**`, `adws/github/gitContextFactory.ts`; the base-path authority, per-command env chokepoint, two-context isolation, and `readLocalRepoInfo` chicken-and-egg note.
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — Owns `adws/core/launchGitContext.ts`; `buildLaunchGitContext`/`resolveLaunchToken`/`resolveLaunchGitIdentity`, the wrong-base-repo-on-takeover (vestmatic #187) class.
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — Owns `adws/checkGitGhGuard.ts` and `.github/workflows/git-cli-guard.yml`; ALLOWLIST categories (only `bootstrap`/`residual` remain), `scanFiles`, the `lint:git-guard` remedy.
- `app_docs/feature-tcewff-cron-gh-token-bleed-fix.md` — `activateGitHubAppAuth`/`ensureAppAuthForRepo`, `GH_TOKEN` pinned to wrong repo, "Remote owner X !== declared owner Y" — the bleed this veracity fix structurally closes.
- `app_docs/feature-kbzbn6-fix-git-repo-context.md` — `targetRepoManager.ts`, `getRepoInfo`, worktree/clone target-repo errors.
- `app_docs/feature-k817bh-persist-repo-identity-cross-check.md` — `RepoIdentityMismatchError`, "launch wins, persisted is cross-check only" — the adjacent foreign-identity detection mechanism.

## Implementation Plan

### Phase 1: Foundation — absorb pre-context primitives into the package
Create the four new package-private modules inside `adws/gitContext/` with injectable seams (no ADW-global imports). These are structurally exempt from the guard, so they may legitimately shell out to git/gh/curl. Each is independently unit-tested before any rewiring, so the package's public surface is proven correct before adapters depend on it.

### Phase 2: Core Implementation — veracious resolver + rewire the four bootstrap files
Replace the two token resolvers with one veracious `resolveContextToken`, then convert `launchGitContext.ts`, `gitContextFactory.ts`, `githubAppAuth.ts`, and `targetRepoManager.ts` into thin adapters/shims that call the absorbed primitives. Public import paths and exported symbols are preserved so the ~40 downstream call sites compile unchanged.

### Phase 3: Integration — empty the ALLOWLIST and prove the guarantee
Remove all four bootstrap entries from `checkGitGhGuard.ts`'s `ALLOWLIST`, run `lint:git-guard` to confirm zero violations, and run the full type-check + unit-test + build suite to confirm zero regressions, with the GitContext base-path and auth-isolation tests green.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Task 1 — Absorb the GitHub-App token mint into the package
- Create `adws/gitContext/appAuth.ts`. Move the mint internals from `adws/github/githubAppAuth.ts`: `ENV` constants, `CachedToken`, `tokenCache`, `installationIdCache`, `REFRESH_BUFFER_MS`, `isGitHubAppConfigured`, `createAppJWT`, `resolveInstallationId`, `fetchInstallationToken`, `getInstallationToken`.
- Keep the `curl`-based exchange unchanged (auth *acquisition* is out of scope per the PRD). Use the package logging convention or inject a `log` seam so the module stays ADW-global-free; do NOT import `adws/core/utils` into the package if it pulls ADW globals — pass `log` via an optional deps bag (default to `console.error`-style no-op-safe logger) consistent with the package's `ExecFn`/`FsDeps` idiom.
- Keep the file under 300 lines (coding guideline); the mint is ~120 lines so this is comfortable.

### Task 2 — Absorb the chicken-and-egg git reads into the package
- Create `adws/gitContext/bootstrapIdentity.ts`.
- Move `readLocalRepoInfo(cwd?)` from `gitContextFactory.ts` (HTTPS + SSH `git remote get-url origin` parsing → `{owner, repo}`). Export it.
- Add `resolveBootstrapGitIdentity(deps?)` that consolidates the two existing derivers (`deriveGitIdentity` in `gitContextFactory.ts:29` and `resolveLaunchGitIdentity` in `launchGitContext.ts:79`): resolution order **env (`GIT_AUTHOR_*`/`GIT_COMMITTER_*`) → App-slug bot identity → `git config user.name/email` → built-in `ADW Bot` default**. Never returns empty fields. Accept injectable seams (`exec`, `env`, `isAppConfigured`) for hermetic testing.
- Use the type `GitIdentity` from `./types`.

### Task 3 — Implement the single veracious token resolver
- Create `adws/gitContext/tokenResolver.ts` exporting `resolveContextToken(input)` where `input` carries `{ owner, repo, pat?, isAppConfigured: () => boolean, mintInstallationToken: (owner, repo) => string, ghAuthToken: () => string }` (all I/O injected — pure, hermetically testable).
- Logic (guard-clause style, max depth ~2 per coding guideline):
  - If `isAppConfigured()` → `return mintInstallationToken(owner, repo)` and let any throw propagate **loudly** (foreign/uninstalled identity = hard error). Do NOT catch-and-fallthrough.
  - Else if `pat?.trim()` → `return pat`.
  - Else `const t = ghAuthToken(); if (t.trim()) return t;`
  - Else `throw new Error(\`resolveContextToken: no veracious token for \${owner}/\${repo}\`)`.
- **Never** reference `process.env.GH_TOKEN`. Add a code comment citing issue #700 / PRD story 2 explaining why the ambient-global fallthrough is forbidden (it is the GH_TOKEN-bleed vector).

### Task 4 — Absorb clone/fetch/default-branch workspace management into the package
- Create `adws/gitContext/repoWorkspace.ts`. Move from `targetRepoManager.ts`: `getTargetRepoWorkspacePath(owner, repo, targetReposDir)` (inject `targetReposDir` — do NOT import `TARGET_REPOS_DIR` into the package), `isRepoCloned`, `convertToSshUrl`, `cloneRepo` (was `cloneTargetRepo`).
- Implement `ensureRepoWorkspace({ targetRepo, ctx | token, exec, fs, log })`: if not cloned → `cloneRepo` (SSH); else run `git fetch origin` and resolve the default branch under **per-command veracious auth** (reuse `GitContext.defaultBranch()` by accepting a `GitContext` and calling `ctx.defaultBranch()`, OR an injected `defaultBranch()` thunk that runs `gh repo view` with the bound token). This removes the ambient-auth `gh repo view` that crashed in `fetchLatestRefs`.
- Preserve return value (absolute workspace path) and the `log` messages so the shim is behavior-compatible. Keep `pullLatestDefaultBranch` as a deprecated alias in the shim (Task 8), not in the package.

### Task 5 — Export the new package surface
- Update `adws/gitContext/index.ts` to export what the ADW adapters need: `readLocalRepoInfo`, `resolveBootstrapGitIdentity`, `resolveContextToken`, `getInstallationToken`, `isGitHubAppConfigured`, `getTargetRepoWorkspacePath`, `isRepoCloned`, `convertToSshUrl`, `ensureRepoWorkspace`, and any new types. Keep the "no context-free git/gh free functions in the *public class* surface" spirit — these are explicitly the *bootstrap* exceptions, documented as such in the file header.

### Task 6 — Rewire `launchGitContext.ts` (drop the GH_TOKEN fallback)
- Replace `resolveLaunchToken(owner, repo)` body with a call to `resolveContextToken({ owner, repo, pat: GITHUB_PAT, isAppConfigured: isGitHubAppConfigured, mintInstallationToken: getInstallationToken, ghAuthToken: () => { try { return execViaPackage…} } })`. The `gh auth token` read must come from the package (e.g. expose a `ghAuthToken()` helper from `bootstrapIdentity.ts` or `appAuth.ts`) so **no raw `gh`/`git` string remains in this file**.
- Replace `resolveLaunchGitIdentity()` body with `resolveBootstrapGitIdentity()`.
- Switch the `getRepoInfo` default to package `readLocalRepoInfo` (the existing `getRepoInfo` from `../github/githubApi` itself now delegates to the package — verify no raw git/gh remains here).
- Remove the `import { execSync } from 'child_process'` and the `process.env.GH_TOKEN` fallback (current lines 67-68).
- Keep `buildLaunchGitContext`, `LaunchGitContextDeps`, and the exported `resolveLaunchToken`/`resolveLaunchGitIdentity` names intact (callers + feature-test deps in `features/per-issue/step_definitions/feature-660.steps.ts` and `feature-664.steps.ts` inject these).

### Task 7 — Rewire `gitContextFactory.ts` (veracious + no raw git/gh)
- Replace the local `resolveToken(owner, repo)` with a delegation to `resolveContextToken` (App → bound mint, throw loud; else PAT (`GITHUB_PAT`); else package `ghAuthToken()`; no `process.env.GH_TOKEN`).
- Replace `deriveGitIdentity` with `resolveBootstrapGitIdentity` (or re-export it).
- Replace `getSelfHostIdentity`'s `git remote get-url origin` with package `readLocalRepoInfo(REPO_ROOT)`; keep the self-host owner/repo cache + `clearSelfHostCache`.
- Replace the exported `readLocalRepoInfo` with a re-export from the package (keeps `githubApi.getRepoInfo`, `orchestratorLib`, `upgradeClaim`, `trigger_webhook`, `branchOperations`, `worktreeOperations`, `branchIdentityFallback`, `checkLivingDocsIndex` import paths valid).
- Keep `gitContextFor`/`gitContextForSync`/`gitContextForRepo` (they inject `REPO_ROOT`/`TARGET_REPOS_DIR`/`GITHUB_PAT`). Remove `import { execSync } from 'child_process'`. Confirm **zero** raw git/gh strings remain.

### Task 8 — Rewire `githubAppAuth.ts` (shim the mint, route the remote read)
- Re-export `getInstallationToken` and `isGitHubAppConfigured` from `../gitContext` (package `appAuth`) so the 7 consumers (`gitContextFactory`, `launchGitContext`, `workflowInit`, `prReviewPhase`, `reviewPhase`, `github/index`, plus `refreshTokenIfNeeded`/`activateGitHubAppAuth` internal uses) keep importing from `adws/github/githubAppAuth`.
- Keep `activateGitHubAppAuth(owner?, repo?, cwd?)` and `refreshTokenIfNeeded(owner?, repo?)` — they retain the **transitional** `process.env.GH_TOKEN`/`GIT_*` writes (out of scope to remove). Replace the inline `git remote get-url origin` (line 179) with package `readLocalRepoInfo(cwd)` to resolve owner/repo. Confirm **zero** raw git/gh strings remain (the `curl` mint moved to the package; curl is not flagged anyway, but it now lives in `appAuth.ts`).
- Keep `configureGitIdentity` (process.env writes for the transitional path) — it has no git/gh shell-out.

### Task 9 — Rewire `targetRepoManager.ts` (shim the workspace helpers)
- Re-export `getTargetRepoWorkspacePath`, `isRepoCloned`, `convertToSshUrl` from `../gitContext` (package `repoWorkspace`), binding `TARGET_REPOS_DIR` for the path helper at the shim boundary.
- Reimplement `ensureTargetRepoWorkspace(targetRepo)` as a thin wrapper that constructs/obtains the veracious-auth context (via `gitContextForRepo`/`buildLaunchGitContext` already available to callers, or by minting through the package resolver) and delegates to `ensureRepoWorkspace`. Preserve the signature and return type used by trigger_cron:228, trigger_webhook:173/237, workflowInit:215, prReviewPhase:89.
- Keep `fetchLatestRefs`/`pullLatestDefaultBranch` exports as deprecated aliases delegating to the package (preserve `adws/core/index.ts` barrel exports). Confirm **zero** raw git/gh strings remain.

### Task 10 — Empty the bootstrap ALLOWLIST
- In `adws/checkGitGhGuard.ts`, delete the four `ALLOWLIST` entries (lines 41-44), leaving `const ALLOWLIST: readonly string[] = [];`. Update the adjacent comment to record that the `bootstrap` category is now empty (primitives absorbed into the exempt `adws/gitContext/` package, per #700).
- Do not change the scanner logic, `EXEMPT_DIR_NAMES`, or `EXEMPT_PACKAGE_DIR`.

### Task 11 — Update / add unit tests
- **Existing must stay green:** `adws/gitContext/__tests__/gitContext.test.ts` (base-path selection, two-context isolation, `commandEnv` non-mutation), `adws/gitContext/__tests__/gitContextOperations.test.ts` (per-command env injection / `GH_TOKEN` from context token), `adws/core/__tests__/launchGitContext.test.ts` (target vs self-host base path; §5 token/identity plumbing). Update only the injected seams in `launchGitContext.test.ts` / any `gitContextFactory` test if the resolver delegation changes a dep shape; do not weaken assertions.
- **New `tokenResolver.test.ts`:** App-configured + installed → returns the bound mint; App-configured + foreign (mint throws) → **propagates the throw** (no fallback); App-not-configured + PAT → returns PAT; App-not-configured + no PAT + `gh auth token` → returns it; none available → throws; **asserts `process.env.GH_TOKEN` is never consulted** (set a sentinel `GH_TOKEN` in the test env and prove it is not returned).
- **New `bootstrapIdentity.test.ts`:** `readLocalRepoInfo` parses HTTPS and SSH remotes; throws on unparseable; `resolveBootstrapGitIdentity` honors env → App-slug → git-config → default precedence and never returns empty fields.
- **New `repoWorkspace.test.ts`:** `getTargetRepoWorkspacePath` composes `targetReposDir/owner/repo`; `convertToSshUrl` HTTPS→SSH and passthrough; `ensureRepoWorkspace` clones when absent / fetches + reads default branch when present (inject `exec`/`fs` spies; assert the default-branch read uses the injected bound-auth runner, not ambient).

### Task 12 — Run the Validation Commands
- Run every command in **Validation Commands** below. All must pass with zero errors and zero regressions; `lint:git-guard` must report `PASS  No direct git/gh shell-outs outside GitContext` with `0 allowlisted`.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, and the acceptance criteria explicitly require "GitContext base-path + auth-isolation tests green," so unit tests are in scope (vitest, per `.adw/commands.md`).

- **Token veracity (`tokenResolver.test.ts`, highest value):** drives the issue's core acceptance criterion. Prove the App-configured/foreign path throws rather than falling back, and that `process.env.GH_TOKEN` is structurally never read. Use injected `mintInstallationToken`/`ghAuthToken`/`isAppConfigured` seams — no real network or `gh`.
- **Bootstrap identity (`bootstrapIdentity.test.ts`):** remote-URL parsing (HTTPS/SSH/garbage) and identity-precedence resolution, with an injected `exec` spy.
- **Workspace management (`repoWorkspace.test.ts`):** path composition, SSH conversion, and the clone-vs-fetch branch with the default-branch read proven to run through the bound-auth runner (the `fetchLatestRefs` root fix).
- **Regression preservation:** the existing `gitContext.test.ts`, `gitContextOperations.test.ts`, and `launchGitContext.test.ts` suites must remain green unchanged in intent — base-path resolution per identity and per-command auth isolation (no `process.env` mutation) are the two properties the PRD says every past incident violated.

### Edge Cases
- App configured but **not installed** on the target `owner/repo` (foreign identity): `resolveContextToken` throws loudly; no wrong-repo token is returned. (Direct `fetchLatestRefs` crash-class fix.)
- App configured, mint **transiently fails** (network/curl error): throws loudly (we deliberately do not substitute PAT/ambient — veracity over availability).
- No App, no PAT, no `gh` login: throws a clear "no veracious token" error rather than silently producing an empty token.
- `git remote get-url origin` returns an **SSH** URL (`git@github.com:owner/repo.git`) vs **HTTPS**: both parse to the same `{owner, repo}`.
- Self-host context (no `--target-repo`): `readLocalRepoInfo(REPO_ROOT)` yields the framework owner/repo; base path resolves to the framework root (unchanged behavior).
- Target workspace **already cloned**: `ensureRepoWorkspace` fetches + reads default branch under bound auth; **not cloned**: clones via SSH first.
- `process.env.GH_TOKEN` holds a **stale/foreign** token at resolve time (set by a prior `activateGitHubAppAuth`): it must NOT leak into any context's token.
- `activateGitHubAppAuth`/`refreshTokenIfNeeded` transitional `process.env` writes still occur (retained) and must not break the `commandEnv` non-mutation tests (those assert the *GitContext* path, which is independent).

## Acceptance Criteria
- [ ] Bootstrap token-mint, identity/derivation, and clone/fetch/default-branch live inside `adws/gitContext/` (`appAuth.ts`, `bootstrapIdentity.ts`, `tokenResolver.ts`, `repoWorkspace.ts`), structurally exempt; the four former bootstrap files contain **zero** raw `git`/`gh` shell-out strings and run via the package / per-command veracious auth.
- [ ] A single veracious `resolveContextToken` replaces both `resolveToken` (gitContextFactory) and the `resolveLaunchToken` fallback chain; **neither reads `process.env.GH_TOKEN`**; an App-configured foreign/uninstalled identity **fails loudly** (throws) instead of returning an ambient token.
- [ ] All four entries are removed from `ALLOWLIST` in `adws/checkGitGhGuard.ts` (bootstrap category empty).
- [ ] `bun run lint:git-guard` exits 0 (`PASS`, 0 allowlisted).
- [ ] GitContext base-path tests (`gitContext.test.ts`) and auth-isolation tests (`gitContextOperations.test.ts`, `launchGitContext.test.ts` §5) are green; new veracity/bootstrap/workspace tests pass.
- [ ] `bunx tsc --noEmit` (root) and `bunx tsc --noEmit -p adws/tsconfig.json` pass — no broken imports across the ~40 downstream call sites.
- [ ] `bun run lint`, `bun run test:unit`, and `bun run build` pass with zero regressions.
- [ ] The transitional `process.env.GH_TOKEN` *writes* in `activateGitHubAppAuth`/`refreshTokenIfNeeded` remain (out of scope); only the token-source *reads* are removed.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint:git-guard` — **primary acceptance gate.** Must print `✔ PASS  No direct git/gh shell-outs outside GitContext.` and report `0 allowlisted`. Fails (exit 1) if any of the four rewired files still contain a raw git/gh string.
- `bunx tsc --noEmit` — root type-check; catches any broken import path from the absorption/shims.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws type-check (additional, per `.adw/commands.md`).
- `bun run test:unit` — full vitest suite; must include the green GitContext base-path + auth-isolation suites and the three new test files.
- `NODE_OPTIONS="--import tsx" bunx vitest run adws/gitContext adws/core/__tests__/launchGitContext.test.ts` — targeted run of the directly-affected suites (base-path, operations/auth-isolation, boundary constructor, and the three new files).
- `bun run lint` — eslint; confirm no unused imports left behind by the rewire (coding guideline: code hygiene).
- `bun run build` — confirm no build errors.

## Notes
- **Coding guidelines (`.adw/coding_guidelines.md`):** keep each new package module **under 300 lines** and single-responsibility; isolate side effects (exec/curl/fs) behind injectable seams (`ExecFn`/`FsDeps` idiom already in `types.ts`); use **guard clauses / max depth ~2** in `resolveContextToken`; prefer explicit types over `any`; remove unused imports after the rewire. The package must remain **ADW-global-free** (inject `REPO_ROOT`/`TARGET_REPOS_DIR`/`GITHUB_PAT` from the adapters) to preserve the PRD's standalone-reusability goal.
- **No new libraries.** Pure relocation + rewiring of existing code (`child_process`, `crypto`, `fs`, `typescript` already present). Library install command, if ever needed: `bun add <package>` (per `.adw/project.md`).
- **Why shims over mass repoint:** `gitContextForRepo` alone has ~30 call sites and `getInstallationToken`/workspace helpers another dozen. Re-export shims at the original paths keep the diff focused on the four files + new package modules and avoid a high-risk sweep; the guard passes because the shims hold no raw git/gh strings.
- **Out of scope (tracked elsewhere / by the PRD):** removing the transitional `process.env.GH_TOKEN` writes (subprocess-provisioning, a later slice); changing App-token *acquisition*; cross-host coordination; provider abstractions beyond GitHub. This slice changes only how a token is *resolved* and *where* bootstrap construction *lives*.
- **Dependency state:** Blocked-by #691–#699 are all merged (the guard's `residual` and `diagnostic` categories are already empty per the GitContext base-path-authority and git-gh-cli-guard conditional docs), so #700 is unblocked and is the epic capstone.
- **Documentation:** on completion, the document phase should fold the new package modules and the emptied-ALLOWLIST milestone into the existing `feature-oqb76h-gitcontext-base-path-authority.md` / `feature-bq1f45-git-gh-cli-guard.md` Owns/Conditions blocks rather than creating a fragmented new doc (memory: avoid app_docs regrowth).
```