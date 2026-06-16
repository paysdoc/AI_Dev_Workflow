---
target: false
---
# Validate Scenario Fidelity

Compare frozen BDD scenarios against the issue body to confirm they still encode the issue's intent after a resolve loop.

## Arguments

$0 - adwId: The ADW session identifier
$1 - issueNumber: The GitHub issue number
$2 - scenarioGlob: Glob pattern or directory to search for .feature files tagged @adw-{issueNumber}
$3 - issueBody: The raw issue body text (passed inline)

## Instructions

You are validating that the BDD scenarios for GitHub issue #$1 (ADW session: $0) still faithfully encode the issue's acceptance criteria after a resolve loop has run.

### Step 1: Read the issue body

The issue body is provided inline as argument $3. Read and understand its acceptance criteria and described behaviours.

### Step 2: Discover and read scenario files

Search recursively from $2 for `.feature` files that contain the tag `@adw-$1`. Read each file you find.

If no scenario files are found, produce:
- aligned: true
- mismatches: []
- summary: "No scenario files tagged @adw-$1 found; alignment assumed."

### Step 3: Compare scenarios against the issue body

For each BDD scenario, check whether it tests a behaviour described or intended by the issue body.
For each acceptance criterion in the issue, check whether at least one scenario covers it.

Identify mismatches of these types:
- `plan_uncovered`: An acceptance criterion from the issue has no covering scenario
- `scenario_untested`: A scenario tests behaviour not described or intended by the issue

A scenario that tests correct behaviour but was weakened (e.g., stripped of assertions, made trivially true) counts as `scenario_untested` even if the scenario name matches.

### Step 4: Final Output

CRITICAL: Your very last message must be ONLY a raw JSON object — no markdown, no code fences, no explanation before or after it. The JSON is parsed programmatically and any surrounding text will cause a fatal parse error.

The JSON object must match this exact structure:

    {"aligned": true | false, "mismatches": [{"type": "plan_uncovered | scenario_untested", "description": "string", "planReference": "string or null", "scenarioReference": "string or null"}], "summary": "string"}

Rules:
- Set "aligned" to true and "mismatches" to [] when scenarios faithfully cover all issue acceptance criteria.
- Set "aligned" to false and list every mismatch when any are found.
- The "summary" field is a one-sentence summary of the validation result.
- Your final message must start with `{` and end with `}`. Nothing else.
