# CSV Migration Script — Upload Historical Cost Data to D1

**ADW ID:** e5wrpe-csv-migration-script
**Date:** 2026-03-27
**Specification:** specs/issue-333-adw-e5wrpe-csv-migration-script-sdlc_planner-migrate-csv-to-d1.md

## Overview

A one-time migration script that reads all historical cost CSV files from `projects/` (covering `AI_Dev_Workflow`, `Millennium`, and `vestmatic`) and uploads them to the D1 database via the Cost API Worker's `POST /api/cost` endpoint. The script handles two distinct CSV formats — old-format files with simple model/token/cost rows, and new-format files with full phase/workflow granularity — and flags all migrated records with `migrated = true`. The Worker's ingest handler was extended to accept and persist this optional `migrated` field.

## What Was Built

- **`workers/cost-api/migrate.ts`** — standalone one-time migration script (323 lines)
- **`migrated` field support in Worker types** — added optional `readonly migrated?: boolean` to `IngestRecord`
- **`migrated` field persisted in D1** — `insertCostRecords` now includes `migrated` in the INSERT (15 columns, up from 14)
- **Old-format CSV parser** (`parseOldFormatCsv`) — handles `Model,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)` format; extracts issue number/description from filename
- **New-format CSV converter** (`convertNewFormatRecords`) — wraps the existing `parseIssueCostCsv()` to produce `IngestRecord[]` with `migrated = true`
- **Directory scanner** (`scanProjectDirectory`) — classifies each CSV as old or new format by checking for the `workflow_id` header column; skips `total-cost.csv`
- **Batch uploader** (`uploadBatches`) — chunks records into batches of 50 and POSTs each to `{COST_API_URL}/api/cost`
- **Summary report** — prints per-project and total counts of records scanned, inserted, and batch errors

## Technical Implementation

### Files Modified

- `workers/cost-api/migrate.ts`: new file — full migration script entry point
- `workers/cost-api/src/types.ts`: new file — added optional `migrated?: boolean` field to `IngestRecord` interface
- `workers/cost-api/src/ingest.ts`: new file — updated `insertCostRecords` to include `migrated` in INSERT (column 15); binds `record.migrated ?? false`

### Key Changes

- **Dual-format detection**: format is determined by checking whether the first line of the CSV contains `workflow_id`. Old-format goes through `parseOldFormatCsv`; new-format goes through `convertNewFormatRecords(parseIssueCostCsv(...))`.
- **Filename parsing handles two patterns**: `0-{type}-{issueNumber}-{description}.csv` (strips the `0-{type}-` prefix) and the standard `{issueNumber}-{description}.csv`. The issue description is derived by replacing hyphens with spaces.
- **`total-cost.csv` is always skipped** to prevent double-counting derived data.
- **Batch size is 50 records per POST** — conservative limit well within D1's batch API ceiling. Failed batches are logged but do not halt the migration; the exit code reflects any batch errors.
- **`migrated = true`** is set on every record produced by both parsers, allowing historical data to be distinguished from live ADW-generated records in D1 queries.

## How to Use

1. Ensure the Cost API Worker is deployed and accessible.
2. Set the required environment variables:
   ```sh
   export COST_API_URL=https://your-worker.workers.dev
   export COST_API_TOKEN=your-bearer-token
   ```
3. Run the migration script from the repo root:
   ```sh
   bunx tsx workers/cost-api/migrate.ts
   ```
4. The script logs progress per file and per batch, then prints a summary:
   ```
   === AI_Dev_Workflow ===
     [old]  52-issue-desc.csv → 3 record(s)
     [new]  113-define-issuetracker.csv → 5 record(s)
     ...
     Total: 42 record(s) to upload
     [ok]   batch 1: inserted 42 record(s)

   === Migration Summary ===
     AI_Dev_Workflow: 145 scanned, 145 inserted [ok]
     Millennium: 30 scanned, 30 inserted [ok]
     vestmatic: 26 scanned, 26 inserted [ok]

     Total: 201 scanned, 201 inserted, 0 batch error(s)
   ```
5. A non-zero exit code indicates at least one batch failed.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `COST_API_URL` | Yes | Base URL of the deployed Cost API Worker (no trailing slash) |
| `COST_API_TOKEN` | Yes | Bearer token matching `COST_API_TOKEN` in the Worker's environment |

Project metadata (display name and repo URL) is hardcoded in `PROJECT_META` within `migrate.ts` for the three known projects.

## Testing

Run the Worker's existing Vitest suite to verify no regressions from the `migrated` field addition:

```sh
cd workers/cost-api && npm install && npx vitest run && cd ../..
```

To do a dry-run parse without uploading, set `COST_API_URL` to a non-existent host — the script will log parse results and report network errors per batch.

## Notes

- This is a **one-time script** — running it a second time against the same Worker will attempt to re-insert records and may produce duplicates if the D1 schema lacks a unique constraint. Check the D1 table before re-running.
- Old-format CSVs contain a `Total Cost` summary line that is explicitly skipped during parsing.
- The script imports `parseIssueCostCsv` from `adws/cost/reporting/csvWriter.ts` using a relative path from the repo root, resolved at runtime via `bunx tsx`.
- Estimated total records across all three projects: 300–500 (roughly 145 CSV files, some with multiple data rows).
