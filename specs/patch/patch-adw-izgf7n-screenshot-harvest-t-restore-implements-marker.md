# Patch: Restore the bare `Implements #<issueNumber>` PR-body marker in pull_request.md

## Metadata
adwId: `izgf7n-screenshot-harvest-t`
reviewChangeRequest: `Issue #1: Out-of-scope regression in .claude/commands/pull_request.md. Branch commit afe5333 (nominally just the #580 plan) collapsed the PR-body issue-reference block and deleted the bare Implements #<issueNumber> marker, which is present at the merge-base and on origin/dev (verified: marker count merge-base=1, origin/dev=1, HEAD=0). This fails the contract-guard unit test adws/__tests__/prTemplateMarker.test.ts — the only failing test, 1298/1299 otherwise pass — whose docstring states that dropping this marker silently disables ADW's linked-PR detectors (hitlBoardNotifier, linkedPrDetector) and the per-issue scenario retention clock (perIssueScenarioSweep) for every normal SDLC PR. It is unrelated to the screenshot-harvest feature and would regress production behavior on merge. Resolution: Revert the out-of-scope edit in pull_request.md: restore the two-line issue-reference block as on origin/dev — the Closes [repoOwner/repoName]#<issueNumber> closing keyword AND the bare Implements #<issueNumber> marker on its own line. This re-greens prTemplateMarker.test.ts and restores HITL notifications + scenario retention.`

## Issue Summary
**Original Spec:** `specs/issue-580-adw-izgf7n-screenshot-harvest-t-sdlc_planner-screenshot-harvest-proof-comment.md`

**Issue:** Commit `afe5333` on this branch (nominally just the #580 screenshot-harvest plan) made an out-of-scope edit to `.claude/commands/pull_request.md`: it collapsed the three-line PR-body issue-reference block into a single line, deleting the bare `Implements #<issueNumber>` marker. That marker is the literal string ADW's linked-PR detectors (`hitlBoardNotifier`, `linkedPrDetector`) and the per-issue scenario retention clock (`perIssueScenarioSweep`) match on for every normal SDLC PR. Its removal fails the contract-guard unit test `adws/__tests__/prTemplateMarker.test.ts` (the only failing test — 1298/1299 otherwise pass) and would silently regress HITL notifications + scenario retention on merge. Verified marker counts: merge-base = 1, origin/dev = 1, HEAD = 0.

**Solution:** Revert the file to its `origin/dev` state, restoring the three-line "emit BOTH markers" block — the `Closes [repoOwner/repoName]#<issueNumber>` closing keyword AND the bare `Implements #<issueNumber>` marker on its own line. The `origin/dev...HEAD` diff for this file is a single hunk, so restoring the file to `origin/dev` is byte-for-byte exactly this revert and touches nothing else. This re-greens `prTemplateMarker.test.ts` (both assertions: `toContain('Implements #<issueNumber>')` and the `Closes` regex) and restores production HITL/retention behavior.

## Files to Modify
Use these files to implement the patch:

- `.claude/commands/pull_request.md` — restore the issue-reference bullet (lines ~25) to the origin/dev three-line form. **This is the only file changed by the patch.**

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Revert pull_request.md to its origin/dev state
- The `git diff origin/dev...HEAD -- .claude/commands/pull_request.md` is a single hunk (the regression), so the cleanest, lowest-risk fix is to restore the whole file from origin/dev:
  - `git checkout origin/dev -- .claude/commands/pull_request.md`
- This guarantees the file matches `origin/dev` exactly — the literal requirement of the review ("restore ... as on origin/dev") — with no risk of reproducing the marker text by hand incorrectly.
- **Fallback (if a surgical edit is preferred over the checkout):** replace the single regressed bullet:
  - FROM (current HEAD):
    ```
      - Reference to the issue: if `repoOwner` and `repoName` are provided and non-empty, use `Closes repoOwner/repoName#<issueNumber>`; otherwise use `Closes #<issueNumber>`
    ```
  - TO (origin/dev — three lines):
    ```
      - Reference to the issue using BOTH markers on their own lines (the first lets GitHub auto-close the issue on merge; the second is the bare marker ADW's linked-PR detectors match on — emit both):
        - A closing keyword: if `repoOwner` and `repoName` are provided and non-empty, use `Closes repoOwner/repoName#<issueNumber>`; otherwise use `Closes #<issueNumber>`
        - `Implements #<issueNumber>` (always the bare same-repo form, even for cross-repo issues)
    ```
- Do NOT touch any other file (e.g. `.claude/skills/grill-me/SKILL.md` and the `adws/` feature files are in scope for #580 and out of scope for this patch).

### Step 2: Confirm the file now matches origin/dev with no leftover divergence
- `git diff origin/dev...HEAD -- .claude/commands/pull_request.md` must produce **no output** (the file is identical to origin/dev).

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `git diff origin/dev...HEAD -- .claude/commands/pull_request.md` — expect empty output (file restored to origin/dev exactly).
- `grep -c "Implements #<issueNumber>" .claude/commands/pull_request.md` — expect `1` (marker restored).
- `bunx vitest run adws/__tests__/prTemplateMarker.test.ts` — the previously-failing contract guard now passes (both `it` blocks green).
- `bun run test:unit` — full Vitest suite is green (expect all 1299 passing; the patch only un-breaks the 1 failing test and changes nothing else).

## Patch Scope
**Lines of code to change:** ~3 lines in one markdown file (1 line → 3 lines; net +2), or a one-command file checkout.
**Risk level:** low — documentation/prompt-template revert to a known-good origin/dev state; single isolated hunk; no TypeScript or runtime code touched.
**Testing required:** Re-run the contract-guard unit test `adws/__tests__/prTemplateMarker.test.ts` and the full `bun run test:unit` suite to confirm 1299/1299 green with zero new failures.
