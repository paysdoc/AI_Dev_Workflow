# Feature: CSV Migration Script — Upload Historical Cost Data to D1

## Metadata
issueNumber: `333`
adwId: `e5wrpe-csv-migration-script`
issueJson: `{"number":333,"title":"CSV migration script: upload historical cost data to D1","body":"## Parent PRD\n\n`specs/prd/d1-cost-database.md`\n\n## What to build\n\nA one-time migration script at `workers/cost-api/migrate.ts` that reads all existing CSV cost files from `projects/` and uploads them to D1 via the Worker's ingest endpoint.\n\n### Key details:\n\n- Scans all 3 project directories (`AI_Dev_Workflow`, `Millennium`, `vestmatic`)\n- **Old-format CSVs** (`0-*` prefix): extracts model, token counts (input, output, cache_read, cache_write), and cost; issue number/description from filename; sets `phase = 'unknown'`\n- **New-format per-issue CSVs**: uses existing `parseIssueCostCsv()` for full PhaseCostRecord extraction\n- **Skips** `total-cost.csv` files (derived data, would double-count)\n- Sets `migrated = true` on all records\n- Batches records and POSTs to the Worker's `/api/cost` endpoint\n- Requires `COST_API_URL` and `COST_API_TOKEN` env vars\n- Run via `bunx tsx workers/cost-api/migrate.ts`\n\n## Acceptance criteria\n\n- [ ] Old-format CSVs parsed correctly: model, token counts, cost extracted; `phase = 'unknown'`; issue number/description from filename\n- [ ] New-format per-issue CSVs parsed correctly with full phase/token/cost data\n- [ ] `total-cost.csv` files are skipped\n- [ ] All migrated records have `migrated = true`\n- [ ] Records are grouped by project and POSTed in batches\n- [ ] Unit tests for old-format CSV parser\n- [ ] Unit tests for migration payload assembly\n- [ ] Script runs successfully against all 3 project directories\n\n## Blocked by\n\n- Blocked by #330\n\n## User stories addressed\n\n- User stories 9, 10, 11, 12, 13","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T09:07:39Z","comments":[],"actionableComment":null}`

## Feature Description
A one-time migration script at `workers/cost-api/migrate.ts` that reads all existing CSV cost files from the `projects/` directory (covering `AI_Dev_Workflow`, `Millennium`, and `vestmatic`) and uploads them to the D1 database via the Cost API Worker's `POST /api/cost` ingest endpoint. The script handles two CSV formats: old-format files with simple model/token/cost rows and new-format files with full phase/workflow granularity. After migration, all historical cost data is centralized in D1 and flagged with `migrated = true`.

## User Story
As an ADW operator
I want all historical cost CSV data migrated to the D1 database
So that cost data is centralized, queryable, and not locked in git-committed CSV files

## Problem Statement
Historical cost data lives in CSV files under `projects/` in two incompatible formats. Old-format CSVs (with `0-*` prefix or without `workflow_id` header) contain per-model token counts and costs but no phase breakdown. New-format CSVs contain full phase-level granularity. Neither format is queryable through an API. The migration script bridges these formats into a single D1 database through the existing Cost API Worker.

## Solution Statement
Create a standalone migration script that:
1. Scans all three project directories under `projects/`
2. Distinguishes old-format from new-format CSVs by checking for the `workflow_id` header column
3. Parses old-format CSVs by extracting model/token/cost from rows and issue number/description from filenames, setting `phase = 'unknown'`
4. Parses new-format CSVs using the existing `parseIssueCostCsv()` function for full PhaseCostRecord extraction
5. Skips `total-cost.csv` files to avoid double-counting derived data
6. Adds `migrated = true` to all records and batches them into POST requests to the Worker's `/api/cost` endpoint
7. Extends the Worker's ingest handler to accept an optional `migrated` field and pass it through to D1

## Relevant Files
Use these files to implement the feature:

- `specs/prd/d1-cost-database.md` — PRD with D1 schema, ingest payload format, and migration script requirements
- `app_docs/feature-viahyb-cost-api-worker-d1-s-cost-api-worker.md` — Documentation for the cost-api Worker (conditional doc for Workers/cost-api work)
- `workers/cost-api/src/types.ts` — `IngestRecord` and `IngestPayload` types; need to add optional `migrated` field
- `workers/cost-api/src/ingest.ts` — Ingest handler; need to pass `migrated` through to D1 INSERT
- `workers/cost-api/src/schema.sql` — D1 schema reference showing `migrated BOOLEAN DEFAULT FALSE` on `cost_records`
- `adws/cost/reporting/csvWriter.ts` — Contains `parseIssueCostCsv()` for new-format CSV parsing and CSV format definitions
- `adws/cost/types.ts` — `PhaseCostRecord` type definition and `TokenUsageMap` type
- `projects/AI_Dev_Workflow/` — Contains ~103 old-format + ~42 new-format CSV files
- `projects/Millennium/` — Contains ~10 old-format CSV files
- `projects/vestmatic/` — Contains ~13 old-format CSV files
- `guidelines/coding_guidelines.md` — Coding guidelines to follow

### New Files
- `workers/cost-api/migrate.ts` — The one-time migration script (entry point, run via `bunx tsx workers/cost-api/migrate.ts`)

## Implementation Plan
### Phase 1: Foundation — Extend Worker to Support `migrated` Field
The D1 schema already has `migrated BOOLEAN DEFAULT FALSE` on `cost_records`, but the ingest handler and types don't plumb it through. Add an optional `migrated` field to `IngestRecord` and update the INSERT statement to include it.

### Phase 2: Core Implementation — Old-Format CSV Parser and Migration Script
Build the migration script with two parsing paths:
- **Old-format parser**: reads `Model,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)` rows, extracts issue number and description from the filename (handling both `0-{type}-{issueNumber}-{desc}.csv` and `{issueNumber}-{desc}.csv` patterns), skips the `Total Cost` summary line, and produces `IngestRecord[]` with `phase = 'unknown'` and `migrated = true`.
- **New-format parser**: wraps existing `parseIssueCostCsv()` to convert `PhaseCostRecord[]` into `IngestRecord[]` with `migrated = true`.

### Phase 3: Integration — Batch Upload and Execution
Wire the parsers into a main function that scans all three project directories, groups records by project, batches them (e.g., 50 records per POST), and sends them to the Worker endpoint. Add progress logging, error handling for failed batches, and a summary report.

## Step by Step Tasks

### Step 1: Read conditional documentation
- Read `app_docs/feature-viahyb-cost-api-worker-d1-s-cost-api-worker.md` for full context on the cost-api Worker implementation
- Read `guidelines/coding_guidelines.md` for coding standards

### Step 2: Add `migrated` field to Worker ingest types
- In `workers/cost-api/src/types.ts`, add `readonly migrated?: boolean` to the `IngestRecord` interface
- This is an optional field — existing non-migration callers don't need to set it

### Step 3: Update Worker ingest handler to persist `migrated`
- In `workers/cost-api/src/ingest.ts`, update the `insertCostRecords` function:
  - Add `migrated` to the INSERT column list
  - Bind `record.migrated ?? false` as the value
- The column count in the INSERT goes from 14 to 15

### Step 4: Create old-format CSV parser
- In `workers/cost-api/migrate.ts`, implement `parseOldFormatCsv(content: string, filename: string, project: string)`:
  - Parse the header `Model,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)`
  - For each data row (skip lines starting with "Total Cost"), extract: model, input tokens, output tokens, cache_read, cache_write, cost
  - Extract issue number and description from filename:
    - If filename starts with `0-`: strip `0-`, then extract `{type}-{issueNumber}-{description}` (e.g., `bug-52-issue-classifier...` → issue 52)
    - Otherwise: extract `{issueNumber}-{description}` (e.g., `113-define-issuetracker...` → issue 113)
  - Return `IngestRecord[]` with `phase = 'unknown'`, `provider = 'anthropic'`, `migrated = true`, and `token_usage` map built from the extracted counts

### Step 5: Create new-format CSV to IngestRecord converter
- In `workers/cost-api/migrate.ts`, implement `convertNewFormatRecords(records: PhaseCostRecord[], issueDescription: string)`:
  - Map each `PhaseCostRecord` to an `IngestRecord`:
    - `workflow_id` → `workflowId`
    - `issue_number` → `issueNumber`
    - `phase` → `phase`
    - `model` → `model`
    - `provider` → `provider`
    - `computed_cost_usd` → `computedCostUsd`
    - `reported_cost_usd` → `reportedCostUsd`
    - `status` → `status`
    - `retry_count` → `retryCount`
    - `continuation_count` → `contextResetCount`
    - `duration_ms` → `durationMs`
    - `timestamp` → `timestamp`
    - `token_usage` → `tokenUsage`
    - `migrated` → `true`
  - `issue_description` is derived from the filename (same extraction as old format)

### Step 6: Implement directory scanner and file classifier
- In `workers/cost-api/migrate.ts`, implement `scanProjectDirectory(projectDir: string, project: string)`:
  - Read all `.csv` files in the directory
  - Skip `total-cost.csv`
  - For each file, read content and check header for `workflow_id` to classify as old or new format
  - Route to the appropriate parser
  - Return all `IngestRecord[]` for the project

### Step 7: Implement batch uploader
- In `workers/cost-api/migrate.ts`, implement `uploadBatch(records: IngestRecord[], project: string, apiUrl: string, apiToken: string)`:
  - Build the `IngestPayload` with project slug, project name, and records array
  - POST to `{apiUrl}/api/cost` with `Authorization: Bearer {apiToken}` header
  - Handle response: log success (201 with inserted count), throw on error responses (401, 400, 500)
  - Project metadata mapping:
    - `AI_Dev_Workflow` → name: `AI Dev Workflow`, repo_url: `https://github.com/paysdoc/AI_Dev_Workflow`
    - `Millennium` → name: `Millennium`, repo_url: `https://github.com/paysdoc/Millennium`
    - `vestmatic` → name: `vestmatic`, repo_url: `https://github.com/paysdoc/vestmatic`

### Step 8: Implement main migration function
- In `workers/cost-api/migrate.ts`, implement the `main()` entry point:
  - Read `COST_API_URL` and `COST_API_TOKEN` from environment variables (exit with error if missing)
  - Define the three project directories: `AI_Dev_Workflow`, `Millennium`, `vestmatic`
  - For each project:
    - Scan the directory and collect all IngestRecords
    - Chunk records into batches of 50
    - POST each batch to the Worker endpoint
    - Log progress: project name, total records, batches sent, responses
  - Print a summary: total records migrated per project, total overall, any errors

### Step 9: Validate with lint and type check
- Run `bun run lint` to check for linting errors
- Run `bunx tsc --noEmit` to verify type checking passes
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for additional type checks
- Fix any issues found

## Testing Strategy

### Edge Cases
- Old-format CSV with a "Total Cost" summary line at the bottom — must be skipped
- Old-format filename with `0-` prefix: `0-bug-52-desc.csv` → issue 52, description `desc`
- Old-format filename without `0-` prefix: `113-desc.csv` → issue 113, description `desc`
- CSV file with only a header and no data rows → produces empty record list, skip upload
- `total-cost.csv` → must be skipped entirely
- New-format CSV with `reasoning` token type column → token_usage map includes `reasoning` key
- Old-format CSV where cost has decimal precision → preserve as-is in `computed_cost_usd`
- Empty project directory → no records, skip upload, log informational message
- Network error during batch upload → log error with batch details, continue with next batch
- Records with zero token counts → still valid, include in upload

## Acceptance Criteria
- [ ] Old-format CSVs parsed correctly: model, token counts (input, output, cache_read, cache_write), and cost extracted; `phase = 'unknown'`; issue number and description extracted from filename
- [ ] New-format per-issue CSVs parsed correctly with full phase, token, and cost data via `parseIssueCostCsv()`
- [ ] `total-cost.csv` files are skipped in all project directories
- [ ] All migrated records have `migrated = true` in the ingest payload
- [ ] Records are grouped by project and POSTed in batches to `POST /api/cost`
- [ ] Script runs via `bunx tsx workers/cost-api/migrate.ts` with `COST_API_URL` and `COST_API_TOKEN` env vars
- [ ] Script processes all 3 project directories: `AI_Dev_Workflow`, `Millennium`, `vestmatic`
- [ ] Worker ingest endpoint accepts and persists the optional `migrated` field to D1

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws sub-project
- `cd workers/cost-api && npm install && npx vitest run && cd ../..` — Run existing Worker tests to ensure no regressions from the `migrated` field additions
- `bun run build` — Build the application to verify no build errors

## Notes
- The `.adw/project.md` has `Unit Tests: disabled` for the ADW main project, so unit tests for the migration script parsers are not included as plan tasks per planning rules. However, the issue acceptance criteria explicitly requests unit tests for the old-format CSV parser and migration payload assembly. The Worker sub-project (`workers/cost-api/`) has its own Vitest + Miniflare test infrastructure. Consider adding tests to `workers/cost-api/test/` during implementation if the implementer judges it valuable.
- The `IngestRecord` type in `workers/cost-api/src/types.ts` and the INSERT in `ingest.ts` currently don't include `migrated`. This plan adds it as a minimal extension — an optional boolean field that defaults to `false` when absent.
- Old-format CSVs exist in two filename patterns: with `0-` prefix (e.g., `0-bug-52-desc.csv`) and without (e.g., `52-desc.csv`). Both have the same `Model,Input Tokens,...` header. The `0-` prefix files additionally include the issue type (`bug`, `feat`, `chore`) in the filename which is not needed for migration.
- The migration script imports `parseIssueCostCsv` from `adws/cost/reporting/csvWriter.ts`. Since the script runs via `bunx tsx`, it can resolve these imports from the repo root.
- D1 has a batch API limit. The 50-record batch size is conservative and well within limits. Across all 3 projects there are roughly 145 CSV files (some with multiple data rows), producing an estimated 300-500 total records.
- If the `guidelines/` directory is present, all code must follow the coding guidelines (functional style, immutability, type safety, strict mode).
