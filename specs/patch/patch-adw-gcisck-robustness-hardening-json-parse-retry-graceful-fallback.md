# Patch: JSON parse graceful fallback + single agent retry

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** `parseResolutionResult()` in `adws/agents/resolutionAgent.ts` throws on invalid JSON instead of returning a graceful fallback `{ resolved: false, decisions: [] }`. Both `runResolutionAgent()` and `runValidationAgent()` lack a single-retry mechanism when the agent returns non-JSON output.
**Solution:** Change `parseResolutionResult()` to return a fallback on parse failure (matching the existing `parseValidationResult()` pattern in `validationAgent.ts`). Add a single agent retry in `runResolutionAgent()` and `runValidationAgent()` when JSON parse is detected as a fallback.

## Files to Modify

- `adws/agents/resolutionAgent.ts` — Convert `parseResolutionResult()` from throwing to graceful fallback; add retry logic in `runResolutionAgent()`
- `adws/agents/validationAgent.ts` — Add retry logic in `runValidationAgent()` when parse produces a fallback result

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Convert `parseResolutionResult()` to graceful fallback
- In `adws/agents/resolutionAgent.ts`, add `import { log } from "../core/logger";` to the imports
- Replace the `throw new Error(...)` in `parseResolutionResult()` with a warning log and fallback return, mirroring the pattern in `parseValidationResult()` (validationAgent.ts:89-103):
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
- In `runResolutionAgent()`, after calling `parseResolutionResult()`, detect if the result is a fallback from a non-JSON parse (i.e., `resolved === false` and `decisions.length === 0` and `extractJson()` returned null on the raw output)
- If fallback detected, log "Resolution agent returned non-JSON output, retrying once..." and re-run the agent
- If retry also fails parsing, return the graceful degradation result
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
- In `runValidationAgent()`, after calling `parseValidationResult()`, detect if the result is a fallback from non-JSON parse. The fallback sets `mismatches[0].description` starting with "Validation agent did not return valid JSON"
- If fallback detected, log "Validation agent returned non-JSON output, retrying once..." and re-run the agent
- If retry also fails, return the fallback unaligned result (existing behavior)
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
**Testing required:** TypeScript compilation + linting (unit tests disabled per `.adw/project.md`)
