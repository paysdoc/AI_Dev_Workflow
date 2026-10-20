# PRD: `specs/` becomes worktree-only; ADRs and PRDs move to `docs/`

Decisions: a new ADR (to be recorded with the write-an-adr skill) will document the split between durable design records and per-run working files. Grill session 2026-10-20. Supersedes the "plan commit contains only the plan file" behaviour recorded for #930 in part.

## Problem Statement

Every ADW run writes an implementation plan under `specs/` and commits it to the branch, and every review patch writes a patch note there which the commit step sweeps in with `git add -A`. Nothing ever deletes them. Twenty months in, `specs/` holds 838 tracked files: 504 plans, 248 patch notes, 65 ADRs, 20 PRDs, one runbook and one stray grill note, 18 MB in all, and the directory has never had a single deletion.

Nobody reads a plan after its pull request merges. The build, review, patch, document and merge phases hand the plan to each other by path during the run, and after that it is dead weight. The GitHub issue holds only the first 2,000 characters of it, which in practice is the metadata block, so the issue is not an archive either.

The cost is paid on every agent spawn. The prime command runs `git ls-files`, and `specs/` is more than half the bytes of that listing: roughly 17,000 tokens of plan file names injected into every primed agent, in this repository and in every target repository ADW runs on. Humans navigating the tree pay too. The ADRs and PRDs that do deserve to live forever are buried in the same directory as the noise, and the only thing that distinguishes them is a subdirectory.

The living-docs cleanup already done for `app_docs/` (#810) works: the conditional-docs index went from 70 entries to 47 and has only grown organically since, with the gate green. `specs/` had no equivalent discipline.

## Solution

Split the directory by lifetime. Durable design records, the ADRs and PRDs, move to a new top-level `docs/` parent and stay tracked. `specs/` keeps its role as the per-run working directory for plans, but it is ignored by git, so plans and patch notes exist only in the worktree that produced them and vanish with it.

The ignore is applied at runtime by the worktree setup, not by a static line committed ahead of a release: the pipeline host runs main, and a `specs/` ignore on dev while main still commits plans would make `git add` of the plan fail on every run. Shipping the ignore in the same code that stops committing the plan makes the two atomic.

Historical plans and patch notes are deleted in one sweep. Nothing archives plans afterwards beyond the comment summary that already exists; no plan has ever been read after merge.

The docs-index gate keeps checking that every decision an app_doc cites exists as a record, now under the new parent. Because the pipeline host runs main while the gate's code hardcodes the record directory, the move must be released to the host before the next daily sweep, or the sweep files a false violation issue that ADW would pick up.

## User Stories

### Context cost

1. As an operator, I want primed agents to stop receiving hundreds of dead plan file names in their file listing, so that every spawn spends its context on the code.
2. As an operator, I want the same reduction in every target repository ADW runs on, so that the saving is pipeline-wide and not a one-off cleanup here.
3. As a developer reading the repository, I want `specs/` to contain only the plans of runs in flight on this machine, so that the directory tells me what is happening now.

### Durable records

4. As a developer, I want ADRs under `docs/adr/`, so that decision records sit apart from working files.
5. As a developer, I want PRDs under `docs/prd/`, so that product requirements sit apart from working files.
6. As a developer, I want every link to an ADR or PRD in app_docs, READMEs, prompts, skills, feature files and the conditional-docs index rewritten to the new parent, so that no link in the repository dangles.
7. As a developer, I want the docs-index gate to check decision records under the new parent, so that the gate keeps proving app_docs and ADRs agree.
8. As a developer, I want the `write-an-adr` and `write-a-prd` skills to write to the new parent, so that new records land in the right place without anyone remembering.
9. As a developer, I want the `prd-to-issues` skill to cite PRDs by their new path, so that issues filed from a PRD point at a file that exists.
10. As a developer, I want the provenance line in the ADR that cites the deleted runbook to name its last tracked path, so that the ADR still says where its source came from.
11. As a developer, I want links in already-closed issues to the old paths left as they are, so that the move does not generate hundreds of comment edits.

### Working files

12. As an operator, I want the plan written to `specs/` in the worktree and never committed, so that branches and dev carry no plan files.
13. As an operator, I want `specs/` appended to the tracked `.gitignore` of a repository the first time ADW creates a worktree there, so that every repository ADW touches gets the ignore without configuration.
14. As an operator, I want the ignore delivered only by the worktree setup code, so that the old host keeps committing plans successfully until the new code is released.
15. As an operator, I want the plan-commit step and its "Committing Plan" issue comment gone, so that the workflow does not report a step that no longer exists.
16. As an operator, I want the review patch agent to write no file under `specs/`, so that patch notes never reach the worktree, let alone git.
17. As a reviewer, I want the pull request body to stop linking the plan file, so that the PR carries no link to an uncommitted path.
18. As an operator, I want conflict resolution to stop looking for a plan in the incoming branch's `specs/`, so that it falls straight back to the PR body and the commit log, which exist.
19. As an operator, I want a resumed workflow whose worktree was removed to park with a reason that says the plan was lost with the worktree, so that I restart it deliberately instead of the planner silently producing a second plan against partially built code.
20. As an operator, I want the build, review, document and merge phases to keep reading the plan by path from the worktree during a run, so that the hand-off between phases is unchanged.

### Historical sweep

21. As a developer, I want all 504 historical plan files and all 248 patch notes deleted from dev in one chore, so that the directory shrinks to the records that matter.
22. As a developer, I want the runbook and the stray grill note under `specs/` deleted with them, so that nothing but ADRs and PRDs needs a new home.
23. As an operator, I want in-flight branches to keep their own plan file across that deletion, so that no running workflow loses its plan when dev merges in.

### Release safety

24. As an operator, I want the record move to be released to the pipeline host the same day it merges, so that the host's daily docs-index sweep, which runs main's code against dev's content, does not file a false "unknown decision record" issue.
25. As an operator, I want the record-move issue gated for human merge, so that an unattended merge at night cannot outrun the release.
26. As an operator, I want a resume that reads the plan path out of issue comments to recognise the current plan file name, so that resume recovery is not silently limited to the pre-2026 name. This is a pre-existing bug found during the grill and is filed on its own.

## Implementation Decisions

### Directory layout

- A new top-level `docs/` parent holds `adr/` and `prd/`. The ADR index README moves with the records.
- `specs/` remains the working directory for plans in a worktree. The plan-locating helpers keep their current search behaviour; only git's view of the directory changes.
- `app_docs/` is unchanged. The feature-doc regex matches only files directly under it, so `docs/` does not interact with the living-docs sweep.

### Reference rewrite

- Every reference to the old record paths in TypeScript, prompts, skills, feature files, app_docs links, the two READMEs and the conditional-docs index is rewritten mechanically. The conditional-docs entry that owns `specs/**` becomes the owner of `docs/**`.
- The decisions module and the docs-index gate derive the record directory from one constant, so a future move touches one place.
- The feature-940 steps that copy the real record directory into a fixture copy the new path.

### Ignore delivery

- The worktree setup already has an idempotent "append an entry to the tracked `.gitignore`" helper, used today for other entries. It gains `specs/` as one more entry. The change lands once per repository in whichever issue's PR first creates a worktree after release.
- No static `specs/` line is committed to any `.gitignore` ahead of that code being released. This repository's own `.gitignore` receives the line through the same runtime path.

### Plan lifecycle

- The plan phase stops calling the plan-only commit helper; the helper and its guard are deleted along with the "Committing Plan" comment. The plan still lands in the worktree and the plan-created comment still carries its path and 2,000-character summary.
- The patch prompt instructs the agent to return its patch in the response only. The patch phase already forwards the response text to the build agent; nothing reads a patch file.
- The pull request prompt drops the plan link from the PR body.
- The conflict-resolution prompt drops the step that inspects the incoming branch's `specs/` with `git show`; its fallback order becomes local plan, PR body, commit log and diff stat.
- When a phase that requires the plan finds none on a resumed workflow, the workflow parks with a distinct reason naming the lost worktree. The exhaustive stage classifier gains that reason. The planner is never re-run implicitly.

### Historical sweep and sequencing

- One chore removes every tracked plan, patch note, the runbook and the stray note from dev. In-flight branches added their own plan on the branch, so a merge of dev into them deletes other issues' files and keeps theirs.
- Ordering: the record move and sweep ship first, gated for human merge, followed the same day by a release of main from dev and a host restart. The pipeline-behaviour change ships second. If the release cannot follow the move within a day, a small preceding change teaches the decisions module to accept both the old and new record directories, and is released before the move.

## Testing Decisions

A good test exercises what an operator or a later phase observes: which files are tracked on the branch after a phase, what the gate reports for a given tree, what the workflow's recorded stage is after a resume. It does not assert which helper was called.

- The decisions module and docs-index gate: existing unit tests are repointed at the new record directory and extended with a tree that still has records under the old path, which must now be reported as unknown.
- Worktree setup: a unit test that a fresh worktree ends with `specs/` in its tracked `.gitignore`, and that a second setup does not duplicate the line. Prior art: the existing gitignore-append tests for that module.
- Plan phase: the nine feature-930 regression scenarios that prove the plan commit contains only the plan file are retired and replaced by one scenario proving that after the plan phase the branch has no commit touching `specs/` and the worktree holds the plan. The row-09 surface expectation that the commit "adds only a plan file" is updated to match.
- Resume: a regression scenario where a worktree is removed between phases and the workflow is resumed, asserting the park reason and that no second plan-created comment appears. Prior art: the orchestrator-resilience scenarios for takeover and abandoned recovery.
- Prompts: the patch, pull-request and conflict-resolution prompt changes are covered by the existing stub-manifest surface rows, updated so the patch row records no file write.
- Reference rewrite: the docs-index gate itself is the test. It must be green after the move, with zero dangling links, and the CI job runs it on the PR.

## Out of Scope

- Any change to `app_docs/` or to the living-docs convergence machinery beyond the one owning-glob entry.
- Archiving plans anywhere after a run. The comment summary that exists today is the only trace, by decision.
- Editing closed issues or pull requests whose bodies link the old paths.
- Changing where the plan is written inside the worktree, or the plan-locating helpers' search rules.
- Shrinking repository history. Deleted files remain in history.
- Teaching target repositories about `docs/`. Only this repository holds ADRs and PRDs; target repositories receive only the `specs/` ignore.

## Further Notes

- Facts established during the grill, each checked at the time: 838 tracked files under `specs/`, 53% of the `git ls-files` byte count; 31 of 504 plans exceed GitHub's comment size cap, which is why posting full plans as comments was rejected; the plan-only commit helper runs `git add` without force, and `git add` of an ignored path exits 1; the docs-index sweep builds its worktree from the remote default branch and runs whatever code the host runs.
- The comment-parsing regex that recovers a plan path for resume matches only the pre-2026 `issue-N-plan.md` name. That bug predates this PRD and is filed separately (user story 26).
- A follow-up ADR should record the lifetime split and the `docs/` parent, superseding in part the #930 plan-commit decision.
