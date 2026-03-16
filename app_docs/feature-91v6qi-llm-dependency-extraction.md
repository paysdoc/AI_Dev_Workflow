# LLM-Based Issue Dependency Extraction

**ADW ID:** 91v6qi-llm-based-issue-depe
**Date:** 2026-03-16
**Specification:** specs/issue-185-adw-91v6qi-llm-based-issue-depe-sdlc_planner-llm-dependency-extraction.md

## Overview

Replaces the rigid regex-based dependency parser in `issueDependencies.ts` with LLM-powered extraction that understands natural-language dependency expressions. The existing regex parser is retained as a fallback when the LLM call fails or returns an empty result. This ensures issues expressing dependencies as "blocked by #42" or "can't start until #10 lands" are correctly deferred rather than prematurely processed.

## What Was Built

- **`/extract_dependencies` slash command** — meta-prompt that instructs the LLM to return a JSON array of dependency issue numbers from a raw issue body
- **`dependencyExtractionAgent.ts`** — agent that invokes `/extract_dependencies` via `runClaudeAgentWithCommand` using the `haiku` model
- **`parseDependencyArray` helper** — pure function that extracts a JSON array of positive integers from agent output, exported for independent unit testing
- **`extractDependencies` async function** — LLM-first extraction with regex fallback in `issueDependencies.ts`
- **Updated `findOpenDependencies`** — now accepts optional `logsDir`, `statePath`, and `cwd` parameters; calls `extractDependencies` instead of `parseDependencies` directly
- **`runClaudeAgent` function** — new prompt-based agent runner added to `claudeAgent.ts` (alongside the existing `runClaudeAgentWithCommand`)
- **Tests** — `dependencyExtractionAgent.test.ts` and `issueDependencies.test.ts` covering extraction accuracy, edge cases, and fallback behavior

## Technical Implementation

### Files Modified

- `.claude/commands/extract_dependencies.md`: New slash command prompt — recognizes "blocked by", "depends on", "requires", "after", "prerequisite", "waiting on" patterns; excludes "related to", "see also", "fixes", "closes", "resolves"
- `adws/agents/dependencyExtractionAgent.ts`: New agent — calls `/extract_dependencies` with `haiku` model, parses JSON output via `parseDependencyArray`
- `adws/agents/claudeAgent.ts`: Added `runClaudeAgent` (prompt-via-stdin variant) alongside existing `runClaudeAgentWithCommand`
- `adws/agents/index.ts`: Exports `runDependencyExtractionAgent` and `parseDependencyArray`
- `adws/triggers/issueDependencies.ts`: Added `extractDependencies` async function; updated `findOpenDependencies` signature with optional `logsDir` (default: `'logs'`), `statePath`, `cwd`
- `adws/types/issueTypes.ts`: Added `/extract_dependencies` to `SlashCommand` union
- `adws/types/agentTypes.ts`: Added `'dependency-extraction-agent'` to `AgentIdentifier` union
- `adws/core/config.ts`: Registered `/extract_dependencies` in all four maps (`SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`) with `haiku` model and `low` effort
- `adws/__tests__/dependencyExtractionAgent.test.ts`: New tests for `parseDependencyArray` and `runDependencyExtractionAgent`
- `adws/__tests__/issueDependencies.test.ts`: New tests for `parseDependencies` regression, `extractDependencies`, and `findOpenDependencies` integration

### Key Changes

- **LLM-first, regex-fallback pattern**: `extractDependencies` calls the agent; if the agent succeeds and returns results, those are used. If it fails or returns `[]`, `parseDependencies` (regex) is called instead.
- **`haiku` model deliberately chosen**: Dependency extraction is a simple JSON-returning task — fast and cheap. Both normal and fast config maps use `haiku` with `low` effort.
- **`parseDependencyArray` is a pure exported function**: Uses `output.match(/\[[-\d,\s]*\]/)` to locate the first JSON array in agent output, parses it, filters to unique positive integers. Handles surrounding text, malformed output, duplicates, and negatives gracefully.
- **`findOpenDependencies` is backwards-compatible**: The new `logsDir`, `statePath`, and `cwd` parameters are all optional with sensible defaults. No existing call sites break.
- **`parseDependencies` is unchanged**: The regex fallback remains identical — it is not renamed, modified, or removed.

## How to Use

The LLM extraction is automatic — no call-site changes are required. `findOpenDependencies` now uses LLM extraction by default.

**To pass logs directory and state for agent tracking:**

```typescript
const openDeps = await findOpenDependencies(
  issue.body,
  repoInfo,
  logsDir,      // e.g. 'logs/issue-42'
  statePath,    // optional: path to state directory
  cwd,          // optional: working directory
);
```

**To use the extraction agent directly:**

```typescript
import { runDependencyExtractionAgent, parseDependencyArray } from 'adws/agents';

const result = await runDependencyExtractionAgent(issueBody, logsDir);
// result.dependencies → number[]
// result.success → boolean
```

**To parse agent output independently:**

```typescript
import { parseDependencyArray } from 'adws/agents';

const deps = parseDependencyArray('[42, 10, 7]');  // → [42, 10, 7]
const empty = parseDependencyArray('no deps here'); // → []
```

## Configuration

`/extract_dependencies` is registered in `adws/core/config.ts`:

| Map | Value |
|-----|-------|
| `SLASH_COMMAND_MODEL_MAP` | `haiku` |
| `SLASH_COMMAND_MODEL_MAP_FAST` | `haiku` |
| `SLASH_COMMAND_EFFORT_MAP` | `low` |
| `SLASH_COMMAND_EFFORT_MAP_FAST` | `low` |

No environment variables or `.adw/` configuration changes are required.

## Testing

```bash
bun run test adws/__tests__/dependencyExtractionAgent.test.ts
bun run test adws/__tests__/issueDependencies.test.ts
```

Tests cover:
- `parseDependencyArray`: valid arrays, empty arrays, JSON embedded in text, malformed output, non-integers, duplicates, negatives/zero
- `runDependencyExtractionAgent`: correct command invocation, result parsing, failure handling
- `parseDependencies`: regression tests for existing regex behavior
- `extractDependencies`: LLM-success path, LLM-failure fallback, LLM-empty fallback
- `findOpenDependencies`: end-to-end with mocked agent and `getIssueState`

## Notes

- Issue bodies that express dependencies only through natural language (no `## Dependencies` heading) will now be correctly detected by the LLM. Mere mentions ("related to #5", "see also #5", "fixes #3") are explicitly excluded in the command prompt.
- The `planValidationPhase.ts`, `validationAgent.ts`, and `resolutionAgent.ts` also received updates in this branch (improving command-based agent usage patterns); those are separate from the dependency extraction feature.
- Agent logs are written to `<logsDir>/dependency-extraction-agent.jsonl`.
