# Patch: Resolution agent graceful degradation on invalid JSON

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`

## Issue Summary
**Original Spec:** `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md` (Step 10)
**Issue:** `parseResolutionResult()` in `resolutionAgent.ts` throws an error when `extractJson()` returns null or the parsed result has an invalid `resolved` field. This crashes the workflow instead of allowing the plan validation retry loop to handle the failure gracefully.
**Solution:** Change `parseResolutionResult()` to return a fallback `{ resolved: false, decisions: [] }` with a warning log when parsing fails, mirroring the existing `parseValidationResult()` pattern in `validationAgent.ts`.

## Files to Modify

- `adws/agents/resolutionAgent.ts` — Change `parseResolutionResult()` from throwing to returning a graceful fallback

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add logger import to `resolutionAgent.ts`
- Add `import { log } from "../core/logger";` to the existing imports (matching `validationAgent.ts`)

### Step 2: Replace the throw with a warning log and fallback return in `parseResolutionResult()`
- When `extractJson()` returns null or `parsed.resolved` is not a boolean:
  - Log a warning with a preview of the agent output (first 200 chars): `log(\`Resolution agent returned non-JSON output, treating as unresolved: ${preview}\`, "warn");`
  - Return the fallback: `{ resolved: false, decisions: [] }`
- Remove the `throw new Error(...)` statement
- Keep the happy path unchanged (when parsing succeeds, return the parsed result as before)

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Patch Scope
**Lines of code to change:** ~6
**Risk level:** low
**Testing required:** TypeScript compilation and linting (unit tests disabled per `.adw/project.md`)
