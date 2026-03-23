# Feature: Machine-readable review_proof.md + tag-driven scenario execution

## Metadata
issueNumber: `273`
adwId: `s18k21-machine-readable-rev`
issueJson: `{"number":273,"title":"Machine-readable review_proof.md + tag-driven scenario execution","body":"## Parent PRD\n\n`specs/prd/prd-review-revamp.md`\n\n## What to build\n\nReplace the current prose-based `.adw/review_proof.md` with a machine-readable format that defines:\n- Which BDD tags to run during review (e.g., `@review-proof`, `@adw-{issueNumber}`)\n- Failure severity classification per tag (`blocker` or `tech-debt`)\n- Supplementary checks (type-check, lint commands)\n\nUpdate `regressionScenarioProof.ts` to read tags and severity from this config instead of using hardcoded `@regression` / `@adw-{issueNumber}`. The orchestration layer substitutes `{issueNumber}` before passing concrete tags to the review agent (consistent with the existing `{tag}` pattern in `.adw/commands.md`).\n\nUpdate the `/review` slash command to execute whatever tags the config specifies — no hardcoded tag assumptions in ADW code.\n\nIntroduce the three-tier tag strategy:\n- `@review-proof`: scoped critical subset, runs every review, failure = blocker\n- `@adw-{issueNumber}`: issue-specific scenarios, runs when present (graceful skip if absent), failure = blocker\n- `@regression`: full suite, no longer runs during review (moved to periodic GitHub Action)\n\nSee PRD sections: \"Machine-Readable review_proof.md\", \"Three-Tier Tag Strategy\", \"regressionScenarioProof.ts Changes\".\n\n## Acceptance criteria\n\n- [ ] `.adw/review_proof.md` uses a machine-readable markdown format with sections for tags, severity, and supplementary checks\n- [ ] `regressionScenarioProof.ts` reads tags and severity from `review_proof.md` instead of hardcoded values\n- [ ] `{issueNumber}` placeholder is substituted by the orchestration layer before reaching the review agent\n- [ ] `/review` command executes tags found in config without hardcoded assumptions\n- [ ] `@review-proof` failures are classified as `blocker`\n- [ ] `@adw-{issueNumber}` failures are classified as `blocker`\n- [ ] Graceful skip when no `@adw-{issueNumber}` scenarios exist for the current issue\n- [ ] Existing review flow continues to work end-to-end with the new config format\n\n## Blocked by\n\nNone — can start immediately.\n\n## User stories addressed\n\n- User story 13\n- User story 14\n- User story 15\n- User story 16","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-23T17:00:18Z","comments":[],"actionableComment":null}`

## Feature Description
Replace the current prose-based `.adw/review_proof.md` with a machine-readable markdown format that specifies which BDD tags to run during review, their failure severity classification, and supplementary checks. Update the orchestration layer (`regressionScenarioProof.ts`, `reviewRetry.ts`, `workflowCompletion.ts`) and the `/review` slash command to read tags dynamically from this config instead of hardcoding `@regression` / `@adw-{issueNumber}`. Implement a three-tier tag strategy where `@review-proof` replaces `@regression` as the scoped review subset (blocker), `@adw-{issueNumber}` remains issue-specific (blocker), and `@regression` is moved to periodic CI only.

## User Story
As an ADW operator
I want the review proof configuration to be machine-readable and tag-driven
So that I can customize which BDD scenarios run during review, control severity classification, and avoid hardcoded tag assumptions in the ADW codebase

## Problem Statement
The current `.adw/review_proof.md` is prose-based — it describes what proof to produce but doesn't provide structured data the orchestration code can parse. Meanwhile, `regressionScenarioProof.ts` hardcodes `@regression` and `@adw-{issueNumber}` tags, and the `/review` command has hardcoded severity mappings. This makes it impossible for target repositories to customize which tags run during review or how failures are classified without modifying ADW source code.

## Solution Statement
1. Rewrite `.adw/review_proof.md` using a structured markdown format with `## Tags`, `## Supplementary Checks` sections that `projectConfig.ts` can parse into a typed `ReviewProofConfig`.
2. Update `regressionScenarioProof.ts` (renamed to `scenarioProof.ts`) to iterate over config-driven tag entries instead of hardcoding two specific tags.
3. Have the orchestration layer (`reviewRetry.ts` / `workflowCompletion.ts`) substitute `{issueNumber}` in tag patterns before passing them downstream.
4. Update the `/review` command to read severity from the scenario proof results rather than hardcoding classification rules.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding guidelines to follow strictly during implementation.
- `.adw/review_proof.md` — The file to be rewritten into machine-readable format. Currently prose-based with classification rules, proof format, and proof attachment sections.
- `adws/core/projectConfig.ts` — Loads and parses `.adw/` config files. Needs a new `parseReviewProofMd()` function and `ReviewProofConfig` type. Already parses `reviewProofMd` raw content and has `parseMarkdownSections()` helper.
- `adws/agents/regressionScenarioProof.ts` — Runs `@regression` and `@adw-{issueNumber}` scenarios and writes proof markdown. Must be updated to iterate over config-driven tags with severity from `ReviewProofConfig`.
- `adws/agents/reviewRetry.ts` — Review-patch retry loop. Currently passes `runRegressionCommand` and `runByTagCommand` to the scenario proof. Needs to pass the full `ReviewProofConfig` instead of individual commands.
- `adws/agents/reviewAgent.ts` — Review agent. Passes `scenarioProofPath` to `/review`. No major changes needed.
- `adws/agents/bddScenarioRunner.ts` — Generic tag-based scenario subprocess runner. No changes needed — already handles `{tag}` substitution and `N/A` skip.
- `adws/agents/index.ts` — Agent module exports. Update exports for renamed/new types.
- `adws/phases/workflowCompletion.ts` — Calls `runReviewWithRetry()`. Needs to pass `ReviewProofConfig` from `config.projectConfig` instead of individual command strings.
- `.claude/commands/review.md` — The `/review` slash command. Needs to remove hardcoded severity mappings and instead read classification from the scenario proof file sections.
- `adws/core/projectConfig.ts` — Read `app_docs/feature-9emriw-bdd-scenario-review-proof.md` for context on the existing scenario proof architecture.
- `app_docs/feature-9emriw-bdd-scenario-review-proof.md` — Conditional doc: context on the existing BDD scenario review proof system. Read for understanding the current architecture.
- `app_docs/feature-20eum6-replace-crucial-with-regression.md` — Conditional doc: context on the `@crucial` to `@regression` rename. Read for understanding how the current `@regression` tag was introduced.
- `.adw/commands.md` — Command mappings. Contains `## Run Scenarios by Tag` with `{tag}` placeholder and `## Run Regression Scenarios`. The `{tag}` pattern is the mechanism used for tag-based execution.
- `.adw/scenarios.md` — BDD scenario config. Defines scenario directory and run commands.

### New Files
- None — all changes are modifications to existing files.

## Implementation Plan
### Phase 1: Foundation — Machine-readable review_proof.md format and parser
1. Define the `ReviewProofConfig` type in `projectConfig.ts` with a `ReviewTagEntry` interface: `{ tag: string; severity: 'blocker' | 'tech-debt'; optional?: boolean }` and a `SupplementaryCheck` interface: `{ name: string; command: string; severity: 'blocker' | 'tech-debt' }`.
2. Add a `parseReviewProofMd()` function to `projectConfig.ts` that parses the new structured format from `.adw/review_proof.md`.
3. Rewrite `.adw/review_proof.md` into the machine-readable format using `## Tags` (markdown table with tag pattern, severity, optional flag) and `## Supplementary Checks` (markdown table with name, command, severity).
4. Wire `ReviewProofConfig` into `ProjectConfig` so it's loaded alongside existing config.

### Phase 2: Core Implementation — Config-driven scenario proof
1. Update `regressionScenarioProof.ts` to accept a `ReviewProofConfig` instead of separate `runRegressionCommand` and `runByTagCommand` strings.
2. Iterate over `ReviewProofConfig.tags` entries, running each tag via `runScenariosByTag()`, collecting results with their configured severity.
3. Add `{issueNumber}` substitution at the orchestration layer (`reviewRetry.ts`) before tags reach the scenario proof runner.
4. Generate a proof markdown file that includes per-tag sections with their severity classification.
5. Update `ScenarioProofResult` to include per-tag results with severity rather than only regression/issue fields.

### Phase 3: Integration — Wire config through the review pipeline
1. Update `ReviewRetryOptions` in `reviewRetry.ts` to accept `ReviewProofConfig` instead of individual command strings.
2. Update `workflowCompletion.ts` `executeReviewPhase()` to pass `ReviewProofConfig` from `config.projectConfig`.
3. Update the `/review` command (`review.md`) to read per-tag severity from the proof file sections rather than hardcoding classification rules.
4. Update the early-exit blocker logic in `reviewRetry.ts` to use the severity from config for each tag.

## Step by Step Tasks

### Step 1: Read conditional documentation
- Read `app_docs/feature-9emriw-bdd-scenario-review-proof.md` for full context on the existing scenario proof system.
- Read `app_docs/feature-20eum6-replace-crucial-with-regression.md` for context on the `@crucial` → `@regression` rename.
- Read `guidelines/coding_guidelines.md` to ensure all implementation follows project guidelines.

### Step 2: Define ReviewProofConfig types in projectConfig.ts
- Add `ReviewTagEntry` interface to `adws/core/projectConfig.ts`:
  ```typescript
  export interface ReviewTagEntry {
    tag: string;          // e.g. "@review-proof", "@adw-{issueNumber}"
    severity: 'blocker' | 'tech-debt';
    optional?: boolean;   // true = graceful skip if no matching scenarios
  }
  ```
- Add `SupplementaryCheck` interface:
  ```typescript
  export interface SupplementaryCheck {
    name: string;         // e.g. "Type Check", "Lint"
    command: string;      // e.g. "bunx tsc --noEmit"
    severity: 'blocker' | 'tech-debt';
  }
  ```
- Add `ReviewProofConfig` interface:
  ```typescript
  export interface ReviewProofConfig {
    tags: ReviewTagEntry[];
    supplementaryChecks: SupplementaryCheck[];
  }
  ```
- Add `reviewProofConfig` field to `ProjectConfig` interface (alongside the existing `reviewProofMd` raw content field).
- Add `parseReviewProofMd()` function that parses the structured markdown format using the existing `parseMarkdownSections()` helper plus markdown table parsing for the `## Tags` and `## Supplementary Checks` sections.
- Update `getDefaultProjectConfig()` to include a default `ReviewProofConfig` with `@regression` (blocker) and `@adw-{issueNumber}` (blocker, optional) — maintaining backward compatibility.
- Wire the parser into `loadProjectConfig()` to parse the `reviewProofMd` raw content into `reviewProofConfig`.

### Step 3: Rewrite .adw/review_proof.md into machine-readable format
- Replace the prose content in `.adw/review_proof.md` with the structured markdown format:
  ```markdown
  # Review Proof Configuration

  ## Tags

  | Tag | Severity | Optional |
  |-----|----------|----------|
  | @review-proof | blocker | no |
  | @adw-{issueNumber} | blocker | yes |

  ## Supplementary Checks

  | Name | Command | Severity |
  |------|---------|----------|
  | Type Check | bunx tsc --noEmit | blocker |
  | Type Check (adws) | bunx tsc --noEmit -p adws/tsconfig.json | blocker |
  | Lint | bun run lint | blocker |

  ## Proof Format

  Structure proof as text summaries within the review JSON output:
  - Use the `reviewSummary` field for a concise 2-4 sentence overview
  - Use the `reviewIssues` array to document any discrepancies
  - Use the `screenshots` array for paths to proof artifacts

  ## What NOT to Do

  - Do NOT take browser screenshots (there is no UI to screenshot)
  - Do NOT attempt to start a dev server or navigate to a URL
  - Do NOT use code-diff as primary proof
  - Do NOT run `bun run test` (unit tests are disabled)
  ```
- Note the key change: `@regression` is replaced by `@review-proof` in the Tags table. This implements the three-tier tag strategy where `@review-proof` is the scoped critical subset for reviews.

### Step 4: Update regressionScenarioProof.ts for config-driven tag iteration
- Update `ScenarioProofResult` interface to replace the hardcoded `regressionPassed`/`issueScenariosPassed` fields with a generic per-tag results array:
  ```typescript
  export interface TagProofResult {
    tag: string;
    resolvedTag: string;  // after {issueNumber} substitution
    severity: 'blocker' | 'tech-debt';
    optional: boolean;
    passed: boolean;
    output: string;
    exitCode: number | null;
    skipped: boolean;     // true when optional and no scenarios found
  }

  export interface ScenarioProofResult {
    tagResults: TagProofResult[];
    hasBlockerFailures: boolean;
    resultsFilePath: string;
  }
  ```
- Update `runRegressionScenarioProof()` signature to accept a `ReviewProofConfig` and `runByTagCommand` (from commands.md) instead of separate regression/issue commands:
  ```typescript
  export async function runScenarioProof(options: {
    scenariosMd: string;
    reviewProofConfig: ReviewProofConfig;
    runByTagCommand: string;
    issueNumber: number;
    proofDir: string;
    cwd?: string;
  }): Promise<ScenarioProofResult>
  ```
- Implement the core loop: iterate `reviewProofConfig.tags`, substitute `{issueNumber}` in each tag pattern, call `runScenariosByTag()` for each, collect `TagProofResult` entries.
- Handle optional tags: if the subprocess returns exit code 0 with empty output (or a known "no scenarios" pattern), mark as `skipped: true` for optional tags.
- Update `buildProofMarkdown()` to generate per-tag sections dynamically (e.g., `## @review-proof Scenarios`, `## @adw-273 Scenarios`) with their configured severity.
- Keep `shouldRunScenarioProof()` unchanged — it still guards on `scenariosMd` content.
- Export the old function name `runRegressionScenarioProof` as a deprecated alias that maps to `runScenarioProof` for backward compatibility during transition, or remove it if no other callers exist outside `reviewRetry.ts`.

### Step 5: Update reviewRetry.ts to pass ReviewProofConfig
- Replace the individual command string fields in `ReviewRetryOptions`:
  - Remove: `runRegressionCommand`, `runByTagCommand` (these are now derived from config)
  - Add: `reviewProofConfig: ReviewProofConfig`
  - Keep: `runByTagCommand: string` (still needed — it comes from `commands.md`, not `review_proof.md`)
  - Keep: `scenariosMd: string` (still needed for the `shouldRunScenarioProof` guard)
- Update the scenario proof call in the retry loop to use `runScenarioProof()` with the new config.
- Update the early-exit blocker logic: instead of checking `scenarioProof.regressionPassed`, check `scenarioProof.hasBlockerFailures`.
- Update the `ReviewRetryResult.scenarioProof` type to use the new `ScenarioProofResult`.
- Update `issueNumber` substitution: substitute `{issueNumber}` in tag patterns at this level before passing to the scenario proof runner (consistent with the existing `{tag}` pattern in `.adw/commands.md`).

### Step 6: Update workflowCompletion.ts to pass ReviewProofConfig
- In `executeReviewPhase()`, replace the individual command string parameters with the `reviewProofConfig` from `config.projectConfig`:
  ```typescript
  reviewProofConfig: config.projectConfig.reviewProofConfig,
  runByTagCommand: config.projectConfig.commands.runScenariosByTag,
  ```
- Remove the now-unnecessary `runRegressionCommand` parameter.

### Step 7: Update the /review slash command (review.md)
- In the `## Proof Requirements` section for when `scenarioProofPath` is provided:
  - Remove the hardcoded severity rules (`@regression failures → blocker`, `@adw-{issueNumber} non-regression failures → tech-debt`).
  - Instead, instruct the review agent to read each tag section in the scenario proof file and use the severity stated in that section's header (e.g., `## @review-proof Scenarios (severity: blocker)`).
  - This makes the `/review` command fully config-driven — it doesn't need to know which tags exist or what their severities are.
- Update references from `@regression` to generic "configured tags" language.

### Step 8: Update agent index exports
- In `adws/agents/index.ts`, update the exports for `regressionScenarioProof.ts`:
  - Export the new `TagProofResult` type.
  - Export `runScenarioProof` (the new name) alongside or instead of `runRegressionScenarioProof`.
  - Keep `shouldRunScenarioProof` and `ScenarioProofResult` exports.

### Step 9: Update .adw/review_proof.md for ADW's own config
- Ensure the ADW project's `.adw/review_proof.md` uses the new format (already done in Step 3).
- Verify the tags are `@review-proof` (blocker) and `@adw-{issueNumber}` (blocker, optional).
- Note: `@regression` is intentionally NOT in the review tags — it will be moved to a periodic GitHub Action (out of scope for this issue but the config makes this possible).

### Step 10: Run validation commands
- Run `bun run lint` to verify linting passes.
- Run `bunx tsc --noEmit` to verify root-level type checking passes.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws type checking passes.
- Run `bun run build` to verify the build succeeds.

## Testing Strategy

### Edge Cases
- `.adw/review_proof.md` is absent — should fall back to default `ReviewProofConfig` with `@regression` + `@adw-{issueNumber}` (backward compatibility).
- `.adw/review_proof.md` is present but empty — should fall back to defaults.
- `.adw/review_proof.md` has a `## Tags` section with no rows — should result in empty tags array (no scenario proof run).
- `{issueNumber}` substitution in tag patterns — verify `@adw-{issueNumber}` becomes `@adw-273` when `issueNumber=273`.
- Optional tag with no matching scenarios — should be marked `skipped: true` and not cause a failure.
- All tags pass — `hasBlockerFailures` should be `false`.
- One blocker tag fails — `hasBlockerFailures` should be `true`.
- One tech-debt tag fails — `hasBlockerFailures` should be `false` (tech-debt is non-blocking).
- Multiple tags, mixed results — verify per-tag results are correctly collected and severity applied.
- Supplementary checks section parsing — verify name, command, severity are extracted correctly.
- Backward compatibility — repos without the new format should work unchanged.

## Acceptance Criteria
- `.adw/review_proof.md` uses a machine-readable markdown format with `## Tags` table (tag, severity, optional) and `## Supplementary Checks` table (name, command, severity).
- `regressionScenarioProof.ts` reads tags and severity from `ReviewProofConfig` parsed from `review_proof.md` instead of hardcoded `@regression` / `@adw-{issueNumber}`.
- `{issueNumber}` placeholder is substituted in tag patterns by the orchestration layer (in `regressionScenarioProof.ts` or `reviewRetry.ts`) before running scenarios.
- The `/review` command reads per-tag severity from the scenario proof file sections rather than hardcoding classification rules.
- `@review-proof` tag failures are classified as `blocker` (per the config).
- `@adw-{issueNumber}` tag failures are classified as `blocker` (per the config).
- When no `@adw-{issueNumber}` scenarios exist for the current issue, the tag is gracefully skipped (marked optional in config).
- Existing review flow continues to work end-to-end — repos without the new `review_proof.md` format fall back to defaults matching current behavior.
- All type checks pass (`bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`).
- Linting passes (`bun run lint`).
- Build succeeds (`bun run build`).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root-level TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check
- `bun run build` — Build the application to verify no build errors

## Notes
- **Three-tier tag strategy**: This issue introduces `@review-proof` as the scoped critical subset that replaces `@regression` during reviews. `@regression` becomes a periodic CI-only suite (moving it to a GitHub Action is out of scope for this issue but the config enables it). `@adw-{issueNumber}` remains issue-specific.
- **Backward compatibility**: The default `ReviewProofConfig` (used when `review_proof.md` is absent or empty) should match the current behavior (`@regression` blocker + `@adw-{issueNumber}` blocker optional) so that target repos without the new format continue to work.
- **No new libraries needed**.
- **Guidelines**: Strictly follow `guidelines/coding_guidelines.md` — especially modularity (keep files under 300 lines), type safety, immutability, and functional programming practices.
- **Naming**: The file `regressionScenarioProof.ts` keeps its name for now to minimize churn, but the function is renamed from `runRegressionScenarioProof` to `runScenarioProof` to reflect its general-purpose nature. If keeping the old name as an alias is cleaner, that's acceptable.
- **Proof markdown format**: The generated `scenario_proof.md` should include severity in each tag section header (e.g., `## @review-proof Scenarios (severity: blocker)`) so the `/review` command can read it directly without needing access to the original config.
