# Feature: Add runPrimedClaudeAgentWithCommand to prime agent context before command execution

## Metadata
issueNumber: `189`
adwId: `uzfskg-add-runprimedclaudea`
issueJson: `{"number":189,"title":"Add runPrimedClaudeAgentWithCommand to prime agent context before command execution","body":"## Problem\n\nThe plan agent and scenario agent each independently explore the codebase to build context before doing their actual work. This is wasteful because:\n\n1. Each agent spawns a new Claude CLI process with a fresh context window\n2. Both agents redundantly discover the same project structure, README, and documentation\n3. Tokens spent on codebase exploration reduce the context available for actual planning/scenario work\n\n## Proposed Solution\n\nAdd a new function `runPrimedClaudeAgentWithCommand` in `adws/agents/claudeAgent.ts` that runs `/install` (which calls `/prime`) before executing the given slash command — **in the same CLI invocation** so both share the same context window.\n\n### Implementation\n\n**1. New function in `adws/agents/claudeAgent.ts`**\n\n```typescript\nexport async function runPrimedClaudeAgentWithCommand(\n  command: string,\n  args: string | readonly string[],\n  agentName: string,\n  outputFile: string,\n  model?: string,\n  effort?: string,\n  onProgress?: ProgressCallback,\n  statePath?: string,\n  cwd?: string\n): Promise<AgentResult>\n```\n\nThis function composes a two-step prompt that:\n1. First executes `/install` to prime the context with project structure, README, and conditional docs\n2. Then executes the actual command (e.g., `/feature`, `/scenario_writer`) with the provided args\n\nThe prompt should use explicit sequencing, e.g.:\n```\n/install\\n\\nOnce /install completes, run: /feature 'arg1' 'arg2' 'arg3'\n```\n\nEverything else (spawning, streaming, state tracking) delegates to the existing `runClaudeAgentWithCommand` internals or calls it directly.\n\n**2. Update `runPlanAgent` in `adws/agents/planAgent.ts`**\n\n**3. Update `runScenarioAgent` in `adws/agents/scenarioAgent.ts`**\n\n**4. Export from `adws/agents/index.ts`**\n\n**5. Tests**\n\n- Unit test that `runPrimedClaudeAgentWithCommand` constructs a prompt starting with `/install` followed by the actual command\n- Verify existing plan and scenario agent tests still pass with the updated call","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-16T09:41:27Z","comments":[],"actionableComment":null}`

## Feature Description
Add a new function `runPrimedClaudeAgentWithCommand` that prepends `/install` (which calls `/prime`) before executing a given slash command — all within the same CLI invocation so both steps share the same context window. This eliminates redundant codebase exploration by the plan and scenario agents, which currently each independently discover project structure, README, and documentation before doing their actual work.

## User Story
As an ADW workflow operator
I want plan and scenario agents to be pre-primed with project context before executing their commands
So that tokens spent on redundant codebase exploration are eliminated and agents converge faster on their actual task

## Problem Statement
The plan agent and scenario agent each spawn a fresh Claude CLI process and independently explore the codebase to build context. This is wasteful: both agents redundantly discover the same project structure, README, and documentation. Tokens spent on codebase exploration reduce the context window available for actual planning/scenario work.

## Solution Statement
Introduce `runPrimedClaudeAgentWithCommand` — a thin wrapper around `runClaudeAgentWithCommand` that composes a two-step prompt: first `/install` to prime the context, then the actual slash command with its arguments. The plan agent and scenario agent switch to calling this primed variant. All other agents (build, test, review) remain unchanged since they receive focused context from prior phases and don't need priming.

## Relevant Files
Use these files to implement the feature:

- `adws/agents/claudeAgent.ts` — Contains `runClaudeAgentWithCommand` which is the base function to wrap. The new `runPrimedClaudeAgentWithCommand` function will be added here.
- `adws/agents/planAgent.ts` — Contains `runPlanAgent` (line 271) which currently calls `runClaudeAgentWithCommand` and needs to switch to `runPrimedClaudeAgentWithCommand`.
- `adws/agents/scenarioAgent.ts` — Contains `runScenarioAgent` (line 70) which currently calls `runClaudeAgentWithCommand` and needs to switch to `runPrimedClaudeAgentWithCommand`.
- `adws/agents/index.ts` — Barrel export file for agents. Must add `runPrimedClaudeAgentWithCommand` to exports.
- `adws/agents/__tests__/validationAgent.test.ts` — Reference for existing test patterns (mocking `claudeAgent`, using vitest).
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed (clarity, modularity, type safety, functional style).
- `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md` — Context on the `effort` parameter in `runClaudeAgentWithCommand` to ensure the primed variant preserves this behavior.

### New Files
- `adws/agents/__tests__/claudeAgent.test.ts` — Unit tests for `runPrimedClaudeAgentWithCommand` prompt composition.

## Implementation Plan
### Phase 1: Foundation
Add the `runPrimedClaudeAgentWithCommand` function to `adws/agents/claudeAgent.ts`. This function composes a two-step prompt (`/install` + actual command) and delegates to the existing `runClaudeAgentWithCommand`. The function shares the exact same signature so it's a drop-in replacement for callers that need priming.

### Phase 2: Core Implementation
Update the plan agent and scenario agent to import and call `runPrimedClaudeAgentWithCommand` instead of `runClaudeAgentWithCommand`. This is a minimal change — only the function name changes at the call site, all arguments remain identical.

### Phase 3: Integration
Export `runPrimedClaudeAgentWithCommand` from the barrel `index.ts` and add unit tests verifying prompt composition. Run existing tests to confirm no regressions.

## Step by Step Tasks

### Step 1: Add `runPrimedClaudeAgentWithCommand` to `claudeAgent.ts`
- Read `adws/agents/claudeAgent.ts` to understand the full implementation of `runClaudeAgentWithCommand`.
- Add a new exported function `runPrimedClaudeAgentWithCommand` with the same signature as `runClaudeAgentWithCommand`.
- The function builds a two-step prompt by:
  1. Starting with `/install`
  2. Adding a blank line separator
  3. Appending `Once /install completes, run: <command> <quoted-args>`
- The quoted args use the same `escapeArg` logic as `runClaudeAgentWithCommand`.
- The function then calls `runClaudeAgentWithCommand` with the composed prompt as a single string command, passing through all other parameters unchanged.
- Key detail: the composed prompt replaces both the `command` and `args` parameters — the entire prompt becomes the `args` to a direct call, or the prompt construction is done inline and passed to the spawn logic. The simplest approach: build the full prompt string and pass it as the final CLI argument directly, reusing the spawn/process handling from `runClaudeAgentWithCommand`.

**Implementation approach:** Since `runClaudeAgentWithCommand` builds its prompt as `${command} ${quotedArgs}`, the simplest approach is to have `runPrimedClaudeAgentWithCommand` build the full two-step prompt string and then delegate to the existing spawn logic. Concretely:
  1. Build `quotedArgs` from `args` using the same `escapeArg` helper (extract it or inline it).
  2. Build the full prompt: `/install\n\nOnce /install completes, run: ${command} ${quotedArgs}`
  3. Pass this full prompt directly to the spawn/process handling, reusing `handleAgentProcess`, state logging, and retry logic.

The cleanest way: refactor `runClaudeAgentWithCommand` to accept a pre-built prompt string internally, or have `runPrimedClaudeAgentWithCommand` replicate the spawn logic with the modified prompt. Given the guideline to avoid over-engineering, the recommended approach is to extract the prompt-building step and have `runPrimedClaudeAgentWithCommand` build a different prompt but reuse all the same spawn, logging, and process handling logic.

### Step 2: Update `runPlanAgent` in `planAgent.ts`
- Change the import at line 9 from `runClaudeAgentWithCommand` to `runPrimedClaudeAgentWithCommand`.
- Update line 271 to call `runPrimedClaudeAgentWithCommand` instead of `runClaudeAgentWithCommand`.
- Also update `runPrReviewPlanAgent` at line 224 to call `runPrimedClaudeAgentWithCommand` since PR review planning also benefits from priming.
- All arguments remain exactly the same — it's a drop-in replacement.

### Step 3: Update `runScenarioAgent` in `scenarioAgent.ts`
- Change the import at line 8 from `runClaudeAgentWithCommand` to `runPrimedClaudeAgentWithCommand`.
- Update line 70 to call `runPrimedClaudeAgentWithCommand` instead of `runClaudeAgentWithCommand`.
- All arguments remain exactly the same.

### Step 4: Export from `index.ts`
- Add `runPrimedClaudeAgentWithCommand` to the Claude Agent export block in `adws/agents/index.ts` (around line 8).

### Step 5: Add unit tests for prompt composition
- Create `adws/agents/__tests__/claudeAgent.test.ts`.
- Follow the test pattern from `validationAgent.test.ts`: mock `child_process.spawn`, `fs`, and core modules.
- Test cases:
  - `runPrimedClaudeAgentWithCommand` produces a prompt starting with `/install` followed by a blank line and the actual command with quoted args.
  - String args are properly escaped and included.
  - Array args are each quoted and joined.
  - All parameters (model, effort, statePath, cwd) are passed through correctly.

### Step 6: Run validation commands
- Run `bun run test` to verify all existing tests pass with zero regressions.
- Run `bun run build` (if available) to verify no build errors.

## Testing Strategy
### Unit Tests
- Test that `runPrimedClaudeAgentWithCommand` composes the correct two-step prompt format: `/install\n\nOnce /install completes, run: <command> <args>`.
- Test with string args (single argument).
- Test with array args (multiple positional arguments).
- Test that args containing single quotes are properly escaped.
- Test that model, effort, onProgress, statePath, and cwd are forwarded to the underlying spawn logic.

### Edge Cases
- Args containing single quotes (shell escaping).
- Empty args array.
- Command with leading slash vs without.
- Missing optional parameters (effort undefined, statePath undefined).

## Acceptance Criteria
- [ ] `runPrimedClaudeAgentWithCommand` exists and is exported from `claudeAgent.ts`
- [ ] The function composes a prompt starting with `/install` followed by the actual command
- [ ] Plan agent (`runPlanAgent`) calls `runPrimedClaudeAgentWithCommand`
- [ ] Scenario agent (`runScenarioAgent`) calls `runPrimedClaudeAgentWithCommand`
- [ ] `runPrimedClaudeAgentWithCommand` is exported from `adws/agents/index.ts`
- [ ] New unit test in `adws/agents/__tests__/claudeAgent.test.ts` covers prompt composition
- [ ] Existing tests pass with zero regressions

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run test` — Run all existing tests to verify zero regressions
- `bun run build` — Build the application to verify no TypeScript compilation errors (if build script exists; skip if not available)

## Notes
- **Only plan and scenario agents** use the primed variant. Build, test, review, git, PR, document, patch, KPI, validation, and resolution agents do NOT need priming — they receive focused context from prior workflow phases.
- **PR review plan agent** (`runPrReviewPlanAgent`) should also use the primed variant since it generates revision plans that benefit from project context.
- **Token tradeoff**: `/install` adds tokens per agent invocation, but this is offset by eliminating redundant codebase exploration that each agent currently performs independently.
- **Latency**: Small upfront cost for `/install`, but agents converge faster on their actual task with pre-indexed context.
- Strictly follow `guidelines/coding_guidelines.md`: clarity over cleverness, modularity, immutability, type safety, functional style.
