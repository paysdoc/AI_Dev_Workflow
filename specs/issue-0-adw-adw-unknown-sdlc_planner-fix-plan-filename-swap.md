# Bug: Plan agent swaps issueNumber and adwId in plan filename

## Metadata
issueNumber: `0`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description
The plan agent consistently swaps the `issueNumber` ($1) and `adwId` ($2) values when naming the plan file. Instead of producing `issue-{issueNumber}-adw-{adwId}-sdlc_planner-{name}.md`, it produces `issue-{adwId}-adw-{issueNumber}-sdlc_planner-{name}.md`.

**Expected behavior**: For issue 31 with adwId `init-adw-env-4qugib`, the plan file should be named:
`specs/issue-31-adw-init-adw-env-4qugib-sdlc_planner-init-adw-config.md`

**Actual behavior**: The plan agent created:
`specs/issue-init-adw-env-4qugib-adw-31-sdlc_planner-init-adw-config.md`

The Metadata section was also incorrectly populated with swapped values:
- `issueNumber: init-adw-env-4qugib` (should be `31`)
- `adwId: 31` (should be `init-adw-env-4qugib`)

This causes downstream failures because `findPlanFile()` searches for `^issue-{issueNumber}-adw-.*` and cannot find the mis-named file, so the build agent never receives the plan.

## Problem Statement
The slash command templates (`bug.md`, `feature.md`, `chore.md`, `adw_init.md`) define positional variables `$1` (issueNumber) and `$2` (adwId) with insufficient disambiguation. The LLM agent confuses which positional argument is which, especially when the adwId is a human-readable string like `init-adw-env-4qugib` and the issueNumber is a short numeric value like `31`. There is also no code-level validation to detect or correct this mistake.

## Solution Statement
Two complementary fixes:

1. **Prompt clarity (primary fix)**: Strengthen the Variables section in all four slash command templates to add explicit type constraints, examples, and a warning about not swapping values. This reduces the probability of the LLM making the mistake.

2. **Code-level safety net (secondary fix)**: Add a `correctPlanFileNaming()` function in `planAgent.ts` that detects plan files with swapped `issueNumber`/`adwId` after the plan agent runs. If a swapped file is found, rename it to the correct convention. Call this function from `planPhase.ts` after the plan agent completes. This catches the issue even if the LLM still occasionally makes the mistake.

## Steps to Reproduce
1. Create a GitHub issue (e.g., issue #31) with title "init adw env" and body "/adw_init"
2. Run the ADW pipeline: `npx tsx adws/adwPlanBuildTest.tsx 31`
3. Observe the plan agent output in `agents/<adwId>/plan-build-test-orchestrator/plan-agent/output.jsonl`
4. The plan file is created with swapped values in the filename
5. The downstream `findPlanFile(31)` fails to find the file because the regex `^issue-31-adw-.*` does not match `issue-init-adw-env-4qugib-adw-31-...`

## Root Cause Analysis
The LLM (Claude Code CLI running the slash command) receives three positional arguments: `$1='31'`, `$2='init-adw-env-4qugib'`, `$3='{...json...}'`. The Variables section in the slash command templates states:

```
issueNumber: $1, default 0 if not provided
adwId: $2, default to `adw-unknown` if not provided
```

This is ambiguous because:
- The variable descriptions lack explicit type constraints (e.g., "must be numeric")
- There is no example showing the expected filename with concrete values substituted
- The LLM may infer that the longer, more descriptive string (`init-adw-env-4qugib`) is the "issue number" and the short numeric value (`31`) is the "ID"
- The `issueJson` ($3) contains `"number": 31` which should help, but the LLM doesn't always cross-reference

The code in `findPlanFile()` strictly expects `issue-{issueNumber}-adw-` at the start of the filename and has no fallback for swapped values, so the downstream pipeline silently fails.

## Relevant Files
Use these files to fix the bug:

- `.claude/commands/bug.md` — Slash command template with the Variables section that needs clearer $1/$2 disambiguation (line 16 has the naming convention instruction)
- `.claude/commands/feature.md` — Slash command template with the same Variables section pattern
- `.claude/commands/chore.md` — Slash command template with the same Variables section pattern
- `.claude/commands/adw_init.md` — Slash command template with the same Variables section pattern
- `adws/agents/planAgent.ts` — Contains `findPlanFile()`, `getPlanFilePath()`, and `runPlanAgent()`. Needs a new `correctPlanFileNaming()` function
- `adws/phases/planPhase.ts` — Calls `getPlanFilePath()` after plan agent runs (line 90). Needs to call the correction function
- `adws/__tests__/planAgent.test.ts` — Existing tests for planAgent functions. Needs tests for the new correction function
- `app_docs/feature-the-adw-is-too-speci-tf7slv-generalize-adw-project-config.md` — Context for `.adw/` project configuration (from conditional docs)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Strengthen the Variables section in all slash command templates

Update the `## Variables` section in the following four files to add explicit type constraints, examples, and a non-swap warning:

- `.claude/commands/bug.md`
- `.claude/commands/feature.md`
- `.claude/commands/chore.md`
- `.claude/commands/adw_init.md`

Replace the existing Variables section in each file with:

```md
## Variables
issueNumber: $1 — MUST be a numeric GitHub issue number (e.g., 31, 456). Default: 0
adwId: $2 — MUST be the alphanumeric ADW workflow ID string (e.g., "init-adw-env-4qugib", "abc123"). Default: `adw-unknown`
issueJson: $3 — JSON string containing full issue details. Default: `{}`

IMPORTANT: $1 is ALWAYS the numeric issue number. $2 is ALWAYS the ADW ID string. Do NOT swap these values.
Example: if $1=31 and $2=init-adw-env-4qugib, the filename is `issue-31-adw-init-adw-env-4qugib-sdlc_planner-{descriptiveName}.md`
```

### 2. Add `correctPlanFileNaming()` function to `planAgent.ts`

Add a new exported function `correctPlanFileNaming()` in `adws/agents/planAgent.ts` that:

- Takes `issueNumber: number` and optional `worktreePath?: string` parameters
- Scans the `specs/` directory for files matching the swapped pattern: `issue-*-adw-{issueNumber}-sdlc_planner-*.md` (where the issue number appears after `adw-` instead of after `issue-`)
- If a swapped file is found:
  - Extracts the adwId (which was placed in the `issue-` position)
  - Extracts the descriptive name
  - Renames the file to the correct convention: `issue-{issueNumber}-adw-{adwId}-sdlc_planner-{descriptiveName}.md`
  - Logs a warning about the correction
  - Returns the corrected relative path (`specs/corrected-filename.md`)
- If no swapped file is found, returns `null`

Implementation:
```ts
export function correctPlanFileNaming(issueNumber: number, worktreePath?: string): string | null {
  const specsDir = worktreePath ? path.join(worktreePath, 'specs') : 'specs';

  try {
    const files = fs.readdirSync(specsDir);

    // Already correctly named? No correction needed.
    const correctPattern = new RegExp(`^issue-${issueNumber}-adw-.*-sdlc_planner-.*\\.md$`);
    for (const file of files) {
      if (correctPattern.test(file)) return null;
    }

    // Look for swapped naming: adwId placed in issue- position, issueNumber placed in adw- position
    const swappedPattern = new RegExp(`^issue-(.+)-adw-${issueNumber}-sdlc_planner-(.+\\.md)$`);
    for (const file of files) {
      const match = file.match(swappedPattern);
      if (match) {
        const swappedAdwId = match[1];
        const descriptivePart = match[2];
        const correctedName = `issue-${issueNumber}-adw-${swappedAdwId}-sdlc_planner-${descriptivePart}`;
        const oldPath = path.join(specsDir, file);
        const newPath = path.join(specsDir, correctedName);
        fs.renameSync(oldPath, newPath);
        log(`Plan file renamed: ${file} → ${correctedName} (corrected swapped issueNumber/adwId)`, 'warn');
        return path.join('specs', correctedName);
      }
    }
  } catch {
    // specs directory doesn't exist or other error
  }

  return null;
}
```

### 3. Call `correctPlanFileNaming()` from `planPhase.ts`

In `adws/phases/planPhase.ts`, after the plan agent runs successfully (after line 89, before the current line 90 `getPlanFilePath` call):

- Import `correctPlanFileNaming` from `'../agents'`
- Call `correctPlanFileNaming(issueNumber, worktreePath)` to detect and fix any swapped filenames before resolving the plan path
- The existing `getPlanFilePath` call on line 90 will then find the correctly-named file

```ts
// Correct any swapped plan file naming before resolving the path
correctPlanFileNaming(issueNumber, worktreePath);

// Re-resolve the plan file path now that the plan agent has created the file
const resolvedPlanPath = getPlanFilePath(issueNumber, worktreePath);
```

- Also add `correctPlanFileNaming` to the import statement from `'../agents'`

### 4. Export `correctPlanFileNaming` from the agents index

In `adws/agents/index.ts` (or wherever the agents barrel export is), add `correctPlanFileNaming` to the exports from `planAgent`.

### 5. Add unit tests for `correctPlanFileNaming()`

In `adws/__tests__/planAgent.test.ts`, add a new `describe('correctPlanFileNaming')` block with the following test cases:

- **returns null when correctly-named file already exists** — Mock `readdirSync` to return a file matching `issue-42-adw-abc-sdlc_planner-fix.md`. Assert the function returns `null` and `renameSync` is not called.
- **renames swapped file to correct convention** — Mock `readdirSync` to return `issue-abc123-adw-42-sdlc_planner-fix-login.md`. Assert `renameSync` is called with the correct old and new paths, and the function returns `specs/issue-42-adw-abc123-sdlc_planner-fix-login.md`.
- **returns null when no matching files exist** — Mock `readdirSync` to return unrelated files. Assert the function returns `null`.
- **returns null when specs directory does not exist** — Mock `readdirSync` to throw ENOENT. Assert the function returns `null`.
- **handles worktreePath correctly** — Mock `readdirSync` with a swapped file. Assert `readdirSync` is called with `{worktreePath}/specs` and `renameSync` uses the full worktree paths.

### 6. Run validation commands

Execute the validation commands below to confirm the fix works with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npm run build` — Build the application to verify no build errors
- `npm test` — Run tests to validate the bug is fixed with zero regressions
- `npx tsc --noEmit -p adws/tsconfig.json` — Run additional TypeScript type checks for the adws directory

## Notes
- The prompt clarity fix (Step 1) is the primary fix. The code-level safety net (Steps 2-5) is a defense-in-depth measure. Both are needed because LLM behavior is non-deterministic and the swapped naming causes a silent downstream failure.
- The `patch.md` command uses a different variable ordering (`$1` = adwId, `$2` = reviewChangeRequest) and a different naming convention (`patch-adw-{adwId}-{name}.md`), so it is not affected by this bug.
- The `correctPlanFileNaming()` function intentionally does NOT modify the plan file's Metadata content (the swapped `issueNumber`/`adwId` values inside the file). The filename is the critical path for downstream consumers (`findPlanFile`, `getPlanFilePath`, `buildAgent`). The Metadata inside the file is informational and does not affect functionality.
