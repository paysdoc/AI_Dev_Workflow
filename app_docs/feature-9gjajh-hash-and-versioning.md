# Hash & Versioning

## Overview

This module computes, stores, and guards a SHA256 content hash that identifies the current framework version installed in a target repository. It also provides atomic distributed coordination so that exactly one orchestrator wins the right to perform an upgrade when multiple orchestrators might race.

## Responsibilities

- Parses the `hashInputs:` list from `.claude/commands/adw_init.md` YAML frontmatter and computes a SHA256 hex digest over those files in lexicographic path order (`hashComputer.ts`).
- Reads and writes the `.adw-version` file at the root of a target repo's worktree, storing the hash as a plain hex string with a single trailing newline (`adwVersion.ts`).
- Generates unique ADW session identifiers in the form `{random6chars}-{slugified-summary}` or `{random6chars}-{timestamp}` when no summary is available (`adwId.ts`).
- Converts arbitrary text to URL-friendly, lowercase, hyphenated slugs capped at 50 characters (`adwId.ts`).
- Races distributed orchestrators to claim upgrade ownership by pushing an empty commit with a unique nonce to `adw-upgrade-<hash>` without `--force`; exactly one push wins (`upgradeClaim.ts`).
- Classifies a failed push as a non-fast-forward rejection (loser) versus a genuine git failure (propagated error) (`upgradeClaim.ts`).
- Looks up the GitHub PR and its linked issue number on the existing claim branch so the losing orchestrator can reference the in-progress upgrade (`upgradeClaim.ts`).

## Contracts & Invariants

- The hash digest is stable with respect to frontmatter list order: inputs are sorted lexicographically before hashing, so reordering the `hashInputs:` list does not change the digest — UNLESS `adw_init.md` itself is listed as a hash input, because its bytes change when reordered.
- `readAdwVersion` returns `null` for both absent and whitespace-only files; only genuine I/O errors on an existing file are propagated.
- `writeAdwVersion` always writes exactly `{trimmed-hash}\n`; it does not append or merge.
- `.adw-version` lives at the repo root, outside `.adw/`, so LLM-driven regeneration of `.adw/` cannot overwrite it.
- The upgrade-claim push uses a detached HEAD worktree (not a named local branch) to prevent a leftover local branch from a prior failed attempt from short-circuiting the atomic gate with a hard error.
- The nonce in the claim commit message guarantees that two orchestrators with identical identity running at the same second produce different SHAs, so the second push is a true non-fast-forward rejection rather than "up-to-date".
- `generateAdwId` does NOT include the `adw-` prefix; callers are expected to embed the ID inside a branch name template that already supplies that prefix.
- `hashInputs:` must be non-empty; an absent key, an empty list, or missing frontmatter all throw a descriptive error rather than silently producing a hash over zero bytes.

## Configuration

The set of files that contribute to the framework hash is declared in the `hashInputs:` block-list inside the YAML frontmatter of `.claude/commands/adw_init.md`. No other configuration is required. Adding a new init dependency and including it in the hash must be done in the same change to that file, making omissions structurally impossible.

## Gotchas

- If `adw_init.md` lists itself in `hashInputs:`, reordering the list changes the file's own bytes and therefore changes the digest — the lexicographic-sort stability guarantee does not apply in that case.
- The claim worktree is created under `os.tmpdir()` and cleaned up in a `finally` block; cleanup is best-effort and silent. Orphaned temp directories are possible if the process is killed mid-run.
- `isPushRejectionError` matches on stderr substrings (`rejected`, `non-fast-forward`, `failed to push some refs`, `already exists`, `[rejected]`). Any git output that coincidentally contains these strings on an otherwise real error would be misclassified as a loser result rather than a crash.
- `buildDefaultUpgradeClaimDeps` defaults `baseRepoPath` to `process.cwd()`, which is context-dependent. Callers in non-trivial process environments should pass the path explicitly.
- `resolveIssueNumberFromPR` silently returns `null` on any fetch error; a losing orchestrator may end up with `existingIssueNumber: null` even when a linked issue exists but is temporarily unreachable.
