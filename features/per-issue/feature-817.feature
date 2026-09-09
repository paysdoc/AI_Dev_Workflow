@adw-817 @adw-6lqigx-consolidate-the-doma
Feature: The provider package owns its own domain model — the raw GitHub shapes become adapter-owned, RepoInfo collapses into RepoIdentifier without losing the platform discriminator, and the extraction guard's scope widens to hold the result

  Issue #817 is the second slice of the GitContext library extraction (`specs/prd/gitcontext-library-extraction.md`,
  Solution → de-tangling wave, first bullet; Implementation Decisions → De-tangling wave; user story 7),
  and the first slice to run against the guard #816 landed. Two groups of types move out of the
  framework and into the provider package, so the library's interfaces and adapters are typed only
  against types the library owns:

    1. The raw GitHub payload shapes — `GitHubIssue`, `GitHubComment`, `GitHubUser`, `GitHubLabel`,
       `GitHubMilestone`, `GitHubIssueListItem`, `IssueCommentSummary` (today in
       `adws/types/issueTypes.ts`), `PRDetails`, `PRReviewComment`, `PRListItem` (today in
       `adws/types/workflowTypes.ts`) and `RawPR` (today in `adws/github/prApi.ts`) — become
       adapter-owned modules under `adws/providers/github/domain/`, and the framework imports them
       from there.
    2. `RepoInfo` collapses into the provider package's `RepoIdentifier`. Every consumer takes
       `RepoIdentifier`; no alias and no re-export survives.

  The issue calls this a mechanical rename with no behaviour change, and it mostly is. What follows
  are the four places where it is not, each of which a plausible, tsc-green, suite-green
  implementation gets wrong.

  TRAP 1 — THERE ARE TWO `RepoInfo` DECLARATIONS, NOT ONE. `adws/github/githubApi.ts:10` is the one
  the issue names. `adws/providers/github/githubIdentity.ts:20` declares a second, structurally
  identical `RepoInfo` of its own, and it is the one that actually flows: `parseGitHubRemoteUrl`
  returns it, `readLocalRepoInfo` returns it, and `githubApi.getRepoInfo` is a one-line delegation to
  that. Deleting only the framework copy satisfies AC1 completely — no provider file imports from
  `adws/github/` afterwards — while leaving the tree with two repo-identity shapes, which is exactly
  what AC2 forbids. §2 fails on the survivor by name.

  TRAP 2 — `RepoInfo` AND `RepoIdentifier` ARE NOT THE SAME SHAPE. `RepoInfo` is `{ owner, repo }`.
  `RepoIdentifier` is `{ owner, repo, platform: Platform }` — `platform` is REQUIRED, and it is not
  decoration. Three sites gate real behaviour on it:

    • `adws/adwMerge.tsx:247`            `notifyBlockedTransition: repoId.platform === Platform.GitHub ? notifyBlockedTransition : async () => undefined`
    • `adws/phases/prReviewCompletion.ts:110`  `if (repoContext.repoId.platform === Platform.GitHub)` → HITL blocked-transition notification
    • `adws/phases/workflowCompletion.ts:232`  `if (repoContext.repoId.platform === Platform.GitHub)` → HITL discarded notification

  There are 443 `RepoInfo` references across some sixty files. The cheapest way to make all of them
  compile against the wider shape is to make `platform` optional. That change is green on `tsc`,
  green on every existing suite, and silently turns all three gates false for every identity minted
  without an explicit platform — the operator stops being told that a HITL issue went to Blocked, and
  nothing anywhere reports an error. §4 holds `platform` required and holds the boundary's declared
  platform winning over the identity reader's.

  TRAP 3 — THE RE-EXPORT SHIM MAKES EVERY OTHER CHECK PASS WHILE NOTHING MOVES. Against 443
  references the minimal diff is one line per type: `export type RepoInfo = RepoIdentifier;` left in
  `githubApi.ts`, or `export type { GitHubIssue } from '../providers/github/domain/issues';` left in
  `issueTypes.ts`. Under that diff the guard is green (providers import nothing from the framework),
  `tsc` is green, every unit test is green, and the framework still imports its domain model from
  `adws/types/`. AC2 rules it out in words — "no alias or re-export survives" — and words are all
  that rule it out, because there is no runtime behaviour to observe. The only observable consequence
  of a type being genuinely gone is that a module importing it no longer COMPILES, which is what §2
  and §3 drive.

  TRAP 4 — THE SCOPE WIDENS BY FILE AND BY THE DOMAIN DIRECTORY, NOT BY PACKAGE. AC4 asks for
  `adws/providers/github/mappers.ts` and the new domain modules. The enclosing package also holds
  `githubIssueTracker.ts`, `githubCodeHost.ts` and `githubBoardManager.ts`, every one of which still
  reaches `../../core`, `../../github/issueApi`, `../../github/prApi` and `../../github/labelManager`
  today — deliberately, because those are later de-tangling slices. A scope entry of
  `adws/providers/github` instead of the two the issue names turns `bun run lint:git-guard` red on
  merge. §1 pins both halves: the named entries are enforced, their still-entangled neighbours in the
  same directory are not yet.

  What each acceptance criterion turns into here:

    §1  THE WIDENED SCOPE ENFORCES `mappers.ts` AND THE DOMAIN DIRECTORY — AND NOTHING MORE (AC1,
        AC4). Fixture-tree runs of the real guard runner: a framework import from either of the newly
        scoped paths fails by name, the still-entangled neighbours and the not-yet-widened packages
        still pass, and #816's two scope entries still fire (widen only, never narrow).

    §2  `RepoInfo` IS GONE FROM THE TREE, IN BOTH OF ITS HOMES (AC2). Compile probes.

    §3  THE RAW SHAPES ARE ADAPTER-OWNED, AND ONLY THE LISTED ONES MOVED (AC3). Compile probes,
        including the over-move controls for the neighbours that stay.

    §4  THE PLATFORM DISCRIMINATOR SURVIVES THE COLLAPSE (AC2's "RepoIdentifier is the only
        repo-identity shape", read as a shape and not just a name).

    §5  THE OTHER GUARD RULES STILL FIRE AFTER THE RENAME (AC5's regression net).

    §6  THE RATCHET: WHOLE-REPO GUARD GREEN, TYPE-CHECK GREEN (AC4, AC5).

  HOW THESE SCENARIOS OBSERVE THE SYSTEM. Every assertion targets a runtime artefact: the exit status
  and stdout of the guard runner (observability surfaces 4 and 5), the exit status and diagnostics of
  the TypeScript compiler run over a throwaway probe module (surfaces 4 and 5), and the identity
  object a `buildLaunchBoundary` call hands back (phase-import, returned artefact). No scenario reads
  a source file and asserts against its contents; no scenario asserts that a module, an export or a
  constant exists by inspecting the tree. "The type is gone" is observed only as "a module that
  imports it no longer compiles", which is the only form in which a deleted type is observable at
  all — and, not incidentally, the only form a re-export shim cannot satisfy.

  A NOTE FOR THE STEP DEFINITIONS.

    • THE TYPE PROBE IS A THROWAWAY MODULE, NOT A SOURCE FILE. `a type probe module that reads:`
      writes its docstring to `probe.ts` inside a fresh throwaway directory that is a DIRECT CHILD of
      `adws/`, so a `../` specifier in the docstring resolves to `adws/` exactly as it would from any
      real module one level down. The probe and its directory are removed in an `After` hook.
    • COMPILE IT THROUGH A NARROWED PROJECT, NOT THE WHOLE ONE. Write a temp
      `adws/tsconfig.probe-<rand>.json` carrying `{"extends": "./tsconfig.json", "include":
      ["./<probeDir>/probe.ts"]}` and run `bunx tsc --noEmit -p <that file>`. Extending the real
      config is what keeps `strict`, `moduleResolution: bundler` and the rest identical to the build
      the ACs talk about; narrowing `include` to the probe keeps a run at well under a second instead
      of the ~30s a whole-project check costs, and keeps unrelated errors elsewhere in the tree out
      of the probe's verdict. Remove the temp config in the same `After` hook. Do NOT pass the probe
      as a bare file argument to `tsc` — that discards the project's `compilerOptions` entirely.
    • A NEGATIVE PROBE MUST FAIL FOR ITS OWN REASON. `fails to compile naming the missing member
      {string}` must assert that a diagnostic line names the probe file AND mentions the given
      member — `probe.ts(2,15): error TS2305: Module '"../providers/types"' has no exported member
      'NotAThing'.` — never merely that the exit status was non-zero. An exit-code-only assertion
      passes vacuously the moment anything else in the transitive import graph fails to compile,
      which is precisely the state this issue's build is in halfway through.
    • REUSED, NOT REDEFINED. From `feature-816.steps.ts`: `a guard fixture tree holding the file
      {string}:`, `the guard runner executes over the guard fixture tree`, `the guard run over the
      guard fixture tree passes`, `… fails naming {string}`, `the guard failure over the guard
      fixture tree cites the extraction-readiness rule`, `… cites no extraction-readiness rule`.
      From `feature-794.steps.ts`: `a launch boundary rooted in throwaway framework and target-repos
      directories`, `the local git remote at the launch boundary answers {string}`, `the launch
      boundary is asked for the repository {string}`, `the launch boundary is asked with no target
      repository`, `the boundary's git context names the repository {string}`. From `feature-769.steps.ts`: `the git/gh guard runs across the whole ADW
      repository`, `the guard run reports no violations`. From `ensureCronOnEveryEventSteps.ts` and
      `feature-504.steps.ts`: `the ADW codebase is checked out` (G18), `the ADW TypeScript type-check
      passes` (T22). Redefining any of these is an AmbiguousStepDefinition.
    • `the local git remote at the launch boundary answers {string}` STUBS `deps.getRepoInfo`, whose
      return type is one of the things this issue changes. Its fixture must return whatever the
      collapsed seam now requires — that update is part of this issue, and it is the point of
      reusing the step rather than writing a parallel one.
    • THE TWO NEW PLATFORM PHRASES NEED A SEAM, NOT A SECOND WORLD. `the launch boundary declares the
      platform {string}` and `the boundary's repo identity declares the platform {string}` are new to
      this file, but the boundary they assert on is built by the REUSED `When` steps, inside
      `feature-794.steps.ts`, against a module-private world whose `makeDeps()` never sets
      `deps.platform`. Redefining those Given/When phrases here is an AmbiguousStepDefinition, so
      `feature-794.steps.ts` exports a small seam instead — a declared-platform setter that
      `makeDeps()` folds into `deps.platform`, plus an accessor for the built boundary — and
      `feature-817.steps.ts` imports it. That cross-file pattern is already in use here
      (`feature-506` → `feature-507`/`feature-508`, `feature-636` → `feature-719`,
      `feature-577`/`feature-579` → `feature-583`). The setter resets per scenario, so the
      undeclared row below still exercises `deps.platform ?? Platform.GitHub`, and no `feature-794`
      phrase text changes.
    • `the guard failure over the guard fixture tree cites the {string} rule` (§5) is new and does not
      collide with #816's literal `… cites the extraction-readiness rule` — that phrase takes no
      quoted argument, so neither matches the other's step text.

  WHAT THIS FILE DELIBERATELY DOES NOT COVER. AC5's `bun run test:unit` half is the existing vitest
  suite, kept as the regression net the issue names; it is run by CI, not re-run from a scenario,
  mirroring feature-816's §7/§8 split. `adws/proof/types.ts`'s `CommenterFn` and `repoInfo` field
  change with the collapse and are covered by the whole-repo type-check in §6 plus the existing
  `@python-e2e` proof scenarios, which the same ratchet keeps green.

  Background:
    Given the ADW codebase is checked out

  # ── §1 THE WIDENED SCOPE ENFORCES THE TWO NAMED ENTRIES (AC1, AC4) ─────────────────────
  #
  # The load-bearing RED. `adws/providers/github/` is an EXEMPT_PACKAGES entry that `visitDir` prunes
  # as a directory, so `mappers.ts` reaches the guard today only if #817 puts it in EXTRACTION_SCOPE
  # explicitly — the same file-entry mechanism `adws/providers/types.ts` already uses. Until then
  # this fixture passes, which is why it is the pivot: an implementation that moves the types but
  # forgets the scope widening leaves AC1 unenforced and this scenario red.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: A framework import from the mappers module fails the guard by name
    Given a guard fixture tree holding the file "adws/providers/github/mappers.ts":
      """
      import type { GitHubIssue } from '../../types/issueTypes';

      export function issueNumber(issue: GitHubIssue): number {
        return issue.number;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/providers/github/mappers.ts"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule

  # The four specifiers below are not invented: they are the exact four framework imports
  # `mappers.ts` carries at lines 7-11 today, and the four this issue exists to remove. Every one is
  # `import type`, which is the whole character of this issue — the imports erase at runtime, so no
  # test that executes code can see them, and an extraction rule that inspected only value imports
  # would report the adapter clean while the file move still fails to compile in the library's new
  # home.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario Outline: Every framework import the mappers module carries today fails the guard
    Given a guard fixture tree holding the file "adws/providers/github/mappers.ts":
      """
      import type { Borrowed } from '<specifier>';

      export type Alias = Borrowed;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/providers/github/mappers.ts"
    And the guard failure over the guard fixture tree names the import specifier "<specifier>"

    Examples:
      | specifier                  |
      | ../../types/issueTypes     |
      | ../../types/workflowTypes  |
      | ../../github/githubApi     |
      | ../../github/prApi         |

  # The domain modules are the other half of AC4. The issue fixes the DIRECTORY
  # (`adws/providers/github/domain/`) and leaves the filenames to the implementer, so the scope entry
  # has to be the directory — which is also what keeps this scenario true whatever the modules end up
  # being called. A per-file scope entry for whatever files exist on merge day passes this scenario
  # only by accident and silently stops covering the next module added beside them.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario Outline: A framework import from a module in the adapter's domain directory fails the guard by name
    Given a guard fixture tree holding the file "<path>":
      """
      import type { Borrowed } from '../../../types/workflowTypes';

      export type Alias = Borrowed;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "<path>"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule

    Examples:
      | path                                              |
      | adws/providers/github/domain/issueShapes.ts       |
      | adws/providers/github/domain/pullRequestShapes.ts |

  # The intra-set direction, and the shape the migrated `mappers.ts` actually takes: it keeps
  # importing `RepoIdentifier` from `../types` and picks the raw shapes up from `./domain/…`. Both
  # resolve inside the extractable set, so both are the library's own wiring rather than an
  # entanglement. A rule or a scope entry that flagged any specifier leaving the file's own directory
  # would fail the build on the very file this issue rewrites.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: The migrated mappers module reaching its own domain modules and provider types passes the guard
    Given a guard fixture tree holding the file "adws/providers/types.ts":
      """
      export interface RepoIdentifier {
        owner: string;
        repo: string;
      }
      """
    And a guard fixture tree holding the file "adws/providers/github/domain/issueShapes.ts":
      """
      export interface GitHubIssue {
        number: number;
        title: string;
      }
      """
    And a guard fixture tree holding the file "adws/providers/github/mappers.ts":
      """
      import type { GitHubIssue } from './domain/issueShapes';
      import type { RepoIdentifier } from '../types';

      export function describe(issue: GitHubIssue, id: RepoIdentifier): string {
        return `${id.owner}/${id.repo}#${issue.number} ${issue.title}`;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  # TRAP 4, in both directions. #819 cleaned and widened the scope by the whole `adws/providers/github`
  # directory, so `githubIssueTracker.ts`/`githubCodeHost.ts`/`githubBoardManager.ts` are no longer
  # the still-entangled neighbours this scenario pins — the last remaining out-of-scope file beside
  # the adapter package is `repoContext.ts`, which stays framework wiring until #823.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario Outline: A still-entangled neighbour in the adapter package is not yet checked
    Given a guard fixture tree holding the file "<path>":
      """
      import { helper } from '<specifier>';

      export function probe(): string {
        return helper();
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

    Examples:
      | path                          | specifier                   |
      | adws/providers/repoContext.ts | ../github/gitContextFactory |
      | adws/providers/repoContext.ts | ../core/projectConfig       |

  # #818 cleaned `providers/gitlab` and `providers/jira` and widened the scope by both; only
  # `providers/repoContext.ts` still carries a framework import that #823 removes when it replaces
  # this file with `forgeProviders()`. #816's §3 pinned this and it stays pinned: widening happens one
  # reviewed slice at a time, and a slice that widens further than its own issue says is as much a
  # defect as one that widens less.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario Outline: A package still awaiting its own de-tangling slice is not yet checked
    Given a guard fixture tree holding the file "<path>":
      """
      import { CONFIG } from '<specifier>';

      export function endpoint(): string {
        return String(CONFIG);
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

    Examples:
      | path                           | specifier             |
      | adws/providers/repoContext.ts  | ../core/projectConfig |

  # WIDEN ONLY, NEVER NARROW — the machine-checkable half. #816 seeded the scope with two entries;
  # #817 appends to that list, it does not replace it. Both of #816's entries must still fire
  # afterwards, so an implementer who rewrites `EXTRACTION_SCOPE` around the new entries rather than
  # appending to it turns one of these two rows red.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario Outline: The scope entries #816 seeded still fail on a framework import
    Given a guard fixture tree holding the file "<path>":
      """
      import type { Borrowed } from '<specifier>';

      export type Alias = Borrowed;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "<path>"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule

    Examples:
      | path                         | specifier              |
      | adws/gitContext/branchOps.ts | ../core                |
      | adws/providers/types.ts      | ../types/workflowTypes |

  # ── §2 `RepoInfo` IS GONE FROM THE TREE, IN BOTH OF ITS HOMES (AC2) ────────────────────
  #
  # The headline of the second group, and the assertion no other instrument can make. The probe
  # compiles today — `adws/github/githubApi.ts:10` exports the interface — so this is a genuine RED.
  # It stays red under a surviving `export type RepoInfo = RepoIdentifier;` alias, which is the only
  # reason it is worth writing: every other check in this file, and every existing suite, is green
  # under that alias.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: A module importing RepoInfo from the framework GitHub API no longer compiles
    Given a type probe module that reads:
      """
      import type { RepoInfo } from '../github/githubApi';

      export const probe: RepoInfo = { owner: 'acme', repo: 'widget' };
      """
    When the type probe is compiled against the ADW project
    Then the type probe fails to compile naming the missing member "RepoInfo"

  # TRAP 1. `adws/providers/github/githubIdentity.ts:20` declares the SECOND `RepoInfo`, and it is
  # the live one — `parseGitHubRemoteUrl` and `readLocalRepoInfo` both return it, and
  # `githubApi.getRepoInfo` merely forwards. It is invisible to AC1 (a provider file declaring its
  # own type imports nothing) and invisible to the guard for the same reason, so this probe is the
  # only thing standing between "RepoInfo is gone" and "one of the two RepoInfos is gone".

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: A module importing RepoInfo from the GitHub identity module no longer compiles
    Given a type probe module that reads:
      """
      import type { RepoInfo } from '../providers/github/githubIdentity';

      export const probe: RepoInfo = { owner: 'acme', repo: 'widget' };
      """
    When the type probe is compiled against the ADW project
    Then the type probe fails to compile naming the missing member "RepoInfo"

  # The positive half: the collapse target exists, is exported from the provider package, and the two
  # remote-parsing functions that used to answer in `RepoInfo` now answer in it. Driving the two
  # functions rather than the bare type is what makes this more than a re-statement of the interface
  # — it is the assertion that the collapse reached the call sites, not just the declaration.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: The GitHub identity readers answer in RepoIdentifier
    Given a type probe module that reads:
      """
      import type { RepoIdentifier } from '../providers/types';
      import { parseGitHubRemoteUrl, readLocalRepoInfo } from '../providers/github/githubIdentity';

      export const parsed: RepoIdentifier | null = parseGitHubRemoteUrl('https://github.com/acme/widget');
      export const local: RepoIdentifier = readLocalRepoInfo();
      """
    When the type probe is compiled against the ADW project
    Then the type probe compiles

  # The over-reach control, and the reason AC2's "the only repo-identity shape" needs reading with
  # care. `TargetRepoInfo` (`adws/types/issueTypes.ts:182`) is `{ owner, repo, cloneUrl,
  # workspacePath? }` — repo-identity-SHAPED, named like the type being deleted, and the first
  # parameter of `buildLaunchBoundary`. It carries a clone URL and a workspace path that
  # `RepoIdentifier` has nowhere to put, so collapsing it too is a lossy change dressed as
  # consistency. It stays exactly where it is.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: The target-repo descriptor is untouched by the collapse
    Given a type probe module that reads:
      """
      import type { TargetRepoInfo } from '../types/issueTypes';

      export const probe: TargetRepoInfo = {
        owner: 'acme',
        repo: 'widget',
        cloneUrl: 'https://github.com/acme/widget.git',
      };
      """
    When the type probe is compiled against the ADW project
    Then the type probe compiles

  # ── §3 THE RAW SHAPES ARE ADAPTER-OWNED (AC3) ──────────────────────────────────────────
  #
  # All eleven shapes, resolved through the adapter's public barrel rather than through whatever
  # file layout `domain/` ends up with — the barrel is the surface AC3's "exported from the adapter"
  # actually means, and the one the framework imports from. `adws/providers/github/index.ts` already
  # re-exports `./mappers`; the domain modules join it there.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: Every raw GitHub shape is exported from the adapter package
    Given a type probe module that reads:
      """
      import type {
        GitHubIssue,
        GitHubComment,
        GitHubUser,
        GitHubLabel,
        GitHubMilestone,
        GitHubIssueListItem,
        IssueCommentSummary,
        PRDetails,
        PRReviewComment,
        PRListItem,
        RawPR,
      } from '../providers/github';

      export type Shapes = [
        GitHubIssue, GitHubComment, GitHubUser, GitHubLabel, GitHubMilestone,
        GitHubIssueListItem, IssueCommentSummary, PRDetails, PRReviewComment,
        PRListItem, RawPR,
      ];
      """
    When the type probe is compiled against the ADW project
    Then the type probe compiles

  # "Leave `adws/types/issueTypes.ts`, `adws/types/workflowTypes.ts` and `adws/github/prApi.ts`" is
  # the issue's own wording, and TRAP 3 is why it has to be tested one old home at a time: a
  # re-export left behind in any of the three keeps the framework importing its domain model from
  # `adws/types/`, which is the exact state AC3 exists to end, and it is invisible to the guard
  # because the guard only ever looks at the provider side of the boundary.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario Outline: A raw GitHub shape is no longer available from the module it left
    Given a type probe module that reads:
      """
      import type { <shape> } from '<module>';

      export type Alias = <shape>;
      """
    When the type probe is compiled against the ADW project
    Then the type probe fails to compile naming the missing member "<shape>"

    Examples:
      | shape                | module                     |
      | GitHubIssue          | ../types/issueTypes        |
      | GitHubComment        | ../types/issueTypes        |
      | GitHubUser           | ../types/issueTypes        |
      | GitHubLabel          | ../types/issueTypes        |
      | GitHubMilestone      | ../types/issueTypes        |
      | GitHubIssueListItem  | ../types/issueTypes        |
      | IssueCommentSummary  | ../types/issueTypes        |
      | PRDetails            | ../types/workflowTypes     |
      | PRReviewComment      | ../types/workflowTypes     |
      | PRListItem           | ../types/workflowTypes     |
      | RawPR                | ../github/prApi            |

  # The over-move controls. The three modules are lightened, not emptied: `issueTypes.ts` keeps the
  # slash-command union, the webhook payload and `TargetRepoInfo`; `workflowTypes.ts` keeps the
  # workflow-stage vocabulary and `RecoveryState`; `prApi.ts` keeps the PR functions that merely
  # CONSUME `RawPR` and now import it from the adapter. An implementation that relocates whole files
  # rather than the eleven named shapes passes every scenario above and takes the framework's own
  # vocabulary into the library with it.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: The framework vocabulary sharing those modules stays where it is
    Given a type probe module that reads:
      """
      import type { IssueClassSlashCommand, PullRequestWebhookPayload } from '../types/issueTypes';
      import type { WorkflowStage, RecoveryState } from '../types/workflowTypes';
      import { hasWontFixLabel, defaultFindPRByBranch } from '../github/prApi';

      export type Kept = [IssueClassSlashCommand, PullRequestWebhookPayload, WorkflowStage, RecoveryState];
      export const fns = [hasWontFixLabel, defaultFindPRByBranch];
      """
    When the type probe is compiled against the ADW project
    Then the type probe compiles

  # ── §4 THE PLATFORM DISCRIMINATOR SURVIVES THE COLLAPSE (TRAP 2) ───────────────────────
  #
  # The one scenario that stands between this issue and a silent production regression. `platform` is
  # required today; the pressure to relax it is 443 references wide, and relaxing it is invisible to
  # `tsc`, to the guard, and to every existing test — the three `repoId.platform === Platform.GitHub`
  # gates simply stop matching, and HITL blocked-transition notifications stop being sent with no
  # error anywhere. The probe is the cheapest complete statement of "required", asserted as the
  # compiler's own refusal rather than as a property of the declaration's text.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: An owner/repo pair alone is still not a RepoIdentifier
    Given a type probe module that reads:
      """
      import type { RepoIdentifier } from '../providers/types';

      export const probe: RepoIdentifier = { owner: 'acme', repo: 'widget' };
      """
    When the type probe is compiled against the ADW project
    Then the type probe fails to compile reporting the missing property "platform"

  # The behavioural half, at the one place identity selection is allowed to happen. The boundary
  # declares the platform; the collapse hands its identity reader a platform-bearing shape for the
  # first time, and the obvious simplification — return the reader's identifier straight through
  # instead of re-stamping the declared platform onto owner/repo — makes the GitHub-specific
  # `readLocalRepoInfo` the de facto authority on which forge ADW is talking to. The self-host row is
  # the one that goes wrong: it is the only path that reads identity through the reader at all.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: The boundary's declared platform wins over the identity reader's on the self-host path
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the local git remote at the launch boundary answers "acme/webapp"
    And the launch boundary declares the platform "gitlab"
    When the launch boundary is asked with no target repository
    Then the boundary's repo identity declares the platform "gitlab"
    And the boundary's git context names the repository "acme/webapp"

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: The boundary's declared platform is carried onto an explicit target repository
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the launch boundary declares the platform "gitlab"
    When the launch boundary is asked for the repository "acme/webapp"
    Then the boundary's repo identity declares the platform "gitlab"

  # No declaration means GitHub, which is what makes the collapse safe for the sixty-odd files that
  # never mention a platform at all. This is the row that fails if the default is dropped in the
  # rename — every one of those files would then mint an identifier the three gates reject.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: An undeclared platform still defaults to GitHub
    Given a launch boundary rooted in throwaway framework and target-repos directories
    And the local git remote at the launch boundary answers "acme/webapp"
    When the launch boundary is asked with no target repository
    Then the boundary's repo identity declares the platform "github"

  # ── §5 THE OTHER GUARD RULES STILL FIRE AFTER THE RENAME (AC5) ─────────────────────────
  #
  # `cwd-derived-identity` (#769) matches on FUNCTION NAMES —
  # `CWD_DERIVED_IDENTITY_FNS = new Set(['getRepoInfo', 'readLocalRepoInfo'])`. This issue renames a
  # TYPE, but `getRepoInfo` is now a function named after a type that no longer exists, and a sweeping
  # rename to `getRepoIdentifier` is the natural tidy-up. It compiles, every test passes, and the
  # #769 rule stops matching anything at all — the guard goes quietly dead rather than red, which is
  # the failure mode a guard has instead of a bug.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: A cwd-derived identity composition still fails under its own rule after the rename
    Given a guard fixture tree holding the file "adws/core/probeOps.ts":
      """
      import { getRepoInfo } from '../github/githubApi';
      import { gitContextForRepo } from '../github/gitContextFactory';

      export function probe(): unknown {
        const info = getRepoInfo();
        return gitContextForRepo(info);
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/core/probeOps.ts"
    And the guard failure over the guard fixture tree cites the "cwd-derived-identity" rule

  # And the shell-out rule is still the rule an ordinary framework shell-out fails under — the same
  # anti-leak row #816 §6 carries, re-run because #817 is the first slice to change EXTRACTION_SCOPE
  # after it, and a widening applied to collection rather than to the extraction rule alone would
  # relabel or swallow this.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: A framework shell-out still fails under the shell-out rule, not the extraction rule
    Given a guard fixture tree holding the file "adws/core/worktreeHelper.ts":
      """
      import { execSync } from 'child_process';

      export function listWorktrees(): string {
        return execSync('git worktree list --porcelain', { encoding: 'utf-8' });
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/core/worktreeHelper.ts"
    And the guard failure over the guard fixture tree cites no extraction-readiness rule

  # ── §6 THE RATCHET (AC4, AC5) ──────────────────────────────────────────────────────────
  #
  # AC4's "guard green" and AC5's `bun run test` in the two forms the repository actually runs them.
  # The whole-repo guard run is the scenario that fails if the scope was widened past the two paths
  # AC4 names — the same eight framework entanglements #816 documented are still there, minus the
  # ones this issue removes — and equally if the domain move left the adapter reaching back into
  # `adws/types/` from a module now inside the enforced scope. The type-check is the complete proof
  # that 443 references, three optional-vs-required gates and eleven relocated shapes all resolved,
  # which is the only form in which "no expectation changes beyond import paths" can be checked at
  # all.

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: The guard passes across the whole repository with the widened extraction scope
    When the git/gh guard runs across the whole ADW repository
    Then the guard run reports no violations

  @adw-817 @adw-6lqigx-consolidate-the-doma
  Scenario: TypeScript type-check passes with the domain model consolidated into the provider package
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
