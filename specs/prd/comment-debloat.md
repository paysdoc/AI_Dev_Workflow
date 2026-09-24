# Comment De-bloat and Comment Discipline

## Problem Statement

The ADW codebase is written almost entirely by ADW's own agents, and those agents comment heavily. Measured on the current `main`: roughly 8,800 of 61,700 lines under the workflow source tree are comment lines, and the per-issue feature files are one fifth comment by line count. Blame by commit-message prefix on the heaviest files shows the comment lines are overwhelmingly agent-authored (for one trigger file, 117 of 131 comment lines; for one per-issue feature file, all 213).

Most of that volume carries nothing the code does not already say. The dominant kinds are:

- Section banner lines made of dashes or box-drawing characters, hundreds of them.
- JSDoc blocks that restate the name of the field or function they sit on.
- Inline narration of the statement immediately below it.
- Issue-number tags appended to otherwise ordinary comments, duplicating what git blame already records.
- Multi-paragraph essays inside `.feature` files explaining what a scenario row is for, when the scenario title and steps are supposed to be the explanation.

The cost is real: every agent that reads a file pays for those lines in context, and every human skimming a diff has to find the code between the prose. The comments that do matter, the ordering invariants and the reasons a non-obvious choice was made, are buried in the same visual weight as the noise.

The root cause is two lines in the project's coding guidelines that instruct agents to "use comments to explain non-obvious logic" and to "document public APIs and non-obvious logic with JSDoc". Agents over-apply both. Deleting the comments without changing that instruction would be a symptom fix; the volume would return within weeks of normal pipeline operation.

## Solution

Two things, in this order.

**First, stop producing the noise.** Rewrite the two guideline lines so that agents comment only what the code cannot say (invariants, ordering constraints, the reason behind a non-obvious choice), never restate the next line, never add banners, never cite issue numbers, and never JSDoc something whose name already says what it is. Add a parallel rule to the scenario-writer prompt: feature files carry no commentary, scenario titles and steps are the explanation, with at most one short line under `Feature:` if a domain term is not self-evident. Ship, in the same change, a comment-only guard: a check that proves a set of files differs from a base ref only in comments, so the sweep that follows can be verified mechanically rather than by eye.

**Second, sweep the existing comments.** File one chore issue per batch of roughly forty files or a thousand comment lines, whichever comes first, every batch blocked on the guideline issue. Each batch deletes the noise categories outright, trims mixed comments down to their rationale, reduces orchestrator file headers to a usage line plus the environment-variable list, and keeps shebangs and lint directives. Each batch's own acceptance scenario is that the comment-only guard passes for its listed files against the default branch. Batches auto-merge on that guard; the trimming judgement inside mixed comments is deliberately unsupervised, with git history as the recovery path.

## User Stories

1. As an ADW maintainer, I want the coding guidelines to say precisely which comments are wanted and which are not, so that pipeline agents stop generating narration, banners, and issue tags on every future issue.
2. As an ADW maintainer, I want the scenario-writer prompt to forbid commentary in feature files, so that per-issue scenarios are readable as scenarios rather than as essays with Gherkin attached.
3. As an ADW maintainer, I want the guideline change to land before any sweep begins, so that the sweep is not racing against agents still producing the old style.
4. As an ADW maintainer, I want a comment-only guard that proves a set of files differs from a base ref only in comments, so that a comment sweep can be trusted to have touched no code.
5. As an ADW maintainer, I want the guard to treat a TypeScript file's non-trivia token stream as the thing that must be unchanged, so that whitespace and blank-line shifts caused by deletion do not count as changes.
6. As an ADW maintainer, I want the guard to treat a feature file's non-blank, non-comment lines as the thing that must be unchanged, so that a trimming agent that mangles a step line is caught.
7. As an ADW maintainer, I want the guard to recognise that a `#` inside a step's text is not a comment, so that steps mentioning issue numbers or headings are not misread.
8. As an ADW maintainer, I want the guard to name every file that fails, so that a failing batch tells the agent exactly what to fix.
9. As an ADW maintainer, I want the guard runnable as a package script taking a base ref and a file list, so that I can run it by hand on any branch.
10. As an ADW maintainer, I want the guard's core importable as a plain function, so that a per-issue BDD step can call it without shelling out.
11. As an ADW maintainer, I want the guard's core to be pure with no filesystem or git access, so that it can be exercised on in-memory fixture pairs.
12. As an ADW maintainer, I want the sweep split into batches sized under the build agent's thirty-minute watchdog and context ceiling, so that no batch is left half-done by a timeout.
13. As an ADW maintainer, I want every sweep issue to list its exact files, so that the cron's region-overlap check lets disjoint batches run in parallel and serialises any that overlap.
14. As an ADW maintainer, I want every sweep issue blocked on the guideline issue, so that I can file the whole set at once and the pipeline sequences it.
15. As an ADW maintainer, I want banner divider comments deleted, so that section structure comes from the code's own ordering rather than from ASCII art.
16. As an ADW maintainer, I want JSDoc blocks that only restate a name deleted, so that the remaining JSDoc is the JSDoc worth reading.
17. As an ADW maintainer, I want inline narration of the following statement deleted, so that the statement speaks for itself.
18. As an ADW maintainer, I want issue-number tags stripped from comments, so that history lives in git blame and not in prose that goes stale.
19. As an ADW maintainer, I want mixed comments trimmed to their rationale rather than deleted or kept whole, so that invariants survive without the narration around them.
20. As an ADW maintainer, I want orchestrator file headers reduced to the usage line and the environment-variable list, so that the phase list, which restates the calls below it, is gone.
21. As an ADW maintainer, I want shebang lines and lint directives preserved by every sweep, so that entrypoints still execute and lint still passes.
22. As an ADW maintainer, I want feature-file commentary removed down to at most one short line under `Feature:`, so that per-issue scenarios read as scenarios.
23. As an ADW maintainer, I want each sweep batch's acceptance scenario to be the guard passing on its listed files, so that the pipeline's own scenario loop enforces safety without a human gate.
24. As an ADW maintainer, I want sweep batches to auto-merge on the guard rather than wait for my approval, so that fifteen PRs do not sit in a queue waiting on me.
25. As an ADW maintainer, I want the sweep to cover every code directory, including hooks, test infrastructure, workers, scripts, and unit-test files, so that the result is consistent across the repository.
26. As an ADW maintainer, I want the file-sizing and directory split for the batches derived from measured comment counts, so that the batches are balanced rather than one per directory regardless of size.

## Implementation Decisions

**Guideline wording.** The two existing lines in the coding guidelines are replaced with a single Comments entry: comment only what the code cannot say, meaning invariants, ordering constraints, and the reason a non-obvious choice was made; never restate what the next line does; never add section banners; never cite issue numbers because git blame carries history; do not JSDoc a field or function whose name already says what it is. The scenario-writer prompt gains: feature files carry no commentary, scenario titles and steps are the explanation, at most one short line under `Feature:` if the domain term is not self-evident.

**Ordering.** The guideline change, the scenario-writer rule, and the guard ship together in one issue. All sweep issues declare that issue in their `Blocked by` section. The open PR and issue queue was verified empty at design time, so no in-flight branch will re-merge stale comments through conflict resolution; no change to the conflict-resolution prompt is made.

**Guard architecture.** Two layers. The core is a pure `normalize(source, kind)` function where kind is `ts` or `feature`. For TypeScript it uses the TypeScript compiler's scanner to emit the token stream with all trivia (comments and whitespace) dropped. For Gherkin it emits the non-blank lines with leading-`#` comment lines removed and each line trimmed; a `#` that is not the first non-whitespace character on a line is content. The shell reads each listed file from the working tree and from the base ref, normalises both, and reports every file whose normalised forms differ. It is exposed as a package script taking a base ref and a file list, and as an importable function for the per-issue step definitions. This mirrors the shape of the existing git-CLI guard and docs-index health checks.

**Deletion rules per comment kind.** Banner lines: delete. JSDoc that restates its target's name: delete. Narration of the next statement: delete. Issue-number tags: strip from the comment, keep the rest if any rationale remains. Mixed comments: keep only the sentences carrying an invariant, ordering constraint, or reason; drop the narration sentences. Orchestrator entrypoint headers: keep the usage line and the environment-variable list, delete the numbered phase list. Shebangs and `eslint-disable` directives: always keep. Feature files: delete all `#` comment lines except at most one short line directly under `Feature:`.

**Batching.** Batches are capped at roughly forty files or a thousand comment lines, whichever is hit first. Measured counts at design time put the core directory at 128 files and about 2,800 comment lines (splits into three), per-issue features at 39 files and about 2,600 lines (splits into three by issue-number range), triggers at about 1,750 lines (splits into two), phases at about 1,200 lines (one or two), and the remaining directories small enough to batch alone or lump together. Each issue body carries a `Relevant Files` section with the exact file list, which the cron uses for region-overlap serialisation, and a `Blocked by` section naming the guideline issue. Concurrency is the repo's existing limit of five, so the set runs in about three waves.

**Merge policy.** Sweep issues carry no `hitl` label. The chore path pre-approves and the cron merges once the batch's scenarios pass. The Haiku diff gate may classify comment-only TypeScript changes either way; if it escalates, the review path runs against a spec that says delete comments, which is acceptable.

**No permanent lint gate.** Categories detectable mechanically (banners, issue tags in comments) are not added to CI. The guideline change is the only regrowth control; a gate is revisited only if regrowth is observed.

## Testing Decisions

A good test here asserts on what the guard reports for a given input pair, never on how normalisation is implemented. Fixture pairs are in-memory strings passed to the pure core; nothing touches git or the filesystem for the core tests.

**Guard core, tested via BDD scenarios tagged to the guideline issue:**

- A TypeScript pair differing only in comments, blank lines, and JSDoc normalises equal.
- A TypeScript pair where one token differs normalises unequal, and the report names the file.
- A feature-file pair differing only in `#` comment lines normalises equal.
- A feature-file pair where a step line changed normalises unequal.
- A feature-file step containing `#` mid-line is treated as content: removing it changes the normalised form.

**Guard shell:** not tested in isolation. It is exercised by every sweep batch's acceptance scenario, which runs the guard against the default branch for the batch's listed files. Fifteen batches give it fifteen live runs.

**Sweep batches:** each batch's per-issue scenario is exactly one behaviour: the comment-only guard passes for the files listed in the issue against the default branch. Prior art for this kind of per-issue source-linting step exists throughout the per-issue step definitions.

**Prior art:** the git-CLI guard check and the docs-index health check are the same script-plus-library shape and have the same CI and per-issue usage pattern.

## Out of Scope

- Markdown files anywhere: specs, plans, app docs, command prompts, skill files, READMEs.
- The `resolve_conflict` prompt. The queue was empty at design time so the conflict-resolution regrowth path does not apply.
- A permanent CI lint for banner lines or issue tags in comments.
- Human review of trimming judgement. Mixed-comment trims land unsupervised; git history is the recovery path.
- Rewriting rationale comments for clarity. The sweep trims and deletes; it does not improve the prose it keeps.
- Any change to what the JSDoc that survives says. If a JSDoc block carries non-inferable information it stays as is.
- Target repositories onboarded via `adw_init`. The coding-guideline template shipped to them is unchanged by this PRD; propagation is a separate decision.

## Further Notes

- The measurement baseline: about 8,800 comment lines under the workflow tree, about 1,500 under feature files, about 1,600 in step definitions, 1,571 JSDoc blocks, 434 banner lines, 192 comment lines citing an issue number. These are the numbers the batches were sized from; the sweep issues should re-measure at filing time.
- Nothing in the repository consumes JSDoc: no typedoc, no JSDoc lint plugin. Removing JSDoc affects readers only.
- No BDD step definition asserts on comment text in source. This was checked by grep for comment-marker literals in step files; an unconventional pattern could have been missed.
- The trim rule for mixed comments is the only part of the sweep that requires judgement. Everything else is either a pure deletion or covered by the guard.
