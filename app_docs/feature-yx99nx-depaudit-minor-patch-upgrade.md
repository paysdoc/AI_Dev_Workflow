# depaudit-triage: Autonomous Minor/Patch Parent Upgrade

**ADW ID:** yx99nx-depaudit-triage-skil
**Date:** 2026-04-17
**Specification:** specs/issue-437-adw-yx99nx-depaudit-triage-skil-sdlc_planner-depaudit-minor-patch-upgrade.md

## Overview

Extends the `/depaudit-triage` skill (issue #436) with a fully wired `upgrade parent` action for the minor/patch case. When a dependency audit finding can be resolved by bumping a direct parent's minor or patch version, the skill autonomously edits the manifest, prompts for confirmation before running the install, and advances to the next finding. Major bumps are explicitly refused with a pointer to the upcoming major-bump action.

## What Was Built

- **Semver classification**: Parses `from` and `to` as `MAJOR.MINOR.PATCH`; routes to autonomous minor/patch flow or major refuse flow
- **Smallest resolving target**: Computes the minimum version bump that resolves the finding (per PRD §Remediation policy §1)
- **Manifest editing**: Detects ecosystem from manifest path (`package.json`, `go.mod`, `Cargo.toml`, etc.) and edits the version specifier in place
- **Pre-install cancel prompt**: Prompts `Proceed with install? (y/n)` before the install command runs, giving the user a chance to cancel
- **Install command resolution**: Uses `.adw/commands.md` `## Install Dependencies` when present; falls back to ecosystem defaults
- **Cancel revert**: On cancel, writes `originalManifest` back — no partial state left
- **Install failure revert**: On non-zero exit, reverts the manifest to `originalManifest` so the workspace is never left with a partial bump
- **Major refuse flow**: Displays a clear refusal message pointing to the upcoming major-bump action in a future issue; treats finding as skip
- **BDD coverage**: 17 new `@adw-437` content-assertion scenarios in `features/depaudit_triage_upgrade_parent_minor_patch.feature`

## Technical Implementation

### Files Modified

- `.claude/skills/depaudit-triage/SKILL.md`: Replaced the `Action 1: upgrade parent` stub ("Not yet wired") with the full minor/patch autonomous flow and major refuse flow; extended the `## Notes` section with upgrade-policy and revert-safety bullets

### Key Changes

- **Action 1 body replaced**: The stub that said "Not yet wired — coming in a future issue" is gone; the action now contains ~60 lines of step-by-step prompt instructions covering semver parsing, manifest detection, smallest-target computation, edit→prompt→install→revert cycle, and major refusal
- **`originalManifest` pattern**: The skill saves the manifest content before editing and writes it back on cancel or install failure — guaranteeing no partial bump is left in the workspace
- **`static snapshot` invariant preserved**: The skill explicitly does not call `depaudit scan` after an upgrade; the findings list is never refreshed mid-session
- **No accept entry on success**: A successful upgrade resolves the finding in-tree; the skill does not write an accept entry (a future `depaudit scan` auto-prunes any orphaned entry per PRD §Auto-prune)
- **BDD content-assertion pattern**: All 17 new scenarios read `SKILL.md` and assert specific instructional phrases are present (or absent), consistent with the issue #436 approach

## How to Use

1. Run `depaudit scan` in the target repo to generate `.depaudit/findings.json`
2. Invoke `/depaudit-triage` via Claude Code
3. For each finding, choose option `1` (`upgrade parent`) when you want to apply a dependency bump
4. The skill displays the semver classification (`minor` or `patch`) and the manifest path
5. Review the manifest edit and answer `y` to proceed or `n` to cancel
   - On `n`: manifest is reverted, no install runs, skill moves to next finding
   - On `y`: install command runs; on failure the manifest is reverted and the error is shown
6. After a successful upgrade the skill advances automatically — no re-scan is triggered

## Configuration

The install command is resolved in this order:
1. `## Install Dependencies` section in the current working directory's `.adw/commands.md`
2. Ecosystem default: `bun install`/`npm install` (npm), `go mod tidy` (Go), `cargo build` (Rust), `pip install -r requirements.txt`/`poetry install` (Python), `mvn dependency:resolve` (Maven), `bundle install` (Ruby), `composer install` (PHP)

## Testing

```bash
# Run new @adw-437 scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437"

# Verify @adw-436 regression (existing skill contract still passes)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-436"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Spot-check action still wired
grep -c "upgrade parent" .claude/skills/depaudit-triage/SKILL.md

# Confirm stub text is removed for Action 1
grep -n "not yet wired" .claude/skills/depaudit-triage/SKILL.md
```

## Notes

- **Major bumps out of scope for this slice**: The skill refuses to apply major bumps and tells the user "the autonomous major-bump action lands in a future issue." That future issue will file a tracked upstream issue and write a short-lived accept entry.
- **Markdown-only change**: `SKILL.md` is a Claude Code prompt, not compiled code. The behavioral contract is verified by BDD content-assertion scenarios rather than unit tests.
- **Static snapshot semantics**: The findings list read at session start is never refreshed. A finding that was implicitly resolved by an earlier upgrade in the same session will still appear; the user can skip or accept it manually.
