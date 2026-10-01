# Bug: Review does not check step-definition independence and posts no screenshots in the issue's review comment

## Metadata
issueNumber: `937`
adwId: `axbb2a-bug-review-checks-st`
issueJson: `{"number":937,"title":"bug: review checks step-definition independence and puts screenshots in the issue comment","body":"Source: the `## Divergence` sections of the records named below, in `specs/adr/`. Each item there states the facts, the check that showed them and the owner's ruling. Read those sections before planning; they are the specification.\n\n## Decision records\n\nADR-0024 (item 1), ADR-0022 (item 2).\n\n## What to build\n\n- **Independence check (ADR-0024).** The review prompt must check that step definitions are independent of the implementation: written against observable behaviour, not shaped to make the build agent's code pass. Issue #307 specified the check; the prompt change was never merged.\n- **Screenshots (ADR-0022, item 2).** The review comment formatters accept `screenshotUrls`, and no caller sets it. Pass the uploaded proof URLs so the review comment on the issue shows the screenshots.\n\nDo not change how the reviewer obtains proof. That design is under review separately (ADR-0031).\n\n## Acceptance criteria\n\n- [ ] The review prompt contains the independence check and reports a violation as a blocker.\n- [ ] A review that produced screenshots posts their URLs in the issue's review comment; a unit test covers the formatter with URLs present.\n- [ ] The Divergence section of ADR-0024 and item 2 of ADR-0022 are removed in the same pull request.\n","state":"OPEN","author":"paysdoc","labels":["adw:bug"],"createdAt":"2026-10-01T19:20:10Z","comments":[],"actionableComment":null}`

## Bug Description
The issue covers two independent defects in the review phase. Both are recorded as divergences in the decision records.

**1. The review never checks step-definition independence (ADR-0024, Divergence item 1).**
Under ADR-0024 one agent writes both the step definitions and the implementation: the build agent's `implement-tdd` loop, and the step-definition phase that ADR-0031 re-wired to run "against built code". To make up for this, review was supposed to check that step definitions test behaviour through public interfaces "rather than tautologically asserting what the build agent wrote". Issue #307 specified the check. PR #310 merged the feature file, step definitions and docs for #307 but not the prompt change, and the ADR-0031 rewrite of `review.md` on 2026-04-08 did not add it either.
- *Actual:* `.claude/commands/review.md` has three steps (Gather Context, Produce Proof, Coding Guidelines Check). None of them inspects step definitions. A step definition that asserts a stub's canned value, imports private internals, or computes its expected value by calling the code under test passes review.
- *Expected:* the review prompt inspects the step definitions the branch adds or changes and reports each violation as a `blocker`, so the review-patch loop rewrites the step definition.

**2. Screenshots never reach the issue's review comment (ADR-0022, Divergence item 2).**
- *Actual:* `WorkflowContext.screenshotUrls` (`adws/forge/workflowCommentsIssue.ts:45`) is never assigned anywhere in `adws/`. The issue's `review_passed` / `review_failed` comments therefore never show screenshots, even when the scenario run wrote images to `ADW_PROOF_DIR`. Images reach the PR proof comment only, and only in orchestrators that run `executeProofPublishPhase`, after the PR exists. `adwPlanBuildReview` and `adwChore` never upload them at all, and a review that fails (so no PR is opened) never shows them anywhere.
- *Expected (owner's ruling):* "screenshots were meant to appear in the review comments on the issue as well". When the proof run that the review judged produced images, the issue's review comment (passed or failed) embeds their uploaded URLs.

## Problem Statement
1. `.claude/commands/review.md` has no step-definition independence check, so step definitions shaped to fit the implementation are never flagged.
2. The review comment posted on the issue never carries screenshot URLs, for three reasons:
   - **(a) No caller sets the field.** `executeReviewPhase` (`adws/phases/reviewPhase.ts`) posts `review_passed`/`review_failed` without setting `ctx.screenshotUrls`.
   - **(b) Nothing is uploaded by review time.** The only R2 upload of proof images is inside `publishPrProof` (`adws/proof/prProofPublisher.ts`). That function returns `void`, keeps the uploaded URLs to itself, and runs after the PR phase. In `adwSdlc.tsx` that is after the review comment has been posted (review at line 77; PR and proof publish at lines 116–117).
   - **(c) The proof formatter ignores the field.** Every orchestrator with a review loop sets `ctx.scenarioProof`, so the review comment is always built by `formatReviewProofComment` (`adws/forge/proofCommentFormatter.ts`). The callers in `formatReviewPassedComment`/`formatReviewFailedComment` do not pass `screenshotUrls`, and `formatReviewProofComment` ignores the field (`/** Screenshot URLs — placeholder for future wiring. */`). Only the fallback path renders screenshots, and it never has any.
3. ADR-0024's `## Divergence` section and ADR-0022's Divergence item 2 describe these bugs. Once fixed, they must go in the same PR.

## Solution Statement
1. **Prompt:** add `## Step 4: Step Definition Independence Check` to `.claude/commands/review.md`, between Step 3 (Coding Guidelines Check) and `## Issue Severity Reference`. It inspects only the step-definition files added or modified in the branch diff, skips itself when there are none, and emits one `blocker` reviewIssue with `remediationStrategy: "patch"` for each violating file. It is a code-reading step. It does not run tests and does not touch Strategy A/B, so how the reviewer obtains proof is unchanged (ADR-0031).
2. **Upload helper:** extract the harvest → upload half of `publishPrProof` into a new non-throwing function `uploadProofArtifacts` in `adws/proof/proofUploader.ts`, together with `isR2Configured`. Its uploader is an injectable seam whose default is the real `uploadToR2`. An uploader passed in `deps`, or one installed through the test-only `setProofUploaderForTesting`, replaces R2 and counts as configured. Only the default `uploadToR2` is gated on `isR2Configured()`. This is the seam the BDD scenarios of `features/per-issue/feature-937.feature` install their stand-in screenshot store through. `publishPrProof` calls it and keeps byte-identical behaviour (same `proof/{adwId}/{relPath}` keys, same comment).
3. **Wiring:** `executeReviewPhase` uploads the images of the proof it judged (`ctx.scenarioProof.artifactsDir`) through `uploadProofArtifacts`. It always assigns `ctx.screenshotUrls` with the resulting URLs, so a stale list from an earlier attempt never survives, and only then posts `review_passed`/`review_failed`. The upload is skipped (empty list) when there is no `repoContext`, i.e. self-host with no comment to post, or no scenario proof.
4. **Formatters:** move `formatScreenshotSection` from `workflowCommentsIssue.ts` into `proofCommentFormatter.ts` as an export. Render it from `formatReviewProofComment` when `screenshotUrls` is non-empty, and pass `ctx.screenshotUrls` into the `ProofCommentInput` from both review formatters. The fallback path reuses the moved helper and its output does not change.
5. **ADRs:** delete the `## Divergence` section of ADR-0024 and item 2 (the whole `## Divergence` section) of ADR-0022. Nothing else in either record changes: the write-an-adr skill allows only `status`, `superseded-by`, `## Divergence` and the supersession note to change after acceptance.

## Steps to Reproduce
Both defects show up by reading the code; neither needs a live run.
1. `grep -n -i "independen\|step def" .claude/commands/review.md` finds nothing, so the prompt has no independence check.
2. `grep -rn "screenshotUrls" adws --include='*.ts' --include='*.tsx'` finds only the declarations and reads in `adws/forge/workflowCommentsIssue.ts` (lines 45, 189–194, 214–215, 246–247) and the placeholder field in `adws/forge/proofCommentFormatter.ts:27`. No line assigns it.
3. In `adws/forge/workflowCommentsIssue.ts`, `formatReviewPassedComment` (line 198) and `formatReviewFailedComment` (line 228) build a `ProofCommentInput` without `screenshotUrls` whenever `ctx.scenarioProof` is set. In `adws/forge/proofCommentFormatter.ts`, `formatReviewProofComment` (line 102) never reads `input.screenshotUrls`.
4. In `adws/adwSdlc.tsx`, `executeReviewPhase` (line 77) posts the review comment before `executePRPhase` (line 116) and `executeProofPublishPhase` (line 117). `publishPrProof` (`adws/proof/prProofPublisher.ts:120`) returns `Promise<void>`, so its `uploaded` URLs stay local.
5. Behaviour check: `formatWorkflowComment('review_passed', { issueNumber: 1, adwId: 'x', scenarioProof: { tagResults: [], hasBlockerFailures: false, resultsFilePath: '/p.md', artifactsDir: '/a' }, screenshotUrls: ['https://screenshots.paysdoc.nl/repo/proof/x/s/1.png'] })` returns a body without the URL. The new unit tests in Step 6 assert the opposite and fail before the fix.
6. Once its step definitions exist, `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-937"` fails every row of `features/per-issue/feature-937.feature` that has screenshots (§1, §2 and the refused-upload row of §3): nothing is uploaded before the review comment, and the comment embeds no image. The two rows without screenshots and the type-check row pass.

## Root Cause Analysis
- **Independence check.** The prompt half of #307 was never merged (`git log --all -S'ndependence' -- .claude/commands/review.md` finds no commit). The 2026-04-08 passive-judge rewrite (a805a4b6, ADR-0031) rebuilt `review.md` from the pre-#307 text, so the gap carried over. The control that ADR-0024's "Bad" consequence relies on ("The review check was meant to cover this") does not exist.
- **Screenshots.** #278 (e21126de) uploaded the review agent's image `screenshots` to R2 inside the old review phase and set `ctx.screenshotUrls`. The passive-judge rewrite (a805a4b6) deleted that block when the reviewer stopped producing images, and nothing replaced the assignment. #580 later wired proof images to the BDD run (`ADW_PROOF_DIR` → `publishPrProof`). That path posts only on the PR, after review, and keeps the URLs inside `publishPrProof`. Separately, #276 (6a1eb842, later moved into `adws/forge/` by #821) introduced the `scenarioProof` branch of the review formatters (`formatReviewProofComment`) with `screenshotUrls` as an unwired placeholder. That branch is the only one taken when scenario proof exists, which is the only case in which images exist. The result is three independent breaks between "images on disk" and "URLs in the issue comment": no upload before the comment, no assignment to `ctx`, and no rendering in the proof formatter.

## Relevant Files
Use these files to fix the bug:

- `README.md` — project overview; the "Multi-agent passive review" and "Screenshot upload pipeline" bullets describe the review and R2 features touched here.
- `.adw/coding_guidelines.md` — must be followed: files under 300 lines, nesting depth ≤ 2 with guard clauses and extracted loop bodies, immutability, no `any`, and the **Comments** rule (no restating comments, no issue-number citations, no name-echoing JSDoc).
- `specs/adr/0024-tdd-in-build-phase-single-pass-alignment.md` — specification for the independence check: Decision Outcome bullet "Independence check in review (#307)" and the `## Divergence` section to delete.
- `specs/adr/0022-review-proof-in-r2-behind-router-worker.md` — specification for the screenshots fix (`## Divergence` item 2, to delete). It also states the upload contract to keep: one bucket per repo, public URL `https://screenshots.paysdoc.nl/{repo}/{key}`, and "Upload is non-fatal".
- `specs/adr/0031-active-test-phase-passive-review-judge.md` — the boundary: the review stays a passive judge, and Strategy A/B in `review.md` and `.adw/review_proof.md` must not change (ADR-0031 Divergence is a separate redesign).
- `specs/issue-307-adw-yxq5og-review-phase-step-de-sdlc_planner-step-def-independence-check.md` — the original specification of the check's anti-patterns (internal assertion, tautological pass, structural mirroring) and the "skip when no step definitions exist" guard. This issue overrides its severities: every violation is a `blocker`.
- `.claude/skills/write-an-adr/SKILL.md` — "What may change after an ADR is accepted": only `status`, `superseded-by`, `## Divergence` and the supersession note.
- `.claude/commands/review.md` — the review prompt; gains Step 4. Its `target: false` front matter means it is copied into target-repo worktrees at run time (`adws/phases/worktreeSetup.ts:208-209`), so the new step must be language- and framework-agnostic.
- `.claude/commands/generate_step_definitions.md` and `.claude/skills/implement-tdd/SKILL.md` — how step definitions are written: through the implementation's exported code, with external boundaries mocked by the harness. The check must not flag those legitimate patterns.
- `.adw/scenarios.md` — `## Step Def Directory` (default `features/step_definitions`, `adws/core/projectConfig.ts:145`). ADW itself also keeps step definitions under `features/per-issue/step_definitions/` and `features/regression/step_definitions/` (`cucumber.js`), so the check must find step files by content, not only by that directory.
- `adws/phases/reviewPhase.ts` — `executeReviewPhase`; it must upload the reviewed proof's images and set `ctx.screenshotUrls` before posting `review_passed`/`review_failed`. It is 271 lines now; keep it under 300.
- `adws/proof/prProofPublisher.ts` — `publishPrProof`; its harvest → upload half moves to the new `proofUploader.ts`. `formatPrProofComment` is unchanged.
- `adws/proof/proofArtifactHarvester.ts` — `harvestProofArtifacts(dir)`, reused unchanged by the uploader.
- `adws/proof/types.ts` — `UploadedArtifact`, `UploaderFn`, `PublishDeps`; gains the uploader's deps interface.
- `adws/proof/index.ts` — barrel; re-export the new uploader.
- `adws/r2/uploadService.ts` / `adws/r2/types.ts` — `uploadToR2` (default uploader) and `UploadOptions`/`UploadResult`; unchanged.
- `adws/core/environment.ts` — `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` are module-level constants read at import time, after `dotenv.config()` has loaded `.env`. Unit tests must `vi.mock('../../core/environment', …)` to simulate a configured R2, as `adws/cost/__tests__/d1Client.test.ts:4` does. A cucumber step cannot toggle these constants. The BDD scenarios therefore replace R2 through the `setProofUploaderForTesting` seam (Step 1), never through the environment. Through the environment, a run without credentials would upload nothing, and a run with credentials in `.env` would reach the real R2.
- `adws/core/guardrailsGate.ts` — `setGuardrailsGateDepsForTesting` (lines 93–103) is the precedent for a test-only module-level seam that BDD steps install and then reset with `null`. `setProofUploaderForTesting` follows it.
- `features/per-issue/feature-937.feature` — this issue's BDD scenarios (§1–§4). They run the real `executeScenarioTestPhase` and then the real `executeReviewPhase(config, proofPath)`, and replace only R2. Their steps install a recording stand-in through `setProofUploaderForTesting` around that run, and reset it in an `@adw-937`-scoped `After`. The file exists, so the build agent runs in TDD mode (`/implement-tdd`, `adws/agents/buildAgent.ts:72-73`) and writes the step definitions in `features/per-issue/step_definitions/`.
- `adws/forge/workflowCommentsIssue.ts` — `WorkflowContext.screenshotUrls`, `formatReviewPassedComment`, `formatReviewFailedComment`, and the private `formatScreenshotSection` that moves out.
- `adws/forge/proofCommentFormatter.ts` — `ProofCommentInput.screenshotUrls` placeholder and `formatReviewProofComment`, which must render screenshots.
- `adws/phases/scenarioTestPhase.ts` — sets `config.ctx.scenarioProof` (line 138); `artifactsDir` comes from `adws/phases/scenarioProof.ts` (wiped and recreated on every run). Read only, not changed.
- `adws/phases/proofPublishPhase.ts` — calls `publishPrProof` after the PR phase. Not changed; its re-upload overwrites the same keys with identical bytes.
- `adws/phases/sdlcReviewHandoff.ts` — posts the final `review_failed` comment from `config.ctx`, so it picks up `screenshotUrls` set by the last review attempt. Read only.
- `adws/adwSdlc.tsx`, `adws/adwPlanBuildTestReview.tsx`, `adws/adwPlanBuildReview.tsx`, `adws/adwChore.tsx`, `adws/adwPrReview.tsx` — the review-loop callers. Each runs `executeScenarioTestPhase` (directly or through `runScenarioTestFixLoop`) before every review attempt, so `ctx.scenarioProof` is the proof being judged. Read only.
- `adws/forge/__tests__/workflowCommentsIssue.test.ts` — existing formatter tests; extend with the screenshot cases.
- `adws/phases/__tests__/reviewPhaseApprovalGate.test.ts` — the mock harness pattern for `executeReviewPhase` (mocks `../../core`, `../../cost`, `../../agents/planAgent`, `../../agents/reviewAgent`, `../phaseCommentHelpers`) to copy for the new wiring test.
- `adws/proof/__tests__/prProofPublisher.test.ts` — existing formatter tests for the PR proof comment; must stay green.
- `features/regression/multilang/python_fixture_e2e.feature` + `features/regression/step_definitions/pythonFixtureE2ESteps.ts` and `features/per-issue/step_definitions/feature-820.steps.ts` — drive `publishPrProof` end to end; they must stay green after the extraction.
- `app_docs/feature-9gjajh-review-and-diff-phases.md` — conditional doc for `adws/phases/reviewPhase.ts` (decisions 0027, 0031, 0038).
- `app_docs/feature-9gjajh-proof-and-scenario-proof.md` — conditional doc for `adws/proof/**` and `proofPublishPhase.ts` (decisions 0014, 0022, 0043).
- `app_docs/feature-9gjajh-github-api.md` — conditional doc for `adws/forge/**` comment formatters.
- `app_docs/feature-9gjajh-commands-and-skills.md` — conditional doc for `.claude/commands/review.md` (decisions include 0024, 0031).
- `app_docs/feature-9gjajh-review-and-patch-agents.md` — conditional doc for `adws/agents/reviewAgent.ts` (`ReviewResult` / `ReviewIssue` shapes; not changed).

### New Files
- `adws/proof/proofUploader.ts` — `isR2Configured()`, `uploadProofArtifacts(deps)` and the test-only `setProofUploaderForTesting(uploader | null)`. `uploadProofArtifacts` harvests the proof directory, uploads each image under `proof/{adwId}/{relPath}` (to R2 by default, or to an injected or installed uploader), and returns the `UploadedArtifact[]` that succeeded. Never throws. Shared by the review phase (issue comment) and `publishPrProof` (PR comment). Covered by the existing `adws/proof/**` conditional-docs glob.
- `adws/proof/__tests__/proofUploader.test.ts` — unit tests for `uploadProofArtifacts`.
- `adws/phases/__tests__/reviewPhaseScreenshots.test.ts` — unit tests showing that `executeReviewPhase` puts the uploaded URLs on the issue's review comment.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Extract the proof upload into `adws/proof/proofUploader.ts`
- Create `adws/proof/proofUploader.ts` and move these from `adws/proof/prProofPublisher.ts` unchanged: `CONTENT_TYPE_MAP`, `contentTypeForExt`, `leadingSegment`, and `isR2Configured` (exported).
- Add to `adws/proof/types.ts`:
  ```ts
  export interface UploadProofDeps {
    readonly artifactsDir: string;
    readonly repoInfo: RepoIdentifier;
    readonly adwId: string;
    readonly uploader?: UploaderFn;
  }
  ```
- Add a test-only seam to `proofUploader.ts`, following `setGuardrailsGateDepsForTesting` (`adws/core/guardrailsGate.ts:93-103`):
  ```ts
  let installedUploader: UploaderFn | null = null;

  /**
   * Test-only seam: an installed uploader replaces R2 for every call that injects none, and counts
   * as configured, so BDD steps can record uploads without R2 credentials. Pass `null` to restore R2.
   */
  export function setProofUploaderForTesting(uploader: UploaderFn | null): void {
    installedUploader = uploader;
  }
  ```
- Export `async function uploadProofArtifacts(deps: UploadProofDeps): Promise<UploadedArtifact[]>`:
  - It resolves its uploader as `deps.uploader ?? installedUploader`. Only when neither is set does it fall back to the real `uploadToR2`, and only that fallback is gated: it returns `[]` without uploading when `isR2Configured()` is false.
  - An injected or installed uploader counts as configured and is never gated on `isR2Configured()`. That check reads environment constants fixed at import, so gating on it would leave the BDD stand-in unused in a test run without R2 credentials.
  - Then it harvests with `harvestProofArtifacts(artifactsDir)` and uploads each artifact **sequentially** (not `Promise.all`: `uploadToR2` calls `ensureBucket` per upload, and parallel first uploads would race bucket creation). Key: `` `proof/${adwId}/${artifact.relPath}` ``; body: `fs.readFileSync(artifact.absPath)`; `contentType: contentTypeForExt(path.extname(artifact.absPath))`. Each success maps to `{ scenario: leadingSegment(relPath), url: result.url, fileName: path.basename(relPath) }`. Results come back in harvest (sorted `relPath`) order.
  - Put the per-artifact body (read + upload + map, inside `try/catch`) in a named helper, e.g. `uploadOne(artifact, deps): Promise<UploadedArtifact | null>`. On error it logs `warn` (`` `uploadProofArtifacts: failed to upload ${artifact.relPath} — ${err}` ``) and returns `null`. This keeps nesting ≤ 2.
  - It **never throws**: wrap the harvest call too and log `warn` + return `[]` on an unexpected error, because ADR-0022 says "Upload is non-fatal". State the contract in a one-line comment, in the style of the existing "Non-fatal — any error is caught and logged" comments.
- Update `adws/proof/prProofPublisher.ts`:
  - Remove the moved helpers.
  - In `publishPrProof`, keep the `prNumber <= 0` and `!artifactsDir || !scenarioProof` guards. Then, inside the existing `try`, compute `const r2Configured = isR2Configured();` and `const uploaded = r2Configured ? await uploadProofArtifacts({ artifactsDir, repoInfo, adwId, uploader }) : [];`. Format and post exactly as today.
  - Drop the `uploader = uploadToR2` destructuring default and pass `deps.uploader` through as given, because `uploadProofArtifacts` owns the default.
  - Keep the `r2Configured` gate in `publishPrProof`. Today an injected uploader is also skipped when R2 is not configured, and the PR comment then carries the "R2 is not configured" note. Without the gate, an injected uploader would upload in that case and change the comment.
  - Behaviour must be byte-identical: same keys, same comment, same "R2 is not configured" note.
  - Fix the header comment's "Impure half" line to say that `publishPrProof` uploads through `uploadProofArtifacts`, then formats and posts.
- Re-export `uploadProofArtifacts`, `isR2Configured`, `setProofUploaderForTesting` and the `UploadProofDeps` type from `adws/proof/index.ts`.

### Step 2: Render screenshots in the scenario-proof review comment (`adws/forge/proofCommentFormatter.ts`)
- Add and export `formatScreenshotSection(screenshotUrls: readonly string[]): string`. Move the body from `workflowCommentsIssue.ts` and drop the leading `\n\n`, because the sections here are joined with `\n\n` like the other `format*Section` helpers:
  ```ts
  const images = screenshotUrls.map((url, i) => `[![Screenshot ${i + 1}](${url})](${url})`).join('\n');
  return `<details>\n<summary>Screenshots (${screenshotUrls.length})</summary>\n\n${images}\n\n</details>`;
  ```
- In `formatReviewProofComment`, destructure `screenshotUrls` and push `formatScreenshotSection(screenshotUrls)` when `screenshotUrls && screenshotUrls.length > 0`. Place it after the verification section and before the non-blocker section, so it renders for both passed and failed reviews.
- Change the `ProofCommentInput.screenshotUrls` doc comment `/** Screenshot URLs — placeholder for future wiring. */`: delete it (the name says what the field is) or replace it with a non-obvious fact, e.g. that these are public R2 URLs embedded as images.

### Step 3: Pass `screenshotUrls` through the issue review formatters (`adws/forge/workflowCommentsIssue.ts`)
- Import `formatScreenshotSection` from `./proofCommentFormatter` and delete the local `formatScreenshotSection`.
- `formatReviewPassedComment` and `formatReviewFailedComment`: add `screenshotUrls: ctx.screenshotUrls` to the `ProofCommentInput` object in the `ctx.scenarioProof` branch.
- In both fallback branches keep the output byte-identical:
  ```ts
  const screenshotSection = ctx.screenshotUrls && ctx.screenshotUrls.length > 0
    ? `\n\n${formatScreenshotSection(ctx.screenshotUrls)}`
    : '';
  ```
- Replace the stale `WorkflowContext.screenshotUrls` comment (`/** Public URLs of screenshots uploaded to R2 (set when applicationType is 'web'). */`). The `applicationType === 'web'` condition was removed with #278's call site. Use something accurate, e.g. `/** Public R2 URLs of the images from the scenario proof the review judged; set by the review phase. */`.
- Do not touch `allScreenshots` (dead, out of scope) or any other formatter.

### Step 4: Upload the reviewed proof's images and set `ctx.screenshotUrls` in `executeReviewPhase` (`adws/phases/reviewPhase.ts`)
- Import `uploadProofArtifacts` from `../proof/proofUploader` (the direct module import keeps the test mock target precise).
- Add a small module-level helper:
  ```ts
  async function uploadReviewedProofScreenshots(config: WorkflowConfig): Promise<string[]> {
    const artifactsDir = config.ctx.scenarioProof?.artifactsDir;
    if (!config.repoContext || !artifactsDir) return [];
    const uploaded = await uploadProofArtifacts({ artifactsDir, repoInfo: config.repoContext.repoId, adwId: config.adwId });
    return uploaded.map(artifact => artifact.url);
  }
  ```
- The helper passes no `uploader`, so the upload goes through the default seam: the stand-in installed with `setProofUploaderForTesting` if a test installed one, otherwise R2 when it is configured. Do not add an uploader parameter to `executeReviewPhase`. `feature-937.feature`'s steps call it as `executeReviewPhase(config, proofPath)` and install their stand-in through the seam.
- In `executeReviewPhase`, right after `runReviewAgent(...)` resolves and **before** the `if (reviewPassed)` branch, assign unconditionally: `ctx.screenshotUrls = await uploadReviewedProofScreenshots(config);`.
  - Unconditional assignment matters: the orchestrator re-runs the scenario test (which wipes `artifactsDir`) between review attempts, so a list from an earlier attempt must never leak into a later comment.
  - Placing it after the agent call means a throwing agent (rate limit, auth) never triggers an upload.
- Do not change the review agent's inputs (`specFile`, `scenarioProofPath`, args), the approval logic, or the return shape. How the reviewer obtains proof must not change (ADR-0031).
- Keep the file under 300 lines. If the helper pushes it over, move the helper into `adws/phases/reviewScreenshots.ts` and import it.

### Step 5: Add the independence check to `.claude/commands/review.md`
- Insert a new section `## Step 4: Step Definition Independence Check` between `## Step 3: Coding Guidelines Check` and `## Issue Severity Reference`. Do not edit Step 1, Step 2 (Strategy A/B), Step 3, or the proof instructions in `.adw/review_proof.md`.
- The section must contain these elements (wording may be tightened, the substance may not):
  - **Purpose.** Step definitions must be independent of the implementation: written against the observable behaviour the scenarios describe, not shaped to make the build agent's code pass.
  - **Scope / guard.**
    - From `git diff origin/<default> --name-only`, select the added or modified (not deleted) files that define BDD steps. That means any file registering Given/When/Then steps (for example `Given(`/`When(`/`Then(` in cucumber-js, `@given`/`@when`/`@then` in pytest-bdd or behave).
    - `## Step Def Directory` in `.adw/scenarios.md` names the usual location, but per-issue and regression suites may keep their own `step_definitions/` directories.
    - If no such file changed (including projects without BDD scenarios), skip this step and emit nothing.
  - **What to read.** Each changed step-definition file in full, the `.feature` scenarios whose steps it implements, and the implementation code it exercises.
  - **Rules** (judge every step the file adds or changes):
    1. *Observable behaviour through a public interface.* The step drives and observes the system the way the scenario describes it: a CLI, an exported function or class, an HTTP endpoint, files written, or calls recorded by a mocked **external** boundary (the test harness's GitHub/Claude CLI/git mocks are legitimate). It does not use unexported helpers, private state, or internal collaborators that the scenario does not name.
    2. *The assertion can fail.* A Then step must fail when the behaviour is broken. Flag assertions that compare a value with itself or with a stub's canned return value the implementation never acted on, assert a constant, are missing or empty, swallow the failure in a catch, or pass by returning early or marking the step pending or skipped.
    3. *Expectations come from the scenario.* Expected values come from the scenario text and the issue. They are not computed by calling the code under test, not re-derived by copying the implementation's logic into the step, and not copied from the implementation's current output.
    4. *No accommodation.* The step does not special-case the scenario's inputs, and adds no conditions, retries or tolerances whose only purpose is to let the current implementation through. It does not weaken what the step phrase promises.
  - **Reporting.**
    - Emit one `blocker` reviewIssue per violating file, with `remediationStrategy: "patch"`.
    - `issueDescription` names the file, the step(s), and the rule each one breaks.
    - `issueResolution` says how to rewrite the step so it tests the behaviour the scenario describes. The fix changes the step definition only: never the `.feature` file, and never by loosening the assertion.
    - If no violation is found, emit nothing for this step.
- In `## Report`, extend the closing paragraph so it is explicit that Step 4 blockers use `remediationStrategy: "patch"`. Step 3 keeps `"refactor"`, and `success` is `false` whenever any blocker (including a Step 4 one) exists. The existing rule "`success`: `true` if no `blocker` issues" already implies this; keep the wording consistent with it.
- Keep the prompt free of issue-number citations (Comments rule) and keep the output JSON schema unchanged, since `reviewResultSchema` in `adws/agents/reviewAgent.ts` must still match.

### Step 6: Unit tests: issue review comment formatter with URLs present (`adws/forge/__tests__/workflowCommentsIssue.test.ts`)
- Add a `describe('formatWorkflowComment — review comments embed screenshot URLs', …)` block. Use a minimal `ScenarioProofResult` fixture (`{ tagResults: [], hasBlockerFailures: false, resultsFilePath: '/tmp/scenario_proof.md', artifactsDir: '/tmp/artifacts' }`) and two URLs such as `https://screenshots.paysdoc.nl/repo/proof/adw-1/login/step-1.png` and `…/checkout/step-2.png`. Assert:
  - `review_passed` with `scenarioProof` + `screenshotUrls`: the body contains `<summary>Screenshots (2)</summary>`, contains each URL as `[![Screenshot N](url)](url)`, and still contains `:white_check_mark: Review Passed`.
  - `review_failed` with `scenarioProof` + `screenshotUrls` + one blocker in `reviewIssues`: the body contains both URLs and the blocker section.
  - `review_passed` with `scenarioProof` and `screenshotUrls` absent or `[]`: no `Screenshots (` section.
  - Fallback (no `scenarioProof`) `review_passed` with `screenshotUrls`: still embeds the URLs. This guards the moved helper.
  - `parseWorkflowStageFromComment(body)` still returns `review_passed` / `review_failed` for bodies with screenshots, so stage recovery is unaffected.

### Step 7: Unit tests: review phase passes the uploaded URLs to the issue comment (`adws/phases/__tests__/reviewPhaseScreenshots.test.ts`)
- Copy the mock harness of `reviewPhaseApprovalGate.test.ts` (mock `../../core`, `../../cost`, `../../agents/planAgent`, `../../agents/reviewAgent`, `../phaseCommentHelpers`). Add `vi.mock('../../proof/proofUploader', () => ({ uploadProofArtifacts: vi.fn() }))`; this is the R2 boundary.
- Build a config with `repoContext` (`repoId: { owner: 'test', repo: 'repo', platform: 'github' }`, plus the `issueTracker`/`codeHost` stubs the approval path needs, or `prUrl` unset) and `ctx.scenarioProof.artifactsDir = '/tmp/artifacts'`.
- Cases:
  1. Review passes and the uploader returns two artifacts. `uploadProofArtifacts` is called once with `{ artifactsDir: '/tmp/artifacts', repoInfo: repoContext.repoId, adwId }`, and the `postIssueStageComment` call for `'review_passed'` receives a ctx whose `screenshotUrls` equals the two URLs.
  2. Review fails (blocker). The `'review_failed'` call's ctx carries the URLs.
  3. No `ctx.scenarioProof`. The uploader is not called and `ctx.screenshotUrls` is `[]`.
  4. No `repoContext` (self-host). The uploader is not called and no comment is posted.
  5. Stale URLs are replaced. Run `executeReviewPhase` twice on the same config; the uploader returns URLs the first time and `[]` the second. After the second run `ctx.screenshotUrls` is `[]`.
  6. The review agent rejects (`mockRunReviewAgent.mockRejectedValue(...)`). The uploader is not called.

### Step 8: Unit tests: the extracted uploader (`adws/proof/__tests__/proofUploader.test.ts`)
- `vi.mock('../../core/environment', () => ({ CLOUDFLARE_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret' }))` so R2 counts as configured. If the module under test needs other exports from `environment`, use the `importOriginal` spread pattern from `adws/phases/__tests__/workflowInit.test.ts:48`. Mock `../../core/logger` if it pulls in heavy imports. Also mock `vi.mock('../../r2/uploadService', () => ({ uploadToR2: vi.fn() }))`, so that the real R2 client is never reached and the default path can be asserted. Reset the seam with `setProofUploaderForTesting(null)` in `afterEach`.
- Create a temp dir (`fs.mkdtempSync`) containing `login/step-1.png`, `checkout/step-2.jpg`, `flat.webp` and `notes.txt`. Use a recording `uploader` that returns `{ url: 'https://fake/' + key, bucket, key }`. Assert:
  - The uploader is called once per image (3), never for `notes.txt`. Keys are `proof/{adwId}/checkout/step-2.jpg`, `proof/{adwId}/flat.webp`, `proof/{adwId}/login/step-1.png` (sorted), with content types `image/jpeg`, `image/webp`, `image/png`.
  - The returned artifacts carry `scenario` = leading segment (`'Screenshots'` for the flat file), `fileName` = basename, and `url` from the uploader, in harvest order.
  - When the uploader throws for one artifact, that artifact is skipped, the others are returned, and the function resolves (no throw).
  - A nonexistent `artifactsDir` resolves to `[]` without calling the uploader.
  - The seam. When `deps.uploader` is absent, an uploader installed with `setProofUploaderForTesting` receives the uploads and `uploadToR2` is not called. An injected `deps.uploader` takes precedence over the installed one. After `setProofUploaderForTesting(null)`, the default `uploadToR2` receives the uploads again.
- R2 not configured. Use `vi.resetModules()` + `vi.doMock` of `../../core/environment` with empty strings, then a dynamic `import('../proofUploader')`:
  - With neither an injected nor an installed uploader, it resolves to `[]` and `uploadToR2` is never called.
  - An injected uploader, and an installed one, are still called, because they count as configured. This is the contract the BDD stand-in relies on.

### Step 9: Remove the resolved divergences from the ADRs
- `specs/adr/0024-tdd-in-build-phase-single-pass-alignment.md`: delete the entire `## Divergence` section (heading plus item 1), leaving `## More Information` directly after `### Confirmation`'s last line ("No CI gate enforces this decision."). Change nothing else: not the front matter, Context, Decision Outcome, Consequences ("The review check was meant to cover this." stays), Confirmation, or More Information.
- `specs/adr/0022-review-proof-in-r2-behind-router-worker.md`: delete Divergence item 2. It is the only item, so delete the whole `## Divergence` section (heading plus item 2). Change nothing else, including the `## More Information` text about #278's call site.
- `specs/adr/README.md` needs no change: it lists number/date/title/status only, and its statement "A record with a `## Divergence` section describes a decision the code does not currently follow" stays true.

### Step 10: Run the validation commands
- Run every command in `Validation Commands` below and fix any failure before finishing.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

Reproduce (each finds the defect before the fix; after the fix the review.md grep finds the new step and the screenshotUrls grep shows an assignment):
- `grep -n -i "Step Definition Independence" .claude/commands/review.md` — before: no match. After: matches the `## Step 4` heading.
- `grep -rn "screenshotUrls =" adws --include='*.ts'` — before: no match. After: matches the assignment in `adws/phases/reviewPhase.ts`.
- `grep -n "## Divergence" specs/adr/0024-tdd-in-build-phase-single-pass-alignment.md specs/adr/0022-review-proof-in-r2-behind-router-worker.md` — before: two matches. After: no match.

Unit tests (new and existing):
- `bunx vitest run adws/forge/__tests__/workflowCommentsIssue.test.ts adws/phases/__tests__/reviewPhaseScreenshots.test.ts adws/proof/__tests__/proofUploader.test.ts` — the new tests. The formatter and wiring tests fail before the fix and pass after.
- `bunx vitest run adws/proof adws/phases/__tests__/reviewPhase.test.ts adws/phases/__tests__/reviewPhaseApprovalGate.test.ts adws/forge` — neighbouring suites stay green.
- `bun run test:unit` — the full unit suite (`.adw/commands.md` `## Run Tests`).

Type check, lint, build:
- `bunx tsc --noEmit`
- `bunx tsc --noEmit -p adws/tsconfig.json`
- `bun run lint`
- `bun run build`
- `bun run lint:docs-index` — the new `adws/proof/proofUploader.ts` and its test fall under the `adws/proof/**` glob; no dangling entries or orphans.
- `bun run lint:git-guard` — no new git/gh shell-outs or unsanctioned constructions.

BDD (proof publishing must be unchanged after the extraction):
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@python-e2e"` — drives `harvestProofArtifacts` → `formatPrProofComment` → `publishPrProof`.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-937"` — this issue's scenarios (`features/per-issue/feature-937.feature`). All of them must pass, and the real R2 must never be reached: the stand-in is installed through `setProofUploaderForTesting`. Before the fix, every row with screenshots fails. The two rows without screenshots and the type-check row pass before and after.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — zero regressions across the regression suite, including the review-phase surface rows 07/08/15.

## Notes
- Strictly follow `.adw/coding_guidelines.md`, in particular: nesting ≤ 2 (extract the per-artifact upload body), files < 300 lines (`reviewPhase.ts` is at 271), no `any`, immutable data, and the **Comments** rule (no issue numbers in code or prompt, no restating or name-echoing comments, fix the two stale `screenshotUrls` comments rather than adding more).
- **Do not change how the reviewer obtains proof (ADR-0031).** No edits to Strategy A/B in `review.md`, to `.adw/review_proof.md`, to the review agent's arguments, or to `scenarioTestPhase`/`runScenarioProof`. The new Step 4 reads code and does not produce proof. The screenshot upload happens in the orchestrating TypeScript after the agent returns, so the agent's inputs are untouched.
- **Why upload in the review phase and not reuse `executeProofPublishPhase`:** the review comment is posted before the PR exists (`adwSdlc.tsx` lines 77 vs 116–117). A failed review creates no PR at all, and `adwPlanBuildReview`/`adwChore` never run proof publish. The review phase is the only point where every orchestrator has the reviewed proof and is about to post the comment.
- **Test seam for the BDD scenarios.** `feature-937.feature` runs the real scenario test phase and the real review phase, and replaces only R2. Its steps install a recording stand-in through `setProofUploaderForTesting` and reset it with `null` afterwards.
  - The stand-in must count as configured (Step 1).
  - The review phase must reach it through the default seam, not through a new parameter (Step 4).
  - Only the default `uploadToR2` stays gated on `isR2Configured()`. With nothing installed, which is always the case in production, behaviour is exactly as described above.
  - The seam's module-level `let` is the one deliberate mutable binding, as in `guardrailsGate.ts`.
- **Interpretation of "a review that produced screenshots":** under the passive judge the reviewer itself produces no images. The screenshots are the images the scenario run wrote to `ADW_PROOF_DIR` (`ctx.scenarioProof.artifactsDir`) for the proof that this review judged. "The uploaded proof URLs" are their R2 URLs under `proof/{adwId}/…`, the same keys the PR proof comment uses. The review agent's own `screenshots` JSON field (local paths such as `scenario_proof.md`) is deliberately not used: it is LLM-authored and non-deterministic, and using it would mean changing the proof instructions.
- **Known, accepted behaviour:**
  - (1) `executeProofPublishPhase` uploads the same images again after the PR phase. The keys are identical and so are the bytes (no scenario run happens between the final review and proof publish), so this is an idempotent overwrite and nothing is duplicated. Deduplicating it would couple the PR publisher to review-phase state for a negligible saving.
  - (2) If a later review attempt regenerates an image under the same `relPath`, the earlier attempt's comment shows the newer image, because the URL is the same object. This matches ADR-0022's accepted limits on the durability of old comments (30-day expiry).
  - (3) When R2 is not configured, the issue comment simply has no screenshot section. The PR proof comment's "R2 is not configured" note is unchanged.
- **ADR edit rule:** the write-an-adr skill allows only `status`, `superseded-by`, `## Divergence` and the supersession note to change after acceptance. Delete only the Divergence content named by the issue.
- `review.md` is not a framework hash input (`.claude/commands/adw_init.md` `hashInputs:` lists `adw_init.md`, `document.md`, `templates/vocabulary.md.template`), so `.adw-version` does not change.
- Per ADR-0056 the prompt edit in `.claude/commands/review.md` belongs to the build agent (Step 5). The plan commit must carry only this plan file.
- No new libraries are required.
