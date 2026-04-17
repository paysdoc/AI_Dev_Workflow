# Feature: depaudit-triage — autonomous minor/patch parent upgrade action

## Metadata
issueNumber: `437`
adwId: `yx99nx-depaudit-triage-skil`
issueJson: `{"number":437,"title":"depaudit triage skill: autonomous minor/patch parent upgrade","body":"## Parent PRD\n\n`specs/prd/depaudit.md` (in paysdoc/depaudit)\n\n## What to build\n\nExtends `/depaudit-triage` with the `upgrade parent` action for the MINOR/PATCH case only. When a finding can be resolved by a minor or patch bump of the direct parent, the skill:\n\n1. Computes the smallest upgrade target version that resolves the finding.\n2. Edits the manifest (`package.json`, `go.mod`, etc.) to bump the parent.\n3. Runs the package manager install command (from `.adw/commands.md` if present, or the ecosystem default).\n4. Moves to the next finding. No re-scan per PRD.\n\nMajor bumps are out of scope for this slice — the skill refuses to apply them and points the user at the next slice's action. Major-bump issue filing is built in the next ADW issue.\n\n## Acceptance criteria\n\n- [ ] Skill detects minor / patch vs major by parsing semver of `from` and `to`.\n- [ ] Minor or patch: autonomous edit + install + advance.\n- [ ] Major: skill refuses, prints a pointer to the (upcoming) major-bump action.\n- [ ] User can cancel a pending upgrade before the install command runs.\n- [ ] Install failures surface clearly and leave workspace state unchanged (no partial bump).\n\n## Blocked by\n\n- Blocked by #436\n\n## User stories addressed\n\n- User story 20 (partial — minor/patch only)\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-17T13:27:50Z","comments":[],"actionableComment":null}`

## Feature Description
Extend the existing `/depaudit-triage` Claude Code skill so that the **Action 1: upgrade parent** branch — currently a stub that prints "Not yet wired — coming in a future issue" — becomes operational for the **minor/patch** semver case. When the skill encounters a finding whose `to` version is a minor or patch bump relative to `from` (of the direct parent), it classifies the bump via semver, confirms with the user, edits the manifest (`package.json`, `go.mod`, `Cargo.toml`, etc.) to bump the parent to the smallest target that resolves the finding, runs the project's install command (from `.adw/commands.md` → `## Install Dependencies`, or the ecosystem default), and advances to the next finding **without re-scanning**.

Major bumps stay out of scope for this slice: the skill refuses to apply them and prints a pointer to the upcoming major-bump action. The user may cancel a pending upgrade before install runs; install failures surface clearly and leave the workspace unchanged (the manifest edit is reverted, so there is never a partial bump).

## User Story
As a developer at triage time
I want the `/depaudit-triage` skill to autonomously apply minor/patch upgrades to the direct parent when those resolve a finding
So that routine low-risk remediations don't require me to hand-edit manifests and re-run install, and so that major-version upgrades remain a deliberate decision rather than an automatic breaking change.

## Problem Statement
Today the `/depaudit-triage` skill presents the "upgrade parent" option in its per-finding menu, but selecting it simply displays "Not yet wired — coming in a future issue" and behaves as skip (see `.claude/skills/depaudit-triage/SKILL.md`, Action 1). Consequently every finding that could be fixed by a one-line minor/patch bump of the direct parent still forces the developer to either (a) exit the skill and edit the manifest by hand, or (b) accept the finding even though a trivial upgrade would resolve it. This pushes low-risk, high-confidence remediations off the happy path and inflates the number of "accept" entries for findings that were in principle fixable in seconds.

## Solution Statement
Rewrite the `### Action 1: upgrade parent` section of `.claude/skills/depaudit-triage/SKILL.md` to branch on the semver relationship between the finding's `from` and `to` fields:

- **Major bump** → refuse, print a pointer to the upcoming major-bump action (the next ADW issue wires it), treat as skip.
- **Minor or patch bump** → run the autonomous flow:
  1. Display the pending upgrade (package, from, to-target, parent, manifest file) and offer a cancel prompt.
  2. Compute the smallest target version of the direct parent that resolves the finding (in practice this is `to` from the finding, which depaudit already narrows).
  3. Edit the manifest in place with Read + Edit.
  4. Run the install command sourced from `.adw/commands.md` → `## Install Dependencies` if present; otherwise the ecosystem default (`bun install` / `npm install` / `go mod tidy` / `cargo update` / `pip install -r requirements.txt` / etc.).
  5. On success, advance to the next finding — **do not re-scan** (static snapshot is preserved per PRD).
  6. On install failure, surface the failing command and its exit output clearly, revert the manifest edit, and leave the workspace unchanged (no partial bump).

Because the SKILL.md is a prompt executed by the LLM at triage time — not TypeScript code compiled into the ADW orchestrators — this feature ships entirely as textual instructions inside `SKILL.md`. No new modules, agents, or runtime dependencies are introduced. The existing `@adw-437` BDD scenarios (`features/depaudit_triage_upgrade_parent_minor_patch.feature`) already assert the required content is present in `SKILL.md`; no new step definitions are needed.

## Relevant Files
Use these files to implement the feature:

- `.claude/skills/depaudit-triage/SKILL.md` — **primary edit target.** The existing skill prompt. Action 1 (`upgrade parent`) currently stubs out with "Not yet wired — coming in a future issue." This must be rewritten to implement the minor/patch autonomous flow and the major-bump refusal.
- `features/depaudit_triage_upgrade_parent_minor_patch.feature` — the BDD scenarios authored for this issue (`@adw-437`). They assert content is present in `SKILL.md`; the SKILL.md rewrite must satisfy every `Then the file contains "X"` clause.
- `features/depaudit_triage_skill.feature` — the base `@adw-436` scenarios. The rewrite must not regress these (menu still has four actions; static-snapshot language preserved; etc.).
- `features/step_definitions/depauditTriageSkillSteps.ts` — existing step definitions. No new steps are expected to be needed; the scenarios reuse `file contains` / `does not contain` (from `commonSteps.ts`) and the menu data-table step (already defined here).
- `features/step_definitions/commonSteps.ts` — provides `Given the file "X" is read`, `Then the file contains "X"`, and `Then the file does not contain "X"`.
- `.adw/commands.md` — source of truth for project install commands; the SKILL.md text must direct the skill to read `## Install Dependencies` from this file when present.
- `.adw/project.md` — `## Unit Tests: enabled`. Drives whether the plan includes unit-test tasks.
- `specs/prd/depaudit.md` — parent PRD, sections "Remediation policy" (lines 166–180) and "Claude Code skill" (lines 210–222). Authoritative definition of the minor/patch autonomous behavior and the major-bump refusal.
- `app_docs/feature-1w5uz8-depaudit-triage-skill.md` — feature doc for issue #436. Records that Action 1 is stubbed and will be wired in a subsequent ADW issue (this one).
- `guidelines/coding_guidelines.md` — target-repo coding guidelines. Relevant for the step-definition file if (and only if) new step definitions are needed.

### New Files
No new source or test files are required. The BDD feature file already exists; the SKILL.md already exists; no new step definitions or modules are expected.

## Implementation Plan

### Phase 1: Foundation
Confirm the exact list of required content strings by reading `features/depaudit_triage_upgrade_parent_minor_patch.feature` end to end. Every `Then the file contains "X"` and `Then the file does not contain "X"` clause is a hard constraint on the SKILL.md text. No code or library work is needed in this phase.

### Phase 2: Core Implementation
Rewrite `### Action 1: upgrade parent` inside `.claude/skills/depaudit-triage/SKILL.md` with:

1. **Semver classification subsection** — explicit instructions to parse the finding's `from` and `to` fields, and classify the upgrade as `major`, `minor`, or `patch`. The text must contain the words `semver`, `from`, `to`, `minor`, `patch`, `major`.

2. **Major branch** — if major: display `"Major upgrade refused in this slice — this action wires minor/patch only. The major-upgrade flow is coming in a future issue."`, treat as skip, advance to the next finding. The text must contain `major`, `refuse`, and `future issue`.

3. **Minor/patch autonomous branch** — describe the full autonomous flow. Text must contain the strings `minor`, `patch`, `autonomous`, `smallest`, `resolves the finding`, `manifest`, `package.json`, `go.mod`, `.adw/commands.md`, `Install Dependencies`, `ecosystem default`, `cancel`, `before the install command runs`, `revert`, `manifest`, `install fail`, `no partial bump`, `workspace`, `next finding`, and `static snapshot`. It must NOT contain the phrase `re-scan after each`.

4. **Install command sourcing** — the skill first reads `.adw/commands.md` and looks for the `## Install Dependencies` section. If found, it runs that command. Otherwise it falls back to the ecosystem default (e.g., `bun install` for `package.json`, `go mod tidy` for `go.mod`, `cargo update -p <parent>` for `Cargo.toml`, `pip install -r requirements.txt` for `requirements.txt`).

5. **Cancellation path** — before running the install command, the skill prompts the user with a confirmation (e.g., `Press Enter to apply the upgrade, or type "cancel" to abort.`). If the user cancels, the pending manifest edit is reverted and the finding is treated as skip.

6. **Failure path** — if the install command exits non-zero, the skill prints the command, its exit code, and its stderr; reverts the manifest edit so the workspace state is unchanged; advises the user that there is no partial bump; then moves to the next finding.

7. **Menu label update** — update Action 1 in the menu rendering from `1. upgrade parent            — not yet wired (coming in a future issue)` to something like `1. upgrade parent            — autonomous for minor/patch; major bumps are refused in this slice`. The four-action menu structure must be preserved (Action 1 `upgrade parent`, Action 2 `accept+document`, Action 3 `accept+file-upstream-issue`, Action 4 `skip`) so the `@adw-436` data-table scenario and the new `@adw-437` four-actions scenario both pass.

8. **Completion summary** — extend Step 5's summary to report `Upgrades applied`, `Upgrades refused (major)`, `Upgrades cancelled`, and `Upgrades failed` in addition to the existing `Accepted`, `Skipped`, `In flight` counters. Keep this brief.

### Phase 3: Integration
- Confirm that the static-snapshot discipline from the base skill still applies: the skill reads `findings.json` once at Step 1 and does NOT re-scan after a successful upgrade. Keep the existing `static snapshot` / `Do NOT trigger a re-scan` language intact; ensure the new Action 1 text reaffirms this (the `@adw-437` "advance without re-scan" scenario asserts `static snapshot` is present and `re-scan after each` is absent).
- Re-verify the base-skill scenarios (`@adw-436 @regression`) still pass unchanged — the rewrite must not break the existing idempotency check, accept+document validation, supply-chain vs CVE file routing, etc.
- Do not add a new step definition file; only modify `SKILL.md`.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Task 1: Re-read the existing SKILL.md
- Open `.claude/skills/depaudit-triage/SKILL.md` and re-read the full file.
- Identify the exact location of `### Action 1: upgrade parent` and the menu block in Step 3.

### Task 2: Re-read the BDD scenarios for this issue
- Open `features/depaudit_triage_upgrade_parent_minor_patch.feature`.
- Build a checklist of every `Then the file contains "..."` and `Then the file does not contain "..."` clause. Each is a hard constraint on the SKILL.md text.

### Task 3: Rewrite the Action 1 section — semver classification
- Replace the "Not yet wired — coming in a future issue" stub with a new section that:
  - Reads `from` and `to` from the finding.
  - Parses both as semver and classifies the upgrade as `major`, `minor`, or `patch`.
  - Branches on the classification.
- Include the words `semver`, `from`, `to`, `major`, `minor`, `patch` explicitly in the prose.

### Task 4: Rewrite the Action 1 section — major branch
- When the classification is `major`: the skill must **refuse** to apply the bump. It prints a message that explicitly references `future issue` (the next ADW issue wires the major flow). It treats the finding as skip.

### Task 5: Rewrite the Action 1 section — minor/patch autonomous branch
- When the classification is `minor` or `patch`, describe the full `autonomous` flow in order:
  1. Display a pending-upgrade summary (package, `from`, `to`, parent, manifest file, install command).
  2. Compute the `smallest` target version that `resolves the finding` (in practice, `to` from the finding).
  3. Edit the `manifest` file — reference both `package.json` and `go.mod` by name to satisfy the manifest scenario; include a short note that other ecosystems (`Cargo.toml`, `requirements.txt`, `pyproject.toml`, `Gemfile`, `composer.json`, `pom.xml`) use the same pattern.
  4. Source the install command from `.adw/commands.md` → `Install Dependencies`; otherwise use the `ecosystem default` for the manifest (`bun install` / `npm install` / `go mod tidy` / `cargo update -p <parent>` / `pip install -r requirements.txt`).
  5. Advance to the `next finding` after a successful install.
- The word `autonomous` must appear verbatim.

### Task 6: Rewrite the Action 1 section — cancel path
- Before running the install command, the skill prompts the user to confirm. Text must say the user can `cancel` the upgrade `before the install command runs`.
- If the user cancels, the skill must `revert` the `manifest` edit (so the workspace is unchanged), treat the finding as skip, and advance.

### Task 7: Rewrite the Action 1 section — install-failure path
- If the install command exits non-zero, the skill must:
  - Surface the failing command and its exit output with the phrase `install fail` (e.g., `Install failed:` or `install failed — ...`).
  - Revert the `manifest` edit.
  - Report `no partial bump` to the user and confirm the `workspace` is unchanged.
  - Advance to the next finding.

### Task 8: Preserve the static-snapshot language
- Ensure the new Action 1 text preserves / reaffirms `static snapshot` and does **not** introduce the phrase `re-scan after each`. The existing `do not re-scan` discipline in Step 1 must remain intact.

### Task 9: Update the menu in Step 3
- Change the Action 1 label in the menu block from `— not yet wired (coming in a future issue)` to a description that reflects it is now wired for `minor`/`patch` only (e.g., `— autonomous for minor/patch; major bumps are refused in this slice`).
- Keep all four menu items (`upgrade parent`, `accept+document`, `accept+file-upstream-issue`, `skip`) so the `@adw-436` four-action menu scenario and the `@adw-437` four-top-level-actions scenario both pass.

### Task 10: Update the completion summary in Step 5
- Extend the summary with counters for `Upgrades applied`, `Upgrades refused (major)`, `Upgrades cancelled`, and `Upgrades failed`. Keep the existing `Accepted`, `Skipped`, `In flight (auto-skipped)` lines.

### Task 11: Skim for consistency
- Re-read the full SKILL.md top-to-bottom to ensure the `upgrade parent` description is coherent with Step 1 (findings snapshot), Step 2 (filter to new), Step 3 (sequential walk), and Step 5 (summary).
- Verify there are no internal contradictions (e.g., an earlier line saying "upgrade parent is not yet wired" that now conflicts with the rewritten Action 1).

### Task 12: Run the `@adw-437` BDD scenarios
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437"` — every scenario in `features/depaudit_triage_upgrade_parent_minor_patch.feature` must pass.

### Task 13: Run the `@adw-436` BDD scenarios (regression)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-436"` — every existing base-skill scenario must still pass.

### Task 14: Run the regression suite
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the full regression suite must pass with zero new failures.

### Task 15: Run the ADW quality gates
- `bun run lint`
- `bunx tsc --noEmit`
- `bunx tsc --noEmit -p adws/tsconfig.json`
- `bun run test:unit`

### Task 16: Final validation
- Execute every command in the **Validation Commands** section below and confirm all exit with status 0.

## Testing Strategy

### Unit Tests
Per `.adw/project.md` (`## Unit Tests: enabled`), unit tests are in scope for this project. However, this feature changes **only** a markdown prompt file (`.claude/skills/depaudit-triage/SKILL.md`). No new TypeScript modules, helpers, or agents are introduced, so there is nothing unit-testable on the ADW side to add. The existing Vitest suite (`bun run test:unit`) must continue to pass unchanged. If Task 11 or Task 12 reveals that a small helper (e.g., a semver classifier) would be useful in a future step-definition file, defer that to the next issue; the current BDD scenarios only assert textual content on `SKILL.md`.

### Edge Cases
- **`from` and `to` equal** (degenerate "bump" that doesn't actually change the version). The skill should detect this and treat it as a no-op + skip with a short diagnostic.
- **`from` or `to` missing or non-semver** (e.g., a git-ref or date-based version). The skill refuses the autonomous upgrade and treats the finding as skip with a "cannot classify" diagnostic; the user can still `accept+document` or file upstream.
- **Multiple manifests in a monorepo** — the finding's `parent` + `manifest` combination identifies the single file to edit; the skill must not touch other manifests.
- **`.adw/commands.md` missing** — fallback to the ecosystem default install command for the manifest's ecosystem.
- **Install command exits with non-zero but no stderr** — still surface the exit code and revert the manifest; the `install fail` language is present regardless of output size.
- **User cancels after the skill has edited the manifest but before running install** — the skill must revert the manifest on cancel.
- **Install succeeds but the manifest edit didn't actually change the resolved version** (e.g., `package-lock.json` pins an older version). This is out of scope for this slice and should not regress behavior; note it as follow-up work.
- **Two findings in sequence that both want to upgrade the same parent** — the first bump may make the second finding's `to` already satisfied, but the skill does NOT re-scan; both findings are presented. User selects upgrade a second time → the manifest edit is either a no-op or lowers the version; leave handling to the user's judgment in this slice.
- **Menu renders correctly** — the four-action menu still shows exactly those four actions; `@adw-436` and `@adw-437` data-table scenarios both pass.
- **Base-skill idempotency check still fires** before classification, so a finding already in flight with a non-empty `upstreamIssue` is auto-skipped before the upgrade branch runs.

## Acceptance Criteria
- [ ] `.claude/skills/depaudit-triage/SKILL.md` no longer contains the stub "Not yet wired — coming in a future issue" for Action 1 (the `upgrade parent` branch).
- [ ] The SKILL.md explicitly instructs the skill to parse `semver` of `from` and `to` and classify the upgrade as `major`, `minor`, or `patch`.
- [ ] When the classification is `major`, the SKILL.md instructs the skill to `refuse` and point the user at a `future issue`.
- [ ] When the classification is `minor` or `patch`, the SKILL.md instructs an `autonomous` flow: compute the `smallest` target that `resolves the finding`, edit the `manifest` (`package.json`, `go.mod`, etc.), run the install command.
- [ ] The SKILL.md sources the install command from `.adw/commands.md` (section `Install Dependencies`) with a documented fallback to the `ecosystem default`.
- [ ] The SKILL.md documents a `cancel` path that the user can invoke `before the install command runs`; a cancel `reverts` the `manifest` edit.
- [ ] The SKILL.md documents an install-failure path that reports `install fail` and leaves the `workspace` unchanged with `no partial bump`.
- [ ] The SKILL.md states that after a successful minor/patch upgrade the skill advances to the `next finding` and preserves the `static snapshot` (no `re-scan after each` action).
- [ ] The four-action menu is preserved (`upgrade parent`, `accept+document`, `accept+file-upstream-issue`, `skip`).
- [ ] The `@adw-437` BDD scenarios all pass (`NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437"`).
- [ ] The `@adw-436` BDD scenarios all still pass (`NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-436"`).
- [ ] The `@regression` BDD suite passes with zero new failures.
- [ ] `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, and `bun run test:unit` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — run the ESLint check on the codebase.
- `bunx tsc --noEmit` — type-check the root TypeScript project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — type-check the `adws/` project.
- `bun run test:unit` — run the Vitest unit test suite (must continue passing; no new unit tests introduced).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437"` — validate every new BDD scenario for this slice passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-436"` — validate the base-skill BDD scenarios still pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — run the full regression suite to confirm zero regressions elsewhere in ADW.

## Notes
- `guidelines/coding_guidelines.md` exists in this repo; the rewrite adheres to its core principles (clarity, modularity, single responsibility). The only file touched is a markdown prompt, so TypeScript-specific rules do not apply to the edit itself.
- **No new libraries** are required. The skill is a markdown prompt executed by the LLM at triage time; semver classification is done by the LLM following the prompt's instructions, not by a JavaScript dependency. Consequently no `bun add` is needed. (If this changes in a future slice — e.g., a TypeScript helper used by step definitions — read the `## Library Install Command` from `.adw/commands.md`, which specifies `bun add <package>`.)
- **Scope discipline.** Per the issue body, major-bump issue filing is explicitly the next ADW issue. This slice must refuse major bumps and point forward; it must not implement `gh issue create` / `/adw_sdlc` embedding / short-lived accept entries. Preserve that boundary.
- **PRD fidelity.** `specs/prd/depaudit.md` (lines 166–172, 210–222) is the authoritative spec. Any conflict between the PRD and the issue body is resolved in favor of the PRD, with the issue body narrowing scope to minor/patch only.
- **Idempotency-check ordering.** The base-skill idempotency check (Step 3, "Before presenting a finding") must fire **before** the upgrade branch. A finding already in flight with a non-empty `upstreamIssue` should still auto-skip without the skill even attempting semver classification.
- **No re-scan after upgrade.** Per PRD user story 23 and the `@adw-437` static-snapshot scenario, the skill does NOT re-run `depaudit scan` after a successful upgrade — the user can manually rescan between sessions. Keep `Do NOT trigger a re-scan` language intact.
- **Follow-up (out of scope).** The "major bump → file an issue on the current repo with `/adw_sdlc` embedded + short-lived accept entry" flow is the next ADW issue. This plan deliberately stops at "refuse + print pointer to future action."
