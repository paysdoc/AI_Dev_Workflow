# Chore: Dependabot for @paysdoc/devplatform

## Metadata
issueNumber: `841`
adwId: `rgfeil-dependabot-for-paysd`
issueJson: `{"number":841,"title":"Dependabot for @paysdoc/devplatform","body":"**Parent PRD:** `specs/prd/gitcontext-library-extraction.md`. Runbook: `specs/runbooks/gitcontext-extraction.md` step 7.\n\n**What to build:** `.github/dependabot.yml` watching npm, restricted to\n`@paysdoc/devplatform` (`allow: dependency-name`), weekly, labelled\n`dependencies`. Bump PRs are merged by hand; document in `adws/README.md`\nthat bot PRs sit outside the issue-keyed pipeline and must not be labelled\n`adw:*`. (The webhook already ignores them: it handles only\n`pull_request.closed`, keyed by an `issue-N` branch pattern.)\n\n**Acceptance criteria:**\n- [ ] Dependabot opens a PR when a new library version is published\n- [ ] The PR is not picked up by cron or webhook (no ADW comments on it)\n- [ ] README note present\n\n**User stories:** 28.\n\n## Blocked by\n\n- #840\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-09-10T13:52:31Z","comments":[],"actionableComment":null}`

## Chore Description
After the #840 switchover, ADW consumes the git core and forge adapters from the published npm package `@paysdoc/devplatform` (pinned exactly at `"1.2.0"` in `package.json`, resolved in `bun.lock`). PRD user story 28 says library version bumps should arrive as Dependabot pull requests that a human merges. That way the library knows nothing about its consumers, and bot PRs, which have no backing issue, stay outside the issue-keyed ADW pipeline.

The chore has two deliverables:

1. **`.github/dependabot.yml`**: a Dependabot version-updates config. It watches the npm registry for `@paysdoc/devplatform` only (`allow: - dependency-name`), runs weekly, targets `dev` (the repo's default branch, confirmed with `gh repo view`), and labels its PRs `dependencies`.
2. **An `adws/README.md` note**: explains that Dependabot bump PRs sit outside the issue-keyed pipeline, are merged by hand, and must not be labelled `adw:*` or get ADW directive comments.

No TypeScript changes are needed. The code already ignores these PRs:
- **Webhook `pull_request`**: only `action === 'closed'` is handled (`adws/triggers/trigger_webhook.ts` ~L259). `handlePullRequestEvent` (`adws/triggers/webhookHandlers.ts` ~L80–110) keys off `extractIssueNumberFromBranch(head.ref)` (`/issue-(\d+)/`). A Dependabot branch such as `dependabot/bun/paysdoc/devplatform-1.3.0` has no `issue-N`, so the handler logs and returns.
- **Webhook `pull_request_review` / `pull_request_review_comment`**: these go through `resolvePrReviewSpawn` (`webhookHandlers.ts` ~L229). The GitHub adapter derives `linkedIssueNumber` from the same `issue-(\d+)` branch pattern (`node_modules/@paysdoc/devplatform/dist/providers/github/ghPrParsers.js`), so the resolver returns `skip` (`not-issue-linked`) and nothing is spawned.
- **Cron issue polling**: `listCronOpenIssues` (`adws/triggers/cronIssueListing.ts`) uses `issueTracker.listIssues`, which lists issues only, not PRs.
- **Cron PR review-comment poll**: `checkPRsForReviewComments` (`adws/triggers/trigger_cron.ts` ~L504) logs "Skipping issue-less PR" when `resolvePrReviewSpawn` returns `null`.
- **Caveat for the README**: GitHub sends PR conversation comments as `issue_comment` events keyed by the PR number. A human posting `## Continue` / `## Cancel` / `## Retry` on a bot PR would go through the issue-comment path (`trigger_webhook.ts` ~L200–250) and could classify/spawn a workflow against the PR number. Likewise, an `adw:*` label would make it look like ADW-managed work. The README must say not to do either.

**Ecosystem choice:** the repo has **only `bun.lock`** (no `package-lock.json`). Dependabot's `package-ecosystem: "bun"` still resolves packages from the npm registry, and it is the ecosystem that regenerates the text-format `bun.lock`. With `"npm"`, a bump PR could change `package.json` without a matching `bun.lock` update, which breaks `bun install --frozen-lockfile` consumers. Use `"bun"`, which meets the issue's "watching npm" intent: the npm-registry package `@paysdoc/devplatform`. Mention this in a YAML comment so reviewers don't read it as a deviation.

## Relevant Files
Use these files to resolve the chore:

- `README.md`: project overview (read for orientation; no change required).
- `.adw/coding_guidelines.md`: guidelines to follow. Clarity, and no ADW unit tests (BDD is the validation mechanism).
- `adws/README.md`: the ADW docs. The "### Automation Triggers" section (~L408–450, `trigger_cron.ts` / `trigger_webhook.ts`) is where the new Dependabot note goes.
- `adws/triggers/trigger_webhook.ts`: confirms the `pull_request` event handles only `closed`, and shows the `pull_request_review*` and `issue_comment` routing described in the README note. Read-only.
- `adws/triggers/webhookHandlers.ts`: `extractIssueNumberFromBranch` and `resolvePrReviewSpawn` show why branches without `issue-N` are skipped. Read-only.
- `adws/triggers/trigger_cron.ts`: `checkPRsForReviewComments` skips issue-less PRs. Read-only.
- `adws/triggers/cronIssueListing.ts`: cron lists issues only. Read-only.
- `package.json` / `bun.lock`: show the exact pin `"@paysdoc/devplatform": "1.2.0"` and that the lockfile is bun's text format (the reason for `package-ecosystem: "bun"`). Read-only.
- `.github/adw.yml`: an existing `.github/` config file; shows the comment style to match (header comment explaining purpose). Read-only.
- `specs/runbooks/gitcontext-extraction.md` (step 7, section "A2 — Dependabot for `@paysdoc/devplatform`"): the source spec for this chore. Read-only.
- `specs/prd/gitcontext-library-extraction.md` (user story 28): the rationale. Read-only.

### New Files
- `.github/dependabot.yml`: Dependabot version-updates configuration restricted to `@paysdoc/devplatform`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Create `.github/dependabot.yml`
- Create the file with this content (keep the header comments; they record the ecosystem rationale and the out-of-pipeline rule):

```yaml
# Dependabot version updates for ADW.
# Only @paysdoc/devplatform (the extracted git core + forge adapters, published to
# the npm registry) is watched. Bump PRs are merged by hand: they have no backing
# issue and sit outside the issue-keyed ADW pipeline (see adws/README.md,
# "Dependabot bump PRs"). Never label them adw:*.
#
# package-ecosystem "bun" resolves from the npm registry and also regenerates
# bun.lock (this repo has no package-lock.json), so bump PRs stay installable.
version: 2
updates:
  - package-ecosystem: "bun"
    directory: "/"
    schedule:
      interval: "weekly"
    target-branch: "dev"
    allow:
      - dependency-name: "@paysdoc/devplatform"
    labels:
      - "dependencies"
    commit-message:
      prefix: "chore"
      include: "scope"
    open-pull-requests-limit: 5
```

- Do not add `groups`, `ignore`, or `registries` blocks. The package is public on npmjs.org (`bun.lock` resolves it with no custom registry, and there is no `.npmrc` or `bunfig.toml`).

### 2. Ensure the `dependencies` label exists on the repo
- Dependabot silently drops configured labels that don't exist in the repository, and `gh label list --search dependencies` currently returns nothing. Create it idempotently:
  - `gh label create dependencies --color 0366d6 --description "Pull requests that update a dependency file" --force`
- This is a one-off repo setting, not a code change. If the build environment lacks `gh` write access, say so in the PR description so a human can run the command.

### 3. Add the Dependabot note to `adws/README.md`
- In the "### Automation Triggers" section, after the `#### trigger_webhook.ts - Real-time Events` subsection (after its **Security:** bullets, before `## How ADW Works`), add a new subsection `#### Dependabot bump PRs (outside the pipeline)` covering:
  - **What:** `.github/dependabot.yml` watches the npm registry for `@paysdoc/devplatform` only, weekly, against `dev`. PRs are labelled `dependencies` and come from branches like `dependabot/bun/paysdoc/devplatform-<version>`.
  - **Merged by hand:** a human reviews the bump (check the library changelog, run `bun install`, `bun run test`, `bun run test:unit`, `bun run lint:git-guard`) and merges it. ADW never reviews or auto-merges these PRs.
  - **Why ADW ignores them:** every ADW trigger is keyed by an issue, and bot PRs have none.
    - The webhook handles `pull_request` only for `closed`, and resolves the issue from an `issue-N` pattern in the head branch. Dependabot branches don't match, so there is no abandonment handling.
    - `pull_request_review` / `pull_request_review_comment` events and cron's PR review-comment poll resolve the PR's linked issue from the same branch pattern and skip issue-less PRs.
    - Cron's issue poll lists issues only, never PRs.
  - **Rules (bold/emphasised):**
    - Do **not** add any `adw:*` label to a Dependabot PR.
    - Do **not** post ADW directives (`## Continue`, `## Cancel`, `## Retry`) as comments on it. PR conversation comments reach the webhook as `issue_comment` events keyed by the PR number and would go through the issue-comment path.
    - Use Dependabot's own commands (`@dependabot rebase`, `@dependabot recreate`) instead.
- Match the surrounding style: `####` heading, short bold lead-ins, bullet lists, backticked identifiers. Keep it to roughly 15–25 lines.

### 4. Run validation
- Run every command in `Validation Commands` and confirm each exits 0.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun -e "const {parse}=require('yaml');const c=parse(require('fs').readFileSync('.github/dependabot.yml','utf8'));const u=c.updates[0];if(c.version!==2||u['package-ecosystem']!=='bun'||u.directory!=='/'||u.schedule.interval!=='weekly'||u['target-branch']!=='dev'||u.allow.length!==1||u.allow[0]['dependency-name']!=='@paysdoc/devplatform'||!u.labels.includes('dependencies')){console.error('dependabot.yml invalid');process.exit(1)}console.log('dependabot.yml ok')"`: parses the YAML and asserts the required keys.
- `grep -q "Dependabot bump PRs" adws/README.md && grep -q "adw:\*" adws/README.md && echo "README note ok"`: the README note is present.
- `bun run lint`: ESLint, no regressions.
- `bunx tsc --noEmit`: root type check.
- `bunx tsc --noEmit -p adws/tsconfig.json`: ADW type check.
- `bun run build`: build succeeds.
- `bun run test:unit`: existing unit tests still pass.
- `bun run lint:docs-index`: living-docs index check still passes after the README edit.

## Notes
- Follow `.adw/coding_guidelines.md`. No unit tests should be added for this chore; ADW doesn't use unit tests as quality gates, and the change is config plus docs.
- **Acceptance criterion 1** (Dependabot opens a PR on a new library version) can only be observed after merge. Dependabot reads `dependabot.yml` from the default branch (`dev`) and runs on its weekly schedule, or on demand from Insights → Dependency graph → Dependabot → "Check for updates". Note this in the PR description as a post-merge verification step.
- **Acceptance criterion 2** (no ADW comments on the bot PR) needs no code: the analysis in the Chore Description shows every trigger path skips PRs whose head branch lacks `issue-N`. Do not change trigger code.
- The `issue-(\d+)` match is unanchored. A Dependabot branch would only be misread as issue-linked if a watched dependency name contained `issue-<digits>`. `@paysdoc/devplatform` doesn't, and the `allow` list keeps it the only watched dependency.
- `package.json` pins the library exactly (`"1.2.0"`, no caret). Dependabot's default `versioning-strategy` for pinned versions bumps the pin, which is the intended behaviour, so don't set `versioning-strategy`.
- Don't touch the top-level `README.md`; the issue requires only the `adws/README.md` note.
