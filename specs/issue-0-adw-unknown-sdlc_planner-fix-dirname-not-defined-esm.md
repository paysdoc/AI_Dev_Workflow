# Bug: __dirname is not defined in ESM context

## Metadata
issueNumber: `0`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description
Every ADW workflow aborts with `ReferenceError: __dirname is not defined` when `copyClaudeCommandsToWorktree()` is called during `initializeWorkflow()`. The error occurs at `adws/phases/workflowLifecycle.ts:83` where `__dirname` is used to resolve the ADW repo root path. Since the project uses `"type": "module"` in `package.json` and `"module": "ESNext"` in `tsconfig.json`, all files are treated as ES modules. The CommonJS global `__dirname` is not available in ESM — it must be replaced with the ESM equivalent using `import.meta.url`.

**Actual behavior:** Every workflow crashes immediately with:
```
ReferenceError: __dirname is not defined
    at copyClaudeCommandsToWorktree (/Users/martin/projects/paysdoc/AI_Dev_Workflow/adws/phases/workflowLifecycle.ts:83:36)
    at initializeWorkflow (...)
```

**Expected behavior:** Workflows initialize successfully, and `copyClaudeCommandsToWorktree()` correctly resolves the ADW repo root path.

## Problem Statement
The `copyClaudeCommandsToWorktree()` function in `workflowLifecycle.ts` uses `__dirname` (a CommonJS-only global) to resolve the ADW repo root path. The project is configured as an ES module (`"type": "module"` in `package.json`), so `__dirname` is not defined at runtime when executed via `npx tsx`.

## Solution Statement
Replace the `__dirname` usage with the ESM-compatible equivalent: `import.meta.url` combined with `fileURLToPath` from the `node:url` module and `path.dirname`. This is the standard Node.js approach for obtaining directory paths in ES modules.

## Steps to Reproduce
1. Run any ADW workflow, e.g., `npx tsx adws/adwPlanBuildTest.tsx 123`
2. The workflow reaches `initializeWorkflow()` which calls `copyClaudeCommandsToWorktree()`
3. At line 83, `__dirname` is referenced but is not defined in ESM
4. The process crashes with `ReferenceError: __dirname is not defined`

## Root Cause Analysis
The root cause is a CommonJS/ESM incompatibility:

1. `package.json` declares `"type": "module"`, making all `.ts`/`.js` files ESM by default
2. `adws/tsconfig.json` uses `"module": "ESNext"`, confirming ESM output
3. `workflowLifecycle.ts:83` uses `__dirname`, which is a CommonJS-only global injected by Node.js's CommonJS module wrapper
4. In ES modules, `__dirname` and `__filename` are not available. The ESM equivalent is `import.meta.url` (a `file://` URL) which must be converted to a filesystem path using `fileURLToPath` from the `node:url` module

Note: Test files (`adws/__tests__/*.test.ts`) also use `__dirname`, but these run under Vitest which provides CJS global shims in ESM contexts. Those do not need changes.

## Relevant Files
Use these files to fix the bug:

- `adws/phases/workflowLifecycle.ts` — Contains the `copyClaudeCommandsToWorktree()` function with the broken `__dirname` reference at line 83. This is the only production file that needs modification.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed during the fix.
- `adws/tsconfig.json` — Confirms ESM module configuration (`"module": "ESNext"`).
- `package.json` — Confirms ESM project type (`"type": "module"`).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Replace `__dirname` with ESM-compatible equivalent in `workflowLifecycle.ts`

- Add `import { fileURLToPath } from 'node:url';` to the top of `adws/phases/workflowLifecycle.ts` (alongside the existing `import * as path from 'fs'` and `import * as path from 'path'`)
- In the `copyClaudeCommandsToWorktree()` function at line 83, replace:
  ```typescript
  const adwRepoRoot = path.resolve(__dirname, '../../');
  ```
  with:
  ```typescript
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const adwRepoRoot = path.resolve(currentDir, '../../');
  ```
- This computes the same path (`adws/phases/../../` → project root) using the ESM-native `import.meta.url`

### 2. Run Validation Commands to confirm the fix

- Execute every validation command listed below to confirm the bug is fixed with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npx tsc --noEmit -p adws/tsconfig.json` — Verify TypeScript compilation passes with no errors
- `npm test` — Run all tests to ensure zero regressions
- `npm run lint` — Run linter to check for code quality issues

## Notes
- The `guidelines/coding_guidelines.md` must be followed. The fix adheres to: clarity over cleverness, type safety, and keeping changes minimal.
- Only one line of production code changes (plus one new import). This is the minimal fix needed.
- Test files (`adws/__tests__/*.test.ts`) also reference `__dirname` but do NOT need changes — Vitest provides CJS global shims in ESM contexts.
- No new libraries are needed. `node:url` is a built-in Node.js module.
