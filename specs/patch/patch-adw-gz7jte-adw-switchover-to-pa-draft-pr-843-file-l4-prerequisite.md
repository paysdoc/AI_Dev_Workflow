# Patch: Take PR #843 out of the merge path and file the L4 library prerequisite

## Metadata
adwId: `gz7jte-adw-switchover-to-pa`
reviewChangeRequest: `Issue #1: The migration was not performed. The branch's only commit beyond origin/dev is the plan spec (7188098b). Verified state: adws/gitContext/ and adws/providers/ are present; 221 relative imports in 127 files still resolve into them; package.json has no @paysdoc/devplatform and node_modules/@paysdoc does not exist; 'bun run lint:git-guard' prints 'Exempt packages (2)', 'Sanctioned construction sites: 2 permanent' and a 10-entry extraction-readiness scope; adws/guard/extractionRule.ts and its two tests still exist and 'extraction-readiness' is still in ViolationRule; features/regression/upgrade/feature-729.feature lines 24, 36 and 81 still cite adws/gitContext; .adw/conditional_docs.md has 14 extracted-path references and app_docs/feature-9gjajh-providers.md still exists. Root cause is the spec's Step 1 hard gate: the only published version is 1.0.0 and its barrels lack createLiteralTokenProvider, createGhRepoApi, readLocalRepoInfo, resolveBootstrapGitIdentity, isGitHubAppConfigured, getInstallationToken, resolveContextToken, ghAuthToken, parseGitHubIssue, selectPreferredPR, convertToSshUrl, GitLabApiClient, commitOps, isLeaseRejection and branchOps. The build agent stopped correctly and reported this, but PR #843 (one file, the spec, with 'Closes #840' in the body) was opened anyway, which spec Step 13 forbids; merging it would close #840 with none of the work done. Resolution: Not patchable in-repo: spec Step 1 forbids re-implementing the missing helpers in ADW because that recreates the git/gh shell-out sites the empty exempt set must forbid. Operator actions: (1) convert PR #843 to draft or close it so it cannot merge and auto-close #840; (2) land the L4 widening on paysdoc/devplatform (providers barrel: githubTokenProvider, ghRepoApi, githubIdentity, appAuth, tokenResolver, ghAuthToken, ghIssueParsers, ghPrParsers, cloneUrl, GitLabApiClient; git barrel: commitOps, isLeaseRejection, branchOps) and publish a new version; (3) re-run the build from spec Step 2 pinning that exact version, then re-review against all four acceptance criteria and the spec's validation commands.`

## Issue Summary
**Original Spec:** specs/issue-840-adw-20l8es-adw-switchover-to-pa-sdlc_planner-devplatform-switchover.md
**Issue:** The switchover was never built because spec Step 1's hard gate is closed: npm has only `@paysdoc/devplatform@1.0.0` and its barrels omit the helpers ADW's launch boundary imports. The build agent stopped correctly, but PR #843 (spec file only, body says `Closes paysdoc/AI_Dev_Workflow#840`) was opened anyway, which spec Step 13 forbids. Left as-is, a human merge of #843 would close #840 with none of the work done.
**Solution:** No code migration can happen in this repo until the library publishes a wider surface (spec Step 1 bans ADW-side re-implementation). This patch does the three things that *can* be done now: (1) convert PR #843 to a draft and strip its auto-close keywords, recording the gate in its body; (2) file the L4 prerequisite issue on `paysdoc/devplatform` with the scope re-derived against current `origin/dev` (issue #844 landed after this branch was cut and removed most of the spec's listed consumers); (3) leave the tree untouched and state the exact re-run gate for spec Step 2.

### Verified state at patch time (2026-09-11)
- npm: `@paysdoc/devplatform` versions = `1.0.0` only (`latest` → 1.0.0). The spec's Step 1 surface check against the packed 1.0.0 tarball reports **all 15** review-listed symbols missing, plus `createLiteralTokenProvider` missing from `./git`. Root cause stands.
- Library `main` is at tag **v1.1.0** (9 commits from issue paysdoc/devplatform#9 / PR #10): moves `createLiteralTokenProvider` into `./git`, adds `createForgeCredentials`, re-exports type `GitHubAppConfig`. **v1.1.0 is tagged but not on npm**: release run `34503029087` failed at `npm publish` with `403 Forbidden — OIDC permission denied for this action`. Until the npm trusted-publisher grant for the `release.yml` workflow is fixed, no new version can ship at all. semantic-release will compute the next version from v1.1.0, so an L4 `feat:` lands as 1.2.0 (1.1.0 never reaches npm); pin whatever `npm view` actually reports.
- ADW `origin/dev` is 12 commits ahead of this branch (issue #844 / PR #845, "Route ADW callers through the forge ports before the devplatform switchover"). After #844 the only deep imports left into the two extracted packages, outside those packages, are:
  - `adws/core/launchGitContext.ts` → `createGitHubTokenProvider`, `resolveBootstrapGitIdentity`, `resolveContextToken`, `ghAuthToken`
  - `adws/core/githubAppAuth.ts` → `isGitHubAppConfigured`, `getInstallationToken`, type `GitHubAppConfig`
  - tests / step definitions → `createLiteralTokenProvider` (12 files), `createGhRepoApi` (`feature-797.steps.ts`), `commitOps` (`feature-729.steps.ts`, `feature-844.steps.ts`), `branchOps` (`feature-844.steps.ts`)
  - `readLocalRepoInfo`, `parseGitHubIssue`, `selectPreferredPR`, `convertToSshUrl`, `GitLabApiClient`, `isLeaseRejection` have **no** remaining ADW consumer (`readLocalRepoInfo` is now ADW-local `adws/core/localRepoIdentity.ts`, composed from `readOriginRemoteUrl` + `parseOwnerRepoFromUrl`, both already in 1.0.0). The L4 scope below is trimmed accordingly.
- PR #843: OPEN, not draft, base `dev`, 0 reviews, `mergeStateStatus=CLEAN`, GitHub auto-merge off. ADW's own auto-merge already defers because issue #840 carries `hitl` (`autoMergePhase.ts` gates on the issue label), so the residual risk is a human clicking merge.
- The working tree has an uncommitted `README.md` hunk that is **not** part of this task: `origin/dev` already contains that content (commit 2fa0ef83, #844 docs). It disappears on the rebase in the re-run.

## Files to Modify
Use these files to implement the patch:

- **None in this repository.** The spec is a write-once artifact (`app_docs/feature-9gjajh-specs-and-prd.md` contract) and every in-repo change the spec describes is gated behind Step 1. Do not commit anything; do not touch or revert the pre-existing `README.md` working-tree hunk.
- GitHub state changed by this patch:
  - `paysdoc/AI_Dev_Workflow` PR #843 — draft flag and body.
  - `paysdoc/devplatform` — one new issue (the L4 prerequisite).
- Scratch files written under `/tmp/` only (`/tmp/adw-gz7jte-pr843-body.md`, `/tmp/adw-gz7jte-l4-issue.md`).

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Convert PR #843 to a draft and remove its auto-close keywords
- Convert to draft: `gh pr ready --undo 843 -R paysdoc/AI_Dev_Workflow`.
- Fetch the current body (`gh pr view 843 -R paysdoc/AI_Dev_Workflow --json body --jq .body`) and write `/tmp/adw-gz7jte-pr843-body.md` as: the blocker preamble below, then the existing body with the two lines `Closes paysdoc/AI_Dev_Workflow#840` and `Implements #840` replaced by the single line `Tracks #840 (not a closing reference — the migration has not been performed).` Keep the Summary, Plan link, checklist and Key changes as they are.
- Preamble (verbatim, at the top of the body):

  ```
  > **BLOCKED at spec Step 1 — do not merge.** This PR carries only the plan spec; the migration has not been performed and the review (adw `gz7jte-adw-switchover-to-pa`) rejected it for that reason.
  >
  > Gate: the only published `@paysdoc/devplatform` is 1.0.0 and its barrels lack the symbols ADW imports (`createGitHubTokenProvider`, `resolveBootstrapGitIdentity`, `resolveContextToken`, `ghAuthToken`, `isGitHubAppConfigured`, `getInstallationToken`, `createLiteralTokenProvider`, `createGhRepoApi`, `commitOps`, `branchOps`). Library tag v1.1.0 exists but its npm publish failed (release run 34503029087, `403 OIDC permission denied`).
  >
  > Prerequisite: paysdoc/devplatform#<L4-number> merged **and published**. Then rebase this branch onto `dev` (#844 landed after it was cut), re-run the build from spec Step 2 pinning the exact published version, and re-review against all four acceptance criteria and the spec's Validation Commands.
  ```
  Fill in `<L4-number>` after Step 2 (edit the body a second time, or run Step 2 first and apply the body once — either order is fine as long as the final body carries the real number).
- Apply: `gh pr edit 843 -R paysdoc/AI_Dev_Workflow --body-file /tmp/adw-gz7jte-pr843-body.md`.
- Do **not** close the PR: the re-run reuses this branch and adwId, and ADW's PR phase resolves the existing PR by branch name. Closing is the fallback only if the operator wants a fresh PR.

### Step 2: File the L4 prerequisite on paysdoc/devplatform (spec Step 1 authorizes "file, or ask the operator to file")
- Write `/tmp/adw-gz7jte-l4-issue.md` with this body (a bare re-export widening — every module already exists under `src/`):

  ```
  **Consumer:** paysdoc/AI_Dev_Workflow#840 (ADW switchover to `@paysdoc/devplatform`), blocked at its spec's Step 1 gate. The published 1.0.0 `exports` map is closed (`.`, `./providers`, `./git`, `./package.json`), so ADW can only reach what the three barrels re-export.

  **`src/providers/github/index.ts` — add re-exports**

  | Symbol | Module | ADW consumer (current `dev`, post-#844) |
  |---|---|---|
  | `createGitHubTokenProvider` | `githubTokenProvider` | `adws/core/launchGitContext.ts` |
  | `resolveBootstrapGitIdentity` | `githubIdentity` | `adws/core/launchGitContext.ts` |
  | `resolveContextToken` | `tokenResolver` | `adws/core/launchGitContext.ts` |
  | `ghAuthToken` | `ghAuthToken` | `adws/core/launchGitContext.ts` |
  | `isGitHubAppConfigured`, `getInstallationToken` | `appAuth` | `adws/core/githubAppAuth.ts` (type `GitHubAppConfig` is already re-exported via `forgeCredentials`) |
  | `createGhRepoApi`, type `GhRepoApi` | `ghRepoApi` | `features/per-issue/step_definitions/feature-797.steps.ts` |

  **`src/git/index.ts` — add re-exports**

  | Symbol | Module | ADW consumer |
  |---|---|---|
  | `commitOps` | `commitOps` | `features/regression/step_definitions/feature-729.steps.ts`, `feature-844.steps.ts` |
  | `branchOps` | `branchOps` | `feature-844.steps.ts` |
  | `isLeaseRejection` | `commitOps` | none today; export alongside `commitOps` for the lease-rejection scenarios |

  **Already on `main` but unreleased (v1.1.0):** `createLiteralTokenProvider` in `./git`, `createForgeCredentials`, type `GitHubAppConfig`. ADW needs these published too. If maintainers prefer, `createForgeCredentials` may be the documented route for the four `launchGitContext.ts` helpers; ADW's plan currently assumes the direct re-exports (PRD story 29: no behaviour change at the switchover).

  **No longer needed** (dropped from the ADW plan since paysdoc/AI_Dev_Workflow#844): `readLocalRepoInfo`, `parseGitHubIssue`, `selectPreferredPR`, `convertToSshUrl`, `GitLabApiClient`.

  **Acceptance criteria**
  - [ ] Every symbol above resolves from `@paysdoc/devplatform/providers` / `@paysdoc/devplatform/git` in the packed tarball (`npm pack` + dynamic-import key check), with `.d.ts` types
  - [ ] The import-graph test still proves `./git` pulls no `src/providers/` module (`commitOps`/`branchOps` are git-core)
  - [ ] Landed as a `feat:` commit so semantic-release cuts a new minor from v1.1.0
  - [ ] A version containing this change is on npm. Blocker to clear first: the v1.1.0 release run (34503029087) failed at `npm publish` with `403 OIDC permission denied`; the npm trusted-publisher configuration for `@paysdoc/devplatform` must grant the `release.yml` workflow. v1.1.0 is tagged but not published.
  ```
- Create it: `gh issue create -R paysdoc/devplatform --title "Widen the public surface for the ADW switchover (L4)" --body-file /tmp/adw-gz7jte-l4-issue.md`. Capture the issue number and URL from the output.
- Side effect to be aware of: an unlabelled open issue is eligible for the library repo's ADW cron sweep (`cronLabelEligibility.ts`), so filing it starts the library-side classify → plan → build pipeline. That is the intended way for the widening to land; the npm publish grant remains an operator action on npmjs.com that no pipeline can perform.
- Put the real issue number into the PR #843 preamble (Step 1) if it was not known yet.

### Step 3: Verify and leave the working tree exactly as found
- Confirm `git status --short` shows only the pre-existing ` M README.md` and `git log --oneline origin/dev..HEAD` still shows only `7188098b`. Nothing from this patch is committed or pushed.
- Re-run the spec's Step 1 surface check once more (command in Validation) and record its output in the patch report: today it must still report the gate closed. The re-run of spec Step 2 onward is triggered only when that check comes back with every symbol present on a version listed by `npm view @paysdoc/devplatform versions`.
- Report to the operator, in the patch summary: (a) PR #843 is draft with no closing keyword; (b) the L4 issue number; (c) the npm OIDC publish blocker on the library; (d) the re-run must start by rebasing onto `origin/dev` because #844 changed the consumer inventory the spec's Step 4 table was built from (the spec's greps re-derive it from the tree, so the steps stay valid).

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `gh pr view 843 -R paysdoc/AI_Dev_Workflow --json isDraft,body --jq '"isDraft=\(.isDraft)", (.body | test("(?i)^(closes|fixes|resolves|implements) ") | not | "no closing keyword at line start=\(.)")'` — expect `isDraft=true` and `no closing keyword at line start=true`; additionally `gh pr view 843 -R paysdoc/AI_Dev_Workflow --json body --jq .body | grep -ciE '(closes|fixes|resolves|implements) (paysdoc/AI_Dev_Workflow)?#840'` must print `0`.
- `gh issue view <L4-number> -R paysdoc/devplatform --json state,title,body --jq '"\(.state) \(.title)", (.body | contains("AI_Dev_Workflow#840"))'` — expect `OPEN Widen the public surface for the ADW switchover (L4)` and `true`.
- `git status --short && git log --oneline origin/dev..HEAD` — expect exactly ` M README.md` and the single commit `7188098b`; no new commits, no new tracked changes.
- Baseline no-regression on the untouched branch (no code changed, so these must stay as they were): `bunx tsc --noEmit` and `bun run test:unit` green.
- Gate check for the re-run (documenting, not passing — today it must still print MISSING lines; the migration re-run starts only when it prints none):
  `D=$(mktemp -d) && cd "$D" && npm pack @paysdoc/devplatform@latest --silent >/dev/null && tar xzf paysdoc-devplatform-*.tgz && node -e "(async()=>{const p=await import('$D/package/dist/providers/index.js');const g=await import('$D/package/dist/git/index.js');for(const s of ['createGitHubTokenProvider','resolveBootstrapGitIdentity','resolveContextToken','ghAuthToken','isGitHubAppConfigured','getInstallationToken','createGhRepoApi'])console.log((s in p?'present':'MISSING')+' providers:'+s);for(const s of ['createLiteralTokenProvider','commitOps','branchOps'])console.log((s in g?'present':'MISSING')+' git:'+s)})()"`
- The spec's own Validation Commands (lint, both typechecks, unit, `lint:git-guard`, `lint:docs-index`, `@regression`, the two greps, the directory check) are the exit criteria of the **re-run**, not of this patch; they cannot pass until the migration is built.

## Patch Scope
**Lines of code to change:** 0 in-repo (≈15 lines of PR body preamble, ≈45 lines of issue body, both outside the repository)
**Risk level:** low — two reversible GitHub state changes (draft flag/body edit; a new issue), no commits, no code
**Testing required:** GitHub-state verification commands above, plus the unchanged baseline typecheck and unit suite on the untouched branch
