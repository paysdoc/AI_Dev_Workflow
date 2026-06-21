# Patch: Rebase #638 onto post-#639 origin/dev and nest the reuse gate under the bounded-resume cap

## Metadata
adwId: `hxbf7l-feat-resume-in-place`
reviewChangeRequest: `Issue #2: Branch predates the merged #639 bounded-resume cap and will not merge cleanly into the required nesting. The merge-base with origin/dev is e750d84 (#637 merge); #639 (bounded resume cap / human_gated) merged afterward via PR #646 (df16243) and is now on origin/dev, leaving this branch 6 commits behind and lacking #639 entirely. The six #639 files that appear as deletions in 'git diff origin/dev' (resumePolicy.ts, resumePolicy.test.ts, feature-639.feature, feature-639.steps.ts, and two #639 specs) are staleness artifacts — the three-dot diff confirms this branch never touches them — so a normal 3-way merge will not delete them. The real risk is in adws/triggers/takeoverHandler.ts: origin/dev now carries the #639 cap (nextResumeAction/MAX_RESUME_ATTEMPTS import, the escalate_human_gated decision kind, and the human_gated escalation atop the recovery branch at lines 173-184), while HEAD has none of it and independently rewrites the same phase_timeout/retriable recovery branch for the #638 reuse gate. 'git merge-tree' confirms a 3-way conflict in takeoverHandler.ts and its tests. A naive conflict resolution (e.g. accept-ours) would drop #639's money-fire backstop, and the project's required design — the reuse gate must nest UNDER the #639 cap — cannot be expressed in the current branch. Resolution: Rebase the branch onto current origin/dev (post-#639). Resolve the takeoverHandler.ts conflict by nesting recoverViaResumeInPlaceOrReset UNDER the #639 escalate_human_gated cap in the phase_timeout branch: check the resume-attempt bound first (exhausted → write human_gated state + return escalate_human_gated), and only otherwise run the #638 reuse-or-reset gate. Preserve the nextResumeAction/MAX_RESUME_ATTEMPTS import and the escalate_human_gated CandidateDecision member. Then re-run both @adw-638 and @adw-639 scenarios to prove the cap and the gate coexist.`

## Issue Summary
**Original Spec:** `specs/issue-638-adw-hxbf7l-feat-resume-in-place-sdlc_planner-worktree-reuse-gate-resume-in-place.md`

**Issue:** This branch was cut from `e750d84` (the #637 merge) before #639 (the bounded-resume cap / `human_gated` escalation) merged to `origin/dev` via PR #646 (`df16243`). Confirmed live state: `git merge-base HEAD origin/dev` = `e750d84`; `origin/dev` tip = `df16243`. Consequences:
  1. **`takeoverHandler.ts` collides.** `origin/dev` wraps the `phase_timeout` branch in the #639 cap (`nextResumeAction`/`MAX_RESUME_ATTEMPTS` → `escalate_human_gated`, writing `human_gated` state + posting a HITL comment when the bound is reached). HEAD independently rewrites that **same** branch to call the #638 `recoverViaResumeInPlaceOrReset` gate. `git merge-tree origin/dev HEAD` confirms a content conflict in `takeoverHandler.ts`, `takeoverHandler.test.ts`, and `takeoverHandler.integration.test.ts`. Accept-ours would silently delete #639's money-fire backstop; the required design (gate nested **under** the cap) is unexpressible on the current base.
  2. **Six #639 files show as phantom deletions.** `resumePolicy.ts`, `resumePolicy.test.ts`, `feature-639.feature`, `feature-639.steps.ts`, and the two #639 specs appear deleted in the two-dot `git diff origin/dev` only because `origin/dev` added them after the merge-base. The three-dot diff (`git diff origin/dev...`) confirms this branch **never touches** them — they are pure staleness artifacts, not intended deletions.

**Solution:** Rebase the branch onto current `origin/dev` (post-#639), which restores the six #639 files automatically (this branch never modified them, so they replay untouched). Resolve the `takeoverHandler.ts` conflict by **nesting** `recoverViaResumeInPlaceOrReset` (#638) **under** the `escalate_human_gated` cap (#639) inside the `phase_timeout` branch: test the resume-attempt bound first (exhausted → write `human_gated` + return `escalate_human_gated`), and only when within budget increment `resumeAttempts` and run the #638 reuse-or-reset gate. Keep the `abandoned` (`retriable`) branch on the uncapped #638 gate (#639 never capped `abandoned`). Preserve the `nextResumeAction`/`MAX_RESUME_ATTEMPTS` import and the `escalate_human_gated` `CandidateDecision` member (plus the `writeTopLevelState`/`commentOnIssue` deps and `formatHumanGatedComment`/`commentOnIssue` imports the escalation needs). Re-run both `@adw-638` and `@adw-639` scenarios to prove cap and gate coexist.

## Files to Modify
The rebase replays this branch's 5 commits onto `origin/dev`; conflicts surface (all carried by commit `3fd7a7e build-agent`) in exactly these files — resolve them manually:

- `adws/triggers/takeoverHandler.ts` — **primary.** Nest the #638 gate under the #639 cap in the `phase_timeout` branch; merge both sides' imports, `CandidateDecision` union, `TakeoverDeps`, and `buildDefaultTakeoverDeps`.
- `adws/triggers/__tests__/takeoverHandler.test.ts` — merge `makeDeps` to supply **all four** new deps; keep both #639 cap/escalation cases and #638 reuse/reset cases.
- `adws/triggers/__tests__/takeoverHandler.integration.test.ts` — reconcile `makeDeps` (union of #638 probe deps + #639 `writeTopLevelState`/`commentOnIssue`).
- `app_docs/feature-d0hv98-exhaustive-stage-classifier.md` — reconcile the takeover routing rows to describe **both** the cap and the resume-in-place gate; drop the stale "Resume-in-place is out of scope" gotcha.
- `features/per-issue/step_definitions/feature-504.steps.ts` — reconcile (union of both sides' step-def edits; no semantic conflict expected).
- `features/per-issue/step_definitions/feature-636.steps.ts` — reconcile (union of both sides' step-def edits).

**No action (verify only):** the six #639 files (`adws/core/resumePolicy.ts`, `adws/core/__tests__/resumePolicy.test.ts`, `features/per-issue/feature-639.feature`, `features/per-issue/step_definitions/feature-639.steps.ts`, and the two #639 specs) replay from `origin/dev` untouched. `feature-636.feature`/`feature-637.feature` do **not** conflict (`origin/dev` left them unchanged since the merge-base) — this branch's cross-tag edits apply cleanly.

**Out of scope (do NOT fold in):** the working tree's unrelated `M README.md` and command-file (`document.md`/`adw_init.md`) revert hygiene — that is the separate `specs/patch/patch-adw-hxbf7l-feat-resume-in-place-discard-worktree-command-revert.md` patch. Set those changes aside before rebasing; never `git add -A` them into this work.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Pre-flight — confirm target and clean the working tree
- `git fetch origin` then confirm: `git merge-base HEAD origin/dev` prints `e750d84…` and `git rev-parse origin/dev` prints `df16243…` (rebase still required; if the merge-base is already `df16243` the rebase is done — skip to Validation).
- Rebase requires a clean tree. Set aside any non-#638 working-tree changes (the current `M README.md` and the untracked prior patch spec) with `git stash --include-untracked` or by moving them aside. Do **not** carry them into the rebase; command/doc revert hygiene is handled by the separate discard-worktree-command-revert patch.
- Confirm the new patch spec you are authoring (this file) is committed or stashed so it does not block the rebase.

### Step 2: Start the rebase
- `git rebase origin/dev`.
- It replays 5 commits and stops on `3fd7a7e build-agent: feat: add worktreeReuseGate and probe for #638 resume-in-place` with conflicts in the six files listed above. (Spec-only commits `3a43703`/`c74a971` and the cross-tag commit `d2e5ee0` replay cleanly; if `f7aeef3 patch: restore … reverted command/doc files` becomes empty against `origin/dev`, run `git rebase --skip`.)

### Step 3: Resolve `takeoverHandler.ts` — nest the #638 gate UNDER the #639 cap
Take HEAD's (#638) file as the structural base — keep `takeOverWithDerivedStage`, `recoverViaResumeInPlaceOrReset`, the `decideWorktreeReuse`/`WorktreeProbe` and `probeWorktree`/`clearOrphanedIndexLock` imports, and the `probeWorktree`/`clearOrphanedIndexLock` deps — then re-introduce every #639 element:
- **Imports:** add `import { nextResumeAction, MAX_RESUME_ATTEMPTS } from '../core/resumePolicy';`, `import { formatHumanGatedComment } from '../github/workflowCommentsIssue';`, and `import { commentOnIssue } from '../github/githubApi';` alongside the existing `RepoInfo` import.
- **`CandidateDecision`:** preserve the member `| { readonly kind: 'escalate_human_gated'; readonly adwId: string }`.
- **`TakeoverDeps`:** keep #638's `probeWorktree` + `clearOrphanedIndexLock` **and** add #639's `writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;` and `commentOnIssue: (issueNumber: number, body: string, repoInfo: RepoInfo) => void;`.
- **`buildDefaultTakeoverDeps`:** wire all four — keep the probe wirings and add `writeTopLevelState: (adwId, state) => AgentStateManager.writeTopLevelState(adwId, state)` and `commentOnIssue: (issueNumber, body, repoInfo) => commentOnIssue(issueNumber, body, repoInfo)`.
- **`phase_timeout` branch — the nesting (cap first, then gate):**
  ```ts
  if (stage === 'phase_timeout') {
    const attempts = state.resumeAttempts ?? 0;
    if (nextResumeAction(attempts, MAX_RESUME_ATTEMPTS) === 'escalate') {
      d.writeTopLevelState(adwId, { workflowStage: 'human_gated' });
      d.commentOnIssue(
        input.issueNumber,
        formatHumanGatedComment(adwId, attempts, MAX_RESUME_ATTEMPTS),
        input.repoInfo,
      );
      releaseLock();
      return { kind: 'escalate_human_gated', adwId };
    }
    d.writeTopLevelState(adwId, { resumeAttempts: attempts + 1 });
    return recoverViaResumeInPlaceOrReset(d, input, adwId, state); // #638 gate, nested under the #639 cap
  }
  ```
- **`retriable` (abandoned) branch:** leave it as HEAD's `return recoverViaResumeInPlaceOrReset(d, input, adwId, state);` — #639 never capped `abandoned`, so the gate stays uncapped there.
- **Header decision-tree comment:** update the `phase_timeout` row to read "cap automatic resumes (#639): within budget → probe worktree → reuse-in-place if healthy else reset-from-remote → reconcile → take_over_adwId; at cap → escalate_human_gated"; keep the `abandoned` row's resume-in-place description.

### Step 4: Resolve the test conflicts
- `takeoverHandler.test.ts`: merge `makeDeps` so it supplies **all four** new deps — a default healthy `probeWorktree` + `clearOrphanedIndexLock` (from #638) and `writeTopLevelState` + `commentOnIssue` spies (from #639). Keep, side by side:
  - #639 `phase_timeout` cap cases: `resumeAttempts >= MAX_RESUME_ATTEMPTS` → `escalate_human_gated` (state written `human_gated`, `commentOnIssue` called, lock released); `resumeAttempts < MAX` → `writeTopLevelState({ resumeAttempts: attempts + 1 })` then proceeds.
  - #638 reuse/reset cases (now reached only **within budget**): healthy probe → reuse (no `resetWorktree`, `deriveStageFromRemote` called, orphaned lock cleared); unhealthy probe → `resetWorktree` before reconcile.
  - `abandoned` reuse/reset cases (uncapped gate) and the `*_running`/`skip_terminal`/`spawn_fresh`/`defer_live_holder`/`paused` regression blocks — unchanged.
- `takeoverHandler.integration.test.ts`: reconcile `makeDeps` to include the same four deps so the integration harness compiles and exercises both paths.
- `feature-504.steps.ts` / `feature-636.steps.ts`: take the union of both sides' step-def additions (the #638 probe-context wiring + the #639 additions); no behavioral conflict is expected — verify steps still resolve uniquely.

### Step 5: Resolve the doc, then continue the rebase
- `feature-d0hv98-exhaustive-stage-classifier.md`: reconcile the `takeoverHandler.ts` routing rows so they describe **both** features — the #639 `phase_timeout` cap → `escalate_human_gated`, and the #638 resume-in-place gate on `abandoned` and within-budget `phase_timeout`. Remove the now-false "Resume-in-place is out of scope" gotcha.
- `git add` every resolved file, then `git rebase --continue`. Resolve any trivial conflicts on later commits the same way; `git rebase --skip` `f7aeef3` if it is empty against `origin/dev`.

### Step 6: Post-rebase hygiene check
- Confirm the staleness artifacts are gone and the #639 files are present: `git diff --stat origin/dev` must show **no deletions** of `resumePolicy.ts`, `resumePolicy.test.ts`, `feature-639.feature`, `feature-639.steps.ts`, or the two #639 specs.
- Confirm no out-of-scope command/doc revert rode in: `git diff origin/dev -- .claude/commands/ README.md` is empty or benign-additive only (per the recurring "worktree born with dependency reversion" hazard).

## Validation
Execute every command; all must pass with zero regressions.

- `bunx tsc --noEmit` — root typecheck (the merged `CandidateDecision` union + the four `TakeoverDeps` members must compile).
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW typecheck (the `human_gated`/`phase_timeout` stages and `escalate_human_gated` decision resolve; `classifyStage` `never` guard still holds).
- `bun run lint` — no new lint errors.
- `bunx vitest run adws/triggers/__tests__/takeoverHandler.test.ts adws/triggers/__tests__/takeoverHandler.integration.test.ts` — the merged cap + gate cases pass for `abandoned` and `phase_timeout`; regression blocks unchanged.
- `bunx vitest run adws/core/__tests__/resumePolicy.test.ts adws/vcs/__tests__/worktreeReuseGate.test.ts adws/vcs/__tests__/worktreeProbe.test.ts` — the #639 cap unit (restored by the rebase) and the #638 gate/probe units both pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-639"` — all #639 bounded-resume-cap scenarios pass (the cap survives the rebase).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-638"` — all #638 reuse-gate scenarios pass (the gate is reached within budget).
- `bun run test:unit` — full Vitest suite, zero regressions.
- `bun run build` — `tsc` build succeeds.

## Patch Scope
**Lines of code to change:** ~20 substantive source lines in `takeoverHandler.ts` (3 imports, 1 union member, 2 deps + their wiring, the ~12-line nested `phase_timeout` branch, header comment); the remainder is mechanical conflict reconciliation across the two test files, one living doc, and two step-def files — no net-new feature code. History is rewritten (rebase), not a forward commit.
**Risk level:** medium — the rebase rewrites branch history, and the nesting must preserve **both** the #639 money-fire backstop and the #638 gate; an accept-ours/accept-theirs shortcut silently drops one. The change is confined to the takeover decision tree and its tests/docs.
**Testing required:** both unit suites (`takeoverHandler` + `resumePolicy` + worktree gate/probe) green, both BDD tag suites (`@adw-638` and `@adw-639`) green proving cap and gate coexist, and `bun run test:unit` zero-regression; plus the two-dot `git diff origin/dev` showing the six #639 files are no longer phantom-deletions.
