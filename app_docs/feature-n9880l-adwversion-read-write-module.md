# adwVersion Read/Write Module

**ADW ID:** n9880l-adwversion-deep-modu
**Date:** 2026-06-08
**Specification:** specs/issue-538-adw-n9880l-adwversion-deep-modu-sdlc_planner-adw-version-read-write-module.md

## Overview

This feature adds `adws/core/adwVersion.ts`, a small deep module that owns all reading and writing of the `.adw-version` file at a target repo's worktree root. The file stores the SHA256 content hash the repo was last initialized with, in plain format (hex SHA256 + single trailing newline, no metadata). This is the storage primitive for the parent PRD's versioned auto-(re)init system (`specs/prd/adw-init-hash-and-label-classification.md`).

## What Was Built

- `adwVersion.ts` deep module with `readAdwVersion`, `writeAdwVersion`, and `ADW_VERSION_FILENAME` constant
- 10-case Vitest unit test suite covering every branch (absent, empty, whitespace-only, trailing whitespace, overwrite, round-trip, input normalization)
- Re-export from `adws/core/index.ts` barrel following existing grouping style
- BDD feature file (`features/per-issue/feature-538.feature`) with step definitions

## Technical Implementation

### Files Modified

- `adws/core/adwVersion.ts`: New deep module — `readAdwVersion`, `writeAdwVersion`, `ADW_VERSION_FILENAME` constant. Node built-ins only (`fs`, `path`), no new dependencies.
- `adws/core/__tests__/adwVersion.test.ts`: New unit test suite using real temp-directory fixtures (no mocks), 10 test cases covering all branches.
- `adws/core/index.ts`: Added barrel re-export for `ADW_VERSION_FILENAME`, `readAdwVersion`, `writeAdwVersion` under `// ADW version file (.adw-version) read/write` comment group.
- `features/per-issue/feature-538.feature`: BDD acceptance scenarios.
- `features/per-issue/step_definitions/feature-538.steps.ts`: Step definitions for the BDD scenarios.

### Key Changes

- **Read semantics:** Absent file → `null`; present-but-empty or whitespace-only → `null`; present with content → trimmed string. Only absence maps to `null`; genuine I/O errors on an existing file propagate (not swallowed).
- **Write semantics:** Trims the input hash, appends exactly one newline, overwrites atomically. Guarantees round-trip stability: `readAdwVersion` after `writeAdwVersion(p, h)` returns `h.trim()`.
- **Deep module design:** Two functions + one constant hide all details (filename literal, path assembly, existence check, whitespace normalization, canonical format). Callers import from `../core` per codebase convention.
- **File location:** `.adw-version` is written at the worktree root (outside `.adw/`) so LLM regeneration of `.adw/` during an upgrade cannot clobber the recorded version.
- **No directory creation on write:** `worktreePath` is always an existing checked-out worktree root; `writeAdwVersion` does not `mkdir`, keeping the module side-effect-minimal.

## How to Use

```typescript
import { readAdwVersion, writeAdwVersion, ADW_VERSION_FILENAME } from '../core';

// Read the stored hash — returns null if never initialized or file absent/empty
const storedHash = readAdwVersion(worktreePath);
if (storedHash === null) {
  // treat as "never initialized" — same code path as "out of date"
}

// Write a new hash after framework regeneration
writeAdwVersion(worktreePath, freshHash);
```

### Read behavior

| File state | Return value |
|---|---|
| File absent | `null` |
| File present, empty | `null` |
| File present, whitespace-only | `null` |
| File present, has content | trimmed string (e.g. `"e3b0c44..."`) |

### Write behavior

Always writes `<hash.trim()>\n` as UTF-8, overwriting any existing content. No metadata, no JSON, no headers.

## Configuration

No configuration required. The filename (`.adw-version`) is exported as `ADW_VERSION_FILENAME` for callers that need it for display or assertions.

## Testing

```bash
# Run only this module's tests
bunx vitest run adws/core/__tests__/adwVersion.test.ts

# Full unit test suite (confirms no regressions)
bun run test:unit

# Type check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Lint + build
bun run lint
bun run build
```

## Notes

- **Scope boundary:** This module is the storage primitive only. It does not compute the framework hash (future `hashComputer` module), does not modify `initializeWorkflow()` (future slice), and does not touch `adwUpgrade.tsx`.
- **Future consumers:** `initializeWorkflow()` will call `readAdwVersion(worktreePath)` and compare against the freshly computed hash. `adwUpgrade.tsx` will call `writeAdwVersion(worktreePath, freshHash)` after regenerating `.adw/`. The "absent/empty → null" semantic lets the comparison treat never-initialized and out-of-date repos identically.
- **Error propagation:** Only file absence maps to `null`. Permission errors or other I/O failures on an existing file propagate rather than being silently masked — unlike `stateHelpers.readStateFile` which guards malformed JSON with `try/catch`.
