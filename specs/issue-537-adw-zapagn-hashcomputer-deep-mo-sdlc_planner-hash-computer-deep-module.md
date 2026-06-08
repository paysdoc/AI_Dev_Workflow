# Feature: `hashComputer` deep module — framework content hash

## Metadata
issueNumber: `537`
adwId: `zapagn-hashcomputer-deep-mo`
issueJson: `{"number":537,"title":"hashComputer deep module","body":"## Parent PRD\n\n`specs/prd/adw-init-hash-and-label-classification.md`\n\n## What to build\n\nBuild a pure deep module that computes the framework's current content hash. Reads ```/adw_init.md``` frontmatter (adding the new `hashInputs:` field), resolves the listed files, concatenates their bytes in a canonical order, returns a SHA256 hex digest. Also includes the spec change to add the `hashInputs:` frontmatter to ```/adw_init.md``` itself.\n\nSee the \"Hash computation\" section of the parent PRD.\n\n## Acceptance criteria\n\n- [ ] ```/adw_init.md``` has a `hashInputs:` frontmatter field listing dependent files\n- [ ] `hashComputer` exposes a function that returns the SHA256 of the declared inputs\n- [ ] Missing `hashInputs:` frontmatter or missing referenced file raises a clear error\n- [ ] Hash is stable across file-list reordering (canonical order or sort)\n- [ ] Unit tests with fixture inputs cover normal path, missing-frontmatter, and missing-file\n- [ ] Changing any byte in any declared input changes the hash\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 3","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-08T11:10:40Z","comments":[{"author":"paysdoc","createdAt":"2026-06-08T11:18:06Z","body":"## continue"}],"actionableComment":null}`

## Feature Description

Build a pure, self-contained deep module — `hashComputer` — that computes the ADW framework's **current content hash**: a SHA256 hex digest over the byte content of an explicitly-declared set of framework files.

The set of files is declared **in the framework itself**, via a new `hashInputs:` YAML frontmatter field on `.claude/commands/adw_init.md` (referred to in the PRD as `/adw_init.md`). The module reads that frontmatter, resolves each declared path relative to the framework repo root, reads the bytes of each file in a canonical (sorted) order, feeds them into a SHA256 hash, and returns the hex digest.

This is the **foundational, lowest-risk slice** of the parent PRD (`specs/prd/adw-init-hash-and-label-classification.md`, "Hash computation" section). The hash it produces is the *contract* that later slices build on: a target repo stores the hash it last initialized with in a `.adw-version` file, and every orchestrator compares the framework's current hash (computed by this module) against that stored value to decide whether a target repo's `.adw/` config is stale and needs re-initialization. By declaring the input file list in the framework's own frontmatter, "adding a new dependency to the init process" and "bumping the version hash" become the *same PR* — it is impossible to add an init dependency and forget to include it in the hash (PRD User Story 3).

This issue delivers **only** the pure module plus the one-line spec change to `adw_init.md`. It does not wire the hash into any orchestrator, does not create `.adw-version`, and does not touch classification — those are later slices and are explicitly out of scope here.

## User Story

As the framework operator
I want a clear list of file dependencies for `/adw_init.md` declared in the spec itself, and a pure function that turns that list into a deterministic content hash
So that adding a new dependency is impossible to forget — the same PR that adds it updates the hash inputs — and downstream slices have a single, trustworthy "current framework version" primitive to compare against.

## Problem Statement

When the framework's `adw_init.md` spec or its dependencies (e.g., `templates/vocabulary.md.template`) change, there is currently no deterministic, machine-computable signal that "the framework changed." Downstream automation (planned in later PRD slices) needs to detect that a target repo's generated `.adw/` config is stale relative to the current framework. That detection requires a stable, reproducible **content hash** of the framework's init-relevant files.

Two concrete requirements fall out of this:

1. **The dependency list must live in the framework, not in code.** If the list of "files that define the framework version" is hard-coded in a TypeScript module, a contributor can add a new file that `adw_init` depends on and silently forget to add it to the hash inputs, causing target repos to miss the update. Declaring the list in `adw_init.md`'s own frontmatter makes the dependency and its hash-membership atomic in a single edit.

2. **The hash must be deterministic and order-independent.** Reordering the declared file list must not change the hash (otherwise a cosmetic edit would spuriously invalidate every target repo). Conversely, changing *any byte* of *any* declared input must change the hash (otherwise a real framework change would be missed).

There is no existing module that does this. `core/__tests__/` contains no fixture-driven hashing prior art beyond `triggers/issueDependencies.ts`, which uses `createHash('sha1')` over a single string — not a multi-file, frontmatter-declared, canonical-order digest.

## Solution Statement

Add a new pure deep module `adws/core/hashComputer.ts`, following the established ADW deep-module pattern (an injectable I/O dependency object with a `defaultDeps` backed by the real filesystem, exactly as `adws/core/processLiveness.ts` injects `readFile`/`execPs`). The module exposes a single public function:

```ts
computeFrameworkHash(frameworkRepoRoot: string, deps?: HashComputerDeps): string
```

Algorithm:
1. Read `<frameworkRepoRoot>/.claude/commands/adw_init.md` (the file the PRD calls `/adw_init.md`). If unreadable, throw a clear error naming the path.
2. Parse its YAML frontmatter (hand-rolled, mirroring the existing `parseFrontmatterTarget` in `adws/phases/worktreeSetup.ts` — **no new YAML dependency**) to extract the `hashInputs:` list. If there is no frontmatter, no `hashInputs:` key, or an empty list, throw a clear error (operator misconfiguration — hard fail).
3. **Canonicalize order**: sort the declared relative paths lexicographically. This makes the hash invariant to the order the files are listed in the frontmatter.
4. For each path in sorted order, resolve it against `frameworkRepoRoot` and read its bytes via the injected `readFile`. If any declared file is missing/unreadable, throw a clear error naming the offending relative path.
5. Feed each file's bytes into a single `createHash('sha256')` stream (in the canonical order) and return `.digest('hex')`.

Add the `hashInputs:` field to `.claude/commands/adw_init.md`'s frontmatter, declaring today's set per the PRD: `.claude/commands/adw_init.md` and `templates/vocabulary.md.template`. Re-export the module from the `adws/core/index.ts` barrel. Cover the module with Vitest unit tests (unit tests are **enabled** for this repo per `.adw/project.md`) using injected in-memory inputs — the idiomatic `core/__tests__` style — plus one smoke test that runs the real `defaultDeps` against the actual framework repo root to prove the frontmatter we add to `adw_init.md` parses and its declared files resolve.

The module is intentionally **pure and side-effect-free** (apart from reads through the injected dependency) and has **no dependency on any other ADW module** — it takes a root path and returns a string. This is what makes it a "deep module": a tiny, stable interface over a self-contained capability that later slices compose against.

## Relevant Files

Use these files to implement the feature:

- `specs/prd/adw-init-hash-and-label-classification.md` — **Parent PRD.** The "Implementation Decisions → Hash computation" section is the authoritative spec for this slice. Confirms: SHA256 over `adw_init.md` + the `hashInputs:` files; today's set is `.claude/commands/adw_init.md` + `templates/vocabulary.md.template`; "computed by a pure deep module that reads frontmatter, resolves the file list, concatenates bytes, and returns the digest"; "no CI guardrail or semantic-hash machinery — content hash is the contract." The "Testing Decisions → `hashComputer`" section enumerates the exact test cases.
- `.claude/commands/adw_init.md` — **Must be edited.** The slash-command spec file. Its current frontmatter is `---\ntarget: false\n---`. We add the `hashInputs:` field here. This is both an input the module reads and the carrier of the dependency declaration.
- `templates/vocabulary.md.template` — The second declared hash input (already exists, ~2.6 KB). Not edited; referenced by the new frontmatter and read by the module.
- `adws/core/processLiveness.ts` — **Pattern to mirror.** Canonical example of an ADW pure deep module with an injectable I/O dependency interface (`ProcessLivenessDeps`) + `defaultDeps`, pure functions, guard-clause error handling, no throws on the happy path. `hashComputer.ts` should match this shape and JSDoc style.
- `adws/core/__tests__/processLiveness.test.ts` — **Test pattern to mirror.** Shows the Vitest + dependency-injection unit-test idiom used throughout `core/__tests__` (build fake deps, assert observable outputs, `describe`/`it`/`expect`). Note: `core/__tests__` uses in-memory injected deps, not on-disk fixture directories.
- `adws/phases/worktreeSetup.ts` — Contains `parseFrontmatterTarget()`, the existing hand-rolled `---`-delimited frontmatter parser (lines ~80–92). Reuse its parsing approach (string-split, no YAML library) for the `hashInputs:` list parser. Confirms the project parses frontmatter by hand rather than depending on a YAML package.
- `adws/triggers/issueDependencies.ts` — Prior art for `crypto` hashing in this codebase (`import { createHash } from 'crypto'`; `createHash('sha1')...digest('hex')`). `hashComputer` uses the same API with `'sha256'`.
- `adws/core/index.ts` — The `core` barrel file. Add the new module's public exports here (function, constants, and the `HashComputerDeps` type), following the existing grouped-export comment style (e.g., the "Remote reconcile" block).
- `.adw/coding_guidelines.md` — Coding guidelines that MUST be followed: clarity over cleverness, single responsibility, immutability, type safety, purity, guard clauses (max nesting depth ~2), declarative style, files under 300 lines, JSDoc on public APIs.
- `.adw/project.md` — Confirms `## Unit Tests: enabled` (so unit-test tasks are in scope) and the `## Library Install Command` (`bun add <package>`).
- `.adw/commands.md` — Source of the validation commands (lint, type-check, build, `test:unit`, additional adws type-check).

Conditional documentation (matched against `.adw/conditional_docs.md` conditions — read before implementing):
- `app_docs/feature-sgud8b-copy-target-skills-adw-init.md` — Condition match: "When working with `copyTargetSkillsAndCommands()` or `parseFrontmatterTarget()` in `adws/phases/worktreeSetup.ts`" and decisions about `target: true`/`target: false` frontmatter. Relevant because we extend the same `adw_init.md` frontmatter block and reuse its parsing approach.
- `app_docs/feature-nnny1e-vocabulary-template-and-flags.md` — Condition match: "When modifying `.claude/commands/adw_init.md` step 7 (vocabulary template copy …)" and "When working with `templates/vocabulary.md.template`". Relevant because both declared hash inputs are touched/declared here.
- `app_docs/feature-8w4fep-adw-init-commands-md-scenario-sections.md` — Condition match: "When modifying `.claude/commands/adw_init.md`". Background on the `adw_init.md` spec we are amending.

### New Files

- `adws/core/hashComputer.ts` — The pure deep module. Exports `computeFrameworkHash(frameworkRepoRoot, deps?)`, the `HashComputerDeps` interface, `defaultDeps`, and the `ADW_INIT_RELATIVE_PATH` constant (`.claude/commands/adw_init.md`). Contains the internal hand-rolled `hashInputs:` frontmatter parser.
- `adws/core/__tests__/hashComputer.test.ts` — Vitest unit tests covering all six acceptance criteria via injected in-memory inputs, plus a real-`defaultDeps` smoke test against the framework repo root.

## Implementation Plan

### Phase 1: Foundation
Declare the dependency set in the framework spec. Add the `hashInputs:` field to the YAML frontmatter of `.claude/commands/adw_init.md`, listing the two files that define the framework's current init behavior: `.claude/commands/adw_init.md` (itself) and `templates/vocabulary.md.template`. This is the data the module consumes and the single source of truth for "what files define the framework version."

### Phase 2: Core Implementation
Create `adws/core/hashComputer.ts` as a pure deep module mirroring `processLiveness.ts`:
- Define `HashComputerDeps` (a single injectable `readFile(path: string): Buffer`) and `defaultDeps` backed by `fs.readFileSync`.
- Implement an internal `parseHashInputs(adwInitContent: string): string[]` frontmatter parser (string-split, `---`-delimited, supports the block-list `- item` form; trims and strips optional quotes; throws on missing/empty `hashInputs:`), modeled on `parseFrontmatterTarget`.
- Implement `computeFrameworkHash(frameworkRepoRoot, deps = defaultDeps)`: read `adw_init.md` → parse `hashInputs` → sort paths → read each file's bytes (clear error per missing file) → SHA256 → hex digest.
- Use guard clauses for all error/edge cases (keep happy path at the leftmost indent, max nesting ~2 per the coding guidelines).

### Phase 3: Integration
Re-export the module's public surface from `adws/core/index.ts` so later PRD slices can `import { computeFrameworkHash } from '../core'`. Add Vitest unit tests. Run the full validation suite (lint, type-check root + adws, build, unit tests) to confirm zero regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### 1. Add `hashInputs:` frontmatter to `.claude/commands/adw_init.md`
- Edit the existing frontmatter block at the top of `.claude/commands/adw_init.md` (currently `---\ntarget: false\n---`) to add a `hashInputs:` block list, preserving the existing `target: false` line:
  ```yaml
  ---
  target: false
  hashInputs:
    - .claude/commands/adw_init.md
    - templates/vocabulary.md.template
  ---
  ```
- Paths are repo-root-relative, POSIX style, matching the PRD's "Today's set."
- Do not change any other part of `adw_init.md`.

### 2. Create the `hashComputer` deep module
- Create `adws/core/hashComputer.ts`.
- Add a file-level JSDoc block explaining the module's purpose (computes the framework content hash from `adw_init.md`'s declared `hashInputs`), mirroring the doc style of `processLiveness.ts`.
- Imports: `createHash` from `'crypto'`; `readFileSync` from `'fs'`; `join` from `'path'` (match the plain-specifier style used in `processLiveness.ts`).
- Export `const ADW_INIT_RELATIVE_PATH = '.claude/commands/adw_init.md'`.
- Export `interface HashComputerDeps { readFile: (filePath: string) => Buffer }` and `const defaultDeps: HashComputerDeps = { readFile: (p) => readFileSync(p) }`.
- Implement internal `parseHashInputs(content: string): string[]`:
  - Split on `\r?\n`. If the first non-empty line is not `---`, throw `Error('hashComputer: /adw_init.md has no YAML frontmatter; the required hashInputs: field is missing')`.
  - Find the closing `---`. Scan the frontmatter lines for one matching `/^hashInputs:\s*(.*)$/`.
  - If the inline capture is a non-empty `[a, b]` array, parse it; otherwise collect the following indented block-list lines matching `/^\s*-\s*(.+)$/` until a non-list line. Trim each item and strip surrounding single/double quotes.
  - If no `hashInputs:` key is found, or the resulting list is empty, throw `Error('hashComputer: /adw_init.md frontmatter is missing the required hashInputs: field')`.
  - Return the list.
- Implement `export function computeFrameworkHash(frameworkRepoRoot: string, deps: HashComputerDeps = defaultDeps): string`:
  - Resolve `adwInitPath = join(frameworkRepoRoot, ADW_INIT_RELATIVE_PATH)`.
  - Read `adw_init.md` bytes via `deps.readFile`, wrapped in try/catch; on failure throw `Error('hashComputer: cannot read adw_init.md at <adwInitPath>: <reason>')`.
  - Decode to utf-8 and call `parseHashInputs`.
  - Compute the canonical order: `const orderedInputs = [...inputs].sort()` (lexicographic). Document with a comment that sorting is what makes the digest invariant to frontmatter list order.
  - Create `const hash = createHash('sha256')`. For each relative path in `orderedInputs`: resolve `join(frameworkRepoRoot, relPath)`, read bytes via `deps.readFile` wrapped in try/catch (on failure throw `Error('hashComputer: declared hashInput file not found: <relPath>')`), then `hash.update(bytes)`.
  - Return `hash.digest('hex')`.
- Keep the file well under the 300-line guideline and use guard clauses (no deep nesting). Extract the per-file read+update into a small named helper if it reduces nesting.

### 3. Export from the `core` barrel
- In `adws/core/index.ts`, add a grouped export block (matching the existing comment style):
  ```ts
  // Framework content hash
  export { computeFrameworkHash, defaultDeps as hashComputerDefaultDeps, ADW_INIT_RELATIVE_PATH } from './hashComputer';
  export type { HashComputerDeps } from './hashComputer';
  ```
  (Alias `defaultDeps` on export to avoid colliding with any other `defaultDeps` symbol in the barrel; if there is no collision, a plain `defaultDeps` export is acceptable — verify before finalizing.)

### 4. Write unit tests for `hashComputer`
- Create `adws/core/__tests__/hashComputer.test.ts` using Vitest (`import { describe, it, expect } from 'vitest'`), mirroring the DI style of `processLiveness.test.ts`.
- Add a helper that builds a `HashComputerDeps` from an in-memory `Map<string, Buffer>` (keys are absolute resolved paths), throwing an ENOENT-like error for unknown paths — this is the in-memory "fixture."
- Add a helper to construct `adw_init.md` content with a given `hashInputs` list (block-list form) so tests can vary the declared inputs.
- Tests (covering every acceptance criterion):
  1. **Normal path / known digest** — Build deps where `adw_init.md` declares two non-self input files (e.g. `inputs/alpha.txt`, `inputs/beta.txt`) with known bytes. Assert `computeFrameworkHash(root, deps)` equals the digest computed independently in the test (`createHash('sha256')` over the same bytes in sorted path order). Assert it is a 64-char lowercase hex string.
  2. **Reorder stability** — Two deps identical except the `hashInputs:` list order is swapped (`[alpha, beta]` vs `[beta, alpha]`) and the bytes of the declared files are identical; assert both produce the **same** digest. (Use non-self-referential inputs so the `adw_init.md` bytes are identical apart from list order — see Notes on the self-reference nuance.)
  3. **Byte-change sensitivity** — Same setup as #1 but flip one byte in one input file's Buffer; assert the digest **differs**. Repeat flipping a byte in the *other* file to cover "any declared input."
  4. **Missing `hashInputs:` frontmatter** — `adw_init.md` content has frontmatter without a `hashInputs:` key (and a variant with no frontmatter at all); assert `computeFrameworkHash` throws, and the message mentions `hashInputs`.
  5. **Missing referenced file** — `hashInputs:` lists a path absent from the in-memory map; assert it throws, and the message names the missing relative path.
  6. **Missing `adw_init.md`** — The map has no `adw_init.md`; assert it throws a clear error mentioning `adw_init.md`.
  7. **Real-repo smoke test** — Using the real `defaultDeps` and `frameworkRepoRoot` resolved from the test file location (`path.resolve(__dirname, '../../../')` → repo root), assert `computeFrameworkHash(root)` returns a 64-char hex string and is identical across two calls (deterministic). This validates that the frontmatter added in Task 1 parses and that `templates/vocabulary.md.template` resolves.

### 5. Run validation commands
- Run every command in the `## Validation Commands` section below and ensure all pass with zero errors and zero regressions. Fix any lint, type, build, or test failures before considering the feature complete.

## Testing Strategy

### Unit Tests
Unit tests are **enabled** for this repository (`.adw/project.md` → `## Unit Tests: enabled`). Tests live in `adws/core/__tests__/hashComputer.test.ts` and run under Vitest via `bun run test:unit`.

The module is tested through its single public function `computeFrameworkHash`, exercising **external behavior only** (PRD testing philosophy: "Test external behavior only — what callers observe. Do not test internal data structures or private helpers"). The internal frontmatter parser is validated indirectly through `computeFrameworkHash` (missing-frontmatter and missing-`hashInputs` cases), not via a separately exported function.

Inputs are provided through the injectable `HashComputerDeps.readFile` backed by an in-memory `Map` — the idiomatic `core/__tests__` style (see `processLiveness.test.ts`), which keeps tests pure, deterministic, and free of on-disk fixture sprawl. The in-memory maps *are* the fixtures referenced by the acceptance criterion ("unit tests with fixture inputs"). One additional smoke test uses the real filesystem `defaultDeps` to prove the live `adw_init.md` frontmatter and its declared files wire up correctly end-to-end.

Test coverage maps to acceptance criteria as: normal-path/known-digest (criteria 2), reorder-stability (criterion 4), byte-change sensitivity ×2 files (criterion 6), missing-frontmatter (criterion 3), missing-referenced-file (criterion 3), missing-`adw_init.md` (clear-error robustness), real-repo smoke (criteria 1 + 2 against the real spec change).

### Edge Cases
- **Frontmatter present but `hashInputs:` absent** → clear throw (operator misconfiguration; hard fail per PRD).
- **No frontmatter at all** (file does not start with `---`) → clear throw mentioning `hashInputs`.
- **Empty `hashInputs:` list** (key present, no items) → clear throw (treated as missing).
- **A declared file is missing/unreadable** → clear throw naming the offending relative path; no partial/silent digest.
- **`adw_init.md` itself missing/unreadable** → clear throw naming the path.
- **Reordering the `hashInputs:` list** → identical digest (sort canonicalization).
- **Single-byte change in any declared input** → different digest.
- **Quoted or extra-whitespace list items** in the frontmatter (`- "templates/vocabulary.md.template"`, trailing spaces) → parsed correctly (trim + strip quotes).
- **Determinism** → repeated calls with the same inputs return byte-identical digests.

## Acceptance Criteria
- `.claude/commands/adw_init.md` has a `hashInputs:` frontmatter field listing dependent files (`.claude/commands/adw_init.md`, `templates/vocabulary.md.template`).
- `hashComputer` exposes `computeFrameworkHash(frameworkRepoRoot, deps?)` that returns the SHA256 hex digest of the declared inputs.
- Missing `hashInputs:` frontmatter, missing `adw_init.md`, or a missing referenced file each raises a clear, message-bearing error.
- The hash is stable across reordering of the `hashInputs:` file list (canonical sort order).
- Unit tests with fixture inputs cover the normal path, missing-frontmatter, and missing-file cases (plus reorder-stability, byte-change sensitivity, and a real-repo smoke test).
- Changing any byte in any declared input changes the resulting hash.
- The module is pure (no side effects beyond the injected reads) and depends on no other ADW module.
- All validation commands pass with zero errors and zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions. Commands are sourced from `.adw/commands.md`.

- `bun install` — Ensure dependencies are present (no new dependency is added by this feature; this is a sanity step).
- `bun run lint` — ESLint across the repo; the new module and test must be lint-clean.
- `bunx tsc --noEmit` — Root TypeScript type-check (this repo's `## Run Tests` command); must pass with no type errors.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional `adws/`-scoped type-check (`## Additional Type Checks`); must pass.
- `bun run build` — `tsc` build; must complete with no build errors.
- `bun run test:unit` — Vitest unit suite (`## Run Tests` → `bun run test:unit`); the new `hashComputer.test.ts` must pass and all existing tests must remain green (zero regressions).

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`) are mandatory: clarity over cleverness, single responsibility, immutability (don't mutate the parsed input array — sort a copy), type safety (no `any`; the deps interface is explicitly typed), purity (all I/O behind the injected `readFile`), guard clauses with max nesting depth ~2, JSDoc on the public function and exported types, file under 300 lines.
- **No new library.** The codebase has no YAML parser and deliberately hand-parses frontmatter (`parseFrontmatterTarget` in `worktreeSetup.ts`). We follow that precedent rather than adding `js-yaml`/`yaml`, keeping the dependency surface minimal. (Library install command, if ever needed, is `bun add <package>` per `.adw/project.md`.)
- **Self-reference nuance (important for the reorder test).** Per the PRD, the real `adw_init.md` lists *itself* in its own `hashInputs`, so changes to `adw_init.md` (prose or frontmatter) bump the framework hash — which is the desired behavior. A consequence is that editing the *order* of the live `hashInputs:` list technically changes `adw_init.md`'s own bytes and therefore the digest, so reorder-invariance does not literally hold for the self-referential live file. The reorder-stability acceptance criterion is a property of the **module's canonicalization** (it sorts paths before hashing) and is validated with fixture inputs whose `hashInputs` list does **not** reference the frontmatter file itself, isolating the sort behavior. This is intentional and should be noted in a code comment near the sort.
- **Canonical order = lexicographic sort of declared relative paths.** The PRD leaves the mechanism open ("the module normalizes order or the spec defines a canonical order — TBD by implementation"); sorting is the simplest deterministic choice and requires no change to how authors write the frontmatter.
- **Hashing = plain byte concatenation in canonical order** (incremental `hash.update` per file), matching the PRD's "concatenates their bytes in a canonical order." For a fixed, sorted set of distinct files this satisfies all six acceptance criteria. A theoretical cross-file byte-boundary collision (moving bytes from the end of one file to the start of the next) cannot occur with a fixed declared set; if future hardening is ever wanted, an implementer could frame each entry with its path and/or byte length before updating the hash — explicitly **out of scope** here to keep the module faithful to the spec.
- **Scope boundary.** This slice delivers only the pure module and the `adw_init.md` frontmatter edit. It does **not**: create or read `.adw-version`, wire the hash into `initializeWorkflow()` or any orchestrator, add the upgrade-claim/label machinery, or add any CI guardrail. Those are separate PRD slices. Keeping this module dependency-free and orchestrator-agnostic is what lets the later slices compose it cleanly.
- **`frameworkRepoRoot` is a parameter, not discovered internally.** The module stays pure by taking the root as input; callers in later slices supply it (e.g., resolved from `import.meta.url` as `worktreeSetup.ts` does). The real-repo smoke test resolves it from the test file location.
