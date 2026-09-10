# Patch: Gate still closed — keep PR #843 draft, refresh its blocker preamble, change nothing in-repo

## Metadata
adwId: `gz7jte-adw-switchover-to-pa`
reviewChangeRequest: `Issue #1: The migration was not performed and the spec's acceptance criteria are all unmet. Verified on the branch (HEAD d5fd43a1, 2 commits past its base 4d25d21c, both docs-only): adws/gitContext/ and adws/providers/ directories exist; package.json has no @paysdoc/devplatform and node_modules/@paysdoc does not exist; adws/guard/constructionRule.ts SANCTIONED_CONSTRUCTION_SITES still lists adws/providers/forgeProviders.ts alongside the launch boundary; adws/guard/extractionRule.ts and its two tests exist and 'extraction-readiness' is still a ViolationRule member; features/regression/upgrade/feature-729.feature lines 24, 36 and 81 still cite adws/gitContext; .adw/conditional_docs.md has 14 extracted-path references and app_docs/feature-9gjajh-providers.md still exists; bun run lint:git-guard prints 'Exempt packages (2)'. Root cause is unchanged from the previous review: the spec's Step 1 gate is closed. npm view @paysdoc/devplatform versions returns only 1.0.0 (latest → 1.0.0); the library's v1.1.0 tag (devplatform issue 9, createForgeCredentials) is unpublished because release run 34503029087 failed at npm publish with 403 OIDC permission denied; the L4 surface-widening issue paysdoc/devplatform#11 (filed by the patch cycle) is OPEN, labelled adw:feature, with no PR. Spec Step 1 forbids re-implementing the missing helpers in ADW because that recreates the git/gh shell-out sites the empty exempt set must forbid, so this is not patchable in-repo — the patch cycle already did everything possible on the ADW side (PR #843 converted to draft, closing keywords removed, prerequisite recorded, devplatform#11 filed). Note also that issue #840's body was rewritten after this spec was authored: it now requires #844 merged (done — PR #845 merged to dev 2026-09-10T21:58Z; this branch was cut before it) and a published version whose /providers barrel exports createForgeCredentials and whose /git barrel exports createLiteralTokenProvider, and it changes the launch-boundary mapping (adws/core/launchGitContext.ts must obtain the token provider and bootstrap identity via createForgeCredentials, with a new rule that no production module imports a forge-named symbol from the library).
Resolution: Operator actions, outside this repository: (1) fix the npm trusted-publisher (OIDC) grant for paysdoc/devplatform's release.yml so a version above 1.0.0 can publish; (2) land and publish the widening from paysdoc/devplatform#11 (or at minimum a version whose /providers barrel exports createForgeCredentials and whose /git barrel exports createLiteralTokenProvider, per the updated #840 body) and confirm with npm view @paysdoc/devplatform versions plus the spec's Step 1 surface check; (3) rebase this branch onto origin/dev (#844 changed the consumer inventory the spec's Step 4 table was built from; the spec's greps re-derive it from the tree); (4) re-run the build from spec Step 2 pinning the exact published version, following the updated #840 body for the launch-boundary rewrite via createForgeCredentials; (5) re-review against all acceptance criteria and the spec's Validation Commands. Until step (2) is done, no in-repo patch can satisfy this blocker; keep PR #843 as a draft.`

## Issue Summary
**Original Spec:** specs/issue-840-adw-20l8es-adw-switchover-to-pa-sdlc_planner-devplatform-switchover.md
**Issue:** The switchover is still unbuilt because spec Step 1's hard gate is still closed: npm carries only `@paysdoc/devplatform@1.0.0`, whose barrels lack `createForgeCredentials` (`/providers`) and `createLiteralTokenProvider` (`/git`) — the two symbols the rewritten #840 body now names as the gate. The spec bans the only in-repo workaround (re-implementing the helpers in ADW), so none of the acceptance criteria can be met by a code change on this branch. The previous patch cycle already converted PR #843 to a draft, stripped its closing keywords and filed paysdoc/devplatform#11; the review re-confirmed the gate and asked that the PR stay a draft until the library publishes.
**Solution:** Make no in-repo change (0 files, 0 commits). Re-verify the gate in its updated form, then refresh PR #843's blocker preamble so it states the current prerequisites precisely — the updated #840 gate, the fact that library `main` (= tag v1.1.0) already contains both gate symbols so the npm OIDC grant is the single action that opens the gate, the narrower residual need for devplatform#11, and the verified conflict-free rebase onto `dev`. Leave the branch, tree and draft flag exactly as found and hand the operator sequence back in the report.

### Verified state at patch-plan time (2026-09-11)
- **npm:** `npm view @paysdoc/devplatform versions` → `["1.0.0"]`, `latest` → 1.0.0 (published 2026-09-10T13:28Z). The packed 1.0.0 tarball reports `MISSING providers:createForgeCredentials` and `MISSING git:createLiteralTokenProvider` (the updated #840 gate) and all ten devplatform#11 symbols missing. Gate closed.
- **Library:** `paysdoc/devplatform` `main` is exactly tag `v1.1.0` (`ba168795`). Its `src/providers/index.ts` already does `export * from './forgeCredentials.js'` (`createForgeCredentials`, `ForgeCredentialsOptions`, type `GitHubAppConfig`) and `src/git/index.ts` already exports `createLiteralTokenProvider`. So a **published** v1.1.0 (or any later version) satisfies the updated gate; no further library code is needed for the gate itself.
- **Why nothing publishes:** release run `34503029087` (merge of PR #10, v1.1.0) failed in `@semantic-release/npm` with `npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@paysdoc%2fdevplatform - OIDC permission denied for this action`. `release.yml` publishes via trusted publishing (`permissions.id-token: write`, `NPM_TOKEN` only as fallback). The npm-side trusted-publisher grant for that workflow is the operator fix; nothing in either repo can perform it.
- **devplatform#11 (L4):** OPEN, `adw:feature`, no PR, no branch on the remote. Its ADW pipeline (adwId `obxxxx-widen-the-public-sur`, `adwSdlc.tsx 11 …`) is **still running on this host in the plan phase** (`/feature` planner and `/scenario_writer` agents in flight since 2026-09-10T23:09Z) — in progress, not stalled; do not touch it. Under the updated #840 mapping its production-side scope shrinks (the four `launchGitContext.ts` helpers are superseded by `createForgeCredentials`), but it is still required for the BDD criterion: `feature-729.steps.ts` (regression) and `feature-844.steps.ts` need `commitOps`/`branchOps` from `/git`, and `feature-797.steps.ts` needs `createGhRepoApi` from `/providers`. Both the OIDC fix and #11 therefore remain prerequisites, exactly as the review states.
- **This branch:** clean tree; 2 commits past base `4d25d21c` (`7188098b` spec, `d5fd43a1` README + prior patch plan); 15 commits behind `origin/dev` (#844 / PR #845). `git merge-tree --write-tree origin/dev HEAD` exits 0 — the rebase in the re-run is conflict-free. Baseline on the untouched branch: `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` both exit 0; `bun run test:unit` → 180 files / 3193 tests, all green.
- **PR #843:** OPEN, `isDraft=true`, base `dev`, 0 reviews, no auto-merge, body carries the previous cycle's preamble and `Tracks #840 (not a closing reference …)`. Its checklist still says `@paysdoc/devplatform@1.0.0`, which the rewritten #840 body has superseded.

## Files to Modify
Use these files to implement the patch:

- **None in this repository.** The spec is a write-once artifact (`app_docs/feature-9gjajh-specs-and-prd.md` contract) and every in-repo change it describes is gated behind Step 1. Do not add, edit, delete, commit, rebase or push anything on this branch; do not add the dependency; do not touch the two extracted directories, the guard, the feature file or the docs.
- GitHub state changed by this patch: `paysdoc/AI_Dev_Workflow` PR #843 — **body only** (draft flag is already set and must stay set).
- Scratch file written under `/tmp/` only: `/tmp/adw-gz7jte-pr843-body-v2.md`.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Re-verify the gate in its updated (#840) form before touching anything
- Run `npm view @paysdoc/devplatform versions --json` and the tarball check:
  ```
  D=$(mktemp -d) && cd "$D" && npm pack @paysdoc/devplatform@latest --silent >/dev/null && tar xzf paysdoc-devplatform-*.tgz && node -e "(async()=>{const p=await import('$D/package/dist/providers/index.js');const g=await import('$D/package/dist/git/index.js');console.log((('createForgeCredentials' in p)?'present':'MISSING')+' providers:createForgeCredentials');console.log((('createLiteralTokenProvider' in g)?'present':'MISSING')+' git:createLiteralTokenProvider');for(const s of ['createGhRepoApi'])console.log((s in p?'present':'MISSING')+' providers:'+s);for(const s of ['commitOps','branchOps'])console.log((s in g?'present':'MISSING')+' git:'+s)})()"
  ```
- Expected today: versions `["1.0.0"]` and every line `MISSING`. Record the output for the patch report and continue to Step 2.
- **If instead every line prints `present`** (the gate opened between review and patch): STOP this patch without editing the PR. Report that the migration re-run is now due and must start with the rebase onto `origin/dev` and spec Step 2 pinning that exact version. Do not attempt the ~140-file migration inside this patch cycle — it needs the rebase first and is a `hitl` change the operator gates.

### Step 2: Refresh PR #843's blocker preamble (keep it a draft; keep it non-closing)
- Confirm the draft flag: `gh pr view 843 -R paysdoc/AI_Dev_Workflow --json isDraft --jq .isDraft` must print `true`. Only if it prints `false`, run `gh pr ready --undo 843 -R paysdoc/AI_Dev_Workflow`.
- Fetch the current body: `gh pr view 843 -R paysdoc/AI_Dev_Workflow --json body --jq .body > /tmp/adw-gz7jte-pr843-body-current.md`.
- Build `/tmp/adw-gz7jte-pr843-body-v2.md` as: the preamble below, a blank line, then everything in the current body **from the `## Summary` heading onward** (this drops the previous cycle's blockquote preamble, which the new one supersedes). In the retained part make exactly one edit — replace the first checklist line:
  ```
  - [ ] `@paysdoc/devplatform@1.0.0` added as a dependency
  ```
  with:
  ```
  - [ ] `@paysdoc/devplatform` added as an exact-pinned dependency at the first published version above 1.0.0 that passes the Step 1 gate
  ```
  Keep `Tracks #840 (not a closing reference — the migration has not been performed).` verbatim; do not introduce any `Closes`/`Fixes`/`Resolves`/`Implements` line.
- Preamble (verbatim):

  ```
  > **BLOCKED at spec Step 1 — do not merge.** This PR carries only the plan spec; the migration has not been performed. Two reviews (adw `gz7jte-adw-switchover-to-pa`, 2026-09-10 22:52Z and 23:11Z) rejected it for that reason; the second re-confirmed the gate is still closed.
  >
  > **Gate (issue #840, updated body):** `npm view @paysdoc/devplatform versions` must list a version above 1.0.0 whose `/providers` barrel exports `createForgeCredentials` and whose `/git` barrel exports `createLiteralTokenProvider`. As of 2026-09-11 npm has only 1.0.0 and both symbols are missing from its tarball.
  >
  > **Root cause:** library `main` is exactly tag v1.1.0 (`ba168795`) and already carries both symbols, but v1.1.0 never reached npm — release run 34503029087 failed at `npm publish` with `403 Forbidden … OIDC permission denied for this action`. Fixing the npm trusted-publisher grant for `release.yml` (then re-releasing) is the single action that opens the gate.
  >
  > **Also required for the BDD criterion:** paysdoc/devplatform#11 (barrel widening) — the step definitions need `commitOps`/`branchOps` from `/git` (feature-729, feature-844) and `createGhRepoApi` from `/providers` (feature-797); the four `launchGitContext.ts` helpers it lists are superseded by `createForgeCredentials`. #11 is OPEN with no PR; its ADW pipeline is in the plan phase.
  >
  > **Re-run sequence once a qualifying version is on npm:** rebase this branch onto `dev` (#844 landed after it was cut; verified conflict-free with `git merge-tree`), re-run the build from spec Step 2 pinning the exact published version and following the updated #840 launch-boundary mapping (`createForgeCredentials`; no production module imports a forge-named symbol), then re-review against all acceptance criteria and the spec's Validation Commands.
  ```
- Apply: `gh pr edit 843 -R paysdoc/AI_Dev_Workflow --body-file /tmp/adw-gz7jte-pr843-body-v2.md`.
- Do **not** close the PR (the re-run reuses this branch and adwId; ADW resolves the existing PR by branch name). Do not comment on paysdoc/devplatform#11 — its planner captured the issue at launch and is still running; the scope note above lives in the PR body and the patch report for the operator.

### Step 3: Leave the branch exactly as found and hand back the operator sequence
- Verify nothing in-repo moved: `git status --short` prints nothing; `git log --oneline 4d25d21c..HEAD` prints exactly `d5fd43a1` and `7188098b`; `git diff --stat` is empty. No commit, no rebase, no push from this patch.
- In the patch report, restate for the operator, in order: (1) fix the npm trusted-publisher (OIDC) grant for `paysdoc/devplatform`'s `release.yml` and re-run the release so v1.1.0 (or a later version) publishes; (2) land and publish devplatform#11 — pipeline already in flight — then confirm with `npm view @paysdoc/devplatform versions` and the Step 1 tarball check; (3) rebase this branch onto `origin/dev` (conflict-free today); (4) re-run the build from spec Step 2 pinning the exact published version and following the updated #840 body for `createForgeCredentials`; (5) re-review against all acceptance criteria and the spec's Validation Commands. Until (1) and (2) are done, no in-repo patch can satisfy this blocker and PR #843 stays a draft.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `gh pr view 843 -R paysdoc/AI_Dev_Workflow --json isDraft,body --jq '"isDraft=\(.isDraft)", "preamble-updated=\(.body | contains("OIDC permission denied") and contains("createForgeCredentials") and contains("devplatform#11") and contains("Tracks #840"))", "old-preamble-gone=\(.body | contains("Prerequisite: paysdoc/devplatform#11 merged") | not)"'` — expect `isDraft=true`, `preamble-updated=true`, `old-preamble-gone=true`; additionally `gh pr view 843 -R paysdoc/AI_Dev_Workflow --json body --jq .body | grep -ciE '^(closes|fixes|resolves|implements) '` must print `0`.
- `git status --short && git log --oneline 4d25d21c..HEAD && git diff --stat` — expect an empty status, exactly the two commits `d5fd43a1` and `7188098b`, and an empty diff.
- Baseline no-regression on the untouched branch (nothing changed, so these must stay as recorded): `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit` — expect both typechecks exit 0 and 180 test files / 3193 tests green.
- Gate check (documenting, not passing — today it prints `MISSING` lines; the migration re-run starts only when it prints none): the Step 1 tarball command above, plus `npm view @paysdoc/devplatform versions --json` → `["1.0.0"]`.
- Rebase safety for the re-run: `git fetch -q origin dev && git merge-tree --write-tree origin/dev HEAD >/dev/null; echo "merge-tree exit=$?"` — expect `0`.
- The spec's own Validation Commands (lint, both typechecks, unit, `lint:git-guard`, `lint:docs-index`, `@regression`, the two greps, the directory check) are the exit criteria of the **re-run**, not of this patch; they cannot pass until the migration is built on a published library version.

## Patch Scope
**Lines of code to change:** 0 in-repo (≈12 lines of PR body preamble plus one checklist line, both outside the repository)
**Risk level:** low — one reversible GitHub body edit on an already-draft PR; no commits, no rebase, no push, no code
**Testing required:** the GitHub-state verification above, the unchanged baseline typechecks and unit suite, and the documented gate check
