# Feature: app_docs Living Docs — Convergence Core (rewrite-in-place, no append)

## Metadata
issueNumber: `609`
adwId: `o4qdu5-app-docs-living-docs`
issueJson: `{"number":609,"title":"app_docs living-docs: convergence core (rewrite-in-place, no append)","body":"## Parent PRD\n\n`specs/prd/app-docs-module-living-docs.md`\n\n## What to build\n\nThe thinnest complete path that proves per-module living docs. Build a registry module that parses `.adw/conditional_docs.md` into structured entries (doc path, conditions, owned file globs) and serializes them back to markdown (today the index is read as a raw string). Rewrite `/document` so that, on an area that an existing entry already owns, it **rewrites that module doc in place to a current-state reference** (not an appended per-run snapshot) and **updates the single existing entry** — matched by explicit file globs (semantic matching is deferred to a later slice). Never append a second entry for an already-covered area.\n\nEnd-to-end outcome: running `/document` twice on the same area yields one converged module doc and one index entry, not a duplicate.\n\n## Acceptance criteria\n\n- [ ] Registry module parses `conditional_docs.md` to structured entries and serializes back losslessly (vitest)\n- [ ] `/document` rewrites an owning module doc in place in current-state format (no per-feature history / changelog sections)\n- [ ] A `/document` run on an area owned by an existing entry updates that entry rather than appending a new one\n- [ ] BDD content-assertion scenario (`@adw-{issue}`): two runs on one area produce exactly one doc + one entry\n- [ ] Registry module replaces the raw-string read in project config consumers\n\n## Blocked by\n\nNone - can start immediately\n\n\n- ## User stories addressed\n\n- User story 1\n- User story 2\n- User story 3\n- User story 4\n- User story 9\n- User story 13\n- User story 15\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-17T08:20:38Z","comments":[{"author":"paysdoc","createdAt":"2026-06-19T10:05:46Z","body":"## continue"}],"actionableComment":null}`

## Feature Description

ADW's `/document` phase currently writes one immutable per-run snapshot doc (`app_docs/feature-{adwId}-*.md`) and **appends one new entry per run** to `.adw/conditional_docs.md`. That index is read in full by `/prime` and every planning run, so its always-paid token cost grows without bound (today ~191 entries / ~1558 lines / ~46K tokens). Re-running `/document` on the same area produces near-duplicate docs and overlapping index entries; planning then loads several superseded snapshots when only the newest is current truth.

This feature ships the **convergence core**: the thinnest complete path that turns `/document` from append-only into rewrite-in-place. It introduces a single tested **registry module** that parses `conditional_docs.md` into structured entries (doc path, owned file globs, conditions) and serializes them back losslessly, and rewrites the `/document` prompt so that — when the touched files fall under an entry that already owns them (matched by **explicit file globs**) — it rewrites that owning module doc in place to a current-state reference and updates the single existing entry, never appending a second one. When no entry owns the area, it creates exactly one new module doc plus one new entry that carries explicit owned globs so future runs converge onto it.

The value: prime/planning cost becomes bounded by module count instead of feature count, a module's doc yields current truth instead of a stack of snapshots, and convergence becomes a structural side-effect of normal operation rather than a recurring manual cleanup. The same behavior ships to every registered target repo via the existing `.adw/` hash-regeneration path.

**Scope boundary (thin slice):** this issue addresses user stories 1, 2, 3, 4, 9, 13, 15. Matching is **glob-only**; semantic routing (PRD routing strategy), the deterministic bloat/regrowth **guards module** (stories 11/12), multi-sibling **collapse** (story 5), and the one-off **migration** of the existing 191 docs (story 8) are explicitly out of scope and deferred to later slices.

## User Story

As a `/document` agent (and the planning agents downstream of it),
I want to route a documented change to the module doc/entry that already owns the touched files and rewrite both in place to current truth,
So that the conditional-docs index converges to one entry per module — keeping `/prime` cost flat and giving readers current-state docs instead of a pile of superseded per-run snapshots.

## Problem Statement

`/document` (`.claude/commands/document.md`) is append-only:

1. Step 4 writes a new snapshot file `app_docs/feature-{adwId}-{name}.md` every run, in a per-run format (`ADW ID`, `Date`, `What Was Built`, `Files Modified`) that reads as historical record, not current state.
2. Step 5 unconditionally **adds** a new entry to `.adw/conditional_docs.md` ("Add an entry for the new documentation file").

Consequently the index grows one entry per run forever, re-running an issue creates duplicate docs/entries, and `.adw/conditional_docs.md` is consumed everywhere as an **unstructured raw string** (`ProjectConfig.conditionalDocsMd` in `adws/core/projectConfig.ts`), so there is no programmatic representation of the index that `/document` could use to detect "this area is already covered." There is no notion of an entry *owning* a set of files, so nothing can decide whether a change belongs to an existing module.

## Solution Statement

Introduce a pure, deeply-tested **registry module** (`adws/core/conditionalDocsRegistry.ts`) that is the single source of truth for the index format:

- `parseConditionalDocs(content)` → structured `ConditionalDocsRegistry` (preamble + ordered entries, each `{ docPath, ownedGlobs, conditions }`), tolerant of today's legacy entries that carry only `Conditions:` (no `Owns:` block).
- `serializeConditionalDocs(registry)` → markdown, round-trip lossless with the parser.
- `findOwningEntry(registry, changedFilePaths)` → the entry whose owned globs match a changed file (glob-only ownership; deterministic first-match).
- `upsertEntry(registry, entry)` → pure update: replace the same-`docPath` entry in place (preserving position) or append when novel. This is the convergence primitive — two upserts of the same owned area yield exactly one entry.

A small pure glob matcher (`**`, `*`, `?` → `RegExp`) backs `findOwningEntry`; no new dependency (the repo has no glob library and `vitest run` executes under Node, so `Bun.Glob` is not relied on).

Wire the registry into `adws/core/projectConfig.ts` so the index is **parsed via the registry** instead of stored only as a raw string (replacing the raw-string read), exposing a structured `conditionalDocs` field on `ProjectConfig`.

Rewrite `.claude/commands/document.md` to converge: identify touched files from the diff, match them against entries' owned globs; **on match** rewrite the owning module doc in place to a current-state reference (no history/changelog) and update that single entry (regenerate its conditions, ensure its owned globs cover the touched files) — never append a second entry; **on no match** create one new module doc + one new entry that carries explicit owned globs. Replace the per-run doc template with a current-state module template.

Add `.claude/commands/document.md` to the framework **hash inputs** (`.claude/commands/adw_init.md` frontmatter) so the rewritten prompt propagates to all registered target repos via the existing `.adw/` regeneration path (story 15).

Prove the behavior with a per-issue BDD scenario file (`features/per-issue/feature-609.feature`, tagged `@adw-609`): artefact-driven content-assertions on the *produced* convergence output — seed a fixture `.adw/conditional_docs.md` (with owned globs) plus its `app_docs/` docs in a temp worktree, drive the registry-backed rewrite-in-place convergence path over a touched-file set (doc body stubbed), and assert the produced index/docs: a run on an already-owned area updates the single owning entry (no second entry/doc appended), two runs on one area converge to exactly one doc + one entry, the rewritten module doc carries no per-feature history/changelog section, unrelated sibling entries survive unchanged, and a genuinely novel area still yields exactly one new doc + entry — plus a type-check backstop for the registry/`projectConfig` wiring. Per the rot-prevention rubric (`app_docs/feature-mzgyjj-rot-prevention-block.md`), the scenario asserts produced-artefact outcomes only; it does **not** read `.claude/commands/document.md` or any registry source file as text.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/app-docs-module-living-docs.md` — Parent PRD. Defines the doc model, registry-as-index, convergence behavior, testing decisions, and explicit out-of-scope. The authority for what this slice does and does not include.
- `.adw/conditional_docs.md` — The index being parsed/serialized. Confirm the current entry shape: top-level `- <docPath>` lines (e.g. `app_docs/feature-*.md`, but also `README.md`, `adws/README.md`), a `  - Conditions:` sub-block with `    - When …` bullets, a `# Conditional Documentation` preamble, and **no** existing `Owns:`/glob field (this slice introduces it).
- `adws/core/projectConfig.ts` — Loads `.adw/*` config. Holds `ProjectConfig.conditionalDocsMd` (raw string, lines 86–87, 201, 438–445, 481) — the raw-string read this feature replaces. Mirror the existing parser-module wiring (`parseScenariosMd`, `parseReviewProofMd`) when adding the registry call.
- `adws/core/__tests__/projectConfig.test.ts` — Existing vitest for the loader; extend for the new structured `conditionalDocs` field.
- `adws/phases/__tests__/scenarioTestPhase.test.ts` — Line 93 mocks a `ProjectConfig` with `conditionalDocsMd: ''`; update this mock to include the new field so type/tests stay green.
- `adws/core/testVerdict.ts` and `adws/core/testReportParser.ts` — Prior art for a pure `adws/core` module (inline types + pure functions, isolated I/O). Mirror their shape for the registry module.
- `adws/core/__tests__/testVerdict.test.ts` and `adws/core/__tests__/testReportParser.test.ts` — Prior art for pure-function vitest tests (nested `describe`/`it`, input→output cases). Mirror for the registry tests.
- `adws/promotion/vocabularyParser.ts`, `adws/promotion/scenarioParser.ts` — Prior art for markdown/Gherkin parser modules with a `parse(content) → structured` signature.
- `.claude/commands/document.md` — The `/document` prompt to rewrite (append-only step 5 at lines 48–55; per-run doc template at lines 57–116; legacy entry-format block at lines 118–128).
- `adws/agents/documentAgent.ts` — The runner wrapping `/document`. Confirm no code change is required (it forwards `adwId/specPath/screenshotsDir` and returns the doc path); the rewrite is prompt-level only.
- `.claude/commands/adw_init.md` — Frontmatter `hashInputs:` list (lines 3–5) to extend with `.claude/commands/document.md`; also generates `.adw/conditional_docs.md` for new target repos (steps ~75–79) and is itself a hash input.
- `adws/core/hashComputer.ts` and `adws/core/__tests__/hashComputer.test.ts` — How the framework hash is computed from `hashInputs`; the real-repo smoke test recomputes it. Adding a file to `hashInputs` must keep these passing.
- `cucumber.js` — Confirms `features/per-issue/**/*.feature` are discovered and `features/per-issue/step_definitions/**/*.ts` imported, so a new `@adw-609` per-issue scenario is runnable via `--tags "@adw-609"`.
- `features/per-issue/feature-506.feature` and `features/per-issue/step_definitions/feature-506.steps.ts` — Prior art for a content-assertion + artefact-driven per-issue scenario (tag-scoped `Before`/`After`, plain `assert`, imports from `adws/`/`test/`). Closest template for `feature-609`.

Conditional docs to read for context (matched against this task's touched areas):

- `app_docs/feature-670i6z-dead-schema-cleanup.md` and `app_docs/feature-zyaojl-configurable-test-directory.md` — The `adws/core/projectConfig.ts` three-touch-point pattern (interface field + heading map + default) for adding/parsing a config field cleanly.
- `app_docs/feature-the-adw-is-too-speci-tf7slv-generalize-adw-project-config.md` — Working with `.adw/` project config files and `.claude/commands/*.md` templates / `projectConfig.ts`.
- `app_docs/feature-mzgyjj-rot-prevention-block.md` — Rot-prevention rubric for authoring the per-issue BDD scenario (avoid asserting raw file-existence / literal-substring / AST structure as the *only* check; assert observable outcomes / module behavior).
- `app_docs/feature-ih7bza-receipt-based-regen-proof.md` and `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` — Consequences of changing a `hashInput` (the `.adw-version` / `.regen-receipt` re-stamp and the `.adw/` regeneration/propagation path).

### New Files

- `adws/core/conditionalDocsRegistry.ts` — The pure registry module: types (`ConditionalDocEntry`, `ConditionalDocsRegistry`) + `parseConditionalDocs`, `serializeConditionalDocs`, `findOwningEntry`, `upsertEntry`, and a private glob matcher. Single source of truth for the index format. Keep under 300 lines (coding guideline); if the glob matcher grows, split it to `adws/core/globMatch.ts`.
- `adws/core/__tests__/conditionalDocsRegistry.test.ts` — Pure-function vitest: parse/serialize round-trips, legacy-entry tolerance, malformed-entry handling, ownership/glob matching, upsert update-in-place vs append.
- `features/per-issue/feature-609.feature` — Per-issue BDD scenario (`@adw-609`): artefact-driven content-assertions on the *produced* convergence output (one doc + one entry on an owned area, two runs → one doc + one entry, no changelog/history in the rewritten doc, siblings preserved, novel area → one new doc + entry) plus a type-check backstop — produced-artefact outcomes only, no source-file substring assertions.
- `features/per-issue/step_definitions/feature-609.steps.ts` — Step definitions for `feature-609.feature` (tag-scoped hooks; reads the `/document.md` artefact and drives the registry module in-process).

## Implementation Plan

### Phase 1: Foundation — the registry module

Establish the structured representation of `.adw/conditional_docs.md` as a pure, tested module before touching any consumer. Define the entry/registry types and the parse ⇄ serialize contract (lossless round-trip), the glob-based ownership query, and the pure upsert primitive that makes convergence possible. This module is the single source of truth the prompt rewrite and the BDD scenario both rely on, and it is the unit-testable core that lifts the convergence decision out of the LLM.

### Phase 2: Core Implementation — convergence in `/document` + config wiring

Wire the registry into `adws/core/projectConfig.ts` (replace the raw-string read with a parsed `conditionalDocs` field). Rewrite `.claude/commands/document.md` from append-only to convergent: glob-match touched files against owned entries, rewrite the owning module doc in place to a current-state reference, update the single owning entry (regenerate conditions, ensure owned globs cover the change), and only create a new doc+entry for a genuinely novel area. Replace the per-run snapshot doc template with a current-state module template (no history/changelog).

### Phase 3: Integration — propagation + verification

Add `.claude/commands/document.md` to the framework `hashInputs` so the rewrite propagates to all registered target repos through the existing `.adw/` regeneration path. Author the `@adw-609` per-issue BDD scenario proving the convergence properties, then run the full validation suite (lint, type-check, vitest, build, `@adw-609` scenarios) for zero regressions.

## Step by Step Tasks

Execute every step in order, top to bottom. Tests are written before (or alongside) the implementation they cover (RED → GREEN), per ADW's BDD/TDD convention.

### 1. Define the registry types and contract

- In `adws/core/conditionalDocsRegistry.ts`, define inline types (mirror `testVerdict.ts` style — explicit, no `any`):
  - `export interface ConditionalDocEntry { docPath: string; ownedGlobs: string[]; conditions: string[]; }`
  - `export interface ConditionalDocsRegistry { preamble: string; entries: ConditionalDocEntry[]; }`
- Document the canonical serialized entry format in a module-level comment:
  ```
  - <docPath>
    - Owns:
      - <glob>
    - Conditions:
      - <condition line, verbatim incl. backticks>
  ```
  with the `Owns:` block omitted when `ownedGlobs` is empty (legacy compatibility), entries separated by a single blank line, and `preamble` holding the `# Conditional Documentation` header text above the first entry.

### 2. Write registry unit tests (RED)

- Create `adws/core/__tests__/conditionalDocsRegistry.test.ts` (nested `describe`/`it`, table-style cases like `testReportParser.test.ts`):
  - **Round-trip:** `serializeConditionalDocs(parseConditionalDocs(canonical)) === canonical` and `parseConditionalDocs(serializeConditionalDocs(registry))` deep-equals `registry`, for a canonical fixture that includes both a new-format entry (with `Owns:`) and a legacy entry (Conditions only).
  - **Legacy tolerance:** an entry with no `Owns:` block parses to `ownedGlobs: []` and serializes back unchanged.
  - **Non-`app_docs` docPath:** `README.md` / `adws/README.md` entries parse and serialize faithfully.
  - **Preamble preserved:** `# Conditional Documentation` header survives round-trip.
  - **Malformed/edge:** empty string → empty registry (empty preamble allowed); an entry missing `Conditions:` → `conditions: []` (no throw); blank lines between entries normalized to one.
  - **`findOwningEntry`:** returns the entry whose `ownedGlobs` matches a changed path (`adws/foo/**` matches `adws/foo/bar.ts`; `adws/foo/*.ts` matches `adws/foo/bar.ts` but not `adws/foo/sub/bar.ts`); returns `undefined` on no match and for legacy (empty-glob) entries; deterministic first-match when multiple entries match.
  - **`upsertEntry`:** replacing an entry with an existing `docPath` updates it **in place** (same array length, same index, new globs/conditions); a novel `docPath` appends (length + 1); calling `upsertEntry` twice for the same `docPath` yields exactly one entry (the convergence property).
  - **Glob matcher boundaries:** `**` spans path separators, `*` does not, `?` matches one char; literal segments and dots are matched literally.

### 3. Implement the registry module (GREEN)

- Implement `parseConditionalDocs`, `serializeConditionalDocs`, `findOwningEntry`, `upsertEntry`, and the private glob matcher in `adws/core/conditionalDocsRegistry.ts`.
  - Parser: split into a preamble + entries; a top-level `- ` line (no leading whitespace) starts a new entry (docPath = remainder); `  - Owns:` / `  - Conditions:` switch the active sub-list; `    - ` bullets append to the active list verbatim.
  - Serializer: emit `preamble`, then each entry as docPath, optional `Owns:` block, `Conditions:` block, joined by a single blank line; exactly one trailing newline.
  - `findOwningEntry`: pure; first entry where any `ownedGlobs` glob matches any changed path.
  - `upsertEntry`: pure/immutable; return a new registry, replacing the same-`docPath` entry in place or appending.
  - Glob matcher: pure; translate `**`→`.*`, `*`→`[^/]*`, `?`→`[^/]`, escape regex metachars in literal segments, anchor with `^…$`.
- Keep functions pure (no `fs`), declarative, and the file under 300 lines (extract `globMatch.ts` if needed). Run `bun run test:unit` until the Task-2 tests pass.

### 4. Wire the registry into `projectConfig.ts` (replace the raw-string read)

- In `adws/core/projectConfig.ts`:
  - Import `parseConditionalDocs` + `ConditionalDocsRegistry` from the registry module.
  - Add `conditionalDocs: ConditionalDocsRegistry` to the `ProjectConfig` interface (keep `conditionalDocsMd` for the existing LLM-facing/raw consumers, but the structured field is the new programmatic surface — this is the "registry replaces the raw-string read").
  - In `loadProjectConfig`, parse the file content through `parseConditionalDocs` (mirroring how `scenariosMd` is both stored raw and parsed via `parseScenariosMd`) and populate `conditionalDocs`.
  - In `getDefaultProjectConfig`, set `conditionalDocs: parseConditionalDocs('')` (empty registry).
- Update `adws/core/__tests__/projectConfig.test.ts` to assert the structured `conditionalDocs` field is populated from a sample `.adw/conditional_docs.md` and is an empty registry when the file is absent.
- Update the `ProjectConfig` mock at `adws/phases/__tests__/scenarioTestPhase.test.ts:93` to include `conditionalDocs: parseConditionalDocs('')` (or an equivalent empty registry) so types and tests stay green.

### 5. Rewrite the `/document` prompt to converge (rewrite-in-place, no append)

- Rewrite `.claude/commands/document.md`:
  - **Analyze changes** (keep): derive the list of touched files from `git diff origin/main --name-only`.
  - **Route by ownership (new):** read `.adw/conditional_docs.md`; match the touched files against each entry's `Owns:` globs (explicit file globs only — state plainly that semantic matching is out of scope for this slice).
  - **On match (area already owned):** rewrite that entry's module doc **in place** to a current-state reference describing what the module does *now* (responsibilities, contracts/invariants, configuration, gotchas) — **no** `What Was Built` / `Files Modified` / per-run history / changelog / `ADW ID` / `Date` sections. Update the **single** existing entry: regenerate its `Conditions:` from current truth and ensure its `Owns:` globs cover the touched files. **Never append a second entry** for an already-owned area.
  - **On no match (novel area):** create exactly one new module doc (current-state template) and append exactly one new entry that includes an explicit `Owns:` glob block for the touched area, so subsequent runs converge onto it.
  - Replace the per-run "Documentation Format" template (lines 57–116) with a **current-state module reference** template (Overview / Responsibilities / Contracts & Invariants / Configuration / Gotchas). Keep the screenshots handling.
  - Replace the legacy "Conditional Docs Entry Format" block (lines 118–128) with the new format including the `Owns:` glob sub-block, and **delete** the append-only step 5 instruction ("Add an entry for the new documentation file").
  - Keep the final-output contract (return only the doc path) and the report section.
- Confirm `adws/agents/documentAgent.ts` needs **no** change (it only forwards args and returns the path) — note this explicitly in the PR.

### 6. Propagate via hash inputs

- Add `.claude/commands/document.md` to the `hashInputs:` list in `.claude/commands/adw_init.md` frontmatter (so the prompt rewrite triggers `.adw/` regeneration across registered target repos — story 15).
- (Consistency, low-touch) In `.claude/commands/adw_init.md`, update the `.adw/conditional_docs.md` generation guidance so newly-initialized repos emit entries in the new format (include an `Owns:` glob block per module). This keeps generated indexes convergent from day one.
- Run `adws/core/__tests__/hashComputer.test.ts` (`bun run test:unit`) to confirm the new `hashInputs` entry resolves and the real-repo smoke test still computes a stable digest.

### 7. Author the `@adw-609` BDD scenario (RED → GREEN)

- Create `features/per-issue/feature-609.feature` (tagged `@adw-609`, following the `feature-506` shape). Per the rot-prevention rubric (`app_docs/feature-mzgyjj-rot-prevention-block.md`), every assertion targets an artefact the system **produces** (the converged `conditional_docs.md` index and the `app_docs/` module docs written into a temp fixture worktree, or the type-checker's verdict) — **no assertion reads `.claude/commands/document.md` or any registry source file as text, substring-matches it, or parses it as AST**. Cover, as separate scenarios:
  - **§1 No append on an already-owned area (AC3):** given an index that already owns `adws/vcs/**` with one module doc, a `/document` run touching `adws/vcs/worktreeReset.ts` leaves exactly one entry owning that area and exactly one module doc — no second entry/doc appended.
  - **§2 Two runs converge to one doc + one entry (AC4, headline):** given an index owning nothing in `adws/triggers/`, two `/document` runs on that area (the first creating the doc+entry, the second routing by glob to the now-owning entry) converge to exactly one module doc and one index entry.
  - **§3 Rewrite in place, current-state format (AC2):** the owning module doc is rewritten in place — exactly one doc covers the area and it carries **no** per-feature history / changelog section.
  - **§4 Convergence touches only the owning entry (AC1 observable proxy):** a run that converges one area leaves every unrelated module entry preserved unchanged (the registry serializes untouched entries losslessly; the raw parse/serialize round-trip itself is AC1's vitest scope, not re-asserted here).
  - **§5 Novel area still creates exactly one (boundary):** when no entry owns the touched area, a run creates exactly one new module doc and one new index entry.
  - **§6 Type-check backstop (AC5 wiring):** the ADW TypeScript type-check passes after the registry module replaces the raw-string index read in `projectConfig.ts`.
- Create `features/per-issue/step_definitions/feature-609.steps.ts`:
  - Tag-scoped `Before`/`After` (`@adw-609`) resetting per-scenario state (mirror `feature-506.steps.ts`).
  - Seed a temp worktree with a fixture `.adw/conditional_docs.md` whose entries carry explicit owned globs, plus the corresponding `app_docs/` docs (test input — **not** this repo's real source files).
  - Drive the **registry-backed rewrite-in-place convergence path** over the touched-file set by composing the registry module from `adws/core/conditionalDocsRegistry.ts` (`parseConditionalDocs` → `findOwningEntry` → `upsertEntry` → `serializeConditionalDocs`), with the LLM-authored doc **body stubbed** (an opaque precondition — the convergence counts are deterministic code and do not depend on prose). Write the produced index/docs into the fixture and assert the produced counts/shape: entries owning the area, module docs covering it, absence of a changelog section, survival of unrelated entries.
  - For §6, drive the type-check verdict (reuse registered phrases G18 `the ADW codebase is checked out` / T22 `the ADW TypeScript type-check passes`).
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-609"` — it should fail before the implementation lands (RED) and pass after (GREEN).

### 8. Validate

- Run every command in **Validation Commands** below; fix any failures until all pass with zero regressions.

## Testing Strategy

### Unit Tests

`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope.

- **`adws/core/__tests__/conditionalDocsRegistry.test.ts`** (new) — the heart of AC #1. Pure table-driven vitest over the registry's structured signature (markdown/structured in → structured/markdown/boolean out), asserting external behavior only:
  - Parse ⇄ serialize **lossless** round-trip (canonical fixture with both new-format and legacy entries; preamble preserved; single trailing newline).
  - Legacy-entry tolerance (no `Owns:` → `ownedGlobs: []`, serialize unchanged); non-`app_docs` doc paths; malformed entries (missing `Conditions:` → `[]`, no throw); empty input → empty registry; blank-line normalization.
  - `findOwningEntry` ownership matching (`**` vs `*` vs `?` boundaries; no-match → `undefined`; legacy/empty-glob entries never match; deterministic first-match).
  - `upsertEntry` update-in-place (same `docPath` → same length/index, fields replaced) vs append (novel `docPath` → length + 1); **idempotent convergence** (two upserts of one `docPath` → one entry).
  - Glob matcher boundary cases (separator handling, literal/dot escaping).
- **`adws/core/__tests__/projectConfig.test.ts`** (extend) — `conditionalDocs` is populated from a sample index and is an empty registry when the file is absent; raw `conditionalDocsMd` still loads.
- **`adws/core/__tests__/hashComputer.test.ts`** (run, no change expected) — confirms the added `hashInputs` entry resolves and the digest stays computable/stable.
- **`adws/phases/__tests__/scenarioTestPhase.test.ts`** (update mock) — add the new `conditionalDocs` field to the `ProjectConfig` mock so the suite type-checks and passes.

### Edge Cases

- Legacy entries with `Conditions:` but no `Owns:` block — parse to empty globs, never match by glob, serialize byte-identically.
- Doc paths that are not under `app_docs/` (`README.md`, `adws/README.md`) — handled as ordinary entries.
- Empty / absent `.adw/conditional_docs.md` — empty registry; `loadProjectConfig` does not throw.
- Conditions containing backticks, parentheses, or `/` — preserved verbatim through round-trip.
- A changed file matching **multiple** entries' globs — `findOwningEntry` is deterministic (first match in document order).
- `upsertEntry` with a `docPath` already present — exactly one entry remains (no duplicate), position preserved.
- Glob specificity — `adws/foo/*.ts` must **not** match `adws/foo/sub/bar.ts` (single-segment `*`), while `adws/foo/**` must.
- A `/document` run whose touched files span two owned modules — the prompt documents the predominantly-touched owning module (single owning entry updated); note this in the prompt as the thin-slice rule.

## Acceptance Criteria

- [ ] `adws/core/conditionalDocsRegistry.ts` parses `.adw/conditional_docs.md` into structured entries (doc path, owned globs, conditions) and serializes them back **losslessly**, verified by vitest round-trip tests.
- [ ] `/document` (`.claude/commands/document.md`) rewrites an owning module doc **in place** in current-state format — no per-feature history / `Files Modified` / changelog / `ADW ID` / `Date` sections.
- [ ] A `/document` run on an area owned by an existing entry (matched by explicit file globs) **updates that single entry** rather than appending a new one; the append-only instruction is removed.
- [ ] A `@adw-609` BDD scenario asserts that two runs on one owned area produce exactly **one doc + one entry**, and that a novel area produces exactly one new entry.
- [ ] The registry module **replaces the raw-string read** in `adws/core/projectConfig.ts` (structured `conditionalDocs` field populated via `parseConditionalDocs`).
- [ ] `.claude/commands/document.md` is added to `hashInputs` so the change propagates to registered target repos.
- [ ] All validation commands pass with zero regressions.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are taken from `.adw/commands.md`.

- `bun run lint` — ESLint across the repo (code quality / unused imports).
- `bunx tsc --noEmit` — Root type-check (strict mode; new types and `ProjectConfig` change compile cleanly).
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional `adws/` type-check.
- `bun run test:unit` — Vitest (`vitest run`): the new `conditionalDocsRegistry` suite plus extended `projectConfig`, `hashComputer`, and `scenarioTestPhase` suites pass with zero regressions.
- `bun run build` — `tsc` build to verify no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-609"` — Runs the per-issue convergence scenario(s); must pass (GREEN).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite remains green (no regressions from the `projectConfig`/`hashInputs` changes).

Note: in this repo `bun run test` is type-check only (`bunx tsc --noEmit`); the vitest runner is `bun run test:unit` (`vitest run`). Use `bun run test:unit` to execute the unit tests above.

## Notes

- **Coding guidelines** (`.adw/coding_guidelines.md`): keep the registry module pure (no `fs`), immutable (`upsertEntry`/serialize return new values), strongly typed (no `any`, explicit interfaces), and under ~300 lines (extract `globMatch.ts` if the matcher grows). Use guard clauses / extracted helpers to keep nesting ≤ 2 in the parser. No decorators.
- **No new dependency:** the repo has no glob library and `vitest run` executes under Node, so do **not** rely on `Bun.Glob`; implement the small pure glob matcher in-module. If a library is later deemed necessary, install via `bun add <package>` (per `.adw/commands.md`) and record it here.
- **Scope discipline (deferred to later slices, per PRD):** semantic routing (this slice is glob-only), the deterministic bloat/regrowth **guards module** (stories 11/12), multi-sibling **collapse** into one entry (story 5), the one-off **migration** of the existing 191 ADW docs (story 8), and regen-conditions guards (story 10). Do not implement these here; the registry module is intentionally shaped so they can build on `parseConditionalDocs`/`serializeConditionalDocs` later.
- **Backward compatibility:** the parser must read today's legacy entries (no `Owns:` block) without loss. Convergence kicks in only for entries that carry owned globs — i.e. entries written by the rewritten `/document` going forward. Existing legacy entries simply never glob-match (acceptable for the thin slice; semantic routing later closes that gap).
- **Propagation side-effect:** adding `.claude/commands/document.md` (and editing `adw_init.md`) changes the framework hash, which triggers the `.adw/` regeneration/upgrade path for this self-hosting repo and registered targets (see `app_docs/feature-ih7bza-receipt-based-regen-proof.md` and `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md`). This is the intended delivery mechanism for story 15; the upgrade orchestrator handles the `.adw-version` / `.regen-receipt` re-stamp.
- **`conditionalDocsMd` retained:** the raw string stays on `ProjectConfig` for the existing LLM-facing read path; the new structured `conditionalDocs` field is the programmatic surface that "replaces the raw-string read" for code consumers. A later slice can drop the raw field once no consumer needs it.
- **Per-issue scenario lifecycle:** `features/per-issue/feature-609.feature` is executed once as the `@adw-609` RED→GREEN proof during this issue's scenario test phase and is swept ~14 days after the PR merges (per the per-issue retention policy); it is not part of the periodic `@regression` run.
