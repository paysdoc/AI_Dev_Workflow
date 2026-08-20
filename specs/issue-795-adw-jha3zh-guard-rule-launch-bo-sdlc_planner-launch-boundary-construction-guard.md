# Chore: Guard rule — launch-boundary-only provider construction

## Metadata
issueNumber: `795`
adwId: `jha3zh-guard-rule-launch-bo`
issueJson: `{"number":795,"title":"Guard rule: launch-boundary-only provider construction","body":"## Parent PRD\n\nspecs/prd/gitcontext-forge-agnostic-refactor.md\n\n## What to build\n\nAdd a third rule to the CI git/gh guard: constructing a provider (tracker/code-host/board-manager implementations, RepoContext factory) or a GitContext factory outside the sanctioned launch-boundary allowlist fails the build. The existing cwd-derived-identity rule follows any factory renames. This makes the wrong-repo firewall structural: migrated callers cannot quietly mint a tracker with a hand-typed owner/repo.\n\nSee PRD sections: Implementation Decisions (CI guard extension b, c), Testing Decisions (Guard extension).\n\n## Acceptance criteria\n\n- [ ] New AST rule flags ad-hoc provider/context construction outside the allowlist\n- [ ] Sanctioned launch-boundary sites pass; a deliberate violation fixture fails\n- [ ] cwd-derived-identity rule updated for any renamed factories\n- [ ] `bun run lint:git-guard` green on the repo; guard test suite covers both directions\n\n## Blocked by\n#792 <!-- adw:region-overlap -->\n\n- Blocked by #794\n\n## Touched Files\n\n- adws/checkGitGhGuard.ts\n- adws/__tests__/checkGitGhGuard.test.ts\n\n## User stories addressed\n\n- User story 7\n- User story 8\n- User story 23","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-08-14T12:19:03Z","comments":[{"author":"paysdoc-adw","createdAt":"2026-08-14T13:11:18Z","body":"⏸️ **Deferred behind #792 — overlapping code region**\n\nADW detected that this issue edits code overlapping with #792, which is already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward push deadlock that follows), it has been serialized behind #792 by registering a `## Blocked by` dependency.\n\nOverlapping paths:\n- `adws/checkgitghguard.ts`\n- `adws/__tests__/checkgitghguard.test.ts`\n\nThis issue will spawn automatically once #792 merges and closes. To override, remove the `#792 <!-- adw:region-overlap -->` line from this issue body."}],"actionableComment":null}`

## Chore Description

`adws/checkGitGhGuard.ts` today enforces two AST rules:

1. **`git-gh-shellout`** — a call whose first argument is a `git …`/`gh …` command string, in any file outside the closed two-entry `EXEMPT_PACKAGES` set (`adws/gitContext`, `adws/providers/github`).
2. **`cwd-derived-identity`** (#769) — `gitContextForRepo(getRepoInfo())` / `gitContextForRepo(readLocalRepoInfo())`, inline or via a local variable.

Neither rule can see the shape this chore targets. `#794` created the one sanctioned construction site — `buildLaunchBoundary` (`adws/core/launchGitContext.ts:180`) resolves `{owner, repo}` exactly once and hands it to both a `GitContext` and the `BoundProviders` triple. Nothing stops a new module from bypassing it: `createGitHubCodeHost({owner: 'acme', repo: 'typo', platform: Platform.GitHub})` contains no `git`/`gh` string and no `getRepoInfo()` call, so both existing rules pass it. That is the wrong-repo bug class (~13 incidents, PRD Problem Statement) with a hand-typed identifier instead of a cwd read.

This chore adds a third rule, **`unsanctioned-construction`**, and turns the guard's rule set into a small package:

- **Flagged callees (an explicit name set, never a `create*` pattern):**
  - provider implementations — `createGitHubIssueTracker`, `createGitHubCodeHost`, `createGitHubBoardManager`, `createGitLabCodeHost`, `createGitLabBoardManager`, `createJiraIssueTracker`, `createJiraBoardManager`
  - the RepoContext factory — `createRepoContext`, `mintBoundProviders`
  - the GitContext factories — `gitContextFor`, `gitContextForSync`, `gitContextForRepo`, and the `new GitContext(…)` expression itself
- **Not flagged:** `createGhCommandRunner`, `createGitHubTokenProvider`, `createIssueCmd`/`createPRCmd`/`createLabelCmd` (command-string builders and non-provider helpers), and any *property-access* callee (`deps.gitContextForRepo(…)`, `d.gitContextForRepo(…)`) — an injected seam is the sanctioned pattern, not a bypass. Function *declarations* are never flagged, only call/new expressions.
- **Allowlist:** a file-scoped list split into two named halves — `PERMANENT` (the boundary and the mint implementation it delegates to) and `TRANSITIONAL` (the not-yet-migrated construction sites that `#796`/`#797` own). Each transitional entry names its owning issue.
- **Self-cleaning ratchet:** a whole-repo run fails when a *transitional* entry produced no construction at all — once `#796` migrates `prReviewPhase.ts`, the guard demands the entry be deleted rather than letting the allowlist rot.

### The scope trade-off, stated plainly

`gitContextForRepo` / `gitContextForSync` / `gitContextFor` have ~70 call sites across three dozen scanned files. Migrating them is explicitly `#796`/`#797`'s job (the `#794` plan: "*#795's guard rule is what forces them*"), and AC4 requires `bun run lint:git-guard` green on the repo. Those two facts can only be satisfied together by a **ratchet**: the rule is live for every file, and the pre-existing sites are enumerated as transitional entries that shrink to zero as the migration slices land. The value delivered today is that *no new file* can mint a context or a provider, and that the outstanding debt is counted and printed rather than invisible. This is deliberate; it is not a way of making the rule vacuous.

### Second half of the chore: rule renames

AC3 ("cwd-derived-identity rule updated for any renamed factories"). Verified against the post-`#794` tree: **no factory was renamed.** `gitContextForRepo` is still exported from `adws/github/gitContextFactory.ts:115`; `buildLaunchGitContext` survives as the context-only view of `buildLaunchBoundary`; `getRepoInfo` and `readLocalRepoInfo` are unchanged. So the rule needs no name edit — what it needs is a *rename-detection test*, so that the next rename fails a test instead of silently disarming the rule. Every name in `CWD_DERIVED_IDENTITY_FNS`, `CONTEXT_CONSTRUCTOR_NAME` and the new construction-rule name set is asserted to still exist as an exported declaration in its owning module.

### Why the guard is split into modules

`adws/checkGitGhGuard.ts` is 288 lines; `.adw/coding_guidelines.md` caps files at 300. The new rule plus its allowlist is ~150 lines. Moving the two composition rules (`cwd-derived-identity`, `unsanctioned-construction`) into a small `adws/guard/` package leaves the entry point at ~200 lines doing discovery + the shellout rule + composition + CLI, and each rule module well under the cap. **Every currently-exported name (`scanFiles`, `collectTsFiles`, `EXEMPT_PACKAGES`, `isExemptPackage`) must keep being exported from `adws/checkGitGhGuard.ts`** — four merged BDD step-definition files and the unit suite import from that path.

## Relevant Files

Use these files to resolve the chore:

- `adws/checkGitGhGuard.ts` — the guard entry point. Keeps `EXEMPT_DIR_NAMES`, `EXEMPT_PACKAGES`, `isExemptPackage`, `collectTsFiles`/`visitDir`, the `git-gh-shellout` rule, `scanFiles`/`scanSource`, and `main()`. Gains the third rule's wiring, its stdout block, and the stale-entry ratchet. Must re-export whatever moves out.
- `adws/__tests__/checkGitGhGuard.test.ts` — the guard's unit suite (223 lines, `vi.mock('fs')`, drives `scanFiles` over in-memory fixture sources). Gains the both-directions coverage for the new rule plus the rename-detection block.
- `adws/core/launchGitContext.ts` — **read-only.** `buildLaunchBoundary` (`:180`) and its `new GitContext({…})` (`:197`) are the permanent sanctioned site. Do not edit.
- `adws/providers/repoContext.ts` — **read-only.** `resolveIssueTracker`/`resolveCodeHost`/`resolveBoardManager` (`:196`–`:233`) call the provider factories, and `createRepoContext` (`:289`) calls `mintBoundProviders` (`:266`). This is the mint implementation the boundary delegates to — the second permanent entry.
- `adws/github/gitContextFactory.ts` — **read-only.** `gitContextForSync` (`:98`) and `gitContextForRepo` (`:115`) each `new GitContext(…)`; `gitContextFor` (`:93`) delegates. Transitional entry, owned by `#796`/`#797`.
- `adws/providers/github/githubCodeHost.ts:107`, `githubIssueTracker.ts:75`, `githubBoardManager.ts:207`, `adws/providers/gitlab/gitlabCodeHost.ts:88`, `gitlabBoardManager.ts:30`, `adws/providers/jira/jiraIssueTracker.ts:214`, `jiraBoardManager.ts:30` — **read-only.** The exported factory names the rule flags; the source of truth for the rename-detection test. Note `adws/providers/github/**` is pruned at the directory walk (`isExemptPackage` in `visitDir`), so the adapter package is never handed to any rule.
- `adws/adwUpgrade.tsx:503`, `adws/phases/prReviewPhase.ts:110`, `adws/phases/upgradeGate.ts:194`, `adws/phases/workflowInit.ts:314`, `adws/triggers/pauseQueueScanner.ts:124/160/214/271` — **read-only.** The non-boundary `createRepoContext`/`createGitHubCodeHost` sites `#794` deliberately left behind. Transitional entries.
- `features/per-issue/step_definitions/feature-700.steps.ts:231-243` — asserts `guardOutput.match(/(\d+)\s+allowlisted/)` is `0`. The regex is non-global and matches the **first** occurrence, which is the existing `scanned N files (0 allowlisted)` line. **The new stdout block must not contain the word "allowlisted" at all** — use "sanctioned construction sites". Do not touch the existing line.
- `features/per-issue/step_definitions/feature-769.steps.ts:380`, `feature-691.steps.ts:84` — run `bunx tsx adws/checkGitGhGuard.ts` across the whole repo and assert exit 0. These are the AC4 regression net.
- `features/per-issue/step_definitions/feature-792.steps.ts:51` (`scanFiles`, `collectTsFiles`), `feature-769.steps.ts:48` / `feature-691.steps.ts:19` (`scanFiles`) — the import surface that must survive the module split.
- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — the living doc that **Owns** `adws/checkGitGhGuard.ts` (per `.adw/conditional_docs.md`). Must gain the third rule, the allowlist shape, and the new file layout.
- `.adw/conditional_docs.md` (the `feature-bq1f45-git-gh-cli-guard.md` block, ~line 2147) — conditions list must mention the third rule and the new module paths.
- `README.md:18` and `README.md:919` — the guard's one-line descriptions. Both are already stale (they still say `adws/gitContext` is "the sole structurally-exempted package", pre-`#792`); bring them current while adding the third rule.
- `.adw/coding_guidelines.md` — 300-line file cap, guard clauses, max nesting depth ~2, named extraction, `Readonly`/`as const` for frozen data, JSDoc on public APIs.
- `specs/prd/gitcontext-forge-agnostic-refactor.md:57` (Implementation Decisions, CI guard extension a/b/c) and `:67` (Testing Decisions, Guard extension) — the authority for this rule's shape.

### New Files

- `adws/guard/violationTypes.ts` — `ViolationRule` (now a three-member union) and `Violation`, shared by the entry point and both rule modules.
- `adws/guard/identityRule.ts` — the `cwd-derived-identity` rule moved verbatim: `CWD_DERIVED_IDENTITY_FNS`, `CONTEXT_CONSTRUCTOR_NAME`, `isZeroArgCwdDerivedCall`, `collectCwdDerivedIdentityNames`, `isContextConstructorCallee`, `describeCwdDerivedArg`, and an exported `flagCwdDerivedIdentityUses(sourceFile)` that does its own name collection.
- `adws/guard/constructionRule.ts` — the new rule: `PROVIDER_CONSTRUCTORS`, `CONTEXT_CONSTRUCTORS`, `GIT_CONTEXT_CLASS_NAME`, `SANCTIONED_CONSTRUCTION_SITES`, `isSanctionedConstructionSite`, `flagUnsanctionedConstruction(sourceFile, relPath)`, and `findStaleSanctionedEntries(seenFiles)`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Verify the pre-conditions this plan asserts

- Confirm `git log --oneline -3` shows the `#794` merge (`7eed8e2e`) as an ancestor — this chore is meaningless without `buildLaunchBoundary`.
- Confirm the factory names are unrenamed: `grep -n "export function gitContextForRepo\|export function gitContextForSync\|export async function gitContextFor" adws/github/gitContextFactory.ts` returns three hits, and `grep -rn "export function getRepoInfo" adws/github/githubApi.ts` plus `readLocalRepoInfo` in `adws/gitContext/` both resolve. If any name *has* changed, update `CWD_DERIVED_IDENTITY_FNS` / `CONTEXT_CONSTRUCTOR_NAME` accordingly and say so in the PR body (AC3).
- Run `bun run lint:git-guard` and record the current output verbatim (it must end `✔ PASS`), so the diff to the new output is auditable.

### 2. Extract the shared violation types

- Create `adws/guard/violationTypes.ts` with a module docblock explaining that these are the guard's cross-rule types.
- Move `ViolationRule` and `Violation` out of `adws/checkGitGhGuard.ts`, widening the union to `'git-gh-shellout' | 'cwd-derived-identity' | 'unsanctioned-construction'`.
- Import them back into `adws/checkGitGhGuard.ts` and re-export both types from it (`export type { Violation, ViolationRule }`) so nothing downstream has to change its import path.

### 3. Move the cwd-derived-identity rule into `adws/guard/identityRule.ts`

- Move the whole `── Rule: cwd-derived-identity ──` section — comments included, logic byte-for-byte — into the new module.
- Export a single entry point `flagCwdDerivedIdentityUses(sourceFile: ts.SourceFile): Violation[]` that internally calls `collectCwdDerivedIdentityNames` first, so `scanSource` shrinks to one call.
- Also export `CWD_DERIVED_IDENTITY_FNS` and `CONTEXT_CONSTRUCTOR_NAME` (needed by the rename-detection test).
- Update `adws/checkGitGhGuard.ts`'s module docblock: the two-rule narrative becomes three rules, and it must state where each rule now lives.
- No behaviour change in this step. `bun run lint:git-guard` must still print the identical output recorded in step 1, and the guard unit suite must still be green.

### 4. Define the construction rule's flagged-name sets

In `adws/guard/constructionRule.ts`:

- `PROVIDER_CONSTRUCTORS: ReadonlySet<string>` — `createGitHubIssueTracker`, `createGitHubCodeHost`, `createGitHubBoardManager`, `createGitLabCodeHost`, `createGitLabBoardManager`, `createJiraIssueTracker`, `createJiraBoardManager`.
- `CONTEXT_CONSTRUCTORS: ReadonlySet<string>` — `createRepoContext`, `mintBoundProviders`, `gitContextFor`, `gitContextForSync`, `gitContextForRepo`.
- `GIT_CONTEXT_CLASS_NAME = 'GitContext'` — matched only as a `ts.NewExpression` callee.
- Document, in the module docblock, that this is an **explicit name set and never a `create*` pattern**, and name the near-misses it must not catch (`createGhCommandRunner`, `createGitHubTokenProvider`, `createIssueCmd`, `createPRCmd`, `createLabelCmd`).

### 5. Define the sanctioned-site allowlist

Still in `adws/guard/constructionRule.ts`, as one frozen `as const` array of `{ file, reason, owner? }`:

- **Permanent (2)** — no `owner`, because nothing will ever remove them:
  - `adws/core/launchGitContext.ts` — "the launch boundary: the one sanctioned construction site (PRD story 6)"
  - `adws/providers/repoContext.ts` — "the mint implementation the boundary delegates to"
- **Transitional (38)** — each carrying `owner: '#796'` or `owner: '#797'`, grouped under a comment that says these entries are deleted by the migration slices and that **nothing may ever be added to this list**:
  `adws/adwUpgrade.tsx`, `adws/checkLivingDocsIndex.ts`, `adws/core/orchestratorLib.ts`, `adws/core/remoteReconcile.ts`, `adws/core/targetRepoManager.ts`, `adws/core/upgradeClaim.ts`, `adws/github/gitContextFactory.ts`, `adws/github/githubApi.ts`, `adws/github/hitlBoardNotifier.ts`, `adws/github/issueApi.ts`, `adws/github/linkedPrDetector.ts`, `adws/github/prApi.ts`, `adws/github/prCommentDetector.ts`, `adws/github/projectBoardApi.ts`, `adws/healthCheck.tsx`, `adws/phases/branchIdentityFallback.ts`, `adws/phases/buildPhase.ts`, `adws/phases/docsSelfCheck.ts`, `adws/phases/documentPhase.ts`, `adws/phases/prPhase.ts`, `adws/phases/prReviewPhase.ts`, `adws/phases/reviewPhase.ts`, `adws/phases/scenarioFixPhase.ts`, `adws/phases/upgradeGate.ts`, `adws/phases/workflowInit.ts`, `adws/triggers/autoMergeHandler.ts`, `adws/triggers/cancelHandler.ts`, `adws/triggers/concurrencyGuard.ts`, `adws/triggers/devServerJanitor.ts`, `adws/triggers/issueClosedUnblockRouter.ts`, `adws/triggers/pauseQueueScanner.ts`, `adws/triggers/takeoverHandler.ts`, `adws/triggers/trigger_cron.ts`, `adws/triggers/trigger_webhook.ts`, `adws/triggers/webhookGatekeeper.ts`, `adws/triggers/webhookHandlers.ts`, `adws/vcs/branchOperations.ts`, `adws/vcs/worktreeOperations.ts`.
  (That list is 38 paths; `adws/phases/prReviewPhase.ts` and `adws/phases/upgradeGate.ts` cover both a `createRepoContext` call *and* a `gitContextFor*` call. **Do not hand-trust this list** — regenerate it in step 8 from the guard's own first run and reconcile any difference, then keep exactly the paths the rule actually reports.)
- `isSanctionedConstructionSite(relPath: string): boolean` — exact path match only, no prefix matching. A whole directory must never become sanctioned.

### 6. Implement `flagUnsanctionedConstruction`

- Signature `flagUnsanctionedConstruction(sourceFile: ts.SourceFile, relPath: string): Violation[]`.
- **Guard clause first:** `if (isSanctionedConstructionSite(relPath)) return []` — keeps the happy path at the leftmost indent and makes the allowlist a single, greppable decision.
- Walk the AST. Flag when:
  - `ts.isNewExpression(node)` and the callee is the bare identifier `GitContext`; or
  - `ts.isCallExpression(node)` and the callee is a **bare identifier** (never a `PropertyAccessExpression`) whose text is in `PROVIDER_CONSTRUCTORS` or `CONTEXT_CONSTRUCTORS`.
- Emit `{ file: sourceFile.fileName, line, command: '<name>(…)' | 'new GitContext(…)', rule: 'unsanctioned-construction' }`. Extract the per-node decision into a named helper so the walk body stays under two levels of nesting.
- Record, in a module-level pure function `constructionSiteFilesIn(sourceFile, relPath)` or by returning the set alongside — simplest is: `main()` collects `relPath`s for which `flagUnsanctionedConstruction` *would* have flagged had the file not been sanctioned. Implement this as an exported pure predicate `hasGuardedConstruction(sourceFile: ts.SourceFile): boolean` used only by `main()`, so `scanFiles` keeps its exact `(relPaths, repoRoot)` signature — `adws/__tests__/checkGitGhGuard.test.ts` asserts `scanFiles.length === 2`.
- Export `findStaleSanctionedEntries(seenFiles: ReadonlySet<string>): readonly string[]` — every transitional entry not in `seenFiles`. Pure, no I/O, so it is unit-testable.

### 7. Wire the rule into the entry point

- In `scanSource`, add `violations.push(...flagUnsanctionedConstruction(sourceFile, filePath))` after the identity rule. `filePath` is already the repo-relative path `scanFiles` passes as `ts.createSourceFile`'s filename, so no signature change is needed.
- In `main()`:
  - After the existing `Exempt packages (2):` block, print a new block. **It must not contain the substring `allowlisted`.** Suggested shape:
    ```
      Sanctioned construction sites — 2 permanent, 38 transitional (#796/#797):
        adws/core/launchGitContext.ts — the launch boundary
        adws/providers/repoContext.ts — the mint implementation
        …38 transitional entries pending migration
    ```
    Print the transitional entries as a count plus a `--verbose`-free one-line-per-entry list only if it stays readable; a count plus the two permanent entries is sufficient and keeps CI output legible.
  - Collect the set of scanned files for which `hasGuardedConstruction` is true, call `findStaleSanctionedEntries`, and **fail (exit 1)** when it is non-empty, with the message `Remove the stale transitional entry — <file> no longer constructs a provider or context (#796/#797).` This is what makes the allowlist self-cleaning.
  - Add the third remedy line: `Remedy (unsanctioned-construction): receive providers from buildLaunchBoundary(...) instead of constructing them; the boundary is the only sanctioned construction site.`
  - Leave the `scanned ${scannedCount} files (0 allowlisted)` line **byte-identical**.

### 8. Reconcile the allowlist against reality

- Temporarily comment out the allowlist and run `bunx tsx adws/checkGitGhGuard.ts`, capturing every `unsanctioned-construction` violation.
- The reported file set is the authoritative transitional list. Reinstate the allowlist with exactly those paths (minus the two permanent ones), fix any drift from step 5, and confirm `adws/checkGitGhGuard.ts` itself is **not** in it (its `gitContextForRepo(…)` mentions are in comments, which the AST never sees).
- Re-run `bun run lint:git-guard`: it must exit 0 with zero violations and zero stale entries.

### 9. Extend the unit suite — both directions

In `adws/__tests__/checkGitGhGuard.test.ts`, add a `describe('scanFiles — unsanctioned-construction rule (#795)')` block. All fixtures go through the existing `mockReadFileSync` pattern.

**Must flag (the deliberate-violation fixtures):**
- `const t = createGitHubIssueTracker({ owner: 'acme', repo: 'typo', platform: Platform.GitHub });` in `adws/phases/someNewPhase.ts` → exactly one violation, `rule === 'unsanctioned-construction'`.
- `createRepoContext({ repoId, cwd })` in a new, non-allowlisted file → one violation.
- `mintBoundProviders({ repoId, codeHostPlatform, issueTrackerPlatform })` in a new file → one violation.
- `new GitContext({ owner, repo, selfHost: false })` in a new file → one violation, `command` naming `new GitContext`.
- `gitContextForRepo(repoInfoParam)` in a new file → one violation (and note in a comment that this same source is *zero* violations under `cwd-derived-identity`, proving the two rules are independent).
- A file with two constructions → two violations, one per line.

**Must not flag:**
- The same `createGitHubIssueTracker` source at `adws/core/launchGitContext.ts` → zero violations (permanent entry).
- The same source at `adws/providers/repoContext.ts` → zero violations (permanent entry).
- The same source at `adws/phases/prReviewPhase.ts` → zero violations (transitional entry).
- `createGhCommandRunner(ctx)`, `createGitHubTokenProvider({…})`, `createIssueCmd(o, r, t)` in a new file → zero violations (the name set is explicit, not `create*`).
- `deps.gitContextForRepo(repoInfo)` and `d.gitContextForRepo(repoInfo)` in a new file → zero violations (injected seams).
- `export function createGitHubCodeHost(repoId) { … }` (a declaration, not a call) in a new file → zero violations.
- A source with a `git status` shell-out in a *sanctioned* file → still exactly one `git-gh-shellout` violation, proving the construction allowlist does not leak into the other two rules.

**`isSanctionedConstructionSite` block:**
- true for both permanent paths and a sampled transitional path; false for `adws/phases/reviewPhaseNew.ts`; false for `adws/core/` (a directory prefix is never sanctioned — assert `isSanctionedConstructionSite('adws/core/somethingElse.ts') === false`).
- every transitional entry carries a non-empty `owner` naming an issue; both permanent entries carry none.

**`findStaleSanctionedEntries` block:**
- with an empty seen-set, returns all transitional entries and no permanent ones;
- with every transitional path seen, returns `[]`.

### 10. Add the rename-detection block (AC3)

- New `describe('guarded factory names still exist (#795 / AC3)')`.
- Because the suite mocks `fs` at module scope, obtain the real module inside the test: `const realFs = await vi.importActual<typeof import('fs')>('fs')`. Do **not** import the factory modules directly — they pull in `core/environment` and would run env/dotenv side effects under a mocked `fs`.
- For each guarded name, assert its owning source contains the declaration:
  - `gitContextFor`, `gitContextForSync`, `gitContextForRepo` → `adws/github/gitContextFactory.ts`
  - `getRepoInfo` → `adws/github/githubApi.ts`; `readLocalRepoInfo` → its `adws/gitContext/` module
  - `createRepoContext`, `mintBoundProviders` → `adws/providers/repoContext.ts`
  - `createGitHubIssueTracker`/`createGitHubCodeHost`/`createGitHubBoardManager`, `createGitLabCodeHost`/`createGitLabBoardManager`, `createJiraIssueTracker`/`createJiraBoardManager` → their respective modules
  - `GitContext` → `adws/gitContext/gitContext.ts` (`export class GitContext`)
- Match on `export (async )?function <name>(` / `export class <name>` so a rename fails loudly with the old name in the message. Table-drive it (`it.each`) rather than writing fifteen near-identical tests.

### 11. Update the living documentation

- `app_docs/feature-bq1f45-git-gh-cli-guard.md` — third rule (name, what it flags, what it deliberately does not), the permanent/transitional allowlist split and the stale-entry ratchet, the new `adws/guard/` module layout, the re-export contract for `scanFiles`/`collectTsFiles`/`EXEMPT_PACKAGES`/`isExemptPackage`, and the "must not print the word *allowlisted*" constraint on the new stdout block.
- `.adw/conditional_docs.md` — in the `feature-bq1f45-git-gh-cli-guard.md` block: add `adws/guard/violationTypes.ts`, `adws/guard/identityRule.ts`, `adws/guard/constructionRule.ts` under **Owns**, and add conditions for the third rule, the two-tier allowlist, and the stale-entry failure.
- `README.md:18` — rewrite to name all three rules and the two-entry `EXEMPT_PACKAGES` (the current text is stale at `adws/gitContext` being "the sole structurally-exempted package").
- `README.md:919` and the `adws/__tests__/` tree listing around `README.md:465` — reflect the new files.
- Run `bunx tsx adws/checkLivingDocsIndex.ts` if it is the repo's living-docs consistency check, and fix anything it reports.

### 12. Run the Validation Commands

Execute every command in the next section, in order, and confirm each is green.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun install` — ensure dependencies are present.
- `bunx tsc --noEmit` — root type check, zero errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — auxiliary type check covering `adws/guard/`, zero errors.
- `bun run lint` — ESLint, zero errors and zero warnings.
- `bun run lint:git-guard` — exits 0; output shows the unchanged `(0 allowlisted)` line, the two exempt packages, the new sanctioned-construction block, and no stale transitional entries.
- `bun run test:unit` — full vitest run, zero failures (guards against collateral damage from the module split).
- `bunx vitest run adws/__tests__/checkGitGhGuard.test.ts` — the guard suite specifically; confirm the new `unsanctioned-construction` and rename-detection blocks are present and green.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-700"` — the `(\d+) allowlisted` capstone still parses `0`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-769"` — whole-repo guard run still passes; `cwd-derived-identity` fixtures still behave.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-792"` — `EXEMPT_PACKAGES` / `scanFiles` / `collectTsFiles` import surface survives the split.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-691"` — the other whole-repo `checkGitGhGuard.ts` invocation.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-794"` — the launch boundary this rule allowlists is unaffected.

### Negative proof (run manually, then revert — do not commit)

The guard must be shown to *fail*, not just pass:

1. Append `const t = createGitHubIssueTracker({ owner: 'acme', repo: 'typo', platform: 0 });` to a non-allowlisted file such as `adws/phases/planPhase.ts` (confirm first that it is NOT in the transitional list — `adws/phases/reviewPhase.ts` IS, so it would silently pass).
2. `bun run lint:git-guard` → exits 1, reporting `[unsanctioned-construction]` at that file and line.
3. `git checkout -- adws/phases/planPhase.ts` and confirm the guard is green again.
4. Repeat with a stale entry: delete every construction from one transitional file (or temporarily add a fake path to the transitional list) → guard exits 1 with the stale-entry message; revert.

## Notes

- **Strictly follow `.adw/coding_guidelines.md`.** The three constraints that bite here: files under 300 lines (the reason for the `adws/guard/` split — verify with `wc -l adws/checkGitGhGuard.ts adws/guard/*.ts`), guard clauses over nesting (the `isSanctionedConstructionSite` early return, and extracting the AST walk's per-node decision into a named function), and `Readonly`/`as const` for the frozen name sets and allowlist.
- **Do not touch the `(0 allowlisted)` line.** `features/per-issue/step_definitions/feature-700.steps.ts:233` parses the first `(\d+)\s+allowlisted` match in the whole stdout. Any new line containing that word — even later in the output — is a landmine for the next person who reorders the print block. Use "sanctioned construction sites".
- **The re-export contract is load-bearing.** `scanFiles` is imported from `adws/checkGitGhGuard.ts` by `feature-691.steps.ts:19`, `feature-769.steps.ts:48` and `feature-792.steps.ts:51`; `collectTsFiles` by `feature-792.steps.ts:51`; `EXEMPT_PACKAGES`/`isExemptPackage` by the unit suite. `scanFiles.length` must stay `2` — an existing test asserts the arity.
- **`adws/providers/github/**` is invisible to every rule.** `visitDir` prunes it via `isExemptPackage` before any file is handed to `scanFiles`, so the adapter package needs no allowlist entry even though it defines the provider factories. Same for `adws/gitContext/**`, `features/`, `test/`, and `__tests__/`/`*.test.ts` files. Say this explicitly in the module docblock — otherwise the next reader will "fix" a non-bug.
- **Property-access callees are deliberately unflagged.** `labelManager.ts:159` (`deps.gitContextForRepo`) and `depauditSetup.ts:76` (`d.gitContextForRepo`) are injected seams — exactly the pattern the PRD wants — and are correctly absent from the transitional list. Do not "tighten" the rule to catch them.
- **No BDD scenario is required for this chore.** The guard's proof surface is its unit suite plus the four merged whole-repo scenarios listed in Validation Commands (`@adw-691`, `@adw-700`, `@adw-769`, `@adw-792`), which already assert both the exit code and the stdout observables. `.adw/review_proof.md` step 5 (`@adw-795`) is explicitly optional when no such tag exists.
- **The transitional list is a debt counter, not a hiding place.** Its 38 entries are the migration surface `#796`/`#797` inherit; the stale-entry ratchet in `main()` is what forces each entry to be deleted the moment its file stops constructing. If a reviewer reads the list as "the rule is vacuous", the answer is in step 7's ratchet and in the fact that no new file can be added to it.
- **`#794` merged as `7eed8e2e`**; this chore's worktree is branched from it. Before starting, diff `git diff origin/dev --stat` and discard any out-of-scope reversion of merged command files or docs (a recurring worktree-birth failure in this repo) — restore with `git checkout origin/dev -- <files>` if the revert is working-tree-only.
