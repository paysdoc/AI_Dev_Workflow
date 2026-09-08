# Hash & Versioning

## Overview

This module computes, stores, and guards a SHA256 content hash that identifies the current framework version installed in a target repository. It provides atomic distributed coordination so that exactly one orchestrator wins the right to perform an upgrade when multiple orchestrators might race, pure helpers for counting bot-authored upgrade-failure comments toward an escalation cap, and an independent cron redrive that re-spawns the upgrade for any tracking issue left stranded by a claim that never completed.

## Responsibilities

- Parses the `hashInputs:` list from `.claude/commands/adw_init.md` YAML frontmatter and computes a SHA256 hex digest over those files in lexicographic path order (`hashComputer.ts`).
- Reads and writes the `.adw-version` file at the root of a target repo's worktree, storing the hash as a plain hex string with a single trailing newline (`adwVersion.ts`).
- Reads the authoritative stored hash from the target repo's remote default branch (`origin/<defaultBranch>:.adw-version`) through an injected git-show function, so a stale local file in a reused worktree can never produce a false reading (`adwVersion.ts`'s `readRemoteAdwVersion`).
- Generates unique ADW session identifiers in the form `{random6chars}-{slugified-summary}` or `{random6chars}-{timestamp}` when no summary is available (`adwId.ts`).
- Converts arbitrary text to URL-friendly, lowercase, hyphenated slugs capped at 50 characters (`adwId.ts`).
- Races distributed orchestrators to claim upgrade ownership by pushing an empty commit with a unique nonce to `adw-upgrade-<hash>` without `--force`; exactly one push wins (`upgradeClaim.ts`).
- Classifies a failed push as a non-fast-forward rejection (loser) versus a genuine git failure (propagated error) (`upgradeClaim.ts`).
- Looks up the GitHub PR and its linked issue number on the existing claim branch so the losing orchestrator can reference the in-progress upgrade (`upgradeClaim.ts`).
- Identifies bot-authored upgrade-failure comments on a tracking issue and counts them, feeding the upgrade orchestrator's failure-cap escalation gate (`upgradeFailureCap.ts`).
- Re-spawns the upgrade orchestrator for any `#UPG` tracking issue left stranded after its claim succeeded but the run never finished — an independent cron pass, not a second source of correctness (`adws/triggers/upgradeRedrive.ts`).

## Contracts & Invariants

- The hash digest is stable with respect to frontmatter list order: inputs are sorted lexicographically before hashing, so reordering the `hashInputs:` list does not change the digest — UNLESS `adw_init.md` itself is listed as a hash input, because its bytes change when reordered.
- `readAdwVersion` returns `null` for both absent and whitespace-only files; only genuine I/O errors on an existing file are propagated.
- `readRemoteAdwVersion` takes an injected `show: (ref, filePath, cwd) => string` function — it never shells out to git itself — and returns `null` when the remote file is absent, whitespace-only, or `show` throws (missing branch, no remote, detached HEAD). Every failure mode collapses to `null`, so callers fail toward triggering an upgrade rather than crashing.
- The `workspacePath` passed to `readRemoteAdwVersion` must be the target repo's clone root, not a feature worktree, so that `origin` resolves to the target's remote rather than the framework's.
- `writeAdwVersion` always writes exactly `{trimmed-hash}\n`; it does not append or merge.
- `.adw-version` lives at the repo root, outside `.adw/`, so LLM-driven regeneration of `.adw/` cannot overwrite it.
- The upgrade-claim push uses a detached HEAD worktree (not a named local branch) to prevent a leftover local branch from a prior failed attempt from short-circuiting the atomic gate with a hard error.
- The nonce in the claim commit message guarantees that two orchestrators with identical identity running at the same second produce different SHAs, so the second push is a true non-fast-forward rejection rather than "up-to-date".
- `upgradeClaim.ts`'s claim primitive takes its `GitContext` and a `getDefaultBranch: () => string` thunk as required parameters throughout (`defaultPushClaimBranch`, `buildDefaultUpgradeClaimDeps(baseRepoPath, ctx, getDefaultBranch)`, `claimUpgradeOrFindExisting(hash, repoInfo, deps)`) — there is no fallback that constructs its own `GitContext`; every caller must supply one explicitly.
- `generateAdwId` does NOT include the `adw-` prefix; callers are expected to embed the ID inside a branch name template that already supplies that prefix.
- `hashInputs:` must be non-empty; an absent key, an empty list, or missing frontmatter all throw a descriptive error rather than silently producing a hash over zero bytes.
- `isUpgradeFailureComment`/`countUpgradeFailureComments` are pure and I/O-free; a comment counts only when it is bot-authored (`author` ends with `[bot]`) AND its body starts with the exact `UPGRADE_FAILURE_SIGNATURE` string — HITL-deferred, merge-failed, and escalation comments, and any human-authored comment, are deliberately excluded so they never inflate the count.
- `decideUpgradeRedrive` is a pure guard-clause predicate — open, `adw:upgrade`-labeled, not terminal-labeled, no claim PR yet, and no live-process spawn lock, in that order — and is a cheap pre-filter only; the upgrade orchestrator's own entry gate and idempotency guard remain the correctness authority if this pre-filter is ever wrong.
- `runUpgradeRedriveScan`'s `deps` (including `findClaimPr`) are required, not defaulted internally. The production cron builds them via `buildDefaultUpgradeRedriveDeps(repoInfo, codeHost)`, which parses the claim branch out of the tracking issue body and resolves it through the code host's `findPullRequestByBranch`.

## Configuration

The set of files that contribute to the framework hash is declared in the `hashInputs:` block-list inside the YAML frontmatter of `.claude/commands/adw_init.md`. No other configuration is required. Adding a new init dependency and including it in the hash must be done in the same change to that file, making omissions structurally impossible.

## Gotchas

- If `adw_init.md` lists itself in `hashInputs:`, reordering the list changes the file's own bytes and therefore changes the digest — the lexicographic-sort stability guarantee does not apply in that case.
- A framework hash bump — and therefore the next upgrade run for every registered target repo — only happens when a file actually listed in `adw_init.md`'s `hashInputs:` changes. Adding new upgrade-time behavior elsewhere does not by itself roll out; the trigger is always an edit to a declared hash input.
- The claim worktree is created under `os.tmpdir()` and cleaned up in a `finally` block; cleanup is best-effort and silent. Orphaned temp directories are possible if the process is killed mid-run.
- `isPushRejectionError` matches on stderr substrings (`rejected`, `non-fast-forward`, `failed to push some refs`, `already exists`, `[rejected]`). Any git output that coincidentally contains these strings on an otherwise real error would be misclassified as a loser result rather than a crash.
- `buildDefaultUpgradeClaimDeps` takes `baseRepoPath` as a required explicit parameter — there is no default to `process.cwd()`. Every call site must pass the correct repo root (the target repo's workspace, not the framework repo) explicitly.
- `resolveIssueNumberFromPR` silently returns `null` on any fetch error; a losing orchestrator may end up with `existingIssueNumber: null` even when a linked issue exists but is temporarily unreachable.
- Bot-author detection (`isUpgradeFailureComment`) is a simple `author.endsWith('[bot]')` check — a deployment that posts upgrade comments under a non-`[bot]` PAT would silently escape the failure cap.
- The claim branch `adw-upgrade-<hash>` is created once by the winning push and is never released on failure — nothing re-triggers a failed upgrade on its own. `upgradeRedrive.ts`'s cron pass exists specifically to close that gap; without it, a stranded `#UPG` issue (claimed but never completed) would sit forever with no PR and no further attempts.
