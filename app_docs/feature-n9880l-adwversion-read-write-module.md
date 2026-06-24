# ADW Version Read/Write Module

## Overview

`adws/core/adwVersion.ts` is the low-level I/O leaf for the `.adw-version` file — a single-line hex SHA256 stored at the target repo root (outside `.adw/`) recording the framework content hash the repo was last initialized with. It exposes three exports: a local file reader, a local file writer, and an authoritative remote reader that is immune to stale worktrees.

## Responsibilities

- `readAdwVersion(worktreePath)` — reads `<worktreePath>/.adw-version` from the local filesystem; returns the trimmed hash or `null` when the file is absent or contains only whitespace
- `writeAdwVersion(worktreePath, hash)` — writes `<hash>\n` to `<worktreePath>/.adw-version`; called by `adwUpgrade.tsx` after a successful regen
- `readRemoteAdwVersion(defaultBranch, workspacePath)` — runs `git show "origin/<defaultBranch>:.adw-version"` with `cwd: workspacePath`; returns the trimmed hash or `null` on any error (absent file, missing branch); used by the upgrade gate as the authoritative source
- Exports `ADW_VERSION_FILENAME = '.adw-version'` for callers that build paths themselves

## Contracts & Invariants

- **Null semantics are unified**: absent file, whitespace-only content, or a non-zero `git show` exit all return `null` — "never initialized" and "git error" both trigger an upgrade in the gate
- **`readRemoteAdwVersion` catches all errors**: any `execSync` throw (missing branch, no remote, detached HEAD) returns `null` rather than propagating; fail-toward-upgrade, never crash
- **`workspacePath` must be the clone root** for `readRemoteAdwVersion` — `origin` must resolve to the target remote, not the framework repo; passing a feature worktree is incorrect (its `origin` may be the same remote but its `.git` dir is a linked worktree, which works — however the canonical intent is the main clone)
- `readAdwVersion` does not propagate I/O errors on existing files: a present-but-unreadable file will throw; only the `!existsSync` case maps to `null`

## Configuration

No configuration. The filename constant `ADW_VERSION_FILENAME` is exported for reference; callers should not hardcode `'.adw-version'`.

## Gotchas

- **`readAdwVersion` vs `readRemoteAdwVersion`**: use `readAdwVersion` when you need the file from a local path (e.g., `adwUpgrade.tsx` verifying its own worktree's version after regen). Use `readRemoteAdwVersion` in the upgrade gate — it bypasses any stale cached local file in a reused worktree.
- **`.adw-version` is outside `.adw/`** by design: LLM regen of `.adw/` cannot clobber the version file, ensuring the hash survives regeneration and the gate can accurately detect pre-regen state.
- **`writeAdwVersion` always overwrites**: no read-before-write; any existing content is replaced with the canonical `hash\n` format.
