---
status: accepted
date: 2026-10-04
recorded: 2026-10-04
provenance:
  - kind: transcript
    source: "Claude Code session 2dc3e364, 2026-10-01 to 2026-10-04"
supersedes: ["0022", "0043"]
superseded-by: []
---

# Every per-issue scenario image in a `web` repository is visual evidence; the reviewer judges it before the pull request exists

## Context and Problem Statement

[ADR-0061](0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md) gives every scenario in a `web` repository a screenshot. Two questions remain: which images count as evidence, and who sees them when.

Today (checked 2026-10-02 at `origin/dev`) images are harvested from `ADW_PROOF_DIR` and posted on the pull request after it opens (#580, [ADR-0022](0022-review-proof-in-r2-behind-router-worker.md)); since #937 the review phase also uploads every image in that directory on each review attempt and links them in the issue comment. The reviewer itself receives only the text of `scenario_proof.md`.

The decision covers the proof the reviewer reads, the images published on the issue and the pull request, and the scenario writer's obligations in a `web` repository.

## Decision Drivers

* The reviewer must see the evidence, not a description of it, and before the pull request opens.
* A floor the scenario writer cannot lower: the owner, on an opt-in tag, "Scenario writer could opt agains @visual because it is lazy."
* Regression scenarios prove nothing about the issue.

## Considered Options

For which images count: only scenarios the writer tags `@visual`, with a written justification when none is tagged; `@visual` without justification; every per-issue scenario image, no tag.

For a `web` issue whose scenarios produce no image: carry on with a stated line in the proof; a hard gate requiring one image; a gate conditional on the diff touching declared UI file patterns.

## Decision Outcome

* **Every `@adw-{issueNumber}` scenario's end-state image is evidence.** There is no `@visual` tag and no written justification. The owner's point that settled it: with the Playwright runner the tag no longer decided whether an image existed, only whether it was shown, so it was a decision the scenario writer could get wrong for no gain. Regression scenario images are discarded.
* **TypeScript selects the images**: tags from the feature file, image path from the JUnit `[[ATTACHMENT|...]]` line. Exactly those images go to the reviewer, into the issue comment of each review attempt, and onto the pull request. Nothing else from the output directory is published.
* **The reviewer sees the images and judges them**: do they show what the issue asked for, and do the scenarios really exercise the change. A scenario that ends on a page that does not show the change is the reviewer's to catch.
* **Zero images is allowed.** Verified in the spike on 2026-10-02: a scenario whose steps never take the `page` fixture (pure logic, or an HTTP call through `request`) passes and produces no image and no attachment. A `web` issue whose scenarios all do that continues; the proof states "no scenario opened a page"; the reviewer blocks if the diff changes anything a user can see. Rejected: a hard gate, because it is wrong for every backend-only issue in a web repository and would make the scenario writer open a page for no reason; a UI-file pattern list, because it is a per-repository knob that drifts.
* Baseline visual comparison (before and after images) is out of scope.

### Consequences

* Good, because the floor is mechanical: a web scenario that opens a page always yields evidence, and nothing the scenario writer omits can remove it.
* Good, because the reviewer judges the change with the image in front of it rather than a sentence about it.
* Bad, because the remaining gap, a UI change tested only through HTTP, is left to the reviewer's judgement of the diff, helped by one explicit line in the proof.
* Bad, because every per-issue scenario image is published, so a backend-leaning issue in a web repository can show pages that prove little.

### Confirmation

Implemented. Checked on 2026-10-07 in the working tree on top of `c8a88605`:

* The assembler: `adws/proof/proofAssembler.ts` (`assembleScenarioProof`, `fixedScenarioTags`, `shouldRunTag`) is pure. It selects the images of the `@adw-{issueNumber}` scenarios from the per-issue run's JUnit report, keeps only attachments that are images the artifacts directory holds, never takes an image from the `@regression` run, and selects none where the application profile expects no images (`cli`). The tags are fixed in code, `@regression` and `@adw-{issueNumber}`, both blocking. `adws/proof/featureScenarioIndex.ts` takes each scenario's tags from the feature files (Feature, Rule, scenario and, for an outline row, its Examples table) and gives it the test-case name that ADW's Playwright project (playwright-bdd 9.2.1, `@playwright/test` 1.63.0) gives it, because the JUnit names carry no tags; `adws/proof/featureFileReader.ts` reads the files. `adws/proof/proofDocument.ts` writes `scenario_proof.md` with the two lines, exported as `NO_SCENARIO_OPENED_A_PAGE` (a `web` proof with no selected image) and `NO_PER_ISSUE_SCENARIOS` (no scenario carries the issue's tag).
* The image paths: `TestCaseResult.attachments` in `adws/core/testReportParser.ts` holds the `[[ATTACHMENT|...]]` lines of a case's `<system-out>`, relative to the report's directory.
* The run: `runScenarioProof` in `adws/phases/scenarioProof.ts` indexes the feature files, runs `@regression` and, only when a scenario carries it, `@adw-{issueNumber}`, and returns `ScenarioProofResult.perIssueImages`. Where no scenario carries the issue's tag the tag is not run and is never a failure, so an issue without scenarios of its own (a chore, a promotion issue) passes; where scenarios carry it but the run reports no test case, the tag fails. Nothing on this path reads `.adw/review_proof.md` any longer.
* The upload: `uploadProofArtifacts` (`adws/proof/proofUploader.ts`) uploads only the images it is given. `uploadReviewedProofScreenshots` (`adws/phases/reviewPhase.ts`, the issue comment of each review attempt) and `publishPrProof` (`adws/proof/prProofPublisher.ts`, the pull request comment) pass `scenarioProof.perIssueImages`, so regression images and other files of the output directory are never published, and in a `cli` repository nothing is uploaded.
* The reviewer receives the absolute paths of the selected images in the `## Evidence` section of `scenario_proof.md`, which it already reads, and `ScenarioProofResult.perIssueImages` carries them for the review prompt.
* Unit tests: `adws/proof/__tests__/proofAssembler.test.ts`, `proofAssembler.images.test.ts` and `proofAssembler.scenarios.test.ts` (selection, exclusions, outline rows, both lines, outcomes); `featureScenarioIndex.test.ts`, `featureScenarioIndex.examples.test.ts` and `featureScenarioIndex.lookup.test.ts`; `featureFileReader.test.ts`; `proofUploader.test.ts`; `prProofPublisher.publish.test.ts` and `prProofPublisher.test.ts`; `adws/phases/__tests__/scenarioProofRun.test.ts` and `scenarioProofRun.evidence.test.ts` (real subprocesses); `reviewPhaseScreenshots.test.ts`; `adws/core/__tests__/testReportParser.test.ts`; `adws/core/__tests__/scenarioRunner.test.ts`.
* Scenarios: `features/per-issue/feature-994.feature` (`@adw-994`). Three run the proof assembler over reports a stand-in scenario runner wrote as ADW's Playwright project writes them. The others run the real `executeScenarioTestPhase`, `executeReviewPhase` and `executeProofPublishPhase`, with a stand-in scenario runner, review agent and screenshot store: exactly the per-issue images reach the store, the issue comment of each attempt, the pull request comment and the review agent's proof, in a `web` repository; none in a `cli` repository; and the gate cases for both tags and both repository types.
* One mechanical check: `grep -n "harvestProofArtifacts" adws/proof/proofUploader.ts adws/phases/reviewPhase.ts adws/proof/prProofPublisher.ts` returns nothing.

Still open, carried by `specs/prd/review-proof-redesign.md`: the review prompt that opens the images and judges them (the reviewer issue).

## More Information

* Supersedes, in part, ADR-0022: images are no longer "harvested, uploaded and inlined in a proof comment on the PR" wholesale after the pull request phase; they are selected per issue and reach the reviewer first. The storage (R2, router Worker, 30-day expiry) stands.
* Supersedes, in part, ADR-0043: its "Proof" bullet (every image in `ADW_PROOF_DIR` is harvested and published) is narrowed to per-issue scenario images.
* In a `cli` repository no image is expected and none is published; the mapping of ADR-0061 says so.
