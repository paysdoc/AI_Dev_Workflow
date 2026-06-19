# Living Docs Convergence Registry

## Overview

This module is the single source of truth for parsing, querying, and serializing `.adw/conditional_docs.md` — the index that maps module docs to the file areas they own. It enables `/document` to route a change to the entry that already owns the touched area (by glob or semantic match), rewrite that module doc in place, collapse multiple sibling entries for the same area into one, and create a new entry only when the change is genuinely novel. It also includes the one-off migration tool (`adws/checkLivingDocsIndex.ts`) that clustered ADW's snapshot-era per-run docs into per-module current-state docs and provides the acceptance-gate verification checks reused for ongoing index health.

## Responsibilities

- Parse `.adw/conditional_docs.md` into a structured `ConditionalDocsRegistry` (preamble + ordered `ConditionalDocEntry` records, each holding `docPath`, `ownedGlobs`, and `conditions`)
- Serialize a `ConditionalDocsRegistry` back to markdown, round-trip lossless with the parser
- Match a set of changed file paths against entries' owned globs to find the first owning entry (`findOwningEntry`) or all owning entries (`findOwningEntries`)
- Collapse multiple sibling entries that describe the same area into one merged entry (`collapseEntries`): unions their globs, inserts the merged entry at the position of the first collapsed entry, and returns the set of pruned `docPath`s for the caller to delete from disk
- Pure upsert: replace an existing entry in place by `docPath`, or append when novel (`upsertEntry`)
- Expose a pure, zero-dependency glob matcher (`**` spans path separators, `*` does not, `?` matches one char)
- Provide `conditionalDocs: ConditionalDocsRegistry` as a structured field on `ProjectConfig` (replacing the former raw-string-only read in `projectConfig.ts`)
- Verify the migrated index via `adws/checkLivingDocsIndex.ts`: lossless round-trip, doc↔entry bijection (no orphan docs, no dangling `docPath`s, no duplicate `docPath`s), no overlapping `ownedGlobs` between any two entries (regrowth guard), and entry count in a sane band

## Contracts & Invariants

- **Parse ↔ serialize round-trip is lossless:** `serializeConditionalDocs(parseConditionalDocs(content)) === content` for any canonical input
- **Legacy tolerance:** entries with no `Owns:` block parse to `ownedGlobs: []` and serialize unchanged; they never match via glob (but may still be routed to semantically by `/document`)
- **`findOwningEntry` is deterministic:** returns the first document-order entry whose globs match; equivalent to `findOwningEntries(...)[0]`
- **`findOwningEntries` is exhaustive:** returns all document-order entries with ≥1 owned glob matching ≥1 changed path; entries with empty `ownedGlobs` are never returned
- **`collapseEntries` is immutable:** original registry is not mutated; returns a new registry with exactly one merged entry at the position of the first collapsed entry, plus `prunedDocPaths` (the collapsed paths minus the survivor)
- **Collapse is idempotent for a single entry:** collapsing one entry into the same `docPath` is a no-op rewrite — registry length unchanged, `prunedDocPaths: []`
- **Collapse union is de-duplicated:** `ownedGlobs` on the merged entry is the order-preserving union of all collapsed entries' globs; no duplicates
- **Missing `docPath` in collapse is a no-op:** a path in `docPathsToCollapse` that is absent from the registry is silently ignored (no throw)
- **`upsertEntry` is convergent:** two upserts of the same `docPath` yield exactly one entry at the original position; array length does not grow
- **All registry functions are pure:** no filesystem I/O; callers supply and receive values
- **Migration bijection:** after migration every index entry's `docPath` exists on disk; every `app_docs/feature-*.md` on disk has exactly one index entry; no duplicate `docPath`s
- **Migration no-overlap invariant:** no two entries' `ownedGlobs` claim a common file (the "regrowth guard"); `checkLivingDocsIndex.ts` enforces this by classifying `git ls-files` output with `findOwningEntries`

## Configuration

No configuration. Consumers import from `adws/core/conditionalDocsRegistry.ts`. `ProjectConfig` (loaded by `adws/core/projectConfig.ts`) exposes the parsed registry as `conditionalDocs`; the raw string is still available as `conditionalDocsMd` for LLM-facing consumers.

`adws/checkLivingDocsIndex.ts` is a standalone script run via `bunx tsx adws/checkLivingDocsIndex.ts`. It reads `.adw/conditional_docs.md` and the `app_docs/` directory at startup; no configuration flags — constants `MIN_ENTRIES = 25` and `MAX_ENTRIES = 60` define the count-sanity band.

## Gotchas

- **Semantic routing is the caller's responsibility:** the registry provides the deterministic collapse/query primitives, but the *judgment* of which entries are siblings (same module/area) is performed by the `/document` agent reading `Conditions:` text holistically. The registry's glob-based `findOwningEntries` is a corroborating signal, not the sole routing key.
- **`Owns:` block is required for glob routing:** legacy entries (conditions only, no `Owns:`) return `ownedGlobs: []` and are never returned by `findOwningEntry`/`findOwningEntries`. They can still be routed to via semantic judgment in `/document`.
- **`collapseEntries` does not delete files:** it returns `prunedDocPaths` but does not touch the filesystem. The caller (the `/document` agent) must delete those `app_docs/` files and serialize the returned registry back to disk.
- **Glob scope:** `*` does not cross path separators — `adws/core/*.ts` does not match `adws/core/sub/file.ts`. Use `**` for recursive matches.
- **Preamble includes a trailing newline:** the parser captures the `# Conditional Documentation` header plus its trailing newline as `preamble`; the serializer emits `preamble + entries + '\n'`. Altering preamble whitespace breaks the round-trip test.
- **Entry serialization always emits a `Conditions:` block:** an entry with `conditions: []` serializes to a `  - Conditions:` line with no bullets — valid markdown but produces an empty section.
- **`adw_init.md` now emits `Owns:` blocks:** newly initialized repos produce entries in the new format so their indexes are convergent from day one. Older repos without `Owns:` globs are backward-compatible but will not route via glob until their entries are regenerated by a `/document` run.
- **`checkLivingDocsIndex.ts` is a one-off migration gate, not the post-write guards module:** it runs the same regrowth invariant check as `adws/core/docsGuards.ts` but against the whole index at once (via `git ls-files`), not per-write. Do not add it to the `/document` post-write hook — that role belongs to `adws/phases/docsSelfCheck.ts`.
- **`checkLivingDocsIndex.ts` calls `git ls-files`:** it must be run from the repo root; running it from a subdirectory will produce incorrect overlap results.
