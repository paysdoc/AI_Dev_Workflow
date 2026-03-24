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

Read the file at `$3`. If the file does not exist, skip directly to the Final Output step with:
- aligned: false
- one mismatch of type "plan_uncovered" describing the missing file

### Step 2: Discover and read scenario files

Search recursively from `$4` for `.feature` files that contain the tag `@adw-$2`. Read each file you find.

If no scenario files are found, skip directly to the Final Output step with:
- aligned: false
- one mismatch of type "plan_uncovered" noting that no scenario files tagged @adw-$2 were found

### Step 3: Compare plan sections against scenario coverage

For each major behaviour described in the plan, check whether a BDD scenario covers it.
For each BDD scenario, check whether it tests a behaviour described in the plan.

Identify mismatches of these types:
- `plan_uncovered`: A behaviour described in the plan has no corresponding scenario
- `scenario_untested`: A scenario tests behaviour not described in the plan

### Step 4: Final Output

CRITICAL: Your very last message must be ONLY a raw JSON object — no markdown, no code fences, no explanation before or after it. The JSON is parsed programmatically and any surrounding text will cause a fatal parse error.

The JSON object must match this exact structure:

    {"aligned": true | false, "mismatches": [{"type": "plan_uncovered | scenario_untested", "description": "string", "planSection": "string or null", "scenarioFile": "string or null"}], "summary": "string"}

Rules:
- Set "aligned" to true and "mismatches" to [] when plan and scenarios are fully aligned.
- Set "aligned" to false and list every mismatch when any are found.
- The "summary" field is a one-sentence summary of the validation result.
- Your final message must start with `{` and end with `}`. Nothing else.
