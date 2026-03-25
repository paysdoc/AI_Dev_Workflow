# Patch: Restore step-definition pre-flight check in regressionScenarioProof.ts

## Metadata
adwId: `x4wwk7-application-type-con`
reviewChangeRequest: `Issue #3: Branch reverts the step-definition pre-flight check in regressionScenarioProof.ts (removed lines 121-135). Without this check, BDD scenario proof will fail with 'undefined steps' errors on repos that don't yet have step definitions, re-introducing the bug fixed by issue #289.`

## Issue Summary
**Original Spec:** `specs/issue-278-adw-r4f0gi-application-type-con-sdlc_planner-app-type-screenshot-upload.md`
**Issue:** The branch accidentally removed the pre-flight guard in `runScenarioProof()` that checks for `.ts` step definition files in `features/step_definitions/` before running Cucumber. This guard was added by issue #289 to prevent `undefined steps` errors on target repos that don't yet have step definitions generated. Without it, Cucumber runs against tags but finds no matching step definitions, causing hard failures.
**Solution:** Re-apply the pre-flight check block (lines 121-135 on `origin/dev`) to `runScenarioProof()` in `adws/agents/regressionScenarioProof.ts`. The check verifies at least one `.ts` file exists in `features/step_definitions/` and returns an early skip result with a warning when none are found.

## Files to Modify

- `adws/agents/regressionScenarioProof.ts` — Re-add the pre-flight step definition guard after line 119 (after destructuring `options`)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Restore pre-flight check in `runScenarioProof()`
- Read `adws/agents/regressionScenarioProof.ts`
- After line 119 (`const { reviewProofConfig, runByTagCommand, issueNumber, proofDir, cwd } = options;`) and before `const tagResults: TagProofResult[] = [];`, re-insert the pre-flight check block:
  ```typescript
  // Pre-flight check: verify at least one step definition file exists
  const stepDefsDir = path.resolve(cwd ?? process.cwd(), 'features', 'step_definitions');
  const hasStepDefs = fs.existsSync(stepDefsDir) &&
    fs.readdirSync(stepDefsDir).some(f => f.endsWith('.ts'));

  if (!hasStepDefs) {
    const warningMsg = 'No step definition files found in features/step_definitions/ — skipping BDD scenario proof';
    console.log(`⚠️  ${warningMsg}`);
    fs.mkdirSync(proofDir, { recursive: true });
    const resultsFilePath = path.resolve(proofDir, 'scenario_proof.md');
    fs.writeFileSync(
      resultsFilePath,
      `# Scenario Proof\n\nGenerated at: ${new Date().toISOString()}\n\n⚠️ ${warningMsg}\n`,
      'utf-8',
    );
    return { tagResults: [], hasBlockerFailures: false, resultsFilePath };
  }
  ```
- This is the exact code from `origin/dev` — no modifications needed

### Step 2: Verify the restoration matches origin/dev
- Run `git diff origin/dev -- adws/agents/regressionScenarioProof.ts` to confirm the pre-flight check diff is no longer present
- The file should now match `origin/dev` for this section (other changes from issue #278 may still differ)

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx tsc --noEmit` — Root TypeScript compilation check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW module TypeScript compilation check
- `bun run lint` — Linter check for code quality
- `bun run build` — Build validation
- `git diff origin/dev -- adws/agents/regressionScenarioProof.ts` — Confirm pre-flight check section no longer appears in diff (zero lines removed from the guard block)

## Patch Scope
**Lines of code to change:** ~18 (re-insert removed block)
**Risk level:** low
**Testing required:** TypeScript compilation + lint + build. The guard itself is a safety net — its absence is the bug; its presence restores correctness for repos without step definitions.
