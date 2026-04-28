# Patch: Remove `@adw-492` tag from smoke and surface .feature files

## Metadata
adwId: `2evbnk-bdd-rewrite-2-3-auth`
reviewChangeRequest: `Issue #2: @adw-492 scenarios tag is not permitted. Per spec §226-227: surface scenarios carry @regression @surface tags only; smoke scenarios carry @regression @smoke tags only. No @adw-{N} namespace in regression suite. Resolution: Remove @adw-492 tag from all smoke and surface .feature files. The @adw-492 namespace applies to other issue tracking, not to regression scenarios.`

## Issue Summary
**Original Spec:** `specs/issue-492-adw-2evbnk-bdd-rewrite-2-3-auth-sdlc_planner-bdd-authoring-smoke-surface-scenarios.md`

**Issue:** Reviewer flagged that smoke and surface `.feature` files might carry an `@adw-492`
issue-tracking tag, which violates spec §225–227 ("Carries `@regression @surface` tags only
(no `@adw-{N}` — that namespace is per-issue and never overlaps with regression)").

**Solution:** Strip any `@adw-{N}` tag from the leading tag-line of every smoke and surface
`.feature` file so each scenario carries only `@regression @smoke` or `@regression @surface`.

**Pre-patch state finding.** A grep across `features/regression/` for `@adw-492` (and
`@adw-?\d+` more broadly) returns zero matches; `git log --all -S "@adw-492"` finds zero
commits that ever added the string. Every scenario already carries only the sanctioned
`@regression @smoke` or `@regression @surface` tag-line. The patch is therefore a
**verification + assertion** rather than an edit: confirm compliance, add a guard against
regression, and document the finding so the reviewer can close the comment without a
trailing edit they would otherwise expect to see in the diff.

## Files to Modify
Use these files to implement the patch:

- **None require content edits.** All 40 regression `.feature` files
  (`features/regression/smoke/*.feature` × 5 and `features/regression/surfaces/*.feature` × 35)
  are already compliant.
- The single artefact this patch produces is **this plan file** plus an explicit grep-based
  guard run during validation.

If the validation grep in Step 1 surfaces any `@adw-{N}` tag (i.e., the pre-patch finding is
invalidated by an unrelated commit landed in parallel), this patch's scope expands to: edit
each surfaced file to delete the `@adw-{N}` token from its first-line tag-line, leaving
`@regression @smoke` or `@regression @surface` intact.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Verify zero `@adw-{N}` tags in regression features

- Run `Grep` for the regex `@adw-\d+` against `features/regression/smoke/` and
  `features/regression/surfaces/`.
- Expected result: zero matches across all 40 files.
- If any match surfaces, proceed to Step 2 to delete the offending token; otherwise skip
  Step 2 and proceed to Step 3.

### Step 2 (conditional): Delete any surfaced `@adw-{N}` tokens

- For each file flagged by Step 1, use `Edit` to remove the `@adw-{N}` token (and the single
  preceding space) from the first-line tag-line.
- Leave `@regression @smoke` (smoke files) or `@regression @surface` (surface files) intact.
- Do not touch any other line in the file. Do not touch any non-regression `.feature` file —
  the `@adw-{N}` namespace is still legitimate in `features/*.feature` (the legacy issue-scoped
  scenarios), and this patch must not perturb them.

### Step 3: Re-run the verification grep as the post-patch guard

- Re-run `Grep` for `@adw-\d+` against `features/regression/`.
- Confirm zero matches. This is the patch's MUST-PASS post-condition.

### Step 4: Re-run the regression cucumber dry-run

- Confirm that tag-line edits (if any) have not introduced parser errors:

  ```
  NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --dry-run
  ```

- Expected: zero "Undefined" steps, zero parse failures across all 40 regression features.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `Grep` for `@adw-\d+` in `features/regression/` — must return zero matches (this is the
  primary acceptance gate for this patch).
- `Grep` for `^@regression @smoke$` against `features/regression/smoke/*.feature` — must
  return exactly 5 matches (one per smoke file).
- `Grep` for `^@regression @surface$` against `features/regression/surfaces/*.feature` —
  must return exactly 35 matches (one per surface file).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression" --dry-run` — confirms
  every regression scenario still parses and matches a registered step (no tag-line edit
  broke wiring).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @smoke" --dry-run`
  and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression and @surface"
  --dry-run` — confirms tag selection still resolves the expected 5 + 35 scenarios.
- `bun run lint` and `bunx tsc --noEmit` — sanity-check that no TypeScript file was
  collaterally affected (it should not have been; the patch touches only `.feature` files
  if anything).

## Patch Scope
**Lines of code to change:** 0 expected (verification confirms pre-existing compliance);
worst-case ≤ 40 single-token deletions if a parallel commit ever introduced offending tags.

**Risk level:** low. The patch either (a) makes no edits and only documents compliance,
or (b) deletes a documented-illegal token from the first line of each affected file. No
TypeScript, no orchestrator, no fixture, no vocabulary touched.

**Testing required:** the four cucumber dry-runs and two grep guards above. No new unit
tests, no new scenario tests. The existing regression cucumber suite must continue to
parse and match cleanly.
