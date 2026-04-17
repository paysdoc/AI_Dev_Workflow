# Feature: depaudit-triage — major-bump issue filing, upstream-issue filing, and idempotency

## Metadata
issueNumber: `438`
adwId: `o28sw7-depaudit-triage-skil`
issueJson: `{"number":438,"title":"depaudit triage skill: major-bump issue filing + upstream-issue filing + idempotency","body":"## Parent PRD\n\n`specs/prd/depaudit.md` (in paysdoc/depaudit)\n\n## What to build\n\nCompletes the `/depaudit-triage` action menu.\n\n**Major-bump path** (within the `upgrade parent` action). When only a major bump resolves the finding:\n\n1. File an issue on the CURRENT repo via `gh issue create` with title `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)` and body embedding `/adw_sdlc`.\n2. Write an accept entry (`.depaudit.yml` or `osv-scanner.toml`) with `upstreamIssue` pointing to the new issue, `reason: \"pending major-bump issue #N\"`, `expires: today + 30d` (user-adjustable up to the 90-day cap).\n3. Advance.\n\n**Upstream-issue path** (separate menu action, for transitive-fix cases): skill drafts title and body, runs `gh issue create --repo <dep-owner>/<dep-repo>` to post to the dependency's OWN repo, records the URL in `upstreamIssue`. Auto-files unconditionally (no ADW-registration check — per PRD).\n\n## Acceptance criteria\n\n- [ ] Major-bump detection triggers the issue-filing path (not a direct upgrade).\n- [ ] Issue title matches the stable format exactly.\n- [ ] Issue body embeds `/adw_sdlc`.\n- [ ] Accept entry written with correct `upstreamIssue`, `reason`, and default 30-day expiry.\n- [ ] Upstream-issue action files on the dep's repo, captures the returned URL, writes an accept entry.\n- [ ] Idempotency: re-invoking on an already-in-flight finding is a no-op (no duplicate issue).\n- [ ] `depaudit lint` passes on every file produced.\n\n## Blocked by\n\n- Blocked by #437\n\n## User stories addressed\n\n- User story 20\n- User story 21\n- User story 34\n- User story 35\n- User story 36\n- User story 37\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-17T13:27:51Z","comments":[],"actionableComment":null}`

## Feature Description
Complete the `/depaudit-triage` Claude Code skill's action menu by wiring the two remaining stubs: the **major-bump path** (inside Action 1 `upgrade parent`, replacing the current "refuse" stub) and the **upstream-issue path** (Action 3 `accept+file-upstream-issue`, replacing the current "not yet wired" stub). Issue #436 created the skill with sequential walk, `accept+document`, `skip`, and the idempotency guard. Issue #437 wired the minor/patch autonomous upgrade flow inside Action 1 and deliberately left the major case refusing with a pointer to this follow-up. This issue finishes the contract:

- When a finding's only resolving upgrade path is a **major** version bump of the direct parent, the skill files a tracked issue on the *current* repository using the stable title format `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`, embeds `/adw_sdlc` in the body, and simultaneously writes a schema-valid accept entry with `upstreamIssue` set to the returned issue URL, `reason: "pending major-bump issue #N"`, and `expires: today + 30d` (user-adjustable up to the 90-day cap).
- Action 3 (`accept+file-upstream-issue`) drafts a title and body, posts to the dependency's *own* repository with `gh issue create --repo <dep-owner>/<dep-repo>`, captures the returned URL, and writes an accept entry referencing it. Auto-files unconditionally — no ADW-registration check (per PRD §Claude Code skill).
- The idempotency guard (from #436) continues to prevent duplicate filings on re-invocation. Both new paths must respect and document this invariant.
- Every file mutated by the skill must remain `depaudit lint`-clean — schema-valid `(package, version, finding-id)` identity, `reason` ≥20 chars, `expires` within the 90-day cap, and valid YAML/TOML syntax.

This is a markdown-only change to `.claude/skills/depaudit-triage/SKILL.md`. The contract is expressed as prompt instructions and verified by BDD content-assertion scenarios, matching the pattern established in issues #436 and #437.

## User Story
As a developer triaging dependency audit findings
I want the triage skill to auto-file tracked issues (on my own repo for major bumps, on the dep's repo for transitive-fix cases) and record them as short-lived accept entries
So that breaking-change work is visible to my team, upstream fixes flow through the dependency's maintainers, and the gate doesn't freeze unrelated PRs while the tracked work is in flight — all without manual issue filing or YAML edits

## Problem Statement
After #436 and #437 land, the `/depaudit-triage` skill still cannot complete two key remediation paths from the PRD:

1. **Major bumps** (PRD §Remediation policy §2, user stories 34–37): Currently the skill refuses and tells the user "the autonomous major-bump action lands in a future issue." This forces developers to manually file an issue, write the accept entry, link them, and copy the stable title format — exactly the tedium the skill was built to eliminate. Without the auto-filing flow, major-bump findings either (a) freeze unrelated PRs by remaining "new" with no accept, or (b) silently drop to `accept+document` with no tracked follow-up.
2. **Upstream-issue filing** (PRD §Remediation policy §4, user stories 21–22): Action 3 is stubbed as "not yet wired." Without it, a developer who wants to file on the dep's own repo must leave the triage session, craft a title/body by hand, run `gh issue create --repo`, copy the URL back into the accept entry, and hope they remember the schema. The skill is meant to eliminate exactly this round-trip.

Both paths must be **idempotent** — re-invoking triage on a finding that already has a non-empty `upstreamIssue` must be a no-op (no duplicate issues, no re-filing). The idempotency guard from #436 already handles the *display* path (auto-skip with "in flight — issue #N"); this issue must guarantee that the two new filing paths respect the same guard so they can never bypass it.

Finally, both paths must write entries that pass `depaudit lint` without manual cleanup — so the files the skill produces are CI-safe on the very next scan.

## Solution Statement
Replace the Action 1 major-refuse stub and the Action 3 "not yet wired" stub in `.claude/skills/depaudit-triage/SKILL.md` with full instructions for the two filing paths, preserving every invariant already established by issues #436 (static snapshot, sequential walk, idempotency guard, `(package, version, finding-id)` identity, schema-valid writes) and #437 (semver classification, minor/patch autonomous flow, no re-scan, `target: false`).

**Major-bump path (inside Action 1, replacing the refuse stub):**

1. When semver classification determines `to.major > from.major`, enter the major-bump filing flow (do not apply the upgrade).
2. Re-check the idempotency guard for this finding identity `(package, version, finding-id)` — if an existing accept entry already has a non-empty `upstreamIssue`, auto-skip with the "in flight — issue #N" message and move to the next finding. This is a belt-and-braces second check; the entry could only have been written by a prior triage session or by the user hand-editing the file.
3. Prompt the user for the expiry (default 30 days from today; user-adjustable up to the 90-day cap). Validate the input: must be a valid ISO 8601 date, not in the past, and ≤ today + 90d. Re-prompt on invalid input.
4. Draft the issue:
   - **Title (exact format)**: `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)` where `<to-range>` is the smallest resolving range expressed as a semver range (e.g. `^2.0.0`, `>=2.0.0 <3.0.0`) so ADW's SDLC can pick the minimal version when it opens the upgrade PR.
   - **Body (required content)**: human-readable summary (package, from, to-range, finding-id, severity, source), a pointer to the originating finding, and the literal `/adw_sdlc` command on its own line so ADW immediately picks up the issue and runs the full SDLC.
5. Run `gh issue create --title <title> --body <body>` against the current repo (no `--repo` flag; default targets the current working directory's repo).
6. Capture the created issue URL/number from `gh`'s stdout.
7. Write the accept entry to the correct file based on `source`:
   - `source: "socket"` → `.depaudit.yml` `supplyChainAccepts`
   - `source: "osv"` → `osv-scanner.toml` `[[IgnoredVulns]]`
   Entry contents:
   - `package`, `version`, `alertType`/`id` — from the finding identity
   - `reason: "pending major-bump issue #N"` (where `#N` is the captured issue number)
   - `expires` — the user-selected or default (today + 30d) ISO 8601 date
   - `upstreamIssue` — the captured issue URL
   Respect identity: if an entry with the same `(package, version, finding-id)` already exists, update it (set/overwrite `upstreamIssue`, `reason`, `expires`). Do NOT create a duplicate.
8. Display a confirmation line: `Major-bump issue filed: <issue-url>. Accept entry written with 30-day expiry.` Advance to the next finding. Do NOT run `depaudit scan`.

**Upstream-issue path (Action 3, replacing the "not yet wired" stub):**

1. Re-check the idempotency guard — if an accept entry with a non-empty `upstreamIssue` already exists for this finding's identity, auto-skip with the "in flight — issue #N" message.
2. Resolve the dependency's repository coordinates (`<dep-owner>/<dep-repo>`). Preferred source: the finding's `repositoryUrl` or `upstreamRepo` field (if present in `findings.json`). Fallback: ask the user for `<owner>/<repo>` if not present.
3. Prompt for `reason` (≥20 chars) and `expires` (≤ today + 90d, default 30 days). Validate the same way as `accept+document`.
4. Draft the issue:
   - **Title**: `depaudit: <package>@<version> — <finding-id>` (concise, greppable, includes finding identity).
   - **Body (required content)**: human-readable finding description, severity, source, the package and version affected on the *downstream* side, a pointer back to the originating finding, and a short request asking the dependency's maintainers to address the issue. The body does NOT include `/adw_sdlc` — ADW integration is only for the current-repo major-bump path (per PRD; avoids loops on registered upstreams that are already handled by fix propagation).
5. Run `gh issue create --repo <dep-owner>/<dep-repo> --title <title> --body <body>`. Auto-files unconditionally — do not check whether the upstream is ADW-registered. Per PRD §Claude Code skill: "Auto-filing is unconditional of whether the upstream is ADW-registered."
6. Capture the returned issue URL.
7. Write the accept entry to the correct file (same schema rules as the major-bump path). Use the user-supplied `reason` and `expires`; set `upstreamIssue` to the captured URL. Respect `(package, version, finding-id)` identity — update existing entry rather than duplicate.
8. Display a confirmation line: `Upstream issue filed: <issue-url>. Accept entry written.` Advance to the next finding.

**Error handling (both paths):**
- `gh issue create` exit non-zero → surface stderr, do NOT write an accept entry (no orphan referencing a non-existent issue), move to the next finding.
- `gh` not on `PATH` → same handling: surface the error, do not write the accept entry.
- `<dep-owner>/<dep-repo>` empty or unresolvable (upstream path only) → treat as skip, do not call `gh`, do not write any entry; surface a clear message asking the user to retry after confirming the repo coordinates.

**Preserve every #436 / #437 invariant:**
- Skill stays `target: false` (no propagation to target repos via `adw_init`).
- Static snapshot — no `depaudit scan` call at any point (including after successful filing).
- Sequential walk and four-action menu unchanged.
- `(package, version, finding-id)` identity preserved; update-not-duplicate.
- Schema-valid writes — the entry must pass `depaudit lint` (required fields, `reason ≥20 chars`, `expires` within the 90-day cap).
- Idempotency guard — no duplicate issue filings.

Because the skill file is pure markdown (a Claude Code prompt), the contract is expressed as prompt instructions and verified by BDD content-assertion scenarios — exactly the pattern used in issues #436 and #437.

## Relevant Files
Use these files to implement the feature:

- `.claude/skills/depaudit-triage/SKILL.md` — The skill prompt to update. Action 1 currently contains the major refuse stub (output: "Major bump required: `<package> <from> → <to>`. The skill refuses to apply major bumps in this slice — the autonomous major-bump action lands in a future issue..."). Action 3 currently contains the stub (output: "Not yet wired — coming in a future issue. Treat as skip and move to the next finding."). Both stubs must be replaced with the full filing flows described in Solution Statement. The Notes section must gain a bullet explaining the major-bump auto-file behavior and a bullet on upstream-issue auto-filing.
- `specs/prd/depaudit.md` — Parent PRD. Primary references:
  - §Remediation policy §2 (major upgrade): specifies the stable title format `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`, the `/adw_sdlc` body embedding, the default 30-day accept (user-adjustable up to the 90-day cap), and the current-repo-only filing rule.
  - §Remediation policy §4 (file upstream issue): specifies the `gh issue create --repo <dep-owner>/<dep-repo>` flow and the URL capture.
  - §Claude Code skill: reiterates idempotency (non-empty `upstreamIssue` → in-flight) and "auto-filing is unconditional of whether the upstream is ADW-registered."
  - §In-repo artifacts: schema reference for `.depaudit.yml` `supplyChainAccepts` and `osv-scanner.toml` `[[IgnoredVulns]]` — the entries must match so `depaudit lint` passes.
  - User stories 20, 21, 34, 35, 36, 37.
- `specs/issue-436-adw-1w5uz8-depaudit-triage-skil-sdlc_planner-depaudit-triage-skill.md` — Prior spec (#436) establishing the skill's frontmatter, sequential walk, idempotency guard placement, and schema-valid write rules. All invariants preserved here.
- `specs/issue-437-adw-4r5z44-depaudit-triage-skil-sdlc_planner-depaudit-minor-patch-upgrade.md` — Prior spec (#437) establishing the semver classification and the major-refuse stub that this issue replaces. This spec also defines the content-assertion BDD pattern that new scenarios will follow.
- `app_docs/feature-1w5uz8-depaudit-triage-skill.md` — Conditional doc. Documents the existing skill's contract (stubbed `upgrade parent` and `accept+file-upstream-issue`, `target: false`, idempotency, static snapshot). Read before touching SKILL.md.
- `app_docs/feature-yx99nx-depaudit-minor-patch-upgrade.md` / `app_docs/feature-4r5z44-depaudit-triage-minor-patch-upgrade.md` — Conditional docs. Document the minor/patch autonomous flow and the major-bump placeholder. Read before touching Action 1.
- `features/depaudit_triage_skill.feature` — Existing `@adw-436` scenarios. Must continue to pass.
- `features/depaudit_triage_upgrade_parent_minor_patch.feature` — Existing `@adw-437` scenarios. Must continue to pass. The phrases this feature actually asserts for the major case are `major`, `gh issue create`, and `/adw_sdlc` (verified by re-reading the feature file). The words `refuse` and `future issue` are NOT asserted. The wired major-bump flow in Action 1 naturally preserves the three asserted phrases (`major` appears throughout, `gh issue create` is the filing invocation, `/adw_sdlc` is embedded in the issue body).
- `features/step_definitions/depauditTriageSkillSteps.ts` — Existing step definitions for skill content assertions. Reused by the new scenarios.
- `features/step_definitions/commonSteps.ts` — Shared context (`sharedCtx.fileContent`) used by all file-reading step definitions. No change expected.
- `.adw/commands.md` — Project commands. `## Install Dependencies: bun install`. No change; read so the validation step knows which commands to run.
- `.adw/project.md` — Project config. `## Unit Tests: enabled`. Per guidance, skill/SKILL.md contract changes are verified via BDD content assertions (not unit tests), following the #436/#437 precedent.
- `.adw/conditional_docs.md` — Maps `/depaudit-triage` triage work to the three existing conditional docs. The existing entry's trigger conditions already cover this issue's scope ("When implementing the stubbed `accept+file-upstream-issue` action in future issues" and "When implementing the upcoming major-bump action (`accept+file-upstream-issue`) in a follow-up issue"). No change required during planning; the `/document` phase will update `app_docs/` entries after implementation.
- `guidelines/coding_guidelines.md` — Coding guidelines. Core principle: clarity over cleverness. Applies to SKILL.md prose and any step-definition TypeScript touched here.

### New Files
- `features/depaudit_triage_issue_filing.feature` — New BDD feature file tagged `@adw-438` containing content-assertion scenarios that verify the SKILL.md contains all the required instructional phrases for the major-bump and upstream-issue filing paths, plus the idempotency and lint-safety invariants. Follows the `@adw-436` and `@adw-437` content-assertion pattern exactly.

## Implementation Plan
### Phase 1: Foundation
Re-read the three source contracts and confirm the exact shape of the required SKILL.md changes:

- Re-read PRD §Remediation policy §2 (major upgrade) and §4 (file upstream issue) for the exact behavioral contract, title format, body contents, and the 30-day/90-day expiry rules.
- Re-read PRD §Claude Code skill for the idempotency semantics, the static-snapshot invariant, and the "auto-filing is unconditional of whether the upstream is ADW-registered" rule.
- Re-read `.claude/skills/depaudit-triage/SKILL.md` to locate (a) the Action 1 major-refuse stub that must be replaced (currently ~5 lines starting at "When the classification is a **major** bump...") and (b) the Action 3 stub ("Not yet wired — coming in a future issue. Treat as skip and move to the next finding.").
- Re-read `features/depaudit_triage_upgrade_parent_minor_patch.feature` to identify which `@adw-437` phrases the file must continue to contain. The asserted phrases relevant to the major case are `major`, `gh issue create`, and `/adw_sdlc` — all three of which the new Action 1 body will naturally contain. The words `refuse` and `future issue` do NOT appear as assertions in the `@adw-437` feature file (verified by grep), so there is no regression-retention obligation for that vocabulary. Do NOT modify the `@adw-437` feature file — this feature's regression safety relies on the existing contract.
- Confirm `.adw/commands.md` `## Install Dependencies` is `bun install` (already the case) so the validation commands resolve correctly.

### Phase 2: Core Implementation
Update `.claude/skills/depaudit-triage/SKILL.md`:

1. **Replace the Action 1 major-refuse stub** with the major-bump filing flow described in Solution Statement. The new body must contain (verbatim substrings, for BDD content assertions):
   - Title format literal: `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)` (this single literal also satisfies the scenario assertions for `<package>`, `<from>`, `<to-range>`, and `resolves <finding-id>`).
   - Body-embedding literal: `/adw_sdlc`
   - "Does not apply" language: the body must contain the exact phrase `does not apply` (asserted twice by `@adw-438` scenarios — e.g., "The skill does not apply the major bump directly; it files a tracked issue instead.").
   - Current-repo targeting: the phrase `current repo` must appear verbatim in the Action 1 body (asserted by `@adw-438`).
   - Default expiry: `30 days` or `30-day`, AND the literal word `default` near the expiry description, AND the literal string `expires`.
   - 90-day cap reference: `90 days` or `90-day`, AND the literal word `cap`, AND the literal word `adjust` (e.g., "user-adjustable up to the 90-day cap").
   - `gh issue create` (without `--repo` to target the current repo).
   - Idempotency re-check reference: `in flight` (matching the existing guard's vocabulary) and `upstreamIssue`.
   - Accept-entry schema: `upstreamIssue`, `reason`, `expires`.
   - Reason template: `pending major-bump issue #` (the skill must write this exact string as the reason).
   - No-duplicate guarantee: the phrase `no duplicate` must appear in the body (asserted by `@adw-438`).
   - `gh` failure handling: surface stderr, do NOT write an accept entry (avoid orphaned entries).
   - Advance without re-scan: `next finding` and explicit "no `depaudit scan`".
   - Keep `major` present (naturally occurs throughout; asserted by both `@adw-437` and `@adw-438`). No other `@adw-437` vocabulary obligations apply to Action 1 (`refuse` and `future issue` are NOT asserted by `@adw-437` — see Phase 1).

2. **Replace the Action 3 stub** with the upstream-issue filing flow described in Solution Statement. The new body must contain (verbatim substrings, for BDD content assertions):
   - `gh issue create --repo <dep-owner>/<dep-repo>` (literal, with the placeholder syntax — this single literal also satisfies the `gh issue create --repo` and `<dep-owner>/<dep-repo>` assertions).
   - Drafting vocabulary: the lowercase substrings `draft`, `title`, and `body` must each appear in the Action 3 body (asserted by `@adw-438` scenario "Upstream-issue action drafts a title and body"). Because the step definition uses case-sensitive `String.prototype.includes()`, a sentence-initial "Draft" (capital D) does NOT satisfy the `draft` check. Use lowercase phrasing such as "The skill drafts a concise title and body for the upstream issue…" — `drafts` contains the lowercase substring `draft`; lowercase `title` and `body` follow naturally.
   - Idempotency guard re-check: `in flight` and `upstreamIssue`.
   - `reason` minimum length `20` (reuse Action 2's validation language).
   - `expires` cap `90 days` with default `30 days`.
   - Accept-entry file routing: `.depaudit.yml` and `osv-scanner.toml` with the `supplyChainAccepts` / `[[IgnoredVulns]]` keys; the literal phrase `accept entry` must appear.
   - URL capture: the literal phrase `returned URL` must appear alongside `upstreamIssue` (asserted by `@adw-438`).
   - Upstream-facing vocabulary: the literal word `upstream` must appear in the Action 3 body (covered naturally by the prose "file an issue on the dependency's own repo" phrased with `upstream`).
   - "Auto-files unconditionally" language — the words `unconditional` (root — "unconditionally" satisfies "unconditional") and `ADW-registered` (explicit note that the skill does not check whether the upstream is ADW-registered).
   - `gh` failure handling: surface error, do NOT write the accept entry.
   - Missing repo coordinates handling: treat as skip, do not call `gh`.
   - Advance without re-scan: `next finding`.

3. **Update the `## Notes` section** with two new bullets:
   - Major-bump auto-filing: "Action 1 (`upgrade parent`) auto-files a tracked issue on the current repo when only a major bump resolves the finding; it embeds `/adw_sdlc` in the body so ADW runs the upgrade SDLC, and writes a short-lived accept entry (default 30 days, user-adjustable up to the 90-day cap) pointing to the filed issue."
   - Upstream-issue auto-filing: "Action 3 (`accept+file-upstream-issue`) runs `gh issue create --repo <dep-owner>/<dep-repo>` unconditionally (no ADW-registration check), captures the returned URL, and writes a schema-valid accept entry with `upstreamIssue` set."
   - Lint safety (optional, strongly recommended): "Every entry written by the skill (Actions 1, 2, 3) is in canonical schema form — `(package, version, finding-id)` identity, `reason ≥20 chars`, `expires ≤ today + 90d` — so `depaudit lint` passes on the very next scan."

4. **Preserve the existing idempotency guard** at the top of "Step 3: Walk Each Finding Sequentially" (the "Before presenting a finding" block). The new filing actions MUST NOT duplicate or relocate this guard; they MUST add a belt-and-braces re-check *inside the action body* so that if the user picks Action 1 (major) or Action 3 on a finding whose in-flight status changed mid-session (e.g., the `.depaudit.yml` was edited in another editor), the action still refuses to re-file.

5. **Preserve the menu layout** (four actions, unchanged order). The menu bullets must continue to read:
   - `1. upgrade parent` — the bullet description can be updated to: "autonomous minor/patch bump; for major bumps, files a tracked issue on the current repo and writes a short-lived accept entry"
   - `3. accept+file-upstream-issue` — the bullet description must be updated away from "not yet wired" to something like "file an issue on the dependency's own repo and record the URL in the accept entry"

### Phase 3: Integration
The skill remains `target: false`. No TypeScript code changes are strictly required. Add a new BDD feature file (`features/depaudit_triage_issue_filing.feature`) with `@adw-438` content-assertion scenarios covering every new behavior, and — only if any needed assertion form does not already exist — add minimal new step definitions to `features/step_definitions/depauditTriageSkillSteps.ts` in the style of the existing content-assertion steps.

The existing `@adw-436` and `@adw-437` feature files must not be edited. The new SKILL.md content must satisfy their assertions: specifically, the `@adw-437` scenarios that assert the presence of `major` (multiple places), `gh issue create`, `/adw_sdlc`, and the absence of `re-scan after each`. The Action 1 updated body will naturally retain all of these because the wired major-bump flow literally calls `gh issue create` and embeds `/adw_sdlc`. The words `refuse` and `future issue` are NOT asserted by `@adw-437` — the plan previously assumed they were; that assumption is retracted.

`.adw/conditional_docs.md` is not edited in this phase. The conditional doc entries currently flag "When implementing the stubbed `accept+file-upstream-issue` action in future issues" and the upcoming major-bump action — after this issue ships, the `/document` phase will update `app_docs/feature-1w5uz8-depaudit-triage-skill.md` (and related entries) to reflect the newly-wired actions; trigger conditions will be revised accordingly. That is explicitly out of scope for the *planning* and *build* phases.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read conditional docs and prior art
- Read `app_docs/feature-1w5uz8-depaudit-triage-skill.md` to confirm the existing skill's contract and idempotency guard.
- Read `app_docs/feature-yx99nx-depaudit-minor-patch-upgrade.md` and `app_docs/feature-4r5z44-depaudit-triage-minor-patch-upgrade.md` for the minor/patch context and the major-refuse stub that must be replaced.
- Re-read `specs/prd/depaudit.md` §Remediation policy §2 and §4, plus §Claude Code skill, to lock down the title format, body content, expiry rules, and the unconditional auto-file semantics for the upstream path.
- Re-read `.claude/skills/depaudit-triage/SKILL.md` to locate exactly where the Action 1 major-refuse stub and the Action 3 stub live. Note the surrounding text so the edits preserve every `@adw-437` asserted phrase.
- Read `features/depaudit_triage_upgrade_parent_minor_patch.feature` in full to identify every phrase the SKILL.md must continue to contain. Cross-reference `features/step_definitions/depauditTriageSkillSteps.ts` and `features/step_definitions/commonSteps.ts` to confirm the available step forms.

### Step 2: Draft the new Action 1 major-bump body
Plan the exact Markdown prose that will replace the Action 1 major-refuse stub. Include:
- A lead sentence identifying the major-bump case and stating the skill **does not apply** the major bump directly to the manifest; it files a tracked issue instead. The phrase `does not apply` must appear verbatim (asserted twice by `@adw-438`).
- Idempotency re-check bullet: "Re-check the idempotency guard for this finding's `(package, version, finding-id)` identity — if an existing accept entry already has a non-empty `upstreamIssue`, display `in flight — issue #N` and advance to the next finding without re-filing (no duplicate issue is created)." Ensure the phrase `no duplicate` appears verbatim (asserted by `@adw-438`).
- Expiry prompt bullet: "Prompt for expiry (**default** 30 days, user-**adjust**able up to the 90-day **cap**)." Ensures `default`, `adjust`, `cap`, `30`, `90`, and `expires` all appear in context.
- Title-format bullet: "Draft the issue title in the stable format: `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`."
- Body bullet: "Draft the issue body including the finding summary, severity, source, the resolving range, and the literal `/adw_sdlc` on its own line so ADW picks up the issue."
- `gh issue create` bullet: "Run `gh issue create --title <title> --body <body>` against the **current repo** (no `--repo` flag)." Ensure the phrase `current repo` appears verbatim (asserted by `@adw-438`).
- Capture bullet: "Capture the returned issue number `#N` and URL."
- Write-entry bullet: "Write (or update) an accept entry in the correct file based on `source` (`.depaudit.yml` for Socket / supply-chain findings; `osv-scanner.toml` for OSV / CVE findings) with `upstreamIssue` set to the URL, `reason` set to `pending major-bump issue #N`, and `expires` set to the chosen expiry. Respect `(package, version, finding-id)` identity — update existing entry rather than duplicate."
- `gh` failure bullet: "If `gh issue create` fails or `gh` is not on PATH, surface the error and do NOT write the accept entry — avoid orphaned entries that reference a non-existent issue. Move to the next finding."
- Advance bullet: "Display `Major-bump issue filed: <url>. Accept entry written with <N>-day expiry.` and advance to the next finding. Do NOT run `depaudit scan`."

### Step 3: Draft the new Action 3 upstream-issue body
Plan the exact Markdown prose that will replace the Action 3 stub. Include:
- Lead sentence: "File an issue on the dependency's own repository for transitive-fix cases and record the URL in the accept entry."
- Idempotency re-check: "Re-check the idempotency guard — if the finding already has a non-empty `upstreamIssue`, display `in flight — issue #N` and advance."
- Repo coordinates resolution: "Resolve `<dep-owner>/<dep-repo>` from the finding's `repositoryUrl` / `upstreamRepo` field; if absent, prompt the user for `<owner>/<repo>`. If the user provides no value, treat as skip — do NOT call `gh`."
- Reason prompt: "Prompt for `reason` (≥20 chars), validated the same way as `accept+document`."
- Expiry prompt: "Prompt for `expires` (default 30 days, ≤ today + 90 days), validated the same way as `accept+document`."
- Title/body: "The skill drafts a concise title (e.g., `depaudit: <package>@<version> — <finding-id>`) and a body describing the finding, severity, source, and a short request to the dep's maintainers." Use lowercase `drafts`, `title`, and `body` so the `@adw-438` case-sensitive content assertions `file contains "draft"`, `file contains "title"`, and `file contains "body"` all pass.
- `gh issue create --repo` bullet: "Run `gh issue create --repo <dep-owner>/<dep-repo> --title <title> --body <body>`. Auto-files unconditionally — do not check whether the upstream is ADW-registered."
- Capture URL: "Capture the returned URL."
- Write accept entry: "Write (or update) an entry in the correct file (`.depaudit.yml` or `osv-scanner.toml`) with `upstreamIssue` set to the URL. Respect `(package, version, finding-id)` identity."
- `gh` failure handling: "If `gh issue create` fails, surface the error and do NOT write the accept entry."
- Advance bullet: "Display `Upstream issue filed: <url>. Accept entry written.` Advance to the next finding."

### Step 4: Edit `.claude/skills/depaudit-triage/SKILL.md`
Using the prose drafted in Steps 2 and 3, edit the skill file:
- Replace the Action 1 major-refuse stub (currently the `**Step 3 (major): Major refuse flow**` block at roughly lines 98–104 of the current SKILL.md) with the new major-bump filing flow from Step 2. Keep the "Step 3 (major)" subheading but rename to "Step 3 (major): Major-bump issue filing flow" to reflect the wired behavior. Preserve the semver classification above it (unchanged).
- Replace the Action 3 body ("Not yet wired — coming in a future issue. Treat as skip and move to the next finding.") with the new upstream-issue filing flow from Step 3.
- Update the Action 1 menu bullet to: "autonomous minor/patch bump; for major bumps, files a tracked issue on the current repo and writes a short-lived accept entry" (or equivalent — retain the literal string `upgrade parent` so the `@adw-437` regression continues to pass).
- Update the Action 3 menu bullet away from "not yet wired" to: "file an issue on the dependency's own repo and record the URL in the accept entry" (retain the literal string `accept+file-upstream-issue` for the menu assertion).
- Append the three Notes bullets (major-bump auto-filing, upstream-issue auto-filing, lint safety) described in Phase 2 Step 3.
- Verify (by grep) that the following `@adw-437` asserted phrases remain present somewhere in the file: `semver`, `from`, `to`, `minor`, `patch`, `major`, `autonomous`, `smallest`, `resolves the finding`, `manifest`, `package.json`, `go.mod`, `.adw/commands.md`, `Install Dependencies`, `ecosystem default`, `cancel`, `before the install command runs`, `revert`, `install fail`, `no partial bump`, `workspace`, `next finding`, `static snapshot`, `upgrade parent`, `gh issue create`, `/adw_sdlc`. Verify the file does NOT contain `re-scan after each`.
- Verify (by grep) that the existing `@adw-436` asserted phrases remain present: sequential/static-snapshot/idempotency vocabulary unchanged.

### Step 5: Create `features/depaudit_triage_issue_filing.feature` with `@adw-438` scenarios
Write a new feature file following the `@adw-437` pattern exactly. Suggested scenarios (content-assertions over SKILL.md):

- Feature tag: `@adw-438`
- Background: `Given the ADW codebase is at the current working directory`

Major-bump path scenarios (one per acceptance criterion):
- "Action 1 major-bump path is wired (no longer 'future issue' refuse-only)": SKILL.md contains `depaudit: major upgrade` and `resolves <finding-id>`.
- "Major-bump issue title matches the stable format exactly": SKILL.md contains `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)` (entire title template as a verbatim substring).
- "Major-bump issue body embeds `/adw_sdlc`": SKILL.md contains `/adw_sdlc`.
- "Major-bump accept entry uses `pending major-bump issue #N` reason": SKILL.md contains `pending major-bump issue #`.
- "Major-bump accept entry defaults to 30-day expiry": SKILL.md contains `30 days` (or `30-day`) and `90 days` (or `90-day`) for the cap.
- "Major-bump accept entry records upstreamIssue": SKILL.md contains `upstreamIssue` in Action 1's body (tag-scoped assertion — "the file contains 'upstreamIssue'" is already sufficient).
- "Major-bump path calls `gh issue create` on current repo (no `--repo` flag)": SKILL.md contains `gh issue create` and does NOT contain `gh issue create --repo` in Action 1's immediate block (scenario can use the existing `Then the file contains <X>` form plus an ad-hoc assertion that the two substrings coexist; fall back to a dedicated step def if needed).
- "Major-bump path re-checks idempotency guard before filing": SKILL.md contains `in flight` in the Action 1 body.
- "Major-bump path does not run `depaudit scan`": SKILL.md contains explicit `Do NOT run` and `depaudit scan` near the major-bump flow.
- "Major-bump path handles `gh` failure without orphaning the accept entry": SKILL.md contains `gh issue create` fails and do NOT write / do not write language (content-assertion level).

Upstream-issue path scenarios:
- "Action 3 is wired (no longer 'not yet wired')": SKILL.md does NOT contain the exact phrase `not yet wired` (Action 3's prior stub), OR Action 3 subsection contains `file an issue on the dependency's own repo` / equivalent.
- "Upstream path calls `gh issue create --repo <dep-owner>/<dep-repo>`": SKILL.md contains `gh issue create --repo <dep-owner>/<dep-repo>`.
- "Upstream path captures the returned URL and records it as `upstreamIssue`": SKILL.md contains both `URL` and `upstreamIssue` in Action 3.
- "Upstream path auto-files unconditionally (no ADW-registration check)": SKILL.md contains `unconditionally` and `ADW-registered` (with negation) OR `without checking whether` phrasing.
- "Upstream path prompts for reason (≥20 chars) and expires (≤90 days)": SKILL.md contains `20` and `90 days` in the Action 3 body (reused from Action 2 language).
- "Upstream path re-checks idempotency guard before filing": SKILL.md contains `in flight` in the Action 3 body.

Idempotency invariant scenarios (shared):
- "Idempotency guard prevents duplicate filings": SKILL.md contains the `in flight` phrase at least twice (once in the original Step-3 guard, once inside either Action 1's major-bump body or Action 3's body).
- "No duplicate issue on re-invocation": SKILL.md contains `no duplicate` or `do not re-file` language.

Lint-safety invariant scenarios:
- "Accept entries are schema-valid (package, version, finding-id identity)": SKILL.md contains `(package, version, finding-id)` (existing) AND this identity rule is reaffirmed in the new Action 1 and Action 3 bodies.
- "`depaudit lint` passes on every file produced": SKILL.md contains `depaudit lint` or `lint` near the new actions, with an explicit mention that entries are "schema-valid" or the canonical schema.

Menu preservation scenarios:
- "Menu still presents the four top-level actions": reuses the existing data-table step `Then it contains a menu with at least these actions:` with rows `upgrade parent`, `accept+document`, `accept+file-upstream-issue`, `skip`.

Mark every scenario with both `@adw-438` and `@regression` (matching the #436 / #437 convention) so the full regression run catches contract drift.

### Step 6: Add any missing step definitions (likely none)
- Open `features/step_definitions/depauditTriageSkillSteps.ts` and verify that every step form used in the new feature file is already defined (directly or via `commonSteps.ts`'s `Then the file contains "..."` / `Then the file does not contain "..."`).
- The existing content-assertion steps (`Then the file contains {string}`, `Then the file does not contain {string}`, `Then it contains a menu with at least these actions:`) cover nearly all the new scenarios.
- If a scenario form does NOT map to an existing step, add a minimal step definition in `depauditTriageSkillSteps.ts` following the `function() { ... assert.ok(sharedCtx.fileContent.includes(...)) ... }` pattern. Do NOT add a `decorator` or other TypeScript cleverness; keep it small and direct.

### Step 7: Run validation commands
Run each validation command in sequence and confirm zero errors:
- `bun run lint`
- `bunx tsc --noEmit`
- `bunx tsc --noEmit -p adws/tsconfig.json`
- `bun run build`
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-438"` — new scenarios pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437"` — existing `@adw-437` contract preserved.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-436"` — existing `@adw-436` contract preserved.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — full regression safety net.

### Step 8: Manual spot-checks
Confirm the SKILL.md contains the expected phrases:
- `grep -c "depaudit: major upgrade — <package> <from>" .claude/skills/depaudit-triage/SKILL.md` should be ≥1.
- `grep -c "/adw_sdlc" .claude/skills/depaudit-triage/SKILL.md` should be ≥1.
- `grep -c "gh issue create --repo" .claude/skills/depaudit-triage/SKILL.md` should be ≥1.
- `grep -c "pending major-bump issue #" .claude/skills/depaudit-triage/SKILL.md` should be ≥1.
- `grep -c "not yet wired" .claude/skills/depaudit-triage/SKILL.md` should be ≤1 (only for Action 3 before this issue lands — after the edit, it should be `0` for Action 3 and only present, if at all, as historical commentary in a Notes bullet).
- `grep -c "upgrade parent" .claude/skills/depaudit-triage/SKILL.md` should be ≥2 (menu + Action 1 heading).
- `grep -c "accept+file-upstream-issue" .claude/skills/depaudit-triage/SKILL.md` should be ≥2 (menu + Action 3 heading).

## Testing Strategy
### Unit Tests
`.adw/project.md` has `## Unit Tests: enabled`, but this feature modifies a Claude Code skill prompt (pure Markdown) and adds a BDD feature file. No new TypeScript module or runtime function is introduced. The behavioral contract is expressed as prompt instructions and verified by BDD content-assertion scenarios — the same pattern used in issues #436 and #437 (per their `## Testing Strategy ### Unit Tests` sections: "this feature modifies a markdown-only SKILL.md file…no unit test tasks are planned"). Follow the same precedent here: no unit test tasks are planned for this feature.

If the implementation ends up adding any step-definition helper in TypeScript (Step 6), it is a content-assertion wrapper around the existing `sharedCtx.fileContent` — too thin to meaningfully unit-test independently of the Cucumber runtime. The BDD suite exercises those helpers directly.

### Edge Cases
- **Major bump with Socket finding** → entry written to `.depaudit.yml` `supplyChainAccepts` with all required fields.
- **Major bump with OSV finding** → entry written to `osv-scanner.toml` `[[IgnoredVulns]]` with `id`, `ignoreUntil`, `reason` (the equivalent of `upstreamIssue` and the 30-day expiry, expressed in the TOML schema). Note: the OSV-Scanner TOML schema does not include `upstreamIssue` natively. The skill must still record the URL — either by adding the link to the `reason` text ("pending major-bump issue #N (https://github.com/.../issues/N)") or by documenting the link in a comment above the entry. Pick the simplest canonical form: embed the URL in the `reason` field so `depaudit lint` (which only checks `reason`, `id`, and `ignoreUntil`) continues to pass. Document this decision in the SKILL.md so implementers follow the same convention.
- **Idempotency re-invocation** → skill auto-skips with "in flight — issue #N" before calling `gh`; no duplicate issue created.
- **User-adjustable expiry up to 90 days** → expiry prompt accepts values between today and today + 90 days; rejects past dates and values beyond the cap; defaults to today + 30 days on blank input.
- **`gh issue create` fails (auth error, offline, rate limit)** → skill surfaces the stderr, does NOT write an accept entry, advances to the next finding.
- **`gh` not on PATH** → same handling as `gh` failure; surface a clear "gh not available" message.
- **Upstream path — finding lacks `repositoryUrl`** → skill prompts user for `<owner>/<repo>`; if the user submits empty input, treat as skip (no `gh` call, no accept entry written).
- **Upstream path — unconditional auto-file** → skill does NOT check whether the upstream is ADW-registered; always calls `gh issue create --repo`.
- **Entry already exists for this identity** → skill updates the existing entry (set/overwrite `upstreamIssue`, `reason`, `expires`) rather than creating a duplicate — identity is the triple `(package, version, finding-id)`.
- **`depaudit lint` post-condition** → every file the skill writes passes `depaudit lint` without manual cleanup (required fields present, `reason` ≥20 chars, `expires` ≤ 90 days, valid YAML/TOML).
- **Static snapshot preserved** → skill does NOT call `depaudit scan` at any point in either new action; `findings.json` is read once in Step 1 and never refreshed.
- **Menu layout preserved** → four-action menu stays intact; Action 1 menu bullet is updated to reflect the newly-wired major-bump path; Action 3 menu bullet is updated away from "not yet wired."

## Acceptance Criteria
- [ ] `.claude/skills/depaudit-triage/SKILL.md` Action 1 contains the major-bump filing flow — no longer says "The skill refuses to apply major bumps in this slice." The Action 1 body contains the stable title format literal, the `/adw_sdlc` body embedding, the 30-day default expiry, the 90-day cap, the `gh issue create` invocation, the idempotency re-check, the schema-valid accept-entry write, and the `gh`-failure handling.
- [ ] `.claude/skills/depaudit-triage/SKILL.md` Action 3 contains the upstream-issue filing flow — no longer says "Not yet wired — coming in a future issue." Contains `gh issue create --repo <dep-owner>/<dep-repo>`, URL capture, `upstreamIssue` recording, unconditional auto-filing (no ADW-registration check), `reason` and `expires` prompts with the same validation as Action 2.
- [ ] The idempotency guard is re-checked inside both Action 1 (major-bump) and Action 3 (upstream) bodies, not just at the top of Step 3. Re-invoking the triage on a finding that already has a non-empty `upstreamIssue` is a no-op — no duplicate issue is filed.
- [ ] Every accept entry written by the skill (Actions 1, 2, and 3) is schema-valid: `(package, version, finding-id)` identity, `reason ≥20 chars`, `expires ≤ today + 90d`. `depaudit lint` passes on every file produced.
- [ ] `.claude/skills/depaudit-triage/SKILL.md` retains the `target: false` frontmatter (no `adw_init` propagation).
- [ ] `.claude/skills/depaudit-triage/SKILL.md` retains all `@adw-436` and `@adw-437` asserted phrases — the existing regression scenarios continue to pass without editing those feature files.
- [ ] `features/depaudit_triage_issue_filing.feature` exists with `@adw-438` content-assertion scenarios covering every new behavior. Each scenario is also tagged `@regression` so the full regression suite catches drift.
- [ ] `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, and `bun run build` all pass with zero errors.
- [ ] `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-438"`, `"@adw-437"`, `"@adw-436"`, and `"@regression"` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Lint TypeScript (any step-definition changes).
- `bunx tsc --noEmit` — Root TypeScript type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check.
- `bun run build` — Full TypeScript build.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-438"` — Run the new `@adw-438` scenarios for this issue.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437"` — Verify the minor/patch upgrade contract still passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-436"` — Verify the original skill contract still passes.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite.
- `grep -c "depaudit: major upgrade — <package> <from>" .claude/skills/depaudit-triage/SKILL.md` — Confirm the stable title format literal is present (should return ≥1).
- `grep -c "/adw_sdlc" .claude/skills/depaudit-triage/SKILL.md` — Confirm the ADW SDLC trigger is embedded in the major-bump body (should return ≥1).
- `grep -c "gh issue create --repo" .claude/skills/depaudit-triage/SKILL.md` — Confirm the upstream-issue `gh` invocation is present (should return ≥1).
- `grep -c "pending major-bump issue #" .claude/skills/depaudit-triage/SKILL.md` — Confirm the reason template is present (should return ≥1).
- `grep -c "not yet wired" .claude/skills/depaudit-triage/SKILL.md` — Confirm Action 3's stub text is gone (should return ≤1, and only if retained as historical note in the Notes section).

## Notes
- The `guidelines/` directory exists and must be followed. The core principle that applies here is "clarity over cleverness" — the Action 1 and Action 3 bodies must read as step-by-step prose so Claude can follow them at invocation time. No decorators; no clever abstractions; plain Markdown bullets and headings.
- **Markdown-only change**: `SKILL.md` is a Claude Code prompt, not compiled code. No runtime library is required. No `bun add` is needed. The behavioral contract is verified by BDD content-assertion scenarios — this is the pattern established by #436 and #437 and must be followed here for consistency.
- **No new dependency**: The skill instructs Claude to shell out to `gh` via the Bash tool, which is already available to skills. No new binary, no new npm package.
- **OSV accept entry schema quirk**: The `osv-scanner.toml` `[[IgnoredVulns]]` schema has `id`, `ignoreUntil`, and `reason` — it does NOT natively carry an `upstreamIssue` field. To keep the idempotency guard functional (which reads `upstreamIssue` from accept entries), the skill must ALSO write a parallel entry (or a cross-referenced pointer) in `.depaudit.yml` when filing an issue for a CVE finding. *OR* embed the issue URL in the OSV `reason` text and instruct the idempotency guard to recognize an "issue URL in reason" as equivalent to `upstreamIssue`. The simplest, least invasive approach is the second — embed the URL in `reason` as `pending major-bump issue #N — <url>` and document the convention in the SKILL.md so subsequent sessions recognize the format. The `.depaudit.yml` supply-chain schema carries `upstreamIssue` natively, so Socket/supply-chain findings use it as-is. Address this ambiguity explicitly in the build phase; pick the simpler of the two approaches and document the decision in SKILL.md.
- **Regression safety — `@adw-437` phrase preservation**: The `@adw-437` feature file asserts the presence of `major`, `gh issue create`, and `/adw_sdlc` in SKILL.md (plus the semver, manifest, install, cancel, and static-snapshot vocabulary — see the Step 4 grep list). All of these are naturally preserved by the wired major-bump flow in Action 1, which literally invokes `gh issue create` and embeds `/adw_sdlc`. The words `refuse` and `future issue` are NOT asserted by `@adw-437`; earlier drafts of this plan incorrectly claimed otherwise, and that requirement is retracted — no carryover sentence needs to be planted in the Notes section.
- **No `.adw/conditional_docs.md` edit during planning**: The `/document` phase (run after implementation) will update `app_docs/feature-1w5uz8-depaudit-triage-skill.md` and possibly add a new conditional-doc entry for this feature. The planning phase does not touch conditional docs.
- **Menu bullet wording**: The two menu bullets for Actions 1 and 3 are descriptive text, not assertion-critical. The key literals that must remain are the action names themselves (`upgrade parent` and `accept+file-upstream-issue`), which are verified by `Then it contains a menu with at least these actions:` in the `@adw-436` and `@adw-437` feature files.
- **No `$ARGUMENTS` change**: The skill's existing `$ARGUMENTS` handling (optional custom path to `findings.json`) is unchanged by this feature.
- **No scanner changes**: The `depaudit` CLI itself (in `paysdoc/depaudit`) is not modified by this issue. This is a pure skill-level wiring change in ADW. The PRD blocker `paysdoc/depaudit#8` (from #436) does not apply here — the skill can be implemented and tested entirely against `features/depaudit_triage_issue_filing.feature`'s content assertions.
