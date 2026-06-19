---
target: false
---
# Document Feature

Generate or update concise current-state module documentation for implemented features by analyzing code changes against the main branch. This command creates or rewrites documentation in the `app_docs/` directory and keeps `.adw/conditional_docs.md` converged — one entry per module, never appending a duplicate.

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

### 4. Route by ownership
- Read `.adw/conditional_docs.md`
- For each entry, check its `Owns:` glob block (if present): does any of the touched files match a glob listed there?
  - Matching is **explicit glob-only** (`**`, `*`, `?`). Semantic matching is out of scope for this slice.
  - If multiple touched files match different entries, use the entry that matches the **first touched file** (document-order, first match wins).
- **If a match is found (area already owned):** go to step 5 (rewrite in place).
- **If no match is found (novel area):** go to step 6 (create new).

### 5. Rewrite in place (area already owned)
- The matched entry already owns this area. **Do NOT append a new entry.**
- Determine the existing module doc path from the matched entry's `docPath` field.
- Rewrite that module doc **in place** (overwrite the file at that path) in current-state module reference format (see Documentation Format below).
- Update the **single existing entry** in `.adw/conditional_docs.md`:
  - Regenerate its `Conditions:` block to reflect current truth.
  - Ensure its `Owns:` globs cover all touched files (add any missing globs, keeping existing ones).
  - Do NOT add a second entry for the same `docPath`.
- When a run touches files from two different owned modules, document against the module whose glob matches the **most touched files** (thin-slice rule).

### 6. Create new (novel area)
- Create a new documentation file in `app_docs/` directory
- Filename format: `feature-{adwId}-{descriptive-name}.md`
  - Replace `{descriptive-name}` with a short feature name (e.g., "vcs-module", "trigger-core")
- Write the documentation in current-state module reference format (see Documentation Format below).
- Append exactly **one new entry** to `.adw/conditional_docs.md` in the Conditional Docs Entry Format below, including an explicit `Owns:` glob block covering the touched files so future runs can route to this entry.

### 7. Final Output
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
```

When updating an existing entry, replace its `Owns:` and `Conditions:` blocks in place (same `docPath` line, same position in the file). Never duplicate the `docPath` line.

## Report
- Summarize the work you've just done in a concise bullet point list.
- State whether you rewrote an existing module doc (convergence) or created a new one.
- Include the full path to the documentation file (e.g., `app_docs/feature-abc123-vcs-module.md`).
