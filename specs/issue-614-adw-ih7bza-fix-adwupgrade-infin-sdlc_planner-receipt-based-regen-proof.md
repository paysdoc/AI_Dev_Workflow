# Feature: Receipt-based proof-of-execution for adwUpgrade (kill the zero-diff infinite loop)

## Metadata
issueNumber: `614`
adwId: `ih7bza-fix-adwupgrade-infin`
issueJson: `{"number":614,"title":"fix: adwUpgrade infinite loop — receipt-based proof-of-execution replaces the zero-diff brick check","body":"<full issue body — see GitHub issue #614>","state":"OPEN","author":"paysdoc","labels":["hitl","adw:bug"],"createdAt":"2026-06-17T10:56:45Z","comments":[{"author":"paysdoc","createdAt":"2026-06-17T11:25:39Z","body":"## continue"},{"author":"paysdoc","createdAt":"2026-06-17T11:30:27Z","body":"## continue"}],"actionableComment":null}`

## Feature Description

`adwUpgrade.tsx` regenerates a target repo's `.adw/` configuration whenever the ADW framework content hash drifts. Today it uses **"the `.adw/` artifact changed on disk"** as a proxy for **"the `/adw_init` agent actually did its job"** — implemented as a `git status --porcelain -- .adw` diff requirement inside `verifyAdwRegen`. That proxy is wrong: a `hashInputs` change can legitimately produce a *byte-identical* `.adw/` for a given repo, so a correct no-op regen yields an empty diff, `verifyAdwRegen` returns `{ ok: false }`, the orchestrator returns `regen_incomplete` (no `.adw-version` stamp, no PR), and cron re-dispatches the `adw:upgrade` tracking issue **every tick forever**, burning ~$0.40/run.

This feature replaces the diff proxy with a **direct proof-of-execution signal**: `/adw_init` writes an agent-authored **receipt** (`.adw/.regen-receipt`) stamped with the framework hash it targeted, as its final step. The orchestrator's `verifyAdwRegen` then passes iff the required files exist *and the receipt's hash matches the hash the orchestrator independently computed* (freshness). A legitimate no-op now produces a fresh receipt → the gate passes → `.adw-version` is bumped → a PR lands → the loop breaks. A silent skip (the #572 brick class) leaves the *previous* receipt carrying the *old* hash → mismatch → gate fails → clean cron retry, exactly as before.

The claim/verdict split is preserved: the **receipt** is an *agent-written, untrusted claim* (input to verification only); **`.adw-version`** remains the *orchestrator-written, verified verdict* and the only thing the upgrade gate reads.

## User Story

As an **ADW operator self-hosting the framework against real repositories**
I want **a framework-hash bump that produces no `.adw/` content change to still advance `.adw-version` and open a single upgrade PR**
So that **the upgrade orchestrator stops re-dispatching the same tracking issue every cron tick and stops burning money on a no-op loop**, while still refusing to stamp a repo whose `/adw_init` silently skipped its work.

## Problem Statement

On a repo that already has valid `.adw/`, two cases leave **byte-identical filesystem state** and are therefore indistinguishable by any post-hoc filesystem inspection:

- **Legitimate no-op** — the agent ran `/adw_init`, correctly concluded `.adw/` needs no change.
- **Silent skip** — the agent exited 0 without doing the work (e.g. the `/adw_init` command never expanded), leaving the old `.adw/` untouched.

The current `verifyAdwRegen` conflates them: it requires a non-empty `git status --porcelain -- .adw` diff, so it **fails the legitimate no-op** (treating it as a brick risk) and the issue loops. The `feature-t6m62c-adwupgrade-regen-gate-propagation.md` doc explicitly predicted this as a "Residual edge". Live incident 2026-06-17: commit `e33ef9b` edited `.claude/commands/adw_init.md` (a `hashInput`), bumping the hash `34e7e129…` → `c1acb23f…` without changing the generated `.adw/`, and looped on tracking issue #613.

## Solution Statement

Capture proof-of-execution at the source instead of inferring it from a diff:

1. **`/adw_init` writes `.adw/.regen-receipt`** as its final step, containing one line `frameworkHash: <currentHash>`. The receipt is **committed** (lives inside `.adw/`, the agent's own artifact). The hash is obtained deterministically by invoking the framework's existing `computeFrameworkHash` via a new CLI guard on `adws/core/hashComputer.ts` (`bunx tsx "$3/adws/core/hashComputer.ts" "$3"`), so the value the agent claims is computed by the *same* function the orchestrator verifies against. This is uniform across every `/adw_init` caller — no new positional argument is introduced.
2. **`verifyAdwRegen(worktreePath, expectedHash)`** gains an `expectedHash` parameter and passes iff: the six `REQUIRED_ADW_FILES` exist and are non-empty, **and** `features/regression/vocabulary.md` exists, **and** `.adw/.regen-receipt` exists with `frameworkHash === expectedHash`. The `git status --porcelain -- .adw` diff check is **removed entirely** (keeping it would reintroduce the loop).
3. **`executeUpgrade`** passes its already-computed runtime `hash` as `expectedHash`. On pass → `writeAdwVersion` + commit (diff is always ≥ the `.adw-version` + receipt bump, so never empty) + push + PR + gated merge (unchanged). On fail → existing non-workflow failure comment, no stamp, no PR; cron re-dispatch + idempotency guard self-heal as today.

**Fail-safety:** every agent misbehavior mode (botched write, copied stale hash, hallucinated value, skipped step) yields a receipt whose hash ≠ `expectedHash` (or an absent receipt) → `verifyAdwRegen` fails → clean retry. A false *pass* requires the agent to write *exactly* the new hash, which is only obtainable by actually running the framework's hash computation. There is no path from agent error to a bricking stamp.

## Relevant Files

Use these files to implement the feature:

- `adws/adwUpgrade.tsx` — **change.** Holds `executeUpgrade` and the `UpgradeDeps` interface. Widen `UpgradeDeps.verifyAdwRegen` to `(worktreePath, expectedHash) => …`; pass the runtime `hash` at the step-5b call site (`deps.verifyAdwRegen(worktreePath, hash)`); update the step-5b comment to describe the receipt-freshness gate. `hash` is already in scope (computed at step 1).
- `adws/phases/worktreeSetup.ts` — **change.** Holds `verifyAdwRegen`, `REQUIRED_ADW_FILES`, `copyAdwInitCommandToWorktree`. Add the receipt path constant + a pure `parseRegenReceiptHash` helper; change `verifyAdwRegen`'s signature and body (remove the `git status` block, add receipt-presence + freshness checks); update its JSDoc. Keep `REQUIRED_ADW_FILES` unchanged (the receipt is an additional check, not a generated config file).
- `adws/core/hashComputer.ts` — **change.** Holds `computeFrameworkHash`. Add a CLI guard at the bottom (`if (import.meta.url === \`file://${process.argv[1]}\`) { … process.stdout.write(computeFrameworkHash(root)) }`) so `/adw_init` can obtain the current hash deterministically. Pure logic untouched.
- `.claude/commands/adw_init.md` — **change.** Add a new final actionable step that writes `.adw/.regen-receipt` with `frameworkHash: <hash>` (hash from the `hashComputer.ts` CLI against `$3`; graceful skip + warning when `$3` is empty, mirroring the existing step-7 `$3`-empty pattern). Update the Report step to note the receipt. **Editing this file is itself a `hashInput`, so landing the fix bumps the framework hash once more** — the new mechanism handles that bump correctly.
- `adws/__tests__/adwUpgrade.test.ts` — **change.** Update `makeDeps` (the `verifyAdwRegen` mock signature is compatible — `vi.fn()` ignores the extra arg); add tests asserting `expectedHash` is threaded, the legitimate no-op path stamps + PRs, and the stale-receipt path fails closed.
- `adws/phases/__tests__/worktreeSetup.test.ts` — **change.** Add a new `describe('verifyAdwRegen', …)` block driving a real temp git repo for the freshness branches, plus a focused `parseRegenReceiptHash` unit.
- `adws/core/adwVersion.ts` — **context only (no change).** `writeAdwVersion` (orchestrator-written verdict) is unchanged; confirms the receipt and `.adw-version` stay separate files with distinct authorship.
- `adws/phases/upgradeGate.ts` — **context only (no change).** Reads `.adw-version` via `shouldTriggerUpgrade`; the gate source format is unchanged, so the gate needs no edit. Listed to confirm the claim/verdict boundary is respected.
- `adws/vcs/commitOperations.ts` — **context only (no change).** `commitChanges` uses `git add -A`, so the receipt inside `.adw/` is committed automatically; it returns `false` (skips) only when `git status` is empty, which cannot happen here because `.adw-version` + the receipt always change on a real run.
- `.adw-version` (repo root) — **change (self-target stamp).** This repo is its own ADW target; after `adw_init.md` is edited the hash changes, so `.adw-version` must be re-stamped to the new hash to keep the gate disarmed.
- `adws/known_issues.md` — **change (docs).** The §"adwUpgrade no-op brick" runbook still describes the removed `git status --porcelain -- .adw` diff requirement; update it to the receipt-freshness mechanism so operators are not misled.
- `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — **reference (read).** The original #572 anti-brick gate this feature revises; its "Residual edge" note is the exact bug being fixed. Matches a `.adw/conditional_docs.md` condition for this work.
- `app_docs/feature-n9880l-adwversion-read-write-module.md` — **reference (read).** Documents `readAdwVersion`/`writeAdwVersion` and why `.adw-version` lives outside `.adw/`; relevant to the claim/verdict separation.

### New Files
- `.adw/.regen-receipt` (repo root, this repo's self-target copy) — created with `frameworkHash: <new hash>` in the self-target stamping step. In *target* repos this file is produced by `/adw_init` at upgrade time, not authored here.

## Implementation Plan

### Phase 1: Foundation
Make the framework hash obtainable by the `/adw_init` agent and define the receipt contract. Add the CLI guard to `adws/core/hashComputer.ts` so `bunx tsx adws/core/hashComputer.ts <frameworkRepoRoot>` prints the 64-char hex hash to stdout (no trailing newline noise beyond a single value), gated by the existing `import.meta.url` idiom. Add the receipt path constant and a pure `parseRegenReceiptHash(content): string | null` helper to `worktreeSetup.ts`. No behavior change yet — this is the substrate the gate and the command both build on.

### Phase 2: Core Implementation
Rewire the gate. In `worktreeSetup.ts`, change `verifyAdwRegen` to take `(worktreePath, expectedHash)`, remove the `git status --porcelain -- .adw` block, and add: (a) receipt-absent → fail, (b) receipt hash ≠ `expectedHash` → fail, keeping the existing required-files and vocabulary checks. In `adwUpgrade.tsx`, widen the `UpgradeDeps.verifyAdwRegen` type and pass `hash` at the call site, updating the step-5b comment. In `.claude/commands/adw_init.md`, add the final receipt-writing step and update the report step.

### Phase 3: Integration
Prove the loop is broken and the brick protection is preserved with unit tests at both layers (orchestration via `UpgradeDeps`, freshness via a real temp git repo). Re-stamp this repo's self-target gate: recompute the hash after editing `adw_init.md`, write `.adw/.regen-receipt` and update `.adw-version` to the new hash in the same change so the framework's own gate stays disarmed and would itself pass `verifyAdwRegen`. Update the `known_issues.md` runbook. Run the full validation suite.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1 — Add a CLI guard to `adws/core/hashComputer.ts`
- At the bottom of the file, after `computeFrameworkHash`, add a CLI entry gated by `if (import.meta.url === \`file://${process.argv[1]}\`) { … }` (the same idiom used in `adwUpgrade.tsx:409` / `adwMerge.tsx:290`).
- Inside: resolve `const root = process.argv[2] ?? process.cwd();` and `process.stdout.write(computeFrameworkHash(root));` (write the bare hash, no extra formatting, so the caller can capture it cleanly).
- Add a short comment explaining this entry exists so `/adw_init`'s receipt step can obtain the current framework hash deterministically.
- Do not change the pure `computeFrameworkHash` / `parseHashInputs` logic.

### Task 2 — Add the receipt path constant and `parseRegenReceiptHash` helper to `adws/phases/worktreeSetup.ts`
- Add an exported constant for the receipt location, e.g. `export const REGEN_RECEIPT_RELATIVE_PATH = path.join('.adw', '.regen-receipt');` (and/or a `REGEN_RECEIPT_FILENAME` if clearer).
- Add an exported pure helper `parseRegenReceiptHash(content: string): string | null` that returns the trimmed value of the `frameworkHash:` line (match `/^frameworkHash:\s*(\S+)\s*$/m`), or `null` when the key is absent. Mirror the simple line-matching style of the existing `parseFrontmatterTarget`.

### Task 3 — Rewrite `verifyAdwRegen` in `adws/phases/worktreeSetup.ts`
- Change the signature to `export function verifyAdwRegen(worktreePath: string, expectedHash: string): { ok: boolean; missing: readonly string[] }`.
- Keep the `REQUIRED_ADW_FILES` existence + non-empty loop and the `features/regression/vocabulary.md` existence check, accumulating into `missing`.
- **Remove** the `try { execSync('git status --porcelain -- .adw' …) }` block entirely.
- Add receipt checks (after the file checks): read `<worktreePath>/.adw/.regen-receipt`. If absent, push a clear token (e.g. `'.adw/.regen-receipt (missing)'`). Else parse via `parseRegenReceiptHash`; if the parsed hash is `null` or `!== expectedHash`, push `'.adw/.regen-receipt (stale)'`.
- Return `{ ok: missing.length === 0, missing }`.
- Update the JSDoc to describe receipt-freshness (claim vs. verdict, the off-default-branch stale-receipt rationale) and drop the git-status wording. Keep the function under the file's nesting/length guidelines — extract a small `receiptIsFresh(worktreePath, expectedHash): boolean` (or `receiptFailure(...)`) helper if the body would otherwise exceed ~2 levels of nesting.

### Task 4 — Thread `expectedHash` through `adws/adwUpgrade.tsx`
- Widen `UpgradeDeps.verifyAdwRegen` to `(worktreePath: string, expectedHash: string) => { ok: boolean; missing: readonly string[] }`.
- At the step-5b call site (currently `const verify = deps.verifyAdwRegen(worktreePath);`), pass the runtime hash: `const verify = deps.verifyAdwRegen(worktreePath, hash);`.
- Update the step-5b comment block so it describes the receipt-freshness gate (replace the "no changes under .adw/" language with the receipt/stale-hash rationale).
- `buildDefaultUpgradeDeps` continues to reference the imported `verifyAdwRegen` (now the new signature) — confirm it still type-checks; no other edit needed there.

### Task 5 — Add the receipt-writing step to `.claude/commands/adw_init.md`
- Insert a new actionable step **before** the Report step (renumber the current step 8 "Report" to step 9), titled e.g. "8. **Write the Regeneration Receipt**". State that this MUST be the final mutation step (its freshness is the proof that steps 2–7 completed).
- Instruct: obtain the current framework hash by running, via the Bash tool, `bunx tsx "$3/adws/core/hashComputer.ts" "$3"` and capturing the printed hash; then write `.adw/.regen-receipt` containing exactly one line `frameworkHash: <hash>`. Emphasize the file is committed (do NOT add it to `.gitignore`) and lives inside `.adw/`.
- Add the graceful-degradation clause: if `$3` (frameworkRepoRoot) is empty (legacy/manual invocation), skip writing the receipt and log a warning in the report step — mirroring the existing step-7 `$3`-empty handling. (The next orchestrator-driven upgrade supplies `$3` and writes the receipt; the repo self-heals.)
- Update the Report step to list `.adw/.regen-receipt` among artifacts and note whether it was written (with the hash) or skipped (with the reason).
- Do not introduce a new positional argument; the receipt step relies only on the existing `$3`.

### Task 6 — Update `adws/__tests__/adwUpgrade.test.ts` (orchestration tests, dep-injected via `UpgradeDeps`)
- Keep `makeDeps`'s `verifyAdwRegen: vi.fn().mockReturnValue({ ok: true, missing: [] })` (the mock ignores the new arg).
- Add a test: **`expectedHash` is threaded** — assert `deps.verifyAdwRegen` was called with `(expect.any(String), MOCK_HASH)`.
- Add **Test 1 (regression, no-op-but-legitimate)**: with `verifyAdwRegen` returning `{ ok: true }` (the fresh-receipt / zero-diff case), `executeUpgrade` calls `writeAdwVersion` and `createPullRequest` and returns `pr_merged`. Name it so intent is explicit (this is the path the old git-diff gate wrongly blocked).
- Add **Test 2 (stale receipt → fail closed)**: with `verifyAdwRegen` returning `{ ok: false, missing: ['.adw/.regen-receipt (stale)'] }`, `executeUpgrade` returns `regen_incomplete`, does **not** call `writeAdwVersion`/`commitChanges`/`pushBranch`/`createPullRequest`/`mergePR`, and posts exactly one non-ADW comment. (Reuses the existing E1 shape, keyed to the stale-receipt reason.)

### Task 7 — Add `verifyAdwRegen` + `parseRegenReceiptHash` unit tests to `adws/phases/__tests__/worktreeSetup.test.ts`
- Import `verifyAdwRegen` and `parseRegenReceiptHash` (and the receipt path constant) from `../worktreeSetup`.
- Add a `describe('parseRegenReceiptHash', …)`: valid line returns the hash; extra leading/trailing whitespace tolerated; missing `frameworkHash:` key returns `null`.
- Add a `describe('verifyAdwRegen', …)` that builds a temp git repo (reuse the `initGitRepo` / `mkdtempSync` / `afterEach rmSync` fixture pattern already in this file). Seed `.adw/` with six non-empty `REQUIRED_ADW_FILES`, a non-empty `features/regression/vocabulary.md`, and a `.adw/.regen-receipt` with a known hash; commit so the tree is clean (zero `.adw/` diff). Then assert:
  - **Test 1 (regression):** receipt hash === expectedHash **and zero `.adw/` content diff** → `{ ok: true }`. This is the proof the diff requirement is gone.
  - **Test 2 (stale / silent skip):** receipt hash !== expectedHash → `ok: false`, `missing` includes the receipt-stale token.
  - **Test 4 (receipt absent):** delete `.adw/.regen-receipt` → `ok: false`, `missing` includes the receipt-missing token.
  - **Test 3 (#572 preserved):** delete or truncate one `REQUIRED_ADW_FILES` entry → `ok: false`, `missing` includes that filename.
  - **Vocabulary missing:** remove `features/regression/vocabulary.md` → `ok: false`, `missing` includes `features/regression/vocabulary.md`.

### Task 8 — Re-stamp this repo's self-target gate (disarm hazard mitigation)
- After Task 5 lands the `adw_init.md` edit, recompute the framework hash for this repo: `bunx tsx adws/core/hashComputer.ts "$(pwd)"`.
- Write `.adw/.regen-receipt` at the repo root containing `frameworkHash: <new hash>`.
- Overwrite `.adw-version` at the repo root with the same `<new hash>` (single trailing newline, matching `writeAdwVersion`'s canonical format).
- Both must reflect the post-edit hash and land together, so this repo (an ADW self-target) does not re-arm `upgradeGate` and would itself pass `verifyAdwRegen`. **Do not rely on self-hosting ADW to apply this fix while the gate behavior is changing** (per the issue's Operational notes).

### Task 9 — Update the operator runbook in `adws/known_issues.md`
- Revise the entry that describes `verifyAdwRegen` gating on "a non-trivial `git status --porcelain -- .adw` diff" to describe the receipt-freshness mechanism (`.adw/.regen-receipt` written by `/adw_init`, `frameworkHash` compared to the orchestrator's computed hash, no diff requirement). Note that a legitimate no-op now produces a PR instead of looping.

### Task 10 — Validate
- Run every command in **Validation Commands** below and confirm zero errors and zero regressions. Fix anything that fails before considering the feature complete.

## Testing Strategy

### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope (vitest, `bun run test:unit`).

- **`adws/core/hashComputer.test.ts`** (existing) must still pass — the CLI guard is additive and the pure function is unchanged. No new assertion strictly required, but a smoke test that the module still computes a stable digest is sufficient; the CLI path is exercised end-to-end in the manual validation command.
- **`adws/__tests__/adwUpgrade.test.ts`** (dep-injected orchestration): `expectedHash` threading; Test 1 (legitimate no-op → stamp + PR); Test 2 (stale receipt → `regen_incomplete`, no stamp/PR/merge, one non-ADW comment). Existing idempotency-guard, HITL, merge-failure, LLM-failure, worktree-error, hash-error, and copy-before-init tests must remain green (the `verifyAdwRegen` mock signature is compatible).
- **`adws/phases/__tests__/worktreeSetup.test.ts`** (real temp git repo): the five `verifyAdwRegen` branches above (Tests 1–4 + vocabulary-missing) and `parseRegenReceiptHash` units. Existing `copyClaudeAssetsToWorktree` E4a–E4e tests must remain green.

### Edge Cases
- **Zero `.adw/` content diff + fresh receipt** (the bug): must pass and produce a PR (regression Test 1).
- **Stale receipt** (old hash from the default branch, i.e. silent skip): must fail closed — no stamp, no PR, clean retry.
- **Receipt absent** (first-ever upgrade on a pre-receipt repo, or agent never wrote it): must fail closed; the next dispatch supplies a fresh receipt.
- **Receipt present but malformed** (no `frameworkHash:` key, or truncated/garbage hash): `parseRegenReceiptHash` → `null` → treated as stale → fail closed.
- **Required `.adw/` file missing or empty**: still fails (no regression of the #572 protection).
- **`vocabulary.md` missing**: still fails.
- **`commitChanges` empty-diff guard**: not triggered on a real run because `.adw-version` and `.adw/.regen-receipt` both change (old hash → new hash), so the commit is never empty and the loop cannot recur.
- **Manual `/adw_init` without `$3`**: receipt write is skipped with a warning; repo self-heals on the next orchestrator-driven upgrade.

## Acceptance Criteria
- `/adw_init` writes `.adw/.regen-receipt` with `frameworkHash: <currentHash>` as its final mutation step; the receipt is committed (not gitignored).
- `verifyAdwRegen` takes `expectedHash`, checks receipt presence + `frameworkHash === expectedHash`, and the `git status --porcelain -- .adw` diff check is removed.
- A legitimate no-op regen (valid `.adw/`, fresh receipt, zero content diff) produces a `.adw-version`-bump PR and breaks the loop (Test 1 at both the `verifyAdwRegen` and `executeUpgrade` layers).
- A silent skip (stale or absent receipt) produces no stamp, no PR, a non-ADW failure comment, and a clean cron retry (Test 2 / receipt-absent).
- Missing/empty `.adw/` files (and missing `vocabulary.md`) still fail (no regression of #572).
- `adws/core/hashComputer.ts` printed via the CLI guard equals the hash stored in `.adw-version` for this repo after the self-target re-stamp.
- All five issue-specified tests pass; the full unit suite, type checks, lint, and build pass with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are sourced from `.adw/commands.md`.

- `bun run lint` — ESLint; no errors.
- `bunx tsc --noEmit` — root type check; no errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW workspace type check (Additional Type Checks); no errors.
- `bunx vitest run adws/__tests__/adwUpgrade.test.ts adws/phases/__tests__/worktreeSetup.test.ts adws/core/__tests__/hashComputer.test.ts` — the directly-affected suites; all green.
- `bun run test:unit` — full vitest suite (`vitest run`); zero failures, no regressions.
- `bun run build` — `tsc`; builds clean.
- `test "$(bunx tsx adws/core/hashComputer.ts "$(pwd)")" = "$(cat .adw-version)"` — confirms the CLI guard prints the framework hash and that the self-target re-stamp (Task 8) matches it (exit 0).
- `git grep -n "git status --porcelain -- .adw"` — must return **no matches** (the diff check is fully removed).

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) apply: keep files under 300 lines, prefer guard clauses / max ~2 levels of nesting (extract a `receiptIsFresh` helper if needed), treat data as immutable, avoid `any`, isolate side effects (the `hashComputer.ts` CLI guard is the only new side-effecting boundary and is gated by `import.meta.url`). No decorators.
- **No new dependencies.** Everything uses existing modules (`crypto`/`fs`/`path`, `vitest`, `execSync`). If a package were ever needed the install command is `bun add <package>` (per `.adw/project.md`).
- **Hash-sourcing decision (locked).** The agent obtains the hash from the framework's own `computeFrameworkHash` (via the new CLI guard against `$3`) rather than via a new `$4` positional argument to `/adw_init`. Rationale: one uniform path across all `/adw_init` callers, no change to the command's positional contract, and the agent and verifier compute the *same* hash with the *same* function (equality guaranteed on a correct run). The `$4`-passing alternative was rejected because it changes the public `/adw_init` arg contract and would still need a `$3` fallback for manual/legacy invocations — two paths where one suffices. Determinism risk from agent output-capture is fully covered by fail-safety: any fumble yields a non-matching/absent receipt → clean retry, never a brick.
- **Per-file content hashes in the receipt: dropped** (per issue grilling) — they'd prove only that the agent *read* the files, not that it regenerated them. The receipt stays one line.
- **No forced rewrite of the six `.adw/` files** (rejected #572-style mechanism) — it would merge non-deterministic cosmetic churn into every target on every bump. The always-changing receipt hash line is the minimal artifact that powers the PR.
- **Self-hosting hazard (Task 8 is mandatory).** Editing `adw_init.md` is a `hashInput` change, so merging this fix bumps the framework hash. `.adw-version` and `.adw/.regen-receipt` for *this* repo must be stamped to the new hash in the same change, or the gate re-arms and the triggering issue parks behind a fresh upgrade loop. Do not self-host this fix through ADW while the gate behavior is in flux.
- **BDD scenarios:** per-issue Gherkin scenarios (`features/per-issue/feature-614.feature`) are generated by the ADW scenario phase, not by this planner; they would assert against observable surfaces (the committed `.adw/.regen-receipt`, the `.adw-version` bump, the upgrade PR). The executable validation here is the unit suite above plus the manual CLI/`.adw-version` equality check.
