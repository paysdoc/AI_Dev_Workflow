# Bug: `appAuth` error paths leak the GitHub App JWT into logs and the process table

## Metadata
issueNumber: `780`
adwId: `e50ix7-appauth-error-paths`
issueJson: `{"number":780,"title":"appAuth error paths leak the GitHub App JWT into logs","body":"# appAuth error paths leak the GitHub App JWT into logs\n\n## Symptom\n\nWhen the installation-lookup curl in `adws/gitContext/appAuth.ts` fails, the thrown `execSync` error contains the **full command line — including the `Authorization: Bearer <JWT>` header** — and that error propagates uncaught into process logs. Observed 2026-07-30 11:36Z during an upgrade-gate crash: the complete App JWT was printed verbatim in the workflow log.\n\nThe exposure window is limited (App JWTs live 10 minutes and only authorize app-level endpoints), but bearer credentials must never land in logs: workflow logs are pasted into issues/chat for debugging (exactly how this one surfaced), and the same pattern would leak longer-lived tokens if one is ever passed this way.\n\n## Root cause\n\n`resolveInstallationId` and `fetchInstallationToken` shell out via:\n\n```ts\nexecSync(`curl -sf -H \"Authorization: Bearer ${jwt}\" … https://api.github.com/...`)\n```\n\n`execSync` embeds the entire command string in the `Error: Command failed: …` message on non-zero exit. Nothing catches and redacts it.\n\n(Secondary concern of the same construction: the JWT is also visible in the process table (`ps`) for the duration of the curl call.)\n\n## Desired behavior\n\n- The JWT must not appear in any thrown error, log line, or the process argv. Options, in preference order:\n  1. Replace the curl shell-out with `fetch()` (Node ≥18 native) — no subprocess, no command string, structured error handling. `execSync`+curl here predates the gitContext consolidation and has no remaining justification.\n  2. If curl must stay: pass the header via a config file/stdin (`curl -H @-` or `--config`), and wrap the exec in try/catch that rethrows a sanitized error naming the endpoint and HTTP/exit status only.\n- Failure messages should name the endpoint and repo identity (e.g. `GitHub App installation lookup failed for owner/repo: HTTP 404`) so the error is diagnosable without the raw command.\n- Add a regression test asserting the thrown error message for a failing lookup does not contain the JWT.\n\n## Relevant files\n\n- `adws/gitContext/appAuth.ts` — `resolveInstallationId`, `fetchInstallationToken`\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-07-30T11:47:02Z","comments":[],"actionableComment":null}`

## Bug Description
`adws/gitContext/appAuth.ts` mints GitHub App installation tokens by shelling out to `curl` with the App JWT interpolated directly into the command string:

```ts
// adws/gitContext/appAuth.ts:108-115 (resolveInstallationId)
const result = execSync(
  `curl -sf ` +
  `-H "Authorization: Bearer ${jwt}" ` +
  ...
  `https://api.github.com/repos/${owner}/${repo}/installation`,
  { encoding: 'utf-8' },
);
```

`curl -sf` exits non-zero on any HTTP status ≥ 400, and `execSync` puts the **entire command string** into the thrown error's `message` (`Command failed: <cmd>`). Because nothing on the path catches it, the raw message reaches the console/workflow log. Observed 2026-07-30 11:36Z during an upgrade-gate crash: the whole App JWT was printed verbatim.

**Verified live in this worktree** (fake JWT, a repo that returns 404):

```
1. message contains JWT? true
1. message: "Command failed: curl -sf -H \"Authorization: Bearer FAKEJWTHEADER.FAKEJWTPAYLOAD.FAKEJWTSIGNATURE0123456789\" -H \"Accept: application/vnd.github+json\" https://api.github.com/repos/paysdoc/definitely-not-a-real-repo-780/installation"
```

The same construction exists in `fetchInstallationToken` (lines 128-135), so the token-exchange endpoint leaks identically.

Two distinct exposures from one construction:
1. **Log exposure** — the JWT lands in the thrown `Error.message` and therefore in stdout/stderr, ADW workflow logs, and any log excerpt pasted into an issue or chat (which is exactly how this bug surfaced).
2. **Process-table exposure** — for the lifetime of the curl call the JWT is a `curl` argv element, readable by any local process via `ps`.

**Expected behaviour:** the credential travels to curl over a channel that is neither argv nor a command string, so it structurally cannot appear in an error message or in `ps`; a failing request throws a message naming the operation, the repo/installation identity, and the HTTP or curl exit status.

**Actual behaviour:** the credential is in the command string, and the command string is the error message.

## Problem Statement
The bearer credential and the failure-reporting channel are the same string. `execSync`'s contract is to echo the command it ran, so *any* non-zero exit — HTTP 4xx/5xx from `-f`, DNS failure, TLS failure, curl not installed — produces an error message containing the live credential, and that message is thrown uncaught out of `getInstallationToken` into the process log. There is also no sanitized failure path at all: the two `throw new Error(...)` sites in the file fire only when curl *succeeded* but the JSON lacked the expected field, so every genuine transport/HTTP failure is reported by `execSync`'s raw, credential-bearing default message.

A second, structural half of the problem: `appAuth.ts` is the only module in `adws/gitContext/` that performs **un-injected** I/O — it hardcodes `https://api.github.com` and injects nothing. Its neighbour `tokenResolver.ts` states "All I/O is injected for hermetic testing", and `resolveContextToken` takes `mintInstallationToken` as a parameter. Because the mint's endpoint is un-mockable, it has **no tests at all**, and issue #701 could only record the gap in prose. That blind spot is why this leak went unseen, and the issue's own acceptance criterion ("Add a regression test asserting the thrown error message for a failing lookup does not contain the JWT") cannot be met without closing it.

## Solution Statement
Adopt the issue's **Option 2** — keep curl, move the credential off the command line — and close the endpoint seam. Option 1 (`fetch()`) is rejected as non-surgical; see *Why not `fetch()`* in Notes. The authored acceptance contract (`features/per-issue/feature-780.feature`) is deliberately neutral between the two, so this is the planner's call and it is made here explicitly. All changes are confined to `adws/gitContext/appAuth.ts` plus new tests.

1. **Move the whole request description onto curl's `--config` stdin channel.** Replace both `execSync('curl … -H "Authorization: Bearer <jwt>" … <url>')` calls with a single private chokepoint that runs `execFileSync('curl', ['--config', '-'], { input: config })`, where `config` carries `url`, all three headers (including `Authorization`), the request method, `silent`, `show-error`, and `write-out = "\n%{http_code}"`. The argv is then the constant `curl --config -`.

2. **Make the API endpoint injectable** (`apiBaseUrl`), defaulting to `https://api.github.com`. This is what the acceptance contract's out-of-process recording stub needs, and it brings `appAuth.ts` in line with the package's stated dependency-injection doctrine.

3. **Stop relying on `execSync` throwing for HTTP errors.** Drop `-f`; read the HTTP status from the `write-out` trailer and branch on it explicitly. Non-2xx no longer produces a thrown subprocess error — it produces a composed, sanitized message.

4. **Compose sanitized failure messages** naming the operation, the subject identity, and the status — `GitHub App installation lookup failed for acme/webapp: HTTP 404` — per the issue's wording. Wrap `execFileSync` in try/catch so a transport failure rethrows as `GitHub App installation lookup failed for acme/webapp: curl exit 6 (Could not resolve host: api.github.com)`.

5. **Never echo a response body.** Diagnostic detail comes from the HTTP status plus, when the body is GitHub's standard error envelope, its `message` field only (`Not Found`, `Bad credentials` — a fixed vocabulary), plus a byte count. This is required by §2b of the acceptance contract: a 2xx body carrying a credential under an unexpected key must not reach the error message.

6. **Add `redactBearerTokens` as a final net.** Any untrusted fragment folded into a message (curl's stderr, GitHub's `message`) passes through a pure redactor rewriting `Bearer <value>` → `Bearer [REDACTED]`. The credential is already structurally absent after step 1; this makes the invariant enforced rather than incidental.

7. **Add two injectable seams and a cache reset** — `runCurl` (so a test can record the argv the mint would use, then pass through to the real curl) and `clearAppAuthCaches()` (so scenarios can reset the module-level `tokenCache` / `installationIdCache`, which the acceptance contract requires).

Side benefit, not the goal: `execFileSync` removes `/bin/sh` from the path, so `owner`, `repo`, and `installationId` are no longer interpolated into a shell command string.

No change to `getInstallationToken(owner, repo)`'s existing parameters beyond an optional trailing deps argument; no change to `resolveContextToken`, `resolveLaunchToken`, `gitContextFactory`, or any of the 138 non-test `GitContext` construction sites.

## Steps to Reproduce
1. From the worktree root, write a scratch script `repro780.mjs` reproducing the exact pre-fix construction (this avoids needing real App credentials — the leak is in the error-formatting, not the auth):

   ```js
   import { execSync } from 'child_process';
   const JWT = 'FAKEJWTHEADER.FAKEJWTPAYLOAD.FAKEJWTSIGNATURE0123456789';
   try {
     execSync(
       `curl -sf -H "Authorization: Bearer ${JWT}" ` +
       `-H "Accept: application/vnd.github+json" ` +
       `https://api.github.com/repos/paysdoc/definitely-not-a-real-repo-780/installation`,
       { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
     );
   } catch (e) {
     console.log('message contains JWT?', e.message.includes(JWT));
     console.log(e.message);
   }
   ```

2. Run `node repro780.mjs`.
3. Observe `message contains JWT? true` and the full `Authorization: Bearer …` header echoed in the `Command failed:` message. This is the string that reached the workflow log at 11:36Z.
4. Delete the scratch file.

**Real-world reproduction:** with `GITHUB_APP_ID` / `GITHUB_APP_SLUG` / `GITHUB_APP_PRIVATE_KEY_PATH` set, call `getInstallationToken(owner, repo)` for any repo the App is **not** installed on. `GET /repos/{owner}/{repo}/installation` returns 404, `curl -f` exits 22, and the uncaught error carries the live JWT into the log. Any App-configured ADW launch against an uninstalled repo hits this — the upgrade-gate crash was one instance.

Note on `ps` exposure: it needs no separate repro. The JWT is a `curl` argv element by construction, and the fix is verified by recording the argv the mint passes (§3 of the acceptance contract).

## Root Cause Analysis
**The credential and the diagnostic share one string, and there is no sanitized failure path.**

- `execSync(command, …)`'s documented failure behaviour is to throw an `Error` whose `message` is `Command failed: ${command}` plus captured stderr. Interpolating a secret into `command` therefore *guarantees* it appears in the error. This is not an edge case in the code — it is the only way an HTTP failure is reported here.
- The `-f` flag makes that the normal path. Without `-f`, curl exits 0 on a 404 and the body flows to `JSON.parse`; with `-f`, curl exits 22 and `execSync` throws its credential-bearing message before any ADW code runs. So `-f` converts every HTTP error into a leak.
- The two hand-written `throw new Error(...)` sites (`appAuth.ts:119`, `:139`) are unreachable for HTTP failures — they only fire when curl **succeeded** (exit 0) but the parsed JSON lacked `id` / `token`. Consequently the file has **zero** sanitized error paths for the failures that actually happen. Those two sites carry their own, narrower leak: they interpolate the raw response body into the message, so a 2xx body carrying a credential under an unexpected key is echoed verbatim (`GitHub App token exchange failed: ${result}`).
- Nothing upstream catches. `resolveContextToken` (`tokenResolver.ts:49-53`) deliberately propagates the mint's throw loudly — "foreign/uninstalled identity must fail at construction, not silently adopt a wrong-repo ambient token" — which is the correct veracity contract from #700 and must not change. `resolveLaunchToken` → `buildLaunchGitContext` → `new GitContext(...)` add no try/catch either, by design. So the mint's error message *is* what the operator sees, and it must therefore be safe by construction rather than by a catch somewhere upstream.

**Why it survived:** `curl`-via-`execSync` in this file predates the gitContext consolidation. `adws/gitContext/` is structurally exempt from the git/gh guard (`EXEMPT_PACKAGE_DIR = 'adws/gitContext'`, `checkGitGhGuard.ts:46`) and the guard only inspects `git`/`gh` command strings anyway, so no lint rule looks at this construction. Compounding it, the mint hardcodes `https://api.github.com` and injects nothing, so it is the one module in an otherwise fully dependency-injected package that cannot be driven hermetically — `adws/gitContext/__tests__/` covers `bootstrapIdentity`, `claimOps`, `commitOps`, `gitContext`, `gitContextOperations`, `gitReadOps`, `remoteOps`, `repoWorkspace`, and `tokenResolver`, but never the mint. Issue #701 recorded that blind spot in prose and shipped no coverage. Nothing anywhere asserts on the shape of a mint failure.

**Investigated and ruled out as a leak vector:** `JSON.parse` on the token-exchange response. V8 truncates its snippet to the first ~10 characters of the input, so for GitHub's `{"token":"ghs_…` shape the snippet stops inside the key name. Verified across five malformed-body shapes (truncated-at-end, trailing garbage, HTML error page, leading junk, malformed tail) — none reproduced a token in the message. The parse sites are still routed through the sanitized helper in this fix, but as consistency, not as a fix for a confirmed leak. Stated so the implementer does not go hunting.

## Relevant Files
Use these files to fix the bug:

- `adws/gitContext/appAuth.ts` — **the only production edit.** 148 lines. `resolveInstallationId` (103-125) and `fetchInstallationToken` (127-147) hold both leaking `execSync` calls *and* the two raw-body echoes; `getInstallationToken` (62-78) is the public entry point and the place the optional deps argument is added; `createAppJWT` (84-101) mints the credential and is otherwise untouched. The `import { execSync } from 'child_process'` on line 14 becomes `execFileSync`. The module docstring's "No ADW-global imports. The log seam defaults to a no-op to keep the package standalone-reusable." constraint must hold — **do not** import ADW's logger, `environment.ts`, or anything outside `node:` builtins. Note the file currently logs nothing at all; keep it that way (see §1b in Step 7).
- `features/per-issue/feature-780.feature` — **the acceptance contract, already authored** by the `scenario_writer` phase and tagged `@adw-780 @adw-e50ix7-appauth-error-paths`. Read it in full before writing code: it dictates two seams this fix must provide (an injectable API endpoint and recordable subprocess argv), forbids echoing a response body (§2b), and requires the module caches to be clearable between scenarios. Step 7 maps each of its seven scenarios onto this implementation. It also asks the planner to resolve the sync-vs-async fork — resolved in the Solution Statement in favour of Option 2.
- `adws/gitContext/tokenResolver.ts` — **read-only.** `ResolveContextTokenInput.mintInstallationToken` is typed `(owner: string, repo: string) => string` (line 23). The new optional third parameter on `getInstallationToken` must keep it assignable to that type (a trailing *optional* parameter does; `bunx tsc --noEmit` is the proof). The comment at lines 50-52 is the contract that the mint's throw propagates uncaught — it stays, which is exactly why the thrown message must be safe. Its docstring ("All I/O is injected for hermetic testing") is the doctrine the new `apiBaseUrl` seam brings `appAuth.ts` into line with, and its test file is the style model for the new one.
- `adws/core/launchGitContext.ts` — **read-only.** Line 55 passes `mintInstallationToken: getInstallationToken` by reference. Unchanged.
- `adws/github/gitContextFactory.ts` — **read-only.** Line 46 does the same in `resolveToken`. Unchanged. Its `clearSelfHostCache` export is the naming precedent for `clearAppAuthCaches`.
- `adws/github/githubAppAuth.ts` — **read-only.** Pure re-export shim (#701). Unchanged; the re-export keeps working because the exported names do not change.
- `adws/gitContext/index.ts` — **read-only.** Line 21 re-exports `{ isGitHubAppConfigured, getInstallationToken }`. The new helpers and `clearAppAuthCaches` are exported from `appAuth.ts` for tests and step definitions to import directly, and **must not** be added to this public index — the package surface stays as-is.
- `adws/phases/reviewPhase.ts` — **read-only.** Line 110 calls `isGitHubAppConfigured()` only (not the mint). Confirms the boolean probe is a separate consumer that this fix does not touch.
- `adws/checkGitGhGuard.ts` — **read-only.** `EXEMPT_PACKAGE_DIR = 'adws/gitContext'` (line 46) means this file is skipped by directory, and the scanner only matches `git`/`gh` command strings (line 48) — `curl` is not scanned either way. Changing `execSync` → `execFileSync` here has **no** guard impact. Run `bun run lint:git-guard` anyway to confirm the `(0 allowlisted)` count is unchanged.
- `features/per-issue/step_definitions/feature-770.steps.ts` — **reference only**, the current example of this repo's step style.
- `.adw/coding_guidelines.md` — no change; the fix must follow it. Directly applicable: "Security by default", "Error handling — use try-catch at system boundaries. Provide meaningful error messages", "Purity — prefer pure functions. Isolate side effects at the boundaries", "Guard clauses", "Keep files under 300 lines" (the file lands ~250).
- `.adw/commands.md` — no change; source of the exact validation commands.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — **owner doc, needs a documentation update.** `.adw/conditional_docs.md` lists `adws/gitContext/**` under this doc's `Owns:` block, and its condition *"When the bootstrap package modules (`appAuth.ts`, …) are relevant"* matches this task. Its module table (line 43) currently states *"Uses `curl`-based exchange (not git/gh)"* — still true, but the row must record that the credential travels over `curl --config -` stdin, never appears in argv or a thrown message, and that the endpoint is now injectable. The `/document` phase owns this edit; the implementer must not skip it.
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — **reference only.** Confirms there is no allowlist and that `adws/gitContext/` is exempt by directory, so this file may legitimately shell out. Nothing here changes.
- `README.md` — needs one line: the new test file added to the `gitContext/__tests__/` block (lines 634-643, alphabetical — `appAuth.test.ts` goes **first**, before `bootstrapIdentity.test.ts`). The `/document` phase owns this. Do **not** otherwise touch README.

### New Files
- `adws/gitContext/__tests__/appAuth.test.ts` — vitest regression guard, the issue's explicit acceptance criterion. Location is already covered by `vitest.config.ts`'s `adws/**/__tests__/**/*.test.ts` include, so `bun run test:unit` picks it up with no config change. Contents specified in Step 6.
- `features/per-issue/step_definitions/feature-780.steps.ts` — step definitions for the already-authored feature file, written by the `generate_step_definitions` phase. Step 7 specifies the drive.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Confirm the leak and read the contract before changing anything
- Write and run the `repro780.mjs` scratch script from *Steps to Reproduce*. Confirm it prints `message contains JWT? true` and echoes the `Authorization: Bearer …` header. Delete the scratch file.
- Read `features/per-issue/feature-780.feature` end to end. It is already authored and is the acceptance contract; the seams in Steps 2-5 exist to satisfy it.
- Record the baseline: `bun run test:unit` currently reports **139 test files / 2408 tests passing**. Every later step must keep all 2408 green.

### 2. Add the pure helpers to `adws/gitContext/appAuth.ts`
Add these above the existing "Private mint internals" section. All are pure (no I/O, no `process.env`, no module state) and `export`ed so tests and step definitions can import them. Do **not** add them to `adws/gitContext/index.ts`.

- `const BEARER_PATTERN = /Bearer\s+\S+/g;`
- `export function redactBearerTokens(text: string): string` — returns `text.replace(BEARER_PATTERN, 'Bearer [REDACTED]')`.
- `export const GITHUB_API_BASE_URL = 'https://api.github.com';` — the production default, replacing the two hardcoded literals.
- `export interface GitHubApiRequest { jwt: string; url: string; method: 'GET' | 'POST'; operation: string; subject: string; }`
  - `operation` is the human-readable phrase for the message: `'installation lookup'` / `'token exchange'`.
  - `subject` is the identity echoed in the message: `'acme/webapp'` / `'installation 4711'`.
- `export function buildCurlConfig(request: GitHubApiRequest): string` — returns a curl config payload, one directive per line, newline-terminated, in this order:
  ```
  silent
  show-error
  header = "Authorization: Bearer <jwt>"
  header = "Accept: application/vnd.github+json"
  header = "X-GitHub-Api-Version: 2022-11-28"
  write-out = "\n%{http_code}"
  url = "<url>"
  request = "POST"        # only when method === 'POST'
  ```
  - `write-out` must contain the **two literal characters** `\` and `n` in the config file (curl expands `\n` itself) — in the TypeScript source that is `'write-out = "\\n%{http_code}"'`.
  - `silent` suppresses the progress meter; `show-error` keeps curl's own diagnostic on stderr (which carries no credential) so transport failures stay diagnosable.
  - Emit `request = "POST"` only for POST — a bare GET needs no `request` directive. §4 of the acceptance contract distinguishes the two legs.
- `export function describeApiFailure(input: { operation: string; subject: string; detail: string }): string` — returns `` `GitHub App ${operation} failed for ${subject}: ${redactBearerTokens(detail)}` ``. `detail` is the caller-supplied `HTTP 404 (Not Found)` / `curl exit 6 (…)` fragment. This produces exactly the shape the issue asks for.
- `function describeStatus(status: number, body: string): string` — the **non-echoing** detail builder. Returns `HTTP ${status}` and, only when `body` parses as JSON **and** its `message` field is a string, appends `` ` (${redactBearerTokens(message)})` ``. GitHub's REST error envelope always carries `message` with a fixed vocabulary (`Not Found`, `Bad credentials`, `Requires authentication`), so this is diagnosable without echoing anything attacker- or credential-bearing. Never include the body itself, and never include more than the `message` field. Swallow any parse failure and fall back to `` `HTTP ${status} (${body.length} bytes, unparseable)` ``.
  - **This is load-bearing for §2b of the acceptance contract**, which fails if a credential in a 2xx body reaches the message. An earlier draft of this plan truncated the body to 200 characters and echoed it; that would have failed §2b. Do not reintroduce a body echo in any form.

### 3. Add the request chokepoint and the injectable seams
- Change line 14 to `import { execFileSync } from 'child_process';`.
- Add the seam types:
  ```ts
  /** Runs curl with the given argv, delivering the request description on stdin. */
  export type RunCurl = (args: readonly string[], stdinConfig: string) => string;

  export interface AppAuthDeps {
    /** Overrides the GitHub API origin. Defaults to GITHUB_API_BASE_URL. */
    apiBaseUrl?: string;
    /** Overrides the curl runner. Production uses execFileSync. */
    runCurl?: RunCurl;
  }
  ```
- Add the production seam and the private chokepoint:
  ```ts
  const CURL_ARGS: readonly string[] = ['--config', '-'];

  const execCurl: RunCurl = (args, stdinConfig) =>
    execFileSync('curl', [...args], {
      input: stdinConfig,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

  interface GitHubApiResponse { status: number; body: string; }

  function requestGitHubApi(request: GitHubApiRequest, runCurl: RunCurl): GitHubApiResponse
  ```
- `requestGitHubApi` body:
  1. `const raw = runCurl(CURL_ARGS, buildCurlConfig(request));` inside a `try`.
  2. `catch (error: unknown)` — narrow with `typeof`/`in` checks (no `any`, per the guidelines), pull curl's exit code and stderr off the error, and `throw new Error(describeApiFailure({ operation: request.operation, subject: request.subject, detail: \`curl exit ${status} (${stderrSummary})\` }))`. `stderrSummary` is the trimmed stderr passed through `redactBearerTokens`. Do **not** attach the original error as `cause` — that would re-admit the raw `Command failed:` text into anything that walks the cause chain.
  3. Split the status off the trailer with `const cut = raw.lastIndexOf('\n')`. `lastIndexOf` is correct even when the body contains newlines or ends with one, because the `write-out` newline is always last. Guard `cut < 0` (no trailer at all) as a failure via `describeApiFailure` with `detail: 'no HTTP status returned'`.
  4. Return `{ status: Number(raw.slice(cut + 1).trim()), body: raw.slice(0, cut) }`.
- `stdio: ['pipe', 'pipe', 'pipe']` is **required**, never `'inherit'`. `execFileSync` otherwise forwards the child's stderr straight to the parent's stderr, which would bypass the sanitizer — and §1b of the acceptance contract asserts that nothing logged during a failing attempt discloses the credential.

### 4. Rewrite the two call sites
- `getInstallationToken(owner: string, repo: string, deps: AppAuthDeps = {}): string` — resolve `const runCurl = deps.runCurl ?? execCurl;` and `const baseUrl = deps.apiBaseUrl ?? GITHUB_API_BASE_URL;` once, and pass both down to the two private helpers. Keep the cache lookup, the `createAppJWT` call, and the `tokenCache.set` exactly as they are.
- `resolveInstallationId(jwt, owner, repo, baseUrl, runCurl)`:
  - Keep the `installationIdCache` early return.
  - `const { status, body } = requestGitHubApi({ jwt, url: \`${baseUrl}/repos/${owner}/${repo}/installation\`, method: 'GET', operation: 'installation lookup', subject: key }, runCurl);`
  - Guard clause: `if (status < 200 || status >= 300) throw new Error(describeApiFailure({ operation: 'installation lookup', subject: key, detail: describeStatus(status, body) }));`
    - Accept **any 2xx** rather than exactly 200. The acceptance contract's stub picks its own success status, and a hardcoded 200 could fail §4 for no reason.
  - Then parse. Route `JSON.parse` through a local helper that catches and rethrows via `describeApiFailure` with `detail: \`HTTP ${status} — unparseable response body (${body.length} bytes)\`` — consistency with the rest of the file's error shape, not a fix for a confirmed leak (see Root Cause Analysis).
  - Replace the missing-`id` guard's raw-body echo with `describeApiFailure({ operation: 'installation lookup', subject: key, detail: \`HTTP ${status} — response did not contain an installation id (${body.length} bytes)\` })`. The **semantics must not change**: an App that is not installed still throws, because `resolveContextToken` depends on it (`tokenResolver.ts:50-52`); unit test 10 in Step 6 guards against a softening.
  - `installationIdCache.set(key, id)` unchanged.
- `fetchInstallationToken(jwt, installationId, baseUrl, runCurl)` — the same treatment with `method: 'POST'`, `operation: 'token exchange'`, `subject: \`installation ${installationId}\``, any-2xx acceptance, and a missing-`token` guard reading `response did not contain an installation token (${body.length} bytes)` — **no body echo**. Keep the returned `CachedToken` shape (`token`, `expiresAt`, `installationId`) byte-identical.
- Add `export function clearAppAuthCaches(): void` — clears both `tokenCache` and `installationIdCache`. Required by the acceptance contract so a successful mint in one scenario cannot poison a later lookup. Name matches the `clearSelfHostCache` precedent in `gitContextFactory.ts`; export from `appAuth.ts` only, not from `index.ts`.
- Delete the now-unused `execSync` import.

### 5. Verify the seam end to end against a local stub
Before writing the test suite, confirm the plumbing with a throwaway script (delete it afterwards): start a two-line Node HTTP stub on `127.0.0.1:0` that records `req.headers.authorization` and answers `/repos/acme/webapp/installation` with 404, then call `getInstallationToken('acme', 'webapp', { apiBaseUrl: \`http://127.0.0.1:${port}\` })` and confirm:
- it throws `GitHub App installation lookup failed for acme/webapp: HTTP 404 (Not Found)`;
- the stub recorded a `Bearer <jwt>` header (proving the credential was actually transmitted — a fix that fails *before* authenticating would score a false GREEN on every negative assertion);
- that recorded JWT appears nowhere in the thrown message.

Plain-HTTP base URLs through the config channel are already verified working; this step confirms it end to end through the real mint.

### 6. Add the vitest regression guard
Create `adws/gitContext/__tests__/appAuth.test.ts`. It must drive the **real** `getInstallationToken`, including the real JWT mint, so assertions target the actual credential rather than a hardcoded stand-in. Unlike the BDD scenarios this suite uses the `runCurl` seam rather than a stub server, so it stays fast and network-free.

- Suite setup: generate a throwaway RSA keypair with `crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })`, write the private PEM under `fs.mkdtempSync(path.join(os.tmpdir(), 'adw-appauth-'))`, and set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY_PATH` in `beforeAll`. Restore the prior env and `fs.rmSync(dir, { recursive: true, force: true })` in `afterAll`. Call `clearAppAuthCaches()` in `beforeEach`.
- Capture helper: a `runCurl` fake recording every `{ args, config }` and returning a canned `` `${body}\n${status}` `` string, or throwing a synthetic `execFileSync`-shaped error (`{ status, stderr, message: 'Command failed: curl --config -' }`).
- Extract the minted JWT from the recorded `config` (match `/Bearer (\S+)/`) — that is the real secret, and it is the string every negative assertion targets.
- Tests:
  1. **The bug (RED before the fix).** Canned 404 for the lookup. Assert `getInstallationToken('acme', 'lookup-404', { runCurl })` throws, and the message contains neither the extracted JWT, nor `/Bearer\s+ey/`, nor `'Command failed'`.
  2. **The message is diagnosable.** That same message contains `'installation lookup'`, `'acme/lookup-404'`, and `'HTTP 404'`.
  3. **argv carries no credential.** Every recorded `args` joins to exactly `'--config -'`, and no element matches `/Bearer/` or contains the JWT — the `ps` guarantee.
  4. **The credential really was delivered.** The recorded `config` contains exactly one `Authorization: Bearer <jwt>` line plus the `url`, `Accept`, and `X-GitHub-Api-Version` directives — proving the fix moved the header rather than dropping it. This is what keeps tests 1 and 3 non-vacuous.
  5. **Token-exchange failure.** Canned 2xx lookup, canned 500 exchange. Message contains `'token exchange'`, the installation id, `'HTTP 500'`; not the JWT.
  6. **No response body is echoed.** Canned 2xx exchange whose body is `{"unexpected_key":"ghs_unexpected_shape_credential"}`. Assert the throw does **not** contain `'ghs_unexpected_shape_credential'` and does not contain the raw body, while still naming `'token exchange'`. This is the unit twin of contract §2b.
  7. **Transport failure.** `runCurl` throws the synthetic `{ status: 6, stderr: 'curl: (6) Could not resolve host: api.github.com\n' }`. Message contains `'curl exit 6'` and `'Could not resolve host'`, not the JWT, and not `'Command failed'`.
  8. **Happy path unchanged (guard).** Canned `{"id":4242}` then `{"token":"ghs_test","expires_at":<future ISO>}`. Assert the return is `'ghs_test'`, a second call for the same `owner/repo` serves from cache without invoking `runCurl` again, and the POST leg's config contains `request = "POST"` while the GET leg's does not.
  9. **`apiBaseUrl` is honoured.** With `{ apiBaseUrl: 'http://127.0.0.1:9', runCurl }`, the recorded `config`'s `url` directive starts with `http://127.0.0.1:9/repos/` and no recorded config mentions `api.github.com`. Also assert the default: with no `apiBaseUrl`, the url directive starts with `https://api.github.com/`.
  10. **Uninstalled App still throws loudly (guard).** A 2xx response whose body lacks `id` still throws — the `resolveContextToken` veracity contract must not soften into a silent fallback.
  11. **`clearAppAuthCaches` works.** After a successful mint, `clearAppAuthCaches()` makes the next call for the same repo hit `runCurl` again.
  12. **`redactBearerTokens` unit coverage.** `'Authorization: Bearer abc.def.ghi'` → `'Authorization: Bearer [REDACTED]'`; multiple occurrences all replaced; text with no bearer returned unchanged.
- Follow `.adw/coding_guidelines.md`: no `any` (narrow the caught `unknown`), explicit assertions, no decorators. Match the style of `adws/gitContext/__tests__/tokenResolver.test.ts`.

### 7. Prove RED → GREEN and satisfy the BDD acceptance contract
- **RED proof on the unit suite:** with Steps 2-6 applied, temporarily reintroduce `-H "Authorization: Bearer <jwt>"` as a curl **argument** in `execCurl`/`buildCurlConfig` and run `bunx vitest run adws/gitContext/__tests__/appAuth.test.ts`. Tests 1, 3, and 7 must **fail**. Revert the temporary change (do not commit it) and re-run: all pass.
- **The BDD contract.** `features/per-issue/feature-780.feature` is already authored; do **not** edit it. `generate_step_definitions` writes `features/per-issue/step_definitions/feature-780.steps.ts`. How each scenario maps onto this implementation:
  - **§1a** (404 lookup) → the sanitized `describeApiFailure` message. Satisfied by Step 4's non-2xx guard clause. RED today.
  - **§1b** (nothing logged discloses the credential) → satisfied because `appAuth.ts` logs nothing and `stdio[2]` is `'pipe'`, so curl's stderr is captured and sanitized instead of reaching the parent's stderr. **Do not add any logging to this module.**
  - **§2** (500 exchange) → the same guard on the POST leg. RED today.
  - **§2b** (2xx with an unexpected body carrying a credential) → satisfied by `describeStatus` never echoing a body and by the reworded missing-`token` guard. The feature file notes "the plan may narrow it"; this plan **keeps it in scope** — not echoing the body is a natural consequence of the design, costs nothing, and closes the same construction on the higher-value credential (installation tokens live an hour vs the JWT's ten minutes).
  - **§3** (no subprocess argv carries the credential) → satisfied because argv is the constant `curl --config -`. The step definition records argv by injecting a **pass-through** `runCurl` that captures `args` and then delegates to the real `execFileSync`, so the stub is still reached over real HTTP while the argv is observable. `RunCurl` receives only the argument vector, so the scenario's "command line" is reconstructed as `['curl', ...args].join(' ')` — the executable is the constant `'curl'`. The pass-through must mirror production's `stdio: ['pipe', 'pipe', 'pipe']`; an `'inherit'` in the step definition would forward curl's stderr to the parent and undo §1b's guarantee wherever the recorder is reused.
  - **§4** (happy path still mints) → satisfied by the any-2xx acceptance on both legs and the unchanged `CachedToken` shape. RED before the fix (without `apiBaseUrl` the mint cannot be pointed at the stub, so a successful mint is unstageable) and GREEN once the seam exists; this is the suite's first behavioural coverage of a successful mint.
  - **§5** (type-check backstop) → the registered T22 step, already implemented at `features/per-issue/step_definitions/feature-504.steps.ts:1126`, which runs `bunx tsc --noEmit -p adws/tsconfig.json` — **not** the repo-root `bunx tsc --noEmit`. Both commands are in Validation Commands below and both must pass, but §5's verdict comes from the `adws/tsconfig.json` project. Load-bearing per the feature's async-ripple note; trivially satisfied here because Option 2 keeps the mint synchronous.
- **Seams the step definitions require, all provided by Steps 3-4:** `apiBaseUrl` (point the mint at the out-of-process stub), `runCurl` (record argv while passing through), `clearAppAuthCaches()` (reset module state between scenarios, which the feature file mandates).
- **Reused vocabulary — do not redefine.** The feature file's vocabulary note reuses exactly two registered phrases and both already have implementations: G18 `the ADW codebase is checked out` → `features/per-issue/step_definitions/ensureCronOnEveryEventSteps.ts`, and T22 `the ADW TypeScript type-check passes` → `features/per-issue/step_definitions/feature-504.steps.ts`. `feature-780.steps.ts` must **not** redefine either — cucumber throws on a duplicate step definition — and should record where each comes from in a header comment, following the convention in `feature-762.steps.ts`. Every other phrase in the feature file is new and belongs in `feature-780.steps.ts`.
- **Harness constraint 1 to respect (the stub runs out-of-process):** the feature file records empirically that a synchronous `execSync` SUT blocks the Node event loop, so an in-process stub server deadlocks (it hung 120s on the author's first attempt). The stub **must** run out-of-process, and recorded-request queries must happen after the mint call returns. Option 2 keeps the mint synchronous, so this constraint stays in force — do not let a step definition start an in-process listener.
- **Harness constraint 2 to respect (the `When` stays sync/async-agnostic):** the feature file requires `an installation token is requested for owner X repo Y` to tolerate a value **or** a thenable so the same scenario drives either candidate fix unchanged. Option 2 keeps the mint synchronous, so it returns a plain `string` — write the step so it captures either (awaiting a non-thenable is a no-op) and catches a synchronous throw. Do not rewrite the step around Option 2's synchronous return; keeping it neutral is what lets a future `fetch()` migration reuse this contract as-is.
- Once the step definitions exist, run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-780"` and confirm all seven scenarios pass.

### 8. Documentation
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — update the `appAuth.ts` row of the module table (line 43) to record that the credential travels over `curl --config -` stdin and never enters argv or a thrown message, that failures throw sanitized `GitHub App <operation> failed for <subject>: …` messages, and that the API endpoint is now injectable (closing the #701-documented blind spot).
- `README.md` — add `appAuth.test.ts` as the first entry in the `gitContext/__tests__/` block (lines 634-643, alphabetical order).
- Do not touch any other doc. In particular do **not** edit `.claude/commands/adw_init.md` (see the worktree-hygiene note in Notes).

### 9. Validate
- Run every command in **Validation Commands** below and confirm all pass with zero regressions. Expect **140 test files / 2408 + N tests**, all green.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Commands are taken from `.adw/commands.md`.

- **Reproduce before the fix** — `node repro780.mjs` (the scratch script from *Steps to Reproduce*). Expect `message contains JWT? true` and the `Authorization: Bearer …` header echoed in the `Command failed:` message. Delete the script afterwards.
- **RED proof** — with the credential temporarily restored to the argv (Step 7): `bunx vitest run adws/gitContext/__tests__/appAuth.test.ts` — tests 1, 3, and 7 fail.
- **GREEN proof** — with the fix in place: `bunx vitest run adws/gitContext/__tests__/appAuth.test.ts` — all tests pass.
- `bun run lint` — ESLint passes with zero errors and zero warnings.
- `bunx tsc --noEmit` — repo type-check passes. Also the proof that `getInstallationToken`'s new optional third parameter stays assignable to `ResolveContextTokenInput.mintInstallationToken`, and the backstop the contract's §5 asserts.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional ADW type-check passes.
- `bun run build` — build succeeds with no errors.
- `bun run test:unit` — full vitest suite green. Baseline before this change: **139 files / 2408 tests**; after: **140 files / 2408 + N tests**, zero regressions.
- `bun run lint:git-guard` — the git/gh guard still passes and still reports `(0 allowlisted)`. `adws/gitContext/` is exempt by directory and `curl` is not scanned, so this must be unchanged.
- **Verify the argv guarantee by inspection** — `grep -n "Authorization" adws/gitContext/appAuth.ts` returns exactly one hit, inside `buildCurlConfig`; `grep -n "execSync" adws/gitContext/appAuth.ts` returns nothing; `grep -n "api.github.com" adws/gitContext/appAuth.ts` returns exactly one hit, the `GITHUB_API_BASE_URL` default.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@review-proof"` — the review-proof suite still passes (required by `.adw/review_proof.md` step 4).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-780"` — all **seven** scenarios in `features/per-issue/feature-780.feature` pass. §1a, §1b, §2, §2b, §3 **and §4** are RED before the fix and GREEN after. §4 is included deliberately: every stub-driven scenario needs the `apiBaseUrl` seam to reach the stub at all, so pre-fix the mint curls real `api.github.com` and a successful mint cannot even be staged — the feature file records this as the #701 blind spot and calls §4 "the first behavioural coverage of a successful mint in the suite". Only §5 (the type-check) is GREEN both before and after. Requires the step definitions authored by `generate_step_definitions`.
- **Final scope check** — `git diff origin/dev --stat` shows only: `adws/gitContext/appAuth.ts`, `adws/gitContext/__tests__/appAuth.test.ts`, `features/per-issue/feature-780.feature`, `features/per-issue/step_definitions/feature-780.steps.ts`, `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`, `README.md`, and this spec file. Anything else — especially `.claude/commands/adw_init.md` — is out of scope.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): the new helpers are pure string functions with the single `execFileSync` side effect isolated in `execCurl`; every new failure path is a guard clause with an early `throw`; the caught `execFileSync` error is narrowed from `unknown` rather than cast to `any`; no decorators, no new abstractions. `appAuth.ts` goes from 148 to roughly 250 lines — still under the 300-line guideline, so **do not** split the module.
- **No new libraries.** Per `.adw/commands.md` the install command would be `bun add <package>`, but curl and Node builtins cover everything.
- **Why not `fetch()` (the issue's preferred Option 1) — the async-ripple fork the feature file asks the planner to decide.** `getInstallationToken` is **synchronous** and sits on a fully synchronous chain: `resolveContextToken` (`tokenResolver.ts:46`) → `resolveLaunchToken` (`launchGitContext.ts:49`) / `resolveToken` (`gitContextFactory.ts:40`) → `buildLaunchGitContext` → `new GitContext({ token })`, where `token` is a plain `string` field validated in the constructor. `fetch()` is async and Node has no synchronous HTTP client, so adopting it means making `GitContext` construction async and awaiting it at **138 non-test call sites** (`grep -c` over `gitContextFor` / `gitContextForSync` / `gitContextForRepo` / `buildLaunchGitContext`), many inside synchronous functions. That is a repo-wide refactor of the #700 boundary-constructor design, not a security fix, and it would put a large-blast-radius change on the critical auth path. The issue explicitly sanctions Option 2 for exactly this case ("If curl must stay"), and Option 2 delivers the full stated requirement — *"The JWT must not appear in any thrown error, log line, or the process argv"* — verified live. A `fetch()` migration remains worth doing as its own issue if `GitContext` construction ever goes async for other reasons; it is not a prerequisite here. The `apiBaseUrl` seam added by this plan is the part of Option 1's value that *is* worth taking now, and it transfers unchanged if that migration ever happens.
- **Why the config-stdin channel and not `-H @-`.** `curl -H @-` reads *one* header from stdin, which works but leaves the URL and method on the command line and consumes stdin for a single header. `--config -` carries the URL, all headers, the method, and `write-out` in one payload, reducing argv to the constant `curl --config -`. Verified live for both GET and POST. It also means no request detail is ever shell-quoted.
- **Verification performed while planning** (real `api.github.com` plus a local stub, macOS curl 8.7.1, Node v26.5.0):
  - Current construction leaks the JWT into `Error.message` — confirmed `true`.
  - `curl --config -` with the header on stdin: GitHub replied `401 Bad credentials`; the no-header **control** replied `401 Requires authentication`. The differing responses prove the stdin-supplied header genuinely reached GitHub rather than being silently dropped — the failure mode that would make this fix quietly break auth.
  - Against an out-of-process recording stub on `127.0.0.1` over plain HTTP: argv was `["--config","-"]` with no JWT, status parsed as `404`, and the stub recorded the exact `Bearer <jwt>` header sent — i.e. the acceptance contract's non-vacuity check is drivable as written.
  - `execFileSync('curl', ['--config','-'])` on DNS failure: `status: 6`, message `Command failed: curl --config -\ncurl: (6) Could not resolve host: api.github.invalid`, credential absent.
  - The `\n%{http_code}` trailer parses correctly with `lastIndexOf('\n')` for GET, POST, and an empty body.
- **Scope discipline — what is deliberately *not* changed:**
  - `resolveContextToken`'s propagate-loudly contract. The mint must keep throwing for a foreign/uninstalled identity. Making the mint *quieter* is the one way a well-meaning fix could reopen the GH_TOKEN-bleed class (vestmatic #143/#181/#187), which is why the unit suite guards it (test 10).
  - The public export surface. `adws/gitContext/index.ts` still re-exports exactly `{ isGitHubAppConfigured, getInstallationToken }`; `adws/github/githubAppAuth.ts` stays a pure re-export shim. The new helpers and `clearAppAuthCaches` are importable from `appAuth.ts` directly.
  - `createAppJWT`, the 10-minute JWT lifetime, `REFRESH_BUFFER_MS`, and both caches' behaviour — unchanged (a reset function is added, not new caching semantics).
  - **Input validation on `owner` / `repo` / `installationId`.** Today these interpolate into a `/bin/sh` command string; after the fix they interpolate into a curl config payload with no shell involved, which is a strict improvement (a stray quote makes curl fail to parse its config — fail-closed — rather than executing anything). A character allowlist would be sensible follow-on hardening but is not this issue's subject.
  - **No `max-time` / retry.** The curl calls have no timeout today and still won't; a hanging mint is a pre-existing condition unrelated to log leakage. Worth its own issue.
  - **No logging added.** The module logs nothing today and must keep logging nothing — contract §1b asserts the log stream is as clean as the error, and the module docstring's standalone-reusability constraint forbids importing ADW's logger anyway.
- **`JSON.parse` is not a confirmed leak vector.** Investigated and ruled out — V8 truncates its error snippet to the first ~10 characters of the input, which for GitHub's `{"token":"…` shape lands inside the key name. Five malformed-body shapes were probed and none reproduced a token in the message. The parse sites are routed through `describeApiFailure` for error-shape consistency, not as a leak fix. Do not spend time hunting here.
- **Exposure assessment, for the PR description.** App JWTs live 10 minutes and only authorize app-level endpoints (they cannot act on repository contents), so the observed 11:36Z disclosure is low-severity in itself. The reason to fix it is structural, and the issue states it directly: workflow logs get pasted into issues and chat, and the same construction would leak a longer-lived credential unchanged. Note that `fetchInstallationToken` handles the **installation token** — a 1-hour credential with repo write scope — over the identical channel and additionally echoed raw response bodies, so the second call site is the higher-value half of this fix even though the reported leak came from the first.
- **Conditional docs.** `.adw/conditional_docs.md` matches two entries. `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` **exists** and owns `adws/gitContext/**` — read it before editing and update its `appAuth.ts` row (Step 8). `app_docs/feature-bq1f45-git-gh-cli-guard.md` **exists** and is reference-only: it confirms `EXEMPT_PACKAGE_DIR = 'adws/gitContext'` is the sole exemption mechanism and that the scanner matches only `git`/`gh` strings, so this change is guard-neutral.
- **Worktree hygiene — an out-of-scope revert was found and discarded during planning.** This worktree was born with an uncommitted working-tree revert of `.claude/commands/adw_init.md` that deleted the entire step-7 "Copy Starter Guardrails Settings" section (issue #763, merged) and renumbered steps 8→7 and 9→8. Verified working-tree-only: `git diff HEAD origin/dev -- .claude/commands/adw_init.md` was empty, so `HEAD` still carried the merged content and the revert existed only in the unstaged working tree. Discarded with `git checkout HEAD -- .claude/commands/adw_init.md` (pure discard — no commit, no `git add -A`) and re-verified: `git status --short` clean, `git diff origin/dev --stat` empty, and the section restored at line 120. **The implementer must not re-introduce it.** This is the 10th occurrence of a known recurring worktree-birth defect; re-check `git diff origin/dev --stat` before committing and treat any diff to `.claude/commands/adw_init.md` as a blocker.
