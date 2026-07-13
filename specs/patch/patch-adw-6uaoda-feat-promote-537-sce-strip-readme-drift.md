# Patch: Strip unrelated README.md drift from the #760 promotion PR

## Metadata
adwId: `6uaoda-feat-promote-537-sce`
reviewChangeRequest: `Issue #1: Commit 91542bd9 (the plan commit) contains out-of-scope README.md changes unrelated to promoting the #537 scenario. It rewrites two 'Scenario promotion sweep' paragraphs to describe trigger_cron.ts dispatch / PROMOTION_SWEEP_INTERVAL_CYCLES, and adds tree entries for perIssueSweepPersist.ts, features/regression/multilang/, and features/regression/upgrade/. The spec forbids this in multiple places ('Relevant Files' caution, Task 8, and Acceptance Criteria: 'The commit/PR contains only this feature's paths — no unrelated README.md drift'). This is the classic non-scoped git add sweeping in pre-existing working-tree drift the plan itself warned against. Mitigating fact: the documented code already exists on origin/dev, so the docs are accurate catch-up rather than wrong — but they belong to other work, not #760, and misattributing them into a hitl-approved hashing-promotion PR violates the scoped-commit acceptance criterion. Separately, the ONE in-scope README change the spec anticipated (adding a features/regression/hashing/ tree entry, mirroring how #729 added upgrade/) is absent.
Resolution: Restore README.md to origin/dev to strip the out-of-scope drift: run git checkout origin/dev -- README.md. Optionally add ONLY the single features/regression/hashing/ tree entry under the features/ tree listing (mirroring the existing upgrade/ line), then commit the restore on top of the branch. The result must leave the PR's README diff containing at most that one hashing/ line and none of the promotion-sweep / perIssueSweepPersist.ts / multilang/ / upgrade/ drift.`

## Issue Summary
**Original Spec:** `specs/issue-760-adw-6uaoda-feat-promote-537-sce-sdlc_planner-promote-537-hashcomputer-regression.md`

**Issue:** The plan commit `91542bd9` swept in **pre-existing, unrelated** `README.md` working-tree drift that does not belong to #760. `git diff origin/dev -- README.md` shows exactly five drift hunks / four documented items — all describing *other* work already on `origin/dev`:
- Two "Scenario promotion sweep" paragraph rewrites (feature-bullet ~L26 and the prose ~L326) that add `trigger_cron.ts` dispatch / `PROMOTION_SWEEP_INTERVAL_CYCLES` cron-cadence detail.
- A `perIssueSweepPersist.ts` entry in the `adws/triggers/` tree listing.
- A `features/regression/multilang/` entry in the `features/` tree listing.
- A `features/regression/upgrade/` entry in the `features/` tree listing.

The spec forbids this in three places (Relevant Files "caution, do not sweep", Task 8, Acceptance Criteria "The commit/PR contains only this feature's paths — no unrelated `README.md` drift"). Separately, the **one in-scope** README change the spec anticipated — a `features/regression/hashing/` tree entry (mirroring how #729 added `upgrade/`) — is absent.

**Verified state (single-variable checks run during planning):**
- The drift is **entirely** in commit `91542bd9` (HEAD~1, the plan commit). The build commit `21d20d38` (HEAD) does **not** touch `README.md` (`git log origin/dev..HEAD -- README.md` lists only `91542bd9`).
- The working tree is **clean** for `README.md`; the only untracked item is `features/regression/step_definitions/logs/` (a test artefact that must **not** be committed).
- `origin/dev`'s `README.md` has **no** `hashing/` entry and **no** `multilang/`/`upgrade/`/`perIssueSweepPersist.ts` entries — so restoring to `origin/dev` strips exactly the drift and nothing this feature needs.

**Solution:** Because the drift sits in a **non-HEAD commit** (it cannot be `--amend`ed), use the established **restore-and-commit-on-top** remediation: `git checkout origin/dev -- README.md` discards all drift, then add only the single sanctioned `hashing/` tree entry, then commit on top scoped to `README.md` only. The PR diff (`git diff origin/dev..HEAD`) collapses all commits, so this leaves the net README diff at exactly the one `hashing/` line.

## Files to Modify
- `README.md` — restore to `origin/dev` (strips all four out-of-scope items), then add the single in-scope `features/regression/hashing/` tree entry.

(No source, feature, step-def, or vocabulary changes — those are correct as-is in commit `21d20d38` and are out of scope for this patch.)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Do **not** run `git add -A` at any point — the untracked `features/regression/step_definitions/logs/` directory must never be staged.

### Step 1: Restore README.md to origin/dev (strip the drift)
- Run: `git checkout origin/dev -- README.md`
- This overwrites the working-tree + index `README.md` with the `origin/dev` version, removing all four out-of-scope items (both promotion-sweep paragraph rewrites, the `perIssueSweepPersist.ts` line, the `multilang/` line, and the `upgrade/` line) in one operation.

### Step 2: Add ONLY the single in-scope `features/regression/hashing/` tree entry
- Open the restored `README.md` and locate the `features/` tree listing's `regression/` subtree (the block beginning `├── regression/         # Regression scenario vocabulary, typed World, and surface/smoke scenarios`). Its children are currently, in alphabetical order: `smoke/`, `step_definitions/`, `support/`, `surfaces/`, `vocabulary.md`.
- Insert one new line **immediately after** the `├── regression/ …` header line and **before** the `│   ├── smoke/ …` line (alphabetical placement: `hashing/` sorts before `smoke/`), mirroring the shape of the `upgrade/` line the spec references:

  ```
  │   ├── hashing/        # Regression scenarios covering framework content hashing (#537)
  ```

- Match the box-drawing prefix (`│   ├── `) and align the `#` comment column with the neighbouring `support/`/`surfaces/` entries (`hashing/` is 8 characters, same as `support/`, so use the same spacing). Add **nothing else** — this must be the only README line this patch introduces beyond the origin/dev baseline.

### Step 3: Stage and commit the restore on top of the branch (scoped to README.md only)
- Stage **only** README.md: `git add README.md`
- Confirm nothing else is staged (esp. not `logs/`): `git status --porcelain` should show only `M  README.md`.
- Commit on top of the branch (the drift-bearing `91542bd9` cannot be amended, so this restore commit neutralises it in the net PR diff): `git commit -m "patchAgent: fix: scope README to #760 — strip unrelated promotion-sweep drift, add hashing/ tree entry"`

## Validation
Execute every command; each must pass exactly as described. These verify the **net PR diff** (`origin/dev..HEAD`), which is what the reviewer and the acceptance criterion evaluate.

- `git diff origin/dev -- README.md` — the ONLY change shown must be the single added `hashing/` line. Eyeball: no promotion-sweep paragraph rewrites, no `perIssueSweepPersist.ts`, no `multilang/`, no `upgrade/`.
- `git diff origin/dev -- README.md | grep -c 'PROMOTION_SWEEP_INTERVAL_CYCLES\|perIssueSweepPersist\|multilang/\|regression/upgrade\|dispatched by'` — must print `0` (all out-of-scope drift gone).
- `git diff origin/dev -- README.md | grep -c 'regression/hashing\|hashing/'` — must print `1` (the single sanctioned in-scope addition; `git diff` prefixes the added line with `+`).
- `test $(git diff origin/dev -- README.md | grep -c '^+' ) -le 2 && echo "README NET DIFF SCOPED"` — at most one `+` hunk-header line plus one added content line; proves no other additions rode in.
- `git status --porcelain` — must show a clean working tree apart from the untracked `?? features/regression/step_definitions/logs/`; confirm `README.md` is committed (not left modified) and `logs/` was **not** committed.
- `git log --oneline origin/dev..HEAD -- README.md` — confirms the new restore commit sits on top of `91542bd9` (net diff, not commit count, is the acceptance gate).

Note: this is a documentation-only change to `README.md`, which is not part of the TypeScript lint/type-check/build/BDD pipelines, so those gates (already green from build commit `21d20d38`) are unaffected and are not re-run by this patch.

## Patch Scope
**Lines of code to change:** ~7 removed + 1 added in `README.md` (net: strip 4 drift items, add 1 in-scope line), delivered as one restore-on-top commit.
**Risk level:** low — a scoped `git checkout origin/dev -- README.md` plus a one-line docs insert; no source, no behaviour, no test surface touched. Primary guardrail: never `git add -A` (would sweep the untracked `logs/`).
**Testing required:** Git-diff scope assertions above (net `origin/dev..HEAD` README diff = at most the single `hashing/` line; zero promotion-sweep / `perIssueSweepPersist.ts` / `multilang/` / `upgrade/` drift). No code validation needed for a docs-only restore.
