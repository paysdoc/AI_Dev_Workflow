# Review & Patch Agents

## Overview

This module contains four agents that handle quality-gate and reconciliation phases of the ADW pipeline: reviewing implementations against specs, evaluating git diffs for regression risk, applying targeted patches to fix blocker issues, and reconciling mismatches between implementation plans and BDD scenarios.

## Responsibilities

- **reviewAgent**: Invokes the `/review` slash command as a passive judge — reads a `scenario_proof.md` artifact and returns a structured `ReviewResult` with `reviewIssues` classified by severity (`skippable`, `tech-debt`, `blocker`). Does not run tests, start a dev server, or take screenshots.
- **reviewAgent**: Derives `passed` and `blockerIssues` from the parsed result: `passed` is true when `reviewResult.success` is true or there are zero blocker issues.
- **reviewAgent**: Accepts an optional `scenarioProofPath` argument forwarded as a positional arg to the `/review` command.
- **diffEvaluatorAgent**: Invokes the `/diff_evaluator` slash command using Haiku (cheap, fast) to binary-classify a git diff as `safe` (auto-merge allowed) or `regression_possible` (escalate to human/phase-level handling).
- **diffEvaluatorAgent**: Extracts the verdict by regex-matching a JSON object containing a `verdict` field, falling back to a structured error on parse failure; the phase-level caller (`diffEvaluationPhase.ts`) owns the `regression_possible` fallback on exhaustion.
- **patchAgent**: Invokes the `/patch` slash command for each individual `ReviewIssue` with severity `blocker`. Writes a per-issue output file (`patch-agent-issue-<N>.jsonl`). Model and effort are resolved via `getModelForCommand`/`getEffortForCommand`, defaulting to `opus` for complex code changes.
- **resolutionAgent**: Invokes the `/resolve_plan_scenarios` command to reconcile mismatches between an implementation plan file and BDD scenario files. Returns a `ResolutionResult` with per-mismatch `decisions` recording whether the plan, the scenarios, or both were updated.
- **resolutionAgent**: Delegates output-validation retries to the shared `commandAgent` retry loop; throws `OutputValidationError` on exhaustion (caller handles gracefully).

## Contracts & Invariants

- All four agents delegate to `runCommandAgent` (or `runClaudeAgentWithCommand` for patchAgent) — output schema validation and retry logic are owned by that layer, not here.
- `ReviewResult.success` and `blockerIssues.length === 0` are both sufficient conditions for `passed = true`; both are evaluated and OR'd together.
- `DiffEvaluatorVerdict.verdict` is strictly `'safe' | 'regression_possible'`; any other value causes a structured parse error, not an exception.
- `ResolutionDecision.action` is strictly `'updated_plan' | 'updated_scenarios' | 'updated_both'`.
- `patchAgent` generates one output file per issue number (`patch-agent-issue-<N>.jsonl`), making patch logs individually addressable.
- `reviewAgent` never runs tests or side effects — it is a passive judge over already-produced artifacts.
- `resolutionAgent` serializes the `mismatches` array as `JSON.stringify(mismatches)` in its positional args.

## Configuration

Model and effort for `/patch` are resolved dynamically from `getModelForCommand('/patch', issueBody)` and `getEffortForCommand('/patch', issueBody)`, allowing the caller to influence model selection by passing an `issueBody`. The diff evaluator uses Haiku (controlled by the `/diff_evaluator` command definition). All other agents inherit model selection from `commandAgent` defaults.

## Gotchas

- `patchAgent` cannot use `CommandAgentConfig` because its output file name is dynamic (per issue number); it calls `runClaudeAgentWithCommand` directly instead.
- `reviewAgent`'s `passed` flag is `true` when `reviewResult` is null and `blockerIssues` is empty (null-coalesced to `[]`), so a completely unparseable review response will be treated as "passed" — the caller must check `result.parsed` independently if it needs to distinguish parse failure from a clean review.
- `diffEvaluatorAgent` uses a regex match (`/\{[\s\S]*?"verdict"[\s\S]*?\}/`) rather than `extractJson` — it will match the first JSON-like object containing `verdict`, which may differ from `extractJson` behavior on multi-object outputs.
- `resolutionAgent` spreads `result.parsed` as `resolutionResult` without a null guard; if the retry loop exhausts without a valid parse, it throws before reaching the return, so callers must handle `OutputValidationError` at the phase level.
- `reviewAgent`'s `screenshots` field is declared in the schema and interface but is not consumed by this agent — it is passed through from the `/review` command output for callers that want it.
