# Runbook: extracting `@paysdoc/gitcontext`

Operator steps for Phase B of the GitContext extraction (PRD:
`specs/prd/gitcontext-library-extraction.md`). The PRD deliberately keeps these
out of the issue pipeline: they need npm credentials, repository creation, and
history surgery that no agent should perform. This file is also the parking
place for the five issues that cannot be filed until the library repository
and the first publish exist (see "Deferred issues" at the end).

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
     `paysdoc/gitcontext` and the release workflow filename. This means the
     **first publish is manual** (step 7) because the package must exist
     before a trusted publisher can be linked to it.
   - Fallback: a **granular automation token** scoped to `@paysdoc/gitcontext`
     only, stored as the `NPM_TOKEN` repository secret. No classic tokens.

## 2. Create the repository

```bash
gh repo create paysdoc/gitcontext --public --description "Forge-neutral git/worktree core with pluggable forge providers (GitHub, GitLab, Jira)" --license MIT
```

Do not push anything yet. Branch protection on `main` (require PR, require
status checks) is set after CI exists in step 5.

## 3. Build the rename map

Extraction is `git filter-repo` over two directories, but many surviving
files were absorbed into those directories from older paths (`adws/vcs/*`,
`adws/github/gitContextFactory.ts`, `adws/core/tokenResolver.ts`, …). Without
a rename map those files' history would start at the absorption commit.

For every file under the two directories on `main`:

```bash
git ls-files adws/gitContext adws/providers | grep -v __tests__ | while read f; do
  echo "== $f"
  git log --follow --name-status --format='%h' -- "$f" | grep -E '^R' | awk '{print $2 " -> " $3}'
done > /tmp/rename-trail.txt
```

Turn the trail into a filter-repo `--paths-from-file` list containing every
historical path each file lived at, plus the two directories themselves.
History older than a file's oldest recorded path stays in ADW (PRD decision).

## 4. Filter and seed history

Work in a throwaway clone; never run filter-repo in the working checkout.

```bash
git clone --no-local https://github.com/paysdoc/AI_Dev_Workflow /tmp/gc-extract
cd /tmp/gc-extract
pip install git-filter-repo   # or brew install git-filter-repo
git filter-repo --paths-from-file /tmp/gc-paths.txt \
  --path-rename adws/gitContext/:src/ \
  --path-rename adws/providers/:src/providers/
git remote add origin https://github.com/paysdoc/gitcontext
git push -u origin main
```

Sanity checks before pushing: `git log --oneline | wc -l` is in the hundreds,
not single digits; `git log --follow src/gitContext.ts` reaches back to the
pre-#658 file it came from.

## 5. Bootstrap and register with ADW

1. Open a Claude Code session in the fresh clone and run `/adw_init`. It
   writes `.adw/`, `.adw-version`, the starter guardrail `settings.json`,
   runs `depaudit setup`, and propagates `SOCKET_API_TOKEN` and
   `SLACK_WEBHOOK_URL` secrets.
2. Register with the ADW host: start a cron process for the new repo
   (`bunx tsx adws/triggers/trigger_cron.ts --target-repo paysdoc/gitcontext`)
   and add the repository to the webhook's GitHub App installation. Respect
   the single-host constraint.
3. Hand-add, on a PR reviewed by a human:
   - `.github/workflows/ci.yml`: typecheck, vitest, and the ported git/gh
     guard (exempt set: the executor module only).
   - `.github/workflows/release.yml`: semantic-release on push to `main`.
   - `package.json` skeleton: `"name": "@paysdoc/gitcontext"`,
     `"version": "0.0.0-development"`, `"type": "module"`, `"license": "MIT"`.
     The real build/exports configuration is issue L1 below.
   - Branch protection on `main` requiring the CI job.
4. Set repository secrets: `NPM_TOKEN` (only if not using OIDC),
   `SOCKET_API_TOKEN`, `SLACK_WEBHOOK_URL`.

## 6. File the library issues

File L1, L2, L3 (bodies below) on `paysdoc/gitcontext`. Create the `hitl`
label first if any is HITL-tagged. ADW picks them up automatically.

## 7. First publish (manual)

After L1 merges and CI is green on `main`:

```bash
cd /tmp/gitcontext && git checkout main && git pull
bun install && bun run build
npm publish --access public          # creates the package as 1.0.0
```

Then, on npmjs.com, link the trusted publisher (repo `paysdoc/gitcontext`,
workflow `release.yml`). From here on, L2's release workflow publishes.

Verify: `npm view @paysdoc/gitcontext version` prints `1.0.0`; `npm pack --dry-run`
shows `dist/` with `.d.ts` files and no `src/`.

## 8. Drain the ADW queue, then file the switchover

1. Wait until no ADW issue on `paysdoc/AI_Dev_Workflow` is in an active or
   `awaiting_merge` stage (`gh issue list --label adw:feature,adw:bug,adw:chore --state open`
   and the `agents/*/adw_state.json` stages).
2. File A1 (switchover, HITL) and A2 (Dependabot) on `paysdoc/AI_Dev_Workflow`
   with the bodies below. A1 is blocked on nothing at that point, so it spawns
   on the next cron tick; that is intended.
3. Review A1's PR by hand: run the full suite locally and trigger one live
   smoke workflow (a trivial chore issue on a target repo) from the PR branch
   before approving.

## 9. Rollback

A broken switchover is recovered by hand-reverting the A1 merge commit on
`dev` and `main`. ADW runs on the library after A1, so it cannot repair its
own switch. Keep the pre-A1 tag: `git tag pre-gitcontext-switchover <sha>`
before merging.

---

## Deferred issues

### L1 — Package build, exports map, CI (repo: `paysdoc/gitcontext`, AFK)

**Parent PRD:** `paysdoc/AI_Dev_Workflow` `specs/prd/gitcontext-library-extraction.md`

**What to build:** Compiled ESM plus type declarations via `tsc`, emitted to
`dist/`. `package.json` `exports` map: `"."` → the git core (GitContext,
executor, ports, worktree/workspace/claim ops, `consoleLogger`);
`"./providers"` → provider ports, domain model, `forgeProviders`, and the
three adapters. `files` limited to `dist/`, `README.md`, `LICENSE`. CI runs
typecheck, vitest, and the guard on every PR.

**Acceptance criteria:**
- [ ] `bun run build` produces `dist/**/*.js` + `dist/**/*.d.ts`; `npm pack --dry-run` lists no `src/`
- [ ] A Node consumer (`node -e "import('@paysdoc/gitcontext')"`) and a Bun consumer resolve both subpaths from the packed tarball
- [ ] Root import pulls no adapter module (verify with a bundle-size or import-graph assertion)
- [ ] CI green on typecheck + vitest + guard

**Blocked by:** none.
**User stories:** 14, 15.

### L2 — Release automation with agent-prefixed commit parser (repo: `paysdoc/gitcontext`, AFK)

**What to build:** semantic-release on push to `main`. `parserOpts.headerPattern`
accepts an optional `<agent-name>: ` prefix before the conventional type, e.g.
`build-agent: feat: …` → minor, `review-patch-agent: fix: …` → patch,
`plan-orchestrator: chore: …` → no release, plain `feat: …` → minor. Unit tests
for the pattern; a CI dry-run job (`semantic-release --dry-run`) on PRs so a
never-publishing configuration is caught before merge. Publishing via OIDC
trusted publishing (`id-token: write`), falling back to `NPM_TOKEN` if the
secret is present.

**Acceptance criteria:**
- [ ] Parser unit tests cover agent-prefixed and plain commits for patch, minor, and none
- [ ] PR dry-run job shows the computed next version in the log
- [ ] First CI-driven release after 1.0.0 publishes `1.0.1` or `1.1.0` from a real merged commit
- [ ] No long-lived broad npm credential in the repository

**Blocked by:** L1.
**User stories:** 16, 17, 18, 19, 20.

### L3 — Port the git/gh guard, executor-only exemption (repo: `paysdoc/gitcontext`, AFK)

**What to build:** Bring `checkGitGhGuard.ts` and the `guard/` rules over
(shell-out rule with `EXEMPT_PACKAGES` = the executor module only; the
identity and construction rules adapted to the library's own boundary, i.e.
`forgeProviders` and the `GitContext` constructor). The extraction-readiness
rule is not ported: it has nothing to guard once the packages are the whole
repo. Wire into CI.

**Acceptance criteria:**
- [ ] A `git`/`gh` shell-out anywhere but the executor module fails CI; the executor passes
- [ ] Guard test suite (both directions) relocated and green
- [ ] `bun run lint:git-guard` in CI

**Blocked by:** L1.
**User stories:** 22.

### A1 — ADW switchover to `@paysdoc/gitcontext` (repo: `paysdoc/AI_Dev_Workflow`, **HITL**)

**What to build:** One atomic migration. Add the dependency at the published
version; rewrite every `adws/gitContext` and `adws/providers` import to
`@paysdoc/gitcontext` / `@paysdoc/gitcontext/providers`; repoint
`buildLaunchBoundary` at the library's `forgeProviders` and `GitContext`;
delete `adws/gitContext/` and `adws/providers/`; set ADW's guard
`EXEMPT_PACKAGES` to the empty set and delete the extraction-readiness rule;
update the identity/construction rules to recognise the imported names;
update `features/regression/**/feature-729.feature` path references; retire
the living docs for the extracted modules and their `conditional_docs.md`
entries. The queue is drained before this builds.

**Acceptance criteria:**
- [ ] No `adws/gitContext/` or `adws/providers/` directory; no relative import of either remains
- [ ] Guard exempt set empty; a git/gh shell-out anywhere in ADW fails CI
- [ ] Full unit suite, typecheck, BDD regression green; one live smoke workflow on a target repo completes through PR creation
- [ ] `feature-729.feature` and living docs updated; `bun run lint:docs-index` green
- [ ] Rollback tag `pre-gitcontext-switchover` exists on the pre-merge commit

**Blocked by:** #823, L1, L2, L3, and the first publish (runbook step 7).
**User stories:** 23, 24, 25, 26, 27, 29.

### A2 — Dependabot for `@paysdoc/gitcontext` (repo: `paysdoc/AI_Dev_Workflow`, AFK)

**What to build:** `.github/dependabot.yml` watching npm, restricted to
`@paysdoc/gitcontext` (`allow: dependency-name`), weekly, labelled
`dependencies`. Bump PRs are merged by hand; document in `adws/README.md`
that bot PRs sit outside the issue-keyed pipeline and must not be labelled
`adw:*`.

**Acceptance criteria:**
- [ ] Dependabot opens a PR when a new library version is published
- [ ] The PR is not picked up by cron or webhook (no ADW comments on it)
- [ ] README note present

**Blocked by:** A1.
**User stories:** 28.
