---
target: false
---
# Document Feature

Generate or update concise current-state module documentation for implemented features by analyzing code changes against the main branch. This command creates or rewrites documentation in the `app_docs/` directory and keeps `.adw/conditional_docs.md` converged — one entry per module, never appending a duplicate. An entry may also name the decision records in `specs/adr/` that govern its module; the module doc lists the same records.

## Variables

adwId: $0
specPath: $1 if provided, otherwise leave it blank
documentationScreenshots_dir: $2 if provided, otherwise leave it blank

## Instructions

### 1. Analyze Changes
- Run `git diff origin/main --stat` to see files changed and lines modified
- Run `git diff origin/main --name-only` to get the list of changed files (the **touched files**)
- For significant changes (>50 lines), run `git diff origin/main <file>` on specific files to understand the implementation details

### 2. Read Specification (if provided)
- If `specPath` is provided, read the specification file to understand:
  - Original requirements and goals
  - Expected functionality
  - Success criteria
- Use this to frame the documentation around what was requested vs what was built

### 3. Analyze and Copy Screenshots (if provided)
- If `documentationScreenshots_dir` is provided, list and examine screenshots
- Create `app_docs/assets/` directory if it doesn't exist
- Copy all screenshot files (*.png) from `documentationScreenshots_dir` to `app_docs/assets/`
  - Preserve original filenames
  - Use `cp` command to copy files
- Use visual context to better describe UI changes or visual features
- Reference screenshots in documentation using relative paths (e.g., `assets/screenshot-name.png`)

### 4. Route by ownership (semantic-first)
- Read `.adw/conditional_docs.md` and, for the touched files **and the nature of the change**, **semantically judge** which existing entry's module **owns** this area by reading each entry's `Conditions:` text and description.
  - Routing must succeed even when no `Owns:` glob matches — the common case for legacy entries with no `Owns:` block.
  - Treat `Owns:` globs as a **corroborating** signal: a glob hit is strong evidence of ownership; the absence of a glob hit does **not** rule out a semantic match.
  - Read each entry's `Conditions:` lines holistically: does the module they describe own the responsibility, subsystem, or area that the touched files and change represent?
  - When multiple touched files match different entries, prefer the entry whose description covers the **most** touched files semantically.
- **If one or more matching entries are found (area already owned):** go to step 5 (collapse and rewrite).
- **If no entry plausibly owns the area (genuinely novel):** go to step 7 (create new).

### 5. Collapse sibling entries for the area
- Identify all entries that describe the same module or area as the change (siblings). An area has siblings when multiple entries' `Conditions:` or `Owns:` globs overlap with the touched files and each other.
- **If there is exactly one owning entry:** it is the survivor — go directly to step 6 (rewrite in place).
- **If there are multiple sibling entries (siblings):** fold them into one:
  1. Pick the **survivor** `docPath` (prefer the entry whose glob matches the most touched files, or the document-order first match).
  2. Rewrite the survivor doc in place to current-state truth (step 6).
  3. **Delete** every other (non-survivor) sibling's `app_docs/` file from disk.
  4. **Remove** every non-survivor entry from `.adw/conditional_docs.md`.
  5. Keep **one merged entry** whose `Owns:` globs are the **union** of the collapsed entries' globs (de-duplicated), whose `Decisions:` block is the de-duplicated **union** of the collapsed entries' blocks, and whose `Conditions:` are regenerated from the rewritten doc's current content.
  - **Post-condition:** after this step, exactly **one** entry and exactly **one** module doc cover the area; all redundant entries and their files are gone.
  - The index must still parse/serialize losslessly through the registry after collapse (use `collapseEntries` from `adws/core/conditionalDocsRegistry.ts` when driving this step programmatically).

### 6. Rewrite in place (survivor doc)
- Rewrite the survivor module doc **in place** (overwrite the file at its `docPath`) in current-state module reference format (see Documentation Format below). No changelog, no history.
- Update the **single remaining entry** in `.adw/conditional_docs.md`:
  - **Regenerate** its `Conditions:` block from the rewritten doc's current content — never leave stale conditions; the semantic matcher must keep matching against accurate text.
  - **Regenerate** the doc's Overview section to reflect current source truth.
  - Ensure its `Owns:` globs cover all touched files (add any missing globs, keeping existing ones; use the union of the collapsed siblings' globs if this was a collapse).
  - Keep its `Decisions:` block. It is authoritative: never drop a record from it while rewriting. Add a record only when that record governs this module and is not yet listed, for example a record this change adds under `specs/adr/`.
  - Write the doc's `## Decisions` section from that block (see Documentation Format); a rewrite must never lose it.
  - **Do NOT** add a second entry for the same `docPath`. Never duplicate a `docPath`.

### 7. Create new (genuinely novel area)
- Create a new module doc **only** when no existing module plausibly owns the area — semantically or by glob. Do **not** fold a genuinely novel change into a vaguely-related existing module just to avoid creating an entry.
- Create a new documentation file in `app_docs/` directory.
- Filename format: `feature-{adwId}-{descriptive-name}.md`
  - Replace `{descriptive-name}` with a short module name (e.g., "vcs-module", "trigger-core").
- Write the documentation in current-state module reference format (see Documentation Format below).
- Append exactly **one new entry** to `.adw/conditional_docs.md` in the Conditional Docs Entry Format below, including an explicit `Owns:` glob block covering the touched files so future runs can route to this entry by glob or semantic match.
- If `specs/adr/` exists, read `specs/adr/README.md` and name every record that governs the new module. A record governs a module when its decision shapes that module's own code. It does not govern a module that only calls such code or follows a rule that applies everywhere. A record whose status is `superseded`, in whole, governs nothing. List the numbers in the entry's `Decisions:` block and link the records in the doc's `## Decisions` section. If no record governs the module, or `specs/adr/` does not exist, write neither.

### 8. Check decisions
- Skip when the repository has no `specs/adr/`. In that case no entry may carry a `Decisions:` block and no doc a `## Decisions` section.
- For each entry you wrote or rewrote:
  - its doc's `## Decisions` section links exactly the records in its `Decisions:` block, each by an inline link relative to the doc that resolves to the record's file;
  - every number in the block has a file in `specs/adr/`;
  - an entry without a block has no section in its doc.
- If `adws/checkLivingDocsIndex.ts` exists, run `bunx tsx adws/checkLivingDocsIndex.ts` and resolve every decisions finding for the entries you wrote. Leave other findings alone.

### 9. Final Output
- When you finish writing or rewriting the documentation and updating `.adw/conditional_docs.md`, return exclusively the path to the documentation file and nothing else.

## Documentation Format

Use this current-state module reference template (no per-run history, no changelog, no `ADW ID`, no `Date`, no `What Was Built`, no `Files Modified`):

```md
# <Module Title>

## Overview

<2-3 sentence summary of what this module does and why it exists. Present tense — current truth, not build history.>

## Screenshots

<If documentationScreenshots_dir was provided and screenshots were copied>

![<Description>](assets/<screenshot-filename.png>)

## Responsibilities

<Bulleted list of what this module owns and does>

- <Responsibility 1>
- <Responsibility 2>
- <etc>

## Contracts & Invariants

<Key guarantees this module makes that callers rely on>

- <Invariant/contract 1>
- <Invariant/contract 2>

## Configuration

<Any configuration options, environment variables, or settings callers must know>

## Gotchas

<Non-obvious constraints, subtle behaviours, or known limitations>

## Decisions

<Only when the entry has a `Decisions:` block. One bullet per record, in the block's order, linked relative to this doc>

- [ADR-<NNNN>](../specs/adr/<NNNN>-<slug>.md) — <the record's title from specs/adr/README.md>
```

## Conditional Docs Entry Format

Use this format when creating a new entry in `.adw/conditional_docs.md`:

```md
- app_docs/<your_documentation_file>.md
  - Owns:
    - <glob pattern covering the touched files, e.g. adws/vcs/**)
    - <additional glob if needed>
  - Conditions:
    - When working with <feature area>
    - When implementing <related functionality>
    - When troubleshooting <specific issues>
  - Decisions:
    - <four-digit number of a record in specs/adr/ that governs this module, e.g. 0044>
```

`Decisions:` is the entry's last block. Write it only when at least one record governs the module, and never when `specs/adr/` does not exist.

When updating an existing entry, replace its `Owns:` and `Conditions:` blocks in place (same `docPath` line, same position in the file) and keep its `Decisions:` block. Never duplicate the `docPath` line.

## Report
- Summarize the work you've just done in a concise bullet point list.
- State which routing path was taken: **collapsed siblings** (and how many were pruned), **rewrote in place** (convergence, one existing entry), or **created new** (novel area).
- Include the full path to the documentation file (e.g., `app_docs/feature-abc123-vcs-module.md`).
