# Feature: depaudit-triage skill — major-bump issue filing + upstream-issue filing + idempotency

## Metadata
issueNumber: `438`
adwId: `oev65s-depaudit-triage-skil`
issueJson: `{"number":438,"title":"depaudit triage skill: major-bump issue filing + upstream-issue filing + idempotency","body":"## Parent PRD\n\n`specs/prd/depaudit.md` (in paysdoc/depaudit)\n\n## What to build\n\nCompletes the `/depaudit-triage` action menu.\n\n**Major-bump path** (within the `upgrade parent` action). When only a major bump resolves the finding:\n\n1. File an issue on the CURRENT repo via `gh issue create` with title `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)` and body embedding `/adw_sdlc`.\n2. Write an accept entry (`.depaudit.yml` or `osv-scanner.toml`) with `upstreamIssue` pointing to the new issue, `reason: \"pending major-bump issue #N\"`, `expires: today + 30d` (user-adjustable up to the 90-day cap).\n3. Advance.\n\n**Upstream-issue path** (separate menu action, for transitive-fix cases): skill drafts title and body, runs `gh issue create --repo <dep-owner>/<dep-repo>` to post to the dependency's OWN repo, records the URL in `upstreamIssue`. Auto-files unconditionally (no ADW-registration check — per PRD).\n\n## Acceptance criteria\n\n- [ ] Major-bump detection triggers the issue-filing path (not a direct upgrade).\n- [ ] Issue title matches the stable format exactly.\n- [ ] Issue body embeds `/adw_sdlc`.\n- [ ] Accept entry written with correct `upstreamIssue`, `reason`, and default 30-day expiry.\n- [ ] Upstream-issue action files on the dep's repo, captures the returned URL, writes an accept entry.\n- [ ] Idempotency: re-invoking on an already-in-flight finding is a no-op (no duplicate issue).\n- [ ] `depaudit lint` passes on every file produced.\n\n## Blocked by\n\n- Blocked by #437\n\n## User stories addressed\n\n- User story 20\n- User story 21\n- User story 34\n- User story 35\n- User story 36\n- User story 37\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-17T13:27:51Z","comments":[],"actionableComment":null}`

## Feature Description
Completes the `/depaudit-triage` Claude Code skill action menu by wiring the remaining two mutation paths that issue #436 stubbed and issue #437 left for a follow-up:

1. **Major-bump issue filing** — replaces the current "major refuse" text inside Action 1 (`upgrade parent`). When the only upgrade target that resolves a finding is a major bump of the direct parent, the skill **files a tracked issue on the current repository** (title format: `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`) with `/adw_sdlc` in the body. On ADW-registered repositories, ADW automatically picks up the filed issue and runs the full SDLC to produce the upgrade PR. The skill then writes a short-lived accept entry (default 30-day expiry, user-adjustable up to the 90-day cap) with `upstreamIssue` pointing to the new issue so the gate does not freeze unrelated PRs while the upgrade work is in flight.

2. **Upstream-issue filing** — replaces the current "Not yet wired" stub inside Action 3 (`accept+file-upstream-issue`). For transitive-fix cases (the fix must come from the dep's maintainers), the skill drafts an issue title and body, runs `gh issue create --repo <dep-owner>/<dep-repo>` against the dependency's own repository, captures the returned URL, and writes an accept entry with that URL in `upstreamIssue`. Per the PRD, the skill auto-files unconditionally — no ADW-registration check.

3. **Idempotency reaffirmed** — both paths rely on the existing idempotency guard introduced in issue #436 (findings with a non-empty `upstreamIssue` on their accept entry are auto-skipped as "in flight — issue #N"). Re-invoking the skill on an already-in-flight finding must be a no-op; no duplicate issue is filed. This issue adds a second layer: before filing the issue the skill *re-checks* for an existing in-flight entry and short-circuits if found (belt-and-suspenders against race conditions where two triage sessions run concurrently on the same finding).

The work is entirely a markdown edit to `.claude/skills/depaudit-triage/SKILL.md` plus new `@adw-438` BDD content-assertion scenarios, mirroring the approach used in issues #436 and #437.

## User Story
As a developer triaging dependency audit findings
I want the triage skill to (1) file a tracked major-bump issue (with a short-lived accept) when a parent needs a major version bump, and (2) auto-file an upstream issue on the dependency's own repo when the fix must come from the dep's maintainers
So that breaking-change upgrades become visible engineering work ADW can pick up, transitive-fix needs flow to the dep's maintainers automatically, and neither path is silently skipped or duplicated across re-invocations

## Problem Statement
After issue #437 the `upgrade parent` action handles minor/patch autonomously and **refuses** major bumps with only a textual pointer to a future issue. The `accept+file-upstream-issue` action still says "Not yet wired." This leaves two gaps in the workflow encoded by PRD §Remediation policy:

- **Major bumps stall.** Today the developer is told to choose `accept+document` or `skip` for major bumps. That writes an accept entry (fine) but produces no tracking issue, so the real work of doing the major upgrade is not queued for ADW to pick up. User stories 20, 34–37 explicitly ask for an auto-filed issue with a stable greppable title and `/adw_sdlc` in the body.
- **Upstream fixes have no path.** Transitive vulnerabilities (the direct parent can't be upgraded; the fix must come from the grand-parent's maintainers) have no way out of the triage session. Today the user must manually run `gh issue create --repo <dep-owner>/<dep-repo>` and paste the URL into an accept entry. User story 21 asks for the skill to do this automatically.
- **Re-invocation risk.** Without a strong idempotency layer, re-running the skill on the same finding between scans could duplicate-file the issue (both on the current repo for major-bump and on the dep's repo for upstream-issue).

## Solution Statement
Extend `.claude/skills/depaudit-triage/SKILL.md` with three coordinated changes:

1. **Replace the Action 1 major refuse flow with a major-bump issue-filing flow.** When the classification is major:
   - Compose the issue title using the stable greppable format: `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`. The `<to-range>` uses the smallest resolving major version plus a compatible range (e.g., `^8.0.0` for a `to` of `8.1.2` in npm, `v2` for Go modules).
   - Compose a body that embeds `/adw_sdlc` (so ADW automatically runs the full SDLC on the issue). The body must also include a short context block: the package, `from`, `to-range`, finding-id, severity, and a pointer back to the triggering finding summary.
   - Before filing, re-check for an in-flight entry (idempotency belt-and-suspenders). If one already exists with a non-empty `upstreamIssue`, skip the file call and reuse the existing URL.
   - Run `gh issue create --title <title> --body <body>` (no `--repo` — the issue goes on the *current* repo). Capture the returned URL from `gh`'s stdout.
   - Prompt the user for an expiry (default 30 days; cap 90 days per PRD). Validate the input the same way `accept+document` does.
   - Write a short-lived accept entry to the correct file (`.depaudit.yml` supplyChainAccepts if `source: "socket"`; `osv-scanner.toml` [[IgnoredVulns]] if `source: "osv"`). The entry's `upstreamIssue` is the filed issue URL; `reason` is `pending major-bump issue #N` (where `N` is the issue number parsed from the URL); `expires` is the user-confirmed date.
   - Advance to the next finding (no re-scan — static snapshot invariant preserved).

2. **Replace the Action 3 stub with an upstream-issue-filing flow.** When the user selects Action 3:
   - Derive `<dep-owner>/<dep-repo>` from the finding's dependency metadata. The finding's `repository` field (set by `OsvScannerAdapter` / `SocketApiClient` from the package's registry metadata) is the source of truth. If the repository field is missing or malformed (no reliable upstream), fall back to prompting the user for the owner/repo slug.
   - Re-check idempotency (same belt-and-suspenders as above).
   - Draft a title (e.g., `<package> <version>: <finding-id> — please advise on resolution`) and body (finding summary, affected package+version, the finding-id, a link/reference where the reporter can reason about the issue, and a note that the issue was auto-filed by a downstream consumer via depaudit).
   - Run `gh issue create --repo <dep-owner>/<dep-repo> --title <title> --body <body>`. Capture the returned URL.
   - Prompt for `reason` (≥20 chars) and `expires` (≤ 90 days), same as `accept+document`.
   - Write the accept entry to the correct file with `upstreamIssue` set to the filed URL.
   - Advance to the next finding.

3. **Add an explicit pre-file idempotency re-check** inside both flows. Even though the existing guard (Step 3 of the skill, before presenting the menu) already auto-skips in-flight findings, the post-choice flow re-reads the config file immediately before running `gh issue create` and short-circuits if a matching entry with `upstreamIssue` is now present. This guards against duplicate filing when two triage sessions race on the same finding.

All schema work — `.depaudit.yml` supplyChainAccepts layout and `osv-scanner.toml` [[IgnoredVulns]] layout — was already defined in issue #436 and is reused verbatim. The only new schema considerations are the specific values for `upstreamIssue`, `reason`, and `expires` (default 30 days for major-bump vs user-chosen for upstream-issue).

The skill remains `target: false` (lives in ADW; not copied to target repos). No TypeScript/runtime code changes; the behavioral contract is expressed as prompt instructions and verified with BDD content-assertion scenarios.

## Relevant Files
Use these files to implement the feature:

- `.claude/skills/depaudit-triage/SKILL.md` — The skill prompt that must be updated. Replace the major refuse flow inside Action 1 with the major-bump issue-filing flow, and replace the Action 3 stub with the upstream-issue-filing flow. Preserve all other sections (idempotency guard, sequential walk, Action 2, Action 4, Step 5 completion summary, Notes).
- `specs/prd/depaudit.md` — Parent PRD defining the remediation policy (§Remediation policy §§ 2, 4), the auto-fiscal issue title format (user story 37), the `/adw_sdlc` embed (user story 35), and the short-lived accept entry with 30-day default (user story 36). User stories 20, 21, 34–37 carry the full behavioral contract.
- `specs/issue-436-adw-1w5uz8-depaudit-triage-skil-sdlc_planner-depaudit-triage-skill.md` — Prior spec that created the skill. Reference for the sequential walk, idempotency guard placement, accept entry schemas, and `$ARGUMENTS` convention that must all be preserved.
- `specs/issue-437-adw-4r5z44-depaudit-triage-skil-sdlc_planner-depaudit-minor-patch-upgrade.md` — Immediate parent spec (this issue is blocked by #437). Defines how Action 1 is currently structured (semver parsing → minor/patch autonomous flow → major refuse flow). The major refuse flow is what this issue replaces.
- `app_docs/feature-1w5uz8-depaudit-triage-skill.md` — Conditional-docs entry that must be read before touching the skill. Documents the existing skill and calls out `accept+file-upstream-issue` as a stub awaiting this issue.
- `app_docs/feature-yx99nx-depaudit-minor-patch-upgrade.md` and `app_docs/feature-4r5z44-depaudit-triage-minor-patch-upgrade.md` — Companion feature docs for issue #437. They describe the current major refuse flow that this issue replaces. Must be read for full context.
- `features/depaudit_triage_skill.feature` — Existing `@adw-436` BDD feature file. All scenarios must continue to pass (the four-action menu layout, `accept+document`, `skip`, idempotency guard, static snapshot).
- `features/depaudit_triage_upgrade_parent_minor_patch.feature` — Existing `@adw-437` BDD feature file. All scenarios must continue to pass; in particular the minor/patch autonomous flow and the menu-preserved scenario.
- `features/step_definitions/depauditTriageSkillSteps.ts` — Existing step definitions for the `@adw-436` scenarios. Re-usable verbatim for most new `@adw-438` scenarios; extend only if a new assertion form is needed.
- `features/step_definitions/commonSteps.ts` — Shared step defs (`Given the file ".../SKILL.md" is read`, `Then the file contains "<phrase>"`, `Then the file does not contain "<phrase>"`). Re-use as-is.
- `.adw/commands.md` — Project command configuration. The `## Install Dependencies` section is referenced by Action 1's minor/patch flow (unchanged in this issue).
- `.adw/conditional_docs.md` — Maps skill work to conditional docs. The existing entry for `app_docs/feature-1w5uz8-depaudit-triage-skill.md` already covers "implementing the stubbed `accept+file-upstream-issue` action in future issues" and "troubleshooting idempotency behavior (in-flight findings with `upstreamIssue`)"; no change needed.
- `guidelines/coding_guidelines.md` — Clarity-over-cleverness, meaningful structure, modularity. Applies to the prompt markdown body.

### New Files
- `features/depaudit_triage_issue_filing.feature` — New `@adw-438` BDD feature file with content-assertion scenarios that verify SKILL.md contains the major-bump issue-filing instructions, the upstream-issue-filing instructions, the idempotency re-check, and the four-action menu still listing `upgrade parent`, `accept+document`, `accept+file-upstream-issue`, `skip`.

## Implementation Plan
### Phase 1: Foundation
Read and internalize the schema contracts and behavioral constraints. No code changes yet.

1. Re-read the PRD's §Remediation policy §2 (major upgrade → file issue on current repo) and §4 (accept + file upstream issue on dep's repo). Confirm the issue title format (`depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`), the `/adw_sdlc` embed, the default 30-day expiry (user-adjustable up to 90 days), and the "auto-files unconditionally" rule for upstream issues.
2. Re-read user stories 20, 21, 34–37 for the developer-facing contract. User story 34 emphasizes the refuse-to-bump-directly semantic. User story 35 demands `/adw_sdlc` in the body. User story 36 fixes the 30-day default. User story 37 fixes the exact title format.
3. Re-read `.claude/skills/depaudit-triage/SKILL.md` to see exactly where Action 1's major refuse flow starts and ends, and where Action 3's stub lives. Map out the exact text blocks that will be replaced vs preserved.
4. Re-read `features/depaudit_triage_skill.feature` and `features/depaudit_triage_upgrade_parent_minor_patch.feature` to understand the content-assertion pattern and the menu-preservation assertions that must continue to pass.
5. Re-read `features/step_definitions/depauditTriageSkillSteps.ts` and `features/step_definitions/commonSteps.ts` to catalog the available content-assertion step forms.
6. Confirm the title format precisely. PRD says `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`. Note: the em-dash is `—` (U+2014); the arrow is `→` (U+2192). These Unicode characters must appear verbatim in SKILL.md because the BDD assertions check them as substrings.

### Phase 2: Core Implementation
Edit `.claude/skills/depaudit-triage/SKILL.md` in three places:

#### 2.1 Replace the major refuse flow inside Action 1 with a major-bump issue-filing flow

Locate the subsection currently titled `**Step 3 (major): Major refuse flow**` and replace its body. The new body instructs Claude to:

1. **Pre-file idempotency re-check**: Re-read the relevant config file (`.depaudit.yml` if `source: "socket"`, else `osv-scanner.toml`). If an accept entry matching the finding's identity `(package, version, finding-id)` already exists with a non-empty `upstreamIssue`, display `Finding [finding-id] already in flight — issue #N` and advance to the next finding. Do not file a duplicate issue. Do not write a duplicate accept entry.
2. **Compose the issue title**: Use the exact greppable format `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`. `<to-range>` is derived from the smallest resolving major version: for npm use `^<major>.0.0` (e.g., `^8.0.0`); for Go modules use the major-version module path suffix convention (`v2`, `v3`, etc.); for Cargo use `^<major>`; for Python semver use `~=<major>.0`; for ecosystems without a conventional caret range fall back to `>=<to>` and leave open-ended.
3. **Compose the issue body**: Include a top section with the developer-facing summary (the package, the `from` version, the `to-range`, the finding-id, severity, source) and then `/adw_sdlc` on its own line so ADW picks up the issue immediately. Include a footer noting that the issue was auto-filed by `/depaudit-triage`.
4. **File the issue**: Run `gh issue create --title <title> --body <body>` via the Bash tool. No `--repo` flag — the issue lands on the current repo. Capture stdout and extract the returned URL (e.g., `https://github.com/<owner>/<repo>/issues/<N>`).
5. **Prompt for expiry**: Prompt the user with the default 30-day expiry (`expires = today + 30 days`), and accept an override up to 90 days from today. Validate that the override is a valid ISO 8601 date, not in the past, and ≤ today + 90 days. Re-prompt if invalid.
6. **Write the short-lived accept entry**: Determine the target file based on `source` (same rule as `accept+document`). Write the entry with:
   - `package`, `version`, `alertType` / `id` = the finding-id
   - `reason` = `pending major-bump issue #N` (where `N` is the parsed issue number from the URL)
   - `expires` = the user-confirmed date
   - `upstreamIssue` = the filed issue URL
   Respect the `(package, version, finding-id)` identity: if an entry with the same identity already exists (unusual but possible under race), update it in place rather than create a duplicate.
7. **Advance**: Move to the next finding. Do not run `depaudit scan` (static snapshot invariant).

Add a cross-reference line at the top of the replaced block: `When the classification is a **major** bump, the skill files a tracked major-bump issue on the current repository and writes a short-lived accept entry pointing to that issue.` This line replaces the prior "refuse" intro and makes the new behavior unambiguous.

#### 2.2 Replace the Action 3 stub with the upstream-issue-filing flow

Locate `### Action 3: accept+file-upstream-issue` and replace its body (currently a one-line "Not yet wired" stub). The new body instructs Claude to:

1. **Determine upstream repo**: Read the finding's `repository` field (populated by `OsvScannerAdapter` / `SocketApiClient` from the package metadata). Parse as `<dep-owner>/<dep-repo>`. If the field is missing, malformed, or points to a non-GitHub host, prompt the user: `Enter the upstream repo as owner/repo (e.g., nodejs/node):` and validate it is two non-empty segments separated by `/`.
2. **Pre-file idempotency re-check**: Re-read the relevant config file and short-circuit if an accept entry with a non-empty `upstreamIssue` matching the finding's identity already exists. Display `Finding [finding-id] already in flight — issue #N` and advance.
3. **Compose the title**: A short, respectful title such as `<package>@<version>: <finding-id> — downstream report via depaudit`. Keep within 100 characters so it renders cleanly in GitHub's UI.
4. **Compose the body**: Include the finding summary (severity, source, description, affected version), a short explanation that the issue was auto-filed by a downstream consumer using `depaudit` (a dependency-audit CLI), a link or reference to the finding's canonical source (the OSV/Socket URL from the finding metadata), and a note that a response is not required but is appreciated.
5. **Prompt for `reason`**: Same as `accept+document` — minimum 20 characters. Re-prompt if too short.
6. **Prompt for `expires`**: Same as `accept+document` — ISO 8601, not in the past, ≤ today + 90 days. Re-prompt if invalid.
7. **File the issue**: Run `gh issue create --repo <dep-owner>/<dep-repo> --title <title> --body <body>`. Capture stdout and extract the returned URL. Auto-files unconditionally per PRD (no ADW-registration check). If `gh` fails (non-zero exit, e.g., permission denied on the upstream repo), display the error, do **not** write an accept entry, and move to the next finding — the user can then re-run and choose `accept+document` instead.
8. **Write the accept entry**: Determine the target file based on `source`. Write:
   - `package`, `version`, `alertType` / `id` = the finding-id
   - `reason` = the user-provided reason
   - `expires` = the user-provided date
   - `upstreamIssue` = the filed URL
9. **Advance**: Move to the next finding. No re-scan.

#### 2.3 Extend the `## Notes` section

Add three short bullets to the Notes section (at the bottom of SKILL.md):

- **Major-bump issue filing**: Action 1 files an issue on the current repo when the only resolving upgrade is a major bump. The issue's body embeds `/adw_sdlc` so ADW picks up the upgrade work immediately; the skill writes a short-lived accept entry (default 30 days, user-adjustable up to 90 days) that clears the gate for unrelated PRs while the upgrade is in flight.
- **Upstream-issue filing**: Action 3 files an issue on the dep's own repo via `gh issue create --repo <dep-owner>/<dep-repo>`, captures the URL, and writes an accept entry. Auto-files unconditionally (no ADW-registration check) — on ADW-registered upstreams the propagation loop self-resolves; on external repos the issue is a standard maintainer nudge.
- **Idempotency belt-and-suspenders**: Both Action 1 (major) and Action 3 re-check the config file for a matching in-flight entry immediately before running `gh issue create`, in addition to the existing pre-menu guard. A re-invocation on an already-in-flight finding is a no-op; no duplicate issue is filed.

#### 2.4 Update the menu description

The Action 1 menu label should remain `upgrade parent — autonomous minor/patch bump of the direct parent (major bumps refused in this slice)` — but `refused` is no longer accurate. Change the parenthetical to: `autonomous minor/patch bump of the direct parent; major bumps file a tracked issue on this repo`. The Action 3 menu label changes from `not yet wired (coming in a future issue)` to `file an issue on the dependency's own repository and record the URL in the accept entry`.

### Phase 3: Integration
The skill remains `target: false`. No TypeScript / runtime code changes. The existing skill structure (Steps 1–5, Action 2 `accept+document`, Action 4 `skip`, idempotency guard, static snapshot semantics) is preserved.

The new BDD scenarios use the content-assertion pattern from issues #436/#437: each scenario reads `SKILL.md` and asserts that specific instructional phrases are present (or absent). Step definitions are re-used from `depauditTriageSkillSteps.ts` and `commonSteps.ts` — no new step defs are expected unless a novel assertion form is required (unlikely).

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read conditional docs and prior art
- Read `app_docs/feature-1w5uz8-depaudit-triage-skill.md`, `app_docs/feature-yx99nx-depaudit-minor-patch-upgrade.md`, and `app_docs/feature-4r5z44-depaudit-triage-minor-patch-upgrade.md` to internalize the existing skill contract.
- Read `specs/prd/depaudit.md` §Remediation policy §§ 2, 4, §Claude Code skill, and user stories 20, 21, 34–37.
- Read the current `.claude/skills/depaudit-triage/SKILL.md` to locate the exact boundaries of Action 1's major refuse flow and Action 3's stub.
- Read `features/depaudit_triage_skill.feature` and `features/depaudit_triage_upgrade_parent_minor_patch.feature` for pattern reference.
- Read `features/step_definitions/depauditTriageSkillSteps.ts` and `features/step_definitions/commonSteps.ts` to catalog reusable step forms.
- Read `guidelines/coding_guidelines.md` to ensure the prompt follows project conventions (clarity-over-cleverness, meaningful structure).

### Step 2: Replace Action 1's major refuse flow with the major-bump issue-filing flow
- Edit `.claude/skills/depaudit-triage/SKILL.md`:
  - Locate the subsection `**Step 3 (major): Major refuse flow**` inside `### Action 1: upgrade parent`.
  - Replace its body with the seven-step major-bump issue-filing flow from Phase 2.1: pre-file idempotency re-check, compose title (exact format `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)`), compose body with `/adw_sdlc` on its own line, run `gh issue create` (no `--repo` flag), prompt for expiry (default 30, cap 90), write the short-lived accept entry with `upstreamIssue` pointing to the filed URL and `reason: pending major-bump issue #N`, advance.
  - Rename the subsection heading from `**Step 3 (major): Major refuse flow**` to `**Step 3 (major): File a tracked major-bump issue**` so the text matches the new behavior.
  - Preserve everything else inside Action 1 (the minor/patch autonomous flow, semver classification intro, the overall step numbering).

### Step 3: Replace Action 3's "Not yet wired" stub with the upstream-issue-filing flow
- Still editing `.claude/skills/depaudit-triage/SKILL.md`:
  - Locate `### Action 3: accept+file-upstream-issue` and its single-line body `Display: "Not yet wired — coming in a future issue." Treat as skip and move to the next finding.`
  - Replace that body with the nine-step upstream-issue-filing flow from Phase 2.2: derive upstream repo, pre-file idempotency re-check, compose title and body, prompt for `reason` and `expires`, run `gh issue create --repo <dep-owner>/<dep-repo>`, capture URL, write the accept entry with `upstreamIssue` set to the filed URL, advance.

### Step 4: Update the four-action menu text
- Still editing `.claude/skills/depaudit-triage/SKILL.md`:
  - Locate the numbered menu inside Step 3 (the section that displays `Choose an action: 1. upgrade parent ... 2. accept+document ... 3. accept+file-upstream-issue ... 4. skip`).
  - Change Action 1's parenthetical from `(major bumps refused in this slice)` to `; major bumps file a tracked issue on this repo`.
  - Change Action 3's parenthetical from `— not yet wired (coming in a future issue)` to `— file an issue on the dependency's own repository and record the URL in the accept entry`.
  - The menu must still include the four action keywords verbatim (`upgrade parent`, `accept+document`, `accept+file-upstream-issue`, `skip`) so the existing `@adw-436` and `@adw-437` menu-preservation scenarios continue to pass.

### Step 5: Extend the `## Notes` section
- Append three bullets to the Notes section at the bottom of `SKILL.md` per Phase 2.3:
  - Major-bump issue filing (Action 1 files a tracked issue on the current repo; body embeds `/adw_sdlc`; short-lived 30-day accept entry).
  - Upstream-issue filing (Action 3 files on the dep's own repo via `gh issue create --repo`; auto-files unconditionally).
  - Idempotency belt-and-suspenders (both paths re-check for an in-flight entry immediately before filing).

### Step 6: Author the `@adw-438` BDD feature file
- Create `features/depaudit_triage_issue_filing.feature` with `@adw-438` and `@regression` tags. Include content-assertion scenarios that verify, by reading `.claude/skills/depaudit-triage/SKILL.md`:

  - The menu still lists all four actions (`upgrade parent`, `accept+document`, `accept+file-upstream-issue`, `skip`).
  - The file contains the exact stable title format substring `depaudit: major upgrade —` (note the em-dash U+2014) and the arrow `→` (U+2192) and the `(resolves` prefix for the finding-id parenthesis.
  - The file contains `/adw_sdlc` (the embed that drives ADW pickup on the filed issue).
  - The file contains `gh issue create` (the CLI invocation for both paths).
  - The file contains `--repo` (to distinguish the upstream path from the current-repo path).
  - The file contains `30 days` or `30-day` (the default short-lived expiry for major-bump).
  - The file contains `90 days` or `90-day` (the cap, re-used from Action 2's expiry rule).
  - The file contains `upstreamIssue` (the accept-entry field).
  - The file contains `pending major-bump issue` (the canonical `reason` for the short-lived accept entry).
  - The file contains `auto-files unconditionally` or `no ADW-registration check` (the upstream path is unconditional per PRD).
  - The file contains `idempotency` and `in flight` and `non-empty` (the guard + pre-file re-check).
  - The file does NOT contain the phrase `Not yet wired` for Action 3 anymore (the previous stub text must be removed). The file may still contain `not yet wired` elsewhere if any future action stubs remain, but NOT in the Action 3 body.
  - The file contains `next finding` (advance semantics) and `static snapshot` (no re-scan).
  - The file contains `depaudit: major upgrade —` and `(resolves` (matching the stable title format).
  - The file does NOT contain `refuse` as the major-flow verb anymore (previously the slice said `refuse`; now it *files* an issue). The word `refuse` may still appear in the minor/patch flow for historical phrasing, but NOT in the Action 1 major-bump block body. Use a narrower assertion: the Action 1 major-bump subsection heading must not start with `Major refuse`.

  Scenario-per-assertion style matches issue #437's feature file. Reuse step forms from `commonSteps.ts` (`Given the file "..." is read`, `Then the file contains "..."`, `Then the file does not contain "..."`) and `depauditTriageSkillSteps.ts` (`Then it contains a menu with at least these actions:`). No new step defs are expected.

### Step 7: Add step-definition helpers if needed
- Open `features/step_definitions/depauditTriageSkillSteps.ts`. For each step used in `features/depaudit_triage_issue_filing.feature`, verify a step def exists. The needed forms are:
  - `Given the file "<path>" is read` — already in `commonSteps.ts`.
  - `Then the file contains "<phrase>"` — already in `commonSteps.ts`.
  - `Then the file does not contain "<phrase>"` — already in `commonSteps.ts`.
  - `Then it contains a menu with at least these actions:` (data-table) — already in `depauditTriageSkillSteps.ts`.
- If any new form is needed (e.g., regex match, conditional presence), add a minimal step def following the existing pattern (function() syntax, `sharedCtx.fileContent`, `assert.ok(content.includes(...))`). Keep additions in `depauditTriageSkillSteps.ts` next to the existing skill step defs.

### Step 8: Run validation commands
Execute all Validation Commands below to confirm the plan is implemented correctly with zero regressions.

## Testing Strategy

### Unit Tests
Unit tests are enabled for this project (per `.adw/project.md` `## Unit Tests: enabled`). However, this feature modifies a markdown-only `SKILL.md` file (a Claude Code skill prompt) and adds a BDD feature file. There is no new TypeScript module or function to unit-test. The behavioral contract is expressed as prompt instructions and verified by BDD content-assertion scenarios, consistent with issues #436 and #437. No unit test tasks are planned.

### Edge Cases
- **Major-bump target range conventions vary by ecosystem.** npm uses `^8.0.0`; Go modules use `v2`, `v3`; Cargo uses `^8`; Python may use `~=8.0`. The prompt instructs Claude to pick the convention based on the finding's ecosystem; unusual ecosystems (Maven, Composer) fall back to `>=<to>` open-ended.
- **`gh issue create` fails** (authentication, rate limit, upstream repo archived/private, network error). Skill surfaces the error, does NOT write an accept entry, moves to the next finding. User can retry or pick `accept+document` on the next run.
- **Upstream repo field missing/malformed.** Skill prompts the user for the owner/repo slug. If the user declines (e.g., ^C), skill treats the action as a skip and does not write anything.
- **Race condition: two triage sessions on the same finding.** Both paths' pre-file idempotency re-check catches the case where session A filed between session B's menu selection and its `gh issue create` call. Session B short-circuits and reports the in-flight issue.
- **`source` is neither `"socket"` nor `"osv"`.** The skill's accept-entry targeting is already defined for these two sources; an unknown source is out of scope for this issue (the classifier only emits those two). If such a finding appears, the skill should treat it as unknown and display a clear message before skipping.
- **Issue title exceeds GitHub's 256-char limit.** Unlikely for the major-bump format but possible with an extremely long package name. No automatic truncation; skill files the title as-composed and lets `gh issue create` return the error if it rejects. The accept entry is not written if `gh` fails.
- **Accept entry identity collision.** If an entry with the same `(package, version, finding-id)` already exists but has an empty `upstreamIssue`, the new flow updates that entry in place rather than creating a duplicate — matching the identity-respect rule from issue #436.
- **User-adjusted expiry exceeds 90 days.** Re-prompt per existing `accept+document` validation; the 90-day cap is the same for both actions.
- **User-adjusted expiry is below 30 days.** Accepted — the 30 days is only a default; the user may choose a shorter window.
- **URL parsing from `gh issue create` output.** `gh` prints the issue URL on stdout. Parse it as `https://github.com/<owner>/<repo>/issues/<N>` and extract `<N>` for the `reason: pending major-bump issue #N` text. If parsing fails, fall back to using the full URL without the `#N` shorthand.
- **Re-invocation on already-in-flight finding.** Both the pre-menu idempotency guard (from issue #436) AND the new pre-file idempotency re-check must catch this. The pre-menu guard auto-skips before even showing the menu. The pre-file re-check is defensive for race conditions.

## Acceptance Criteria
- [ ] `.claude/skills/depaudit-triage/SKILL.md` Action 1's major-bump flow no longer says "refuses" — it files a tracked issue on the current repo.
- [ ] The SKILL.md file instructs Claude to compose the issue title in the exact stable format: `depaudit: major upgrade — <package> <from> → <to-range> (resolves <finding-id>)` (em-dash U+2014, arrow U+2192).
- [ ] The SKILL.md file instructs Claude to embed `/adw_sdlc` in the issue body so ADW picks up the issue.
- [ ] The SKILL.md file instructs Claude to write a short-lived accept entry with `upstreamIssue` set to the filed issue URL, `reason: pending major-bump issue #N`, and a default 30-day expiry (user-adjustable up to 90 days).
- [ ] The SKILL.md file Action 3 no longer says "Not yet wired." It instructs Claude to run `gh issue create --repo <dep-owner>/<dep-repo>`, capture the returned URL, prompt for `reason` and `expires`, and write an accept entry with `upstreamIssue` set to the filed URL.
- [ ] The SKILL.md file states explicitly that the upstream-issue action auto-files unconditionally (no ADW-registration check), consistent with the PRD.
- [ ] The SKILL.md file contains a pre-file idempotency re-check in both Action 1 (major) and Action 3, so re-invoking the skill on an already-in-flight finding is a no-op — no duplicate issue is filed.
- [ ] The SKILL.md file preserves the four-action menu (`upgrade parent`, `accept+document`, `accept+file-upstream-issue`, `skip`) and the updated parentheticals reflect the new behavior.
- [ ] The SKILL.md file preserves all other sections: Step 1 read findings, Step 2 filter, the pre-menu idempotency guard, Action 2 `accept+document`, Action 4 `skip`, Step 5 completion summary, the `## Notes` section (with three new bullets appended).
- [ ] `features/depaudit_triage_issue_filing.feature` exists with `@adw-438` and `@regression` tags and covers all the above assertions.
- [ ] All existing `@adw-436` and `@adw-437` scenarios continue to pass.
- [ ] `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, and `bun run build` all pass with zero errors.
- [ ] All regression scenarios pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Lint TypeScript (covers any new/modified step definitions).
- `bunx tsc --noEmit` — Root TypeScript type check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check.
- `bun run build` — Full TypeScript build.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-438"` — Run new scenarios for this issue.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-437"` — Verify the existing `@adw-437` scenarios (minor/patch autonomous flow) still pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-436"` — Verify the existing `@adw-436` scenarios (sequential walk + accept/document + skip) still pass.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression run.
- `bun run test:unit` — Unit test suite (no new unit tests; existing suite must still pass).
- Manual spot-checks:
  - `grep -c "gh issue create" .claude/skills/depaudit-triage/SKILL.md` — should return at least 2 (one for Action 1 major, one for Action 3 upstream).
  - `grep -c "/adw_sdlc" .claude/skills/depaudit-triage/SKILL.md` — should return at least 1 (in the major-bump issue body instructions).
  - `grep -c "depaudit: major upgrade —" .claude/skills/depaudit-triage/SKILL.md` — should return at least 1 (the stable title format).
  - `grep -c "Not yet wired" .claude/skills/depaudit-triage/SKILL.md` — should return 0 (Action 3 stub removed; Action 1 major flow was already re-wired by issue #437 and is further re-wired here).
  - `grep -c "pending major-bump issue" .claude/skills/depaudit-triage/SKILL.md` — should return at least 1 (canonical reason text).
  - `grep -c "upstreamIssue" .claude/skills/depaudit-triage/SKILL.md` — should return at least 3 (idempotency guard + Action 1 major accept entry + Action 3 upstream accept entry).

## Notes
- A `guidelines/` directory exists at `guidelines/coding_guidelines.md` — planning and implementation must follow the clarity-over-cleverness and meaningful-structure principles. The SKILL.md file is a prompt (markdown), not compiled code; the guideline translates to "the Action 1 and Action 3 bodies must read as step-by-step prose that Claude can follow mechanically at invocation time."
- This is an ADW-only feature. The skill remains `target: false` and is not copied to target repos by `adw_init`. The skill is invoked by the developer inside the target repo's working directory.
- No new runtime library is needed. The skill prompt instructs Claude to run `gh issue create` via the Bash tool; `gh` is the standard GitHub CLI already available on ADW-managed machines. No library install command (`bun add ...`) is required.
- PRD §Remediation policy §2 is authoritative for the major-bump flow semantics. If there is any ambiguity between this spec and the PRD, defer to the PRD.
- User stories 20, 21, 34–37 carry the developer-facing contract. User story 20 explicitly asks for a "pause for confirmation" on major bumps, but later user stories (34–37) upgrade this to "refuse to apply directly + auto-file a tracked issue." The latter supersedes: the skill does not pause-for-confirmation on major bumps in this slice — it files the issue autonomously with an expiry prompt that the user can either accept (default 30 days) or override.
- The `app_docs/feature-1w5uz8-depaudit-triage-skill.md` file will be updated during the `/document` phase (not this planning phase) to reflect the newly-wired `accept+file-upstream-issue` action and the major-bump issue-filing path. No change to `.adw/conditional_docs.md` is required; the existing entry already covers this work (it explicitly mentions "implementing the stubbed `accept+file-upstream-issue` action in future issues" and "troubleshooting idempotency behavior").
- BDD scenarios use the content-assertion pattern: they verify the *prompt text* inside `SKILL.md` contains the required instructional phrases, not runtime behavior. This is consistent with how skill contracts are validated across all ADW skill features.
- The title format requires the em-dash character `—` (U+2014), not a double hyphen `--` or a single `-`. BDD assertions check this character as a substring. When authoring the SKILL.md edit, ensure the em-dash is used verbatim (copy-paste from this spec if in doubt).
- The `>` in `<to-range>` (e.g., `<to-range>`) is literal angle-bracketed placeholder syntax, not a greater-than comparison. The BDD assertion treats the entire substring `(resolves <finding-id>)` as a literal to search for.
- `gh issue create` on the current repo is detected automatically by `gh` via the local git remote. The skill does NOT need to pass `--repo` for the major-bump path. For the upstream-issue path, `--repo <dep-owner>/<dep-repo>` is mandatory (otherwise `gh` would file on the current repo).
- The `<to-range>` text is not validated against the package ecosystem's actual range syntax by the skill — Claude picks the appropriate convention at invocation time based on the ecosystem hint. This is deliberate: the skill is a prompt, not a compiled SemVer range formatter. If a user reports an incorrect range, the fix is a prompt update, not a code change.
