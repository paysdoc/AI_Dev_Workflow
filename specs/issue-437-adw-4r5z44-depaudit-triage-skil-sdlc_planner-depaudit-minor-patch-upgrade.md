# Feature: depaudit-triage skill — autonomous minor/patch parent upgrade

## Metadata
issueNumber: `437`
adwId: `4r5z44-depaudit-triage-skil`
issueJson: `{"number":437,"title":"depaudit triage skill: autonomous minor/patch parent upgrade","body":"## Parent PRD\n\n`specs/prd/depaudit.md` (in paysdoc/depaudit)\n\n## What to build\n\nExtends `/depaudit-triage` with the `upgrade parent` action for the MINOR/PATCH case only. When a finding can be resolved by a minor or patch bump of the direct parent, the skill:\n\n1. Computes the smallest upgrade target version that resolves the finding.\n2. Edits the manifest (`package.json`, `go.mod`, etc.) to bump the parent.\n3. Runs the package manager install command (from `.adw/commands.md` if present, or the ecosystem default).\n4. Moves to the next finding. No re-scan per PRD.\n\nMajor bumps are out of scope for this slice — the skill refuses to apply them and points the user at the next slice's action. Major-bump issue filing is built in the next ADW issue.\n\n## Acceptance criteria\n\n- [ ] Skill detects minor / patch vs major by parsing semver of `from` and `to`.\n- [ ] Minor or patch: autonomous edit + install + advance.\n- [ ] Major: skill refuses, prints a pointer to the (upcoming) major-bump action.\n- [ ] User can cancel a pending upgrade before the install command runs.\n- [ ] Install failures surface clearly and leave workspace state unchanged (no partial bump).\n\n## Blocked by\n\n- Blocked by #436\n\n## User stories addressed\n\n- User story 20 (partial — minor/patch only)\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-17T13:27:50Z","comments":[],"actionableComment":null}`

## Feature Description
Extend the existing `/depaudit-triage` Claude Code skill (created in issue #436) with the `upgrade parent` action wired for the MINOR/PATCH case only. When a finding's direct parent can be resolved by a minor or patch version bump, the skill autonomously: (1) computes the smallest upgrade target version, (2) edits the relevant manifest file (`package.json`, `go.mod`, `Cargo.toml`, etc.) to bump the parent, (3) runs the package manager install command, and (4) advances to the next finding. Major version bumps are explicitly refused with a clear pointer to the upcoming major-bump action (to be built in a follow-up issue). The user can cancel a pending upgrade before the install command runs, and install failures are surfaced clearly with the workspace left untouched (no partial bump).

This is a markdown-only change to `.claude/skills/depaudit-triage/SKILL.md`. The existing skill has a stubbed "Action 1: upgrade parent" that displays "Not yet wired — coming in a future issue." This feature replaces that stub with real instructions that implement the minor/patch path and the major-bump refusal.

## User Story
As a developer triaging dependency audit findings
I want the triage skill to autonomously apply minor/patch parent upgrades when those resolve a finding
So that I don't have to hand-edit manifests and run installs for routine, non-breaking fixes — while major bumps still get the care they deserve

## Problem Statement
In the current skill (issue #436), the `upgrade parent` action is a stub that treats every upgrade as "skip." This forces developers to leave the triage session to manually edit manifests and run installs even for findings resolvable by a patch bump — the exact case the PRD (user story 20; PRD §Remediation policy §1) describes as "applied autonomously without human confirmation." Without automation, the triage experience is slower than necessary and pushes developers toward `accept+document` (adding debt) instead of the preferred remediation (fixing the dependency).

Conversely, major bumps carry breaking-change risk and must not be applied silently. The skill must distinguish minor/patch from major by parsing semver and refuse the major case — for now with a clear pointer; in the next issue it will file a tracked issue.

## Solution Statement
Update `.claude/skills/depaudit-triage/SKILL.md` to wire the `upgrade parent` action as follows:

1. **Semver parsing**: Compare the semver of the current parent version (`from`) with the smallest resolving version (`to`). If `to.major > from.major`, it's a major bump. Otherwise, it's minor or patch.
2. **Minor/patch flow (autonomous)**:
   - Detect the ecosystem from the finding's manifest path (e.g. `package.json` → npm, `go.mod` → Go).
   - Compute the smallest upgrade target version that resolves the finding.
   - Display a concise summary: `package @ from → to (minor|patch)`.
   - Read the manifest, save the original content, then edit the parent's version specifier in place.
   - Prompt the user once to proceed or cancel (`proceed / cancel`) — this prompt happens before the install command runs, giving the user a chance to cancel a pending upgrade before the install command runs.
   - On cancel: revert the manifest edit (write the original content back) and move to the next finding.
   - On proceed: run the install command (resolved from `.adw/commands.md` `## Install Dependencies` if available, else the ecosystem default — `bun install` / `npm install` for npm; `go mod tidy` for Go; etc.).
   - On install success: move to the next finding (no re-scan, per PRD static snapshot semantics).
   - On install failure: revert the manifest to its original contents (no partial bump left in the workspace), surface the install error output to the user, and move to the next finding without writing the accept entry.
3. **Major flow (refuse)**:
   - Display: "Major bump required (`from` → `to`). The skill refuses to apply major bumps directly — this lands in a future issue (the upcoming major-bump action), which will file a tracked issue and write a short-lived accept entry. For now, choose `accept+document` to record the risk, or `skip` to postpone."
   - Treat as skip (no mutation).
4. **Preserve PRD invariants**: static snapshot (no re-scan mid-triage), `(package, version, finding-id)` identity unchanged, skill stays `target: false`.

Because the skill file is pure markdown (a Claude Code prompt), the contract is expressed as prompt instructions and verified by BDD content-assertion scenarios — the same pattern used in issue #436.

## Relevant Files
Use these files to implement the feature:

- `.claude/skills/depaudit-triage/SKILL.md` — The skill prompt that must be updated. Action 1 (`upgrade parent`) currently stubs as "not yet wired" and needs to be replaced with the minor/patch autonomous flow and the major refuse flow.
- `specs/prd/depaudit.md` — Parent PRD defining the remediation policy. §Remediation policy §1 says minor/patch upgrades are applied autonomously without human confirmation. §Claude Code skill reiterates the upgrade logic and major-bump handling. User stories 20 and 34–37 provide the behavioral contract.
- `specs/issue-436-adw-1w5uz8-depaudit-triage-skil-sdlc_planner-depaudit-triage-skill.md` — Prior issue spec that created the skill. Reference for the existing skill structure, frontmatter, sequential walk, idempotency guard, and completion summary that must be preserved.
- `app_docs/feature-1w5uz8-depaudit-triage-skill.md` — Documents how the existing skill works and explicitly flags `upgrade parent` and `accept+file-upstream-issue` as stubbed. Conditional-docs entry points to this file; must be read before touching the skill.
- `features/depaudit_triage_skill.feature` — Existing BDD feature file for the skill (issue #436 scenarios). Must continue to pass.
- `features/depaudit_triage_upgrade_parent_minor_patch.feature` — New `@adw-437` BDD feature file covering semver detection, minor/patch autonomous flow, major refusal, user cancel (with revert), and install-failure revert. Already created — content-assertions verify SKILL.md contains the expected instructional phrases.
- `features/step_definitions/depauditTriageSkillSteps.ts` — Existing step definitions. New content-assertion step definitions may be needed to back the new scenarios.
- `features/step_definitions/commonSteps.ts` — Shared context (`sharedCtx.fileContent`) used by the skill step definitions. No change expected; read to reuse existing steps.
- `.adw/commands.md` — Project commands. Under `## Install Dependencies` the skill reads `bun install` as the resolved install command. The skill should reference `.adw/commands.md` `## Install Dependencies` as the source of truth when present.
- `.adw/conditional_docs.md` — Maps `/depaudit-triage` skill work to `app_docs/feature-1w5uz8-depaudit-triage-skill.md`. Existing entry already covers this issue's scope ("When implementing the stubbed `upgrade parent` or `accept+file-upstream-issue` actions in future issues"). No change required.
- `guidelines/coding_guidelines.md` — Clarity-over-cleverness, meaningful structure, modularity, no magic strings. Applies to the skill prompt content as well.

### New Files
None. This feature modifies existing files only.

## Implementation Plan
### Phase 1: Foundation
Read and internalize the schema contracts and behavioral constraints:
- Re-read the PRD §Remediation policy and §Claude Code skill to confirm the minor/patch autonomous semantics and the major-refusal contract.
- Re-read the existing `SKILL.md` to understand the sequential walk structure, the idempotency guard placement, and the current stub text for Action 1.
- Confirm the `.adw/commands.md` `## Install Dependencies` value is `bun install` in this repo and understand how the skill should resolve the install command for target repos (prefer `.adw/commands.md` if present, else the ecosystem default).
- Map finding `source` / manifest path to ecosystem → install command:
  - `package.json` → `bun install` or `npm install`
  - `go.mod` → `go mod tidy`
  - `Cargo.toml` → `cargo update -p <package> --precise <to>` or `cargo build`
  - `requirements.txt` / `pyproject.toml` → `pip install -r requirements.txt` / `poetry install`
  - `pom.xml` → `mvn dependency:resolve`
  - `Gemfile` → `bundle install`
  - `composer.json` → `composer install`

### Phase 2: Core Implementation
Update `.claude/skills/depaudit-triage/SKILL.md` Action 1 (`upgrade parent`) to contain:

1. **Semver parsing instruction**: Parse `from` (current parent version from the finding) and `to` (smallest resolving version from the finding) as semver `MAJOR.MINOR.PATCH`. A version is a major bump if `to.major > from.major`. Otherwise it is a minor or patch bump.

2. **Manifest detection instruction**: Use the finding's `manifestPath` (or derive from the ecosystem hint in the finding) to locate the correct manifest file (`package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`, `pyproject.toml`, `pom.xml`, `Gemfile`, `composer.json`).

3. **Minor/patch autonomous flow**:
   - Compute the smallest upgrade target version that resolves the finding (PRD §Claude Code skill: "inspects the available resolving versions of the direct parent" — pick the smallest one that resolves the finding).
   - Display a summary line: `<package> <from> → <to> (<minor|patch>)` and the manifest path.
   - Read the manifest with the Read tool; preserve the original content in memory as `originalManifest`.
   - Edit the parent's version specifier in the manifest to `to` (use the Edit tool; for `package.json` the specifier is in `dependencies` or `devDependencies`; for `go.mod` it is in the `require` block; for TOML ecosystems it is the version string).
   - Prompt: `Manifest edited. Proceed with install? (y/n)` — this prompt runs **before the install command runs**, giving the user a chance to cancel.
   - On `n` (cancel): revert the manifest edit by writing `originalManifest` back to the manifest file. Display: `Upgrade cancelled — manifest reverted.` Move to the next finding without writing an accept entry.
   - On `y` (proceed):
     - Resolve the install command:
       - If the target repo has `.adw/commands.md` with a `## Install Dependencies` section, use that value.
       - Otherwise use the ecosystem default (explicit mapping listed in Phase 1).
     - Run the install command via the Bash tool.
     - If the install fails (non-zero exit): revert the manifest by writing `originalManifest` back to the manifest file. Display: `Install failed — manifest reverted. No partial bump left in the workspace. Error: <output>`. Move to the next finding without any further action.
     - If the install succeeds: display `Upgraded <package> <from> → <to>. Moving to next finding.` and advance.
   - Do **not** run `depaudit scan` (static snapshot invariant — preserve the static snapshot semantics from the existing skill).
   - Do **not** write an accept entry for a successful upgrade — the finding is considered resolved in-tree; the next `depaudit scan` (run later by the user) will clean up any orphaned entry per PRD §Auto-prune.

4. **Major refuse flow**:
   - Display: `Major bump required: <package> <from> → <to>. The skill refuses to apply major bumps directly — this lands in a future issue (the upcoming major-bump action), which will file a tracked issue and write a short-lived accept entry.` Add a hint: `For now, choose 'accept+document' to record the risk, or 'skip' to postpone.`
   - Treat as skip — no mutation, no accept entry, no install.

5. **Preserve the completion summary**: The existing summary counts `Accepted / Skipped / In flight (auto-skipped)`. Extend it with `Upgraded: N` (only when at least one upgrade happened) so the user sees end-of-triage outcome at a glance.

### Phase 3: Integration
The skill remains `target: false` (stays in ADW). The existing idempotency guard, sequential walk, and per-finding menu layout are unchanged — only the body of Action 1 is replaced. No TypeScript/code changes are required.

The `@adw-437` BDD scenarios already exist in `features/depaudit_triage_upgrade_parent_minor_patch.feature` using the content-assertion pattern established in issue #436. Each scenario reads the SKILL.md file and asserts that specific instructional content is present (or absent). Add step-definition helpers in `features/step_definitions/depauditTriageSkillSteps.ts` only if the existing content-assertion steps cannot be reused as-is.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read conditional docs and prior art
- Read `app_docs/feature-1w5uz8-depaudit-triage-skill.md` to confirm the existing skill's contract.
- Read `specs/prd/depaudit.md` §Remediation policy and §Claude Code skill for the minor/patch vs major contract.
- Read the existing `.claude/skills/depaudit-triage/SKILL.md` to see exactly where Action 1 begins and ends (the block currently says "Display: 'Not yet wired — coming in a future issue.' Treat as skip and move to the next finding.").
- Read `guidelines/coding_guidelines.md` to ensure prompt content follows project conventions.

### Step 2: Replace the Action 1 stub in SKILL.md with the minor/patch autonomous flow
- Edit `.claude/skills/depaudit-triage/SKILL.md`:
  - Locate `### Action 1: upgrade parent` and its current body.
  - Replace the body with the content described in Phase 2 above: semver parsing, manifest detection, smallest-target computation that resolves the finding, minor/patch autonomous flow (display summary, read+edit manifest, prompt before the install command runs, revert manifest on cancel, run install on proceed, revert manifest on install failure with no partial bump left in the workspace), and the major refuse flow with the future-issue pointer.
  - Keep all surrounding sections (Step 1 through Step 3 intro, Action 2 through Action 4, Step 5 Completion Summary, Notes) unchanged — only Action 1 is touched, plus a one-line extension of the completion summary to include the `Upgraded: N` counter.

### Step 3: Extend the completion summary to include Upgraded count
- In the `## Step 5: Completion Summary` section of the same file, extend the summary block from:
  ```
  > Triage complete.
  > - Accepted: N
  > - Skipped: N
  > - In flight (auto-skipped): N
  ```
  to include an `Upgraded: N` line so the user can see how many autonomous upgrades were applied. Keep it in the existing blockquote block.

### Step 4: Extend the Notes section to document the new behavior
- In the `## Notes` section of the same file, append two short bullets:
  - Upgrade policy: minor/patch bumps are applied autonomously; major bumps are refused (landing in a future issue).
  - Revert safety: the skill prompts before the install command runs so the user can cancel a pending upgrade; on cancel the skill reverts the manifest edit. If `install` fails, the skill reverts the manifest to its original content so the workspace is never left with a partial bump (no partial bump).

### Step 5: Verify the `@adw-437` BDD scenarios pass against the updated SKILL.md
The scenarios are already authored in `features/depaudit_triage_upgrade_parent_minor_patch.feature` (tagged `@adw-437`). They use the content-assertion pattern: each scenario reads `.claude/skills/depaudit-triage/SKILL.md` and asserts that specific phrases are present (or absent).

After Step 2–4 edits to SKILL.md, the file must contain (verbatim) all of the following phrases so the scenarios pass:
- Semver classification: `semver`, `from`, `to`, `minor`, `patch`, `major`
- Autonomous minor/patch path: `autonomous`
- Major refusal: `refuse`, `future issue` (Action 3 stub already contributes "future issue"; Action 1's major refuse text should also use it for clarity)
- Smallest target: `smallest`, `resolves the finding`
- Manifest editing: `manifest`, `package.json`, `go.mod`
- Install source of truth: `.adw/commands.md`, `Install Dependencies`, `ecosystem default`
- Cancel before install: `cancel`, `before the install command runs`
- Cancel reverts manifest: `revert`, `manifest`
- Install-failure handling: `install fail` (substring of "install failed"/"install fails"), `no partial bump`, `workspace`
- Advance: `next finding`
- Static snapshot: `static snapshot` (no hyphen) and the file must NOT contain the literal phrase `re-scan after each`
- Action wired: `upgrade parent`
- Menu preserved: the four-action menu (`upgrade parent`, `accept+document`, `accept+file-upstream-issue`, `skip`) remains intact

Re-use the existing step definitions (e.g. `Given the file ".claude/skills/depaudit-triage/SKILL.md" is read`, `Then the file contains "<phrase>"`, `Then the file does not contain "<phrase>"`, `When the content is inspected`, `Then it contains a menu with at least these actions:`). No new step defs are expected unless one of the above assertion forms is missing from `features/step_definitions/depauditTriageSkillSteps.ts`.

### Step 6: Add step-definition helpers if needed
- Open `features/step_definitions/depauditTriageSkillSteps.ts`.
- For each step used in `features/depaudit_triage_upgrade_parent_minor_patch.feature`, verify a step def exists. The needed forms are: `Given the file "<path>" is read`, `Then the file contains "<phrase>"`, `Then the file does not contain "<phrase>"`, `When the content is inspected`, `Then it contains a menu with at least these actions:` (data-table). If any form is missing, add minimal step defs that read the file into `sharedCtx.fileContent` and assert with `assert.ok(content.includes(...))` (case-insensitive where prose wording varies via `content.toLowerCase().includes(...)`).
- Keep the style consistent with existing step defs: function() syntax, `assert.ok(...)`.

### Step 7: Run validation commands
- Run `bun run lint` to catch any lint issues introduced into step-definition TypeScript.
- Run `bunx tsc --noEmit` for root type check.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for the adws-specific type check.
- Run `bun run build` for a full TypeScript build.
- Run the BDD regression suite: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437 or @regression"` — all scenarios must pass.
- Manual spot-check: `grep -c "upgrade parent" .claude/skills/depaudit-triage/SKILL.md` should show the action still exists; `grep -c "not yet wired" .claude/skills/depaudit-triage/SKILL.md` should show the stub text is gone for Action 1 (but may still be present for Action 3 which remains stubbed in this slice).

## Testing Strategy
### Unit Tests
Unit tests are enabled for this project (per `.adw/project.md` `## Unit Tests: enabled`). However, this feature modifies a markdown-only SKILL.md file (a Claude Code skill prompt) and adds BDD scenarios. There is no new TypeScript module or function to unit-test. The behavioral contract is expressed as prompt instructions and verified by BDD content-assertion scenarios, consistent with issue #436's approach. No unit test tasks are planned.

### Edge Cases
- `to.major > from.major` — major bump is refused with the pointer, no mutation.
- `from.major === to.major && from.minor !== to.minor` — minor bump applies autonomously.
- `from.major === to.major && from.minor === to.minor && from.patch !== to.patch` — patch bump applies autonomously.
- Pre-release versions (e.g. `1.0.0-beta.1` → `1.0.0`) — treated as same-major; minor/patch flow applies. (Semver treats pre-release as lower precedence than the release.)
- Non-semver ecosystems (e.g. Go modules using `v1.2.3` prefix, Python PEP 440) — the skill strips any ecosystem-specific prefix before semver comparison and applies the same MAJOR.MINOR.PATCH logic.
- `.adw/commands.md` has no `## Install Dependencies` section — skill falls back to the ecosystem default.
- Manifest file not found at the finding's reported path — skill displays a clear error and treats as skip (no mutation).
- User answers `n` at the confirm prompt — no edit, no install, move to next finding.
- Install command exits non-zero — manifest is restored from `originalManifest`, error output is shown, move to next finding without writing any accept entry.
- Install command not on `PATH` — same handling as install failure (manifest restored, error shown).
- Same finding resolves via multiple upgrade paths — skill picks the smallest resolving version per PRD §Claude Code skill ("inspects the available resolving versions of the direct parent").
- A subsequent finding in the same triage session was already implicitly resolved by the first upgrade — skill does NOT re-scan (static-snapshot invariant); the user can skip or accept as they see fit.

## Acceptance Criteria
- [ ] `.claude/skills/depaudit-triage/SKILL.md` Action 1 (`upgrade parent`) no longer says "Not yet wired" — it contains full instructions for semver parsing, manifest edit, install, revert, and major-bump refusal.
- [ ] The SKILL.md file contains instructions to distinguish minor/patch from major by comparing semver `MAJOR.MINOR.PATCH` of `from` and `to`.
- [ ] The SKILL.md file contains instructions to compute the smallest upgrade target version that resolves the finding.
- [ ] The SKILL.md file contains instructions for the minor/patch autonomous flow: read manifest → edit in-place → prompt before the install command runs → run install → advance on success.
- [ ] The SKILL.md file contains instructions to refuse major bumps with a clear pointer to the upcoming major-bump action landing in a future issue.
- [ ] The SKILL.md file contains a proceed/cancel prompt before the install command runs, giving the user an explicit cancel opportunity, and reverts the manifest edit on cancel.
- [ ] The SKILL.md file contains instructions to revert the manifest if install fails, leaving the workspace unchanged (no partial bump), and to surface the install error output to the user.
- [ ] The SKILL.md file instructs resolving the install command from `.adw/commands.md` `## Install Dependencies` when present, else the ecosystem default.
- [ ] The SKILL.md file preserves the static snapshot invariant — no `depaudit scan` is triggered after an upgrade.
- [ ] The Step 5 Completion Summary in SKILL.md now includes an `Upgraded: N` line.
- [ ] BDD scenarios tagged `@adw-437` in `features/depaudit_triage_upgrade_parent_minor_patch.feature` cover all the above behaviors; all scenarios pass.
- [ ] All existing `@adw-436` scenarios continue to pass (the existing contract is preserved).
- [ ] `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, and `bun run build` all pass with zero errors.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Lint TypeScript (step definition changes, if any).
- `bunx tsc --noEmit` — Root TypeScript type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check.
- `bun run build` — Full TypeScript build.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437"` — Run new scenarios for this issue.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-436"` — Verify the existing `@adw-436` scenarios still pass (prior issue's contract preserved).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression run.
- `grep -c "upgrade parent" .claude/skills/depaudit-triage/SKILL.md` — Confirm the `upgrade parent` action still exists in the menu.
- `grep -n "major" .claude/skills/depaudit-triage/SKILL.md` — Confirm the major-bump refusal text is present.
- `grep -n "Upgraded:" .claude/skills/depaudit-triage/SKILL.md` — Confirm the completion summary now includes the `Upgraded` counter.

## Notes
- The `guidelines/` directory exists and coding guidelines must be followed. The skill file is markdown (a prompt), not code; the relevant guideline is "clarity over cleverness" — the Action 1 body must be readable as step-by-step prose so Claude can follow it at invocation time.
- This slice handles minor/patch only. The major-bump action (file a tracked issue on the current repo with `/adw_sdlc` in the body + write a short-lived accept entry) is the next ADW issue (PRD §Remediation policy §2 and user stories 34–37). The refusal text added here MUST point the user at that upcoming capability so the UX is coherent — "not yet wired" framing is acceptable, but be explicit that the skill *will* handle major bumps by filing an issue in the follow-up.
- No new library is needed. The skill prompt instructs Claude to do semver comparison inline via string parsing; Claude already handles this correctly without a runtime `semver` dependency because the operation is a one-off comparison in the prompt, not a compiled code path.
- `.adw/commands.md` in this repo has `## Install Dependencies: bun install`. The skill must respect the target repo's `.adw/commands.md` when invoked there, not ADW's. The prompt instruction should say "the current working directory's `.adw/commands.md`" to avoid ambiguity.
- The skill does NOT write an accept entry on a successful upgrade — the finding is resolved in-tree. PRD §Auto-prune says a later `depaudit scan` will clean up any orphaned entry. Mentioning this in the skill is optional, but the prompt should avoid explicitly writing an accept entry for the upgrade path.
- BDD scenarios follow the content-assertion pattern from issue #436 — they verify the *prompt* contains the correct instructions, not runtime behavior of the skill (which executes at Claude invocation time, not test time). This is consistent with how skill contracts are validated in this repository.
- The `app_docs/feature-1w5uz8-depaudit-triage-skill.md` file will be updated during the `/document` phase (not this planning phase) to reflect the newly-wired `upgrade parent` action. No change to `.adw/conditional_docs.md` is required; the existing entry's trigger conditions already cover this work.
