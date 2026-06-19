# App Docs Post-Write Self-Check Guards

## Overview

This module adds a deterministic safety net over the `/document` convergence path: after each `/document` run rewrites a module doc, a post-write self-check runs two pure guards — **bloat** (a produced doc exceeds a line-count threshold, signalling the underlying module needs refactoring) and **regrowth** (two index entries whose owned globs overlap, indicating convergence produced a duplicate instead of routing to the existing entry). Both flags are logged to the orchestrator state; bloat flags are routed to a filed refactor issue, idempotent by title.

## Responsibilities

- Expose a pure guards module (`adws/core/docsGuards.ts`) with no I/O: given parsed `ConditionalDocEntry` records and doc sizes, compute `BloatFlag[]` and `RegrowthFlag[]`
- Provide a segment-aware glob-overlap test (`globsOverlap`) that correctly handles identical globs, nested globs, and sibling-disjoint roots, without false positives on legacy entries (`ownedGlobs: []`)
- Wire the self-check into `executeDocumentPhase` (`adws/phases/documentPhase.ts`) as a non-fatal post-write step: runs after `runDocumentAgent` succeeds, never prevents commit/push
- In `adws/phases/docsSelfCheck.ts`, read and parse `.adw/conditional_docs.md` via the registry module, measure produced doc sizes, run the guards, log both flag sets, and route each bloat flag to an idempotent refactor issue naming the area (owned globs)
- Export the threshold constant (`DOC_BLOAT_THRESHOLD_LINES = 400`) as the single source of truth used by both the wiring and the BDD fixtures

## Contracts & Invariants

- **Bloat boundary is strictly greater:** `lineCount > threshold` flags; `lineCount === threshold` does not
- **Legacy entries never cause regrowth flags:** entries with `ownedGlobs: []` are excluded from the pairwise overlap check — prevents ~190 false positives on the live index
- **Segment-aware overlap:** `globsOverlap('adws/core/**', 'adws/coreutils/**')` returns `false`; only a true segment-prefix relationship triggers overlap
- **Self-check is non-fatal:** any throw inside `executeDocsPostWriteSelfCheck` is caught in `documentPhase.ts` and logged as a warning; commit/push proceed regardless
- **Bloat routing is idempotent:** a second run that re-flags the same oversized doc checks for an open issue with the same title before filing a new one
- **Guards are pure:** `checkBloat`, `checkRegrowth`, `runDocsGuards`, and `globsOverlap` have no I/O; all side effects (fs read, `createIssue`, logging) are isolated to `docsSelfCheck.ts`

## Configuration

- `DOC_BLOAT_THRESHOLD_LINES` (exported from `adws/core/docsGuards.ts`): 400 lines. Intentionally a defined constant — retune here and all consumers (wiring + BDD fixtures) track the change automatically
- `DocsSelfCheckDeps` (in `adws/phases/docsSelfCheck.ts`): injectable interface with `readFile`, `createIssue`, `findExistingRefactorIssue`, and `log`; `buildDefaultDocsSelfCheckDeps()` wires the real fs / GitHub APIs. Inject in BDD tests to capture routed follow-ups and logged lines in-process

## Gotchas

- **Bloat is scoped to the current run's produced doc, not the whole `app_docs/` corpus.** Only `result.docPath` from the current `/document` run is measured; pre-existing oversized docs are not re-flagged unless they are rewritten in the current run
- **Regrowth is computed over the entire parsed index.** A new entry can overlap any existing one, so the full registry is always scanned
- **`*` vs `**` conservative overlap:** `adws/foo/*.ts` and `adws/foo/sub/**` share the same ownership root (`adws/foo`) and are flagged as overlapping. This is intentionally conservative — regrowth flags are advisory, not a hard gate. Sibling-root globs (`adws/vcs/**` vs `adws/core/**`) are never flagged
- **Refactor issue body names the area via `ownedGlobs`:** a bloat flag whose entry has no `ownedGlobs` falls back to the `docPath` as the area description
- **`/refactor` is not invoked inline.** It is blind to `app_docs/`; the correct remediation is a filed issue naming the module's source files that a human or later ADW cycle can act on
