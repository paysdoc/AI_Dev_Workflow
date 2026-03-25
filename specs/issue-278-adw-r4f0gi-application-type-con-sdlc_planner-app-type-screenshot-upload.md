# Feature: Application Type Config + Screenshot Upload in Review Comments

## Metadata
issueNumber: `278`
adwId: `r4f0gi-application-type-con`
issueJson: `{"number":278,"title":"Application type config + screenshot upload in review comments","body":"## Parent PRD\n\n`specs/prd/prd-review-revamp.md`\n\n## What to build\n\nAdd application type awareness to ADW and wire screenshot uploads into the review comment flow for UI-based target applications.\n\n**`.adw/project.md` changes:**\n- Add `## Application Type` section with values `cli` or `web`\n- `cli`: no screenshots captured or uploaded during review\n- `web`: screenshots are captured, uploaded to Cloudflare R2, and linked in issue comments\n\n**```/adw_init``` changes:**\n- Infer application type from the target codebase (presence of frontend frameworks, dev server config, UI-related dependencies)\n- Generate the `## Application Type` section in `.adw/project.md`\n\n**Review phase integration:**\n- When application type is `web`: after review completes, upload screenshots from `allScreenshots` to R2 via the upload utility\n- Embed screenshot URLs in the proof comment (between the review summary and scenario proof table)\n- When application type is `cli`: skip screenshot upload, no image links in comment\n\nSee PRD sections: \"`.adw/project.md` Changes\", \"workflowCompletion.ts Changes\", \"R2 Upload Utility\".\n\n## Acceptance criteria\n\n- [ ] `.adw/project.md` supports `## Application Type` section with `cli` / `web` values\n- [ ] ```/adw_init``` infers application type from target codebase\n- [ ] `projectConfig.ts` loads and exposes the application type\n- [ ] Review phase uploads screenshots to R2 when application type is `web`\n- [ ] Screenshot URLs are embedded as linked images in the issue comment\n- [ ] Screenshot upload is skipped when application type is `cli`\n- [ ] Proof Comment Formatter accepts optional screenshot URLs and renders them correctly\n- [ ] Existing `cli` workflows (including ADW itself) are unaffected\n\n## Blocked by\n\n- Blocked by #276 (wire proof data into structured issue comments)\n- Blocked by #274 (R2 upload utility + Screenshot Router Worker)\n\n## User stories addressed\n\n- User story 5\n- User story 6\n- User story 11\n- User story 12","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-23T17:01:26Z","comments":[{"author":"paysdoc","createdAt":"2026-03-25T06:16:10Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Add application type awareness (`cli` or `web`) to ADW's project configuration and wire screenshot uploads into the review comment flow. When a target application is a `web` app, screenshots captured during review are uploaded to Cloudflare R2 and embedded as linked images in the GitHub issue proof comment. When the application type is `cli`, screenshot upload is skipped entirely. The `/adw_init` command infers the application type automatically from the target codebase.

## User Story
As an ADW operator managing both CLI and web-based target repositories
I want ADW to automatically detect the application type and upload review screenshots for web apps
So that review proof comments include visual evidence for UI-based projects while CLI projects remain unaffected

## Problem Statement
ADW's review phase collects screenshots via `allScreenshots` in `ReviewRetryResult`, but these local file paths are never uploaded or embedded in issue comments. There is no mechanism to distinguish between CLI and web target applications, meaning the system cannot conditionally enable screenshot uploads for projects that benefit from visual proof.

## Solution Statement
1. Add an `applicationType` field (`'cli' | 'web'`) to `ProjectConfig`, parsed from the `## Application Type` section of `.adw/project.md`
2. Extend `/adw_init` to infer and generate the `## Application Type` section based on codebase analysis (presence of frontend frameworks, dev server config, UI dependencies)
3. After the review phase completes, when `applicationType === 'web'`, upload all screenshots from `reviewResult.allScreenshots` to R2 using the existing `uploadToR2()` utility
4. Store the uploaded screenshot URLs in `WorkflowContext` and embed them as linked images in the `review_passed` / `review_failed` proof comments
5. When `applicationType === 'cli'`, skip upload entirely — no changes to existing CLI workflow behavior

## Relevant Files
Use these files to implement the feature:

- `adws/core/projectConfig.ts` — Add `applicationType` field to `ProjectConfig`, add `parseApplicationType()` function following the `parseUnitTestsEnabled()` pattern
- `adws/phases/workflowCompletion.ts` — Add screenshot upload logic after review phase completes, conditioned on `applicationType === 'web'`
- `adws/github/workflowCommentsIssue.ts` — Add `screenshotUrls` field to `WorkflowContext`, embed screenshot images in `formatReviewPassedComment()` and `formatReviewFailedComment()`
- `adws/agents/reviewRetry.ts` — Reference for `ReviewRetryResult.allScreenshots` structure (read-only, no changes needed)
- `adws/r2/uploadService.ts` — Use `uploadToR2()` to upload screenshot files (read-only, no changes needed)
- `adws/r2/types.ts` — Reference for `UploadOptions` and `UploadResult` types (read-only, no changes needed)
- `.claude/commands/adw_init.md` — Add application type inference to step 1 and `## Application Type` generation to step 3
- `.adw/project.md` — Already contains `## Application Type\ncli` — serves as the reference format
- `adws/types/workflowTypes.ts` — Reference for workflow type definitions
- `guidelines/coding_guidelines.md` — Coding guidelines to follow
- `app_docs/feature-nnn7js-r2-upload-screenshot-router.md` — R2 upload module documentation
- `app_docs/feature-the-adw-is-too-speci-tf7slv-generalize-adw-project-config.md` — Project config documentation
- `app_docs/feature-9k4ut2-machine-readable-review-proof.md` — Review proof documentation

### New Files
No new files needed. All changes are modifications to existing files.

## Implementation Plan
### Phase 1: Foundation — ProjectConfig Application Type Support
Extend the configuration layer to parse and expose the `## Application Type` section from `.adw/project.md`. This is the foundational data that gates all downstream behavior.

### Phase 2: Core Implementation — Screenshot Upload + Comment Formatting
Wire the R2 upload into the review phase completion path and extend the proof comment formatters to embed uploaded screenshot URLs as linked images.

### Phase 3: Integration — `/adw_init` Inference
Extend the `/adw_init` command to infer application type from codebase analysis and generate the `## Application Type` section in `.adw/project.md`.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Add `applicationType` to `ProjectConfig`
- Read `adws/core/projectConfig.ts`
- Add a new type: `export type ApplicationType = 'cli' | 'web';`
- Add a `parseApplicationType(projectMd: string): ApplicationType` function, following the existing `parseUnitTestsEnabled()` pattern:
  - Use `parseMarkdownSections()` to extract the `application type` section
  - Return `'web'` if the trimmed value is `'web'`, otherwise default to `'cli'`
- Add `applicationType: ApplicationType` field to the `ProjectConfig` interface
- In `loadProjectConfig()`, call `parseApplicationType(projectMd)` and assign the result to the new field
- Default to `'cli'` when the section is absent (backward-compatible — existing repos without this section behave as before)

### Step 2: Add `screenshotUrls` to `WorkflowContext` and Update Comment Formatters
- Read `adws/github/workflowCommentsIssue.ts`
- Add `screenshotUrls?: string[]` field to the `WorkflowContext` interface
- Update `formatReviewPassedComment()`:
  - After the review summary and before the non-blocker section, if `ctx.screenshotUrls` has entries, render a `### Screenshots` section with each URL as a linked image: `[![Screenshot N](url)](url)`
  - Wrap in a `<details><summary>Screenshots (N)</summary>` block to keep comments compact
- Update `formatReviewFailedComment()`:
  - Similarly, if `ctx.screenshotUrls` has entries, add a `### Screenshots` section after the blocker list, using the same `<details>` pattern

### Step 3: Wire Screenshot Upload into Review Phase Completion
- Read `adws/phases/workflowCompletion.ts`
- Read `adws/r2/uploadService.ts` and `adws/r2/types.ts` for the upload API
- In `executeReviewPhase()`, after `reviewResult.passed` is confirmed (line ~117):
  - Check `config.projectConfig.applicationType === 'web'`
  - If true and `reviewResult.allScreenshots.length > 0`:
    - Filter `allScreenshots` to only actual image files (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`) — skip non-image paths like `.md` scenario proof files
    - For each image file path, read the file with `Bun.file(path)` / `fs.readFileSync(path)`, then call `uploadToR2()` with:
      - `owner` and `repo` extracted from `config.repoContext` (use `config.issue` or derive from repo URL)
      - `key`: `review/${config.adwId}/${filename}` (use the basename of the file)
      - `body`: the file buffer
      - `contentType`: inferred from extension (`image/png`, `image/jpeg`, etc.)
    - Collect all returned `UploadResult.url` values into an array
    - Assign the URL array to `ctx.screenshotUrls`
    - Log the number of screenshots uploaded
  - If `applicationType === 'cli'` or no screenshots, skip upload (no-op)
- Also add the same upload logic in the review-failed branch (line ~125) so that screenshots from failed reviews are also visible
- Import `uploadToR2` from `../r2` and required Node.js/Bun file reading utilities
- Extract repo owner/name from `config.repoContext` or parse from the issue/repo URL

### Step 4: Extend `/adw_init` to Infer Application Type
- Read `.claude/commands/adw_init.md`
- In step 1 (Analyze the Project), add application type inference logic:
  - Classify as `web` if any of these signals are present:
    - `package.json` contains frontend framework dependencies: `react`, `next`, `vue`, `nuxt`, `angular`, `svelte`, `sveltekit`, `astro`, `remix`, `gatsby`, `vite` (as a primary build tool with HTML entry)
    - Presence of directories like `src/pages/`, `src/app/`, `src/components/`, `public/`, `static/`
    - Presence of `next.config.*`, `vite.config.*`, `angular.json`, `svelte.config.*`
    - `## Start Dev Server` in commands.md is not `N/A` and references a browser-serving command
  - Classify as `cli` otherwise (default)
- In step 3 (Create `.adw/project.md`), add a new section:
  - `## Application Type` with the inferred value (`cli` or `web`)
  - Place it after `## Script Execution`

### Step 5: Validate the Feature
- Run the validation commands listed below to confirm zero regressions
- Verify that `projectConfig.ts` correctly parses `## Application Type\ncli` from ADW's own `.adw/project.md` as `'cli'`
- Verify that the absence of `## Application Type` defaults to `'cli'`

## Testing Strategy

### Edge Cases
- `.adw/project.md` has no `## Application Type` section → defaults to `'cli'`, no screenshots uploaded
- `## Application Type` contains `web` with extra whitespace or mixed case → normalize to lowercase and trim
- `allScreenshots` contains non-image files (e.g., `.md` scenario proof paths) → filter to only image extensions before upload
- `allScreenshots` is empty even for `web` type → skip upload gracefully, no error
- R2 upload fails for one screenshot → log warning but continue uploading remaining screenshots; do not fail the workflow
- `repoContext` is undefined → skip upload (no owner/repo info available)
- Screenshot file path doesn't exist on disk → skip that file with a warning log

## Acceptance Criteria
- [ ] `ProjectConfig` has `applicationType: ApplicationType` field with type `'cli' | 'web'`
- [ ] `parseApplicationType()` returns `'web'` when `## Application Type` is `web`, defaults to `'cli'` otherwise
- [ ] `loadProjectConfig()` populates `applicationType` from `.adw/project.md`
- [ ] `WorkflowContext` has `screenshotUrls?: string[]` field
- [ ] `formatReviewPassedComment()` renders screenshot URLs as linked images in a collapsible section when `ctx.screenshotUrls` is set
- [ ] `formatReviewFailedComment()` renders screenshot URLs similarly
- [ ] `executeReviewPhase()` uploads screenshots to R2 when `applicationType === 'web'` and `allScreenshots` has image files
- [ ] `executeReviewPhase()` skips upload when `applicationType === 'cli'`
- [ ] `/adw_init` infers `cli` or `web` from codebase analysis and generates `## Application Type` in `.adw/project.md`
- [ ] ADW's own `.adw/project.md` continues to have `## Application Type\ncli` — no behavioral change for ADW itself
- [ ] Non-image files in `allScreenshots` (e.g., `.md`) are filtered out before upload
- [ ] `bunx tsc --noEmit` passes
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json` passes
- [ ] `bun run lint` passes
- [ ] `bun run build` passes

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit` — Root TypeScript compilation check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW module TypeScript compilation check
- `bun run lint` — Linter check for code quality
- `bun run build` — Build validation

## Notes
- Strictly adhere to `guidelines/coding_guidelines.md`: pure functions, type safety, immutability, no decorators, isolate side effects at boundaries.
- The R2 upload utility (`adws/r2/uploadService.ts`) is already fully implemented from issue #274. This task only wires it into the review flow.
- Screenshot upload is intentionally non-fatal: if R2 upload fails, log the error and continue. The review pass/fail status should not depend on screenshot upload success.
- The `parseApplicationType()` function follows the exact same pattern as `parseUnitTestsEnabled()` — extracting a section from markdown and returning a typed value.
- Future application types (e.g., `api`, `mobile`) could be added by extending the `ApplicationType` union, but this issue only requires `cli` and `web`.
- No new library installations are required — all dependencies (R2 SDK, file reading) are already available.
