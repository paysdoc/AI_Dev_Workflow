# Review & Patch Agents

## Overview

This module contains four agents that handle quality-gate and reconciliation phases of the ADW pipeline: reviewing implementations against specs, evaluating git diffs for regression risk, applying targeted patches to fix blocker issues, and reconciling mismatches between implementation plans and BDD scenarios.

## Responsibilities

- **reviewAgent**: Invokes the `/review` slash command as an evidence-only judge — reads the issue (from the spec metadata), the diff, the scenario proof and the per-issue images, and returns a structured `ReviewResult` with `reviewIssues` classified by severity (`skippable`, `tech-debt`, `blocker`). Runs no check, dev server or browser. It judges scope (no missing or unrequested change), added suppressions and weakened check configuration, whether the `@adw-<issue>` scenarios test the issue, step-definition independence, the images, coding guidelines, and the guidance section for the application type.
- **reviewAgent**: Derives `passed` and `blockerIssues` from the parsed result: `passed` is true when `reviewResult.success` is true or there are zero blocker issues.
- **reviewAgent**: Takes a `ReviewPromptContext` (`guidanceSection`, `issueKind`, `imagePaths`) and an optional `scenarioProofPath`; `formatReviewArgs` (in `reviewPromptArgs.ts`) turns them into the `/review` positional args `$0`–`$6`, with `$3` an empty string when there is no proof and `$6` the image paths as a JSON array.
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
- `reviewAgent` never runs tests or side effects — it judges already-produced artifacts. Test, lint, type and build results are never review findings.
- `ReviewIssueKind` is `feature | bug | chore | promotion | pr_review`; only `feature` and `bug` make a missing per-issue scenario a blocker.
- `resolutionAgent` serializes the `mismatches` array as `JSON.stringify(mismatches)` in its positional args.

## Configuration

Model and effort for `/patch` are resolved dynamically from `getModelForCommand('/patch', issueBody)` and `getEffortForCommand('/patch', issueBody)`, allowing the caller to influence model selection by passing an `issueBody`. The diff evaluator uses Haiku (controlled by the `/diff_evaluator` command definition). All other agents inherit model selection from `commandAgent` defaults.

## Gotchas

- `patchAgent` cannot use `CommandAgentConfig` because its output file name is dynamic (per issue number); it calls `runClaudeAgentWithCommand` directly instead.
- `reviewAgent`'s `passed` flag is `true` when `reviewResult` is null and `blockerIssues` is empty (null-coalesced to `[]`), so a completely unparseable review response will be treated as "passed" — the caller must check `result.parsed` independently if it needs to distinguish parse failure from a clean review.
- `diffEvaluatorAgent` uses a regex match (`/\{[\s\S]*?"verdict"[\s\S]*?\}/`) rather than `extractJson` — it will match the first JSON-like object containing `verdict`, which may differ from `extractJson` behavior on multi-object outputs.
- `resolutionAgent` spreads `result.parsed` as `resolutionResult` without a null guard; if the retry loop exhausts without a valid parse, it throws before reaching the return, so callers must handle `OutputValidationError` at the phase level.
- `reviewAgent`'s `screenshots` field is declared in the schema and interface but is not consumed by this agent — the `/review` command fills it with the images it opened plus the proof path, for callers that want it.
- The reviewer must open every per-issue image before judging it; a web repository's guidance asks it to look at them as a user would.

## Decisions

- [ADR-0027](../specs/adr/0027-llm-diff-gate-for-chores.md) — LLM diff gate for chores
- [ADR-0031](../specs/adr/0031-active-test-phase-passive-review-judge.md) — Active test phase, passive review judge
- [ADR-0058](../specs/adr/0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md) — Static checks are deterministic gates in the test phase; the reviewer runs nothing and `review_proof.md` is gone
- [ADR-0061](../specs/adr/0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md) — The application type decides the evidence; `web` repositories run their Gherkin on an ADW-owned Playwright project
- [ADR-0063](../specs/adr/0063-per-issue-scenario-images-are-the-visual-evidence.md) — Every per-issue scenario image in a `web` repository is visual evidence; the reviewer judges it before the pull request exists
