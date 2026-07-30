# Bug: `readLocalRepoInfo` truncates repo names containing a dot — the upgrade gate can never pass for `paysdoc/paysdoc.nl`

## Metadata
issueNumber: `779`
adwId: `uds89n-readlocalrepoinfo-tr`
issueJson: `{"number":779,"title":"readLocalRepoInfo truncates repo names containing a dot — upgrade gate can never pass for paysdoc.nl","body":"# readLocalRepoInfo truncates repo names containing a dot — upgrade gate can never pass for paysdoc.nl\n\n## Symptom\n\nOn 2026-07-30 at 11:36Z, workflow run `a7tfo4-remove-secrets-store` (target repo `paysdoc/paysdoc.nl`) crashed in the upgrade gate while minting a GitHub App installation token:\n\n```\n📋 [2026-07-30T11:36:03.501Z] [a7tfo4-remove-secrets-store] Upgrade gate: hash mismatch — current=1e36648f… stored=null (never initialized)\nError: Command failed: curl -sf -H \"Authorization: Bearer <app JWT>\" … https://api.github.com/repos/paysdoc/paysdoc/installation\n    at resolveInstallationId (adws/gitContext/appAuth.ts:108)\n    at getInstallationToken (adws/gitContext/appAuth.ts:73)\n    at resolveContextToken (adws/gitContext/tokenResolver.ts:52)\n    at gitContextForRepo (adws/github/gitContextFactory.ts:111)\n    at buildDefaultUpgradeClaimDeps (adws/core/upgradeClaim.ts:174)\n```\n\nNote the URL: it queries the App installation for **`paysdoc/paysdoc`** — a repository that does not exist. The correct identity is `paysdoc/paysdoc.nl`. The immediate curl failure happened to be exit 56 (connection reset), but that is noise: with the wrong repo name the call 404s forever, so the upgrade claim can never mint a token and the upgrade gate can never pass for this repo.\n\n## Root cause\n\n`readLocalRepoInfo` (`adws/gitContext/bootstrapIdentity.ts`) parses owner/repo from the local clone's `origin` remote URL with:\n\n```ts\nconst httpsMatch = remoteUrl.match(/github\\.com\\/([^/]+)\\/([^/.]+)/);\nconst sshMatch = remoteUrl.match(/git@github\\.com:([^/]+)\\/([^/.]+)/);\n```\n\nThe repo capture group `([^/.]+)` was intended to strip a trailing `.git`, but it stops at the **first** dot. For `git@github.com:paysdoc/paysdoc.nl.git` it captures `paysdoc` instead of `paysdoc.nl`. Any GitHub repository with a dot in its name is mis-identified.\n\nBlast radius: every cwd-derived-identity path — the upgrade claim flow (`buildDefaultUpgradeClaimDeps`), `orchestratorLib`, and the `trigger_webhook.ts` self-host health check. The webhook event path is unaffected because it takes identity from the payload's `repository.full_name`.\n\nThe existing unit tests (`adws/gitContext/__tests__/bootstrapIdentity.test.ts`) only cover a dot-free repo name (`acme/webapp`), which is why this never surfaced.\n\n## Desired behavior\n\n- Parse the repo name as everything up to an optional trailing `.git`, not up to the first dot. E.g. for the SSH form: `/git@github\\.com:([^/]+)\\/(.+?)(?:\\.git)?$/` (and the equivalent for the HTTPS form, tolerating a trailing slash).\n- `readLocalRepoInfo('…paysdoc.nl clone…')` must return `{ owner: 'paysdoc', repo: 'paysdoc.nl' }` for both `git@github.com:paysdoc/paysdoc.nl.git` and `https://github.com/paysdoc/paysdoc.nl.git` remotes.\n- Add test cases for dotted repo names (with and without `.git` suffix, SSH and HTTPS) to `bootstrapIdentity.test.ts`. Note those tests currently duplicate the regexes inline — they should exercise the real parsing logic (extract the URL-parsing into a pure exported function so tests cannot drift from production code).\n\n## Relevant files\n\n- `adws/gitContext/bootstrapIdentity.ts` — `readLocalRepoInfo` URL parsing\n- `adws/gitContext/__tests__/bootstrapIdentity.test.ts` — add dotted-name cases, stop duplicating the regex inline\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-07-30T11:46:57Z","comments":[],"actionableComment":null}`

## Bug Description
`readLocalRepoInfo` — the single legitimate pre-context read of `git remote get-url origin`, and therefore the source of repository identity for every cwd-derived path in ADW — silently truncates any repository name that contains a dot.

Its repo capture group is `([^/.]+)`, a negated character class that excludes `/` **and** `.`. The `.` exclusion was there to strip the trailing `.git`, but a negated class stops at the *first* dot, not the last. So for the real remote of the `paysdoc/paysdoc.nl` clone:

```
remote : git@github.com:paysdoc/paysdoc.nl.git
parsed : { owner: 'paysdoc', repo: 'paysdoc' }     ← wrong
correct: { owner: 'paysdoc', repo: 'paysdoc.nl' }
```

**Expected behaviour:** `readLocalRepoInfo` on a `paysdoc.nl` clone returns `{ owner: 'paysdoc', repo: 'paysdoc.nl' }`, for all four remote forms (SSH and HTTPS, with and without the `.git` suffix).

**Actual behaviour:** it returns `{ owner: 'paysdoc', repo: 'paysdoc' }`. Downstream, `gitContextForRepo` builds a `GitContext` for a repository that does not exist, and `resolveContextToken` → `getInstallationToken` → `resolveInstallationId` curls `https://api.github.com/repos/paysdoc/paysdoc/installation`, which can only ever 404. The upgrade gate therefore **cannot** pass for this repo — it is a permanent, non-transient block, not a flaky network failure.

Verified live in this worktree against the real clone at `/Users/martin/projects/paysdoc/paysdoc.nl`:

```
readLocalRepoInfo -> {"owner":"paysdoc","repo":"paysdoc"}
installation URL  -> https://api.github.com/repos/paysdoc/paysdoc/installation
```

That URL is byte-for-byte the one in the issue's stack trace, which confirms the diagnosis end-to-end. The incident's clone carries the **SSH** remote form (`git@github.com:paysdoc/paysdoc.nl.git`), so the `sshMatch` branch is the one that fired — though both branches truncate identically.

The same defective repo capture group `([^/.]+)` is duplicated in **three** production places (verified by grep, all four hits below):

| Location | Function | Behaviour on `paysdoc.nl` |
|---|---|---|
| `adws/gitContext/bootstrapIdentity.ts:41-42` | `readLocalRepoInfo` | truncates → `paysdoc/paysdoc` (**the incident**) |
| `adws/github/githubApi.ts:27-28` | `getRepoInfoFromUrl` | truncates → `paysdoc/paysdoc` |
| `adws/gitContext/repoWorkspace.ts:62` | `convertToSshUrl` | anchored with `$`, so it does not match at all → returns the HTTPS URL **unchanged**, silently skipping the HTTPS→SSH conversion |
| `adws/gitContext/__tests__/bootstrapIdentity.test.ts:15-46` | (test copies) | reproduces the bug inside the test, so the test passes |

A **second symptom** of the same defect, surfaced by the acceptance contract (`features/per-issue/feature-779.feature` §2) and not mentioned in the issue: `([^/.]+)` requires at least one non-dot character immediately after the slash, so a name that *starts* with a dot does not truncate — it fails to match at all and `readLocalRepoInfo` **throws**. Verified: `git@github.com:paysdoc/.github.git` (the GitHub org-profile repo shape) → `NO MATCH`, whereas `git@github.com:paysdoc/a.b.c.git` → `paysdoc/a` and `https://github.com/paysdoc/paysdoc.nl/` → `paysdoc/paysdoc`.

## Problem Statement
GitHub URL owner/repo parsing is duplicated across three production sites, each carrying the same wrong repo capture group `([^/.]+)`. Because a negated character class stops at the first dot, every dotted repository name is mis-parsed. The primary consequence is that repository identity for `paysdoc/paysdoc.nl` is wrong at the bootstrap boundary, which poisons everything derived from it:

1. **Token minting fails permanently** — `resolveInstallationId` queries the App installation for a non-existent repo (the reported crash).
2. **`GitContext.basePath` would be wrong even with a valid token** — `resolveBasePath` (`adws/gitContext/gitContext.ts:90-92`) is `path.join(targetReposDir, owner, repo)`, so a truncated identity resolves to `…/paysdoc/paysdoc` instead of `…/paysdoc/paysdoc.nl`. This is a latent second failure, masked today by the token crash happening first — and it is exactly the wrong-base-repo class the GitContext PRD exists to eliminate.
3. **`convertToSshUrl` silently no-ops** for dotted repos, so a fresh `ensureRepoWorkspace` clone of such a repo runs over HTTPS instead of SSH.

The fourth copy lives in the test file, which is why nothing failed: the tests re-declare the buggy regexes inline (`bootstrapIdentity.test.ts:15-46`) instead of calling the production code, so they assert that the bug behaves as written.

## Solution Statement
Extract the URL parsing into **one pure exported function** and route all three production sites through it. This fixes the reported crash and removes the drift that let it hide.

1. **Add `parseGitHubRemoteUrl(remoteUrl: string): RepoInfo | null`** to `adws/gitContext/bootstrapIdentity.ts`, backed by two module-level named regexes:
   - `HTTPS_REMOTE_RE = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/` — covers `https://…`, credential-bearing `https://x-access-token:…@github.com/…`, and `ssh://git@github.com/…`; tolerates a trailing slash.
   - `SSH_REMOTE_RE = /git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/` — the SCP-style form.

   The two changes that matter: the repo group becomes **lazy** (`+?`) and the pattern is **anchored at the end** (`$`). Together they make `(?:\.git)?` strip only a *trailing* `.git` while dots inside the name are kept — including a *leading* dot (`.github`), which the current class cannot match at all. `[^/]+?` (not the issue's suggested `.+?`) keeps the guarantee that a repo name can never swallow a `/`, and the `\/?$` tail is what stops the trailing-slash form from yielding `webapp/`.

   Returns `null` rather than throwing, so each caller keeps its own error contract.

   **Verified against every row of the acceptance contract before this plan was written** — all 17 `Examples` rows across `feature-779.feature` §1/§2/§3/§6 resolve correctly under these two regexes (dotted names in full, dot-free names unchanged, GitLab/Bitbucket still `null`). See Step 5 for the command that re-proves it.

2. **`readLocalRepoInfo` delegates** to it, preserving its exact signature, its `Failed to get repo info: …` wrapper, and its `Could not parse GitHub URL: …` message.

3. **`getRepoInfoFromUrl`** (`adws/github/githubApi.ts`) delegates to it — same signature, same thrown message. It has zero internal callers today but is public API via `adws/github/index.ts`, so it must not keep a divergent parser.

4. **`convertToSshUrl`** (`adws/gitContext/repoWorkspace.ts`) delegates to it behind an `https://github.com/` prefix guard, preserving its "return non-GitHub / already-SSH URLs unchanged" contract while now converting dotted names correctly.

5. **Tests stop duplicating the regexes.** The `readLocalRepoInfo — URL parsing` block in `bootstrapIdentity.test.ts` is rewritten to drive the real `parseGitHubRemoteUrl`, extended with dotted cases (SSH × HTTPS × with/without `.git`). A real-git temp-repo test drives the actual `readLocalRepoInfo` against a dotted `origin` remote — the end-to-end RED proof of the reported crash. `repoWorkspace.test.ts` gains dotted-name cases for `convertToSshUrl`.

Deliberately **not** changed: `readLocalRepoInfo`'s signature (adding a deps seam would touch the `checkGitGhGuard` cwd-derived-identity rule for no benefit — the extracted pure function is what makes it testable), the `execSync` call itself, and every consumer of `RepoInfo`. This is a parsing fix, not a plumbing change.

## Steps to Reproduce
The bug reproduces against a real dotted-name clone already present on this machine (`/Users/martin/projects/paysdoc/paysdoc.nl`, whose `origin` is `git@github.com:paysdoc/paysdoc.nl.git`). No network, no credentials, no GitHub App needed.

1. From the repo root, write a scratch script `repro779.ts`:
   ```ts
   import { readLocalRepoInfo } from './adws/gitContext/bootstrapIdentity';
   const info = readLocalRepoInfo('/Users/martin/projects/paysdoc/paysdoc.nl');
   console.log('readLocalRepoInfo ->', JSON.stringify(info));
   console.log('installation URL  ->', `https://api.github.com/repos/${info.owner}/${info.repo}/installation`);
   ```
2. Run `NODE_OPTIONS="--import tsx" bunx tsx repro779.ts`.
3. Observe (actual output, captured during planning):
   ```
   readLocalRepoInfo -> {"owner":"paysdoc","repo":"paysdoc"}
   installation URL  -> https://api.github.com/repos/paysdoc/paysdoc/installation
   ```
   The composed URL is exactly the one in the issue's stack trace. `paysdoc/paysdoc` does not exist, so `resolveInstallationId` can only 404 (or, as on 2026-07-30, surface whatever transport error `curl -sf` hits first — exit 56 was noise).
4. Delete the scratch file.

Repository-independent reproduction (no dotted clone needed) — the same script with any temp repo works:
```bash
TMP=$(mktemp -d) && git -C "$TMP" init -q && \
  git -C "$TMP" remote add origin git@github.com:paysdoc/paysdoc.nl.git && \
  echo "$TMP"
```
then point step 1's path at `$TMP`. Same truncated output. This is the exact shape of the new automated regression test in Step 4.

After the fix, both forms of the reproduction print `{"owner":"paysdoc","repo":"paysdoc.nl"}` and `https://api.github.com/repos/paysdoc/paysdoc.nl/installation`.

## Root Cause Analysis
**A negated character class used as a suffix stripper, copy-pasted three times, with tests that copied the bug instead of calling the code.**

1. **The parsing defect.** `([^/.]+)` means "one or more characters that are neither `/` nor `.`". The intent was "the repo name, minus a trailing `.git`". Those coincide only when the repo name itself has no dot. For `paysdoc/paysdoc.nl.git` the class stops at the first dot and yields `paysdoc`. The correct construction is a lazy group plus an end anchor — `([^/]+?)(?:\.git)?$` — which forces the optional `\.git` to consume the *last* `.git` rather than letting the repo group stop at the first dot. Confirmed by direct execution over ten URL forms during planning:

   | remote | current | fixed |
   |---|---|---|
   | `git@github.com:paysdoc/paysdoc.nl.git` | `paysdoc/paysdoc` | `paysdoc/paysdoc.nl` |
   | `https://github.com/paysdoc/paysdoc.nl.git` | `paysdoc/paysdoc` | `paysdoc/paysdoc.nl` |
   | `git@github.com:paysdoc/paysdoc.nl` | `paysdoc/paysdoc` | `paysdoc/paysdoc.nl` |
   | `https://github.com/paysdoc/paysdoc.nl` | `paysdoc/paysdoc` | `paysdoc/paysdoc.nl` |
   | `ssh://git@github.com/paysdoc/paysdoc.nl.git` | `paysdoc/paysdoc` | `paysdoc/paysdoc.nl` |
   | `https://x-access-token:TOK@github.com/paysdoc/paysdoc.nl.git` | `paysdoc/paysdoc` | `paysdoc/paysdoc.nl` |
   | `https://github.com/acme/webapp.git` | `acme/webapp` | `acme/webapp` (unchanged) |
   | `git@github.com:acme/webapp.git` | `acme/webapp` | `acme/webapp` (unchanged) |
   | `https://github.com/acme/webapp/` | `acme/webapp` | `acme/webapp` (unchanged) |
   | `https://gitlab.com/acme/webapp.git` | `NO MATCH` | `NO MATCH` (unchanged) |
   | `git@github.com:paysdoc/a.b.c.git` | `paysdoc/a` | `paysdoc/a.b.c` |
   | `git@github.com:paysdoc/paysdoc.github.io.git` | `paysdoc/paysdoc` | `paysdoc/paysdoc.github.io` |
   | `https://github.com/paysdoc/paysdoc.nl/` | `paysdoc/paysdoc` | `paysdoc/paysdoc.nl` |
   | `git@github.com:paysdoc/.github.git` | `NO MATCH` (throws) | `paysdoc/.github` |
   | `git@bitbucket.org:acme/webapp.git` | `NO MATCH` | `NO MATCH` (unchanged) |

2. **Why it reached the App-token call.** `buildDefaultUpgradeClaimDeps` (`adws/core/upgradeClaim.ts:173`) is `gitContextForRepo(readLocalRepoInfo(baseRepoPath))` — a cwd-derived identity that the `checkGitGhGuard` cwd-derived-identity rule explicitly permits when argument-bearing. `gitContextForRepo` (`gitContextFactory.ts:109-111`) immediately calls `resolveToken(owner, repo)`, which for an App-configured install routes to `resolveContextToken` → `getInstallationToken` → `resolveInstallationId`, whose curl interpolates the owner/repo straight into the URL. There is no validation step between the parse and the network call, so a truncated name becomes a 404 loop with no diagnostic naming the parse.

3. **Why it was invisible.** `bootstrapIdentity.test.ts` (lines 9-50) does not import `readLocalRepoInfo` at all. Each test re-declares the two regexes inline and asserts against `match[1]`/`match[2]`. Its own comment states the reason: *"readLocalRepoInfo uses execSync directly with no seam, so we test the underlying URL parsing logic via the same regex patterns it applies."* That is a copy of the implementation, not a test of it — so the suite is structurally incapable of failing on this bug, and it would keep passing even if `readLocalRepoInfo` were deleted. Compounding it, every fixture used a dot-free name (`acme/webapp`, `octo/infra`), so no case exercised the defect.

4. **Why three copies exist.** The identical regex pair predates the #700 consolidation that absorbed the bootstrap primitives into `adws/gitContext/`. `getRepoInfo` was already collapsed to a delegate (`githubApi.ts:19-21` → `readLocalRepoInfo`), which is why fixing `readLocalRepoInfo` also fixes `getRepoInfo` and its guard-recognised call sites for free. `getRepoInfoFromUrl` and `convertToSshUrl` were never folded in and kept private copies. A single pure parser is the structural fix: after this change there is exactly one regex definition in the codebase, and the tests point at it.

5. **`convertToSshUrl`'s variant failure mode is worth naming.** Its regex is fully anchored (`^https:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$`), so a dotted name does not truncate — it fails to match, and the function returns the input unchanged (verified: `convertToSshUrl('https://github.com/paysdoc/paysdoc.nl.git')` returns the HTTPS URL verbatim). Since `cloneUrl` is built as `https://github.com/${fullName}.git` (`adws/core/orchestratorCli.ts:176`), a first-time `ensureRepoWorkspace` of a dotted target repo clones over HTTPS instead of SSH. Same root cause, different symptom, one shared fix.

## Relevant Files
Use these files to fix the bug:

- `adws/gitContext/bootstrapIdentity.ts` — **primary edit.** Holds `readLocalRepoInfo` (lines 38-51) with the defective regex pair at lines 41-42, and the `RepoInfo` interface (lines 18-21). Gains the new pure `parseGitHubRemoteUrl` plus the two named regex constants. The file is guard-exempt by directory (`EXEMPT_PACKAGE_DIR = 'adws/gitContext'`), so its raw `git remote get-url origin` string stays legal. 129 lines today — comfortably inside the 300-line guideline after the addition.
- `adws/gitContext/index.ts` — **edit.** Line 22 already exports `readLocalRepoInfo`/`ghAuthToken`/`resolveBootstrapGitIdentity` from `./bootstrapIdentity`; add `parseGitHubRemoteUrl` to that export so `adws/github/githubApi.ts` can import it from the package surface rather than reaching into a module. `RepoInfo` is already re-exported as `BootstrapRepoInfo` (line 23) — leave that alias alone.
- `adws/github/githubApi.ts` — **edit.** `getRepoInfoFromUrl` (lines 26-36) is duplicate #2; replace its two inline regexes with a delegate call, keeping the signature and the `Could not parse GitHub URL: ${repoUrl}` message. Note line 19-21: `getRepoInfo` is *already* a thin delegate to `readLocalRepoInfo`, so it needs no edit — it inherits the fix. Do not touch `getRepoInfoFromPayload` (lines 41-47): it splits `owner/repo` on `/` and is already dot-safe, which is why the webhook event path never had this bug.
- `adws/gitContext/repoWorkspace.ts` — **edit.** `convertToSshUrl` (lines 61-67) is duplicate #3; replace its anchored regex with a prefix guard plus a delegate call. Its consumer `cloneRepo` (line 87) is unchanged. Must keep returning already-SSH and non-GitHub URLs byte-identical (pinned by existing tests at `repoWorkspace.test.ts:45-53`).
- `adws/gitContext/__tests__/bootstrapIdentity.test.ts` — **edit.** Lines 9-50 are the four inline-regex tests that made the bug invisible; rewrite them to call `parseGitHubRemoteUrl` and add the dotted cases. Lines 52-126 (`resolveBootstrapGitIdentity`) are unrelated and must stay untouched and green.
- `adws/gitContext/__tests__/repoWorkspace.test.ts` — **edit.** Add dotted-name cases to the `convertToSshUrl` describe block (lines 34-54). The four existing cases must stay green verbatim.
- `adws/gitContext/gitContext.ts` — **read-only.** `resolveBasePath` (lines 88-92) is `path.join(targetReposDir, owner, repo)` for non-self-host contexts; this is the evidence that a truncated identity also yields a wrong `basePath`. No change — it is correct given correct inputs.
- `adws/gitContext/appAuth.ts` — **read-only.** `resolveInstallationId` (line 103+) interpolates `${owner}/${repo}` into the installation URL with no validation. This is where the reported crash surfaces; it needs no change once identity is right. Confirms the diagnosis but is not a fix site.
- `adws/github/gitContextFactory.ts` — **read-only.** Line 82 re-exports `readLocalRepoInfo` for downstream importers; lines 58-67 cache the self-host identity from `readLocalRepoInfo(REPO_ROOT)`; line 109-111 is `gitContextForRepo`, the frame in the stack trace. All three inherit the fix with no edit. Worth noting: `getSelfHostIdentity` would also mis-identify the framework repo if *it* ever had a dotted name — fixed by the same change.
- `adws/core/upgradeClaim.ts` — **read-only.** Line 173, `buildDefaultUpgradeClaimDeps`, is the crash's entry frame (`gitContextForRepo(readLocalRepoInfo(baseRepoPath))`). Unchanged — it is a legal argument-bearing cwd read and correct once the parse is.
- `adws/core/orchestratorLib.ts` (line 35), `adws/triggers/trigger_webhook.ts` (line 93), `adws/healthCheck.tsx` (line 112), `adws/checkLivingDocsIndex.ts` (line 52) — **read-only.** The other `readLocalRepoInfo` consumers named in the issue's blast radius. All inherit the fix; none needs an edit. Listed so the implementer can confirm no call site changes.
- `adws/core/orchestratorCli.ts` — **read-only.** Line 176 builds `cloneUrl = https://github.com/${fullName}.git`, proving the URLs fed to `convertToSshUrl` are always clone-URL shaped (never a `github.com/o/r/tree/main` web URL), which is what makes the new `$` anchor safe.
- `adws/checkGitGhGuard.ts` — **read-only.** `CWD_DERIVED_IDENTITY_FNS` (line 52) is `{getRepoInfo, readLocalRepoInfo}`. The new `parseGitHubRemoteUrl` is a pure string function and must **not** be added to that set — it performs no cwd read. Keeping `readLocalRepoInfo`'s signature unchanged means the guard's zero-argument-call detection is unaffected.
- `adws/core/__tests__/upgradeClaim.integration.test.ts` — **read-only, pattern reference.** Lines 15-45 show the established real-git temp-repo test idiom in this codebase (`os.tmpdir` + `mkdtemp` + `execSync` git with injected `GIT_AUTHOR_*`), which Step 4's end-to-end test follows.
- `vitest.config.ts` — **read-only.** `include: ['adws/**/__tests__/**/*.test.ts', …]`, so both edited test files are already collected. No config change.
- `.adw/commands.md` — no change; source of the exact validation commands (`bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run build`, `bun run test:unit`).
- `.adw/coding_guidelines.md` — no change; the fix must follow it (purity, clarity over cleverness, guard clauses, no `any`, JSDoc on non-obvious logic).
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — **read first, reference only.** `.adw/conditional_docs.md` lists `adws/gitContext/**`, `adws/gitContext/__tests__/**`, `adws/github/gitContextFactory.ts`, `adws/core/upgradeClaim.ts`, and `adws/core/orchestratorLib.ts` under this doc's `Owns:` block, and its conditions name `readLocalRepoInfo` as *"the bootstrap boundary for reading `git remote get-url origin` before a `GitContext` can be constructed — the only legitimate permanent exception"* and `resolveBasePath`/`worktreePathFor` base-path authority. Read it to confirm the fix does not disturb the bootstrap-boundary contract; it needs no edit (the boundary is unchanged, only its parser is corrected).
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — **read first, reference only.** Owns `adws/checkGitGhGuard.ts`. Conditions match on the `cwd-derived-identity` rule and on `EXEMPT_PACKAGE_DIR`. Read it to confirm that adding a pure function to `adws/gitContext/` and leaving `readLocalRepoInfo`'s signature alone keeps `bun run lint:git-guard` green.
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — **reference only.** Covers `buildLaunchGitContext` / `resolveLaunchGitIdentity`, whose `deps.getRepoInfo` defaults to `getRepoInfo` (`adws/core/launchGitContext.ts:81`) and therefore inherits the fix at every launch boundary. No edit.
- `features/per-issue/feature-779.feature` — **the acceptance contract, already authored** (tagged `@adw-779 @adw-uds89n-readlocalrepoinfo-tr`). Seven sections, 17 `Examples` rows in total, every one of which the regexes in Step 2 satisfy (verified during planning): **§1** the four canonical `paysdoc.nl` forms (SSH/HTTPS × with/without `.git`) → `paysdoc/paysdoc.nl`; **§2** the rest of the dotted family — multi-dot `a.b.c`, GitHub-Pages `paysdoc.github.io`, HTTPS-with-trailing-slash, and **leading-dot `.github`** (beyond the issue's list — see the Root Cause second-symptom note); **§3** seven dot-free no-regression rows including SSH-without-`.git`, trailing slash, the `x-access-token:` App-push form, and the `ssh://` scheme form; **§4** `getRepoInfo` and `readLocalRepoInfo` must agree on the dotted clone (this is what forces the shared parse rather than a one-call-site patch); **§5** the recorded App installation-token mint targets `paysdoc/paysdoc.nl` and never `paysdoc/paysdoc`; **§6** GitLab **and Bitbucket** remotes still raise rather than fabricate an identity; **§7** type-check. The scenarios assert only **returned values, recorded collaborator arguments, and raised errors** over temp-repo fixtures the steps build — they deliberately do *not* pin the extracted function's name, signature, or any regex text, so the Step 2 design is free as long as the behaviour holds.
- `features/per-issue/step_definitions/` — the step definitions for `feature-779.feature` do not exist yet; the `generate_step_definitions` phase authors them. The feature's docstring specifies the drive: a real throwaway git repo per scenario (`git init` + `git remote add origin <url>`, both purely local), the real `readLocalRepoInfo(tempDir)` / `getRepoInfo(tempDir)` as the system under test, and for §5 the real `resolveContextToken` composed with `isAppConfigured: () => true` plus a **recording** `mintInstallationToken`.
- `adws/gitContext/tokenResolver.ts` — **read-only, and confirms §5 needs no production change.** `ResolveContextTokenInput` (lines 17-26) already exposes `isAppConfigured` and `mintInstallationToken` as injectable seams, and `resolveContextToken` (line 46-53) hands `(owner, repo)` straight to the mint. So §5 is drivable in-process today by composing the real functions — no new seam, no signature change.

### New Files
None. Every change lands in the five existing files listed above. No new library is required.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Read the governing docs and confirm the baseline
- Read `README.md` (project overview) and `.adw/coding_guidelines.md`.
- Read `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` and `app_docs/feature-bq1f45-git-gh-cli-guard.md` (both matched via `.adw/conditional_docs.md`; both exist in this worktree).
- Capture the pre-change baseline: `bun run test:unit` → **139 test files / 2408 tests passing**. Every later count is measured against this.
- Confirm the worktree is clean (`git status --porcelain` empty). A working-tree-only out-of-scope revert of `.claude/commands/adw_init.md` was found and discarded during planning — see Notes. Do not re-introduce it.

### 2. Add the pure parser to `adws/gitContext/bootstrapIdentity.ts`
- Directly under the `RepoInfo` interface (before `readLocalRepoInfo`), add two module-level regex constants with a short JSDoc each explaining the lazy-group + end-anchor construction:
  ```ts
  /**
   * HTTPS-style GitHub remote: `https://github.com/owner/repo[.git][/]`.
   * Also matches credential-bearing (`https://x-access-token:…@github.com/…`)
   * and `ssh://git@github.com/…` forms.
   *
   * The repo group is lazy and the pattern is end-anchored so the optional
   * `.git` strips a *trailing* suffix only — a greedy or dot-excluding group
   * would truncate dotted names such as `paysdoc.nl` (issue #779).
   */
  const HTTPS_REMOTE_RE = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

  /** SCP-style SSH GitHub remote: `git@github.com:owner/repo[.git]`. */
  const SSH_REMOTE_RE = /git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/;
  ```
- Add the pure exported parser next to them:
  ```ts
  /**
   * Parses `{ owner, repo }` out of a GitHub remote URL (HTTPS or SSH).
   * Returns null when the URL is not a parseable GitHub remote, leaving the
   * error contract to each caller.
   *
   * Pure — the single source of truth for GitHub remote-URL parsing.
   */
  export function parseGitHubRemoteUrl(remoteUrl: string): RepoInfo | null {
    const url = remoteUrl.trim();
    const match = url.match(HTTPS_REMOTE_RE) ?? url.match(SSH_REMOTE_RE);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  }
  ```
- Keep the HTTPS-first / SSH-second precedence of the current code (the two forms are mutually exclusive — `github.com/` vs `github.com:` — so order is not load-bearing, but preserving it keeps the diff honest).
- Use `[^/]+?`, **not** the issue's suggested `.+?`: it is equally correct for every remote form and additionally guarantees a repo name can never span a `/`.
- Rewrite `readLocalRepoInfo`'s body to delegate, preserving both error messages verbatim:
  ```ts
  export function readLocalRepoInfo(cwd?: string): RepoInfo {
    try {
      const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8', cwd }).trim();
      const info = parseGitHubRemoteUrl(remoteUrl);
      if (!info) {
        throw new Error(`Could not parse GitHub URL: ${remoteUrl}`);
      }
      return info;
    } catch (error) {
      throw new Error(`Failed to get repo info: ${error}`);
    }
  }
  ```
- Do **not** change `readLocalRepoInfo`'s signature, add a deps/exec seam, or move it out of the file — its zero-vs-argument-bearing call shape is what `checkGitGhGuard`'s cwd-derived-identity rule inspects.

### 3. Export the parser and route the two remaining duplicates through it
- `adws/gitContext/index.ts`: add `parseGitHubRemoteUrl` to the existing `export { … } from './bootstrapIdentity';` on line 22. Leave the `BootstrapRepoInfo` type alias as-is.
- `adws/github/githubApi.ts`: add `parseGitHubRemoteUrl` to the import on line 5 (import it from `'../gitContext'`, matching how `gitContextFactory.ts` consumes package primitives — `githubApi.ts` currently imports from `./gitContextFactory`, so add a second import from `'../gitContext'` rather than widening the factory's re-export surface). Rewrite `getRepoInfoFromUrl` to:
  ```ts
  export function getRepoInfoFromUrl(repoUrl: string): RepoInfo {
    const info = parseGitHubRemoteUrl(repoUrl);
    if (!info) {
      throw new Error(`Could not parse GitHub URL: ${repoUrl}`);
    }
    return info;
  }
  ```
  Keep the exported name, signature, JSDoc intent, and thrown message. Delete both inline regexes. Do not touch `getRepoInfo` (already a delegate) or `getRepoInfoFromPayload` (already dot-safe).
- `adws/gitContext/repoWorkspace.ts`: import `parseGitHubRemoteUrl` from `'./bootstrapIdentity'` (sibling module in the same package — no cycle: `bootstrapIdentity` imports only `child_process` and `./types`). Rewrite `convertToSshUrl` with a guard clause:
  ```ts
  export function convertToSshUrl(cloneUrl: string): string {
    if (!cloneUrl.startsWith('https://github.com/')) return cloneUrl;
    const info = parseGitHubRemoteUrl(cloneUrl);
    if (!info) return cloneUrl;
    return `git@github.com:${info.owner}/${info.repo}.git`;
  }
  ```
  The prefix guard preserves the existing contract exactly: already-SSH URLs and non-GitHub URLs are returned unchanged, and only HTTPS GitHub URLs are converted.
- Grep to prove the duplication is gone: `grep -rn "\[\^/\.\]+" adws/` must return **zero** hits, and `grep -rn "github\\\\.com" adws/ --include="*.ts" | grep -v __tests__` must show the two regexes only in `bootstrapIdentity.ts`.

### 4. Rewrite the drifted tests and add the dotted-name coverage
In `adws/gitContext/__tests__/bootstrapIdentity.test.ts`:
- Import `parseGitHubRemoteUrl` and `readLocalRepoInfo` from `../bootstrapIdentity` (alongside the existing `resolveBootstrapGitIdentity` import).
- **Replace** the whole `readLocalRepoInfo — URL parsing` describe block (lines 9-50) — delete every inline regex and its explanatory comment. The replacement block, named e.g. `parseGitHubRemoteUrl`, calls the real function and asserts on `{ owner, repo }`:
  - Dot-free regression cases, preserving the current expectations: `https://github.com/acme/webapp.git` and `git@github.com:acme/webapp.git` → `acme/webapp`; HTTPS and SSH agree for `octo/infra`; a non-GitHub URL (`https://gitlab.com/acme/webapp.git`) → `null`.
  - **Dotted cases (the bug — RED before Step 2):** all four of
    `git@github.com:paysdoc/paysdoc.nl.git`, `git@github.com:paysdoc/paysdoc.nl`,
    `https://github.com/paysdoc/paysdoc.nl.git`, `https://github.com/paysdoc/paysdoc.nl`
    → `{ owner: 'paysdoc', repo: 'paysdoc.nl' }`. A table-driven `it.each` over the four keeps this compact and declarative.
  - **The rest of the dotted family (`feature-779.feature` §2, beyond the issue's list — also RED today):** multi-dot `git@github.com:paysdoc/a.b.c.git` → `a.b.c`; GitHub-Pages `git@github.com:paysdoc/paysdoc.github.io.git` → `paysdoc.github.io`; dotted-with-trailing-slash `https://github.com/paysdoc/paysdoc.nl/` → `paysdoc.nl`; and **leading-dot `git@github.com:paysdoc/.github.git` → `.github`**, which fails today by *throwing* rather than truncating (see Root Cause). This last row is what discriminates a real fix from a `split('.')[0]`-shaped one.
  - Suffix-stripping edge case: a name that legitimately ends in `.git` (`https://github.com/paysdoc/repo.git.git` → `repo.git`), pinning that only the *trailing* `.git` is stripped.
  - Tolerated forms (`feature-779.feature` §3 — GREEN today, must stay GREEN): dot-free SSH **without** the `.git` suffix (`git@github.com:acme/webapp` → `acme/webapp`), trailing slash (`https://github.com/acme/webapp/` → `acme/webapp`), `ssh://` long form (`ssh://git@github.com/acme/webapp.git` → `acme/webapp`), and the credential-bearing App-push form (`https://x-access-token:TOK@github.com/acme/webapp.git` → `acme/webapp`).
  - Rejections stay rejections: `https://gitlab.com/acme/webapp.git` **and** `git@bitbucket.org:acme/webapp.git` → `null` (both are `feature-779.feature` §6 rows; the Bitbucket SSH form must not be caught by the SSH pattern).
- **Add an end-to-end `readLocalRepoInfo` describe block** — the direct proof of the reported crash, following the real-git idiom of `adws/core/__tests__/upgradeClaim.integration.test.ts`:
  - `beforeEach`: `fs.mkdtempSync(path.join(os.tmpdir(), 'adw-779-'))`, then `execSync('git init -q', { cwd })` and `execSync('git remote add origin git@github.com:paysdoc/paysdoc.nl.git', { cwd })`. No network, no commits, no credentials.
  - `afterEach`: `fs.rmSync(dir, { recursive: true, force: true })`.
  - Assert `readLocalRepoInfo(dir)` deep-equals `{ owner: 'paysdoc', repo: 'paysdoc.nl' }`. Add a second case that rewrites the remote to the HTTPS form (`git remote set-url origin https://github.com/paysdoc/paysdoc.nl.git`) and asserts the same result.
  - Add a case asserting `getRepoInfo(dir)` (imported from `../../github/githubApi`) deep-equals the same object — the unit-level twin of `feature-779.feature` §4, proving both cwd-derived entry points share one parse.
  - Add a guard case: a temp repo with a non-GitHub remote makes `readLocalRepoInfo` throw with a message containing `Failed to get repo info`, pinning the preserved error contract (`feature-779.feature` §6).
  - Raw `git` strings in this file are legal — it is inside the structurally-exempt `adws/gitContext/` package (and `__tests__` content is not a guard target anyway).
- Leave the `resolveBootstrapGitIdentity` describe block (current lines 52-126) completely untouched.

In `adws/gitContext/__tests__/repoWorkspace.test.ts`:
- Keep the four existing `convertToSshUrl` cases verbatim (dot-free conversion, `.git` suffix, already-SSH passthrough, non-GitHub passthrough).
- Add: `convertToSshUrl('https://github.com/paysdoc/paysdoc.nl.git')` → `'git@github.com:paysdoc/paysdoc.nl.git'` and `convertToSshUrl('https://github.com/paysdoc/paysdoc.nl')` → `'git@github.com:paysdoc/paysdoc.nl.git'` (both RED before Step 3 — today they return the input unchanged).

Follow `.adw/coding_guidelines.md` throughout: no `any`, no decorators, explicit assertions, table-driven cases over copy-pasted blocks.

### 5. Confirm RED → GREEN
- With Steps 2-3 temporarily reverted (e.g. `git stash push -- adws/gitContext/bootstrapIdentity.ts adws/gitContext/repoWorkspace.ts adws/gitContext/index.ts adws/github/githubApi.ts`) but the Step 4 tests in place, run:
  `bunx vitest run adws/gitContext/__tests__/bootstrapIdentity.test.ts adws/gitContext/__tests__/repoWorkspace.test.ts`
  and confirm the dotted cases **fail** — the parser cases and the temp-repo `readLocalRepoInfo` cases reporting `repo: 'paysdoc'`, and the two `convertToSshUrl` cases returning the unconverted HTTPS URL. (Under the revert the parser import will not resolve; stash-and-restore in one step instead, or simply verify RED by running the Step 4 tests before applying Steps 2-3 in the first place.)
- Restore the fix (`git stash pop`) and re-run the same command: everything **passes**.
- Re-run the *Steps to Reproduce* scratch script once and confirm it now prints `{"owner":"paysdoc","repo":"paysdoc.nl"}` and `https://api.github.com/repos/paysdoc/paysdoc.nl/installation`. Delete the scratch file so it is never committed.

### 6. Prove no consumer regressed
- `bun run lint:git-guard` — must exit 0. Confirms the new pure function did not trip the `git-gh-shellout` or `cwd-derived-identity` rules, and that the `readLocalRepoInfo`/`getRepoInfo` call shapes in `upgradeClaim.ts:173`, `orchestratorLib.ts:35`, `trigger_webhook.ts:93`, `healthCheck.tsx:112`, and `checkLivingDocsIndex.ts:52` are still recognised as legal argument-bearing reads.
- `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` — no signature changed, so both must pass untouched.
- `bun run test:unit` — full suite green: baseline 139 files / 2408 tests, plus the new cases, **zero** regressions. Pay particular attention to `adws/core/__tests__/launchGitContext.test.ts` (its `deps.getRepoInfo` default is the fixed path) and `adws/core/__tests__/repoIdentityCrossCheck.test.ts` (identity equality semantics).
- Confirm this fix is a no-op for dot-free repos: the framework's own identity (`paysdoc/AI_Dev_Workflow`) and every existing fixture (`acme/webapp`, `octo/infra`, `sandbox/target`) parse exactly as before — pinned by the retained tests, not by inspection.

### 7. Satisfy the BDD acceptance contract
Read `features/per-issue/feature-779.feature` (already authored) and check the fix against all seven sections. Every row was verified against the Step 2 regexes during planning, so the expected state is all-green; the checks below are where a *different* implementation choice would trip:
- **§1** (4 rows) — the four canonical `paysdoc.nl` forms. The `.git`-less rows are the ones a suffix-strip-only fix would miss.
- **§2** (4 rows) — multi-dot, GitHub-Pages, dotted-with-trailing-slash, and **leading-dot `.github`**. The leading-dot row fails today by *throwing*, not truncating, and it rejects any `split('.')`-based fix.
- **§3** (7 rows) — dot-free no-regression, including the trailing-slash row that a literal transcription of the issue's suggested pattern would resolve to `webapp/`. The `\/?$` tail plus `[^/]+?` in Step 2 is what satisfies it.
- **§4** — `getRepoInfo` and `readLocalRepoInfo` must agree. Satisfied structurally because `getRepoInfo` already delegates; it fails only if the parse is patched at a call site instead of in the shared function.
- **§5** — the recorded mint must target `paysdoc/paysdoc.nl` and never `paysdoc/paysdoc`. No production change is needed: `ResolveContextTokenInput` already exposes `isAppConfigured` and `mintInstallationToken`, and `resolveContextToken` passes `(owner, repo)` straight through.
- **§6** (2 rows) — GitLab HTTPS and Bitbucket SSH must both still raise. Confirm the widened repo group did not make either host parseable.
- **§7** — type-check, covered by Step 6.
- Once `generate_step_definitions` has authored the step definitions, run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-779"` and confirm all scenarios pass.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` and confirm no regression scenario broke.

### 8. Validate
- Run every command in **Validation Commands** below and confirm all pass with zero regressions.
- Before committing, run `git diff origin/dev --stat` and confirm the diff contains **only** the five files from `Relevant Files` plus this plan (and the phase-authored `features/per-issue/` files). In particular `.claude/commands/adw_init.md` must show **no** diff — see Notes.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Commands are taken from `.adw/commands.md`.

- **Reproduce before the fix** — with the scratch script from *Steps to Reproduce* in the repo root: `NODE_OPTIONS="--import tsx" bunx tsx repro779.ts`. Expect `{"owner":"paysdoc","repo":"paysdoc"}` and the bogus `https://api.github.com/repos/paysdoc/paysdoc/installation` URL from the issue's stack trace. Delete the script afterwards.
- **RED proof** — `bunx vitest run adws/gitContext/__tests__/bootstrapIdentity.test.ts adws/gitContext/__tests__/repoWorkspace.test.ts` with the Step 4 tests present but Steps 2-3 not yet applied: the dotted-name parser cases, the temp-repo `readLocalRepoInfo` cases, and the two new `convertToSshUrl` cases all fail.
- `bun run lint` — ESLint passes with zero errors and zero warnings.
- `bunx tsc --noEmit` — repo type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional ADW type-check passes.
- `bun run build` — build succeeds with no errors.
- `bun run lint:git-guard` — the git/gh CLI guard exits 0 (no new shell-out or cwd-derived-identity violation).
- `bun run test:unit` — vitest runs the full suite green. Baseline before this change: **139 test files / 2408 tests passing**; after, expect 139 files and 2408 + N tests, all passing, zero regressions.
- **GREEN proof** — `bunx vitest run adws/gitContext/__tests__/bootstrapIdentity.test.ts adws/gitContext/__tests__/repoWorkspace.test.ts`: every case passes, including all four dotted remote forms, the multi-dot and `repo.git.git` suffix cases, and the two `convertToSshUrl` dotted conversions.
- **Verify after the fix** — re-run the scratch script: `{"owner":"paysdoc","repo":"paysdoc.nl"}` and `https://api.github.com/repos/paysdoc/paysdoc.nl/installation`. Delete the script.
- **Duplication is gone** — `grep -rn "\[\^/\.\]+" adws/` returns zero hits (the defective character class no longer exists anywhere, production or test).
- **Contract matrix re-proof** — the GREEN vitest run above covers every `feature-779.feature` row at unit level: 4 §1 rows, 4 §2 rows (including leading-dot `.github` and the dotted trailing slash), 7 §3 dot-free rows, the §4 `getRepoInfo` agreement case, and both §6 rejection rows. Confirm no row is missing before moving on.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-779"` — every scenario in `features/per-issue/feature-779.feature` passes (requires the step definitions authored by `generate_step_definitions`).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite still passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-proof"` — the review-proof suite still passes (required by `.adw/review_proof.md`).

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): the fix is squarely aligned with them — it replaces three copy-pasted regex pairs with one **pure** function (§Purity, §Modularity), uses guard clauses and early returns in every rewritten body (§Nesting & Extraction), documents the non-obvious lazy-group/end-anchor construction with JSDoc (§Documentation), and introduces no `any` and no decorators. Extraction here is justified exactly as the guidelines require: named intent plus de-duplication, not speculative reuse. All five touched files stay well under the 300-line limit.
- **No new libraries.** Per `.adw/commands.md` the install command would be `bun add <package>`, but none is needed — this is a regex correction.
- **Why the parser lives in `bootstrapIdentity.ts` rather than a new module.** `readLocalRepoInfo` is its primary consumer and the issue names that file as the fix site; keeping it there avoids a new file, a new `index.ts` line, a README structure entry, and a `.adw/conditional_docs.md` touch, while `adws/gitContext/**` already covers it under `feature-oqb76h`'s `Owns:` block. If a future change adds a fourth consumer outside the package, promoting it to a dedicated `adws/gitContext/remoteUrlParse.ts` is a clean follow-up — the exported name would not change.
- **Why `[^/]+?` instead of the issue's `.+?`.** Both fix the reported bug identically (verified over all ten URL forms in the Root Cause table). `[^/]+?` additionally cannot cross a path separator, so a web URL like `https://github.com/o/r/tree/main` yields `null` instead of a nonsense repo name `r/tree/main`. Nothing feeds such URLs today (`cloneUrl` is always `https://github.com/${fullName}.git` from `orchestratorCli.ts:176`, and `readLocalRepoInfo` reads `git remote get-url origin`), so this is defence in depth, not a behaviour anyone depends on.
- **The one intentional strictness change.** Adding the `$` anchor is what makes the optional `(?:\.git)?` strip a trailing suffix; it also means the HTTPS pattern no longer matches a URL with extra trailing path segments. That is a deliberate improvement — the previous unanchored pattern would happily "parse" a pull-request or tree URL — and no caller supplies such a URL. The `\/?$` tail keeps the existing tolerance for a trailing slash, which the current tests do not cover but the old unanchored regex accidentally allowed; the new tests pin it explicitly.
- **Scope: three production sites, not one.** The issue names only `readLocalRepoInfo`, but grep found the identical defective capture group in `getRepoInfoFromUrl` (`adws/github/githubApi.ts:27-28`) and `convertToSshUrl` (`adws/gitContext/repoWorkspace.ts:62`). Fixing only the first would leave two live copies of the same bug one grep away, and would leave the dotted-repo HTTPS→SSH clone conversion broken for the very repo in this issue. Routing all three through one parser *is* the minimal root-cause fix — it deletes code rather than adding branches. `getRepoInfo` (`githubApi.ts:19-21`) needs no edit because it already delegates to `readLocalRepoInfo`; `getRepoInfoFromPayload` needs no edit because splitting on `/` was never dot-sensitive (which is exactly why the webhook event path escaped this bug, as the issue notes).
- **`getRepoInfoFromUrl` has zero internal callers** (grep across `adws/`, `features/`, `test/` finds only its definition and its re-export at `adws/github/index.ts:8`). It is fixed for consistency and because it is public API surface — not because a live path depends on it.
- **The latent second failure this also fixes.** `GitContext`'s `resolveBasePath` is `path.join(targetReposDir, owner, repo)` (`gitContext.ts:88-92`), so the truncated identity would have resolved every git operation against `…/paysdoc/paysdoc` — a directory that does not exist — even if a token had somehow been minted. The token crash simply fires first. This is the wrong-base-repo incident class the GitContext PRD was written to eliminate, reached here through a bad parse rather than a bad `cwd`.
- **`convertToSshUrl`'s failure mode differs from the other two.** Its regex is fully anchored, so a dotted name does not truncate — it fails to match and the function returns its input unchanged (verified: `https://github.com/paysdoc/paysdoc.nl.git` comes back verbatim). Consequence: a first-time `ensureRepoWorkspace` clone of a dotted target repo runs over HTTPS instead of SSH. Silent, and invisible to the existing tests because both of their conversion fixtures are dot-free.
- **Why the tests could never have caught this.** `bootstrapIdentity.test.ts` does not import `readLocalRepoInfo` at all — all four of its "URL parsing" tests re-declare the production regexes inline and assert against them, so they test a copy of the bug. The file's own comment names the reason (`readLocalRepoInfo` has no exec seam). Extracting the pure parser removes that excuse; the temp-repo test in Step 4 closes the remaining gap by driving the real `execSync` path. After this change, a future regression in the regex fails at both levels.
- **`readLocalRepoInfo`'s signature must stay `(cwd?: string)`.** `checkGitGhGuard`'s `cwd-derived-identity` rule (`CWD_DERIVED_IDENTITY_FNS` at `adws/checkGitGhGuard.ts:52`) special-cases zero-argument calls to `getRepoInfo`/`readLocalRepoInfo` when composed into `gitContextForRepo(...)`. Adding a deps seam or reordering parameters risks changing which call sites the guard flags — for zero benefit, since the extracted pure function is what makes the logic testable. Do not add `parseGitHubRemoteUrl` to `CWD_DERIVED_IDENTITY_FNS`: it reads nothing.
- **Two requirements come from the acceptance contract, not the issue.** `feature-779.feature` §2 adds the **leading-dot** name (`paysdoc/.github`, the org-profile repo shape) and the **dotted-with-trailing-slash** HTTPS form. Both are genuine consequences of the same root cause and both are satisfied by the Step 2 regexes as written — but they constrain the implementation beyond the issue's text: a `split('.')[0]`-shaped or "strip everything after the first dot" fix passes §1 and fails §2, and a *literal* transcription of the issue's suggested HTTPS pattern (`/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/`, no slash tolerance) returns `webapp/` on §3's trailing-slash row. This is why Step 2 specifies `([^/]+?)` plus `\/?$` rather than copying the issue's suggestion verbatim.
- **`convertToSshUrl` is not scenario-pinned.** No section of `feature-779.feature` covers the HTTPS→SSH conversion (the feature scopes itself to identity reads). Its dotted-name behaviour is therefore guarded by the unit tests added in Step 4 only. That is deliberate — the feature file is the issue-faithful contract, and adding a scenario for a defect the issue does not mention would overreach it. The fix is still in scope: it is the same regex, in the same package, silently broken for the same repo.
- **Conditional docs.** `.adw/conditional_docs.md` matches three entries for this task, all present in `app_docs/`: `feature-oqb76h-gitcontext-base-path-authority.md` (owns `adws/gitContext/**` and names `readLocalRepoInfo` as the bootstrap boundary and `resolveBasePath` as base-path authority), `feature-bq1f45-git-gh-cli-guard.md` (owns the guard and its `cwd-derived-identity` rule), and `feature-k2tkdn-gitcontext-boundary-constructor.md` (launch-boundary construction via `deps.getRepoInfo`). A fourth match, `feature-m45h0x-upgradeclaim-deep-module.md` (`buildDefaultUpgradeClaimDeps`), **does not exist** in this worktree, so `adws/core/upgradeClaim.ts` is its own source of truth. None of these docs needs an edit: the boundaries, guard rules, and call shapes are all unchanged — only the parser behind them is corrected. The `document` phase will add the `app_docs/` entry for this fix.
- **Worktree hygiene — an out-of-scope revert was found and discarded during planning.** This worktree was born with an uncommitted working-tree revert of `.claude/commands/adw_init.md` that deleted the entire step-7 "Copy Starter Guardrails Settings" section (issue #763, merged) and renumbered steps 8→7 and 9→8. Verified working-tree-only: `git diff HEAD origin/dev -- .claude/commands/adw_init.md` was empty and the branch was at parity with `origin/dev` (`git rev-list --left-right --count HEAD...origin/dev` → `0 0`), so the revert existed **only** in the unstaged working tree. Discarded with `git checkout HEAD -- .claude/commands/adw_init.md` (pure discard — no commit, no `git add -A`) and re-verified: the working tree is clean and step 7 is present at line 120. **The implementer must not re-introduce it.** `.claude/commands/adw_init.md` is out of scope here and, being a `hashInputs:` file, any edit to it would raise `.adw-version` and fan an `adwUpgrade` regen sweep across every registered target repo. It must show no diff against `origin/dev` in the final PR — check `git diff origin/dev --stat` before committing. This is a known recurring worktree-birth defect (10th occurrence).
- **Blast radius of the fix.** Three small function bodies plus two regex constants and one export line, in five files; two test files extended. No signature, no type, no `WorkflowStage`, no state shape, no gate, and no call site changes. For dot-free repositories — which is every repo ADW currently drives except `paysdoc/paysdoc.nl` — behaviour is byte-identical before and after; the retained dot-free test cases are what prove it rather than inspection.
