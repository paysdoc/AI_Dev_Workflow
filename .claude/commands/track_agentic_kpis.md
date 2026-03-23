---
target: false
---
# Track Agentic KPIs

Update or create the ADW performance tracking tables in `app_docs/agentic_kpis.md`. This command analyzes the current ADW run's metrics and maintains both summary and detailed KPI tables. Think hard about building this, these are key KPIs for the AI Developer Workflow (ADW) system. Use the `{package_manager} -e` commands as suggestions and guides for how to calculate the values. Ultimately, do whatever calculation you need to do to get the values.

## Variables

state_json: $ARGUMENTS
attempts_incrementing_adws: [`adw_plan_iso`, `adw_patch_iso`]

## Setup
- Read `.adw/commands.md` and extract the **Package Manager** value (the line after `## Package Manager`).
- If `.adw/commands.md` does not exist or the value is missing, fall back to `node`.
- Store the resolved value as `{package_manager}` for use in all inline calculation commands below.

## Instructions

### 1. Parse State Data
- Parse the provided state_json to extract:
  - adw_id
  - issue_number
  - issue_class
  - plan_file path
  - all_adws list (contains workflow names run)
  - worktree_path (optional, for target repo diff)

### 2. Calculate Metrics

#### Get Current Date/Time
- Run `date` command to get current date/time

#### Calculate Attempts
IMPORTANT: Use `{package_manager} -e` to calculate the exact count value:
- Count occurrences of any of the adws in the attempts_incrementing_adws list in all_adws list
- Run: `{package_manager} -e "const allAdws = <list>; const incr = ['adw_plan_iso','adw_patch_iso']; console.log(allAdws.filter(w => incr.some(a => w.includes(a))).length)"`

#### Calculate Plan Size
- If plan_file exists in state, read the file
- Count total lines using: `wc -l <plan_file>`
- If file doesn't exist, use 0

#### Calculate Diff Statistics
- If `worktree_path` is present in state_json, run: `git -C <worktree_path> diff origin/main --shortstat`
- Otherwise run: `git diff origin/main --shortstat`
- Parse output to extract:
  - Files changed
  - Lines added
  - Lines removed
- Format as: "Added/Removed/Total Files" (e.g., "150/25/8")

### 3. Read Existing File
- Check if `app_docs/agentic_kpis.md` exists
- If it exists, read and parse the existing tables
- If not, prepare to create new file with both tables

### 4. Update ADW KPIs Table
- Check if current adw_id already exists in the table
- If exists: update that row with new values
- If not: append new row at the bottom
- Set Created date on new rows, Updated date on existing rows
- Use `date` command for timestamps

### 5. Calculate Agentic KPIs

IMPORTANT: All calculations must be done using inline expressions. Use `{package_manager} -e "console.log(expression)"` for every numeric calculation.

#### Current Streak
- Count consecutive rows from bottom of ADW KPIs table where Attempts ≤ 2
- Use `{package_manager} -e`: `{package_manager} -e "const a = <list>; let s = 0; for (let i = a.length - 1; i >= 0; i--) { if (a[i] <= 2) s++; else break; } console.log(s)"`

#### Longest Streak
- Find longest consecutive sequence where Attempts ≤ 2
- Use `{package_manager} -e` to calculate

#### Total Plan Size
- Sum all plan sizes from ADW KPIs table
- Use `{package_manager} -e`: `{package_manager} -e "const s = <list>; console.log(s.reduce((a,b) => a+b, 0))"`

#### Largest Plan Size
- Find maximum plan size
- Use `{package_manager} -e`: `{package_manager} -e "const s = <list>; console.log(s.length ? Math.max(...s) : 0)"`

#### Total Diff Size
- Sum all diff statistics (added + removed lines)
- Parse each diff entry and sum using `{package_manager} -e`

#### Largest Diff Size
- Find maximum diff (added + removed lines)
- Use `{package_manager} -e` to calculate

#### Average Presence
- Calculate average of all attempts
- Use `{package_manager} -e`: `{package_manager} -e "const a = <list>; console.log(a.length ? (a.reduce((x,y) => x+y, 0) / a.length).toFixed(2) : 0)"`
- Round to 2 decimal places

### 6. Write Updated File
- Create/update `app_docs/agentic_kpis.md` with the structure below
- Ensure proper markdown table formatting
- Include "Last Updated" timestamp using `date` command

## File Structure

```markdown
# Agentic KPIs

Performance metrics for the AI Developer Workflow (ADW) system.

## Agentic KPIs

Summary metrics across all ADW runs.

| Metric            | Value          | Last Updated |
| ----------------- | -------------- | ------------ |
| Current Streak    | <number>       | <date>       |
| Longest Streak    | <number>       | <date>       |
| Total Plan Size   | <number> lines | <date>       |
| Largest Plan Size | <number> lines | <date>       |
| Total Diff Size   | <number> lines | <date>       |
| Largest Diff Size | <number> lines | <date>       |
| Average Presence  | <number>       | <date>       |

## ADW KPIs

Detailed metrics for individual ADW workflow runs.

| Date   | ADW ID | Issue Number | Issue Class | Attempts   | Plan Size (lines) | Diff Size (Added/Removed/Files) | Created   | Updated   |
| ------ | ------ | ------------ | ----------- | ---------- | ----------------- | ------------------------------- | --------- | --------- |
| <date> | <id>   | <number>     | <class>     | <attempts> | <size>            | <diff>                          | <created> | <updated> |
```

## Report

Return only: "Updated app_docs/agentic_kpis.md"
