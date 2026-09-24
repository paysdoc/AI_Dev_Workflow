# Chore: ADW switchover to `@paysdoc/devplatform`

## Metadata
issueNumber: `840`
adwId: `20l8es-adw-switchover-to-pa`
issueJson: `{"number":840,"title":"ADW switchover to @paysdoc/devplatform","body":"**Parent PRD:** specs/prd/gitcontext-library-extraction.md. Runbook: specs/runbooks/gitcontext-extraction.md step 7.\n\n**What to build:** One atomic migration. Add @paysdoc/devplatform@1.0.0 as a dependency; rewrite every adws/gitContext import to @paysdoc/devplatform/git and every adws/providers import to @paysdoc/devplatform (ports, domain model) or @paysdoc/devplatform/providers (forgeProviders, adapters); repoint buildLaunchBoundary at the library's forgeProviders and GitContext; delete adws/gitContext/ and adws/providers/; set ADW's guard EXEMPT_PACKAGES to the empty set, delete the extraction-readiness rule, and remove the now-stale adws/providers/forgeProviders.ts entry from SANCTIONED_CONSTRUCTION_SITES; update the identity/construction rules to recognise the imported names; update features/regression/**/feature-729.feature path references; retire the living docs for the extracted modules and their conditional_docs.md entries.\n\n**Acceptance criteria:**\n- [ ] No adws/gitContext/ or adws/providers/ directory; no relative import of either remains\n- [ ] Guard exempt set empty; a git/gh shell-out anywhere in ADW fails CI; SANCTIONED_CONSTRUCTION_SITES lists only the launch boundary\n- [ ] Full unit suite, typecheck, BDD regression green\n- [ ] feature-729.feature and living docs updated; bun run lint:docs-index green\n\nOperator verification (smoke workflow, rollback tag) is runbook step 7.4, not an acceptance criterion.\n\n**User stories:** 23, 24, 25, 26, 27, 29.\n","state":"OPEN","author":"paysdoc","labels":["hitl"],"createdAt":"2026-09-10T13:52:29Z","comments":[],"actionableComment":null}`

## Chore Description

Phase B step 7 of `specs/prd/gitcontext-library-extraction.md`: ADW stops carrying the
git core and the forge provider layer in-tree and consumes them from the published
`@paysdoc/devplatform` package instead. One atomic migration:

1. Add `@paysdoc/devplatform` as a runtime dependency.
2. Rewrite all 270 relative imports (across 141 files) that resolve into
   `adws/gitContext/` or `adws/providers/` onto the library's three entry points:
   - `@paysdoc/devplatform` — forge ports + domain model (`IssueTracker`, `CodeHost`,
     `BoardManager`, `Platform`, `RepoIdentifier`, `Issue`, `PullRequest`,
     `BoundProviders`, `RepoContext`, `validateRepoIdentifier`, …)
   - `@paysdoc/devplatform/providers` — `forgeProviders()` and the GitHub/GitLab/Jira
     adapters
   - `@paysdoc/devplatform/git` — `GitContext`, the executor/port types,
     worktree/workspace/claim ops, `consoleLogger`, bootstrap reads
3. Repoint `buildLaunchBoundary` (`adws/core/launchGitContext.ts`) at the library's
   `forgeProviders` and `GitContext`.
4. Delete `adws/gitContext/` and `adws/providers/` (36 of ADW's 180 unit-test files
   leave with them — they already live in the library repo).
5. Guard changes: `EXEMPT_PACKAGES` → empty set; delete the `extraction-readiness`
   rule and all its plumbing; `SANCTIONED_CONSTRUCTION_SITES` → the launch boundary
   only; keep the identity/construction rules firing on the now-imported names and
   prove it with tests.
6. Update `features/regression/upgrade/feature-729.feature` path references and its
   step definitions.
7. Retire the living docs of the extracted modules and their `.adw/conditional_docs.md`
   entries; refresh `README.md`, `adws/README.md`, `.adw/project.md`,
   `UBIQUITOUS_LANGUAGE.md`.

### Blocking prerequisite — the published 1.0.0 surface is too narrow

The issue says "add `@paysdoc/devplatform@1.0.0`". Verified against the packed 1.0.0
tarball (`npm pack @paysdoc/devplatform@1.0.0`, then resolving its `exports` map and
its three barrels): **1.0.0 does not export 15 symbols that ADW production code and
regression steps import today.** The `exports` map is closed (`.`, `./providers`,
`./git`, `./package.json`), so a deep import such as
`@paysdoc/devplatform/providers/github/githubTokenProvider` does not resolve. The
modules exist in `dist/`, they are simply not re-exported by
`src/index.ts` / `src/providers/index.ts` / `src/providers/github/index.ts` /
`src/git/index.ts`.

Missing from `@paysdoc/devplatform/providers`:

| Symbol(s) | Library module | ADW consumers |
|---|---|---|
| `createGitHubTokenProvider`, `createLiteralTokenProvider` | `providers/github/githubTokenProvider` | `adws/core/launchGitContext.ts`, 8 unit tests, 4 step-def files |
| `createGhRepoApi` (+ type `GhRepoApi`) | `providers/github/ghRepoApi` | `adws/core/issueRecord.ts`, `adws/forge/hitlBoardNotifier.ts`, `adws/healthCheckChecks.ts`, `feature-797.steps.ts` |
| `readLocalRepoInfo`, `resolveBootstrapGitIdentity` | `providers/github/githubIdentity` | `adws/core/launchGitContext.ts`, `adws/core/orchestratorCli.ts`, `adws/healthCheck.tsx`, `adws/triggers/pauseQueueScanner.ts`, `adws/triggers/trigger_cron.ts` |
| `isGitHubAppConfigured`, `getInstallationToken`, type `GitHubAppConfig` | `providers/github/appAuth` | `adws/core/githubAppAuth.ts` |
| `resolveContextToken` | `providers/github/tokenResolver` | `adws/core/launchGitContext.ts` |
| `ghAuthToken` | `providers/github/ghAuthToken` | `adws/core/launchGitContext.ts` |
| `parseGitHubIssue` | `providers/github/ghIssueParsers` | `adws/core/issueRecord.ts` |
| `selectPreferredPR` | `providers/github/ghPrParsers` | `adws/forge/hitlBoardNotifier.ts` |
| `convertToSshUrl` | `providers/github/cloneUrl` | `adws/core/targetRepoManager.ts` |
| `GitLabApiClient` | `providers/gitlab/gitlabApiClient` | `feature-818.steps.ts`, `feature-820.steps.ts` |

Missing from `@paysdoc/devplatform/git`:

| Symbol(s) | Library module | ADW consumers |
|---|---|---|
| `commitOps`, `isLeaseRejection` | `git/commitOps` | `adws/vcs/__tests__/commitOperations.test.ts`, `features/regression/step_definitions/feature-729.steps.ts` |
| `branchOps` | `git/branchOps` | `adws/vcs/__tests__/fetchAndResetToRemote.test.ts` |

This is not optional: with `EXEMPT_PACKAGES` empty, ADW may not shell out to `git`/`gh`
at all, so it *must* obtain `ghAuthToken`, `readLocalRepoInfo`,
`resolveBootstrapGitIdentity`, `createGhRepoApi` and the App-auth pair from the library.
There is no open issue on `paysdoc/devplatform` covering this (issues 1–4 are all
closed; only 1.0.0 is published).

**Assumption this plan proceeds under:** a library issue widening those two barrels is
filed and released first (call it L4), and ADW pins the resulting version. Everything in
Step 1 below is the operator/library-side prerequisite; Steps 2–13 are the ADW work and
are unblocked the moment the widened version is on npm. If the operator prefers, the
alternative is to keep the ten `providers/github/*` helpers and the two `git` op
namespaces as ADW-owned re-implementations — but that re-creates the shell-out sites the
empty exempt set is meant to forbid, so it is not recommended.

## Relevant Files

Use these files to resolve the chore:

### Dependency and build configuration
- `package.json` — add `@paysdoc/devplatform` to `dependencies` (exact pin, no caret:
  A2's Dependabot owns bumps). Also holds `lint:git-guard` / `lint:docs-index` scripts.
- `bun.lock` — regenerated by `bun install`.
- `tsconfig.json`, `adws/tsconfig.json` — both already use `moduleResolution: "bundler"`,
  which honours the library's `exports` map; no change expected, verify only.
- `vitest.config.ts` — `include: ['adws/**/__tests__/**/*.test.ts', 'test/mocks/__tests__/**/*.test.ts']`;
  deleting the two packages removes 36 test files from the run. No config change.

### Deleted wholesale
- `adws/gitContext/**` — 18 modules + `__tests__/`. The git core; now `@paysdoc/devplatform/git`.
- `adws/providers/**` — `types.ts`, `forgeProviders.ts`, `workspaceValidation.ts`,
  `index.ts`, `github/`, `gitlab/`, `jira/`, `__tests__/`. Now the root and
  `/providers` entry points.

### The launch boundary
- `adws/core/launchGitContext.ts` — the single sanctioned construction site. Imports
  `GitContext`, `readLocalRepoInfo`, `resolveBootstrapGitIdentity`, `ghAuthToken`,
  `resolveContextToken`, `createGitHubTokenProvider`, `forgeProviders`,
  `ForgeProvidersOptions`, `ForgeProviderDeps`, `BoundProviders`, `RepoIdentifier`,
  `Platform` — every one of them from the two deleted directories. The densest single
  rewrite in the change, and the file whose docblock most needs rewording.
- `adws/core/forgeWiring.ts` — ADW's env→adapter-config wiring (`GitLabConfig`,
  `JiraConfig`, `JiraAuth`, `GitHubForgeDeps` seams).
- `adws/core/providerConfig.ts` — `CodeHostForge`/`IssueTrackerForge` parsing.
- `adws/core/workspaceBinding.ts` — imports `validateWorkingDirectory`/`parseOwnerRepoFromUrl`
  from `adws/providers/workspaceValidation`.
- `adws/core/githubAppAuth.ts` — thin env wrapper re-exporting `adws/providers/github/appAuth`.

### Guard (the rule surgery)
- `adws/checkGitGhGuard.ts` — `EXEMPT_PACKAGES`, `isExemptPackage`, `pruneExemptPackages`,
  `descendIntoScope`, `collectScopeEntry`, `collectExtractionScopeFiles`,
  `scanExtractionScope`, and `main()`'s hard-coded "Exempt packages (2)" banner.
- `adws/guard/extractionRule.ts` — **deleted** (the rule the PRD says dies with the
  directories it guarded).
- `adws/guard/constructionRule.ts` — drop `adws/providers/forgeProviders.ts` from
  `SANCTIONED_CONSTRUCTION_SITES`; rewrite the docblock paragraph that says
  `adws/providers/github/**` "never reach this rule at all" via `isExemptPackage`.
- `adws/guard/identityRule.ts` — name-based matching is unchanged by the move; docblock
  references to `adws/providers/github/githubIdentity.ts` need repointing.
- `adws/guard/guardReport.ts` — `printExtractionScope` deleted; `printSanctionedConstructionSites` kept.
- `adws/guard/violationTypes.ts` — drop `'extraction-readiness'` from `ViolationRule`.
- `adws/guard/__tests__/extractionRule.test.ts`, `adws/guard/__tests__/extractionRule.integration.test.ts` — **deleted**.
- `adws/__tests__/checkGitGhGuard.test.ts` — drop extraction-rule coverage, add
  imported-name coverage for the identity/construction rules.
- `.github/workflows/git-cli-guard.yml` — job name and step name say "4 rules incl.
  extraction-readiness"; now three.

### Consumers of the extracted packages (the mechanical rewrite)
Grouped by what each imports; the full per-module inventory is in Step 4's mapping table.
- `adws/vcs/**` — `worktreeOperations.ts`, `worktreeProbe.ts`, and three `__tests__`
  files that reach `commitOps`/`branchOps`/`worktreeResetOps` directly.
- `adws/core/**` — `issueRecord.ts`, `remoteReconcile.ts`, `targetRepoManager.ts`,
  `unaddressedComments.ts`, `upgradeClaim.ts`, `orchestratorCli.ts`, `adwLabels.ts`,
  `issueClassifier.ts`, `workflowCommentParsing.ts` + tests.
- `adws/phases/**` — `workflowInit.ts`, `worktreeSetup.ts`, `upgradeGate.ts`,
  `branchIdentityFallback.ts`, `workflowRepoIdentity.ts`, `diffEvaluationPhase.ts`,
  `branchNameResolution.ts`, `prReviewPhase.ts`, and ~10 more via `providers/types`.
- `adws/triggers/**` — `trigger_cron.ts`, `autoMergeHandler.ts`, `devServerJanitor.ts`,
  `pauseQueueScanner.ts`, `perIssueSweepPersist.ts` and the trigger test suite.
- `adws/forge/**` — `hitlBoardNotifier.ts` (also `selectPreferredPR`, `createGhRepoApi`),
  `adwLabelProvisioning.ts`, `linkedPrDetector.ts`, `prCommentDetector.ts`,
  `workflowCommentsBase.ts`.
- `adws/agents/**` — `claudeAgent.ts`, `buildAgent.ts`, `gitAgent.ts`, `planAgent.ts`, `scenarioAgent.ts`.
- `adws/healthCheck.tsx`, `adws/healthCheckChecks.ts`, `adws/adwUpgrade.tsx`,
  `adws/adwMerge.tsx`, `adws/adwClearComments.tsx`, `adws/promotion/promotionStatsLoader.ts`,
  `adws/proof/types.ts`.
- `features/per-issue/step_definitions/**` — `gitContextSharedWorld.ts`,
  `feature-794/796/797/810/817/818/819/820/821/823*.steps.ts` (they use `.ts`-suffixed
  deep relative paths that must become bare package specifiers).
- `features/regression/step_definitions/feature-729.steps.ts`,
  `features/regression/step_definitions/pythonFixtureE2ESteps.ts`.
- `adws/forge/__tests__/hitlBoardNotifier.test.ts`, `adws/phases/__tests__/prReviewCompletion.test.ts`
  — import `makeCtx`/`makeSpyExec` from `adws/providers/github/__tests__/gitContextFixture.ts`,
  a `__tests__` file the package never publishes. These need a local fixture (see New Files).

### Do NOT touch — a different `providers` directory
- `adws/cost/providers/anthropic/**` and every `../cost/providers/...` /
  `./providers/anthropic/...` import. These resolve to `adws/cost/providers`, not
  `adws/providers`, and must survive the rewrite untouched. A naive
  `../providers` → `@paysdoc/devplatform/providers` regex breaks them.

### BDD
- `features/regression/upgrade/feature-729.feature` — three narrative references to
  `adws/gitContext/commitOps.ts` (lines 24, 36) and `adws/gitContext/__tests__/` (line 81).
- `features/regression/vocabulary.md` — check for extracted-path mentions.

### Docs (retirement and refresh)
- `.adw/conditional_docs.md` — 45 entries, band `[25, 60]`. Two `Owns:` globs point at
  the deleted directories: `adws/providers/**` (line 259) and `adws/gitContext/**`
  (line 412). ~14 `Conditions:` lines cite extracted paths.
- `app_docs/feature-9gjajh-providers.md` — owns **only** `adws/providers/**`. Retire:
  delete the doc and its index entry (45 → 44 entries, still inside the band).
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — owns `adws/gitContext/**`
  **plus** `adws/core/launchGitContext.ts`, `adws/guard/**`, `adws/checkGitGhGuard.ts`,
  `adws/core/githubAppAuth.ts`, `forgeWiring.ts`, `workspaceBinding.ts`, `issueRecord.ts`
  and their tests. **Keep the doc**; drop the `adws/gitContext/**` glob and rewrite the
  conditions describing extracted internals and the deleted extraction rule.
- `app_docs/feature-9gjajh-github-api.md`, `app_docs/feature-9gjajh-types.md`,
  `app_docs/feature-9gjajh-webhook-triggers.md`,
  `app_docs/feature-9gjajh-workflow-lifecycle-phases.md` — condition lines citing
  `adws/providers/...` paths.
- `README.md` — the GitContext, guardrail and multi-provider bullets (lines 17, 18, 22),
  the numbered tour entry (line 137), and the directory-tree blocks for
  `adws/gitContext/` and `adws/providers/` (~lines 660–700, 980–985).
- `adws/README.md` line 690, `.adw/project.md` line 15, `UBIQUITOUS_LANGUAGE.md` line 75.
- `specs/runbooks/gitcontext-extraction.md` — step 7 is the source of truth for the
  operator half; do not rewrite it, but note step 7.4 completion is a human gate.

### Reference (read, do not edit)
- `specs/prd/gitcontext-library-extraction.md` — stories 23, 24, 25, 26, 27, 29.
- `.adw/coding_guidelines.md` — guard clauses, max nesting ~2, no `any`, JSDoc on
  public surfaces, remove unused imports.
- `.adw/commands.md` — validation command strings.

### New Files
- `test/mocks/gitContextFixture.ts` — ADW-local copy of the exec-fake fixture
  (`validOptions`, `makeSpyExec`, `makeCtx`, `makeCapturingLogger`, `FRAMEWORK_ROOT`,
  `TARGET_REPOS_DIR`, types `SpyCall`/`CapturedLog`) currently at
  `adws/providers/github/__tests__/gitContextFixture.ts`. It constructs
  `new GitContext(...)`, so it must live under `test/` — that directory is in the guard's
  `EXEMPT_DIR_NAMES` and is never walked, so the construction rule will not flag it.
  Its `GitContext`/`createLiteralTokenProvider` imports come from the library.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1 — Confirm (or unblock) the library's published surface

- Re-run the surface check before writing any code:
  ```
  npm view @paysdoc/devplatform version
  mkdir -p /tmp/dp-surface && cd /tmp/dp-surface && npm pack @paysdoc/devplatform && tar xzf paysdoc-devplatform-*.tgz
  node -e "(async()=>{for(const s of ['index','providers/index','git/index']){const m=await import('/tmp/dp-surface/package/dist/'+s+'.js');console.log(s, Object.keys(m).sort().join(' '))}})()"
  ```
  and read `package/dist/index.d.ts`, `package/dist/providers/index.d.ts`,
  `package/dist/providers/github/index.d.ts`, `package/dist/git/index.d.ts` for the
  type-only exports.
- Compare against the two "Missing from" tables in the Chore Description.
- **If every symbol is present**, note the version and go to Step 2.
- **If any is missing**, STOP the code migration and report the blocker: file (or ask
  the operator to file) issue L4 on `paysdoc/devplatform` — "Widen the public surface for
  the ADW switchover" — asking for `src/providers/github/index.ts` to add
  `githubTokenProvider`, `ghRepoApi`, `githubIdentity`, `appAuth`, `tokenResolver`,
  `ghAuthToken`, `ghIssueParsers`, `ghPrParsers`, `cloneUrl`; `src/providers/gitlab/index.ts`
  to add `GitLabApiClient`; and `src/git/index.ts` to add `commitOps`, `isLeaseRejection`,
  `branchOps` — plus an import-graph assertion that `./git` still pulls no adapter module.
  Do not work around it by re-implementing the helpers in ADW: that reintroduces the
  `git`/`gh` shell-out sites the empty exempt set forbids.

### Step 2 — Add the dependency

- `bun add @paysdoc/devplatform@<version-from-step-1>` — an **exact** pin, no caret range;
  A2's Dependabot config owns future bumps and every bump is human-merged.
- Confirm it lands in `dependencies` (not `devDependencies`): orchestrators import it at
  runtime.
- Verify all three subpaths resolve under the runtime ADW actually uses:
  ```
  bunx tsx -e "import('@paysdoc/devplatform').then(m=>console.log(Object.keys(m).length))"
  bunx tsx -e "import('@paysdoc/devplatform/providers').then(m=>console.log(Object.keys(m).length))"
  bunx tsx -e "import('@paysdoc/devplatform/git').then(m=>console.log(Object.keys(m).length))"
  ```

### Step 3 — Land the local test fixture

- Create `test/mocks/gitContextFixture.ts` as a verbatim copy of
  `adws/providers/github/__tests__/gitContextFixture.ts`, with its two imports repointed:
  `GitContext` + the `GitContextOptions`/`ExecFn`/`Logger`/`LogLevel` types from
  `@paysdoc/devplatform/git`, `createLiteralTokenProvider` from
  `@paysdoc/devplatform/providers`.
- Keep the docblock but restate its provenance (moved out of the extracted package at the
  switchover; ADW-owned from here).
- Repoint its two consumers now, so nothing depends on the doomed path:
  - `adws/forge/__tests__/hitlBoardNotifier.test.ts`
  - `adws/phases/__tests__/prReviewCompletion.test.ts`

### Step 4 — Rewrite every import (the mechanical core)

Apply this mapping to every import/export/`require`/dynamic-import specifier that
**resolves** into the two directories. Resolve the specifier, do not pattern-match the
text — `adws/cost/providers/anthropic/**` must not be touched.

| Resolved target | New specifier |
|---|---|
| `adws/gitContext`, `adws/gitContext/index.ts`, `adws/gitContext/types`, `adws/gitContext/gitContext`, `adws/gitContext/consoleLogger`, `adws/gitContext/bootstrapIdentity`, `adws/gitContext/commitOps(.ts)`, `adws/gitContext/branchOps`, `adws/gitContext/worktreeResetOps` | `@paysdoc/devplatform/git` |
| `adws/providers/types(.ts)` | `@paysdoc/devplatform` |
| `adws/providers`, `adws/providers/index.ts`, `adws/providers/forgeProviders(.ts)`, `adws/providers/workspaceValidation`, `adws/providers/github/**`, `adws/providers/gitlab/**`, `adws/providers/jira/**` | `@paysdoc/devplatform/providers` |
| `adws/providers/github/__tests__/gitContextFixture` | relative path to `test/mocks/gitContextFixture` (done in Step 3) |

Rules while rewriting:
- Drop `.ts` suffixes — the step-definition files use `'../../../adws/providers/types.ts'`
  style paths; bare package specifiers carry no extension.
- Merge the duplicate specifiers a file ends up with. `adws/core/launchGitContext.ts`
  collapses six separate imports into one `@paysdoc/devplatform/providers` import (plus
  one `/git` and one root); keep `import type` separate from value imports where the
  existing file does.
- Preserve `import type` vs value imports exactly — `Platform` and `BoardStatus` are
  enums (values); `RepoIdentifier`, `BoundProviders`, `IssueTracker`, `CodeHost`,
  `GitIdentity`, `TokenProvider`, `ExecFn`, `FsDeps`, `GitContextOptions`,
  `LogSinceOptions`, `ForgeProvidersOptions`, `ForgeProviderDeps`, `GitLabConfig`,
  `JiraConfig`, `JiraAuth`, `GitHubIssue`/`GitHubLabel`/`GitHubComment`, `RawPR` are types.
- Delete the stale "Deep imports only — never the `../providers` barrel, which closes an
  import cycle back through `../../core` (#792)" comment in `launchGitContext.ts` and the
  matching one in `forgeWiring.ts`: the cycle argument dies with the in-tree package, and
  the barrel is now the published entry point.
- Verify the sweep is complete with:
  `git grep -nE "from ['\"][^'\"]*\.\./(gitContext|providers)(/|['\"])" -- '*.ts' '*.tsx'`
  and `git grep -n "adws/gitContext\|adws/providers" -- '*.ts' '*.tsx'`.
  Both must print nothing outside the two directories (which still exist at this point)
  and outside comment text you have already updated.

### Step 5 — Repoint the launch boundary

- `adws/core/launchGitContext.ts`: `new GitContext(...)` now constructs the library's
  class; `forgeProviders` is the library's assembly function; `resolveLaunchToken`,
  `createLaunchTokenProvider` and `resolveLaunchGitIdentity` compose library helpers.
- Rewrite the module docblock: it currently explains why the adapter "lives in adws/core/
  (not adws/gitContext/) so the gitContext package stays free of ADW-global dependencies".
  Restate it as: ADW's wiring layer over `@paysdoc/devplatform`, the one place identity is
  resolved, and the only sanctioned construction site now that the library owns
  `forgeProviders`.
- `adws/core/githubAppAuth.ts`: its `appAuth` re-exports come from
  `@paysdoc/devplatform/providers`; keep the `GITHUB_APP_*` env reading in ADW (the
  library must not read the host's environment — PRD story 9).
- No behaviour change anywhere in this step (PRD story 29): same identity threading, same
  seams, same `LaunchGitContextDeps` shape.

### Step 6 — Delete the extracted directories

- Remove `adws/gitContext` and `adws/providers` from the index and the worktree
  (`git rm -r <dir>` for each).
- Confirm nothing else referenced them: re-run the two greps from Step 4; they must be
  silent across `*.ts`, `*.tsx` **and** `*.feature`.
- Expect 36 unit-test files to leave the vitest run (180 → 144). That is the intended
  relocation, not lost coverage — those suites live in `paysdoc/devplatform`.

### Step 7 — Empty the guard's exempt set and delete the extraction rule

In `adws/checkGitGhGuard.ts`:
- `export const EXEMPT_PACKAGES = [] as const;` — keep the exported name and
  `isExemptPackage()` (both are part of the rule's contract and are exercised by tests);
  update the docblock to say the set is deliberately empty because the git core and the
  GitHub adapter now live in `@paysdoc/devplatform`, and that **nothing may ever be added
  back**.
- Make `main()`'s banner derive from the array instead of the hard-coded
  `Exempt packages (2):` — print `Exempt packages: none — no in-repo code may shell out
  to git or gh` when empty.
- Delete `descendIntoScope`, `collectScopeEntry`, `collectExtractionScopeFiles`,
  `scanExtractionScope`, the `flagFrameworkImports`/`EXTRACTION_SCOPE` imports, the
  `printExtractionScope` call, the extraction half of the pass/fail output, and the
  extraction-readiness line of the remedy block. Update the four-rules docblock to three.
- `pruneExemptPackages` now only prunes `EXEMPT_DIR_NAMES`; keep it (renaming is
  gratuitous churn) but adjust its comment.

Delete:
- `adws/guard/extractionRule.ts`
- `adws/guard/__tests__/extractionRule.test.ts`
- `adws/guard/__tests__/extractionRule.integration.test.ts`
- `printExtractionScope` from `adws/guard/guardReport.ts`
- the `'extraction-readiness'` member of `ViolationRule` in `adws/guard/violationTypes.ts`

Update `.github/workflows/git-cli-guard.yml`: the job name
("…, or framework imports inside the extractable packages") and the step name
("Run Git/GH CLI guard (4 rules incl. extraction-readiness)") both drop the extraction
rule — three rules now.

### Step 8 — Trim the sanctioned-construction allowlist and keep the name-based rules honest

In `adws/guard/constructionRule.ts`:
- `SANCTIONED_CONSTRUCTION_SITES` keeps only
  `{ file: 'adws/core/launchGitContext.ts', … }`. Both entries are PERMANENT (no `owner`),
  so `findStaleSanctionedEntries` is unaffected — verify by running the guard, not by
  reasoning alone.
- Rewrite the docblock paragraph claiming `adws/providers/github/**` and
  `adws/gitContext/**` "never reach this rule at all" because `isExemptPackage` prunes
  them: with the exempt set empty and both directories gone, the rule's flagged-callee
  names (`createGitHubIssueTracker`, `createGitHubCodeHost`, `createGitHubBoardManager`,
  `createGitLabCodeHost`, `createGitLabBoardManager`, `createJiraIssueTracker`,
  `createJiraBoardManager`, `forgeProviders`, `new GitContext`) are now names **imported
  from `@paysdoc/devplatform/providers` and `/git`**. State that explicitly — that is PRD
  story 24.
- Keep the retired names (`createRepoContext`, `mintBoundProviders`, `gitContextFor*`,
  `getRepoInfo`) in their sets; they remain reintroduction guards.

In `adws/guard/identityRule.ts`:
- No logic change — `readLocalRepoInfo` and `forgeProviders` are matched by identifier
  text, which survives the move.
- Repoint the docblock's `adws/providers/github/githubIdentity.ts` references at the
  library, and add one sentence recording the known limitation: an **aliased** import
  (`import { GitContext as GC }`) would evade both name-based rules. That is unchanged by
  this migration and deliberately out of scope.

In `adws/__tests__/checkGitGhGuard.test.ts`:
- Remove extraction-rule coverage.
- Add both-direction cases proving the surviving rules still fire on library-imported
  names: a fixture source that does
  `import { forgeProviders } from '@paysdoc/devplatform/providers'` then
  `forgeProviders({ identity: readLocalRepoInfo() })` must produce a
  `cwd-derived-identity` violation, and one that does
  `import { GitContext } from '@paysdoc/devplatform/git'` then `new GitContext(opts)`
  from a non-sanctioned path must produce an `unsanctioned-construction` violation —
  while `adws/core/launchGitContext.ts` stays clean.
- Add a case asserting a bare `git status` / `gh pr view` shell-out is now flagged from a
  path that used to be exempt (`adws/gitContext/foo.ts`, `adws/providers/github/bar.ts`),
  which is the "guard exempt set empty" acceptance criterion in test form.

### Step 9 — Update the BDD layer

- `features/regression/upgrade/feature-729.feature`: rewrite the three narrative path
  references — `adws/gitContext/commitOps.ts` (×2) becomes the library's
  `commitOps` (`@paysdoc/devplatform/git`, `src/git/commitOps.ts` in the library repo),
  and the `adws/gitContext/__tests__/` note becomes the library's test home. Do **not**
  change any `Given`/`When`/`Then` phrase: the scenarios are frozen regression vocabulary
  and the steps assert on a real temporary git repo's commit tree, not on file paths.
- `features/regression/step_definitions/feature-729.steps.ts`: `commitOps` now imports
  from `@paysdoc/devplatform/git`.
- `features/per-issue/step_definitions/**`: apply the Step 4 mapping to
  `gitContextSharedWorld.ts` and the `feature-794/796/797/810/817/818/819/820/821/823*`
  step files.
- `features/regression/step_definitions/pythonFixtureE2ESteps.ts`: `providers/types` →
  root import.
- `grep -rn "adws/gitContext\|adws/providers" features/` must come back empty.

### Step 10 — Retire and refresh the living docs

- Delete `app_docs/feature-9gjajh-providers.md` and its `.adw/conditional_docs.md` entry
  (it owns `adws/providers/**` only, so leaving either half behind trips the gate:
  the entry becomes dangling, the doc becomes orphaned). 45 → 44 entries, band `[25, 60]`.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` and its index entry: keep
  the doc, remove the `adws/gitContext/**` glob from `Owns:` (the remaining globs are
  all live ADW files), and rewrite the conditions that:
  - describe GitContext internals ("base-path resolution, per-command credential
    injection, worktree management, the git-only bootstrap primitives") → repoint at
    `@paysdoc/devplatform/git` and the library repo;
  - mention the extraction-readiness rule, `EXTRACTION_SCOPE` widening, or
    `Extraction-readiness scope — 10 entries` → delete outright, the rule is gone;
  - say the guard has "four rules" → three;
  - name `adws/providers/forgeProviders.ts` as a sanctioned site → the launch boundary
    is the only one.
  Add one condition: "When a `@paysdoc/devplatform` symbol is missing or misbehaving —
  the git core and the forge adapters live in `paysdoc/devplatform`; ADW pins an exact
  version and Dependabot proposes bumps."
- `app_docs/feature-9gjajh-github-api.md`, `-types.md`, `-webhook-triggers.md`,
  `-workflow-lifecycle-phases.md`: repoint condition lines citing `adws/providers/...`
  paths at the library entry points. Do not delete these docs — their `Owns:` globs
  (`adws/forge/**`, `adws/types/**`, …) are all still live.
- Check `.adw/conditional_docs.md` for any remaining `adws/gitContext`/`adws/providers`
  string; every one is either a repointed condition or deleted.
- `README.md`: rewrite the GitContext bullet (line 17), the guardrail bullet (line 18 —
  four rules → three, exempt set empty, allowlist one entry), the multi-provider bullet
  (line 22), the numbered tour entry (line 137), and remove the `adws/gitContext/` and
  `adws/providers/` directory-tree blocks (~660–700) plus the `extractionRule.ts` /
  `constructionRule.ts` tree lines (~980–985). Add a short note that the git core and
  forge adapters are consumed from `@paysdoc/devplatform`.
- `adws/README.md` line 690, `.adw/project.md` line 15 (drop the `adws/providers/**`
  Relevant-Files entry — and the already-stale `adws/github/**` one), and
  `UBIQUITOUS_LANGUAGE.md` line 75 (the **GitContext** definition's `adws/gitContext/`
  parenthetical becomes `@paysdoc/devplatform/git`).
- Note for the operator: `.adw/**` edits change ADW's content hash and will trip the
  upgrade gate for registered target repos on their next workflow. That is expected and
  unavoidable — the issue mandates the `conditional_docs.md` edits.

### Step 11 — Hygiene pass against the coding guidelines

- Remove imports left unused by the consolidation (`bun run lint` catches these, but read
  the diff too).
- Every rewritten docblock must describe the code as it now is: no "moved from", no
  "#823 formerly", no references to files that no longer exist in this repo. Where a
  reader genuinely needs the history, point at `paysdoc/devplatform` or at
  `specs/prd/gitcontext-library-extraction.md`.
- No `any` introduced by the type re-homing; no file pushed past the ~300-line cap the
  guard-adjacent modules observe.

### Step 12 — Full local validation

Run every command in `Validation Commands`, in order, and fix until all are green.
Expected deltas to confirm rather than be surprised by:
- vitest: 36 fewer test files (180 → 144); zero failures.
- `lint:git-guard`: "Exempt packages: none", "Sanctioned construction sites — 1
  permanent, 0 sunset", no extraction-readiness section, PASS.
- `lint:docs-index`: 44 entries, no dangling entry, no orphaned doc, no overlapping glob.

### Step 13 — Hand off the operator gate

- The PR is `hitl`-labelled; auto-merge is deferred until a human approves.
- Restate in the PR body that runbook step 7.4 is the operator's, not the agent's: run
  the full suite locally, trigger one live smoke workflow from the PR branch through PR
  creation, tag the pre-merge commit `pre-gitcontext-switchover` and push the tag, then
  approve.
- Note the rollback path (runbook step 8): hand-revert of the merge commit on `dev` and
  `main`; ADW runs on the library after this lands and cannot repair its own switch.
- If Step 1 blocked, the PR must not be opened at all — report the L4 prerequisite
  instead.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun install` — resolve the new dependency and refresh `bun.lock`.
- `bun run lint` — ESLint over the whole repo; catches imports left unused by the rewrite.
- `bunx tsc --noEmit` — root typecheck; the primary proof that every rewritten import
  resolves through the library's `exports` map and that no symbol was silently dropped.
- `bunx tsc --noEmit -p adws/tsconfig.json` — the additional ADW-scoped typecheck from
  `.adw/commands.md`.
- `bun run test:unit` — full vitest suite (expect 144 test files, 0 failures).
- `bun run lint:git-guard` — must print an empty exempt set, exactly one sanctioned
  construction site (`adws/core/launchGitContext.ts`), no extraction-readiness section,
  and PASS.
- `bun run lint:docs-index` — living-docs index gate: no dangling entry, no orphaned doc,
  no overlapping `Owns:` glob, entry count inside `[25, 60]`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the BDD regression
  suite, including `feature-729`.
- `git grep -nE "from ['\"][^'\"]*(gitContext|adws/providers)" -- '*.ts' '*.tsx'` — must
  print nothing.
- `test ! -d adws/gitContext && test ! -d adws/providers && echo "directories gone"` —
  the first acceptance criterion, mechanically.

## Notes

- `.adw/coding_guidelines.md` applies throughout: guard clauses first, max nesting ~2,
  no `any`, JSDoc on public surfaces, remove unused imports, keep the happy path leftmost.
  Where a rewritten guard function drifts past those limits, extract rather than nest.
- **The one thing most likely to break this change quietly:** `adws/cost/providers/anthropic/**`
  is a *different* `providers` directory. Six import specifiers mention it
  (`../providers/anthropic/pricing`, `../providers/anthropic/extractor`,
  `./providers/anthropic/index.ts`, `../cost/providers/anthropic/extractor`). Resolve
  specifiers to repo-relative paths before rewriting; never text-match `providers`.
- The guard's identity and construction rules match **bare identifier text**, so they keep
  working across the move with no logic change — that is PRD story 24 and it is why the
  rules were written name-based rather than file-based. The tests in Step 8 are what turn
  that from an argument into a fact. The known evasion (aliased imports) predates this
  change and stays out of scope.
- ADW currently has **zero** `git`/`gh` shell-outs outside the two extracted packages
  (verified by scanning every file the guard scans), so emptying `EXEMPT_PACKAGES` should
  not surface a single new violation. If it does, the finding is real and must be routed
  through the library, not exempted.
- Pin the dependency **exactly** (e.g. `"@paysdoc/devplatform": "1.1.0"`, not `"^1.1.0"`).
  A2 adds the Dependabot config; every bump PR is merged by hand and sits outside the
  issue-keyed pipeline.
- Deleting 36 test files is intended, not a coverage regression: those suites moved to
  `paysdoc/devplatform` with the code (the library's CI runs them — 36 files, 834 tests as
  of 2026-09-10). The three `adws/vcs/__tests__/` suites that exercise
  `commitOps`/`branchOps`/`worktreeResetOps` **stay in ADW**, repointed at the library's
  `./git` barrel — they never moved, so deleting them would lose real coverage.
- This is a `hitl` issue for a reason: the change touches ~140 files and ADW runs on the
  library the moment it merges. Rollback is a hand revert against the
  `pre-gitcontext-switchover` tag. Keep the diff purely mechanical — no opportunistic
  refactors riding along, so the human reviewer can read it as "imports moved, guard
  narrowed, docs retired".
