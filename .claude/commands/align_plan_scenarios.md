---
target: false
---
# Align Plan Scenarios

Align an implementation plan with BDD scenarios in a single pass. Reads both the plan and scenario files, identifies conflicts, resolves them using the GitHub issue as the sole source of truth, and flags unresolvable conflicts as inline warnings in the plan.

## Arguments

$1 - adwId: The ADW session identifier
$2 - issueNumber: The GitHub issue number
$3 - planFilePath: Path to the implementation plan (spec) file
$4 - scenarioGlob: Directory to search for .feature files tagged @adw-{issueNumber}
$5 - issueJson: JSON string containing the full GitHub issue (number, title, body, labels, comments)

## Instructions

You are performing a single-pass plan-scenario alignment for GitHub issue #$2 (ADW session: $1).

**CRITICAL: The GitHub issue is the SOLE ARBITER OF TRUTH.** When the plan and scenarios disagree, the issue body defines what is correct.

### Step 1: Parse inputs

Parse the issue JSON from `$5`. Extract the issue title, body, and any relevant context about what must be built.

### Step 2: Read the implementation plan

Read the file at `$3`. If the file does not exist, skip to the Final Output with:
- aligned: true
- warnings: []
- changes: []
- summary: "Plan file not found — skipping alignment"

### Step 3: Discover and read scenario files

Search recursively from `$4` for `.feature` files that contain the tag `@adw-$2`. Read each file you find.

If no scenario files are found, skip to the Final Output with:
- aligned: true
- warnings: []
- changes: []
- summary: "No BDD scenario files tagged @adw-$2 found — skipping alignment"

### Step 4: Identify conflicts

Compare the plan behaviours against the scenario coverage:
- For each major behaviour in the plan, check whether a BDD scenario covers it.
- For each BDD scenario, check whether it tests a behaviour in the plan.

A conflict exists when the plan and a scenario describe the same behaviour differently, or when a scenario covers something the plan doesn't address (or vice versa).

### Step 5: Resolve conflicts

For each conflict, consult the GitHub issue body to determine the correct behaviour:
- If the issue supports the plan: update the scenario to match.
- If the issue supports the scenario: update the plan to match.
- If both are consistent with the issue but just differently expressed: align the wording (prefer the issue's exact phrasing).
- If the conflict cannot be resolved from the issue: it is an unresolvable conflict — do NOT modify either file for this conflict; instead record it as a warning.

Write all updated files directly to disk using your file writing tools:
- For the plan: overwrite `$3` with the updated content.
- For scenarios: overwrite each scenario file at its existing path with the updated content.

For each unresolvable conflict, append an inline `<!-- ADW-WARNING: <description> -->` comment at the relevant location in the plan file. This allows the build agent to see the warning without the workflow failing.

### Step 6: Final Output

CRITICAL: Your very last message must be ONLY a raw JSON object — no markdown, no code fences, no explanation before or after it. The JSON is parsed programmatically and any surrounding text will cause a fatal parse error.

The JSON object must match this exact structure:

    {"aligned": true | false, "warnings": ["string", ...], "changes": ["string", ...], "summary": "string"}

Rules:
- Set "aligned" to true when all conflicts were resolved (or there were none).
- Set "aligned" to false only when at least one unresolvable conflict exists.
- "warnings" lists each unresolvable conflict as a one-sentence description.
- "changes" lists each resolved change made to plan or scenario files.
- "summary" is a one-sentence summary of the alignment result.
- Your final message must start with `{` and end with `}`. Nothing else.
