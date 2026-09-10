# Runbook: extracting `@paysdoc/devplatform`

Operator steps for Phase B of the GitContext extraction (PRD:
`specs/prd/gitcontext-library-extraction.md`). The PRD deliberately keeps these
out of the issue pipeline: they need npm credentials, repository creation, and
history surgery that no agent should perform. This file is also the parking
place for the five issues that cannot be filed until the library repository
and the first publish exist (see "Deferred issues" at the end).

Naming (decided 2026-09-10): repository `paysdoc/devplatform`, package
`@paysdoc/devplatform`. The word *forge* stays in the API (`forgeProviders`,
`IssueTrackerForge`, `CodeHostForge`, …); see the Forge entry in
`UBIQUITOUS_LANGUAGE.md`.

Entry points:

| Subpath | Contents |
|---|---|
| `.` | forge ports (`IssueTracker`, `CodeHost`, `BoardManager`) and the domain model |
| `./providers` | `forgeProviders()` and the GitHub, GitLab, and Jira adapters |
| `./git` | `GitContext`, executor, worktree/workspace/claim ops, `consoleLogger` |

## 0. Gate

Do nothing below until every one of these is merged to `dev` and released
to `main`:

| Slice | Issue |
|---|---|
| Extraction-readiness guard rule | #816 |
| Domain model into provider package | #817 |
| GitLab/Jira injected config + logger port | #818 |
| GitHub adapter reaches only executor/ports/domain model | #819 (HITL) |
| Callers off legacy layer, wave 1 (orchestrators/phases/core/proof) | #820 |
| Callers off legacy layer, wave 2 (triggers) + delete legacy layer | #821 |
| Retire #796 transitional construction sites | #822 |
| `forgeProviders()` + launch boundary rewire | #823 (HITL) |

Status 2026-09-10: closed. PRs #825–#833 merged to `dev`, released to `main`
via #836.

Verification that the gate is actually closed, run on `main`:

```bash
bun run lint:git-guard          # all four rules green
git grep -lE "from ['\"]\.\./\.\./(core|types|github)" -- adws/gitContext adws/providers | grep -v __tests__
# must print nothing
```

## 1. npm account (one-time)

1. Enable 2FA on the `paysdoc` npm user (already owns `@paysdoc/depaudit`).
2. Decide the auth path for CI:
   - Preferred: **trusted publishing (OIDC)**. Configured on npmjs.com under
     the package settings after the package exists, pointing at
     `paysdoc/devplatform` and the release workflow filename. This means the
     **first publish is manual** (step 6) because the package must exist
     before a trusted publisher can be linked to it.
   - Fallback: a **granular automation token** scoped to `@paysdoc/devplatform`
     only, stored as the `NPM_TOKEN` repository secret. No classic tokens.

## 2. Create the repository

```bash
gh repo create paysdoc/devplatform --public --description "Forge ports and adapters (GitHub, GitLab, Jira) over a forge-neutral git/worktree core" --license MIT
```

`--license` makes GitHub auto-initialise `main` with a LICENSE commit. That
is intended: step 3 rebases the filtered history onto it. Branch protection
is set in step 4 after L1 merges.

## 3. Filter and seed history

Work in a throwaway clone; never run filter-repo in the working checkout.

There is no rename map. Every surviving file either has always lived under
one of the two directories or was created there fresh (verified 2026-09-10:
the only `git log --follow` rename entries are the eight intra-boundary moves
from `adws/gitContext/` into `adws/providers/github/`, which filter-repo keeps
on its own). The vcs modules those files were modelled on still exist as live
files in ADW and are not part of the library. History before 2026-06-22
(#658, the GitContext package's creation) stays in ADW.

```bash
git clone --no-local https://github.com/paysdoc/AI_Dev_Workflow /tmp/dp-extract
cd /tmp/dp-extract
pip install git-filter-repo   # or brew install git-filter-repo
git filter-repo \
  --path adws/gitContext/ \
  --path adws/providers/ \
  --path-rename adws/gitContext/:src/git/ \
  --path-rename adws/providers/:src/providers/
git remote add origin https://github.com/paysdoc/devplatform
git fetch origin main
git rebase --onto origin/main --root main
git push -u origin main
```

Sanity checks before pushing: `git log --oneline | wc -l` is in the hundreds,
not single digits; `git log --follow --format=%h src/git/gitContext.ts | tail -1`
is the #658 creation commit (2026-06-22, `add GitContext package with
base-path authority`); the rebase reported no conflicts (the LICENSE commit
touches no path the filtered history touches).

## 4. Bootstrap and register with ADW

Order matters. The filtered tree is `src/` only: no manifest, no tsconfig, no
test config. `/adw_init` on a manifest-less repo classifies it as a fallback
stack, and a CI check turned on before the build config exists blocks the
very PR that adds it.

1. **Bootstrap commit, by hand, on `main`:**
   - `package.json` skeleton: `"name": "@paysdoc/devplatform"`,
     `"version": "0.0.0-development"`, `"type": "module"`, `"license": "MIT"`,
     `vitest` and `typescript` as devDependencies, `"test:unit": "vitest run"`,
     `"typecheck": "tsc --noEmit"`. The real build/exports configuration is
     issue L1.
   - `tsconfig.json` and `vitest.config.ts` (may be copied from ADW and
     trimmed to `src/`).
   - `.github/adw.yml` containing `guardrails: true`.
   - `.github/workflows/ci.yml`: typecheck and vitest. **It may be red until
     L1 merges.** The guard is added to CI by L3, not here.
   - `.github/workflows/release.yml`: semantic-release on push to `main`
     (configuration is issue L2; the file may be a stub that L2 fills in).
2. Open a Claude Code session in the clone and run `/adw_init`. It writes
   `.adw/`, `.adw-version`, the starter guardrail `settings.json`, runs
   `depaudit setup`, and propagates `SOCKET_API_TOKEN` and
   `SLACK_WEBHOOK_URL` secrets. Running it now, rather than letting the first
   issue's upgrade gate do it, avoids parking that issue behind a `#UPG`
   tracking issue. (The upgrade path commits only `.adw/`, `.adw-version`,
   and the starter settings; it cannot clobber the bootstrap files.)
3. Register with the ADW host: start a cron process for the new repo
   (`bunx tsx adws/triggers/trigger_cron.ts --target-repo paysdoc/devplatform`)
   and add the repository to the webhook's GitHub App installation. Respect
   the single-host constraint. Cron PID files and spawn locks are keyed per
   repo, so a second cron process on the same host is supported.
4. Set repository secrets: `NPM_TOKEN` (only if not using OIDC),
   `SOCKET_API_TOKEN`, `SLACK_WEBHOOK_URL`.
5. Create the `hitl` label on the repository.
6. File L1, L2, L3 (bodies below) on `paysdoc/devplatform`. ADW picks them
   up automatically.
7. **After L1 merges and CI is green:** enable branch protection on `main`
   requiring the CI job.

## 5. Add the Forge glossary entry (ADW side, any time before A1)

`UBIQUITOUS_LANGUAGE.md` gains a **Forge** entry under "Providers and
platforms". Done 2026-09-10.

## 6. First publish (manual)

After L1 merges and CI is green on `main`. A bare `npm publish` would publish
whatever `package.json` says, which is `0.0.0-development`, so the version is
set locally and discarded, and the release tag is written by hand so
semantic-release has a baseline to count from.

```bash
cd /tmp/devplatform && git checkout main && git pull
bun install && bun run build
npm version 1.0.0 --no-git-tag-version
npm publish --access public
git checkout -- package.json           # discard the version bump
git tag v1.0.0 && git push origin v1.0.0
```

Then, on npmjs.com, link the trusted publisher (repo `paysdoc/devplatform`,
workflow `release.yml`). From here on, L2's release workflow publishes.

Verify: `npm view @paysdoc/devplatform version` prints `1.0.0`;
`npm pack --dry-run` shows `dist/` with `.d.ts` files and no `src/`;
`npx semantic-release --dry-run` on `main` reports no release (or a patch
above 1.0.0 if commits have landed since), never 1.0.0 again.

## 7. Drain the ADW queue, then file the switchover

1. Wait until no ADW issue on `paysdoc/AI_Dev_Workflow` is in a stage that
   `stageClassifier` classes as `active` or `awaiting_merge`. Read the
   top-level state files, not labels (`gh issue list --label a,b,c` is an
   AND filter and finds nothing):

   ```bash
   for f in agents/*/adw_state.json; do jq -r '"\(.issueNumber) \(.workflowStage)"' "$f"; done | sort -u
   ```

   Human-gated and retriable stages (`merge_blocked`, `review_failed`,
   `paused_*`) are left alone; their PRs will conflict after A1 and are
   recovered afterwards with `## Retry` or `## Cancel`.
2. Triggers stay running. Any issue that spawns during A1's build branches
   off pre-A1 `dev` and its PR conflicts on up to ~91 files after the merge.
   The resolve_conflict agent handles those on the new library code; if it
   fails, `## Cancel` and re-run.
3. File A1 (switchover, HITL) and A2 (Dependabot) on `paysdoc/AI_Dev_Workflow`
   with the bodies below. A1 spawns on the next cron tick; that is intended.
4. **Human review of A1's PR** (these are not acceptance criteria the agent
   can meet):
   - Run the full suite locally: `bun run test`, `bun run test:unit`,
     `bun run lint:git-guard`, `bun run lint:docs-index`, BDD regression.
   - Trigger one live smoke workflow (a trivial chore issue on a target
     repo) from the PR branch and confirm it completes through PR creation.
   - Tag the pre-merge commit: `git tag pre-gitcontext-switchover <sha>` and
     push the tag.
   - Then approve.

## 8. Rollback

A broken switchover is recovered by hand-reverting the A1 merge commit on
`dev` and `main`. ADW runs on the library after A1, so it cannot repair its
own switch. The `pre-gitcontext-switchover` tag from step 7.4 marks the
last known-good commit.

---

## Deferred issues

### L1 — Package build, exports map, CI (repo: `paysdoc/devplatform`, AFK)

**Parent PRD:** `paysdoc/AI_Dev_Workflow` `specs/prd/gitcontext-library-extraction.md`

**What to build:** Compiled ESM plus type declarations via `tsc`, emitted to
`dist/`. `src/index.ts` re-exporting the forge ports and the domain model
from `src/providers/types.ts`. `package.json` `exports` map with three entry
points: `"."` → forge ports and domain model; `"./providers"` →
`forgeProviders`, `ForgeProvidersOptions`, `ForgeProviderDeps`, and the three
adapters; `"./git"` → `GitContext`, the executor, worktree/workspace/claim
ops, `consoleLogger`. `files` limited to `dist/`, `README.md`, `LICENSE`.
Make the hand-added CI (typecheck + vitest) green.

**Acceptance criteria:**
- [ ] `bun run build` produces `dist/**/*.js` + `dist/**/*.d.ts`; `npm pack --dry-run` lists no `src/`
- [ ] A Node consumer (`node -e "import('@paysdoc/devplatform')"`) and a Bun consumer resolve all three subpaths from the packed tarball
- [ ] `./git` import pulls no adapter module and no `forgeProviders` (verify with an import-graph assertion); root import pulls no adapter module
- [ ] CI green on typecheck + vitest

**Blocked by:** none.
**User stories:** 14, 15.

### L2 — Release automation with agent-prefixed commit parser (repo: `paysdoc/devplatform`, AFK)

**What to build:** semantic-release on push to `main`. `parserOpts.headerPattern`
accepts an optional `<agent-name>: ` prefix before the conventional type, e.g.
`build-agent: feat: …` → minor, `review-patch-agent: fix: …` → patch,
`plan-orchestrator: chore: …` → no release, plain `feat: …` → minor. Unit tests
for the pattern; a CI dry-run job (`semantic-release --dry-run`) on PRs so a
never-publishing configuration is caught before merge. Publishing via OIDC
trusted publishing (`id-token: write`), falling back to `NPM_TOKEN` if the
secret is present. The baseline is the hand-pushed `v1.0.0` tag from the
first manual publish; the workflow must never recompute 1.0.0.

**Acceptance criteria:**
- [ ] Parser unit tests cover agent-prefixed and plain commits for patch, minor, and none
- [ ] PR dry-run job shows the computed next version in the log
- [ ] First CI-driven release after 1.0.0 publishes `1.0.1` or `1.1.0` from a real merged commit
- [ ] No long-lived broad npm credential in the repository

**Blocked by:** L1.
**User stories:** 16, 17, 18, 19, 20.

### L3 — Port the git/gh guard (repo: `paysdoc/devplatform`, AFK)

**What to build:** Bring `checkGitGhGuard.ts` and the `guard/` module over
with two rules; wire into CI.

- **Shell-out rule**, exempt set = `src/git/` (the git core, the only package
  that may run git commands) and `src/providers/github/` (the GitHub adapter,
  whose `gh` command strings feed the core executor). This mirrors ADW's
  two-entry `EXEMPT_PACKAGES`. The adapter holds over 60 `gh …` string
  literals across 13 files; an exempt set of the core alone would flag every
  one of them.
- **Construction rule**, walked over the whole tree (ADW prunes the two
  packages from this rule; the library must not), with a sanctioned-site
  allowlist of exactly one file: `src/providers/forgeProviders.ts`. Verified
  2026-09-10: it is the only non-test call site of the adapter factories in
  the two packages, and nothing in them calls `new GitContext` outside tests.
- The identity rule is **not** ported: it guards consumers composing
  cwd-derived identity into `forgeProviders`, and nothing inside the library
  calls `forgeProviders` outside tests.
- The extraction-readiness rule is **not** ported: it has nothing to guard
  once the packages are the whole repo.

**Acceptance criteria:**
- [ ] A `git`/`gh` shell-out anywhere but `src/git/` and `src/providers/github/` fails CI; both exempt packages pass
- [ ] A call to an adapter factory or `new GitContext` from any non-test file other than `forgeProviders.ts` fails CI
- [ ] Guard test suite (both directions) relocated and green
- [ ] `bun run lint:git-guard` in CI

**Blocked by:** L1.
**User stories:** 22.

### A1 — ADW switchover to `@paysdoc/devplatform` (repo: `paysdoc/AI_Dev_Workflow`, **HITL**)

**What to build:** One atomic migration. Add the dependency at the published
version; rewrite every `adws/gitContext` import to `@paysdoc/devplatform/git`
and every `adws/providers` import to `@paysdoc/devplatform` (ports, domain
model) or `@paysdoc/devplatform/providers` (`forgeProviders`, adapters);
repoint `buildLaunchBoundary` at the library's `forgeProviders` and
`GitContext`; delete `adws/gitContext/` and `adws/providers/`; set ADW's guard
`EXEMPT_PACKAGES` to the empty set, delete the extraction-readiness rule, and
remove the now-stale `adws/providers/forgeProviders.ts` entry from
`SANCTIONED_CONSTRUCTION_SITES`; update the identity/construction rules to
recognise the imported names; update `features/regression/**/feature-729.feature`
path references; retire the living docs for the extracted modules and their
`conditional_docs.md` entries.

**Acceptance criteria:**
- [ ] No `adws/gitContext/` or `adws/providers/` directory; no relative import of either remains
- [ ] Guard exempt set empty; a git/gh shell-out anywhere in ADW fails CI; `SANCTIONED_CONSTRUCTION_SITES` lists only the launch boundary
- [ ] Full unit suite, typecheck, BDD regression green
- [ ] `feature-729.feature` and living docs updated; `bun run lint:docs-index` green

Operator verification (smoke workflow, rollback tag) is runbook step 7.4, not
an acceptance criterion.

**Blocked by:** none at filing time (filed only after #823, L1–L3, and the
first publish are done; see runbook step 7).
**User stories:** 23, 24, 25, 26, 27, 29.

### A2 — Dependabot for `@paysdoc/devplatform` (repo: `paysdoc/AI_Dev_Workflow`, AFK)

**What to build:** `.github/dependabot.yml` watching npm, restricted to
`@paysdoc/devplatform` (`allow: dependency-name`), weekly, labelled
`dependencies`. Bump PRs are merged by hand; document in `adws/README.md`
that bot PRs sit outside the issue-keyed pipeline and must not be labelled
`adw:*`. (The webhook already ignores them: it handles only
`pull_request.closed`, keyed by an `issue-N` branch pattern.)

**Acceptance criteria:**
- [ ] Dependabot opens a PR when a new library version is published
- [ ] The PR is not picked up by cron or webhook (no ADW comments on it)
- [ ] README note present

**Blocked by:** A1.
**User stories:** 28.
