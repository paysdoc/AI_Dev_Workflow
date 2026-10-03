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

Not yet implemented; carried by `specs/prd/review-proof-redesign.md`. Checked on 2026-10-02 at `origin/dev`: `adws/agents/reviewAgent.ts` passes the reviewer only the proof text path; `adws/phases/reviewPhase.ts` (`uploadReviewedProofScreenshots`) uploads every image in the artifacts directory without filtering by scenario.

## More Information

* Supersedes, in part, ADR-0022: images are no longer "harvested, uploaded and inlined in a proof comment on the PR" wholesale after the pull request phase; they are selected per issue and reach the reviewer first. The storage (R2, router Worker, 30-day expiry) stands.
* Supersedes, in part, ADR-0043: its "Proof" bullet (every image in `ADW_PROOF_DIR` is harvested and published) is narrowed to per-issue scenario images.
* In a `cli` repository no image is expected and none is published; the mapping of ADR-0061 says so.
