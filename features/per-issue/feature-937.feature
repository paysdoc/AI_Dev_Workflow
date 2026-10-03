@adw-937 @adw-axbb2a-bug-review-checks-st
Feature: The review comment on the issue shows the screenshots of the proof the review judged, each embedded from the URL its upload returned, and a screenshot never decides or blocks the review

  Issue #937 resolves two `## Divergence` items in `specs/adr/`. Those items are the specification:
    • ADR-0024, item 1 (`0024-tdd-in-build-phase-single-pass-alignment.md`). The step-definition
      independence check that #307 specified is missing from the review prompt
      (`.claude/commands/review.md`). Ruling (owner, 2026-09-29): the check is required; its
      absence is a bug;
    • ADR-0022, item 2 (`0022-review-proof-in-r2-behind-router-worker.md`). No caller sets
      `screenshotUrls` for the review comment formatters (`adws/forge/workflowCommentsIssue.ts`),
      so screenshots never reach the review comments on the issue. Ruling (owner, 2026-09-29):
      they were meant to appear there as well. A bug.
  How the reviewer obtains its proof does not change. That design is under review separately
  (ADR-0031).

  The screenshots today. The scenario test phase empties the run's artifacts directory, then runs
  the scenarios with `ADW_PROOF_DIR` pointing at it, so afterwards it holds exactly the images that
  run wrote. The review phase then posts its verdict on the issue, in a comment headed "Review
  Passed" or "Review Failed". Only after the pull request is opened does the proof publish phase
  harvest the images, upload them to R2 under `proof/{adwId}/` and embed them in a comment on the
  pull request. So when the review comment is written nothing has been uploaded, and
  `ctx.screenshotUrls` is unset. Even if it were set, the formatter path taken whenever a scenario
  proof exists, `formatReviewProofComment`, ignores screenshot URLs:
  `ProofCommentInput.screenshotUrls` is a "placeholder for future wiring".

  What #937 changes. The review comment on the issue shows the screenshots the proof run left,
  each embedded as an image from the public URL its upload returned, on a passing and on a failing
  review alike. A screenshot never delays, fails or changes a review: an upload that fails is left
  out, as the proof publisher already does, and a run without screenshots, or a repository without
  scenarios, gets the review comment it gets today.

  The labels below are the section numbers used for the scenario groups further down (§1–§4):

    §1  THE REVIEW COMMENT SHOWS THE SCREENSHOTS (AC2). The proof run left screenshots, in scenario
        folders and at the top of the proof directory, PNG and JPEG. The review passes, or fails
        with a blocker. Its comment on the issue embeds every screenshot, each from a URL its
        upload returned, and the failing comment still lists its blocker.

    §2  THEY ARE THE SCREENSHOTS OF THE PROOF THE REVIEW JUDGED. Only the images of the proof run
        are uploaded and shown. The scenario proof file is not: the review agent lists it as its
        proof artifact, as `review.md` tells it to, but it is a Markdown document. Nor is a file in
        the proof directory that is not an image. After a failed review the re-test's run replaces
        the screenshots, and the next review comment shows the new run's screenshots and none of
        the earlier run's.

    §3  A SCREENSHOT NEVER DECIDES OR BLOCKS THE REVIEW. An upload the screenshot store refuses is
        left out; the comment is still posted with the other screenshots, and the verdict stands.
        A run that leaves no screenshots, and a repository with no scenarios configured, get the
        review comment they get today, with no image, and nothing is uploaded.

    §4  BACKSTOP. The type-check.

  Each row is written to fail for a specific wrong implementation:
    • every row with screenshots is RED today: nothing is uploaded before the review comment, and
      the comment embeds no image;
    • every row with screenshots has a scenario proof, so the formatters take the
      `formatReviewProofComment` path. The rows fail for a fix that sets `ctx.screenshotUrls` but
      leaves that path ignoring it. Only the fallback path renders screenshot URLs today, and no
      row with screenshots reaches it;
    • the failing-review row fails for a fix that wires only the passing comment, and for one whose
      screenshots replace the blocker list;
    • the screenshots in scenario folders, and the JPEG, fail a fix that reads only the top level
      of the proof directory or only `.png` files. The proof publisher's harvester
      (`harvestProofArtifacts`) walks the whole directory and takes PNG, JPEG, GIF and WebP;
    • every row runs on a repository of the default application type, `cli`. The rows fail for a
      fix that uploads only for `web`, as #278 did. The proof upload of #580 has no such
      condition, and neither has the acceptance criterion;
    • the first §2 row fails for a fix that uploads the paths the review agent returns in its
      `screenshots` field. Strategy A of `review.md` tells the reviewer to put the scenario proof
      file there, and nothing tells it to list the images. The row also fails for a fix that
      uploads every file in the proof directory;
    • the re-test row fails for a fix that collects screenshot URLs across review attempts, so that
      a later comment shows images of a build the review no longer judged. A fix that reads the
      proof directory for each review passes, because each run empties it first;
    • the refused-upload row fails for a fix that lets an upload error escape the phase, posts no
      comment, or fails the review. The refused screenshot comes first in harvest order, so the row
      also fails for a fix that gives up at the first failed upload;
    • the two rows without screenshots are GREEN today and must stay green. The row without
      scenarios fails for a fix that reads the artifacts directory of a scenario proof that does
      not exist: there the scenario test phase leaves no proof, and the review phase must not
      throw.

  ── WHY SOME CRITERIA GET NO SCENARIO OF THEIR OWN ──────────────────────────────────────────
  AC1 (the review prompt contains the independence check and reports a violation as a blocker) is
  a change to the text of `.claude/commands/review.md`. The prompt runs only inside a real Claude
  session, which this harness never starts: the review agent here is a stand-in that returns a
  scripted verdict. A scenario could pin the check only by reading `review.md` as text, which the
  Rot-Detection Rubric forbids. #307's own scenarios did that:
  `features/review_step_def_independence.feature` asserted the wording of `review.md`. It was added
  on 2026-03-25 (1d709519) and removed the next day among the stale scenarios of chore #321
  (1b5e8a1d), and the prompt change it described never merged. So the review of the pull request
  checks AC1: the prompt checks that the step definitions changed on the branch are written
  against observable behaviour through public interfaces, not shaped to make the build agent's
  code pass, and reports each violation as a `blocker`. Once reported, such a blocker is handled
  as every blocker is; §1's failing row shows its comment listing one.
  AC2's unit test (the formatter with URLs present) is an obligation on the vitest suite, which
  the build and test phases discharge. A scenario asserting that the test exists would assert a
  source-file property; §1 is its behavioural counterpart.
  AC3 (the Divergence section of ADR-0024 and item 2 of ADR-0022 are removed in the same pull
  request) is a documentation change. A scenario asserting that a document lacks a section would
  assert a file's contents, so the review of the pull request checks it.

  Not pinned here, and left to the plan:
    • which phase uploads the screenshots: the scenario test phase, the review phase, or a helper
      both reach. Also whether the proof publish phase reuses those uploads or uploads again. The
      pull request's proof comment stays pinned by `adws/proof/__tests__/prProofPublisher.test.ts`
      and by the Python fixture regression (T-PY5, T-PY6), which must stay green;
    • the object key, and the layout, order and collapsing of the screenshot section;
    • what the review comment says when R2 is not configured. The pull request's proof comment
      says "R2 is not configured — screenshots were not uploaded";
    • whether the `review_failed` comment posted when a workflow stops after its last review
      attempt (`executeSdlcReviewFailedHandoff`, and the stop path of #927) shows the screenshots
      too.

  How these scenarios observe the system. Every assertion targets a runtime artefact:
    • the comments the recording issue tracker received;
    • the uploads the stand-in screenshot store received (their bytes), and the URL it answered
      each with;
    • what the review phase returned, or the error it threw.
  No scenario reads, greps or parses a source file. The screenshots, the scenario command and the
  stand-in review agent's verdict are fixtures the steps write.

  Notes for the step definitions:
    • NEVER RUN A REAL AGENT, NEVER REACH R2 OR GITHUB.
    • THE WORKFLOW. "a review workflow for issue N under adwId X whose issue tracker records every
      comment" builds a `WorkflowConfig` over a throwaway worktree:
        – a recording `repoContext` for the fictional `acme/widgets`. Its `issueTracker` records
          `commentOnIssue` and answers `fetchLabels` with `[]`; its `codeHost` records every call.
          `ctx.prUrl` stays unset: in `adwSdlc` the review runs before the pull request exists;
        – a `projectConfig` built from the defaults: application type `cli`, the default proof
          tags (`@regression`, and the optional `@adw-{issueNumber}`), and `startDevServer` set to
          `N/A` so that no dev server starts. `scenariosMd` is not empty, the worktree's
          step-definition directory holds one step-definition file so that `hasStepDefinitions`
          passes, and `runScenariosByTag` is a hermetic shell command. The Python fixture's
          command (`test/fixtures/python-app/.adw/commands.md`) is the precedent. For every tag
          the command copies the screenshots the scenario names into `$ADW_PROOF_DIR` at their
          relative paths, writes a passing JUnit report to `$ADW_JUNIT_REPORT_PATH` and prints
          `1 scenarios (1 passed)`;
        – "the repository of that workflow has no scenarios configured" empties `scenariosMd`, so
          the scenario test phase skips and returns no proof.
    • THE SCREENSHOTS. Each screenshot is a fixture file with the extension named and bytes unique
      to it, for example its own relative path. Nothing here decodes an image. "also leaves the
      file {string}" adds a file that is not an image the same way. "the next scenario run for
      that workflow leaves only the screenshot {string}" changes what the command copies from then
      on.
    • THE STAND-IN REVIEW AGENT. Point `CLAUDE_CODE_PATH` at the claude-cli-stub, and write its
      manifest marker (`<worktree>/.adw-stub-manifest.json`) before each review, as feature-820's
      `writeReviewPassManifest` does. Clear the cached CLI path (`clearClaudeCodePathCache()`)
      before and after. The verdict must satisfy the review agent's output parser at once, so that
      no validation retry starts another agent:
        – "passes the review": `success: true` and no review issues;
        – "fails the review with the blocker {string}": `success: false` and one review issue of
          severity `blocker` with that description;
        – `screenshots` is empty, unless "the stand-in review agent's verdict lists the scenario
          proof file as its proof artifact". Then it holds the absolute path of the
          `scenario_proof.md` the scenario test phase reported, as Strategy A of `review.md` tells
          the reviewer.
    • THE SCREENSHOT STORE AND ITS SEAM. R2 is the one boundary replaced here, and the real
      `uploadToR2` must never run. The build gives the upload an injectable seam whose default is
      the real uploader, as `publishPrProof` takes `PublishDeps.uploader` today. Through it the
      steps install a stand-in that counts as configured. A seam that still consults
      `isR2Configured()` would leave the stand-in unused in a test run without R2 credentials,
      because that check reads environment constants fixed at import. The stand-in records the
      bytes of every upload and answers each with a URL of its own, for example
      `https://screenshots.example.test/<n>/<key>` for the n-th upload. "refuses the upload of
      {string}" makes it throw for that screenshot's bytes. The Background step only prepares the
      stand-in; the When steps install it for whichever phase the build has upload, and remove it
      afterwards.
    • THE RUN. "the scenario tests run and the review phase judges their proof" runs the real
      `executeScenarioTestPhase(config)`, then the real `executeReviewPhase(config, proofPath)`.
      `proofPath` is the `resultsFilePath` of the proof the scenario phase returned, or `''` when
      it returned none: what `runScenarioTestFixLoop` hands the review. "the scenario tests run
      again and the review phase judges their new proof" does the same once more. The patch the
      orchestrators run in between changes no screenshot and is left out. Record what the review
      phase returned, or the error it threw.
    • THE COMMENTS. "issue N received a comment headed {string}": a comment recorded on issue N
      whose first `## ` heading line contains the text. "the {string} comment on issue N" is the
      last such comment. "shows exactly these screenshots, each embedded as an image from a URL
      its upload returned": collect the sources of the comment's Markdown images
      (`![…](source)`). Each listed screenshot must have, among them, a URL returned for one of its
      uploads, and each source must be a URL returned for an upload of a listed screenshot.
      "embeds no image": the comment has no Markdown image. "still lists the blocker {string}":
      the body contains the description.
    • THE STORE. "received uploads of these screenshots and of nothing else": the bytes of every
      listed screenshot were uploaded at least once, and every recorded upload carries the bytes
      of a listed screenshot. "received no upload": no upload was recorded.
    • "the review phase returned a {word} verdict": the phase did not throw, and `reviewPassed` is
      `true` for "passing" and `false` for "failing".
    • HOOKS. Scope every hook to `@adw-937`. `After`: remove the stand-in store if a step left it
      installed, restore `CLAUDE_CODE_PATH` and clear the CLI path cache, and remove
      `agents/<adwId>` for every adwId used, and the throwaway worktrees.
    • REUSED, NOT REDEFINED. G18 is defined in `features/step_definitions/`, and T22 in the
      regression suite's `thenSteps.ts`. Redefining either is an AmbiguousStepDefinition.

  Vocabulary note. These registered phrases from `features/regression/vocabulary.md` are reused:
    • G18 `the ADW codebase is checked out`
    • T22 `the ADW TypeScript type-check passes`
  These registered phrases are deliberately NOT reused:
    • W4 `the review phase is executed with config {string}` is still pending, and runs the review
      phase alone. Here the scenario test phase runs first, because the screenshots are its
      output;
    • T2 and T3 read the requests the mock GitHub API recorded. Here the review phase comments
      through a recording issue tracker, and nothing goes over HTTP;
    • T-PY4 to T-PY6 drive the Python fixture's proof run and the pull request's proof comment,
      not the review comment on the issue.
  No unregistered phrase from another per-issue feature is reused. feature-820's "object storage
  is configured with a recording uploader" and "the review phase reported the review as passed",
  and feature-929's "a comment headed {string} was posted on issue {int}", are bound to those
  features' own worlds, so the wording here avoids them. The registry has no phrase for the
  following, so novel phrasing is introduced for them: the review workflow; the proof run's
  screenshots and other files; the repository without scenarios; the stand-in review agent's
  verdict; the screenshot store; the scenario-and-review run; the review comment and the images it
  embeds; the uploads the store received; and the review phase's verdict.

  Background:
    Given the ADW codebase is checked out
    And the screenshot store records every upload and answers each with a public URL of its own

  # ── §1 THE REVIEW COMMENT SHOWS THE SCREENSHOTS ────────────────────────────────────────────────

  @adw-937 @adw-axbb2a-bug-review-checks-st
  Scenario: A passing review whose proof run left screenshots shows every one of them in its Review Passed comment on the issue, each embedded from a URL its upload returned
    Given a review workflow for issue 9371 under adwId "shots937-pass" whose issue tracker records every comment
    And the scenario run for that workflow leaves these screenshots in its proof directory:
      | screenshot        |
      | checkout/cart.jpg |
      | login/step-1.png  |
      | login/step-2.png  |
      | overview.png      |
    And the stand-in review agent passes the review
    When the scenario tests run and the review phase judges their proof
    Then the review phase returned a passing verdict
    And issue 9371 received a comment headed "Review Passed"
    And the "Review Passed" comment on issue 9371 shows exactly these screenshots, each embedded as an image from a URL its upload returned:
      | screenshot        |
      | checkout/cart.jpg |
      | login/step-1.png  |
      | login/step-2.png  |
      | overview.png      |

  @adw-937 @adw-axbb2a-bug-review-checks-st
  Scenario: A failing review whose proof run left screenshots shows them in its Review Failed comment on the issue and still lists its blocker
    Given a review workflow for issue 9372 under adwId "shots937-fail" whose issue tracker records every comment
    And the scenario run for that workflow leaves these screenshots in its proof directory:
      | screenshot       |
      | login/step-1.png |
      | overview.png     |
    And the stand-in review agent fails the review with the blocker "The login form accepts an empty password"
    When the scenario tests run and the review phase judges their proof
    Then the review phase returned a failing verdict
    And issue 9372 received a comment headed "Review Failed"
    And the "Review Failed" comment on issue 9372 shows exactly these screenshots, each embedded as an image from a URL its upload returned:
      | screenshot       |
      | login/step-1.png |
      | overview.png     |
    And the "Review Failed" comment on issue 9372 still lists the blocker "The login form accepts an empty password"

  # ── §2 THEY ARE THE SCREENSHOTS OF THE PROOF THE REVIEW JUDGED ─────────────────────────────────

  @adw-937 @adw-axbb2a-bug-review-checks-st
  Scenario: Only the images the proof run left are uploaded and shown, not the scenario proof file the review agent lists as its proof artifact, nor a file in the proof directory that is not an image
    Given a review workflow for issue 9373 under adwId "only937-images" whose issue tracker records every comment
    And the scenario run for that workflow leaves these screenshots in its proof directory:
      | screenshot       |
      | login/step-1.png |
      | overview.png     |
    And the scenario run for that workflow also leaves the file "login/browser-console.log" in its proof directory
    And the stand-in review agent passes the review
    And the stand-in review agent's verdict lists the scenario proof file as its proof artifact
    When the scenario tests run and the review phase judges their proof
    Then the screenshot store received uploads of these screenshots and of nothing else:
      | screenshot       |
      | login/step-1.png |
      | overview.png     |
    And the "Review Passed" comment on issue 9373 shows exactly these screenshots, each embedded as an image from a URL its upload returned:
      | screenshot       |
      | login/step-1.png |
      | overview.png     |

  @adw-937 @adw-axbb2a-bug-review-checks-st
  Scenario: After a failed review the re-test's proof run replaces the screenshots, and the next review comment shows the new run's screenshots and none of the earlier run's
    Given a review workflow for issue 9374 under adwId "retest937-shots" whose issue tracker records every comment
    And the scenario run for that workflow leaves these screenshots in its proof directory:
      | screenshot       |
      | login/step-1.png |
      | login/step-2.png |
    And the stand-in review agent fails the review with the blocker "The login button does nothing"
    When the scenario tests run and the review phase judges their proof
    And the next scenario run for that workflow leaves only the screenshot "login/step-3.png" in its proof directory
    And the stand-in review agent passes the review
    And the scenario tests run again and the review phase judges their new proof
    Then the "Review Failed" comment on issue 9374 shows exactly these screenshots, each embedded as an image from a URL its upload returned:
      | screenshot       |
      | login/step-1.png |
      | login/step-2.png |
    And the "Review Passed" comment on issue 9374 shows exactly these screenshots, each embedded as an image from a URL its upload returned:
      | screenshot       |
      | login/step-3.png |

  # ── §3 A SCREENSHOT NEVER DECIDES OR BLOCKS THE REVIEW ─────────────────────────────────────────

  @adw-937 @adw-axbb2a-bug-review-checks-st
  Scenario: An upload the screenshot store refuses is left out, and the review comment is still posted with the other screenshots while the passing verdict stands
    Given a review workflow for issue 9375 under adwId "refused937-upload" whose issue tracker records every comment
    And the scenario run for that workflow leaves these screenshots in its proof directory:
      | screenshot        |
      | checkout/cart.jpg |
      | login/step-1.png  |
      | overview.png      |
    And the screenshot store refuses the upload of "checkout/cart.jpg"
    And the stand-in review agent passes the review
    When the scenario tests run and the review phase judges their proof
    Then the review phase returned a passing verdict
    And the "Review Passed" comment on issue 9375 shows exactly these screenshots, each embedded as an image from a URL its upload returned:
      | screenshot       |
      | login/step-1.png |
      | overview.png     |

  @adw-937 @adw-axbb2a-bug-review-checks-st
  Scenario: A proof run that leaves no screenshots gets the Review Passed comment it gets today, with no image, and nothing is uploaded
    Given a review workflow for issue 9376 under adwId "noshots937" whose issue tracker records every comment
    And the scenario run for that workflow leaves no screenshots in its proof directory
    And the stand-in review agent passes the review
    When the scenario tests run and the review phase judges their proof
    Then the review phase returned a passing verdict
    And issue 9376 received a comment headed "Review Passed"
    And the "Review Passed" comment on issue 9376 embeds no image
    And the screenshot store received no upload

  @adw-937 @adw-axbb2a-bug-review-checks-st
  Scenario: A repository with no scenarios configured has no proof run, and its review runs and comments as today, with no image, and nothing is uploaded
    Given a review workflow for issue 9377 under adwId "noscen937" whose issue tracker records every comment
    And the repository of that workflow has no scenarios configured
    And the stand-in review agent passes the review
    When the scenario tests run and the review phase judges their proof
    Then the review phase returned a passing verdict
    And issue 9377 received a comment headed "Review Passed"
    And the "Review Passed" comment on issue 9377 embeds no image
    And the screenshot store received no upload

  # ── §4 BACKSTOP ────────────────────────────────────────────────────────────────────────────────

  @adw-937 @adw-axbb2a-bug-review-checks-st
  Scenario: TypeScript type-check passes with the proof screenshots wired into the review comment
    Then the ADW TypeScript type-check passes
