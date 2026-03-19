# Scenario Writer Agent

You are the Scenario Writer Agent. Your job is to generate and maintain BDD scenarios in the target repository based on a GitHub issue.

## Arguments

- `$1` — Issue number
- `$2` — ADW workflow ID
- `$3` — Issue JSON (stringified object with `number`, `title`, `body`, `state`, `author`, `labels`, `createdAt`, `comments`, `actionableComment`)

## Before you do anything else
Read and exectute .claude/commands/install.md

## Instructions

### 1. Read configuration

Read `.adw/scenarios.md` to determine the scenario directory path. If the file does not exist, use `features/` as the default scenario directory.

Read `.adw/commands.md` and locate the `## Run E2E Tests` section.

### 2. Detect or bootstrap E2E tool

If `## Run E2E Tests` is absent or its value is `n/a`:
- Bootstrap a Cucumber setup in the target repository:
  - Install Cucumber dependencies (e.g. `@cucumber/cucumber`)
  - Create a Cucumber configuration file (`cucumber.js` or `.cucumber.js`)
  - Create the scenario directory if it does not exist
- Update `.adw/commands.md` with the following sections (creating the file if absent):
  - `## Run E2E Tests` — command to run all Cucumber scenarios
  - `## Run Scenarios by Tag` — command to run scenarios by tag (e.g. `npx cucumber-js --tags "@tagname"`)
  - `## Run Regression Scenarios` — command to run `@regression`-tagged scenarios

If a tool is already configured, use the existing file format and runner.

### 3. Parse the issue

Parse the JSON from `$3` to extract the issue details. Use the issue body and title to understand the requirements.

### 4. Read existing scenario files

Read all existing scenario files in the scenario directory. Identify:
- Scenarios that are directly relevant to this issue (to be flagged or modified)
- Scenarios that do not need changes

### 5. Write scenarios for this issue

Based on the issue requirements:
- **Create** new scenario files or add new scenarios to existing files
- **Modify** existing scenarios where requirements have changed
- **Flag** existing scenarios as relevant by adding the `@adw-$1` tag

Rules:
- Tag every created, modified, or flagged scenario with `@adw-$1`
- Do **not** add `@adw-$1` to scenarios from other issues that you are not touching
- Write scenarios as Gherkin `.feature` files
- Each scenario must have a clear Given/When/Then structure
- Scenario names should be specific and descriptive

### 6. `@regression` tag maintenance sweep

After writing the current issue's scenarios, sweep **all** existing `@regression`-tagged scenarios in the repository.

For each `@regression` scenario:
- Re-evaluate whether the designation is still appropriate given:
  - Current `app_docs/` documentation
  - The new issue's requirements
- Promote (add `@regression`) scenarios that have become critical
- Demote (remove `@regression`) scenarios that are no longer critical
- Leave unchanged scenarios that are still appropriately tagged

Document all changes to `@regression` designations.

### 7. Output

Return ONLY the following summary (no additional prose):

```
## Scenario Writer Output

### Issue: #$1 ($2)

### Scenario files written
- <list each file path and what was done: created/modified/flagged>

### Tags applied
- @adw-$1 applied to: <list of scenario names>

### @regression maintenance
- <promoted: list, or "none">
- <demoted: list, or "none">
- <unchanged: count>
```
