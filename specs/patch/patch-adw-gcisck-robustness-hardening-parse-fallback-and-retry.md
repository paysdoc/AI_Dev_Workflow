# Patch: Graceful JSON parse fallback + single agent retry for resolution/validation

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #8: Graceful degradation for parseResolutionResult() (spec Step 10) and agent retry on JSON parse failure (spec Step 11) not implemented. resolutionAgent.ts still throws on invalid JSON.`

## Issue Summary
**Original Spec:** `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`
**Issue:** `parseResolutionResult()` in `adws/agents/resolutionAgent.ts` throws on invalid JSON instead of returning a graceful fallback. Neither `runResolutionAgent()` nor `runValidationAgent()` retry the agent when `extractJson()` returns null.
**Solution:** Convert `parseResolutionResult()` to return `{ resolved: false, decisions: [] }` on parse failure (mirroring the existing `parseValidationResult()` pattern). Add a single agent retry in both `runResolutionAgent()` and `runValidationAgent()` when the parse detects non-JSON output.

## Files to Modify

- `adws/agents/resolutionAgent.ts` — Convert `parseResolutionResult()` from throwing to graceful fallback; add retry logic in `runResolutionAgent()`
- `adws/agents/validationAgent.ts` — Add retry logic in `runValidationAgent()` when parse produces a fallback result

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Convert `parseResolutionResult()` to graceful fallback
- In `adws/agents/resolutionAgent.ts`, add `import { log } from "../core/logger";` to the imports
- Replace the `throw new Error(...)` block in `parseResolutionResult()` (lines 41-44) with a warning log and fallback return:
  ```typescript
  export function parseResolutionResult(agentOutput: string): ResolutionResult {
    const parsed = extractJson<ResolutionResult>(agentOutput);
    if (!parsed || typeof parsed.resolved !== "boolean") {
      const preview = agentOutput.substring(0, 200);
      log(`Resolution agent returned non-JSON output, treating as unresolved: ${preview}`, "warn");
      return {
        resolved: false,
        decisions: [],
      };
    }
    return {
      resolved: parsed.resolved,
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    };
  }
  ```

### Step 2: Add single agent retry in `runResolutionAgent()`
- After calling `parseResolutionResult(result.output)` on line 82, check if the result is a non-JSON fallback by testing whether `extractJson(result.output)` returns null
- If fallback detected, log a warning and re-run the agent once
- If retry also produces a fallback, return the graceful degradation result
  ```typescript
  const resolutionResult = parseResolutionResult(result.output);

  // Retry once if the agent returned non-JSON output
  if (!resolutionResult.resolved && resolutionResult.decisions.length === 0 && extractJson(result.output) === null) {
    log("Resolution agent returned non-JSON output, retrying once...", "warn");
    const retryResult = await runClaudeAgentWithCommand(
      "/resolve_plan_scenarios",
      formatResolutionArgs(adwId, issueNumber, planFilePath, scenarioGlob, issueJson, mismatches),
      "resolution-agent",
      outputFile,
      model,
      effort,
      undefined,
      statePath,
      cwd
    );
    const retryParsed = parseResolutionResult(retryResult.output);
    return { ...retryResult, resolutionResult: retryParsed };
  }

  return { ...result, resolutionResult };
  ```

### Step 3: Add single agent retry in `runValidationAgent()`
- After calling `parseValidationResult(result.output)` on line 140, detect if the result is a fallback from non-JSON parse by checking if the single mismatch description starts with "Validation agent did not return valid JSON"
- If fallback detected, log a warning and re-run the agent once
- If retry also fails, return the existing fallback unaligned result
  ```typescript
  const validationResult = parseValidationResult(result.output);

  // Retry once if the agent returned non-JSON output
  const isFallback = !validationResult.aligned
    && validationResult.mismatches.length === 1
    && validationResult.mismatches[0].description.startsWith("Validation agent did not return valid JSON");
  if (isFallback) {
    log("Validation agent returned non-JSON output, retrying once...", "warn");
    const retryResult = await runClaudeAgentWithCommand(
      "/validate_plan_scenarios",
      formatValidationArgs(adwId, issueNumber, planFilePath, scenarioGlob),
      "validation-agent",
      outputFile,
      model,
      effort,
      undefined,
      statePath,
      cwd
    );
    const retryParsed = parseValidationResult(retryResult.output);
    return { ...retryResult, validationResult: retryParsed };
  }

  return { ...result, validationResult };
  ```

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Verify no linting errors
2. `bun run build` — Verify no build errors
3. `bunx tsc --noEmit` — Root TypeScript type checking
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Patch Scope
**Lines of code to change:** ~50
**Risk level:** low
**Testing required:** TypeScript compilation and linting (unit tests disabled per `.adw/project.md`)
