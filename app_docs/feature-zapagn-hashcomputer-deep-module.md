# hashComputer Deep Module — Framework Content Hash

**ADW ID:** zapagn-hashcomputer-deep-mo
**Date:** 2026-06-08
**Specification:** specs/issue-537-adw-zapagn-hashcomputer-deep-mo-sdlc_planner-hash-computer-deep-module.md

## Overview

Adds a pure deep module `hashComputer` that computes the ADW framework's current content hash: a SHA256 hex digest over the byte content of files declared in the `hashInputs:` YAML frontmatter of `.claude/commands/adw_init.md`. The dependency list lives in the framework spec itself, making it impossible to add an init dependency and silently omit it from the hash. This is the foundational primitive that later PRD slices will use to detect stale `.adw/` configs in target repos.

## What Was Built

- New `adws/core/hashComputer.ts` pure deep module with injectable I/O dependency
- `hashInputs:` frontmatter field added to `.claude/commands/adw_init.md`
- Barrel export of the module from `adws/core/index.ts`
- Vitest unit test suite covering all six acceptance criteria plus a real-repo smoke test

## Technical Implementation

### Files Modified

- `adws/core/hashComputer.ts`: New pure deep module — `computeFrameworkHash`, `HashComputerDeps`, `defaultDeps`, `ADW_INIT_RELATIVE_PATH`
- `adws/core/__tests__/hashComputer.test.ts`: Vitest unit tests with in-memory injected deps
- `adws/core/index.ts`: Added `// Framework content hash` export block
- `.claude/commands/adw_init.md`: Added `hashInputs:` frontmatter field listing `.claude/commands/adw_init.md` and `templates/vocabulary.md.template`
- `features/per-issue/feature-537.feature`: BDD acceptance scenarios
- `features/per-issue/step_definitions/feature-537.steps.ts`: Step definitions

### Key Changes

- `computeFrameworkHash(frameworkRepoRoot, deps?)` reads `adw_init.md`, parses its `hashInputs:` frontmatter block-list, sorts paths lexicographically (canonical order), reads each file's bytes via the injected `deps.readFile`, and returns `sha256.digest('hex')`.
- Internal `parseHashInputs()` supports both inline YAML array `[a, b]` and block-list `- item` forms; throws clear errors for missing frontmatter, missing `hashInputs:` key, or empty list.
- `readHashInput()` helper wraps per-file reads with a named error that identifies the offending relative path.
- Lexicographic sort makes the digest invariant to frontmatter list order (reorder-stability); self-referential note in a comment explains why this property doesn't hold for the live file if its own bytes change.
- `defaultDeps` is exported aliased as `hashComputerDefaultDeps` in the barrel to avoid name collisions.

## How to Use

1. Import from the barrel:
   ```ts
   import { computeFrameworkHash } from '../core';
   ```
2. Call with the framework repo root (absolute path):
   ```ts
   const hash = computeFrameworkHash('/path/to/ADW_Dev_Workflow');
   // returns a 64-char hex string, e.g. "a3f1..."
   ```
3. For testing, inject an in-memory `HashComputerDeps`:
   ```ts
   import { computeFrameworkHash, HashComputerDeps } from '../core';
   const deps: HashComputerDeps = { readFile: (p) => myMap.get(p)! };
   const hash = computeFrameworkHash('/root', deps);
   ```
4. To add a new framework file to the hash, edit the `hashInputs:` block in `.claude/commands/adw_init.md` — the same PR that adds the dependency updates the hash inputs.

## Configuration

No new environment variables or configuration files. The only configuration is the `hashInputs:` frontmatter in `.claude/commands/adw_init.md`:

```yaml
---
target: false
hashInputs:
  - .claude/commands/adw_init.md
  - templates/vocabulary.md.template
---
```

Paths are repo-root-relative, POSIX style. Add entries here whenever a new file becomes part of the framework's init behavior.

## Testing

```bash
bun run test:unit
```

Tests in `adws/core/__tests__/hashComputer.test.ts` cover:
- Normal path / known digest (deterministic SHA256)
- Reorder stability (sort canonicalization)
- Byte-change sensitivity (any input byte change changes the hash)
- Missing `hashInputs:` frontmatter (two variants)
- Missing referenced file (named in error message)
- Missing `adw_init.md`
- Real-repo smoke test (uses `defaultDeps` against the live framework repo)

## Notes

- **No new library.** Frontmatter is hand-parsed (split on `---` delimiters), matching the `parseFrontmatterTarget` pattern in `adws/phases/worktreeSetup.ts`.
- **Scope boundary.** This module is intentionally isolated: no `.adw-version` creation, no orchestrator wiring, no classification machinery — those are separate PRD slices.
- **Self-reference.** Because `adw_init.md` lists itself in `hashInputs:`, any prose or frontmatter edit to that file will change the framework hash. Reorder-stability (sort invariance) applies to the module's canonicalization logic, validated via fixture inputs that don't self-reference.
- **Composability.** `frameworkRepoRoot` is a parameter so later slices supply it from their context (e.g. resolved from `import.meta.url`), keeping the module pure.
