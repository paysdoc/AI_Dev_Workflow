# Application Type Config + Screenshot Upload

**ADW ID:** x4wwk7-application-type-con
**Date:** 2026-03-25
**Specification:** specs/issue-278-adw-r4f0gi-application-type-con-sdlc_planner-app-type-screenshot-upload.md

## Overview

Adds application type awareness (`cli` or `web`) to ADW's project configuration. When a target repository is a `web` app, screenshots collected during the review phase are uploaded to Cloudflare R2 and embedded as collapsible linked images in the GitHub issue proof comment. CLI projects are entirely unaffected — no screenshots are captured or uploaded.

## What Was Built

- `ApplicationType` union type (`'cli' | 'web'`) exported from `projectConfig.ts`
- `parseApplicationType()` function that reads the `## Application Type` section from `.adw/project.md` (defaults to `'cli'`)
- `applicationType` field on `ProjectConfig`, populated by `loadProjectConfig()`
- `screenshotUrls?: string[]` field on `WorkflowContext` (replaces the old `allScreenshots` pass-through)
- `formatScreenshotSection()` helper that renders uploaded URLs as a collapsible `<details>` block
- Screenshot upload logic in `executeReviewPhase()`: filters image files, calls `uploadToR2()` per file, collects public URLs — non-fatal (errors are logged and skipped)
- `Building` and `Testing` board status values added to the `BoardStatus` enum
- ADW version (short git hash) logged at workflow init
- Large cleanup: removed the `proofCommentFormatter` layer, the entire `adws/jsonl/` module, legacy test mocks, and superseded feature/step-definition files

## Technical Implementation

### Files Modified

- `adws/core/projectConfig.ts`: Added `ApplicationType`, `parseApplicationType()`, `applicationType` field on `ProjectConfig`, default `'cli'` in `getDefaultProjectConfig()` and `loadProjectConfig()`
- `adws/github/workflowCommentsIssue.ts`: Replaced `scenarioProof / nonBlockerIssues / allSummaries / allScreenshots` fields with `screenshotUrls?: string[]`; added `formatScreenshotSection()`; updated `formatReviewPassedComment()` and `formatReviewFailedComment()` to embed the screenshot section
- `adws/phases/workflowCompletion.ts`: Added R2 upload loop after review completes — guarded by `applicationType === 'web'`; image-extension filter (`.png .jpg .jpeg .gif .webp`); assigns `ctx.screenshotUrls` on success
- `adws/phases/workflowInit.ts`: Logs the ADW version (short git commit hash) during startup
- `adws/providers/types.ts`: Added `Building` and `Testing` to the `BoardStatus` enum
- `features/application_type_screenshot_upload.feature` + `features/step_definitions/applicationTypeScreenshotUploadSteps.ts`: BDD coverage for the new behaviour

### Key Changes

- **Parsing pattern**: `parseApplicationType()` follows the same `parseMarkdownSections()` pattern as `parseUnitTestsEnabled()` — case-insensitive, trims whitespace, defaults to `'cli'`
- **Upload guard**: Upload only runs when `applicationType === 'web'` AND `allScreenshots.length > 0` AND `repoContext` is available; each file is checked for existence before reading
- **Non-fatal uploads**: Any per-file upload error is caught, logged as `warn`, and skipped — the review pass/fail outcome is independent of screenshot upload success
- **Comment rendering**: Screenshots appear between the review summary and the non-blocker section (passed) or after the blocker list (failed), wrapped in a `<details><summary>Screenshots (N)</summary>` block
- **Cleanup**: Removed `proofCommentFormatter` dependency from `workflowCommentsIssue.ts`; deleted the `adws/jsonl/` conformance/schema module and associated test mocks/fixtures

## How to Use

1. Ensure `.adw/project.md` contains an `## Application Type` section:
   ```markdown
   ## Application Type
   web
   ```
   Omitting the section (or setting it to anything other than `web`) keeps the `cli` default.

2. Configure R2 credentials in the environment (`CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) — required for upload to succeed.

3. Run any workflow that includes the review phase. After review completes, ADW will:
   - Filter `reviewResult.allScreenshots` to image files only
   - Upload each image to R2 under `review/{adwId}/{filename}`
   - Embed the public URLs as linked thumbnails in the issue proof comment

4. For CLI target repos (ADW itself), set `## Application Type\ncli` or omit the section entirely — no change to existing behaviour.

## Configuration

| Setting | Location | Values | Default |
|---|---|---|---|
| Application type | `.adw/project.md` → `## Application Type` | `cli`, `web` | `cli` |
| R2 account | env `CLOUDFLARE_ACCOUNT_ID` | string | — |
| R2 access key | env `R2_ACCESS_KEY_ID` | string | — |
| R2 secret key | env `R2_SECRET_ACCESS_KEY` | string | — |

## Testing

- BDD feature file: `features/application_type_screenshot_upload.feature`
- Step definitions: `features/step_definitions/applicationTypeScreenshotUploadSteps.ts`
- Unit-level: `parseApplicationType()` is a pure function testable with plain string inputs
- Validation: `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build`

## Notes

- Non-image files in `allScreenshots` (e.g., `.md` scenario proof paths) are silently filtered before upload — no error is raised.
- If R2 upload fails for one screenshot, the remaining screenshots continue uploading; the review outcome is unaffected.
- The `adw_init` command should infer `web` when frontend framework signals are present (see spec step 4 for full heuristic). ADW's own `.adw/project.md` uses `cli` and is unaffected.
- Future application types (`api`, `mobile`) can be added by extending the `ApplicationType` union without touching the upload logic.
