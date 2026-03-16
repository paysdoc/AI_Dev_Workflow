# Feature: LLM-Based Issue Dependency Extraction

## Metadata
issueNumber: `185`
adwId: `91v6qi-llm-based-issue-depe`
issueJson: `{"number":185,"title":"LLM-Based Issue Dependency Extraction","body":"## Problem\n\nThe current dependency detection in `issueDependencies.ts` relies on rigid regex parsing that requires:\n\n1. A `## Dependencies` or `## Depends on` markdown heading\n2. Issue references in exactly `#N` or full GitHub URL format within that section\n\nThis misses natural-language dependency expressions such as:\n- \"blocked by #42\"\n- \"can't start until #10 lands\"\n- \"prerequisite: #7\"\n- \"this requires the auth refactor in #55 to be merged first\"\n- Dependencies mentioned outside a dedicated heading\n- Dependencies without any heading at all\n\n## Solution\n\nReplace regex-based extraction with LLM-based extraction using a new Claude command and agent.\n\n### Deliverables\n\n#### 1. Claude Command: `.claude/commands/extract_dependencies.md`\n\nCreate a meta-prompt command that receives a raw issue body and returns a JSON array of dependency issue numbers.\n\n**Variables:**\n- `$1` — the raw issue body text\n\n**Instructions — the command must:**\n- Analyze the full issue body for any language that implies a dependency, prerequisite, or blocking relationship\n- Recognize varied patterns: \"blocked by\", \"depends on\", \"requires\", \"after\", \"prerequisite\", \"can't start until\", \"waiting on\", `#N` references in dependency context, full GitHub issue URLs, task list items (`- [ ] #N`), and similar\n- Distinguish actual dependencies from mere mentions (e.g., \"related to #5\" or \"see also #5\" are NOT dependencies; \"blocked by #5\" IS a dependency)\n- Return ONLY a valid JSON array of unique issue numbers, e.g., `[42, 10, 7]`\n- Return `[]` when no dependencies are found\n- Never include explanation or surrounding text — raw JSON only\n\n#### 2. Agent: `adws/agents/dependencyExtractionAgent.ts`\n\nCreate an agent function that calls `runClaudeAgentWithCommand` with the `/extract_dependencies` command.\n\n**Function signature:**\n```typescript\nexport async function runDependencyExtractionAgent(\n  issueBody: string,\n  logsDir: string,\n  statePath?: string,\n  cwd?: string,\n): Promise<AgentResult & { dependencies: number[] }>\n```\n\n**Implementation requirements:**\n- Pass the issue body as a single argument to `/extract_dependencies`\n- Use `haiku` as the model (fast and cheap — this is a simple extraction task)\n- Parse the returned JSON array from the agent output\n- Return the parsed `dependencies` array alongside the standard `AgentResult`\n- Handle parse failures gracefully: log a warning and return an empty array\n\n#### 3. Integration: `adws/triggers/issueDependencies.ts`\n\nReplace the `parseDependencies` function body to call `runDependencyExtractionAgent` instead of using regex.\n\n**Changes:**\n- `parseDependencies` becomes async (or introduce a new `extractDependencies` async function)\n- `findOpenDependencies` calls the new extraction instead of regex parsing\n- The existing `findOpenDependencies` contract (returns `Promise<number[]>` of open dependency issue numbers) remains unchanged\n- Keep the existing regex parser as a fast-path fallback if the LLM call fails\n\n#### 4. Tests\n\nAdd tests in `adws/__tests__/` covering:\n\n- **Command output parsing**: valid JSON arrays, empty arrays, malformed output\n- **Extraction accuracy**: natural-language dependency expressions are detected\n- **Non-dependencies are excluded**: \"related to\", \"see also\", \"fixes\", \"closes\" are not treated as dependencies\n- **Graceful degradation**: LLM failure falls back to regex parsing\n- **Integration**: `findOpenDependencies` works end-to-end with the new extraction\n\n## Acceptance Criteria\n\n- [ ] `/extract_dependencies` command exists and returns a valid JSON array of issue numbers\n- [ ] `runDependencyExtractionAgent` agent calls the command with haiku model\n- [ ] `findOpenDependencies` uses LLM extraction with regex fallback\n- [ ] All natural-language dependency patterns listed above are correctly extracted\n- [ ] Mere mentions (\"related to\", \"see also\") are not treated as dependencies\n- [ ] Output is always a deduplicated array of positive integers\n- [ ] Tests cover extraction accuracy, edge cases, and fallback behavior\n- [ ] No changes to the `findOpenDependencies` return type or the eligibility evaluation contract\n\n## Dependencies\n\nNone\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-16T08:38:27Z","comments":[],"actionableComment":null}`

## Feature Description
Replace the rigid regex-based dependency parsing in `issueDependencies.ts` with LLM-based extraction using a new Claude slash command (`/extract_dependencies`) and a dedicated agent (`dependencyExtractionAgent.ts`). The current implementation requires a `## Dependencies` markdown heading and only recognizes `#N` or full GitHub URL formats. The new LLM-based approach will understand natural-language dependency expressions like "blocked by #42", "can't start until #10 lands", "prerequisite: #7", and similar patterns — including dependencies mentioned outside a dedicated heading. The existing regex parser is retained as a fallback if the LLM call fails.

## User Story
As an ADW workflow operator
I want issue dependencies to be extracted from natural-language expressions in issue bodies
So that dependency resolution is more robust and doesn't require authors to follow a rigid markdown format

## Problem Statement
The current `parseDependencies()` function uses regex to find issue references under a `## Dependencies` heading. This misses natural-language dependency expressions ("blocked by #42", "prerequisite: #7", "requires #55 to be merged first") and dependencies mentioned outside a dedicated heading. Issues with informally stated dependencies slip through as "no dependencies found", causing premature processing.

## Solution Statement
Introduce an LLM-based extraction layer that analyzes the full issue body for dependency semantics. A new `/extract_dependencies` slash command provides the prompt template. A new `dependencyExtractionAgent.ts` calls this command via `runClaudeAgentWithCommand` with the `haiku` model for fast, cheap extraction. The existing `findOpenDependencies` function is updated to try LLM extraction first and fall back to regex parsing on failure, preserving the existing contract.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/issueDependencies.ts` — Current regex-based dependency parser. The `parseDependencies` function will be kept as-is (renamed to internal use) and a new `extractDependencies` async function will be added. `findOpenDependencies` will be updated to use LLM extraction with regex fallback.
- `adws/triggers/issueEligibility.ts` — Calls `findOpenDependencies`. No changes needed (contract is preserved), but important to verify no breakage.
- `adws/agents/claudeAgent.ts` — Base agent runner. Provides `runClaudeAgentWithCommand` and `AgentResult` type used by the new agent.
- `adws/agents/planAgent.ts` — Reference implementation for agent pattern (how to call `runClaudeAgentWithCommand`, format args, handle results).
- `adws/agents/index.ts` — Agent barrel file. Must export the new agent.
- `adws/types/issueTypes.ts` — `SlashCommand` union type. Must add `/extract_dependencies` entry.
- `adws/types/agentTypes.ts` — `AgentIdentifier` union type. Must add `'dependency-extraction-agent'` entry.
- `adws/core/config.ts` — `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`. Must add entries for `/extract_dependencies`.
- `.claude/commands/find_issue_dependencies.md` — Existing dependency command for reference on prompt style.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

### New Files
- `.claude/commands/extract_dependencies.md` — New slash command prompt that instructs the LLM to extract dependency issue numbers from a raw issue body and return a JSON array.
- `adws/agents/dependencyExtractionAgent.ts` — New agent that calls `/extract_dependencies` via `runClaudeAgentWithCommand` and parses the JSON result.
- `adws/__tests__/dependencyExtractionAgent.test.ts` — Tests for the new agent (output parsing, graceful degradation).
- `adws/__tests__/issueDependencies.test.ts` — Tests for the updated `findOpenDependencies` integration (LLM-first with regex fallback).

## Implementation Plan
### Phase 1: Foundation
Register the new `/extract_dependencies` slash command in the type system and config maps. Add the `'dependency-extraction-agent'` identifier to `AgentIdentifier`. This ensures TypeScript compilation succeeds when the new agent and command are referenced.

### Phase 2: Core Implementation
1. Create the `.claude/commands/extract_dependencies.md` prompt template.
2. Create `adws/agents/dependencyExtractionAgent.ts` following the `planAgent.ts` pattern.
3. Export the new agent from `adws/agents/index.ts`.

### Phase 3: Integration
1. Update `adws/triggers/issueDependencies.ts` to add a new `extractDependencies` async function that calls the LLM agent.
2. Update `findOpenDependencies` to try `extractDependencies` first, falling back to the existing `parseDependencies` on failure.
3. Pass `logsDir` through to `findOpenDependencies` (new parameter with a sensible default).

## Step by Step Tasks

### Step 1: Add `/extract_dependencies` to type system and config
- In `adws/types/issueTypes.ts`, add `| '/extract_dependencies'` to the `SlashCommand` union (in the "Dependency checking" section, after `/find_issue_dependencies`).
- In `adws/types/agentTypes.ts`, add `| 'dependency-extraction-agent'` to the `AgentIdentifier` union (after `'resolution-agent'`).
- In `adws/core/config.ts`, add `/extract_dependencies` entries to all four maps:
  - `SLASH_COMMAND_MODEL_MAP`: `'/extract_dependencies': 'haiku'`
  - `SLASH_COMMAND_MODEL_MAP_FAST`: `'/extract_dependencies': 'haiku'`
  - `SLASH_COMMAND_EFFORT_MAP`: `'/extract_dependencies': 'low'`
  - `SLASH_COMMAND_EFFORT_MAP_FAST`: `'/extract_dependencies': 'low'`

### Step 2: Create the `/extract_dependencies` slash command
- Create `.claude/commands/extract_dependencies.md` with:
  - Variable: `$ARGUMENTS` — the raw issue body text
  - Instructions to analyze the full issue body for dependency/prerequisite/blocking language
  - Pattern recognition list: "blocked by", "depends on", "requires", "after", "prerequisite", "can't start until", "waiting on", `#N` in dependency context, full GitHub issue URLs, task list items (`- [ ] #N`)
  - Explicit instruction to distinguish dependencies from mere mentions ("related to", "see also", "fixes", "closes" are NOT dependencies)
  - Output format: raw JSON array of unique positive integer issue numbers, e.g., `[42, 10, 7]`
  - Return `[]` when no dependencies are found
  - Never include explanation or surrounding text

### Step 3: Create the dependency extraction agent
- Create `adws/agents/dependencyExtractionAgent.ts` with:
  - Import `runClaudeAgentWithCommand`, `AgentResult` from `./claudeAgent`
  - Import `log` from `../core`
  - Import `getModelForCommand`, `getEffortForCommand` from `../core`
  - Function `parseDependencyArray(output: string): number[]` — extracts a JSON array from agent output:
    - Try to find a JSON array pattern `\[[\d,\s]*\]` in the output
    - Parse it with `JSON.parse`
    - Filter to positive integers, deduplicate
    - On any failure, log a warning and return `[]`
  - Function `runDependencyExtractionAgent(issueBody: string, logsDir: string, statePath?: string, cwd?: string): Promise<AgentResult & { dependencies: number[] }>`:
    - Build output file path: `path.join(logsDir, 'dependency-extraction-agent.jsonl')`
    - Call `runClaudeAgentWithCommand('/extract_dependencies', issueBody, 'Dependency Extraction', outputFile, getModelForCommand('/extract_dependencies'), getEffortForCommand('/extract_dependencies'), undefined, statePath, cwd)`
    - Parse the result output with `parseDependencyArray`
    - Return `{ ...result, dependencies }`
- Export `runDependencyExtractionAgent` and `parseDependencyArray` from the module.

### Step 4: Export the new agent from the barrel file
- In `adws/agents/index.ts`, add an export section for the Dependency Extraction Agent:
  ```typescript
  // Dependency Extraction Agent
  export {
    runDependencyExtractionAgent,
    parseDependencyArray,
  } from './dependencyExtractionAgent';
  ```

### Step 5: Integrate LLM extraction into `issueDependencies.ts`
- In `adws/triggers/issueDependencies.ts`:
  - Add import for `runDependencyExtractionAgent` from `../agents/dependencyExtractionAgent`
  - Keep the existing `parseDependencies` function unchanged (used as fallback)
  - Add a new async function `extractDependencies(issueBody: string, logsDir: string, statePath?: string, cwd?: string): Promise<number[]>` that:
    - Calls `runDependencyExtractionAgent(issueBody, logsDir, statePath, cwd)`
    - If `result.success` is true and `result.dependencies.length > 0`, returns `result.dependencies`
    - If the agent fails or returns empty, logs a warning and falls back to `parseDependencies(issueBody)`
  - Update `findOpenDependencies` signature to accept an optional `logsDir` parameter (default: `'logs'`)
  - Update `findOpenDependencies` to call `extractDependencies` instead of `parseDependencies` directly
  - The return type `Promise<number[]>` remains unchanged

### Step 6: Create tests for the dependency extraction agent
- Create `adws/__tests__/dependencyExtractionAgent.test.ts` with tests for:
  - `parseDependencyArray`:
    - Valid JSON array `[1, 2, 3]` → returns `[1, 2, 3]`
    - Empty array `[]` → returns `[]`
    - Array with surrounding text `"Here are the deps: [42, 10]"` → returns `[42, 10]`
    - Malformed output (no array) → returns `[]`
    - Array with non-integer values → filters to positive integers only
    - Duplicate values → deduplicates
    - Negative numbers and zero → excluded
  - `runDependencyExtractionAgent`:
    - Mock `runClaudeAgentWithCommand` to return success with `[42, 10]`
    - Verify it calls the command with `/extract_dependencies`, the issue body, `haiku` model
    - Verify the result contains `dependencies: [42, 10]`
    - Mock agent failure → verify `dependencies` is `[]`

### Step 7: Create tests for updated `findOpenDependencies`
- Create `adws/__tests__/issueDependencies.test.ts` with tests for:
  - `parseDependencies` (existing regex behavior — regression tests):
    - Issue body with `## Dependencies` heading and `#N` references
    - Issue body with `## Depends on` heading and GitHub URLs
    - Issue body with no dependencies section → returns `[]`
    - Empty body → returns `[]`
  - `extractDependencies` (new LLM integration):
    - Mock `runDependencyExtractionAgent` to return success → uses LLM result
    - Mock `runDependencyExtractionAgent` to return failure → falls back to regex
    - Mock `runDependencyExtractionAgent` to return empty array → falls back to regex
  - `findOpenDependencies` (integration):
    - Mock `extractDependencies` and `getIssueState` → returns only open deps
    - Verify the existing contract (returns `Promise<number[]>` of open issue numbers)

### Step 8: Run validation commands
- Run `bun run test` to validate all tests pass with zero regressions
- Run `bun run lint` to ensure code quality
- Run `bun run build` to verify no build errors

## Testing Strategy
### Unit Tests
- `parseDependencyArray`: Pure function tests for JSON extraction from various agent output formats (clean JSON, JSON with surrounding text, malformed output, edge cases with non-integers, duplicates, negatives).
- `runDependencyExtractionAgent`: Mock `runClaudeAgentWithCommand` to test agent invocation with correct parameters and result parsing.
- `parseDependencies`: Regression tests for existing regex behavior.
- `extractDependencies`: Mock the agent to test LLM-first-with-regex-fallback logic.
- `findOpenDependencies`: Integration test with mocked agent and `getIssueState`.

### Edge Cases
- Issue body is empty or undefined → returns `[]`
- Agent output contains no JSON array → graceful fallback to regex
- Agent output contains multiple JSON arrays → extracts the first one
- Issue body contains issue numbers in non-dependency contexts ("related to #5", "see also #5", "fixes #3") → LLM should exclude these
- Issue body has dependencies in `## Dependencies` heading AND natural-language elsewhere → all are captured
- Issue body with only natural-language dependencies and no heading → LLM captures them
- Agent call throws an exception → caught, logged, falls back to regex
- Duplicate issue numbers across LLM extraction → deduplicated
- Very large issue body → agent handles it (no special handling needed)

## Acceptance Criteria
- `/extract_dependencies` command exists in `.claude/commands/extract_dependencies.md` and instructs the LLM to return a valid JSON array of issue numbers
- `runDependencyExtractionAgent` agent calls the command with `haiku` model via `runClaudeAgentWithCommand`
- `findOpenDependencies` uses LLM extraction with regex fallback on failure
- All natural-language dependency patterns ("blocked by", "depends on", "requires", "after", "prerequisite", "can't start until", "waiting on") are correctly extracted by the command prompt
- Mere mentions ("related to", "see also", "fixes", "closes") are explicitly excluded in the command prompt
- Output is always a deduplicated array of positive integers
- Tests cover extraction accuracy, edge cases, and fallback behavior
- No changes to the `findOpenDependencies` return type or the `checkIssueEligibility` contract in `issueEligibility.ts`
- `/extract_dependencies` is registered in `SlashCommand` type, `AgentIdentifier` type, and all four config maps
- `parseDependencyArray` is exported and independently testable

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bun run build` - Build the application to verify no build errors
- `bun run test` - Run tests to validate the feature works with zero regressions

## Notes
- The `guidelines/coding_guidelines.md` must be followed: strict TypeScript, no `any`, functional patterns (map/filter/reduce), single responsibility modules, immutability.
- The `haiku` model is deliberately chosen for `/extract_dependencies` because this is a simple extraction task — fast and cheap. Both normal and fast mode maps use `haiku`.
- The `parseDependencyArray` helper is exported separately from the agent function to enable pure-function unit testing without mocking the agent.
- The existing `parseDependencies` regex function is kept unchanged as the fallback path. It is not renamed or modified — only the call site in `findOpenDependencies` changes.
- The `findOpenDependencies` function gains an optional `logsDir` parameter. Callers that don't pass it get a sensible default (`'logs'`), so no existing call sites break.
- Read `app_docs/feature-74itmf-dependency-logging.md` if available, for context on dependency logging patterns when implementing the extraction flow.
