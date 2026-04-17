# depaudit-triage: Autonomous Minor/Patch Parent Upgrade

**ADW ID:** 4r5z44-depaudit-triage-skil
**Date:** 2026-04-17
**Specification:** specs/issue-437-adw-4r5z44-depaudit-triage-skil-sdlc_planner-depaudit-minor-patch-upgrade.md

## Overview

Extends the `/depaudit-triage` Claude Code skill with a wired `upgrade parent` action for the minor/patch case. When a finding can be resolved by a minor or patch bump of the direct parent dependency, the skill autonomously edits the manifest, runs the install command, and advances — without re-scanning. Major bumps are refused with a pointer to the upcoming major-bump action.

## What Was Built

- **Wired `upgrade parent` action** in `.claude/skills/depaudit-triage/SKILL.md` — replaces the "Not yet wired" stub with full semver-aware upgrade logic
- **Semver classification** — parses `from` and `to` versions as `MAJOR.MINOR.PATCH`; routes to autonomous flow (minor/patch) or refuse flow (major)
- **Autonomous minor/patch flow** — computes smallest resolving target, edits manifest, prompts user before install, runs install, reverts on cancel or failure
- **Major refuse flow** — displays a clear refusal message with pointer to the upcoming major-bump issue; treats as skip
- **Revert safety** — manifest is reverted to `originalManifest` on cancel (before install) or on install failure, leaving no partial bump in the workspace
- **Install command resolution** — reads `## Install Dependencies` from `.adw/commands.md` when present; falls back to ecosystem defaults (`bun install`, `go mod tidy`, etc.)
- **BDD acceptance scenarios** — 16 new `@adw-437` content-assertion scenarios in `features/depaudit_triage_upgrade_parent_minor_patch.feature` verify the skill's instructional contract

## Technical Implementation

### Files Modified

- `.claude/skills/depaudit-triage/SKILL.md`: Replaced `### Action 1: upgrade parent` stub body with full semver parsing, manifest edit, install, revert, and major-refuse instructions; added two bullets to `## Notes`
- `features/depaudit_triage_upgrade_parent_minor_patch.feature`: New `@adw-437` BDD feature file with 16 content-assertion scenarios covering all acceptance criteria
- `specs/issue-437-adw-4r5z44-depaudit-triage-skil-sdlc_planner-depaudit-minor-patch-upgrade.md`: Feature specification (added)
- `specs/issue-437-adw-yx99nx-depaudit-triage-skil-sdlc_planner-depaudit-minor-patch-upgrade.md`: Companion spec file (added)
- `README.md`: Minor update

### Key Changes

- **Action 1 stub replaced**: The three-line stub (`"Not yet wired — coming in a future issue." Treat as skip`) is now ~40 lines of step-by-step prompt instructions covering semver parsing, manifest detection, smallest-target computation, cancel prompt, install, and revert.
- **Ecosystem manifest map**: Skill covers `package.json` (npm/bun), `go.mod` (Go), `Cargo.toml` (Rust), `requirements.txt`/`pyproject.toml` (Python), `pom.xml` (Maven), `Gemfile` (Ruby), `composer.json` (PHP).
- **Cancel-before-install gate**: User is prompted with `Manifest edited. Proceed with install? (y/n)` *before* the install command runs — distinct from prior stubs that had no prompt.
- **No-recan invariant preserved**: Static snapshot semantics from issue #436 are explicitly upheld; skill never triggers `depaudit scan` after an upgrade.
- **No accept entry on success**: Resolved-in-tree findings are not written to `.depaudit.yml`; a later `depaudit scan` prunes orphaned entries per PRD §Auto-prune.

## How to Use

1. Run `depaudit scan` in the target repo to generate `.depaudit/findings.json`.
2. Invoke `/depaudit-triage` in Claude Code inside the target repo.
3. For each finding, the skill displays the finding details and a four-action menu.
4. Choose `1` (`upgrade parent`) to apply a minor or patch bump:
   - Skill displays: `<package> <from> → <to> (minor|patch)` and the manifest path.
   - Skill edits the manifest, then prompts: `Manifest edited. Proceed with install? (y/n)`.
   - Enter `y` to run the install command; enter `n` to revert and skip.
5. On install success the skill advances to the next finding automatically.
6. On install failure the manifest is reverted; the error output is shown; the skill advances.
7. If the finding requires a **major** bump, the skill refuses and prompts you to `accept+document` or `skip` instead.

## Configuration

- **`.adw/commands.md` `## Install Dependencies`**: If present in the current working directory, this value overrides the ecosystem default install command. Example: `bun install`.
- **Ecosystem defaults** (fallback when `.adw/commands.md` is absent or has no `## Install Dependencies` section):
  | Manifest | Command |
  |---|---|
  | `package.json` | `bun install` / `npm install` |
  | `go.mod` | `go mod tidy` |
  | `Cargo.toml` | `cargo build` |
  | `requirements.txt` / `pyproject.toml` | `pip install -r requirements.txt` / `poetry install` |
  | `pom.xml` | `mvn dependency:resolve` |
  | `Gemfile` | `bundle install` |
  | `composer.json` | `composer install` |

## Testing

Run the BDD acceptance scenarios:

```bash
# New @adw-437 scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437"

# Regression — existing @adw-436 contract must still pass
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-436"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Manual spot-checks:
```bash
grep -c "upgrade parent" .claude/skills/depaudit-triage/SKILL.md  # should be > 0
grep -n "major" .claude/skills/depaudit-triage/SKILL.md            # refusal text present
grep -n "revert" .claude/skills/depaudit-triage/SKILL.md           # revert safety present
grep -c "not yet wired" .claude/skills/depaudit-triage/SKILL.md    # should be 1 (Action 3 stub only)
```

## Notes

- **Major bumps are out of scope** for this slice. The skill refuses to apply them and points users at a future issue that will file a tracked upstream issue and write a short-lived accept entry (PRD §Remediation policy §2, user stories 34–37).
- **Skill is `target: false`**: The updated `SKILL.md` stays in ADW and is not copied to target repos by `adw_init`. The skill is invoked by the developer inside the target repo's working directory.
- **Content-assertion BDD pattern**: Scenarios verify the *prompt text* inside `SKILL.md` contains the required instructional phrases — not runtime behavior. This is consistent with how skill contracts are validated across all ADW skill features.
- **Prior skill contract preserved**: All structural elements from issue #436 (idempotency guard, sequential walk, four-action menu, `accept+document`, `accept+file-upstream-issue` stub, `skip`, completion summary, `$ARGUMENTS`) are unchanged.
