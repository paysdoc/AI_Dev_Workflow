# Feature: adwVersion deep module (`.adw-version` read/write)

## Metadata
issueNumber: `538`
adwId: `n9880l-adwversion-deep-modu`
issueJson: `{"number":538,"title":"adwVersion deep module","body":"## Parent PRD\n\n`specs/prd/adw-init-hash-and-label-classification.md`\n\n## What to build\n\nRead/write the `.adw-version` file at a target repo's worktree root. File format is plain SHA256 + trailing newline, no metadata. Missing file is treated as null on read.\n\nSee the \"Hash storage on target repos\" section of the parent PRD.\n\n## Acceptance criteria\n\n- [ ] `readAdwVersion(worktreePath)` returns the trimmed SHA when file exists\n- [ ] `readAdwVersion(worktreePath)` returns `null` when file is absent\n- [ ] `writeAdwVersion(worktreePath, hash)` writes the hash with trailing newline\n- [ ] Trailing whitespace and stray newlines in existing file are tolerated on read\n- [ ] Unit tests cover all branches\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\nFoundation module — indirectly supports user stories 1 and 2.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-08T11:10:44Z","comments":[],"actionableComment":null}`

## Feature Description

`adwVersion` is a small, pure, file-I/O **deep module** that owns all reading and writing of the `.adw-version` file at a target repo's worktree root. The file stores the SHA256 content hash that the target repo was last initialized with, in the simplest possible on-disk format: the plain hex SHA256 followed by a single trailing newline, with **no metadata, no JSON, no headers**.

The module exposes exactly two functions plus a filename constant:

- `readAdwVersion(worktreePath): string | null` — returns the trimmed hash recorded in `.adw-version`, or `null` when there is no usable recorded version (file absent, or present but empty/whitespace-only).
- `writeAdwVersion(worktreePath, hash): void` — writes the hash to `.adw-version` in the canonical "plain SHA256 + single trailing newline" format, overwriting any existing content.

This is the foundation slice of the parent PRD's versioned auto-(re)init system (`specs/prd/adw-init-hash-and-label-classification.md`). Per the PRD's "Hash storage on target repos" section, every orchestrator that runs against a target repo will eventually compare the framework's current content hash to the value stored in `.adw-version`; on mismatch it triggers an upgrade. This module is the storage primitive underneath that comparison. It is intentionally decoupled from the hash *computation* (a sibling `hashComputer` module in a later slice) and from the comparison logic itself (a later `initializeWorkflow()` change) — `adwVersion` only knows how to durably read and write the file.

The value to users (the framework operator) is indirect but load-bearing: a tiny, well-tested, total-function storage primitive that the entire propagate-framework-changes-to-target-repos feature is built on. Getting the read/write/normalization semantics exactly right here — especially "absent ⇒ null" and "tolerate stray whitespace" — is what lets the downstream comparison code stay simple and what lets first-bootstrap and upgrade collapse into a single code path.

## User Story

As the framework operator,
I want a single, well-tested module that reads and writes the `.adw-version` file at a target repo's worktree root with predictable, whitespace-tolerant semantics,
So that downstream orchestrator logic can reliably tell whether a target repo is on the current framework hash (and treat "never initialized" identically to "out of date") without re-implementing brittle file parsing at every call site.

## Problem Statement

The parent PRD replaces the fragile comment-regex `/adw_init` trigger with a versioned auto-(re)init system. That system needs durable per-target-repo storage of "what framework hash did this repo last initialize with?". The PRD specifies that storage as a `.adw-version` file at the repo root, deliberately kept **outside** `.adw/` so the LLM regeneration of `.adw/` cannot clobber it (mirroring the rationale for keeping the HITL opt-in in `.github/adw.yml`).

There is currently no code anywhere in the repo that reads or writes `.adw-version` (confirmed by search — this is greenfield). Without a single owning module:

- Every consumer would re-implement path joining, existence checks, trimming, and the trailing-newline format, inviting the exact identifier/format drift the README's "Worktree discovery and branch lookup" failure mode warns about.
- The crucial "absent file ⇒ `null`" semantic — which the PRD relies on to collapse first-bootstrap and upgrade into one path — would be inconsistently handled (some callers might get `''`, some `undefined`, some a thrown error).
- Stray whitespace or extra newlines (from a manual edit, an editor's "insert final newline", or a botched write) would silently produce a non-matching hash and either skip a needed upgrade or trigger a spurious one.

## Solution Statement

Add a new pure deep module `adws/core/adwVersion.ts` exposing `readAdwVersion`, `writeAdwVersion`, and an `ADW_VERSION_FILENAME` constant, and re-export them from `adws/core/index.ts`. The module is "deep" in Ousterhout's sense: a tiny interface (two functions over a `worktreePath`) hiding all the details — the literal filename, path assembly, existence handling, whitespace normalization, the absent/empty ⇒ `null` collapse, and the canonical write format.

Semantics:

- **Read** resolves `<worktreePath>/.adw-version`. If the file does not exist, return `null` (the PRD's "absent ⇒ null"). If it exists, read it as UTF-8, `.trim()` the content (tolerating leading/trailing whitespace and stray newlines per the acceptance criteria), and return the trimmed string — unless the trimmed result is empty, in which case return `null`. Treating a present-but-empty file as `null` unifies "never initialized" and "out of date" into one downstream code path, exactly as the PRD intends, and avoids handing callers a surprising `''` sentinel.
- **Write** resolves the same path and writes `<hash.trim()>\n` as UTF-8, overwriting any existing content. Trimming the input before appending exactly one newline guarantees the on-disk invariant the PRD requires ("plain SHA256 + trailing newline, no metadata") and guarantees round-trip stability: `readAdwVersion` after `writeAdwVersion(p, h)` returns `h.trim()`.

Design choices, justified:

- **Location `adws/core/`** (not `adws/vcs/`): `.adw-version` is a plain text file read/written by path; this is not a git operation. The module mirrors existing `core/` file helpers (`stateHelpers.ts`, `projectConfig.ts`, `targetRepoManager.ts`), and the parent PRD's testing section explicitly points at `core/__tests__/` for the prior-art fixture-driven test pattern and groups `adwVersion` with the `hashComputer` "pure deep module". `vcs/` is reserved for branch/commit/worktree git operations.
- **Guard-clause read, no broad error swallowing**: existence is handled with an early-return guard. Genuine I/O failures on an *existing* file (permissions, etc.) are real problems and are allowed to propagate rather than being masked as `null`. Only "absent" maps to `null`, matching the acceptance criteria precisely. There is no JSON/parse step that could fail, so the `try/catch ⇒ null` pattern used by `stateHelpers.readStateFile` (which guards malformed JSON) is unnecessary here and would hide bugs.
- **No directory creation on write**: `worktreePath` is always an existing checked-out worktree root when this is called, so `writeAdwVersion` does not `mkdir`. This keeps the module shallow-coupled and side-effect-minimal.

No new dependencies — only Node built-ins (`fs`, `path`).

## Relevant Files

Use these files to implement the feature:

- `specs/prd/adw-init-hash-and-label-classification.md` — Parent PRD. The "Hash storage on target repos" section (lines ~63-66) defines the file location, format, and the absent ⇒ null rule; the "Testing Decisions → adwVersion" section enumerates the exact behaviors this module must satisfy. Authoritative source of truth for this slice.
- `adws/core/stateHelpers.ts` — Reference for the established `core/` file-I/O idiom: `import * as fs from 'fs'`, `import * as path from 'path'`, `fs.existsSync` guard before `fs.readFileSync(..., 'utf-8')`, JSDoc on exported functions, guard-clause style. Mirror this structure (without the JSON parsing).
- `adws/core/__tests__/projectConfig.test.ts` — Reference for the temp-directory fixture test pattern this module's tests must follow: `mkdtempSync(join(tmpdir(), 'prefix-'))`, `writeFileSync`, cleanup, vitest `describe`/`it`/`expect`.
- `adws/core/__tests__/stateHelpers.test.ts` — Reference for `afterEach` cleanup of filesystem fixtures (`fs.rmSync(dir, { recursive: true, force: true })`) and per-test unique directory naming.
- `adws/core/index.ts` — The core module barrel. The two new functions and the `ADW_VERSION_FILENAME` constant must be re-exported here so consumers import from `../core` (the codebase convention; e.g. `worktreeQuery.ts` imports from `../core`).
- `.adw/project.md` — Confirms `## Unit Tests: enabled`, so unit-test tasks are in scope; confirms `## Library Install Command: bun add <package>`.
- `.adw/commands.md` — Source of the exact validation commands (lint, type-check, unit test, build).
- `.adw/coding_guidelines.md` — Mandatory coding guidelines (clarity over cleverness, immutability, purity, guard clauses, max nesting depth ~2, type safety, no decorators, files < 300 lines).
- `vitest.config.ts` — Confirms tests at `adws/**/__tests__/**/*.test.ts` are auto-discovered; no config change needed.

### New Files

- `adws/core/adwVersion.ts` — The deep module: `ADW_VERSION_FILENAME` constant, `readAdwVersion(worktreePath: string): string | null`, `writeAdwVersion(worktreePath: string, hash: string): void`. Pure file-I/O, Node built-ins only.
- `adws/core/__tests__/adwVersion.test.ts` — Vitest unit tests covering every branch (file present/absent/empty, whitespace tolerance, write newline format, overwrite, round-trip, input normalization).

## Implementation Plan

### Phase 1: Foundation
Create the `adwVersion.ts` module with the `ADW_VERSION_FILENAME` constant and the two function signatures, fully typed against TypeScript strict mode (`string | null` return on read, `void` on write; no `any`). Establish the import surface (`fs`, `path`) and module-level JSDoc explaining the file format and the absent/empty ⇒ null rule. This phase defines the public interface that the rest of the PRD's slices will depend on.

### Phase 2: Core Implementation
Implement `readAdwVersion` (existence guard → read UTF-8 → trim → empty ⇒ null) and `writeAdwVersion` (trim input → append single newline → write UTF-8, overwrite). Keep both functions flat (guard clauses, max depth ~2, no nested conditionals). Write the unit test suite in lockstep, asserting against real temp-directory fixtures so the tests exercise actual filesystem behavior rather than mocks.

### Phase 3: Integration
Re-export `readAdwVersion`, `writeAdwVersion`, and `ADW_VERSION_FILENAME` from `adws/core/index.ts` following the existing barrel grouping/comment style, so downstream slices (the `initializeWorkflow()` hash check, `adwUpgrade.tsx`) can `import { readAdwVersion, writeAdwVersion } from '../core'`. No existing call sites change in this slice — this module is consumed by later issues. Run the full validation command set to confirm zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Create the `adwVersion.ts` module skeleton
- Create `adws/core/adwVersion.ts`.
- Add a module-level JSDoc block describing: the `.adw-version` file, its location at the worktree root, the canonical format ("plain SHA256 + single trailing newline, no metadata"), and the "absent or empty ⇒ null" read rule. Reference the parent PRD's "Hash storage on target repos" section.
- Add imports: `import * as fs from 'fs';` and `import * as path from 'path';`.
- Export a constant `export const ADW_VERSION_FILENAME = '.adw-version';`.

### Step 2: Implement `readAdwVersion`
- Signature: `export function readAdwVersion(worktreePath: string): string | null`.
- Resolve the file path with `path.join(worktreePath, ADW_VERSION_FILENAME)`.
- Guard clause: if `!fs.existsSync(filePath)` return `null`.
- Read the file as UTF-8, `.trim()` the content (tolerates leading/trailing whitespace and stray newlines).
- Return `null` when the trimmed value is empty; otherwise return the trimmed value.
- Add JSDoc documenting params, return, and the absent/empty ⇒ null behavior.

### Step 3: Implement `writeAdwVersion`
- Signature: `export function writeAdwVersion(worktreePath: string, hash: string): void`.
- Resolve the file path with `path.join(worktreePath, ADW_VERSION_FILENAME)`.
- Write `` `${hash.trim()}\n` `` as UTF-8 with `fs.writeFileSync`, overwriting existing content (no append).
- Add JSDoc documenting params and the canonical "trimmed hash + single trailing newline" write format, and noting it assumes `worktreePath` already exists.

### Step 4: Re-export from the core barrel
- In `adws/core/index.ts`, add a grouped export block (matching the file's existing commented-section style), e.g.:
  - `// ADW version file (.adw-version) read/write`
  - `export { ADW_VERSION_FILENAME, readAdwVersion, writeAdwVersion } from './adwVersion';`

### Step 5: Write unit tests
- Create `adws/core/__tests__/adwVersion.test.ts`.
- Use the `projectConfig.test.ts` / `stateHelpers.test.ts` fixture pattern: create a unique temp worktree dir per test with `mkdtempSync(join(tmpdir(), 'adw-version-'))`; remove it in `afterEach` with `rmSync(dir, { recursive: true, force: true })`.
- Implement all test cases listed in the Testing Strategy below, covering every branch of both functions.

### Step 6: Validate
- Run every command in the `Validation Commands` section below and confirm each passes with zero errors and zero regressions.

## Testing Strategy

### Unit Tests
`.adw/project.md` contains `## Unit Tests: enabled`, so unit tests are in scope. Tests live in `adws/core/__tests__/adwVersion.test.ts` and run under Vitest (`bun run test:unit` → `vitest run`), auto-discovered via the `adws/**/__tests__/**/*.test.ts` include glob in `vitest.config.ts`.

The suite isolates this one module using real temp-directory fixtures (no mocks), asserting on observable behavior (returned values and on-disk bytes). Cases — one assertion focus each — covering every branch:

1. **Read returns trimmed SHA when file exists** — write `<sha>\n` to `<dir>/.adw-version`; `readAdwVersion(dir)` returns `<sha>` exactly.
2. **Read returns `null` when file absent** — fresh empty temp dir, no `.adw-version`; `readAdwVersion(dir)` returns `null`.
3. **Read tolerates trailing whitespace and stray newlines** — file content `"<sha>  \n\n\n"`; returns `<sha>`.
4. **Read tolerates surrounding whitespace** — file content `"\n  <sha>\t\n"`; returns `<sha>`.
5. **Read returns `null` for an empty file** — file content `""`; returns `null` (present-but-no-value collapses to null).
6. **Read returns `null` for a whitespace-only file** — file content `"\n  \t\n"`; returns `null`.
7. **Write produces exactly "hash + single newline"** — `writeAdwVersion(dir, sha)`; read raw bytes back and assert they equal `` `${sha}\n` `` (no metadata, exactly one trailing newline).
8. **Write overwrites existing content** — write a long value then a shorter value; raw file equals only `` `${short}\n` `` with no leftover bytes from the first write.
9. **Round-trip** — `writeAdwVersion(dir, sha)` then `readAdwVersion(dir)` returns `sha`.
10. **Write normalizes a hash passed with surrounding whitespace** — `writeAdwVersion(dir, "  <sha>\n")`; raw file equals `` `${sha}\n` `` and round-trips to `<sha>`.

Use a realistic 64-char hex string as the sample SHA256 (e.g. a literal constant) so the tests reflect real input shape.

### Edge Cases
- `.adw-version` absent entirely → `null` (covered by case 2). This is the first-bootstrap path the PRD collapses with the upgrade path.
- `.adw-version` present but empty or whitespace-only → `null` (cases 5, 6).
- Existing file has trailing/leading whitespace or multiple newlines (manual edit, editor "insert final newline") → tolerated on read (cases 3, 4).
- `writeAdwVersion` called when `.adw-version` already exists → full overwrite, no stale trailing bytes (case 8).
- Caller passes a hash that itself carries whitespace/newline → normalized on write so the on-disk format invariant holds (case 10).
- (Documented, not unit-asserted) Read of an *existing* file that fails for a non-absence reason (e.g. permissions) propagates the error rather than masking it as `null`; only absence maps to `null`.

## Acceptance Criteria
- `readAdwVersion(worktreePath)` returns the trimmed SHA when `.adw-version` exists with content.
- `readAdwVersion(worktreePath)` returns `null` when `.adw-version` is absent.
- `readAdwVersion(worktreePath)` returns `null` when `.adw-version` is present but empty/whitespace-only.
- `writeAdwVersion(worktreePath, hash)` writes the hash followed by exactly one trailing newline, overwriting any existing content, in plain format with no metadata.
- Trailing/leading whitespace and stray newlines in an existing `.adw-version` are tolerated on read (the trimmed SHA is returned).
- `writeAdwVersion` then `readAdwVersion` round-trips to the trimmed input hash.
- `readAdwVersion`, `writeAdwVersion`, and `ADW_VERSION_FILENAME` are exported from `adws/core/index.ts`.
- Unit tests cover all branches and pass; the full unit-test suite passes with zero regressions.
- `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, and `bun run build` all succeed.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx vitest run adws/core/__tests__/adwVersion.test.ts` — Run the new module's unit tests in isolation; all cases pass.
- `bun run test:unit` — Run the full Vitest suite (`vitest run`); the new tests pass and no existing tests regress.
- `bun run lint` — ESLint passes with no errors on the new files.
- `bunx tsc --noEmit` — Root type-check passes (strict mode, no `any`).
- `bunx tsc --noEmit -p adws/tsconfig.json` — `adws/` project type-check passes.
- `bun run build` — `tsc` build succeeds with no errors.

(Commands sourced from `.adw/commands.md`: Run Linter `bun run lint`, Type Check `bunx tsc --noEmit`, Run Tests `bun run test:unit`, Run Build `bun run build`, Additional Type Checks `bunx tsc --noEmit -p adws/tsconfig.json`.)

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) are mandatory: clarity over cleverness, immutability, purity (this module's logic is a thin, deterministic wrapper over `fs`), type safety (strict mode, no `any`, explicit `string | null`), guard clauses with max nesting depth ~2, JSDoc on public functions, no decorators, file well under 300 lines.
- **No new dependencies.** Only Node built-ins (`fs`, `path`) are used; nothing to install. (For reference, `.adw/project.md` library install command is `bun add <package>`.)
- **Deep-module framing.** The issue title calls this a "deep module": keep the interface minimal (two functions + one constant) and let the module own all the format/normalization details. Resist exposing helpers like a separate "path builder" or "trim" function — those are implementation details, not interface.
- **Scope boundary.** This slice is *only* the storage primitive. It deliberately does **not** compute the framework hash (sibling `hashComputer` module, later slice), does **not** modify `initializeWorkflow()` (later slice — note: the conditional-docs hit on `initializeWorkflow()` belongs to an unrelated robustness-hardening feature and does not apply here), and does **not** touch `adwUpgrade.tsx` or any trigger. No existing call sites change.
- **Future consumers.** Per the parent PRD, the upcoming `initializeWorkflow()` hash check will call `readAdwVersion(worktreePath)` and compare against the freshly computed framework hash; `adwUpgrade.tsx` will call `writeAdwVersion(worktreePath, freshHash)` after regenerating `.adw/`. The "absent/empty ⇒ null" semantic is what lets the comparison treat never-initialized and out-of-date repos identically (single code path).
- **File placement rationale.** `.adw-version` lives at the worktree/repo **root**, intentionally outside `.adw/`, so the LLM regeneration of `.adw/` during an upgrade cannot clobber the recorded version (PRD "Hash storage on target repos"). This module joins `ADW_VERSION_FILENAME` onto the caller-supplied `worktreePath`; callers are responsible for passing the worktree root.
