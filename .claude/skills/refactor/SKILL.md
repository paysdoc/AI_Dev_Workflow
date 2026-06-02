---
name: refactor
description: Apply project coding guidelines to a specified list of files. Reads guidelines from .adw/coding_guidelines.md (preferred) or .guidelines/coding_guidelines.md. Applies them to the files named in the args, then summarizes what changed. Use when user says "refactor", "apply guidelines", "clean up these files", or "enforce coding standards". Pass one or more file paths as args. Pass "entire codebase" to apply guidelines to all source files instead.
---

# Refactor

Apply coding guidelines to a specified list of files.

## Quick start

```
/refactor src/foo.ts src/bar.ts   # apply guidelines to named files
/refactor entire codebase          # apply to all source files
```

## Workflow

### 1. Find guidelines

Check in order — use the first found:
1. `.adw/coding_guidelines.md`
2. `.guidelines/coding_guidelines.md`

If neither exists, stop and tell the user.

### 2. Determine mode

If args contain "entire codebase" or an equivalent instruction to process all files → **full-codebase mode** (skip step 3).  
Otherwise → **file-list mode**.

### 3. Collect scope

**File-list mode** — use the file paths provided in the args.  
If no file paths are provided and mode is not full-codebase, stop and ask the user to supply a list of files to refactor.

**Full-codebase mode** — all source files in the repo.

Exclude in both modes: `*.lock`, JSON config files, generated files, fixture files, `node_modules/`.

### 4. Apply guidelines

For each file in scope:
1. Read the file
2. Identify guideline violations (naming, nesting depth, guard clauses, type safety, dead code, etc.)
3. Apply fixes with Edit — correct violations without changing behavior
4. Skip files with no violations

After all files: summarize changes grouped by guideline category.

## Rules

- Preserve behavior — refactoring only, no logic changes
- Skip test files unless the guidelines explicitly address test style
- Apply language-relevant guideline sections only; skip inapplicable ones
- Do not add features, comments, or documentation as a side effect
