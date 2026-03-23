---
target: false
---
# Validate Plan Scenarios

Compare an implementation plan against BDD scenarios to determine if they are aligned.

## Arguments

$1 - adwId: The ADW session identifier
$2 - issueNumber: The GitHub issue number
$3 - planFilePath: Path to the implementation plan (spec) file
$4 - scenarioGlob: Glob pattern or directory to search for .feature files tagged @adw-{issueNumber}

## Instructions

You are validating alignment between an implementation plan and BDD scenarios for GitHub issue #$2 (ADW session: $1).

### Step 1: Read the implementation plan

Read the file at `$3`. If the file does not exist, output:
```json
{"aligned": false, "mismatches": [{"type": "plan_uncovered", "description": "Plan file not found at $3"}]}
```

### Step 2: Discover and read scenario files

Search recursively from `$4` for `.feature` files that contain the tag `@adw-$2`. Read each file you find.

If no scenario files are found, output:
```json
{"aligned": false, "mismatches": [{"type": "plan_uncovered", "description": "No BDD scenario files tagged @adw-$2 were found. All plan behaviours lack scenario coverage."}]}
```

### Step 3: Compare plan sections against scenario coverage

For each major behaviour described in the plan, check whether a BDD scenario covers it.
For each BDD scenario, check whether it tests a behaviour described in the plan.

Identify mismatches of these types:
- `plan_uncovered`: A behaviour described in the plan has no corresponding scenario
- `scenario_untested`: A scenario tests behaviour not described in the plan

### Step 4: Output result

Output a single JSON object — no other text, no markdown, no code fences:

```
{
  "aligned": true | false,
  "mismatches": [
    {
      "type": "plan_uncovered" | "scenario_untested",
      "description": "Description of the mismatch",
      "planSection": "Optional: relevant section or quote from the plan",
      "scenarioFile": "Optional: path to the relevant scenario file"
    }
  ]
}
```

Set `"aligned": true` and `"mismatches": []` if the plan and scenarios are fully aligned.
Set `"aligned": false` and list all mismatches if any are found.

Output only the raw JSON object. Do not wrap it in markdown or add any explanation.
