---
status: accepted
date: 2026-03-24
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-274-adw-nnn7js-r2-upload-utility-sc-sdlc_planner-r2-upload-screenshot-router.md
  - kind: contemporaneous
    source: specs/issue-278-adw-r4f0gi-application-type-con-sdlc_planner-app-type-screenshot-upload.md
  - kind: contemporaneous
    source: specs/issue-324-adw-mi7p5k-chore-add-github-act-sdlc_planner-deploy-workers-ci.md
  - kind: contemporaneous
    source: specs/issue-332-adw-avb4f5-github-actions-worke-sdlc_planner-deploy-workers-github-actions.md
  - kind: contemporaneous
    source: specs/issue-580-adw-izgf7n-screenshot-harvest-t-sdlc_planner-screenshot-harvest-proof-comment.md
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
supersedes: []
superseded-by: []
---

# Proof images stored in R2 and served by a router Worker

## Context and Problem Statement

The review phase produced screenshots as proof that a change works, but they existed only in the worktree. The spec for #274 states the problem: proofs "are lost when worktrees are cleaned up" and cannot be embedded in issue or pull request comments as stable URLs.

The decision covers `adws/r2/`, `adws/proof/`, the proof publish phase, `workers/screenshot-router/` and `.github/workflows/deploy-workers.yml`.

## Considered Options

* Static R2 bindings in `wrangler.toml`, one per bucket.
* The S3-compatible API with credentials held as Worker secrets, and the bucket name derived from the request path.

For the choice of R2 itself and of a bucket per repository: none recorded.

## Decision Outcome

Chosen option: "the S3-compatible API", because static bindings need one entry per repository bucket, which "does not scale" (`wrangler.toml`, spec for #274).

* Images go to one bucket per repository, named `adw-{owner}-{repo}`, created on first upload in the EU with a lifecycle rule that expires objects after 30 days.
* `uploadToR2` returns a public URL, `https://screenshots.paysdoc.nl/{repo}/{key}`. The `screenshot-router` Worker maps the path to the bucket and streams the object. A daily cron in the same Worker deletes empty `adw-*` buckets.
* Upload is non-fatal: a failed upload is logged and the workflow continues.
* Workers are deployed by GitHub Actions on push to `main` when files under `workers/` change. #324 discovered Workers dynamically; #332 replaced that on the same day with one explicit job per Worker using `cloudflare/wrangler-action@v3`. The spec for #332 gives no reason for the change.

The consumer changed. #278 uploaded review screenshots for target repositories of application type `web`. By #580 (2026-06-16) the module had "zero production call sites". #580 wired it to the BDD run instead: images written to `ADW_PROOF_DIR` are harvested, uploaded under `proof/{adwId}/` and posted with the JUnit summary as a pull request comment, after the pull request phase.

### Consequences

* Good, because proof outlives the worktree and can be embedded in a comment.
* Good, because a new target repository needs no Worker change.
* Bad, because the URLs are public: the Worker's fetch handler has no authentication.
* Bad, because images expire after 30 days, so older pull request comments lose their images.
* Bad, because the Worker hardcodes the owner `paysdoc`; another organisation needs a change to the URL scheme (noted in the spec for #274).
* Bad, because ADW itself is a CLI and produces no images, so the image path is exercised only on target repositories with a UI.

### Confirmation

Checked on 2026-09-29:

* `adws/r2/bucketManager.ts` creates the bucket with `LocationConstraint: 'EU'` and a 30-day expiry rule.
* The only caller of `uploadToR2` is `adws/proof/prProofPublisher.ts`; `executeProofPublishPhase` is wired into `adwSdlc.tsx`, `adwPlanBuildTest.tsx` and `adwPlanBuildTestReview.tsx`.
* `workers/screenshot-router/wrangler.toml` routes `screenshots.paysdoc.nl/*` and sets the cron `0 3 * * *`. The hostname resolves.
* Unit tests exist for `adws/proof/`. None exist for `adws/r2/` or for the Worker.

## More Information

* The `cost-api` Worker shares the layout and the deploy workflow; see [ADR-0026](0026-cost-computed-locally-persisted-in-d1.md). DNS for the hostnames is covered by [ADR-0030](0030-cloudflare-dns-managed-by-hand.md). The review became a passive judge under [ADR-0031](0031-active-test-phase-passive-review-judge.md); a comment in `adws/adwSdlc.tsx` as of commit 7c65081b says it "no longer produces images". Whether that is why #278's call site disappeared was not checked.
* The spec for #274 names a parent PRD, `specs/prd/prd-review-revamp.md`. That file is not in the repository or its history.
