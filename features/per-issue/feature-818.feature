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

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: A trailing slash on the injected GitLab endpoint is normalised away
    Given a recording forge endpoint is listening
    And GitLab code-host configuration for "acme/widget" with token "glpat-injected-abc" pointing at the recording endpoint with a trailing slash
    When the GitLab code host performs the "default branch" operation
    Then the recording endpoint received a "GET" request to "/api/v4/projects/acme%2Fwidget"

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: A GitLab code host configured without a token refuses instead of calling out unauthenticated
    Given a recording forge endpoint is listening
    And GitLab code-host configuration for "acme/widget" with no token pointing at the recording endpoint
    When the GitLab code host performs the "default branch" operation
    Then the adapter refuses with an error
    And the adapter's refusal names no environment variable
    And the recording endpoint received no request

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

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: An absent injected token is not backfilled from the environment
    Given a recording forge endpoint is listening
    And the adapter runs with "GITLAB_TOKEN" set to "glpat-POISON-from-environment" in its environment
    And GitLab code-host configuration for "acme/widget" with no token pointing at the recording endpoint
    When the GitLab code host performs the "default branch" operation
    Then the adapter refuses with an error
    And the recording endpoint received no request

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

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario Outline: A framework file beside the extractable set is still not checked
    Given a guard fixture tree holding the file "<path>":
      """
      import { helper } from '<specifier>';

      export const value = helper;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

    Examples:
      | path                          | specifier         |
      | adws/core/forgeWiring.ts      | ./environment     |
      | adws/core/launchGitContext.ts | ./providerConfig  |

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

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: The guard passes across the whole repository with both adapter directories in scope
    When the git/gh guard runs across the whole ADW repository
    Then the guard run reports no violations

  @adw-818 @adw-lzod6e-gitlab-and-jira-adap
  Scenario: TypeScript type-check passes with the adapters taking injected configuration and a logger
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
