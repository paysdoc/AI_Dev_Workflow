@adw-818 @adw-lzod6e-gitlab-and-jira-adap
Feature: The GitLab and Jira adapters take their credentials, endpoints and logger as injected input — the host application's environment and logger stop being reachable from either package, and the extraction guard widens to hold that result

  Issue #818 is the third slice of the GitContext library extraction (`specs/prd/gitcontext-library-extraction.md`,
  Implementation Decisions → De-tangling wave, third bullet; Testing Decisions → *GitLab/Jira
  injection*; user stories 9 and 10), landing on the guard #816 built and #817 first widened.

  Four lines of source are the entire entanglement, and #816's feature file already enumerated them
  as the reason the two adapter packages could not be put in scope on day one:

    • `adws/providers/gitlab/gitlabCodeHost.ts:18`  → `import { GITLAB_TOKEN, GITLAB_INSTANCE_URL } from '../../core'`
    • `adws/providers/gitlab/gitlabApiClient.ts:7`  → `import { log } from '../../core'`
    • `adws/providers/jira/jiraIssueTracker.ts:6`   → `import { log, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT } from '../../core'`
    • `adws/providers/jira/jiraApiClient.ts:6`      → `import { log } from '../../core'`

  After this slice `createGitLabCodeHost` takes an injected `{ token, instanceUrl }` and a `Logger`;
  `createJiraIssueTracker` takes an injected `{ instanceUrl, projectKey, auth }` and a `Logger`; each
  factory hands the logger down to the API client it builds. The five environment reads
  (`GITLAB_TOKEN`, `GITLAB_INSTANCE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PAT`) move to ADW's
  own wiring in `adws/providers/repoContext.ts` — the file `forgeProviders()` later replaces. The
  `Logger` port is the one `adws/gitContext/types.ts` already declares
  (`(message: string, level?: LogLevel) => void`) with `consoleLogger` as its default. No new GitLab
  or Jira capability: no `Platform.Jira`, no new `resolveIssueTracker` branch, no method that throws
  today starts working.

  What follows are the places where "move four imports" is not the whole job, each of which a
  plausible, tsc-green, suite-green, guard-green implementation gets wrong.

  TRAP 1 — THE GUARD CANNOT SEE A `process.env` READ. The extraction rule is an AST rule over import
  specifiers. Rewriting `import { GITLAB_TOKEN } from '../../core'` into a bare
  `process.env.GITLAB_TOKEN` inside the adapter removes the import, passes the widened guard, passes
  every "fake config in, request out" unit test, and leaves the adapter reading the host's
  environment — which is the single thing story 9 exists to stop. The same hole swallows the
  friendlier variant, `config.token ?? process.env.GITLAB_TOKEN`, which additionally passes any test
  that supplies a token. §2 and §4 therefore run every adapter drive in a CHILD PROCESS whose
  environment carries a poisoned value for each of the five variables, and assert that the poison
  never reaches the wire and never substitutes for absent configuration. A read performed at module
  import time is why this cannot be done in-process: Cucumber has already imported the adapter
  before any hook could set the variable.

  TRAP 2 — THE JIRA AUTH SELECTION IS BEHAVIOUR, AND IT CHANGES HOMES. `createJiraIssueTracker`
  today decides between Cloud and Data Center itself: `JIRA_EMAIL && JIRA_API_TOKEN` wins, else
  `JIRA_PAT`, else a refusal naming all three. After this slice the adapter receives ONE `auth` value
  and has no selection left to make, while ADW's wiring must keep the identical precedence — Cloud
  beats PAT — and the identical refusal. Two distinct regressions live here. An implementation that
  keeps the environment branch and merely falls back to the injected `auth` sends `Basic` when the
  caller injected a PAT (§4). An implementation that moves the credential plumbing but drops the
  precedence makes a Cloud-configured deployment start authenticating as Data Center the moment a
  stale `JIRA_PAT` is present in the environment (§4).

  TRAP 3 — "CONSOLE DEFAULT PRESERVED" MEANS THE PORT'S DEFAULT, NOT ADW's `log`. The two are
  different functions with different output. `consoleLogger` (`adws/gitContext/consoleLogger.ts`)
  writes the bare message and ignores the level. ADW's `log` (`adws/core/logger.ts:61`) writes
  `<emoji> [<ISO timestamp>] <message>` and reddens errors. Defaulting the parameter to ADW's `log`
  looks like "preserving" the console behaviour and reinstates the exact `../../core` import the
  issue removes; defaulting to a fresh inline `console.log` wrapper duplicates a port the extractable
  set already owns. §5 pins the default by what it emits.

  TRAP 4 — THE LEVEL ARGUMENT IS PART OF THE PORT. Every call site being rewritten passes one:
  `'error'` from both API clients, `'success'`, `'warn'` and `'info'` from `JiraIssueTracker`. The
  port's signature carries `level?`, so dropping the argument compiles, prints the same text under
  the console default, and silently flattens every diagnostic to the default level for any consumer
  that routes on it. §5 asserts the level alongside the message.

  TRAP 5 — THE SCOPE WIDENS TO THE TWO DIRECTORIES, AND NOT ONE PATH FURTHER. The issue names six
  files, but scope entries are paths and the guard walks directories. Two failure modes bracket the
  right answer. Too narrow: entering only the six named files leaves `mappers.ts`, `gitlabTypes.ts`,
  `adfConverter.ts`, `jiraTypes.ts` and both `index.ts` barrels unchecked, so the next edit to any of
  them can re-entangle the package silently. Too wide: widening to `adws/providers/**` puts
  `repoContext.ts` in scope — the very file RECEIVING the environment reads, which imports
  `../github/gitContextFactory` and `../core/projectConfig` by design — alongside three
  still-entangled `adws/providers/github/*` modules belonging to later slices, and AC4's "guard
  green" becomes unsatisfiable without doing the rest of the wave in the same PR. §6 pins both
  edges.

  TRAP 6 — THE NEW UNIT TESTS LIVE INSIDE THE NEWLY-GUARDED DIRECTORIES. AC2 puts them in
  `adws/providers/gitlab/__tests__/` and `adws/providers/jira/__tests__/`, which is inside the scope
  §6 widens. They import `vitest`, and a test asserting "no environment read remaining" may well
  import framework paths deliberately. `isScannable` already excludes `__tests__/**` and `*.test.ts`,
  and §6 pins that exclusion for these two directories specifically, because the alternative —
  discovering it after merge — is a red build on the tests AC2 requires.

  TRAP 7 — TWO EXISTING SUITES CONSTRUCT THESE CLASSES POSITIONALLY, AND A THIRD PINS THE FACTORY
  NAMES. `refusalStubs.test.ts` builds `new GitLabCodeHost(REPO_ID, {} as GitLabApiClient)` and
  `new JiraIssueTracker({} as JiraApiClient, 'ADW')`; `boardManager.test.ts` calls
  `createGitLabBoardManager()` and `createJiraBoardManager()` with no arguments;
  `checkGitGhGuard.test.ts:566-569` requires `export function createGitLabCodeHost(`,
  `createGitLabBoardManager(`, `createJiraIssueTracker(` and `createJiraBoardManager(` to still be
  declared under those names, because all four are entries in `PROVIDER_CONSTRUCTORS`
  (`adws/guard/constructionRule.ts:42-45`). Renaming a factory or making the logger a required
  leading parameter turns AC5 red in a place nothing in this issue's file list points at. §7 pins
  the arities that must survive.

  HOW THESE SCENARIOS OBSERVE THE SYSTEM. Every assertion targets a runtime artefact. §1-§5 stand a
  real HTTP recorder on `127.0.0.1`, hand its address to the adapter AS THE INJECTED `instanceUrl`,
  and assert the method, path, headers and body it captured — observability surface 2, and the one
  surface on which "configuration arrives injected" is visible at all, since both clients are opaque
  otherwise (GitLab spawns `curl`, Jira calls `fetch`). Logging is observed through a capturing
  logger's recorded calls and, for the default, through the child process's stdout — surface 5.
  §6 observes the guard through the exit status and diagnostic of the real runner — surfaces 4 and 5.
  No scenario reads a source file and asserts against its contents; no scenario asserts that a
  module, an export or a parameter exists.

  A NOTE FOR THE STEP DEFINITIONS, because four of these are easy to get wrong in a way that makes a
  scenario pass vacuously:

    • THE RECORDER IS A REAL SERVER, NOT A SPY. `http.createServer` bound to `127.0.0.1:0`, recording
      `{ method, url, headers, body }` per request and replying with the canned JSON body the
      scenario's Given selected (default `{}`). Both clients then run through their DEFAULT
      transport — a real `curl`, a real `fetch` — which is the point: the vitest suites AC2 asks for
      drive an injected `runCurl`/`fetchFn` seam, so these scenarios are the only place the shipped
      transport is exercised end to end.
    • EVERY ADAPTER DRIVE RUNS IN A CHILD PROCESS. `execFileSync('bunx', ['tsx', driverPath], { cwd:
      repoRoot, env: { ...process.env, ...poison, NODE_OPTIONS: '' } })`, as feature-816.steps.ts
      established. The driver is written to `os.tmpdir()` — NOT under `adws/` — and imports the
      adapter by absolute path, so it never becomes a file the whole-repo guard scenario in §7 can
      trip over. It writes the capturing logger's recorded `(message, level)` pairs to a temp JSON
      file and never to stdout, so the stdout assertions in §5 see exactly what the adapter emitted
      and nothing else.
    • THE JIRA WRITES ARE FIRE-AND-FORGET. `commentOnIssue` and `deleteComment` return `void` and log
      from a `.then()`; the driver must await the settled promise (an `await new Promise(setImmediate)`
      after the call is enough) before writing its recording file, or the success line is never
      captured and §5 passes for the wrong reason.
    • ADW's WIRING MUST BE REACHABLE. §2 drives the live GitLab path through
      `resolveCodeHost(Platform.GitLab, repoId)`, which already exists. Jira has no live resolution
      path — `Platform` has no Jira member and adding one would be the new capability this issue
      forbids — so the Jira environment reads land in `adws/providers/repoContext.ts` behind an
      EXPORTED credential resolver, which is what §4's wiring scenarios import and call. Inlining
      those reads in a private function makes the precedence in TRAP 2 untestable.
    • REUSED, NOT REDEFINED: `the ADW codebase is checked out` (G18) and `the ADW TypeScript
      type-check passes` (T22) live in `features/step_definitions/ensureCronOnEveryEventSteps.ts:8`
      and `feature-504.steps.ts:1127`; `the git/gh guard runs across the whole ADW repository` and
      `the guard run reports no violations` live in `feature-769.steps.ts:407` and `:560`; the whole
      guard fixture-tree Given/When/Then family (`a guard fixture tree holding the file {string}:`,
      `the guard runner executes over the guard fixture tree`, and its four Then forms) lives in
      `feature-816.steps.ts`, with `resetGuardFixtureTree`/`getGuardStdout` exported there for
      exactly this reuse — this file's scenarios carry `@adw-818`, so that file's `@adw-816`-scoped
      hooks do not run for them and isolation must be forced from this file's own hooks, as
      feature-817.steps.ts does.

  Background:
    Given the ADW codebase is checked out

  # ── §1 GITLAB CONFIGURATION ARRIVES INJECTED (AC1, AC2; story 9) ───────────────────────
  #
  # The headline for GitLab, and the direction that proves the new signature does something rather
  # than merely accepting an argument it ignores. `GitLabApiClient` builds
  # `${instanceUrl}/api/v4/${path}` and sends `PRIVATE-TOKEN: ${token}`; both values must be the
  # injected ones, on every call path, with the URL-encoded project path derived from the bound
  # RepoIdentifier rather than from anything ambient.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: The injected token and endpoint are what reach the wire when a merge request is opened
    Given a recording forge endpoint is listening
    And GitLab code-host configuration for "acme/widget" with token "glpat-injected-abc" pointing at the recording endpoint
    When the GitLab code host opens a merge request from "feat-818" to "main" titled "Inject the config"
    Then the recording endpoint received a "POST" request to "/api/v4/projects/acme%2Fwidget/merge_requests"
    And the recorded request carried the header "PRIVATE-TOKEN" with value "glpat-injected-abc"
    And the recorded request body carried "source_branch" set to "feat-818"
    And the recorded request body carried "target_branch" set to "main"
    And the recorded request body carried "title" set to "Inject the config"

  # Every read path, not just the write one. `getDefaultBranch`, `fetchPullRequest`,
  # `fetchReviewComments` and `listOpenPullRequests` each build their own path through the same
  # private `request`, and an implementation that threads the injected instance URL into the
  # constructor but leaves one call site reading a module-level constant is green on the scenario
  # above and broken here.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario Outline: Every GitLab read path builds its request from the injected endpoint and token
    Given a recording forge endpoint is listening
    And GitLab code-host configuration for "acme/widget" with token "glpat-injected-abc" pointing at the recording endpoint
    When the GitLab code host performs the "<operation>" operation
    Then the recording endpoint received a "GET" request to "<path>"
    And the recorded request carried the header "PRIVATE-TOKEN" with value "glpat-injected-abc"

    Examples:
      | operation             | path                                                       |
      | default branch        | /api/v4/projects/acme%2Fwidget                             |
      | fetch pull request 7  | /api/v4/projects/acme%2Fwidget/merge_requests/7            |
      | fetch review comments | /api/v4/projects/acme%2Fwidget/merge_requests/7/discussions |
      | list open requests    | /api/v4/projects/acme%2Fwidget/merge_requests?state=opened  |

  # The trailing-slash normalisation is a behaviour of the current client
  # (`instanceUrl.replace(/\/+$/, '')`), not an accident, and it is exactly the kind of line that
  # evaporates when a constructor argument is replaced by a config object. Without it a
  # `.adw/providers.md` entry ending in `/` produces `//api/v4/…` and every request 404s.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: A trailing slash on the injected GitLab endpoint is normalised away
    Given a recording forge endpoint is listening
    And GitLab code-host configuration for "acme/widget" with token "glpat-injected-abc" pointing at the recording endpoint with a trailing slash
    When the GitLab code host performs the "default branch" operation
    Then the recording endpoint received a "GET" request to "/api/v4/projects/acme%2Fwidget"

  # The refusal survives the move, but it changes vocabulary. Today the factory throws
  # "GITLAB_TOKEN environment variable is required …" and tells the caller which dotenv file to edit
  # — a message that only makes sense to a caller that reads ADW's own configuration. An adapter that
  # no longer touches the environment must not keep naming the host's environment variables; the
  # wiring that DOES read them owns that message (§2). What must not change is that an unconfigured
  # code host refuses loudly rather than issuing an unauthenticated request.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: A GitLab code host configured without a token refuses instead of calling out unauthenticated
    Given a recording forge endpoint is listening
    And GitLab code-host configuration for "acme/widget" with no token pointing at the recording endpoint
    When the GitLab code host performs the "default branch" operation
    Then the adapter refuses with an error
    And the adapter's refusal names no environment variable
    And the recording endpoint received no request

  # ── §2 THE GITLAB ADAPTER NO LONGER CONSULTS THE ENVIRONMENT (AC1, AC2) ────────────────
  #
  # TRAP 1, in both of its shapes. Each scenario below runs the adapter in a child process whose
  # environment carries a poisoned value, so a `process.env` read at module scope or at call time is
  # visible in the recorded request. The first pair proves the poison loses to injected
  # configuration; the third proves it is not a fallback when configuration is absent.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: A poisoned GitLab token in the environment never reaches the wire
    Given a recording forge endpoint is listening
    And the adapter runs with "GITLAB_TOKEN" set to "glpat-POISON-from-environment" in its environment
    And GitLab code-host configuration for "acme/widget" with token "glpat-injected-abc" pointing at the recording endpoint
    When the GitLab code host performs the "default branch" operation
    Then the recorded request carried the header "PRIVATE-TOKEN" with value "glpat-injected-abc"
    And no recorded request carried the value "glpat-POISON-from-environment"

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: A poisoned GitLab instance URL in the environment never redirects the request
    Given a recording forge endpoint is listening
    And the adapter runs with "GITLAB_INSTANCE_URL" set to "https://poison.invalid" in its environment
    And GitLab code-host configuration for "acme/widget" with token "glpat-injected-abc" pointing at the recording endpoint
    When the GitLab code host performs the "default branch" operation
    Then the recording endpoint received a "GET" request to "/api/v4/projects/acme%2Fwidget"

  # The `??` fallback, isolated. This is the scenario that fails for an implementation which accepts
  # the injected config, is green on everything above, and quietly backfills from the environment
  # when a field is missing — the shape a well-meaning "keep it backwards compatible" edit produces.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: An absent injected token is not backfilled from the environment
    Given a recording forge endpoint is listening
    And the adapter runs with "GITLAB_TOKEN" set to "glpat-POISON-from-environment" in its environment
    And GitLab code-host configuration for "acme/widget" with no token pointing at the recording endpoint
    When the GitLab code host performs the "default branch" operation
    Then the adapter refuses with an error
    And the recording endpoint received no request

  # The other half of "the reads MOVE": they must still happen, in their new home. `resolveCodeHost`
  # is the live wiring path — `mintBoundProviders` reaches it for `Platform.GitLab` — so an
  # implementation that strips the environment out of the adapter and forgets to put it back in
  # `repoContext.ts` breaks every real GitLab deployment while every scenario above stays green.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: ADW's wiring reads the GitLab environment and hands it to the adapter
    Given a recording forge endpoint is listening
    And the adapter runs with "GITLAB_TOKEN" set to "glpat-from-environment" in its environment
    And the adapter runs with "GITLAB_INSTANCE_URL" pointing at the recording endpoint
    When ADW's provider wiring resolves a GitLab code host for "acme/widget" and performs the "default branch" operation
    Then the recording endpoint received a "GET" request to "/api/v4/projects/acme%2Fwidget"
    And the recorded request carried the header "PRIVATE-TOKEN" with value "glpat-from-environment"

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: ADW's wiring refuses by name when the GitLab token is absent from the environment
    Given a recording forge endpoint is listening
    And the adapter runs with "GITLAB_TOKEN" set to "" in its environment
    And the adapter runs with "GITLAB_INSTANCE_URL" pointing at the recording endpoint
    When ADW's provider wiring resolves a GitLab code host for "acme/widget" and performs the "default branch" operation
    Then the adapter refuses with an error naming "GITLAB_TOKEN"
    And the recording endpoint received no request

  # ── §3 JIRA CONFIGURATION ARRIVES INJECTED (AC1, AC2; story 9) ─────────────────────────
  #
  # The same direction for Jira, where the injected `auth` decides the Authorization header outright:
  # Cloud credentials produce `Basic base64(email:token)`, a personal access token produces
  # `Bearer <pat>`. The two shapes are the whole reason `JiraAuth` is a union, and the header is the
  # only place the choice is observable.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: Injected Jira cloud credentials produce basic authentication against the injected endpoint
    Given a recording forge endpoint is listening
    And Jira issue-tracker configuration with project key "ADW" and cloud auth "bot@example.com" / "jira-injected-token" pointing at the recording endpoint
    When the Jira issue tracker comments "Build green" on issue 42
    Then the recording endpoint received a "POST" request to "/rest/api/3/issue/ADW-42/comment"
    And the recorded request carried basic authentication for "bot@example.com" and "jira-injected-token"
    And the recorded request body carried a document under "body"

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: An injected Jira personal access token produces bearer authentication against the injected endpoint
    Given a recording forge endpoint is listening
    And Jira issue-tracker configuration with project key "ADW" and personal-access-token auth "jira-injected-pat" pointing at the recording endpoint
    When the Jira issue tracker comments "Build green" on issue 42
    Then the recording endpoint received a "POST" request to "/rest/api/3/issue/ADW-42/comment"
    And the recorded request carried the header "authorization" with value "Bearer jira-injected-pat"

  # The project key is injected too, and it is not decorative: it composes every issue key the
  # adapter addresses. A key read from `JIRA_PROJECT_KEY` — which `adws/core` also exports and which
  # this issue deliberately does not list among the five reads that move — silently addresses the
  # wrong project.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario Outline: The injected project key composes the addressed issue key
    Given a recording forge endpoint is listening
    And the adapter runs with "JIRA_PROJECT_KEY" set to "POISON" in its environment
    And Jira issue-tracker configuration with project key "<key>" and personal-access-token auth "jira-injected-pat" pointing at the recording endpoint
    When the Jira issue tracker comments "Build green" on issue <issue>
    Then the recording endpoint received a "POST" request to "/rest/api/3/issue/<key>-<issue>/comment"

    Examples:
      | key | issue |
      | ADW | 42    |
      | OPS | 7     |

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: A trailing slash on the injected Jira endpoint is normalised away
    Given a recording forge endpoint is listening
    And Jira issue-tracker configuration with project key "ADW" and personal-access-token auth "jira-injected-pat" pointing at the recording endpoint with a trailing slash
    When the Jira issue tracker comments "Build green" on issue 42
    Then the recording endpoint received a "POST" request to "/rest/api/3/issue/ADW-42/comment"

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: A Jira issue tracker configured without authentication refuses instead of calling out unauthenticated
    Given a recording forge endpoint is listening
    And Jira issue-tracker configuration with project key "ADW" and no auth pointing at the recording endpoint
    When the Jira issue tracker comments "Build green" on issue 42
    Then the adapter refuses with an error
    And the adapter's refusal names no environment variable
    And the recording endpoint received no request

  # ── §4 THE JIRA ENVIRONMENT READS AND THE AUTH SELECTION BOTH CHANGE HOMES (AC1, AC2) ──
  #
  # TRAP 2. The first two scenarios are the adapter half: whichever `auth` the caller injected is the
  # one that goes on the wire, even when the environment holds a complete, plausible, contradictory
  # set of credentials. The PAT row is the load-bearing one — an implementation that keeps
  # `if (JIRA_EMAIL && JIRA_API_TOKEN)` at the top of the factory and treats the injected `auth` as
  # the fallback sends `Basic` here, and every naive injection test still passes because none of them
  # set the environment.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: Injected personal-access-token auth wins over a complete cloud credential pair in the environment
    Given a recording forge endpoint is listening
    And the adapter runs with "JIRA_EMAIL" set to "poison@example.com" in its environment
    And the adapter runs with "JIRA_API_TOKEN" set to "jira-POISON-token" in its environment
    And Jira issue-tracker configuration with project key "ADW" and personal-access-token auth "jira-injected-pat" pointing at the recording endpoint
    When the Jira issue tracker comments "Build green" on issue 42
    Then the recorded request carried the header "authorization" with value "Bearer jira-injected-pat"
    And no recorded request carried the value "poison@example.com"

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: Injected cloud auth wins over a personal access token in the environment
    Given a recording forge endpoint is listening
    And the adapter runs with "JIRA_PAT" set to "jira-POISON-pat" in its environment
    And Jira issue-tracker configuration with project key "ADW" and cloud auth "bot@example.com" / "jira-injected-token" pointing at the recording endpoint
    When the Jira issue tracker comments "Build green" on issue 42
    Then the recorded request carried basic authentication for "bot@example.com" and "jira-injected-token"
    And no recorded request carried the value "jira-POISON-pat"

  # The wiring half: the precedence the factory is losing has to reappear intact in
  # `repoContext.ts`. Row 1 is the regression a Cloud deployment suffers if precedence is dropped
  # and a stale personal access token lingers in the environment; row 2 is the Data Center path;
  # row 3 is the Cloud-only path with no token present at all.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario Outline: ADW's wiring keeps the documented Jira credential precedence
    Given a recording forge endpoint is listening
    And the adapter runs with "JIRA_EMAIL" set to "<email>" in its environment
    And the adapter runs with "JIRA_API_TOKEN" set to "<apiToken>" in its environment
    And the adapter runs with "JIRA_PAT" set to "<pat>" in its environment
    When ADW's provider wiring resolves Jira credentials and the issue tracker comments on issue 42 at the recording endpoint with project key "ADW"
    Then the recorded request carried the header "authorization" beginning with "<scheme>"

    Examples:
      | email           | apiToken      | pat     | scheme |
      | bot@example.com | env-api-token | env-pat | Basic  |
      |                 |               | env-pat | Bearer |
      | bot@example.com | env-api-token |         | Basic  |

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: ADW's wiring refuses by name when no Jira credentials are present in the environment
    Given a recording forge endpoint is listening
    And the adapter runs with "JIRA_EMAIL" set to "" in its environment
    And the adapter runs with "JIRA_API_TOKEN" set to "" in its environment
    And the adapter runs with "JIRA_PAT" set to "" in its environment
    When ADW's provider wiring resolves Jira credentials and the issue tracker comments on issue 42 at the recording endpoint with project key "ADW"
    Then the adapter refuses with an error naming "JIRA_PAT"
    And the recording endpoint received no request

  # ── §5 BOTH ADAPTERS LOG THROUGH THE INJECTED PORT (AC3; story 10) ─────────────────────
  #
  # TRAP 4 first. The logger must reach BOTH layers of each adapter, and the levels must survive.
  # `GitLabCodeHost` itself never logs — only its API client does — so the GitLab row proves the
  # factory threads the port down into the client it builds. Jira exercises both layers: the
  # `success` line comes from `JiraIssueTracker.commentOnIssue`, the `warn` line from
  # `JiraApiClient.request`'s rate-limit branch. Three of the four levels in use are covered here;
  # an implementation that drops the level argument is green on the message and red on the level.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: The GitLab API client reports a rejected request through the injected logger
    Given a recording forge endpoint is listening
    And the recording endpoint replies to every request with an unauthorized error body
    And GitLab code-host configuration for "acme/widget" with token "glpat-injected-abc" pointing at the recording endpoint
    And a capturing logger is injected into the GitLab code host
    When the GitLab code host performs the "default branch" operation
    Then the injected logger recorded a message containing "GitLab API" at level "error"

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: The Jira issue tracker reports a posted comment through the injected logger
    Given a recording forge endpoint is listening
    And Jira issue-tracker configuration with project key "ADW" and personal-access-token auth "jira-injected-pat" pointing at the recording endpoint
    And a capturing logger is injected into the Jira issue tracker
    When the Jira issue tracker comments "Build green" on issue 42
    Then the injected logger recorded a message containing "ADW-42" at level "success"

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: The Jira API client reports rate limiting through the injected logger
    Given a recording forge endpoint is listening
    And the recording endpoint replies to every request with a rate-limit status
    And Jira issue-tracker configuration with project key "ADW" and personal-access-token auth "jira-injected-pat" pointing at the recording endpoint
    And a capturing logger is injected into the Jira issue tracker
    When the Jira issue tracker comments "Build green" on issue 42
    Then the injected logger recorded a message containing "rate limited" at level "warn"

  # TRAP 3. With no logger injected the line still appears, and it appears in the PORT's default
  # form: the bare message. ADW's `log` would render the same text as
  # `<emoji> [2026-09-08T…Z] <message>` and redden the error, so the second assertion is what
  # separates "defaulted to `consoleLogger`" from "defaulted to the framework logger the guard is
  # meant to have made unreachable" — an implementation doing the latter is green on the first
  # assertion alone.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: With no logger injected the Jira issue tracker falls back to the port's console default
    Given a recording forge endpoint is listening
    And Jira issue-tracker configuration with project key "ADW" and personal-access-token auth "jira-injected-pat" pointing at the recording endpoint
    And no logger is injected into the Jira issue tracker
    When the Jira issue tracker comments "Build green" on issue 42
    Then the adapter wrote a line containing "ADW-42" to stdout
    And no line the adapter wrote to stdout carries ADW's timestamped log decoration

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: With no logger injected the GitLab API client falls back to the port's console default
    Given a recording forge endpoint is listening
    And the recording endpoint replies to every request with an unauthorized error body
    And GitLab code-host configuration for "acme/widget" with token "glpat-injected-abc" pointing at the recording endpoint
    And no logger is injected into the GitLab code host
    When the GitLab code host performs the "default branch" operation
    Then the adapter wrote a line containing "GitLab API" to stdout
    And no line the adapter wrote to stdout carries ADW's timestamped log decoration

  # ── §6 THE GUARD SCOPE WIDENS TO BOTH ADAPTER DIRECTORIES, AND NO FURTHER (AC4) ────────
  #
  # The machine-checkable half of the whole slice, and the part that keeps it from being undone. Each
  # row below is a file that reaches `../../core` at a line that exists today; after this issue every
  # one of them must fail the build. Until the scope widens they all pass, which is why this outline
  # is the pivot: an implementation that removes the imports but forgets the scope entries leaves AC1
  # unenforced and this scenario red.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario Outline: A framework import from a named adapter module fails the guard by name
    Given a guard fixture tree holding the file "<path>":
      """
      import { log } from '../../core';

      export function announce(): void {
        log('hello');
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "<path>"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule

    Examples:
      | path                                        |
      | adws/providers/gitlab/gitlabCodeHost.ts     |
      | adws/providers/gitlab/gitlabApiClient.ts    |
      | adws/providers/gitlab/gitlabBoardManager.ts |
      | adws/providers/jira/jiraIssueTracker.ts     |
      | adws/providers/jira/jiraApiClient.ts        |
      | adws/providers/jira/jiraBoardManager.ts     |

  # TRAP 5, too-narrow edge. None of these five appear in the issue's file list, because none of them
  # is entangled today — `mappers.ts` and both `gitlabTypes.ts`/`jiraTypes.ts` reach only `../types`
  # and their own siblings, `adfConverter.ts` imports nothing at all, and the barrels only re-export.
  # That is precisely why the scope entry has to be the DIRECTORY: six file entries pass this
  # outline's sibling rows only by leaving them unguarded, and the first re-entanglement lands
  # silently.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario Outline: A framework import from an unnamed sibling in either adapter directory fails the guard too
    Given a guard fixture tree holding the file "<path>":
      """
      import type { Borrowed } from '<specifier>';

      export type Alias = Borrowed;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "<path>"
    And the guard failure over the guard fixture tree names the import specifier "<specifier>"

    Examples:
      | path                                 | specifier              |
      | adws/providers/gitlab/mappers.ts     | ../../core             |
      | adws/providers/gitlab/gitlabTypes.ts | ../../types/issueTypes |
      | adws/providers/gitlab/index.ts       | ../../github/prApi     |
      | adws/providers/jira/adfConverter.ts  | ../../core/utils       |
      | adws/providers/jira/jiraTypes.ts     | ../../types/issueTypes |

  # The other direction, and the exact shape the de-tangled adapters take: the `Logger` port comes
  # from `adws/gitContext/`, the ports from `adws/providers/types.ts`, the raw shapes from a sibling.
  # All three resolve inside the extractable set — the two directories move together — so an
  # implementation that satisfied the guard by inlining a private logger type instead of importing
  # the port would be passing a test it did not need to pass, while a rule that flagged any specifier
  # leaving the file's own directory would fail the build on the very files this issue rewrites.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: The de-tangled adapters reaching the logger port, the provider ports and their own siblings pass the guard
    Given a guard fixture tree holding the file "adws/providers/gitlab/gitlabApiClient.ts":
      """
      import { spawnSync } from 'child_process';
      import type { Logger } from '../../gitContext/types';
      import type { GitLabProject } from './gitlabTypes';

      export function fetchProject(logger: Logger, path: string): GitLabProject {
        logger(`GET ${path}`, 'info');
        return JSON.parse(String(spawnSync('curl', [path]).stdout)) as GitLabProject;
      }
      """
    And a guard fixture tree holding the file "adws/providers/jira/jiraIssueTracker.ts":
      """
      import type { Logger } from '../../gitContext/types';
      import type { IssueTracker } from '../types';
      import { markdownToAdf } from './adfConverter';

      export function describe(logger: Logger, tracker: IssueTracker): void {
        logger(String(markdownToAdf('hi')), 'info');
        void tracker;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  # TRAP 5, too-wide edge, and the reason a one-line "widen to adws/providers" is the worst possible
  # answer. `repoContext.ts` is the file this very issue moves the environment reads INTO, and it
  # imports `../github/gitContextFactory` and `../core/projectConfig` at lines 10 and 26 by design.
  # #819 later cleaned and widened the scope by the whole `adws/providers/github` directory, so the
  # three GitHub adapter modules this row used to pin are no longer out of scope; `repoContext.ts`
  # remains the file outside the widened set. Every row here must still pass on merge day, or AC4's
  # "guard green" is unreachable without doing the rest of the wave in the same PR — the big-bang the
  # PRD exists to avoid.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario Outline: A file outside the two adapter directories is still not checked
    Given a guard fixture tree holding the file "<path>":
      """
      import { helper } from '<specifier>';

      export const value = helper;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

    Examples:
      | path                          | specifier                   |
      | adws/providers/repoContext.ts | ../github/gitContextFactory |
      | adws/providers/repoContext.ts | ../core/projectConfig       |

  # TRAP 6. AC2 puts the new unit tests inside the directories this section just put in scope, and
  # they will import `vitest` and — for the "no environment read remaining" assertions — very likely
  # framework paths on purpose. `isScannable` already excludes both shapes; this pins the exclusion
  # where it now matters, rather than discovering it as a red build on the tests AC2 requires.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario Outline: The adapters' own test files are excluded from the widened scope
    Given a guard fixture tree holding the file "<path>":
      """
      import { describe } from 'vitest';
      import { GITLAB_TOKEN } from '../../../core';

      describe('env', () => { void GITLAB_TOKEN; });
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

    Examples:
      | path                                                   |
      | adws/providers/gitlab/__tests__/gitlabApiClient.test.ts |
      | adws/providers/jira/__tests__/jiraApiClient.test.ts     |

  # The ratchet. WIDEN ONLY, NEVER NARROW is a property of a list, and the only way a test can see it
  # is by re-running what the earlier slices pinned. Every entry #816 and #817 added must still fire
  # after #818's widening.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario Outline: The scope entries the earlier slices seeded still fail on a framework import
    Given a guard fixture tree holding the file "<path>":
      """
      import { helper } from '<specifier>';

      export const value = helper;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "<path>"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule

    Examples:
      | path                                        | specifier                 |
      | adws/gitContext/branchOps.ts                | ../core                   |
      | adws/providers/types.ts                     | ../core                   |
      | adws/providers/github/mappers.ts            | ../../types/issueTypes    |
      | adws/providers/github/domain/issueShapes.ts | ../../../types/issueTypes |

  # The anti-relabel row #816 §6 introduced and #817 re-ran, re-run again because #818 is the third
  # slice to change EXTRACTION_SCOPE and the first to widen it to whole directories: a widening
  # applied to collection rather than to the extraction rule alone relabels or swallows this.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: A framework shell-out still fails under the shell-out rule, not the extraction rule
    Given a guard fixture tree holding the file "adws/core/branchHelper.ts":
      """
      import { execSync } from 'child_process';

      export function currentBranch(): string {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' });
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/core/branchHelper.ts"
    And the guard failure over the guard fixture tree cites no extraction-readiness rule

  # ── §7 THE EXISTING SUITES AND THE RATCHET (AC5) ───────────────────────────────────────
  #
  # TRAP 7. Three suites nothing in this issue's file list points at construct these classes and
  # factories at the arities they have today. The logger and the config object must therefore arrive
  # as APPENDED, OPTIONAL parameters, and the four guarded factory names must survive verbatim —
  # they are `PROVIDER_CONSTRUCTORS` entries, and `checkGitGhGuard.test.ts` fails on a rename with a
  # message pointing at the guard rather than at this issue.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: A GitLab code host built from a repository identifier and a client alone still refuses by name
    When a GitLab code host is constructed with only a repository identifier and an API client
    Then asking it to approve a pull request refuses naming "GitLabCodeHost.approvePullRequest"
    And asking it to list merged pull requests refuses naming "GitLabCodeHost.listMergedPullRequests"

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: A Jira issue tracker built from a client and a project key alone still refuses by name
    When a Jira issue tracker is constructed with only an API client and the project key "ADW"
    Then asking it to fetch labels refuses naming "JiraIssueTracker.fetchLabels"
    And asking it to list issues refuses naming "JiraIssueTracker.listIssues"

  # The board managers are in the widened scope and in the issue's file list, but they take no
  # configuration and no logger — there is nothing for them to log. They are here because a sweeping
  # "thread a logger through every factory" edit gives them a required parameter and turns
  # `boardManager.test.ts` red for a reason that has nothing to do with this issue.

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario Outline: The board manager factories still construct with no arguments and refuse by name
    When the "<platform>" board manager is constructed with no arguments
    Then asking it to find a board refuses naming "<platform>"

    Examples:
      | platform |
      | GitLab   |
      | Jira     |

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: The guard passes across the whole repository with both adapter directories in scope
    When the git/gh guard runs across the whole ADW repository
    Then the guard run reports no violations

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: TypeScript type-check passes with the adapters taking injected configuration and a logger
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
