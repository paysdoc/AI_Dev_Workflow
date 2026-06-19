# Living Docs Convergence Registry

## Overview

This module is the single source of truth for parsing, querying, and serializing `.adw/conditional_docs.md` — the index that maps module docs to the file areas they own. It enables `/document` to route a documented change to the entry that already owns the touched files and rewrite that module doc in place (convergence), instead of appending a new per-run snapshot on every invocation.

## Responsibilities

- Parse `.adw/conditional_docs.md` into a structured `ConditionalDocsRegistry` (preamble + ordered `ConditionalDocEntry` records, each holding `docPath`, `ownedGlobs`, and `conditions`)
- Serialize a `ConditionalDocsRegistry` back to markdown, round-trip lossless with the parser
- Match a set of changed file paths against entries' owned globs to find the owning entry (`findOwningEntry`)
- Pure upsert: replace an existing entry in place by `docPath`, or append when novel (`upsertEntry`)
- Expose a pure, zero-dependency glob matcher (`**` spans path separators, `*` does not, `?` matches one char)
- Provide `conditionalDocs: ConditionalDocsRegistry` as a structured field on `ProjectConfig` (replacing the former raw-string-only read in `projectConfig.ts`)

## Contracts & Invariants

- **Parse ↔ serialize round-trip is lossless:** `serializeConditionalDocs(parseConditionalDocs(content)) === content` for any canonical input
- **Legacy tolerance:** entries with no `Owns:` block parse to `ownedGlobs: []` and serialize unchanged; they never match by glob
- **`findOwningEntry` is deterministic:** when multiple entries match, the first in document order wins
- **`upsertEntry` is convergent:** two upserts of the same `docPath` yield exactly one entry at the original position; array length does not grow
- **All functions are pure:** no filesystem I/O; callers supply and receive values

## Configuration

No configuration. Consumers import from `adws/core/conditionalDocsRegistry.ts`. `ProjectConfig` (loaded by `adws/core/projectConfig.ts`) exposes the parsed registry as `conditionalDocs`; the raw string is still available as `conditionalDocsMd` for LLM-facing consumers.

## Gotchas

- **`Owns:` block is required for routing:** legacy entries (conditions only, no `Owns:`) always return `undefined` from `findOwningEntry`. Convergence only activates for entries written by the rewritten `/document` going forward.
- **Glob scope:** `*` does not cross path separators — `adws/core/*.ts` does not match `adws/core/sub/file.ts`. Use `**` for recursive matches.
- **Preamble includes a trailing newline:** the parser captures the `# Conditional Documentation` header plus its trailing newline as `preamble`; the serializer emits `preamble + entries + '\n'`. Altering preamble whitespace breaks the round-trip test.
- **Entry serialization always emits a `Conditions:` block:** an entry with `conditions: []` serializes to a `  - Conditions:` line with no bullets — this is valid markdown but will produce an empty section in the index.
- **`adw_init.md` now emits `Owns:` blocks:** newly initialized repos produce entries in the new format so their indexes are convergent from day one. Older repos without `Owns:` globs are backward-compatible but will not route until their entries are regenerated.
