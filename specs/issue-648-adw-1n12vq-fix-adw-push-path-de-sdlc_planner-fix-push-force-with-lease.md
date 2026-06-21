# Bug: ADW push path deadlocks on rewritten/rebased branches (use --force-with-lease)

## Metadata
issueNumber: `648`
adwId: `1n12vq-fix-adw-push-path-de`
issueJson: `{"number":648,"title":"fix: ADW push path deadlocks on rewritten/rebased branches (use --force-with-lease)","body":"## Problem\n\n`adws/vcs/commitOperations.ts` pushes with a plain, non-forcing command:\n\n```\ngit push -u origin \"${branchName}\"\n```\n\nThis has been present since the initial commit (`5c4067c`) and is harmless under ADW's normal append-only model (fresh per-issue branch → forward commits → fast-forward push). But the moment a feature branch's history is **rewritten** (a rebase to clear a stale base, a squash, an amend), local and remote diverge and this push is rejected non-fast-forward. ADW has no force path and no divergence recovery, so the `pr_creating` step fails, the workflow resumes from `pr_creating`, re-attempts the identical plain push, and **loops indefinitely** — burning tokens (one #638 cycle spent ~245K opus tokens) and never opening the PR.\n\nLive incident: issue #638. Its branch was rebased onto post-#639 `dev` (required because #638/#639 edit the same `phase_timeout` recovery region and #639 merged first). The rebase rewrote history; ADW then could never push it. Unblocked manually via `git push --force-with-lease`.\n\n## Proposed fix\n\n- Switch the PR-phase push to `git push --force-with-lease origin \"${branchName}\"`. `--force-with-lease` only overwrites the remote when it still matches ADW's remote-tracking ref, so it recovers a rewritten branch without clobbering work pushed by anything else (degrades to a safe rejection if the remote moved unexpectedly).\n- Ensure the remote-tracking ref is refreshed (fetch) before the lease check so the comparison is against the true remote.\n- Consider: on a genuine lease failure (remote actually moved), surface a distinct, non-looping error instead of resuming `pr_creating` into the same push.\n\n## Acceptance criteria\n\n- [ ] A feature branch whose history was rewritten (rebase/squash/amend) pushes successfully instead of deadlocking\n- [ ] A normal append-only branch still pushes (no behavior change)\n- [ ] A true lease failure (remote moved underneath us) does NOT enter an infinite `pr_creating` resume loop\n- [ ] Unit/integration coverage for the rewritten-branch push path\n\n## Blocked by\n\nNone - can start immediately\n\n## Notes\n\nFoundational assumption (append-only branch history) inherited from the original codebase; surfaced the first time a branch was rebased. See also the companion issue on serializing region-colliding slices, which removes the *cause* (the forced rebase) while this removes the *symptom*.","state":"OPEN","author":"paysdoc","labels":["hitl","adw:bug"],"createdAt":"2026-06-20T18:11:58Z","comments":[],"actionableComment":null}`

## Bug Description
ADW's shared branch-push helper, `pushBranch()` in `adws/vcs/commitOperations.ts:60`, pushes with a plain, non-forcing command:

```
git push -u origin "${branchName}"
```

Present since the initial commit (`5c4067c`). It is harmless under ADW's normal **append-only** model: a fresh per-issue branch only ever gains forward commits, so every push is a fast-forward and succeeds.

**Symptom:** the first time a feature branch's history is **rewritten** (a rebase to clear a stale base, a squash, or an amend), the local branch and the remote branch diverge. A plain `git push` of a diverged branch is rejected non-fast-forward:

```
 ! [rejected]        <branch> -> <branch> (non-fast-forward)
error: failed to push some refs to 'origin'
```

`pushBranch()` has no force path and no divergence recovery, so the call throws. In the PR phase (`executePRPhase` → `pushBranch`, `adws/phases/prPhase.ts:75`) the throw fails the `pr_creating` stage. The workflow then resumes from `pr_creating` (cron/webhook re-spawn), re-runs `executePRPhase`, re-attempts the **identical** plain push, and fails again — an effectively endless `pr_creating` resume loop that burns tokens (one #638 cycle spent ~245K Opus tokens) and never opens the PR.

**Expected behavior:** a branch whose history was legitimately rewritten by/around ADW should push (recover) automatically; a normal append-only branch should push exactly as before; and a *genuine* divergence (the remote actually moved underneath us, with commits we have not seen) should fail with a single, distinct, actionable error rather than spinning.

**Actual behavior:** rewritten branch → non-fast-forward rejection → `pr_creating` fails → resume → same rejection → loop (bounded only by the #639 resume cap that eventually parks the workflow in `human_gated` after `MAX_RESUME_ATTEMPTS`, with a cryptic git error and no PR).

Live incident: issue #638 (2026-06-19/20), unblocked manually with `git fetch` + `git push --force-with-lease`.

## Problem Statement
`pushBranch()` cannot push a feature branch whose history has been rewritten, because it uses a plain non-forcing `git push`. Every ADW phase that publishes a feature branch routes through this single helper (`prPhase`, `documentPhase`, `reviewPhase`, `scenarioFixPhase`, `prReviewPhase`), so the moment any of them encounters a rewritten branch the push is rejected, the owning stage fails, and the workflow resumes into the same failing push — a token-burning deadlock that produces no PR.

## Solution Statement
Make the single shared `pushBranch()` helper recover a rewritten branch safely, while keeping append-only pushes unchanged and refusing a genuine divergence loudly (once):

1. **Refresh the remote-tracking ref first.** `git fetch origin "<branch>"` before the push so the lease compares against the *true* current remote. Tolerate failure (a brand-new branch has no remote ref to fetch).
2. **Push with `--force-with-lease --force-if-includes`** instead of a plain push.
   - `--force-with-lease` overwrites the remote only when it still matches our remote-tracking ref, so a branch ADW rewrote (remote unchanged) is recovered, while unrelated work is never blindly clobbered.
   - `--force-if-includes` (git ≥ 2.30; runner has 2.50.1) is **required** to keep the lease meaningful *after* the fetch: a bare `--force-with-lease` would lease against the just-fetched ref and therefore always succeed (defeating the safety the fetch was meant to preserve). `--force-if-includes` additionally requires that the fetched remote tip is already present in our local history (reflog) before allowing the overwrite. This is exactly the combination that satisfies all three behavioral criteria together.
3. **Distinct, non-looping error on a genuine lease failure.** When the push is rejected because the remote genuinely moved (markers `stale info` / `remote ref updated since checkout`), throw a clearly-worded terminal error that names the divergence, says *do not auto-resume*, and gives the manual remedy — instead of letting an opaque git error propagate. The cross-process `pr_creating` resume is already bounded by the existing #639 cap (`nextResumeAction` / `MAX_RESUME_ATTEMPTS = 3` → escalate to `human_gated`), so combining "common case now succeeds" + "genuine failure throws a distinct terminal error" + "pre-existing bounded cap" means a true lease failure can no longer spin and is now diagnosable.

Because every feature-branch push funnels through this one function, fixing `pushBranch()` fixes all callers (PR, document, review, scenario-fix, PR-review) centrally and surgically — no call-site changes, no signature changes, no orchestrator/resume-machinery changes.

## Steps to Reproduce
The deadlock requires real git, so reproduce against a throwaway bare remote (this is exactly what the new integration test automates):

1. Create a bare remote and a working clone in temp dirs; `git init`, set `user.name`/`user.email`.
2. On a feature branch, commit file A and push it (`git push -u origin <branch>`) — succeeds (append-only, fast-forward).
3. Rewrite history: `git commit --amend -m "rewrite"` (or a rebase) so the local tip no longer descends from the pushed tip.
4. Re-run the **current** `pushBranch()` behavior (`git push -u origin <branch>`) → observe `! [rejected] ... (non-fast-forward)` and a thrown error. In the live workflow this is the `pr_creating` failure that then resumes into the same push (the loop).
5. Apply the fix and repeat step 4 with the new `pushBranch()` → the push **succeeds** and the remote tip equals the rewritten local tip.
6. Genuine-divergence check: from a second clone, push an unrelated commit to the same remote branch; in the first clone rewrite again and run the fixed `pushBranch()` → it **throws a distinct lease error** and the remote is left untouched (the other commit is preserved).

## Root Cause Analysis
- **Direct cause:** `pushBranch()` (`adws/vcs/commitOperations.ts:60-63`) uses `git push -u origin "<branch>"` with no force/lease and no fetch. A plain push of a diverged ref is rejected non-fast-forward, so any history rewrite breaks the push.
- **Foundational assumption:** ADW was built append-only — fresh per-issue branch, forward-only commits, history never rewritten — so a plain push was always sufficient. No ADW code path rewrites a feature branch on its own (only `@deprecated` `pull --rebase` helpers and rebase-*abort* cleanup exist), so the gap stayed latent from `5c4067c` until a branch was rebased.
- **Trigger (#638):** #638 and #639 were sliced as parallel siblings but both edit the same `phase_timeout` recovery region. #639 merged first, so #638 had to be rebased onto post-#639 `dev` to pick up the cap — rewriting #638's history. ADW then could not push it.
- **Amplifier (the loop):** `pushBranch()` throws raw via `execSync` (it does **not** use `execWithRetry`, so `NON_RETRYABLE_PATTERNS` never apply). The throw fails `pr_creating`; the orchestrator exits; cron/webhook resumes from `pr_creating`; `executePRPhase` re-runs the identical plain push; it fails identically — an indefinite loop, bounded only later by the #639 resume cap (which parks it in `human_gated` after 3 attempts with an unhelpful error). The result: tokens burned, no PR.
- **Why `--force-with-lease` is the right symptom fix:** for ADW's single-writer per-issue branches, after a local rewrite the remote still equals what ADW last pushed, so the lease matches and the push recovers; if some other writer genuinely moved the remote, the lease (plus `--force-if-includes`) refuses, protecting that work. (The companion issue #649 removes the *cause* by serializing region-colliding slices so the forced rebase never happens; #648 removes the *symptom*.)

## Relevant Files
Use these files to fix the bug:

- `adws/vcs/commitOperations.ts` — **primary change.** `pushBranch()` (lines 60-63) is the single shared push helper; replace the plain push with fetch + `--force-with-lease --force-if-includes` and add the lease-failure detection + distinct terminal error. Add a small private `isLeaseRejection(error)` helper here.
- `adws/vcs/__tests__/commitOperations.test.ts` — **add tests.** Existing file already follows the `vi.mock('child_process')` + `vi.mocked(execSync)` command-construction pattern (currently covers `getHeadTreeHash`/`hasUncommittedChanges`); add a `describe('pushBranch')` block asserting fetch+push command form, first-push tolerance, lease-failure → distinct error, and non-lease error → rethrow.
- `adws/phases/prPhase.ts` — **context only (no change).** `executePRPhase` calls `pushBranch(currentBranch, worktreePath)` at line 75 inside the `pr_creating`/`pr_created` stage; this is the deadlocking call site. Confirms the fix needs no call-site edit.
- `adws/core/utils.ts` — **context only (no change).** Houses `execWithRetry` and `NON_RETRYABLE_PATTERNS`. Documents that `pushBranch` uses raw `execSync` (not `execWithRetry`), so the loop is a cross-process resume loop, not an in-process retry — i.e., the fix belongs in `pushBranch`, not in the retry list.
- `adws/core/resumePolicy.ts` — **context only (no change).** `nextResumeAction` / `MAX_RESUME_ATTEMPTS = 3` (#639) already bounds any resumable stage (incl. `pr_creating`) and escalates to `human_gated`. Confirms the "infinite loop" backstop already exists; this fix removes the loop's cause and makes the failure distinct.
- `adws/phases/{documentPhase,reviewPhase,scenarioFixPhase,prReviewPhase}.ts` — **context only (no change).** Other callers of the shared `pushBranch`; all benefit from the central fix and none need editing (verified: each either pushes append-only or, for PR-review, gains correct refusal of a concurrently-moved PR branch).

### New Files
- `adws/vcs/__tests__/pushBranch.integration.test.ts` — real-git integration test (temp dirs + a local **bare** remote, no network) proving the three behavioral acceptance criteria end-to-end: (A) append-only push still works, (B) a rewritten branch (amend/rebase) pushes successfully, (C) a genuinely-moved remote causes a distinct thrown error and is left un-clobbered. Command-construction unit mocks cannot prove real force-with-lease behavior, so this file is the faithful coverage the acceptance criteria call for. Picked up automatically by `vitest run`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Implement the fix in `pushBranch()`
- In `adws/vcs/commitOperations.ts`, replace the body of `pushBranch(branchName, cwd?)`:
  - First, refresh the remote-tracking ref inside a `try/catch`: `execSync(\`git fetch origin "${branchName}"\`, { stdio: 'pipe', cwd })`. Swallow any error in the catch with a comment that a first push has no remote ref to fetch (mirror the existing fetch style used in `adws/triggers/autoMergeHandler.ts:124`).
  - Then push with lease inside a `try/catch`: `execSync(\`git push --force-with-lease --force-if-includes -u origin "${branchName}"\`, { stdio: 'pipe', cwd })`.
  - In the catch, if `isLeaseRejection(error)` is true, `throw new Error(...)` with a distinct, actionable message that: names the branch, states the remote moved underneath ADW / has unseen commits, says it needs manual review and must **not** auto-resume into the same push, gives the remedy (`git fetch && git log origin/<branch>` then manual push if local is correct), and appends the original error. Otherwise `throw error` (rethrow unchanged).
  - Keep the existing `log('Pushed branch to origin', 'success')` on success.
- Add a private helper `isLeaseRejection(error: unknown): boolean` in the same file that concatenates `error.stderr`, `error.stdout`, and `error.message` (each null-guarded and `String()`-coerced — `execSync` with `stdio:'pipe'` puts git's text on `.stderr`, not always in `.message`) and returns true if it contains `'stale info'` or `'remote ref updated since checkout'`. Keep the markers narrow so other rejections (hooks, protected branch) are rethrown as-is rather than mislabeled.
- Update the JSDoc on `pushBranch` to explain the fetch + `--force-with-lease --force-if-includes` rationale and the distinct-error behavior. Honor the coding guidelines (guard clauses, max ~2 nesting, immutability, type safety — no `any`; type the caught error via a narrow local shape).

### 2. Add unit tests (command construction + error classification)
- In `adws/vcs/__tests__/commitOperations.test.ts`, import `pushBranch` and add a `describe('pushBranch')` block using the existing `mockExecSync` pattern:
  - **append-only / happy path:** both calls succeed; assert call 1 is `git fetch origin "feature-x"` and call 2 is `git push --force-with-lease --force-if-includes -u origin "feature-x"`, each with `{ stdio: 'pipe', cwd }` and the provided `cwd` (and `cwd: undefined` when omitted).
  - **recovery form:** assert the push command string includes `--force-with-lease` (the mechanism that recovers a rewritten branch where a plain push would have failed).
  - **first push (no remote ref):** make the fetch (call 1) throw; assert the push (call 2) is still attempted and `pushBranch` resolves without throwing.
  - **genuine lease failure:** make the push throw an error whose `.stderr` contains `"... ! [rejected] (stale info)"`; assert `pushBranch` throws and the thrown message contains a distinct marker (e.g. `force-with-lease` / `moved underneath` / `manual`). Repeat once with `remote ref updated since checkout` to cover `--force-if-includes`.
  - **non-lease error:** make the push throw a generic error (e.g. `fatal: unable to access ... Could not resolve host`); assert `pushBranch` rethrows it and the message does **not** contain the lease wording.

### 3. Add the real-git integration test
- Create `adws/vcs/__tests__/pushBranch.integration.test.ts`:
  - Use `node:fs` (`mkdtempSync`), `node:os` (`tmpdir`), `node:path`, and real `execSync` git. In `beforeEach`, create a temp **bare** remote (`git init --bare`) and a working clone; configure `user.name`/`user.email` and a deterministic initial branch; make an initial commit and `git push -u`. In `afterEach`, `rmSync(..., { recursive: true, force: true })` all temp dirs.
  - **Scenario A (append-only):** add a commit, call `pushBranch(branch, workdir)`, assert `git rev-parse origin/<branch>` (in a fresh fetch) equals the local tip.
  - **Scenario B (rewritten history):** after the initial push, `git commit --amend` (history rewrite), call `pushBranch(...)`, assert it does **not** throw and the remote tip now equals the amended local tip. (This is the bug: the old plain push throws here.)
  - **Scenario C (genuine divergence):** clone the bare remote into a second workdir, push an unrelated commit to the same branch from there; back in the first clone rewrite again and call `pushBranch(...)`; assert it **throws** with the distinct lease message and that the remote branch tip is unchanged (still the second clone's commit — not clobbered).
  - Keep it hermetic (local bare remote, no network) and fast.

### 4. Self-review against guidelines and scope
- Confirm no other call site or signature changed; confirm the dependent tests that mock `pushBranch` (`adws/phases/__tests__/reviewPhase.test.ts`, `adws/__tests__/adwUpgrade.test.ts`, `adws/promotion/__tests__/promotionMover.test.ts`) are unaffected (they replace `pushBranch` with `vi.fn()`, so the added `git fetch` never runs in them).
- Confirm `adws/adwUpgrade.tsx`'s separate claim-branch push (injected `pushBranch` dep with its own non-fast-forward "park as loser" handling) is intentionally left untouched — different semantics (orchestrator claim race), out of scope.
- Verify the change reads like the surrounding code (raw `execSync`, `stdio: 'pipe'`, `log(...)` on success) and stays within `commitOperations.ts`'s single responsibility.

### 5. Run the Validation Commands
- Run every command in **Validation Commands** and ensure all pass with zero regressions (lint, both type checks, build, full unit suite incl. the new tests).

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Run from the repo root (`/Users/martin/projects/paysdoc/AI_Dev_Workflow/.worktrees/bugfix-issue-648-fix-push-force-with-lease`). Commands are taken from `.adw/commands.md`.

- `bun run lint` — ESLint (`eslint .`); no new lint errors.
- `bun run test` — type check (`bunx tsc --noEmit`); no type errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — additional ADW type check; no type errors.
- `bun run build` — build (`tsc`); compiles cleanly.
- `bunx vitest run adws/vcs/__tests__/commitOperations.test.ts` — the new `pushBranch` unit tests pass (and existing ones still pass).
- `bunx vitest run adws/vcs/__tests__/pushBranch.integration.test.ts` — the real-git integration test passes; **this is the before/after reproduction**: Scenario B (rewritten branch pushes) and Scenario C (genuine divergence throws distinct error, remote un-clobbered) would both fail against the old plain-push implementation and pass after the fix.
- `bun run test:unit` — full unit suite (`vitest run`); all tests pass, zero regressions.

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): adhere strictly — clarity over cleverness, single responsibility (keep the change inside `commitOperations.ts`), guard clauses / max ~2 nesting (use early `throw`/`return` in the catch), immutability, type safety (no `any`; type the caught error via a narrow local shape, e.g. `{ stderr?: unknown; stdout?: unknown; message?: unknown }`), and isolate the side effect (the `execSync` calls) at this boundary.
- **No new libraries.** Uses only `child_process.execSync` (already imported) and, in the integration test, Node's built-in `fs`/`os`/`path`. If any dependency were ever needed, the install command per `.adw/commands.md` is `bun add <package>` — not required here.
- **Git version dependency:** `--force-if-includes` requires git ≥ 2.30 (released Dec 2020); the runner has 2.50.1. This is well within range; noting it because it is load-bearing for acceptance criterion 3.
- **Why fetch + `--force-if-includes` together (not one or the other):** the issue asks for both a fetch-before-lease *and* detection of a genuine lease failure. A fetch followed by a *bare* `--force-with-lease` would lease against the just-fetched ref and always succeed, silently clobbering a moved remote — so the genuine-failure criterion could never be met. `--force-if-includes` restores that safety by also requiring the fetched remote tip to be in our local history. This is the only combination that satisfies all three behavioral criteria simultaneously.
- **Known safe-degradation edge case:** if a rewrite happened in a *different* worktree/clone than the one running `pushBranch` (so the remote tip is not in this worktree's reflog), `--force-if-includes` will refuse and emit the distinct lease error, requiring a manual push. This is a safe failure (it never clobbers), and it does not match the documented #638 incident, which rewrote and resumed in the *same* worktree (auto-recovery works there).
- **Loop scope (criterion 3):** this fix removes the loop's *cause* for the recoverable case and makes the genuine-failure case throw a distinct terminal error. The cross-process `pr_creating` resume loop itself is already bounded by the #639 cap (`adws/core/resumePolicy.ts`, `MAX_RESUME_ATTEMPTS = 3` → `human_gated`); intentionally **not** modifying that machinery keeps this fix surgical.
- **Centralized fix:** every feature-branch push (PR, document, review, scenario-fix, PR-review) routes through the single `pushBranch`, so the one-function change covers them all without touching call sites. `adws/adwUpgrade.tsx`'s claim-branch push is a separate injected path with its own non-fast-forward handling and is deliberately out of scope.
- **Related companion issue:** #649 (serialize region-colliding slices) removes the *cause* (the forced rebase); #648 (this) removes the *symptom* (the deadlock). Both can land independently.
- **Conditional docs:** `.adw/conditional_docs.md` lists related-but-absent docs for this area (e.g. `feature-qej3f4-novelty-progress-gate` for `commitOperations.ts`, `feature-7sunv4-fix-pr-routing-and-status` for `prPhase.ts`, `feature-k5dh22-fix-merge-conflict-detection` for HEAD-behind-origin/external-push, `feature-zyjh0z-move-pr-approval-int` for `NON_RETRYABLE_PATTERNS`). None of these files are present in this worktree's `app_docs/`, so they are not listed as Relevant Files; named here only for context.
