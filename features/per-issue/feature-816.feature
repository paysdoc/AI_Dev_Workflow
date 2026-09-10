@adw-816 @adw-i4q2gf-extraction-readiness
Feature: A fourth guard rule makes "extraction is a file move" machine-checked — a file inside an extractable package that imports from the framework fails the build, an intra-set import does not, and the scope list only ever widens

  Issue #816 is the first slice of the GitContext library extraction (`specs/prd/gitcontext-library-extraction.md`,
  Implementation Decisions → *Extraction-readiness guard*, and user stories 11 and 12). It adds a
  fourth rule to the guard runner ADW already ships: alongside `git-gh-shellout` (#701/#792),
  `cwd-derived-identity` (#769) and `unsanctioned-construction` (#795) comes
  **extraction-readiness** — any file inside an extractable package that imports from outside the
  extractable set fails the build.

  The extractable set is two directories: `adws/gitContext/` (the git core) and `adws/providers/`
  (the ports and the three forge adapters). The set is what will eventually MOVE. The rule's SCOPE
  is a different, smaller thing: the subset of that set the rule enforces TODAY. The two are not the
  same and the difference is the whole design of the slice, because the extractable set is not clean
  yet:

    • `adws/providers/gitlab/gitlabCodeHost.ts:18`  → `../../core`
    • `adws/providers/gitlab/gitlabApiClient.ts:7`  → `../../core`
    • `adws/providers/jira/jiraIssueTracker.ts:6`   → `../../core`
    • `adws/providers/jira/jiraApiClient.ts:6`      → `../../core`
    • `adws/providers/repoContext.ts:10,26`         → `../github/gitContextFactory`, `../core/projectConfig`
    • `adws/providers/github/githubCodeHost.ts`     → `../../core`, `../../github/prApi`, `../../github/gitContextFactory`
    • `adws/providers/github/mappers.ts`            → `../../types/issueTypes`, `../../types/workflowTypes`, `../../github/*`
    • `adws/providers/github/githubIssueTracker.ts` → `../../github/issueApi`, `../../github/labelManager`, …

  A rule scoped to the whole extractable set on day one is a red build with no way to make it green
  short of doing every de-tangling issue at once — which is exactly the big-bang this PRD exists to
  avoid. So the rule carries an explicit scope list, seeded with what is ALREADY clean, and every
  later de-tangling slice widens it by the package it cleaned. The initial scope is therefore
  `adws/gitContext/**` plus the single file `adws/providers/types.ts` — verified clean: every
  non-test module under `adws/gitContext/` imports only `fs`, `path`, `os`, `child_process` and its
  own siblings, and `adws/providers/types.ts` has no imports at all. When both packages are fully in
  scope, the guard has proven the move.

  THE LOAD-BEARING TRAP, and the reason a plausible implementation of this rule ships DEAD.
  `adws/gitContext` and `adws/providers/github` are the two entries in `EXEMPT_PACKAGES`, and
  `visitDir` (`adws/checkGitGhGuard.ts:98-104`) prunes an exempt package as a DIRECTORY — it never
  descends. Measured against the current tree, `collectTsFiles` returns 279 files, of which **zero**
  are under `adws/gitContext/` and **zero** under `adws/providers/github/`. `adws/providers/types.ts`
  is collected; the entire git core is not. So a fourth rule bolted into `scanSource` beside the
  other three would never be handed a single file from the package it exists to guard, the whole-repo
  run would print PASS, and AC4 would be satisfied vacuously by a rule that cannot fire. Every
  negative scenario below therefore runs the guard the way CI runs it — over a fixture tree, from the
  entry point — and asserts the violation NAMES the offending path, so a rule that never sees the
  file fails the scenario instead of passing it.

  THE TRAP'S MIRROR IMAGE. The obvious fix — delete the prune, let the walk descend — makes the
  extraction rule work and breaks the other three, because `adws/gitContext/` is the one package in
  the codebase that is SUPPOSED to be full of raw git command strings (`branchOps.ts:40` runs
  `git reset --hard "origin/${defaultBranch}"`, and there are dozens more), and
  `adws/providers/github/` is the one package supposed to hand `gh …` strings to the executor. Both
  would light up under `git-gh-shellout` the moment the walk reached them, turning feature-792 §16
  and §19 red and the whole-repo build with them. Collection must widen for the extraction rule
  WITHOUT widening for the other three. §6 pins both halves of that, in both directions.

  What each acceptance criterion turns into here:

    §1  A FRAMEWORK IMPORT FROM INSIDE SCOPE FAILS (AC1, AC3; story 11). The headline, and the
        load-bearing RED. `../core` from inside `adws/gitContext/` fails the build by name — as do
        the near-misses a rule matching on `'../..'` or on the literal text `core` would let past.

    §2  AN INTRA-SET IMPORT PASSES, AND SO DOES A BUILT-IN OR AN NPM PACKAGE (AC3). The other
        direction, and the one that decides whether the rule is usable at all: `adws/gitContext/` and
        `adws/providers/` may reach each other freely, because both are moving together. A rule that
        resolved specifiers by string-shape rather than against the importing file's directory gets
        this wrong in both directions at once.

    §3  THE SCOPE LIST IS A LIST, AND BOTH OF ITS ENTRIES ARE LIVE (AC2). The machine-checkable half
        of "widen only, never narrow": a violation inside `adws/gitContext/**` fails AND a violation
        inside `adws/providers/types.ts` fails, so silently dropping either entry turns a scenario
        red. The complement is equally load-bearing — a package in the extractable set but NOT in
        scope is not checked yet, which is the only reason the eight real entanglements listed above
        do not fail the build today.

    §4  TEST FILES ARE EXCLUDED (AC3). Stated by the issue and not decorative: the moment
        `adws/providers/github` enters scope, `__tests__/githubIdentity.test.ts` reaches
        `../../../github/githubApi` and would fail a rule that forgot the exclusion. Both shapes the
        existing `isScannable` recognises — `__tests__/**` and `*.test.ts` — are pinned.

    §5  THE FAILURE IS DIAGNOSABLE AND CARRIES ITS OWN RULE IDENTITY (AC1). The runner prints
        `path:line  [rule]  command`; a fourth rule needs a fourth label, or a de-tangling regression
        arrives labelled as a shell-out and is chased into the wrong module.

    §6  THE OTHER THREE RULES ARE UNCHANGED BY THE WIDENING (AC4, the regression net). See "the
        trap's mirror image" above.

    §7  THE WHOLE TREE IS GREEN WITH THE INITIAL SCOPE (AC4, the ratchet).

    §8  Type-check backstop.

  HOW THESE SCENARIOS OBSERVE THE SYSTEM. Every assertion targets a runtime artefact: the exit status
  of the guard runner and the diagnostic it writes to stdout — surfaces 4 and 5 of the regression
  vocabulary's observability table. No scenario reads a source file and asserts against its contents;
  no scenario asserts that a module, an export or a constant exists. The scope list is observed only
  through what the runner DOES with it, which is the only form in which "widen only, never narrow"
  can be enforced by a test at all.

  A NOTE FOR THE STEP DEFINITIONS, because two of these are easy to get wrong in a way that makes a
  negative scenario pass vacuously:

    • RUN THE ENTRY POINT, NOT `scanFiles`. The fixture-tree steps must drive the real runner over
      the fixture root — `execSync('bunx tsx ' + join(repoRoot, 'adws/checkGitGhGuard.ts'),
      { cwd: fixtureRoot })`, since `main()` takes its repo root from `process.cwd()` — capturing
      exit status and stdout. That exercises collection AND scanning, so the scenarios stay correct
      wherever the implementer puts the scope widening: inside `visitDir`, in a second collection
      pass, or in `main()`. Driving `scanFiles` directly would bypass collection entirely and report
      PASS for the exact defect §1 exists to catch.
    • THE FIXTURE GIVEN IS ADDITIVE. Several scenarios below write two or three files into one
      fixture tree; the step must append to the current tree rather than re-create it. It is worded
      apart from feature-792's `a fixture repository containing the file {string}:` (which mkdtemps a
      fresh root per call) precisely so both can coexist — redefining that phrase is an
      AmbiguousStepDefinition.
    • FIXTURE FILE NAMES MUST MIRROR REAL REPOSITORY PATHS. The scope list is path-based and relative
      to the repo root, so a fixture file must sit at `adws/gitContext/<name>.ts` to be in scope. No
      fixture directory may be named `features` or `test` — `EXEMPT_DIR_NAMES` skips those.
    • REUSED, NOT REDEFINED: `the ADW codebase is checked out` (G18) and `the ADW TypeScript
      type-check passes` (T22) live in `features/step_definitions/ensureCronOnEveryEventSteps.ts:8`
      and `feature-504.steps.ts:1126`; `the git/gh guard runs across the whole ADW repository` and
      `the guard run reports no violations` live in `feature-769.steps.ts:400` and `:553`.

  Background:
    Given the ADW codebase is checked out

  # ── §1 A FRAMEWORK IMPORT FROM INSIDE SCOPE FAILS THE BUILD (AC1, AC3) ──────────────────
  #
  # The headline and the load-bearing RED. `adws/gitContext/` is pruned from the walk today, so this
  # scenario fails against a rule that was added to `scanSource` and never wired into collection —
  # which is the single most likely way to implement this issue and get a guard that cannot fire.
  # The fixture is the shape the PRD describes: a clean-looking core module that reaches one step
  # sideways into the framework.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: A core module importing from the framework fails the guard by name
    Given a guard fixture tree holding the file "adws/gitContext/branchOps.ts":
      """
      import { log } from '../core';

      export function describeBranch(name: string): string {
        log(`branch ${name}`);
        return name;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/gitContext/branchOps.ts"

  # "Outside the extractable set" is a claim about a CLOSED set, so it is worth driving against the
  # near misses. `../types/issueTypes` and `../github/githubApi` are the two the real de-tangling will
  # actually hit (`mappers.ts` imports both today). `../../adws/core` is the same destination reached
  # by a longer path from a would-be subdirectory. A type-only import is the row that matters most:
  # `import type { RepoInfo } from '../../github/githubApi'` is exactly what `mappers.ts:10` carries,
  # it erases at runtime, and it still makes extraction fail to compile — a rule that only inspects
  # value imports would report the core clean and be wrong. `export … from` is the same defect in
  # re-export clothing, and `adws/providers/index.ts` is built entirely out of that form.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario Outline: Every import shape reaching outside the extractable set fails the guard
    Given a guard fixture tree holding the file "adws/gitContext/probeOps.ts":
      """
      <statement>

      export const MARKER = 'probe';
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/gitContext/probeOps.ts"

    Examples:
      | statement                                                      |
      | import { log } from '../core';                                 |
      | import { log } from '../core/logger';                          |
      | import type { GitHubIssue } from '../types/issueTypes';        |
      | import { getRepoInfo } from '../github/githubApi';             |
      | import type { RepoInfo } from '../github/githubApi';           |
      | export { log } from '../core';                                 |
      | export * from '../types/workflowTypes';                        |
      | import * as core from '../core';                               |
      | import '../core/sideEffect';                                   |

  # The other in-scope entry, driven the same way. `adws/providers/types.ts` is a single FILE in the
  # scope list rather than a directory glob, which is the entry most likely to be dropped by an
  # implementer who reads the scope as "packages" — and dropping it is invisible to every other
  # scenario in this file. Paired with §1, these two are the anti-narrowing ratchet AC2 asks for:
  # remove either scope entry and one of them goes red.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: The provider types module importing from the framework fails the guard by name
    Given a guard fixture tree holding the file "adws/providers/types.ts":
      """
      import type { WorkflowState } from '../types/workflowTypes';

      export interface RepoIdentifier {
        owner: string;
        repo: string;
        state?: WorkflowState;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/providers/types.ts"

  # ── §2 AN INTRA-SET IMPORT PASSES (AC3) ────────────────────────────────────────────────
  #
  # The direction that decides whether the rule is usable. `adws/gitContext/` and `adws/providers/`
  # move together, so a specifier crossing between them is not an entanglement — it is the library's
  # own internal wiring. This exact edge is real today: every test under `adws/gitContext/__tests__/`
  # reaches `../../providers/github/githubTokenProvider`, and `adws/providers/github/ghCommandRunner.ts:13`
  # reaches back the other way into `../../gitContext`. A rule that flagged any specifier leaving the
  # importing file's own package would fail the build on the first de-tangling slice that lands.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: A core module importing from the provider package passes the guard
    Given a guard fixture tree holding the file "adws/providers/types.ts":
      """
      export interface RepoIdentifier {
        owner: string;
        repo: string;
      }
      """
    And a guard fixture tree holding the file "adws/gitContext/repoWorkspace.ts":
      """
      import type { RepoIdentifier } from '../providers/types';

      export function describe(id: RepoIdentifier): string {
        return `${id.owner}/${id.repo}`;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  # A specifier is resolved against the importing FILE's directory, never matched by shape. The two
  # rows below are the same three characters — `../` — resolving to opposite verdicts: from
  # `adws/gitContext/gitReadOps.ts`, `../types` is `adws/types` and is a violation; from
  # `adws/gitContext/commands/readCmd.ts`, `../types` is `adws/gitContext/types` and is legal. Any
  # implementation that counts `..` segments, tests `startsWith('../..')`, or pattern-matches the
  # specifier text gets exactly one of these two rows wrong.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: A relative specifier that escapes the package from the package root is a violation
    Given a guard fixture tree holding the file "adws/gitContext/gitReadOps.ts":
      """
      import type { GitIdentity } from '../types';

      export const NAME: string = 'probe';
      export type Alias = GitIdentity;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/gitContext/gitReadOps.ts"

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: The identical specifier from one directory deeper stays inside the package and passes
    Given a guard fixture tree holding the file "adws/gitContext/commands/readCmd.ts":
      """
      import type { GitIdentity } from '../types';

      export const NAME: string = 'probe';
      export type Alias = GitIdentity;
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  # Node built-ins and npm packages are always allowed — they travel with the library through its
  # package manifest. Every one of these is a real import in the current core (`fs`, `path`, `os`,
  # `child_process`) or in the guard itself (`typescript`), plus the `node:` prefixed form the core
  # does not use yet but which a library-shaped rewrite is likely to introduce. A rule implemented as
  # "anything that is not a sibling is a violation" fails every row here.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario Outline: A built-in or npm import from inside scope passes the guard
    Given a guard fixture tree holding the file "adws/gitContext/execOps.ts":
      """
      import <binding> from '<specifier>';

      export const MARKER = 'exec';
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

    Examples:
      | binding      | specifier      |
      | * as fs      | fs             |
      | * as path    | path           |
      | * as os      | os             |
      | * as cp      | child_process  |
      | * as crypto  | node:crypto    |
      | * as ts      | typescript     |

  # ── §3 THE SCOPE LIST IS EXPLICIT AND ONLY WIDENS (AC2, AC4) ───────────────────────────
  #
  # The complement of §1, and the reason `bun run lint:git-guard` can be green tomorrow morning. This
  # section used to pin a package inside the extractable SET but outside the current SCOPE — the last
  # such file was `adws/providers/repoContext.ts`, which #823 replaced with `forgeProviders()` and
  # widened EXTRACTION_SCOPE to the whole `adws/providers` directory (scope == set). With no file left
  # inside the set and outside the scope, that scenario is retired rather than rewritten against an
  # invented fixture — the remaining row below still proves the scope list is a real boundary, not a
  # tautology, against a file that is genuinely outside the extractable set.

  # A framework file is not in the extractable set at all and is never checked by this rule, however
  # much it looks like the ones that are. `adws/github/gitContextFactory.ts` carries the word, sits
  # one directory from the core, and imports across the framework freely — legitimately, because it
  # is the framework. This is the over-fire row: a scope predicate written as `includes('gitContext')`
  # or `startsWith('adws/git')` passes every scenario above and then fails the build on a large part
  # of the codebase that has nothing to do with extraction.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario Outline: A framework file outside the extractable set is never checked by the extraction rule
    Given a guard fixture tree holding the file "<path>":
      """
      import { log } from '<specifier>';

      export function probe(): void {
        log('probe');
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

    Examples:
      | path                                | specifier          |
      | adws/github/gitContextFactory.ts    | ../core            |
      | adws/core/launchGitContext.ts       | ../types/logTypes  |
      | adws/phases/prPhase.ts              | ../core            |
      | adws/gitContextHelpers.ts           | ./core             |

  # ── §4 TEST FILES ARE EXCLUDED (AC3) ───────────────────────────────────────────────────
  #
  # Stated by the issue, and load-bearing the moment the scope widens: `adws/providers/github/__tests__/githubIdentity.test.ts:8`
  # reaches `../../../github/githubApi` today, and the tests do not move with the library. Both
  # shapes the runner's existing `isScannable` recognises are pinned, because an implementer adding a
  # second collection pass for the extractable packages has to re-apply an exclusion the first pass
  # already had — the classic place for it to be dropped.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario Outline: A test file inside scope may import from the framework
    Given a guard fixture tree holding the file "<path>":
      """
      import { getRepoInfo } from '../../github/githubApi';

      export function identityFixture(): string {
        return getRepoInfo().repo;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

    Examples:
      | path                                          |
      | adws/gitContext/__tests__/gitReadOps.test.ts  |
      | adws/gitContext/__tests__/helpers.ts          |

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: A colocated test file inside scope may import from the framework
    Given a guard fixture tree holding the file "adws/gitContext/branchOps.test.ts":
      """
      import { log } from '../core';

      export function check(): void {
        log('checked');
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  # ── §5 THE FAILURE IS DIAGNOSABLE AND CARRIES ITS OWN RULE IDENTITY (AC1) ──────────────
  #
  # The runner prints one line per violation as `path:line  [rule]  command` and a per-rule remedy
  # block. AC1 asks for "its own violation type", and the operator-visible consequence is the only
  # part of that a test can hold: a de-tangling regression must arrive labelled as an
  # extraction-readiness failure naming the offending specifier, not as a shell-out — which would send
  # the reader looking for an `execSync` that is not there. The line number matters for the same
  # reason: the third import in a twenty-import module is the one that has to be found.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: An extraction-readiness failure names the file, the line and the offending specifier under its own rule
    Given a guard fixture tree holding the file "adws/gitContext/worktreeOps.ts":
      """
      import * as path from 'path';
      import type { RepoIdentifier } from '../providers/types';
      import { log } from '../core/logger';

      export function describe(id: RepoIdentifier, root: string): string {
        log('describe');
        return path.join(root, id.repo);
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree fails naming "adws/gitContext/worktreeOps.ts"
    And the guard failure over the guard fixture tree cites the extraction-readiness rule
    And the guard failure over the guard fixture tree names the import specifier "../core/logger"
    And the guard failure over the guard fixture tree reports line 3

  # Detection is by resolved module specifier on a real import node, never by text. The guard's
  # standing invariant is "AST-only, no regex on source text", and this rule inherits it: a docblock
  # describing an import that was removed, and a string constant holding a path, are both prose. The
  # core is full of the second shape — `branchOps.ts:40` executes `git reset --hard "origin/${defaultBranch}"`
  # — and a text-matching rule turns the package it guards into a permanent red build.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: A comment or a string mentioning a framework path is not an import
    Given a guard fixture tree holding the file "adws/gitContext/resetOps.ts":
      """
      /**
       * Previously: import { log } from '../core';
       * The logger now arrives through the logger port.
       */
      export const LEGACY_SPECIFIER = '../core/logger';

      export function resetCommand(branch: string): string {
        return `git reset --hard "origin/${branch}"`;
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  # ── §6 THE OTHER THREE RULES ARE UNCHANGED BY THE WIDENING (AC4) ───────────────────────
  #
  # The regression net for the trap's mirror image, and the pair of scenarios most likely to catch a
  # working implementation of §1 that took the whole build down with it. The extractable packages are
  # the two entries in `EXEMPT_PACKAGES`; whatever makes the extraction rule able to see them must not
  # make `git-gh-shellout` able to see them. The first fixture is the git core doing the one thing it
  # exists to do; the second is the forge adapter doing the same for `gh`. Both are green today only
  # because the walk never descends, and both must stay green after the walk is taught to.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: A git command in the git core still passes the guard once the extraction rule can see the package
    Given a guard fixture tree holding the file "adws/gitContext/branchOps.ts":
      """
      type Run = (command: string, cwd?: string) => string;

      export function resetToUpstream(run: Run, branch: string, cwd: string): string {
        return run(`git reset --hard "origin/${branch}"`, cwd);
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: A gh command in the forge adapter still passes the guard once the extraction rule can see the package
    Given a guard fixture tree holding the file "adws/providers/github/ghRepoApi.ts":
      """
      import type { GitContext } from '../../gitContext';

      export function authenticatedUser(ctx: GitContext): string {
        return ctx.exec('gh api user --jq .login', { cwd: { kind: 'frameworkRoot' }, env: {} });
      }
      """
    When the guard runner executes over the guard fixture tree
    Then the guard run over the guard fixture tree passes

  # A shell-out from an ordinary package must still fail, and must still fail AS a shell-out. A
  # widening that accidentally routed every collected file through the new rule alone — or that
  # replaced the prune with a filter applied to all four rules — would turn this into a pass or into
  # a mislabelled failure. This is the row that keeps the two scenarios above honest: they prove the
  # exempt packages stay exempt, and this proves the exemption did not leak to everyone else.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: A shell-out from an ordinary package still fails under the shell-out rule, not the extraction rule
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

  # ── §7 THE WHOLE TREE IS GREEN WITH THE INITIAL SCOPE (AC4, the ratchet) ───────────────
  #
  # The acceptance criterion in one line, and the scenario that fails if the initial scope was drawn
  # even slightly too wide — the eight framework imports across `providers/gitlab`, `providers/jira`,
  # `providers/repoContext.ts` and `providers/github` are all still there, by design, and every one of
  # them is a build failure under a scope that reaches the whole extractable set. It is equally the
  # scenario that fails if the widening broke the shell-out rule's exemption, since the core's git
  # commands and the adapter's gh commands are both in this tree for real. GREEN is the only
  # acceptable state on the day this merges, and it stays the ratchet every de-tangling slice runs
  # against afterwards.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: The guard passes across the whole repository with the extraction rule active at its initial scope
    When the git/gh guard runs across the whole ADW repository
    Then the guard run reports no violations

  # ── §8 TYPE-CHECK BACKSTOP (T22) ───────────────────────────────────────────────────────
  #
  # A fourth member joins the `ViolationRule` union, and every exhaustive switch or mapped type over
  # it — in the runner's output path and in the guard's own suite — has to grow with it. That is a
  # compile error, not a behaviour, and `tsc` is the cheapest complete proof it was handled
  # everywhere. feature-792 §20 and feature-812 §5 precedent.

  @adw-816 @adw-i4q2gf-extraction-readiness
  Scenario: TypeScript type-check passes with the fourth guard rule wired in
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
