# Feature: depaudit triage skill — sequential walk + accept/document + skip

## Metadata
issueNumber: `436`
adwId: `1w5uz8-depaudit-triage-skil`
issueJson: `{"number":436,"title":"depaudit triage skill: sequential walk + accept/document + skip","body":"## Parent PRD\n\n`specs/prd/depaudit.md` (full PRD lives in paysdoc/depaudit; a copy exists here at `specs/prd/depaudit.md` for historical reasons)\n\n## What to build\n\nCreate the `/depaudit-triage` Claude Code skill in ADW's `.claude/skills/depaudit-triage/SKILL.md`. When invoked, the skill:\n\n1. Locates `.depaudit/findings.json` in the current working directory (deterministic path).\n2. Reads the classified findings.\n3. Walks each \"new\" finding sequentially, presenting a 4-option menu: upgrade parent / accept+document / accept+file-upstream-issue / skip.\n4. In this slice: only `accept+document` and `skip` are wired. Upgrade and upstream-issue actions land in later ADW issues.\n\nFor `accept+document`: prompt for `reason` (≥20 chars) and `expires` (≤ today + 90d); write the canonical entry into the correct file (`.depaudit.yml` for supply-chain, `osv-scanner.toml` for CVEs). Respect identity `(package, version, finding-id)`.\n\nIdempotency: if a finding already has an accept entry with a non-empty `upstreamIssue`, the skill marks it \"in flight — issue #N\" and skips automatically.\n\n## Acceptance criteria\n\n- [ ] `.claude/skills/depaudit-triage/SKILL.md` exists with `target: false` frontmatter (stays in ADW, not copied to target repos).\n- [ ] Skill finds `.depaudit/findings.json` deterministically; errors clearly if missing.\n- [ ] Skill walks findings sequentially.\n- [ ] `accept+document` writes a schema-valid entry; `depaudit lint` passes afterwards.\n- [ ] `skip` leaves state untouched.\n- [ ] Idempotency check works for previously-in-flight findings.\n- [ ] Static snapshot behavior — no auto re-scan mid-triage (per PRD).\n\n## Blocked by\n\n- Blocked by paysdoc/depaudit#8\n\n## User stories addressed\n\n- User story 19\n- User story 22\n- User story 23\n- User story 24\n- User story 25\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-17T13:27:49Z","comments":[],"actionableComment":null}`

## Feature Description
Create the `/depaudit-triage` Claude Code skill as a new SKILL.md file in ADW's `.claude/skills/depaudit-triage/` directory. This skill provides an interactive, sequential triage workflow for dependency audit findings. When invoked, it reads `.depaudit/findings.json` (a static snapshot produced by `depaudit scan`), walks each "new" finding one at a time, and presents the user with an action menu. In this vertical slice, only two actions are wired: **accept+document** (writes a schema-valid acceptance entry with reason and expiry) and **skip** (leaves state untouched). The remaining two actions (upgrade parent, file upstream issue) are presented in the menu but explicitly marked as not-yet-wired, landing in future issues.

The skill writes acceptance entries into the correct config file based on finding type: `.depaudit.yml` for supply-chain findings, `osv-scanner.toml` for CVE findings. It enforces the strict `(package, version, finding-id)` identity model and validates that `reason` is ≥20 characters and `expires` is ≤ today + 90 days. An idempotency guard skips findings that already have an accept entry with a non-empty `upstreamIssue`, displaying them as "in flight."

## User Story
As a developer triaging dependency audit findings
I want an interactive Claude Code skill that walks me through each finding sequentially with concrete actions
So that I can efficiently document risk acceptance decisions without manually editing YAML/TOML config files

## Problem Statement
After `depaudit scan` produces findings, a developer must manually edit `.depaudit.yml` (for supply-chain accepts) or `osv-scanner.toml` (for CVE ignores) to accept and document each finding. This is error-prone: entries must follow a strict schema with `(package, version, finding-id)` identity, reason length minimums, and expiry date caps. Manual editing risks schema violations that `depaudit lint` would catch only after the fact.

## Solution Statement
A Claude Code skill (`/depaudit-triage`) that reads the static findings snapshot, presents each "new" finding with a menu of actions, validates user input against schema rules, and writes canonical entries into the correct config file. The skill handles the file-format differences between `.depaudit.yml` (YAML, supply-chain) and `osv-scanner.toml` (TOML, CVE) transparently. The sequential walk with static-snapshot semantics (no re-scan mid-triage) keeps the experience fast and predictable.

## Relevant Files
Use these files to implement the feature:

- `specs/prd/depaudit.md` — Parent PRD defining the depaudit system, config file schemas, finding identity model, acceptance rules, and triage skill specification. Primary reference for all schema and behavior decisions.
- `.claude/skills/write-a-prd/SKILL.md` — Reference for SKILL.md frontmatter format (`name`, `description`, `target` fields) and skill structure conventions.
- `.claude/skills/grill-me/SKILL.md` — Reference for a simple interactive skill pattern (question-and-answer loop).
- `.claude/skills/prd-to-issues/SKILL.md` — Reference for a skill that reads input, processes it sequentially, and produces output via CLI tools.
- `app_docs/feature-sgud8b-copy-target-skills-adw-init.md` — Documents the `target: true/false` frontmatter convention. This skill must use `target: false`.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

### New Files
- `.claude/skills/depaudit-triage/SKILL.md` — The new skill file. Contains the full triage workflow as a Claude Code skill prompt with `target: false` frontmatter.

## Implementation Plan
### Phase 1: Foundation
Understand the schema contracts from the parent PRD that the skill must respect:
- `.depaudit/findings.json` structure: array of classified findings, each with `package`, `version`, `findingId`, `source` (osv or socket), `severity`, `classification` (new, accepted, whitelisted, expired-accept), and descriptive fields.
- `.depaudit.yml` `supplyChainAccepts` entry format: keyed by `(package, version, alertType)` with `reason` (≥20 chars), `expires` (≤ today + 90d), optional `upstreamIssue`.
- `osv-scanner.toml` `[[IgnoredVulns]]` entry format: `id` (CVE/GHSA ID), `ignoreUntil` (date), `reason` (≥20 chars). Identity is `(package, version, id)` — the package and version context comes from the finding.
- Understand the `target: false` frontmatter convention from existing skills.

### Phase 2: Core Implementation
Write the SKILL.md file with:
1. YAML frontmatter: `name: depaudit-triage`, `description`, `target: false`.
2. A structured prompt that instructs Claude to:
   - Read `.depaudit/findings.json` from the working directory; error clearly if missing.
   - Filter to findings with classification `"new"`.
   - Walk each new finding sequentially (one at a time).
   - For each finding, display a summary (package, version, finding-id, severity, description) and present the 4-option menu.
   - For `accept+document`: prompt for `reason` and `expires`, validate constraints, write the entry to the correct file.
   - For `skip`: move to the next finding without modifying any file.
   - For `upgrade parent` and `file upstream issue`: display "not yet wired — coming in a future issue" and treat as skip.
   - Idempotency guard: before presenting a finding, check if an accept entry already exists with a non-empty `upstreamIssue`; if so, display "in flight — issue #N" and auto-skip.
3. Static snapshot semantics: the skill reads `findings.json` once at the start and does not re-scan.

### Phase 3: Integration
The skill integrates with the existing ADW skill infrastructure:
- Placed in `.claude/skills/depaudit-triage/SKILL.md` following the established directory convention.
- Uses `target: false` frontmatter so it is NOT copied to target repos during `adw_init` (it stays in ADW, invoked from ADW or a future UI).
- No changes to any existing ADW files are required — this is a pure addition.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read and understand the depaudit PRD schema contracts
- Read `specs/prd/depaudit.md` sections on config file schemas, finding identity, acceptance rules, and the Claude Code skill specification.
- Read existing skill SKILL.md files (`write-a-prd`, `grill-me`, `prd-to-issues`) to understand frontmatter and prompt structure conventions.
- Read `guidelines/coding_guidelines.md` to ensure the skill content follows project conventions.

### Step 2: Create the skill directory
- Create the `.claude/skills/depaudit-triage/` directory.

### Step 3: Write the SKILL.md file
- Create `.claude/skills/depaudit-triage/SKILL.md` with:
  - YAML frontmatter block: `name: depaudit-triage`, `description` (matching the issue title and covering when to invoke), `target: false`.
  - The skill prompt body implementing the full triage workflow as described in Phase 2.
- The prompt must instruct Claude to:
  1. **Read findings**: Read `.depaudit/findings.json` from the current working directory. If the file does not exist, stop and tell the user: "`.depaudit/findings.json` not found. Run `depaudit scan` first to generate findings."
  2. **Parse and filter**: Parse the JSON. Filter to findings where `classification` is `"new"`. If no new findings exist, report "No new findings to triage" and stop.
  3. **Idempotency check**: For each new finding, before presenting it, check whether an acceptance entry already exists in the relevant config file (`.depaudit.yml` for supply-chain, `osv-scanner.toml` for CVE) with a non-empty `upstreamIssue` field matching the finding's identity `(package, version, finding-id)`. If so, display "Finding [finding-id] for [package]@[version] is in flight — issue #N" and auto-skip.
  4. **Sequential walk**: Present each remaining new finding one at a time with:
     - Summary: package name, version, finding ID, severity, source (OSV/Socket), description.
     - Menu:
       - **1. Upgrade parent** — "Not yet wired — coming in a future issue." Treated as skip.
       - **2. Accept + document** — Wired in this slice.
       - **3. Accept + file upstream issue** — "Not yet wired — coming in a future issue." Treated as skip.
       - **4. Skip** — Move to next finding.
  5. **Accept + document flow**:
     - Ask the user for `reason` (must be ≥20 characters; re-prompt if too short).
     - Ask the user for `expires` date (ISO 8601 format, must be ≤ today + 90 days and not in the past; re-prompt if invalid).
     - Determine the target file based on `source`:
       - If `source` is `"socket"` (supply-chain): write to `.depaudit.yml` under `supplyChainAccepts`.
       - If `source` is `"osv"` (CVE): write to `osv-scanner.toml` under `[[IgnoredVulns]]`.
     - Write the entry using the correct schema:
       - `.depaudit.yml` supply-chain entry: `package`, `version`, `alertType` (the finding ID), `reason`, `expires`, `upstreamIssue: ""`.
       - `osv-scanner.toml` CVE entry: `id` (the CVE/GHSA ID), `ignoreUntil` (the expires date), `reason`.
     - Use the Read and Edit tools to modify the files; create them with minimal valid structure if they don't exist.
     - Respect identity `(package, version, finding-id)`: if an entry with the same identity already exists, update it rather than duplicate it.
  6. **Completion**: After all findings are processed, display a summary: how many findings were accepted, skipped, or in-flight.
  7. **Static snapshot**: Do NOT run `depaudit scan` or any re-scan at any point during the triage. Work only from the initial `findings.json` read.

### Step 4: Validate the skill file
- Verify the SKILL.md file has correct YAML frontmatter with `target: false`.
- Verify the skill prompt covers all acceptance criteria from the issue.
- Verify the file follows the coding guidelines (clarity, no magic strings, meaningful structure).

### Step 5: Run validation commands
- Run `bun run lint` to check for any lint issues.
- Run `bunx tsc --noEmit` to verify no type errors.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for the adws-specific type check.
- Run `bun run build` to verify no build errors.

## Testing Strategy
### Unit Tests
Unit tests are enabled for this project. However, this feature creates a SKILL.md file (a Claude Code skill prompt in markdown), not executable TypeScript code. There is no testable TypeScript module introduced by this feature. Unit tests are not applicable for a markdown-only skill file.

### Edge Cases
- `.depaudit/findings.json` does not exist — skill must error clearly with actionable message.
- `findings.json` contains zero findings — skill reports "no new findings" and exits.
- `findings.json` contains findings but none with classification `"new"` — same as zero findings.
- A finding already has an accept entry with `upstreamIssue` set — idempotency guard auto-skips.
- User provides `reason` shorter than 20 characters — skill re-prompts.
- User provides `expires` date more than 90 days in the future — skill re-prompts.
- User provides `expires` date in the past — skill re-prompts.
- `.depaudit.yml` does not exist yet when accepting a supply-chain finding — skill creates it with minimal valid structure.
- `osv-scanner.toml` does not exist yet when accepting a CVE finding — skill creates it with minimal valid structure.
- An accept entry with the same `(package, version, finding-id)` identity already exists — skill updates the existing entry rather than creating a duplicate.
- User selects "upgrade parent" or "file upstream issue" — skill displays "not yet wired" and treats as skip.

## Acceptance Criteria
- [ ] `.claude/skills/depaudit-triage/SKILL.md` exists with `target: false` in its YAML frontmatter.
- [ ] The skill instructs Claude to find `.depaudit/findings.json` deterministically in the current working directory; errors clearly if the file is missing.
- [ ] The skill walks findings with classification `"new"` sequentially, one at a time.
- [ ] The `accept+document` action prompts for `reason` (≥20 chars) and `expires` (≤ today + 90d), validates both, and writes a schema-valid entry to the correct file (`.depaudit.yml` for supply-chain, `osv-scanner.toml` for CVEs).
- [ ] The `skip` action moves to the next finding without modifying any file.
- [ ] The idempotency check detects findings with existing accept entries that have a non-empty `upstreamIssue` and auto-skips them with an "in flight — issue #N" message.
- [ ] The skill operates on a static snapshot — no `depaudit scan` or re-scan is triggered at any point during the triage.
- [ ] The `upgrade parent` and `file upstream issue` menu options are present but display "not yet wired" and behave as skip.
- [ ] The skill respects the strict `(package, version, finding-id)` identity model for acceptance entries.
- [ ] `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, and `bun run build` all pass with zero errors.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Root TypeScript type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check.
- `bun run build` — Build the application to verify no build errors.
- `cat .claude/skills/depaudit-triage/SKILL.md | head -5` — Verify the SKILL.md file exists and has the correct frontmatter header.
- `grep -c 'target: false' .claude/skills/depaudit-triage/SKILL.md` — Confirm `target: false` is present in the frontmatter.
- `grep -c 'findings.json' .claude/skills/depaudit-triage/SKILL.md` — Confirm the skill references the findings file.
- `grep -c 'depaudit scan' .claude/skills/depaudit-triage/SKILL.md` — Confirm the skill references `depaudit scan` only in the error message (not as an action to execute).

## Notes
- This feature creates only a single new markdown file (`.claude/skills/depaudit-triage/SKILL.md`). No TypeScript code is added or modified.
- The skill is blocked by paysdoc/depaudit#8 (the depaudit CLI itself). The SKILL.md can be written now based on the schema contracts defined in the parent PRD (`specs/prd/depaudit.md`), but cannot be end-to-end tested until depaudit produces `findings.json`.
- The `target: false` frontmatter ensures this skill stays in ADW and is NOT copied to target repos during `adw_init`. This is intentional per the PRD: the triage skill is invoked from the ADW side or a future UI, not from within target repos directly.
- The `upgrade parent` and `file upstream issue` actions are deliberately stubbed as "not yet wired" — they will be implemented in subsequent ADW issues as separate vertical slices.
- The `.depaudit.yml` and `osv-scanner.toml` schemas are defined in the parent PRD. The skill must produce entries that pass `depaudit lint`.
- The skill uses `$ARGUMENTS` for any optional arguments the user may pass (e.g., a custom path to findings.json), but defaults to the deterministic `.depaudit/findings.json` path.
- Guidelines in `guidelines/coding_guidelines.md` are followed: clarity over cleverness, meaningful structure, no magic strings.
