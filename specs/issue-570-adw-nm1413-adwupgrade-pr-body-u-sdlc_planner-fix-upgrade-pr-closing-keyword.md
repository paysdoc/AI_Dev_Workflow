# Bug: adwUpgrade PR body uses a non-closing keyword, so the upgrade tracking issue never closes (blocks dependents)

## Metadata
issueNumber: `570`
adwId: `nm1413-adwupgrade-pr-body-u`
issueJson: `{"number":570,"title":"adwUpgrade: PR body uses non-closing keyword, so upgrade tracking issue never closes (blocks dependents)","body":"## Summary\n\n`adwUpgrade.tsx` builds its PR body with `Implements #N`, which is **not** a GitHub closing keyword. As a result the upgrade tracking issue never auto-closes on merge, never gets a Development-section PR link, and never shows the PR chip on its Project board card. Any issue parked behind it via `## Blocked by #N` then stays blocked **permanently**, because `findOpenDependencies` keys on `getIssueState === 'OPEN'`.\n\n## Confirmed incident (2026-06-11)\n\n- #565 hit the upgrade gate, parked with `## Blocked by #566`, and spawned `adwUpgrade` for tracking issue #566.\n- The upgrade ran (in fact twice — PRs #567 and #568 both merged into `dev`, landing the correct `.adw-version` = `993da046def8…`, which matches the current framework hash).\n- **#566 stayed OPEN** — its timeline shows only `cross-referenced` events for #567/#568, never a development/`connected` link, because the PR bodies said `Implements #566` rather than `Closes #566`.\n- Consequently #565 is parked forever (its worktree has only KPI commits; no fix, no PR).\n\n## Root cause\n\n`buildUpgradePrBody` (`adws/adwUpgrade.tsx:104`) emits `Implements #N`. The doc comment at `adwUpgrade.tsx:20-21` incorrectly claims *\"the tracking issue auto-closes on merge via the Implements #<N> linkage\"* — `Implements` only creates a bare cross-reference. GitHub auto-closes (and creates the linked-PR relationship that Projects renders) only on `Closes/Fixes/Resolves`.\n\nThe normal SDLC path is unaffected because `/pull_request` (`.claude/commands/pull_request.md:25`) already uses `Closes #N`. Note `adwMerge.tsx` never calls `closeIssue` either — issue closure in **both** paths is driven purely by the PR-body keyword. The upgrade path simply hand-rolled a body with the wrong keyword.\n\n## Fix (keyword-only, additive)\n\n- `buildUpgradePrBody` (`adws/adwUpgrade.tsx:104`): keep `Implements #N` as the first line (preserves the `linkedPrDetector` backstop and existing `/^Implements/` test) and **add a `Closes #N` line**. Plain `Closes #N` — the tracking issue and PR are always in the same repo (`upgradeGate.ts:142` and `adwUpgrade.tsx` both use the target `repoInfo`/`repoId`), so no cross-repo `Closes owner/repo#N` form is needed.\n- Correct the misleading doc comment at `adwUpgrade.tsx:20-21`.\n\n### Why additive\n\n`Closes #N` fires on merge-to-default-branch regardless of *who* merges, so it covers both the auto-merge path and the HITL-human-merge path (where the orchestrator has already exited and an explicit `closeIssue()` could not fire). `Implements #N` remains as defense-in-depth: if auto-close ever silently fails, `linkedPrDetector` still recognises the merged PR so `concurrencyGuard` won't over-count and `cronLabelEligibility` won't re-spawn.\n\n## Tests (`adws/__tests__/adwUpgrade.test.ts`)\n\n- Keep existing `Implements #541` assertions (`:48`, `:140`).\n- Add assertions that the body also contains `Closes #541`, in both the `buildUpgradePrBody` unit test and the `createPullRequest` body test.\n\n## Out of scope (separate follow-ups)\n\n- Duplicate spawn of `adwUpgrade` (#567 + #568 both merged) — `findPRByBranch` TOCTOU race.\n- Non-deterministic / lossy `/adw_init` regeneration (dropped the `## Run E2E Tests` section; the two concurrent runs disagreed on `vocabulary.md`).\n- Remediating already-merged-but-open upgrade issues — handled manually.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-14T09:25:07Z","comments":[{"author":"paysdoc","createdAt":"2026-06-14T09:28:57Z","body":"## continue"}],"actionableComment":null}`

## Bug Description
The framework self-upgrade orchestrator `adws/adwUpgrade.tsx` hand-rolls its pull-request body with `Implements #<issueNumber>` as the issue reference. `Implements` is **not** a GitHub closing keyword. GitHub only auto-closes an issue — and only creates the "linked PR" development relationship that Projects V2 renders (the PR chip / Development section) — when the body contains a recognised closing keyword: `Closes`, `Fixes`, or `Resolves`.

**Expected behaviour:** when an `adwUpgrade` PR merges into the default branch, the `#UPG` framework-upgrade tracking issue auto-closes, gets a Development-section PR link, and shows the PR chip on its Project board card. Any issue parked behind it via `## Blocked by #<trackingIssue>` then becomes eligible again on the next cron tick.

**Actual behaviour:** the tracking issue stays **OPEN** forever. Its timeline shows only `cross-referenced` events for the merged upgrade PR(s), never a `connected`/development link. Because `findOpenDependencies` (`adws/triggers/issueDependencies.ts`) keys eligibility on `getIssueState(...) === 'OPEN'`, every dependent issue parked behind the still-open tracking issue stays blocked **permanently** — it never gets a fix, a PR, or a merge.

### Confirmed incident (2026-06-11)
- #565 hit the upgrade gate, parked with `## Blocked by #566`, and spawned `adwUpgrade` for tracking issue #566.
- The upgrade ran (twice — PRs #567 and #568 both merged into `dev`, landing the correct `.adw-version` = `993da046def8…`, which matches the current framework hash).
- **#566 stayed OPEN** — timeline shows only `cross-referenced` events for #567/#568, never a development/`connected` link, because the PR bodies said `Implements #566` rather than `Closes #566`.
- Consequently #565 is parked forever (its worktree holds only KPI commits; no fix, no PR).

## Problem Statement
`buildUpgradePrBody()` in `adws/adwUpgrade.tsx` produces a PR body whose only issue reference is `Implements #N`, which never auto-closes the upgrade tracking issue on merge. This silently strands every dependent issue that registered a `## Blocked by #N` dependency on that tracking issue, because dependency eligibility is gated on the tracking issue's `OPEN`/`CLOSED` state. The fix must make the upgrade PR auto-close its tracking issue on merge — under both the default auto-merge path and the HITL human-merge path — without breaking the existing `linkedPrDetector` backstop that relies on the `Implements #N` marker.

## Solution Statement
Make the change **keyword-only and additive**:

1. In `buildUpgradePrBody()`, keep `Implements #N` as the first line (preserves the `linkedPrDetector` `hasLinkedMergedOrClosedPR` backstop and the existing `/^Implements/` test) and **add a second `Closes #N` line**. Use the plain `Closes #N` form — the tracking issue and the upgrade PR are always created in the same target repo (the upgrade gate creates the `#UPG` issue and `adwUpgrade` opens the PR using the same `repoInfo`/`repoId`), so no cross-repo `Closes owner/repo#N` form is required.
2. Correct the two misleading doc comments in `adwUpgrade.tsx` that claim the tracking issue auto-closes "via the `Implements #<N>` linkage" — replace with an accurate description (`Closes #<N>` keyword closes; `Implements #<N>` is the detector backstop).
3. Add unit-test assertions that the body contains `Closes #541`, alongside the retained `Implements #541` assertions, in both the `buildUpgradePrBody` unit test and the `createPullRequest`-body test.

**Why `Closes` and not an explicit `closeIssue()` call:** `Closes #N` fires on merge-to-default-branch regardless of *who* merges, so it covers both the orchestrator's auto-merge path and the HITL path where a human merges after the orchestrator has already exited (an explicit `closeIssue()` could not fire there). This mirrors the normal SDLC path, where `/pull_request` (`.claude/commands/pull_request.md:25`) already uses `Closes #N` and neither `adwMerge.tsx` nor `adwUpgrade.tsx` ever calls `closeIssue` — issue closure in both paths is driven purely by the PR-body keyword.

**Why keep `Implements` too (defense-in-depth):** `adws/github/linkedPrDetector.ts` (`hasLinkedMergedOrClosedPR`) scans PR bodies for `Implements #<issueNumber>` to recognise a merged/closed linked PR. Keeping the `Implements` line means that if GitHub auto-close ever silently fails, the detector still recognises the merged PR, so `concurrencyGuard` won't over-count the issue as in-progress and `cronLabelEligibility` won't re-spawn it.

## Steps to Reproduce
1. A target repo's framework hash drifts; the upgrade gate (`adws/phases/upgradeGate.ts`) elects a winner, creates a `#UPG` tracking issue (e.g. #566), and spawns `adwUpgrade.tsx`. A second issue (e.g. #565) registers `## Blocked by #566` and parks.
2. `adwUpgrade` regenerates `.adw/`, opens a PR whose body is built by `buildUpgradePrBody()` → the body's only issue reference is `Implements #566`.
3. The PR merges into the default branch (auto-merge or human merge).
4. **Observe:** issue #566 remains **OPEN**. Its timeline shows a `cross-referenced` event for the merged PR but no `connected`/development link; the Project card shows no PR chip.
5. On every subsequent cron tick, `findOpenDependencies` sees #566 as `OPEN` and keeps #565 ineligible → #565 is parked permanently.

**Unit-level reproduction (deterministic, no GitHub):** in `adws/__tests__/adwUpgrade.test.ts`, assert `buildUpgradePrBody(541, MOCK_HASH)` contains `Closes #541`. Before the fix this assertion **fails** (the body has only `Implements #541`); after the fix it **passes**.

## Root Cause Analysis
- `buildUpgradePrBody()` (`adws/adwUpgrade.tsx`, the array starting at the `Implements #${issueNumber}` line) emits `Implements #N` as the sole issue reference. GitHub treats `Implements` as ordinary prose, creating only a bare cross-reference — never the closing link or the development relationship.
- The behaviour was masked by two **incorrect doc comments** asserting auto-close happens "via the `Implements #<N>` linkage":
  - the file-header JSDoc (the "On success: … the tracking issue auto-closes on merge via the / `Implements #<N>` linkage" sentence), and
  - the `buildUpgradePrBody` JSDoc ("Begins with `Implements #<issueNumber>` so the tracking issue auto-closes on merge …").
  These comments encoded a false belief about GitHub semantics, so the wrong keyword looked intentional and correct.
- The blast radius comes from the dependency model: `findOpenDependencies` (`adws/triggers/issueDependencies.ts`) gates dependent eligibility on `getIssueState(...) === 'OPEN'`. A tracking issue that never closes is a permanent block, so the keyword bug converts cleanly into a permanently-stranded dependent.
- The hand-rolled body diverged from the framework's single correct pattern. The normal SDLC PR path goes through `/pull_request` (`.claude/commands/pull_request.md:25`), which already uses `Closes #N`. `adwUpgrade` is the one path that builds its body in code, and it picked the wrong keyword.

## Relevant Files
Use these files to fix the bug:

- `adws/adwUpgrade.tsx` — **Primary fix.** `buildUpgradePrBody()` must add a `Closes #${issueNumber}` line after the existing `Implements #${issueNumber}` line. The file-header JSDoc (the "auto-closes on merge via the `Implements #<N>` linkage" sentence) and the `buildUpgradePrBody` JSDoc both make the same false claim and must be corrected. `buildUpgradePrBody` has exactly one production consumer (the `createPullRequest({ ..., body: buildUpgradePrBody(issueNumber, hash) })` call in `executeUpgrade`), so the change is fully contained.
- `adws/__tests__/adwUpgrade.test.ts` — **Test changes.** Keep the two existing `Implements #541` assertions (the `buildUpgradePrBody` `/^Implements #541/` test and the `executeUpgrade` "creates PR with Implements #<issueNumber> in body" `/Implements #541/` test). Add sibling assertions that the body also contains `Closes #541` in both places. No existing assertion checks the body's second line or whole-body equality, so the added `Closes` line breaks nothing.
- `adws/github/linkedPrDetector.ts` — **Read-only context (do not modify).** `hasLinkedMergedOrClosedPR` scans PR bodies with the regex `Implements #<issueNumber>(?!\d)`. This is exactly why the fix is additive: the `Implements #N` line must remain so this backstop keeps working. Confirms the additive approach is correct.
- `.claude/commands/pull_request.md` — **Read-only context (do not modify).** Line 25 shows the canonical correct pattern (`Closes #<issueNumber>`, with a cross-repo `Closes owner/repo#<issueNumber>` variant only when the issue lives in a different repo). The upgrade fix mirrors the plain same-repo form.
- `adws/triggers/issueDependencies.ts` — **Read-only context (do not modify).** `findOpenDependencies` keys on `getIssueState === 'OPEN'`; this is the mechanism that turns a never-closing tracking issue into a permanently-blocked dependent. Confirms the blast radius and why closing-on-merge matters.
- `adws/phases/upgradeGate.ts` — **Read-only context (do not modify).** Creates the `#UPG` tracking issue against the same target `repoInfo`/`repoId` that `adwUpgrade` later uses to open the PR. Confirms the tracking issue and PR are always same-repo, so plain `Closes #N` (not `Closes owner/repo#N`) is correct.

### Conditional Docs
Per `.adw/conditional_docs.md`, these documents match this task's conditions and should be consulted by the implementer:
- `app_docs/feature-gj381g-adwupgrade-tsx-orche.md` — matches "When working with `adwUpgrade.tsx`, `executeUpgrade`, `UpgradeDeps`, or `buildDefaultUpgradeDeps`" and "the regeneration half of the versioned auto-(re)init system". Primary context for this orchestrator (non-workflow failure-comment semantics, concurrency neutrality, two-commit PR guarantee).
- `app_docs/feature-6ukg3s-1773849789984-fix-pr-default-branch-linking.md` — matches "When modifying issue reference format (`#N` vs `owner/repo#N`) in `pullRequestCreator.ts` or `pull_request.md`". Directly informs the plain-`Closes #N` vs cross-repo-`Closes owner/repo#N` decision made here.

### New Files
None. This is a surgical, two-line-plus-comment change to existing files (plus test additions).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add the `Closes #N` line to `buildUpgradePrBody`
- In `adws/adwUpgrade.tsx`, edit `buildUpgradePrBody()` so the returned array begins with both reference lines, in this order:
  - `` `Implements #${issueNumber}` `` (keep — first line, preserves `linkedPrDetector` backstop and the `/^Implements/` test)
  - `` `Closes #${issueNumber}` `` (new — the closing keyword that auto-closes the tracking issue and creates the linked-PR relationship)
- Leave the existing blank line, "Regenerates the `.adw/` directory …" line, blank line, and `**Framework hash:**` line unchanged after the two reference lines.
- Use the plain `Closes #N` form (not `Closes owner/repo#N`); the tracking issue and PR are always same-repo.

### 2. Correct the misleading doc comments in `adwUpgrade.tsx`
- Fix the file-header JSDoc sentence that currently reads "the tracking issue auto-closes on merge via the `Implements #<N>` linkage" → describe it accurately, e.g. "the tracking issue auto-closes on merge via the `Closes #<N>` keyword in the PR body" (keep the surrounding `.github/adw.yml` / HITL context intact).
- Fix the `buildUpgradePrBody` JSDoc that currently says it "Begins with `Implements #<issueNumber>` so the tracking issue auto-closes on merge and concurrencyGuard recognises the linked PR" → make it accurate: the `Closes #<issueNumber>` line is what auto-closes the tracking issue on merge and creates the linked-PR relationship; the `Implements #<issueNumber>` line is retained as the `linkedPrDetector` (`hasLinkedMergedOrClosedPR`) defense-in-depth backstop so `concurrencyGuard` still recognises a merged PR if auto-close ever silently fails.

### 3. Add `Closes #541` assertions to the unit tests
- In `adws/__tests__/adwUpgrade.test.ts`, inside `describe('buildUpgradePrBody', …)`, keep the existing `expect(body).toMatch(/^Implements #541/)` test and add a sibling test asserting `expect(buildUpgradePrBody(541, MOCK_HASH)).toContain('Closes #541')`.
- Inside `describe('executeUpgrade — success path …', …)`, keep the existing "creates PR with Implements #<issueNumber> in body" test (`expect(call.body).toMatch(/Implements #541/)`) and add a sibling test that runs `executeUpgrade(541, …)` and asserts the captured `createPullRequest` body matches `/Closes #541/`.
- Keep each new test focused on a single assertion (coding guideline: "one reason per function").

### 4. Run the validation commands
- Run every command in the `Validation Commands` section below and confirm all pass with zero regressions (lint, both type checks, the focused `adwUpgrade` test, the full unit suite, and the build).

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Run from the repo root (`/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/bugfix-issue-570-fix-upgrade-pr-closing-keyword`).

- **Reproduce (before the fix — expect RED):** `bunx vitest run adws/__tests__/adwUpgrade.test.ts` — with the new `Closes #541` assertions added but the `buildUpgradePrBody` change not yet applied, the two new assertions fail (body has only `Implements #541`). This demonstrates the bug.
- **Verify (after the fix — expect GREEN):** `bunx vitest run adws/__tests__/adwUpgrade.test.ts` — all `adwUpgrade` tests pass, including the retained `Implements #541` assertions and the new `Closes #541` assertions.
- `bun run lint` — ESLint passes (no new lint errors).
- `bunx tsc --noEmit` — root type check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` type check passes (additional type check from `.adw/commands.md`).
- `bun run test:unit` — full Vitest suite (`vitest run`) passes with zero regressions.
- `bun run build` — TypeScript build (`tsc`) completes with no errors.

## Notes
- `.adw/coding_guidelines.md` is present and applies. The change conforms: it favors clarity over cleverness, keeps `buildUpgradePrBody` a pure function with no new side effects, adds no `any`, introduces no nesting, and corrects documentation to match real behaviour (the guidelines call out keeping docs accurate and removing misleading comments). `adwUpgrade.tsx` stays well under the 300-line file limit.
- **No new libraries required.** Per `.adw/project.md`, the library install command would be `bun add <package>` if one were needed, but this fix is keyword-only and adds nothing.
- **Scope discipline / out of scope** (separate follow-ups per the issue, do not address here):
  - Duplicate spawn of `adwUpgrade` (#567 + #568 both merged) — a `findPRByBranch` TOCTOU race.
  - Non-deterministic / lossy `/adw_init` regeneration (dropped the `## Run E2E Tests` section; concurrent runs disagreed on `vocabulary.md`).
  - Remediating already-merged-but-open upgrade issues (e.g. #566) — handled manually by the operator.
- **Defense-in-depth invariant to preserve:** the `Implements #N` line must remain the first line so `adws/github/linkedPrDetector.ts` (`hasLinkedMergedOrClosedPR`, regex `Implements #<issueNumber>(?!\d)`) continues to detect the merged upgrade PR. Do not replace `Implements` with `Closes`; **add** `Closes`.
- **Same-repo guarantee:** plain `Closes #N` is correct because the `#UPG` tracking issue (created in `upgradeGate.ts`) and the upgrade PR (opened in `adwUpgrade.tsx`) always live in the same target repo. The cross-repo `Closes owner/repo#N` form used by `/pull_request` is unnecessary here.
</content>
</invoke>
