# Bug: adwUpgrade never regenerates `.adw/`, bricks the upgrade gate, and skill/command propagation is dead

## Metadata
issueNumber: `572`
adwId: `t6m62c-fix-adwupgrade-regen`
issueJson: `{"number":572,"title":"Fix adwUpgrade: regenerate .adw/, gate the version stamp, and restore skill/command propagation","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-14T13:38:48Z"}`

## Bug Description

`adwUpgrade.tsx` is the single-purpose orchestrator that is supposed to regenerate a target repo's `.adw/` directory whenever the framework content hash drifts (the versioned auto-(re)init system). It does not.

On every upgrade it runs `/adw_init` via the Claude CLI in a worktree that has **no `adw_init.md` command file**, so the slash command cannot expand and the agent no-ops. `runClaudeAgentWithCommand` still returns `success: true` (success means "CLI exited 0", not "`.adw/` was written"). The orchestrator then unconditionally:

1. writes the current framework hash to `.adw-version` (`writeAdwVersion`), and
2. commits (`git add -A` finds only `.adw-version`), pushes, opens a PR, and auto-merges.

**Expected:** the upgrade PR diff contains a freshly populated `.adw/` (all six canonical files) plus `features/regression/vocabulary.md` and the `.adw-version` stamp.

**Actual:** the PR contains only a `.adw-version` bump. Worse, because `.adw-version` now equals the current framework hash, the init-time `upgradeGate` (`shouldTriggerUpgrade` → `storedVersion !== currentHash`) sees a permanent match and never re-triggers. The target repo is **permanently bricked**: no `.adw/`, no retrigger, no self-heal. A virgin target repo (e.g. `vestmatic-research`) ends up with `.adw/` never created at all.

Two adjacent regressions were found while diagnosing:

1. **Skill/command propagation is dead code.** `copyTargetSkillsAndCommands()` (whole-dir skill copy + `target: true` command copy, overwriting) was only ever called by `adwInit.tsx`, which the upgrade PRD deleted (#547). It now has **zero live call sites** — confirmed by `git grep`. New targets bootstrapped via the upgrade path get **no skills**; existing targets never refresh skills. The live helper `copyClaudeCommandsToWorktree()` copies commands only, copy-if-absent, gitignoring non-`target` ones — it provides run-availability, not propagation.
2. **`/refactor` depends on host-global `~/.claude`.** `refactorAgent` invokes the `/refactor` skill with `cwd = worktree` (`adws/agents/refactorAgent.ts`), but `refactor/SKILL.md` has no `target:` field (→ `target: false`) and nothing live copies any skill into a worktree. `/refactor` therefore only resolves if the ADW host happens to have it installed globally.

**Additionally discovered during research (must be fixed first — it blocks everything):** the current HEAD of `origin/dev` (`d50cdbd "add wontfix escape hatch to upgrade guard"`) committed an **unresolved `git stash pop`**. `adws/adwUpgrade.tsx` (lines 47–50, 201–228) and `adws/__tests__/adwUpgrade.test.ts` (lines 91–92, 140) contain literal `<<<<<<< Updated upstream` / `=======` / `>>>>>>> Stashed changes` markers. `bunx tsc --noEmit -p adws/tsconfig.json` fails with 9 `TS1185: Merge conflict marker encountered` errors. The "Stashed changes" side is the **idempotency / wontfix guard** that this issue's gate (Plan §B) explicitly relies on for the self-healing retry, but the `UpgradeDeps.findPRByBranch` field it needs was never wired in. The codebase does not compile until this is resolved.

## Problem Statement

Three defects plus one acute breakage must be resolved together because they all live in `adwUpgrade.tsx` / `UpgradeDeps` and the `workflowInit` worktree-setup path:

1. **(Build breakage)** Committed merge-conflict markers make the tree non-compiling. The half-applied feature (claim-branch PR idempotency guard + `wontfix` escape hatch) must be completed, not discarded — Plan §B depends on it.
2. **(A) `/adw_init` cannot resolve** in the upgrade worktree because no `adw_init.md` is present there.
3. **(B) No verification gate** between the LLM run and the `.adw-version` stamp: a no-op regen is treated as success and bricks the repo.
4. **(D) Propagation is dead**: skills are never copied to/refreshed in target repos, and `target: false` skills like `/refactor` are unavailable in worktrees.

## Solution Statement

Surgical, layered fix, foundational changes first:

- **§0 (foundation):** Resolve the committed conflict by keeping the "Stashed changes" idempotency/wontfix guard and wiring `findPRByBranch` (default: `defaultFindPRByBranch` from `prApi.ts`, already exported) into `UpgradeDeps` and the default factory, and into the test `makeDeps`. Restores compilation.
- **§A:** In `executeUpgrade`, **before** `runInitCommand`, force-copy the framework's current `adw_init.md` into the worktree's `.claude/commands/` (overwrite) and **gitignore** it so `commitChanges`' `git add -A` keeps it out of the PR. Injected as a new dep for testability and call-order assertion.
- **§B:** After `runInitCommand` succeeds, **verify before stamping**: the six canonical `.adw/` files exist non-empty, `features/regression/vocabulary.md` exists, and there is a non-trivial git change under `.adw/`. Move `writeAdwVersion` strictly behind this gate. On failure: post the existing non-workflow failure comment, write no stamp, open no PR, return `failed`. The next cron tick re-dispatches; the idempotency guard from §0 sees no PR on the claim branch and safely re-runs regen → self-healing retry.
- **§D:** Replace `copyClaudeCommandsToWorktree` + `copyTargetSkillsAndCommands` with **one merged function** that copies **all** commands and **all** skills into the worktree, **always overwriting**; gitignore the `target: false` class (availability only) while leaving the `target: true` class committable (refresh + propagation), preserving the #267 invariant of never gitignoring an already-tracked file. Wire it into both `workflowInit` call sites; delete both old functions and update every re-export and the test mock. **Not** added to `adwUpgrade` (skill refresh on upgrade is deliberately out of scope; the §A copy is a bespoke `adw_init.md`-only copy).
- **§C:** Document the one-time manual recovery of already-bricked repos (no executable code in this PR).
- **§E:** Unit tests E1–E4 via dependency injection, plus the restored idempotency-guard tests.

## Steps to Reproduce

1. `bunx tsc --noEmit -p adws/tsconfig.json` → currently fails with `TS1185: Merge conflict marker encountered` (9 errors). This blocks all other validation.
2. Conceptual end-to-end (post-conflict-resolution, pre-fix): run `adwUpgrade.tsx` against a target repo whose worktree has no `.claude/commands/adw_init.md`. `/adw_init` no-ops, `runClaudeAgentWithCommand` returns `success: true`, `.adw/` is never written, yet `.adw-version` is stamped, a `.adw-version`-only PR is opened and merged. The init-time gate then sees a hash match forever (repo bricked).
3. Inspect `git grep -n "copyTargetSkillsAndCommands"` → only re-exports and a test mock; **no live caller** → skills are never propagated.

## Root Cause Analysis

- **Brick:** `adwUpgrade.tsx` is on the `initializeWorkflow()` exception list, so it never runs `copyClaudeCommandsToWorktree()` — the only live helper that places `adw_init.md` into a worktree (`workflowInit.ts:200,222`). Step 4 of `executeUpgrade` then hands `/adw_init …` to a worktree with no such command file. Success is measured as exit code, not as "`.adw/` written", and the `.adw-version` write + commit + PR are unconditional. There is no gate distinguishing "regenerated" from "no-op".
- **Faithful-but-incomplete PRD implementation:** `specs/prd/adw-init-hash-and-label-classification.md` intended `/adw_init` to run in the worktree (line 83) and commit the regenerated `.adw/` (line 85), but described worktree setup only as "minimal" and explicitly waived real testing of `adwUpgrade.tsx` ("Integration-level smoke testing only", line 168). The command-file invocability gap fell through that waiver.
- **Dead propagation:** the PRD deleted `adwInit.tsx` on the promise that "its responsibilities are absorbed by `adwUpgrade.tsx`" (PRD line 30, 88), but the absorption never moved `copyTargetSkillsAndCommands()` anywhere live, leaving it orphaned (#267's mechanism with no caller).
- **Acute breakage:** an unresolved `git stash pop` was committed in `d50cdbd`, leaving conflict markers in `adwUpgrade.tsx` and its test, and a half-wired `findPRByBranch` dep.

## Relevant Files

Use these files to fix the bug:

- `adws/adwUpgrade.tsx` — **primary.** Resolve the conflict markers (§0); add §A copy-before-init step and §B verification gate to `executeUpgrade`; extend `UpgradeDeps` with `findPRByBranch`, `copyInitCommandToWorktree`, `verifyAdwRegen`; wire them in `buildDefaultUpgradeDeps`.
- `adws/__tests__/adwUpgrade.test.ts` — **primary.** Resolve the conflict markers (restore the idempotency-guard `describe`); update `makeDeps` defaults for the three new deps; add E1–E3 tests.
- `adws/github/prApi.ts` — source of the already-exported `defaultFindPRByBranch`, `hasWontFixLabel`, `RawPR` used by the restored idempotency guard. No change expected; referenced for the §0 resolution.
- `adws/phases/worktreeSetup.ts` — **primary.** Add the bespoke `adw_init.md`-only copy helper (§A default impl) and the merged `copyClaudeAssetsToWorktree` (§D); delete `copyClaudeCommandsToWorktree` and `copyTargetSkillsAndCommands`. Reuse existing `parseFrontmatterTarget`, `copyDirContents`, `ensureGitignoreEntry(s)`, and the `git ls-files` tracked-detection pattern.
- `adws/phases/workflowInit.ts` — replace the two `copyClaudeCommandsToWorktree(worktreePath)` call sites (lines 200, 222) with the merged function; fix the import (line 54) and the re-export (line 61).
- `adws/phases/index.ts` — update the re-export (line 12) to the merged function name; drop the deleted names.
- `adws/workflowPhases.ts` — drop the now-dead `copyTargetSkillsAndCommands` re-export (line 16).
- `adws/phases/__tests__/workflowInit.test.ts` — update the `vi.mock('../worktreeSetup', …)` surface (lines 69–74) to the merged function name so `initializeWorkflow` import resolves; the determinism assertions are unaffected.
- `adws/vcs/commitOperations.ts` — reference for `commitChanges` (`git add -A`) and the `git status --porcelain -- <pathspec>` idiom reused by §B's diff check. No change expected (read-only reference).
- `adws/phases/upgradeGate.ts` — reference: `shouldTriggerUpgrade` (the gate the brick defeats) and `writeAdwVersion`/`readAdwVersion` semantics. Explains why a bad stamp is permanent. No change expected.
- `.claude/commands/adw_init.md` — reference: confirms `/adw_init` writes the six `.adw/` files + `features/regression/vocabulary.md` (the §B verification list). No change expected.
- `adws/agents/refactorAgent.ts` — reference: demonstrates `/refactor` invoked with `cwd = worktree`, the dependency §D removes. No change expected.
- `adws/known_issues.md` — append the §C one-time recovery runbook for already-bricked repos.

Conditional docs (matched against this task's conditions in `.adw/conditional_docs.md`):

- `app_docs/feature-n9880l-adwversion-read-write-module.md` — `readAdwVersion`/`writeAdwVersion` and the versioned auto-(re)init system; §B moves the `writeAdwVersion` call behind the gate.
- `app_docs/feature-6zw7n2-hitl-opt-in-adw-yml.md` — `adwUpgrade.tsx`'s gated merge step; §A/§B insert steps ahead of the merge logic this doc covers.
- `app_docs/feature-sgud8b-copy-target-skills-adw-init.md` (#267) — the `target:`-flag propagation design that §D revives; documents `parseFrontmatterTarget`, `copyDirContents`, overwrite semantics, the flat (no-nested-subdir) skill copy, and the gitignore-skip-if-tracked invariant.

### New Files

- `adws/phases/__tests__/worktreeSetup.test.ts` — fixture test for the merged copy function (E4): correct files land, `target: false` are gitignored, `target: true` are committable, already-tracked files are not re-gitignored.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Resolve the committed merge-conflict markers (restore the idempotency/wontfix guard) — FOUNDATION
- In `adws/adwUpgrade.tsx`, conflict 1 (lines 47–50): keep the "Stashed changes" import — `import { defaultFindPRByBranch, hasWontFixLabel, type RawPR } from './github/prApi';`.
- In `adws/adwUpgrade.tsx`, conflict 2 (lines 201–228): keep the "Stashed changes" idempotency-guard block that runs right after `buildClaimBranchName(hash)`: `const existingClaimPr = deps.findPRByBranch(branch, repoInfo);` → if it exists and `hasWontFixLabel(existingClaimPr)` log "rebuilding" and fall through; else if it exists, log and `return { outcome: 'completed', reason: 'pr_already_exists' }`.
- Extend the `UpgradeDeps` interface with `readonly findPRByBranch: (branch: string, repoInfo: RepoInfo) => RawPR | null;`.
- In `buildDefaultUpgradeDeps`, add `findPRByBranch: (branch, info) => defaultFindPRByBranch(branch, info),`.
- In `adws/__tests__/adwUpgrade.test.ts`, conflict at lines 91–92/140: keep the "Stashed changes" `describe('executeUpgrade — idempotency guard (existing claim-branch PR)', …)` block.
- Verify no markers remain: `git grep -nE '^(<<<<<<<|=======|>>>>>>>)$'` returns nothing.

### 2. (§A) Add the bespoke `adw_init.md`-only copy helper
- In `adws/phases/worktreeSetup.ts`, add `export function copyAdwInitCommandToWorktree(worktreePath: string, frameworkRepoRoot: string): void` that copies `<frameworkRepoRoot>/.claude/commands/adw_init.md` → `<worktreePath>/.claude/commands/adw_init.md` (mkdir `-p` dest dir, `copyFileSync` overwrite), then `ensureGitignoreEntry(worktreePath, '.claude/commands/adw_init.md')`.
- This is intentionally **separate** from the §D merged function (which would commit skills and violate the tight upgrade-PR scope).

### 3. (§A) Wire the copy step into `executeUpgrade` before `runInitCommand`
- Add `readonly copyInitCommandToWorktree: (worktreePath: string, frameworkRepoRoot: string) => void;` to `UpgradeDeps`.
- In `buildDefaultUpgradeDeps`, set `copyInitCommandToWorktree: copyAdwInitCommandToWorktree`.
- In `executeUpgrade`, immediately after `ensureWorktree` succeeds and **before** `deps.runInitCommand(...)`, call `deps.copyInitCommandToWorktree(worktreePath, frameworkRepoRoot)`.

### 4. (§B) Add the anti-brick verification gate
- In `adws/phases/worktreeSetup.ts` (or a small new `adws/phases/upgradeVerify.ts`), add:
  - An exported constant `REQUIRED_ADW_FILES = ['commands.md','project.md','conditional_docs.md','providers.md','review_proof.md','scenarios.md'] as const`.
  - `export function verifyAdwRegen(worktreePath: string): { ok: boolean; missing: readonly string[] }` that returns `ok: false` with the offending list when: any of the six `.adw/<file>` is missing or empty (`statSync(...).size === 0`), or `features/regression/vocabulary.md` is missing, or `git status --porcelain -- .adw` (run with `cwd: worktreePath`) is empty (no regen change). Otherwise `ok: true`.
- Add `readonly verifyAdwRegen: (worktreePath: string) => { ok: boolean; missing: readonly string[] };` to `UpgradeDeps`; wire `verifyAdwRegen` into `buildDefaultUpgradeDeps`.
- In `executeUpgrade`, after the `if (!initResult.success)` block and **before** `deps.writeAdwVersion(...)`, insert:
  ```
  const verify = deps.verifyAdwRegen(worktreePath);
  if (!verify.ok) {
    deps.commentOnIssue(issueNumber,
      buildUpgradeFailureComment(`.adw/ regeneration incomplete: ${verify.missing.join(', ') || 'no changes under .adw/'}`, adwId, issueNumber),
      repoInfo);
    return { outcome: 'failed', reason: 'regen_incomplete' };
  }
  ```
- Leave `writeAdwVersion` → `commitChanges` → `pushBranch` → `createPullRequest` → gated-merge strictly **downstream** of this gate.

### 5. (§D) Build the merged copy function and replace both old helpers
- In `adws/phases/worktreeSetup.ts`, add `export function copyClaudeAssetsToWorktree(worktreePath: string): void`:
  - Derive `adwRepoRoot` from `import.meta.url` (existing pattern).
  - Copy **every** `.md` in `.claude/commands/` → `<worktree>/.claude/commands/` (overwrite, always).
  - Copy **every** skill directory in `.claude/skills/` → `<worktree>/.claude/skills/<name>/` via `copyDirContents` (overwrite, always; flat — nested subdirs not copied, consistent with #267).
  - Post-copy gitignore: for each copied **`target: false`** command (`!parseFrontmatterTarget(src)`) and each **`target: false`** skill (its `SKILL.md` is not `target: true`), add a gitignore entry (`.claude/commands/<file>` / `.claude/skills/<name>/`) **only if not already tracked** — detect via `git ls-files .claude/commands/` and `git ls-files .claude/skills/` (basename / top-dir match), reusing the existing tracked-skip pattern. Leave `target: true` assets committable; never gitignore an already-tracked file.
  - Batch entries through `ensureGitignoreEntries`.
- Delete `copyClaudeCommandsToWorktree` and `copyTargetSkillsAndCommands` from `worktreeSetup.ts`.

### 6. (§D) Update all call sites, re-exports, and the test mock
- `adws/phases/workflowInit.ts`: change the import (line 54) to `copyClaudeAssetsToWorktree`; replace both call sites (lines 200, 222) with `copyClaudeAssetsToWorktree(worktreePath)`; update the re-export (line 61) to export `copyClaudeAssetsToWorktree` and drop the two deleted names.
- `adws/phases/index.ts` (line 12): re-export `copyClaudeAssetsToWorktree`; drop the deleted names.
- `adws/workflowPhases.ts` (line 16): remove the dead `copyTargetSkillsAndCommands` re-export.
- `adws/phases/__tests__/workflowInit.test.ts` (lines 69–74): in `vi.mock('../worktreeSetup', …)` replace `copyClaudeCommandsToWorktree`/`copyTargetSkillsAndCommands` with `copyClaudeAssetsToWorktree: vi.fn()` (keep `ensureGitignoreEntry`/`ensureGitignoreEntries`).
- Confirm no remaining references: `git grep -nE "copyClaudeCommandsToWorktree|copyTargetSkillsAndCommands" -- 'adws/**'` returns nothing (docs/specs may still mention them — those are historical and out of scope).

### 7. (§0/§E) Update `makeDeps` and add unit tests E1–E4
- In `adws/__tests__/adwUpgrade.test.ts`, extend `makeDeps` defaults so every existing test still exercises the success path:
  - `findPRByBranch: vi.fn().mockReturnValue(null)` (guard proceeds)
  - `copyInitCommandToWorktree: vi.fn()`
  - `verifyAdwRegen: vi.fn().mockReturnValue({ ok: true, missing: [] })`
- **E1** — gate fail: `verifyAdwRegen` returns `{ ok: false, missing: ['commands.md'] }` (with `runInitCommand` success). Assert: `result.outcome === 'failed'` and `result.reason === 'regen_incomplete'`; `writeAdwVersion`, `commitChanges`, `pushBranch`, `createPullRequest`, `mergePR` **not** called; `commentOnIssue` called once with a non-ADW comment (`isAdwComment(body) === false`).
- **E2** — gate pass: defaults (`verifyAdwRegen` ok). Assert it proceeds to `writeAdwVersion` → `commitChanges` → `createPullRequest` (existing success-path assertions already cover `pr_merged`).
- **E3** — ordering: use a shared call-order recorder (e.g. push labels into an array from `copyInitCommandToWorktree` and `runInitCommand` mocks) and assert `copyInitCommandToWorktree` is invoked **before** `runInitCommand`, and that it is called with `(worktreePath, FRAMEWORK_ROOT)`.
- **E4** — new `adws/phases/__tests__/worktreeSetup.test.ts`: fixture-drive `copyClaudeAssetsToWorktree` against a temp dir containing a fake ADW repo layout (a `target: true` command, a `target: false` command, a `target: true` skill dir, a `target: false` skill dir). Assert: all land in the worktree; `target: false` entries are added to `.gitignore`; `target: true` entries are **not** gitignored; an already-tracked `target: false` file is **not** gitignored (preserve the #267 invariant — stub/seed the `git ls-files` result).

### 8. (§C) Document one-time recovery of already-bricked repos
- Append a short runbook entry to `adws/known_issues.md`: identify every target repo the broken orchestrator already merged against (heuristic: `.adw-version` equals the current framework hash **but** the repo has no `.adw/` directory), and reset/remove its `.adw-version` so the init-time gate re-triggers a now-gated (§B) regeneration. State explicitly that this is a manual one-time chore and is **not** executed by this PR.

### 9. Run the validation commands
- Execute every command in **Validation Commands** and confirm all pass with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions. Commands are from `.adw/commands.md`.

- `git grep -nE '^(<<<<<<<|=======|>>>>>>>)$'` — **reproduce/repair check.** Before the fix this prints conflict markers in `adwUpgrade.tsx` and `adwUpgrade.test.ts`; after Step 1 it must print **nothing**.
- `bunx tsc --noEmit` — root type check (no errors).
- `bunx tsc --noEmit -p adws/tsconfig.json` — **primary reproduction.** Fails before the fix (9× `TS1185`); must pass clean after.
- `bun run lint` — linter clean (no unused imports/vars after the deletions).
- `bun run build` — build succeeds.
- `bunx vitest run adws/__tests__/adwUpgrade.test.ts adws/phases/__tests__/worktreeSetup.test.ts adws/phases/__tests__/workflowInit.test.ts` — the directly-affected suites pass (idempotency guard, E1–E4, workflowInit determinism).
- `bun run test:unit` — full unit suite passes (zero regressions).
- `git grep -nE "copyClaudeCommandsToWorktree|copyTargetSkillsAndCommands" -- 'adws/**'` — returns nothing (both helpers fully removed from code; historical mentions in `docs`/`specs` are acceptable).

## Notes
- If `.adw/coding_guidelines.md` exists in the target repository (it does), strictly adhere to it. Relevant rules here: files under 300 lines (`worktreeSetup.ts` grows — if it crosses the limit, split the verify logic into `adws/phases/upgradeVerify.ts`); guard clauses / max depth ~2 (the merged copy function and `verifyAdwRegen` should use early returns, not nested branches); isolate side effects (keep `verifyAdwRegen` pure relative to injected fs/git access where practical; the executeUpgrade flow keeps all I/O behind `deps`); remove unused imports after the deletions.
- **Conflict resolution direction is deliberate:** the "Stashed changes" side (idempotency + `wontfix` guard) is kept, not discarded, because (a) `prApi.ts` already ships its helpers, (b) the test file's stashed `describe` exercises it, and (c) this issue's §B self-healing-retry argument *requires* "no PR on the claim branch ⇒ safe to re-run". Discarding it would reintroduce duplicate-PR risk and break the retry story.
- **Library install command** (per `.adw/commands.md`): `bun add <package>`. No new libraries are required for this fix.
- **§B verification uses `git status --porcelain -- .adw`** (not `git diff`) so it also catches the virgin-repo case where `.adw/` is entirely untracked (added, not modified). It must run **before** `commitChanges`, because `git add -A` + commit would clear the change set.
- **Residual edge (accept + log, do not fix now):** with overwrite-always for `target: false`, a target repo that has **committed** its own command/skill at a colliding name cannot be gitignored (gitignore can't untrack), so the overwrite + build-phase `git add -A` commits ADW's version over theirs. Rare (requires a committed same-named asset), consistent with "ADW wins". A snapshot-and-restore of tracked `target: false` collisions is deferred unless it bites.
- **Second residual edge for §B:** a framework hash bump whose regenerated `.adw/` output is byte-identical to the target's existing `.adw/` would produce an empty `git status` under `.adw/` and fail the gate, looping re-dispatch. This is unlikely (hash inputs are `adw_init.md` + `vocabulary.md.template`; a bump that changes neither's *output* is atypical) and is the intended trade for catching the no-op brick. Note it in the §C runbook so an operator recognizes the symptom.
- **`target: true` skill count:** #267 documented six; the current set is seven (`grill-me`, `implement-tdd`, `improve-codebase-architecture`, `prd-to-issues`, `tdd`, `ubiquitous-language`, `write-a-prd`). Keep §D and its test generic over the `target:` flag rather than hard-coding a count.
- **End-to-end "LLM actually regenerates `.adw/`" stays a manual smoke check** — genuinely infeasible in CI (the mock CLI stub cannot write `.adw/`), consistent with the PRD's `adwUpgrade.tsx` testing waiver (PRD line 168). E1–E4 cover the orchestration branching and the copy function; the LLM-writes-files step is verified by running `adwUpgrade` against a sandbox target.
- The branch `bugfix-issue-572-fix-adw-upgrade-regen-and-gate` currently tracks `origin/dev`, which carries the broken commit. The conflict resolution (Step 1) lands on this branch and is what makes the PR build green.
