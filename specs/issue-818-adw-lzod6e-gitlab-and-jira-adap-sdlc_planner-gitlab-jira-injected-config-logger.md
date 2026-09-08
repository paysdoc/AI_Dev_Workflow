# Feature: GitLab and Jira adapters take injected configuration and the Logger port — no environment reads, no `adws/core` imports

## Metadata
issueNumber: `818`
adwId: `lzod6e-gitlab-and-jira-adap`
issueJson: `{"number":818,"title":"GitLab and Jira adapters: injected configuration and logger port, no environment reads","body":"## Parent PRD\n\nspecs/prd/gitcontext-library-extraction.md\n\n## What to build\n\nThe GitLab and Jira adapters stop reading ADW's environment and stop logging through ADW's application logger. `createGitLabCodeHost` takes injected `{ token, instanceUrl }` and a `Logger`; `createJiraIssueTracker` takes injected `{ instanceUrl, projectKey, auth }` and a `Logger`. The API clients receive the logger from their factory. The environment reads (`GITLAB_TOKEN`, `GITLAB_INSTANCE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PAT`) move to ADW wiring in `adws/providers/repoContext.ts`, which is the file `forgeProviders()` later replaces. The `Logger` port is the one `adws/gitContext/` already defines with its console default.\n\nNo new GitLab or Jira capability. The extraction-readiness guard's scope widens to `adws/providers/gitlab/**` and `adws/providers/jira/**`.\n\nSee PRD: Implementation Decisions (De-tangling wave, third bullet), Testing Decisions (GitLab/Jira injection), user stories 9 and 10.\n\n## Acceptance criteria\n\n- [ ] No file under `adws/providers/gitlab/` or `adws/providers/jira/` imports from `adws/core`; no `process.env` read in either adapter\n- [ ] Unit tests: fake config in, outgoing request shape (URL, auth header, body) asserted; no environment read remaining\n- [ ] Both adapters log through the injected `Logger` port; console default preserved\n- [ ] Extraction-readiness guard scope widened to both adapters; guard green\n- [ ] Existing GitLab/Jira suites green\n\n## Blocked by\n#817 <!-- adw:region-overlap -->\n\n- Blocked by #816\n\n## Touched Files\n\n- adws/providers/gitlab/gitlabCodeHost.ts\n- adws/providers/gitlab/gitlabApiClient.ts\n- adws/providers/gitlab/gitlabBoardManager.ts\n- adws/providers/jira/jiraIssueTracker.ts\n- adws/providers/jira/jiraApiClient.ts\n- adws/providers/jira/jiraBoardManager.ts\n- adws/providers/repoContext.ts\n- adws/providers/gitlab/__tests__/\n- adws/providers/jira/__tests__/\n- adws/guard/extractionRule.ts\n\n## User stories addressed\n\n- User story 9\n- User story 10\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-08T11:17:54Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-09-08T11:27:18Z","body":"⏸️ **Deferred behind #817 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #817, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #817 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/guard/extractionrule.ts`\n\nThis issue will spawn automatically once #817 merges and closes. To override, remove the `#817 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Feature Description

This is the third de-tangling slice of the GitContext library extraction (`specs/prd/gitcontext-library-extraction.md`, Implementation Decisions → De-tangling wave, third bullet; Testing Decisions → "GitLab/Jira injection"; user stories 9 and 10). It makes the GitLab and Jira forge adapters extractable by removing their last two framework dependencies:

1. **Configuration is injected, never read from the environment.** `createGitLabCodeHost` takes `{ token, instanceUrl }`; `createJiraIssueTracker` takes `{ instanceUrl, projectKey, auth }`. Neither adapter imports `adws/core` or touches `process.env`. The five environment reads (`GITLAB_TOKEN`, `GITLAB_INSTANCE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PAT`) move into two small ADW wiring helpers in `adws/providers/repoContext.ts` — the transitional file `forgeProviders()` (#823) later replaces, which is why the wiring lands there and nowhere else (#823 explicitly plans to relocate "the env-to-config reads from #818" to `adws/core/`).
2. **Logging goes through the `Logger` port** (`adws/gitContext/types.ts`, `(message, level?) => void`, four levels, console default `consoleLogger`). Both API clients receive the logger from their factory; `JiraIssueTracker`'s fifteen `log(...)` calls become `this.logger(...)`. ADW's wiring injects its own `log` (structurally compatible, exactly as `gitContextFactory.ts` already does for `GitContext`); a consumer that injects nothing gets the console default.

Each factory takes the logger inside a small optional deps bag — `{ logger?, runCurl? }` for GitLab, `{ logger?, fetchFn? }` for Jira — following the codebase's Deps idiom (`GitContextDeps.logger`, `AppAuthDeps.runCurl`). The second field is the hermetic transport seam the PRD's testing decision needs ("fake config in, outgoing request or command shape asserted"): a fake curl runner records the GitLab argv, a fake `fetch` records the Jira URL, headers and body, and neither **vitest** suite spawns a process or opens a socket. The `@adw-818` scenarios deliberately do both — they bind a loopback recorder and drive the *default* transports, so the shipped path is exercised end to end rather than the seam (Testing Strategy → BDD).

Finally the extraction-readiness guard (#816) widens by exactly what this slice cleaned: `adws/providers/gitlab` and `adws/providers/jira` are appended to `EXTRACTION_SCOPE`, turning "the GitLab and Jira adapters import nothing from the framework" into a CI-enforced invariant. Two scenarios written by #816 and #817 that deliberately pinned those packages as *not yet checked* are rewritten to the remaining out-of-scope file — the visible, reviewed widening event both feature files announced.

**No new GitLab or Jira capability** (PRD Out of Scope): the emitted curl argv and Jira requests are byte-identical, the refusal stubs stay, `resolveIssueTracker` still accepts GitHub only (there is no `Platform.Jira`), and no operator-visible behaviour changes.

## User Story

As a framework developer
I want the GitLab and Jira adapters to receive their credentials and endpoints as injected configuration and to log through the injected logger port
So that no adapter reads the host application's environment or imports its utilities, and extraction of `adws/providers/` into `@paysdoc/gitcontext` remains a pure file move

## Problem Statement

`adws/providers/gitlab/gitlabCodeHost.ts` imports `GITLAB_TOKEN` and `GITLAB_INSTANCE_URL` from `adws/core`; `gitlabApiClient.ts`, `jiraApiClient.ts` and `jiraIssueTracker.ts` import `log` from `adws/core`; `jiraIssueTracker.ts` additionally imports `JIRA_EMAIL`, `JIRA_API_TOKEN` and `JIRA_PAT`. Those are the "eight entanglements across the provider adapters" feature-816 §3 counted. Because the credentials are load-time constants captured in `adws/core/environment.ts`, the adapters cannot be exercised positively in any hermetic test — feature-794 records that `createGitLabCodeHost` "cannot be arranged to succeed" from a Given — so today there is *no* test that asserts which URL, auth header or body either adapter sends. Extracted in this state, the adapters would not compile in the library (`adws/core` does not exist there), and the #816 guard cannot enforce cleanliness for the two packages until they are clean.

## Solution Statement

- **Inject, don't read.** Declare `GitLabConfig { token, instanceUrl }` (in `gitlabApiClient.ts`) and `JiraConfig { instanceUrl, projectKey, auth: JiraAuth }` (in `jiraIssueTracker.ts`). The factories validate the injected values (non-empty token/instanceUrl/projectKey, a usable auth shape) and throw library-facing messages; the ADW wiring keeps today's operator-facing messages ("`GITLAB_TOKEN` environment variable is required…", "Jira authentication not configured…") so nothing an operator sees changes.
- **Port the logger, keep the transport identical.** Both API clients take a deps bag `{ logger?, <transport>? }`; the logger defaults to `consoleLogger` from `adws/gitContext/consoleLogger.ts`, the transport defaults to today's exact `spawnSync('curl', …)` / global `fetch` call. `JiraIssueTracker` gains a `logger` constructor parameter (defaulted, so `refusalStubs.test.ts`'s two-argument construction still compiles). All `log(` call sites become `this.logger(` with the same text and level.
- **ADW wiring in `repoContext.ts`.** Add `gitLabConfigFromEnv()` and `jiraAuthFromEnv()` — pure functions over a `ForgeEnv` value whose default is bound to the existing `adws/core/environment.ts` constants (one environment-reading site per variable stays exactly where it is today). `resolveCodeHost`'s GitLab branch becomes `createGitLabCodeHost(repoId, gitLabConfigFromEnv(), { logger: log })`. `jiraAuthFromEnv` has no production caller yet (Jira is not selectable: `Platform` has no Jira member and adding one is new capability); it is the exported, unit-tested seam `forgeProviders()` consumes in #823.
- **Respect the 300-line cap.** `repoContext.ts` is exactly 300 lines today. Move `validateWorkingDirectory` and `parseOwnerRepoFromUrl` verbatim into a new `adws/providers/workspaceValidation.ts` and re-export them from `repoContext.ts` so every importer (`repoContext.test.ts`) is untouched. `validateGitRemote` **stays** — it calls `gitContextForRepo`, and `repoContext.ts` is the permanent sanctioned construction site for that call; moving it would create a new construction site the guard forbids.
- **Widen the guard by exactly the cleaned surface.** Append `adws/providers/gitlab` and `adws/providers/jira` to `EXTRACTION_SCOPE` (`since: '#818'`), extend the rule-level and scan-level tests in both directions, and rewrite the two pinned "not yet checked" rows in `feature-816.feature` §3 and `feature-817.feature` to `adws/providers/repoContext.ts`, which stays out of scope until #823.
- **Regression net.** Existing suites (`refusalStubs.test.ts`, `boardManager.test.ts`, `repoContext.test.ts`, the guard suites, `@adw-816`/`@adw-817`) stay green; the new adapter suites assert outgoing request shape from fake config in; `bunx tsc --noEmit` enumerates every call-site change (there is exactly one production caller: `resolveCodeHost`).

## Relevant Files

Use these files to implement the feature:

**Reference / conventions (read first)**
- `README.md` — project overview; the "Multi-provider abstraction", "GitContext repo-context authority" and "CI-enforced git/gh guardrail" bullets, the environment-variable list (lines ~215–221), and the `adws/providers/` tree entries (lines ~834–850). Note `README.md` already carries uncommitted edits in this worktree — edit additively, never revert them.
- `.adw/coding_guidelines.md` — 300-line file cap, `import type`, no `any`, guard clauses, isolate side effects at the edges, JSDoc on public APIs.
- `specs/prd/gitcontext-library-extraction.md` — parent PRD: Solution (de-tangling wave), Implementation Decisions (De-tangling wave, third bullet; Extraction-readiness guard), Testing Decisions (GitLab/Jira injection), Out of Scope (no new forge capabilities), user stories 9 and 10.
- `specs/issue-816-adw-i4q2gf-extraction-readiness-sdlc_planner-extraction-readiness-guard-rule.md` and `specs/issue-817-adw-6lqigx-consolidate-the-doma-sdlc_planner-consolidate-domain-model-repoidentifier.md` — the previous slices' plans; their Notes fix the widen-only contract, the guard stdout observables, and the "widen by exactly what the issue names" rule.
- `app_docs/feature-9gjajh-providers.md` — providers living doc (conditional doc: "GitLab provider, or Jira provider integration in `adws/providers/`"); update for injected config, the Logger port, the wiring helpers and `workspaceValidation.ts`.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — guard living doc (conditional doc: `[extraction-readiness]` failures, `EXTRACTION_SCOPE` contract); update the entry list for #818 (lines 44, 59, 81 today).
- `.adw/conditional_docs.md` — registry; extend the existing providers entry's conditions (no new entries — `adws/providers/**` already owns everything this slice touches, and `bun run lint:docs-index` is green on the base tree).
- `adws/github/githubAppAuth.ts` + `adws/providers/github/appAuth.ts` (+ its test) — the #792 precedent this slice mirrors: the adapter takes an explicit config value, the one env-reading site is an ADW shim, and the test proves ambient environment is ignored.
- `adws/gitContext/types.ts` (`Logger`, `LogLevel`, `GitContextDeps.logger`), `adws/gitContext/consoleLogger.ts`, `adws/gitContext/__tests__/worktreeLogger.test.ts` (`makeLoggerSpy` pattern) — the port, its console default, and how a logger spy is asserted on.
- `adws/github/gitContextFactory.ts` — shows ADW's `log` injected as the `Logger` port (`new GitContext(options, { logger: log })`); the wiring does the same.

**Adapters (the cleaned packages — after this slice, every file under both directories imports only Node built-ins, siblings, `../types`, or `../../gitContext/*`)**
- `adws/providers/gitlab/gitlabApiClient.ts` — drop `log` from `../../core`; add `GitLabConfig`, `CurlRunner`, `GitLabApiClientDeps`; constructor `(config, deps = {})`; `this.logger(...)`; curl argv unchanged.
- `adws/providers/gitlab/gitlabCodeHost.ts` — drop the `GITLAB_TOKEN`/`GITLAB_INSTANCE_URL` import; `createGitLabCodeHost(repoId, config, deps = {})` validates and threads deps to the client; class unchanged.
- `adws/providers/gitlab/index.ts` — add `export type { GitLabConfig } from './gitlabApiClient'`.
- `adws/providers/gitlab/gitlabBoardManager.ts`, `gitlabTypes.ts`, `mappers.ts` — already clean; no change (listed in the issue for the scope widening).
- `adws/providers/jira/jiraApiClient.ts` — drop `log`; add `FetchFn`, `JiraApiClientDeps`; constructor `(instanceUrl, auth, deps = {})`; `this.logger(...)`, `this.fetchFn(...)`; request shape unchanged.
- `adws/providers/jira/jiraIssueTracker.ts` — drop the `../../core` import; add `JiraConfig`; class gains `logger` (defaulted); `createJiraIssueTracker(config, deps = {})`.
- `adws/providers/jira/index.ts` — add `export type { JiraConfig } from './jiraIssueTracker'`.
- `adws/providers/jira/jiraBoardManager.ts`, `adfConverter.ts`, `jiraTypes.ts` — already clean; no change.
- `adws/providers/index.ts` — no change (`export *` from both barrels picks up the new type exports; the names collide with nothing).

**ADW wiring (transitional, replaced by #823)**
- `adws/providers/repoContext.ts` — env→config helpers, `resolveCodeHost` GitLab branch, re-exports of the moved validators; must end under 300 lines.
- `adws/providers/__tests__/repoContext.test.ts` — unchanged (imports `parseOwnerRepoFromUrl` and `mintBoundProviders` from `../repoContext`; the re-export keeps it green).
- `adws/providers/__tests__/refusalStubs.test.ts`, `boardManager.test.ts` — unchanged; must stay green (constructor shapes they use are preserved).
- `adws/core/environment.ts`, `adws/core/config.ts`, `adws/core/index.ts`, `adws/core/logger.ts` — read only; the constants and `log` stay exactly where they are. `git diff --stat -- adws/core` must be empty.

**Guard**
- `adws/guard/extractionRule.ts` — `EXTRACTION_SCOPE` (append two entries), the `EXTRACTION_SCOPE` and `flagFrameworkImports` docblocks.
- `adws/guard/__tests__/extractionRule.test.ts` — `isInExtractionScope` table, scope-list invariants, real-tree assertions.
- `adws/__tests__/checkGitGhGuard.test.ts` — scan-level extraction tests (`scanExtractionScope` with the suite's `mockReadFileSync` pattern); the "guarded factory names still exist" table pins `export function createGitLabCodeHost(` and `export function createJiraIssueTracker(` as declaration text — keep both declarations in exactly that form.
- `adws/checkGitGhGuard.ts`, `adws/guard/guardReport.ts`, `adws/guard/constructionRule.ts` — no change (read to confirm: the stdout block prints six entries; `repoContext.ts` is a PERMANENT sanctioned construction site; `createGitLabCodeHost`/`createJiraIssueTracker` remain in `PROVIDER_CONSTRUCTORS`).

**BDD**
- `features/per-issue/feature-816.feature` — §3 scenario "A package in the extractable set but outside the current scope is not yet checked" (line ~297) and its explanatory comment: rewrite the fixture from `adws/providers/gitlab/gitlabCodeHost.ts` → `../../core` to `adws/providers/repoContext.ts` → `../core/projectConfig` (the exact import at `repoContext.ts:26` today).
- `features/per-issue/feature-817.feature` — Scenario Outline "A package still awaiting its own de-tangling slice is not yet checked" (line ~291): delete the `gitlab/gitlabCodeHost.ts` and `jira/jiraIssueTracker.ts` rows, keep the `repoContext.ts` row, update the comment above it.
- `features/per-issue/step_definitions/feature-816.steps.ts` — reused as-is (`a guard fixture tree holding the file {string}:` is additive; `the guard run over the guard fixture tree passes/fails naming {string}`; `…cites the extraction-readiness rule`). No phrase changes.
- `features/per-issue/feature-794.feature` — read only; its prose about `GITLAB_TOKEN` being a load-time constant is historical and stays.

**Do not touch** — `adws/gitContext/**`, `adws/providers/github/**`, `adws/providers/types.ts`, `adws/core/**`, `adws/github/**`, `.env.sample` (the variable names and semantics are unchanged), `adws/guard/constructionRule.ts`.

### New Files
- `adws/providers/workspaceValidation.ts` — `validateWorkingDirectory` and `parseOwnerRepoFromUrl` moved verbatim out of `repoContext.ts` (imports: `existsSync`, `statSync` from `fs`; `join` from `path`). Clean, but **not** appended to `EXTRACTION_SCOPE` here — this slice widens by exactly the two packages the issue names; #819 (which widens the rest of `adws/providers/` bar `repoContext.ts`) picks it up.
- `adws/providers/gitlab/__tests__/gitlabApiClient.test.ts` — fake `runCurl`: argv shape (method, `PRIVATE-TOKEN` header, URL, `-d` body), error/logging paths, ambient env ignored.
- `adws/providers/gitlab/__tests__/gitlabCodeHost.test.ts` — factory validation; end-to-end through the factory with a fake `runCurl`: `getDefaultBranch`, `createPullRequest`, `commentOnPullRequest`, `listOpenPullRequests`, logger threading.
- `adws/providers/jira/__tests__/jiraApiClient.test.ts` — fake `fetchFn`: URL, `Authorization` header (Basic vs Bearer), JSON body, 204/non-ok/429 paths, ambient env ignored.
- `adws/providers/jira/__tests__/jiraIssueTracker.test.ts` — factory validation; end-to-end through the factory with a fake `fetchFn`: `fetchIssue`, `closeIssue`, `moveToStatus`, logger receives message + level, console default.
- `adws/providers/__tests__/forgeEnvWiring.test.ts` — `gitLabConfigFromEnv`/`jiraAuthFromEnv` over literal `ForgeEnv` values; plus the first positive GitLab mint through `mintBoundProviders` (partial `vi.mock` of `../../core/environment`), which also finally reaches `resolveBoardManager`'s swallow branch.
- `features/per-issue/step_definitions/feature-818.steps.ts` — step definitions for the `@adw-818` scenarios the scenario phase writes to `features/per-issue/feature-818.feature` (see Testing Strategy → BDD).

## Implementation Plan

### Phase 1: Foundation
Make both adapters standalone. Introduce the config and deps types, switch the API clients to `(config/auth, deps)` constructors with `logger`/transport seams defaulting to today's behaviour, replace every `log(` with `this.logger(`, and remove every `../../core` import. Change the two factories to take injected config plus a deps bag, validating the injected values. After this phase `bunx tsc --noEmit` is red at exactly one production site — `resolveCodeHost` in `repoContext.ts` — and the four new adapter test files are green.

### Phase 2: Core Implementation
Wire ADW. Extract the two pure validators into `workspaceValidation.ts` (verbatim, re-exported), add `ForgeEnv`, `gitLabConfigFromEnv` and `jiraAuthFromEnv` to `repoContext.ts` bound to the existing `adws/core/environment.ts` constants, point `resolveCodeHost` at the new factory signature with `{ logger: log }`, and prove the wiring with `forgeEnvWiring.test.ts` (pure helper tests plus the mocked positive GitLab mint). `bunx tsc --noEmit` and `bun run test:unit` green; `repoContext.ts` under 300 lines.

### Phase 3: Integration
Widen `EXTRACTION_SCOPE` by `adws/providers/gitlab` and `adws/providers/jira`, extend the guard tests in both directions, rewrite the two pinned BDD rows in `feature-816`/`feature-817`, confirm `bun run lint:git-guard` prints six entries and stays green, update the two living docs, the registry conditions and the README tree, implement the `@adw-818` step definitions, and run the full Validation Commands including the negative guard probe.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. GitLab API client — injected config, Logger port, curl seam (`adws/providers/gitlab/gitlabApiClient.ts`)
- Replace `import { log } from '../../core';` with `import type { Logger } from '../../gitContext/types';` and `import { consoleLogger } from '../../gitContext/consoleLogger';` (deep, intra-set imports — leaf modules with no side effects; the barrel would also pass the guard but pulls in the whole git core).
- Add and export:
  - `export interface GitLabConfig { readonly token: string; readonly instanceUrl: string; }` — "the injected configuration `createGitLabCodeHost` takes (#818): the personal access token (api scope) and the instance origin, e.g. `https://gitlab.com`. Never read from `process.env` inside the adapter."
  - `export type CurlResult = { readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly error?: Error };` and `export type CurlRunner = (args: readonly string[]) => CurlResult;` — the hermetic transport seam. `spawnSync`'s return value satisfies `CurlResult` structurally.
  - `export interface GitLabApiClientDeps { readonly logger?: Logger; readonly runCurl?: CurlRunner; }` — "Deps idiom: both optional so a consumer that injects nothing gets `consoleLogger` and a real `curl`."
  - A module-private `defaultCurlRunner: CurlRunner = (args) => spawnSync('curl', [...args], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });` — the exact call the class makes today.
- Constructor becomes `constructor(config: GitLabConfig, deps: GitLabApiClientDeps = {})`: `this.instanceUrl = config.instanceUrl.replace(/\/+$/, '')`, `this.token = config.token`, `this.logger = deps.logger ?? consoleLogger`, `this.runCurl = deps.runCurl ?? defaultCurlRunner` (all `private readonly`).
- In `request<T>`: build the identical `args` array; replace the `spawnSync('curl', args, …)` call with `const result = this.runCurl(args);`; replace the four `log(msg, 'error')` calls with `this.logger(msg, 'error')`. Nothing else changes — same URL template `${instanceUrl}/api/v4/${path}`, same header order, same `-d` JSON body, same error classification (spawn error, non-zero exit, `unauthorized` → 401, `'404 Not Found'` → 404), same empty-stdout → `undefined`.
- Update the module docblock: synchronous curl client; configuration injected; logs via the `Logger` port; `runCurl` is the test seam.

### 2. GitLab code host factory — injected config threaded to the client (`adws/providers/gitlab/gitlabCodeHost.ts`)
- Delete `import { GITLAB_TOKEN, GITLAB_INSTANCE_URL } from '../../core';`. Import `GitLabApiClient` plus `type { GitLabConfig, GitLabApiClientDeps }` from `./gitlabApiClient`.
- `GitLabCodeHost` class: unchanged (constructor `(repoId, client)`; it never logged). `refusalStubs.test.ts` keeps constructing it with `{} as GitLabApiClient`.
- Replace the factory with, keeping the declaration text `export function createGitLabCodeHost(` on one line (the guard test's rename-detection table matches it):
  ```ts
  /**
   * Creates a GitLabCodeHost bound to `repoId` from INJECTED configuration (#818).
   * Reads no environment; ADW's wiring (`repoContext.ts`) supplies `config`
   * from GITLAB_TOKEN / GITLAB_INSTANCE_URL and its own logger. `deps.logger`
   * defaults to `consoleLogger`, `deps.runCurl` to a real curl.
   */
  export function createGitLabCodeHost(repoId: RepoIdentifier, config: GitLabConfig, deps: GitLabApiClientDeps = {}): CodeHost {
    validateRepoIdentifier(repoId);
    validateGitLabConfig(config);
    return new GitLabCodeHost(repoId, new GitLabApiClient(config, deps));
  }
  ```
- Add a module-private `validateGitLabConfig(config)` guard: throws `'GitLab code host requires a non-empty token'` when `config.token` is blank and `'GitLab code host requires a non-empty instanceUrl'` when `config.instanceUrl` is blank. These are library-facing; the env-flavoured message moves to the wiring (step 6).
- Docblock: replace "requires GITLAB_TOKEN to be set" wording.

### 3. GitLab unit tests (`adws/providers/gitlab/__tests__/`)
- `gitlabApiClient.test.ts` — helpers: `makeRecordingCurl(stdout, status = 0)` returning `{ runCurl, calls: string[][] }`; `makeLoggerSpy()` as in `worktreeLogger.test.ts`. Config `{ token: 'glpat-fake', instanceUrl: 'https://gitlab.example.com/' }` (note the trailing slash). Assert:
  - `getProject('acme/widget')` → one call; argv contains `'-X', 'GET'`, `'-H', 'PRIVATE-TOKEN: glpat-fake'`, `'-H', 'Content-Type: application/json'`, `'-H', 'Accept: application/json'`, no `-d`, and the **last** element is `https://gitlab.example.com/api/v4/projects/acme%2Fwidget` (slash trimmed, path encoded); returns the parsed JSON.
  - `createMergeRequest('acme/widget', payload)` → `'-X', 'POST'`, `-d` followed by `JSON.stringify(payload)` (assert `JSON.parse` of the `-d` argument deep-equals the payload), URL `…/projects/acme%2Fwidget/merge_requests`.
  - `createNote(path, 7, 'hello')` → POST `…/merge_requests/7/notes`, `-d` `{"body":"hello"}`.
  - `listMergeRequests(path, 'opened')` → URL ends `/merge_requests?state=opened`; without a state no query string.
  - `getMergeRequest` / `listDiscussions` URLs.
  - Empty stdout → `undefined`.
  - `status: 1` → throws `/curl exited with code 1/` **and** the logger spy received one `error`-level message containing the path.
  - `error: new Error('spawn curl ENOENT')` → throws and logs at `error`.
  - stdout `{"message":"401 Unauthorized"}` → throws `/failed with 401/`; stdout `{"message":"404 Not Found"}` → throws `/failed with 404/`; both logged at `error`.
  - **Ambient environment is ignored** (appAuth.test pattern): set `process.env.GITLAB_TOKEN = 'ambient-token-must-be-ignored'` and `process.env.GITLAB_INSTANCE_URL = 'https://ambient.invalid'` inside `try`/`finally` (restore prior values, `delete` when previously undefined); the recorded argv carries `PRIVATE-TOKEN: glpat-fake` and the `gitlab.example.com` URL.
  - Constructing with no deps: `new GitLabApiClient(config)` does not throw (console default, real curl not invoked because no request is made).
- `gitlabCodeHost.test.ts` — `REPO_ID = { owner: 'acme', repo: 'widget', platform: Platform.GitLab }`. Assert:
  - `createGitLabCodeHost(REPO_ID, { token: '', instanceUrl: 'https://gitlab.com' })` throws `/non-empty token/`; blank `instanceUrl` throws `/non-empty instanceUrl/`; `{ owner: '' }` throws `/owner/` (via `validateRepoIdentifier`).
  - With `{ logger, runCurl }` injected: `getDefaultBranch()` (fake stdout `{"default_branch":"develop"}`) returns `'develop'` and the argv URL is `…/projects/acme%2Fwidget`; `createPullRequest({ sourceBranch, targetBranch, title, body })` (fake stdout `{"iid":9,"web_url":"https://gitlab.example.com/acme/widget/-/merge_requests/9", …}`) returns `{ url, number: 9 }` and the `-d` body maps `body` → `description`; `commentOnPullRequest(9, 'x')` → `…/merge_requests/9/notes`; `listOpenPullRequests()` → `?state=opened`.
  - Logger threading: a failing `runCurl` (`status: 22`) makes `getDefaultBranch()` throw and the **injected** logger spy receives the `error` message — proving the factory handed its deps to the client.
  - `getRepoIdentifier()` returns `REPO_ID`.

### 4. Jira API client — Logger port, fetch seam (`adws/providers/jira/jiraApiClient.ts`)
- Replace `import { log } from '../../core';` with the same two `../../gitContext/*` imports as step 1.
- Add and export `export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;` and `export interface JiraApiClientDeps { readonly logger?: Logger; readonly fetchFn?: FetchFn; }`. Module-private default `const defaultFetch: FetchFn = (url, init) => fetch(url, init);`.
- Constructor becomes `constructor(instanceUrl: string, auth: JiraAuth, deps: JiraApiClientDeps = {})` (positional `instanceUrl`/`auth` kept — the only change is the trailing deps bag); store `logger` and `fetchFn`.
- In `request<T>`: `const response = await this.fetchFn(url, options);`; the 429 `log(..., 'warn')` and the failure `log(message, 'error')` become `this.logger(...)`. URL template `${instanceUrl}/rest/api/3/${path}`, `buildHeaders()` (Basic for cloud, Bearer for PAT), body serialisation, 204 → `undefined` — all unchanged.
- Keep `JiraCloudAuth`, `JiraDataCenterAuth`, `JiraAuth`, `isCloudAuth` as they are; additionally export `isCloudAuth` (the tracker factory's validation in step 5 uses it).

### 5. Jira issue tracker — Logger port, injected config (`adws/providers/jira/jiraIssueTracker.ts`)
- Delete `import { log, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT } from '../../core';`. Add `import type { Logger } from '../../gitContext/types';`, `import { consoleLogger } from '../../gitContext/consoleLogger';`, and import `JiraApiClient, isCloudAuth, type JiraAuth, type JiraApiClientDeps` from `./jiraApiClient`.
- Add and export `export interface JiraConfig { readonly instanceUrl: string; readonly projectKey: string; readonly auth: JiraAuth; }` — "the injected configuration `createJiraIssueTracker` takes (#818); ADW's wiring supplies `auth` from `jiraAuthFromEnv()`; `instanceUrl`/`projectKey` come from the caller's own configuration (`.adw/providers.md` sections, wired by #823)."
- Class: add `private readonly logger: Logger;`; constructor `constructor(client: JiraApiClient, projectKey: string, logger: Logger = consoleLogger)` (defaulted, so `refusalStubs.test.ts`'s `new JiraIssueTracker({} as JiraApiClient, 'ADW')` still compiles). Replace all fifteen `log(` calls with `this.logger(` — same text, same levels (`success`/`error`/`warn`/`info`). Mind the `.then(...)`/`.catch(...)` callbacks in `commentOnIssue`, `deleteComment`, `getIssueState`, `fetchComments`: they are arrow functions, so `this` binds correctly.
- Replace the factory, keeping `export function createJiraIssueTracker(` on one line:
  ```ts
  /**
   * Creates a JiraIssueTracker from INJECTED configuration (#818). Reads no
   * environment; the ADW wiring in `repoContext.ts` derives `auth` from
   * JIRA_EMAIL + JIRA_API_TOKEN (Cloud) or JIRA_PAT (Data Center/Server).
   * `deps.logger` defaults to `consoleLogger`, `deps.fetchFn` to global fetch.
   */
  export function createJiraIssueTracker(config: JiraConfig, deps: JiraApiClientDeps = {}): IssueTracker {
    validateJiraConfig(config);
    const client = new JiraApiClient(config.instanceUrl, config.auth, deps);
    return new JiraIssueTracker(client, config.projectKey, deps.logger ?? consoleLogger);
  }
  ```
- Module-private `validateJiraConfig(config)`: blank `instanceUrl` → `'Jira issue tracker requires a non-empty instanceUrl'`; blank `projectKey` → `'…non-empty projectKey'`; `isCloudAuth(auth)` with blank `email` or `apiToken` → `'Jira Cloud auth requires email and apiToken'`; otherwise blank `pat` → `'Jira Data Center auth requires a pat'`.
- Update the module docblock (no environment, Logger port). The file grows from 264 to roughly 285 lines — still under 300; do not add anything else here.

### 6. Barrels (`adws/providers/gitlab/index.ts`, `adws/providers/jira/index.ts`)
- gitlab: `export type { GitLabConfig } from './gitlabApiClient';` (the deps/seam types stay deep-import-only, like the GitHub adapter's internals).
- jira: `export type { JiraConfig } from './jiraIssueTracker';` and add `isCloudAuth` next to `JiraApiClient` only if something outside the package needs it (nothing does — leave it deep-import). Keep every existing export line.
- `adws/providers/index.ts` needs no change; confirm `bunx tsc --noEmit` reports no `export *` ambiguity (the new names are unique across the three adapter barrels).

### 7. Jira unit tests (`adws/providers/jira/__tests__/`)
- `jiraApiClient.test.ts` — helper `makeRecordingFetch(body: unknown, status = 200)` returning `{ fetchFn, calls: Array<{ url: string; init: RequestInit }> }` where `fetchFn` resolves `new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })` (global `Response` exists in Node ≥ 18 and Bun). Cloud auth `{ email: 'me@example.com', apiToken: 'tok' }`, instance `https://acme.atlassian.net/`. Assert:
  - `getIssue('ADW-7')` → `url === 'https://acme.atlassian.net/rest/api/3/issue/ADW-7?expand=renderedFields'`, `init.method === 'GET'`, headers include `Authorization: Basic ${btoa('me@example.com:tok')}`, `Content-Type`/`Accept` `application/json`, no body.
  - Data Center auth `{ pat: 'pat-1' }` → `Authorization: Bearer pat-1`.
  - `addComment('ADW-7', adf)` → POST `…/issue/ADW-7/comment`, `JSON.parse(init.body) deep-equals { body: adf }`.
  - `deleteComment('ADW-7', '42')` → DELETE `…/comment/42`; a 204 response resolves `undefined`.
  - `getTransitions` → returns `transitions` array; `doTransition('ADW-7', '31')` → body `{ transition: { id: '31' } }`; `getComments` → returns `page.comments`.
  - Non-ok (500, body `boom`) → rejects `/failed with 500: boom/` and the logger spy got one `error` message.
  - 429 with `Retry-After: 7` → the logger spy got a `warn` containing `Retry-After: 7` and then the `error`.
  - **Ambient environment is ignored**: with `process.env.JIRA_PAT = 'ambient'` and `process.env.JIRA_EMAIL`/`JIRA_API_TOKEN` set to junk (restore in `finally`), the recorded header is still the injected Basic credential.
- `jiraIssueTracker.test.ts` — drive through `createJiraIssueTracker({ instanceUrl, projectKey: 'ADW', auth }, { logger, fetchFn })`. Use a scripted `fetchFn` that answers by URL/method (issue GET → a minimal `JiraIssueResponse` with `key: 'ADW-7'`, `fields.summary`, ADF description, `status.name`/`statusCategory.key`, `creator.displayName`, `labels`, `comment.comments: []`; transitions GET → `{ transitions: [{ id: '31', name: 'Done', to: { statusCategory: { key: 'done' } } }] }`; transition POST → 204). Assert:
  - Factory validation: blank `projectKey`/`instanceUrl` throw; `{ email: '', apiToken: '' }` throws `/email and apiToken/`; `{ pat: '' }` throws `/pat/`.
  - `await fetchIssue(7)` hits `/issue/ADW-7?expand=renderedFields` (project-key mapping) and maps to `{ id: 'ADW-7', number: 7, title, state: 'OPEN' | 'IN_PROGRESS' | 'CLOSED', author, labels, comments }`.
  - `await closeIssue(7)` on a `new`-category issue: transitions fetched, `POST …/transitions` with `{ transition: { id: '31' } }`, returns `true`, and the logger spy received `{ message: 'Closed Jira issue ADW-7', level: 'success' }` — the level travels with the message.
  - `await closeIssue(7)` on a `done`-category issue returns `false` and logs at `info`; a rejecting `fetchFn` makes it return `false` and log at `error`.
  - `await moveToStatus(7, BoardStatus.InProgress)` with transitions `[{ name: 'In Progress' }]` → fuzzy match, POST, `true`, `success` log; no match → `false`, `warn` log listing the available names.
  - Console default: `createJiraIssueTracker(config, { fetchFn })` (no logger) — spy `console.log` via `vi.spyOn(console, 'log').mockImplementation(() => {})`, run `closeIssue(7)`, assert `console.log` was called with the `'Closed Jira issue ADW-7'` line, restore the spy.
  - Refusal stubs unchanged: `fetchLabels()` still throws `'JiraIssueTracker.fetchLabels is not implemented'` (one representative).

### 8. Move the pure validators out of `repoContext.ts` (`adws/providers/workspaceValidation.ts`)
- Create the file with docblock "Workspace validation helpers for `createRepoContext` (moved verbatim from `repoContext.ts` in #818 to keep that file under the 300-line cap; fs-only, no identity construction, no framework imports)". Move `validateWorkingDirectory` (with `existsSync`, `statSync`, `join`) and `parseOwnerRepoFromUrl` **verbatim** — same bodies, same JSDoc, same regexes.
- In `repoContext.ts`: remove the two function bodies; drop `statSync` from the `fs` import (`existsSync`, `readFileSync` and `join` are still used by `loadProviderConfig`); add `import { validateWorkingDirectory, parseOwnerRepoFromUrl } from './workspaceValidation';` and `export { validateWorkingDirectory, parseOwnerRepoFromUrl } from './workspaceValidation';` so `repoContext.test.ts` and any other importer keep working unchanged.
- Do **not** move `validateGitRemote`: it calls `gitContextForRepo`, and `adws/providers/repoContext.ts` is the permanent sanctioned construction site (`SANCTIONED_CONSTRUCTION_SITES`, `constructionRule.ts:89`); a new file making that call would be an `unsanctioned-construction` violation, and the transitional allowlist may never grow.

### 9. ADW wiring in `repoContext.ts` — env → injected config, ADW logger injected
- Imports: `import { GITLAB_TOKEN, GITLAB_INSTANCE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT } from '../core/environment';`, `import { log } from '../core/logger';`, `import type { GitLabConfig } from './gitlab/gitlabApiClient';`, `import type { JiraAuth } from './jira/jiraApiClient';`.
- Add, near `resolveCodeHost`:
  ```ts
  /** The GitLab/Jira variables ADW's environment supplies (#818) — a value, so the wiring below is pure and testable without mocking. */
  export type ForgeEnv = Readonly<Record<'GITLAB_TOKEN' | 'GITLAB_INSTANCE_URL' | 'JIRA_EMAIL' | 'JIRA_API_TOKEN' | 'JIRA_PAT', string>>;

  const ADW_FORGE_ENV: ForgeEnv = { GITLAB_TOKEN, GITLAB_INSTANCE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT };

  /** ADW wiring (#818): the GitLab adapter's injected config from the environment; the operator-facing message stays here. Relocates to adws/core with #823. */
  export function gitLabConfigFromEnv(env: ForgeEnv = ADW_FORGE_ENV): GitLabConfig {
    if (!env.GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required for GitLab code host. Set it in your .env file.');
    }
    return { token: env.GITLAB_TOKEN, instanceUrl: env.GITLAB_INSTANCE_URL };
  }

  /** ADW wiring (#818): Jira auth from the environment — Cloud (email + API token) first, then a Data Center PAT. No production caller until forgeProviders() (#823): Platform has no Jira member and adding one is new capability. */
  export function jiraAuthFromEnv(env: ForgeEnv = ADW_FORGE_ENV): JiraAuth {
    if (env.JIRA_EMAIL && env.JIRA_API_TOKEN) return { email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN };
    if (env.JIRA_PAT) return { pat: env.JIRA_PAT };
    throw new Error('Jira authentication not configured. Set JIRA_EMAIL + JIRA_API_TOKEN (Cloud) or JIRA_PAT (Data Center/Server).');
  }
  ```
  Both error strings are today's exact adapter messages, moved — operators see no change.
- `resolveCodeHost`: the GitLab branch becomes `return createGitLabCodeHost(repoId, gitLabConfigFromEnv(), { logger: log });`. `resolveIssueTracker` and `resolveBoardManager` are unchanged (GitHub-only issue tracker; GitLab board manager still unimplemented, still swallowed by `mintBoundProviders`).
- Update the module docblock: "Also the transitional home of ADW's environment→config wiring for the GitLab and Jira adapters (#818); `forgeProviders()` (#823) replaces this file and moves that wiring to `adws/core/`."
- **Line budget.** `wc -l adws/providers/repoContext.ts` must print ≤ 299 (expected ≈ 290). If it does not, shorten the two new helper docblocks to one line each; do not touch `loadProviderConfig`, `validateGitRemote` or existing docblocks to make room.

### 10. Wiring unit tests (`adws/providers/__tests__/forgeEnvWiring.test.ts`)
- Pure helper tests with literal `ForgeEnv` values (no environment mutation, no mocks): token + URL → `{ token, instanceUrl }` passthrough; empty token → throws the `GITLAB_TOKEN environment variable is required` message; cloud pair present → `{ email, apiToken }` even when `JIRA_PAT` is also set (Cloud wins, as today); PAT only → `{ pat }`; nothing → throws `Jira authentication not configured`.
- Positive GitLab mint (the row #794's plan could not write): at the top of the file, `vi.mock('../../core/environment', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../core/environment')>()), GITLAB_TOKEN: 'glpat-test' }))` (precedent: `adws/phases/__tests__/workflowInit.test.ts`). Then `mintBoundProviders({ repoId, codeHostPlatform: Platform.GitLab, issueTrackerPlatform: Platform.GitHub })` returns a `codeHost` whose `getRepoIdentifier()` equals `repoId`, an `issueTracker`, and `boardManager === undefined` — the GitLab board manager is refused by name inside `resolveBoardManager` and swallowed, which this test now reaches for the first time. No network: nothing calls a method that runs curl.
- Keep the module-level mock in this new file only; `repoContext.test.ts` stays as it is.

### 11. Widen the extraction-readiness guard (`adws/guard/extractionRule.ts` + tests)
- Append to `EXTRACTION_SCOPE` (append only — the two #816 entries and the two #817 entries stay in place and in order):
  ```ts
  { path: 'adws/providers/gitlab', reason: 'GitLab adapter — injected config + Logger port, no environment reads (#818)', since: '#818' },
  { path: 'adws/providers/jira', reason: 'Jira adapter — injected config + Logger port, no environment reads (#818)', since: '#818' },
  ```
- Docblocks: the `EXTRACTION_SCOPE` comment gains "#818 appended the GitLab and Jira adapter packages"; the `flagFrameworkImports` docblock's list of not-yet-widened files becomes `repoContext.ts` (framework wiring until #823), the GitHub adapter modules outside `domain/` and `mappers.ts` (#819), and `workspaceValidation.ts` (clean, pending #819).
- `adws/guard/__tests__/extractionRule.test.ts`:
  - `isInExtractionScope` table: add `['adws/providers/gitlab/gitlabCodeHost.ts', true]`, `['adws/providers/jira/jiraIssueTracker.ts', true]`, `['adws/providers/jira/adfConverter.ts', true]`, `['adws/providers/gitlabX/y.ts', false]`, `['adws/providers/jiraX/y.ts', false]`, `['adws/providers/workspaceValidation.ts', false]`; keep `['adws/providers/repoContext.ts', false]` and `['adws/providers/github/githubCodeHost.ts', false]`.
  - Scope-list invariants: add "the #818 entries are present — asserted as a superset" (`byPath.get('adws/providers/gitlab') === '#818'`, same for jira). Existing superset tests untouched.
  - `flagFrameworkImports`: add "flags an in-scope GitLab file importing a framework value" (`import { GITLAB_TOKEN } from '../../core';` at `adws/providers/gitlab/gitlabCodeHost.ts` → 1 violation naming `adws/core`) and "passes a clean Jira file importing the Logger port" (`import type { Logger } from '../../gitContext/types';` + `import { consoleLogger } from '../../gitContext/consoleLogger';` + `import type { IssueTracker } from '../types';` → 0). The existing "out-of-scope providers file passes" test still names `githubCodeHost.ts` and stays.
  - Real-tree test: `expect(scopeFiles).toContain('adws/providers/gitlab/gitlabCodeHost.ts')`, `'adws/providers/gitlab/gitlabApiClient.ts'`, `'adws/providers/jira/jiraIssueTracker.ts'`, `'adws/providers/jira/jiraApiClient.ts'`; `violations` still `[]`; test files still excluded (the new `__tests__` directories must not appear).
- `adws/__tests__/checkGitGhGuard.test.ts` (`scanExtractionScope` block, `mockReadFileSync` pattern): `adws/providers/gitlab/gitlabApiClient.ts` importing `../../core` → one `extraction-readiness` violation; `adws/providers/jira/jiraIssueTracker.ts` importing `../../core` → one; `adws/providers/gitlab/gitlabCodeHost.ts` importing `../../gitContext/consoleLogger` + `./gitlabApiClient` + `../types` → zero; `adws/providers/jira/jiraApiClient.ts` importing `../../gitContext/types` → zero. Keep the block compact (this file is already 590 lines; ~35 new lines).

### 12. Rewrite the two pinned "not yet checked" BDD rows
- `features/per-issue/feature-816.feature` §3 (line ~297, "A package in the extractable set but outside the current scope is not yet checked"): change the fixture path to `adws/providers/repoContext.ts` and its body to
  ```ts
  import type { ProvidersConfig } from '../core/projectConfig';

  export function endpoint(config: ProvidersConfig): string {
    return config.codeHost;
  }
  ```
  and rewrite the comment above it: the GitLab fixture was rewritten by #818 when the scope widened by both adapters (the visible, reviewed widening event the original comment predicted); `repoContext.ts` is now the last out-of-scope providers file and #823 rewrites or deletes this scenario in turn.
- `features/per-issue/feature-817.feature`, Scenario Outline "A package still awaiting its own de-tangling slice is not yet checked" (line ~291): delete the `adws/providers/gitlab/gitlabCodeHost.ts` and `adws/providers/jira/jiraIssueTracker.ts` rows; keep `adws/providers/repoContext.ts | ../core/projectConfig`; amend the comment ("#818 cleaned `providers/gitlab` and `providers/jira` and widened the scope by both; `providers/repoContext.ts` still carries framework imports that #823 removes").
- No step-definition change: both files reuse `feature-816.steps.ts`'s fixture-tree phrases. These edits are made in the build phase; the Gherkin freeze applies only to the scenario-fix phase (`scenarioFixPhase.ts`), so they persist.
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-816 or @adw-817"` — green.

### 13. Living docs, registry, README
- `app_docs/feature-9gjajh-providers.md`: Responsibilities — replace "and GitLab code host" with "the GitLab code host (`createGitLabCodeHost(repoId, { token, instanceUrl }, { logger?, runCurl? })`) and the Jira issue tracker (`createJiraIssueTracker({ instanceUrl, projectKey, auth }, { logger?, fetchFn? })`), both from injected configuration (#818)". Contracts — add "**The GitLab and Jira adapters read zero `process.env` and import nothing from `adws/core`** (#818): configuration is injected; both log through the `Logger` port from `adws/gitContext` (default `consoleLogger`); the one environment-reading site is `repoContext.ts`'s `gitLabConfigFromEnv`/`jiraAuthFromEnv`, bound to `adws/core/environment.ts`'s constants and relocating to `adws/core/` with #823; `jiraAuthFromEnv` has no production caller until then because `Platform` has no Jira member". Configuration — one paragraph on the injected shapes and the env variables the wiring reads. Gotchas — "`adws/providers/gitlab/**` and `adws/providers/jira/**` are inside `EXTRACTION_SCOPE` since #818"; "`runCurl`/`fetchFn` are test seams (deep-import `GitLabApiClientDeps`/`JiraApiClientDeps`), not capability"; "`validateWorkingDirectory`/`parseOwnerRepoFromUrl` live in `workspaceValidation.ts` and are re-exported from `repoContext.ts`". Keep the doc well under the docs-guard line ceiling (it is 63 lines; add at most ~8).
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md`: update the three `EXTRACTION_SCOPE` mentions (lines ~44, 59, 81) — six entries total, #818 appended `adws/providers/gitlab` and `adws/providers/jira`; the still-out-of-scope list becomes `repoContext.ts`, `workspaceValidation.ts` (clean, pending #819) and the GitHub adapter modules outside `domain/`/`mappers.ts`.
- `.adw/conditional_docs.md`: extend the existing `app_docs/feature-9gjajh-providers.md` entry's Conditions with "When `createGitLabCodeHost`/`createJiraIssueTracker` need credentials, an endpoint or a logger — injected `GitLabConfig`/`JiraConfig` plus the `Logger` port; the env→config wiring (`gitLabConfigFromEnv`/`jiraAuthFromEnv`) lives in `repoContext.ts` (#818)" and "When `bun run lint:git-guard` flags `[extraction-readiness]` under `adws/providers/gitlab/` or `adws/providers/jira/` — both adapter packages are in scope since #818". No entries added or removed (`bun run lint:docs-index` stays green).
- `README.md` (additive; keep the existing uncommitted edits): tree comments for `gitlabApiClient.ts` ("synchronous curl client — injected `GitLabConfig`, `Logger` port, `runCurl` seam (#818)"), `gitlabCodeHost.ts` (append "; factory takes injected `{ token, instanceUrl }` — no environment reads (#818)"), `jiraApiClient.ts`, `jiraIssueTracker.ts` (append "; factory takes injected `{ instanceUrl, projectKey, auth }` (#818)"), new `gitlab/__tests__/` and `jira/__tests__/` entries, `repoContext.ts` (append "; transitional home of the GitLab/Jira env→config wiring (#818)"), new `workspaceValidation.ts` entry. Optionally append to the environment-variable lines 215–221: "read by `adws/providers/repoContext.ts`'s wiring, never by the adapters".

### 14. Implement the `@adw-818` step definitions (`features/per-issue/step_definitions/feature-818.steps.ts`)
- `features/per-issue/feature-818.feature` **already exists** (written by the scenario phase); read it first and implement exactly its phrases — §1–§5 drive the adapters, §6 the guard scope, §7 the existing suites and the ratchet.
- **Reuse, never redefine.** `the ADW codebase is checked out` (`features/step_definitions/ensureCronOnEveryEventSteps.ts:8`) and `the ADW TypeScript type-check passes` (`feature-504.steps.ts:1127`); `the git/gh guard runs across the whole ADW repository` (`feature-769.steps.ts:407`) and `the guard run reports no violations` (`:560`); the whole guard fixture-tree family — `a guard fixture tree holding the file {string}:`, `the guard runner executes over the guard fixture tree` and its four Then forms — from `feature-816.steps.ts`, whose `resetGuardFixtureTree`/`getGuardStdout` are exported for exactly this reuse. Those hooks are `@adw-816`-scoped and will not run for `@adw-818`, so this file must force fixture-tree isolation from its own hooks, as `feature-817.steps.ts` does.
- **The recorder is a real loopback server, not a spy.** `http.createServer` bound to `127.0.0.1:0`, recording `{ method, url, headers, body }` per request and replying with the canned body the scenario's Given selected (default `{}`). Its address is handed to the adapter **as the injected `instanceUrl`**, so both clients run through their *default* transport — a real `curl`, a real `fetch`. Hermetic here means loopback and no `gh`, not "no socket": §1–§5 deliberately open one, and that is what makes them assert the shipped path rather than the vitest seams.
- **Every adapter drive runs in a child process.** `execFileSync('bunx', ['tsx', driverPath], { cwd: repoRoot, env: { ...process.env, ...poison, NODE_OPTIONS: '' } })`, as `feature-816.steps.ts` established. This is the only vantage point from which AC1's "no `process.env` read in either adapter" and AC2's "no environment read remaining" are observable: the reads are load-time constants, so Cucumber has already imported the adapter before any in-process hook could poison a variable. Write the driver to `os.tmpdir()` — **never** under `adws/`, or §7's whole-repo guard scenario trips over it — and have it import the adapter by absolute path.
- **The capturing logger writes to a temp JSON file, never to stdout.** The driver serialises the recorded `(message, level)` pairs to a temp file the step reads back, so §5's stdout assertions see exactly what the adapter emitted and nothing else. `no line the adapter wrote to stdout carries ADW's timestamped log decoration` is asserted against `adws/core/logger.ts`'s `<emoji> [<ISO timestamp>] ` shape — that assertion is what separates the `consoleLogger` default from ADW's `log`.
- **Await the fire-and-forget Jira writes.** `commentOnIssue` and `deleteComment` return `void` and log from a `.then()`; the driver must await the settled promise (`await new Promise(setImmediate)` after the call suffices) before writing its recording file, or §5's success line is never captured and the scenario passes for the wrong reason.
- **The wiring scenarios call ADW's wiring, not a copy of it.** §2 drives GitLab through `resolveCodeHost(Platform.GitLab, repoId)`. Jira has no live resolution path (`Platform` has no Jira member and adding one is the capability this issue forbids), so §4 imports and calls the **exported** `jiraAuthFromEnv` from `repoContext.ts` — these steps are its first caller, which is why step 9 exports it rather than inlining the reads: a private function makes the TRAP 2 precedence untestable.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-818"` green with no undefined, pending or ambiguous steps.

### 15. Run the Validation Commands
- Execute every command in the Validation Commands section, in order, and fix anything red before reporting completion.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled` (vitest, `bun run test:unit`; new files under `adws/**/__tests__/` are picked up by `vitest.config.ts` and excluded from the guard's `isScannable`). Per the PRD's Testing Decisions the tests assert external behaviour only — which request or command was produced, with which configuration, and what the caller observed — never private state.

- **GitLab adapter** (`gitlabApiClient.test.ts`, `gitlabCodeHost.test.ts`): fake config in, curl argv out — method flag, `PRIVATE-TOKEN` header carrying the injected token, `https://<instance>/api/v4/...` URL with the trimmed origin and the encoded project path, `-d` JSON body; every error path throws and reaches the injected logger at `error`; ambient `GITLAB_TOKEN`/`GITLAB_INSTANCE_URL` are ignored; the factory validates its inputs and threads deps to the client.
- **Jira adapter** (`jiraApiClient.test.ts`, `jiraIssueTracker.test.ts`): fake config in, `fetch` call out — `https://<instance>/rest/api/3/...` URL, `Authorization: Basic <base64 email:token>` versus `Bearer <pat>`, JSON body, 204 handling; non-ok and 429 paths log at `error`/`warn`; ambient `JIRA_*` ignored; `fetchIssue`/`closeIssue`/`moveToStatus` through the factory with the level travelling to the injected logger; console default proven with a `console.log` spy.
- **ADW wiring** (`forgeEnvWiring.test.ts`): the pure helpers over literal `ForgeEnv` values (both messages preserved verbatim; Cloud beats PAT); the positive GitLab mint under a partial `../../core/environment` mock, bound to `repoId`, with `boardManager` undefined.
- **Guard** (`extractionRule.test.ts`, `checkGitGhGuard.test.ts`): both directions for both packages; the #818 superset invariant; the real tree collects the adapter files with zero violations.
- **Existing suites as the regression net** (unchanged): `refusalStubs.test.ts` (constructor shapes preserved), `boardManager.test.ts`, `repoContext.test.ts` (re-exported validators, GitLab-tracker refusal), the #816/#817 guard tests, `checkGitGhGuard.test.ts`'s rename-detection table.

### BDD scenarios (`@adw-818`, `features/per-issue/feature-818.feature`)
Already written by the scenario phase. No `gh` and no external network — but §1–§5 bind a real recorder on `127.0.0.1:0` and drive each adapter in a child process, because that is the only vantage point from which "configuration arrives injected" and "no environment read remaining" are both observable (step 14). Its seven sections:

1. **§1 — GitLab configuration arrives injected** (AC1, AC2; story 9). The injected token and endpoint reach the wire on the write path (`POST .../projects/acme%2Fwidget/merge_requests`, `PRIVATE-TOKEN`, `source_branch`/`target_branch`/`title` body) and on every read path (`getDefaultBranch`, `fetchPullRequest`, `fetchReviewComments`, `listOpenPullRequests`); a trailing slash on the injected endpoint is normalised away; a token-less code host refuses **naming no environment variable** and issues no request.
2. **§2 — the GitLab adapter no longer consults the environment** (AC1, AC2). Poisoned `GITLAB_TOKEN` and `GITLAB_INSTANCE_URL` in the child's environment never reach the wire and never backfill an absent injected value (the `config.token ?? process.env.GITLAB_TOKEN` shape an AST guard cannot see); and the reads still happen in their new home — `resolveCodeHost` mints a working code host from the environment, and refuses naming `GITLAB_TOKEN` when it is blank.
3. **§3 — Jira configuration arrives injected** (AC1, AC2; story 9). Injected cloud credentials produce `Basic`, an injected PAT produces `Bearer`, both against the injected endpoint; the injected `projectKey` composes the addressed issue key even with `JIRA_PROJECT_KEY` poisoned; the trailing slash is normalised; an auth-less tracker refuses naming no environment variable.
4. **§4 — the Jira environment reads and the auth selection change homes** (AC1, AC2). The injected `auth` wins outright over a complete, contradictory credential set in the environment, in both directions; and `jiraAuthFromEnv` keeps the identical precedence (Cloud beats PAT, including when a stale `JIRA_PAT` lingers) and the identical refusal naming `JIRA_PAT`.
5. **§5 — both adapters log through the injected port** (AC3; story 10). A capturing logger receives the GitLab client's `error`, the Jira tracker's `success` and the Jira client's `warn` — **message and level**, so dropping the level argument is red; with nothing injected the same line reaches stdout in the port's bare form, carrying none of ADW's `<emoji> [timestamp]` decoration.
6. **§6 — the guard scope widens to both directories and no further** (AC4). Fixture-tree runs of the real guard CLI: each of the six named adapter modules importing `../../core` now **fails** citing `extraction-readiness` (rows #816 §3 and #817 pinned green, deliberately flipped); so does every unnamed sibling (`mappers.ts`, `gitlabTypes.ts`, `adfConverter.ts`, `jiraTypes.ts`, both barrels) — the scope entry is the directory, not the six named files; a de-tangled fixture reaching `../../gitContext/types`, `../types` and its own siblings passes; the still-out-of-scope `adws/providers/repoContext.ts` and the three `adws/providers/github/*` modules still pass (widening further than the issue says is a defect); the adapters' own `__tests__` files are excluded from the widened scope; both #816 seeds and both #817 entries still fail on a framework import (widen only, never narrow); and a framework shell-out still fails under the shell-out rule, not the extraction rule.
7. **§7 — the existing suites and the ratchet** (AC5). `new GitLabCodeHost(REPO_ID, client)` and `new JiraIssueTracker(client, 'ADW')` still construct at today's arity and still refuse by name; both board-manager factories still construct with **no arguments** and refuse by name; whole-repo guard green; whole-repo type-check green.

Not covered here, by design: `bun run test:unit` is the vitest half of AC5, run by CI as for #816/#817.

### Edge Cases
- Instance URLs with one or more trailing slashes are trimmed by both clients (existing behaviour, now asserted); URL paths are otherwise concatenated verbatim, so `instanceUrl` must be an origin (`https://gitlab.example.com`), not a path.
- `GITLAB_INSTANCE_URL`'s default (`https://gitlab.com`) still comes from `adws/core/environment.ts`; the adapter itself has no default and refuses a blank `instanceUrl`.
- `JIRA_PROJECT_KEY` is deliberately **not** one of the five reads that move: `adws/core` exports it, but the project key arrives inside the injected `JiraConfig` and composes every issue key the adapter addresses. Neither adapter may consult it - `@adw-818` §3 poisons it and asserts the injected key still composes `ADW-42`.
- `isCloudAuth` discriminates on the *presence* of `email`/`apiToken` keys; `{ email: '', apiToken: '' }` is therefore a Cloud auth with blank values and must be refused by the Jira factory, not silently sent as `Basic Og==`.
- Cloud credentials win over a PAT when both are set (today's order, kept in `jiraAuthFromEnv`).
- `JiraIssueTracker`'s promise-based fire-and-forget methods (`commentOnIssue`, `deleteComment`, `getIssueState`, `fetchComments`) log from `.then`/`.catch` arrow callbacks — `this.logger` must be used, not a captured free `log`.
- `createGitLabCodeHost`/`createJiraIssueTracker` must remain `export function …(` declarations (the guard test's rename-detection table and `PROVIDER_CONSTRUCTORS` match on those names); calls to them in test files are never scanned by the construction rule, and the one production call stays inside the sanctioned `repoContext.ts`.
- `GitLabCodeHost`'s constructor and `JiraIssueTracker`'s two-argument construction keep compiling, so `refusalStubs.test.ts` is untouched.
- Deep intra-set imports (`../../gitContext/types`, `../../gitContext/consoleLogger`) resolve inside `EXTRACTABLE_SET`; `import type` from the framework would still be flagged, so no type may be borrowed from `adws/core` either.
- `adws/providers/index.ts`'s three `export *` barrels must not gain colliding names: `GitLabConfig` and `JiraConfig` are unique; the deps/seam types are deliberately not on any barrel.
- `repoContext.ts` must end under 300 lines; `jiraIssueTracker.ts` (~285) and `gitlabApiClient.ts` (~160) stay under too.
- The guard's `(0 allowlisted)` capstone line stays byte-identical; the scope block reads `6 entries` and still contains no "allowlisted" substring (`feature-700.steps.ts` parses the first `(\d+)\s+allowlisted` match).
- `mintBoundProviders` with `issueTrackerPlatform: Platform.GitLab` still throws `/gitlab/` (no Jira/GitLab issue tracker is selectable); `resolveBoardManager(Platform.GitLab)` still throws and is swallowed.
- `git diff --stat -- adws/gitContext adws/providers/github adws/core adws/github` stays empty — the git core, the GitHub adapter and the framework are untouched by this slice.
- `README.md` already has uncommitted edits in this worktree; the README step is additive and must not revert them.

## Acceptance Criteria
- No file under `adws/providers/gitlab/` or `adws/providers/jira/` imports from `adws/core` (or any path outside `adws/gitContext`/`adws/providers`), and neither directory contains `process.env` — verified by `bun run lint:git-guard` with both packages in scope and by the grep commands below.
- `createGitLabCodeHost(repoId, { token, instanceUrl }, deps?)` and `createJiraIssueTracker({ instanceUrl, projectKey, auth }, deps?)` take injected configuration; the API clients receive `deps.logger` from their factory; blank configuration is refused by name.
- New unit suites prove fake config in → outgoing request shape out (URL, auth header, body) for both adapters, and that ambient environment variables are ignored.
- Both adapters log through the injected `Logger` port; with nothing injected the console default (`consoleLogger`) is used; ADW's wiring injects `log`.
- The five environment reads live in `repoContext.ts`'s `gitLabConfigFromEnv`/`jiraAuthFromEnv` (bound to the unchanged `adws/core/environment.ts` constants) with today's operator-facing messages; `resolveCodeHost` uses them; `jiraAuthFromEnv` is exported and tested for #823.
- `EXTRACTION_SCOPE` has six entries, the two new ones `since: '#818'`; the guard is green on the real tree; the rule- and scan-level tests cover both directions for both packages.
- `feature-816.feature` §3 and `feature-817.feature`'s "awaiting its own slice" outline no longer name gitlab/jira; `@adw-816` and `@adw-817` stay green.
- `repoContext.ts` is under 300 lines; `workspaceValidation.ts` holds the two moved validators verbatim and `repoContext.ts` re-exports them.
- Existing GitLab/Jira suites (`refusalStubs.test.ts`, `boardManager.test.ts`) and the whole unit suite, type-check, lint, both guards, `lint:docs-index` and the `@adw-818` scenarios are green; no operator-visible behaviour changes (identical curl argv, Jira requests, log lines and error messages).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun install` — prepare the app (no new dependencies).
- `bun run lint` — ESLint (catches unused imports such as a leftover `statSync` or `log`).
- `bunx tsc --noEmit` — root type-check (`adws/`, `features/`, tests).
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional adws type-check from `.adw/commands.md`.
- `bun run build` — `tsc` build.
- `bun run test:unit` — full vitest run, green.
- `bunx vitest run adws/providers/gitlab adws/providers/jira adws/providers/__tests__ adws/guard/__tests__/extractionRule.test.ts adws/__tests__/checkGitGhGuard.test.ts` — the directly affected suites in isolation, green.
- `bun run lint:git-guard` — exit 0; stdout contains `Extraction-readiness scope — 6 entries` and no `[extraction-readiness]` line.
- `bun run lint:git-guard | grep -c "since #818"` — prints `2`.
- `bun run lint:git-guard | grep -c "allowlisted"` — prints `1` (only the capstone line).
- `bun run lint:docs-index` — green (no registry entries added or removed).
- `grep -rn "process.env" adws/providers/gitlab adws/providers/jira; echo "exit=$?"` — no output, `exit=1`.
- `grep -rnE "from '(\.\./)+core" adws/providers/gitlab adws/providers/jira; echo "exit=$?"` — no output, `exit=1`.
- `grep -rnE "^import .* from '[^']*'" adws/providers/gitlab adws/providers/jira --include='*.ts' | grep -v __tests__ | grep -vE "from '(\./|\.\./types|\.\./\.\./gitContext/|child_process')"; echo "exit=$?"` — no output, `exit=1` (every non-test import is a sibling, `../types`, `../../gitContext/*`, or the `child_process` built-in).
- `grep -rnE "\blog\(" adws/providers/gitlab adws/providers/jira --include='*.ts' | grep -v __tests__; echo "exit=$?"` — no output, `exit=1` (only `this.logger(` remains).
- `grep -nE "GITLAB_TOKEN|GITLAB_INSTANCE_URL|JIRA_EMAIL|JIRA_API_TOKEN|JIRA_PAT" adws/providers/repoContext.ts | grep -c "from '../core/environment'"` — prints `1` (the constants are imported there and nowhere else under `adws/providers/`).
- `grep -rnE "^export function (createGitLabCodeHost|createGitLabBoardManager|createJiraIssueTracker|createJiraBoardManager)\(" adws/providers/gitlab adws/providers/jira | wc -l` — prints `4` (all four `PROVIDER_CONSTRUCTORS` names pinned by `checkGitGhGuard.test.ts`'s rename table; `@adw-818` §7 additionally pins the board-manager factories' zero-argument construction).
- Negative end-to-end guard probe, in order:
  1. `printf "import { log } from '../../core';\nexport function probe(): void { log('x'); }\n" > adws/providers/gitlab/zzProbe.ts`
  2. `bun run lint:git-guard; echo "exit=$?"` — must print a line containing `adws/providers/gitlab/zzProbe.ts:1  [extraction-readiness]` and `exit=1`.
  3. `node -e "require('fs').unlinkSync('adws/providers/gitlab/zzProbe.ts')"` — remove the probe (use `node` unlink, not `rm`, so the repo's PreToolUse `rm` hook cannot interfere).
  4. Repeat 1–3 with `adws/providers/jira/zzProbe.ts` (same expectations).
  5. `bun run lint:git-guard; echo "exit=$?"` — `exit=0` again.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-818"` — every scenario green, no undefined/pending/ambiguous steps.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-816 or @adw-817"` — the two features whose pinned rows were rewritten stay green.
- `wc -l adws/providers/repoContext.ts adws/providers/workspaceValidation.ts adws/providers/gitlab/gitlabApiClient.ts adws/providers/gitlab/gitlabCodeHost.ts adws/providers/jira/jiraApiClient.ts adws/providers/jira/jiraIssueTracker.ts adws/guard/extractionRule.ts` — all under 300 lines.
- `git diff --stat -- adws/gitContext adws/providers/github adws/providers/types.ts adws/core adws/github .env.sample` — empty (git core, GitHub adapter, ports, framework and env template untouched).

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (or `guidelines/coding_guidelines.md` as a fallback), strictly adhere to those coding guidelines. If necessary, refactor existing code to meet the coding guidelines as part of implementing the feature.
- **No new library is needed.** `spawnSync`, global `fetch`/`Response`, and the existing `typescript` compiler API cover everything. (If one were needed, `.adw/commands.md` says `bun add <package>`.)
- **Why a deps bag rather than a bare positional `Logger`.** The issue says each factory "takes injected config and a `Logger`"; the logger is delivered inside `{ logger?, runCurl? }` / `{ logger?, fetchFn? }` because (a) that is the codebase's established Deps idiom for the extractable packages (`GitContextDeps.logger`, `AppAuthDeps.runCurl`), (b) the PRD's testing decision — assert the outgoing request shape from fake config — needs a hermetic transport seam, and a bag lets it ride alongside the logger without a fourth positional parameter, and (c) `createGitLabCodeHost(repoId, config, { logger: log })` reads the same at the call site. The seams are test infrastructure, not capability (PRD Out of Scope: no new GitLab/Jira operations).
- **Why the env constants stay in `adws/core/environment.ts`.** The issue moves the *reads* out of the adapters into ADW wiring; binding the wiring helpers to the existing constants keeps exactly one environment-reading site per variable, leaves `README.md`/`.env.sample`/`environment.ts` coherent, and preserves today's load-time capture semantics. The `ForgeEnv` value parameter makes the helpers pure and testable without touching `process.env`; the one test that needs the constants themselves (the positive mint) uses the partial-mock pattern `workflowInit.test.ts` already established. #823 relocates the helpers next to the constants in `adws/core/`.
- **Why `jiraAuthFromEnv` has no production caller.** `Platform` is `github | gitlab | bitbucket`; Jira is not selectable from `.adw/providers.md`, and adding `Platform.Jira` plus a `resolveIssueTracker` branch would be new capability the PRD rules out for this slice. #823's `forgeProviders` (`forge: 'github' | 'gitlab' | 'jira'`) is the designed consumer. The helper is exported, documented and unit-tested so that wiring already exists when #823 lands.
- **Why `workspaceValidation.ts` and not a bigger move.** `repoContext.ts` sits at exactly 300 lines and the wiring adds ~25; the coding guideline is a hard cap. The two pure validators are the only block that can move without touching identity construction (`validateGitRemote`'s `gitContextForRepo` call is pinned to the permanent sanctioned site) or the `.adw/providers.md` parser (which #823 moves to `adws/core/providerConfig.ts` — pre-empting that move here would widen this slice's remit). Re-exports keep every importer untouched. The new file is clean but deliberately **not** added to `EXTRACTION_SCOPE`: this slice widens by exactly the two packages the issue names (feature-817's warning: "a slice that widens further than its own issue says is as much a defect as one that widens less"); #819 covers the remainder of `adws/providers/`.
- **Rewriting other issues' feature files is expected.** `feature-816.feature` §3's comment says of its GitLab fixture: "When the GitLab de-tangling slice lands and widens the scope by that package, this scenario is the one that is deliberately rewritten — the scope list widening is a visible, reviewed event, which is the point." `feature-817.feature` carries the same rows. Only the fixture paths and comments change — no step phrase is added or removed, so `feature-816.steps.ts` is reused verbatim. The Gherkin freeze (`gherkinFreeze.ts`) is applied only in `scenarioFixPhase.ts`, not in the build phase.
- **Stdout contract.** `feature-700.steps.ts:233` parses the FIRST `(\d+)\s+allowlisted` match in the guard's stdout; the scope block never contains that word. The extraction block now prints six entries; the file-scan count (22 today) grows by the twelve non-test adapter files. Fixture-tree BDD steps read the `path:line  [extraction-readiness]  import '…'` lines, so the violation format must stay as #816 shaped it.
- **Behaviour preservation checklist** (nothing an operator sees changes): identical curl argv order and headers; identical Jira URL/headers/body; identical log texts and levels (now delivered through `log` injected by ADW, so the timestamp/emoji prefix is unchanged in production); identical "GITLAB_TOKEN environment variable is required…" and "Jira authentication not configured…" messages, thrown at the same moment (provider mint); the GitLab refusal stubs and the GitHub-only issue-tracker resolution are untouched.
- **Future:** #819 widens `adws/providers/github/**` (and can absorb `workspaceValidation.ts`); #823 replaces `repoContext.ts` with `forgeProviders()`, moves `gitLabConfigFromEnv`/`jiraAuthFromEnv` and `loadProviderConfig` to `adws/core/`, and wires Jira as a selectable forge — at which point the `repoContext.ts` fixtures in `feature-816`/`feature-817` are rewritten or retired for the last time.
