---
target: false
---
# Resolve Plan Scenarios

Reconcile mismatches between an implementation plan and BDD scenarios using the GitHub issue as the sole arbiter of truth.

## Arguments

$0 - adwId: The ADW session identifier
$1 - issueNumber: The GitHub issue number
$2 - planFilePath: Path to the implementation plan (spec) file
$3 - scenarioGlob: Glob pattern or directory to search for .feature files tagged @adw-{issueNumber}
$4 - issueJson: JSON string containing the full GitHub issue (number, title, body, labels, comments)
$5 - mismatches: JSON string of mismatch items from the validation agent

## Instructions

You are resolving plan-scenario mismatches for GitHub issue #$1 (ADW session: $0).

**CRITICAL: The GitHub issue is the SOLE ARBITER OF TRUTH.** When the plan and scenarios disagree, the issue body defines what is correct. Do not default to the plan. Do not default to the scenarios. Only the issue matters.

### Step 1: Parse inputs

Parse the issue JSON from `$4` to understand the requirements. Parse the mismatches from `$5`.

### Step 2: Read current artifacts

Read the implementation plan at `$2`.

Search recursively from `$3` for `.feature` files tagged `@adw-$1` and read each one.

### Step 3: Resolve each mismatch

For each mismatch, determine what the issue says about that behaviour:
- If the issue supports the plan but not the scenario: update the scenario to match the issue
- If the issue supports the scenario but not the plan: update the plan to match the issue
- If the issue is ambiguous: use your best interpretation of the issue intent to align both artifacts

### Step 4: Write updated files

Write all updated files directly to disk using your file writing tools:
- For the plan: overwrite `$2` with the updated content
- For scenarios: overwrite each scenario file at its existing path with the updated content

### Step 5: Output result

Output a single JSON object — no other text, no markdown, no code fences:

```
{
  "resolved": true | false,
  "decisions": [
    {
      "mismatch": "Description of the mismatch that was resolved",
      "action": "updated_plan" | "updated_scenarios" | "updated_both",
      "reasoning": "Explanation of what was changed and why, referencing the issue as the source of truth"
    }
  ]
}
```

Set `"resolved": true` if all mismatches were addressed. Set `"resolved": false` if any mismatch could not be resolved (explain in the relevant decision's reasoning).

Output only the raw JSON object. Do not wrap it in markdown or add any explanation.
