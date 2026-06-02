---
name: refactor
description: Apply project coding guidelines to changed code. Reads guidelines from .adw/coding_guidelines.md (preferred) or .guidelines/coding_guidelines.md. Applies them to files changed relative to the default branch, then summarizes what changed. Use when user says "refactor", "apply guidelines", "clean up changed files", or "enforce coding standards". Pass "entire codebase" to bypass the branch guard and apply guidelines to all source files.
---

# Refactor

Apply coding guidelines to changed code on the current branch.

## Quick start

```
/refactor                      # apply guidelines to files changed vs default branch
/refactor entire codebase      # apply to all source files regardless of branch
```

## Workflow

### 1. Find guidelines

Check in order — use the first found:
1. `.adw/coding_guidelines.md`
2. `.guidelines/coding_guidelines.md`

If neither exists, stop and tell the user.

### 2. Determine mode

If args contain "entire codebase" or an equivalent instruction to process all files → **full-codebase mode** (skip step 3).  
Otherwise → **changed-files mode**.

### 3. Branch guard (changed-files mode only)

```bash
bash .claude/skills/refactor/scripts/git-state.sh
```

Stop and report to the user if:
- `is_on_default: true` — on the default branch, nothing unique to refactor
- `ahead_count: 0` — branch has no commits ahead of default, nothing to refactor

### 4. Collect scope

**Changed-files mode** — use the file list printed after `---` in the script output.  
**Full-codebase mode** — all source files in the repo.

Exclude in both modes: `*.lock`, JSON config files, generated files, fixture files, `node_modules/`.

### 5. Apply guidelines

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
