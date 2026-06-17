# Receipt-Based Regen Proof for adwUpgrade (Kill the Zero-Diff Infinite Loop)

**ADW ID:** ih7bza-fix-adwupgrade-infin
**Date:** 2026-06-17
**Specification:** specs/issue-614-adw-ih7bza-fix-adwupgrade-infin-sdlc_planner-receipt-based-regen-proof.md

## Overview

`adwUpgrade` previously inferred that `/adw_init` had done its work by checking for a non-empty `git status --porcelain -- .adw` diff. This proxy was wrong: a framework-hash bump that produces no change in the generated `.adw/` content yields an empty diff, causing `verifyAdwRegen` to fail, no `.adw-version` stamp to be written, and cron to re-dispatch the tracking issue on every tick — an infinite loop burning ~$0.40/run. This feature replaces the diff proxy with a **receipt-based proof-of-execution**: `/adw_init` writes `.adw/.regen-receipt` stamped with the framework hash it targeted, and `verifyAdwRegen` passes iff the receipt's hash matches the hash the orchestrator independently computed.

## What Was Built

- **`.adw/.regen-receipt` contract** — a one-line receipt file (`frameworkHash: <64-char hex>`) written by `/adw_init` as its final mutation step; committed inside `.adw/` so it lands in the upgrade PR.
- **`REGEN_RECEIPT_RELATIVE_PATH` constant** — exported from `worktreeSetup.ts`; single canonical path reference across the codebase.
- **`parseRegenReceiptHash(content)` helper** — pure function that extracts the hash from a receipt file's content, returning `null` on malformed/absent key.
- **`receiptIsFresh(worktreePath, expectedHash)` helper** — private helper that reads and validates the receipt against the expected hash.
- **Rewritten `verifyAdwRegen(worktreePath, expectedHash)`** — removes the `git status --porcelain -- .adw` block; adds receipt-presence and freshness checks; new `expectedHash` parameter threads the orchestrator's computed hash into the gate.
- **`adwUpgrade.tsx` wiring** — `UpgradeDeps.verifyAdwRegen` widened to `(worktreePath, expectedHash)`; runtime `hash` passed at the step-5b call site; failure message updated.
- **`hashComputer.ts` CLI guard** — `import.meta.url` guard at the bottom lets `/adw_init` call `bunx tsx adws/core/hashComputer.ts <root>` to obtain the current framework hash deterministically.
- **`adw_init.md` receipt step** — new step 8 instructs the agent to obtain the hash via the CLI guard and write `.adw/.regen-receipt`; graceful skip with warning when `$3` is empty; report step updated.
- **Self-target re-stamp** — this repo's `.adw-version` and `.adw/.regen-receipt` updated to the post-edit framework hash so the gate stays disarmed for the framework repo itself.
- **`known_issues.md` runbook update** — removed stale reference to the `git status --porcelain` diff requirement; documents the receipt-freshness mechanism.
- **Unit tests** — new tests in `adwUpgrade.test.ts` (hash threading, legitimate no-op path, stale-receipt path) and `worktreeSetup.test.ts` (real temp git repo; all five branches: fresh receipt, stale hash, absent receipt, missing required file, missing vocabulary).

## Technical Implementation

### Files Modified

- `adws/phases/worktreeSetup.ts`: Added `REGEN_RECEIPT_RELATIVE_PATH`, `parseRegenReceiptHash`, and `receiptIsFresh`; rewrote `verifyAdwRegen` to accept `expectedHash`, removed `git status` block, added receipt checks.
- `adws/adwUpgrade.tsx`: Widened `UpgradeDeps.verifyAdwRegen` type; passed `hash` at the step-5b call site; updated step-5b comment and failure message.
- `adws/core/hashComputer.ts`: Added CLI entry-point guard (`if (import.meta.url === ...)`) so the receipt step can obtain the hash via `bunx tsx`.
- `.claude/commands/adw_init.md`: Added step 8 (write `.adw/.regen-receipt`); updated Report step; `$3`-empty graceful-skip clause mirrors existing step-7 pattern.
- `adws/__tests__/adwUpgrade.test.ts`: Added hash-threading assertion; legitimate no-op test (fresh receipt, zero diff → stamp + PR); stale-receipt test (no stamp, no PR, failure comment).
- `adws/phases/__tests__/worktreeSetup.test.ts`: Full `verifyAdwRegen` describe block over a real temp git repo; `parseRegenReceiptHash` unit block.
- `.adw-version`: Re-stamped to the post-`adw_init.md`-edit framework hash.
- `.adw/.regen-receipt`: Created (self-target receipt for this repo).
- `adws/known_issues.md`: Updated the `adwUpgrade no-op brick` runbook entry.
- `README.md`: Updated accordingly.
- `features/per-issue/feature-614.feature`: BDD scenarios for this issue.
- `features/per-issue/step_definitions/feature-614.steps.ts`: Step definitions for the BDD scenarios.

### Key Changes

- **Diff check removed entirely.** `git status --porcelain -- .adw` is no longer called anywhere in the upgrade path (`git grep -n "git status --porcelain -- .adw"` returns no matches).
- **Claim/verdict split preserved.** The receipt is an agent-written, untrusted claim; `.adw-version` remains the orchestrator-written, verified verdict. The upgrade gate reads only `.adw-version`.
- **Fail-safety by construction.** Any agent misbehavior (botched write, hallucinated hash, skipped step) yields a receipt whose hash ≠ `expectedHash` (or an absent receipt) → `verifyAdwRegen` fails → clean retry. A false pass requires the agent to write exactly the new hash, obtainable only by actually invoking `hashComputer.ts`.
- **`commitChanges` empty-diff guard never triggers.** On a real run, `.adw-version` and `.adw/.regen-receipt` both change (old hash → new hash), so the commit is never empty and the loop cannot recur.
- **Backward-compatible for manual `/adw_init` calls.** When `$3` (frameworkRepoRoot) is absent, the receipt step is skipped with a warning; the repo self-heals on the next orchestrator-driven upgrade that supplies `$3`.

## How to Use

1. **Normal operation (no user action needed).** The orchestrator calls `executeUpgrade`, which runs `/adw_init` in a worktree. `/adw_init` writes `.adw/.regen-receipt` as its final step. `verifyAdwRegen` checks the receipt hash against the orchestrator's computed hash. Pass → `.adw-version` bumped + PR opened. Fail → failure comment posted, clean cron retry.

2. **Manual `/adw_init` invocation.** When invoking `/adw_init` manually (without `$3`), the receipt step is skipped. The next orchestrator-driven upgrade will supply `$3` and write the receipt.

3. **Verify the CLI guard.** Run:
   ```sh
   bunx tsx adws/core/hashComputer.ts "$(pwd)"
   ```
   The output should equal the contents of `.adw-version`.

4. **Re-stamp a self-hosting repo after editing `adw_init.md`.** After any `hashInput` change, recompute the hash and update both files atomically:
   ```sh
   NEW_HASH=$(bunx tsx adws/core/hashComputer.ts "$(pwd)")
   echo "$NEW_HASH" > .adw-version
   echo "frameworkHash: $NEW_HASH" > .adw/.regen-receipt
   ```

## Configuration

No new configuration. The receipt path (`.adw/.regen-receipt`) is fixed. The `$3` positional argument to `/adw_init` (frameworkRepoRoot) was already part of the command contract; the receipt step reuses it.

## Testing

```sh
# Run directly-affected test suites
bunx vitest run adws/__tests__/adwUpgrade.test.ts adws/phases/__tests__/worktreeSetup.test.ts adws/core/__tests__/hashComputer.test.ts

# Full unit suite
bun run test:unit

# Confirm git status diff check is fully removed
git grep -n "git status --porcelain -- .adw"  # must return no matches

# Confirm CLI guard and self-target stamp agree
test "$(bunx tsx adws/core/hashComputer.ts "$(pwd)")" = "$(cat .adw-version)" && echo "OK"
```

## Notes

- **Self-hosting hazard.** Editing `adw_init.md` is a `hashInput` change. Both `.adw-version` and `.adw/.regen-receipt` must be stamped to the new hash in the same commit, or the gate re-arms and a new upgrade loop begins. Task 8 of the spec covers this; do not rely on ADW self-hosting to apply this fix while the gate behavior is in flux.
- **Per-file content hashes were dropped.** They'd prove only that the agent *read* the files, not that it regenerated them. The receipt stays one line.
- **Residual edge closed.** `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` explicitly predicted this zero-diff no-op case as a residual edge; this feature is its resolution.
- **Live incident.** This fix was motivated by a 2026-06-17 loop on tracking issue #613: commit `e33ef9b` edited `adw_init.md` (a `hashInput`), bumping the hash without changing generated `.adw/`, causing `verifyAdwRegen` to loop forever.
